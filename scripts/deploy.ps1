# Local Cheat Panel — copy-based deploy (fallback if you don't want a junction).
# Mirrors .\src into the Mods folder. Run after each change instead of using a junction.
$ErrorActionPreference = 'Stop'

$src  = (Resolve-Path (Join-Path $PSScriptRoot '..\src')).Path
$dest = Join-Path $env:LOCALAPPDATA "Firaxis Games\Sid Meier's Civilization VII\Mods\local-cheat-panel"

robocopy "$src" "$dest" /MIR /XF *.map *.js.map | Out-Null
# robocopy exit codes < 8 indicate success.
if ($LASTEXITCODE -ge 8) { throw "robocopy failed (exit $LASTEXITCODE)" }
Write-Host "Deployed to $dest (robocopy exit $LASTEXITCODE)"
