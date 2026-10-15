// scene.js : Three.js world for Bola Kertas. Paper players, pitch, goals, venues, ball, aim guide, effects.
import * as THREE from 'three';
import { RoomEnvironment } from './vendor/addons/environments/RoomEnvironment.js?v=19';
import { FIELD, BALL_R, PIECE } from './engine.js?v=19';
import { jerseyFront, jerseyBack, paperSurface, pitchTexture, boardTexture, netTexture, ballTexture, APRON, shade, rng } from './art.js?v=19';
import { RARITY } from './items.js?v=19';

export const Q = (() => { // quality tier. Telegram WebView on mobile gets the lean tier.
  const touch = matchMedia('(pointer:coarse)').matches, low = touch && (navigator.hardwareConcurrency || 4) <= 4;
  return { dpr: Math.min(devicePixelRatio || 1, low ? 1.25 : touch ? 1.6 : 2), shadow: low ? 1024 : 2048, aa: !touch, ppu: low ? 64 : 96, low };
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
  const key = `${team.id}|${kit.id}|${number}|${name}|${look.kind}|${look.base}|${look.rarity}`;
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
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.64, 48), new THREE.MeshBasicMaterial({ color: 0xd4ff2a, transparent: true, opacity: 0, depthWrite: false, depthTest: false }));
  ring.renderOrder = 5; ring.rotation.x = -Math.PI / 2; ring.position.y = 0.012; root.add(ring);
  const rank = rankOf(look); let aura = null;
  if (rank >= 2) { // epic+: glowing ring at the feet
    aura = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), new THREE.MeshBasicMaterial({ map: GLOW, color: look.kind === 'gold' ? '#ffc23a' : rcolOf(look), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    aura.rotation.x = -Math.PI / 2; aura.position.y = 0.008; root.add(aura);
  }
  return { root, body, ring, aura, rank, color: look.kind === 'gold' ? '#ffc23a' : rcolOf(look) };
}
const SOFT = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return tex(c); })();
export function makeBall(look) {
  const t = tex(ballTexture(look), true, 16), k = look.kind;
  const m = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 48, 32), new THREE.MeshPhysicalMaterial({ map: t, roughness: k === 'candy' ? 0.15 : 0.35, clearcoat: k === 'candy' ? 1 : 0.6, clearcoatRoughness: 0.1,
    ...(k === 'fire' || k === 'galaxy' ? { emissive: '#ffffff', emissiveMap: t, emissiveIntensity: k === 'fire' ? 0.9 : 0.6 } : {}) }));
  m.castShadow = true; m.userData.spin = [];
  const halo = (c, s, op) => { const h = new THREE.Sprite(new THREE.SpriteMaterial({ map: SOFT, color: c, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false })); h.scale.setScalar(s); m.add(h); return h; };
  if (k === 'fire') { m.userData.glow = halo('#ff6a10', BALL_R * 6, 0.55); // flame tongues + embers flicker around the ball
    for (let i = 0; i < 10; i++) { const f = halo(i % 2 ? '#ffb02e' : '#ff3a0c', BALL_R * 2.2, 0.75); f.userData.a = i / 10 * 6.28; m.userData.spin.push(f); } m.userData.flame = true; }
  if (k === 'galaxy') { m.userData.glow = halo('#8f6bff', BALL_R * 5.5, 0.45);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(BALL_R * 1.6, BALL_R * 0.05, 8, 64), new THREE.MeshBasicMaterial({ color: '#c9b8ff', transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false })); ring.rotation.x = 1.2; m.add(ring); m.userData.ring = ring;
    for (let i = 0; i < 6; i++) { const st = halo(['#ffffff', '#9fefff', '#ff9fe8'][i % 3], BALL_R * 0.9, 1); st.userData.a = i / 6 * 6.28; st.userData.r = BALL_R * (1.5 + (i % 2) * 0.4); m.userData.spin.push(st); } }
  if (k === 'candy') m.userData.glow = halo('#ff7fb0', BALL_R * 4, 0.25);
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

export class World {
  // size = [w, h] gives a fixed-size studio World (Locker previews) that renders with the exact match pipeline.
  constructor(canvas, size = null) {
    this.size = size;
    this.r = new THREE.WebGLRenderer({ canvas, antialias: size ? true : Q.aa, powerPreference: 'high-performance', alpha: false });
    this.r.setPixelRatio(size ? 1 : Q.dpr); this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.r.toneMapping = THREE.ACESFilmicToneMapping; this.r.toneMappingExposure = 0.82;
    this.r.shadowMap.enabled = true; this.r.shadowMap.type = THREE.PCFShadowMap;
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(46, 1, 0.05, 220);
    const pm = new THREE.PMREMGenerator(this.r); this.envMap = pm.fromScene(new RoomEnvironment(), 0.04).texture; this.scene.environment = this.envMap; this.scene.environmentIntensity = 0.45;
    this.hemi = new THREE.HemisphereLight(0xdfefff, 0x2f4a2a, 0.35); this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff4e2, 2.1); this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(size ? 2048 : Q.shadow, size ? 2048 : Q.shadow); this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.02; this.sun.shadow.radius = 4;
    Object.assign(this.sun.shadow.camera, { left: -11, right: 11, top: 15, bottom: -15, near: 1, far: 70 });
    this.sun.position.set(7, 22, 9); this.scene.add(this.sun, this.sun.target);
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
    if (id === 'v_desk' || !id) {
      sky('#4f86c6', '#c9b79a'); table('#e8a917', '#4a3a2c', '#b77f00'); floor('#7a5b3e', 0.7);
      add(new THREE.PlaneGeometry(80, 26), std('#b9ab95', 0.95), 0, 2, -24);
      const board = add(new THREE.BoxGeometry(18, 7, 0.2), std('#1f3b2c', 0.9), 0, 6, -23.8);
      const ct = document.createElement('canvas'); ct.width = 1024; ct.height = 400; const g = ct.getContext('2d'); g.fillStyle = '#1f3b2c'; g.fillRect(0, 0, 1024, 400);
      g.fillStyle = 'rgba(255,255,255,0.85)'; g.font = '700 64px "Barlow Condensed", Arial'; g.fillText('4-4-2  ->  TEPUK!', 70, 140); g.font = '600 44px "Barlow Condensed", Arial'; g.fillText('Rehat: 10.30 pagi', 70, 260);
      board.material = [std('#5a4632'), std('#5a4632'), std('#5a4632'), std('#5a4632'), new THREE.MeshStandardMaterial({ map: tex(ct), roughness: 0.95 }), std('#5a4632')];
      for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(1.4, 0.5, 1), std(['#e8483c', '#3a7be8', '#f2c230', '#33a35a'][i], 0.7), -8 + i * 0.5, 0.25 + i * 0.5, 10.8 - i * 0.2);
      const pencil = add(new THREE.CylinderGeometry(0.09, 0.09, 4.2, 6), std('#f2b705', 0.6), 7.6, 0.1, 4); pencil.rotation.set(Math.PI / 2, 0, 0.3); // pencil + ruler on the desk
      add(new THREE.BoxGeometry(0.7, 0.04, 7), std('#d9e7f2', 0.3), -7.9, 0.02, -3);
    } else if (id === 'v_field') {
      sky('#ff9e5e', '#ffe2a8'); this.sun.color.set(0xffd0a0); this.sun.position.set(-12, 10, -6); table('#c79b5f', '#6b4a2a', '#9a6e3a'); floor('#5f8f3a', 1);
      for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2, r = 30 + (i % 3) * 6; palm(Math.cos(a) * r, Math.sin(a) * r, 13); }
      this.scene.fog = new THREE.Fog('#ffd8a0', 40, 110);
    } else if (id === 'v_kopitiam') {
      sky('#2a1c14', '#5a3d2a'); this.sun.color.set(0xffe2b8); this.sun.intensity = 1.5; this.hemi.intensity = 0.45; this.r.toneMappingExposure = 0.9;
      const mTop = new THREE.MeshStandardMaterial({ map: marble, roughness: 0.25 }); table(mTop, '#2b2b2b', '#bdbab3');
      const tiles = cv(512, 512, (g, w, h) => { g.fillStyle = '#e9efe9'; g.fillRect(0, 0, w, h); g.fillStyle = '#c9d6cc'; for (let y = 0; y < h; y += 32) for (let x = 0; x < w; x += 32) g.fillRect(x, y, 31, 1), g.fillRect(x, y, 1, 31); });
      tiles.wrapS = tiles.wrapT = THREE.RepeatWrapping; tiles.repeat.set(10, 4);
      const flr = cv(256, 256, (g, w, h) => { for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { g.fillStyle = (x + y) % 2 ? '#8e2f22' : '#c9c0b0'; g.fillRect(x * 32, y * 32, 32, 32); } }); flr.wrapS = flr.wrapT = THREE.RepeatWrapping; flr.repeat.set(25, 25);
      const f = add(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ map: flr, roughness: 0.6 }), 0, -9.4, 0, true); f.rotation.x = -Math.PI / 2;
      add(new THREE.PlaneGeometry(120, 12), new THREE.MeshStandardMaterial({ map: tiles, roughness: 0.4 }), 0, -3.4, -46);
      add(new THREE.PlaneGeometry(120, 30), std('#e8d7b0', 0.95), 0, 17.6, -46.1);
      const sign = cv(1024, 192, (g, w, h) => { g.fillStyle = '#b3201c'; g.fillRect(0, 0, w, h); g.strokeStyle = '#ffd34a'; g.lineWidth = 10; g.strokeRect(10, 10, w - 20, h - 20); g.fillStyle = '#ffd34a'; g.font = '800 104px "Barlow Condensed", Arial'; g.textAlign = 'center'; g.fillText('KEDAI KOPI BOLA KERTAS', w / 2, 132); });
      add(new THREE.BoxGeometry(44, 8.2, 0.4), [std('#7a1512'), std('#7a1512'), std('#7a1512'), std('#7a1512'), new THREE.MeshStandardMaterial({ map: sign, emissive: '#ffffff', emissiveMap: sign, emissiveIntensity: 0.35, roughness: 0.5 }), std('#7a1512')], 0, 14.5, -45.6);
      const menu = cv(512, 640, (g, w, h) => { g.fillStyle = '#16301f'; g.fillRect(0, 0, w, h); g.strokeStyle = '#c9a25a'; g.lineWidth = 12; g.strokeRect(6, 6, w - 12, h - 12); g.fillStyle = '#fff6dc'; g.font = '800 64px "Barlow Condensed", Arial'; g.textAlign = 'center'; g.fillText('MENU', w / 2, 90);
        g.font = '700 46px "Barlow Condensed", Arial'; [['KOPI O', '1.80'], ['TEH TARIK', '2.20'], ['MILO AIS', '3.00'], ['ROTI BAKAR', '2.50'], ['NASI LEMAK', '3.50'], ['TELUR SEPARUH', '2.00']].forEach(([n, p], i) => { g.textAlign = 'left'; g.fillText(n, 40, 180 + i * 72); g.textAlign = 'right'; g.fillStyle = '#ffd34a'; g.fillText(p, w - 40, 180 + i * 72); g.fillStyle = '#fff6dc'; }); });
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
        g.fillStyle = '#ffd45a'; g.font = '800 96px "Barlow Condensed", Arial'; g.textAlign = 'center'; g.fillText('FINAL', w / 2, 128); g.fillStyle = '#ffffff'; g.font = '700 46px "Barlow Condensed", Arial'; g.fillText('BOLA KERTAS 2026', w / 2, 200); g.fillStyle = '#ff4fd8'; g.fillRect(40, 236, w - 80, 8); });
      for (const sx of [-1, 1]) { const sc = add(new THREE.BoxGeometry(8, 4.5, 0.4), [std('#111'), std('#111'), std('#111'), std('#111'), new THREE.MeshBasicMaterial({ map: scr }), std('#111')], sx * 13, 10.2, -24); sc.lookAt(0, 4, 0);
        add(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 4), std('#888'), sx * 13, 13.6, -24); halo('#8f6bff', 12, sx * 13, 10.2, -24.4, 0.3); }
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
      for (const [x, z] of [[-24, -30], [-34, -18], [26, -34], [36, -22], [-10, -44], [12, -50]]) palm(x, z, 18);
      for (const [x, z, r] of [[-60, -110, 0.2], [70, -130, -0.1]]) { const boat = add(new THREE.ConeGeometry(2.4, 6, 4), std('#f5f0e6', 0.6), x, -6, z); boat.rotation.set(0, r, 0); add(new THREE.BoxGeometry(5, 1, 2), std('#8a4a2a', 0.7), x, -8.6, z); }
      this.scene.fog = new THREE.Fog('#ffb38a', 70, 220);
    } else if (id === 'v_rooftop') {
      sky('#03050e', '#1a2340'); this.sun.intensity = 0.8; this.hemi.intensity = 0.32; table('#3a3f4a', '#222', '#1a1d24'); floor('#2a2e36', 0.9);
      const stars = new Float32Array(900); for (let i = 0; i < 300; i++) { const a = Math.sin(i * 91.7) * Math.PI, e = 0.15 + Math.abs(Math.cos(i * 13.3)) * 1.2; stars.set([Math.cos(a) * Math.cos(e) * 180, Math.sin(e) * 180, Math.sin(a) * Math.cos(e) * 180 - 40], i * 3); }
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(stars, 3)); V.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: '#ffffff', size: 0.9, fog: false })));
      const wins = [];
      for (let i = 0; i < (Q.low ? 30 : 48); i++) {
        const a = (i / 48) * Math.PI * 2, r = 50 + (i % 5) * 10, h = 12 + ((i * 37) % 34);
        const c = document.createElement('canvas'); c.width = 64; c.height = 128; const g = c.getContext('2d'); g.fillStyle = '#0b1020'; g.fillRect(0, 0, 64, 128);
        for (let y = 3; y < 128; y += 6) for (let x = 3; x < 64; x += 6) if (((x * 7 + y * 13 + i * 5) % 7) < 3) { g.fillStyle = ['#ffd98a', '#fff4d0', '#9fd7ff'][(x + y + i) % 3]; g.fillRect(x, y, 3, 3); }
        const t = tex(c, true, 8), m = new THREE.MeshStandardMaterial({ color: '#111827', emissive: '#ffffff', emissiveMap: t, emissiveIntensity: 0.9, map: t }); wins.push(m);
        add(new THREE.BoxGeometry(6, h, 6), m, Math.cos(a) * r, -9 + h / 2, Math.sin(a) * r);
      }
      anim((dt, t) => wins.forEach((m, i) => { m.emissiveIntensity = 0.75 + (Math.sin(t * 0.7 + i * 2.3) > 0.85 ? 0.5 : 0) + Math.sin(t * 1.9 + i) * 0.08; }));
      const steel = new THREE.MeshStandardMaterial({ color: '#b9c3d6', metalness: 0.85, roughness: 0.22 }), tw = new THREE.Group(); // twin towers + skybridge, behind the far goal
      for (const s of [-1, 1]) { let y = -9; [[4.2, 26], [3.4, 14], [2.6, 10], [1.8, 6], [1, 4]].forEach(([rad, hh]) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rad * 0.92, rad, hh, 8), steel); m.position.set(s * 7, y + hh / 2, 0); tw.add(m); y += hh; });
        const sp = new THREE.Mesh(new THREE.ConeGeometry(0.35, 12, 8), steel); sp.position.set(s * 7, y + 6, 0); tw.add(sp);
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 12), new THREE.MeshBasicMaterial({ color: '#ff3a3a' })); tip.position.set(s * 7, y + 12.3, 0); tw.add(tip); if (s > 0) this.blink = tip; }
      const br = new THREE.Mesh(new THREE.BoxGeometry(10, 2.2, 2.4), steel); br.position.set(0, 20, 0); tw.add(br); for (const s of [-1, 1]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 9, 6), steel); leg.position.set(s * 2.2, 15, 0); leg.rotation.z = s * 0.55; tw.add(leg); }
      const bl = new THREE.Mesh(new THREE.BoxGeometry(10.2, 0.4, 2.5), new THREE.MeshBasicMaterial({ color: '#9fd7ff' })); bl.position.set(0, 20, 0); tw.add(bl); tw.position.set(-3, -6, -64); tw.scale.setScalar(0.42); V.add(tw);
      halo('#4a6cff', 46, -4, 14, -78, 0.28); halo('#ffffff', 5, -4 + 7 * 0.62, -2 + (60 + 12.3) * 0.62 - 9 * 0.62 + 9 * 0.62 * 0, -70, 0.0);
      add(new THREE.BoxGeometry(TW + 10, 2.2, 0.6), std('#4a4f5a', 0.85), 0, -8.3, -(TL / 2 + 8)); add(new THREE.BoxGeometry(TW + 10, 2.2, 0.6), std('#4a4f5a', 0.85), 0, -8.3, TL / 2 + 8);
      for (let x = -TW / 2 - 4; x <= TW / 2 + 4; x += 2.5) add(new THREE.CylinderGeometry(0.07, 0.07, 3, 6), std('#c9ced8', 0.3, 0.8), x, -5.7, -(TL / 2 + 8));
      add(new THREE.BoxGeometry(TW + 10, 0.12, 0.12), std('#c9ced8', 0.3, 0.8), 0, -4.2, -(TL / 2 + 8));
      const tank = add(new THREE.CylinderGeometry(3.2, 3.2, 5.5, 24), std('#7c8796', 0.5, 0.5), -22, -1.5, -26); for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) add(new THREE.BoxGeometry(0.3, 5, 0.3), std('#333'), -22 + dx, -6.9, -26 + dz);
      for (const [x, z] of [[22, -20], [26, -12]]) { add(new THREE.BoxGeometry(5, 3.4, 3.4), std('#d5d8de', 0.6), x, -7.7, z); const g = add(new THREE.CircleGeometry(1.2, 20), std('#2b2f36', 0.8), x, -7.7, z + 1.71); }
      const hp = add(new THREE.CircleGeometry(9, 48), new THREE.MeshStandardMaterial({ map: cv(256, 256, (g, w, h) => { g.fillStyle = '#2e333c'; g.fillRect(0, 0, w, h); g.strokeStyle = '#ffd34a'; g.lineWidth = 10; g.beginPath(); g.arc(128, 128, 110, 0, 7); g.stroke(); g.fillStyle = '#ffffff'; g.font = '800 150px "Barlow Condensed", Arial'; g.textAlign = 'center'; g.fillText('H', 128, 182); }), roughness: 0.8 }), 26, -9.35, 18); hp.rotation.x = -Math.PI / 2;
      this.scene.fog = new THREE.Fog('#0a1022', 70, 190);
    }
  }

  // Team of paper players. look = paper item look.
  setTeams(engine, teams, kits, looks, keeperKits) {
    this.disposeGroup(this.dyn); this.pieces = [];
    SHIMMER.clear(); const cache = new Map();
    for (const p of engine.pieces) {
      const team = teams[p.team], kit = p.isGK ? keeperKits[p.team] : kits[p.team], look = looks[p.team];
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
    this.landRing = new THREE.Mesh(new THREE.RingGeometry(0.26, 0.42, 32), new THREE.MeshBasicMaterial({ color: 0xd4ff2a, transparent: true, opacity: 0.95, depthWrite: false, depthTest: false })); this.landRing.renderOrder = 6;
    this.landRing.rotation.x = -Math.PI / 2; this.landRing.visible = false; this.aimGroup.add(this.landRing);
    const shape = new THREE.Shape(); shape.moveTo(-0.07, 0); shape.lineTo(0.07, 0); shape.lineTo(0.07, 0.8); shape.lineTo(0.18, 0.8); shape.lineTo(0, 1.1); shape.lineTo(-0.18, 0.8); shape.lineTo(-0.07, 0.8);
    this.arrow = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: 0xd4ff2a, side: THREE.DoubleSide, depthWrite: false, depthTest: false }));
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
    const col = ps ? 0xff5a1f : power > 0.85 ? 0xffb02e : 0xd4ff2a;
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
