// PUBLIC (sam-cheat-panel) replacement for claimPlotForCity in src/ui/cheat-panel/shared/api.js.
// scripts/build-workshop.sh swaps the dev block (comment + function) for everything below the marker line.
// The dev build claims with WorldBuilder.MapPlots.setOwnership (unlimited territory): never shipped publicly.
// ---- BLOCK ----
// Claim a plot for a city via purchasePlot (respects city expansion limits and growth).
// This is the standard engine expansion-PURCHASE path, gated to the city's canStart(EXPAND).Plots set
// (growth/ring/gold-limited). Nearby tiles on a developed city. Accepts a city ComponentID or a live city
// object; logs the owning-city before/after.
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
        const before = ownerCityIdAt(loc);

        // Use the standard city.purchasePlot path (engine expansion-PURCHASE, respects growth/limits).
        if (typeof city.purchasePlot === 'function') {
            city.purchasePlot(loc);
            const after = ownerCityIdAt(loc);
            LOG('claimPlotForCity: purchasePlot (' + loc.x + ',' + loc.y + ') for city', city.id?.id,
                '| owning-city before:', before, 'after:', after);
            return true;
        }
        ERR('claimPlotForCity: city.purchasePlot not available');
        return false;
    } catch (e) { ERR('claimPlotForCity failed:', e); return false; }
}
