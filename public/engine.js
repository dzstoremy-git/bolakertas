// engine.js : Bola Kertas deterministic match engine.
// Shared by the browser and the server. Same setup + same actions => same match.

export const FIELD = { W: 12, L: 20, goalW: 3.2, goalD: 0.9, goalH: 0.95, postR: 0.06,
  boxW: 7.2, boxD: 3.2, areaW: 4, areaD: 1.2, spot: 2.2, circle: 1.6 };
export const BALL_R = 0.16;
export const PIECE = { w: 0.6, d: 0.42, h: 0.8 };
export const MAX_SPEED = 13;
export const DECEL = 3;
export const PIECE_BOUNCE = 0.55;
export const SHOT_TYPES = ['ground', 'chip', 'lob'];
export const SHOT_ANGLE = { ground: 0, chip: 0.75, lob: 1.08 };
export const GRAVITY = 22;
export const AIR_DRAG = 0.4;
export const BOUNCE_KEEP_Y = 0.45;
export const BOUNCE_KEEP_XZ = 0.82;
export const CARD_BLOCK_H = 0.68;
export const POST_BOUNCE = 0.7;
export const MAX_TAPS = 3;
export const KICK_OFFSET = 0.62;
export const MAX_DRAG = 3.2;
export const KEEPER_SPEED = 1.1;
export const KEEPER_REACTION = 0.22;
export const POWER_CHARGE = 5;
export const POWER_SPEED = 28;
export const STEP = 1 / 60;
export const LOCKSTEP_AIM_S = 2;
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const BASE_STATS = { power: 100, weight: 100, control: 100 };

export const FORMATIONS = {
  '4-4-2': [[0,-.93],[-.68,-.68],[-.23,-.73],[.23,-.73],[.68,-.68],[-.62,-.42],[-.2,-.46],[.2,-.46],[.62,-.42],[-.26,-.19],[.26,-.19]],
  '4-3-3': [[0,-.93],[-.68,-.68],[-.23,-.73],[.23,-.73],[.68,-.68],[-.42,-.45],[0,-.5],[.42,-.45],[-.6,-.2],[0,-.19],[.6,-.2]],
  '3-5-2': [[0,-.93],[-.45,-.72],[0,-.75],[.45,-.72],[-.75,-.45],[-.35,-.5],[0,-.38],[.35,-.5],[.75,-.45],[-.26,-.19],[.26,-.19]],
  '5-3-2': [[0,-.93],[-.8,-.62],[-.4,-.72],[0,-.75],[.4,-.72],[.8,-.62],[-.42,-.45],[0,-.48],[.42,-.45],[-.26,-.19],[.26,-.19]],
};

export function makeRng(seed) {
  let s = seed >>> 0;
  const rnd = () => { s = (s + 1831565813) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), 1 | t);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  rnd.state = () => s; rnd.set = v => { s = v >>> 0; };
  return rnd;
}
export function seedFromString(str) {
  let h = 0; for (let i = 0; i < str.length; i++) h = Math.imul(31, h) + str.charCodeAt(i) | 0; return h >>> 0;
}
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function makeCode(len = 5) {
  let s = ''; for (let i = 0; i < len; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]; return s;
}
// stat 100 = base. Clamped so no item can exceed +15%.
export const statF = v => clamp((Number(v) || 100) / 100, 0.85, 1.15);

export class Engine {
  constructor(opts) {
    this.opts = { minutes: 3, halves: true, goalsToWin: 0, turnLimit: 15, powerStrike: true, layout: 'spread',
      cpu: [false, true], cpuSkill: 0.5, formations: ['4-4-2', '4-4-2'], lockstep: false, ...opts };
    this.opts.paper = [{ ...BASE_STATS, ...(opts.paper?.[0] || {}) }, { ...BASE_STATS, ...(opts.paper?.[1] || {}) }];
    this.rand = makeRng(opts.seed ?? 1);
    this.pieces = []; this.ball = { x: 0, z: 0, vx: 0, vz: 0, y: 0, vy: 0 };
    this.score = [0, 0]; this.phase = 'aim'; this.phaseT = 0;
    this.turnTeam = 0; this.kicker = null; this.tapsInRow = 0; this.lastTapTeam = null; this.lastTouchTeam = 0;
    this.lastTapper = null; this.setPiece = 'kickoff'; this.clock = 0; this.half = 1; this.swapped = false;
    this.message = null; this.winner = null; this.lastGoal = null; this.nextAfterDead = null;
    this.turnT = 0; this.shotIgnore = null; this.events = []; this.acc = 0; this.shots = 0;
    this.buildPieces(); this.applyLayout(); this.kickoff(this.opts.first ? 1 : 0); // coin toss winner kicks off
  }

  attackSign(t) { return (t === 0 ? 1 : -1) * (this.swapped ? -1 : 1); }
  get halfLength() { return this.opts.minutes > 0 && this.opts.halves ? 30 * this.opts.minutes : 60 * this.opts.minutes; }
  get timeLeft() {
    if (!(this.opts.minutes > 0)) return null;
    const end = this.opts.halves && this.half === 1 ? this.halfLength : 60 * this.opts.minutes;
    return Math.max(0, end - this.clock);
  }
  get turnLeft() { return this.opts.turnLimit > 0 && !this.opts.lockstep ? Math.max(0, this.opts.turnLimit - this.turnT) : null; }
  canPowerStrike() { return !!(this.opts.powerStrike && this.kicker && this.kicker.charge >= POWER_CHARGE); }
  say(text, sub = '', kind = 'info') { this.message = { text, sub, kind, id: (this.message?.id || 0) + 1 }; }
  ev(type, data = {}) { this.events.push({ type, ...data }); }

  buildPieces() {
    let id = 0;
    for (const team of [0, 1]) {
      const sign = this.attackSign(team), roster = this.opts.rosters?.[team] || { names: [], numbers: [] };
      FORMATIONS[this.opts.formations[team]] .forEach(([fx, fz], slot) => {
        const x = fx * (FIELD.W / 2) * 0.86 * sign, z = fz * (FIELD.L / 2) * sign;
        this.pieces.push({ id: id++, team, slot, isGK: slot === 0, number: roster.numbers[slot] ?? slot + 1,
          name: roster.names[slot] ?? '', home: { x, z }, kickoffHome: { x, z }, x, z, charge: 0, wobble: 0 });
      });
    }
  }

  applyLayout() {
    if (this.opts.layout === 'spread') {
      const halfL = FIELD.L / 2;
      for (const p of this.pieces) {
        if (p.isGK) continue;
        const sign = this.attackSign(p.team), norm = (p.kickoffHome.z * sign) / halfL;
        p.kickoffHome = { x: p.kickoffHome.x, z: clamp(2.5 * (norm + 0.75) - 0.68, -0.75, 0.72) * halfL * sign };
      }
    }
    this.separate();
  }

  // Kickoff layout keeps the centre spot clear and no two bodies overlapping.
  separate() {
    const edge = FIELD.W / 2 - 0.5, MIN_P = 1.15, MIN_C = 1.9;
    for (let pass = 0; pass < 60; pass++) {
      for (const a of this.pieces) for (const b of this.pieces) {
        if (a.id >= b.id) continue;
        const dx = b.kickoffHome.x - a.kickoffHome.x, dz = b.kickoffHome.z - a.kickoffHome.z, d = Math.hypot(dx, dz);
        if (d >= MIN_P) continue;
        const push = (MIN_P - d) / 2 * 1.2, nx = d > 1e-3 ? dx / d : (a.id % 2 ? 1 : -1), nz = d > 1e-3 ? dz / d : 0;
        if (!a.isGK) { a.kickoffHome.x = clamp(a.kickoffHome.x - nx * push, -edge, edge); a.kickoffHome.z -= nz * push; }
        if (!b.isGK) { b.kickoffHome.x = clamp(b.kickoffHome.x + nx * push, -edge, edge); b.kickoffHome.z += nz * push; }
      }
      for (const p of this.pieces) {
        const d = Math.hypot(p.kickoffHome.x, p.kickoffHome.z);
        if (d >= MIN_C) continue;
        const k = MIN_C / Math.max(d, 1e-3);
        p.kickoffHome.x = clamp(d > 1e-3 ? p.kickoffHome.x * k : (p.id % 2 ? MIN_C : -MIN_C), -edge, edge);
        p.kickoffHome.z = d > 1e-3 ? p.kickoffHome.z * k : 0;
      }
    }
  }

  placeBall(x, z) { Object.assign(this.ball, { x, z, vx: 0, vz: 0, y: 0, vy: 0 }); }

  kickoff(team) {
    for (const p of this.pieces) { p.home = { ...p.kickoffHome }; p.x = p.home.x; p.z = p.home.z; }
    this.lastTapper = null; this.placeBall(0, 0); this.setPiece = 'kickoff';
    this.lastTapTeam = null; this.tapsInRow = 0;
    this.giveTurn(team, 'SEPAK MULA'); this.ev('whistle');
  }

  // Distance used for possession: a tapper still at the ball counts from its home.
  distTo(p, x, z) { const s = p === this.lastTapper ? p.home : p; return Math.hypot(s.x - x, s.z - z); }
  nearest(team, includeGK = true) {
    let best = null, bd = Infinity;
    for (const p of this.pieces) {
      if (team !== null && p.team !== team) continue;
      if (!includeGK && p.isGK) continue;
      const d = this.distTo(p, this.ball.x, this.ball.z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  giveTurn(team, msg, sub, kicker) {
    this.turnTeam = team;
    if (this.lastTapTeam !== team) this.tapsInRow = 0;
    this.startAim(kicker || this.nearest(team, false));
    if (msg) this.say(msg, sub);
  }

  startAim(kicker) {
    this.shotIgnore = null;
    for (const p of this.pieces) if (p !== kicker && !p.isGK) { p.x = p.home.x; p.z = p.home.z; }
    if (this.opts.powerStrike && kicker !== this.lastTapper) kicker.charge = Math.min(POWER_CHARGE, kicker.charge + 1);
    this.kicker = kicker;
    const gz = this.attackSign(kicker.team) * FIELD.L / 2, dx = -this.ball.x, dz = gz - this.ball.z, l = Math.hypot(dx, dz) || 1;
    this.aim = { dx: dx / l, dz: dz / l };
    if (!kicker.isGK || this.setPiece === 'goalkick') { kicker.x = this.ball.x - this.aim.dx * KICK_OFFSET; kicker.z = this.ball.z - this.aim.dz * KICK_OFFSET; }
    this.phase = 'aim'; this.phaseT = 0; this.turnT = 0;
    this.ev('turn', { team: kicker.team, id: kicker.id });
  }

  applyAction(a) { return this._applyAction(a); }

  _applyAction(a) {
    if (!a || typeof a !== 'object') return false;
    if (a.t === 'half') {
      if (this.phase !== 'halftime') return false;
      this.half = 2; this.swapped = !this.swapped;
      for (const p of this.pieces) { p.kickoffHome = { x: -p.kickoffHome.x, z: -p.kickoffHome.z }; }
      this.kickoff(this.opts.first ? 0 : 1); return true;
    }
    if (this.phase !== 'aim') return false;
    if (a.t === 'skip') { this.turnTimeUp(); return true; }
    if (a.t !== 'aim') return false;
    const dx = Number(a.dx), dz = Number(a.dz), power = Number(a.power);
    if (![dx, dz, power].every(Number.isFinite)) return false;
    const l = Math.hypot(dx, dz); if (l < 1e-6) return false;
    const shot = SHOT_TYPES[a.shot | 0] ? (a.shot | 0) : 0;
    if (a.ps && !this.canPowerStrike()) return false;
    this.executeShot(dx / l, dz / l, clamp(power, 0.05, 1), shot, !!a.ps);
    return true;
  }

  executeShot(dx, dz, power, shot, ps) {
    const k = this.kicker, st = this.opts.paper[k.team];
    if (ps) { // power strike flies straight at the goal centre
      const gz = this.attackSign(k.team) * FIELD.L / 2, ex = -this.ball.x, ez = gz - this.ball.z, l = Math.hypot(ex, ez) || 1;
      dx = ex / l; dz = ez / l; shot = 0;
    }
    else { // control stat: tighter spread. Base spread about 3 degrees.
      const dev = (this.rand() * 2 - 1) * 0.03 * (1.2 - statF(st.control)) / 0.2, c = Math.cos(dev), s = Math.sin(dev);
      [dx, dz] = [dx * c - dz * s, dx * s + dz * c];
    }
    this.aim = { dx, dz };
    const speed = ps ? POWER_SPEED : power * MAX_SPEED * statF(st.power);
    const ang = SHOT_ANGLE[SHOT_TYPES[shot]];
    this.ball.vx = dx * speed * Math.cos(ang); this.ball.vz = dz * speed * Math.cos(ang); this.ball.vy = speed * Math.sin(ang);
    if (ps) k.charge = 0;
    const minD = BALL_R + PIECE.w / 2;
    this.shotIgnore = new Set(this.pieces.filter(p => p !== k && Math.hypot(p.x - this.ball.x, p.z - this.ball.z) < minD).map(p => p.id));
    k.x = this.ball.x - dx * KICK_OFFSET; k.z = this.ball.z - dz * KICK_OFFSET;
    this.updateKeepers(1000); // deterministic keeper settle, independent of how long aiming took
    this.lastTapper = k; if (this.lastTapTeam !== k.team) this.tapsInRow = 0;
    this.lastTapTeam = k.team; this.lastTouchTeam = k.team; this.tapsInRow++; this.shots++;
    this.power = ps; this.setPiece = null;
    if (this.opts.lockstep) this.clock += LOCKSTEP_AIM_S;
    this.phase = 'rolling'; this.phaseT = 0;
    this.ev('kick', { id: k.id, ps, shot, power });
  }

  step(dt) {
    this.phaseT += dt;
    const ph = this.phase;
    // Clock stops at half time, full time, and (online) while aiming: aiming time is added per shot instead.
    if (!(ph === 'halftime' || ph === 'over' || (ph === 'aim' && this.opts.lockstep))) this.clock += dt;
    for (const p of this.pieces) if (p.wobble > 0) p.wobble = Math.max(0, p.wobble - dt * 2.5);
    if (ph === 'aim') {
      if (this.checkTime()) return;
      if (!this.opts.lockstep) {
        this.turnT += dt;
        if (this.opts.turnLimit > 0 && this.turnT >= this.opts.turnLimit) this.turnTimeUp();
        else this.updateKeepers(dt);
      }
      return;
    }
    if (ph === 'rolling') {
      this.stepBall(dt); this.updateKeepers(dt);
      if (this.phase === 'rolling' && !this.checkGoal() && !this.checkOut()) {
        const b = this.ball;
        if (b.y < 0.005 && Math.hypot(b.vx, b.vz) < 0.15 && Math.abs(b.vy) < 0.2) this.onBallStopped();
      }
      return;
    }
    if (ph === 'goal' && this.phaseT > 2.2) this.afterGoal();
    else if (ph === 'dead' && this.phaseT > 0.9 && this.nextAfterDead) { const f = this.nextAfterDead; this.nextAfterDead = null; f(); }
  }

  stepBall(dt) {
    const b = this.ball;
    const airborne = b.y > 0 || b.vy > 0;
    if (airborne) b.vy -= GRAVITY * dt;
    const drag = Math.max(0, 1 - AIR_DRAG * dt); b.vx *= drag; b.vz *= drag;
    if (!airborne) { // rolling friction
      const g = Math.hypot(b.vx, b.vz);
      if (g > 0) { const r = Math.max(0, g - DECEL * dt) / g; b.vx *= r; b.vz *= r; }
    }
    b.x += b.vx * dt; b.z += b.vz * dt; b.y += b.vy * dt;
    if (b.y < 0) { // only a real impact bounces; a rolling ball stays on the ground
      b.y = 0;
      if (b.vy < -1.2) { b.vy = -b.vy * BOUNCE_KEEP_Y; b.vx *= BOUNCE_KEEP_XZ; b.vz *= BOUNCE_KEEP_XZ; this.ev('bounce', { v: -b.vy }); }
      else b.vy = 0;
    }
    const minD = BALL_R + PIECE.w / 2;
    for (const p of this.pieces) {
      if (b.y > CARD_BLOCK_H) continue; // chips and lobs sail over the paper
      const dx = b.x - p.x, dz = b.z - p.z, d = Math.hypot(dx, dz);
      if (d >= minD || d < 1e-4) continue;
      if (this.shotIgnore?.has(p.id)) continue;
      const nx = dx / d, nz = dz / d;
      b.x = p.x + nx * minD; b.z = p.z + nz * minD;
      const dot = b.vx * nx + b.vz * nz;
      if (dot < 0) {
        const e = PIECE_BOUNCE / statF(this.opts.paper[p.team].weight); // heavier paper kills the ball, so it stays with you
        b.vx -= (1 + e) * dot * nx; b.vz -= (1 + e) * dot * nz;
        b.vy = Math.max(b.vy, -dot * 0.12); // ball rides up the sloped paper a little
        p.wobble = Math.min(1, 0.4 + -dot * 0.08);
        this.lastTouchTeam = p.team;
        this.ev('hit', { id: p.id, v: -dot });
      }
    }
    const hw = FIELD.goalW / 2, gl = FIELD.L / 2, rr = BALL_R + FIELD.postR;
    for (const gz of [-gl, gl]) {
      for (const px of [-hw, hw]) { // posts
        if (b.y > FIELD.goalH) continue;
        const dx = b.x - px, dz = b.z - gz, d = Math.hypot(dx, dz);
        if (d >= rr || d < 1e-4) continue;
        const nx = dx / d, nz = dz / d, dot = b.vx * nx + b.vz * nz;
        b.x = px + nx * rr; b.z = gz + nz * rr;
        if (dot < 0) { b.vx -= (1 + POST_BOUNCE) * dot * nx; b.vz -= (1 + POST_BOUNCE) * dot * nz; this.ev('post', { v: -dot }); }
      }
      if (Math.abs(b.x) < hw) { // crossbar
        const dy = b.y - FIELD.goalH, dz = b.z - gz, d = Math.hypot(dy, dz);
        if (d < rr && d > 1e-4) {
          const ny = dy / d, nz = dz / d, dot = b.vy * ny + b.vz * nz;
          b.y = FIELD.goalH + ny * rr; b.z = gz + nz * rr;
          if (dot < 0) { b.vy -= (1 + POST_BOUNCE) * dot * ny; b.vz -= (1 + POST_BOUNCE) * dot * nz; this.ev('post', { v: -dot }); }
        }
      }
    }
  }

  // Keepers slide along their own goal line toward the ball.
  updateKeepers(dt) {
    for (const p of this.pieces) {
      if (!p.isGK) continue;
      if (p === this.kicker && this.phase === 'aim') continue;
      const gz = -this.attackSign(p.team) * (FIELD.L / 2 - 0.35);
      const tx = clamp(this.ball.x, -FIELD.goalW / 2 + 0.3, FIELD.goalW / 2 - 0.3), dx = tx - p.x;
      const mv = KEEPER_SPEED * dt * (Math.abs(dx) > KEEPER_REACTION ? 1 : 0.35);
      p.x += clamp(dx, -mv, mv); p.z = gz;
    }
  }

  checkGoal() {
    const b = this.ball, hw = FIELD.goalW / 2, gl = FIELD.L / 2;
    if (!(Math.abs(b.z) > gl + BALL_R * 0.5 && Math.abs(b.x) < hw - 0.02 && b.y < FIELD.goalH)) return false;
    const team = (b.z > 0) === (this.attackSign(0) > 0) ? 0 : 1;
    this.score[team]++;
    const t = this.lastTapper;
    this.lastGoal = { team, own: !t || t.team !== team, number: t?.number, name: t?.name };
    b.vx *= 0.25; b.vz *= 0.25; b.vy *= 0.25;
    this.phase = 'goal'; this.phaseT = 0;
    this.say('GOL!', this.lastGoal.own ? 'Gol sendiri' : `#${t.number} ${t.name}`, 'goal');
    this.ev('goal', { team });
    return true;
  }

  afterGoal() {
    if (this.opts.goalsToWin > 0 && Math.max(...this.score) >= this.opts.goalsToWin) return this.endMatch();
    if (this.checkTime()) return;
    this.kickoff(1 - this.lastGoal.team);
  }

  checkOut() {
    const b = this.ball, hw = FIELD.W / 2, gl = FIELD.L / 2;
    const side = Math.abs(b.x) > hw + BALL_R, end = Math.abs(b.z) > gl + BALL_R;
    if (!side && !end) return false;
    const last = this.lastTouchTeam, other = 1 - last, x = b.x, z = b.z;
    this.phase = 'dead'; this.phaseT = 0; this.ev('out');
    if (end && !side) {
      const defender = (z > 0) === (this.attackSign(0) > 0) ? 1 : 0; // team defending that end
      const s = Math.sign(z);
      if (last === defender) {
        this.say('SEPAKAN SUDUT', '', 'set');
        this.nextAfterDead = () => { this.placeBall(Math.sign(x || 1) * (hw - 0.3), s * (gl - 0.3)); this.setPiece = 'corner'; this.giveTurn(other); };
      } else {
        this.say('SEPAKAN GOL', '', 'set');
        this.nextAfterDead = () => { this.placeBall(0, s * (gl - FIELD.areaD)); this.setPiece = 'goalkick';
          this.giveTurn(defender, null, null, this.pieces.find(p => p.team === defender && p.isGK)); };
      }
    } else {
      this.say('BOLA KELUAR', 'Bola untuk lawan', 'set');
      this.nextAfterDead = () => { this.placeBall(Math.sign(x) * (hw - 0.4), clamp(z, -(gl - 0.6), gl - 0.6)); this.setPiece = 'throw'; this.giveTurn(other); };
    }
    return true;
  }

  // Single gate for clock expiry: every phase boundary routes here.
  checkTime() {
    if (!(this.opts.minutes > 0) || this.phase === 'over' || this.phase === 'halftime') return false;
    if (this.opts.halves && this.half === 1 && this.clock >= this.halfLength) {
      this.phase = 'halftime'; this.phaseT = 0; this.say('SEPARUH MASA', `${this.score[0]} : ${this.score[1]}`); this.ev('whistle', { long: true }); return true;
    }
    if (this.clock >= 60 * this.opts.minutes) { this.endMatch(); return true; }
    return false;
  }

  onBallStopped() {
    if (this.checkTime()) return;
    let near = this.nearest(null);
    if (near.team === this.lastTapTeam && this.tapsInRow >= MAX_TAPS) {
      const other = 1 - near.team;
      this.lastTapTeam = null; this.tapsInRow = 0;
      return this.giveTurn(other, `${MAX_TAPS} TENDANGAN HABIS`, 'Giliran bertukar', this.nearest(other));
    }
    this.giveTurn(near.team, null, null, near);
  }

  endMatch() {
    this.phase = 'over'; this.phaseT = 0;
    this.winner = this.score[0] > this.score[1] ? 0 : this.score[1] > this.score[0] ? 1 : null;
    this.say('TAMAT', `${this.score[0]} : ${this.score[1]}`, 'over'); this.ev('whistle', { long: true });
  }

  turnTimeUp() {
    const other = 1 - this.turnTeam;
    this.lastTapTeam = null; this.tapsInRow = 0;
    this.giveTurn(other, 'MASA HABIS', 'Giliran bertukar', this.nearest(other));
  }

  laneBlocked(dx, dz, len) {
    const b = this.ball;
    for (const p of this.pieces) {
      if (p === this.kicker) continue;
      const rx = p.x - b.x, rz = p.z - b.z, t = rx * dx + rz * dz;
      if (t > 0.35 && t < len && Math.abs(rx * dz - rz * dx) < 0.5) return true;
    }
    return false;
  }

  cpuAction() {
    if (this.phase !== 'aim') return null;
    const s = clamp(this.opts.cpuSkill ?? 0.5, 0, 1), r = this.rand, b = this.ball, team = this.turnTeam;
    const sign = this.attackSign(team), gz = sign * FIELD.L / 2, distGoal = Math.hypot(b.x, gz - b.z);
    if (this.canPowerStrike() && distGoal < 11 && r() < 0.5 + s * 0.4) return { t: 'aim', dx: 0, dz: sign, power: 1, shot: 0, ps: true };
    const gk = this.pieces.find(p => p.team !== team && p.isGK);
    let tx, tz, shooting = distGoal < 8.5;
    if (shooting) { const corner = gk && gk.x > 0 ? -1 : 1; tx = corner * (FIELD.goalW / 2 - 0.35); tz = gz + sign * 0.4; }
    else { tx = clamp(b.x * 0.4 + (r() - 0.5) * 5, -4.5, 4.5); tz = clamp(b.z + sign * (4.5 + r() * 3.5), -FIELD.L / 2 + 1, FIELD.L / 2 - 1); }
    const ang = Math.atan2(tx - b.x, tz - b.z) + (1 - s) * 0.32 * (r() * 2 - 1);
    const dx = Math.sin(ang), dz = Math.cos(ang), want = Math.hypot(tx - b.x, tz - b.z);
    const blocked = this.laneBlocked(dx, dz, Math.min(want, 5));
    const shot = blocked ? (want < 6 ? 1 : (r() < 0.5 ? 1 : 2)) : 0;
    const power = shooting ? clamp(0.82 + r() * 0.18, 0, 1) : clamp(Math.sqrt(want / 13.7) * 1.05 + (r() - 0.5) * 0.2 * (1 - s), 0.3, 1);
    return { t: 'aim', dx, dz, power, shot };
  }

  // Full rest state. The online server sends this after each action so clients can never drift.
  exportState() {
    return { b: [this.ball.x, this.ball.z], sc: [...this.score], ph: this.phase, tt: this.turnTeam, tr: this.tapsInRow,
      lt: this.lastTapTeam, lc: this.lastTouchTeam, ltp: this.lastTapper?.id ?? -1, k: this.kicker?.id ?? -1, c: this.clock,
      h: this.half, sw: this.swapped, sp: this.setPiece, w: this.winner, aim: this.aim, lg: this.lastGoal, msg: this.message,
      p: this.pieces.map(p => [p.x, p.z, p.home.x, p.home.z, p.kickoffHome.x, p.kickoffHome.z, p.charge]), r: this.rand.state() };
  }
  importState(s) {
    this.placeBall(s.b[0], s.b[1]); this.score = [...s.sc]; this.phase = s.ph; this.phaseT = 0; this.turnTeam = s.tt;
    this.tapsInRow = s.tr; this.lastTapTeam = s.lt; this.lastTouchTeam = s.lc; this.clock = s.c; this.half = s.h;
    this.swapped = s.sw; this.setPiece = s.sp; this.winner = s.w; this.aim = s.aim; this.lastGoal = s.lg; this.message = s.msg;
    s.p.forEach((a, i) => { const p = this.pieces[i]; p.x = a[0]; p.z = a[1]; p.home = { x: a[2], z: a[3] }; p.kickoffHome = { x: a[4], z: a[5] }; p.charge = a[6]; });
    this.rand.set(s.r); this.lastTapper = this.pieces[s.ltp] || null; this.kicker = this.pieces[s.k] || null; this.shotIgnore = null;
  }
}

const REST = new Set(['aim', 'halftime', 'over']);
export const isRest = e => REST.has(e.phase);
export function runToRest(e, max = 60) { let t = 0; while (!REST.has(e.phase) && t < max) { e.step(STEP); t += STEP; } e.events.length = 0; return t; }
export function checksum(e) {
  const n = (v, m = 1000) => Math.round(v * m);
  const ph = e.pieces.reduce((h, p) => (31 * h + 7 * n(p.x) + 13 * n(p.z) + p.charge) | 0, 7);
  return [e.score[0], e.score[1], e.phase, e.turnTeam, e.tapsInRow, n(e.clock, 10), n(e.ball.x), n(e.ball.z), ph].join('|');
}

// Ball-only flight preview for the aim guide. Ignores bodies on purpose.
export function predictPath(e, dx, dz, power, shot, ps = false) {
  const st = e.opts.paper[e.kicker?.team ?? 0];
  if (ps) { const gz = e.attackSign(e.kicker.team) * FIELD.L / 2, ex = -e.ball.x, ez = gz - e.ball.z, l = Math.hypot(ex, ez) || 1; dx = ex / l; dz = ez / l; shot = 0; }
  const speed = ps ? POWER_SPEED : power * MAX_SPEED * statF(st.power), ang = SHOT_ANGLE[SHOT_TYPES[shot]];
  const b = { x: e.ball.x, z: e.ball.z, y: 0, vx: dx * speed * Math.cos(ang), vz: dz * speed * Math.cos(ang), vy: speed * Math.sin(ang) };
  const pts = []; let land = null;
  for (let i = 0; i < 240; i++) {
    const air = b.y > 0 || b.vy > 0; if (air) b.vy -= GRAVITY * STEP;
    const drag = 1 - AIR_DRAG * STEP; b.vx *= drag; b.vz *= drag;
    if (!air) { const g = Math.hypot(b.vx, b.vz); if (g > 0) { const r = Math.max(0, g - DECEL * STEP) / g; b.vx *= r; b.vz *= r; } }
    b.x += b.vx * STEP; b.z += b.vz * STEP; b.y += b.vy * STEP;
    if (b.y < 0) { b.y = 0; if (b.vy < -1.2) { if (!land) land = { x: b.x, z: b.z }; b.vy = -b.vy * BOUNCE_KEEP_Y; b.vx *= BOUNCE_KEEP_XZ; b.vz *= BOUNCE_KEEP_XZ; } else b.vy = 0; }
    if (i % 3 === 0) pts.push({ x: b.x, y: b.y, z: b.z });
    if (Math.abs(b.x) > FIELD.W / 2 + 1 || Math.abs(b.z) > FIELD.L / 2 + 1) break;
    if (Math.hypot(b.vx, b.vz) < 0.15 && b.y === 0) break;
  }
  return { pts, land, end: pts[pts.length - 1] };
}
