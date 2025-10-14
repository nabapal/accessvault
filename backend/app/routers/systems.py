from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.dependencies import get_current_user, get_db
from app.models import Group, System, SystemCredential
from app.models.system import AccessType as ModelAccessType
from app.schemas.system import (
    AccessType,
    SystemCreate,
    SystemCredentialSecret,
    SystemCredentialUpdate,
    SystemRead,
    SystemUpdate,
)
from app.services.crypto import decrypt_secret, encrypt_secret

router = APIRouter(prefix="/systems", tags=["systems"])


@router.get("/", response_model=List[SystemRead])
async def list_systems(
    group_id: Optional[UUID] = None,
    search: Optional[str] = Query(default=None, min_length=2),
    access_type: Optional[AccessType] = None,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
):
    stmt = select(System)
    join_credentials = False
    filters = []
    if group_id:
        filters.append(System.group_id == group_id)
    if search:
        like = f"%{search.lower()}%"
        join_credentials = True
        filters.append(
            or_(
                System.name.ilike(like),
                System.ip_address.ilike(like),
                SystemCredential.user_id.ilike(like),
                SystemCredential.login_endpoint.ilike(like),
            )
        )
    if access_type:
        if access_type in {AccessType.GUI, AccessType.CLI}:
            join_credentials = True
            filters.append(SystemCredential.access_scope == ModelAccessType(access_type.value))
        elif access_type == AccessType.BOTH:
            subquery = (
                select(SystemCredential.system_id)
                .where(SystemCredential.access_scope.in_([ModelAccessType.GUI, ModelAccessType.CLI]))
                .group_by(SystemCredential.system_id)
                .having(func.count(func.distinct(SystemCredential.access_scope)) == 2)
            )
            filters.append(System.id.in_(subquery))
    if join_credentials:
        stmt = stmt.outerjoin(SystemCredential)
    if filters:
        stmt = stmt.where(and_(*filters))
    if join_credentials:
        stmt = stmt.distinct(System.id)
    stmt = stmt.options(selectinload(System.credentials))
    result = await db.execute(stmt)
    systems = result.scalars().all()
    return systems


@router.post("/", response_model=SystemRead, status_code=status.HTTP_201_CREATED)
async def create_system(
    payload: SystemCreate,
    group_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
):
    group = await db.get(Group, group_id)
    if group is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
    system = System(
        group_id=group_id,
        name=payload.name,
        ip_address=payload.ip_address,
        url=None,
        username="",
        access_type=ModelAccessType.GUI,
    )
    system.credentials = [
        SystemCredential(
            user_id=cred.user_id.strip(),
            login_endpoint=cred.login_endpoint.strip(),
            access_scope=ModelAccessType(cred.access_scope.value),
            credential_secret=encrypt_secret(cred.password),
        )
        for cred in payload.credentials
    ]
    scopes = {cred.access_scope for cred in system.credentials}
    if ModelAccessType.GUI in scopes and ModelAccessType.CLI in scopes:
        system.access_type = ModelAccessType.BOTH
    elif ModelAccessType.GUI in scopes:
        system.access_type = ModelAccessType.GUI
    elif ModelAccessType.CLI in scopes:
        system.access_type = ModelAccessType.CLI
    else:
        system.access_type = ModelAccessType.GUI
    db.add(system)
    await db.commit()
    stmt = select(System).options(selectinload(System.credentials)).where(System.id == system.id)
    result = await db.execute(stmt)
    return result.scalar_one()


@router.patch("/{system_id}", response_model=SystemRead)
async def update_system(
    system_id: UUID,
    payload: SystemUpdate,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
):
    stmt = select(System).options(selectinload(System.credentials)).where(System.id == system_id)
    result = await db.execute(stmt)
    system = result.scalar_one_or_none()
    if system is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="System not found")
    updates = payload.model_dump(exclude_unset=True, exclude={"credentials"})
    for field in {"name", "ip_address"}:
        if field in updates:
            setattr(system, field, updates[field])

    if payload.credentials is not None:
        payload_credentials: List[SystemCredentialUpdate] = payload.credentials
        existing = {cred.id: cred for cred in system.credentials}
        retained_ids: set[UUID] = set()
        new_credentials: List[SystemCredential] = []
        for cred_payload in payload_credentials:
            if cred_payload.id:
                credential = existing.get(cred_payload.id)
                if credential is None:
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown credential id")
                credential.user_id = cred_payload.user_id.strip()
                credential.login_endpoint = cred_payload.login_endpoint.strip()
                credential.access_scope = ModelAccessType(cred_payload.access_scope.value)
                if cred_payload.password:
                    credential.credential_secret = encrypt_secret(cred_payload.password)
                retained_ids.add(credential.id)
            else:
                if not cred_payload.password:
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password required for new credentials")
                new_credentials.append(
                    SystemCredential(
                        user_id=cred_payload.user_id.strip(),
                        login_endpoint=cred_payload.login_endpoint.strip(),
                        access_scope=ModelAccessType(cred_payload.access_scope.value),
                        credential_secret=encrypt_secret(cred_payload.password),
                    )
                )
        system.credentials = [cred for cred in system.credentials if cred.id in retained_ids]
        system.credentials.extend(new_credentials)
        scopes = {cred.access_scope for cred in system.credentials}
        if ModelAccessType.GUI in scopes and ModelAccessType.CLI in scopes:
            system.access_type = ModelAccessType.BOTH
        elif ModelAccessType.GUI in scopes:
            system.access_type = ModelAccessType.GUI
        elif ModelAccessType.CLI in scopes:
            system.access_type = ModelAccessType.CLI
        else:
            system.access_type = ModelAccessType.GUI
    await db.commit()
    stmt = select(System).options(selectinload(System.credentials)).where(System.id == system.id)
    result = await db.execute(stmt)
    return result.scalar_one()


@router.delete("/{system_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_system(system_id: UUID, db: AsyncSession = Depends(get_db), _: object = Depends(get_current_user)):
    system = await db.get(System, system_id)
    if system is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="System not found")
    await db.delete(system)
    await db.commit()
    return None


@router.get("/{system_id}/credentials", response_model=List[SystemCredentialSecret])
async def read_system_credentials(
    system_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
):
    system = await db.get(System, system_id, options=[selectinload(System.credentials)])
    if system is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="System not found")
    return [
        SystemCredentialSecret(
            id=cred.id,
            user_id=cred.user_id,
            login_endpoint=cred.login_endpoint,
            access_scope=AccessType(cred.access_scope.value),
            password=decrypt_secret(cred.credential_secret),
        )
        for cred in system.credentials
    ]
