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

// ─── UI.log breadcrumb channel (panel isolate) ────────────────────────
// console.log / console.error from THIS Gameface UI isolate do NOT reliably reach UI.log (verified:
// tab-map/api "LCP:" lines never appear on disk, though the dock's console.error does). But assigning
// a NON-<length> string to an element's style.maxWidth makes the engine synchronously emit
//   Trying to set "maxWidth" property to invalid value: <str>
// into UI.log — PROVEN, since tab-map's PROBE_* breadcrumbs surface there. We reuse that as a log sink
// WE can read from disk after an in-game test — the only reliable way to observe this isolate.
//   • prefix 'LCPD' so it's greppable and (for maxWidth) never a valid length → always logs
//   • a monotonic counter makes every emission a UNIQUE value, so two identical events both log
//   • ALSO console.error (reaches UI.log from the dock / interface-mode contexts, e.g. paint mode
//     which closes the panel and detaches the maxWidth element) — belt-and-suspenders across contexts
let _diagEl = null, _diagDoc = null, _diagN = 0;
export function diagInit(doc) {
    try {
        if (doc) _diagDoc = doc;
        if (!_diagDoc && typeof document !== 'undefined') _diagDoc = document;
        if (!_diagEl && _diagDoc) {
            _diagEl = _diagDoc.createElement('div');
            _diagEl.style.display = 'none';
            (_diagDoc.body || _diagDoc.documentElement).appendChild(_diagEl);
        }
    } catch (_) { /* diagnostics must never break the panel */ }
}
export function diag(str) {
    _diagN++;
    try { console.error('LCPD:' + _diagN + ':' + str); } catch (_) {}
    try {
        if (!_diagEl) diagInit();
        if (_diagEl) _diagEl.style.maxWidth = 'LCPD~' + _diagN + '~' + str;
    } catch (_) {}
}

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
export function restoreMovement(unitId) { if (!guardSP()) return; Units.restoreMovement(unitId); refreshUnitFlag(unitId); LOG('restoreMovement', unitId?.id); }
export function healUnit(unitId)        { if (!guardSP()) return; Units.setDamage(unitId, 0); }
export function giveExperience(unitId, amount) { if (!guardSP()) return; Units.changeExperience(unitId, amount); }

/**
 * Best-effort refresh of a unit's on-map flag after a movement-point restore.
 *
 * WHY (Steam-comment "restore movement doesn't work"): the moves DO come back — the global infinite-move
 * toggle (verified in-game) restores via this exact `Units.restoreMovement` from this same isolate. The
 * problem is purely a stale on-map flag: `restoreMovement` emits the engine event
 * `UnitMovementPointsRestored`, which NOTHING in the shipped UI listens to; the flag only drops its greyed
 * `no_movement` state from `updateMovement()`, called solely by the flag manager's
 * `UnitMovementPointsChanged` handler (base unit-flag-manager.js:164/277 → unit-flags.js:491, which just
 * re-reads movementMovesRemaining and un-greys when it's non-zero). The manual [Move] button, unlike an
 * actual move, produces no such event — so the unit stays greyed and auto-cycle skips it, reading as
 * "didn't work" even though it CAN move. Re-emitting `UnitMovementPointsChanged` runs that refresh. All
 * three of its listeners are read-only (flag un-grey, action-panel re-eval, tutorial nudge — verified),
 * so firing it is side-effect-safe. Best-effort: if a UI-side trigger doesn't reach the flag manager's
 * context, this is a harmless no-op and the caller's in-panel row repaint still confirms the restore.
 */
export function refreshUnitFlag(unitId) {
    try {
        if (typeof engine !== 'undefined' && engine.trigger) {
            engine.trigger('UnitMovementPointsChanged', { unit: unitId });
        }
    } catch (e) { /* best-effort only — never let a refresh failure surface as a restore failure */ }
}

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
 * Remove a unit via the DESTROY_ELEMENT player operation — the in-game tuner's removal path
 * (base tuner-input.js). NOT the UNITCOMMAND_DELETE unit-command: as of game update **1.4.1**,
 * `canStart("UNITCOMMAND_DELETE")` returns `{Success:false}` (verified live via the tuner) so the
 * command is silently rejected and the unit never goes away — which on 1.4.1 broke both the per-row
 * Delete AND the teleport (destroy+recreate left a DUPLICATE because the original was never removed).
 * DESTROY_ELEMENT is the lower-level element-lifecycle op (no command-gating) and was confirmed live
 * to remove the unit on 1.4.1. (Older note, kept for history: we'd earlier moved DISBAND→DELETE because
 * DISBAND's canStart rejected silently; 1.4.1 now does the same to DELETE, hence DESTROY_ELEMENT.)
 */
export function deleteUnit(unitId) {
    if (!guardSP()) return;
    try {
        const owner = unitId?.owner ?? GameContext.localPlayerID;
        Game.PlayerOperations.sendRequest(owner, "DESTROY_ELEMENT", { Kind: "UNIT", Owner: owner, LocalID: unitId.id });
        LOG('deleted unit', unitId?.id, 'via DESTROY_ELEMENT');
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

// ─── UNIT TELEPORT (Map tab) ──────────────────────────────────────────
// Relocate a unit to an arbitrary plot by DESTROY + RECREATE. The hidden UNITOPERATION_TELEPORT_TO
// op is engine-walled from this isolate (build 23245653: it exists only as data rows in
// base-standard/data/unit-operations.xml with ZERO JS call sites anywhere in the shipped game, so the
// gameplay layer silently drops an isolate sendRequest — CONFIRMED in-game: the unit never moved and
// the old code fell back to a MOVE_TO walk = the "rejected — move order issued" the user reported).
// The working path is the one the in-game tuner and our M3 Duplicate use: CREATE_ELEMENT a same-type
// unit at the destination, then delete the original via DESTROY_ELEMENT (deleteUnit). We create FIRST
// and delete the original only AFTER the new unit is confirmed on the destination, so a failed create
// can never lose the unit. NB (1.4.1): the original code deleted via UNITCOMMAND_DELETE, which 1.4.1
// rejects (canStart Success:false) → the original was never removed → a DUPLICATE, not a teleport;
// deleteUnit now uses DESTROY_ELEMENT (verified live on 1.4.1).
//
// TRADE-OFF: this is a FRESH same-type unit — XP, promotions, custom name, damage/movement state and
// army membership are NOT preserved (CREATE_ELEMENT spawns a plain unit). For a cheat sandbox that is
// acceptable; the Map-tab status line + a standing note disclose it. (Units.create is gameplay-SCRIPT
// only and inert from this isolate — the M3 lesson — which is why CREATE_ELEMENT is used. An
// identity-preserving Units.setLocation exists in base scripts but is unverified from the isolate.)
//
// The destination is pre-validated with the same plot rules as Duplicate (in-bounds / domain / not
// impassable / no enemy / no same-class stack). Re-entry: the Map tab blocks a new teleport while one
// is in flight (tab-map.js `tpInFlight`), so two create+delete chains can't run at once and strand a
// duplicate (chain A creates unit-A, gets abandoned, chain B deletes the lone original → orphan).
export function teleportUnitTo(unit, loc, opts = {}) {
    const onDone = opts.onDone || (() => {});
    if (!guardSP()) return { ok: false, reason: 'multiplayer' };
    if (!loc || !Number.isInteger(loc.x) || !Number.isInteger(loc.y)) { ERR('teleportUnitTo: bad loc', loc); return { ok: false, reason: 'bad-loc' }; }
    const id = unit?.id;
    const from = unit?.location;
    const def = (unit?.type != null) ? GameInfo.Units.lookup(unit.type) : null;
    if (!id || !from || !def) { ERR('teleportUnitTo: missing unit id/location/def', id, from, def?.UnitType); return { ok: false, reason: 'no-unit' }; }
    if (from.x === loc.x && from.y === loc.y) { LOG('teleportUnitTo: unit already at (' + loc.x + ',' + loc.y + ')'); return { ok: false, reason: 'same-plot' }; }

    // STEP 1/4: destination pre-check (same rules as Duplicate's placement validation).
    const why = plotBlockReason(loc, def.Domain, def.FormationClass, id.owner);
    if (why) { LOG('teleportUnitTo: destination (' + loc.x + ',' + loc.y + ') blocked: ' + why); return { ok: false, reason: why }; }

    // STEP 1.5/4: Distant-Lands guard — the REAL cause of "teleport failed" (proven live via tuner
    // 2026-07-13, NOT fog as earlier believed). CREATE_ELEMENT silently seats 0 units on a Distant
    // Lands tile (Players.get(owner).isDistantLands({x,y})===true) — the engine age-rule that units
    // can't exist on the far hemisphere this age. Home-continent tiles (distantLands=false) place fine
    // regardless of fog. Reject early with a clear reason instead of the old silent create-then-fail.
    try {
        const player = Players.get(id.owner);
        if (player && typeof player.isDistantLands === 'function' && player.isDistantLands({ x: loc.x, y: loc.y })) {
            diag('tp.block:distant-lands,@' + loc.x + '/' + loc.y);
            LOG('teleportUnitTo: destination (' + loc.x + ',' + loc.y + ') is Distant Lands — engine forbids unit placement there this age');
            return { ok: false, reason: 'distant-lands' };
        }
    } catch (e) { diag('tp.dlcheck:THROW,' + String(e && e.message || e)); }

    // STEP 2/4: snapshot (a) the units already on the destination and (b) ALL of the player's unit ids,
    // so the freshly-created one can be told apart at the destination OR detected if the engine seats it
    // off-target. CREATE_ELEMENT is fire-and-forget and the new unit gets a brand-new ComponentID.
    const owner = id.owner;
    const utype = unit.type;
    const keyOf = (cid) => cid.owner + ':' + cid.id;
    const before = new Set();
    let mapUnitsErr = '';
    try { for (const cid of MapUnits.getUnits(loc.x, loc.y)) before.add(keyOf(cid)); }
    catch (e) { mapUnitsErr = String(e && e.message || e); }
    const allBefore = new Set();
    try { for (const u of getLocalUnits()) if (u && u.id) allBefore.add(keyOf(u.id)); } catch (_) {}
    diag('tp.env:MapUnits=' + (typeof MapUnits) + ',destBefore=' + before.size + ',allBefore=' + allBefore.size
        + (mapUnitsErr ? ',MapUnitsErr=' + mapUnitsErr : '') + ',to=' + loc.x + '/' + loc.y + ',from=' + from.x + '/' + from.y);

    // STEP 3/4: create a same-type unit AT the destination (the proven M3 Duplicate path — Units.create
    // is inert from this isolate; CREATE_ELEMENT is the working one).
    let createSent = false;
    try {
        Game.PlayerOperations.sendRequest(owner, 'CREATE_ELEMENT',
            { Kind: 'UNIT', Type: utype, Location: { x: loc.x, y: loc.y }, Owner: owner, IndependentIndex: -1 });
        createSent = true;
        LOG('teleportUnitTo: CREATE_ELEMENT ' + def.UnitType + ' at (' + loc.x + ',' + loc.y + ') [from (' + from.x + ',' + from.y + ')]');
        diag('tp.create:sent,' + def.UnitType + ',@' + loc.x + '/' + loc.y);
    } catch (e) { ERR('teleportUnitTo: CREATE_ELEMENT failed:', e); diag('tp.create:THROW,' + String(e && e.message || e)); return { ok: false, reason: 'send-failed' }; }

    // STEP 4/4: poll for the new unit. Prefer one seated AT the destination; the moment it appears,
    // delete the ORIGINAL (so this reads as a move, not a duplicate). Detection is by "a NEW owned
    // ComponentID at the destination" — deliberately NOT gated on type-match, which is fragile across
    // patches. On give-up, return a rich diag (createSent, dest unit-count before→after, whether a unit
    // appeared elsewhere) because panel-isolate logs don't reach UI.log — the Map tab surfaces it.
    // (No supersession token: the Map tab serializes teleports via tpInFlight, so each chain runs to
    // completion — abandoning one mid-flight would strand its freshly-created unit.)
    let polls = 0;
    const destCount = () => { try { return MapUnits.getUnits(loc.x, loc.y).length; } catch (_) { return -1; } };
    const newAtDest = () => {
        try { for (const cid of MapUnits.getUnits(loc.x, loc.y)) if (cid.owner === owner && !before.has(keyOf(cid))) return cid; } catch (_) {}
        return null;
    };
    const newElsewhere = () => {
        try { for (const u of getLocalUnits()) if (u && u.id && !allBefore.has(keyOf(u.id))) return u; } catch (_) {}
        return null;
    };
    const poll = () => {
        polls++;
        const fresh = newAtDest();
        if (fresh) {
            deleteUnit(id);   // remove the original (DESTROY_ELEMENT — 1.4.1 rejects UNITCOMMAND_DELETE); XP/promotions lost
            LOG('teleportUnitTo: arrived at (' + loc.x + ',' + loc.y + ') after ' + polls + ' poll(s); original ' + id.id + ' deleted');
            diag('tp.result:MOVED,polls=' + polls + ',dest=' + before.size + '>' + destCount());
            onDone({ moved: true, newId: fresh, loc, diag: { createSent, destBefore: before.size, destAfter: destCount(), polls } });
            return;
        }
        if (polls < 8) { setTimeout(poll, 200); return; }
        const elsewhere = newElsewhere();
        const dg = { createSent, destBefore: before.size, destAfter: destCount(),
            placedElsewhere: (elsewhere && elsewhere.location) ? { x: elsewhere.location.x, y: elsewhere.location.y } : null, polls };
        LOG('teleportUnitTo: no unit seated at (' + loc.x + ',' + loc.y + ') after ' + polls + ' polls; diag=' + JSON.stringify(dg));
        diag('tp.result:FAIL,polls=' + polls + ',create=' + (dg.createSent ? 'sent' : 'no') + ',dest=' + dg.destBefore + '>' + dg.destAfter
            + ',elsewhere=' + (dg.placedElsewhere ? (dg.placedElsewhere.x + '/' + dg.placedElsewhere.y) : 'none'));
        onDone({ moved: false, loc, diag: dg });
    };
    setTimeout(poll, 150);
    return { ok: true, reason: 'sent' };
}

/** Teleport the currently selected unit (see teleportUnitTo). */
export function teleportSelectedUnitTo(loc, opts = {}) {
    const u = getSelectedUnit();
    if (!u) { LOG('teleportSelectedUnitTo: no unit selected'); return { ok: false, reason: 'no-selection' }; }
    return teleportUnitTo(u, loc, opts);
}

/**
 * Reveal the ENTIRE map for the local player (fog-of-war cheat). Uses Visibility.revealAllPlots —
 * confirmed live 2026-07-13 (reveals all 128×N plots; getRevealedState reflects it on the next frame).
 * One-way: there is no un-reveal (reload a save to restore fog). NOTE this does NOT enable teleport to
 * the far hemisphere — unit placement on Distant Lands is a separate engine age-rule (see teleportUnitTo).
 * Returns true if the reveal call was made.
 */
export function revealEntireMap() {
    if (!guardSP()) return false;
    try {
        const p = GameContext.localPlayerID;
        if (typeof Visibility === 'undefined' || !Visibility.revealAllPlots) { ERR('revealEntireMap: Visibility.revealAllPlots unavailable'); return false; }
        Visibility.revealAllPlots(p);
        LOG('revealEntireMap: revealAllPlots(' + p + ') sent — whole map revealed (reload to restore fog)');
        return true;
    } catch (e) { ERR('revealEntireMap failed:', e); return false; }
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

export function restoreMovementAll() { if (!guardSP()) return; for (const u of getLocalUnits()) { Units.restoreMovement(u.id); refreshUnitFlag(u.id); } LOG('restored movement: all units'); }
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

// Claim an arbitrary plot for a city at ANY distance, with NO radius / growth / gold gate.
//
// We use WorldBuilder.MapPlots.setOwnership(player, loc) — the in-game tuner's MapPanel "PlotOwnership"
// tool (base ui/tuner-input/tuner-input.js:96), callable from this UI isolate and with no distance cap.
// We deliberately do NOT use city.purchasePlot here: that is the engine's expansion-PURCHASE path, gated
// to the city's canStart(EXPAND).Plots set (growth/ring/gold-limited — verified against
// model-place-population.js:91 + interface-mode-acquire-tile.js:295,:340), so it only ever reached
// nearby tiles on a developed city. That gate — not our code — is the "unlimited distance" regression;
// claimPlotForCity itself is byte-for-byte the M4.3 version otherwise. setOwnership is PLAYER-level: it
// extends your civ border to any tile you click (reversible via setOwnership(PlayerIds.NO_PLAYER, loc)).
// A far exclave tile may not be actively worked by the city — the accepted trade for true unlimited reach
// (territory-only, per the user's choice; the alternative was placing a rural district to force a work
// attachment). purchasePlot is kept ONLY as a fallback if WorldBuilder is somehow unavailable here.
// Accepts a city ComponentID or a live city object; logs the owning-city before/after.
export function claimPlotForCity(cityOrID, loc) {
    if (!guardSP()) return false;
    if (!loc || !Number.isInteger(loc.x) || !Number.isInteger(loc.y)) { ERR('claimPlotForCity: bad loc', loc); return false; }
    try {
        const city = (cityOrID && typeof cityOrID.purchasePlot === 'function') ? cityOrID : Cities.get(cityOrID);
        if (!city) { ERR('claimPlotForCity: no city for', cityOrID); return false; }
        const owner = (city.id && city.id.owner != null) ? city.id.owner : GameContext.localPlayerID;
        const before = ownerCityIdAt(loc);

        if (typeof WorldBuilder !== 'undefined' && WorldBuilder.MapPlots && typeof WorldBuilder.MapPlots.setOwnership === 'function') {
            WorldBuilder.MapPlots.setOwnership(owner, loc);   // unlimited distance, no ring/growth/gold gate
            const after = ownerCityIdAt(loc);
            LOG('claimPlotForCity: setOwnership(player ' + owner + ') (' + loc.x + ',' + loc.y + ') for city', city.id?.id,
                '| owning-city before:', before, 'after:', after);
            return true;
        }

        // Fallback only (WorldBuilder missing in this isolate): the old in-range purchase path.
        if (typeof city.purchasePlot === 'function') {
            city.purchasePlot(loc);
            const after = ownerCityIdAt(loc);
            LOG('claimPlotForCity: WorldBuilder unavailable — fell back to purchasePlot (' + loc.x + ',' + loc.y + ')',
                '| owning-city before:', before, 'after:', after);
            return true;
        }
        ERR('claimPlotForCity: neither WorldBuilder.setOwnership nor city.purchasePlot available');
        return false;
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
        // Re-entry guard: now that F8 opens the panel in ANY interface mode, the user can re-enter
        // claim mode for a DIFFERENT city while it is still active. Base switchTo() no-ops (returns
        // false) when the target mode is already current — the old CityID would silently stick — so
        // exit to default first, then enter fresh with the new parameters.
        try { if (InterfaceMode.getCurrent && InterfaceMode.getCurrent() === 'INTERFACEMODE_LCP_CLAIM_TILE') InterfaceMode.switchToDefault(); } catch (_) {}
        const ok = InterfaceMode.switchTo('INTERFACEMODE_LCP_CLAIM_TILE', { CityID: cityID });
        if (ok === false) { ERR('enterClaimMode: switchTo refused INTERFACEMODE_LCP_CLAIM_TILE'); return false; }
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
// Sentinel "type" for the Resource category meaning "clear/remove the resource on the clicked tile".
// Surfaced as the first entry in the Resource type list (getMapPaintTypes) and handled specially in
// paintPlot via WorldBuilder.MapPlots.setResource(ResourceTypes.NO_RESOURCE, loc, 0) — the tuner's
// erase path (base tuner-input.js:171).
export const CLEAR_RESOURCE = '__LCP_CLEAR_RESOURCE__';

// Set of FeatureType strings that are natural wonders (have a Feature_NaturalWonders row). Cached. Used
// to hide natural wonders from the generic Feature list (they need terrain/biome prep — see the Wonder
// category) so the user doesn't keep getting silent red on them.
let _nwSet = null;
function naturalWonderTypeSet() {
    if (_nwSet) return _nwSet;
    const s = new Set();
    try { for (const r of GameInfo.Feature_NaturalWonders) if (r.FeatureType) s.add(r.FeatureType); } catch (_) {}
    _nwSet = s;
    return s;
}

// List natural wonders for the Wonder paint category: {type, name, tiles, terrain, biome}. Single-tile
// wonders sort first — they are the only ones the panel can plausibly place. Multi-tile wonders are
// shape-anchored by the map-gen-only TerrainBuilder (unreachable from the UI isolate), so they're listed
// but flagged unsupported.
export function getNaturalWonderTypes() {
    const out = [];
    try {
        if (typeof GameInfo === 'undefined' || !GameInfo.Feature_NaturalWonders) return out;
        const terr = Object.create(null), biome = Object.create(null), names = Object.create(null);
        try { for (const r of GameInfo.Features) if (r.FeatureType) names[r.FeatureType] = (r.Name ? Locale.compose(r.Name) : r.FeatureType); } catch (_) {}
        try { for (const r of GameInfo.Feature_ValidTerrains) if (r.FeatureType && !(r.FeatureType in terr)) terr[r.FeatureType] = r.TerrainType; } catch (_) {}
        try { for (const r of GameInfo.Feature_ValidBiomes) if (r.FeatureType && !(r.FeatureType in biome)) biome[r.FeatureType] = r.BiomeType; } catch (_) {}
        for (const nw of GameInfo.Feature_NaturalWonders) {
            const type = nw.FeatureType; if (!type) continue;
            out.push({ type, name: names[type] || type, tiles: nw.Tiles ?? 1, terrain: terr[type] || null, biome: biome[type] || null });
        }
        out.sort((a, b) => (a.tiles - b.tiles) || a.name.localeCompare(b.name));
    } catch (e) { ERR('getNaturalWonderTypes failed:', e); }
    return out;
}

// Enumerates all types in a paint category for the type-picker list. Returns [{type, name}] where
// `type` is the *Type string (e.g. "TERRAIN_GRASS") and `name` is the localized display label.
// GameInfo.{Terrains,Features,Resources,Biomes} are the gameplay tables exposed to the UI isolate
// (verified in base ui/* code: GameInfo.Terrains.lookup, GameInfo.Resources.lookup, etc.).
export function getMapPaintTypes(category) {
    const out = [];
    // The Wonder category is special: natural wonders come from Feature_NaturalWonders, not a flat table.
    if (category === 'Wonder') {
        return getNaturalWonderTypes().map(w => ({
            type: w.type,
            name: (w.tiles > 1) ? (w.name + ' — ' + w.tiles + '-tile (not placeable)') : w.name,
        }));
    }
    const tableKey = { Terrain: 'Terrains', Feature: 'Features', Resource: 'Resources', Biome: 'Biomes' }[category];
    const colKey   = { Terrain: 'TerrainType', Feature: 'FeatureType', Resource: 'ResourceType', Biome: 'BiomeType' }[category];
    if (!tableKey || !colKey) { ERR('getMapPaintTypes: unknown category', category); return out; }
    if (typeof GameInfo === 'undefined' || !GameInfo[tableKey]) { ERR('getMapPaintTypes: no GameInfo.' + tableKey); return out; }
    try {
        for (const row of GameInfo[tableKey]) {
            const type = row[colKey];
            if (!type) continue;
            if (category === 'Feature' && naturalWonderTypeSet().has(type)) continue;  // NWs live in the Wonder category
            let name = type;
            try { if (row.Name) name = Locale.compose(row.Name); } catch (_) { /* keep raw string */ }
            out.push({ type, name });
        }
        out.sort((a, b) => a.name.localeCompare(b.name));
        // Offer "clear resource" at the top of the Resource list (Item 3 — Resource DELETE).
        if (category === 'Resource') out.unshift({ type: CLEAR_RESOURCE, name: '(Clear / remove resource)' });
    } catch (e) { ERR('getMapPaintTypes failed for', category, e); }
    return out;
}

// Re-read the current *Type STRING at a plot for a paint category (write-confirmation). null = none.
// The DATA layer updates synchronously even though the terrain MESH redraw is deferred, so this is a
// reliable check that a paint actually stuck (the engine silently rejects illegal combos).
function readPaintType(category, loc) {
    try {
        const x = loc.x, y = loc.y;
        switch (category) {
            case 'Terrain':  return GameInfo?.Terrains?.lookup?.(GameplayMap.getTerrainType(x, y))?.TerrainType ?? null;
            case 'Feature':  return GameInfo?.Features?.lookup?.(GameplayMap.getFeatureType(x, y))?.FeatureType ?? null;
            case 'Resource': return GameInfo?.Resources?.lookup?.(GameplayMap.getResourceType(x, y))?.ResourceType ?? null;
            case 'Biome':    return GameInfo?.Biomes?.lookup?.(GameplayMap.getBiomeType(x, y))?.BiomeType ?? null;
        }
    } catch (_) {}
    return null;
}

// ── Terrain visual-refresh probe (2026-06-12) ─────────────────────────
// Painting terrain (e.g. mountain → flat) updates the gameplay DATA synchronously (read-back
// confirms, and the tile PLAYS like the new terrain) but the 3D terrain mesh never redraws — not
// even on camera-pan / end-turn (user-confirmed). Base-source + binary research found NO refresh
// call in any shipped JS (the tuner paints raw, same staleness), but the executable binds two
// UNSHIPPED members on the very WorldBuilder library we already use: startBlock() / endBlock(),
// paired engine-side with GameCoreEvent::WorldBuilderBlockBegin/End. Working hypothesis (PROBE —
// unverified): WB edits are meant to be batched in a block, and block end signals the visualizer
// to rebuild the terrain cache. So every paint is now wrapped in a block when the bindings exist.
// One-time diagnostics report (via console.error → reaches UI.log) whether the bindings exist and
// whether the engine's terrain-change events fire. If endBlock turns out inert, the remaining
// options are the native debug panel's "Rebuild Terrain Cache" (EnableDebugPanels) or save+reload
// (terrain visuals are rebuilt during load).
let _wbDiagDone = false;
function wbDiagnostics() {
    if (_wbDiagDone) return;
    _wbDiagDone = true;
    try {
        ERR('wb-probe: typeof WorldBuilder.startBlock =', typeof WorldBuilder?.startBlock,
            '| endBlock =', typeof WorldBuilder?.endBlock);
    } catch (e) { ERR('wb-probe: member check failed:', e); }
    try {
        let n = 0, m = 0;
        engine.on('TerrainTypeChanged', () => { if (n++ < 4) ERR('wb-probe: TerrainTypeChanged fired (#' + n + ')'); });
        engine.on('WorldBuilderBlockEnd', () => { if (m++ < 4) ERR('wb-probe: WorldBuilderBlockEnd fired (#' + m + ')'); });
    } catch (e) { ERR('wb-probe: event hookup failed:', e); }
}

// Run a WorldBuilder edit inside startBlock()/endBlock() when the bindings exist (no-op wrapper
// otherwise). endBlock always runs if startBlock succeeded, even when the edit throws.
function wbEdit(fn) {
    wbDiagnostics();
    let blocked = false;
    try { if (typeof WorldBuilder?.startBlock === 'function') { WorldBuilder.startBlock(); blocked = true; } }
    catch (e) { ERR('wbEdit: startBlock failed:', e); }
    try { return fn(); }
    finally {
        if (blocked) { try { WorldBuilder.endBlock(); } catch (e) { ERR('wbEdit: endBlock failed:', e); } }
    }
}

// Apply a single paint to one plot (or CLEAR a resource when typeString === CLEAR_RESOURCE). Dispatches
// to WorldBuilder.MapPlots.set* per category, then READS THE PLOT BACK and returns true only if the value
// actually stuck — so the caller can flash green on success / red on a silent engine rejection.
export function paintPlot(category, typeString, loc) {
    if (!guardSP()) return false;
    if (!loc || !Number.isInteger(loc.x) || !Number.isInteger(loc.y)) { ERR('paintPlot: bad loc', loc); return false; }
    if (!typeString) { ERR('paintPlot: no type string'); return false; }
    try {
        if (category === 'Wonder') return placeNaturalWonder(typeString, loc);
        const clearing = (category === 'Resource' && typeString === CLEAR_RESOURCE);
        if (!clearing && !['Terrain', 'Feature', 'Resource', 'Biome'].includes(category)) {
            ERR('paintPlot: unknown category', category);
            return false;
        }
        const biomeWas = readPaintType('Biome', loc);   // pre-write biome — proves/disproves engine coercion on a terrain paint
        wbEdit(() => {
            if (clearing) {
                WorldBuilder.MapPlots.setResource(ResourceTypes.NO_RESOURCE, loc, 0);
            } else {
                const hash = Database.makeHash(typeString);
                switch (category) {
                    case 'Terrain':  WorldBuilder.MapPlots.setTerrain(hash, loc); break;
                    case 'Feature':  WorldBuilder.MapPlots.setFeature(hash, loc); break;
                    case 'Resource': WorldBuilder.MapPlots.setResource(hash, loc, 1); break;
                    case 'Biome':    WorldBuilder.MapPlots.setBiome(hash, loc); break;
                }
            }
        });
        // Confirm the write stuck (engine silently drops illegal combos / out-of-domain features).
        const got = readPaintType(category, loc);
        const ok = clearing ? (got == null) : (got === typeString);
        LOG('paint', category, (clearing ? 'CLEAR' : typeString), 'at (' + loc.x + ',' + loc.y + ') ->', ok ? 'OK' : ('rejected; now ' + got));
        // Full plot read-back so the "navigable river → desert" report resolves in ONE line. The minimap
        // colours a land tile by BIOME (tab-map colorForPlot only paints NAV_RIVER blue when isWater), so
        // we also log isWater + riverType — the exact inputs it keys on — plus the biome BEFORE the write.
        // Interpretation: water=false & terr=NAV_RIVER ⇒ minimap mis-colour (fix colorForPlot); water=true
        // yet desert on-screen ⇒ colorForPlot bug; biomeWas≠biome ⇒ the engine coerced the biome.
        // isWater/getRiverType are wrapped so a throw here can't flip paintPlot's return value to false.
        diag('paint:' + category + '=' + (clearing ? 'CLEAR' : typeString) + ',@' + loc.x + '/' + loc.y
            + ',ok=' + ok + ',now=' + got
            + ',terr=' + readPaintType('Terrain', loc) + ',biomeWas=' + biomeWas + ',biome=' + readPaintType('Biome', loc)
            + ',feat=' + readPaintType('Feature', loc)
            + ',water=' + (() => { try { return GameplayMap.isWater(loc.x, loc.y); } catch (_) { return '?'; } })()
            + ',river=' + (() => { try { return GameplayMap.getRiverType(loc.x, loc.y); } catch (_) { return '?'; } })());
        return ok;
    } catch (e) { ERR('paintPlot failed:', e); return false; }
}

// Place a SINGLE-TILE natural wonder at `loc` (Item 3 milestone 2). NW placement is gated natively on the
// tile's terrain+biome (WorldBuilder.MapPlots.setFeature validates), so we PREP the tile to the wonder's
// valid terrain+biome first, then set the feature, then confirm via GameplayMap.isNaturalWonder. Multi-tile
// wonders can't be anchored from the UI isolate (only the map-gen-only TerrainBuilder does that), so they
// just fail the read-back (red). Returns true only when the wonder actually landed.
let _tbProbed = false;
export function placeNaturalWonder(featureType, loc) {
    if (!guardSP()) return false;
    if (!featureType || !loc || !Number.isInteger(loc.x) || !Number.isInteger(loc.y)) { ERR('placeNaturalWonder: bad args', featureType, loc); return false; }
    try {
        // One-time probe (console.error reaches UI.log from the interface-mode context): is the shape-aware
        // map-gen placer reachable here? Expected 'undefined' — confirms multi-tile is not feasible.
        if (!_tbProbed) {
            _tbProbed = true;
            try { ERR('placeNaturalWonder probe: typeof TerrainBuilder =', typeof TerrainBuilder,
                '; setFeatureType =', (typeof TerrainBuilder !== 'undefined' ? typeof TerrainBuilder.setFeatureType : 'n/a')); } catch (_) {}
        }
        // Look up this wonder's required terrain + biome + tile count.
        let terrain = null, biome = null, tiles = 1;
        try {
            for (const r of GameInfo.Feature_ValidTerrains) if (r.FeatureType === featureType) { terrain = r.TerrainType; break; }
            for (const r of GameInfo.Feature_ValidBiomes)   if (r.FeatureType === featureType) { biome = r.BiomeType; break; }
            for (const r of GameInfo.Feature_NaturalWonders) if (r.FeatureType === featureType) { tiles = r.Tiles ?? 1; break; }
        } catch (_) {}
        // Prep the tile so setFeature's terrain/biome validation passes, then place the wonder feature.
        // Batched in a WorldBuilder block (see wbEdit) so a working endBlock refreshes visuals once.
        wbEdit(() => {
            if (terrain) WorldBuilder.MapPlots.setTerrain(Database.makeHash(terrain), loc);
            if (biome)   WorldBuilder.MapPlots.setBiome(Database.makeHash(biome), loc);
            WorldBuilder.MapPlots.setFeature(Database.makeHash(featureType), loc);
        });
        // Confirm via the feature round-trip + the engine's own natural-wonder flag.
        const got = GameInfo?.Features?.lookup?.(GameplayMap.getFeatureType(loc.x, loc.y))?.FeatureType ?? null;
        let isNW = false;
        try { isNW = (typeof GameplayMap.isNaturalWonder === 'function') && GameplayMap.isNaturalWonder(loc.x, loc.y) === true; } catch (_) {}
        const ok = (got === featureType);
        LOG('placeNaturalWonder', featureType, '(' + tiles + '-tile) at (' + loc.x + ',' + loc.y + ') terrain', terrain, 'biome', biome,
            '| feature now', got, '| isNaturalWonder', isNW, '->', ok ? 'OK' : 'rejected');
        // Log the ACTUAL on-tile terrain/biome after prep (not just the requested need*), so a rejected
        // wonder is attributable: terrNow==needTerr && biomeNow==needBiome && !ok ⇒ setFeature is walled
        // even with correct prep; terrNow≠needTerr (or biomeNow≠needBiome) ⇒ the prep setter itself was
        // silently dropped. This nw: line is the ONLY breadcrumb for a wonder (paintPlot returns earlier).
        diag('nw:' + featureType + ',@' + loc.x + '/' + loc.y + ',tiles=' + tiles + ',needTerr=' + terrain + ',needBiome=' + biome
            + ',terrNow=' + readPaintType('Terrain', loc) + ',biomeNow=' + readPaintType('Biome', loc)
            + ',TB=' + (typeof TerrainBuilder) + ',featNow=' + got + ',isNW=' + isNW + ',ok=' + ok);
        return ok;
    } catch (e) { ERR('placeNaturalWonder failed:', e); return false; }
}

// Enter the custom paint map-click mode (INTERFACEMODE_LCP_PAINT_TILE, registered in paint-tile-mode.js).
// Mirrors enterClaimMode: the caller closes the panel first so the map is fully clickable.
export function enterPaintMode({ category, typeString }, opts = {}) {
    if (!guardSP()) return false;
    if (!category || !typeString) { ERR('enterPaintMode: missing category/type', category, typeString); return false; }
    try {
        opts.closePanel?.();
        // Re-entry guard (see enterClaimMode): F8 can reopen the panel while paint mode is active;
        // a same-mode switchTo() no-ops and keeps the OLD Category/TypeString. Exit first.
        try { if (InterfaceMode.getCurrent && InterfaceMode.getCurrent() === 'INTERFACEMODE_LCP_PAINT_TILE') InterfaceMode.switchToDefault(); } catch (_) {}
        const ok = InterfaceMode.switchTo('INTERFACEMODE_LCP_PAINT_TILE', { Category: category, TypeString: typeString });
        diag('enterPaint:' + category + '=' + typeString + ',switchTo=' + ok
            + ',cur=' + (() => { try { return InterfaceMode.getCurrent && InterfaceMode.getCurrent(); } catch (_) { return '?'; } })());
        if (ok === false) { ERR('enterPaintMode: switchTo refused INTERFACEMODE_LCP_PAINT_TILE'); return false; }
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
// Pan the in-game camera to a plot (used by the minimap click-to-pan). Read-only camera move; grants
// no vision and changes nothing. Mirrors lookAtUnit's Camera.lookAtPlot call.
export function lookAtPlot(loc, opts = {}) {
    try {
        if (loc && Number.isInteger(loc.x) && Number.isInteger(loc.y) && typeof Camera !== 'undefined') {
            Camera.lookAtPlot({ x: loc.x, y: loc.y }, { zoom: opts.zoom ?? 0.35 });
        }
    } catch (e) { ERR('lookAtPlot failed:', e); }
}

export function getMapDimensions() {
    try { return { width: GameplayMap.getGridWidth(), height: GameplayMap.getGridHeight() }; }
    catch (e) { ERR('getMapDimensions failed:', e); return { width: 0, height: 0 }; }
}

// Single-pass snapshot of the entire map. Returns:
//   {
//     width, height,
//     plots:     [{terr, biome, water, mountain, hills, river, nw, hasResource, feat, featName}] indexed by y*W+x
//                  feat = FeatureType string ('' if none); featName = localized feature name (on a NW
//                  plot this IS the wonder's name, since natural wonders are features).
//     cities:    [{x, y, name, color, isCapital, ownerID}]
//     resources: [{x, y, cls, type, name}] — cls=ResourceClassType, type=ResourceType, name=localized
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
    const terrainCache  = Object.create(null);
    const biomeCache    = Object.create(null);
    const featureCache  = Object.create(null);
    const resourceCache = Object.create(null);
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
    // Feature: returns { type, name } ('' when none). Natural wonders are features, so the NW's
    // display name is just this feature name on a plot where isNaturalWonder is true.
    const resolveFeature = (h) => {
        if (h in featureCache) return featureCache[h];
        let out = { type: '', name: '' };
        try { const row = GameInfo?.Features?.lookup?.(h); if (row?.FeatureType) out = { type: row.FeatureType, name: (() => { try { return Locale.compose(row.Name); } catch (_) { return row.FeatureType; } })() }; } catch (_) {}
        return (featureCache[h] = out);
    };
    // Resource: returns { type, name, cls }.
    const resolveResource = (h) => {
        if (h in resourceCache) return resourceCache[h];
        let out = { type: '', name: '', cls: '' };
        try { const row = GameInfo?.Resources?.lookup?.(h); if (row?.ResourceType) out = { type: row.ResourceType, cls: row.ResourceClassType || '', name: (() => { try { return Locale.compose(row.Name); } catch (_) { return row.ResourceType; } })() }; } catch (_) {}
        return (resourceCache[h] = out);
    };

    const noResource = (typeof ResourceTypes !== 'undefined' && ResourceTypes.NO_RESOURCE !== undefined) ? ResourceTypes.NO_RESOURCE : -1;

    const plots = new Array(W * H);
    const resources = [];

    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const i = y * W + x;
            let terr = '', biome = '', water = false, mountain = false, hills = false, river = 0, nw = false, hasResource = false;
            let feat = '', featName = '';
            try { terr     = resolveTerrain(GameplayMap.getTerrainType(x, y)) || ''; } catch (_) {}
            try { biome    = resolveBiome(GameplayMap.getBiomeType(x, y))     || ''; } catch (_) {}
            try { water    = !!GameplayMap.isWater(x, y); } catch (_) {}
            try { mountain = !!GameplayMap.isMountain(x, y); } catch (_) {}
            try { river    = GameplayMap.getRiverType(x, y) | 0; } catch (_) {}
            try { nw       = !!GameplayMap.isNaturalWonder(x, y); } catch (_) {}
            try { const fi = resolveFeature(GameplayMap.getFeatureType(x, y)); feat = fi.type; featName = fi.name; } catch (_) {}
            hills = (terr === 'TERRAIN_HILL'); // TERRAIN_HILL is land + elevated, see base data

            if (includeResources) {
                let r = -1;
                try { r = GameplayMap.getResourceType(x, y); } catch (_) {}
                if (r !== noResource && r !== -1 && r !== 0) {
                    hasResource = true;
                    const ri = resolveResource(r);
                    resources.push({ x, y, cls: ri.cls, type: ri.type, name: ri.name });
                }
            }
            plots[i] = { terr, biome, water, mountain, hills, river, nw, hasResource, feat, featName };
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
