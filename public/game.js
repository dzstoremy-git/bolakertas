// game.js : Bola Kertas app. Menus, shop, match loop, camera, controls, HUD, sound, online.
import * as THREE from 'three';
import { Engine, FIELD, STEP, SHOT_TYPES, FORMATIONS, MAX_TAPS, POWER_CHARGE, MAX_DRAG, predictPath, isRest, BASE_STATS, statF } from './engine.js';
import { LEAGUES, ALL_TEAMS, teamById, rosterFor } from './teams.js';
import { ITEMS, itemById, DEFAULT_EQUIP } from './items.js';
import { World, Q } from './scene.js';
import { paperThumb, paperSurface, pitchTexture, ballTexture, crest, ink } from './art.js';

const tg = window.Telegram?.WebApp;
const initData = tg?.initData || '';
const $ = s => document.querySelector(s);
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const haptic = (k = 'light') => { try { tg?.HapticFeedback?.impactOccurred?.(k); } catch {} };
const notify = (k = 'success') => { try { tg?.HapticFeedback?.notificationOccurred?.(k); } catch {} };
const PID = localStorage.getItem('bk/pid') || (() => { const p = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('bk/pid', p); return p; })();

// ── settings + profile ─────────────────────────────────────
const S = Object.assign({ team: 'jdt', opp: 'sel', kit: 0, formation: '4-4-2', skill: 0.5, minutes: 3, cam: 'player', sound: true, hints: true, league: 'my', oppLeague: 'my' },
  JSON.parse(localStorage.getItem('bk/settings') || '{}'));
const saveS = () => localStorage.setItem('bk/settings', JSON.stringify(S));
let P = { guest: true, coins: 0, equip: { ...DEFAULT_EQUIP, ...JSON.parse(localStorage.getItem('bk/equip') || '{}') }, owned: ITEMS.filter(i => i.free).map(i => i.id), passUntil: 0, name: tg?.initDataUnsafe?.user?.first_name || 'Pemain' };

async function api(path, body) {
  const r = await fetch(path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Init-Data': initData }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.err || 'http'), { code: j.err }); return j;
}
async function loadProfile() {
  if (!initData) return;
  try { const me = await api('/api/me'); P = { ...me, guest: false }; } catch (e) { console.warn('profile', e.message); }
  updateCoins();
}
const updateCoins = () => document.querySelectorAll('[data-coins]').forEach(e => e.textContent = P.guest ? 'Tetamu' : P.coins.toLocaleString('ms-MY'));

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
  ignite: () => { noise(0.6, 0.2, 400, 0.4); tone(110, 0.6, 'sawtooth', 0.08, 2.2); },
};

// Paper squash when tapped: press 0.08s, hold to 0.2s, damped wobble out to 0.9s.
const squash = (t, p) => { if (t < 0 || t > 0.9) return 0; const u = 0.3 + 0.7 * Math.max(0, Math.min(1, p)); if (t < 0.08) return u * Math.sin(t / 0.08 * Math.PI / 2); if (t < 0.2) return u; const s = (t - 0.2) / 0.7; return u * Math.exp(-4 * s) * Math.cos(8.5 * s) * (1 - s); };
const TAP_DELAY = 0.1, CHARGE_S = 1.2;

// ── world ──────────────────────────────────────────────────
const world = new World($('#scene'));
const ray = new THREE.Raycaster(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), v3 = new THREE.Vector3();
let M = null; // current match
let menuSpin = 0;

function looksFor(paperIds) { return paperIds.map(id => ({ ...(itemById(id)?.look || itemById('p_a4').look) })); }
function pickKits(t0, t1, k0 = 0) {
  const kit0 = t0.jerseys[k0] || t0.jerseys[0];
  const dist = (a, b) => { const p = x => parseInt(x.slice(1), 16), A = p(a), B = p(b); return Math.hypot((A >> 16) - (B >> 16), ((A >> 8) & 255) - ((B >> 8) & 255), (A & 255) - (B & 255)); };
  const kit1 = [...t1.jerseys].sort((a, b) => dist(b.base, kit0.base) - dist(a.base, kit0.base))[0];
  const gk1 = t1.keeper.find(k => dist(k.base, kit0.base) > 90 && dist(k.base, kit1.base) > 90) || t1.keeper[1] || t1.keeper[0];
  return { kits: [kit0, kit1], keepers: [t0.keeper[0], gk1] };
}

function stageWorld(setup, paperIds, equip) {
  const t0 = teamById(setup.teams[0]), t1 = teamById(setup.teams[1]);
  const kitObj = (team, id) => team.jerseys.find(j => j.id === id);
  const auto = pickKits(t0, t1, Math.max(0, t0.jerseys.findIndex(j => j.id === setup.kits[0])));
  const kits = [kitObj(t0, setup.kits[0]) || auto.kits[0], kitObj(t1, setup.kits[1]) || auto.kits[1]];
  world.setPitch(itemById(equip.pitch)?.look || itemById('f_stripes').look);
  if (world.venueId !== equip.venue) world.setVenue(equip.venue);
  world.setBall(itemById(equip.ball)?.look || itemById('b_classic').look);
  return { teams: [t0, t1], kits, keepers: auto.keepers, looks: looksFor(paperIds) };
}

// ── match lifecycle ────────────────────────────────────────
function startMatch({ setup, mode, seat = 0, mid = null, paperIds, names }) {
  closeAllOverlays();
  const e = new Engine(setup);
  const art = stageWorld(setup, paperIds, P.equip);
  world.setTeams(e, art.teams, art.kits, art.looks, art.keepers);
  M = { e, setup, mode, seat, mid, art, names: names || [art.teams[0].short, art.teams[1].short], actions: [], shot: 0, ps: false,
    aim: null, cpuWait: 0, turnLeft: null, turnDeadline: 0, halfWait: 0, lastMsg: 0, shake: 0, pending: null, over: false, paused: false,
    camYaw: 0, camMode: S.cam, goalCam: 0, slow: 1, kickoffHint: true };
  world.pieces.forEach(p => { p.x = p.data.x; p.z = p.data.z; });
  $('#menu').hidden = true; $('#hud').hidden = false; document.body.classList.add('playing');
  buildHud(); onTurnStart(); SFX.whistle(false);
  setTimeout(() => { if (M && S.hints) toast('Tekan dan tahan kertas pemain, lepas untuk tepuk. Lagi lama tahan, lagi padu.', 5200); }, 600);
}
const humanTurn = () => M && !M.over && !M.queued && M.e.phase === 'aim' && (M.mode === 'local' || (M.mode === 'cpu' && M.e.turnTeam === 0) || (M.mode === 'online' && M.e.turnTeam === M.seat && !M.pending && !M.sent));
const myTeam = () => M.mode === 'online' ? M.seat : M.mode === 'local' ? M.e.turnTeam : 0;

function onTurnStart() {
  const e = M.e; M.shot = 0; M.ps = false; M.aim = null; M.sent = false; M.cpuWait = 0.9 + Math.random() * 0.4; M.camYaw = 0;
  if (M.mode !== 'online') { M.turnLeft = 15; }
  updateShotChips(); updatePlayerCard();
  if (e.phase === 'aim' && e.canPowerStrike() && humanTurn()) { SFX.ignite(); toast('Membara! Tekan REMBATAN PADU. Bola terus meluncur ke gol.', 3000); }
}

function startTap(a) {
  const k = M.e.kicker; if (a.t !== 'aim' || !k) return;
  const vp = world.pieces[k.id]; vp.flipT = 0; vp.tapPower = a.ps ? 1 : a.power;
  world.ripple(k.x - a.dx * 0.35, k.z - a.dz * 0.35); SFX.tap(a.power); haptic(a.ps ? 'heavy' : 'medium');
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
    else if (ev.type === 'post') { SFX.post(); M.shake = 0.35; haptic('rigid'); flash('TIANG!'); }
    else if (ev.type === 'bounce') SFX.bounce(ev.v);
    else if (ev.type === 'whistle') SFX.whistle(ev.long);
    else if (ev.type === 'goal') {
      SFX.goal(); notify('success'); M.shake = 0.7; world.cheer = 3; M.goalCam = 2.2;
      const k = M.art.kits[ev.team]; world.goalFx(P.equip.fx, e.ball.x, e.ball.z, [k.base, k.accent]);
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
    else if (M.mode !== 'online' && M.turnLeft !== null) { M.turnLeft -= dt; if (M.turnLeft <= 0) { act({ t: 'skip' }); } }
  }
  if (M.queued && (M.queued.t -= dt) <= 0) { const a = M.queued.a; M.queued = null; if (e._applyAction(a)) M.actions.push(a); }
  if (e.phase === 'halftime' && M.mode !== 'online') { M.halfWait += dt; if (M.halfWait > 2.6) { M.halfWait = 0; act({ t: 'half' }); } }
  e.acc += sim;
  let n = 0; while (e.acc >= STEP && n++ < 8) { e.step(STEP); e.acc -= STEP; }
  drainEvents();
  if (M.pending && isRest(e)) { e.importState(M.pending); M.pending = null; M.turnFlag = true; }
  if (M.turnFlag && e.phase === 'aim') { M.turnFlag = false; onTurnStart(); }
  if (e.phase === 'over' && !M.over) finishMatch();
  if (e.message && e.message.id !== M.lastMsg) { M.lastMsg = e.message.id; banner(e.message); }
  M.slow = M.goalCam > 0 ? 0.45 : 1; if (M.goalCam > 0) M.goalCam -= dt;
}

// ── visual sync + camera ───────────────────────────────────
function syncVisuals(dt, t) {
  const e = M.e, k = 1 - Math.exp(-dt * 14);
  for (const vp of world.pieces) {
    const p = vp.data; vp.x += (p.x - vp.x) * k; vp.z += (p.z - vp.z) * k;
    const facing = Math.atan2(0, e.attackSign(p.team)); // front faces the goal it attacks
    const lift = Math.sin(Math.min(1, vp.hop) * Math.PI) * 0.25; vp.hop = Math.max(0, vp.hop - dt * 3);
    vp.flipT = (vp.flipT ?? 9) + dt; const sq = squash(vp.flipT, vp.tapPower ?? 0.5);
    vp.body.scale.set(1 + sq * 0.12, Math.max(0.2, 1 - sq * 0.7), 1 + sq * 0.9);
    vp.root.position.set(vp.x, lift, vp.z);
    vp.root.rotation.set(Math.sin(t * 30 + p.id) * p.wobble * 0.18, (e.attackSign(p.team) > 0 ? 0 : Math.PI), Math.sin(t * 26 + p.id) * p.wobble * 0.12);
    const active = p === e.kicker && e.phase === 'aim';
    vp.ring.material.opacity += ((active ? 0.95 : 0) - vp.ring.material.opacity) * k;
    vp.ring.scale.setScalar(1 + (active ? Math.sin(t * 5) * 0.06 : 0));
    if (active && p.charge >= POWER_CHARGE) vp.ring.material.color.set(0xff5a1f); else vp.ring.material.color.set(0xd4ff2a);
  }
  const b = e.ball; world.ballMesh.position.set(b.x, b.y + 0.16, b.z);
  const cue = humanTurn() && !M.aim; world.ballRing.position.set(b.x, 0.015, b.z);
  if (M.hold && humanTurn()) { M.hold.p = Math.min(1, (performance.now() - M.hold.t0) / 1000 / CHARGE_S); if (!M.hold.dragged) M.aim = { ...goalDir(), power: Math.max(0.05, M.hold.p) }; }
  world.ballRing.material.opacity += ((cue ? 0.9 : 0) - world.ballRing.material.opacity) * k; world.ballRing.scale.setScalar(1 + Math.sin(t * 6) * 0.15);
  const sp = Math.hypot(b.vx, b.vz); if (sp > 0.01) { world.ballMesh.rotation.x += b.vz * dt / 0.16; world.ballMesh.rotation.z -= b.vx * dt / 0.16; }
  if (world.trailLine) {
    const pts = world.trailPts; if (sp > 1) pts.unshift(new THREE.Vector3(b.x, b.y + 0.16, b.z)); else pts.splice(0, 2); if (pts.length > 18) pts.length = 18;
    if (pts.length > 2) { const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 2, 0.07, 6); world.trailLine.geometry.dispose(); world.trailLine.geometry = g; world.trailLine.visible = true; } else world.trailLine.visible = false;
  }
  // aim guide
  if (M.cpuPlan && M.cpuPlan.t === 'aim') { const r = Math.min(1, (0.6 - M.cpuWait) / 0.6), a = M.cpuPlan; world.showAim(b, a.dx, a.dz, a.power * r, predictPath(e, a.dx, a.dz, a.power * r, a.shot, a.ps), a.ps); }
  else if (M.aim && humanTurn()) world.showAim(b, M.aim.dx, M.aim.dz, M.aim.power, predictPath(e, M.aim.dx, M.aim.dz, M.aim.power, M.shot, M.ps), M.ps);
  else if (M.ps && humanTurn()) { const s = e.attackSign(e.kicker.team); world.showAim(b, -b.x, s * FIELD.L / 2 - b.z, 1, predictPath(e, 0, 1, 1, 0, true), true); }
  else world.showAim(null);
  updateCamera(dt);
}

function updateCamera(dt) {
  const e = M.e, cam = world.cam, b = e.ball;
  const fov = (cam.aspect < 0.8 ? 58 : cam.aspect < 1.2 ? 50 : 45) - (M.goalCam > 0 ? 7 : 0); if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * Math.min(1, 6 * dt); cam.updateProjectionMatrix(); }
  const viewTeam = (M.mode === 'cpu' && e.turnTeam === 1) || (M.mode === 'online' && e.turnTeam !== M.seat) ? myTeam() : e.turnTeam;
  const sign = e.attackSign(viewTeam);
  let pos, look;
  if (M.camMode === 'top') {
    pos = new THREE.Vector3(b.x * 0.35, cam.aspect < 1 ? 23 : 17, b.z * 0.5 - sign * (cam.aspect < 1 ? 7 : 9));
    look = new THREE.Vector3(b.x * 0.35, 0, b.z * 0.5 + sign * 1.5);
  } else {
    const k0 = e.kicker, sp = Math.hypot(b.vx, b.vz); let tx, tz;
    if (e.phase === 'rolling' && sp > 1.5) { tx = b.vx / sp; tz = b.vz / sp; }
    else { const s = e.attackSign(k0 ? k0.team : e.turnTeam), gx = -0.6 * b.x, gz = s * FIELD.L / 2 - b.z, l = Math.hypot(gx, gz) || 1; tx = gx / l; tz = gz / l; }
    const d = M.camDir || (M.camDir = new THREE.Vector2(tx, tz)); d.lerp(new THREE.Vector2(tx, tz), 1 - Math.exp(-3 * dt)).normalize();
    const c = Math.cos(M.camYaw), s2 = Math.sin(M.camYaw), fx = d.x * c + d.y * s2, fz = d.y * c - d.x * s2;
    const ax = k0 && e.phase !== 'rolling' ? k0.x : b.x, az = k0 && e.phase !== 'rolling' ? k0.z : b.z;
    const portrait = cam.aspect < 1, back = portrait ? 4.2 : 3.4, up = portrait ? 3.7 : 3;
    pos = new THREE.Vector3(ax - fx * back, up, az - fz * back);
    look = new THREE.Vector3(b.x + fx * 1.3, 0, b.z + fz * 1.3);
    if (e.phase === 'goal') { const gs = Math.sign(b.z) || 1; pos.set(fz * 5.2 * 0.6, 3.1, gs * (FIELD.L / 2 - 4.6)); look.set(b.x * 0.5, 0.8, gs * (FIELD.L / 2 + 0.4)); }
  }
  if (!M.hold && !drag && performance.now() - (M.lastLook || 0) > 4000) M.camYaw *= Math.exp(-3 * dt); // drift back to centre
  const k = 1 - Math.exp(-dt * (e.phase === 'goal' ? 4 : 5));
  world.camPos.lerp(pos, k); world.camLook.lerp(look, k);
  cam.position.copy(world.camPos);
  cam.lookAt(world.camLook);
  if (M.shake > 0) { M.shake = Math.max(0, M.shake - dt); const s = M.shake * M.shake * 0.25; cam.translateX((Math.random() - 0.5) * s); cam.translateY((Math.random() - 0.5) * s); }
}

// ── controls: drag back from the ball ──────────────────────
const canvas = $('#scene');
let drag = null;
function groundAt(x, y) { ray.setFromCamera({ x: (x / innerWidth) * 2 - 1, y: -(y / innerHeight) * 2 + 1 }, world.cam); return ray.ray.intersectPlane(ground, v3) ? v3.clone() : null; }
function ballScreen() { const p = world.ballMesh.position.clone().project(world.cam); return { x: (p.x + 1) / 2 * innerWidth, y: (1 - p.y) / 2 * innerHeight }; }
// Reference controls: press the paper (or ball), hold to charge, release to tap.
// Default aim is straight at goal. Dragging while holding steers the aim (pull back, slingshot).
// Dragging anywhere else orbits the camera.
function screenOf(x, z) { const p = new THREE.Vector3(x, 0.2, z).project(world.cam); return { x: (p.x + 1) / 2 * innerWidth, y: (1 - p.y) / 2 * innerHeight }; }
function goalDir() { const e = M.e, b = e.ball, s = e.attackSign(e.kicker.team), gx = -b.x * 0.85, gz = s * FIELD.L / 2 - b.z, l = Math.hypot(gx, gz) || 1; return { dx: gx / l, dz: gz / l }; }
canvas.addEventListener('pointerdown', ev => {
  audio(); if (!M || M.paused) return;
  canvas.setPointerCapture(ev.pointerId);
  const k = M.e.kicker, r = Math.max(64, Math.min(innerWidth, innerHeight) * 0.14);
  const hit = humanTurn() && !M.ps && k && [screenOf(M.e.ball.x, M.e.ball.z), screenOf(k.x, k.z)].some(p => Math.hypot(ev.clientX - p.x, ev.clientY - p.y) < r);
  if (hit) { drag = { kind: 'aim', id: ev.pointerId, x: ev.clientX, y: ev.clientY, g: groundAt(ev.clientX, ev.clientY) }; M.hold = { t0: performance.now(), p: 0, dragged: false }; M.aim = { ...goalDir(), power: 0.05 }; haptic('light'); }
  else drag = { kind: 'look', id: ev.pointerId, x: ev.clientX, yaw: M.camYaw };
});
canvas.addEventListener('pointermove', ev => {
  if (!drag || ev.pointerId !== drag.id || !M) return;
  if (drag.kind === 'look') { M.camYaw = drag.yaw - (ev.clientX - drag.x) / innerWidth * 3; M.lastLook = performance.now(); return; }
  if (!M.hold || Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) < 18) return; // small wobble stays a straight tap
  const g = groundAt(ev.clientX, ev.clientY); if (!g || !drag.g) return;
  const dx = drag.g.x - g.x, dz = drag.g.z - g.z, d = Math.hypot(dx, dz); if (d < 0.05) return;
  M.hold.dragged = true; M.aim = { dx: dx / d, dz: dz / d, power: Math.max(0.05, M.hold.p) };
});
const endDrag = ev => {
  if (!drag || ev.pointerId !== drag.id) return;
  if (drag.kind === 'aim' && M?.hold && humanTurn() && ev.type === 'pointerup') act({ t: 'aim', dx: M.aim.dx, dz: M.aim.dz, power: Math.max(0.05, M.hold.p), shot: M.shot });
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
function toggleCam() { M.camMode = M.camMode === 'player' ? 'top' : 'player'; S.cam = M.camMode; saveS(); $('#cam-btn span').textContent = M.camMode === 'player' ? 'PEMAIN' : 'ATAS'; SFX.ui(); }

// ── HUD ────────────────────────────────────────────────────
function crestCanvas(team, size = 34) { const c = document.createElement('canvas'); c.width = c.height = size * 2; crest(c.getContext('2d'), size, size * 0.95, size * 1.5, team); c.className = 'crest'; return c; }
function buildHud() {
  const hud = $('#hud'), [t0, t1] = M.art.teams, [k0, k1] = M.art.kits;
  hud.innerHTML = `
  <div class="sb">
    <div class="sb-clock"><b id="clk">0:00</b><small id="half">BABAK 1</small></div>
    <div class="sb-team" style="--c:${k0.base};--i:${ink(k0.base)}"><span class="sb-c0"></span><b>${esc(M.names[0]).slice(0, 12)}</b></div>
    <div class="sb-score"><b id="s0">0</b><i></i><b id="s1">0</b></div>
    <div class="sb-team r" style="--c:${k1.base};--i:${ink(k1.base)}"><b>${esc(M.names[1]).slice(0, 12)}</b><span class="sb-c1"></span></div>
  </div>
  <div class="tr">
    <button class="chip ghost" id="cam-btn"><svg viewBox="0 0 24 24"><path d="M4 7h3l2-2h6l2 2h3v12H4z M12 10a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7" fill="none" stroke="currentColor" stroke-width="1.8"/></svg><span>${M.camMode === 'player' ? 'PEMAIN' : 'ATAS'}</span></button>
    <button class="chip ghost sq" id="pause-btn" aria-label="Jeda"><svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg></button>
  </div>
  <div class="bottom">
    <div class="shots" id="shots">${SHOT_TYPES.map((s, i) => `<button class="shot" data-i="${i}"><b>${['BUMI', 'CUNGKIL', 'LAMBUNG'][i]}</b><kbd>${i + 1}</kbd></button>`).join('')}</div>
    <div class="pcard" id="pcard"><div class="pc-badge"></div><div class="pc-main"><b id="pc-name"></b><div class="charge" id="charge">${'<i></i>'.repeat(POWER_CHARGE)}</div><small id="pc-state"></small></div><div class="pc-timer" id="pc-timer"><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" class="trk"/><circle cx="20" cy="20" r="17" class="arc" id="arc"/></svg><b id="tl">15</b></div></div>
    <div class="meter" id="meter"><i id="meter-fill"></i><b>TAHAN UNTUK CAS</b></div>
    <button class="power" id="power-btn" hidden>REMBATAN PADU</button>
  </div>
  <div class="banner" id="banner"><b></b><small></small></div>`;
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
  $('#pc-name').textContent = `${k.name.toUpperCase()}`;
  $('#charge').querySelectorAll('i').forEach((el, i) => el.classList.toggle('on', i < k.charge));
  $('#charge').classList.toggle('full', k.charge >= POWER_CHARGE);
  const who = M.mode === 'cpu' ? (e.turnTeam === 0 ? 'GILIRAN ANDA' : 'GILIRAN CPU') : M.mode === 'online' ? (e.turnTeam === M.seat ? 'GILIRAN ANDA' : 'GILIRAN LAWAN') : `GILIRAN ${M.names[e.turnTeam]}`;
  const sp = { kickoff: 'SEPAK MULA', corner: 'SEPAKAN SUDUT', goalkick: 'SEPAKAN GOL', throw: 'BOLA KELUAR' }[e.setPiece] || 'BOLA HIDUP';
  $('#pc-state').textContent = `${who}  ·  TEPUKAN ${Math.min(MAX_TAPS, (e.lastTapTeam === e.turnTeam ? e.tapsInRow : 0) + 1)}/${MAX_TAPS}  ·  ${sp}`;
  $('#pcard').classList.toggle('opp', !humanTurn());
}
function updateHud() {
  const e = M.e, tl = e.timeLeft;
  $('#clk').textContent = tl == null ? '--' : `${Math.floor(tl / 60)}:${String(Math.floor(tl % 60)).padStart(2, '0')}`;
  $('#half').textContent = e.half === 1 ? 'BABAK 1' : 'BABAK 2';
  $('#s0').textContent = e.score[0]; $('#s1').textContent = e.score[1];
  let left = M.mode === 'online' ? Math.max(0, (M.turnDeadline - performance.now()) / 1000) : M.turnLeft;
  const showT = e.phase === 'aim' && left != null && !(M.mode === 'cpu' && e.turnTeam === 1);
  $('#pc-timer').style.visibility = showT ? 'visible' : 'hidden';
  if (showT) { $('#tl').textContent = Math.ceil(Math.min(15, left)); $('#arc').style.strokeDashoffset = 106.8 * (1 - Math.min(1, left / 15)); $('#pc-timer').classList.toggle('low', left < 5); }
  const mt = $('#meter'), p = M.hold?.p || 0; mt.classList.toggle('on', !!M.hold); $('#meter-fill').style.transform = `scaleX(${p})`; mt.classList.toggle('max', p >= 1);
  updateShotChips();
}
let bannerT = 0;
function banner(msg) {
  const b = $('#banner'); if (!b) return;
  b.querySelector('b').textContent = msg.text; b.querySelector('small').textContent = msg.sub || '';
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
  const o = overlay(`<h2>${M.mode === 'online' ? 'MENU' : 'JEDA'}</h2><button class="btn lime" id="res">Sambung</button><button class="btn" id="cam2">Kamera: ${M.camMode === 'player' ? 'Pemain' : 'Atas'}</button><button class="btn" id="snd">Bunyi: ${S.sound ? 'Hidup' : 'Mati'}</button><button class="btn ghost" id="quit">${M.mode === 'online' ? 'Tinggalkan perlawanan' : 'Keluar ke menu'}</button>`);
  o.querySelector('#res').onclick = () => { M.paused = false; o.remove(); };
  o.querySelector('#cam2').onclick = () => { toggleCam(); o.querySelector('#cam2').textContent = `Kamera: ${M.camMode === 'player' ? 'Pemain' : 'Atas'}`; };
  o.querySelector('#snd').onclick = () => { S.sound = !S.sound; saveS(); o.querySelector('#snd').textContent = `Bunyi: ${S.sound ? 'Hidup' : 'Mati'}`; };
  o.querySelector('#quit').onclick = () => { quitMatch(); };
}
function quitMatch() { if (M?.ws) { M.closing = true; M.ws.close(); } M = null; closeAllOverlays(); $('#hud').hidden = true; document.body.classList.remove('playing'); showHome(); }

async function finishMatch() {
  M.over = true; const e = M.e, my = myTeam();
  const won = e.winner === my, draw = e.winner === null;
  setTimeout(async () => {
    if (!M) return;
    const title = M.mode === 'local' ? (draw ? 'SERI' : `${esc(M.names[e.winner])} MENANG`) : draw ? 'SERI' : won ? 'MENANG!' : 'KALAH';
    const o = overlay(`<div class="res ${won ? 'win' : draw ? 'draw' : 'lose'}"><small>TAMAT</small><h2>${title}</h2>
      <div class="final"><span>${esc(M.names[0])}</span><b>${e.score[0]}</b><i>:</i><b>${e.score[1]}</b><span>${esc(M.names[1])}</span></div>
      <div class="reward" id="reward">${M.mode === 'cpu' ? (P.guest ? 'Main dalam Telegram untuk kumpul coins.' : 'Mengira ganjaran...') : M.mode === 'online' && M.forfeit ? 'Lawan meninggalkan perlawanan.' : ''}</div></div>
      <button class="btn lime" id="again">${M.mode === 'online' ? 'Minta rematch' : 'Main lagi'}</button><button class="btn" id="shop2">Loker</button><button class="btn ghost" id="home">Menu utama</button>`);
    o.querySelector('#home').onclick = quitMatch;
    o.querySelector('#shop2').onclick = () => { quitMatch(); showShop(); };
    o.querySelector('#again').onclick = () => {
      if (M.mode === 'online') { M.ws?.send(JSON.stringify({ t: 'rematch' })); o.querySelector('#again').textContent = 'Menunggu lawan...'; o.querySelector('#again').disabled = true; }
      else if (M.mode === 'cpu') { const m = M; M = null; beginCpu(); } else { beginLocal(); }
    };
    if (M.mode === 'cpu' && M.mid) {
      try { const r = await api('/api/match/finish', { mid: M.mid, actions: M.actions }); P = { ...r.profile, guest: false }; updateCoins();
        $('#reward').innerHTML = `<span class="coin"></span> +${r.reward} coins${r.capped ? ' <small>(had harian dicapai)</small>' : ''}`; if (r.reward) SFX.buy(); }
      catch (err) { $('#reward').textContent = 'Ganjaran tidak dapat disahkan.'; }
    }
  }, 1600);
}

// ── start helpers ──────────────────────────────────────────
function localSetup(cpu) {
  const t0 = teamById(S.team), t1 = teamById(S.opp === S.team ? ALL_TEAMS.find(t => t.id !== S.team).id : S.opp), kk = pickKits(t0, t1, S.kit);
  return { seed: (Math.random() * 2 ** 32) >>> 0, minutes: S.minutes, halves: true, powerStrike: true, layout: 'spread', lockstep: true, turnLimit: 15, cpu, cpuSkill: S.skill,
    formations: [S.formation, '4-4-2'], teams: [t0.id, t1.id], kits: [kk.kits[0].id, kk.kits[1].id], rosters: [rosterFor(t0), rosterFor(t1)],
    paper: [itemById(P.equip.paper)?.stats || BASE_STATS, BASE_STATS] };
}
async function beginCpu() {
  let setup = localSetup([false, true]), mid = null;
  if (!P.guest) {
    try { const r = await api('/api/match/start', { team0: S.team, team1: setup.teams[1], kit0: setup.kits[0], kit1: setup.kits[1], formation: S.formation, skill: S.skill, minutes: S.minutes }); setup = r.setup; mid = r.mid; }
    catch (e) { toast('Mod luar talian: coins tidak dikira untuk perlawanan ini.'); }
  }
  startMatch({ setup, mode: 'cpu', mid, paperIds: [P.equip.paper, 'p_a4'], names: [teamById(setup.teams[0]).short, teamById(setup.teams[1]).short] });
}
function beginLocal() {
  const setup = localSetup([false, false]); setup.paper = [BASE_STATS, BASE_STATS];
  startMatch({ setup, mode: 'local', paperIds: ['p_a4', 'p_a4'], names: [teamById(setup.teams[0]).short, teamById(setup.teams[1]).short] });
}

// ── online ─────────────────────────────────────────────────
const wsUrl = p => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${p}`;
function joinRoom(code) {
  const o = overlay(`<h2>BILIK ${esc(code)}</h2><p class="muted" id="rstat">Menyambung...</p><div class="code">${esc(code)}</div><button class="btn lime" id="share">Jemput kawan</button><button class="btn ghost" id="cx">Batal</button>`);
  const ws = new WebSocket(wsUrl(`/ws/room/${code}?pid=${encodeURIComponent(PID)}`)); let state = 'wait';
  o.querySelector('#cx').onclick = () => { state = 'cancel'; ws.close(); closeAllOverlays(); };
  o.querySelector('#share').onclick = () => {
    const link = `https://t.me/BolaKertasBot?start=room_${code}`, text = `Jom lawan aku dalam Bola Kertas! Kod bilik: ${code}`;
    if (tg?.openTelegramLink) tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
    else navigator.clipboard?.writeText(link).then(() => toast('Pautan disalin.'));
  };
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', initData, profile: { name: P.name, team: S.team, kit: teamById(S.team).jerseys[S.kit]?.id, formation: S.formation } }));
  ws.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.t === 'waiting') { const s = $('#rstat'); if (s) s.textContent = 'Menunggu lawan masuk. Kongsi kod atau pautan.'; }
    else if (m.t === 'err') { toast(m.msg === 'room-full' ? 'Bilik itu sudah penuh.' : m.msg === 'no-room' ? 'Bilik tidak wujud atau sudah tamat.' : 'Ralat.'); if (m.state && M) { M.e.importState(m.state); M.sent = false; } if (!M) closeAllOverlays(); }
    else if (m.t === 'setup') {
      state = 'play';
      startMatch({ setup: m.setup, mode: 'online', seat: m.seat, paperIds: m.setup.paperIds || ['p_a4', 'p_a4'], names: m.setup.names });
      M.ws = ws; M.e.importState(m.state); M.turnDeadline = performance.now() + (m.left || 0); M.turnFlag = true;
    }
    else if (!M) return;
    else if (m.t === 'act') { M.sent = false; if (!M.e._applyAction(m.a)) M.e.importState(m.state); else M.pending = m.state; M.turnDeadline = performance.now() + (m.left || 0); }
    else if (m.t === 'over') { M.forfeit = !!m.forfeit; if (m.state) M.e.importState(m.state); M.e.phase = 'over'; M.e.winner = m.winner; }
    else if (m.t === 'opp') toast(m.here ? 'Lawan kembali.' : 'Lawan terputus. Menunggu 60 saat.', 3500);
    else if (m.t === 'rematch') toast(m.seats.length < 2 ? 'Rematch diminta.' : 'Rematch bermula!');
  };
  ws.onclose = () => { if (state === 'cancel' || M?.closing) return; if (M && M.mode === 'online' && !M.over) { toast('Sambungan terputus. Cuba menyambung semula...'); setTimeout(() => { if (M && !M.over) { const c = code; M = null; joinRoom(c); } }, 1500); } };
}
function findMatch() {
  const o = overlay(`<h2>MENCARI LAWAN</h2><div class="spinner"></div><p class="muted">Ini boleh ambil masa seminit kalau tak ramai online.</p><button class="btn" id="inv">Jemput kawan sahaja</button><button class="btn ghost" id="cx">Batal</button>`);
  const ws = new WebSocket(wsUrl('/ws/lobby?pid=' + encodeURIComponent(PID))); let done = false;
  ws.onopen = () => ws.send(JSON.stringify({ t: 'queue' }));
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.t === 'matched') { done = true; ws.close(); joinRoom(m.code); } };
  ws.onclose = () => { if (!done && document.body.contains(o)) o.querySelector('p').textContent = 'Tak dapat sambung ke pelayan. Cuba lagi.'; };
  o.querySelector('#cx').onclick = () => { done = true; try { ws.send(JSON.stringify({ t: 'unqueue' })); } catch {} ws.close(); closeAllOverlays(); };
  o.querySelector('#inv').onclick = () => { done = true; ws.close(); createRoom(); };
}
async function createRoom() {
  try { const r = await fetch('/api/room', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules: { minutes: S.minutes } }) }).then(r => r.json()); joinRoom(r.code); }
  catch { toast('Tak dapat cipta bilik. Semak sambungan.'); }
}

// ── menus ──────────────────────────────────────────────────
const ICON = {
  cpu: '<path d="M7 7h10v10H7z M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4" />',
  two: '<circle cx="8" cy="8" r="3.2"/><circle cx="16" cy="8" r="3.2"/><path d="M2.5 19c.8-3.4 3-5 5.5-5s4.7 1.6 5.5 5M10.5 19c.8-3.4 3-5 5.5-5s4.7 1.6 5.5 5"/>',
  web: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.3 3 14.7 0 18M12 3c-3 3.3-3 14.7 0 18"/>',
  shop: '<path d="M4 8h16l-1.5 11h-13z M8.5 8V6a3.5 3.5 0 0 1 7 0v2"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.6 2.6 0 1 1 3.6 2.4c-.8.4-1.1 1-1.1 1.9M12 17h.01"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
};
const svg = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;
function header(back) {
  return `<header class="top">${back ? `<button class="chip ghost sq" id="back" aria-label="Kembali"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg></button>` : ''}
  <div class="logo"><i></i><b>BOLA</b><em>KERTAS</em></div><div class="sp"></div>
  <button class="chip coins" id="coins-btn"><span class="coin"></span><b data-coins></b></button>
  ${back ? '' : `<button class="chip ghost sq" id="cog" aria-label="Tetapan">${svg('cog')}</button>`}</header>`;
}
function bindHeader(root, back) { root.querySelector('#back')?.addEventListener('click', () => { SFX.ui(); (back || showHome)(); }); root.querySelector('#coins-btn').onclick = () => showShop('paper'); root.querySelector('#cog')?.addEventListener('click', showSettings); updateCoins(); }
function screen(html) { const m = $('#menu'); m.hidden = false; m.innerHTML = html; m.scrollTop = 0; return m; }

function showHome() {
  const t0 = teamById(S.team), t1 = teamById(S.opp), kk = pickKits(t0, t1, S.kit), paper = itemById(P.equip.paper);
  const m = screen(`${header(false)}
  <main class="home">
    <section class="hero" style="--c0:${kk.kits[0].base};--c1:${kk.kits[1].base}">
      <div class="hero-art"><div class="th th0"></div><div class="vs">VS</div><div class="th th1"></div></div>
      <div class="hero-txt"><h1>SEPAK MULA</h1><p>${esc(t0.short)} lawan ${esc(t1.short)}  ·  CPU ${['Mudah', 'Biasa', 'Pakar'][[0.25, 0.5, 0.8].indexOf(S.skill)] || 'Biasa'}  ·  ${S.minutes} minit</p>
      <p class="paper-tag">Kertas: <b>${esc(paper.name)}</b></p></div>
      <button class="play" id="kick" aria-label="Main"><svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z" fill="currentColor"/></svg></button>
    </section>
    <section class="modes">
      ${[['cpu', 'LAWAN CPU', 'Pilih pasukan dan tahap'], ['two', '2 PEMAIN', 'Satu peranti, bergilir'], ['web', 'ONLINE', 'Cari lawan atau jemput kawan', 'BETA'], ['shop', 'LOKER', 'Kertas, padang, venue, bola'], ['help', 'CARA MAIN', 'Peraturan dan kawalan']]
        .map(([k, t, s, tag]) => `<button class="mode" data-k="${k}"><span class="wm">${svg(k)}</span><b>${t}</b><small>${s}</small>${tag ? `<em>${tag}</em>` : ''}</button>`).join('')}
    </section>
  </main><footer class="foot">Bola Kertas  ·  Semua item tiada nilai tunai</footer>`);
  bindHeader(m);
  m.querySelector('.th0').append(paperThumb(t0, kk.kits[0], 10, 170, paper.look)); m.querySelector('.th1').append(paperThumb(t1, kk.kits[1], 10, 170));
  m.querySelector('#kick').onclick = () => { SFX.ui(); beginCpu(); };
  m.querySelectorAll('.mode').forEach(b => b.onclick = () => { SFX.ui(); haptic(); ({ cpu: () => showSetup('cpu'), two: () => showSetup('local'), web: showOnline, shop: () => showShop('paper'), help: showHelp })[b.dataset.k](); });
}

function teamGrid(selected, league, onPick) {
  const lg = LEAGUES.find(l => l.id === league) || LEAGUES[0];
  return `<div class="tabs">${LEAGUES.map(l => `<button class="tab ${l.id === lg.id ? 'on' : ''}" data-l="${l.id}">${esc(l.name)}</button>`).join('')}</div>
  <div class="teams">${lg.teams.map(t => `<button class="team ${t.id === selected ? 'on' : ''}" data-t="${t.id}" style="--c:${t.jerseys[0].base};--a:${t.jerseys[0].accent}"><span class="sw"></span><b>${esc(t.short)}</b><small>${esc(t.name)}</small></button>`).join('')}</div>`;
}
function showSetup(mode) {
  let step = 0;
  const render = () => {
    const pickOpp = step === 1, sel = pickOpp ? S.opp : S.team, lg = pickOpp ? S.oppLeague : S.league;
    const m = screen(`${header(true)}<main class="setup">
      <div class="steps"><span class="${step === 0 ? 'on' : ''}">1. Pasukan anda</span><span class="${step === 1 ? 'on' : ''}">2. Lawan</span><span class="${step === 2 ? 'on' : ''}">3. Peraturan</span></div>
      ${step < 2 ? teamGrid(sel, lg) : `
      <div class="opts">
        <label>Jersi<div class="seg" data-k="kit">${teamById(S.team).jerseys.map((j, i) => `<button class="${S.kit === i ? 'on' : ''}" data-v="${i}"><i style="background:${j.base};border-color:${j.accent}"></i>${esc(j.label)}</button>`).join('')}</div></label>
        <label>Formasi<div class="seg" data-k="formation">${Object.keys(FORMATIONS).map(f => `<button class="${S.formation === f ? 'on' : ''}" data-v="${f}">${f}</button>`).join('')}</div></label>
        ${mode === 'cpu' ? `<label>Tahap CPU<div class="seg" data-k="skill">${[[0.25, 'Mudah'], [0.5, 'Biasa'], [0.8, 'Pakar']].map(([v, l]) => `<button class="${S.skill === v ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div></label>` : ''}
        <label>Masa perlawanan<div class="seg" data-k="minutes">${[1, 3, 5].map(v => `<button class="${S.minutes === v ? 'on' : ''}" data-v="${v}">${v} minit</button>`).join('')}</div></label>
        ${mode === 'cpu' ? `<p class="muted">Kertas anda: <b>${esc(itemById(P.equip.paper).name)}</b>. Tukar dalam Loker.</p>` : '<p class="muted">Mod 2 pemain guna kertas A4 untuk kedua-dua pasukan supaya adil.</p>'}
      </div>`}
      <div class="cta"><button class="btn lime big" id="next">${step < 2 ? 'Seterusnya' : 'Mula perlawanan'}</button></div></main>`);
    bindHeader(m, () => { if (step > 0) { step--; render(); } else showHome(); });
    m.querySelectorAll('.tab').forEach(b => b.onclick = () => { pickOpp ? S.oppLeague = b.dataset.l : S.league = b.dataset.l; saveS(); render(); });
    m.querySelectorAll('.team').forEach(b => b.onclick = () => { if (pickOpp) S.opp = b.dataset.t; else { S.team = b.dataset.t; S.kit = 0; } saveS(); SFX.ui(); render(); });
    m.querySelectorAll('.seg').forEach(seg => seg.querySelectorAll('button').forEach(b => b.onclick = () => { const k = seg.dataset.k, v = b.dataset.v; S[k] = k === 'formation' ? v : +v; saveS(); SFX.ui(); render(); }));
    m.querySelector('#next').onclick = () => { SFX.ui(); if (step < 2) { step++; render(); } else mode === 'cpu' ? beginCpu() : beginLocal(); };
  };
  render();
}

function showOnline() {
  const m = screen(`${header(true)}<main class="online"><h2 class="ttl">ONLINE <em>BETA</em></h2>
    <p class="muted">Anda bermain sebagai <b>${esc(teamById(S.team).name)}</b>. Kertas mahal aktif dalam online casual.</p>
    <button class="mode wide" id="find"><span class="wm">${svg('web')}</span><b>CARI LAWAN</b><small>Padankan dengan pemain lain</small></button>
    <button class="mode wide" id="make"><span class="wm">${svg('two')}</span><b>CIPTA BILIK</b><small>Dapat kod, kongsi dengan kawan</small></button>
    <div class="join"><input id="code" maxlength="8" placeholder="KOD BILIK" autocomplete="off"><button class="btn lime" id="join">Masuk</button></div>
  </main>`);
  bindHeader(m);
  m.querySelector('#find').onclick = findMatch; m.querySelector('#make').onclick = createRoom;
  const inp = m.querySelector('#code'); inp.oninput = () => inp.value = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  m.querySelector('#join').onclick = () => inp.value.length >= 4 ? joinRoom(inp.value) : toast('Masukkan kod 5 aksara.');
}

const SLOT_TABS = [['paper', 'KERTAS'], ['pitch', 'PADANG'], ['venue', 'VENUE'], ['ball', 'BOLA'], ['fx', 'EFEK GOL'], ['pass', 'PAS']];
const VENUE_ART = { v_desk: ['#9fc4e8', '#ffcf2e'], v_field: ['#ff9e5e', '#5f8f3a'], v_kopitiam: ['#3b2a20', '#f2efe9'], v_night: ['#050a18', '#1b3f94'], v_beach: ['#ff7a59', '#e9cf9b'], v_rooftop: ['#060914', '#ffd98a'], v_final: ['#0b0a1f', '#ffd45a'] };
function itemThumb(it) {
  const c = document.createElement('canvas'); c.width = c.height = 160; const g = c.getContext('2d');
  if (it.slot === 'paper') { const t = teamById(S.team); g.drawImage(paperSurface(it.look, 160, 160), 0, 0); g.fillStyle = 'rgba(8,12,24,0.35)'; g.fillRect(0, 0, 160, 160); g.drawImage(paperThumb(t, t.jerseys[S.kit] || t.jerseys[0], 10, 150, it.look), 5, 6); }
  else if (it.slot === 'pitch') { const p = pitchTexture(it.look, 9); g.drawImage(p, 0, 0, p.width, p.height, 30, 0, 100, 160); }
  else if (it.slot === 'ball') { const b = ballTexture(it.look, 256, 128); g.save(); g.beginPath(); g.arc(80, 80, 56, 0, 7); g.clip(); g.drawImage(b, 0, 0, 256, 128, 0, 24, 220, 112); const gr = g.createRadialGradient(60, 58, 4, 80, 80, 60); gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.5, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.45)'); g.fillStyle = gr; g.fillRect(0, 0, 160, 160); g.restore(); }
  else { const [a, b] = VENUE_ART[it.id] || ['#1b2a4a', it.slot === 'fx' ? '#ff4f7a' : '#d4ff2a']; const gr = g.createLinearGradient(0, 0, 0, 160); gr.addColorStop(0, a); gr.addColorStop(1, b); g.fillStyle = gr; g.fillRect(0, 0, 160, 160);
    g.fillStyle = 'rgba(255,255,255,0.9)'; g.font = '800 italic 30px "Barlow Condensed", Arial'; g.textAlign = 'center'; g.fillText(it.slot === 'venue' ? 'VENUE' : it.slot === 'fx' ? 'GOL!' : 'PAS', 80, 92); }
  return c;
}
function statBars(st) {
  return `<div class="stats">${[['KUASA', 'power'], ['BERAT', 'weight'], ['KAWALAN', 'control']].map(([l, k]) => { const v = st[k], p = (v - 85) / 30 * 100; return `<div><span>${l}</span><i><b style="width:${p}%" class="${v > 100 ? 'up' : v < 100 ? 'down' : ''}"></b></i><em>${v > 100 ? '+' : ''}${v - 100}%</em></div>`; }).join('')}</div>`;
}
function showShop(slot = 'paper') {
  const items = ITEMS.filter(i => i.slot === slot), owned = new Set(P.owned);
  const m = screen(`${header(true)}<main class="shop">
    <div class="tabs">${SLOT_TABS.map(([k, l]) => `<button class="tab ${k === slot ? 'on' : ''}" data-s="${k}">${l}</button>`).join('')}</div>
    ${slot === 'paper' ? '<p class="muted">Kuasa = laju tepukan. Berat = bola tak mudah terpantul dari pemain anda. Kawalan = bidikan lebih tepat. Maksimum +15%: kemahiran tetap penentu. Mod ranked guna stat standard.</p>' : ''}
    ${P.guest ? '<p class="warn">Buka dalam Telegram untuk simpan coins dan beli item.</p>' : ''}
    <div class="items">${items.map(it => {
      const have = owned.has(it.id) && !it.consumable, eq = P.equip[it.slot] === it.id;
      const price = it.free ? 'PERCUMA' : it.coins ? `<span class="coin"></span>${it.coins.toLocaleString('ms-MY')}` : `<span class="star"></span>${it.stars}`;
      return `<article class="item ${eq ? 'eq' : ''}" data-id="${it.id}"><div class="ith"></div>${it.tag ? `<em class="tag t-${it.tag.toLowerCase()}">${it.tag}</em>` : ''}
        <h3>${esc(it.name)}</h3><p>${esc(it.desc)}</p>${it.stats ? statBars(it.stats) : ''}
        <button class="btn ${eq ? 'ghost' : have ? '' : 'lime'}" data-act="${eq ? 'none' : have ? 'equip' : 'buy'}">${eq ? 'DIPAKAI' : have ? 'PAKAI' : price}</button></article>`;
    }).join('')}</div>
    ${slot === 'pass' && P.passUntil > Date.now() ? `<p class="muted">Pas aktif sehingga ${new Date(P.passUntil).toLocaleDateString('ms-MY')}.</p>` : ''}
  </main>`);
  bindHeader(m);
  m.querySelectorAll('.tab').forEach(b => b.onclick = () => { SFX.ui(); showShop(b.dataset.s); });
  m.querySelectorAll('.item').forEach(card => {
    const it = itemById(card.dataset.id); card.querySelector('.ith').append(itemThumb(it));
    const btn = card.querySelector('button');
    btn.onclick = async () => {
      const a = btn.dataset.act; if (a === 'none') return; SFX.ui();
      if (a === 'equip') {
        if (P.guest) { if (!it.free) return; P.equip[it.slot] = it.id; localStorage.setItem('bk/equip', JSON.stringify(P.equip)); return showShop(slot); }
        try { P = { ...(await api('/api/equip', { item: it.id })), guest: false }; haptic(); showShop(slot); } catch { toast('Gagal pakai item.'); }
        return;
      }
      if (P.guest) return toast('Buka Bola Kertas dalam Telegram untuk membeli.');
      if (it.coins) {
        if (P.coins < it.coins) return toast(`Coins tak cukup. Perlu ${it.coins - P.coins} lagi. Menang lawan CPU untuk kumpul.`);
        try { P = { ...(await api('/api/shop/buy', { item: it.id })), guest: false }; SFX.buy(); notify(); toast(`${it.name} dibeli!`); showShop(slot); } catch (e) { toast(e.code === 'coins' ? 'Coins tak cukup.' : 'Pembelian gagal.'); }
        return;
      }
      btn.disabled = true; btn.textContent = 'Membuka...';
      try {
        const { url } = await api('/api/shop/invoice', { item: it.id });
        tg.openInvoice(url, async status => {
          btn.disabled = false;
          if (status === 'paid' || status === 'pending') {
            toast(status === 'paid' ? 'Bayaran diterima. Memasukkan item...' : 'Bayaran sedang diproses.');
            for (let i = 0; i < 8; i++) { await new Promise(r => setTimeout(r, 1200)); await loadProfile(); if (P.owned.includes(it.id) || it.consumable) break; }
            if (P.owned.includes(it.id) || it.consumable) { SFX.buy(); notify(); toast(`${it.name} dah masuk loker!`); }
            showShop(slot);
          } else if (status === 'failed') { toast('Bayaran gagal. Stars anda tidak ditolak.'); showShop(slot); }
          else showShop(slot);
        });
      } catch (e) { btn.disabled = false; toast(e.code === 'owned' ? 'Anda sudah memiliki item ini.' : 'Tak dapat buka invois. Cuba lagi.'); showShop(slot); }
    };
  });
}

function showHelp() {
  const m = screen(`${header(true)}<main class="help"><h2 class="ttl">CARA MAIN</h2>
    <ol class="rules">
      <li><b>Tepuk kertas.</b> Tekan dan tahan kertas pemain yang bercincin, lepas untuk tepuk. Lagi lama tahan, lagi padu. Bola terus ke arah gol.</li><li><b>Nak ubah arah?</b> Sambil tahan, seret jari ke belakang macam lastik. Titik putih tunjuk laluan bola.</li>
      <li><b>Pilih jenis sepakan.</b> BUMI bergolek. CUNGKIL naik sikit melepasi seorang pemain. LAMBUNG tinggi melepasi barisan.</li>
      <li><b>${MAX_TAPS} tepukan.</b> Pemain paling dekat dengan bola akan tepuk. Satu pasukan boleh tepuk ${MAX_TAPS} kali berturut, kemudian giliran bertukar.</li>
      <li><b>Rembatan Padu.</b> Setiap kali pemain dapat giliran, cas naik. Penuh ${POWER_CHARGE} kali, tekan REMBATAN PADU dan bola meluncur terus ke gol.</li>
      <li><b>Penjaga gol</b> bergerak sendiri di garisan gol. Bidik ke sudut.</li>
      <li><b>Bola keluar</b> jadi bola lawan. Keluar di garisan gol: sepakan sudut atau sepakan gol.</li>
      <li><b>Kamera.</b> Kamera ikut pemain dan bola sendiri. Seret di tempat kosong untuk pusing, butang kamera tukar ke pandangan atas.</li>
      <li><b>Kertas.</b> Kertas lain beri stat lain. Kertas mahal tidak semestinya kuat: sesetengahnya untuk gaya sahaja.</li>
    </ol></main>`);
  bindHeader(m);
}
function showSettings() {
  const o = overlay(`<h2>TETAPAN</h2><button class="btn" id="snd">Bunyi: ${S.sound ? 'Hidup' : 'Mati'}</button><button class="btn" id="hint">Petunjuk: ${S.hints ? 'Hidup' : 'Mati'}</button><button class="btn" id="cam">Kamera lalai: ${S.cam === 'player' ? 'Pemain' : 'Atas'}</button><button class="btn ghost" id="cl">Tutup</button>`);
  o.querySelector('#snd').onclick = () => { S.sound = !S.sound; saveS(); showSettings(); };
  o.querySelector('#hint').onclick = () => { S.hints = !S.hints; saveS(); showSettings(); };
  o.querySelector('#cam').onclick = () => { S.cam = S.cam === 'player' ? 'top' : 'player'; saveS(); showSettings(); };
  o.querySelector('#cl').onclick = closeAllOverlays;
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

async function boot() {
  try { tg?.ready(); tg?.expand(); tg?.disableVerticalSwipes?.(); tg?.setHeaderColor?.('#070b16'); tg?.setBackgroundColor?.('#070b16'); } catch {}
  await document.fonts?.ready;
  await loadProfile();
  stageMenuScene(); requestAnimationFrame(loop);
  const room = new URLSearchParams(location.search).get('room') || (tg?.initDataUnsafe?.start_param || '').replace(/^room_/, '');
  showHome();
  if (/^[A-Z0-9]{4,8}$/.test(room || '')) joinRoom(room);
  $('#boot')?.classList.add('gone');
}
boot();
