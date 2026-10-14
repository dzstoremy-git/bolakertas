// engine.js — Bola Kertas deterministic game engine
// Shared: imported by both client and server

// ── constants ───────────────────────────────────────────────
export const FIELD = { W: 12, L: 20, goalW: 3.2, goalD: 0.9, goalH: 0.95, postR: 0.07 };
export const BALL_R = 0.16;
export const PIECE  = { w: 0.6, d: 0.42, h: 0.8 };
export const MAX_SPEED = 13;
export const DECEL = 3;
export const PIECE_BOUNCE = 0.55;
export const SHOT_TYPES = ['ground','chip','lob'];
export const SHOT_ANGLE = { ground: 0, chip: 0.75, lob: 1.08 };
export const GRAVITY = 22;
export const AIR_DRAG = 0.4;
export const BOUNCE_KEEP_Y  = 0.45;
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
export const POWER_WOODWORK = 0.25;
export const STEP = 1 / 60;
export const LOCKSTEP_AIM_S = 2;
export const TURN_GRACE_MS  = 1500;
export const RECONNECT_MS   = 60000;
export const MAX_IDLE_TURNS = 3;
export const CODE_ALPHABET  = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const FORMATIONS = {
  '4-4-2': [[0,-.93],[-.68,-.68],[-.23,-.73],[.23,-.73],[.68,-.68],[-.62,-.42],[-.2,-.46],[.2,-.46],[.62,-.42],[-.26,-.19],[.26,-.19]],
  '4-3-3': [[0,-.93],[-.68,-.68],[-.23,-.73],[.23,-.73],[.68,-.68],[-.42,-.45],[0,-.5],[.42,-.45],[-.6,-.2],[0,-.19],[.6,-.2]],
  '3-5-2': [[0,-.93],[-.45,-.72],[0,-.75],[.45,-.72],[-.75,-.45],[-.35,-.5],[0,-.38],[.35,-.5],[.75,-.45],[-.26,-.19],[.26,-.19]],
  '5-3-2': [[0,-.93],[-.8,-.62],[-.4,-.72],[0,-.75],[.4,-.72],[.8,-.62],[-.42,-.45],[0,-.48],[.42,-.45],[-.26,-.19],[.26,-.19]],
};

// ── seeded PRNG ─────────────────────────────────────────────
export function makeRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 1831565813) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), 1 | t); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function seedFromString(str) {
  let h = 0; for (let i = 0; i < str.length; i++) { h = Math.imul(31, h) + str.charCodeAt(i) | 0; } return h >>> 0;
}

// ── helpers ─────────────────────────────────────────────────
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function makeCode(len = 5) {
  return Array.from({ length: len }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
}

// ── Engine ──────────────────────────────────────────────────
export class Engine {
  constructor(opts) {
    this.opts = opts;
    this.rand = opts.seed == null ? Math.random : makeRng(opts.seed);
    this.pieces = []; this.ball = { x:0, z:0, vx:0, vz:0, y:0, vy:0, spin:0 };
    this.score = [0,0]; this.phase = 'aim'; this.phaseT = 0;
    this.turnTeam = 0; this.kicker = null; this.tapsInRow = 0;
    this.lastTapTeam = null; this.lastTouchTeam = 0;
    this.setPiece = 'kickoff';
    this.aim = { dx:0, dz:1, power:0, active:false };
    this.pendingShot = null; this.power = false;
    this.goalFly = [null,null]; this.shake = 0;
    this.shotType = ['ground','ground'];
    this.clock = 0; this.half = 1; this.swapped = false;
    this.message = null; this.winner = null;
    this.goalFlash = 0; this.nextAfterDead = null;
    this.turnT = 0; this.lastTapper = null;
    this.listeners = new Set(); this.version = 0; this.acc = 0;
    this.intercept = null; // for online: intercept action before local apply
    this.buildPieces();
    if (opts.drill) this.setupDrill();
    else { this.applyLayout(); this.kickoff(0); }
  }

  // ── team direction ──
  attackSign(t) { return (t === 0 ? 1 : -1) * (this.swapped ? -1 : 1); }
  defaultRot(t) { return this.attackSign(t) > 0 ? 0 : Math.PI; }
  get halfLength() { return this.opts.minutes > 0 && this.opts.halves ? 60 * this.opts.minutes / 2 : 60 * this.opts.minutes; }
  // single source of truth for clock expiry — every phase boundary routes here
  checkTime() {
    if (!(this.opts.minutes > 0) || this.phase === 'over' || this.phase === 'halftime') return false;
    if (this.opts.halves && this.half === 1 && this.clock >= this.halfLength) {
      this.phase = 'halftime'; this.phaseT = 0; this.say('SEPARUH MASA'); this.emit(); return true;
    }
    if (this.clock >= 60 * this.opts.minutes) { this.endMatch(); return true; }
    return false;
  }
  get timeLeft() {
    if (!this.opts.minutes) return null;
    const total = this.opts.halves && this.half === 1 ? this.halfLength : 60 * this.opts.minutes;
    return Math.max(0, total - this.clock);
  }

  // ── events ──
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { this.version++; this.listeners.forEach(fn => fn()); }
  say(text, kind = 'info', sub) { this.message = { text, kind, sub, t: 0 }; this.emit(); }

  // ── pieces ──
  buildPieces() {
    let id = 0;
    for (const team of [0, 1]) {
      const sign = this.attackSign(team);
      const roster = this.opts.rosters[team];
      const form = FORMATIONS[this.opts.formations[team]];
      form.forEach(([fx, fz], slot) => {
        const x = fx * (FIELD.W / 2) * 0.86 * sign;
        const z = fz * (FIELD.L / 2) * sign;
        this.pieces.push({
          id: id++, team, slot, isGK: slot === 0,
          number: roster.numbers[slot] ?? slot + 1,
          name: roster.names[slot] ?? '',
          home: { x, z }, kickoffHome: { x, z },
          x, z, rot: this.defaultRot(team), flip: 0, flipT: 99,
          tapPower: 0, wobble: 0, charge: 0, y: 0, tilt: 0, fly: null
        });
      });
    }
  }

  applyLayout() {
    if (this.opts.layout !== 'spread') return;
    const halfL = FIELD.L / 2;
    for (const p of this.pieces) {
      if (p.isGK) continue;
      const sign = this.attackSign(p.team);
      const norm = (p.kickoffHome.z * sign) / halfL;
      const shifted = clamp(2.5 * (norm + 0.75) - 0.68, -0.75, 0.72);
      p.kickoffHome = { x: p.kickoffHome.x, z: shifted * halfL * sign };
    }
    this.separate();
  }

  // Kickoff layout must leave the centre spot and the shot lane clear, or the
  // first shot of every match bounces straight back off a body standing on the ball.
  separate() {
    const edge = FIELD.W / 2 - 0.5;
    const MIN_PIECE = 1.15, MIN_CENTRE = 1.9;
    for (let pass = 0; pass < 60; pass++) {
      for (const a of this.pieces) for (const b of this.pieces) {
        if (a.id >= b.id) continue;
        const dx = b.kickoffHome.x - a.kickoffHome.x, dz = b.kickoffHome.z - a.kickoffHome.z;
        const d = Math.hypot(dx, dz);
        if (d >= MIN_PIECE) continue;
        const push = (MIN_PIECE - d) / 2;
        const nx = d > 0.001 ? dx / d : (a.id % 2 ? 1 : -1);
        const nz = d > 0.001 ? dz / d : 0;
        if (!a.isGK) a.kickoffHome.x = clamp(a.kickoffHome.x - nx * push * 1.2, -edge, edge);
        if (!b.isGK) b.kickoffHome.x = clamp(b.kickoffHome.x + nx * push * 1.2, -edge, edge);
        if (!a.isGK) a.kickoffHome.z -= nz * push * 1.2;
        if (!b.isGK) b.kickoffHome.z += nz * push * 1.2;
      }
      for (const p of this.pieces) {
        const d = Math.hypot(p.kickoffHome.x, p.kickoffHome.z);
        if (d >= MIN_CENTRE) continue;
        const k = MIN_CENTRE / Math.max(d, 0.001);
        p.kickoffHome.x = clamp(d > 0.001 ? p.kickoffHome.x * k : (p.id % 2 ? 1.9 : -1.9), -edge, edge);
        p.kickoffHome.z = d > 0.001 ? p.kickoffHome.z * k : 0;
      }
    }
  }

  setupDrill() {
    this.placeBall(0, -FIELD.L / 2 + 4);
    this.giveTurn(0, 'DRILL');
  }

  resetFormation() {
    this.lastTapper = null; this.power = false;
    this.goalFly = [null, null];
    for (const p of this.pieces) {
      p.fly = null; p.y = 0; p.tilt = 0;
      p.x = p.home.x; p.z = p.home.z;
      p.rot = this.defaultRot(p.team);
    }
  }

  resetHomes() {
    for (const p of this.pieces) p.home = { ...p.kickoffHome };
  }

  placeBall(x, z) { Object.assign(this.ball, { x, z, vx: 0, vz: 0, y: 0, vy: 0, spin: 0 }); }

  kickoff(team) {
    this.resetHomes(); this.resetFormation();
    this.placeBall(0, 0); this.setPiece = 'kickoff';
    this.giveTurn(team, 'KICK OFF');
  }

  // ── turn management ──
  nearest(team, includeGK = true) {
    let best = null, bestD = Infinity;
    for (const p of this.pieces) {
      if (team !== null && p.team !== team) continue;
      if (!includeGK && p.isGK) continue;
      const d = Math.hypot(p.x - this.ball.x, p.z - this.ball.z);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  giveTurn(team, msg, sub, useGK = false) {
    this.turnTeam = team;
    const kicker = useGK
      ? this.pieces.find(p => p.team === team && p.isGK)
      : this.nearest(team, false);
    this.startAim(kicker);
    if (this.lastTapTeam !== team) this.tapsInRow = 0;
    if (msg) this.say(msg, 'info', sub);
    this.emit();
  }

  startAim(kicker) {
    this.shotIgnore = null;
    this.kicker = kicker;
    if (this.opts.powerStrike && kicker !== this.lastTapper) {
      kicker.charge = Math.min(POWER_CHARGE, kicker.charge + 1);
    }
    const goalZ = this.attackSign(kicker.team) * (FIELD.L / 2);
    const dx = 0 - this.ball.x, dz = goalZ - this.ball.z;
    const len = Math.hypot(dx, dz) || 1;
    this.aim = { dx: dx / len, dz: dz / len, power: 0, active: false };
    this.phase = 'aim'; this.phaseT = 0; this.turnT = 0;
  }

  get turnLeft() {
    return this.opts.turnLimit > 0 ? Math.max(0, this.opts.turnLimit - this.turnT) : null;
  }

  // ── action dispatch ──
  applyAction(action) {
    if (this.intercept) return this.intercept(action);
    return this._applyAction(action);
  }

  _applyAction(action) {
    if (action.t === 'half') {
      if (this.phase !== 'halftime') return false;
      this.half = 2; this.swapped = !this.swapped;
      this.kickoff(1);
      return true;
    }
    if (action.t !== 'aim' || this.phase !== 'aim') return false;
    const { dx, dz, power, shotIdx } = action;
    const len = Math.hypot(dx, dz) || 1;
    this.aim.dx = dx / len; this.aim.dz = dz / len;
    this.aim.power = clamp(power, 0.05, 1);
    const st = SHOT_TYPES[shotIdx] || 'ground';
    this.shotType[this.turnTeam] = st;
    this.executeShot(st);
    return true;
  }

  executeShot(shotType) {
    const k = this.kicker; if (!k) return;
    const speed = k.charge >= POWER_CHARGE && this.opts.powerStrike
      ? POWER_SPEED : this.aim.power * MAX_SPEED;
    const angle = SHOT_ANGLE[shotType] || 0;
    this.ball.vx = this.aim.dx * speed * Math.cos(angle);
    this.ball.vz = this.aim.dz * speed * Math.cos(angle);
    this.ball.vy = speed * Math.sin(angle);
    if (k.charge >= POWER_CHARGE && this.opts.powerStrike) {
      k.charge = 0; this.power = true;
    }
    // ball must not bounce off bodies it is standing inside at kick time
    const minD0 = BALL_R + PIECE.w / 2;
    this.shotIgnore = new Set(this.pieces.filter(p => Math.hypot(p.x - this.ball.x, p.z - this.ball.z) < minD0).map(p => p.id));
    // kicker steps behind the ball so the shot line is clear
    k.x = this.ball.x - this.aim.dx * KICK_OFFSET;
    k.z = this.ball.z - this.aim.dz * KICK_OFFSET;
    this.lastTapper = k; this.lastTapTeam = this.turnTeam;
    this.tapsInRow++;
    this.phase = 'rolling'; this.phaseT = 0;
    k.flip = 1; k.flipT = 0;
    this.emit();
  }

  // ── physics step ──
  step(dt) {
    this.phaseT += dt;
    // must advance before any phase-specific early return, or match time never runs out
    this.clock += dt;
    if (this.phase === 'aim') {
      if (this.checkTime()) return;
      this.turnT += dt;
      if (this.opts.turnLimit > 0 && this.turnT >= this.opts.turnLimit) {
        this.turnTimeUp();
      }
      this.updateKeepers(dt);
      return;
    }
    if (this.phase === 'halftime' || this.phase === 'over') return;
    if (this.phase === 'rolling' || this.phase === 'settle') {
      this.stepBall(dt);
      this.updateKeepers(dt);
      this.checkGoal();
      this.checkOutOfPlay(dt);
      if (this.phase === 'rolling' || this.phase === 'settle') {
        const spd = Math.hypot(this.ball.vx, this.ball.vz, this.ball.vy);
        if (spd < 0.15 && this.ball.y < 0.02) {
          this.onBallStopped();
        }
      }
    }
    if (this.phase === 'goal') {
      if (this.phaseT > 2) this.afterGoal();
    }
    if (this.phase === 'dead') {
      if (this.phaseT > 0.8 && this.nextAfterDead) {
        this.nextAfterDead(); this.nextAfterDead = null;
      }
    }
    if (this.message && this.message.t < 10) this.message.t += dt;
  }

  stepBall(dt) {
    const b = this.ball;
    // gravity
    b.vy -= GRAVITY * dt;
    // air drag
    const spd = Math.hypot(b.vx, b.vz, b.vy);
    if (spd > 0.01) {
      const drag = AIR_DRAG * dt;
      const factor = Math.max(0, 1 - drag);
      b.vx *= factor; b.vz *= factor;
    }
    // ground decel
    if (b.y < 0.01) {
      const gspd = Math.hypot(b.vx, b.vz);
      if (gspd > 0.01) {
        const dec = DECEL * dt;
        const nspd = Math.max(0, gspd - dec);
        const ratio = nspd / gspd;
        b.vx *= ratio; b.vz *= ratio;
      }
    }
    b.x += b.vx * dt; b.z += b.vz * dt; b.y += b.vy * dt;
    // ground bounce
    if (b.y < 0) { b.y = 0; b.vy = Math.abs(b.vy) * BOUNCE_KEEP_Y; b.vx *= BOUNCE_KEEP_XZ; b.vz *= BOUNCE_KEEP_XZ; }
    // piece collisions
    for (const p of this.pieces) {
      if (this.shotIgnore?.has(p.id)) continue;
      const dx = b.x - p.x, dz = b.z - p.z;
      const dist = Math.hypot(dx, dz);
      const minD = BALL_R + PIECE.w / 2;
      if (dist < minD && dist > 0.001) {
        const nx = dx / dist, nz = dz / dist;
        const push = minD - dist;
        b.x += nx * push; b.z += nz * push;
        const dot = b.vx * nx + b.vz * nz;
        if (dot < 0) {
          b.vx -= 2 * dot * nx * PIECE_BOUNCE;
          b.vz -= 2 * dot * nz * PIECE_BOUNCE;
          if (b.y < CARD_BLOCK_H) b.vy = Math.max(b.vy, 1);
        }
        p.wobble = 0.5;
      }
    }
    // post collisions
    const hw = FIELD.goalW / 2;
    const gl = FIELD.L / 2;
    for (const side of [-1, 1]) {
      const gz = gl * side;
      for (const px of [-hw, hw]) {
        const dx = b.x - px, dz = b.z - gz;
        const d = Math.hypot(dx, dz);
        if (d < BALL_R + FIELD.postR) {
          const nx = dx / d, nz = dz / d;
          b.x = px + nx * (BALL_R + FIELD.postR);
          b.z = gz + nz * (BALL_R + FIELD.postR);
          const dot = b.vx * nx + b.vz * nz;
          b.vx -= 2 * dot * nx * POST_BOUNCE;
          b.vz -= 2 * dot * nz * POST_BOUNCE;
          this.shake = 0.3;
        }
      }
    }
  }

  updateKeepers(dt) {
    for (const p of this.pieces) {
      if (!p.isGK) { if (p.wobble > 0) p.wobble -= dt * 3; continue; }
      // keeper slides along goal line
      const gz = this.attackSign(p.team) * (-FIELD.L / 2);
      const targetX = clamp(this.ball.x, -FIELD.goalW / 2 + 0.3, FIELD.goalW / 2 - 0.3);
      const dx = targetX - p.x;
      const move = KEEPER_SPEED * dt * (Math.abs(dx) > KEEPER_REACTION ? 1 : 0.3);
      p.x += clamp(dx, -move, move);
      p.z = gz;
      if (p.wobble > 0) p.wobble -= dt * 3;
    }
  }

  checkGoal() {
    const b = this.ball;
    const hw = FIELD.goalW / 2, gl = FIELD.L / 2;
    if (Math.abs(b.z) > gl && Math.abs(b.x) < hw && b.y < FIELD.goalH) {
      // the team attacking the line the ball crossed scores
      const scoringTeam = (b.z > 0) === (this.attackSign(0) > 0) ? 0 : 1;
      this.score[scoringTeam]++;
      this.phase = 'goal'; this.phaseT = 0;
      this.goalFlash = 1;
      this.say('GOAL!', 'goal');
      this.power = false;
      this.emit();
    }
  }

  afterGoal() {
    // check win condition
    if (this.opts.goalsToWin > 0 && Math.max(...this.score) >= this.opts.goalsToWin) {
      this.phase = 'over'; this.winner = this.score[0] >= this.score[1] ? 0 : 1;
      this.say('TAMAT', 'over'); this.emit(); return;
    }
    if (this.checkTime()) return;
    // conceding team kicks off
    const conceder = this.score[0] > this.score[1] ? 1 : 0; // last scorer's opponent
    this.kickoff(conceder);
  }

  checkOutOfPlay(dt) {
    const b = this.ball;
    const hw = FIELD.W / 2 + 0.5;
    const hl = FIELD.L / 2 + 0.5;
    if (Math.abs(b.x) > hw || (Math.abs(b.z) > hl && !(Math.abs(b.x) < FIELD.goalW / 2))) {
      this.phase = 'dead'; this.phaseT = 0;
      const otherTeam = 1 - this.lastTouchTeam;
      if (Math.abs(b.z) > hl) {
        // goal kick or corner
        const defTeam = b.z > 0 ? (this.attackSign(0) > 0 ? 0 : 1) : (this.attackSign(0) < 0 ? 0 : 1);
        if (this.lastTouchTeam === defTeam) {
          // corner for attacker — not impl yet, give throw-in
        }
        this.nextAfterDead = () => {
          this.placeBall(clamp(b.x, -FIELD.W/2+1, FIELD.W/2-1), clamp(b.z, -(FIELD.L/2-2), FIELD.L/2-2));
          this.giveTurn(otherTeam, 'FREE KICK');
        };
      } else {
        this.nextAfterDead = () => {
          this.placeBall(clamp(b.x, -FIELD.W/2+1, FIELD.W/2-1), b.z);
          this.giveTurn(otherTeam, 'FREE KICK');
        };
      }
      this.say('Bola keluar!', 'info');
    }
  }

  onBallStopped() {
    if (this.checkTime()) return;
    // assign by proximity
    if (this.tapsInRow >= MAX_TAPS && this.lastTapTeam !== null) {
      const other = 1 - this.lastTapTeam;
      this.tapsInRow = 0; this.lastTapTeam = null;
      this.giveTurn(other, MAX_TAPS + ' TEPUKAN'); return;
    }
    const near = this.nearest(null);
    if (near) {
      if (near.team !== this.lastTapTeam) this.tapsInRow = 0;
      this.giveTurn(near.team);
    }
  }

  endMatch() {
    this.phase = 'over'; this.phaseT = 0;
    if (this.score[0] > this.score[1]) this.winner = 0;
    else if (this.score[1] > this.score[0]) this.winner = 1;
    else this.winner = null; // draw
    this.say('TAMAT', 'over'); this.emit();
  }

  turnTimeUp() {
    const other = 1 - this.turnTeam;
    this.clearAim();
    this.lastTapTeam = null; this.tapsInRow = 0;
    this.giveTurn(other, 'MASA TAMAT');
  }

  clearAim() { this.aim = { dx: 0, dz: 0, power: 0, active: false }; }

  // ── CPU AI ──
  cpuAction() {
    if (this.phase !== 'aim') return null;
    const skill = this.opts.cpuSkill ?? 0.5;
    const r = this.rand;
    const goalZ = this.attackSign(this.turnTeam) * (FIELD.L / 2);
    let dx = -this.ball.x + (r() - 0.5) * (1 - skill) * 4;
    let dz = goalZ - this.ball.z + (r() - 0.5) * (1 - skill) * 3;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    const power = 0.4 + r() * 0.5 * (0.5 + skill * 0.5);
    const shotIdx = r() < 0.6 ? 0 : r() < 0.8 ? 1 : 2;
    return { t: 'aim', dx, dz, power, shotIdx };
  }
}

// ── replay / checksum ───────────────────────────────────────
export function createEngine(setup, seat) {
  return new Engine({ ...setup, localTeam: seat });
}

const REST_PHASES = new Set(['aim', 'halftime', 'over']);

export function runToRest(engine, maxSteps = 120) {
  let t = 0;
  while (!REST_PHASES.has(engine.phase) && t < maxSteps) { engine.step(STEP); t += STEP; }
  return t;
}

export function replayLog(setup, log, seat) {
  const e = createEngine(setup, seat);
  runToRest(e);
  for (const a of log) {
    if (REST_PHASES.has(e.phase)) e._applyAction(a);
    runToRest(e);
  }
  return e;
}

export function checksum(e) {
  const n = (v, m = 1000) => Math.round(v * m);
  const ph = e.pieces.reduce((h, p) => (31 * h + 7 * n(p.home.x) + 13 * n(p.home.z) + p.charge) | 0, 7);
  return [e.score[0], e.score[1], e.phase, e.turnTeam, e.tapsInRow, n(e.clock, 10), n(e.ball.x), n(e.ball.z), ph].join('|');
}
