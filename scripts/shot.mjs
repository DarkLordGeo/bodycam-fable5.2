// Captures screenshots from the actual running game (headless Chrome, software WebGL).
// Usage: node scripts/shot.mjs '[{"name":"01","eval":"g.test.view(5,23,0)","frames":30}]' [baseUrl]
import { chromium } from 'playwright-core';

const shots = JSON.parse(process.argv[2]);
const base = process.argv[3] || 'http://localhost:5173/';
const W = +(process.env.W || 1280), H = +(process.env.H || 720);
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
await page.goto(base + '?test=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 180000 });
await page.evaluate(() => window.__game.test.start());
for (const s of shots) {
  const out = await page.evaluate(async ({ code, frames }) => { const g = window.__game; const r = code ? await new Function('g', code)(g) : undefined; g.test.step(frames ?? 20); return r; }, { code: s.eval, frames: s.frames });
  await page.waitForTimeout(150);
  if (s.name === "dbg") console.log(JSON.stringify(out)); else if (s.name) { await page.screenshot({ path: `docs/screenshots/${s.name}.png`, timeout: 180000 }); console.log('saved', s.name, out !== undefined ? JSON.stringify(out) : ''); }
}
if (errors.length) console.log('CONSOLE ERRORS:\n' + errors.join('\n'));
await browser.close();
