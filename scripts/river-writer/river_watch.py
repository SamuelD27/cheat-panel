#!/usr/bin/env python3
"""LCP river writer: a Mac-side watcher that writes the cheat panel's queued rivers into the running game.

Why it exists: the panel (UI context) can paint TERRAIN_NAVIGABLE_RIVER but cannot write river data. During play the
only script context with TerrainBuilder.setRiverInfo is the engine's Tuner context (FireTuner CMD ctx 1), which is
reachable from outside the game on 127.0.0.1:4318 when AppOptions.txt has `EnableTuner 1`.

What it does, every --interval seconds (default 2):
  1. One cheap call to the UI view (ctx 65535): refresh a non-persistent heartbeat global
     (globalThis.__lcpRiverWriter) and its status companion (globalThis.__lcpRiverWriterSt: ok / refusing / failing,
     and how long the heartbeat counts as fresh), and read the panel's queue LCP_RWQ plus a few map facts.
     No config write.
  2. When the queue has entries, or once per fresh Tuner context (every game load recreates it), run a cycle:
     UI preflight (ctx 65535) -> river-writer-payload.js (ctx 1, plans and writes, reads every write back)
     -> one UI write-back call (LCP_RW_LAST, LCP_RW_STATE, consumed queue entries, engine.trigger).
  3. When the port is closed or the UI is not an in-game view, idle quietly (2 s -> 10 s backoff) and print one
     line per state change.
Rivers written this way show on the 3D map only after a save & load (verified live, 2026-11-03).

Usage (python3 stdlib only; run isolated):
  python3 -I river_watch.py                  watch and apply (Ctrl+C stops)
  python3 -I river_watch.py --dry-run        watch, never write; print what would be written
  python3 -I river_watch.py --once           one full pass now, then exit
  python3 -I river_watch.py --once --dry-run one full pass, report the plan, write nothing
Options: --interval S, --no-lake-source, --max-writes N, --verbose; see --help.
Files: the JSONL transcript ~/Library/Logs/lcp-river-writer.log (rotates to .1 above 5 MB, checked at start and every
200 writes) and the single-instance lock ~/Library/Logs/lcp-river-writer.pid; the folder is created when missing.

Exit codes (mostly for --once): 0 ok, 1 unexpected error, 2 tuner port closed, 3 no reply / not answering,
4 refused (multiplayer, missing API, not in a game), 5 truncated reply, 6 another watcher is running,
7 the UI write-back failed.
"""
import argparse
import json
import os
import signal
import socket
import struct
import subprocess
import sys
import time
import traceback
import uuid

VERSION = 1
MARK = 'LCPRW1'
MARK_END = 'LCPRW1END'
PLACEHOLDER = '__LCPRW_PARAMS__'
PAYLOAD_NAME = 'river-writer-payload.js'
# --with-game (the LaunchAgent's mode): the game's process, matched with pgrep -f
GAME_PROCESS = 'CivilizationVII.app/Contents/MacOS/CivilizationVII'
HERE = os.path.dirname(os.path.abspath(__file__))
# review RWW-LOG-1: never the game's own Logs folder (the game empties it at launch); the lock lives there too, so it
# does not depend on where the script is deployed. Both parent folders are created when missing.
DEFAULT_LOG_DIR = os.path.expanduser('~/Library/Logs')
DEFAULT_LOG = os.path.join(DEFAULT_LOG_DIR, 'lcp-river-writer.log')
DEFAULT_PID = os.path.join(DEFAULT_LOG_DIR, 'lcp-river-writer.pid')
MAX_REQUEST = 60000          # bytes per tuner request (keep well below the unknown CMD limit)
MAX_REPLY_MSG = 32 * 1024 * 1024
CHUNK = 4000                 # characters per recovery chunk
CTX_CHECK_EVERY = 15         # polls; a cheap ctx-1 freshness check as a safety net (30 s at 2 s)
HB_FRESH_MS = 10000          # the panel counts a heartbeat as "running" for this long after a poll ...
HB_CYCLE_MS = 45000          # ... and for this long after a run starts (a run may take a while; refreshed at its end)
LOG_ROTATE_BYTES = 5 * 1024 * 1024   # the transcript moves to <log>.1 (one backup, replaced each time) above this size
LOG_ROTATE_CHECK_EVERY = 200         # writes between size checks during a session (and once at start)
DIR_NAMES = ['NE', 'E', 'SE', 'SW', 'W', 'NW']

EXIT_OK, EXIT_ERROR, EXIT_CONNECT, EXIT_NOREPLY, EXIT_REFUSED, EXIT_TRUNCATED, EXIT_LOCKED, EXIT_WRITEBACK = range(8)


# ---------------------------------------------------------------------------------------------------------------------
# JS helpers
# ---------------------------------------------------------------------------------------------------------------------
def strip_js(src):
    """Remove /* */ and // comments and fold whitespace runs (newlines included) into one space.

    String literals ('...' and "...") are copied verbatim. The payload uses no template or regex literals and ends
    every statement with a semicolon, so folding newlines cannot change its meaning (checked by the tests, which run
    the stripped and the raw payload and compare the results)."""
    out = []
    i, n = 0, len(src)
    quote = None
    space = False
    while i < n:
        c = src[i]
        if quote:
            out.append(c)
            if c == '\\' and i + 1 < n:
                out.append(src[i + 1])
                i += 2
                continue
            if c == quote:
                quote = None
            elif c in '\r\n':
                raise ValueError('newline inside a string literal at offset %d' % i)
            i += 1
            continue
        if c == '`':
            raise ValueError('template literals are not allowed in the payload (offset %d)' % i)
        if c == '/' and i + 1 < n and src[i + 1] == '*':
            j = src.find('*/', i + 2)
            if j < 0:
                raise ValueError('unterminated comment at offset %d' % i)
            i = j + 2
            space = True
            continue
        if c == '/' and i + 1 < n and src[i + 1] == '/':
            j = src.find('\n', i + 2)
            i = n if j < 0 else j
            space = True
            continue
        if c.isspace():
            space = True
            i += 1
            continue
        if space and out:
            out.append(' ')
        space = False
        if c in ('"', "'"):
            quote = c
        out.append(c)
        i += 1
    return ''.join(out).strip()


def js_args(obj):
    return json.dumps(obj, separators=(',', ':'), ensure_ascii=True)


def inject(stripped, params):
    if stripped.count(PLACEHOLDER) != 1:
        raise ValueError('payload must contain the placeholder exactly once')
    k = stripped.rfind(PLACEHOLDER)
    return stripped[:k] + js_args(params) + stripped[k + len(PLACEHOLDER):]


_RET = "return 'LCPRW1'+JSON.stringify(R)+'LCPRW1END';"
_ERR = "catch(e){R.err=String((e&&e.message)||e).slice(0,200);}"

# Poll (ctx UI). Sets the heartbeat when A.hb is given; reads the queue and map facts. Never writes config.
POLL_JS = (
    "(function(A){var R={k:'poll',n:A.n};try{"
    "var G=(typeof globalThis!=='undefined')?globalThis:null;"
    "var pv=G?G.__lcpRiverWriter:undefined;"
    "R.prev=(pv&&typeof pv==='object')?{hb:pv.hb,pid:pv.pid,mode:pv.mode}:null;"
    "if(G&&A.hb){G.__lcpRiverWriter={v:1,hb:A.hb,seq:A.seq,pid:A.pid,mode:A.mode};"
    "G.__lcpRiverWriterSt={v:1,pid:A.pid,hb:A.hb,until:A.until,st:A.st,why:A.why,at:A.at};}"
    "var gm=(typeof GameplayMap==='object'&&GameplayMap)?GameplayMap:null;"
    "var C=(typeof Configuration==='object'&&Configuration)?Configuration:null;var eg=null;"
    "try{eg=(C&&typeof C.editGame==='function')?C.editGame():null;}catch(e){eg=null;}"
    "var tu=null;try{if(typeof Game==='object'&&Game&&typeof Game.turn==='number')tu=Game.turn;}catch(e){tu=null;}"
    "var W=0,H=0;try{if(gm){W=gm.getGridWidth();H=gm.getGridHeight();}}catch(e){W=0;H=0;}"
    "R.inGame=!!(gm&&eg&&typeof eg.getValue==='function'&&tu!==null&&W>0&&H>0);R.W=W;R.H=H;R.turn=tu;"
    "if(R.inGame){var q=null;try{q=eg.getValue('LCP_RWQ');}catch(e){q=null;}R.q=(typeof q==='string')?q:'';"
    "var mp=null;try{var gg=C.getGame();if(gg&&typeof gg.isAnyMultiplayer==='boolean')mp=gg.isAnyMultiplayer;}catch(e){}"
    "R.mp=mp;try{R.seed=String(C.getGame().gameSeed)+'/'+String(C.getMap().mapSeed);}catch(e){R.seed=null;}"
    "var ls=null;try{var lv=eg.getValue('LCP_RW_LAST');if(typeof lv==='string'&&lv){var lo=JSON.parse(lv);"
    "if(lo&&typeof lo.seq==='number')ls=lo.seq;}}catch(e){ls=null;}R.lastSeq=ls;}"
    "}" + _ERR + _RET + "})(@A@)"
)

# Heartbeat refresh at the start / end of a run (watch mode only; --once sets no heartbeat). Mutates the objects the
# poll created (same shape), so the panel keeps seeing "running" while a run takes longer than a poll interval.
_HB_REFRESH = (
    "if(A.hb){var HG=(typeof globalThis!=='undefined')?globalThis:null;"
    "var HH=HG?HG.__lcpRiverWriter:null;if(HH&&typeof HH==='object'&&HH.pid===A.pid){HH.hb=A.hb;if(A.hseq!=null)HH.seq=A.hseq;}"
    "var HS=HG?HG.__lcpRiverWriterSt:null;if(HS&&typeof HS==='object'&&HS.pid===A.pid){HS.hb=A.hb;HS.until=A.until;"
    "if(A.st){HS.st=A.st;HS.why=A.why;HS.at=A.at;}}}"
)

# UI preflight (ctx UI): nav terrain index, multiplayer flag, the three config keys, engine.trigger.
UI_PRE_JS = (
    "(function(A){var R={k:'ui',n:A.n};try{" + _HB_REFRESH +
    "var C=(typeof Configuration==='object'&&Configuration)?Configuration:null;var eg=null;"
    "try{eg=(C&&typeof C.editGame==='function')?C.editGame():null;}catch(e){eg=null;}"
    "R.eg=!!(eg&&typeof eg.getValue==='function'&&typeof eg.setValue==='function');"
    "var mp=null;try{var gg=C.getGame();if(gg&&typeof gg.isAnyMultiplayer==='boolean')mp=gg.isAnyMultiplayer;}catch(e){}"
    "R.mp=mp;var nav=null;try{var t=GameInfo.Terrains.lookup('TERRAIN_NAVIGABLE_RIVER');"
    "if(t&&typeof t.$index==='number')nav=t.$index;}catch(e){nav=null;}R.nav=nav;"
    "function gv(k){try{var v=eg.getValue(k);return(typeof v==='string')?v:'';}catch(e){return '';}}"
    "if(R.eg){R.q=gv('LCP_RWQ');R.st=gv('LCP_RW_STATE');R.last=gv('LCP_RW_LAST');}"
    "R.trig=(typeof engine==='object'&&engine)?typeof engine.trigger:'undefined';"
    "try{R.turn=(typeof Game==='object'&&Game)?Game.turn:null;}catch(e){R.turn=null;}"
    "try{R.seed=String(C.getGame().gameSeed)+'/'+String(C.getMap().mapSeed);}catch(e){R.seed=null;}"
    "}" + _ERR + _RET + "})(@A@)"
)

# Tuner-context freshness check (ctx game). The Tuner context is recreated on every load, so an unset token means
# a new context; a token from another watcher instance means this watcher has not done its pass there yet.
CTX_JS = (
    "(function(A){var R={k:'ctx',n:A.n};try{var G=globalThis;var cur=G.__lcpRWctx;"
    "R.fresh=(typeof cur==='undefined');R.other=(!R.fresh&&cur!==A.tok);"
    "R.prev=R.fresh?null:String(cur).slice(0,60);if(cur!==A.tok)G.__lcpRWctx=A.tok;"
    "R.sri=!!(typeof TerrainBuilder==='object'&&TerrainBuilder&&typeof TerrainBuilder.setRiverInfo==='function');"
    "R.gm=(typeof GameplayMap==='object'&&GameplayMap)?1:0;"
    "try{R.W=GameplayMap.getGridWidth();R.H=GameplayMap.getGridHeight();}catch(e){R.W=0;R.H=0;}"
    "}" + _ERR + _RET + "})(@A@)"
)

# Recovery (ctx game): read this run's result (kept per nonce) in pieces when its reply was cut short or lost. A dry
# run started beside the watcher keeps its own copy, so it cannot replace this one.
CHUNK_JS = (
    "(function(A){var R={k:'chunk',n:A.n};try{var m=globalThis.__lcpRWouts;"
    "var s=(m&&typeof m==='object')?m['n:'+A.nonce]:undefined;if(typeof s!=='string'){s=globalThis.__lcpRWout;R.fallback=1;}"
    "if(typeof s!=='string'){R.none=1;}else{R.len=s.length;R.part=s.slice(A.a,A.a+A.sz);}"
    "}" + _ERR + _RET + "})(@A@)"
)

# Clean stop (ctx UI, watch mode): tell the panel at once that this watcher is gone (best effort, short timeout).
STOP_JS = (
    "(function(A){var R={k:'stop',n:A.n};try{var s=globalThis.__lcpRiverWriterSt;"
    "if(s&&typeof s==='object'&&s.pid===A.pid){s.st='stopped';s.why='';s.until=0;s.at=A.at;R.ok=1;}"
    "}" + _ERR + _RET + "})(@A@)"
)

# UI write-back (ctx UI), one call: LCP_RW_LAST (merged with the tiles still unseen by the UI replica),
# LCP_RW_STATE, the consumed queue entries (string match on a fresh read, so paints made meanwhile survive),
# engine.trigger('lcp-river-writer'), then read everything back.
WRITEBACK_JS = (
    "(function(A){var R={k:'wb',n:A.n};try{" + _HB_REFRESH +
    "var C=(typeof Configuration==='object'&&Configuration)?Configuration:null;"
    "var mp=null;try{var gg=C.getGame();if(gg&&typeof gg.isAnyMultiplayer==='boolean')mp=gg.isAnyMultiplayer;}catch(e){}"
    "if(mp===true){R.aborted='multiplayer';" + _RET + "}"
    "var eg=null;try{eg=(C&&typeof C.editGame==='function')?C.editGame():null;}catch(e){eg=null;}"
    "if(!eg||typeof eg.setValue!=='function'||typeof eg.getValue!=='function'){R.aborted='no-editGame';" + _RET + "}"
    "function gv(k){try{var v=eg.getValue(k);return(typeof v==='string')?v:'';}catch(e){return '';}}"
    "function rt(i){try{var l=GameplayMap.getLocationFromIndex(i);return GameplayMap.getRiverType(l.x,l.y);}catch(e){return null;}}"
    "function merge(prev,now,keep,cap){var all=[],k,i,out=[],seen=Object.create(null);"
    "if(prev&&prev.length){for(k=0;k<prev.length;k++){i=prev[k];if(typeof i==='number'&&keep(i))all.push(i);}}"
    "for(k=0;k<now.length;k++)all.push(now[k]);"
    "for(k=all.length-1;k>=0;k--){i=all[k];if(!seen[i]){seen[i]=1;out.unshift(i);}}"
    "if(out.length>cap)out=out.slice(out.length-cap);return out;}"
    "function fit(L){var s=JSON.stringify(L),g=0;while(s.length>3000&&g<2000){g++;"
    "if(L.refused.length>5)L.refused.pop();else if(L.fail.length>5)L.fail.pop();"
    "else if(L.removed.length>20)L.removed.shift();else if(L.wrote.length>20)L.wrote.shift();"
    "else if(L.lake.length)L.lake.pop();else if(L.refused.length)L.refused.pop();else if(L.fail.length)L.fail.pop();"
    "else if(L.removed.length)L.removed.shift();else if(L.wrote.length)L.wrote.shift();else break;"
    "L.trunc=1;s=JSON.stringify(L);}return s;}"
    "if(A.last){var L=A.last,pv=null;try{var ps=gv('LCP_RW_LAST');pv=ps?JSON.parse(ps):null;}catch(e){pv=null;}"
    "if(!(pv&&pv.v===1))pv=null;"
    "var wN=A.wroteNow||[],rN=A.removedNow||[],wS=Object.create(null),rS=Object.create(null),z;"
    "for(z=0;z<wN.length;z++)wS[wN[z]]=1;for(z=0;z<rN.length;z++)rS[rN[z]]=1;"
    # review RW-5: the latest action on a tile wins; a tile removed now leaves wrote[], one written now leaves removed[]
    "L.wrote=merge(pv?pv.wrote:null,wN,function(i){var r=rt(i);return r!==1&&!rS[i];},200);"
    "L.removed=merge(pv?pv.removed:null,rN,function(i){var r=rt(i);return r!==-1&&!wS[i];},100);"
    "try{L.turn=(typeof Game==='object'&&Game&&typeof Game.turn==='number')?Game.turn:null;}catch(e){L.turn=null;}"
    "var s=fit(L);eg.setValue('LCP_RW_LAST',s);R.setLast=s.length;R.lastOk=(gv('LCP_RW_LAST')===s);"
    "R.wroteKept=L.wrote.length;}"
    "if(typeof A.state==='string'){eg.setValue('LCP_RW_STATE',A.state);R.stateOk=(gv('LCP_RW_STATE')===A.state);}"
    "if(A.done&&A.done.length){var d=Object.create(null),k2;for(k2=0;k2<A.done.length;k2++)d[A.done[k2]]=1;"
    "var q=gv('LCP_RWQ');R.qBefore=q.length;if(q){var p=q.split('|');if(p[0]==='v1'){var keep=[];"
    "for(k2=1;k2<p.length;k2++){if(p[k2]&&!d[p[k2]])keep.push(p[k2]);}"
    "if(keep.length){eg.setValue('LCP_RWQ','v1|'+keep.join('|'));}"
    "else{if(typeof eg.clearValue==='function')eg.clearValue('LCP_RWQ');else eg.setValue('LCP_RWQ','');}"
    "R.qKept=keep.length;}else{R.qSkip='version';}}"
    "var q2=gv('LCP_RWQ'),bad=0;if(q2){var p2=q2.split('|');for(k2=1;k2<p2.length;k2++)if(d[p2[k2]])bad++;}"
    "R.queueOk=(bad===0);}"
    "if(A.last){try{if(typeof engine==='object'&&engine&&typeof engine.trigger==='function'){"
    "engine.trigger('lcp-river-writer',{seq:A.seq});R.trig=1;}else{R.trig=0;}}"
    "catch(e){R.trigErr=String((e&&e.message)||e).slice(0,120);}}"
    "R.back={q:gv('LCP_RWQ'),last:gv('LCP_RW_LAST'),st:gv('LCP_RW_STATE')};"
    "}" + _ERR + _RET + "})(@A@)"
)


def build_js(template, args):
    return template.replace('@A@', js_args(args))


def queue_has_entries(q):
    if not isinstance(q, str):
        return False
    s = q.strip()
    if not s:
        return False
    parts = [p for p in s.split('|') if p]
    if not parts:
        return False
    if parts[0] == 'v1':
        return len(parts) > 1
    return True     # unknown version: the payload reports it; treated as non-empty so the user hears about it


def queue_after(q_used, done):
    """The queue as a write-back that consumed `done` leaves it, if the panel added nothing meanwhile. A poll that sees a
    different value (an entry added mid-run, or the same tile painted again) runs at once."""
    if not isinstance(q_used, str) or not q_used:
        return ''
    parts = q_used.split('|')
    if parts[0] != 'v1':
        return q_used
    d = set(done or [])
    keep = [p for p in parts[1:] if p and p not in d]
    return ('v1|' + '|'.join(keep)) if keep else ''


# ---------------------------------------------------------------------------------------------------------------------
# Tuner transport: [len LE][type=3 LE]['CMD:<ctx>:<js>\0'] -> [len LE][type LE][result\0] (Civ7/tools/tuner_probe.py)
# ---------------------------------------------------------------------------------------------------------------------
class Reply:
    def __init__(self):
        self.ok = False
        self.data = None
        self.err = None          # connect | timeout | closed | truncated | no-marker | io | protocol | too-large
        self.detail = ''
        self.req_bytes = 0
        self.reply_bytes = 0
        self.ms = 0
        self.preview = ''

    def summary(self, kind, ctx):
        return {'kind': kind, 'ctx': ctx, 'req': self.req_bytes, 'reply': self.reply_bytes, 'ms': self.ms,
                'ok': self.ok, 'err': self.err, 'detail': self.detail[:200] if self.detail else None,
                'preview': self.preview[:300] if (self.preview and not self.ok) else None}


def _readn(sock, n):
    buf = bytearray()
    while len(buf) < n:
        chunk = sock.recv(min(65536, n - len(buf)))
        if not chunk:
            raise EOFError('socket closed by the game')
        buf += chunk
    return bytes(buf)


def _parse_inner(inner):
    try:
        return json.loads(inner)
    except ValueError:
        pass
    try:   # the reply may come back JSON-quoted (escaped inner quotes)
        return json.loads(json.loads('"' + inner + '"'))
    except (ValueError, TypeError):
        return None


def extract_marked(buf, nonce):
    """Find 'LCPRW1{...}LCPRW1END' whose JSON carries this nonce. Returns (obj|None, status) with status in
    ok | none | truncated | stale."""
    pos = 0
    status = 'none'
    while True:
        s = buf.find(MARK + '{', pos)
        if s < 0:
            return None, status
        e = s + len(MARK)
        obj = None
        while True:
            e = buf.find(MARK_END, e)
            if e < 0:
                return None, 'truncated'
            obj = _parse_inner(buf[s + len(MARK):e])
            if obj is not None:
                break
            e += 1      # the end marker text inside a string value: try the next one
        if isinstance(obj, dict) and obj.get('n') == nonce:
            return obj, 'ok'
        status = 'stale'
        pos = e + len(MARK_END)


def tuner_call(host, port, ctx, js, nonce, timeout, connect_timeout=2.0):
    rep = Reply()
    body = ('CMD:%s:%s\0' % (ctx, js)).encode('utf-8')
    rep.req_bytes = len(body) + 8
    t0 = time.monotonic()
    if len(body) > MAX_REQUEST:
        rep.err = 'too-large'
        rep.detail = '%d bytes > %d' % (len(body), MAX_REQUEST)
        return rep
    try:
        sock = socket.create_connection((host, port), timeout=connect_timeout)
    except ConnectionRefusedError:
        rep.err, rep.detail = 'connect', 'refused'
        rep.ms = int((time.monotonic() - t0) * 1000)
        return rep
    except (socket.timeout, TimeoutError):
        rep.err, rep.detail = 'connect', 'timeout'
        rep.ms = int((time.monotonic() - t0) * 1000)
        return rep
    except OSError as e:
        rep.err, rep.detail = 'connect', str(e)
        rep.ms = int((time.monotonic() - t0) * 1000)
        return rep
    parts = []
    status = 'none'
    try:
        deadline = t0 + timeout
        sock.settimeout(max(0.05, deadline - time.monotonic()))
        sock.sendall(struct.pack('<II', len(body), 3) + body)
        while True:
            rem = deadline - time.monotonic()
            if rem <= 0:
                raise TimeoutError()
            sock.settimeout(rem)
            hdr = _readn(sock, 8)
            length, _mtype = struct.unpack('<II', hdr)
            if length > MAX_REPLY_MSG:
                rep.err, rep.detail = 'protocol', 'reply length %d' % length
                break
            sock.settimeout(max(0.05, deadline - time.monotonic()))
            data = _readn(sock, length)
            rep.reply_bytes += 8 + length
            parts.append(data.rstrip(b'\0').decode('utf-8', errors='replace'))
            obj, status = extract_marked(''.join(parts), nonce)
            if obj is not None:
                rep.ok, rep.data = True, obj
                break
    except (socket.timeout, TimeoutError):
        rep.err = rep.err or 'timeout'
    except EOFError:
        rep.err = rep.err or 'closed'
    except OSError as e:
        rep.err, rep.detail = rep.err or 'io', str(e)
    finally:
        try:
            sock.close()
        except OSError:
            pass
    rep.ms = int((time.monotonic() - t0) * 1000)
    if not rep.ok:
        buf = ''.join(parts)
        rep.preview = buf[:300]
        if status == 'truncated':
            rep.err = 'truncated'
            rep.detail = 'start marker without end marker after %d bytes' % rep.reply_bytes
        elif buf and rep.err in ('timeout', 'closed', None):
            rep.err = 'no-marker'
            rep.detail = rep.detail or 'reply without the LCPRW1 markers (script error?)'
        elif rep.err is None:
            rep.err = 'timeout'
    return rep


# ---------------------------------------------------------------------------------------------------------------------
# Transcript (JSONL), lock, signals
# ---------------------------------------------------------------------------------------------------------------------
class Transcript:
    def __init__(self, path):
        self.path = path
        self.broken = False
        self.writes = 0
        self.rotations = 0
        try:
            self._ensure_dir()
            self._rotate_if_big()
        except OSError as e:
            self._fail(e)

    def _ensure_dir(self):
        d = os.path.dirname(self.path)
        if d:
            os.makedirs(d, exist_ok=True)

    def _rotate_if_big(self):
        """Move the transcript to <path>.1 (replacing an older .1) once it is above LOG_ROTATE_BYTES."""
        if os.path.exists(self.path) and os.path.getsize(self.path) > LOG_ROTATE_BYTES:
            os.replace(self.path, self.path + '.1')
            self.rotations += 1

    def _fail(self, e):
        if not self.broken:
            self.broken = True
            sys.stderr.write('LCP river writer: cannot write the log %s (%s); continuing without it\n' % (self.path, e))

    def write(self, ev, **fields):
        if self.broken:
            return
        self.writes += 1
        if self.writes % LOG_ROTATE_CHECK_EVERY == 0:
            # review RWW-LOG-1: rotate during a session too, not only at start
            try:
                self._ensure_dir()
                self._rotate_if_big()
            except OSError:
                pass        # a failed rotation is not worth losing the log over; the append below still runs
        now = time.time()
        rec = {'ts': time.strftime('%Y-%m-%dT%H:%M:%S', time.localtime(now)) + '.%03d' % int((now % 1) * 1000),
               'ev': ev, 'pid': os.getpid()}
        rec.update(fields)
        try:
            line = json.dumps(rec, ensure_ascii=False, default=str, separators=(',', ':'))
            try:
                f = open(self.path, 'a', encoding='utf-8')
            except FileNotFoundError:
                self._ensure_dir()      # the folder was removed under a running watcher: recreate it
                f = open(self.path, 'a', encoding='utf-8')
            with f:
                f.write(line + '\n')
        except (OSError, TypeError, ValueError) as e:
            self._fail(e)


def _pid_alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False


def _pid_is_watcher(pid):
    try:
        res = subprocess.run(['ps', '-p', str(pid), '-o', 'command='], capture_output=True, text=True, timeout=3)
    except (OSError, subprocess.SubprocessError):
        return True     # cannot tell: assume it is one (never run two writers)
    cmd = (res.stdout or '').strip()
    if not cmd:
        return False
    return 'river_watch' in cmd


class PidLock:
    def __init__(self, path):
        self.path = path
        self.held = False

    def _read(self):
        try:
            with open(self.path, 'r', encoding='utf-8') as f:
                txt = f.read().strip()
            return int(txt.split()[0]) if txt else None
        except (OSError, ValueError, IndexError):
            return None

    def acquire(self):
        """Returns (ok, message)."""
        try:
            os.makedirs(os.path.dirname(self.path), exist_ok=True)
        except OSError as e:
            return False, 'cannot create %s: %s' % (os.path.dirname(self.path), e)
        for _attempt in range(5):
            try:
                fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
                with os.fdopen(fd, 'w', encoding='utf-8') as f:
                    f.write('%d\n' % os.getpid())
                self.held = True
                return True, ''
            except FileExistsError:
                pass
            except OSError as e:
                return False, 'cannot create %s: %s' % (self.path, e)
            other = self._read()
            if other is None:
                try:
                    age = time.time() - os.path.getmtime(self.path)
                except OSError:
                    continue
                if age < 3:
                    time.sleep(0.3)
                    continue
                stale = 'unreadable'
            elif other == os.getpid():
                self.held = True
                return True, ''
            elif _pid_alive(other) and _pid_is_watcher(other):
                return False, 'another river watcher is running (pid %d). Stop it with Ctrl+C in its Terminal, ' \
                              'or run: kill %d' % (other, other)
            else:
                stale = 'pid %d is gone' % other
            try:
                os.unlink(self.path)
                sys.stdout.write('LCP river writer: removed a stale lock (%s)\n' % stale)
            except FileNotFoundError:
                pass
            except OSError as e:
                return False, 'cannot remove the stale lock %s: %s' % (self.path, e)
        return False, 'could not take the lock %s' % self.path

    def release(self):
        if self.held and self._read() == os.getpid():
            try:
                os.unlink(self.path)
            except OSError:
                pass
        self.held = False


class Stopper:
    def __init__(self):
        self.requested = False
        self.critical = False
        self.count = 0

    def handler(self, signum, _frame):
        self.count += 1
        self.requested = True
        if self.critical and self.count == 1:
            try:
                sys.stdout.write('\nLCP river writer: finishing the current write, then stopping '
                                 '(press Ctrl+C again to stop at once)\n')
                sys.stdout.flush()
            except (OSError, ValueError):
                pass        # SIGHUP: the Terminal is gone; finish the run anyway
            return
        raise KeyboardInterrupt()

    def install(self):
        for s in (signal.SIGINT, signal.SIGTERM, getattr(signal, 'SIGHUP', None)):
            if s is not None:
                try:
                    signal.signal(s, self.handler)
                except (ValueError, OSError):
                    pass


# ---------------------------------------------------------------------------------------------------------------------
# The watcher
# ---------------------------------------------------------------------------------------------------------------------
class CycleResult:
    def __init__(self, status, code, msg='', capped=False, wrote_last=False, q_used=None, q_after=None, writes=0,
                 q_expected=None):
        self.status = status      # ok | noop | refused | connect | no-reply | truncated | writeback | error
        self.code = code
        self.msg = msg
        self.capped = capped
        self.wrote_last = wrote_last
        self.q_used = q_used      # the queue string this run processed
        self.q_after = q_after    # the queue string the write-back read back
        self.writes = writes      # setRiverInfo calls the run made
        self.q_expected = q_expected  # the queue as this run left it if the panel added nothing (see queue_after)
        self.payload_sent = False     # the payload call went out (it may have written even if its reply was lost)


def _clock():
    return time.strftime('%H:%M:%S')


class Watcher:
    def __init__(self, args, stopper):
        self.a = args
        self.stopper = stopper
        self.pid = os.getpid()
        self.token = '%d:%d' % (self.pid, int(time.time() * 1000))
        self.mode = 'dry' if args.dry_run else 'watch'
        self.log = Transcript(args.log_file)
        self.state = None
        self.state_key = None
        self.idle_delay = args.interval
        self.last_seq = None
        self.owe_pass = False
        self.force_ctx_check = True
        self.prev_key = None
        self.prev_turn = None
        self.polls_in_game = 0
        self.last_cycle_q = None
        self.retry_at = 0.0
        self.retry_delay = 0.0
        self.warned_pids = set()
        self.refusal_shown = None
        # what the panel's status line says about this watcher (globalThis.__lcpRiverWriterSt): ok | refused | failing
        self.hst = {'st': 'ok', 'why': '', 'at': int(time.time() * 1000)}
        self._payload_mtime = None
        self._payload = None
        self.payload_path = os.path.join(HERE, PAYLOAD_NAME)
        # --with-game: when the game process was last seen missing, and when it was last checked
        self.game_gone_since = None
        self.game_checked_at = 0.0

    # -- output -------------------------------------------------------------------------------------------------------
    def say(self, msg):
        try:
            sys.stdout.write('[%s] %s\n' % (_clock(), msg))
            sys.stdout.flush()
        except (OSError, ValueError):
            pass        # the Terminal is gone (SIGHUP): keep going, the transcript still records everything

    def set_state(self, name, msg, key=None, **fields):
        k = (name, key)
        if k == self.state_key:
            return
        prev = self.state
        self.state, self.state_key = name, k
        self.say(msg)
        self.log.write('state', state=name, prev=prev, msg=msg, **fields)

    # -- payload ------------------------------------------------------------------------------------------------------
    def payload(self):
        st = os.stat(self.payload_path)
        if self._payload is None or st.st_mtime != self._payload_mtime:
            with open(self.payload_path, 'r', encoding='utf-8') as f:
                src = f.read()
            stripped = strip_js(src)
            if stripped.count(PLACEHOLDER) != 1:
                raise ValueError('%s: the parameter placeholder must occur exactly once' % self.payload_path)
            self._payload, self._payload_mtime = stripped, st.st_mtime
            self.log.write('payload', path=self.payload_path, raw=len(src), stripped=len(stripped))
        return self._payload

    # -- calls --------------------------------------------------------------------------------------------------------
    def nonce(self):
        return uuid.uuid4().hex[:12]

    def call(self, ctx, js, nonce, timeout):
        return tuner_call(self.a.host, self.a.port, ctx, js, nonce, timeout)

    def set_status(self, st, why=''):
        why = (why or '')[:140]
        if self.hst.get('st') != st or self.hst.get('why') != why:
            self.hst = {'st': st, 'why': why, 'at': int(time.time() * 1000)}

    def hb_fresh_ms(self):
        return int(max(HB_FRESH_MS, 3000 * self.a.interval + 2000))

    def hb_args(self, until_ms, with_status=False, hseq=None):
        """Heartbeat refresh arguments for a UI call in watch mode (None for --once: it sets no heartbeat)."""
        if self.a.once:
            return {}
        now = int(time.time() * 1000)
        args = {'hb': now, 'pid': self.pid, 'until': now + until_ms, 'hseq': hseq}
        if with_status:
            args.update({'st': self.hst['st'], 'why': self.hst['why'], 'at': self.hst['at']})
        return args

    def poll(self, set_hb):
        n = self.nonce()
        args = {'n': n}
        if set_hb:
            now = int(time.time() * 1000)
            args.update({'hb': now, 'seq': self.last_seq, 'pid': self.pid, 'mode': self.mode,
                         'until': now + self.hb_fresh_ms(), 'st': self.hst['st'], 'why': self.hst['why'],
                         'at': self.hst['at']})
        return self.call(self.a.ctx_ui, build_js(POLL_JS, args), n, self.a.poll_timeout)

    def mark_stopped(self):
        """Best effort on a clean stop in watch mode: the panel says 'not running' at once instead of after 10 s."""
        if self.a.once or self.state != 'in-game':
            return None
        try:
            n = self.nonce()
            r = self.call(self.a.ctx_ui, build_js(STOP_JS, {'n': n, 'pid': self.pid, 'at': int(time.time() * 1000)}), n, 1.0)
            return {'ok': bool(r.ok and (r.data or {}).get('ok')), 'ms': r.ms, 'err': r.err}
        except (KeyboardInterrupt, Exception):     # never let the goodbye fail the exit
            return {'ok': False, 'err': 'interrupted'}

    def ctx_check(self):
        n = self.nonce()
        return self.call(self.a.ctx_game, build_js(CTX_JS, {'n': n, 'tok': self.token}), n, self.a.poll_timeout)

    # -- --with-game: run only while Civ VII runs ----------------------------------------------------------------------
    def game_running(self):
        """True/False from pgrep -f (our own pid excluded), or None when pgrep itself fails (treated as running)."""
        try:
            res = subprocess.run(['/usr/bin/pgrep', '-f', self.a.game_process], capture_output=True, text=True, timeout=5)
        except (OSError, subprocess.SubprocessError) as e:
            self.log.write('game-check', ok=None, err=repr(e))
            return None
        if res.returncode not in (0, 1):
            self.log.write('game-check', ok=None, code=res.returncode, err=(res.stderr or '')[:200])
            return None
        pids = [int(t) for t in res.stdout.split() if t.isdigit() and int(t) != self.pid]
        return bool(pids)

    def wait_for_game(self):
        """--with-game start: the game is normally already running (its launch rewrote AppOptions.txt). Wait up to
        --game-wait seconds for it; False = it never showed up."""
        deadline = time.monotonic() + self.a.game_wait
        first = True
        while True:
            up = self.game_running()
            self.log.write('game-check', stage='start', ok=up)
            if up is not False:
                return True
            if first:
                self.say('waiting up to %gs for Civ VII to start' % self.a.game_wait)
                first = False
            if time.monotonic() >= deadline or self.stopper.requested:
                return False
            time.sleep(min(2.0, max(0.1, deadline - time.monotonic())))

    def game_gone(self):
        """--with-game loop: True once the game process has been missing for --game-gone-grace seconds. Checked only
        while the tuner port is closed or silent (a running game with EnableTuner 1 answers), at most every 5 s."""
        if self.state not in ('port-closed', 'no-reply'):
            self.game_gone_since = None
            return False
        now = time.monotonic()
        if now - self.game_checked_at < min(5.0, self.a.game_gone_grace / 2.0) and self.game_gone_since is None:
            return False
        self.game_checked_at = now
        up = self.game_running()
        if up is not False:
            self.game_gone_since = None
            return False
        if self.game_gone_since is None:
            self.game_gone_since = now
            self.log.write('game-check', stage='loop', ok=False, grace=self.a.game_gone_grace)
        return now - self.game_gone_since >= self.a.game_gone_grace

    # -- idle ---------------------------------------------------------------------------------------------------------
    def idle(self):
        d = self.idle_delay
        self.idle_delay = min(10.0, max(self.a.interval, self.idle_delay * 2))
        self.polls_in_game = 0
        self.force_ctx_check = True
        return d

    # -- one poll -----------------------------------------------------------------------------------------------------
    def tick(self):
        r = self.poll(set_hb=True)
        if not r.ok:
            if r.err == 'connect':
                self.set_state('port-closed', 'waiting for the game: tuner port %s:%d is closed '
                               '(start Civ VII with EnableTuner 1 in AppOptions.txt)' % (self.a.host, self.a.port))
            else:
                self.set_state('no-reply', 'the game is not answering on the tuner port (%s); will keep trying'
                               % r.err, detail=r.detail, preview=r.preview[:200])
            return self.idle()
        d = r.data
        if d.get('err'):
            self.set_state('ui-error', 'the UI view reported an error: %s' % d['err'])
            return self.idle()
        if not d.get('inGame'):
            self.set_state('not-in-game', 'game reachable, not in a match (main menu or loading); idle')
            return self.idle()
        if d.get('mp') is True:
            self.set_status('refused', 'this is a multiplayer game; the river writer only works in single-player')
            self.set_state('multiplayer', 'this is a multiplayer game: the river writer never writes there; idle')
            return self.idle()
        if isinstance(d.get('lastSeq'), int):
            self.last_seq = d['lastSeq']
        entering = self.state != 'in-game'
        self.set_state('in-game', 'in a single-player match (%sx%s, turn %s): watching the panel queue every %gs%s'
                       % (d.get('W'), d.get('H'), d.get('turn'), self.a.interval,
                          ' [DRY RUN: nothing is written]' if self.a.dry_run else ''),
                       W=d.get('W'), H=d.get('H'), turn=d.get('turn'))
        self.idle_delay = self.a.interval
        if not entering:    # right after a (re)start the global may still hold a dead watcher's last heartbeat
            self.note_other_watcher(d.get('prev'))

        why = []
        if entering or self.force_ctx_check:
            why.append('in-game')
        if d.get('prev') is None and not entering:
            why.append('ui-reloaded')
        key = (d.get('seed'), d.get('W'), d.get('H'))
        if self.prev_key is not None and key != self.prev_key:
            why.append('map-changed')
        turn = d.get('turn')
        if isinstance(self.prev_turn, int) and isinstance(turn, int) and turn < self.prev_turn:
            why.append('turn-back')
        self.polls_in_game += 1
        if self.polls_in_game % CTX_CHECK_EVERY == 0:
            why.append('periodic')
        self.prev_key, self.prev_turn = key, turn
        if why:
            self.check_context(why)

        q = d.get('q') or ''
        has_q = queue_has_entries(q)
        now = time.monotonic()
        reason = None
        if has_q and q != self.last_cycle_q:
            reason = 'queue'
        elif has_q and not self.a.dry_run and now >= self.retry_at:
            reason = 'queue-retry'
        elif self.owe_pass and now >= self.retry_at:
            reason = 'new-context'
        if reason:
            self.guarded_cycle(reason)
        return self.a.interval

    def note_other_watcher(self, prev):
        if not isinstance(prev, dict):
            return
        pid, hb = prev.get('pid'), prev.get('hb')
        if pid in (None, self.pid) or not isinstance(hb, (int, float)) or pid in self.warned_pids:
            return
        if time.time() * 1000 - hb < max(5000, 3000 * self.a.interval):
            self.warned_pids.add(pid)
            self.say('warning: another river watcher (pid %s) is also polling this game; run only one' % pid)
            self.log.write('warn', what='other-watcher', other=pid)

    def check_context(self, why):
        c = self.ctx_check()
        if not c.ok or c.data.get('err'):
            sig = (c.err, (c.data or {}).get('err') if c.ok else None)
            if not self.force_ctx_check or sig != getattr(self, '_ctx_fail_sig', None):
                self.log.write('ctx-check', ok=False, why=why, call=c.summary('ctx', self.a.ctx_game), err=sig[1])
            self._ctx_fail_sig = sig
            self.force_ctx_check = True
            return
        self.force_ctx_check = False
        self._ctx_fail_sig = None
        cd = c.data
        fresh = bool(cd.get('fresh') or cd.get('other'))
        if fresh:       # only a new context is worth a transcript line (the periodic check runs every 15 polls)
            self.log.write('ctx-check', ok=True, why=why, fresh=cd.get('fresh'), other=cd.get('other'),
                           prev=cd.get('prev'), sri=cd.get('sri'), W=cd.get('W'), H=cd.get('H'), ms=c.ms)
        if fresh:
            self.owe_pass = True
            self.retry_at = 0.0
            self.say('new game context (a load, or this watcher just started): one full pass over the map')

    def guarded_cycle(self, reason):
        self.stopper.critical = True
        try:
            res = self.run_cycle(reason)
        finally:
            self.stopper.critical = False
        now = time.monotonic()
        if res.status in ('ok', 'noop'):
            self.set_status('ok')
        elif res.status == 'refused':
            self.set_status('refused', res.msg)
        else:
            self.set_status('failing', res.msg)
        if res.status in ('ok', 'noop'):
            self.retry_delay = 0.0
            if res.capped and not self.a.dry_run and res.writes > 0:
                # more to write: the next poll runs again (a capped run always makes progress: --max-writes >= 1)
                self.owe_pass = True
                self.last_cycle_q = None
                self.retry_at = 0.0
            else:
                # Remember the queue as this run should have left it: the next poll runs again as soon as the queue
                # differs (an entry the panel added during the run, or the same tile painted again), and only
                # retries an unchanged leftover after 30 s.
                self.owe_pass = False
                self.last_cycle_q = res.q_expected if res.q_expected is not None else res.q_used
                self.retry_at = now + 30.0
        elif res.status == 'writeback':
            # River data may be written without LCP_RW_STATE / LCP_RW_LAST: retry soon. The next run takes the state
            # from the Tuner context's own copy and saves it (review RW-1), even when the queue is empty.
            self.retry_delay = min(10.0, max(self.a.interval, self.retry_delay * 2 if self.retry_delay else 0.0))
            self.retry_at = now + self.retry_delay
            self.last_cycle_q = res.q_used
            self.owe_pass = not self.a.dry_run
        else:
            self.retry_delay = min(300.0, max(10.0, self.retry_delay * 2))
            self.retry_at = now + self.retry_delay
            self.last_cycle_q = res.q_used
            # a run that failed after its payload may have written (late reply, throw): pass again to save its state
            self.owe_pass = (not self.a.dry_run) and (self.owe_pass or (res.status != 'refused' and res.payload_sent))
        if self.stopper.requested:
            raise KeyboardInterrupt()
        return res

    # -- the cycle ----------------------------------------------------------------------------------------------------
    def run_cycle(self, reason):
        a = self.a
        apply = not a.dry_run
        calls = []
        rec = {'reason': reason, 'mode': 'apply' if apply else 'dry', 'calls': calls}
        t0 = time.monotonic()
        sent = {'payload': False}

        def finish(res, **extra):
            res.payload_sent = sent['payload']
            rec.update(extra)
            rec['status'] = res.status
            rec['msg'] = res.msg
            rec['ms'] = int((time.monotonic() - t0) * 1000)
            self.log.write('cycle', **rec)
            return res

        def fail_call(r, what):
            if r.err == 'connect':
                return CycleResult('connect', EXIT_CONNECT, '%s: tuner port closed' % what)
            if r.err == 'truncated':
                return CycleResult('truncated', EXIT_TRUNCATED, '%s: reply was cut short (%s)' % (what, r.detail))
            if r.err == 'too-large':
                return CycleResult('error', EXIT_ERROR, '%s: request too large (%s)' % (what, r.detail))
            return CycleResult('no-reply', EXIT_NOREPLY, '%s: %s %s' % (what, r.err, r.detail or ''))

        # S1 UI preflight (also refreshes the heartbeat for the length of a run, in watch mode)
        n = self.nonce()
        pre_args = {'n': n}
        pre_args.update(self.hb_args(HB_CYCLE_MS))
        r = self.call(a.ctx_ui, build_js(UI_PRE_JS, pre_args), n, a.poll_timeout + 2)
        calls.append(r.summary('ui-pre', a.ctx_ui))
        if not r.ok:
            res = fail_call(r, 'UI preflight')
            self.say('cycle skipped: %s' % res.msg)
            return finish(res)
        ui = r.data
        if ui.get('err'):
            res = CycleResult('error', EXIT_ERROR, 'UI preflight error: %s' % ui['err'])
            self.say('cycle skipped: %s' % res.msg)
            return finish(res)
        q_used = ui.get('q') or ''
        if ui.get('mp') is True:
            return finish(self.refused('multiplayer game (UI)', q_used))
        if not ui.get('eg'):
            return finish(self.refused('Configuration.editGame() is not available in the UI view', q_used))
        st_raw = ui.get('st') or ''
        state, state_bad = None, False
        if st_raw:
            try:
                state = json.loads(st_raw)
            except ValueError:
                state, state_bad = None, True
        last_seq = 0
        last_key = None
        try:
            lo = json.loads(ui.get('last') or 'null')
            if isinstance(lo, dict):
                if isinstance(lo.get('seq'), int):
                    last_seq = lo['seq']
                if isinstance(lo.get('k'), str):
                    last_key = lo['k']
        except ValueError:
            pass
        seq = last_seq + 1
        nonce = self.nonce()
        params = {'mode': 'apply' if apply else 'dry', 'nonce': nonce, 'seq': seq, 'nav': ui.get('nav'),
                  'mpUI': ui.get('mp'), 'uiSeed': ui.get('seed'), 'q': q_used, 'state': state, 'stateBad': state_bad,
                  'lastKey': last_key, 'lakeSource': not a.no_lake_source, 'maxWrites': a.max_writes}
        rec['params'] = {k: v for k, v in params.items() if k != 'state'}
        rec['stateIn'] = st_raw[:4000]
        try:
            js = inject(self.payload(), params)
        except (OSError, ValueError) as e:
            res = CycleResult('error', EXIT_ERROR, 'cannot load %s: %s' % (self.payload_path, e), q_used=q_used)
            self.say(res.msg)
            return finish(res)
        if len(js.encode('utf-8')) + 16 > MAX_REQUEST:
            res = CycleResult('error', EXIT_ERROR, 'payload request is %d bytes, above the %d-byte limit; '
                              'not sent' % (len(js.encode('utf-8')), MAX_REQUEST), q_used=q_used)
            self.say(res.msg)
            return finish(res)

        # S3 payload in the Tuner context
        sent['payload'] = True
        r = self.call(a.ctx_game, js, nonce, a.payload_timeout)
        calls.append(r.summary('payload', a.ctx_game))
        out = r.data if r.ok else None
        if out is None and r.err in ('truncated', 'timeout', 'closed', 'no-marker'):
            out, why = self.recover(nonce, calls)
            if out is None:
                res = fail_call(r, 'payload')
                res.msg += '; recovery: %s' % why
                res.q_used = q_used
                self.say('cycle failed: %s (the next run recomputes from the map)' % res.msg)
                return finish(res)
            self.log.write('recovered', nonce=nonce, how='chunks')
        elif out is None:
            res = fail_call(r, 'payload')
            res.q_used = q_used
            self.say('cycle failed: %s' % res.msg)
            return finish(res)
        rec['out'] = out
        if out.get('refused'):
            return finish(self.refused(self.refusal_text(out['refused']), q_used, out))
        if not out.get('ok'):
            msg = 'the payload stopped with an error at stage %s: %s' % (out.get('errStage'), out.get('err'))
            self.say('cycle failed: ' + msg)
            wb = None
            # review RW-1: a run that wrote before it threw left a conservative state in the Tuner context; save it
            # (with the partial LCP_RW_LAST) so a save & load cannot lose it
            state_err = out.get('stateJson') if out.get('stateChanged') else None
            if apply and (out.get('wrote') or out.get('removed') or state_err is not None):
                news_err = bool(out.get('wrote') or out.get('removed'))
                wb = self.write_back(calls, seq, out if news_err else None, state_err, [], err=msg, status='failing')
                if wb is not None and wb.get('lastOk') and news_err:
                    self.last_seq = seq
            return finish(CycleResult('error', EXIT_ERROR, msg, q_used=q_used, writes=out.get('writes') or 0), wb=wb)

        self.refusal_shown = None
        c = out.get('c') or {}
        qv = (out.get('q') or {}).get('ver')
        if qv not in (None, '-', 'v1') and reason in ('queue', 'once'):
            self.say('the panel queue has an unknown format (%r); it was left untouched' % qv)
        if not apply:
            self.print_dry(out)
            return finish(CycleResult('ok', EXIT_OK, 'dry-run plan reported', capped=bool(out.get('capped')),
                                      q_used=q_used, q_expected=q_used, writes=0))

        # S4 UI write-back
        news = bool(out.get('news'))
        # A run that writes LCP_RW_LAST (with the map key k) also writes LCP_RW_STATE when there was none, so the next
        # run never mistakes "no state yet" for "state lost" (which switches to joining only traceable rivers).
        state_out = out.get('stateJson') if (out.get('stateChanged') or (news and not st_raw)) else None
        done = out.get('done') or []
        writes = out.get('writes') or 0
        if not news and state_out is None and not done:
            res = CycleResult('noop', EXIT_OK, 'nothing to write', q_used=q_used, q_expected=q_used)
            if reason in ('queue', 'once') or (reason == 'new-context' and c.get('cand')):
                self.say('pass done: nothing to write (%d candidate tile(s), %d pending unchanged, %d enclosed)'
                         % (c.get('cand', 0), c.get('unchangedN', 0), c.get('enclosedN', 0)))
            return finish(res)
        wb = self.write_back(calls, seq, out if news else None, state_out, done, status='ok')
        if wb is None or wb.get('err') or wb.get('aborted'):
            why = 'no reply' if wb is None else (wb.get('aborted') or wb.get('err'))
            msg = ('the river data was written, but the UI write-back failed (%s); the panel will not show this '
                   'run until the next one succeeds' % why) if (writes or news) else ('the UI write-back failed (%s)' % why)
            self.say('warning: ' + msg)
            return finish(CycleResult('writeback', EXIT_WRITEBACK, msg, q_used=q_used, writes=writes), wb=wb)
        problems = []
        if news and not wb.get('lastOk'):
            problems.append('LCP_RW_LAST read-back differs')
        if state_out is not None and not wb.get('stateOk'):
            problems.append('LCP_RW_STATE read-back differs')
        if done and wb.get('queueOk') is False:
            problems.append('queue entries still present')
        if news:
            self.last_seq = seq
        self.print_applied(out, seq if news else None, problems)
        status = 'ok' if not problems else 'writeback'
        q_after = (wb.get('back') or {}).get('q')
        return finish(CycleResult(status, EXIT_OK if not problems else EXIT_WRITEBACK, '; '.join(problems) or 'ok',
                                  capped=bool(out.get('capped')), wrote_last=news, q_used=q_used,
                                  q_after=q_after if isinstance(q_after, str) else None, writes=writes,
                                  q_expected=queue_after(q_used, done)), wb=wb)

    def write_back(self, calls, seq, out, state_out, done, err=None, status='ok'):
        a = self.a
        args = {'n': None, 'seq': seq, 'done': done, 'state': state_out}
        if out is not None:
            c = out.get('c') or {}
            last = {'v': 1, 'seq': seq, 'turn': None, 'at': int(time.time() * 1000), 'k': out.get('key'),
                    'wroteN': c.get('wroteN', len(out.get('wrote') or [])), 'wrote': [],
                    'removedN': c.get('removedN', len(out.get('removed') or [])), 'removed': [],
                    'pendN': c.get('pendN', 0), 'enclosedN': c.get('enclosedN', 0),
                    'drainedN': c.get('drainedN', 0),
                    'failN': c.get('failN', len(out.get('fail') or [])), 'fail': (out.get('fail') or [])[:20],
                    'refused': (out.get('rmRefused') or [])[:20], 'lake': (out.get('lake') or [])[:20],
                    'lakeSkipN': c.get('lakeSkipN', len(out.get('lakeSkip') or [])),
                    'capped': 1 if out.get('capped') else 0, 'x': 1 if out.get('distrust') else 0}
            if err:
                last['err'] = err[:200]
            args['last'] = last
            args['wroteNow'] = out.get('wrote') or []
            args['removedNow'] = out.get('removed') or []
        # end of the run: heartbeat fresh again for a poll interval, and the run's outcome for the panel's status line
        hst = {'st': status, 'why': (err or '')[:140], 'at': int(time.time() * 1000)}
        for attempt in (1, 2):
            n = self.nonce()
            args['n'] = n
            hb = self.hb_args(self.hb_fresh_ms(), hseq=(seq if out is not None else None))
            if hb:
                hb.update(hst)
            args.update(hb)
            r = self.call(a.ctx_ui, build_js(WRITEBACK_JS, args), n, a.poll_timeout + 4)
            calls.append(r.summary('write-back', a.ctx_ui))
            if r.ok:
                return r.data
            if r.err == 'connect':
                return None
            # the call may have run without its reply arriving: every part of it is safe to repeat
        return None

    def recover(self, nonce, calls):
        parts, a_off, total = [], 0, None
        for _ in range(200):
            n = self.nonce()
            r = self.call(self.a.ctx_game, build_js(CHUNK_JS, {'n': n, 'nonce': nonce, 'a': a_off, 'sz': CHUNK}), n, 5.0)
            calls.append(r.summary('chunk', self.a.ctx_game))
            if not r.ok:
                return None, 'chunk call failed (%s)' % r.err
            d = r.data
            if d.get('none'):
                return None, 'no copy in the tuner context'
            if d.get('err'):
                return None, 'chunk error: %s' % d['err']
            total = d.get('len')
            part = d.get('part') or ''
            parts.append(part)
            a_off += len(part)
            if not part or not isinstance(total, int) or a_off >= total:
                break
        try:
            out = json.loads(''.join(parts))
        except ValueError:
            return None, 'reassembled copy is not JSON'
        if not isinstance(out, dict) or out.get('n') != nonce:
            return None, 'the copy belongs to another run (the payload did not run)'
        return out, None

    # -- messages -----------------------------------------------------------------------------------------------------
    @staticmethod
    def refusal_text(code):
        texts = {
            'multiplayer': 'this is a multiplayer game; the river writer only works in single-player',
            'multiplayer-unreadable': 'cannot tell whether this is a multiplayer game; refusing to write',
            'no-setRiverInfo': 'the tuner context has no TerrainBuilder.setRiverInfo',
            'no-map': 'the tuner context has no map yet',
            'no-nav-index': 'cannot find the TERRAIN_NAVIGABLE_RIVER terrain index',
            'nav-mismatch': 'the UI and the tuner context disagree on the navigable-river terrain index',
            'DirectionTypes-unexpected': 'DirectionTypes has unexpected values',
            'RiverTypes-unexpected': 'RiverTypes has unexpected values',
        }
        if isinstance(code, str) and code.startswith('missing:'):
            return 'GameplayMap is missing functions: %s' % code[8:].replace('+', ', ')
        return texts.get(code, str(code))

    def refused(self, text, q_used, out=None):
        if self.refusal_shown != text:
            self.refusal_shown = text
            self.say('refused: %s (nothing written)' % text)
        return CycleResult('refused', EXIT_REFUSED, text, q_used=q_used)

    @staticmethod
    def _tile_lines(out, limit=60):
        lines = []
        for t in (out.get('tiles') or [])[:limit]:
            try:
                xy, d, cls = t.split(':')
                lines.append('    %-8s -> %-2s (%s)' % (xy, DIR_NAMES[int(d)], cls))
            except (ValueError, IndexError):
                lines.append('    ' + t)
        return lines

    def _common_counts(self, c, out):
        bits = []
        if c.get('enclosedN'):
            bits.append('%d enclosed (no outlet at all: left as painted terrain)' % c['enclosedN'])
        if c.get('unchangedN'):
            bits.append('%d pending unchanged' % c['unchangedN'])
        if c.get('refusedN'):
            bits.append('%d removal(s) refused: %s' % (c['refusedN'], ', '.join(
                '%s/%s %s' % (x, y, w) for x, y, w in (out.get('rmRefused') or [])[:5])))
        full = [f for f in (out.get('fail') or []) if isinstance(f, list) and len(f) == 2 and str(f[1]).startswith('state-full')]
        if c.get('fullN'):
            bits.append('%d painted tile(s) NOT written: the list of unfinished (pending) rivers is full (%s); paint '
                        'some pending rivers on to the water first' % (c['fullN'], ', '.join('%s %s' % (i, w) for i, w in full[:3])))
        other = [f for f in (out.get('fail') or []) if f not in full]
        if c.get('failN', 0) - len(full) > 0:
            bits.append('%d FAILED: %s' % (c['failN'] - len(full), ', '.join('%s %s' % (i, w) for i, w in other[:5])))
        if c.get('lakeSkipN'):
            skips = [s for s in (out.get('lakeSkip') or []) if isinstance(s, list) and len(s) == 2]
            bits.append('%d lake link(s) not written (the river could flow back into that lake, or its end can\'t be '
                        'traced): %s' % (c['lakeSkipN'], ', '.join('lake %s %s' % (i, w) for i, w in skips[:5])))
        if out.get('capped'):
            bits.append('stopped at --max-writes %d (the rest follows on the next poll)' % self.a.max_writes)
        return bits

    def print_dry(self, out):
        c = out.get('c') or {}
        self.say('DRY RUN (nothing written): would write %d river tile(s) (%d to a mouth, %d pending: no outlet yet), '
                 'remove river data on %d, add %d lake link(s); %d candidate tile(s)'
                 % (c.get('wroteN', 0), c.get('drainedN', 0), c.get('pendN', 0), c.get('removedN', 0),
                    c.get('lakeN', 0), c.get('cand', 0)))
        for b in self._common_counts(c, out):
            self.say('  ' + b)
        for line in self._tile_lines(out):
            sys.stdout.write(line + '\n')
        if self.a.verbose:
            for line in out.get('log') or []:
                sys.stdout.write('    ' + line + '\n')
        sys.stdout.flush()

    def print_applied(self, out, seq, problems):
        c = out.get('c') or {}
        head = ('#%d ' % seq) if seq is not None else ''
        if c.get('wroteN') or c.get('removedN') or c.get('lakeN'):
            self.say('%swrote %d river tile(s) (%d to a mouth, %d pending: no outlet yet), removed river data on %d, '
                     'added %d lake link(s)' % (head, c.get('wroteN', 0), c.get('drainedN', 0), c.get('pendN', 0),
                                               c.get('removedN', 0), c.get('lakeN', 0)))
            for line in self._tile_lines(out, 12 if not self.a.verbose else 60):
                sys.stdout.write(line + '\n')
            self.say('Save & load the game to see the rivers. The panel can\'t show them before that.')
        elif seq is not None:
            self.say('%snothing written' % head)
        for b in self._common_counts(c, out):
            self.say('  ' + b)
        for p in problems:
            self.say('  warning: ' + p)
        if self.a.verbose:
            for line in out.get('log') or []:
                sys.stdout.write('    ' + line + '\n')
        sys.stdout.flush()

    # -- entry points -------------------------------------------------------------------------------------------------
    def run_once(self):
        r = self.poll(set_hb=False)
        if not r.ok:
            if r.err == 'connect':
                self.say('tuner port %s:%d is closed (is the game running with EnableTuner 1?)' % (self.a.host, self.a.port))
                self.log.write('once', status='connect')
                return EXIT_CONNECT
            self.say('the game did not answer (%s %s)' % (r.err, r.detail))
            self.log.write('once', status='no-reply', err=r.err, detail=r.detail, preview=r.preview[:200])
            return EXIT_TRUNCATED if r.err == 'truncated' else EXIT_NOREPLY
        d = r.data
        if d.get('err') or not d.get('inGame'):
            self.say('not in a single-player match right now (%s); nothing done' % (d.get('err') or 'main menu or loading'))
            self.log.write('once', status='not-in-game', err=d.get('err'))
            return EXIT_REFUSED
        if d.get('mp') is True:
            self.say('multiplayer game: refusing to write')
            self.log.write('once', status='multiplayer')
            return EXIT_REFUSED
        self.stopper.critical = True
        try:
            res = self.run_cycle('once')
        finally:
            self.stopper.critical = False
        return res.code

    def run(self):
        a = self.a
        self.log.write('session-start', version=VERSION, argv=sys.argv[1:], host=a.host, port=a.port,
                       ctx_ui=a.ctx_ui, ctx_game=a.ctx_game, mode=self.mode, once=a.once, interval=a.interval,
                       lake_source=not a.no_lake_source, max_writes=a.max_writes, payload=self.payload_path,
                       token=self.token)
        if a.with_game and not a.once:
            if not self.wait_for_game():
                self.say('Civ VII is not running: exiting (the LaunchAgent starts me again when the game launches)')
                self.log.write('session-end', reason='no-game', code=EXIT_OK)
                return EXIT_OK
        try:
            self.payload()
        except (OSError, ValueError) as e:
            self.say('cannot load the payload: %s' % e)
            self.log.write('session-end', reason='payload', err=str(e))
            # --with-game: exit 0 so launchd does not restart it every 10 s; restarting can't fix a missing payload
            return EXIT_OK if a.with_game else EXIT_ERROR
        if a.once:
            code = self.run_once()
            self.log.write('session-end', reason='once', code=code)
            return code
        self.say('LCP river writer v%d (pid %d): watching %s:%d every %gs; lake sources %s; max %d writes per run%s'
                 % (VERSION, self.pid, a.host, a.port, a.interval, 'off' if a.no_lake_source else 'on', a.max_writes,
                    '; DRY RUN' if a.dry_run else ''))
        self.say('log: %s   stop: %s' % (a.log_file, 'stops by itself when Civ VII quits' if a.with_game else 'Ctrl+C'))
        while True:
            try:
                delay = self.tick()
            except KeyboardInterrupt:
                raise
            except Exception as e:      # keep watching; record the traceback
                self.log.write('error', err=repr(e), tb=traceback.format_exc()[-4000:])
                self.set_status('failing', 'unexpected watcher error: %s' % e)
                self.set_state('error', 'unexpected error (%s); see the log; retrying in 10 s' % e, key=repr(e))
                delay = 10.0
            if self.stopper.requested:
                raise KeyboardInterrupt()
            if a.with_game and self.game_gone():
                self.say('Civ VII has quit: exiting (the LaunchAgent starts me again when the game launches)')
                self.log.write('session-end', reason='game-exited', code=EXIT_OK)
                return EXIT_OK
            time.sleep(delay)


def parse_args(argv):
    p = argparse.ArgumentParser(
        prog='river_watch.py',
        description='LCP river writer: applies the cheat panel\'s queued rivers through the Civ VII tuner '
                    '(single-player, Mac). Rivers show after a save & load.')
    p.add_argument('--interval', type=float, default=2.0, help='seconds between polls while in a match (default 2)')
    p.add_argument('--once', action='store_true', help='run one full pass now, then exit')
    p.add_argument('--dry-run', action='store_true', help='never write; report what would be written')
    p.add_argument('--no-lake-source', action='store_true',
                   help='do not link lakes as river sources (lake sources are on by default)')
    p.add_argument('--max-writes', type=int, default=200, help='setRiverInfo calls per run (default 200, at least 1)')
    p.add_argument('--verbose', '-v', action='store_true', help='print the payload log lines')
    p.add_argument('--host', default='127.0.0.1', help=argparse.SUPPRESS)
    p.add_argument('--port', type=int, default=4318, help='tuner port (default 4318)')
    p.add_argument('--ctx-ui', default='65535', help=argparse.SUPPRESS)
    p.add_argument('--ctx-game', default='1', help=argparse.SUPPRESS)
    p.add_argument('--poll-timeout', type=float, default=4.0, help=argparse.SUPPRESS)
    p.add_argument('--payload-timeout', type=float, default=10.0, help=argparse.SUPPRESS)
    p.add_argument('--log-file', default=DEFAULT_LOG,
                   help='JSONL transcript (default ~/Library/Logs/lcp-river-writer.log; rotates to .1 above 5 MB)')
    p.add_argument('--pid-file', default=DEFAULT_PID,
                   help='single-instance lock file (default ~/Library/Logs/lcp-river-writer.pid)')
    p.add_argument('--with-game', action='store_true',
                   help='LaunchAgent mode: run only while Civ VII runs (wait up to --game-wait s for it at start, exit 0 '
                        'once it has quit); another running watcher is not an error')
    p.add_argument('--game-wait', type=float, default=30.0, help=argparse.SUPPRESS)
    p.add_argument('--game-gone-grace', type=float, default=10.0, help=argparse.SUPPRESS)
    p.add_argument('--game-process', default=GAME_PROCESS, help=argparse.SUPPRESS)
    a = p.parse_args(argv)
    if a.interval < 0.1:
        p.error('--interval must be at least 0.1')
    if a.max_writes < 1:      # review RW-7: 0 would make every run "capped" and re-run on every poll
        p.error('--max-writes must be at least 1')
    if a.game_wait < 0 or a.game_gone_grace < 0:
        p.error('--game-wait and --game-gone-grace must not be negative')
    return a


def main(argv=None):
    args = parse_args(sys.argv[1:] if argv is None else argv)
    stopper = Stopper()
    stopper.install()
    lock = None
    if not (args.once and args.dry_run):        # a one-shot dry run writes nothing and may run beside a watcher
        lock = PidLock(args.pid_file)
        ok, msg = lock.acquire()
        if not ok:
            sys.stdout.write('LCP river writer: %s\n' % msg)
            sys.stdout.flush()
            # --with-game: the game is already covered by that watcher; exit 0 so launchd does not restart this one
            return EXIT_OK if args.with_game else EXIT_LOCKED
    w = Watcher(args, stopper)
    try:
        return w.run()
    except KeyboardInterrupt:
        w.say('stopped.')
        w.log.write('session-end', reason='interrupt', stop_mark=w.mark_stopped())
        return EXIT_OK
    except Exception as e:
        w.log.write('session-end', reason='crash', err=repr(e), tb=traceback.format_exc()[-4000:])
        try:
            sys.stdout.write('LCP river writer: unexpected error: %r\n' % (e,))
        except (OSError, ValueError):
            pass
        return EXIT_ERROR
    finally:
        if lock is not None:
            lock.release()


if __name__ == '__main__':
    sys.exit(main())
