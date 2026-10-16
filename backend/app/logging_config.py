"""PII-free structured logging.

Log records carry only an allow-listed set of fields (ids, status codes, timings,
field-level success flags). Free text from users, documents, or the model never
reaches a log line: anything outside the allow-list is dropped, not redacted.
"""

import json
import logging
import sys
import time

ALLOWED_FIELDS = {
    "event",
    "request_id",
    "method",
    "route",
    "status",
    "duration_ms",
    "user_id",
    "component",
    "outcome",
    "fields_found",
    "fields_missing",
    "error_type",
    "mode",
    "intent",
    "trigger",
    "model",
}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(record.created)),
            "level": record.levelname,
            "logger": record.name,
            # The message itself is a fixed event name, never interpolated user data.
            "msg": record.msg if isinstance(record.msg, str) else "non-string-message",
        }
        extra = getattr(record, "safe", None) or {}
        for key, value in extra.items():
            if key in ALLOWED_FIELDS:
                payload[key] = value
        if record.exc_info:
            # Exception type only: messages and tracebacks can echo request data.
            payload["error_type"] = record.exc_info[0].__name__ if record.exc_info[0] else None
        return json.dumps(payload, default=str)


def configure_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(logging.INFO)
    # Access logs include query strings; our middleware logs requests instead.
    logging.getLogger("uvicorn.access").disabled = True


def log_event(logger: logging.Logger, event: str, level: int = logging.INFO, **fields) -> None:
    logger.log(level, event, extra={"safe": {"event": event, **fields}})
