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
    }

    /**
     * fxs-stepper ships no CSS of its own, so its arrows render invisible inside this panel. We draw
     * our own gold chevrons and give the click targets a guaranteed size. Also styles the draggable
     * header. Scoped to .cheat-frame so no other game stepper is affected.
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
                border-right: 0.72rem solid #e8c860;
                transform: translate(-65%, -50%);
            }
            .cheat-frame .fxs-stepper-right::before {
                border-top: 0.55rem solid transparent;
                border-bottom: 0.55rem solid transparent;
                border-left: 0.72rem solid #e8c860;
                transform: translate(-35%, -50%);
            }
            .cheat-frame .fxs-stepper-left:hover::before { border-right-color: #ffe9a8; }
            .cheat-frame .fxs-stepper-right:hover::before { border-left-color: #ffe9a8; }
            .cheat-frame fxs-header { cursor: grab; }
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
