from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.services import health_state, ocr

router = APIRouter(prefix="/api", tags=["system"])


# HEAD answers too, for uptime monitors that probe with it (kept out of the API schema).
@router.head("/health", include_in_schema=False)
@router.get("/health")
def health(db: Session = Depends(get_db)) -> dict:
    """Configuration and last-success timestamps. Never calls the model or decrypts secrets."""
    settings = get_settings()
    try:
        db.execute(text("SELECT 1"))
        database = "ok"
    except Exception:  # noqa: BLE001 - report, don't raise
        database = "unreachable"
    tesseract = ocr.tesseract_version()
    status = "ok" if database == "ok" and tesseract else "degraded"
    return {
        "status": status,
        "app": {"env": settings.app_env, "demo_mode": settings.demo_mode},
        "database": database,
        "ocr": {"engine": "tesseract", "version": tesseract, **health_state.snapshot("ocr")},
        "llm": {
            "configured": settings.llm_enabled,
            "model": settings.anthropic_model if settings.llm_enabled else None,
            "mode": "ai_with_fallback" if settings.llm_enabled else "fallback_only",
            **health_state.snapshot("llm"),
        },
    }
