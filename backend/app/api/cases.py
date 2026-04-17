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
    limit: int = 500,
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



class CaseUpdate(BaseModel):
    subject_name: Optional[str] = None
    subject_type: Optional[str] = None
    date_of_birth: Optional[str] = None
    nationality: Optional[str] = None
    notes: Optional[str] = None


@router.patch("/{case_id}", response_model=CaseResponse)
async def update_case(case_id: str, data: CaseUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Case).where(Case.id == case_id))
    case = result.scalar_one_or_none()
    if not case:
        raise HTTPException(404, "Case not found")
    if data.subject_name is not None:
        case.subject_name = data.subject_name
    if data.subject_type is not None:
        case.subject_type = data.subject_type
    if data.date_of_birth is not None:
        case.date_of_birth = data.date_of_birth
    if data.nationality is not None:
        case.nationality = data.nationality
    if data.notes is not None:
        case.notes = data.notes
    await db.commit()
    await db.refresh(case)
    return _to_response(case)


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


class CorrectIdentityRequest(BaseModel):
    action: str                         # 'confirm_document' | 'flag_suspicious'
    notes: Optional[str] = None
    correct_name: Optional[str] = None
    correct_dob: Optional[str] = None
    correct_nationality: Optional[str] = None


@router.patch("/{case_id}/correct-identity")
async def correct_identity(
    case_id: str,
    data: CorrectIdentityRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Officer action after reviewing an identity discrepancy.

    action='confirm_document'  → update case fields with corrected values
                                  and re-run risk aggregation.
    action='flag_suspicious'   → mark the identity agent result with
                                  'officer_confirmed_suspicious' and rescore.
    """
    from app.agents.agents import RiskAggregationAgent
    from sqlalchemy.orm.attributes import flag_modified

    result = await db.execute(select(Case).where(Case.id == case_id))
    case = result.scalar_one_or_none()
    if not case:
        raise HTTPException(404, "Case not found")

    # ── 1. Apply field corrections ───────────────────────────────────────────
    if data.action == "confirm_document":
        if data.correct_name:
            case.subject_name = data.correct_name
        if data.correct_dob:
            case.date_of_birth = data.correct_dob
        if data.correct_nationality:
            case.nationality = data.correct_nationality

    # ── 2. Update identity agent flags in DB ────────────────────────────────
    agents_r = await db.execute(
        select(AgentResult).where(AgentResult.case_id == case_id)
    )
    agents_list = agents_r.scalars().all()

    identity_agent = next(
        (a for a in agents_list if a.agent_name == "identity_agent"), None
    )
    if identity_agent:
        current_flags = list(identity_agent.flags or [])
        if data.action == "flag_suspicious":
            if "officer_confirmed_suspicious" not in current_flags:
                current_flags.append("officer_confirmed_suspicious")
            # Raise identity agent score to reflect officer finding
            identity_agent.risk_score = max(identity_agent.risk_score or 0, 75.0)
        else:
            # Officer confirmed it was a data-entry error — clear mismatch flags
            current_flags = [
                f for f in current_flags
                if f not in ("name_mismatch", "name_mismatch_critical", "dob_mismatch")
            ]
        identity_agent.flags = current_flags
        flag_modified(identity_agent, "flags")
        if data.action == "flag_suspicious":
            flag_modified(identity_agent, "risk_score")

    # ── 3. Re-run risk aggregation using current agent results ───────────────
    agent_result_dicts = [
        {
            "agent":      a.agent_name,
            "risk_score": a.risk_score or 0,
            "flags":      a.flags or [],
            "summary":    a.summary or "",
            "confidence": a.confidence or 0,
            "evidence":   a.evidence or {},
        }
        for a in agents_list
        if a.agent_name != "risk_aggregation_agent"
    ]

    if agent_result_dicts:
        subject = {
            "subject_name":  case.subject_name,
            "subject_type":  case.subject_type or "",
            "nationality":   case.nationality or "",
            "date_of_birth": case.date_of_birth or "",
            "_agent_results": agent_result_dicts,
        }
        final = await RiskAggregationAgent(case_id, subject).run()
        case.risk_score = final.risk_score
        case.risk_level = (
            "critical" if final.risk_score >= 80 else
            "high"     if final.risk_score >= 60 else
            "medium"   if final.risk_score >= 40 else "low"
        )

    # ── 4. Add an investigation event to record the officer action ────────────
    db.add(InvestigationEvent(
        id=str(uuid.uuid4()),
        case_id=case_id,
        event_type="officer_identity_action",
        event_data={
            "action":     data.action,
            "notes":      data.notes or "",
            "new_name":   data.correct_name,
            "new_dob":    data.correct_dob,
            "new_nationality": data.correct_nationality,
            "new_risk_score":  case.risk_score,
        },
        message=f"Officer action: {data.action}. New risk score: {case.risk_score:.0f}",
    ))

    await db.commit()
    return {
        "updated": True,
        "risk_score": case.risk_score,
        "risk_level": case.risk_level,
        "subject_name": case.subject_name,
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


class ReinvestigateRequest(BaseModel):
    subject_name: Optional[str] = None
    subject_type: Optional[str] = None
    date_of_birth: Optional[str] = None
    nationality: Optional[str] = None
    notes: Optional[str] = None


@router.post("/{case_id}/reinvestigate")
async def reinvestigate(
    case_id: str,
    data: ReinvestigateRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Update case details and re-run the full investigation from scratch."""
    result = await db.execute(select(Case).where(Case.id == case_id))
    case = result.scalar_one_or_none()
    if not case:
        raise HTTPException(404, "Case not found")

    # Prevent re-run if already investigating
    if case.status == "investigating":
        raise HTTPException(409, "Investigation already in progress")

    # Apply any field updates
    if data.subject_name is not None:
        case.subject_name = data.subject_name
    if data.subject_type is not None:
        case.subject_type = data.subject_type
    if data.date_of_birth is not None:
        case.date_of_birth = data.date_of_birth
    if data.nationality is not None:
        case.nationality = data.nationality
    if data.notes is not None:
        case.notes = data.notes

    # Clear previous agent results, verification sources, and events
    await db.execute(
        AgentResult.__table__.delete().where(AgentResult.case_id == case_id)
    )
    await db.execute(
        VerificationSource.__table__.delete().where(VerificationSource.case_id == case_id)
    )

    # Log re-investigation trigger event
    db.add(InvestigationEvent(
        id=str(uuid.uuid4()),
        case_id=case_id,
        event_type="reinvestigation_triggered",
        event_data={"reason": "officer_edit", "updated_fields": data.model_dump(exclude_none=True)},
        message="Re-investigation triggered by officer after case detail update.",
    ))

    case.risk_score = 0
    case.risk_level = "unknown"
    case.status = "pending"
    await db.commit()

    background_tasks.add_task(_run_investigation_bg, case_id)
    return {"message": "Re-investigation started", "case_id": case_id}


async def _run_investigation_bg(case_id: str):
    from app.db.session import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        try:
            await run_investigation(case_id, db)
        except Exception as e:
            import logging
            logging.getLogger(__name__).error(f"Investigation failed for {case_id}: {e}", exc_info=True)


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
