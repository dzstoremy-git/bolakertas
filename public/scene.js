// scene.js : Three.js world for Bola Kertas. Paper players, pitch, goals, venues, ball, aim guide, effects.
import * as THREE from 'three';
import { RoomEnvironment } from './vendor/addons/environments/RoomEnvironment.js?v=37';
import { FIELD, BALL_R, PIECE } from './engine.js?v=37';
import { jerseyFront, jerseyBack, paperSurface, pitchTexture, boardTexture, netTexture, ballTexture, APRON, shade, rng } from './art.js?v=37';
import { RARITY } from './items.js?v=37';
// [colours, start height, count, speed, gravity, size, glow, life]
const FX_SIMPLE = {
  x_team: ['team', 0.8, 110, 6.5, 8, 0.11, false, 2.4],
  x_stars: [['#fff3a0', '#ffd45a', '#ffffff'], 5.5, 120, 2.2, 1.4, 0.08, true, 2.8],
  x_balloon: [['#ff4f7a', '#2ad4ff', '#ffd400', '#7cff6b', '#b36bff'], 0.3, 40, 2.5, -1.6, 0.26, false, 3.5],
  x_leaves: [['#c8782a', '#e0a23c', '#8a5a1e', '#d9b45a'], 6, 90, 1.6, 2.2, 0.13, false, 3.6],
  x_merdeka: [['#cc0001', '#ffffff', '#010066', '#ffcc00'], 0.6, 150, 7.5, 6.5, 0.12, false, 3],
};

export const Q = (() => { // quality tier. Telegram WebView on mobile gets the lean tier.
  const touch = matchMedia('(pointer:coarse)').matches, slow = localStorage.getItem('bk/lowgfx') === '1'; // set by the frame-rate guard in game.js on a struggling device
  const low = slow || touch && (navigator.hardwareConcurrency || 4) <= 4;
  return { dpr: Math.min(devicePixelRatio || 1, slow ? 1 : low ? 1.25 : touch ? 1.6 : 1.5), shadow: low ? 1024 : 2048, aa: !touch && !slow, ppu: low ? 64 : 96, low, slow };
})();

const tex = (canvas, srgb = true, aniso = 8) => { const t = new THREE.CanvasTexture(canvas); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; return t; };

// Folded paper tent: a strip creased across the middle, both halves leaning in.
// Base footprint PIECE.w x PIECE.d, apex height PIECE.h. Front face looks at +z of the local frame.
function tentGeometry() {
  const w = PIECE.w, d = PIECE.d / 2, h = PIECE.h, t = 0.012, g = new THREE.BufferGeometry();
  const pos = [], uv = [], nor = [], groups = [];
  const quad = (a, b, c, d2, n, uvs, mat) => {
    const start = pos.length / 3;
    for (const v of [a, b, c, a, c, d2]) pos.push(...v);
    for (let i = 0; i < 6; i++) nor.push(...n);
    for (const k of [0, 1, 2, 0, 2, 3]) uv.push(...uvs[k]);
    groups.push([start, 6, mat]);
  };
  const lean = Math.atan2(d, h), nf = [0, Math.sin(lean), Math.cos(lean)], nb = [0, Math.sin(lean), -Math.cos(lean)];
  const U = [[0, 0], [1, 0], [1, 1], [0, 1]], Ub = [[1, 0], [0, 0], [0, 1], [1, 1]];
  // outer faces (printed)
  quad([-w / 2, 0, d], [w / 2, 0, d], [w / 2, h, 0], [-w / 2, h, 0], nf, U, 0);
  quad([w / 2, 0, -d], [-w / 2, 0, -d], [-w / 2, h, 0], [w / 2, h, 0], nb, U, 1);
  // inner faces (bare paper), offset by thickness
  const k = t / Math.cos(lean);
  quad([w / 2, 0, d - k], [-w / 2, 0, d - k], [-w / 2, h - k * 2, 0], [w / 2, h - k * 2, 0], nf.map(v => -v), Ub, 2);
  quad([-w / 2, 0, -d + k], [w / 2, 0, -d + k], [w / 2, h - k * 2, 0], [-w / 2, h - k * 2, 0], nb.map(v => -v), Ub, 2);
  // paper edges (thickness)
  for (const s of [-1, 1]) {
    const x = s * w / 2, n = [s, 0, 0];
    quad([x, 0, d], [x, 0, d - k], [x, h - k * 2, 0], [x, h, 0], n, U, 3);
    quad([x, 0, -d + k], [x, 0, -d], [x, h, 0], [x, h - k * 2, 0], n, U, 3);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  for (const [s, c, m] of groups) g.addGroup(s, c, m);
  return g;
}
const TENT = tentGeometry();
const GLOW = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 18, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.55, 'rgba(255,255,255,1)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return tex(c, false, 1); })();

// One paper player, exactly as it appears in a match. The Locker renders through this same function.
export function makePlayer({ team, kit, number, name, look }, cache) {
  const key = `${team.id}|${kit.id === 'custom' || kit.id === 'k_studio' ? JSON.stringify(kit) : kit.id}|${number}|${name}|${look.kind}|${look.base}|${look.rarity}`;
  let mats = cache?.get(key);
  if (!mats) {
    const grain = tex(paperSurface(look), false);
    if (look.kind === 'holo') kit = { ...kit, number: '#ffffff', numberOutline: 'rgba(20,0,60,0.7)' };
    if (look.kind === 'gold') kit = { ...kit, number: '#ffffff', numberOutline: 'rgba(0,0,0,0.6)' }; // relief source: white number = raised
    const surf = tex(paperSurface(look), true, 16), front = tex(jerseyFront(team, kit, number, 512, 640, look), true, 16), back = tex(jerseyBack(team, kit, number, name, 512, 640, look), true, 16);
    mats = [paperMaterial(front, look, true, grain), paperMaterial(back, look, true, grain), paperMaterial(surf, look, false, grain), new THREE.MeshStandardMaterial({ color: shade(look.base, -0.1), roughness: 0.9 })];
    cache?.set(key, mats);
  }
  const root = new THREE.Group(), body = new THREE.Mesh(TENT, mats);
  body.castShadow = true; body.receiveShadow = true; root.add(body);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.64, 48), new THREE.MeshBasicMaterial({ color: 0x16e0ff, transparent: true, opacity: 0, depthWrite: false, depthTest: false }));
  ring.renderOrder = 5; ring.rotation.x = -Math.PI / 2; ring.position.y = 0.012; root.add(ring);
  const rank = rankOf(look); let aura = null;
  if (rank >= 2) { // epic+: glowing ring at the feet
    aura = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), new THREE.MeshBasicMaterial({ map: GLOW, color: look.kind === 'gold' ? '#ffc23a' : rcolOf(look), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    aura.rotation.x = -Math.PI / 2; aura.position.y = 0.008; root.add(aura);
  }
  return { root, body, ring, aura, rank, color: look.kind === 'gold' ? '#ffc23a' : rcolOf(look) };
}
const SOFT = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return tex(c); })();
// Crumpled paper: a sphere pushed in and out by random creases (deterministic so every client sees the same ball).
function crumpleGeo(seed, amt) {
  const g = new THREE.IcosahedronGeometry(BALL_R, 3), p = g.attributes.position, r = rng(seed), dents = Array.from({ length: 22 }, () => new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize().multiplyScalar(r() < 0.5 ? -1 : 1)), v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).normalize(); let d = 0; for (const n of dents) d += Math.max(0, v.dot(n) - 0.8) * (dents.indexOf(n) % 2 ? 1 : -1); v.multiplyScalar(BALL_R * (1 + d * amt)); p.setXYZ(i, v.x, v.y, v.z); }
  g.computeVertexNormals(); return g;
}
export function makeBall(look) {
  const t = tex(ballTexture(look), true, 16), k = look.kind;
  const geo = k === 'crumple' ? crumpleGeo(7, 1.6) : k === 'origami' ? new THREE.IcosahedronGeometry(BALL_R * 1.05, 1) : k === 'disco' ? new THREE.SphereGeometry(BALL_R, 24, 14) : new THREE.SphereGeometry(BALL_R, 48, 32);
  const m = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ map: t, roughness: k === 'candy' ? 0.15 : k === 'crumple' || k === 'origami' ? 0.85 : k === 'rubber' ? 0.6 : k === 'disco' ? 0.08 : 0.35,
    metalness: k === 'disco' ? 0.35 : 0, clearcoat: k === 'candy' ? 1 : k === 'crumple' || k === 'origami' || k === 'rubber' ? 0 : 0.6, clearcoatRoughness: 0.1, flatShading: k === 'origami' || k === 'disco' || k === 'crumple',
    ...(k === 'fire' || k === 'galaxy' || k === 'disco' ? { emissive: '#ffffff', emissiveMap: t, emissiveIntensity: k === 'fire' ? 0.9 : k === 'disco' ? 0.45 : 0.6 } : {}) }));
  if (k === 'crumple') { // clear sellotape wrapped round the paper ball: glossy, slightly yellow, see-through
    const tt = document.createElement('canvas'); tt.width = 256; tt.height = 64; const tg2 = tt.getContext('2d'); // tape: glossy film, yellowed edges, wrinkles
    tg2.fillStyle = 'rgba(255,248,215,0.5)'; tg2.fillRect(0, 0, 256, 64); tg2.fillStyle = 'rgba(235,215,150,0.9)'; tg2.fillRect(0, 0, 256, 5); tg2.fillRect(0, 59, 256, 5);
    for (let i = 0; i < 26; i++) { tg2.strokeStyle = `rgba(255,255,255,${0.35 + (i % 3) * 0.2})`; tg2.lineWidth = 1 + (i % 2); tg2.beginPath(); tg2.moveTo(i * 10, 6); tg2.lineTo(i * 10 + 6 + (i % 4) * 3, 58); tg2.stroke(); }
    const tmap = new THREE.CanvasTexture(tt); tmap.colorSpace = THREE.SRGBColorSpace; tmap.wrapS = THREE.RepeatWrapping; tmap.repeat.set(3, 1);
    const tape = new THREE.MeshPhysicalMaterial({ map: tmap, transparent: true, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, side: THREE.DoubleSide, depthWrite: false, specularIntensity: 1 });
    for (const [rx, rz] of [[0, 0], [Math.PI / 2, 0.4], [0.7, Math.PI / 2]]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(BALL_R * 1.07, BALL_R * 1.07, BALL_R * 0.6, 48, 1, true), tape); b.rotation.set(rx, 0, rz); m.add(b); } }
  if (k === 'rubber') m.scale.set(1, 0.97, 1.02);
  m.castShadow = true; m.userData.spin = [];
  const halo = (c, s, op) => { const h = new THREE.Sprite(new THREE.SpriteMaterial({ map: SOFT, color: c, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false })); h.scale.setScalar(s); m.add(h); return h; };
  if (k === 'fire') { m.userData.glow = halo('#ff6a10', BALL_R * 6, 0.55); // flame tongues + embers flicker around the ball
    for (let i = 0; i < 10; i++) { const f = halo(i % 2 ? '#ffb02e' : '#ff3a0c', BALL_R * 2.2, 0.75); f.userData.a = i / 10 * 6.28; m.userData.spin.push(f); } m.userData.flame = true; }
  if (k === 'galaxy') { m.userData.glow = halo('#8f6bff', BALL_R * 5.5, 0.45);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(BALL_R * 1.6, BALL_R * 0.05, 8, 64), new THREE.MeshBasicMaterial({ color: '#c9b8ff', transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false })); ring.rotation.x = 1.2; m.add(ring); m.userData.ring = ring;
    for (let i = 0; i < 6; i++) { const st = halo(['#ffffff', '#9fefff', '#ff9fe8'][i % 3], BALL_R * 0.9, 1); st.userData.a = i / 6 * 6.28; st.userData.r = BALL_R * (1.5 + (i % 2) * 0.4); m.userData.spin.push(st); } }
  if (k === 'candy') m.userData.glow = halo('#ff7fb0', BALL_R * 4, 0.25);
  if (k === 'disco') { m.userData.glow = halo('#cfe6ff', BALL_R * 4, 0.3); for (let i = 0; i < 7; i++) { const st = halo(['#ffffff', '#9fefff', '#ff9fe8', '#fff1a0'][i % 4], BALL_R * 0.8, 1); st.userData.a = i / 7 * 6.28; st.userData.r = BALL_R * 1.02; m.userData.spin.push(st); } }
  return m;
}
export function animBall(m, t) { const u = m.userData; if (!u.spin) return;
  for (const [i, s] of u.spin.entries()) { const a = s.userData.a + t * (u.flame ? 4 : 1.6);
    if (u.flame) { const k = (t * 3 + i * 0.37) % 1; s.position.set(Math.cos(a) * BALL_R * 0.7, BALL_R * (0.2 + k * 2.4), Math.sin(a) * BALL_R * 0.7); s.material.opacity = (1 - k) * 0.85; s.scale.setScalar(BALL_R * (2.4 - k * 1.6)); }
    else { s.position.set(Math.cos(a) * s.userData.r, Math.sin(a * 1.3) * BALL_R * 0.5, Math.sin(a) * s.userData.r); s.material.opacity = 0.6 + Math.sin(t * 6 + i) * 0.4; } }
  if (u.glow) u.glow.material.opacity = (u.flame ? 0.5 : 0.4) + Math.sin(t * (u.flame ? 13 : 3)) * 0.08;
  if (u.ring) u.ring.rotation.z = t * 0.8; }
export function pitchMaterial(look, ppu, aniso) {
  const t = tex(pitchTexture(look, ppu), true, aniso);
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: look.style === 'neon' ? 0.5 : 0.95, metalness: 0, envMapIntensity: 0.3 });
  if (look.style === 'neon' || look.style === 'gold') { m.emissive = new THREE.Color(0xffffff); m.emissiveMap = t; m.emissiveIntensity = look.style === 'neon' ? 0.35 : 0.12; }
  return m;
}

// Rainbow foil that changes with the viewing angle, plus a bright prism band sliding across over time.
const HOLO_T = { value: 0 };
function holoFoil(m) {
  m.onBeforeCompile = sh => {
    sh.uniforms.uHoloT = HOLO_T;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uHoloT;\nvec3 hue3(float h){ return clamp(abs(mod(h*6.0+vec3(0.,4.,2.),6.)-3.)-1.,0.,1.); }')
      .replace('#include <opaque_fragment>', `
        float ndv = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
        float band = fract(vMapUv.x * 1.6 + vMapUv.y * 0.9 + ndv * 2.2 + uHoloT * 0.18);
        vec3 prism = hue3(band);
        float sweep = smoothstep(0.08, 0.0, abs(fract(vMapUv.x * 0.7 - vMapUv.y * 0.4 - uHoloT * 0.35) - 0.5) - 0.42);
        float fres = pow(1.0 - ndv, 2.0);
        outgoingLight = outgoingLight * (0.45 + prism * 0.85) + prism * (sweep * 0.3 + fres * 0.35);
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'holoFoil';
}
const rankOf = look => RARITY[look?.rarity]?.rank ?? 0;
const rcolOf = look => RARITY[look?.rarity]?.color ?? '#ffffff';
export const SHIMMER = new Set(); // myth paper materials, animated in update()
function paperMaterial(map, look, printed, grain) {
  const m = new THREE.MeshPhysicalMaterial({ map, roughness: look.rough ?? 0.85, metalness: printed ? (look.metal ?? 0) * 0.5 : look.metal ?? 0,
    clearcoat: look.clearcoat ?? 0, clearcoatRoughness: 0.15, side: THREE.FrontSide });
  const rank = rankOf(look);
  if (rank >= 1 && grain) { m.bumpMap = grain; m.bumpScale = rank >= 3 ? 2.2 : 1.4; }
  if (rank >= 4) { m.emissive = new THREE.Color(look.kind === 'gold' ? 0xffc04a : 0xff7ad8); m.emissiveIntensity = 0.18; m.userData.shimmer = look.kind; SHIMMER.add(m); }
  if (look.iri) { m.iridescence = 1; m.iridescenceIOR = 2.0; m.iridescenceThicknessRange = [100, 1400]; m.envMapIntensity = 2.2; }
  if (look.kind === 'gold') { m.color.set(printed ? 0xffffff : 0xf0b43a); m.metalness = 1; m.roughness = 0.26; m.clearcoat = 0.6; m.clearcoatRoughness = 0.08; m.envMapIntensity = 2.4; }
  else if (m.metalness > 0.2) m.envMapIntensity = 1.8;
  if (look.kind === 'laminate') { m.roughness = 0.45; m.clearcoat = 0.7; m.clearcoatRoughness = 0.05; m.envMapIntensity = 0.45; }
  if (look.kind === 'carbon') { m.roughness = 0.42; m.metalness = 0.1; m.clearcoat = 1; m.clearcoatRoughness = 0.12; m.envMapIntensity = 0.55; if (!printed) m.color.set(0x8a93a6); }
  if (look.kind === 'holo') { m.color.set(0xffffff); m.metalness = 0; m.roughness = 0.45; m.clearcoat = 0.5; m.envMapIntensity = 0.35; m.iridescence = 0; holoFoil(m); }
  return m;
}

const SPONSOR_IMG = new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = '/sponsor/revolix.png?v=37'; });
export class World {
  // size = [w, h] gives a fixed-size studio World (Locker previews) that renders with the exact match pipeline.
  constructor(canvas, size = null) {
    this.size = size;
    this.r = new THREE.WebGLRenderer({ canvas, antialias: size ? true : Q.aa, powerPreference: 'high-performance', alpha: false });
    this.r.setPixelRatio(size ? 1 : Q.dpr); this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.r.toneMapping = THREE.ACESFilmicToneMapping; this.r.toneMappingExposure = 0.82;
    this.r.shadowMap.enabled = true; this.r.shadowMap.type = THREE.PCFShadowMap;
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(46, 1, 0.05, 420);
    const pm = new THREE.PMREMGenerator(this.r); this.envMap = pm.fromScene(new RoomEnvironment(), 0.04).texture; this.scene.environment = this.envMap; this.scene.environmentIntensity = 0.45;
    this.hemi = new THREE.HemisphereLight(0xdfefff, 0x2f4a2a, 0.35); this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff4e2, 2.1); this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(size ? 2048 : Q.shadow, size ? 2048 : Q.shadow); this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.02; this.sun.shadow.radius = 4;
    Object.assign(this.sun.shadow.camera, { left: -11, right: 11, top: 15, bottom: -15, near: 1, far: 70 });
    this.sun.position.set(7, 22, 9); this.scene.add(this.sun, this.sun.target);
    if (Q.slow && !size) { this.sun.castShadow = false; this.r.shadowMap.enabled = false; } // light mode remembered from a slow run
    this.static = new THREE.Group(); this.venue = new THREE.Group(); this.dyn = new THREE.Group(); this.fx = new THREE.Group();
    this.scene.add(this.static, this.venue, this.dyn, this.fx);
    this.pieces = []; this.particles = []; this.camPos = new THREE.Vector3(0, 14, 16); this.camLook = new THREE.Vector3();
    this.buildGoals(); this.buildAim();
    this.resize(); if (!size) addEventListener('resize', () => this.resize());
  }
  resize() { const [w, h] = this.size || [innerWidth, innerHeight]; this.r.setSize(w, h, false); this.cam.aspect = w / h; this.cam.updateProjectionMatrix(); }

  disposeGroup(g) { g.traverse(o => { o.geometry && o.geometry !== TENT && o.geometry.dispose(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach(x => { SHIMMER.delete(x); x.map?.dispose(); x.bumpMap?.dispose(); x.dispose(); }); }); g.clear(); }

  setPitch(look, ppu = Q.ppu) {
    if (this.pitch) { this.static.remove(this.pitch); this.pitch.geometry.dispose(); this.pitch.material.map.dispose(); this.pitch.material.dispose(); }
    this.pitchLook = look;
    const m = pitchMaterial(look, ppu, this.r.capabilities.getMaxAnisotropy());
    this.pitch = new THREE.Mesh(new THREE.PlaneGeometry(FIELD.W + APRON * 2, FIELD.L + APRON * 2), m);
    this.pitch.rotation.x = -Math.PI / 2; this.pitch.receiveShadow = true; this.static.add(this.pitch);
    if (this.pitchFx) { this.disposeGroup(this.pitchFx); this.static.remove(this.pitchFx); } this.pitchFx = null;
    const st = look.style; if (st !== 'snow' && st !== 'neon' && st !== 'gold') return;
    const N = st === 'snow' ? (Q.low ? 260 : 600) : st === 'gold' ? 140 : 90, pos = new Float32Array(N * 3), seed = [];
    for (let i = 0; i < N; i++) { const x = (Math.random() - 0.5) * (FIELD.W + 4), z = (Math.random() - 0.5) * (FIELD.L + 4), y = Math.random() * 6; pos.set([x, y, z], i * 3); seed.push(Math.random() * 6.28); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pm = new THREE.Points(g, new THREE.PointsMaterial({ map: SOFT, color: st === 'snow' ? '#ffffff' : st === 'gold' ? '#ffd45a' : '#39f6ff', size: st === 'snow' ? 0.16 : 0.12, transparent: true, depthWrite: false, blending: st === 'snow' ? THREE.NormalBlending : THREE.AdditiveBlending }));
    this.pitchFx = new THREE.Group(); this.pitchFx.add(pm); this.static.add(this.pitchFx);
    this.pitchFx.userData.tick = (dt, t) => { const p = g.attributes.position.array;
      for (let i = 0; i < N; i++) { const j = i * 3;
        if (st === 'snow') { p[j + 1] -= dt * 0.7; p[j] += Math.sin(t + seed[i]) * dt * 0.25; if (p[j + 1] < 0) p[j + 1] = 6; }
        else { p[j + 1] = (st === 'gold' ? 0.2 : 0.05) + ((t * (st === 'gold' ? 0.35 : 0.2) + seed[i]) % 1.6); } }
      g.attributes.position.needsUpdate = true; if (st !== 'snow') pm.material.opacity = 0.55 + Math.sin(t * 2) * 0.3;
      if (st === 'neon') this.pitch.material.emissiveIntensity = 0.3 + Math.max(0, Math.sin(t * 2.4)) * 0.25; };
    this.pitchFx.userData.tick(0, 1.3);
  }

  buildGoals() {
    const post = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.2 });
    const nt = tex(netTexture(), false); nt.wrapS = nt.wrapT = THREE.RepeatWrapping;
    const net = (w, h, rx, ry) => { const t = nt.clone(); t.needsUpdate = true; t.repeat.set(rx, ry); return new THREE.MeshStandardMaterial({ map: t, alphaMap: t, color: 0x9aa3b5, transparent: true, side: THREE.DoubleSide, roughness: 1, depthWrite: false }); };
    for (const s of [-1, 1]) {
      const g = new THREE.Group(), gz = s * FIELD.L / 2, hw = FIELD.goalW / 2, H = FIELD.goalH, D = FIELD.goalD, R = FIELD.postR;
      const cyl = (len) => new THREE.CylinderGeometry(R, R, len, 14);
      for (const x of [-hw, hw]) { const p = new THREE.Mesh(cyl(H), post); p.position.set(x, H / 2, gz); p.castShadow = true; g.add(p); }
      const bar = new THREE.Mesh(cyl(FIELD.goalW + R * 2), post); bar.rotation.z = Math.PI / 2; bar.position.set(0, H, gz); bar.castShadow = true; g.add(bar);
      // back frame
      const bk = new THREE.MeshStandardMaterial({ color: 0xdedede, roughness: 0.5 });
      for (const x of [-hw, hw]) { const sp = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.5, R * 0.5, Math.hypot(D, H), 8), bk); sp.position.set(x, H / 2, gz + s * D / 2); sp.rotation.x = s * Math.atan2(D, H); g.add(sp); }
      const base = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.5, R * 0.5, FIELD.goalW, 8), bk); base.rotation.z = Math.PI / 2; base.position.set(0, R * 0.5, gz + s * D); g.add(base);
      // nets: sloped back, two side triangles
      const back = new THREE.Mesh(new THREE.PlaneGeometry(FIELD.goalW, Math.hypot(D, H)), net(0, 0, 10, 4));
      back.position.set(0, H / 2, gz + s * D / 2); back.rotation.x = -s * (Math.PI / 2 - Math.atan2(H, D)); back.rotation.order = 'YXZ'; if (s < 0) back.rotation.y = Math.PI; g.add(back);
      for (const x of [-hw, hw]) {
        const tri = new THREE.BufferGeometry(); tri.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, H, 0, 0, 0, s * D], 3));
        tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 0], 2)); tri.computeVertexNormals();
        const m = new THREE.Mesh(tri, net(0, 0, 3, 4)); m.position.set(x, 0, gz); g.add(m);
      }
      this.static.add(g);
    }
  }

  setVenue(id) {
    this.disposeGroup(this.venue); this.venueId = id;
    const V = this.venue, add = (geo, mat, x, y, z, shadow = false) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); if (shadow) m.receiveShadow = true; V.add(m); return m; };
    const std = (c, r = 0.8, mt = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: mt });
    const TW = FIELD.W + APRON * 2, TL = FIELD.L + APRON * 2;
    const sky = (top, bot) => { const c = document.createElement('canvas'); c.width = 4; c.height = 256; const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, top); gr.addColorStop(1, bot); g.fillStyle = gr; g.fillRect(0, 0, 4, 256); this.scene.background = tex(c); };
    const table = (top, leg, rim) => {
      add(new THREE.BoxGeometry(TW + 1.6, 0.5, TL + 1.6), top.isMaterial ? top : std(top, 0.55), 0, -0.26, 0, true);
      add(new THREE.BoxGeometry(TW + 1.7, 0.08, TL + 1.7), std(rim, 0.4, 0.2), 0, -0.07, 0);
      for (const x of [-1, 1]) for (const z of [-1, 1]) add(new THREE.BoxGeometry(0.6, 9, 0.6), std(leg, 0.6), x * (TW / 2), -4.9, z * (TL / 2));
    };
    const floor = (c, r = 0.9) => { const f = add(new THREE.PlaneGeometry(200, 200), std(c, r), 0, -9.4, 0, true); f.rotation.x = -Math.PI / 2; };
    const boards = (text, bg, fg) => {
      const t = tex(boardTexture(text, bg, fg)); t.wrapS = THREE.RepeatWrapping;
      for (const [x, z, ry, len] of [[0, -(TL / 2 + 0.25), 0, TW], [0, TL / 2 + 0.25, Math.PI, TW], [-(TW / 2 + 0.25), 0, Math.PI / 2, TL], [TW / 2 + 0.25, 0, -Math.PI / 2, TL]]) {
        const tt = t.clone(); tt.needsUpdate = true; tt.repeat.set(len / 12, 1);
        const b = add(new THREE.BoxGeometry(len, 0.45, 0.08), [std('#222'), std('#222'), std('#111'), std('#111'), new THREE.MeshStandardMaterial({ map: tt, emissive: 0xffffff, emissiveMap: tt, emissiveIntensity: 0.25, roughness: 0.6 }), std('#222')], x, 0.22, z);
        b.rotation.y = ry; b.castShadow = true;
      }
    };
    // Official sponsor: Revolix Gaming LED boards behind both goals and along both touchlines, on every venue.
    const sponsor = () => {
      const c = document.createElement('canvas'); c.width = 2048; c.height = 160; const g = c.getContext('2d'), t = tex(c); t.anisotropy = 8;
      const draw = img => {
        const gr = g.createLinearGradient(0, 0, 0, 160); gr.addColorStop(0, '#0d1b3d'); gr.addColorStop(1, '#050b1c'); g.fillStyle = gr; g.fillRect(0, 0, 2048, 160);
        g.fillStyle = '#2f8fff'; g.fillRect(0, 0, 2048, 6); g.fillRect(0, 154, 2048, 6);
        for (const x0 of [0, 1024]) {
          if (img) { const w = 440, h = w * img.height / img.width; g.drawImage(img, x0 + 36, (160 - h) / 2, w, h); } // logo left half, URL right half: never touch
          g.fillStyle = 'rgba(127,184,255,.35)'; g.fillRect(x0 + 512, 30, 3, 100);
          g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#7fb8ff'; g.font = '700 26px "Rajdhani", Arial'; g.fillText('OFFICIAL SPONSOR', x0 + 768, 40);
          g.fillStyle = '#ffffff'; g.font = '800 64px "Teko", Arial'; g.fillText('revolixgaming.com', x0 + 768, 98);
        }
        t.needsUpdate = true;
      };
      draw(null); SPONSOR_IMG.then(draw);
      const mat = new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.55, roughness: 0.5 }), dark = std('#0a0f1e', 0.6);
      const L = 9.6, H = 0.75, ez = TL / 2 + 0.62, sx = TW / 2 + 0.62;
      for (const [x, z, ry] of [[0, -ez, 0], [0, ez, Math.PI], [-sx, -5, Math.PI / 2], [sx, 5, -Math.PI / 2]]) {
        const b = add(new THREE.BoxGeometry(L, H, 0.1), [dark, dark, dark, dark, mat, dark], x, H / 2 + 0.02, z); b.rotation.y = ry; b.castShadow = true;
      }
    };
    const crowd = (count, radius, colors, lift = 0) => {
      const geo = new THREE.CapsuleGeometry(0.28, 0.5, 2, 6), mat = new THREE.MeshLambertMaterial(), mesh = new THREE.InstancedMesh(geo, mat, count);
      const m = new THREE.Matrix4(), c = new THREE.Color(); let i = 0;
      for (let tier = 0; tier < 5; tier++) for (let k = 0; k < count / 5 && i < count; k++, i++) {
        const a = (k / (count / 5)) * Math.PI * 2, rx = radius * 0.62 + tier * 1.4, rz = radius + tier * 1.4;
        m.makeTranslation(Math.cos(a) * rx, lift + tier * 0.9 + 0.5, Math.sin(a) * rz); mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, c.set(colors[(i * 7) % colors.length]));
      }
      this.crowd = mesh; this.crowdBase = []; for (let j = 0; j < count; j++) { mesh.getMatrixAt(j, m); this.crowdBase.push(new THREE.Vector3().setFromMatrixPosition(m)); }
      V.add(mesh);
    };
    this.crowd = null; this.scene.fog = null; this.sun.color.set(0xfff4e2); this.sun.intensity = 2.1; this.hemi.intensity = 0.35; this.r.toneMappingExposure = 0.82;
    this.spot = []; this.fan = null; this.blink = null; this.tick = [];
    const anim = f => { f(0, 1.3); this.tick.push(f); }; // run once so stills (Loker) show the effect mid-motion
    const cv = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); return tex(c, true, 8); };
    const glow = (c, op = 0.35, map) => new THREE.MeshBasicMaterial({ color: c, ...(map ? { map } : {}), transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const beamTex = cv(8, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#000'); gr.addColorStop(1, '#fff'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
    const beam = (from, to, rSrc, rDst, c, op) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rDst, rSrc, from.distanceTo(to), 32, 1, true), glow(c, op, beamTex)); m.position.copy(from).lerp(to, 0.5); m.lookAt(to); m.rotateX(Math.PI / 2); V.add(m); return m; };
    const puff = cv(64, 64, g => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
    const halo = (c, s, x, y, z, op = 0.5) => { const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: c, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); m.scale.setScalar(s); m.position.set(x, y, z); V.add(m); return m; };
    const steam = (x, y, z, n = 7) => { const s = []; for (let i = 0; i < n; i++) { const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, transparent: true, depthWrite: false })); V.add(m); s.push(m); }
      anim((dt, t) => s.forEach((m, i) => { const k = (t * 0.32 + i / n) % 1; m.position.set(x + Math.sin(t * 1.4 + i * 2) * 0.18 * k, y + k * 2.2, z); m.scale.setScalar(0.35 + k * 1.1); m.material.opacity = Math.sin(k * Math.PI) * 0.65; })); };
    const marble = cv(512, 512, (g, w, h) => { g.fillStyle = '#f4f2ee'; g.fillRect(0, 0, w, h); const r = rng(5);
      for (let i = 0; i < 18; i++) { g.strokeStyle = `rgba(120,120,128,${0.12 + r() * 0.25})`; g.lineWidth = 0.6 + r() * 2.2; g.beginPath(); let x = r() * w, y = r() * h; g.moveTo(x, y); for (let k = 0; k < 9; k++) { x += (r() - 0.3) * 90; y += (r() - 0.5) * 70; g.lineTo(x, y); } g.stroke(); } });
    const frondG = (() => { const g = new THREE.PlaneGeometry(1, 6, 1, 8); g.translate(0, 3, 0); const p = g.attributes.position; // drooping leaf, tapered tip
      for (let i = 0; i < p.count; i++) { const y = p.getY(i), k = y / 6; p.setX(i, p.getX(i) * (1.6 - k * 1.3)); p.setZ(i, -k * k * 3.4); } g.computeVertexNormals(); return g; })();
    const frondM = new THREE.MeshStandardMaterial({ color: '#3f8a2e', roughness: 0.8, side: THREE.DoubleSide });
    const palm = (x, z, hgt = 10) => { const lean = ((x * 7 + z) % 5) * 0.03, trunk = add(new THREE.CylinderGeometry(0.28, 0.45, hgt, 8), std('#7a5a3a', 0.95), x, -9.4 + hgt / 2, z); trunk.rotation.z = lean;
      const top = new THREE.Vector3(x - Math.sin(lean) * hgt / 2, -9.4 + hgt, z);
      for (let k = 0; k < 9; k++) { const f = new THREE.Mesh(frondG, frondM); f.position.copy(top); f.rotation.set(0, k * Math.PI * 2 / 9, 0); f.rotateX(-0.9 - (k % 3) * 0.15); f.scale.setScalar(hgt / 12); V.add(f); }
      for (let k = 0; k < 3; k++) add(new THREE.SphereGeometry(0.35 * hgt / 12, 10, 8), std('#5a3d1e', 0.7), top.x + Math.cos(k * 2.1) * 0.35, top.y - 0.4, top.z + Math.sin(k * 2.1) * 0.35); };
    const crowdFlash = (n, rx, rz, y0) => { // phone camera flashes in the stands
      const pos = new Float32Array(n * 3), r = rng(11); for (let i = 0; i < n; i++) { const a = r() * Math.PI * 2, t = r() * 4; pos.set([Math.cos(a) * (rx + t * 1.4), y0 + t * 0.9 + 1, Math.sin(a) * (rz + t * 1.4)], i * 3); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#ffffff', size: 0.9, map: puff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); V.add(pts);
      anim((dt, t) => { pts.material.opacity = 0.35 + Math.abs(Math.sin(t * 7.3)) * 0.65; pts.rotation.y = Math.floor(t * 3) * 0.37; }); };
    // 360 backdrop: paint(g, w, h) on a 4096x1024 canvas, x = angle (0 = north/-z, clockwise from above), mapped inside a tall cylinder.
    const pano = (paint, r = 150, h = 90, y0 = -12) => { const c = document.createElement('canvas'); c.width = Q.low ? 2048 : 4096; c.height = Q.low ? 512 : 1024; paint(c.getContext('2d'), c.width, c.height);
      const t = tex(c, true, 8), m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 96, 1, true), new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide, fog: false, depthWrite: false }));
      m.position.y = y0 + h / 2; m.rotation.y = Math.PI / 2; m.renderOrder = -1; V.add(m); return m; };
    const gradBand = (g, w, h, stops) => { const gr = g.createLinearGradient(0, 0, 0, h); stops.forEach(([o, c]) => gr.addColorStop(o, c)); g.fillStyle = gr; g.fillRect(0, 0, w, h); };
    const ridge = (g, w, h, y, amp, col, seed, f = 6) => { const r = rng(seed); g.fillStyle = col; g.beginPath(); g.moveTo(0, h); for (let x = 0; x <= w; x += w / 256) g.lineTo(x, y - amp * (0.5 + 0.5 * Math.sin(x / w * Math.PI * 2 * f + seed) * Math.sin(x / w * Math.PI * 2 * (f * 0.37) + seed * 2)) - r() * amp * 0.08); g.lineTo(w, h); g.fill(); };
    if (id === 'v_desk' || !id) {
      sky('#4f86c6', '#c9b79a'); table('#e8a917', '#4a3a2c', '#b77f00'); floor('#7a5b3e', 0.7);
      add(new THREE.PlaneGeometry(80, 26), std('#b9ab95', 0.95), 0, 2, -24);
      const board = add(new THREE.BoxGeometry(18, 7, 0.2), std('#1f3b2c', 0.9), 0, 6, -23.8);
      const ct = document.createElement('canvas'); ct.width = 1024; ct.height = 400; const g = ct.getContext('2d'); g.fillStyle = '#1f3b2c'; g.fillRect(0, 0, 1024, 400);
      g.fillStyle = 'rgba(255,255,255,0.85)'; g.font = '700 64px "Teko", Arial'; g.fillText('4-4-2  ->  TEPUK!', 70, 140); g.font = '600 44px "Teko", Arial'; g.fillText('Rehat: 10.30 pagi', 70, 260);
      board.material = [std('#5a4632'), std('#5a4632'), std('#5a4632'), std('#5a4632'), new THREE.MeshStandardMaterial({ map: tex(ct), roughness: 0.95 }), std('#5a4632')];
      for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(1.4, 0.5, 1), std(['#e8483c', '#3a7be8', '#f2c230', '#33a35a'][i], 0.7), -8 + i * 0.5, 0.25 + i * 0.5, 10.8 - i * 0.2);
      const pencil = add(new THREE.CylinderGeometry(0.09, 0.09, 4.2, 6), std('#f2b705', 0.6), 7.6, 0.1, 4); pencil.rotation.set(Math.PI / 2, 0, 0.3); // pencil + ruler on the desk
      add(new THREE.BoxGeometry(0.7, 0.04, 7), std('#d9e7f2', 0.3), -7.9, 0.02, -3);
      pano((g, w, h) => { gradBand(g, w, h, [[0, '#cfc3ad'], [0.62, '#b9ab95'], [0.63, '#8a6a4a'], [1, '#6e5238']]); // wall + wood skirting
        const at = a => (a / 360) * w, win = (cx) => { for (let k = -2; k <= 2; k++) { const x = at(cx) + k * w * 0.028; const gr = g.createLinearGradient(0, h * 0.18, 0, h * 0.52); gr.addColorStop(0, '#7fb6ea'); gr.addColorStop(1, '#d8ecff'); g.fillStyle = '#e9e4d8'; g.fillRect(x - w * 0.012, h * 0.16, w * 0.024, h * 0.38); g.fillStyle = gr; g.fillRect(x - w * 0.01, h * 0.18, w * 0.02, h * 0.34); g.fillStyle = '#e9e4d8'; g.fillRect(x - w * 0.012, h * 0.34, w * 0.024, h * 0.012); g.fillStyle = 'rgba(80,140,60,0.8)'; g.beginPath(); g.arc(x - w * 0.004, h * 0.5, w * 0.008, 0, 7); g.fill(); } };
        win(90); // east windows with trees outside
        for (let k = 0; k < 9; k++) { const x = at(244) + k * w * 0.012; g.fillStyle = ['#3d6fb6', '#4a7cc2'][k % 2]; g.fillRect(x, h * 0.3, w * 0.011, h * 0.32); g.fillStyle = '#20406e'; g.fillRect(x + w * 0.002, h * 0.34, w * 0.007, h * 0.006); g.fillRect(x + w * 0.002, h * 0.47, w * 0.007, h * 0.006); } // west lockers
        g.fillStyle = '#7a4a26'; g.fillRect(at(292), h * 0.22, w * 0.03, h * 0.4); g.fillStyle = '#c9a25a'; g.beginPath(); g.arc(at(292) + w * 0.026, h * 0.43, w * 0.002, 0, 7); g.fill(); // door
        g.fillStyle = '#b07a3a'; g.fillRect(at(170), h * 0.2, w * 0.06, h * 0.24); g.fillStyle = '#d9c28a'; g.fillRect(at(170) + 6, h * 0.2 + 6, w * 0.06 - 12, h * 0.24 - 12); // south notice board + pinned papers
        const r = rng(4); for (let k = 0; k < 7; k++) { g.fillStyle = ['#fff', '#ffe27a', '#ffb3c7', '#a8e1ff'][k % 4]; g.save(); g.translate(at(171) + r() * w * 0.05, h * 0.23 + r() * h * 0.15); g.rotate((r() - 0.5) * 0.3); g.fillRect(0, 0, w * 0.012, h * 0.05); g.restore(); }
        g.fillStyle = '#ffffff'; g.beginPath(); g.arc(at(200), h * 0.16, w * 0.009, 0, 7); g.fill(); g.strokeStyle = '#222'; g.lineWidth = 4; g.stroke(); g.beginPath(); g.moveTo(at(200), h * 0.16); g.lineTo(at(200), h * 0.13); g.moveTo(at(200), h * 0.16); g.lineTo(at(200) + w * 0.005, h * 0.16); g.stroke(); // clock
        g.fillStyle = '#c0392b'; g.fillRect(at(20), h * 0.06, w * 0.06, h * 0.03); g.fillStyle = '#fff'; g.font = `800 ${h * 0.022}px "Teko", Arial`; g.fillText('BERSIH  CEKAP  AMANAH', at(20) + 10, h * 0.083);
      }, 60, 40, -10);
      for (const [x, z] of [[-26, 14], [-26, 4], [26, 14], [26, 4], [-26, -6], [26, -6]]) { add(new THREE.BoxGeometry(6, 0.5, 4), std('#c9a26a', 0.6), x, -1.2, z, true); for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.35, 8, 0.35), std('#3a3a3a', 0.5, 0.5), x + sx * 2.6, -5.4, z); add(new THREE.BoxGeometry(2.2, 0.4, 2.2), std('#2f6fb6', 0.6), x, -5, z + 3.4); } // classmates' desks + chairs
    } else if (id === 'v_field') {
      sky('#ff9e5e', '#ffe2a8'); this.sun.color.set(0xffd0a0); this.sun.position.set(-12, 10, -6); table('#c79b5f', '#6b4a2a', '#9a6e3a'); floor('#5f8f3a', 1);
      for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2, r = 30 + (i % 3) * 6; palm(Math.cos(a) * r, Math.sin(a) * r, 13); }
      pano((g, w, h) => { gradBand(g, w, h, [[0, '#ff9e5e'], [0.55, '#ffe2a8'], [0.56, '#7a9a4a'], [1, '#4f7a2e']]);
        ridge(g, w, h, h * 0.55, h * 0.16, '#8fae78', 3, 5); ridge(g, w, h, h * 0.57, h * 0.09, '#5f8a42', 7, 9);
        const r = rng(9); for (let k = 0; k < 26; k++) { const x = r() * w, s = h * (0.035 + r() * 0.02), y = h * 0.57; // rumah kampung on stilts: wood body + zinc roof
          g.fillStyle = '#5a3a1e'; for (let q = -1; q <= 1; q++) g.fillRect(x + q * s * 0.6, y - s * 0.3, s * 0.08, s * 0.3); g.fillStyle = ['#8a5a30', '#9a6a3a', '#7a4f2a'][k % 3]; g.fillRect(x - s, y - s * 1.1, s * 2, s * 0.8);
          g.fillStyle = ['#b8b8b8', '#a33', '#9aa'][k % 3]; g.beginPath(); g.moveTo(x - s * 1.3, y - s * 1.05); g.lineTo(x, y - s * 1.9); g.lineTo(x + s * 1.3, y - s * 1.05); g.fill(); g.fillStyle = '#ffd98a'; g.fillRect(x - s * 0.5, y - s * 0.85, s * 0.3, s * 0.3); }
        const sx = w * 0.62, sy = h * 0.57; g.fillStyle = '#f2efe6'; g.fillRect(sx - h * 0.05, sy - h * 0.09, h * 0.1, h * 0.09); g.fillStyle = '#2f8f5a'; g.beginPath(); g.arc(sx, sy - h * 0.09, h * 0.05, Math.PI, 0); g.fill(); // surau + minaret
        g.fillStyle = '#f2efe6'; g.fillRect(sx + h * 0.08, sy - h * 0.17, h * 0.02, h * 0.17); g.fillStyle = '#2f8f5a'; g.beginPath(); g.moveTo(sx + h * 0.075, sy - h * 0.17); g.lineTo(sx + h * 0.09, sy - h * 0.2); g.lineTo(sx + h * 0.105, sy - h * 0.17); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.8)'; for (let k = 0; k < 12; k++) { const x = r() * w, y = h * (0.12 + r() * 0.25); g.beginPath(); g.ellipse(x, y, h * 0.06, h * 0.015, 0, 0, 7); g.fill(); } // clouds
        g.fillStyle = 'rgba(40,40,40,0.8)'; for (let k = 0; k < 10; k++) { const x = r() * w, y = h * (0.2 + r() * 0.15); g.beginPath(); g.moveTo(x - 8, y); g.quadraticCurveTo(x - 4, y - 5, x, y); g.quadraticCurveTo(x + 4, y - 5, x + 8, y); g.lineWidth = 2; g.strokeStyle = 'rgba(40,40,40,0.8)'; g.stroke(); } // birds
      });
      for (const [x, z] of [[-24, -8], [24, 6], [-22, 18], [22, -20]]) { add(new THREE.BoxGeometry(4.2, 2.6, 0.3), std('#6b4a2a', 0.9), x, -8.1, z); add(new THREE.BoxGeometry(4.6, 0.2, 1.4), std('#8a6a3a', 0.9), x, -8.4, z + 0.9); } // kampung benches
      const goat = (x, z) => { add(new THREE.BoxGeometry(1.6, 1, 0.8), std('#f2efe6', 0.9), x, -7.6, z); add(new THREE.BoxGeometry(0.6, 0.6, 0.5), std('#f2efe6', 0.9), x + 1, -7, z); for (const dx of [-0.6, 0.6]) for (const dz of [-0.3, 0.3]) add(new THREE.BoxGeometry(0.15, 1, 0.15), std('#cfc8b8'), x + dx, -8.6, z + dz); };
      goat(-28, 26); goat(30, -2);
      // east: warung with zinc roof; west: rumah kampung on stilts + motorbike; bunting all round
      { const w0 = new THREE.Group(); const wall = std('#9a6a3a', 0.9), zinc = std('#a9b0b6', 0.4, 0.6);
        const b = new THREE.Mesh(new THREE.BoxGeometry(9, 4.5, 6), wall); b.position.y = 2.25; w0.add(b); const rf = new THREE.Mesh(new THREE.BoxGeometry(11, 0.3, 8), zinc); rf.position.y = 5; rf.rotation.z = 0.12; w0.add(rf);
        const sg = cv(512, 128, (g, w, h) => { g.fillStyle = '#ffd400'; g.fillRect(0, 0, w, h); g.fillStyle = '#c0392b'; g.font = '800 84px "Teko", Arial'; g.textAlign = 'center'; g.fillText('WARUNG MAK TEH', w / 2, 96); });
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), new THREE.MeshBasicMaterial({ map: sg })); sign.position.set(-4.56, 3.4, 0); sign.rotation.y = -Math.PI / 2; w0.add(sign);
        for (const z of [-2, 2]) { const tb = new THREE.Mesh(new THREE.BoxGeometry(3, 0.25, 2), std('#f5f0e6', 0.4)); tb.position.set(-7, 2.4, z); w0.add(tb); const lg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.4, 0.2), std('#333')); lg.position.set(-7, 1.2, z); w0.add(lg); }
        w0.position.set(34, -9.4, 0); V.add(w0);
        const h0 = new THREE.Group(); const body = new THREE.Mesh(new THREE.BoxGeometry(8, 4.2, 7), std('#7a4f2a', 0.9)); body.position.y = 5; h0.add(body);
        for (const x of [-3.5, 0, 3.5]) for (const z of [-3, 3]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.4, 3, 0.4), std('#4a3020')); st.position.set(x, 1.5, z); h0.add(st); }
        const rf2 = new THREE.Mesh(new THREE.ConeGeometry(6.8, 3.6, 4, 1), std('#b33a2a', 0.7)); rf2.position.y = 8.9; rf2.rotation.y = Math.PI / 4; rf2.scale.set(1, 1, 1.15); h0.add(rf2);
        for (const z of [-1.8, 1.8]) { const wn = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), new THREE.MeshBasicMaterial({ color: '#ffd98a' })); wn.position.set(4.01, 5.2, z); wn.rotation.y = Math.PI / 2; h0.add(wn); }
        const stair = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.3, 4), std('#5a3a1e')); stair.position.set(5, 1.6, 0); stair.rotation.z = 0.6; h0.add(stair);
        h0.position.set(-36, -9.4, 2); V.add(h0);
        const bike = new THREE.Group(); for (const x of [-1, 1]) { const wh = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.15, 8, 20), std('#111')); wh.position.set(x, 0.6, 0); bike.add(wh); } const bb = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.7, 0.6), std('#c0392b', 0.4, 0.3)); bb.position.y = 1.2; bike.add(bb); bike.position.set(-29, -9.4, 10); bike.rotation.y = 0.5; V.add(bike);
        const bunt = cv(512, 64, (g, w, h) => { for (let i = 0; i < 16; i++) { g.fillStyle = ['#d71920', '#ffd400', '#1b3f94', '#ffffff'][i % 4]; g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32 + 32, 0); g.lineTo(i * 32 + 16, 56); g.fill(); } });
        for (const [x1, z1, x2, z2] of [[-26, -24, 26, -24], [-26, 24, 26, 24], [-26, -24, -26, 24], [26, -24, 26, 24]]) { const len = Math.hypot(x2 - x1, z2 - z1), m = new THREE.Mesh(new THREE.PlaneGeometry(len, 1), new THREE.MeshBasicMaterial({ map: bunt, transparent: true, side: THREE.DoubleSide, alphaTest: 0.1 })); m.position.set((x1 + x2) / 2, 4, (z1 + z2) / 2); m.rotation.y = -Math.atan2(z2 - z1, x2 - x1); bunt.wrapS = THREE.RepeatWrapping; bunt.repeat.set(len / 8, 1); V.add(m); } }
      this.scene.fog = new THREE.Fog('#ffd8a0', 60, 160);
    } else if (id === 'v_kopitiam') {
      sky('#2a1c14', '#5a3d2a'); this.sun.color.set(0xffe2b8); this.sun.intensity = 1.5; this.hemi.intensity = 0.45; this.r.toneMappingExposure = 0.9;
      const mTop = new THREE.MeshStandardMaterial({ map: marble, roughness: 0.25 }); table(mTop, '#2b2b2b', '#bdbab3');
      const tiles = cv(512, 512, (g, w, h) => { g.fillStyle = '#e9efe9'; g.fillRect(0, 0, w, h); g.fillStyle = '#c9d6cc'; for (let y = 0; y < h; y += 32) for (let x = 0; x < w; x += 32) g.fillRect(x, y, 31, 1), g.fillRect(x, y, 1, 31); });
      tiles.wrapS = tiles.wrapT = THREE.RepeatWrapping; tiles.repeat.set(10, 4);
      const flr = cv(256, 256, (g, w, h) => { for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { g.fillStyle = (x + y) % 2 ? '#8e2f22' : '#c9c0b0'; g.fillRect(x * 32, y * 32, 32, 32); } }); flr.wrapS = flr.wrapT = THREE.RepeatWrapping; flr.repeat.set(25, 25);
      const f = add(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ map: flr, roughness: 0.6 }), 0, -9.4, 0, true); f.rotation.x = -Math.PI / 2;
      add(new THREE.PlaneGeometry(120, 12), new THREE.MeshStandardMaterial({ map: tiles, roughness: 0.4 }), 0, -3.4, -46);
      add(new THREE.PlaneGeometry(120, 30), std('#e8d7b0', 0.95), 0, 17.6, -46.1);
      const sign = cv(1024, 192, (g, w, h) => { g.fillStyle = '#b3201c'; g.fillRect(0, 0, w, h); g.strokeStyle = '#ffd34a'; g.lineWidth = 10; g.strokeRect(10, 10, w - 20, h - 20); g.fillStyle = '#ffd34a'; g.font = '800 104px "Teko", Arial'; g.textAlign = 'center'; g.fillText('KEDAI KOPI BOLA KERTAS', w / 2, 132); });
      add(new THREE.BoxGeometry(44, 8.2, 0.4), [std('#7a1512'), std('#7a1512'), std('#7a1512'), std('#7a1512'), new THREE.MeshStandardMaterial({ map: sign, emissive: '#ffffff', emissiveMap: sign, emissiveIntensity: 0.35, roughness: 0.5 }), std('#7a1512')], 0, 14.5, -45.6);
      const menu = cv(512, 640, (g, w, h) => { g.fillStyle = '#16301f'; g.fillRect(0, 0, w, h); g.strokeStyle = '#c9a25a'; g.lineWidth = 12; g.strokeRect(6, 6, w - 12, h - 12); g.fillStyle = '#fff6dc'; g.font = '800 64px "Teko", Arial'; g.textAlign = 'center'; g.fillText('MENU', w / 2, 90);
        g.font = '700 46px "Teko", Arial'; [['KOPI O', '1.80'], ['TEH TARIK', '2.20'], ['MILO AIS', '3.00'], ['ROTI BAKAR', '2.50'], ['NASI LEMAK', '3.50'], ['TELUR SEPARUH', '2.00']].forEach(([n, p], i) => { g.textAlign = 'left'; g.fillText(n, 40, 180 + i * 72); g.textAlign = 'right'; g.fillStyle = '#ffd34a'; g.fillText(p, w - 40, 180 + i * 72); g.fillStyle = '#fff6dc'; }); });
      for (const x of [-34, 34]) add(new THREE.BoxGeometry(14, 17.5, 0.3), [std('#4a3020'), std('#4a3020'), std('#4a3020'), std('#4a3020'), new THREE.MeshStandardMaterial({ map: menu, roughness: 0.8 }), std('#4a3020')], x, 4, -45.5);
      const stoolM = [std('#d9322b', 0.45), std('#2563c9', 0.45)];
      for (const [tx, tz] of [[-30, -22], [30, -22], [-32, 8], [32, 8]]) { // neighbouring marble tables + plastic stools + cups
        add(new THREE.CylinderGeometry(7, 7, 0.4, 48), mTop, tx, -0.5, tz, true); add(new THREE.CylinderGeometry(0.6, 1.2, 8.6, 12), std('#2b2b2b', 0.5, 0.6), tx, -5, tz);
        for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.4; add(new THREE.CylinderGeometry(1.7, 1.4, 4.8, 20), stoolM[k % 2], tx + Math.cos(a) * 8.6, -7, tz + Math.sin(a) * 8.6); }
        add(new THREE.CylinderGeometry(0.55, 0.42, 1.1, 20), std('#ffffff', 0.2), tx + 2, 0.25, tz + 1); add(new THREE.CylinderGeometry(1, 1, 0.08, 24), std('#f0f0f0', 0.25), tx + 2, -0.27, tz + 1); }
      for (const [x, z] of [[-16, -16], [16, -16], [-16, 16], [16, 16], [0, -30], [0, 30]]) { // pendant lamps with warm glow
        add(new THREE.CylinderGeometry(0.04, 0.04, 14, 4), std('#222'), x, 26, z); add(new THREE.ConeGeometry(1.3, 1.1, 28, 1, true), new THREE.MeshStandardMaterial({ color: '#2f6b4a', roughness: 0.45, side: THREE.DoubleSide }), x, 18.6, z);
        add(new THREE.SphereGeometry(0.42, 16, 12), new THREE.MeshBasicMaterial({ color: '#fff3cf' }), x, 18.1, z); halo('#ffc76a', 6, x, 18, z, 0.45); }
      const lamp = new THREE.PointLight(0xffc98a, 40, 0, 1); lamp.position.set(0, 16, 0); V.add(lamp);
      this.fan = new THREE.Group(); this.fan.position.set(0, 21, -6); this.fan.add(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.5, 16), std('#e8e2d0', 0.4)));
      for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(7, 0.06, 1), std('#e8e2d0', 0.5)); b.position.x = 3.6; b.rotation.x = 0.12; const pv = new THREE.Group(); pv.rotation.y = i * Math.PI * 2 / 3; pv.add(b); this.fan.add(pv); } V.add(this.fan);
      add(new THREE.CylinderGeometry(0.06, 0.06, 6, 4), std('#222'), 0, 24, -6);
      add(new THREE.CylinderGeometry(0.5, 0.38, 1, 24), std('#ffffff', 0.15), 8.6, 0.5, -12.9); add(new THREE.CylinderGeometry(0.46, 0.46, 0.03, 24), std('#2a1408', 0.15), 8.6, 0.98, -12.9); // kopi O + saucer + steam
      add(new THREE.CylinderGeometry(0.95, 0.95, 0.06, 32), std('#ffffff', 0.2), 8.6, 0.03, -12.9); const h = add(new THREE.TorusGeometry(0.25, 0.06, 8, 16, Math.PI), std('#ffffff', 0.2), 9.1, 0.55, -12.9); h.rotation.z = -Math.PI / 2;
      steam(8.6, 1.1, -12.9);
      pano((g, w, h) => { gradBand(g, w, h, [[0, '#2a1c14'], [0.3, '#e8d7b0'], [0.62, '#e8d7b0'], [0.63, '#d9e3da'], [0.8, '#c9d6cc'], [1, '#8e2f22']]);
        const at = a => a / 360 * w, r = rng(21);
        for (let x = 0; x < w; x += w / 160) { g.fillStyle = 'rgba(120,150,130,0.35)'; g.fillRect(x, h * 0.63, 1, h * 0.17); } g.fillStyle = 'rgba(120,150,130,0.35)'; for (let y = h * 0.63; y < h * 0.8; y += h / 40) g.fillRect(0, y, w, 1); // wall tiles
        const shutter = (a) => { const x = at(a), ww = w * 0.07; g.fillStyle = '#7d8790'; g.fillRect(x, h * 0.3, ww, h * 0.5); g.fillStyle = 'rgba(0,0,0,0.25)'; for (let y = h * 0.3; y < h * 0.8; y += h * 0.012) g.fillRect(x, y, ww, 2); g.fillStyle = '#ffd34a'; g.fillRect(x, h * 0.28, ww, h * 0.025); };
        shutter(75); shutter(255); // roller shutters east + west
        const street = (a) => { const x = at(a), ww = w * 0.09; g.fillStyle = '#1a2a3a'; g.fillRect(x, h * 0.32, ww, h * 0.3); for (let k = 0; k < 14; k++) { g.fillStyle = ['#ffd98a', '#9fd7ff', '#ff8a5a'][k % 3]; g.fillRect(x + r() * ww, h * (0.34 + r() * 0.2), 4, 4); } g.fillStyle = '#c0392b'; g.fillRect(x + ww * 0.1, h * 0.52, ww * 0.25, h * 0.06); g.fillStyle = '#222'; g.fillRect(x, h * 0.58, ww, h * 0.04); g.strokeStyle = '#4a3020'; g.lineWidth = 8; g.strokeRect(x, h * 0.32, ww, h * 0.3); };
        street(150); street(195); // open front to the street, south
        const poster = (a, c1, c2, txt) => { const x = at(a); g.fillStyle = c1; g.fillRect(x, h * 0.34, w * 0.03, h * 0.16); g.fillStyle = c2; g.font = `800 ${h * 0.03}px "Teko", Arial`; g.textAlign = 'center'; g.fillText(txt, x + w * 0.015, h * 0.43); g.textAlign = 'left'; };
        poster(100, '#1b3f94', '#ffd400', 'MILO'); poster(110, '#d71920', '#ffffff', '100PLUS'); poster(230, '#0f7a3a', '#ffffff', 'TEH O'); poster(290, '#ffd400', '#d71920', 'ROTI'); poster(130, '#ffffff', '#d71920', 'PIALA');
        g.fillStyle = '#f2f2f2'; g.fillRect(at(305), h * 0.36, w * 0.04, h * 0.44); g.fillStyle = '#9fd7ff'; g.fillRect(at(305) + 6, h * 0.38, w * 0.04 - 12, h * 0.3); // drinks fridge
        for (let k = 0; k < 18; k++) { g.fillStyle = ['#d71920', '#ffd400', '#1b3f94', '#0f7a3a'][k % 4]; g.fillRect(at(305) + 10 + (k % 6) * w * 0.006, h * (0.4 + Math.floor(k / 6) * 0.09), w * 0.004, h * 0.06); }
        g.fillStyle = '#fff'; g.beginPath(); g.arc(at(240), h * 0.24, h * 0.03, 0, 7); g.fill(); g.strokeStyle = '#333'; g.lineWidth = 5; g.stroke(); // wall clock west
        g.fillStyle = '#fff'; g.fillRect(at(60), h * 0.33, w * 0.02, h * 0.1); g.fillStyle = '#c0392b'; g.fillRect(at(60), h * 0.33, w * 0.02, h * 0.025); // calendar east
      }, 52, 34, -9.4);
      this.scene.fog = new THREE.Fog('#3a2618', 70, 150);
    } else if (id === 'v_night') {
      sky('#030712', '#14203d'); this.sun.intensity = 0.55; this.hemi.intensity = 0.2; this.r.toneMappingExposure = 1.0;
      floor('#10182b', 1); boards('BOLA KERTAS  LIGA MALAM', '#0b2a6f', '#ffffff');
      add(new THREE.BoxGeometry(TW + 3, 0.6, TL + 3), std('#2b2f3a', 0.7), 0, -0.31, 0, true);
      const prof = []; for (let t = 0; t <= 5; t++) { prof.push(new THREE.Vector2(19.4 + t * 1.4, -2.6 + t * 0.9), new THREE.Vector2(19.4 + (t + 1) * 1.4, -2.6 + t * 0.9)); } prof.push(new THREE.Vector2(27.8, -10), new THREE.Vector2(19.4, -10));
      const stand = add(new THREE.LatheGeometry(prof, 64), std('#1a2235', 0.85), 0, 0, 0); stand.scale.x = 0.66;
      const led = add(new THREE.TorusGeometry(27.4, 0.18, 6, 96), new THREE.MeshBasicMaterial({ color: '#39a0ff' }), 0, 2.9, 0); led.rotation.x = Math.PI / 2; led.scale.x = 0.69;
      crowd(Q.low ? 500 : 1300, 20, ['#d71920', '#1b3f94', '#ffffff', '#ffd400', '#111111'], -2);
      crowdFlash(Q.low ? 40 : 110, 12.4, 20, -2);
      const sb = cv(512, 256, (g, w, h) => { g.fillStyle = '#060a14'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffd400'; g.font = '800 64px "Teko", Arial'; g.textAlign = 'center'; g.fillText('LIGA MALAM', w / 2, 80); g.fillStyle = '#ffffff'; g.font = '800 110px "Teko", Arial'; g.fillText('0 - 0', w / 2, 200); });
      for (const sx of [-1, 1]) { const b = add(new THREE.BoxGeometry(10, 5, 0.5), [std('#111'), std('#111'), std('#111'), std('#111'), new THREE.MeshBasicMaterial({ map: sb }), std('#111')], sx * 23, 9, 0); b.lookAt(0, 6, 0); add(new THREE.BoxGeometry(0.5, 12, 0.5), std('#555', 0.5, 0.5), sx * 23, 1, 0); }
      const flag = cv(512, 128, (g, w, h) => { for (let i = 0; i < 8; i++) { g.fillStyle = ['#d71920', '#ffffff', '#1b3f94', '#ffd400'][i % 4]; g.fillRect(i * w / 8, 0, w / 8, h); } g.fillStyle = '#111'; g.font = '800 70px "Teko", Arial'; g.textAlign = 'center'; g.fillText('ULTRAS KERTAS', w / 2, 92); });
      for (const z of [-1, 1]) { const f = add(new THREE.PlaneGeometry(16, 4), new THREE.MeshStandardMaterial({ map: flag, side: THREE.DoubleSide, roughness: 0.8 }), 0, 3.6, z * 28.5); f.rotation.y = z > 0 ? Math.PI : 0; } // tifo banners behind both goals
      for (const x of [-1, 1]) for (const z of [-1, 1]) {
        add(new THREE.CylinderGeometry(0.22, 0.34, 20, 8), std('#8a8f99', 0.4, 0.6), x * 17, 2, z * 24);
        const hp = new THREE.Vector3(x * 17, 12.5, z * 24); const head = add(new THREE.BoxGeometry(4, 2.4, 0.4), new THREE.MeshBasicMaterial({ map: cv(128, 96, (g, w, h) => { g.fillStyle = '#20242c'; g.fillRect(0, 0, w, h); for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) { const gr = g.createRadialGradient(16 + c * 32, 16 + r * 32, 1, 16 + c * 32, 16 + r * 32, 14); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.6, '#fff1c0'); gr.addColorStop(1, '#3a3a3a'); g.fillStyle = gr; g.fillRect(c * 32 + 2, r * 32 + 2, 28, 28); } }) }), hp.x, hp.y, hp.z); head.lookAt(0, 0, 0);
        halo('#fff3d0', 9, hp.x, hp.y, hp.z, 0.6);
        beam(hp, new THREE.Vector3(x * 3, 0, z * 4), 1.2, 7, '#fff2cc', 0.11);
        const sp = new THREE.SpotLight(0xfff3dc, 45, 0, 0.6, 0.55, 1); sp.position.copy(hp); sp.target.position.set(x * 2, 0, z * 3); V.add(sp, sp.target);
      }
      this.scene.fog = new THREE.Fog('#0a1226', 45, 120);
    } else if (id === 'v_final') {
      // A different building, not a recolour: enclosed two-tier arena, VIP glass ring, roof with an LED floodlight halo
      // (no masts), card-mosaic tifo, hanging screens, pyro cannons, sky fireworks, trophy stage, gold confetti, aurora.
      this.sun.intensity = 0.5; this.hemi.intensity = 0.22; this.r.toneMappingExposure = 1.02;
      this.scene.background = cv(512, 512, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#05051a'); gr.addColorStop(1, '#2a1d4a'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
        for (const [c, y] of [['rgba(80,255,190,0.35)', 0.18], ['rgba(170,110,255,0.35)', 0.3], ['rgba(255,212,90,0.25)', 0.42]]) { g.strokeStyle = c; g.lineWidth = 34; g.filter = 'blur(14px)'; g.beginPath(); for (let x = 0; x <= w; x += 16) g.lineTo(x, h * y + Math.sin(x / 60) * 26); g.stroke(); } g.filter = 'none'; });
      floor('#120d22', 1); boards('FINAL  BOLA KERTAS  2026', '#2a1d4a', '#ffd45a');
      add(new THREE.BoxGeometry(TW + 3, 0.6, TL + 3), std('#1d1730', 0.6, 0.2), 0, -0.31, 0, true);
      const gold = new THREE.MeshPhysicalMaterial({ color: '#ffc843', metalness: 1, roughness: 0.2, clearcoat: 1, envMapIntensity: 2 });
      const SX = 0.66, ell = m => { m.scale.x = SX; return m; };
      const steps = (r0, y0, n, dr, dy) => { const p = []; for (let t = 0; t < n; t++) p.push(new THREE.Vector2(r0 + t * dr, y0 + t * dy), new THREE.Vector2(r0 + (t + 1) * dr, y0 + t * dy)); return p; };
      const lower = steps(19.4, -2.6, 6, 1.4, 0.9); lower.push(new THREE.Vector2(27.8, -10), new THREE.Vector2(19.4, -10));
      ell(add(new THREE.LatheGeometry(lower, 96), std('#2a2140', 0.8), 0, 0, 0));
      const upper = steps(29.2, 4.6, 7, 1.3, 1.15); upper.push(new THREE.Vector2(38.3, 12.6), new THREE.Vector2(38.3, 1), new THREE.Vector2(29.2, 1));
      ell(add(new THREE.LatheGeometry(upper, 96), std('#2a2140', 0.8), 0, 0, 0));
      const vip = cv(1024, 64, (g, w, h) => { g.fillStyle = '#120c1e'; g.fillRect(0, 0, w, h); for (let x = 4; x < w; x += 16) { g.fillStyle = (x / 16) % 9 < 1 ? '#1a1228' : ['#ffd98a', '#fff1d0', '#ffcf70'][(x / 16) % 3 | 0]; g.fillRect(x, 14, 12, 34); } g.fillStyle = '#ffd45a'; g.fillRect(0, 0, w, 5); g.fillRect(0, h - 5, w, 5); });
      vip.wrapS = THREE.RepeatWrapping; vip.repeat.set(6, 1);
      ell(add(new THREE.CylinderGeometry(28.6, 28.6, 3.2, 96, 1, true), new THREE.MeshStandardMaterial({ map: vip, emissive: '#ffffff', emissiveMap: vip, emissiveIntensity: 0.85, side: THREE.BackSide, roughness: 0.3 }), 0, 2.9, 0));
      for (const y of [1.25, 4.55]) { const r = ell(add(new THREE.TorusGeometry(28.7, 0.14, 6, 128), new THREE.MeshBasicMaterial({ color: '#ffd45a' }), 0, y, 0)); r.rotation.x = Math.PI / 2; r.scale.set(SX, 1, 1); }
      // roof canopy with a ring of floodlights on its inner lip
      ell(add(new THREE.LatheGeometry([[29, 13.4], [42, 15.2], [42, 15.8], [29, 14.0]].map(([x, y]) => new THREE.Vector2(x, y)), 96), new THREE.MeshStandardMaterial({ color: '#d8d4e4', roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide }), 0, 0, 0));
      const lip = add(new THREE.TorusGeometry(29, 0.35, 8, 128), new THREE.MeshBasicMaterial({ color: '#fffbe8' }), 0, 13.3, 0); lip.rotation.x = Math.PI / 2; lip.scale.set(SX, 1, 1);
      for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2, hp = new THREE.Vector3(Math.cos(a) * 29 * SX, 13.1, Math.sin(a) * 29); halo('#fff6dc', 5, hp.x, hp.y, hp.z, 0.55);
        if (i % 2 === 0) beam(hp, new THREE.Vector3(Math.cos(a) * 3, 0, Math.sin(a) * 5), 0.6, 4.5, '#fff1d0', 0.06); }
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const sp = new THREE.SpotLight(0xfff3dc, 40, 0, 0.6, 0.55, 1); sp.position.set(x * 18, 13, z * 27); sp.target.position.set(x * 2, 0, z * 3); V.add(sp, sp.target); }
      // card-mosaic tifo: crowd colours sampled from a banner painted round the bowl, star + FINAL behind the far goal
      const tifo = document.createElement('canvas'); tifo.width = 360; tifo.height = 13; const tg = tifo.getContext('2d');
      for (let x = 0; x < 360; x += 6) { tg.fillStyle = (x / 6) % 2 ? '#ffd45a' : '#ffffff'; tg.fillRect(x, 0, 6, 13); }
      tg.fillStyle = '#2a1458'; tg.fillRect(205, 0, 150, 13); tg.fillStyle = '#ffd45a'; tg.font = '800 7px Arial'; tg.textAlign = 'center'; tg.fillText('FINAL', 270, 12);
      tg.beginPath(); for (let i = 0; i < 10; i++) { const aa = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? 2.2 : 5.2; tg.lineTo(232 + Math.cos(aa) * rr, 6.5 + Math.sin(aa) * rr); } tg.fill();
      tg.beginPath(); for (let i = 0; i < 10; i++) { const aa = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? 2.2 : 5.2; tg.lineTo(308 + Math.cos(aa) * rr, 6.5 + Math.sin(aa) * rr); } tg.fill();
      const pix = tg.getImageData(0, 0, 360, 13).data;
      const rows = []; for (let t = 0; t < 6; t++) rows.push([19.9 + t * 1.4, -2.1 + t * 0.9]); for (let t = 0; t < 7; t++) rows.push([29.8 + t * 1.3, 5.1 + t * 1.15]);
      const per = Q.low ? 160 : 260, cnt = rows.length * per, cm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.62, 0.8, 0.3), new THREE.MeshLambertMaterial(), cnt), M4 = new THREE.Matrix4(), C = new THREE.Color();
      this.crowdBase = []; let n = 0;
      rows.forEach(([rz, y], ri) => { for (let k = 0; k < per; k++, n++) { const a = k / per * Math.PI * 2; M4.makeRotationY(-a + Math.PI / 2); M4.setPosition(Math.cos(a) * rz * SX, y, Math.sin(a) * rz); cm.setMatrixAt(n, M4);
        const u = Math.floor(((a / (Math.PI * 2)) % 1) * 360), v = 12 - ri, j = (v * 360 + u) * 4; cm.setColorAt(n, C.setRGB(pix[j] / 255, pix[j + 1] / 255, pix[j + 2] / 255, THREE.SRGBColorSpace)); this.crowdBase.push(new THREE.Vector3(Math.cos(a) * rz * SX, y, Math.sin(a) * rz)); } });
      V.add(cm); this.crowd = cm;
      crowdFlash(Q.low ? 60 : 160, 12.6, 20, -2);
      // hanging screens in the far corners
      const scr = cv(512, 288, (g, w, h) => { g.fillStyle = '#0b0718'; g.fillRect(0, 0, w, h); const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#3a1d7a'); gr.addColorStop(1, '#120a2a'); g.fillStyle = gr; g.fillRect(8, 8, w - 16, h - 16);
        g.fillStyle = '#ffd45a'; g.font = '800 96px "Teko", Arial'; g.textAlign = 'center'; g.fillText('FINAL', w / 2, 128); g.fillStyle = '#ffffff'; g.font = '700 46px "Teko", Arial'; g.fillText('BOLA KERTAS 2026', w / 2, 200); g.fillStyle = '#ff4fd8'; g.fillRect(40, 236, w - 80, 8); });
      for (const [x, z] of [[-13, -24], [13, -24], [-24, 0], [24, 0], [-13, 24], [13, 24]]) { const sc = add(new THREE.BoxGeometry(8, 4.5, 0.4), [std('#111'), std('#111'), std('#111'), std('#111'), new THREE.MeshBasicMaterial({ map: scr }), std('#111')], x, 10.2, z); sc.lookAt(0, 4, 0);
        add(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 4), std('#888'), x, 13.6, z); halo('#8f6bff', 12, x, 10.2, z, 0.3); } // six hanging screens, every side
      // trophy on a lit stage
      add(new THREE.CylinderGeometry(1.1, 1.3, 0.5, 32), std('#1a1228', 0.4, 0.4), -7.7, 0.25, -11.95); const rim = add(new THREE.TorusGeometry(1.15, 0.05, 8, 48), gold, -7.7, 0.5, -11.95); rim.rotation.x = Math.PI / 2;
      const tro = add(new THREE.LatheGeometry([[0, 0], [0.55, 0], [0.55, 0.12], [0.3, 0.22], [0.16, 0.5], [0.12, 0.95], [0.22, 1.05], [0.5, 1.25], [0.62, 1.7], [0.6, 2.05], [0.52, 2.08], [0.46, 1.75], [0, 1.6]].map(([a, b]) => new THREE.Vector2(a, b)), 48), gold, -7.7, 0.5, -11.95);
      tro.castShadow = true; for (const sx of [-1, 1]) { const hd = add(new THREE.TorusGeometry(0.3, 0.05, 10, 24, Math.PI * 1.2), gold, -7.7 + sx * 0.6, 2.1, -11.95); hd.rotation.z = sx * -Math.PI / 2; }
      halo('#ffd45a', 4.5, -7.7, 1.7, -11.95, 0.4); beam(new THREE.Vector3(-7.7, 13, -11.95), new THREE.Vector3(-7.7, 0, -11.95), 0.3, 1.6, '#fff1c0', 0.18);
      // pyro cannons on the touchlines: flame columns that pulse
      const pyro = []; for (const sx of [-1, 1]) for (const z of [-7, 0, 7]) { add(new THREE.BoxGeometry(0.7, 0.5, 0.7), std('#222', 0.4, 0.6), sx * (TW / 2 + 1.1), 0.25, z); const col = [];
        for (let i = 0; i < 9; i++) { const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: i % 3 ? '#ff8a1a' : '#ffd45a', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); f.position.set(sx * (TW / 2 + 1.1), 0.6, z); V.add(f); col.push(f); }
        pyro.push({ col, ph: (sx + 1) * 0.3 + (z + 7) * 0.05 }); }
      anim((dt, t) => pyro.forEach(({ col, ph }) => { const on = ((t * 0.45 + ph) % 1) < 0.35; col.forEach((f, i) => { const k = (t * 2.4 + i / col.length) % 1; f.visible = on; f.position.y = 0.6 + k * 3.6; f.scale.setScalar(1.6 - k * 1.1); f.material.opacity = (1 - k) * 0.9; }); }));
      // gold confetti + sweeping searchlights + occasional sky fireworks
      const N = Q.low ? 150 : 380, cf = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.22, 0.34), new THREE.MeshStandardMaterial({ color: '#ffd45a', metalness: 1, roughness: 0.3, side: THREE.DoubleSide, emissive: '#7a5200', emissiveIntensity: 0.5 }), N); V.add(cf);
      const seed = Array.from({ length: N }, (_, i) => [Math.sin(i * 12.9) * 22, (i * 7.31) % 22, Math.cos(i * 4.1) * 30, i]); const M = new THREE.Matrix4(), Qt = new THREE.Quaternion(), E = new THREE.Euler(), S = new THREE.Vector3(1, 1, 1), P = new THREE.Vector3();
      anim((dt, t) => { for (const [x, y0, z, i] of seed) { const y = 18 - ((y0 + t * 1.6) % 22); P.set(x + Math.sin(t + i) * 0.8, y, z); E.set(t * 2 + i, t * 1.3 + i * 0.5, 0); M.compose(P, Qt.setFromEuler(E), S); cf.setMatrixAt(i, M); } cf.instanceMatrix.needsUpdate = true; });
      const sweeps = [0, 1, 2, 3].map(k => beam(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 40, 0), 0.6, 5, k % 2 ? '#ffd45a' : '#b48cff', 0.14));
      anim((dt, t) => sweeps.forEach((m, k) => { const a = k * Math.PI / 2 + t * 0.4, from = new THREE.Vector3(Math.cos(a) * 26, 14, Math.sin(a) * 30), to = new THREE.Vector3(Math.cos(a) * 18 + Math.sin(t + k) * 10, 60, Math.sin(a) * 22); m.position.copy(from).lerp(to, 0.5); m.lookAt(to); m.rotateX(Math.PI / 2); }));
      let lastFw = -1; if (!Q.low) anim((dt, t) => { const slot = Math.floor(t / 2.2); if (slot === lastFw) return; lastFw = slot; const x = (slot * 37 % 30) - 15, cs = [['#ffd45a', '#ffffff'], ['#b36bff', '#ff5fd2'], ['#39f6ff', '#ffffff']][slot % 3];
        this.flash(x, 26, -40, cs[0], 9, 0.6); this.burst(x, 26, -40, cs, 40, 6, 1.2, 0.16, true, 1.3, 'spark'); });
      this.scene.fog = new THREE.Fog('#1b1235', 70, 170);
    } else if (id === 'v_beach') {
      sky('#ff6a4a', '#ffd3a1'); this.sun.color.set(0xffa86a); this.sun.position.set(-14, 6, -18); this.sun.intensity = 2.6; this.hemi.intensity = 0.4;
      table('#e6c99a', '#c4a070', '#d8b07a');
      const sand = cv(256, 256, (g, w, h) => { g.fillStyle = '#e9cf9b'; g.fillRect(0, 0, w, h); const r = rng(3); for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(${150 + r() * 80},${110 + r() * 60},${60 + r() * 40},0.35)`; g.fillRect(r() * w, r() * h, 1.5, 1.5); } }); sand.wrapS = sand.wrapT = THREE.RepeatWrapping; sand.repeat.set(30, 30);
      const f = add(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ map: sand, roughness: 1 }), 0, -9.4, 0, true); f.rotation.x = -Math.PI / 2;
      const seaG = new THREE.PlaneGeometry(400, 160, Q.low ? 40 : 90, Q.low ? 16 : 36); seaG.rotateX(-Math.PI / 2); const base = seaG.attributes.position.array.slice();
      const sea = add(seaG, new THREE.MeshStandardMaterial({ color: '#1f6ea3', roughness: 0.12, metalness: 0.35, flatShading: true }), 0, -9.3, -150);
      anim((dt, t) => { const p = seaG.attributes.position.array; for (let i = 0; i < p.length; i += 3) p[i + 1] = base[i + 1] + Math.sin(base[i] * 0.08 + t * 1.4) * 0.6 + Math.cos(base[i + 2] * 0.12 + t) * 0.5; seaG.attributes.position.needsUpdate = true; seaG.computeVertexNormals(); });
      const foam = add(new THREE.PlaneGeometry(400, 1.6), glow('#ffffff', 0.55), 0, -9.0, -72); foam.rotation.x = -Math.PI / 2; anim((dt, t) => { foam.position.z = -72 + Math.sin(t * 0.9) * 2.5; foam.material.opacity = 0.35 + Math.sin(t * 0.9 + 1) * 0.25; });
      add(new THREE.CircleGeometry(12, 48), new THREE.MeshBasicMaterial({ color: '#ffe0a0', fog: false }), -30, 6, -190); halo('#ff9a50', 70, -30, 6, -185, 0.5);
      const umb = cv(256, 32, (g, w, h) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#ffffff' : ['#e8483c', '#2a8fd6', '#f2c230'][i % 3]; g.fillRect(i * 32, 0, 32, h); } });
      for (const [x, z, c] of [[-15, -19, 0], [16, -24, 1], [-30, 6, 2], [30, 4, 0]]) { add(new THREE.CylinderGeometry(0.15, 0.15, 14, 6), std('#eeeeee', 0.4), x, -2.4, z); const u = add(new THREE.ConeGeometry(6, 2.2, 16, 1, true), new THREE.MeshStandardMaterial({ map: umb, side: THREE.DoubleSide, roughness: 0.7 }), x, 4.6, z); u.rotation.y = c;
        const ch = add(new THREE.BoxGeometry(3.6, 0.4, 8), std(['#2a8fd6', '#e8483c', '#f2c230'][c], 0.6), x + 5, -7.4, z + 4); ch.rotation.x = -0.18; const bk = add(new THREE.BoxGeometry(3.6, 4.5, 0.4), std(['#2a8fd6', '#e8483c', '#f2c230'][c], 0.6), x + 5, -5.6, z + 0.2); bk.rotation.x = -0.5;
        add(new THREE.CylinderGeometry(1.2, 1.2, 0.3, 20), std('#ffffff', 0.4), x - 3, -9.1, z + 4); }
      for (const [x, z] of [[-24, -30], [-34, -18], [26, -34], [36, -22], [-10, -44], [12, -50], [-38, 8], [40, 12], [-30, 32], [34, 34], [-8, 42], [10, 46]]) palm(x, z, 18);
      pano((g, w, h) => { gradBand(g, w, h, [[0, '#ff6a4a'], [0.84, '#ffd3a1'], [0.85, '#2b7ab0'], [1, '#1f5d8a']]);
        const r = rng(5), at = a => a / 360 * w;
        for (const [a, wd] of [[40, 0.07], [300, 0.05], [325, 0.03]]) { g.fillStyle = '#3f6a4a'; g.beginPath(); g.ellipse(at(a), h * 0.85, w * wd, h * 0.05, 0, Math.PI, 0); g.fill(); } // islands
        for (let k = 0; k < 16; k++) { g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 3; const y = h * (0.86 + r() * 0.12), x = r() * w; g.beginPath(); g.moveTo(x, y); g.lineTo(x + w * 0.02, y); g.stroke(); }
        for (let k = 0; k < 5; k++) { const x = at(140 + k * 22), y = h * 0.85; g.fillStyle = '#8a5a30'; g.fillRect(x - h * 0.05, y - h * 0.06, h * 0.1, h * 0.06); g.fillStyle = '#d9b05a'; g.beginPath(); g.moveTo(x - h * 0.07, y - h * 0.055); g.lineTo(x, y - h * 0.12); g.lineTo(x + h * 0.07, y - h * 0.055); g.fill();
          g.fillStyle = ['#e8483c', '#2a8fd6', '#f2c230'][k % 3]; g.fillRect(x - h * 0.04, y - h * 0.045, h * 0.08, h * 0.012); } // beach huts / kedai south
        g.fillStyle = '#ffffff'; for (const a of [60, 280]) { const x = at(a); g.beginPath(); g.moveTo(x, h * 0.85); g.lineTo(x + h * 0.03, h * 0.78); g.lineTo(x + h * 0.03, h * 0.85); g.fill(); g.fillStyle = '#6a3a1a'; g.fillRect(x - h * 0.01, h * 0.85, h * 0.05, h * 0.008); g.fillStyle = '#ffffff'; } // sailboats
        for (let k = 0; k < 8; k++) { g.strokeStyle = 'rgba(60,30,20,0.7)'; g.lineWidth = 2; const x = r() * w, y = h * (0.15 + r() * 0.2); g.beginPath(); g.moveTo(x - 8, y); g.quadraticCurveTo(x - 4, y - 5, x, y); g.quadraticCurveTo(x + 4, y - 5, x + 8, y); g.stroke(); }
      }, 210, 110, -50);
      const ball2 = add(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshStandardMaterial({ map: cv(256, 128, (g, w, h) => { ['#e8483c', '#ffffff', '#2a8fd6', '#f2c230', '#ffffff', '#33a35a'].forEach((c, i) => { g.fillStyle = c; g.fillRect(i * w / 6, 0, w / 6, h); }); }), roughness: 0.5 }), 32, -8.4, -6); // beach ball
      for (const [x, z] of [[-34, 22], [36, 24]]) { add(new THREE.CylinderGeometry(0.12, 0.12, 6, 6), std('#eee'), x, -6.4, z); add(new THREE.CylinderGeometry(0.12, 0.12, 6, 6), std('#eee'), x + 8, -6.4, z); const net = add(new THREE.PlaneGeometry(8, 1.6), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6, side: THREE.DoubleSide }), x + 4, -4.4, z); } // volleyball nets E/W
      add(new THREE.BoxGeometry(6, 0.6, 3), std('#c9a26a'), -6, -9.1, 34);
      { const st = cv(512, 128, (g, w, h) => { g.fillStyle = '#2a8fd6'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = '800 80px "Teko", Arial'; g.textAlign = 'center'; g.fillText('AIS KRIM', w / 2, 96); });
        add(new THREE.BoxGeometry(9, 5, 4), std('#f5f0e6', 0.7), 14, -6.9, 40); add(new THREE.BoxGeometry(9.6, 2, 0.3), [std('#2a8fd6'), std('#2a8fd6'), std('#2a8fd6'), std('#2a8fd6'), std('#2a8fd6'), new THREE.MeshBasicMaterial({ map: st })], 14, -3.4, 37.9);
        const roof = add(new THREE.ConeGeometry(7, 2.5, 4, 1), std('#e8483c', 0.6), 14, -2.5, 40); roof.rotation.y = Math.PI / 4;
        const mat = add(new THREE.PlaneGeometry(5, 3), std('#f2c230', 0.9), -18, -9.35, 30); mat.rotation.x = -Math.PI / 2; } const surf = add(new THREE.BoxGeometry(1.4, 0.2, 7), std('#2a8fd6', 0.4), 4, -9.2, 32); surf.rotation.y = 0.4; // sand castle base + surfboard south
      for (const [x, z, r] of [[-60, -110, 0.2], [70, -130, -0.1]]) { const boat = add(new THREE.ConeGeometry(2.4, 6, 4), std('#f5f0e6', 0.6), x, -6, z); boat.rotation.set(0, r, 0); add(new THREE.BoxGeometry(5, 1, 2), std('#8a4a2a', 0.7), x, -8.6, z); }
      this.scene.fog = new THREE.Fog('#ffb38a', 70, 220);
    } else if (id === 'v_rooftop') {
      // KL from a rooftop, all 360 degrees. You stand on a finite roof slab; the city sits 70m below and rises all round.
      // Landmarks: KLCC twin towers + The Exchange 106 behind one goal, Merdeka 118 + Menara KL behind the other,
      // filler towers on every side, a far skyline panorama so no angle is empty. Legend extras: LED crowns that cycle
      // colour, blinking aviation lights, two highways of moving headlights, a plane crossing, a neon rooftop sign.
      sky('#03050e', '#1a2340'); this.sun.intensity = 0.7; this.sun.color.set(0xa8baff); this.hemi.intensity = 0.3; table('#3a3f4a', '#222', '#1a1d24');
      const G = -80, r = rng(118), RX = TW / 2 + 13, RZ = TL / 2 + 11, PI = Math.PI;
      // the roof we play on: slab (top at -9.4 where the table legs stand), the tower below it, parapet + glass rail on all four sides
      add(new THREE.BoxGeometry(RX * 2, 0.6, RZ * 2), std('#2a2e36', 0.9), 0, -9.7, 0, true);
      const winTex = (seed, cols, rows, lit, pal) => { const t = cv(128, 256, (g, w, h) => { g.fillStyle = '#060a14'; g.fillRect(0, 0, w, h); const q = rng(seed), cw = w / cols, rh = h / rows;
        for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (q() < lit) { g.fillStyle = pal[(q() * pal.length) | 0]; g.fillRect(x * cw + cw * 0.18, y * rh + rh * 0.22, cw * 0.64, rh * 0.56); } }); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
      const W = [winTex(1, 8, 32, 0.45, ['#ffd98a', '#fff4d0']), winTex(2, 12, 40, 0.35, ['#9fd7ff', '#e8f6ff']), winTex(3, 6, 24, 0.55, ['#ffcf70', '#ffb860', '#fff1d0'])];
      const lit = (t, rx = 1, ry = 1, color = '#121a2c', ei = 0.9) => { const tt = t.clone(); tt.needsUpdate = true; tt.repeat.set(rx, ry); return new THREE.MeshStandardMaterial({ color, map: tt, emissive: '#ffffff', emissiveMap: tt, emissiveIntensity: ei, metalness: 0.5, roughness: 0.4 }); };
      add(new THREE.BoxGeometry(RX * 2 - 1, 70, RZ * 2 - 1), lit(W[0], 3, 2.5), 0, -45, 0);
      for (const [x, z, w, d] of [[0, -RZ, RX * 2, 0.5], [0, RZ, RX * 2, 0.5], [-RX, 0, 0.5, RZ * 2], [RX, 0, 0.5, RZ * 2]]) {
        add(new THREE.BoxGeometry(w, 1.2, d), std('#4a4f5a', 0.85), x, -8.8, z);
        add(new THREE.BoxGeometry(w, 1.4, d * 0.4 || 0.2), new THREE.MeshStandardMaterial({ color: '#9fd7ff', transparent: true, opacity: 0.14, roughness: 0.1, metalness: 0.2 }), x, -7.5, z);
        add(new THREE.BoxGeometry(w, 0.1, d), std('#c9ced8', 0.3, 0.8), x, -6.8, z);
      }
      const tank = add(new THREE.CylinderGeometry(3, 3, 5, 24), std('#7c8796', 0.5, 0.5), -RX + 5, -4.4, -RZ + 5); for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) add(new THREE.BoxGeometry(0.3, 2.5, 0.3), std('#333'), tank.position.x + dx, -8.1, tank.position.z + dz);
      for (const [x, z] of [[RX - 5, -RZ + 6], [RX - 5, -RZ + 11]]) { add(new THREE.BoxGeometry(4, 3, 3.4), std('#d5d8de', 0.6), x, -7.9, z); add(new THREE.CircleGeometry(1.1, 20), std('#2b2f36', 0.8), x, -7.9, z + 1.71); }
      // neon sign on its frame along one side: 'KUALA LUMPUR', flickers now and then
      const neon = cv(1024, 160, (g, w, h) => { g.fillStyle = '#05060c'; g.fillRect(0, 0, w, h); g.font = '800 120px "Teko", Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.shadowColor = '#ff4fd8'; g.shadowBlur = 26; g.fillStyle = '#ffd1f4'; g.fillText('KUALA LUMPUR', w / 2, h / 2 + 6); });
      const nm = new THREE.MeshBasicMaterial({ map: neon, fog: false }), sign = add(new THREE.BoxGeometry(16, 2.5, 0.3), [std('#111'), std('#111'), std('#111'), std('#111'), nm, std('#111')], -RX + 1.2, -2.6, 4); sign.rotation.y = PI / 2;
      for (const z of [-3, 11]) add(new THREE.BoxGeometry(0.25, 6, 0.25), std('#555', 0.5, 0.6), -RX + 1.2, -6.6, z);
      const nh = halo('#ff4fd8', 20, -RX + 2, -2.6, 4, 0.3);
      anim((dt, t) => { const on = Math.sin(t * 23) > -0.97 || Math.sin(t * 0.7) < 0.9; nm.color.setScalar(on ? 1 : 0.25); nh.material.opacity = on ? 0.3 : 0.08; });
      // next-door tower with a helipad, a little lower than us
      add(new THREE.BoxGeometry(22, 64, 22), lit(W[2], 2, 2.5), RX + 18, -48, 30); const hp = add(new THREE.CircleGeometry(8, 48), new THREE.MeshStandardMaterial({ map: cv(256, 256, (g, w, h) => { g.fillStyle = '#2e333c'; g.fillRect(0, 0, w, h); g.strokeStyle = '#ffd34a'; g.lineWidth = 10; g.beginPath(); g.arc(128, 128, 110, 0, 7); g.stroke(); g.fillStyle = '#ffffff'; g.font = '800 150px "Teko", Arial'; g.textAlign = 'center'; g.fillText('H', 128, 182); }), roughness: 0.8 }), RX + 18, -15.95, 30); hp.rotation.x = -PI / 2;
      const avi = []; // aviation light positions
      // ── landmarks ──
      const LM = { klcc: [0, -92], tr: [74, -74], tm: [100, 0], day: [64, 64], m118: [0, 96], kltower: [-65, 65], mbb: [-98, 0], led: [-64, -64] }, lm = (k, grp, s = 1) => { grp.position.set(LM[k][0], G, LM[k][1]); grp.scale.setScalar(s); V.add(grp); return grp; };
      // KLCC: eight-point star floor plan, six setbacks, pinnacle, skybridge
      const star = R => { const s = new THREE.Shape(); for (let i = 0; i < 16; i++) { const a = i / 16 * PI * 2, k = i % 2 ? 0.8 : 1; s[i ? 'lineTo' : 'moveTo'](Math.cos(a) * R * k, Math.sin(a) * R * k); } return s; };
      const kTex = cv(64, 64, (g, w, h) => { g.fillStyle = '#0b1324'; g.fillRect(0, 0, w, h); for (let y = 0; y < 8; y++) { g.fillStyle = y % 2 ? '#ffe9b8' : '#cfe6ff'; g.fillRect(0, y * 8 + 3, w, 3); } g.fillStyle = '#b9c3d6'; for (let x = 0; x < w; x += 8) g.fillRect(x, 0, 2, h); }); kTex.wrapS = kTex.wrapT = THREE.RepeatWrapping; kTex.repeat.set(0.25, 0.125);
      const kMat = new THREE.MeshStandardMaterial({ color: '#c9d2e6', map: kTex, emissive: '#ffffff', emissiveMap: kTex, emissiveIntensity: 0.75, metalness: 0.85, roughness: 0.25 }), steel = new THREE.MeshStandardMaterial({ color: '#c9d2e6', metalness: 0.9, roughness: 0.2, emissive: '#2a3550' });
      const klcc = new THREE.Group();
      for (const s of [-1, 1]) { let y = 0;
        for (const [R, h] of [[4.6, 30], [4.0, 10], [3.4, 8], [2.7, 6], [2.0, 5], [1.4, 4]]) { const g = new THREE.ExtrudeGeometry(star(R), { depth: h, bevelEnabled: false, curveSegments: 1 }); g.rotateX(-PI / 2); const m = new THREE.Mesh(g, kMat); m.position.set(s * 6, y, 0); klcc.add(m); y += h; }
        const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.35, 15, 8), steel); pin.position.set(s * 6, y + 7.5, 0); klcc.add(pin);
        for (let k = 0; k < 4; k++) { const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.8 - k * 0.15, 0.8 - k * 0.15, 0.3, 12), steel); ring.position.set(s * 6, y + 1.5 + k * 2.2, 0); klcc.add(ring); }
        avi.push(new THREE.Vector3(LM.klcc[0] + s * 6 * 1.6, G + (y + 15) * 1.6, LM.klcc[1])); }
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(8, 1.3, 1.5), new THREE.MeshStandardMaterial({ color: '#cfe6ff', emissive: '#9fd7ff', emissiveIntensity: 0.9 })); bridge.position.set(0, 28, 0); klcc.add(bridge);
      for (const s of [-1, 1]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 9, 6), steel); leg.position.set(s * 2, 24, 0); leg.rotation.z = s * 0.6; klcc.add(leg); }
      lm('klcc', klcc, 1.6); halo('#7fa8ff', 70, LM.klcc[0], 10, LM.klcc[1] + 6, 0.22);
      // The Exchange 106: square plan turned 45 degrees, gentle taper, chamfered crown with a light band
      const tr = new THREE.Group(), trM = lit(W[1], 4, 3, '#1a2440');
      const trB = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 4.8, 110, 4, 1), trM); trB.rotation.y = PI / 4; trB.position.y = 55; tr.add(trB);
      const trC = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 3.4, 12, 4, 1), steel); trC.rotation.y = PI / 4; trC.position.y = 116; tr.add(trC);
      const trL = new THREE.Mesh(new THREE.CylinderGeometry(3.45, 3.45, 1, 4, 1, true), new THREE.MeshBasicMaterial({ color: '#7fd0ff', side: THREE.DoubleSide })); trL.rotation.y = PI / 4; trL.position.y = 108; tr.add(trL);
      lm('tr', tr); avi.push(new THREE.Vector3(LM.tr[0], G + 122.5, LM.tr[1]));
      // Merdeka 118: faceted, twisting glass tower, tallest in the scene, long spire with a colour-cycling LED crown
      const mg = new THREE.CylinderGeometry(2.3, 5.8, 95, 6, 16); { const p = mg.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i), a = (y + 47.5) * 0.006, x = p.getX(i), z = p.getZ(i); p.setXYZ(i, x * Math.cos(a) - z * Math.sin(a), y, x * Math.sin(a) + z * Math.cos(a)); } mg.computeVertexNormals(); }
      const m118 = new THREE.Group(), mM = lit(W[1], 6, 4, '#16304a'); mM.flatShading = true;
      const mb = new THREE.Mesh(mg, mM); mb.position.y = 47.5; m118.add(mb);
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2.3, 10, 6, 1), new THREE.MeshBasicMaterial({ color: '#39f6ff', fog: false })); crown.position.y = 100; m118.add(crown);
      const spire = new THREE.Mesh(new THREE.ConeGeometry(0.55, 40, 6), steel); spire.position.y = 125; m118.add(spire);
      lm('m118', m118); avi.push(new THREE.Vector3(LM.m118[0], G + 145.5, LM.m118[1]));
      // Menara KL: tall shaft, onion pod with a glowing window ring, antenna
      const klt = new THREE.Group(), conc = std('#d8dce6', 0.55, 0.2);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 2.2, 90, 16), conc); shaft.position.y = 45; klt.add(shaft);
      const pod = new THREE.Mesh(new THREE.LatheGeometry([[0, 0], [3, 0], [6, 2.5], [7, 5], [6.8, 7], [5, 9], [3.5, 11], [2, 12], [0, 12]].map(([a, b]) => new THREE.Vector2(a, b)), 32), conc); pod.position.y = 90; klt.add(pod);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(7.02, 6.82, 1.6, 48, 1, true), new THREE.MeshBasicMaterial({ color: '#ff5fd2', side: THREE.DoubleSide, fog: false })); band.position.y = 96; klt.add(band);
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.4, 30, 8), steel); ant.position.y = 117; klt.add(ant);
      for (let k = 0; k < 3; k++) { const d = new THREE.Mesh(new THREE.CylinderGeometry(1.4 - k * 0.4, 1.4 - k * 0.4, 0.4, 16), conc); d.position.y = 105 + k * 5; klt.add(d); }
      lm('kltower', klt); avi.push(new THREE.Vector3(LM.kltower[0], G + 132, LM.kltower[1])); halo('#ff5fd2', 26, LM.kltower[0], G + 96, LM.kltower[1], 0.25);
      // Dayabumi: white octagon with pointed-arch screens, gold top
      const arch = cv(128, 256, (g, w, h) => { g.fillStyle = '#e9eef6'; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 32) for (let x = 0; x < w; x += 32) { g.fillStyle = (x + y) % 64 ? '#ffd98a' : '#2a3550'; g.beginPath(); g.moveTo(x + 6, y + 30); g.lineTo(x + 6, y + 14); g.quadraticCurveTo(x + 16, y + 2, x + 26, y + 14); g.lineTo(x + 26, y + 30); g.fill(); } }); arch.wrapS = arch.wrapT = THREE.RepeatWrapping; arch.repeat.set(3, 3);
      const day = new THREE.Group(), dB = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 66, 8), new THREE.MeshStandardMaterial({ color: '#ffffff', map: arch, emissive: '#ffffff', emissiveMap: arch, emissiveIntensity: 0.55, roughness: 0.6 })); dB.position.y = 33; day.add(dB);
      const dT = new THREE.Mesh(new THREE.CylinderGeometry(3, 7.2, 6, 8), new THREE.MeshStandardMaterial({ color: '#ffc843', metalness: 0.8, roughness: 0.3, emissive: '#5a4000' })); dT.position.y = 69; day.add(dT);
      lm('day', day); halo('#ffd98a', 24, LM.day[0], G + 66, LM.day[1], 0.3);
      // a tower with a giant LED facade looping the game's own ad
      const ledC = document.createElement('canvas'); ledC.width = 128; ledC.height = 256; const lg = ledC.getContext('2d'), ledT = tex(ledC, true, 4);
      const ledDraw = t => { const k = Math.floor(t / 2.5) % 3; lg.fillStyle = ['#ff2f7a', '#1fd1ff', '#ffd400'][k]; lg.fillRect(0, 0, 128, 256); lg.fillStyle = '#ffffff'; lg.textAlign = 'center'; lg.font = '800 62px "Teko", Arial'; lg.fillText('BOLA', 64, 92); lg.font = '800 40px "Teko", Arial'; lg.fillText('KERTAS', 64, 140);
        lg.beginPath(); lg.arc(64, 200, 26, 0, 7); lg.fill(); lg.fillStyle = 'rgba(0,0,0,.25)'; for (let y = 0; y < 256; y += 4) lg.fillRect(0, y, 128, 1); ledT.needsUpdate = true; };
      ledDraw(0); let ledK = -1; anim((dt, t) => { const k = Math.floor(t / 2.5); if (k !== ledK) { ledK = k; ledDraw(t); } });
      const led = new THREE.Group(), ledM = new THREE.MeshBasicMaterial({ map: ledT, fog: false }), dark2 = std('#121826', 0.5, 0.5);
      const lb = new THREE.Mesh(new THREE.BoxGeometry(18, 44, 18), [ledM, ledM, dark2, dark2, ledM, ledM]); lb.position.y = 102; led.add(lb); const lbase = new THREE.Mesh(new THREE.BoxGeometry(16, 80, 16), lit(W[1], 2, 3)); lbase.position.y = 40; led.add(lbase); halo('#ff4fd8', 40, LM.led[0], G + 102, LM.led[1], 0.25); led.rotation.y = PI / 4; lm('led', led);
      // Menara TM: a bamboo shoot, tapering and curving, green crown light
      const tmG = new THREE.CylinderGeometry(1.2, 6.2, 80, 20, 20); { const p = tmG.attributes.position; for (let i = 0; i < p.count; i++) { const k = (p.getY(i) + 40) / 80; p.setX(i, p.getX(i) * 1.25 - k * k * 7); } tmG.computeVertexNormals(); }
      const tm = new THREE.Group(), tmB = new THREE.Mesh(tmG, lit(W[2], 5, 3, '#1c2a24')); tmB.position.y = 40; tm.add(tmB);
      const tmC = new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 10), new THREE.MeshBasicMaterial({ color: '#7dff9a', fog: false })); tmC.position.set(-7, 80.5, 0); tm.add(tmC);
      lm('tm', tm); halo('#7dff9a', 18, LM.tm[0] - 7, G + 80, LM.tm[1], 0.45); avi.push(new THREE.Vector3(LM.tm[0] - 7, G + 83, LM.tm[1]));
      // Menara Maybank: two offset blocks cut like a keris blade, blue band
      const mbb = new THREE.Group(), mbM = lit(W[1], 3, 4, '#3a4a66'), blade = (w, h, x, z) => { const sh = new THREE.Shape([[-w / 2, 0], [w / 2, 0], [w / 2, h], [-w / 2, h - w * 0.9]].map(([a, b]) => new THREE.Vector2(a, b))); const g = new THREE.ExtrudeGeometry(sh, { depth: 9, bevelEnabled: false }); g.translate(0, 0, -4.5); const m = new THREE.Mesh(g, mbM); m.position.set(x, 0, z); mbb.add(m); };
      blade(9, 92, -3, 0); blade(8, 108, 4.5, 3);
      for (const [x, z, h, w] of [[-3, 0, 92, 9], [4.5, 3, 108, 8]]) { const e = new THREE.Mesh(new THREE.BoxGeometry(0.5, h - w * 0.9, 9.4), new THREE.MeshBasicMaterial({ color: '#4aa8ff', fog: false })); e.position.set(x - w / 2, (h - w * 0.9) / 2, z); mbb.add(e); }
      mbb.rotation.y = 0.6; lm('mbb', mbb); halo('#4aa8ff', 24, LM.mbb[0], G + 100, LM.mbb[1], 0.35);
      halo('#ffffff', 22, LM.m118[0], G + 100, LM.m118[1], 0.35);
      anim((dt, t) => { crown.material.color.setHSL((t * 0.06) % 1, 0.9, 0.6); band.material.color.setHSL((t * 0.06 + 0.5) % 1, 0.9, 0.62); trL.material.color.setHSL(0.55, 0.8, 0.55 + Math.sin(t * 1.5) * 0.12); });
      // ── filler towers all round: three window styles, instanced, kept low in front of the landmarks so they stay visible ──
      const lots = [[], [], []], L = Object.values(LM).concat([[RX + 18, 30]]);
      for (let i = 0, n = Q.low ? 110 : 240; i < n; i++) {
        const a = i / n * PI * 2 + r() * 0.3, d = 44 + r() * 86, x = Math.sin(a) * d, z = -Math.cos(a) * d; // even spread round the circle so no side is bare
        if (L.some(([lx, lz]) => Math.hypot(x - lx, z - lz) < 16)) continue;
        let h = 30 + r() * r() * 70;
        if (L.some(([lx, lz]) => d < Math.hypot(lx, lz) && Math.abs(Math.atan2(Math.sin(a - Math.atan2(lx, -lz)), Math.cos(a - Math.atan2(lx, -lz)))) < 0.16)) h *= 0.55;
        lots[i % 3].push([x, z, 5 + r() * 7, 5 + r() * 7, h, r() * PI]); if (h > 70) avi.push(new THREE.Vector3(x, G + h + 0.6, z));
      }
      const M4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), box = new THREE.BoxGeometry(1, 1, 1);
      lots.forEach((ls, k) => { const im = new THREE.InstancedMesh(box, lit(W[k], 1, 1), ls.length);
        ls.forEach(([x, z, w, d, h, ry], i) => im.setMatrixAt(i, M4.compose(new THREE.Vector3(x, G + h / 2, z), q4.setFromAxisAngle(up, ry), new THREE.Vector3(w, h, d)))); V.add(im); });
      // aviation lights blink in two groups
      const aviPts = k => { const g = new THREE.BufferGeometry().setFromPoints(avi.filter((_, i) => i % 2 === k)); const p = new THREE.Points(g, new THREE.PointsMaterial({ color: '#ff3a3a', size: 2.4, map: puff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); V.add(p); return p; };
      const av = [aviPts(0), aviPts(1)]; anim((dt, t) => av.forEach((p, k) => { p.material.opacity = Math.sin(t * 3 + k * PI) > 0.2 ? 1 : 0.12; }));
      // street grid far below + two highways of moving headlights / tail lights
      const grid = cv(256, 256, (g, w, h) => { g.fillStyle = '#05070d'; g.fillRect(0, 0, w, h); g.strokeStyle = '#d98a3a'; g.globalAlpha = 0.55; g.lineWidth = 3; for (let x = 0; x <= w; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); g.beginPath(); g.moveTo(0, x); g.lineTo(w, x); g.stroke(); }
        g.globalAlpha = 1; g.fillStyle = '#ffd98a'; for (let x = 0; x < w; x += 64) for (let y = 0; y < h; y += 16) g.fillRect(x - 1, y, 3, 3); }); grid.wrapS = grid.wrapT = THREE.RepeatWrapping; grid.repeat.set(16, 16);
      const gp = add(new THREE.PlaneGeometry(520, 520), new THREE.MeshBasicMaterial({ map: grid }), 0, G, 0); gp.rotation.x = -PI / 2;
      const road = (rad, wob, ph) => new THREE.CatmullRomCurve3(Array.from({ length: 12 }, (_, i) => { const a = i / 12 * PI * 2, rr = rad + Math.sin(a * 3 + ph) * wob; return new THREE.Vector3(Math.sin(a) * rr, G + 0.6, -Math.cos(a) * rr); }), true);
      const flow = (curve, n, col, speed) => { const g = new THREE.BufferGeometry(), pos = new Float32Array(n * 3); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        V.add(new THREE.Points(g, new THREE.PointsMaterial({ color: col, size: 1.8, map: puff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
        const v = new THREE.Vector3(); anim((dt, t) => { for (let i = 0; i < n; i++) { curve.getPointAt(((i / n + t * speed) % 1 + 1) % 1, v); pos.set([v.x, v.y, v.z], i * 3); } g.attributes.position.needsUpdate = true; }); };
      const n = Q.low ? 70 : 150; for (const [rad, wob, ph] of [[58, 6, 0], [112, 10, 2]]) { const c = road(rad, wob, ph); flow(c, n, '#ff4a3a', 0.008); flow(c, n, '#fff4d8', -0.01); }
      // a plane crossing high up, strobe on
      const plane = halo('#ffffff', 2.5, 0, 70, 0, 0.9), pr = halo('#ff3a3a', 1.6, 0, 70, 0, 0.9);
      anim((dt, t) => { const k = (t / 46) % 1, x = -170 + k * 340, z = -40 + k * 60, on = (t * 1.3) % 1 < 0.12; plane.position.set(x, 72, z); pr.position.set(x - 1.5, 72, z); plane.material.opacity = on ? 1 : 0.35; pr.material.opacity = on ? 0.2 : 0.9; });
      // far skyline panorama: horizon glow, silhouettes with window dots, a carpet of city light below
      pano((g, w, h) => { gradBand(g, w, h, [[0, '#03050e'], [0.3, '#0c1430'], [0.42, '#2a2850'], [0.5, '#141a34'], [0.62, '#0a0f1e'], [1, '#05070d']]);
        const q = rng(7); for (let x = 0; x < w;) { const bw = 14 + q() * 46, top = h * (0.37 + q() * 0.1); g.fillStyle = '#0a0f1e'; g.fillRect(x, top, bw, h * 0.62 - top);
          g.fillStyle = q() < 0.5 ? '#ffd98a' : '#9fd7ff'; for (let y = top + 4; y < h * 0.6; y += 7) for (let xx = x + 3; xx < x + bw - 3; xx += 6) if (q() < 0.3) g.fillRect(xx, y, 2, 3); x += bw + q() * 6; }
        for (let i = 0; i < 9000; i++) { g.fillStyle = ['#ffcf70', '#ffe9b8', '#9fd7ff', '#ff8a5a'][(q() * 4) | 0]; g.globalAlpha = 0.3 + q() * 0.6; g.fillRect(q() * w, h * (0.6 + q() * 0.4), 2, 2); } g.globalAlpha = 1;
      }, 150, 170, -90);
      const stars = new Float32Array(900); for (let i = 0; i < 300; i++) { const a = Math.sin(i * 91.7) * PI, e = 0.18 + Math.abs(Math.cos(i * 13.3)) * 1.2; stars.set([Math.cos(a) * Math.cos(e) * 140, Math.sin(e) * 140, Math.sin(a) * Math.cos(e) * 140], i * 3); }
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(stars, 3)); V.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: '#ffffff', size: 0.8, fog: false })));
      this.scene.fog = new THREE.Fog('#0d1530', 90, 230);
    }
    sponsor();
  }

  // Team of paper players. look = paper item look.
  setTeams(engine, teams, kits, looks, keeperKits, stars = []) { // stars[team][slot] = look for that one player
    this.disposeGroup(this.dyn); this.pieces = [];
    SHIMMER.clear(); const cache = new Map();
    for (const p of engine.pieces) {
      const team = teams[p.team], kit = p.isGK ? keeperKits[p.team] : kits[p.team], look = stars[p.team]?.[p.slot] || looks[p.team];
      const pl = makePlayer({ team, kit, number: p.number, name: p.name, look }, cache);
      this.dyn.add(pl.root); this.pieces.push({ ...pl, data: p, x: p.x, z: p.z, hop: 0, ry: 0 });
    }
    this.studioDirty = true;
  }
  setBall(look) {
    if (this.ballMesh) { this.scene.remove(this.ballMesh); this.disposeGroup(this.ballMesh); this.ballMesh.geometry.dispose(); this.ballMesh.material.map.dispose(); this.ballMesh.material.dispose(); }
        this.ballLook = look;
    this.ballMesh = makeBall(look); this.scene.add(this.ballMesh);
    if (!this.ballRing) {
      this.ballRing = new THREE.Mesh(new THREE.RingGeometry(0.26, 0.33, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, depthTest: false }));
      this.ballRing.rotation.x = -Math.PI / 2; this.ballRing.renderOrder = 6; this.scene.add(this.ballRing);
    }
    this.trailPts = [];
    if (this.trailLine) this.fx.remove(this.trailLine);
    if (look.trail) { this.trailLine = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: look.trail, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })); this.fx.add(this.trailLine); }
    else this.trailLine = null;
  }

  buildAim() {
    this.aimGroup = new THREE.Group(); this.scene.add(this.aimGroup);
    const dotGeo = new THREE.SphereGeometry(0.07, 10, 8), dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, depthWrite: false, depthTest: false });
    this.dots = []; const rim = new THREE.MeshBasicMaterial({ color: 0x06100a, transparent: true, opacity: 0.85, depthWrite: false, depthTest: false, side: THREE.BackSide });
    for (let i = 0; i < 40; i++) { const d = new THREE.Mesh(dotGeo, dotMat.clone()); d.renderOrder = 8; const o = new THREE.Mesh(dotGeo, rim); o.scale.setScalar(1.35); o.renderOrder = 7; d.add(o); d.visible = false; this.aimGroup.add(d); this.dots.push(d); }
    this.landRing = new THREE.Mesh(new THREE.RingGeometry(0.26, 0.42, 32), new THREE.MeshBasicMaterial({ color: 0x16e0ff, transparent: true, opacity: 0.95, depthWrite: false, depthTest: false })); this.landRing.renderOrder = 6;
    this.landRing.rotation.x = -Math.PI / 2; this.landRing.visible = false; this.aimGroup.add(this.landRing);
    const shape = new THREE.Shape(); shape.moveTo(-0.07, 0); shape.lineTo(0.07, 0); shape.lineTo(0.07, 0.8); shape.lineTo(0.18, 0.8); shape.lineTo(0, 1.1); shape.lineTo(-0.18, 0.8); shape.lineTo(-0.07, 0.8);
    this.arrow = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: 0x16e0ff, side: THREE.DoubleSide, depthWrite: false, depthTest: false }));
    this.arrow.renderOrder = 8; const outline = new THREE.Mesh(this.arrow.geometry, new THREE.MeshBasicMaterial({ color: 0x06100a, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false, depthTest: false }));
    outline.scale.set(1.35, 1.12, 1); outline.position.set(0, -0.04, -0.001); outline.renderOrder = 7; this.arrow.add(outline);
    this.arrow.rotation.x = -Math.PI / 2; this.arrow.visible = false; this.aimGroup.add(this.arrow);
  }
  showAim(ball, dx, dz, power, path, ps) {
    const show = !!path;
    const target = path?.land || path?.end;
    this.arrow.visible = show; this.landRing.visible = show && !!target;
    this.dots.forEach(d => d.visible = false);
    if (!show) return;
    const col = ps ? 0xff5a1f : power > 0.85 ? 0xffc23d : 0x16e0ff;
    this.arrow.material.color.set(col); this.landRing.material.color.set(col);
    // ShapeGeometry points +y; after -90deg about x that is -z, so yaw by atan2(-dx,-dz) to point along (dx,dz).
    this.arrow.position.set(ball.x + dx * 0.3, 0.03, ball.z + dz * 0.3);
    this.arrow.rotation.set(0, Math.atan2(-dx, -dz), 0, 'YXZ'); this.arrow.rotateX(-Math.PI / 2);
    this.arrow.scale.set(1.5, 0.8 + power * 1.8, 1);
    const pts = path.pts, step = Math.max(1, Math.floor(pts.length / this.dots.length));
    for (let i = 0, j = 0; i < pts.length && j < this.dots.length; i += step, j++) { const d = this.dots[j], p = pts[i]; d.visible = true; d.position.set(p.x, p.y + 0.05, p.z); d.material.opacity = 1 - j / this.dots.length * 0.45; d.material.color.set(col); }
    if (target) this.landRing.position.set(target.x, 0.02, target.z);
  }

  ripple(x, z, color = 0xffffff) {
    if (!this.rip) { this.rip = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.26, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false })); this.rip.rotation.x = -Math.PI / 2; this.scene.add(this.rip); }
    this.rip.material.color.set(color); this.rip.position.set(x, 0.02, z); this.ripT = 0;
  }
  // Tap feedback grows with paper rarity: white ripple, coloured ripple (epic), sparks (legend), rainbow sparks (myth).
  tapFx(x, z, rank, color) {
    this.ripple(x, z, rank >= 2 ? color : 0xffffff);
    if (rank >= 3) this.burst(x, 0.35, z, rank >= 4 && color !== '#ffc23a' ? ['#ff5fd2', '#39f6ff', '#ffd45a', '#ffffff'] : [color, '#ffe9a0', '#ffffff'], rank >= 4 ? 40 : 26, 4.2, 7, 0.07, true);
  }
  burst(x, y, z, colors, n = 80, speed = 6, gravity = 9, size = 0.08, glow = false, life = 2, shape) {
    n = Math.min(n, (Q.low ? 260 : 520) - this.particles.length); if (n <= 0) return; // ponytail: hard cap, each particle is a draw call; instance them if phones still choke
    const geo = shape === 'spark' ? new THREE.PlaneGeometry(size * 0.6, size * 3) : glow ? new THREE.PlaneGeometry(size * 0.5, size * 2.4) : new THREE.PlaneGeometry(size, size * 1.4); geo.userData.refs = n;
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: colors[i % colors.length], side: THREE.DoubleSide, transparent: true, ...(glow ? { blending: THREE.AdditiveBlending, depthWrite: false } : {}) }));
      m.position.set(x, y, z); const rad = shape === 'sphere' || shape === 'spark', a = Math.random() * Math.PI * 2, u = rad ? 1 : Math.random(), e = rad ? Math.acos(2 * Math.random() - 1) : 0;
      const v = rad ? new THREE.Vector3(Math.sin(e) * Math.cos(a), Math.cos(e), Math.sin(e) * Math.sin(a)).multiplyScalar(speed * (0.85 + Math.random() * 0.3)) : new THREE.Vector3(Math.cos(a) * speed * u, speed * (0.6 + Math.random()), Math.sin(a) * speed * u);
      this.fx.add(m); this.particles.push({ m, v, spin: new THREE.Vector3(Math.random() * 9, Math.random() * 9, 0), life: life + Math.random(), g: gravity, drag: rad ? 2.2 : 0.9, face: shape === 'sphere', streak: shape === 'spark' });
    }
  }
  flash(x, y, z, c, s = 6, life = 0.5) { // glow sprite that blooms then fades
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: SOFT, color: c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); m.position.set(x, y, z); m.scale.setScalar(0.1); this.fx.add(m);
    this.particles.push({ m, v: new THREE.Vector3(), spin: new THREE.Vector3(), life, g: 0, grow: s, max: life, sprite: true });
  }
  shock(x, z, c) { const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 64), new THREE.MeshBasicMaterial({ color: c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.geometry.userData.refs = 1; m.rotation.x = -Math.PI / 2; m.position.set(x, 0.04, z); this.fx.add(m); this.particles.push({ m, v: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0.8, g: 0, ring: 7, max: 0.8 }); }
  rocket(x, z, h, c, after) { // glowing head climbing with a sparkle tail, then calls after(pos)
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: SOFT, color: c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); m.scale.setScalar(0.5); m.position.set(x, 0.3, z); this.fx.add(m);
    this.particles.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 0.6, h * 1.7, 0), spin: new THREE.Vector3(), life: 0.62, g: h * 2.6, sprite: true, tail: c, after });
  }
  // setFx: colours of a completed set (extra shower on top of the chosen effect). rank 4 paper: gold/rainbow column.
  later(sec, fn) { (this.queue ||= []).push({ sec, fn }); }
  goalFx(kind, x, z, teamColors, setFx, rank = 0) {
    if (setFx) { this.burst(x, 6, z, setFx, 140, 3, 2.5, 0.13); for (let k = 1; k <= 3; k++) this.later(k * 0.22, () => this.burst(x + (k - 2) * 2.4, 4.5, z, setFx, 60, 4.5, 3, 0.09)); }
    if (rank >= 4) this.burst(x, 0.2, z, ['#ff5fd2', '#39f6ff', '#ffd45a', '#7cff6b', '#ffffff'], 90, 9, 6, 0.07);
    if (kind === 'x_fireworks') {
      const pal = [['#ff3a3a', '#ffd45a'], ['#39f6ff', '#ffffff'], ['#b36bff', '#ff5fd2'], ['#7cff6b', '#ffd45a'], ['#ffd45a', '#ffffff']];
      this.shock(x, z, '#ffd45a'); this.dim = 2.4; // night falls for the show, then the venue light returns
      pal.forEach((cs, k) => this.later(k * 0.2, () => this.rocket(x + (k - 2) * 2.6, z - 3 + (k % 2) * 1.2, 11 + (k % 3) * 1.6, cs[0], pos => {
        this.flash(pos.x, pos.y, pos.z, cs[0], 4, 0.35); this.burst(pos.x, pos.y, pos.z, cs, 110, 5.5, 1.2, 0.06, true, 1.4, 'spark');
        this.burst(pos.x, pos.y, pos.z, [cs[1]], 24, 2.4, 1.0, 0.06, true, 1.8, 'sphere'); })));
    } else if (kind === 'x_confetti') {
      const cols = ['#ff4f7a', '#ffd400', '#2ad4ff', '#7cff6b', '#b36bff', '#ffffff'];
      this.shock(x, z, '#ffffff'); for (const sx of [-1, 1]) this.burst(x + sx * 2.5, 0.3, z, cols, 90, 7.5, 3.2, 0.13, false, 3.2); // two cannons + a shower from above
      this.burst(x, 6.5, z, cols, 150, 2.4, 1.6, 0.14, false, 3.6);
    } else if (FX_SIMPLE[kind]) { const [cols, up, n, speed, grav, size, glow, life] = FX_SIMPLE[kind]; // cheap effects: one tuned burst
      this.flash(x, 0.6, z, cols[0], 2.5, 0.3); this.burst(x, up, z, cols === 'team' ? [...teamColors, '#ffffff'] : cols, n, speed, grav, size, glow, life);
    } else { this.flash(x, 0.6, z, '#ffffff', 3, 0.35); this.burst(x, 0.8, z, ['#ffffff', '#f1ece0', ...teamColors], 90, 6, 9, 0.1); }
  }

  update(dt, t) {
    if (this.dim > 0 || this._dimK) { this.dim = Math.max(0, (this.dim || 0) - dt); const k = Math.min(1, this.dim / 0.4) * (this.dim > 0 ? 1 : 0); if (this._expo == null) this._expo = this.r.toneMappingExposure;
      this._dimK = k; this.r.toneMappingExposure = this._expo * (1 - 0.62 * k); if (!k) { this.r.toneMappingExposure = this._expo; this._expo = null; this._dimK = 0; } }
    if (this.queue?.length) { for (const q of this.queue) q.sec -= dt; const due = this.queue.filter(q => q.sec <= 0); this.queue = this.queue.filter(q => q.sec > 0); due.forEach(q => q.fn()); }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]; p.life -= dt; p.v.y -= p.g * dt; p.v.multiplyScalar(1 - (p.drag ?? 0.9) * dt);
      p.m.position.addScaledVector(p.v, dt);
      if (p.streak) { p.m.quaternion.copy(this.cam.quaternion); const sv = p.v.clone().project(this.cam).sub(p.m.position.clone().project(this.cam)); p.m.rotateZ(Math.atan2(sv.y, sv.x) - Math.PI / 2 + 0 * sv.x); }
      else if (p.face) p.m.quaternion.copy(this.cam.quaternion); else if (!p.sprite) { p.m.rotation.x += p.spin.x * dt; p.m.rotation.y += p.spin.y * dt; }
      if (p.m.position.y < 0.01) { p.m.position.y = 0.01; p.v.set(0, 0, 0); }
      if (p.grow) { const k = 1 - p.life / p.max; p.m.scale.setScalar(p.grow * (0.3 + k)); p.m.material.opacity = 1 - k; }
      else if (p.ring) { const k = 1 - p.life / p.max; p.m.scale.setScalar(0.3 + k * p.ring); p.m.material.opacity = 0.9 * (1 - k); }
      else p.m.material.opacity = Math.min(1, p.life);
      if (p.tail && Math.random() < 0.35) this.burst(p.m.position.x, p.m.position.y, p.m.position.z, [p.tail, '#ffffff'], 1, 0.4, 2, 0.05, true, 0.4);
      if (p.after && p.life <= 0) p.after(p.m.position.clone());
      if (p.life <= 0) { this.fx.remove(p.m); const g = p.m.geometry; if (!p.sprite && --g.userData.refs <= 0) g.dispose(); p.m.material.dispose(); this.particles.splice(i, 1); }
    }
    if (this.rip && this.ripT < 0.5) { this.ripT += dt; const s = 1 + 9 * this.ripT; this.rip.scale.set(s, s, s); this.rip.material.opacity = 0.8 * (1 - this.ripT / 0.5); }
    for (const vp of this.pieces) if (vp.aura) { vp.aura.material.opacity = 0.6 + Math.sin(t * 3 + vp.data.id) * 0.25; vp.aura.rotation.z += dt * 0.6; }
    HOLO_T.value = t;
    for (const m of SHIMMER) { if (m.userData.shimmer === 'gold') m.emissiveIntensity = 0.14 + Math.max(0, Math.sin(t * 2.2)) * 0.3; else m.emissiveIntensity = 0; }
    if (this.fan) this.fan.rotation.y += dt * 2.5;
    if (this.tick) for (const f of this.tick) f(dt, t);
    this.pitchFx?.userData.tick(dt, t); if (this.ballMesh) animBall(this.ballMesh, t);
    if (this.blink) this.blink.visible = Math.sin(t * 4) > 0;
    if (this.crowd && this.cheer > 0) {
      const m = new THREE.Matrix4(); this.cheer -= dt;
      for (let i = 0; i < this.crowdBase.length; i += 2) { const b = this.crowdBase[i]; m.makeTranslation(b.x, b.y + Math.abs(Math.sin(t * 12 + i)) * 0.5 * Math.min(1, this.cheer), b.z); this.crowd.setMatrixAt(i, m); }
      this.crowd.instanceMatrix.needsUpdate = true;
    }
  }
  render() { this.r.render(this.scene, this.cam); }
}
