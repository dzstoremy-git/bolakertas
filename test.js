// test.js — Bola Kertas verification
// node --test style assertions, no framework
import assert from 'assert';
import { Engine, STEP, checksum, runToRest, replayLog, FORMATIONS, MAX_TAPS, FIELD, makeRng, seedFromString } from './public/engine.js';
import { ALL_TEAMS, LEAGUES, rosterFor, teamById } from './public/teams.js';

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); console.log('  ✓', name); pass++; }
  catch (e) { console.log('  ✗', name, '-', e.message); fail++; }
}

function basicSetup(seed = 12345) {
  const t0 = teamById('jdt'), t1 = teamById('sel');
  return {
    goalsToWin: 0, minutes: 3, halves: true, powerStrike: true, layout: 'spread', turnLimit: 15,
    formations: ['4-4-2', '4-3-3'],
    rosters: [rosterFor(t0), rosterFor(t1)],
    cpu: [false, false], cpuSkill: 0.5, seed,
  };
}

console.log('\n=== Bola Kertas tests ===\n');

console.log('Engine:');
ok('22 pieces created (11 per team)', () => {
  const e = new Engine(basicSetup());
  assert.strictEqual(e.pieces.length, 22, `got ${e.pieces.length}`);
});
ok('starts in aim phase', () => { const e = new Engine(basicSetup()); assert.strictEqual(e.phase, 'aim'); });
ok('score starts 0-0', () => { const e = new Engine(basicSetup()); assert.deepStrictEqual(e.score, [0,0]); });
ok('field constants sane', () => {
  assert.ok(FIELD.W > 0 && FIELD.L > FIELD.W, 'field should be longer than wide');
  assert.ok(FIELD.goalW < FIELD.W, 'goal narrower than field');
});
ok('formations all have 11 slots', () => {
  for (const [name, f] of Object.entries(FORMATIONS)) assert.strictEqual(f.length, 11, `${name} has ${f.length}`);
});
ok('turn limit counts down', () => {
  const e = new Engine(basicSetup());
  const start = e.turnLeft;
  for (let i = 0; i < 60; i++) e.step(STEP);
  assert.ok(e.turnLeft < start, 'turn timer should decrease');
});

console.log('\nDeterminism:');
ok('same seed + same actions => same checksum', () => {
  const actions = [
    { t:'aim', dx:0, dz:1, power:0.7, shotIdx:0 },
    { t:'aim', dx:0.1, dz:1, power:0.5, shotIdx:1 },
  ];
  const a = replayLog(basicSetup(999), actions, 0);
  const b = replayLog(basicSetup(999), actions, 0);
  assert.strictEqual(checksum(a), checksum(b), 'checksums differ');
});
ok('different seed => different state once RNG is used', () => {
  const a = new Engine({ ...basicSetup(1), cpuSkill: 0.5, cpu: [true, true] });
  const b = new Engine({ ...basicSetup(2), cpuSkill: 0.5, cpu: [true, true] });
  a.turnTeam = b.turnTeam = 1;
  a._applyAction(a.cpuAction()); runToRest(a);
  b._applyAction(b.cpuAction()); runToRest(b);
  assert.notStrictEqual(checksum(a), checksum(b));
});
ok('rng is deterministic for same seed', () => {
  const r1 = makeRng(42), r2 = makeRng(42);
  for (let i = 0; i < 20; i++) assert.strictEqual(r1(), r2());
});
ok('seedFromString stable', () => {
  assert.strictEqual(seedFromString('abc'), seedFromString('abc'));
  assert.notStrictEqual(seedFromString('abc'), seedFromString('abd'));
});

console.log('\nShooting:');
ok('shot moves the ball', () => {
  const e = new Engine(basicSetup());
  const before = { x: e.ball.x, z: e.ball.z };
  e._applyAction({ t:'aim', dx:0, dz:1, power:1, shotIdx:0 });
  assert.strictEqual(e.phase, 'rolling');
  for (let i = 0; i < 30; i++) e.step(STEP);
  const moved = Math.hypot(e.ball.x - before.x, e.ball.z - before.z);
  assert.ok(moved > 0.5, `ball moved only ${moved.toFixed(3)}`);
});
ok('ball eventually stops and phase returns to aim', () => {
  const e = new Engine(basicSetup());
  e._applyAction({ t:'aim', dx:0, dz:1, power:0.6, shotIdx:0 });
  runToRest(e);
  assert.ok(['aim','over','halftime','dead'].includes(e.phase), `stuck in ${e.phase}`);
});
ok('shot type changes trajectory', () => {
  const g = new Engine(basicSetup()); g._applyAction({t:'aim',dx:0,dz:1,power:0.8,shotIdx:0}); runToRest(g);
  const c = new Engine(basicSetup()); c._applyAction({t:'aim',dx:0,dz:1,power:0.8,shotIdx:1}); runToRest(c);
  assert.ok(Math.abs(g.ball.z - c.ball.z) > 0.01, 'chip and ground should differ');
});

console.log('\nTurn rules:');
ok(`max ${MAX_TAPS} taps then possession switches`, () => {
  const e = new Engine({ ...basicSetup(), goalsToWin: 0, minutes: 0 });
  const startTeam = e.turnTeam;
  let switches = 0, last = startTeam;
  for (let i = 0; i < 20; i++) {
    if (e.phase === 'aim') { e._applyAction({ t:'aim', dx:0, dz:1, power:0.3, shotIdx:0 }); }
    runToRest(e);
    if (e.turnTeam !== last) { switches++; last = e.turnTeam; }
    if (switches >= 2) break;
  }
  assert.ok(switches >= 1, 'possession never switched');
});
ok('actions rejected when not in aim phase', () => {
  const e = new Engine(basicSetup());
  e.phase = 'rolling';
  assert.strictEqual(e._applyAction({ t:'aim', dx:0, dz:1, power:1, shotIdx:0 }), false);
});

console.log('\nTeams:');
ok(`${ALL_TEAMS.length} teams loaded`, () => { assert.ok(ALL_TEAMS.length >= 60, `only ${ALL_TEAMS.length}`); });
ok('every team has 2+ jerseys and keeper', () => {
  for (const t of ALL_TEAMS) {
    assert.ok(t.jerseys.length >= 2, `${t.id} jerseys=${t.jerseys.length}`);
    assert.ok(t.keeper.length >= 1, `${t.id} no keeper`);
  }
});
ok('every jersey has required color fields', () => {
  for (const t of ALL_TEAMS) for (const j of [...t.jerseys, ...t.keeper]) {
    for (const f of ['base','accent','trim','number']) {
      assert.ok(/^#[0-9a-f]{6}$/i.test(j[f]), `${t.id}/${j.id} ${f}=${j[f]}`);
    }
  }
});
ok('team ids unique', () => {
  const ids = ALL_TEAMS.map(t => t.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'duplicate team ids');
});
ok('leagues cover 5 competitions', () => { assert.strictEqual(LEAGUES.length, 5); });
ok('roster is 11 names + 11 numbers', () => {
  const r = rosterFor(ALL_TEAMS[0]);
  assert.strictEqual(r.names.length, 11);
  assert.strictEqual(r.numbers.length, 11);
});
ok('teamById falls back safely', () => { assert.ok(teamById('nonexistent').id); });

console.log('\nMatch flow:');
ok('match ends when time expires', () => {
  const e = new Engine({ ...basicSetup(), minutes: 1, halves: false, goalsToWin: 0 });
  e.clock = 60;
  for (let i = 0; i < 200 && e.phase !== 'over'; i++) e.step(STEP);
  assert.strictEqual(e.phase, 'over', `phase=${e.phase}`);
});
ok('goalsToWin ends match', () => {
  const e = new Engine({ ...basicSetup(), goalsToWin: 1, minutes: 0 });
  e.score = [1, 0];
  e.phase = 'goal';
  e.afterGoal();
  assert.strictEqual(e.phase, 'over');
  assert.strictEqual(e.winner, 0);
});
ok('halftime triggers at half length', () => {
  const e = new Engine({ ...basicSetup(), minutes: 4, halves: true });
  e.clock = e.halfLength + 0.1;
  e.phase = 'settle'; e.ball.vx = 0; e.ball.vz = 0; e.ball.vy = 0; e.ball.y = 0;
  e.onBallStopped();
  assert.strictEqual(e.phase, 'halftime');
});
ok('halftime action swaps sides', () => {
  const e = new Engine(basicSetup());
  e.phase = 'halftime';
  const wasSwapped = e.swapped;
  e._applyAction({ t: 'half' });
  assert.strictEqual(e.half, 2);
  assert.notStrictEqual(e.swapped, wasSwapped);
});
ok('draw gives null winner', () => {
  const e = new Engine({ ...basicSetup(), minutes: 1, halves: false });
  e.score = [2, 2]; e.endMatch();
  assert.strictEqual(e.winner, null);
});

console.log('\nCPU:');
ok('cpu produces valid action', () => {
  const e = new Engine({ ...basicSetup(), cpu: [true, true], cpuSkill: 0.8 });
  e.turnTeam = 1;
  const a = e.cpuAction();
  assert.ok(a && a.t === 'aim', 'no action');
  assert.ok(Number.isFinite(a.dx) && Number.isFinite(a.dz), 'bad direction');
  assert.ok(a.power >= 0 && a.power <= 1.5, `power=${a.power}`);
});
ok('higher skill => less random deviation', () => {
  function spread(skill) {
    const e = new Engine({ ...basicSetup(), cpuSkill: skill });
    let xs = [];
    for (let i = 0; i < 40; i++) xs.push(e.cpuAction().dx);
    const mean = xs.reduce((a,b)=>a+b)/xs.length;
    return Math.sqrt(xs.reduce((a,b)=>a+(b-mean)**2,0)/xs.length);
  }
  assert.ok(spread(0.9) < spread(0.1), 'high skill should be more accurate');
});

console.log('\nChecksum:');
ok('checksum changes after a shot', () => {
  const e = new Engine(basicSetup());
  const before = checksum(e);
  e._applyAction({ t:'aim', dx:0, dz:1, power:1, shotIdx:0 });
  runToRest(e);
  assert.notStrictEqual(checksum(e), before);
});
ok('checksum is a string with 9 fields', () => {
  const parts = checksum(new Engine(basicSetup())).split('|');
  assert.strictEqual(parts.length, 9, `got ${parts.length}`);
});

console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
if (fail > 0) process.exit(1);
