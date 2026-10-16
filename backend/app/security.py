import hashlib
import hmac
import json
from datetime import UTC, datetime

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from cryptography.fernet import Fernet, InvalidToken
from fastapi import Depends, HTTPException, Request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import AuditLog, User

SESSION_COOKIE = "onboarding_session"
SESSION_MAX_AGE_SECONDS = 60 * 60 * 8

_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except VerifyMismatchError:
        return False


def email_lookup_key(email: str) -> str:
    secret = get_settings().session_secret.get_secret_value().encode()
    return hmac.new(secret, email.strip().lower().encode(), hashlib.sha256).hexdigest()


def _fernet() -> Fernet:
    return Fernet(get_settings().field_encryption_key.get_secret_value().encode())


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
        return None


def encrypt_json(value: dict | None) -> bytes | None:
    return None if value is None else encrypt_str(json.dumps(value))


def decrypt_json(token: bytes | None) -> dict | None:
    raw = decrypt_str(token)
    return None if raw is None else json.loads(raw)


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(get_settings().session_secret.get_secret_value(), salt="session")


def make_session_token(user_id: str) -> str:
    return _serializer().dumps({"uid": user_id})


def read_session_token(token: str) -> str | None:
    try:
        data = _serializer().loads(token, max_age=SESSION_MAX_AGE_SECONDS)
    except (BadSignature, SignatureExpired):
        return None
    return data.get("uid")


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = request.cookies.get(SESSION_COOKIE)
    user_id = read_session_token(token) if token else None
    user = db.get(User, user_id) if user_id else None
    if user is None:
        raise HTTPException(status_code=401, detail="Please sign in.")
    request.state.user_id = user.id
    return user


def require_staff(user: User = Depends(current_user)) -> User:
    if user.role != "staff":
        raise HTTPException(status_code=403, detail="Staff access only.")
    return user


def audit(db: Session, action: str, actor_user_id: str | None, subject_user_id: str | None) -> None:
    db.add(AuditLog(action=action, actor_user_id=actor_user_id, subject_user_id=subject_user_id, at=datetime.now(UTC)))
