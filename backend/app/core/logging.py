import logging
import logging.handlers
import sys
from datetime import datetime
from pathlib import Path


LOG_DIR      = Path("./logs")
CHAT_LOG_DIR = LOG_DIR / "chat"

# Loggers that are too verbose at DEBUG — cap them at WARNING
_NOISY_LOGGERS = [
    "aiosqlite",
    "sqlalchemy.engine",
    "sqlalchemy.engine.Engine",
    "sqlalchemy.pool",
    "sqlalchemy.dialects",
    "PIL",
    "PIL.PngImagePlugin",
    "PIL.TiffImagePlugin",
    "urllib3",
    "httpx",
    "httpcore",
    "uvicorn.access",
    "uvicorn.error",
    "google.auth",
    "google.generativeai",
]


def setup_logging():
    LOG_DIR.mkdir(exist_ok=True)
    CHAT_LOG_DIR.mkdir(exist_ok=True)

    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")

    today    = datetime.utcnow().strftime("%Y-%m-%d")
    log_file = LOG_DIR / f"smartkyc-{today}.log"

    # File: INFO and above for app logs, WARNING for noisy third-party libs
    file_handler = logging.handlers.TimedRotatingFileHandler(
        filename=log_file,
        when="midnight",
        interval=1,
        backupCount=14,
        encoding="utf-8",
        utc=True,
    )
    file_handler.setFormatter(fmt)
    file_handler.setLevel(logging.DEBUG)  # handler accepts everything; loggers filter

    # Console: INFO and above
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(fmt)
    console_handler.setLevel(logging.INFO)

    # Root logger at INFO (not DEBUG — stops aiosqlite flooding the file)
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.handlers.clear()
    root.addHandler(file_handler)
    root.addHandler(console_handler)

    # Explicitly silence known noisy loggers
    for name in _NOISY_LOGGERS:
        logging.getLogger(name).setLevel(logging.WARNING)

    # App loggers at DEBUG so our own code is fully traced in the file
    for name in ["app", "app.services", "app.agents", "app.api", "app.db"]:
        logging.getLogger(name).setLevel(logging.DEBUG)

    logging.getLogger(__name__).info(
        f"SmartKYC logging ready — {log_file.resolve()}"
    )
