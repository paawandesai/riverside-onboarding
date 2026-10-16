import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.logging_config import log_event
from app.models import FunnelEvent, User
from app.routers.intake import require_consent
from app.services import chat, support

logger = logging.getLogger("app.chat")
router = APIRouter(prefix="/api", tags=["assistant"])


class ChatTurn(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(max_length=4000)


class ChatIn(BaseModel):
    messages: list[ChatTurn] = Field(min_length=1, max_length=60)


class ChatOut(BaseModel):
    mode: str
    intent: str
    reply: str
    fields: dict
    support: dict | None
    ui_action: str | None
    notice: str | None
    disclosure: str


@router.post("/chat", response_model=ChatOut)
def chat_turn(body: ChatIn, user: User = Depends(require_consent)) -> ChatOut:
    """Transcripts are not stored: the client holds the conversation and sends it each turn."""
    try:
        result = chat.run_turn([t.model_dump() for t in body.messages])
    except chat.ChatInputError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    log_event(logger, "chat_turn", component="chat", mode=result.mode, intent=result.intent, user_id=user.id)
    return ChatOut(**vars(result))


class SignalsIn(BaseModel):
    idle_seconds: float = Field(default=0, ge=0, le=86400)
    upload_failed: bool = False
    ocr_low_confidence: bool = False
    booking_conflicts: int = Field(default=0, ge=0, le=100)
    distress: bool = False
    llm_unavailable: bool = False


@router.post("/support/evaluate")
def evaluate_support(body: SignalsIn) -> dict:
    """Returns {"content": card} for the highest-priority active trigger, or {"content": null}."""
    content = support.content_for(support.Signals(**body.model_dump()))
    if content:
        log_event(logger, "support_shown", component="support", trigger=content["trigger"])
    return {"content": content}


class EventIn(BaseModel):
    anon_session_id: uuid.UUID
    step_id: str = Field(pattern="^[a-z_]{2,32}$")
    event: str = Field(pattern="^[a-z_]{2,32}$")


@router.post("/events", status_code=204)
def record_event(body: EventIn, db: Session = Depends(get_db)) -> None:
    """First-party funnel analytics: anonymous session id, step and event name only."""
    db.add(FunnelEvent(anon_session_id=str(body.anon_session_id), step_id=body.step_id, event=body.event))
    db.commit()
