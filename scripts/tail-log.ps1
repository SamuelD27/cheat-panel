# Local Cheat Panel — tail the UI log, filtered to our "LCP:" lines.
# Leave this running in a terminal while you test in-game.
$log = Join-Path $env:LOCALAPPDATA "Firaxis Games\Sid Meier's Civilization VII\Logs\UI.log"
if (-not (Test-Path -LiteralPath $log)) { throw "UI.log not found at $log (launch the game once first)" }
Write-Host "Tailing $log (filter: LCP:) — Ctrl+C to stop"
Get-Content -LiteralPath $log -Wait -Tail 50 | Select-String 'LCP:'
