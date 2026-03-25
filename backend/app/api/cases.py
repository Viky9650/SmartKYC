from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import uuid

from app.db.session import get_db
from app.db.models import Case, AgentResult, VerificationSource, InvestigationEvent, HumanReview, Document
from app.services.investigation_service import run_investigation

router = APIRouter()


def _case_number():
    return f"KYC-{datetime.utcnow().year}-{str(uuid.uuid4())[:4].upper()}"


class CaseCreate(BaseModel):
    subject_name: str
    subject_type: Optional[str] = "individual"
    date_of_birth: Optional[str] = None
    nationality: Optional[str] = None
    notes: Optional[str] = None


class CaseResponse(BaseModel):
    id: str
    case_number: str
    subject_name: str
    subject_type: Optional[str]
    date_of_birth: Optional[str]
    nationality: Optional[str]
    notes: Optional[str]
    status: str
    risk_score: float
    risk_level: str
    created_at: str

    class Config:
        from_attributes = True


@router.post("/", response_model=CaseResponse)
async def create_case(data: CaseCreate, db: AsyncSession = Depends(get_db)):
    case = Case(
        id=str(uuid.uuid4()),
        case_number=_case_number(),
        subject_name=data.subject_name,
        subject_type=data.subject_type,
        date_of_birth=data.date_of_birth,
        nationality=data.nationality,
        notes=data.notes,
        status="pending",
        risk_score=0,
        risk_level="unknown",
    )
    db.add(case)
    await db.commit()
    await db.refresh(case)
    return _to_response(case)


@router.get("/", response_model=List[CaseResponse])
async def list_cases(
    status: Optional[str] = None,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
):
    q = select(Case).order_by(desc(Case.created_at)).limit(limit)
    if status:
        q = q.where(Case.status == status)
    result = await db.execute(q)
    cases = result.scalars().all()
    return [_to_response(c) for c in cases]


@router.get("/dashboard/summary")
async def get_dashboard_summary(limit: int = 10, db: AsyncSession = Depends(get_db)):
    """
    Lightweight dashboard endpoint — returns recent cases each with their
    first document extraction summary and top agent flags.
    """
    cases_result = await db.execute(
        select(Case).order_by(desc(Case.created_at)).limit(limit)
    )
    cases = cases_result.scalars().all()

    rows = []
    for c in cases:
        doc_result = await db.execute(
            select(Document).where(Document.case_id == c.id).limit(1)
        )
        doc = doc_result.scalar_one_or_none()

        agents_result = await db.execute(
            select(AgentResult).where(AgentResult.case_id == c.id)
        )
        agents = agents_result.scalars().all()

        extraction_summary = None
        if doc and doc.extracted_data:
            ed = doc.extracted_data
            fields = ed.get("fields", {})
            extraction_summary = {
                "document_type":      ed.get("document_type", doc.document_type or ""),
                "country":            ed.get("country", doc.country_of_issue or ""),
                "issuer":             ed.get("issuer", ""),
                "full_name":          ed.get("full_name") or fields.get("full_name") or fields.get("name", ""),
                "date_of_birth":      fields.get("date_of_birth", ""),
                "nationality":        fields.get("nationality", ""),
                "document_number": (
                    fields.get("passport_number") or fields.get("aadhaar_number")
                    or fields.get("pan_number") or fields.get("id_number")
                    or fields.get("document_number", "")
                ),
                "date_of_expiry":     fields.get("date_of_expiry", ""),
                "issuing_country":    fields.get("issuing_country", ""),
                "sex":                fields.get("sex", ""),
                "overall_confidence": ed.get("overall_confidence", 0),
                "extraction_method":  ed.get("extraction_method", ""),
                "key_fields": [
                    {
                        "label": k.replace("_", " ").title(),
                        "value": str(v),
                        "confidence": ed.get("confidences", {}).get(k, 0),
                    }
                    for k, v in fields.items()
                    if v and not k.startswith("_")
                ][:8],
            }

        all_flags = list({f for a in agents for f in (a.flags or [])})
        rows.append({
            **_to_response(c),
            "document_extraction": extraction_summary,
            "agent_count": len(agents),
            "top_flags":   all_flags[:6],
        })

    return rows



@router.get("/{case_id}")
async def get_case(case_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Case).where(Case.id == case_id))
    case = result.scalar_one_or_none()
    if not case:
        raise HTTPException(404, "Case not found")

    # Load related data
    agents_r = await db.execute(select(AgentResult).where(AgentResult.case_id == case_id))
    agents = agents_r.scalars().all()

    verif_r = await db.execute(select(VerificationSource).where(VerificationSource.case_id == case_id))
    verif = verif_r.scalars().all()

    docs_r = await db.execute(select(Document).where(Document.case_id == case_id))
    docs = docs_r.scalars().all()

    events_r = await db.execute(
        select(InvestigationEvent).where(InvestigationEvent.case_id == case_id).order_by(InvestigationEvent.timestamp)
    )
    events = events_r.scalars().all()

    reviews_r = await db.execute(select(HumanReview).where(HumanReview.case_id == case_id))
    reviews = reviews_r.scalars().all()

    return {
        "case": _to_response(case),
        "investigation_plan": case.investigation_plan,
        "agents": [_agent_to_dict(a) for a in agents],
        "verification_sources": [_verif_to_dict(v) for v in verif],
        "documents": [_doc_to_dict(d) for d in docs],
        "events": [_event_to_dict(e) for e in events],
        "reviews": [_review_to_dict(r) for r in reviews],
    }


@router.post("/{case_id}/start-investigation")
async def start_investigation(
    case_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Case).where(Case.id == case_id))
    case = result.scalar_one_or_none()
    if not case:
        raise HTTPException(404, "Case not found")

    background_tasks.add_task(_run_investigation_bg, case_id)
    return {"message": "Investigation started", "case_id": case_id}


async def _run_investigation_bg(case_id: str):
    from app.db.session import AsyncSessionLocal
    from sqlalchemy import select as _select
    _log = __import__("logging").getLogger(__name__)
    async with AsyncSessionLocal() as db:
        try:
            await run_investigation(case_id, db)
        except Exception as e:
            _log.error(f"Investigation failed for {case_id}: {e}", exc_info=True)
            # Always move the case out of "investigating" so the UI doesn't hang.
            # Use a fresh query on this session — the case object from run_investigation
            # may be in a rolled-back/detached state after an exception.
            try:
                res = await db.execute(_select(Case).where(Case.id == case_id))
                case = res.scalar_one_or_none()
                if case and case.status == "investigating":
                    case.status = "review"   # route to human review even on partial failure
                    case.risk_level = case.risk_level or "unknown"
                    await db.commit()
                    _log.info(f"Case {case_id} status set to 'review' after investigation error")
            except Exception as inner:
                _log.error(f"Could not update case status after failure: {inner}")


@router.patch("/{case_id}/correct-identity")
async def correct_identity(
    case_id: str,
    data: dict,
    db: AsyncSession = Depends(get_db),
):
    """
    Officer confirms the document name/DOB is correct and the case
    registration had a typo — OR confirms the mismatch is genuinely suspicious.

    Body:
      { "action": "confirm_document" | "flag_suspicious",
        "correct_name": "...",        # optional — update case subject_name
        "correct_dob":  "DD/MM/YYYY", # optional — update case date_of_birth
        "notes": "..." }
    """
    result = await db.execute(select(Case).where(Case.id == case_id))
    case = result.scalar_one_or_none()
    if not case:
        raise HTTPException(404, "Case not found")

    action = data.get("action")
    if action not in ("confirm_document", "flag_suspicious"):
        raise HTTPException(400, "action must be confirm_document or flag_suspicious")

    from app.db.models import AgentResult as AgentResultModel, InvestigationEvent
    import json as _json
    from datetime import datetime as _dt

    if action == "confirm_document":
        # Officer says: the document is genuine, I just mis-typed the details
        # Update case fields to match the document
        if data.get("correct_name"):
            case.subject_name = data["correct_name"]
        if data.get("correct_dob"):
            case.date_of_birth = data["correct_dob"]
        if data.get("correct_nationality"):
            case.nationality = data["correct_nationality"]

        # Remove mismatch flags from agent results and recalculate risk score
        agents_r = await db.execute(
            select(AgentResultModel).where(AgentResultModel.case_id == case_id)
        )
        agents = agents_r.scalars().all()
        mismatch_flags = {"name_mismatch_critical", "name_mismatch", "dob_mismatch"}

        for agent in agents:
            if agent.agent_name == "identity_agent":
                cleaned_flags = [f for f in (agent.flags or []) if f not in mismatch_flags]
                agent.flags = cleaned_flags
                # Recalculate identity score without mismatch
                agent.risk_score = 60.0 if "identity_verification_failed" in cleaned_flags else 15.0
                agent.summary = (
                    "Identity confirmed by compliance officer — data entry correction applied. "
                    + (data.get("notes") or "")
                ).strip()

            if agent.agent_name == "risk_aggregation_agent":
                cleaned_flags = [f for f in (agent.flags or []) if f not in mismatch_flags]
                agent.flags = cleaned_flags
                # Recalculate aggregated score (simple: rebuild from sibling agents)
                # We recalculate here rather than re-running the full pipeline
                weights = {
                    "sanctions_agent": 0.30, "pep_agent": 0.20,
                    "identity_agent": 0.25, "registry_agent": 0.12,
                    "adverse_media_agent": 0.08, "transaction_analysis_agent": 0.05,
                }
                weighted = 0.0; total_w = 0.0
                for a2 in agents:
                    if a2.agent_name == "risk_aggregation_agent":
                        continue
                    w = weights.get(a2.agent_name, 0.10)
                    score = a2.risk_score if a2.agent_name != "identity_agent" else (
                        60.0 if "identity_verification_failed" in (a2.flags or []) else 15.0
                    )
                    weighted += score * w; total_w += w
                new_score = round(weighted / total_w if total_w else 50.0, 1)
                agent.risk_score = new_score
                agent.flags = cleaned_flags

        # Recalculate case-level score from updated agents
        all_scores = [
            a.risk_score for a in agents if a.agent_name != "risk_aggregation_agent"
        ]
        weights = {
            "sanctions_agent": 0.30, "pep_agent": 0.20,
            "identity_agent": 0.25, "registry_agent": 0.12,
            "adverse_media_agent": 0.08, "transaction_analysis_agent": 0.05,
        }
        weighted = sum(
            a.risk_score * weights.get(a.agent_name, 0.10)
            for a in agents if a.agent_name != "risk_aggregation_agent"
        )
        total_w = sum(
            weights.get(a.agent_name, 0.10)
            for a in agents if a.agent_name != "risk_aggregation_agent"
        )
        new_case_score = round(weighted / total_w if total_w else case.risk_score, 1)
        case.risk_score = new_case_score
        case.risk_level = (
            "critical" if new_case_score >= 80 else
            "high"     if new_case_score >= 60 else
            "medium"   if new_case_score >= 40 else "low"
        )
        message = (
            f"Data entry correction: case name/DOB updated to match document. "
            f"Mismatch flags cleared. New risk score: {new_case_score}."
        )

    else:  # flag_suspicious
        # Officer confirms this IS a genuine mismatch — suspicious document
        # Keep flags, but add a human-confirmed marker so it's clear
        agents_r = await db.execute(
            select(AgentResultModel).where(AgentResultModel.case_id == case_id)
        )
        agents = agents_r.scalars().all()
        for agent in agents:
            if agent.agent_name == "identity_agent":
                flags = list(agent.flags or [])
                if "officer_confirmed_suspicious" not in flags:
                    flags.append("officer_confirmed_suspicious")
                agent.flags = flags
                agent.summary = (
                    agent.summary or ""
                ) + " [CONFIRMED SUSPICIOUS by compliance officer]"
            if agent.agent_name == "risk_aggregation_agent":
                flags = list(agent.flags or [])
                if "officer_confirmed_suspicious" not in flags:
                    flags.append("officer_confirmed_suspicious")
                agent.flags = flags
                # Apply hard floor
                agent.risk_score = max(agent.risk_score, 75.0)

        case.risk_score = max(case.risk_score, 75.0)
        case.risk_level = "high" if case.risk_score < 80 else "critical"
        message = "Officer confirmed identity mismatch as suspicious. Risk score elevated."

    # Log the correction event
    db.add(InvestigationEvent(
        case_id=case_id,
        event_type="identity_correction",
        event_data={
            "action": action,
            "correct_name": data.get("correct_name"),
            "correct_dob": data.get("correct_dob"),
            "correct_nationality": data.get("correct_nationality"),
            "notes": data.get("notes"),
            "new_risk_score": case.risk_score,
        },
        message=message,
    ))
    await db.commit()
    return {
        "message": message,
        "case_id": case_id,
        "new_risk_score": case.risk_score,
        "new_risk_level": case.risk_level,
        "subject_name": case.subject_name,
        "date_of_birth": case.date_of_birth,
        "nationality": case.nationality,
    }


@router.get("/{case_id}/events")
async def get_events(case_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(InvestigationEvent).where(InvestigationEvent.case_id == case_id).order_by(InvestigationEvent.timestamp)
    )
    return [_event_to_dict(e) for e in result.scalars().all()]


def _to_response(c: Case) -> dict:
    return {
        "id": c.id,
        "case_number": c.case_number,
        "subject_name": c.subject_name,
        "subject_type": c.subject_type,
        "date_of_birth": c.date_of_birth,
        "nationality": c.nationality,
        "notes": c.notes,
        "status": c.status,
        "risk_score": c.risk_score or 0,
        "risk_level": c.risk_level or "unknown",
        "created_at": c.created_at.isoformat() if c.created_at else "",
    }


def _agent_to_dict(a: AgentResult) -> dict:
    return {
        "id": a.id,
        "agent_name": a.agent_name,
        "risk_score": a.risk_score,
        "flags": a.flags or [],
        "summary": a.summary,
        "confidence": a.confidence,
        "evidence": a.evidence or {},
        "status": a.status,
        "completed_at": a.completed_at.isoformat() if a.completed_at else None,
    }


def _verif_to_dict(v: VerificationSource) -> dict:
    return {
        "id": v.id,
        "source_name": v.source_name,
        "source_type": v.source_type,
        "result": v.result,
        "result_detail": v.result_detail or {},
        "is_mock": v.is_mock,
        "checked_at": v.checked_at.isoformat() if v.checked_at else None,
    }


def _doc_to_dict(d) -> dict:
    return {
        "id": d.id,
        "filename": d.filename,
        "original_filename": d.original_filename,
        "document_type": d.document_type,
        "country_of_issue": d.country_of_issue,
        "extraction_status": d.extraction_status,
        "extracted_data": d.extracted_data or {},
        "uploaded_at": d.uploaded_at.isoformat() if d.uploaded_at else None,
    }


def _event_to_dict(e: InvestigationEvent) -> dict:
    return {
        "id": e.id,
        "event_type": e.event_type,
        "event_data": e.event_data or {},
        "message": e.message,
        "timestamp": e.timestamp.isoformat() if e.timestamp else None,
    }


def _review_to_dict(r: HumanReview) -> dict:
    return {
        "id": r.id,
        "reviewer_name": r.reviewer_name,
        "decision": r.decision,
        "comments": r.comments,
        "reviewed_at": r.reviewed_at.isoformat() if r.reviewed_at else None,
    }
