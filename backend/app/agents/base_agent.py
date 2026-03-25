from abc import ABC, abstractmethod
from typing import Dict, Any, List, Optional
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


class AgentResult:
    def __init__(
        self,
        agent: str,
        risk_score: float,
        flags: List[str],
        summary: str,
        confidence: float,
        evidence: Optional[Dict] = None,
        authorities_used: Optional[List[str]] = None,
    ):
        self.agent = agent
        self.risk_score = risk_score
        self.flags = flags
        self.summary = summary
        self.confidence = confidence
        self.evidence = evidence or {}
        self.authorities_used = authorities_used or []
        self.timestamp = datetime.utcnow().isoformat()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "agent": self.agent,
            "risk_score": self.risk_score,
            "flags": self.flags,
            "summary": self.summary,
            "confidence": self.confidence,
            "evidence": self.evidence,
            "authorities_used": self.authorities_used,
            "timestamp": self.timestamp,
        }


class BaseAgent(ABC):
    name: str = "base_agent"
    description: str = ""

    def __init__(self, case_id: str, subject: Dict[str, Any]):
        self.case_id = case_id
        self.subject = subject
        self.logger = logging.getLogger(f"agent.{self.name}")

    @abstractmethod
    async def run(self) -> AgentResult:
        pass

    def _score_to_level(self, score: float) -> str:
        if score >= 80:
            return "critical"
        if score >= 60:
            return "high"
        if score >= 40:
            return "medium"
        return "low"
