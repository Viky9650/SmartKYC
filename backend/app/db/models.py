from sqlalchemy import Column, String, Integer, Float, DateTime, JSON, Text, ForeignKey, Boolean
from sqlalchemy.orm import DeclarativeBase, relationship
from datetime import datetime
import uuid


def gen_id():
    return str(uuid.uuid4())


class Base(DeclarativeBase):
    pass


class Case(Base):
    __tablename__ = "cases"

    id = Column(String, primary_key=True, default=gen_id)
    case_number = Column(String, unique=True, nullable=False)
    subject_name = Column(String, nullable=False)
    subject_type = Column(String)  # individual, company_director, pep, corporate
    date_of_birth = Column(String)
    nationality = Column(String)
    notes = Column(Text)
    status = Column(String, default="pending")  # pending, investigating, review, cleared, rejected, on_hold
    risk_score = Column(Float, default=0)
    risk_level = Column(String, default="unknown")  # low, medium, high, critical
    investigation_plan = Column(JSON)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    documents = relationship("Document", back_populates="case", cascade="all, delete-orphan")
    agent_results = relationship("AgentResult", back_populates="case", cascade="all, delete-orphan")
    verification_sources = relationship("VerificationSource", back_populates="case", cascade="all, delete-orphan")
    human_reviews = relationship("HumanReview", back_populates="case", cascade="all, delete-orphan")
    events = relationship("InvestigationEvent", back_populates="case", cascade="all, delete-orphan")


class Document(Base):
    __tablename__ = "documents"

    id = Column(String, primary_key=True, default=gen_id)
    case_id = Column(String, ForeignKey("cases.id"), nullable=False)
    filename = Column(String, nullable=False)
    original_filename = Column(String)
    file_path = Column(String, nullable=False)
    file_size = Column(Integer)
    mime_type = Column(String)
    document_type = Column(String)  # passport, national_id, drivers_license, company_reg, etc.
    country_of_issue = Column(String)
    extraction_status = Column(String, default="pending")  # pending, processing, done, failed
    extracted_data = Column(JSON)  # structured extracted fields
    raw_text = Column(Text)
    uploaded_at = Column(DateTime, default=datetime.utcnow)

    case = relationship("Case", back_populates="documents")
    extractions = relationship("DocumentExtraction", back_populates="document", cascade="all, delete-orphan")


class DocumentExtraction(Base):
    __tablename__ = "document_extractions"

    id = Column(String, primary_key=True, default=gen_id)
    document_id = Column(String, ForeignKey("documents.id"), nullable=False)
    case_id = Column(String)
    field_name = Column(String)
    field_value = Column(Text)
    confidence = Column(Float)
    verified = Column(Boolean, default=False)

    document = relationship("Document", back_populates="extractions")


class AgentResult(Base):
    __tablename__ = "agent_results"

    id = Column(String, primary_key=True, default=gen_id)
    case_id = Column(String, ForeignKey("cases.id"), nullable=False)
    agent_name = Column(String, nullable=False)
    risk_score = Column(Float, default=0)
    flags = Column(JSON, default=list)
    summary = Column(Text)
    confidence = Column(Float)
    evidence = Column(JSON)
    status = Column(String, default="pending")  # pending, running, done, failed
    started_at = Column(DateTime)
    completed_at = Column(DateTime)

    case = relationship("Case", back_populates="agent_results")


class VerificationSource(Base):
    __tablename__ = "verification_sources"

    id = Column(String, primary_key=True, default=gen_id)
    case_id = Column(String, ForeignKey("cases.id"), nullable=False)
    source_name = Column(String, nullable=False)
    source_type = Column(String)  # sanctions, pep, registry, identity, media
    result = Column(String)  # clear, flagged, partial_match, error
    result_detail = Column(JSON)
    is_mock = Column(Boolean, default=True)
    checked_at = Column(DateTime, default=datetime.utcnow)

    case = relationship("Case", back_populates="verification_sources")


class HumanReview(Base):
    __tablename__ = "human_reviews"

    id = Column(String, primary_key=True, default=gen_id)
    case_id = Column(String, ForeignKey("cases.id"), nullable=False)
    reviewer_id = Column(String, default="compliance_officer")
    reviewer_name = Column(String, default="Compliance Officer")
    decision = Column(String)  # approved, rejected, on_hold, escalated, request_documents
    comments = Column(Text)
    risk_override = Column(Float)
    reviewed_at = Column(DateTime, default=datetime.utcnow)

    case = relationship("Case", back_populates="human_reviews")


class InvestigationEvent(Base):
    __tablename__ = "investigation_events"

    id = Column(String, primary_key=True, default=gen_id)
    case_id = Column(String, ForeignKey("cases.id"), nullable=False)
    event_type = Column(String)  # created, document_uploaded, agent_started, agent_completed, etc.
    event_data = Column(JSON)
    message = Column(Text)
    timestamp = Column(DateTime, default=datetime.utcnow)

    case = relationship("Case", back_populates="events")
