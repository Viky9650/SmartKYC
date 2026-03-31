from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from pydantic import BaseModel
from typing import Optional, List
import uuid
from datetime import datetime

from app.db.session import get_db
from app.db.models import HumanReview, Case

router = APIRouter()

VALID_DECISIONS = ["approved", "rejected", "on_hold", "escalated", "request_documents"]


class ReviewCreate(BaseModel):
    case_id: str
    decision: str
    comments: Optional[str] = None
    reviewer_name: Optional[str] = "Compliance Officer"
    risk_override: Optional[float] = None


@router.post("/")
async def submit_review(data: ReviewCreate, db: AsyncSession = Depends(get_db)):
    if data.decision not in VALID_DECISIONS:
        raise HTTPException(400, f"Invalid decision. Must be one of: {VALID_DECISIONS}")

    # Update case status
    result = await db.execute(select(Case).where(Case.id == data.case_id))
    case = result.scalar_one_or_none()
    if not case:
        raise HTTPException(404, "Case not found")

    status_map = {
        "approved": "cleared",
        "rejected": "rejected",
        "on_hold": "on_hold",
        "escalated": "escalated",
        "request_documents": "pending_documents",
    }
    case.status = status_map.get(data.decision, "review")

    if data.risk_override is not None:
        case.risk_score = data.risk_override

    review = HumanReview(
        id=str(uuid.uuid4()),
        case_id=data.case_id,
        reviewer_name=data.reviewer_name or "Compliance Officer",
        decision=data.decision,
        comments=data.comments,
        risk_override=data.risk_override,
        reviewed_at=datetime.utcnow(),
    )
    db.add(review)
    await db.commit()

    return {"message": "Review submitted", "review_id": review.id, "case_status": case.status}


@router.get("/queue")
async def get_review_queue(
    sort: str = "date",
    db: AsyncSession = Depends(get_db),
):
    """
    Get cases pending human review.
    sort=date  -> newest first (default)
    sort=risk  -> highest risk score first
    """
    order = desc(Case.created_at) if sort == "date" else desc(Case.risk_score)
    result = await db.execute(
        select(Case)
        .where(Case.status.in_(["review", "on_hold", "escalated", "pending_documents"]))
        .order_by(order)
    )
    cases = result.scalars().all()
    return [
        {
            "id": c.id,
            "case_number": c.case_number,
            "subject_name": c.subject_name,
            "subject_type": c.subject_type,
            "nationality": c.nationality,
            "risk_score": c.risk_score,
            "risk_level": c.risk_level,
            "status": c.status,
            "created_at": c.created_at.isoformat() if c.created_at else None,
            "investigation_plan": c.investigation_plan,
        }
        for c in cases
    ]


@router.get("/history/{case_id}")
async def get_review_history(case_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(HumanReview).where(HumanReview.case_id == case_id).order_by(desc(HumanReview.reviewed_at))
    )
    reviews = result.scalars().all()
    return [
        {
            "id": r.id,
            "reviewer_name": r.reviewer_name,
            "decision": r.decision,
            "comments": r.comments,
            "risk_override": r.risk_override,
            "reviewed_at": r.reviewed_at.isoformat() if r.reviewed_at else None,
        }
        for r in reviews
    ]
