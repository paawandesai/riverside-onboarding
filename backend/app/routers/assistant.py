import logging
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.logging_config import log_event
from app.models import FunnelEvent, User
from app.ratelimit import check, per_ip
from app.routers.intake import require_consent
from app.services import chat, support

logger = logging.getLogger("app.chat")
router = APIRouter(prefix="/api", tags=["assistant"])


class ChatTurn(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(max_length=4000)
    # Assistant turns carry the signature the server returned with them; unsigned ones are dropped.
    sig: str | None = Field(default=None, pattern="^[0-9a-f]{64}$")


class ChatIn(BaseModel):
    # The browser sends the last 20 turns (chat.MAX_TURNS); 20 x 4000 characters stays under the
    # 512 KB JSON limit even in 4-byte scripts.
    messages: list[ChatTurn] = Field(min_length=1, max_length=20)


class SupportActionOut(BaseModel):
    # The id is what the app acts on; the label is only shown, so copy can change or be translated.
    id: Literal["talk_to_person", "continue", "try_again", "use_form", "type_instead", "check_details", "see_other_times", "save_and_leave"]
    label: str


class SupportCardOut(BaseModel):
    trigger: str
    title: str
    body: str
    actions: list[SupportActionOut]
    urgent: bool


class SupportOut(BaseModel):
    content: SupportCardOut | None


class ChatFieldsOut(BaseModel):
    reason_for_visit: str | None = None
    symptom_duration: str | None = None
    visit_type_preference: Literal["in_person", "telehealth", "no_preference"] | None = None
    accessibility_needs: str | None = None


class ChatOut(BaseModel):
    mode: Literal["ai", "fallback"]
    intent: str
    reply: str
    fields: ChatFieldsOut
    support: SupportCardOut | None
    ui_action: str | None
    notice: str | None
    disclosure: str
    reply_sig: str


@router.post("/chat", response_model=ChatOut)
def chat_turn(body: ChatIn, user: User = Depends(require_consent)) -> ChatOut:
    """Transcripts are not stored: the client holds the conversation and sends it each turn."""
    # Each turn may spend model credit, so one account gets a steady conversational pace, not a flood.
    check("chat", user.id, 20, 60)
    try:
        result = chat.run_turn(chat.trusted_history([t.model_dump() for t in body.messages], user.id))
    except chat.ChatInputError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    log_event(logger, "chat_turn", component="chat", mode=result.mode, intent=result.intent, user_id=user.id)
    return ChatOut(**vars(result), reply_sig=chat.sign_reply(user.id, result.reply))


class SignalsIn(BaseModel):
    idle_seconds: float = Field(default=0, ge=0, le=86400)
    upload_failed: bool = False
    ocr_low_confidence: bool = False
    booking_conflicts: int = Field(default=0, ge=0, le=100)
    distress: bool = False
    llm_unavailable: bool = False


@router.post("/support/evaluate", response_model=SupportOut, dependencies=[Depends(per_ip("support", 60, 60))])
def evaluate_support(body: SignalsIn) -> dict:
    """Returns {"content": card} for the highest-priority active trigger, or {"content": null}."""
    content = support.content_for(support.Signals(**body.model_dump()))
    if content:
        log_event(logger, "support_shown", component="support", trigger=content["trigger"])
    return {"content": content}


# Only the steps and events the app itself sends, so anonymous callers can't invent rows that show up
# on the staff analytics page.
EVENT_STEPS = {
    "start", "account", "consent", "chat", "details", "confirm", "book", "done", "privacy", "saved", "deleted",
    "front_desk", "staff", "staff_analytics", "staff_patient", "other",
}  # fmt: skip
EVENT_NAMES = {"viewed"} | {f"support_{trigger}" for trigger in support.TRIGGER_PRIORITY}


class EventIn(BaseModel):
    anon_session_id: uuid.UUID
    step_id: str = Field(pattern="^[a-z_]{2,32}$")
    event: str = Field(pattern="^[a-z_]{2,32}$")


@router.post("/events", status_code=204, dependencies=[Depends(per_ip("events", 120, 60))])
def record_event(body: EventIn, db: Session = Depends(get_db)) -> None:
    """First-party funnel analytics: anonymous session id, step and event name only."""
    if body.step_id not in EVENT_STEPS or body.event not in EVENT_NAMES:
        raise HTTPException(status_code=422, detail="Unknown step or event.")
    db.add(FunnelEvent(anon_session_id=str(body.anon_session_id), step_id=body.step_id, event=body.event))
    db.commit()
