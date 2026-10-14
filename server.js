// server.js : Bola Kertas. Static files, Telegram auth, shop + Stars, CPU match rewards, online rooms.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { WebSocketServer } from 'ws';
import { Engine, runToRest, isRest, makeCode, BASE_STATS, FORMATIONS } from './public/engine.js';
import { teamById, rosterFor } from './public/teams.js';
import { ITEMS, itemById, DEFAULT_EQUIP, SLOTS, matchReward, DAILY_COIN_CAP } from './public/items.js';

const PORT = +(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const WEBAPP_URL = (process.env.WEBAPP_URL || '').replace(/\/$/, '');
const DATA_DIR = process.env.DATA_DIR || './data';
const PUBLIC = normalize(new URL('./public/', import.meta.url).pathname);
const SECRET = createHash('sha256').update('bk-sign:' + (BOT_TOKEN || 'dev')).digest();
const WH_SECRET = createHash('sha256').update('bk-wh:' + (BOT_TOKEN || 'dev')).digest('hex').slice(0, 48);

// ── storage ────────────────────────────────────────────────
mkdirSync(DATA_DIR, { recursive: true });
export const db = new DatabaseSync(join(DATA_DIR, 'bolakertas.db'));
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users (uid INTEGER PRIMARY KEY, name TEXT, coins INTEGER NOT NULL DEFAULT 200 CHECK (coins >= 0),
  equip TEXT NOT NULL DEFAULT '{}', pass_until INTEGER NOT NULL DEFAULT 0, day TEXT, day_coins INTEGER NOT NULL DEFAULT 0, created INTEGER);
CREATE TABLE IF NOT EXISTS owned (uid INTEGER NOT NULL, item TEXT NOT NULL, src TEXT, at INTEGER, PRIMARY KEY (uid, item));
CREATE TABLE IF NOT EXISTS payments (charge_id TEXT PRIMARY KEY, uid INTEGER NOT NULL, item TEXT NOT NULL, stars INTEGER NOT NULL, at INTEGER);
CREATE TABLE IF NOT EXISTS matches (mid TEXT PRIMARY KEY, uid INTEGER NOT NULL, setup TEXT NOT NULL, created INTEGER, done INTEGER NOT NULL DEFAULT 0);`);
const q = sql => db.prepare(sql);
const tx = fn => { db.exec('BEGIN IMMEDIATE'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };

function getUser(uid, name) {
  let u = q('SELECT * FROM users WHERE uid=?').get(uid);
  if (!u) { q('INSERT INTO users (uid,name,equip,created) VALUES (?,?,?,?)').run(uid, name || '', JSON.stringify(DEFAULT_EQUIP), Date.now()); u = q('SELECT * FROM users WHERE uid=?').get(uid); }
  else if (name && name !== u.name) q('UPDATE users SET name=? WHERE uid=?').run(name, uid);
  return u;
}
const ownedSet = uid => new Set([...ITEMS.filter(i => i.free).map(i => i.id), ...q('SELECT item FROM owned WHERE uid=?').all(uid).map(r => r.item)]);
function profile(uid) {
  const u = q('SELECT * FROM users WHERE uid=?').get(uid);
  const equip = { ...DEFAULT_EQUIP, ...JSON.parse(u.equip || '{}') };
  return { uid, name: u.name, coins: u.coins, equip, owned: [...ownedSet(uid)], passUntil: u.pass_until };
}
const paperStats = uid => { if (!uid) return { ...BASE_STATS }; const id = profile(uid).equip.paper; return { ...BASE_STATS, ...(itemById(id)?.stats || {}) }; };

// ── Telegram initData (HMAC, official algorithm) ───────────
export function verifyInitData(initData, token = BOT_TOKEN, maxAgeS = 86400) {
  if (!initData || !token || initData.length > 4096) return null;
  const params = new URLSearchParams(initData), hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;
  params.delete('hash');
  const dcs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const key = createHmac('sha256', 'WebAppData').update(token).digest();
  const calc = createHmac('sha256', key).update(dcs).digest();
  if (!timingSafeEqual(calc, Buffer.from(hash, 'hex'))) return null;
  const age = Date.now() / 1000 - Number(params.get('auth_date'));
  if (!(age >= -300 && age < maxAgeS)) return null;
  try { const user = JSON.parse(params.get('user') || 'null'); if (!user?.id) return null; return { uid: user.id, name: (user.first_name || '').slice(0, 40) }; } catch { return null; }
}

// ── Stars invoice payload (<=128 bytes, HMAC bound) ────────
const sig = s => createHmac('sha256', SECRET).update(s).digest('hex').slice(0, 20);
export function makePayload(item, uid) { const base = `v1|${item}|${uid}|${randomBytes(4).toString('hex')}`; return `${base}|${sig(base)}`; }
export function readPayload(p) {
  if (typeof p !== 'string' || Buffer.byteLength(p) > 128) return null;
  const parts = p.split('|'); if (parts.length !== 5 || parts[0] !== 'v1') return null;
  const base = parts.slice(0, 4).join('|'), s = Buffer.from(sig(base)), got = Buffer.from(parts[4]);
  if (s.length !== got.length || !timingSafeEqual(s, got)) return null;
  const item = itemById(parts[1]); if (!item || !item.stars) return null;
  return { item, uid: Number(parts[2]) };
}

// Grants are exactly-once per Telegram charge id.
export function fulfill(chargeId, uid, itemId, stars) {
  const item = itemById(itemId);
  if (!item || item.stars !== stars) return { ok: false, err: 'mismatch' };
  return tx(() => {
    const prev = q('SELECT * FROM payments WHERE charge_id=?').get(chargeId);
    if (prev) return prev.uid === uid && prev.item === itemId ? { ok: true, dup: true } : { ok: false, err: 'conflict' };
    getUser(uid);
    q('INSERT INTO payments (charge_id,uid,item,stars,at) VALUES (?,?,?,?,?)').run(chargeId, uid, itemId, stars, Date.now());
    if (item.slot === 'pass') {
      const u = q('SELECT pass_until FROM users WHERE uid=?').get(uid);
      q('UPDATE users SET pass_until=? WHERE uid=?').run(Math.max(Date.now(), u.pass_until) + item.days * 86400e3, uid);
    } else q('INSERT OR IGNORE INTO owned (uid,item,src,at) VALUES (?,?,?,?)').run(uid, itemId, 'stars', Date.now());
    return { ok: true };
  });
}

export function buyWithCoins(uid, itemId) {
  const item = itemById(itemId);
  if (!item || !item.coins) return { ok: false, err: 'not_for_coins' };
  return tx(() => {
    const u = getUser(uid);
    if (ownedSet(uid).has(itemId)) return { ok: false, err: 'owned' };
    if (u.coins < item.coins) return { ok: false, err: 'coins' };
    q('UPDATE users SET coins=coins-? WHERE uid=?').run(item.coins, uid);
    q('INSERT INTO owned (uid,item,src,at) VALUES (?,?,?,?)').run(uid, itemId, 'coins', Date.now());
    return { ok: true };
  });
}

// ── CPU match setup + server replay for rewards ────────────
const SKILLS = [0.25, 0.5, 0.8], MINUTES = [1, 3, 5];
export function buildSetup({ team0, team1, kit0, kit1, formation, skill, minutes, seed, paper0, paper1, cpu = [false, true] }) {
  const t0 = teamById(team0), t1 = teamById(team1);
  return { seed: seed >>> 0, minutes: MINUTES.includes(+minutes) ? +minutes : 3, halves: true, goalsToWin: 0, powerStrike: true,
    layout: 'spread', lockstep: true, turnLimit: 15, cpu, cpuSkill: SKILLS.includes(+skill) ? +skill : 0.5,
    formations: [FORMATIONS[formation] ? formation : '4-4-2', '4-4-2'], teams: [t0.id, t1.id],
    kits: [kit0 || t0.jerseys[0].id, kit1 || t1.jerseys[0].id], rosters: [rosterFor(t0), rosterFor(t1)],
    paper: [paper0 || { ...BASE_STATS }, paper1 || { ...BASE_STATS }] };
}
// Mirrors the client loop exactly: halftime auto, CPU acts from engine RNG, humans act from the log.
export function replayCpuMatch(setup, actions) {
  const e = new Engine(setup); runToRest(e);
  let i = 0, guard = 0;
  while (e.phase !== 'over' && guard++ < 2000) {
    if (e.phase === 'halftime') e._applyAction({ t: 'half' });
    else if (setup.cpu[e.turnTeam]) e._applyAction(e.cpuAction());
    else { if (i >= actions.length) return null; if (!e._applyAction(actions[i++])) return null; }
    runToRest(e);
  }
  return e.phase === 'over' ? e : null;
}

// ── http helpers ───────────────────────────────────────────
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
function serveStatic(req, res) {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const file = normalize(join(PUBLIC, p));
  if (!file.startsWith(PUBLIC) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
  const ext = extname(file), st = statSync(file), etag = `"${st.size.toString(36)}-${st.mtimeMs.toString(36)}"`;
  // App code revalidates (module imports carry no version); vendor + fonts never change per path.
  const immutable = p.startsWith('/vendor/') || p.startsWith('/fonts/');
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', ETag: etag,
    'Cache-Control': ext === '.html' ? 'no-store' : immutable ? 'public, max-age=2592000' : 'no-cache' };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
  res.writeHead(200, headers);
  res.end(readFileSync(file));
}
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
const readBody = (req, max = 65536) => new Promise((ok, bad) => { let b = ''; req.on('data', c => { b += c; if (b.length > max) { bad(new Error('big')); req.destroy(); } }); req.on('end', () => ok(b)); req.on('error', bad); });
const hits = new Map();
function limited(key, n, ms) { const now = Date.now(), a = (hits.get(key) || []).filter(t => now - t < ms); a.push(now); hits.set(key, a); return a.length > n; }
async function bot(method, body) {
  if (!BOT_TOKEN) return { ok: false };
  try { const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return await r.json(); }
  catch (e) { return { ok: false, description: e.message }; }
}

async function api(req, res, path) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
  if (limited('ip:' + ip, 120, 60e3)) return json(res, 429, { err: 'slow_down' });
  if (req.method === 'POST' && path === '/api/room') {
    let rules = {}; try { rules = JSON.parse(await readBody(req, 2048)).rules || {}; } catch { return json(res, 400, { err: 'bad' }); }
    const code = createRoom(rules); return code ? json(res, 200, { code }) : json(res, 503, { err: 'full' });
  }
  const auth = verifyInitData(req.headers['x-init-data']);
  if (!auth) return json(res, 401, { err: 'auth' });
  getUser(auth.uid, auth.name);
  if (req.method === 'GET' && path === '/api/me') return json(res, 200, profile(auth.uid));
  let body = {}; try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return json(res, 400, { err: 'bad' }); }

  if (path === '/api/equip') {
    const item = itemById(body.item);
    if (!item || !SLOTS.includes(item.slot) || !ownedSet(auth.uid).has(item.id)) return json(res, 400, { err: 'not_owned' });
    const p = profile(auth.uid); p.equip[item.slot] = item.id;
    q('UPDATE users SET equip=? WHERE uid=?').run(JSON.stringify(p.equip), auth.uid);
    return json(res, 200, profile(auth.uid));
  }
  if (path === '/api/shop/buy') { const r = buyWithCoins(auth.uid, body.item); return json(res, r.ok ? 200 : 400, r.ok ? profile(auth.uid) : r); }
  if (path === '/api/shop/invoice') {
    const item = itemById(body.item);
    if (!item?.stars) return json(res, 400, { err: 'not_for_stars' });
    if (!item.consumable && ownedSet(auth.uid).has(item.id)) return json(res, 400, { err: 'owned' });
    if (limited('inv:' + auth.uid, 10, 60e3)) return json(res, 429, { err: 'slow_down' });
    const r = await bot('createInvoiceLink', { title: item.name, description: item.desc.slice(0, 255), payload: makePayload(item.id, auth.uid),
      provider_token: '', currency: 'XTR', prices: [{ label: item.name, amount: item.stars }] });
    return r.ok ? json(res, 200, { url: r.result }) : json(res, 502, { err: 'invoice' });
  }
  if (path === '/api/match/start') {
    if (limited('ms:' + auth.uid, 30, 3600e3)) return json(res, 429, { err: 'slow_down' });
    const setup = buildSetup({ ...body, seed: randomBytes(4).readUInt32LE(), paper0: paperStats(auth.uid) });
    const mid = randomBytes(8).toString('hex');
    q('DELETE FROM matches WHERE created < ?').run(Date.now() - 6 * 3600e3);
    q('INSERT INTO matches (mid,uid,setup,created) VALUES (?,?,?,?)').run(mid, auth.uid, JSON.stringify(setup), Date.now());
    return json(res, 200, { mid, setup });
  }
  if (path === '/api/match/finish') {
    const m = q('SELECT * FROM matches WHERE mid=? AND uid=?').get(String(body.mid || ''), auth.uid);
    if (!m || m.done) return json(res, 400, { err: 'no_match' });
    const actions = Array.isArray(body.actions) ? body.actions.slice(0, 600) : [];
    const setup = JSON.parse(m.setup), e = replayCpuMatch(setup, actions);
    q('UPDATE matches SET done=1 WHERE mid=?').run(m.mid);
    if (!e) return json(res, 400, { err: 'replay_failed' });
    const won = e.winner === 0, draw = e.winner === null, u = getUser(auth.uid), day = new Date().toISOString().slice(0, 10);
    let reward = matchReward({ won, draw, goals: e.score[0], skill: setup.cpuSkill, passActive: u.pass_until > Date.now() });
    const used = u.day === day ? u.day_coins : 0; reward = Math.max(0, Math.min(reward, DAILY_COIN_CAP - used));
    q('UPDATE users SET coins=coins+?, day=?, day_coins=? WHERE uid=?').run(reward, day, used + reward, auth.uid);
    return json(res, 200, { reward, score: e.score, winner: e.winner, capped: used + reward >= DAILY_COIN_CAP, profile: profile(auth.uid) });
  }
  return json(res, 404, { err: 'nope' });
}

// ── bot webhook: /start, pre-checkout, successful payment ──
async function onUpdate(u) {
  if (u.pre_checkout_query) {
    const pq = u.pre_checkout_query, p = readPayload(pq.invoice_payload);
    const ok = !!p && p.uid === pq.from.id && pq.currency === 'XTR' && pq.total_amount === p.item.stars &&
      (p.item.consumable || !ownedSet(p.uid).has(p.item.id));
    return bot('answerPreCheckoutQuery', ok ? { pre_checkout_query_id: pq.id, ok: true } : { pre_checkout_query_id: pq.id, ok: false, error_message: 'Item ini tidak boleh dibeli sekarang.' });
  }
  const m = u.message; if (!m) return;
  if (m.successful_payment) {
    const sp = m.successful_payment, p = readPayload(sp.invoice_payload);
    // Already charged: no expiry check here, only identity, item and amount.
    const r = p && p.uid === m.from.id && sp.currency === 'XTR' ? fulfill(sp.telegram_payment_charge_id, p.uid, p.item.id, sp.total_amount) : { ok: false };
    return bot('sendMessage', { chat_id: m.chat.id, text: r.ok ? `Terima kasih! ${p.item.name} dah masuk loker anda.` : `Bayaran diterima tetapi gagal diproses. Simpan ID resit ini dan hubungi /paysupport:\n${sp.telegram_payment_charge_id}` });
  }
  const text = m.text || '';
  if (text.startsWith('/start')) return bot('sendMessage', { chat_id: m.chat.id, parse_mode: 'HTML',
    text: '<b>Bola Kertas</b>\nBola sepak kertas 3D. Tepuk, bidik, gol.\n\nPilih pasukan dari Liga Malaysia, EPL, La Liga, Bundesliga atau negara. Lawan CPU, cabar kawan, kumpul kertas dan padang.',
    reply_markup: { inline_keyboard: [[{ text: 'Main Sekarang', web_app: { url: WEBAPP_URL } }]] } });
  if (text.startsWith('/paysupport')) return bot('sendMessage', { chat_id: m.chat.id, text: 'Masalah pembelian? Hantar ID resit (telegram_payment_charge_id) dan item yang dibeli dalam chat ini. Kami semak dalam 48 jam.' });
  if (text.startsWith('/terms')) return bot('sendMessage', { chat_id: m.chat.id, text: 'Semua item adalah kosmetik atau peningkatan dalam permainan sahaja. Tiada nilai tunai dan tidak boleh ditukar kepada wang.' });
}

// ── online rooms (server authoritative) ────────────────────
const rooms = new Map(), queue = [];
const TURN_MS = 15000 + 1500, GONE_MS = 60000;
function createRoom(rules) {
  if (rooms.size >= 300) return null;
  let code; do code = makeCode(5); while (rooms.has(code));
  rooms.set(code, { code, rules: { minutes: MINUTES.includes(+rules?.minutes) ? +rules.minutes : 3 }, players: [], created: Date.now() });
  return code;
}
const send = (ws, o) => { if (ws?.readyState === 1) ws.send(JSON.stringify(o)); };
const cast = (room, o) => room.players.forEach(p => send(p.ws, o));
function armTurn(room) {
  clearTimeout(room.timer);
  const e = room.engine; if (!e || e.phase === 'over') return;
  if (e.phase === 'halftime') { room.timer = setTimeout(() => act(room, null, { t: 'half' }), 3000); return; }
  room.deadline = Date.now() + TURN_MS;
  room.timer = setTimeout(() => {
    const p = room.players[e.turnTeam]; p.idle = (p.idle || 0) + 1;
    if (p.idle >= 3) return forfeit(room, e.turnTeam);
    act(room, null, { t: 'skip' });
  }, TURN_MS);
}
function act(room, seat, a) {
  const e = room.engine; if (!e || !isRest(e)) return false;
  if (seat !== null && (a?.t === 'half' || e.turnTeam !== seat)) return false;
  if (!e._applyAction(a)) return false;
  if (seat !== null) room.players[seat].idle = 0;
  runToRest(e);
  cast(room, { t: 'act', a, state: e.exportState(), left: TURN_MS });
  if (e.phase === 'over') { cast(room, { t: 'over', winner: e.winner, score: e.score }); clearTimeout(room.timer); }
  else armTurn(room);
  return true;
}
function forfeit(room, loser) {
  const e = room.engine; if (!e || e.phase === 'over') return;
  clearTimeout(room.timer); e.phase = 'over'; e.winner = 1 - loser;
  cast(room, { t: 'over', winner: e.winner, score: e.score, forfeit: true, state: e.exportState() });
}
function startMatch(room) {
  const [a, b] = room.players;
  const setup = buildSetup({ team0: a.profile.team, team1: b.profile.team, kit0: a.profile.kit, kit1: b.profile.kit, formation: a.profile.formation,
    minutes: room.rules.minutes, seed: randomBytes(4).readUInt32LE(), paper0: paperStats(a.uid), paper1: paperStats(b.uid), cpu: [false, false] });
  setup.formations[1] = FORMATIONS[b.profile.formation] ? b.profile.formation : '4-4-2';
  setup.names = [a.profile.name, b.profile.name]; setup.paperIds = [a.paperId, b.paperId];
  room.setup = setup; room.engine = new Engine(setup); runToRest(room.engine); room.rematch = new Set();
  room.players.forEach((p, i) => send(p.ws, { t: 'setup', setup, seat: i, state: room.engine.exportState(), left: TURN_MS }));
  armTurn(room);
}
function onRoomSocket(ws, pid, code) {
  const room = rooms.get(code);
  if (!room) { send(ws, { t: 'err', msg: 'no-room' }); return ws.close(4004); }
  let me = room.players.find(p => p.pid === pid);
  if (!me && room.players.length >= 2) { send(ws, { t: 'err', msg: 'room-full' }); return ws.close(4009); }
  if (!me) { me = { pid, seat: room.players.length }; room.players.push(me); }
  if (me.ws && me.ws !== ws) try { me.ws.close(4001); } catch {}
  me.ws = ws; clearTimeout(me.goneTimer);
  ws.on('message', raw => {
    let m; try { m = JSON.parse(String(raw)); } catch { return; }
    if (m.t === 'join') {
      const auth = verifyInitData(m.initData);
      me.uid = auth?.uid || 0; me.paperId = me.uid ? profile(me.uid).equip.paper : 'p_a4';
      const pr = m.profile || {};
      me.profile = { name: String(auth?.name || pr.name || 'Pemain').slice(0, 20), team: teamById(pr.team).id, kit: String(pr.kit || ''), formation: String(pr.formation || '4-4-2') };
      if (room.engine) return send(ws, { t: 'setup', setup: room.setup, seat: me.seat, state: room.engine.exportState(), left: Math.max(0, (room.deadline || 0) - Date.now()) });
      const other = room.players.find(p => p !== me);
      if (other?.profile) startMatch(room); else send(ws, { t: 'waiting', code });
      if (other) send(other.ws, { t: 'opp', here: true });
    } else if (m.t === 'act') { if (!act(room, me.seat, m.a)) send(ws, { t: 'err', msg: 'bad-act', state: room.engine?.exportState() }); }
    else if (m.t === 'rematch' && room.engine?.phase === 'over') {
      room.rematch.add(me.seat); cast(room, { t: 'rematch', seats: [...room.rematch] });
      if (room.rematch.size === 2) startMatch(room);
    }
  });
  ws.on('close', () => {
    if (me.ws !== ws) return;
    const other = room.players.find(p => p !== me); send(other?.ws, { t: 'opp', here: false, graceMs: GONE_MS });
    me.goneTimer = setTimeout(() => {
      if (room.engine && room.engine.phase !== 'over') forfeit(room, me.seat);
      if (room.players.every(p => p.ws?.readyState !== 1)) { clearTimeout(room.timer); rooms.delete(code); }
    }, room.engine ? GONE_MS : 5000);
  });
}
function onLobbySocket(ws) {
  ws.on('message', raw => {
    let m; try { m = JSON.parse(String(raw)); } catch { return; }
    if (m.t === 'queue' && !queue.includes(ws)) {
      queue.push(ws);
      while (queue.length >= 2) {
        const a = queue.shift(), b = queue.shift();
        if (a.readyState !== 1) { if (b.readyState === 1) queue.unshift(b); continue; }
        if (b.readyState !== 1) { queue.unshift(a); continue; }
        const code = createRoom({ minutes: 3 }); send(a, { t: 'matched', code }); send(b, { t: 'matched', code });
      }
    }
    if (m.t === 'unqueue') { const i = queue.indexOf(ws); if (i >= 0) queue.splice(i, 1); }
  });
  ws.on('close', () => { const i = queue.indexOf(ws); if (i >= 0) queue.splice(i, 1); });
}

// ── server ─────────────────────────────────────────────────
export const server = createServer(async (req, res) => {
  const path = req.url.split('?')[0];
  try {
    if (path === '/healthz') { res.writeHead(200); return res.end('ok'); }
    if (path === '/bot/webhook' && req.method === 'POST') {
      if (req.headers['x-telegram-bot-api-secret-token'] !== WH_SECRET) { res.writeHead(403); return res.end(); }
      const body = await readBody(req, 262144); res.writeHead(200); res.end('ok');
      try { await onUpdate(JSON.parse(body)); } catch (e) { console.error('update', e.message); }
      return;
    }
    if (path.startsWith('/api/')) return await api(req, res, path);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    serveStatic(req, res);
  } catch (e) { console.error('req', e.message); if (!res.headersSent) json(res, 500, { err: 'server' }); }
});
const wss = new WebSocketServer({ server, maxPayload: 8192 });
wss.on('connection', (ws, req) => {
  const u = new URL(req.url, 'http://x'), pid = (u.searchParams.get('pid') || '').slice(0, 64) || randomBytes(6).toString('hex');
  let n = 0; const iv = setInterval(() => { n = 0; }, 1000);
  ws.on('message', () => { if (++n > 20) ws.close(4008); });
  ws.on('close', () => clearInterval(iv));
  if (u.pathname === '/ws/lobby') onLobbySocket(ws);
  else if (u.pathname.startsWith('/ws/room/')) onRoomSocket(ws, pid, u.pathname.split('/')[3]?.toUpperCase());
  else ws.close(4000);
});
setInterval(() => { const now = Date.now(); for (const [c, r] of rooms) if (now - r.created > 3 * 3600e3) { clearTimeout(r.timer); rooms.delete(c); } }, 60e3).unref();

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => console.log('Bola Kertas on :' + PORT));
  if (BOT_TOKEN && WEBAPP_URL) {
    bot('setWebhook', { url: WEBAPP_URL + '/bot/webhook', secret_token: WH_SECRET, allowed_updates: ['message', 'pre_checkout_query'] }).then(r => console.log('webhook', r.ok, r.description || ''));
    bot('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Main', web_app: { url: WEBAPP_URL } } });
    bot('setMyCommands', { commands: [{ command: 'start', description: 'Main Bola Kertas' }, { command: 'paysupport', description: 'Bantuan pembelian' }, { command: 'terms', description: 'Terma' }] });
    bot('setMyDescription', { description: 'Bola sepak kertas 3D. Tepuk, bidik, gol. Lawan CPU atau cabar kawan.' });
    bot('setMyShortDescription', { short_description: 'Bola sepak kertas 3D dalam Telegram.' });
  }
}
