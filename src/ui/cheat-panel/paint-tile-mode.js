/**
 * @file paint-tile-mode.js
 * @description Custom interface mode INTERFACEMODE_LCP_PAINT_TILE — the M5 map-paint tile picker.
 *
 * Subclasses ChoosePlotInterfaceMode (same base used by INTERFACEMODE_LCP_CLAIM_TILE in M4.3), so we
 * inherit WorldInput.setPlotSelectionHandler and a clean exit on Esc / right-click for free. Each plot
 * click paints the configured category/type via api.paintPlot. The mode STAYS ACTIVE after each paint
 * so the player can paint several plots in one session; exit with Esc / right-click. The context
 * { Category, TypeString } is set by api.enterPaintMode.
 *
 * Dual-registration is mandatory (lesson from M4.3-fix):
 *   - JS side: InterfaceMode.addHandler() at module load (this file)
 *   - DB side: a <Row InterfaceModeType="…"/> in database/interface-modes.xml (game-scope UpdateDatabase)
 * Without the DB row the view switches but no plot input reaches our handler ("Interface Mode '…' not
 * defined in Database" in UI.log). Registration is wrapped in try/catch so a load-order hiccup can
 * never break the rest of the panel.
 *
 * M5.2-fix (paint feedback):
 *   Unlike claim mode where city.purchasePlot triggers a visible border shift, paint mode has NO
 *   built-in engine feedback — WorldBuilder.MapPlots.set* applies server-side but the terrain mesh
 *   often doesn't refresh until the camera moves over the plot or the next turn (see Civ7 tuner —
 *   it doesn't refresh either). The user reported "click but nothing selects it" which is exactly
 *   this: clicks register but you can't tell because there's no visual change.
 *
 *   So we paint our OWN feedback: a yellow cursor overlay where you're about to click (decorateHover)
 *   and a green flash on commit that lingers ~2s before clearing. The flash also confirms whether
 *   set*() rejected the paint (we only flash on success). The actual terrain visual refresh remains
 *   an engine-side limitation; end-turn or camera-pan over the plot will redraw it.
 */
import ChoosePlotInterfaceMode from '/base-standard/ui/interface-modes/interface-mode-choose-plot.js';
import { InterfaceMode } from '/base-standard/ui/cheat-panel/shared/imports.js';
import * as api from '/base-standard/ui/cheat-panel/shared/api.js';

// Linear RGBA color literals (Civ7 overlay color convention — {x:R, y:G, z:B, w:A}, range 0..1).
const HOVER_FILL  = { x: 1.0, y: 0.95, z: 0.3, w: 0.30 };
const HOVER_EDGE  = { x: 1.0, y: 0.95, z: 0.0, w: 0.90 };
const COMMIT_FILL = { x: 0.2, y: 1.0,  z: 0.4, w: 0.45 };
const COMMIT_EDGE = { x: 0.0, y: 0.6,  z: 0.2, w: 1.00 };

class LcpPaintTileMode extends ChoosePlotInterfaceMode {
    /** @override — accept the mode only if a category + type string were supplied. */
    initialize() {
        const category   = this.Context?.Category;
        const typeString = this.Context?.TypeString;
        if (!category || !typeString) {
            api.ERR('paint-tile-mode: missing Category/TypeString in context — refusing to enter');
            return false;
        }
        api.LOG('paint-tile-mode: entered (' + category + ' = ' + typeString + '); click tiles to paint, Esc/right-click to exit');
        return true;
    }

    /**
     * @override — accept any in-bounds plot. WorldBuilder.MapPlots.set* is the final arbiter and
     * fails silently on illegal combinations (e.g. an ocean terrain on an inland plot).
     */
    proposePlot(plot, accept, reject) {
        if (plot && Number.isInteger(plot.x) && Number.isInteger(plot.y)) accept();
        else reject();
    }

    /**
     * @override — base selectPlot commits once then switchToDefault()s. We want to STAY in the mode
     * so the player can paint several plots in a row; matches claim-tile-mode.
     */
    selectPlot(plot, _previousPlot) {
        if (this.isPlotProposed) return false;
        this.isPlotProposed = true;
        this.proposePlot(
            plot,
            () => { this.commitPlot(plot); this.isPlotProposed = false; },
            () => { this.isPlotProposed = false; }
        );
        return false;
    }

    /**
     * @override — remember the overlay group so commitPlot can paint a "flash" overlay onto it.
     * The base group is created in ChoosePlotInterfaceMode's class fields and lives across hovers.
     * Also pop up an on-screen hint so the player knows HOW to paint and (critically) how to EXIT —
     * the picker otherwise gives no on-screen cue, which led to the "I'm trapped on this menu" report.
     */
    decorate(overlay, _modelGroup) {
        this._activeOverlay = overlay;
        this._showHintBanner();
    }

    /** @override — clean up our flash refs AND the hint banner on exit. */
    undecorate(_overlay, _modelGroup) {
        this._activeOverlay = null;
        if (this._flashTimers) {
            for (const t of this._flashTimers) { try { clearTimeout(t); } catch (_) {} }
            this._flashTimers = null;
        }
        this._removeHintBanner();
    }

    /**
     * Floating instruction banner shown while paint mode is active. Fixed to the top-center of the
     * main UI document (interface modes run in the HUD context, not the panel's isolate), with
     * pointer-events:none so it never intercepts the map clicks we depend on. Tells the player the
     * current paint, that they can keep clicking, and — the key fix — that Esc / right-click exits.
     */
    _showHintBanner() {
        try {
            this._removeHintBanner();
            const cat = this.Context?.Category || '';
            const type = this.Context?.TypeString || '';
            const el = document.createElement('div');
            el.id = 'lcp-paint-hint';
            el.style.cssText = [
                'position:fixed', 'top:1.2rem', 'left:50%', 'transform:translateX(-50%)',
                'z-index:99999', 'pointer-events:none', 'max-width:90vw',
                'padding:0.5rem 1rem', 'border-radius:0.35rem',
                'background-color:rgba(20,17,11,0.92)', 'border:1px solid #6e5a28',
                'box-shadow:0 6px 22px rgba(0,0,0,0.6)', 'text-align:center',
                "font-family:'TitilliumWeb', sans-serif", 'font-size:0.95rem', 'line-height:1.4',
                'color:#e8dcc0',
            ].join(';');
            el.innerHTML =
                '<div style="color:#d8b24a;font-weight:bold;letter-spacing:0.03em;">🖌 PAINT MODE — ' +
                    cat + ' = ' + type + '</div>' +
                '<div>Click tiles to paint. <span style="color:#d8b24a;">Esc</span> or ' +
                    '<span style="color:#d8b24a;">right-click</span> to exit.</div>' +
                '<div style="font-size:0.8rem;color:#a89878;">' +
                    '(terrain redraws after a camera move or the next turn)</div>';
            (document.body || document.documentElement).appendChild(el);
            this._hintBanner = el;
        } catch (e) { api.ERR('paint-tile-mode: hint banner failed:', e); }
    }

    _removeHintBanner() {
        try {
            const el = this._hintBanner || document.getElementById('lcp-paint-hint');
            if (el && el.parentNode) el.parentNode.removeChild(el);
        } catch (_) {}
        this._hintBanner = null;
    }

    /**
     * @override — show a yellow cursor highlight over the hovered plot so the user can SEE the
     * picker is following them. Without this the picker has no visual indication that you're
     * "selecting a tile" and clicks feel like they go nowhere.
     */
    decorateHover(plotCoord, cursorOverlay, _cursorModelGroup) {
        if (!cursorOverlay) return;
        try {
            cursorOverlay.clearAll();
            const o = cursorOverlay.addPlotOverlay();
            o.addPlots([GameplayMap.getIndexFromLocation(plotCoord)], { fillColor: HOVER_FILL, edgeColor: HOVER_EDGE });
        } catch (e) { /* overlay APIs are best-effort; never break the mode for cosmetic decoration */ }
    }

    /**
     * @override — paint the plot AND flash a green overlay for ~2s so the click is visibly confirmed.
     * The engine often doesn't refresh terrain mesh immediately (camera-pan or end-turn redraws it),
     * so this is our only reliable per-click feedback.
     */
    commitPlot(plot) {
        const category   = this.Context?.Category;
        const typeString = this.Context?.TypeString;
        if (!category || !typeString) return;

        const ok = api.paintPlot(category, typeString, { x: plot.x, y: plot.y });
        if (!ok || !this._activeOverlay) return;

        try {
            const flash = this._activeOverlay.addPlotOverlay();
            flash.addPlots([GameplayMap.getIndexFromLocation(plot)], { fillColor: COMMIT_FILL, edgeColor: COMMIT_EDGE });
            if (!this._flashTimers) this._flashTimers = [];
            const t = setTimeout(() => {
                try { flash.clearAll(); } catch (_) {}
                if (this._flashTimers) this._flashTimers = this._flashTimers.filter(x => x !== t);
            }, 2000);
            this._flashTimers.push(t);
        } catch (e) { api.ERR('paint-tile-mode: flash overlay failed:', e); }
    }
}

try {
    InterfaceMode.addHandler('INTERFACEMODE_LCP_PAINT_TILE', new LcpPaintTileMode());
    api.LOG('paint-tile-mode: INTERFACEMODE_LCP_PAINT_TILE registered');
} catch (e) {
    api.ERR('paint-tile-mode: failed to register interface mode:', e);
}
