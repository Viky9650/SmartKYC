from fastapi import APIRouter
from app.services.verification_service import VERIFICATION_AUTHORITIES, get_authorities_for_subject
from app.core.config import settings

router = APIRouter()


@router.get("/")
async def list_authorities():
    result = []
    for key, auth in VERIFICATION_AUTHORITIES.items():
        api_key_env = auth.get("api_key_env")
        has_key = bool(getattr(settings, api_key_env, "")) if api_key_env else True
        result.append({
            "key": key,
            "name": auth["name"],
            "full_name": auth["full_name"],
            "type": auth["type"],
            "country": auth["country"],
            "description": auth["description"],
            "is_free": auth["is_free"],
            "url": auth["url"],
            "mock_mode": settings.USE_MOCK_VERIFICATION,
            "api_configured": has_key,
            "real_api_endpoint": auth.get("real_api_endpoint"),
        })
    return result


@router.get("/by-subject")
async def get_authorities_for(
    subject_type: str = "individual",
    nationality: str = "",
    document_types: str = "",
):
    docs = [d.strip() for d in document_types.split(",") if d.strip()] if document_types else []
    keys = get_authorities_for_subject(subject_type, nationality, docs)
    return {
        "keys": keys,
        "authorities": [
            {"key": k, "name": VERIFICATION_AUTHORITIES[k]["name"], "type": VERIFICATION_AUTHORITIES[k]["type"]}
            for k in keys if k in VERIFICATION_AUTHORITIES
        ],
    }
