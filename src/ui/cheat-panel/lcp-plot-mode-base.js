/**
 * @file lcp-plot-mode-base.js
 * @description Shared base class for EVERY LCP plot-selection interface mode (claim, paint, and any
 *   future resource/wonder tools). Subclasses ChoosePlotInterfaceMode and centralizes two things so we
 *   never re-solve them per-feature:
 *
 *   1. A reliable EXIT (Item 2 fix). The base ChoosePlotInterfaceMode.handleInput DOES cancel on
 *      Esc/right-click — but only when `ViewManager.isWorldInputAllowed` is true, and it never
 *      stopPropagation()s the event. When world input is disabled, the inherited handler returns true
 *      (pass-through), so the Esc reaches the global window 'engine-input' listener in root-game.js,
 *      which opens the PAUSE/SETTINGS menu instead of exiting our mode — the reported bug. We override
 *      handleInput to UNCONDITIONALLY swallow cancel inputs and switch to default, copying the proven
 *      INTERFACEMODE_ACQUIRE_TILE / PLACE_BUILDING pattern (interface-mode-acquire-tile.js:368):
 *      stopPropagation()+preventDefault()+return InputHandlerState.Handled. Handled marks the event
 *      consumed, so ContextManager.handleInput returns false → action-handler skips window.dispatchEvent
 *      → the pause menu never fires.
 *      Return contract (build 25516395+): InputHandlerState.Active (0) = pass-through, .Handled (1) =
 *      consumed; ContextManager tests `result == InputHandlerState.Handled`. The OLD contract was a
 *      boolean with true = pass-through — returning `true` now reads as Handled (true == 1), which
 *      swallowed every map click before WorldInput (registered after InterfaceMode in root-game.js)
 *      could select a plot: Creative paint and City claim went dead after the update.
 *
 *   2. A shared on-screen EXIT BANNER with a clickable "✕ Exit" button, so every mode has the SAME
 *      discoverable exit (mouse click + Esc + right-click). Interface modes run in the main HUD
 *      document (NOT the panel isolate), so the banner is appended to that document.body. It is
 *      pointer-events:none except the Exit button, so map clicks still pass through to the picker.
 *
 * Subclasses set this.bannerTitle / this.hintText / this.hintNote (e.g. in initialize(), where
 * this.Context is available). decorate()/undecorate() here show/remove the banner; a subclass that
 * needs its own decorate work (e.g. paint's flash overlay) should override and call super.decorate()/
 * super.undecorate() so the banner is still managed.
 *
 * Dual-registration note: this file only defines a base class; the concrete modes still register
 * themselves with InterfaceMode.addHandler and need their DB rows in database/interface-modes.xml.
 * Registered as an <ImportFiles> item in local-cheat-panel.modinfo.
 */
import ChoosePlotInterfaceMode from '/base-standard/ui/interface-modes/interface-mode-choose-plot.js';
import { InterfaceMode, InputHandlerState } from '/base-standard/ui/cheat-panel/shared/imports.js';
import * as api from '/base-standard/ui/cheat-panel/shared/api.js';

const BANNER_ID = 'lcp-plot-mode-banner';

export default class LcpPlotMode extends ChoosePlotInterfaceMode {
    /**
     * @override — swallow Esc / right-click / controller-menu and exit cleanly so the engine's pause
     * menu never opens. Mirrors interface-mode-acquire-tile.js:367-376. Deliberately does NOT replicate
     * the base's `!ViewManager.isWorldInputAllowed -> return true` guard (that pass-through is exactly
     * what leaked Esc to the pause menu). Everything non-cancel passes through (camera, plot picking).
     * Returns InputHandlerState values — never booleans (see the file header for why `true` broke clicks).
     */
    handleInput(inputEvent) {
        try {
            const detail = inputEvent && inputEvent.detail;
            if (!detail) return InputHandlerState.Active;
            // Act only on key/button RELEASE (FINISH), like the base + base placement modes — so there is
            // no separate key-up event left to leak to the pause menu after we switch away.
            if (typeof InputActionStatuses !== 'undefined' && detail.status !== InputActionStatuses.FINISH) return InputHandlerState.Active;
            const isCancel = (typeof inputEvent.isCancelInput === 'function' && inputEvent.isCancelInput())
                || detail.name === 'sys-menu' || detail.name === 'keyboard-escape';
            if (isCancel) {
                api.LOG('LcpPlotMode.handleInput: cancel input (' + detail.name + ') -> exit to default mode');
                InterfaceMode.switchToDefault();
                try { inputEvent.stopPropagation(); inputEvent.preventDefault(); } catch (_) {}
                return InputHandlerState.Handled;   // consumed → pause menu suppressed
            }
        } catch (e) { api.ERR('LcpPlotMode.handleInput failed:', e); }
        return InputHandlerState.Active;            // pass-through: camera, plot cursor, WorldInput plot pick
    }

    /**
     * @override — REQUIRED. ChoosePlotInterfaceMode.transitionFrom() calls this.reset() (before
     * undecorate), but the base class declares NO reset() — every base subclass (acquire-tile,
     * add-to-army, …) defines its own. Without it, exit throws "this.reset is not a function", which
     * ABORTS the InterfaceMode switch — the real reason Esc / right-click / the Exit button failed to
     * leave the mode and the banner never cleared. Subclasses that override should call super.reset().
     */
    reset() { this.isPlotProposed = false; }

    /** @override — show the shared exit banner. Subclasses that override should call super.decorate(). */
    decorate(_overlay, _modelGroup) { this._showExitBanner(); }

    /** @override — remove the shared exit banner. Subclasses that override should call super.undecorate(). */
    undecorate(_overlay, _modelGroup) { this._removeExitBanner(); }

    /**
     * Floating top-center banner in the HUD document: a gold title, an instruction line, an optional
     * sub-note, and a clickable "✕ Exit". pointer-events:none on the container so it never eats map
     * clicks; pointer-events:auto ONLY on the Exit button.
     */
    _showExitBanner() {
        try {
            this._removeExitBanner();
            if (typeof document === 'undefined') return;
            const el = document.createElement('div');
            el.id = BANNER_ID;
            el.style.cssText = [
                'position:fixed', 'top:1.2rem', 'left:50%', 'transform:translateX(-50%)',
                'z-index:99999', 'pointer-events:none', 'max-width:90vw',
                'padding:0.5rem 1rem', 'border-radius:0.35rem',
                'background-color:rgba(20,17,11,0.92)', 'border:1px solid #6e5a28',
                'box-shadow:0 6px 22px rgba(0,0,0,0.6)', 'text-align:center',
                "font-family:'TitilliumWeb', sans-serif", 'font-size:0.95rem', 'line-height:1.4', 'color:#e8dcc0',
            ].join(';');

            const title = document.createElement('div');
            title.style.cssText = 'color:#d8b24a;font-weight:bold;letter-spacing:0.03em;';
            title.textContent = this.bannerTitle || 'LCP MODE';
            el.appendChild(title);

            const hint = document.createElement('div');
            hint.textContent = this.hintText || 'Click tiles. Esc or right-click to exit.';
            el.appendChild(hint);

            if (this.hintNote) {
                const note = document.createElement('div');
                note.style.cssText = 'font-size:0.8rem;color:#a89878;';
                note.textContent = this.hintNote;
                el.appendChild(note);
            }

            const btn = document.createElement('button');
            btn.textContent = 'Exit (Esc / right-click)';
            btn.style.cssText = [
                'pointer-events:auto', 'margin-top:0.4rem', 'padding:0.15rem 0.8rem', 'cursor:pointer',
                'background-color:#3a2f16', 'border:1px solid #8a6e2c', 'border-radius:0.25rem',
                'color:#f0e2b8', "font-family:'TitilliumWeb', sans-serif", 'font-size:0.85rem',
            ].join(';');
            btn.addEventListener('click', (ev) => {
                try { ev.stopPropagation(); } catch (_) {}
                try { InterfaceMode.switchToDefault(); } catch (e) { api.ERR('LcpPlotMode exit button failed:', e); }
            });
            el.appendChild(btn);

            (document.body || document.documentElement).appendChild(el);
            this._banner = el;
        } catch (e) { api.ERR('LcpPlotMode banner failed:', e); }
    }

    _removeExitBanner() {
        try {
            const el = this._banner || (typeof document !== 'undefined' && document.getElementById(BANNER_ID));
            if (el && el.parentNode) el.parentNode.removeChild(el);
        } catch (_) {}
        this._banner = null;
    }
}
