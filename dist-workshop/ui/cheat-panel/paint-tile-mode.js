/**
 * @file paint-tile-mode.js
 * @description Custom interface mode INTERFACEMODE_LCP_PAINT_TILE — the M5 map-paint tile picker.
 *
 * Subclasses ChoosePlotInterfaceMode (same base used by INTERFACEMODE_LCP_CLAIM_TILE in M4.3), so we
 * inherit WorldInput.setPlotSelectionHandler and a clean exit on Esc / right-click for free. Each plot
 * click paints the configured category/type via api.paintPlotAsync. The mode STAYS ACTIVE after each paint
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
 * Feedback (2026-10-18 rewrite): a WorldBuilder write shows up a moment AFTER the call (see the MAP PAINT
 * header in shared/api.js), so a click now shows an AMBER flash while api.paintPlotAsync applies and
 * verifies the paint, then GREEN (applied — read back from the map), ORANGE (applied with a note — e.g. a
 * resource off its usual terrain, river data that did not follow, a continent the game changed — or a
 * follow-up fix that did not land) or RED (refused / not applied). The banner's status line repeats the
 * outcome with its reason, and the Creative tab lists the last results. The old one-shot read-back flashed
 * red on the first click of every tile even when the paint had worked ("works half the time").
 *
 * The 3D terrain mesh does not redraw live for terrain-type changes (2026-06-13 on 1.4.x; 2026-11-02 binary check on
 * 1.5.0: the in-game view does not listen to TerrainTypeChanged) — the data IS applied, and the flash/status read it
 * back. A save + reload is expected to show terrain shape (inferred). A painted Navigable River is never drawn as a
 * river, live or after reload: the 3D map draws rivers from river data that setTerrain does not write. Such tiles get
 * the panel's own persistent blue mark instead (api.js PAINTED-RIVER STAND-IN OVERLAY, started at the bottom of this
 * file; its overlay group is separate from this mode's placementOverlayGroup, which the base mode resets on exit).
 */
import LcpPlotMode from '/base-standard/ui/cheat-panel/lcp-plot-mode-base.js';
import { InterfaceMode } from '/base-standard/ui/cheat-panel/shared/imports.js';
import * as api from '/base-standard/ui/cheat-panel/shared/api.js';

// Linear RGBA color literals (Civ7 overlay color convention — {x:R, y:G, z:B, w:A}, range 0..1).
const HOVER_FILL   = { x: 1.0, y: 0.95, z: 0.3, w: 0.30 };
const HOVER_EDGE   = { x: 1.0, y: 0.95, z: 0.0, w: 0.90 };
const PENDING_FILL = { x: 1.0, y: 0.70, z: 0.1, w: 0.40 };   // amber: queued, waiting for the engine
const PENDING_EDGE = { x: 0.9, y: 0.55, z: 0.0, w: 1.00 };
const COMMIT_FILL  = { x: 0.2, y: 1.0,  z: 0.4, w: 0.45 };   // green: applied (read back)
const COMMIT_EDGE  = { x: 0.0, y: 0.6,  z: 0.2, w: 1.00 };
const PARTIAL_FILL = { x: 1.0, y: 0.55, z: 0.1, w: 0.45 };   // orange: applied with a note, or a follow-up step did not land
const PARTIAL_EDGE = { x: 0.8, y: 0.35, z: 0.0, w: 1.00 };
const REJECT_FILL  = { x: 1.0, y: 0.25, z: 0.2, w: 0.45 };   // red: refused / not applied
const REJECT_EDGE  = { x: 0.8, y: 0.0,  z: 0.0, w: 1.00 };
const RESULT_FLASH_MS = 2500;

// Banner prefixes are plain words (no ✓/✗ glyphs — symbol glyphs render as tofu in this Gameface font set).
const STATUS_WORD = { ok: 'Done: ', warn: 'Done (note): ', partial: 'Partly done: ', fail: 'Failed: ', refused: 'Refused: ', busy: 'Busy: ' };

// Extends LcpPlotMode (shared clean-exit handleInput + exit banner). See lcp-plot-mode-base.js.
class LcpPaintTileMode extends LcpPlotMode {
    /** @override — accept the mode only if a category + type string were supplied; set exit-banner text. */
    initialize() {
        const category   = this.Context?.Category;
        const typeString = this.Context?.TypeString;
        if (!category || !typeString) {
            api.ERR('paint-tile-mode: missing Category/TypeString in context — refusing to enter');
            return false;
        }
        let typeLabel = typeString;
        try { typeLabel = api.paintTypeLabel(category, typeString); } catch (_) {}
        this._typeLabel = typeLabel;
        this.bannerTitle = 'PAINT MODE — ' + category + ' = ' + typeLabel;
        this.hintText = 'Click tiles. Amber = applying, green = done, orange = done with a note / partly done, red = refused (reason below).';
        // 2026-11-02 honest copy: the 3D map has no live redraw for terrain-type changes; a reload is EXPECTED to show
        // terrain shape (INFERRED, never confirmed in-game) and never shows a painted navigable river (verified).
        const shapesChange = (category === 'Terrain' || category === 'Wonder');
        this.hintNote = shapesChange
            ? 'Terrain shape changes (mountain, hill, flat, water) are expected to show on the 3D map only after a save & reload (not guaranteed). The tile tooltip shows the change right away.'
            : '(if the 3D map does not change right away, the tile still changed: the tile tooltip shows it, and a save & reload is expected to redraw it)';
        let warning = null;
        try { warning = api.paintEntryWarning(category, typeString); } catch (_) {}
        if (warning) this.hintNote = warning;   // the river warning replaces the generic note (it already says what reload does)
        api.diag('paint.mode.enter:' + category + '=' + typeString + ',note=' + (warning ? 'river-warning' : shapesChange ? 'terrain-shape' : 'generic'));
        api.LOG('paint-tile-mode: entered (' + category + ' = ' + typeString + '); click tiles to paint, Esc/right-click to exit');
        return true;
    }

    /**
     * @override — accept any in-bounds plot. api.paintPlotAsync decides per click what is allowed, and the
     * engine read-back decides what actually landed.
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
     * @override — remember the overlay group so commitPlot can paint flashes onto it, then delegate to the
     * shared base (LcpPlotMode) to show the exit banner. `_session` changes on every entry so a result that
     * arrives after the player left (or re-entered) the mode never draws on the new session.
     */
    decorate(overlay, modelGroup) {
        this._activeOverlay = overlay;
        this._session = (this._session || 0) + 1;
        super.decorate(overlay, modelGroup);   // LcpPlotMode shows the shared exit banner
    }

    /** @override — clean up our flash refs; super removes the shared exit banner. */
    undecorate(overlay, modelGroup) {
        this._activeOverlay = null;
        this._session = (this._session || 0) + 1;
        if (this._flashTimers) {
            for (const t of this._flashTimers) { try { clearTimeout(t); } catch (_) {} }
            this._flashTimers = null;
        }
        super.undecorate(overlay, modelGroup);
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

    /** Flash `locs` on the mode's overlay group; auto-clears after `ms` (0 = until cleared by the caller). */
    _flash(locs, fillColor, edgeColor, ms) {
        if (!this._activeOverlay || !locs || !locs.length) return null;
        try {
            const flash = this._activeOverlay.addPlotOverlay();
            flash.addPlots(locs.map(l => GameplayMap.getIndexFromLocation(l)), { fillColor, edgeColor });
            if (ms > 0) {
                if (!this._flashTimers) this._flashTimers = [];
                const t = setTimeout(() => {
                    try { flash.clearAll(); } catch (_) {}
                    if (this._flashTimers) this._flashTimers = this._flashTimers.filter(x => x !== t);
                }, ms);
                this._flashTimers.push(t);
            }
            return flash;
        } catch (e) { api.ERR('paint-tile-mode: flash overlay failed:', e); return null; }
    }

    /** Draw a paint result (flash + banner line) if this mode session is still the one that clicked. */
    _showResult(res, session, loc, pendingFlash) {
        try { if (pendingFlash) pendingFlash.clearAll(); } catch (_) {}
        if (!res || session !== this._session || !this._activeOverlay) return;
        const st = res.status;
        const amber = (st === 'warn' || st === 'partial' || st === 'busy');
        const fill = (st === 'ok') ? COMMIT_FILL : amber ? PARTIAL_FILL : REJECT_FILL;
        const edge = (st === 'ok') ? COMMIT_EDGE : amber ? PARTIAL_EDGE : REJECT_EDGE;
        this._flash((res.plots && res.plots.length) ? res.plots : [loc], fill, edge, RESULT_FLASH_MS);
        this.setStatus((STATUS_WORD[st] || '') + (res.message || ''), st);
    }

    /**
     * @override — paint the plot. The paint is asynchronous: an amber flash marks the tile at once, the
     * result (green / orange / red + reason in the banner) follows when api.paintPlotAsync has verified it.
     */
    commitPlot(plot) {
        const category   = this.Context?.Category;
        const typeString = this.Context?.TypeString;
        if (!category || !typeString) return;
        const loc = { x: plot.x, y: plot.y };
        const session = this._session;
        api.diag('commit:' + category + '=' + typeString + ',@' + loc.x + '/' + loc.y);
        const pending = this._flash([loc], PENDING_FILL, PENDING_EDGE, 0);
        this.setStatus('Applying ' + (this._typeLabel || typeString) + ' at (' + loc.x + ',' + loc.y + ')…', 'pending');
        const live = () => session === this._session;
        let p;
        try {
            p = api.paintPlotAsync(category, typeString, loc, {
                onProgress: (msg) => { if (live()) this.setStatus(msg, 'pending'); },
                onLate: (late) => this._showResult(late, session, loc, null),
            });
        } catch (e) {
            api.diag('paint.err:stage=commit,' + api.diagTok((e && e.message) || e));
            this._showResult({ status: 'fail', message: 'Internal error: ' + String((e && e.message) || e) }, session, loc, pending);
            return;
        }
        p.then(
            (res) => this._showResult(res, session, loc, pending),
            (e) => this._showResult({ status: 'fail', message: 'Internal error: ' + String((e && e.message) || e) }, session, loc, pending)
        );
    }
}

try {
    InterfaceMode.addHandler('INTERFACEMODE_LCP_PAINT_TILE', new LcpPaintTileMode());
    api.LOG('paint-tile-mode: INTERFACEMODE_LCP_PAINT_TILE registered');
} catch (e) {
    api.ERR('paint-tile-mode: failed to register interface mode:', e);
}
// Which map-builder calls this context can reach (typeof checks only, nothing is called), logged once at module load
// so every session's UI.log answers "can the panel reach TerrainBuilder.setRiverInfo?" even with no paint.
try { api.logPaintApiOnce('paint-tile-mode-load'); } catch (_) { /* diagnostics must never break registration */ }
// Painted-river stand-in marker (2026-11-02): this module is evaluated at in-game UI load, in the same JS context that
// runs commitPlot (cheat-panel.js, the game-scope UIScript, imports it), so the marker's overlay group lives here for the
// whole session. initPaintedRiverOverlay only schedules (engine.whenReady + 2 s, retried until the map is ready) and runs
// once per context; every paint result redraws it from api.paintPlotAsync. See api.js PAINTED-RIVER STAND-IN OVERLAY.
try { api.initPaintedRiverOverlay('paint-tile-mode-load'); } catch (_) { /* the marker must never break registration */ }
