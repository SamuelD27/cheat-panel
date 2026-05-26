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
import { InterfaceMode } from '/core/ui/interface-modes/interface-modes.js'; // Hotkeys
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

// ── Hotkey Support ───────────────────────────────────────────────────
class CheatPanelHotkeyInputManager {
    static getInstance() {
        if (!CheatPanelHotkeyInputManager.Instance) {
            CheatPanelHotkeyInputManager.Instance = new CheatPanelHotkeyInputManager();
        }
        return CheatPanelHotkeyInputManager.Instance;
    }

    init(ContextManager) {
        ContextManager.registerEngineInputHandler(this);
    }

    handleInput(inputEvent) {
        const status = inputEvent.detail.status;
        if (status == InputActionStatuses.FINISH) {
            const name = inputEvent.detail.name;
            if (name === "lcp-open-panel") {
                this.sendHotkeyEvent(name);
                return false;
            }
        }
        return true;
    }

    /** Dispatches a 'hotkey-{input action name}' event on window. */
    sendHotkeyEvent(inputActionName) {
        if (InterfaceMode.allowsHotKeys()) {
            window.dispatchEvent(new CustomEvent('hotkey-' + inputActionName));
        }
    }
}

const cheatPanelHotkeyInputManager = CheatPanelHotkeyInputManager.getInstance();

console.log("LCP: dock bootstrap");

function onOpenCheatPanelHotkey(_event) {
    if (ContextManager.isCurrentClass('panel-lcp')) {
        ContextManager.pop('panel-lcp');
    } else {
        ContextManager.push('panel-lcp');
    }
}

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

    ContextManager.registerEngineInputHandler(cheatPanelHotkeyInputManager);
    window.addEventListener('hotkey-lcp-open-panel', onOpenCheatPanelHotkey);

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
                console.error("LCP: gave up waiting for PanelSubSystemDock — button will not appear. Use F8 to open the panel anyway.");
                // Hotkey still works even without the button.
                ContextManager.registerEngineInputHandler(cheatPanelHotkeyInputManager);
                window.addEventListener('hotkey-lcp-open-panel', onOpenCheatPanelHotkey);
            }
        }
    }, 100);
}
