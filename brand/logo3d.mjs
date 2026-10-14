import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
await p.goto('http://127.0.0.1:3077/'); await p.waitForFunction(() => window.__bk); await p.waitForTimeout(800);
const url = await p.evaluate(async () => {
  const THREE = await import('three'), S = await import('/scene.js?v=17'), T = await import('/teams.js?v=17');
  const t = T.teamById('jdt') || T.ALL_TEAMS[0];
  const kit = { ...t.jerseys[0], base: '#d71920', accent: '#1b3f94', pattern: 'stripes', number: '#ffffff', trim: '#ffffff' };
  const w = new S.World(document.createElement('canvas'), [512, 512]);
  w.scene.background = new THREE.Color(0xff00ff); w.scene.fog = null;
  w.setBall({ a: '#ffffff', b: '#151515', kind: 'classic' }); w.static.visible = false; w.venue.visible = false; w.ballRing.visible = false; w.aimGroup.visible = false; w.ballMesh.position.set(0.62, 0.16, 0.18);
  const pl = S.makePlayer({ team: t, kit, number: 10, name: 'KAPTEN', look: { kind: 'plain', base: '#f4f2ec', rough: 0.85, rarity: 'common' } }, new Map());
  pl.root.rotation.y = -1.0; w.dyn.add(pl.root);
  w.cam.fov = 30; w.cam.updateProjectionMatrix(); w.cam.position.set(-0.6, 1.25, 2.3); w.cam.lookAt(0.12, 0.34, 0.05);
  w.sun.position.set(-4, 10, 8); w.r.toneMappingExposure = 1.0; w.render();
  return w.r.domElement.toDataURL('image/png');
});
writeFileSync('/tmp/bkui/logo_raw.png', Buffer.from(url.split(',')[1], 'base64')); await b.close();
