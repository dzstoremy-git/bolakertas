// art.js : procedural 2D art drawn on canvas. Jerseys, crests, pitch, ball, net, paper surfaces.
// Used for 3D textures and for menu thumbnails, so the menu and the match always look the same.
import { FIELD } from './engine.js';

const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; };
export const shade = (hex, k) => { // k<0 darker, k>0 lighter
  const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const t = k < 0 ? 0 : 255, p = Math.abs(k);
  r = Math.round((t - r) * p + r); g = Math.round((t - g) * p + g); b = Math.round((t - b) * p + b);
  return `rgb(${r},${g},${b})`;
};
const lum = hex => { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
export const ink = hex => lum(hex) > 0.6 ? '#141414' : '#ffffff';
function rng(seed) { let s = seed >>> 0 || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
const F = (w, sz, fam = 'Barlow Condensed') => `${w} ${sz}px "${fam}", "Arial Narrow", Arial, sans-serif`;

function pattern(g, w, h, k) {
  g.fillStyle = k.base; g.fillRect(0, 0, w, h);
  g.fillStyle = k.accent;
  switch (k.pattern) {
    case 'stripes': for (let x = w / 14; x < w; x += w / 3.5) g.fillRect(x, 0, w / 7, h); break;
    case 'pinstripes': for (let x = w / 16; x < w; x += w / 8) g.fillRect(x, 0, w / 40, h); break;
    case 'hoops': for (let y = h * 0.18; y < h; y += h / 4.2) g.fillRect(0, y, w, h / 9); break;
    case 'halves': g.fillRect(w / 2, 0, w / 2, h); break;
    case 'sash': g.beginPath(); g.moveTo(-w * 0.1, h * 0.05); g.lineTo(w * 0.2, -h * 0.05); g.lineTo(w * 1.1, h * 0.95); g.lineTo(w * 0.8, h * 1.05); g.fill(); break;
    case 'chevron': for (const y of [0.38, 0.56]) { g.beginPath(); g.moveTo(0, h * y); g.lineTo(w / 2, h * (y + 0.16)); g.lineTo(w, h * y); g.lineTo(w, h * (y + 0.08)); g.lineTo(w / 2, h * (y + 0.24)); g.lineTo(0, h * (y + 0.08)); g.fill(); } break;
    case 'gradient': { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, k.base); gr.addColorStop(1, k.accent); g.fillStyle = gr; g.fillRect(0, 0, w, h); break; }
    case 'checkers': { const s = w / 6; for (let y = 0; y < h; y += s) for (let x = 0; x < w; x += s) if (((x + y) / s) % 2 < 1) g.fillRect(x, y, s, s); break; }
    default: break;
  }
  // fabric sheen + soft fold shading so it reads as printed card, not flat colour
  const sh = g.createLinearGradient(0, 0, w, 0);
  sh.addColorStop(0, 'rgba(0,0,0,0.10)'); sh.addColorStop(0.5, 'rgba(255,255,255,0.06)'); sh.addColorStop(1, 'rgba(0,0,0,0.12)');
  g.fillStyle = sh; g.fillRect(0, 0, w, h);
}

export function crest(g, x, y, s, team) {
  const c = team.jerseys[0];
  g.save(); g.translate(x, y);
  g.beginPath(); g.moveTo(-s / 2, -s / 2); g.lineTo(s / 2, -s / 2); g.lineTo(s / 2, s * 0.05); g.quadraticCurveTo(s / 2, s * 0.42, 0, s * 0.6); g.quadraticCurveTo(-s / 2, s * 0.42, -s / 2, s * 0.05); g.closePath();
  g.fillStyle = c.accent === c.base ? shade(c.base, -0.3) : c.accent; g.fill();
  g.lineWidth = s * 0.08; g.strokeStyle = c.trim; g.stroke();
  g.fillStyle = ink(g.fillStyle.startsWith('#') ? g.fillStyle : c.accent); g.font = F(800, s * 0.36); g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(team.short.slice(0, 3), 0, s * 0.02);
  g.restore();
}

// Front of a paper player: kit, collar, crest, sponsor, big number.
export function jerseyFront(team, kit, number, w = 256, h = 320) {
  const [c, g] = mk(w, h); pattern(g, w, h, kit);
  g.fillStyle = kit.trim; g.beginPath(); g.moveTo(w * 0.36, 0); g.lineTo(w / 2, h * 0.09); g.lineTo(w * 0.64, 0); g.lineTo(w * 0.58, 0); g.lineTo(w / 2, h * 0.055); g.lineTo(w * 0.42, 0); g.fill();
  crest(g, w * 0.3, h * 0.2, w * 0.17, team);
  g.font = F(800, w * 0.075); g.fillStyle = kit.number; g.globalAlpha = 0.9; g.textAlign = 'center'; g.fillText('BOLA KERTAS', w / 2, h * 0.4); g.globalAlpha = 1;
  g.font = F(800, h * 0.42); g.textBaseline = 'alphabetic'; g.lineWidth = w * 0.025; g.strokeStyle = kit.numberOutline || 'rgba(0,0,0,0.25)';
  g.strokeText(String(number), w / 2, h * 0.88); g.fillStyle = kit.number; g.fillText(String(number), w / 2, h * 0.88);
  return c;
}
// Back of a paper player: name above number, like the reference broadcast view.
export function jerseyBack(team, kit, number, name, w = 256, h = 320) {
  const [c, g] = mk(w, h); pattern(g, w, h, kit);
  g.fillStyle = kit.trim; g.fillRect(w * 0.38, 0, w * 0.24, h * 0.03);
  g.textAlign = 'center'; g.fillStyle = kit.number;
  g.font = F(800, w * 0.15); g.fillText(String(name || '').toUpperCase().slice(0, 10), w / 2, h * 0.27);
  g.font = F(800, h * 0.5); g.lineWidth = w * 0.025; g.strokeStyle = kit.numberOutline || 'rgba(0,0,0,0.25)';
  g.strokeText(String(number), w / 2, h * 0.86); g.fillText(String(number), w / 2, h * 0.86);
  return c;
}

// Paper surface for inner faces and edges. Shows what the paper is made of.
export function paperSurface(look, w = 256, h = 256) {
  const [c, g] = mk(w, h), r = rng(7); g.fillStyle = look.base; g.fillRect(0, 0, w, h);
  if (look.kind === 'news') {
    g.fillStyle = 'rgba(30,30,30,0.55)';
    for (let col = 0; col < 3; col++) for (let y = 14; y < h; y += 7) { const x = 8 + col * (w / 3); g.fillRect(x, y, (w / 3 - 16) * (0.6 + r() * 0.4), 2.2); }
    g.font = F(800, 26); g.fillStyle = '#222'; g.fillText('BERITA', 10, 30);
  } else if (look.kind === 'kraft' || look.kind === 'washi') {
    for (let i = 0; i < (look.kind === 'kraft' ? 900 : 260); i++) {
      g.strokeStyle = look.kind === 'kraft' ? `rgba(${70 + r() * 60},${45 + r() * 30},20,${0.15 + r() * 0.2})` : `rgba(200,190,170,${0.2 + r() * 0.3})`;
      g.lineWidth = r() * 1.4; g.beginPath(); const x = r() * w, y = r() * h, a = r() * 6.28, l = 3 + r() * (look.kind === 'washi' ? 30 : 9);
      g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * l / 2 + r() * 4, y + Math.sin(a) * l / 2, x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
  } else if (look.kind === 'carbon') {
    const s = 16; for (let y = 0; y < h; y += s) for (let x = 0; x < w; x += s) {
      const gr = ((x + y) / s) % 2 < 1 ? g.createLinearGradient(x, y, x + s, y) : g.createLinearGradient(x, y, x, y + s);
      gr.addColorStop(0, '#1b1d22'); gr.addColorStop(0.5, '#4a4f58'); gr.addColorStop(1, '#1b1d22'); g.fillStyle = gr; g.fillRect(x, y, s, s);
    }
  } else if (look.kind === 'holo') {
    const gr = g.createLinearGradient(0, 0, w, h);
    ['#ffb3d9', '#b3e1ff', '#c9ffb3', '#fff3b3', '#e3b3ff', '#b3fff0'].forEach((col, i, a) => gr.addColorStop(i / (a.length - 1), col));
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  } else if (look.kind === 'gold') {
    for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(${200 + r() * 55},${150 + r() * 60},${40 + r() * 40},0.35)`; g.fillRect(r() * w, r() * h, 8 + r() * 50, 2 + r() * 6); }
  } else {
    for (let i = 0; i < 1200; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.035})`; g.fillRect(r() * w, r() * h, 1, 1); }
  }
  return c;
}

// Pitch: grass, every marking, the blue apron and its boards text.
export const APRON = 1.1;
export function pitchTexture(look, ppu = 96) {
  const W = FIELD.W + APRON * 2, L = FIELD.L + APRON * 2, [c, g] = mk(Math.round(W * ppu), Math.round(L * ppu)), r = rng(11);
  const X = x => (x + W / 2) * ppu, Z = z => (z + L / 2) * ppu, S = v => v * ppu;
  const apron = look.style === 'neon' ? '#070b1c' : look.style === 'snow' ? '#2b5f9e' : look.style === 'gold' ? '#1a2a52' : '#2f6fd6';
  g.fillStyle = apron; g.fillRect(0, 0, c.width, c.height);
  g.save(); g.beginPath(); g.rect(X(-FIELD.W / 2 - 0.25), Z(-FIELD.L / 2 - 0.25), S(FIELD.W + 0.5), S(FIELD.L + 0.5)); g.clip();
  g.fillStyle = look.a; g.fillRect(0, 0, c.width, c.height);
  const bands = 12;
  for (let i = 0; i < bands; i++) {
    const z0 = -FIELD.L / 2 + (FIELD.L / bands) * i;
    if (look.style === 'checker') { for (let j = 0; j < 8; j++) if ((i + j) % 2) { g.fillStyle = look.b; g.fillRect(X(-FIELD.W / 2 + FIELD.W / 8 * j), Z(z0), S(FIELD.W / 8) + 1, S(FIELD.L / bands) + 1); } }
    else if (i % 2) { g.fillStyle = look.b; g.fillRect(0, Z(z0), c.width, S(FIELD.L / bands) + 1); }
  }
  // grass grain
  if (look.style !== 'neon') for (let i = 0; i < 26000; i++) { g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.045)'; g.fillRect(r() * c.width, r() * c.height, 1.5, 3 + r() * 3); }
  if (look.style === 'worn') { // bald patches and red earth in the goal mouths and centre
    for (const [x, z, s] of [[0, -FIELD.L / 2 + 1, 2.2], [0, FIELD.L / 2 - 1, 2.2], [0, 0, 1.8], [-3, -4, 1], [3.5, 5, 1.2]]) {
      const gr = g.createRadialGradient(X(x), Z(z), 0, X(x), Z(z), S(s)); gr.addColorStop(0, 'rgba(176,96,52,0.95)'); gr.addColorStop(0.6, 'rgba(160,110,60,0.5)'); gr.addColorStop(1, 'rgba(160,110,60,0)');
      g.fillStyle = gr; g.fillRect(X(x - s), Z(z - s), S(s * 2), S(s * 2));
    }
  }
  if (look.style === 'snow') for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(160,190,215,${r() * 0.3})`; g.beginPath(); g.arc(r() * c.width, r() * c.height, 1 + r() * 3, 0, 7); g.fill(); }
  g.restore();
  // markings
  g.strokeStyle = look.line; g.fillStyle = look.line; g.lineWidth = S(0.075); g.lineJoin = 'round';
  if (look.style === 'neon' || look.style === 'gold') { g.shadowColor = look.line; g.shadowBlur = S(0.25); }
  const hw = FIELD.W / 2, hl = FIELD.L / 2;
  g.strokeRect(X(-hw), Z(-hl), S(FIELD.W), S(FIELD.L));
  g.beginPath(); g.moveTo(X(-hw), Z(0)); g.lineTo(X(hw), Z(0)); g.stroke();
  for (const rad of [FIELD.circle]) { g.beginPath(); g.arc(X(0), Z(0), S(rad), 0, Math.PI * 2); g.stroke(); }
  g.beginPath(); g.arc(X(0), Z(0), S(0.11), 0, 7); g.fill();
  for (const s of [-1, 1]) {
    const gz = s * hl;
    g.strokeRect(X(-FIELD.boxW / 2), Z(s > 0 ? gz - FIELD.boxD : gz), S(FIELD.boxW), S(FIELD.boxD));
    g.strokeRect(X(-FIELD.areaW / 2), Z(s > 0 ? gz - FIELD.areaD : gz), S(FIELD.areaW), S(FIELD.areaD));
    const sz = gz - s * FIELD.spot; g.beginPath(); g.arc(X(0), Z(sz), S(0.09), 0, 7); g.fill();
    const edge = gz - s * FIELD.boxD, rad = FIELD.circle * 0.85, dz = Math.abs(edge - sz);
    if (rad > dz) { const a = Math.acos(dz / rad); g.beginPath(); s > 0 ? g.arc(X(0), Z(sz), S(rad), -Math.PI / 2 - a, -Math.PI / 2 + a) : g.arc(X(0), Z(sz), S(rad), Math.PI / 2 - a, Math.PI / 2 + a); g.stroke(); }
    for (const cx of [-1, 1]) { g.beginPath(); g.arc(X(cx * hw), Z(gz), S(0.45), cx > 0 ? (s > 0 ? Math.PI : Math.PI / 2) : (s > 0 ? -Math.PI / 2 : 0), cx > 0 ? (s > 0 ? Math.PI * 1.5 : Math.PI) : (s > 0 ? 0 : Math.PI / 2)); g.stroke(); }
  }
  g.shadowBlur = 0;
  // apron lettering
  g.fillStyle = look.style === 'neon' ? '#39f6ff' : 'rgba(255,255,255,0.92)'; g.font = F(800, S(0.62)); g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const s of [-1, 1]) { g.save(); g.translate(X(s * (hw + APRON / 2 + 0.05)), Z(0)); g.rotate(s * Math.PI / 2); g.fillText('BOLA  KERTAS', 0, 0); g.restore(); }
  for (const s of [-1, 1]) for (const xx of [-4, 4]) { g.save(); g.translate(X(xx), Z(s * (hl + APRON / 2 + 0.05))); if (s > 0) g.rotate(Math.PI); g.font = F(700, S(0.4)); g.fillText('TEPUK  ·  BIDIK  ·  GOL', 0, 0); g.restore(); }
  return c;
}

export function boardTexture(text, bg, fg, w = 1024, h = 64) {
  const [c, g] = mk(w, h); const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, shade(bg, 0.15)); gr.addColorStop(1, shade(bg, -0.15));
  g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = fg; g.font = F(800, h * 0.62); g.textBaseline = 'middle';
  let x = 20; while (x < w) { g.fillText(text, x, h / 2 + 2); x += g.measureText(text).width + 60; }
  return c;
}

export function netTexture(w = 256, h = 256) {
  const [c, g] = mk(w, h); g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 4;
  const s = 16; for (let i = 0; i <= w; i += s) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); }
  return c;
}

export function ballTexture(look, w = 512, h = 256) {
  const [c, g] = mk(w, h), r = rng(3); g.fillStyle = look.a; g.fillRect(0, 0, w, h);
  if (look.kind === 'classic') {
    g.fillStyle = look.b;
    const pent = (x, y, s) => { g.beginPath(); for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / 5; g.lineTo(x + Math.cos(a) * s, y + Math.sin(a) * s); } g.fill(); };
    for (let row = 0; row < 3; row++) for (let i = 0; i < 6; i++) pent(i * w / 6 + (row % 2) * w / 12, h * (0.18 + row * 0.32), h * 0.1);
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2; for (let i = 0; i < 12; i++) { g.beginPath(); g.moveTo(i * w / 12, 0); g.lineTo(i * w / 12 + 20, h); g.stroke(); }
  } else if (look.kind === 'candy') { g.fillStyle = look.b; for (let i = 0; i < w; i += w / 8) g.fillRect(i, 0, w / 16, h); }
  else if (look.kind === 'fire') { for (let i = 0; i < 400; i++) { g.fillStyle = r() < 0.5 ? look.b : '#ffe36b'; g.globalAlpha = 0.5; g.beginPath(); g.arc(r() * w, r() * h, 4 + r() * 18, 0, 7); g.fill(); } g.globalAlpha = 1; }
  else if (look.kind === 'galaxy') { const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, look.a); gr.addColorStop(0.5, look.b); gr.addColorStop(1, look.a); g.fillStyle = gr; g.fillRect(0, 0, w, h); for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(255,255,255,${r()})`; g.fillRect(r() * w, r() * h, 1.5, 1.5); } }
  return c;
}

// Menu thumbnail: folded paper player, drawn in 2D with the same jersey art.
export function paperThumb(team, kit, number, size = 120, look = { base: '#f4f2ec' }) {
  const [c, g] = mk(size, size);
  const front = jerseyFront(team, kit, number, 128, 160);
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(size / 2, size * 0.9, size * 0.36, size * 0.06, 0, 0, 7); g.fill();
  g.fillStyle = shade(look.base, -0.25); g.beginPath(); g.moveTo(size * 0.62, size * 0.12); g.lineTo(size * 0.86, size * 0.86); g.lineTo(size * 0.7, size * 0.9); g.closePath(); g.fill();
  g.save(); g.beginPath(); g.moveTo(size * 0.62, size * 0.12); g.lineTo(size * 0.7, size * 0.9); g.lineTo(size * 0.16, size * 0.9); g.lineTo(size * 0.3, size * 0.12); g.closePath(); g.clip();
  g.drawImage(front, size * 0.16, size * 0.1, size * 0.56, size * 0.8); g.restore();
  return c;
}
