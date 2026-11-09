# River writer (dev tool for local-cheat-panel)

The cheat panel can paint **Navigable River** terrain, but it cannot write the river data the 3D map draws rivers from.
During play, only the engine's Tuner context can write that data (`TerrainBuilder.setRiverInfo`). The game opens the
Tuner context on `127.0.0.1:4318` when `AppOptions.txt` has `EnableTuner 1`.

`river_watch.py` runs next to the game: started automatically by a LaunchAgent (below), or by hand in a Terminal.
Every 2 s it checks the panel's queue and writes the river data for what you painted, usually within a few seconds. **The rivers show on the 3D map after you save and load the game.**
Until then the panel keeps tinting those tiles; it cannot see the new river data before a load.

Single-player only. Mac only. Python 3 standard library only.

## Start automatically with the game (LaunchAgent, recommended)

```bash
sh ~/Civ7/cheat-panel/scripts/river-writer/install-launch-agent.sh      # once; undo: uninstall-launch-agent.sh
```

This installs `~/Library/LaunchAgents/local.lcp.river-writer.plist`. From then on macOS starts the river writer
whenever Civ VII launches and it stops by itself when the game quits, so nothing runs while you are not playing:

- **Trigger:** the game rewrites `~/Library/Application Support/Civilization VII/AppOptions.txt` at every launch
  (seen 2026-11-04: launch 11:34:59, file written 11:35:00); launchd watches that file. It also starts once at login
  and at install, in case the game is already running.
- **Mode:** `river-writer-agent.sh` runs `river_watch.py --with-game`: it waits up to 30 s for the game process
  (`CivilizationVII.app/Contents/MacOS/CivilizationVII`), then works like the Terminal watcher, and exits 0 once the
  tuner port is closed and the game process has been gone for 10 s. Another running watcher (e.g. one you started by
  hand) is not an error: the agent's copy just exits.
- **Crashes:** launchd restarts it only after a non-zero exit (at most every 10 s); a clean exit stays down until the
  next game launch.
- **Logs:** its lines go to `~/Library/Logs/lcp-river-writer.out.log` (rotated to `.1` above 1 MB), the JSONL
  transcript to `~/Library/Logs/lcp-river-writer.log` as usual.
- **Check / restart by hand:** `launchctl print gui/$(id -u)/local.lcp.river-writer` (state, pid, last exit code);
  `launchctl kickstart -k gui/$(id -u)/local.lcp.river-writer` restarts it now (for example after you stopped a
  hand-started watcher while the game runs).
- After editing the scripts, run the install script again (it reloads the agent).

## Start / stop by hand

```bash
python3 -I ~/Civ7/cheat-panel/scripts/river-writer/river_watch.py
```

- Start it once per play session, before or after launching the game. While the game is closed, or you are in the
  main menu or a loading screen, it waits quietly and prints one line each time that changes.
- Stop it with **Ctrl+C**. If you press Ctrl+C during a write, it finishes that write first; press Ctrl+C again to
  stop at once. On a clean stop it tells the panel right away, so the Creative tab says "not running" at once.
  Closing the Terminal window (SIGHUP) is handled like Ctrl+C.
- It refuses to start while another watcher holds the lock (`~/Library/Logs/lcp-river-writer.pid`; a stale lock is
  taken over automatically). The folder is created when it is missing.

Before the first real run, **save under a new name.** The only undo is the river remover, and it can't remove river
data from water or mountain tiles. To see the plan without writing anything:

```bash
python3 -I ~/Civ7/cheat-panel/scripts/river-writer/river_watch.py --once --dry-run
```

## Flags

| Flag | Default | Meaning |
|---|---|---|
| `--interval S` | `2` | Seconds between polls during a match. While idle, the wait grows from 2 s to 10 s. |
| `--once` | off | Run one full pass now, then exit. |
| `--dry-run` | off | Never write. Print what would be written. Works with `--once` or in watch mode. |
| `--no-lake-source` | lake sources on | Don't link a lake as the source of a river that drains to the sea or to a river (see Lake source for when a link is skipped anyway). |
| `--max-writes N` | `200` | Maximum `setRiverInfo` calls per run, at least 1. A painted area that doesn't fit in what is left of this run waits for the next poll, which follows at once. An area bigger than N on its own is **not written**: the run reports `component-too-big:<size>` (the panel shows "a painted area of N tiles is more than one run may write"), keeps its tiles as pending and drops its queue entries; run again with a bigger `--max-writes`. |
| `-v`, `--verbose` | off | Also print the payload's `LCP-RW:` log lines. |
| `--port N` | `4318` | Tuner port. The tests use their own fake port. |
| `--log-file P` | `~/Library/Logs/lcp-river-writer.log` | Path of the JSONL transcript (see Logs). |
| `--with-game` | off | The LaunchAgent's mode: wait up to 30 s for the game process at start (exit 0 if it never shows), exit 0 once the game has quit, and treat another running watcher as fine (exit 0). |
| `--pid-file P` | `~/Library/Logs/lcp-river-writer.pid` | Path of the single-instance lock file. |

## What one poll does

1. **One cheap call to the UI view (tuner ctx 65535).** It refreshes a heartbeat global,
   `globalThis.__lcpRiverWriter = {v:1, hb:<epoch ms>, seq:<last run>, pid, mode:'watch'|'dry'}`, and its status
   companion `globalThis.__lcpRiverWriterSt = {v:1, pid, hb, until, st, why, at}`:
   - `st` is `ok`, `refused` (every run is refused, e.g. multiplayer or an API mismatch after a patch; `why` says
     why), `failing` (the last run failed: no reply, cut-short reply, payload error, UI write-back failed) or
     `stopped` (set on a clean Ctrl+C).
   - `until` is how long the heartbeat counts as fresh: 10 s after a poll, 45 s after a run starts. The run refreshes
     both globals again when it ends, so a slow run never makes the panel say "not running".

   Neither global persists or is saved, and the call writes no config. It also reads the queue `LCP_RWQ`, the
   multiplayer flag, the seed, the turn and the map size. `--once` sets no heartbeat.
2. **A run starts when the queue has entries,** or once per fresh Tuner context. Every game load recreates that
   context, and so does starting the watcher. The run after a load catches tiles that were painted while nothing was
   watching. A run has three steps:
   - **UI preflight (ctx 65535).** Reads the navigable-river terrain index, `LCP_RWQ`, `LCP_RW_STATE` and `LCP_RW_LAST`.
   - **Payload (ctx 1).** `river-writer-payload.js` plans the rivers from the live map, writes them, reads every write
     back, and returns `LCPRW1{json}LCPRW1END`. If the reply is cut short, the watcher fetches the result in pieces
     from `globalThis.__lcpRWout`.
   - **One UI write-back (ctx 65535).** Writes `LCP_RW_LAST` and `LCP_RW_STATE`. Re-reads `LCP_RWQ` and removes only
     the entries this run handled, so paints made in the meantime survive. Fires
     `engine.trigger('lcp-river-writer', {seq})`. Reads all three keys back.

   A run that has nothing to write changes nothing and doesn't touch `LCP_RW_LAST`. When the write-back left queue
   entries the run did not see (the panel queued a paint while the run was going on), the next poll runs again at
   once. A failed write-back is retried within a few seconds (2 s, then 4, 8, 10 s), even with an empty queue, so the
   state that protects the written rivers gets saved.

## How directions are chosen (payload, spec v1 steps 1-6)

- **Candidates.** Tiles with Navigable River terrain but no navigable river data, plus pending tiles (see below).
  Candidates are grouped into 6-connected components. Each component becomes a tree, so it can't loop.
- **Mouths, best first:**
  1. The sea (water that isn't a lake).
  2. An existing navigable river:
     - **one of the writer's own drained rivers** (it remembers the direction it wrote on each tile): allowed when
       following those directions downstream reaches water, or a game river that passes the rule below, without
       passing through the component, a mountain or an impassable tile. So a river can be painted from the coast
       inland, one tile per click, at any elevation.
     - **a game river** (or any navigable tile the writer has no record of): allowed only if the component has no
       risk tile, no component tile next to that river tile is lower than it (equal is allowed), and the writer has
       not lost its records for this game (see below).
     - **never** a pending tile, or a tile the writer adopted as "unknown" (see State).
  3. A lake, but only when the component has neither the sea nor a river.

  Ties are broken by lower elevation, then no cliff, then the lowest direction number. The other tiles flow one BFS
  step closer to a mouth.
- **Painted-over river tiles.** Painting terrain never changes river data, so a river tile painted to water or to a
  mountain keeps its old outflow. Such a water tile is never a mouth (sea or lake) and never counts as the water a
  recorded chain reaches; a mountain or impassable tile is never a mouth and ends a recorded chain. The river stays
  pending instead (the `LCP-RW:comp:` line shows `stale=N` for such water neighbours). Painting the tile back to land
  and removing its river (River > Remove river) clears it. A lake with river data on **any** of its tiles is treated
  the same way as a whole: it is never a mouth, never the water a recorded chain reaches, and never a lake source
  (`lake-river-data`), because that tile may already feed a river out of the lake.
- **Lake source** (on by default). For a component that drains to the sea or to a river, the lake next to the tile
  furthest upstream is written to flow into that tile. The lake tile itself reads back as no river; the visual result
  shows only after a load. A lake source is written only when the fed tile's river leads:
  - straight to the sea, or
  - into one of the writer's own drained rivers whose recorded chain ends in water that is **not that lake**. Any tile
    of the same lake counts as that lake (the lake is found by a flood fill over adjacent lake tiles). Nor may it be a
    lake that could feed a river back into the first one through the writer's rivers.

  Joining a game river gets no lake source, because its end can't be traced. When the first lake doesn't qualify, the
  next lake next to the component is tried. A skipped link is counted (`lakeSkipN`), listed with its reason in the run
  result (`lakeSkip: [[lakePlotIndex, why]]`), logged as `LCP-RW:lake:...,skip=<why>` and printed in the Terminal.
  Reasons: `same-lake`, `feeds-back`, `game-river`, `untraced`, `write-failed` (a write of the component did not read
  back), `lake-river-data` (a tile of that lake is a painted-over river tile), `state-full` (see `lf` below), `no-path`.
  Every lake source is remembered (`lf`), because the engine never clears the inflow bit it sets.
- **Lake mouths never close a loop.** A component never drains into a lake, as its mouth or through a recorded chain
  that ends there, when a river that lake may feed flows into the component. "May feed" means a recorded lake-fed
  tile (`lf`) or any of the writer's drained tiles next to that lake. A navigable river next to the lake that the
  writer has no record of (a game river, or a lake source written by hand) can't be traced and might leave the lake:
  such a lake is then never the traced end that allows a lake source (`feeds-back`), and never the mouth of a component
  with a risk tile. Typical case: the sea mouth of a lake-fed river
  painted to Navigable River next to that same lake. The `LCP-RW:comp:` line then shows `lakeLoop=N`, and the
  component stays pending if it has no other mouth.
- **No mouth at all.** The lowest tile flows into a neighbouring plain land tile, and the component is kept
  **pending**: once it gains a mouth, it is rewritten in full. If there is no usable neighbour either, the component
  is **enclosed** and nothing is written.
- **Never** targets a minor river (also not a water tile that still holds minor river data), a mountain or an
  impassable tile. Never writes on water or mountain tiles, never writes a river type with no
  direction, never uses the direction-count enum member, and never calls the whole-map builders (finalizeRivers,
  validateAndFixTerrain, storeWaterData, modelRivers, addFloodplains, generateCliffsFromElevation, buildElevation).
  No cliffs.
- **Risk tiles** never join a game river:
  - tiles that were water when painted (`W=1`);
  - tiles of unknown origin (painted before the queue existed);
  - tiles whose river data was removed;
  - water tiles that one of the writer's rivers drains into.

  GameplayMap has no getter for a river's outflow, so these rules, the elevation rule and the writer's own records
  are what keep a new river from joining a river that flows into it. An untraceable river a lake may feed also blocks
  that lake as the mouth of a component with a risk tile.
- **Removals** (`rm` entries, from the panel's River > Remove river). The writer calls `setRiverInfo(x, y, -1, -1)` and
  reads the tile back. It refuses on Navigable River terrain (paint the terrain away first) and on water or mountain
  tiles (the engine ignores those), and skips tiles that have no river.

## Config keys (game configuration values, saved with the game)

| Key | Written by | Format |
|---|---|---|
| `LCP_RWQ` | the panel; the watcher only removes the entries it handled | `v1\|n:X:Y:W\|rm:X:Y\|...`. W=1 if the tile was water before the paint. Per tile, the last entry wins. |
| `LCP_RW_STATE` | the watcher only (budget 2900 chars) | `{v:1, seed, W, H, g, pend:[plotIndex], pd:'<digit or - per pend entry>', risk:[plotIndex], dr:'<base-36 index + direction digit>...', uw:'<base-36 index>...', lf:'<base-36 index + direction digit>...', x:0\|1}`. See State below. Ignored when the seed or the map size differ. A state without `lf` (written before it existed) loads as an empty list. |
| `LCP_RW_LAST` | the watcher only (at most 3000 chars) | `{v:1, seq, turn, at, k, wroteN, wrote:[plotIndex], removedN, removed:[plotIndex], pendN, enclosedN, drainedN, failN, fail:[[plotIndex,why]], refused:[[x,y,why]], lake:[plotIndex], lakeSkipN, capped, x, trunc?, err?}`. `k` is the map key (`seed\|W\|H`), `x` = the writer has lost its records once (see State). |

`wroteN`, `pendN`, `enclosedN`, `drainedN`, `removedN`, `failN`, `refused`, `lake` and `lakeSkipN` (lake sources
skipped, see Lake source) describe the latest run.
`wrote` (cap 200) and `removed` (cap 100) **accumulate** across runs. They keep every tile the UI copy of the map
doesn't show yet (`getRiverType != 1` for `wrote`, `!= -1` for `removed`), and the next write-back after a load
prunes the tiles the UI then sees. The latest action on a tile wins: a tile removed now leaves `wrote`, and a tile
written now leaves `removed`. The panel can therefore mark every tile that waits for a save & load.

`fail` codes: `readback:...`, `rm-readback:...` and `lake-readback:...` are writes that did not read back.
`component-too-big:N` (an area above `--max-writes`) and `state-full:N` (see State) were not written at all.
`bad-dir` and `guard-water-or-mountain` are internal safety checks; nothing was written. `refused` reasons for
removals: `rm-on-nav-terrain`, `engine-noop-water-or-mountain`, `no-river`, `state-full`.

### State (what keeps joins safe)

- `pend` (+ `pd`, the written direction per entry, `-` = unknown): pending tiles. A pending river may flow uphill into
  land, so it is never a join target, and its tiles are re-planned with every new paint next to them. **Never
  evicted.** At 150 entries, new pending rivers are refused (`state-full`) instead of written. Finishing pending rivers
  (painting them on to water) frees the list.
- `risk`: never evicted for land tiles (150 at most; a removal beyond that is refused with `state-full`). Marks on
  water tiles (the mouths of the writer's rivers) are evicted, oldest first, when the state needs the room.
- `dr`: the writer's drained tiles with their directions, oldest first. Evicted oldest first to keep the state
  within 2900 characters. An evicted tile is then treated like a game river.
- `uw`: queued tiles that already held navigable river data the writer has no record of. Never joined, never
  rewritten (60 at most).
- `lf`: tiles a lake source was written into, with the direction of the feeding lake tile (recorded before the write).
  The engine keeps that inflow bit even when the tile's river data is removed, so the tile counts as fed by that lake
  for good, and no river through it may drain back into that lake. **Never evicted** (60 at most: beyond that, new
  lake sources are skipped with `state-full`). An entry is forgotten only when its feeding plot is no longer lake water.
- A `pend` or `dr` tile painted to water or to a mountain keeps its river data, so it stays recorded on purpose: it is
  never a mouth, and if it is painted back to Navigable River it is still known instead of looking like a game river.
- `g`: a generation number. The Tuner context keeps its own copy (`globalThis.__lcpRWstate`). It is updated
  **before** each component's writes, as a conservative superset: all its tiles are marked pending with an unknown
  direction, plus its risk tiles and the water it drains into. A run whose UI write-back is lost, or that throws half
  way, therefore leaves a state the next run uses and saves. A payload error is written back too, with its partial
  `LCP_RW_LAST`. The Tuner context is recreated on every load; then `LCP_RW_STATE` is the source.
- `x`: set when the writer has lost its records for this map. That happens when `LCP_RW_STATE` is unreadable, or
  missing although `LCP_RW_LAST.k` names this map. From then on it never joins a river it can't trace. This is
  sticky for the game, and the panel says so. A run that writes `LCP_RW_LAST` therefore always writes `LCP_RW_STATE`
  too when there was none yet.

## Logs

- **Transcript:** `~/Library/Logs/lcp-river-writer.log`, in JSONL. It is kept out of the game's own Logs folder
  because the game empties that folder at every launch. One line per session start and end, per state change (not per
  poll), per fresh-context check, and per run. A run line holds every call (kind, ctx, request bytes, reply bytes,
  latency, errors), the full payload result with its `LCP-RW:` log lines, and the write-back read-backs. Above 5 MB
  the file moves to `lcp-river-writer.log.1`, replacing an older `.1`. The size is checked at start and every 200
  writes during a session. The folder is created when missing, also when it is removed under a running watcher.
- **stdout:** short status lines, and per run the tiles written (for example `4/3 -> E (sea)`).
- **The payload** also calls `console.log` with each `LCP-RW:` line. Whether that reaches `Logs/Scripting.log` is
  unverified: grep for `LCP-RW:` after the first run.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | OK, including Ctrl+C |
| 1 | unexpected error (including a payload error; its partial result is still written back) |
| 2 | tuner port closed (game not running, or no `EnableTuner 1`); also a bad command-line option (argparse) |
| 3 | the game didn't answer |
| 4 | refused: multiplayer, an API is missing, or not in a match |
| 5 | reply cut short, and recovery failed |
| 6 | another watcher is running |
| 7 | rivers were written, but the UI write-back failed |

## Troubleshooting

- **"tuner port ... is closed".** Start the game with `EnableTuner 1` in
  `~/Library/Application Support/Civilization VII/AppOptions.txt`.
- **A river doesn't show.** Save, then load. The panel status line and `LCP_RW_LAST` say whether the writer ran.
- **"pending: no outlet yet".** The river has no sea, river or lake to drain into yet. Paint it on to the water; the
  whole river is rewritten then.
- **"enclosed".** Every neighbour is a mountain, an impassable tile or a minor river, so nothing was written.
- **The panel says "running, but refusing to write" or "its last run failed".** The Terminal window and the
  transcript (`~/Library/Logs/lcp-river-writer.log`, older lines in `.log.1`) say why. The panel stops saying it once
  a run succeeds.
- **"lake link(s) not written".** The lake next to the river was not linked as its source. The reason tells why:
  - `same-lake` / `feeds-back`: the river would flow back into that lake.
  - `game-river` / `untraced`: the river's end can't be traced.
  - `write-failed`: a write of that river did not read back.
  - `state-full`: 60 lake sources are already remembered.

  The river itself is written as usual. To get a lake source, paint the river on to the sea or to a river the writer
  made that ends elsewhere.
- **"another river watcher is running" but none is.** The lock is `~/Library/Logs/lcp-river-writer.pid`; a lock whose
  process is gone is taken over automatically. If it still refuses, check the pid it names with `ps -p <pid>`.
- **"list of unfinished (pending) rivers is full" / `state-full`.** Paint some pending rivers on to the water, or
  paint their terrain away, so the writer can forget them; then paint again.
- **The game shows a different result than expected.** Check the transcript: each component's `LCP-RW:comp:` line
  lists its sinks, the class it chose, and its risk and pending flags.

## Known limits

- Written tiles belong to no river instance: they have no river name, no floods and no water-area link. Whether
  boats can sail them has not been probed.
- A pending river (flowing into land) may render as a stub; this hasn't been probed.
- Painting the land next to a pending river into water doesn't queue anything. The river is rewritten at the next
  run, which happens on the next queued paint or the next load.
- **Remaining loop risks.** The writer can't read a river's direction, so a few cases are still possible in principle:
  - **A save & load in the few seconds between a run's writes and a successful UI write-back.** The Tuner-side copy
    covers every other kind of lost write-back, and failed write-backs are retried within seconds. In this case the
    saved game holds the river data but the older `LCP_RW_STATE`. If the paint's queue entry also survived, the next
    run adopts that tile as unknown (`uw`) and never joins it. A tile that run wrote without a queue entry (a tile of
    unknown origin, or a re-planned pending tile) can then look like a game river. A planned follow-up, which needs a
    live probe first: tell writer tiles from game tiles by river name or navigable floodplain feature.
  - **A game river that flows into a tile later painted to land and then to Navigable River** (queued `W=0`). The
    elevation rule stops a direct join. An indirect one (joining an upstream tile of that same river from another
    tile of the component) is not caught. The same goes for an evicted `dr` tile whose mouth mark was evicted too.
  - **The water tile at a game river's mouth painted to Navigable River** (it stays pending, flowing into land), then
    painted to land, then a neighbour painted that joins that game river. The same indirect case: the game river now
    flows through the pending tile into the new tile. The elevation rule only catches it when the new tile is lower
    than the river tile it joins.
  - **Equal elevation.** A game river is joined when no adjacent component tile is lower. A river that flows into an
    equal-height tile that was once its mouth (water) is not caught. Water normally sits at elevation 0.
  - **Lakes and untraceable rivers.** The lake rules follow only the writer's own records plus the river data next to
    each lake. A lake source written before `lf` existed (by hand, or by an older payload) is seen only while its fed
    tile still holds navigable river data: if that river is removed (the engine keeps the inflow bit) and the tile is
    painted Navigable River again, a loop through that lake is possible. An `lf` entry is also forgotten when its lake
    tile is painted to land; painting the lake back brings the old inflow bit back without the record.

  The fuzz tests show no loop with downhill rivers, lost write-backs and loads in between. That includes water,
  mountain and ocean paints over river tiles, and lake-inflow loops. Two cases are left out of the fuzz because they
  are listed above: a load right after a lost write-back while game rivers exist, and painting a game river's mouth.

## Workshop twin (sam-cheat-panel)

The river writer is dev-only, because Workshop users have no tuner tool. Workshop sync (docs/workshop-publishing.md
step 3) byte-copies changed files except api.js, so:
- `tab-creative.js` gates the River category, the status line and all river-writer copy on
  `api.getRiverWriterStatus` existing. `tab-map.js` and `paint-tile-mode.js` only reach the river writer through api
  calls in try/catch. A byte-copy beside the public api.js is therefore inert, and shows the pre-river-writer tab
  (tested).
- Still, when deploying, add the river writer to "Intentional divergence" in docs/workshop-publishing.md. Never copy
  the api.js RIVER WRITER section, `scripts/river-writer/`, or the river-writer copy into sam-cheat-panel.

## Files and tests

- `river_watch.py`: the watcher. Python 3 stdlib only; it finds the payload next to itself.
- `river-writer-payload.js`: plain JS for the Tuner context. No imports, timers, `engine.on`, Promises or UI globals,
  and block comments only. The watcher strips comments and folds newlines before sending it.
- Tests (staging): `tests/river-writer-payload.test.mjs` runs the payload in node vm against a fake hex map. It covers
  the spec v1 cases and the review fixes: lost write-backs and loads, the coast-inland chain, fail-closed caps, the
  state budget, painted-over river tiles (RW-W1, RW-M1) and lake sources and lake mouths (RW-L1). It also has fuzz runs
  that include lake-inflow loops. `tests/river-watch.e2e.test.mjs` runs the real watcher against a fake tuner server on a
  random port, plus the default transcript and lock paths and in-session rotation. `tests/run-river-writer.sh` runs
  everything, including the tester's independent suites and the panel
  tests (`tests/rw-panel/`).
