from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.session import get_db
from app.db.models import Case, AgentResult, VerificationSource
from app.services.verification_service import VERIFICATION_AUTHORITIES
from app.core.config import settings

router = APIRouter()


@router.get("/{case_id}/status")
async def get_investigation_status(case_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Case).where(Case.id == case_id))
    case = result.scalar_one_or_none()
    if not case:
        raise HTTPException(404, "Case not found")

    agents_r = await db.execute(select(AgentResult).where(AgentResult.case_id == case_id))
    agents = agents_r.scalars().all()
    verif_r = await db.execute(select(VerificationSource).where(VerificationSource.case_id == case_id))
    verif = verif_r.scalars().all()

    return {
        "case_id": case_id,
        "status": case.status,
        "risk_score": case.risk_score,
        "risk_level": case.risk_level,
        "agent_count": len(agents),
        "agents_done": sum(1 for a in agents if a.status == "done"),
        "verification_count": len(verif),
    }
