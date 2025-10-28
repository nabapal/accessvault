from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum as PyEnum
from typing import Any, Dict

from sqlalchemy import Boolean, Column, DateTime, Enum, Integer, JSON, LargeBinary, String, Text, func

from app.core.database import Base
from app.core.types import GUID


class TelcoFabricType(str, PyEnum):
    ACI = "aci"
    NXOS = "nxos"


class TelcoOnboardingStatus(str, PyEnum):
    PENDING = "pending"
    VALIDATING = "validating"
    READY = "ready"
    FAILED = "failed"


class TelcoFabricOnboardingJob(Base):
    __tablename__ = "telco_fabric_onboarding_jobs"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    fabric_type = Column(Enum(TelcoFabricType), nullable=False)
    target_host = Column(String, nullable=False)
    port = Column(Integer, nullable=False, default=443)
    username = Column(String, nullable=True)
    password_secret = Column(LargeBinary, nullable=True)
    description = Column(Text, nullable=True)
    status = Column(Enum(TelcoOnboardingStatus), nullable=False, default=TelcoOnboardingStatus.PENDING)
    connection_params = Column(JSON, nullable=False, default=dict)
    verify_ssl = Column(Boolean, nullable=False, default=False)
    poll_interval_seconds = Column(Integer, nullable=False, default=900)
    last_error = Column(Text, nullable=True)
    last_snapshot = Column(JSON, nullable=True)
    last_polled_at = Column(DateTime(timezone=True), nullable=True)
    last_validation_started_at = Column(DateTime(timezone=True), nullable=True)
    last_validation_completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    def start_validation(self) -> None:
        self.status = TelcoOnboardingStatus.VALIDATING
        self.last_validation_started_at = datetime.now(timezone.utc)

    def mark_validation_success(self) -> None:
        self.status = TelcoOnboardingStatus.READY
        self.last_validation_completed_at = datetime.now(timezone.utc)
        self.last_error = None

    def mark_validation_failure(self, message: str | None = None) -> None:
        self.status = TelcoOnboardingStatus.FAILED
        self.last_validation_completed_at = datetime.now(timezone.utc)
        self.last_error = message

    def update_connection_params(self, params: Dict[str, Any]) -> None:
        current_params = self.connection_params or {}
        current_params.update(params)
        self.connection_params = current_params

    @property
    def has_credentials(self) -> bool:
        return self.password_secret is not None
