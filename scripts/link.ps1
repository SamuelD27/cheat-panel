# Local Cheat Panel — create the dev deploy junction (run once).
# Junction (not symlink) => no admin needed on the same volume. The game then reads the mod
# directly from .\src, so edits are live (JS edits still need an in-game "Reload UI"; modinfo/xml
# changes still need a game restart).
$ErrorActionPreference = 'Stop'

$src  = (Resolve-Path (Join-Path $PSScriptRoot '..\src')).Path
$dest = Join-Path $env:LOCALAPPDATA "Firaxis Games\Sid Meier's Civilization VII\Mods\local-cheat-panel"

if (-not (Test-Path -LiteralPath $src)) { throw "src not found: $src" }

if (Test-Path -LiteralPath $dest) {
    $item = Get-Item -LiteralPath $dest -Force
    if ($item.LinkType -in @('Junction', 'SymbolicLink')) {
        Write-Host "Removing existing link at $dest"
        $item.Delete()
    } else {
        throw "A real folder (not a link) already exists at:`n  $dest`nRemove it manually first so real files are never deleted."
    }
}

New-Item -ItemType Junction -Path $dest -Target $src | Out-Null
Write-Host "Junction created:`n  $dest`n  -> $src"
