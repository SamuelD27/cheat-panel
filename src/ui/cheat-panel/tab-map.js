/**
 * @file tab-map.js
 * @description Map tab — two sections:
 *
 *   1) Map Preview (M5.2) — read-only minimap drawn to a canvas using api.getMapSnapshot().
 *      Pure reads from GameplayMap.* — does NOT touch fog-of-war / visibility, does NOT grant any
 *      in-game vision, can't affect save state. Default render: terrain colors (biome-tinted), with
 *      rivers and natural wonders overlaid. Toggle-button filters (Cities / Resources / My Units)
 *      switch overlays at draw time without re-snapshotting. Zoom +/- buttons change the tile size
 *      (the canvas overflows its scroll-wrap on large maps; you scroll inside the wrap).
 *
 *      Native <input type="checkbox"> is avoided on purpose: Coherent Gameface renders it weirdly in
 *      this build (clicking the checkbox widened the panel and added a black band on the canvas
 *      side). Toggle buttons (.lcp-row-btn + .active) layout cleanly and the click events fire
 *      reliably.
 *
 *   2) Map Paint (M5) — pick category + type → [Paint at clicked tile] enters
 *      INTERFACEMODE_LCP_PAINT_TILE. Mode stays active across clicks; Esc / right-click exits.
 *
 * Module-level _state keeps selection/filters/zoom across tab switches in a single session.
 */
import * as api from '/base-standard/ui/cheat-panel/shared/api.js';

const CATEGORIES = ['Terrain', 'Feature', 'Resource', 'Biome'];

const _state = {
    category: 'Terrain',
    type: null,
    filters: { cities: true, resources: false, myUnits: true },
    zoom: 8,        // pixels per tile; user adjusts with +/- buttons (clamped to [2, 20])
};
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

function colorForPlot(p) {
    if (!p) return '#000';
    if (p.water) {
        if (p.terr === 'TERRAIN_OCEAN') return OCEAN;
        if (p.terr === 'TERRAIN_COAST') return COAST;
        if (p.terr === 'TERRAIN_NAVIGABLE_RIVER') return NAV_RIVER;
        return '#2a5080';
    }
    if (p.mountain) return MOUNTAIN;
    let base = BIOME_RGB[p.biome] || DEFAULT_LAND_RGB;
    if (p.hills) base = [Math.round(base[0]*0.72), Math.round(base[1]*0.72), Math.round(base[2]*0.72)];
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

/**
 * Paint the snapshot onto the canvas at the current zoom.
 * Y axis is flipped (canvas y=0 at top, plot y=0 at bottom — Civ minimap orientation).
 * Hex offset: odd rows shifted right by half a tile.
 */
function drawMinimap(canvas, snap, filters, tileSize) {
    if (!snap || !snap.width || !snap.height) return;
    const W = snap.width, H = snap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width  = Math.ceil(W * tileSize + tileSize / 2);
    canvas.height = H * tileSize;

    // Pin the CSS *display* size to the buffer size. Without this, the canvas (a replaced element
    // with an intrinsic size) gets clamped to the wrap's `max-width:100%` and drawn SCALED DOWN —
    // that was the "minimap too small / bunch of pixels" report. With the display size pinned and
    // maxWidth defeated, an oversized canvas overflows and the wrap's `overflow:auto` scrolls it.
    canvas.style.width    = canvas.width + 'px';
    canvas.style.height   = canvas.height + 'px';
    canvas.style.maxWidth = 'none';
    canvas.style.flex     = '0 0 auto';

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Plots
    for (let y = 0; y < H; y++) {
        const yOdd = y % 2 === 1;
        for (let x = 0; x < W; x++) {
            const p = snap.plots[y * W + x];
            if (!p) continue;
            const px = x * tileSize + (yOdd ? tileSize / 2 : 0);
            const py = (H - 1 - y) * tileSize;
            ctx.fillStyle = colorForPlot(p);
            ctx.fillRect(px, py, tileSize, tileSize);

            if (p.river === 1) { ctx.fillStyle = RIVER_MINOR; ctx.fillRect(px, py + tileSize - Math.max(1, Math.floor(tileSize/8)), tileSize, Math.max(1, Math.floor(tileSize/8))); }
            else if (p.river === 2) { ctx.fillStyle = RIVER_NAV; ctx.fillRect(px, py + tileSize - Math.max(1, Math.floor(tileSize/6)), tileSize, Math.max(1, Math.floor(tileSize/6))); }

            if (p.nw) {
                ctx.fillStyle = NW_FILL;
                const pip = Math.max(2, Math.floor(tileSize * 0.6));
                ctx.fillRect(px + (tileSize - pip) / 2, py + (tileSize - pip) / 2, pip, pip);
            }
        }
    }

    // Resources
    if (filters.resources && snap.resources?.length) {
        for (const r of snap.resources) {
            const px = r.x * tileSize + (r.y % 2 === 1 ? tileSize / 2 : 0);
            const py = (H - 1 - r.y) * tileSize;
            const dot = Math.max(2, Math.floor(tileSize / 2));
            ctx.fillStyle = colorForResource(r.cls);
            ctx.fillRect(px + (tileSize - dot) / 2, py + (tileSize - dot) / 2, dot, dot);
        }
    }

    // Cities — square with outline, white outline for capital.
    if (filters.cities && snap.cities?.length) {
        for (const c of snap.cities) {
            const px = c.x * tileSize + (c.y % 2 === 1 ? tileSize / 2 : 0);
            const py = (H - 1 - c.y) * tileSize;
            const size = Math.max(3, Math.floor(tileSize * 0.85));
            const ox = px + (tileSize - size) / 2;
            const oy = py + (tileSize - size) / 2;
            ctx.fillStyle   = c.color || '#fff';
            ctx.fillRect(ox, oy, size, size);
            ctx.strokeStyle = c.isCapital ? '#ffffff' : '#000000';
            ctx.lineWidth   = c.isCapital ? 1.5 : 1;
            ctx.strokeRect(ox + 0.5, oy + 0.5, size - 1, size - 1);
        }
    }

    // My units — filled triangles in the local civ's color; distinct shape from city squares so the
    // two can sit on the same tile (settler in your capital, say) without ambiguity. Drawn LAST so
    // they're never hidden under cities/resources.
    if (filters.myUnits && snap.myUnits?.length) {
        for (const u of snap.myUnits) {
            const px = u.x * tileSize + (u.y % 2 === 1 ? tileSize / 2 : 0);
            const py = (H - 1 - u.y) * tileSize;
            const cx = px + tileSize / 2;
            const cy = py + tileSize / 2;
            const r = Math.max(2, tileSize * 0.45);
            ctx.beginPath();
            ctx.moveTo(cx, cy - r);
            ctx.lineTo(cx - r, cy + r * 0.85);
            ctx.lineTo(cx + r, cy + r * 0.85);
            ctx.closePath();
            ctx.fillStyle = u.color || '#ffd040';
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1;
            ctx.stroke();
        }
    }
}

/**
 * (Re)build the Map tab content inside `container`.
 * @param {HTMLElement} container        the .cheat-map-content element
 * @param {object} opts
 * @param {() => void} opts.closePanel   close the cheat panel (before entering the paint mode)
 */
export function renderMapTab(container, opts = {}) {
    if (!container) return;
    const closePanel = opts.closePanel || (() => {});

    container.innerHTML = '';

    // Re-read the map every time the Map tab is opened. The snapshot is module-level and was
    // persisting across tab switches / panel reopens, so a snapshot taken before the player founded
    // a city (or before the settler existed) left cities/myUnits empty forever — the "filters show
    // nothing" report. A re-read is sub-100ms for ~6k plots. (↻ also still forces a re-read.)
    _snapshotCache = null;

    // ═══ Section 1: Map Preview ════════════════════════════════════════
    const previewSection = document.createElement('div');
    previewSection.className = 'lcp-section';
    previewSection.textContent = '── Map Preview ──';
    container.appendChild(previewSection);

    // Toggle-button filter row (NOT native checkboxes — Gameface mishandles them in this build).
    const filterRow = document.createElement('div');
    filterRow.style.cssText = 'display:flex; align-items:center; gap:0.3rem; margin-bottom:0.3rem; flex-wrap:wrap;';

    const mkToggle = (key, label, title) => {
        const b = document.createElement('button');
        b.className = 'lcp-row-btn';
        b.style.cssText = 'flex:0 0 auto; padding:0.18rem 0.55rem; font-size:0.78rem;';
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

    // Zoom + Refresh group, pushed to the right.
    const zoomGroup = document.createElement('div');
    zoomGroup.style.cssText = 'display:flex; gap:0.2rem; margin-left:auto;';
    const mkZoom = (delta, label, title) => {
        const b = document.createElement('button');
        b.className = 'lcp-row-btn';
        b.style.cssText = 'flex:0 0 auto; padding:0.18rem 0.55rem; font-size:0.78rem; min-width:1.8rem;';
        b.textContent = label;
        b.title = title;
        b.addEventListener('click', () => {
            _state.zoom = Math.max(2, Math.min(20, _state.zoom + delta));
            redraw();
        });
        return b;
    };
    zoomGroup.appendChild(mkZoom(-2, '−', 'Zoom out'));
    zoomGroup.appendChild(mkZoom( 2, '+', 'Zoom in'));

    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'lcp-row-btn';
    refreshBtn.style.cssText = 'flex:0 0 auto; padding:0.18rem 0.55rem; font-size:0.78rem;';
    refreshBtn.textContent = '↻';
    refreshBtn.title = 'Re-read the map (cache invalidated)';
    refreshBtn.addEventListener('click', () => { _snapshotCache = null; redraw(); });
    zoomGroup.appendChild(refreshBtn);
    filterRow.appendChild(zoomGroup);

    container.appendChild(filterRow);

    // Canvas wrap — scrolls in BOTH axes so a wide/tall canvas can't push the panel layout.
    // NOTE: no `min-width:0` — it made the wrap shrink-to-fit and scale the canvas down. We want
    // the canvas to keep its pinned pixel size and SCROLL inside this box instead.
    const canvasWrap = document.createElement('div');
    canvasWrap.style.cssText = 'background:rgba(0,0,0,0.55); padding:3px; margin-bottom:0.3rem; '
        + 'max-width:100%; max-height:24rem; overflow:auto; '
        + 'border:1px solid rgba(120,100,55,0.35);';
    const canvas = document.createElement('canvas');
    canvas.className = 'lcp-minimap';
    canvas.style.cssText = 'display:block; image-rendering:pixelated;';
    canvasWrap.appendChild(canvas);
    container.appendChild(canvasWrap);

    // Legend
    const legend = document.createElement('div');
    legend.style.cssText = 'font-size:0.68rem; color:#a89878; line-height:1.4; margin-bottom:0.3rem;';
    legend.innerHTML = ''
        + '<span style="color:#fcd040;">●</span> Natural wonder &nbsp; '
        + '<span style="color:#7ec8e3;">▬</span> Minor river &nbsp; '
        + '<span style="color:#4a90d0;">▬</span> Navigable river<br>'
        + '<span style="color:#e84a3a;">■</span> Strategic &nbsp; '
        + '<span style="color:#c060d0;">■</span> Luxury &nbsp; '
        + '<span style="color:#a0e040;">■</span> Bonus &nbsp; '
        + '<span style="color:#f4d240;">■</span> Treasure<br>'
        + '<span>■</span> City (your color, ▲ unit)';
    container.appendChild(legend);

    const previewMsg = document.createElement('div');
    previewMsg.style.cssText = 'font-size:0.78rem; color:#a89878; margin-bottom:0.5rem; min-height:1.1em;';
    container.appendChild(previewMsg);

    const redraw = () => {
        if (!_snapshotCache && !_snapshotInFlight) {
            _snapshotInFlight = true;
            previewMsg.textContent = 'Reading map…';
            setTimeout(() => {
                try { _snapshotCache = api.getMapSnapshot({ includeCities: true, includeResources: true, includeMyUnits: true }); }
                catch (e) { api.ERR('getMapSnapshot failed:', e); previewMsg.textContent = 'Snapshot failed (see UI.log).'; _snapshotInFlight = false; return; }
                _snapshotInFlight = false;
                if (!_snapshotCache || !_snapshotCache.width) { previewMsg.textContent = 'No map data available.'; return; }
                drawMinimap(canvas, _snapshotCache, _state.filters, _state.zoom);
                previewMsg.textContent = _snapshotCache.width + '×' + _snapshotCache.height + ' map · '
                    + (_snapshotCache.cities?.length || 0) + ' cities · '
                    + (_snapshotCache.resources?.length || 0) + ' resources · '
                    + (_snapshotCache.myUnits?.length || 0) + ' your units · zoom ' + _state.zoom + 'px';
            }, 0);
            return;
        }
        if (_snapshotCache) {
            drawMinimap(canvas, _snapshotCache, _state.filters, _state.zoom);
            previewMsg.textContent = _snapshotCache.width + '×' + _snapshotCache.height + ' map · '
                + (_snapshotCache.cities?.length || 0) + ' cities · '
                + (_snapshotCache.resources?.length || 0) + ' resources · '
                + (_snapshotCache.myUnits?.length || 0) + ' your units · zoom ' + _state.zoom + 'px';
        }
    };
    redraw();

    // ═══ Section 2: Map Paint ══════════════════════════════════════════
    const paintSection = document.createElement('div');
    paintSection.className = 'lcp-section';
    paintSection.textContent = '── Map Paint ──';
    container.appendChild(paintSection);

    const statusEl = document.createElement('div');
    statusEl.className = 'lcp-row-msg';
    statusEl.style.cssText = 'font-size:0.8em; line-height:1.3; color:#e6b800; margin:0.2rem 0 0.3rem 0; min-height:1.1em;';
    const updateStatus = () => {
        if (_state.type) statusEl.textContent = 'Selected: ' + _state.category + ' = ' + _state.type;
        else statusEl.textContent = 'Pick a ' + _state.category.toLowerCase() + ' type below, then click [Paint].';
    };

    const catRow = document.createElement('div');
    catRow.className = 'lcp-row-btns';
    catRow.style.marginBottom = '0.3rem';
    const catBtns = {};
    for (const cat of CATEGORIES) {
        const b = document.createElement('button');
        b.className = 'lcp-row-btn';
        b.textContent = cat;
        if (cat === _state.category) b.classList.add('active');
        b.addEventListener('click', () => {
            if (_state.category === cat) return;
            _state.category = cat;
            _state.type = null;
            for (const c of CATEGORIES) catBtns[c].classList.toggle('active', c === cat);
            populateTypes();
            updateStatus();
        });
        catBtns[cat] = b;
        catRow.appendChild(b);
    }
    container.appendChild(catRow);
    container.appendChild(statusEl);

    const paintBtn = document.createElement('button');
    paintBtn.className = 'lcp-toggle-btn';
    paintBtn.textContent = 'Paint at clicked tile';
    paintBtn.style.marginBottom = '0.4rem';
    paintBtn.addEventListener('click', () => {
        if (!_state.type) { statusEl.textContent = 'Pick a ' + _state.category.toLowerCase() + ' type first.'; return; }
        api.enterPaintMode({ category: _state.category, typeString: _state.type }, { closePanel });
    });
    container.appendChild(paintBtn);

    const typeListEl = document.createElement('div');
    typeListEl.className = 'lcp-map-type-list';
    typeListEl.style.cssText = 'display:flex; flex-wrap:wrap; max-height:15rem; overflow-y:auto; padding:0.15rem; gap:0.25rem;';
    container.appendChild(typeListEl);

    const populateTypes = () => {
        typeListEl.innerHTML = '';
        let types = [];
        try { types = api.getMapPaintTypes(_state.category); } catch (e) { api.ERR('getMapPaintTypes failed:', e); }
        if (!types || types.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'lcp-list-empty';
            empty.textContent = '(no ' + _state.category.toLowerCase() + ' types found)';
            typeListEl.appendChild(empty);
            return;
        }
        for (const t of types) {
            const b = document.createElement('button');
            b.className = 'lcp-row-btn';
            b.style.cssText = 'flex: 0 1 auto; margin: 0; padding: 0.15rem 0.4rem; text-align: left;';
            b.textContent = t.name;
            b.title = t.type;
            if (t.type === _state.type) b.classList.add('active');
            b.addEventListener('click', () => {
                _state.type = t.type;
                for (const child of typeListEl.children) child.classList.remove('active');
                b.classList.add('active');
                updateStatus();
            });
            typeListEl.appendChild(b);
        }
    };

    populateTypes();
    updateStatus();
    api.LOG('rendered map tab (category=' + _state.category + ', type=' + (_state.type || '(none)') + ', zoom=' + _state.zoom + ')');
}
