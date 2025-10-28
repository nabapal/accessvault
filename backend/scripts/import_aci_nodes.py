#!/usr/bin/env python3
"""Utility script to populate ACI fabric nodes from a sample JSON payload."""
from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
from typing import Any, Dict

from dotenv import load_dotenv
from sqlalchemy import select

from app.core.database import AsyncSessionLocal, Base, engine
from app.models import AciFabricNode


def load_payload(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


async def upsert_fabric_nodes(payload: Dict[str, Any]) -> int:
    items = payload.get("imdata", [])
    total = 0
    async with AsyncSessionLocal() as session:
        for item in items:
            attributes = item.get("fabricNode", {}).get("attributes")
            if not attributes:
                continue
            dn = attributes.get("dn")
            if not dn:
                continue
            result = await session.execute(
                select(AciFabricNode).where(AciFabricNode.distinguished_name == dn)
            )
            node = result.scalar_one_or_none()
            if node is None:
                node = AciFabricNode(
                    distinguished_name=dn,
                    name=attributes.get("name") or dn.split("/")[-1],
                    node_id=attributes.get("id") or dn,
                )
                session.add(node)
            node.update_from_attributes(attributes)
            total += 1
        await session.commit()
    return total


async def main() -> None:
    parser = argparse.ArgumentParser(description="Import ACI fabric nodes into the database from a JSON sample.")
    parser.add_argument(
        "--file",
        type=Path,
        default=Path("backend/data/samples/aci/api_class_fabricNode.json.json"),
        help="Path to the JSON payload exported from the APIC fabricNode class.",
    )
    parser.add_argument(
        "--dotenv",
        type=Path,
        default=Path("backend/.env"),
        help="Optional path to a .env file with database settings.",
    )
    args = parser.parse_args()

    if args.dotenv.exists():
        load_dotenv(args.dotenv)

    payload = load_payload(args.file)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    count = await upsert_fabric_nodes(payload)
    print(f"Imported {count} fabric nodes from {args.file}.")


if __name__ == "__main__":
    asyncio.run(main())
