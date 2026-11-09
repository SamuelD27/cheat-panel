#!/bin/sh
# Install (or reinstall) the LCP river writer LaunchAgent for the current user: macOS then starts the river writer
# whenever Civ VII launches, and it stops by itself when the game quits. Undo with uninstall-launch-agent.sh.
set -eu
LABEL=local.lcp.river-writer
HERE="$(cd "$(dirname "$0")" && pwd)"
AGENT="$HERE/river-writer-agent.sh"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
APPOPT="$HOME/Library/Application Support/Civilization VII/AppOptions.txt"
DOMAIN="gui/$(id -u)"
xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
[ -f "$HERE/river_watch.py" ] || { echo "river_watch.py not found next to this script" >&2; exit 1; }
[ -f "$APPOPT" ] || echo "note: $APPOPT does not exist yet; launchd starts the river writer once the game creates it"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
chmod +x "$AGENT" "$HERE/river_watch.py"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>$LABEL</string>
    <key>ProgramArguments</key>
    <array><string>/bin/sh</string><string>$(xml "$AGENT")</string></array>
    <!-- Civ VII rewrites AppOptions.txt at every launch: that is the "game launched" trigger -->
    <key>WatchPaths</key>
    <array><string>$(xml "$APPOPT")</string></array>
    <!-- also at login / install, in case the game is already running (the watcher exits at once if it is not) -->
    <key>RunAtLoad</key><true/>
    <!-- restart only after a crash (non-zero exit); a clean exit when the game quits stays down until the next launch -->
    <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
    <key>ThrottleInterval</key><integer>10</integer>
    <key>StandardOutPath</key><string>/dev/null</string>
    <key>StandardErrorPath</key><string>$(xml "$HOME/Library/Logs/lcp-river-writer.agent-err.log")</string>
</dict>
</plist>
PLIST
plutil -lint "$PLIST"
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
i=0
until launchctl bootstrap "$DOMAIN" "$PLIST" 2>/dev/null; do
    i=$((i + 1))
    if [ "$i" -ge 10 ]; then launchctl bootstrap "$DOMAIN" "$PLIST"; exit 1; fi
    sleep 1
done
echo "installed $LABEL ($PLIST)"
launchctl print "$DOMAIN/$LABEL" | grep -E '^[[:space:]]*(state|pid|last exit code|runs) =' || true
echo "output: ~/Library/Logs/lcp-river-writer.out.log   transcript: ~/Library/Logs/lcp-river-writer.log"
