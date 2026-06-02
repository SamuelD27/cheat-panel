# Publishing to the Steam Workshop

How the public Workshop build relates to the dev build, and how to launch (new mod) or
update (existing mod). **Dev-only doc — `docs/` is excluded from the public copy.**

## The two copies

| | Dev copy | Public copy |
|---|---|---|
| Path | `Mods\local-cheat-panel` → junction to `…\Desktop\Cheat Panel\src` | `%LOCALAPPDATA%\Firaxis Games\Sid Meier's Civilization VII\Mods\sam-cheat-panel\` |
| Mod id | `local-cheat-panel` | `sam-cheat-panel` |
| Git | tracked (this repo) | **not** tracked — a derived copy |
| Role | **source of truth**, fast Reload-UI loop | build output that the Mod Uploader ships |
| Contents | everything, incl. private-only cheats | curated public subset |

Both define the `panel-lcp` element / dock skull button, so **only one may be enabled at a
time** — disable the other in the in-game Add-Ons menu before testing.

## Intentional divergence (what is NOT shipped publicly)

Keep this list current — it is the entire reason the two copies differ.

- **Unlimited-territory city claim** — `shared/api.js`, repo commit `5b07ac6` (uses
  `WorldBuilder.MapPlots.setOwnership`). The public `api.js` must stay at the **pre-`5b07ac6`**
  state (the native, radius-limited claim). Quick check: `grep setOwnership` on the public copy
  should return nothing.

Everything else is shared between the two copies.

## Workflow: making a change (the normal case)

1. **Edit in `src/`** (the dev copy). Commit per milestone — every change stays revertable.
2. **Verify locally**: enable `local-cheat-panel`, disable `sam-cheat-panel`, then Reload UI
   (JS-only) or restart (modinfo / database / text / new files).
3. **Sync the changed files to `sam-cheat-panel`:**
   - Files **other than `api.js`** → byte-copy from `src/` (verify with a SHA-256 match).
   - **`api.js`** → do NOT copy the dev version (it has the territory cheat). Apply the fix on
     top of the no-territory base instead.
   - Strip any dev-only `console.log` (keep `console.error` — it helps bug reports). In practice
     the panel's logs don't reach UI.log anyway, so there's usually nothing to strip.
   - Never copy `docs/`, `scripts/`, `.git`, the dev `README.md`/`PROMPT.md`, or any
     `.ts/.log/.bak/.tmp`.
4. **Bump `<Mod version="N">`** in `sam-cheat-panel.modinfo` (so the game + subscribers see it as
   updated).
5. **Smoke-test the public copy**: enable only `sam-cheat-panel`, restart, check
   `…\Logs\Modding.log` for load errors, exercise the changed feature. A *full* re-verify is only
   needed when `api.js` changed (its public variant differs from what you tested locally).
6. **Upload** (see below).

## Pre-upload checklist

- [ ] `<Mod version>` bumped
- [ ] Only the intended files changed; territory cheat absent (`grep setOwnership` → nothing)
- [ ] modinfo: `id="sam-cheat-panel"`, `AffectsSavedGames=0`, every `<Item>`/`<File>` resolves
- [ ] No `docs/`/`scripts/`/`.git`/secrets/dev-path leaked into the folder
- [ ] `README.md` patch line current (`23245653 / Update 1.4.0 "Test of Time"`)

## Uploading

The repo has **no publish script** — uploading is a manual step in the official tools.

**Where:** Steam → Library (show **Tools**) → the **Civilization VII modding / development tools**
→ the **Mod Uploader**. Point it at the `sam-cheat-panel` folder.

### First launch (new Workshop item)
1. Build the `sam-cheat-panel` folder (see the first-launch build spec / `[[civ7-workshop-publish]]`).
2. In the Mod Uploader, select `sam-cheat-panel`, fill in the Workshop form (title, description,
   tags, preview image).
3. Set visibility to **Hidden** first. Upload.
4. Subscribe in-game, confirm the Workshop-installed copy loads and works.
5. Flip visibility to **Public**.
6. **Record the resulting Workshop item id (PublishedFileId)** here for future updates:
   `PublishedFileId: <fill in>`

### Update (existing Workshop item)
1. Sync changes + bump version per the workflow above.
2. Open the same Mod Uploader, select `sam-cheat-panel` (it targets the existing Workshop item via
   the mod id / stored PublishedFileId).
3. Re-upload — this pushes a new revision to the **same** item; subscribers auto-update.

> Fill in the exact in-tool button names from your own first-launch run — keep this doc matching
> what the SDK actually shows.
