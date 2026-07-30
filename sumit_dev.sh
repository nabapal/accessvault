#!/usr/bin/env bash
set -euo pipefail

# sumit_dev.sh — a parallel dev environment on alternate ports so it can run
# alongside dev.sh without clashing. Backend: 8300, Frontend: 5273.
BACKEND_PORT="${BACKEND_PORT:-8300}"
FRONTEND_PORT="${FRONTEND_PORT:-5273}"

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

: > "${LOG_DIR}/backend_sumit.log"
: > "${LOG_DIR}/frontend_sumit.log"

# Free the dev ports up front. A previous run that didn't shut down cleanly can
# leave an orphaned uvicorn holding the port (-> "[Errno 98] Address already in
# use"), which silently breaks the backend and leaves the UI stuck on sign-in.
free_port() {
  local port="$1"
  local pids=""
  if command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -ti tcp:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
  elif command -v fuser >/dev/null 2>&1; then
    pids="$(fuser "${port}"/tcp 2>/dev/null || true)"
  fi
  if [[ -n "${pids}" ]]; then
    echo "[dev] Freeing port ${port} (stopping: ${pids})"
    kill ${pids} >/dev/null 2>&1 || true
    sleep 1
    for pid in ${pids}; do
      ps -p "${pid}" >/dev/null 2>&1 && kill -9 "${pid}" >/dev/null 2>&1 || true
    done
  fi
}

free_port "${BACKEND_PORT}"
free_port "${FRONTEND_PORT}"

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
backend_cmd=(uvicorn app.main:app --reload --host 0.0.0.0 --port "${BACKEND_PORT}" --log-level "${UVICORN_LOG_LEVEL}")
if [[ "${DEV_DEBUG_BACKEND}" == "1" ]]; then
  echo "[dev][debug] Launching backend: ${backend_cmd[*]}"
fi
"${backend_cmd[@]}" >> "${LOG_DIR}/backend_sumit.log" 2>&1 &
BACKEND_PID=$!
popd >/dev/null

echo "[dev] FastAPI backend running on http://localhost:${BACKEND_PORT} (pid: ${BACKEND_PID})"
echo "[dev] Backend log: ${LOG_DIR}/backend_sumit.log"

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

# Point the Vite dev server + proxy at the alternate ports (vite.config.ts
# reads these with sensible defaults).
export VITE_DEV_PORT="${FRONTEND_PORT}"
export VITE_BACKEND_URL="http://localhost:${BACKEND_PORT}"

echo "[dev] Starting frontend dev server on http://localhost:${FRONTEND_PORT}"
npm run dev -- --host 0.0.0.0 --port "${FRONTEND_PORT}" 2>&1 | tee -a "${LOG_DIR}/frontend_sumit.log"
popd >/dev/null
