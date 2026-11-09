/* LCP river writer payload, v1 (2026-11-03). Civ VII 1.5.0, build 25516395.
 *
 * Runs in the engine's Tuner script context (FireTuner CMD ctx 1). That context reads the live GameCore map and is
 * the only script context with TerrainBuilder.setRiverInfo during play. river_watch.py sends this file with the
 * parameter placeholder on the last line replaced by a JSON object P (it must occur exactly once in this file),
 * and reads back one string:
 *   'LCPRW1' + JSON.stringify(OUT) + 'LCPRW1END'
 * The same JSON is kept in globalThis.__lcpRWouts[nonce] (and __lcpRWout, the latest) so the runner can fetch its
 * own run in pieces when a reply is cut short, even if another run (a dry run beside the watcher) came in between.
 *
 * Rules (spec v1 sections 4, 5 and 8):
 * - Plain JS: no imports, timers, engine.on, Promise use or UI globals. Block comments only; explicit semicolons
 *   everywhere, because the runner strips comments and folds newlines.
 * - Directions are the six literals in DIRS. The enum's count member is never used: the engine answers it with the
 *   plot itself.
 * - A river type is never written with the no-direction value. The only (-1, -1) write is the removal of river data.
 * - None of the whole-map builders is called (finalize, validate, store-water, model, floodplain, cliff, elevation).
 * - Mode 'dry' computes and reports only: it never calls setRiverInfo and never touches the Tuner-side state copy.
 *
 * Join safety (review RW-1 / RW-2, 2026-11-03). GameplayMap has no outflow getter, so whether joining an existing
 * river tile is safe depends on what the writer remembers about its own writes:
 * - pend: tiles written (or held) as PENDING (no sea, lake or river yet; may flow uphill into land). Never a join
 *   target. Never evicted: when the list is full, new pending writes are refused ('state-full'), never forgotten.
 * - dr: tiles the writer drained to water or to a river, with the direction it wrote. Joining such a tile follows the
 *   recorded chain downstream: allowed when it reaches water, or a game river that passes the elevation rule; refused
 *   when it reaches the component being written. Evicted oldest-first only to keep LCP_RW_STATE in its size budget.
 * - risk: tiles that must never join a game river (painted from water, unknown origin, river data removed, and the
 *   water tiles the writer's rivers drain into).
 * - uw: queued tiles that already held navigable river data the writer has no record of (a run whose state was lost
 *   before a save): never a join target.
 * - lf: tiles a lake source was written into, with the lake's direction (review RW-L1). The engine never clears that
 *   inflow bit, even when the tile's river data is removed, so the tile counts as fed by that lake for good. Never
 *   evicted; at the cap new lake sources are skipped.
 * The authoritative copy lives in this Tuner context (globalThis.__lcpRWstate, keyed by seed/W/H) and is updated
 * BEFORE each component's writes, so a run whose UI write-back is lost, or that throws half way, leaves a conservative
 * state that the next run (or the error path's write-back) persists. The context is recreated on every load; then the
 * saved game value LCP_RW_STATE is the source.
 *
 * Stale river data (review RW-W1 / RW-M1, 2026-11-03). Painting terrain never changes river data, so a river tile the
 * user painted to water or to a mountain keeps its old outflow. A water tile is a sink (sea or lake mouth, the end of a
 * recorded chain, a lake source) only when it holds no river data; a mountain or impassable plot is never a target and
 * ends a recorded chain. Fail closed: the river stays pending instead.
 *
 * Lake sources (review RW-L1). A lake feeds a component only when the fed tile's planned path reaches the sea directly,
 * or joins one of the writer's own rivers whose recorded chain ends in water that is not that lake (a flood fill over
 * adjacent lake tiles, so any tile of the same lake counts as the same lake) and not a lake that may feed a river back
 * into it. A game river can't be traced, so joining one gets no lake source. A skipped lake source is reported
 * (OUT.c.lakeSkipN, OUT.lakeSkip [[lakePlotIndex, why]], an 'LCP-RW:lake:...skip=' log line). The other direction is
 * guarded too: a component never drains into a lake (as its mouth, or through a recorded chain) when a river that
 * lake may feed (a dr tile next to it, or a recorded lf tile) flows into the component.
 *
 * P = { mode:'dry'|'apply', nonce, seq, nav, mpUI, uiSeed, q:'v1|n:X:Y:W|rm:X:Y|...', state:{...}|null,
 *       stateBad:bool, lastKey:'<seed|W|H of the last LCP_RW_LAST>'|null, lakeSource:bool, maxWrites:int }
 */
(function (P) {
    var MARK = 'LCPRW1';
    var MARK_END = 'LCPRW1END';
    var DIRS = [0, 1, 2, 3, 4, 5];
    var LOG_MAX = 160;
    var LIST_CAP = { wrote: 200, removed: 100, fail: 20, refused: 20, lake: 20, tiles: 60, done: 400 };
    var PEND_CAP = 150;        /* pending tiles; never evicted: new pending writes are refused at the cap */
    var RISK_CAP = 150;        /* risk tiles on land; never evicted (risk marks on water tiles are evictable) */
    var UW_CAP = 60;           /* unknown navigable tiles; never evicted */
    var LF_CAP = 60;           /* lake-fed tiles; never evicted: at the cap new lake sources are skipped ('state-full') */
    var STATE_BUDGET = 2900;   /* characters of LCP_RW_STATE (the spec keeps every key under 3 KB) */
    var OUTS_KEEP = 4;         /* recovery copies kept per nonce */
    var t0 = Date.now();
    P = (P && typeof P === 'object') ? P : {};
    var OUT = { v: 1, k: 'run', n: (P.nonce === undefined ? null : P.nonce), mode: (P.mode === 'apply' ? 'apply' : 'dry'),
        seq: (typeof P.seq === 'number' ? P.seq : null), ok: false };
    var LOGS = [];
    var logDropped = 0;
    var STAGE = 'init';
    var CUR = { x: null, y: null };
    var G = (typeof globalThis !== 'undefined') ? globalThis : null;
    /* results live out here so a run that throws half way still reports what it wrote */
    var RES = { wrote: [], removed: [], rmRefused: [], fail: [], lake: [], lakeSkip: [], tiles: [], done: [] };
    /* the Tuner-side state copy as last saved by this run (apply mode only), for the error path */
    var SAVED = { json: null };

    /* Token-safe value, same rules as the panel's diagTok: whitespace runs become '_', ',' becomes ';', '=' becomes
       ':', anything outside 0x21..0x7e becomes '?', and the value is cut at 120 characters with a trailing '~'. */
    function tok(v) {
        var s;
        try {
            if (v === undefined) s = 'undefined';
            else if (v === null) s = 'null';
            else if (typeof v === 'object') {
                try { s = JSON.stringify(v); } catch (e1) { s = String(v); }
                if (s === undefined) s = String(v);
            } else s = String(v);
        } catch (e2) { s = '?'; }
        var o = '';
        var ws = false;
        for (var k = 0; k < s.length; k++) {
            var c = s.charCodeAt(k);
            var ch = s.charAt(k);
            if (c === 32 || (c >= 9 && c <= 13) || c === 160 || c === 0x2028 || c === 0x2029) {
                if (!ws) o += '_';
                ws = true;
                continue;
            }
            ws = false;
            if (ch === ',') o += ';';
            else if (ch === '=') o += ':';
            else if (c < 0x21 || c > 0x7e) o += '?';
            else o += ch;
        }
        if (o.length > 120) o = o.slice(0, 120) + '~';
        return o;
    }

    /* One log line: 'LCP-RW:<stage>:k=v,k=v'. Kept in OUT.log (capped) and sent to console.log when it exists. */
    function L(stage, kv) {
        var parts = [];
        if (kv) {
            for (var key in kv) {
                if (Object.prototype.hasOwnProperty.call(kv, key)) parts.push(key + '=' + tok(kv[key]));
            }
        }
        var line = 'LCP-RW:' + stage + ':' + parts.join(',');
        if (LOGS.length < LOG_MAX) LOGS.push(line);
        else logDropped++;
        try {
            if (typeof console === 'object' && console && typeof console.log === 'function') console.log(line);
        } catch (e) { /* console may be missing in this context */ }
    }

    function capPush(arr, cap, v) { if (arr.length < cap) arr.push(v); }

    function lexLess(a, b) {
        for (var k = 0; k < a.length; k++) {
            if (a[k] !== b[k]) return a[k] < b[k];
        }
        return false;
    }

    function finish() {
        OUT.ms = Date.now() - t0;
        if (!OUT.ok && !OUT.refused) {
            OUT.wrote = RES.wrote;
            OUT.removed = RES.removed;
            OUT.fail = RES.fail;
            OUT.rmRefused = RES.rmRefused;
            OUT.lake = RES.lake;
            OUT.lakeSkip = RES.lakeSkip;
            OUT.tiles = RES.tiles;
            /* review RW-1: the conservative state this run left in the Tuner context, for the runner to persist */
            if (SAVED.json !== null) { OUT.stateJson = SAVED.json; OUT.stateChanged = true; }
        }
        OUT.log = LOGS;
        OUT.logDropped = logDropped;
        var s;
        try { s = JSON.stringify(OUT); } catch (e) {
            s = '{"v":1,"k":"run","n":' + JSON.stringify(OUT.n) + ',"ok":false,"err":"stringify-failed"}';
        }
        try {
            if (G) {
                G.__lcpRWout = s;
                var m = G.__lcpRWouts;
                if (!m || typeof m !== 'object') { m = { order: [] }; G.__lcpRWouts = m; }
                if (!Array.isArray(m.order)) m.order = [];
                var nk = 'n:' + String(OUT.n);
                if (m[nk] === undefined) m.order.push(nk);
                m[nk] = s;
                while (m.order.length > OUTS_KEEP) { var old = m.order.shift(); delete m[old]; }
            }
        } catch (e3) { /* recovery copy is best effort */ }
        return MARK + s + MARK_END;
    }

    function main() {
        STAGE = 'pre';
        var mode = OUT.mode;
        var GM = (typeof GameplayMap === 'object' && GameplayMap) ? GameplayMap : null;
        var TB = (typeof TerrainBuilder === 'object' && TerrainBuilder) ? TerrainBuilder : null;
        var DT = (typeof DirectionTypes === 'object' && DirectionTypes) ? DirectionTypes : null;
        var RT = (typeof RiverTypes === 'object' && RiverTypes) ? RiverTypes : null;
        var CF = (typeof Configuration === 'object' && Configuration) ? Configuration : null;
        var need = ['getGridWidth', 'getGridHeight', 'getTerrainType', 'getRiverType', 'isNavigableRiver', 'isWater',
            'isMountain', 'isImpassable', 'getElevation', 'isCliffCrossing', 'getAdjacentPlotLocation', 'isValidLocation',
            'getIndexFromXY', 'getLocationFromIndex'];
        var missing = [];
        var k;
        if (!GM) missing.push('GameplayMap');
        else for (k = 0; k < need.length; k++) if (typeof GM[need[k]] !== 'function') missing.push(need[k]);
        var hasLake = !!GM && typeof GM.isLake === 'function';
        var sri = !!TB && typeof TB.setRiverInfo === 'function';
        /* live 1.5.0 names are DIRECTION_NORTHEAST .. DIRECTION_NORTHWEST plus NO_DIRECTION (probed 2026-11-04);
           the unprefixed spelling is accepted too. Only the values matter: the payload uses 0-5 and NO_DIRECTION. */
        function dv(n) { return (DT && typeof DT['DIRECTION_' + n] === 'number') ? DT['DIRECTION_' + n] : (DT ? DT[n] : undefined); }
        var dtOk = !!DT && dv('NORTHEAST') === 0 && dv('EAST') === 1 && dv('SOUTHEAST') === 2 && dv('SOUTHWEST') === 3 &&
            dv('WEST') === 4 && dv('NORTHWEST') === 5 && DT.NO_DIRECTION === -1;
        var rtOk = !!RT && RT.NO_RIVER === -1 && RT.RIVER_MINOR === 0 && RT.RIVER_NAVIGABLE === 1;
        var mp = null;
        try {
            if (CF) {
                if (typeof CF.isAnyMultiplayer === 'function') {
                    var mpv = CF.isAnyMultiplayer();
                    if (typeof mpv === 'boolean') mp = mpv;
                } else if (typeof CF.isAnyMultiplayer === 'boolean') mp = CF.isAnyMultiplayer;
            }
        } catch (e) { mp = null; }
        var seed = null;
        try {
            if (CF && typeof CF.getGameValue === 'function') {
                var sv = CF.getGameValue('RandomSeed');
                if (typeof sv === 'number' || (typeof sv === 'string' && sv !== '')) seed = String(sv);
            }
        } catch (e4) { seed = null; }
        if (seed === null && P.uiSeed !== undefined && P.uiSeed !== null) seed = 'ui:' + String(P.uiSeed);
        var W = 0;
        var H = 0;
        try { if (GM && missing.length === 0) { W = GM.getGridWidth(); H = GM.getGridHeight(); } } catch (e5) { W = 0; H = 0; }
        var nav1 = null;
        var ocean1 = null;
        try {
            if (typeof GameInfo === 'object' && GameInfo && GameInfo.Terrains && typeof GameInfo.Terrains.lookup === 'function') {
                var tr = GameInfo.Terrains.lookup('TERRAIN_NAVIGABLE_RIVER');
                if (tr && typeof tr.$index === 'number') nav1 = tr.$index;
                var to = GameInfo.Terrains.lookup('TERRAIN_OCEAN');
                if (to && typeof to.$index === 'number') ocean1 = to.$index;
            }
        } catch (e6) { nav1 = null; }
        var navUI = (typeof P.nav === 'number') ? P.nav : null;
        var NAV = (nav1 !== null) ? nav1 : navUI;
        /* maxWrites 0 (or less) means "write nothing now": every component and removal waits (capped) */
        var maxW = (typeof P.maxWrites === 'number' && isFinite(P.maxWrites)) ? Math.max(0, Math.floor(P.maxWrites)) : 200;
        var lakeSource = (P.lakeSource === true);
        var key = String(seed) + '|' + W + '|' + H;
        OUT.key = key;
        OUT.pre = { W: W, H: H, nav: NAV, navUI: navUI, nav1: nav1, mp: mp, mpUI: (P.mpUI === undefined ? null : P.mpUI),
            seed: seed, isLake: hasLake, lakeSource: lakeSource, maxWrites: maxW };

        var why = null;
        if (P.mpUI === true || mp === true) why = 'multiplayer';
        else if (mp === null && P.mpUI !== false) why = 'multiplayer-unreadable';
        else if (!sri) why = 'no-setRiverInfo';
        else if (missing.length) why = 'missing:' + missing.join('+');
        else if (!dtOk) why = 'DirectionTypes-unexpected';
        else if (!rtOk) why = 'RiverTypes-unexpected';
        else if (!(W > 0 && H > 0)) why = 'no-map';
        else if (NAV === null) why = 'no-nav-index';
        else if (nav1 !== null && navUI !== null && nav1 !== navUI) why = 'nav-mismatch';
        L('pre', { mode: mode, W: W, H: H, nav: NAV, mp: mp, mpUI: OUT.pre.mpUI, seed: seed, sri: sri,
            lakeSource: lakeSource, maxWrites: maxW, refused: why || '-' });
        if (!hasLake) L('pre', { isLake: 'missing' });
        if (why) { OUT.refused = why; OUT.ok = true; return; }

        var NO_DIR = DT.NO_DIRECTION;
        var NO_RIV = RT.NO_RIVER;
        var NAV_RIV = RT.RIVER_NAVIGABLE;

        /* ---- map helpers (live GameCore reads; terrain is cached, river data never is) ---- */
        var locC = Object.create(null);
        var terC = Object.create(null);
        var nbC = Object.create(null);
        function idx(x, y) { return GM.getIndexFromXY(x, y); }
        function loc(i) {
            var l = locC[i];
            if (!l) { var r = GM.getLocationFromIndex(i); l = { x: r.x, y: r.y }; locC[i] = l; }
            return l;
        }
        function inMap(x, y) {
            return typeof x === 'number' && typeof y === 'number' && Math.floor(x) === x && Math.floor(y) === y &&
                x >= 0 && y >= 0 && x < W && y < H;
        }
        function terr(i) {
            var t = terC[i];
            if (t === undefined) { var l = loc(i); t = GM.getTerrainType(l.x, l.y); terC[i] = t; }
            return t;
        }
        function isNavT(i) { return terr(i) === NAV; }
        function navData(i) { var l = loc(i); return GM.isNavigableRiver(l.x, l.y) === true; }
        function rtype(i) { var l = loc(i); return GM.getRiverType(l.x, l.y); }
        var watC = Object.create(null);
        function isWater(i) {
            var w0 = watC[i];
            if (w0 === undefined) { var l = loc(i); w0 = (GM.isWater(l.x, l.y) === true); watC[i] = w0; }
            return w0;
        }
        function isLakeT(i) { if (!hasLake) return false; var l = loc(i); return GM.isLake(l.x, l.y) === true; }
        function isMount(i) { var l = loc(i); return GM.isMountain(l.x, l.y) === true; }
        function isImp(i) { var l = loc(i); return GM.isImpassable(l.x, l.y) === true; }
        /* review RW-W1: the plot holds river data of any kind (a water tile with it was a river tile painted to water) */
        function hasRiv(i) { return rtype(i) !== NO_RIV || navData(i); }
        /* review RW-M1: never a target, and the end of any recorded chain, whatever river data it still holds */
        function blocked(i) { return isMount(i) || isImp(i); }
        function elev(i) { var l = loc(i); var e = GM.getElevation(l.x, l.y); return (typeof e === 'number') ? e : 0; }
        function cliff(i, d) {
            var l = loc(i);
            try { return GM.isCliffCrossing(l.x, l.y, d) === true ? 1 : 0; } catch (e) { return 0; }
        }
        /* Valid neighbours only. Off-map, invalid and self results are dropped: setRiverInfo would write the outflow
           nibble even when its target plot does not exist. */
        function nbrs(i) {
            var c = nbC[i];
            if (c) return c;
            var l = loc(i);
            var out = [];
            for (var a = 0; a < DIRS.length; a++) {
                var d = DIRS[a];
                var p = GM.getAdjacentPlotLocation({ x: l.x, y: l.y }, d);
                if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') continue;
                if (!inMap(p.x, p.y)) continue;
                if (p.x === l.x && p.y === l.y) continue;
                if (!GM.isValidLocation({ x: p.x, y: p.y })) continue;
                var j = idx(p.x, p.y);
                if (!locC[j]) locC[j] = { x: p.x, y: p.y };
                out.push({ d: d, x: p.x, y: p.y, i: j });
            }
            nbC[i] = out;
            return out;
        }
        function nbrAt(i, d) {
            var nl = nbrs(i);
            for (var z = 0; z < nl.length; z++) if (nl[z].d === d) return nl[z].i;
            return -1;
        }
        function xy(i) { var l = loc(i); return l.x + '/' + l.y; }

        /* ---- STATE ---- */
        STAGE = 'state';
        var N = W * H;
        var B36W = 1;
        while (Math.pow(36, B36W) < N) B36W++;
        function okIndex(i) { return typeof i === 'number' && Math.floor(i) === i && i >= 0 && i < N; }
        function enc(i) { var s = i.toString(36); while (s.length < B36W) s = '0' + s; return s; }
        /* 'dr' / 'uw' / 'lf' strings: fixed-width base-36 plot indices (width from W*H), 'dr' and 'lf' with one
           direction digit each */
        function decList(str, withDir) {
            var out = [];
            if (typeof str !== 'string') return out;
            var step = B36W + (withDir ? 1 : 0);
            for (var p = 0; p + step <= str.length; p += step) {
                var i = parseInt(str.substr(p, B36W), 36);
                var dch = withDir ? str.charAt(p + B36W) : '';
                if (!okIndex(i)) continue;
                if (withDir && !(dch >= '0' && dch <= '5')) continue;
                out.push({ i: i, d: dch });
            }
            return out;
        }
        function validShape(s) { return !!s && typeof s === 'object' && s.v === 1; }
        function sameMap(s) { return String(s.seed) === String(seed) && s.W === W && s.H === H; }
        var pend = new Map(); /* plotIndex -> last written direction as a digit, or '-' (known tile, nothing written) */
        var risk = new Map(); /* plotIndex -> 1 */
        var dr = new Map();   /* plotIndex -> written direction digit (writer-drained tiles, oldest first) */
        var uw = new Map();   /* plotIndex -> 1 */
        /* review RW-L1: tiles a lake source was written into, with the direction of that lake. The engine keeps the
           tile's inflow bit from the lake even when its river data is removed later, so this is never forgotten. */
        var lf = new Map();   /* plotIndex -> direction digit of the feeding lake tile */
        var distrust = false;
        function loadInto(s) {
            pend.clear(); risk.clear(); dr.clear(); uw.clear(); lf.clear();
            var pl = Array.isArray(s.pend) ? s.pend : [];
            var pd = (typeof s.pd === 'string') ? s.pd : '';
            for (var z = 0; z < pl.length; z++) {
                if (!okIndex(pl[z])) continue;
                var ch = pd.charAt(z);
                pend.set(pl[z], (ch >= '0' && ch <= '5') ? ch : '-');
            }
            var rl = Array.isArray(s.risk) ? s.risk : [];
            for (z = 0; z < rl.length; z++) if (okIndex(rl[z])) risk.set(rl[z], 1);
            var dl = decList(s.dr, true);
            for (z = 0; z < dl.length; z++) { if (!pend.has(dl[z].i)) { dr.delete(dl[z].i); dr.set(dl[z].i, dl[z].d); } }
            var ul = decList(s.uw, false);
            for (z = 0; z < ul.length; z++) uw.set(ul[z].i, 1);
            var fl = decList(s.lf, true);
            for (z = 0; z < fl.length; z++) lf.set(fl[z].i, fl[z].d);
            distrust = (s.x === 1);
        }
        function stateCore() {
            var pk = [];
            var pdc = '';
            pend.forEach(function (v, key2) { pk.push(key2); pdc += v; });
            var rk = [];
            risk.forEach(function (v, key2) { rk.push(key2); });
            var drs = '';
            dr.forEach(function (v, key2) { drs += enc(key2) + v; });
            var uws = '';
            uw.forEach(function (v, key2) { uws += enc(key2); });
            var lfs = '';
            lf.forEach(function (v, key2) { lfs += enc(key2) + v; });
            return { pend: pk, pd: pdc, risk: rk, dr: drs, uw: uws, lf: lfs, x: distrust ? 1 : 0 };
        }
        function ser(core, g) {
            return JSON.stringify({ v: 1, seed: seed, W: W, H: H, g: g, pend: core.pend, pd: core.pd, risk: core.risk,
                dr: core.dr, uw: core.uw, lf: core.lf, x: core.x });
        }
        function coreKey(core) { return JSON.stringify(core); }

        var st = P.state;
        var stOk = false;
        if (P.stateBad) L('state', { ignored: 'bad-json' });
        if (validShape(st)) {
            if (!sameMap(st)) L('state', { ignored: 'mismatch', seed: st.seed, liveSeed: seed, W: st.W, H: st.H });
            else stOk = true;
        } else if (st !== null && st !== undefined) L('state', { ignored: 'bad-shape' });
        /* the Tuner-side copy: this context's own latest state (newer than the saved value when a write-back was lost) */
        var tSt = null;
        try {
            var TS = G ? G.__lcpRWstate : null;
            if (TS && typeof TS === 'object' && TS.key === key && typeof TS.json === 'string') {
                var tp = JSON.parse(TS.json);
                if (validShape(tp) && sameMap(tp)) tSt = tp;
            }
        } catch (e8) { tSt = null; }
        /* what the saved game value holds, normalised: the run reports stateChanged when its result differs */
        var cfgJson = '<none>';
        if (stOk) { loadInto(st); cfgJson = ser(stateCore(), (typeof st.g === 'number') ? st.g : 0); }
        else if ((st === null || st === undefined) && !P.stateBad) { loadInto({ v: 1 }); cfgJson = ser(stateCore(), 0); }
        var src = 'none';
        var startG = 0;
        if (tSt) { loadInto(tSt); src = 'tuner'; startG = (typeof tSt.g === 'number') ? tSt.g : 0; }
        else if (stOk) { loadInto(st); src = 'config'; startG = (typeof st.g === 'number') ? st.g : 0; }
        else loadInto({ v: 1 });
        /* The writer has lost its records for this map (the saved value is unreadable, or missing although the last run
           recorded this map): it can no longer tell its own tiles from the game's, so from now on it joins only rivers it
           can trace (dr), never an untraced one (sticky in the state as x:1). */
        if (!tSt && !stOk && (P.stateBad || (typeof P.lastKey === 'string' && P.lastKey === key)) && !distrust) {
            distrust = true;
            L('state', { distrust: P.stateBad ? 'bad-json' : 'lost', lastKey: P.lastKey });
        }
        var startCore = coreKey(stateCore());
        L('state', { loaded: (src !== 'none') ? 1 : 0, src: src, g: startG, pend: pend.size, risk: risk.size, dr: dr.size,
            uw: uw.size, lf: lf.size, distrust: distrust ? 1 : 0 });
        function riskHard() { var c = 0; risk.forEach(function (v, key2) { if (!isWater(key2)) c++; }); return c; }
        /* apply mode: keep the Tuner-side copy current before every map write (a conservative superset of the truth) */
        function saveT(final, g) {
            if (mode !== 'apply' || !G) return;
            var j = ser(stateCore(), final ? g : startG + 1);
            try { G.__lcpRWstate = { key: key, json: j }; SAVED.json = j; } catch (e9) { /* best effort */ }
        }

        /* ---- QUEUE: 'v1|n:X:Y:W|rm:X:Y'; dedupe per tile, the last entry wins ---- */
        STAGE = 'queue';
        var done = RES.done;
        var qn = Object.create(null);
        var qrm = [];
        var qs = { n: 0, rm: 0, bad: 0, sup: 0, ver: '-' };
        var qstr = (typeof P.q === 'string') ? P.q : '';
        function isDigits(s) {
            if (typeof s !== 'string' || s.length === 0 || s.length > 6) return false;
            for (var z = 0; z < s.length; z++) { var cc = s.charCodeAt(z); if (cc < 48 || cc > 57) return false; }
            return true;
        }
        if (qstr.length) {
            var parts = qstr.split('|');
            qs.ver = parts[0];
            if (parts[0] !== 'v1') {
                L('queue', { bad: 'version', head: parts[0], len: qstr.length });
            } else {
                var lastBy = Object.create(null);
                var orderTiles = [];
                for (k = 1; k < parts.length; k++) {
                    var tkn = parts[k];
                    if (!tkn) continue;
                    var f = tkn.split(':');
                    var ent = null;
                    if (f[0] === 'n' && f.length === 4 && isDigits(f[1]) && isDigits(f[2]) && (f[3] === '0' || f[3] === '1')) {
                        ent = { k: 'n', x: +f[1], y: +f[2], w: +f[3], t: tkn };
                    } else if (f[0] === 'rm' && f.length === 3 && isDigits(f[1]) && isDigits(f[2])) {
                        ent = { k: 'rm', x: +f[1], y: +f[2], t: tkn };
                    }
                    if (!ent || !inMap(ent.x, ent.y)) {
                        qs.bad++;
                        capPush(done, LIST_CAP.done, tkn);
                        L('queue', { bad: tkn });
                        continue;
                    }
                    var ti = idx(ent.x, ent.y);
                    if (!locC[ti]) locC[ti] = { x: ent.x, y: ent.y };
                    if (lastBy[ti]) {
                        qs.sup++;
                        capPush(done, LIST_CAP.done, lastBy[ti].t);
                    } else orderTiles.push(ti);
                    lastBy[ti] = ent;
                }
                for (k = 0; k < orderTiles.length; k++) {
                    var e0 = lastBy[orderTiles[k]];
                    if (e0.k === 'n') { qn[orderTiles[k]] = e0; qs.n++; } else { qrm.push({ i: orderTiles[k], e: e0 }); qs.rm++; }
                }
            }
        }
        OUT.q = qs;
        L('queue', { n: qs.n, rm: qs.rm, bad: qs.bad, sup: qs.sup, ver: qs.ver });

        var writes = 0;
        var capped = false;
        var wrote = RES.wrote;
        var removed = RES.removed;
        var refused = RES.rmRefused;
        var fail = RES.fail;
        var lake = RES.lake;
        var lakeSkip = RES.lakeSkip;
        var tiles = RES.tiles;
        var cnt = { cand: 0, comps: 0, wroteN: 0, drainedN: 0, pendN: 0, enclosedN: 0, unchangedN: 0, removedN: 0,
            refusedN: 0, failN: 0, lakeN: 0, lakeSkipN: 0, skippedN: 0, fullN: 0, adoptN: 0 };
        var newsEnclosed = false;
        function addFail(i, w) { cnt.failN++; capPush(fail, LIST_CAP.fail, [i, w]); }

        /* ---- STEP 1/6: removals ---- */
        STAGE = 'rm';
        for (k = 0; k < qrm.length; k++) {
            var r = qrm[k];
            var rl0 = loc(r.i);
            CUR.x = rl0.x; CUR.y = rl0.y;
            var rwhy = null;
            if (isNavT(r.i)) rwhy = 'rm-on-nav-terrain';
            else if (isWater(r.i) || isMount(r.i)) rwhy = 'engine-noop-water-or-mountain';
            else if (rtype(r.i) === NO_RIV) rwhy = 'no-river';
            else if (!risk.has(r.i) && riskHard() >= RISK_CAP) rwhy = 'state-full';
            if (rwhy) {
                cnt.refusedN++;
                capPush(refused, LIST_CAP.refused, [rl0.x, rl0.y, rwhy]);
                capPush(done, LIST_CAP.done, r.e.t);
                L('rm', { x: rl0.x, y: rl0.y, refused: rwhy });
                continue;
            }
            if (writes >= maxW) {
                capped = true;
                L('cap', { stage: 'rm', x: rl0.x, y: rl0.y, writes: writes });
                continue;
            }
            var rok = true;
            var rb = NO_RIV;
            /* the cleared tile: upstream rivers now end on it, so it must never join one of them */
            risk.set(r.i, 1);
            if (mode === 'apply') {
                saveT(false);
                TB.setRiverInfo(rl0.x, rl0.y, NO_DIR, NO_RIV);
                rb = rtype(r.i);
                rok = (rb === NO_RIV);
            }
            writes++;
            if (rok) {
                cnt.removedN++; capPush(removed, LIST_CAP.removed, r.i);
                pend.delete(r.i); dr.delete(r.i); uw.delete(r.i);
            } else addFail(r.i, 'rm-readback:rt=' + rb);
            capPush(done, LIST_CAP.done, r.e.t);
            L(rok ? 'rm' : 'readback', { x: rl0.x, y: rl0.y, ok: rok ? 1 : 0, rt: rb, planned: mode === 'apply' ? 0 : 1 });
        }
        CUR.x = null; CUR.y = null;

        /* ---- STEP 2/6: candidates = NAV terrain without nav data, plus pending tiles still on NAV terrain ---- */
        STAGE = 'scan';
        var cand = Object.create(null);
        var candList = [];
        for (var yy = 0; yy < H; yy++) {
            for (var xx = 0; xx < W; xx++) {
                var tt = GM.getTerrainType(xx, yy);
                if (tt !== NAV) continue;
                var ci = idx(xx, yy);
                terC[ci] = tt;
                if (!locC[ci]) locC[ci] = { x: xx, y: yy };
                if (pend.has(ci) || GM.isNavigableRiver(xx, yy) !== true) { cand[ci] = 1; candList.push(ci); }
            }
        }
        candList.sort(function (a, b) { return a - b; });
        cnt.cand = candList.length;
        for (var qk in qn) {
            var qi = +qk;
            if (cand[qi]) continue;
            capPush(done, LIST_CAP.done, qn[qk].t);
            var qwhy = isNavT(qi) ? 'already-river' : 'not-nav-terrain';
            var adopt = 0;
            /* a queued tile that already holds navigable river data the writer has no record of: written by a run whose
               state was lost (e.g. a save & load before its write-back). Never join it (uw); never rewrite it. */
            if (qwhy === 'already-river' && navData(qi) && !dr.has(qi) && !uw.has(qi)) {
                if (uw.size < UW_CAP) { uw.set(qi, 1); adopt = 1; cnt.adoptN++; } else { adopt = -1; L('cap', { state: 'uw', x: qn[qk].x, y: qn[qk].y }); }
            }
            L('queue', { x: qn[qk].x, y: qn[qk].y, skip: qwhy, uw: adopt });
        }
        L('scan', { cand: candList.length, rm: qrm.length });
        if (candList.length === 0 && qrm.length === 0) OUT.noop = true;

        function isRisk(i) {
            if (risk.has(i)) return true;
            var e = qn[i];
            if (e) return e.w === 1;
            return !pend.has(i);
        }
        /* Joining a GAME river tile n (navigable data the writer has no record of) needs: no risk tile in the component,
           AND no component tile next to n lower than n. GameplayMap exposes no outflow getter; this is the guard against
           joining a river that flows INTO the component (e.g. a real river mouth painted to land and then to Navigable
           River, which the queue records as W=0): real rivers flow downhill into lower water, so a river tile can only
           flow into a neighbour that is not higher than itself. Equal elevation is allowed (flat land); see README. */
        var uphill = 0;
        var joinOk = Object.create(null);
        function riverJoinable(i, inC) {
            var v = joinOk[i];
            if (v !== undefined) return v;
            var e = elev(i);
            var nl = nbrs(i);
            v = true;
            for (var z = 0; z < nl.length; z++) if (inC[nl[z].i] && elev(nl[z].i) < e) { v = false; break; }
            joinOk[i] = v;
            return v;
        }
        function gameJoinable(i, risky, inC) {
            if (risky || distrust) return false;
            if (!riverJoinable(i, inC)) { uphill++; return false; }
            return true;
        }
        /* Follow a writer-drained tile's (dr) recorded chain downstream: {k:'water', t} at the first water tile, which
           must hold no river data (review RW-W1); {k:'game', t} at a navigable tile the writer has no record of;
           {k:'comp'} when it enters the component; else {k:'bad'}: it leaves the map, or reaches stale water, a
           mountain or impassable plot (review RW-M1), a pending or unknown tile, or a tile without navigable data. */
        var BAD = { k: 'bad' };
        var COMP = { k: 'comp' };
        function walk(n, inC) {
            var cur = n;
            for (var step = 0; step <= N; step++) {
                var nx = nbrAt(cur, +dr.get(cur));
                if (nx < 0) return BAD;
                if (inC[nx]) return COMP;
                if (isWater(nx)) return (hasRiv(nx) || (isLakeT(nx) && lakeStale(lakeId(nx)))) ? BAD : { k: 'water', t: nx };
                if (blocked(nx) || pend.has(nx) || uw.has(nx) || !navData(nx)) return BAD;
                if (dr.has(nx)) { cur = nx; continue; }
                return { k: 'game', t: nx };
            }
            return BAD;
        }
        /* A writer-drained tile (dr) is joinable when its recorded chain reaches water, or a game river that passes the
           game-river rule, without entering the component (review RW-2: the writer's own rivers can be extended
           inland whatever their elevation). Pending and unknown tiles are never joinable. */
        function joinable(n, risky, inC) {
            if (pend.has(n) || uw.has(n)) return false;
            if (!dr.has(n)) return gameJoinable(n, risky, inC);
            var wk = walk(n, inC);
            if (wk.k === 'water') {
                if (hasLake && isLakeT(wk.t) && !lakeSinkOk(lakeId(wk.t), inC, risky)) { lakeLoopN++; return false; }
                return true;
            }
            if (wk.k === 'game') return gameJoinable(wk.t, risky, inC);
            return false;
        }
        var staleN = 0;
        var lakeLoopN = 0;
        function classify(nb, risky, inC) {
            var i = nb.i;
            if (isWater(i)) {
                /* review RW-W1: a water tile that still holds river data (a river tile painted to water) keeps its old
                   outflow: never a mouth */
                if (hasRiv(i)) { staleN++; return null; }
                if (!isLakeT(i)) return 'sea';
                /* final review: a lake with river data on ANY of its tiles (a river tile painted into the lake keeps its
                   outflow, so the lake may already feed a river): never a mouth, so no river can lead back into it */
                if (lakeStale(lakeId(i))) { staleN++; return null; }
                /* review RW-L1: never drain into a lake that feeds a river flowing into this component */
                if (!lakeSinkOk(lakeId(i), inC, risky)) { lakeLoopN++; return null; }
                return 'lake';
            }
            if (blocked(i)) return null; /* review RW-M1: before the river-data check */
            if (navData(i)) return joinable(i, risky, inC) ? 'river' : null;
            if (rtype(i) !== NO_RIV) return null; /* a minor river is never a target */
            if (isNavT(i)) return null;
            return 'land';
        }

        /* ---- review RW-L1: lake sources ---- */
        /* a lake's identity: the smallest plot index of its body (a flood fill over adjacent lake tiles) */
        var lkId = Object.create(null);
        var lkBody = Object.create(null);
        function lakeId(i) {
            if (lkId[i] !== undefined) return lkId[i];
            var body = [i];
            var seen = Object.create(null);
            seen[i] = 1;
            var m = i;
            for (var h = 0; h < body.length; h++) {
                var nl = nbrs(body[h]);
                for (var z = 0; z < nl.length; z++) {
                    var q = nl[z].i;
                    if (!seen[q] && isWater(q) && isLakeT(q)) { seen[q] = 1; body.push(q); if (q < m) m = q; }
                }
            }
            for (h = 0; h < body.length; h++) lkId[body[h]] = m;
            lkBody[m] = body;
            return m;
        }
        /* final review: does any tile of lake B still hold river data (a river tile painted into the lake)? Cached. */
        var lkStale = Object.create(null);
        function lakeStale(B) {
            if (lkStale[B] !== undefined) return lkStale[B];
            var body = lkBody[B] || [B];
            var st = false;
            for (var z = 0; z < body.length; z++) if (hasRiv(body[z])) { st = true; break; }
            lkStale[B] = st;
            return st;
        }
        /* Where can the rivers that lake B feeds lead? A lake source is written only into a tile of a component being
           drained, which then is a dr tile, so the rivers B may feed are taken to be every dr tile next to B
           (conservative: also those that drain into B), plus the recorded lake-fed tiles (lf) of B whatever they hold
           now. Their recorded chains are followed, lake by lake.
           Result: { b: the lakes reached (B included), comp: one of them flows into the component (or such a tile is
           part of it), lost: one of them can't be traced }. Cached per component (fedC). */
        var fedC = Object.create(null);
        /* the lake an lf entry is fed from, as a lake identity (-1 when that plot is no longer lake water) */
        function lfLake(t, dch) {
            var p = nbrAt(t, +dch);
            return (p >= 0 && isWater(p) && isLakeT(p)) ? lakeId(p) : -1;
        }
        function lakeFed(B, inC) {
            if (fedC[B]) return fedC[B];
            var r = { b: Object.create(null), comp: false, lost: false };
            var q = [B];
            r.b[B] = 1;
            function lfScan(bId) {
                /* recorded lake-fed tiles of this lake (their inflow bit outlives a removal of their river data) */
                lf.forEach(function (dch, t) {
                    if (lfLake(t, dch) !== bId) return;
                    if (inC[t]) { r.comp = true; return; }
                    if (dr.has(t)) return;              /* a dr tile next to the lake: followed below */
                    if (hasRiv(t)) r.lost = true;       /* pending or unknown river data: can't be traced */
                });
            }
            for (var h = 0; h < q.length; h++) {
                lfScan(q[h]);
                var body = lkBody[q[h]];
                for (var z = 0; z < body.length; z++) {
                    var nl = nbrs(body[z]);
                    for (var u = 0; u < nl.length; u++) {
                        var n = nl[u].i;
                        /* final review (g3): a navigable river next to the lake that the writer has no record of (a game
                           river, or adopted/pending data) may LEAVE the lake and can't be traced: count it as lost */
                        if (!dr.has(n)) { if (!inC[n] && !isWater(n) && navData(n)) r.lost = true; continue; }
                        if (inC[n]) { r.comp = true; continue; }
                        var wk = walk(n, inC);
                        if (wk.k === 'comp') { r.comp = true; continue; }
                        if (wk.k !== 'water') { r.lost = true; continue; }
                        if (!isLakeT(wk.t)) continue;
                        var b2 = lakeId(wk.t);
                        if (!r.b[b2]) { r.b[b2] = 1; q.push(b2); }
                    }
                }
            }
            fedC[B] = r;
            return r;
        }
        /* May the component drain into lake B (as its mouth, or through a recorded chain that ends in B)? Not when a
           river B may feed flows into the component: that closes a loop through the lake (e.g. the sea mouth of a
           lake-fed river painted to Navigable River next to that lake). An untraceable one counts only for a component
           with a risk tile, like a game-river join. */
        function lakeSinkOk(B, inC, risky) {
            var r = lakeFed(B, inC);
            return !r.comp && !(r.lost && risky);
        }
        /* Would lake L feed a river that leads back into L, if that river ends in lake B? Any chain that can't be
           traced counts as a loop here (fail closed: only the lake link is skipped). */
        function lakeLoop(L, B, inC) {
            if (B === L) return 'same-lake';
            var r = lakeFed(B, inC);
            return (r.b[L] || r.comp || r.lost) ? 'feeds-back' : null;
        }
        /* Why this lake may NOT feed this tile (null = it may). The fed tile's planned path leads to its mouth: the sea
           is fine; a river must be one of the writer's own with a recorded chain that ends in water, and that water must
           not be this lake, nor a lake that may feed a river back into it. A game river can't be traced: never. */
        function lakeWhy(c, seeds, dir, dcls, inC, cap) {
            if (hasRiv(c.nb.i) || lakeStale(lakeId(c.nb.i))) return 'lake-river-data';
            if (!lf.has(c.tile) && lf.size >= LF_CAP) return 'state-full';
            var cur = c.tile;
            for (var z = 0; z <= cap && dcls[cur] === 'up'; z++) {
                cur = nbrAt(cur, dir[cur]);
                if (cur < 0 || !inC[cur]) return 'no-path';
            }
            var sd = seeds[cur];
            if (!sd || dcls[cur] !== sd.cls) return 'no-path';
            if (sd.cls === 'sea') return null;
            if (sd.cls !== 'river') return 'no-path';
            if (!dr.has(sd.t)) return 'game-river';
            var wk = walk(sd.t, inC);
            if (wk.k === 'game') return 'game-river';
            if (wk.k !== 'water') return 'untraced';
            if (!isLakeT(wk.t)) return null;
            return lakeLoop(lakeId(c.nb.i), lakeId(wk.t), inC);
        }

        /* components over candidates, 6-connected */
        STAGE = 'comp';
        var compOf = Object.create(null);
        var comps = [];
        for (k = 0; k < candList.length; k++) {
            var s0 = candList[k];
            if (compOf[s0] !== undefined) continue;
            var cid = comps.length;
            var ct = [s0];
            compOf[s0] = cid;
            for (var h = 0; h < ct.length; h++) {
                var nl = nbrs(ct[h]);
                for (var u = 0; u < nl.length; u++) {
                    if (cand[nl[u].i] && compOf[nl[u].i] === undefined) { compOf[nl[u].i] = cid; ct.push(nl[u].i); }
                }
            }
            ct.sort(function (a, b) { return a - b; });
            var queued = 0;
            for (u = 0; u < ct.length; u++) if (qn[ct[u]]) queued++;
            comps.push({ id: cid, t: ct, queued: queued });
        }
        cnt.comps = comps.length;
        /* the user's latest paints first, then the rest, each by lowest plot index */
        comps.sort(function (a, b) {
            if ((a.queued > 0) !== (b.queued > 0)) return a.queued > 0 ? -1 : 1;
            return a.t[0] - b.t[0];
        });

        /* would recording these tiles as pending (and their risky tiles as risk) overflow the never-evicted lists? */
        function stateRoom(c, riskyTiles) {
            var pn = 0;
            var rn = 0;
            for (var z = 0; z < c.t.length; z++) if (!pend.has(c.t[z])) pn++;
            for (z = 0; z < riskyTiles.length; z++) if (!risk.has(riskyTiles[z])) rn++;
            return (pn === 0 || pend.size + pn <= PEND_CAP) && (rn === 0 || riskHard() + rn <= RISK_CAP);
        }
        function hold(c, riskyTiles) {
            /* keep the tile's place and its last written direction; a new tile is known but unwritten ('-') */
            if (!stateRoom(c, riskyTiles)) { L('cap', { state: 'hold', id: c.id, size: c.t.length }); return; }
            for (var z = 0; z < c.t.length; z++) if (!pend.has(c.t[z])) pend.set(c.t[z], '-');
            for (z = 0; z < riskyTiles.length; z++) risk.set(riskyTiles[z], 1);
        }
        function consume(c) {
            for (var z = 0; z < c.t.length; z++) if (qn[c.t[z]]) capPush(done, LIST_CAP.done, qn[c.t[z]].t);
        }

        for (var ck = 0; ck < comps.length; ck++) {
            var C = comps[ck];
            STAGE = 'assign';
            CUR.x = loc(C.t[0]).x; CUR.y = loc(C.t[0]).y;
            var inC = Object.create(null);
            var j;
            for (j = 0; j < C.t.length; j++) inC[C.t[j]] = 1;
            var riskyTiles = [];
            for (j = 0; j < C.t.length; j++) if (isRisk(C.t[j])) riskyTiles.push(C.t[j]);
            var risky = riskyTiles.length > 0;
            uphill = 0;
            staleN = 0;
            lakeLoopN = 0;
            joinOk = Object.create(null);
            fedC = Object.create(null);

            /* STEP 3/6: classify the out-of-component neighbours */
            var sinks = { sea: 0, river: 0, lake: 0, land: 0 };
            var bestM = Object.create(null);
            var bestLk = Object.create(null);
            var hasMouth = false;
            var hasLakeSink = false;
            var root = null;
            for (j = 0; j < C.t.length; j++) {
                var ti2 = C.t[j];
                var nl2 = nbrs(ti2);
                for (var v = 0; v < nl2.length; v++) {
                    var nb = nl2[v];
                    if (inC[nb.i]) continue;
                    var cls = classify(nb, risky, inC);
                    if (!cls) continue;
                    sinks[cls]++;
                    if (cls === 'land') {
                        var lkey = [elev(ti2), elev(nb.i), ti2, nb.d];
                        if (!root || lexLess(lkey, root.key)) root = { i: ti2, d: nb.d, key: lkey, cls: 'land' };
                        continue;
                    }
                    var rank = (cls === 'sea') ? 0 : ((cls === 'river') ? 1 : 2);
                    var key3 = [rank, elev(nb.i), cliff(ti2, nb.d), nb.d];
                    var tbl = (rank < 2) ? bestM : bestLk;
                    if (!tbl[ti2] || lexLess(key3, tbl[ti2].key)) tbl[ti2] = { d: nb.d, key: key3, cls: cls, t: nb.i };
                    if (rank < 2) hasMouth = true; else hasLakeSink = true;
                }
            }

            /* STEP 4/6: seeds (sea and river mouths; a lake is a mouth only when the component has neither), BFS */
            var seeds = hasMouth ? bestM : (hasLakeSink ? bestLk : null);
            var dir = Object.create(null);
            var dcls = Object.create(null);
            var dist = Object.create(null);
            var order = [];
            var frontier = [];
            var kind;
            var toCls = {};
            if (seeds) {
                kind = 'drained';
                for (j = 0; j < C.t.length; j++) {
                    var sd = seeds[C.t[j]];
                    if (!sd) continue;
                    dir[C.t[j]] = sd.d;
                    dcls[C.t[j]] = sd.cls;
                    dist[C.t[j]] = 0;
                    frontier.push(C.t[j]);
                    toCls[sd.cls] = 1;
                }
            } else if (root) {
                kind = 'pending';
                dir[root.i] = root.d;
                dcls[root.i] = 'land';
                dist[root.i] = 0;
                frontier.push(root.i);
                toCls.land = 1;
            } else kind = 'enclosed';
            while (frontier.length) {
                for (j = 0; j < frontier.length; j++) order.push(frontier[j]);
                var next = [];
                for (j = 0; j < frontier.length; j++) {
                    var nf = nbrs(frontier[j]);
                    for (v = 0; v < nf.length; v++) {
                        if (inC[nf[v].i] && dist[nf[v].i] === undefined) { dist[nf[v].i] = dist[frontier[j]] + 1; next.push(nf[v].i); }
                    }
                }
                next.sort(function (a, b) { return a - b; });
                for (j = 0; j < next.length; j++) {
                    var tj = next[j];
                    var best = null;
                    var nn = nbrs(tj);
                    for (v = 0; v < nn.length; v++) {
                        if (!inC[nn[v].i] || dist[nn[v].i] !== dist[tj] - 1) continue;
                        var bkey = [elev(nn[v].i), cliff(tj, nn[v].d), nn[v].d];
                        if (!best || lexLess(bkey, best.key)) best = { d: nn[v].d, key: bkey };
                    }
                    if (best) { dir[tj] = best.d; dcls[tj] = 'up'; }
                }
                frontier = next;
            }
            var toStr = Object.keys(toCls).join('+') || '-';

            /* STEP 6/6 planning: the lake that feeds a component drained to sea or river. Candidates: the lake tiles next
               to the component, the furthest-upstream tile first; the first one lakeWhy() allows is used (review RW-L1). */
            var lk = null;
            var lkSkip = null;
            if (lakeSource && hasLake && kind === 'drained' && hasMouth) {
                var lks = [];
                for (j = 0; j < C.t.length; j++) {
                    var tl = C.t[j];
                    var nl3 = nbrs(tl);
                    for (v = 0; v < nl3.length; v++) {
                        var ln = nl3[v];
                        if (inC[ln.i] || !isWater(ln.i) || !isLakeT(ln.i)) continue;
                        if (ocean1 !== null && terr(ln.i) === ocean1) continue;
                        lks.push({ tile: tl, nb: ln, key: [-(dist[tl] || 0), tl, ln.d] });
                    }
                }
                lks.sort(function (a, b) { return lexLess(a.key, b.key) ? -1 : (lexLess(b.key, a.key) ? 1 : 0); });
                for (j = 0; j < lks.length && !lk; j++) {
                    var lwhy = lakeWhy(lks[j], seeds, dir, dcls, inC, C.t.length);
                    if (lwhy === null) lk = lks[j];
                    else if (!lkSkip) lkSkip = { c: lks[j], why: lwhy, n: lks.length };
                }
                if (lk) lkSkip = null;
            }

            var unchanged = false;
            if (kind === 'pending' && C.queued === 0) {
                unchanged = true;
                for (j = 0; j < C.t.length; j++) {
                    var ui = C.t[j];
                    if (!pend.has(ui) || pend.get(ui) !== String(dir[ui]) || !navData(ui)) { unchanged = false; break; }
                }
            }
            var needW = (kind === 'enclosed' || unchanged) ? 0 : (C.t.length + (lk ? 1 : 0));
            var lineBase = { id: C.id, size: C.t.length, at: xy(C.t[0]), sinks: 'sea' + sinks.sea + ':river' + sinks.river +
                ':lake' + sinks.lake + ':land' + sinks.land, uphill: uphill, to: toStr, risk: risky ? 1 : 0, queued: C.queued };
            if (staleN) lineBase.stale = staleN; /* neighbouring water tiles that still hold river data (not mouths) */
            if (lakeLoopN) lineBase.lakeLoop = lakeLoopN; /* lake mouths refused: the lake feeds a river into this component */

            if (kind === 'enclosed') {
                cnt.enclosedN += C.t.length;
                if (C.queued) newsEnclosed = true;
                hold(C, riskyTiles);
                consume(C);
                lineBase.kind = 'enclosed';
                L('comp', lineBase);
                continue;
            }
            if (unchanged) {
                cnt.unchangedN += C.t.length;
                hold(C, riskyTiles);
                lineBase.kind = 'unchanged';
                L('comp', lineBase);
                continue;
            }
            if (maxW > 0 && needW > maxW) {
                addFail(C.t[0], 'component-too-big:' + C.t.length);
                hold(C, riskyTiles);
                consume(C);
                lineBase.kind = 'too-big';
                lineBase.need = needW;
                L('cap', lineBase);
                continue;
            }
            if (writes + needW > maxW) {
                capped = true;
                cnt.skippedN += C.t.length;
                lineBase.kind = 'capped';
                lineBase.need = needW;
                lineBase.writes = writes;
                L('cap', lineBase);
                continue;
            }
            /* a pending river must be remembered (it may flow uphill into land): no room, no write (fail closed) */
            if (kind === 'pending' && !stateRoom(C, riskyTiles)) {
                cnt.fullN += C.t.length;
                addFail(C.t[0], 'state-full:' + C.t.length);
                consume(C);
                lineBase.kind = 'state-full';
                L('cap', lineBase);
                continue;
            }
            lineBase.kind = kind;
            L('comp', lineBase);

            /* write-ahead (review RW-1): before any write, the Tuner-side copy marks every tile of this component as
               pending with an unknown direction, keeps its risky tiles, and marks the water it will drain into. A run
               that stops half way (throw, lost reply, lost write-back) therefore never leaves an unremembered river. */
            for (j = 0; j < C.t.length; j++) { pend.set(C.t[j], '-'); dr.delete(C.t[j]); }
            for (j = 0; j < riskyTiles.length; j++) risk.set(riskyTiles[j], 1);
            if (kind === 'drained') {
                for (j = 0; j < C.t.length; j++) {
                    var sdw = seeds[C.t[j]];
                    if (sdw && (sdw.cls === 'sea' || sdw.cls === 'lake')) risk.set(sdw.t, 1);
                }
            }
            saveT(false);

            /* STEP 5/6: write and read back, in BFS order (mouths first) */
            STAGE = 'write';
            var okDir = Object.create(null);
            for (j = 0; j < order.length; j++) {
                var wi = order[j];
                var wl = loc(wi);
                var d = dir[wi];
                CUR.x = wl.x; CUR.y = wl.y;
                if (typeof d !== 'number' || Math.floor(d) !== d || d < 0 || d > 5) { addFail(wi, 'bad-dir'); continue; }
                if (isWater(wi) || isMount(wi)) { addFail(wi, 'guard-water-or-mountain'); continue; }
                var ok = true;
                var wrt = NAV_RIV;
                var wnv = true;
                if (mode === 'apply') {
                    TB.setRiverInfo(wl.x, wl.y, d, NAV_RIV);
                    wrt = rtype(wi);
                    wnv = navData(wi);
                    ok = (wrt === NAV_RIV && wnv === true);
                }
                writes++;
                if (ok) {
                    okDir[wi] = d;
                    cnt.wroteN++;
                    capPush(wrote, LIST_CAP.wrote, wi);
                    capPush(tiles, LIST_CAP.tiles, wl.x + '/' + wl.y + ':' + d + ':' + dcls[wi]);
                    if (kind === 'drained') cnt.drainedN++; else cnt.pendN++;
                } else {
                    addFail(wi, 'readback:rt=' + wrt + ':nav=' + wnv);
                    L('readback', { x: wl.x, y: wl.y, rt: wrt, nav: wnv });
                }
            }
            L('write', { id: C.id, n: order.length, kind: kind, planned: mode === 'apply' ? 0 : 1 });

            /* state for this component: a drained one leaves pend and is recorded with its directions (dr); a tile
               whose write did not read back stays pending '-' (unknown); a pending one keeps its written directions */
            var allOk = true;
            for (j = 0; j < C.t.length; j++) if (okDir[C.t[j]] === undefined) { allOk = false; break; }
            if (kind === 'drained') {
                for (j = 0; j < C.t.length; j++) {
                    var di = C.t[j];
                    if (okDir[di] !== undefined && allOk) { pend.delete(di); dr.delete(di); dr.set(di, String(okDir[di])); }
                    else if (okDir[di] !== undefined) pend.set(di, String(okDir[di]));
                }
            } else {
                for (j = 0; j < C.t.length; j++) {
                    var pi = C.t[j];
                    pend.set(pi, okDir[pi] !== undefined ? String(okDir[pi]) : '-');
                }
            }
            consume(C);

            /* STEP 6/6: lake source. The lake plot is COAST: the engine only sets the inflow bit of the river tile
               (when the plot qualifies), so the lake itself reads back as no river. Only for a component whose every
               write read back: a lake never feeds a river left pending (fail closed). */
            if (lk && !allOk) { lkSkip = { c: lk, why: 'write-failed', n: 1 }; lk = null; }
            if (lkSkip) {
                cnt.lakeSkipN++;
                capPush(lakeSkip, LIST_CAP.lake, [lkSkip.c.nb.i, lkSkip.why]);
                L('lake', { id: C.id, x: lkSkip.c.nb.x, y: lkSkip.c.nb.y, into: xy(lkSkip.c.tile), skip: lkSkip.why,
                    cands: lkSkip.n, planned: mode === 'apply' ? 0 : 1 });
            }
            if (lk) {
                STAGE = 'lake';
                var ld = (lk.nb.d + 3) % 6;
                CUR.x = lk.nb.x; CUR.y = lk.nb.y;
                var lrb = NO_RIV;
                /* write-ahead: the fed tile is remembered (lf) before the write; the engine never clears its inflow bit */
                lf.delete(lk.tile);
                lf.set(lk.tile, String(lk.nb.d));
                saveT(false);
                if (mode === 'apply') {
                    TB.setRiverInfo(lk.nb.x, lk.nb.y, ld, NAV_RIV);
                    lrb = rtype(lk.nb.i);
                }
                writes++;
                if (lrb === NO_RIV) { cnt.lakeN++; capPush(lake, LIST_CAP.lake, lk.nb.i); } else addFail(lk.nb.i, 'lake-readback:rt=' + lrb);
                L('lake', { x: lk.nb.x, y: lk.nb.y, dir: ld, into: xy(lk.tile), rt: lrb, planned: mode === 'apply' ? 0 : 1 });
            }
            saveT(false);
        }
        CUR.x = null; CUR.y = null;

        /* ---- new state: prune, fit the size budget (evicting only dr and water risk marks), save ----
           A pend or dr tile painted to water or to a mountain keeps its river data, so it stays recorded on purpose
           (review RW-W1): classify() and walk() never use it as a mouth or a chain end, and if it is painted back to
           Navigable River it is still known (a pending tile is re-planned, a dr tile keeps its recorded direction)
           instead of looking like a game river. */
        STAGE = 'state-out';
        var drop = [];
        pend.forEach(function (v, key2) { if (!isNavT(key2) && !navData(key2)) drop.push(key2); });
        for (k = 0; k < drop.length; k++) pend.delete(drop[k]);
        drop = [];
        risk.forEach(function (v, key2) { if (isNavT(key2) && navData(key2) && !pend.has(key2)) drop.push(key2); });
        for (k = 0; k < drop.length; k++) risk.delete(drop[k]);
        drop = [];
        dr.forEach(function (v, key2) { if (!navData(key2) || pend.has(key2)) drop.push(key2); });
        for (k = 0; k < drop.length; k++) dr.delete(drop[k]);
        drop = [];
        uw.forEach(function (v, key2) { if (!navData(key2)) drop.push(key2); });
        for (k = 0; k < drop.length; k++) uw.delete(drop[k]);
        drop = [];
        /* a lake-fed tile is forgotten only when its feeding plot is no longer lake water (no lake to loop through) */
        lf.forEach(function (v, key2) { var lp = nbrAt(key2, +v); if (lp < 0 || !isWater(lp) || !isLakeT(lp)) drop.push(key2); });
        for (k = 0; k < drop.length; k++) lf.delete(drop[k]);
        var evDr = 0;
        var evRisk = 0;
        var sj = ser(stateCore(), startG + 1);
        while (sj.length > STATE_BUDGET) {
            var victim = null;
            if (dr.size) {
                dr.forEach(function (v, key2) { if (victim === null) victim = key2; });
                dr.delete(victim);
                evDr++;
            } else {
                risk.forEach(function (v, key2) { if (victim === null && isWater(key2)) victim = key2; });
                if (victim === null) break;
                risk.delete(victim);
                evRisk++;
            }
            sj = ser(stateCore(), startG + 1);
        }
        if (evDr || evRisk) L('cap', { state: 'evict', dr: evDr, waterRisk: evRisk, len: sj.length });
        if (sj.length > STATE_BUDGET) L('cap', { state: 'size', len: sj.length, pend: pend.size, risk: risk.size, uw: uw.size, lf: lf.size });
        var finalCore = coreKey(stateCore());
        var finalG = startG + (finalCore !== startCore ? 1 : 0);
        sj = ser(stateCore(), finalG);
        saveT(true, finalG);
        OUT.stateJson = sj;
        OUT.stateChanged = (sj !== cfgJson);
        OUT.distrust = distrust;

        try { OUT.turn = (typeof Game === 'object' && Game && typeof Game.turn === 'number') ? Game.turn : null; } catch (e7) { OUT.turn = null; }
        OUT.c = cnt;
        OUT.capped = capped;
        OUT.wrote = wrote;
        OUT.removed = removed;
        OUT.rmRefused = refused;
        OUT.fail = fail;
        OUT.lake = lake;
        OUT.lakeSkip = lakeSkip;
        OUT.tiles = tiles;
        OUT.done = done;
        OUT.writes = writes;
        OUT.news = (cnt.wroteN > 0 || cnt.removedN > 0 || cnt.refusedN > 0 || cnt.failN > 0 || cnt.lakeN > 0 || capped || newsEnclosed);
        OUT.noop = !!OUT.noop;
        L('done', { mode: mode, wrote: cnt.wroteN, drained: cnt.drainedN, pending: cnt.pendN, enclosed: cnt.enclosedN,
            unchanged: cnt.unchangedN, removed: cnt.removedN, refused: cnt.refusedN, fail: cnt.failN, full: cnt.fullN,
            lake: cnt.lakeN, lakeSkip: cnt.lakeSkipN, adopt: cnt.adoptN, writes: writes, capped: capped ? 1 : 0, pend: pend.size, risk: risk.size,
            dr: dr.size, uw: uw.size, lf: lf.size, g: finalG, done: done.length, news: OUT.news ? 1 : 0 });
        OUT.ok = true;
    }

    try {
        main();
    } catch (e) {
        OUT.ok = false;
        OUT.err = String((e && e.message) || e).slice(0, 300);
        OUT.errStage = STAGE;
        L('err', { stage: STAGE, x: CUR.x, y: CUR.y, msg: OUT.err });
    }
    return finish();
})(__LCPRW_PARAMS__);
