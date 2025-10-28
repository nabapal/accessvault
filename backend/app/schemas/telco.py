from datetime import datetime
from typing import Any, Dict, Optional
from uuid import UUID

from pydantic import BaseModel, Field
from pydantic.config import ConfigDict

from app.models.telco import TelcoFabricOnboardingJob, TelcoFabricType, TelcoOnboardingStatus


class TelcoOnboardingJobBase(BaseModel):
    name: str
    fabric_type: TelcoFabricType
    target_host: str
    port: int = Field(default=443, ge=1, le=65535)
    username: Optional[str] = None
    verify_ssl: bool = False
    description: Optional[str] = None
    connection_params: Dict[str, Any] = Field(default_factory=dict)
    poll_interval_seconds: int = Field(default=900, ge=60, le=86400)


class TelcoOnboardingJobCreate(TelcoOnboardingJobBase):
    password: str = Field(min_length=1)
    auto_validate: bool = True


class TelcoOnboardingJobRead(TelcoOnboardingJobBase):
    id: UUID
    status: TelcoOnboardingStatus
    has_credentials: bool = False
    last_error: Optional[str] = None
    last_snapshot: Optional[Dict[str, Any]] = None
    last_polled_at: Optional[datetime] = None
    last_validation_started_at: Optional[datetime] = None
    last_validation_completed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TelcoOnboardingValidationRequest(BaseModel):
    force_fail: bool = False
    error_message: Optional[str] = None
    password: Optional[str] = None


def to_read_model(job: TelcoFabricOnboardingJob) -> TelcoOnboardingJobRead:
    return TelcoOnboardingJobRead.model_validate(job)
