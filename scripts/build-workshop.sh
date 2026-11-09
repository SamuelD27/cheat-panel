#!/usr/bin/env bash
# build-workshop.sh <git-rev> : rebuild dist-workshop/ (the public sam-cheat-panel folder that the SDK Workshop
# Uploader ships) from the dev source at <git-rev>.
#
#   dist-workshop/ui, dist-workshop/database  <- src/ui, src/database at <git-rev>, then:
#     - claimPlotForCity in shared/api.js is swapped for scripts/workshop/claimPlotForCity.public.js
#       (dev claims with WorldBuilder.MapPlots.setOwnership = unlimited territory: never public)
#   hand-maintained, never generated (public branding, edit them by hand):
#     dist-workshop/sam-cheat-panel.modinfo  (bump <Mod version> on every release)
#     dist-workshop/text/*                   (public name "ALL MIGHTY SAM'S POWERS")
#     dist-workshop/README.md
#
# <git-rev> must be a revision WITHOUT the river writer (private, needs the Mac watcher): the script refuses
# otherwise. Release v4 (2026-11-09) is built from c5f2c94 (the 2026-11-02 round).
# Writes only dist-workshop/ui, dist-workshop/database and docs/release/<name>.sha256. Publishes nothing.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REV="${1:?usage: build-workshop.sh <git-rev>}"
OUT="$REPO/dist-workshop"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lcp-ws.XXXXXX")"; trap 'rm -rf "$TMP"' EXIT
log() { printf '%s build-workshop: %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { log "ERROR $*"; exit 1; }

SHA="$(git -C "$REPO" rev-parse --short "$REV^{commit}")" || die "unknown rev $REV"
log "STEP 1/6 export src/ui + src/database at $REV ($SHA)"
git -C "$REPO" archive "$SHA" src/ui src/database | tar -x -C "$TMP"
[ -f "$TMP/src/ui/cheat-panel/shared/api.js" ] || die "no api.js at $SHA"
API="$TMP/src/ui/cheat-panel/shared/api.js"
n="$(grep -c 'RIVER_WRITER_START_CMD' "$API" || true)"
log "  river-writer markers at $SHA: $n (must be 0)"
[ "$n" = 0 ] || die "$SHA contains the private river writer; build from a pre-writer revision"

log "STEP 2/6 swap claimPlotForCity for the public (purchasePlot-only) block"
python3 -I - "$API" "$REPO/scripts/workshop/claimPlotForCity.public.js" <<'PY'
import sys
api, pub = sys.argv[1], sys.argv[2]
s = open(api, newline='').read()
block = open(pub, newline='').read().split('// ---- BLOCK ----\n', 1)[1]
i = s.index('\nexport function claimPlotForCity(')
start = s.rindex('\n}\n\n', 0, i) + 4
end = s.index('\n}\n', i) + 3
old = s[start:end]
print('  dev block: %d lines (setOwnership calls: %d) -> public block: %d lines'
      % (old.count('\n'), old.count('setOwnership('), block.count('\n')))
s = s[:start] + block + s[end:]
assert s.count('setOwnership(') == 0, 'a setOwnership( call is left in the public api.js'
open(api, 'w', newline='').write(s)
PY

log "STEP 3/6 copy into $OUT (ui + database only)"
[ -f "$OUT/sam-cheat-panel.modinfo" ] || die "missing hand-maintained $OUT/sam-cheat-panel.modinfo"
rm -rf "$OUT/ui" "$OUT/database"
cp -R "$TMP/src/ui" "$OUT/ui"; cp -R "$TMP/src/database" "$OUT/database"

log "STEP 4/6 modinfo + text checks"
M="$OUT/sam-cheat-panel.modinfo"
grep -q '<Mod id="sam-cheat-panel" version="[0-9]*"' "$M" || die "modinfo id is not sam-cheat-panel"
[ "$(grep -c 'criteria="always"' "$M")" = 2 ] || die "both ActionGroups need criteria=\"always\""
grep -q '<AlwaysMet' "$M" || die "AlwaysMet criterion missing"
! grep -q 'lcp-twin-absent\|inverse=\|lcp-dev-' "$M" || die "dev-only criteria or group ids in the public modinfo"
! grep -q '<LoadOrder>50' "$M" || die "dev LoadOrder 50 in the public modinfo"
grep -q "ALL MIGHTY SAM'S POWERS" "$OUT/text/en_us/ModuleText.xml" || die "public branding missing in text/"
! cat "$OUT/text/en_us/ModuleText.xml" "$OUT/text/Cheat-Panel-Text.sql" | grep -v '^[[:space:]]*--' \
  | grep -q 'Local Cheat Panel' || die "dev branding in text/ (comments are ignored)"
missing=0
for f in $(sed -n 's:.*<\(Item\|File\)>\([^<]*\)</\(Item\|File\)>.*:\2:p' "$M"); do
  [ -f "$OUT/$f" ] || { log "  missing: $f"; missing=1; }
done
[ "$missing" = 0 ] || die "modinfo lists files that are not in the folder"
log "  modinfo version=$(sed -n 's/.*<Mod id="sam-cheat-panel" version="\([0-9]*\)".*/\1/p' "$M"), every listed file present"

log "STEP 5/6 leak + syntax checks"
leaks="$(find "$OUT" \( -name '.git' -o -name 'docs' -o -name 'scripts' -o -name '*.log' -o -name '*.bak' -o -name '*.tmp' -o -name '.DS_Store' \) -print)"
[ -z "$leaks" ] || die "dev files in the folder: $leaks"
! grep -rqE '/Users/|C:\\\\Users' "$OUT/ui" || die "a local user path is in ui/"
if command -v node >/dev/null 2>&1; then
  for f in $(find "$OUT/ui" -name '*.js'); do cp "$f" "$TMP/chk.mjs"; node --check "$TMP/chk.mjs" || die "syntax: $f"; done
  log "  node --check: all ui/*.js ok"
else
  log "  node not found: syntax check skipped (run this script on the Mac)"
fi

log "STEP 6/6 manifest"
V="$(sed -n 's/.*<Mod id="sam-cheat-panel" version="\([0-9]*\)".*/\1/p' "$M")"
mkdir -p "$REPO/docs/release"
( cd "$OUT" && find . -type f ! -name '.DS_Store' | LC_ALL=C sort | xargs shasum -a 256 ) > "$REPO/docs/release/sam-cheat-panel-v$V.sha256"
log "  docs/release/sam-cheat-panel-v$V.sha256: $(wc -l < "$REPO/docs/release/sam-cheat-panel-v$V.sha256" | tr -d ' ') files"
log "EXIT ok: $OUT = public v$V from $SHA (not uploaded)"
