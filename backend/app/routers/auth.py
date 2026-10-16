import hmac

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import User
from app.security import (
    SESSION_COOKIE,
    SESSION_MAX_AGE_SECONDS,
    current_user,
    email_lookup_key,
    encrypt_str,
    hash_password,
    make_session_token,
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


def _set_session(response: Response, user_id: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        make_session_token(user_id),
        max_age=SESSION_MAX_AGE_SECONDS,
        httponly=True,
        secure=get_settings().secure_cookies,
        samesite="lax",
        path="/",
    )


def _invite_ok(code: str) -> bool:
    return any(hmac.compare_digest(code, valid) for valid in get_settings().invite_code_set)


@router.post("/signup", response_model=MeOut, status_code=201)
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
        raise HTTPException(status_code=409, detail="An account with that email already exists. Try signing in.") from None
    _set_session(response, user.id)
    return MeOut(id=user.id, role=user.role)


@router.post("/login", response_model=MeOut)
def login(body: LoginIn, response: Response, db: Session = Depends(get_db)) -> MeOut:
    user = db.scalar(select(User).where(User.email_lookup == email_lookup_key(body.email)))
    if user is None or not verify_password(user.password_hash, body.password):
        raise HTTPException(status_code=401, detail="Email or password is incorrect.")
    _set_session(response, user.id)
    return MeOut(id=user.id, role=user.role)


@router.post("/logout", status_code=204)
def logout(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/")


@router.get("/me", response_model=MeOut)
def me(user: User = Depends(current_user)) -> MeOut:
    return MeOut(id=user.id, role=user.role)
