"""Supportive content at friction points.

Deterministic: a trigger condition either holds or it doesn't, and content is only
returned when one holds. Copy lives in app/content/support.json (written by hand,
not generated).
"""

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

IDLE_SECONDS_THRESHOLD = 45
CONTENT_PATH = Path(__file__).resolve().parent.parent / "content" / "support.json"

# Highest priority first: safety outranks everything else.
TRIGGER_PRIORITY = ("distress", "upload_failed", "ocr_low_confidence", "booking_conflict", "long_pause")


@dataclass
class Signals:
    idle_seconds: float = 0
    upload_failed: bool = False
    ocr_low_confidence: bool = False
    booking_conflict: bool = False
    distress: bool = False


@lru_cache
def _content() -> dict:
    return json.loads(CONTENT_PATH.read_text())


def active_triggers(signals: Signals) -> list[str]:
    active = {
        "distress": signals.distress,
        "upload_failed": signals.upload_failed,
        "ocr_low_confidence": signals.ocr_low_confidence,
        "booking_conflict": signals.booking_conflict,
        "long_pause": signals.idle_seconds >= IDLE_SECONDS_THRESHOLD,
    }
    return [t for t in TRIGGER_PRIORITY if active[t]]


def content_for(signals: Signals) -> dict | None:
    """The single most relevant content card, or None when no trigger holds."""
    triggers = active_triggers(signals)
    if not triggers:
        return None
    trigger = triggers[0]
    return {"trigger": trigger, **_content()[trigger]}
