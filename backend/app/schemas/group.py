from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from .system import SystemRead


class GroupBase(BaseModel):
    name: str
    description: Optional[str] = None


class GroupCreate(GroupBase):
    pass


class GroupUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class GroupRead(GroupBase):
    id: UUID

    class Config:
        from_attributes = True


class GroupDetail(GroupRead):
    systems: List[SystemRead] = Field(default_factory=list)
