"""Small in-process rate limits for the endpoints that cost money or memory.

Counts live in each worker's memory, so the effective limit is per worker (the container runs two,
on up to two replicas). That is enough to stop password guessing, invite-code guessing and someone
burning the model budget from one session; it is not a distributed quota.
"""

import threading
import time
from collections import deque
from collections.abc import Callable

from fastapi import HTTPException, Request

from app.config import get_settings


class SlidingWindow:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def allow(self, key: str, limit: int, window_seconds: float) -> bool:
        now = time.monotonic()
        with self._lock:
            hits = self._hits.setdefault(key, deque())
            while hits and hits[0] <= now - window_seconds:
                hits.popleft()
            if len(hits) >= limit:
                return False
            hits.append(now)
            # Drop idle keys now and then so the table can't grow without bound.
            if len(self._hits) > 50_000:
                self._hits = {k: v for k, v in self._hits.items() if v and v[-1] > now - 3600}
            return True

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


_window = SlidingWindow()


def reset() -> None:
    _window.reset()


def client_ip(request: Request) -> str:
    """The caller's address. Behind the platform proxy, the last X-Forwarded-For hop is the one it added."""
    hops = get_settings().forwarded_ip_hops
    if hops > 0:
        forwarded = [p.strip() for p in request.headers.get("x-forwarded-for", "").split(",") if p.strip()]
        if len(forwarded) >= hops:
            return forwarded[-hops]
    return request.client.host if request.client else "unknown"


def check(name: str, key: str, limit: int, window_seconds: float) -> None:
    if not get_settings().rate_limits_enabled:
        return
    if not _window.allow(f"{name}:{key}", limit, window_seconds):
        raise HTTPException(
            status_code=429,
            detail="Too many attempts. Please wait a minute and try again.",
            headers={"Retry-After": str(int(window_seconds))},
        )


def per_ip(name: str, limit: int, window_seconds: float) -> Callable[[Request], None]:
    """A dependency that limits calls to `limit` per `window_seconds` from one address."""

    def dependency(request: Request) -> None:
        check(name, client_ip(request), limit, window_seconds)

    return dependency
