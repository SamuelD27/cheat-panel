#!/bin/sh
# LaunchAgent entry point for the LCP river writer (label local.lcp.river-writer, installed by install-launch-agent.sh).
# launchd starts this when Civ VII launches (the game rewrites AppOptions.txt at every launch) and at login. It runs
# river_watch.py --with-game, which waits briefly for the game, writes what the panel queues while the game runs, and
# exits 0 once the game has quit. Output (one line per state change and per run) goes to
# ~/Library/Logs/lcp-river-writer.out.log (rotated to .1 above 1 MB); the full JSONL transcript is
# ~/Library/Logs/lcp-river-writer.log.
HERE="$(cd "$(dirname "$0")" && pwd)"
LOGS="$HOME/Library/Logs"
OUT="$LOGS/lcp-river-writer.out.log"
mkdir -p "$LOGS"
if [ -f "$OUT" ] && [ "$(stat -f %z "$OUT" 2>/dev/null || echo 0)" -gt 1048576 ]; then mv -f "$OUT" "$OUT.1"; fi
PY=""
for c in /opt/homebrew/bin/python3 /usr/local/bin/python3 /usr/bin/python3; do
    if [ -x "$c" ]; then PY="$c"; break; fi
done
echo "[$(date '+%Y-%m-%d %H:%M:%S')] LCP river writer agent: start (python: ${PY:-none})" >> "$OUT"
if [ -z "$PY" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] LCP river writer agent: no python3 found; not starting" >> "$OUT"
    exit 0
fi
exec "$PY" -I -u "$HERE/river_watch.py" --with-game >> "$OUT" 2>&1
