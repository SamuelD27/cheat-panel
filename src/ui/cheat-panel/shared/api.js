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
// _diagElDoc = the document the sink element was created in. 2026-11-02: module-load breadcrumbs (paint-tile-mode.js
// logPaintApiOnce, the painted-river overlay init) can create the sink in the module-global `document` BEFORE the
// panel's onAttach passes Root.ownerDocument — the document every proven LCPD line came from. If a caller later passes
// a DIFFERENT document, the sink moves there (one 'diag.sink' line says so). Same document (the expected case) = no-op.
let _diagElDoc = null;
export function diagInit(doc) {
    try {
        if (doc) _diagDoc = doc;
        if (!_diagDoc && typeof document !== 'undefined') _diagDoc = document;
        let rehomed = false;
        if (_diagEl && doc && _diagElDoc && doc !== _diagElDoc) { _diagEl = null; rehomed = true; }
        if (!_diagEl && _diagDoc) {
            _diagEl = _diagDoc.createElement('div');
            _diagEl.style.display = 'none';
            (_diagDoc.body || _diagDoc.documentElement).appendChild(_diagEl);
            _diagElDoc = _diagDoc;
            if (rehomed) diag('diag.sink:rehomed=1,to=caller-doc,globalDoc=' + (typeof document !== 'undefined' && _diagDoc === document));
        }
    } catch (_) { /* diagnostics must never break the panel */ }
}
export function diag(str) {
    _diagN++;
    try { console.error('LCPD:' + _diagN + ':' + str); } catch (_) {}
    try {
        if (!_diagEl) diagInit();
        // 2026-10-21 review fix: the maxWidth sink never carries whitespace. Every LCPD maxWidth line seen in UI.log
        // so far had none, and whether Gameface logs an invalid value with spaces intact is unverified, so any run of
        // whitespace becomes '_' here (and a control character '?'). The console line above keeps the text as is.
        if (_diagEl) _diagEl.style.maxWidth = 'LCPD~' + _diagN + '~' + diagLineSafe(str);
    } catch (_) {}
}
function diagLineSafe(str) {
    try { return String(str).replace(/\s+/g, '_').replace(/[\x00-\x1f\x7f]/g, '?'); } catch (_) { return '?'; }
}

/**
 * Token-safe VALUE for an LCPD breadcrumb (2026-10-21 review fix). Breadcrumbs are 'stage:k=v,k=v', so a value must
 * hold no ',' (the field separator), no '=' and no whitespace. Objects are JSON-encoded first. Whitespace runs -> '_',
 * ',' -> ';', '=' -> ':', any other non-printable or non-ASCII character -> '?'; longer than `max` is cut and ends
 * in '~'. Never throws. Use it for every free-text value (error messages, reasons, JSON) in new breadcrumbs.
 */
export function diagTok(v, max = 160) {
    let s = '?';
    try {
        if (v === undefined) s = 'undefined';
        else if (v === null) s = 'null';
        else if (typeof v === 'object') { try { s = JSON.stringify(v); } catch (_) { s = String(v); } if (s === undefined) s = String(v); }
        else s = String(v);
        s = s.replace(/\s+/g, '_').replace(/,/g, ';').replace(/=/g, ':').replace(/[^\x21-\x7e]/g, '?');
        if (s.length > max) s = s.slice(0, max) + '~';
    } catch (_) { s = '?'; }
    return s;
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

    // STEP 0/4: wide-map edge guard (2026-10-21). On a map wider than 128 the bottom rows past column 127 crash
    // the terrain renderer once uncovered and on screen; a teleported unit uncovers its surroundings and the Map
    // tab moves the camera there. Refuse targets in that strip plus a sight radius (see checkWideMapEdge).
    const edge = checkWideMapEdge(loc, 'teleport');
    if (!edge.ok) {
        LOG('teleportUnitTo: destination (' + loc.x + ',' + loc.y + ') refused by the wide-map edge guard (' + edge.reason + ', ' + edge.W + 'x' + edge.H + ')');
        return { ok: false, reason: 'wide-map-edge', edge };
    }

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
    } catch (e) { diag('tp.dlcheck:THROW,' + diagTok((e && e.message) || e)); }

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
        + (mapUnitsErr ? ',MapUnitsErr=' + diagTok(mapUnitsErr) : '') + ',to=' + loc.x + '/' + loc.y + ',from=' + from.x + '/' + from.y);

    // STEP 3/4: create a same-type unit AT the destination (the proven M3 Duplicate path — Units.create
    // is inert from this isolate; CREATE_ELEMENT is the working one).
    let createSent = false;
    try {
        Game.PlayerOperations.sendRequest(owner, 'CREATE_ELEMENT',
            { Kind: 'UNIT', Type: utype, Location: { x: loc.x, y: loc.y }, Owner: owner, IndependentIndex: -1 });
        createSent = true;
        LOG('teleportUnitTo: CREATE_ELEMENT ' + def.UnitType + ' at (' + loc.x + ',' + loc.y + ') [from (' + from.x + ',' + from.y + ')]');
        diag('tp.create:sent,' + def.UnitType + ',@' + loc.x + '/' + loc.y);
    } catch (e) { ERR('teleportUnitTo: CREATE_ELEMENT failed:', e); diag('tp.create:THROW,' + diagTok((e && e.message) || e)); return { ok: false, reason: 'send-failed' }; }

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

// ─── Map-size guard for every reveal (2026-10-20) ──────────────────────────────────────────────────
// On 2026-10-20 Civ VII 1.5.0 (Mac, build 1311346) quit with SIGBUS about 5 s after the old Reveal Map on
// a 180×94 map. The fault is in the game's own terrain renderer (AppViewGame::TerrainJob on the worker
// thread MainWorker7, CivilizationVII+0x168d6dc): it keeps each terrain cell's x and y in ONE SIGNED BYTE,
// so column 128 reads back as -128, the bottom-row (y = 0) cell index W*y + x turns negative, and the read
// lands far outside the cell array. Fully fogged cells are skipped, so the crash needs that bottom edge
// east of column 127 uncovered AND on screen. A whole-map reveal uncovers it, and the game's own camera
// can then reach it without any click (INFERRED: a natural-wonder cinematic jumps to the wonder).
// Coordinates 0..127 fit in a signed byte, so on maps up to 128 wide and 128 tall no coordinate wraps
// (VERIFIED by the disassembly; that terrain cells map 1:1 to plots is INFERRED). A height over 128 wraps y the
// same way (INFERRED, untested).
// Evidence: _staging/2026-10-18/reveal-crash/ (triage + three verifier lenses). Until a test window proves
// a narrower safe area, every panel reveal refuses on such maps. Restore fog stays allowed: it only covers
// tiles again, so it can only shrink what the renderer draws.
export const REVEAL_SAFE_MAX_DIM = 128;     // largest width / height whose 0-based coordinates fit in a signed byte
let _revealSizeLastSig = '';                // last logged verdict of a 'status' caller (logged only on change)

function revealErrText(e) { try { return String((e && e.message) || e).slice(0, 160); } catch (_) { return '?'; } }

/**
 * Pure verdict for a W×H map: {ok, reason, W, H, limit, axis}. reason = 'size-ok' | 'map-too-large' |
 * 'map-size-unknown'; axis = '' | 'width' | 'height' | 'both'. A size that is not a positive number fails
 * closed (no size, no reveal).
 */
export function revealSizeVerdict(W, H) {
    const v = { ok: false, reason: '', W, H, limit: REVEAL_SAFE_MAX_DIM, axis: '' };
    const okNum = (n) => typeof n === 'number' && isFinite(n) && n > 0;
    if (!okNum(W) || !okNum(H)) { v.reason = 'map-size-unknown'; return v; }
    const wide = W > REVEAL_SAFE_MAX_DIM, tall = H > REVEAL_SAFE_MAX_DIM;
    v.axis = (wide && tall) ? 'both' : wide ? 'width' : tall ? 'height' : '';
    v.ok = !wide && !tall;
    v.reason = v.ok ? 'size-ok' : 'map-too-large';
    return v;
}

/**
 * Read the map size and decide whether a reveal is allowed. caller = who asks (logged). Never throws.
 * The decision goes to UI.log through diag() (LOG/ERR from this isolate never reach UI.log); a 'status'
 * caller is logged only when the verdict changes, every other caller (a reveal attempt) every time.
 */
export function checkRevealMapSize(caller) {
    const t0 = Date.now();
    LOG('checkRevealMapSize: enter caller=' + caller);
    let W = 0, H = 0, err = '';
    try { W = GameplayMap.getGridWidth(); H = GameplayMap.getGridHeight(); }
    catch (e) {
        err = revealErrText(e);
        ERR('checkRevealMapSize: reading the map size failed (caller=' + caller + '):', e);
    }
    const v = revealSizeVerdict(W, H);
    if (err) v.error = err;
    // why= is one token (2026-10-21 review fix: it used to carry spaces, commas and brackets); the error text, if
    // any, goes in its own token-safe err= field at the end.
    const why = v.ok ? 'xy-fit-int8-le' + v.limit
        : (v.reason === 'map-too-large') ? v.axis + '-over-' + v.limit + '-renderer-int8-wrap-sigbus-2026-10-20'
        : 'size-unreadable-fail-closed';
    const sig = v.reason + ':' + W + 'x' + H;
    if (caller !== 'status' || sig !== _revealSizeLastSig) {
        _revealSizeLastSig = sig;
        diag('reveal.size:caller=' + diagTok(caller) + ',W=' + diagTok(W) + ',H=' + diagTok(H) + ',limit=' + v.limit + ',decision=' + (v.ok ? 'allow' : 'refuse')
            + ',reason=' + v.reason + ',axis=' + v.axis + ',why=' + why + ',ms=' + (Date.now() - t0) + (err ? ',err=' + diagTok(err) : ''));
    }
    LOG('checkRevealMapSize: exit caller=' + caller + ' ' + W + 'x' + H + ' -> ' + (v.ok ? 'allow' : 'refuse (' + v.reason + ')'));
    return v;
}

/** Plain-language panel text for a refused verdict (empty string when the reveal is allowed). */
export function revealSizeMessage(v) {
    if (!v || v.ok) return '';
    const dims = (v.W > 0 && v.H > 0) ? ' ' + v.W + '×' + v.H : '';
    if (v.reason === 'map-too-large') {
        return 'Reveal map is turned off on this' + dims + ' map. ' + ((v.axis === 'height')
            ? 'Civ VII cannot draw terrain rows past 127, and uncovering them is expected to make the game quit. '
            : 'Once the bottom edge past column 127 is uncovered, the game quits (crashes) as soon as that edge is on screen, as it did on 2026-10-20. ')
            // 2026-10-21 review fix: no longer stated as fact. Every tile position of a map up to 128×128 fits the
            // renderer's signed bytes (VERIFIED arithmetic), and a 128×80 reveal ran on build 1311346 without this
            // crash; a 128×128 reveal was last checked on the older build 25245002.
            + 'On maps up to 128×128 every tile fits the range the game can draw, so this bug should not occur there.';
    }
    return 'Reveal map is turned off: the panel could not read the map size, and on maps wider or taller than 128 tiles a reveal can make the game quit.';
}

// ─── Wide-map edge guard for Teleport and Claim tile (2026-10-21) ─────────────────────────────────────
// The same renderer bug (see the reveal guard above) is reached without any reveal when a unit or an owned tile
// uncovers the bottom rows past column 127 of a map wider than 128: a teleported unit sees its surroundings and
// the Map tab moves the camera to it; a claimed tile becomes yours and is seen by you (INFERRED). The crash cells
// are row 0 (and probably row 1) at x >= 128 (VERIFIED: x20 = 0xffffff80 = column 128, row 0). The panel refuses
// a teleport destination or a claim target within a sight radius of 4 of them: x >= 124 and y <= 5. Civ VII maps
// wrap east-west (VERIFIED: the map scripts log wrapX=true for the 180x94 and 128x80 games in Scripting.log), so
// the strip's east end also reaches columns 0-3 through the seam: those are refused too (x <= 3, y <= 5).
// Maps up to 128 wide are not touched by this guard (the check returns allow, reason not-wide).
export const EDGE_GUARD_X_MIN = 124;       // first refused column: 128 (the first wrapping column) minus a sight radius of 4
export const EDGE_GUARD_SEAM_X_MAX = 3;    // last refused column across the east-west seam (W-1 + 4 wraps to 3)
export const EDGE_GUARD_Y_MAX = 5;         // last refused row: rows 0-1 (the crash rows) plus a sight radius of 4

/**
 * Pure verdict for putting a unit on, or claiming, plot (x, y) of a W×H map. Returns
 * {ok, reason, x, y, W, H, limit, zone}: reason = 'not-wide' (map up to 128 wide: always allowed) | 'outside-strip' |
 * 'wide-map-edge' (refused) | 'map-size-unknown' (refused only inside the strip, because a map of unknown width
 * could be wide) | 'bad-loc'; zone = '' | 'east' | 'seam'.
 */
export function wideMapEdgeVerdict(x, y, W, H) {
    const v = { ok: true, reason: '', x, y, W, H, limit: REVEAL_SAFE_MAX_DIM, zone: '' };
    if (!Number.isInteger(x) || !Number.isInteger(y)) { v.ok = false; v.reason = 'bad-loc'; return v; }
    const inRows = y >= 0 && y <= EDGE_GUARD_Y_MAX;
    v.zone = !inRows ? '' : (x >= EDGE_GUARD_X_MIN) ? 'east' : (x >= 0 && x <= EDGE_GUARD_SEAM_X_MAX) ? 'seam' : '';
    const sizeKnown = typeof W === 'number' && isFinite(W) && W > 0 && typeof H === 'number' && isFinite(H) && H > 0;
    if (!sizeKnown) { v.reason = 'map-size-unknown'; v.ok = !v.zone; return v; }
    if (W <= REVEAL_SAFE_MAX_DIM) { v.reason = 'not-wide'; v.zone = ''; return v; }
    v.ok = !v.zone;
    v.reason = v.ok ? 'outside-strip' : 'wide-map-edge';
    return v;
}

/**
 * Read the map size and decide whether a teleport destination / claim target is allowed. caller = who asks
 * ('teleport', 'claim', 'claim-mode'). Never throws. Every check writes one LCPD 'edge.guard' breadcrumb to UI.log.
 */
export function checkWideMapEdge(loc, caller) {
    const t0 = Date.now();
    const x = loc && loc.x, y = loc && loc.y;
    LOG('checkWideMapEdge: enter caller=' + caller + ' at (' + x + ',' + y + ')');
    let W = 0, H = 0, err = '';
    try { W = GameplayMap.getGridWidth(); H = GameplayMap.getGridHeight(); }
    catch (e) { err = revealErrText(e); ERR('checkWideMapEdge: reading the map size failed (caller=' + caller + '):', e); }
    const v = wideMapEdgeVerdict(x, y, W, H);
    if (err) v.error = err;
    diag('edge.guard:caller=' + diagTok(caller) + ',x=' + diagTok(x) + ',y=' + diagTok(y) + ',W=' + diagTok(W) + ',H=' + diagTok(H)
        + ',limit=' + v.limit + ',decision=' + (v.ok ? 'allow' : 'refuse') + ',reason=' + v.reason + ',zone=' + (v.zone || 'none')
        + ',strip=x' + EDGE_GUARD_X_MIN + 'up/x0-' + EDGE_GUARD_SEAM_X_MAX + '/y0-' + EDGE_GUARD_Y_MAX + ',ms=' + (Date.now() - t0)
        + (err ? ',err=' + diagTok(err) : ''));
    LOG('checkWideMapEdge: exit caller=' + caller + ' ' + W + 'x' + H + ' -> ' + (v.ok ? 'allow' : 'refuse') + ' (' + v.reason + ')');
    return v;
}

/** Plain-language panel text for a refused edge verdict; action = 'teleport' | 'claim'. Empty when allowed. */
export function wideMapEdgeMessage(v, action) {
    if (!v || v.ok) return '';
    const what = (action === 'claim') ? 'Claim refused' : 'Teleport refused';
    const at = (Number.isInteger(v.x) && Number.isInteger(v.y)) ? ' (' + v.x + ',' + v.y + ')' : '';
    if (v.reason === 'bad-loc') return what + ': invalid tile.';
    const dims = (v.W > 0 && v.H > 0) ? 'this ' + v.W + '×' + v.H + ' map' : 'this map (its size could not be read)';
    return what + ':' + at + ' is too close to the bottom edge of ' + dims + '. On maps wider than 128, once that edge past column 127 '
        + 'is uncovered and on screen the game quits (a Civ VII bug). Pick a tile with y 6 or more, or x from 4 to 123.';
}

/**
 * Reveal the ENTIRE map for the local player (fog-of-war cheat). Uses Visibility.revealAllPlots —
 * confirmed live 2026-07-13 (reveals all 128×N plots; getRevealedState reflects it on the next frame).
 * One-way: there is no un-reveal (reload a save to restore fog). NOTE this does NOT enable teleport to
 * the far hemisphere — unit placement on Distant Lands is a separate engine age-rule (see teleportUnitTo).
 * Returns true if the reveal call was made.
 * Why one-way (2026-10-18, binary of build 25516395): revealAllPlots adds an UNTRACKED +1 vision count
 * to every plot, i.e. permanent vision of the whole map, and no JS call can take it back. Since
 * 2026-10-18 the Map tab uses the reversible revealMap()/restoreFog() below and only falls back to this
 * function (after a confirm click) when the reversible APIs are missing.
 * Since 2026-10-20 it refuses on maps wider or taller than 128 (checkRevealMapSize above): that reveal
 * made the game quit on a 180×94 map.
 */
export function revealEntireMap() {
    LOG('revealEntireMap: enter');
    if (!guardSP()) { diag('reveal.old:exit,ok=false,reason=multiplayer'); return false; }
    // STEP 1/2: map-size guard (2026-10-20). Never on maps wider or taller than REVEAL_SAFE_MAX_DIM.
    const size = checkRevealMapSize('revealEntireMap');
    if (!size.ok) {
        ERR('revealEntireMap: REFUSED on a ' + size.W + 'x' + size.H + ' map (' + size.reason + '); Visibility.revealAllPlots NOT called');
        diag('reveal.old:exit,ok=false,reason=' + size.reason + ',W=' + size.W + ',H=' + size.H + ',limit=' + size.limit);
        return false;
    }
    // STEP 2/2: the one-way engine call.
    try {
        const p = GameContext.localPlayerID;
        if (typeof Visibility === 'undefined' || !Visibility.revealAllPlots) {
            ERR('revealEntireMap: Visibility.revealAllPlots unavailable');
            diag('reveal.old:exit,ok=false,reason=no-api');
            return false;
        }
        diag('reveal.old:call=Visibility.revealAllPlots,player=' + p + ',W=' + size.W + ',H=' + size.H);
        Visibility.revealAllPlots(p);
        LOG('revealEntireMap: revealAllPlots(' + p + ') sent — whole map revealed (reload to restore fog)');
        diag('reveal.old:exit,ok=true');
        return true;
    } catch (e) {
        ERR('revealEntireMap failed:', e);
        diag('reveal.old:error,stage=engine-call,W=' + size.W + ',H=' + size.H + ',err=' + diagTok(revealErrText(e)));
        return false;
    }
}

// ─── FOG OF WAR: reversible "Reveal map" / "Restore fog" (2026-10-18) ──────────────────────────────
// Static analysis of the game binary (build 25516395 = 1.5.0.43; lcp-reveal investigation, 2026-10-18)
// explains why revealEntireMap() above cannot be undone and how this pair can:
//  • Visibility.revealAllPlots(p) adds an UNTRACKED +1 vision count to every plot (the binding hard-codes
//    the +1; changeVisibilityCount / changeVisibilityCountForPlots ignore their "delta" argument and add
//    +1 too). Nothing in JS takes those counts back, so revealAllPlots = permanent vision of the map.
//  • Visibility.setTrackedVisibilityGrant(p, turns, plotIndices[]) adds the same vision as a TRACKED
//    grant and returns its id; removeTrackedVisibilityGrant(p, id) takes it back (-1). The engine's
//    expiry pass skips grants whose duration is < 1, so turns = 0 never expires by itself.
//    CAVEAT (Phase-2 review): the id is NOT unique. Every grant of a player gets the same id (a per-player
//    field set to 1 at map init and never advanced), the +1 vision is applied BEFORE the grant is recorded,
//    and the record is a unique-key insert. So while another tracked grant of the player exists (the engine
//    adds a 1-plot, 2-turn grant on each first contact made through a unit), a new grant's vision is applied
//    but never recorded: permanent. revealMap() therefore frees that slot first (fogGrantPreclear).
//  • WorldBuilder.MapPlots.setRevealed(p, {x,y}, bool) writes one plot's "explored" flag and emits the
//    engine's plot-visibility event for the local observer. It returns false (no change) when the plot
//    is currently visible or already in the requested state; there is no WorldBuilder.isActive gate
//    (only the editor's undo history needs it). setAllRevealed(p, bool) does the same for every plot
//    that is not currently visible.
//  • These calls write the authoritative game state, but the UI's GameplayMap reads trail behind by a
//    frame or more (revealAllPlots read 0 right after the call and 2 later, verified live on 1.5.0). So
//    outcomes are judged by the engine's return values plus a DEFERRED read-back, never a sync re-read.
// Reveal  = snapshot the still-unexplored tiles, then setAllRevealed(p, true) (Units OFF, the Map tab's
//           default: terrain only, no vision, no first contacts), or one tracked vision grant on every plot
//           (Units ON) after freeing the grant slot.
// Restore = remove the grant, then setRevealed(p, loc, false) on the snapshot's unexplored tiles. Tiles
//           your units or cities can see right now stay visible (the engine refuses those).
// The record (snapshot + grant id + age) is kept in memory and in the local player's Tutorial property bag
// (base core/ui/utilities/utility-serialize.js keeps its catalogs there); that the bag is saved with the game
// is INFERRED until probe P7. A record from an earlier age is never used to cover tiles again.
// Every step leaves an LCPD "fog.*" breadcrumb in UI.log (panel console.log never reaches UI.log).
// Map size (2026-10-20): Reveal refuses on maps wider or taller than 128 (REVEAL_SAFE_MAX_DIM, see the guard
// above revealEntireMap); Restore stays allowed there because it only covers tiles again.
const FOG_RECORD_KEY = 'LCP_FOG_RECORD_V1';
const FOG_GRANT_TURNS = 0;          // tracked-grant duration in turns; < 1 = never expires
const FOG_GRANT_SLOT = 1;           // the id every tracked grant gets on this build; used only if the empty probe grant fails
const FOG_CHUNK = 1500;             // setRevealed calls per tick while restoring (keeps frames short)
const FOG_POLL_MS = 250;            // deferred read-back interval ...
const FOG_POLL_MAX = 16;            // ... for up to ~4 s
const FOG_PERMANENT_SHARE = 0.98;   // >= 98% of plots VISIBLE before a reveal => untracked permanent vision
const FOG_MAX_PERSIST_CHARS = 60000;

let _fogMem = null;                 // in-memory record ({cleared:true} = deliberately cleared this session)
let _fogBusy = false;               // a reveal/restore (incl. its deferred read-back) is in flight
let _fogLastCap = '';               // last logged capability signature (log only on change)
let _fogLastStatus = '';            // last logged status signature (log only on change)

// Breadcrumb as key=value pairs: diag('fog.<stage>:k=v,k=v'), capped so one line never floods UI.log.
function fogDiag(stage, kv) {
    let s = '';
    try {
        const parts = [];
        if (kv) {
            for (const k of Object.keys(kv)) {
                // 2026-10-21 review fix: every value token-safe (objects JSON-encoded, then no space, ',' or '=')
                parts.push(k + '=' + diagTok(kv[k], 200));
            }
        }
        s = parts.join(',');
        if (s.length > 400) s = s.slice(0, 400) + '...';
    } catch (_) { /* logging must never throw */ }
    diag('fog.' + stage + (s ? ':' + s : ''));
}
function fogErr(e) { try { return String((e && e.message) || e).slice(0, 160); } catch (_) { return '?'; } }

// A usable tracked-grant id: a positive integer (Number or BigInt). 0 is the binding's failure value (no
// visibility manager or no such player: nothing was granted); undefined = cohtml rejected the arguments.
function fogGrantId(raw) {
    const n = (typeof raw === 'bigint') ? Number(raw) : raw;
    return (typeof n === 'number' && isFinite(n) && n > 0 && Math.floor(n) === n) ? n : null;
}

// The current age as text (null when unknown). A reveal record remembers it, because after an age change its
// snapshot must not be used to cover tiles again (that would also hide what was explored since).
function fogAgeNow() {
    try { const a = Game.age; return (a === undefined || a === null) ? null : String(a); } catch (_) { return null; }
}

/**
 * Which fog APIs exist in THIS context (panel isolate). Pure feature detection — never calls them.
 * Logged once per change as fog.cap so the test window can read the answer straight out of UI.log.
 */
export function getFogCapabilities() {
    const cap = { sp: true, read: false, grant: false, terrain: false, reHide: false, permanent: false, persist: false };
    try { cap.sp = !isMultiplayer(); } catch (_) {}
    try {
        cap.read = (typeof GameplayMap !== 'undefined') && !!GameplayMap
            && (typeof GameplayMap.getRevealedStates === 'function' || typeof GameplayMap.getRevealedState === 'function');
    } catch (_) {}
    try {
        const V = (typeof Visibility !== 'undefined') ? Visibility : null;
        cap.grant = !!V && typeof V.setTrackedVisibilityGrant === 'function' && typeof V.removeTrackedVisibilityGrant === 'function';
        cap.permanent = !!V && typeof V.revealAllPlots === 'function';
    } catch (_) {}
    try {
        const M = (typeof WorldBuilder !== 'undefined' && WorldBuilder) ? WorldBuilder.MapPlots : null;
        cap.reHide = !!M && typeof M.setRevealed === 'function';
        cap.terrain = !!M && typeof M.setAllRevealed === 'function';
    } catch (_) {}
    try { cap.persist = !!fogStore(); } catch (_) {}
    const sig = JSON.stringify(cap);
    if (sig !== _fogLastCap) { _fogLastCap = sig; fogDiag('cap', cap); }
    return cap;
}

/**
 * Read the fog of war as the UI sees it: one state per plot (index = y*W + x; 0 = unexplored,
 * 1 = explored but out of sight, 2 = in sight), via the bulk GameplayMap.getRevealedStates (base
 * yields-layer.js uses it the same way) with a per-plot fallback. Read-only; never throws.
 * NB: right after a reveal/restore this view lags the engine by a frame or more.
 */
export function readRevealedStates(playerId) {
    const out = { ok: false, states: null, W: 0, H: 0, total: 0, hidden: 0, revealed: 0, visible: 0, source: 'none', error: '' };
    try {
        const p = (playerId != null) ? playerId : GameContext.localPlayerID;
        const W = GameplayMap.getGridWidth(), H = GameplayMap.getGridHeight();
        out.W = W; out.H = H; out.total = W * H;
        if (!W || !H) { out.error = 'no-map'; return out; }
        const states = new Uint8Array(out.total);
        let raw = null;
        if (typeof GameplayMap.getRevealedStates === 'function') raw = GameplayMap.getRevealedStates(p);
        if (raw && typeof raw.length === 'number' && raw.length >= out.total) {
            for (let i = 0; i < out.total; i++) states[i] = raw[i] | 0;
            out.source = 'bulk';
        } else if (typeof GameplayMap.getRevealedState === 'function') {
            for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) states[y * W + x] = GameplayMap.getRevealedState(p, x, y) | 0;
            out.source = 'per-plot';
        } else { out.error = 'no-getter'; return out; }
        for (let i = 0; i < out.total; i++) {
            const s = states[i];
            if (s === 0) out.hidden++; else if (s === 2) out.visible++; else out.revealed++;
        }
        out.states = states;
        out.ok = true;
    } catch (e) { out.error = fogErr(e); }
    return out;
}

// Snapshot <-> string: run lengths of "unexplored" (state 0) vs not, alternating and starting with a
// NOT-unexplored run (possibly 0), base-36, '.'-separated. Early-game maps compress to a few hundred chars.
function fogMaskToRle(states, total) {
    const runs = [];
    let cur = false, n = 0;
    for (let i = 0; i < total; i++) {
        const h = (states[i] === 0);
        if (h === cur) n++; else { runs.push(n); cur = h; n = 1; }
    }
    runs.push(n);
    return runs.map(r => r.toString(36)).join('.');
}
function fogRleToMask(rle, total) {
    if (typeof rle !== 'string' || !rle.length) return null;
    const mask = new Uint8Array(total);
    let i = 0, cur = 0;
    for (const tok of rle.split('.')) {
        const n = parseInt(tok, 36);
        if (!(n >= 0) || i + n > total) return null;
        if (cur) mask.fill(1, i, i + n);
        i += n;
        cur ^= 1;
    }
    return (i === total) ? mask : null;
}

// Identity of the running game, so a record from another game/map is never applied here. (The age is
// checked separately: a record from an earlier age of THIS game is reported as stale, not ignored.)
function fogGameKey(W, H) {
    let gs = '?', ms = '?';
    try { gs = String(Configuration.getGame().gameSeed); } catch (_) {}
    try { ms = String(Configuration.getMap().mapSeed); } catch (_) {}
    return gs + ':' + ms + ':' + W + 'x' + H;
}

// Save-backed storage: the local player's Tutorial property bag (base core/ui/utilities/utility-serialize.js
// keeps its catalogs there, e.g. for the quest tracker; that it is written into the save is INFERRED until
// probe P7). null when unavailable.
function fogStore() {
    const pl = getLocalPlayer();
    const t = pl ? pl.Tutorial : null;
    if (!t || typeof t.getProperty !== 'function' || typeof t.setProperty !== 'function') return null;
    if (typeof Database === 'undefined' || typeof Database.makeHash !== 'function') return null;
    const h = Database.makeHash(FOG_RECORD_KEY);
    return { read: () => t.getProperty(h), write: (v) => t.setProperty(h, v) };
}

function loadFogRecord(W, H) {
    const key = fogGameKey(W, H);
    let p = -1;
    try { p = GameContext.localPlayerID; } catch (_) {}
    const check = (r) => (!r || r.v !== 1) ? 'version' : (r.player !== p) ? 'player'
        : (r.W !== W || r.H !== H) ? 'size' : (r.key !== key) ? 'game' : '';
    // Same game, other age: keep the record (its vision grant may still need taking back) but mark it stale,
    // so its snapshot is never used to cover tiles again.
    const markAge = (r) => {
        const now = fogAgeNow();
        const then = (r.age === undefined || r.age === null) ? null : String(r.age);
        const stale = (now !== null && then !== null && now !== then) ? 'age' : '';
        if (stale && r._stale !== stale) fogDiag('record.stale', { why: 'age', ageThen: then, ageNow: now, method: r.method, turn: r.turn });
        r._stale = stale;
        return r;
    };
    if (_fogMem) {
        if (_fogMem.cleared) {
            if (_fogMem.key === key) return null;   // cleared this session for THIS game (the save copy may lag)
        } else {
            const badMem = check(_fogMem);
            if (!badMem) { _fogMem._src = 'memory'; return markAge(_fogMem); }
            fogDiag('record.mismatch', { why: badMem, src: 'memory' });
        }
        _fogMem = null;                             // belongs to another game: fall back to the save
    }
    let rec = null;
    try {
        const st = fogStore();
        const raw = st ? st.read() : null;
        if (typeof raw === 'string' && raw.length > 2) rec = JSON.parse(raw);
    } catch (e) { fogDiag('record.read-error', { err: fogErr(e) }); rec = null; }
    if (!rec) return null;
    const bad = check(rec);
    if (bad) { fogDiag('record.mismatch', { why: bad, src: 'save' }); return null; }
    _fogMem = rec;                                  // cache: later reads come from memory
    rec._src = 'save';
    return markAge(rec);
}

function saveFogRecord(rec) {
    _fogMem = rec;
    let persisted = false, why = '';
    try {
        const st = fogStore();
        if (!st) why = 'no-store';
        else {
            const copy = Object.assign({}, rec);
            delete copy._src;
            delete copy._stale;
            const json = JSON.stringify(copy);
            if (json.length > FOG_MAX_PERSIST_CHARS) why = 'too-big:' + json.length;
            else { st.write(json); persisted = true; }
        }
    } catch (e) { why = 'threw:' + fogErr(e); }
    fogDiag('record.save', { method: rec.method, persisted, why, grantId: rec.grantId, grantRemoved: !!rec.grantRemoved, grantMissing: !!rec.grantMissing, idModel: rec.idModel || '', rleChars: (rec.rle || '').length });
    return persisted;
}

function clearFogRecord(reason) {
    let key = '';
    try { key = fogGameKey(GameplayMap.getGridWidth(), GameplayMap.getGridHeight()); } catch (_) {}
    _fogMem = { cleared: true, key, at: Date.now() };
    let ok = false, why = '';
    try { const st = fogStore(); if (st) { st.write(''); ok = true; } else why = 'no-store'; } catch (e) { why = 'threw:' + fogErr(e); }
    fogDiag('record.clear', { reason, ok, why });
}

// Deferred read-back: poll the UI's fog view until isDone(view, polls) or ~4 s, then finish(view|null, polls, ms, matched).
function fogPoll(p, isDone, finish) {
    const t0 = Date.now();
    let polls = 0;
    const tick = () => {
        polls++;
        let s = null;
        try { s = readRevealedStates(p); } catch (_) { s = null; }
        let done = false;
        try { done = !!(s && s.ok && isDone(s, polls)); } catch (_) { done = false; }
        if (done || polls >= FOG_POLL_MAX) {
            try { finish((s && s.ok) ? s : null, polls, Date.now() - t0, done); } catch (e) { fogDiag('poll.finish-error', { err: fogErr(e) }); }
            return;
        }
        setTimeout(tick, FOG_POLL_MS);
    };
    setTimeout(tick, FOG_POLL_MS);
}

// Free the player's tracked-grant slot right before the reveal's own grant (see the CAVEAT above).
// An EMPTY grant tells us which id the next grant will get; removing that id frees the slot: it removes our
// own empty record, or the record already holding the slot (typically the engine's 1-plot, 2-turn
// first-contact grant, whose vision then ends early). If the empty grant is refused, the binary's shared
// id (FOG_GRANT_SLOT) is removed instead. ok=false = the slot state is unknown: the caller must NOT grant.
function fogGrantPreclear(p) {
    const t0 = Date.now();
    const out = { ok: false, how: '', probeId: null, probeRet: '', target: null, removeRet: '', ms: 0 };
    let raw;
    try { raw = Visibility.setTrackedVisibilityGrant(p, FOG_GRANT_TURNS, []); out.probeRet = String(raw); }
    catch (e) { out.probeRet = 'threw:' + fogErr(e); }
    out.probeId = fogGrantId(raw);
    out.how = (out.probeId != null) ? 'probe' : 'blind';
    out.target = (out.probeId != null) ? out.probeId : FOG_GRANT_SLOT;
    let rr;
    try { rr = Visibility.removeTrackedVisibilityGrant(p, out.target); out.removeRet = String(rr); }
    catch (e) { out.removeRet = 'threw:' + fogErr(e); }
    // true = a record held the slot and is gone; false = nothing held it. Either way the next grant gets recorded.
    out.ok = (rr === true || rr === false);
    out.ms = Date.now() - t0;
    fogDiag('reveal.preclear', out);
    return out;
}

// Take a reveal's vision grant back. Three outcomes on purpose: 'removed' (true); 'missing' (false: the engine
// has no grant with that id any more; never retried, because on this build the id is shared and a retry
// could remove a newer grant); 'rejected' / 'threw' (the call itself failed: the record stays for a retry).
function fogRemoveGrant(p, rec) {
    let ret, err = '';
    try { ret = Visibility.removeTrackedVisibilityGrant(p, rec.grantId); } catch (e) { err = fogErr(e); }
    const state = err ? 'threw' : (ret === true) ? 'removed' : (ret === false) ? 'missing' : 'rejected';
    if (state === 'removed' || state === 'missing') rec.grantRemoved = true;
    if (state === 'missing') rec.grantMissing = true;
    fogDiag('restore.step3', { api: 'Visibility.removeTrackedVisibilityGrant', grantId: rec.grantId, idModel: rec.idModel || '',
                               ret: String(ret), type: typeof ret, state, err });
    return { state, ret, err };
}

/**
 * What the Map tab may offer right now. Pure reads (feature detection + the stored record); never
 * touches the map. revealMethodUnits / revealMethodTerrain = the method a Reveal click would use with
 * the Units toggle ON / OFF ('grant' | 'terrain' | 'permanent' | null). size = the map-size verdict
 * (checkRevealMapSize): a map wider or taller than 128 gives canReveal false, revealWhy 'map-too-large'.
 */
export function getFogStatus() {
    const st = {
        cap: getFogCapabilities(), busy: _fogBusy, record: null,
        canReveal: false, canRestore: false, revealWhy: '', restoreWhy: '',
        revealMethodUnits: null, revealMethodTerrain: null, size: null,
    };
    st.size = checkRevealMapSize('status');         // never throws; logged only when the verdict changes
    try {
        const W = GameplayMap.getGridWidth(), H = GameplayMap.getGridHeight();
        const rec = (W && H) ? loadFogRecord(W, H) : null;
        if (rec) {
            st.record = { method: rec.method, turn: rec.turn, hiddenBefore: rec.hiddenBefore, total: rec.total,
                          grantId: rec.grantId, grantRemoved: !!rec.grantRemoved, src: rec._src, stale: rec._stale || '', idModel: rec.idModel || '' };
        }
    } catch (e) { fogDiag('status.error', { err: fogErr(e) }); }
    const c = st.cap;
    st.revealMethodUnits   = (c.grant && c.reHide) ? 'grant' : (c.terrain && c.reHide) ? 'terrain' : c.permanent ? 'permanent' : null;
    st.revealMethodTerrain = (c.terrain && c.reHide) ? 'terrain' : null;   // never falls back to vision
    if (!c.sp)        { st.revealWhy = st.restoreWhy = 'multiplayer'; }
    else if (_fogBusy){ st.revealWhy = st.restoreWhy = 'busy'; }
    else {
        const r = st.record;
        if (!st.size.ok) st.revealWhy = st.size.reason;            // 'map-too-large' | 'map-size-unknown' (2026-10-20 crash guard)
        else if (r && r.method === 'permanent') st.revealWhy = 'permanent-done';
        else if (r && r.stale)    st.revealWhy = 'age-changed';
        else if (r)               st.revealWhy = 'already-revealed';
        else if (!c.read)         st.revealWhy = 'no-read';
        else if (!st.revealMethodUnits && !st.revealMethodTerrain) st.revealWhy = 'no-api';
        else st.canReveal = true;
        if (!r)                                st.restoreWhy = 'no-record';
        else if (r.method === 'permanent')     st.restoreWhy = 'permanent';
        else if (r.stale) {
            // earlier age: Restore may only take the reveal's vision back (it never covers tiles again)
            if (r.method === 'grant' && !r.grantRemoved && c.grant) st.canRestore = true;
            else st.restoreWhy = 'age-changed';
        }
        else if (!c.reHide)                    st.restoreWhy = 'no-api';
        else st.canRestore = true;
    }
    const sizeSig = st.size.W + 'x' + st.size.H + ':' + st.size.reason;
    const sig = [st.canReveal, st.canRestore, st.revealWhy, st.restoreWhy, st.record ? st.record.method + '@' + st.record.turn + (st.record.stale ? '!' + st.record.stale : '') : '-', sizeSig].join('|');
    if (sig !== _fogLastStatus) {
        _fogLastStatus = sig;
        fogDiag('status', { canReveal: st.canReveal, canRestore: st.canRestore, revealWhy: st.revealWhy, restoreWhy: st.restoreWhy,
                            units: st.revealMethodUnits, terrain: st.revealMethodTerrain, record: st.record ? st.record.method : 'none',
                            src: st.record ? st.record.src : '', stale: st.record ? st.record.stale : '', size: sizeSig });
    }
    return st;
}

/**
 * Reveal the whole map, reversibly. opts.withUnits (default true here; the Map tab defaults to OFF):
 * true = tracked vision grant on every plot (you see every unit and city — and meet every civ you see,
 * which stays); false = terrain only (setAllRevealed, no vision). opts.allowPermanent must be true for the
 * one-way revealAllPlots, which is used when the reversible APIs are missing, or when opts.method ===
 * 'permanent' (the Map tab's confirmed fallback after a refused reversible reveal: see result.fallback).
 * Returns {ok, reason, method, fallback?} at once; opts.onDone(result) fires after the deferred read-back
 * (~0.25-4 s). Never throws. On a map wider or taller than 128 it refuses every method before touching
 * anything ({ok:false, reason:'map-too-large', W, H, limit, axis}, no fallback offered).
 */
export function revealMap(opts = {}) {
    const t0 = Date.now();
    const withUnits = opts.withUnits !== false;
    const forced = (opts.method === 'permanent') ? 'permanent' : '';
    const onDone = (typeof opts.onDone === 'function') ? opts.onDone : null;
    fogDiag('reveal.enter', { withUnits, allowPermanent: !!opts.allowPermanent, forced, busy: _fogBusy });
    const exit = (res) => { fogDiag('reveal.exit', { ok: res.ok, reason: res.reason, method: res.method || '', fallback: res.fallback || '', ms: Date.now() - t0 }); return res; };
    if (!guardSP()) return exit({ ok: false, reason: 'multiplayer' });
    if (_fogBusy) return exit({ ok: false, reason: 'busy' });
    let p, W, H;
    try { p = GameContext.localPlayerID; W = GameplayMap.getGridWidth(); H = GameplayMap.getGridHeight(); }
    catch (e) { fogDiag('reveal.error', { stage: 'map-size', err: fogErr(e) }); return exit({ ok: false, reason: 'no-map' }); }
    if (!W || !H) return exit({ ok: false, reason: 'no-map' });

    // STEP 0/6 (2026-10-20 crash guard): no reveal of any kind (grant, terrain or one-way) on a map wider or
    // taller than 128 — the terrain renderer crashes once the far bottom edge is uncovered and on screen.
    const size = checkRevealMapSize('revealMap');
    fogDiag('reveal.step0', { decision: size.ok ? 'allow' : 'refuse', reason: size.reason, W, H, limit: size.limit, axis: size.axis });
    if (!size.ok) return exit({ ok: false, reason: size.reason, W: size.W, H: size.H, limit: size.limit, axis: size.axis });

    // STEP 1/6: one reveal at a time — the FIRST snapshot is the real pre-reveal fog.
    const prior = loadFogRecord(W, H);
    fogDiag('reveal.step1', { prior: prior ? prior.method : 'none', priorTurn: prior ? prior.turn : '', src: prior ? prior._src : '', stale: prior ? prior._stale : '' });
    if (prior && prior.method === 'permanent') return exit({ ok: false, reason: 'permanent-done', method: 'permanent' });
    if (prior && prior._stale) return exit({ ok: false, reason: 'age-changed', method: prior.method });
    if (prior) return exit({ ok: false, reason: 'already-revealed', method: prior.method });

    // STEP 2/6: snapshot what the player has NOT explored yet.
    const snap = readRevealedStates(p);
    fogDiag('reveal.step2', { ok: snap.ok, src: snap.source, W: snap.W, H: snap.H, hidden: snap.hidden, explored: snap.revealed, visible: snap.visible, err: snap.error });
    if (!snap.ok) return exit({ ok: false, reason: 'snapshot-failed', error: snap.error });
    if (snap.total > 0 && snap.visible >= snap.total * FOG_PERMANENT_SHARE) {
        fogDiag('reveal.decision', { branch: 'already-permanent', visible: snap.visible, total: snap.total });
        return exit({ ok: false, reason: 'already-permanent', visible: snap.visible, total: snap.total });
    }

    // STEP 3/6: pick the method.
    const cap = getFogCapabilities();
    let method = null;
    if (forced) method = cap.permanent ? 'permanent' : null;   // confirmed one-way fallback
    else if (withUnits) method = (cap.grant && cap.reHide) ? 'grant' : (cap.terrain && cap.reHide) ? 'terrain' : cap.permanent ? 'permanent' : null;
    else method = (cap.terrain && cap.reHide) ? 'terrain' : null;   // terrain-only was asked for: never grant vision instead
    // If the reversible method is refused, the Map tab may offer the one-way reveal after a confirm click:
    // only when vision was asked for (Units ON), never in place of a terrain-only reveal.
    const fallback = (withUnits && method !== 'permanent' && cap.permanent) ? 'permanent' : '';
    fogDiag('reveal.decision', { method: method || 'none', withUnits, forced, fallback, grant: cap.grant, terrain: cap.terrain, reHide: cap.reHide, permanent: cap.permanent });
    if (!method) return exit({ ok: false, reason: (withUnits || forced) ? 'no-api' : 'no-terrain-api' });
    if (method === 'permanent' && !opts.allowPermanent) return exit({ ok: false, reason: 'needs-confirm', method });

    // STEP 4/6: build the record BEFORE touching the engine (a failure later still leaves the snapshot).
    const total = snap.total;
    const rec = {
        v: 1, key: fogGameKey(W, H), player: p, W, H, total, method, grantId: null, grantRemoved: false, idModel: '',
        turn: (() => { try { return Game.turn; } catch (_) { return -1; } })(),
        age: fogAgeNow(),
        hiddenBefore: snap.hidden, rle: fogMaskToRle(snap.states, total), at: t0,
    };
    fogDiag('reveal.step4', { method, hiddenBefore: rec.hiddenBefore, rleChars: rec.rle.length, turn: rec.turn, age: rec.age });

    // STEP 5/6: the engine call.
    const t1 = Date.now();
    try {
        if (method === 'grant') {
            // 5a: free the grant slot, else this grant's vision could be applied but never recorded (permanent).
            const pre = fogGrantPreclear(p);
            if (!pre.ok) {
                fogDiag('reveal.decision', { branch: 'grant-unsafe', how: pre.how, removeRet: pre.removeRet });
                return exit({ ok: false, reason: 'grant-unsafe', method, fallback, ret: pre.removeRet });
            }
            // 5b: the reveal's own grant on every plot.
            const all = new Array(total);
            for (let i = 0; i < total; i++) all[i] = i;
            const raw = Visibility.setTrackedVisibilityGrant(p, FOG_GRANT_TURNS, all);
            const id = fogGrantId(raw);
            rec.idModel = (pre.probeId == null || id == null) ? 'unknown'
                : (id === pre.probeId) ? 'constant' : (id === pre.probeId + 1) ? 'sequential' : 'other';
            fogDiag('reveal.step5', { api: 'Visibility.setTrackedVisibilityGrant', plots: total, turns: FOG_GRANT_TURNS, ret: String(raw), type: typeof raw,
                                      id, probeId: pre.probeId, idModel: rec.idModel, ms: Date.now() - t1 });
            // null = refused: undefined (cohtml rejected the arguments, "Argument conversion failed" in UI.log) or 0 (nothing granted)
            if (id == null) return exit({ ok: false, reason: 'grant-refused', method, fallback, ret: String(raw) });
            rec.grantId = id;
        } else if (method === 'terrain') {
            const r = WorldBuilder.MapPlots.setAllRevealed(p, true);
            fogDiag('reveal.step5', { api: 'WorldBuilder.MapPlots.setAllRevealed', ret: r, type: typeof r, ms: Date.now() - t1 });
            if (typeof r !== 'boolean') return exit({ ok: false, reason: 'terrain-refused', method, fallback, ret: String(r) });
            // r === false only means "no plot needed changing" (all explored or in sight) — still a valid reveal
        } else {
            const r = revealEntireMap();
            fogDiag('reveal.step5', { api: 'Visibility.revealAllPlots', ret: r, forced, ms: Date.now() - t1 });
            if (!r) return exit({ ok: false, reason: 'permanent-failed', method });
        }
    } catch (e) {
        fogDiag('reveal.error', { stage: 'engine-call', method, err: fogErr(e) });
        return exit({ ok: false, reason: 'engine-threw', method, fallback: (method !== 'permanent') ? fallback : '', error: fogErr(e) });
    }
    saveFogRecord(rec);

    // STEP 6/6: deferred read-back — the UI view of the map trails the engine write. A vision reveal
    // (grant / one-way) puts every plot in sight; a terrain reveal must uncover >= 90% of the unexplored
    // tiles (a unit exploring a tile meanwhile must not count as success).
    _fogBusy = true;
    const revealed = (s) => (method !== 'terrain') ? (s.visible >= total * 0.9)
        : (snap.hidden === 0 || s.hidden * 10 <= snap.hidden);
    fogPoll(p, revealed, (s, polls, ms, matched) => {
        _fogBusy = false;
        const res = { ok: matched, reason: matched ? 'revealed' : 'unverified', method, grantId: rec.grantId, idModel: rec.idModel,
                      hiddenBefore: snap.hidden, hiddenNow: s ? s.hidden : -1, visibleNow: s ? s.visible : -1, polls, ms };
        fogDiag('reveal.verify', res);
        if (onDone) { try { onDone(res); } catch (e) { fogDiag('reveal.ondone-error', { err: fogErr(e) }); } }
    });
    return exit({ ok: true, reason: 'sent', method });
}

/**
 * Undo a revealMap(): remove its vision grant, then mark every tile that was unexplored before the reveal
 * unexplored again (chunked across ticks). Tiles the player can see right now are refused by the engine
 * and stay visible. A record from an earlier age only gets its vision grant removed (reason
 * 'age-vision-removed') or is refused ('age-changed'). Returns {ok, reason} at once;
 * opts.onProgress({done,total,hid,kept}) per chunk; opts.onDone(result) after a deferred read-back. Never throws.
 */
export function restoreFog(opts = {}) {
    const t0 = Date.now();
    const onDone = (typeof opts.onDone === 'function') ? opts.onDone : null;
    const onProgress = (typeof opts.onProgress === 'function') ? opts.onProgress : null;
    fogDiag('restore.enter', { busy: _fogBusy });
    const exit = (res) => { fogDiag('restore.exit', { ok: res.ok, reason: res.reason, method: res.method || '', targets: res.targets, ms: Date.now() - t0 }); return res; };
    if (!guardSP()) return exit({ ok: false, reason: 'multiplayer' });
    if (_fogBusy) return exit({ ok: false, reason: 'busy' });
    let p, W, H;
    try { p = GameContext.localPlayerID; W = GameplayMap.getGridWidth(); H = GameplayMap.getGridHeight(); }
    catch (e) { fogDiag('restore.error', { stage: 'map-size', err: fogErr(e) }); return exit({ ok: false, reason: 'no-map' }); }
    // Map size (2026-10-20): logged only. Restore is allowed on maps wider or taller than 128 too, because it
    // only covers tiles again (it never uncovers one), which can only shrink what the terrain renderer draws.
    {
        const size = revealSizeVerdict(W, H);
        fogDiag('restore.size', { W, H, limit: size.limit, wide: !size.ok, axis: size.axis, decision: 'allow',
                                  why: size.ok ? 'size-ok' : 'restore-only-covers-tiles' });
    }

    // STEP 1/6: the reveal record (memory, else the save).
    const rec = (W && H) ? loadFogRecord(W, H) : null;
    let turnNow = -1;
    try { turnNow = Game.turn; } catch (_) {}
    fogDiag('restore.step1', { rec: rec ? rec.method : 'none', src: rec ? rec._src : '', turnRevealed: rec ? rec.turn : '', turnNow,
                               grantId: rec ? rec.grantId : '', grantRemoved: rec ? !!rec.grantRemoved : '', stale: rec ? rec._stale : '' });
    if (!rec) return exit({ ok: false, reason: 'no-record' });
    if (rec.method === 'permanent') return exit({ ok: false, reason: 'permanent', method: rec.method });
    const cap = getFogCapabilities();

    // An earlier age's record: covering its snapshot's tiles again would also hide what was explored since,
    // so only its vision grant (if still there) is taken back; then the record is dropped.
    if (rec._stale === 'age') {
        fogDiag('restore.decision', { branch: 'age-changed', method: rec.method, grantRemoved: !!rec.grantRemoved, grant: cap.grant });
        if (rec.method === 'grant' && rec.grantId != null && !rec.grantRemoved && cap.grant) {
            const g = fogRemoveGrant(p, rec);
            if (g.state === 'threw') return exit({ ok: false, reason: 'engine-threw', method: rec.method, error: g.err });
            if (g.state === 'rejected') return exit({ ok: false, reason: 'grant-remove-rejected', method: rec.method, ret: String(g.ret) });
            clearFogRecord('age-changed');
            return exit({ ok: false, reason: 'age-vision-removed', method: rec.method, grantState: g.state });
        }
        return exit({ ok: false, reason: 'age-changed', method: rec.method });
    }
    if (!cap.reHide || (rec.method === 'grant' && !rec.grantRemoved && !cap.grant)) {
        fogDiag('restore.decision', { branch: 'no-api', reHide: cap.reHide, grant: cap.grant });
        return exit({ ok: false, reason: 'no-api', method: rec.method });
    }

    // STEP 2/6: decode the snapshot into the list of tiles to cover again.
    const mask = fogRleToMask(rec.rle, rec.total);
    if (!mask) { fogDiag('restore.error', { stage: 'decode', rleChars: (rec.rle || '').length, total: rec.total }); return exit({ ok: false, reason: 'record-corrupt', method: rec.method }); }
    const targets = [];
    for (let i = 0; i < rec.total; i++) if (mask[i]) targets.push(i);
    fogDiag('restore.step2', { targets: targets.length, hiddenBefore: rec.hiddenBefore });

    // STEP 3/6: take the vision back (tracked grant). A rejected call stops here: covering tiles that are
    // still in sight would only be refused, and the record must stay for a retry.
    let grantRet = null, grantState = 'skipped';
    if (rec.method === 'grant' && rec.grantId != null && !rec.grantRemoved) {
        const g = fogRemoveGrant(p, rec);
        grantRet = g.ret; grantState = g.state;
        if (g.state === 'threw') return exit({ ok: false, reason: 'engine-threw', method: rec.method, error: g.err });
        if (g.state === 'rejected') {
            fogDiag('restore.decision', { branch: 'grant-remove-rejected', ret: String(g.ret) });
            return exit({ ok: false, reason: 'grant-remove-rejected', method: rec.method, ret: String(g.ret) });
        }
        saveFogRecord(rec);
    } else {
        fogDiag('restore.step3', { skipped: true, method: rec.method, grantRemoved: !!rec.grantRemoved, grantMissing: !!rec.grantMissing });
    }

    // STEP 4/6: cover the tiles that were unexplored before the reveal, one chunk per tick.
    _fogBusy = true;
    const n = targets.length;
    let k = 0, hid = 0, kept = 0, odd = 0, threw = 0, firstErr = '', oddSample = '';
    const failing = () => (threw >= 5 && hid === 0) || (odd >= 50 && hid === 0 && kept === 0);
    const finish = (aborted) => {
        // STEP 5/6: decide (return values first; the map view is checked in step 6).
        let reason;
        if (threw && !hid) reason = 'threw';
        else if (odd && !hid && !kept) reason = 'binding-rejected';
        else if (hid > 0) reason = kept > 0 ? 'restored-partial' : 'restored';
        else if (n === 0) reason = 'nothing-hidden';
        else reason = 'kept-all';
        const success = (reason === 'restored' || reason === 'restored-partial' || reason === 'nothing-hidden');
        fogDiag('restore.decision', { reason, hid, kept, odd, threw, targets: n, aborted, grantState, firstErr, oddSample });
        if (success) clearFogRecord('restored'); else saveFogRecord(rec);   // keep the snapshot for a retry

        // STEP 6/6: deferred read-back of the target tiles as the UI shows them.
        fogPoll(p, (s, polls) => {
            if (hid === 0) return polls >= 6;               // nothing to wait for: settle ~1.5 s, then classify
            let h = 0;
            for (let i = 0; i < n; i++) if (s.states[targets[i]] === 0) h++;
            return h >= hid * 0.95;
        }, (s, polls, ms, matched) => {
            _fogBusy = false;
            let hNow = -1, eNow = -1, vNow = -1;
            if (s) {
                hNow = 0; eNow = 0; vNow = 0;
                for (let i = 0; i < n; i++) { const v = s.states[targets[i]]; if (v === 0) hNow++; else if (v === 2) vNow++; else eNow++; }
            }
            // "kept-all": still in sight => vision the panel cannot take back (the grant was missing or never
            // recorded, or a one-way reveal on top); still explored-but-fogged => the engine refused the write.
            if (reason === 'kept-all' && s) reason = (vNow >= n * 0.9) ? 'kept-visible' : 'kept-explored';
            const res = { ok: success, reason, method: rec.method, hid, kept, odd, threw, targets: n, grantRet, grantState,
                          grantMissing: !!rec.grantMissing, idModel: rec.idModel || '',
                          hiddenNow: hNow, exploredNow: eNow, visibleNow: vNow, polls, ms, verified: matched, firstErr };
            fogDiag('restore.verify', res);
            if (onDone) { try { onDone(res); } catch (e) { fogDiag('restore.ondone-error', { err: fogErr(e) }); } }
        });
    };
    const runChunk = () => {
        const tc = Date.now();
        const end = Math.min(n, k + FOG_CHUNK);
        for (; k < end; k++) {
            const idx = targets[k];
            const x = idx % W, y = (idx - x) / W;
            try {
                const r = WorldBuilder.MapPlots.setRevealed(p, { x, y }, false);
                if (r === true) hid++;
                else if (r === false) kept++;
                else { odd++; if (!oddSample) oddSample = typeof r + ':' + String(r); }
            } catch (e) { threw++; if (!firstErr) firstErr = fogErr(e); }
            if (failing()) { k++; break; }                  // the call itself fails: stop hammering it
        }
        fogDiag('restore.step4', { done: k, of: n, hid, kept, odd, threw, ms: Date.now() - tc });
        if (onProgress) { try { onProgress({ done: k, total: n, hid, kept }); } catch (_) {} }
        if (k < n && !failing()) { setTimeout(runChunk, 0); return; }
        finish(k < n);
    };
    setTimeout(runChunk, 0);
    return exit({ ok: true, reason: 'sent', method: rec.method, targets: n });
}

/** Drop the saved reveal record without touching the map (a still-active vision grant then stays). */
export function forgetFogRecord() {
    fogDiag('forget.enter', { busy: _fogBusy, had: !!(_fogMem && !_fogMem.cleared) });
    if (_fogBusy) { fogDiag('forget.exit', { ok: false, reason: 'busy' }); return false; }
    clearFogRecord('forget');
    fogDiag('forget.exit', { ok: true });
    return true;
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
// 2026-10-21: refuses (returns false) a target in the wide-map edge strip (checkWideMapEdge, maps wider than 128
// only). opts.edge = a verdict the caller already got from checkWideMapEdge for this same tile (claim mode passes
// it so one click logs one edge.guard line); without it the check runs here.
export function claimPlotForCity(cityOrID, loc, opts = {}) {
    if (!guardSP()) return false;
    if (!loc || !Number.isInteger(loc.x) || !Number.isInteger(loc.y)) { ERR('claimPlotForCity: bad loc', loc); return false; }
    // STEP 0: wide-map edge guard (never on a tile whose ownership could uncover the crash strip).
    const pre = opts && opts.edge;
    const edge = (pre && pre.x === loc.x && pre.y === loc.y) ? pre : checkWideMapEdge(loc, 'claim');
    if (!edge.ok) {
        LOG('claimPlotForCity: (' + loc.x + ',' + loc.y + ') refused by the wide-map edge guard (' + edge.reason + ', ' + edge.W + 'x' + edge.H + ')');
        return false;
    }
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
// UI-callable map paint via WorldBuilder.MapPlots.set{Terrain,Feature,Resource,Biome}, the same setters the
// in-game tuner uses (base ui/tuner-input/tuner-input.js:48/52/56/104 and the erase calls at :167/:171). Each
// takes a numeric type hash (Database.makeHash("TERRAIN_X")) and a {x,y} PlotCoord. Bindings on build
// 25516395 (mangled Scripting::Function names in the executable):
//   bool setTerrain(TerrainTypes, PlotCoord)            bool setBiome(BiomeTypes, PlotCoord)
//   bool setFeature(FeatureTypes, PlotCoord, Optional<DirectionTypes>)
//   bool setResource(ResourceTypes, PlotCoord, int amount)   (the tuner passes 1 to place, 0 to erase)
// The JS WorldBuilder object is isActive / startBlock / endBlock / MapPlots, and MapPlots has eight setters (the
// four above + setFertility, setOwnership, setRevealed, setAllRevealed): no river, continent or elevation setter.
// (TerrainBuilder binds river functions, but whether this UI context can reach TerrainBuilder is unprobed — the
// first paint logs it, see paintApi.) Because a painted navigable river is never drawn as a river, the panel draws its
// own stand-in mark on such tiles (2026-11-02, see PAINTED-RIVER STAND-IN OVERLAY below enterPaintMode).
//
// 2026-10-18 REWRITE — why painting "worked half the time":
//   The old paintPlot read the plot back inside the SAME call. On build 25516395 the write shows up a moment
//   later, so the first click on a tile read the OLD value and flashed red although the paint had worked, and a
//   second click on the same tile read the applied value and flashed green. UI.log 2026-10-18 (10:55-12:15):
//   149 paint clicks, 115 flashed red; 56 of the red ones were re-read by a later click on the same tile and all
//   56 HAD landed (e.g. LCPD:24 mountain on 86/49 ok=false, LCPD:30 reads TERRAIN_MOUNTAIN). Why the write is
//   late is INFERRED: the binary runs WorldBuilder edits as GameCore commands (WorldBuilder::Map::CommandSetTerrain…).
//   The old wonder code issued terrain, biome and feature back to back and read back at once, so the wonder could
//   be judged against a tile that was not prepared yet (INFERRED — no wonder was attempted on 2026-10-18).
//   Now every write is verified ASYNCHRONOUSLY (poll the plot until the value lands or a timeout), each step of a
//   multi-step paint waits for the previous one, and every outcome carries a plain-language reason (paint banner
//   + the Creative tab's "Recent paint results" + LCPD breadcrumbs). Writes stay inside WorldBuilder.startBlock()/
//   endBlock() (wbEdit), like before: every write verified to land on 2026-10-18 ran inside such a block.
//   Steam reports on the public copy (filedetails/comments/3736063097, 2026-06/08) are checked after each paint and
//   reported in plain words instead of passing silently: a tile's continent changing after a wonder ("Africa"),
//   river data that stays under a painted-over navigable river, and the empire resource list (Resources screen)
//   listing a painted resource twice or keeping a cleared one. "(Clear / remove feature)" answers the request for a
//   way to remove a feature.
//   Natural wonders get the map generator's own inputs (natural-wonder-generator.js:52-57,76-83: the feature, its
//   Feature_NaturalWonders.Direction and the plot elevation) and, IF this UI context exposes it, the generator's
//   own check TerrainBuilder.canHaveFeatureParam. The write itself is WorldBuilder.MapPlots.setFeature; and unlike
//   the generator (which only picks tiles that already fit), the panel prepares the tile and puts it back if the
//   game refuses. Wonder-site patch (part 2): multi-tile wonders get the tiles their shape may use prepared around
//   the anchor, and neighbour rules (Uluru, Valley of Flowers) get helper tiles for a moment — up to 19 tiles that
//   are put back right after; when the game's own check accepts the clicked tile as it is, nothing is reshaped.
//
// Sentinel "types" meaning "clear/remove": CLEAR_RESOURCE (setResource(NO_RESOURCE, loc, 0), the tuner's
// erase path) and CLEAR_FEATURE (setFeature(NO_FEATURE, loc), tuner-input.js:167; on a natural wonder it
// clears every plot of the wonder).
export const CLEAR_RESOURCE = '__LCP_CLEAR_RESOURCE__';
export const CLEAR_FEATURE  = '__LCP_CLEAR_FEATURE__';

const PAINT_POLL_MS = 60;            // read-back poll interval while a queued WorldBuilder write lands
const PAINT_STEP_TIMEOUT_MS = 4000;  // per step; generous because GameCore is slow while AI turns process
const PAINT_LATE_CHECK_MS = 8000;    // one more read after a timeout (log + a late result)
const PAINT_SETTLE_MS = 1200;        // how long river data may take to follow a terrain change on/into a navigable river
const PAINT_POST_READ_MS = 1000;     // a silent re-read of the painted tile (continent/river) for the breadcrumbs
const PAINT_RESULTS_MAX = 8;         // "Recent paint results" kept for the Creative tab
const PAINT_FOOTPRINT_WAIT_MS = 2500; // how long a multi-tile wonder's other tiles may take to show up after the anchor
// Batch each step's writes in WorldBuilder.startBlock()/endBlock() (wbEdit). Every write verified to land on build
// 25516395 (UI.log 2026-10-18, 56 of 56) ran inside such a block; writing without one is untested on this build.
const PAINT_USE_WB_BLOCK = true;
// Ask the map generator's own validity checks (TerrainBuilder / ResourceBuilder) when this UI context has them. They
// are advisory: they only add reasons/notes and let a wonder skip site prep; false switches them off.
const PAINT_USE_ENGINE_CHECKS = true;

let _paintSeq = 0;                    // paint id in every breadcrumb of one click
const _paintBusyPlots = new Set();    // "x,y" of plots with a paint still in flight (double-click guard)
let _wonderBusy = false;              // one wonder placement at a time (their site prep/restore can overlap)
const _paintResults = [];             // newest first

function paintErrText(e) {
    // breadcrumb-only text: token-safe since 2026-10-21 (no whitespace or ',' inside this positional field)
    try { return diagTok(String((e && (e.stack || e.message)) || e).replace(/\s+/g, ' '), 300); } catch (_) { return '?'; }
}
function paintSecs(ms) { return (Math.round((ms || 0) / 100) / 10) + ' s'; }
function paintKey(loc) { return loc.x + ',' + loc.y; }
function paintAt(loc) { return '(' + loc.x + ',' + loc.y + ')'; }
function paintFn(obj, name) { try { return !!obj && typeof obj[name] === 'function'; } catch (_) { return false; } }

/** Recent paint outcomes (newest first) for the Creative tab: [{seq, t, status, message}]. */
export function getRecentPaintResults() { return _paintResults.slice(); }
function paintRecordResult(res) {
    try {
        const i = _paintResults.findIndex(r => r.seq === res.seq);
        const row = { seq: res.seq, t: Date.now(), status: res.status, message: res.message };
        if (i >= 0) _paintResults[i] = row; else _paintResults.unshift(row);
        if (_paintResults.length > PAINT_RESULTS_MAX) _paintResults.length = PAINT_RESULTS_MAX;
    } catch (_) {}
}

// ── What this UI context exposes (logged at the first paint, and since 2026-11-02 also early via logPaintApiOnce) ──
// TerrainBuilder / ResourceBuilder appear only in base map scripts; whether this HUD context has them is unprobed on
// 25516395. GameplayMap.getContinentType is used by base UI (continent-layer.js:86, plot-tooltip helpers.js:75);
// getElevation / getPlotLatitude / isNavigableRiver are bound in the binary but used by map scripts only. The member
// lists come from a bounded prototype walk (the 2026-07-13 freeze was a probe walk that never advanced).
let _paintApi = null;
function paintMembers(obj) {
    const names = [];
    try {
        let c = obj, depth = 0;
        while (c && c !== Object.prototype && depth < 4) {
            for (const n of Object.getOwnPropertyNames(c)) if (n !== 'constructor' && names.indexOf(n) < 0) names.push(n);
            c = Object.getPrototypeOf(c);   // always advance
            depth++;
        }
    } catch (_) {}
    return names.slice(0, 40).join('/') || 'none';
}
// Per-module-instance id. api.js is evaluated once per JS context, so paint.api lines sharing inst= came from the
// same context; ctx= says which caller logged it, href= which document that context runs in.
const _paintCtxInst = (() => { try { return Date.now().toString(36).slice(-5) + Math.floor(Math.random() * 46656).toString(36); } catch (_) { return '?'; } })();
function paintCtxText(tag) {
    let href = 'n/a';
    try { if (typeof location !== 'undefined' && location) href = String(location.pathname || location.href || 'n/a').split('/').slice(-2).join('/'); } catch (_) {}
    return 'ctx=' + diagTok(tag, 40) + ',inst=' + _paintCtxInst + ',href=' + diagTok(href, 80) + ',doc=' + (typeof document !== 'undefined');
}
/** typeof obj[name] without calling anything ('n/a' when obj is missing, 'throws' when the read throws). */
function paintTypeOf(obj, name) { try { return obj ? typeof obj[name] : 'n/a'; } catch (_) { return 'throws'; } }
function paintGlobals() {
    const G = { TB: null, RB: null, GM: null, WB: null, AB: null };
    try { G.TB = (typeof TerrainBuilder !== 'undefined') ? TerrainBuilder : null; } catch (_) {}
    try { G.RB = (typeof ResourceBuilder !== 'undefined') ? ResourceBuilder : null; } catch (_) {}
    try { G.GM = (typeof GameplayMap !== 'undefined') ? GameplayMap : null; } catch (_) {}
    try { G.WB = (typeof WorldBuilder !== 'undefined') ? WorldBuilder : null; } catch (_) {}
    try { G.AB = (typeof AreaBuilder !== 'undefined') ? AreaBuilder : null; } catch (_) {}
    return G;
}
function paintApiFlags(G) {
    const TB = G.TB, RB = G.RB, GM = G.GM, WB = G.WB;
    return {
        canHaveFeatureParam: paintFn(TB, 'canHaveFeatureParam'), canHaveFeature: paintFn(TB, 'canHaveFeature'),
        canHaveResource: paintFn(RB, 'canHaveResource'), isResourceValidForAge: paintFn(RB, 'isResourceValidForAge'),
        getElevation: paintFn(GM, 'getElevation'), getPlotLatitude: paintFn(GM, 'getPlotLatitude'),
        getContinentType: paintFn(GM, 'getContinentType'), isNavigableRiver: paintFn(GM, 'isNavigableRiver'),
        startBlock: paintFn(WB, 'startBlock') && paintFn(WB, 'endBlock'),
    };
}
// The paint.api breadcrumb (+ paint.api.members). typeof checks only: no TerrainBuilder / AreaBuilder function is
// ever called here. The tb.* / ab.* fields answer "can this context reach the river-data writer
// (TerrainBuilder.setRiverInfo) and the calls a map script runs after it?". members: 'all' | 'builders' (only the
// TerrainBuilder / AreaBuilder / ResourceBuilder member lists, and only when one exists).
function paintApiDiag(tag, G, A, members) {
    const TB = G.TB, RB = G.RB, GM = G.GM, WB = G.WB, AB = G.AB;
    let mf = 'n/a';
    try { mf = (typeof MapFeatures !== 'undefined' && MapFeatures) ? typeof MapFeatures.getFeatureInfoAt : 'n/a'; } catch (_) {}
    diag('paint.api:' + paintCtxText(tag) + ',TerrainBuilder=' + (TB ? 'yes' : 'no') + ',canHaveFeatureParam=' + A.canHaveFeatureParam + ',canHaveFeature=' + A.canHaveFeature
        + ',setRiverInfo=' + paintFn(TB, 'setRiverInfo') + ',modelRivers=' + paintFn(TB, 'modelRivers')
        + ',tb.setRiverInfo=' + paintTypeOf(TB, 'setRiverInfo') + ',tb.finalizeRivers=' + paintTypeOf(TB, 'finalizeRivers')
        + ',tb.storeWaterData=' + paintTypeOf(TB, 'storeWaterData') + ',tb.validateAndFixTerrain=' + paintTypeOf(TB, 'validateAndFixTerrain')
        + ',AreaBuilder=' + (AB ? 'yes' : 'no') + ',ab.recalculateAreas=' + paintTypeOf(AB, 'recalculateAreas')
        + ',ResourceBuilder=' + (RB ? 'yes' : 'no') + ',canHaveResource=' + A.canHaveResource + ',isResourceValidForAge=' + A.isResourceValidForAge
        + ',getElevation=' + A.getElevation + ',getPlotLatitude=' + A.getPlotLatitude + ',getContinentType=' + A.getContinentType
        + ',isNavigableRiver=' + A.isNavigableRiver + ',getFeatureInfoAt=' + mf + ',startBlock=' + A.startBlock + ',engineChecks=' + PAINT_USE_ENGINE_CHECKS
        + ',setFeatureType=' + paintFn(TB, 'setFeatureType') + ',getOwner=' + paintFn(GM, 'getOwner')
        + ',playerResources=' + (() => { try { return paintFn(Players.get(GameContext.localPlayerID)?.Resources, 'getResources'); } catch (_) { return false; } })());
    if (members === 'all') {
        diag('paint.api.members:WorldBuilder=' + paintMembers(WB) + ';MapPlots=' + paintMembers(WB && WB.MapPlots)
            + (TB ? ';TerrainBuilder=' + paintMembers(TB) : '') + (RB ? ';ResourceBuilder=' + paintMembers(RB) : '')
            + (AB ? ';AreaBuilder=' + paintMembers(AB) : ''));
    } else if (members === 'builders' && (TB || AB || RB)) {
        diag('paint.api.members:ctx=' + diagTok(tag, 40) + (TB ? ';TerrainBuilder=' + paintMembers(TB) : '')
            + (RB ? ';ResourceBuilder=' + paintMembers(RB) : '') + (AB ? ';AreaBuilder=' + paintMembers(AB) : ''));
    }
}
function paintApi() {
    if (_paintApi) return _paintApi;
    const G = paintGlobals();
    const A = paintApiFlags(G);
    _paintApi = A;
    paintApiDiag('first-use', G, A, 'all');
    return A;
}
// Early, paint-independent copy of the paint.api breadcrumb: once per caller tag per context (the Creative tab's first
// render, paint-tile-mode.js at module load), so the next UI.log answers "can the panel reach
// TerrainBuilder.setRiverInfo?" even in a session with no paint. Never throws.
const _paintApiLogged = Object.create(null);
export function logPaintApiOnce(tag, _tries = 0) {
    const t = String(tag || 'unknown');
    if (_paintApiLogged[t]) return;
    // A module-load caller can run before <body> exists. Wait (up to 40 × 250 ms) so the first breadcrumb does not
    // create the maxWidth sink element outside <body>; after that, log anyway (diag's console.error line still goes out).
    try {
        if (!_diagEl && (typeof document === 'undefined' || !document || !document.body) && _tries < 40) {
            setTimeout(() => logPaintApiOnce(t, _tries + 1), 250);
            return;
        }
    } catch (_) {}
    _paintApiLogged[t] = true;
    try {
        const G = paintGlobals();
        paintApiDiag(t, G, paintApiFlags(G), 'builders');
    } catch (e) { diag('paint.api:ctx=' + diagTok(t, 40) + ',inst=' + _paintCtxInst + ',THROW,' + paintErrText(e)); }
}

// ── Placement rules, read once from the gameplay tables the base map generator uses ──
// Terrains / Biomes / Features / Resources (names + flags), Biome_ValidTerrains, Feature_ValidTerrains,
// Feature_ValidBiomes, Feature_NaturalWonders (Tiles, Direction, NoRiver), Resource_ValidBiomes,
// Resource_ValidAges and the FEATURE_* TypeTags. Schema: Base/Assets/schema/gameplay/01_GameplaySchema.sql.
let _rules = null;
function paintRowName(row, key) {
    try { return (row && row.Name) ? Locale.compose(row.Name) : (row ? row[key] : ''); } catch (_) { return row ? row[key] : ''; }
}
// The game's own text for a LOC_ tag, with [icon:…] / [TIP:…] markup removed ('' if missing or untranslated).
function paintLocText(tag) {
    if (!tag) return '';
    try {
        const s = String(Locale.compose(tag) || '');
        if (!s || s === tag) return '';
        return s.replace(/\[icon:[^\]]*\]/gi, '').replace(/\[\/?[A-Za-z_]+(:[^\]]*)?\]/g, '').replace(/\s+/g, ' ').trim();
    } catch (_) { return ''; }
}
function paintAddTo(map, key, val) { if (!key || val == null) return; (map[key] || (map[key] = [])).push(val); }
function paintRules() {
    if (_rules) return _rules;
    const R = {
        terr: Object.create(null), biome: Object.create(null), feat: Object.create(null), res: Object.create(null),
        nw: Object.create(null), featTerr: Object.create(null), featBiome: Object.create(null),
        biomeTerr: Object.create(null), terrBiomes: Object.create(null), resValid: Object.create(null),
        resAges: Object.create(null), tags: Object.create(null),
    };
    const each = (table, fn) => {
        try {
            const t = (typeof GameInfo !== 'undefined') ? GameInfo[table] : null;
            if (!t) { diag('paint.rules:missing-table=' + table); return; }
            for (const r of t) { try { fn(r); } catch (_) {} }
        } catch (e) { diag('paint.rules:THROW,table=' + table + ',' + paintErrText(e)); }
    };
    // NB TERRAIN_MOUNTAIN carries Impassable="true" but NO Mountain attribute in base terrain.xml, so "mountain"
    // is derived from the type / Impassable rather than the (always-0) Mountain column.
    each('Terrains', r => { R.terr[r.TerrainType] = { name: paintRowName(r, 'TerrainType'), water: !!r.Water, hills: !!r.Hills, impassable: !!r.Impassable,
        mountain: !!r.Mountain || r.TerrainType === 'TERRAIN_MOUNTAIN' || (!!r.Impassable && !r.Water) }; });
    each('Biomes', r => { R.biome[r.BiomeType] = { name: paintRowName(r, 'BiomeType') }; });
    // Removable="false": ICE, VOLCANO, ATOLL and every natural wonder (base terrain.xml:192,205,207,209-220).
    // Min/MaxLatitude: REEF < 55, COLD_REEF >= 55, ATOLL < 55 (the generator's rule, feature-biome-generator.js:204).
    each('Features', r => { R.feat[r.FeatureType] = { name: paintRowName(r, 'FeatureType'), pclass: r.PlacementClass || '', impassable: !!r.Impassable,
        minElev: r.MinimumElevation | 0, maxElev: r.MaximumElevation | 0, noLake: !!r.NoLake,
        removable: !(r.Removable === false || r.Removable === 0), minLat: r.MinLatitude | 0, maxLat: r.MaxLatitude | 0 }; });
    each('Resources', r => { R.res[r.ResourceType] = { name: paintRowName(r, 'ResourceType'), cls: r.ResourceClassType || '', tip: r.Tooltip || null, index: r.$index }; });
    // NoRiver is BOOLEAN NOT NULL DEFAULT 1 (only the waterfalls set it false); accept false/0 as "river allowed".
    each('Feature_NaturalWonders', r => { R.nw[r.FeatureType] = { tiles: (r.Tiles | 0) || 1, direction: (r.Direction == null) ? -1 : (r.Direction | 0),
        noRiver: !(r.NoRiver === false || r.NoRiver === 0), hash: r.$hash }; });
    each('Feature_ValidTerrains', r => paintAddTo(R.featTerr, r.FeatureType, r.TerrainType));
    each('Feature_ValidBiomes', r => paintAddTo(R.featBiome, r.FeatureType, r.BiomeType));
    each('Biome_ValidTerrains', r => { paintAddTo(R.biomeTerr, r.BiomeType, r.TerrainType); paintAddTo(R.terrBiomes, r.TerrainType, r.BiomeType); });
    each('Resource_ValidBiomes', r => paintAddTo(R.resValid, r.ResourceType, { b: r.BiomeType || null, t: r.TerrainType || null, f: r.FeatureType || null }));
    each('Resource_ValidAges', r => paintAddTo(R.resAges, r.ResourceType, r.AgeType));
    each('TypeTags', r => { if (r.Type && r.Type.indexOf('FEATURE_') === 0) paintAddTo(R.tags, r.Type, r.Tag); });
    _rules = R;
    diag('paint.rules:terr=' + Object.keys(R.terr).length + ',biome=' + Object.keys(R.biome).length + ',feat=' + Object.keys(R.feat).length
        + ',nw=' + Object.keys(R.nw).length + ',res=' + Object.keys(R.res).length + ',resValid=' + Object.keys(R.resValid).length
        + ',featTags=' + Object.keys(R.tags).length);
    return R;
}

/** Localised display name for any TERRAIN_/BIOME_/FEATURE_/RESOURCE_ type string (falls back to a tidy id). */
function paintName(type) {
    if (!type) return 'none';
    try {
        const R = paintRules();
        const row = R.terr[type] || R.biome[type] || R.feat[type] || R.res[type];
        if (row && row.name) return row.name + (/_DISTANT_LANDS$/.test(type) ? ' (Distant Lands)' : '');
    } catch (_) {}
    return String(type).replace(/^(TERRAIN|BIOME|FEATURE|RESOURCE)_/, '').toLowerCase().replace(/_/g, ' ');
}
/** Label for the paint banner / Creative status line. */
export function paintTypeLabel(category, typeString) {
    if (typeString === CLEAR_RESOURCE) return 'Clear resource';
    if (typeString === CLEAR_FEATURE) return 'Clear feature';
    return paintName(typeString);
}
function paintAgeType() { try { return GameInfo.Ages.lookup(Game.age)?.AgeType || null; } catch (_) { return null; } }
function paintAgeName(ageType) {
    try { const r = GameInfo.Ages.lookup(ageType); return (r && r.Name) ? Locale.compose(r.Name) : ageType; } catch (_) { return ageType; }
}
function paintContinentName(c) {
    if (c == null) return '?';
    if (c === -1) return 'no continent';
    try {
        const row = GameInfo.Continents.lookup(c);
        if (row) return (row.Description ? paintLocText(row.Description) : '') || String(row.ContinentType || c).replace(/^CONTINENT_/, '').toLowerCase().replace(/_/g, ' ');
    } catch (_) {}
    return 'continent #' + c;
}
// "Grassland Hills, Plains Hills, …" from Resource_ValidBiomes rows (for messages).
function paintResourceCombos(rows) {
    const combos = [];
    for (const r of (rows || [])) {
        const c = [r.b ? paintName(r.b) : '', r.t ? paintName(r.t) : '', r.f ? '+' + paintName(r.f) : ''].filter(Boolean).join(' ');
        if (c && combos.indexOf(c) < 0) combos.push(c);
    }
    return combos.slice(0, 6).join(', ') + (combos.length > 6 ? ', …' : '');
}

// List natural wonders for the Wonder paint category: {type, name, tiles, terrain, biome}. Single-tile ones sort first.
export function getNaturalWonderTypes() {
    const out = [];
    try {
        const R = paintRules();
        for (const type of Object.keys(R.nw)) {
            out.push({ type, name: paintName(type), tiles: R.nw[type].tiles,
                terrain: (R.featTerr[type] || [])[0] || null, biome: (R.featBiome[type] || [])[0] || null });
        }
        out.sort((a, b) => (a.tiles - b.tiles) || a.name.localeCompare(b.name));
    } catch (e) { ERR('getNaturalWonderTypes failed:', e); }
    return out;
}

// Why a Wonder can't be placed at all by this build (null = fine). With the wonder-site patch (part 2) every wonder can
// be tried: multi-tile ones get the tiles of their shape prepared around the clicked anchor (paintWonderSite).
function paintWonderEntryProblem(_type) {
    return null;
}
// 2026-11-02: setTerrain writes only the tile's terrain; the 3D map draws rivers from separate river data (verified in the
// 1.5.0 binary + a third-party save/load probe), so a painted navigable river is never drawn, live or after a reload.
// "painting doesn't change" (not "the panel can't write"): whether this context can reach TerrainBuilder.setRiverInfo is
// still unprobed (paint.api tb.setRiverInfo breadcrumb), so the copy states what the paint does, not an engine limit.
const PAINT_RIVER_WARNING = 'Navigable River changes only the tile\'s terrain. The game draws rivers from separate river data that painting '
    + 'doesn\'t change, so the 3D map won\'t show a river there: not right away and not after a save & reload. The tile tooltip and the '
    + 'panel\'s Map tab show the change. For water that boats can use, paint Coast. To remove the river terrain, paint the tile\'s '
    + 'old terrain back (e.g. Flat or Hills); a forest, marsh, reef or resource that this paint removed does not come back. '
    + 'With "Mark painted river tiles on the 3D map" on (Creative tab), the panel also tints such tiles blue on the 3D map.';

// Enumerates all types in a paint category for the type-picker list. Returns [{type, name, hint}]: `type` is the *Type
// string (e.g. "TERRAIN_GRASS"), `name` the localized label (plus a short tag when the data says the type behaves
// unusually), `hint` the explanation (shown in the Creative status line when the type is selected, and as tooltip).
// GameInfo.{Terrains,Features,Resources,Biomes} are the gameplay tables exposed to the UI isolate.
export function getMapPaintTypes(category) {
    const out = [];
    try {
        const R = paintRules();
        if (category === 'Wonder') {
            for (const w of getNaturalWonderTypes()) {
                const site = [w.biome ? paintName(w.biome) : '', w.terrain ? paintName(w.terrain) : ''].filter(Boolean).join(' ');
                const off = paintWonderEntryProblem(w.type);
                out.push({ type: w.type, name: w.name + (w.tiles > 1 ? ' (' + w.tiles + ' tiles' + (off ? ', not enabled' : '') + ')' : ''),
                    hint: off || ('Becomes ' + (site || 'its own terrain') + (w.tiles > 1 ? '; the clicked tile is the anchor of the ' + w.tiles + '-tile shape' : '') + '.') });
            }
            return out;
        }
        const src = { Terrain: R.terr, Feature: R.feat, Resource: R.res, Biome: R.biome }[category];
        if (!src) { ERR('getMapPaintTypes: unknown category', category); return out; }
        const age = paintAgeType();
        for (const type of Object.keys(src)) {
            if (category === 'Feature' && R.nw[type]) continue;   // natural wonders live in the Wonder category
            let name = src[type].name || type, hint = '';
            if (category === 'Terrain' && type === 'TERRAIN_NAVIGABLE_RIVER') { name += ' (terrain only)'; hint = PAINT_RIVER_WARNING; }
            if (category === 'Feature' && src[type].removable === false) hint = 'The game marks it as non-removable.';
            if (category === 'Resource') {
                const ages = R.resAges[type], tip = paintLocText(src[type].tip);
                const hints = [];
                if (/_DISTANT_LANDS$/.test(type)) { name += ' (Distant Lands)'; hints.push('A separate resource from the plain one with the same name.'); }
                if (!R.resValid[type]) { if (!/_DISTANT_LANDS$/.test(type)) name += ' (special)'; hints.push('No terrain rule in the game data, so the map never places it by terrain; the panel can still paint it.'); }
                else { hints.push('Grows on ' + paintResourceCombos(R.resValid[type]) + '.'); if (ages && age && ages.indexOf(age) < 0) { name += ' (other age)'; hints.push('Not used in the ' + paintAgeName(age) + '.'); } }
                if (tip) hints.push('Game text: ' + tip);
                hint = hints.join(' ');
            }
            out.push({ type, name, hint });
        }
        out.sort((a, b) => a.name.localeCompare(b.name));
        if (category === 'Resource') out.unshift({ type: CLEAR_RESOURCE, name: '(Clear / remove resource)', hint: 'Removes the resource on the clicked tile.' });
        if (category === 'Feature') out.unshift({ type: CLEAR_FEATURE, name: '(Clear / remove feature)', hint: 'Removes the feature; on a natural wonder it removes the whole wonder.' });
    } catch (e) { ERR('getMapPaintTypes failed for', category, e); }
    return out;
}
/** The explanation for one type (same text as its list entry's hint), or '' — for the Creative status line. */
export function paintTypeHint(category, typeString) {
    try { const t = getMapPaintTypes(category).find(x => x.type === typeString); return (t && t.hint) || ''; } catch (_) { return ''; }
}

/**
 * Why a category/type can't be painted at all (null = fine). Checked by the Creative tab BEFORE entering paint
 * mode so an impossible paint fails loudly in the panel instead of on every click.
 */
export function paintEntryProblem(category, typeString) {
    if (!category || !typeString) return 'Pick a type first.';
    if (typeof WorldBuilder === 'undefined' || !WorldBuilder.MapPlots) return 'WorldBuilder is not available in this context.';
    if (category === 'Wonder') return paintWonderEntryProblem(typeString);
    return null;
}
/** A warning to show while painting this type (null = none). Painting is still allowed. */
export function paintEntryWarning(category, typeString) {
    if (category === 'Terrain' && typeString === 'TERRAIN_NAVIGABLE_RIVER') return PAINT_RIVER_WARNING;
    return null;
}

// Re-read the current *Type STRING at a plot for a paint category (write-confirmation). null = none.
// NOT synchronous with the write on build 25516395: a WorldBuilder set* shows up a moment later, so callers
// poll this (paintWaitFor / paintRunBatch) instead of reading it once right after the write.
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

// ── Terrain visual-refresh probe (2026-06-12) and the WorldBuilder block ─────────
// Painting terrain (e.g. mountain → flat) updates the gameplay DATA, but on 1.4.x the 3D terrain mesh did not redraw
// (not even on camera-pan / end-turn, user-confirmed); only save + reload rebuilt it. The executable binds two
// members on the WorldBuilder library: startBlock() / endBlock(), paired engine-side with GameCoreEvent::
// WorldBuilderBlockBegin/End. The 2026-06-12 probe wrapped every paint in a block in case block end refreshes the
// visuals; it did not on 1.4.x. KEPT 2026-10-18: every write verified to land on build 25516395 ran inside a block
// (UI.log 2026-10-18 shows WorldBuilderBlockEnd firing, no freeze). The 2026-07-13 note "startBlock froze the game"
// was misattributed: that probe's own helper looped forever before startBlock ran (lcp-reveal track, 2026-10-18).
// One-time diagnostics (console.error → UI.log) report whether the bindings exist and whether the engine's
// terrain-change events fire. Visual fallbacks: save + reload, or the debug panel's "Rebuild Terrain Cache"
// (EnableDebugPanels is 1 in AppOptions.txt; the string is in the executable — whether it redraws is unverified).
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

// ── Plot state (reads only) ──────────────────────────────────────────
// RiverTypes on 25516395: NO_RIVER = -1, RIVER_MINOR = 0, RIVER_NAVIGABLE = 1 (UI.log 2026-10-18: river=-1 on plain
// tiles, 0 on a minor-floodplain tile at 25/10, 1 on the TERRAIN_NAVIGABLE_RIVER tile at 27/10).
function paintRiverNone() { return (typeof RiverTypes !== 'undefined' && RiverTypes.NO_RIVER !== undefined) ? RiverTypes.NO_RIVER : -1; }
function paintRiverNav() { return (typeof RiverTypes !== 'undefined' && RiverTypes.RIVER_NAVIGABLE !== undefined) ? RiverTypes.RIVER_NAVIGABLE : 1; }
function paintRiverRaw(l) {
    try { const rt = GameplayMap.getRiverType(l.x, l.y); return (typeof rt === 'number') ? rt : null; } catch (_) { return null; }
}
function paintIsRiver(rt) { return rt != null && rt !== paintRiverNone() && rt !== -1; }
function paintHasRiver(l) { return paintIsRiver(paintRiverRaw(l)); }
function paintRiverWord(rt) {
    if (rt == null) return 'unknown';
    if (!paintIsRiver(rt)) return 'none';
    return (rt === paintRiverNav()) ? 'navigable' : 'minor';
}
// 'city' | 'urban' | 'wonder' | 'rural' | 'wild' | 'other' | null (no district). MapCities.getDistrict /
// Districts.get / DistrictTypes are the base world-input.js:202,319 + isDistrictSelectable accessors.
function paintDistrictKind(x, y) {
    let id = null;
    try { id = MapCities.getDistrict(x, y); } catch (_) { return null; }
    if (id == null || (typeof id === 'object' && id.id === -1)) return null;
    let d = null;
    try { d = Districts.get(id); } catch (_) {}
    if (!d) return 'other';
    const T = (typeof DistrictTypes !== 'undefined') ? DistrictTypes : null;
    if (T && d.type === T.CITY_CENTER) return 'city';
    if (T && d.type === T.URBAN) return 'urban';
    if (T && d.type === T.WONDER) return 'wonder';
    if (T && d.type === T.RURAL) return 'rural';
    if (T && d.type === T.WILDERNESS) return 'wild';
    let s = null;
    try { s = GameInfo.Districts.lookup(d.type)?.DistrictType || null; } catch (_) {}
    return ({ DISTRICT_CITY_CENTER: 'city', DISTRICT_URBAN: 'urban', DISTRICT_WONDER: 'wonder', DISTRICT_RURAL: 'rural', DISTRICT_WILDERNESS: 'wild' })[s] || 'other';
}
// elev / lat / cont stay null when this context can't read them, so no reason is built on a made-up 0.
function paintPlotState(loc) {
    const x = loc.x, y = loc.y;
    const rt = paintRiverRaw(loc);
    const s = { x, y, terr: readPaintType('Terrain', loc), biome: readPaintType('Biome', loc), feat: readPaintType('Feature', loc),
        res: readPaintType('Resource', loc), water: false, nw: false, riverType: rt, river: paintIsRiver(rt), lake: false,
        elev: null, lat: null, cont: null, units: 0, district: null, built: 0 };
    try { s.water = !!GameplayMap.isWater(x, y); } catch (_) {}
    try { s.nw = !!GameplayMap.isNaturalWonder(x, y); } catch (_) {}
    try { s.lake = !!GameplayMap.isLake(x, y); } catch (_) {}
    try { if (paintFn(GameplayMap, 'getElevation')) { const e = GameplayMap.getElevation(x, y); if (typeof e === 'number' && isFinite(e)) s.elev = e; } } catch (_) {}
    try { if (paintFn(GameplayMap, 'getPlotLatitude')) { const a = GameplayMap.getPlotLatitude(x, y); if (typeof a === 'number' && isFinite(a)) s.lat = Math.abs(a); } } catch (_) {}
    try { if (paintFn(GameplayMap, 'getContinentType')) { const c = GameplayMap.getContinentType(x, y); if (typeof c === 'number') s.cont = c; } } catch (_) {}
    try { s.units = (MapUnits.getUnits(x, y) || []).length; } catch (_) {}
    try { s.district = paintDistrictKind(x, y); } catch (_) {}
    try { s.built = (MapConstructibles.getConstructibles(x, y) || []).length; } catch (_) {}
    return s;
}
function paintStateText(s) {
    return 'terr=' + s.terr + ',biome=' + s.biome + ',feat=' + s.feat + ',res=' + s.res + ',water=' + s.water + ',nw=' + s.nw
        + ',river=' + s.riverType + ',lake=' + s.lake + ',elev=' + s.elev + ',lat=' + s.lat + ',cont=' + s.cont
        + ',units=' + s.units + ',dist=' + s.district + ',built=' + s.built;
}
function paintAdjacent(loc) {
    const out = [];
    const n = (typeof DirectionTypes !== 'undefined' && DirectionTypes.NUM_DIRECTION_TYPES) ? DirectionTypes.NUM_DIRECTION_TYPES : 6;
    for (let d = 0; d < n; d++) {
        try {
            const a = GameplayMap.getAdjacentPlotLocation(loc, d);
            if (a && Number.isInteger(a.x) && Number.isInteger(a.y) && a.x >= 0 && a.y >= 0 && GameplayMap.isValidLocation(a)) out.push({ x: a.x, y: a.y });
        } catch (_) {}
    }
    return out;
}
/** Every plot within `radius` steps of `loc`, excluding `loc` itself (ring by ring). */
function paintPlotsInRadius(loc, radius) {
    const seen = new Set([paintKey(loc)]);
    const out = [];
    let frontier = [loc];
    for (let ring = 0; ring < radius; ring++) {
        const next = [];
        for (const p of frontier) {
            for (const a of paintAdjacent(p)) {
                const k = paintKey(a);
                if (seen.has(k)) continue;
                seen.add(k); next.push(a); out.push(a);
            }
        }
        frontier = next;
    }
    return out;
}

// ── Engine writes + asynchronous verification ─────────────────────────
function paintResult(status, message, extra) { return Object.assign({ status, message, plots: null }, extra || {}); }
function paintSleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function paintNoFeature() { return (typeof FeatureTypes !== 'undefined' && FeatureTypes.NO_FEATURE !== undefined) ? FeatureTypes.NO_FEATURE : -1; }
function paintNoResource() { return (typeof ResourceTypes !== 'undefined' && ResourceTypes.NO_RESOURCE !== undefined) ? ResourceTypes.NO_RESOURCE : -1; }

// One WorldBuilder write; `type` null = clear (feature/resource). Returns the setter's own bool. That bool is
// logged but is NOT proof the plot changed — only the read-back poll is (the write lands later).
function paintWrite(kind, type, loc, extra) {
    const MP = WorldBuilder.MapPlots;
    const where = { x: loc.x, y: loc.y };
    switch (kind) {
        case 'Terrain': return MP.setTerrain(Database.makeHash(type), where);
        case 'Biome':   return MP.setBiome(Database.makeHash(type), where);
        case 'Feature':
            if (type == null) return MP.setFeature(paintNoFeature(), where);
            if (extra && Number.isInteger(extra.direction) && extra.direction >= 0) return MP.setFeature(Database.makeHash(type), where, extra.direction);
            return MP.setFeature(Database.makeHash(type), where);
        case 'Resource':
            return (type == null) ? MP.setResource(paintNoResource(), where, 0) : MP.setResource(Database.makeHash(type), where, 1);
    }
    throw new Error('paintWrite: unknown kind ' + kind);
}
// Run fn inside a WorldBuilder block when enabled and bound (see PAINT_USE_WB_BLOCK); returns 1 if a block was used.
function paintInBlock(fn) {
    if (PAINT_USE_WB_BLOCK && paintApi().startBlock) { wbEdit(fn); return 1; }
    fn();
    return 0;
}
/** Poll `pred` every PAINT_POLL_MS until it is true or `timeoutMs` passed → {ok, ms, polls}. Checks at once first. */
function paintWaitFor(pred, timeoutMs) {
    const t0 = Date.now();
    return new Promise((resolve) => {
        let polls = 0;
        const tick = () => {
            polls++;
            let ok = false;
            try { ok = !!pred(); } catch (_) { ok = false; }
            const ms = Date.now() - t0;
            if (ok || ms >= timeoutMs) { resolve({ ok, ms, polls }); return; }
            setTimeout(tick, PAINT_POLL_MS);
        };
        tick();
    });
}
// Issue one write per item ({loc, type}) of a single kind (in one WorldBuilder block), then wait until every plot reads
// back its target. One breadcrumb per batch: block used, setter returns (1/0/T=threw/?), landed or not, how long,
// which plots are stuck.
async function paintRunBatch(id, label, kind, items, extra) {
    if (!items || !items.length) return { ok: true, ms: 0, polls: 0, n: 0, rets: [], stuck: [] };
    const rets = [];
    let lastErr = '';
    const blk = paintInBlock(() => {
        for (const it of items) {
            let ret;
            try { ret = paintWrite(kind, it.type, it.loc, it.extra || extra); }
            catch (e) { ret = 'THROW'; lastErr = String((e && e.message) || e); diag('paint.err:' + id + ',stage=' + label + ',' + kind + '@' + it.loc.x + '/' + it.loc.y + ',type=' + it.type + ',' + paintErrText(e)); }
            rets.push(ret === true ? '1' : (ret === false ? '0' : (ret === 'THROW' ? 'T' : '?')));
        }
    });
    if (rets.every(r => r === 'T')) {   // nothing was even queued — fail at once instead of polling for 4 s
        diag('paint.step:' + id + ',' + label + ',' + kind + ',n=' + items.length + ',blk=' + blk + ',ret=' + rets.join('') + ',ok=false,threw=all');
        return { ok: false, ms: 0, polls: 0, n: items.length, rets, stuck: items, threw: lastErr || 'error' };
    }
    const want = (it) => (it.type == null ? null : it.type);
    const w = await paintWaitFor(() => items.every(it => readPaintType(kind, it.loc) === want(it)), PAINT_STEP_TIMEOUT_MS);
    const stuck = w.ok ? [] : items.filter(it => readPaintType(kind, it.loc) !== want(it));
    diag('paint.step:' + id + ',' + label + ',' + kind + ',n=' + items.length + ',to=' + (want(items[0]) || 'none') + ',blk=' + blk + ',ret=' + rets.join('')
        + ',ok=' + w.ok + ',ms=' + w.ms + ',polls=' + w.polls
        + (stuck.length ? ',stuck=' + stuck.slice(0, 6).map(it => it.loc.x + '/' + it.loc.y + ':' + readPaintType(kind, it.loc)).join(';') : ''));
    return { ok: w.ok, ms: w.ms, polls: w.polls, n: items.length, rets, stuck };
}
// "(3,4) still Ice, the game marks it non-removable" for the stuck items of a failed batch (for messages).
function paintStuckText(kind, stuck, R) {
    const parts = [];
    for (const it of (stuck || []).slice(0, 3)) {
        const now = readPaintType(kind, it.loc);
        const F = (kind === 'Feature' && now) ? R.feat[now] : null;
        parts.push(paintAt(it.loc) + ' (still ' + paintName(now) + (F && F.removable === false ? ', which the game marks as non-removable' : '') + ')');
    }
    return parts.join(', ');
}
// One-time: log when the engine's own map-change events arrive (first 3 of each), so the test log shows the
// latency (t= is Date.now(), compare with paint.click t=) and the payload shape.
let _paintEventsHooked = false;
function paintEventProbe() {
    if (_paintEventsHooked) return;
    _paintEventsHooked = true;
    // BiomeTypeChanged is a real bridged event even though gamecore-events.xml omits it. The river / terrain-state /
    // sub-type / block-end hooks (2026-11-02; names verified in Base/modules/core/data/gamecore-events.xml) show which
    // events a paint fires: the in-game 3D view listens to TerrainStateChanged / BiomeTypeChanged, not TerrainTypeChanged.
    const names = ['TerrainTypeChanged', 'BiomeTypeChanged', 'FeatureAddedToMap', 'FeatureRemovedFromMap', 'FeatureChanged',
        'ResourceAddedToMap', 'ResourceRemovedFromMap', 'ResourceChanged',
        'RiverAddedToMap', 'RiverRemovedFromMap', 'TerrainStateChanged', 'TerrainSubTypeChanged', 'WorldBuilderBlockEnd'];
    let hooked = 0;
    for (const n of names) {
        let count = 0;
        try {
            engine.on(n, (data) => {
                if (++count > 3) return;
                let where = '', raw = '';
                try { const l = data && (data.location || data.plot || data.loc); if (l && l.x != null) where = l.x + '/' + l.y; } catch (_) {}
                try { raw = JSON.stringify(data) || ''; if (raw.length > 140) raw = raw.slice(0, 140); } catch (_) {}
                diag('paint.event:' + n + '#' + count + ',@' + where + ',t=' + Date.now() + ',data=' + diagTok(raw, 140));   // 2026-10-21 cross-review: JSON has ',' -> token
            });
            hooked++;
        } catch (e) { diag('paint.event:hook-failed,' + n + ',' + paintErrText(e)); }
    }
    diag('paint.event:hooked=' + hooked + '/' + names.length + ',inst=' + _paintCtxInst);
}

// ── The map generator's own checks (advisory) ─────────────────────────
// null = not available in this context / switched off / threw. Arguments mirror the base scripts.
function paintEngineCanHaveFeature(loc, type) {
    if (!PAINT_USE_ENGINE_CHECKS || !paintApi().canHaveFeature) return null;
    try { return !!TerrainBuilder.canHaveFeature(loc.x, loc.y, type); }   // a type string, as Earth_Huge.js:788 passes
    catch (e) { diag('paint.err:stage=engine-canHaveFeature,' + type + ',' + paintErrText(e)); return null; }
}
function paintEngineCanHaveResource(loc, type) {
    if (!PAINT_USE_ENGINE_CHECKS || !paintApi().canHaveResource) return null;
    const row = paintRules().res[type];
    if (!row || row.index == null) return null;
    try { return !!ResourceBuilder.canHaveResource(loc.x, loc.y, row.index, true); }   // as resource-placement-common.js:431
    catch (e) { diag('paint.err:stage=engine-canHaveResource,' + type + ',' + paintErrText(e)); return null; }
}
function paintEngineWonderCheck(loc, type, nw) {
    if (!PAINT_USE_ENGINE_CHECKS || !paintApi().canHaveFeatureParam) return null;
    let elev = 0;
    try { if (paintApi().getElevation) elev = GameplayMap.getElevation(loc.x, loc.y) | 0; } catch (_) {}
    const param = { Feature: (nw.hash != null) ? nw.hash : Database.makeHash(type), Direction: nw.direction, Elevation: elev };   // natural-wonder-generator.js:52-57
    try { return !!TerrainBuilder.canHaveFeatureParam(loc.x, loc.y, param); }
    catch (e) { diag('nw.err:stage=engine-canHaveFeatureParam,' + type + ',' + paintErrText(e)); return null; }
}

// ── Terrain / Biome / Feature / Resource ──────────────────────────────
function paintPickLandBiome(loc, valid) {
    const count = Object.create(null);
    for (const a of paintAdjacent(loc)) {
        const b = readPaintType('Biome', a);
        if (b && valid.indexOf(b) >= 0) count[b] = (count[b] || 0) + 1;
    }
    let best = null, n = 0;
    for (const b of Object.keys(count)) if (count[b] > n) { best = b; n = count[b]; }
    if (best) return best;
    return (valid.indexOf('BIOME_GRASSLAND') >= 0) ? 'BIOME_GRASSLAND' : valid[0];
}
function paintFeatureFits(feat, terr, biome, R) {
    if (!feat || R.nw[feat]) return true;
    // volcanoes have no Feature_ValidTerrains rows; the map scripts force them onto mountains (volcano-generator.js)
    if (R.feat[feat] && R.feat[feat].pclass === 'VOLCANO' && terr && !(R.terr[terr] && R.terr[terr].mountain)) return false;
    const vt = R.featTerr[feat], vb = R.featBiome[feat];
    if (vt && terr && vt.indexOf(terr) < 0) return false;
    if (vb && biome && vb.indexOf(biome) < 0) return false;
    return true;
}
function paintResourceFitsTerrain(res, terr, R) {
    const rows = R.resValid[res];
    if (!rows || !rows.length) return true;   // no data → leave it alone
    return rows.some(r => !r.t || r.t === terr);
}
function paintResourceFitsTile(res, s, R) {
    const rows = R.resValid[res];
    return !!(rows && rows.some(r => (!r.t || r.t === s.terr) && (!r.b || r.b === s.biome) && (!r.f || r.f === s.feat)));
}
// The generator's latitude rule for features with a Min/MaxLatitude (feature-biome-generator.js:187,204): valid when
// MinLatitude <= |latitude| < MaxLatitude. null when the latitude is unknown or the feature has no such rule.
function paintLatitudeProblem(F, s) {
    if (!F || s.lat == null || !(F.minLat > 0 || F.maxLat > 0)) return null;
    const lo = F.minLat || 0, hi = F.maxLat || 90;
    if (s.lat >= lo && s.lat < hi) return null;
    return 'it only grows between latitude ' + lo + '° and ' + hi + '° (this tile is at ' + Math.round(s.lat) + '°)';
}
// Plain-language "likely reasons" from the placement tables (shown only when the engine did not apply a paint).
function paintFeatureReasons(type, s, R) {
    const why = [];
    const vt = R.featTerr[type], vb = R.featBiome[type], F = R.feat[type] || {}, tags = R.tags[type] || [];
    if (vt && vt.indexOf(s.terr) < 0) why.push('it needs ' + vt.map(paintName).join('/') + ' terrain (this tile is ' + paintName(s.terr) + ')');
    if (vb && vb.indexOf(s.biome) < 0) why.push('it needs ' + vb.map(paintName).join('/') + ' biome (this tile is ' + paintName(s.biome) + ')');
    if (F.pclass === 'VOLCANO' && !(R.terr[s.terr] && R.terr[s.terr].mountain)) why.push('it needs a mountain (this tile is ' + paintName(s.terr) + ')');
    const lat = paintLatitudeProblem(F, s);
    if (lat) why.push(lat);
    const adj = paintAdjacent(s);
    if ((F.pclass === 'RIVERMOUTH' || F.pclass === 'NEARRIVER') && !s.river && !adj.some(paintHasRiver)) why.push('it needs a river (rivers can\'t be painted)');
    if ((F.pclass === 'IN_LAKE' || tags.indexOf('IN_LAKE') >= 0) && !s.lake) why.push('it must be on a lake');
    if (F.pclass === 'COASTAL' && !adj.some(a => { try { return GameplayMap.isWater(a.x, a.y); } catch (_) { return false; } })) why.push('it must touch the coast');
    if (tags.indexOf('NOTADJACENTTOICE') >= 0 && adj.some(a => readPaintType('Feature', a) === 'FEATURE_ICE')) why.push('it must not touch ice');
    const cur = s.feat ? R.feat[s.feat] : null;
    if (cur && cur.removable === false) why.push('the tile holds ' + paintName(s.feat) + ', which the game marks as non-removable');
    if (paintEngineCanHaveFeature(s, type) === false) why.push('the game\'s own placement check (TerrainBuilder.canHaveFeature) says no');
    return why;
}
function paintResourceReasons(type, s, R) {
    const why = [];
    const rows = R.resValid[type], ages = R.resAges[type], age = paintAgeType();
    if (!rows || !rows.length) why.push('this resource has no terrain rule in the data (a special/event resource)');
    else if (!paintResourceFitsTile(type, s, R)) {
        why.push('it grows on ' + paintResourceCombos(rows) + ' (this tile is '
            + [paintName(s.biome), paintName(s.terr), s.feat ? '+' + paintName(s.feat) : ''].filter(Boolean).join(' ') + ')');
    }
    if (ages && age && ages.indexOf(age) < 0) why.push('it is not used in the ' + paintAgeName(age));
    return why;
}

// Decide what a click does: refuse (with the reason), no-op ("already …"), or an ordered list of steps
// ({kind, items:[{loc,type}], say}) — the requested write first, then consistency fixes (biome on a land/water
// change, removing a feature/resource the new tile can't hold) — plus the checks to run once they have landed.
function paintPlan(category, type, loc, s, R) {
    const P = { refuse: null, noop: null, redirectWonder: false, label: paintTypeLabel(category, type), steps: [], notes: [], okText: null, failText: null,
        why: () => [], riverCheck: null, contCheck: false, resourceCheck: false, engineRes: null };
    const step = (kind, t, say, locs) => P.steps.push({ kind, say, items: (locs || [loc]).map(l => ({ loc: l, type: t })) });
    const cityish = s.district === 'city' || s.district === 'urban' || s.district === 'wonder';
    const nwRefusal = () => paintAt(loc) + ' is part of ' + paintName(s.feat) + ' — remove the wonder first (Feature → Clear / remove feature).';
    if (category === 'Terrain') {
        const T = R.terr[type];
        if (!T) { P.refuse = 'Unknown terrain ' + type + '.'; return P; }
        if (s.nw) { P.refuse = nwRefusal(); return P; }
        if (s.terr === type) { P.noop = 'Already ' + P.label + ' at ' + paintAt(loc) + '.'; return P; }
        const curWater = (s.terr && R.terr[s.terr]) ? R.terr[s.terr].water : s.water;
        const domainChange = T.water !== !!curWater;
        if (domainChange || T.mountain) {
            const what = T.mountain ? 'a mountain' : (T.water ? 'water' : 'land');
            if (cityish) { P.refuse = 'A city or district stands on ' + paintAt(loc) + ' — turning it into ' + what + ' would break it.'; return P; }
            if (s.built > 0) { P.refuse = 'A building or improvement is on ' + paintAt(loc) + ' — turning it into ' + what + ' would break it.'; return P; }
            if (s.units > 0) { P.refuse = 'A unit is standing on ' + paintAt(loc) + ' — it would be stranded on ' + what + '. Move it first.'; return P; }
        }
        step('Terrain', type, 'Setting terrain to ' + P.label);
        let biome = s.biome;
        let valid = R.terrBiomes[type] || [];
        // TERRAIN_NAVIGABLE_RIVER has no Biome_ValidTerrains rows; real river tiles carry a land biome (UI.log 2026-10-18
        // LCPD:227: 27/10 TERRAIN_NAVIGABLE_RIVER + BIOME_GRASSLAND), so it takes the land biomes of flat land.
        if (!valid.length && !T.water) valid = R.terrBiomes.TERRAIN_FLAT || [];
        if (valid.length && valid.indexOf(s.biome) < 0) {      // Biome_ValidTerrains: water ⇔ Marine, land ⇔ land biomes
            biome = T.water ? ((valid.indexOf('BIOME_MARINE') >= 0) ? 'BIOME_MARINE' : valid[0]) : paintPickLandBiome(loc, valid);
            step('Biome', biome, 'Setting biome to ' + paintName(biome));
            P.notes.push('biome set to ' + paintName(biome));
        }
        if (s.feat && !paintFeatureFits(s.feat, type, biome, R)) { step('Feature', null, 'Removing ' + paintName(s.feat)); P.notes.push('removed ' + paintName(s.feat)); }
        if (domainChange && s.res && !paintResourceFitsTerrain(s.res, type, R)) { step('Resource', null, 'Removing ' + paintName(s.res)); P.notes.push('removed ' + paintName(s.res)); }
        // After the writes land: does the game's river data follow (it has no UI setter)? Did the continent change?
        // beforeTerr / removed (2026-11-02): the river result names the terrain to paint back and what this paint removed,
        // instead of promising that "Flat" undoes it (Flat restores no feature, resource, hill or water).
        if (type === 'TERRAIN_NAVIGABLE_RIVER' || s.river || s.terr === 'TERRAIN_NAVIGABLE_RIVER') P.riverCheck = { want: (type === 'TERRAIN_NAVIGABLE_RIVER') ? 'nav' : null, before: s.riverType,
            beforeTerr: s.terr || null, removed: P.notes.filter(n => n.indexOf('removed ') === 0).map(n => n.slice(8)) };
        P.contCheck = true;
        return P;
    }
    if (category === 'Biome') {
        if (!R.biome[type]) { P.refuse = 'Unknown biome ' + type + '.'; return P; }
        if (s.nw) { P.refuse = nwRefusal(); return P; }
        if (s.biome === type) { P.noop = 'Already ' + P.label + ' at ' + paintAt(loc) + '.'; return P; }
        const terrs = R.biomeTerr[type] || [];
        const misfit = (s.terr === 'TERRAIN_NAVIGABLE_RIVER') ? (type === 'BIOME_MARINE')
            : (terrs.length > 0 && !!s.terr && terrs.indexOf(s.terr) < 0);
        if (misfit) { P.refuse = P.label + ' can\'t lie on ' + paintName(s.terr) + ' (it goes on ' + terrs.map(paintName).join('/') + '). Paint the terrain first.'; return P; }
        step('Biome', type, 'Setting biome to ' + P.label);
        if (s.feat && !paintFeatureFits(s.feat, s.terr, type, R)) { step('Feature', null, 'Removing ' + paintName(s.feat)); P.notes.push('removed ' + paintName(s.feat)); }
        return P;
    }
    if (category === 'Feature') {
        if (type === CLEAR_FEATURE) {
            const cur = s.feat ? R.feat[s.feat] : null;
            const locked = (cur && cur.removable === false) ? ' (the game marks ' + paintName(s.feat) + ' as non-removable)' : '';
            if (s.nw) {
                const plots = paintWonderPlots(loc, s.feat).all;
                const n = Math.max(1, plots.length);
                P.label = 'removing ' + paintName(s.feat);
                step('Feature', null, 'Removing ' + paintName(s.feat) + ' (' + n + ' tile' + (n > 1 ? 's' : '') + ')', plots.length ? plots : [loc]);
                P.okText = 'Removed ' + paintName(s.feat) + ' (' + n + ' tile' + (n > 1 ? 's' : '') + ')';
                P.failText = 'The game kept ' + paintName(s.feat) + ' — it may not allow removing natural wonders while playing';
                return P;
            }
            if (!s.feat) { P.noop = 'No feature on ' + paintAt(loc) + '.'; return P; }
            P.label = 'removing ' + paintName(s.feat);
            step('Feature', null, 'Removing ' + paintName(s.feat));
            P.okText = 'Removed ' + paintName(s.feat) + ' at ' + paintAt(loc);
            P.failText = 'The game did not remove ' + paintName(s.feat) + ' at ' + paintAt(loc) + locked;
            return P;
        }
        if (R.nw[type]) { P.redirectWonder = true; return P; }
        const F = R.feat[type];
        if (!F) { P.refuse = 'Unknown feature ' + type + '.'; return P; }
        if (s.nw) { P.refuse = nwRefusal(); return P; }
        if (s.feat === type) { P.noop = 'Already ' + P.label + ' at ' + paintAt(loc) + '.'; return P; }
        if (cityish) { P.refuse = 'Features can\'t be painted on the city or district at ' + paintAt(loc) + '.'; return P; }
        if (F.impassable && s.units > 0) { P.refuse = 'A unit is standing on ' + paintAt(loc) + ' and ' + P.label + ' is impassable — move it first.'; return P; }
        step('Feature', type, 'Placing ' + P.label);
        P.okText = P.label + ' placed at ' + paintAt(loc);
        P.why = () => paintFeatureReasons(type, paintPlotState(loc), R);
        return P;
    }
    if (category === 'Resource') {
        if (type === CLEAR_RESOURCE) {
            if (!s.res) { P.noop = 'No resource on ' + paintAt(loc) + '.'; return P; }
            P.label = 'removing ' + paintName(s.res);
            step('Resource', null, 'Removing ' + paintName(s.res));
            P.okText = 'Removed ' + paintName(s.res) + ' at ' + paintAt(loc);
            P.failText = 'The game did not remove ' + paintName(s.res) + ' at ' + paintAt(loc);
            return P;
        }
        if (!R.res[type]) { P.refuse = 'Unknown resource ' + type + '.'; return P; }
        if (s.nw) { P.refuse = 'Natural-wonder tiles can\'t hold resources.'; return P; }
        if (s.res === type) { P.noop = 'Already ' + P.label + ' at ' + paintAt(loc) + '.'; return P; }
        step('Resource', type, 'Placing ' + P.label);
        P.okText = P.label + ' placed at ' + paintAt(loc);
        P.why = () => paintResourceReasons(type, paintPlotState(loc), R);
        // WorldBuilder does not enforce the placement rules (UI.log 2026-10-18: Sugar landed on Plains Flat + Savanna
        // Woodland, LCPD:84 → LCPD:91), so a success gets a note when the tile is off the resource's rules.
        P.resourceCheck = true;
        P.engineRes = s.res ? null : paintEngineCanHaveResource(loc, type);   // asked on the empty tile only
        return P;
    }
    P.refuse = 'Unknown paint category ' + category + '.';
    return P;
}

// What else the game did once the writes landed — river data (no UI setter), continent, resource rules. Each check
// returns {status:'ok'|'warn', note} or null; any 'warn' turns the click orange ("done, with a note").
async function paintRiverPostCheck(id, loc, rc) {
    const nav = paintRiverNav();
    let after = paintRiverRaw(loc), w = { ok: true, ms: 0, polls: 0 };
    // only a navigable river is worth waiting for (minor rivers are plot data a terrain write does not touch)
    if (rc.want === 'nav' || rc.before === nav) {
        w = await paintWaitFor(() => { after = paintRiverRaw(loc); return (rc.want === 'nav') ? after === nav : after !== rc.before; }, PAINT_SETTLE_MS);
    }
    let navFlag = null;
    try { if (paintApi().isNavigableRiver) navFlag = !!GameplayMap.isNavigableRiver(loc.x, loc.y); } catch (_) {}
    diag('paint.river:' + id + ',want=' + (rc.want || 'keep') + ',before=' + rc.before + ',after=' + after + ',isNavigableRiver=' + navFlag + ',settled=' + w.ok + ',ms=' + w.ms);
    // Wording per case (2026-11-02): setTerrain never writes river data, so a painted navigable river is never drawn on
    // the 3D map; the old text said "reports no river here (river type: minor)" when the tile DID have a minor river.
    if (rc.want === 'nav') {
        const word = paintRiverWord(after);
        diag('paint.river.case:' + id + ',' + (after === nav ? (rc.before === nav ? 'real-nav-stays' : 'nav-now') : 'no-nav:' + word));
        if (after === nav) {
            return { status: 'ok', note: (rc.before === nav) ? 'the tile already had a real navigable river, so the river stays'
                                                            : 'the game counts it as a navigable river' };
        }
        // Way back (2026-11-02): name the tile's old terrain instead of "Flat to undo" — Flat brings back no feature,
        // resource, hill or water, and this paint may have removed a forest / reef / resource (P.notes "removed X").
        const oldT = rc.beforeTerr || null;
        let oldWater = false;
        try { const row = oldT ? paintRules().terr[oldT] : null; oldWater = !!(row && row.water); } catch (_) {}
        const removed = Array.isArray(rc.removed) ? rc.removed : [];
        const tail = (oldWater ? '' : '; paint Coast for water that boats can use')
            + '; to remove the river terrain, paint ' + (oldT ? paintName(oldT) : 'the tile\'s old terrain (e.g. Flat)') + ' back'
            + (removed.length ? ' (that does not bring back the removed ' + removed.join(' and ') + ')' : '');
        diag('paint.river.tail:' + id + ',oldTerr=' + diagTok(oldT || 'unknown', 40) + ',oldWater=' + oldWater + ',removed=' + removed.length);
        if (word === 'minor') return { status: 'warn', note: 'but the game has only a minor river here, so the 3D map won\'t show a navigable river (not after a save & reload either) and boats may not be able to use it' + tail };
        if (word === 'unknown') return { status: 'warn', note: 'but the panel could not read the game\'s river data here; a painted navigable river is not drawn on the 3D map (not after a save & reload either)' + tail };
        return { status: 'warn', note: 'but the game has no river here, so the 3D map won\'t show a river (not after a save & reload either) and boats may not be able to use it' + tail };
    }
    if (rc.before === nav && after === nav) return { status: 'warn', note: 'but the navigable river stays: painting doesn\'t remove river data, so the 3D map keeps drawing the river (also after a save & reload)' };
    if (paintIsRiver(rc.before) && after === rc.before) return { status: 'ok', note: 'the ' + paintRiverWord(after) + ' river stays (painting doesn\'t change rivers)' };
    if (after !== rc.before) return { status: 'ok', note: 'river: ' + paintRiverWord(rc.before) + ' → ' + paintRiverWord(after) };
    return null;
}
// Compare continents with the snapshot ([{loc, before}]). Base UI names them via GameInfo.Continents (plot-tooltip
// helpers.js:74-81); natural-wonder tiles normally have none (-1, continent-layer.js:87). A Steam user reported a
// wonder turning its tile into "Africa" (CONTINENT_AFRICA is the first Continents row, maps.xml:58).
function paintContinentCheck(id, tiles) {
    if (!paintApi().getContinentType) return null;
    const changed = [];
    for (const t of tiles) {
        if (t.before == null) continue;
        let now = null;
        try { now = GameplayMap.getContinentType(t.loc.x, t.loc.y); } catch (_) {}
        if (typeof now === 'number' && now !== t.before) changed.push({ loc: t.loc, from: t.before, to: now });
    }
    diag('paint.cont:' + id + ',checked=' + tiles.length + ',changed=' + changed.length
        + (changed.length ? ',' + changed.slice(0, 6).map(c => c.loc.x + '/' + c.loc.y + ':' + c.from + '>' + c.to).join(';') : ''));
    if (!changed.length) return null;
    const c0 = changed[0];
    const note = (changed.length === 1)
        ? 'the game changed the continent of ' + paintAt(c0.loc) + ' from ' + paintContinentName(c0.from) + ' to ' + paintContinentName(c0.to)
        : 'the game changed the continent of ' + changed.length + ' tiles (e.g. ' + paintAt(c0.loc) + ': ' + paintContinentName(c0.from) + ' → ' + paintContinentName(c0.to) + ')';
    return { status: 'warn', note: note + ' — continents decide Distant Lands, and the panel can\'t set them back' };
}
function paintResourceCheck(id, type, loc, P, R) {
    const s = paintPlotState(loc);
    const rows = R.resValid[type];
    const fits = paintResourceFitsTile(type, s, R);
    const ages = R.resAges[type], age = paintAgeType();
    const ageOk = !(ages && age && ages.indexOf(age) < 0);
    diag('paint.resrule:' + id + ',' + type + ',rows=' + (rows ? rows.length : 0) + ',dataFits=' + fits + ',engine=' + P.engineRes + ',ageOk=' + ageOk);
    const notes = [];
    if (!rows || !rows.length) notes.push('it has no terrain rule in the game data (the map never places it by terrain); the game placed it anyway');
    else if (P.engineRes === false || (P.engineRes == null && !fits)) {
        notes.push(fits ? 'the game\'s own placement check says it does not belong on this tile; it was placed anyway'
            : 'it is off its usual terrain (it grows on ' + paintResourceCombos(rows) + '; this tile is '
                + [paintName(s.biome), paintName(s.terr), s.feat ? '+' + paintName(s.feat) : ''].filter(Boolean).join(' ') + '); the game placed it anyway');
    }
    if (!ageOk) notes.push('it is not used in the ' + paintAgeName(age));
    return notes.length ? { status: 'warn', note: 'note: ' + notes.join('; ') } : null;
}
// The empire's resource list for one plot. Steam reports on the public copy (2026-06/07): a painted empire resource
// (Wine) showed up TWICE in the Resources screen and could not be removed; painted Cotton was "not counted". That
// screen lists Players.get(id).Resources.getResources() — entries {value: plot index, uniqueResource:{resource},
// isOffMap} (base commerce-screen-model.js:878,1694-1704,1765-1772). Whether GameCore keeps that list in step with
// WorldBuilder.setResource is unknown (INFERRED from the reports; the old one-shot read-back flashed red on the first
// click, which invited a second write on the same tile). So, for a plot the LOCAL player owns, the panel counts the
// entries for that plot before and after a resource paint, logs both, and notes a duplicate or a stale entry.
// null = not owned by the local player / not readable here. A count of 0 after placing is logged, not reported:
// a resource may only be listed once its tile is worked/improved (INFERRED).
function paintLedgerCount(loc) {
    let owner = -1, me = -1;
    try { owner = GameplayMap.getOwner(loc.x, loc.y); me = GameContext.localPlayerID; } catch (_) { return null; }
    if (typeof owner !== 'number' || owner < 0 || owner !== me) return null;
    try {
        const list = Players.get(owner)?.Resources?.getResources?.();
        if (!list || typeof list.length !== 'number') return null;
        const idx = GameplayMap.getIndexFromLocation(loc);
        let n = 0;
        const kinds = [];
        for (const r of list) {
            if (!r || r.isOffMap || r.value !== idx) continue;
            n++;
            let t = null;
            try { t = GameInfo.Resources.lookup(r.uniqueResource && r.uniqueResource.resource)?.ResourceType || null; } catch (_) {}
            kinds.push(t || '?');
        }
        return { n, total: list.length, kinds };
    } catch (e) { diag('paint.err:stage=ledger,@' + loc.x + '/' + loc.y + ',' + paintErrText(e)); return null; }
}
// After a resource paint on an owned tile: a duplicate entry (placing) or a leftover one (clearing) gets an orange note.
async function paintLedgerCheck(id, loc, before, clearing) {
    if (!before) { diag('paint.ledger:' + id + ',@' + loc.x + '/' + loc.y + ',owned=no'); return null; }
    const bad = (c) => !!c && (clearing ? (c.n > 0 && before.n > 0) : c.n > 1);
    let after = paintLedgerCount(loc), w = { ok: true, ms: 0 };
    // give the game a moment to tidy its list before calling it wrong
    if (bad(after)) w = await paintWaitFor(() => { after = paintLedgerCount(loc); return !bad(after); }, PAINT_SETTLE_MS);
    diag('paint.ledger:' + id + ',@' + loc.x + '/' + loc.y + ',mode=' + (clearing ? 'clear' : 'place') + ',before=' + before.n + '[' + before.kinds.join('/') + ']'
        + ',after=' + (after ? after.n + '[' + after.kinds.join('/') + ']' : 'n/a') + ',total=' + before.total + '>' + (after ? after.total : '?')
        + ',settled=' + w.ok + ',ms=' + w.ms);
    if (!bad(after)) return null;
    const what = after.kinds.map(paintName).join(', ');
    if (clearing) return { status: 'warn', note: 'but your empire\'s resource list still has ' + after.n + ' entr' + (after.n > 1 ? 'ies' : 'y') + ' for this tile ('
        + what + ') — a game bookkeeping quirk Steam users also reported; it may only clear at the next turn' };
    return { status: 'warn', note: 'but your empire\'s resource list now has ' + after.n + ' entries for this tile (' + what
        + '), so the Resources screen may show it twice — a game bookkeeping quirk Steam users also reported' };
}
// A silent re-read of the tile a moment later, so the test log shows anything the engine changes after the paint
// (continent, river) even when it is not reported in the result.
function paintSchedulePostRead(id, loc) {
    setTimeout(() => { try { diag('paint.post:' + id + ',@' + loc.x + '/' + loc.y + ',' + paintStateText(paintPlotState(loc))); } catch (_) {} }, PAINT_POST_READ_MS);
}

async function paintSimpleAsync(id, category, type, loc, progress) {
    const R = paintRules();
    const s = paintPlotState(loc);
    diag('paint.pre:' + id + ',' + paintStateText(s));                                          // STEP 1/4: tile before
    const P = paintPlan(category, type, loc, s, R);                                        // STEP 2/4: decision
    if (P.redirectWonder) { diag('paint.plan:' + id + ',REDIRECT,wonder'); return placeWonderAsync(id, type, loc, progress); }
    diag('paint.plan:' + id + ',' + (P.refuse ? 'REFUSE,' + diagTok(P.refuse, 300) : P.noop ? 'NOOP,' + diagTok(P.noop, 300)
        : 'steps=' + P.steps.map(st => st.kind + ':' + (st.items[0].type || 'none') + 'x' + st.items.length).join('>')
          + (P.riverCheck ? ',riverCheck=' + (P.riverCheck.want || 'keep') : '') + (P.resourceCheck ? ',engineRes=' + P.engineRes : '')));
    if (P.refuse) return paintResult('refused', P.refuse);
    if (P.noop) return paintResult('ok', P.noop, { plots: [loc] });
    const ledger0 = (category === 'Resource') ? paintLedgerCount(loc) : null;              // empire resource list (owned tile)
    const N = P.steps.length;
    for (let i = 0; i < N; i++) {                                                           // STEP 3/4: write + verify each
        const st = P.steps[i];
        progress(st.say + (N > 1 ? ' (' + (i + 1) + '/' + N + ')' : '') + '…');
        const r = await paintRunBatch(id, 'STEP ' + (i + 1) + '/' + N, st.kind, st.items);
        if (r.ok) continue;
        const plots = st.items.map(it => it.loc);
        if (r.threw) return paintResult(i > 0 ? 'partial' : 'fail', 'The game\'s WorldBuilder call failed while ' + st.say.toLowerCase() + ' (' + r.threw + ') — see the LCPD paint.err line in UI.log.', { plots });
        if (i > 0) return paintResult('partial', P.label + ' applied at ' + paintAt(loc) + ', but "' + st.say + '" did not land (tile is now ' + paintName(readPaintType(st.kind, loc)) + ').', { plots });
        let why = [];
        try { why = P.why() || []; } catch (e) { diag('paint.err:' + id + ',stage=why,' + paintErrText(e)); }
        const tail = why.length ? '. Likely: ' + why.join('; ') + '.'
            : P.failText ? '. Try again; if it keeps failing, the game does not allow it from the UI.'
            : '. No placement rule the panel knows says no — the game may be busy; try again.';
        return paintResult('fail', (P.failText || ('The game did not apply ' + P.label + ' at ' + paintAt(loc))) + ' (waited ' + paintSecs(r.ms) + ')' + tail,
            { plots, late: { status: 'ok', verify: () => st.items.every(it => readPaintType(st.kind, it.loc) === (it.type == null ? null : it.type)),
                text: (P.okText || (P.label + ' painted at ' + paintAt(loc))) + ' after all (the game was slow to apply it).' } });
    }
    // STEP 4/4: what else the game did (river data, continent, resource rules) → notes on the result
    const notes = P.notes.slice();
    let warn = false;
    const add = (c) => { if (!c) return; if (c.status === 'warn') warn = true; if (c.note) notes.push(c.note); };
    try {
        if (P.riverCheck) { progress('Checking what the game made of the river…'); add(await paintRiverPostCheck(id, loc, P.riverCheck)); }
        if (P.contCheck) add(paintContinentCheck(id, [{ loc, before: s.cont }]));
        if (P.resourceCheck) add(paintResourceCheck(id, type, loc, P, R));
        if (category === 'Resource') add(await paintLedgerCheck(id, loc, ledger0, type === CLEAR_RESOURCE));
    } catch (e) { diag('paint.err:' + id + ',stage=post,' + paintErrText(e)); }
    paintSchedulePostRead(id, loc);
    const first = P.steps[0];
    const plots = (first && first.items.length > 1) ? first.items.map(it => it.loc) : [loc];
    return paintResult(warn ? 'warn' : 'ok', (P.okText || (P.label + ' painted at ' + paintAt(loc))) + (notes.length ? ' — ' + notes.join('; ') : '') + '.', { plots });
}

// ── Natural wonders ───────────────────────────────────────────────────
// Plots of the wonder covering `loc`. Returns the plots that really hold `type` (a flood fill over adjacent
// tiles carrying the same feature), with two extra properties: .reported = the engine's own plot set from
// MapFeatures.getFeatureInfoAt(index).plots (as base cinematic-manager.js:292-297 reads it — it may be empty) and
// .all = the union of both (what a removal must clear / what a placement used).
function paintWonderPlots(loc, type) {
    const toLoc = (p) => {
        try { const l = (typeof p === 'number') ? GameplayMap.getLocationFromIndex(p) : p; return (l && Number.isInteger(l.x) && Number.isInteger(l.y)) ? { x: l.x, y: l.y } : null; }
        catch (_) { return null; }
    };
    const reported = [];
    try {
        if (typeof MapFeatures !== 'undefined' && MapFeatures && typeof MapFeatures.getFeatureInfoAt === 'function') {
            const info = MapFeatures.getFeatureInfoAt(GameplayMap.getIndexFromLocation(loc));
            const plots = info && info.plots;
            if (plots && typeof plots.length === 'number') {
                for (let i = 0; i < plots.length && reported.length < 12; i++) { const l = toLoc(plots[i]); if (l) reported.push(l); }
            }
        }
    } catch (e) { diag('nw.err:stage=footprint,' + paintErrText(e)); }
    const out = [], seen = new Set();
    const add = (l) => {
        if (!l) return false;
        const k = paintKey(l);
        if (seen.has(k)) return false;
        if (type && readPaintType('Feature', l) !== type) return false;
        seen.add(k); out.push({ x: l.x, y: l.y });
        return true;
    };
    add(loc);
    for (const l of reported) add(l);
    const queue = out.slice();
    while (queue.length && out.length < 8) {
        const p = queue.shift();
        for (const a of paintAdjacent(p)) if (add(a)) queue.push(a);
    }
    const all = out.slice();
    for (const l of reported) if (!seen.has(paintKey(l))) { seen.add(paintKey(l)); all.push(l); }
    out.reported = reported;
    out.all = all;
    return out;
}
// Likely reasons the engine refused a wonder, from Feature_NaturalWonders/Features/TypeTags. The tag meanings
// are read from their names (INFERRED); evaluated on the PREPARED site, before it is restored. `eng` is the
// generator's own check (TerrainBuilder.canHaveFeatureParam) on the prepared site: false/true/null (not available).
function paintWonderReasons(type, loc, s0, R, nw, F, eng) {
    const why = [];
    const tags = R.tags[type] || [];
    const vBiome = R.featBiome[type] || [];
    const isMountainTerr = (t) => !!(t && R.terr[t] && R.terr[t].mountain);
    const adj = paintAdjacent(loc).map(a => {
        const terr = readPaintType('Terrain', a);
        let mtn = isMountainTerr(terr);
        try { mtn = mtn || !!GameplayMap.isMountain(a.x, a.y); } catch (_) {}
        return { terr, mountain: mtn, biome: readPaintType('Biome', a), feat: readPaintType('Feature', a),
            water: (() => { try { return !!GameplayMap.isWater(a.x, a.y); } catch (_) { return false; } })(), river: paintHasRiver(a) };
    });
    if (eng === false) why.push('the game\'s own placement check (the one the map generator uses) says no');
    if (nw.noRiver && s0.river) why.push('this tile has a river and the wonder must not');
    if (F.noLake && s0.lake) why.push('it can\'t sit on a lake');
    if (F.minElev && s0.elev != null && s0.elev < F.minElev) why.push('the elevation here is ' + s0.elev + ', it needs at least ' + F.minElev);
    if (F.maxElev && s0.elev != null && s0.elev > F.maxElev) why.push('the elevation here is ' + s0.elev + ', it allows at most ' + F.maxElev);
    if ((F.minElev || F.maxElev) && s0.elev == null) why.push('it has an elevation rule (' + (F.minElev ? 'at least ' + F.minElev : 'at most ' + F.maxElev) + ') the panel can\'t read here');
    const lat = paintLatitudeProblem(F, s0);
    if (lat) why.push(lat);
    for (const tag of tags) {
        if (tag === 'WATERFALL' && !s0.river && !adj.some(a => a.river)) why.push('a waterfall needs a river on or next to the tile (rivers can\'t be painted)');
        else if (tag === 'ADJACENTMOUNTAIN' && !adj.some(a => a.mountain)) why.push('it needs a mountain next to it');
        else if (tag === 'NOTADJACENTMOUNTAIN') { const n = adj.filter(a => a.mountain).length; if (n) why.push('it must not touch a mountain (' + n + ' next to it)'); }
        else if (tag === 'ADJACENTTOSAMEBIOME' && vBiome.length) { const n = adj.filter(a => !a.water && vBiome.indexOf(a.biome) < 0).length; if (n) why.push('the land around it must be ' + vBiome.map(paintName).join('/') + ' too (' + n + ' tile' + (n > 1 ? 's are' : ' is') + ' not)'); }
        else if (tag === 'NOTNEARCOAST' && paintPlotsInRadius(loc, 2).some(l => { try { return GameplayMap.isWater(l.x, l.y); } catch (_) { return false; } })) why.push('it must be away from the coast (water within 2 tiles)');
        else if (tag === 'ADJACENTTOLAND' && !adj.some(a => !a.water)) why.push('it must touch land');
        else if (tag === 'NOTADJACENTTOLAND' && adj.some(a => !a.water)) why.push('it must not touch land');
        else if (tag === 'ADJACENTTOCOAST' && !adj.some(a => a.terr === 'TERRAIN_COAST')) why.push('it must touch shallow coast');
        else if (tag === 'NOTADJACENTTOICE' && adj.some(a => a.feat === 'FEATURE_ICE')) why.push('it must not touch ice');
        else if (tag === 'NOTADJACENTTORIVER' && adj.some(a => a.river)) why.push('it must not touch a river');
        else if (tag === 'IN_LAKE' && !s0.lake) why.push('it must be on a lake');
    }
    if (nw.tiles > 1) why.push('its ' + nw.tiles + '-tile shape has to fit next to the clicked tile');
    return why;
}
// Put site tiles back to their snapshot (t.s). ORDER (2026-10-18 review): first take the feature off EVERY site tile
// (candidates and helpers alike: the engine may have stamped the wonder on any of them, maybe only after this restore
// was queued) plus `extra` (tiles the engine stamped outside the site), and wait for that, so the terrain/biome writes
// never meet a wonder tile (the panel itself refuses those paints on wonder tiles; the engine may too). Then terrain,
// biome, the original features (every site tile with one gets it back: each changed its ground or lost its feature)
// and the resources. Writes go out WITHOUT reading the tile first, so a write still in flight — the wonder itself
// included — is overwritten too (the queue runs in order — INFERRED).
// opts.skipWonderOff: skip the first phase — the wonder was never written (prep failed), or it was placed and these
// spare tiles are not part of it.
async function paintRestoreSite(id, tiles, extra, opts) {
    const o = opts || {};
    let ok = true;
    const ground = (t) => t.tT !== t.s.terr || t.tB !== t.s.biome;
    const off = [];
    if (!o.skipWonderOff) {
        const seen = new Set();
        const add = (l) => { const k = paintKey(l); if (!seen.has(k)) { seen.add(k); off.push({ loc: l, type: null }); } };
        for (const t of tiles) add(t.loc);
        for (const l of (extra || [])) add(l);
    }
    const steps = [
        ['wonder off', 'Feature', off],
        ['terrain', 'Terrain', tiles.filter(t => t.s.terr && t.tT !== t.s.terr).map(t => ({ loc: t.loc, type: t.s.terr }))],
        ['biome', 'Biome', tiles.filter(t => t.s.biome && t.tB !== t.s.biome).map(t => ({ loc: t.loc, type: t.s.biome }))],
        ['features', 'Feature', tiles.filter(t => t.s.feat && (off.length > 0 || t.cand || t.clearFeat || ground(t))).map(t => ({ loc: t.loc, type: t.s.feat }))],
        ['resources', 'Resource', tiles.filter(t => t.s.res && (t.clearRes || ground(t))).map(t => ({ loc: t.loc, type: t.s.res }))],
    ];
    for (let i = 0; i < steps.length; i++) {
        const what = steps[i][0], kind = steps[i][1], items = steps[i][2];
        if (!items.length) continue;
        const r = await paintRunBatch(id, 'restore ' + (i + 1) + '/' + steps.length + ' ' + what, kind, items);
        if (!r.ok) ok = false;
    }
    diag('nw.restore:' + id + ',tiles=' + tiles.length + ',extra=' + (extra ? extra.length : 0) + ',wonderOff=' + off.length + ',ok=' + ok);
    return ok;
}
// One site tile: snapshot + the terrain/biome the wonder needs (tT/tB) + what to clear.
function paintWonderCand(l, s, anchor, o) {
    return { loc: l, s, anchor, cand: true, helper: false, clearFeat: !!s.feat, clearRes: !!s.res,
        tT: (!o.vTerr.length || o.vTerr.indexOf(s.terr) >= 0) ? s.terr : o.vTerr[0],
        tB: (!o.vBiome.length || o.vBiome.indexOf(s.biome) >= 0) ? s.biome : o.vBiome[0] };
}
// The tiles a placement prepares (wonder-site patch): the anchor plus the tiles the shape may use — ring 1 for 2-3-tile
// wonders, rings 1-2 for 4-tile ones — each set to the wonder's terrain + biome with its feature/resource cleared, then
// helper neighbours for the site rules (paintWonderHelpers). A ring tile is left out when it holds a city, district,
// improvement, another wonder, a river the wonder can't have, a unit under an impassable wonder, the other domain
// (land/water), or a feature the game marks as non-removable (clearing it may be refused — 2026-10-18 review).
// Nothing at all is reshaped when the game's own check accepts the clicked tile as it is (o.asIs).
function paintWonderSite(id, loc, s0, type, R, nw, F, o) {
    const a = paintWonderCand(loc, s0, true, o);
    if (o.asIs) { a.tT = s0.terr; a.tB = s0.biome; return { site: [a], blocked: 0, helpers: 0, refuse: null }; }
    const site = [a];
    const why = Object.create(null);
    const blockedTiles = [];                    // kept so a footprint that still covers one can be reported
    let blocked = 0;
    const radius = nw.tiles >= 4 ? 2 : (nw.tiles >= 2 ? 1 : 0);
    for (const l of (radius ? paintPlotsInRadius(loc, radius) : [])) {
        const s = paintPlotState(l);
        const no = paintSiteBlockReason(s, R, nw, F, o.waterWonder);
        if (!no) site.push(paintWonderCand(l, s, false, o));
        else { blocked++; why[no] = (why[no] || 0) + 1; blockedTiles.push({ loc: l, s, why: no }); }
    }
    const whyText = Object.keys(why).map(k => why[k] + ' ' + k).join(', ');
    if (blocked) diag('nw.site:' + id + ',blocked=' + blocked + ',' + diagTok(whyText, 300));
    if (site.length < nw.tiles) {
        return { site, blocked, helpers: 0, refuse: 'Not enough room for the ' + nw.tiles + '-tile ' + paintName(type) + ' at ' + paintAt(loc) + ': only '
            + site.length + ' usable ' + (o.waterWonder ? 'water' : 'land') + ' tile' + (site.length > 1 ? 's' : '') + ' here'
            + (whyText ? ' (blocked: ' + whyText + ')' : '') + '.' };
    }
    const helpers = paintWonderHelpers(site, loc, type, R, o.waterWonder, o.vBiome);
    return { site, blocked, helpers, refuse: null, blockedTiles };
}
function paintSiteBlockReason(s, R, nw, F, waterWonder) {
    if (!s.terr) return 'off the map';
    if (s.nw) return 'other wonder';
    if (s.district) return 'city/district';
    if (s.built > 0) return 'improvement';
    if (s.units > 0 && F.impassable) return 'unit';
    if (s.water !== waterWonder) return waterWonder ? 'land' : 'water';
    if (s.terr === 'TERRAIN_NAVIGABLE_RIVER') return 'navigable river';
    if (nw.noRiver && s.river) return 'river';
    const f = s.feat ? R.feat[s.feat] : null;
    if (f && f.removable === false) return 'non-removable ' + paintName(s.feat);
    return null;
}
// Neighbour "scaffolding" for the site rules the panel CAN satisfy for a moment (tag meanings INFERRED from their
// names): ADJACENTTOSAMEBIOME → give the land around the anchor the wonder's biome, NOTADJACENTMOUNTAIN → mountains
// next to it become hills, ADJACENTMOUNTAIN → one free neighbour becomes a mountain. These helper tiles are restored
// right after the wonder is placed (or refused). Tiles holding a feature the game marks as non-removable (ice,
// volcanoes) are never reshaped, so NOTADJACENTTOICE stays a "likely reason" only — like rivers, coast distance and
// elevation, which the UI can't change.
function paintWonderHelpers(site, loc, type, R, waterWonder, vBiome) {
    const tags = R.tags[type] || [];
    const byKey = new Map(site.map(t => [paintKey(t.loc), t]));
    const tileAt = (l) => {
        const k = paintKey(l);
        let t = byKey.get(k);
        if (!t) {
            const s = paintPlotState(l);
            if (s.nw || !s.terr || s.district || s.built > 0) return null;   // never touch wonders, cities, districts, improvements
            const f = s.feat ? R.feat[s.feat] : null;
            if (f && f.removable === false) return null;                     // nor ice / volcanoes
            t = { loc: l, s, cand: false, helper: true, tT: s.terr, tB: s.biome, clearFeat: false, clearRes: false };
            byKey.set(k, t); site.push(t);
        }
        return t;
    };
    const isMtn = (terr) => !!(terr && R.terr[terr] && R.terr[terr].mountain);
    const ring = paintAdjacent(loc);
    if (!waterWonder && vBiome.length && tags.indexOf('ADJACENTTOSAMEBIOME') >= 0) {
        const okOn = R.biomeTerr[vBiome[0]] || [];
        for (const l of ring) {
            const t = tileAt(l);
            if (!t || t.s.water || t.anchor) continue;
            if (t.tB !== vBiome[0] && (!okOn.length || okOn.indexOf(t.tT) >= 0)) t.tB = vBiome[0];
        }
    }
    if (tags.indexOf('NOTADJACENTMOUNTAIN') >= 0) {
        for (const l of ring) { const t = tileAt(l); if (t && !t.anchor && isMtn(t.tT)) t.tT = 'TERRAIN_HILL'; }
    }
    if (tags.indexOf('ADJACENTMOUNTAIN') >= 0 && !ring.some(l => { const t = tileAt(l); return t && isMtn(t.tT); })) {
        const free = (t) => t && !t.anchor && !t.s.water && !t.s.units && !t.s.district && !t.s.built && t.s.terr !== 'TERRAIN_NAVIGABLE_RIVER';
        const pick = ring.map(tileAt).filter(free).sort((a, b) => (a.cand ? 1 : 0) - (b.cand ? 1 : 0))[0];   // prefer a non-candidate
        if (pick) { pick.tT = 'TERRAIN_MOUNTAIN'; pick.cand = false; pick.helper = true; }
    }
    // keep only helpers that actually change something (unchanged ones were just looked at)
    const idle = (t) => t.helper && t.tT === t.s.terr && t.tB === t.s.biome && !t.clearFeat && !t.clearRes;
    for (let i = site.length - 1; i >= 0; i--) if (idle(site[i])) site.splice(i, 1);
    return site.filter(t => t.helper).length;
}
// What the engine laid down (wonder-site patch). Polls until the shape is complete — the other tiles may show up a
// moment after the anchor, and MapFeatures.getFeatureInfoAt may report no plots (base cinematic-manager.js:292-297
// allows that) — or PAINT_FOOTPRINT_WAIT_MS passed. An incomplete shape is taken out again rather than left broken.
async function paintWonderFootprint(id, loc, type, nw, site, name, progress) {
    let scan = paintWonderPlots(loc, type);
    const count = (sc) => Math.max(sc.length, sc.reported.length);
    if (nw.tiles > 1) {
        const w = await paintWaitFor(() => { scan = paintWonderPlots(loc, type); return count(scan) >= nw.tiles; }, PAINT_FOOTPRINT_WAIT_MS);
        diag('nw.footprint.wait:' + id + ',ok=' + w.ok + ',ms=' + w.ms + ',polls=' + w.polls);
    }
    const foot = scan.all, placed = count(scan);
    diag('nw.footprint:' + id + ',holding=' + scan.length + ',reported=' + scan.reported.length + ',need=' + nw.tiles + ',plots=' + foot.map(p => p.x + '/' + p.y).join(';'));
    if (nw.tiles > 1 && placed < nw.tiles) {
        // Only part of the shape was stamped: take it out again (wonder first, from every tile that holds it) and restore.
        progress('Removing the incomplete ' + name + '…');
        const outside = foot.filter(p => !site.some(t => paintKey(t.loc) === paintKey(p)));
        const restored = await paintRestoreSite(id, site, outside);
        return { foot, fail: paintResult('fail', 'The game placed only ' + placed + ' of the ' + nw.tiles + ' tiles of ' + name + ' at ' + paintAt(loc)
            + ', so it was removed again. ' + (restored ? 'Tiles restored.' : 'Restore not confirmed — check the tiles.'), { plots: foot.length ? foot : [loc] }) };
    }
    return { foot: foot.length ? foot : [loc], fail: null };
}

async function placeWonderAsync(id, type, loc, progress) {
    const R = paintRules();
    const nw = R.nw[type], F = R.feat[type] || {};
    const name = paintName(type);
    if (!nw) return paintResult('refused', name + ' is not a natural wonder in this game.');
    const entry = paintWonderEntryProblem(type);
    if (entry) { diag('nw.plan:' + id + ',REFUSE,' + diagTok(entry, 300)); return paintResult('refused', entry); }
    if (_wonderBusy) return paintResult('busy', 'Another natural wonder is still being placed — wait a moment, then click again.');
    _wonderBusy = true;
    try {
        const vTerr = R.featTerr[type] || [], vBiome = R.featBiome[type] || [];
        const waterWonder = vTerr.length > 0 && vTerr.every(t => R.terr[t] && R.terr[t].water);
        const s0 = paintPlotState(loc);
        diag('nw.pre:' + id + ',' + type + ',tiles=' + nw.tiles + ',dir=' + nw.direction + ',noRiver=' + nw.noRiver + ',pclass=' + F.pclass
            + ',vTerr=' + vTerr.join('/') + ',vBiome=' + vBiome.join('/') + ',tags=' + (R.tags[type] || []).join('/') + ',' + paintStateText(s0));

        // STEP 1/6 — refuse what the panel must not or cannot change.
        let refuse = null;
        if (s0.nw) refuse = paintAt(loc) + ' is already part of ' + paintName(s0.feat) + ' — remove it first (Feature → Clear / remove feature).';
        else if (s0.district === 'city' || s0.district === 'urban' || s0.district === 'wonder' || s0.built > 0) refuse = 'A city, district or improvement is on ' + paintAt(loc) + ' — natural wonders can\'t go there.';
        else if (s0.units > 0 && F.impassable) refuse = 'A unit is standing on ' + paintAt(loc) + ' — move it first (' + name + ' is impassable).';
        else if (vTerr.length && waterWonder !== !!s0.water) refuse = name + ' is a ' + (waterWonder ? 'water' : 'land') + ' wonder — click a ' + (waterWonder ? vTerr.map(paintName).join('/') : 'land') + ' tile.';
        else if (!waterWonder && s0.terr === 'TERRAIN_NAVIGABLE_RIVER') refuse = paintAt(loc) + ' is a navigable river — pick a dry-land tile.';
        if (refuse) { diag('nw.plan:' + id + ',REFUSE,' + diagTok(refuse, 300)); return paintResult('refused', refuse); }

        // STEP 2/6 — the generator's own check on the tile as it is (only if this UI context exposes it).
        const eng0 = paintEngineWonderCheck(loc, type, nw);
        diag('nw.engine:' + id + ',stage=as-is,canHaveFeatureParam=' + eng0);

        // STEP 3/6 — the site to prepare.
        const S = paintWonderSite(id, loc, s0, type, R, nw, F, { vTerr, vBiome, waterWonder, asIs: eng0 === true });
        const site = S.site;
        diag('nw.plan:' + id + ',' + (S.refuse ? 'REFUSE,' + diagTok(S.refuse, 300) : 'site=' + site.length + ',candidates=' + site.filter(t => t.cand).length
            + ',helpers=' + S.helpers + ',blocked=' + S.blocked + ',asIs=' + (eng0 === true) + ',changes=' + site.filter(t => t.tT !== t.s.terr || t.tB !== t.s.biome || t.clearFeat || t.clearRes)
                .map(t => t.loc.x + '/' + t.loc.y + (t.tT !== t.s.terr ? ':T>' + t.tT : '') + (t.tB !== t.s.biome ? ':B>' + t.tB : '') + (t.clearFeat ? ':-F' : '') + (t.clearRes ? ':-R' : '')).join(';')));
        if (S.refuse) return paintResult('refused', S.refuse);

        // STEP 4/6 — prepare the site one kind at a time; each kind waits until it has landed, so the wonder is
        // never judged against a half-prepared tile.
        progress('Preparing ' + site.length + ' tile' + (site.length > 1 ? 's' : '') + ' for ' + name + '…');
        const prep = [
            ['Terrain', site.filter(t => t.tT !== t.s.terr).map(t => ({ loc: t.loc, type: t.tT }))],
            ['Biome', site.filter(t => t.tB !== t.s.biome).map(t => ({ loc: t.loc, type: t.tB }))],
            ['Feature', site.filter(t => t.clearFeat).map(t => ({ loc: t.loc, type: null }))],
            ['Resource', site.filter(t => t.clearRes).map(t => ({ loc: t.loc, type: null }))],
        ];
        for (let i = 0; i < prep.length; i++) {
            const kind = prep[i][0], items = prep[i][1];
            const r = await paintRunBatch(id, 'nw prep ' + (i + 1) + '/' + prep.length, kind, items);
            if (r.ok) continue;
            const stuck = paintStuckText(kind, r.stuck, R);
            progress('Restoring the tiles…');
            const restored = await paintRestoreSite(id, site, [], { skipWonderOff: true });   // the wonder was never written
            return paintResult('fail', 'Could not prepare the site for ' + name + ': the ' + kind.toLowerCase() + ' change did not land'
                + (stuck ? ' at ' + stuck : '') + ' within ' + paintSecs(r.ms) + '. ' + (restored ? 'Tiles restored.' : 'Restore not confirmed — check the tiles.'), { plots: site.map(t => t.loc) });
        }

        // STEP 5/6 — the generator's check on the prepared site, then ONE feature write on the anchor with the
        // wonder's Direction (-1 = let the engine orient it, so the optional argument is left out).
        const eng1 = (eng0 === true) ? true : paintEngineWonderCheck(loc, type, nw);
        diag('nw.api:' + id + ',TerrainBuilder=' + (typeof TerrainBuilder) + ',MapFeatures.getFeatureInfoAt='
            + ((typeof MapFeatures !== 'undefined' && MapFeatures) ? typeof MapFeatures.getFeatureInfoAt : 'n/a') + ',engine.prepared=' + eng1);
        progress('Placing ' + name + '…');
        let ret;
        const blk = paintInBlock(() => {
            try { ret = paintWrite('Feature', type, loc, { direction: nw.direction }); }
            catch (e) { ret = 'THROW'; diag('nw.err:' + id + ',stage=place,' + paintErrText(e)); }
        });
        const w = await paintWaitFor(() => readPaintType('Feature', loc) === type, PAINT_STEP_TIMEOUT_MS);
        let isNW = false;
        try { isNW = !!GameplayMap.isNaturalWonder(loc.x, loc.y); } catch (_) {}
        diag('nw.place:' + id + ',ret=' + ret + ',blk=' + blk + ',dir=' + (nw.direction >= 0 ? nw.direction : 'auto') + ',landed=' + w.ok + ',isNW=' + isNW + ',ms=' + w.ms + ',polls=' + w.polls);
        if (!w.ok) {
            const why = paintWonderReasons(type, loc, s0, R, nw, F, eng1);
            progress('Restoring the tiles…');
            const restored = await paintRestoreSite(id, site, []);
            return paintResult('fail', 'The game refused ' + name + ' at ' + paintAt(loc) + (why.length ? ' — likely: ' + why.join('; ') : '') + '. '
                + (restored ? 'Tiles restored.' : 'Restore not confirmed — check the tiles.'), { plots: [loc],
                // a refused write may still land after the restore (GameCore busy): look once more and say so
                late: { status: 'warn', verify: () => site.map(t => t.loc).concat(paintPlotsInRadius(loc, 2)).some(l => readPaintType('Feature', l) === type),
                    text: name + ' appeared at ' + paintAt(loc) + ' after all, after the panel had put the tiles back (the game was slow) — '
                        + 'remove it with Feature → (Clear / remove feature) if it looks wrong' } });
        }

        // STEP 6/6 — the footprint the engine laid down; give back every prepared tile it does not use.
        const FP = await paintWonderFootprint(id, loc, type, nw, site, name, progress);
        if (FP.fail) return FP.fail;
        const foot = FP.foot;
        const used = new Set(foot.map(paintKey));
        const spare = site.filter(t => !used.has(paintKey(t.loc)));
        let spareOk = true;
        if (spare.length) {
            progress('Restoring ' + spare.length + ' surrounding tile' + (spare.length > 1 ? 's' : '') + '…');
            spareOk = await paintRestoreSite(id, spare, [], { skipWonderOff: true });
        }
        const notes = [];
        if (eng1 === false) notes.push('the game\'s own placement check had said no');
        // Tiles the engine's shape covers that the panel did not prepare (it picks the shape itself): say which, and what
        // they held when the panel had left them alone (a city, a unit, a volcano…).
        const outside = foot.filter(p => !site.some(t => paintKey(t.loc) === paintKey(p)));
        if (outside.length) {
            const held = (p) => { const b = (S.blockedTiles || []).find(t => paintKey(t.loc) === paintKey(p)); return b ? ' (it had: ' + b.why + ')' : ''; };
            diag('nw.outside:' + id + ',n=' + outside.length + ',' + outside.map(p => p.x + '/' + p.y + held(p)).join(';'));
            notes.push('the game\'s shape also covers ' + outside.slice(0, 3).map(p => paintAt(p) + held(p)).join(', ') + ', which the panel had not prepared');
        }
        const snap = site.map(t => ({ loc: t.loc, before: t.s.cont }))                                // tiles with a snapshot
            .concat((S.blockedTiles || []).filter(b => used.has(paintKey(b.loc))).map(b => ({ loc: b.loc, before: b.s.cont })));
        const cont = paintContinentCheck(id, snap);
        if (cont) notes.push(cont.note);
        paintSchedulePostRead(id, loc);
        const status = !spareOk ? 'partial' : ((cont || outside.length) ? 'warn' : 'ok');
        return paintResult(status, 'Placed ' + name + (foot.length > 1 ? ' (' + foot.length + ' tiles)' : '') + ' at ' + paintAt(loc)
            + (spareOk ? '' : ' — some surrounding tiles may still show the prepared terrain') + (notes.length ? ' — ' + notes.join('; ') : '') + '.', { plots: foot });
    } finally {
        _wonderBusy = false;
    }
}

/**
 * Paint one plot. Resolves (never rejects) to {seq, status, message, plots, ms}:
 *   status 'ok' (applied, verified by read-back) | 'warn' (applied, with a note: off-rule resource, river data, continent) |
 *   'partial' (main write landed, a follow-up step did not) | 'fail' (the engine did not apply it; message carries the
 *   likely reason) | 'refused' (nothing written — message says why) | 'busy' (an earlier paint on the same tile /
 *   another wonder is still in flight).
 * opts.onProgress(text) narrates the steps; opts.onLate(result) fires if a timed-out write lands later.
 */
export function paintPlotAsync(category, typeString, loc, opts = {}) {
    const id = ++_paintSeq;
    const t0 = Date.now();
    const progress = (m) => { try { if (opts.onProgress) opts.onProgress(m); } catch (_) {} };
    diag('paint.click:' + id + ',' + category + '=' + typeString + ',@' + (loc ? loc.x + '/' + loc.y : '?') + ',t=' + t0);
    const run = async () => {
        if (!guardSP()) return paintResult('refused', 'Cheats are disabled in multiplayer games.');
        if (!loc || !Number.isInteger(loc.x) || !Number.isInteger(loc.y)) return paintResult('refused', 'That is not a map tile.');
        const entry = paintEntryProblem(category, typeString);
        if (entry) return paintResult('refused', entry);
        const key = paintKey(loc);
        if (_paintBusyPlots.has(key)) return paintResult('busy', 'Still applying the previous paint on ' + paintAt(loc) + ' — wait a moment.');
        _paintBusyPlots.add(key);
        try {
            paintApi();
            paintEventProbe();
            return (category === 'Wonder') ? await placeWonderAsync(id, typeString, loc, progress)
                                           : await paintSimpleAsync(id, category, typeString, loc, progress);
        } finally { _paintBusyPlots.delete(key); }
    };
    return run().catch((e) => {
        diag('paint.err:' + id + ',stage=top,cat=' + category + ',type=' + typeString + ',' + paintErrText(e));
        return paintResult('fail', 'Internal error while painting: ' + String((e && e.message) || e));
    }).then((res) => {
        res.seq = id;
        res.t0 = t0;
        res.ms = Date.now() - t0;
        diag('paint.done:' + id + ',status=' + res.status + ',ms=' + res.ms + ',msg=' + diagTok(res.message, 300));
        paintRecordResult(res);
        if (res.late && typeof res.late.verify === 'function') paintScheduleLateCheck(id, res, opts);
        proAfterPaint(res);   // redraw the painted-river marker (scheduled, try/catch'ed; skips refused / busy)
        return res;
    });
}
// A write that timed out may still land (GameCore busy during AI turns): re-read once more and report it.
function paintScheduleLateCheck(id, res, opts) {
    setTimeout(() => {
        let landed = false;
        try { landed = !!res.late.verify(); } catch (_) {}
        diag('paint.late:' + id + ',landed=' + landed + ',sinceClick=' + (Date.now() - res.t0) + 'ms');
        if (!landed) return;
        const late = paintResult(res.late.status || 'ok', res.late.text || 'The paint landed after all (the game was slow to apply it).', { plots: res.plots });
        late.seq = id; late.ms = res.ms;
        paintRecordResult(late);
        proAfterPaint(late, 'late');   // the write landed after all: redraw the painted-river marker
        try { if (opts.onLate) opts.onLate(late); } catch (_) {}
    }, PAINT_LATE_CHECK_MS);
}

// Enter the custom paint map-click mode (INTERFACEMODE_LCP_PAINT_TILE, registered in paint-tile-mode.js).
// Mirrors enterClaimMode: the caller closes the panel first so the map is fully clickable.
export function enterPaintMode({ category, typeString }, opts = {}) {
    if (!guardSP()) return false;
    if (!category || !typeString) { ERR('enterPaintMode: missing category/type', category, typeString); return false; }
    const problem = paintEntryProblem(category, typeString);
    if (problem) { diag('enterPaint:REFUSED,' + category + '=' + typeString + ',' + diagTok(problem, 300)); return false; }
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

// ─── MOD SETTINGS (localStorage, one shared key) — 2026-11-02 ──────────
// Civ VII's Coherent localStorage has a global single-key collision bug (getItem can return the FIRST-written key's
// value whatever key is asked for), so every mod shares ONE key, 'modSettings': a JSON object with one namespaced
// sub-object per mod (LocalStorage.sqlite on this Mac already holds {"randomWorldsReforged":{...}} under it). The
// panel's settings live in modSettings.localCheatPanel. Every access is try/catch'ed (storage can be missing or throw),
// other mods' sub-objects are kept on write, and a stored value that is not a JSON object is NEVER overwritten (it may
// be another key's value handed back by the collision bug). When storage is unusable, or the write does not read back,
// the value is kept in memory for this session (_lcpSettingsMem; memory wins over storage only in that case).
const MOD_SETTINGS_KEY = 'modSettings';
const MOD_SETTINGS_NS = 'localCheatPanel';
const _lcpSettingsMem = Object.create(null);
function modSettingsRead() {
    try {
        if (typeof localStorage === 'undefined' || !localStorage) return { ok: false, all: null, why: 'no-storage' };
        const raw = localStorage.getItem(MOD_SETTINGS_KEY);
        if (raw === null || raw === undefined || raw === '') return { ok: true, all: {}, why: 'empty' };
        let all = null;
        try { all = JSON.parse(raw); } catch (_) { return { ok: false, all: null, why: 'not-json' }; }
        if (!all || typeof all !== 'object' || Array.isArray(all)) return { ok: false, all: null, why: 'not-object' };
        return { ok: true, all, why: 'ok' };
    } catch (e) { return { ok: false, all: null, why: 'threw:' + revealErrText(e) }; }
}
/** One panel setting (modSettings.localCheatPanel[name]); dflt when unset or unreadable. Never throws. */
export function getLcpSetting(name, dflt) {
    try {
        if (name in _lcpSettingsMem) return _lcpSettingsMem[name];   // only set while storage could not take the value
        const r = modSettingsRead();
        const ns = r.ok ? r.all[MOD_SETTINGS_NS] : null;
        if (ns && typeof ns === 'object' && !Array.isArray(ns) && Object.prototype.hasOwnProperty.call(ns, name)) return ns[name];
    } catch (_) {}
    return dflt;
}
/** Store one panel setting; returns true when it was written to localStorage and read back. Never throws. */
export function setLcpSetting(name, value) {
    let persisted = false, verified = false, why = '';
    try {
        const r = modSettingsRead();
        if (!r.ok) why = r.why;                                       // missing / foreign value: do not touch storage
        else {
            const all = r.all;
            const ns0 = all[MOD_SETTINGS_NS];
            const ns = (ns0 && typeof ns0 === 'object' && !Array.isArray(ns0)) ? ns0 : {};
            ns[name] = value;
            all[MOD_SETTINGS_NS] = ns;
            localStorage.setItem(MOD_SETTINGS_KEY, JSON.stringify(all));
            persisted = true;
            const back = modSettingsRead();                           // read back (the collision bug makes this worth checking)
            const bns = back.ok ? back.all[MOD_SETTINGS_NS] : null;
            verified = !!(bns && typeof bns === 'object' && bns[name] === value);
            if (!verified) why = 'readback:' + back.why;
        }
    } catch (e) { why = 'threw:' + revealErrText(e); }
    if (persisted && verified) delete _lcpSettingsMem[name];
    else _lcpSettingsMem[name] = value;
    diag('settings.set:' + MOD_SETTINGS_NS + '.' + diagTok(name, 40) + '=' + diagTok(value, 40) + ',persisted=' + persisted
        + ',verified=' + verified + (why ? ',why=' + diagTok(why, 120) : ''));
    return persisted && verified;
}

// ─── PAINTED-RIVER STAND-IN OVERLAY (2026-11-02, river investigation candidate #3) ─────────────────────────
// A painted TERRAIN_NAVIGABLE_RIVER is never drawn as a river: the 3D map draws rivers from river data that setTerrain
// does not write (see PAINT_RIVER_WARNING). So the panel marks such tiles itself: a semi-transparent water-blue hex with
// an orange edge on every REVEALED tile whose terrain is navigable river but whose river data is not RIVER_NAVIGABLE
// (the rule the Map tab minimap uses for its "Painted river" mark). Data-derived: nothing is stored about the tiles;
// every refresh re-reads GameplayMap, so the marks come back after Reload UI / save & load once a refresh runs again.
//
// Overlay API (names copied from shipped JS, not from memory): WorldUI.createOverlayGroup(name, priority) →
// group.addPlotOverlay() → overlay.addPlots(plotIndices, { fillColor, edgeColor }); group.clearAll() + overlay.clear()
// (base tuner-input.js:527-536, lenses/layer/discovery-layer.js:8-31, interface-modes/support-city-decoration.js:19-31).
// Colours are linear {x:R, y:G, z:B, w:A} in 0..1 (core utilities-color.js HexToFloat4; paint-tile-mode.js's flashes).
// Priority 1 = OVERLAY_PRIORITY.HEX_GRID (base-standard/ui/utilities/utilities-overlay.js: 0 MIN, 2-3 continent/settler
// lens, 4 PLOT_HIGHLIGHT, 9 CURSOR, 10 MAX), so lens tints and the paint/hover highlights should draw above it. Hard-coded
// so api.js gains no import (an import that fails to resolve would take the whole panel down). The group belongs to this
// module and is NEVER the interface mode's placementOverlayGroup (ChoosePlotInterfaceMode.transitionFrom resets that one
// on every mode exit, interface-mode-choose-plot.js:51).
//
// JS context (task B2, read from the code): cheat-panel.js is the game-scope UIScript and statically imports
// paint-tile-mode.js, tab-creative.js and this file. So the panel code (renderCreativeTab → the toggle), the paint
// interface mode (LcpPaintTileMode.commitPlot → paintPlotAsync, run by InterfaceMode in the in-game HUD) and this overlay
// share ONE module instance of api.js in the in-game UI JS context, which lives for the whole game session (until Reload
// UI / load / exit). The panel's own DOM may be another document (cheat-panel.js injectPanelStyles), but its JS is this
// module. The toggle therefore calls refreshPaintedRiverOverlay directly. Two safety nets in case the panel ever turns
// out to run in another JS context (paint.api / paint.overlay breadcrumbs carry inst= to settle it): the setting lives
// in localStorage (modSettings) and is re-read on every refresh, and the toggle fires the custom engine event
// 'lcp-painted-river-overlay' that other contexts' copies refresh on (the sending context ignores its own event).
//
// Refresh triggers: every paint result (paintPlotAsync, and a late landing), game/UI load (initPaintedRiverOverlay,
// called by paint-tile-mode.js at module load: after engine.whenReady + 2 s, retried while the map / fog / local player
// is not ready), the Creative-tab toggle, the local player's turn start, TerrainTypeChanged (debounced; also catches
// tuner paints) and PlotVisibilityChanged on a painted tile that was still hidden. BeforeUnload clears the group (the
// support-city-decoration.js pattern), so a Reload UI leaves no orphaned marks behind. Every step is try/catch'ed:
// a failure here never breaks painting or the panel. Each refresh logs one 'paint.overlay:' breadcrumb.
// LIVE-UNVERIFIED (needs a probe): marks persisting across turns / panel close / paint-mode exit, priority vs lenses,
// how a mark looks under fog, and that this context may create overlay groups after load (base code does it at load).
const PRO_GROUP_NAME = 'LcpPaintedRiverOverlayGroup';
const PRO_PRIORITY = 1;                                         // OVERLAY_PRIORITY.HEX_GRID (see above)
const PRO_FILL = { x: 0.10, y: 0.45, z: 0.95, w: 0.45 };        // water blue, semi-transparent
const PRO_EDGE = { x: 1.00, y: 0.70, z: 0.28, w: 0.95 };        // orange #ffb347, the Map tab's "Painted river" mark
const PRO_SETTING = 'paintedRiverOverlay';                      // modSettings.localCheatPanel.paintedRiverOverlay
const PRO_DEFAULT_ON = true;
const PRO_EVENT = 'lcp-painted-river-overlay';                  // custom UI event (cross-context safety net only)
const PRO_INIT_DELAY_MS = 2000;                                 // after engine.whenReady, before the first refresh
const PRO_INIT_RETRY_MS = 2000;
const PRO_INIT_RETRIES = 15;                                    // ~30 s while the map / fog / local player is not ready
const PRO_DEBOUNCE_MS = 400;                                    // event-driven refreshes are coalesced
const PRO_BIG_PLOTS = 128 * 128;                                // above this the breadcrumb flags big=1 (scan ms matters)
const _pro = {
    group: null, overlay: null, createErr: '', overlayTries: 0,     // overlayTries: addPlotOverlay() attempts on the kept group
    init: false, initTag: '', hooked: false,
    timer: null, due: 0, reasons: [],
    hiddenKeys: null,                                           // Set of 'x,y' painted tiles hidden by fog at the last refresh
    shownKeys: null,                                            // Set of 'x,y' tiles marked at the last refresh
    last: { ok: null, on: null, count: 0, hidden: 0, why: '', at: 0 },
    lastLogSig: '', runs: 0,
};

/** Is the painted-river marker switched on (Creative tab; default ON)? Anything but an explicit false is on. */
export function isPaintedRiverOverlayEnabled() {
    return getLcpSetting(PRO_SETTING, PRO_DEFAULT_ON) !== false;
}
/** Last refresh outcome for the Creative tab label: {on, ok, count, hidden, why, at}. */
export function getPaintedRiverOverlayState() {
    let on = true;
    try { on = isPaintedRiverOverlayEnabled(); } catch (_) {}
    return Object.assign({}, _pro.last, { on });
}
// Create the group + its one plot overlay once (lazily, on the first refresh that has something to draw). Calls are
// not gated on typeof (native bindings); createOverlayGroup is caught by the caller, addPlotOverlay here (the group is
// already kept by then, so a retry never makes a second group). Returns true when both exist.
function proEnsureGroup() {
    if (_pro.group && _pro.overlay) return true;
    if (!_pro.group) {
        if (typeof WorldUI === 'undefined' || !WorldUI) { _pro.createErr = 'no-WorldUI'; return false; }
        const g = WorldUI.createOverlayGroup(PRO_GROUP_NAME, PRO_PRIORITY);
        if (!g) { _pro.createErr = 'createOverlayGroup-returned-' + (g === null ? 'null' : typeof g); return false; }
        // Keep the group as soon as it exists (2026-11-02 fix): if addPlotOverlay() below returns nothing or throws, the
        // next refresh retries only addPlotOverlay() on THIS group instead of creating another group every time.
        _pro.group = g;
    }
    _pro.overlayTries = (_pro.overlayTries | 0) + 1;
    let o = null;
    try { o = _pro.group.addPlotOverlay(); }
    catch (e) {
        _pro.createErr = 'addPlotOverlay-threw';
        if (_pro.overlayTries <= 3) diag('paint.overlay.create:partial=1,stage=addPlotOverlay,tries=' + _pro.overlayTries + ',inst=' + _paintCtxInst + ',err=' + paintErrText(e));
        return false;
    }
    if (!o) {
        _pro.createErr = 'addPlotOverlay-returned-' + (o === null ? 'null' : typeof o);
        if (_pro.overlayTries <= 3) diag('paint.overlay.create:partial=1,stage=addPlotOverlay,why=' + _pro.createErr + ',tries=' + _pro.overlayTries + ',inst=' + _paintCtxInst);
        return false;
    }
    _pro.overlay = o;
    _pro.createErr = '';
    diag('paint.overlay.create:name=' + PRO_GROUP_NAME + ',priority=' + PRO_PRIORITY + ',inst=' + _paintCtxInst
        + ',g.clearAll=' + paintTypeOf(_pro.group, 'clearAll') + ',g.setVisible=' + paintTypeOf(_pro.group, 'setVisible')
        + ',o.addPlots=' + paintTypeOf(o, 'addPlots') + ',o.clear=' + paintTypeOf(o, 'clear') + ',overlayTries=' + _pro.overlayTries);
    return true;
}
// Empty our group (both calls, as the tuner / discovery lens do). True if at least one call went through.
function proClear() {
    let did = false;
    try { if (_pro.group) { _pro.group.clearAll(); did = true; } } catch (e) { diag('paint.overlay.err:stage=clearAll,' + paintErrText(e)); }
    try { if (_pro.overlay) { _pro.overlay.clear(); did = true; } } catch (e) { diag('paint.overlay.err:stage=clear,' + paintErrText(e)); }
    return did;
}
// Full-map scan: tiles whose terrain is TERRAIN_NAVIGABLE_RIVER but whose river data is not RIVER_NAVIGABLE. Terrain is
// read the way readPaintType / getMapSnapshot read it (GameplayMap.getTerrainType → GameInfo.Terrains.lookup), with
// getMapSnapshot's per-raw-value cache so GameInfo is asked once per distinct terrain, not once per plot; river data
// through paintRiverRaw / paintRiverNav (null = unreadable, which counts as "no river data", as on the minimap).
function proScan(W, H) {
    const t0 = Date.now();
    const nav = paintRiverNav();
    const isNav = Object.create(null);
    const out = { found: [], navTerr: 0, real: 0, unk: 0, errs: 0, ms: 0 };
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            let t;
            try { t = GameplayMap.getTerrainType(x, y); } catch (_) { out.errs++; continue; }
            let hit = isNav[t];
            if (hit === undefined) {
                let name = null;
                try { name = GameInfo.Terrains.lookup(t)?.TerrainType || null; } catch (_) {}
                hit = isNav[t] = (name === 'TERRAIN_NAVIGABLE_RIVER');
            }
            if (!hit) continue;
            out.navTerr++;
            const rt = paintRiverRaw({ x, y });
            if (rt === nav) { out.real++; continue; }
            if (rt == null) out.unk++;
            out.found.push({ x, y, rt });
        }
    }
    out.ms = Date.now() - t0;
    return out;
}
function proPlotIndex(x, y, W) {
    try { if (typeof GameplayMap.getIndexFromXY === 'function') { const i = GameplayMap.getIndexFromXY(x, y); if (Number.isInteger(i) && i >= 0) return i; } } catch (_) {}
    return x + W * y;   // base yields-layer.js:65 computes plot indices this way
}
// Coalesce event-driven refreshes: one timer at a time, carrying every reason that asked for it. A request that wants
// to run sooner than the pending timer pulls it forward (a paint's TerrainTypeChanged queues a 400 ms refresh just
// before the paint result asks for 50 ms).
function proSchedule(reason, ms) {
    try {
        if (_pro.reasons.length < 6 && _pro.reasons.indexOf(reason) < 0) _pro.reasons.push(reason);
        const wait = Math.max(0, ms | 0);
        const due = Date.now() + wait;
        if (_pro.timer != null) {
            if (due >= _pro.due) return;
            try { clearTimeout(_pro.timer); } catch (_) {}
        }
        _pro.due = due;
        _pro.timer = setTimeout(() => {
            _pro.timer = null;
            const why = _pro.reasons.join('+') || reason;
            _pro.reasons = [];
            refreshPaintedRiverOverlay(why);
        }, wait);
    } catch (e) { diag('paint.overlay.err:stage=schedule,' + paintErrText(e)); }
}
// After a paint result (paintPlotAsync / late landing): refresh unless nothing was written (refused / busy).
function proAfterPaint(res, tag) {
    try {
        if (!res || res.status === 'refused' || res.status === 'busy') return;
        proSchedule('paint#' + res.seq + ':' + res.status + (tag ? ':' + tag : ''), 50);
    } catch (_) { /* the marker must never break painting */ }
}
// Engine events, hooked once per context (from the delayed init start, so no breadcrumb runs before <body> exists).
function proHookEvents() {
    if (_pro.hooked) return;
    _pro.hooked = true;
    if (typeof engine === 'undefined' || !engine || typeof engine.on !== 'function') { diag('paint.overlay.hook:engine=no,inst=' + _paintCtxInst); return; }
    const hook = (name, fn) => {
        try {
            engine.on(name, (d) => { try { fn(d); } catch (e) { diag('paint.overlay.err:stage=event-' + name + ',' + paintErrText(e)); } });
            return 1;
        } catch (e) { diag('paint.overlay.hook:failed=' + name + ',' + paintErrText(e)); return 0; }
    };
    let n = 0;
    n += hook('BeforeUnload', () => {             // Reload UI / leaving the game: leave no orphaned marks behind
        const did = proClear();
        diag('paint.overlay:reason=unload,cleared=' + did + ',inst=' + _paintCtxInst);
    });
    n += hook('PlayerTurnActivated', (d) => { if (d && d.player === GameContext.localPlayerID) proSchedule('turn', PRO_DEBOUNCE_MS); });
    n += hook('TerrainTypeChanged', () => proSchedule('terrain-event', PRO_DEBOUNCE_MS));
    // A painted tile that was hidden at the last refresh came into view, or a marked one was covered again (the Map
    // tab's "Restore fog" re-hides tiles through setRevealed, which emits this event). Payload {location, visibility}
    // as base yields-layer.js:64 reads it. Two Set lookups per event, and none while no painted tile exists.
    n += hook('PlotVisibilityChanged', (d) => {
        const hid = _pro.hiddenKeys, shown = _pro.shownKeys;
        if ((!hid || !hid.size) && (!shown || !shown.size)) return;
        if (!d || !d.location) return;
        const k = d.location.x + ',' + d.location.y;
        const HIDDEN = (typeof RevealedStates !== 'undefined' && RevealedStates && RevealedStates.HIDDEN !== undefined) ? RevealedStates.HIDDEN : 0;
        if (hid && hid.has(k) && d.visibility !== HIDDEN) proSchedule('reveal', PRO_DEBOUNCE_MS);
        else if (shown && shown.has(k) && d.visibility === HIDDEN) proSchedule('fogged', PRO_DEBOUNCE_MS);
    });
    n += hook(PRO_EVENT, (d) => {                 // the toggle in another context (never fires for our own toggle)
        if (d && d.inst === _paintCtxInst) return;
        proSchedule('toggle-event', 0);
    });
    diag('paint.overlay.hook:hooked=' + n + '/5,inst=' + _paintCtxInst);
}

/**
 * Redraw the painted-river marker from the map. Never throws. Returns {ok, on, count, hidden, why, retry, ms}:
 * count = tiles marked, hidden = painted tiles left out because the local player has not explored them, retry = true
 * when the map / fog / local player was not ready (the load-time init tries again). One 'paint.overlay:' breadcrumb.
 */
export function refreshPaintedRiverOverlay(reason) {
    const t0 = Date.now();
    const why = diagTok(reason || '?', 60);
    _pro.runs++;
    let stage = 'start', W = 0, H = 0, scan = null, fog = 'skip', drawn = 'no';
    const finish = (r) => {
        r.ms = Date.now() - t0;
        try {
            _pro.last = { ok: r.ok, on: r.on, count: r.count | 0, hidden: r.hidden | 0, why: r.why || '', at: Date.now() };
            const at = (r.shown || []).slice(0, 6).map(f => f.x + '/' + f.y).join(';');
            const sig = r.ok + '|' + r.on + '|' + r.count + '|' + r.hidden + '|' + at + '|' + (r.why || '');
            // a turn-start refresh that changed nothing stays out of UI.log (long games would fill it otherwise)
            if (!(why === 'turn' && sig === _pro.lastLogSig)) {
                diag('paint.overlay:reason=' + why + ',on=' + r.on + ',ok=' + r.ok + ',count=' + (r.count | 0) + ',hidden=' + (r.hidden | 0)
                    + (scan ? ',navTerr=' + scan.navTerr + ',real=' + scan.real + ',unk=' + scan.unk + ',scanMs=' + scan.ms + (scan.errs ? ',readErrs=' + scan.errs : '') : '')
                    + ',ms=' + r.ms + ',map=' + W + 'x' + H + (W * H > PRO_BIG_PLOTS ? ',big=1' : '') + ',fog=' + diagTok(fog, 40) + ',drawn=' + drawn
                    + (at ? ',at=' + at : '') + ',run=' + _pro.runs + ',inst=' + _paintCtxInst
                    + (r.why ? ',why=' + diagTok(r.why, 80) : '') + (r.err ? ',stage=' + stage + ',err=' + r.err : ''));
            }
            _pro.lastLogSig = sig;
            LOG('painted-river overlay: reason=' + why + ' on=' + r.on + ' ok=' + r.ok + ' count=' + r.count + ' hidden=' + r.hidden + ' ms=' + r.ms + (r.why ? ' why=' + r.why : ''));
        } catch (_) { /* logging must never throw */ }
        return r;
    };
    try {
        // STEP 1/5: is the marker wanted? (off, or a multiplayer game → clear whatever is drawn)
        stage = 'setting';
        const mp = isMultiplayer();
        const on = !mp && isPaintedRiverOverlayEnabled();
        if (!on) {
            stage = 'clear';
            const cleared = proClear();
            drawn = cleared ? 'cleared' : 'no';
            _pro.hiddenKeys = null;
            _pro.shownKeys = null;
            return finish({ ok: true, on: false, count: 0, hidden: 0, why: mp ? 'multiplayer' : 'off' });
        }
        // STEP 2/5: map size (0 while the game is still loading)
        stage = 'map';
        W = GameplayMap.getGridWidth() | 0;
        H = GameplayMap.getGridHeight() | 0;
        if (!W || !H) return finish({ ok: false, on: true, count: 0, hidden: 0, why: 'no-map', retry: true });
        // STEP 3/5: full-map scan for navigable-river terrain without navigable river data
        stage = 'scan';
        scan = proScan(W, H);
        if (scan.errs >= W * H) return finish({ ok: false, on: true, count: 0, hidden: 0, why: 'terrain-unreadable', retry: true });
        // STEP 4/5: keep only tiles the local player has explored (read-only: fog is never changed here)
        stage = 'fog';
        let shown = scan.found;
        const hiddenList = [];
        if (scan.found.length) {
            let me = -1;
            try { me = GameContext.localPlayerID; } catch (_) {}
            if (typeof me !== 'number' || me < 0) return finish({ ok: false, on: true, count: 0, hidden: 0, why: 'no-local-player', retry: true });
            const rs = readRevealedStates(me);
            if (!rs.ok) {
                fog = 'unreadable:' + rs.error;          // DECISION: show every painted tile (the player painted them)
            } else if (rs.revealed + rs.visible === 0) {
                fog = 'not-ready';                       // no explored tile at all = fog not loaded yet: keep the old marks
                return finish({ ok: false, on: true, count: 0, hidden: 0, why: 'fog-not-ready', retry: true });
            } else {
                const HIDDEN = (typeof RevealedStates !== 'undefined' && RevealedStates && RevealedStates.HIDDEN !== undefined) ? RevealedStates.HIDDEN : 0;
                shown = [];
                for (const f of scan.found) {
                    const s = (f.y < rs.H && f.x < rs.W) ? rs.states[f.y * rs.W + f.x] : HIDDEN;
                    if (s === HIDDEN) hiddenList.push(f); else shown.push(f);
                }
                fog = rs.source;
            }
        }
        _pro.hiddenKeys = hiddenList.length ? new Set(hiddenList.map(f => f.x + ',' + f.y)) : null;
        _pro.shownKeys = shown.length ? new Set(shown.map(f => f.x + ',' + f.y)) : null;
        // STEP 5/5: redraw our own group (created on the first refresh that has something to draw)
        stage = 'draw';
        if (!shown.length && !_pro.overlay) {
            drawn = 'nothing';                           // nothing to mark and nothing drawn yet: no group / plot overlay needed
        } else {
            stage = 'create';
            if (!proEnsureGroup()) return finish({ ok: false, on: true, count: 0, hidden: hiddenList.length, why: _pro.createErr || 'no-group', shown });
            stage = 'draw';
            proClear();
            if (shown.length) {
                const idx = shown.map(f => proPlotIndex(f.x, f.y, W));
                _pro.overlay.addPlots(idx, { fillColor: PRO_FILL, edgeColor: PRO_EDGE });
                drawn = 'yes';
            } else drawn = 'cleared';
        }
        return finish({ ok: true, on: true, count: shown.length, hidden: hiddenList.length, shown });
    } catch (e) {
        ERR('refreshPaintedRiverOverlay failed at', stage, e);
        return finish({ ok: false, on: null, count: 0, hidden: 0, why: 'threw', err: paintErrText(e) });
    }
}

/**
 * Creative-tab toggle. Persists the choice (modSettings), redraws at once (off = cleared), and tells any other UI
 * context (custom engine event). Returns {on, persisted, ok, count, hidden, why}. Never throws.
 */
export function setPaintedRiverOverlayEnabled(on, source) {
    const want = !!on;
    diag('paint.overlay.toggle:on=' + want + ',src=' + diagTok(source || '?', 30) + ',inst=' + _paintCtxInst);
    let persisted = false;
    try { persisted = setLcpSetting(PRO_SETTING, want); } catch (e) { diag('paint.overlay.err:stage=persist,' + paintErrText(e)); }
    let r = null;
    try { r = refreshPaintedRiverOverlay('toggle-' + (want ? 'on' : 'off')); } catch (_) {}
    try {
        if (typeof engine !== 'undefined' && engine && typeof engine.trigger === 'function') engine.trigger(PRO_EVENT, { on: want, inst: _paintCtxInst });
    } catch (e) { diag('paint.overlay.err:stage=trigger,' + paintErrText(e)); }
    return { on: want, persisted, ok: !!(r && r.ok), count: r ? (r.count | 0) : 0, hidden: r ? (r.hidden | 0) : 0, why: r ? (r.why || '') : 'no-result' };
}

/**
 * Once per JS context, at game/UI load (paint-tile-mode.js module load): hook the refresh events and draw the first
 * marks after engine.whenReady + PRO_INIT_DELAY_MS, retrying every PRO_INIT_RETRY_MS (up to PRO_INIT_RETRIES) while the
 * map / fog / local player is not ready. Nothing runs synchronously here (no breadcrumb before <body> exists). Never throws.
 */
export function initPaintedRiverOverlay(tag) {
    if (_pro.init) return;
    _pro.init = true;
    _pro.initTag = String(tag || '?');
    const attempt = (n) => {
        let r = null;
        try { r = refreshPaintedRiverOverlay('init#' + n); } catch (_) {}
        if (r && r.retry && n < PRO_INIT_RETRIES) { setTimeout(() => attempt(n + 1), PRO_INIT_RETRY_MS); return; }
        let wui = 'n/a';
        try { wui = (typeof WorldUI !== 'undefined' && WorldUI) ? typeof WorldUI.createOverlayGroup : 'n/a'; } catch (_) { wui = 'throws'; }
        diag('paint.overlay.init:tag=' + diagTok(_pro.initTag, 40) + ',attempts=' + (n + 1) + ',final=' + (r ? (r.ok ? 'ok' : diagTok(r.why, 40)) : 'none')
            + ',count=' + (r ? (r.count | 0) : '?') + ',on=' + (r ? r.on : '?') + ',createOverlayGroup=' + wui + ',inst=' + _paintCtxInst);
    };
    const start = () => {
        try { proHookEvents(); } catch (e) { try { diag('paint.overlay.err:stage=hook,' + paintErrText(e)); } catch (_) {} }
        attempt(0);
    };
    const later = () => { try { setTimeout(start, PRO_INIT_DELAY_MS); } catch (_) {} };
    try {
        if (typeof engine !== 'undefined' && engine && engine.whenReady && typeof engine.whenReady.then === 'function') {
            engine.whenReady.then(later, later);
            return;
        }
    } catch (_) {}
    later();
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

// One LCPD breadcrumb per map size per session: the raw river values seen and the constants they were classed
// with, so the test-window log shows the mapping without a tuner probe.
let _mapRiverDiagKey = '';
function mapRiverDiag(W, H, raw) {
    try {
        const key = W + 'x' + H;
        if (_mapRiverDiagKey === key) return;
        _mapRiverDiagKey = key;
        // raw = value:count pairs joined by ';' (2026-10-21: no ',' inside a value; it used to be {a,b})
        const parts = Object.keys(raw).sort().map((k) => diagTok(k) + ':' + raw[k]);
        diag('map.rivers:' + key + ',raw=' + parts.join(';') + ',none=' + paintRiverNone() + ',nav=' + paintRiverNav()
            + ',src=' + ((typeof RiverTypes !== 'undefined') ? 'RiverTypes' : 'fallback'));
    } catch (_) { /* diagnostics must never break the minimap */ }
}
// Navigable-river terrain vs river data, logged whenever the counts change (a paint changes them; a re-read of the
// same map does not), so the test log shows the painted river tiles the minimap marks.
let _mapNavRiverDiagKey = '';
function mapNavRiverDiag(W, H, n) {
    try {
        const key = W + 'x' + H + ':' + n.real + '/' + n.painted + '/' + n.dataOnly + '/' + n.at.join(';');
        if (_mapNavRiverDiagKey === key) return;
        _mapNavRiverDiagKey = key;
        diag('map.navriver:' + W + 'x' + H + ',real=' + n.real + ',painted=' + n.painted + ',dataOnly=' + n.dataOnly
            + (n.at.length ? ',paintedAt=' + n.at.join(';') : ''));
    } catch (_) { /* diagnostics must never break the minimap */ }
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

    // River class for the minimap: plots[i].river = 0 none, 1 minor, 2 navigable (what tab-map.js draws and names).
    // GameplayMap.getRiverType returns RiverTypes values: on build 25516395 NO_RIVER = -1, RIVER_MINOR = 0,
    // RIVER_NAVIGABLE = 1 (see paintRiverNone above). The raw value used to be stored as is (| 0), so every
    // non-river plot (-1) drew a minor-river stroke, real minor rivers (0) drew nothing, and navigable rivers (1)
    // drew and read as minor. Fixed 2026-10-20 (integration step); classed by paintRiverWord, as paint does.
    const rivRaw = Object.create(null);   // raw getRiverType value -> plot count, for the one-time breadcrumb
    // real = navigable-river terrain + navigable river data; painted = that terrain without it; dataOnly = navigable river
    // data under another terrain (e.g. a river painted over with Flat). at = first painted tiles as x/y:riverClass.
    const navRiv = { real: 0, painted: 0, dataOnly: 0, at: [] };

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
            try {
                const rr = GameplayMap.getRiverType(x, y);
                rivRaw[rr] = (rivRaw[rr] || 0) + 1;
                const rw = paintRiverWord((typeof rr === 'number') ? rr : null);
                river = (rw === 'navigable') ? 2 : (rw === 'minor' ? 1 : 0);
            } catch (_) {}
            try { nw       = !!GameplayMap.isNaturalWonder(x, y); } catch (_) {}
            try { const fi = resolveFeature(GameplayMap.getFeatureType(x, y)); feat = fi.type; featName = fi.name; } catch (_) {}
            hills = (terr === 'TERRAIN_HILL'); // TERRAIN_HILL is land + elevated, see base data
            // navigable-river terrain vs the game's river data (tab-map marks terrain-without-data as painted)
            if (terr === 'TERRAIN_NAVIGABLE_RIVER') {
                if (river === 2) navRiv.real++;
                else { navRiv.painted++; if (navRiv.at.length < 6) navRiv.at.push(x + '/' + y + ':' + river); }
            } else if (river === 2) navRiv.dataOnly++;

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
    mapRiverDiag(W, H, rivRaw);
    mapNavRiverDiag(W, H, navRiv);

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
