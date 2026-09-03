#!/bin/sh
# Starts MxScout on http://127.0.0.1:4288 (override with MXSCOUT_PORT), and
# opens it in the default browser once it actually answers — no dependency,
# just whatever opener the OS already has (open / xdg-open / Windows' own).
cd "$(dirname "$0")" || exit 1

PORT="${MXSCOUT_PORT:-4288}"
URL="http://127.0.0.1:$PORT"

# A Node.js kept in this folder wins over the machine's own, so a copy of
# MxScout that was handed a runtime (or fetched one through MxScout.command)
# runs the same way on a machine that has none installed.
NODE="node"
[ -x "./runtime/bin/node" ] && NODE="./runtime/bin/node"

open_when_ready() {
  # Polls rather than sleeping a fixed guess, so this opens the moment the
  # server is actually listening — not before (a "connection refused" tab)
  # and not later than it has to be.
  i=0
  while [ "$i" -lt 50 ]; do
    if command -v curl >/dev/null 2>&1; then
      curl -s -o /dev/null "$URL/api/health" 2>/dev/null && break
    else
      sleep 1
      break
    fi
    i=$((i + 1))
    sleep 0.2
  done
  case "$(uname -s)" in
    Darwin) open "$URL" 2>/dev/null ;;
    MINGW*|MSYS*|CYGWIN*) cmd.exe /c start "" "$URL" 2>/dev/null ;;
    *) command -v xdg-open >/dev/null 2>&1 && xdg-open "$URL" 2>/dev/null ;;
  esac
}

open_when_ready &
exec "$NODE" server/index.js
