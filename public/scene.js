// scene.js : Three.js world for Bola Kertas. Paper players, pitch, goals, venues, ball, aim guide, effects.
import * as THREE from 'three';
import { RoomEnvironment } from './vendor/addons/environments/RoomEnvironment.js?v=16';
import { FIELD, BALL_R, PIECE } from './engine.js?v=16';
import { jerseyFront, jerseyBack, paperSurface, pitchTexture, boardTexture, netTexture, ballTexture, APRON, shade } from './art.js?v=16';

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

function paperMaterial(map, look, printed) {
  const m = new THREE.MeshPhysicalMaterial({ map, roughness: look.rough ?? 0.85, metalness: printed ? (look.metal ?? 0) * 0.5 : look.metal ?? 0,
    clearcoat: look.clearcoat ?? 0, clearcoatRoughness: 0.15, side: THREE.FrontSide });
  if (look.iri) { m.iridescence = 1; m.iridescenceIOR = 1.6; m.iridescenceThicknessRange = [200, 900]; }
  if (look.kind === 'gold') { m.color.set(0xffd27a); m.metalness = 0.85; m.roughness = 0.28; m.clearcoat = 0.6; }
  if (look.kind === 'holo' && printed) m.color.set(0xf2e9ff);
  return m;
}

export class World {
  constructor(canvas) {
    this.r = new THREE.WebGLRenderer({ canvas, antialias: Q.aa, powerPreference: 'high-performance' });
    this.r.setPixelRatio(Q.dpr); this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.r.toneMapping = THREE.ACESFilmicToneMapping; this.r.toneMappingExposure = 0.82;
    this.r.shadowMap.enabled = true; this.r.shadowMap.type = THREE.PCFShadowMap;
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(46, 1, 0.05, 220);
    const pm = new THREE.PMREMGenerator(this.r); this.envMap = pm.fromScene(new RoomEnvironment(), 0.04).texture; this.scene.environment = this.envMap; this.scene.environmentIntensity = 0.45;
    this.hemi = new THREE.HemisphereLight(0xdfefff, 0x2f4a2a, 0.35); this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff4e2, 2.1); this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(Q.shadow, Q.shadow); this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.02; this.sun.shadow.radius = 4;
    Object.assign(this.sun.shadow.camera, { left: -11, right: 11, top: 15, bottom: -15, near: 1, far: 70 });
    this.sun.position.set(7, 22, 9); this.scene.add(this.sun, this.sun.target);
    this.static = new THREE.Group(); this.venue = new THREE.Group(); this.dyn = new THREE.Group(); this.fx = new THREE.Group();
    this.scene.add(this.static, this.venue, this.dyn, this.fx);
    this.pieces = []; this.particles = []; this.camPos = new THREE.Vector3(0, 14, 16); this.camLook = new THREE.Vector3();
    this.buildGoals(); this.buildAim();
    this.resize(); addEventListener('resize', () => this.resize());
  }
  resize() { const w = innerWidth, h = innerHeight; this.r.setSize(w, h, false); this.cam.aspect = w / h; this.cam.updateProjectionMatrix(); }

  disposeGroup(g) { g.traverse(o => { o.geometry && o.geometry !== TENT && o.geometry.dispose(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach(x => { x.map?.dispose(); x.dispose(); }); }); g.clear(); }

  setPitch(look) {
    if (this.pitch) { this.static.remove(this.pitch); this.pitch.geometry.dispose(); this.pitch.material.map.dispose(); this.pitch.material.dispose(); }
    const t = tex(pitchTexture(look, Q.ppu), true, this.r.capabilities.getMaxAnisotropy());
    const m = new THREE.MeshStandardMaterial({ map: t, roughness: look.style === 'neon' ? 0.5 : 0.95, metalness: 0, envMapIntensity: 0.3 });
    if (look.style === 'neon') { m.emissive = new THREE.Color(0xffffff); m.emissiveMap = t; m.emissiveIntensity = 0.35; }
    this.pitch = new THREE.Mesh(new THREE.PlaneGeometry(FIELD.W + APRON * 2, FIELD.L + APRON * 2), m);
    this.pitch.rotation.x = -Math.PI / 2; this.pitch.receiveShadow = true; this.static.add(this.pitch);
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
      add(new THREE.BoxGeometry(TW + 1.6, 0.5, TL + 1.6), std(top, 0.55), 0, -0.26, 0, true);
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
    this.spot = [];
    if (id === 'v_desk' || !id) {
      sky('#4f86c6', '#c9b79a'); table('#e8a917', '#4a3a2c', '#b77f00'); floor('#7a5b3e', 0.7);
      const wall = add(new THREE.PlaneGeometry(80, 26), std('#b9ab95', 0.95), 0, 2, -24); 
      const board = add(new THREE.BoxGeometry(18, 7, 0.2), std('#1f3b2c', 0.9), 0, 6, -23.8);
      const ct = document.createElement('canvas'); ct.width = 1024; ct.height = 400; const g = ct.getContext('2d'); g.fillStyle = '#1f3b2c'; g.fillRect(0, 0, 1024, 400);
      g.fillStyle = 'rgba(255,255,255,0.85)'; g.font = '700 64px "Barlow Condensed", Arial'; g.fillText('4-4-2  ->  TEPUK!', 70, 140); g.font = '600 44px "Barlow Condensed", Arial'; g.fillText('Rehat: 10.30 pagi', 70, 260);
      board.material = [std('#5a4632'), std('#5a4632'), std('#5a4632'), std('#5a4632'), new THREE.MeshStandardMaterial({ map: tex(ct), roughness: 0.95 }), std('#5a4632')];
      for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(1.4, 0.5, 1), std(['#e8483c', '#3a7be8', '#f2c230', '#33a35a'][i], 0.7), -8 + i * 0.5, 0.25, 10.8 - i * 0.2);
    } else if (id === 'v_field') {
      sky('#ff9e5e', '#ffe2a8'); this.sun.color.set(0xffd0a0); this.sun.position.set(-12, 10, -6); table('#c79b5f', '#6b4a2a', '#9a6e3a'); floor('#5f8f3a', 1);
      for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2, r = 30 + (i % 3) * 6; const trunk = add(new THREE.CylinderGeometry(0.25, 0.35, 10, 6), std('#7a5a3a'), Math.cos(a) * r, -4.5, Math.sin(a) * r);
        for (let k = 0; k < 6; k++) { const leaf = add(new THREE.ConeGeometry(0.8, 4.5, 4), std('#3f7a2e', 1), trunk.position.x, 1, trunk.position.z); leaf.rotation.set(Math.PI / 2.4, k * Math.PI / 3, 0); leaf.position.y = 1.2; } }
      this.scene.fog = new THREE.Fog('#ffd8a0', 40, 110);
    } else if (id === 'v_kopitiam') {
      sky('#3b2a20', '#6e4c35'); this.sun.color.set(0xffe2b8); this.sun.intensity = 1.8; table('#f2efe9', '#2b2b2b', '#bdbab3'); floor('#a33a2a', 0.8);
      for (const x of [-12, 12]) for (const z of [-10, 10]) add(new THREE.CylinderGeometry(2.2, 2.2, 0.2, 24), std('#f5f5f0', 0.3), x, -2, z);
      const fan = add(new THREE.CylinderGeometry(0.3, 0.3, 0.3, 12), std('#333'), 0, 14, 0); this.fan = new THREE.Group(); this.fan.position.set(0, 13.8, 0);
      for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(5, 0.05, 0.7), std('#6b4a2a')); b.position.x = 2.5; const pv = new THREE.Group(); pv.rotation.y = i * Math.PI * 2 / 3; pv.add(b); this.fan.add(pv); } V.add(this.fan);
      const cup = add(new THREE.CylinderGeometry(0.45, 0.35, 0.9, 20), std('#ffffff', 0.2), 8.4, 0.45, -12.4); add(new THREE.CylinderGeometry(0.4, 0.4, 0.05, 20), std('#4a2a12', 0.3), 8.4, 0.88, -12.4);
    } else if (id === 'v_night' || id === 'v_final') {
      const fin = id === 'v_final';
      sky(fin ? '#0b0a1f' : '#050a18', fin ? '#2a1d4a' : '#14203d'); this.sun.intensity = 1.3; this.hemi.intensity = 0.25; this.r.toneMappingExposure = 0.95;
      floor(fin ? '#1b1530' : '#10182b', 1); boards(fin ? 'FINAL  BOLA KERTAS' : 'BOLA KERTAS  LIGA MALAM', fin ? '#2a1d4a' : '#0b2a6f', fin ? '#ffd45a' : '#ffffff');
      add(new THREE.BoxGeometry(TW + 3, 0.6, TL + 3), std('#2b2f3a', 0.7), 0, -0.31, 0, true);
      crowd(Q.low ? 500 : 1100, 20, fin ? ['#ffd45a', '#ffffff', '#e8483c', '#2a1d4a', '#8f6bff'] : ['#d71920', '#1b3f94', '#ffffff', '#ffd400', '#111111'], -2);
      for (const x of [-1, 1]) for (const z of [-1, 1]) {
        const mast = add(new THREE.CylinderGeometry(0.2, 0.3, 16, 8), std('#888', 0.4, 0.6), x * 16, 4, z * 22);
        const head = add(new THREE.BoxGeometry(3, 1.5, 0.4), new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#fffbe6', emissiveIntensity: 2 }), x * 16, 12.5, z * 22); head.lookAt(0, 0, 0);
        const sp = new THREE.SpotLight(0xfff6e0, 60, 70, 0.55, 0.6, 1.2); sp.position.copy(head.position); sp.target.position.set(0, 0, 0); V.add(sp, sp.target);
      }
      this.scene.fog = new THREE.Fog(fin ? '#1b1235' : '#0a1226', 45, 120);
    } else if (id === 'v_beach') {
      sky('#ff7a59', '#ffd3a1'); this.sun.color.set(0xffb27a); this.sun.position.set(-14, 7, -18); this.sun.intensity = 2;
      table('#e6c99a', '#c4a070', '#d8b07a'); floor('#e9cf9b', 1);
      const sea = add(new THREE.PlaneGeometry(400, 160), new THREE.MeshStandardMaterial({ color: '#2b7ab0', roughness: 0.15, metalness: 0.3 }), 0, -9.2, -110); sea.rotation.x = -Math.PI / 2;
      const sunDisc = add(new THREE.CircleGeometry(9, 32), new THREE.MeshBasicMaterial({ color: '#ffe0a0', fog: false }), -30, 4, -150);
      this.scene.fog = new THREE.Fog('#ffc49a', 60, 170);
    } else if (id === 'v_rooftop') {
      sky('#060914', '#1a2340'); this.sun.intensity = 1.1; this.hemi.intensity = 0.3; table('#3a3f4a', '#222', '#1a1d24'); floor('#2a2e36', 0.9);
      const win = new THREE.MeshStandardMaterial({ color: '#0b1020', emissive: '#ffdd88', emissiveIntensity: 0.0, roughness: 0.6 });
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * Math.PI * 2, r = 45 + (i % 5) * 9, h = 10 + ((i * 37) % 30);
        const c = document.createElement('canvas'); c.width = 32; c.height = 64; const g = c.getContext('2d'); g.fillStyle = '#0b1020'; g.fillRect(0, 0, 32, 64);
        for (let y = 2; y < 64; y += 4) for (let x = 2; x < 32; x += 4) if (((x * 7 + y * 13 + i) % 5) < 2) { g.fillStyle = '#ffd98a'; g.fillRect(x, y, 2, 2); }
        const t = tex(c); const m = new THREE.MeshStandardMaterial({ color: '#111827', emissive: '#ffffff', emissiveMap: t, emissiveIntensity: 0.9, map: t });
        add(new THREE.BoxGeometry(5, h, 5), m, Math.cos(a) * r, -9 + h / 2, Math.sin(a) * r);
      }
      const tw = add(new THREE.CylinderGeometry(0.6, 2.2, 46, 8), new THREE.MeshStandardMaterial({ color: '#9aa4b8', metalness: 0.8, roughness: 0.25 }), 4, 14, -70);
      const tip = add(new THREE.SphereGeometry(0.6, 12, 12), new THREE.MeshBasicMaterial({ color: '#ff3a3a' }), 4, 38, -70); this.blink = tip;
      this.scene.fog = new THREE.Fog('#0a1022', 60, 160);
    }
  }

  // Team of paper players. look = paper item look.
  setTeams(engine, teams, kits, looks, keeperKits) {
    this.disposeGroup(this.dyn); this.pieces = [];
    const cache = new Map();
    for (const p of engine.pieces) {
      const team = teams[p.team], kit = p.isGK ? keeperKits[p.team] : kits[p.team], look = looks[p.team];
      const key = `${team.id}|${kit.id}|${p.number}|${p.name}|${look.kind}|${look.base}`;
      let mats = cache.get(key);
      if (!mats) {
        const surf = tex(paperSurface(look)), front = tex(jerseyFront(team, kit, p.number)), back = tex(jerseyBack(team, kit, p.number, p.name));
        mats = [paperMaterial(front, look, true), paperMaterial(back, look, true), paperMaterial(surf, look, false), new THREE.MeshStandardMaterial({ color: shade(look.base, -0.1), roughness: 0.9 })];
        cache.set(key, mats);
      }
      const root = new THREE.Group(), body = new THREE.Mesh(TENT, mats);
      body.castShadow = true; body.receiveShadow = true; root.add(body);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.64, 48), new THREE.MeshBasicMaterial({ color: 0xd4ff2a, transparent: true, opacity: 0, depthWrite: false, depthTest: false }));
      ring.renderOrder = 5;
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.012; root.add(ring);
      this.dyn.add(root); this.pieces.push({ root, body, ring, data: p, x: p.x, z: p.z, hop: 0, ry: 0 });
    }
  }
  setBall(look) {
    if (this.ballMesh) { this.scene.remove(this.ballMesh); this.ballMesh.geometry.dispose(); this.ballMesh.material.map.dispose(); this.ballMesh.material.dispose(); }
        this.ballLook = look;
    this.ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 32, 20), new THREE.MeshPhysicalMaterial({ map: tex(ballTexture(look)), roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2,
      emissive: look.kind === 'fire' ? '#ff5a10' : look.kind === 'galaxy' ? '#4a2aff' : '#000', emissiveIntensity: look.kind === 'fire' || look.kind === 'galaxy' ? 0.35 : 0 }));
    this.ballMesh.castShadow = true; this.scene.add(this.ballMesh);
    if (!this.ballRing) {
      this.ballRing = new THREE.Mesh(new THREE.RingGeometry(0.26, 0.33, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, depthTest: false }));
      this.ballRing.rotation.x = -Math.PI / 2; this.ballRing.renderOrder = 6; this.scene.add(this.ballRing);
    }
    this.trailPts = [];
    if (this.trailLine) this.fx.remove(this.trailLine);
    if (look.trail) { this.trailLine = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: look.trail, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide })); this.fx.add(this.trailLine); }
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

  ripple(x, z) {
    if (!this.rip) { this.rip = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.26, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false })); this.rip.rotation.x = -Math.PI / 2; this.scene.add(this.rip); }
    this.rip.position.set(x, 0.02, z); this.ripT = 0;
  }
  burst(x, y, z, colors, n = 80, speed = 6, gravity = 9, size = 0.08) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size * 1.4), new THREE.MeshBasicMaterial({ color: colors[i % colors.length], side: THREE.DoubleSide, transparent: true }));
      m.position.set(x, y, z); const a = Math.random() * Math.PI * 2, u = Math.random();
      this.fx.add(m); this.particles.push({ m, v: new THREE.Vector3(Math.cos(a) * speed * u, speed * (0.6 + Math.random()), Math.sin(a) * speed * u), spin: new THREE.Vector3(Math.random() * 9, Math.random() * 9, 0), life: 2 + Math.random(), g: gravity });
    }
  }
  goalFx(kind, x, z, teamColors) {
    if (kind === 'x_fireworks') { for (let k = 0; k < 5; k++) setTimeout(() => this.burst(x + (Math.random() - 0.5) * 6, 5 + Math.random() * 3, z, ['#ff3a3a', '#ffd45a', '#39f6ff', '#ffffff', '#b36bff'], 70, 5, 3, 0.1), k * 280); }
    else if (kind === 'x_confetti') this.burst(x, 3, z, ['#ff4f7a', '#ffd400', '#2ad4ff', '#7cff6b', '#b36bff', '#ffffff'], 160, 5, 4, 0.12);
    else this.burst(x, 0.8, z, ['#ffffff', '#f1ece0', ...teamColors], 90, 6, 9, 0.1);
  }

  update(dt, t) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]; p.life -= dt; p.v.y -= p.g * dt; p.v.multiplyScalar(1 - 0.9 * dt);
      p.m.position.addScaledVector(p.v, dt); p.m.rotation.x += p.spin.x * dt; p.m.rotation.y += p.spin.y * dt;
      if (p.m.position.y < 0.01) { p.m.position.y = 0.01; p.v.set(0, 0, 0); }
      p.m.material.opacity = Math.min(1, p.life);
      if (p.life <= 0) { this.fx.remove(p.m); p.m.geometry.dispose(); p.m.material.dispose(); this.particles.splice(i, 1); }
    }
    if (this.rip && this.ripT < 0.5) { this.ripT += dt; const s = 1 + 9 * this.ripT; this.rip.scale.set(s, s, s); this.rip.material.opacity = 0.8 * (1 - this.ripT / 0.5); }
    if (this.fan) this.fan.rotation.y += dt * 2.5;
    if (this.blink) this.blink.visible = Math.sin(t * 4) > 0;
    if (this.crowd && this.cheer > 0) {
      const m = new THREE.Matrix4(); this.cheer -= dt;
      for (let i = 0; i < this.crowdBase.length; i += 2) { const b = this.crowdBase[i]; m.makeTranslation(b.x, b.y + Math.abs(Math.sin(t * 12 + i)) * 0.5 * Math.min(1, this.cheer), b.z); this.crowd.setMatrixAt(i, m); }
      this.crowd.instanceMatrix.needsUpdate = true;
    }
  }
  render() { this.r.render(this.scene, this.cam); }
}
