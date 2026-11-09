/**
 * @file tab-creative.js
 * @description CREATIVE tab — world-editing tools that paint onto the map.
 *
 *   Map Paint. The UI lives here (moved out of the Map tab in M8 so the Map Preview minimap can use the
 *   full panel width). Pick a category + type, then [Paint at clicked tile] closes the panel and enters
 *   INTERFACEMODE_LCP_PAINT_TILE; every plot click runs api.paintPlotAsync, which applies the paint via
 *   WorldBuilder.MapPlots.set{Terrain,Feature,Resource,Biome}, waits until the engine has really applied it
 *   (the write lands a few frames later — reading back at once is what made paint "work half the time"),
 *   and reports done / done with a note / partly done / refused with the reason. Resource and Feature lists
 *   start with a "(Clear / remove …)" entry; clearing a natural wonder's tile removes the whole wonder. The
 *   Wonder category prepares the site (terrain/biome of the clicked anchor and, for multi-tile wonders or
 *   neighbour rules, the tiles around it) and places the wonder from the clicked anchor tile.
 *   Exit is the shared LcpPlotMode banner / Esc / right-click (Item 2). The "Recent paint results" list
 *   (above the type list) shows the last outcomes with their reasons (the paint banner shows them live).
 *   Type names are tagged when the data says they behave unusually: "Navigable River (terrain only)" (2026-11-02: the
 *   3D map draws rivers from river data that painting doesn't change, so a painted one is never drawn as a river),
 *   resources "(Distant Lands)" / "(special)" / "(other age)" (e.g. the two "Gold" entries differ this way).
 *   Each type's explanation shows in the status line when it is selected (and as data-tooltip-content, the
 *   attribute the base UI's tooltips read — the HTML title attribute is not shown by Gameface).
 *   "Mark painted river tiles on the 3D map" (2026-11-02, default ON) switches the panel's own blue stand-in mark for
 *   painted Navigable River tiles on the 3D map (api.js PAINTED-RIVER STAND-IN OVERLAY); the choice is kept in
 *   localStorage under the shared 'modSettings' key (modSettings.localCheatPanel.paintedRiverOverlay).
 *
 * Module-level _state keeps the category/type selection across tab switches in a single session.
 */
import * as api from '/base-standard/ui/cheat-panel/shared/api.js';

const CATEGORIES = ['Terrain', 'Feature', 'Resource', 'Biome', 'Wonder'];
const RESULT_COLORS = { ok: '#7ddc8f', warn: '#ffb347', partial: '#ffb347', fail: '#ff7b6b', refused: '#ff7b6b', busy: '#e6b800' };
const RESULT_WORDS = { ok: 'Done', warn: 'Done (note)', partial: 'Partly', fail: 'Failed', refused: 'Refused', busy: 'Busy' };

const _state = {
    category: 'Terrain',
    type: null,
};

/**
 * (Re)build the Creative tab content inside `container`.
 * @param {HTMLElement} container          the .cheat-creative-content element
 * @param {object} opts
 * @param {() => void} opts.closePanel     close the cheat panel (before entering the paint mode)
 */
export function renderCreativeTab(container, opts = {}) {
    if (!container) return;
    const closePanel = opts.closePanel || (() => {});

    container.innerHTML = '';

    // ═══ Map Paint ═════════════════════════════════════════════════════
    const paintSection = document.createElement('div');
    paintSection.className = 'lcp-section';
    paintSection.textContent = '── Map Paint (experimental) ──';
    container.appendChild(paintSection);

    const intro = document.createElement('div');
    intro.style.cssText = 'font-size:0.7rem; color:#8a7c5c; margin-bottom:0.3rem; line-height:1.35;';
    intro.textContent = 'Paint terrain / feature / resource / biome / natural wonder onto clicked tiles. Each click flashes '
        + 'amber while the game applies it, then green (done), orange (done with a note, or partly done) or red (refused) — the '
        + 'reason shows in the banner and under "Recent paint results". Terrain also fixes the biome on land/water changes and '
        + 'removes features that can\'t stay. Wonders reshape the clicked tile (and, for multi-tile wonders or neighbour rules, '
        + 'the tiles around it for a moment) and put everything back if the game refuses. "(Clear / remove feature)" on a wonder '
        + 'removes the whole wonder. Esc / right-click / Exit leaves. The 3D map does not redraw terrain right away: shape changes '
        + '(mountain, hill, flat, water) are expected to show after a save & reload, but that is not guaranteed. Navigable River changes '
        + 'the terrain only, so the 3D map never shows a river there (not even after a reload); paint Coast for water that boats can use.';
    container.appendChild(intro);
    // Early reachability breadcrumb (typeof checks only): can this context see TerrainBuilder.setRiverInfo? Once per session.
    try { api.logPaintApiOnce('creative-tab'); } catch (_) { /* diagnostics must never break the tab */ }

    const statusEl = document.createElement('div');
    statusEl.className = 'lcp-row-msg';
    statusEl.style.cssText = 'font-size:0.8em; line-height:1.3; color:#e6b800; margin:0.2rem 0 0.3rem 0; min-height:1.1em;';
    const updateStatus = () => {
        statusEl.style.color = '#e6b800';
        if (_state.type) {
            let label = _state.type, hint = '';
            try { label = api.paintTypeLabel(_state.category, _state.type); } catch (_) {}
            try { hint = api.paintTypeHint(_state.category, _state.type); } catch (_) {}
            statusEl.textContent = 'Selected: ' + _state.category + ' = ' + label + (hint ? ' — ' + hint : '');
        } else statusEl.textContent = 'Pick a ' + _state.category.toLowerCase() + ' type below, then click [Paint].';
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
        // Fail loudly HERE (panel still open) for a paint that can never work, instead of on every click.
        let problem = null;
        try { problem = api.paintEntryProblem(_state.category, _state.type); } catch (e) { api.ERR('paintEntryProblem failed:', e); }
        if (problem) {
            statusEl.style.color = '#ff7b6b';
            statusEl.textContent = 'Can\'t paint this: ' + problem;
            api.diag('creative.refused:' + _state.category + '=' + _state.type + ',' + api.diagTok(problem, 300));
            return;
        }
        const ok = api.enterPaintMode({ category: _state.category, typeString: _state.type }, { closePanel });
        if (ok === false) { statusEl.style.color = '#ff7b6b'; statusEl.textContent = 'Could not enter paint mode (see UI.log LCPD lines).'; }
    });
    container.appendChild(paintBtn);

    // ═══ Painted-river marker on the 3D map (2026-11-02; default ON, kept in localStorage modSettings) ═══
    renderPaintedRiverToggle(container);

    // ═══ Recent paint results (newest first; filled by api.paintPlotAsync while painting) ═══
    renderRecentResults(container);

    // No max-height/overflow cap: a nested overflow div does not scroll in Gameface (only fxs-scrollable does —
    // the 2026-07-22 Cities-list lesson), so a long Resource list used to hide its last entries. The list now
    // flows at full height and the panel's outer fxs-scrollable scrolls it.
    const typeListEl = document.createElement('div');
    typeListEl.className = 'lcp-map-type-list';
    typeListEl.style.cssText = 'display:flex; flex-wrap:wrap; padding:0.15rem; gap:0.25rem;';
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
            b.title = t.hint || t.type;
            try { b.setAttribute('data-tooltip-content', t.hint || t.type); } catch (_) {}   // what base UI tooltips read
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
    api.LOG('rendered creative tab (category=' + _state.category + ')');
}

// "Mark painted river tiles on the 3D map: ON/OFF (n marked, m under fog)" + one help line. The marker itself (overlay
// group, refresh triggers, persistence) lives in api.js (PAINTED-RIVER STAND-IN OVERLAY); this is only the switch. The
// count is the last refresh's (a paint, the turn start or this toggle redraws it); the tab re-renders on every open.
function renderPaintedRiverToggle(container) {
    const btn = document.createElement('button');
    btn.className = 'lcp-toggle-btn';
    btn.style.marginBottom = '0.15rem';
    const help = document.createElement('div');
    help.style.cssText = 'font-size:0.7rem; color:#8a7c5c; margin-bottom:0.4rem; line-height:1.35;';
    // Names the surface (2026-11-02): this switch drives only the 3D-world overlay; the Map tab marks painted tiles always.
    help.textContent = 'Blue tint on the game\'s 3D map over tiles you painted as Navigable River (the game does not draw them as rivers). '
        + 'The panel\'s Map tab always marks them, whatever this switch says.';
    const show = (st) => {
        let on = true;
        try { on = api.isPaintedRiverOverlayEnabled(); } catch (_) {}
        let tail = '';
        if (on && st && st.at !== 0) {
            if (st.ok === false && st.why && !/^(no-map|fog-not-ready|no-local-player)$/.test(st.why)) tail = ' (could not draw the marks, see UI.log)';
            else if (st.ok) tail = ' (' + (st.count | 0) + ' marked' + (st.hidden ? ', ' + st.hidden + ' not explored yet' : '') + ')';
        }
        btn.textContent = 'Mark painted river tiles on the 3D map: ' + (on ? 'ON' : 'OFF') + tail;
        btn.classList.toggle('active', on);
    };
    btn.addEventListener('click', () => {
        let on = true;
        try { on = api.isPaintedRiverOverlayEnabled(); } catch (_) {}
        api.LOG('creative: painted-river marker toggle -> ' + (on ? 'OFF' : 'ON'));
        try { api.diag('creative.riverMark.toggle:on=' + (on ? 0 : 1) + ',surface=3d,mapTabAlwaysMarks=1'); } catch (_) { /* never break the toggle */ }
        let r = null;
        try { r = api.setPaintedRiverOverlayEnabled(!on, 'creative-tab'); } catch (e) { api.ERR('setPaintedRiverOverlayEnabled failed:', e); }
        let st = null;
        try { st = api.getPaintedRiverOverlayState(); } catch (_) {}
        show(st || r);
        if (r && !r.persisted) api.LOG('creative: marker setting kept for this session only (localStorage did not take it)');
    });
    let st0 = null;
    try { st0 = api.getPaintedRiverOverlayState(); } catch (_) {}
    show(st0);
    container.appendChild(btn);
    container.appendChild(help);
}

// Last few paint outcomes with their reasons, newest first (api keeps up to 8; the tab shows 5).
function renderRecentResults(container) {
    let results = [];
    try { results = api.getRecentPaintResults(); } catch (e) { api.ERR('getRecentPaintResults failed:', e); }
    const head = document.createElement('div');
    head.className = 'lcp-section';
    head.textContent = '── Recent paint results ──';
    container.appendChild(head);
    const box = document.createElement('div');
    box.style.cssText = 'font-size:0.78rem; line-height:1.35; margin-bottom:0.4rem;';
    container.appendChild(box);
    if (!results.length) {
        const none = document.createElement('div');
        none.className = 'lcp-list-empty';
        none.textContent = '(nothing painted yet in this session)';
        box.appendChild(none);
        return;
    }
    for (const r of results.slice(0, 5)) {
        const row = document.createElement('div');
        row.style.cssText = 'margin:0.1rem 0; white-space:normal; color:' + (RESULT_COLORS[r.status] || '#e8dcc0') + ';';
        let when = '';
        try {
            const d = new Date(r.t);
            when = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0') + ' ';
        } catch (_) {}
        row.textContent = when + (RESULT_WORDS[r.status] || r.status) + ' — ' + r.message;
        box.appendChild(row);
    }
}
