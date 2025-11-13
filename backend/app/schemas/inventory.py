from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field

from app.models.inventory import (
    InventoryEndpointStatus,
    InventoryEndpointType,
    InventoryHostConnectionState,
    InventoryPowerState,
)


class InventoryEndpointBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    address: str = Field(..., min_length=1, max_length=255)
    port: int = Field(default=443, ge=1, le=65535)
    source_type: InventoryEndpointType = InventoryEndpointType.ESXI
    username: str = Field(..., min_length=1, max_length=255)
    verify_ssl: bool = False
    poll_interval_seconds: int = Field(default=300, ge=60, le=86400)
    description: Optional[str] = Field(default=None, max_length=1000)
    tags: List[str] = Field(default_factory=list, max_length=20)


class InventoryEndpointCreate(InventoryEndpointBase):
    password: str = Field(..., min_length=1, max_length=255)


class InventoryEndpointUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    address: Optional[str] = Field(default=None, min_length=1, max_length=255)
    port: Optional[int] = Field(default=None, ge=1, le=65535)
    source_type: Optional[InventoryEndpointType] = None
    username: Optional[str] = Field(default=None, min_length=1, max_length=255)
    verify_ssl: Optional[bool] = None
    poll_interval_seconds: Optional[int] = Field(default=None, ge=60, le=86400)
    description: Optional[str] = Field(default=None, max_length=1000)
    password: Optional[str] = Field(default=None, min_length=1, max_length=255)
    tags: Optional[List[str]] = Field(default=None, max_length=20)


class InventoryEndpointRead(BaseModel):
    id: str
    name: str
    address: str
    port: int
    source_type: InventoryEndpointType
    username: str
    verify_ssl: bool
    poll_interval_seconds: int
    description: Optional[str]
    tags: List[str]
    last_polled_at: Optional[datetime]
    last_poll_status: InventoryEndpointStatus
    last_error_message: Optional[str]
    has_credentials: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class InventoryHostRead(BaseModel):
    id: str
    endpoint_id: str
    endpoint_name: str
    name: str
    serial: Optional[str]
    cluster: Optional[str]
    hardware_model: Optional[str]
    site_name: Optional[str]
    rack_location: Optional[str]
    connection_state: InventoryHostConnectionState
    power_state: InventoryPowerState
    cpu_cores: Optional[int]
    cpu_usage_mhz: Optional[int]
    memory_total_mb: Optional[int]
    memory_usage_mb: Optional[int]
    datastore_total_gb: Optional[float]
    datastore_free_gb: Optional[float]
    uptime_seconds: Optional[int]
    last_seen_at: Optional[datetime]
    updated_at: datetime

    class Config:
        from_attributes = True


class InventoryVMRead(BaseModel):
    id: str
    endpoint_id: str
    endpoint_name: str
    host_id: Optional[str]
    host_name: Optional[str]
    name: str
    guest_os: Optional[str]
    power_state: InventoryPowerState
    cpu_count: Optional[int]
    memory_mb: Optional[int]
    cpu_usage_mhz: Optional[int]
    memory_usage_mb: Optional[int]
    provisioned_storage_gb: Optional[float]
    used_storage_gb: Optional[float]
    ip_address: Optional[str]
    datastores: List[str]
    networks: List[str]
    tools_status: Optional[str]
    last_seen_at: Optional[datetime]
    updated_at: datetime

    class Config:
        from_attributes = True


class InventoryDatastoreRead(BaseModel):
    id: str
    endpoint_id: str
    endpoint_name: str
    name: str
    type: Optional[str]
    capacity_gb: Optional[float]
    free_gb: Optional[float]
    last_seen_at: Optional[datetime]
    updated_at: datetime

    class Config:
        from_attributes = True


class InventoryNetworkRead(BaseModel):
    id: str
    endpoint_id: str
    endpoint_name: str
    name: str
    last_seen_at: Optional[datetime]
    updated_at: datetime

    class Config:
        from_attributes = True


class InventoryEndpointValidationResult(BaseModel):
    reachable: bool
    host_count: int
    virtual_machine_count: int
    datastore_count: int
    network_count: int
    message: Optional[str]
    collected_at: Optional[datetime]


class InventoryEndpointSyncResponse(BaseModel):
    endpoint: InventoryEndpointRead
    summary: InventoryEndpointValidationResult