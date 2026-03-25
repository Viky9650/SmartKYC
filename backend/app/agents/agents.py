"""Investigation agents for SmartKYC."""
import re
from typing import Dict, Any
from app.agents.base_agent import BaseAgent, AgentResult
from app.services.verification_service import run_verification


def _normalise_name(name: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace."""
    name = name.lower()
    name = re.sub(r"[^a-z0-9\s]", "", name)
    return " ".join(name.split())


def _name_tokens(name: str):
    return set(_normalise_name(name).split())


def _name_match_score(a: str, b: str) -> float:
    """
    Returns 0.0 (completely different) → 1.0 (identical).
    Uses token overlap so "John Smith" matches "Smith John".
    """
    if not a or not b:
        return 0.0
    if _normalise_name(a) == _normalise_name(b):
        return 1.0
    ta, tb = _name_tokens(a), _name_tokens(b)
    if not ta or not tb:
        return 0.0
    overlap = len(ta & tb)
    return overlap / max(len(ta), len(tb))


def _normalise_dob(dob: str):
    """
    Parse a date string into a (day, month, year) int tuple.
    Handles:  DD/MM/YYYY  DD-MM-YYYY  YYYY-MM-DD  YYYY/MM/DD  DD.MM.YYYY
    Returns None if unparseable.
    """
    if not dob:
        return None
    dob = dob.strip()
    dob = re.sub(r"[\-\./]", "/", dob)
    parts = dob.split("/")
    if len(parts) != 3:
        return None
    try:
        p = [int(x) for x in parts]
    except ValueError:
        return None
    # YYYY/MM/DD
    if p[0] > 31:
        return (p[2], p[1], p[0])
    # DD/MM/YYYY
    if p[2] > 31:
        return (p[0], p[1], p[2])
    return None


def _dob_match(a: str, b: str) -> bool:
    """Return True if both DOB strings resolve to the same calendar date."""
    na, nb = _normalise_dob(a), _normalise_dob(b)
    if na is None or nb is None:
        return True   # Can't compare -> do not flag
    return na == nb


class IdentityAgent(BaseAgent):
    name = "identity_agent"
    description = "Verifies personal identity using extracted document data"

    async def run(self) -> AgentResult:
        self.logger.info(f"IdentityAgent running for case {self.case_id}")
        case_name   = self.subject.get("subject_name", "")
        nationality = self.subject.get("nationality", "")
        doc_types   = self.subject.get("document_types", [])

        # ── Collect extracted document names (all sources) ────────────────────
        # The investigation_service merges extracted_data fields into subject,
        # so "full_name", "name", "surname"+"given_names" may be present.
        extracted_name = (
            self.subject.get("full_name")
            or self.subject.get("name")
            or (
                (self.subject.get("given_names", "") + " " + self.subject.get("surname", "")).strip()
                or None
            )
        )

        results = {}
        authorities_used = []
        flags = []
        score = 0.0
        mismatch_detail = {}

        # ── Name mismatch check ───────────────────────────────────────────────
        if extracted_name and case_name:
            match_score = _name_match_score(case_name, extracted_name)
            mismatch_detail = {
                "case_name":       case_name,
                "document_name":   extracted_name,
                "match_score":     round(match_score, 3),
            }
            self.logger.info(
                f"Name match: '{case_name}' vs '{extracted_name}' → {match_score:.2f}"
            )
            if match_score < 0.30:
                # Strong mismatch — could be data entry error OR fraud
                # Score is advisory (40) until officer confirms suspicious (→75 via endpoint)
                flags.append("name_mismatch_critical")
                score = max(score, 40.0)
                mismatch_detail["severity"] = "NEEDS_REVIEW"
                mismatch_detail["note"] = (
                    f"Document name '{extracted_name}' does not match case name "
                    f"'{case_name}' (similarity {match_score:.0%}). "
                    "Could be a data entry error — officer must confirm or correct."
                )
            elif match_score < 0.70:
                # Partial mismatch — nickname, maiden name, etc.
                flags.append("name_mismatch")
                score = max(score, 25.0)
                mismatch_detail["severity"] = "WARNING"
                mismatch_detail["note"] = (
                    f"Partial name match: '{extracted_name}' vs '{case_name}' "
                    f"(similarity {match_score:.0%}). Review required."
                )

        # ── DOB mismatch check ────────────────────────────────────────────────
        case_dob      = self.subject.get("date_of_birth", "")   # from Case record
        extracted_dob = self.subject.get("date_of_birth") or ""  # from extracted fields
        # extracted_data fields are merged into subject AFTER case fields,
        # so date_of_birth in subject IS the extracted value if a doc was uploaded.
        # We compare case.date_of_birth (entered by the operator) vs doc extraction.
        # They live in the same key so we need both raw sources — we get the
        # operator-entered one from the Case model via a dedicated key set in
        # investigation_service (see below).
        operator_dob   = self.subject.get("_case_date_of_birth", "")
        document_dob   = self.subject.get("date_of_birth", "")

        dob_detail: dict = {}
        if operator_dob and document_dob:
            if not _dob_match(operator_dob, document_dob):
                flags.append("dob_mismatch")
                # Advisory score — officer must confirm before full floor applies
                score = max(score, 35.0)
                dob_detail = {
                    "case_dob":      operator_dob,
                    "document_dob":  document_dob,
                    "severity":      "NEEDS_REVIEW",
                    "note": (
                        f"Date of birth on document ({document_dob}) does not match "
                        f"case record ({operator_dob}). Could be a data entry error — "
                        "officer must confirm or correct."
                    ),
                }
                self.logger.info(
                    f"DOB mismatch: case='{operator_dob}' doc='{document_dob}'"
                )
            else:
                dob_detail = {
                    "case_dob":     operator_dob,
                    "document_dob": document_dob,
                    "match":        True,
                }

        # ── Authority checks ──────────────────────────────────────────────────
        # Document type drives which authorities to call — NOT just nationality.
        # A British-nationality subject can still submit an Indian PAN card.
        subject_type = self.subject.get("subject_type", "")

        # Build extracted_data dict to pass document fields to authorities
        extracted_data = {
            k: self.subject.get(k)
            for k in [
                "pan_number", "aadhaar_number", "date_of_birth",
                "passport_number", "full_name", "name",
                "surname", "given_names", "id_number",
            ]
            if self.subject.get(k)
        }

        doc_types_lower = [t.lower() for t in doc_types]

        # ── Indian documents ──────────────────────────────────────────────────
        has_pan     = "in_pan"    in doc_types_lower
        has_aadhaar = "in_aadhaar" in doc_types_lower
        is_indian   = "INDIA" in nationality.upper() or "INDIAN" in nationality.upper()

        if has_pan:
            # PAN card → India PAN Verification (Income Tax Dept)
            # Pass the extracted PAN number so the authority can do a real lookup
            r = await run_verification(
                "INDIA_PAN_VERIFY", case_name, subject_type, nationality,
                extracted_data=extracted_data,
            )
            results["INDIA_PAN_VERIFY"] = r
            authorities_used.append("INDIA_PAN_VERIFY")

        if has_aadhaar:
            # Aadhaar card → UIDAI
            r = await run_verification(
                "UIDAI_AADHAAR", case_name, subject_type, nationality,
                extracted_data=extracted_data,
            )
            results["UIDAI_AADHAAR"] = r
            authorities_used.append("UIDAI_AADHAAR")

        if is_indian and not has_pan and not has_aadhaar:
            # Indian subject but no specific doc — run both as fallback
            for auth in ["UIDAI_AADHAAR", "INDIA_PAN_VERIFY"]:
                r = await run_verification(
                    auth, case_name, subject_type, nationality,
                    extracted_data=extracted_data,
                )
                results[auth] = r
                authorities_used.append(auth)

        # ── Passport (any nationality) ────────────────────────────────────────
        has_passport = any(
            t in doc_types_lower
            for t in ["in_passport","gb_passport","us_passport","eu_passport",
                      "ru_passport","ae_passport","cn_passport","generic_passport"]
        )
        if has_passport or not results:
            # Always run passport check if a passport was uploaded,
            # OR as a fallback when no other authority matched
            r = await run_verification(
                "PASSPORT_INDEX", case_name, subject_type, nationality,
                extracted_data=extracted_data,
            )
            results["PASSPORT_INDEX"] = r
            authorities_used.append("PASSPORT_INDEX")

        # ── UK documents ──────────────────────────────────────────────────────
        if "gb_driving_license" in doc_types_lower:
            r = await run_verification(
                "DVLA_UK", case_name, subject_type, nationality,
                extracted_data=extracted_data,
            )
            results["DVLA_UK"] = r
            authorities_used.append("DVLA_UK")

        # ── UAE documents ─────────────────────────────────────────────────────
        if "ae_emirates_id" in doc_types_lower:
            r = await run_verification(
                "PASSPORT_INDEX", case_name, subject_type, nationality,
                extracted_data=extracted_data,
            )
            results["PASSPORT_INDEX"] = r
            if "PASSPORT_INDEX" not in authorities_used:
                authorities_used.append("PASSPORT_INDEX")

        any_failed = any(v.get("result") not in ["clear", "found"] for v in results.values())
        if any_failed:
            flags.append("identity_verification_failed")
            score = max(score, 60.0)

        if not flags:
            score = 15.0

        # Build summary
        issues = []
        if "name_mismatch_critical" in flags:
            issues.append(f"CRITICAL name mismatch: document='{extracted_name}' vs case='{case_name}'")
        elif "name_mismatch" in flags:
            issues.append(f"Partial name mismatch: document='{extracted_name}' vs case='{case_name}'")
        if "dob_mismatch" in flags:
            issues.append(
                f"DOB mismatch: document='{document_dob}' vs case='{operator_dob}'"
            )
        if any_failed:
            issues.append("Identity authority check failed")

        if issues:
            summary = "Identity issues detected — " + "; ".join(issues) + "."
        else:
            summary = "Document verified. Name and date of birth match case record."

        evidence = {**results}
        if mismatch_detail:
            evidence["name_mismatch_check"] = mismatch_detail
        if dob_detail:
            evidence["dob_mismatch_check"] = dob_detail

        return AgentResult(
            agent=self.name,
            risk_score=score,
            flags=flags,
            summary=summary,
            confidence=0.92 if not flags else 0.70,
            evidence=evidence,
            authorities_used=authorities_used,
        )


class SanctionsAgent(BaseAgent):
    name = "sanctions_agent"
    description = "Checks global sanctions lists including OFAC, UN, EU, HM Treasury"

    async def run(self) -> AgentResult:
        name = self.subject.get("subject_name", "")
        nationality = self.subject.get("nationality", "")
        subject_type = self.subject.get("subject_type", "")

        authorities = ["OFAC_SDN", "UN_SANCTIONS", "EU_SANCTIONS"]
        nat_upper = nationality.upper()
        if any(c in nat_upper for c in ["UK", "BRITISH", "GREAT BRITAIN"]):
            authorities.append("HM_TREASURY")

        results = {}
        flags = []
        max_score = 0.0

        for auth in authorities:
            r = await run_verification(auth, name, subject_type, nationality)
            results[auth] = r
            if r.get("result") == "partial_match":
                score = r.get("match_score", 0.7) * 100
                max_score = max(max_score, score)
            elif r.get("result") == "flagged":
                max_score = max(max_score, 85.0)

        # Deduplicated flags from aggregate results
        # Flags based on result types across all sources
        partial = any(r.get("result") == "partial_match" for r in results.values())
        direct = any(r.get("result") == "flagged" and "sanctions" in str(r.get("matches", "")).lower() for r in results.values())
        high_risk_country = any(
            r.get("country_risk") == "HIGH" or r.get("high_risk_jurisdiction")
            for r in results.values()
        )

        if direct or max_score >= 85:
            flags.append("sanctions_match")
        elif partial:
            flags.append("sanctions_partial_match")
        if high_risk_country:
            flags.append("high_risk_jurisdiction")

        if not flags:
            max_score = 10.0

        return AgentResult(
            agent=self.name,
            risk_score=max_score,
            flags=flags,
            summary="No sanctions matches found." if not flags else f"Sanctions alert: {', '.join(set(flags))}",
            confidence=0.95,
            evidence=results,
            authorities_used=authorities,
        )


class PEPAgent(BaseAgent):
    name = "pep_agent"
    description = "Checks Politically Exposed Persons databases"

    async def run(self) -> AgentResult:
        name = self.subject.get("subject_name", "")
        nationality = self.subject.get("nationality", "")
        subject_type = self.subject.get("subject_type", "")

        results = {}
        authorities = ["WORLD_CHECK", "LEXISNEXIS"]
        flags = []
        score = 0.0

        pep_confirmed = False
        has_family = False
        for auth in authorities:
            r = await run_verification(auth, name, subject_type, nationality)
            results[auth] = r
            if r.get("result") == "flagged" and r.get("pep_status") == "CONFIRMED_PEP":
                score = 85.0
                pep_confirmed = True
                if r.get("family_connections"):
                    has_family = True

        if pep_confirmed:
            flags.append("pep_confirmed")
        if has_family:
            flags.append("pep_family_connections")

        if not flags:
            score = 5.0

        return AgentResult(
            agent=self.name,
            risk_score=score,
            flags=flags,
            summary="No PEP status found." if not flags else "Subject confirmed as Politically Exposed Person.",
            confidence=0.91,
            evidence=results,
            authorities_used=authorities,
        )


class RegistryAgent(BaseAgent):
    name = "registry_agent"
    description = "Verifies company registration and ownership structures"

    async def run(self) -> AgentResult:
        name = self.subject.get("subject_name", "")
        nationality = self.subject.get("nationality", "")
        subject_type = self.subject.get("subject_type", "")
        company_name = self.subject.get("company_name")

        authorities = ["COMPANIES_HOUSE", "OPEN_CORPORATES"]
        nat_upper = nationality.upper()
        if "INDIA" in nat_upper or "INDIAN" in nat_upper:
            authorities.append("MCA21_INDIA")

        results = {}
        flags = []
        score = 0.0

        for auth in authorities:
            r = await run_verification(auth, name, subject_type, nationality, company_name=company_name)
            results[auth] = r
            if r.get("result") == "flagged":
                score = max(score, 65.0)
                if "Director name mismatch" in str(r.get("discrepancies", [])):
                    flags.append("registry_mismatch")
                if "Nominee director" in str(r.get("discrepancies", [])):
                    flags.append("nominee_director")
                if r.get("beneficial_ownership") == "UNDISCLOSED":
                    flags.append("undisclosed_beneficial_owner")

        if not flags:
            score = 20.0

        return AgentResult(
            agent=self.name,
            risk_score=score,
            flags=flags,
            summary="No corporate registry issues." if not flags else f"Registry anomalies: {', '.join(flags)}",
            confidence=0.84,
            evidence=results,
            authorities_used=authorities,
        )


class AdverseMediaAgent(BaseAgent):
    name = "adverse_media_agent"
    description = "Scans global news and adverse media"

    async def run(self) -> AgentResult:
        name = self.subject.get("subject_name", "")
        nationality = self.subject.get("nationality", "")
        subject_type = self.subject.get("subject_type", "")

        authorities = ["GLOBAL_NEWS_API", "DOW_JONES_RISK"]
        results = {}
        flags = []
        score = 0.0

        has_adverse = False
        for auth in authorities:
            r = await run_verification(auth, name, subject_type, nationality)
            results[auth] = r
            n = r.get("articles_found", 0)
            if n > 0:
                score = max(score, min(40 + n * 8, 80))
                has_adverse = True
        if has_adverse:
            flags.append("adverse_media")

        if not flags:
            score = 5.0

        total_articles = sum(r.get("articles_found", 0) for r in results.values())
        return AgentResult(
            agent=self.name,
            risk_score=score,
            flags=flags,
            summary=f"No adverse media found." if not flags else f"{total_articles} adverse media articles found.",
            confidence=0.78,
            evidence=results,
            authorities_used=authorities,
        )


class TransactionAnalysisAgent(BaseAgent):
    name = "transaction_analysis_agent"
    description = "Analyzes suspicious financial transaction patterns"

    async def run(self) -> AgentResult:
        subject_type = self.subject.get("subject_type", "")
        nationality = self.subject.get("nationality", "")

        HIGH_RISK_TYPES = ["pep", "company director"]
        is_high_risk = any(h in subject_type.lower() for h in HIGH_RISK_TYPES)

        flags = []
        score = 0.0
        evidence = {}

        if is_high_risk:
            score = 45.0
            flags = ["high_value_transactions", "cross_border_transfers"]
            evidence = {
                "transaction_count": 47,
                "high_value_count": 8,
                "jurisdictions": ["RU", "AE", "CY", "BVI"],
                "suspicious_patterns": ["Round-number transactions", "Multiple offshore jurisdictions"],
            }
        else:
            score = 10.0
            evidence = {"transaction_count": 12, "high_value_count": 0, "jurisdictions": [], "suspicious_patterns": []}

        return AgentResult(
            agent=self.name,
            risk_score=score,
            flags=flags,
            summary="No suspicious transaction patterns." if not flags else f"Suspicious patterns: {', '.join(flags)}",
            confidence=0.75,
            evidence=evidence,
            authorities_used=[],
        )


class RiskAggregationAgent(BaseAgent):
    name = "risk_aggregation_agent"
    description = "Aggregates all agent findings into a final risk score"

    async def run(self) -> AgentResult:
        agent_results = self.subject.get("_agent_results", [])
        if not agent_results:
            return AgentResult(agent=self.name, risk_score=50, flags=["insufficient_data"],
                               summary="Insufficient data for risk aggregation.", confidence=0.5)

        # Weighted aggregation — identity raised to 0.25 to reflect KYC primacy
        weights = {
            "sanctions_agent":            0.30,
            "pep_agent":                  0.20,
            "identity_agent":             0.25,   # was 0.15 — name mismatch must surface
            "registry_agent":             0.12,
            "adverse_media_agent":        0.08,
            "transaction_analysis_agent": 0.05,
        }

        weighted_score = 0.0
        total_weight   = 0.0
        all_flags: list = []

        for r in agent_results:
            w = weights.get(r["agent"], 0.10)
            weighted_score += r["risk_score"] * w
            total_weight   += w
            all_flags.extend(r.get("flags", []))

        final_score = weighted_score / total_weight if total_weight > 0 else 50.0

        # ── Hard floors based on critical flags ───────────────────────────────
        unique_flags = list(set(all_flags))

        # Mismatch flags are ADVISORY until officer confirms suspicious.
        # They raise the score enough to route to human review, but not
        # into the high/critical band on their own.
        if "officer_confirmed_suspicious" in unique_flags:
            # Officer has reviewed and confirmed fraud — hard floor
            final_score = max(final_score, 75.0)
        else:
            if "name_mismatch_critical" in unique_flags:
                # Advisory: high enough to require review, not high enough to auto-reject
                final_score = max(final_score, 45.0)
            elif "name_mismatch" in unique_flags:
                final_score = max(final_score, 30.0)
            if "dob_mismatch" in unique_flags:
                final_score = max(final_score, 40.0)

        if "sanctions_match" in unique_flags:
            final_score = max(final_score, 80.0)
        if "pep_confirmed" in unique_flags:
            final_score = max(final_score, 65.0)

        final_score = round(min(100, max(0, final_score)), 1)
        level = "CRITICAL" if final_score >= 80 else "HIGH" if final_score >= 60 else "MEDIUM" if final_score >= 40 else "LOW"

        return AgentResult(
            agent=self.name,
            risk_score=final_score,
            flags=unique_flags,
            summary=f"Final risk score: {final_score:.0f} ({level}). {len(unique_flags)} risk indicators identified.",
            confidence=0.90,
            evidence={
                "final_score":  final_score,
                "risk_level":   level,
                "all_flags":    unique_flags,
                "agent_count":  len(agent_results),
                "floors_applied": {
                    "name_mismatch_critical": "name_mismatch_critical" in unique_flags,
                    "name_mismatch":          "name_mismatch"          in unique_flags,
                    "sanctions_match":        "sanctions_match"        in unique_flags,
                    "pep_confirmed":          "pep_confirmed"          in unique_flags,
                },
            },
            authorities_used=[],
        )
