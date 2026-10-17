from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Consent, User
from app.security import SESSION_COOKIE, audit, current_user
from app.services.privacy import CONSENT_TEXT, CONSENT_VERSION, active_consent, delete_account, purge_user_data

router = APIRouter(prefix="/api", tags=["privacy"])


class ConsentOut(BaseModel):
    active: bool
    version: str | None
    photo_scan: bool = False


class ConsentIn(BaseModel):
    photo_scan: bool = False


class ConsentTextOut(BaseModel):
    version: str
    summary: str
    points: list[str]
    photo_scan: str
    details: list[str]


@router.get("/consent/text", response_model=ConsentTextOut)
def consent_text() -> dict:
    return CONSENT_TEXT


@router.get("/consent", response_model=ConsentOut)
def consent_status(user: User = Depends(current_user), db: Session = Depends(get_db)) -> ConsentOut:
    consent = active_consent(db, user.id)
    if consent is None:
        return ConsentOut(active=False, version=None)
    return ConsentOut(active=True, version=consent.version, photo_scan=consent.photo_scan)


@router.post("/consent", response_model=ConsentOut, status_code=201)
def grant_consent(body: ConsentIn | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)) -> ConsentOut:
    """Grant consent, or change the optional ID-photo consent on an active grant."""
    photo_scan = body.photo_scan if body else False
    consent = active_consent(db, user.id)
    if consent is None:
        consent = Consent(user_id=user.id, version=CONSENT_VERSION, photo_scan=photo_scan)
        db.add(consent)
        audit(db, "consent_granted", user.id, user.id)
    elif consent.photo_scan != photo_scan:
        consent.photo_scan = photo_scan
        audit(db, "photo_consent_granted" if photo_scan else "photo_consent_withdrawn", user.id, user.id)
    db.commit()
    return ConsentOut(active=True, version=consent.version, photo_scan=consent.photo_scan)


@router.post("/consent/revoke", response_model=ConsentOut)
def revoke_consent(user: User = Depends(current_user), db: Session = Depends(get_db)) -> ConsentOut:
    """Withdrawing consent stops processing and purges identity and intake data."""
    purge_user_data(db, user.id, user.id, "consent_revoked_data_purged")
    db.commit()
    return ConsentOut(active=False, version=None)


@router.delete("/me/data", status_code=204)
def delete_my_data(user: User = Depends(current_user), db: Session = Depends(get_db)) -> None:
    purge_user_data(db, user.id, user.id, "data_deleted_on_request")
    db.commit()


@router.delete("/me", status_code=204)
def delete_me(response: Response, user: User = Depends(current_user), db: Session = Depends(get_db)) -> None:
    delete_account(db, user.id)
    db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")
