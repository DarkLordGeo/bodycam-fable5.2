// Generates art/reference/collision_reference.glb from the game's real Rapier colliders.
// The file is a read-only modelling guide for Blender / Unreal: walls, lintels, floor, ceiling,
// prop colliders, door-opening volumes and room markers, in metres, Y up, level coordinates.
//
// Usage:  npm run build && npm run preview   (in one terminal)
//         npm run export:collision            (in another)   [optional: base URL, output path]
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const base = process.argv[2] || 'http://localhost:4173/';
const out = process.argv[3] || 'art/reference/collision_reference.glb';
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await browser.newPage();
await page.goto(base + '?test=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 180000 });
const result = await page.evaluate(async () => {
  const g = window.__game; const buf = new Uint8Array(await g.environment.exportCollisionReference());
  let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { b64: btoa(bin), fingerprint: g.test.fingerprint() };
});
await browser.close();
const data = Buffer.from(result.b64, 'base64');
if (data.readUInt32LE(0) !== 0x46546c67) throw new Error('export did not produce a binary glTF');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, data);
const json = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString('utf8'));
const names = json.nodes.map((n) => n.name || '');
const count = (p) => names.filter((n) => n.startsWith(p) && /_\d{3}$|^ROOM_/.test(n)).length;
console.log(`wrote ${out} (${(data.length / 1024).toFixed(1)} kB)`);
console.log(`colliders: ${count('COL_')} meshes for ${result.fingerprint.statics} static colliders | door openings: ${count('REF_door_opening')} | rooms: ${count('ROOM_')}`);
console.log(`gameplay fingerprint: ${result.fingerprint.hash}`);
