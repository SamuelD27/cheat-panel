/**
 * @file lcp-sub-system-dock.js
 * @description Local Cheat Panel — sub-system dock launcher + F8 hotkey routing.
 *
 * Forked from Sovereign Cheat Panel (private working copy). Proven on Civ VII build 23245653 /
 * Update 1.4.0 "Test of Time".
 *
 * 1.4.0 NOTE: Stock `panel-sub-system-dock.js` no longer exports PanelSubSystemDock. We resolve the
 * class at runtime via the customElements / Controls registry (both Civ 7 internals route through the
 * same map), then monkey-patch its onInitialize to add our launcher button via the dock's own
 * addButton() API. Robust against patch drift on that file.
 */
import ContextManager from '/core/ui/context-manager/context-manager.js';

function resolvePanelSubSystemDockClass() {
    // Native custom-element registry first — Controls.define ultimately calls
    // customElements.define(name, c) so this is the most direct lookup.
    try {
        if (typeof customElements !== 'undefined') {
            const c = customElements.get('panel-sub-system-dock');
            if (c) return c;
        }
    } catch (_) { /* ignore */ }

    // Fallback: Civ 7 Controls registry.
    try {
        if (typeof Controls !== 'undefined' && typeof Controls.getDefinition === 'function') {
            const def = Controls.getDefinition('panel-sub-system-dock');
            if (def && def.createInstance) return def.createInstance;
        }
    } catch (_) { /* ignore */ }

    return null;
}

// ── Custom Skull Icon CSS ────────────────────────────────────────────
// Inject CSS for the 'lcp-skull' modifier class with a gold skull icon.
// Uses base64-encoded SVG to avoid data URI encoding issues.
const SKULL_ICON = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+CiAgPHBhdGggZmlsbD0iI2RhYTUyMCIgZD0iTTMyIDRDMTggNCAxMCAxNCAxMCAyNmMwIDggNCAxNCA4IDE4djhjMCAyIDIgNCA0IDRoNHYtNmg0djZoNHYtNmg0djZoNGMyIDAgNC0yIDQtNHYtOGM0LTQgOC0xMCA4LTE4QzU0IDE0IDQ2IDQgMzIgNHptLTggMjhhNSA1IDAgMSAxIDAtMTAgNSA1IDAgMCAxIDAgMTB6bTE2IDBhNSA1IDAgMSAxIDAtMTAgNSA1IDAgMCAxIDAgMTB6Ii8+CiAgPHBhdGggZmlsbD0iIzFhMWEyZSIgZD0iTTI0IDI3YTUgNSAwIDEgMSAwIDEwIDUgNSAwIDAgMSAwLTEwem0xNiAwYTUgNSAwIDEgMSAwIDEwIDUgNSAwIDAgMSAwLTEweiIvPgogIDxwYXRoIGZpbGw9IiNkYWE1MjAiIGQ9Ik0yNiA0MGgxMmwtMiA1aC04eiIvPgo8L3N2Zz4K";

const cheatPanelCSS = document.createElement('style');
cheatPanelCSS.textContent = `
    .ssb__button-icon.lcp-skull {
        background-image: url("${SKULL_ICON}");
        background-size: 65% 65%;
        background-repeat: no-repeat;
        background-position: center center;
    }
    .ssb__button-iconbg.lcp-skull {
        background: radial-gradient(circle, rgba(40,32,10,0.9) 0%, rgba(25,20,6,0.95) 70%, rgba(12,10,3,1) 100%);
        border-radius: 50%;
    }
    .ssb__button-iconbg.lcp-skull.ssb__button-iconbg--hover {
        background: radial-gradient(circle, rgba(70,56,14,0.95) 0%, rgba(40,32,10,0.95) 70%, rgba(20,16,5,1) 100%);
        border-radius: 50%;
    }
    .ssb__button-iconbg.lcp-skull.ssb__button-iconbg--active {
        background: radial-gradient(circle, rgba(90,72,18,1) 0%, rgba(55,44,11,0.95) 70%, rgba(28,22,7,1) 100%);
        border-radius: 50%;
    }
`;
document.head.appendChild(cheatPanelCSS);

// ── Hotkey Support (F8-reliability rework, 2026-06-12) ──────────────────────
// Root causes found for "F8 works for me but not for some players":
//   1. DB-row loss: if ANOTHER enabled mod inserts the same InputActions.ActionId, the engine logs
//      "UNIQUE constraint failed: InputActions.ActionId" and ROLLS BACK the whole shell
//      UpdateDatabase action — the F8 row then never exists for that user, while the game-scope
//      UIScripts (skull button, panel) still load. Verified live in Database.log/Modding.log with
//      local-cheat-panel + the Workshop sam-cheat-panel both enabled (both insert 'lcp-open-panel').
//   2. Starvation: the old ContextManager.registerEngineInputHandler handler runs LAST in the
//      dispatch chain (context-manager.js:583), after the focused element / cursor target / current
//      screen each may consume the event — e.g. the pause-menu view consumes EVERY FINISH event.
//   3. Self-gate: our old copy of hotkey-manager's InterfaceMode.allowsHotKeys() gate silently
//      no-op'ed F8 in every interface mode except DEFAULT / UNIT_SELECTED (city view, placement…).
// Fixes: listen on engine.on('InputAction') — the ROOT of the UI input pipeline
// (core/ui/input/action-handler.js:27), which no screen can starve; drop the allowsHotKeys gate
// (a cheat-panel toggle should work anywhere); and add a raw DOM-keydown F8 fallback that only acts
// while Input.getActionIdByName('lcp-open-panel') reports the action row MISSING (case 1), so the
// two paths cannot both act. togglePanel()'s 300ms debounce backstops any residual overlap.

let _lastToggleTs = 0;
function togglePanel(source) {
    const now = Date.now();
    if (now - _lastToggleTs < 300) {     // debounce — engine action + raw key can never double-toggle
        console.log('LCP: hotkey toggle debounced (source=' + source + ')');
        return;
    }
    _lastToggleTs = now;
    try {
        const isOpen = ContextManager.isCurrentClass('panel-lcp');
        console.log('LCP: hotkey toggle (source=' + source + ') -> ' + (isOpen ? 'close' : 'open'));
        if (isOpen) ContextManager.pop('panel-lcp');
        else ContextManager.push('panel-lcp', { singleton: true });
    } catch (e) {
        console.error('LCP: hotkey toggle failed:', e);
    }
}

/** True if the shell-scope InputActions row survived DB load (false = rolled back / not queryable). */
function actionRowPresent() {
    try {
        if (typeof Input !== 'undefined' && typeof Input.getActionIdByName === 'function') {
            return !!Input.getActionIdByName('lcp-open-panel');
        }
    } catch (_) { /* fall through */ }
    return false;   // can't tell → let the raw-key path act; the debounce guards a live action path
}

// Primary path: the engine emits ('lcp-open-panel', FINISH) on F8 when the DB row exists.
try {
    engine.on('InputAction', (name, status /*, x, y */) => {
        if (name === 'lcp-open-panel' && status === InputActionStatuses.FINISH) togglePanel('input-action');
    });
    console.log('LCP: engine.on(InputAction) hotkey listener installed');
} catch (e) {
    console.error('LCP: engine.on(InputAction) hookup failed:', e);
}

// Fallback path: raw F8 keydown — acts ONLY while the action row is missing.
try {
    window.addEventListener('keydown', (e) => {
        if (!e || (e.code !== 'F8' && e.keyCode !== 119)) return;
        if (actionRowPresent()) return;   // engine path owns F8 — stay silent
        console.error('LCP: raw F8 fallback fired (input-action row missing — likely an ActionId collision with another enabled panel mod)');
        togglePanel('raw-keydown');
    });
} catch (e) {
    console.error('LCP: raw keydown fallback hookup failed:', e);
}

// One-shot startup diagnostic (deferred so the input DB is settled): which F8 path is live?
setTimeout(() => {
    const present = actionRowPresent();
    // console.error on purpose — it reliably reaches UI.log from this context; console.log may not.
    console.error('LCP: F8 wiring — input-action row ' + (present
        ? 'PRESENT (engine InputAction path active)'
        : 'MISSING (raw keydown fallback active — check Database.log for "UNIQUE constraint failed: InputActions.ActionId")'));
}, 3000);

console.log("LCP: dock bootstrap");

function openCheatPanelViewer() {
    ContextManager.push("panel-lcp", { singleton: true });
}

function buildOnInitialize(prev_onInitialize) {
    return function onInitialize(...args) {
        prev_onInitialize.apply(this, args);
        this.addButton({
            tooltip: "LOC_LCP_CHEAT_PANEL_OPEN_PANEL",
            modifierClass: 'lcp-skull',
            callback: this.openCheatPanelViewer.bind(this),
            class: "tut-lcp",
            audio: "religion",
            focusedAudio: "data-audio-focus-small"
        });
        console.log("LCP: skull button added to sub-system dock");
    };
}

function patchDock() {
    const cls = resolvePanelSubSystemDockClass();
    if (!cls || !cls.prototype) return false;
    if (cls.prototype.__lcpDockPatched) return true;

    const prev_onInitialize = cls.prototype.onInitialize;
    if (typeof prev_onInitialize !== 'function') {
        console.warn("LCP: PanelSubSystemDock has no onInitialize — skipping patch attempt this cycle");
        return false;
    }
    cls.prototype.onInitialize = buildOnInitialize(prev_onInitialize);
    cls.prototype.openCheatPanelViewer = openCheatPanelViewer;
    cls.prototype.__lcpDockPatched = true;

    console.log("LCP: sub-system dock patched (1.4.0-safe path)");
    return true;
}

// Try immediately, then poll briefly in case the dock module loads after us.
if (!patchDock()) {
    let attempts = 0;
    const interval = setInterval(() => {
        attempts++;
        if (patchDock() || attempts > 100) {  // ~10s @ 100ms
            clearInterval(interval);
            if (attempts > 100) {
                // The F8 paths above are module-level, so the hotkey works even without the button.
                console.error("LCP: gave up waiting for PanelSubSystemDock — button will not appear. Use F8 to open the panel anyway.");
            }
        }
    }, 100);
}
