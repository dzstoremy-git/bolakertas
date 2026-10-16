// engine.js : Bola Kertas deterministic match engine.
// Shared by the browser and the server. Same setup + same actions => same match.

export const FIELD = { W: 12, L: 20, goalW: 3.2, goalD: 0.9, goalH: 0.95, postR: 0.06,
  boxW: 7.2, boxD: 3.2, areaW: 4, areaD: 1.2, spot: 2.2, circle: 1.6 };
export const BALL_R = 0.16;
export const PIECE = { w: 0.6, d: 0.42, h: 0.8 };
export const MAX_SPEED = 13;
export const DECEL = 3;
export const PIECE_BOUNCE = 0.55;
export const SHOT_TYPES = ['ground', 'chip', 'lob', 'curve'];
export const SHOT_ANGLE = { ground: 0, chip: 0.75, lob: 1.08, curve: 0.75 };
export const CURL = 0.12; // curve: radians of turn per metre travelled, bending toward the goal being attacked
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
export const KEEPER_RUSH = 0.9; // how far a keeper may come off the line to meet a shot
export const DEFEND_ZONE = 7;
export const POWER_CHARGE = 5;
export const POWER_SPEED = 28;
export const STEP = 1 / 60;
export const LOCKSTEP_AIM_S = 2;
export const PROTOCOL = 2;
export const DIVE = { left: 1.1, middle: 0, right: -1.1 }; // as seen from behind the shooter, who always shoots at +z
export const PEN_KICKS = 5; // bump when engine rules change: older clients are told to reload
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

// One step of ball flight: gravity, drag, rolling friction, curl, bounce. No bodies. Returns true on a real bounce.
export function integrate(b, dt) {
  const airborne = b.y > 0 || b.vy > 0;
  if (airborne) b.vy -= GRAVITY * dt;
  const drag = Math.max(0, 1 - AIR_DRAG * dt); b.vx *= drag; b.vz *= drag;
  const g = Math.hypot(b.vx, b.vz);
  if (b.curl && g > 0) { const a = b.curl * g * dt, c = Math.cos(a), s = Math.sin(a); [b.vx, b.vz] = [b.vx * c - b.vz * s, b.vx * s + b.vz * c]; }
  if (!airborne && g > 0) { const r = Math.max(0, g - DECEL * dt) / g; b.vx *= r; b.vz *= r; }
  b.x += b.vx * dt; b.z += b.vz * dt; b.y += b.vy * dt;
  if (b.y < 0) { b.y = 0; if (b.vy < -1.2) { b.vy = -b.vy * BOUNCE_KEEP_Y; b.vx *= BOUNCE_KEEP_XZ; b.vz *= BOUNCE_KEEP_XZ; if (b.curl) b.curl *= 0.5; return true; } b.vy = 0; }
  return false;
}
// Curve bends toward the middle of the goal being attacked: the side is fixed at the tap.
export const curlSide = (b, dx, dz, goalZ) => (dx * (goalZ - b.z) - dz * (0 - b.x) >= 0 ? 1 : -1);

export class Engine {
  constructor(opts) {
    this.opts = { minutes: 3, halves: true, goalsToWin: 0, turnLimit: 15, powerStrike: true, layout: 'spread',
      cpu: [false, true], cpuSkill: 0.5, formations: ['4-4-2', '4-4-2'], lockstep: false, ...opts };
    this.opts.paper = [{ ...BASE_STATS, ...(opts.paper?.[0] || {}) }, { ...BASE_STATS, ...(opts.paper?.[1] || {}) }];
    this.rand = makeRng(opts.seed ?? 1);
    this.pieces = []; this.ball = { x: 0, z: 0, vx: 0, vz: 0, y: 0, vy: 0, curl: 0 }; this.touchAt = { x: 0, z: 0 };
    this.score = [0, 0]; this.phase = 'aim'; this.phaseT = 0;
    this.turnTeam = 0; this.kicker = null; this.tapsInRow = 0; this.lastTapTeam = null; this.lastTouchTeam = 0;
    this.lastTapper = null; this.setPiece = 'kickoff'; this.clock = 0; this.half = 1; this.swapped = false;
    this.message = null; this.winner = null; this.lastGoal = null; this.nextAfterDead = null;
    this.turnT = 0; this.shotIgnore = null; this.events = []; this.acc = 0; this.shots = 0;
    this.startFormations = [...this.opts.formations];
    this.buildPieces(); this.applyLayout();
    if (this.opts.drill === 'penalties') { this.opts.minutes = 0; this.opts.powerStrike = false; this.kicks = [[], []]; this.drillIdx = this.opts.first ? 1 : 0; this.drill0 = this.drillIdx; this.startPenalty(); }
    else this.kickoff(this.opts.first ? 1 : 0); // coin toss winner kicks off
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
  separate(movable = () => true) { // only movable pieces shift; a fixed one pushes the other twice as far
    const edge = FIELD.W / 2 - 0.5, MIN_P = 1.15, MIN_C = 1.9;
    for (let pass = 0; pass < 60; pass++) {
      for (const a of this.pieces) for (const b of this.pieces) {
        if (a.id >= b.id) continue;
        const dx = b.kickoffHome.x - a.kickoffHome.x, dz = b.kickoffHome.z - a.kickoffHome.z, d = Math.hypot(dx, dz);
        if (d >= MIN_P) continue;
        const ma = movable(a), mb = movable(b); if (!ma && !mb) continue;
        const push = (MIN_P - d) / 2 * 1.2 * (ma && mb ? 1 : 2), nx = d > 1e-3 ? dx / d : (a.id % 2 ? 1 : -1), nz = d > 1e-3 ? dz / d : 0;
        if (!a.isGK && ma) { a.kickoffHome.x = clamp(a.kickoffHome.x - nx * push, -edge, edge); a.kickoffHome.z -= nz * push; }
        if (!b.isGK && mb) { b.kickoffHome.x = clamp(b.kickoffHome.x + nx * push, -edge, edge); b.kickoffHome.z += nz * push; }
      }
      for (const p of this.pieces) {
        if (!movable(p)) continue;
        const d = Math.hypot(p.kickoffHome.x, p.kickoffHome.z);
        if (d >= MIN_C) continue;
        const k = MIN_C / Math.max(d, 1e-3);
        p.kickoffHome.x = clamp(d > 1e-3 ? p.kickoffHome.x * k : (p.id % 2 ? MIN_C : -MIN_C), -edge, edge);
        p.kickoffHome.z = d > 1e-3 ? p.kickoffHome.z * k : 0;
      }
    }
  }

  placeBall(x, z) { Object.assign(this.ball, { x, z, vx: 0, vz: 0, y: 0, vy: 0, curl: 0 }); this.touchAt = { x, z }; }

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
    for (const p of this.pieces) p.down = false;
    for (const p of this.pieces) if (p !== kicker && !p.isGK) { p.x = p.home.x; p.z = p.home.z; }
    this.creditPass(kicker);
    this.kicker = kicker;
    const gz = this.attackSign(kicker.team) * FIELD.L / 2, dx = -this.ball.x, dz = gz - this.ball.z, l = Math.hypot(dx, dz) || 1;
    this.aim = { dx: dx / l, dz: dz / l };
    if (!kicker.isGK || this.setPiece === 'goalkick') { kicker.x = this.ball.x - this.aim.dx * KICK_OFFSET; kicker.z = this.ball.z - this.aim.dz * KICK_OFFSET; }
    this.phase = 'aim'; this.phaseT = 0; this.turnT = 0;
    this.ev('turn', { team: kicker.team, id: kicker.id });
  }

  // Power Strike meter: +1 when a tap reaches a teammate (no opponent touch on the way), +2 for scoring.
  creditPass(next) {
    const t = this.lastTapper;
    if (this.opts.powerStrike && t && t !== next && t.team === next.team && this.cleanPass) t.charge = Math.min(POWER_CHARGE, t.charge + 1);
  }

  // ── mid-game formation: own turn, while aiming. order[slot] = index into the team's pieces (by id).
  squadOf(team) { return this.pieces.filter(p => p.team === team).sort((a, b) => a.id - b.id); }
  lineup(team) { const order = []; this.squadOf(team).forEach((p, i) => { order[p.slot] = i; }); return { formation: this.opts.formations[team], order }; }
  startLineup(team) { return { formation: this.startFormations[team], order: this.squadOf(team).map((_, i) => i) }; }
  get canChangeLineup() { return this.phase === 'aim' && !!this.kicker; }
  setLineup(formation, order) {
    if (!this.canChangeLineup || !FORMATIONS[formation] || !Array.isArray(order)) return false;
    const team = this.turnTeam, sq = this.squadOf(team);
    if (order.length !== sq.length || new Set(order).size !== sq.length || order.some(i => !Number.isInteger(i) || i < 0 || i >= sq.length)) return false;
    const sign = this.attackSign(team), halfL = FIELD.L / 2;
    FORMATIONS[formation].forEach(([fx, fz], slot) => {
      const p = sq[order[slot]]; p.slot = slot; p.isGK = slot === 0;
      let z = fz; if (this.opts.layout === 'spread' && slot) z = clamp(2.5 * (fz + 0.75) - 0.68, -0.75, 0.72);
      p.kickoffHome = { x: fx * (FIELD.W / 2) * 0.86 * sign, z: z * halfL * sign };
    });
    if (this.opts.layout === 'spread') this.separate(p => p.team === team);
    for (const p of sq) { p.home = { ...p.kickoffHome }; if (p !== this.kicker) { p.x = p.home.x; p.z = p.home.z; } }
    if (this.kicker.isGK && this.setPiece !== 'goalkick') { const k = this.kicker; k.x = this.ball.x - this.aim.dx * KICK_OFFSET; k.z = this.ball.z - this.aim.dz * KICK_OFFSET; }
    const f = [...this.opts.formations]; f[team] = formation; this.opts = { ...this.opts, formations: f };
    this.ev('lineup', { team });
    return true;
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
    if (this.kicks && a.t === 'keep') { if (!this.needPick || !(a.pick in DIVE)) return false; this.keeperPick = a.pick; this.needPick = false; this.ev('keep'); return true; }
    if (this.kicks && a.t === 'aim' && this.needPick) return false;
    if (a.t === 'skip') { this.turnTimeUp(); return true; }
    if (a.t === 'lineup') return this.setLineup(a.formation, a.order);
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
    this.ball.curl = SHOT_TYPES[shot] === 'curve' ? curlSide(this.ball, dx, dz, this.attackSign(k.team) * FIELD.L / 2) * CURL : 0;
    this.touchAt = { x: this.ball.x, z: this.ball.z }; this.cleanPass = true; this.stopper = null;
    if (this.kicks) { this.keeperPick ||= this.cpuKeeperGuess(); this.keeperDiveX = DIVE[this.keeperPick]; }
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
    else if (ph === 'dead' && this.phaseT > (this.woodT ? 2.2 : 0.9) && this.nextAfterDead) { const f = this.nextAfterDead; this.nextAfterDead = null; this.woodT = false; f(); }
  }

  stepBall(dt) {
    const b = this.ball;
    if (integrate(b, dt)) this.ev('bounce', { v: b.vy });
    const minD = BALL_R + PIECE.w / 2;
    for (const p of this.pieces) {
      if (b.y > CARD_BLOCK_H) continue; // chips and lobs sail over the paper
      const dx = b.x - p.x, dz = b.z - p.z, d = Math.hypot(dx, dz);
      if (d >= minD || d < 1e-4) continue;
      if (this.shotIgnore?.has(p.id) || p.down) continue;
      if (this.power) { p.down = true; p.wobble = 1; b.vx *= 0.9; b.vz *= 0.9; if (p.team !== this.lastTapTeam) this.cleanPass = false; this.ev('blast', { id: p.id, dx: b.vx, dz: b.vz }); continue; }
      const nx = dx / d, nz = dz / d;
      b.x = p.x + nx * minD; b.z = p.z + nz * minD;
      const dot = b.vx * nx + b.vz * nz;
      if (dot < 0) {
        const e = PIECE_BOUNCE / statF(this.opts.paper[p.team].weight); // heavier paper kills the ball, so it stays with you
        b.vx -= (1 + e) * dot * nx; b.vz -= (1 + e) * dot * nz;
        b.vy = Math.max(b.vy, -dot * 0.12); // ball rides up the sloped paper a little
        p.wobble = Math.min(1, 0.4 + -dot * 0.08); b.curl = 0;
        this.lastTouchTeam = p.team; this.touchAt = { x: b.x, z: b.z }; if (p.team !== this.lastTapTeam) { this.cleanPass = false; this.stopper ||= p; }
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
        if (dot < 0) { if (this.power) return this.woodwork(gz); b.vx -= (1 + POST_BOUNCE) * dot * nx; b.vz -= (1 + POST_BOUNCE) * dot * nz; b.curl = 0; this.ev('post', { v: -dot }); }
      }
      if (Math.abs(b.x) < hw) { // crossbar
        const dy = b.y - FIELD.goalH, dz = b.z - gz, d = Math.hypot(dy, dz);
        if (d < rr && d > 1e-4) {
          const ny = dy / d, nz = dz / d, dot = b.vy * ny + b.vz * nz;
          b.y = FIELD.goalH + ny * rr; b.z = gz + nz * rr;
          if (dot < 0) { if (this.power) return this.woodwork(gz); b.vy -= (1 + POST_BOUNCE) * dot * ny; b.vz -= (1 + POST_BOUNCE) * dot * nz; b.curl = 0; this.ev('post', { v: -dot }); }
        }
      }
    }
  }

  // Keepers: cut the angle while the ball rests; once a shot is on the way they wait a reaction beat
  // (shorter for close shots, longer for skill-less AI), then run to where the ball will cross their box.
  updateKeepers(dt) {
    const skill = clamp(this.opts.cpuSkill ?? 0.5, 0, 1), b = this.ball, rolling = this.phase === 'rolling';
    for (const p of this.pieces) {
      if (!p.isGK || p === this.kicker) continue;
      if (this.phase === 'aim' && p === this.lastTapper) continue;
      if (this.kicks) { // penalty keeper commits to the picked side the moment the ball is struck
        if (p.team === this.turnTeam || !rolling || this.keeperDiveX == null) continue;
        let x = this.keeperDiveX; const side = Math.sign(x);
        if (b.vz > 0.3) { const t = b.x + b.vx / b.vz * (p.z - PIECE.d / 2 - b.z); x = side > 0 ? clamp(t, 0.55, FIELD.goalW / 2) : side < 0 ? clamp(t, -FIELD.goalW / 2, -0.55) : clamp(t, -0.45, 0.45); }
        p.x += clamp(x - p.x, -3.5 * dt, 3.5 * dt); continue;
      }
      const s = -this.attackSign(p.team), line = s * (FIELD.L / 2 - 0.35), goalZ = s * FIELD.L / 2;
      const ai = this.opts.cpu?.[p.team] ? skill : 0.7; // human side's keeper is automatic: fixed, fair skill
      let tx = 0.35 * b.x, tz = line, speed = KEEPER_SPEED * 1.4;
      if (!rolling) ({ x: tx, z: tz } = this.angleSpot(b, s, line, tx));
      const from = Math.hypot(this.touchAt.x, this.touchAt.z - goalZ), close = clamp((8 - from) / 5, 0, 1);
      const react = KEEPER_REACTION * (1.3 - 0.6 * ai) * (1 - 0.3 * close), coming = Math.sign(b.vz) === s && Math.abs(b.vz) > 0.3;
      if (rolling && coming && this.phaseT <= react) { tx = p.x; tz = p.z; }
      else if (rolling && coming) {
        speed = KEEPER_SPEED * (1.3 + 0.8 * ai) * (1 + 0.8 * clamp((from - 5) / 5, 0, 1));
        speed += (2.2 + 0.6 * ai - speed) * close;
        const hit = this.keeperIntercept(p, s, speed); if (hit) { tx = hit.x; tz = hit.z; }
      } else if (rolling) { tx = 0.35 * b.x; tz = line; }
      const lineIn = s * (FIELD.L / 2 - PIECE.d / 2 - 0.03);
      tx = clamp(tx, -FIELD.goalW / 2 - 0.1, FIELD.goalW / 2 + 0.1);
      tz = s > 0 ? clamp(tz, line - KEEPER_RUSH, lineIn) : clamp(tz, lineIn, line + KEEPER_RUSH);
      const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
      if (d > 1e-3) { const mv = Math.min(d, speed * dt); p.x += dx / d * mv; p.z += dz / d * mv; }
    }
  }
  // Stand on the line that halves the angle to both posts, stepping off the line as the ball gets close.
  angleSpot(b, s, line, x0) {
    const goalZ = s * FIELD.L / 2, out = { x: x0, z: line }, dist = Math.hypot(b.x, goalZ - b.z), near = clamp((12 - dist) / 6, 0, 1), depth = Math.abs(goalZ - b.z);
    if (near <= 0 || depth < 0.3) return out;
    const lineIn = s * (FIELD.L / 2 - PIECE.d / 2 - 0.03);
    out.z = lineIn + (line - lineIn) * clamp((depth - 0.8) / 2.2, 0, 1);
    const rx = FIELD.goalW / 2 - b.x, lx = -FIELD.goalW / 2 - b.x, dz = goalZ - b.z, a = Math.hypot(rx, dz), c = Math.hypot(lx, dz), bx = rx / a + lx / c, bz = dz / a + dz / c;
    if (Math.abs(bz) < 1e-3) return out;
    out.x = x0 + (b.x + bx / bz * (out.z - b.z) - x0) * near; return out;
  }
  // Fly the ball forward and return the first point the keeper can reach in time (or the closest miss). Only shots on target.
  keeperIntercept(p, s, speed) {
    const o = { ...this.ball }, gl = FIELD.L / 2, hx = PIECE.w / 2 + 0.6 * BALL_R, hz = PIECE.d / 2 + 0.6 * BALL_R, front = Math.abs(p.z) - KEEPER_RUSH - 0.35;
    let best = null, slack = Infinity;
    for (let t = STEP; t < 3; t += STEP) {
      integrate(o, STEP);
      if (o.z * s > gl) return Math.abs(o.x) < FIELD.goalW / 2 + BALL_R && o.y + BALL_R < FIELD.goalH ? best : null;
      if (o.y === 0 && o.vy === 0 && Math.hypot(o.vx, o.vz) < 0.05) return null;
      if (o.z * s < front || o.y >= CARD_BLOCK_H - 0.05) continue;
      const need = Math.hypot(Math.max(0, Math.abs(o.x - p.x) - hx), Math.max(0, Math.abs(o.z - p.z) - hz)) / speed - t;
      if (need <= 0) return { x: o.x, z: o.z };
      if (need < slack) { slack = need; best = { x: o.x, z: o.z }; }
    }
    return null;
  }

  // A Power Strike that smashes the frame: the goal is knocked flat and the defenders restart with a goal kick.
  woodwork(gz) {
    const s = Math.sign(gz), defender = (s > 0) === (this.attackSign(0) > 0) ? 1 : 0;
    this.power = false; this.woodT = true; this.phase = 'dead'; this.phaseT = 0; Object.assign(this.ball, { vx: 0, vz: 0, vy: 0, curl: 0 });
    this.ball.y = 0; this.ball.z = s * (FIELD.L / 2 - 0.3);
    this.say('TIANG!', 'Gol terbalik, sepakan gol', 'set'); this.ev('woodwork', { s });
    this.nextAfterDead = () => { this.placeBall(0, s * (FIELD.L / 2 - FIELD.areaD)); this.setPiece = 'goalkick'; this.lastTapTeam = null;
      this.giveTurn(defender, null, null, this.pieces.find(p => p.team === defender && p.isGK)); };
  }

  checkGoal() {
    const b = this.ball, hw = FIELD.goalW / 2, gl = FIELD.L / 2;
    if (!(Math.abs(b.z) > gl + BALL_R * 0.5 && Math.abs(b.x) < hw - 0.02 && b.y < FIELD.goalH)) return false;
    const team = (b.z > 0) === (this.attackSign(0) > 0) ? 0 : 1;
    this.score[team]++; if (this.kicks) this.kicks[team].push(true);
    const t = this.lastTapper;
    if (this.opts.powerStrike && !this.power && t && t.team === team) t.charge = Math.min(POWER_CHARGE, t.charge + 2);
    this.lastGoal = { team, own: !t || t.team !== team, number: t?.number, name: t?.name };
    b.vx *= 0.25; b.vz *= 0.25; b.vy *= 0.25;
    this.phase = 'goal'; this.phaseT = 0;
    this.say('GOL!', this.lastGoal.own ? 'Gol sendiri' : `#${t.number} ${t.name}`, 'goal');
    this.ev('goal', { team });
    return true;
  }

  afterGoal() {
    if (this.kicks) return this.nextKick();
    if (this.opts.goalsToWin > 0 && Math.max(...this.score) >= this.opts.goalsToWin) return this.endMatch();
    if (this.checkTime()) return;
    this.kickoff(1 - this.lastGoal.team);
  }

  checkOut() {
    const b = this.ball, hw = FIELD.W / 2, gl = FIELD.L / 2;
    const side = Math.abs(b.x) > hw + BALL_R, end = Math.abs(b.z) > gl + BALL_R;
    if (!side && !end) return false;
    if (this.kicks) { this.endKick(); return true; }
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
    if (this.kicks) return this.endKick();
    if (this.checkTime()) return;
    let near = this.nearest(null);
    if (near.team === this.lastTapTeam && this.tapsInRow >= MAX_TAPS) {
      const other = 1 - near.team;
      this.lastTapTeam = null; this.tapsInRow = 0;
      return this.giveTurn(other, `${MAX_TAPS} SEPAKAN HABIS`, 'Giliran bertukar', this.nearest(other));
    }
    this.giveTurn(near.team, null, null, near);
  }

  endMatch() {
    this.phase = 'over'; this.phaseT = 0;
    this.winner = this.score[0] > this.score[1] ? 0 : this.score[1] > this.score[0] ? 1 : null;
    this.say('TAMAT', `${this.score[0]} : ${this.score[1]}`, 'over'); this.ev('whistle', { long: true });
  }

  turnTimeUp() {
    if (this.kicks) return this.endKick('MASA HABIS');
    const other = 1 - this.turnTeam;
    this.lastTapTeam = null; this.tapsInRow = 0;
    this.giveTurn(other, 'MASA HABIS', 'Giliran bertukar', this.nearest(other));
  }

  // ── penalty shootout: 5 each, alternate, one tap per kick; then sudden death.
  startPenalty() {
    const t = this.drillIdx % 2, d = 1 - t, round = (this.drillIdx - this.drill0 >> 1) + 1, gl = FIELD.L / 2;
    this.swapped = t === 1; // the shooting side always attacks +z
    const spot = (p, x, z) => { p.home = { x, z }; p.kickoffHome = { x, z }; p.x = x; p.z = z; p.down = false; };
    const out = this.squadOf(t).filter(p => !p.isGK).sort((a, b) => b.slot - a.slot), shooter = out[(round - 1) % out.length];
    const row = (list, z) => list.forEach((p, i) => spot(p, 1 * (i - (list.length - 1) / 2), z));
    row(out.filter(p => p !== shooter), -1.2); row(this.squadOf(d).filter(p => !p.isGK), -2.6);
    for (const p of this.pieces) if (p.isGK) spot(p, 0, (p.team === d ? 1 : -1) * (gl - PIECE.d / 2 - 0.05));
    spot(shooter, 0, gl - FIELD.spot - 0.6); this.placeBall(0, gl - FIELD.spot);
    Object.assign(this, { setPiece: 'penalty', turnTeam: t, lastTapTeam: null, tapsInRow: 0, lastTapper: null, lastTouchTeam: t, keeperPick: null, keeperDiveX: null, stopper: null, kicker: null });
    this.needPick = !this.opts.cpu[d];
    this.startAim(shooter);
    this.say(round > PEN_KICKS ? 'MATI MENGEJUT' : 'PENALTI', round > PEN_KICKS ? '' : `${round} / ${PEN_KICKS}`, 'set'); this.ev('whistle');
  }
  endKick(why) {
    this.kicks[this.turnTeam].push(false); this.needPick = false;
    this.phase = 'dead'; this.phaseT = 0; Object.assign(this.ball, { vx: 0, vz: 0, vy: 0, curl: 0 });
    this.say(why || (this.stopper?.isGK ? 'SELAMAT!' : 'TERLEPAS'), `${this.score[0]} : ${this.score[1]}`, 'set');
    this.nextAfterDead = () => this.nextKick();
  }
  nextKick() { this.drillIdx++; if (this.penDecided()) this.endMatch(); else this.startPenalty(); }
  penDecided() {
    const [a, b] = this.kicks.map(k => k.length), [x, y] = this.score, N = PEN_KICKS;
    if (a <= N && b <= N && !(a === N && b === N)) return x + (N - a) < y || y + (N - b) < x;
    return a === b && x !== y;
  }
  cpuKeeperGuess() {
    const b = this.ball, s = this.aim, h = b.x + s.dx / Math.max(s.dz, 0.05) * (FIELD.L / 2 - b.z), read = h > 0.55 ? 'left' : h < -0.55 ? 'right' : 'middle';
    if (this.rand() < 0.3 * clamp(this.opts.cpuSkill ?? 0.5, 0, 1)) return read;
    const o = this.rand(); return o < 0.25 ? 'left' : o < 0.5 ? 'right' : 'middle';
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
    if (this.kicks) { const c = r() < 0.5 ? -1 : 1, x = c * (FIELD.goalW / 2 - 0.25 - r() * 0.5 * (1 - s)), ang = Math.atan2(x - b.x, gz - b.z) + (1 - s) * 0.12 * (r() * 2 - 1);
      return { t: 'aim', dx: Math.sin(ang), dz: Math.cos(ang), power: 0.75 + r() * 0.25, shot: r() < 0.2 ? 3 : 0 }; }
    if (this.canPowerStrike() && distGoal < 11 && r() < 0.5 + s * 0.4) return { t: 'aim', dx: 0, dz: sign, power: 1, shot: 0, ps: true };
    const gk = this.pieces.find(p => p.team !== team && p.isGK);
    let tx, tz, shooting = distGoal < 8.5;
    if (shooting) { const corner = gk && gk.x > 0 ? -1 : 1; tx = corner * (FIELD.goalW / 2 - 0.35); tz = gz + sign * 0.4; }
    else { tx = clamp(b.x * 0.4 + (r() - 0.5) * 5, -4.5, 4.5); tz = clamp(b.z + sign * (4.5 + r() * 3.5), -FIELD.L / 2 + 1, FIELD.L / 2 - 1); }
    const ang = Math.atan2(tx - b.x, tz - b.z) + (1 - s) * 0.32 * (r() * 2 - 1);
    const dx = Math.sin(ang), dz = Math.cos(ang), want = Math.hypot(tx - b.x, tz - b.z);
    const blocked = this.laneBlocked(dx, dz, Math.min(want, 5));
    const shot = blocked ? (shooting && r() < 0.35 + 0.3 * s ? 3 : want < 6 ? 1 : (r() < 0.5 ? 1 : 2)) : 0;
    const power = shooting ? clamp(0.82 + r() * 0.18, 0, 1) : clamp(Math.sqrt(want / 13.7) * 1.05 + (r() - 0.5) * 0.2 * (1 - s), 0.3, 1);
    return { t: 'aim', dx, dz, power, shot };
  }

  // Full rest state. The online server sends this after each action so clients can never drift.
  exportState() {
    return { b: [this.ball.x, this.ball.z], sc: [...this.score], ph: this.phase, tt: this.turnTeam, tr: this.tapsInRow,
      lt: this.lastTapTeam, lc: this.lastTouchTeam, ltp: this.lastTapper?.id ?? -1, k: this.kicker?.id ?? -1, c: this.clock,
      h: this.half, sw: this.swapped, sp: this.setPiece, w: this.winner, aim: this.aim, lg: this.lastGoal, msg: this.message,
      f: [...this.opts.formations], ta: this.touchAt, cp: !!this.cleanPass,
      p: this.pieces.map(p => [p.x, p.z, p.home.x, p.home.z, p.kickoffHome.x, p.kickoffHome.z, p.charge, p.slot]), r: this.rand.state() };
  }
  importState(s) {
    this.placeBall(s.b[0], s.b[1]); this.score = [...s.sc]; this.phase = s.ph; this.phaseT = 0; this.turnTeam = s.tt;
    this.tapsInRow = s.tr; this.lastTapTeam = s.lt; this.lastTouchTeam = s.lc; this.clock = s.c; this.half = s.h;
    this.swapped = s.sw; this.setPiece = s.sp; this.winner = s.w; this.aim = s.aim; this.lastGoal = s.lg; this.message = s.msg;
    s.p.forEach((a, i) => { const p = this.pieces[i]; p.x = a[0]; p.z = a[1]; p.home = { x: a[2], z: a[3] }; p.kickoffHome = { x: a[4], z: a[5] }; p.charge = a[6]; if (a[7] !== undefined) { p.slot = a[7]; p.isGK = a[7] === 0; } });
    if (s.f) this.opts = { ...this.opts, formations: [...s.f] }; if (s.ta) this.touchAt = { ...s.ta }; this.cleanPass = !!s.cp;
    this.rand.set(s.r); this.lastTapper = this.pieces[s.ltp] || null; this.kicker = this.pieces[s.k] || null; this.shotIgnore = null;
  }
}

const REST = new Set(['aim', 'halftime', 'over']);
export const isRest = e => REST.has(e.phase);
export function runToRest(e, max = 60) { let t = 0; while (!REST.has(e.phase) && t < max) { e.step(STEP); t += STEP; } e.events.length = 0; return t; }
export function checksum(e) {
  const n = (v, m = 1000) => Math.round(v * m);
  const ph = e.pieces.reduce((h, p) => (31 * h + 7 * n(p.x) + 13 * n(p.z) + p.charge + 17 * p.slot) | 0, 7);
  return [e.score[0], e.score[1], e.phase, e.turnTeam, e.tapsInRow, n(e.clock, 10), n(e.ball.x), n(e.ball.z), ph].join('|');
}

// Ball-only flight preview for the aim guide. Ignores bodies on purpose.
export function predictPath(e, dx, dz, power, shot, ps = false) {
  const st = e.opts.paper[e.kicker?.team ?? 0];
  if (ps) { const gz = e.attackSign(e.kicker.team) * FIELD.L / 2, ex = -e.ball.x, ez = gz - e.ball.z, l = Math.hypot(ex, ez) || 1; dx = ex / l; dz = ez / l; shot = 0; }
  const speed = ps ? POWER_SPEED : power * MAX_SPEED * statF(st.power), ang = SHOT_ANGLE[SHOT_TYPES[shot]];
  const b = { x: e.ball.x, z: e.ball.z, y: 0, vx: dx * speed * Math.cos(ang), vz: dz * speed * Math.cos(ang), vy: speed * Math.sin(ang), curl: 0 };
  if (SHOT_TYPES[shot] === 'curve') b.curl = curlSide(b, dx, dz, e.attackSign(e.kicker?.team ?? 0) * FIELD.L / 2) * CURL;
  const pts = []; let land = null;
  for (let i = 0; i < 240; i++) {
    const bx = b.x, bz = b.z;
    if (integrate(b, STEP) && !land) land = { x: bx, z: bz };
    if (i % 3 === 0) pts.push({ x: b.x, y: b.y, z: b.z });
    if (Math.abs(b.x) > FIELD.W / 2 + 1 || Math.abs(b.z) > FIELD.L / 2 + 1) break;
    if (Math.hypot(b.vx, b.vz) < 0.15 && b.y === 0) break;
  }
  return { pts, land, end: pts[pts.length - 1] };
}
