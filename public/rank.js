// rank.js : ranked points, tiers, seasons and weeks. Shared by server (authority) and app (display).
// One season = 28 days from SEASON_EPOCH. Weeks reset Monday 00:00 Malaysia time (UTC+8).
export const SEASON_EPOCH = Date.UTC(2026, 9, 12, 16); // Mon 13 Oct 2026 00:00 MYT
export const SEASON_MS = 28 * 864e5, WEEK_MS = 7 * 864e5;
export const START_RP = 1000;
export const seasonOf = (t = Date.now()) => Math.max(1, Math.floor((t - SEASON_EPOCH) / SEASON_MS) + 1);
export const seasonEnds = (s = seasonOf()) => SEASON_EPOCH + s * SEASON_MS;
export const weekOf = (t = Date.now()) => Math.floor((t - SEASON_EPOCH) / WEEK_MS) + 1;

// Paper themed tiers. Each spans 150 RP split into 3 divisions (III, II, I). Legend = 2050+ and also top 100 on the board.
export const TIERS = [
  { id: 'scrap', rp: 0, color: '#9aa6c4' }, { id: 'kajang', rp: 1100, color: '#5fb0ff' }, { id: 'manila', rp: 1250, color: '#e3b866' },
  { id: 'card', rp: 1400, color: '#c98a4b' }, { id: 'laminate', rp: 1550, color: '#46d3c4' }, { id: 'carbon', rp: 1700, color: '#7a6bff' },
  { id: 'gold', rp: 1850, color: '#ffc21e' }, { id: 'legend', rp: 2050, color: '#ff5fd2' },
];
export function tierOf(rp) {
  let i = 0; while (i + 1 < TIERS.length && rp >= TIERS[i + 1].rp) i++;
  const t = TIERS[i], next = TIERS[i + 1], span = next ? next.rp - t.rp : 0;
  const div = next && t.rp > 0 ? 3 - Math.min(2, Math.floor((rp - t.rp) / (span / 3))) : next ? 3 - Math.min(2, Math.floor(rp / (next.rp / 3))) : 0;
  return { ...t, index: i, div, next: next?.rp ?? null };
}

// Elo with K 32, floor at 0. Winner always gains at least 8, loser never loses more than 30.
export function rpDelta(a, b, scoreA) { // scoreA: 1 win, 0.5 draw, 0 loss
  const exp = 1 / (1 + 10 ** ((b - a) / 400)), d = Math.round(32 * (scoreA - exp));
  return scoreA === 1 ? Math.max(8, d) : scoreA === 0 ? Math.max(-30, Math.min(-4, d)) : d;
}
// Soft reset between seasons: halfway back towards the start.
export const softReset = rp => Math.round(START_RP + (rp - START_RP) / 2);
