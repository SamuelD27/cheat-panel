#!/bin/sh
# Remove the LCP river writer LaunchAgent (stops a running river writer started by it). The logs are kept.
set -u
LABEL=local.lcp.river-writer
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null && echo "stopped $LABEL" || echo "$LABEL was not loaded"
if [ -f "$PLIST" ]; then rm -f "$PLIST" && echo "removed $PLIST"; fi
