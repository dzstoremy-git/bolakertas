// teams.js : Bola Kertas team database
// Each team: id, name, short, league, jerseys (pattern+colors), keeper kits

const kit = (id, label, pattern, base, accent, trim, number, extra = {}) =>
  ({ id, label, pattern, base, accent, trim, number, sponsor: 'BOLA KERTAS', ...extra });

const gk = (prefix) => [
  kit(`${prefix}-gk1`, 'GK Green', 'gradient', '#1f9d55', '#0b5d2f', '#0b3d20', '#ffffff'),
  kit(`${prefix}-gk2`, 'GK Orange', 'checkers', '#f97316', '#c2410c', '#1f2937', '#111111'),
];

// ── MALAYSIA SUPER LEAGUE ───────────────────────────────────
const MY = [
  { id:'jdt', name:"Johor Darul Ta'zim", short:'JDT', jerseys:[kit('jdt-h','Home','pinstripes','#1b3f94','#d71920','#d71920','#ffffff',{ collar:'v' }),kit('jdt-a','Away','sash','#f4f4f4','#d71920','#1b3f94','#1b3f94',{ collar:'v' })], keeper:gk('jdt') },
  { id:'sel', name:'Selangor', short:'SEL', jerseys:[kit('sel-h','Home','shoulders','#d0111b','#ffd400','#ffd400','#ffd400',{ collar:'round' }),kit('sel-a','Away','band','#ffd400','#d0111b','#111111','#d0111b',{ collar:'round' })], keeper:gk('sel') },
  { id:'kdh', name:'Kedah Darul Aman', short:'KDH', jerseys:[kit('kdh-h','Home','stripes','#ffd400','#0f7a3a','#0f7a3a','#0f7a3a',{ collar:'v' }),kit('kdh-a','Away','gradient','#0f7a3a','#064d24','#ffd400','#ffd400',{ collar:'v' })], keeper:gk('kdh') },
  { id:'tfc', name:'Terengganu', short:'TFC', jerseys:[kit('tfc-h','Home','halves','#ffffff','#111111','#111111','#d4202a',{ collar:'polo' }),kit('tfc-a','Away','sides','#111111','#ffffff','#ffffff','#ffffff',{ collar:'polo' })], keeper:gk('tfc') },
  { id:'phg', name:'Sri Pahang', short:'PHG', jerseys:[kit('phg-h','Home','hoops','#ffd400','#111111','#111111','#111111',{ collar:'round' }),kit('phg-a','Away','chevron','#111111','#ffd400','#ffd400','#ffd400',{ collar:'round' })], keeper:gk('phg') },
  { id:'prk', name:'Perak', short:'PRK', jerseys:[kit('prk-h','Home','sash','#ffd400','#ffffff','#111111','#111111',{ collar:'v', sleeve:'#111111' }),kit('prk-a','Away','plain','#111111','#ffd400','#ffd400','#ffd400',{ collar:'v', sleeve:'#ffd400' })], keeper:gk('prk') },
  { id:'sab', name:'Sabah', short:'SAB', jerseys:[kit('sab-h','Home','gradient','#0a6cc4','#003a73','#e11d2a','#ffffff',{ collar:'round' }),kit('sab-a','Away','band','#ffffff','#0a6cc4','#e11d2a','#0a6cc4',{ collar:'round' })], keeper:gk('sab') },
  { id:'kel', name:'Kelantan', short:'KEL', jerseys:[kit('kel-h','Home','centre','#c8102e','#ffffff','#ffffff','#ffffff',{ collar:'polo' }),kit('kel-a','Away','plain','#ffffff','#c8102e','#c8102e','#c8102e',{ collar:'polo', sleeve:'#c8102e' })], keeper:gk('kel') },
  { id:'ns', name:'Negeri Sembilan', short:'NS9', jerseys:[kit('ns-h','Home','quarters','#ffd400','#c8102e','#111111','#111111',{ collar:'v' }),kit('ns-a','Away','plain','#111111','#ffd400','#ffd400','#ffd400',{ collar:'v', sleeve:'#c8102e' })], keeper:gk('ns') },
  { id:'png', name:'Pulau Pinang', short:'PNG', jerseys:[kit('png-h','Home','thinhoops','#2a7de1','#ffffff','#ffffff','#ffffff',{ collar:'round' }),kit('png-a','Away','plain','#ffffff','#2a7de1','#2a7de1','#2a7de1',{ collar:'round', sleeve:'#2a7de1' })], keeper:gk('png') },
  { id:'klc', name:'Kuala Lumpur City', short:'KLC', jerseys:[kit('klc-h','Home','chevron','#ffd700','#d71920','#d71920','#d71920',{ collar:'v' }),kit('klc-a','Away','plain','#d71920','#ffd700','#ffd700','#ffd700',{ collar:'v' })], keeper:gk('klc') },
  { id:'swk', name:'Sarawak', short:'SWK', jerseys:[kit('swk-h','Home','quarters','#e11d2a','#111111','#ffffff','#ffffff',{ collar:'v' }),kit('swk-a','Away','sides','#ffd400','#e11d2a','#111111','#111111',{ collar:'v' })], keeper:gk('swk') },
];

// ── ENGLISH PREMIER LEAGUE ──────────────────────────────────
const EPL = [
  { id:'mci', name:'Manchester City', short:'MCI', jerseys:[kit('mci-h','Home','plain','#6CABDD','#1C2C5B','#ffffff','#ffffff',{ collar:'round', sleeve:'#6CABDD' }),kit('mci-a','Away','stripes','#1C2C5B','#2a3f78','#6CABDD','#6CABDD',{ collar:'v' })], keeper:gk('mci') },
  { id:'ars', name:'Arsenal', short:'ARS', jerseys:[kit('ars-h','Home','plain','#EF0107','#ffffff','#ffffff','#ffffff',{ collar:'polo', sleeve:'#ffffff' }),kit('ars-a','Away','band','#f2d24a','#063672','#063672','#063672',{ collar:'round' })], keeper:gk('ars') },
  { id:'liv', name:'Liverpool', short:'LIV', jerseys:[kit('liv-h','Home','pinstripes','#C8102E','#a50d24','#ffffff','#ffffff',{ collar:'round' }),kit('liv-a','Away','plain','#ffffff','#00B2A9','#C8102E','#C8102E',{ collar:'v', sleeve:'#00B2A9' })], keeper:gk('liv') },
  { id:'mun', name:'Manchester United', short:'MUN', jerseys:[kit('mun-h','Home','shoulders','#DA291C','#111111','#ffffff','#ffffff',{ collar:'polo' }),kit('mun-a','Away','plain','#ffffff','#DA291C','#111111','#DA291C',{ collar:'v', sleeve:'#111111' })], keeper:gk('mun') },
  { id:'tot', name:'Tottenham', short:'TOT', jerseys:[kit('tot-h','Home','plain','#ffffff','#132257','#132257','#132257',{ collar:'round', sleeve:'#132257' }),kit('tot-a','Away','gradient','#132257','#0a1230','#ffffff','#ffffff',{ collar:'v' })], keeper:gk('tot') },
  { id:'che', name:'Chelsea', short:'CHE', jerseys:[kit('che-h','Home','plain','#034694','#ffffff','#ffffff','#ffffff',{ collar:'round' }),kit('che-a','Away','sides','#ffffff','#034694','#034694','#034694',{ collar:'v' })], keeper:gk('che') },
  { id:'avl', name:'Aston Villa', short:'AVL', jerseys:[kit('avl-h','Home','plain','#670E36','#95BFE5','#95BFE5','#95BFE5',{ collar:'v', sleeve:'#95BFE5' }),kit('avl-a','Away','band','#ffffff','#670E36','#95BFE5','#670E36',{ collar:'v' })], keeper:gk('avl') },
  { id:'new', name:'Newcastle', short:'NEW', jerseys:[kit('new-h','Home','stripes','#ffffff','#241F20','#241F20','#241F20',{ collar:'polo' }),kit('new-a','Away','plain','#1f6f4a','#ffffff','#ffffff','#ffffff',{ collar:'round' })], keeper:gk('new') },
  { id:'bha', name:'Brighton', short:'BHA', jerseys:[kit('bha-h','Home','stripes','#ffffff','#0057B8','#0057B8','#0057B8',{ collar:'v' }),kit('bha-a','Away','plain','#ffd400','#0057B8','#0057B8','#0057B8',{ collar:'v', sleeve:'#0057B8' })], keeper:gk('bha') },
  { id:'whu', name:'West Ham', short:'WHU', jerseys:[kit('whu-h','Home','plain','#7A263A','#1BB1E7','#1BB1E7','#ffffff',{ collar:'v', sleeve:'#1BB1E7' }),kit('whu-a','Away','hoops','#ffffff','#1BB1E7','#7A263A','#7A263A',{ collar:'round' })], keeper:gk('whu') },
  { id:'ful', name:'Fulham', short:'FUL', jerseys:[kit('ful-h','Home','plain','#ffffff','#111111','#111111','#111111',{ collar:'polo', sleeve:'#111111' }),kit('ful-a','Away','sash','#111111','#CC0000','#ffffff','#ffffff',{ collar:'v' })], keeper:gk('ful') },
  { id:'cry', name:'Crystal Palace', short:'CRY', jerseys:[kit('cry-h','Home','stripes','#C4122E','#1B458F','#ffffff','#ffffff',{ collar:'round' }),kit('cry-a','Away','sash','#ffffff','#C4122E','#1B458F','#1B458F',{ collar:'round' })], keeper:gk('cry') },
  { id:'wol', name:'Wolves', short:'WOL', jerseys:[kit('wol-h','Home','plain','#FDB913','#231F20','#231F20','#231F20',{ collar:'v', sleeve:'#FDB913' }),kit('wol-a','Away','halves','#231F20','#FDB913','#FDB913','#FDB913',{ collar:'v' })], keeper:gk('wol') },
  { id:'bou', name:'Bournemouth', short:'BOU', jerseys:[kit('bou-h','Home','stripes','#DA291C','#111111','#111111','#ffffff',{ collar:'v' }),kit('bou-a','Away','plain','#ffffff','#DA291C','#111111','#111111',{ collar:'v' })], keeper:gk('bou') },
  { id:'nfo', name:"Nott'm Forest", short:'NFO', jerseys:[kit('nfo-h','Home','plain','#DD0000','#ffffff','#ffffff','#ffffff',{ collar:'polo' }),kit('nfo-a','Away','band','#ffffff','#DD0000','#DD0000','#DD0000',{ collar:'round' })], keeper:gk('nfo') },
  { id:'bre', name:'Brentford', short:'BRE', jerseys:[kit('bre-h','Home','stripes','#ffffff','#e30613','#111111','#111111',{ collar:'round', sleeve:'#111111' }),kit('bre-a','Away','plain','#111111','#ffd400','#ffd400','#ffd400',{ collar:'v' })], keeper:gk('bre') },
  { id:'eve', name:'Everton', short:'EVE', jerseys:[kit('eve-h','Home','plain','#003399','#ffffff','#ffffff','#ffffff',{ collar:'v' }),kit('eve-a','Away','quarters','#ffffff','#e6e6e6','#003399','#003399',{ collar:'polo' })], keeper:gk('eve') },
  { id:'ips', name:'Ipswich Town', short:'IPS', jerseys:[kit('ips-h','Home','plain','#0000FF','#ffffff','#ffffff','#ffffff',{ collar:'v', sleeve:'#ffffff' }),kit('ips-a','Away','plain','#ff6a00','#ffffff','#ffffff','#ffffff',{ collar:'v' })], keeper:gk('ips') },
  { id:'lei', name:'Leicester City', short:'LEI', jerseys:[kit('lei-h','Home','plain','#003090','#FDBE11','#FDBE11','#ffffff',{ collar:'v' }),kit('lei-a','Away','pinstripes','#ffffff','#003090','#003090','#003090',{ collar:'round' })], keeper:gk('lei') },
  { id:'sou', name:'Southampton', short:'SOU', jerseys:[kit('sou-h','Home','stripes','#ffffff','#D71920','#111111','#111111',{ collar:'round' }),kit('sou-a','Away','plain','#ffd400','#111111','#111111','#111111',{ collar:'v' })], keeper:gk('sou') },
];

// ── LA LIGA ─────────────────────────────────────────────────
const LALIGA = [
  { id:'rma', name:'Real Madrid', short:'RMA', jerseys:[kit('rma-h','Home','plain','#ffffff','#FEBE10','#FEBE10','#111111',{ collar:'polo' }),kit('rma-a','Away','plain','#1a1f3d','#FEBE10','#FEBE10','#FEBE10',{ collar:'v', sleeve:'#1a1f3d' })], keeper:gk('rma') },
  { id:'fcb', name:'Barcelona', short:'FCB', jerseys:[kit('fcb-h','Home','stripes','#004D98','#A50044','#FEBE10','#FEBE10',{ collar:'round' }),kit('fcb-a','Away','plain','#FEBE10','#A50044','#A50044','#A50044',{ collar:'v' })], keeper:gk('fcb') },
  { id:'atm', name:'Atletico Madrid', short:'ATM', jerseys:[kit('atm-h','Home','stripes','#ffffff','#CE3524','#272E61','#272E61',{ collar:'v', sleeve:'#272E61' }),kit('atm-a','Away','plain','#272E61','#CE3524','#CE3524','#ffffff',{ collar:'v' })], keeper:gk('atm') },
  { id:'sev', name:'Sevilla', short:'SEV', jerseys:[kit('sev-h','Home','plain','#ffffff','#D4021D','#D4021D','#D4021D',{ collar:'polo', sleeve:'#D4021D' }),kit('sev-a','Away','band','#D4021D','#111111','#ffffff','#ffffff',{ collar:'round' })], keeper:gk('sev') },
  { id:'rso', name:'Real Sociedad', short:'RSO', jerseys:[kit('rso-h','Home','stripes','#ffffff','#143C8B','#143C8B','#143C8B',{ collar:'polo' }),kit('rso-a','Away','plain','#ff6a1a','#143C8B','#143C8B','#143C8B',{ collar:'v' })], keeper:gk('rso') },
  { id:'vil', name:'Villarreal', short:'VIL', jerseys:[kit('vil-h','Home','plain','#FFD700','#005187','#005187','#005187',{ collar:'v', sleeve:'#FFD700' }),kit('vil-a','Away','plain','#005187','#FFD700','#FFD700','#FFD700',{ collar:'v' })], keeper:gk('vil') },
  { id:'bet', name:'Real Betis', short:'BET', jerseys:[kit('bet-h','Home','stripes','#ffffff','#00954C','#00954C','#00954C',{ collar:'polo' }),kit('bet-a','Away','plain','#00954C','#ffffff','#ffffff','#ffffff',{ collar:'v' })], keeper:gk('bet') },
  { id:'ath', name:'Athletic Bilbao', short:'ATH', jerseys:[kit('ath-h','Home','stripes','#ffffff','#EE2523','#111111','#111111',{ collar:'round', sleeve:'#111111' }),kit('ath-a','Away','plain','#111111','#EE2523','#EE2523','#ffffff',{ collar:'v' })], keeper:gk('ath') },
  { id:'val', name:'Valencia', short:'VAL', jerseys:[kit('val-h','Home','plain','#ffffff','#111111','#FF7F00','#111111',{ collar:'round', sleeve:'#111111' }),kit('val-a','Away','stripes','#FF7F00','#111111','#111111','#111111',{ collar:'v' })], keeper:gk('val') },
  { id:'gir', name:'Girona', short:'GIR', jerseys:[kit('gir-h','Home','stripes','#ffffff','#CD1719','#CD1719','#CD1719',{ collar:'v' }),kit('gir-a','Away','plain','#1e2a5a','#CD1719','#ffffff','#ffffff',{ collar:'v' })], keeper:gk('gir') },
];

// ── BUNDESLIGA ──────────────────────────────────────────────
const BULI = [
  { id:'bay', name:'Bayern Munich', short:'BAY', jerseys:[kit('bay-h','Home','pinstripes','#DC052D','#a50422','#ffffff','#ffffff',{ collar:'round' }),kit('bay-a','Away','plain','#ffffff','#DC052D','#0066B2','#DC052D',{ collar:'v', sleeve:'#DC052D' })], keeper:gk('bay') },
  { id:'bvb', name:'Borussia Dortmund', short:'BVB', jerseys:[kit('bvb-h','Home','plain','#FDE100','#000000','#000000','#000000',{ collar:'v', sleeve:'#000000' }),kit('bvb-a','Away','sides','#000000','#FDE100','#FDE100','#FDE100',{ collar:'v' })], keeper:gk('bvb') },
  { id:'rbl', name:'RB Leipzig', short:'RBL', jerseys:[kit('rbl-h','Home','plain','#ffffff','#DD0741','#001F47','#DD0741',{ collar:'round', sleeve:'#DD0741' }),kit('rbl-a','Away','gradient','#001F47','#0a3a7a','#DD0741','#ffffff',{ collar:'v' })], keeper:gk('rbl') },
  { id:'b04', name:'Bayer Leverkusen', short:'B04', jerseys:[kit('b04-h','Home','halves','#E32221','#000000','#000000','#ffffff',{ collar:'v' }),kit('b04-a','Away','plain','#ffffff','#E32221','#000000','#E32221',{ collar:'v' })], keeper:gk('b04') },
  { id:'sgf', name:'Freiburg', short:'SGF', jerseys:[kit('sgf-h','Home','plain','#D4213D','#ffffff','#ffffff','#ffffff',{ collar:'v' }),kit('sgf-a','Away','plain','#111111','#D4213D','#D4213D','#ffffff',{ collar:'round', sleeve:'#D4213D' })], keeper:gk('sgf') },
  { id:'fra', name:'Eintracht Frankfurt', short:'FRA', jerseys:[kit('fra-h','Home','plain','#111111','#E1000F','#E1000F','#ffffff',{ collar:'round', sleeve:'#E1000F' }),kit('fra-a','Away','plain','#ffffff','#E1000F','#111111','#111111',{ collar:'v' })], keeper:gk('fra') },
  { id:'vfb', name:'Stuttgart', short:'VFB', jerseys:[kit('vfb-h','Home','band','#ffffff','#E32219','#E32219','#E32219',{ collar:'round' }),kit('vfb-a','Away','plain','#E32219','#ffffff','#ffffff','#ffffff',{ collar:'v' })], keeper:gk('vfb') },
  { id:'wob', name:'Wolfsburg', short:'WOB', jerseys:[kit('wob-h','Home','plain','#65B32E','#ffffff','#ffffff','#ffffff',{ collar:'v', sleeve:'#ffffff' }),kit('wob-a','Away','sides','#ffffff','#65B32E','#65B32E','#65B32E',{ collar:'v' })], keeper:gk('wob') },
];

// ── COUNTRIES (World Cup pool) ──────────────────────────────
const INTL = [
  { id:'bra', name:'Brazil', short:'BRA', jerseys:[kit('bra-h','Home','plain','#FFDF00','#009739','#009739','#009739',{ collar:'round', sleeve:'#009739' }),kit('bra-a','Away','plain','#012169','#FFDF00','#FFDF00','#ffffff',{ collar:'v' })], keeper:gk('bra') },
  { id:'arg', name:'Argentina', short:'ARG', jerseys:[kit('arg-h','Home','stripes','#ffffff','#75AADB','#111111','#111111',{ collar:'polo' }),kit('arg-a','Away','plain','#1a1f5c','#75AADB','#75AADB','#75AADB',{ collar:'round' })], keeper:gk('arg') },
  { id:'ger', name:'Germany', short:'GER', jerseys:[kit('ger-h','Home','band','#ffffff','#111111','#DD0000','#111111',{ collar:'round' }),kit('ger-a','Away','gradient','#d21d6a','#5b1a8a','#ffffff','#ffffff',{ collar:'v' })], keeper:gk('ger') },
  { id:'fra2', name:'France', short:'FRA', jerseys:[kit('fra2-h','Home','plain','#002654','#ffffff','#ED2939','#ffffff',{ collar:'v' }),kit('fra2-a','Away','pinstripes','#ffffff','#002654','#ED2939','#002654',{ collar:'round' })], keeper:gk('fra2') },
  { id:'esp', name:'Spain', short:'ESP', jerseys:[kit('esp-h','Home','plain','#C60B1E','#FFC400','#FFC400','#FFC400',{ collar:'v', sleeve:'#C60B1E' }),kit('esp-a','Away','plain','#f2f2f2','#C60B1E','#FFC400','#C60B1E',{ collar:'round' })], keeper:gk('esp') },
  { id:'eng', name:'England', short:'ENG', jerseys:[kit('eng-h','Home','plain','#ffffff','#CE1124','#002366','#002366',{ collar:'polo', sleeve:'#ffffff' }),kit('eng-a','Away','plain','#CE1124','#002366','#ffffff','#ffffff',{ collar:'v' })], keeper:gk('eng') },
  { id:'ned', name:'Netherlands', short:'NED', jerseys:[kit('ned-h','Home','plain','#FF6600','#ffffff','#111111','#111111',{ collar:'round' }),kit('ned-a','Away','plain','#1a2a6a','#FF6600','#FF6600','#FF6600',{ collar:'v' })], keeper:gk('ned') },
  { id:'por', name:'Portugal', short:'POR', jerseys:[kit('por-h','Home','plain','#C8102E','#006600','#006600','#FFD700',{ collar:'v', sleeve:'#006600' }),kit('por-a','Away','stripes','#ffffff','#006600','#C8102E','#006600',{ collar:'polo' })], keeper:gk('por') },
  { id:'ita', name:'Italy', short:'ITA', jerseys:[kit('ita-h','Home','plain','#0066FF','#ffffff','#ffffff','#ffffff',{ collar:'v' }),kit('ita-a','Away','plain','#ffffff','#0066FF','#0066FF','#0066FF',{ collar:'round', sleeve:'#0066FF' })], keeper:gk('ita') },
  { id:'jpn', name:'Japan', short:'JPN', jerseys:[kit('jpn-h','Home','band','#002366','#ffffff','#ffffff','#ffffff',{ collar:'v' }),kit('jpn-a','Away','plain','#ffffff','#002366','#d71920','#002366',{ collar:'v' })], keeper:gk('jpn') },
  { id:'kor', name:'Korea Republic', short:'KOR', jerseys:[kit('kor-h','Home','plain','#CD2E3A','#111111','#111111','#ffffff',{ collar:'round' }),kit('kor-a','Away','plain','#ffffff','#111111','#CD2E3A','#111111',{ collar:'round', sleeve:'#111111' })], keeper:gk('kor') },
  { id:'mys', name:'Malaysia', short:'MYS', jerseys:[kit('mys-h','Home','stripes','#FFCC00','#111111','#111111','#111111',{ collar:'v' }),kit('mys-a','Away','plain','#010066','#FFCC00','#cc0001','#FFCC00',{ collar:'v' })], keeper:gk('mys') },
  { id:'idn', name:'Indonesia', short:'IDN', jerseys:[kit('idn-h','Home','plain','#FF0000','#ffffff','#ffffff','#ffffff',{ collar:'polo' }),kit('idn-a','Away','plain','#ffffff','#FF0000','#FF0000','#FF0000',{ collar:'round', sleeve:'#FF0000' })], keeper:gk('idn') },
  { id:'tha', name:'Thailand', short:'THA', jerseys:[kit('tha-h','Home','plain','#003DA5','#ED1C24','#ffffff','#ffffff',{ collar:'v' }),kit('tha-a','Away','sash','#ffffff','#ED1C24','#003DA5','#003DA5',{ collar:'round' })], keeper:gk('tha') },
  { id:'sau', name:'Saudi Arabia', short:'KSA', jerseys:[kit('sau-h','Home','plain','#006C35','#ffffff','#ffffff','#ffffff',{ collar:'v', sleeve:'#ffffff' }),kit('sau-a','Away','plain','#ffffff','#006C35','#006C35','#006C35',{ collar:'v' })], keeper:gk('sau') },
  { id:'usa', name:'United States', short:'USA', jerseys:[kit('usa-h','Home','hoops','#ffffff','#e8ecf5','#002868','#002868',{ collar:'round' }),kit('usa-a','Away','pinstripes','#002868','#BF0A30','#BF0A30','#ffffff',{ collar:'v' })], keeper:gk('usa') },
  { id:'mex', name:'Mexico', short:'MEX', jerseys:[kit('mex-h','Home','plain','#006847','#CE1126','#ffffff','#ffffff',{ collar:'polo', sleeve:'#006847' }),kit('mex-a','Away','plain','#ffffff','#006847','#CE1126','#006847',{ collar:'v' })], keeper:gk('mex') },
  { id:'cmr', name:'Cameroon', short:'CMR', jerseys:[kit('cmr-h','Home','halves','#007A5E','#CE1126','#FCD116','#FCD116',{ collar:'v' }),kit('cmr-a','Away','plain','#FCD116','#007A5E','#CE1126','#007A5E',{ collar:'round' })], keeper:gk('cmr') },
  { id:'ngr', name:'Nigeria', short:'NGA', jerseys:[kit('ngr-h','Home','chevron','#008751','#b8e986','#ffffff','#ffffff',{ collar:'v' }),kit('ngr-a','Away','plain','#ffffff','#008751','#008751','#008751',{ collar:'round', sleeve:'#008751' })], keeper:gk('ngr') },
  { id:'aus', name:'Australia', short:'AUS', jerseys:[kit('aus-h','Home','plain','#FFC72C','#00843D','#00843D','#00843D',{ collar:'v', sleeve:'#00843D' }),kit('aus-a','Away','plain','#00843D','#FFC72C','#FFC72C','#FFC72C',{ collar:'v' })], keeper:gk('aus') },
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

// ── custom squad + kit studio (validated here, used by browser and server) ──
export const KIT_PATTERNS = ['plain', 'stripes', 'pinstripes', 'hoops', 'thinhoops', 'halves', 'quarters', 'sash', 'chevron', 'centre', 'sides', 'shoulders', 'band', 'gradient', 'checkers'];
export const PREMIUM_PATTERNS = ['batik', 'songket', 'tiger', 'prism'];
export const COLLARS = ['v', 'round', 'polo'];
// ponytail: short word list, swap for a proper filter service if abuse shows up
const BAD = ['babi', 'bodoh', 'sial', 'pukimak', 'puki', 'pantat', 'lancau', 'kote', 'butoh', 'bangsat', 'anjing', 'celaka', 'jubur', 'fuck', 'shit', 'bitch', 'dick', 'cunt', 'nigg', 'pussy', 'asshole'];
const clean = v => { const t = String(v ?? '').normalize('NFKC').replace(/[^\p{L}\p{N} .'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 12); const flat = t.toLowerCase().replace(/[^a-z]/g, '').replace(/0/g, 'o'); return BAD.some(b => flat.includes(b)) ? '' : t; };
// Names 1-12 chars (letters, digits, space . ' -), shirt numbers 1-99 unique. Bad entries fall back to the default.
export function cleanRoster(r, team) {
  const d = rosterFor(team), names = [], numbers = [], used = new Set();
  for (let i = 0; i < 11; i++) {
    names.push(clean(r?.names?.[i]) || d.names[i]);
    let n = Math.trunc(Number(r?.numbers?.[i])); if (!(n >= 1 && n <= 99) || used.has(n)) n = d.numbers[i]; while (used.has(n)) n = n % 99 + 1;
    used.add(n); numbers.push(n);
  }
  return { names, numbers };
}
const hex = (v, d) => /^#[0-9a-f]{6}$/i.test(String(v)) ? String(v).toLowerCase() : d;
// Custom kit from the studio. Premium patterns only if the owner has the studio pack.
export function cleanKit(k, premium = false) {
  if (!k || typeof k !== 'object') return null;
  const pat = KIT_PATTERNS.includes(k.pattern) || (premium && PREMIUM_PATTERNS.includes(k.pattern)) ? k.pattern : 'plain';
  return { id: 'custom', label: 'Studio', pattern: pat, base: hex(k.base, '#1b3f94'), accent: hex(k.accent, '#ffffff'), trim: hex(k.trim, '#ffffff'), number: hex(k.number, '#ffffff'),
    collar: COLLARS.includes(k.collar) ? k.collar : 'v', sleeve: k.sleeve ? hex(k.sleeve, null) : null, sponsor: clean(k.sponsor) || 'BOLA KERTAS' };
}

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


