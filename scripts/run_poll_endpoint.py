#!/usr/bin/env python3
"""Run inventory poll for a specific endpoint and print results.

Usage: python scripts/run_poll_endpoint.py [endpoint_address]
If no address provided, polls all endpoints in the database.
"""
import asyncio
import logging
import sys

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models import InventoryEndpoint, InventoryHost
from app.services.inventory_poller import run_poll_for_endpoint

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def main(address: str | None = None):
    async with AsyncSessionLocal() as session:
        if address:
            result = await session.execute(select(InventoryEndpoint).where(InventoryEndpoint.address == address))
            endpoints = [result.scalar_one_or_none()] if result.scalar_one_or_none() else []
        else:
            result = await session.execute(select(InventoryEndpoint))
            endpoints = result.scalars().all()

        if not endpoints:
            print("No inventory endpoints found (check backend DB).")
            return

        for endpoint in endpoints:
            print(f"Polling endpoint: {endpoint.name} ({endpoint.address})")
            poll_result = await run_poll_for_endpoint(session, endpoint)
            await session.commit()
            print(f"Poll status: {poll_result.status} message={poll_result.message}")

            # Show hosts we have for this endpoint after poll
            res = await session.execute(select(InventoryHost).where(InventoryHost.endpoint_id == endpoint.id))
            hosts = res.scalars().all()
            for h in hosts:
                print(f"HOST: {h.name} serial={h.serial} model={h.hardware_model} site={h.site_name} rack={h.rack_location}")


if __name__ == "__main__":
    addr = sys.argv[1] if len(sys.argv) > 1 else None
    asyncio.run(main(addr))
