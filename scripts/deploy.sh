#!/usr/bin/env bash
# Local Cheat Panel — copy-based deploy (fallback if you don't want a symlink). Mac port of deploy.ps1.
# Mirrors ./src into the Mods folder. Run after each change instead of using a symlink.
set -euo pipefail

src="$(cd "$(dirname "$0")/../src" && pwd)"
dest="$HOME/Library/Application Support/Civilization VII/Mods/local-cheat-panel"

if [ -L "$dest" ]; then
    echo "Mods entry is a symlink (live dev mode) — refusing to copy over it. Remove it first: rm \"$dest\"" >&2
    exit 1
fi
mkdir -p "$dest"
rsync -a --delete --exclude '*.map' --exclude '*.js.map' "$src/" "$dest/"
echo "Deployed to $dest"
