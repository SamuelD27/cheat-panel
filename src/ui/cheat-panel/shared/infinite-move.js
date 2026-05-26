/**
 * @file shared/infinite-move.js
 * @description Global infinite-movement toggle.
 *
 * One switch: when ON, every unit the local player owns automatically regains its movement after
 * spending it (UnitMoveComplete) and at the start of each of the player's turns (PlayerTurnActivated)
 * — no per-unit clicking. State is module-scoped (cleared on game reload; AffectsSavedGames=0).
 * Engine listeners are registered once at module load (engine.whenReady) so the toggle keeps working
 * while the panel is closed.
 *
 * Verified payloads (build 23245653): PlayerTurnActivated -> data.player; UnitMoveComplete ->
 * data.unit (ComponentID with .owner/.id). Restore: Units.restoreMovement(componentId).
 */
import * as api from '/base-standard/ui/cheat-panel/shared/api.js';

let globalInfinite = false;

export function isGlobalInfinite() { return globalInfinite; }

/** Set the global toggle. Returns the new state. */
export function setGlobalInfinite(on) {
    if (on && !api.guardSP()) return false;
    globalInfinite = !!on;
    api.LOG('infinite-move (all units)', globalInfinite ? 'ON' : 'OFF');
    if (globalInfinite) restoreAllLocal();
    return globalInfinite;
}

export function toggleGlobalInfinite() { return setGlobalInfinite(!globalInfinite); }

function restoreAllLocal() {
    try {
        for (const u of api.getLocalUnits()) {
            try { Units.restoreMovement(u.id); } catch (e) { /* ignore individual failures */ }
        }
    } catch (e) { api.ERR('restoreAllLocal failed:', e); }
}

let registered = false;
function registerListeners() {
    if (registered) return;
    registered = true;
    try {
        engine.on('PlayerTurnActivated', (data) => {
            if (globalInfinite && data && data.player === GameContext.localPlayerID) restoreAllLocal();
        });
        engine.on('UnitMoveComplete', (data) => {
            if (!globalInfinite || !data || !data.unit) return;
            if (data.unit.owner === GameContext.localPlayerID) {
                try { Units.restoreMovement(data.unit); } catch (e) { /* ignore */ }
            }
        });
        api.LOG('infinite-move listeners registered');
    } catch (e) {
        registered = false;
        api.ERR('infinite-move listener registration failed:', e);
    }
}

/** Idempotent; called from the panel as a belt-and-suspenders. */
export function ensureListeners() { registerListeners(); }

// Register as soon as the engine is ready (this module evaluates at game load via the panel imports).
try {
    if (typeof engine !== 'undefined' && engine.whenReady && engine.whenReady.then) {
        engine.whenReady.then(() => registerListeners());
    } else {
        registerListeners();
    }
} catch (e) { /* ensureListeners() will retry from the panel */ }
