/**
 * @file tab-cities.js
 * @description Cities tab — per-row list of the local player's cities/towns.
 *
 * Mirrors tab-units.js (this build has no `fxs-list` element — plain scrollable DOM rows). Each row
 * shows "<name>[ · town] · pop N · (x,y)" (clicking the label centers the camera) plus one button row:
 *   [+Pop] [Prod] [Grow]
 *   - +Pop  : add rural population (amount from the tab's pop stepper)
 *   - Prod  : complete the city's current production
 *   - Grow  : close the panel and open the game's native tile picker (INTERFACEMODE_ACQUIRE_TILE) so
 *             you can claim adjacent tiles into this city — adjacency-only, no distance cap. Claim-only;
 *             the engine has no relinquish/give-up-tile command.
 * (The old per-row [+Gold] was removed — gold is an empire-wide resource already covered by the
 *  Player tab's Add Gold buttons, so a per-city copy was redundant.)
 * All engine access goes through ./shared/api.js (SP-guarded).
 */
import * as api from '/base-standard/ui/cheat-panel/shared/api.js';

/**
 * (Re)build the city list inside `container`.
 * @param {HTMLElement} container  the .cheat-city-list element
 * @param {object} opts
 * @param {() => number} opts.popAmount    current +Pop stepper amount
 * @param {() => void} opts.refresh        rebuild the list
 * @param {() => void} opts.closePanel     close the cheat panel (called before entering the tile picker)
 */
export function renderCityList(container, opts = {}) {
    if (!container) return;
    const popAmount = opts.popAmount || (() => 1);
    const refresh = opts.refresh || (() => {});
    const closePanel = opts.closePanel || (() => {});

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

        // Transient status line for [Grow] (shown when there is no pending growth to place).
        const growMsg = document.createElement('div');
        growMsg.className = 'lcp-row-msg';
        growMsg.style.cssText = 'display:none; font-size:0.85em; line-height:1.3; color:#e6b800; margin-top:3px;';
        let growMsgTimer = 0;
        const flashGrowMsg = (text) => {
            growMsg.textContent = text;
            growMsg.style.display = 'block';
            if (growMsgTimer) clearTimeout(growMsgTimer);
            growMsgTimer = setTimeout(() => { growMsg.style.display = 'none'; }, 7000);
        };

        // Grow: only enters the native tile picker when the city actually has a plot to claim;
        // otherwise we'd soft-lock the player in an empty picker. growCity() closes the panel itself
        // on the success path (so the map is clickable), and reports back when there is no growth.
        btns.appendChild(mkBtn('Grow', () => {
            const r = api.growCity(city, { closePanel });
            if (r && !r.ok && r.reason === 'no-growth') {
                flashGrowMsg('No pending growth to place — [Grow] only lets you pick a tile once the city has grown. Use [+Pop] to grow it now (the game auto-picks the tile), or wait for natural growth then [Grow] to choose, or [Claim] any tile freely.');
            }
        }));
        // Claim: custom map-click mode — add ANY plot to this city, no 3-tile radius / growth limit
        // (M4.3). Closes the panel, then click tiles on the map; Esc / right-click exits.
        btns.appendChild(mkBtn('Claim', () => { api.enterClaimMode(city, { closePanel }); }));
        row.appendChild(btns);
        row.appendChild(growMsg);

        container.appendChild(row);
    }
    api.LOG('rendered city list:', cities.length, 'cities');
}
