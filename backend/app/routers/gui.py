from datetime import timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.security import create_access_token
from app.dependencies import get_current_user, get_db
from app.models import System
from app.models.system import AccessType as ModelAccessType
from app.services.crypto import decrypt_secret

router = APIRouter(prefix="/gui", tags=["gui"])


@router.post("/{system_id}/token")
async def issue_gui_token(system_id: UUID, db: AsyncSession = Depends(get_db), _: object = Depends(get_current_user)):
    system = await db.get(System, system_id, options=[selectinload(System.credentials)])
    if system is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="System not found")
    credential = next(
        (
            cred
            for cred in system.credentials
            if cred.access_scope in {ModelAccessType.GUI, ModelAccessType.BOTH}
        ),
        None,
    )
    if credential is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No GUI credential available")
    if not credential.login_endpoint:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="GUI login endpoint not configured")
    secret_value = decrypt_secret(credential.credential_secret)
    payload = {
        "system_id": str(system_id),
        "user_id": credential.user_id,
        "password": secret_value,
        "login_endpoint": credential.login_endpoint,
    }
    token = create_access_token(str(system_id), expires_delta=timedelta(minutes=1))
    return {"token": token, "payload": payload}
