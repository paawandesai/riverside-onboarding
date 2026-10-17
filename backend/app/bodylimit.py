"""Refuse oversized request bodies before anything parses them.

The upload route allows the photo limit plus a little multipart overhead; every other API route
gets a small JSON-sized limit. Bodies without a Content-Length are counted as they stream in.
"""

import json

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.config import get_settings

UPLOAD_PATH = "/api/documents/extract"
JSON_LIMIT = 512 * 1024
MULTIPART_OVERHEAD = 64 * 1024


TOO_LARGE = "That upload is too large. Please choose a smaller photo."


class BodyTooLarge(Exception):
    pass


def limit_for(path: str) -> int:
    if path == UPLOAD_PATH:
        return get_settings().max_upload_mb * 1024 * 1024 + MULTIPART_OVERHEAD
    return JSON_LIMIT


async def _too_large(send: Send) -> None:
    body = json.dumps({"detail": TOO_LARGE}).encode()
    await send(
        {
            "type": "http.response.start",
            "status": 413,
            "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
        }
    )
    await send({"type": "http.response.body", "body": body})


class BodyLimitMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope["path"].startswith("/api/"):
            await self.app(scope, receive, send)
            return
        limit = limit_for(scope["path"])
        for name, value in scope.get("headers", []):
            if name == b"content-length":
                try:
                    too_big = int(value) > limit
                except ValueError:
                    too_big = True
                if too_big:
                    await _too_large(send)
                    return

        seen = 0
        started = False
        exceeded = False

        async def counted_receive() -> Message:
            nonlocal seen, exceeded
            message = await receive()
            if message["type"] == "http.request":
                seen += len(message.get("body", b""))
                if seen > limit:
                    exceeded = True
                    raise BodyTooLarge()
            return message

        async def tracked_send(message: Message) -> None:
            nonlocal started
            if exceeded:
                # A handler caught BodyTooLarge (form and JSON parsers wrap it in a 400 or 422);
                # answer with the 413 it stands for instead.
                if message["type"] == "http.response.start" and not started:
                    started = True
                    await _too_large(send)
                return
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, counted_receive, tracked_send)
        except BodyTooLarge:
            if not started:
                await _too_large(send)
