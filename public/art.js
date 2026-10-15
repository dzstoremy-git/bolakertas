// art.js : procedural 2D art drawn on canvas. Jerseys, crests, pitch, ball, net, paper surfaces.
// Used for 3D textures and for menu thumbnails, so the menu and the match always look the same.
import { FIELD } from './engine.js?v=19';

const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; };
export const shade = (hex, k) => { // k<0 darker, k>0 lighter
  const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const t = k < 0 ? 0 : 255, p = Math.abs(k);
  r = Math.round((t - r) * p + r); g = Math.round((t - g) * p + g); b = Math.round((t - b) * p + b);
  return `rgb(${r},${g},${b})`;
};
const lum = hex => { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
export const ink = hex => lum(hex) > 0.6 ? '#141414' : '#ffffff';
export function rng(seed) { let s = seed >>> 0 || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
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
    case 'holo': { const cols = ['#d61a8f', '#7a22e0', '#1560d6', '#0aa6c4', '#22b04a', '#e0a400', '#e0441a'], bw = (w + h) / 14;
      for (let i = 0, x = -h; x < w; i++, x += bw) { g.fillStyle = cols[i % cols.length]; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + bw + 1, 0); g.lineTo(x + bw + 1 + h * 0.6, h); g.lineTo(x + h * 0.6, h); g.fill(); }
      const r = rng(5); g.fillStyle = '#ffffff'; for (let i = 0; i < 70; i++) { const x = r() * w, y = r() * h, s = 1 + r() * 2.5; g.globalAlpha = 0.5 + r() * 0.5; g.fillRect(x - s, y - 0.5, s * 2, 1); g.fillRect(x - 0.5, y - s, 1, s * 2); }
      g.globalAlpha = 1; break; }
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
// Print the kit onto the actual paper: each paper kind changes how the ink sits on the front face.
// Applied after the art is drawn, so the jersey stays readable and the paper is obvious.
export function printOn(c, look) {
  const k = look?.kind; if (!k || k === 'plain' && look.base === '#f4f2ec') return c;
  const g = c.getContext('2d'), w = c.width, h = c.height, r = rng(13);
  if (k === 'news') { // newsprint: grey stock, halftone dots, columns ghosting through
    g.globalCompositeOperation = 'multiply'; g.fillStyle = '#d9d4c6'; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'source-over'; g.fillStyle = 'rgba(255,255,255,0.22)';
    const s = w / 64; for (let y = 0; y < h; y += s) for (let x = (y / s) % 2 ? s / 2 : 0; x < w; x += s) { g.beginPath(); g.arc(x, y, s * 0.28, 0, 7); g.fill(); }
    g.fillStyle = 'rgba(20,20,20,0.16)'; for (let col = 0; col < 4; col++) for (let y = h * 0.04; y < h; y += h / 70) g.fillRect(w * 0.03 + col * w / 4, y, (w / 4 - w * 0.05) * (0.55 + r() * 0.45), h / 260);
    g.font = F(800, w * 0.09); g.fillStyle = 'rgba(20,20,20,0.18)'; g.textAlign = 'left'; g.fillText('BERITA HARIAN', w * 0.05, h * 0.995);
  } else if (k === 'plain' || k === 'kraft' || k === 'washi') { // tinted stock + fibres: ink soaks in
    g.globalCompositeOperation = 'multiply'; g.fillStyle = k === 'kraft' ? '#c99a62' : k === 'washi' ? '#f3ecdc' : '#e8c98a'; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'source-over';
    const n = k === 'kraft' ? 2600 : k === 'washi' ? 520 : 900;
    for (let i = 0; i < n; i++) {
      g.strokeStyle = k === 'kraft' ? `rgba(${60 + r() * 50},${38 + r() * 25},14,${0.18 + r() * 0.25})` : k === 'washi' ? `rgba(255,252,240,${0.25 + r() * 0.35})` : `rgba(120,85,30,${0.14 + r() * 0.18})`;
      g.lineWidth = (k === 'washi' ? 0.8 : 0.6) + r() * (w / 300); const x = r() * w, y = r() * h, a = r() * 6.28, l = (k === 'washi' ? w / 6 : w / 40) * (0.4 + r());
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * l / 2 + r() * 6, y + Math.sin(a) * l / 2 + r() * 6, x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    if (k === 'washi') { g.fillStyle = 'rgba(255,250,235,0.9)'; for (let x = 0; x < w; x += w / 90) { g.fillRect(x, 0, w / 90, h * (0.004 + r() * 0.012)); g.fillRect(x, h - h * (0.004 + r() * 0.012), w / 90, h); } }
  } else if (k === 'laminate') { // gloss film: deeper colour + a hard light streak
    g.globalCompositeOperation = 'saturation'; g.fillStyle = 'hsl(0,100%,50%)'; g.globalAlpha = 0.25; g.fillRect(0, 0, w, h); g.globalAlpha = 1;
    g.globalCompositeOperation = 'screen'; const gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0.12, 'rgba(255,255,255,0)'); gr.addColorStop(0.17, 'rgba(255,255,255,0.5)'); gr.addColorStop(0.19, 'rgba(255,255,255,0.05)'); gr.addColorStop(0.23, 'rgba(255,255,255,0.3)'); gr.addColorStop(0.27, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h); g.globalCompositeOperation = 'source-over';
  } else if (k === 'gold') { // brushed foil: fine horizontal brushing, then engrave the art as relief
    const lum = (look.mask || c).getContext('2d').getImageData(0, 0, w, h).data;
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#b97c10'); gr.addColorStop(0.35, '#f7d36a'); gr.addColorStop(0.55, '#d9a227'); gr.addColorStop(0.8, '#fbe39a'); gr.addColorStop(1, '#a8700c');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 1) { g.fillStyle = `rgba(${r() < 0.5 ? '255,240,190' : '90,55,0'},${0.04 + r() * 0.07})`; g.fillRect(0, y, w, 1); }
    // relief from the original art's luminance: dark = recessed, light = raised
    const img = g.getImageData(0, 0, w, h), d = img.data, at = (x, y) => { const i = (Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4; return (lum[i] * 0.3 + lum[i + 1] * 0.59 + lum[i + 2] * 0.11) / 255; };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const e = (at(x - 3, y - 3) - at(x + 3, y + 3)) * 190, i = (y * w + x) * 4, dark = at(x, y) * 26;
      d[i] = Math.max(0, Math.min(255, d[i] + e - dark)); d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + e - dark)); d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + e * 0.6 - dark)); }
    g.putImageData(img, 0, 0);
  } else if (k === 'carbon') { // fine 2x2 twill, darkened kit, ink stays bright
    const tw = document.createElement('canvas'), s = Math.round(w / 48); tw.width = tw.height = s * 2; const t = tw.getContext('2d');
    for (const [x, y, hor] of [[0, 0, 1], [s, 0, 0], [0, s, 0], [s, s, 1]]) { const gr = hor ? t.createLinearGradient(x, y, x, y + s) : t.createLinearGradient(x, y, x + s, y); gr.addColorStop(0, '#202329'); gr.addColorStop(0.5, '#c6ccd6'); gr.addColorStop(1, '#202329'); t.fillStyle = gr; t.fillRect(x, y, s, s); }
    g.globalCompositeOperation = 'multiply'; g.fillStyle = '#7a808a'; g.fillRect(0, 0, w, h);
    g.globalAlpha = 0.55; g.fillStyle = g.createPattern(tw, 'repeat'); g.fillRect(0, 0, w, h); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }
  return c;
}

export function jerseyFront(team, kit, number, w = 512, h = 640, look) {
  if (look?.kind === 'gold' && !look.mask) { const flat = { ...kit, base: '#000000', accent: '#000000', trim: '#ffffff', number: '#ffffff', numberOutline: '#ffffff', pattern: 'none' };
    const m = jerseyFront({ ...team, jerseys: [{ ...team.jerseys[0], accent: '#ffffff', base: '#000000', trim: '#ffffff' }] }, flat, number, w, h, null); look = { ...look, mask: m }; }
  const [c, g] = mk(w, h); pattern(g, w, h, kit);
  g.fillStyle = kit.trim; g.beginPath(); g.moveTo(w * 0.36, 0); g.lineTo(w / 2, h * 0.09); g.lineTo(w * 0.64, 0); g.lineTo(w * 0.58, 0); g.lineTo(w / 2, h * 0.055); g.lineTo(w * 0.42, 0); g.fill();
  crest(g, w * 0.3, h * 0.2, w * 0.17, team);
  g.font = F(800, w * 0.075); g.fillStyle = kit.number; g.globalAlpha = 0.9; g.textAlign = 'center'; g.fillText('BOLA KERTAS', w / 2, h * 0.4); g.globalAlpha = 1;
  g.font = F(800, h * 0.42); g.textBaseline = 'alphabetic'; g.lineWidth = w * 0.025; g.strokeStyle = kit.numberOutline || 'rgba(0,0,0,0.25)';
  g.strokeText(String(number), w / 2, h * 0.88); g.fillStyle = kit.number; g.fillText(String(number), w / 2, h * 0.88);
  printOn(c, look); // paper under the ink
  if (look?.kind === 'holo') { // foil washes light art out: dark plate under crest + wordmark
    g.save(); g.shadowColor = 'rgba(10,0,30,0.9)'; g.shadowBlur = w * 0.03; g.fillStyle = 'rgba(15,5,40,0.55)';
    g.beginPath(); g.roundRect(w * 0.17, h * 0.1, w * 0.27, h * 0.22, w * 0.03); g.fill(); g.beginPath(); g.roundRect(w * 0.15, h * 0.34, w * 0.7, h * 0.08, w * 0.02); g.fill(); g.restore();
    crest(g, w * 0.3, h * 0.2, w * 0.17, team); g.font = F(800, w * 0.075); g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.fillText('BOLA KERTAS', w / 2, h * 0.4); }
  if (look?.kind === 'carbon') { g.font = F(800, h * 0.42); g.textAlign = 'center'; g.fillStyle = '#ffffff'; g.fillText(String(number), w / 2, h * 0.88); crest(g, w * 0.3, h * 0.2, w * 0.17, team); }
  return c;
}
// Back of a paper player: name above number, like the reference broadcast view.
export function jerseyBack(team, kit, number, name, w = 512, h = 640, look) {
  if (look?.kind === 'gold' && !look.mask) look = { ...look, mask: jerseyBack(team, { ...kit, base: '#000000', accent: '#000000', trim: '#ffffff', number: '#ffffff', numberOutline: '#ffffff', pattern: 'none' }, number, name, w, h, null) };
  const [c, g] = mk(w, h); pattern(g, w, h, kit);
  g.fillStyle = kit.trim; g.fillRect(w * 0.38, 0, w * 0.24, h * 0.03);
  g.textAlign = 'center'; g.fillStyle = kit.number;
  g.font = F(800, w * 0.15); g.fillText(String(name || '').toUpperCase().slice(0, 10), w / 2, h * 0.27);
  g.font = F(800, h * 0.5); g.lineWidth = w * 0.025; g.strokeStyle = kit.numberOutline || 'rgba(0,0,0,0.25)';
  g.strokeText(String(number), w / 2, h * 0.86); g.fillText(String(number), w / 2, h * 0.86);
  printOn(c, look);
  if (look?.kind === 'carbon') { g.fillStyle = '#ffffff'; g.font = F(800, w * 0.15); g.fillText(String(name || '').toUpperCase().slice(0, 10), w / 2, h * 0.27); g.font = F(800, h * 0.5); g.fillText(String(number), w / 2, h * 0.86); }
  return c;
}

// Paper surface for inner faces and edges. Shows what the paper is made of.
export function paperSurface(look, w = 512, h = 512) {
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
      const gr = g.createRadialGradient(X(x), Z(z), 0, X(x), Z(z), S(s)); gr.addColorStop(0, 'rgba(168,74,38,1)'); gr.addColorStop(0.55, 'rgba(176,96,52,0.75)'); gr.addColorStop(1, 'rgba(160,110,60,0)');
      g.fillStyle = gr; g.fillRect(X(x - s), Z(z - s), S(s * 2), S(s * 2));
    }
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${120 + r() * 50},${70 + r() * 30},40,0.55)`; g.beginPath(); g.ellipse(r() * c.width, r() * c.height, S(0.04 + r() * 0.08), S(0.03 + r() * 0.05), r() * 3, 0, 7); g.fill(); } // pebbles
    for (let i = 0; i < 2600; i++) { g.strokeStyle = `rgba(${40 + r() * 40},${90 + r() * 50},30,0.5)`; g.lineWidth = 1.2; const x = r() * c.width, y = r() * c.height; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 6, y - 4 - r() * 8); g.stroke(); } // grass tufts
  }
  if (look.style === 'snow') { // drifts, sparkle, boot prints
    for (let i = 0; i < 40; i++) { const x = r() * c.width, y = r() * c.height, s = S(0.6 + r() * 1.6), gr = g.createRadialGradient(x, y, 0, x, y, s); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(x - s, y - s, s * 2, s * 2); }
    for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(150,180,210,${r() * 0.3})`; g.beginPath(); g.arc(r() * c.width, r() * c.height, 1 + r() * 3, 0, 7); g.fill(); }
    for (let i = 0; i < 1500; i++) { g.fillStyle = 'rgba(255,255,255,0.95)'; g.fillRect(r() * c.width, r() * c.height, 1.5, 1.5); }
    for (let t = 0; t < 3; t++) { let x = X((r() - 0.5) * 8), y = Z((r() - 0.5) * 14); const a = r() * 6.28; for (let k = 0; k < 10; k++) { g.fillStyle = 'rgba(120,150,185,0.35)'; g.beginPath(); g.ellipse(x + (k % 2 ? S(0.1) : -S(0.1)), y, S(0.06), S(0.11), a, 0, 7); g.fill(); x += Math.cos(a) * S(0.3); y += Math.sin(a) * S(0.3); } }
  }
  g.restore();
  // markings
  g.strokeStyle = look.line; g.fillStyle = look.line; g.lineWidth = S(0.075); g.lineJoin = 'round'; if (look.style === 'worn') g.setLineDash([S(0.6), S(0.12), S(0.3), S(0.18)]); // hand-painted, faded
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
  g.shadowBlur = 0; g.setLineDash([]);
  if (look.style === 'gold') { // final crest: laurel ring + star in the centre circle, gold double lines
    g.strokeStyle = 'rgba(120,80,0,0.8)'; g.lineWidth = S(0.03); g.strokeRect(X(-hw) + S(0.08), Z(-hl) + S(0.08), S(FIELD.W) - S(0.16), S(FIELD.L) - S(0.16));
    g.save(); g.translate(X(0), Z(0)); g.fillStyle = '#ffd45a'; g.shadowColor = '#ffb000'; g.shadowBlur = S(0.2);
    for (let i = 0; i < 24; i++) { g.save(); g.rotate(i / 24 * Math.PI * 2); g.beginPath(); g.ellipse(0, -S(FIELD.circle * 0.72), S(0.08), S(0.2), 0.5, 0, 7); g.fill(); g.restore(); }
    g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? S(0.3) : S(0.7); g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } g.fill(); g.restore(); g.shadowBlur = 0;
  }
  if (look.style === 'neon') { // faint holo grid under the bright lines
    g.strokeStyle = 'rgba(57,246,255,0.12)'; g.lineWidth = S(0.02); for (let x = -hw; x <= hw; x += 1) { g.beginPath(); g.moveTo(X(x), Z(-hl)); g.lineTo(X(x), Z(hl)); g.stroke(); } for (let z = -hl; z <= hl; z += 1) { g.beginPath(); g.moveTo(X(-hw), Z(z)); g.lineTo(X(hw), Z(z)); g.stroke(); }
    g.strokeStyle = 'rgba(255,79,216,0.7)'; g.lineWidth = S(0.05); g.shadowColor = '#ff4fd8'; g.shadowBlur = S(0.25); g.beginPath(); g.arc(X(0), Z(0), S(FIELD.circle * 0.55), 0, 7); g.stroke(); g.shadowBlur = 0;
  }
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

export function ballTexture(look, w = 1024, h = 512) {
  const [c, g] = mk(w, h), r = rng(3); g.fillStyle = look.a; g.fillRect(0, 0, w, h);
  if (look.kind === 'classic') {
    g.fillStyle = look.b;
    const pent = (x, y, s) => { g.beginPath(); for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / 5; g.lineTo(x + Math.cos(a) * s, y + Math.sin(a) * s); } g.fill(); };
    for (let row = 0; row < 3; row++) for (let i = 0; i < 6; i++) pent(i * w / 6 + (row % 2) * w / 12, h * (0.18 + row * 0.32), h * 0.1);
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 3; for (let i = 0; i < 12; i++) { g.beginPath(); g.moveTo(i * w / 12, 0); g.lineTo(i * w / 12 + 40, h); g.stroke(); }
  } else if (look.kind === 'candy') { // twisted peppermint swirl + gloss + sugar speckles
    for (let i = -8; i < 16; i++) { g.fillStyle = i % 2 ? look.b : '#ffffff'; g.beginPath(); g.moveTo(i * w / 8, 0); g.lineTo(i * w / 8 + w / 16, 0); g.lineTo(i * w / 8 + w / 16 + w * 0.5, h); g.lineTo(i * w / 8 + w * 0.5, h); g.fill(); }
    g.fillStyle = '#ffd1e0'; for (let i = 0; i < 9; i++) { g.globalAlpha = 0.5; g.fillRect(i * w / 9 + 10, 0, 5, h); } g.globalAlpha = 1;
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(255,255,255,${0.4 + r() * 0.6})`; g.fillRect(r() * w, r() * h, 2, 2); }
  } else if (look.kind === 'fire') { // molten core: dark crust cracks over glowing lava
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#ffe36b'); gr.addColorStop(0.5, '#ff7a1a'); gr.addColorStop(1, '#e8320c'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = '#2a0c04'; for (let i = 0; i < 70; i++) { const x = r() * w, y = r() * h, s = 30 + r() * 70; g.beginPath(); for (let k = 0; k < 7; k++) { const a = k / 7 * 6.28, rr = s * (0.6 + r() * 0.5); g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.7); } g.fill(); }
    g.strokeStyle = '#ffd34a'; g.lineWidth = 3; g.shadowColor = '#ff8a00'; g.shadowBlur = 10; for (let i = 0; i < 40; i++) { g.beginPath(); let x = r() * w, y = r() * h; g.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (r() - 0.5) * 60; y += (r() - 0.5) * 40; g.lineTo(x, y); } g.stroke(); } g.shadowBlur = 0;
  } else if (look.kind === 'galaxy') { // nebula clouds + star field + a spiral arm
    g.fillStyle = '#0a0620'; g.fillRect(0, 0, w, h);
    for (const [c1, n] of [['rgba(143,107,255,0.25)', 26], ['rgba(57,246,255,0.16)', 16], ['rgba(255,95,210,0.16)', 14]]) for (let i = 0; i < n; i++) { const x = r() * w, y = r() * h, s = 40 + r() * 140, gg = g.createRadialGradient(x, y, 0, x, y, s); gg.addColorStop(0, c1); gg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gg; g.fillRect(x - s, y - s, s * 2, s * 2); }
    for (let i = 0; i < 1400; i++) { const b = r(); g.fillStyle = `rgba(255,255,255,${0.3 + b * 0.7})`; g.fillRect(r() * w, r() * h, b > 0.96 ? 3 : 1.5, b > 0.96 ? 3 : 1.5); }
    for (let i = 0; i < 18; i++) { const x = r() * w, y = r() * h; g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x - 7, y); g.lineTo(x + 7, y); g.moveTo(x, y - 7); g.lineTo(x, y + 7); g.stroke(); }
  }
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
