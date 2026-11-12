import { CELL, GW, GH, type Level } from '../environment/Level';

export interface P2 { x: number; z: number }

/** Grid A* over the level's inflated nav grid, with string-pulling and helper queries. */
export class Navigation {
  private g = new Float32Array(GW * GH); private parent = new Int32Array(GW * GH); private stamp = new Uint32Array(GW * GH); private closed = new Uint32Array(GW * GH); private run = 0;
  private heap: number[] = []; private f = new Float32Array(GW * GH);
  constructor(private level: Level) {}

  private push(i: number): void { const h = this.heap; h.push(i); let c = h.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (this.f[h[p]] <= this.f[h[c]]) break; [h[p], h[c]] = [h[c], h[p]]; c = p; } }
  private pop(): number { const h = this.heap; const top = h[0]; const last = h.pop()!; if (h.length) { h[0] = last; let p = 0; for (;;) { const l = p * 2 + 1, r = l + 1; let m = p; if (l < h.length && this.f[h[l]] < this.f[h[m]]) m = l; if (r < h.length && this.f[h[r]] < this.f[h[m]]) m = r; if (m === p) break; [h[p], h[m]] = [h[m], h[p]]; p = m; } } return top; }

  /** Nearest walkable cell centre to a world point (ring search). */
  nearest(x: number, z: number): P2 {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let r = 0; r < 14; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      if (this.level.walkable(cx + dx, cz + dz)) return r === 0 ? { x, z } : { x: (cx + dx + 0.5) * CELL, z: (cz + dz + 0.5) * CELL };
    }
    return { x, z };
  }

  /** True when a straight walk between two points stays on walkable cells. */
  lineWalkable(x0: number, z0: number, x1: number, z1: number): boolean {
    const d = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(d / 0.2));
    for (let i = 0; i <= n; i++) { const t = i / n; if (!this.level.walkableWorld(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)) return false; }
    return true;
  }

  /** 2D line of sight on the *structural* grid (walls + props) – cheap cover test for AI positioning. */
  gridSight(x0: number, z0: number, x1: number, z1: number): boolean {
    const d = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(d / 0.25)); const b = this.level.blocked;
    for (let i = 1; i < n; i++) { const t = i / n; const gx = Math.floor((x0 + (x1 - x0) * t) / CELL), gz = Math.floor((z0 + (z1 - z0) * t) / CELL); if (b[gz * GW + gx]) return false; }
    return true;
  }

  findPath(sx: number, sz: number, tx: number, tz: number): P2[] | null {
    const s = this.nearest(sx, sz), t = this.nearest(tx, tz);
    const si = Math.floor(s.z / CELL) * GW + Math.floor(s.x / CELL), ti = Math.floor(t.z / CELL) * GW + Math.floor(t.x / CELL);
    if (si === ti) return [{ x: t.x, z: t.z }];
    const run = ++this.run; this.heap.length = 0; const txc = ti % GW, tzc = Math.floor(ti / GW);
    const h = (i: number) => { const dx = Math.abs((i % GW) - txc), dz = Math.abs(Math.floor(i / GW) - tzc); return Math.max(dx, dz) + 0.4142 * Math.min(dx, dz); };
    this.g[si] = 0; this.f[si] = h(si); this.parent[si] = -1; this.stamp[si] = run; this.push(si);
    let found = false, guard = 0;
    while (this.heap.length && guard++ < 6000) {
      const cur = this.pop(); if (cur === ti) { found = true; break; }
      if (this.closed[cur] === run) continue; this.closed[cur] = run;
      const cx = cur % GW, cz = Math.floor(cur / GW);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue; const nx = cx + dx, nz = cz + dz;
        if (!this.level.walkable(nx, nz)) continue;
        if (dx && dz && (!this.level.walkable(cx + dx, cz) || !this.level.walkable(cx, cz + dz))) continue; // no corner cutting
        const ni = nz * GW + nx; if (this.closed[ni] === run) continue;
        const ng = this.g[cur] + (dx && dz ? 1.4142 : 1);
        if (this.stamp[ni] !== run || ng < this.g[ni]) { this.stamp[ni] = run; this.g[ni] = ng; this.f[ni] = ng + h(ni); this.parent[ni] = cur; this.push(ni); }
      }
    }
    if (!found) return null;
    const raw: P2[] = []; for (let i = ti; i !== -1; i = this.parent[i]) raw.push({ x: ((i % GW) + 0.5) * CELL, z: (Math.floor(i / GW) + 0.5) * CELL });
    raw.reverse(); raw[raw.length - 1] = { x: t.x, z: t.z };
    // string pulling
    const out: P2[] = []; let a = 0; const start = { x: sx, z: sz };
    let from: P2 = this.level.walkableWorld(sx, sz) ? start : raw[0];
    while (a < raw.length - 1) { let b = raw.length - 1; while (b > a + 1 && !this.lineWalkable(from.x, from.z, raw[b].x, raw[b].z)) b--; out.push(raw[b]); from = raw[b]; a = b; }
    if (!out.length) out.push(raw[raw.length - 1]);
    return out;
  }

  /** Random walkable point in an annulus around (x, z). */
  randomNear(x: number, z: number, rMin: number, rMax: number, rand: () => number): P2 | null {
    for (let i = 0; i < 12; i++) { const a = rand() * Math.PI * 2, r = rMin + rand() * (rMax - rMin); const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; if (this.level.walkableWorld(px, pz)) return { x: px, z: pz }; }
    return null;
  }
}
