#!/usr/bin/env node
// End-to-end Blender automation self-test. Touches no project files and no .blend files.
//   1. blender --version
//   2. bpy works: inspect the factory startup scene (read-only)
//   3. build a throwaway scene in memory, export GLB to the OS temp dir
//   4. validate the GLB with glb-report.mjs and check the Blender->three.js axis mapping
// Usage: node tools/blender/selftest.mjs     (BLENDER_EXE overrides the default path)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const blender = process.env.BLENDER_EXE || 'C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe';
const run = (args, env = {}) => execFileSync(blender, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000, env: { ...process.env, ...env } });
const report = (glb, extra = []) => { try { return JSON.parse(execFileSync(process.execPath, [join(here, 'glb-report.mjs'), glb, '--json', ...extra], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })); } catch (e) { return JSON.parse(e.stdout); } };
let failed = 0;
const step = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`); };

if (!existsSync(blender)) { console.log(`FAIL  Blender not found at ${blender} (set BLENDER_EXE)`); process.exit(1); }
const ver = run(['--version']).split('\n')[0].trim();
step('blender --version', /^Blender \d/.test(ver), ver);

const insp = run(['-b', '--factory-startup', '--python', join(here, 'inspect_scene.py'), '--', '--json']);
const js = JSON.parse(insp.split('BODYCAM_JSON_BEGIN')[1].split('BODYCAM_JSON_END')[0]);
step('bpy: inspect factory scene (read-only)', js.objects.length > 0, `Blender ${js.blender_version}, Python ${js.python_version}, objects=${js.objects.map((o) => o.name).join(',')}`);

const dir = mkdtempSync(join(tmpdir(), 'bodycam-blender-selftest-'));
const out = join(dir, 'selftest.glb');
try {
  const exp = run(['-b', '--factory-startup', '--python', join(here, 'selftest_build_scene.py'), '--python', join(here, 'export_glb.py'), '--', '--out', out]);
  step('export GLB via bpy.ops.export_scene.gltf', /BODYCAM_EXPORT \{'FINISHED'\}/.test(exp) && existsSync(out), out);

  const rep = report(out);
  step('glb-report validation', rep.errors.length === 0, `triangles=${rep.triangles} meshes=${rep.meshes} errors=${rep.errors.length} warnings=${rep.warnings.length}`);
  const cube = rep.meshList.find((m) => m.name.startsWith('BC_TestCube') || m.name === 'Cube');
  step('cube triangle count = 12', rep.triangles === 12, `got ${rep.triangles}${cube ? '' : ' (mesh name not found)'}`);
  const m = rep.nodeList.find((n) => n.name === 'BC_AxisMarker');
  const t = m?.translation.map((v) => Math.round(v * 1000) / 1000);
  step('axis mapping Blender (1,2,3) -> three.js (1,3,-2)', !!t && t[0] === 1 && t[1] === 3 && t[2] === -2, `got ${JSON.stringify(t)}`);

  const guard = (() => { try { run(['-b', '--factory-startup', '--python', join(here, 'export_glb.py'), '--', '--out', join(here, '..', '..', 'public', 'assets', 'models', '__guard_test.glb')]); return false; } catch (e) { return /refusing to write into public/.test(String(e.stdout) + String(e.stderr)); } })();
  step('export guard refuses public/ without --allow-public-assets', guard);

  // Phase 1 room rules (same as RoomVisuals.validate), read from src/environment/Rooms.ts + src/assets/RoomManifest.ts
  const outside = report(out, ['--room', 'corridor']);
  step('room check: origin cube is rejected for the corridor', outside.errors.some((e) => e.includes('leaves the corridor footprint')), outside.errors[0] || 'no error');
  const inRoom = join(dir, 'corridor_ok.glb');
  run(['-b', '--factory-startup', '--python', join(here, 'selftest_build_scene.py'), '--python', join(here, 'export_glb.py'), '--', '--out', inRoom], { BC_SCENE: 'corridor' });
  const ok = report(inRoom, ['--room', 'corridor']);
  step('room check: panel inside the corridor passes', ok.errors.length === 0 && ok.triangleBudget === 60000, `bounds=${JSON.stringify(ok.bounds)} budget=${ok.triangleBudget} errors=${ok.errors.join('; ')}`);
  const withHelper = join(dir, 'corridor_helper.glb');
  run(['-b', '--factory-startup', '--python', join(here, 'selftest_build_scene.py'), '--python', join(here, 'export_glb.py'), '--', '--out', withHelper], { BC_SCENE: 'corridor', BC_HELPER: '1' });
  const bad = report(withHelper, ['--room', 'corridor']);
  step('room check: COL_ helper mesh is rejected', bad.errors.some((e) => e.includes('COL_test_001')), bad.errors.join('; ') || 'no error');

  // Collision reference round trip: import into Blender (locked), model in a "Corridor" collection, export only that.
  const refGlb = join(here, '..', '..', 'art', 'reference', 'collision_reference.glb');
  if (!existsSync(refGlb)) step('collision reference present', false, refGlb);
  else {
    const corrOut = join(dir, 'corridor_from_ref_scene.glb');
    const rt = run(['-b', '--factory-startup', '--python-expr', 'import bpy; bpy.ops.wm.read_factory_settings(use_empty=True)',
      '--python', join(here, 'import_reference.py'), '--python', join(here, 'selftest_reference_roundtrip.py'),
      '--python', join(here, 'export_glb.py'), '--', '--out', corrOut, '--collection', 'Corridor']);
    const info = JSON.parse((rt.match(/BODYCAM_REF_JSON (.*)/) || [, '{}'])[1]);
    step('reference imports into Blender, locked', info.imported > 100 && info.locked, `objects=${info.imported} locked=${info.locked}`);
    const near = (a, b) => !!a && a.every((v, k) => Math.abs(v - b[k]) < 0.002);
    step('reference placement: COL_wall_008 at Blender (2,-5.25,2.1), 3x0.5x4.2 m', near(info.wall008_loc, [2, -5.25, 2.1]) && near(info.wall008_dim, [3, 0.5, 4.2]), `loc=${JSON.stringify(info.wall008_loc)} dim=${JSON.stringify(info.wall008_dim)}`);
    const corr = report(corrOut, ['--room', 'corridor']);
    step('collection export excludes the reference and passes --room corridor', corr.errors.length === 0 && corr.meshes === 1, `meshes=${corr.meshes} bounds=${JSON.stringify(corr.bounds)} errors=${corr.errors.join('; ')}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
