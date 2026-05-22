#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"
PID_FILE="$LOG_DIR/seller-crawl-periodic.pid"
OUT_LOG="$LOG_DIR/seller-crawl-periodic.out.log"
ERR_LOG="$LOG_DIR/seller-crawl-periodic.err.log"
LAUNCHD_LABEL="com.sellerdb.crawler"
LAUNCHD_PLIST="$HOME/Library/LaunchAgents/${LAUNCHD_LABEL}.plist"
ACTION="${1:-status}"

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

mkdir -p "$LOG_DIR"

use_launchd() {
  [[ "${CRAWLER_USE_LAUNCHD:-0}" == "1" ]] && [[ "$(uname -s)" == "Darwin" ]] && command -v launchctl >/dev/null 2>&1
}

launchd_domain() {
  echo "gui/$(id -u)"
}

xml_escape() {
  sed -e "s/&/\\&amp;/g" -e "s/</\\&lt;/g" -e "s/>/\\&gt;/g" -e "s/\"/\\&quot;/g" -e "s/'/\\&apos;/g"
}

plist_string() {
  local value
  value="$(printf "%s" "$1" | xml_escape)"
  printf "    <string>%s</string>\n" "$value"
}

write_launchd_plist() {
  local interval_minutes="$1"
  shift

  mkdir -p "$(dirname "$LAUNCHD_PLIST")" "$LOG_DIR"
  {
    printf "%s\n" "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
    printf "%s\n" "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">"
    printf "%s\n" "<plist version=\"1.0\">"
    printf "%s\n" "<dict>"
    printf "%s\n" "  <key>Label</key>"
    plist_string "$LAUNCHD_LABEL"
    printf "%s\n" "  <key>ProgramArguments</key>"
    printf "%s\n" "  <array>"
    plist_string "/bin/bash"
    plist_string "$ROOT_DIR/scripts/crawler_loop.sh"
    plist_string "$interval_minutes"
    for arg in "$@"; do
      plist_string "$arg"
    done
    printf "%s\n" "  </array>"
    printf "%s\n" "  <key>WorkingDirectory</key>"
    plist_string "$ROOT_DIR"
    printf "%s\n" "  <key>RunAtLoad</key>"
    printf "%s\n" "  <true/>"
    printf "%s\n" "  <key>KeepAlive</key>"
    printf "%s\n" "  <true/>"
    printf "%s\n" "  <key>StandardOutPath</key>"
    plist_string "$OUT_LOG"
    printf "%s\n" "  <key>StandardErrorPath</key>"
    plist_string "$ERR_LOG"
    printf "%s\n" "</dict>"
    printf "%s\n" "</plist>"
  } >"$LAUNCHD_PLIST"
}

start_launchd() {
  local interval_minutes="${CRAWLER_INTERVAL_MINUTES:-360}"
  local domain
  domain="$(launchd_domain)"

  write_launchd_plist "$interval_minutes" "$@"
  launchctl bootout "$domain" "$LAUNCHD_PLIST" >/dev/null 2>&1 || true
  launchctl bootstrap "$domain" "$LAUNCHD_PLIST"
  launchctl kickstart -k "$domain/$LAUNCHD_LABEL" >/dev/null 2>&1 || true
  rm -f "$PID_FILE"

  echo "seller-crawl-periodic launch agent started (${LAUNCHD_LABEL}, interval ${interval_minutes}m)."
  echo "plist: $LAUNCHD_PLIST"
  echo "logs: $OUT_LOG"
}

stop_launchd() {
  local domain
  domain="$(launchd_domain)"
  launchctl bootout "$domain" "$LAUNCHD_PLIST" >/dev/null 2>&1 || true
  rm -f "$PID_FILE"
  echo "seller-crawl-periodic launch agent stopped."
}

status_launchd() {
  local domain
  domain="$(launchd_domain)"
  if launchctl print "$domain/$LAUNCHD_LABEL" >/dev/null 2>&1; then
    echo "seller-crawl-periodic launch agent is loaded (${LAUNCHD_LABEL})."
  else
    echo "seller-crawl-periodic launch agent is not loaded."
  fi
}

is_running() {
  [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

start() {
  if use_launchd; then
    start_launchd "$@"
    return
  fi

  if is_running; then
    echo "seller-crawl-periodic is already running (pid $(cat "$PID_FILE"))."
    return
  fi

  local interval_minutes="${CRAWLER_INTERVAL_MINUTES:-360}"
  (
    cd "$ROOT_DIR"
    nohup "$ROOT_DIR/scripts/crawler_loop.sh" "$interval_minutes" "$@" \
      >>"$OUT_LOG" 2>>"$ERR_LOG" &
    echo $! >"$PID_FILE"
  )

  echo "seller-crawl-periodic started (pid $(cat "$PID_FILE"), interval ${interval_minutes}m)."
  echo "logs: $OUT_LOG"
}

stop() {
  if use_launchd; then
    stop_launchd
    return
  fi

  if ! is_running; then
    rm -f "$PID_FILE"
    echo "seller-crawl-periodic is not running."
    return
  fi

  local pid
  pid="$(cat "$PID_FILE")"
  kill "$pid"
  rm -f "$PID_FILE"
  echo "seller-crawl-periodic stopped (pid $pid)."
}

status() {
  if use_launchd; then
    status_launchd
    return
  fi

  if is_running; then
    echo "seller-crawl-periodic is running (pid $(cat "$PID_FILE"))."
  else
    rm -f "$PID_FILE"
    echo "seller-crawl-periodic is not running."
  fi
}

case "$ACTION" in
  start)
    start "$@"
    ;;
  stop)
    stop
    ;;
  restart)
    stop
    start "$@"
    ;;
  status)
    status
    ;;
  logs)
    touch "$OUT_LOG" "$ERR_LOG"
    tail -n 80 -f "$OUT_LOG" "$ERR_LOG"
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|logs} [pipeline args...]" >&2
    exit 1
    ;;
esac
