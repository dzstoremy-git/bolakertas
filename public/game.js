// game.js : Bola Kertas app. Menus, shop, match loop, camera, controls, HUD, sound, online.
import * as THREE from 'three';
import { Engine, FIELD, STEP, SHOT_TYPES, FORMATIONS, MAX_TAPS, POWER_CHARGE, MAX_DRAG, predictPath, isRest, BASE_STATS, statF } from './engine.js?v=26';
import { LEAGUES, ALL_TEAMS, teamById, rosterFor, cleanRoster, cleanKit, KIT_PATTERNS, PREMIUM_PATTERNS, COLLARS } from './teams.js?v=26';
import { ITEMS, itemById, DEFAULT_EQUIP, RARITY, rarityOf, perksUpTo, isOwned, completeSet, aiEquip } from './items.js?v=26';
import { World, Q } from './scene.js?v=26';
import { crest, ink } from './art.js?v=26';
import * as L3 from './locker3d.js?v=26';
import { tr, trMs, itemName, itemDesc, langFrom, LANGS, LANG_NAME } from './i18n.js?v=26';

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
  return { teams: [t0, t1], kits, keepers: auto.keepers, looks: looksFor(paperIds) };
}

// ── match lifecycle ────────────────────────────────────────
function startMatch({ setup, mode, seat = 0, mid = null, paperIds, names }) {
  closeAllOverlays();
  const e = new Engine(setup);
  const art = stageWorld(setup, paperIds, { ...P.equip, ...(setup.home || {}) }); // home side's venue, pitch and ball for everyone
  world.setTeams(e, art.teams, art.kits, art.looks, art.keepers);
  M = { e, setup, mode, seat, mid, art, names: names || [art.teams[0].short, art.teams[1].short], actions: [], shot: 0, ps: false,
    aim: null, cpuWait: 0, turnLeft: null, turnDeadline: 0, halfWait: 0, lastMsg: 0, shake: 0, pending: null, over: false, paused: false,
    camYaw: 0, camMode: S.cam, zoom: 1, goalCam: 0, slow: 1, kickoffHint: true };
  world.pieces.forEach(p => { p.x = p.data.x; p.z = p.data.z; p.drop = p.rank >= 4 ? 1.2 + p.data.id * 0.05 : 0; });
  $('#menu').hidden = true; $('#hud').hidden = false; document.body.classList.add('playing');
  buildHud(); onTurnStart(); SFX.whistle(false);
  setTimeout(() => { if (M && S.hints) toast(T(S.ctrl === 'sling' ? 'hint_sling' : 'hint_hold'), 5200); }, setup.coin ? 4000 : 600);
}
const humanTurn = () => M && !M.over && !M.queued && M.e.phase === 'aim' && (M.mode === 'local' || (M.mode === 'cpu' && M.e.turnTeam === 0) || (M.mode === 'online' && M.e.turnTeam === M.seat && !M.pending && !M.sent));
const myTeam = () => M.mode === 'online' ? M.seat : M.mode === 'local' ? M.e.turnTeam : 0;

function onTurnStart() {
  const e = M.e; M.shot = 0; M.ps = false; M.aim = null; M.sent = false; M.cpuWait = 0.9 + Math.random() * 0.4; M.camYaw = 0;
  if (M.mode !== 'online') { M.turnLeft = 15; }
  updateShotChips(); updatePlayerCard();
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
    }
    else if (ev.type === 'turn') M.turnFlag = true;
  }
  e.events.length = 0;
}

function tick(dt) {
  const e = M.e;
  if (M.paused) return;
  const sim = dt * M.slow;
  // drive non-human turns
  if (e.phase === 'aim' && !M.over) {
    if (M.mode === 'cpu' && e.turnTeam === 1 && !M.queued) {
      M.cpuWait -= dt;
      if (M.cpuWait <= 0.6 && !M.cpuPlan) M.cpuPlan = e.cpuAction(); // same RNG draw the server replay makes
      if (M.cpuPlan && M.cpuWait <= 0) act(M.cpuPlan);
    }
    else if (M.mode !== 'online' && M.turnLeft !== null) { M.turnLeft -= dt; if (M.turnLeft <= 0) { beacon({ timeout: true, downs: M.downs || 0, held: !!M.hold, q: !!M.queued, phase: e.phase, w: innerWidth, h: innerHeight }); act({ t: 'skip' }); } }
  }
  if (M.queued && (M.queued.t -= dt) <= 0) { const a = M.queued.a; M.queued = null; if (e._applyAction(a)) M.actions.push(a); else beacon({ rejected: a, phase: e.phase, kicker: e.kicker?.id }); }
  if (e.phase === 'halftime' && M.mode !== 'online') { M.halfWait += dt; if (M.halfWait > 2.6) { M.halfWait = 0; act({ t: 'half' }); } }
  e.acc += sim;
  let n = 0; while (e.acc >= STEP && n++ < 8) { snapPrev(e); e.step(STEP); e.acc -= STEP; }
  M.alpha = Math.min(1, e.acc / STEP);
  drainEvents();
  if (M.pending && isRest(e)) { e.importState(M.pending); M.pending = null; M.turnFlag = true; }
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
    vp.root.rotation.set(Math.sin(t * 30 + p.id) * p.wobble * 0.18, (e.attackSign(p.team) > 0 ? 0 : Math.PI), Math.sin(t * 26 + p.id) * p.wobble * 0.12);
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
  const viewTeam = (M.mode === 'cpu' && e.turnTeam === 1) || (M.mode === 'online' && e.turnTeam !== M.seat) ? myTeam() : e.turnTeam;
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
  if (ev.key >= '1' && ev.key <= '3') setShot(+ev.key - 1);
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
  '<path class="pl" d="M19 23L22 14L25 23M31 23L34 14L37 23"/><path class="tr" d="M10 17Q28 -12 46 18"/>'];
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
    <button class="chip ghost" id="cam-btn"><svg viewBox="0 0 24 24"><path d="M4 7h3l2-2h6l2 2h3v12H4z M12 10a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7" fill="none" stroke="currentColor" stroke-width="1.8"/></svg><span>${camLabel(M.camMode)}</span></button>
    <button class="chip ghost sq" id="pause-btn" aria-label="${T('pause')}"><svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg></button>
  </div>
  <div class="bottom">
    <div class="shots" id="shots">${SHOT_TYPES.map((s, i) => `<button class="shot" data-i="${i}" aria-label="${T('shot' + i)}: ${T('shot' + i + '_s')}"><svg viewBox="0 0 56 26" aria-hidden="true"><path class="gl" d="M2 23.5H54"/>${SHOT_ICON[i]}<circle class="gh" cx="49" cy="20" r="3.2"/><circle class="bl" cx="7" cy="20" r="3.4"/></svg><b>${T('shot' + i)}</b><small>${T('shot' + i + '_s')}</small><kbd>${i + 1}</kbd></button>`).join('')}</div>
    <div class="pcard" id="pcard"><div class="pc-badge"></div><div class="pc-main"><b id="pc-name"></b><div class="charge" id="charge">${'<i></i>'.repeat(POWER_CHARGE)}</div><small id="pc-state"></small></div><div class="pc-timer" id="pc-timer"><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" class="trk"/><circle cx="20" cy="20" r="17" class="arc" id="arc"/></svg><b id="tl">15</b></div></div>
    <div class="meter" id="meter"><i id="meter-fill"></i><b id="meter-txt">${T('power')}</b></div>
    <button class="power" id="power-btn" hidden>${T('power_shot')}</button>
  </div>
  <div class="banner" id="banner"><b></b><small></small></div>`;
  const myRank = M.mode === 'local' ? 0 : RARITY[itemById(P.equip.paper)?.rarity]?.rank || 0, myCol = rarityOf(itemById(P.equip.paper)).color;
  hud.style.setProperty('--rc', myCol); hud.dataset.rank = myRank; M.myRank = myRank;
  hud.querySelector('.sb-c0').append(crestCanvas(t0)); hud.querySelector('.sb-c1').append(crestCanvas(t1));
  hud.querySelectorAll('.shot').forEach(b => b.onclick = () => setShot(+b.dataset.i));
  $('#cam-btn').onclick = toggleCam; $('#pause-btn').onclick = pause; $('#power-btn').onclick = firePower;
}
function updateShotChips() {
  if (!M) return;
  document.querySelectorAll('.shot').forEach(b => b.classList.toggle('on', +b.dataset.i === M.shot));
  const show = humanTurn(); $('#shots').classList.toggle('dim', !show);
  const pb = $('#power-btn'); if (pb) { const can = show && M.e.canPowerStrike(); pb.hidden = !can; pb.classList.toggle('armed', M.ps); }
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
  const sp = T({ kickoff: 'sp_kickoff', corner: 'sp_corner', goalkick: 'sp_goalkick', throw: 'sp_throw' }[e.setPiece] || 'sp_live');
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
    if (!M) return;
    const title = M.mode === 'local' ? (draw ? T('draw') : T('x_wins', { name: esc(M.names[e.winner]) })) : T(draw ? 'draw' : won ? 'win' : 'lose');
    const o = overlay(`<div class="res ${won ? 'win' : draw ? 'draw' : 'lose'}"><small>${T('fulltime')}</small><h2>${title}</h2>
      <div class="final"><span>${esc(M.names[0])}</span><b>${e.score[0]}</b><i>:</i><b>${e.score[1]}</b><span>${esc(M.names[1])}</span></div>
      <div class="reward" id="reward">${M.mode === 'cpu' ? T(P.guest ? 'reward_guest' : 'reward_wait') : M.mode === 'online' && M.forfeit ? T('opp_left') : ''}</div></div>
      <button class="btn lime" id="again">${T(M.mode === 'online' ? 'rematch' : 'play_again')}</button><button class="btn" id="shop2">${T('locker_btn')}</button><button class="btn ghost" id="home">${T('main_menu')}</button>`);
    o.querySelector('#home').onclick = quitMatch;
    o.querySelector('#shop2').onclick = () => { quitMatch(); showShop(); };
    o.querySelector('#again').onclick = () => {
      if (M.mode === 'online') { M.ws?.send(JSON.stringify({ t: 'rematch' })); o.querySelector('#again').textContent = T('waiting_opp'); o.querySelector('#again').disabled = true; }
      else if (M.mode === 'cpu') { const m = M; M = null; beginCpu(); } else { beginLocal(); }
    };
    if (M.mode === 'cpu' && M.mid) {
      try { const r = await api('/api/match/finish', { mid: M.mid, actions: M.actions }); P = { ...r.profile, guest: false }; updateCoins();
        $('#reward').innerHTML = `<span class="coin"></span> ${T('reward_got', { n: r.reward })}${r.capped ? ` <small>${T('cap_hit')}</small>` : ''}`; if (r.reward) SFX.buy(); }
      catch (err) { $('#reward').textContent = T('reward_fail'); }
    }
  }, 1600);
}

// ── start helpers ──────────────────────────────────────────
function localSetup(cpu) {
  const t0 = teamById(S.team), t1 = teamById(S.opp === S.team ? ALL_TEAMS.find(t => t.id !== S.team).id : S.opp), kk = pickKits(t0, t1, S.kit);
  return { seed: (Math.random() * 2 ** 32) >>> 0, minutes: S.minutes, halves: true, powerStrike: true, layout: 'spread', lockstep: true, turnLimit: 15, cpu, cpuSkill: S.skill,
    formations: [S.formation, '4-4-2'], teams: [t0.id, t1.id], kits: [S.kit === -1 && mySquad().kit ? 'custom' : kk.kits[0].id, kk.kits[1].id], rosters: [mySquad().roster ? cleanRoster(mySquad().roster, t0) : rosterFor(t0), rosterFor(t1)],
    custom: [S.kit === -1 ? cleanKit(mySquad().kit, P.owned.includes('k_studio')) : null, null],
    paper: [itemById(P.equip.paper)?.stats || BASE_STATS, BASE_STATS] };
}
async function beginCpu() {
  const call = await pickSide(true); if (!call) return;
  let setup = localSetup([false, true]), mid = null;
  if (!P.guest) {
    try { const r = await api('/api/match/start', { team0: S.team, team1: setup.teams[1], kit0: setup.kits[0], kit1: setup.kits[1], formation: S.formation, skill: S.skill, minutes: S.minutes, call }); setup = r.setup; mid = r.mid; }
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
const COIN = () => `<div class="coin3d" id="coin"><i class="cf k"><b>${T('heads_s')}</b><small>${T('heads')}</small></i><i class="cf b"><b>${T('tails_s')}</b><small>${T('tails')}</small></i></div>`;
function pickSide(caller, online = false) {
  return new Promise(res => {
    const o = overlay(`<div class="toss"><small class="kick">${T('referee')}</small><h2>${T('coin_toss')}</h2>${COIN()}
      ${caller ? `<p class="muted">${T('toss_pick')}</p>
      <div class="row2"><button class="btn lime big" data-s="k">${T('heads')}</button><button class="btn lime big" data-s="b">${T('tails')}</button></div>${online ? '' : `<button class="btn ghost" id="cx">${T('cancel')}</button>`}`
      : `<p class="muted">${T('toss_wait')}</p><div class="spinner"></div>`}</div>`);
    o.classList.add('ov-toss');
    o.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { SFX.ui(); haptic('medium'); o.querySelectorAll('[data-s]').forEach(x => x.disabled = true); b.classList.add('picked'); o.querySelector('#coin').classList.add('spin'); setTimeout(() => res(b.dataset.s), 450); });
    o.querySelector('#cx')?.addEventListener('click', () => { closeAllOverlays(); res(null); });
    if (!caller) res(null);
  });
}
function revealToss(coin, iWon, oppName) {
  if (M && M.mode !== 'online') M.paused = true;
  const o = overlay(`<div class="toss"><small class="kick">${T('referee')}</small><h2>${T('coin_toss')}</h2>${COIN()}<p class="tres" id="tres">&nbsp;</p></div>`); o.classList.add('ov-toss');
  const c = o.querySelector('#coin'); c.classList.add('flip', coin === 'b' ? 'land-b' : 'land-k'); SFX.whistle(false);
  setTimeout(() => { const r = o.querySelector('#tres'); if (!r) return;
    r.innerHTML = `<b>${T(coin === 'k' ? 'heads' : 'tails')}!</b> ${iWon ? T('toss_won') : T('toss_lost', { name: esc(oppName) })}`;
    iWon ? (notify('success'), SFX.buy()) : haptic('rigid'); }, 1500);
  setTimeout(() => { o.remove(); if (M) M.paused = false; }, 3600);
}

// ── online ─────────────────────────────────────────────────
const wsUrl = p => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${p}`;
function joinRoom(code) {
  const o = overlay(`<h2>${T('room', { code: esc(code) })}</h2><p class="muted" id="rstat">${T('connecting')}</p><div class="code">${esc(code)}</div><button class="btn lime" id="share">${T('invite')}</button><button class="btn ghost" id="cx">${T('cancel')}</button>`);
  const ws = new WebSocket(wsUrl(`/ws/room/${code}?pid=${encodeURIComponent(PID)}`)); let state = 'wait';
  o.querySelector('#cx').onclick = () => { state = 'cancel'; ws.close(); closeAllOverlays(); };
  o.querySelector('#share').onclick = () => {
    const link = `https://t.me/BolaKertasBot?start=room_${code}`, text = T('share_text', { code });
    if (tg?.openTelegramLink) tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
    else navigator.clipboard?.writeText(link).then(() => toast(T('link_copied')));
  };
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', initData, profile: { name: P.name, team: S.team, kit: S.kit === -1 ? 'custom' : teamById(S.team).jerseys[S.kit]?.id, formation: S.formation } }));
  ws.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.t === 'waiting') { const s = $('#rstat'); if (s) s.textContent = T('room_wait'); }
    else if (m.t === 'err') { toast(T(m.msg === 'room-full' ? 'room_full' : m.msg === 'no-room' ? 'room_gone' : 'oops')); if (m.state && M) { M.e.importState(m.state); M.sent = false; } if (!M) closeAllOverlays(); }
    else if (m.t === 'toss') { if (M) { M.closing = false; } pickSide(m.caller, true).then(side => { if (m.caller && side) ws.send(JSON.stringify({ t: 'call', side })); }); }
    else if (m.t === 'setup') {
      const fresh = state !== 'play'; state = 'play';
      startMatch({ setup: m.setup, mode: 'online', seat: m.seat, paperIds: m.setup.paperIds || ['p_a4', 'p_a4'], names: m.setup.names });
      M.ws = ws; M.e.importState(m.state); M.turnDeadline = performance.now() + (m.left || 0); M.turnFlag = true;
      if (m.setup.coin && (fresh || m.state?.clock === 0)) revealToss(m.setup.coin, m.setup.first === m.seat, T('opp_name'));
    }
    else if (!M) return;
    else if (m.t === 'act') { M.sent = false; if (!M.e._applyAction(m.a)) M.e.importState(m.state); else M.pending = m.state; M.turnDeadline = performance.now() + (m.left || 0); }
    else if (m.t === 'over') { M.forfeit = !!m.forfeit; if (m.state) M.e.importState(m.state); M.e.phase = 'over'; M.e.winner = m.winner; }
    else if (m.t === 'opp') toast(T(m.here ? 'opp_back' : 'opp_gone'), 3500);
    else if (m.t === 'rematch') toast(T(m.seats.length < 2 ? 'rematch_asked' : 'rematch_go'));
  };
  ws.onclose = () => { if (state === 'cancel' || M?.closing) return; if (M && M.mode === 'online' && !M.over) { toast(T('conn_lost')); setTimeout(() => { if (M && !M.over) { const c = code; M = null; joinRoom(c); } }, 1500); } };
}
function findMatch() {
  const o = overlay(`<h2>${T('finding')}</h2><div class="spinner"></div><p class="muted">${T('finding_note')}</p><button class="btn" id="inv">${T('invite_only')}</button><button class="btn ghost" id="cx">${T('cancel')}</button>`);
  const ws = new WebSocket(wsUrl('/ws/lobby?pid=' + encodeURIComponent(PID))); let done = false;
  ws.onopen = () => ws.send(JSON.stringify({ t: 'queue' }));
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.t === 'matched') { done = true; ws.close(); joinRoom(m.code); } };
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
    <button class="play" id="kick"><b>${T('play')}</b><svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z" fill="currentColor" stroke-linejoin="round"/></svg></button>
    <section class="modes">
      ${[['cpu', T('mode_cpu'), T('mode_cpu_s')], ['two', T('mode_two'), T('mode_two_s')], ['web', T('mode_web'), T('mode_web_s'), T('tag_beta')], ['shop', T('mode_shop'), T('mode_shop_s', { a: have, b: sellable.length })], ['studio', T('mode_studio'), T('mode_studio_s'), T('tag_new')], ['help', T('mode_help'), T('mode_help_s')]]
        .map(([k, t, s, tag], i) => `<button class="mode m-${k}" data-k="${k}" style="--i:${i}"><span class="mi" data-icon="${k}"></span><span class="mt"><b>${t}</b><small>${s}</small></span>${tag ? `<em>${tag}</em>` : ''}<span class="go"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg></span></button>`).join('')}
    </section>
  </main><footer class="foot">${T('footer')}</footer>
  <nav class="nav"><button data-n="home" class="on"><i><svg viewBox="0 0 24 24"><path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z" fill="currentColor" stroke="#2a1f5c" stroke-width="1.6" stroke-linejoin="round"/></svg></i>${T('nav_home')}</button><button data-n="shop" class=""><i><svg viewBox="0 0 24 24"><path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2" fill="currentColor" stroke="#2a1f5c" stroke-width="1.6" stroke-linejoin="round"/></svg></i>${T('nav_shop')}</button><button data-n="play" class="mid"><i><svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z" fill="#fff" stroke="#2a1f5c" stroke-width="2" stroke-linejoin="round"/></svg></i>${T('nav_play')}</button><button data-n="studio" class=""><i><svg viewBox="0 0 24 24"><path d="M8 3l4 2 4-2 5 4-3 3-2-1v12H8V9l-2 1-3-3z" fill="currentColor" stroke="#2a1f5c" stroke-width="1.6" stroke-linejoin="round"/></svg></i>${T('nav_studio')}</button><button data-n="cog" class=""><i><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="currentColor" stroke="#2a1f5c" stroke-width="1.6"/><circle cx="12" cy="12" r="2.6" fill="#fffaf0" stroke="#2a1f5c" stroke-width="1.6"/></svg></i>${T('nav_cog')}</button></nav>`, 'm-home');
  m.querySelectorAll('.nav button').forEach(b => b.onclick = () => { SFX.ui(); haptic(); ({ home: () => {}, shop: () => showShop('paper'), play: beginCpu, studio: () => showStudio(), cog: showSettings })[b.dataset.n](); });
  bindHeader(m);
  m.querySelector('#kick').onclick = () => { SFX.ui(); beginCpu(); };
  m.querySelectorAll('.mode').forEach(b => b.onclick = () => { SFX.ui(); haptic(); ({ cpu: () => showSetup('cpu'), two: () => showSetup('local'), web: showOnline, shop: () => showShop('paper'), studio: () => showStudio(), help: showHelp })[b.dataset.k](); });
  (async () => { for (const k of ['hero', 'cpu', 'two', 'web', 'shop', 'studio', 'help']) { const url = await L3.icon(k, ctx); if (!m.isConnected) return; paint(k === 'hero' ? m.querySelector('#hero-img') : m.querySelector(`[data-icon="${k}"]`), url); } })();
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
  m.querySelector('#find').onclick = findMatch; m.querySelector('#make').onclick = createRoom;
  (async () => { const ctx = artCtx(); for (const k of ['web', 'two']) { const url = await L3.icon(k, ctx); if (m.isConnected) m.querySelectorAll(`[data-icon="${k}"]`).forEach(el => paint(el, url)); } })();
  const inp = m.querySelector('#code'); inp.oninput = () => inp.value = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  m.querySelector('#join').onclick = () => inp.value.length >= 4 ? joinRoom(inp.value) : toast(T('enter_code'));
}

const SLOT_TABS = ['coins', 'paper', 'bundle', 'pitch', 'venue', 'ball', 'fx', 'studio', 'pass'];
function statBars(st) {
  return `<div class="stats">${[[T('stat_power'), 'power'], [T('stat_weight'), 'weight'], [T('stat_control'), 'control']].map(([l, k]) => { const v = st[k], p = (v - 85) / 30 * 100; return `<div><span>${l}</span><i><b style="width:${p}%" class="${v > 100 ? 'up' : v < 100 ? 'down' : ''}"></b></i><em>${v === 100 ? T('stat_base') : `${v > 100 ? '+' : ''}${v - 100}%`}</em></div>`; }).join('')}</div>`;
}
const priceHtml = it => it.free ? T('free') : it.coins ? `<span class="coin"></span>${num(it.coins)}` : `<span class="star"></span>${it.stars}`;
const itemState = (it, owned) => { const have = !it.consumable && isOwned(owned, it), eq = it.grants ? it.grants.every(g => Object.values(P.equip).includes(g)) : P.equip[it.slot] === it.id; return { have, eq }; };

function showShop(slot = 'paper') {
  const owned = new Set(P.owned), items = ITEMS.filter(i => i.slot === slot).sort((a, b) => (RARITY[a.rarity]?.rank || 0) - (RARITY[b.rarity]?.rank || 0));
  const m = screen(`${header(true, T('mode_shop'))}<main class="shop">
    <div class="tabs">${SLOT_TABS.map(k => `<button class="tab ${k === slot ? 'on' : ''}" data-s="${k}">${T('tab_' + k)}</button>`).join('')}</div>
    ${slot === 'paper' ? `<p class="muted">${T('note_paper')}</p>` : slot === 'bundle' ? `<p class="muted">${T('note_bundle')}</p>` : ''}
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
  </main>`, 'm-shop');
  bindHeader(m);
  m.querySelectorAll('.tab').forEach(b => b.onclick = () => { SFX.ui(); showShop(b.dataset.s); });
  m.querySelectorAll('.item').forEach(card => card.onclick = () => { SFX.ui(); haptic(); itemSheet(itemById(card.dataset.id), slot); });
  m.querySelectorAll('.pack').forEach(card => card.onclick = () => { haptic(); buyOrEquip(itemById(card.dataset.id), 'buy', card.querySelector('.btn'), () => showShop('coins')); });
  if (slot === 'coins') return;
  L3.thumbs(items, artCtx(), (id, url) => { if (m.isConnected) paint(m.querySelector(`.item[data-id="${id}"] .ith`), url); });
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
  const c0 = P.coins, got = () => it.grantCoins ? P.coins > c0 : it.consumable || isOwned(new Set(P.owned), it);
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
  } catch (e) { btn.disabled = false; toast(T(e.code === 'owned' ? 'already_own' : 'inv_fail')); done(); }
}

function showHelp() {
  const m = screen(`${header(true)}<main class="help"><h2 class="ttl">${T('mode_help')}</h2>
    <ol class="rules">
      ${[T('h_sling'), T('h_hold'), T('h_shots'), T('h_taps', { n: MAX_TAPS }), T('h_power', { n: POWER_CHARGE }), T('h_gk'), T('h_out'), T('h_cam'), T('h_paper')].map(x => `<li>${x}</li>`).join('')}
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
function showSquad(back = showHome) {
  const t = teamById(S.team), r = cleanRoster(mySquad().roster, t);
  const m = screen(`${header(true, T('squad'))}<main class="squad"><p class="muted">${T('squad_note')}</p>
    <div class="roster">${r.names.map((n, i) => `<div class="rrow"><span class="pos">${i === 0 ? 'GK' : i < 5 ? 'DEF' : i < 9 ? 'MID' : 'FWD'}</span><input class="num" inputmode="numeric" maxlength="2" value="${r.numbers[i]}" data-i="${i}"><input class="nm" maxlength="12" value="${esc(n)}" data-i="${i}"></div>`).join('')}</div>
    <p class="warn" id="dupe" hidden>${T('dupe')}</p>
    <div class="cta"><button class="btn" id="reset">${T('reset')}</button><button class="btn lime big" id="save">${T('save_squad')}</button></div></main>`, 'm-shop');
  bindHeader(m, back);
  const read = () => ({ names: [...m.querySelectorAll('.nm')].map(x => x.value), numbers: [...m.querySelectorAll('.num')].map(x => +x.value) });
  const check = () => { const n = read().numbers, d = n.filter((x, i) => n.indexOf(x) !== i); m.querySelector('#dupe').hidden = !d.length; m.querySelectorAll('.num').forEach(x => x.classList.toggle('bad', d.includes(+x.value) || !(+x.value >= 1 && +x.value <= 99))); return !d.length; };
  m.querySelectorAll('.num').forEach(x => x.oninput = () => { x.value = x.value.replace(/\D/g, ''); check(); });
  m.querySelector('#reset').onclick = async () => { await saveSquad({ ...mySquad(), roster: null }); showSquad(back); };
  m.querySelector('#save').onclick = async () => { if (!check()) return toast(T('fix_dupes')); SFX.ui(); if (await saveSquad({ ...mySquad(), roster: read() })) { notify(); toast(T('squad_saved')); back(); } };
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
  const art = stageWorld(setup, [P.equip.paper, 'p_a4'], P.equip); world.setTeams(e, art.teams, art.kits, art.looks, art.keepers);
  world.pieces.forEach(p => { p.root.position.set(p.data.x, 0, p.data.z); p.root.rotation.y = e.attackSign(p.data.team) > 0 ? 0 : Math.PI; });
  world.ballMesh.position.set(0, 0.16, 0); world.showAim(null);
}

// ── main loop ──────────────────────────────────────────────
let last = performance.now(), fpsAcc = 0, fpsN = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000); last = now; const t = now / 1000;
  if (M) { tick(dt); syncVisuals(dt, t); updateHud(); }
  else { menuSpin += dt * 0.08; const r = 17; world.cam.fov = 45; world.cam.updateProjectionMatrix(); world.cam.position.set(Math.sin(menuSpin) * r, 9, Math.cos(menuSpin) * r); world.cam.lookAt(0, 0, 0); }
  world.update(dt, t); world.render();
  fpsAcc += dt; fpsN++; if (fpsAcc > 2) { window.__bkFps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
}

// QA hook for headless verification
window.__bk = {
  get M() { return M; }, get P() { return P; }, world, S,
  snap: () => M && { mode: M.mode, phase: M.e.phase, score: M.e.score, turn: M.e.turnTeam, clock: +M.e.clock.toFixed(1), human: humanTurn(), kicker: M.e.kicker?.id, ball: [+M.e.ball.x.toFixed(2), +M.e.ball.z.toFixed(2)], over: M.over },
  shoot: (dx, dz, power, shot = 0) => humanTurn() && (act({ t: 'aim', dx, dz, power, shot }), true),
  ballScreen, beginCpu, beginLocal, showShop, showHome,
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
  const room = new URLSearchParams(location.search).get('room') || (tg?.initDataUnsafe?.start_param || '').replace(/^room_/, '');
  showHome();
  if (/^[A-Z0-9]{4,8}$/.test(room || '')) joinRoom(room);
  $('#boot')?.classList.add('gone');
}
boot();
