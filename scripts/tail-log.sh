#!/usr/bin/env bash
# Local Cheat Panel — tail the UI log, filtered to our "LCP:" lines. Mac port of tail-log.ps1.
# Note (Mac, verified 2026-06-12): mod console.log lines often do NOT reach UI.log — prefer live
# inspection via the tuner (Civ7/tools/tuner_probe.py) when this stays silent.
set -euo pipefail

log="$HOME/Library/Application Support/Civilization VII/Logs/UI.log"
[ -f "$log" ] || { echo "UI.log not found at $log (launch the game once first)" >&2; exit 1; }
echo "Tailing $log (filter: LCP:) — Ctrl+C to stop"
tail -n 50 -F "$log" | grep --line-buffered 'LCP:'
