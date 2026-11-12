// End-to-end gameplay test against the real game in headless Chrome (software WebGL).
// Drives real DOM keyboard/mouse events; the simulation is stepped deterministically via window.__game.test.
// Usage: node scripts/e2e.mjs [baseUrl]
import { chromium } from 'playwright-core';
const base = process.argv[2] || 'http://localhost:4173/';
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

// ---------- 1. real page (no test flag): load, assets, pointer lock ----------
{
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [], bad = [], external = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()); if (!r.url().startsWith(base) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url()); });
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 180000 });
  check('game loads and reaches ready state', await page.evaluate(() => window.__game.state.phase === 'ready'));
  check('no console errors on load', errors.length === 0, errors.slice(0, 3).join(' | '));
  check('no failed asset requests', bad.length === 0, bad.slice(0, 3).join(' | '));
  check('no external runtime requests', external.length === 0, external.slice(0, 3).join(' | '));
  await page.click('#overlay');
  await page.waitForTimeout(1200);
  const lock = await page.evaluate(() => ({ locked: document.pointerLockElement === document.getElementById('game'), phase: window.__game.state.phase }));
  check('click-to-enter acquires pointer lock and starts the mission', lock.locked && lock.phase === 'playing', JSON.stringify(lock));
  await page.close();
}

// ---------- 2. deterministic gameplay run ----------
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(base + '?test=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 180000 });
await page.evaluate(() => window.__game.test.start());
const step = (n) => page.evaluate((n) => window.__game.test.step(n), n);
const get = (code) => page.evaluate((code) => new Function('g', 'return ' + code)(window.__game), code);
check('mission starts (phase = playing)', (await get('g.state.phase')) === 'playing');
// freeze AI perception during the movement/weapon checks so results are deterministic
await get('g.enemies.enemies.forEach(e => e.perceiveT = 30)');

// movement
const p0 = await get('({x:g.player.feet.x,z:g.player.feet.z})');
await page.keyboard.down('KeyW'); await step(60); await page.keyboard.up('KeyW');
const p1 = await get('({x:g.player.feet.x,z:g.player.feet.z})');
check('W moves the player forward', p0.z - p1.z > 2 && Math.abs(p1.x - p0.x) < 0.2, `moved ${(p0.z - p1.z).toFixed(2)} m in 1 s`);
await step(30); await get('g.test.view(18.2, 24, 0, 0)');
await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft'); await step(30);
const sprintSpeed = await get('Math.hypot(g.player.controller.velocity.x, g.player.controller.velocity.z)');
await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW'); await step(40);
check('sprint is faster than walk', sprintSpeed > 4.5, `speed ${sprintSpeed.toFixed(2)} m/s`);
check('deceleration brings the player to rest', (await get('Math.hypot(g.player.controller.velocity.x, g.player.controller.velocity.z)')) < 0.05);
const h0 = await get('g.renderer.camera.position.y');
await page.keyboard.press('KeyC'); await step(45);
const h1 = await get('g.renderer.camera.position.y');
check('crouch lowers the camera', h0 - h1 > 0.4, `${h0.toFixed(2)} → ${h1.toFixed(2)} m`);
await page.keyboard.press('KeyC'); await step(45);
// mouse look
const y0 = await get('g.player.controller.yaw'); await get('g.input.injectMouse(200, 0)'); await step(20);
check('mouse look turns the view (camera follows with inertia)', Math.abs((await get('g.player.controller.yaw')) - y0) > 0.3 && Math.abs((await get('g.bodyCam.aimYaw')) - (await get('g.player.controller.yaw'))) < 0.05);
// collision: back into the roller door wall behind the spawn, and sideways into the west wall
await get('g.test.view(5, 23.6, 0, 0)');
await page.keyboard.down('KeyS'); await step(180); await page.keyboard.up('KeyS');
const zc = await get('g.player.feet.z');
check('player collides with walls (south wall)', zc < 25.5 - 0.3 && zc > 24.5, `z = ${zc.toFixed(3)}, wall face at 25.5`);
await page.keyboard.down('KeyA'); await step(240); await page.keyboard.up('KeyA');
const xc = await get('g.player.feet.x');
check('player collides with walls (west wall / props)', xc > 0.5 + 0.3, `x = ${xc.toFixed(3)}, wall face at 0.5`);
check('player stays on the floor (gravity + ground)', Math.abs(await get('g.player.feet.y')) < 0.05 && (await get('g.player.physics.grounded')));

// weapons
await get('g.test.view(5, 23.6, 0, 0)'); await step(10);
check('starts with the assault rifle, full magazine', (await get('g.weapons.current.stats.name')).includes('RIFLE') && (await get('g.weapons.current.mag')) === 30);
await page.mouse.move(400, 300); await page.mouse.down({ button: 'left' }); await step(30); await page.mouse.up({ button: 'left' }); await step(5);
const fired = 30 - (await get('g.weapons.current.mag'));
check('rifle fires automatically while the trigger is held', fired >= 4 && fired <= 7, `${fired} rounds in 0.5 s`);
check('bullets leave impact decals', (await get('g.fx.decals.filter(d => d.visible).length')) >= 1);
check('recoil kicks the aim upward', (await get('g.player.controller.pitch')) > 0.005);
await page.mouse.down({ button: 'right' }); await step(40);
check('right mouse aims down sights', (await get('g.weapons.aim')) > 0.95 && (await get('g.renderer.camera.fov')) < 84);
await page.mouse.up({ button: 'right' }); await step(30);
await page.keyboard.press('KeyR'); await step(20);
check('R starts a reload', await get('g.weapons.current.reloading'));
await step(150);
check('reload refills the magazine from reserve', (await get('g.weapons.current.mag')) === 30 && (await get('g.weapons.current.reserve')) === 120 - fired);
await page.keyboard.press('Digit2'); await step(45);
check('2 switches to the pistol', (await get('g.weapons.current.stats.name')).includes('PISTOL') && (await get('g.weapons.weapons[1].group.visible')) && !(await get('g.weapons.weapons[0].group.visible')));
await page.mouse.down({ button: 'left' }); await step(30); await page.mouse.up({ button: 'left' }); await step(5);
check('pistol is semi-automatic (one shot per press)', (await get('g.weapons.current.mag')) === 14);
await page.keyboard.press('Digit1'); await step(45);
check('1 switches back to the rifle', (await get('g.weapons.current.stats.name')).includes('RIFLE'));

// enemy AI: patrols, stays out of walls (fresh mission so earlier gunfire has not alerted anyone)
await get('g.restart()'); await step(5); await get('g.enemies.enemies.forEach(e => e.perceiveT = 30)');
const e0 = await get('g.enemies.enemies.map(e => ({x:e.pos.x,z:e.pos.z}))');
const seen = new Set(); let inWall = 0;
for (let i = 0; i < 20; i++) { await step(60); const s = await get('g.enemies.enemies.map(e => ({s:e.state,b:g.level.blocked[Math.floor(e.pos.z/0.5)*72+Math.floor(e.pos.x/0.5)]}))'); s.forEach((o) => { seen.add(o.s); inWall += o.b; }); }
const e1 = await get('g.enemies.enemies.map(e => ({x:e.pos.x,z:e.pos.z}))');
const movedCount = e0.filter((a, i) => Math.hypot(a.x - e1[i].x, a.z - e1[i].z) > 1).length;
check('enemies render (6 skinned models in scene)', (await get('g.enemies.enemies.filter(e => e.root.visible && e.root.parent).length')) === 6);
check('enemies patrol the level', movedCount >= 3 && seen.has('patrol') && seen.has('idle'), `${movedCount} moved; states seen: ${[...seen].join(',')}`);
check('enemies never enter walls or props', inWall === 0);

// detection + taking damage: stand in front of an enemy
await get('g.enemies.enemies.forEach(e => e.perceiveT = 0)');
const tgt = await get('(() => { const e = g.enemies.enemies[1]; const f = {x: e.pos.x + Math.sin(e.yaw) * 5, z: e.pos.z + Math.cos(e.yaw) * 5}; const n = g.enemies.nav.nearest(f.x, f.z); g.test.view(n.x, n.z, 0, 0); g.test.aimAt(e.pos.x, 1.2, e.pos.z); return {los: g.col.lineOfSight(e.eye, g.player.chestPos)}; })()');
let states = new Set();
for (let i = 0; i < 40 && (await get('g.player.health')) > 55; i++) { await step(20); (await get('g.enemies.enemies.map(e => e.state)')).forEach((s) => states.add(s)); }
check('enemy detects the player by line of sight', states.has('detect') || states.has('engage'), `LOS ${tgt.los}; states: ${[...states].join(',')}`);
check('player takes damage from enemy fire', (await get('g.player.health')) < 100, `health ${(await get('g.player.health')).toFixed(0)}`);
check('enemy escalates detect → engage and opens fire', states.has('engage'));

// eliminate every hostile with real weapon fire
await get('g.player.health = 100000'); // survive the test; death is tested separately
const hunt = `(() => { const e = g.enemies.enemies.find(e => e.alive); if (!e) return 'none';
  if (!g.col.lineOfSight(g.renderer.camera.position, {x:e.pos.x,y:1.2,z:e.pos.z, clone(){return this}}) || Math.hypot(g.player.feet.x-e.pos.x, g.player.feet.z-e.pos.z) > 9 || Math.hypot(g.player.feet.x-e.pos.x, g.player.feet.z-e.pos.z) < 2) {
    for (let i = 0; i < 40; i++) { const p = g.enemies.nav.randomNear(e.pos.x, e.pos.z, 3, 6, Math.random); if (!p) continue; g.player.physics.teleport(p.x, p.z); g.col.step(1/60); g.bodyCam.reset(0); g.test.step(1);
      if (g.col.lineOfSight(g.renderer.camera.position, new g.renderer.camera.position.constructor(e.pos.x, 1.2, e.pos.z))) break; } }
  g.test.aimAt(e.pos.x, 1.15, e.pos.z); if (g.weapons.current.mag === 0 && !g.weapons.current.reloading) g.input.pressed.add('KeyR'); return e.id + ':' + e.health; })()`;
await page.mouse.down({ button: 'left' });
let guard = 0, reposStates = new Set();
while ((await get('g.enemies.aliveCount')) > 0 && guard++ < 400) { await get(hunt); await step(6); (await get('g.enemies.enemies.map(e => e.state)')).forEach((s) => reposStates.add(s)); if ((await get('g.weapons.current.reserve')) === 0 && (await get('g.weapons.current.mag')) === 0) await page.keyboard.press('Digit2'); }
await page.mouse.up({ button: 'left' });
check('enemies can be eliminated with weapon fire', (await get('g.enemies.aliveCount')) === 0, `iterations ${guard}`);
check('all AI states were exercised', ['idle', 'patrol', 'investigate', 'detect', 'engage', 'dead'].every((s) => reposStates.has(s) || seen.has(s) || states.has(s)), `combat states: ${[...reposStates].join(',')}`);
await step(240);
check('mission completes when all hostiles are down', (await get('g.state.phase')) === 'won');
check('win overlay is shown', (await page.textContent('#ov-title')) === 'FACILITY SECURE');

// restart
await page.click('#overlay'); await step(30);
check('restart resets the mission', (await get('g.state.phase')) === 'playing' && (await get('g.enemies.aliveCount')) === 6 && (await get('g.weapons.current.mag')) === 30 && (await get('g.player.health')) === 100 && Math.abs((await get('g.player.feet.x')) - 5) < 0.1);

// player death
await get('(() => { const e = g.enemies.enemies[0]; const n = g.enemies.nav.nearest(e.pos.x + Math.sin(e.yaw) * 4, e.pos.z + Math.cos(e.yaw) * 4); g.test.view(n.x, n.z, 0, 0); })()');
guard = 0; while ((await get('g.state.phase')) === 'playing' && guard++ < 200) { await get('g.player.alive && g.player.health > 20 && (g.player.health = 20)'); await step(30); }
check('player can die (health reaches 0 → mission failed)', (await get('g.state.phase')) === 'dead' && (await get('g.player.health')) === 0, `iterations ${guard}`);
check('death overlay is shown', (await page.textContent('#ov-title')) === 'SIGNAL LOST');
await page.click('#overlay'); await step(20);
check('restart after death works', (await get('g.state.phase')) === 'playing' && (await get('g.player.alive')) && (await get('g.enemies.aliveCount')) === 6);
const info = await get('g.test.info()');
check('renderer stats are sane', info.calls > 20 && info.calls < 900, JSON.stringify(info));
check('no console errors during gameplay', errors.length === 0, errors.slice(0, 3).join(' | '));
await page.screenshot({ path: 'docs/screenshots/e2e-final-frame.png' });
await browser.close();
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
