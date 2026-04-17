"""
Investigation Service — LLM-Driven Agent Orchestration
=======================================================

Architecture
------------
1. MANDATORY BASELINE (always run, regardless of LLM decision)
   - identity_verification  — every subject needs identity checked
   - sanctions_screening    — regulatory requirement, non-negotiable
   - adverse_media_scan     — always run as minimum due diligence

2. CONDITIONAL AGENTS (always run when subject profile warrants it)
   - pep_check       → subject_type contains "pep" / "political" / "government"
   - registry_lookup → subject_type contains "company" / "director" / "corporate"

3. LLM-DECIDED AGENTS
   - LLM receives: subject profile + mandatory/conditional already committed +
     full catalogue of optional agents with descriptions
   - Decides WHICH optional agents to add and writes per-agent reasoning
   - Sets priority level, estimated risk, and overall rationale

4. DYNAMIC SPAWNING
   - Final list = mandatory ∪ conditional ∪ llm_decided  (deduplicated)
   - Each agent tagged: mandatory | conditional | llm_decided | escalated
   - RiskAggregationAgent always runs last

5. ESCALATION LOOP
   - After first wave, if any agent returns score >= 70 the LLM is asked
     whether remaining unrun agents should be escalated
"""

import json
import logging
import re
from datetime import datetime
from typing import Dict, Any, List, Set, Tuple
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.models import (
    Case, AgentResult as AgentResultModel,
    VerificationSource, InvestigationEvent,
)
from app.agents.agents import (
    IdentityAgent, SanctionsAgent, PEPAgent, RegistryAgent,
    AdverseMediaAgent, TransactionAnalysisAgent, RiskAggregationAgent,
)
from app.core.llm_router import llm
from app.services.verification_service import get_authorities_for_subject, VERIFICATION_AUTHORITIES, register_verification_callback, set_current_case_id

logger = logging.getLogger(__name__)


# ─── Agent Catalogue ─────────────────────────────────────────────────────────
AGENT_CATALOGUE = {
    "identity_verification": {
        "class": IdentityAgent,
        "display_name": "Identity Verification Agent",
        "description": (
            "Verifies identity document authenticity against government databases "
            "(UIDAI for Aadhaar, ICAO for passports). Checks MRZ validity, "
            "document expiry, and biometric indicators."
        ),
        "typical_use": "All subjects — minimum due diligence",
        "tier": "mandatory",
    },
    "sanctions_screening": {
        "class": SanctionsAgent,
        "display_name": "Sanctions Screening Agent",
        "description": (
            "Screens against OFAC SDN, UN Consolidated, EU Financial Sanctions, "
            "and HM Treasury lists. Performs fuzzy name matching with transliteration. "
            "Returns match confidence scores."
        ),
        "typical_use": "All subjects — regulatory requirement",
        "tier": "mandatory",
    },
    "adverse_media_scan": {
        "class": AdverseMediaAgent,
        "display_name": "Adverse Media Agent",
        "description": (
            "Searches global news archives, regulatory bulletins, and court records "
            "for negative coverage: fraud, corruption, money laundering, bribery, "
            "terrorism, drug trafficking, and related crimes."
        ),
        "typical_use": "All subjects — minimum due diligence",
        "tier": "mandatory",
    },
    "pep_check": {
        "class": PEPAgent,
        "display_name": "PEP Check Agent",
        "description": (
            "Checks World-Check One and LexisNexis WorldCompliance for Politically "
            "Exposed Person status. Covers heads of state, ministers, senior officials, "
            "judges, military leadership, and their immediate family and close associates."
        ),
        "typical_use": "PEPs, government officials, their associates",
        "tier": "conditional",
        "auto_trigger": ["pep", "political", "government", "official", "minister", "politically exposed"],
    },
    "registry_lookup": {
        "class": RegistryAgent,
        "display_name": "Corporate Registry Agent",
        "description": (
            "Queries Companies House, OpenCorporates, MCA21 (India), and BVI/Cayman "
            "registries. Identifies shell companies, nominee directors, UBO structures, "
            "and cross-border holding chains."
        ),
        "typical_use": "Company directors, corporate entities, trusts, nominees",
        "tier": "conditional",
        "auto_trigger": ["company", "director", "corporate", "corporate entity", "trust", "nominee", "foundation"],
    },
    "transaction_analysis": {
        "class": TransactionAnalysisAgent,
        "display_name": "Transaction Analysis Agent",
        "description": (
            "Analyses financial transaction patterns for typologies: structuring, "
            "layering, round-tripping, high-frequency micro-transactions, "
            "rapid movement through multiple jurisdictions, and unexplained wealth."
        ),
        "typical_use": (
            "High net worth individuals, offshore structures, subjects from "
            "high-risk jurisdictions, company directors with complex finances"
        ),
        "tier": "optional",
    },
}

MANDATORY_AGENTS:   Set[str] = {k for k, v in AGENT_CATALOGUE.items() if v["tier"] == "mandatory"}
CONDITIONAL_AGENTS: Set[str] = {k for k, v in AGENT_CATALOGUE.items() if v["tier"] == "conditional"}
OPTIONAL_AGENTS:    Set[str] = {k for k, v in AGENT_CATALOGUE.items() if v["tier"] == "optional"}

HIGH_RISK_COUNTRIES = {
    "russia", "russian federation", "iran", "iranian", "north korea",
    "syria", "myanmar", "belarus", "cuba", "venezuela", "sudan",
    "somalia", "libya", "iraq", "afghanistan", "yemen", "zimbabwe",
    "democratic republic of congo",
}


# ─── Phase 1 helpers ─────────────────────────────────────────────────────────

def _mandatory_agents() -> List[str]:
    return list(MANDATORY_AGENTS)


def _conditional_agents(case: Case) -> List[str]:
    combined = (
        (case.subject_type or "") + " " + (case.notes or "")
    ).lower()
    triggered = []
    for key, meta in AGENT_CATALOGUE.items():
        if meta["tier"] != "conditional":
            continue
        if any(t in combined for t in meta.get("auto_trigger", [])):
            triggered.append(key)
    return triggered


# ─── Phase 2: LLM decides optional agents ────────────────────────────────────

async def _llm_decide_agents(
    case: Case,
    already_committed: List[str],
) -> Dict[str, Any]:
    """Ask LLM to decide which optional agents to add beyond the committed set."""

    already_names = [
        AGENT_CATALOGUE[k]["display_name"]
        for k in already_committed
        if k in AGENT_CATALOGUE
    ]

    optional_catalogue_text = "\n".join(
        f"  - {key}: {meta['display_name']} — {meta['description']} "
        f"[typical use: {meta['typical_use']}]"
        for key, meta in AGENT_CATALOGUE.items()
        if meta["tier"] == "optional"
    )

    nat_lower = (case.nationality or "").lower()
    is_high_risk = any(c in nat_lower for c in HIGH_RISK_COUNTRIES)

    prompt = f"""You are a senior AML/KYC compliance analyst at a Tier-1 financial institution.

You must decide which ADDITIONAL investigation agents to spawn for this subject.

=== SUBJECT PROFILE ===
Name:           {case.subject_name}
Subject Type:   {case.subject_type or "Unknown"}
Nationality:    {case.nationality or "Unknown"}
Date of Birth:  {case.date_of_birth or "Unknown"}
Case Notes:     {case.notes or "None"}
High-Risk Country Flag: {"YES" if is_high_risk else "No"}

=== ALREADY COMMITTED (mandatory + conditional — will run regardless) ===
{chr(10).join(f"  [RUNNING] {n}" for n in already_names)}

=== OPTIONAL AGENTS YOU CAN ADD ===
{optional_catalogue_text}

=== YOUR DECISION ===
1. Review the subject profile carefully.
2. Decide which optional agents to ADD (zero is a valid answer for low-risk subjects).
3. Write brief reasoning for each agent you add, AND for any you deliberately exclude.
4. Set a priority level and estimated risk score for this investigation.

Return ONLY valid JSON (no markdown, no preamble):
{{
  "additional_agents": ["agent_key1"],
  "agent_reasoning": {{
    "transaction_analysis": "Added because subject is a PEP from high-risk jurisdiction with complex finances"
  }},
  "excluded_reasoning": {{
    "some_key": "Not needed because..."
  }},
  "priority_level": "LOW|MEDIUM|HIGH|CRITICAL",
  "estimated_risk": 0-100,
  "risk_indicators": ["indicator1"],
  "reasoning": "overall investigation rationale",
  "special_notes": "any special concerns or instructions"
}}

RULES:
- Only add agents from the optional list above.
- Do NOT re-add agents already committed.
- A clean low-risk individual should get 0 additional agents.
- A PEP director from a high-risk country may warrant all of them.
- Be specific and professional in your reasoning."""

    try:
        response = await llm.complete(
            prompt,
            system="You are a KYC/AML compliance expert. Respond with ONLY valid JSON.",
            max_tokens=1000,
        )
        clean = response.strip()
        if clean.startswith("```"):
            clean = re.sub(r"```[a-z]*\n?", "", clean).strip("`").strip()

        decision = json.loads(clean)

        # Validate — only allow known optional keys not already committed
        valid_additional = [
            k for k in decision.get("additional_agents", [])
            if k in OPTIONAL_AGENTS and k not in already_committed
        ]
        decision["additional_agents"] = valid_additional
        return decision

    except Exception as e:
        logger.warning(f"LLM agent decision failed ({e}). Using rule-based fallback.")
        return _fallback_agent_decision(case, already_committed)


def _fallback_agent_decision(case: Case, already_committed: List[str]) -> Dict[str, Any]:
    """Deterministic fallback when the LLM is unavailable."""
    additional: List[str] = []
    risk_indicators: List[str] = []

    nat_lower  = (case.nationality   or "").lower()
    type_lower = (case.subject_type  or "").lower()
    notes_lower = (case.notes        or "").lower()
    combined   = type_lower + " " + notes_lower

    is_high_risk = any(c in nat_lower for c in HIGH_RISK_COUNTRIES)

    if "transaction_analysis" not in already_committed:
        if is_high_risk or any(t in combined for t in ["pep", "director", "offshore", "hnwi"]):
            additional.append("transaction_analysis")

    if is_high_risk:
        risk_indicators.append(f"High-risk jurisdiction: {case.nationality}")

    priority = (
        "CRITICAL" if (is_high_risk and "pep" in combined) else
        "HIGH"     if (is_high_risk or "pep" in combined)  else
        "MEDIUM"   if ("director" in combined or "corporate" in combined) else
        "LOW"
    )

    return {
        "additional_agents":  additional,
        "agent_reasoning":    {k: "Added by rule-based fallback" for k in additional},
        "excluded_reasoning": {},
        "priority_level":     priority,
        "estimated_risk":     {"CRITICAL": 75, "HIGH": 60, "MEDIUM": 40, "LOW": 20}[priority],
        "risk_indicators":    risk_indicators,
        "reasoning":          "LLM unavailable — deterministic rules applied.",
        "special_notes":      "Using rule-based fallback investigation plan.",
    }


# ─── Phase 3: Build final ordered list ───────────────────────────────────────

def _build_final_agent_list(
    mandatory:    List[str],
    conditional:  List[str],
    llm_decided:  List[str],
) -> Tuple[List[str], Dict[str, str]]:
    """
    Deduplicate and order agents.
    Returns (ordered_keys, source_map).
    """
    seen:    Set[str]       = set()
    ordered: List[str]      = []
    sources: Dict[str, str] = {}

    for key in mandatory:
        if key not in seen and key in AGENT_CATALOGUE:
            ordered.append(key); seen.add(key); sources[key] = "mandatory"

    for key in conditional:
        if key not in seen and key in AGENT_CATALOGUE:
            ordered.append(key); seen.add(key); sources[key] = "conditional"

    for key in llm_decided:
        if key not in seen and key in AGENT_CATALOGUE:
            ordered.append(key); seen.add(key); sources[key] = "llm_decided"

    return ordered, sources


# ─── Phase 4: Escalation ─────────────────────────────────────────────────────

async def _check_escalation(
    case: Case,
    completed: List[Dict],
    already_run: Set[str],
    db: AsyncSession,
) -> List[str]:
    """
    After first wave: if any agent score >= 70, ask LLM whether remaining
    optional agents should be escalated.
    """
    max_score = max((r.get("risk_score", 0) for r in completed), default=0)
    if max_score < 70:
        return []

    remaining = [k for k in AGENT_CATALOGUE if k not in already_run]
    if not remaining:
        return []

    top_flags = list({f for r in completed for f in r.get("flags", []) if isinstance(f, str)})

    # Build the agent summary outside the f-string to avoid the
    # {{...}} f-string trap (double braces inside expressions create sets,
    # not dict literals, causing "unhashable type: dict").
    agent_summary = json.dumps(
        [{"agent": r["agent"], "score": r["risk_score"], "flags": r["flags"]} for r in completed],
        indent=2,
    )

    prompt = f"""Senior AML analyst reviewing escalation decision.

Subject: {case.subject_name} ({case.subject_type}, {case.nationality})
First-wave max risk score: {max_score:.0f}/100
Flags raised: {top_flags}

Agent results summary:
{agent_summary}

Agents NOT yet run: {remaining}

Should any unrun agents be escalated for deeper investigation?
Reply ONLY with JSON: {{"escalate": ["key1"], "reasoning": "brief explanation"}}
If none needed: {{"escalate": [], "reasoning": "explanation"}}"""

    try:
        response = await llm.complete(prompt, system="Respond with valid JSON only.", max_tokens=400)
        clean = response.strip()
        if clean.startswith("```"):
            clean = re.sub(r"```[a-z]*\n?", "", clean).strip("`").strip()
        data = json.loads(clean)

        # Guard: LLM sometimes returns list of dicts instead of list of strings.
        # Extract the string key from dicts, skip anything else non-string.
        raw_escalate = data.get("escalate", [])
        str_escalate = [
            (k if isinstance(k, str) else k.get("agent") or k.get("key") or "")
            for k in raw_escalate
        ]
        escalate = [k for k in str_escalate if k and k in AGENT_CATALOGUE and k not in already_run]
        if escalate:
            await _log_event(db, case.id, "escalation_triggered", {
                "escalated": escalate,
                "trigger_score": max_score,
                "reasoning": data.get("reasoning", ""),
            })
        return escalate

    except Exception as e:
        logger.warning(f"Escalation check failed: {e}")
        return []


# ─── Public entry points ──────────────────────────────────────────────────────

async def generate_investigation_plan(case: Case, db: AsyncSession) -> Dict[str, Any]:
    """Generate the full LLM-driven investigation plan."""
    mandatory   = _mandatory_agents()
    conditional = _conditional_agents(case)
    already     = list(dict.fromkeys(mandatory + conditional))

    llm_decision = await _llm_decide_agents(case, already)
    llm_additional = llm_decision.get("additional_agents", [])

    final_agents, source_map = _build_final_agent_list(mandatory, conditional, llm_additional)

    plan = {
        "investigation_plan": final_agents,
        "mandatory_agents":   mandatory,
        "conditional_agents": conditional,
        "llm_decided_agents": llm_additional,
        "agent_sources":      source_map,

        "reasoning":          llm_decision.get("reasoning", ""),
        "agent_reasoning":    llm_decision.get("agent_reasoning", {}),
        "excluded_reasoning": llm_decision.get("excluded_reasoning", {}),
        "risk_indicators":    llm_decision.get("risk_indicators", []),
        "priority_level":     llm_decision.get("priority_level", "MEDIUM"),
        "estimated_risk":     llm_decision.get("estimated_risk", 40),
        "special_notes":      llm_decision.get("special_notes", ""),

        "total_agents":     len(final_agents),
        "llm_contributed":  len(llm_additional) > 0,
    }

    await _log_event(db, case.id, "plan_generated", {
        "total_agents": plan["total_agents"],
        "mandatory":    mandatory,
        "conditional":  conditional,
        "llm_added":    llm_additional,
        "priority":     plan["priority_level"],
    })
    return plan


async def run_investigation(case_id: str, db: AsyncSession) -> Dict[str, Any]:
    """Full investigation pipeline — 5 phases."""
    result = await db.execute(select(Case).where(Case.id == case_id))
    case = result.scalar_one_or_none()
    if not case:
        raise ValueError(f"Case {case_id} not found")

    case.status = "investigating"
    await db.commit()

    # Register verification event callback so every API call is logged
    async def _on_verification_event(c_id: str, event_data: dict):
        phase = event_data.pop("phase", "")
        if phase == "completed":
            await _log_event(db, c_id, "verification_api_called", event_data)

    register_verification_callback(_on_verification_event)
    set_current_case_id(case_id)

    # Phase 1 ─ Plan
    plan = await generate_investigation_plan(case, db)
    case.investigation_plan = plan
    await db.commit()

    # Subject context
    subject = {
        "subject_name":   case.subject_name,
        "subject_type":   case.subject_type  or "",
        "nationality":    case.nationality   or "",
        "date_of_birth":  case.date_of_birth or "",
        "notes":          case.notes         or "",
        "document_types": [],
    }
    from app.db.models import Document
    doc_res = await db.execute(select(Document).where(Document.case_id == case_id))
    docs = doc_res.scalars().all()
    subject["document_types"] = [d.document_type for d in docs if d.document_type]
    if docs and docs[0].extracted_data:
        subject.update(docs[0].extracted_data.get("fields", {}))

    # Phase 2 ─ Run planned agents
    agent_results: List[Dict] = []
    run_keys:      Set[str]   = set()
    source_map = plan.get("agent_sources", {})

    for agent_key in plan["investigation_plan"]:
        meta = AGENT_CATALOGUE.get(agent_key)
        if not meta:
            logger.warning(f"Unknown agent key '{agent_key}' — skipping")
            continue

        source = source_map.get(agent_key, "unknown")
        await _log_event(db, case_id, "agent_started", {
            "agent": agent_key, "display_name": meta["display_name"], "source": source,
        })

        try:
            agent_obj = meta["class"](case_id, subject)
            result_obj = await agent_obj.run()
            result_dict = result_obj.to_dict()
            result_dict["_source"] = source
            agent_results.append(result_dict)
            run_keys.add(agent_key)

            await _save_agent_result(db, case_id, result_obj, source)

            # ── Live score update: recompute partial weighted score so the
            #    frontend gauge moves as each agent completes ─────────────────
            _update_live_score(case, agent_results)
            await db.commit()

            await _log_event(db, case_id, "agent_completed", {
                "agent": agent_key, "source": source,
                "score": result_obj.risk_score, "flags": result_obj.flags,
            })
            logger.info(
                f"[{case_id[:8]}] {meta['display_name']} ({source}) "
                f"score={result_obj.risk_score:.0f} flags={result_obj.flags}"
            )
        except Exception as e:
            logger.error(f"Agent {agent_key} failed: {e}", exc_info=True)
            await _log_event(db, case_id, "agent_failed", {"agent": agent_key, "error": str(e)})

    # Phase 3/4 ─ Escalation
    escalation_keys = await _check_escalation(case, agent_results, run_keys, db)
    for agent_key in escalation_keys:
        meta = AGENT_CATALOGUE.get(agent_key)
        if not meta or agent_key in run_keys:
            continue
        await _log_event(db, case_id, "agent_started", {"agent": agent_key, "source": "escalated"})
        try:
            agent_obj = meta["class"](case_id, subject)
            result_obj = await agent_obj.run()
            result_dict = result_obj.to_dict()
            result_dict["_source"] = "escalated"
            agent_results.append(result_dict)
            run_keys.add(agent_key)
            await _save_agent_result(db, case_id, result_obj, "escalated")
            _update_live_score(case, agent_results)
            await db.commit()
            await _log_event(db, case_id, "agent_completed", {
                "agent": agent_key, "source": "escalated",
                "score": result_obj.risk_score, "flags": result_obj.flags,
            })
        except Exception as e:
            logger.error(f"Escalated agent {agent_key} failed: {e}", exc_info=True)

    # Phase 5 ─ Risk aggregation
    subject["_agent_results"] = agent_results
    final_result = await RiskAggregationAgent(case_id, subject).run()

    case.risk_score = final_result.risk_score
    case.risk_level = _score_to_level(final_result.risk_score)
    case.status = "review"
    await db.commit()

    await _log_event(db, case_id, "investigation_complete", {
        "final_score":     final_result.risk_score,
        "risk_level":      case.risk_level,
        "agents_run":      len(agent_results),
        "mandatory_ran":   [k for k in run_keys if source_map.get(k) == "mandatory"],
        "conditional_ran": [k for k in run_keys if source_map.get(k) == "conditional"],
        "llm_decided_ran": [k for k in run_keys if source_map.get(k) == "llm_decided"],
        "escalated_ran":   list(escalation_keys),
    })

    return {
        "case_id":       case_id,
        "risk_score":    final_result.risk_score,
        "risk_level":    case.risk_level,
        "plan":          plan,
        "agent_results": agent_results,
        "final_result":  final_result.to_dict(),
    }


# ─── Internal helpers ─────────────────────────────────────────────────────────

def _update_live_score(case, agent_results: list):
    """Recompute a partial weighted risk score from completed agents so far
    and write it to case.risk_score — lets the frontend gauge animate live."""
    weights = {
        "sanctions_agent": 0.30, "pep_agent": 0.25, "identity_agent": 0.15,
        "registry_agent": 0.15, "adverse_media_agent": 0.10,
        "transaction_analysis_agent": 0.05,
    }
    weighted, total_w = 0.0, 0.0
    for r in agent_results:
        w = weights.get(r["agent"], 0.10)
        weighted += r["risk_score"] * w
        total_w  += w
    if total_w > 0:
        partial = round(min(100, max(0, weighted / total_w)), 1)
        case.risk_score = partial
        case.risk_level = _score_to_level(partial)


async def _save_agent_result(db, case_id, result_obj, source):
    evidence = {**result_obj.evidence, "_agent_source": source}
    db.add(AgentResultModel(
        case_id=case_id, agent_name=result_obj.agent,
        risk_score=result_obj.risk_score, flags=result_obj.flags,
        summary=result_obj.summary, confidence=result_obj.confidence,
        evidence=evidence, status="done", completed_at=datetime.utcnow(),
    ))
    for auth_key in result_obj.authorities_used:
        auth_info   = VERIFICATION_AUTHORITIES.get(auth_key, {})
        auth_evidence = result_obj.evidence.get(auth_key, {})
        db.add(VerificationSource(
            case_id=case_id,
            source_name=auth_info.get("name", auth_key),
            source_type=auth_info.get("type", "unknown"),
            result=auth_evidence.get("result", "unknown"),
            result_detail=auth_evidence,
            is_mock=auth_evidence.get("is_mock", True),
        ))


def _score_to_level(score: float) -> str:
    if score >= 80: return "critical"
    if score >= 60: return "high"
    if score >= 40: return "medium"
    return "low"


async def _log_event(db, case_id, event_type, event_data):
    db.add(InvestigationEvent(
        case_id=case_id, event_type=event_type, event_data=event_data,
        message=f"{event_type}: {json.dumps(event_data)[:300]}",
    ))
    await db.commit()
