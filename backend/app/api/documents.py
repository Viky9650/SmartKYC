from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional
import uuid, os

from app.db.session import get_db
from app.db.models import Document, DocumentExtraction, Case
from app.services.document_service import extract_document, DOCUMENT_SCHEMAS
from app.core.config import settings

router = APIRouter()

ALLOWED_MIME_TYPES = {
    "image/jpeg", "image/png", "image/webp", "image/gif",
    "application/pdf", "image/tiff",
}


@router.post("/upload/{case_id}")
async def upload_document(
    case_id: str,
    file: UploadFile = File(...),
    document_type: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
):

    # Check case
    result = await db.execute(select(Case).where(Case.id == case_id))
    case = result.scalar_one_or_none()
    if not case:
        raise HTTPException(404, "Case not found")

    doc_id = str(uuid.uuid4())

    ext = os.path.splitext(file.filename or "file.jpg")[1] or ".jpg"
    safe_name = f"{doc_id}{ext}"

    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    file_path = os.path.join(settings.UPLOAD_DIR, safe_name)

    content = await file.read()

    with open(file_path, "wb") as f:
        f.write(content)

    # Run extraction
    extraction = await extract_document(
        file_path=file_path,
        filename=file.filename or safe_name,
        document_type_hint=document_type,
    )

    schema_key = extraction.get("document_schema", "GENERIC_DOCUMENT")
    schema = DOCUMENT_SCHEMAS.get(schema_key, {})

    # Store the FULL extraction object so dashboard/detail pages can read
    # full_name, document_type, country, issuer, overall_confidence, extraction_method
    extracted_data = {
        "fields":              extraction.get("fields", {}),
        "confidences":         extraction.get("confidences", {}),
        "document_schema":     schema_key,
        "document_type":       extraction.get("document_type", schema.get("document_type", "")),
        "country":             extraction.get("country", schema.get("country", "")),
        "issuer":              extraction.get("issuer", schema.get("issuer", "")),
        "full_name":           extraction.get("full_name", ""),
        "overall_confidence":  extraction.get("overall_confidence", 0),
        "extraction_method":   extraction.get("extraction_method", ""),
        "document_quality":    extraction.get("document_quality", ""),
        "notes":               extraction.get("notes", ""),
    }

    doc = Document(
        id=doc_id,
        case_id=case_id,
        filename=safe_name,
        original_filename=file.filename,
        file_path=file_path,
        file_size=len(content),
        mime_type=file.content_type,
        document_type=schema_key,
        country_of_issue=extraction.get("country", schema.get("country")),
        extraction_status="done",
        extracted_data=extracted_data,
    )

    db.add(doc)

    # Save fields separately
    for field_name, field_value in extracted_data["fields"].items():
        if field_value:
            confidence = extracted_data["confidences"].get(field_name, 0.8)

            db.add(
                DocumentExtraction(
                    id=str(uuid.uuid4()),
                    document_id=doc_id,
                    case_id=case_id,
                    field_name=field_name,
                    field_value=str(field_value),
                    confidence=confidence,
                )
            )

    await db.commit()
    await db.refresh(doc)

    return {
        "document_id":   doc.id,
        "document_type": doc.document_type,
        "extracted_data": doc.extracted_data,
        "extraction":    extracted_data,   # NewCasePage reads result.extraction
        "filename":      doc.original_filename,
        "file_size":     doc.file_size,
    }


@router.get("/{document_id}/extractions")
async def get_extractions(document_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(DocumentExtraction).where(
            DocumentExtraction.document_id == document_id
        )
    )

    extractions = result.scalars().all()

    return [
        {
            "field": e.field_name,
            "value": e.field_value,
            "confidence": e.confidence,
        }
        for e in extractions
    ]