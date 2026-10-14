// teams.js — Bola Kertas team database
// Each team: id, name, short, league, jerseys (pattern+colors), keeper kits

const kit = (id, label, pattern, base, accent, trim, number, extra = {}) =>
  ({ id, label, pattern, base, accent, trim, number, sponsor: 'BOLA KERTAS', ...extra });

const gk = (prefix) => [
  kit(`${prefix}-gk1`, 'GK Green', 'gradient', '#1f9d55', '#0b5d2f', '#0b3d20', '#ffffff'),
  kit(`${prefix}-gk2`, 'GK Orange', 'checkers', '#f97316', '#c2410c', '#1f2937', '#111111'),
];

// ── MALAYSIA SUPER LEAGUE ───────────────────────────────────
const MY = [
  { id:'jdt', name:"Johor Darul Ta'zim", short:'JDT', jerseys:[kit('jdt-h','Home','pinstripes','#1b3f94','#d71920','#d71920','#ffffff'),kit('jdt-a','Away','sash','#f4f4f4','#d71920','#1b3f94','#1b3f94')], keeper:gk('jdt') },
  { id:'sel', name:'Selangor', short:'SEL', jerseys:[kit('sel-h','Home','plain','#d0111b','#a50d15','#ffd400','#ffd400'),kit('sel-a','Away','chevron','#ffd400','#d0111b','#d0111b','#d0111b')], keeper:gk('sel') },
  { id:'kdh', name:'Kedah Darul Aman', short:'KDH', jerseys:[kit('kdh-h','Home','stripes','#ffd400','#0f7a3a','#0f7a3a','#0f7a3a'),kit('kdh-a','Away','gradient','#0f7a3a','#064d24','#ffd400','#ffd400')], keeper:gk('kdh') },
  { id:'tfc', name:'Terengganu', short:'TFC', jerseys:[kit('tfc-h','Home','chevron','#ffffff','#111111','#111111','#111111'),kit('tfc-a','Away','plain','#111111','#2b2b2b','#ffffff','#ffffff')], keeper:gk('tfc') },
  { id:'phg', name:'Sri Pahang', short:'PHG', jerseys:[kit('phg-h','Home','hoops','#ffffff','#111111','#111111','#111111'),kit('phg-a','Away','pinstripes','#111111','#f2c400','#f2c400','#ffffff')], keeper:gk('phg') },
  { id:'prk', name:'Perak', short:'PRK', jerseys:[kit('prk-h','Home','sash','#ffd400','#ffffff','#111111','#111111'),kit('prk-a','Away','plain','#ffffff','#ffd400','#ffd400','#111111')], keeper:gk('prk') },
  { id:'sab', name:'Sabah', short:'SAB', jerseys:[kit('sab-h','Home','gradient','#0a6cc4','#003a73','#e11d2a','#ffffff'),kit('sab-a','Away','sash','#ffffff','#0055a5','#e11d2a','#0055a5')], keeper:gk('sab') },
  { id:'kel', name:'Kelantan', short:'KEL', jerseys:[kit('kel-h','Home','plain','#c8102e','#9b0c23','#ffffff','#ffffff'),kit('kel-a','Away','hoops','#ffffff','#c8102e','#c8102e','#c8102e')], keeper:gk('kel') },
  { id:'ns', name:'Negeri Sembilan', short:'NS9', jerseys:[kit('ns-h','Home','chevron','#ffd400','#c8102e','#111111','#111111'),kit('ns-a','Away','halves','#111111','#c8102e','#ffd400','#ffd400')], keeper:gk('ns') },
  { id:'png', name:'Pulau Pinang', short:'PNG', jerseys:[kit('png-h','Home','plain','#2a7de1','#1a5db0','#ffffff','#ffffff'),kit('png-a','Away','stripes','#ffffff','#2a7de1','#2a7de1','#2a7de1')], keeper:gk('png') },
  { id:'klc', name:'Kuala Lumpur City', short:'KLC', jerseys:[kit('klc-h','Home','gradient','#ffd700','#ff8c00','#111111','#111111'),kit('klc-a','Away','plain','#111111','#ffd700','#ffd700','#ffd700')], keeper:gk('klc') },
  { id:'swk', name:'Sarawak', short:'SWK', jerseys:[kit('swk-h','Home','stripes','#e11d2a','#111111','#ffffff','#ffffff'),kit('swk-a','Away','plain','#ffffff','#e11d2a','#e11d2a','#e11d2a')], keeper:gk('swk') },
];

// ── ENGLISH PREMIER LEAGUE ──────────────────────────────────
const EPL = [
  { id:'mci', name:'Manchester City', short:'MCI', jerseys:[kit('mci-h','Home','plain','#6CABDD','#1C2C5B','#1C2C5B','#ffffff'),kit('mci-a','Away','plain','#1C2C5B','#6CABDD','#6CABDD','#6CABDD')], keeper:gk('mci') },
  { id:'ars', name:'Arsenal', short:'ARS', jerseys:[kit('ars-h','Home','plain','#EF0107','#9C824A','#ffffff','#ffffff'),kit('ars-a','Away','plain','#063672','#EF0107','#ffffff','#ffffff')], keeper:gk('ars') },
  { id:'liv', name:'Liverpool', short:'LIV', jerseys:[kit('liv-h','Home','plain','#C8102E','#00B2A9','#ffffff','#ffffff'),kit('liv-a','Away','plain','#F6EB61','#C8102E','#C8102E','#C8102E')], keeper:gk('liv') },
  { id:'mun', name:'Manchester United', short:'MUN', jerseys:[kit('mun-h','Home','plain','#DA291C','#FBE122','#ffffff','#ffffff'),kit('mun-a','Away','plain','#ffffff','#DA291C','#DA291C','#DA291C')], keeper:gk('mun') },
  { id:'tot', name:'Tottenham', short:'TOT', jerseys:[kit('tot-h','Home','plain','#ffffff','#132257','#132257','#132257'),kit('tot-a','Away','plain','#132257','#ffffff','#ffffff','#ffffff')], keeper:gk('tot') },
  { id:'che', name:'Chelsea', short:'CHE', jerseys:[kit('che-h','Home','plain','#034694','#DBA111','#ffffff','#ffffff'),kit('che-a','Away','plain','#ffffff','#034694','#034694','#034694')], keeper:gk('che') },
  { id:'avl', name:'Aston Villa', short:'AVL', jerseys:[kit('avl-h','Home','stripes','#670E36','#95BFE5','#95BFE5','#95BFE5'),kit('avl-a','Away','plain','#95BFE5','#670E36','#670E36','#670E36')], keeper:gk('avl') },
  { id:'new', name:'Newcastle', short:'NEW', jerseys:[kit('new-h','Home','stripes','#241F20','#ffffff','#ffffff','#ffffff'),kit('new-a','Away','plain','#ffffff','#241F20','#241F20','#241F20')], keeper:gk('new') },
  { id:'bha', name:'Brighton', short:'BHA', jerseys:[kit('bha-h','Home','stripes','#0057B8','#ffffff','#ffffff','#ffffff'),kit('bha-a','Away','plain','#FF8200','#0057B8','#0057B8','#0057B8')], keeper:gk('bha') },
  { id:'whu', name:'West Ham', short:'WHU', jerseys:[kit('whu-h','Home','stripes','#7A263A','#1BB1E7','#ffffff','#ffffff'),kit('whu-a','Away','plain','#1BB1E7','#7A263A','#7A263A','#7A263A')], keeper:gk('whu') },
  { id:'ful', name:'Fulham', short:'FUL', jerseys:[kit('ful-h','Home','plain','#ffffff','#CC0000','#111111','#111111'),kit('ful-a','Away','plain','#111111','#CC0000','#ffffff','#ffffff')], keeper:gk('ful') },
  { id:'cry', name:'Crystal Palace', short:'CRY', jerseys:[kit('cry-h','Home','stripes','#1B458F','#C4122E','#ffffff','#ffffff'),kit('cry-a','Away','plain','#ffffff','#1B458F','#1B458F','#1B458F')], keeper:gk('cry') },
  { id:'wol', name:'Wolves', short:'WOL', jerseys:[kit('wol-h','Home','plain','#FDB913','#231F20','#231F20','#231F20'),kit('wol-a','Away','plain','#231F20','#FDB913','#FDB913','#FDB913')], keeper:gk('wol') },
  { id:'bou', name:'Bournemouth', short:'BOU', jerseys:[kit('bou-h','Home','stripes','#DA291C','#111111','#ffffff','#ffffff'),kit('bou-a','Away','plain','#F0E68C','#DA291C','#DA291C','#DA291C')], keeper:gk('bou') },
  { id:'nfo', name:"Nott'm Forest", short:'NFO', jerseys:[kit('nfo-h','Home','plain','#DD0000','#ffffff','#ffffff','#ffffff'),kit('nfo-a','Away','plain','#ffffff','#DD0000','#DD0000','#DD0000')], keeper:gk('nfo') },
  { id:'bre', name:'Brentford', short:'BRE', jerseys:[kit('bre-h','Home','stripes','#e30613','#ffffff','#111111','#111111'),kit('bre-a','Away','plain','#111111','#e30613','#e30613','#e30613')], keeper:gk('bre') },
  { id:'eve', name:'Everton', short:'EVE', jerseys:[kit('eve-h','Home','plain','#003399','#ffffff','#ffffff','#ffffff'),kit('eve-a','Away','plain','#ffffff','#003399','#003399','#003399')], keeper:gk('eve') },
  { id:'ips', name:'Ipswich Town', short:'IPS', jerseys:[kit('ips-h','Home','plain','#0000FF','#ffffff','#ffffff','#ffffff'),kit('ips-a','Away','plain','#ffffff','#0000FF','#0000FF','#0000FF')], keeper:gk('ips') },
  { id:'lei', name:'Leicester City', short:'LEI', jerseys:[kit('lei-h','Home','plain','#003090','#FDBE11','#ffffff','#ffffff'),kit('lei-a','Away','plain','#ffffff','#003090','#003090','#003090')], keeper:gk('lei') },
  { id:'sou', name:'Southampton', short:'SOU', jerseys:[kit('sou-h','Home','stripes','#D71920','#ffffff','#111111','#111111'),kit('sou-a','Away','plain','#FFC20E','#D71920','#D71920','#D71920')], keeper:gk('sou') },
];

// ── LA LIGA ─────────────────────────────────────────────────
const LALIGA = [
  { id:'rma', name:'Real Madrid', short:'RMA', jerseys:[kit('rma-h','Home','plain','#ffffff','#FEBE10','#111111','#111111'),kit('rma-a','Away','plain','#111111','#FEBE10','#ffffff','#ffffff')], keeper:gk('rma') },
  { id:'fcb', name:'Barcelona', short:'FCB', jerseys:[kit('fcb-h','Home','stripes','#A50044','#004D98','#ffffff','#ffffff'),kit('fcb-a','Away','plain','#004D98','#A50044','#ffffff','#ffffff')], keeper:gk('fcb') },
  { id:'atm', name:'Atletico Madrid', short:'ATM', jerseys:[kit('atm-h','Home','stripes','#CE3524','#ffffff','#272E61','#272E61'),kit('atm-a','Away','plain','#272E61','#CE3524','#ffffff','#ffffff')], keeper:gk('atm') },
  { id:'sev', name:'Sevilla', short:'SEV', jerseys:[kit('sev-h','Home','plain','#ffffff','#D4021D','#D4021D','#D4021D'),kit('sev-a','Away','plain','#D4021D','#ffffff','#ffffff','#ffffff')], keeper:gk('sev') },
  { id:'rso', name:'Real Sociedad', short:'RSO', jerseys:[kit('rso-h','Home','stripes','#143C8B','#ffffff','#ffffff','#ffffff'),kit('rso-a','Away','plain','#ffffff','#143C8B','#143C8B','#143C8B')], keeper:gk('rso') },
  { id:'vil', name:'Villarreal', short:'VIL', jerseys:[kit('vil-h','Home','plain','#FFD700','#005187','#005187','#005187'),kit('vil-a','Away','plain','#005187','#FFD700','#FFD700','#FFD700')], keeper:gk('vil') },
  { id:'bet', name:'Real Betis', short:'BET', jerseys:[kit('bet-h','Home','stripes','#00954C','#ffffff','#ffffff','#ffffff'),kit('bet-a','Away','plain','#ffffff','#00954C','#00954C','#00954C')], keeper:gk('bet') },
  { id:'ath', name:'Athletic Bilbao', short:'ATH', jerseys:[kit('ath-h','Home','stripes','#EE2523','#ffffff','#111111','#111111'),kit('ath-a','Away','plain','#111111','#EE2523','#ffffff','#ffffff')], keeper:gk('ath') },
  { id:'val', name:'Valencia', short:'VAL', jerseys:[kit('val-h','Home','plain','#ffffff','#FF4500','#111111','#111111'),kit('val-a','Away','plain','#111111','#FF4500','#ffffff','#ffffff')], keeper:gk('val') },
  { id:'gir', name:'Girona', short:'GIR', jerseys:[kit('gir-h','Home','stripes','#CD1719','#ffffff','#ffffff','#ffffff'),kit('gir-a','Away','plain','#ffffff','#CD1719','#CD1719','#CD1719')], keeper:gk('gir') },
];

// ── BUNDESLIGA ──────────────────────────────────────────────
const BULI = [
  { id:'bay', name:'Bayern Munich', short:'BAY', jerseys:[kit('bay-h','Home','plain','#DC052D','#0066B2','#ffffff','#ffffff'),kit('bay-a','Away','plain','#ffffff','#DC052D','#DC052D','#DC052D')], keeper:gk('bay') },
  { id:'bvb', name:'Borussia Dortmund', short:'BVB', jerseys:[kit('bvb-h','Home','plain','#FDE100','#000000','#000000','#000000'),kit('bvb-a','Away','plain','#000000','#FDE100','#FDE100','#FDE100')], keeper:gk('bvb') },
  { id:'rbl', name:'RB Leipzig', short:'RBL', jerseys:[kit('rbl-h','Home','plain','#ffffff','#DD0741','#001F47','#001F47'),kit('rbl-a','Away','plain','#001F47','#DD0741','#ffffff','#ffffff')], keeper:gk('rbl') },
  { id:'b04', name:'Bayer Leverkusen', short:'B04', jerseys:[kit('b04-h','Home','plain','#E32221','#000000','#ffffff','#ffffff'),kit('b04-a','Away','plain','#000000','#E32221','#ffffff','#ffffff')], keeper:gk('b04') },
  { id:'sgf', name:'Freiburg', short:'SGF', jerseys:[kit('sgf-h','Home','plain','#D4213D','#ffffff','#111111','#111111'),kit('sgf-a','Away','plain','#ffffff','#D4213D','#D4213D','#D4213D')], keeper:gk('sgf') },
  { id:'fra', name:'Eintracht Frankfurt', short:'FRA', jerseys:[kit('fra-h','Home','plain','#111111','#E1000F','#ffffff','#ffffff'),kit('fra-a','Away','plain','#ffffff','#E1000F','#111111','#111111')], keeper:gk('fra') },
  { id:'vfb', name:'Stuttgart', short:'VFB', jerseys:[kit('vfb-h','Home','stripes','#ffffff','#E32219','#111111','#111111'),kit('vfb-a','Away','plain','#111111','#E32219','#ffffff','#ffffff')], keeper:gk('vfb') },
  { id:'wob', name:'Wolfsburg', short:'WOB', jerseys:[kit('wob-h','Home','plain','#65B32E','#ffffff','#ffffff','#ffffff'),kit('wob-a','Away','plain','#ffffff','#65B32E','#65B32E','#65B32E')], keeper:gk('wob') },
];

// ── COUNTRIES (World Cup pool) ──────────────────────────────
const INTL = [
  { id:'bra', name:'Brazil', short:'BRA', jerseys:[kit('bra-h','Home','plain','#FFDF00','#009739','#009739','#009739'),kit('bra-a','Away','plain','#0033A0','#FFDF00','#ffffff','#ffffff')], keeper:gk('bra') },
  { id:'arg', name:'Argentina', short:'ARG', jerseys:[kit('arg-h','Home','stripes','#75AADB','#ffffff','#111111','#111111'),kit('arg-a','Away','plain','#3E1E68','#75AADB','#ffffff','#ffffff')], keeper:gk('arg') },
  { id:'ger', name:'Germany', short:'GER', jerseys:[kit('ger-h','Home','plain','#ffffff','#111111','#111111','#111111'),kit('ger-a','Away','plain','#111111','#ffffff','#ffffff','#ffffff')], keeper:gk('ger') },
  { id:'fra2', name:'France', short:'FRA', jerseys:[kit('fra2-h','Home','plain','#002654','#ffffff','#ED2939','#ffffff'),kit('fra2-a','Away','plain','#ffffff','#002654','#002654','#002654')], keeper:gk('fra2') },
  { id:'esp', name:'Spain', short:'ESP', jerseys:[kit('esp-h','Home','plain','#FF0000','#FFC400','#FFC400','#FFC400'),kit('esp-a','Away','plain','#ffffff','#FF0000','#FF0000','#FF0000')], keeper:gk('esp') },
  { id:'eng', name:'England', short:'ENG', jerseys:[kit('eng-h','Home','plain','#ffffff','#CE1124','#002366','#002366'),kit('eng-a','Away','plain','#CE1124','#ffffff','#ffffff','#ffffff')], keeper:gk('eng') },
  { id:'ned', name:'Netherlands', short:'NED', jerseys:[kit('ned-h','Home','plain','#FF6600','#ffffff','#111111','#111111'),kit('ned-a','Away','plain','#ffffff','#FF6600','#FF6600','#FF6600')], keeper:gk('ned') },
  { id:'por', name:'Portugal', short:'POR', jerseys:[kit('por-h','Home','plain','#006600','#FF0000','#ffffff','#ffffff'),kit('por-a','Away','plain','#ffffff','#FF0000','#006600','#006600')], keeper:gk('por') },
  { id:'ita', name:'Italy', short:'ITA', jerseys:[kit('ita-h','Home','plain','#0066FF','#ffffff','#ffffff','#ffffff'),kit('ita-a','Away','plain','#ffffff','#0066FF','#0066FF','#0066FF')], keeper:gk('ita') },
  { id:'jpn', name:'Japan', short:'JPN', jerseys:[kit('jpn-h','Home','plain','#002366','#ffffff','#ffffff','#ffffff'),kit('jpn-a','Away','plain','#ffffff','#002366','#002366','#002366')], keeper:gk('jpn') },
  { id:'kor', name:'Korea Republic', short:'KOR', jerseys:[kit('kor-h','Home','plain','#CD2E3A','#ffffff','#111111','#111111'),kit('kor-a','Away','plain','#ffffff','#CD2E3A','#CD2E3A','#CD2E3A')], keeper:gk('kor') },
  { id:'mys', name:'Malaysia', short:'MYS', jerseys:[kit('mys-h','Home','stripes','#010066','#FFCC00','#ffffff','#ffffff'),kit('mys-a','Away','plain','#ffffff','#010066','#010066','#010066')], keeper:gk('mys') },
  { id:'idn', name:'Indonesia', short:'IDN', jerseys:[kit('idn-h','Home','plain','#FF0000','#ffffff','#ffffff','#ffffff'),kit('idn-a','Away','plain','#ffffff','#FF0000','#FF0000','#FF0000')], keeper:gk('idn') },
  { id:'tha', name:'Thailand', short:'THA', jerseys:[kit('tha-h','Home','plain','#003DA5','#ED1C24','#ffffff','#ffffff'),kit('tha-a','Away','plain','#ffffff','#003DA5','#003DA5','#003DA5')], keeper:gk('tha') },
  { id:'sau', name:'Saudi Arabia', short:'KSA', jerseys:[kit('sau-h','Home','plain','#006C35','#ffffff','#ffffff','#ffffff'),kit('sau-a','Away','plain','#ffffff','#006C35','#006C35','#006C35')], keeper:gk('sau') },
  { id:'usa', name:'United States', short:'USA', jerseys:[kit('usa-h','Home','plain','#ffffff','#002868','#BF0A30','#002868'),kit('usa-a','Away','plain','#002868','#BF0A30','#ffffff','#ffffff')], keeper:gk('usa') },
  { id:'mex', name:'Mexico', short:'MEX', jerseys:[kit('mex-h','Home','plain','#006847','#CE1126','#ffffff','#ffffff'),kit('mex-a','Away','plain','#ffffff','#006847','#006847','#006847')], keeper:gk('mex') },
  { id:'cmr', name:'Cameroon', short:'CMR', jerseys:[kit('cmr-h','Home','plain','#007A5E','#CE1126','#FCD116','#FCD116'),kit('cmr-a','Away','plain','#ffffff','#007A5E','#007A5E','#007A5E')], keeper:gk('cmr') },
  { id:'ngr', name:'Nigeria', short:'NGA', jerseys:[kit('ngr-h','Home','chevron','#008751','#ffffff','#ffffff','#ffffff'),kit('ngr-a','Away','plain','#ffffff','#008751','#008751','#008751')], keeper:gk('ngr') },
  { id:'aus', name:'Australia', short:'AUS', jerseys:[kit('aus-h','Home','plain','#FFC72C','#00843D','#002169','#002169'),kit('aus-a','Away','plain','#002169','#FFC72C','#ffffff','#ffffff')], keeper:gk('aus') },
];

// ── leagues ─────────────────────────────────────────────────
export const LEAGUES = [
  { id: 'my', name: 'Liga Malaysia', teams: MY },
  { id: 'epl', name: 'English Premier League', teams: EPL },
  { id: 'laliga', name: 'La Liga', teams: LALIGA },
  { id: 'buli', name: 'Bundesliga', teams: BULI },
  { id: 'intl', name: 'Countries', teams: INTL },
];

export const ALL_TEAMS = [...MY, ...EPL, ...LALIGA, ...BULI, ...INTL];
export function teamById(id) { return ALL_TEAMS.find(t => t.id === id) || ALL_TEAMS[0]; }

// ── default roster (procedural names) ───────────────────────
const NAMES = ['Aiman','Danial','Faris','Firdaus','Haris','Haziq','Ikhwan','Imran','Irfan','Kamal','Luqman','Nazmi','Safuan','Syafiq','Razak','Adam','Zikri','Aqil','Hafiz','Arif','Faiz','Izzat','Nabil','Rafi','Shah','Wafi','Yusuf','Zain'];
const DEFAULT_NUMBERS = [1,2,3,4,5,6,7,8,9,10,11];

export function rosterFor(team) {
  const idx = ALL_TEAMS.indexOf(team);
  const offset = idx >= 0 ? idx * 3 : 0;
  return {
    names: Array.from({ length: 11 }, (_, i) => NAMES[(i + offset) % NAMES.length]),
    numbers: DEFAULT_NUMBERS,
  };
}

// ── field / table / ball themes ─────────────────────────────
export const FIELD_THEMES = [
  { id:'classic', label:'Classic Board', grassA:'#3fae49', grassB:'#36a040', line:'#ffffff', border:'#2f6fd6' },
  { id:'padang', label:'Village Field', grassA:'#7cb342', grassB:'#689f38', line:'#fffde7', border:'#8d6e63' },
  { id:'stadium', label:'Stadium Night', grassA:'#1e7a3a', grassB:'#196a32', line:'#e8f5e9', border:'#111827' },
  { id:'futsal', label:'Futsal Court', grassA:'#2b6cb0', grassB:'#2b6cb0', line:'#ffffff', border:'#f59e0b' },
];

export const TABLE_THEMES = [
  { id:'kuning', label:'Yellow', color:'#ffd21f', wall:'#1f4fb8' },
  { id:'kayu', label:'Wood', color:'#b07a45', wall:'#5b3a1e' },
  { id:'meja', label:'White Table', color:'#e7e5e4', wall:'#78716c' },
  { id:'malam', label:'Night', color:'#1f2937', wall:'#0f172a' },
];

export const BALL_STYLES = [
  { id:'classic', label:'Classic Ball', a:'#ffffff', b:'#111111' },
  { id:'candy', label:'Candy Marble', a:'#ffffff', b:'#ef4f7a' },
  { id:'marble', label:'Orange Marble', a:'#ffb347', b:'#e8590c' },
  { id:'paper', label:'Paper Ball', a:'#f5f5f4', b:'#a8a29e' },
];

export const JERSEY_PATTERNS = ['plain','stripes','pinstripes','hoops','halves','sash','chevron','gradient','checkers'];
