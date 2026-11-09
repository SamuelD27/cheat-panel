#!/usr/bin/env bash
# Local Cheat Panel — create the dev deploy symlink (run once). Mac port of link.ps1.
# The game then reads the mod directly from ./src, so edits are live (JS edits still need an
# in-game "Reload UI"; modinfo/xml changes still need a game restart).
set -euo pipefail

src="$(cd "$(dirname "$0")/../src" && pwd)"
dest="$HOME/Library/Application Support/Civilization VII/Mods/local-cheat-panel"

[ -d "$src" ] || { echo "src not found: $src" >&2; exit 1; }
mkdir -p "$(dirname "$dest")"

if [ -L "$dest" ]; then
    echo "Removing existing symlink at $dest"
    rm "$dest"
elif [ -e "$dest" ]; then
    echo "A real folder (not a symlink) already exists at:" >&2
    echo "  $dest" >&2
    echo "Remove it manually first so real files are never deleted." >&2
    exit 1
fi

ln -s "$src" "$dest"
echo "Symlink created:"
echo "  $dest"
echo "  -> $src"
