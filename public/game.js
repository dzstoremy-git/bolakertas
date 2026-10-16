// game.js : Bola Kertas app. Menus, shop, match loop, camera, controls, HUD, sound, online.
import * as THREE from 'three';
import { Engine, FIELD, STEP, SHOT_TYPES, FORMATIONS, MAX_TAPS, POWER_CHARGE, MAX_DRAG, predictPath, isRest, BASE_STATS, statF, PROTOCOL } from './engine.js?v=46';
import { LEAGUES, ALL_TEAMS, teamById, rosterFor, cleanRoster, cleanKit, KIT_PATTERNS, PREMIUM_PATTERNS, COLLARS } from './teams.js?v=46';
import { ITEMS, itemById, DEFAULT_EQUIP, RARITY, rarityOf, perksUpTo, isOwned, completeSet, aiEquip } from './items.js?v=46';
import { World, Q } from './scene.js?v=46';
import { crest, ink } from './art.js?v=46';
import * as L3 from './locker3d.js?v=46';
import { tr, trMs, itemName, itemDesc, langFrom, LANGS, LANG_NAME } from './i18n.js?v=46';
import { tierOf, TIERS, seasonOf } from './rank.js?v=46';

const tg = window.Telegram?.WebApp;
const beacon = o => { try { navigator.sendBeacon('/api/log', JSON.stringify({ ...o, v: 21, ua: navigator.userAgent.slice(0, 120), tgv: window.Telegram?.WebApp?.version })); } catch {} };
addEventListener('error', e => beacon({ err: e.message, at: `${e.filename?.split('/').pop()}:${e.lineno}` }));
addEventListener('unhandledrejection', e => beacon({ err: String(e.reason?.stack || e.reason).slice(0, 300) }));
const initData = tg?.initData || '';
const $ = s => document.querySelector(s);
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const haptic = (k = 'light') => { try { tg?.HapticFeedback?.impactOccurred?.(k); } catch {} };
const notify = (k = 'success') => { try { tg?.HapticFeedback?.notificationOccurred?.(k); } catch {} };
const PID = localStorage.getItem('bk/pid') || (() => { const p = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('bk/pid', p); return p; })();

// ── settings + profile ─────────────────────────────────────
const S = Object.assign({ team: 'jdt', opp: 'sel', kit: 0, formation: '4-4-2', skill: 0.5, minutes: 3, cam: 'behind', ctrl: 'sling', sound: true, hints: true, league: 'my', oppLeague: 'my' },
  JSON.parse(localStorage.getItem('bk/settings') || '{}'));
const saveS = () => localStorage.setItem('bk/settings', JSON.stringify(S));
if (!LANGS.includes(S.lang)) S.lang = langFrom(tg?.initDataUnsafe?.user?.language_code || navigator.language);
document.documentElement.lang = S.lang;
const T = (k, v) => tr(S.lang, k, v), iname = it => itemName(it, S.lang), idesc = it => itemDesc(it, S.lang), num = n => Number(n).toLocaleString(S.lang === 'ms' ? 'ms-MY' : S.lang);
let P = { guest: true, coins: 0, equip: { ...DEFAULT_EQUIP, ...JSON.parse(localStorage.getItem('bk/equip') || '{}') }, owned: ITEMS.filter(i => i.free).map(i => i.id), passUntil: 0, name: tg?.initDataUnsafe?.user?.first_name || '' };

async function api(path, body) {
  const r = await fetch(path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Init-Data': initData }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.err || 'http'), { code: j.err }); return j;
}
async function loadProfile() {
  if (!initData) return;
  try { const me = await api('/api/me'); P = { ...me, guest: false }; } catch (e) { console.warn('profile', e.message); }
  updateCoins();
}
const squadLocal = () => JSON.parse(localStorage.getItem('bk/squad') || '{}');
const mySquad = () => (P.guest ? squadLocal() : P.squad) || {};
const updateCoins = () => document.querySelectorAll('[data-coins]').forEach(e => e.textContent = P.guest ? T('guest') : num(P.coins));

// ── sound (WebAudio synth, created on first gesture) ───────
const A = { ctx: null };
function audio() { if (!A.ctx && S.sound) { try { A.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch {} } return S.sound ? A.ctx : null; }
function tone(freq, dur, type = 'sine', vol = 0.2, slide = 0) {
  const c = audio(); if (!c) return; const o = c.createOscillator(), g = c.createGain(), t = c.currentTime;
  o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur);
}
function noise(dur, vol = 0.2, freq = 1200, q = 0.7) {
  const c = audio(); if (!c) return; const b = c.createBuffer(1, c.sampleRate * dur, c.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(); s.buffer = b; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q; g.gain.value = vol;
  s.connect(f).connect(g).connect(c.destination); s.start();
}
const SFX = {
  tap: (p = 0.6) => { tone(140 + p * 60, 0.12, 'triangle', 0.35, 0.5); noise(0.05, 0.25, 2500, 1.5); },
  hit: v => { noise(0.04, Math.min(0.3, 0.06 + v * 0.03), 3200, 2); tone(520, 0.05, 'square', 0.04, 0.7); },
  post: () => { tone(880, 0.5, 'triangle', 0.18, 0.98); tone(1320, 0.4, 'sine', 0.1, 0.98); },
  bounce: v => tone(90, 0.08, 'sine', Math.min(0.2, v * 0.04), 0.6),
  whistle: (long) => { tone(2300, long ? 0.9 : 0.35, 'square', 0.05, 1.02); tone(2340, long ? 0.9 : 0.35, 'square', 0.05, 0.99); },
  goal: () => { noise(2.2, 0.35, 900, 0.3); [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.35, 'triangle', 0.12), i * 110)); },
  ui: () => tone(660, 0.05, 'sine', 0.08), buy: () => [784, 988, 1318].forEach((f, i) => setTimeout(() => tone(f, 0.18, 'triangle', 0.12), i * 90)),
  tapLegend: (r) => { tone(r >= 4 ? 1320 : 990, 0.18, 'triangle', 0.09, 1.6); setTimeout(() => tone(r >= 4 ? 1760 : 1320, 0.14, 'sine', 0.06), 60); },
  goalMyth: () => [523, 659, 784, 1046, 1318].forEach((f, i) => setTimeout(() => tone(f, 0.35, 'triangle', 0.08), 380 + i * 90)),
  ignite: () => { noise(0.6, 0.2, 400, 0.4); tone(110, 0.6, 'sawtooth', 0.08, 2.2); },
};

// Paper squash when tapped: press 0.08s, hold to 0.2s, damped wobble out to 0.9s.
const squash = (t, p) => { if (t < 0 || t > 0.9) return 0; const u = 0.3 + 0.7 * Math.max(0, Math.min(1, p)); if (t < 0.08) return u * Math.sin(t / 0.08 * Math.PI / 2); if (t < 0.2) return u; const s = (t - 0.2) / 0.7; return u * Math.exp(-4 * s) * Math.cos(8.5 * s) * (1 - s); };
const TAP_DELAY = 0.1, CHARGE_S = 1.5, MIN_P = 0.05;
const holdPower = p => MIN_P + (1 - MIN_P) * p;
// Slingshot: screen drag length sets power, so short pulls are soft and long pulls are hard. Full power at a third of the screen height.
const slingPower = px => Math.max(MIN_P, Math.min(1, px / Math.max(150, innerHeight * 0.33)));
const CAMS = ['behind', 'third', 'top', 'tv'], camLabel = c => T('cam_' + c);
if (!CAMS.includes(S.cam)) S.cam = S.cam === 'top' ? 'top' : 'third';

// ── world ──────────────────────────────────────────────────
const world = new World($('#scene'));
const ray = new THREE.Raycaster(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), v3 = new THREE.Vector3();
let M = null; // current match
let menuSpin = 0;

function looksFor(paperIds) { return paperIds.map(id => { const it = itemById(id) || itemById('p_a4'); return { ...it.look, rarity: it.rarity }; }); }
// Star player skins per team: { slot: itemId } -> { slot: look }. Unknown ids are ignored.
const starLooks = st => Object.fromEntries(Object.entries(st || {}).map(([k, id]) => [k, itemById(id)]).filter(([, it]) => it?.slot === 'star').map(([k, it]) => [k, { ...it.look, rarity: it.rarity }]));
function pickKits(t0, t1, k0 = 0) {
  const kit0 = t0.jerseys[k0] || t0.jerseys[0];
  const dist = (a, b) => { const p = x => parseInt(x.slice(1), 16), A = p(a), B = p(b); return Math.hypot((A >> 16) - (B >> 16), ((A >> 8) & 255) - ((B >> 8) & 255), (A & 255) - (B & 255)); };
  const kit1 = [...t1.jerseys].sort((a, b) => dist(b.base, kit0.base) - dist(a.base, kit0.base))[0];
  const gk1 = t1.keeper.find(k => dist(k.base, kit0.base) > 90 && dist(k.base, kit1.base) > 90) || t1.keeper[1] || t1.keeper[0];
  return { kits: [kit0, kit1], keepers: [t0.keeper[0], gk1] };
}

function stageWorld(setup, paperIds, equip) {
  const t0 = teamById(setup.teams[0]), t1 = teamById(setup.teams[1]);
  const kitObj = (team, id, i) => id === 'custom' ? (setup.custom?.[i] || cleanKit(mySquad().kit)) : team.jerseys.find(j => j.id === id);
  const auto = pickKits(t0, t1, Math.max(0, t0.jerseys.findIndex(j => j.id === setup.kits[0])));
  const kits = [kitObj(t0, setup.kits[0], 0) || auto.kits[0], kitObj(t1, setup.kits[1], 1) || auto.kits[1]];
  world.setPitch(itemById(equip.pitch)?.look || itemById('f_stripes').look);
  if (world.venueId !== equip.venue) world.setVenue(equip.venue);
  world.setBall(itemById(equip.ball)?.look || itemById('b_classic').look);
  return { teams: [t0, t1], kits, keepers: auto.keepers, looks: looksFor(paperIds), stars: (setup.stars || []).map(starLooks) };
}

// ── match lifecycle ────────────────────────────────────────
function startMatch({ setup, mode, seat = 0, mid = null, paperIds, names }) {
  closeAllOverlays();
  const e = new Engine(setup);
  const art = stageWorld(setup, paperIds, { ...P.equip, ...(setup.home || {}) }); // home side's venue, pitch and ball for everyone
  world.setTeams(e, art.teams, art.kits, art.looks, art.keepers, art.stars);
  M = { e, setup, mode, seat, mid, art, names: names || [art.teams[0].short, art.teams[1].short], actions: [], shot: 0, ps: false, goals: [], tape: [],
    aim: null, cpuWait: 0, turnLeft: null, turnDeadline: 0, halfWait: 0, lastMsg: 0, shake: 0, pending: null, over: false, paused: false,
    camYaw: 0, camMode: S.cam, zoom: 1, goalCam: 0, slow: 1, kickoffHint: true };
  world.pieces.forEach(p => { p.x = p.data.x; p.z = p.data.z; p.drop = p.rank >= 4 ? 1.2 + p.data.id * 0.05 : 0; });
  $('#menu').hidden = true; $('#hud').hidden = false; document.body.classList.add('playing');
  buildHud(); onTurnStart(); SFX.whistle(false);
  setTimeout(() => { if (M && S.hints) toast(T(S.ctrl === 'sling' ? 'hint_sling' : 'hint_hold'), 5200); }, setup.coin ? 4000 : 600);
}
const humanTurn = () => M && !M.over && !M.queued && M.e.phase === 'aim' && !M.e.needPick && (M.mode === 'local' || (M.mode === 'cpu' && M.e.turnTeam === 0) || (M.mode === 'online' && M.e.turnTeam === M.seat && !M.pending && !M.sent));
const myTeam = () => M.mode === 'online' ? M.seat : M.mode === 'local' ? M.e.turnTeam : 0;

function onTurnStart() {
  const e = M.e; M.shot = 0; M.ps = false; M.aim = null; M.sent = false; M.cpuWait = 0.9 + Math.random() * 0.4; M.camYaw = 0;
  if (M.mode !== 'online') { M.turnLeft = 15; }
  updateShotChips(); updatePlayerCard(); keeperPicker();
  if (e.phase === 'aim' && e.canPowerStrike() && humanTurn()) { SFX.ignite(); toast(T('power_ready'), 3000); }
}

function startTap(a) {
  const k = M.e.kicker; if (a.t !== 'aim' || !k) return;
  const vp = world.pieces[k.id]; vp.flipT = 0; vp.tapPower = a.ps ? 1 : a.power;
  world.tapFx(k.x - a.dx * 0.35, k.z - a.dz * 0.35, vp.rank, vp.color); SFX.tap(a.power); if (vp.rank >= 3) SFX.tapLegend(vp.rank); haptic(a.ps ? 'heavy' : 'medium');
}
function act(a) {
  if (!M || M.queued) return;
  world.showAim(null); M.cpuPlan = null;
  if (M.mode === 'online') { if (M.sent) return; M.sent = true; startTap(a); M.ws?.send(JSON.stringify({ t: 'act', a })); return; }
  if (a.t !== 'aim') { if (M.e._applyAction(a)) M.actions.push(a); return; }
  startTap(a); M.queued = { a, t: TAP_DELAY };
}

function drainEvents() {
  const e = M.e;
  for (const ev of e.events) {
    if (ev.type === 'kick') { if (ev.ps) { M.shake = 0.5; world.burst(e.ball.x, 0.3, e.ball.z, ['#ff7a1a', '#ffd45a', '#ff3a1a'], 40, 4, 5, 0.07); } }
    else if (ev.type === 'hit') { SFX.hit(ev.v); world.pieces[ev.id].hop = Math.min(1, 0.3 + ev.v * 0.06); }
    else if (ev.type === 'post') { SFX.post(); M.shake = 0.35; haptic('rigid'); flash(T('post')); }
    else if (ev.type === 'bounce') SFX.bounce(ev.v);
    else if (ev.type === 'whistle') SFX.whistle(ev.long);
    else if (ev.type === 'goal') {
      SFX.goal(); notify('success'); M.shake = 0.7; world.cheer = 3; M.goalCam = 2.2;
      const k = M.art.kits[ev.team], mine = ev.team === myTeam() && M.mode !== 'local', set = mine ? completeSet(P.equip) : null, rank = mine ? (RARITY[itemById(P.equip.paper)?.rarity]?.rank || 0) : 0;
      world.goalFx(mine ? P.equip.fx : 'x_basic', e.ball.x, e.ball.z, [k.base, k.accent], set?.setFx, rank); if (rank >= 4) SFX.goalMyth();
      M.goalAt = { team: ev.team, sid: e.lastTapper?.id ?? -1, own: !!e.lastGoal?.own, who: e.lastGoal?.own ? T('own_goal') : e.lastGoal?.name ? `#${e.lastGoal.number} ${e.lastGoal.name}` : M.names[ev.team], score: [...e.score], fx: mine ? P.equip.fx : 'x_basic', colors: [k.base, k.accent], set: set?.setFx, rank, t: 0 };
    }
    else if (ev.type === 'turn') M.turnFlag = true;
    else if (ev.type === 'blast') { const vp = world.pieces[ev.id]; vp.hop = 1; SFX.post(); haptic('heavy'); world.burst(vp.x, 0.4, vp.z, ['#ff7a1a', '#ffd45a', '#ffffff'], 18, 4, 6, 0.06); }
    else if (ev.type === 'woodwork') { SFX.post(); M.shake = 0.9; haptic('rigid'); world.burst(e.ball.x, 0.6, ev.s * FIELD.L / 2, ['#ffffff', '#ffd45a', '#ff7a1a'], 50, 6, 6, 0.08); }
    else if (ev.type === 'lineup') { world.setTeams(e, M.art.teams, M.art.kits, M.art.looks, M.art.keepers, M.art.stars); world.pieces.forEach(p => { p.x = p.data.x; p.z = p.data.z; p.drop = 0; }); M.prevP = null; updatePlayerCard(); }
    else if (ev.type === 'keep') keeperPicker();
  }
  e.events.length = 0;
}

function tick(dt) {
  const e = M.e;
  if (M.paused) return;
  const sim = dt * M.slow;
  // drive non-human turns
  if (e.phase === 'aim' && !M.over) {
    if (M.mode === 'cpu' && e.turnTeam === 1 && !M.queued && !e.needPick) {
      M.cpuWait -= dt;
      if (M.cpuWait <= 0.6 && !M.cpuPlan) M.cpuPlan = e.cpuAction(); // same RNG draw the server replay makes
      if (M.cpuPlan && M.cpuWait <= 0) act(M.cpuPlan);
    }
    else if (M.mode !== 'online' && M.turnLeft !== null && !e.needPick) { M.turnLeft -= dt; if (M.turnLeft <= 0) { beacon({ timeout: true, downs: M.downs || 0, held: !!M.hold, q: !!M.queued, phase: e.phase, w: innerWidth, h: innerHeight }); act({ t: 'skip' }); } }
  }
  if (M.queued && (M.queued.t -= dt) <= 0) { const a = M.queued.a; M.queued = null; if (e._applyAction(a)) M.actions.push(a); else beacon({ rejected: a, phase: e.phase, kicker: e.kicker?.id }); }
  if (e.phase === 'halftime' && M.mode !== 'online') { M.halfWait += dt; if (M.halfWait > 2.6) { M.halfWait = 0; act({ t: 'half' }); } }
  e.acc += sim;
  let n = 0; while (e.acc >= STEP && n++ < 8) { snapPrev(e); e.step(STEP); e.acc -= STEP; }
  M.alpha = Math.min(1, e.acc / STEP);
  drainEvents();
  if (M.pending && isRest(e)) { e.importState(M.pending); M.pending = null; M.turnFlag = true; }
  recordFrame(e);
  if (M.turnFlag && e.phase === 'aim') { M.turnFlag = false; onTurnStart(); }
  if (e.phase === 'over' && !M.over) finishMatch();
  if (e.message && e.message.id !== M.lastMsg) { M.lastMsg = e.message.id; banner(e.message); }
  M.slow = M.goalCam > 0 ? 0.45 : 1; if (M.goalCam > 0) M.goalCam -= dt;
}

// ── visual sync + camera ───────────────────────────────────
// Render between the last two physics steps so motion is smooth on 90/120Hz screens and uneven frames.
function snapPrev(e) { M.prevB = [e.ball.x, e.ball.y, e.ball.z]; M.prevP = e.pieces.map(p => [p.x, p.z]); }
const lerpN = (a, b, t) => a + (b - a) * t;
function syncVisuals(dt, t) {
  const e = M.e, k = 1 - Math.exp(-dt * 14);
  for (const vp of world.pieces) {
    const p = vp.data, pp = M.prevP?.[p.id], al = M.alpha ?? 1, tx = pp ? lerpN(pp[0], p.x, al) : p.x, tz = pp ? lerpN(pp[1], p.z, al) : p.z;
    const jump = Math.hypot(tx - vp.x, tz - vp.z) > 1.5; vp.x = jump ? tx : vp.x + (tx - vp.x) * Math.min(1, k * 2.2); vp.z = jump ? tz : vp.z + (tz - vp.z) * Math.min(1, k * 2.2);
    const facing = Math.atan2(0, e.attackSign(p.team)); // front faces the goal it attacks
    const lift = Math.sin(Math.min(1, vp.hop) * Math.PI) * 0.25; vp.hop = Math.max(0, vp.hop - dt * 3);
    vp.flipT = (vp.flipT ?? 9) + dt; const sq = squash(vp.flipT, vp.tapPower ?? 0.5);
    vp.body.scale.set(1 + sq * 0.12, Math.max(0.2, 1 - sq * 0.7), 1 + sq * 0.9);
    let dropY = 0; if (vp.drop > 0) { vp.drop = Math.max(0, vp.drop - dt); const u = Math.min(1, vp.drop / 0.9); dropY = u * u * 6; if (vp.drop === 0) { world.ripple(vp.x, vp.z, vp.color); world.burst(vp.x, 0.3, vp.z, [vp.color, '#ffffff'], 6, 2.5, 8, 0.06, true); } }
    vp.root.position.set(vp.x, lift + dropY, vp.z);
    vp.fall = (vp.fall || 0) + ((p.down ? 1 : 0) - (vp.fall || 0)) * Math.min(1, dt * 9);
    vp.root.rotation.set(Math.sin(t * 30 + p.id) * p.wobble * 0.18 - vp.fall * 1.45 * e.attackSign(p.team), (e.attackSign(p.team) > 0 ? 0 : Math.PI), Math.sin(t * 26 + p.id) * p.wobble * 0.12);
    const active = p === e.kicker && e.phase === 'aim';
    vp.ring.material.opacity += ((active ? 0.95 : 0) - vp.ring.material.opacity) * k;
    vp.ring.scale.setScalar(1 + (active ? Math.sin(t * 5) * 0.06 : 0));
    if (active && p.charge >= POWER_CHARGE) vp.ring.material.color.set(0xff6b1a); else vp.ring.material.color.set(0x16e0ff);
  }
  const b = e.ball, pb = M.prevB, al = M.alpha ?? 1; world.ballMesh.position.set(pb ? lerpN(pb[0], b.x, al) : b.x, (pb ? lerpN(pb[1], b.y, al) : b.y) + 0.16, pb ? lerpN(pb[2], b.z, al) : b.z);
  const cue = humanTurn() && !M.aim; world.ballRing.position.set(b.x, 0.015, b.z);
  if (M.hold && humanTurn()) {
    if (M.hold.mode === 'hold') { M.hold.p = Math.min(1, (performance.now() - M.hold.t0) / 1000 / CHARGE_S); M.aim = { ...(M.hold.dragged ? M.aim : goalDir()), power: holdPower(M.hold.p) }; }
    const q = Math.floor((M.aim?.power ?? 0) * 4 + 0.001); if (q > (M.hold.q || 0)) { M.hold.q = q; haptic(q >= 4 ? 'heavy' : 'light'); } // tick at 25/50/75/100%
  }
  world.ballRing.material.opacity += ((cue ? 0.9 : 0) - world.ballRing.material.opacity) * k; world.ballRing.scale.setScalar(1 + Math.sin(t * 6) * 0.15);
  const sp = Math.hypot(b.vx, b.vz); if (sp > 0.01) { world.ballMesh.rotation.x += b.vz * dt / 0.16; world.ballMesh.rotation.z -= b.vx * dt / 0.16; }
  if (world.trailLine) {
    const pts = world.trailPts; if (sp > 1) pts.unshift(new THREE.Vector3(b.x, b.y + 0.16, b.z)); else pts.splice(0, 2); if (pts.length > 18) pts.length = 18;
    if (pts.length > 2 && (M.trailN = (M.trailN || 0) + 1) % 2 === 0) { const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 2, 0.07, 6); world.trailLine.geometry.dispose(); world.trailLine.geometry = g; world.trailLine.visible = true; } else if (pts.length <= 2) world.trailLine.visible = false;
  }
  // aim guide
  if (M.cpuPlan && M.cpuPlan.t === 'aim') { const r = Math.min(1, (0.6 - M.cpuWait) / 0.6), a = M.cpuPlan; world.showAim(b, a.dx, a.dz, a.power * r, predictPath(e, a.dx, a.dz, a.power * r, a.shot, a.ps), a.ps); }
  else if (M.aim && humanTurn()) world.showAim(b, M.aim.dx, M.aim.dz, M.aim.power, predictPath(e, M.aim.dx, M.aim.dz, M.aim.power, M.shot, M.ps), M.ps);
  else if (M.ps && humanTurn()) { const s = e.attackSign(e.kicker.team); world.showAim(b, -b.x, s * FIELD.L / 2 - b.z, 1, predictPath(e, 0, 1, 1, 0, true), true); }
  else world.showAim(null);
  updateCamera(dt);
}

function updateCamera(dt) {
  const e = M.e, cam = world.cam, b = world.ballMesh.position, bv = e.ball, portrait = cam.aspect < 1;
  const rolling = e.phase === 'rolling' && Math.hypot(bv.vx, bv.vz) > 1.2, goal = e.phase === 'goal';
  const fov = (portrait ? (cam.aspect < 0.8 ? 58 : 52) : cam.aspect < 1.2 ? 50 : 45) - (goal ? 8 : 0); if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * Math.min(1, 5 * dt); cam.updateProjectionMatrix(); }
  const viewTeam = e.kicks ? e.turnTeam : (M.mode === 'cpu' && e.turnTeam === 1) || (M.mode === 'online' && e.turnTeam !== M.seat) ? myTeam() : e.turnTeam;
  const sign = e.attackSign(viewTeam), z = M.zoom, k0 = e.kicker;
  // yaw orbits every mode around the look point
  const orbit = (pos, look) => { const c = Math.cos(M.camYaw), s2 = Math.sin(M.camYaw), dx = pos.x - look.x, dz = pos.z - look.z; pos.x = look.x + dx * c - dz * s2; pos.z = look.z + dx * s2 + dz * c; pos.y = look.y + (pos.y - look.y) * z; pos.x = look.x + (pos.x - look.x) * z; pos.z = look.z + (pos.z - look.z) * z; return pos; };
  let pos, look, speed = 4.5;
  if (goal) { // broadcast-style side angle on the net, slowed down
    const gs = Math.sign(bv.z) || 1; pos = new THREE.Vector3((b.x >= 0 ? -1 : 1) * 5.5, 2.6, gs * (FIELD.L / 2 - 3.6)); look = new THREE.Vector3(b.x * 0.6, 0.6, gs * (FIELD.L / 2 + 0.3)); speed = 3;
  } else if (M.camMode === 'top') {
    look = new THREE.Vector3(b.x * 0.35, 0, b.z * 0.55 + sign * 1.2); pos = orbit(new THREE.Vector3(look.x, portrait ? 24 : 18, look.z - sign * (portrait ? 6 : 8)), look);
  } else if (M.camMode === 'tv') { // touchline gantry sliding with play
    look = new THREE.Vector3(b.x * 0.4, 0, b.z * 0.8); pos = orbit(new THREE.Vector3(-(FIELD.W / 2 + (portrait ? 10 : 8)), portrait ? 9 : 7, look.z * 0.92), look); speed = rolling ? 3.2 : 4;
  } else if (M.camMode === 'behind') { // high behind your own goal line, tracking the ball
    look = new THREE.Vector3(b.x * 0.5, 0, b.z + sign * 2.5); pos = orbit(new THREE.Vector3(b.x * 0.35, portrait ? 11 : 8.5, b.z - sign * (portrait ? 10.5 : 9)), look); speed = rolling ? 3.5 : 4.5;
  } else { // third person: low behind the kicker, chases the ball while it rolls
    let tx, tz;
    if (rolling) { const sp = Math.hypot(bv.vx, bv.vz); tx = bv.vx / sp; tz = bv.vz / sp; }
    else { const s = e.attackSign(k0 ? k0.team : e.turnTeam), gx = -0.6 * bv.x, gz = s * FIELD.L / 2 - bv.z, l = Math.hypot(gx, gz) || 1; tx = gx / l; tz = gz / l; }
    const d = M.camDir || (M.camDir = new THREE.Vector2(tx, tz)); d.lerp(new THREE.Vector2(tx, tz), 1 - Math.exp(-(rolling ? 2 : 3) * dt)).normalize();
    const ax = k0 && !rolling ? world.pieces[k0.id].x : b.x, az = k0 && !rolling ? world.pieces[k0.id].z : b.z;
    const back = (portrait ? 4.2 : 3.4) * (rolling ? 1.25 : 1), up = (portrait ? 3.7 : 3) * (rolling ? 1.1 : 1);
    look = new THREE.Vector3(b.x + d.x * 1.3, 0, b.z + d.y * 1.3); pos = orbit(new THREE.Vector3(ax - d.x * back, up, az - d.y * back), look);
  }
  if (M.hold && M.hold.mode === 'hold' && !goal) { const f = 1 - 0.08 * M.hold.p; pos.lerp(look, 1 - f); } // slight push-in while charging
  if (!M.hold && !drag && performance.now() - (M.lastLook || 0) > 4000) { M.camYaw *= Math.exp(-3 * dt); M.zoom += (1 - M.zoom) * (1 - Math.exp(-2 * dt)); } // drift back to centre
  const k = 1 - Math.exp(-dt * speed);
  world.camPos.lerp(pos, k); world.camLook.lerp(look, k);
  cam.position.copy(world.camPos); cam.lookAt(world.camLook);
  if (M.shake > 0) { M.shake = Math.max(0, M.shake - dt); const s = M.shake * M.shake * 0.25; cam.translateX((Math.random() - 0.5) * s); cam.translateY((Math.random() - 0.5) * s); }
}

// ── controls ───────────────────────────────────────────────
// Lastik (default): drag back anywhere, pull length = power, release to tap. A tiny drag cancels.
// Tahan: press to charge from 5% to 100% in 1.5s, release any time; dragging while holding steers.
// Off-turn: one finger orbits, two fingers pinch zoom.
const canvas = $('#scene');
let drag = null; const touches = new Map();
function groundAt(x, y) { ray.setFromCamera({ x: (x / innerWidth) * 2 - 1, y: -(y / innerHeight) * 2 + 1 }, world.cam); return ray.ray.intersectPlane(ground, v3) ? v3.clone() : null; }
function ballScreen() { const p = world.ballMesh.position.clone().project(world.cam); return { x: (p.x + 1) / 2 * innerWidth, y: (1 - p.y) / 2 * innerHeight }; }
function screenOf(x, z) { const p = new THREE.Vector3(x, 0.2, z).project(world.cam); return { x: (p.x + 1) / 2 * innerWidth, y: (1 - p.y) / 2 * innerHeight }; }
function goalDir() { const e = M.e, b = e.ball, s = e.attackSign(e.kicker.team), gx = -b.x * 0.85, gz = s * FIELD.L / 2 - b.z, l = Math.hypot(gx, gz) || 1; return { dx: gx / l, dz: gz / l }; }
const pinchDist = () => { const [a, b] = [...touches.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
canvas.addEventListener('pointerdown', ev => {
  audio(); if (!M || M.paused) return;
  M.downs = (M.downs || 0) + 1; touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  canvas.setPointerCapture(ev.pointerId);
  if (touches.size === 2) { if (M.hold) { M.hold = null; M.aim = null; } drag = { kind: 'pinch', d0: pinchDist(), z0: M.zoom }; return; }
  if (humanTurn() && !M.ps && M.e.kicker) {
    const mode = S.ctrl === 'hold' ? 'hold' : 'sling';
    drag = { kind: 'aim', id: ev.pointerId, x: ev.clientX, y: ev.clientY, g: groundAt(ev.clientX, ev.clientY) };
    M.hold = { mode, t0: performance.now(), p: 0, dragged: false, q: 0 }; M.aim = mode === 'hold' ? { ...goalDir(), power: MIN_P } : null; haptic('light');
  } else drag = { kind: 'look', id: ev.pointerId, x: ev.clientX, yaw: M.camYaw };
});
canvas.addEventListener('pointermove', ev => {
  const t = touches.get(ev.pointerId); if (t) { t.x = ev.clientX; t.y = ev.clientY; }
  if (!drag || !M) return;
  if (drag.kind === 'pinch') { if (touches.size === 2) { M.zoom = Math.max(0.6, Math.min(1.6, drag.z0 * drag.d0 / Math.max(30, pinchDist()))); M.lastLook = performance.now(); } return; }
  if (ev.pointerId !== drag.id) return;
  if (drag.kind === 'look') { M.camYaw = drag.yaw - (ev.clientX - drag.x) / innerWidth * 3.2; M.lastLook = performance.now(); return; }
  const px = Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y);
  if (!M.hold || px < 14) { if (M.hold?.mode === 'sling') M.aim = null; return; }
  const g = groundAt(ev.clientX, ev.clientY); if (!g || !drag.g) return;
  const dx = drag.g.x - g.x, dz = drag.g.z - g.z, d = Math.hypot(dx, dz); if (d < 0.03) return;
  M.hold.dragged = true; M.aim = { dx: dx / d, dz: dz / d, power: M.hold.mode === 'sling' ? slingPower(px) : holdPower(M.hold.p) };
});
const endDrag = ev => {
  touches.delete(ev.pointerId);
  if (!drag) return;
  if (drag.kind === 'pinch') { if (touches.size < 2) drag = null; return; }
  if (ev.pointerId !== drag.id) return;
  if (drag.kind === 'aim' && M?.hold && humanTurn()) {
    if (M.hold.mode === 'hold') act({ t: 'aim', dx: M.aim.dx, dz: M.aim.dz, power: holdPower(M.hold.p), shot: M.shot });
    else if (M.aim && ev.type !== 'pointercancel') act({ t: 'aim', dx: M.aim.dx, dz: M.aim.dz, power: M.aim.power, shot: M.shot });
    else if (S.hints) toast(T('pull_more'), 1800);
  }
  if (M) { M.hold = null; M.aim = null; }
  drag = null;
};
canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
addEventListener('keydown', ev => {
  if (!M) return;
  if (ev.key >= '1' && ev.key <= '4') setShot(+ev.key - 1);
  if (ev.key === 'c' || ev.key === 'C') toggleCam();
  if (ev.key === 'Escape') pause();
  if ((ev.key === ' ' || ev.key === 'Enter') && M.ps && humanTurn()) firePower();
});
function setShot(i) { if (!M) return; M.shot = i; updateShotChips(); SFX.ui(); haptic('light'); }
function firePower() { if (!M || !humanTurn() || !M.e.canPowerStrike()) return; act({ t: 'aim', dx: 0, dz: 1, power: 1, shot: 0, ps: true }); }
function toggleCam() { M.camMode = CAMS[(CAMS.indexOf(M.camMode) + 1) % CAMS.length]; M.camYaw = 0; M.zoom = 1; S.cam = M.camMode; saveS(); $('#cam-btn span').textContent = camLabel(M.camMode); SFX.ui(); haptic('light'); }

// ── HUD ────────────────────────────────────────────────────
function crestCanvas(team, size = 34) { const c = document.createElement('canvas'); c.width = c.height = size * 2; crest(c.getContext('2d'), size, size * 0.95, size * 1.5, team); c.className = 'crest'; return c; }
// Kick type icons: ball, dashed flight path, landing spot, and the folded paper players it clears.
const SHOT_ICON = ['<path class="tr" d="M11 20H45"/>', '<path class="pl" d="M25 23L28 14L31 23"/><path class="tr" d="M10 18Q28 2 46 19"/>',
  '<path class="pl" d="M19 23L22 14L25 23M31 23L34 14L37 23"/><path class="tr" d="M10 17Q28 -12 46 18"/>',
  '<path class="pl" d="M27 23L30 14L33 23"/><path class="tr" d="M10 19C18 4 40 2 46 19"/><path class="tr" d="M40 9l5 1-2 5"/>'];
function buildHud() {
  const hud = $('#hud'), [t0, t1] = M.art.teams, [k0, k1] = M.art.kits;
  hud.innerHTML = `
  <div class="sb">
    <div class="sb-clock"><b id="clk">0:00</b><small id="half">${T('half1')}</small></div>
    <div class="sb-team" style="--c:${k0.base};--i:${ink(k0.base)}"><span class="sb-c0"></span><b>${esc(M.names[0]).slice(0, 12)}</b></div>
    <div class="sb-score"><b id="s0">0</b><i></i><b id="s1">0</b></div>
    <div class="sb-team r" style="--c:${k1.base};--i:${ink(k1.base)}"><b>${esc(M.names[1]).slice(0, 12)}</b><span class="sb-c1"></span></div>
  </div>
  <div class="tr">
    <button class="chip ghost" id="form-btn" hidden><svg viewBox="0 0 24 24"><path d="M5 6h2M11 6h2M17 6h2M8 12h2M14 12h2M11 18h2" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg><span id="form-txt"></span></button>
    <button class="chip ghost" id="cam-btn"><svg viewBox="0 0 24 24"><path d="M4 7h3l2-2h6l2 2h3v12H4z M12 10a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7" fill="none" stroke="currentColor" stroke-width="1.8"/></svg><span>${camLabel(M.camMode)}</span></button>
    <button class="chip ghost sq" id="pause-btn" aria-label="${T('pause')}"><svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg></button>
  </div>
  <div class="bottom">
    <div class="shots" id="shots">${SHOT_TYPES.map((s, i) => `<button class="shot" data-i="${i}" aria-label="${T('shot' + i)}: ${T('shot' + i + '_s')}"><svg viewBox="0 0 56 26" aria-hidden="true"><path class="gl" d="M2 23.5H54"/>${SHOT_ICON[i]}<circle class="gh" cx="49" cy="20" r="3.2"/><circle class="bl" cx="7" cy="20" r="3.4"/></svg><b>${T('shot' + i)}</b><small>${T('shot' + i + '_s')}</small><kbd>${i + 1}</kbd></button>`).join('')}</div>
    <div class="pcard" id="pcard"><div class="pc-badge"></div><div class="pc-main"><b id="pc-name"></b><div class="charge" id="charge">${'<i></i>'.repeat(POWER_CHARGE)}</div><small id="pc-state"></small></div><div class="pc-timer" id="pc-timer"><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" class="trk"/><circle cx="20" cy="20" r="17" class="arc" id="arc"/></svg><b id="tl">15</b></div></div>
    <div class="meter" id="meter"><i id="meter-fill"></i><b id="meter-txt">${T('power')}</b></div>
    <button class="power" id="power-btn" hidden>${T('power_shot')}</button>
  </div>
  <div class="keep" id="keep" hidden><b>${T('pen_pick')}</b><div>${['left', 'middle', 'right'].map(k => `<button class="btn" data-k="${k}">${T('pen_' + k)}</button>`).join('')}</div></div>
  <div class="banner" id="banner"><b></b><small></small></div>`;
  const myRank = M.mode === 'local' ? 0 : RARITY[itemById(P.equip.paper)?.rarity]?.rank || 0, myCol = rarityOf(itemById(P.equip.paper)).color;
  hud.style.setProperty('--rc', myCol); hud.dataset.rank = myRank; M.myRank = myRank;
  hud.querySelector('.sb-c0').append(crestCanvas(t0)); hud.querySelector('.sb-c1').append(crestCanvas(t1));
  hud.querySelectorAll('.shot').forEach(b => b.onclick = () => setShot(+b.dataset.i));
  $('#cam-btn').onclick = toggleCam; $('#pause-btn').onclick = pause; $('#power-btn').onclick = firePower; $('#form-btn').onclick = showLineup;
  hud.querySelectorAll('#keep button').forEach(b => b.onclick = () => { $('#keep').hidden = true; SFX.ui(); haptic('medium'); act({ t: 'keep', pick: b.dataset.k }); });
}
function updateShotChips() {
  if (!M) return;
  document.querySelectorAll('.shot').forEach(b => b.classList.toggle('on', +b.dataset.i === M.shot));
  const show = humanTurn(); $('#shots').classList.toggle('dim', !show);
  const fb = $('#form-btn'); if (fb) { fb.hidden = !show || !!M.e.kicks; $('#form-txt').textContent = M.e.opts.formations[M.e.turnTeam]; }
  const pb = $('#power-btn'); if (pb) { const can = show && M.e.canPowerStrike(); pb.hidden = !can; pb.classList.toggle('armed', M.ps); }
}
// Penalties: the human keeper picks a side before the kick (as seen from behind the shooter).
function keeperPicker() {
  const el = $('#keep'); if (!el || !M) return;
  const keeperHuman = M.mode === 'local' || (M.mode === 'cpu' && M.e.turnTeam === 1);
  el.hidden = !(M.e.needPick && keeperHuman && M.e.phase === 'aim');
}
// Mid-game formation: own turn only, the turn clock keeps running.
function showLineup() {
  if (!M || !humanTurn() || M.e.kicks) return;
  const e = M.e, team = e.turnTeam, cur = e.opts.formations[team];
  const o = overlay(`<h2>${T('form_ttl')}</h2><p class="muted">${T('form_note')}</p><div class="form-grid">${Object.keys(FORMATIONS).map(f => `<button class="btn ${f === cur ? 'lime' : ''}" data-f="${f}">${f}</button>`).join('')}</div><button class="btn" id="f-reset">${T('form_reset')}</button><button class="btn ghost" id="f-x">${T('cancel')}</button>`);
  const send = l => { closeAllOverlays(); if (!humanTurn()) return; SFX.ui(); haptic('light'); act({ t: 'lineup', formation: l.formation, order: l.order }); };
  o.querySelectorAll('[data-f]').forEach(b => b.onclick = () => send({ formation: b.dataset.f, order: e.lineup(team).order }));
  o.querySelector('#f-reset').onclick = () => send(e.startLineup(team));
  o.querySelector('#f-x').onclick = closeAllOverlays;
}
function updatePlayerCard() {
  const e = M.e, k = e.kicker; if (!k) return;
  const kit = k.isGK ? M.art.keepers[k.team] : M.art.kits[k.team];
  $('#pcard').style.setProperty('--c', kit.base); $('#pcard').style.setProperty('--i', ink(kit.base));
  $('#pcard .pc-badge').textContent = k.number;
  $('#pc-name').textContent = `${k.name.toUpperCase()}`; $('#pc-name').classList.toggle('rar', k.team === myTeam() && M.myRank >= 1);
  $('#charge').querySelectorAll('i').forEach((el, i) => el.classList.toggle('on', i < k.charge));
  $('#charge').classList.toggle('full', k.charge >= POWER_CHARGE);
  const who = M.mode === 'cpu' ? T(e.turnTeam === 0 ? 'turn_you' : 'turn_ai') : M.mode === 'online' ? T(e.turnTeam === M.seat ? 'turn_you' : 'turn_opp') : T('turn_of', { name: M.names[e.turnTeam] });
  const sp = T({ kickoff: 'sp_kickoff', corner: 'sp_corner', goalkick: 'sp_goalkick', throw: 'sp_throw', penalty: 'sp_penalty' }[e.setPiece] || 'sp_live');
  if (e.kicks) { $('#pc-state').textContent = `${who}  ·  ${e.kicks[0].map(k => k ? '●' : '○').join('')} : ${e.kicks[1].map(k => k ? '●' : '○').join('')}`; $('#pcard').classList.toggle('opp', !humanTurn()); return; }
  $('#pc-state').textContent = `${who}  ·  ${T('taps', { a: Math.min(MAX_TAPS, (e.lastTapTeam === e.turnTeam ? e.tapsInRow : 0) + 1), b: MAX_TAPS })}${e.setPiece && e.setPiece !== 'kickoff' ? '  ·  ' + sp : ''}`;
  $('#pcard').classList.toggle('opp', !humanTurn());
}
function updateHud() {
  const e = M.e, tl = e.timeLeft;
  $('#clk').textContent = tl == null ? '--' : `${Math.floor(tl / 60)}:${String(Math.floor(tl % 60)).padStart(2, '0')}`;
  $('#half').textContent = T(e.half === 1 ? 'half1' : 'half2');
  $('#s0').textContent = e.score[0]; $('#s1').textContent = e.score[1];
  let left = M.mode === 'online' ? Math.max(0, (M.turnDeadline - performance.now()) / 1000) : M.turnLeft;
  const showT = e.phase === 'aim' && left != null && !(M.mode === 'cpu' && e.turnTeam === 1);
  $('#pc-timer').style.visibility = showT ? 'visible' : 'hidden';
  if (showT) { $('#tl').textContent = Math.ceil(Math.min(15, left)); $('#arc').style.strokeDashoffset = 106.8 * (1 - Math.min(1, left / 15)); $('#pc-timer').classList.toggle('low', left < 5); }
  const mt = $('#meter'), p = M.hold ? (M.aim?.power ?? 0) : 0; mt.classList.toggle('on', !!M.hold); $('#meter-fill').style.transform = `scaleX(${p})`; mt.classList.toggle('max', p >= 0.99);
  $('#meter-txt').textContent = M.hold ? (M.aim ? T('power_n', { n: Math.round(p * 100) }) : T(S.ctrl === 'sling' ? 'pull_back' : 'power')) : T('power');
  updateShotChips();
}
let bannerT = 0;
function banner(msg) {
  const b = $('#banner'); if (!b) return;
  b.querySelector('b').textContent = trMs(S.lang, msg.text); b.querySelector('small').textContent = trMs(S.lang, msg.sub || '');
  b.className = 'banner show ' + (msg.kind || ''); clearTimeout(bannerT);
  bannerT = setTimeout(() => b.classList.remove('show'), msg.kind === 'goal' ? 2200 : 1500);
  if (M) updatePlayerCard();
}
function flash(text) { banner({ text, kind: 'set', id: -1 }); }
let toastT = 0;
function toast(text, ms = 2600) { const t = $('#toast'); t.textContent = text; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms); }

// ── pause / over ───────────────────────────────────────────
function overlay(html) { closeAllOverlays(); const o = h(`<div class="ov"><div class="sheet">${html}</div></div>`); document.body.append(o); return o; }
function closeAllOverlays() { document.querySelectorAll('.ov').forEach(o => o.remove()); }
function pause() {
  if (!M || M.over) return; M.paused = M.mode !== 'online';
  const o = overlay(`<h2>${T(M.mode === 'online' ? 'menu' : 'paused')}</h2><button class="btn lime" id="res">${T('resume')}</button><button class="btn" id="cam2">${T('camera', { v: camLabel(M.camMode) })}</button><button class="btn" id="snd">${T('sound', { v: T(S.sound ? 'on' : 'off') })}</button><button class="btn ghost" id="quit">${T(M.mode === 'online' ? 'leave_match' : 'quit_menu')}</button>`);
  o.querySelector('#res').onclick = () => { M.paused = false; o.remove(); };
  o.querySelector('#cam2').onclick = () => { toggleCam(); o.querySelector('#cam2').textContent = T('camera', { v: camLabel(M.camMode) }); };
  o.querySelector('#snd').onclick = () => { S.sound = !S.sound; saveS(); o.querySelector('#snd').textContent = T('sound', { v: T(S.sound ? 'on' : 'off') }); };
  o.querySelector('#quit').onclick = () => { quitMatch(); };
}
function quitMatch() { if (M?.ws) { M.closing = true; M.ws.close(); } M = null; closeAllOverlays(); $('#hud').hidden = true; document.body.classList.remove('playing'); showHome(); }

async function finishMatch() {
  M.over = true; const e = M.e, my = myTeam();
  const won = e.winner === my, draw = e.winner === null;
  setTimeout(async () => {
    if (!M || M.replaying) return;
    const title = M.mode === 'local' ? (draw ? T('draw') : T('x_wins', { name: esc(M.names[e.winner]) })) : T(draw ? 'draw' : won ? 'win' : 'lose');
    const o = overlay(`<div class="res ${won ? 'win' : draw ? 'draw' : 'lose'}"><small>${T('fulltime')}</small><h2>${title}</h2>
      <div class="final"><span>${esc(M.names[0])}</span><b>${e.score[0]}</b><i>:</i><b>${e.score[1]}</b><span>${esc(M.names[1])}</span></div>
      <div class="reward" id="reward">${M.mode === 'cpu' ? T(P.guest ? 'reward_guest' : 'reward_wait') : M.mode === 'online' && M.forfeit ? T('opp_left') : ''}</div>${rankLine(M.rank)}${M.league?.counted ? `<p class="rk-nc">🏆 ${T('lg_counted')}</p>` : M.league ? `<p class="rk-nc">${T(M.league.why === 'pair' ? 'rk_nc_pair' : M.league.why === 'short' ? 'rk_nc_short' : 'rk_nc')}</p>` : ''}</div>
      ${M.goals.length ? `<div class="rp-row"><button class="btn" id="rp-watch">▶ ${T('rp_watch')}</button><button class="btn" id="rp-poster">🖼 ${T('rp_poster')}</button></div>` : ''}
      <button class="btn lime" id="again">${T(M.mode === 'online' ? 'rematch' : 'play_again')}</button><button class="btn" id="shop2">${T('locker_btn')}</button><button class="btn ghost" id="home">${T('main_menu')}</button>`);
    o.querySelector('#home').onclick = quitMatch;
    o.querySelector('#rp-watch')?.addEventListener('click', () => playReplays(M.goals.length - 1));
    o.querySelector('#rp-poster')?.addEventListener('click', () => sharePoster(M.goals.at(-1)));
    o.querySelector('#shop2').onclick = () => { quitMatch(); showShop(); };
    o.querySelector('#again').onclick = () => {
      if (M.mode === 'online') { M.ws?.send(JSON.stringify({ t: 'rematch' })); o.querySelector('#again').textContent = T('waiting_opp'); o.querySelector('#again').disabled = true; }
      else if (M.mode === 'cpu') { const d = M.setup.drill; M = null; beginCpu(d); } else { beginLocal(); }
    };
    if (M.rewardHtml) $('#reward').innerHTML = M.rewardHtml; // back from a replay: never claim twice
    else if (M.mode === 'cpu' && M.mid) {
      try { const r = await api('/api/match/finish', { mid: M.mid, actions: M.actions }); P = { ...r.profile, guest: false }; updateCoins();
        $('#reward').innerHTML = M.rewardHtml = `<span class="coin"></span> ${T('reward_got', { n: r.reward })}${r.capped ? ` <small>${T('cap_hit')}</small>` : ''}`; if (r.reward) SFX.buy(); }
      catch (err) { $('#reward').textContent = T('reward_fail'); }
    }
  }, 1600);
}

// ── ranked ─────────────────────────────────────────────────
const roman = d => ['', 'I', 'II', 'III'][d] || '';
const tierName = (id, div) => `${T('t_' + id)}${div ? ' ' + roman(div) : ''}`;
function rankLine(r) {
  if (!r) return '';
  if (!r.counted) return `<p class="rk-nc">${T(r.why === 'short' ? 'rk_nc_short' : r.why === 'pair' ? 'rk_nc_pair' : 'rk_nc')}</p>`;
  const up = tierOf(r.rp).index > tierOf(r.before).index;
  return `<div class="rk-res ${r.delta >= 0 ? 'up' : 'down'}" style="--tc:${tierOf(r.rp).color}"><b>${T(r.delta >= 0 ? 'rk_gain' : 'rk_loss', { n: r.delta })}</b><span>${up ? `${T('rk_up')} ` : ''}${tierName(r.tier, r.div)}  ·  ${T('rk_rp', { n: num(r.rp) })}</span></div>`;
}
async function showRanked(tab = 'season') {
  const m = screen(`${header(true)}<main class="ranked"><div class="seg2 seg3"><button class="on">🏆 ${T('ranked')}</button><button id="to-ol">⭐ ${T('ol')}</button><button id="to-lg">👥 ${T('lg')}</button></div><div id="rk-card" class="rk-card"><div class="spinner"></div></div>
    <button class="play" id="rk-go"><b>${T('rk_play')}</b><svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z" fill="currentColor" stroke-linejoin="round"/></svg></button>
    <p class="rk-fair">⚖️ ${T('rk_fair')}</p>
    <h3 class="rk-h">${T('rk_board')}</h3><div class="tabs rk-tabs">${['week', 'season', 'all'].map(k => `<button class="tab ${k === tab ? 'on' : ''}" data-t="${k}">${T('rk_' + k)}</button>`).join('')}</div>
    <div id="rk-list" class="rk-list"></div><p class="rk-fair">🎁 ${T('rk_reward')}</p></main>${navBar('rank')}`, 'm-home');
  bindHeader(m); bindNav(m);
  m.querySelector('#rk-go').onclick = () => { SFX.ui(); if (P.guest) return toast(T('rk_guest')); findMatch(true); };
  m.querySelector('#to-lg').onclick = () => { SFX.ui(); showLeagues(); };
  m.querySelector('#to-ol').onclick = () => { SFX.ui(); showOfficial(); };
  m.querySelectorAll('.rk-tabs .tab').forEach(b => b.onclick = () => { SFX.ui(); showRanked(b.dataset.t); });
  if (P.guest) { m.querySelector('#rk-card').innerHTML = `<p class="muted">${T('rk_guest')}</p>`; m.querySelector('#rk-list').innerHTML = ''; return; }
  let r; try { r = await api('/api/rank', { tab }); } catch { m.querySelector('#rk-card').innerHTML = `<p class="muted">${T('no_server')}</p>`; return; }
  if (!m.isConnected) return;
  const me = r.mine, t = tierOf(me.rp), nxt = TIERS[t.index + 1], days = Math.max(0, Math.ceil((me.ends - Date.now()) / 864e5));
  const lo = t.rp, hi = nxt ? nxt.rp : t.rp, pct = nxt ? Math.round((me.rp - lo) / (hi - lo) * 100) : 100;
  m.querySelector('#rk-card').innerHTML = `<div class="rk-top" style="--tc:${t.color}"><div class="rk-medal"><i>${t.index + 1}</i></div><div><small>${T('rk_season_n', { n: me.season })}  ·  ${T('rk_ends', { d: days })}</small>
    <b>${tierName(me.tier, me.div)}</b><span>${T('rk_rp', { n: num(me.rp) })}  ·  ${T('rk_wld', { w: me.w, d: me.d, l: me.l })}</span></div></div>
    <div class="rk-bar"><i style="width:${pct}%;background:${t.color}"></i></div><small class="rk-nx">${nxt ? T('rk_next', { n: hi - me.rp, t: T('t_' + nxt.id) }) : T('rk_top')}</small>`;
  const col = T('rk_col_' + tab), rows = r.rows.map(x => `<li class="${x.me ? 'me' : ''} ${x.pos <= 3 ? 'p' + x.pos : ''}"><em>${x.pos}</em>${avatar(x.name, x.photo)}<b>${esc(x.name)}${x.pro ? ' <i class="pro-b">PRO</i>' : ''}${x.me ? ` <i>${T('rk_you')}</i>` : ''}</b>${x.tier ? `<span class="tchip" style="--tc:${TIERS.find(z => z.id === x.tier).color}">${T('t_' + x.tier)}</span>` : ''}<strong>${num(x.score)}</strong></li>`).join('');
  const mine = r.me && !r.rows.some(x => x.me) ? `<li class="me sticky"><em>${num(r.me.pos)}</em>${avatar(myName(), myPhoto())}<b>${T('rk_you')}</b><strong>${num(r.me.score)}</strong></li>` : '';
  m.querySelector('#rk-list').innerHTML = `<div class="rk-hd"><span>${tab === 'week' ? T('rk_week_reset') : ''}</span><span>${col}</span></div><ol>${rows || `<li class="empty">${T('rk_empty')}</li>`}${mine}</ol>`;
}

// ── official league ────────────────────────────────────────
const dur = ms => { const m = Math.max(0, Math.round(ms / 60e3)), h = Math.floor(m / 60); return h ? `${h}j ${m % 60}m`.replace('j', S.lang === 'en' ? 'h' : S.lang === 'ru' ? 'ч' : 'j').replace('m', S.lang === 'ru' ? 'м' : 'm') : `${m}${S.lang === 'ru' ? 'м' : 'm'}`; };
async function showOfficial() {
  const m = screen(`${header(true)}<main class="ranked"><div class="seg2 seg3"><button id="to-rk">🏆 ${T('ranked')}</button><button class="on">⭐ ${T('ol')}</button><button id="to-lg">👥 ${T('lg')}</button></div><div id="ol-body"><div class="spinner"></div></div></main>`);
  bindHeader(m);
  m.querySelector('#to-rk').onclick = () => { SFX.ui(); showRanked(); };
  m.querySelector('#to-lg').onclick = () => { SFX.ui(); showLeagues(); };
  let st; try { st = P.guest ? null : await api('/api/official', { op: 'status' }); } catch { st = null; }
  if (!m.isConnected) return;
  const body = m.querySelector('#ol-body'), pr = st?.prize || [3000, 1500, 1000, 500], ly = st?.loyal || { games: 20, coins: 300 };
  const prizes = `<h3 class="rk-h">🏆 ${T('ol_prizes')}</h3><div class="ol-prizes"><div class="ol-p1"><span class="ol-ball" id="ol-ball"></span><b>${T('ol_p1', { c: num(pr[0]) })}</b></div><p>🥈🥉 ${T('ol_p2', { a: num(pr[1]), b: num(pr[2]) })}</p><p>🎖 ${T('ol_p3', { c: num(pr[3]) })}</p><p>🎁 ${T('ol_p4', { g: ly.games, c: num(ly.coins) })}</p></div>`;
  const rules = `<h3 class="rk-h">📋 ${T('ol_rules')}</h3><ol class="ol-rules">${[1, 2, 3, 4, 5].map(i => `<li>${T('ol_r' + i)}</li>`).join('')}</ol>`;
  const hero = `<div class="ol-hero"><small>${T('rk_season_n', { n: st?.season || 1 })}</small><h2>${T('ol_title')}</h2><p>${T('ol_sub')}</p></div>`;
  if (!st) { body.innerHTML = hero + `<p class="rk-fair">${T('rk_guest')}</p>` + prizes + rules; return paintBall(); }
  let main = '';
  if (!st.started) {
    const pct = Math.min(100, Math.round(st.count / st.min * 100));
    main = `<div class="rk-card ol-wait"><b>${T('ol_wait', { min: st.min })}</b><div class="rk-bar"><i style="width:${pct}%;background:var(--yel)"></i></div><small class="rk-nx">${T('ol_count', { n: st.count, min: st.min })}</small>
      ${st.me ? `<p class="ol-ok">✅ ${T('ol_joined')}</p>` : `<button class="play" id="ol-join"><b>${T('ol_join')}</b></button>`}
      <button class="btn lime" id="ol-share">📨 ${T('ol_invite')}</button></div>`;
  } else if (!st.me) {
    main = `<div class="rk-card"><button class="play" id="ol-join"><b>${T('ol_join')}</b></button><p class="muted">${T('ol_r1')}</p></div>`;
  } else {
    const mt = st.match, left = st.nextAt - Date.now();
    const state = st.me.out ? `<p class="ol-bad">${T('ol_out')}</p>`
      : mt?.room ? `<p class="ol-vs">${T('ol_vs', { name: esc(mt.opp) })}</p><button class="play hot" id="ol-enter"><b>${T('ol_enter')}</b></button>`
      : mt?.bye ? `<p class="ol-vs">😴 ${T('ol_bye')}</p>`
      : mt?.state === 'done' ? `<p class="ol-vs">${T('ol_done', { a: mt.mine[0] ?? 0, b: mt.mine[1] ?? 0 })}</p>`
      : `<p class="ol-vs">${mt?.opp ? T('ol_vs', { name: esc(mt.opp) }) : T('ol_tbd')}</p><p class="muted">${T('ol_hint')}</p>`;
    main = `<div class="rk-card ol-next"><small>${T('ol_next')}</small><b class="ol-clock" id="ol-clock">${mt?.room ? '🟢 LIVE' : left > 0 ? T('ol_in', { t: dur(left) }) : '21:00'}</b>${state}</div>`;
  }
  const div = st.me?.div || 0, rows = st.table.map(r => `<li class="${r.me ? 'me' : ''} ${r.pos <= 3 && r.p ? 'p' + r.pos : ''} ${r.out ? 'out' : ''}"><em>${r.pos}</em>${avatar(r.name, r.photo)}<b>${esc(r.name)}${r.pro ? ' <i class="pro-b">PRO</i>' : ''}${r.me ? ` <i>${T('rk_you')}</i>` : ''}</b><span class="lg-n">${r.p}</span><span class="lg-n">${r.w}</span><span class="lg-n">${r.d}</span><span class="lg-n">${r.l}</span><span class="lg-n">${r.gd > 0 ? '+' : ''}${r.gd}</span><strong>${r.pts}</strong></li>`).join('');
  const table = st.started ? `<h3 class="rk-h">${T('ol_table')}  ·  ${div ? T('ol_div', { n: div }) : T('ol_super')}</h3><div class="rk-list lg-table"><div class="rk-hd"><span></span><span class="lg-cols-h">${T('lg_cols').split('  ').map(c => `<i>${c}</i>`).join('')}</span></div><ol>${rows}</ol><p class="lg-legend">${T('lg_legend')}</p></div>` : '';
  body.innerHTML = hero + main + table + prizes + rules;
  paintBall();
  body.querySelector('#ol-join')?.addEventListener('click', async () => {
    SFX.ui();
    try { await new Promise(ok => tg?.requestWriteAccess ? tg.requestWriteAccess(() => ok()) : ok()); } catch {}
    try { await api('/api/official', { op: 'join', lang: S.lang }); notify('success'); showOfficial(); } catch { toast(T('oops')); }
  });
  body.querySelector('#ol-enter')?.addEventListener('click', () => { SFX.ui(); joinRoom(st.match.room); });
  body.querySelector('#ol-share')?.addEventListener('click', () => { const link = 'https://t.me/BolaKertasBot?start=official', text = T('ol_share');
    if (tg?.openTelegramLink) tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`); else navigator.clipboard?.writeText(link).then(() => toast(T('link_copied'))); });
  function paintBall() { L3.thumbs([itemById('b_champion')], artCtx(), (id, u) => paint(m.querySelector('#ol-ball'), u)).catch(() => {}); }
}

// ── friend leagues ─────────────────────────────────────────
const lgErr = e => T({ name: 'lg_err_name', limit: proOn() ? 'lg_err_limit_pro' : 'lg_err_limit', full: 'lg_err_full', no_league: 'lg_err_none' }[e] || 'oops');
async function lgApi(body) { const r = await fetch('/api/league', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Init-Data': initData }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw j.err || 'oops'; return j; }
async function joinLeagueCode(code, by = 0) {
  if (P.guest) return toast(T('rk_guest'));
  try { const r = await lgApi({ op: 'join', code, by }); const t = await lgApi({ op: 'get', id: r.id }); notify('success'); toast(T('lg_joined', { name: t.name }), 3500); showLeague(r.id); }
  catch (e) { toast(lgErr(e)); }
}
async function showLeagues() {
  const m = screen(`${header(true)}<main class="ranked"><div class="seg2 seg3"><button id="to-rk">🏆 ${T('ranked')}</button><button id="to-ol">⭐ ${T('ol')}</button><button class="on">👥 ${T('lg')}</button></div>
    <h3 class="rk-h">${T('lg_mine')}</h3><div id="lg-list" class="lg-list"><div class="spinner"></div></div>
    <button class="play" id="lg-new"><b>${T('lg_new')}</b></button>
    <div class="join"><input id="lg-code" maxlength="6" placeholder="${T('lg_join')}" autocomplete="off"><button class="btn lime" id="lg-join">${T('join')}</button></div>
    <p class="rk-fair">🎁 ${T('lg_reward', { n: 100 })}</p></main>`);
  bindHeader(m);
  m.querySelector('#to-rk').onclick = () => { SFX.ui(); showRanked(); };
  m.querySelector('#to-ol').onclick = () => { SFX.ui(); showOfficial(); };
  const inp = m.querySelector('#lg-code'); inp.oninput = () => inp.value = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  m.querySelector('#lg-join').onclick = () => inp.value.length === 6 ? joinLeagueCode(inp.value) : toast(T('lg_err_none'));
  m.querySelector('#lg-new').onclick = () => { SFX.ui(); if (P.guest) return toast(T('rk_guest')); newLeagueSheet(); };
  if (P.guest) { m.querySelector('#lg-list').innerHTML = `<p class="muted lg-empty">${T('rk_guest')}</p>`; return; }
  let r; try { r = await lgApi({ op: 'list' }); } catch { m.querySelector('#lg-list').innerHTML = `<p class="muted lg-empty">${T('no_server')}</p>`; return; }
  if (!m.isConnected) return;
  m.querySelector('#lg-list').innerHTML = r.leagues.length ? r.leagues.map(l => `<button class="lg-row" data-id="${l.id}" style="--lc:${l.color}"><span class="lg-badge">${esc(l.name[0] || '?')}</span><span class="mt"><b>${esc(l.name)}</b><small>${T('lg_members', { n: l.n, m: r.free.members })}${l.own ? '  ·  ' + T('lg_owner') : ''}</small></span><span class="go"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg></span></button>`).join('') : `<p class="muted lg-empty">${T('lg_none')}</p>`;
  m.querySelectorAll('.lg-row').forEach(b => b.onclick = () => { SFX.ui(); showLeague(+b.dataset.id); });
  if (!r.pro) { const up = document.createElement('button'); up.className = 'lg-pro'; up.innerHTML = `<i class="pro-b">PRO</i> ${T('lg_go_pro')}`; up.onclick = () => showShop('pass'); m.querySelector('#lg-list').after(up); }
  window.__lgColors = r.colors;
}
function newLeagueSheet() {
  const cols = window.__lgColors || ['#4fb3ff', '#ff5d73', '#3fd1a2', '#ffc93c', '#9d85ff', '#ff9f66']; let col = cols[0];
  const o = overlay(`<h2>${T('lg_new').replace('+ ', '')}</h2><label class="lg-f">${T('lg_name')}<input id="lg-n" maxlength="24" autocomplete="off"></label>
    <label class="lg-f">${T('lg_color')}<div class="lg-cols">${cols.map((c, i) => `<button class="${i ? '' : 'on'}" data-c="${c}" style="background:${c}"></button>`).join('')}</div></label>
    <button class="btn lime" id="lg-ok">${T('lg_create')}</button><button class="btn ghost" id="lg-cx">${T('cancel')}</button>`);
  o.querySelectorAll('.lg-cols button').forEach(b => b.onclick = () => { col = b.dataset.c; o.querySelectorAll('.lg-cols button').forEach(x => x.classList.toggle('on', x === b)); });
  o.querySelector('#lg-cx').onclick = closeAllOverlays;
  o.querySelector('#lg-ok').onclick = async () => { try { const r = await lgApi({ op: 'create', name: o.querySelector('#lg-n').value, color: col }); closeAllOverlays(); notify('success'); showLeague(r.id); } catch (e) { toast(lgErr(e)); } };
  setTimeout(() => o.querySelector('#lg-n').focus(), 100);
}
async function showLeague(id) {
  const m = screen(`${header(true)}<main class="ranked"><div id="lg-body"><div class="spinner"></div></div></main>`); bindHeader(m, showLeagues);
  let t; try { t = await lgApi({ op: 'get', id }); } catch (e) { toast(lgErr(e)); return showLeagues(); }
  if (!m.isConnected) return;
  const days = Math.max(0, Math.ceil((t.ends - Date.now()) / 864e5)), me = t.table.find(r => r.me);
  const rows = t.table.map(r => `<li class="${r.me ? 'me' : ''} ${r.pos === 1 && r.p ? 'p1' : ''}"><em>${r.pos}</em>${avatar(r.name, r.photo)}<b>${esc(r.name)}${r.pro ? ' <i class="pro-b">PRO</i>' : ''}${r.me ? ` <i>${T('rk_you')}</i>` : ''}</b><span class="lg-n">${r.p}</span><span class="lg-n">${r.w}</span><span class="lg-n">${r.d}</span><span class="lg-n">${r.l}</span><span class="lg-n">${r.gf - r.ga > 0 ? '+' : ''}${r.gf - r.ga}</span><strong>${r.pts}</strong></li>`).join('');
  const recent = t.recent.map(x => `<li><b>${esc(x.a)}</b><em>${x.ga} : ${x.gb}</em><b>${esc(x.b)}</b></li>`).join('');
  m.querySelector('#lg-body').innerHTML = `<div class="lg-head" style="--lc:${t.color}"><span class="lg-badge big">${esc(t.name[0] || '?')}</span><div><h2 class="ttl">${esc(t.name)}</h2><small>${T('rk_season_n', { n: t.season })}  ·  ${T('lg_members', { n: t.table.length, m: t.max })}  ·  <code>${t.code}</code></small></div></div>
    <div class="rp-row"><button class="play" id="lg-ch"><b>${T('lg_challenge')}</b></button><button class="btn lime" id="lg-inv">📨 ${T('lg_invite')}</button></div>
    <p class="rk-fair">🏆 ${T('lg_season_ends', { d: days })}</p>
    <h3 class="rk-h">${T('lg_table')}</h3><div class="rk-list lg-table"><div class="rk-hd"><span></span><span class="lg-cols-h">${T('lg_cols').split('  ').map(c => `<i>${c}</i>`).join('')}</span></div><ol>${rows}</ol><p class="lg-legend">${T('lg_legend')}</p></div>
    ${recent ? `<h3 class="rk-h">${T('lg_recent')}</h3><ul class="lg-recent">${recent}</ul>` : ''}
    <button class="btn ghost" id="lg-leave">${T('lg_leave')}</button>`;
  const invite = () => { const link = `https://t.me/BolaKertasBot?start=lg_${t.code.toLowerCase()}_${P.uid || 0}`, text = T('lg_share', { name: t.name });
    if (tg?.openTelegramLink) tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`); else navigator.clipboard?.writeText(link).then(() => toast(T('link_copied'))); };
  m.querySelector('#lg-inv').onclick = () => { SFX.ui(); invite(); };
  m.querySelector('#lg-ch').onclick = async () => { SFX.ui(); try { const r = await lgApi({ op: 'room', id }); toast(T('lg_wait'), 3500); joinRoom(r.code); } catch (e) { toast(lgErr(e)); } };
  m.querySelector('#lg-leave').onclick = () => { const o = overlay(`<h2>${T('lg_leave')}</h2><p class="muted">${T('lg_leave_q')}</p><button class="btn" id="y" style="--f:var(--red);--d:var(--red-d);--c:#fff">${T('lg_leave')}</button><button class="btn ghost" id="n">${T('cancel')}</button>`);
    o.querySelector('#n').onclick = closeAllOverlays; o.querySelector('#y').onclick = async () => { await lgApi({ op: 'leave', id }).catch(() => {}); closeAllOverlays(); showLeagues(); }; };
}

// ── goal replay ────────────────────────────────────────────
// Every frame we keep where the ball and every paper player were drawn (last 5s). A goal keeps 4s before + 1.4s after.
const TAPE_S = 5, PRE_S = 4, POST_S = 1.4;
function recordFrame(e) {
  if (!M || M.replaying) return;
  const now = performance.now() / 1000, b = world.ballMesh.position;
  M.tape.push({ t: now, b: [b.x, b.y, b.z], p: world.pieces.map(v => { const r = v.root, s = v.body.scale; return [r.position.x, r.position.y, r.position.z, r.rotation.x, r.rotation.y, r.rotation.z, s.x, s.y, s.z]; }) });
  while (M.tape.length && now - M.tape[0].t > TAPE_S) M.tape.shift();
  const G = M.goalAt; if (!G) return;
  if (!G.t0) G.t0 = now;
  if (now - G.t0 >= POST_S) { const from = G.t0 - PRE_S; M.goals.push({ ...G, frames: M.tape.filter(f => f.t >= from).map(f => ({ ...f, t: f.t - from })), goalT: PRE_S }); M.goalAt = null;
    if (M.mode !== 'online' && !e.kicks && S.autoReplay !== false) playReplays(M.goals.length - 1, false, true); } // instant replay; online keeps playing (both phones must stay in step), penalties would replay every kick
}
// Cinematic: chase cam behind the ball that keeps the scorer in frame, swings to a low side angle on the net, slow motion
// at the goal. The look point is the ball itself (eased), so the ball never leaves the centre of the shot.
function replayCam(clip, t, b, scorer, cam, dt) {
  const gs = Math.sign(clip.frames.at(-1).b[2]) || 1, side = clip.frames.at(-1).b[0] >= 0 ? -1 : 1;
  const near = Math.min(1, Math.max(0, 1 - (clip.goalT - t) / 2.2)), e = near * near * (3 - 2 * near); // 0 build-up, 1 at the net
  const keep = scorer ? (t < clip.goalT - 0.6 ? 0.5 : t > clip.goalT + 0.3 ? 0.35 : 0) : 0; // scorer in shot on the build-up and the celebration
  const mid = scorer ? new THREE.Vector3(b.x + (scorer.x - b.x) * keep, 0.3, b.z + (scorer.z - b.z) * keep) : new THREE.Vector3(b.x, 0.3, b.z);
  const chase = new THREE.Vector3(mid.x * 0.85 + side * 1.6, 2.4, mid.z - gs * 4.6);
  const net = new THREE.Vector3(b.x * 0.4 + side * 4.2, 1.3, gs * (FIELD.L / 2 - 2.8));
  const after = Math.max(0, t - clip.goalT), pos = chase.lerp(net, e), gap = scorer ? Math.hypot(scorer.x - b.x, scorer.z - b.z) : 0;
  pos.y += after * 0.45 + keep * gap * 0.35; pos.x += side * after * 0.5; pos.z -= gs * keep * gap * 0.3; // pull back far enough to fit ball + scorer
  const look = new THREE.Vector3(b.x, Math.max(0.25, b.y * 0.6), b.z).lerp(mid, 0.25 * (1 - e));
  const k = cam.first ? 1 : 1 - Math.exp(-dt * 6); cam.first = false; // ease, never snap
  cam.pos.lerp(pos, k); cam.look.lerp(look, 1 - Math.exp(-dt * 10));
  world.cam.position.copy(cam.pos); world.cam.lookAt(cam.look); world.cam.fov = 46 - 8 * e; world.cam.updateProjectionMatrix();
}
function playReplays(idx, record = false, auto = false) {
  const clip = M?.goals[idx]; if (!clip) return toast(T('rp_none'));
  closeAllOverlays(); $('#hud').hidden = true;
  const bar = h(`<div class="rp-bar"><span class="rp-tag">⟲ ${T('rp_title')}</span><b>${esc(clip.who)}</b><em>${clip.score[0]} : ${clip.score[1]}</em>${auto && !record && window.MediaRecorder ? `<button class="chip ghost rp-save" id="rp-save">⬇ ${T('rp_dl')}</button>` : ''}<button class="chip ghost" id="rp-x">${T('rp_skip')}</button>${auto ? `<i class="rp-auto"></i>` : ''}<span class="rp-sp"><img src="/sponsor/revolix.png?v=46" alt=""><small>revolixgaming.com</small></span></div>`);
  document.body.append(bar);
  const end = clip.frames.at(-1).t; let t = 0, fxDone = false, rec = null, chunks = [];
  if (record && window.MediaRecorder) {
    const type = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find(x => MediaRecorder.isTypeSupported(x));
    try { rec = new MediaRecorder(canvas.captureStream(30), { mimeType: type, videoBitsPerSecond: 2.5e6 }); rec.ondataavailable = ev => ev.data.size && chunks.push(ev.data); rec.start(); } catch { rec = null; }
  }
  const F = clip.frames, cam = { pos: new THREE.Vector3(), look: new THREE.Vector3(), first: true }, bm = world.ballMesh, prevB = new THREE.Vector3(...F[0].b);
  const scorer = world.pieces[clip.sid]; let i = 1;
  M.replaying = { step(dt) {
    const slow = Math.abs(t - clip.goalT) < 1.2 ? 0.4 : 0.9, warp = Math.min(1, 0.25 + t * 1.5); t += dt * slow * warp; // ease in, slow motion at the net
    while (i < F.length - 1 && F[i].t < t) i++; if (F[i - 1].t > t) i = 1;
    const a = F[i - 1], c = F[i], u = Math.min(1, Math.max(0, (t - a.t) / ((c.t - a.t) || 1))), L = (x, y) => x + (y - x) * u; // blend the two recorded frames around t
    bm.position.set(L(a.b[0], c.b[0]), L(a.b[1], c.b[1]), L(a.b[2], c.b[2]));
    const dx = bm.position.x - prevB.x, dz = bm.position.z - prevB.z; bm.rotation.x += dz / 0.16; bm.rotation.z -= dx / 0.16; prevB.copy(bm.position); // roll with the distance travelled
    a.p.forEach((p, j) => { const v = world.pieces[j], q = c.p[j]; if (!v || !q) return; v.root.position.set(L(p[0], q[0]), L(p[1], q[1]), L(p[2], q[2]));
      if (p.length > 4) { v.root.rotation.set(L(p[3], q[3]), L(p[4], q[4]), L(p[5], q[5])); v.body.scale.set(L(p[6], q[6]), L(p[7], q[7]), L(p[8], q[8])); } else v.root.rotation.y = p[3]; });
    world.showAim(null); replayCam(clip, t, bm.position, scorer?.root.position, cam, dt);
    if (!fxDone && t >= clip.goalT) { fxDone = true; world.goalFx(clip.fx, bm.position.x, bm.position.z, clip.colors, clip.set, clip.rank); SFX.goal(); }
    if (t >= end) done();
  } };
  const done = () => {
    if (!M?.replaying) return; M.replaying = null; bar.remove();
    if (rec) { rec.onstop = () => record(new Blob(chunks, { type: rec.mimeType })); rec.stop(); }
    if (auto) { $('#hud').hidden = false; M.prevP = null; return; } // back to the match exactly where it paused
    replayMenu(idx);
  };
  bar.querySelector('#rp-x').onclick = done;
  bar.querySelector('#rp-save')?.addEventListener('click', () => { M.replaying = null; bar.remove(); toast(T('rp_saving'), 6000); playReplays(idx, saveVideo, true); }); // replay again from the start while recording, then back to the match
}
function replayMenu(idx) {
  const list = M.goals.map((g, i) => `<button class="rp-goal ${i === idx ? 'on' : ''}" data-i="${i}"><b>${g.score[0]}:${g.score[1]}</b><span>${esc(g.who)}</span></button>`).join('');
  const o = overlay(`<h2>${T('rp_goals')}</h2><div class="rp-list">${list}</div>
    <div class="rp-row"><button class="btn lime" id="rp-share">📤 ${T('rp_share')}</button><button class="btn" id="rp-poster">🖼 ${T('rp_poster')}</button></div>
    ${window.MediaRecorder ? `<div class="rp-row"><button class="btn" id="rp-dl">⬇ ${T('rp_dl')}</button>${P.guest ? '' : `<button class="btn" id="rp-bot">✈️ ${T('rp_bot')}</button>`}</div>` : ''}
    <button class="btn" id="rp-again">▶ ${T('rp_again')}</button><button class="btn ghost" id="rp-back">${T('back')}</button>`);
  let sel = idx;
  o.querySelectorAll('.rp-goal').forEach(b => b.onclick = () => { sel = +b.dataset.i; o.querySelectorAll('.rp-goal').forEach(x => x.classList.toggle('on', x === b)); });
  o.querySelector('#rp-again').onclick = () => playReplays(sel);
  o.querySelector('#rp-poster').onclick = () => sharePoster(M.goals[sel]);
  o.querySelector('#rp-share').onclick = () => { if (!window.MediaRecorder) return sharePoster(M.goals[sel]); toast(T('rp_saving'), 6000); playReplays(sel, blob => shareFile(blob, `bola-kertas-gol.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`)); };
  o.querySelector('#rp-dl')?.addEventListener('click', () => { toast(T('rp_saving'), 6000); playReplays(sel, saveVideo); });
  o.querySelector('#rp-bot')?.addEventListener('click', () => { toast(T('rp_saving'), 6000); playReplays(sel, sendToBot); });
  o.querySelector('#rp-back').onclick = () => { closeAllOverlays(); M.over = false; finishMatch(); };
}
// Save the recorded replay to the phone: Telegram's own download sheet when available, else a plain browser download.
// The bot sends the replay to the player's own Telegram chat: it plays there and saves to the gallery with one tap.
async function sendToBot(blob) {
  try {
    const r = await fetch('/api/clip', { method: 'POST', headers: { 'Content-Type': blob.type.split(';')[0], 'X-Init-Data': initData }, body: blob }).then(r => r.ok ? r.json() : Promise.reject(r.status));
    await api('/api/clip/send', { url: r.url, caption: `${T('share_goal')}\n\n${T('share_join')} ${refLink()}` }); notify('success'); toast(T('rp_bot_ok'), 4000);
  } catch (e) { if (e.code === 'bot_blocked') { tg?.openTelegramLink?.('https://t.me/BolaKertasBot?start=start'); return toast(T('rp_bot_start'), 5000); } toast(T(e.code === 'slow_down' ? 'rp_bot_limit' : 'oops')); }
}
async function saveVideo(blob) {
  const name = `bola-kertas-gol.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`;
  const local = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove(); toast(T('share_saved')); };
  if (P.guest || !tg?.downloadFile) return local();
  try {
    const r = await fetch('/api/clip', { method: 'POST', headers: { 'Content-Type': blob.type.split(';')[0], 'X-Init-Data': initData }, body: blob }).then(r => r.ok ? r.json() : Promise.reject(r.status));
    tg.downloadFile({ url: `${location.origin}${r.url}?dl=1`, file_name: name }, ok => ok && toast(T('share_saved')));
  } catch { local(); }
}
// Share: native share sheet when the phone allows files, else upload and let Telegram share the link / save the file.
const refLink = () => `https://t.me/BolaKertasBot?start=ref_${P.uid || 0}`; // personal invite: inviter gets coins when the friend finishes a first match
async function shareFile(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text: `${T('share_goal')}\n${refLink()}` }); return; } } catch (e) { if (e?.name === 'AbortError') return; }
  if (P.guest) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); return toast(T('share_saved')); }
  try {
    const r = await fetch('/api/clip', { method: 'POST', headers: { 'Content-Type': blob.type.split(';')[0], 'X-Init-Data': initData }, body: blob }).then(r => r.ok ? r.json() : Promise.reject(r.status));
    const url = location.origin + r.url;
    if (blob.type.startsWith('image/') && tg?.shareToStory) { tg.shareToStory(url, { text: T('share_goal'), widget_link: { url: refLink(), name: T('share_widget') } }); return; }
    if (tg?.openTelegramLink) tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(location.origin + r.page)}&text=${encodeURIComponent(`${T('share_goal')}\n\n${T('share_join')} ${refLink()}`)}`);
    else { navigator.clipboard?.writeText(location.origin + r.page); toast(T('link_copied')); }
  } catch { toast(T('oops')); }
}
// Posters: three layouts built from the real match scene (same paper players, ball, pitch and venue the player saw),
// framed in the game's own paper-and-ink style. The player picks one and shares it.
const loadImg = src => new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = src; });
const INK = '#2a1f5c';
// Pose the match scene at a recorded frame and draw it at w x h into g (one off-screen pass, screen size restored right after).
function shot(clip, g, x, y, w, h, view) {
  const F = clip.frames, gi = Math.max(0, F.findIndex(f => f.t >= clip.goalT)), gs = Math.sign(F.at(-1).b[2]) || 1, side = F.at(-1).b[0] >= 0 ? -1 : 1;
  const sp = F[gi].p[clip.sid], dist = f => sp ? Math.hypot(f.b[0] - sp[0], f.b[2] - sp[2]) : 0;
  const strike = F.slice(0, gi + 1).reduce((a, f) => dist(f) < dist(a) ? f : a, F[0]), f = view === 'goal' ? F[gi] : strike;
  world.ballMesh.position.set(...f.b); world.ballRing.visible = false; world.showAim(null);
  f.p.forEach((p, j) => { const v = world.pieces[j]; if (!v) return; v.root.position.set(p[0], p[1], p[2]);
    if (p.length > 4) { v.root.rotation.set(p[3], p[4], p[5]); v.body.scale.set(p[6], p[7], p[8]); } else v.root.rotation.y = p[3]; });
  const b = new THREE.Vector3(...f.b), s = sp ? new THREE.Vector3(f.p[clip.sid][0], 0, f.p[clip.sid][2]) : b.clone(), C = world.cam;
  if (view === 'goal') { C.fov = 44; C.position.set(b.x * 0.5 - side * 1.6, 0.55, gs * (FIELD.L / 2 - 3.6)); C.lookAt(b.x * 0.8, -0.35, gs * (FIELD.L / 2 - 0.4)); C.updateProjectionMatrix(); C.setViewOffset(1080, 1350, 0, 260, 1080, 1350); } // in front of the net, ball in the mesh
  else if (view === 'star') { C.fov = 30; C.position.set(s.x + side * 1.1, 0.62, s.z + gs * 1.7); C.lookAt(s.x - side * 0.15, 0.36, s.z); }
  else { C.fov = 46; C.position.set(s.x * 0.5 + side * 3.5, 6.5, s.z - gs * 6.5); C.lookAt((s.x + b.x) / 4, 0, (s.z + gs * FIELD.L / 2) / 2); }
  const keep = world.size, dpr = world.r.getPixelRatio(); world.r.setPixelRatio(1); world.size = [w, h]; world.resize();
  world.update(0.001, performance.now() / 1000); world.render(); g.drawImage(world.r.domElement, x, y, w, h);
  world.size = keep; world.r.setPixelRatio(dpr); C.clearViewOffset(); world.resize();
}
function makePosters(clip) {
  const W = 1080, H = 1350, [t0, t1] = M.art.teams, k = M.art.kits[clip.team] || M.art.kits[0], vp = world.pieces[clip.sid];
  const rk = Object.entries(RARITY).find(([, r]) => r.rank === (vp?.rank || 0)) || ['common', RARITY.common];
  const name = clip.own ? clip.who : clip.who.replace(/^#\d+\s*/, ''), num = (clip.who.match(/^#(\d+)/) || [])[1] || '';
  const txt = (g, s, x, y, size, fill, sw = size / 9, align = 'center', font = '"Lilita One","Rubik Cyr"') => { g.font = `400 ${size}px ${font}`; g.textAlign = align; g.lineJoin = 'round';
    g.lineWidth = sw; g.strokeStyle = INK; g.strokeText(s, x, y + sw * 0.35); g.strokeText(s, x, y); g.fillStyle = fill; g.fillText(s, x, y); }; // thick ink outline + drop, like the game titles
  const rr = (g, x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
  const chip = (g, s, x, y, fill, size = 34, col = '#fff') => { g.font = `400 ${size}px "Lilita One","Rubik Cyr"`; const w = g.measureText(s).width + size * 1.1, h = size * 1.55;
    g.fillStyle = INK; rr(g, x - w / 2, y - h / 2 + 7, w, h, h / 2); g.fill(); g.fillStyle = fill; rr(g, x - w / 2, y - h / 2, w, h, h / 2); g.fill(); g.lineWidth = 5; g.strokeStyle = INK; g.stroke();
    g.fillStyle = col; g.textAlign = 'center'; g.fillText(s, x, y + size * 0.36); };
  const grade = (g, top = 0.35, bot = 0.5) => { let gr = g.createLinearGradient(0, 0, 0, H * top); gr.addColorStop(0, 'rgba(20,12,60,.8)'); gr.addColorStop(1, 'rgba(20,12,60,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H * top);
    gr = g.createLinearGradient(0, H * (1 - bot), 0, H); gr.addColorStop(0, 'rgba(20,12,60,0)'); gr.addColorStop(1, 'rgba(20,12,60,.92)'); g.fillStyle = gr; g.fillRect(0, H * (1 - bot), W, H * bot);
    gr = g.createRadialGradient(W / 2, H * 0.45, H * 0.3, W / 2, H * 0.45, H * 0.85); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(10,6,40,.55)'); g.fillStyle = gr; g.fillRect(0, 0, W, H); };
  const score = (g, cy, s = 1) => { crest(g, W / 2 - 300 * s, cy, 150 * s, t0); crest(g, W / 2 + 300 * s, cy, 150 * s, t1); txt(g, `${clip.score[0]} : ${clip.score[1]}`, W / 2, cy + 50 * s, 150 * s, '#fff', 16 * s); };
  const foot = (g, logo, dark = true) => { g.fillStyle = dark ? 'rgba(255,255,255,.18)' : 'rgba(42,31,92,.18)'; g.fillRect(60, H - 112, W - 120, 3);
    if (logo) { const lw = 270, lh = lw * logo.height / logo.width; g.drawImage(logo, 60, H - 90 + (56 - lh) / 2, lw, lh); }
    g.textAlign = 'right'; g.font = '800 28px Nunito'; g.fillStyle = dark ? '#b9c8ff' : '#6a6399'; g.fillText(T('rp_sponsor').toUpperCase(), W - 60, H - 62); g.font = '900 34px Nunito'; g.fillStyle = dark ? '#fff' : INK; g.fillText('t.me/BolaKertasBot', W - 60, H - 24); };
  const logoTop = (g, y = 104) => txt(g, 'BOLA KERTAS', W / 2, y, 84, '#ffc93c', 14);
  const canvas2 = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  return async logo => {
    await document.fonts.load('400 120px "Lilita One"');
    // 1. GOL: low camera from behind the net, goal effect at its peak
    const a = canvas2(), ga = a.getContext('2d'); world.goalFx(clip.fx, ...[clip.frames.at(-1).b[0], clip.frames.at(-1).b[2]], clip.colors, clip.set, clip.rank); for (let i = 0; i < 8; i++) world.update(1 / 30, i / 30);
    shot(clip, ga, 0, 0, W, H, 'goal'); grade(ga, 0.3, 0.55); logoTop(ga);
    ga.save(); ga.translate(W / 2, 830); ga.rotate(-0.06); txt(ga, T('goal'), 0, 0, 250, '#ffc93c', 24); ga.restore();
    score(ga, 990); chip(ga, (clip.own ? clip.who : T('rp_scored', { name: clip.who })).toUpperCase(), W / 2, 1170, k.base, 40, ink(k.base)); foot(ga, logo);
    // 2. PENJARING: the scorer's own paper player, close up at the strike, big number in the team colour
    const b = canvas2(), gb = b.getContext('2d'); shot(clip, gb, 0, 0, W, H, 'star'); grade(gb, 0.3, 0.5);
    gb.save(); gb.globalAlpha = 0.9; gb.fillStyle = k.base; gb.beginPath(); gb.moveTo(0, 0); gb.lineTo(330, 0); gb.lineTo(150, H); gb.lineTo(0, H); gb.fill(); gb.lineWidth = 8; gb.strokeStyle = INK; gb.stroke(); gb.restore();
    if (num) { gb.save(); gb.translate(150, 520); gb.rotate(-0.08); txt(gb, num, 0, 0, 330, k.accent === k.base ? '#fff' : k.accent, 26); gb.restore(); }
    logoTop(gb); chip(gb, T('pst_star'), W / 2, 200, '#ff7fb6', 34);
    txt(gb, name.toUpperCase(), W / 2, 1030, name.length > 12 ? 92 : 120, '#fff', 16); chip(gb, rk[1].rank ? `${T('r_' + rk[0])} · ${clip.score[0]} : ${clip.score[1]}` : `${M.names[0]}  ${clip.score[0]} : ${clip.score[1]}  ${M.names[1]}`, W / 2, 1140, rk[1].rank ? rk[1].color : '#ffc93c', 36, INK); foot(gb, logo);
    // 3. KAD PERLAWANAN: notebook paper card with the wide shot taped in, like the game's menus
    const c = canvas2(), gc = c.getContext('2d'); gc.fillStyle = '#fffaf0'; gc.fillRect(0, 0, W, H);
    gc.strokeStyle = 'rgba(79,179,255,.28)'; gc.lineWidth = 3; for (let y = 60; y < H; y += 54) { gc.beginPath(); gc.moveTo(0, y); gc.lineTo(W, y); gc.stroke(); }
    gc.strokeStyle = 'rgba(255,93,115,.5)'; gc.beginPath(); gc.moveTo(90, 0); gc.lineTo(90, H); gc.stroke();
    txt(gc, 'BOLA KERTAS', W / 2, 120, 84, '#ffc93c', 14); chip(gc, T('pst_card'), W / 2, 200, '#4fb3ff', 32);
    gc.save(); gc.translate(W / 2, 600); gc.rotate(-0.025); gc.fillStyle = INK; rr(gc, -440, -310 + 12, 880, 620, 30); gc.fill(); gc.save(); rr(gc, -440, -310, 880, 620, 30); gc.clip(); shot(clip, gc, -440, -310, 880, 620, 'wide'); gc.restore();
    rr(gc, -440, -310, 880, 620, 30); gc.lineWidth = 10; gc.strokeStyle = INK; gc.stroke();
    gc.fillStyle = 'rgba(255,201,60,.85)'; [[-400, -320, -0.5], [400, -320, 0.5]].forEach(([x, y, r]) => { gc.save(); gc.translate(x, y); gc.rotate(r); gc.fillRect(-70, -22, 140, 44); gc.restore(); }); gc.restore();
    score(gc, 1020, 0.9); txt(gc, (clip.own ? clip.who : T('rp_scored', { name: clip.who })).toUpperCase(), W / 2, 1180, 50, '#3fd1a2', 9); foot(gc, logo, false);
    world.cam.fov = 46; world.cam.updateProjectionMatrix();
    return [a, b, c];
  };
}
async function sharePoster(clip) {
  if (!clip) return toast(T('rp_none'));
  const o = overlay(`<h2>${T('pst_pick')}</h2><div class="pst" id="pst"><div class="spinner"></div></div><div class="pst-dots" id="pdots"></div>
    <button class="btn lime" id="pst-go" disabled>📤 ${T('pst_share')}</button><button class="btn ghost" id="pst-x">${T('back')}</button>`); o.classList.add('ov-pst');
  o.querySelector('#pst-x').onclick = () => o.remove();
  await new Promise(r => requestAnimationFrame(r)); // let the sheet paint before the heavy pass
  const logo = await loadImg('/sponsor/revolix.png?v=46').catch(() => null);
  const cs = await makePosters(clip)(logo), urls = cs.map(c => c.toDataURL('image/jpeg', 0.9));
  if (window.__bkPosterHook) { o.remove(); return window.__bkPosterHook(urls); } // QA capture
  if (!o.isConnected) return;
  const row = o.querySelector('#pst'); row.innerHTML = urls.map((u, i) => `<img src="${u}" alt="" data-i="${i}">`).join('');
  const dots = o.querySelector('#pdots'); dots.innerHTML = urls.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('');
  let sel = 0; row.onscroll = () => { sel = Math.round(row.scrollLeft / row.clientWidth); dots.querySelectorAll('i').forEach((d, i) => d.classList.toggle('on', i === sel)); };
  const go = o.querySelector('#pst-go'); go.disabled = false;
  go.onclick = () => { SFX.ui(); haptic('medium'); cs[sel].toBlob(b => shareFile(b, `bola-kertas-poster-${sel + 1}.jpg`), 'image/jpeg', 0.9); };
}

// ── start helpers ──────────────────────────────────────────
function localSetup(cpu) {
  const t0 = teamById(S.team), t1 = teamById(S.opp === S.team ? ALL_TEAMS.find(t => t.id !== S.team).id : S.opp), kk = pickKits(t0, t1, S.kit);
  return { seed: (Math.random() * 2 ** 32) >>> 0, minutes: S.minutes, halves: true, powerStrike: true, layout: 'spread', lockstep: true, turnLimit: 15, cpu, cpuSkill: S.skill,
    formations: [S.formation, '4-4-2'], teams: [t0.id, t1.id], kits: [S.kit === -1 && mySquad().kit ? 'custom' : kk.kits[0].id, kk.kits[1].id], rosters: [mySquad().roster ? cleanRoster(mySquad().roster, t0) : rosterFor(t0), rosterFor(t1)],
    custom: [S.kit === -1 ? cleanKit(mySquad().kit, P.owned.includes('k_studio')) : null, null],
    paper: [itemById(P.equip.paper)?.stats || BASE_STATS, BASE_STATS], stars: [mySquad().stars || {}, {}] };
}
async function beginCpu(drill) {
  const call = await pickSide(true); if (!call) return;
  let setup = localSetup([false, true]), mid = null; if (drill) setup.drill = drill;
  if (!P.guest) {
    try { const r = await api('/api/match/start', { team0: S.team, team1: setup.teams[1], kit0: setup.kits[0], kit1: setup.kits[1], formation: S.formation, skill: S.skill, minutes: S.minutes, call, drill }); setup = r.setup; mid = r.mid; }
    catch (e) { toast(T('offline')); }
  }
  if (!setup.coin) { setup.call = call; setup.coin = Math.random() < 0.5 ? 'k' : 'b'; const won = setup.coin === call; setup.first = won ? 0 : 1; setup.home = won ? { pitch: P.equip.pitch, venue: P.equip.venue, ball: P.equip.ball } : aiEquip(setup.seed); }
  startMatch({ setup, mode: 'cpu', mid, paperIds: [P.equip.paper, 'p_a4'], names: [teamById(setup.teams[0]).short, teamById(setup.teams[1]).short] });
  revealToss(setup.coin, setup.first === 0, 'AI');
}
async function beginLocal() {
  const call = await pickSide(true); if (!call) return;
  const setup = localSetup([false, false]); setup.paper = [BASE_STATS, BASE_STATS]; setup.call = call; setup.coin = Math.random() < 0.5 ? 'k' : 'b'; setup.first = setup.coin === call ? 0 : 1;
  startMatch({ setup, mode: 'local', paperIds: ['p_a4', 'p_a4'], names: [teamById(setup.teams[0]).short, teamById(setup.teams[1]).short] });
  revealToss(setup.coin, setup.first === 0, teamById(setup.teams[1]).short);
}

// ── coin toss: KEPALA (k) or BUNGA (b). Winner kicks off and plays at home (their venue, pitch, ball) ──
const COIN = () => `<div class="coin3d" id="coin"></div>`;
const coin3d = o => L3.coin(o.querySelector('#coin'), [T('heads_s'), T('heads'), T('tails_s'), T('tails')]);
function pickSide(caller, online = false) {
  return new Promise(res => {
    const o = overlay(`<div class="toss"><small class="kick">${T('referee')}</small><h2>${T('coin_toss')}</h2>${COIN()}
      ${caller ? `<p class="muted">${T('toss_pick')}</p>
      <div class="row2"><button class="btn lime big" data-s="k">${T('heads')}</button><button class="btn lime big" data-s="b">${T('tails')}</button></div>${online ? '' : `<button class="btn ghost" id="cx">${T('cancel')}</button>`}`
      : `<p class="muted">${T('toss_wait')}</p><div class="spinner"></div>`}</div>`);
    o.classList.add('ov-toss'); const cn = coin3d(o);
    o.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { SFX.ui(); haptic('medium'); o.querySelectorAll('[data-s]').forEach(x => x.disabled = true); b.classList.add('picked'); cn.spin(); setTimeout(() => res(b.dataset.s), 450); });
    o.querySelector('#cx')?.addEventListener('click', () => { closeAllOverlays(); res(null); });
    if (!caller) res(null);
  });
}
function revealToss(coin, iWon, oppName) {
  if (M && M.mode !== 'online') M.paused = true;
  const o = overlay(`<div class="toss"><small class="kick">${T('referee')}</small><h2>${T('coin_toss')}</h2>${COIN()}<p class="tres" id="tres">&nbsp;</p></div>`); o.classList.add('ov-toss');
  const cn = coin3d(o);
  // start the flip only once the new match scene has drawn twice, so it never runs on the heavy first frames
  requestAnimationFrame(() => requestAnimationFrame(() => { SFX.whistle(false); cn.land(coin, () => { const r = o.querySelector('#tres'); if (!r) return;
    r.innerHTML = `<b>${T(coin === 'k' ? 'heads' : 'tails')}!</b> ${iWon ? T('toss_won') : T('toss_lost', { name: esc(oppName) })}`;
    iWon ? (notify('success'), SFX.buy()) : haptic('rigid');
    setTimeout(() => { o.remove(); if (M) M.paused = false; }, 2000); }); }));
}

// ── online ─────────────────────────────────────────────────
const wsUrl = p => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${p}`;
function joinRoom(code, tries = 0) {
  const o = overlay(`<h2>${T('room', { code: esc(code) })}</h2><p class="muted" id="rstat">${T('connecting')}</p><div class="code">${esc(code)}</div><button class="btn lime" id="share">${T('invite')}</button><button class="btn ghost" id="cx">${T('cancel')}</button>`);
  const ws = new WebSocket(wsUrl(`/ws/room/${code}?pid=${encodeURIComponent(PID)}`)); let state = 'wait';
  o.querySelector('#cx').onclick = () => { state = 'cancel'; ws.close(); closeAllOverlays(); };
  o.querySelector('#share').onclick = () => {
    const link = `https://t.me/BolaKertasBot?start=room_${code}`, text = T('share_text', { code });
    if (tg?.openTelegramLink) tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
    else navigator.clipboard?.writeText(link).then(() => toast(T('link_copied')));
  };
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', initData, profile: { name: P.name, team: S.team, kit: S.kit === -1 ? 'custom' : teamById(S.team).jerseys[S.kit]?.id, formation: S.formation }, v: PROTOCOL }));
  ws.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.t === 'waiting') { const s = $('#rstat'); if (s) s.textContent = T('room_wait'); }
    else if (m.t === 'err' && m.msg === 'update') { state = 'cancel'; toast(T('need_update'), 4000); setTimeout(() => location.reload(), 1800); }
    else if (m.t === 'err') { toast(T(m.msg === 'room-full' ? 'room_full' : m.msg === 'no-room' ? 'room_gone' : 'oops')); if (m.state && M) { M.e.importState(m.state); M.sent = false; } if (!M) closeAllOverlays(); }
    else if (m.t === 'toss') { if (M) { M.closing = false; } pickSide(m.caller, true).then(side => { if (m.caller && side) ws.send(JSON.stringify({ t: 'call', side })); }); }
    else if (m.t === 'setup') {
      const fresh = state !== 'play' && !tries; state = 'play'; tries = 0;
      startMatch({ setup: m.setup, mode: 'online', seat: m.seat, paperIds: m.setup.paperIds || ['p_a4', 'p_a4'], names: m.setup.names });
      M.ws = ws; M.e.importState(m.state); M.turnDeadline = performance.now() + (m.left || 0); M.turnFlag = true;
      if (m.setup.coin && (fresh || m.state?.clock === 0)) revealToss(m.setup.coin, m.setup.first === m.seat, T('opp_name'));
    }
    else if (!M) return;
    else if (m.t === 'act') { M.sent = false; if (!M.e._applyAction(m.a)) M.e.importState(m.state); else M.pending = m.state; M.turnDeadline = performance.now() + (m.left || 0); }
    else if (m.t === 'over') { M.forfeit = !!m.forfeit; M.rank = m.rank || null; M.league = m.league || null; if (m.state) M.e.importState(m.state); M.e.phase = 'over'; M.e.winner = m.winner; }
    else if (m.t === 'opp') toast(T(m.here ? 'opp_back' : 'opp_gone'), 3500);
    else if (m.t === 'rematch') toast(T(m.seats.length < 2 ? 'rematch_asked' : 'rematch_go'));
  };
  // Keep trying for about a minute (the server holds the seat for 60s), backing off 1, 2, 4, 8s.
  ws.onclose = () => { if (state === 'cancel' || M?.closing) return; if (M && M.mode === 'online' && !M.over) { if (tries > 9) { toast(T('conn_gone'), 4000); return quitMatch(); } toast(T('conn_lost'), 2400); setTimeout(() => { if (M && !M.over && !M.closing) { M = null; joinRoom(code, tries + 1); } }, [1000, 2000, 4000, 8000][Math.min(tries, 3)]); } };
}
function findMatch(ranked = false) {
  const o = overlay(`<h2>${T(ranked ? 'rk_finding' : 'finding')}</h2><div class="spinner"></div><p class="muted">${T('finding_note')}</p><button class="btn" id="inv">${T('invite_only')}</button><button class="btn ghost" id="cx">${T('cancel')}</button>`);
  const ws = new WebSocket(wsUrl('/ws/lobby?pid=' + encodeURIComponent(PID))); let done = false;
  ws.onopen = () => ws.send(JSON.stringify({ t: 'queue', ranked, initData, v: PROTOCOL }));
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.t === 'matched') { done = true; ws.close(); joinRoom(m.code); } else if (m.t === 'err' && m.msg === 'update') { done = true; ws.close(); toast(T('need_update'), 4000); setTimeout(() => location.reload(), 1800); } else if (m.t === 'err') { done = true; ws.close(); closeAllOverlays(); toast(T('rk_guest')); } };
  ws.onclose = () => { if (!done && document.body.contains(o)) o.querySelector('p').textContent = T('no_server'); };
  o.querySelector('#cx').onclick = () => { done = true; try { ws.send(JSON.stringify({ t: 'unqueue' })); } catch {} ws.close(); closeAllOverlays(); };
  o.querySelector('#inv').onclick = () => { done = true; ws.close(); createRoom(); };
}
async function createRoom() {
  try { const r = await fetch('/api/room', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules: { minutes: S.minutes } }) }).then(r => r.json()); joinRoom(r.code); }
  catch { toast(T('no_server')); }
}

// ── menus ──────────────────────────────────────────────────
const svgI = { cog: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>' };
const svg = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${svgI[k]}</svg>`;
// Telegram photo, or the first letter on a colour picked from the name when there is no photo.
const AV_COL = ['#4fb3ff', '#ff5d73', '#3fd1a2', '#ffc93c', '#9d85ff', '#ff9f66'];
const avatar = (name, photo, cls = '') => { const n = String(name || '?'), c = AV_COL[[...n].reduce((s, ch) => s + ch.charCodeAt(0), 0) % AV_COL.length];
  return `<span class="av ${cls}" style="--av:${c}"><i>${esc([...n.trim()][0] || '?').toUpperCase()}</i>${photo ? `<img src="${esc(photo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}</span>`; };
const myPhoto = () => P.photo || tg?.initDataUnsafe?.user?.photo_url || '';
const myName = () => P.name || [tg?.initDataUnsafe?.user?.first_name, tg?.initDataUnsafe?.user?.last_name].filter(Boolean).join(' ') || T('rk_you');
// Bottom bar on the home screen: the five places people go most.
const NAV = [['home', 'M4 11l8-7 8 7v9h-5v-6H9v6H4z'], ['rank', 'M7 4h10v4a5 5 0 0 1-10 0zM5 5H3v2a4 4 0 0 0 4 4M19 5h2v2a4 4 0 0 1-4 4M10 14h4v3h3v3H7v-3h3z'], ['play', ''], ['shop', 'M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2'], ['me', '']];
function navBar(on = 'home') {
  return `<nav class="nav">${NAV.map(([k, d]) => `<button data-n="${k}" class="${k === 'play' ? 'mid' : ''} ${k === on ? 'on' : ''}"><i>${k === 'play' ? '<svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z" fill="#fff" stroke="#2a1f5c" stroke-width="2" stroke-linejoin="round"/></svg>' : k === 'me' ? avatar(myName(), myPhoto(), 'nav-av') : `<svg viewBox="0 0 24 24"><path d="${d}" fill="currentColor" stroke="#2a1f5c" stroke-width="1.6" stroke-linejoin="round"/></svg>`}</i>${T('nav_' + k)}</button>`).join('')}</nav>`;
}
function bindNav(m) { m.querySelectorAll('.nav button').forEach(b => b.onclick = () => { SFX.ui(); haptic(); ({ home: showHome, rank: () => showRanked(), play: beginCpu, shop: () => showShop('paper'), me: showProfile })[b.dataset.n](); }); }
function header(back, title = '') {
  return `<header class="top">${back ? `<button class="chip ghost sq" id="back" aria-label="${T('back')}"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg></button>` : ''}
  ${title ? `<h2 class="hd">${title}</h2>` : `<div class="logo"><i></i><b>BOLA</b><em>KERTAS</em></div>`}<div class="sp"></div>
  <button class="chip coins" id="coins-btn"><span class="coin"></span><b data-coins></b></button>
  ${back ? '' : `<button class="chip ghost sq" id="cog" aria-label="${T('settings_a')}">${svg('cog')}</button>`}</header>`;
}
function bindHeader(root, back) { root.querySelector('#back')?.addEventListener('click', () => { SFX.ui(); (back || showHome)(); }); root.querySelector('#coins-btn').onclick = () => showShop('coins'); root.querySelector('#cog')?.addEventListener('click', showSettings); updateCoins(); }
function screen(html, cls = '') { const m = $('#menu'); m.hidden = false; m.className = cls; m.innerHTML = html; m.scrollTop = 0; return m; }

// Context for 3D art: your team, your kit, your equipped items.
function artCtx() {
  const t0 = teamById(S.team), t1 = teamById(S.opp === S.team ? ALL_TEAMS.find(t => t.id !== S.team).id : S.opp), kk = pickKits(t0, t1, S.kit);
  const ck = S.kit === -1 && mySquad().kit ? cleanKit(mySquad().kit, P.owned.includes('k_studio')) : null;
  return { team: t0, kit: ck || kk.kits[0], opp: t1, oppKit: kk.kits[1], equip: { ...P.equip }, name: T('captain') };
}
const paint = (el, url) => { if (el && url) { el.style.backgroundImage = `url(${url})`; el.classList.add('in'); } };

function showHome() {
  const ctx = artCtx(), paper = itemById(P.equip.paper), r = rarityOf(paper), owned = new Set(P.owned);
  const sellable = ITEMS.filter(i => i.slot !== 'pass' && i.slot !== 'bundle'), have = sellable.filter(i => owned.has(i.id)).length;
  const m = screen(`${header(false)}
  <main class="home">
    <section class="hero" style="--c0:${ctx.kit.base};--c1:${ctx.oppKit.base};--rc:${r.color}">
      <div class="hero-img" id="hero-img"></div><small class="kick">${T('next_match')}</small>
      <div class="hero-txt"><h1>${esc(ctx.team.short)} <i>VS</i> ${esc(ctx.opp.short)}</h1>
        <p>${T('ai')} ${T(['ai_easy', 'ai_normal', 'ai_hard'][[0.25, 0.5, 0.8].indexOf(S.skill)] || 'ai_normal')}  ·  ${T('minutes', { n: S.minutes })}  ·  ${esc(S.formation)}</p>
        <p class="ptag"><span class="rdot"></span>${T('paper_tag', { name: esc(iname(paper)) })}${paper.rarity !== 'common' ? ` <em>${T('r_' + paper.rarity)}</em>` : ''}</p></div>
    </section>
    <button class="rk-tile" id="rk-tile"><span class="rk-badge" id="rk-badge">🏆</span><span class="mt"><b>${T('ranked')}</b><small id="rk-sub">${T('ranked_s')}</small></span><span class="go"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg></span></button>
    <button class="play" id="kick"><b>${T('play')}</b><svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z" fill="currentColor" stroke-linejoin="round"/></svg></button>
    <section class="modes">
      ${[['web', T('mode_web'), T('mode_web_s'), T('tag_beta')], ['pen', T('mode_pen'), T('mode_pen_s'), T('tag_new')], ['cpu', T('mode_cpu'), T('mode_cpu_s')], ['two', T('mode_two'), T('mode_two_s')], ['shop', T('mode_shop'), T('mode_shop_s', { a: have, b: sellable.length })], ['studio', T('mode_studio'), T('mode_studio_s')], ['help', T('mode_help'), T('mode_help_s')]]
        .map(([k, t, s, tag], i) => `<button class="mode m-${k}" data-k="${k}" style="--i:${i}"><span class="mi" data-icon="${k}"></span><span class="mt"><b>${t}</b><small>${s}</small></span>${tag ? `<em>${tag}</em>` : ''}<span class="go"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg></span></button>`).join('')}
    </section>
  </main><footer class="foot">${T('footer')}</footer>
  ${navBar('home')}`, 'm-home');
  bindNav(m);
  bindHeader(m);
  m.querySelector('#kick').onclick = () => { SFX.ui(); beginCpu(); };
  m.querySelector('#rk-tile').onclick = () => { SFX.ui(); haptic(); showRanked(); };
  if (!P.guest) api('/api/rank', { tab: 'season' }).then(r => { const t = r.mine, el = m.querySelector('#rk-sub'); if (el) { el.textContent = `${T('t_' + t.tier)}${t.div ? ' ' + 'III II I'.split(' ')[3 - t.div] : ''}  ·  ${T('rk_rp', { n: num(t.rp) })}`; m.querySelector('#rk-badge').style.setProperty('--tc', tierOf(t.rp).color); } }).catch(() => {});
  m.querySelectorAll('.mode').forEach(b => b.onclick = () => { SFX.ui(); haptic(); ({ cpu: () => showSetup('cpu'), two: () => showSetup('local'), web: showOnline, shop: () => showShop('paper'), studio: () => showStudio(), help: showHelp, pen: () => beginCpu('penalties') })[b.dataset.k](); });
  (async () => { for (const k of ['hero', 'cpu', 'two', 'pen', 'web', 'shop', 'studio', 'help']) { const url = await L3.icon(k, ctx); if (!m.isConnected) return; paint(k === 'hero' ? m.querySelector('#hero-img') : m.querySelector(`[data-icon="${k}"]`), url); } })();
}

function teamGrid(selected, league, onPick) {
  const lg = LEAGUES.find(l => l.id === league) || LEAGUES[0];
  return `<div class="tabs">${LEAGUES.map(l => `<button class="tab ${l.id === lg.id ? 'on' : ''}" data-l="${l.id}">${esc(T('lg_' + l.id))}</button>`).join('')}</div>
  <div class="teams">${lg.teams.map(t => `<button class="team ${t.id === selected ? 'on' : ''}" data-t="${t.id}" style="--c:${t.jerseys[0].base};--a:${t.jerseys[0].accent}"><span class="sw"></span><b>${esc(t.short)}</b><small>${esc(t.name)}</small></button>`).join('')}</div>`;
}
function showSetup(mode) {
  let step = 0;
  const render = () => {
    const pickOpp = step === 1, sel = pickOpp ? S.opp : S.team, lg = pickOpp ? S.oppLeague : S.league;
    const m = screen(`${header(true)}<main class="setup">
      <div class="steps"><span class="${step === 0 ? 'on' : ''}">${T('step_team')}</span><span class="${step === 1 ? 'on' : ''}">${T('step_opp')}</span><span class="${step === 2 ? 'on' : ''}">${T('step_rules')}</span></div>
      ${step < 2 ? teamGrid(sel, lg) : `
      <div class="opts">
        <label>${T('kit')}<div class="seg" data-k="kit">${teamById(S.team).jerseys.map((j, i) => `<button class="${S.kit === i ? 'on' : ''}" data-v="${i}"><i style="background:${j.base};border-color:${j.accent}"></i>${j.label === 'Home' ? T('kit_home') : j.label === 'Away' ? T('kit_away') : esc(j.label)}</button>`).join('')}${mySquad().kit ? `<button class="${S.kit === -1 ? 'on' : ''}" data-v="-1"><i style="background:${mySquad().kit.base};border-color:${mySquad().kit.accent}"></i>Studio</button>` : ''}<button data-go="studio">+ Studio</button></div></label>
        <label>${T('formation')}<div class="seg" data-k="formation">${Object.keys(FORMATIONS).map(f => `<button class="${S.formation === f ? 'on' : ''}" data-v="${f}">${f}</button>`).join('')}</div></label>
        ${mode === 'cpu' ? `<label>${T('ai_level')}<div class="seg" data-k="skill">${[[0.25, T('ai_easy')], [0.5, T('ai_normal')], [0.8, T('ai_hard')]].map(([v, l]) => `<button class="${S.skill === v ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div></label>` : ''}
        <label>${T('match_len')}<div class="seg" data-k="minutes">${[1, 3, 5].map(v => `<button class="${S.minutes === v ? 'on' : ''}" data-v="${v}">${T('minutes', { n: v })}</button>`).join('')}</div></label>
        ${mode === 'cpu' ? `<p class="muted">${T('cpu_paper', { name: esc(iname(itemById(P.equip.paper))) })}</p>` : `<p class="muted">${T('two_paper')}</p>`}
      </div>`}
      <div class="cta"><button class="btn lime big" id="next">${T(step < 2 ? 'next' : 'start_match')}</button></div></main>`);
    bindHeader(m, () => { if (step > 0) { step--; render(); } else showHome(); });
    m.querySelectorAll('.tab').forEach(b => b.onclick = () => { pickOpp ? S.oppLeague = b.dataset.l : S.league = b.dataset.l; saveS(); render(); });
    m.querySelectorAll('.team').forEach(b => b.onclick = () => { if (pickOpp) S.opp = b.dataset.t; else { S.team = b.dataset.t; S.kit = 0; } saveS(); SFX.ui(); render(); });
    m.querySelector('[data-go="studio"]')?.addEventListener('click', ev => { ev.stopPropagation(); showStudio(() => showSetup(mode)); });
    m.querySelectorAll('.seg').forEach(seg => seg.querySelectorAll('button:not([data-go])').forEach(b => b.onclick = () => { const k = seg.dataset.k, v = b.dataset.v; S[k] = k === 'formation' ? v : +v; saveS(); SFX.ui(); render(); }));
    m.querySelector('#next').onclick = () => { SFX.ui(); if (step < 2) { step++; render(); } else mode === 'cpu' ? beginCpu() : beginLocal(); };
  };
  render();
}

function showOnline() {
  const m = screen(`${header(true)}<main class="online"><h2 class="ttl">${T('mode_web')} <em>${T('tag_beta')}</em></h2>
    <p class="muted">${T('online_you', { team: esc(teamById(S.team).name) })}</p>
    <button class="mode wide" id="find"><span class="mi" data-icon="web"></span><b>${T('find')}</b><small>${T('find_s')}</small></button>
    <button class="mode wide" id="make"><span class="mi" data-icon="two"></span><b>${T('make')}</b><small>${T('make_s')}</small></button>
    <div class="join"><input id="code" maxlength="8" placeholder="${T('room_code')}" autocomplete="off"><button class="btn lime" id="join">${T('join')}</button></div>
  </main>`);
  bindHeader(m);
  m.querySelector('#find').onclick = () => findMatch(); m.querySelector('#make').onclick = createRoom;
  (async () => { const ctx = artCtx(); for (const k of ['web', 'two']) { const url = await L3.icon(k, ctx); if (m.isConnected) m.querySelectorAll(`[data-icon="${k}"]`).forEach(el => paint(el, url)); } })();
  const inp = m.querySelector('#code'); inp.oninput = () => inp.value = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  m.querySelector('#join').onclick = () => inp.value.length >= 4 ? joinRoom(inp.value) : toast(T('enter_code'));
}

const SLOT_TABS = ['coins', 'pass', 'star', 'paper', 'bundle', 'pitch', 'venue', 'ball', 'fx', 'studio'];
function statBars(st) {
  return `<div class="stats">${[[T('stat_power'), 'power'], [T('stat_weight'), 'weight'], [T('stat_control'), 'control']].map(([l, k]) => { const v = st[k], p = (v - 85) / 30 * 100; return `<div><span>${l}</span><i><b style="width:${p}%" class="${v > 100 ? 'up' : v < 100 ? 'down' : ''}"></b></i><em>${v === 100 ? T('stat_base') : `${v > 100 ? '+' : ''}${v - 100}%`}</em></div>`; }).join('')}</div>`;
}
const priceHtml = it => it.free ? T('free') : it.coins ? `<span class="coin"></span>${num(it.coins)}` : `<span class="star"></span>${it.stars}`;
const itemState = (it, owned) => { const have = !it.consumable && isOwned(owned, it), eq = it.grants ? it.grants.every(g => Object.values(P.equip).includes(g)) : P.equip[it.slot] === it.id; return { have, eq }; };

function showShop(slot = 'paper') {
  const owned = new Set(P.owned), items = ITEMS.filter(i => i.slot === slot && (!i.exclusive || owned.has(i.id)) && (!i.season || i.season === seasonOf() || owned.has(i.id)) && !i.sub).sort((a, b) => (RARITY[a.rarity]?.rank || 0) - (RARITY[b.rarity]?.rank || 0));
  const m = screen(`${header(true, T('mode_shop'))}<main class="shop">
    <div class="tabs">${SLOT_TABS.map(k => `<button class="tab ${k === slot ? 'on' : ''}" data-s="${k}">${T('tab_' + k)}</button>`).join('')}</div>
    ${slot === 'paper' ? `<p class="muted">${T('note_paper')}</p>` : slot === 'bundle' ? `<p class="muted">${T('note_bundle')}</p>` : slot === 'star' ? `<p class="muted">${T('note_star')}</p>` : ''}
    ${slot === 'pass' ? proCard() : ''}
    ${P.guest ? `<p class="warn">${T('guest_warn')}</p>` : ''}
    ${slot === 'coins' ? `<p class="muted">${T('note_coins')}</p>
    <div class="packs">${items.map((it, i) => `<button class="pack r-${it.rarity}" data-id="${it.id}" style="--i:${i}">${it.tag ? `<em class="tag">${trMs(S.lang, it.tag)}</em>` : ''}<span class="pile p${i + 1}">${'<i></i>'.repeat(i + 2)}</span>
      <b>${num(it.grantCoins)}</b><small>${esc(iname(it))}</small><span class="btn lime"><span class="star"></span>${it.stars}</span></button>`).join('')}</div>` : ''}
    <div class="items" ${slot === 'coins' ? 'hidden' : ''}>${items.map(it => {
      const r = rarityOf(it), { have, eq } = itemState(it, owned);
      return `<article class="item r-${it.rarity || 'common'} ${eq ? 'eq' : ''}" data-id="${it.id}" style="--rc:${r.color}">
        <div class="ith"><span class="rb">${T('r_' + (it.rarity || 'common'))}</span>${it.tag ? `<em class="tag">${trMs(S.lang, it.tag)}</em>` : ''}${eq ? `<span class="eqb">${T('equipped')}</span>` : have ? `<span class="eqb own">${T('owned')}</span>` : ''}</div>
        <h3>${esc(iname(it))}</h3>
        <div class="pr">${eq ? `<b class="ok">${T('equipped')}</b>` : have ? `<b class="ok">${T('equip')}</b>` : `<b>${priceHtml(it)}</b>`}</div></article>`;
    }).join('')}</div>
    ${slot === 'pass' && P.passUntil > Date.now() ? `<p class="muted">${T('pass_until', { d: new Date(P.passUntil).toLocaleDateString(S.lang) })}</p>` : ''}
  </main>${navBar('shop')}`, 'm-shop m-home');
  bindHeader(m); bindNav(m);
  m.querySelectorAll('.tab').forEach(b => b.onclick = () => { SFX.ui(); showShop(b.dataset.s); });
  m.querySelectorAll('.item').forEach(card => card.onclick = () => { SFX.ui(); haptic(); itemSheet(itemById(card.dataset.id), slot); });
  m.querySelector('#pro-go')?.addEventListener('click', ev => buyOrEquip(itemById('pro_month'), 'buy', ev.currentTarget, () => showShop('pass')));
  m.querySelectorAll('.pack').forEach(card => card.onclick = () => { haptic(); buyOrEquip(itemById(card.dataset.id), 'buy', card.querySelector('.btn'), () => showShop('coins')); });
  if (slot === 'coins') return;
  L3.thumbs(items, artCtx(), (id, url) => { if (m.isConnected) paint(m.querySelector(`.item[data-id="${id}"] .ith`), url); });
}

const proOn = () => (P.proUntil || 0) > Date.now();
function proCard() {
  const it = itemById('pro_month'), on = proOn();
  return `<div class="pro-card"><div class="pro-h"><em>PRO</em><b>${T('pro_title')}</b></div><ul>${[1, 2, 3, 4].map(i => `<li>${T('pro_l' + i)}</li>`).join('')}</ul><p class="pro-fair">${T('pro_fair')}</p>
    ${on ? `<p class="pro-on">✅ ${T('pro_until', { d: new Date(P.proUntil).toLocaleDateString(S.lang) })}</p>` : `<button class="play" id="pro-go"><b><span class="star"></span>${it.stars}${T('pro_month')}  ·  ${T('pro_get')}</b></button>`}<small>${T('pro_cancel')}</small></div>`;
}
function itemSheet(it, slot) {
  const owned = new Set(P.owned), r = rarityOf(it), { have, eq } = itemState(it, owned), ctx = artCtx();
  const perks = it.slot === 'paper' || it.slot === 'bundle' ? perksUpTo(it.rarity) : [];
  const parts = it.grants ? it.grants.map(itemById) : [];
  const full = parts.reduce((s, p) => s + (p.stars || 0), 0);
  const act = eq ? 'none' : have ? 'equip' : 'buy';
  const o = overlay(`<div class="isheet r-${it.rarity || 'common'}" style="--rc:${r.color}">
    <div class="ipv" id="ipv"><span class="rb">${T('r_' + (it.rarity || 'common'))}</span><small class="hint">${T('drag_spin')}</small><button class="x" id="cl" aria-label="${T('close')}">&times;</button></div>
    <h2>${esc(iname(it))}</h2><p class="muted">${esc(idesc(it))}</p>
    ${it.stats ? statBars(it.stats) : ''}
    ${parts.length ? `<ul class="parts">${parts.map(p => `<li><span style="color:${rarityOf(p).color}">${T('r_' + p.rarity)}</span> ${esc(iname(p))} <s>${p.stars}</s></li>`).join('')}</ul><p class="save">${T('sep_price')} <s><span class="star"></span>${full}</s>  ${T('set_word')} <b><span class="star"></span>${it.stars}</b></p>` : ''}
    ${perks.length ? `<div class="perks"><small>${T('perks_of', { r: T('r_' + it.rarity) })}</small>${perks.map(p => `<span>${esc(trMs(S.lang, p))}</span>`).join('')}</div>` : ''}
    <div class="row"><button class="btn" id="try">${T(it.slot === 'fx' ? 'try_goal' : 'try_tap')}</button>
    <button class="btn ${act === 'buy' ? 'lime' : act === 'equip' ? 'lime' : 'ghost'}" id="go">${eq ? T('equipped') : have ? T('equip') : priceHtml(it)}</button></div>
    </div>`);
  o.classList.add('ov-item');
  const pv = L3.preview(o.querySelector('#ipv'), it, ctx);
  const close = () => { pv.close(); closeAllOverlays(); };
  o.querySelector('#cl').onclick = close; o.onclick = ev => { if (ev.target === o) close(); };
  o.querySelector('#try').onclick = () => { SFX.tap(0.8); if (it.rarity && RARITY[it.rarity].rank >= 3) SFX.tapLegend(RARITY[it.rarity].rank); haptic('medium'); it.slot === 'fx' || it.slot === 'bundle' ? (pv.tap(), pv.goal()) : pv.tap(); };
  o.querySelector('#go').onclick = async () => { if (act === 'none') return; const btn = o.querySelector('#go'); await buyOrEquip(it, act, btn, () => { pv.close(); showShop(slot); itemSheet(it, slot); }); }; // reopen so the preview stays and the button shows the new state
}

async function buyOrEquip(it, act, btn, done) {
  SFX.ui();
  if (act === 'equip' && it.slot === 'star') { closeAllOverlays(); return showSquad(showHome, it.id); }
  if (act === 'equip') {
    const ids = it.grants || [it.id];
    if (P.guest) { if (!it.free) return; P.equip[it.slot] = it.id; localStorage.setItem('bk/equip', JSON.stringify(P.equip)); return done(); }
    try { for (const id of ids) P = { ...(await api('/api/equip', { item: id })), guest: false }; haptic(); toast(T('equipped_t', { name: iname(it) })); done(); } catch { toast(T('equip_fail')); }
    return;
  }
  if (P.guest) return toast(T('open_tg_buy'));
  if (it.coins) {
    if (P.coins < it.coins) return toast(T('need_coins', { n: num(it.coins - P.coins) }));
    try { P = { ...(await api('/api/shop/buy', { item: it.id })), guest: false }; SFX.buy(); notify(); toast(T('bought', { name: iname(it) })); done(); } catch (e) { toast(T(e.code === 'coins' ? 'no_coins' : 'buy_fail')); }
    return;
  }
  btn.disabled = true; btn.textContent = T('opening');
  const c0 = P.coins, got = () => it.grantCoins ? P.coins > c0 : it.sub ? proOn() : it.consumable || isOwned(new Set(P.owned), it);
  try {
    const { url } = await api('/api/shop/invoice', { item: it.id, lang: S.lang });
    tg.openInvoice(url, async status => {
      btn.disabled = false;
      if (status === 'paid' || status === 'pending') {
        toast(T(status === 'paid' ? 'paid_wait' : 'pay_pending'));
        for (let i = 0; i < 8; i++) { await new Promise(r => setTimeout(r, 1200)); await loadProfile(); if (got()) break; }
        if (got()) { SFX.buy(); notify(); updateCoins(); toast(it.grantCoins ? T('coins_in', { n: num(it.grantCoins) }) : T('item_in', { name: iname(it) })); }
        done();
      } else if (status === 'failed') { toast(T('pay_failed')); done(); }
      else done();
    });
  } catch (e) { btn.disabled = false; toast(T(e.code === 'owned' ? 'already_own' : e.code === 'not_for_sale' ? 'not_for_sale' : 'inv_fail')); done(); }
}

// Profile: Telegram photo + name (synced every open), rank, PRO, stats, and the shortcuts that left the bottom bar.
async function showProfile() {
  const owned = new Set(P.owned), sellable = ITEMS.filter(i => i.slot !== 'pass' && i.slot !== 'bundle' && i.slot !== 'coins' && !i.exclusive), have = sellable.filter(i => owned.has(i.id)).length;
  const pro = (P.proUntil || 0) > Date.now();
  const m = screen(`${header(false)}<main class="profile">
    <section class="pf-card">${avatar(myName(), myPhoto(), 'big')}<div class="pf-id"><h2>${esc(myName())}${pro ? ' <i class="pro-b">PRO</i>' : ''}</h2><small>${P.guest ? T('rk_guest') : T('pf_synced')}</small></div></section>
    <div class="pf-stats"><div id="pf-rank"><b>…</b><small>${T('ranked')}</small></div><div><b>${num(P.coins)}</b><small>Coins</small></div><div><b>${have}/${sellable.length}</b><small>${T('pf_items')}</small></div></div>
    ${pro ? `<p class="pro-on">✅ ${T('pro_until', { d: new Date(P.proUntil).toLocaleDateString(S.lang) })}</p>` : `<button class="lg-pro" id="pf-pro"><i class="pro-b">PRO</i> ${T('lg_go_pro')}</button>`}
    <div class="pf-links">${[['squad', '👕', T('squad')], ['studio', '🎨', T('mode_studio')], ['leagues', '👥', T('lg')], ['official', '⭐', T('ol_title')], ['help', '❓', T('mode_help')], ['feedback', '📮', T('fb_title')], ['cog', '⚙️', T('nav_cog')]]
      .map(([k, ic, t]) => `<button class="pf-link" data-k="${k}"><span>${ic}</span><b>${t}</b><span class="go"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg></span></button>`).join('')}</div>
  </main>${navBar('me')}`, 'm-home');
  bindHeader(m); bindNav(m);
  m.querySelector('#pf-pro')?.addEventListener('click', () => showShop('pass'));
  m.querySelectorAll('.pf-link').forEach(b => b.onclick = () => { SFX.ui(); haptic(); ({ squad: () => showSquad(showProfile), studio: () => showStudio(showProfile), leagues: showLeagues, official: showOfficial, help: showHelp, feedback: showFeedback, cog: showSettings })[b.dataset.k](); });
  if (!P.guest) api('/api/rank', { tab: 'season' }).then(r => { const el = m.querySelector('#pf-rank b'); if (el) el.textContent = `${T('t_' + r.mine.tier)}${r.mine.div ? ' ' + 'III II I'.split(' ')[3 - r.mine.div] : ''}`; }).catch(() => {});
  else m.querySelector('#pf-rank b').textContent = '-';
}

function showFeedback() {
  if (P.guest) return toast(T('fb_guest'));
  let kind = 'bug';
  const o = overlay(`<h2>${T('fb_title')}</h2><p class="fb-s">${T('fb_sub')}</p>
    <div class="seg fb-k">${['bug', 'idea', 'other'].map(k => `<button data-k="${k}" class="${k === kind ? 'on' : ''}">${T('fb_' + k)}</button>`).join('')}</div>
    <textarea id="fb-t" maxlength="1000" rows="6" placeholder="${esc(T('fb_ph'))}"></textarea><small class="fb-n" id="fb-n">0/1000</small>
    <div class="rp-row"><button class="btn" id="fb-x">${T('close')}</button><button class="btn lime" id="fb-go">${T('fb_send')}</button></div>`);
  const t = o.querySelector('#fb-t'), go = o.querySelector('#fb-go');
  o.querySelectorAll('.fb-k button').forEach(b => b.onclick = () => { kind = b.dataset.k; o.querySelectorAll('.fb-k button').forEach(x => x.classList.toggle('on', x === b)); haptic(); });
  t.oninput = () => { o.querySelector('#fb-n').textContent = `${t.value.length}/1000`; };
  o.querySelector('#fb-x').onclick = () => o.remove();
  go.onclick = async () => {
    if (t.value.trim().length < 5) return toast(T('fb_short'));
    go.disabled = true;
    try { await api('/api/feedback', { kind, text: t.value, ctx: `v${(import.meta.url.match(/v=(\d+)/) || [])[1] || '?'} · ${S.lang} · ${innerWidth}x${innerHeight} · ${(window.Telegram?.WebApp?.platform) || 'web'} · ${navigator.userAgent.slice(0, 160)}` });
      o.remove(); toast(T('fb_ok')); SFX.ui?.();
    } catch (e) { go.disabled = false; toast(T(e.code === 'slow_down' ? 'fb_limit' : 'fb_err')); }
  };
  setTimeout(() => t.focus(), 50);
}
function showHelp() {
  const m = screen(`${header(true)}<main class="help"><h2 class="ttl">${T('mode_help')}</h2>
    <ol class="rules">
      ${[T('h_sling'), T('h_hold'), T('h_shots'), T('h_taps', { n: MAX_TAPS }), T('h_power', { n: POWER_CHARGE }), T('h_gk'), T('h_form'), T('h_pen'), T('h_out'), T('h_cam'), T('h_paper')].map(x => `<li>${x}</li>`).join('')}
    </ol></main>`);
  bindHeader(m);
}
function showSettings() {
  const o = overlay(`<h2>${T('settings')}</h2><button class="btn lime" id="lang">${T('language', { v: LANG_NAME[S.lang] })}</button><button class="btn" id="snd">${T('sound', { v: T(S.sound ? 'on' : 'off') })}</button><button class="btn" id="hint">${T('hints', { v: T(S.hints ? 'on' : 'off') })}</button><button class="btn" id="ctrl">${T('controls', { v: T(S.ctrl === 'hold' ? 'ctrl_hold' : 'ctrl_sling') })}</button><button class="btn" id="cam">${T('default_cam', { v: camLabel(S.cam) })}</button><button class="btn" id="squad">${T('edit_squad')}</button><button class="btn ghost" id="cl">${T('close')}</button>`);
  o.querySelector('#lang').onclick = () => { S.lang = LANGS[(LANGS.indexOf(S.lang) + 1) % LANGS.length]; saveS(); document.documentElement.lang = S.lang; closeAllOverlays(); if (!M) showHome(); showSettings(); };
  o.querySelector('#snd').onclick = () => { S.sound = !S.sound; saveS(); showSettings(); };
  o.querySelector('#hint').onclick = () => { S.hints = !S.hints; saveS(); showSettings(); };
  o.querySelector('#cam').onclick = () => { S.cam = CAMS[(CAMS.indexOf(S.cam) + 1) % CAMS.length]; saveS(); showSettings(); };
  o.querySelector('#ctrl').onclick = () => { S.ctrl = S.ctrl === 'hold' ? 'sling' : 'hold'; saveS(); showSettings(); };
  o.querySelector('#squad').onclick = () => { closeAllOverlays(); showSquad(); };
  o.querySelector('#cl').onclick = closeAllOverlays;
}

// ── squad editor + kit studio ──────────────────────────────
async function saveSquad(sq) {
  if (P.guest) { localStorage.setItem('bk/squad', JSON.stringify(sq)); return true; }
  try { P = { ...(await api('/api/squad', sq)), guest: false }; return true; } catch { toast(T('save_fail')); return false; }
}
function showSquad(back = showHome, pickStar = null) {
  const t = teamById(S.team), r = cleanRoster(mySquad().roster, t), stars = { ...(mySquad().stars || {}) }, mine = ITEMS.filter(i => i.slot === 'star' && P.owned.includes(i.id));
  const chip = i => { const it = itemById(stars[i]); return `<button class="star-chip ${it ? 'on r-' + it.rarity : ''}" data-i="${i}" aria-label="${T('star_pick')}">${it ? '⭐' : '+'}</button>`; };
  const m = screen(`${header(true, T('squad'))}<main class="squad"><p class="muted">${T('squad_note')}</p>
    <div class="roster">${r.names.map((n, i) => `<div class="rrow"><span class="pos">${i === 0 ? 'GK' : i < 5 ? 'DEF' : i < 9 ? 'MID' : 'FWD'}</span><input class="num" inputmode="numeric" maxlength="2" value="${r.numbers[i]}" data-i="${i}"><input class="nm" maxlength="12" value="${esc(n)}" data-i="${i}">${chip(i)}</div>`).join('')}</div>
    <p class="warn" id="dupe" hidden>${T('dupe')}</p>
    <div class="cta"><button class="btn" id="reset">${T('reset')}</button><button class="btn lime big" id="save">${T('save_squad')}</button></div></main>`, 'm-shop');
  bindHeader(m, back);
  const read = () => ({ names: [...m.querySelectorAll('.nm')].map(x => x.value), numbers: [...m.querySelectorAll('.num')].map(x => +x.value) });
  const setStar = async (i, id) => { if (id) stars[i] = id; else delete stars[i]; m.querySelector(`.star-chip[data-i="${i}"]`).outerHTML = chip(i); bindChips();
    if (await saveSquad({ ...mySquad(), stars })) { notify(); if (id) toast(T('star_set', { name: iname(itemById(id)), n: read().numbers[i] })); } };
  const sheet = i => {
    const o = overlay(`<div class="star-sheet"><h2>${T('star_pick')}  ·  #${read().numbers[i]} ${esc(read().names[i])}</h2><div class="star-grid">
      <button class="star-opt ${!stars[i] ? 'on' : ''}" data-id=""><span class="sth none">A4</span><b>${T('star_none')}</b></button>
      ${mine.map(it => `<button class="star-opt r-${it.rarity} ${stars[i] === it.id ? 'on' : ''}" data-id="${it.id}"><span class="sth" data-th="${it.id}"></span><b>${esc(iname(it))}</b></button>`).join('')}</div>
      <button class="btn lime" id="st-shop">⭐ ${T('star_shop')}</button><button class="btn ghost" id="st-x">${T('close')}</button></div>`);
    o.querySelectorAll('.star-opt').forEach(b => b.onclick = () => { SFX.ui(); closeAllOverlays(); setStar(i, b.dataset.id || null); });
    o.querySelector('#st-shop').onclick = () => { closeAllOverlays(); showShop('star'); }; o.querySelector('#st-x').onclick = closeAllOverlays;
    L3.thumbs(mine, artCtx(), (id, url) => paint(o.querySelector(`[data-th="${id}"]`), url));
  };
  const bindChips = () => m.querySelectorAll('.star-chip').forEach(b => b.onclick = () => { SFX.ui(); if (P.guest) return toast(T('open_tg_buy')); if (pickStar) { const id = pickStar; pickStar = null; return setStar(+b.dataset.i, id); } sheet(+b.dataset.i); });
  bindChips(); if (pickStar) toast(T('star_pick'));
  const check = () => { const n = read().numbers, d = n.filter((x, i) => n.indexOf(x) !== i); m.querySelector('#dupe').hidden = !d.length; m.querySelectorAll('.num').forEach(x => x.classList.toggle('bad', d.includes(+x.value) || !(+x.value >= 1 && +x.value <= 99))); return !d.length; };
  m.querySelectorAll('.num').forEach(x => x.oninput = () => { x.value = x.value.replace(/\D/g, ''); check(); });
  m.querySelector('#reset').onclick = async () => { await saveSquad({ ...mySquad(), roster: null, stars }); showSquad(back); };
  m.querySelector('#save').onclick = async () => { if (!check()) return toast(T('fix_dupes')); SFX.ui(); if (await saveSquad({ ...mySquad(), roster: read(), stars })) { notify(); toast(T('squad_saved')); back(); } };
}
const SWATCH = ['#d71920', '#ff6a1a', '#ffd400', '#7dff3a', '#0f7a3a', '#00e0c6', '#2a7de1', '#1b3f94', '#7a3cff', '#ff2d95', '#ffffff', '#111111'];
function showStudio(back = showHome) {
  const pack = P.owned.includes('k_studio'), t = teamById(S.team);
  let k = cleanKit(mySquad().kit || { ...t.jerseys[0] }, pack), part = 'base', pv = null;
  const render = () => {
    pv?.close();
    const m = screen(`${header(true, T('mode_studio'))}<main class="studio">
      <div class="spv" id="spv"><small class="hint">${T('drag_spin')}</small></div>
      <div class="opts">
        <label>${T('pattern')}<div class="seg pats">${[...KIT_PATTERNS, ...PREMIUM_PATTERNS].map(p => { const lock = PREMIUM_PATTERNS.includes(p) && !pack; return `<button class="${k.pattern === p ? 'on' : ''} ${lock ? 'lock' : ''}" data-p="${p}">${T('pat_' + p)}${lock ? ' <span class="star"></span>' : ''}</button>`; }).join('')}</div></label>
        <label>${T('colour')}<div class="seg" data-k="part">${['base', 'accent', 'trim', 'number', 'sleeve'].map(v => [v, T('part_' + v)]).map(([v, l]) => `<button class="${part === v ? 'on' : ''}" data-part="${v}"><i style="background:${k[v] || k.base}"></i>${l}</button>`).join('')}</div>
          <div class="sw">${SWATCH.map(c => `<button style="--s:${c}" data-c="${c}" aria-label="${c}"></button>`).join('')}<input type="color" value="${k[part] || k.base}" id="cc" aria-label="${T('other_colour')}"></div></label>
        <label>${T('collar')}<div class="seg">${COLLARS.map(c => `<button class="${k.collar === c ? 'on' : ''}" data-col="${c}">${T('col_' + c)}</button>`).join('')}</div></label>
        <label>${T('sponsor')}<input class="txt" id="sp" maxlength="12" value="${esc(k.sponsor)}"></label>
      </div>
      <div class="cta"><button class="btn" id="squad">${T('edit_squad')}</button><button class="btn lime big" id="save">${T('save_wear')}</button></div></main>`, 'm-shop');
    bindHeader(m, () => { pv?.close(); back(); });
    const ctx = { ...artCtx(), kit: k };
    pv = L3.preview(m.querySelector('#spv'), itemById(P.equip.paper) || itemById('p_a4'), ctx);
    const set = (key, v) => { k = cleanKit({ ...k, [key]: v }, true); render(); };
    m.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { if (b.classList.contains('lock')) { pv.close(); return itemSheet(itemById('k_studio'), 'studio'); } SFX.ui(); set('pattern', b.dataset.p); });
    m.querySelectorAll('[data-part]').forEach(b => b.onclick = () => { part = b.dataset.part; render(); });
    m.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { SFX.ui(); set(part, b.dataset.c); });
    m.querySelector('#cc').onchange = e => set(part, e.target.value);
    m.querySelectorAll('[data-col]').forEach(b => b.onclick = () => set('collar', b.dataset.col));
    m.querySelector('#sp').onchange = e => set('sponsor', e.target.value);
    m.querySelector('#squad').onclick = () => { pv.close(); showSquad(() => showStudio(back)); };
    m.querySelector('#save').onclick = async () => { const kit = cleanKit(k, pack); if (await saveSquad({ ...mySquad(), kit })) { S.kit = -1; saveS(); notify(); toast(T(kit.pattern !== k.pattern ? 'studio_locked' : 'studio_ok')); pv.close(); back(); } };
  };
  render();
}

// ── menu backdrop: slow orbit around a staged kickoff ──────
function stageMenuScene() {
  const setup = localSetup([true, true]); const e = new Engine(setup);
  setup.stars = [mySquad().stars || {}, {}]; const art = stageWorld(setup, [P.equip.paper, 'p_a4'], P.equip); world.setTeams(e, art.teams, art.kits, art.looks, art.keepers, art.stars);
  world.pieces.forEach(p => { p.root.position.set(p.data.x, 0, p.data.z); p.root.rotation.y = e.attackSign(p.data.team) > 0 ? 0 : Math.PI; });
  world.ballMesh.position.set(0, 0.16, 0); world.showAim(null);
}

// ── main loop ──────────────────────────────────────────────
let last = performance.now(), fpsAcc = 0, fpsN = 0;
// Old laptops / phones: when the game runs under 40 fps, drop sharpness one step at a time, then shadows,
// and remember it so the next launch starts in the light mode (smaller textures, fewer crowd pieces, no smoothing).
let gfxBad = 0;
function gfxGuard(fps) {
  if (fps >= 40) { gfxBad = 0; return; } if (++gfxBad < 2) return; gfxBad = 0; // two slow windows in a row, so a loading hitch alone never triggers it
  const pr = world.r.getPixelRatio();
  if (pr > 1) { world.r.setPixelRatio(Math.max(1, pr - 0.25)); world.resize(); }
  else if (world.sun.castShadow) { world.sun.castShadow = false; world.r.shadowMap.enabled = false; }
  else if (pr > 0.75) { world.r.setPixelRatio(0.75); world.resize(); }
  localStorage.setItem('bk/lowgfx', '1');
}
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000); last = now; const t = now / 1000;
  if (M?.replaying) M.replaying.step(dt);
  else if (M) { tick(dt); syncVisuals(dt, t); updateHud(); }
  else if (window.__frz) {} // QA: camera held still for screenshots
  else { menuSpin += dt * 0.08; const r = 17; world.cam.fov = 45; world.cam.updateProjectionMatrix(); world.cam.position.set(Math.sin(menuSpin) * r, 9, Math.cos(menuSpin) * r); world.cam.lookAt(0, 0, 0); }
  world.update(dt, t); world.render();
  // real elapsed time: dt is capped, which would hide a slow device
  fpsAcc += Math.min(1, (now - (loop.prev || now)) / 1000); loop.prev = now; fpsN++; if (fpsAcc > 2) { window.__bkFps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; if (now > 6000 && !document.hidden) gfxGuard(window.__bkFps); }
}

// QA hook for headless verification
window.__bk = {
  get M() { return M; }, get P() { return P; }, world, S,
  snap: () => M && { mode: M.mode, phase: M.e.phase, score: M.e.score, turn: M.e.turnTeam, clock: +M.e.clock.toFixed(1), human: humanTurn(), kicker: M.e.kicker?.id, ball: [+M.e.ball.x.toFixed(2), +M.e.ball.z.toFixed(2)], over: M.over },
  shoot: (dx, dz, power, shot = 0) => humanTurn() && (act({ t: 'aim', dx, dz, power, shot }), true),
  ballScreen, beginCpu, beginLocal, showShop, showHome, showSquad, playReplays, sharePoster, showLineup, act, showProfile, showRanked,
};

// Stop Telegram's swipe-down-to-close while aiming.
// 1) disableVerticalSwipes (Telegram 7.7+). 2) Older clients: keep the document scrolled 100px down so a
// downward drag scrolls nothing instead of collapsing the app. 3) Never let the browser treat a game drag as a scroll.
function lockSwipe() {
  const pad = 100, b = document.body;
  Object.assign(b.style, { overflowY: 'hidden', marginTop: pad + 'px', height: innerHeight + pad + 'px', paddingBottom: pad + 'px' });
  const keep = () => { if (scrollY < pad) scrollTo(0, pad); };
  keep(); addEventListener('scroll', keep, { passive: true });
  addEventListener('resize', () => { b.style.height = innerHeight + pad + 'px'; keep(); });
  document.addEventListener('touchmove', ev => { if (!ev.target.closest('#menu, .ov .sheet')) ev.preventDefault(); }, { passive: false });
}
async function boot() {
  try { tg?.ready(); tg?.expand(); tg?.disableVerticalSwipes?.(); tg?.setHeaderColor?.('#4aa8ff'); tg?.setBackgroundColor?.('#4aa8ff'); } catch {}
  lockSwipe();
  await document.fonts?.ready;
  await loadProfile();
  stageMenuScene(); requestAnimationFrame(loop);
  const qs = new URLSearchParams(location.search), sp = tg?.initDataUnsafe?.start_param || '';
  const room = qs.get('room') || (/^room_/.test(sp) ? sp.slice(5) : ''), lgc = qs.get('league') || (/^lg_/.test(sp) ? sp.slice(3).split('_')[0] : ''), by = +(qs.get('by') || sp.split('_')[2] || 0);
  showHome();
  if (/^[A-Z0-9]{4,8}$/.test(room || '')) joinRoom(room);
  else if (/^[A-Z0-9]{6}$/i.test(lgc || '')) joinLeagueCode(lgc, by);
  else if (qs.get('official') || sp === 'official') showOfficial();
  $('#boot')?.classList.add('gone');
}
boot();
