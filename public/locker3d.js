// locker3d.js : Locker and menu art rendered by the match renderer itself.
// Every thumbnail is a real World (scene.js) with the item applied, so what the shop shows is what the match shows.
import * as THREE from 'three';
import { World, makePlayer, makeBall } from './scene.js?v=38';
import { itemById, DEFAULT_EQUIP } from './items.js?v=38';

// HD: thumbnails render at 2x their on-screen size (min 512), live preview at device pixel ratio up to 1024px.
const DPR = Math.min(2, Math.max(1, devicePixelRatio || 1));
const THUMB = Math.max(512, Math.ceil(190 * DPR / 64) * 64);
let W = null, owner = null; // the live preview that owns the shared World; thumbnails wait while one is open
const studio = () => W || (W = new World(document.createElement('canvas'), [THUMB, THUMB]));
const sizeTo = px => { const w = studio(); if (w.size[0] !== px) { w.size = [px, px]; w.resize(); } };
const urls = new Map(), previewOpen = () => owner && owner.alive;

const lookOf = (id, fb) => { const it = itemById(id) || itemById(fb); return { ...it.look, rarity: it.rarity }; };

// Build one shot. o = { equip, team, kit, opp, oppKit, players: [[x,z,ry,side]], cam: [pos, look, fov], fx, number }
function stage(o) {
  const w = studio(), e = { ...DEFAULT_EQUIP, ...o.equip };
  if (w._pitchId !== e.pitch) { w.setPitch(lookOf(e.pitch, 'f_stripes'), 128); w._pitchId = e.pitch; }
  if (w.venueId !== e.venue || !w._base) { w.setVenue(e.venue); w._base = [w.hemi.intensity, w.r.toneMappingExposure]; }
  const lift = o.lift ?? 1; w.hemi.intensity = w._base[0] + 0.6 * lift; w.r.toneMappingExposure = w._base[1] * (1 + 0.12 * lift); // product-shot fill; venue shots keep their mood
  w.setBall(lookOf(e.ball, 'b_classic'));
  w.disposeGroup(w.dyn); w.pieces = [];
  w.particles.forEach(p => { w.fx.remove(p.m); const g = p.m.geometry; if (!p.sprite && --g.userData.refs <= 0) g.dispose(); p.m.material.dispose(); }); w.particles = []; w.queue = [];
  const cache = new Map();
  for (const [x, z, ry, side = 0, num] of o.players || []) {
    const pl = makePlayer({ team: side ? o.opp : o.team, kit: side ? o.oppKit : o.kit, number: num ?? o.number ?? 10, name: o.name || 'KAPTEN', look: side ? lookOf('p_a4') : o.star ? lookOf(o.star) : lookOf(e.paper, 'p_a4') }, cache);
    pl.root.position.set(x, 0, z); pl.root.rotation.y = ry; w.dyn.add(pl.root); w.pieces.push({ ...pl, data: { id: w.pieces.length } });
  }
  const [bx, bz] = o.ball || [0.5, 0.75]; w.ballMesh.position.set(bx, 0.16, bz); w.ballRing.visible = false;
  w.showAim(null);
  const [pos, look, fov] = o.cam; w.cam.fov = fov || 40; w.cam.updateProjectionMatrix(); w.cam.position.set(...pos); w.cam.lookAt(...look);
  if (o.fx) { w.goalFx(o.fx.kind, 0, 0, o.fx.colors); for (let i = 0; i < (o.fx.steps || 4); i++) w.update(1 / 30, i / 30); } // freeze at the peak
  if (o.tap) { w.tapFx(-0.55, 0.25, w.pieces[0].rank, w.pieces[0].color); for (let i = 0; i < 4; i++) w.update(0.05, 1.2 + i * 0.05); }
  w.update(0.016, 1.3);
  return w;
}

// Camera presets per slot. Players: tent front faces +z.
const HERO = [[1.25, 0.8, 1.75], [0, 0.34, 0], 38];
function shotFor(it, ctx) {
  const base = { equip: { ...ctx.equip }, team: ctx.team, kit: ctx.kit, opp: ctx.opp, oppKit: ctx.oppKit };
  const s = it.slot;
  if (s === 'bundle') { const [p, f, v] = it.grants; return { ...base, equip: { ...base.equip, paper: p, pitch: f, venue: v }, players: [[0, 0, 0.35]], ball: [-0.62, 0.42], cam: [[1.6, 1.1, 2.3], [0, 0.35, 0], 42], tap: true }; }
  if (s === 'star') return { ...base, star: it.id, number: it.id === 's_carton' ? 1 : 10, players: [[0, 0, 0.35]], ball: [-0.62, 0.42], cam: HERO, tap: it.rarity !== 'common' };
  if (s === 'paper') return { ...base, equip: { ...base.equip, paper: it.id }, players: [[0, 0, 0.35]], ball: [-0.62, 0.42], cam: HERO, tap: it.rarity !== 'common' };
  if (s === 'pitch') return { ...base, equip: { ...base.equip, pitch: it.id }, players: [[-1.4, -0.6, 0], [1.3, 0.8, Math.PI, 1], [0.2, -2.6, 0]], ball: [0.1, 0.1], cam: [[0, 6.2, 6.2], [0, 0, -0.4], 44] };
  if (s === 'venue') return { ...base, lift: 0, equip: { ...base.equip, venue: it.id }, players: [[0, 6, 0], [-2, 8, 0, 0, 7], [1.6, 4.2, Math.PI, 1]], ball: [0.2, 6.6], cam: [[0, 6.5, 19], [0, 0.5, -1], 52] };
  if (s === 'ball') return { ...base, equip: { ...base.equip, ball: it.id }, players: [[-0.55, -0.55, 0.5]], ball: [0.15, 0.2], cam: [[0.75, 0.42, 0.95], [0.12, 0.17, 0.18], 34] };
  if (s === 'fx') return { ...base, players: [[0, 0, 0]], ball: [0.6, -0.4], cam: [[0, 1.2, 10.5], [0, 4.6, 0], 62], fx: { kind: it.id, colors: [ctx.kit.base, ctx.kit.accent], steps: it.id === 'x_fireworks' ? 40 : it.id === 'x_confetti' ? 22 : 10 } };
  if (s === 'studio') return { ...base, kit: { ...ctx.kit, id: 'k_studio', pattern: 'batik', base: '#7a1f2b', accent: '#e8b84a', trim: '#ffd45a', number: '#ffffff', collar: 'polo' }, players: [[-0.5, 0, 0.7], [0.5, 0, -0.7]], ball: [0, 0.9], cam: [[0, 0.95, 2.4], [0, 0.34, 0], 40] };
  return { ...base, players: [[0, 0, 0.35]], ball: [-0.62, 0.42], cam: HERO }; // pass
}

const snap = w => { sizeTo(THUMB); w.render(); return w.r.domElement.toDataURL('image/webp', 0.95); };
const sig = ctx => `${ctx.team.id}|${ctx.kit.id === 'custom' ? JSON.stringify(ctx.kit) : ctx.kit.id}|${Object.values(ctx.equip).join(',')}`;
const frame = () => new Promise(r => requestAnimationFrame(r));

// Thumbnails, one per frame so the menu never freezes. onEach(id, dataURL).
export async function thumbs(items, ctx, onEach) {
  const key = sig(ctx);
  // group by venue so the expensive venue rebuild happens as rarely as possible
  const order = [...items].sort((a, b) => (a.slot === 'venue' ? a.id : '').localeCompare(b.slot === 'venue' ? b.id : ''));
  for (const it of order) {
    const k = `${it.id}|${key}`;
    if (!urls.has(k)) { do await frame(); while (previewOpen()); try { urls.set(k, snap(stage(shotFor(it, ctx)))); } catch (e) { console.warn('thumb', it.id, e); continue; } }
    onEach(it.id, urls.get(k));
  }
}

// Menu icons: paper players posed for each mode.
export async function icon(kind, ctx) {
  const k = `icon:${kind}|${sig(ctx)}`; if (urls.has(k)) return urls.get(k);
  const b = { equip: ctx.equip, team: ctx.team, kit: ctx.kit, opp: ctx.opp, oppKit: ctx.oppKit };
  const o = {
    hero: { ...b, players: [[-0.62, 0, 0.5], [0.62, 0.1, Math.PI - 0.5, 1]], ball: [0, 0.75], cam: [[0, 1.0, 3.6], [0, 0.42, 0], 40] },
    cpu: { ...b, players: [[0, 0, 0.45]], ball: [-0.62, 0.42], cam: HERO },
    two: { ...b, players: [[-0.55, 0, 0.6], [0.55, 0, -0.6, 1]], ball: [0, 0.55], cam: [[0, 0.9, 2.3], [0, 0.3, 0], 40] },
    web: { ...b, players: [[-0.9, -0.6, 0.5], [0.9, -0.6, -0.5, 1], [0, -1.8, 0, 0, 7]], ball: [0, 0.3], cam: [[0, 1.6, 2.6], [0, 0.2, -0.7], 46] },
    shop: { ...b, equip: { ...b.equip, paper: 'p_gold' }, players: [[0, 0, 0.35]], ball: [-0.62, 0.42], cam: HERO, tap: true },
    studio: { ...b, players: [[-0.5, 0, 0.7], [0.5, 0, -0.7]], ball: [0, 0.9], cam: [[0, 0.95, 2.4], [0, 0.34, 0], 40] },
    pen: { ...b, players: [[0, -0.2, 0.15]], ball: [0, 0.75], cam: [[0.25, 0.75, -1.9], [0, 0.35, 0.4], 42] },
    help: { ...b, players: [[0, 0, 0.2]], ball: [0.2, 0.7], cam: [[1.35, 1.0, 1.9], [0, 0.3, 0.2], 40], tap: true },
  }[kind];
  do await frame(); while (previewOpen());
  const url = snap(stage(o)); urls.set(k, url); return url;
}

// Live, touch-rotatable preview inside the item sheet. Returns { tap(), close() }.
export function preview(host, it, ctx) {
  if (owner) owner.alive = false; // only one live preview at a time
  const me = { alive: true }; owner = me;
  const w = studio(), o = shotFor(it, ctx); delete o.fx; delete o.tap; stage(o);
  // Showcase lights for the item preview only: warm key from the camera side + a rim in the rarity colour behind,
  // so dark venues (night rooftop) never swallow the paper. Removed on close.
  const rank = { rare: 1, epic: 2, legend: 3, myth: 4 }[it.rarity] || 0, hero = ['paper', 'star', 'bundle', 'pass'].includes(it.slot);
  const key = new THREE.PointLight('#fff2d6', hero ? 2.6 : 0, 7, 1.2), rim = new THREE.PointLight({ 3: '#ffb21e', 4: '#ff5fd2' }[rank] || '#7fd0ff', hero && rank >= 3 ? 7 : 0, 5, 1.2);
  w.scene.add(key, rim);
  sizeTo(Math.min(1024, Math.ceil((host.clientWidth || Math.min(innerWidth, 440)) * DPR / 64) * 64));
  const c = w.r.domElement; host.append(c); c.style.cssText = 'width:100%;height:100%;display:block;touch-action:none';
  const [pos, look] = o.cam, tgt = new THREE.Vector3(...look), off = new THREE.Vector3(...pos).sub(tgt);
  let yaw = 0, drag = null, t = 0, last = performance.now(), auto = true;
  c.onpointerdown = e => { drag = e.clientX; auto = false; c.setPointerCapture(e.pointerId); };
  c.onpointermove = e => { if (drag != null) { yaw -= (e.clientX - drag) / 90; drag = e.clientX; } };
  c.onpointerup = c.onpointercancel = () => { drag = null; };
  const p0 = w.pieces[0];
  const loop = now => {
    if (!me.alive || !c.isConnected) { me.alive = false; w.scene.remove(key, rim); return; } requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt; if (auto) yaw = hero ? Math.sin(t * 0.7) * 0.6 : yaw + dt * 0.35; // players sway to show the front, never the plain back
    const v = off.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw); w.cam.position.copy(tgt).add(v); w.cam.lookAt(tgt);
    key.position.copy(w.cam.position).lerp(tgt, 0.35).add(new THREE.Vector3(0, 0.6, 0)); rim.position.copy(tgt).sub(v.clone().setY(0).normalize().multiplyScalar(1.2)).setY(1.1);
    if (p0 && hero) p0.root.position.y = rank >= 3 ? 0.04 + Math.sin(t * 2) * 0.03 : 0; // mythic and legend hover
    if (p0 && p0.flipT != null) { p0.flipT += dt; const u = p0.flipT, sq = u < 0.08 ? Math.sin(u / 0.08 * Math.PI / 2) : u < 0.2 ? 1 : u < 0.9 ? Math.exp(-4 * (u - 0.2) / 0.7) * Math.cos(8.5 * (u - 0.2) / 0.7) * (1 - (u - 0.2) / 0.7) : 0;
      p0.body.scale.set(1 + sq * 0.12, Math.max(0.2, 1 - sq * 0.7), 1 + sq * 0.9); }
    if (p0 && p0.rank >= 2 && (t % 4) < dt && t > 2.5) { p0.flipT = 0; const r = p0.root.rotation.y; w.tapFx(Math.sin(r) * 0.5, Math.cos(r) * 0.5, p0.rank, p0.color); }
    w.update(dt, t); w.render();
  };
  requestAnimationFrame(loop);
  return {
    tap() { if (!p0) return; p0.flipT = 0; const r = p0.root.rotation.y; w.tapFx(p0.root.position.x + Math.sin(r) * 0.5, p0.root.position.z + Math.cos(r) * 0.5, p0.rank, p0.color);
      if (it.slot === 'fx') w.goalFx(it.id, 0, 0, [ctx.kit.base, ctx.kit.accent]); },
    goal() { w.goalFx(it.slot === 'fx' ? it.id : ctx.equip.fx, 0, 0, [ctx.kit.base, ctx.kit.accent], it.setFx); },
    close() { me.alive = false; w.scene.remove(key, rim); key.dispose(); rim.dispose(); if (c.parentNode) c.remove(); },
  };
}
// Coin toss: one small renderer, made once and reused. Gold coin with KEPALA / BUNGA faces.
// spin() tumbles while waiting; land(face) tosses up, flips and settles on that face. Stops drawing when idle.
let C = null;
function coinKit() {
  if (C) return C;
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' }); r.setPixelRatio(DPR); r.setSize(180, 180, false); r.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(32, 1, 0.1, 50); cam.position.set(0, 0.4, 6); cam.lookAt(0, 0.2, 0);
  scene.add(new THREE.HemisphereLight(0xfff6dc, 0x6a4a1a, 1.6)); const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(2, 4, 5); scene.add(key);
  const face = (txt, sub) => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
    const gr = g.createRadialGradient(100, 90, 10, 128, 128, 128); gr.addColorStop(0, '#fff1a8'); gr.addColorStop(0.6, '#f2b632'); gr.addColorStop(1, '#b97a12'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#8a5a0a'; g.lineWidth = 10; g.beginPath(); g.arc(128, 128, 112, 0, 7); g.stroke(); g.lineWidth = 3; g.beginPath(); g.arc(128, 128, 96, 0, 7); g.stroke();
    g.textAlign = 'center'; g.fillStyle = '#ffffff'; g.strokeStyle = '#2a1f5c'; g.lineWidth = 10; g.lineJoin = 'round'; g.font = '400 120px "Lilita One", "Rubik Cyr", Arial';
    g.strokeText(txt, 128, 165); g.fillText(txt, 128, 165); g.font = '900 22px Nunito, Arial'; g.fillStyle = '#2a1f5c'; g.fillText(sub, 128, 214);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return new THREE.MeshStandardMaterial({ map: t, metalness: 0.55, roughness: 0.32 }); };
  const rim = new THREE.MeshStandardMaterial({ color: '#d99a22', metalness: 0.85, roughness: 0.3 });
  const coin = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.16, 48), [rim, null, null]); coin.rotation.x = Math.PI / 2; // face +z = top cap
  const pivot = new THREE.Group(); pivot.add(coin); scene.add(pivot);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.22, depthWrite: false })); shadow.rotation.x = -Math.PI / 2; shadow.position.y = -1.5; scene.add(shadow);
  C = { r, scene, cam, coin, pivot, shadow, face, faces: null, run: 0 };
  return C;
}
export function coin(host, labels) {
  const k = coinKit(), key = labels.join('|');
  if (k.faces !== key) { k.faces = key; k.coin.material[1]?.map.dispose(); k.coin.material[2]?.map.dispose(); k.coin.material[1] = k.face(labels[0], labels[1]); k.coin.material[2] = k.face(labels[2], labels[3]); }
  const c = k.r.domElement; c.style.cssText = 'width:150px;height:150px;display:block'; host.append(c);
  const run = ++k.run, P = k.pivot; let mode = 'idle', t = 0, last = performance.now(), s0 = 0, end = 0, onDone = null;
  P.position.set(0, 0, 0); P.rotation.set(0.25, 0, 0); k.shadow.scale.setScalar(1);
  const ease = u => 1 - Math.pow(1 - u, 3);
  const loop = now => {
    if (run !== k.run || !c.isConnected) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    if (mode === 'idle') { P.rotation.y = Math.sin(t * 1.6) * 0.35; P.position.y = Math.sin(t * 2.2) * 0.06; }
    else if (mode === 'spin') { P.rotation.x += dt * 14; P.position.y = Math.abs(Math.sin(t * 6)) * 0.12; }
    else { const u = Math.min(1, t / 1.4), h = Math.sin(Math.min(1, u * 1.15) * Math.PI) * 1.6; // up and down once, then a small settle wobble
      P.position.y = Math.max(0, h); P.rotation.x = s0 + (end - s0) * ease(u) + (u >= 0.87 ? Math.sin((u - 0.87) * 40) * 0.12 * (1 - u) * 8 : 0); P.rotation.y = 0;
      k.shadow.scale.setScalar(1 - P.position.y * 0.25); k.shadow.material.opacity = 0.22 - P.position.y * 0.08;
      if (u >= 1 && onDone) { const f = onDone; onDone = null; f(); }
      if (u >= 1) { k.r.render(k.scene, k.cam); return; } } // landed: last frame, stop drawing
    k.r.render(k.scene, k.cam); requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return {
    spin() { mode = 'spin'; },
    land(side, done) { mode = 'land'; t = 0; last = performance.now(); onDone = done; // k: top cap faces camera; b: the other cap
      s0 = P.rotation.x % (Math.PI * 2); end = Math.PI * 6 + (side === 'b' ? Math.PI : 0) + 0.25; },
  };
}
export { makeBall };
