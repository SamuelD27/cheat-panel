/**
 * @file tab-units.js
 * @description Units tab — per-row list of the local player's units.
 *
 * Plain scrollable list (this build has no `fxs-list` element). Each unit row shows
 * "<name> · HP h/m · MP r/x · (x,y)" (clicking the label centers the camera) plus one button row:
 *   [Heal] [+XP] [Move] [Del]
 * Infinite-movement (global toggle) and Duplicate (selected unit) live in the tab's top controls,
 * not per-row — see cheat-panel.js. All engine access goes through ./shared/api.js (SP-guarded).
 */
import * as api from '/base-standard/ui/cheat-panel/shared/api.js';

/**
 * (Re)build the unit list inside `container`.
 * @param {HTMLElement} container  the .cheat-unit-list element
 * @param {object} opts
 * @param {() => number} opts.expAmount  current +XP stepper amount
 * @param {(locKey: string, action: () => void) => void} opts.confirm  confirm-dialog helper
 * @param {() => void} opts.refresh  rebuild the list (after remove)
 */
export function renderUnitList(container, opts = {}) {
    if (!container) return;
    const expAmount = opts.expAmount || (() => 50);
    const confirm = opts.confirm || ((k, fn) => fn());
    const refresh = opts.refresh || (() => {});

    container.innerHTML = '';

    let units = [];
    try { units = api.getLocalUnits(); } catch (e) { api.ERR('getLocalUnits failed:', e); }

    if (!units || units.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'lcp-list-empty';
        empty.textContent = '(no units)';
        container.appendChild(empty);
        return;
    }

    for (const unit of units) {
        const row = document.createElement('div');
        row.className = 'lcp-row';

        const label = document.createElement('div');
        label.className = 'lcp-row-label';
        const paint = () => {
            const i = api.unitDisplay(unit);
            const hp = i.hasHp ? `HP ${i.hp}/${i.maxHp}` : 'HP —';
            const mp = i.hasMp ? `MP ${i.mp}/${i.maxMp}` : 'MP —';
            label.textContent = `${i.name} · ${hp} · ${mp} · (${i.x},${i.y})`;
        };
        paint();
        label.title = 'Click to center camera';
        label.addEventListener('click', () => api.lookAtUnit(unit));
        row.appendChild(label);

        const mkBtn = (text, fn, extraClass) => {
            const b = document.createElement('button');
            b.className = 'lcp-row-btn' + (extraClass ? ' ' + extraClass : '');
            b.textContent = text;
            b.addEventListener('click', () => { try { fn(); } catch (e) { api.ERR('row action failed:', e); } });
            return b;
        };

        const btns = document.createElement('div');
        btns.className = 'lcp-row-btns';
        btns.appendChild(mkBtn('Heal', () => { api.healUnit(unit.id); paint(); }));
        btns.appendChild(mkBtn('+XP', () => { api.giveExperience(unit.id, expAmount()); paint(); }));
        btns.appendChild(mkBtn('Move', () => { api.restoreMovement(unit.id); paint(); }));
        btns.appendChild(mkBtn('Del', () => confirm('LOC_LCP_CHEAT_CONFIRM_DELETE_UNIT', () => { api.deleteUnit(unit.id); refresh(); }), 'lcp-row-btn-danger'));
        row.appendChild(btns);

        container.appendChild(row);
    }
    api.LOG('rendered unit list:', units.length, 'units');
}
