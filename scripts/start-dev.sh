#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

if [[ ! -x "$BACKEND_DIR/.venv/bin/uvicorn" ]]; then
  echo "Backend virtual environment not found. Run the backend setup in README.md first." >&2
  exit 1
fi

if [[ ! -x "$FRONTEND_DIR/node_modules/.bin/next" ]]; then
  echo "Frontend dependencies not found. Run npm install in frontend first." >&2
  exit 1
fi

backend_pid=""
frontend_pid=""

cleanup() {
  trap - EXIT INT TERM

  if [[ -n "$backend_pid" ]] && kill -0 "$backend_pid" 2>/dev/null; then
    kill "$backend_pid" 2>/dev/null || true
  fi

  if [[ -n "$frontend_pid" ]] && kill -0 "$frontend_pid" 2>/dev/null; then
    kill "$frontend_pid" 2>/dev/null || true
  fi

  wait "$backend_pid" "$frontend_pid" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

if [[ ! -f "$BACKEND_DIR/.env" || ! -f "$FRONTEND_DIR/.env.local" ]]; then
  echo "Configure private environment files first; see README-SCRUM-22.md." >&2
  exit 1
fi

echo "Starting backend at http://localhost:8022..."
(
  cd "$BACKEND_DIR"
  exec .venv/bin/uvicorn app.main:app --reload --port 8022 --env-file .env
) &
backend_pid=$!

echo "Starting frontend at http://localhost:3022/login..."
(
  cd "$FRONTEND_DIR"
  exec npm run dev -- --hostname localhost --port 3022
) &
frontend_pid=$!

while kill -0 "$backend_pid" 2>/dev/null && kill -0 "$frontend_pid" 2>/dev/null; do
  sleep 1
done

wait "$backend_pid" "$frontend_pid"
