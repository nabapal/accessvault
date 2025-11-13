#!/usr/bin/env bash
set -euo pipefail

DEV_DEBUG_BACKEND="${DEV_DEBUG_BACKEND:-0}"
if [[ "${1:-}" == "--debug-backend" ]]; then
  DEV_DEBUG_BACKEND=1
  shift
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"
FRONTEND_DIR="${ROOT_DIR}/frontend"
VENV_BIN="${ROOT_DIR}/.venv/bin"
LOG_DIR="${ROOT_DIR}/logs"

mkdir -p "${LOG_DIR}"

: > "${LOG_DIR}/backend.log"
: > "${LOG_DIR}/frontend.log"

if [[ "${DEV_DEBUG_BACKEND}" == "1" ]]; then
  echo "[dev][debug] Backend debug mode enabled"
  command -v python >/dev/null 2>&1 && python --version 2>&1 | sed 's/^/[dev][debug] /'
  command -v uvicorn >/dev/null 2>&1 && uvicorn --version 2>&1 | sed 's/^/[dev][debug] /'
fi

if [[ -d "${VENV_BIN}" ]]; then
  # shellcheck source=/dev/null
  source "${VENV_BIN}/activate"
else
  echo "[dev] Warning: .venv not found. Backend will run with system Python." >&2
fi

# Ensure backend dependencies (including Alembic) are installed.
if [[ -n "${VIRTUAL_ENV:-}" ]]; then
  PIP_BIN="$(command -v pip)"
else
  PIP_BIN="${VENV_BIN}/pip"
fi

if [[ -x "${PIP_BIN}" ]]; then
  pushd "${BACKEND_DIR}" >/dev/null
  echo "[dev] Ensuring backend requirements are installed..."
  "${PIP_BIN}" install -r requirements.txt >/dev/null
  if [[ "${DEV_DEBUG_BACKEND}" == "1" ]]; then
    echo "[dev][debug] Backend dependencies verified via ${PIP_BIN}"
  fi
  popd >/dev/null
else
  echo "[dev] Warning: pip not found; skipping backend dependency check." >&2
fi

pushd "${BACKEND_DIR}" >/dev/null
if [[ ! -f ".env" ]]; then
  echo "[dev] Warning: backend/.env not found. Copy backend/.env.example and update secrets." >&2
fi
UVICORN_LOG_LEVEL="${UVICORN_LOG_LEVEL:-info}"
if [[ "${DEV_DEBUG_BACKEND}" == "1" ]]; then
  UVICORN_LOG_LEVEL="debug"
fi
backend_cmd=(uvicorn app.main:app --reload --host 0.0.0.0 --port 8002 --log-level "${UVICORN_LOG_LEVEL}")
if [[ "${DEV_DEBUG_BACKEND}" == "1" ]]; then
  echo "[dev][debug] Launching backend: ${backend_cmd[*]}"
fi
"${backend_cmd[@]}" >> "${LOG_DIR}/backend.log" 2>&1 &
BACKEND_PID=$!
popd >/dev/null

echo "[dev] FastAPI backend running on http://localhost:8002 (pid: ${BACKEND_PID})"
echo "[dev] Backend log: ${LOG_DIR}/backend.log"

cleanup() {
  if ps -p "${BACKEND_PID}" >/dev/null 2>&1; then
    echo "[dev] Stopping backend (pid: ${BACKEND_PID})"
    kill "${BACKEND_PID}" >/dev/null 2>&1 || true
  elif [[ "${DEV_DEBUG_BACKEND}" == "1" ]]; then
    echo "[dev][debug] Backend process ${BACKEND_PID} already exited"
  fi
}
trap cleanup EXIT

pushd "${FRONTEND_DIR}" >/dev/null
if [[ ! -d node_modules ]]; then
  echo "[dev] Installing frontend dependencies"
  npm install
fi

echo "[dev] Starting frontend dev server on http://localhost:5173"
npm run dev -- --host 0.0.0.0 --port 5173 2>&1 | tee -a "${LOG_DIR}/frontend.log"
popd >/dev/null
