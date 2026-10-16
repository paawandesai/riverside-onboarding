import logging
import os
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.logging_config import configure_logging, log_event
from app.routers import assistant, auth, intake, privacy, scheduling, system
from app.services import llm

logger = logging.getLogger("app")


@asynccontextmanager
async def lifespan(_: FastAPI):
    configure_logging()
    llm.verify_model_at_startup()  # raises LlmConfigError on a bad model id or key
    yield


CSRF_HEADER = "X-Requested-With"
CSRF_VALUE = "onboarding-app"
# The SPA is built without inline scripts; blob: is for the ID photo preview.
CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; font-src 'self'; "
    "connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
)


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Patient Onboarding Assistant (demo)",
        lifespan=lifespan,
        # Interactive docs only in development (Swagger UI needs inline scripts the CSP blocks).
        docs_url="/api/docs" if settings.app_env == "development" else None,
        redoc_url=None,
        openapi_url="/api/openapi.json",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Content-Type", CSRF_HEADER],
    )

    @app.middleware("http")
    async def csrf_guard(request: Request, call_next):
        # Mutating API calls must carry a custom header. Browsers can't add one cross-site without a
        # CORS preflight, which only our own origins pass. Complements the SameSite=Lax cookie.
        if request.method in ("POST", "PUT", "PATCH", "DELETE") and request.url.path.startswith("/api/"):
            if request.headers.get(CSRF_HEADER) != CSRF_VALUE:
                return JSONResponse(status_code=403, content={"detail": "Please reload the page and try again."})
        return await call_next(request)

    @app.middleware("http")
    async def request_log(request: Request, call_next):
        request_id = str(uuid.uuid4())
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception as exc:  # noqa: BLE001 - last-resort guard, details never echoed
            log_event(logger, "unhandled_error", logging.ERROR, request_id=request_id, error_type=type(exc).__name__)
            response = JSONResponse(
                status_code=500, content={"detail": "Something went wrong on our side. Your progress is saved; please try again."}
            )
        route = request.scope.get("route")
        log_event(
            logger,
            "request",
            request_id=request_id,
            method=request.method,
            # Route template (e.g. /api/bookings/{booking_id}), never the raw path or query.
            route=getattr(route, "path", "unmatched"),
            status=response.status_code,
            duration_ms=int((time.perf_counter() - started) * 1000),
            user_id=getattr(request.state, "user_id", None),
        )
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        if not request.url.path.startswith("/api/docs"):
            response.headers["Content-Security-Policy"] = CSP
        response.headers["Permissions-Policy"] = "camera=(self), microphone=(), geolocation=()"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Cache-Control"] = "no-store"
        if settings.demo_mode:
            response.headers["X-Robots-Tag"] = "noindex, nofollow"
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError):
        # FastAPI's default echoes the submitted input back; return field + message only.
        errors = [
            {"field": ".".join(str(p) for p in e["loc"][1:]), "message": e["msg"].removeprefix("Value error, ")} for e in exc.errors()
        ]
        return JSONResponse(status_code=422, content={"detail": "Please check the highlighted fields.", "errors": errors})

    for router in (auth.router, privacy.router, intake.router, assistant.router, scheduling.router, system.router):
        app.include_router(router)
    # In the container the built frontend is served from the same origin (no CORS needed).
    if os.path.isdir(settings.static_dir):
        app.mount("/", StaticFiles(directory=settings.static_dir, html=True), name="frontend")
    return app


app = create_app()
