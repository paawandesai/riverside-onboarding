"""Chat orchestration: model call (when available) wrapped in deterministic checks.

Order of authority, highest first:
  1. deterministic safety detection (distress keywords) - can only ADD a restriction
  2. server-side validation of the model's structured output
  3. the model's suggestion
When the model is unavailable, a rule-based classifier keeps the flow working.
"""

import hashlib
import hmac
import re
from dataclasses import dataclass, field

from app.config import get_settings
from app.services import llm, support

MAX_TURNS = 20
MAX_MESSAGE_CHARS = 1000
MAX_FIELD_CHARS = 300
MAX_REPLY_CHARS = 600

AI_DISCLOSURE = "You're chatting with an AI assistant. A member of our care team reviews your answers before your visit."

# Crisis language in common forms, including indirect ones ("better off without me", "no point").
# Erring towards a false alarm is deliberate: a match only adds crisis resources to the reply.
_DISTRESS = re.compile(
    r"\b(suicid\w*|kill (?:my|him|her)self|end (?:it all|my life)|self[- ]?harm|hurt(?:ing)? myself|"
    r"(?:want|wanna|wish(?: i)?) (?:to )?(?:die|be dead|was dead|were dead)|better off (?:dead|without me)|"
    r"don'?t want to (?:live|be here|wake up)|(?:no|don'?t see the|what'?s the) point (?:of|in|to)? ?(?:living|going on|any of this|anything)|"
    r"hopeless|can'?t go on|can'?t cope|can'?t take (?:it|this|much more)(?: anymore)?|(?:it'?s|everything is) too much|"
    r"can'?t stop (?:crying|shaking)|crying all day|panic attacks?|overwhelmed|terrified|(?:really|so|very) (?:scared|frightened)|"
    r"in crisis|no one to talk to|don'?t know who to talk to)\b",
    re.I,
)
_RESCHEDULE = re.compile(
    r"\b(reschedul\w*|(?:move|push|switch|change) (?:back )?(?:my|the) (?:appointment|appt|time|visit|booking)|cancel\w*|"
    r"can'?t make (?:it|my|the|\w+day)|(?:booked|picked) the wrong (?:day|time)|(?:earlier|later) than the time|another day)\b",
    re.I,
)
_QUESTION = re.compile(r"(\?\s*$)|^\s*(how|what|when|where|why|who|can|do|does|is|are|will)\b", re.I)
# The fallback only answers questions about the clinic or sign-up; other questions are out of scope.
_CLINIC_TOPIC = re.compile(
    r"\b(clinic|hours?|open|walk[- ]?ins?|parking|insurance|cost|pay|visit|appointment|sign(?:ing)?[- ]?up|"
    r"information|privacy|data|doctor|nurse|staff|bring|telehealth|location|address|after|next|form|consent|delete|"
    r"medicaid|medicare|answers|bot|human|real person|weekends?|first day|come in with me)\b",
    re.I,
)
_DETAILS = re.compile(
    r"\b(pain|ache|cough|fever|rash|check[- ]?up|physical|follow[- ]?up|refill|since|for (?:a|two|three|\d+) "
    r"(?:day|week|month|year)s?|telehealth|video|in person|wheelchair|interpreter|hearing|anxiety|sleep|headache|injur\w*)\b",
    re.I,
)
_TELEHEALTH = re.compile(r"\b(telehealth|video|virtual|online|phone visit)\b", re.I)
_IN_PERSON = re.compile(r"\b(in[- ]person|in the clinic|come in|office visit)\b", re.I)
_DURATION = re.compile(
    r"\b(?:for|since|about|past)\s+((?:a|an|one|two|three|four|five|six|\d+)\s+(?:day|week|month|year)s?|yesterday|last \w+)\b", re.I
)
# Links of any shape: schemes (including defanged hxxp), www., markdown links and images, bare
# domains such as evil.example/login, defanged or full-width dots (evil[.]example, evil。example) and
# bare IP addresses. The last label of a bare domain must be all lower or all upper case, so
# "Dr.Smith" stays; a stripped dotted word is a small price for never showing a link.
_DOT = r"(?:\.|\[\.\]|\(\.\)|\{\.\}|[\u3002\uff0e\uff61])"
_URL = re.compile(
    r"(\b(?:h[tx]{2}ps?|ftp)://\S+|\bwww" + _DOT + r"\S+|!\[[^\]]*\]\([^)]*\)|\[[^\]]*\]\([^)]*\)|"
    r"\b\d{1,3}(?:" + _DOT + r"\d{1,3}){3}(?::\d+)?(?:/\S*)?|"
    r"\b(?:[a-z0-9-]+" + _DOT + r")+(?-i:[a-z]{2,24}|[A-Z]{2,24})\b(?:/\S*)?)",
    re.I,
)
# Any wording that claims an appointment was made, changed or cancelled. Only the scheduling API can do
# that, so a reply matching this is replaced with a fixed one.
_DONE = r"(?:booked|confirmed|scheduled|cancel+ed|moved|set|reserved|rescheduled|locked in|held|changed)"
_COMMITMENT = re.compile(
    r"\b(?:i|we)(?:'ve| have| had|'ll| will|'m| am)?\s+(?:just\s+|now\s+|already\s+|(?:gone|went) ahead and\s+)?"
    r"(?:booked|scheduled|confirmed|cancel+ed|rescheduled|reserved|moved|set up|put you|locked|got you)\b|"
    r"\b(?:went|gone) (?:ahead )?and\b|"
    r"\b(?:booked|scheduled|reserved|confirmed|rescheduled|moved) you\b|"
    r"\byou(?:'re|r| are)\s+(?:all\s+)?(?:set|booked|confirmed|scheduled)\b|"
    # "Your visit on Tuesday is confirmed", "The appointment for Tuesday is booked", "appointment's been moved"
    r"\b(?:appointment|visit|booking|slot)s?\b[^.!?\n]{0,40}?(?:\b(?:is|are|has|have|was|were)\b|'s)\s+"
    r"(?:now\s+|all\s+|been\s+|now been\s+|just been\s+)*" + _DONE + r"\b|"
    r"\b(?:appointment|visit|booking|slot)s?\s*:?\s+" + _DONE + r"\b|"
    r"\b(?:is|are|has been)\s+(?:now\s+)?(?:reserved|booked|held|saved|confirmed)\s+for you\b|"
    r"\b(?:got|have|put|pencil+ed|marked|written) you (?:down|in)\b|"
    r"\bconsider it (?:booked|done|scheduled|confirmed|sorted)\b|"
    r"(?:^|[.!]\s*)(?:booked|scheduled|confirmed|done)[!.,]?\s+(?:you|for|at|on)\b|"
    r"\bsee you (?:on |at |next |tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)",
    re.I,
)

FALLBACK_REPLIES = {
    "provide_details": "Thanks, I've noted that. Is there anything else about why you'd like a visit, or do you prefer in person or telehealth?",
    "ask_question": "That's a good question for our care team. You can keep going with sign-up, and they can answer it at your visit.",
    "request_reschedule": "You can change or cancel your appointment on the scheduling screen. I'll open it for you.",
    "express_distress": "",  # replaced by the fixed safety message below
    "out_of_scope": "I can only help with signing up and booking a visit. Could you tell me a bit about why you'd like to be seen?",
}
SAFETY_REPLY = (
    "I'm sorry you're going through this. If you're in danger or thinking about hurting yourself, "
    "please call or text 988 now, or call 911. You can pause sign-up any time."
)
MANUAL_HINT = "The assistant is temporarily unavailable. You can keep going with the form below; what you've typed stays on this page."


@dataclass
class ChatResult:
    mode: str  # "ai" | "fallback"
    intent: str
    reply: str
    fields: dict = field(default_factory=dict)
    support: dict | None = None
    ui_action: str | None = None
    notice: str | None = None
    disclosure: str = AI_DISCLOSURE


class ChatInputError(ValueError):
    pass


def _reply_key() -> bytes:
    return hmac.new(get_settings().session_secret.get_secret_value().encode(), b"chat-reply-signature", hashlib.sha256).digest()


def sign_reply(user_id: str, reply: str) -> str:
    """A signature the browser sends back with each assistant turn, so it can't invent earlier replies."""
    return hmac.new(_reply_key(), f"{user_id}\n{reply}".encode(), hashlib.sha256).hexdigest()


def trusted_history(turns: list[dict], user_id: str) -> list[dict]:
    """Keep patient turns and only those assistant turns this server actually sent to this user.

    The browser holds the conversation (transcripts aren't stored), so an assistant turn without a
    valid signature is a forgery attempt or a stale copy; either way it never reaches the model.
    """
    kept = []
    for turn in turns:
        if turn.get("role") == "assistant":
            sig, content = turn.get("sig"), turn.get("content")
            if (
                not isinstance(sig, str)
                or not isinstance(content, str)
                or not hmac.compare_digest(sig.encode(), sign_reply(user_id, content).encode())
            ):
                continue
        kept.append({"role": turn.get("role"), "content": turn.get("content")})
    return kept


def validate_history(history: list[dict]) -> list[dict]:
    if not history:
        raise ChatInputError("Please type a message.")
    clean = []
    for turn in history[-MAX_TURNS:]:
        role, content = turn.get("role"), turn.get("content")
        if role not in ("user", "assistant") or not isinstance(content, str):
            raise ChatInputError("Malformed chat history.")
        clean.append({"role": role, "content": content.strip()[:MAX_MESSAGE_CHARS]})
    # The API needs the conversation to start with a user turn and end with one.
    while clean and clean[0]["role"] != "user":
        clean.pop(0)
    if not clean or clean[-1]["role"] != "user" or not clean[-1]["content"]:
        raise ChatInputError("Please type a message.")
    return clean


def detect_distress(text: str) -> bool:
    return bool(_DISTRESS.search(text))


def rule_based_turn(text: str) -> llm.LlmTurn:
    if detect_distress(text):
        intent = "express_distress"
    elif _RESCHEDULE.search(text):
        intent = "request_reschedule"
    elif _DETAILS.search(text):
        intent = "provide_details"
    elif _QUESTION.search(text) and _CLINIC_TOPIC.search(text):
        intent = "ask_question"
    else:
        intent = "out_of_scope"
    fields = {"reason_for_visit": None, "symptom_duration": None, "visit_type_preference": None, "accessibility_needs": None}
    if intent == "provide_details":
        fields["reason_for_visit"] = text[:MAX_FIELD_CHARS]
        if m := _DURATION.search(text):
            fields["symptom_duration"] = m.group(1)
        if _TELEHEALTH.search(text):
            fields["visit_type_preference"] = "telehealth"
        elif _IN_PERSON.search(text):
            fields["visit_type_preference"] = "in_person"
    return llm.LlmTurn(intent=intent, fields=fields, reply=FALLBACK_REPLIES[intent])


def sanitize_fields(raw: dict) -> dict:
    out = {}
    for key in ("reason_for_visit", "symptom_duration", "accessibility_needs"):
        value = raw.get(key)
        if isinstance(value, str) and value.strip():
            out[key] = _URL.sub("", value).strip()[:MAX_FIELD_CHARS]
    vt = raw.get("visit_type_preference")
    if vt in llm.VISIT_TYPES:
        out["visit_type_preference"] = vt
    return out


def sanitize_reply(reply: str, intent: str) -> str:
    text = _URL.sub("", reply or "").replace("*", "").replace("#", "").strip()
    if not text or _COMMITMENT.search(text):
        # The model claimed it booked/changed something; only the scheduling API can do that.
        return FALLBACK_REPLIES.get(intent) or FALLBACK_REPLIES["out_of_scope"]
    return text[:MAX_REPLY_CHARS]


def run_turn(history: list[dict]) -> ChatResult:
    clean = validate_history(history)
    latest = clean[-1]["content"]
    keyword_distress = detect_distress(latest)

    mode, notice = "ai", None
    try:
        turn = llm.classify_turn(clean)
        if turn.intent not in llm.INTENTS:
            raise llm.LlmUnavailable("invalid_intent")
    except llm.LlmUnavailable:
        mode, notice = "fallback", MANUAL_HINT
        turn = rule_based_turn(latest)

    intent = turn.intent
    # One-way safety: keywords can add distress handling; the model cannot remove it.
    distress = keyword_distress or intent == "express_distress"
    if distress:
        intent = "express_distress"

    result = ChatResult(
        mode=mode,
        intent=intent,
        reply=SAFETY_REPLY if distress else sanitize_reply(turn.reply, intent),
        fields={} if distress else sanitize_fields(turn.fields),
        notice=notice,
    )
    if distress:
        result.support = support.content_for(support.Signals(distress=True))
    if intent == "request_reschedule":
        # Never free model text here: a reschedule reply is where a false "I've moved it" would do harm.
        result.reply = FALLBACK_REPLIES["request_reschedule"]
        result.ui_action = "open_scheduling"
    return result


def assessment_summary(fields: dict) -> str:
    """Deterministic, non-binding summary for staff review (no model involved)."""
    labels = {
        "reason_for_visit": "Reason for visit (patient's words)",
        "symptom_duration": "How long",
        "visit_type_preference": "Visit type preference",
        "accessibility_needs": "Accessibility needs",
    }
    lines = [f"{labels[k]}: {fields.get(k) or 'not provided'}" for k in labels]
    return "Non-binding intake summary for staff review. Not a diagnosis or triage decision.\n" + "\n".join(lines)
