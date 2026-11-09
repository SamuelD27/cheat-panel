/**
 * @file tab-map.js
 * @description Map tab — the read-only Map Preview minimap (M5.2 + M7 + M8).
 *
 *   Map Preview — read-only minimap drawn to a canvas using api.getMapSnapshot(). Pure reads from
 *   GameplayMap.* — does NOT touch fog-of-war / visibility, does NOT grant any in-game vision, can't
 *   affect save state. It deliberately reads the WHOLE map regardless of fog, so it doubles as a
 *   "see the hidden map without discovering it" view.
 *
 *     - Feature shading (forest/jungle/reef/ice/…) on top of the biome tint.
 *     - Navigable-river terrain draws as a blue hex (2026-11-02). One the game has no navigable river data for —
 *       what a Creative "Navigable River" paint makes, since setTerrain never writes river data — also gets an
 *       orange edge (orange dot at tiny zoom), a legend chip and a tooltip line. The thin navigable-river line is
 *       drawn only for navigable river data under other terrain (e.g. Flat painted over a real river), with its own
 *       legend bar "Navigable river (other terrain)" and tooltip line.
 *     - Hover tooltip: shows terrain/biome/feature/resource/coords for the plot under the cursor.
 *     - Click-to-pan: clicking a plot pans the real game camera there (api.lookAtPlot, read-only).
 *     - Spotlight filter: multi-select the resources / natural wonders present on the map; when any
 *       are selected, every non-matching plot is dimmed so the matches "pop". Pure canvas overlay —
 *       no engine calls, no vision granted.
 *
 *   Native <input type="checkbox"> is avoided on purpose: Coherent Gameface renders it weirdly in
 *   this build. All toggles are custom buttons (.lcp-row-btn + .active). Legend/chip markers are
 *   drawn as styled <span> swatches (background-color / CSS-border triangle), NOT font glyphs like
 *   ■ ● ▲ — those render as tofu boxes in this build's UI font (M8 fix).
 *
 *   The Map Paint world-editor moved to the CREATIVE tab (tab-creative.js) in M8 so the minimap can
 *   use the full panel width.
 *
 *   Fog of war (2026-10-18): "Reveal map" / "Restore fog" (api.revealMap / api.restoreFog — the
 *   reversible replacement for the old one-way Reveal Map) plus a visual-only "Fog" minimap filter that
 *   darkens the tiles the player has not explored. These are the only Map-tab parts that change vision.
 *   Since 2026-10-20 Reveal map is turned off on maps wider or taller than 128 (api.checkRevealMapSize):
 *   a reveal made the game quit on a 180×94 map. The button greys and the fog line says why.
 *
 * Module-level _state keeps filters/spotlight/zoom across tab switches in a single session.
 */
import * as api from '/base-standard/ui/cheat-panel/shared/api.js';

// ── Progress probe (TEMPORARY diagnostic, M9-fix3) ───────────────────────────
// console.log from this panel's Gameface isolate does NOT reach UI.log, but the
// engine DOES synchronously log "Trying to set maxWidth property to invalid value:
// <x>" whenever we assign a non-length string to an element's style.maxWidth. We
// abuse that as a breadcrumb: the LAST probe label seen in UI.log before a native
// crash pinpoints how far drawMinimap got. Zero layout impact (hidden throwaway
// div). REMOVE once the Map tab is verified stable on large/modded maps.
let _probeEl = null, _probeDoc = null;
function probe(stage, doc) {
    try {
        if (doc) _probeDoc = doc;
        if (!_probeEl && _probeDoc) {
            _probeEl = _probeDoc.createElement('div');
            _probeEl.style.display = 'none';
            (_probeDoc.body || _probeDoc.documentElement).appendChild(_probeEl);
        }
        if (_probeEl) _probeEl.style.maxWidth = stage;   // → "...invalid value: <stage>" in UI.log
    } catch (_) { /* never let the probe itself throw */ }
}

const _state = {
    filters: { cities: true, resources: false, myUnits: true, fog: false },   // fog = minimap fog view (visual only)
    fogWithUnits: false,    // Fog-of-war section: Reveal also grants vision of units/cities (ON) or terrain only (OFF, the safer default)
    spotlight: new Set(),   // keys: 'res:<ResourceType>' and 'nw:<FeatureType>'
    zoom: 18,               // pixels per tile; +/- buttons clamp to [2, 34]
    userZoomed: false,      // once the user clicks −/+ we stop auto-fitting zoom to the panel width
    // Transform-based pan (logical px). The canvas is translate()d inside an overflow:hidden viewport,
    // so it ALWAYS stays clipped inside the panel and pans freely in BOTH axes — unlike the old
    // overflow:auto + scrollLeft box, which never overflowed horizontally (auto-fit sized the canvas
    // to the panel width) and which Gameface scrolls unreliably anyway.
    panX: 0, panY: 0,
};

// Font-independent legend/chip swatches (the UI font lacks ■ ● ▲ ▬, which render as tofu boxes).
const sq  = (c) => '<span style="display:inline-block;width:0.62em;height:0.62em;background:' + c + ';vertical-align:-0.06em;margin-right:0.22rem;border-radius:1px;"></span>';
const bar = (c) => '<span style="display:inline-block;width:0.95em;height:0.28em;background:' + c + ';vertical-align:0.1em;margin-right:0.22rem;border-radius:1px;"></span>';
const tri = (c) => '<span style="display:inline-block;width:0;height:0;border-left:0.32em solid transparent;border-right:0.32em solid transparent;border-bottom:0.55em solid ' + c + ';vertical-align:-0.02em;margin-right:0.22rem;"></span>';
// Filled square with a coloured edge (0.42em + 2 × 0.1em border = the same 0.62em box as sq, no box-sizing needed).
const sqEdge = (c, e) => '<span style="display:inline-block;width:0.42em;height:0.42em;background:' + c + ';border:0.1em solid ' + e + ';vertical-align:-0.06em;margin-right:0.22rem;border-radius:1px;"></span>';
let _snapshotCache = null;
let _snapshotInFlight = false;
let _fogView = null;   // last api.readRevealedStates() result drawn by the Fog filter (tooltip + status reuse it)
let _paintedRiverDrawKey = '';   // last map.draw.paintedRiver breadcrumb (count + mark style), so it logs only on change
// Bumped on every renderMapTab so async callbacks (teleport read-back) from a PREVIOUS render can
// detect they're stale and skip touching the old (detached) canvas/snapshot machinery.
let _renderGen = 0;

// ─── Minimap colors ──────────────────────────────────────────────────
const BIOME_RGB = {
    'BIOME_GRASSLAND': [ 90, 138,  58],
    'BIOME_PLAINS':    [148, 130,  60],
    'BIOME_TROPICAL':  [ 58, 122,  74],
    'BIOME_DESERT':    [200, 168,  92],
    'BIOME_TUNDRA':    [160, 175, 158],
    'BIOME_MARINE':    [ 38,  88, 138],
};
const DEFAULT_LAND_RGB = [120, 120, 80];
const OCEAN = '#1a3358', COAST = '#3a7ab0', NAV_RIVER = '#4a90d0', MOUNTAIN = '#5a5a5a';
const NW_FILL = '#fcd040';
const RIVER_MINOR = '#7ec8e3', RIVER_NAV = '#4a90d0';
// Navigable-river TERRAIN on a plot the game has no navigable river data for (plots[i].river !== 2) — what a
// Creative paint makes, since setTerrain never writes river data. Same blue fill + this orange mark (the Creative
// tab's "done with a note" colour) so a painted tile is visibly different from a real river.
const NAV_RIVER_TERRAIN = 'TERRAIN_NAVIGABLE_RIVER';
const PAINTED_RIVER_MARK = '#ffb347';
const isPaintedRiver = (p) => !!p && p.terr === NAV_RIVER_TERRAIN && p.river !== 2;

// Feature shading — matched by substring so it survives the various exact FeatureType spellings.
// [r,g,b, alpha] : the feature color is blended over the biome base at the given alpha.
const FEATURE_TINTS = [
    [['RAINFOREST', 'JUNGLE'],            [ 28,  92,  44, 0.62]],
    [['FOREST', 'WOODLAND', 'TAIGA'],     [ 34, 78,  40, 0.55]],
    [['MARSH', 'MANGROVE', 'SWAMP'],      [ 60,  74,  46, 0.6]],
    [['OASIS'],                           [ 60, 170,  90, 0.7]],
    [['REEF'],                            [ 40, 160, 160, 0.6]],
    [['ICE', 'SNOW'],                     [225, 235, 245, 0.7]],
    [['VOLCANO'],                         [110,  40,  30, 0.7]],
    [['SAVANNA', 'GRASSLAND_PLAINS'],     [150, 140,  60, 0.4]],
];
function featureTint(feat) {
    if (!feat) return null;
    for (const [keys, rgba] of FEATURE_TINTS) {
        for (const k of keys) if (feat.indexOf(k) !== -1) return rgba;
    }
    return null;
}
function blend(base, rgba) {
    const a = rgba[3];
    return [
        Math.round(base[0] * (1 - a) + rgba[0] * a),
        Math.round(base[1] * (1 - a) + rgba[1] * a),
        Math.round(base[2] * (1 - a) + rgba[2] * a),
    ];
}

function colorForPlot(p) {
    if (!p) return '#000';
    // Checked BEFORE the water branch: TERRAIN_NAVIGABLE_RIVER has no Water attribute (base terrain.xml:79) and
    // real river tiles read water=false, so the old test nested under p.water never ran and every navigable-river
    // hex (real or painted) drew in its biome colour. Painted ones get an extra orange mark in drawMinimap.
    if (p.terr === NAV_RIVER_TERRAIN) return NAV_RIVER;
    if (p.water) {
        let c = '#2a5080';
        if (p.terr === 'TERRAIN_OCEAN') c = OCEAN;
        else if (p.terr === 'TERRAIN_COAST') c = COAST;
        // Reef/ice can sit on water tiles — let the feature tint show.
        const t = featureTint(p.feat);
        if (t) {
            const m = (s) => parseInt(s, 16);
            const base = [m(c.slice(1,3)), m(c.slice(3,5)), m(c.slice(5,7))];
            const b = blend(base, t);
            return 'rgb(' + b[0] + ',' + b[1] + ',' + b[2] + ')';
        }
        return c;
    }
    if (p.mountain) return MOUNTAIN;
    let base = BIOME_RGB[p.biome] || DEFAULT_LAND_RGB;
    if (p.hills) base = [Math.round(base[0]*0.72), Math.round(base[1]*0.72), Math.round(base[2]*0.72)];
    const t = featureTint(p.feat);
    if (t) base = blend(base, t);
    return 'rgb(' + base[0] + ',' + base[1] + ',' + base[2] + ')';
}

function colorForResource(cls) {
    switch (cls) {
        case 'RESOURCECLASS_STRATEGIC': return '#e84a3a';
        case 'RESOURCECLASS_LUXURY':    return '#c060d0';
        case 'RESOURCECLASS_BONUS':     return '#a0e040';
        case 'RESOURCECLASS_TREASURE':  return '#f4d240';
        case 'RESOURCECLASS_FACTORY':   return '#cc8a40';
        default:                        return '#fff';
    }
}

// ── Pointy-top hex geometry (M9) ─────────────────────────────────────────────
// `tileSize` is the hex WIDTH = horizontal spacing between column centers in a row. For a regular
// pointy-top hex that gives circumradius S = tileSize/√3 and row spacing 1.5·S = (√3/2)·tileSize.
// Odd rows are offset +tileSize/2 and Y is flipped (plot y=0 at the bottom) — same offset model as
// the engine minimap (panel-mini-map.js: percentX = (x + oddOffset + 0.5)/(W+0.5)), so plot
// positions stay engine-accurate; we just render the real hex shape instead of a square.
const SQRT3 = Math.sqrt(3);
function hexMetrics(tileSize) {
    const S = tileSize / SQRT3;          // center → top/bottom (pointy) vertex
    return { S, halfW: tileSize / 2, rowSpacing: 1.5 * S };
}
// Canvas buffer size in LOGICAL px (before supersampling).
function hexCanvasSize(W, H, tileSize) {
    const { S, rowSpacing } = hexMetrics(tileSize);
    return { w: W * tileSize + tileSize / 2, h: 2 * S + (H - 1) * rowSpacing };
}
// Center of plot (x,y) in logical canvas px.
function plotCenter(x, y, H, tileSize) {
    const { S, rowSpacing } = hexMetrics(tileSize);
    const offset = (y % 2 === 1) ? tileSize / 2 : 0;
    return { cx: x * tileSize + offset + tileSize / 2, cy: S + (H - 1 - y) * rowSpacing };
}
// Trace a pointy-top hexagon centered at (cx,cy) into the current path.
function hexPath(ctx, cx, cy, tileSize) {
    const { S, halfW } = hexMetrics(tileSize);
    const hs = S / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy - S);
    ctx.lineTo(cx + halfW, cy - hs);
    ctx.lineTo(cx + halfW, cy + hs);
    ctx.lineTo(cx, cy + S);
    ctx.lineTo(cx - halfW, cy + hs);
    ctx.lineTo(cx - halfW, cy - hs);
    ctx.closePath();
}
// Like hexPath but appends to the CURRENT path WITHOUT beginPath(), so many hexes can be
// accumulated into one path and filled in a single ctx.fill() (the M9-fix3 color-batching).
function hexSubPath(ctx, cx, cy, tileSize) {
    const { S, halfW } = hexMetrics(tileSize);
    const hs = S / 2;
    ctx.moveTo(cx, cy - S);
    ctx.lineTo(cx + halfW, cy - hs);
    ctx.lineTo(cx + halfW, cy + hs);
    ctx.lineTo(cx, cy + S);
    ctx.lineTo(cx - halfW, cy + hs);
    ctx.lineTo(cx - halfW, cy - hs);
    ctx.closePath();
}
// Inverse: logical pixel → plot, by nearest hex center over a small neighborhood (handles the
// slanted hex edges correctly, unlike the old square floor()).
function pxToPlot(cx, cy, W, H, tileSize) {
    const { S, rowSpacing } = hexMetrics(tileSize);
    const dyApprox = Math.floor((cy - S) / rowSpacing);
    let best = null, bestD = Infinity;
    for (let dy = dyApprox - 1; dy <= dyApprox + 2; dy++) {
        const y = H - 1 - dy;
        if (y < 0 || y >= H) continue;
        const offset = (y % 2 === 1) ? tileSize / 2 : 0;
        const xApprox = Math.floor((cx - offset - tileSize / 2) / tileSize);
        for (let x = xApprox - 1; x <= xApprox + 2; x++) {
            if (x < 0 || x >= W) continue;
            const c = plotCenter(x, y, H, tileSize);
            const d = (c.cx - cx) * (c.cx - cx) + (c.cy - cy) * (c.cy - cy);
            if (d < bestD) { bestD = d; best = { x, y }; }
        }
    }
    return best;
}

/** Build the set of plot indices matching the active spotlight filters (or null if none active). */
function computeMatchSet(snap, spotlight) {
    if (!spotlight || spotlight.size === 0) return null;
    const W = snap.width;
    const set = new Set();
    if (snap.resources) {
        for (const r of snap.resources) if (r.type && spotlight.has('res:' + r.type)) set.add(r.y * W + r.x);
    }
    if (snap.plots) {
        for (let i = 0; i < snap.plots.length; i++) {
            const p = snap.plots[i];
            if (p && p.nw && p.feat && spotlight.has('nw:' + p.feat)) set.add(i);
        }
    }
    return set;
}

// M9 originally rendered the buffer at 2× the display size and CSS-scaled it down for smoother hex
// edges. That CSS-downscaled canvas (canvas.width ≠ style.width) crashes Coherent Gameface's
// compositor on large maps (confirmed: hard crash opening the Map tab on a 104×64 modded map, no JS
// error — M9-fix). We now render 1:1 (no downscale) and instead cap zoom so the backing store stays
// within a safe pixel budget on any map size.
const MAX_CANVAS_DIM = 4096;        // keep each canvas axis within Gameface's comfortable range
const MAX_CANVAS_PX  = 8_000_000;   // and the total backing store bounded

// Largest tileSize (px/tile) that keeps the canvas within MAX_CANVAS_DIM / MAX_CANVAS_PX for this map.
function maxZoomForMap(W, H) {
    if (!W || !H) return 34;
    let z = 34;
    while (z > 2) {
        const { w, h } = hexCanvasSize(W, H, z);
        if (w <= MAX_CANVAS_DIM && h <= MAX_CANVAS_DIM && w * h <= MAX_CANVAS_PX) break;
        z -= 1;
    }
    return Math.max(2, z);
}

/** Paint the snapshot onto the canvas at the current zoom + filters + spotlight, as pointy-top hexes. */
function drawMinimap(canvas, snap, opts) {
    if (!snap || !snap.width || !snap.height) return;
    const W = snap.width, H = snap.height;
    const tileSize = opts.tileSize;
    const filters = opts.filters;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { w: logW, h: logH } = hexCanvasSize(W, H, tileSize);
    // Render 1:1 — the backing store matches the displayed size, so there is NO CSS downscale
    // (canvas.width === style.width). Zoom is already clamped to maxZoomForMap() by the callers, so
    // these dimensions are guaranteed within MAX_CANVAS_DIM / MAX_CANVAS_PX. Breadcrumb the size
    // BEFORE the heavy draw so a future native crash still leaves the dimensions in the log.
    const cw = Math.ceil(logW), ch = Math.ceil(logH);
    api.LOG('drawMinimap ' + W + '×' + H + ' map → canvas ' + cw + '×' + ch + 'px (zoom ' + tileSize + ')');
    probe('PROBE_1_BEFORE_SIZE', canvas.ownerDocument);
    canvas.width  = cw;
    canvas.height = ch;
    canvas.style.width    = cw + 'px';
    canvas.style.height   = ch + 'px';
    canvas.style.maxWidth = 'none';
    canvas.style.flex     = '0 0 auto';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.lineJoin = 'round';
    probe('PROBE_2_AFTER_SIZE');

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, logW, logH);
    probe('PROBE_3_BG_DONE');

    const matchSet = computeMatchSet(snap, opts.spotlight);
    const { S, halfW } = hexMetrics(tileSize);

    // ── BATCHED draw (M9-fix3) ──────────────────────────────────────────────
    // M9 drew each of ~6656 plots as its OWN beginPath+fill+stroke (+a river stroke
    // +an arc pip) — ~17–23k canvas commands in one synchronous frame, which overruns
    // Coherent Gameface's 2D compositor and HARD-CRASHES the game on large/modded maps.
    // (The engine itself never draws tiles in JS — its minimap is a live:/minimap GPU
    // texture in a <div>.) We collapse all same-color hexes into ONE chunked fill, drop
    // the per-hex stroke entirely, batch rivers into ≤2 strokes, and use fillRect for
    // pips. ~17–23k ops → a few dozen. FILL_CHUNK caps any single path so one fill()
    // can't get pathologically large either.
    const FILL_CHUNK = 1024;

    // Extreme-map safety valve: at tiny zoom the hex shape is invisible anyway, so drop
    // to batched fillRect squares (M8's proven-cheap path) and skip rivers/pips.
    const cheap = (tileSize < 4) || (W * H > 10000 && tileSize < 6);

    probe('PROBE_4_BATCH_BEGIN');
    // Centres of navigable-river-terrain plots with no navigable river data (painted) — marked in orange below.
    const paintedRiverPts = [];
    let navDataOnly = -1;   // hexes with the navigable river LINE (river data under other terrain); -1 = cheap path, not drawn
    if (cheap) {
        const cheapBatches = new Map();   // color -> flat [px, py, ...]
        for (let y = 0; y < H; y++) {
            const rowBase = y * W;
            for (let x = 0; x < W; x++) {
                const p = snap.plots[rowBase + x];
                if (!p) continue;
                const { cx, cy } = plotCenter(x, y, H, tileSize);
                const col = colorForPlot(p);
                let arr = cheapBatches.get(col);
                if (!arr) { arr = []; cheapBatches.set(col, arr); }
                arr.push(cx - halfW, cy - S);
                if (isPaintedRiver(p)) paintedRiverPts.push(cx, cy);
            }
        }
        probe('PROBE_5_BATCH_FILL');
        const cellW = tileSize, cellH = 2 * S;
        for (const [col, arr] of cheapBatches) {
            ctx.fillStyle = col;
            for (let i = 0; i < arr.length; i += 2) ctx.fillRect(arr[i], arr[i + 1], cellW, cellH);
        }
        // Painted river tiles at tiny zoom: an orange centre dot (the hex edge would be invisible here).
        if (paintedRiverPts.length) {
            const dot = Math.max(1, tileSize * 0.6), dotHalf = dot / 2;
            ctx.fillStyle = PAINTED_RIVER_MARK;
            for (let i = 0; i < paintedRiverPts.length; i += 2) ctx.fillRect(paintedRiverPts[i] - dotHalf, paintedRiverPts[i + 1] - dotHalf, dot, dot);
        }
        probe('PROBE_6_RIVERS');
        probe('PROBE_7_WONDERS');
    } else {
        // 1) Bucket every plot's hex by its fill color.
        const colorBatches = new Map();   // color -> flat [cx, cy, ...]
        for (let y = 0; y < H; y++) {
            const rowBase = y * W;
            for (let x = 0; x < W; x++) {
                const p = snap.plots[rowBase + x];
                if (!p) continue;
                const { cx, cy } = plotCenter(x, y, H, tileSize);
                const col = colorForPlot(p);
                let arr = colorBatches.get(col);
                if (!arr) { arr = []; colorBatches.set(col, arr); }
                arr.push(cx, cy);
                if (isPaintedRiver(p)) paintedRiverPts.push(cx, cy);
            }
        }
        probe('PROBE_5_BATCH_FILL');
        // 2) One chunked fill per color (NO per-hex stroke — abutting fills define the
        //    tile edges on their own). Flush every FILL_CHUNK hexes so a single path stays bounded.
        for (const [col, arr] of colorBatches) {
            ctx.fillStyle = col;
            let n = 0;
            ctx.beginPath();
            for (let i = 0; i < arr.length; i += 2) {
                hexSubPath(ctx, arr[i], arr[i + 1], tileSize);
                if (++n >= FILL_CHUNK) { ctx.fill(); ctx.beginPath(); n = 0; }
            }
            if (n > 0) ctx.fill();
        }
        // 3) Rivers — at most 2 strokes total (one per class), each a single batched path.
        //    2026-11-02: a navigable-river-TERRAIN hex is already a solid NAV_RIVER hex, so the RIVER_NAV line (same
        //    blue, invisible there) is drawn only for navigable river DATA under other terrain — the legend's
        //    "Navigable river (other terrain)" bar, e.g. a real river the user painted Flat over.
        const minorPts = [], navPts = [];
        for (let y = 0; y < H; y++) {
            const rowBase = y * W;
            for (let x = 0; x < W; x++) {
                const p = snap.plots[rowBase + x];
                if (!p || !p.river) continue;
                if (p.river === 2 && p.terr === NAV_RIVER_TERRAIN) continue;
                const { cx, cy } = plotCenter(x, y, H, tileSize);
                (p.river === 2 ? navPts : minorPts).push(cx, cy);
            }
        }
        navDataOnly = navPts.length / 2;
        const strokeRivers = (pts, color, wMul) => {
            if (!pts.length) return;
            ctx.strokeStyle = color;
            ctx.lineWidth = Math.max(1, tileSize * wMul);
            ctx.beginPath();
            for (let i = 0; i < pts.length; i += 2) {
                const cx = pts[i], cy = pts[i + 1];
                ctx.moveTo(cx - halfW * 0.8, cy + S * 0.55);
                ctx.lineTo(cx + halfW * 0.8, cy + S * 0.55);
            }
            ctx.stroke();
        };
        strokeRivers(minorPts, RIVER_MINOR, 0.12);
        strokeRivers(navPts, RIVER_NAV, 0.18);
        // 3b) Painted river tiles (navigable-river terrain, no river data): ONE batched orange inner hex edge,
        //     chunked like the fills. Real navigable rivers (river === 2) stay plain blue.
        if (paintedRiverPts.length) {
            ctx.strokeStyle = PAINTED_RIVER_MARK;
            ctx.lineWidth = Math.max(1, tileSize * 0.14);
            let n = 0;
            ctx.beginPath();
            for (let i = 0; i < paintedRiverPts.length; i += 2) {
                hexSubPath(ctx, paintedRiverPts[i], paintedRiverPts[i + 1], tileSize * 0.84);
                if (++n >= FILL_CHUNK) { ctx.stroke(); ctx.beginPath(); n = 0; }
            }
            if (n > 0) ctx.stroke();
        }
        probe('PROBE_6_RIVERS');
        // 4) Natural-wonder pips — fillRect (cheap) instead of one arc() per pip.
        const pip = Math.max(2, tileSize * 0.5), pipHalf = pip / 2;
        ctx.fillStyle = NW_FILL;
        for (let y = 0; y < H; y++) {
            const rowBase = y * W;
            for (let x = 0; x < W; x++) {
                const p = snap.plots[rowBase + x];
                if (!p || !p.nw) continue;
                const { cx, cy } = plotCenter(x, y, H, tileSize);
                ctx.fillRect(cx - pipHalf, cy - pipHalf, pip, pip);
            }
        }
        probe('PROBE_7_WONDERS');
    }

    // ── Resources — batched by class color into one (chunked) fill per class. Modded
    //    maps can have very many resource tiles, so do NOT draw one arc()+fill() per dot. ──
    if (filters.resources && snap.resources?.length) {
        const rad = Math.max(1.5, tileSize * 0.26);
        const byCls = new Map();   // color -> flat [x, y, ...]
        for (const r of snap.resources) {
            const col = colorForResource(r.cls);
            let arr = byCls.get(col);
            if (!arr) { arr = []; byCls.set(col, arr); }
            arr.push(r.x, r.y);
        }
        for (const [col, arr] of byCls) {
            ctx.fillStyle = col;
            let n = 0;
            ctx.beginPath();
            for (let i = 0; i < arr.length; i += 2) {
                const { cx, cy } = plotCenter(arr[i], arr[i + 1], H, tileSize);
                ctx.moveTo(cx + rad, cy);
                ctx.arc(cx, cy, rad, 0, Math.PI * 2);
                if (++n >= FILL_CHUNK) { ctx.fill(); ctx.beginPath(); n = 0; }
            }
            if (n > 0) ctx.fill();
        }
    }
    probe('PROBE_8_RESOURCES');

    // ── Cities — filled hex + outline (few; kept per-shape, hexPath OK here). ──
    if (filters.cities && snap.cities?.length) {
        for (const c of snap.cities) {
            const { cx, cy } = plotCenter(c.x, c.y, H, tileSize);
            hexPath(ctx, cx, cy, tileSize * 0.82);
            ctx.fillStyle   = c.color || '#fff';
            ctx.fill();
            ctx.strokeStyle = c.isCapital ? '#ffffff' : '#000000';
            ctx.lineWidth   = c.isCapital ? Math.max(1, tileSize * 0.12) : Math.max(0.8, tileSize * 0.08);
            ctx.stroke();
        }
    }
    probe('PROBE_9_CITIES');

    // ── My units — filled triangles on top (few; kept per-shape). ──
    if (filters.myUnits && snap.myUnits?.length) {
        for (const u of snap.myUnits) {
            const { cx, cy } = plotCenter(u.x, u.y, H, tileSize);
            const r = Math.max(2, tileSize * 0.4);
            ctx.beginPath();
            ctx.moveTo(cx, cy - r);
            ctx.lineTo(cx - r, cy + r * 0.85);
            ctx.lineTo(cx + r, cy + r * 0.85);
            ctx.closePath();
            ctx.fillStyle = u.color || '#ffd040';
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = Math.max(0.8, tileSize * 0.07);
            ctx.stroke();
        }
    }
    probe('PROBE_10_UNITS');

    // ── Fog view (Fog filter, visual only): darken what the player has NOT explored (state 0) and
    //    lightly shade explored-but-out-of-sight tiles (state 1), from GameplayMap.getRevealedStates.
    //    Same batching as the spotlight dim below (chunked hex paths; fillRect squares at tiny zoom). ──
    const fog = opts.fog;
    if (filters.fog && fog && fog.states && fog.states.length >= W * H) {
        const st = fog.states;
        const layers = [[0, 'rgba(0,0,0,0.82)'], [1, 'rgba(0,0,0,0.36)']];
        for (const [want, fill] of layers) {
            ctx.fillStyle = fill;
            if (cheap) {
                const cellW = tileSize, cellH = 2 * S;
                for (let y = 0; y < H; y++) {
                    const rowBase = y * W;
                    for (let x = 0; x < W; x++) {
                        if (st[rowBase + x] !== want) continue;
                        const { cx, cy } = plotCenter(x, y, H, tileSize);
                        ctx.fillRect(cx - halfW, cy - S, cellW, cellH);
                    }
                }
            } else {
                let n = 0;
                ctx.beginPath();
                for (let y = 0; y < H; y++) {
                    const rowBase = y * W;
                    for (let x = 0; x < W; x++) {
                        if (st[rowBase + x] !== want) continue;
                        const { cx, cy } = plotCenter(x, y, H, tileSize);
                        hexSubPath(ctx, cx, cy, tileSize);
                        if (++n >= FILL_CHUNK) { ctx.fill(); ctx.beginPath(); n = 0; }
                    }
                }
                if (n > 0) ctx.fill();
            }
        }
    }
    probe('PROBE_10B_FOG');

    // ── Spotlight: ONE chunked fill for all dimmed non-matches, ONE stroke for all rings. ──
    if (matchSet) {
        ctx.fillStyle = 'rgba(6,5,3,0.80)';
        let n = 0;
        ctx.beginPath();
        for (let y = 0; y < H; y++) {
            const rowBase = y * W;
            for (let x = 0; x < W; x++) {
                if (matchSet.has(rowBase + x)) continue;
                if (!snap.plots[rowBase + x]) continue;
                const { cx, cy } = plotCenter(x, y, H, tileSize);
                hexSubPath(ctx, cx, cy, tileSize);
                if (++n >= FILL_CHUNK) { ctx.fill(); ctx.beginPath(); n = 0; }
            }
        }
        if (n > 0) ctx.fill();

        ctx.strokeStyle = '#ffe680';
        ctx.lineWidth = Math.max(1, tileSize * 0.16);
        ctx.beginPath();
        for (const i of matchSet) {
            const x = i % W, y = (i - x) / W;
            const { cx, cy } = plotCenter(x, y, H, tileSize);
            hexSubPath(ctx, cx, cy, tileSize * 0.92);
        }
        ctx.stroke();
    }
    probe('PROBE_11_SPOTLIGHT');

    // Decision breadcrumb, only when it changes (redraws are frequent): how many painted river tiles got a mark, and which.
    try {
        const nPainted = paintedRiverPts.length / 2;
        const k = nPainted + (cheap ? 'dot' : 'edge') + ':' + navDataOnly;
        if (k !== _paintedRiverDrawKey) {
            _paintedRiverDrawKey = k;
            api.diag('map.draw.paintedRiver:n=' + nPainted + ',mark=' + (cheap ? 'dot' : 'edge') + ',zoom=' + tileSize
                + ',navLineOtherTerrain=' + (navDataOnly < 0 ? 'off' : navDataOnly));
        }
    } catch (_) { /* diagnostics must never break the minimap */ }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
}

const strip = (s, pfx) => (s && s.indexOf(pfx) === 0) ? s.slice(pfx.length) : (s || '');

/**
 * (Re)build the Map tab content inside `container`. Read-only — no opts needed.
 * @param {HTMLElement} container        the .cheat-map-content element
 */
export function renderMapTab(container) {
    if (!container) return;
    try { api.diagInit(container.ownerDocument || document); } catch (_) {}   // UI.log breadcrumb sink (see api.diag)
    const renderGen = ++_renderGen;   // see _renderGen — staleness token for this render's closures

    container.innerHTML = '';

    // Re-read the map every time the Map tab opens — a snapshot taken before a city was founded (or
    // before the settler existed) would otherwise leave cities/myUnits empty forever. ~6k plots is
    // sub-100ms. (↻ also forces a re-read.)
    _snapshotCache = null;

    // ═══ Section 1: Map Preview ════════════════════════════════════════
    const previewSection = document.createElement('div');
    previewSection.className = 'lcp-section';
    previewSection.textContent = '── Map Preview ──';
    container.appendChild(previewSection);

    // Overlay-toggle filter row (Cities / Resources / Me) + zoom + refresh.
    const filterRow = document.createElement('div');
    filterRow.style.cssText = 'display:flex; align-items:center; gap:0.3rem; margin-bottom:0.3rem; flex-wrap:wrap;';

    const mkToggle = (key, label, title) => {
        const b = document.createElement('button');
        b.className = 'lcp-row-btn';
        b.style.cssText = 'flex:0 0 auto; padding:0.22rem 0.7rem; font-size:1.5rem;';
        b.textContent = label;
        if (title) b.title = title;
        if (_state.filters[key]) b.classList.add('active');
        b.addEventListener('click', () => {
            _state.filters[key] = !_state.filters[key];
            b.classList.toggle('active', _state.filters[key]);
            redraw();
        });
        return b;
    };
    filterRow.appendChild(mkToggle('cities',    'Cities',    'Toggle city markers'));
    filterRow.appendChild(mkToggle('resources', 'Resources', 'Toggle strategic/luxury/bonus resource dots'));
    filterRow.appendChild(mkToggle('myUnits',   'Me',        'Toggle your own units (no AI visible)'));
    filterRow.appendChild(mkToggle('fog',       'Fog',       'Darken the tiles you have not explored (your real fog of war). Visual only: changes nothing in the game.'));

    const zoomGroup = document.createElement('div');
    zoomGroup.style.cssText = 'display:flex; gap:0.2rem; margin-left:auto;';
    const mkZoom = (delta, label, title) => {
        const b = document.createElement('button');
        b.className = 'lcp-row-btn';
        b.style.cssText = 'flex:0 0 auto; padding:0.22rem 0.7rem; font-size:1.5rem; min-width:2rem;';
        b.textContent = label;
        b.title = title;
        b.addEventListener('click', () => {
            const oldZoom = _state.zoom;
            _state.userZoomed = true;   // manual zoom wins over auto-fit from here on
            _state.zoom = Math.max(2, Math.min(34, _state.zoom + delta));
            // Keep whatever sits under the viewport centre fixed while zooming (the canvas scales ~linearly
            // with tileSize about its own 0,0 origin, so rescale the pan offset about the viewport centre).
            const ratio = _state.zoom / oldZoom;
            const vw = viewport.clientWidth, vh = viewport.clientHeight;
            if (vw && vh) {
                _state.panX = vw / 2 - ratio * (vw / 2 - _state.panX);
                _state.panY = vh / 2 - ratio * (vh / 2 - _state.panY);
            }
            redraw();
        });
        return b;
    };
    zoomGroup.appendChild(mkZoom(-2, '−', 'Zoom out'));
    zoomGroup.appendChild(mkZoom( 2, '+', 'Zoom in'));

    // ⤢ Fit — drop to the whole-map overview zoom (clampPan/centerPanOn then centre it). Sets
    // userZoomed so the default fit-to-overflow doesn't immediately re-zoom it on the next redraw.
    const fitBtn = document.createElement('button');
    fitBtn.className = 'lcp-row-btn';
    fitBtn.style.cssText = 'flex:0 0 auto; padding:0.22rem 0.7rem; font-size:1.5rem; min-width:2rem;';
    fitBtn.textContent = '⤢';
    fitBtn.title = 'Fit the whole map in the panel (overview)';
    fitBtn.addEventListener('click', () => {
        const W = _snapshotCache && _snapshotCache.width;
        if (!W) return;
        _state.userZoomed = true;
        const zMax = Math.min(34, maxZoomForMap(W, _snapshotCache.height));
        _state.zoom = Math.max(2, Math.min(zMax, fitMapZoom(W, _snapshotCache.height)));
        redraw();
        centerPanOn();
    });
    zoomGroup.appendChild(fitBtn);

    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'lcp-row-btn';
    refreshBtn.style.cssText = 'flex:0 0 auto; padding:0.22rem 0.7rem; font-size:1.5rem;';
    refreshBtn.textContent = '↻';
    refreshBtn.title = 'Re-read the map (cache invalidated)';
    refreshBtn.addEventListener('click', () => { _snapshotCache = null; redraw(); });
    zoomGroup.appendChild(refreshBtn);
    filterRow.appendChild(zoomGroup);

    container.appendChild(filterRow);

    // ── Fog of war: Reveal map / Restore fog (2026-10-18) ─────────────────────────────────────
    // Replaces the old one-way "Reveal Map" button (Visibility.revealAllPlots = permanent vision that no
    // JS call can take back). api.revealMap() first snapshots the tiles you have not explored, then
    // marks the terrain explored without vision (Units OFF, the default) or grants vision of every tile
    // as a TRACKED grant (Units ON); api.restoreFog() removes that grant and marks the snapshot's tiles
    // unexplored again. Every engine call is feature-detected in api.getFogStatus(): a missing API greys
    // the button and a click explains why instead of throwing. If the game refuses the undoable reveal,
    // the old one-way reveal is offered behind a second click (Units ON only). Does NOT enable teleport to
    // the far hemisphere — unit placement on Distant Lands is a separate engine age-rule (see api.teleportUnitTo).
    const fogSection = document.createElement('div');
    fogSection.className = 'lcp-section';
    fogSection.textContent = '── Fog of war ──';
    container.appendChild(fogSection);

    const fogRow = document.createElement('div');
    fogRow.style.cssText = 'display:flex; align-items:center; gap:0.4rem; margin:0.1rem 0 0.25rem; flex-wrap:wrap;';
    const mkFogBtn = (label, title) => {
        const b = document.createElement('button');
        b.className = 'lcp-row-btn';
        b.style.cssText = 'flex:0 0 auto; padding:0.22rem 0.7rem;';
        b.textContent = label;
        b.title = title;
        fogRow.appendChild(b);
        return b;
    };
    const REVEAL_TITLE = 'Uncover the whole map. The panel first saves which tiles you had not explored, so Restore fog can cover them again.';
    const revealBtn  = mkFogBtn('Reveal map', REVEAL_TITLE);
    const restoreBtn = mkFogBtn('Restore fog', 'Cover again the tiles you had not explored before Reveal map. Tiles your units or cities see now stay visible.');
    const unitsBtn   = mkFogBtn('Units: OFF', 'OFF (default): Reveal map uncovers the terrain only, with no vision and no first contacts. ON: also vision of every unit and city; you meet every civ you see, and that stays.');
    const forgetBtn  = mkFogBtn('Forget', 'Discard the saved fog snapshot. Changes nothing on the map, but the reveal can then no longer be undone.');
    forgetBtn.style.marginLeft = 'auto';
    container.appendChild(fogRow);

    const fogMsg = document.createElement('div');
    fogMsg.style.cssText = 'font-size:0.8rem; color:#b7a88a; margin:0 0 0.2rem 0; min-height:1.1em;';
    container.appendChild(fogMsg);
    const fogNote = document.createElement('div');
    fogNote.style.cssText = 'font-size:0.72rem; color:#8a7c5c; margin:0 0 0.35rem 0;';
    fogNote.textContent = 'Restore fog covers again only the tiles you had not explored before revealing; tiles your units or cities see right now stay visible. Restore before the age ends. '
        + 'Lasting effects that Restore cannot undo: "reveal X% of the map" goals can complete (Antiquity: a free Settler), and probably "Discover all Natural Wonders" '
        + '(Exploration legacy Wanderlust, and the race to be first). With Units ON you also meet every civ you see, which can start events and quests.';
    container.appendChild(fogNote);

    const FOG_TONE = { info: '#b7a88a', ok: '#8fce8f', warn: '#e6b800', err: '#d98a8a' };
    const setFogMsg = (text, tone) => { fogMsg.textContent = text || ''; fogMsg.style.color = FOG_TONE[tone] || FOG_TONE.info; };
    const setFogBtn = (b, on) => { b.style.opacity = on ? '1' : '0.45'; b.style.cursor = on ? 'pointer' : 'default'; };
    // Async results (deferred read-back) must not write into a Map tab that was re-rendered or closed.
    const fogLive = () => {
        if (renderGen !== _renderGen) return false;
        try {
            const b = container.ownerDocument && container.ownerDocument.body;
            if (b && typeof b.contains === 'function') return b.contains(container);
        } catch (_) {}
        return true;
    };
    let fogArmUntil = 0;      // two-click confirm for the one-way fallback reveal
    let fogArmForce = false;  // ... armed because the game refused the undoable reveal (the 2nd click forces the one-way)
    let forgetArmUntil = 0;   // two-click confirm for Forget
    // Errors go to the LCPD channel (api.diag): this isolate's console.error never reaches UI.log.
    const fogUiErr = (stage, e) => { try { api.diag('fog.ui.error:stage=' + api.diagTok(stage) + ',err=' + api.diagTok((e && e.message) || e)); } catch (_) {} };
    const FOG_UNAVAILABLE = 'Fog tools unavailable (the status check failed; details: LCPD fog.ui.error line in UI.log).';
    const oneWayOffer = (res) => (res && res.fallback === 'permanent')
        ? ' Turn Units OFF for a terrain-only reveal, or click Reveal map again within 5 s for the one-way reveal (permanent vision, no undo).'
        : '';

    const fogWhy = (reason, res) => ({
        'multiplayer': 'Blocked in multiplayer.',
        'busy': 'Busy: wait for the current reveal or restore to finish.',
        'no-map': 'No map is loaded.',
        'already-revealed': 'Already revealed. Use Restore fog first.',
        'permanent-done': 'This map was revealed with the one-way method. It cannot be revealed or restored again from the panel.',
        'snapshot-failed': 'Could not read your fog of war' + (res && res.error ? ' (' + res.error + ')' : '') + '.',
        'already-permanent': 'You already see every tile' + (res && res.total ? ' (' + res.visible + ' of ' + res.total + ')' : '')
            + '. That vision comes from a one-way reveal (the old Reveal Map, or Reveal All in the debug window), from a reveal made before the age changed, '
            + 'or from a Units ON reveal whose saved fog was forgotten. '
            + 'Nothing to reveal, and the panel cannot remove that vision: only a save from before it has your fog.',
        'no-read': 'Not available: this game build has no way to read the fog of war.',
        'no-api': 'Not available: this game build lacks the visibility functions the panel needs.',
        'no-terrain-api': 'Terrain-only reveal is not available in this build. Turn Units ON to reveal with vision.',
        'grant-unsafe': 'Not revealed: the game did not confirm that this reveal could be taken back later, so nothing was changed.' + oneWayOffer(res),
        'grant-refused': 'The game refused the undoable reveal (no grant id came back' + (res && res.ret ? ': ' + res.ret : '') + '). Nothing changed.' + oneWayOffer(res),
        'terrain-refused': 'The game refused the terrain reveal' + (res && res.ret ? ' (' + res.ret + ')' : '') + '. Nothing changed.'
            + (res && res.fallback === 'permanent' ? ' Click Reveal map again within 5 s for the one-way reveal (permanent vision, no undo).' : ''),
        'permanent-failed': 'The one-way reveal failed. Nothing changed.',
        'engine-threw': 'The game rejected the call' + (res && res.error ? ': ' + res.error : '') + '.' + oneWayOffer(res),
        'no-record': 'Nothing to restore: reveal with this button first (it saves your fog). A reveal made with the old version or another tool cannot be undone here.',
        'permanent': 'That reveal was one-way and cannot be undone. Only a save from before it has your fog.',
        'record-corrupt': 'The saved fog snapshot is damaged. Use Forget to clear it.',
        'grant-remove-rejected': 'Restore failed: the game rejected the call that takes the reveal\'s vision back. Nothing changed; try again.',
        'age-changed': 'This reveal was made in an earlier age. Covering its tiles again now would also hide what you explored since, so the panel will not do it. Use Forget to clear it.',
        'age-vision-removed': 'This reveal was made in an earlier age: its vision is gone now, but its tiles stay uncovered (covering them would also hide what you explored since). The saved snapshot was cleared.',
        // 2026-10-20 crash guard: res = the size verdict (getFogStatus().size) or the refused revealMap result (W, H, axis)
        'map-too-large': api.revealSizeMessage(Object.assign({ ok: false }, res || {}, { reason: 'map-too-large' })),
        'map-size-unknown': api.revealSizeMessage(Object.assign({ ok: false }, res || {}, { reason: 'map-size-unknown' })),
    }[reason] || ('Not possible right now (' + reason + ').'));

    const describeFog = (st) => {
        if (!st.cap.sp) return 'Blocked in multiplayer.';
        const r = st.record;
        if (r && r.method === 'permanent') return 'Revealed on turn ' + r.turn + ' with the one-way method: it cannot be undone here.';
        if (r && r.stale) {
            return 'Revealed on turn ' + r.turn + ' in an earlier age (' + (r.method === 'grant' ? 'with units' : 'terrain only') + '). '
                + (st.canRestore ? 'Restore fog now only takes its vision back; the tiles stay uncovered.' : 'Its tiles cannot be covered again; use Forget to clear it.');
        }
        if (r) {
            return 'Revealed on turn ' + r.turn + ' (' + (r.method === 'grant' ? 'with units' : 'terrain only') + '). Saved fog: '
                + r.hiddenBefore + ' unexplored tiles' + (st.cap.persist ? ', kept in your save.' : ', kept until Reload UI.');
        }
        if (!st.canReveal) return fogWhy(st.revealWhy, st.size || null);
        return 'Fog of war is on. Reveal map uncovers everything; Restore fog puts your fog back.';
    };

    // Buttons only (greyed when not possible — a click then explains why). Returns the status used.
    const refreshFogButtons = () => {
        let st = null;
        try { st = api.getFogStatus(); } catch (e) { fogUiErr('status', e); }
        if (!st) { setFogBtn(revealBtn, false); setFogBtn(restoreBtn, false); return null; }
        const method = _state.fogWithUnits ? st.revealMethodUnits : st.revealMethodTerrain;
        const armed = Date.now() < fogArmUntil;
        if (!armed) fogArmForce = false;
        const oneWay = (method === 'permanent') || fogArmForce;
        revealBtn.textContent = oneWay ? (armed ? 'Click again: reveal for good' : 'Reveal map (one-way)') : 'Reveal map';
        revealBtn.title = (st.size && !st.size.ok) ? api.revealSizeMessage(st.size) : REVEAL_TITLE;   // 2026-10-20 crash guard
        setFogBtn(revealBtn, st.canReveal && (!!method || fogArmForce));
        setFogBtn(restoreBtn, st.canRestore);
        unitsBtn.textContent = 'Units: ' + (_state.fogWithUnits ? 'ON' : 'OFF');
        unitsBtn.classList.toggle('active', _state.fogWithUnits);
        forgetBtn.style.display = st.record ? '' : 'none';
        forgetBtn.textContent = (Date.now() < forgetArmUntil) ? 'Click again to forget' : 'Forget';
        return st;
    };

    const restoreText = (r) => {
        const inSight = (r.verified && r.visibleNow >= 0) ? r.visibleNow : r.kept;
        switch (r.reason) {
            case 'restored':         return 'Fog restored ✓: ' + r.hid + ' tiles are unexplored again.';
            case 'restored-partial': return 'Fog restored ✓: ' + r.hid + ' tiles are unexplored again; ' + inSight + ' stay uncovered because they are in sight right now (usually your units or cities).';
            case 'nothing-hidden':   return (r.method === 'grant' ? 'Vision removed ✓. ' : '') + 'You had explored the whole map before revealing, so no tile needed covering.';
            case 'kept-visible':
                // revealMap refuses when >= 98% of tiles are already in sight, so vision found here came AFTER the reveal
                if (r.method === 'grant' && r.grantState === 'missing') {
                    return 'Fog NOT restored: the game no longer had this reveal\'s vision on record, so the panel could not take it back, and the tiles stay in sight. '
                        + 'Only a save from before the reveal has your fog. Details: LCPD fog.* lines in UI.log.';
                }
                if (r.method === 'grant') {
                    return 'Fog NOT restored: the game took a vision grant back, but the tiles are still in sight. That vision comes from something the panel cannot undo '
                        + '(a reveal the game did not record, or a one-way reveal such as Reveal All in the debug window). Only a save from before the reveal has your fog. Details: LCPD fog.* lines in UI.log.';
                }
                return 'Fog NOT restored: the tiles are in sight from a one-way reveal made after this one (the old Reveal Map, or Reveal All in the debug window), which the panel cannot undo. '
                    + 'Only a save from before it has your fog.';
            case 'kept-explored':    return 'Vision removed (other units are hidden again), but the game refused to mark the terrain unexplored, so the explored map stays uncovered. Details: LCPD fog.* lines in UI.log.';
            case 'kept-all':         return 'The game refused to cover any tile again. Details: LCPD fog.* lines in UI.log.';
            case 'binding-rejected': return 'Restore failed: the game rejected the un-reveal call (' + (r.firstErr || 'bad arguments') + '). Vision was removed; the explored map stays uncovered.';
            case 'threw':            return 'Restore failed: ' + (r.firstErr || 'the un-reveal call threw') + '. Vision was removed; the explored map stays uncovered.';
            default:                 return 'Restore finished (' + r.reason + ').';
        }
    };

    revealBtn.addEventListener('click', () => {
        const st = refreshFogButtons();                 // also drops an expired one-way confirm
        if (!st) { setFogMsg(FOG_UNAVAILABLE, 'err'); return; }
        if (!st.canReveal) {
            const sz = st.size || {};
            api.diag('fog.ui.reveal:blocked,why=' + st.revealWhy + ',W=' + sz.W + ',H=' + sz.H + ',sizeReason=' + sz.reason);
            setFogMsg(fogWhy(st.revealWhy, st.size || null), 'warn');
            return;
        }
        const armed = Date.now() < fogArmUntil;
        const forced = armed && fogArmForce;            // 2nd click after the game refused the undoable reveal
        const method = forced ? 'permanent' : (_state.fogWithUnits ? st.revealMethodUnits : st.revealMethodTerrain);
        if (!method) { setFogMsg(fogWhy(_state.fogWithUnits ? 'no-api' : 'no-terrain-api', null), 'warn'); return; }
        let allowPermanent = false;
        if (method === 'permanent') {
            if (!armed) {
                fogArmUntil = Date.now() + 5000;
                fogArmForce = false;
                setFogMsg('This game build only offers the ONE-WAY reveal (permanent vision, no undo). Click again within 5 s to go ahead.', 'warn');
                refreshFogButtons();
                setTimeout(() => { if (fogLive()) refreshFogButtons(); }, 5100);
                return;
            }
            allowPermanent = true;
        }
        fogArmUntil = 0;
        fogArmForce = false;
        setFogMsg('Revealing…', 'info');
        const res = api.revealMap({
            withUnits: _state.fogWithUnits || forced,
            allowPermanent,
            method: forced ? 'permanent' : undefined,
            onDone: (r) => {
                _snapshotCache = null;   // the next draw re-reads the map (cities, units, fog view)
                if (!fogLive()) return;
                if (r.ok) {
                    setFogMsg('Map revealed ✓ (' + (r.method === 'grant' ? 'with units' : r.method === 'terrain' ? 'terrain only' : 'one-way') + '). '
                        + (r.method === 'permanent' ? 'This one cannot be undone.' : 'Restore fog puts your fog back.'), 'ok');
                } else {
                    setFogMsg('The game took the reveal, but the map had not changed after ' + (Math.round(r.ms / 100) / 10) + ' s ('
                        + r.hiddenNow + ' tiles still unexplored). Restore fog undoes whatever was applied.', 'warn');
                }
                refreshFogButtons();
                redraw();
            },
        });
        if (!res.ok) {
            setFogMsg(fogWhy(res.reason, res), 'warn');
            if (res.fallback === 'permanent') {         // the undoable reveal was refused: offer the one-way one behind a 2nd click
                fogArmUntil = Date.now() + 5000;
                fogArmForce = true;
                setTimeout(() => { if (fogLive()) refreshFogButtons(); }, 5100);
            }
        }
        refreshFogButtons();
    });

    restoreBtn.addEventListener('click', () => {
        const st = refreshFogButtons();
        if (!st) { setFogMsg(FOG_UNAVAILABLE, 'err'); return; }
        if (!st.canRestore) { setFogMsg(fogWhy(st.restoreWhy, null), 'warn'); return; }
        setFogMsg('Restoring fog…', 'info');
        const res = api.restoreFog({
            onProgress: (pr) => { if (fogLive()) setFogMsg('Restoring fog… ' + pr.done + ' / ' + pr.total + ' tiles', 'info'); },
            onDone: (r) => {
                _snapshotCache = null;
                if (!fogLive()) return;
                setFogMsg(restoreText(r), r.ok ? 'ok' : 'warn');
                refreshFogButtons();
                redraw();
            },
        });
        if (!res.ok) {
            const partial = (res.reason === 'age-vision-removed');   // an earlier age's reveal: vision taken back, tiles kept
            setFogMsg(fogWhy(res.reason, res), partial ? 'info' : 'warn');
            if (partial) { _snapshotCache = null; redraw(); }
        }
        refreshFogButtons();
    });

    unitsBtn.addEventListener('click', () => {
        _state.fogWithUnits = !_state.fogWithUnits;
        fogArmUntil = 0;                                // a pending one-way confirm belonged to the other setting
        fogArmForce = false;
        api.diag('fog.ui.units:' + (_state.fogWithUnits ? 'on' : 'off'));
        refreshFogButtons();
        setFogMsg(_state.fogWithUnits
            ? 'Units ON: Reveal map also gives vision of every tile, so you see every unit and city and meet every civ you see (that stays after Restore fog). '
              + 'Restore before you end the turn: meeting someone new while revealed can leave a tile in sight for good.'
            : 'Units OFF: Reveal map uncovers the terrain only, with no vision: you meet no one and other units stay hidden. City banners may still show on the uncovered tiles.', 'info');
    });

    forgetBtn.addEventListener('click', () => {
        if (Date.now() > forgetArmUntil) {
            forgetArmUntil = Date.now() + 4000;
            setFogMsg('Forget the saved fog? Restore fog then becomes impossible, and the vision from a Units ON reveal stays for good. Click again within 4 s.', 'warn');
            refreshFogButtons();
            setTimeout(() => { if (fogLive()) refreshFogButtons(); }, 4100);
            return;
        }
        forgetArmUntil = 0;
        const ok = api.forgetFogRecord();
        setFogMsg(ok ? 'Saved fog forgotten. The map was not changed.' : fogWhy('busy', null), ok ? 'info' : 'warn');
        refreshFogButtons();
    });

    {
        const st0 = refreshFogButtons();
        setFogMsg(st0 ? describeFog(st0) : FOG_UNAVAILABLE, st0 ? 'info' : 'err');
    }

    // ── Teleport section ──────────────────────────────────────────────────────
    // A full-width LABELED toggle (it used to be a small .lcp-row-btn chip sat right next to
    // Cities/Resources/Me, so it read as just another filter and was easy to miss). Pick the unit from
    // the IN-PANEL list (or leave it on "World-selected" to use the in-world selection — "both" paths
    // supported), arm, then click a destination tile ON THE MINIMAP — the unit teleports there
    // (api.teleportUnitTo: destroy+recreate — spawns a fresh same-type unit at the target and deletes
    // the original, since true UNITOPERATION_TELEPORT_TO is engine-walled in this build).
    // The whole flow stays inside the panel. Stays armed for repeat teleports; re-arms fresh on every
    // tab open (tpArmed / tpPickedId are deliberately local, NOT module-level _state).
    const tpSection = document.createElement('div');
    tpSection.className = 'lcp-section';
    tpSection.textContent = '── Teleport unit ──';
    container.appendChild(tpSection);

    let tpArmed = false;
    let tpPickedId = null;   // ComponentID of an in-panel-picked unit; null = use the world-selected unit
    let tpInFlight = false;  // one teleport at a time — a destroy+recreate chain must finish before the next

    const tpBtn = document.createElement('button');
    tpBtn.className = 'lcp-toggle-btn';   // full-width prominent toggle (same widget as the ∞-move button)
    tpBtn.title = 'Arm, then click a destination tile on the minimap to teleport the chosen unit there';
    container.appendChild(tpBtn);

    const tpMsg = document.createElement('div');
    tpMsg.style.cssText = 'font-size:0.85rem; color:#a89878; margin:0.25rem 0 0.3rem 0; min-height:1.1em;';
    const setTpMsg = (text, warn) => { tpMsg.textContent = text || ''; tpMsg.style.color = warn ? '#e6b800' : '#a89878'; };
    container.appendChild(tpMsg);

    // Standing disclosure of the destroy+recreate trade-off (true UNITOPERATION_TELEPORT_TO is engine-
    // walled in this build, so teleport spawns a fresh same-type unit and deletes the original).
    const tpNote = document.createElement('div');
    tpNote.style.cssText = 'font-size:0.72rem; color:#8a7c5c; margin:0 0 0.35rem 0;';
    tpNote.textContent = 'Note: teleport spawns a fresh same-type unit at the target — XP, promotions, custom name, current HP/moves and army membership are not kept.';
    container.appendChild(tpNote);

    // In-panel unit picker — pick WHICH unit to teleport without leaving the panel. Header has a small
    // ↻ to re-read the unit list (units move/spawn). Chips are custom buttons (never native <select>,
    // which Gameface mishandles). The whole picker is part of the normal flow, so it always stays
    // inside the panel. "Both" selection: an in-panel pick overrides; otherwise the world-selected unit.
    const tpPickHeader = document.createElement('div');
    tpPickHeader.style.cssText = 'display:flex; align-items:center; gap:0.4rem; margin:0.1rem 0 0.15rem 0;';
    const tpPickTitle = document.createElement('div');
    tpPickTitle.style.cssText = 'font-size:0.78rem; color:#9a8c6a; letter-spacing:0.03em; text-transform:uppercase;';
    tpPickTitle.textContent = 'Unit to teleport';
    const tpPickRefresh = document.createElement('button');
    tpPickRefresh.className = 'lcp-row-btn';
    tpPickRefresh.style.cssText = 'flex:0 0 auto; padding:0.1rem 0.5rem; font-size:0.82rem; margin-left:auto;';
    tpPickRefresh.textContent = '↻';
    tpPickRefresh.title = 'Re-read your units';
    tpPickHeader.appendChild(tpPickTitle);
    tpPickHeader.appendChild(tpPickRefresh);
    container.appendChild(tpPickHeader);

    const tpPickList = document.createElement('div');
    tpPickList.style.cssText = 'display:flex; flex-wrap:wrap; gap:0.25rem; max-height:8rem; overflow-y:auto; '
        + 'padding:0.2rem; margin-bottom:0.4rem; background:rgba(0,0,0,0.3); border:1px solid rgba(120,100,55,0.25); border-radius:0.2rem;';
    container.appendChild(tpPickList);

    // Re-resolve the chosen unit fresh each time (the picked unit may have moved/died since selection).
    const resolveTpUnit = () => {
        if (tpPickedId) {
            try {
                const u = api.getLocalUnits().find(x => x && x.id && x.id.id === tpPickedId.id && x.id.owner === tpPickedId.owner);
                if (u) return u;
            } catch (_) {}
            tpPickedId = null;   // picked unit no longer exists → fall back to world-selected
        }
        try { return api.getSelectedUnit(); } catch (_) { return null; }
    };

    const buildTpPickList = () => {
        tpPickList.innerHTML = '';
        let units = [];
        try { units = api.getLocalUnits() || []; } catch (e) { api.ERR('teleport unit list failed:', e); }

        // "World-selected" chip — clears the in-panel pick so the live in-world selection is used.
        const worldChip = document.createElement('button');
        worldChip.className = 'lcp-row-btn';
        worldChip.style.cssText = 'flex:0 0 auto; margin:0; padding:0.14rem 0.5rem; font-size:0.82rem;';
        worldChip.textContent = '◎ World-selected';
        worldChip.title = 'Use whatever unit is selected in the game world';
        if (!tpPickedId) worldChip.classList.add('active');
        worldChip.addEventListener('click', () => { tpPickedId = null; markPicked(); refreshTpUi(); });
        tpPickList.appendChild(worldChip);

        for (const u of units) {
            if (!u || !u.id) continue;
            let d; try { d = api.unitDisplay(u); } catch (_) { d = { name: '(unit)', x: -1, y: -1 }; }
            const chip = document.createElement('button');
            chip.className = 'lcp-row-btn';
            chip.style.cssText = 'flex:0 0 auto; margin:0; padding:0.14rem 0.5rem; font-size:0.82rem;';
            chip.textContent = d.name + ' (' + d.x + ',' + d.y + ')';
            chip.dataset.uid = u.id.owner + ':' + u.id.id;
            if (tpPickedId && tpPickedId.id === u.id.id && tpPickedId.owner === u.id.owner) chip.classList.add('active');
            chip.addEventListener('click', () => { tpPickedId = { owner: u.id.owner, id: u.id.id }; markPicked(); refreshTpUi(); });
            tpPickList.appendChild(chip);
        }
        if (!units.length) {
            const empty = document.createElement('div');
            empty.className = 'lcp-list-empty';
            empty.style.cssText = 'font-size:0.82rem;';
            empty.textContent = '(no units found — found a unit, then ↻)';
            tpPickList.appendChild(empty);
        }
    };
    // Toggle the .active highlight without a full rebuild (cheap; keeps scroll position).
    const markPicked = () => {
        for (const b of tpPickList.querySelectorAll('button')) {
            const uid = b.dataset.uid;
            const isWorld = (b.textContent || '').indexOf('World-selected') !== -1;
            const on = isWorld ? !tpPickedId : (tpPickedId && uid === (tpPickedId.owner + ':' + tpPickedId.id));
            b.classList.toggle('active', !!on);
        }
    };
    tpPickRefresh.addEventListener('click', () => { buildTpPickList(); refreshTpUi(); });

    const refreshTpUi = () => {
        tpBtn.classList.toggle('active', tpArmed);
        tpBtn.textContent = tpArmed ? '⚡ Teleport: ARMED — click a minimap tile' : '⚡ Teleport: OFF — click to arm';
        const u = resolveTpUnit();
        const src = tpPickedId ? 'picked' : 'world-selected';
        if (!u) {
            setTpMsg(tpArmed
                ? 'ARMED — but no unit chosen. Pick one from the list above (or select one in the world).'
                : 'Pick a unit above (or select one in the world), arm, then click a destination tile on the minimap.',
                tpArmed);
            return;
        }
        const d = api.unitDisplay(u);
        setTpMsg((tpArmed ? 'ARMED for ' : 'Will teleport ') + d.name + ' (' + d.x + ',' + d.y + ') [' + src + ']'
            + (tpArmed ? ' — click a destination tile on the minimap.' : ' — arm to teleport.'));
    };
    tpBtn.addEventListener('click', () => { tpArmed = !tpArmed; api.LOG('teleport ' + (tpArmed ? 'ARMED' : 'disarmed')); refreshTpUi(); });
    buildTpPickList();
    refreshTpUi();

    // Minimap VIEWPORT — a fixed-size, overflow:hidden window onto a larger canvas. The canvas is
    // absolutely positioned and moved with a CSS transform (translate). This keeps the map ALWAYS
    // clipped inside the panel (it can never spill past the frame), and pans freely in BOTH axes via
    // the transform — no reliance on Gameface's flaky overflow:auto/scrollLeft (the previous approach,
    // which also never overflowed horizontally because auto-fit sizes the canvas to the panel width).
    const REM = (() => { try { return parseFloat(getComputedStyle((container.ownerDocument || document).documentElement).fontSize) || 16; } catch (_) { return 16; } })();
    const VIEW_CAP_PX = Math.round(26 * REM);   // tallest the viewport ever gets (rem-based → scale-safe)
    const viewport = document.createElement('div');
    viewport.style.cssText = 'position:relative; box-sizing:border-box; background:rgba(0,0,0,0.55); '
        + 'margin-bottom:0.3rem; width:100%; max-width:100%; height:' + VIEW_CAP_PX + 'px; '
        + 'overflow:hidden; border:1px solid rgba(120,100,55,0.35); cursor:grab; touch-action:none;';
    const canvas = document.createElement('canvas');
    canvas.className = 'lcp-minimap';
    canvas.style.cssText = 'position:absolute; left:0; top:0; display:block; image-rendering:auto; '
        + 'transform-origin:0 0; will-change:transform;';
    viewport.appendChild(canvas);

    // Hover tooltip (absolutely positioned inside the viewport so it can never leave the panel).
    const tip = document.createElement('div');
    tip.style.cssText = 'position:absolute; pointer-events:none; display:none; z-index:5; '
        + 'background:rgba(20,17,11,0.95); border:1px solid #6e5a28; color:#e8dcc0; '
        + 'padding:0.2rem 0.4rem; font-size:0.72rem; line-height:1.35; border-radius:0.2rem; max-width:14rem;';
    viewport.appendChild(tip);
    container.appendChild(viewport);

    // ── Pan helpers ───────────────────────────────────────────────────────────
    // Clamp the pan so the canvas always covers / centres inside the viewport (never dragged out of
    // sight), then write the transform. Sizes are in LOGICAL px (the canvas is 1:1 — no CSS scale).
    const applyPan = () => { canvas.style.transform = 'translate(' + Math.round(_state.panX) + 'px,' + Math.round(_state.panY) + 'px)'; };
    const clampPan = () => {
        const vw = viewport.clientWidth, vh = viewport.clientHeight;
        const cw = canvas.width, ch = canvas.height;
        if (!vw || !vh || !cw || !ch) return;   // not laid out yet (hidden tab) — leave pan as-is
        _state.panX = (cw <= vw) ? Math.round((vw - cw) / 2) : Math.min(0, Math.max(vw - cw, _state.panX));
        _state.panY = (ch <= vh) ? Math.round((vh - ch) / 2) : Math.min(0, Math.max(vh - ch, _state.panY));
        applyPan();
    };
    // Centre the viewport on a focus plot (capital / unit) if given, else on the map centre. Used on
    // the initial draw + the Fit button so an OVERFLOWING (pannable) map opens showing something useful
    // rather than its top-left corner; clampPan() then keeps it on-screen.
    const centerPanOn = (fx, fy) => {
        const vw = viewport.clientWidth, vh = viewport.clientHeight;
        const cw = canvas.width, ch = canvas.height;
        if (!vw || !vh || !cw || !ch) return;
        if (Number.isFinite(fx) && Number.isFinite(fy) && _snapshotCache && _snapshotCache.height) {
            const c = plotCenter(fx, fy, _snapshotCache.height, _state.zoom);
            _state.panX = Math.round(vw / 2 - c.cx);
            _state.panY = Math.round(vh / 2 - c.cy);
        } else {
            _state.panX = Math.round((vw - cw) / 2);
            _state.panY = Math.round((vh - ch) / 2);
        }
        clampPan();
    };
    // NB: the viewport keeps a CONSTANT height (VIEW_CAP_PX, set in its CSS above). We deliberately do
    // NOT shrink it to the canvas height — doing so made `ch <= vh` always true in clampPan(), which
    // pinned panY to centre and KILLED vertical drag-pan for wide-and-short maps (and made the height
    // jump mid-zoom). With a fixed box, vertical pan engages the moment the map is taller than the box,
    // and clampPan() centres a shorter map in the (dark) letterbox band.

    const plotAtEvent = (e) => {
        if (!_snapshotCache || !_snapshotCache.width) return null;
        // Use untransformed viewport rect + explicit pan offset to avoid Gameface getBoundingClientRect transform uncertainty
        const vRect = viewport.getBoundingClientRect();
        const cx = e.clientX - vRect.left - _state.panX;
        const cy = e.clientY - vRect.top - _state.panY;
        if (cx < 0 || cy < 0 || cx > canvas.width || cy > canvas.height) return null;   // outside the map image
        return pxToPlot(cx, cy, _snapshotCache.width, _snapshotCache.height, _state.zoom);
    };
    // Drag-to-pan state (null when no button is down). Set by the viewport mousedown handler below.
    let dragSt = null;
    canvas.addEventListener('mousemove', (e) => {
        if (dragSt && dragSt.moved) return;   // dragging the map — keep the tooltip hidden
        const loc = plotAtEvent(e);
        if (!loc) { tip.style.display = 'none'; return; }
        const snap = _snapshotCache;
        const p = snap.plots[loc.y * snap.width + loc.x];
        if (!p) { tip.style.display = 'none'; return; }
        const res = snap.resources && snap.resources.find(r => r.x === loc.x && r.y === loc.y);
        const parts = [];
        parts.push('<b style="color:#d8b24a;">(' + loc.x + ', ' + loc.y + ')</b>');
        let terrLabel = p.water ? strip(p.terr, 'TERRAIN_') : (p.mountain ? 'MOUNTAIN' : (p.hills ? 'HILLS' : strip(p.terr, 'TERRAIN_')));
        parts.push('Terrain: ' + (terrLabel || '—').replace(/_/g, ' '));
        if (p.biome && !p.water) parts.push('Biome: ' + strip(p.biome, 'BIOME_').replace(/_/g, ' '));
        if (p.feat) parts.push((p.nw ? 'Wonder: ' : 'Feature: ') + (p.featName || strip(p.feat, 'FEATURE_').replace(/_/g, ' ')));
        if (res) parts.push('Resource: <span style="color:' + colorForResource(res.cls) + ';">' + (res.name || strip(res.type, 'RESOURCE_')) + '</span>');
        if (p.river === 1) parts.push('Minor river');
        else if (p.river === 2) parts.push('Navigable river');
        // River data under other terrain (e.g. Flat painted over a real river): the line on the minimap, still drawn in 3D.
        if (p.river === 2 && p.terr !== NAV_RIVER_TERRAIN) parts.push('Navigable river under other terrain (the 3D map still draws the river)');
        // Navigable-river terrain without the game's river data = a painted tile (the 3D map draws no river there).
        if (isPaintedRiver(p)) {
            parts.push('<span style="color:' + PAINTED_RIVER_MARK + ';">River terrain, but the game has '
                + (p.river === 1 ? 'only a minor river' : 'no river') + ' here (painted)</span>');
        }
        if (_state.filters.fog && _fogView && _fogView.states) {
            const fs = _fogView.states[loc.y * snap.width + loc.x];
            parts.push('Fog: ' + (fs === 0 ? 'unexplored' : fs === 2 ? 'in sight' : 'explored'));
        }
        tip.innerHTML = parts.join('<br>');
        tip.style.display = 'block';
        // Position near the cursor but keep the whole tooltip inside the viewport (inside the panel).
        const wrapRect = viewport.getBoundingClientRect();
        let tx = e.clientX - wrapRect.left + 12;
        let ty = e.clientY - wrapRect.top + 12;
        const tw = tip.offsetWidth || 160, th = tip.offsetHeight || 60;
        if (tx + tw > viewport.clientWidth)  tx = Math.max(2, viewport.clientWidth  - tw - 4);
        if (ty + th > viewport.clientHeight) ty = Math.max(2, viewport.clientHeight - th - 4);
        tip.style.left = tx + 'px';
        tip.style.top  = ty + 'px';
    });
    canvas.addEventListener('mouseleave', () => { tip.style.display = 'none'; });

    // What a plain (non-drag) click does: teleport when armed, otherwise pan the camera.
    const handlePlotClick = (e) => {
        const loc = plotAtEvent(e);
        if (!loc) return;
        if (!tpArmed) { api.lookAtPlot(loc); return; }
        if (tpInFlight) { setTpMsg('Teleport already in progress — wait for it to finish…', true); return; }

        const u = resolveTpUnit();
        if (!u) { setTpMsg('No unit chosen — pick one from the list above (or select one in the world).', true); return; }
        const d = api.unitDisplay(u);
        setTpMsg('Teleporting ' + d.name + ' to (' + loc.x + ',' + loc.y + ')…');
        // Liveness check for the async read-back: the tab may have re-rendered (every open/tab
        // select) or the panel closed before the ~2s poll chain finishes. A stale closure must not
        // redraw the old detached canvas (Gameface compositor risk) or fight the live render's
        // module-level snapshot state.
        const tpLive = () => {
            if (renderGen !== _renderGen) return false;
            try {
                const b = canvas.ownerDocument && canvas.ownerDocument.body;
                if (b && typeof b.contains === 'function') return b.contains(canvas);
            } catch (_) {}
            return true;   // can't tell — assume live (worst case: one wasted redraw)
        };
        const res = api.teleportUnitTo(u, loc, {
            onDone: (r) => {
                tpInFlight = false;   // chain finished (success or give-up) — re-arm for the next click
                if (!tpLive()) {
                    api.LOG('teleport result ignored — Map tab re-rendered/closed (moved=' + r.moved + ')');
                    if (r.moved) _snapshotCache = null;   // next open re-reads → triangle is current
                    return;
                }
                if (r.moved) {
                    setTpMsg('Teleported ✓ (' + loc.x + ',' + loc.y + ') — ' + d.name + ' · fresh unit (XP/promotions not kept)');
                    api.lookAtPlot(loc);
                    _snapshotCache = null;   // re-read so the unit triangle moves on the minimap
                    redraw();
                    buildTpPickList();       // refresh the picker's coords (don't touch the success msg)
                } else {
                    const dg = r.diag || {};
                    let extra = ' [create=' + (dg.createSent ? 'sent' : 'NO') + ', dest units ' + dg.destBefore + '→' + dg.destAfter;
                    if (dg.placedElsewhere) extra += ', a NEW unit appeared at (' + dg.placedElsewhere.x + ',' + dg.placedElsewhere.y + ')';
                    extra += ', polls=' + dg.polls + ']';
                    setTpMsg('Teleport failed — no unit placed at (' + loc.x + ',' + loc.y + ').' + extra, true);
                }
            },
        });
        if (res.ok) {
            tpInFlight = true;   // chain started — block another teleport until onDone fires
        } else {
            const why = {
                'same-plot': 'The unit is already on that tile.',
                'mountain': 'Destination is a mountain.',
                'impassable': 'Destination is impassable.',
                'water': 'A land unit can\'t stand on water.',
                'notwater': 'A sea unit needs a water tile.',
                'enemyunit': 'Another player\'s unit is on that tile.',
                'sameclass': 'A same-class unit already occupies that tile.',
                'offmap': 'That tile is outside the map.',
                'multiplayer': 'Blocked in multiplayer.',
                'bad-loc': 'Invalid destination tile.',
                'no-unit': 'No unit to teleport.',
                'distant-lands': 'Can\'t teleport to Distant Lands — the engine won\'t place units on the far hemisphere this age. Pick a tile on your home continent.',
                'send-failed': 'The engine refused the teleport (see UI.log).',
                // 2026-10-21 wide-map edge guard (api.checkWideMapEdge already wrote the edge.guard breadcrumb)
                'wide-map-edge': api.wideMapEdgeMessage(res.edge, 'teleport') || 'Teleport refused: too close to the bottom edge of this wide map.',
            }[res.reason] || ('Blocked: ' + res.reason);
            setTpMsg(why, true);
        }
    };

    // ── Click-and-drag navigation (transform pan) ─────────────────────────────
    // Left-drag GRABS the map and pans it inside the viewport by translating the canvas (clamped so it
    // can't be dragged off-screen). A press that moves less than the threshold is still a click (camera
    // pan / teleport). Window listeners keep mouse events flowing while the button is held — the same
    // proven pattern as the panel header drag in cheat-panel.js. Bound to the VIEWPORT so dragging
    // works anywhere in the box, including any empty margin beside a narrow map.
    const DRAG_THRESHOLD_PX = 5;
    viewport.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;            // left button only
        dragSt = { x: e.clientX, y: e.clientY, px: _state.panX, py: _state.panY, moved: false, logged: false, movLogged: false };
        // Geometry breadcrumb: does mousedown fire, and is there room to pan? (cw>vw / ch>vh). If the
        // canvas is NOT larger than the viewport, clampPan() pins pan to centre → drag can't move it.
        api.diag('drag.down:cw=' + canvas.width + ',vw=' + viewport.clientWidth + ',ch=' + canvas.height
            + ',vh=' + viewport.clientHeight + ',pan=' + Math.round(_state.panX) + '/' + Math.round(_state.panY)
            + ',zoom=' + _state.zoom);
        const endDrag = (ev, asClick) => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            const wasDrag = dragSt && dragSt.moved;
            dragSt = null;
            viewport.style.cursor = 'grab';
            if (asClick && !wasDrag) handlePlotClick(ev);
            else api.LOG('minimap pan end (pan ' + Math.round(_state.panX) + ',' + Math.round(_state.panY) + ')');
        };
        const onMove = (ev) => {
            if (!dragSt) return;
            // One-shot: proves the window mousemove is delivered AT ALL, independent of the 5px threshold
            // below. drag.move present but drag.pan absent ⇒ moved under threshold / clamp path; drag.move
            // ABSENT with drag.down present ⇒ window mousemove is dead in this isolate (the real suspect).
            if (!dragSt.movLogged) {
                dragSt.movLogged = true;
                api.diag('drag.move:dx=' + (ev.clientX - dragSt.x) + ',dy=' + (ev.clientY - dragSt.y) + ',buttons=' + ev.buttons);
            }
            // Lost the mouseup (cursor left the panel doc)? Treat a buttons-up move as a cancel.
            if (typeof ev.buttons === 'number' && (ev.buttons & 1) === 0) { endDrag(ev, false); return; }
            const dx = ev.clientX - dragSt.x, dy = ev.clientY - dragSt.y;
            if (!dragSt.moved && (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX)) {
                dragSt.moved = true;
                viewport.style.cursor = 'grabbing';
                tip.style.display = 'none';
            }
            if (dragSt.moved) {
                _state.panX = dragSt.px + dx;
                _state.panY = dragSt.py + dy;
                const reqX = _state.panX, reqY = _state.panY;   // requested, pre-clamp
                clampPan();
                // One breadcrumb per drag: did the move fire, and did clampPan() eat the requested pan?
                // reqX !== clampX (and clampX stuck at centre) ⇒ the canvas doesn't overflow → root cause.
                if (!dragSt.logged) {
                    dragSt.logged = true;
                    api.diag('drag.pan:reqX=' + Math.round(reqX) + ',clampX=' + Math.round(_state.panX)
                        + ',reqY=' + Math.round(reqY) + ',clampY=' + Math.round(_state.panY)
                        + ',cw=' + canvas.width + ',vw=' + viewport.clientWidth
                        + ',ch=' + canvas.height + ',vh=' + viewport.clientHeight);
                }
            }
        };
        const onUp = (ev) => endDrag(ev, true);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        e.preventDefault();
    });

    // Legend — laid out as fixed-width chips (3 per line) via flex-wrap. (Inline text + <br> rendered
    // one-item-per-line in this Gameface build; an explicit chip grid is reliable.)
    const legend = document.createElement('div');
    legend.style.cssText = 'display:flex; flex-wrap:wrap; gap:0.1rem 0.7rem; font-size:1.0rem; color:#a89878; '
        + 'line-height:1.5; margin-bottom:0.3rem; max-width:100%;';
    const legendItems = [
        sq('#e84a3a') + 'Strategic',
        sq('#c060d0') + 'Luxury',
        sq('#a0e040') + 'Bonus',
        sq('#f4d240') + 'Treasure',
        sq('#fcd040') + 'Wonder',
        bar('#7ec8e3') + 'Minor river',
        sq(NAV_RIVER) + 'Navigable river',
        bar(RIVER_NAV) + 'Navigable river (other terrain)',
        sqEdge(NAV_RIVER, PAINTED_RIVER_MARK) + 'Painted river',
        sq('#ccc') + 'City',
        tri('#ccc') + 'Unit',
    ];
    for (const html of legendItems) {
        const chip = document.createElement('span');
        // Content-sized chips that wrap as many-per-line as fit. (Rigid flex:0 0 33% + nowrap forced a
        // wide label like "Navigable" past the panel's right edge, which clipped the whole legend.)
        // nowrap still keeps each swatch+label together so a chip never breaks mid-item.
        chip.style.cssText = 'flex:0 1 auto; display:inline-flex; align-items:center; white-space:nowrap;';
        chip.innerHTML = html;
        legend.appendChild(chip);
    }
    const legendHint = document.createElement('span');
    legendHint.style.cssText = 'flex:1 1 100%; color:#8a7c5c; font-size:0.82rem; margin-top:0.1rem; white-space:normal;';
    legendHint.textContent = 'hover = info · click = pan camera (teleport if armed above) · drag = move around the map · −/+ zoom · ⤢ fit whole map';
    legend.appendChild(legendHint);
    container.appendChild(legend);

    const previewMsg = document.createElement('div');
    previewMsg.style.cssText = 'font-size:0.85rem; color:#a89878; margin-bottom:0.4rem; min-height:1.1em;';
    container.appendChild(previewMsg);

    // ── Spotlight filter section ──
    const spotHeader = document.createElement('div');
    spotHeader.style.cssText = 'display:flex; align-items:center; gap:0.4rem; margin:0.2rem 0;';
    const spotTitle = document.createElement('div');
    spotTitle.style.cssText = 'font-size:0.82rem; color:#b89a55; letter-spacing:0.04em; text-transform:uppercase;';
    spotTitle.textContent = 'Spotlight filter';
    const spotClear = document.createElement('button');
    spotClear.className = 'lcp-row-btn';
    spotClear.style.cssText = 'flex:0 0 auto; padding:0.14rem 0.55rem; font-size:0.82rem; margin-left:auto;';
    spotClear.textContent = 'Clear';
    spotClear.title = 'Clear all spotlight selections';
    spotClear.addEventListener('click', () => {
        _state.spotlight.clear();
        for (const b of spotListEl.querySelectorAll('button')) b.classList.remove('active');
        redraw();
    });
    spotHeader.appendChild(spotTitle);
    spotHeader.appendChild(spotClear);
    container.appendChild(spotHeader);

    const spotHint = document.createElement('div');
    spotHint.style.cssText = 'font-size:0.78rem; color:#8a7c5c; margin-bottom:0.2rem;';
    spotHint.textContent = 'Select resources / wonders to highlight; everything else dims.';
    container.appendChild(spotHint);

    const spotListEl = document.createElement('div');
    spotListEl.style.cssText = 'display:flex; flex-wrap:wrap; gap:0.25rem; max-height:11rem; overflow-y:auto; '
        + 'padding:0.2rem; margin-bottom:0.4rem; background:rgba(0,0,0,0.3); border:1px solid rgba(120,100,55,0.25); border-radius:0.2rem;';
    container.appendChild(spotListEl);

    const buildSpotlightList = () => {
        spotListEl.innerHTML = '';
        const snap = _snapshotCache;
        if (!snap || !snap.width) { return; }

        // Distinct resources present (by type), with counts.
        const resMap = new Map();   // type -> { name, cls, count }
        for (const r of (snap.resources || [])) {
            if (!r.type) continue;
            const e = resMap.get(r.type) || { name: r.name || strip(r.type, 'RESOURCE_'), cls: r.cls, count: 0 };
            e.count++; resMap.set(r.type, e);
        }
        // Distinct natural wonders present (by feature type).
        const nwMap = new Map();    // feat -> { name, count }
        for (const p of (snap.plots || [])) {
            if (p && p.nw && p.feat) {
                const e = nwMap.get(p.feat) || { name: p.featName || strip(p.feat, 'FEATURE_'), count: 0 };
                e.count++; nwMap.set(p.feat, e);
            }
        }

        const addGroupLabel = (text) => {
            const l = document.createElement('div');
            l.style.cssText = 'flex:1 1 100%; font-size:0.76rem; color:#9a8c6a; margin:0.15rem 0 0 0;';
            l.textContent = text;
            spotListEl.appendChild(l);
        };
        // Swatch is a color-coded LEFT BORDER on the button itself — not an inline-block <span>.
        // Coherent Gameface in this build can't parse `display:inline-block` (logs 2 warnings per
        // span) and, at this map's volume (~70 distinct resources/wonders), laying out 70 such
        // inner spans in a flex-wrap scroll box hard-crashes the compositor. textContent + a border
        // keeps each chip as cheap as a plain row button (M9-fix2).
        const addChip = (key, label, dotColor) => {
            const b = document.createElement('button');
            b.className = 'lcp-row-btn';
            b.style.cssText = 'flex:0 0 auto; margin:0; padding:0.14rem 0.45rem 0.14rem 0.4rem; font-size:0.82rem; '
                + 'border-left:0.5rem solid ' + (dotColor || 'transparent') + ';';
            b.textContent = label;
            if (_state.spotlight.has(key)) b.classList.add('active');
            b.addEventListener('click', () => {
                if (_state.spotlight.has(key)) { _state.spotlight.delete(key); b.classList.remove('active'); }
                else { _state.spotlight.add(key); b.classList.add('active'); }
                redraw();
            });
            spotListEl.appendChild(b);
        };

        if (nwMap.size) {
            addGroupLabel('Natural wonders');
            for (const [feat, e] of [...nwMap.entries()].sort((a,b) => a[1].name.localeCompare(b[1].name))) {
                addChip('nw:' + feat, e.name.replace(/_/g, ' '), NW_FILL);
            }
        }
        if (resMap.size) {
            addGroupLabel('Resources');
            for (const [type, e] of [...resMap.entries()].sort((a,b) => a[1].name.localeCompare(b[1].name))) {
                addChip('res:' + type, e.name.replace(/_/g, ' ') + ' ×' + e.count, colorForResource(e.cls));
            }
        }
        if (!nwMap.size && !resMap.size) {
            const empty = document.createElement('div');
            empty.className = 'lcp-list-empty';
            empty.textContent = '(no resources or wonders found on the map)';
            spotListEl.appendChild(empty);
        }
    };

    const setStatus = () => {
        const snap = _snapshotCache;
        if (!snap || !snap.width) { previewMsg.textContent = ''; return; }
        let msg = snap.width + '×' + snap.height + ' map · '
            + (snap.cities?.length || 0) + ' cities · '
            + (snap.resources?.length || 0) + ' resources · '
            + (snap.myUnits?.length || 0) + ' your units · zoom ' + _state.zoom + 'px';
        if (_state.spotlight.size) {
            const m = computeMatchSet(snap, _state.spotlight);
            msg += ' · spotlight: ' + (m ? m.size : 0) + ' tiles (' + _state.spotlight.size + ' filters)';
        }
        if (_state.filters.fog && _fogView) msg += ' · fog: ' + _fogView.hidden + ' unexplored, ' + _fogView.visible + ' in sight';
        previewMsg.textContent = msg;
    };

    // Zoom that fits the WHOLE map inside the viewport in BOTH axes (overview) — used by the ⤢ Fit
    // button. (A width-only fit overflowed the fixed-height viewport vertically on tall maps, so the
    // "fit whole map" label was a lie; fit the tighter axis so the entire map is actually visible.)
    const fitMapZoom = (W, H) => {
        const vw = viewport.clientWidth || container.clientWidth || 0;
        const vh = viewport.clientHeight || VIEW_CAP_PX;
        if (!vw || !W || !H) return _state.zoom;
        const hPerTile = (2 / SQRT3) + (H - 1) * (1.5 / SQRT3);   // canvas height per px of tileSize
        return Math.max(2, Math.min(Math.floor((vw - 4) / (W + 0.5)), Math.floor((vh - 4) / hPerTile)));
    };
    // Default zoom = "fit to OVERFLOW": size the map modestly LARGER than the viewport in BOTH axes so
    // a click-and-drag has real left/right AND up/down range the moment the tab opens. The old
    // fit-to-WIDTH sized the canvas to exactly fit the panel → zero horizontal overflow → horizontal
    // pan was dead until the user manually zoomed in (the repeated "can only zoom, not go left/right"
    // report). The ⤢ Fit button restores the whole-map overview. Capped to the safe canvas budget.
    const OVERFLOW = 1.18;
    const fitZoomDefault = (W) => {
        const H = _snapshotCache && _snapshotCache.height;
        const zMax = Math.min(34, maxZoomForMap(W, H));   // never exceed the safe canvas budget
        if (_state.userZoomed) { _state.zoom = Math.min(_state.zoom, zMax); return; }
        const vw = viewport.clientWidth || container.clientWidth;
        const vh = viewport.clientHeight || VIEW_CAP_PX;
        if (!vw || vw < 40 || !W || !H) return;
        const zForW = (vw * OVERFLOW) / (W + 0.5);
        const hPerTile = (2 / SQRT3) + (H - 1) * (1.5 / SQRT3);   // canvas height per px of tileSize
        const zForH = (vh * OVERFLOW) / hPerTile;
        const z = Math.ceil(Math.max(zForW, zForH));             // overflow the harder axis → both pan
        _state.zoom = Math.max(2, Math.min(zMax, z));
    };

    // Fog view for the minimap overlay: re-read on every redraw while the Fog filter is on (one bulk
    // GameplayMap.getRevealedStates call via api.readRevealedStates); null when the filter is off.
    const fogForDraw = () => {
        if (!_state.filters.fog) { _fogView = null; return null; }
        try { const r = api.readRevealedStates(); _fogView = r.ok ? r : null; }
        catch (e) { fogUiErr('read-states', e); _fogView = null; }
        return _fogView;
    };

    const redraw = () => {
        if (!_snapshotCache && !_snapshotInFlight) {
            _snapshotInFlight = true;
            previewMsg.textContent = 'Reading map…';
            setTimeout(() => {
                try { _snapshotCache = api.getMapSnapshot({ includeCities: true, includeResources: true, includeMyUnits: true }); }
                catch (e) { api.ERR('getMapSnapshot failed:', e); previewMsg.textContent = 'Snapshot failed (see UI.log).'; _snapshotInFlight = false; return; }
                _snapshotInFlight = false;
                if (!_snapshotCache || !_snapshotCache.width) { previewMsg.textContent = 'No map data available.'; return; }
                fitZoomDefault(_snapshotCache.width);
                drawMinimap(canvas, _snapshotCache, { filters: _state.filters, spotlight: _state.spotlight, tileSize: _state.zoom, fog: fogForDraw() });
                // Open centred on the capital (else first city / first unit / map centre) so an
                // overflowing map shows something useful immediately and drags out from there.
                const foc = (_snapshotCache.cities || []).find(c => c.isCapital)
                    || (_snapshotCache.cities || [])[0] || (_snapshotCache.myUnits || [])[0];
                centerPanOn(foc && foc.x, foc && foc.y);
                buildSpotlightList();
                setStatus();
            }, 0);
            return;
        }
        if (_snapshotCache) {
            fitZoomDefault(_snapshotCache.width);
            drawMinimap(canvas, _snapshotCache, { filters: _state.filters, spotlight: _state.spotlight, tileSize: _state.zoom, fog: fogForDraw() });
            clampPan();
            setStatus();
        }
    };
    redraw();

    api.LOG('rendered map tab (zoom=' + _state.zoom + ', spotlight=' + _state.spotlight.size + ')');
}
