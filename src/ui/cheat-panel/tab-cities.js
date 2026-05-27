/**
 * @file tab-cities.js
 * @description Cities tab — per-row list of the local player's cities/towns.
 *
 * Mirrors tab-units.js (this build has no `fxs-list` element — plain scrollable DOM rows). Each row
 * shows "<name>[ · town] · pop N · (x,y)" (clicking the label centers the camera) plus one button row:
 *   [+Pop] [Prod] [+Gold]
 *   - +Pop  : add rural population (amount from the tab's pop stepper)
 *   - Prod  : complete the city's current production
 *   - +Gold : add gold to the empire treasury (a player resource — not per-city; convenience button)
 * All engine access goes through ./shared/api.js (SP-guarded).
 */
import * as api from '/base-standard/ui/cheat-panel/shared/api.js';

/**
 * (Re)build the city list inside `container`.
 * @param {HTMLElement} container  the .cheat-city-list element
 * @param {object} opts
 * @param {() => number} opts.popAmount   current +Pop stepper amount
 * @param {() => number} opts.goldAmount  gold added per [+Gold] click
 * @param {() => void} opts.refresh       rebuild the list
 */
export function renderCityList(container, opts = {}) {
    if (!container) return;
    const popAmount = opts.popAmount || (() => 1);
    const goldAmount = opts.goldAmount || (() => 1000);
    const refresh = opts.refresh || (() => {});

    container.innerHTML = '';

    let cities = [];
    try { cities = api.getLocalCities(); } catch (e) { api.ERR('getLocalCities failed:', e); }

    if (!cities || cities.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'lcp-list-empty';
        empty.textContent = '(no cities)';
        container.appendChild(empty);
        return;
    }

    for (const city of cities) {
        const row = document.createElement('div');
        row.className = 'lcp-row';

        const label = document.createElement('div');
        label.className = 'lcp-row-label';
        const paint = () => {
            const i = api.cityDisplay(city);
            label.textContent = `${i.name}${i.isTown ? ' · town' : ''} · pop ${i.pop} · (${i.x},${i.y})`;
        };
        paint();
        label.title = 'Click to center camera';
        label.addEventListener('click', () => api.lookAtCity(city));
        row.appendChild(label);

        const mkBtn = (text, fn) => {
            const b = document.createElement('button');
            b.className = 'lcp-row-btn';
            b.textContent = text;
            b.addEventListener('click', () => { try { fn(); } catch (e) { api.ERR('row action failed:', e); } });
            return b;
        };

        const btns = document.createElement('div');
        btns.className = 'lcp-row-btns';
        btns.appendChild(mkBtn('+Pop', () => { api.addRuralPopulation(city, popAmount()); paint(); }));
        btns.appendChild(mkBtn('Prod', () => { api.completeProduction(city); paint(); }));
        btns.appendChild(mkBtn('+Gold', () => { api.addGold(goldAmount()); }));
        row.appendChild(btns);

        container.appendChild(row);
    }
    api.LOG('rendered city list:', cities.length, 'cities');
}
