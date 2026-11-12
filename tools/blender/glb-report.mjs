#!/usr/bin/env node
// Dependency-free GLB inspector / validator for BODYCAM shipping assets.
// Usage: node tools/blender/glb-report.mjs file.glb [--room <roomId>] [--json] [--max-tris N] [--max-texture 1024]
// Exit code 1 when a hard check fails.
//
// Always checked (PROJECT_GUIDE.md, docs/ARCHITECTURE.md, src/assets/AssetLoader.ts):
//   * valid GLB 2.0 container with a JSON chunk
//   * no external URIs (everything is served from public/assets; no runtime third-party URLs)
//   * textures <= 1K
//   * no compression extensions AssetLoader cannot decode (Draco, KTX2/Basis). Meshopt IS supported by loadRoom().
// With --room <id>, the same rules as RoomVisuals.validate() (src/environment/RoomVisuals.ts), read from the real
// src/environment/Rooms.ts and src/assets/RoomManifest.ts:
//   * world-space bounds inside ROOM_RECTS[id] +/- 0.3 m, and Y within -0.5 .. 5.5 m
//   * triangles <= ROOM_MANIFEST[id].maxTriangles (or --max-tris)
//   * no UCX_ / COL_ / REF_ helper meshes
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const valueFlags = new Set(['--room', '--max-tris', '--max-texture']);
const file = argv.find((a, i) => !a.startsWith('--') && !valueFlags.has(argv[i - 1]));
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const room = opt('--room');
let maxTris = opt('--max-tris') !== undefined ? Number(opt('--max-tris')) : Infinity;
const maxTex = Number(opt('--max-texture') ?? 1024);
if (!file) { console.error('usage: glb-report.mjs file.glb [--room <roomId>] [--json] [--max-tris N] [--max-texture 1024]'); process.exit(2); }

let roomRect = null;
if (room) {
  // Node >= 22.18 strips TypeScript types natively; both files only use erasable syntax and type-only imports.
  const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const { ROOM_RECTS } = await import(pathToFileURL(join(repo, 'src/environment/Rooms.ts')).href);
  const { ROOM_MANIFEST } = await import(pathToFileURL(join(repo, 'src/assets/RoomManifest.ts')).href);
  roomRect = ROOM_RECTS[room];
  if (!roomRect) { console.error(`unknown room "${room}". Known: ${Object.keys(ROOM_RECTS).join(', ')}`); process.exit(2); }
  if (opt('--max-tris') === undefined) maxTris = ROOM_MANIFEST[room]?.maxTriangles ?? Infinity;
}

const buf = readFileSync(file);
const errors = [], warnings = [];
if (buf.readUInt32LE(0) !== 0x46546c67) { console.error('not a GLB (bad magic)'); process.exit(1); }
const version = buf.readUInt32LE(4);
if (version !== 2) errors.push(`GLB version ${version} (expected 2)`);
let off = 12, json = null, bin = null;
while (off < buf.length) {
  const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
  const chunk = buf.subarray(off + 8, off + 8 + len);
  if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
  else if (type === 0x004e4942) bin = chunk;
  off += 8 + len;
}
if (!json) { console.error('GLB has no JSON chunk'); process.exit(1); }

const acc = json.accessors || [];
let tris = 0, prims = 0;
const meshes = (json.meshes || []).map((m) => {
  let t = 0;
  for (const p of m.primitives) {
    prims++;
    const mode = p.mode ?? 4;
    const count = p.indices !== undefined ? acc[p.indices].count : acc[p.attributes.POSITION].count;
    if (mode === 4) t += count / 3; else warnings.push(`mesh "${m.name}" uses primitive mode ${mode} (not triangles)`);
    if (!p.attributes.NORMAL) warnings.push(`mesh "${m.name}" has a primitive without normals`);
    if (!p.attributes.TEXCOORD_0) warnings.push(`mesh "${m.name}" has a primitive without UVs`);
  }
  tris += t;
  return { name: m.name, primitives: m.primitives.length, triangles: t };
});

// ---- world-space bounds of every mesh instance (scene graph + accessor min/max) ----
const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
const trs = (n) => {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation || [0, 0, 0, 1], [sx, sy, sz] = n.scale || [1, 1, 1], [tx, ty, tz] = n.translation || [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
};
const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
const helperNames = [];
const visit = (idx, parent) => {
  const n = json.nodes[idx]; const m = mul(parent, trs(n));
  if (n.mesh !== undefined) {
    const mesh = json.meshes[n.mesh];
    for (const name of [n.name, mesh.name]) if (name && /^(UCX_|COL_|REF_)/.test(name)) helperNames.push(name);
    for (const p of mesh.primitives) {
      const a = acc[p.attributes.POSITION]; if (!a?.min || !a?.max) { warnings.push(`mesh "${mesh.name}" POSITION accessor lacks min/max`); continue; }
      for (let c = 0; c < 8; c++) {
        const v = [c & 1 ? a.max[0] : a.min[0], c & 2 ? a.max[1] : a.min[1], c & 4 ? a.max[2] : a.min[2]];
        for (let r = 0; r < 3; r++) { const w = m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r]; bounds.min[r] = Math.min(bounds.min[r], w); bounds.max[r] = Math.max(bounds.max[r], w); }
      }
    }
  }
  for (const ch of n.children || []) visit(ch, m);
};
const sceneRoots = json.scenes?.[json.scene ?? 0]?.nodes ?? [];
for (const r of sceneRoots) visit(r, I);
const hasBounds = Number.isFinite(bounds.min[0]);

function imageSize(img) {
  if (img.uri) return null;
  const bv = json.bufferViews[img.bufferView];
  const b = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
  if (b[0] === 0x89 && b[1] === 0x50) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), fmt: 'png' };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const mk = b[i + 1], len = b.readUInt16BE(i + 2);
      if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5), fmt: 'jpeg' };
      i += 2 + len;
    }
  }
  return { w: 0, h: 0, fmt: img.mimeType || 'unknown' };
}
const images = (json.images || []).map((img, i) => ({ name: img.name || `image${i}`, ...(imageSize(img) || { external: img.uri }) }));

for (const b of json.buffers || []) if (b.uri) errors.push(`external buffer URI "${b.uri.slice(0, 60)}" (assets must be self-contained GLB)`);
for (const im of images) {
  if (im.external) errors.push(`external image URI "${String(im.external).slice(0, 60)}"`);
  else if (Math.max(im.w, im.h) > maxTex) errors.push(`texture "${im.name}" is ${im.w}x${im.h} (> ${maxTex})`);
  else if ((im.w & (im.w - 1)) || (im.h & (im.h - 1))) warnings.push(`texture "${im.name}" is ${im.w}x${im.h} (not power of two)`);
}
const unsupported = ['KHR_draco_mesh_compression', 'KHR_texture_basisu'];
for (const e of json.extensionsUsed || []) if (unsupported.includes(e)) errors.push(`uses ${e}, but src/assets/AssetLoader.ts configures no decoder for it`);
if (tris > maxTris) errors.push(`${tris} triangles exceeds the budget of ${maxTris}`);
if ((json.cameras || []).length) warnings.push('contains cameras (ignored by the game)');
if (json.extensionsUsed?.includes('KHR_lights_punctual')) warnings.push('contains punctual lights (game lighting is owned by src/rendering/Lighting.ts)');

if (roomRect) {
  const tol = 0.3, q = roomRect;
  if (!hasBounds) errors.push('no mesh geometry in the default scene');
  else {
    const [x0, y0, z0] = bounds.min, [x1, y1, z1] = bounds.max;
    if (x0 < q.x0 - tol || x1 > q.x1 + tol || z0 < q.z0 - tol || z1 > q.z1 + tol) errors.push(`geometry leaves the ${room} footprint (x ${x0.toFixed(2)}..${x1.toFixed(2)}, z ${z0.toFixed(2)}..${z1.toFixed(2)}; allowed x ${q.x0 - tol}..${q.x1 + tol}, z ${q.z0 - tol}..${q.z1 + tol})`);
    if (y0 < -0.5 || y1 > 5.5) errors.push(`geometry outside the vertical range (y ${y0.toFixed(2)}..${y1.toFixed(2)}; allowed -0.5..5.5)`);
  }
  for (const n of new Set(helperNames)) errors.push(`helper mesh "${n}" must not be exported with the room`);
}

const nodes = (json.nodes || []).map((n) => ({ name: n.name, translation: n.translation || [0, 0, 0], mesh: n.mesh }));
const round = (v) => v.map((x) => Math.round(x * 1000) / 1000);
const report = {
  file, room: room ?? null, generator: json.asset?.generator, gltfVersion: json.asset?.version, bytes: buf.length,
  nodes: nodes.length, meshes: meshes.length, primitives: prims, triangles: tris, triangleBudget: Number.isFinite(maxTris) ? maxTris : null,
  bounds: hasBounds ? { min: round(bounds.min), max: round(bounds.max) } : null,
  materials: (json.materials || []).map((m) => m.name), images, extensionsUsed: json.extensionsUsed || [],
  meshList: meshes, nodeList: nodes, errors, warnings,
};
if (argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`${file}${room ? `  [room: ${room}]` : ''}\n  generator=${report.generator} glTF ${report.gltfVersion}  ${report.bytes} bytes`);
  console.log(`  nodes=${report.nodes} meshes=${report.meshes} primitives=${prims} triangles=${tris}${report.triangleBudget ? `/${report.triangleBudget}` : ''} materials=${report.materials.length} images=${images.length}`);
  if (report.bounds) console.log(`  bounds min=${JSON.stringify(report.bounds.min)} max=${JSON.stringify(report.bounds.max)}`);
  for (const w of warnings) console.log(`  WARN  ${w}`);
  for (const e of errors) console.log(`  ERROR ${e}`);
  console.log(errors.length ? '  RESULT: FAIL' : '  RESULT: PASS');
}
process.exit(errors.length ? 1 : 0);
