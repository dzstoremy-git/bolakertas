// test.js : one runnable check for the engine and the money/security paths. node test.js
process.env.NODE_ENV = 'test'; process.env.BOT_TOKEN = '123:TEST'; process.env.DATA_DIR = '/tmp/bk-test-' + process.pid;
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Engine, runToRest, BASE_STATS, checksum, predictPath, FIELD } from './public/engine.js';
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
  const sb = S.board('season', A, T0 + 6); assert.equal(sb.rows[0].me, true); assert.equal(sb.me.pos, 1); assert.ok(sb.rows.every(r => !('uid' in r)));
  const wk = S.board('week', B, T0 + 6), top = wk.rows[0]; assert.ok(top.score >= wk.rows.at(-1).score); assert.ok(wk.me.score >= 1);
  const all = S.board('all', C, T0 + 6); assert.ok(all.rows.find(r => r.me).score === 1); assert.equal(S.board('bogus'), null);
  const s2 = S.rankRow(A, 2); assert.equal(s2.rp, K.softReset(ra.rp)); assert.equal(s2.w, 0); // next season: half way back, record cleared
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
    ws.on('message', m => box.msgs.push(JSON.parse(String(m)))); ws.on('open', () => { ws.send(JSON.stringify({ t: 'queue', ranked: true, initData })); ok(box); }); });
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
