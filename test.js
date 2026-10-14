// test.js : one runnable check for the engine and the money/security paths. node test.js
process.env.NODE_ENV = 'test'; process.env.BOT_TOKEN = '123:TEST'; process.env.DATA_DIR = '/tmp/bk-test-' + process.pid;
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Engine, runToRest, BASE_STATS, checksum, predictPath, FIELD } from './public/engine.js';
const S = await import('./server.js');
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
  assert.equal(S.fulfill('ch1', 5, 'p_gold', 299).ok, true);
  assert.equal(S.fulfill('ch1', 5, 'p_gold', 299).dup, true);
  assert.equal(S.fulfill('ch1', 6, 'p_gold', 299).ok, false);
  assert.equal(S.db.prepare('SELECT COUNT(*) c FROM owned WHERE uid=5').get().c, 1);
  S.fulfill('ch2', 5, 'pass_week', 30); S.fulfill('ch3', 5, 'pass_week', 30);
  const until = S.db.prepare('SELECT pass_until FROM users WHERE uid=5').get().pass_until; assert.ok(until > Date.now() + 13 * 86400e3);
});
ok('coin purchase needs enough coins and never goes negative', () => {
  S.db.prepare('INSERT OR IGNORE INTO users (uid,coins,equip) VALUES (8,300,\'{}\')').run();
  assert.equal(S.buyWithCoins(8, 'p_manila').err, 'coins');
  assert.equal(S.buyWithCoins(8, 'p_news').ok, true);
  assert.equal(S.buyWithCoins(8, 'p_news').err, 'owned');
  assert.equal(S.buyWithCoins(8, 'p_gold').err, 'not_for_coins');
  assert.equal(S.db.prepare('SELECT coins FROM users WHERE uid=8').get().coins, 0);
});
console.log(`\n${n} checks passed`);
process.exit(0);
