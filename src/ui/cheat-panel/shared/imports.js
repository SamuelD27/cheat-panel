/**
 * @file shared/imports.js
 * @description SINGLE place that imports from the game's /core and /core/ui-next modules.
 *
 * Rule (per project plan §14): every `/core` / `/core/ui-next` import lives here and nowhere else,
 * so a patch that renames or moves a core module is a one-file fix. This build (23245653) ships
 * plain .js files — there are no .chunk.js aliases to track.
 *
 * Mod-internal modules import these symbols via the absolute path
 *   /base-standard/ui/cheat-panel/shared/imports.js
 * which is how Civ 7 maps a mod ImportFile (`ui/cheat-panel/shared/imports.js`) into the virtual FS
 * (verified convention: ImportFile X -> fs://game/base-standard/X).
 */
import Panel from '/core/ui/panel-support.js';
import { FocusManager } from '/core/ui-next/services/focus-manager.js';
import { DialogBoxManager } from '/core/ui/dialog-box/manager-dialog-box.js';
import { DialogBoxAction } from '/core/ui/dialog-box/model-dialog-box.js';
import ContextManager from '/core/ui/context-manager/context-manager.js';
import { InterfaceMode } from '/core/ui/interface-modes/interface-modes.js';

export { Panel, FocusManager, DialogBoxManager, DialogBoxAction, ContextManager, InterfaceMode };
