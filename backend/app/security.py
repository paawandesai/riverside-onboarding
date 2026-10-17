import hashlib
import hmac
import json
import logging
import threading
from datetime import UTC, datetime
from functools import lru_cache

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from fastapi import Depends, HTTPException, Request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.logging_config import log_event
from app.models import AuditLog, User

logger = logging.getLogger("app.security")

SESSION_COOKIE = "onboarding_session"
SESSION_MAX_AGE_SECONDS = 60 * 60 * 8

_hasher = PasswordHasher()
# Each Argon2 hash takes 64 MiB; cap how many run at once so a burst of logins can't exhaust memory.
_HASH_SLOTS = threading.BoundedSemaphore(4)


def hash_password(password: str) -> str:
    with _HASH_SLOTS:
        return _hasher.hash(password)


@lru_cache
def _dummy_hash() -> str:
    return _hasher.hash("timing-equaliser-not-a-real-password")


def verify_password(password_hash: str | None, password: str) -> bool:
    """Check a password. With no hash (unknown email) it still does the work, so timing doesn't reveal accounts."""
    target = password_hash or _dummy_hash()
    with _HASH_SLOTS:
        try:
            ok = _hasher.verify(target, password)
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            return False
    return ok and password_hash is not None


def needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


def email_lookup_key(email: str) -> str:
    secret = get_settings().email_hmac_key.get_secret_value().encode()
    return hmac.new(secret, email.strip().lower().encode(), hashlib.sha256).hexdigest()


@lru_cache
def _fernet() -> MultiFernet:
    keys = [k.strip() for k in get_settings().field_encryption_key.get_secret_value().split(",") if k.strip()]
    return MultiFernet([Fernet(k.encode()) for k in keys])


def validate_keys() -> None:
    """Fail at startup, not on the first signup, if a key is malformed."""
    settings = get_settings()
    _fernet()
    if len(settings.email_hmac_key.get_secret_value()) < 32 or len(settings.session_secret.get_secret_value()) < 32:
        raise ValueError("SESSION_SECRET and EMAIL_HMAC_KEY must each be at least 32 characters.")
    if settings.email_hmac_key.get_secret_value() == settings.session_secret.get_secret_value():
        raise ValueError("EMAIL_HMAC_KEY must differ from SESSION_SECRET.")


def encrypt_str(value: str | None) -> bytes | None:
    if value is None:
        return None
    return _fernet().encrypt(value.encode())


def decrypt_str(token: bytes | None) -> str | None:
    if token is None:
        return None
    try:
        return _fernet().decrypt(token).decode()
    except InvalidToken:
        # A wrong or missing key would otherwise look like blank fields; make it visible in the logs.
        log_event(logger, "decrypt_failed", logging.ERROR, error_type="InvalidToken")
        return None


def encrypt_json(value: dict | None) -> bytes | None:
    return None if value is None else encrypt_str(json.dumps(value))


def decrypt_json(token: bytes | None) -> dict | None:
    raw = decrypt_str(token)
    return None if raw is None else json.loads(raw)


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(get_settings().session_secret.get_secret_value(), salt="session")


def make_session_token(user: User) -> str:
    return _serializer().dumps({"uid": user.id, "sv": user.session_version})


def read_session_token(token: str) -> tuple[str, int] | None:
    try:
        data = _serializer().loads(token, max_age=SESSION_MAX_AGE_SECONDS)
    except (BadSignature, SignatureExpired):
        return None
    if not isinstance(data, dict) or not isinstance(data.get("uid"), str) or not isinstance(data.get("sv"), int):
        return None
    return data["uid"], data["sv"]


def end_sessions(user: User) -> None:
    """Invalidate every session token issued to this user so far (sign-out, withdrawal, rotation)."""
    user.session_version = (user.session_version or 0) + 1


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = request.cookies.get(SESSION_COOKIE)
    session = read_session_token(token) if token else None
    user = db.get(User, session[0]) if session else None
    if user is None or session is None or user.session_version != session[1]:
        raise HTTPException(status_code=401, detail="Please sign in.")
    request.state.user_id = user.id
    return user


def require_staff(user: User = Depends(current_user)) -> User:
    if user.role != "staff":
        raise HTTPException(status_code=403, detail="Staff access only.")
    return user


def audit(db: Session, action: str, actor_user_id: str | None, subject_user_id: str | None) -> None:
    db.add(AuditLog(action=action, actor_user_id=actor_user_id, subject_user_id=subject_user_id, at=datetime.now(UTC)))
