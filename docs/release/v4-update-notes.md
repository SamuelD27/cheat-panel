# sam-cheat-panel v4: update notes (Workshop item 3736063097)

Paste the **Change note** block into the uploader's change-note field (or, after the upload, on the item page:
Change Notes → Edit). Steam renders the `[list]` / `[*]` / `[b]` tags as BBCode. Before pasting, delete any line
whose feature failed the pre-release test (lines marked ⚑ below depend on that test).

## Change note (paste as-is)

```
[b]Update for Civ VII 1.5.0[/b] (game build 25516395)

[b]Fixed[/b]
[list]
[*]Creative tab painting works again: since the game update, clicks on the map did nothing.
[*]City Claim works again (same cause). ⚑
[*]Deleting a unit works again (the game had started rejecting the old delete command).
[*]Each paint click now reports its real result. Before, many paints flashed red even though they had worked.
[*]The Cities tab shows all your settlements, not just the first four. ⚑
[*]Restore Movement now also un-greys the unit's flag on the map. ⚑
[*]The minimap draws rivers correctly (navigable vs minor, and no false rivers on other tiles).
[*]Safer alongside other mods: the panel's database rows can no longer roll back other mods' setup content.
[/list]

[b]New[/b]
[list]
[*]Map tab: [b]Reveal map / Restore fog[/b]. Reveal uncovers the terrain only (no meeting other civs), and Restore puts the fog back on every tile you had not explored.
[*]Map tab: [b]Teleport[/b] the selected unit to a tile clicked on the minimap (on its own continent).
[*]Creative tab: Clear entries, a reason when a paint is refused, Gold vs Gold (Distant Lands) tags, and the full resource list.
[*]Creative tab: multi-tile natural wonders (experimental).
[*]Painting Navigable River now says honestly that it changes the terrain only (the game draws no river there) and marks those tiles on the map.
[/list]

Reveal map is switched off on maps wider or taller than 128 tiles: the game itself crashes when it draws tiles past column 128.
```

## Short version (if a field has a length limit)

```
Update for Civ VII 1.5.0: Creative painting, City Claim and unit Delete work again; paint clicks report their real result; minimap rivers fixed; new Reveal map / Restore fog and minimap Teleport; multi-tile wonders (experimental).
```

## Workshop description (optional)

The uploader's Additional Details page says the title and description are changed on the Workshop page after the
upload. If the update nevertheless replaces the long description with the modinfo one-liner, paste back the copy
saved on 2026-11-09 (VM `C:\civ7\release\workshop-description-3736063097-2026-11-09.txt`, Mac
`/Users/sd/Civ7/_staging/2026-11-09-release/`). To bring it up to date: its Creative section still says
"IN DEVELOPMENT"; the feature list in `dist-workshop/README.md` is current, and the tested patch is
Civ VII 1.5.0 (Steam build 25516395).
