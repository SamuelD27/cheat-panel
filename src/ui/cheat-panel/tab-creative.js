/**
 * @file tab-creative.js
 * @description CREATIVE tab — world-editing tools that paint onto the map.
 *
 *   Map Paint. The UI lives here (moved out of the Map tab in M8 so the Map Preview minimap can use the
 *   full panel width). Pick a category + type, then [Paint at clicked tile] closes the panel and enters
 *   INTERFACEMODE_LCP_PAINT_TILE; every plot click applies the current paint via
 *   WorldBuilder.MapPlots.set{Terrain,Feature,Resource,Biome}, with a read-back so the click flashes
 *   GREEN (value stuck) or RED (engine rejected the combo). The Resource category includes a
 *   "(Clear / remove resource)" entry (api.CLEAR_RESOURCE) that erases via setResource(NO_RESOURCE,…,0).
 *   Exit is the shared LcpPlotMode banner / Esc / right-click (Item 2).
 *
 * Module-level _state keeps the category/type selection across tab switches in a single session.
 */
import * as api from '/base-standard/ui/cheat-panel/shared/api.js';

const CATEGORIES = ['Terrain', 'Feature', 'Resource', 'Biome'];

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

    // ═══ Map Paint (ON STANDBY — see docs/Minor_todos.md #3) ════════════
    const paintSection = document.createElement('div');
    paintSection.className = 'lcp-section';
    paintSection.textContent = '── Map Paint (experimental) ──';
    container.appendChild(paintSection);

    const intro = document.createElement('div');
    intro.style.cssText = 'font-size:0.7rem; color:#8a7c5c; margin-bottom:0.3rem; line-height:1.35;';
    intro.textContent = 'Paint terrain / feature / resource / biome onto a clicked tile. The Resource list '
        + 'includes "(Clear / remove resource)" to erase a tile\'s resource. Green flash = applied, red = '
        + 'engine rejected. Esc / right-click / Exit button leaves. Terrain may only redraw after a camera move / next turn.';
    container.appendChild(intro);

    const statusEl = document.createElement('div');
    statusEl.className = 'lcp-row-msg';
    statusEl.style.cssText = 'font-size:0.8em; line-height:1.3; color:#e6b800; margin:0.2rem 0 0.3rem 0; min-height:1.1em;';
    const updateStatus = () => {
        if (_state.type) {
            const label = (_state.type === api.CLEAR_RESOURCE) ? 'Clear resource' : _state.type;
            statusEl.textContent = 'Selected: ' + _state.category + ' = ' + label;
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
        api.enterPaintMode({ category: _state.category, typeString: _state.type }, { closePanel });
    });
    container.appendChild(paintBtn);

    const typeListEl = document.createElement('div');
    typeListEl.className = 'lcp-map-type-list';
    typeListEl.style.cssText = 'display:flex; flex-wrap:wrap; max-height:22rem; overflow-y:auto; padding:0.15rem; gap:0.25rem;';
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
    api.LOG('rendered creative tab (category=' + _state.category + ')');
}
