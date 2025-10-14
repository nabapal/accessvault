from enum import Enum
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


class AccessType(str, Enum):
    GUI = "gui"
    CLI = "cli"
    BOTH = "both"


class SystemCredentialBase(BaseModel):
    user_id: str = Field(min_length=1)
    login_endpoint: str = Field(min_length=1)
    access_scope: AccessType = AccessType.GUI


class SystemCredentialCreate(SystemCredentialBase):
    password: str = Field(min_length=1)


class SystemCredentialUpdate(SystemCredentialBase):
    id: Optional[UUID] = None
    password: Optional[str] = Field(default=None)

    @model_validator(mode="after")
    def ensure_secret_when_new(self) -> "SystemCredentialUpdate":
        if self.id is None and not self.password:
            raise ValueError("New credentials require a password value")
        return self


class SystemCredentialRead(SystemCredentialBase):
    id: UUID

    class Config:
        from_attributes = True


class SystemCredentialSecret(SystemCredentialRead):
    password: str


class SystemBase(BaseModel):
    name: str
    ip_address: str


class SystemCreate(SystemBase):
    credentials: List[SystemCredentialCreate]

    @model_validator(mode="after")
    def validate_credentials(self) -> "SystemCreate":
        if not self.credentials:
            raise ValueError("At least one credential is required")
        return self


class SystemUpdate(BaseModel):
    name: Optional[str] = None
    ip_address: Optional[str] = None
    credentials: Optional[List[SystemCredentialUpdate]] = None


class SystemRead(SystemBase):
    id: UUID
    group_id: UUID
    credentials: List[SystemCredentialRead] = Field(default_factory=list)

    class Config:
        from_attributes = True
