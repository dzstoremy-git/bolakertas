// items.js : Bola Kertas shop catalog. Shared by the browser and the server.
// Prices: coins (earned by playing) and/or stars (Telegram Stars). The server is the only one that grants items.

export const SLOTS = ['paper', 'pitch', 'venue', 'ball', 'fx'];

export const ITEMS = [
  // PAPER: stats change how your team plays. Power = shot speed, Weight = how hard the ball bounces off you, Control = accuracy.
  { id: 'p_a4', rarity: 'common', slot: 'paper', name: 'A4 Biasa', desc: 'Kertas pejabat biasa. Ringan dan boleh diharap.', free: true,
    stats: { power: 100, weight: 100, control: 100 }, look: { kind: 'plain', base: '#f4f2ec', rough: 0.85 } },
  { id: 'p_news', rarity: 'common', slot: 'paper', name: 'Surat Khabar', desc: 'Ringan dan laju, tapi bola mudah melantun.', coins: 300,
    stats: { power: 104, weight: 92, control: 98 }, look: { kind: 'news', base: '#e2ddd0', rough: 0.95 } },
  { id: 'p_manila', rarity: 'rare', slot: 'paper', name: 'Kad Manila', desc: 'Tebal sikit. Bola senang dikawal.', coins: 800,
    stats: { power: 100, weight: 110, control: 102 }, look: { kind: 'plain', base: '#ead9a6', rough: 0.8 } },
  { id: 'p_kraft', rarity: 'rare', slot: 'paper', name: 'Kraf Tebal', desc: 'Gentian kasar untuk tendangan padu.', stars: 15,
    stats: { power: 106, weight: 108, control: 100 }, look: { kind: 'kraft', base: '#b98a55', rough: 0.9 } },
  { id: 'p_washi', rarity: 'epic', slot: 'paper', name: 'Washi Jepun', desc: 'Halus dan tepat. Sesuai untuk pemain yang suka bidik.', stars: 49,
    stats: { power: 102, weight: 100, control: 108 }, look: { kind: 'washi', base: '#f6f1e4', rough: 0.7 } },
  { id: 'p_laminate', rarity: 'epic', slot: 'paper', name: 'Bod Berlapis', desc: 'Berkilat dan keras. Susah ditolak lawan.', stars: 39,
    stats: { power: 110, weight: 112, control: 104 }, look: { kind: 'laminate', base: '#ffffff', rough: 0.25, clearcoat: 1 } },
  { id: 'p_carbon', rarity: 'legend', slot: 'paper', name: 'Gentian Karbon', desc: 'Kertas paling kuat dalam liga.', stars: 99, tag: 'TERKUAT',
    stats: { power: 115, weight: 110, control: 110 }, look: { kind: 'carbon', base: '#2a2d33', rough: 0.35, clearcoat: 1, metal: 0.3 } },
  { id: 'p_holo', rarity: 'myth', slot: 'paper', name: 'Hologram Pelangi', desc: 'Berkilau dari setiap sudut. Kuasa sama macam A4, tapi gaya lain macam.', stars: 149, tag: 'GAYA',
    stats: { power: 100, weight: 100, control: 100 }, look: { kind: 'holo', base: '#dfe6f5', rough: 0.2, iri: 1, metal: 0.6 } },
  { id: 'p_gold', rarity: 'myth', slot: 'paper', name: 'Kerajang Emas 24K', desc: 'Kilauan emas tulen. Untuk bergaya, bukan untuk lebih kuat.', stars: 249, tag: 'PRESTIJ',
    stats: { power: 100, weight: 100, control: 100 }, look: { kind: 'gold', base: '#e8b84a', rough: 0.22, metal: 1 } },

  // PITCH: cosmetic only.
  { id: 'f_stripes', rarity: 'common', slot: 'pitch', name: 'Jalur Klasik', desc: 'Rumput dipotong berjalur lurus.', free: true, look: { a: '#1f8a34', b: '#17772b', line: '#ffffff', style: 'stripes' } },
  { id: 'f_checker', rarity: 'common', slot: 'pitch', name: 'Petak Catur', desc: 'Corak petak macam stadium di Eropah.', free: true, look: { a: '#228d37', b: '#187a2c', line: '#ffffff', style: 'checker' } },
  { id: 'f_kampung', rarity: 'rare', slot: 'pitch', name: 'Tanah Merah Kampung', desc: 'Rumput botak, tanah merah, semangat petang.', coins: 600, look: { a: '#7a9a3c', b: '#6f8f35', line: '#fff6dc', style: 'worn' } },
  { id: 'f_snow', rarity: 'epic', slot: 'pitch', name: 'Salji Putih', desc: 'Main bola di tengah musim sejuk.', stars: 25, look: { a: '#e9f1f7', b: '#dde8f1', line: '#e0453a', style: 'snow' } },
  { id: 'f_neon', rarity: 'legend', slot: 'pitch', name: 'Neon Grid', desc: 'Garisan menyala dalam gelap.', stars: 39, look: { a: '#0d1530', b: '#111b3d', line: '#39f6ff', style: 'neon' } },
  { id: 'f_gold', rarity: 'myth', slot: 'pitch', name: 'Emas Final', desc: 'Padang khas untuk perlawanan akhir.', stars: 79, tag: 'PRESTIJ', look: { a: '#2f8f3f', b: '#2a823a', line: '#ffd45a', style: 'gold' } },

  // VENUE: the world around the table.
  { id: 'v_desk', rarity: 'common', slot: 'venue', name: 'Meja Belajar', desc: 'Kelas kosong, waktu rehat.', free: true },
  { id: 'v_field', rarity: 'common', slot: 'venue', name: 'Padang Kampung', desc: 'Langit petang dan pokok kelapa.', free: true },
  { id: 'v_kopitiam', rarity: 'rare', slot: 'venue', name: 'Kopitiam', desc: 'Meja marmar, kopi O dan kipas siling.', coins: 1500 },
  { id: 'v_night', rarity: 'epic', slot: 'venue', name: 'Stadium Malam', desc: 'Lampu limpah dan penonton bersorak.', stars: 29 },
  { id: 'v_beach', rarity: 'epic', slot: 'venue', name: 'Pantai Senja', desc: 'Pasir, ombak dan matahari terbenam.', stars: 39 },
  { id: 'v_rooftop', rarity: 'legend', slot: 'venue', name: 'Atas Bumbung KL', desc: 'Menara berkelip di belakang gol.', stars: 49 },
  { id: 'v_final', rarity: 'myth', slot: 'venue', name: 'Stadium Final', desc: 'Pentas terbesar. Konfeti emas.', stars: 99, tag: 'PRESTIJ' },

  // BALL
  { id: 'b_classic', rarity: 'common', slot: 'ball', name: 'Bola Klasik', desc: 'Hitam putih, rupa klasik sepanjang zaman.', free: true, look: { a: '#ffffff', b: '#151515', kind: 'classic' } },
  { id: 'b_candy', rarity: 'rare', slot: 'ball', name: 'Gula Gula', desc: 'Jalur merah jambu manis.', coins: 400, look: { a: '#ffffff', b: '#ef4f7a', kind: 'candy' } },
  { id: 'b_fire', rarity: 'epic', slot: 'ball', name: 'Bola Api', desc: 'Tinggalkan jejak bara api.', stars: 15, look: { a: '#ffb02e', b: '#e8320c', kind: 'fire', trail: '#ff7a1a' } },
  { id: 'b_crumple', rarity: 'rare', slot: 'ball', name: 'Kertas Ronyok', desc: 'Kertas latihan dironyok dan dibalut selotep. Bola sekolah yang sebenar.', coins: 500, look: { a: '#f3efe2', b: '#4670c8', kind: 'crumple' } },
  { id: 'b_rubber', rarity: 'rare', slot: 'ball', name: 'Bola Gelang Getah', desc: 'Ratusan gelang getah dililit ketat. Permainan kampung tahun 90an.', coins: 700, look: { a: '#c94a2a', b: '#f2a51a', kind: 'rubber' } },
  { id: 'b_origami', rarity: 'epic', slot: 'ball', name: 'Origami Bersegi', desc: 'Dilipat tangan, segi demi segi.', stars: 15, look: { a: '#ff6b6b', b: '#ffd93d', kind: 'origami' } },
  { id: 'b_disco', rarity: 'legend', slot: 'ball', name: 'Bola Disko', desc: 'Jubin cermin yang memantulkan lampu stadium.', stars: 25, look: { a: '#cfd6e6', b: '#ffffff', kind: 'disco' } },
  { id: 'b_galaxy', rarity: 'legend', slot: 'ball', name: 'Galaksi', desc: 'Bintang di hujung kaki anda.', stars: 25, look: { a: '#2a1b5e', b: '#8f6bff', kind: 'galaxy', trail: '#9f8bff' } },

  // GOAL FX
  { id: 'x_basic', rarity: 'common', slot: 'fx', name: 'Letupan Kertas', desc: 'Cebisan kertas berterbangan.', free: true },
  { id: 'x_confetti', rarity: 'epic', slot: 'fx', name: 'Konfeti Pelangi', desc: 'Hujan konfeti berwarna-warni.', stars: 10 },
  { id: 'x_fireworks', rarity: 'legend', slot: 'fx', name: 'Bunga Api', desc: 'Langit menyala setiap gol.', stars: 25 },


  // ── CHEAP RANGE: coins first, small Stars. Cosmetic only: every new paper plays exactly like A4.
  { id: 'p_pink', rarity: 'common', slot: 'paper', name: 'Kertas Warna Merah Jambu', desc: 'Kertas warna dari kedai buku sekolah.', coins: 150, stats: { power: 100, weight: 100, control: 100 }, look: { kind: 'plain', tint: true, base: '#ff9cc4', rough: 0.85 } },
  { id: 'p_blue', rarity: 'common', slot: 'paper', name: 'Kertas Warna Biru', desc: 'Biru langit, sejuk mata memandang.', coins: 150, stats: { power: 100, weight: 100, control: 100 }, look: { kind: 'plain', tint: true, base: '#8cc8ff', rough: 0.85 } },
  { id: 'p_green', rarity: 'common', slot: 'paper', name: 'Kertas Warna Hijau', desc: 'Hijau pucuk pisang.', coins: 150, stats: { power: 100, weight: 100, control: 100 }, look: { kind: 'plain', tint: true, base: '#9fe08a', rough: 0.85 } },
  { id: 'p_yellow', rarity: 'common', slot: 'paper', name: 'Kertas Warna Kuning', desc: 'Kuning nota lekat.', coins: 150, stats: { power: 100, weight: 100, control: 100 }, look: { kind: 'plain', tint: true, base: '#ffe066', rough: 0.85 } },
  { id: 'p_ruled', rarity: 'common', slot: 'paper', name: 'Buku Latihan', desc: 'Garisan biru, margin merah. Koyak dari belakang buku.', coins: 250, stats: { power: 100, weight: 100, control: 100 }, look: { kind: 'ruled', base: '#fbf8ef', rough: 0.85 } },
  { id: 'p_graph', rarity: 'rare', slot: 'paper', name: 'Kertas Graf', desc: 'Petak kecil untuk pemain yang suka kira sudut.', coins: 400, stats: { power: 100, weight: 100, control: 100 }, look: { kind: 'graph', base: '#f2f7f2', rough: 0.8, ink: 'rgba(40,150,110,0.5)' } },
  { id: 'p_envelope', rarity: 'rare', slot: 'paper', name: 'Sampul Surat Coklat', desc: 'Macam sampul surat pejabat. Kemas dan rasmi.', coins: 450, stats: { power: 100, weight: 100, control: 100 }, look: { kind: 'plain', tint: true, base: '#c99a5e', rough: 0.9 } },
  { id: 'p_kajang', rarity: 'rare', slot: 'paper', name: 'Kertas Kajang', desc: 'Kertas peperiksaan dengan margin di kedua-dua belah.', coins: 600, stats: { power: 100, weight: 100, control: 100 }, look: { kind: 'kajang', base: '#fdfbf4', rough: 0.85, ink: 'rgba(80,80,90,0.75)' } },

  { id: 'b_candy_blue', rarity: 'common', slot: 'ball', name: 'Gula Gula Biru', desc: 'Jalur biru pudina.', coins: 200, look: { a: '#ffffff', b: '#2f8fe8', kind: 'candy' } },
  { id: 'b_candy_green', rarity: 'common', slot: 'ball', name: 'Gula Gula Hijau', desc: 'Jalur hijau epal.', coins: 200, look: { a: '#ffffff', b: '#3fb34f', kind: 'candy' } },
  { id: 'b_candy_gold', rarity: 'common', slot: 'ball', name: 'Gula Gula Kuning', desc: 'Jalur kuning nanas.', coins: 200, look: { a: '#ffffff', b: '#f2b51a', kind: 'candy' } },
  { id: 'b_my', rarity: 'rare', slot: 'ball', name: 'Jalur Gemilang', desc: 'Merah putih biru kuning. Semangat kebangsaan.', coins: 450, look: { a: '#ffffff', b: '#cc0001', kind: 'flag' } },
  { id: 'b_news', rarity: 'common', slot: 'ball', name: 'Ronyok Surat Khabar', desc: 'Surat khabar semalam dironyok bulat.', coins: 300, look: { a: '#e2ddd0', b: '#555555', kind: 'crumple' } },
  { id: 'b_rubber_rw', rarity: 'rare', slot: 'ball', name: 'Gelang Getah Merah Putih', desc: 'Merah dan putih, dililit kemas.', coins: 450, look: { a: '#d23a2a', b: '#f4f1ea', kind: 'rubber', two: true } },
  { id: 'b_tiger', rarity: 'rare', slot: 'ball', name: 'Belang Harimau', desc: 'Oren hitam, garang di padang.', coins: 600, look: { a: '#f28c1a', b: '#1b1b1b', kind: 'candy' } },
  { id: 'b_origami_blue', rarity: 'rare', slot: 'ball', name: 'Origami Laut', desc: 'Segi biru dan putih.', stars: 5, look: { a: '#2f8fe8', b: '#e8f4ff', kind: 'origami' } },

  { id: 'f_dry', rarity: 'common', slot: 'pitch', name: 'Rumput Kering', desc: 'Musim kemarau, rumput kekuningan.', coins: 250, look: { a: '#9aa84a', b: '#8c9a40', line: '#ffffff', style: 'stripes' } },
  { id: 'f_school', rarity: 'common', slot: 'pitch', name: 'Padang Sekolah', desc: 'Garisan kapur, rumput tak rata.', coins: 300, look: { a: '#5a9a3c', b: '#4f8f35', line: '#f2efe2', style: 'worn' } },
  { id: 'f_rain', rarity: 'common', slot: 'pitch', name: 'Padang Hujan', desc: 'Basah lencun lepas hujan petang.', coins: 350, look: { a: '#1d6b33', b: '#165a2a', line: '#e8f2ff', style: 'checker' } },
  { id: 'f_blue', rarity: 'rare', slot: 'pitch', name: 'Petak Biru', desc: 'Macam gelanggang futsal biru.', coins: 600, look: { a: '#2f78c4', b: '#2869ad', line: '#ffffff', style: 'checker' } },
  { id: 'f_purple', rarity: 'rare', slot: 'pitch', name: 'Jalur Ungu', desc: 'Padang ungu yang lain dari yang lain.', coins: 750, look: { a: '#7b55d6', b: '#5a3aa8', line: '#ffe36b', style: 'stripes' } },
  { id: 'f_dusk', rarity: 'rare', slot: 'pitch', name: 'Rumput Petang', desc: 'Cahaya jingga pukul tujuh.', coins: 900, look: { a: '#8a8a2c', b: '#7a7524', line: '#ffc27a', style: 'stripes' } },

  { id: 'x_team', rarity: 'common', slot: 'fx', name: 'Letupan Warna Pasukan', desc: 'Cebisan kertas warna jersi anda.', coins: 300 },
  { id: 'x_leaves', rarity: 'common', slot: 'fx', name: 'Daun Kering', desc: 'Daun berguguran macam petang di kampung.', coins: 400 },
  { id: 'x_stars', rarity: 'rare', slot: 'fx', name: 'Hujan Bintang', desc: 'Bintang kecil turun perlahan.', coins: 800 },
  { id: 'x_balloon', rarity: 'rare', slot: 'fx', name: 'Belon', desc: 'Belon warna warni terbang ke langit.', stars: 5 },
  { id: 'x_merdeka', rarity: 'epic', slot: 'fx', name: 'Konfeti Merdeka', desc: 'Merah, putih, biru dan kuning.', stars: 8 },

  // SETS: cheaper than buying the three pieces. Wearing a full set adds its own goal effect.
  { id: 'set_night', slot: 'bundle', rarity: 'legend', name: 'Set Liga Malam', desc: 'Gentian Karbon, Neon Grid dan Atas Bumbung KL. Pakai ketiga-tiga untuk letupan neon setiap gol.', stars: 129, tag: 'JIMAT 31%',
    grants: ['p_carbon', 'f_neon', 'v_rooftop'], setFx: ['#39f6ff', '#b36bff', '#ffffff'] },
  { id: 'set_gold', slot: 'bundle', rarity: 'myth', name: 'Set Final Emas', desc: 'Kerajang Emas 24K, Emas Final dan Stadium Final. Pakai ketiga-tiga untuk hujan emas setiap gol.', stars: 299, tag: 'JIMAT 30%',
    grants: ['p_gold', 'f_gold', 'v_final'], setFx: ['#ffd45a', '#fff1b8', '#e8a917'] },


  { id: 'set_start', slot: 'bundle', rarity: 'rare', name: 'Pek Pemula', desc: 'Buku Latihan, Jalur Gemilang dan Padang Sekolah. Pakai ketiga-tiga untuk konfeti biru putih setiap gol.', stars: 5, tag: 'MURAH',
    grants: ['p_ruled', 'b_my', 'f_school'], setFx: ['#3a6fd8', '#ffffff', '#e8343f'] },

  // STUDIO: unlocks premium patterns in the Kit Studio. One-off, cosmetic.
  { id: 'k_studio', rarity: 'epic', slot: 'studio', name: 'Pek Corak Studio', desc: 'Dapatkan corak Batik, Songket, Belang Harimau dan Prisma untuk jersi anda di Studio Jersi.', stars: 25, tag: 'BARU' },


  // COINS: Stars to coins. Repeatable. Bought coins do not count toward the daily play cap.
  { id: 'c_pack1', rarity: 'common', slot: 'coins', name: 'Segenggam Coins', desc: '500 coins.', stars: 10, grantCoins: 500, consumable: true },
  { id: 'c_pack2', rarity: 'rare', slot: 'coins', name: 'Sekampit Coins', desc: '1,400 coins. Bonus 12%.', stars: 25, grantCoins: 1400, consumable: true, tag: '+12%' },
  { id: 'c_pack3', rarity: 'epic', slot: 'coins', name: 'Seguni Coins', desc: '3,000 coins. Bonus 20%.', stars: 50, grantCoins: 3000, consumable: true, tag: 'POPULAR' },
  { id: 'c_pack4', rarity: 'legend', slot: 'coins', name: 'Sepeti Coins', desc: '6,500 coins. Bonus 30%.', stars: 100, grantCoins: 6500, consumable: true, tag: 'TERBAIK' },

  // PASS
  { id: 'pass_week', rarity: 'rare', slot: 'pass', name: 'Pas Mingguan', desc: '7 hari: coins berganda dan lencana emas.', stars: 30, consumable: true, days: 7 },
];

// Each tier keeps every perk of the tiers below it. Perks are cosmetic: they never change the physics.
export const RARITY = {
  common: { rank: 0, label: 'BIASA', color: '#9aa6c4' },
  rare: { rank: 1, label: 'LUAR BIASA', color: '#3fa0ff', perks: ['Tekstur kertas lebih halus', 'Nama pemain berwarna semasa main'] },
  epic: { rank: 2, label: 'EPIK', color: '#b36bff', perks: ['Aura bercahaya di kaki pemain', 'Riak tendangan berwarna'] },
  legend: { rank: 3, label: 'LEGENDA', color: '#ffb21e', perks: ['Percikan api setiap tendangan', 'Bunyi tendangan khas', 'Bingkai emas pada papan skor'] },
  myth: { rank: 4, label: 'MITOS', color: '#ff5fd2', perks: ['Kilauan pelangi bergerak', 'Pemain terjun masuk padang', 'Sambutan gol khas'] },
};
export const rarityOf = it => RARITY[it?.rarity] || RARITY.common;
export const perksUpTo = r => Object.values(RARITY).filter(x => x.rank <= (RARITY[r]?.rank ?? 0)).flatMap(x => x.perks || []);
// A set item is "owned" when every piece in it is owned.
export const isOwned = (owned, it) => it.grants ? it.grants.every(g => owned.has(g)) : owned.has(it.id);
export const completeSet = equip => ITEMS.find(i => i.grants && i.grants.every(g => Object.values(equip).includes(g))) || null;

export const DEFAULT_EQUIP = { paper: 'p_a4', pitch: 'f_stripes', venue: 'v_desk', ball: 'b_classic', fx: 'x_basic' };
// AI side's skins when it wins the toss and plays at home: deterministic from the match seed, so the server replay agrees.
export function aiEquip(seed) {
  const pick = (slot, k) => { const l = ITEMS.filter(i => i.slot === slot); return l[((seed >>> k) ^ (seed >>> (k + 11))) % l.length].id; };
  return { ...DEFAULT_EQUIP, pitch: pick('pitch', 1), venue: pick('venue', 5), ball: pick('ball', 9) };
}
// Toss: the caller wins if the coin lands on their call. Winner kicks off and is home (their venue, pitch, ball).
export const tossResult = (call, coin) => call === coin;
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
