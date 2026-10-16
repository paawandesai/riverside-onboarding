"""In-process last-success / last-failure timestamps for dependencies.

The health endpoint reports these instead of making live calls (no model quota spent).
"""

from datetime import UTC, datetime

_state: dict[str, dict[str, str | None]] = {}


def _entry(component: str) -> dict[str, str | None]:
    return _state.setdefault(component, {"last_success": None, "last_failure": None})


def record_success(component: str) -> None:
    _entry(component)["last_success"] = datetime.now(UTC).isoformat()


def record_failure(component: str) -> None:
    _entry(component)["last_failure"] = datetime.now(UTC).isoformat()


def snapshot(component: str) -> dict[str, str | None]:
    return dict(_entry(component))
