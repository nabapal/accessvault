#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/backend/.env.docker"
DATA_DIR="${ROOT_DIR}/data"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "[deploy] Missing backend/.env.docker. Copy backend/.env.docker.example and provide production secrets." >&2
  exit 1
fi

mkdir -p "${DATA_DIR}"

ADMIN_EMAIL="${ADMIN_EMAIL:-}";
if [[ -z "${ADMIN_EMAIL}" ]]; then
  read -rp "Admin email: " ADMIN_EMAIL
fi

ADMIN_NAME="${ADMIN_NAME:-}";
if [[ -z "${ADMIN_NAME}" ]]; then
  read -rp "Full name: " ADMIN_NAME
fi

ADMIN_PASSWORD="${ADMIN_PASSWORD:-}";
if [[ -z "${ADMIN_PASSWORD}" ]]; then
  read -rsp "Admin password: " ADMIN_PASSWORD
  echo
fi

cd "${ROOT_DIR}"

echo "[deploy] Building and starting containers..."
docker compose up --build -d

echo "[deploy] Giving backend a moment to start..."
sleep 5

echo "[deploy] Seeding admin user (email: ${ADMIN_EMAIL})..."
docker compose exec -T \
  -e ADMIN_EMAIL="${ADMIN_EMAIL}" \
  -e ADMIN_NAME="${ADMIN_NAME}" \
  -e ADMIN_PASSWORD="${ADMIN_PASSWORD}" \
  backend python - <<'PY'
import asyncio
import os
from sqlalchemy import select

from app.core.database import AsyncSessionLocal, Base, engine
from app.core.security import get_password_hash
from app.models import User, UserRoleEnum

ADMIN_EMAIL = os.environ["ADMIN_EMAIL"]
ADMIN_NAME = os.environ["ADMIN_NAME"]
ADMIN_PASSWORD = os.environ["ADMIN_PASSWORD"]

async def main() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User).where(User.email == ADMIN_EMAIL))
        existing = result.scalar_one_or_none()
        if existing:
            print("[seed-admin] Admin already exists; skipping creation.")
            return

        admin = User(
            email=ADMIN_EMAIL,
            full_name=ADMIN_NAME,
            hashed_password=get_password_hash(ADMIN_PASSWORD),
            role=UserRoleEnum.ADMIN,
        )
        session.add(admin)
        await session.commit()
        print("[seed-admin] Admin user created.")

asyncio.run(main())
PY

echo "[deploy] Deployment complete. Frontend available on http://localhost/"
