from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import AsyncGenerator, Optional

from sqlalchemy import select
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import NxosDevice
from app.services.nxos_collector import run_collection_for_device

logger = logging.getLogger(__name__)


class NxosPoller:
    """Periodic poller that refreshes Cisco NX-OS device inventory over SSH."""

    def __init__(self, session_factory: async_sessionmaker[AsyncSession], tick_seconds: int = 30) -> None:
        self._session_factory = session_factory
        self._tick_seconds = tick_seconds
        self._shutdown = asyncio.Event()
        self._task: Optional[asyncio.Task[None]] = None

    async def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._shutdown.clear()
        self._task = asyncio.create_task(self._run(), name="nxos-poller")
        logger.info("NX-OS poller started (tick=%ss)", self._tick_seconds)

    async def stop(self) -> None:
        self._shutdown.set()
        if self._task:
            await self._task
            logger.info("NX-OS poller stopped")

    async def _run(self) -> None:
        while not self._shutdown.is_set():
            try:
                await self._tick()
            except Exception:  # pragma: no cover - defensive guardrail
                logger.exception("NX-OS poller tick failed; continuing")
            try:
                await asyncio.wait_for(self._shutdown.wait(), timeout=self._tick_seconds)
            except asyncio.TimeoutError:
                continue

    async def _tick(self) -> None:
        async with self._session() as session:
            result = await session.execute(select(NxosDevice))
            devices = list(result.scalars().all())
            for device in devices:
                if not self._should_poll(device):
                    continue
                try:
                    await self._process_device(session, device)
                except Exception:
                    logger.exception("NX-OS device poll failed", extra={"device": str(device.id)})
                    await session.rollback()

    async def _process_device(self, session: AsyncSession, device: NxosDevice) -> None:
        for attempt in range(3):
            try:
                await run_collection_for_device(session, device)
                await session.commit()
                return
            except OperationalError as exc:
                await session.rollback()
                if "database is locked" in str(exc).lower() and attempt < 2:
                    await asyncio.sleep(0.5 * (attempt + 1))
                    continue
                raise
            except Exception:
                await session.rollback()
                raise

    def _should_poll(self, device: NxosDevice) -> bool:
        if device.poll_interval_seconds <= 0:
            return False
        if device.last_polled_at is None:
            return True
        last = device.last_polled_at
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - last).total_seconds() >= device.poll_interval_seconds

    @asynccontextmanager
    async def _session(self) -> AsyncGenerator[AsyncSession, None]:
        session = self._session_factory()
        try:
            yield session
        finally:
            await session.close()


def build_nxos_poller(
    session_factory: async_sessionmaker[AsyncSession],
    tick_seconds: int,
) -> NxosPoller:
    return NxosPoller(session_factory=session_factory, tick_seconds=tick_seconds)
