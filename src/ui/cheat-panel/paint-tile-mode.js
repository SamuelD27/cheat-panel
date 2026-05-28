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
 */
import ChoosePlotInterfaceMode from '/base-standard/ui/interface-modes/interface-mode-choose-plot.js';
import { InterfaceMode } from '/base-standard/ui/cheat-panel/shared/imports.js';
import * as api from '/base-standard/ui/cheat-panel/shared/api.js';

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

    /** @override — accept any in-bounds plot. WorldBuilder.MapPlots.set* is the final arbiter. */
    proposePlot(plot, accept, reject) {
        if (plot && Number.isInteger(plot.x) && Number.isInteger(plot.y)) accept();
        else reject();
    }

    /**
     * @override — base selectPlot commits once then switchToDefault()s. We want to STAY in the mode so
     * the player can paint several plots in a row, matching the claim-tile-mode pattern.
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

    /** @override — paint the clicked plot with the configured category/type. */
    commitPlot(plot) {
        const category   = this.Context?.Category;
        const typeString = this.Context?.TypeString;
        if (!category || !typeString) return;
        api.paintPlot(category, typeString, { x: plot.x, y: plot.y });
    }
}

try {
    InterfaceMode.addHandler('INTERFACEMODE_LCP_PAINT_TILE', new LcpPaintTileMode());
    api.LOG('paint-tile-mode: INTERFACEMODE_LCP_PAINT_TILE registered');
} catch (e) {
    api.ERR('paint-tile-mode: failed to register interface mode:', e);
}
