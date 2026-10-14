// game.js — Bola Kertas 3D renderer + UI + net client
import * as THREE from 'three';
import { Engine, FIELD, BALL_R, PIECE, STEP, SHOT_TYPES, FORMATIONS, MAX_TAPS, checksum, runToRest, makeCode } from './engine.js';
import { LEAGUES, ALL_TEAMS, teamById, rosterFor, FIELD_THEMES, TABLE_THEMES, BALL_STYLES } from './teams.js';

// ── globals ─────────────────────────────────────────────────
const tg = () => window.Telegram?.WebApp;
let renderer, scene, camera, clock;
let engine = null;
let meshes = { pieces: [], ball: null, field: null, goals: [] };
let state = { screen: 'menu', settings: loadSettings(), selectedShotIdx: 0 };
let aimState = { dragging: false, startX: 0, startY: 0, dx: 0, dy: 0 };
let ws = null;
let online = null; // { seat, code }
const $ = s => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };

// ── settings persistence ────────────────────────────────────
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('bola-kertas/settings/v1'));
    return { team0: 'jdt', team1: 'sel', formation: '4-4-2', cpuSkill: 0.5, minutes: 3, goalsToWin: 0, fieldTheme: 0, ...s };
  } catch { return { team0: 'jdt', team1: 'sel', formation: '4-4-2', cpuSkill: 0.5, minutes: 3, goalsToWin: 0, fieldTheme: 0 }; }
}
function saveSettings() { localStorage.setItem('bola-kertas/settings/v1', JSON.stringify(state.settings)); }

// ── init Three.js ───────────────────────────────────────────
function initRenderer() {
  const canvas = $('#canvas');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  scene = new THREE.Scene();
  scene.background = new THREE.Color('#1a1a2e');
  scene.fog = new THREE.Fog('#1a1a2e', 30, 50);

  camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 100);
  camera.position.set(0, 16, 14);
  camera.lookAt(0, 0, 0);

  // lights
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(5, 12, 5);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x87CEEB, 0x8B4513, 0.5));
  scene.add(new THREE.AmbientLight(0xffffff, 0.2));

  clock = new THREE.Clock();
  onResize();
  window.addEventListener('resize', onResize);
}

function onResize() {
  const w = innerWidth, h = innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

// ── build 3D scene ──────────────────────────────────────────
function buildScene(t0, t1) {
  // clear old
  while (scene.children.length > 3) scene.remove(scene.children[scene.children.length - 1]);
  meshes.pieces = []; meshes.goals = [];

  const ft = FIELD_THEMES[state.settings.fieldTheme] || FIELD_THEMES[0];

  // field plane
  const fieldGeo = new THREE.PlaneGeometry(FIELD.W + 2, FIELD.L + 2);
  const fieldMat = new THREE.MeshLambertMaterial({ color: ft.grassA });
  const fieldMesh = new THREE.Mesh(fieldGeo, fieldMat);
  fieldMesh.rotation.x = -Math.PI / 2;
  scene.add(fieldMesh);
  meshes.field = fieldMesh;

  // field lines
  const lineMat = new THREE.LineBasicMaterial({ color: ft.line, linewidth: 2 });
  // outline
  const hw = FIELD.W / 2, hl = FIELD.L / 2;
  const outPts = [new THREE.Vector3(-hw,0.01,-hl), new THREE.Vector3(hw,0.01,-hl), new THREE.Vector3(hw,0.01,hl), new THREE.Vector3(-hw,0.01,hl), new THREE.Vector3(-hw,0.01,-hl)];
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(outPts), lineMat));
  // halfway
  const midPts = [new THREE.Vector3(-hw,0.01,0), new THREE.Vector3(hw,0.01,0)];
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(midPts), lineMat));
  // center circle
  const circPts = [];
  for (let a = 0; a <= Math.PI * 2; a += 0.1) circPts.push(new THREE.Vector3(Math.cos(a)*2, 0.01, Math.sin(a)*2));
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(circPts), lineMat));

  // goals (simple box frames)
  for (const side of [-1, 1]) {
    const gw = FIELD.goalW, gd = FIELD.goalD, gh = FIELD.goalH;
    const gz = side * hl;
    // posts
    for (const px of [-gw/2, gw/2]) {
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(FIELD.postR, FIELD.postR, gh, 8),
        new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 0.6, roughness: 0.3 })
      );
      post.position.set(px, gh / 2, gz);
      scene.add(post);
      meshes.goals.push(post);
    }
    // crossbar
    const bar = new THREE.Mesh(
      new THREE.CylinderGeometry(FIELD.postR, FIELD.postR, gw, 8),
      new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 0.6, roughness: 0.3 })
    );
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, gh, gz);
    scene.add(bar);
    // net (simple plane)
    const netGeo = new THREE.PlaneGeometry(gw, gh);
    const netMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.15, side: THREE.DoubleSide });
    const net = new THREE.Mesh(netGeo, netMat);
    net.position.set(0, gh / 2, gz + side * gd / 2);
    scene.add(net);
  }

  // ball
  const ballGeo = new THREE.SphereGeometry(BALL_R, 16, 16);
  const ballMat = new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 0.1, roughness: 0.4 });
  meshes.ball = new THREE.Mesh(ballGeo, ballMat);
  scene.add(meshes.ball);

  // pieces — cone shapes with team colors
  if (!engine) return;
  for (const p of engine.pieces) {
    const team = p.team === 0 ? t0 : t1;
    const jersey = p.isGK ? team.keeper[0] : team.jerseys[0];
    const color = jersey.base;
    const geo = new THREE.ConeGeometry(PIECE.w / 2, PIECE.h, 6);
    const mat = new THREE.MeshLambertMaterial({ color });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(p.x, PIECE.h / 2, p.z);
    scene.add(mesh);
    meshes.pieces.push(mesh);
    // number label — skip for now, just color
  }
}

// ── update loop ─────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  if (!engine || state.screen !== 'play') { renderer.render(scene, camera); return; }

  const dt = Math.min(clock.getDelta(), 0.05);

  // CPU turn
  if (engine.phase === 'aim' && isCpuTurn()) {
    engine.turnT += dt; // let CPU "think" for a beat
    if (engine.turnT > 0.8) {
      const action = engine.cpuAction();
      if (action) engine._applyAction(action);
    }
  }

  // step engine
  engine.acc = (engine.acc || 0) + dt;
  while (engine.acc >= STEP) { engine.step(STEP); engine.acc -= STEP; }

  // sync meshes
  const b = engine.ball;
  if (meshes.ball) meshes.ball.position.set(b.x, b.y + BALL_R, b.z);
  for (let i = 0; i < engine.pieces.length; i++) {
    const p = engine.pieces[i], m = meshes.pieces[i];
    if (!m) continue;
    m.position.set(p.x, PIECE.h / 2 + p.y, p.z);
    m.rotation.y = p.rot;
    const wobble = p.wobble > 0 ? Math.sin(p.wobble * 20) * 0.1 : 0;
    m.rotation.z = wobble;
  }

  // camera follow ball slightly
  const cx = b.x * 0.15, cz = b.z * 0.15 + 2;
  camera.position.x += (cx - camera.position.x) * 0.05;
  camera.position.z += (14 + cz - camera.position.z) * 0.05;
  camera.lookAt(0, 0, b.z * 0.3);

  updateHUD();
  renderer.render(scene, camera);

  // auto halftime
  if (engine.phase === 'halftime' && engine.phaseT > 2) {
    engine._applyAction({ t: 'half' });
  }
}

function isCpuTurn() {
  if (online) return false;
  return engine.opts.cpu[engine.turnTeam];
}

// ── HUD ─────────────────────────────────────────────────────
function updateHUD() {
  const hud = $('#hud');
  if (!engine) { hud.innerHTML = ''; return; }
  const t0 = teamById(state.settings.team0);
  const t1 = teamById(state.settings.team1);
  const timeStr = engine.timeLeft != null ? `${Math.floor(engine.timeLeft / 60)}:${String(Math.floor(engine.timeLeft % 60)).padStart(2, '0')}` : '';

  hud.innerHTML = `
    <div class="hud-score" style="color:${t0.jerseys[0].base}">${t0.short} ${engine.score[0]}</div>
    <div class="hud-time">${timeStr}${engine.half === 1 && engine.opts.halves ? ' H1' : engine.half === 2 ? ' H2' : ''}</div>
    <div class="hud-score" style="color:${t1.jerseys[0].base}">${engine.score[1]} ${t1.short}</div>
  `;

  // message overlay
  let msgEl = $('#msg-overlay');
  if (engine.message && engine.message.t < 2.5) {
    if (!msgEl) { msgEl = el('div', 'hud-msg'); msgEl.id = 'msg-overlay'; document.getElementById('app').appendChild(msgEl); }
    msgEl.textContent = engine.message.text;
    msgEl.style.opacity = engine.message.t < 2 ? '1' : '0';
  } else if (msgEl) { msgEl.remove(); }

  // game over
  if (engine.phase === 'over' && !$('#game-over')) {
    showGameOver();
  }

  // aim UI
  updateAimUI();
}

function updateAimUI() {
  let aimRing = $('#aim-ring');
  let powerBar = $('#power-bar');
  let shotBtns = $('#shot-btns');

  if (engine.phase === 'aim' && !isCpuTurn()) {
    if (!aimRing) {
      aimRing = el('div', 'aim-ring'); aimRing.id = 'aim-ring';
      document.getElementById('app').appendChild(aimRing);

      powerBar = el('div', 'power-bar'); powerBar.id = 'power-bar';
      powerBar.innerHTML = '<div class="power-fill" id="power-fill"></div>';
      document.getElementById('app').appendChild(powerBar);

      shotBtns = el('div', 'shot-btns'); shotBtns.id = 'shot-btns';
      SHOT_TYPES.forEach((st, i) => {
        const b = el('button', `shot-btn${i === state.selectedShotIdx ? ' active' : ''}`, st.charAt(0).toUpperCase() + st.slice(1));
        b.onclick = () => { state.selectedShotIdx = i; document.querySelectorAll('.shot-btn').forEach((x,j) => x.classList.toggle('active', j===i)); };
        shotBtns.appendChild(b);
      });
      document.getElementById('app').appendChild(shotBtns);
    }
    // update power fill during drag
    const pf = $('#power-fill');
    if (pf && aimState.dragging) {
      const dragDist = Math.hypot(aimState.dx, aimState.dy);
      const power = Math.min(1, dragDist / 150);
      pf.style.width = (power * 100) + '%';
    }
    // turn timer
    if (engine.turnLeft != null && engine.turnLeft < 5) {
      if (aimRing) aimRing.style.borderColor = `rgba(239,68,68,${0.5 + Math.sin(Date.now()/200)*0.5})`;
    }
  } else {
    aimRing?.remove();
    powerBar?.remove();
    shotBtns?.remove();
  }
}

// ── aim input (drag to shoot) ───────────────────────────────
function setupInput() {
  const canvas = $('#canvas');

  const onDown = (x, y) => {
    if (engine?.phase !== 'aim' || isCpuTurn()) return;
    aimState.dragging = true;
    aimState.startX = x; aimState.startY = y;
    aimState.dx = 0; aimState.dy = 0;
  };

  const onMove = (x, y) => {
    if (!aimState.dragging) return;
    aimState.dx = aimState.startX - x; // drag BACK = aim FORWARD
    aimState.dy = aimState.startY - y;
  };

  const onUp = () => {
    if (!aimState.dragging || !engine || engine.phase !== 'aim') { aimState.dragging = false; return; }
    aimState.dragging = false;
    const dragDist = Math.hypot(aimState.dx, aimState.dy);
    if (dragDist < 15) return; // too short, ignore

    const power = Math.min(1, dragDist / 150);
    // convert screen drag to world direction
    // dx: left-right maps to x; dy: up maps to -z (towards opponent goal when team 0)
    const len = Math.hypot(aimState.dx, aimState.dy) || 1;
    const worldDx = aimState.dx / len;
    const worldDz = -aimState.dy / len; // screen up = -z in our coordinate

    const action = { t: 'aim', dx: worldDx, dz: worldDz, power, shotIdx: state.selectedShotIdx };

    if (online && engine.intercept) {
      engine.intercept(action);
    } else {
      engine._applyAction(action);
    }
    tg()?.HapticFeedback?.impactOccurred?.('light');
  };

  canvas.addEventListener('pointerdown', e => { e.preventDefault(); onDown(e.clientX, e.clientY); });
  canvas.addEventListener('pointermove', e => { e.preventDefault(); onMove(e.clientX, e.clientY); });
  canvas.addEventListener('pointerup', e => { e.preventDefault(); onUp(); });
  canvas.addEventListener('pointercancel', () => { aimState.dragging = false; });
}

// ── menus ───────────────────────────────────────────────────
function showMenu() {
  state.screen = 'menu';
  const menu = $('#menu');
  menu.classList.remove('hidden');

  const playerName = tg()?.initDataUnsafe?.user?.first_name || 'Player';

  menu.innerHTML = `
    <div class="menu-title">⚽ BOLA KERTAS</div>
    <div class="menu-subtitle">3D Paper Football — ${playerName}</div>
    <button class="btn btn-primary" id="btn-vs-cpu">🎮 Lawan CPU</button>
    <button class="btn btn-dark" id="btn-online">🌐 Online PvP</button>
    <button class="btn btn-dark btn-sm" id="btn-settings">⚙️ Tetapan</button>
  `;

  $('#btn-vs-cpu').onclick = () => showTeamPicker('cpu');
  $('#btn-online').onclick = () => showOnlineMenu();
  $('#btn-settings').onclick = () => showSettingsMenu();
}

function showTeamPicker(mode) {
  const menu = $('#menu');
  let selectedLeague = 'my';
  let team0 = state.settings.team0;
  let team1 = state.settings.team1;
  let pickingSlot = 0; // 0 = your team, 1 = opponent

  function render() {
    const league = LEAGUES.find(l => l.id === selectedLeague) || LEAGUES[0];
    menu.innerHTML = `
      <div class="menu-title">Pilih Pasukan</div>
      <div style="margin-bottom:8px;font-size:13px;opacity:.8">${pickingSlot === 0 ? 'Pasukan Anda' : 'Pasukan Lawan'}: <strong>${teamById(pickingSlot === 0 ? team0 : team1).name}</strong></div>
      <div class="league-tabs" id="league-tabs"></div>
      <div class="team-grid" id="team-grid"></div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn btn-dark btn-sm" id="btn-back">← Balik</button>
        ${pickingSlot === 0 ? '<button class="btn btn-primary btn-sm" id="btn-next">Pilih Lawan →</button>' : '<button class="btn btn-primary btn-sm" id="btn-play">⚽ Mula!</button>'}
      </div>
    `;

    const tabsEl = $('#league-tabs');
    LEAGUES.forEach(l => {
      const tab = el('button', `league-tab${l.id === selectedLeague ? ' active' : ''}`, l.name);
      tab.onclick = () => { selectedLeague = l.id; render(); };
      tabsEl.appendChild(tab);
    });

    const grid = $('#team-grid');
    league.teams.forEach(t => {
      const card = el('div', `team-card${(pickingSlot === 0 ? team0 : team1) === t.id ? ' sel' : ''}`);
      card.innerHTML = `<div class="swatch" style="background:${t.jerseys[0].base}"></div>${t.short}`;
      card.onclick = () => {
        if (pickingSlot === 0) team0 = t.id; else team1 = t.id;
        render();
      };
      grid.appendChild(card);
    });

    $('#btn-back').onclick = () => { if (pickingSlot === 1) { pickingSlot = 0; render(); } else showMenu(); };
    if (pickingSlot === 0) {
      $('#btn-next').onclick = () => { pickingSlot = 1; render(); };
    } else {
      $('#btn-play').onclick = () => {
        state.settings.team0 = team0;
        state.settings.team1 = team1;
        saveSettings();
        if (mode === 'cpu') startCpuMatch();
        else startOnlineMatch();
      };
    }
  }
  render();
}

function showOnlineMenu() {
  const menu = $('#menu');
  menu.innerHTML = `
    <div class="menu-title">🌐 Online PvP</div>
    <div class="menu-subtitle">BETA — Cabaran kawan atau cari lawan</div>
    <button class="btn btn-primary" id="btn-find">🔍 Cari Perlawanan</button>
    <button class="btn btn-dark" id="btn-create">🔗 Cipta Bilik</button>
    <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
      <input id="code-input" placeholder="KOD BILIK" maxlength="8" style="padding:10px;border-radius:8px;background:#1f2937;color:#fff;border:1px solid #374151;font-size:16px;width:140px;text-transform:uppercase">
      <button class="btn btn-dark btn-sm" id="btn-join">Sertai</button>
    </div>
    <button class="btn btn-dark btn-sm" id="btn-back" style="margin-top:12px">← Balik</button>
  `;
  $('#btn-back').onclick = showMenu;
  $('#btn-find').onclick = () => { showTeamPicker('queue'); };
  $('#btn-create').onclick = () => { showTeamPicker('host'); };
  $('#btn-join').onclick = () => {
    const code = $('#code-input').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length >= 4) { state.joinCode = code; showTeamPicker('join'); }
  };
}

function showSettingsMenu() {
  const menu = $('#menu');
  const s = state.settings;
  menu.innerHTML = `
    <div class="menu-title">⚙️ Tetapan</div>
    <div style="display:flex;flex-direction:column;gap:12px;width:100%;max-width:300px">
      <label>Formasi: <select id="sel-form">${Object.keys(FORMATIONS).map(f => `<option${f===s.formation?' selected':''}>${f}</option>`).join('')}</select></label>
      <label>Masa (minit): <select id="sel-min">${[1,3,5,10].map(m => `<option${m===s.minutes?' selected':''}>${m}</option>`).join('')}</select></label>
      <label>CPU Skill: <select id="sel-cpu">${[['Easy',0.2],['Normal',0.5],['Hard',0.8]].map(([l,v]) => `<option value="${v}"${v===s.cpuSkill?' selected':''}>${l}</option>`).join('')}</select></label>
      <label>Padang: <select id="sel-field">${FIELD_THEMES.map((f,i) => `<option value="${i}"${i===s.fieldTheme?' selected':''}>${f.label}</option>`).join('')}</select></label>
    </div>
    <button class="btn btn-primary btn-sm" id="btn-save" style="margin-top:12px">Simpan</button>
    <button class="btn btn-dark btn-sm" id="btn-back">← Balik</button>
  `;
  $('#btn-save').onclick = () => {
    s.formation = $('#sel-form').value;
    s.minutes = parseInt($('#sel-min').value);
    s.cpuSkill = parseFloat($('#sel-cpu').value);
    s.fieldTheme = parseInt($('#sel-field').value);
    saveSettings();
    showMenu();
  };
  $('#btn-back').onclick = showMenu;
}

function showGameOver() {
  const div = el('div'); div.id = 'game-over';
  div.style.cssText = 'position:absolute;inset:0;z-index:50;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(0,0,0,.8);backdrop-filter:blur(6px);gap:12px';
  const t0 = teamById(state.settings.team0), t1 = teamById(state.settings.team1);
  const w = engine.winner;
  const winText = w === null ? 'SERI!' : `${(w === 0 ? t0 : t1).name} MENANG!`;
  div.innerHTML = `
    <div style="font-size:20px;opacity:.8">TAMAT</div>
    <div style="font-size:40px;font-weight:900;color:#FFD700">${engine.score[0]} - ${engine.score[1]}</div>
    <div style="font-size:24px;font-weight:700">${winText}</div>
    <button class="btn btn-primary" id="btn-again">Main Lagi</button>
    <button class="btn btn-dark" id="btn-menu2">Menu</button>
  `;
  document.getElementById('app').appendChild(div);
  $('#btn-again').onclick = () => { div.remove(); startCpuMatch(); };
  $('#btn-menu2').onclick = () => { div.remove(); showMenu(); };
}

// ── start match ─────────────────────────────────────────────
function startCpuMatch() {
  const s = state.settings;
  const t0 = teamById(s.team0), t1 = teamById(s.team1);
  engine = new Engine({
    goalsToWin: s.goalsToWin, minutes: s.minutes, halves: true,
    powerStrike: true, layout: 'spread', turnLimit: 15,
    formations: [s.formation, '4-3-3'],
    rosters: [rosterFor(t0), rosterFor(t1)],
    cpu: [false, true], cpuSkill: s.cpuSkill,
    seed: Date.now(),
  });
  state.screen = 'play';
  online = null;
  $('#menu').classList.add('hidden');
  $('#game-over')?.remove();
  buildScene(t0, t1);
  clock.getDelta(); // reset
}

function startOnlineMatch() {
  // ponytail: online WS flow — queue/host/join, then lockstep
  // placeholder: for now just start CPU match, online flow wired later
  startCpuMatch();
}

// ── QA hook ─────────────────────────────────────────────────
function expose() {
  window.__bk = {
    get engine() { return engine; },
    get state() { return state; },
    get online() { return online; },
    get errs() { return window.__errs || []; },
    snapshot() {
      if (!engine) return null;
      return {
        screen: state.screen, phase: engine.phase, score: engine.score,
        turnTeam: engine.turnTeam, clock: +engine.clock.toFixed(2),
        timeLeft: engine.timeLeft, taps: engine.tapsInRow,
        ball: { x: +engine.ball.x.toFixed(3), z: +engine.ball.z.toFixed(3), y: +engine.ball.y.toFixed(3) },
        pieces: engine.pieces.length, msg: engine.message?.text || null,
      };
    },
    shoot(dx, dz, power, shotIdx = 0) {
      if (!engine || engine.phase !== 'aim') return false;
      const a = { t: 'aim', dx, dz, power, shotIdx };
      if (online && engine.intercept) engine.intercept(a); else engine._applyAction(a);
      return true;
    },
    menu() { showMenu(); },
  };
}

// ── boot ────────────────────────────────────────────────────
function boot() {
  tg()?.ready?.();
  tg()?.expand?.();
  initRenderer();
  setupInput();
  expose();
  showMenu();
  animate();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
