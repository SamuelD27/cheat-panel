/**
 * @file shared/api.js
 * @description Thin, single-player-guarded wrappers around the verified engine calls.
 *
 * This is the one place cheat logic touches the engine, so any future API drift is a one-file fix.
 * Uses ambient engine globals (Players, Units, Cities, Game, GameContext, GameInfo, YieldTypes, UI,
 * Configuration) — these are provided by the UI isolate and need no import. No /core imports here;
 * those live only in ./imports.js.
 *
 * All calls below are verified against build 23245653 (from the proven Sovereign panel + base UI).
 */

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

/** Delete (disband) a unit. Uses the normal gameplay command — no debug mode required. */
export function deleteUnit(unitId) {
    if (!guardSP()) return;
    try {
        Game.UnitCommands.sendRequest(unitId, "UNITCOMMAND_DISBAND", {});
        LOG('disbanded unit', unitId?.id);
    } catch (e) { ERR('deleteUnit failed:', e); }
}

/**
 * Duplicate a unit: spawn a plain copy of the same unit type. Validate:true makes the engine place
 * it on an available adjacent tile when the source plot is occupied. No promotions or XP are copied.
 * Returns the clone's ComponentID or null.
 */
export function duplicateUnit(unit) {
    if (!guardSP()) return null;
    try {
        const owner = unit?.id?.owner ?? GameContext.localPlayerID;
        const type = unit?.type;
        const loc = unit?.location;
        if (type == null || !loc) { ERR('duplicateUnit: missing type/location'); return null; }
        const result = Units.create(owner, { Type: type, Location: loc, Validate: true });
        if (result && result.Success && result.ID) {
            LOG('duplicated unit; clone id', result.ID?.id);
            return result.ID;
        }
        ERR('duplicateUnit: Units.create did not succeed:', result);
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

export function completeProduction(city)        { if (!guardSP()) return; city?.BuildQueue?.completeProduction(); }
export function addRuralPopulation(city, amount) { if (!guardSP()) return; for (let i = 0; i < amount; i++) city.addRuralPopulation(1); }

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
