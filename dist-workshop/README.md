# ALL MIGHTY SAM'S POWERS

Solo-play sandbox / cheat panel for Civilization VII.

## Features
- Player tab: add gold, influence, yields
- Research tab: instant-finish current research and civic
- Units tab: list all your units with per-row actions (heal, +XP, promote, delete, restore movement,
  infinite-movement toggle, duplicate)
- Cities tab: list all your settlements with per-row actions (set population, instant-complete production,
  claim a tile through the game's own purchase rules)
- Map tab: minimap of the whole world (zoom, hover info, click to move the camera, resource and wonder
  spotlight), teleport the selected unit to a clicked tile on its own continent, and Reveal map / Restore fog
  (Restore puts the fog back on the tiles you had not explored)
- Creative tab: paint terrain, feature, resource and biome on clicked tiles, with Clear entries, a result
  message for every click, and natural wonders (multi-tile wonders are experimental)

## How to use
In-game, click the **skull button** on the sub-system dock to toggle the panel (the **F8** key is bound to
it too). Tabs are switchable across the top. Press Esc or right-click to leave a paint or claim mode.

## Single-player only
This mod is designed for single-player. All actions are no-ops in multiplayer.

## Achievements
Cheat mods typically disable achievements. Don't use this if you're achievement-hunting.

## Compatibility
- Tested on Civ VII 1.5.0 (Steam build 25516395)
- Painted Navigable River changes the terrain only: the game draws no river there
- Reveal map is refused on maps wider or taller than 128 tiles (a game rendering bug crashes them)
- Conflicts: anything else that overrides the sub-system dock panel

## Reporting bugs
Include your `UI.log`, filtered for `LCP`:
- Windows: `%LOCALAPPDATA%\Firaxis Games\Sid Meier's Civilization VII\Logs\UI.log`
- macOS: `~/Library/Application Support/Civilization VII/Logs/UI.log`
