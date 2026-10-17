// server.js : Bola Kertas. Static files, Telegram auth, shop + Stars, CPU match rewards, online rooms.
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync, readdirSync, unlinkSync, renameSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { WebSocketServer } from 'ws';
import { Engine, runToRest, isRest, makeCode, BASE_STATS, FORMATIONS, PROTOCOL } from './public/engine.js';
import { teamById, rosterFor, cleanRoster, cleanKit } from './public/teams.js';
import { ITEMS, itemById, DEFAULT_EQUIP, SLOTS, matchReward, DAILY_COIN_CAP, PRO, isOwned, aiEquip, tossResult } from './public/items.js';
import { langFrom, itemName, itemDesc, trMs, LANGS } from './public/i18n.js';
import { seasonOf, weekOf, rpDelta, softReset, tierOf, START_RP, seasonEnds } from './public/rank.js';
export const catalog = { ITEMS, itemById };

const PORT = +(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const WEBAPP_URL = (process.env.WEBAPP_URL || '').replace(/\/$/, '');
const DATA_DIR = process.env.DATA_DIR || './data';
const FEEDBACK_CHAT = process.env.FEEDBACK_CHAT || '58542524'; // owner DM for player feedback
const PUBLIC = normalize(new URL('./public/', import.meta.url).pathname);
const SECRET = createHash('sha256').update('bk-sign:' + (BOT_TOKEN || 'dev')).digest();
const WH_SECRET = createHash('sha256').update('bk-wh:' + (BOT_TOKEN || 'dev')).digest('hex').slice(0, 48);

// ── storage ────────────────────────────────────────────────
mkdirSync(DATA_DIR, { recursive: true });
export const db = new DatabaseSync(join(DATA_DIR, 'bolakertas.db'));
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users (uid INTEGER PRIMARY KEY, name TEXT, coins INTEGER NOT NULL DEFAULT 200 CHECK (coins >= 0),
  equip TEXT NOT NULL DEFAULT '{}', pass_until INTEGER NOT NULL DEFAULT 0, day TEXT, day_coins INTEGER NOT NULL DEFAULT 0, created INTEGER);
CREATE TABLE IF NOT EXISTS owned (uid INTEGER NOT NULL, item TEXT NOT NULL, src TEXT, at INTEGER, PRIMARY KEY (uid, item));
CREATE TABLE IF NOT EXISTS payments (charge_id TEXT PRIMARY KEY, uid INTEGER NOT NULL, item TEXT NOT NULL, stars INTEGER NOT NULL, at INTEGER);
CREATE TABLE IF NOT EXISTS matches (mid TEXT PRIMARY KEY, uid INTEGER NOT NULL, setup TEXT NOT NULL, created INTEGER, done INTEGER NOT NULL DEFAULT 0);`);
try { db.exec("ALTER TABLE users ADD COLUMN squad TEXT NOT NULL DEFAULT '{}'"); } catch {} // per-team names/numbers + studio kit
try { db.exec('ALTER TABLE users ADD COLUMN pro_until INTEGER NOT NULL DEFAULT 0'); } catch {} // PRO subscription paid up to
try { db.exec("ALTER TABLE users ADD COLUMN photo TEXT NOT NULL DEFAULT ''"); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN ref INTEGER NOT NULL DEFAULT 0'); } catch {} // who invited this player (share link); 0 = nobody or already paid
// Ranked call-out: last app open, opt-out (1 = tapped mute, 2 = bot blocked), pings received today.
for (const c of ['seen INTEGER NOT NULL DEFAULT 0', 'ping_off INTEGER NOT NULL DEFAULT 0', "ping_day TEXT NOT NULL DEFAULT ''", 'ping_n INTEGER NOT NULL DEFAULT 0', 'snooze INTEGER NOT NULL DEFAULT 0']) try { db.exec('ALTER TABLE users ADD COLUMN ' + c); } catch {}
db.exec('UPDATE users SET seen=created WHERE seen=0 AND created IS NOT NULL'); // existing players count as active from sign-up
export const REF_REWARD = 100;
// Invite link /start ref_<uid>: only a brand-new player can be credited, never yourself.
export function setRef(uid, by) { if (!by || by === uid || !q('SELECT 1 FROM users WHERE uid=?').get(by)) return false; return q('UPDATE users SET ref=? WHERE uid=? AND ref=0 AND created > ?').run(by, uid, Date.now() - 600e3).changes > 0; }
// First finished match pays the inviter once (ref reset to 0 so it can never pay twice).
export function payRef(uid) { const r = q('SELECT ref FROM users WHERE uid=?').get(uid)?.ref; if (!r || r < 0) return 0; q('UPDATE users SET ref=-1 WHERE uid=?').run(uid); q('UPDATE users SET coins=coins+? WHERE uid=?').run(REF_REWARD, r); return r; } // Telegram profile photo URL (from signed initData)
// Ranked: one row per player per season; every settled ranked match logged (weekly board + same-pair daily cap).
db.exec(`CREATE TABLE IF NOT EXISTS rank (uid INTEGER NOT NULL, season INTEGER NOT NULL, rp INTEGER NOT NULL, best INTEGER NOT NULL, w INTEGER NOT NULL DEFAULT 0, l INTEGER NOT NULL DEFAULT 0, d INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (uid, season));
CREATE TABLE IF NOT EXISTS rmatch (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, season INTEGER NOT NULL, week INTEGER NOT NULL, a INTEGER NOT NULL, b INTEGER NOT NULL, sa REAL NOT NULL, da INTEGER NOT NULL, db INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS rmatch_week ON rmatch (week); CREATE INDEX IF NOT EXISTS rmatch_pair ON rmatch (a, b, at);`);
// Friend leagues: members play each other; table per season; inviter earns coins when the invitee plays their first league match.
db.exec(`CREATE TABLE IF NOT EXISTS league (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, color TEXT NOT NULL, owner INTEGER NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS league_member (lid INTEGER NOT NULL, uid INTEGER NOT NULL, by INTEGER, rewarded INTEGER NOT NULL DEFAULT 0, joined INTEGER NOT NULL, PRIMARY KEY (lid, uid));
CREATE TABLE IF NOT EXISTS league_match (id INTEGER PRIMARY KEY AUTOINCREMENT, lid INTEGER NOT NULL, season INTEGER NOT NULL, a INTEGER NOT NULL, b INTEGER NOT NULL, ga INTEGER NOT NULL, gb INTEGER NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS lm_lid ON league_match (lid, season);`);
// Official league: sign-ups per season, opens only once OL.min players signed up. Daily 1v1 at 21:00 MYT, 10 minutes to show up.
db.exec(`CREATE TABLE IF NOT EXISTS ol_player (uid INTEGER NOT NULL, season INTEGER NOT NULL, div INTEGER NOT NULL DEFAULT 0, lang TEXT NOT NULL DEFAULT 'ms', pts INTEGER NOT NULL DEFAULT 0, p INTEGER NOT NULL DEFAULT 0, w INTEGER NOT NULL DEFAULT 0, d INTEGER NOT NULL DEFAULT 0, l INTEGER NOT NULL DEFAULT 0, gf INTEGER NOT NULL DEFAULT 0, ga INTEGER NOT NULL DEFAULT 0, miss INTEGER NOT NULL DEFAULT 0, out INTEGER NOT NULL DEFAULT 0, joined INTEGER NOT NULL, PRIMARY KEY (uid, season));
CREATE TABLE IF NOT EXISTS ol_match (id INTEGER PRIMARY KEY AUTOINCREMENT, season INTEGER NOT NULL, day TEXT NOT NULL, div INTEGER NOT NULL, a INTEGER NOT NULL, b INTEGER NOT NULL, room TEXT, state TEXT NOT NULL DEFAULT 'sched', ga INTEGER, gb INTEGER, how TEXT);
CREATE TABLE IF NOT EXISTS ol_day (day TEXT PRIMARY KEY, paired INTEGER NOT NULL DEFAULT 0, opened INTEGER NOT NULL DEFAULT 0, closed INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS ol_season (season INTEGER PRIMARY KEY, started INTEGER NOT NULL DEFAULT 0, paid INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, uid INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, ctx TEXT, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS olm_day ON ol_match (day, state);`);
const q = sql => db.prepare(sql);
const tx = fn => { db.exec('BEGIN IMMEDIATE'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };

function getUser(uid, name, photo) {
  let u = q('SELECT * FROM users WHERE uid=?').get(uid);
  if (!u) { q('INSERT INTO users (uid,name,equip,created) VALUES (?,?,?,?)').run(uid, name || '', JSON.stringify(DEFAULT_EQUIP), Date.now()); u = q('SELECT * FROM users WHERE uid=?').get(uid); }
  else if (name && name !== u.name) q('UPDATE users SET name=? WHERE uid=?').run(name, uid);
  if (photo !== undefined && photo !== u.photo) q('UPDATE users SET photo=? WHERE uid=?').run(photo, uid); // Telegram name + photo follow every app open
  return u;
}
// Only Telegram's own CDN; anything else is dropped.
export const cleanPhoto = p => /^https:\/\/t\.me\/i\/userpic\/[\w/.-]{1,200}$/.test(String(p || '')) ? String(p) : '';
const photoOf = uid => q('SELECT photo FROM users WHERE uid=?').get(uid)?.photo || '';
const ownedSet = uid => new Set([...ITEMS.filter(i => i.free).map(i => i.id), ...q('SELECT item FROM owned WHERE uid=?').all(uid).map(r => r.item)]);
function profile(uid) {
  const u = q('SELECT * FROM users WHERE uid=?').get(uid);
  const equip = { ...DEFAULT_EQUIP, ...JSON.parse(u.equip || '{}') };
  return { uid, name: u.name, photo: u.photo || '', coins: u.coins, equip, owned: [...ownedSet(uid)], passUntil: u.pass_until, proUntil: u.pro_until, squad: JSON.parse(u.squad || '{}') };
}
export const isPro = (uid, now = Date.now()) => !!uid && (q('SELECT pro_until FROM users WHERE uid=?').get(uid)?.pro_until || 0) > now;
// Star player skins: { slot(0-10): itemId }, only star items the user owns. Style only.
const cleanStars = (st, owned) => { const o = {}; for (const [k, v] of Object.entries(st && typeof st === 'object' ? st : {})) { const i = +k, it = itemById(v); if (i >= 0 && i <= 10 && Number.isInteger(i) && it?.slot === 'star' && owned.has(it.id)) o[i] = it.id; } return o; };
// A season-limited item is only for sale during its season.
export const onSale = (item, now = Date.now()) => !item.season || item.season === seasonOf(now);
// Saved squad: { roster:{names,numbers}, kit:{studio kit}|null }. Applied to whichever team the user plays as.
export function saveSquad(uid, body) {
  const owned = ownedSet(uid), squad = { roster: body.roster ? cleanRoster(body.roster) : null, kit: cleanKit(body.kit, owned.has('k_studio')), stars: cleanStars(body.stars, owned) };
  q('UPDATE users SET squad=? WHERE uid=?').run(JSON.stringify(squad), uid); return squad;
}
const squadOf = uid => uid ? JSON.parse(q('SELECT squad FROM users WHERE uid=?').get(uid)?.squad || '{}') : {};
const paperStats = uid => { if (!uid) return { ...BASE_STATS }; const id = profile(uid).equip.paper; return { ...BASE_STATS, ...(itemById(id)?.stats || {}) }; };

// ── ranked ─────────────────────────────────────────────────
// A player's row for this season. First visit of a season starts from a soft reset of the last season played.
export function rankRow(uid, season = seasonOf()) {
  let r = q('SELECT * FROM rank WHERE uid=? AND season=?').get(uid, season);
  if (!r) {
    const prev = q('SELECT rp FROM rank WHERE uid=? AND season<? ORDER BY season DESC LIMIT 1').get(uid, season), rp = prev ? softReset(prev.rp) : START_RP;
    q('INSERT INTO rank (uid,season,rp,best) VALUES (?,?,?,?)').run(uid, season, rp, rp); r = q('SELECT * FROM rank WHERE uid=? AND season=?').get(uid, season);
  }
  return r;
}
export const PAIR_DAILY = 3, MIN_RANKED_MS = 60e3;
// Settle one ranked result. scoreA: 1 a won, 0.5 draw, 0 b won. Returns per-player deltas, or a reason it does not count.
export function settleRanked(a, b, scoreA, durationMs, now = Date.now()) {
  if (!a || !b || a === b) return { counted: false, why: 'players' };
  if (durationMs < MIN_RANKED_MS) return { counted: false, why: 'short' };
  return tx(() => {
    const [x, y] = a < b ? [a, b] : [b, a], n = q('SELECT COUNT(*) n FROM rmatch WHERE ((a=? AND b=?) OR (a=? AND b=?)) AND at>?').get(x, y, y, x, now - 864e5).n;
    if (n >= PAIR_DAILY) return { counted: false, why: 'pair' };
    const s = seasonOf(now), ra = rankRow(a, s), rb = rankRow(b, s), da = rpDelta(ra.rp, rb.rp, scoreA), db2 = rpDelta(rb.rp, ra.rp, 1 - scoreA);
    const col = sc => sc === 1 ? 'w' : sc === 0 ? 'l' : 'd';
    for (const [uid, r, d, sc] of [[a, ra, da, scoreA], [b, rb, db2, 1 - scoreA]]) {
      const rp = Math.max(0, r.rp + d); q(`UPDATE rank SET rp=?, best=MAX(best,?), ${col(sc)}=${col(sc)}+1 WHERE uid=? AND season=?`).run(rp, rp, uid, s);
    }
    q('INSERT INTO rmatch (at,season,week,a,b,sa,da,db) VALUES (?,?,?,?,?,?,?,?)').run(now, s, weekOf(now), a, b, scoreA, da, db2);
    return { counted: true, [a]: { delta: da, rp: Math.max(0, ra.rp + da), before: ra.rp }, [b]: { delta: db2, rp: Math.max(0, rb.rp + db2), before: rb.rp } };
  });
}
// ── friend leagues ─────────────────────────────────────────
export const LEAGUE_FREE = { own: 1, members: 8 }, leagueLimits = uid => isPro(uid) ? PRO.leagues : LEAGUE_FREE, LEAGUE_COLORS = ['#4fb3ff', '#ff5d73', '#3fd1a2', '#ffc93c', '#9d85ff', '#ff9f66'], INVITE_REWARD = 100;
const cleanName = s => String(s || '').replace(/[<>&"'\u0000-\u001f]/g, '').trim().slice(0, 24);
const isMember = (lid, uid) => !!q('SELECT 1 FROM league_member WHERE lid=? AND uid=?').get(lid, uid);
export function createLeague(uid, name, color) {
  name = cleanName(name); if (name.length < 3) return { ok: false, err: 'name' };
  if (q('SELECT COUNT(*) n FROM league WHERE owner=?').get(uid).n >= leagueLimits(uid).own) return { ok: false, err: 'limit' };
  let code; do code = makeCode(6); while (q('SELECT 1 FROM league WHERE code=?').get(code));
  return tx(() => { const id = q('INSERT INTO league (code,name,color,owner,created) VALUES (?,?,?,?,?)').run(code, name, LEAGUE_COLORS.includes(color) ? color : LEAGUE_COLORS[0], uid, Date.now()).lastInsertRowid;
    q('INSERT INTO league_member (lid,uid,joined) VALUES (?,?,?)').run(id, uid, Date.now()); return { ok: true, id: Number(id), code }; });
}
export function joinLeague(uid, code, by = 0) {
  const lg = q('SELECT * FROM league WHERE code=?').get(String(code || '').toUpperCase()); if (!lg) return { ok: false, err: 'no_league' };
  if (isMember(lg.id, uid)) return { ok: true, id: lg.id, already: true };
  if (q('SELECT COUNT(*) n FROM league_member WHERE lid=?').get(lg.id).n >= leagueLimits(lg.owner).members) return { ok: false, err: 'full' };
  const inviter = by && by !== uid && isMember(lg.id, by) ? by : lg.owner !== uid ? lg.owner : null;
  q('INSERT INTO league_member (lid,uid,by,joined) VALUES (?,?,?,?)').run(lg.id, uid, inviter, Date.now()); return { ok: true, id: lg.id };
}
export function leaveLeague(uid, lid) {
  const lg = q('SELECT * FROM league WHERE id=?').get(lid); if (!lg || !isMember(lid, uid)) return { ok: false, err: 'no_league' };
  tx(() => { q('DELETE FROM league_member WHERE lid=? AND uid=?').run(lid, uid);
    const next = q('SELECT uid FROM league_member WHERE lid=? ORDER BY joined LIMIT 1').get(lid);
    if (!next) { q('DELETE FROM league WHERE id=?').run(lid); q('DELETE FROM league_match WHERE lid=?').run(lid); } else if (lg.owner === uid) q('UPDATE league SET owner=? WHERE id=?').run(next.uid, lid); });
  return { ok: true };
}
// Record a finished league game. Same pair counts 3 times a day; under a minute does not count. Pays the inviter once per invitee.
export function recordLeague(lid, a, b, ga, gb, durationMs, now = Date.now()) {
  if (!a || !b || a === b || !isMember(lid, a) || !isMember(lid, b)) return { counted: false, why: 'players' };
  if (durationMs < MIN_RANKED_MS) return { counted: false, why: 'short' };
  return tx(() => {
    const n = q('SELECT COUNT(*) n FROM league_match WHERE lid=? AND ((a=? AND b=?) OR (a=? AND b=?)) AND at>?').get(lid, a, b, b, a, now - 864e5).n;
    if (n >= PAIR_DAILY) return { counted: false, why: 'pair' };
    q('INSERT INTO league_match (lid,season,a,b,ga,gb,at) VALUES (?,?,?,?,?,?,?)').run(lid, seasonOf(now), a, b, ga, gb, now);
    const paid = [];
    for (const uid of [a, b]) { const m = q('SELECT by, rewarded FROM league_member WHERE lid=? AND uid=?').get(lid, uid);
      if (m.by && !m.rewarded) { q('UPDATE league_member SET rewarded=1 WHERE lid=? AND uid=?').run(lid, uid); q('UPDATE users SET coins=coins+? WHERE uid=?').run(INVITE_REWARD, m.by); paid.push(m.by); } }
    return { counted: true, paid };
  });
}
// Table: 3 points a win, 1 a draw; ties on goal difference, then goals scored. Members who have not played sit at the bottom.
export function leagueTable(lid, me = 0, now = Date.now()) {
  const lg = q('SELECT * FROM league WHERE id=?').get(lid); if (!lg || (me && !isMember(lid, me))) return null;
  const season = seasonOf(now), rows = new Map();
  for (const m of q('SELECT lm.uid, COALESCE(u.name, \'\') name FROM league_member lm LEFT JOIN users u ON u.uid=lm.uid WHERE lid=? ORDER BY joined').all(lid)) rows.set(m.uid, { uid: m.uid, name: m.name.slice(0, 20) || 'Pemain', p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 });
  for (const x of q('SELECT * FROM league_match WHERE lid=? AND season=?').all(lid, season))
    for (const [uid, f, ag] of [[x.a, x.ga, x.gb], [x.b, x.gb, x.ga]]) { const r = rows.get(uid); if (!r) continue; r.p++; r.gf += f; r.ga += ag; if (f > ag) { r.w++; r.pts += 3; } else if (f === ag) { r.d++; r.pts++; } else r.l++; }
  const table = [...rows.values()].sort((x, y) => y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf || y.p - x.p).map((r, i) => ({ ...r, pos: i + 1, me: r.uid === me, pro: isPro(r.uid), photo: photoOf(r.uid), uid: undefined }));
  const recent = q('SELECT lm.ga, lm.gb, lm.at, COALESCE(ua.name,\'\') an, COALESCE(ub.name,\'\') bn FROM league_match lm LEFT JOIN users ua ON ua.uid=lm.a LEFT JOIN users ub ON ub.uid=lm.b WHERE lid=? ORDER BY at DESC LIMIT 5').all(lid);
  return { id: lg.id, code: lg.code, name: lg.name, color: lg.color, owner: lg.owner === me, season, ends: seasonEnds(season), max: leagueLimits(lg.owner).members, table, recent: recent.map(r => ({ a: r.an.slice(0, 20), b: r.bn.slice(0, 20), ga: r.ga, gb: r.gb, at: r.at })) };
}
export const myLeagues = uid => q('SELECT l.id, l.code, l.name, l.color, l.owner=? own, (SELECT COUNT(*) FROM league_member x WHERE x.lid=l.id) n FROM league l JOIN league_member m ON m.lid=l.id AND m.uid=? ORDER BY m.joined').all(uid, uid).map(r => ({ ...r, own: !!r.own }));

// ── official league ────────────────────────────────────────
// ponytail: one fixed daily slot for everybody; add a second slot when players outside UTC+8 ask for it
export const OL = { min: +(process.env.OL_MIN || 32), kickUTC: 13, joinMin: 10, warnMin: 30, divSize: 64, outAfter: 3,
  prize: [3000, 1500, 1000, 500, 500, 500, 500, 500, 500, 500], loyal: { games: 20, coins: 300 }, champBall: 'b_champion' };
const mytDay = t => new Date(t + 8 * 3600e3).toISOString().slice(0, 10);
const kickAt = day => Date.parse(day + 'T00:00:00Z') + OL.kickUTC * 3600e3;
export const olOut = []; // bot messages captured in tests
async function olSay(uid, lang, kind, d = {}, button) {
  const text = botText(kind, { lang, ...d }); if (process.env.NODE_ENV === 'test') return olOut.push({ uid, kind, text });
  return say(uid, text, button ? kb([[{ text: L(lang).b_play, web_app: { url: WEBAPP_URL + button } }]]) : undefined);
}
const olCount = s => q('SELECT COUNT(*) n FROM ol_player WHERE season=?').get(s).n;
const olStarted = s => !!q('SELECT started FROM ol_season WHERE season=?').get(s)?.started;
const nameOf = uid => (q('SELECT name FROM users WHERE uid=?').get(uid)?.name || 'Pemain').slice(0, 20);
export function olJoin(uid, lang = 'ms', now = Date.now()) {
  const s = seasonOf(now); if (q('SELECT 1 FROM ol_player WHERE uid=? AND season=?').get(uid, s)) return { ok: true, already: true };
  q('INSERT INTO ol_player (uid,season,lang,joined,div) VALUES (?,?,?,?,?)').run(uid, s, LANGS.includes(lang) ? lang : 'ms', now, olStarted(s) ? olLastDiv(s) : 0);
  olMaybeStart(s, now); return { ok: true };
}
const olLastDiv = s => q('SELECT MAX(div) d FROM ol_player WHERE season=?').get(s).d || 0; // late joiners start in the lowest division
// Opens the season once enough players signed up: divisions of OL.divSize ordered by last season's finish (newcomers last).
function olMaybeStart(s, now) {
  q('INSERT OR IGNORE INTO ol_season (season) VALUES (?)').run(s);
  if (olStarted(s) || olCount(s) < OL.min) return false;
  const prev = new Map(q('SELECT uid, div, pts, gf-ga gd FROM ol_player WHERE season=? ORDER BY div, pts DESC, gd DESC').all(s - 1).map((r, i) => [r.uid, i]));
  const ids = q('SELECT uid, lang FROM ol_player WHERE season=? ORDER BY joined').all(s).sort((a, b) => (prev.get(a.uid) ?? 1e9) - (prev.get(b.uid) ?? 1e9));
  tx(() => { ids.forEach((r, i) => q('UPDATE ol_player SET div=? WHERE uid=? AND season=?').run(Math.floor(i / OL.divSize), r.uid, s)); q('UPDATE ol_season SET started=? WHERE season=?').run(now, s); });
  for (const r of ids) olSay(r.uid, r.lang, 'ol_started', { time: '21:00' }, '/?official=1');
  return true;
}
// Swiss pairing: closest points first, never the same opponent twice a season when avoidable. Odd count: lowest without a bye rests (+1 pt).
export function pairSwiss(players, played, byes = new Set()) {
  const left = [...players], pairs = []; let bye = null;
  if (left.length % 2) { const i = left.map(p => p.uid).reverse().findIndex(u => !byes.has(u)); bye = left.splice(i < 0 ? left.length - 1 : left.length - 1 - i, 1)[0].uid; }
  // backtracking: nearest-in-standings first; ponytail: exponential worst case, fine for 64-player divisions, cap tries and fall back to greedy
  let tries = 0;
  const go = rest => { if (!rest.length) return []; const [x, ...others] = rest;
    for (let j = 0; j < others.length && tries++ < 20000; j++) { if (played.has(x.uid + ':' + others[j].uid)) continue; const sub = go(others.filter((_, k) => k !== j)); if (sub) return [[x.uid, others[j].uid], ...sub]; }
    return null; };
  const best = go(left);
  if (best) return { pairs: best, bye };
  while (left.length) { const a = left.shift(); let j = left.findIndex(b => !played.has(a.uid + ':' + b.uid)); if (j < 0) j = 0; pairs.push([a.uid, left.splice(j, 1)[0].uid]); }
  return { pairs, bye };
}
function olPair(s, day) {
  const divs = q('SELECT DISTINCT div FROM ol_player WHERE season=? AND out=0').all(s).map(r => r.div);
  for (const div of divs) {
    const ps = q('SELECT uid FROM ol_player WHERE season=? AND div=? AND out=0 ORDER BY pts DESC, gf-ga DESC, gf DESC, joined').all(s, div);
    if (ps.length < 2) continue;
    const played = new Set(), byes = new Set();
    for (const m of q('SELECT a, b FROM ol_match WHERE season=? AND div=?').all(s, div)) { if (m.b) { played.add(m.a + ':' + m.b); played.add(m.b + ':' + m.a); } else byes.add(m.a); }
    const { pairs, bye } = pairSwiss(ps, played, byes);
    for (const [a, b] of pairs) q('INSERT INTO ol_match (season,day,div,a,b) VALUES (?,?,?,?,?)').run(s, day, div, a, b);
    if (bye) { q("INSERT INTO ol_match (season,day,div,a,b,state,how) VALUES (?,?,?,?,0,'done','bye')").run(s, day, div, bye); q('UPDATE ol_player SET pts=pts+1 WHERE uid=? AND season=?').run(bye, s); }
  }
}
// Result: real game (ga:gb), forfeit (no-show loses 0:3), or both absent (both lose, no goals). Three misses in a row and you are out.
export function olRecord(id, ga, gb, how = 'play') {
  return tx(() => {
    const m = q('SELECT * FROM ol_match WHERE id=?').get(id); if (!m || m.state === 'done') return false;
    q("UPDATE ol_match SET state='done', ga=?, gb=?, how=? WHERE id=?").run(ga, gb, how, id);
    const row = (uid, f, ag, showed) => {
      const won = how !== 'both' && f > ag, draw = how === 'play' && f === ag;
      q(`UPDATE ol_player SET p=p+1, gf=gf+?, ga=ga+?, pts=pts+?, w=w+?, d=d+?, l=l+?, miss=CASE WHEN ? THEN 0 ELSE miss+1 END, out=CASE WHEN ? THEN out WHEN miss+1>=? THEN 1 ELSE out END WHERE uid=? AND season=?`)
        .run(f, ag, won ? 3 : draw ? 1 : 0, won ? 1 : 0, draw ? 1 : 0, won || draw ? 0 : 1, showed ? 1 : 0, showed ? 1 : 0, OL.outAfter, uid, m.season);
    };
    row(m.a, ga, gb, how === 'play' || how === 'forfeit_b'); row(m.b, gb, ga, how === 'play' || how === 'forfeit_a');
    return true;
  });
}
const olPresent = m => { const r = rooms.get(m.room); return r ? r.players.filter(p => p.uid && p.profile && p.ws?.readyState === 1).map(p => p.uid) : []; };
// Season end: coins by finish (lower divisions half), exclusive ball for the top division champion, loyalty coins. Paid once.
function olPay(s) {
  const st = q('SELECT * FROM ol_season WHERE season=?').get(s); if (!st?.started || st.paid) return;
  q('UPDATE ol_season SET paid=1 WHERE season=?').run(s);
  for (const { div } of q('SELECT DISTINCT div FROM ol_player WHERE season=?').all(s)) {
    q('SELECT uid, lang, p FROM ol_player WHERE season=? AND div=? ORDER BY pts DESC, gf-ga DESC, gf DESC, joined').all(s, div).forEach((r, i) => {
      const coins = Math.round((OL.prize[i] || 0) / (div ? 2 : 1)) + (r.p >= OL.loyal.games ? OL.loyal.coins : 0), ball = i === 0 && div === 0;
      if (coins) q('UPDATE users SET coins=coins+? WHERE uid=?').run(coins, r.uid);
      if (ball) q("INSERT OR IGNORE INTO owned (uid,item,src,at) VALUES (?,?,'official',?)").run(r.uid, OL.champBall, Date.now());
      if (coins || ball) olSay(r.uid, r.lang, 'ol_prize', { pos: i + 1, coins, ball, season: s, div });
    });
  }
}
export function olTick(now = Date.now(), present = olPresent) {
  const s = seasonOf(now);
  if (s > 1 && !q('SELECT 1 FROM ol_season WHERE season=?').get(s)) { // new season: pay the old one, carry active players over
    olPay(s - 1); q('INSERT OR IGNORE INTO ol_season (season) VALUES (?)').run(s);
    for (const r of q('SELECT uid, lang FROM ol_player WHERE season=? AND out=0').all(s - 1)) q('INSERT OR IGNORE INTO ol_player (uid,season,lang,joined) VALUES (?,?,?,?)').run(r.uid, s, r.lang, now);
  }
  olMaybeStart(s, now); if (!olStarted(s)) return;
  const day = mytDay(now), k = kickAt(day); q('INSERT OR IGNORE INTO ol_day (day) VALUES (?)').run(day);
  const D = q('SELECT * FROM ol_day WHERE day=?').get(day), deadline = k + OL.joinMin * 60e3;
  if (!D.paired && now >= k - OL.warnMin * 60e3 && now < deadline && q('SELECT started FROM ol_season WHERE season=?').get(s).started < k - OL.warnMin * 60e3) {
    q('UPDATE ol_day SET paired=1 WHERE day=?').run(day); olPair(s, day);
    for (const m of q("SELECT * FROM ol_match WHERE day=? AND state='sched'").all(day)) for (const [me, op] of [[m.a, m.b], [m.b, m.a]]) {
      const p = q('SELECT lang FROM ol_player WHERE uid=? AND season=?').get(me, s); olSay(me, p.lang, 'ol_soon', { opp: nameOf(op), time: '21:00' }, '/?official=1'); }
  }
  if (D.paired && !D.opened && now >= k && now < deadline) {
    q('UPDATE ol_day SET opened=1 WHERE day=?').run(day);
    for (const m of q("SELECT * FROM ol_match WHERE day=? AND state='sched'").all(day)) {
      const code = process.env.NODE_ENV === 'test' ? 'T' + m.id : createRoom({ minutes: 3, official: m.id, uids: [m.a, m.b] }); if (!code) continue;
      q("UPDATE ol_match SET room=?, state='open' WHERE id=?").run(code, m.id);
      for (const [me, op] of [[m.a, m.b], [m.b, m.a]]) { const p = q('SELECT lang FROM ol_player WHERE uid=? AND season=?').get(me, s); olSay(me, p.lang, 'ol_open', { opp: nameOf(op), min: OL.joinMin }, `/?room=${code}`); }
    }
  }
  if (D.opened && !D.closed && now >= deadline) {
    q('UPDATE ol_day SET closed=1 WHERE day=?').run(day);
    for (const m of q("SELECT * FROM ol_match WHERE day=? AND state IN ('sched','open')").all(day)) {
      if (rooms.get(m.room)?.engine) continue; // playing: the final whistle records it
      const here = present(m), A = here.includes(m.a), B = here.includes(m.b);
      if (A && B) continue; // both in, toss pending: let them play
      olRecord(m.id, A ? 3 : 0, B ? 3 : 0, A ? 'forfeit_b' : B ? 'forfeit_a' : 'both');
      for (const [me, f] of [[m.a, A], [m.b, B]]) { const p = q('SELECT lang FROM ol_player WHERE uid=? AND season=?').get(me, s); olSay(me, p.lang, f ? 'ol_walkover' : 'ol_missed'); }
    }
  }
}
export function olStatus(uid, now = Date.now()) {
  const s = seasonOf(now), me = uid ? q('SELECT * FROM ol_player WHERE uid=? AND season=?').get(uid, s) : null, started = olStarted(s);
  const div = me?.div || 0, day = mytDay(now), k = kickAt(day), nextAt = now < k + OL.joinMin * 60e3 ? k : kickAt(mytDay(now + 864e5));
  const table = q('SELECT o.uid, o.pts, o.p, o.w, o.d, o.l, o.gf, o.ga, o.out, COALESCE(u.name,\'\') name FROM ol_player o LEFT JOIN users u ON u.uid=o.uid WHERE season=? AND div=? ORDER BY pts DESC, gf-ga DESC, gf DESC, joined LIMIT 100').all(s, div)
    .map((r, i) => ({ pos: i + 1, name: r.name.slice(0, 20) || 'Pemain', pts: r.pts, p: r.p, w: r.w, d: r.d, l: r.l, gd: r.gf - r.ga, out: !!r.out, me: r.uid === uid, pro: isPro(r.uid), photo: photoOf(r.uid) }));
  const m = me ? q("SELECT * FROM ol_match WHERE season=? AND (a=? OR b=?) AND day=? ORDER BY id DESC LIMIT 1").get(s, uid, uid, day) : null;
  const opp = m && m.b ? (m.a === uid ? m.b : m.a) : 0;
  return { season: s, ends: seasonEnds(s), started, count: olCount(s), min: OL.min, divs: (q('SELECT MAX(div) d FROM ol_player WHERE season=?').get(s).d || 0) + 1, nextAt, joinMin: OL.joinMin,
    me: me ? { div, pts: me.pts, p: me.p, out: !!me.out, miss: me.miss, pos: table.find(r => r.me)?.pos || null } : null,
    match: m ? { state: m.state, how: m.how, bye: !m.b, opp: opp ? nameOf(opp) : '', room: m.state === 'open' ? m.room : null, mine: m.a === uid ? [m.ga, m.gb] : [m.gb, m.ga] } : null,
    table: started ? table : [], prize: OL.prize, loyal: OL.loyal };
}

// Leaderboards. week: 3 per win + 1 per draw this week. season: RP now. all: wins across every season.
export function board(tab, me = 0, now = Date.now()) {
  const s = seasonOf(now), wk = weekOf(now);
  const SQL = {
    week: `SELECT uid, SUM(p) score, SUM(w) w FROM (SELECT a uid, CASE sa WHEN 1 THEN 3 WHEN 0.5 THEN 1 ELSE 0 END p, sa=1 w FROM rmatch WHERE week=${wk} UNION ALL SELECT b, CASE sa WHEN 0 THEN 3 WHEN 0.5 THEN 1 ELSE 0 END, sa=0 FROM rmatch WHERE week=${wk}) GROUP BY uid`,
    season: `SELECT uid, rp score, w FROM rank WHERE season=${s} AND w+l+d>0`, // only players who have played this season
    all: `SELECT uid, SUM(w) score, MAX(best) w FROM rank GROUP BY uid`,
  }[tab] || null;
  if (!SQL) return null;
  const rows = q(`SELECT t.uid, t.score, t.w, COALESCE(u.name,'') name, RANK() OVER (ORDER BY t.score DESC, t.w DESC) pos FROM (${SQL}) t LEFT JOIN users u ON u.uid=t.uid WHERE t.score > 0 ORDER BY pos, t.uid LIMIT 100`).all();
  const mine = me ? q(`SELECT * FROM (SELECT t.uid, t.score, t.w, RANK() OVER (ORDER BY t.score DESC, t.w DESC) pos FROM (${SQL}) t) WHERE uid=?`).get(me) : null;
  return { tab, season: s, week: wk, ends: tab === 'week' ? 0 : seasonEnds(s), rows: rows.map(r => ({ name: r.name.slice(0, 20) || 'Pemain', photo: photoOf(r.uid), score: r.score, w: r.w, pos: r.pos, me: r.uid === me, pro: isPro(r.uid), tier: tab === 'season' ? tierOf(r.score).id : undefined })), me: mine ? { score: mine.score, pos: mine.pos } : null };
}

// ── Telegram initData (HMAC, official algorithm) ───────────
export function verifyInitData(initData, token = BOT_TOKEN, maxAgeS = 86400) {
  if (!initData || !token || initData.length > 4096) return null;
  const params = new URLSearchParams(initData), hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;
  params.delete('hash');
  const dcs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const key = createHmac('sha256', 'WebAppData').update(token).digest();
  const calc = createHmac('sha256', key).update(dcs).digest();
  if (!timingSafeEqual(calc, Buffer.from(hash, 'hex'))) return null;
  const age = Date.now() / 1000 - Number(params.get('auth_date'));
  if (!(age >= -300 && age < maxAgeS)) return null;
  try { const user = JSON.parse(params.get('user') || 'null'); if (!user?.id) return null; return { uid: user.id, name: [user.first_name, user.last_name].filter(Boolean).join(' ').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 40), photo: cleanPhoto(user.photo_url) }; } catch { return null; }
}

// ── Stars invoice payload (<=128 bytes, HMAC bound) ────────
const sig = s => createHmac('sha256', SECRET).update(s).digest('hex').slice(0, 20);
export function makePayload(item, uid) { const base = `v1|${item}|${uid}|${randomBytes(4).toString('hex')}`; return `${base}|${sig(base)}`; }
export function readPayload(p) {
  if (typeof p !== 'string' || Buffer.byteLength(p) > 128) return null;
  const parts = p.split('|'); if (parts.length !== 5 || parts[0] !== 'v1') return null;
  const base = parts.slice(0, 4).join('|'), s = Buffer.from(sig(base)), got = Buffer.from(parts[4]);
  if (s.length !== got.length || !timingSafeEqual(s, got)) return null;
  const item = itemById(parts[1]); if (!item || !item.stars) return null;
  return { item, uid: Number(parts[2]) };
}

// Grants are exactly-once per Telegram charge id.
export function fulfill(chargeId, uid, itemId, stars) {
  const item = itemById(itemId);
  if (!item || item.stars !== stars) return { ok: false, err: 'mismatch' };
  return tx(() => {
    const prev = q('SELECT * FROM payments WHERE charge_id=?').get(chargeId);
    if (prev) return prev.uid === uid && prev.item === itemId ? { ok: true, dup: true } : { ok: false, err: 'conflict' };
    getUser(uid);
    q('INSERT INTO payments (charge_id,uid,item,stars,at) VALUES (?,?,?,?,?)').run(chargeId, uid, itemId, stars, Date.now());
    if (item.grantCoins) q('UPDATE users SET coins=coins+? WHERE uid=?').run(item.grantCoins, uid); // bought coins skip the daily play cap
    else if (item.sub) {
      const u = q('SELECT pro_until FROM users WHERE uid=?').get(uid);
      q('UPDATE users SET pro_until=? WHERE uid=?').run(Math.max(Date.now(), u.pro_until) + item.days * 86400e3, uid);
      q("INSERT OR IGNORE INTO owned (uid,item,src,at) VALUES (?,'b_pro','pro',?)").run(uid, Date.now());
    } else if (item.slot === 'pass') {
      const u = q('SELECT pass_until FROM users WHERE uid=?').get(uid);
      q('UPDATE users SET pass_until=? WHERE uid=?').run(Math.max(Date.now(), u.pass_until) + item.days * 86400e3, uid);
    } else for (const id of item.grants || [itemId]) q('INSERT OR IGNORE INTO owned (uid,item,src,at) VALUES (?,?,?,?)').run(uid, id, 'stars', Date.now());
    return { ok: true };
  });
}

export function buyWithCoins(uid, itemId) {
  const item = itemById(itemId);
  if (!item || !item.coins) return { ok: false, err: 'not_for_coins' };
  return tx(() => {
    const u = getUser(uid);
    if (ownedSet(uid).has(itemId)) return { ok: false, err: 'owned' };
    if (u.coins < item.coins) return { ok: false, err: 'coins' };
    q('UPDATE users SET coins=coins-? WHERE uid=?').run(item.coins, uid);
    q('INSERT INTO owned (uid,item,src,at) VALUES (?,?,?,?)').run(uid, itemId, 'coins', Date.now());
    return { ok: true };
  });
}

// ── CPU match setup + server replay for rewards ────────────
const SKILLS = [0.25, 0.5, 0.8], MINUTES = [1, 3, 5];
const skins = e => ({ pitch: e.pitch, venue: e.venue, ball: e.ball });
export function buildSetup({ team0, team1, kit0, kit1, formation, skill, minutes, seed, paper0, paper1, cpu = [false, true], squad0, squad1, first = 0, home = null, drill }) {
  const t0 = teamById(team0), t1 = teamById(team1);
  return { ...(drill === 'penalties' ? { drill } : {}), seed: seed >>> 0, minutes: MINUTES.includes(+minutes) ? +minutes : 3, halves: true, goalsToWin: 0, powerStrike: true,
    layout: 'spread', lockstep: true, turnLimit: 15, cpu, cpuSkill: SKILLS.includes(+skill) ? +skill : 0.5,
    formations: [FORMATIONS[formation] ? formation : '4-4-2', '4-4-2'], teams: [t0.id, t1.id],
    kits: [kit0 || t0.jerseys[0].id, kit1 || t1.jerseys[0].id], rosters: [squad0?.roster ? cleanRoster(squad0.roster, t0) : rosterFor(t0), squad1?.roster ? cleanRoster(squad1.roster, t1) : rosterFor(t1)],
    custom: [kit0 === 'custom' && squad0?.kit || null, kit1 === 'custom' && squad1?.kit || null],
    first: first ? 1 : 0, home: skins(home || aiEquip(seed >>> 0)),
    paper: [paper0 || { ...BASE_STATS }, paper1 || { ...BASE_STATS }] };
}
// Mirrors the client loop exactly: halftime auto, CPU acts from engine RNG, humans act from the log.
export function replayCpuMatch(setup, actions) {
  const e = new Engine(setup); runToRest(e);
  let i = 0, guard = 0;
  while (e.phase !== 'over' && guard++ < 2000) {
    if (e.phase === 'halftime') e._applyAction({ t: 'half' });
    else if (setup.cpu[e.turnTeam] && !e.needPick) e._applyAction(e.cpuAction());
    else { if (i >= actions.length) return null; if (!e._applyAction(actions[i++])) return null; }
    runToRest(e);
  }
  return e.phase === 'over' ? e : null;
}

// ── http helpers ───────────────────────────────────────────
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.webm': 'video/webm' };
function serveStatic(req, res) {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const file = normalize(join(PUBLIC, p));
  if (!file.startsWith(PUBLIC) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
  const ext = extname(file), st = statSync(file), etag = `"${st.size.toString(36)}-${st.mtimeMs.toString(36)}"`;
  // App code revalidates (module imports carry no version); vendor + fonts never change per path.
  const immutable = p.startsWith('/vendor/') || p.startsWith('/fonts/');
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', ETag: etag,
    'Cache-Control': ext === '.html' ? 'no-store' : immutable ? 'public, max-age=2592000' : 'no-cache' };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
  res.writeHead(200, headers);
  res.end(readFileSync(file));
}
// Shared goal clips/posters: stored on the data volume, 7 days, 8 MB max, 20 per player per day.
const CLIPS = join(DATA_DIR, 'clips'); mkdirSync(CLIPS, { recursive: true });
const CLIP_TYPES = { 'video/mp4': '.mp4', 'video/webm': '.webm', 'image/jpeg': '.jpg' }, CLIP_MAX = 8 << 20, CLIP_DAYS = 7;
const readBuf = (req, max) => new Promise((ok, bad) => { const a = []; let n = 0; req.on('data', c => { n += c.length; if (n > max) { bad(new Error('big')); req.destroy(); } else a.push(c); }); req.on('end', () => ok(Buffer.concat(a))); req.on('error', bad); });
// Any recorded clip -> MP4 (H.264, yuv420p, faststart) that plays inline in Telegram and every gallery. Each recorded frame is one
// replay step, so setpts re-times frame N to N/30s: phone recording hitches (uneven wall-clock gaps) vanish. false = keep the original.
const toMp4 = (src, dst) => new Promise(ok => execFile('ffmpeg', ['-v', 'error', '-y', '-i', src, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-vf', 'setpts=N/(30*TB),scale=trunc(iw/2)*2:trunc(ih/2)*2', '-r', '30', '-fps_mode', 'cfr', '-an', '-movflags', '+faststart', dst],
  { timeout: 60e3 }, err => ok(!err && existsSync(dst) && statSync(dst).size > 1000)));
const pruneClips = () => { const old = Date.now() - CLIP_DAYS * 864e5; for (const f of readdirSync(CLIPS)) try { if (statSync(join(CLIPS, f)).mtimeMs < old) unlinkSync(join(CLIPS, f)); } catch {} };
export function clipPage(id, ext, base = WEBAPP_URL) {
  const media = `${base}/clip/${id}${ext}`, video = ext !== '.jpg', poster = `${base}/poster/goal.webp`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bola Kertas: GOL!</title>
<meta property="og:title" content="GOL! Bola Kertas ⚽"><meta property="og:description" content="Boleh lawan? Main percuma dalam Telegram."><meta property="og:image" content="${video ? poster : media}">${video ? `<meta property="og:video" content="${media}"><meta property="og:type" content="video.other">` : ''}
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0726;font:800 16px system-ui;color:#fff;text-align:center}main{width:min(480px,100%);padding:16px}video,img{width:100%;border-radius:18px;border:3px solid #2a1f5c}a{display:block;margin-top:16px;padding:16px;border-radius:16px;background:#ffc93c;color:#2a1f5c;text-decoration:none;font-size:20px;border:3px solid #2a1f5c}small{display:block;margin-top:14px;color:#9fc6ff}</style></head>
<body><main>${video ? `<video src="${media}" controls autoplay muted loop playsinline poster="${poster}"></video>` : `<img src="${media}" alt="GOL">`}<a href="https://t.me/BolaKertasBot?start=clip">⚽ MAIN BOLA KERTAS</a><small>Official sponsor: revolixgaming.com</small></main></body></html>`;
}
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
const readBody = (req, max = 65536) => new Promise((ok, bad) => { let b = ''; req.on('data', c => { b += c; if (b.length > max) { bad(new Error('big')); req.destroy(); } }); req.on('end', () => ok(b)); req.on('error', bad); });
const hits = new Map();
function limited(key, n, ms) { const now = Date.now(), a = (hits.get(key) || []).filter(t => now - t < ms); a.push(now); hits.set(key, a); return a.length > n; }
async function bot(method, body) {
  if (!BOT_TOKEN) return { ok: false };
  try { const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return await r.json(); }
  catch (e) { return { ok: false, description: e.message }; }
}

async function api(req, res, path) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
  if (limited('ip:' + ip, 120, 60e3)) return json(res, 429, { err: 'slow_down' });
  if (req.method === 'POST' && path === '/api/room') {
    let rules = {}; try { rules = JSON.parse(await readBody(req, 2048)).rules || {}; } catch { return json(res, 400, { err: 'bad' }); }
    const code = createRoom(rules); return code ? json(res, 200, { code }) : json(res, 503, { err: 'full' });
  }
  const auth = verifyInitData(req.headers['x-init-data']);
  if (!auth) return json(res, 401, { err: 'auth' });
  getUser(auth.uid, auth.name, auth.photo); q('UPDATE users SET seen=? WHERE uid=?').run(Date.now(), auth.uid);
  if (req.method === 'GET' && path === '/api/me') return json(res, 200, profile(auth.uid));
  if (path === '/api/clip' && req.method === 'POST') {
    const type = String(req.headers['content-type'] || '').split(';')[0], ext = CLIP_TYPES[type];
    if (!ext) return json(res, 415, { err: 'type' });
    if (limited('clip:' + auth.uid, 20, 864e5)) return json(res, 429, { err: 'slow_down' });
    if (+req.headers['content-length'] > CLIP_MAX) { res.setHeader('Connection', 'close'); return json(res, 413, { err: 'big' }); }
    let buf; try { buf = await readBuf(req, CLIP_MAX); } catch { return json(res, 413, { err: 'big' }); }
    const magic = { '.jpg': b => b[0] === 0xff && b[1] === 0xd8, '.mp4': b => b.toString('latin1', 4, 8) === 'ftyp', '.webm': b => b.readUInt32BE(0) === 0x1a45dfa3 }[ext];
    if (buf.length < 1000 || !magic(buf)) return json(res, 400, { err: 'bad' });
    const id = randomBytes(9).toString('base64url'); writeFileSync(join(CLIPS, id + ext), buf); pruneClips();
    // Android records WebM: Telegram only plays MP4 inline and many gallery apps skip WebM, so convert it here.
    // ponytail: one ffmpeg per upload, capped by the 20/day/user limit; add a queue if uploads ever pile up
    const src = join(CLIPS, id + ext), dst = join(CLIPS, id + (ext === '.mp4' ? '.c.mp4' : '.mp4'));
    if (ext === '.mp4' && await toMp4(src, dst)) { renameSync(dst, src); return json(res, 200, { url: `/clip/${id}.mp4`, page: `/c/${id}` }); }
    if (ext === '.webm' && await toMp4(src, dst)) { try { unlinkSync(join(CLIPS, id + ext)); } catch {} return json(res, 200, { url: `/clip/${id}.mp4`, page: `/c/${id}` }); }
    return json(res, 200, { url: `/clip/${id}${ext}`, page: `/c/${id}` });
  }
  let body = {}; try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return json(res, 400, { err: 'bad' }); }
  if (path === '/api/clip/send') { // the bot sends a saved replay to the player's own chat, so it lands in Telegram (and the gallery from there)
    const m = /^\/clip\/([\w-]{12})(\.mp4|\.webm)$/.exec(String(body.url || '')), file = m && join(CLIPS, m[1] + m[2]);
    if (!file || !existsSync(file)) return json(res, 404, { err: 'no_clip' });
    if (limited('clipsend:' + auth.uid, 20, 864e5)) return json(res, 429, { err: 'slow_down' });
    if (process.env.NODE_ENV === 'test') return json(res, 200, { ok: true });
    const fd = new FormData(); fd.set('chat_id', String(auth.uid)); fd.set('caption', String(body.caption || '').slice(0, 900)); fd.set('supports_streaming', 'true');
    fd.set('video', new Blob([readFileSync(file)], { type: m[2] === '.mp4' ? 'video/mp4' : 'video/webm' }), 'bola-kertas-gol' + m[2]);
    try { const r = await (await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/send${m[2] === '.mp4' ? 'Video' : 'Document'}`, { method: 'POST', body: fd })).json();
      return r.ok ? json(res, 200, { ok: true }) : json(res, r.error_code === 403 ? 403 : 502, { err: r.error_code === 403 ? 'bot_blocked' : 'send' }); }
    catch { return json(res, 502, { err: 'send' }); }
  }

  if (path === '/api/feedback') { // stored, then forwarded to the owner's DM
    const kind = ['bug', 'idea', 'other'].includes(body.kind) ? body.kind : 'other', text = String(body.text || '').trim().slice(0, 1000);
    if (text.length < 5) return json(res, 400, { err: 'short' });
    if (limited('fb:' + auth.uid, 5, 864e5)) return json(res, 429, { err: 'slow_down' });
    const ctx = String(body.ctx || '').slice(0, 300), at = Date.now();
    const id = Number(q('INSERT INTO feedback (uid, kind, text, ctx, at) VALUES (?,?,?,?,?)').run(auth.uid, kind, text, ctx, at).lastInsertRowid);
    const e = x => String(x).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    if (process.env.NODE_ENV !== 'test') say(FEEDBACK_CHAT, `${{ bug: '🐞 Bug', idea: '💡 Cadangan', other: '💬 Lain-lain' }[kind]} #${id}\nDari: <b>${e(auth.name || 'Pemain')}</b> (<code>${auth.uid}</code>)\n\n${e(text)}\n\n<i>${e(ctx)}</i>`).catch(() => {});
    return json(res, 200, { ok: true, id });
  }
  if (path === '/api/equip') {
    const item = itemById(body.item);
    if (!item || !SLOTS.includes(item.slot) || !ownedSet(auth.uid).has(item.id)) return json(res, 400, { err: 'not_owned' });
    const p = profile(auth.uid); p.equip[item.slot] = item.id;
    q('UPDATE users SET equip=? WHERE uid=?').run(JSON.stringify(p.equip), auth.uid);
    return json(res, 200, profile(auth.uid));
  }
  if (path === '/api/league') { // ops: list | create | join | get | leave | room
    const op = body.op, lid = +body.id || 0;
    if (op === 'list') return json(res, 200, { leagues: myLeagues(auth.uid), free: leagueLimits(auth.uid), pro: isPro(auth.uid), colors: LEAGUE_COLORS });
    if (op === 'create') { if (limited('lgc:' + auth.uid, 5, 3600e3)) return json(res, 429, { err: 'slow_down' }); const r = createLeague(auth.uid, body.name, body.color); return json(res, r.ok ? 200 : 400, r); }
    if (op === 'join') { if (limited('lgj:' + auth.uid, 20, 3600e3)) return json(res, 429, { err: 'slow_down' }); const r = joinLeague(auth.uid, body.code, +body.by || 0); return json(res, r.ok ? 200 : 400, r); }
    if (op === 'leave') { const r = leaveLeague(auth.uid, lid); return json(res, r.ok ? 200 : 400, r); }
    if (op === 'get') { const t = leagueTable(lid, auth.uid); return t ? json(res, 200, t) : json(res, 404, { err: 'no_league' }); }
    if (op === 'room') { if (!isMember(lid, auth.uid)) return json(res, 403, { err: 'no_league' }); const code = createRoom({ minutes: 3, league: lid }); return code ? json(res, 200, { code }) : json(res, 503, { err: 'full' }); }
    return json(res, 400, { err: 'bad' });
  }
  if (path === '/api/official') {
    if (body.op === 'join') { if (limited('olj:' + auth.uid, 10, 3600e3)) return json(res, 429, { err: 'slow_down' }); olJoin(auth.uid, body.lang); }
    return json(res, 200, olStatus(auth.uid));
  }
  if (path === '/api/rank') { // { tab: week|season|all } -> board + my card
    const r = rankRow(auth.uid), t = tierOf(r.rp), b = board(body.tab || 'season', auth.uid);
    return b ? json(res, 200, { ...b, mine: { rp: r.rp, best: r.best, w: r.w, l: r.l, d: r.d, tier: t.id, div: t.div, next: t.next, season: r.season, ends: seasonEnds(r.season) } }) : json(res, 400, { err: 'bad' });
  }
  if (path === '/api/squad') { if (limited('sq:' + auth.uid, 30, 600e3)) return json(res, 429, { err: 'slow_down' }); saveSquad(auth.uid, body); return json(res, 200, profile(auth.uid)); }
  if (path === '/api/shop/buy') { const r = buyWithCoins(auth.uid, body.item); return json(res, r.ok ? 200 : 400, r.ok ? profile(auth.uid) : r); }
  if (path === '/api/shop/invoice') {
    const item = itemById(body.item);
    if (!item?.stars) return json(res, 400, { err: 'not_for_stars' });
    if (!item.consumable && isOwned(ownedSet(auth.uid), item)) return json(res, 400, { err: 'owned' });
    if (!onSale(item)) return json(res, 400, { err: 'not_for_sale' });
    if (item.sub && isPro(auth.uid)) return json(res, 400, { err: 'owned' }); // renewals are charged by Telegram, never a second subscription
    if (limited('inv:' + auth.uid, 10, 60e3)) return json(res, 429, { err: 'slow_down' });
    const r = await bot('createInvoiceLink', invoiceFields(item, auth.uid, LANGS.includes(body.lang) ? body.lang : 'ms'));
    return r.ok ? json(res, 200, { url: r.result }) : json(res, 502, { err: 'invoice' });
  }
  if (path === '/api/match/start') {
    if (limited('ms:' + auth.uid, 30, 3600e3)) return json(res, 429, { err: 'slow_down' });
    const seed = randomBytes(4).readUInt32LE(), call = body.call === 'b' ? 'b' : 'k', coin = randomBytes(1)[0] & 1 ? 'b' : 'k', won = tossResult(call, coin);
    const setup = buildSetup({ ...body, seed, paper0: paperStats(auth.uid), squad0: squadOf(auth.uid), squad1: null, first: won ? 0 : 1, home: won ? profile(auth.uid).equip : aiEquip(seed) });
    setup.stars = [squadOf(auth.uid).stars || {}, {}];
    setup.coin = coin; setup.call = call;
    const mid = randomBytes(8).toString('hex');
    q('DELETE FROM matches WHERE created < ?').run(Date.now() - 6 * 3600e3);
    q('INSERT INTO matches (mid,uid,setup,created) VALUES (?,?,?,?)').run(mid, auth.uid, JSON.stringify(setup), Date.now());
    return json(res, 200, { mid, setup });
  }
  if (path === '/api/match/finish') {
    const m = q('SELECT * FROM matches WHERE mid=? AND uid=?').get(String(body.mid || ''), auth.uid);
    if (!m || m.done) return json(res, 400, { err: 'no_match' });
    const actions = Array.isArray(body.actions) ? body.actions.slice(0, 600) : [];
    const setup = JSON.parse(m.setup), e = replayCpuMatch(setup, actions);
    q('UPDATE matches SET done=1 WHERE mid=?').run(m.mid);
    if (!e) return json(res, 400, { err: 'replay_failed' });
    const won = e.winner === 0, draw = e.winner === null, u = getUser(auth.uid), day = new Date().toISOString().slice(0, 10);
    const pass = u.pass_until > Date.now(), pro = u.pro_until > Date.now(), cap = pro ? PRO.cap : DAILY_COIN_CAP;
    let reward = matchReward({ won, draw, goals: e.score[0], skill: setup.cpuSkill, passActive: pass });
    if (pro && !pass) reward = Math.round(reward * PRO.coinBoost);
    const used = u.day === day ? u.day_coins : 0; reward = Math.max(0, Math.min(reward, cap - used));
    q('UPDATE users SET coins=coins+?, day=?, day_coins=? WHERE uid=?').run(reward, day, used + reward, auth.uid);
    const inviter = payRef(auth.uid); if (inviter && process.env.NODE_ENV !== 'test') say(inviter, botText('ref_paid', { lang: 'ms', name: u.name || '', n: REF_REWARD })).catch(() => {});
    return json(res, 200, { reward, score: e.score, winner: e.winner, capped: used + reward >= cap, profile: profile(auth.uid) });
  }
  return json(res, 404, { err: 'nope' });
}

// ── bot webhook: rich HTML chat, coin shop in chat, pre-checkout, successful payment ──
const h = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = n => Number(n).toLocaleString('ms-MY');
const PACKS = ITEMS.filter(i => i.slot === 'coins');
const kb = rows => ({ inline_keyboard: rows });
const playBtn = (lang = 'ms', t = L(lang).b_play) => ({ text: t, web_app: { url: WEBAPP_URL } });
const say = (chat_id, text, reply_markup) => bot('sendMessage', { chat_id, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...(reply_markup ? { reply_markup } : {}) });
const packsKb = lang => kb([...PACKS.map(p => [{ text: `${fmtL(p.grantCoins, lang)} ${L(lang).coins_w} · ${p.stars} ⭐${p.tag ? '  ' + trMs(lang, p.tag) : ''}`, callback_data: 'buy:' + p.id }]), [playBtn(lang, L(lang).b_locker)]]);
// Bot copy in three languages. d.lang picks one; Malay is the fallback.
const BT = {
  ms: {
    tagline: 'Bola sepak kertas 3D, terus dalam Telegram.', howto: 'Tarik ke belakang, bidik, lepas. Tarik jauh untuk sepakan lebih kuat.',
    hi: n => `👋 Hai <b>${n}</b>`, coins: 'Coins', items: 'Item', in_locker: 'dalam loker', whats: 'Apa yang ada',
    feats: n => `🏆 70 pasukan: Liga Malaysia, EPL, La Liga, Bundesliga, pasukan negara\n🤖 Lawan AI 3 tahap, 2 pemain satu telefon, atau online\n🪙 Lambung syiling: pemenang mula dulu di venue sendiri\n📄 ${n}+ item: kertas, bola, padang, venue, efek gol`,
    shop: 'Kedai Coins', bal: 'Baki anda', for: 'untuk', shop_note: 'Item paling murah bermula 150 coins. Coins yang dibeli tiada had harian.', tap_pack: 'Pilih pek di bawah untuk bayar dengan Stars.',
    profile: 'Profil', owned: 'Item dimiliki', pass: d => `🎟 Pas Mingguan aktif sehingga <b>${d}</b>`, wearing: 'Sedang dipakai',
    slots: { paper: '📄 Kertas', pitch: '🟩 Padang', venue: '🏟 Venue', ball: '⚽ Bola', fx: '🎆 Efek gol' },
    help: 'Cara Main', rules: '<b>1. Lastik.</b> Tarik ke belakang dan lepas untuk sepak. Tarik jauh, sepakan lebih kuat.\n<b>2. Jenis sepakan.</b> BUMI bergolek, CUNGKIL naik sikit, LAMBUNG terbang tinggi.\n<b>3. Tiga sepakan.</b> Setiap pasukan boleh sepak 3 kali berturut-turut, kemudian giliran lawan.\n<b>4. Lambung syiling.</b> Pemenang mula dulu dan main di venue sendiri.\n<b>5. Coins.</b> Menang lawan AI untuk kumpul coins, sehingga 1,500 sehari.',
    cmds: '<b>Arahan</b>\n/start  menu utama\n/coins  beli coins\n/profil  coins dan item anda\n/paysupport  bantuan pembelian\n/terms  terma',
    pro_on: d => `⭐ <b>PRO aktif!</b>\n<blockquote>5 liga sendiri sehingga 32 ahli\nCoins main +50%\nLencana PRO\nBola PRO dalam loker anda</blockquote>\nAktif sehingga <b>${d}</b>, diperbaharui automatik. Batal bila-bila masa dalam Tetapan Telegram.`,
    paid: 'Bayaran berjaya', added: 'masuk ke akaun anda', newbal: 'Baki terkini', in_locker2: 'dah masuk loker', receipt: 'ID resit (tekan untuk salin):',
    paid_bad: 'Bayaran diterima, tetapi item belum masuk', paid_bad2: 'Jangan risau, Stars anda selamat. Hantar ID resit ini melalui /paysupport dan kami akan uruskan:',
    support: 'Bantuan Pembelian', support_b: 'Hantar dalam chat ini:\n1. <b>ID resit</b> dari mesej bayaran (bermula dengan <code>stxt</code>)\n2. Nama item atau pek coins yang anda beli', support_n: 'Kami akan balas dalam masa 48 jam. Bayaran berganda akan dipulangkan.',
    terms: 'Terma', terms_b: '• Semua item hanya untuk gaya dalam permainan. Kertas mahal tidak menjadikan anda lebih kuat.\n• Coins dan item tidak boleh ditukar kepada wang tunai atau dipindahkan.\n• Pembelian dengan Stars adalah muktamad, kecuali jika item tidak diterima. Hubungi /paysupport.\n• Coins dari permainan terhad 1,500 sehari. Coins yang dibeli tiada had.',
    owns: n => `Anda dah ada <b>${n}</b>.`, cant_buy: 'Item ini tidak boleh dibeli sekarang.',
    ol_started: t => `⭐ <b>Liga Rasmi Bola Kertas dah bermula!</b>\nPemain dah cukup. Perlawanan setiap hari jam <b>${t}</b> waktu Malaysia. Kami akan ingatkan anda 30 minit sebelum.`,
    ol_soon: (o, t) => `⏰ <b>Perlawanan liga jam ${t}</b>\nLawan anda: <b>${o}</b>\n<blockquote>Bilik dibuka tepat jam ${t}. Anda ada 10 minit untuk masuk, kalau tak, dikira kalah.</blockquote>`,
    ol_open: (o, n) => `🟢 <b>Bilik liga dah buka!</b>\nLawan: <b>${o}</b>\nMasuk dalam <b>${n} minit</b>. Siapa tak muncul, kalah 0-3.`,
    ol_invite: '⭐ <b>Liga Rasmi Bola Kertas</b>\nLawan live setiap malam jam 9:00. Juara dapat 3,000 coins dan bola eksklusif. Tekan butang untuk daftar.',
    ol_walkover: '✅ <b>Menang 3-0!</b>\nLawan anda tak muncul. 3 mata masuk ke jadual liga.',
    ol_missed: '❌ <b>Anda terlepas perlawanan liga hari ini.</b>\nDikira kalah 0-3. Tiga kali terlepas berturut-turut, anda akan dikeluarkan dari liga musim ini.',
    ol_prize: (p, c, b, s) => `🏆 <b>Musim ${s} tamat!</b>\nAnda tamat di tempat <b>#${p}</b>.${c ? `\n🪙 <b>+${c} coins</b> masuk ke akaun anda.` : ''}${b ? '\n⚽ Bola eksklusif <b>Juara Liga</b> kini dalam loker anda!' : ''}`,
    inv_room: c => `🎮 <b>Anda dicabar!</b>\nKawan anda tunggu dalam bilik <code>${c}</code>. Tekan butang di bawah untuk masuk terus.`,
    inv_league: c => `🏆 <b>Jemputan Liga</b>\nAnda dijemput sertai liga <code>${c}</code>. Lawan kawan, kumpul mata, rebut piala musim ini.`,
    rk_call: '🔔 <b>Ada pemain tengah cari lawan Ranked!</b>\nBerani terima cabaran? Siapa cepat, dia dapat lawan.',
    b_rk_take: '⚔️ TERIMA', b_rk_no: '❌ Tolak', b_rk_snooze: '💤 Snooze 1 hari',
    rk_rejected: 'Okay, cabaran ditolak.', rk_snoozed: '💤 Tiada ajakan Ranked untuk 24 jam.',
    b_play: '⚽ MAIN SEKARANG', b_coins: '🪙 Beli Coins', b_profile: '👤 Profil', b_help: '📖 Cara Main', b_locker: '🎒 Buka Loker', b_more: '🪙 Beli lagi', coins_w: 'coins',
  },
  en: {
    tagline: '3D paper football, right inside Telegram.', howto: 'Pull back, aim, let go. The further you pull, the harder the kick.',
    hi: n => `👋 Hi <b>${n}</b>`, coins: 'Coins', items: 'Items', in_locker: 'in your locker', whats: "What's inside",
    feats: n => `🏆 70 teams: Malaysia League, EPL, La Liga, Bundesliga, national teams\n🤖 Play the AI on 3 levels, 2 players on one phone, or online\n🪙 Coin toss: the winner kicks off at their own venue\n📄 ${n}+ items: paper, balls, pitches, venues, goal effects`,
    shop: 'Coin Shop', bal: 'Your balance', for: 'for', shop_note: 'Items start from just 150 coins. Bought coins have no daily limit.', tap_pack: 'Pick a pack below to pay with Stars.',
    profile: 'Profile', owned: 'Items owned', pass: d => `🎟 Weekly Pass active until <b>${d}</b>`, wearing: 'Currently using',
    slots: { paper: '📄 Paper', pitch: '🟩 Pitch', venue: '🏟 Venue', ball: '⚽ Ball', fx: '🎆 Goal effect' },
    help: 'How to Play', rules: '<b>1. Slingshot.</b> Pull back and let go to kick. Pull further for a harder kick.\n<b>2. Kick types.</b> GROUND rolls, CHIP lifts a little, LOB flies high.\n<b>3. Three kicks.</b> Each team gets 3 kicks in a row, then it is the other side\'s turn.\n<b>4. Coin toss.</b> The winner kicks off and plays at their own venue.\n<b>5. Coins.</b> Beat the AI to earn coins, up to 1,500 a day.',
    cmds: '<b>Commands</b>\n/start  main menu\n/coins  buy coins\n/profil  your coins and items\n/paysupport  purchase help\n/terms  terms',
    pro_on: d => `⭐ <b>PRO is on!</b>\n<blockquote>5 own leagues of up to 32\n+50% match coins\nPRO badge\nPRO ball in your locker</blockquote>\nActive until <b>${d}</b>, renews automatically. Cancel any time in Telegram Settings.`,
    paid: 'Payment successful', added: 'added to your account', newbal: 'New balance', in_locker2: 'is now in your locker', receipt: 'Receipt ID (tap to copy):',
    paid_bad: "Payment received, but your item hasn't arrived yet", paid_bad2: "Don't worry, your Stars are safe. Send this receipt ID via /paysupport and we'll sort it out:",
    support: 'Purchase Help', support_b: 'Send us in this chat:\n1. The <b>receipt ID</b> from your payment message (it starts with <code>stxt</code>)\n2. The item or coin pack you bought', support_n: "We'll reply within 48 hours. Double payments are refunded.",
    terms: 'Terms', terms_b: "• All items are cosmetic. Expensive paper doesn't make you stronger.\n• Coins and items can't be exchanged for cash or transferred.\n• Stars purchases are final unless the item doesn't arrive. Contact /paysupport.\n• Coins from playing are capped at 1,500 a day. Bought coins have no limit.",
    owns: n => `You already own <b>${n}</b>.`, cant_buy: "This item can't be bought right now.",
    ol_started: t => `⭐ <b>The Bola Kertas Official League has started!</b>\nEnough players joined. Matches every day at <b>${t}</b> Malaysia time. We will remind you 30 minutes before.`,
    ol_soon: (o, t) => `⏰ <b>League match at ${t}</b>\nYour opponent: <b>${o}</b>\n<blockquote>The room opens at ${t} sharp. You have 10 minutes to join, or you lose the match.</blockquote>`,
    ol_open: (o, n) => `🟢 <b>The league room is open!</b>\nOpponent: <b>${o}</b>\nJoin within <b>${n} minutes</b>. No-shows lose 0-3.`,
    ol_invite: '⭐ <b>Bola Kertas Official League</b>\nLive matches every night at 9:00 PM (Malaysia). The champion wins 3,000 coins and an exclusive ball. Tap the button to sign up.',
    ol_walkover: '✅ <b>3-0 win!</b>\nYour opponent did not show up. 3 points added to the league table.',
    ol_missed: '❌ <b>You missed today\'s league match.</b>\nCounted as a 0-3 loss. Miss three in a row and you are out of the league this season.',
    ol_prize: (p, c, b, s) => `🏆 <b>Season ${s} is over!</b>\nYou finished <b>#${p}</b>.${c ? `\n🪙 <b>+${c} coins</b> added to your account.` : ''}${b ? '\n⚽ The exclusive <b>League Champion</b> ball is now in your locker!' : ''}`,
    inv_room: c => `🎮 <b>You have been challenged!</b>\nYour friend is waiting in room <code>${c}</code>. Tap the button below to jump in.`,
    inv_league: c => `🏆 <b>League invite</b>\nYou are invited to league <code>${c}</code>. Play your friends, collect points, win this season's trophy.`,
    rk_call: '🔔 <b>A player is looking for a Ranked match!</b>\nUp for the challenge? First one in gets the game.',
    b_rk_take: '⚔️ ACCEPT', b_rk_no: '❌ Reject', b_rk_snooze: '💤 Snooze 1 day',
    rk_rejected: 'Okay, challenge declined.', rk_snoozed: '💤 No Ranked invites for 24 hours.',
    b_play: '⚽ PLAY NOW', b_coins: '🪙 Buy Coins', b_profile: '👤 Profile', b_help: '📖 How to Play', b_locker: '🎒 Open Locker', b_more: '🪙 Buy more', coins_w: 'coins',
  },
  ru: {
    tagline: 'Бумажный 3D-футбол прямо в Telegram.', howto: 'Оттяни, прицелься, отпусти. Чем дальше тянешь, тем сильнее удар.',
    hi: n => `👋 Привет, <b>${n}</b>`, coins: 'Монеты', items: 'Предметы', in_locker: 'в шкафу', whats: 'Что внутри',
    feats: n => `🏆 70 команд: Лига Малайзии, АПЛ, Ла Лига, Бундеслига, сборные\n🤖 Игра против ИИ на 3 уровнях, вдвоём на одном телефоне или онлайн\n🪙 Жребий: победитель начинает на своём стадионе\n📄 ${n}+ предметов: бумага, мячи, поля, стадионы, эффекты гола`,
    shop: 'Магазин монет', bal: 'Твой баланс', for: 'за', shop_note: 'Предметы от 150 монет. У купленных монет нет дневного лимита.', tap_pack: 'Выбери набор ниже, чтобы оплатить звёздами.',
    profile: 'Профиль', owned: 'Предметов', pass: d => `🎟 Недельный пропуск активен до <b>${d}</b>`, wearing: 'Сейчас надето',
    slots: { paper: '📄 Бумага', pitch: '🟩 Поле', venue: '🏟 Стадион', ball: '⚽ Мяч', fx: '🎆 Эффект гола' },
    help: 'Как играть', rules: '<b>1. Рогатка.</b> Оттяни назад и отпусти для удара. Чем дальше, тем сильнее.\n<b>2. Виды ударов.</b> НИЗОМ катится, ПОДСЕЧКА чуть поднимается, НАВЕС летит высоко.\n<b>3. Три удара.</b> Команда бьёт 3 раза подряд, затем ход переходит к сопернику.\n<b>4. Жребий.</b> Победитель начинает и играет на своём стадионе.\n<b>5. Монеты.</b> Побеждай ИИ и получай монеты, до 1 500 в день.',
    cmds: '<b>Команды</b>\n/start  главное меню\n/coins  купить монеты\n/profil  твои монеты и предметы\n/paysupport  помощь с покупкой\n/terms  условия',
    pro_on: d => `⭐ <b>PRO включён!</b>\n<blockquote>5 своих лиг до 32 участников\n+50% монет за матчи\nЗначок PRO\nМяч PRO в шкафу</blockquote>\nАктивен до <b>${d}</b>, продлевается автоматически. Отменить можно в настройках Telegram.`,
    paid: 'Оплата прошла', added: 'зачислено на счёт', newbal: 'Новый баланс', in_locker2: 'теперь в шкафу', receipt: 'ID чека (нажми, чтобы скопировать):',
    paid_bad: 'Оплата получена, но предмет ещё не зачислен', paid_bad2: 'Не волнуйся, твои звёзды в безопасности. Отправь этот ID чека через /paysupport, и мы всё решим:',
    support: 'Помощь с покупкой', support_b: 'Отправь в этот чат:\n1. <b>ID чека</b> из сообщения об оплате (начинается с <code>stxt</code>)\n2. Название предмета или набора монет', support_n: 'Ответим в течение 48 часов. Двойные платежи возвращаем.',
    terms: 'Условия', terms_b: '• Все предметы только для внешнего вида. Дорогая бумага не делает тебя сильнее.\n• Монеты и предметы нельзя обменять на деньги или передать.\n• Покупки за звёзды окончательны, если предмет получен. Пиши в /paysupport.\n• Монеты за игру ограничены 1 500 в день. У купленных монет лимита нет.',
    owns: n => `У тебя уже есть <b>${n}</b>.`, cant_buy: 'Этот предмет сейчас нельзя купить.',
    ol_started: t => `⭐ <b>Официальная лига Bola Kertas стартовала!</b>\nИгроков достаточно. Матчи каждый день в <b>${t}</b> по Малайзии (16:00 МСК). Напомним за 30 минут.`,
    ol_soon: (o, t) => `⏰ <b>Матч лиги в ${t}</b>\nТвой соперник: <b>${o}</b>\n<blockquote>Комната откроется ровно в ${t}. У тебя 10 минут, чтобы войти, иначе поражение.</blockquote>`,
    ol_open: (o, n) => `🟢 <b>Комната лиги открыта!</b>\nСоперник: <b>${o}</b>\nВойди за <b>${n} минут</b>. Неявка: поражение 0:3.`,
    ol_invite: '⭐ <b>Официальная лига Bola Kertas</b>\nЖивые матчи каждый вечер в 16:00 МСК. Чемпиону 3 000 монет и эксклюзивный мяч. Нажми кнопку, чтобы записаться.',
    ol_walkover: '✅ <b>Победа 3:0!</b>\nСоперник не явился. 3 очка в таблицу лиги.',
    ol_missed: '❌ <b>Ты пропустил матч лиги сегодня.</b>\nЗасчитано поражение 0:3. Три пропуска подряд, и ты выбываешь из лиги в этом сезоне.',
    ol_prize: (p, c, b, s) => `🏆 <b>Сезон ${s} завершён!</b>\nТвоё место: <b>#${p}</b>.${c ? `\n🪙 <b>+${c} монет</b> на твой счёт.` : ''}${b ? '\n⚽ Эксклюзивный мяч <b>Чемпион лиги</b> уже в твоём шкафу!' : ''}`,
    inv_room: c => `🎮 <b>Тебе бросили вызов!</b>\nДруг ждёт в комнате <code>${c}</code>. Нажми кнопку ниже, чтобы войти.`,
    inv_league: c => `🏆 <b>Приглашение в лигу</b>\nТебя пригласили в лигу <code>${c}</code>. Играй с друзьями, набирай очки, бери кубок сезона.`,
    rk_call: '🔔 <b>Игрок ищет соперника в рейтинге!</b>\nПримешь вызов? Кто первый, тот и играет.',
    b_rk_take: '⚔️ ПРИНЯТЬ', b_rk_no: '❌ Отклонить', b_rk_snooze: '💤 Не звать 1 день',
    rk_rejected: 'Хорошо, вызов отклонён.', rk_snoozed: '💤 Без приглашений в рейтинг на 24 часа.',
    b_play: '⚽ ИГРАТЬ', b_coins: '🪙 Купить монеты', b_profile: '👤 Профиль', b_help: '📖 Как играть', b_locker: '🎒 Открыть шкаф', b_more: '🪙 Купить ещё', coins_w: 'монет',
  },
};
const L = lang => BT[lang] || BT.ms;
const fmtL = (n, lang) => Number(n).toLocaleString(lang === 'ru' ? 'ru-RU' : lang === 'en' ? 'en-US' : 'ms-MY');
const tagL = (tag, lang) => trMs(lang, tag);
export function botText(kind, d = {}) {
  const lang = d.lang || 'ms', x = L(lang), f = n => fmtL(n, lang), nm = it => h(itemName(it, lang));
  if (kind === 'ref_paid') return `🎉 <b>+${d.n} coins!</b>\n${h(d.name || 'Kawan anda')} masuk Bola Kertas guna pautan anda dan dah habis perlawanan pertama. Kongsi lagi gol anda untuk dapat lebih banyak coins!`;
  if (kind === 'start') return `<b>⚽ Bola Kertas</b>\n<i>${x.tagline}</i>\n\n<blockquote>${x.howto}</blockquote>\n\n`
    + `${x.hi(h(d.name || 'Bola Kertas'))}\n🪙 ${x.coins}: <b>${f(d.coins)}</b>\n🎒 ${x.items}: <b>${d.owned}</b> ${x.in_locker}\n\n`
    + `<blockquote expandable><b>${x.whats}</b>\n${x.feats(d.items)}</blockquote>`;
  if (kind === 'coins') return `<b>🪙 ${x.shop}</b>\n${x.bal}: <b>${f(d.coins)} ${x.coins_w}</b>\n\n`
    + `<blockquote>${PACKS.map(p => `${p.tag ? '🔥' : '•'} <b>${f(p.grantCoins)} ${x.coins_w}</b> ${x.for} ${p.stars} ⭐${p.tag ? `  <i>${h(tagL(p.tag, lang))}</i>` : ''}`).join('\n')}</blockquote>\n\n`
    + `<i>${x.shop_note}</i>\n${x.tap_pack}`;
  if (kind === 'profile') return `<b>👤 ${x.profile}: ${h(d.name || '')}</b>\n\n🪙 ${x.coins}: <b>${f(d.coins)}</b>\n🎒 ${x.owned}: <b>${d.owned}</b>/${d.items}\n${d.pass ? x.pass(h(d.pass)) + '\n' : ''}\n`
    + `<blockquote expandable><b>${x.wearing}</b>\n${Object.entries(d.equip).map(([k, v]) => `${x.slots[k] || k}: <b>${itemById(v) ? nm(itemById(v)) : h(v)}</b>`).join('\n')}</blockquote>`;
  if (kind === 'help') return `<b>📖 ${x.help}</b>\n\n<blockquote expandable>${x.rules}</blockquote>\n\n${x.cmds}`;
  if (kind === 'paid') return d.ok ? `<b>✅ ${x.paid}</b>\n\n${d.item.grantCoins ? `🪙 <b>+${f(d.item.grantCoins)} ${x.coins_w}</b> ${x.added}\n${x.newbal}: <b>${f(d.coins)} ${x.coins_w}</b>` : d.item.sub ? x.pro_on(d.until ? new Date(d.until).toISOString().slice(0, 10) : '') : `🎁 <b>${nm(d.item)}</b> ${x.in_locker2}`}\n\n<i>${x.receipt}</i>\n<code>${h(d.charge)}</code>`
    : `<b>⚠️ ${x.paid_bad}</b>\n\n${x.paid_bad2}\n<code>${h(d.charge)}</code>`;
  if (kind === 'support') return `<b>🛟 ${x.support}</b>\n\n<blockquote>${x.support_b}</blockquote>\n\n<i>${x.support_n}</i>`;
  if (kind === 'terms') return `<b>📜 ${x.terms}</b>\n\n<blockquote expandable>${x.terms_b}</blockquote>`;
  if (kind === 'owns') return x.owns(nm(d.item));
  if (kind === 'invite_room') return x.inv_room(h(d.code));
  if (kind === 'ol_started') return x.ol_started(h(d.time));
  if (kind === 'ol_soon') return x.ol_soon(h(d.opp), h(d.time));
  if (kind === 'ol_open') return x.ol_open(h(d.opp), +d.min);
  if (kind === 'ol_walkover' || kind === 'ol_missed' || kind === 'ol_invite') return x[kind];
  if (kind === 'ol_prize') return x.ol_prize(+d.pos, d.coins ? f(d.coins) : 0, !!d.ball, +d.season);
  if (kind === 'invite_league') return x.inv_league(h(d.code));
  return '';
}
function userSnap(uid, name, lang = 'ms') { getUser(uid, name); const p = profile(uid); return { lang, name: name || p.name, coins: p.coins, owned: p.owned.length, items: ITEMS.filter(i => !['coins', 'pass', 'bundle'].includes(i.slot)).length, equip: p.equip, pass: p.passUntil > Date.now() ? new Date(p.passUntil).toLocaleDateString(lang === 'ru' ? 'ru-RU' : lang === 'en' ? 'en-GB' : 'ms-MY') : '' }; }
export const invoiceFieldsFor = (item, uid, lang) => invoiceFields(item, uid, lang);
const invoiceFields = (item, uid, lang) => ({ title: itemName(item, lang).slice(0, 32), description: itemDesc(item, lang).slice(0, 255), payload: makePayload(item.id, uid), provider_token: '', currency: 'XTR', prices: [{ label: itemName(item, lang).slice(0, 32), amount: item.stars }], ...(item.sub ? { subscription_period: 2592000 } : {}) });
async function sendInvoiceFor(chat_id, uid, item, lang = 'ms') {
  if (!item?.stars || item.sub) return; // subscriptions only via invoice links
  if (!item.consumable && isOwned(ownedSet(uid), item)) return say(chat_id, botText('owns', { lang, item }));
  if (limited('inv:' + uid, 10, 60e3)) return;
  return bot('sendInvoice', { chat_id, ...invoiceFields(item, uid, lang) });
}
export async function onUpdate(u) {
  if (u.pre_checkout_query) {
    const pq = u.pre_checkout_query, p = readPayload(pq.invoice_payload);
    const ok = !!p && p.uid === pq.from.id && pq.currency === 'XTR' && pq.total_amount === p.item.stars &&
      (p.item.consumable || !isOwned(ownedSet(p.uid), p.item)) && onSale(p.item);
    return bot('answerPreCheckoutQuery', ok ? { pre_checkout_query_id: pq.id, ok: true } : { pre_checkout_query_id: pq.id, ok: false, error_message: L(langFrom(pq.from.language_code)).cant_buy });
  }
  if (u.callback_query) {
    const cq = u.callback_query, [act, id] = String(cq.data || '').split(':');
    if (act === 'rk' && cq.message) { const x = L(langFrom(cq.from.language_code)), snooze = id === 'snooze';
      if (snooze) q('UPDATE users SET snooze=? WHERE uid=?').run(Date.now() + SNOOZE_MS, cq.from.id);
      bot('answerCallbackQuery', { callback_query_id: cq.id, text: snooze ? x.rk_snoozed : x.rk_rejected });
      return bot('deleteMessage', { chat_id: cq.message.chat.id, message_id: cq.message.message_id }); }
    bot('answerCallbackQuery', { callback_query_id: cq.id });
    if (act === 'buy' && cq.message) return sendInvoiceFor(cq.message.chat.id, cq.from.id, PACKS.find(p => p.id === id), langFrom(cq.from.language_code));
    if (act === 'menu' && cq.message && ['coins', 'profil', 'help'].includes(id)) return onUpdate({ message: { chat: cq.message.chat, from: cq.from, text: '/' + id } });
    return;
  }
  const m = u.message; if (!m) return;
  if (m.successful_payment) {
    const sp = m.successful_payment, p = readPayload(sp.invoice_payload);
    // Already charged: no expiry check here, only identity, item and amount.
    const r = p && p.uid === m.from.id && sp.currency === 'XTR' ? fulfill(sp.telegram_payment_charge_id, p.uid, p.item.id, sp.total_amount) : { ok: false };
    const lang = langFrom(m.from.language_code);
    return say(m.chat.id, botText('paid', { lang, ok: r.ok, item: p?.item, charge: sp.telegram_payment_charge_id, coins: r.ok ? profile(p.uid).coins : 0, until: r.ok ? profile(p.uid).proUntil : 0 }),
      r.ok ? kb([[playBtn(lang)], ...(p.item.grantCoins ? [[{ text: L(lang).b_more, callback_data: 'menu:coins' }]] : [])]) : undefined);
  }
  if (m.chat.type !== 'private') return;
  const text = (m.text || '').trim().toLowerCase(), uid = m.from.id, name = (m.from.first_name || '').slice(0, 40), lang = langFrom(m.from.language_code), x = L(lang);
  const sp = /^\/start (room|lg)_([a-z0-9]{4,8})(?:_(\d+))?$/.exec(text);
  if (sp) { const code = sp[2].toUpperCase(), q2 = sp[1] === 'room' ? `room=${code}` : `league=${code}${sp[3] ? '&by=' + sp[3] : ''}`;
    return say(m.chat.id, botText(sp[1] === 'room' ? 'invite_room' : 'invite_league', { lang, code }), kb([[{ text: x.b_play, web_app: { url: `${WEBAPP_URL}/?${q2}` } }]])); }
  const rf = /^\/start ref_(\d{1,15})$/.exec(text); if (rf) { getUser(uid, name); setRef(uid, +rf[1]); }
  if (text === '/start official') return say(m.chat.id, botText('ol_invite', { lang }), kb([[{ text: x.b_play, web_app: { url: `${WEBAPP_URL}/?official=1` } }]]));
  if (text.startsWith('/start')) return say(m.chat.id, botText('start', userSnap(uid, name, lang)), kb([[playBtn(lang)], [{ text: x.b_coins, callback_data: 'menu:coins' }, { text: x.b_profile, callback_data: 'menu:profil' }], [{ text: x.b_help, callback_data: 'menu:help' }]]));
  if (text.startsWith('/coins')) return say(m.chat.id, botText('coins', userSnap(uid, name, lang)), packsKb(lang));
  if (text.startsWith('/profil')) return say(m.chat.id, botText('profile', userSnap(uid, name, lang)), kb([[playBtn(lang)], [{ text: x.b_coins, callback_data: 'menu:coins' }]]));
  if (text.startsWith('/bantuan') || text.startsWith('/help')) return say(m.chat.id, botText('help', { lang }), kb([[playBtn(lang)]]));
  if (text.startsWith('/paysupport')) return say(m.chat.id, botText('support', { lang }));
  if (text.startsWith('/terms')) return say(m.chat.id, botText('terms', { lang }));
}
// ── online rooms (server authoritative) ────────────────────
const rooms = new Map(), queue = [], rqueue = [];
const TURN_MS = 15000 + 1500, GONE_MS = 60000;
function createRoom(rules) {
  if (rooms.size >= 300) return null;
  let code; do code = makeCode(5); while (rooms.has(code));
  rooms.set(code, { code, rules: { minutes: MINUTES.includes(+rules?.minutes) ? +rules.minutes : 3 }, players: [], created: Date.now(), ranked: !!rules?.ranked, uids: rules?.uids || null, league: +rules?.league || 0, official: +rules?.official || 0 });
  return code;
}
const send = (ws, o) => { if (ws?.readyState === 1) ws.send(JSON.stringify(o)); };
const cast = (room, o) => room.players.forEach(p => send(p.ws, o));
function armTurn(room) {
  clearTimeout(room.timer);
  const e = room.engine; if (!e || e.phase === 'over') return;
  if (e.phase === 'halftime') { room.timer = setTimeout(() => act(room, null, { t: 'half' }), 3000); return; }
  room.deadline = Date.now() + TURN_MS;
  room.timer = setTimeout(() => {
    const p = room.players[e.turnTeam]; p.idle = (p.idle || 0) + 1;
    if (p.idle >= 3) return forfeit(room, e.turnTeam);
    act(room, null, { t: 'skip' });
  }, TURN_MS);
}
function act(room, seat, a) {
  const e = room.engine; if (!e || !isRest(e)) return false;
  if (seat !== null && (a?.t === 'half' || e.turnTeam !== seat)) return false;
  if (!e._applyAction(a)) return false;
  if (seat !== null) room.players[seat].idle = 0;
  runToRest(e);
  if (a.t === 'lineup') return cast(room, { t: 'act', a, state: e.exportState(), left: Math.max(0, room.deadline - Date.now()) }), true; // turn clock keeps running
  cast(room, { t: 'act', a, state: e.exportState(), left: TURN_MS });
  if (e.phase === 'over') { overCast(room, { t: 'over', winner: e.winner, score: e.score }); clearTimeout(room.timer); }
  else armTurn(room);
  return true;
}
function forfeit(room, loser) {
  const e = room.engine; if (!e || e.phase === 'over') return;
  clearTimeout(room.timer); e.phase = 'over'; e.winner = 1 - loser;
  overCast(room, { t: 'over', winner: e.winner, score: e.score, forfeit: true, state: e.exportState() }, true);
}
// Match over: settle ranked once, then tell each player their own points change.
function overCast(room, msg, forfeited = false) {
  let res = null;
  if (room.ranked && !room.settled) {
    room.settled = true; const [a, b] = room.players.map(p => p.uid), w = room.engine.winner;
    const fair = room.uids && a === room.uids[0] && b === room.uids[1] || room.uids && a === room.uids[1] && b === room.uids[0];
    res = fair ? settleRanked(a, b, w === 0 ? 1 : w === 1 ? 0 : 0.5, forfeited ? MIN_RANKED_MS : Date.now() - room.startedAt) : { counted: false, why: 'players' };
  }
  let lres = null;
  if (room.league && !room.leagueDone) { room.leagueDone = true; const [a, b] = room.players, sc = room.engine.score;
    lres = recordLeague(room.league, a.uid, b.uid, sc[0], sc[1], forfeited ? MIN_RANKED_MS : Date.now() - room.startedAt); }
  if (lres) msg = { ...msg, league: { counted: lres.counted, why: lres.why } };
  if (room.official && !room.officialDone) { room.officialDone = true; const m = q('SELECT * FROM ol_match WHERE id=?').get(room.official), sc = room.engine.score, [x] = room.players;
    if (m) { const flip = x.uid !== m.a; olRecord(m.id, flip ? sc[1] : sc[0], flip ? sc[0] : sc[1]); msg = { ...msg, official: true }; } }
  room.players.forEach(p => { const r = res?.[p.uid]; send(p.ws, { ...msg, rank: room.ranked ? (r ? { ...r, tier: tierOf(r.rp).id, div: tierOf(r.rp).div } : { counted: false, why: res?.why }) : undefined }); });
}
// Seat 0 calls the coin (10s, else auto). Winner kicks off and is home: both players see the winner's venue, pitch and ball.
function askToss(room) {
  clearTimeout(room.tossTimer); room.call = null;
  send(room.players[0].ws, { t: 'toss', caller: true }); send(room.players[1].ws, { t: 'toss', caller: false });
  room.tossTimer = setTimeout(() => startMatch(room, 'k'), 10000);
}
function startMatch(room, call = 'k') {
  clearTimeout(room.tossTimer); room.tossTimer = null; if (room.engine && room.engine.phase !== 'over') return;
  const [a, b] = room.players, coin = randomBytes(1)[0] & 1 ? 'b' : 'k', first = tossResult(call, coin) ? 0 : 1;
  const homeEquip = p => p.uid ? profile(p.uid).equip : DEFAULT_EQUIP;
  const setup = buildSetup({ team0: a.profile.team, team1: b.profile.team, kit0: a.profile.kit, kit1: b.profile.kit, formation: a.profile.formation,
    minutes: room.rules.minutes, seed: randomBytes(4).readUInt32LE(), paper0: room.ranked || room.official ? null : paperStats(a.uid), paper1: room.ranked || room.official ? null : paperStats(b.uid), cpu: [false, false], squad0: squadOf(a.uid), squad1: squadOf(b.uid),
    first, home: homeEquip(room.players[first]) });
  setup.coin = coin; setup.call = call;
  setup.formations[1] = FORMATIONS[b.profile.formation] ? b.profile.formation : '4-4-2';
  setup.names = [a.profile.name, b.profile.name]; setup.paperIds = [a.paperId, b.paperId];
  setup.stars = [squadOf(a.uid).stars || {}, squadOf(b.uid).stars || {}]; setup.pro = [isPro(a.uid), isPro(b.uid)];
  setup.ranked = room.ranked;
  room.setup = setup; room.engine = new Engine(setup); runToRest(room.engine); room.rematch = new Set(); room.startedAt = Date.now(); room.settled = false; room.leagueDone = false;
  room.players.forEach((p, i) => send(p.ws, { t: 'setup', setup, seat: i, state: room.engine.exportState(), left: TURN_MS }));
  armTurn(room);
}
function onRoomSocket(ws, pid, code) {
  const room = rooms.get(code);
  if (!room) { send(ws, { t: 'err', msg: 'no-room' }); return ws.close(4004); }
  let me = room.players.find(p => p.pid === pid);
  if (!me && room.players.length >= 2) { send(ws, { t: 'err', msg: 'room-full' }); return ws.close(4009); }
  if (!me) { me = { pid, seat: room.players.length }; room.players.push(me); }
  if (me.ws && me.ws !== ws) try { me.ws.close(4001); } catch {}
  me.ws = ws; clearTimeout(me.goneTimer);
  ws.on('message', raw => {
    let m; try { m = JSON.parse(String(raw)); } catch { return; }
    if (m.t === 'join') {
      if (m.v !== PROTOCOL) { send(ws, { t: 'err', msg: 'update' }); return ws.close(4010); } // old app after a rules change
      const auth = verifyInitData(m.initData);
      me.uid = auth?.uid || 0; me.paperId = me.uid ? profile(me.uid).equip.paper : 'p_a4';
      if (room.official && !room.uids.includes(me.uid)) { room.players.splice(room.players.indexOf(me), 1); room.players.forEach((p, i) => p.seat = i); send(ws, { t: 'err', msg: 'room-full' }); return ws.close(4009); }
      const pr = m.profile || {};
      me.profile = { name: String(auth?.name || pr.name || 'Pemain').slice(0, 20), team: teamById(pr.team).id, kit: String(pr.kit || ''), formation: String(pr.formation || '4-4-2') };
      if (room.engine) return send(ws, { t: 'setup', setup: room.setup, seat: me.seat, state: room.engine.exportState(), left: Math.max(0, (room.deadline || 0) - Date.now()) });
      const other = room.players.find(p => p !== me);
      if (other?.profile) askToss(room); else send(ws, { t: 'waiting', code });
      if (other) send(other.ws, { t: 'opp', here: true });
    } else if (m.t === 'call' && me.seat === 0 && !room.engine?.phase && room.tossTimer) { startMatch(room, m.side === 'b' ? 'b' : 'k'); }
    else if (m.t === 'call' && me.seat === 0 && room.engine?.phase === 'over' && room.tossTimer) { startMatch(room, m.side === 'b' ? 'b' : 'k'); }
    else if (m.t === 'act') { if (!act(room, me.seat, m.a)) send(ws, { t: 'err', msg: 'bad-act', state: room.engine?.exportState() }); }
    else if (m.t === 'rematch' && room.engine?.phase === 'over') {
      room.rematch.add(me.seat); cast(room, { t: 'rematch', seats: [...room.rematch] });
      if (room.rematch.size === 2) askToss(room);
    }
  });
  ws.on('close', () => {
    if (me.ws !== ws) return;
    const other = room.players.find(p => p !== me); send(other?.ws, { t: 'opp', here: false, graceMs: GONE_MS });
    me.goneTimer = setTimeout(() => {
      if (room.engine && room.engine.phase !== 'over') forfeit(room, me.seat);
      if (room.players.every(p => p.ws?.readyState !== 1)) { clearTimeout(room.timer); rooms.delete(code); }
    }, room.engine ? GONE_MS : 5000);
  });
}
// ── ranked call-out: someone waits alone in the ranked queue -> DM recently active players ──
// Sent to every player. Anti-spam: one call-out per 10 min server-wide, max 2 per player per day,
// no pings 00:00-08:00 Malaysia time, Snooze = 24h off, blocked bots are never retried.
export const PING_GAP = 10 * 60e3, PING_PER_DAY = 2, PING_WAIT = 15e3, SNOOZE_MS = 864e5;
let lastPing = 0;
export const resetPing = () => { lastPing = 0; };
export function pingTargets(seeker, now = Date.now(), busy = []) {
  const day = new Date(now + 8 * 3600e3).toISOString().slice(0, 10);
  return q(`SELECT u.uid, COALESCE((SELECT lang FROM ol_player o WHERE o.uid=u.uid ORDER BY season DESC LIMIT 1),'ms') lang FROM users u
    WHERE u.uid<>? AND u.ping_off=0 AND u.snooze<=? AND NOT (u.ping_day=? AND u.ping_n>=?) ORDER BY u.seen DESC`)
    .all(seeker, now, day, PING_PER_DAY).filter(r => !busy.includes(r.uid)).map(r => ({ ...r, day }));
}
export async function rankedPing(seeker, now = Date.now(), send = say, busy = rqueue.map(w => w.uid)) {
  const myHour = new Date(now + 8 * 3600e3).getUTCHours();
  if (myHour < 8 || now - lastPing < PING_GAP) return 0;
  lastPing = now; let sent = 0;
  for (const t of pingTargets(seeker, now, busy)) {
    q("UPDATE users SET ping_n=CASE WHEN ping_day=? THEN ping_n+1 ELSE 1 END, ping_day=? WHERE uid=?").run(t.day, t.day, t.uid);
    const r = await send(t.uid, L(t.lang).rk_call, kb([[{ text: L(t.lang).b_rk_take, web_app: { url: `${WEBAPP_URL}/?ranked=1` } }], [{ text: L(t.lang).b_rk_no, callback_data: 'rk:no' }, { text: L(t.lang).b_rk_snooze, callback_data: 'rk:snooze' }]]));
    if (r?.ok) sent++; else if (r?.error_code === 403) q('UPDATE users SET ping_off=2 WHERE uid=?').run(t.uid);
    await new Promise(ok => setTimeout(ok, 60)); // ponytail: ~16 msg/s serial; batch per-chat if users go past a few thousand
  }
  return sent;
}
function onLobbySocket(ws) {
  ws.on('message', raw => {
    let m; try { m = JSON.parse(String(raw)); } catch { return; }
    if (m.t === 'queue' && !queue.includes(ws) && !rqueue.includes(ws)) {
      if (m.v !== PROTOCOL) return send(ws, { t: 'err', msg: 'update' });
      const ranked = !!m.ranked, Q = ranked ? rqueue : queue;
      if (ranked) { ws.uid = verifyInitData(m.initData)?.uid || 0; if (!ws.uid) return send(ws, { t: 'err', msg: 'ranked-guest' }); }
      // Came from a call-out but nobody is waiting any more: the seat was taken, keep them queued as the new seeker.
      if (ranked && m.via === 'ping' && !Q.some(w => w.readyState === 1 && w.uid !== ws.uid)) send(ws, { t: 'full' });
      Q.push(ws);
      if (ranked) ws.pingT = setInterval(() => { if (rqueue.includes(ws)) rankedPing(ws.uid).catch(() => {}); else clearInterval(ws.pingT); }, PING_WAIT);
      // ponytail: first-come pairing; sort by RP band once the ranked queue is busy enough to wait
      while (Q.length >= 2) {
        const a = Q.shift(), b = Q.shift();
        if (a.readyState !== 1) { if (b.readyState === 1) Q.unshift(b); continue; }
        if (b.readyState !== 1) { Q.unshift(a); continue; }
        if (ranked && a.uid === b.uid) { Q.unshift(a); b.close(4001); continue; } // same account twice
        const code = createRoom({ minutes: 3, ranked, uids: ranked ? [a.uid, b.uid] : null }); send(a, { t: 'matched', code }); send(b, { t: 'matched', code });
      }
    }
    if (m.t === 'unqueue') for (const Q of [queue, rqueue]) { const i = Q.indexOf(ws); if (i >= 0) Q.splice(i, 1); }
  });
  ws.on('close', () => { clearInterval(ws.pingT); for (const Q of [queue, rqueue]) { const i = Q.indexOf(ws); if (i >= 0) Q.splice(i, 1); } });
}

// ── server ─────────────────────────────────────────────────
export const server = createServer(async (req, res) => {
  const path = req.url.split('?')[0];
  try {
    if (path === '/healthz') { res.writeHead(200); return res.end('ok'); }
    if (path === '/bot/webhook' && req.method === 'POST') {
      if (req.headers['x-telegram-bot-api-secret-token'] !== WH_SECRET) { res.writeHead(403); return res.end(); }
      const body = await readBody(req, 262144); res.writeHead(200); res.end('ok');
      try { await onUpdate(JSON.parse(body)); } catch (e) { console.error('update', e.message); }
      return;
    }
    if (path === '/api/log' && req.method === 'POST') { // client error beacon, capped
      if (!limited('log:' + (req.headers['x-forwarded-for'] || ''), 30, 60e3)) console.log('client', (await readBody(req, 2048)).replace(/[\r\n]+/g, ' ').slice(0, 600));
      res.writeHead(204); return res.end();
    }
    if (path.startsWith('/api/')) return await api(req, res, path);
    const cm = /^\/(clip\/([\w-]{12})(\.mp4|\.webm|\.jpg)|c\/([\w-]{12}))$/.exec(path);
    if (cm) {
      const id = cm[2] || cm[4], ext = cm[3] || ['.mp4', '.webm', '.jpg'].find(x => existsSync(join(CLIPS, id + x))), file = ext && join(CLIPS, id + ext);
      if (!file || !existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
      if (cm[4]) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }); return res.end(clipPage(id, ext, WEBAPP_URL || `https://${req.headers.host}`)); }
      res.writeHead(200, { 'Content-Type': MIME[ext], 'Cache-Control': 'public, max-age=604800, immutable', 'X-Content-Type-Options': 'nosniff', 'Content-Length': statSync(file).size, ...(/[?&]dl=1\b/.test(req.url) ? { 'Content-Disposition': `attachment; filename="bola-kertas-gol${ext}"` } : {}) }); return res.end(readFileSync(file));
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    serveStatic(req, res);
  } catch (e) { console.error('req', e.message); if (!res.headersSent) json(res, 500, { err: 'server' }); }
});
const wss = new WebSocketServer({ server, maxPayload: 8192 });
wss.on('connection', (ws, req) => {
  const u = new URL(req.url, 'http://x'), pid = (u.searchParams.get('pid') || '').slice(0, 64) || randomBytes(6).toString('hex');
  let n = 0; const iv = setInterval(() => { n = 0; }, 1000);
  ws.on('message', () => { if (++n > 20) ws.close(4008); });
  ws.on('close', () => clearInterval(iv));
  if (u.pathname === '/ws/lobby') onLobbySocket(ws);
  else if (u.pathname.startsWith('/ws/room/')) onRoomSocket(ws, pid, u.pathname.split('/')[3]?.toUpperCase());
  else ws.close(4000);
});
if (process.env.NODE_ENV !== 'test') setInterval(() => { try { olTick(); } catch (e) { console.error('olTick', e.message); } }, 20e3).unref();
setInterval(() => { const now = Date.now(); for (const [c, r] of rooms) if (now - r.created > 3 * 3600e3) { clearTimeout(r.timer); rooms.delete(c); } }, 60e3).unref();

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => console.log('Bola Kertas on :' + PORT));
  if (BOT_TOKEN && WEBAPP_URL) {
    bot('setWebhook', { url: WEBAPP_URL + '/bot/webhook', secret_token: WH_SECRET, allowed_updates: ['message', 'pre_checkout_query', 'callback_query'] }).then(r => console.log('webhook', r.ok, r.description || ''));
    bot('setChatMenuButton', { menu_button: { type: 'web_app', text: 'MAIN', web_app: { url: WEBAPP_URL } } });
    bot('setMyCommands', { commands: [{ command: 'start', description: 'Menu utama' }, { command: 'coins', description: 'Beli coins dengan Stars' }, { command: 'profil', description: 'Baki coins dan item anda' }, { command: 'bantuan', description: 'Cara main' }, { command: 'paysupport', description: 'Bantuan pembelian' }, { command: 'terms', description: 'Terma dan syarat' }] });
    bot('setMyCommands', { language_code: 'en', commands: [{ command: 'start', description: 'Main menu' }, { command: 'coins', description: 'Buy coins with Stars' }, { command: 'profil', description: 'Your coins and items' }, { command: 'bantuan', description: 'How to play' }, { command: 'paysupport', description: 'Help with a purchase' }, { command: 'terms', description: 'Terms' }] });
    bot('setMyCommands', { language_code: 'ru', commands: [{ command: 'start', description: 'Главное меню' }, { command: 'coins', description: 'Купить монеты за звёзды' }, { command: 'profil', description: 'Твои монеты и предметы' }, { command: 'bantuan', description: 'Как играть' }, { command: 'paysupport', description: 'Помощь с покупкой' }, { command: 'terms', description: 'Условия' }] });
    bot('setMyDescription', { language_code: 'en', description: '⚽ Bola Kertas: 3D paper football right inside Telegram.\n\nPull back, aim, kick. Lob over the defence, chip into the corner, or unleash a Power Shot straight at goal.\n\n🏆 70 teams: Malaysia League, EPL, La Liga, Bundesliga and national teams\n🤖 Play the AI on 3 levels, 2 players on one phone, or challenge friends online\n📄 Collect paper, balls, pitches and venues\n\nFree to play. Tap PLAY to start.' });
    bot('setMyDescription', { language_code: 'ru', description: '⚽ Bola Kertas: бумажный 3D-футбол прямо в Telegram.\n\nОттяни, прицелься, бей. Перекинь мяч через защиту, подсеки в угол или запусти мощный удар прямо в ворота.\n\n🏆 70 команд: Лига Малайзии, АПЛ, Ла Лига, Бундеслига и сборные\n🤖 Играй против ИИ на 3 уровнях, вдвоём на одном телефоне или с друзьями онлайн\n📄 Собирай бумагу, мячи, поля и стадионы\n\nИграй бесплатно. Нажми ИГРАТЬ.' });
    bot('setMyShortDescription', { language_code: 'en', short_description: '3D paper football in Telegram. Pull, aim, GOAL! Play the AI or challenge friends. Free.' });
    bot('setMyShortDescription', { language_code: 'ru', short_description: 'Бумажный 3D-футбол в Telegram. Тяни, целься, ГОЛ! Играй с ИИ или друзьями. Бесплатно.' });
    bot('setMyName', { name: 'Bola Kertas' });
    bot('setMyDescription', { description: '⚽ Bola Kertas: bola sepak kertas 3D terus dalam Telegram.\n\nTarik, bidik, tepuk. Lambung melepasi pertahanan, cungkil ke penjuru, atau lepaskan Rembatan Padu terus ke gol.\n\n🏆 70 pasukan: Liga Malaysia, EPL, La Liga, Bundesliga dan negara\n🤖 Lawan AI 3 tahap, 2 pemain satu telefon, online cabar kawan\n📄 Kumpul kertas, bola, padang dan venue\n\nMain percuma. Tekan MAIN untuk mula.' });
    bot('setMyShortDescription', { short_description: 'Bola sepak kertas 3D dalam Telegram. Tarik, bidik, GOL! Lawan AI atau cabar kawan. Percuma.' });
  }
}
