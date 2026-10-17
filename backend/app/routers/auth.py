import hmac

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import User
from app.ratelimit import check, client_ip, per_ip
from app.security import (
    SESSION_COOKIE,
    SESSION_MAX_AGE_SECONDS,
    current_user,
    email_lookup_key,
    encrypt_str,
    hash_password,
    make_session_token,
    needs_rehash,
    read_session_token,
    revoke_session,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


class SignupIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=10, max_length=128)
    invite_code: str = Field(min_length=1, max_length=64)
    adult_attestation: bool


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class MeOut(BaseModel):
    id: str
    role: str


def _set_session(response: Response, user: User) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        make_session_token(user),
        max_age=SESSION_MAX_AGE_SECONDS,
        httponly=True,
        secure=get_settings().secure_cookies,
        samesite="lax",
        path="/",
    )


def _invite_ok(code: str) -> bool:
    # Bytes, so any Unicode input compares safely; every code is checked so timing doesn't reveal which matched.
    given = code.encode()
    matches = [hmac.compare_digest(given, valid.encode()) for valid in get_settings().invite_code_set]
    return any(matches)


_DUPLICATE = "We couldn't create an account with those details. If you already have one, sign in instead."


@router.post("/signup", response_model=MeOut, status_code=201, dependencies=[Depends(per_ip("signup", 10, 3600))])
def signup(body: SignupIn, response: Response, db: Session = Depends(get_db)) -> MeOut:
    if not _invite_ok(body.invite_code):
        raise HTTPException(status_code=403, detail="That invite code isn't valid. This demo is invite-only.")
    if not body.adult_attestation:
        raise HTTPException(status_code=400, detail="This service is for adults (18+) only.")
    # Public sign-up always creates the user role; staff accounts are made with scripts/create_staff.py.
    user = User(
        email_lookup=email_lookup_key(body.email),
        email_enc=encrypt_str(body.email.lower()),
        password_hash=hash_password(body.password),
        role="user",
        adult_attested=True,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=_DUPLICATE) from None
    _set_session(response, user)
    return MeOut(id=user.id, role=user.role)


@router.post("/login", response_model=MeOut, dependencies=[Depends(per_ip("login", 20, 60))])
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)) -> MeOut:
    # Per address, and per address and account, so a single source guessing passwords is slowed. There
    # is no account-wide limit across addresses: on shared demo logins anyone could use it to lock
    # everyone out. Guessing from many addresses is a known gap (README, Known constraints).
    check("login-account", f"{client_ip(request)}:{email_lookup_key(body.email)}", 5, 60)
    user = db.scalar(select(User).where(User.email_lookup == email_lookup_key(body.email)))
    # Unknown emails still pay for a hash, so response time doesn't reveal which accounts exist.
    if not verify_password(user.password_hash if user else None, body.password) or user is None:
        raise HTTPException(status_code=401, detail="Email or password is incorrect.")
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)
        db.commit()
    _set_session(response, user)
    return MeOut(id=user.id, role=user.role)


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db: Session = Depends(get_db)) -> None:
    """Sign out this browser: its session id is revoked server-side, so a copy of the cookie stops
    working too. Other sign-ins to the same account (shared demo logins) are not affected."""
    token = request.cookies.get(SESSION_COOKIE)
    session = read_session_token(token) if token else None
    if session is not None:
        revoke_session(db, session[2])
        db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")


@router.get("/me", response_model=MeOut)
def me(user: User = Depends(current_user)) -> MeOut:
    return MeOut(id=user.id, role=user.role)
