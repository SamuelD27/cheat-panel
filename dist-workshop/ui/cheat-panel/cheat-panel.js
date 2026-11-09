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
import { renderCreativeTab } from '/base-standard/ui/cheat-panel/tab-creative.js';
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
     * Scoped panel styles — M6 FULL restyle ("dark + gold", Civ nod).
     *
     * Two jobs:
     *   1) fxs-stepper ships no CSS of its own — its arrows render invisible inside this panel, so we
     *      draw our own chevrons and give the click targets a guaranteed size.
     *   2) A complete dark+gold reskin of the WHOLE panel — not just our DOM widgets. We strip the
     *      Sovereign chrome (parchment backdrop, gold 9-slice border, filigree) and re-skin the
     *      engine fxs-button / fxs-tab-bar / fxs-header too, then LOCK the frame to a fixed size so it
     *      no longer resizes between tabs (content scrolls internally). All selectors are scoped to
     *      .cheat-frame, and we only override CSS (never the base DOM), so drag / tab routing / close /
     *      open animation all keep working.
     */
    injectPanelStyles() {
        // Use the PANEL's own document, not the module-global `document`. This panel runs in a
        // separate Gameface view/context (the same reason our `LCP:` console.logs never reached
        // UI.log), so the module-global `document.head` is a DIFFERENT document than the one the
        // panel element lives in — a <style> appended there silently never applies to .cheat-frame.
        // Appending into this.Root.ownerDocument (or this.Root itself) guarantees it's in-scope.
        const doc = (this.Root && this.Root.ownerDocument) || document;
        if (doc.getElementById("lcp-panel-styles")) return;
        const style = doc.createElement("style");
        style.id = "lcp-panel-styles";
        style.textContent = `
            /* ===== M6 full restyle: dark + gold (Civ nod). Scoped to .cheat-frame only. =====
               Strips the Sovereign chrome (parchment backdrop, gold 9-slice border, filigree
               ornaments) and lays down a flat dark panel with a thin gold edge. Pure CSS — the base
               fxs-subsystem-frame DOM is untouched, so drag / tab routing / close / open all keep
               working. See fxs-subsystem-frame.js / fxs-inner-frame.js for the element anatomy. */

            /* Panel skin + LOCKED SIZE — the frame no longer grows/shrinks with tab content; it's a
               fixed box and the content area scrolls internally, so every tab is the same size. */
            .cheat-frame {
                display: flex !important; flex-direction: column !important;
                /* override the host's items-center utility: stretch the interior to the full locked
                   width on EVERY tab, so the visible frame + tab bar no longer shrink to tab content. */
                align-items: stretch !important;
                width: 78rem !important; max-width: 96vw !important; height: 42rem !important;
                background-color: #14110b !important;
                border: 1px solid #6e5a28 !important;
                border-radius: 0.45rem !important;
                box-shadow: 0 10px 34px rgba(0,0,0,0.6) !important;
            }
            /* Make the interior fill the fixed width+height and let ONLY the content scroll. */
            .cheat-frame > fxs-vslot { min-height: 0 !important; flex: 1 1 auto !important; width: 100% !important; max-width: 100% !important; }
            .cheat-frame .subsystem-frame__content { min-height: 0 !important; width: 100% !important; }
            /* Strip the Sovereign chrome. */
            .cheat-frame > .size-full.pointer-events-none { display: none !important; } /* parchment backdrop */
            .cheat-frame .frame-top-curve { background-image: none !important; border-image: none !important; -webkit-mask-image: none !important; }
            .cheat-frame .fxs-subsystem-frame__filigree,
            .cheat-frame .filigree-panel-top-left,
            .cheat-frame .filigree-panel-top-right,
            .cheat-frame .filigree-inner-frame-top,
            .cheat-frame .filigree-inner-frame-bottom { display: none !important; }
            /* Inner-frame tabs: transparent, no own chrome (they sit directly on the dark panel). */
            .cheat-frame .inner-frame { background-color: transparent !important; }

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
                border-right: 0.72rem solid #d8b24a;
                transform: translate(-65%, -50%);
            }
            .cheat-frame .fxs-stepper-right::before {
                border-top: 0.55rem solid transparent;
                border-bottom: 0.55rem solid transparent;
                border-left: 0.72rem solid #d8b24a;
                transform: translate(-35%, -50%);
            }
            .cheat-frame .fxs-stepper-left:hover::before { border-right-color: #e6c66e; }
            .cheat-frame .fxs-stepper-right:hover::before { border-left-color: #e6c66e; }
            .cheat-frame fxs-header { cursor: grab; width: 100% !important; color: #e8dcc0 !important; }
            /* (NEVER put a backtick anywhere in this CSS — the whole block is a JS template literal, and
               one stray backtick is a module-wide SyntaxError that stops the panel from opening.)
               NOTE: do NOT re-add 'max-height' + 'overflow-y:auto' here. A nested overflow div does not
               scroll in this Coherent Gameface build (only <fxs-scrollable> reimplements wheel/drag —
               base fxs-scrollable.js), so a capped inner box silently CLIPS long lists: with 6 cities
               only the first ~4 tall rows fit 15rem and the rest were unreachable (Steam-comment bug).
               Letting the list flow at natural height hands overflow to the frame's OWN working outer
               fxs-scrollable (.subsystem-frame__content), which scrolls the whole tab inside the fixed
               42rem frame — the same single-scroller pattern the base game uses. Same rule covers the
               units list, so long unit lists become fully reachable too. */
            .cheat-frame .cheat-unit-list, .cheat-frame .cheat-city-list { margin-top: 0.25rem; }
            .cheat-frame .lcp-list-empty { color: #a89878; text-align: center; padding: 0.5rem; font-size: 0.88rem; }
            .cheat-frame .lcp-row {
                display: flex; flex-direction: column;
                padding: 0.3rem 0.45rem; margin: 0.18rem 0;
                background: rgba(8,6,3,0.6);
                border: 1px solid rgba(120,100,55,0.35); border-radius: 0.15rem;
            }
            .cheat-frame .lcp-row-label { color: #d8caa0; font-size: 0.88rem; cursor: pointer; margin-bottom: 0.25rem; letter-spacing: 0.02em; }
            .cheat-frame .lcp-row-label:hover { color: #f0e0b0; }
            .cheat-frame .lcp-row-btns { display: flex; flex-direction: row; }
            .cheat-frame .lcp-row-btn {
                flex: 1 1 auto; margin-right: 0.25rem;
                padding: 0.2rem 0.4rem; font-size: 0.82rem;
                color: #d8b24a; background: #241d10;
                border: 1px solid #6e5a28; border-radius: 0.18rem; cursor: pointer;
                transition: background-color 0.08s, color 0.08s;
            }
            .cheat-frame .lcp-row-btn:hover { background: #362c17; color: #e6c66e; }
            .cheat-frame .lcp-row-btn:last-child { margin-right: 0; }
            .cheat-frame .lcp-row-btns + .lcp-row-btns { margin-top: 0.2rem; }
            .cheat-frame .lcp-row-btn.active { background: #d8b24a; color: #1a1206; border-color: #e6c66e; }
            .cheat-frame .lcp-row-btn.active:hover { background: #e6c66e; }
            .cheat-frame .lcp-row-btn-danger { background: #2a1410; color: #e88a78; border-color: #7a2c20; }
            .cheat-frame .lcp-row-btn-danger:hover { background: #3e1c16; color: #ff9d88; }
            .cheat-frame .lcp-toggle-btn {
                width: 100%; padding: 0.4rem; color: #d8b24a; background: #241d10;
                border: 1px solid #6e5a28; border-radius: 0.18rem; cursor: pointer; font-size: 0.92rem;
                transition: background-color 0.08s, color 0.08s;
            }
            .cheat-frame .lcp-toggle-btn:hover { background: #362c17; color: #e6c66e; }
            .cheat-frame .lcp-toggle-btn.active { background: #d8b24a; color: #1a1206; border-color: #e6c66e; }
            .cheat-frame .lcp-toggle-btn.active:hover { background: #e6c66e; }
            .cheat-frame .lcp-section {
                color: #b89a55; font-size: 0.8rem; letter-spacing: 0.08em;
                text-transform: uppercase; text-align: center;
                margin: 0.5rem 0 0.25rem 0; opacity: 0.9;
            }
            /* M6 full restyle: re-skin the engine fxs-button. It's light DOM (verified in
               core/ui/components/fxs-button.js): the gold 9-slice texture lives on stacked
               .fxs-button__bg--{base,focus,active,disabled} layers. We null those background IMAGES
               and paint flat dark fills with a gold edge + gold label, so the engine buttons match
               our plain DOM buttons. (A 'filter: brightness' alone couldn't recolor the gold texture
               — that's why every earlier "dim it" attempt didn't visibly change the buttons.) */
            .cheat-frame fxs-button {
                color: #d8b24a !important;
                border: 1px solid #6e5a28 !important;
                border-radius: 0.18rem !important;
                overflow: hidden !important;
                /* Count the 1px border INSIDE the width — otherwise a full-width button's border-box is
                   ~2px wider than the content area and pokes past the dark panel edge (most visible on
                   the sparse Research tab). */
                box-sizing: border-box !important; max-width: 100% !important;
            }
            /* Same border-box fix for our plain DOM buttons (full-width toggles, row buttons). */
            .cheat-frame button { box-sizing: border-box !important; max-width: 100% !important; }
            /* fxs-scrollable overlays a 1rem-wide (w-4) custom scrollbar track at the RIGHT edge of the
               content area (absolutely positioned). The tabs' base px-3 (0.75rem) right padding is less
               than that, so full-width buttons run under the track and look clipped on the right (left is
               clear). Reserve a right gutter wider than the track on every tab. */
            .cheat-frame .cheat-tab { padding-right: 1.6rem !important; }
            .cheat-frame fxs-button .fxs-button__bg--base     { background-image: none !important; background-color: #241d10 !important; }
            .cheat-frame fxs-button:hover .fxs-button__bg--base { background-color: #362c17 !important; }
            .cheat-frame fxs-button .fxs-button__bg--focus    { background-image: none !important; background-color: rgba(216,178,74,0.14) !important; }
            .cheat-frame fxs-button .fxs-button__bg--active   { background-image: none !important; background-color: rgba(216,178,74,0.30) !important; }
            .cheat-frame fxs-button .fxs-button__bg--disabled { background-image: none !important; background-color: rgba(0,0,0,0.45) !important; }

            /* M6 full restyle: tab bar. Hide the gold bar/end-cap textures; recolor the moving
               selection indicator to a flat 2px gold underline; gold-tint the selected tab label. */
            .cheat-frame .img-tab-bar-flat,
            .cheat-frame .img-tab-flat-end-cap { display: none !important; }
            .cheat-frame fxs-tab-bar { border-bottom: 1px solid rgba(110,90,40,0.45) !important; }
            .cheat-frame .tab-bar__selection-indicator {
                background-image: none !important; background-color: #d8b24a !important;
                min-height: 2px !important; height: 2px !important;
            }
            .cheat-frame fxs-tab-item { color: #9a8c6a !important; }
            .cheat-frame fxs-tab-item[selected="true"] { color: #e8dcc0 !important; }
        `;
        (doc.head || this.Root).appendChild(style);
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
        // Initialise the UI.log breadcrumb sink on the panel document as early as possible, so paint /
        // wonder diagnostics still surface even when the paint mode has closed the panel (see api.diag).
        try { api.diagInit(this.Root.ownerDocument); } catch (_) {}
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

        this.creativeContentEl = this.Root.querySelector(".cheat-creative-content");
        this.refreshCreativeTab();

        this.infMoveBtn = this.Root.querySelector(".cheat-inf-move");
        if (this.infMoveBtn) {
            this.updateInfMoveBtn();
            this.infMoveBtn.addEventListener("click", () => { toggleGlobalInfinite(); this.updateInfMoveBtn(); });
        }

        this.setupDragging();
        this.centerPanel();

        FocusManager.get().setFocus(this.Root);
    }

    /**
     * Center the panel horizontally on open. The base panel root ships with the utility class
     * `left-0` (pinned to the screen's left edge), which looked lopsided once the frame was widened
     * to ~3× — empty space banked up on the right. We measure the laid-out width (so it's correct at
     * any rem size / resolution) one frame after attach, then set an explicit px `left`. Dragging
     * continues seamlessly from there because onDown reads getBoundingClientRect().left as its origin.
     */
    centerPanel() {
        const center = () => {
            try {
                const w  = this.Root.getBoundingClientRect().width;
                const vw = window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || 0;
                if (w > 0 && vw > 0) {
                    this.Root.style.left  = Math.max(0, Math.round((vw - w) / 2)) + 'px';
                    this.Root.style.right = 'auto';
                }
            } catch (_) {}
        };
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(center);
        else setTimeout(center, 0);
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
        if (id === 'creative') this.refreshCreativeTab();
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
        renderMapTab(this.mapContentEl);
    }

    refreshCreativeTab() {
        if (!this.creativeContentEl) return;
        renderCreativeTab(this.creativeContentEl, { closePanel: () => this.close() });
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
