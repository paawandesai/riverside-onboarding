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


@router.get("/consent/text")
def consent_text() -> dict:
    return CONSENT_TEXT


@router.get("/consent", response_model=ConsentOut)
def consent_status(user: User = Depends(current_user), db: Session = Depends(get_db)) -> ConsentOut:
    consent = active_consent(db, user.id)
    return ConsentOut(active=consent is not None, version=consent.version if consent else None)


@router.post("/consent", response_model=ConsentOut, status_code=201)
def grant_consent(user: User = Depends(current_user), db: Session = Depends(get_db)) -> ConsentOut:
    if active_consent(db, user.id) is None:
        db.add(Consent(user_id=user.id, version=CONSENT_VERSION))
        audit(db, "consent_granted", user.id, user.id)
        db.commit()
    return ConsentOut(active=True, version=CONSENT_VERSION)


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
