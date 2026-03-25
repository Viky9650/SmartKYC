from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from contextlib import asynccontextmanager
import logging

from app.core.config import settings
from app.core.logging import setup_logging
from app.db.session import init_db
from app.api import cases, documents, reviews, investigations, authorities

setup_logging()
logger = logging.getLogger(__name__)


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

app.include_router(cases.router, prefix="/api/cases", tags=["cases"])
app.include_router(documents.router, prefix="/api/documents", tags=["documents"])
app.include_router(reviews.router, prefix="/api/reviews", tags=["reviews"])
app.include_router(investigations.router, prefix="/api/investigations", tags=["investigations"])
app.include_router(authorities.router, prefix="/api/authorities", tags=["authorities"])


@app.get("/health")
async def health():
    return {"status": "ok", "service": "SmartKYC"}
