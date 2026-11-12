// Bakes tileable procedural PBR texture sets (albedo / normal / ORM) into public/assets/textures.
// Used because Poly Haven / ambientCG were not reachable from the build sandbox. Output is original work (CC0).
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
const OUT = 'public/assets/textures';
mkdirSync(OUT, { recursive: true });
const S = 1024;

function rng(seed) { let s = seed >>> 0; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909), (s ^= s >>> 16) >>> 0) / 4294967296); }
function lattice(n, seed) { const r = rng(seed); const a = new Float32Array(n * n); for (let i = 0; i < a.length; i++) a[i] = r(); return a; }
const sm = (t) => t * t * (3 - 2 * t);
// periodic value noise, period = freq cells across the texture
function noise(freq, seed) {
  const L = lattice(freq, seed);
  return (u, v) => {
    const x = u * freq, y = v * freq; const xi = Math.floor(x), yi = Math.floor(y);
    const fx = sm(x - xi), fy = sm(y - yi);
    const x0 = ((xi % freq) + freq) % freq, y0 = ((yi % freq) + freq) % freq, x1 = (x0 + 1) % freq, y1 = (y0 + 1) % freq;
    const a = L[y0 * freq + x0], b = L[y0 * freq + x1], c = L[y1 * freq + x0], d = L[y1 * freq + x1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}
function fbm(base, oct, seed, gain = 0.5) {
  const ns = []; for (let i = 0; i < oct; i++) ns.push(noise(base << i, seed + i * 101));
  let norm = 0, g = 1; for (let i = 0; i < oct; i++) { norm += g; g *= gain; }
  return (u, v) => { let s = 0, a = 1; for (let i = 0; i < oct; i++) { s += ns[i](u, v) * a; a *= gain; } return s / norm; };
}
// periodic worley (cell) noise -> distance to nearest point + edge distance
function worley(freq, seed) {
  const r = rng(seed); const px = new Float32Array(freq * freq), py = new Float32Array(freq * freq);
  for (let i = 0; i < px.length; i++) { px[i] = r(); py[i] = r(); }
  return (u, v) => {
    const x = u * freq, y = v * freq, xi = Math.floor(x), yi = Math.floor(y); let d1 = 9, d2 = 9;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const cx = xi + i, cy = yi + j; const k = (((cy % freq) + freq) % freq) * freq + (((cx % freq) + freq) % freq);
      const dx = cx + px[k] - x, dy = cy + py[k] - y; const d = Math.sqrt(dx * dx + dy * dy);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    return [d1, d2 - d1];
  };
}
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const mix = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const step = (e0, e1, x) => clamp((x - e0) / (e1 - e0));

async function bake(name, fn, { normalStrength = 2, size = S, quality = 86 } = {}) {
  const n = size * size; const H = new Float32Array(n);
  const alb = Buffer.alloc(n * 3), orm = Buffer.alloc(n * 3), nrm = Buffer.alloc(n * 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x; const p = fn(x / size, y / size);
    H[i] = p.h; const c = p.col;
    alb[i * 3] = clamp(c[0]) * 255; alb[i * 3 + 1] = clamp(c[1]) * 255; alb[i * 3 + 2] = clamp(c[2]) * 255;
    orm[i * 3] = clamp(p.ao ?? 1) * 255; orm[i * 3 + 1] = clamp(p.rough) * 255; orm[i * 3 + 2] = clamp(p.metal ?? 0) * 255;
  }
  const at = (x, y) => H[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * normalStrength * size / 256, dy = (at(x, y + 1) - at(x, y - 1)) * normalStrength * size / 256;
    const l = 1 / Math.sqrt(dx * dx + dy * dy + 1); const i = (y * size + x) * 3;
    nrm[i] = (-dx * l * 0.5 + 0.5) * 255; nrm[i + 1] = (dy * l * 0.5 + 0.5) * 255; nrm[i + 2] = (l * 0.5 + 0.5) * 255;
  }
  const raw = { raw: { width: size, height: size, channels: 3 } };
  await sharp(alb, raw).jpeg({ quality }).toFile(`${OUT}/${name}_albedo.jpg`);
  await sharp(nrm, raw).jpeg({ quality: 90 }).toFile(`${OUT}/${name}_normal.jpg`);
  await sharp(orm, raw).jpeg({ quality }).toFile(`${OUT}/${name}_orm.jpg`);
  console.log('baked', name);
}

// ---- concrete wall: board-formed, pitted, stained
{
  const big = fbm(3, 5, 11), fine = fbm(48, 4, 12), mid = fbm(12, 4, 13), pits = worley(60, 14), stain = fbm(4, 5, 15, 0.6), cr = worley(7, 16), crw = fbm(8, 4, 17);
  await bake('concrete_wall', (u, v) => {
    const b = big(u, v), f = fine(u, v), m = mid(u, v);
    const [pd] = pits(u + m * 0.02, v); const pit = 1 - step(0.05, 0.16, pd);
    const [, ce] = cr(u + crw(u, v) * 0.12, v + crw(v, u) * 0.12); const crack = (1 - step(0.0, 0.012, ce)) * step(0.5, 0.62, stain(u + 0.3, v + 0.7));
    const form = Math.abs(((v * 4) % 1) - 0.5) < 0.006 ? 1 : 0; // formwork seams
    const tie = (Math.hypot(((u * 4) % 1) - 0.5, ((v * 4) % 1) - 0.25) < 0.018) ? 1 : 0;
    const drip = Math.pow(clamp(stain(u * 1.0, v * 0.25 + 0.1) * 1.5 - 0.45), 1.5);
    let h = 0.5 + (m - 0.5) * 0.25 + (f - 0.5) * 0.15 - pit * 0.35 - crack * 0.6 - form * 0.3 - tie * 0.5;
    let col = mix3([0.47, 0.46, 0.44], [0.6, 0.59, 0.56], b);
    col = mix3(col, [0.36, 0.34, 0.31], clamp((0.55 - m) * 1.6));
    col = mix3(col, [0.27, 0.25, 0.21], drip * 0.75);
    col = col.map((c) => c * (0.9 + f * 0.2) * (1 - pit * 0.45) * (1 - crack * 0.7) * (1 - form * 0.35) * (1 - tie * 0.6));
    return { h, col, rough: 0.82 + (f - 0.5) * 0.2 - drip * 0.12, ao: 1 - pit * 0.5 - crack * 0.6 - tie * 0.5 };
  }, { normalStrength: 3 });
}
// ---- concrete floor: smoother, oil stains, hairline cracks, dusty
{
  const big = fbm(2, 5, 21), fine = fbm(64, 3, 22), mid = fbm(10, 5, 23, 0.55), oil = fbm(5, 5, 24, 0.55), cr = worley(5, 25), crw = fbm(6, 4, 26), sp = worley(90, 27), scr = fbm(40, 3, 28);
  await bake('concrete_floor', (u, v) => {
    const b = big(u, v), f = fine(u, v), m = mid(u, v);
    const [, ce] = cr(u + crw(u, v) * 0.2, v + crw(v + 0.4, u) * 0.2); const crack = 1 - step(0.0, 0.008, ce);
    const o = Math.pow(clamp(oil(u, v) * 2.2 - 1.0), 1.2);
    const [sd] = sp(u, v); const speck = 1 - step(0.03, 0.09, sd);
    const scuff = clamp(scr(u * 0.2, v * 3) * 2 - 1.15) * 2;
    const h = 0.5 + (m - 0.5) * 0.12 + (f - 0.5) * 0.06 - crack * 0.6 - speck * 0.1;
    let col = mix3([0.33, 0.325, 0.31], [0.47, 0.46, 0.44], b * 0.6 + m * 0.4);
    col = mix3(col, [0.12, 0.11, 0.1], o * 0.8);
    col = mix3(col, [0.55, 0.54, 0.5], clamp(scuff) * 0.25);
    col = col.map((c) => c * (0.92 + f * 0.16) * (1 - crack * 0.75) * (1 - speck * 0.25));
    return { h, col, rough: clamp(0.62 + (m - 0.5) * 0.5 - o * 0.42 + scuff * 0.1, 0.12, 0.95), ao: 1 - crack * 0.6 };
  }, { normalStrength: 1.6 });
}
// ---- painted metal: chipped paint revealing rusty steel (paint colour is tinted per material in-engine)
{
  const big = fbm(3, 5, 31), fine = fbm(80, 3, 32), chip = fbm(9, 6, 33, 0.6), rust = fbm(20, 4, 34), scr = fbm(50, 3, 35);
  await bake('metal_painted', (u, v) => {
    const c = chip(u, v) + (fine(u, v) - 0.5) * 0.08; const bare = step(0.6, 0.64, c); const edge = step(0.55, 0.6, c) * (1 - bare);
    const r = rust(u, v); const scratch = clamp(scr(u * 6, v * 0.25) * 2 - 1.42) * 5;
    const paint = [0.74, 0.74, 0.74].map((x) => x * (0.86 + big(u, v) * 0.22));
    const rustc = mix3([0.3, 0.14, 0.06], [0.48, 0.25, 0.1], r);
    let col = mix3(paint, rustc, bare); col = mix3(col, [0.22, 0.14, 0.1], edge * 0.6); col = mix3(col, [0.6, 0.6, 0.58], clamp(scratch) * (1 - bare) * 0.5);
    return { h: 0.6 - bare * 0.25 + bare * (r - 0.5) * 0.3 + (fine(u, v) - 0.5) * 0.04 - clamp(scratch) * 0.1, col, rough: mix(0.48, 0.9, bare) + (fine(u, v) - 0.5) * 0.1, metal: bare * 0.55, ao: 1 - edge * 0.3 };
  }, { normalStrength: 2 });
}
// ---- raw / rusted steel
{
  const big = fbm(3, 5, 41, 0.6), fine = fbm(90, 3, 42), rust = fbm(8, 6, 43, 0.6), brush = fbm(64, 2, 44), pits = worley(50, 45);
  await bake('metal_rust', (u, v) => {
    const r = step(0.34, 0.72, rust(u, v) + (fine(u, v) - 0.5) * 0.12); const br = brush(u * 0.05, v * 5);
    const [pd] = pits(u, v); const pit = (1 - step(0.04, 0.14, pd)) * r;
    const steel = [0.27, 0.275, 0.285].map((x) => x * (0.8 + br * 0.3) * (0.85 + big(u, v) * 0.3));
    const rc = mix3([0.2, 0.1, 0.055], [0.36, 0.2, 0.1], fine(u, v) * 0.5 + big(u + 0.5, v) * 0.5);
    return { h: 0.5 + r * 0.12 + r * (fine(u, v) - 0.5) * 0.35 - pit * 0.3 + (br - 0.5) * 0.04, col: mix3(steel, rc, r).map((c) => c * (1 - pit * 0.4)), rough: mix(0.38, 0.92, r), metal: mix(1, 0.25, r), ao: 1 - pit * 0.4 };
  }, { normalStrength: 2.2 });
}
// ---- wood planks (crates / pallets)
{
  const grain = fbm(4, 5, 51), fine = fbm(100, 2, 52), tone = lattice(8, 53), knots = worley(5, 54), dirt = fbm(5, 5, 55);
  await bake('wood_planks', (u, v) => {
    const P = 6; const pi = Math.floor(u * P), pu = (u * P) % 1; const gap = Math.min(pu, 1 - pu); const seam = 1 - step(0.0, 0.035, gap);
    const off = tone[pi] * 7.3; const g = grain(pu * 0.6 + off + grain(u, v * 0.3) * 0.2, v * 0.12 + off); const rings = Math.sin((g * 26 + fine(u * 0.2, v * 3) * 1.2) * Math.PI) * 0.5 + 0.5;
    const [kd] = knots(u * 1.0 + off * 0.01, v * 0.5); const knot = (1 - step(0.02, 0.09, kd)) * (tone[(pi + 3) % 8] > 0.5 ? 1 : 0);
    let col = mix3([0.46, 0.33, 0.19], [0.62, 0.48, 0.3], rings * 0.6 + tone[pi] * 0.4); col = mix3(col, [0.2, 0.13, 0.07], knot * 0.8);
    const d = clamp(dirt(u, v) * 1.8 - 0.6); col = mix3(col, [0.28, 0.24, 0.2], d * 0.6).map((c) => c * (1 - seam * 0.8) * (0.9 + fine(u, v) * 0.2));
    return { h: 0.5 + (rings - 0.5) * 0.12 - seam * 0.6 - knot * 0.1 + (fine(u * 0.3, v * 4) - 0.5) * 0.1, col, rough: 0.78 + d * 0.1, ao: 1 - seam * 0.7 };
  }, { normalStrength: 2.5 });
}
// ---- corrugated ceiling / roller-door sheet
{
  const big = fbm(3, 5, 61), fine = fbm(70, 3, 62), rust = fbm(6, 6, 63, 0.6);
  await bake('corrugated', (u, v) => {
    const w = Math.sin(u * Math.PI * 2 * 16) * 0.5 + 0.5; const r = step(0.55, 0.72, rust(u, v) + (1 - w) * 0.08);
    const base = [0.5, 0.52, 0.53].map((x) => x * (0.75 + big(u, v) * 0.35));
    return { h: w * 0.9 + (fine(u, v) - 0.5) * 0.03, col: mix3(base, [0.36, 0.19, 0.09], r * 0.85).map((c) => c * (0.75 + w * 0.3)), rough: mix(0.45, 0.88, r), metal: mix(0.85, 0.3, r), ao: 0.55 + w * 0.45 };
  }, { normalStrength: 1.4 });
}
// ---- plaster (office walls), tint in engine
{
  const big = fbm(3, 5, 71), fine = fbm(90, 3, 72), mid = fbm(14, 4, 73), peel = fbm(6, 6, 74, 0.62);
  await bake('plaster', (u, v) => {
    const p = step(0.73, 0.76, peel(u, v) + (fine(u, v) - 0.5) * 0.06); const pe = step(0.7, 0.73, peel(u, v)) * (1 - p);
    let col = [0.8, 0.79, 0.75].map((x) => x * (0.86 + big(u, v) * 0.2) * (0.95 + fine(u, v) * 0.1)); col = mix3(col, [0.62, 0.61, 0.57], p); col = mix3(col, [0.9, 0.9, 0.87], pe * 0.5);
    return { h: 0.6 + (mid(u, v) - 0.5) * 0.1 + (fine(u, v) - 0.5) * 0.06 - p * 0.1 + pe * 0.04, col, rough: 0.86 + p * 0.08, ao: 1 - p * 0.15 };
  }, { normalStrength: 1.8 });
}
// ---- woven fabric (gloves, sleeves) - small detail set
{
  const fine = fbm(64, 2, 81), big = fbm(4, 4, 82);
  await bake('fabric', (u, v) => {
    const N = 96; const wu = Math.sin(u * N * Math.PI * 2), wv = Math.sin(v * N * Math.PI * 2); const weave = (wu * wv) * 0.5 + 0.5;
    const c = 0.62 * (0.8 + weave * 0.25) * (0.85 + big(u, v) * 0.3) * (0.95 + fine(u, v) * 0.1);
    return { h: weave * 0.7 + fine(u, v) * 0.2, col: [c, c, c], rough: 0.92, ao: 0.75 + weave * 0.25 };
  }, { normalStrength: 1.2, size: 512 });
}
// ---- grime: low-frequency greyscale breakup mask (R = stains, G = large tone variation, B = drips)
{
  const a = fbm(3, 6, 91, 0.6), b = fbm(2, 4, 92), c = fbm(5, 5, 93, 0.6); const size = 512; const buf = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const u = x / size, v = y / size, i = (y * size + x) * 3; buf[i] = clamp(a(u, v) * 1.6 - 0.3) * 255; buf[i + 1] = b(u, v) * 255; buf[i + 2] = clamp(c(u * 3, v * 0.35) * 1.8 - 0.5) * 255; }
  await sharp(buf, { raw: { width: size, height: size, channels: 3 } }).jpeg({ quality: 88 }).toFile(`${OUT}/grime.jpg`); console.log('baked grime');
}
