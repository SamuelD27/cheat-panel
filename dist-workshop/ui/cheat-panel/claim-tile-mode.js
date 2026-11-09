/**
 * @file claim-tile-mode.js
 * @description Custom interface mode INTERFACEMODE_LCP_CLAIM_TILE — the "grow as I want" tile claimer.
 *
 * Subclasses LcpPlotMode (our shared base over ChoosePlotInterfaceMode), inheriting clean plot-click
 * capture (WorldInput.setPlotSelectionHandler) AND the shared clean exit (Esc / right-click / ✕ button;
 * see lcp-plot-mode-base.js). Clicking a plot claims it for the target city via api.claimPlotForCity
 * with NO 3-tile radius / pending-growth gate — unlike the native EXPAND picker. The mode stays active
 * after each claim so several tiles can be grabbed in one session; exit with Esc / right-click / ✕.
 *
 * The target city is passed in the interface-mode context as { CityID }. We register the handler with
 * InterfaceMode.addHandler at module load; cheat-panel.js side-imports this file so the handler exists
 * before the panel's [Claim] button can ever be clicked. Registration is wrapped in try/catch so a
 * load-order hiccup can never break the panel itself.
 */
import LcpPlotMode from '/base-standard/ui/cheat-panel/lcp-plot-mode-base.js';
import { InterfaceMode } from '/base-standard/ui/cheat-panel/shared/imports.js';
import * as api from '/base-standard/ui/cheat-panel/shared/api.js';

// Extends LcpPlotMode (not ChoosePlotInterfaceMode directly) so it inherits the shared clean-exit
// handleInput override + the on-screen exit banner. See lcp-plot-mode-base.js.
class LcpClaimTileMode extends LcpPlotMode {
    /** @override — accept the mode only if a valid city was supplied; set the exit-banner text. */
    initialize() {
        const cityID = this.Context?.CityID;
        if (!cityID || cityID.id === undefined) {
            api.ERR('claim-tile-mode: no CityID in context — refusing to enter');
            return false;
        }
        this._edgeRefusalShown = false;   // a fresh banner has no status line yet
        this.bannerTitle = 'CLAIM MODE';
        this.hintText = 'Click tiles to claim them for the city.';
        api.LOG('claim-tile-mode: entered for city', cityID.id, '(click tiles to claim; Esc/right-click to exit)');
        return true;
    }

    /**
     * @override — deliberately accept ANY in-bounds plot. This is a cheat, so we skip the engine's
     * adjacency / growth-domain rules; city.purchasePlot is the final arbiter of what actually sticks.
     */
    proposePlot(plot, accept, reject) {
        if (plot && Number.isInteger(plot.x) && Number.isInteger(plot.y)) accept();
        else reject();
    }

    /**
     * @override — base selectPlot commits once then switchToDefault()s. We want to STAY in the mode so
     * the player can claim several tiles in a row, so we commit and just clear the proposed flag.
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
     * @override — claim the clicked plot for the target city.
     * 2026-10-21: on a map wider than 128 a tile near the bottom edge past column 127 is refused (api.checkWideMapEdge:
     * owning it can uncover the strip that crashes the game's terrain renderer). The refusal shows in the banner's
     * status line and the mode stays active; the check writes one LCPD edge.guard breadcrumb per click.
     */
    commitPlot(plot) {
        const cityID = this.Context?.CityID;
        if (!cityID) return;
        const loc = { x: plot.x, y: plot.y };
        const edge = api.checkWideMapEdge(loc, 'claim-mode');
        if (!edge.ok) {
            api.LOG('claim-tile-mode: (' + loc.x + ',' + loc.y + ') refused by the wide-map edge guard (' + edge.reason + ')');
            this.setStatus(api.wideMapEdgeMessage(edge, 'claim'), 'refused');
            this._edgeRefusalShown = true;
            return;
        }
        if (this._edgeRefusalShown) { this.setStatus('', 'info'); this._edgeRefusalShown = false; }   // drop a stale refusal
        api.claimPlotForCity(cityID, loc, { edge });
    }
}

try {
    InterfaceMode.addHandler('INTERFACEMODE_LCP_CLAIM_TILE', new LcpClaimTileMode());
    api.LOG('claim-tile-mode: INTERFACEMODE_LCP_CLAIM_TILE registered');
} catch (e) {
    api.ERR('claim-tile-mode: failed to register interface mode:', e);
}
