# Local Cheat Panel — Civilization VII

A **private, solo-play** cheat/sandbox panel mod for Civilization VII (Windows / Shadow PC).
Forked privately from the Sovereign Cheat Panel and extended with per-row unit/city management, a
map-paint tab, a persistent infinite-movement toggle, and unit duplication.

> Single-player only. Not for redistribution. Enabling debug/tuner (and using cheats) disables
> achievements — by design.

- **Target build:** Civ VII `23245653` / Update 1.4.0 "Test of Time".
- **Reference doc:** [Research.md](Research.md)
- **Discovery findings:** [docs/discovery.md](docs/discovery.md)
- **Implementation plan:** [docs/plan.md](docs/plan.md)

## Layout

```
src/          the mod (deploys to Mods\local-cheat-panel\)
scripts/      link.ps1 (junction deploy), deploy.ps1 (copy fallback), tail-log.ps1
docs/         discovery.md, plan.md, api-snapshot-23245653.md
Research.md   technical reference
```

## First-time setup

1. **Disable conflicting cheat panels.** In Steam Workshop / Vortex, disable the **Sovereign Cheat
   Panel** and **Izica's dev/cheat panel** while developing this one — otherwise you get duplicate
   dock buttons and registration errors.
2. **Deploy.** From this repo root:
   ```powershell
   .\scripts\link.ps1     # one-time junction: Mods\local-cheat-panel -> .\src
   ```
3. *(Optional)* Enable the debug menu + FireTuner. Either edit
   `%LOCALAPPDATA%\Firaxis Games\Sid Meier's Civilization VII\AppOptions.txt`
   (`EnableDebugPanels 1`, `EnableTuner 1`) or add Steam launch options
   `-EnableDebugPanels 1 -EnableTuner 1` (survives file resets). FireTuner needs the
   **"Sid Meier's Civilization VII - Development Tools"** SDK from Steam → Tools.

## Dev iteration loop

1. Edit files in `src/` (the junction makes them live).
2. In game: `~` → UI → **Reload UI** for JS-only changes. For `.modinfo` / `database` / `text` /
   new-file changes, **restart the game**.
3. Tail logs in a separate terminal: `.\scripts\tail-log.ps1` (filters to `LCP:` lines).

## Open the panel

- Press **F8**, or click the **gold skull** button on the sub-system dock.
