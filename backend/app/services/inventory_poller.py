import asyncio
import asyncio
import logging
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import AsyncGenerator, Dict, Optional, Set

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import (
	InventoryDatastore,
	InventoryEndpoint,
	InventoryEndpointStatus,
	InventoryHost,
	InventoryHostConnectionState,
	InventoryNetwork,
	InventoryPowerState,
	InventoryVirtualMachine,
)
from app.services.crypto import decrypt_secret
from app.services.vsphere import VsphereSnapshot, collect_inventory

logger = logging.getLogger(__name__)


HOST_CONNECTION_MAP = {
	"connected": InventoryHostConnectionState.CONNECTED,
	"disconnected": InventoryHostConnectionState.DISCONNECTED,
	"maintenance": InventoryHostConnectionState.MAINTENANCE,
}


POWER_STATE_MAP = {
	"poweron": InventoryPowerState.POWERED_ON,
	"poweredon": InventoryPowerState.POWERED_ON,
	"powered_on": InventoryPowerState.POWERED_ON,
	"poweroff": InventoryPowerState.POWERED_OFF,
	"poweredoff": InventoryPowerState.POWERED_OFF,
	"powered_off": InventoryPowerState.POWERED_OFF,
	"suspended": InventoryPowerState.SUSPENDED,
}


@dataclass
class PollResult:
	status: InventoryEndpointStatus
	message: Optional[str]
	snapshot: Optional[VsphereSnapshot] = None


async def _upsert_datastores(
	session: AsyncSession,
	endpoint: InventoryEndpoint,
	snapshot: VsphereSnapshot,
) -> None:
	result = await session.execute(
		select(InventoryDatastore).where(InventoryDatastore.endpoint_id == endpoint.id)
	)
	existing = {datastore.name: datastore for datastore in result.scalars()}
	seen: Set[str] = set()

	for datastore_data in snapshot.datastores:
		datastore = existing.get(datastore_data.name)
		if datastore is None:
			datastore = InventoryDatastore(endpoint_id=endpoint.id, name=datastore_data.name)
			session.add(datastore)
		datastore.type = datastore_data.type
		datastore.capacity_gb = datastore_data.capacity_gb
		datastore.free_gb = datastore_data.free_gb
		datastore.last_seen_at = snapshot.collected_at
		datastore.updated_at = snapshot.collected_at
		seen.add(datastore.name)

	for name, datastore in existing.items():
		if name not in seen:
			await session.delete(datastore)

	await session.flush()


async def _upsert_networks(
	session: AsyncSession,
	endpoint: InventoryEndpoint,
	snapshot: VsphereSnapshot,
) -> None:
	result = await session.execute(
		select(InventoryNetwork).where(InventoryNetwork.endpoint_id == endpoint.id)
	)
	existing = {network.name: network for network in result.scalars()}
	seen: Set[str] = set()

	for network_data in snapshot.networks:
		network = existing.get(network_data.name)
		if network is None:
			network = InventoryNetwork(endpoint_id=endpoint.id, name=network_data.name)
			session.add(network)
		network.last_seen_at = snapshot.collected_at
		network.updated_at = snapshot.collected_at
		seen.add(network.name)

	for name, network in existing.items():
		if name not in seen:
			await session.delete(network)

	await session.flush()


async def _upsert_hosts(
	session: AsyncSession,
	endpoint: InventoryEndpoint,
	snapshot: VsphereSnapshot,
) -> Dict[str, InventoryHost]:
	result = await session.execute(
		select(InventoryHost).where(InventoryHost.endpoint_id == endpoint.id)
	)
	existing = {host.name: host for host in result.scalars()}
	seen: Set[str] = set()

	for host_data in snapshot.hosts:
		host = existing.get(host_data.name)
		if host is None:
			host = InventoryHost(endpoint_id=endpoint.id, name=host_data.name)
			session.add(host)
		host.cluster = host_data.cluster
		host.connection_state = _map_connection_state(host_data.connection_state)
		host.power_state = _map_power_state(host_data.power_state)
		host.cpu_cores = host_data.cpu_cores
		host.cpu_usage_mhz = host_data.cpu_usage_mhz
		host.memory_total_mb = host_data.memory_total_mb
		host.memory_usage_mb = host_data.memory_usage_mb
		host.uptime_seconds = host_data.uptime_seconds
		host.datastore_total_gb = host_data.datastore_total_gb
		host.datastore_free_gb = host_data.datastore_free_gb
		host.last_seen_at = snapshot.collected_at
		host.updated_at = snapshot.collected_at
		seen.add(host.name)

	for name, host in existing.items():
		if name not in seen:
			await session.delete(host)

	await session.flush()

	result = await session.execute(
		select(InventoryHost).where(InventoryHost.endpoint_id == endpoint.id)
	)
	return {host.name: host for host in result.scalars()}


async def _upsert_virtual_machines(
	session: AsyncSession,
	endpoint: InventoryEndpoint,
	hosts: Dict[str, InventoryHost],
	snapshot: VsphereSnapshot,
) -> None:
	result = await session.execute(
		select(InventoryVirtualMachine).where(InventoryVirtualMachine.endpoint_id == endpoint.id)
	)
	existing = {vm.name: vm for vm in result.scalars()}
	seen: Set[str] = set()

	for vm_data in snapshot.virtual_machines:
		vm = existing.get(vm_data.name)
		if vm is None:
			vm = InventoryVirtualMachine(endpoint_id=endpoint.id, name=vm_data.name)
			session.add(vm)

		host = hosts.get(vm_data.host_name or "")
		vm.host_id = host.id if host else None
		vm.guest_os = vm_data.guest_os
		vm.power_state = _map_power_state(vm_data.power_state)
		vm.cpu_count = vm_data.cpu_count
		vm.memory_mb = vm_data.memory_mb
		vm.cpu_usage_mhz = vm_data.cpu_usage_mhz
		vm.memory_usage_mb = vm_data.memory_usage_mb
		vm.provisioned_storage_gb = vm_data.provisioned_storage_gb
		vm.used_storage_gb = vm_data.used_storage_gb
		vm.ip_address = vm_data.ip_address
		vm.datastores = sorted({name.strip() for name in vm_data.datastores if name})
		vm.networks = sorted({name.strip() for name in vm_data.networks if name})
		vm.tools_status = vm_data.tools_status
		vm.last_seen_at = snapshot.collected_at
		vm.updated_at = snapshot.collected_at
		seen.add(vm.name)

	for name, vm in existing.items():
		if name not in seen:
			await session.delete(vm)

	await session.flush()


async def apply_snapshot(
	session: AsyncSession,
	endpoint: InventoryEndpoint,
	snapshot: VsphereSnapshot,
) -> None:
	await _upsert_datastores(session, endpoint, snapshot)
	await _upsert_networks(session, endpoint, snapshot)
	host_map = await _upsert_hosts(session, endpoint, snapshot)
	await _upsert_virtual_machines(session, endpoint, host_map, snapshot)


async def run_poll_for_endpoint(
	session: AsyncSession,
	endpoint: InventoryEndpoint,
) -> PollResult:
	started = datetime.now(timezone.utc)
	password = decrypt_secret(endpoint.password_secret)

	try:
		snapshot = await asyncio.to_thread(
			collect_inventory,
			endpoint.address,
			endpoint.port,
			endpoint.username,
			password,
			endpoint.verify_ssl,
		)
	except Exception as exc:  # pragma: no cover - runtime safety
		logger.warning(
			"Inventory poll failed",
			extra={"endpoint": str(endpoint.id), "error": str(exc)},
		)
		poll_result = PollResult(
			status=InventoryEndpointStatus.ERROR,
			message=str(exc),
			snapshot=None,
		)
	else:
		poll_result = PollResult(
			status=InventoryEndpointStatus.OK,
			message=None,
			snapshot=snapshot,
		)

	endpoint.last_polled_at = started
	endpoint.last_poll_status = poll_result.status
	endpoint.last_error_message = poll_result.message

	if poll_result.status == InventoryEndpointStatus.OK and poll_result.snapshot:
		await apply_snapshot(session, endpoint, poll_result.snapshot)

	return poll_result


class InventoryPoller:
	"""Periodic poller that syncs VMware inventory into the InfraPulse data store."""

	def __init__(
		self,
		session_factory: async_sessionmaker[AsyncSession],
		tick_seconds: int = 15,
	) -> None:
		self._session_factory = session_factory
		self._tick_seconds = tick_seconds
		self._shutdown = asyncio.Event()
		self._task: Optional[asyncio.Task[None]] = None

	async def start(self) -> None:
		if self._task and not self._task.done():
			return
		self._shutdown.clear()
		self._task = asyncio.create_task(self._run(), name="inventory-poller")
		logger.info("Inventory poller started (tick=%ss)", self._tick_seconds)

	async def stop(self) -> None:
		self._shutdown.set()
		if self._task:
			await self._task
			logger.info("Inventory poller stopped")

	async def _run(self) -> None:
		try:
			while not self._shutdown.is_set():
				await self._tick()
				try:
					await asyncio.wait_for(self._shutdown.wait(), timeout=self._tick_seconds)
				except asyncio.TimeoutError:
					continue
		except Exception:  # pragma: no cover - defensive guardrail
			logger.exception("Inventory poller encountered an unexpected error")

	async def _tick(self) -> None:
		async with self._session() as session:
			result = await session.execute(select(InventoryEndpoint))
			for endpoint in result.scalars():
				if not self._should_poll(endpoint):
					continue
				await self._process_endpoint(session, endpoint)

	async def _process_endpoint(self, session: AsyncSession, endpoint: InventoryEndpoint) -> None:
		await run_poll_for_endpoint(session, endpoint)
		await session.commit()

	def _should_poll(self, endpoint: InventoryEndpoint) -> bool:
		if endpoint.poll_interval_seconds <= 0:
			return False
		if endpoint.last_polled_at is None:
			return True
		last_polled = endpoint.last_polled_at
		if last_polled.tzinfo is None or last_polled.tzinfo.utcoffset(last_polled) is None:
			last_polled = last_polled.replace(tzinfo=timezone.utc)
		delta = datetime.now(timezone.utc) - last_polled
		return delta.total_seconds() >= endpoint.poll_interval_seconds

	@asynccontextmanager
	async def _session(self) -> AsyncGenerator[AsyncSession, None]:
		session = self._session_factory()
		try:
			yield session
		finally:
			await session.close()


def _map_connection_state(value: Optional[str]) -> InventoryHostConnectionState:
	if not value:
		return InventoryHostConnectionState.CONNECTED
	return HOST_CONNECTION_MAP.get(value.lower(), InventoryHostConnectionState.CONNECTED)


def _map_power_state(value: Optional[str]) -> InventoryPowerState:
	if not value:
		return InventoryPowerState.UNKNOWN
	return POWER_STATE_MAP.get(value.replace(" ", "").lower(), InventoryPowerState.UNKNOWN)


def build_inventory_poller(
	session_factory: async_sessionmaker[AsyncSession],
	tick_seconds: int,
) -> InventoryPoller:
	return InventoryPoller(session_factory=session_factory, tick_seconds=tick_seconds)
