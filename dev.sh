#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"
FRONTEND_DIR="${ROOT_DIR}/frontend"
VENV_BIN="${ROOT_DIR}/.venv/bin"

if [[ -d "${VENV_BIN}" ]]; then
  # shellcheck source=/dev/null
  source "${VENV_BIN}/activate"
else
  echo "[dev] Warning: .venv not found. Backend will run with system Python." >&2
fi

pushd "${BACKEND_DIR}" >/dev/null
if [[ ! -f ".env" ]]; then
  echo "[dev] Warning: backend/.env not found. Copy backend/.env.example and update secrets." >&2
fi
uvicorn app.main:app --reload --host 0.0.0.0 --port 8002 &
BACKEND_PID=$!
popd >/dev/null

echo "[dev] FastAPI backend running on http://localhost:8002 (pid: ${BACKEND_PID})"

cleanup() {
  if ps -p "${BACKEND_PID}" >/dev/null 2>&1; then
    echo "[dev] Stopping backend (pid: ${BACKEND_PID})"
    kill "${BACKEND_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

pushd "${FRONTEND_DIR}" >/dev/null
if [[ ! -d node_modules ]]; then
  echo "[dev] Installing frontend dependencies"
  npm install
fi

echo "[dev] Starting frontend dev server on http://localhost:5173"
npm run dev -- --host 0.0.0.0 --port 5173
popd >/dev/null
