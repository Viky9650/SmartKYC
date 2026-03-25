from pydantic_settings import BaseSettings
from typing import List
import os


class Settings(BaseSettings):
    APP_NAME: str = "SmartKYC"
    DEBUG: bool = False
    SECRET_KEY: str = "smartkyc-secret-change-in-production"

    DATABASE_URL: str = "sqlite+aiosqlite:///./smartkyc.db"

    CORS_ORIGINS: List[str] = ["http://localhost:5173", "http://localhost:3000"]

    # ── LLM ───────────────────────────────────────────────────────────────────
    # Options: gemini | anthropic | openai
    LLM_PROVIDER: str = "gemini"

    GEMINI_API_KEY: str = ""
    # gemini-2.0-flash supports vision + is fast + cheap
    GEMINI_MODEL: str = "gemini-2.0-flash"
    # Vision model — same model supports multimodal
    GEMINI_VISION_MODEL: str = "gemini-2.0-flash"

    ANTHROPIC_API_KEY: str = ""
    ANTHROPIC_MODEL: str = "claude-sonnet-4-20250514"

    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4o"

    # ── Files ─────────────────────────────────────────────────────────────────
    UPLOAD_DIR: str = "./uploads"
    MAX_FILE_SIZE_MB: int = 20

    # ── Verification ──────────────────────────────────────────────────────────
    USE_MOCK_VERIFICATION: bool = True

    OFAC_API_KEY: str = ""
    WORLD_CHECK_API_KEY: str = ""
    WORLD_CHECK_API_SECRET: str = ""
    COMPANIES_HOUSE_API_KEY: str = ""
    OPEN_CORPORATES_API_KEY: str = ""
    LEXISNEXIS_API_KEY: str = ""

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
