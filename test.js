// test.js : one runnable check for the engine and the money/security paths. node test.js
process.env.NODE_ENV = 'test'; process.env.BOT_TOKEN = '123:TEST'; process.env.DATA_DIR = '/tmp/bk-test-' + process.pid;
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Engine, runToRest, BASE_STATS, checksum, predictPath, FIELD } from './public/engine.js';
import * as E from './public/engine.js';
const S = await import('./server.js');
const I = await import('./public/i18n.js');
const K = await import('./public/rank.js');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok', name); };

const setup = (seed, paper) => S.buildSetup({ team0: 'jdt', team1: 'sel', seed, minutes: 1, skill: 0.5, cpu: [true, true], paper0: paper });
const playOut = st => { const e = new Engine(st); runToRest(e); let g = 0; while (e.phase !== 'over' && g++ < 3000) { e._applyAction(e.phase === 'halftime' ? { t: 'half' } : e.cpuAction()); runToRest(e); } return e; };

ok('cpu vs cpu match reaches full time', () => { const e = playOut(setup(1)); assert.equal(e.phase, 'over'); assert.ok(e.shots > 10); });
ok('engine is deterministic', () => { assert.equal(checksum(playOut(setup(42))), checksum(playOut(setup(42)))); });
ok('paper power changes the shot', () => {
  const dist = paper => { const e = new Engine(setup(7, paper)); runToRest(e); const z0 = e.ball.z; e._applyAction({ t: 'aim', dx: 0.3, dz: e.attackSign(e.turnTeam), power: 0.5, shot: 0 }); for (let i = 0; i < 20; i++) e.step(1 / 120); return Math.abs(e.ball.z - z0); };
  assert.ok(dist({ ...BASE_STATS, power: 115 }) > dist(BASE_STATS) * 1.05);
});
ok('trajectory preview lands on the pitch', () => { const e = new Engine(setup(3)); runToRest(e); const p = predictPath(e, 0, 1, 0.6, 2, false); assert.ok(p.pts.length > 5 && p.land && Math.abs(p.land.x) < FIELD.W); });


// ── v31 gameplay: curve, smarter keeper, penalties, power strike, formations, protocol
ok('curve bends toward the goal it attacks', () => {
  const e = new Engine(setup(11)); runToRest(e); const s = e.attackSign(e.turnTeam);
  const st = predictPath(e, 0.35, s, 0.7, 1), cv = predictPath(e, 0.35, s, 0.7, 3);
  assert.ok(Math.abs(cv.end.x) < Math.abs(st.end.x) - 0.3, `curve ${cv.end.x} vs chip ${st.end.x}`);
});
ok('keeper: fewer goals than a line-slider, still scores', () => {
  let g = 0; for (let i = 1; i <= 12; i++) { const e = playOut(setup(i * 101)); g += e.score[0] + e.score[1]; }
  assert.ok(g / 12 > 1 && g / 12 < 9, 'goals per match ' + g / 12);
});
ok('penalties: shootout ends with a winner and human keeper must pick first', () => {
  for (let s = 1; s <= 30; s++) { const e = new Engine({ seed: s, drill: 'penalties', cpu: [true, true], cpuSkill: 0.5 }); runToRest(e); let g = 0;
    while (e.phase !== 'over' && g++ < 200) { e._applyAction(e.cpuAction()); runToRest(e); }
    assert.equal(e.phase, 'over'); assert.notEqual(e.winner, null); assert.ok(e.kicks[0].length >= 3); }
  const e = new Engine({ seed: 5, drill: 'penalties', cpu: [true, false] }); runToRest(e);
  assert.equal(e._applyAction({ t: 'aim', dx: 0, dz: 1, power: 0.8, shot: 0 }), false);
  assert.equal(e._applyAction({ t: 'keep', pick: 'sideways' }), false);
  assert.equal(e._applyAction({ t: 'keep', pick: 'left' }), true);
  assert.equal(e._applyAction(e.cpuAction()), true);
});
ok('penalty match replays on the server for rewards', () => {
  const st = S.buildSetup({ team0: 'jdt', team1: 'sel', seed: 77, skill: 0.5, drill: 'penalties' }); assert.equal(st.drill, 'penalties');
  const e = new Engine(st); runToRest(e); const log = []; let g = 0;
  while (e.phase !== 'over' && g++ < 200) { let a; if (st.cpu[e.turnTeam] && !e.needPick) a = e.cpuAction(); else if (e.needPick) a = { t: 'keep', pick: 'middle' }; else a = { t: 'aim', dx: 0.1, dz: 1, power: 0.85, shot: 0 };
    if (!(st.cpu[e.turnTeam] && !e.needPick)) log.push(a); e._applyAction(a); runToRest(e); }
  const r = S.replayCpuMatch(st, log); assert.ok(r); assert.deepEqual(r.score, e.score);
});
ok('power strike meter: clean pass +1, goal +2, blast knocks cards and woodwork gives goal kick', () => {
  const e = new Engine(setup(21)); runToRest(e); const k = e.kicker; k.charge = 0;
  e.lastTapper = k; e.cleanPass = true; const mate = e.pieces.find(p => p.team === k.team && p !== k && !p.isGK); e.creditPass(mate); assert.equal(k.charge, 1);
  e.cleanPass = false; e.creditPass(mate); assert.equal(k.charge, 1);
  const f = new Engine(setup(22)); runToRest(f); f.kicker.charge = 5; const s = f.attackSign(f.turnTeam);
  f.placeBall(0, s * 2); f.startAim(f.kicker); f.kicker.charge = 5;
  for (const p of f.pieces) if (p !== f.kicker && !p.isGK) { p.home = { x: 0, z: s * 4 }; break; }
  f.startAim(f.kicker); f.kicker.charge = 5; const blocker = f.pieces.find(p => p !== f.kicker && p.team !== f.turnTeam && !p.isGK); blocker.x = 0; blocker.z = s * 5;
  f._applyAction({ t: 'aim', dx: 0, dz: s, power: 1, shot: 0, ps: true }); let n = 0; while (f.phase === 'rolling' && n++ < 600) f.step(1 / 60);
  assert.ok(blocker.down || f.phase === 'goal' || f.phase === 'dead');
  const w = new Engine(setup(23)); runToRest(w); w.power = true; w.woodwork(w.attackSign(w.turnTeam) * FIELD.L / 2); runToRest(w); assert.equal(w.setPiece, 'goalkick');
});
ok('mid-game formation: own turn only, validated, keeps meters', () => {
  const e = new Engine(setup(31)); runToRest(e); const t = e.turnTeam, sq = e.squadOf(t); sq[3].charge = 4;
  const order = sq.map((_, i) => i); [order[0], order[1]] = [order[1], order[0]];
  assert.equal(e._applyAction({ t: 'lineup', formation: '9-9-9', order }), false);
  assert.equal(e._applyAction({ t: 'lineup', formation: '4-3-3', order: [0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9] }), false);
  assert.equal(e._applyAction({ t: 'lineup', formation: '4-3-3', order }), true);
  assert.equal(e.opts.formations[t], '4-3-3'); assert.equal(sq[1].isGK, true); assert.equal(sq[0].isGK, false); assert.equal(sq[3].charge, 4);
  const f = new Engine(setup(31)); runToRest(f); f.importState(e.exportState()); assert.equal(checksum(f), checksum(e)); assert.equal(f.opts.formations[t], '4-3-3');
  assert.equal(e._applyAction({ t: 'lineup', formation: '4-4-2', order: e.startLineup(t).order }), true);
});
ok('server replay rewards only a real finished match', () => {
  const st = S.buildSetup({ team0: 'jdt', team1: 'sel', seed: 9, minutes: 1, skill: 0.25 });
  const e = new Engine(st); runToRest(e); const log = []; let g = 0;
  while (e.phase !== 'over' && g++ < 3000) {
    let a; if (e.phase === 'halftime') a = { t: 'half' }; else if (st.cpu[e.turnTeam]) a = e.cpuAction(); else { const s = e.attackSign(e.turnTeam), dx = -e.ball.x, dz = s * FIELD.L / 2 - e.ball.z, l = Math.hypot(dx, dz); a = { t: 'aim', dx: dx / l, dz: dz / l, power: 0.7, shot: g % 3 }; log.push(a); }
    e._applyAction(a); runToRest(e);
  }
  const r = S.replayCpuMatch(st, log); assert.ok(r); assert.deepEqual(r.score, e.score);
  assert.equal(S.replayCpuMatch(st, log.slice(0, 3)), null);
});

const TOKEN = '123:TEST';
const signInit = (user, age = 0) => {
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000) - age), query_id: 'x', user: JSON.stringify(user) });
  const dcs = [...p.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const key = createHmac('sha256', 'WebAppData').update(TOKEN).digest(); p.set('hash', createHmac('sha256', key).update(dcs).digest('hex')); return p.toString();
};
ok('initData: valid accepted, tampered/expired/wrong token rejected', () => {
  const good = signInit({ id: 77, first_name: 'Ali' });
  assert.equal(S.verifyInitData(good, TOKEN).uid, 77);
  assert.equal(S.verifyInitData(good.replace('Ali', 'Abu'), TOKEN), null);
  assert.equal(S.verifyInitData(signInit({ id: 77 }, 90000), TOKEN), null);
  assert.equal(S.verifyInitData(good, '999:OTHER'), null);
});
ok('invoice payload is <=128 bytes, signed, bound to user and item', () => {
  const p = S.makePayload('p_gold', 1234567890123); assert.ok(Buffer.byteLength(p) <= 128);
  assert.equal(S.readPayload(p).uid, 1234567890123);
  assert.equal(S.readPayload(p.replace('p_gold', 'p_holo')), null);
  assert.equal(S.readPayload(p.replace('1234567890123', '1234567890124')), null);
});
ok('stars fulfilment is exactly once and checks amount', () => {
  assert.equal(S.fulfill('ch1', 5, 'p_gold', 1).ok, false);
  assert.equal(S.fulfill('ch1', 5, 'p_gold', 249).ok, true);
  assert.equal(S.fulfill('ch1', 5, 'p_gold', 249).dup, true);
  assert.equal(S.fulfill('ch1', 6, 'p_gold', 249).ok, false);
  assert.equal(S.db.prepare('SELECT COUNT(*) c FROM owned WHERE uid=5').get().c, 1);
  S.fulfill('ch2', 5, 'pass_week', 30); S.fulfill('ch3', 5, 'pass_week', 30);
  const until = S.db.prepare('SELECT pass_until FROM users WHERE uid=5').get().pass_until; assert.ok(until > Date.now() + 13 * 86400e3);
});
ok('coin packs: Stars buy coins once per charge, repeatable, outside the daily play cap', () => {
  const { itemById: I, ITEMS: L } = S.catalog;
  const packs = L.filter(i => i.slot === 'coins'); assert.ok(packs.length >= 4 && packs.every(p => p.stars && p.grantCoins && p.consumable));
  S.db.prepare('INSERT OR IGNORE INTO users (uid,coins,equip) VALUES (9031,0,\'{}\')').run();
  assert.equal(S.fulfill('cp1', 9031, 'c_pack1', 9).ok, false);
  assert.equal(S.fulfill('cp1', 9031, 'c_pack1', I('c_pack1').stars).ok, true);
  assert.equal(S.fulfill('cp1', 9031, 'c_pack1', I('c_pack1').stars).dup, true);
  assert.equal(S.fulfill('cp2', 9031, 'c_pack1', I('c_pack1').stars).ok, true);
  const u = S.db.prepare('SELECT coins, day_coins FROM users WHERE uid=9031').get();
  assert.equal(u.coins, I('c_pack1').grantCoins * 2); assert.equal(u.day_coins, 0);
  assert.equal(S.db.prepare('SELECT COUNT(*) c FROM owned WHERE uid=9031').get().c, 0);
  assert.ok(S.readPayload(S.makePayload('c_pack4', 9031)));
});
ok('bot rich text in ms/en/ru: balanced HTML, escaped user input, no em dash, AI not CPU', () => {
  for (const lang of ['ms', 'en', 'ru']) {
  const snap = { lang, name: '<b>Ali & Abu</b>', coins: 1234, owned: 3, items: 60, equip: { paper: 'p_a4', ball: 'b_classic' }, pass: '' };
  const pages = [S.botText('start', snap), S.botText('coins', snap), S.botText('profile', snap), S.botText('help', { lang }), S.botText('support', { lang }), S.botText('terms', { lang }),
    S.botText('paid', { lang, ok: true, item: S.catalog.itemById('c_pack2'), charge: 'stxt<1>', coins: 2634 }), S.botText('paid', { lang, ok: true, item: S.catalog.itemById('p_gold'), charge: 'x' }), S.botText('paid', { lang, ok: false, charge: 'y' }), S.botText('owns', { lang, item: S.catalog.itemById('p_gold') })];
  if (lang === 'ru') for (const t of pages) assert.ok(/[а-я]/i.test(t), 'russian ' + t.slice(0, 40));
  if (lang !== 'ms') for (const t of pages) assert.ok(!/\b(anda|untuk|dalam|Bayaran)\b/.test(t), lang + ' leaks malay: ' + t.slice(0, 60));
  for (const t of pages) {
    assert.ok(t.length > 20 && t.length < 4096);
    assert.ok(!t.includes('—') && !/CPU/.test(t), t.slice(0, 60));
    const stack = []; for (const [, close, tag] of t.matchAll(/<(\/?)(b|i|code|blockquote)(?: expandable)?>/g)) { if (close) assert.equal(stack.pop(), tag); else stack.push(tag); } assert.equal(stack.length, 0);
    assert.ok(!/<(?!\/?(b|i|code|blockquote)( expandable)?>)/.test(t), 'only allowed tags');
  }
  assert.ok(pages[0].includes('&lt;b&gt;Ali &amp; Abu&lt;/b&gt;')); assert.ok(pages[6].includes('stxt&lt;1&gt;')); assert.ok(/\+1[,\s\u00a0]400/.test(pages[6]), pages[6]);
  }
});
ok('i18n: every key and every item has ms/en/ru, no em dash, no developer words', () => {
  for (const k of I.KEYS) for (const l of I.LANGS) { const s = I.tr(l, k); assert.ok(s && s !== k, k + ' ' + l); assert.ok(!s.includes('—'), k); assert.ok(!/\b(HUD|render|enjin|stat|CPU|invois|ralat)\b/i.test(s), k + ': ' + s); }
  for (const it of S.catalog.ITEMS) { assert.ok(I.ITEM_IDS.includes(it.id), 'missing translation ' + it.id); assert.ok(I.itemDesc(it, 'en') !== it.desc || it.slot === 'coins', 'en desc ' + it.id); }
  for (const it of S.catalog.ITEMS) assert.ok(/[а-я]/i.test(I.itemName(it, 'ru')) || /^[A-Z0-9 ]+$/.test(I.itemName(it, 'ru')), it.id);
  assert.equal(I.langFrom('ru'), 'ru'); assert.equal(I.langFrom('uk'), 'ru'); assert.equal(I.langFrom('ms'), 'ms'); assert.equal(I.langFrom('id'), 'ms'); assert.equal(I.langFrom('en'), 'en'); assert.equal(I.langFrom('de'), 'en'); assert.equal(I.langFrom(''), 'ms');
  assert.equal(I.trMs('en', '3 TENDANGAN HABIS'), '3 KICKS USED'); assert.equal(I.trMs('ru', 'GOL!'), 'ГОЛ!'); assert.equal(I.trMs('ms', 'GOL!'), 'GOL!');
});
ok('cheap catalog: every new item is priced low and drawable', () => {
  const { ITEMS: L } = S.catalog, cheap = L.filter(i => (i.coins && i.coins <= 900) || (i.stars && i.stars <= 8 && i.slot !== 'coins'));
  assert.ok(cheap.length >= 30, 'cheap items ' + cheap.length);
  assert.equal(new Set(L.map(i => i.id)).size, L.length);
  for (const i of L.filter(i => i.slot === 'paper')) assert.ok(i.stats.power <= 115 && i.stats.control <= 110);
  for (const i of L.filter(i => i.grants)) for (const g of i.grants) assert.ok(L.find(x => x.id === g), g);
});
ok('set bundle grants every piece once, then counts as owned', () => {
  assert.equal(S.fulfill('ch9', 11, 'set_night', 129).ok, true);
  const got = S.db.prepare('SELECT item FROM owned WHERE uid=11 ORDER BY item').all().map(r => r.item);
  assert.deepEqual(got, ['f_neon', 'p_carbon', 'v_rooftop']);
  assert.equal(S.fulfill('ch9', 11, 'set_night', 129).dup, true);
});
ok('coin purchase needs enough coins and never goes negative', () => {
  S.db.prepare('INSERT OR IGNORE INTO users (uid,coins,equip) VALUES (8,300,\'{}\')').run();
  assert.equal(S.buyWithCoins(8, 'p_manila').err, 'coins');
  assert.equal(S.buyWithCoins(8, 'p_news').ok, true);
  assert.equal(S.buyWithCoins(8, 'p_news').err, 'owned');
  assert.equal(S.buyWithCoins(8, 'p_gold').err, 'not_for_coins');
  assert.equal(S.db.prepare('SELECT coins FROM users WHERE uid=8').get().coins, 0);
});
ok('squad: names cleaned, numbers 1-99 unique, premium pattern needs studio pack', () => {
  S.db.prepare('INSERT OR IGNORE INTO users (uid,coins,equip) VALUES (21,0,\'{}\')').run();
  const sq = S.saveSquad(21, { roster: { names: ['Amir', '<script>', 'babi', 'x'.repeat(30)], numbers: [10, 10, 0, 7] }, kit: { pattern: 'batik', base: '#ff0000', sponsor: 'JOM' } });
  assert.equal(sq.roster.names[0], 'Amir'); assert.equal(sq.roster.names[2], 'Faris'); assert.ok(sq.roster.names[3].length <= 12); assert.ok(!sq.roster.names[1].includes('<'));
  assert.equal(new Set(sq.roster.numbers).size, 11); assert.ok(sq.roster.numbers.every(x => x >= 1 && x <= 99)); assert.equal(sq.roster.numbers[0], 10);
  assert.equal(sq.kit.pattern, 'plain');
  S.db.prepare('INSERT INTO owned (uid,item,src,at) VALUES (21,\'k_studio\',\'test\',0)').run();
  assert.equal(S.saveSquad(21, { kit: { pattern: 'batik' } }).kit.pattern, 'batik');
  const st = S.buildSetup({ team0: 'jdt', team1: 'sel', kit0: 'custom', seed: 1, squad0: sq });
  assert.equal(st.rosters[0].names[0], 'Amir'); assert.equal(st.custom[0].base, '#ff0000'); assert.equal(st.custom[1], null);
  assert.ok(S.fulfill('ch21', 22, 'k_studio', 25).ok);
});
ok('coin toss: winner kicks off and is home; AI home skins are deterministic; replay still matches', () => {});
{
  const { aiEquip, tossResult } = await import('./public/items.js');
  const away = S.buildSetup({ team0: 'jdt', team1: 'sel', seed: 5, minutes: 1, first: 1, home: aiEquip(5) });
  const e = new Engine(away); assert.equal(e.turnTeam, 1); const ae = aiEquip(5); assert.deepEqual(away.home, { pitch: ae.pitch, venue: ae.venue, ball: ae.ball }); assert.deepEqual(aiEquip(5), aiEquip(5));
  const homeSt = S.buildSetup({ team0: 'jdt', team1: 'sel', seed: 5, minutes: 1, first: 0, home: { pitch: 'f_gold', venue: 'v_final', ball: 'b_crumple', paper: 'p_gold' } });
  assert.equal(new Engine(homeSt).turnTeam, 0); assert.deepEqual(homeSt.home, { pitch: 'f_gold', venue: 'v_final', ball: 'b_crumple' });
  assert.equal(tossResult('k', 'k'), true); assert.equal(tossResult('k', 'b'), false);
  const played = playOut(S.buildSetup({ team0: 'jdt', team1: 'sel', seed: 9, minutes: 1, cpu: [true, true], first: 1 })); assert.equal(played.phase, 'over');
}
ok('ranked: elo points, pair cap, short games, boards, season soft reset', () => {
  assert.equal(K.rpDelta(1000, 1000, 1), 16); assert.equal(K.rpDelta(1000, 1000, 0), -16);
  assert.ok(K.rpDelta(1000, 1400, 1) > K.rpDelta(1400, 1000, 1)); // beating a stronger player pays more
  assert.ok(K.rpDelta(1400, 1000, 1) >= 8 && K.rpDelta(1000, 1400, 0) <= -4); // never zero
  assert.equal(K.tierOf(999).id, 'scrap'); assert.equal(K.tierOf(1100).id, 'kajang'); assert.equal(K.tierOf(1100).div, 3); assert.equal(K.tierOf(2100).id, 'legend');
  assert.equal(K.softReset(1900), 1450); assert.equal(K.softReset(800), 900);
  const T0 = K.seasonEnds(1) - 10 * 864e5, A = 7101, B = 7102, C = 7103;
  for (const u of [A, B, C]) S.db.prepare('INSERT OR IGNORE INTO users (uid,name,equip,created) VALUES (?,?,?,?)').run(u, 'P' + u, '{}', 0);
  assert.equal(S.settleRanked(A, B, 1, 30e3, T0).why, 'short');
  assert.equal(S.settleRanked(A, A, 1, 90e3, T0).why, 'players');
  const r1 = S.settleRanked(A, B, 1, 90e3, T0); assert.equal(r1.counted, true); assert.equal(r1[A].delta, 16); assert.equal(r1[B].delta, -16);
  S.settleRanked(B, A, 0.5, 90e3, T0 + 1); S.settleRanked(A, B, 1, 90e3, T0 + 2);
  assert.equal(S.settleRanked(B, A, 1, 90e3, T0 + 3).why, 'pair'); // 4th game same pair same day
  assert.equal(S.settleRanked(A, B, 1, 90e3, T0 + 864e5 + 10).counted, true); // next day counts again
  S.settleRanked(C, A, 1, 90e3, T0 + 5);
  const ra = S.rankRow(A, 1), rb = S.rankRow(B, 1); assert.equal(ra.w, 3); assert.equal(ra.d, 1); assert.equal(ra.l, 1); assert.ok(ra.rp > 1000 && rb.rp < 1000 && ra.best >= ra.rp);
  S.rankRow(7104, 1); assert.ok(!S.board('season', 0, T0 + 6).rows.some(r => r.name === 'P7104')); // viewed but never played: not listed
  const sb = S.board('season', A, T0 + 6); assert.equal(sb.rows[0].me, true); assert.equal(sb.me.pos, 1); assert.ok(sb.rows.every(r => !('uid' in r)));
  const wk = S.board('week', B, T0 + 6), top = wk.rows[0]; assert.ok(top.score >= wk.rows.at(-1).score); assert.ok(wk.me.score >= 1);
  const all = S.board('all', C, T0 + 6); assert.ok(all.rows.find(r => r.me).score === 1); assert.equal(S.board('bogus'), null);
  const s2 = S.rankRow(A, 2); assert.equal(s2.rp, K.softReset(ra.rp)); assert.equal(s2.w, 0); // next season: half way back, record cleared
});
ok('friend leagues: create/limit, invite/full, table order, invite reward once, leave hands over, bot invite text', () => {
  const O = 7401, mk = u => S.db.prepare('INSERT OR IGNORE INTO users (uid,name,equip,created,coins) VALUES (?,?,?,?,0)').run(u, 'L' + u, '{}', 0);
  for (let u = O; u < O + 10; u++) mk(u);
  assert.equal(S.createLeague(O, 'ab').err, 'name');
  const lg = S.createLeague(O, 'Geng <b>Pejabat</b>', '#ff5d73'); assert.ok(lg.ok); assert.match(lg.code, /^[A-Z0-9]{6}$/);
  assert.equal(S.createLeague(O, 'Kedua', '#fff').err, 'limit'); // free: 1 own league
  assert.equal(S.joinLeague(O + 1, 'NOPE00').err, 'no_league');
  for (let u = O + 1; u < O + 8; u++) assert.ok(S.joinLeague(u, lg.code.toLowerCase(), u === O + 2 ? O + 1 : 0).ok); // 8 members
  assert.equal(S.joinLeague(O + 8, lg.code).err, 'full');
  assert.equal(S.joinLeague(O + 1, lg.code).already, true);
  const T0 = K.seasonEnds(1) - 5 * 864e5;
  assert.equal(S.recordLeague(lg.id, O, O + 9, 2, 0, 90e3, T0).why, 'players'); // not a member
  assert.equal(S.recordLeague(lg.id, O, O + 1, 2, 0, 20e3, T0).why, 'short');
  const coins = u => S.db.prepare('SELECT coins FROM users WHERE uid=?').get(u).coins;
  const r1 = S.recordLeague(lg.id, O + 2, O + 3, 3, 1, 90e3, T0); assert.ok(r1.counted);
  assert.equal(coins(O + 1), S.INVITE_REWARD); assert.equal(coins(O), S.INVITE_REWARD); // O+2 invited by O+1, O+3 by owner
  S.recordLeague(lg.id, O + 2, O + 3, 0, 0, 90e3, T0 + 1); S.recordLeague(lg.id, O + 2, O + 3, 1, 0, 90e3, T0 + 2);
  assert.equal(S.recordLeague(lg.id, O + 3, O + 2, 5, 0, 90e3, T0 + 3).why, 'pair');
  assert.equal(coins(O + 1), S.INVITE_REWARD); // paid once only
  S.recordLeague(lg.id, O + 4, O + 5, 1, 1, 90e3, T0 + 4);
  const tb = S.leagueTable(lg.id, O + 2, T0 + 5);
  assert.equal(tb.name, 'Geng bPejabat/b'); assert.equal(tb.table[0].me, true); assert.equal(tb.table[0].pts, 7); assert.equal(tb.table[0].p, 3);
  assert.equal(tb.table.at(-1).pts, 0); assert.ok(tb.table.every(r => r.uid === undefined)); assert.equal(tb.table.length, 8);
  assert.equal(S.leagueTable(lg.id, O + 9), null); // outsiders cannot read it
  assert.equal(S.myLeagues(O)[0].n, 8); assert.equal(S.myLeagues(O)[0].own, true);
  assert.ok(S.leaveLeague(O, lg.id).ok); assert.equal(S.myLeagues(O + 1)[0].own, true); // first joiner takes over
  for (const lang of ['ms', 'en', 'ru']) for (const k of ['invite_room', 'invite_league']) { const x = S.botText(k, { lang, code: '<X>' }); assert.ok(x.includes('&lt;X&gt;') && !x.includes('—')); }
});
ok('official league: waits for minimum, 30 min warning, 10 min no-show rule, 3 misses out, swiss, prizes once', () => {
  const sw = S.pairSwiss([1, 2, 3, 4, 5].map(uid => ({ uid })), new Set(['1:2', '2:1']), new Set([5]));
  assert.equal(sw.bye, 4); assert.deepEqual(sw.pairs, [[1, 3], [2, 5]]); // 5 already had a bye, 1-2 already met
  const s = 2, day0 = K.SEASON_EPOCH + (s - 1) * K.SEASON_MS + 864e5; // a season with no previous games
  const kick = d => Date.parse(new Date(day0 + d * 864e5 + 8 * 3600e3).toISOString().slice(0, 10) + 'T13:00:00Z');
  const P = Array.from({ length: S.OL.min }, (_, i) => 7600 + i);
  for (const u of P) S.db.prepare('INSERT OR IGNORE INTO users (uid,name,equip,created,coins) VALUES (?,?,?,?,0)').run(u, 'O' + u, '{}', 0);
  S.olOut.length = 0;
  for (const u of P.slice(0, -1)) S.olJoin(u, 'en', day0);
  assert.equal(S.olStatus(P[0], day0).started, false); assert.equal(S.olStatus(P[0], day0).count, S.OL.min - 1);
  S.olTick(kick(1) - 20 * 60e3); assert.equal(S.db.prepare('SELECT COUNT(*) n FROM ol_match WHERE season=?').get(s).n, 0); // not started: nothing scheduled
  S.olJoin(P.at(-1), 'ru', day0 + 1000); assert.equal(S.olStatus(P[0], day0).started, true);
  assert.equal(S.olOut.filter(m => m.kind === 'ol_started').length, S.OL.min);
  const present = new Set(P.slice(0, S.OL.min - 2)); // the last two never show up
  for (let d = 1; d <= 3; d++) {
    S.olOut.length = 0;
    S.olTick(kick(d) - 31 * 60e3); assert.equal(S.olOut.length, 0); // too early
    S.olTick(kick(d) - 29 * 60e3); assert.equal(S.olOut.filter(m => m.kind === 'ol_soon').length, S.OL.min - 2 * (d > 3)); // everyone told their opponent
    S.olTick(kick(d) - 10 * 60e3); assert.equal(S.olOut.filter(m => m.kind === 'ol_soon').length, S.OL.min); // no double reminders
    S.olTick(kick(d) + 1000); assert.equal(S.olOut.filter(m => m.kind === 'ol_open').length, S.OL.min);
    const games = S.db.prepare("SELECT * FROM ol_match WHERE season=? AND day=(SELECT MAX(day) FROM ol_match WHERE season=?) AND b>0").all(s, s);
    assert.equal(games.length, S.OL.min / 2);
    for (const g of games) if (present.has(g.a) && present.has(g.b)) S.olRecord(g.id, g.a % 3, g.b % 2); // real games finish
    S.olTick(kick(d) + 9 * 60e3); assert.equal(S.olOut.filter(m => m.kind === 'ol_walkover' || m.kind === 'ol_missed').length, 0); // still inside 10 min
    S.olTick(kick(d) + 10 * 60e3 + 1000, m => [m.a, m.b].filter(u => present.has(u)));
  }
  const ghost = S.db.prepare('SELECT * FROM ol_player WHERE uid=? AND season=?').get(P.at(-1), s);
  assert.equal(ghost.p, 3); assert.equal(ghost.l, 3); assert.equal(ghost.out, 1); assert.equal(ghost.pts, 0); assert.ok(ghost.ga >= 3); // 3 losses (forfeit or both absent), out
  const pairs = S.db.prepare('SELECT a, b FROM ol_match WHERE season=? AND b>0').all(s).map(m => [m.a, m.b].sort().join());
  assert.equal(new Set(pairs).size, pairs.length); // nobody met twice
  const walk = S.db.prepare("SELECT how FROM ol_match WHERE season=? AND how LIKE 'forfeit%'").all(s).length; assert.ok(walk >= 2);
  const st = S.olStatus(P[0], kick(3) + 3600e3); assert.ok(st.table.length === S.OL.min && st.table[0].pts >= st.table.at(-1).pts && st.me.p === 3);
  S.olTick(kick(4) - 29 * 60e3); assert.ok(!S.db.prepare("SELECT 1 FROM ol_match WHERE season=? AND (a=? OR b=?) AND day=(SELECT MAX(day) FROM ol_match)").get(s, P.at(-1), P.at(-1))); // out players are not paired
  const coins = u => S.db.prepare('SELECT coins FROM users WHERE uid=?').get(u).coins, top = st.table[0], champ = P.find(u => S.olStatus(u, kick(3) + 3600e3).me.pos === 1);
  S.olTick(K.seasonEnds(s) + 1000); const c1 = coins(champ);
  assert.equal(c1, S.OL.prize[0]); assert.ok(S.db.prepare("SELECT 1 FROM owned WHERE uid=? AND item='b_champion'").get(champ));
  S.olTick(K.seasonEnds(s) + 60e3); assert.equal(coins(champ), c1); // paid once
  assert.ok(S.db.prepare('SELECT 1 FROM ol_player WHERE uid=? AND season=?').get(champ, s + 1)); assert.ok(!S.db.prepare('SELECT 1 FROM ol_player WHERE uid=? AND season=?').get(P.at(-1), s + 1)); // carried over, ghosts dropped
  for (const lang of ['ms', 'en', 'ru']) for (const k of ['ol_invite', 'ol_started', 'ol_soon', 'ol_open', 'ol_walkover', 'ol_missed', 'ol_prize']) { const x = S.botText(k, { lang, opp: '<b>x', time: '21:00', min: 10, pos: 1, coins: 3000, ball: true, season: 2 }); assert.ok(x && !x.includes('—') && !x.includes('<b>x') && !/undefined|NaN/.test(x), k + lang); }
  assert.equal(I.itemName(S.catalog.itemById('b_champion'), 'ru'), 'Чемпион лиги'); assert.ok(!S.catalog.itemById('b_champion').coins && !S.catalog.itemById('b_champion').stars);
});
ok('PRO: subscription invoice, renewal extends once per charge, league limits, coin boost, star skins validated, season sale', () => {
  const u = 7900, pro = S.catalog.itemById('pro_month'); S.db.prepare('INSERT OR IGNORE INTO users (uid,name,equip,created,coins) VALUES (?,?,?,?,0)').run(u, 'Pro', '{}', 0);
  assert.equal(pro.stars, 50); assert.ok(pro.stars < 57); // under RM5
  assert.equal(S.isPro(u), false); assert.equal(S.leagueLimits(u).own, 1);
  for (const n of ['A1', 'A2']) S.createLeague(u, 'Liga ' + n);
  assert.equal(S.db.prepare('SELECT COUNT(*) n FROM league WHERE owner=?').get(u).n, 1); // free: 1
  assert.ok(S.fulfill('sub-1', u, 'pro_month', 50).ok); assert.ok(S.isPro(u));
  const t1 = S.db.prepare('SELECT pro_until FROM users WHERE uid=?').get(u).pro_until; assert.ok(Math.abs(t1 - Date.now() - 30 * 864e5) < 5000);
  assert.ok(S.fulfill('sub-1', u, 'pro_month', 50).dup); assert.equal(S.db.prepare('SELECT pro_until FROM users WHERE uid=?').get(u).pro_until, t1); // same charge: no extra month
  assert.ok(S.fulfill('sub-2', u, 'pro_month', 50).ok); assert.equal(S.db.prepare('SELECT pro_until FROM users WHERE uid=?').get(u).pro_until, t1 + 30 * 864e5); // renewal stacks
  assert.equal(S.fulfill('sub-3', u, 'pro_month', 30).ok, false); // wrong amount
  assert.ok(S.db.prepare("SELECT 1 FROM owned WHERE uid=? AND item='b_pro'").get(u));
  for (const n of ['B1', 'B2', 'B3', 'B4', 'B5']) S.createLeague(u, 'Liga ' + n);
  assert.equal(S.db.prepare('SELECT COUNT(*) n FROM league WHERE owner=?').get(u).n, 5); // PRO: 5
  const code = S.db.prepare('SELECT code FROM league WHERE owner=? LIMIT 1').get(u).code;
  for (let i = 1; i <= 35; i++) { S.db.prepare('INSERT OR IGNORE INTO users (uid,name,equip,created) VALUES (?,?,?,?)').run(7910 + i, 'M' + i, '{}', 0); S.joinLeague(7910 + i, code); }
  assert.equal(S.db.prepare('SELECT COUNT(*) n FROM league_member lm JOIN league l ON l.id=lm.lid WHERE l.code=?').get(code).n, 32); // PRO owner: 32 members
  const f = S.invoiceFieldsFor(pro, u, 'en'); assert.equal(f.subscription_period, 2592000); assert.equal(f.prices[0].amount, 50);
  assert.equal(S.invoiceFieldsFor(S.catalog.itemById('c_pack1'), u, 'en').subscription_period, undefined);
  // star skins: only owned star items, slots 0-10
  S.db.prepare("INSERT OR IGNORE INTO owned (uid,item,src,at) VALUES (?,'s_carton','stars',0)").run(u);
  const sq = S.saveSquad(u, { stars: { 0: 's_carton', 9: 's_rocket', 11: 's_carton', 3: 'p_gold', x: 's_carton' } });
  assert.deepEqual(sq.stars, { 0: 's_carton' });
  assert.ok(S.onSale(S.catalog.itemById('s_season1'), K.SEASON_EPOCH + 1000)); assert.ok(!S.onSale(S.catalog.itemById('s_season1'), K.SEASON_EPOCH + K.SEASON_MS + 1000)); assert.ok(S.onSale(S.catalog.itemById('s_rocket'), K.SEASON_EPOCH + 9 * K.SEASON_MS));
  for (const lang of ['ms', 'en', 'ru']) { const x = S.botText('paid', { lang, ok: true, item: pro, charge: 'c1', coins: 0, until: Date.UTC(2026, 10, 14) }); assert.ok(x.includes('2026-11-14') && x.includes('PRO') && !x.includes('—') && !/undefined/.test(x), lang); }
  for (const it of S.catalog.ITEMS.filter(i => i.slot === 'star')) { assert.ok(it.stars >= 5 && it.stars <= 49, it.id); assert.ok(!it.stats, it.id); } // style only
});
// async checks run after the sync ones
const aok = async (name, fn) => { await fn(); n++; console.log('ok', name); };
await aok('goal clips: only signed players, real jpg/mp4 bytes, size cap, share page serves it', async () => {
  const srv = S.server.listen(0), port = srv.address().port, base = `http://127.0.0.1:${port}`;
  const sign = uid => { const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: uid, first_name: 'Clip' }) });
    const dc = [...p.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
    const key = createHmac('sha256', 'WebAppData').update('123:TEST').digest(); p.set('hash', createHmac('sha256', key).update(dc).digest('hex')); return p.toString(); };
  const up = (body, type, auth = sign(7201)) => fetch(base + '/api/clip', { method: 'POST', headers: { 'Content-Type': type, 'X-Init-Data': auth }, body });
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(3000, 7)]);
  assert.equal((await up(jpg, 'image/jpeg', 'nope')).status, 401);
  assert.equal((await up(jpg, 'text/html')).status, 415);
  assert.equal((await up(Buffer.alloc(3000, 7), 'image/jpeg')).status, 400); // not really a jpeg
  assert.equal((await up(Buffer.alloc(9 << 20, 0xff), 'video/mp4')).status, 413);
  const r = await (await up(jpg, 'image/jpeg')).json(); assert.match(r.url, /^\/clip\/[\w-]{12}\.jpg$/);
  const got = await fetch(base + r.url); assert.equal(got.headers.get('content-type'), 'image/jpeg'); assert.equal(Buffer.from(await got.arrayBuffer()).length, jpg.length);
  const page = await (await fetch(base + r.page)).text(); assert.ok(page.includes('og:image') && page.includes(r.url) && !page.includes('—'));
  assert.equal((await fetch(base + '/clip/../server.js')).status, 404); assert.equal((await fetch(base + '/c/aaaaaaaaaaaa')).status, 404);
  srv.close();
});
await aok('ranked queue: guests refused, two signed players matched into a ranked room, same account never paired', async () => {
  const { WebSocket } = await import('ws');
  const srv = S.server.listen(0), port = srv.address().port;
  const sign = uid => { const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: uid, first_name: 'R' + uid }) });
    const dc = [...p.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
    const key = createHmac('sha256', 'WebAppData').update('123:TEST').digest(); p.set('hash', createHmac('sha256', key).update(dc).digest('hex')); return p.toString(); };
  const lobby = (initData) => new Promise(ok => { const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/lobby?pid=${Math.random()}`); const box = { ws, msgs: [] };
    ws.on('message', m => box.msgs.push(JSON.parse(String(m)))); ws.on('open', () => { ws.send(JSON.stringify({ t: 'queue', ranked: true, initData, v: E.PROTOCOL })); ok(box); }); });
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const g = await lobby('nope'); await wait(150); assert.equal(g.msgs[0]?.msg, 'ranked-guest');
  const a = await lobby(sign(7301)), a2 = await lobby(sign(7301)); await wait(150);
  assert.equal(a.msgs.length + a2.msgs.length, 0); // same account twice: no match
  const b = await lobby(sign(7302)); await wait(200);
  const got = [a, a2, b].map(x => x.msgs.find(m => m.t === 'matched')).filter(Boolean);
  assert.equal(got.length, 2); assert.equal(got[0].code, got[1].code); assert.ok(b.msgs[0]?.t === 'matched');
  [g, a, a2, b].forEach(x => x.ws.close()); srv.close();
});
console.log(`\n${n} checks passed`);
process.exit(0);
