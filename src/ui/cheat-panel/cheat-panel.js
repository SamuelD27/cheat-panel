/**
 * @file cheat-panel.js
 * @description Local Cheat Panel — root panel: lifecycle, UI wiring, tab routing.
 *
 * Forked (privately) from Sovereign Cheat Panel; compatible with Civ VII build 23245653 / 1.4.0.
 *
 * M1: all engine/core imports are isolated in ./shared/imports.js and all cheat logic in
 * ./shared/api.js (single-player-guarded). This file only does UI: stepper/tab/drag handling and
 * routing button clicks to api functions. Mod-internal modules are imported via the absolute
 * /base-standard/... path (the verified ImportFile->fs mapping for this build).
 */
import { Panel, FocusManager, DialogBoxManager, DialogBoxAction } from '/base-standard/ui/cheat-panel/shared/imports.js';
import * as api from '/base-standard/ui/cheat-panel/shared/api.js';
import { renderUnitList } from '/base-standard/ui/cheat-panel/tab-units.js';
import { renderCityList } from '/base-standard/ui/cheat-panel/tab-cities.js';
import { renderMapTab } from '/base-standard/ui/cheat-panel/tab-map.js';
import { ensureListeners, isGlobalInfinite, toggleGlobalInfinite } from '/base-standard/ui/cheat-panel/shared/infinite-move.js';
// Side-effect imports: each registers its custom INTERFACEMODE_LCP_* handler at module load.
import '/base-standard/ui/cheat-panel/claim-tile-mode.js'; // M4.3 "Claim Tiles"
import '/base-standard/ui/cheat-panel/paint-tile-mode.js'; // M5 "Map Paint"

const InputEngineEventName = 'engine-input';

class ScreenCheatPanel extends Panel {
    constructor() {
        super(...arguments);
        this.engineInputListener = this.onEngineInput.bind(this);
        this.tabSelectedListener = this.onTabSelected.bind(this);

        this.influenceAmounts = [100, 500, 1000, 5000, 10000];
        this.attrAmounts = [1, 5, 10, 25, 50];
        this.expAmounts = [20, 50, 100, 200, 500];
        this.popAmounts = [1, 2, 5, 10, 20];

        // Stepper index defaults — must match the `value=` attributes in cheat-panel.html.
        this.stepperValues = { influence: 1, attr: 0, exp: 0, pop: 0 };

        this.cheats = [
            { selector: ".cheat-add-gold-1",       action: () => api.addGold(10000) },
            { selector: ".cheat-add-gold-2",       action: () => api.addGold(100000) },
            { selector: ".cheat-add-gold-3",       action: () => api.addGold(1000000) },
            { selector: ".cheat-add-influence",    action: () => api.addInfluence(this.getAmount("influence", this.influenceAmounts)) },
            { selector: ".cheat-add-attr",         action: () => api.addAttributePoints(this.getAmount("attr", this.attrAmounts)) },

            { selector: ".cheat-restore-move-sel", action: () => api.restoreMovementSelected() },
            { selector: ".cheat-heal-sel",         action: () => api.healSelectedUnit() },
            { selector: ".cheat-give-exp",         action: () => api.giveExperienceSelected(this.getAmount("exp", this.expAmounts)) },
            { selector: ".cheat-dup-sel",          action: () => { api.duplicateSelectedUnit(); this.refreshUnitList(); } },
            { selector: ".cheat-restore-move-all", action: () => this.confirmAndRun("LOC_LCP_CHEAT_CONFIRM_MOVE_ALL", () => api.restoreMovementAll()) },
            { selector: ".cheat-heal-all",         action: () => this.confirmAndRun("LOC_LCP_CHEAT_CONFIRM_HEAL_ALL", () => api.healAllUnits()) },

            { selector: ".cheat-complete-prod-sel", action: () => api.completeProductionSelected() },
            { selector: ".cheat-add-pop-sel",       action: () => api.addPopulationSelected(this.getAmount("pop", this.popAmounts)) },
            { selector: ".cheat-complete-prod-all", action: () => this.confirmAndRun("LOC_LCP_CHEAT_CONFIRM_PROD_ALL", () => api.completeProductionAll()) },
            { selector: ".cheat-add-pop-all",       action: () => this.confirmAndRun("LOC_LCP_CHEAT_CONFIRM_POP_ALL", () => api.addPopulationAll(this.getAmount("pop", this.popAmounts))) },

            { selector: ".cheat-complete-research", action: () => api.completeResearch() },
            { selector: ".cheat-complete-civic",    action: () => api.completeCivic() },
        ];

        this.steppers = [
            { selector: ".cheat-stepper-influence", key: "influence", amounts: this.influenceAmounts },
            { selector: ".cheat-stepper-attr",      key: "attr",      amounts: this.attrAmounts },
            { selector: ".cheat-stepper-exp",       key: "exp",       amounts: this.expAmounts },
            { selector: ".cheat-stepper-pop",       key: "pop",       amounts: this.popAmounts },
        ];
    }

    onInitialize() {
        api.LOG('panel loaded');
        this.cheatFrame = this.Root.querySelector(".cheat-frame");
        this.enableOpenSound = true;
        this.enableCloseSound = true;
        this.injectPanelStyles();
        ensureListeners(); // belt-and-suspenders; infinite-move listeners also register at module load
    }

    /**
     * Scoped panel styles (M5.1 "light touch" restyle).
     *
     * Two jobs:
     *   1) fxs-stepper ships no CSS of its own — its arrows render invisible inside this panel, so we
     *      draw our own chevrons and give the click targets a guaranteed size.
     *   2) Flatter, more muted "third-party tool" look on top of the existing Civ frame: gradients
     *      replaced with flat fills, gold dimmed toward bronze, borders thinner and less yellow,
     *      corners less rounded. We do NOT touch the structural fxs-* components (header, tab-bar,
     *      subsystem-frame, backdrop image) so drag / tab routing / close / focus all keep working.
     *      All selectors are scoped to .cheat-frame so no other panel in the game is affected.
     */
    injectPanelStyles() {
        if (document.getElementById("lcp-panel-styles")) return;
        const style = document.createElement("style");
        style.id = "lcp-panel-styles";
        style.textContent = `
            .cheat-frame .fxs-stepper-left,
            .cheat-frame .fxs-stepper-right {
                position: relative;
                width: 2.3rem;
                min-width: 2.3rem;
                height: 2.3rem;
                cursor: pointer;
                align-self: center;
            }
            .cheat-frame .fxs-stepper-left::before,
            .cheat-frame .fxs-stepper-right::before {
                content: "";
                position: absolute;
                top: 50%;
                left: 50%;
                width: 0;
                height: 0;
            }
            .cheat-frame .fxs-stepper-left::before {
                border-top: 0.55rem solid transparent;
                border-bottom: 0.55rem solid transparent;
                border-right: 0.72rem solid #c5a042;
                transform: translate(-65%, -50%);
            }
            .cheat-frame .fxs-stepper-right::before {
                border-top: 0.55rem solid transparent;
                border-bottom: 0.55rem solid transparent;
                border-left: 0.72rem solid #c5a042;
                transform: translate(-35%, -50%);
            }
            .cheat-frame .fxs-stepper-left:hover::before { border-right-color: #e6c66e; }
            .cheat-frame .fxs-stepper-right:hover::before { border-left-color: #e6c66e; }
            .cheat-frame fxs-header { cursor: grab; }
            .cheat-frame .cheat-unit-list, .cheat-frame .cheat-city-list { max-height: 15rem; overflow-y: auto; margin-top: 0.25rem; }
            .cheat-frame .lcp-list-empty { color: #a89878; text-align: center; padding: 0.5rem; font-size: 0.8rem; }
            .cheat-frame .lcp-row {
                display: flex; flex-direction: column;
                padding: 0.3rem 0.45rem; margin: 0.18rem 0;
                background: rgba(8,6,3,0.6);
                border: 1px solid rgba(120,100,55,0.35); border-radius: 0.15rem;
            }
            .cheat-frame .lcp-row-label { color: #d8caa0; font-size: 0.8rem; cursor: pointer; margin-bottom: 0.25rem; letter-spacing: 0.02em; }
            .cheat-frame .lcp-row-label:hover { color: #f0e0b0; }
            .cheat-frame .lcp-row-btns { display: flex; flex-direction: row; }
            .cheat-frame .lcp-row-btn {
                flex: 1 1 auto; margin-right: 0.25rem;
                padding: 0.18rem 0.35rem; font-size: 0.75rem;
                color: #1a1206; background: #c5a042;
                border: 1px solid #5a481c; border-radius: 0.12rem; cursor: pointer;
                transition: background-color 0.08s;
            }
            .cheat-frame .lcp-row-btn:hover { background: #d8b556; }
            .cheat-frame .lcp-row-btn:last-child { margin-right: 0; }
            .cheat-frame .lcp-row-btns + .lcp-row-btns { margin-top: 0.2rem; }
            .cheat-frame .lcp-row-btn.active { background: #4a9970; color: #07210f; border-color: #265a40; }
            .cheat-frame .lcp-row-btn.active:hover { background: #5aae82; }
            .cheat-frame .lcp-row-btn-danger { background: #b04535; color: #fff; border-color: #6e2818; }
            .cheat-frame .lcp-row-btn-danger:hover { background: #c45a4a; }
            .cheat-frame .lcp-toggle-btn {
                width: 100%; padding: 0.4rem; color: #1a1206; background: #c5a042;
                border: 1px solid #5a481c; border-radius: 0.12rem; cursor: pointer; font-size: 0.85rem;
                transition: background-color 0.08s;
            }
            .cheat-frame .lcp-toggle-btn:hover { background: #d8b556; }
            .cheat-frame .lcp-toggle-btn.active { background: #4a9970; color: #07210f; border-color: #265a40; }
            .cheat-frame .lcp-toggle-btn.active:hover { background: #5aae82; }
            .cheat-frame .lcp-section {
                color: #8aa5a0; font-size: 0.72rem; letter-spacing: 0.08em;
                text-transform: uppercase; text-align: center;
                margin: 0.5rem 0 0.25rem 0; opacity: 0.85;
            }
        `;
        document.head.appendChild(style);
    }

    /** Lets the player drag the panel by its header. Position is remembered for the session. */
    setupDragging() {
        const handle = this.Root.querySelector("fxs-header");
        if (!handle) { api.ERR('no header found — drag disabled'); return; }

        let dragging = false;
        let startX = 0, startY = 0, originLeft = 0, originTop = 0;

        const onMove = (e) => {
            if (!dragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            this.Root.style.left = (originLeft + dx) + "px";
            this.Root.style.top = (originTop + dy) + "px";
            this.Root.style.right = "auto";
            this.Root.style.bottom = "auto";
        };
        const onUp = () => {
            if (!dragging) return;
            dragging = false;
            handle.style.cursor = "grab";
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };
        const onDown = (e) => {
            dragging = true;
            handle.style.cursor = "grabbing";
            const rect = this.Root.getBoundingClientRect();
            startX = e.clientX;
            startY = e.clientY;
            originLeft = rect.left;
            originTop = rect.top;
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
            e.preventDefault();
            e.stopPropagation();
        };

        handle.addEventListener("mousedown", onDown);
        this._dragCleanup = () => {
            handle.removeEventListener("mousedown", onDown);
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };
    }

    onAttach() {
        this.playAnimateInSound();
        this.Root.addEventListener(InputEngineEventName, this.engineInputListener);

        if (this.cheatFrame) {
            this.cheatFrame.addEventListener('subsystem-frame-close', () => { this.close(); });
        }

        for (const cheat of this.cheats) {
            const button = this.Root.querySelector(cheat.selector);
            if (button) {
                button.addEventListener("action-activate", cheat.action);
            } else {
                api.ERR(`missing button for ${cheat.selector}`);
            }
        }

        for (const stepper of this.steppers) {
            const el = this.Root.querySelector(stepper.selector);
            if (el) {
                el.addEventListener("component-value-changed", (e) => {
                    const v = e.detail?.value;
                    if (typeof v === "number") {
                        this.stepperValues[stepper.key] = v;
                        this.updateStepperCaption(el, stepper, v);
                    }
                });
                this.updateStepperCaption(el, stepper, this.stepperValues[stepper.key]);
            }
        }

        const tabBar = this.Root.querySelector(".cheat-tab-bar");
        if (tabBar) tabBar.addEventListener("tab-selected", this.tabSelectedListener);

        this.unitListEl = this.Root.querySelector(".cheat-unit-list");
        const refreshUnitsBtn = this.Root.querySelector(".cheat-refresh-units");
        if (refreshUnitsBtn) refreshUnitsBtn.addEventListener("action-activate", () => this.refreshUnitList());
        this.refreshUnitList();

        this.cityListEl = this.Root.querySelector(".cheat-city-list");
        const refreshCitiesBtn = this.Root.querySelector(".cheat-refresh-cities");
        if (refreshCitiesBtn) refreshCitiesBtn.addEventListener("action-activate", () => this.refreshCityList());
        this.refreshCityList();

        this.mapContentEl = this.Root.querySelector(".cheat-map-content");
        this.refreshMapTab();

        this.infMoveBtn = this.Root.querySelector(".cheat-inf-move");
        if (this.infMoveBtn) {
            this.updateInfMoveBtn();
            this.infMoveBtn.addEventListener("click", () => { toggleGlobalInfinite(); this.updateInfMoveBtn(); });
        }

        this.setupDragging();

        FocusManager.get().setFocus(this.Root);
    }

    onDetach() {
        this.Root.removeEventListener(InputEngineEventName, this.engineInputListener);
        if (this._dragCleanup) { this._dragCleanup(); this._dragCleanup = null; }
    }

    close(uiViewChangeMethod) { super.close(uiViewChangeMethod); }
    onReceiveFocus() { super.onReceiveFocus(); }

    onEngineInput(inputEvent) {
        if (inputEvent.detail.status != InputActionStatuses.FINISH) return;
        if (inputEvent.detail.name == 'sys-menu') {
            this.close();
            inputEvent.stopPropagation();
            inputEvent.preventDefault();
        }
    }

    onTabSelected(event) {
        const id = event.detail?.selectedItem?.id;
        if (!id) return;
        this.Root.querySelectorAll(".cheat-tab").forEach(t => {
            t.classList.toggle("hidden", !t.classList.contains(`cheat-tab-${id}`));
        });
        if (id === 'units') this.refreshUnitList();
        if (id === 'cities') this.refreshCityList();
        if (id === 'map') this.refreshMapTab();
    }

    refreshUnitList() {
        if (!this.unitListEl) return;
        renderUnitList(this.unitListEl, {
            expAmount: () => this.getAmount("exp", this.expAmounts),
            confirm: (key, fn) => this.confirmAndRun(key, fn),
            refresh: () => this.refreshUnitList(),
        });
    }

    refreshCityList() {
        if (!this.cityListEl) return;
        renderCityList(this.cityListEl, {
            popAmount: () => this.getAmount("pop", this.popAmounts),
            refresh: () => this.refreshCityList(),
            closePanel: () => this.close(),
        });
    }

    refreshMapTab() {
        if (!this.mapContentEl) return;
        renderMapTab(this.mapContentEl, { closePanel: () => this.close() });
    }

    updateInfMoveBtn() {
        if (!this.infMoveBtn) return;
        const on = isGlobalInfinite();
        this.infMoveBtn.textContent = `∞ Infinite Movement (all units): ${on ? 'ON' : 'OFF'}`;
        this.infMoveBtn.classList.toggle("active", on);
    }

    // ─── UI helpers ───────────────────────────────────────────────────
    getAmount(key, amounts) {
        const v = this.stepperValues[key];
        const safe = Math.max(0, Math.min(v, amounts.length - 1));
        return amounts[safe];
    }

    updateStepperCaption(el, stepper, index) {
        const amounts = stepper.amounts;
        if (!amounts) return;
        const safe = Math.max(0, Math.min(index, amounts.length - 1));
        const captionEl = el.querySelector(".fxs-stepper-caption");
        if (captionEl) captionEl.innerHTML = "+" + amounts[safe].toLocaleString();
    }

    confirmAndRun(bodyKey, action) {
        DialogBoxManager.createDialog_ConfirmCancel({
            title: "LOC_LCP_CHEAT_PANEL_HEADER",
            body: bodyKey,
            callback: (result) => { if (result == DialogBoxAction.Confirm) action(); }
        });
    }
}

Controls.define('panel-lcp', {
    createInstance: ScreenCheatPanel,
    description: 'Local Cheat Panel',
    classNames: ['screen-cheat-panel', 'top-40', 'bottom-2', 'left-0', 'absolute'],
    content: ['fs://game/base-standard/ui/cheat-panel/cheat-panel.html'],
    attributes: []
});
