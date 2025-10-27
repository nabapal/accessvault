import asyncio
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.dependencies import get_current_user, get_db, require_admin
from app.models import (
    InventoryDatastore,
    InventoryEndpoint,
    InventoryEndpointStatus,
    InventoryHost,
    InventoryNetwork,
    InventoryVirtualMachine,
)
from app.schemas import (
    InventoryDatastoreRead,
    InventoryEndpointCreate,
    InventoryEndpointRead,
    InventoryEndpointSyncResponse,
    InventoryEndpointUpdate,
    InventoryEndpointValidationResult,
    InventoryHostRead,
    InventoryNetworkRead,
    InventoryVMRead,
)
from app.services.crypto import decrypt_secret, encrypt_secret
from app.services.inventory_poller import PollResult, run_poll_for_endpoint
from app.services.vsphere import VsphereSnapshot, collect_inventory

router = APIRouter(prefix="/inventory", tags=["inventory"])


def _serialize_endpoint(endpoint: InventoryEndpoint) -> InventoryEndpointRead:
    return InventoryEndpointRead(
        id=str(endpoint.id),
        name=endpoint.name,
        address=endpoint.address,
        port=endpoint.port,
        source_type=endpoint.source_type,
        username=endpoint.username,
        verify_ssl=endpoint.verify_ssl,
        poll_interval_seconds=endpoint.poll_interval_seconds,
        description=endpoint.description,
        tags=list(endpoint.tags or []),
        last_polled_at=endpoint.last_polled_at,
        last_poll_status=endpoint.last_poll_status or InventoryEndpointStatus.NEVER,
        last_error_message=endpoint.last_error_message,
        has_credentials=bool(endpoint.password_secret),
        created_at=endpoint.created_at,
        updated_at=endpoint.updated_at,
    )


def _serialize_host(host: InventoryHost) -> InventoryHostRead:
    endpoint = host.endpoint
    return InventoryHostRead(
        id=str(host.id),
        endpoint_id=str(host.endpoint_id),
        endpoint_name=endpoint.name if endpoint else "Unknown",
        name=host.name,
        cluster=host.cluster,
    hardware_model=host.hardware_model,
        connection_state=host.connection_state,
        power_state=host.power_state,
        cpu_cores=host.cpu_cores,
        cpu_usage_mhz=host.cpu_usage_mhz,
        memory_total_mb=host.memory_total_mb,
        memory_usage_mb=host.memory_usage_mb,
        datastore_total_gb=host.datastore_total_gb,
        datastore_free_gb=host.datastore_free_gb,
        uptime_seconds=host.uptime_seconds,
        last_seen_at=host.last_seen_at,
        updated_at=host.updated_at,
    )


def _serialize_vm(vm: InventoryVirtualMachine) -> InventoryVMRead:
    endpoint = vm.endpoint
    host = vm.host
    return InventoryVMRead(
        id=str(vm.id),
        endpoint_id=str(vm.endpoint_id),
        endpoint_name=endpoint.name if endpoint else "Unknown",
        host_id=str(host.id) if host else None,
        host_name=host.name if host else None,
        name=vm.name,
        guest_os=vm.guest_os,
        power_state=vm.power_state,
        cpu_count=vm.cpu_count,
        memory_mb=vm.memory_mb,
        cpu_usage_mhz=vm.cpu_usage_mhz,
        memory_usage_mb=vm.memory_usage_mb,
        provisioned_storage_gb=vm.provisioned_storage_gb,
        used_storage_gb=vm.used_storage_gb,
        ip_address=vm.ip_address,
        datastores=list(vm.datastores or []),
        networks=list(vm.networks or []),
        tools_status=vm.tools_status,
        last_seen_at=vm.last_seen_at,
        updated_at=vm.updated_at,
    )


def _serialize_datastore(datastore: InventoryDatastore) -> InventoryDatastoreRead:
    endpoint = datastore.endpoint
    return InventoryDatastoreRead(
        id=str(datastore.id),
        endpoint_id=str(datastore.endpoint_id),
        endpoint_name=endpoint.name if endpoint else "Unknown",
        name=datastore.name,
        type=datastore.type,
        capacity_gb=datastore.capacity_gb,
        free_gb=datastore.free_gb,
        last_seen_at=datastore.last_seen_at,
        updated_at=datastore.updated_at,
    )


def _serialize_network(network: InventoryNetwork) -> InventoryNetworkRead:
    endpoint = network.endpoint
    return InventoryNetworkRead(
        id=str(network.id),
        endpoint_id=str(network.endpoint_id),
        endpoint_name=endpoint.name if endpoint else "Unknown",
        name=network.name,
        last_seen_at=network.last_seen_at,
        updated_at=network.updated_at,
    )


def _build_validation_result(
    snapshot: Optional[VsphereSnapshot],
    error: Optional[str] = None,
) -> InventoryEndpointValidationResult:
    if snapshot is None:
        return InventoryEndpointValidationResult(
            reachable=False,
            host_count=0,
            virtual_machine_count=0,
            datastore_count=0,
            network_count=0,
            message=error,
            collected_at=None,
        )

    return InventoryEndpointValidationResult(
        reachable=True,
        host_count=len(snapshot.hosts),
        virtual_machine_count=len(snapshot.virtual_machines),
        datastore_count=len(snapshot.datastores),
        network_count=len(snapshot.networks),
        message=None,
        collected_at=snapshot.collected_at,
    )


def _summary_from_poll_result(result: PollResult) -> InventoryEndpointValidationResult:
    return _build_validation_result(result.snapshot, result.message)


async def _validate_endpoint_connection(
    address: str,
    port: int,
    username: str,
    password: str,
    verify_ssl: bool,
) -> InventoryEndpointValidationResult:
    try:
        snapshot = await asyncio.to_thread(
            collect_inventory,
            address,
            port,
            username,
            password,
            verify_ssl,
        )
    except Exception as exc:  # pragma: no cover - runtime safety
        return _build_validation_result(None, str(exc))

    return _build_validation_result(snapshot)


@router.get("/endpoints", response_model=List[InventoryEndpointRead])
async def list_endpoints(
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
):
    result = await db.execute(select(InventoryEndpoint).order_by(InventoryEndpoint.name))
    endpoints = result.scalars().all()
    return [_serialize_endpoint(endpoint) for endpoint in endpoints]


@router.post("/endpoints", response_model=InventoryEndpointRead, status_code=status.HTTP_201_CREATED)
async def create_endpoint(
    payload: InventoryEndpointCreate,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_admin),
):
    endpoint = InventoryEndpoint(
        name=payload.name.strip(),
        address=payload.address.strip(),
        port=payload.port,
        source_type=payload.source_type,
        username=payload.username.strip(),
        password_secret=encrypt_secret(payload.password),
        verify_ssl=payload.verify_ssl,
        poll_interval_seconds=payload.poll_interval_seconds,
        description=payload.description.strip() if payload.description else None,
        tags=[tag.strip() for tag in payload.tags if tag.strip()],
    )
    db.add(endpoint)
    await db.commit()
    await db.refresh(endpoint)
    return _serialize_endpoint(endpoint)


@router.post("/endpoints/validate", response_model=InventoryEndpointValidationResult)
async def validate_endpoint_candidate(
    payload: InventoryEndpointCreate,
    _: object = Depends(require_admin),
):
    return await _validate_endpoint_connection(
        payload.address.strip(),
        payload.port,
        payload.username.strip(),
        payload.password,
        payload.verify_ssl,
    )


@router.get("/endpoints/{endpoint_id}", response_model=InventoryEndpointRead)
async def get_endpoint(
    endpoint_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
):
    endpoint = await db.get(InventoryEndpoint, endpoint_id)
    if endpoint is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inventory endpoint not found")
    return _serialize_endpoint(endpoint)


@router.patch("/endpoints/{endpoint_id}", response_model=InventoryEndpointRead)
async def update_endpoint(
    endpoint_id: UUID,
    payload: InventoryEndpointUpdate,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_admin),
):
    endpoint = await db.get(InventoryEndpoint, endpoint_id)
    if endpoint is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inventory endpoint not found")

    updates = payload.model_dump(exclude_unset=True)
    if "name" in updates and updates["name"]:
        endpoint.name = updates["name"].strip()
    if "address" in updates and updates["address"]:
        endpoint.address = updates["address"].strip()
    if "port" in updates and updates["port"] is not None:
        endpoint.port = updates["port"]
    if "source_type" in updates and updates["source_type"] is not None:
        endpoint.source_type = updates["source_type"]
    if "username" in updates and updates["username"]:
        endpoint.username = updates["username"].strip()
    if "verify_ssl" in updates:
        endpoint.verify_ssl = bool(updates["verify_ssl"])
    if "poll_interval_seconds" in updates and updates["poll_interval_seconds"] is not None:
        endpoint.poll_interval_seconds = updates["poll_interval_seconds"]
    if "description" in updates:
        endpoint.description = updates["description"].strip() if updates["description"] else None
    if "tags" in updates and updates["tags"] is not None:
        endpoint.tags = [tag.strip() for tag in updates["tags"] if tag.strip()]
    if "password" in updates and updates["password"]:
        endpoint.password_secret = encrypt_secret(updates["password"])

    await db.commit()
    await db.refresh(endpoint)
    return _serialize_endpoint(endpoint)


@router.post("/endpoints/{endpoint_id}/test", response_model=InventoryEndpointValidationResult)
async def test_endpoint_connectivity(
    endpoint_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_admin),
):
    endpoint = await db.get(InventoryEndpoint, endpoint_id)
    if endpoint is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inventory endpoint not found")

    password = decrypt_secret(endpoint.password_secret)
    return await _validate_endpoint_connection(
        endpoint.address,
        endpoint.port,
        endpoint.username,
        password,
        endpoint.verify_ssl,
    )


@router.post(
    "/endpoints/{endpoint_id}/sync",
    response_model=InventoryEndpointSyncResponse,
    status_code=status.HTTP_200_OK,
)
async def sync_endpoint_now(
    endpoint_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_admin),
):
    endpoint = await db.get(InventoryEndpoint, endpoint_id)
    if endpoint is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inventory endpoint not found")

    poll_result = await run_poll_for_endpoint(db, endpoint)
    await db.commit()
    await db.refresh(endpoint)

    summary = _summary_from_poll_result(poll_result)
    return InventoryEndpointSyncResponse(
        endpoint=_serialize_endpoint(endpoint),
        summary=summary,
    )


@router.delete("/endpoints/{endpoint_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_endpoint(
    endpoint_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_admin),
):
    endpoint = await db.get(InventoryEndpoint, endpoint_id)
    if endpoint is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inventory endpoint not found")
    await db.delete(endpoint)
    await db.commit()
    return None


@router.get("/hosts", response_model=List[InventoryHostRead])
async def list_hosts(
    endpoint_id: Optional[UUID] = None,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
):
    stmt = select(InventoryHost).options(selectinload(InventoryHost.endpoint)).order_by(InventoryHost.name)
    if endpoint_id:
        stmt = stmt.where(InventoryHost.endpoint_id == endpoint_id)
    result = await db.execute(stmt)
    hosts = result.scalars().all()
    return [_serialize_host(host) for host in hosts]


@router.get("/virtual-machines", response_model=List[InventoryVMRead])
async def list_virtual_machines(
    endpoint_id: Optional[UUID] = None,
    host_id: Optional[UUID] = None,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
):
    stmt = (
        select(InventoryVirtualMachine)
        .options(selectinload(InventoryVirtualMachine.endpoint), selectinload(InventoryVirtualMachine.host))
        .order_by(InventoryVirtualMachine.name)
    )
    if endpoint_id:
        stmt = stmt.where(InventoryVirtualMachine.endpoint_id == endpoint_id)
    if host_id:
        stmt = stmt.where(InventoryVirtualMachine.host_id == host_id)
    result = await db.execute(stmt)
    vms = result.scalars().all()
    return [_serialize_vm(vm) for vm in vms]


@router.get("/datastores", response_model=List[InventoryDatastoreRead])
async def list_datastores(
    endpoint_id: Optional[UUID] = None,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
):
    stmt = select(InventoryDatastore).options(selectinload(InventoryDatastore.endpoint)).order_by(InventoryDatastore.name)
    if endpoint_id:
        stmt = stmt.where(InventoryDatastore.endpoint_id == endpoint_id)
    result = await db.execute(stmt)
    datastores = result.scalars().all()
    return [_serialize_datastore(datastore) for datastore in datastores]


@router.get("/networks", response_model=List[InventoryNetworkRead])
async def list_networks(
    endpoint_id: Optional[UUID] = None,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
):
    stmt = select(InventoryNetwork).options(selectinload(InventoryNetwork.endpoint)).order_by(InventoryNetwork.name)
    if endpoint_id:
        stmt = stmt.where(InventoryNetwork.endpoint_id == endpoint_id)
    result = await db.execute(stmt)
    networks = result.scalars().all()
    return [_serialize_network(network) for network in networks]