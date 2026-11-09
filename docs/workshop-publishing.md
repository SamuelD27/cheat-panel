# Publishing to the Steam Workshop

How the public Workshop build relates to the dev build, how to test it, and how to release it from the Windows VM
with the official SDK uploader. **Dev-only doc: `docs/` is never part of the uploaded folder.**
Rewritten 2026-11-09 for the Mac-first workflow (parent `Civ7/docs/mac-workflow.md` §10).

## The two copies

| | Dev copy | Public copy |
|---|---|---|
| Path | `src/` (game loads it through the symlink `~/Library/Application Support/Civilization VII/Mods/local-cheat-panel`) | `dist-workshop/` (tracked in git since v4) |
| Mod id / name | `local-cheat-panel` / "Local Cheat Panel" | `sam-cheat-panel` / "ALL MIGHTY SAM'S POWERS" |
| Workshop | none | item **3736063097** (Public, about 2,000 subscribers) |
| Built how | edited by hand | `scripts/build-workshop.sh <rev>` refreshes `ui/` + `database/`; modinfo, `text/`, README are hand-maintained |

Both define the `panel-lcp` element, so only one panel may be enabled in a game. The dev copy goes inert by itself
when `sam-cheat-panel` is in the configuration (criterion `lcp-twin-absent`), but not for other ids such as the
private test copy below: disable it by hand there.

## Intentional divergence (what is NOT shipped publicly)

- **Unlimited-territory City Claim** (`WorldBuilder.MapPlots.setOwnership`). The build script swaps
  `claimPlotForCity` for `scripts/workshop/claimPlotForCity.public.js` (native `purchasePlot` + wide-map edge
  guard) and fails if any `setOwnership(` call is left.
- **River writer** (2026-11-03): needs the Mac-side tuner watcher (`scripts/river-writer/`). The build script
  refuses a revision whose `api.js` contains `RIVER_WRITER_START_CMD`, so public builds come from a pre-writer
  revision. v4 = `c5f2c94` (the 2026-11-02 round).

## Make a release (Mac side)

1. Develop and test on the Mac (`src/`, Reload UI or restart). Commit per round.
2. Rebuild the public folder from a proven, pre-writer revision: `scripts/build-workshop.sh <rev>`. It checks the
   modinfo (`criteria="always"` on both groups, no dev criteria or ids), the public branding, that every listed file
   exists, no dev files leak in, `node --check` on every JS file, and writes `docs/release/sam-cheat-panel-vN.sha256`.
3. Bump `<Mod version>` in `dist-workshop/sam-cheat-panel.modinfo`. Update `dist-workshop/README.md` and write
   `docs/release/vN-update-notes.md` (only features marked proven in `docs/feature-ledger.md`).
4. Commit on `master`, `git push origin master`, then on the VM: `git -C C:\civ7\cheat-panel pull`.

## Release v4 step by step (Windows VM)

Nothing here is reversible in the sense that subscribers download what you upload. The order is: private test item
first (hard rule 3), Mac test of that item, then the real update.

**The uploader, as observed 2026-11-09** (SDK "Built Friday, September 11, 2026"; read from its screens and its own
log strings): a list of your items; selecting a row shows **Edit Item** and **Upload a new version** (updates THAT
item); the top **Upload...** button always creates a **new** item. The wizard pages are Select Mod Package
(pick a `.modinfo`, 8 green checks) → Additional Details (preview image, **Visibility**, tags) → change details →
final status page, where the upload runs and logs "Creating a new item." or "Updating existing item - <id>".
Leaving the image empty keeps the current one ("Skipping preview image") and leaving every tag unticked keeps the
current tags ("Skipping tags"), but **Visibility is always applied**, and its default is **Friends Only**.

### A. Private test item (dry run)
1. Start the VM (`~/Civ7/vm/vmctl.sh start`), open the `Civ7-Win11` window in UTM, make sure Steam is signed in.
2. In the VM, PowerShell: `git -C C:\civ7\cheat-panel pull`, then
   `powershell -NoProfile -ExecutionPolicy Bypass -File C:\civ7\cheat-panel\scripts\workshop\make-test-copy.ps1`.
   It writes `C:\civ7\release\sam-cheat-panel-test\` (id `sam-cheat-panel-test`, name
   "ALL MIGHTY SAM'S POWERS (v4 private test)"; every other file byte-identical).
3. Steam → Library → **Sid Meier's Civilization VII Development Tools** → Play → **Steam Workshop Uploader** →
   **Begin**.
4. Click the top **Upload...** button (new item). Click **...**, pick
   `C:\civ7\release\sam-cheat-panel-test\sam-cheat-panel-test.modinfo`. All 8 checks must be green. **Next**.
5. Additional Details: **Visibility = Private**. No image, no tags. **Next**.
6. If a change-details page appears, type `v4 private test`, then continue.
7. Final page: expect "Creating a new item.", "PublishedFileId - <new id>", then **Success!**. Note the new id.

### B. Test that item on the Mac
1. On the Mac, open `https://steamcommunity.com/sharedfiles/filedetails/?id=<new id>` while signed in (private items
   are visible to their owner), **Subscribe**, wait for Steam to download it.
2. Start Civ VII. Add-ons: enable **ALL MIGHTY SAM'S POWERS (v4 private test)**, disable **ALL MIGHTY SAM'S POWERS**
   and **Local Cheat Panel**. Restart the game if it asks.
3. In a game (map 128×80 or smaller, a throwaway save):
   - the skull button opens the panel; **F8** opens it too;
   - Creative → Terrain → Mountain on a flat tile: green on the first click; Resource → clear one; Esc leaves paint;
   - Cities: every settlement is listed; **Claim** → click a tile next to a city → it joins the city;
   - Units: move a unit, then **Restore movement**: the map flag un-greys; **Delete** a unit works;
   - Map: **Reveal map**, then **Restore fog**; **Teleport** a unit to a tile on its own continent; minimap rivers
     match the world;
   - there is no "River writer" line on the Creative tab (that is dev-only).
4. Anything off: send `~/Library/Application Support/Civilization VII/Logs/UI.log` and `Modding.log`, and drop the
   matching line from the update notes (listed at the top of `docs/release/v4-update-notes.md`).
5. Afterwards: unsubscribe the test item, re-enable what you normally use.

### C. The real update of item 3736063097
1. Back in the uploader (Refresh if needed): click the row **3736063097 ALL MIGHTY SAM'S POWERS**, then the
   **Upload a new version** link under it. Do NOT use the top Upload... button (it would create a duplicate).
2. **...** → pick `C:\civ7\cheat-panel\dist-workshop\sam-cheat-panel.modinfo`. 8 green checks. **Next**.
3. Additional Details: **Visibility = Public** (the default Friends Only would hide the mod from every
   subscriber). Leave the image empty (keeps the current one). Tick **Game Setup**, **Gameplay Overhaul**,
   **Gameplay Tweaks** (the current tags, so they survive either way). **Next**.
4. Change details (if shown): paste the change note from `docs/release/v4-update-notes.md`.
5. Final page: it must say **"Updating existing item - 3736063097"**, then **Success!**. If it says
   "Creating a new item." instead, let it finish, then open that new item and delete it (the live one is untouched).

### D. Check after the release
- Item page: updated today, Public, subscriber count unchanged, change note present (add it under
  **Change Notes** if the uploader had no field for it).
- Description: if the uploader replaced it with the modinfo one-liner, paste back the saved copy from
  `C:\civ7\release\workshop-description-3736063097-2026-11-09.txt` (Mac: `_staging/2026-11-09-release/`).
- Delete the private test item (its page → Delete).
- On the Mac: Steam updates the subscription; the downloaded copy at
  `~/Library/Application Support/Steam/steamapps/workshop/content/1295660/3736063097/` should match
  `docs/release/sam-cheat-panel-v4.sha256` (`cd` there, then `shasum -a 256 -c <manifest>`).
- Record the release in `docs/feature-ledger.md` (v4 becomes "released").

## Pre-upload checklist
- [ ] Built by `scripts/build-workshop.sh` from a proven pre-writer revision; manifest committed
- [ ] `<Mod version>` bumped (v4 = 4; published v3 was 3)
- [ ] modinfo is the public one: id `sam-cheat-panel`, public name, `criteria="always"` on both groups, no
      `lcp-twin-absent`, no `inverse=`, no `<LoadOrder>50`
- [ ] VM clone at the same commit as `origin/master`; `dist-workshop` matches the manifest
- [ ] Private test item passed the Mac test (section B)

History: v3 was uploaded 2026-06-03 from the retired Windows Shadow PC. The 2026-10-18 `dist-workshop` (v2, dev
branding, no `criteria`) broke the game's mod list when placed in `Mods/`; it was never uploaded and is archived at
`/Users/sd/Civ7/_staging/2026-11-09-release/dist-workshop-v2-old/`.
