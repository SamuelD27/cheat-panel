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
 * Module-level _state keeps filters/spotlight/zoom across tab switches in a single session.
 */
import * as api from '/base-standard/ui/cheat-panel/shared/api.js';

const _state = {
    filters: { cities: true, resources: false, myUnits: true },
    spotlight: new Set(),   // keys: 'res:<ResourceType>' and 'nw:<FeatureType>'
    zoom: 18,               // pixels per tile; +/- buttons clamp to [2, 34]
    userZoomed: false,      // once the user clicks −/+ we stop auto-fitting zoom to the panel width
};

// Font-independent legend/chip swatches (the UI font lacks ■ ● ▲ ▬, which render as tofu boxes).
const sq  = (c) => '<span style="display:inline-block;width:0.62em;height:0.62em;background:' + c + ';vertical-align:-0.06em;margin-right:0.22rem;border-radius:1px;"></span>';
const bar = (c) => '<span style="display:inline-block;width:0.95em;height:0.28em;background:' + c + ';vertical-align:0.1em;margin-right:0.22rem;border-radius:1px;"></span>';
const tri = (c) => '<span style="display:inline-block;width:0;height:0;border-left:0.32em solid transparent;border-right:0.32em solid transparent;border-bottom:0.55em solid ' + c + ';vertical-align:-0.02em;margin-right:0.22rem;"></span>';
let _snapshotCache = null;
let _snapshotInFlight = false;

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
    if (p.water) {
        let c = '#2a5080';
        if (p.terr === 'TERRAIN_OCEAN') c = OCEAN;
        else if (p.terr === 'TERRAIN_COAST') c = COAST;
        else if (p.terr === 'TERRAIN_NAVIGABLE_RIVER') c = NAV_RIVER;
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

// Supersample factor: render the buffer at SS× the display size, then CSS-scale down so the slanted
// hex edges are anti-aliased instead of stair-stepped. (image-rendering stays 'auto' for smoothing.)
const SUPERSAMPLE = 2;

/** Paint the snapshot onto the canvas at the current zoom + filters + spotlight, as pointy-top hexes. */
function drawMinimap(canvas, snap, opts) {
    if (!snap || !snap.width || !snap.height) return;
    const W = snap.width, H = snap.height;
    const tileSize = opts.tileSize;
    const filters = opts.filters;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { w: logW, h: logH } = hexCanvasSize(W, H, tileSize);
    // Supersample only at small tile sizes (where stair-stepping shows); at large zoom the edges are
    // already many px wide, so SS=1 keeps the buffer from ballooning on big maps.
    const SS = tileSize >= 16 ? 1 : SUPERSAMPLE;
    // Buffer is SS× larger; display (CSS) size is the logical size so the wrap hugs it 1:1.
    canvas.width  = Math.ceil(logW * SS);
    canvas.height = Math.ceil(logH * SS);
    canvas.style.width    = Math.ceil(logW) + 'px';
    canvas.style.height   = Math.ceil(logH) + 'px';
    canvas.style.maxWidth = 'none';
    canvas.style.flex     = '0 0 auto';
    // Draw everything in LOGICAL coordinates; the transform scales up into the buffer.
    ctx.setTransform(SS, 0, 0, SS, 0, 0);
    ctx.lineJoin = 'round';

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, logW, logH);

    const matchSet = computeMatchSet(snap, opts.spotlight);
    const { S, halfW } = hexMetrics(tileSize);

    // Plots — fill each hex; a same-color hairline stroke closes anti-aliasing seams between hexes.
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const p = snap.plots[y * W + x];
            if (!p) continue;
            const { cx, cy } = plotCenter(x, y, H, tileSize);
            const col = colorForPlot(p);
            hexPath(ctx, cx, cy, tileSize);
            ctx.fillStyle = col;
            ctx.fill();
            ctx.strokeStyle = col;
            ctx.lineWidth = 0.6;
            ctx.stroke();

            // River: a thin chord near the lower edges of the hex.
            if (p.river === 1 || p.river === 2) {
                ctx.strokeStyle = (p.river === 2) ? RIVER_NAV : RIVER_MINOR;
                ctx.lineWidth = Math.max(1, tileSize * (p.river === 2 ? 0.18 : 0.12));
                ctx.beginPath();
                ctx.moveTo(cx - halfW * 0.8, cy + S * 0.55);
                ctx.lineTo(cx + halfW * 0.8, cy + S * 0.55);
                ctx.stroke();
            }

            if (p.nw) {
                ctx.fillStyle = NW_FILL;
                const pip = Math.max(2, tileSize * 0.5);
                ctx.beginPath();
                ctx.arc(cx, cy, pip / 2, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    // Resources — center dot.
    if (filters.resources && snap.resources?.length) {
        for (const r of snap.resources) {
            const { cx, cy } = plotCenter(r.x, r.y, H, tileSize);
            const rad = Math.max(1.5, tileSize * 0.26);
            ctx.fillStyle = colorForResource(r.cls);
            ctx.beginPath();
            ctx.arc(cx, cy, rad, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // Cities — filled hex in the civ color with an outline (white = capital).
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

    // My units — filled triangles in the local civ's color (drawn last so they sit on top).
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

    // Spotlight: dim every NON-matching hex so matches pop; ring the matches in gold.
    if (matchSet) {
        ctx.fillStyle = 'rgba(6,5,3,0.80)';
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                if (matchSet.has(y * W + x)) continue;
                const { cx, cy } = plotCenter(x, y, H, tileSize);
                hexPath(ctx, cx, cy, tileSize);
                ctx.fill();
            }
        }
        ctx.strokeStyle = '#ffe680';
        ctx.lineWidth = Math.max(1, tileSize * 0.16);
        for (const i of matchSet) {
            const x = i % W, y = (i - x) / W;
            const { cx, cy } = plotCenter(x, y, H, tileSize);
            hexPath(ctx, cx, cy, tileSize * 0.92);
            ctx.stroke();
        }
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
}

const strip = (s, pfx) => (s && s.indexOf(pfx) === 0) ? s.slice(pfx.length) : (s || '');

/**
 * (Re)build the Map tab content inside `container`. Read-only — no opts needed.
 * @param {HTMLElement} container        the .cheat-map-content element
 */
export function renderMapTab(container) {
    if (!container) return;

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

    const zoomGroup = document.createElement('div');
    zoomGroup.style.cssText = 'display:flex; gap:0.2rem; margin-left:auto;';
    const mkZoom = (delta, label, title) => {
        const b = document.createElement('button');
        b.className = 'lcp-row-btn';
        b.style.cssText = 'flex:0 0 auto; padding:0.22rem 0.7rem; font-size:1.5rem; min-width:2rem;';
        b.textContent = label;
        b.title = title;
        b.addEventListener('click', () => {
            _state.userZoomed = true;   // manual zoom wins over auto-fit from here on
            _state.zoom = Math.max(2, Math.min(34, _state.zoom + delta));
            redraw();
        });
        return b;
    };
    zoomGroup.appendChild(mkZoom(-2, '−', 'Zoom out'));
    zoomGroup.appendChild(mkZoom( 2, '+', 'Zoom in'));

    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'lcp-row-btn';
    refreshBtn.style.cssText = 'flex:0 0 auto; padding:0.22rem 0.7rem; font-size:1.5rem;';
    refreshBtn.textContent = '↻';
    refreshBtn.title = 'Re-read the map (cache invalidated)';
    refreshBtn.addEventListener('click', () => { _snapshotCache = null; redraw(); });
    zoomGroup.appendChild(refreshBtn);
    filterRow.appendChild(zoomGroup);

    container.appendChild(filterRow);

    // Canvas wrap — relative so the hover tooltip can position over it; scrolls in both axes.
    const canvasWrap = document.createElement('div');
    // width:fit-content makes the bordered box hug the canvas, so there's no dark band beside the map.
    // If the canvas is bigger than the panel, max-width/max-height cap the box and it scrolls inside.
    canvasWrap.style.cssText = 'position:relative; background:rgba(0,0,0,0.55); padding:3px; margin-bottom:0.3rem; '
        + 'width:fit-content; max-width:100%; max-height:40rem; overflow:auto; '
        + 'border:1px solid rgba(120,100,55,0.35);';
    const canvas = document.createElement('canvas');
    canvas.className = 'lcp-minimap';
    canvas.style.cssText = 'display:block; image-rendering:auto; cursor:crosshair;';
    canvasWrap.appendChild(canvas);

    // Hover tooltip (absolutely positioned inside the wrap).
    const tip = document.createElement('div');
    tip.style.cssText = 'position:absolute; pointer-events:none; display:none; z-index:5; '
        + 'background:rgba(20,17,11,0.95); border:1px solid #6e5a28; color:#e8dcc0; '
        + 'padding:0.2rem 0.4rem; font-size:0.72rem; line-height:1.35; border-radius:0.2rem; max-width:14rem;';
    canvasWrap.appendChild(tip);
    container.appendChild(canvasWrap);

    const plotAtEvent = (e) => {
        if (!_snapshotCache || !_snapshotCache.width) return null;
        const rect = canvas.getBoundingClientRect();
        return pxToPlot(e.clientX - rect.left, e.clientY - rect.top, _snapshotCache.width, _snapshotCache.height, _state.zoom);
    };
    canvas.addEventListener('mousemove', (e) => {
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
        tip.innerHTML = parts.join('<br>');
        tip.style.display = 'block';
        // Position near the cursor but keep inside the wrap.
        const wrapRect = canvasWrap.getBoundingClientRect();
        let tx = e.clientX - wrapRect.left + 12;
        let ty = e.clientY - wrapRect.top + 12;
        tip.style.left = tx + 'px';
        tip.style.top  = ty + 'px';
    });
    canvas.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
    canvas.addEventListener('click', (e) => {
        const loc = plotAtEvent(e);
        if (loc) api.lookAtPlot(loc);
    });

    // Legend — laid out as fixed-width chips (3 per line) via flex-wrap. (Inline text + <br> rendered
    // one-item-per-line in this Gameface build; an explicit chip grid is reliable.)
    const legend = document.createElement('div');
    legend.style.cssText = 'display:flex; flex-wrap:wrap; font-size:1.2rem; color:#a89878; '
        + 'line-height:1.5; margin-bottom:0.3rem;';
    const legendItems = [
        sq('#e84a3a') + 'Strategic',
        sq('#c060d0') + 'Luxury',
        sq('#a0e040') + 'Bonus',
        sq('#f4d240') + 'Treasure',
        sq('#fcd040') + 'Wonder',
        bar('#7ec8e3') + 'Minor river',
        bar('#4a90d0') + 'Navigable',
        sq('#ccc') + 'City',
        tri('#ccc') + 'Unit',
    ];
    for (const html of legendItems) {
        const chip = document.createElement('span');
        // 3 per line: each chip takes ~1/3 of the row; nowrap keeps swatch + label together.
        chip.style.cssText = 'flex:0 0 33%; display:inline-flex; align-items:center; white-space:nowrap;';
        chip.innerHTML = html;
        legend.appendChild(chip);
    }
    const legendHint = document.createElement('span');
    legendHint.style.cssText = 'flex:1 1 100%; color:#8a7c5c; font-size:0.82rem; margin-top:0.1rem;';
    legendHint.textContent = 'hover a tile = info · click = pan camera';
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
        const addChip = (key, label, dotColor) => {
            const b = document.createElement('button');
            b.className = 'lcp-row-btn';
            b.style.cssText = 'flex:0 0 auto; margin:0; padding:0.14rem 0.45rem; font-size:0.82rem;';
            b.innerHTML = (dotColor ? sq(dotColor) : '') + label;
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
        previewMsg.textContent = msg;
    };

    // Auto-fit zoom so the map fills the panel width (until the user manually zooms). The canvas is
    // W+0.5 tiles wide (the +0.5 is the odd-row hex offset); fit to the content area minus the wrap
    // chrome (~12px padding+border). This removes the empty space beside smaller maps.
    const fitZoomToWidth = (W) => {
        if (_state.userZoomed) return;
        const avail = container.clientWidth;
        if (!avail || avail < 40 || !W) return;
        const z = Math.floor((avail - 12) / (W + 0.5));
        if (z >= 2) _state.zoom = Math.max(2, Math.min(34, z));
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
                fitZoomToWidth(_snapshotCache.width);
                drawMinimap(canvas, _snapshotCache, { filters: _state.filters, spotlight: _state.spotlight, tileSize: _state.zoom });
                buildSpotlightList();
                setStatus();
            }, 0);
            return;
        }
        if (_snapshotCache) {
            fitZoomToWidth(_snapshotCache.width);
            drawMinimap(canvas, _snapshotCache, { filters: _state.filters, spotlight: _state.spotlight, tileSize: _state.zoom });
            setStatus();
        }
    };
    redraw();

    api.LOG('rendered map tab (zoom=' + _state.zoom + ', spotlight=' + _state.spotlight.size + ')');
}
