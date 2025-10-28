from __future__ import annotations

import logging
import asyncio
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, AsyncGenerator, Dict, Iterable, List, Optional

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import AciFabricNode
from app.models.telco import TelcoFabricOnboardingJob, TelcoFabricType, TelcoOnboardingStatus
from app.services.crypto import decrypt_secret

logger = logging.getLogger(__name__)


@dataclass
class TelcoCollectionResult:
    success: bool
    timestamp: datetime
    snapshot: Optional[Dict[str, Any]] = None
    message: Optional[str] = None


class TelcoCollectionError(Exception):
    """Raised when a Telco collection run fails for a known reason."""


async def run_collection_for_job(
    session: AsyncSession,
    job: TelcoFabricOnboardingJob,
    password_override: Optional[str] = None,
) -> TelcoCollectionResult:
    password = password_override
    if password is None:
        if job.password_secret is None:
            return TelcoCollectionResult(
                success=False,
                timestamp=datetime.now(timezone.utc),
                message="No credentials stored for this fabric.",
            )
        password = decrypt_secret(job.password_secret)

    timestamp = datetime.now(timezone.utc)

    try:
        if job.fabric_type == TelcoFabricType.ACI:
            snapshot = await _collect_aci_fabric(session, job, password)
        elif job.fabric_type == TelcoFabricType.NXOS:
            snapshot = await _collect_nxos_fabric(job, password)
        else:  # pragma: no cover - defensive guard
            raise TelcoCollectionError(f"Unsupported fabric type: {job.fabric_type}")
    except TelcoCollectionError as exc:
        logger.warning("Telco collection error", extra={"job": str(job.id), "error": str(exc)})
        return TelcoCollectionResult(success=False, timestamp=timestamp, message=str(exc))
    except httpx.HTTPError as exc:
        logger.warning("HTTP error during telco collection", extra={"job": str(job.id), "error": str(exc)})
        return TelcoCollectionResult(success=False, timestamp=timestamp, message=str(exc))
    except Exception as exc:  # pragma: no cover - runtime safety
        logger.exception("Unexpected error during telco collection", extra={"job": str(job.id)})
        return TelcoCollectionResult(success=False, timestamp=timestamp, message=str(exc))

    return TelcoCollectionResult(success=True, timestamp=timestamp, snapshot=snapshot)


async def _collect_aci_fabric(
    session: AsyncSession,
    job: TelcoFabricOnboardingJob,
    password: str,
) -> Dict[str, Any]:
    if not job.username:
        raise TelcoCollectionError("Username is required for Cisco ACI fabrics.")

    base_url = _build_base_url(job, default_scheme=job.connection_params.get("protocol", "https"))
    timeout = httpx.Timeout(30.0, read=60.0)
    login_payload = {"aaaUser": {"attributes": {"name": job.username, "pwd": password}}}

    async with httpx.AsyncClient(base_url=base_url, verify=job.verify_ssl, timeout=timeout) as client:
        response = await client.post("/api/aaaLogin.json", json=login_payload)
        response.raise_for_status()
        login_data = response.json()
        try:
            token = login_data["imdata"][0]["aaaLogin"]["attributes"]["token"]
        except (KeyError, IndexError) as exc:  # pragma: no cover - defensive parsing
            raise TelcoCollectionError("Unexpected login response from APIC.") from exc

        client.cookies.set("APIC-cookie", token)
        fabric_response = await client.get("/api/class/fabricNode.json")
        fabric_response.raise_for_status()
        payload = fabric_response.json()

    items = payload.get("imdata", [])
    count = await _upsert_aci_nodes(session, items, job)
    await session.flush()

    return {"fabric_node_count": count}


async def _collect_nxos_fabric(
    job: TelcoFabricOnboardingJob,
    password: str,
) -> Dict[str, Any]:
    if not job.username:
        raise TelcoCollectionError("Username is required for NX-OS fabrics.")

    transport = (job.connection_params.get("transport") or "nxapi-https").lower()
    if transport == "ssh":
        raise TelcoCollectionError("SSH transport is not yet supported. Enable NX-API and select nxapi-http or nxapi-https.")

    scheme = "https" if transport.endswith("https") else "http"
    base_url = _build_base_url(job, default_scheme=scheme)
    verify = job.verify_ssl if scheme == "https" else False
    timeout = httpx.Timeout(20.0, read=40.0)

    payload = {
        "ins_api": {
            "version": "1.0",
            "type": "cli_show",
            "chunk": "0",
            "sid": "1",
            "input": "show inventory",
            "output_format": "json",
        }
    }

    async with httpx.AsyncClient(base_url=base_url, verify=verify, timeout=timeout, auth=(job.username, password)) as client:
        response = await client.post("/ins", json=payload)
        response.raise_for_status()
        data = response.json()

    modules = _parse_nxos_inventory(data)
    return {
        "module_count": len(modules),
        "modules": modules[:10],
    }


async def _upsert_aci_nodes(
    session: AsyncSession,
    items: Iterable[Dict[str, Any]],
    job: TelcoFabricOnboardingJob,
) -> int:
    total = 0
    for item in items:
        attributes = item.get("fabricNode", {}).get("attributes") if isinstance(item, dict) else None
        if not attributes:
            continue
        dn = attributes.get("dn")
        if not dn:
            continue
        result = await session.execute(
            select(AciFabricNode).where(
                AciFabricNode.distinguished_name == dn,
                AciFabricNode.fabric_job_id == job.id,
            )
        )
        node = result.scalar_one_or_none()
        if node is None:
            node = AciFabricNode(
                distinguished_name=dn,
                name=attributes.get("name") or dn.split("/")[-1],
                node_id=attributes.get("id") or dn,
                fabric_job_id=job.id,
            )
            session.add(node)
        else:
            node.fabric_job_id = job.id
        node.update_from_attributes(attributes)
        total += 1
    return total


def _parse_nxos_inventory(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    outputs = data.get("ins_api", {}).get("outputs", {}).get("output")
    if outputs is None:
        return []
    if isinstance(outputs, dict):
        outputs = [outputs]

    modules: List[Dict[str, Any]] = []
    for output in outputs:
        body = output.get("body") if isinstance(output, dict) else None
        if not body:
            continue
        table = body.get("TABLE_inv")
        if not table:
            continue
        rows = table.get("ROW_inv")
        if rows is None:
            continue
        if isinstance(rows, dict):
            rows = [rows]
        for row in rows:
            if not isinstance(row, dict):
                continue
            modules.append(
                {
                    "name": row.get("name"),
                    "description": row.get("descr") or row.get("description"),
                    "serial": row.get("serialnum"),
                    "pid": row.get("productid") or row.get("pid"),
                }
            )
    return modules


def _build_base_url(job: TelcoFabricOnboardingJob, default_scheme: str) -> str:
    scheme = (default_scheme or "https").lower()
    host = job.target_host.strip()
    port = job.port

    if (scheme == "http" and port == 80) or (scheme == "https" and port == 443):
        return f"{scheme}://{host}"
    return f"{scheme}://{host}:{port}"


class TelcoFabricPoller:
    """Periodic poller responsible for refreshing Telco fabric data."""

    def __init__(self, session_factory: async_sessionmaker[AsyncSession], tick_seconds: int = 60) -> None:
        self._session_factory = session_factory
        self._tick_seconds = tick_seconds
        self._shutdown = False
        self._task: Optional[asyncio.Task[None]] = None

    async def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._shutdown = False
        self._task = asyncio.create_task(self._run(), name="telco-fabric-poller")
        logger.info("Telco fabric poller started (tick=%ss)", self._tick_seconds)

    async def stop(self) -> None:
        self._shutdown = True
        if self._task:
            await self._task
            logger.info("Telco fabric poller stopped")

    async def _run(self) -> None:
        try:
            while not self._shutdown:
                await self._tick()
                await asyncio.sleep(self._tick_seconds)
        except Exception:  # pragma: no cover - defensive guard
            logger.exception("Telco fabric poller encountered an unexpected error")

    async def _tick(self) -> None:
        async with self._session() as session:
            result = await session.execute(select(TelcoFabricOnboardingJob))
            jobs = result.scalars().all()
            for job in jobs:
                if not self._should_poll(job):
                    continue
                job.start_validation()
                collection = await run_collection_for_job(session, job)
                if collection.success:
                    job.mark_validation_success()
                    job.last_snapshot = collection.snapshot
                    job.last_polled_at = collection.timestamp
                else:
                    job.mark_validation_failure(collection.message)
                    job.last_snapshot = None
                await session.commit()

    def _should_poll(self, job: TelcoFabricOnboardingJob) -> bool:
        if job.poll_interval_seconds <= 0:
            return False
        if job.status == TelcoOnboardingStatus.VALIDATING:
            return False
        if job.last_polled_at is None:
            return True
        last_polled = job.last_polled_at
        if last_polled.tzinfo is None:
            # Legacy records stored without timezone; treat as UTC to avoid crashes.
            last_polled = last_polled.replace(tzinfo=timezone.utc)
        delta = datetime.now(timezone.utc) - last_polled
        return delta.total_seconds() >= job.poll_interval_seconds

    @asynccontextmanager
    async def _session(self) -> AsyncGenerator[AsyncSession, None]:
        session = self._session_factory()
        try:
            yield session
        finally:
            await session.close()


def build_telco_poller(
    session_factory: async_sessionmaker[AsyncSession],
    tick_seconds: int,
) -> TelcoFabricPoller:
    return TelcoFabricPoller(session_factory=session_factory, tick_seconds=tick_seconds)
