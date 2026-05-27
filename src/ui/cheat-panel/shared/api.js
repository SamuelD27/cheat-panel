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

export function completeProductionSelected() { const c = getSelectedCity(); if (!c) { ERR('no city selected'); return; } completeProduction(c); }
export function addPopulationSelected(amount) { const c = getSelectedCity(); if (!c) { ERR('no city selected'); return; } addRuralPopulation(c, amount); }
export function completeProductionAll() { if (!guardSP()) return; for (const c of getLocalCities()) c?.BuildQueue?.completeProduction(); LOG('completed production: all cities'); }
export function addPopulationAll(amount) { if (!guardSP()) return; for (const c of getLocalCities()) for (let i = 0; i < amount; i++) c.addRuralPopulation(1); LOG('added population: all cities'); }

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
