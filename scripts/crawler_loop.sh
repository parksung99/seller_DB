#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INTERVAL_MINUTES="${1:-360}"
SKIP_RETRY_MINUTES="${CRAWLER_SKIP_RETRY_MINUTES:-10}"

if [[ $# -gt 0 ]]; then
  shift
fi

NODE_BIN="${NODE_BIN:-}"
if [[ -z "$NODE_BIN" ]]; then
  NODE_BIN="$(command -v node || true)"
fi
if [[ -z "$NODE_BIN" && -x "/Applications/Codex.app/Contents/Resources/node" ]]; then
  NODE_BIN="/Applications/Codex.app/Contents/Resources/node"
fi
if [[ -z "$NODE_BIN" ]]; then
  echo "node was not found. Set NODE_BIN=/path/to/node and try again." >&2
  exit 1
fi

if [[ $# -gt 0 ]]; then
  PIPELINE_ARGS=("$@")
else
  PIPELINE_ARGS=(
    "--cookie-file"
    "ig_cookie.txt"
    "--delay-ms"
    "8000"
    "--limit"
    "20"
    "--refresh-limit"
    "120"
  )
fi

timestamp() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

existing_pipeline_running() {
  command -v pgrep >/dev/null 2>&1 && pgrep -f "node .*scripts/crawl_import_refresh.mjs" >/dev/null 2>&1
}

cd "$ROOT_DIR"

echo "[crawler-loop] $(timestamp) interval: ${INTERVAL_MINUTES} minutes"
echo "[crawler-loop] $(timestamp) pipeline args: ${PIPELINE_ARGS[*]}"

while true; do
  if existing_pipeline_running; then
    echo "[crawler-loop] $(timestamp) another crawl_import_refresh process is running; retrying in ${SKIP_RETRY_MINUTES} minutes"
    sleep "$((SKIP_RETRY_MINUTES * 60))"
    continue
  fi

  echo "[crawler-loop] $(timestamp) run started"
  if "$NODE_BIN" scripts/crawl_import_refresh.mjs "${PIPELINE_ARGS[@]}"; then
    echo "[crawler-loop] $(timestamp) run completed"
  else
    code=$?
    echo "[crawler-loop] $(timestamp) run failed with code ${code}"
  fi

  echo "[crawler-loop] $(timestamp) next run in ${INTERVAL_MINUTES} minutes"
  sleep "$((INTERVAL_MINUTES * 60))"
done
