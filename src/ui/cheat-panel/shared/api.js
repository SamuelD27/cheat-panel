/**
 * @file shared/api.js
 * @description Thin, single-player-guarded wrappers around the verified engine calls.
 *
 * This is the one place cheat logic touches the engine, so any future API drift is a one-file fix.
 * Uses ambient engine globals (Players, Units, Cities, Game, GameContext, GameInfo, YieldTypes, UI,
 * Configuration) — these are provided by the UI isolate and need no import. The one cross-module
 * import (InterfaceMode) still comes via ./imports.js, so the "/core imports only in imports.js" rule
 * is intact — api.js never imports from /core directly.
 *
 * All calls below are verified against build 23245653 (from the proven Sovereign panel + base UI).
 */
import { InterfaceMode } from '/base-standard/ui/cheat-panel/shared/imports.js';

export const LOG = (...a) => console.log('LCP:', ...a);
export const ERR = (...a) => console.error('LCP:', ...a);

// ─── Single-player guard ──────────────────────────────────────────────
// Research.md suggested `Game.maxPlayers > 1`, but maxPlayers is the civ-slot count (always > 1),
// so that would block cheats even in single-player. The base UI detects multiplayer via
// Configuration.getGame().isAnyMultiplayer (also isNetworkMultiplayer / isHotseat, UI.isMultiplayer).
export function isMultiplayer() {
    try {
        const cfg = (typeof Configuration !== 'undefined') ? Configuration.getGame?.() : null;
        if (cfg) {
            if (typeof cfg.isAnyMultiplayer === 'boolean') return cfg.isAnyMultiplayer;
            return !!(cfg.isNetworkMultiplayer || cfg.isHotseat);
        }
        if (typeof UI !== 'undefined' && typeof UI.isMultiplayer === 'function') return UI.isMultiplayer();
    } catch (e) {
        ERR('isMultiplayer() detection failed:', e);
    }
    return false; // SP-only mod; if undetectable, assume single-player so cheats still work.
}

/** Returns true if it is safe to run a cheat (single-player). Logs + returns false in multiplayer. */
export function guardSP() {
    if (isMultiplayer()) { LOG('cheat blocked — multiplayer game'); return false; }
    return true;
}

export function getLocalPlayer() {
    return Players.get(GameContext.localPlayerID);
}

// ─── PLAYER ───────────────────────────────────────────────────────────
export function addGold(amount) {
    if (!guardSP()) return;
    const p = getLocalPlayer();
    if (p?.Treasury) { p.Treasury.changeGoldBalance(amount, -1); LOG('added', amount, 'gold'); }
}

export function addInfluence(amount) {
    if (!guardSP()) return;
    const p = getLocalPlayer();
    if (p?.DiplomacyTreasury) { p.DiplomacyTreasury.changeDiplomacyBalance(amount); LOG('added', amount, 'influence'); }
}

export function addAttributePoints(count) {
    if (!guardSP()) return;
    const p = getLocalPlayer();
    if (p?.Identity) {
        for (let i = 0; i < count; i++) p.Identity.addWildcardAttributePoints(1);
        LOG('added', count, 'wildcard attribute points');
    }
}

// ─── UNIT primitives (by component id) ────────────────────────────────
export function restoreMovement(unitId) { if (!guardSP()) return; Units.restoreMovement(unitId); }
export function healUnit(unitId)        { if (!guardSP()) return; Units.setDamage(unitId, 0); }
export function giveExperience(unitId, amount) { if (!guardSP()) return; Units.changeExperience(unitId, amount); }

// ─── UNIT display helpers (reads only; safe in any mode) ──────────────
/** Snapshot of a unit's display fields, fully defensive against missing components. */
export function unitDisplay(u) {
    let name = '(unit)';
    try { name = Locale.compose(u.name); } catch (e) { /* keep fallback */ }
    let hasHp = false, hp = 0, maxHp = 0, hasMp = false, mp = 0, maxMp = 0, x = -1, y = -1;
    try { const h = u.Health; if (h && h.maxDamage > 0) { hasHp = true; maxHp = h.maxDamage; hp = h.maxDamage - h.damage; } } catch (e) {}
    try { const m = u.Movement; if (m) { hasMp = true; mp = m.movementMovesRemaining; maxMp = m.maxMoves; } } catch (e) {}
    try { const loc = u.location; if (loc) { x = loc.x; y = loc.y; } } catch (e) {}
    return { name, hasHp, hp, maxHp, hasMp, mp, maxMp, x, y };
}

/** Center the camera on a unit's plot. */
export function lookAtUnit(u) {
    try { if (u.location && typeof Camera !== 'undefined') Camera.lookAtPlot(u.location, { zoom: 0.35 }); }
    catch (e) { ERR('lookAtUnit failed:', e); }
}

/**
 * Delete a unit. Uses UNITCOMMAND_DELETE — the unconditional in-game "remove unit" (the trash
 * button). We previously sent UNITCOMMAND_DISBAND, but disband is an ACTIVE_PRIMARY contextual
 * command whose canStart() can reject silently (sendRequest then no-ops without throwing), which is
 * why the confirm dialog appeared but nothing happened. Commands also expect the standard parameter
 * block {X,Y,UnitAbilityType}, not {} (verified in base unit-actions.js processCommand()).
 */
export function deleteUnit(unitId) {
    if (!guardSP()) return;
    try {
        const params = { X: -9999, Y: -9999, UnitAbilityType: -1 };
        const check = Game.UnitCommands?.canStart?.(unitId, "UNITCOMMAND_DELETE", params, false);
        if (check && check.Success === false) ERR('deleteUnit: canStart(UNITCOMMAND_DELETE) not allowed:', check);
        Game.UnitCommands.sendRequest(unitId, "UNITCOMMAND_DELETE", params);
        LOG('deleted unit', unitId?.id);
    } catch (e) { ERR('deleteUnit failed:', e); }
}

// ─── UNIT placement validation (reads only) ───────────────────────────
// Why we validate ourselves instead of trusting Units.create({Validate:true}): in-game that flag
// rejected the occupied source plot AND every empty neighbor (all returned {Success:false}), so it's
// not a usable "find me a legal tile" filter here. We check the plot rules explicitly, then create
// without the flag (the base age-transition commander create also omits it and the engine seats the
// unit). All accessors are ambient UI-isolate globals (GameplayMap/MapUnits/Units/GameInfo).

/**
 * Returns null if a unit of `domain`/`formationClass` owned by `owner` may legally stand on `loc`,
 * otherwise a short reason string (used for logging). Rules:
 *  - in map bounds; matches domain (land/air -> land tile, sea -> water tile)
 *  - not a mountain, not otherwise impassable
 *  - no OTHER player's unit on the tile (any kind blocks)
 *  - no friendly unit sharing the clone's FormationClass (the per-class stacking limit)
 */
function plotBlockReason(loc, domain, formationClass, owner) {
    if (!GameplayMap.isValidLocation(loc)) return 'offmap';
    const { x, y } = loc;
    const water = GameplayMap.isWater(x, y);
    if (domain === 'DOMAIN_SEA') { if (!water) return 'notwater'; }
    else if (water) return 'water';
    if (GameplayMap.isMountain(x, y)) return 'mountain';
    if (GameplayMap.isImpassable(x, y)) return 'impassable';
    for (const id of MapUnits.getUnits(x, y)) {
        if (id.owner !== owner) return 'enemyunit';                   // another player's unit — any kind
        const other = Units.get(id);
        const otherFC = other ? GameInfo.Units.lookup(other.type)?.FormationClass : null;
        if (otherFC && otherFC === formationClass) return 'sameclass'; // can't stack same FormationClass
    }
    return null;
}

/** First adjacent hex where a clone of `def` (owned by `owner`) can legally stand, or null. */
function findPlacementPlot(loc, def, owner) {
    const scan = [];
    for (let dir = 0; dir < DirectionTypes.NUM_DIRECTION_TYPES; dir++) {
        const adj = GameplayMap.getAdjacentPlotLocation(loc, dir);
        const why = plotBlockReason(adj, def.Domain, def.FormationClass, owner);
        if (!why) return adj;                       // first legal neighbor wins
        scan.push(`(${adj.x},${adj.y})=${why}`);
    }
    ERR(`findPlacementPlot: no legal adjacent plot for ${def.UnitType} near (${loc.x},${loc.y}) — ${scan.join(' ')}`);
    return null;
}

/**
 * Duplicate a unit: spawn a plain copy of the same unit type on a legal adjacent tile (validated by
 * findPlacementPlot — no mountain, no enemy-occupied tile, no same-FormationClass stack). No XP or
 * promotions are copied.
 *
 * Spawns via the CREATE_ELEMENT player operation — the UI-isolate path the in-game tuner uses
 * (base tuner-input.js). Units.create is a gameplay-SCRIPT API and silently returns {Success:false}
 * from the panel isolate (confirmed in-game even on a validated empty tile). PlayerOperations
 * sendRequest is fire-and-forget (no synchronous ID), so we return the target plot on success.
 */
export function duplicateUnit(unit) {
    if (!guardSP()) return null;
    try {
        const owner = unit?.id?.owner ?? GameContext.localPlayerID;
        const loc = unit?.location;
        const def = (unit?.type != null) ? GameInfo.Units.lookup(unit.type) : null;
        if (!def || !loc) { ERR('duplicateUnit: missing type/location', unit?.type, loc); return null; }

        const target = findPlacementPlot(loc, def, owner);
        if (!target) return null;                   // findPlacementPlot logged the per-neighbor reasons

        const args = { Kind: "UNIT", Type: unit.type, Location: target, Owner: owner, IndependentIndex: -1 };
        Game.PlayerOperations.sendRequest(owner, "CREATE_ELEMENT", args);
        LOG('duplicated', def.UnitType, 'at', `(${target.x},${target.y})`, 'via CREATE_ELEMENT');
        return target;
    } catch (e) { ERR('duplicateUnit failed:', e); }
    return null;
}

/** Duplicate the currently selected unit (the one the player clicked in-game). */
export function duplicateSelectedUnit() {
    const u = getSelectedUnit();
    if (!u) { ERR('no unit selected to duplicate'); return null; }
    return duplicateUnit(u);
}

/** Refresh the on-screen movement-point indicator after a movement restore (known cosmetic bug). */
export function refreshUnitSelection(unitId) {
    try { UI.Player.deselectAllUnits(); UI.Player.selectUnit(unitId); } catch (e) { ERR('reselect failed:', e); }
}

export function getSelectedUnit() {
    const id = UI.Player.getHeadSelectedUnit();
    if (id && id.owner !== -1 && id.id !== -1) {
        const u = Units.get(id);
        if (u) return u;
    }
    return null;
}

export function getLocalUnits() {
    const pu = getLocalPlayer()?.Units;
    return pu ? pu.getUnits() : [];
}

export function restoreMovementSelected() {
    const u = getSelectedUnit(); if (!u) { ERR('no unit selected'); return; }
    restoreMovement(u.id);
    refreshUnitSelection(u.id);
}
export function healSelectedUnit()       { const u = getSelectedUnit(); if (!u) { ERR('no unit selected'); return; } healUnit(u.id); }
export function giveExperienceSelected(amount) { const u = getSelectedUnit(); if (!u) { ERR('no unit selected'); return; } giveExperience(u.id, amount); }

export function restoreMovementAll() { if (!guardSP()) return; for (const u of getLocalUnits()) Units.restoreMovement(u.id); LOG('restored movement: all units'); }
export function healAllUnits()       { if (!guardSP()) return; for (const u of getLocalUnits()) Units.setDamage(u.id, 0); LOG('healed: all units'); }

// ─── CITY ─────────────────────────────────────────────────────────────
export function getSelectedCity() {
    const cid = UI.Player.getHeadSelectedCity();
    if (cid) { const c = Cities.get(cid); if (c) return c; }
    return null;
}

export function getLocalCities() {
    const pc = getLocalPlayer()?.Cities;
    return pc ? pc.getCities() : [];
}

/** Snapshot of a city's display fields, defensive against missing components. (reads only) */
export function cityDisplay(c) {
    let name = '(city)';
    try { name = Locale.compose(c.name); } catch (e) { /* keep fallback */ }
    let pop = 0, isTown = false, x = -1, y = -1;
    try { pop = c.population ?? 0; } catch (e) {}
    try { isTown = !!c.isTown; } catch (e) {}
    try { const loc = c.location; if (loc) { x = loc.x; y = loc.y; } } catch (e) {}
    return { name, pop, isTown, x, y };
}

/** Center the camera on a city's plot. */
export function lookAtCity(c) {
    try { if (c.location && typeof Camera !== 'undefined') Camera.lookAtPlot(c.location, { zoom: 0.35 }); }
    catch (e) { ERR('lookAtCity failed:', e); }
}

// NOTE: completeProduction / addRuralPopulation call the city's component methods directly (the
// Sovereign cheat approach; there is no instant-complete CityOperation). If these prove inert from
// the UI isolate the way Units.create did, route them through Game.CityOperations.sendRequest instead.
export function completeProduction(city)        { if (!guardSP()) return; city?.BuildQueue?.completeProduction(); LOG('completed production for city', city?.id?.id); }
export function addRuralPopulation(city, amount) { if (!guardSP()) return; for (let i = 0; i < amount; i++) city.addRuralPopulation(1); LOG('added', amount, 'population to city', city?.id?.id); }

// ─── CITY TERRITORY GROWTH (M4.2) ─────────────────────────────────────
// Opens the game's own "grow city" tile picker for one city. INTERFACEMODE_ACQUIRE_TILE is the same
// on-map picker the base UI uses when a city grows: it highlights only valid ADJACENT plots (adjacency
// is the engine's only rule — there is no ring/distance cap, which is exactly what we want) and, when
// the player commits a plot, fires Game.CityCommands.sendRequest(cityID, EXPAND, {X,Y}) for us. There
// is NO relinquish/remove-plot counterpart in this build, so growth is claim-only.
// Refs: base-standard/ui/interface-modes/interface-mode-acquire-tile.js,
//       base-standard/ui/place-population/model-place-population.js.
// Returns the count of plots the city can claim RIGHT NOW. EXPAND only offers plots while the city
// has a pending growth to place (city.Growth.isReadyToPlacePopulation); once that growth is spent the
// engine returns zero. CityCommandTypes may not be an ambient global on every build → fall back to the
// string. Side-effect-free (canStart with the 4th arg false = no visualization).
export function cityExpandPlotCount(city) {
    const cityID = city?.id;
    if (!cityID) return 0;
    try {
        const cmd = (typeof CityCommandTypes !== 'undefined') ? CityCommandTypes.EXPAND : 'EXPAND';
        const res = Game.CityCommands?.canStart?.(cityID, cmd, {}, false);
        return (res && res.Plots) ? res.Plots.length : 0;
    } catch (e) { ERR('cityExpandPlotCount probe failed:', e); return 0; }
}

// Open the native grow-city tile picker for ONE city — but ONLY if it actually has a plot to claim.
// If there is no pending growth (0 expand plots) we must NOT enter INTERFACEMODE_ACQUIRE_TILE: for a
// full city the picker still opens (specialist/worker tiles keep it alive) yet nothing is claimable
// and there is no obvious way out → the player gets soft-locked in the picker. So we gate on the plot
// count first and only close the panel + switch modes when the claim can succeed.
// Returns { ok, reason, plots }. opts.closePanel() is invoked only on the success path.
export function growCity(city, opts = {}) {
    if (!guardSP()) return { ok: false, reason: 'guard' };
    const cityID = city?.id;
    if (!cityID) { ERR('growCity: no city id'); return { ok: false, reason: 'no-id' }; }
    try {
        const plots = cityExpandPlotCount(city);
        LOG('growCity: EXPAND offers', plots, 'plot(s) for city', cityID.id);
        if (plots === 0) {
            LOG('growCity: no pending growth to place — not entering the picker (would soft-lock).');
            return { ok: false, reason: 'no-growth', plots: 0 };
        }
        // Ready: leave the panel (so the map is fully clickable), pan to the city, enter the picker.
        opts.closePanel?.();
        if (city.location && typeof Camera !== 'undefined') Camera.lookAtPlot(city.location, { zoom: 0.4 });
        InterfaceMode.switchTo('INTERFACEMODE_ACQUIRE_TILE', { CityID: cityID });
        LOG('growCity: entered INTERFACEMODE_ACQUIRE_TILE for city', cityID.id);
        return { ok: true, reason: 'entered', plots };
    } catch (e) { ERR('growCity failed:', e); return { ok: false, reason: 'error' }; }
}

// ─── FREE TILE CLAIM (M4.3) ───────────────────────────────────────────
// Diagnostic helper: the ComponentID of the city that owns a plot right now (or null if unowned,
// undefined if the query is unavailable). GameplayMap.getOwningCityFromXY returns a city ComponentID
// (see base interface-mode-acquire-tile.js).
function ownerCityIdAt(loc) {
    try {
        if (typeof GameplayMap === 'undefined' || !GameplayMap.getOwningCityFromXY) return undefined;
        const c = GameplayMap.getOwningCityFromXY(loc.x, loc.y);
        return c ? c.id : null;
    } catch (_) { return undefined; }
}

// Claim an arbitrary plot for a city with NO radius / pending-growth gate, via city.purchasePlot — the
// same call the in-game tuner's City panel "PurchasePlot" tool makes (base ui/tuner-input/tuner-input.js),
// so it is callable from this UI isolate (unlike the maps-only Growth.claimPlot, which is likely inert
// here per the M3 Units.create lesson). Accepts a city ComponentID or a live city object. Logs the
// plot owner before/after so we can confirm in-game whether purchasePlot escapes the 3-ring radius.
export function claimPlotForCity(cityOrID, loc) {
    if (!guardSP()) return false;
    try {
        const city = (cityOrID && typeof cityOrID.purchasePlot === 'function') ? cityOrID : Cities.get(cityOrID);
        if (!city) { ERR('claimPlotForCity: no city for', cityOrID); return false; }
        if (typeof city.purchasePlot !== 'function') { ERR('claimPlotForCity: city.purchasePlot is not a function'); return false; }
        const before = ownerCityIdAt(loc);
        city.purchasePlot(loc);
        const after = ownerCityIdAt(loc);
        LOG('claimPlotForCity: purchasePlot (' + loc.x + ',' + loc.y + ') for city', city.id?.id,
            '| owning-city before:', before, 'after:', after);
        return true;
    } catch (e) { ERR('claimPlotForCity failed:', e); return false; }
}

// Enter the custom "Claim Tiles" map-click mode for a city (INTERFACEMODE_LCP_CLAIM_TILE, registered in
// claim-tile-mode.js). The caller closes the panel first so the map is fully clickable.
export function enterClaimMode(city, opts = {}) {
    if (!guardSP()) return false;
    const cityID = city?.id;
    if (!cityID) { ERR('enterClaimMode: no city id'); return false; }
    try {
        opts.closePanel?.();
        if (city.location && typeof Camera !== 'undefined') Camera.lookAtPlot(city.location, { zoom: 0.35 });
        InterfaceMode.switchTo('INTERFACEMODE_LCP_CLAIM_TILE', { CityID: cityID });
        LOG('enterClaimMode: entered INTERFACEMODE_LCP_CLAIM_TILE for city', cityID.id);
        return true;
    } catch (e) { ERR('enterClaimMode failed:', e); return false; }
}

export function completeProductionSelected() { const c = getSelectedCity(); if (!c) { ERR('no city selected'); return; } completeProduction(c); }
export function addPopulationSelected(amount) { const c = getSelectedCity(); if (!c) { ERR('no city selected'); return; } addRuralPopulation(c, amount); }
export function completeProductionAll() { if (!guardSP()) return; for (const c of getLocalCities()) c?.BuildQueue?.completeProduction(); LOG('completed production: all cities'); }
export function addPopulationAll(amount) { if (!guardSP()) return; for (const c of getLocalCities()) for (let i = 0; i < amount; i++) c.addRuralPopulation(1); LOG('added population: all cities'); }

// ─── MAP PAINT (M5) ───────────────────────────────────────────────────
// UI-callable map paint via WorldBuilder.MapPlots.set{Terrain,Feature,Resource,Biome}, the same path
// the in-game tuner uses (base ui/tuner-input/tuner-input.js lines 48/52/56/104). The set* methods
// expect a numeric type hash: tuner-input clears with FeatureTypes.NO_FEATURE / ResourceTypes.NO_RESOURCE
// (engine-exposed hash constants), and adjacent code uses Database.makeHash("STRING") for type strings
// (lines 100/109). So for an arbitrary type string we hash via Database.makeHash and pass that. Resource
// takes a third "amount" argument (the resource count); the tuner passes 1 for the normal case, 0 to
// erase — we default to 1.
//
// Enumerates all types in a paint category for the type-picker list. Returns [{type, name}] where
// `type` is the *Type string (e.g. "TERRAIN_GRASS") and `name` is the localized display label.
// GameInfo.{Terrains,Features,Resources,Biomes} are the gameplay tables exposed to the UI isolate
// (verified in base ui/* code: GameInfo.Terrains.lookup, GameInfo.Resources.lookup, etc.).
export function getMapPaintTypes(category) {
    const out = [];
    const tableKey = { Terrain: 'Terrains', Feature: 'Features', Resource: 'Resources', Biome: 'Biomes' }[category];
    const colKey   = { Terrain: 'TerrainType', Feature: 'FeatureType', Resource: 'ResourceType', Biome: 'BiomeType' }[category];
    if (!tableKey || !colKey) { ERR('getMapPaintTypes: unknown category', category); return out; }
    if (typeof GameInfo === 'undefined' || !GameInfo[tableKey]) { ERR('getMapPaintTypes: no GameInfo.' + tableKey); return out; }
    try {
        for (const row of GameInfo[tableKey]) {
            const type = row[colKey];
            if (!type) continue;
            let name = type;
            try { if (row.Name) name = Locale.compose(row.Name); } catch (_) { /* keep raw string */ }
            out.push({ type, name });
        }
        out.sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) { ERR('getMapPaintTypes failed for', category, e); }
    return out;
}

// Apply a single paint to one plot. Dispatches to the correct WorldBuilder.MapPlots.set* per category.
export function paintPlot(category, typeString, loc) {
    if (!guardSP()) return false;
    if (!loc || !Number.isInteger(loc.x) || !Number.isInteger(loc.y)) { ERR('paintPlot: bad loc', loc); return false; }
    if (!typeString) { ERR('paintPlot: no type string'); return false; }
    try {
        const hash = Database.makeHash(typeString);
        switch (category) {
            case 'Terrain':  WorldBuilder.MapPlots.setTerrain(hash, loc); break;
            case 'Feature':  WorldBuilder.MapPlots.setFeature(hash, loc); break;
            case 'Resource': WorldBuilder.MapPlots.setResource(hash, loc, 1); break;
            case 'Biome':    WorldBuilder.MapPlots.setBiome(hash, loc); break;
            default: ERR('paintPlot: unknown category', category); return false;
        }
        LOG('paint', category, typeString, 'at (' + loc.x + ',' + loc.y + ')');
        return true;
    } catch (e) { ERR('paintPlot failed:', e); return false; }
}

// Enter the custom paint map-click mode (INTERFACEMODE_LCP_PAINT_TILE, registered in paint-tile-mode.js).
// Mirrors enterClaimMode: the caller closes the panel first so the map is fully clickable.
export function enterPaintMode({ category, typeString }, opts = {}) {
    if (!guardSP()) return false;
    if (!category || !typeString) { ERR('enterPaintMode: missing category/type', category, typeString); return false; }
    try {
        opts.closePanel?.();
        InterfaceMode.switchTo('INTERFACEMODE_LCP_PAINT_TILE', { Category: category, TypeString: typeString });
        LOG('enterPaintMode: entered for', category, '=', typeString);
        return true;
    } catch (e) { ERR('enterPaintMode failed:', e); return false; }
}

// ─── MAP PREVIEW (M5.2) ───────────────────────────────────────────────
// Read-only minimap data: terrain/biome/river/natural-wonder per plot, plus optional cities and
// resources. This is PURELY READS via GameplayMap.* — it does NOT touch fog-of-war / Visibility, does
// NOT mutate save state, and grants NO in-game vision. The intended use is the in-panel "Map Preview"
// canvas so the player can plan placement without actually revealing the map.
//
// All APIs used here are verified in the base UI:
//   GameplayMap.getGridWidth/getGridHeight     — base ui/unit-flags/unit-flag-manager.js
//   GameplayMap.getTerrainType/getBiomeType    — ditto
//   GameplayMap.getFeatureType/getResourceType — base ui/lenses/layer/resource-layer.js
//   GameplayMap.getRiverType                   — base ui-next/tooltips/plot-tooltip/helpers.js (RiverTypes.NO_RIVER / RIVER_MINOR / RIVER_NAVIGABLE)
//   GameplayMap.isNaturalWonder                — base ui/lenses/layer/continent-layer.js
//   GameplayMap.isMountain / isWater           — used elsewhere in this api.js
//   UI.Color.getPlayerColors(pid)?.primaryColor — base ui/trade-route-chooser/trade-route-chooser.js
//   Players.getAlive()                         — base ui/action/panel-action.js
export function getMapDimensions() {
    try { return { width: GameplayMap.getGridWidth(), height: GameplayMap.getGridHeight() }; }
    catch (e) { ERR('getMapDimensions failed:', e); return { width: 0, height: 0 }; }
}

// Single-pass snapshot of the entire map. Returns:
//   {
//     width, height,
//     plots:     [{terr, biome, water, mountain, hills, river, nw, hasResource}] indexed by y*W+x
//     cities:    [{x, y, name, color, isCapital, ownerID}]
//     resources: [{x, y, cls}] where cls is the ResourceClassType string
//     myUnits:   [{x, y, name, kind, color}] LOCAL PLAYER ONLY (no AI / no other-player units)
//   }
// Iterating ~6000 plots takes well under 100ms; cached at the call site so tab re-renders are free.
// `myUnits` is intentionally limited to the local player — the user explicitly asked NOT to track AI.
export function getMapSnapshot(opts = {}) {
    const includeCities    = opts.includeCities    !== false;
    const includeResources = opts.includeResources !== false;
    const includeMyUnits   = opts.includeMyUnits   !== false;
    const { width: W, height: H } = getMapDimensions();
    if (!W || !H) return { width: 0, height: 0, plots: null, cities: [], resources: [] };

    // Cache hash -> name lookups across the iteration so we hit GameInfo at most once per unique value.
    const terrainCache = Object.create(null);
    const biomeCache   = Object.create(null);
    const resolveTerrain = (h) => {
        if (h in terrainCache) return terrainCache[h];
        let name = null; try { name = GameInfo?.Terrains?.lookup?.(h)?.TerrainType || null; } catch (_) {}
        return (terrainCache[h] = name);
    };
    const resolveBiome = (h) => {
        if (h in biomeCache) return biomeCache[h];
        let name = null; try { name = GameInfo?.Biomes?.lookup?.(h)?.BiomeType || null; } catch (_) {}
        return (biomeCache[h] = name);
    };

    const noResource = (typeof ResourceTypes !== 'undefined' && ResourceTypes.NO_RESOURCE !== undefined) ? ResourceTypes.NO_RESOURCE : -1;

    const plots = new Array(W * H);
    const resources = [];

    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const i = y * W + x;
            let terr = '', biome = '', water = false, mountain = false, hills = false, river = 0, nw = false, hasResource = false;
            try { terr     = resolveTerrain(GameplayMap.getTerrainType(x, y)) || ''; } catch (_) {}
            try { biome    = resolveBiome(GameplayMap.getBiomeType(x, y))     || ''; } catch (_) {}
            try { water    = !!GameplayMap.isWater(x, y); } catch (_) {}
            try { mountain = !!GameplayMap.isMountain(x, y); } catch (_) {}
            try { river    = GameplayMap.getRiverType(x, y) | 0; } catch (_) {}
            try { nw       = !!GameplayMap.isNaturalWonder(x, y); } catch (_) {}
            hills = (terr === 'TERRAIN_HILL'); // TERRAIN_HILL is land + elevated, see base data

            if (includeResources) {
                let r = -1;
                try { r = GameplayMap.getResourceType(x, y); } catch (_) {}
                if (r !== noResource && r !== -1 && r !== 0) {
                    hasResource = true;
                    let cls = '';
                    try { cls = GameInfo?.Resources?.lookup?.(r)?.ResourceClassType || ''; } catch (_) {}
                    resources.push({ x, y, cls });
                }
            }
            plots[i] = { terr, biome, water, mountain, hills, river, nw, hasResource };
        }
    }

    const cities = [];
    if (includeCities) {
        try {
            const alive = (typeof Players !== 'undefined' && Players.getAlive) ? Players.getAlive() : [];
            for (const p of alive) {
                if (!p || !p.Cities || typeof p.Cities.getCities !== 'function') continue;
                let color = null;
                try {
                    const pc = UI?.Color?.getPlayerColors?.(p.id);
                    if (pc?.primaryColor) {
                        const c = pc.primaryColor;
                        // primaryColor channels are already 0..255 (verified vs base
                        // trade-route-chooser.js:304 — `rgb(${c.r} ${c.g} ${c.b})`, no *255).
                        // The earlier *255 pushed e.g. 38 → 9690, which CSS clamps to 255 = white.
                        color = 'rgb(' + Math.round(c.r || 0) + ',' + Math.round(c.g || 0) + ',' + Math.round(c.b || 0) + ')';
                    }
                } catch (_) {}
                for (const c of p.Cities.getCities()) {
                    try {
                        if (!c?.location) continue;
                        let name = '(city)';
                        try { if (c.name) name = Locale.compose(c.name); } catch (_) {}
                        cities.push({ x: c.location.x, y: c.location.y, name, color, isCapital: !!c.isCapital, ownerID: p.id });
                    } catch (_) {}
                }
            }
        } catch (e) { ERR('getMapSnapshot cities failed:', e); }
    }

    // Local player's units only — used by the minimap "Me" filter so the player can see where their
    // starting settler is (etc.) without revealing AI positions or having to scout the map.
    const myUnits = [];
    if (includeMyUnits) {
        try {
            const me = getLocalPlayer();
            if (me && me.Units && typeof me.Units.getUnits === 'function') {
                let color = null;
                try {
                    const pc = UI?.Color?.getPlayerColors?.(me.id);
                    if (pc?.primaryColor) {
                        const c = pc.primaryColor;
                        // 0..255 already (see cities branch above) — do NOT multiply by 255.
                        color = 'rgb(' + Math.round(c.r || 0) + ',' + Math.round(c.g || 0) + ',' + Math.round(c.b || 0) + ')';
                    }
                } catch (_) {}
                for (const u of me.Units.getUnits()) {
                    try {
                        if (!u?.location) continue;
                        let name = '(unit)';
                        try { name = Locale.compose(u.name); } catch (_) {}
                        let kind = '';
                        try { kind = GameInfo?.Units?.lookup?.(u.type)?.Domain || ''; } catch (_) {}
                        myUnits.push({ x: u.location.x, y: u.location.y, name, kind, color });
                    } catch (_) {}
                }
            }
        } catch (e) { ERR('getMapSnapshot myUnits failed:', e); }
    }

    return { width: W, height: H, plots, cities, resources, myUnits };
}

// ─── RESEARCH / CIVIC ─────────────────────────────────────────────────
// Completion is done by overflowing the relevant yield (the verified Sovereign approach) — there is
// no direct setResearchProgress on this build.
export function completeResearch() {
    if (!guardSP()) return;
    const player = getLocalPlayer();
    const techs = player?.Techs;
    if (!techs) return;
    const treeObject = Game.ProgressionTrees.getTree(player.id, techs.getTreeType());
    if (!treeObject) return;
    const currentNode = treeObject.nodes[treeObject.activeNodeIndex]?.nodeType;
    if (currentNode == null) return;
    if (!GameInfo.ProgressionTreeNodes.lookup(currentNode)) return;
    const cost = techs.getNodeCost(currentNode);
    const perTurn = player.Stats?.getNetYield(YieldTypes.YIELD_SCIENCE) ?? 0;
    const turnsLeft = techs.getTurnsLeft();
    const granted = perTurn > 0 ? (perTurn * turnsLeft) * 1.4 : cost;
    Players.grantYield(player.id, YieldTypes.YIELD_SCIENCE, granted);
    LOG('completed current research');
}

export function completeCivic() {
    if (!guardSP()) return;
    const player = getLocalPlayer();
    const culture = player?.Culture;
    if (!culture) return;
    const treeObject = Game.ProgressionTrees.getTree(player.id, culture.getActiveTree());
    if (!treeObject) return;
    const currentNode = treeObject.nodes[treeObject.activeNodeIndex]?.nodeType;
    if (currentNode == null) return;
    if (!GameInfo.ProgressionTreeNodes.lookup(currentNode)) return;
    const cost = culture.getNodeCost(currentNode);
    const perTurn = player.Stats?.getNetYield(YieldTypes.YIELD_CULTURE) ?? 0;
    const turnsLeft = culture.getTurnsLeft();
    const granted = perTurn > 0 ? (perTurn * turnsLeft) * 1.4 : cost;
    Players.grantYield(player.id, YieldTypes.YIELD_CULTURE, granted);
    LOG('completed current civic');
}
