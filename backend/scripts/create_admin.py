"""Backward-compatible entrypoint for creating an admin user."""

import asyncio

from app.scripts.create_admin import main


if __name__ == "__main__":
    asyncio.run(main())
