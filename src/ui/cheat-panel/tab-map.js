/**
 * @file tab-map.js
 * @description Map tab (M5) — pick a paint category (Terrain / Feature / Resource / Biome) and a type,
 * then click [Paint] to enter the custom map-click mode (INTERFACEMODE_LCP_PAINT_TILE) and paint plots
 * by clicking them on the map. The mode stays active so several plots can be painted in one session;
 * Esc / right-click exits.
 *
 * Layout (all plain DOM, no fxs-list in this build):
 *   [Terrain] [Feature] [Resource] [Biome]       <- category buttons, one active at a time
 *   <selected: X = Y>                            <- status line
 *   [Paint at clicked tile]                      <- enters the paint mode (panel closes)
 *   <scrollable list of type buttons>            <- filtered to the active category
 *
 * The selection (category + type) is kept module-level so it persists across tab switches and refreshes
 * within the session. Engine access goes through ./shared/api.js (SP-guarded; type lookups via
 * GameInfo.{Terrains,Features,Resources,Biomes}; painting via WorldBuilder.MapPlots.set*).
 */
import * as api from '/base-standard/ui/cheat-panel/shared/api.js';

const CATEGORIES = ['Terrain', 'Feature', 'Resource', 'Biome'];

// Module-level selection so tab switches / refreshes don't blow it away.
const _state = { category: 'Terrain', type: null };

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

    // ─── Status line (selected type, validation hints) ─────────────────
    const statusEl = document.createElement('div');
    statusEl.className = 'lcp-row-msg';
    statusEl.style.cssText = 'font-size:0.8em; line-height:1.3; color:#e6b800; margin:0.2rem 0 0.3rem 0; min-height:1.1em;';
    const updateStatus = () => {
        if (_state.type) statusEl.textContent = 'Selected: ' + _state.category + ' = ' + _state.type;
        else statusEl.textContent = 'Pick a ' + _state.category.toLowerCase() + ' type below, then click [Paint].';
    };

    // ─── Category row ──────────────────────────────────────────────────
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
            _state.type = null;                              // category change clears the type
            for (const c of CATEGORIES) catBtns[c].classList.toggle('active', c === cat);
            populateTypes();
            updateStatus();
        });
        catBtns[cat] = b;
        catRow.appendChild(b);
    }
    container.appendChild(catRow);
    container.appendChild(statusEl);

    // ─── Paint button (enters the map-click mode) ──────────────────────
    const paintBtn = document.createElement('button');
    paintBtn.className = 'lcp-toggle-btn';
    paintBtn.textContent = 'Paint at clicked tile';
    paintBtn.style.marginBottom = '0.4rem';
    paintBtn.addEventListener('click', () => {
        if (!_state.type) { statusEl.textContent = 'Pick a ' + _state.category.toLowerCase() + ' type first.'; return; }
        api.enterPaintMode({ category: _state.category, typeString: _state.type }, { closePanel });
    });
    container.appendChild(paintBtn);

    // ─── Scrollable type list ──────────────────────────────────────────
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
            b.title = t.type;                                // hover shows the raw *Type string
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
