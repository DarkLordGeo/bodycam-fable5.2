// Level layout data. A 0.5 m cell grid is the single source of truth for walls, door openings,
// collision boxes and the navigation grid, so visuals, physics and AI can never disagree.
export const CELL = 0.5;
export const GW = 72; // 36 m
export const GH = 52; // 26 m
export const WALL_H = 4.2;
export const DOOR_H = 2.35;

export interface Rect { x0: number; z0: number; x1: number; z1: number } // metres, half-open
export interface LampDef { x: number; y: number; z: number; color: number; intensity: number; kind: 'tube' | 'hang' | 'emergency'; flicker?: boolean; shadow?: boolean; range?: number }
export interface EnemySpawn { x: number; z: number; patrol: [number, number][]; yaw: number; trait: 'aggressive' | 'cautious' | 'steady' }

const WALL = 1, DOOR = 2;

export class Level {
  cells = new Uint8Array(GW * GH); // structural: 0 free, 1 wall, 2 door opening (lintel above)
  blocked = new Uint8Array(GW * GH); // walls + props
  nav = new Uint8Array(GW * GH); // 1 = walkable for agents (inflated by one cell)

  readonly playerSpawn = { x: 5, z: 23.6, yaw: 0 };
  readonly skylights: Rect[] = [
    { x0: 12.5, z0: 13, x1: 15, z1: 21 },
    { x0: 17, z0: 13, x1: 19.5, z1: 21 },
    { x0: 21.5, z0: 13, x1: 24, z1: 21 },
  ];
  readonly enemySpawns: EnemySpawn[] = [
    { x: 19, z: 11.2, yaw: 0, trait: 'steady', patrol: [[19, 11.2], [23.8, 22.6], [12.4, 22.6], [12.2, 11]] },
    { x: 24.2, z: 16.2, yaw: Math.PI / 2, trait: 'cautious', patrol: [[24.2, 16.2], [17.8, 18.6]] },
    { x: 30, z: 7, yaw: -Math.PI / 2, trait: 'aggressive', patrol: [[33, 7], [3, 7]] },
    { x: 21.5, z: 3.2, yaw: Math.PI, trait: 'cautious', patrol: [] },
    { x: 29, z: 11, yaw: 0, trait: 'steady', patrol: [[29, 10.6], [29, 15.6], [31.2, 13.2]] },
    { x: 30, z: 21.8, yaw: Math.PI / 2, trait: 'aggressive', patrol: [] },
  ];

  constructor() {
    const f = (x0: number, z0: number, x1: number, z1: number, v: number) => { for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.cells[z * GW + x] = v; };
    // outer shell
    f(0, 0, GW - 1, 0, WALL); f(0, GH - 1, GW - 1, GH - 1, WALL); f(0, 0, 0, GH - 1, WALL); f(GW - 1, 0, GW - 1, GH - 1, WALL);
    // corridor walls
    f(0, 10, GW - 1, 10, WALL); f(0, 17, GW - 1, 17, WALL);
    // office dividers
    f(16, 0, 16, 10, WALL); f(32, 0, 32, 10, WALL); f(52, 0, 52, 10, WALL);
    // west block | hall | east block
    f(20, 17, 20, GH - 1, WALL); f(52, 17, 52, GH - 1, WALL);
    f(0, 33, 20, 33, WALL); f(52, 35, GW - 1, 35, WALL);
    // hall pillars
    for (const [px, pz] of [[30, 26], [42, 26], [30, 40], [42, 40]]) f(px, pz, px + 1, pz + 1, WALL);
    // door openings
    f(7, 10, 9, 10, DOOR); f(23, 10, 25, 10, DOOR); f(41, 10, 43, 10, DOOR); f(60, 10, 62, 10, DOOR);
    f(9, 17, 11, 17, DOOR); f(34, 17, 38, 17, DOOR); f(60, 17, 62, 17, DOOR);
    f(20, 40, 20, 44, DOOR); f(5, 33, 7, 33, DOOR); f(20, 23, 20, 25, DOOR);
    f(52, 24, 52, 26, DOOR); f(52, 41, 52, 43, DOOR); f(61, 35, 63, 35, DOOR);
    f(32, 4, 32, 6, DOOR);
    for (let i = 0; i < this.cells.length; i++) this.blocked[i] = this.cells[i] === WALL ? 1 : 0;
  }

  private merge(v: number): Rect[] {
    const seen = new Uint8Array(GW * GH); const out: Rect[] = [];
    for (let z = 0; z < GH; z++) for (let x = 0; x < GW; x++) {
      if (this.cells[z * GW + x] !== v || seen[z * GW + x]) continue;
      let x1 = x; while (x1 + 1 < GW && this.cells[z * GW + x1 + 1] === v && !seen[z * GW + x1 + 1]) x1++;
      let z1 = z;
      outer: while (z1 + 1 < GH) { for (let i = x; i <= x1; i++) if (this.cells[(z1 + 1) * GW + i] !== v || seen[(z1 + 1) * GW + i]) break outer; z1++; }
      // prefer long thin strips: if this is a single-wide vertical run, it merged downward already
      for (let j = z; j <= z1; j++) for (let i = x; i <= x1; i++) seen[j * GW + i] = 1;
      out.push({ x0: x * CELL, z0: z * CELL, x1: (x1 + 1) * CELL, z1: (z1 + 1) * CELL });
    }
    return out;
  }
  wallRects(): Rect[] { return this.merge(WALL); }
  doorRects(): Rect[] { return this.merge(DOOR); }

  /** Marks a prop footprint (metres) as blocked for navigation. */
  blockWorld(x0: number, z0: number, x1: number, z1: number): void {
    const a = Math.max(0, Math.floor(x0 / CELL)), b = Math.min(GW - 1, Math.ceil(x1 / CELL) - 1), c = Math.max(0, Math.floor(z0 / CELL)), d = Math.min(GH - 1, Math.ceil(z1 / CELL) - 1);
    for (let z = c; z <= d; z++) for (let x = a; x <= b; x++) this.blocked[z * GW + x] = 1;
  }

  /** Builds the agent nav grid: a cell is walkable when neither it nor any 8-neighbour is blocked. */
  finalizeNav(): void {
    for (let z = 0; z < GH; z++) for (let x = 0; x < GW; x++) {
      let ok = 1;
      for (let j = -1; j <= 1 && ok; j++) for (let i = -1; i <= 1; i++) {
        const nx = x + i, nz = z + j;
        if (nx < 0 || nz < 0 || nx >= GW || nz >= GH || this.blocked[nz * GW + nx]) { ok = 0; break; }
      }
      this.nav[z * GW + x] = ok;
    }
  }
  walkable(gx: number, gz: number): boolean { return gx >= 0 && gz >= 0 && gx < GW && gz < GH && this.nav[gz * GW + gx] === 1; }
  walkableWorld(x: number, z: number): boolean { return this.walkable(Math.floor(x / CELL), Math.floor(z / CELL)); }
}
