from __future__ import annotations

import asyncio
from pathlib import Path

from alembic import command
from alembic.config import Config

from app.core.config import get_settings

ALEMBIC_INI_PATH = Path(__file__).resolve().parents[2] / "alembic.ini"
MIGRATIONS_PATH = Path(__file__).resolve().parents[2] / "migrations"


def _build_config() -> Config:
    config = Config(str(ALEMBIC_INI_PATH))
    config.set_main_option("script_location", str(MIGRATIONS_PATH))
    config.set_main_option("sqlalchemy.url", get_settings().database_url)
    return config


async def run_migrations() -> None:
    """Apply database migrations up to the latest revision."""

    config = _build_config()
    await asyncio.to_thread(command.upgrade, config, "head")
