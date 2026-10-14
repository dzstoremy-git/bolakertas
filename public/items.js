// items.js : Bola Kertas shop catalog. Shared by the browser and the server.
// Prices: coins (earned by playing) and/or stars (Telegram Stars). The server is the only one that grants items.

export const SLOTS = ['paper', 'pitch', 'venue', 'ball', 'fx'];

export const ITEMS = [
  // PAPER: stats change how your team plays. Power = shot speed, Weight = how hard the ball bounces off you, Control = accuracy.
  { id: 'p_a4', slot: 'paper', name: 'A4 Biasa', desc: 'Kertas pejabat. Ringan, jujur, cukup.', free: true,
    stats: { power: 100, weight: 100, control: 100 }, look: { kind: 'plain', base: '#f4f2ec', rough: 0.85 } },
  { id: 'p_news', slot: 'paper', name: 'Surat Khabar', desc: 'Ringan dan laju, tapi senang terpantul.', coins: 300,
    stats: { power: 104, weight: 92, control: 98 }, look: { kind: 'news', base: '#e2ddd0', rough: 0.95 } },
  { id: 'p_manila', slot: 'paper', name: 'Kad Manila', desc: 'Tebal sikit. Bola tak mudah lari.', coins: 800,
    stats: { power: 100, weight: 110, control: 102 }, look: { kind: 'plain', base: '#ead9a6', rough: 0.8 } },
  { id: 'p_kraft', slot: 'paper', name: 'Kraf Tebal', desc: 'Gentian kasar, tendangan padu.', stars: 15,
    stats: { power: 106, weight: 108, control: 100 }, look: { kind: 'kraft', base: '#b98a55', rough: 0.9 } },
  { id: 'p_washi', slot: 'paper', name: 'Washi Jepun', desc: 'Halus dan tepat. Untuk pemain teknikal.', stars: 59,
    stats: { power: 102, weight: 100, control: 108 }, look: { kind: 'washi', base: '#f6f1e4', rough: 0.7 } },
  { id: 'p_laminate', slot: 'paper', name: 'Bod Berlapis', desc: 'Berkilat, keras, susah ditolak.', stars: 39,
    stats: { power: 110, weight: 112, control: 104 }, look: { kind: 'laminate', base: '#ffffff', rough: 0.25, clearcoat: 1 } },
  { id: 'p_carbon', slot: 'paper', name: 'Gentian Karbon', desc: 'Kertas paling kuat dalam liga.', stars: 99, tag: 'TERKUAT',
    stats: { power: 115, weight: 110, control: 110 }, look: { kind: 'carbon', base: '#2a2d33', rough: 0.35, clearcoat: 1, metal: 0.3 } },
  { id: 'p_holo', slot: 'paper', name: 'Hologram Pelangi', desc: 'Berkilau setiap sudut. Stat biasa, gaya luar biasa.', stars: 149, tag: 'GAYA',
    stats: { power: 100, weight: 100, control: 100 }, look: { kind: 'holo', base: '#dfe6f5', rough: 0.2, iri: 1, metal: 0.6 } },
  { id: 'p_gold', slot: 'paper', name: 'Kerajang Emas 24K', desc: 'Mahal gila. Tak tambah kuat langsung. Semua orang akan nampak.', stars: 299, tag: 'PRESTIJ',
    stats: { power: 100, weight: 100, control: 100 }, look: { kind: 'gold', base: '#e8b84a', rough: 0.22, metal: 1 } },

  // PITCH: cosmetic only.
  { id: 'f_stripes', slot: 'pitch', name: 'Jalur Klasik', desc: 'Rumput dipotong lurus.', free: true, look: { a: '#3fae49', b: '#37a041', line: '#ffffff', style: 'stripes' } },
  { id: 'f_checker', slot: 'pitch', name: 'Petak Catur', desc: 'Corak petak stadium Eropah.', free: true, look: { a: '#43b04c', b: '#389f42', line: '#ffffff', style: 'checker' } },
  { id: 'f_kampung', slot: 'pitch', name: 'Tanah Merah Kampung', desc: 'Rumput botak, tanah merah, semangat petang.', coins: 600, look: { a: '#7a9a3c', b: '#6f8f35', line: '#fff6dc', style: 'worn' } },
  { id: 'f_snow', slot: 'pitch', name: 'Salji Putih', desc: 'Main bola dalam musim sejuk.', stars: 25, look: { a: '#e9f1f7', b: '#dde8f1', line: '#e0453a', style: 'snow' } },
  { id: 'f_neon', slot: 'pitch', name: 'Neon Grid', desc: 'Garisan menyala dalam gelap.', stars: 39, look: { a: '#0d1530', b: '#111b3d', line: '#39f6ff', style: 'neon' } },
  { id: 'f_gold', slot: 'pitch', name: 'Emas Final', desc: 'Padang untuk perlawanan akhir.', stars: 79, tag: 'PRESTIJ', look: { a: '#2f8f3f', b: '#2a823a', line: '#ffd45a', style: 'gold' } },

  // VENUE: the world around the table.
  { id: 'v_desk', slot: 'venue', name: 'Meja Belajar', desc: 'Kelas kosong, waktu rehat.', free: true },
  { id: 'v_field', slot: 'venue', name: 'Padang Kampung', desc: 'Langit petang, pokok kelapa.', free: true },
  { id: 'v_kopitiam', slot: 'venue', name: 'Kopitiam', desc: 'Meja marmar, kopi O, kipas siling.', coins: 1500 },
  { id: 'v_night', slot: 'venue', name: 'Stadium Malam', desc: 'Lampu limpah dan penonton bersorak.', stars: 29 },
  { id: 'v_beach', slot: 'venue', name: 'Pantai Senja', desc: 'Pasir, ombak dan matahari terbenam.', stars: 39 },
  { id: 'v_rooftop', slot: 'venue', name: 'Atas Bumbung KL', desc: 'Menara berkelip di belakang gol.', stars: 49 },
  { id: 'v_final', slot: 'venue', name: 'Stadium Final', desc: 'Pentas terbesar. Konfeti emas.', stars: 99, tag: 'PRESTIJ' },

  // BALL
  { id: 'b_classic', slot: 'ball', name: 'Bola Klasik', desc: 'Hitam putih tradisi.', free: true, look: { a: '#ffffff', b: '#151515', kind: 'classic' } },
  { id: 'b_candy', slot: 'ball', name: 'Gula Gula', desc: 'Jalur merah jambu manis.', coins: 400, look: { a: '#ffffff', b: '#ef4f7a', kind: 'candy' } },
  { id: 'b_fire', slot: 'ball', name: 'Bola Api', desc: 'Meninggalkan jejak bara.', stars: 15, look: { a: '#ffb02e', b: '#e8320c', kind: 'fire', trail: '#ff7a1a' } },
  { id: 'b_galaxy', slot: 'ball', name: 'Galaksi', desc: 'Bintang di hujung kaki.', stars: 25, look: { a: '#2a1b5e', b: '#8f6bff', kind: 'galaxy', trail: '#9f8bff' } },

  // GOAL FX
  { id: 'x_basic', slot: 'fx', name: 'Letupan Kertas', desc: 'Cebisan kertas berterbangan.', free: true },
  { id: 'x_confetti', slot: 'fx', name: 'Konfeti Pelangi', desc: 'Hujan konfeti warna warni.', stars: 10 },
  { id: 'x_fireworks', slot: 'fx', name: 'Bunga Api', desc: 'Langit menyala setiap gol.', stars: 25 },

  // PASS
  { id: 'pass_week', slot: 'pass', name: 'Pas Mingguan', desc: '7 hari: coins x2 dan lencana emas.', stars: 30, consumable: true, days: 7 },
];

export const DEFAULT_EQUIP = { paper: 'p_a4', pitch: 'f_stripes', venue: 'v_desk', ball: 'b_classic', fx: 'x_basic' };
export const itemById = id => ITEMS.find(i => i.id === id) || null;
export const freeItems = () => ITEMS.filter(i => i.free).map(i => i.id);

// Coins earned per CPU match (server computes this from a replay, never trusts the client).
export function matchReward({ won, draw, goals, skill, passActive }) {
  let c = won ? 60 : draw ? 30 : 15;
  c += Math.min(goals, 10) * 5;
  c = Math.round(c * (0.6 + 0.8 * Math.max(0, Math.min(1, skill))));
  return passActive ? c * 2 : c;
}
export const DAILY_COIN_CAP = 1500;
