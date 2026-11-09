# make-test-copy.ps1 : run on the Windows VM. Copies dist-workshop to C:\civ7\release\sam-cheat-panel-test and gives
# the copy its own mod id and name, so it can be uploaded as a NEW, PRIVATE Workshop item (the dry run of hard
# rule 3) without touching the live item 3736063097, and enabled on the Mac next to (not instead of) the live one.
# Only the modinfo's <Mod id> and <Name> change; ui/, database/ and text/ stay byte-identical (checked below).
#   powershell -NoProfile -ExecutionPolicy Bypass -File C:\civ7\cheat-panel\scripts\workshop\make-test-copy.ps1
$ErrorActionPreference = 'Stop'
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$src = Join-Path $repo 'dist-workshop'
$dst = 'C:\civ7\release\sam-cheat-panel-test'
function log($m) { Write-Output ("{0} make-test-copy: {1}" -f (Get-Date -Format HH:mm:ss), $m) }

log "STEP 1/3 copy $src -> $dst"
if (Test-Path $dst) { Remove-Item -Recurse -Force $dst; log '  removed the previous test copy' }
New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
Copy-Item -Recurse $src $dst
Rename-Item (Join-Path $dst 'sam-cheat-panel.modinfo') 'sam-cheat-panel-test.modinfo'

log 'STEP 2/3 patch the modinfo id and name (bytes otherwise unchanged)'
$m = Join-Path $dst 'sam-cheat-panel-test.modinfo'
$t = [IO.File]::ReadAllText($m)
$v = [regex]::Match($t, '<Mod id="sam-cheat-panel" version="(\d+)"').Groups[1].Value
if (-not $v) { throw 'modinfo id sam-cheat-panel not found' }
$t = $t.Replace('<Mod id="sam-cheat-panel" ', '<Mod id="sam-cheat-panel-test" ')
$t = $t.Replace("<Name>ALL MIGHTY SAM'S POWERS</Name>", "<Name>ALL MIGHTY SAM'S POWERS (v$v private test)</Name>")
if ($t -notmatch 'private test') { throw 'modinfo <Name> not found' }
[IO.File]::WriteAllText($m, $t, (New-Object Text.UTF8Encoding($false)))
log "  id=sam-cheat-panel-test name=ALL MIGHTY SAM'S POWERS (v$v private test)"

log 'STEP 3/3 verify every other file is byte-identical to dist-workshop'
$bad = 0
Get-ChildItem $src -Recurse -File | Where-Object { $_.Name -ne 'sam-cheat-panel.modinfo' } | ForEach-Object {
  $rel = $_.FullName.Substring($src.Length + 1)
  if ((Get-FileHash $_.FullName).Hash -ne (Get-FileHash (Join-Path $dst $rel)).Hash) { $bad++; log "  DIFF $rel" }
}
if ($bad) { throw "$bad files differ" }
log "EXIT ok: pick $m in the uploader (top 'Upload...' button = new item, Visibility = Private)"
