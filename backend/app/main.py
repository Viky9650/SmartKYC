from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging
import json as _json
from pathlib import Path as _Path

from app.core.config import settings
from app.core.logging import setup_logging
from app.db.session import init_db
from app.api import cases, documents, reviews, investigations, authorities

setup_logging()
logger = logging.getLogger(__name__)

_CHAT_DIR = _Path("./logs/chat")
_CHAT_DIR.mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("SmartKYC starting up...")
    await init_db()
    yield
    logger.info("SmartKYC shutting down...")


app = FastAPI(
    title="SmartKYC Compliance Platform",
    description="AI-powered KYC/AML investigation platform",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(cases.router,           prefix="/api/cases",          tags=["cases"])
app.include_router(documents.router,       prefix="/api/documents",      tags=["documents"])
app.include_router(reviews.router,         prefix="/api/reviews",        tags=["reviews"])
app.include_router(investigations.router,  prefix="/api/investigations", tags=["investigations"])
app.include_router(authorities.router,     prefix="/api/authorities",    tags=["authorities"])


@app.get("/health")
async def health():
    return {"status": "ok", "service": "SmartKYC"}


@app.get("/api/config")
async def get_frontend_config():
    """Exposes Gemini key + model from single .env to the frontend chat component."""
    return {
        "gemini_api_key": settings.GEMINI_API_KEY,
        "gemini_model":   settings.GEMINI_MODEL,
    }


# ── Chat history persistence ───────────────────────────────────────────────────

@app.get("/api/chat/history")
async def list_chat_sessions():
    """List all saved chat sessions, newest first."""
    sessions = []
    for f in sorted(_CHAT_DIR.glob("session-*.json"), reverse=True):
        try:
            data = _json.loads(f.read_text(encoding="utf-8"))
            msgs = data.get("messages", [])
            sessions.append({
                "session_id":    f.stem.replace("session-", ""),
                "started_at":    data.get("started_at", ""),
                "message_count": len(msgs),
                "last_message":  msgs[-1].get("content", "")[:120] if msgs else "",
                "cases_created": data.get("cases_created", []),
            })
        except Exception:
            pass
    return sessions


@app.get("/api/chat/history/{session_id}")
async def get_chat_session(session_id: str):
    """Load a specific chat session by id."""
    f = _CHAT_DIR / f"session-{session_id}.json"
    if not f.exists():
        raise HTTPException(404, "Session not found")
    return _json.loads(f.read_text(encoding="utf-8"))


@app.post("/api/chat/history")
async def save_chat_session(request: Request):
    """
    Save or update a chat session.
    Body: { session_id, started_at, messages: [...], cases_created: [...] }
    The endpoint merges with existing data so incremental saves work.
    """
    body = await request.json()
    session_id = body.get("session_id")
    if not session_id:
        raise HTTPException(400, "session_id required")

    f = _CHAT_DIR / f"session-{session_id}.json"
    existing: dict = {}
    if f.exists():
        try:
            existing = _json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            pass

    merged = {**existing, **body}
    f.write_text(_json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.debug(f"Chat session {session_id} saved ({len(body.get('messages', []))} messages)")
    return {"saved": True, "session_id": session_id}


@app.delete("/api/chat/history/{session_id}")
async def delete_chat_session(session_id: str):
    """Delete a chat session file."""
    f = _CHAT_DIR / f"session-{session_id}.json"
    if f.exists():
        f.unlink()
    return {"deleted": True}
