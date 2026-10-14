// server.js — Bola Kertas: HTTP static + WS rooms/lobby + bot webhook
import { createServer } from 'http';
import { readFileSync, existsSync, statSync } from 'fs';
import { join, extname } from 'path';
import { WebSocketServer } from 'ws';
import { Engine, STEP, makeCode, checksum, runToRest, LOCKSTEP_AIM_S, MAX_IDLE_TURNS, FORMATIONS } from './public/engine.js';
import { ALL_TEAMS, rosterFor, teamById } from './public/teams.js';

const PORT = parseInt(process.env.PORT || '3000');
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const WEBAPP_URL = process.env.WEBAPP_URL || '';

// ── static file server ──────────────────────────────────────
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.ico':'image/x-icon','.svg':'image/svg+xml','.woff2':'font/woff2' };
const PUBLIC = new URL('./public/', import.meta.url).pathname;

function serveStatic(req, res) {
  if (req.url === '/healthz') { res.writeHead(200); res.end('ok'); return; }
  let path = req.url.split('?')[0];
  if (path === '/') path = '/index.html';
  const file = join(PUBLIC, path);
  if (!existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end('Not Found'); return; }
  const ext = extname(file);
  const ct = MIME[ext] || 'application/octet-stream';
  const body = readFileSync(file);
  res.writeHead(200, {
    'Content-Type': ct,
    'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

// ── rooms ───────────────────────────────────────────────────
const rooms = new Map();
const MAX_ROOMS = 200;

function createRoom(rules) {
  if (rooms.size >= MAX_ROOMS) return null;
  let code; do { code = makeCode(5); } while (rooms.has(code));
  rooms.set(code, { code, rules, players: [], created: Date.now(), started: false });
  return code;
}

// ── HTTP server ─────────────────────────────────────────────
const server = createServer((req, res) => {
  // CORS for Mini App
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // POST /api/room — create room
  if (req.method === 'POST' && req.url === '/api/room') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      try {
        const { rules } = JSON.parse(body);
        const code = createRoom(rules || {});
        if (!code) { res.writeHead(503); res.end(JSON.stringify({ error: 'full' })); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code }));
      } catch { res.writeHead(400); res.end('bad'); }
    });
    return;
  }

  // bot webhook
  if (req.method === 'POST' && req.url === '/bot/webhook') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 65536) req.destroy(); });
    req.on('end', () => handleBotUpdate(body, res));
    return;
  }

  serveStatic(req, res);
});

// ── WebSocket ───────────────────────────────────────────────
const wss = new WebSocketServer({ server, maxPayload: 4096 });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  const pid = url.searchParams.get('pid') || 'anon';

  if (path === '/ws/lobby') {
    handleLobby(ws, pid);
  } else if (path.startsWith('/ws/room/')) {
    const code = path.split('/')[3];
    handleRoom(ws, pid, code);
  } else {
    ws.close(4000, 'unknown');
  }
});

// ── lobby (matchmaking queue) ───────────────────────────────
const queue = [];

function handleLobby(ws, pid) {
  ws.pid = pid;
  ws.on('message', raw => {
    try {
      const msg = JSON.parse(String(raw));
      if (msg.t === 'queue') {
        queue.push(ws);
        tryMatch();
      } else if (msg.t === 'unqueue') {
        const i = queue.indexOf(ws); if (i >= 0) queue.splice(i, 1);
      }
    } catch {}
  });
  ws.on('close', () => { const i = queue.indexOf(ws); if (i >= 0) queue.splice(i, 1); });
}

function tryMatch() {
  while (queue.length >= 2) {
    const a = queue.shift(), b = queue.shift();
    if (a.readyState !== 1) { if (b.readyState === 1) queue.unshift(b); continue; }
    if (b.readyState !== 1) { queue.unshift(a); continue; }
    const code = createRoom({ goalsToWin: 0, minutes: 3, halves: true, powerStrike: true, layout: 'spread', turnLimit: 15 });
    if (!code) { a.close(); b.close(); return; }
    const msg = JSON.stringify({ t: 'matched', code });
    a.send(msg); b.send(msg);
  }
}

// ── room (game session) ─────────────────────────────────────
function handleRoom(ws, pid, code) {
  const room = rooms.get(code);
  if (!room) { ws.send(JSON.stringify({ t: 'err', msg: 'no-room' })); ws.close(4004); return; }
  if (room.players.length >= 2 && !room.players.find(p => p.pid === pid)) {
    ws.send(JSON.stringify({ t: 'err', msg: 'room-full' })); ws.close(4009); return;
  }

  let player = room.players.find(p => p.pid === pid);
  const isReconnect = !!player;
  if (!player) {
    player = { pid, ws, profile: null, seat: room.players.length, actions: [] };
    room.players.push(player);
  } else {
    player.ws = ws;
  }

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(String(raw));
      if (msg.t === 'join') {
        player.profile = msg.profile;
        if (msg.rules && player.seat === 0) room.rules = { ...room.rules, ...msg.rules };
        if (room.players.length === 2 && room.players.every(p => p.profile)) {
          startMatch(room);
        } else {
          ws.send(JSON.stringify({ t: 'waiting' }));
        }
      } else if (msg.t === 'action') {
        player.actions.push(msg.a);
        // relay to opponent
        const other = room.players.find(p => p !== player);
        if (other?.ws?.readyState === 1) {
          // compute checksum on server engine
          if (room.engine) {
            if (['aim','halftime'].includes(room.engine.phase)) {
              room.engine._applyAction(msg.a);
              runToRest(room.engine);
            }
          }
          const chk = room.engine ? checksum(room.engine) : null;
          other.ws.send(JSON.stringify({ t: 'act', a: msg.a, chk, left: null }));
        }
      } else if (msg.t === 'rematch') {
        player.rematch = true;
        const other = room.players.find(p => p !== player);
        if (other?.ws?.readyState === 1) other.ws.send(JSON.stringify({ t: 'rematch', from: player.seat }));
        if (room.players.every(p => p.rematch)) {
          for (const p of room.players) { p.rematch = false; p.actions = []; }
          room.engine = null; room.started = false;
          startMatch(room);
        }
      } else if (msg.t === 'ping') { /* keepalive */ }
    } catch {}
  });

  ws.on('close', () => {
    const other = room.players.find(p => p !== player);
    if (other?.ws?.readyState === 1) other.ws.send(JSON.stringify({ t: 'opp', status: 'left', graceMs: 60000 }));
    // cleanup after 60s if no reconnect
    setTimeout(() => {
      if (player.ws.readyState !== 1 && room.players.every(p => p.ws.readyState !== 1)) {
        rooms.delete(code);
      }
    }, 70000);
  });
}

function startMatch(room) {
  if (room.started) return;
  room.started = true;
  const seed = Date.now();
  const p0 = room.players[0], p1 = room.players[1];
  const t0 = teamById(p0.profile?.team || 'jdt');
  const t1 = teamById(p1.profile?.team || 'sel');
  const setup = {
    rules: room.rules,
    teams: [t0.id, t1.id],
    kits: [t0.jerseys[0].id, t1.jerseys[1]?.id || t1.jerseys[0].id],
    formations: ['4-4-2', '4-3-3'],
    rosters: [rosterFor(t0), rosterFor(t1)],
    seed,
    ...room.rules,
    layout: room.rules.layout || 'spread',
    cpu: [false, false],
    lockstep: true,
  };
  // build server engine for checksum
  room.engine = new Engine(setup);
  runToRest(room.engine);

  for (const p of room.players) {
    if (p.ws.readyState === 1) {
      p.ws.send(JSON.stringify({ t: 'setup', setup, seat: p.seat, log: [], left: null }));
    }
  }
}

// ── bot webhook handler ─────────────────────────────────────
async function handleBotUpdate(body, res) {
  res.writeHead(200); res.end('ok');
  try {
    const update = JSON.parse(body);
    if (update.message?.text === '/start') {
      const chatId = update.message.chat.id;
      const name = update.message.from.first_name || 'Player';
      await botApi('sendMessage', {
        chat_id: chatId,
        text: `⚽ Selamat datang ke *Bola Kertas*\\!\n\nTekan butang di bawah untuk mula bermain\\. Pilih pasukan, lawan CPU atau cabaran kawan secara online\\!`,
        parse_mode: 'MarkdownV2',
        reply_markup: { inline_keyboard: [[{ text: '🎮 Main Sekarang', web_app: { url: WEBAPP_URL || `https://bolakertas.boostdeck.tech` } }]] },
      });
    }
  } catch (e) { console.error('bot webhook error:', e.message); }
}

async function botApi(method, body) {
  if (!BOT_TOKEN) return;
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return r.json();
}

// ── cleanup stale rooms ─────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.created > 3600000) rooms.delete(code);
  }
}, 60000);

// ── start ───────────────────────────────────────────────────
server.listen(PORT, () => console.log(`Bola Kertas running on :${PORT}`));

// set bot webhook + menu button on start
if (BOT_TOKEN && WEBAPP_URL) {
  const whUrl = WEBAPP_URL.replace(/\/$/, '') + '/bot/webhook';
  botApi('setWebhook', { url: whUrl }).then(r => console.log('webhook:', JSON.stringify(r)));
  botApi('setChatMenuButton', { menu_button: { type: 'web_app', text: '🎮 Main', web_app: { url: WEBAPP_URL } } }).then(r => console.log('menu:', JSON.stringify(r)));
  botApi('setMyCommands', { commands: [{ command: 'start', description: 'Mula bermain Bola Kertas' }] });
  botApi('setMyDescription', { description: 'Bola Kertas — 3D Paper Football. Tepuk, gol, menang!' });
}
