from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.dependencies import get_db, get_current_user
from app.models import Group, System
from app.schemas.group import GroupCreate, GroupDetail, GroupRead, GroupUpdate

router = APIRouter(prefix="/groups", tags=["groups"])


@router.get("/", response_model=List[GroupRead])
async def list_groups(db: AsyncSession = Depends(get_db), _: object = Depends(get_current_user)):
    result = await db.execute(select(Group))
    groups = result.scalars().all()
    return groups


@router.post("/", response_model=GroupRead, status_code=status.HTTP_201_CREATED)
async def create_group(payload: GroupCreate, db: AsyncSession = Depends(get_db), _: object = Depends(get_current_user)):
    group = Group(name=payload.name, description=payload.description)
    db.add(group)
    await db.commit()
    await db.refresh(group)
    return group


@router.get("/{group_id}", response_model=GroupDetail)
async def get_group(group_id: UUID, db: AsyncSession = Depends(get_db), _: object = Depends(get_current_user)):
    stmt = select(Group).options(selectinload(Group.systems).selectinload(System.credentials)).where(Group.id == group_id)
    result = await db.execute(stmt)
    group = result.scalar_one_or_none()
    if group is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
    return group


@router.patch("/{group_id}", response_model=GroupRead)
async def update_group(group_id: UUID, payload: GroupUpdate, db: AsyncSession = Depends(get_db), _: object = Depends(get_current_user)):
    result = await db.execute(select(Group).where(Group.id == group_id))
    group = result.scalar_one_or_none()
    if group is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(group, field, value)
    await db.commit()
    await db.refresh(group)
    return group


@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_group(group_id: UUID, db: AsyncSession = Depends(get_db), _: object = Depends(get_current_user)):
    result = await db.execute(select(Group).where(Group.id == group_id))
    group = result.scalar_one_or_none()
    if group is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
    await db.delete(group)
    await db.commit()
    return None
