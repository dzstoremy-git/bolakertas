// test-server.js — Bola Kertas server integration
import assert from 'assert';
import { spawn } from 'child_process';
const PORT = 3999;
let pass = 0, fail = 0;
async function ok(n, fn) { try { await fn(); console.log('  ✓', n); pass++; } catch(e){ console.log('  ✗', n, '-', e.message); fail++; } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const proc = spawn('node', ['server.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'pipe' });
proc.stdout.on('data', () => {}); proc.stderr.on('data', () => {});
async function waitUp() { for (let i=0;i<40;i++){ try { const r=await fetch(`http://127.0.0.1:${PORT}/healthz`); if (r.ok) return true; } catch{} await sleep(250); } return false; }
console.log('\n=== Server tests ===\n');
if (!await waitUp()) { console.log('server not up'); process.exit(1); }

console.log('HTTP:');
await ok('GET / 200 + title', async () => { const r=await fetch(`http://127.0.0.1:${PORT}/`); const h=await r.text(); assert.strictEqual(r.status,200); assert.ok(h.includes('Bola Kertas')); });
await ok('GET /engine.js JS', async () => { const r=await fetch(`http://127.0.0.1:${PORT}/engine.js`); assert.strictEqual(r.status,200); assert.ok(r.headers.get('content-type').includes('javascript')); });
await ok('GET /game.js 200', async () => { assert.strictEqual((await fetch(`http://127.0.0.1:${PORT}/game.js`)).status, 200); });
await ok('GET /vendor/three.module.js', async () => { assert.strictEqual((await fetch(`http://127.0.0.1:${PORT}/vendor/three.module.js`)).status, 200); });
await ok('missing 404', async () => { assert.strictEqual((await fetch(`http://127.0.0.1:${PORT}/nope`)).status, 404); });

console.log('\nRooms:');
let code;
await ok('POST /api/room → 5-char code', async () => {
  const r=await fetch(`http://127.0.0.1:${PORT}/api/room`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({rules:{minutes:3}}) });
  const j=await r.json(); code=j.code; assert.ok(/^[A-Z0-9]{5}$/.test(code), code);
});
await ok('bad body 400', async () => { assert.ok((await fetch(`http://127.0.0.1:${PORT}/api/room`, {method:'POST', body:'nope'})).status >= 400); });

console.log('\nWS:');
const { WebSocket } = await import('ws');
await ok('two clients join → both get setup', () => new Promise((resolve, reject) => {
  const a=new WebSocket(`ws://127.0.0.1:${PORT}/ws/room/${code}?pid=p1`);
  const b=new WebSocket(`ws://127.0.0.1:${PORT}/ws/room/${code}?pid=p2`);
  let got={a:null,b:null}; const t=setTimeout(()=>reject(new Error('timeout')),6000);
  const chk=()=>{if(got.a&&got.b){clearTimeout(t);assert.strictEqual(got.a.t,'setup');assert.strictEqual(got.b.t,'setup');a.close();b.close();resolve();}};
  a.on('open',()=>a.send(JSON.stringify({t:'join',profile:{team:'jdt'}})));
  b.on('open',()=>b.send(JSON.stringify({t:'join',profile:{team:'sel'}})));
  a.on('message',m=>{const j=JSON.parse(String(m));if(j.t==='setup'){got.a=j;chk();}});
  b.on('message',m=>{const j=JSON.parse(String(m));if(j.t==='setup'){got.b=j;chk();}});
}));
await ok('nonexistent room errors', () => new Promise(resolve => {
  const w=new WebSocket(`ws://127.0.0.1:${PORT}/ws/room/ZZZZZ?pid=x`);
  let errored=false;
  w.on('message',m=>{const j=JSON.parse(String(m));if(j.t==='err')errored=true;});
  w.on('close',()=>{assert.ok(errored,'no error');resolve();});
}));
await ok('garbage ws no crash', () => new Promise(resolve => {
  const w=new WebSocket(`ws://127.0.0.1:${PORT}/ws/room/${code}?pid=g`);
  w.on('open',()=>{w.send('{{{bad');setTimeout(()=>{w.close();resolve();},300);});
  w.on('error',()=>resolve());
}));

console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
proc.kill(); process.exit(fail>0?1:0);
