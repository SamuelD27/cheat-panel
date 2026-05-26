/**
 * @file cheat-panel.js
 * @description Local Cheat Panel — main panel script.
 *
 * Forked (privately, not for redistribution) from Sovereign Cheat Panel.
 * Compatible with Civilization VII Update 1.4.0 "Test of Time" (build 23245653).
 *
 * 1.4.0 NOTE: Panel base class imported directly from panel-support.js (default export) — there are
 * no .chunk.js files in this build. The HTML content path is addressed under the base-standard UI
 * namespace (`fs://game/base-standard/ui/...`), which is the verified convention for mod ImportFiles
 * on this build (confirmed against Sovereign + Izica panels).
 *
 * M0 = faithful rebranded fork of the verified Sovereign cheats. Engine calls below are all
 * verified against this build; later milestones add per-row lists, map paint, infinite-move, and
 * duplication.
 */
import Panel from '/core/ui/panel-support.js';
import { FocusManager } from '/core/ui-next/services/focus-manager.js';
import { DialogBoxManager } from '/core/ui/dialog-box/manager-dialog-box.js';
import { DialogBoxAction } from '/core/ui/dialog-box/model-dialog-box.js';

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
        // (Gold no longer uses a stepper — it has three explicit amount buttons.)
        this.stepperValues = {
            influence: 1,
            attr: 0,
            exp: 0,
            pop: 0,
        };

        this.cheats = [
            { selector: ".cheat-add-gold-1",            action: () => this.addGoldAmount(10000) },
            { selector: ".cheat-add-gold-2",            action: () => this.addGoldAmount(100000) },
            { selector: ".cheat-add-gold-3",            action: () => this.addGoldAmount(1000000) },
            { selector: ".cheat-add-influence",         action: () => this.addInfluence() },
            { selector: ".cheat-add-attr",              action: () => this.addAttributePoints() },

            { selector: ".cheat-restore-move-sel",      action: () => this.restoreMovementSelected() },
            { selector: ".cheat-heal-sel",              action: () => this.healSelectedUnit() },
            { selector: ".cheat-give-exp",              action: () => this.giveExperience() },
            { selector: ".cheat-restore-move-all",      action: () => this.confirmAndRun("LOC_LCP_CHEAT_CONFIRM_MOVE_ALL", () => this.restoreMovementAll()) },
            { selector: ".cheat-heal-all",              action: () => this.confirmAndRun("LOC_LCP_CHEAT_CONFIRM_HEAL_ALL", () => this.healAllUnits()) },

            { selector: ".cheat-complete-prod-sel",     action: () => this.completeProductionSelected() },
            { selector: ".cheat-add-pop-sel",           action: () => this.addPopulationSelected() },
            { selector: ".cheat-complete-prod-all",     action: () => this.confirmAndRun("LOC_LCP_CHEAT_CONFIRM_PROD_ALL", () => this.completeProductionAll()) },
            { selector: ".cheat-add-pop-all",           action: () => this.confirmAndRun("LOC_LCP_CHEAT_CONFIRM_POP_ALL", () => this.addPopulationAll()) },

            { selector: ".cheat-complete-research",     action: () => this.completeResearch() },
            { selector: ".cheat-complete-civic",        action: () => this.completeCivic() },
        ];

        this.steppers = [
            { selector: ".cheat-stepper-influence",  key: "influence", amounts: this.influenceAmounts },
            { selector: ".cheat-stepper-attr",       key: "attr",      amounts: this.attrAmounts },
            { selector: ".cheat-stepper-exp",        key: "exp",       amounts: this.expAmounts },
            { selector: ".cheat-stepper-pop",        key: "pop",       amounts: this.popAmounts },
        ];
    }

    onInitialize() {
        console.log("LCP: panel loaded");
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
        if (document.getElementById("lcp-panel-styles")) {
            return;
        }
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
            .cheat-frame fxs-header {
                cursor: grab;
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * Lets the player drag the panel by its header so it can be moved out of the way of other UI.
     * Position is remembered for the rest of the session.
     */
    setupDragging() {
        const handle = this.Root.querySelector("fxs-header");
        if (!handle) {
            console.warn("LCP: no header found — drag disabled");
            return;
        }

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
                console.error(`LCP: missing button for ${cheat.selector}`);
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
                // Force the caption to the real amount on open — fxs-stepper can render before its
                // captions-list attribute is parsed and would otherwise show the raw index number.
                this.updateStepperCaption(el, stepper, this.stepperValues[stepper.key]);
            }
        }

        const tabBar = this.Root.querySelector(".cheat-tab-bar");
        if (tabBar) {
            tabBar.addEventListener("tab-selected", this.tabSelectedListener);
        }

        this.setupDragging();

        FocusManager.get().setFocus(this.Root);
    }

    onDetach() {
        this.Root.removeEventListener(InputEngineEventName, this.engineInputListener);
        if (this._dragCleanup) {
            this._dragCleanup();
            this._dragCleanup = null;
        }
    }

    close(uiViewChangeMethod) {
        super.close(uiViewChangeMethod);
    }

    onReceiveFocus() {
        super.onReceiveFocus();
    }

    onEngineInput(inputEvent) {
        if (inputEvent.detail.status != InputActionStatuses.FINISH) {
            return;
        }
        if (inputEvent.detail.name == 'sys-menu') {
            this.close();
            inputEvent.stopPropagation();
            inputEvent.preventDefault();
        }
    }

    onTabSelected(event) {
        const id = event.detail?.selectedItem?.id;
        if (!id) return;
        const tabs = this.Root.querySelectorAll(".cheat-tab");
        tabs.forEach(t => {
            const isActive = t.classList.contains(`cheat-tab-${id}`);
            t.classList.toggle("hidden", !isActive);
        });
    }

    // ─── helpers ─────────────────────────────────────────────────────────

    getAmount(key, amounts) {
        const v = this.stepperValues[key];
        const safe = Math.max(0, Math.min(v, amounts.length - 1));
        return amounts[safe];
    }

    /**
     * Sets the stepper's visible caption to the human-readable amount (e.g. "+100,000") for the given
     * index. Called from the stepper change handler and once on open.
     */
    updateStepperCaption(el, stepper, index) {
        const amounts = stepper.amounts;
        if (!amounts) return;
        const safe = Math.max(0, Math.min(index, amounts.length - 1));
        const captionEl = el.querySelector(".fxs-stepper-caption");
        if (captionEl) {
            captionEl.innerHTML = "+" + amounts[safe].toLocaleString();
        }
    }

    confirmAndRun(bodyKey, action) {
        DialogBoxManager.createDialog_ConfirmCancel({
            title: "LOC_LCP_CHEAT_PANEL_HEADER",
            body: bodyKey,
            callback: (result) => {
                if (result == DialogBoxAction.Confirm) {
                    action();
                }
            }
        });
    }

    getLocalPlayer() {
        return Players.get(GameContext.localPlayerID);
    }

    // ─── PLAYER cheats ────────────────────────────────────────────────────

    addGoldAmount(amount) {
        const player = this.getLocalPlayer();
        if (player?.Treasury) {
            player.Treasury.changeGoldBalance(amount, -1);
            console.log(`LCP: added ${amount} gold`);
        }
    }

    addInfluence() {
        const amount = this.getAmount("influence", this.influenceAmounts);
        const player = this.getLocalPlayer();
        if (player?.DiplomacyTreasury) {
            player.DiplomacyTreasury.changeDiplomacyBalance(amount);
            console.log(`LCP: added ${amount} influence`);
        }
    }

    addAttributePoints() {
        const amount = this.getAmount("attr", this.attrAmounts);
        const player = this.getLocalPlayer();
        if (player?.Identity) {
            for (let i = 0; i < amount; i++) {
                player.Identity.addWildcardAttributePoints(1);
            }
            console.log(`LCP: added ${amount} wildcard attribute points`);
        }
    }

    // ─── UNIT cheats ──────────────────────────────────────────────────────

    withSelectedUnit(fn) {
        const id = UI.Player.getHeadSelectedUnit();
        if (id && id.owner !== -1 && id.id !== -1) {
            const unit = Units.get(id);
            if (unit) {
                fn(unit);
                return true;
            }
        }
        console.error("LCP: no unit selected");
        return false;
    }

    restoreMovementSelected() {
        this.withSelectedUnit(unit => {
            Units.restoreMovement(unit.id);
            UI.Player.deselectAllUnits();
            UI.Player.selectUnit(unit.id);
        });
    }

    healSelectedUnit() {
        this.withSelectedUnit(unit => {
            Units.setDamage(unit.id, 0);
        });
    }

    giveExperience() {
        const amount = this.getAmount("exp", this.expAmounts);
        this.withSelectedUnit(unit => {
            Units.changeExperience(unit.id, amount);
        });
    }

    restoreMovementAll() {
        const player = this.getLocalPlayer();
        const playerUnits = player?.Units;
        if (!playerUnits) return;
        for (const unit of playerUnits.getUnits()) {
            Units.restoreMovement(unit.id);
        }
    }

    healAllUnits() {
        const player = this.getLocalPlayer();
        const playerUnits = player?.Units;
        if (!playerUnits) return;
        for (const unit of playerUnits.getUnits()) {
            Units.setDamage(unit.id, 0);
        }
    }

    // ─── CITY cheats ──────────────────────────────────────────────────────

    withSelectedCity(fn) {
        const cityID = UI.Player.getHeadSelectedCity();
        if (cityID) {
            const city = Cities.get(cityID);
            if (city) {
                fn(city);
                return true;
            }
        }
        console.error("LCP: no city selected");
        return false;
    }

    completeProductionSelected() {
        this.withSelectedCity(city => {
            city.BuildQueue?.completeProduction();
        });
    }

    addPopulationSelected() {
        const amount = this.getAmount("pop", this.popAmounts);
        this.withSelectedCity(city => {
            for (let i = 0; i < amount; i++) {
                city.addRuralPopulation(1);
            }
        });
    }

    completeProductionAll() {
        const player = this.getLocalPlayer();
        const playerCities = player?.Cities;
        if (!playerCities) return;
        for (const city of playerCities.getCities()) {
            city.BuildQueue?.completeProduction();
        }
    }

    addPopulationAll() {
        const amount = this.getAmount("pop", this.popAmounts);
        const player = this.getLocalPlayer();
        const playerCities = player?.Cities;
        if (!playerCities) return;
        for (const city of playerCities.getCities()) {
            for (let i = 0; i < amount; i++) {
                city.addRuralPopulation(1);
            }
        }
    }

    // ─── RESEARCH cheats ──────────────────────────────────────────────────

    completeResearch() {
        const player = this.getLocalPlayer();
        const techs = player?.Techs;
        if (!techs) return;
        const techTreeType = techs.getTreeType();
        const treeObject = Game.ProgressionTrees.getTree(player.id, techTreeType);
        if (!treeObject) return;
        const currentNode = treeObject.nodes[treeObject.activeNodeIndex]?.nodeType;
        if (currentNode == null) return;
        const nodeInfo = GameInfo.ProgressionTreeNodes.lookup(currentNode);
        if (!nodeInfo) return;
        const cost = techs.getNodeCost(currentNode);
        const perTurn = player.Stats?.getNetYield(YieldTypes.YIELD_SCIENCE) ?? 0;
        const turnsLeft = techs.getTurnsLeft();
        const granted = perTurn > 0 ? (perTurn * turnsLeft) * 1.4 : cost;
        Players.grantYield(player.id, YieldTypes.YIELD_SCIENCE, granted);
        console.log("LCP: completed current research");
    }

    completeCivic() {
        const player = this.getLocalPlayer();
        const culture = player?.Culture;
        if (!culture) return;
        const cultureTreeType = culture.getActiveTree();
        const treeObject = Game.ProgressionTrees.getTree(player.id, cultureTreeType);
        if (!treeObject) return;
        const currentNode = treeObject.nodes[treeObject.activeNodeIndex]?.nodeType;
        if (currentNode == null) return;
        const nodeInfo = GameInfo.ProgressionTreeNodes.lookup(currentNode);
        if (!nodeInfo) return;
        const cost = culture.getNodeCost(currentNode);
        const perTurn = player.Stats?.getNetYield(YieldTypes.YIELD_CULTURE) ?? 0;
        const turnsLeft = culture.getTurnsLeft();
        const granted = perTurn > 0 ? (perTurn * turnsLeft) * 1.4 : cost;
        Players.grantYield(player.id, YieldTypes.YIELD_CULTURE, granted);
        console.log("LCP: completed current civic");
    }
}

Controls.define('panel-lcp', {
    createInstance: ScreenCheatPanel,
    description: 'Local Cheat Panel',
    classNames: ['screen-cheat-panel', 'top-40', 'bottom-2', 'left-0', 'absolute'],
    content: ['fs://game/base-standard/ui/cheat-panel/cheat-panel.html'],
    attributes: []
});
