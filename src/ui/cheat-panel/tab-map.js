/**
 * @file tab-map.js
 * @description Map tab — two sections:
 *
 *   1) Map Preview (M5.2) — read-only minimap drawn to a canvas using api.getMapSnapshot().
 *      Pure reads from GameplayMap.* — does NOT touch fog-of-war / visibility, does NOT grant any
 *      in-game vision, can't affect save state. Default render: terrain colors (biome-tinted), with
 *      rivers and natural wonders overlaid. Filter checkboxes (Cities / Resources) toggle those
 *      overlays at draw time without re-snapshotting. The expensive plot iteration is cached at
 *      module level; the [Refresh] button invalidates the cache.
 *
 *   2) Map Paint (M5) — pick a category (Terrain/Feature/Resource/Biome) and a type, then [Paint at
 *      clicked tile] enters the custom map-click mode INTERFACEMODE_LCP_PAINT_TILE (paint-tile-mode.js,
 *      ChoosePlotInterfaceMode subclass). Mode stays active so several plots can be painted in one
 *      session; Esc / right-click exits.
 *
 * Module-level _state keeps selection/filters across tab switches in a single session.
 */
import * as api from '/base-standard/ui/cheat-panel/shared/api.js';

const CATEGORIES = ['Terrain', 'Feature', 'Resource', 'Biome'];

const _state = {
    category: 'Terrain',
    type: null,
    filters: { cities: true, resources: false },
};
let _snapshotCache = null;
// Re-render the canvas on draws when snapshot is missing — guard so the first render doesn't loop.
let _snapshotInFlight = false;

// ─── Minimap colors ──────────────────────────────────────────────────
// Biome tints (RGB triplets). Mountain/water override these; hills darken them.
const BIOME_RGB = {
    'BIOME_GRASSLAND': [ 90, 138,  58],
    'BIOME_PLAINS':    [148, 130,  60],
    'BIOME_TROPICAL':  [ 58, 122,  74],
    'BIOME_DESERT':    [200, 168,  92],
    'BIOME_TUNDRA':    [160, 175, 158],
    'BIOME_MARINE':    [ 38, 88, 138], // shouldn't render (water override), kept for completeness
};
const DEFAULT_LAND_RGB = [120, 120, 80];
const OCEAN     = '#1a3358';
const COAST     = '#3a7ab0';
const NAV_RIVER = '#4a90d0';
const MOUNTAIN  = '#5a5a5a';
const NW_FILL   = '#fcd040';
const RIVER_MINOR_OVERLAY     = '#7ec8e3';
const RIVER_NAVIGABLE_OVERLAY = '#4a90d0';

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

// Resource class -> dot color. Anything we don't recognise gets a small white dot.
function colorForResource(cls) {
    switch (cls) {
        case 'RESOURCECLASS_STRATEGIC':  return '#e84a3a';
        case 'RESOURCECLASS_LUXURY':     return '#c060d0';
        case 'RESOURCECLASS_BONUS':      return '#a0e040';
        case 'RESOURCECLASS_TREASURE':   return '#f4d240';   // treasure resources (post-Antiquity)
        case 'RESOURCECLASS_FACTORY':    return '#cc8a40';   // factory resources (Modern age)
        default:                         return '#fff';
    }
}

/**
 * Paint the snapshot onto the canvas. Tile size auto-scales to fit the canvas wrapper's width.
 * Y axis is flipped (canvas y=0 at top, plot y=0 at bottom — matches the in-game minimap orientation).
 * Hex offset: odd rows are shifted right by half a tile.
 */
function drawMinimap(canvas, snap, filters) {
    if (!snap || !snap.width || !snap.height) return;
    const W = snap.width, H = snap.height;
    const ctx = canvas.getContext('2d');

    const wrapW = canvas.parentElement?.clientWidth || 340;
    // -8px slack for padding; ensure minimum 2px per tile so even huge maps stay visible.
    const tileSize = Math.max(2, Math.floor((wrapW - 8) / (W + 0.5)));
    canvas.width  = Math.ceil(W * tileSize + tileSize / 2);
    canvas.height = H * tileSize;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Plots
    for (let y = 0; y < H; y++) {
        const yRow = y % 2 === 1;
        for (let x = 0; x < W; x++) {
            const p = snap.plots[y * W + x];
            if (!p) continue;
            const px = x * tileSize + (yRow ? tileSize / 2 : 0);
            const py = (H - 1 - y) * tileSize;
            ctx.fillStyle = colorForPlot(p);
            ctx.fillRect(px, py, tileSize, tileSize);

            // Rivers — thin bottom stripe, naturally suggests an edge.
            if (p.river === 1) { ctx.fillStyle = RIVER_MINOR_OVERLAY;     ctx.fillRect(px, py + tileSize - 1, tileSize, 1); }
            else if (p.river === 2) { ctx.fillStyle = RIVER_NAVIGABLE_OVERLAY; ctx.fillRect(px, py + tileSize - 1, tileSize, 1); }

            // Natural wonders — gold center pip + thin border so they stand out at any zoom.
            if (p.nw) {
                ctx.fillStyle = NW_FILL;
                const pip = Math.max(1, Math.floor(tileSize * 0.6));
                ctx.fillRect(px + (tileSize - pip) / 2, py + (tileSize - pip) / 2, pip, pip);
            }
        }
    }

    // Resources (filter)
    if (filters.resources && snap.resources?.length) {
        for (const r of snap.resources) {
            const px = r.x * tileSize + (r.y % 2 === 1 ? tileSize / 2 : 0);
            const py = (H - 1 - r.y) * tileSize;
            const dot = Math.max(1, Math.floor(tileSize / 2));
            ctx.fillStyle = colorForResource(r.cls);
            ctx.fillRect(px + (tileSize - dot) / 2, py + (tileSize - dot) / 2, dot, dot);
        }
    }

    // Cities (filter) — drawn last so they sit on top of resource/NW dots.
    if (filters.cities && snap.cities?.length) {
        for (const c of snap.cities) {
            const px = c.x * tileSize + (c.y % 2 === 1 ? tileSize / 2 : 0);
            const py = (H - 1 - c.y) * tileSize;
            const size = Math.max(2, Math.floor(tileSize * 0.85));
            const ox = px + (tileSize - size) / 2;
            const oy = py + (tileSize - size) / 2;
            ctx.fillStyle   = c.color || '#fff';
            ctx.fillRect(ox, oy, size, size);
            ctx.strokeStyle = c.isCapital ? '#ffffff' : '#000000';
            ctx.lineWidth   = c.isCapital ? 1.5 : 1;
            ctx.strokeRect(ox, oy, size, size);
        }
    }
}

/**
 * (Re)build the Map tab content inside `container`.
 * @param {HTMLElement} container   the .cheat-map-content element
 * @param {object} opts
 * @param {() => void} opts.closePanel   close the cheat panel (called before entering the paint mode)
 */
export function renderMapTab(container, opts = {}) {
    if (!container) return;
    const closePanel = opts.closePanel || (() => {});

    container.innerHTML = '';

    // ═══ Section 1: Map Preview ════════════════════════════════════════
    const previewSection = document.createElement('div');
    previewSection.className = 'lcp-section';
    previewSection.textContent = '── Map Preview ──';
    container.appendChild(previewSection);

    // Filter row: Cities, Resources, Refresh
    const filterRow = document.createElement('div');
    filterRow.style.cssText = 'display:flex; align-items:center; gap:0.6rem; margin-bottom:0.3rem; flex-wrap:wrap; font-size:0.78rem;';

    const mkFilter = (key, label) => {
        const lbl = document.createElement('label');
        lbl.style.cssText = 'cursor:pointer; display:inline-flex; align-items:center; gap:0.25rem; color:#d8caa0; user-select:none;';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!_state.filters[key];
        cb.style.cssText = 'margin:0; cursor:pointer;';
        cb.addEventListener('change', () => { _state.filters[key] = cb.checked; redraw(); });
        lbl.appendChild(cb);
        lbl.appendChild(document.createTextNode(' ' + label));
        return lbl;
    };
    filterRow.appendChild(mkFilter('cities', 'Cities'));
    filterRow.appendChild(mkFilter('resources', 'Resources'));

    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'lcp-row-btn';
    refreshBtn.textContent = 'Refresh';
    refreshBtn.style.cssText = 'flex: 0 0 auto; margin-left:auto; padding:0.15rem 0.55rem;';
    refreshBtn.addEventListener('click', () => { _snapshotCache = null; redraw(); });
    filterRow.appendChild(refreshBtn);
    container.appendChild(filterRow);

    // Canvas wrap (scrolls if the canvas overflows on big maps)
    const canvasWrap = document.createElement('div');
    canvasWrap.style.cssText = 'background:rgba(0,0,0,0.55); padding:3px; margin-bottom:0.3rem; max-height:18rem; overflow:auto; border:1px solid rgba(120,100,55,0.35);';
    const canvas = document.createElement('canvas');
    canvas.className = 'lcp-minimap';
    canvas.style.cssText = 'display:block; image-rendering:pixelated;';
    canvasWrap.appendChild(canvas);
    container.appendChild(canvasWrap);

    // Legend (tiny key under the map)
    const legend = document.createElement('div');
    legend.style.cssText = 'font-size:0.68rem; color:#a89878; line-height:1.4; margin-bottom:0.5rem;';
    legend.innerHTML = ''
        + '<span style="color:#fcd040;">●</span> Natural wonder &nbsp; '
        + '<span style="color:#7ec8e3;">▬</span> Minor river &nbsp; '
        + '<span style="color:#4a90d0;">▬</span> Navigable river<br>'
        + '<span style="color:#e84a3a;">■</span> Strategic &nbsp; '
        + '<span style="color:#c060d0;">■</span> Luxury &nbsp; '
        + '<span style="color:#a0e040;">■</span> Bonus &nbsp; '
        + '<span style="color:#f4d240;">■</span> Treasure';
    container.appendChild(legend);

    const previewMsg = document.createElement('div');
    previewMsg.style.cssText = 'font-size:0.78rem; color:#a89878; margin-bottom:0.5rem; min-height:1.1em;';
    container.appendChild(previewMsg);

    const redraw = () => {
        if (!_snapshotCache && !_snapshotInFlight) {
            _snapshotInFlight = true;
            previewMsg.textContent = 'Reading map…';
            // Defer to next tick so the "Reading map…" hint actually renders before the heavy loop.
            setTimeout(() => {
                try { _snapshotCache = api.getMapSnapshot({ includeCities: true, includeResources: true }); }
                catch (e) { api.ERR('getMapSnapshot failed:', e); previewMsg.textContent = 'Snapshot failed (see UI.log).'; _snapshotInFlight = false; return; }
                _snapshotInFlight = false;
                if (!_snapshotCache || !_snapshotCache.width) { previewMsg.textContent = 'No map data available.'; return; }
                drawMinimap(canvas, _snapshotCache, _state.filters);
                previewMsg.textContent = _snapshotCache.width + '×' + _snapshotCache.height + ' map · '
                    + (_snapshotCache.cities?.length || 0) + ' cities · '
                    + (_snapshotCache.resources?.length || 0) + ' resources';
            }, 0);
            return;
        }
        if (_snapshotCache) drawMinimap(canvas, _snapshotCache, _state.filters);
    };
    redraw();

    // ═══ Section 2: Map Paint ══════════════════════════════════════════
    const paintSection = document.createElement('div');
    paintSection.className = 'lcp-section';
    paintSection.textContent = '── Map Paint ──';
    container.appendChild(paintSection);

    // Status line (selected type, validation hints)
    const statusEl = document.createElement('div');
    statusEl.className = 'lcp-row-msg';
    statusEl.style.cssText = 'font-size:0.8em; line-height:1.3; color:#e6b800; margin:0.2rem 0 0.3rem 0; min-height:1.1em;';
    const updateStatus = () => {
        if (_state.type) statusEl.textContent = 'Selected: ' + _state.category + ' = ' + _state.type;
        else statusEl.textContent = 'Pick a ' + _state.category.toLowerCase() + ' type below, then click [Paint].';
    };

    // Category row
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

    // Paint button
    const paintBtn = document.createElement('button');
    paintBtn.className = 'lcp-toggle-btn';
    paintBtn.textContent = 'Paint at clicked tile';
    paintBtn.style.marginBottom = '0.4rem';
    paintBtn.addEventListener('click', () => {
        if (!_state.type) { statusEl.textContent = 'Pick a ' + _state.category.toLowerCase() + ' type first.'; return; }
        api.enterPaintMode({ category: _state.category, typeString: _state.type }, { closePanel });
    });
    container.appendChild(paintBtn);

    // Scrollable type list
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
    api.LOG('rendered map tab (category=' + _state.category + ', type=' + (_state.type || '(none)') + ')');
}
