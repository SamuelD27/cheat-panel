/**
 * @file tab-units.js
 * @description Units tab — per-row list of the local player's units.
 *
 * Renders a plain scrollable list (this build has no `fxs-list` element — 0 refs in base UI) of
 * rows, each: "<name> · HP h/m · MP r/x · (x,y)" plus per-row [Heal] [+XP] [Move] buttons. Clicking
 * the label centers the camera on the unit. All engine access goes through ./shared/api.js
 * (single-player-guarded). Rebuilt whenever the Units tab is shown or "Refresh" is clicked.
 *
 * M2 = verified subset (heal / +XP / restore movement). Delete / promote / infinite-move arrive in M3.
 */
import * as api from '/base-standard/ui/cheat-panel/shared/api.js';

/**
 * (Re)build the unit list inside `container`.
 * @param {HTMLElement} container  the .cheat-unit-list element
 * @param {() => number} expAmountFn  returns the current +XP stepper amount
 */
export function renderUnitList(container, expAmountFn) {
    if (!container) return;
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

        const btns = document.createElement('div');
        btns.className = 'lcp-row-btns';
        const mkBtn = (text, fn) => {
            const b = document.createElement('button');
            b.className = 'lcp-row-btn';
            b.textContent = text;
            b.addEventListener('click', () => { try { fn(); } catch (e) { api.ERR('row action failed:', e); } paint(); });
            return b;
        };
        btns.appendChild(mkBtn('Heal', () => api.healUnit(unit.id)));
        btns.appendChild(mkBtn('+XP', () => api.giveExperience(unit.id, expAmountFn ? expAmountFn() : 50)));
        btns.appendChild(mkBtn('Move', () => api.restoreMovement(unit.id)));
        row.appendChild(btns);

        container.appendChild(row);
    }
    api.LOG('rendered unit list:', units.length, 'units');
}
