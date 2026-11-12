import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Level, WALL_H, DOOR_H, type LampDef } from './Level';
import type { CollisionWorld } from './CollisionWorld';
import { DENSITY, canvasTexture, type Mats } from '../rendering/Materials';
import { ROOM_IDS, ROOM_RECTS, roomsTouching, type RoomId } from './Rooms';

const NO_SHADOW = new Set(['lampOn', 'lampFlicker', 'lampWarm', 'lampOff', 'lampRed', 'window', 'sky', 'screen', 'ledRed', 'ledGreen', 'ledAmber', 'paper']);

/**
 * A set of procedural visuals that is shown or hidden as one unit.
 * - a room's own visuals: rooms = [that room], rule 'all'
 * - a wall / lintel shared by several rooms: hidden only when ALL of them use imported visuals
 * - a door frame: hidden as soon as ANY adjoining room uses imported visuals (the GLB room supplies its own)
 */
export interface VisualSet { group: THREE.Group; rooms: RoomId[]; rule: 'all' | 'any' }

function rng(seed: number): () => number { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

/** Rewrites UVs from world position (box projection per triangle) so texel density is uniform everywhere. */
function worldUV(g: THREE.BufferGeometry, scale: number): void {
  const p = g.getAttribute('position'), uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    n.subVectors(b, a).cross(c.clone().sub(a)); const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    for (let k = 0; k < 3; k++) {
      const v = k === 0 ? a : k === 1 ? b : c;
      if (ay >= ax && ay >= az) uv.setXY(i + k, v.x * scale, v.z * scale); else if (ax >= az) uv.setXY(i + k, v.z * scale, v.y * scale); else uv.setXY(i + k, v.x * scale, v.y * scale);
    }
  }
}

/**
 * Builds the facility: structure from the Level grid, then hand-placed procedural props.
 *
 * Two independent outputs:
 *  - GAMEPLAY: Rapier colliders (`col.addBox/addCylinder`, `solid()`) and nav blocking (`level.blockWorld`).
 *    Always created, exactly once, regardless of how any room is rendered.
 *  - VISUALS: meshes, grouped into VisualSets (per room, plus shared walls / door frames) so that a
 *    room's procedural look can be hidden and replaced by an imported GLB without touching gameplay.
 * Visual geometry is merged per material within each set; repeated props use InstancedMesh.
 */
export class EnvironmentBuilder {
  group = new THREE.Group();
  lamps: LampDef[] = [];
  private batch = new Map<string, THREE.BufferGeometry[]>();
  private M = new THREE.Matrix4();
  private ry = 0;
  /** Visual sets keyed by owner id (a RoomId, or a shared-structure key). */
  readonly sets = new Map<string, VisualSet>();
  private owner = 'hall';
  private crates: { m: THREE.Matrix4; o: string }[] = [];
  private barrels: { m: THREE.Matrix4; c: number; o: string }[] = [];
  private rubble: { m: THREE.Matrix4; o: string }[] = [];
  private rand = rng(7);

  constructor(private level: Level, private col: CollisionWorld, private mats: Mats) {}

  // ---------- visual ownership ----------
  private setFor(owner: string): VisualSet {
    let v = this.sets.get(owner);
    if (!v) { v = { group: new THREE.Group(), rooms: [owner as RoomId], rule: 'all' }; v.group.name = 'visual:' + owner; this.sets.set(owner, v); this.group.add(v.group); }
    return v;
  }
  /** Routes following visuals to a room. Gameplay calls are unaffected by the current owner. */
  private inRoom(room: RoomId): void { this.owner = room; this.col.tag = 'prop:' + room; this.setFor(room); }
  /** Routes following visuals to a structure set shared by the rooms touching the given rect. */
  private shared(rooms: RoomId[], rule: 'all' | 'any'): void {
    const key = `${rule === 'all' ? 'walls' : 'frames'}:${rooms.join('+')}`;
    if (!this.sets.has(key)) { const v = this.setFor(key); v.rooms = rooms; v.rule = rule; }
    this.owner = key;
  }

  // ---------- batching primitives ----------
  private part(mat: string, geo: THREE.BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): void {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)).premultiply(this.M);
    const g = geo.index ? geo.toNonIndexed() : geo;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    g.applyMatrix4(m);
    worldUV(g, DENSITY[mat] ?? 0.6);
    const key = `${this.owner}|${mat}`;
    let arr = this.batch.get(key); if (!arr) this.batch.set(key, (arr = []));
    arr.push(g);
  }
  private box(mat: string, w: number, h: number, d: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): void { this.part(mat, new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz); }
  private cyl(mat: string, r: number, h: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, seg = 14, rTop = r): void { this.part(mat, new THREE.CylinderGeometry(rTop, r, h, seg), x, y, z, rx, ry, rz); }
  /** Runs fn with a local transform (origin on the floor). */
  private prop(x: number, z: number, ry: number, fn: () => void, y = 0): void {
    this.M.makeRotationY(ry).setPosition(x, y, z); this.ry = ry; fn(); this.M.identity(); this.ry = 0;
  }
  /** Collider + nav block for the current prop, footprint w×d centred at local (lx, lz). */
  private solid(w: number, h: number, d: number, lx = 0, lz = 0, y0 = 0): void {
    const c = new THREE.Vector3(lx, y0 + h / 2, lz).applyMatrix4(this.M);
    this.col.addBox(c.x, c.y, c.z, w / 2, h / 2, d / 2, this.ry);
    if (y0 < 1.7) {
      const cs = Math.abs(Math.cos(this.ry)), sn = Math.abs(Math.sin(this.ry)); const ex = (w * cs + d * sn) / 2, ez = (w * sn + d * cs) / 2;
      this.level.blockWorld(c.x - ex, c.z - ez, c.x + ex, c.z + ez);
    }
  }

  build(): THREE.Group {
    for (const id of ROOM_IDS) this.setFor(id);
    this.structure();
    this.inRoom('loadingBay'); this.propsLoadingBay();
    this.inRoom('breakRoom'); this.propsBreakRoom();
    this.inRoom('hall'); this.propsHall();
    this.inRoom('corridor'); this.propsCorridor();
    this.propsOffices(); // switches between the four offices itself
    this.inRoom('generator'); this.propsGenerator();
    this.inRoom('workshop'); this.propsWorkshop();
    this.col.tag = 'structure';
    this.flush();
    this.level.finalizeNav();
    return this.group;
  }

  // ---------- structure ----------
  private structure(): void {
    const L = this.level;
    // --- walls: one collider per merged wall rect; visual shared by the rooms on either side
    for (const r of L.wallRects()) {
      const w = r.x1 - r.x0, d = r.z1 - r.z0;
      this.shared(roomsTouching(r), 'all'); this.col.tag = 'wall';
      this.box('wall', w, WALL_H, d, r.x0 + w / 2, WALL_H / 2, r.z0 + d / 2);
      this.col.addBox(r.x0 + w / 2, WALL_H / 2, r.z0 + d / 2, w / 2, WALL_H / 2, d / 2);
    }
    // --- door openings: lintel collider above; frame is visual only
    for (const r of L.doorRects()) {
      const w = r.x1 - r.x0, d = r.z1 - r.z0, cx = r.x0 + w / 2, cz = r.z0 + d / 2, lh = WALL_H - DOOR_H;
      const rooms = roomsTouching(r);
      this.shared(rooms, 'all'); this.col.tag = 'lintel';
      this.box('wall', w, lh, d, cx, DOOR_H + lh / 2, cz);
      this.col.addBox(cx, DOOR_H + lh / 2, cz, w / 2, lh / 2, d / 2);
      const alongX = w > d; const len = alongX ? w : d, th = (alongX ? d : w) + 0.08;
      this.shared(rooms, 'any');
      this.prop(cx, cz, alongX ? 0 : Math.PI / 2, () => {
        this.box('mDark', 0.09, DOOR_H, th, -len / 2 + 0.045, DOOR_H / 2, 0); this.box('mDark', 0.09, DOOR_H, th, len / 2 - 0.045, DOOR_H / 2, 0);
        this.box('mDark', len, 0.09, th, 0, DOOR_H - 0.045, 0);
        this.box('steel', len - 0.18, 0.012, th * 0.9, 0, 0.006, 0); // threshold plate
      });
    }
    // --- floor + ceiling: ONE collider each for the whole level (unchanged); visuals split per room
    this.col.tag = 'floor'; this.col.addBox(18, -0.15, 13, 18, 0.15, 13);
    this.col.tag = 'ceiling'; this.col.addBox(18, WALL_H + 0.15, 13, 18, 0.15, 13);
    const slab = (mat: string, x0: number, z0: number, x1: number, z1: number) => this.box(mat, x1 - x0, 0.25, z1 - z0, (x0 + x1) / 2, WALL_H + 0.125, (z0 + z1) / 2);
    for (const id of ROOM_IDS) {
      const q = ROOM_RECTS[id]; this.owner = id;
      this.box('floor', q.x1 - q.x0, 0.3, q.z1 - q.z0, (q.x0 + q.x1) / 2, -0.15, (q.z0 + q.z1) / 2);
      if (id === 'hall') continue; // hall ceiling has skylight openings, built below
      slab(q.z1 <= 8.75 ? 'plaster' : 'ceiling', q.x0, q.z0, q.x1, q.z1);
    }
    this.owner = 'hall';
    const H = ROOM_RECTS.hall;
    slab('ceiling', H.x0, H.z0, H.x1, 13); slab('ceiling', H.x0, 21, H.x1, H.z1);
    let px = H.x0;
    for (const s of L.skylights) { slab('ceiling', px, 13, s.x0, 21); px = s.x1; }
    slab('ceiling', px, 13, H.x1, 21);
    for (const s of L.skylights) {
      const w = s.x1 - s.x0, d = s.z1 - s.z0, cx = (s.x0 + s.x1) / 2, cz = (s.z0 + s.z1) / 2;
      this.box('sky', w + 0.4, 0.04, d + 0.4, cx, WALL_H + 0.75, cz);
      for (const sx of [s.x0 - 0.05, s.x1 + 0.05]) this.box('steel', 0.1, 0.55, d, sx, WALL_H + 0.5, cz);
      for (const sz of [s.z0 - 0.05, s.z1 + 0.05]) this.box('steel', w + 0.2, 0.55, 0.1, cx, WALL_H + 0.5, sz);
      for (let i = 1; i < 4; i++) this.box('steel', w, 0.06, 0.05, cx, WALL_H + 0.22, s.z0 + (d * i) / 4);
      this.box('steel', 0.05, 0.06, d, cx, WALL_H + 0.22, cz);
    }
    // hall roof steel: I-beams across the span + purlins between skylights
    const ibeam = (len: number, x: number, y: number, z: number, ry: number) => this.prop(x, z, ry, () => {
      this.box('steel', len, 0.03, 0.22, 0, y + 0.2, 0); this.box('steel', len, 0.03, 0.22, 0, y - 0.2, 0); this.box('steel', len, 0.4, 0.025, 0, y, 0);
    });
    for (const z of [10.6, 12.6, 21.4, 23.6]) ibeam(15.5, 18.25, WALL_H - 0.23, z, 0);
    for (const x of [16, 20.5]) ibeam(8.8, x, WALL_H - 0.23, 17, Math.PI / 2);
    // pillar hazard bands + base plates
    const hazard = canvasTexture(128, 64, (c) => { c.fillStyle = '#c9a21a'; c.fillRect(0, 0, 128, 64); c.fillStyle = '#16140f'; for (let i = -2; i < 8; i++) { c.beginPath(); c.moveTo(i * 32, 64); c.lineTo(i * 32 + 16, 64); c.lineTo(i * 32 + 48, 0); c.lineTo(i * 32 + 32, 0); c.fill(); } c.globalAlpha = 0.35; for (let i = 0; i < 400; i++) { c.fillStyle = Math.random() > 0.5 ? '#3a3528' : '#877a55'; c.fillRect(Math.random() * 128, Math.random() * 64, 3, 2); } });
    hazard.wrapS = THREE.RepeatWrapping; hazard.repeat.set(2, 1);
    const hzMat = new THREE.MeshStandardMaterial({ map: hazard, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const [x, z] of [[15.5, 13.5], [21.5, 13.5], [15.5, 20.5], [21.5, 20.5]]) {
      for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.5), hzMat); const a = (i * Math.PI) / 2; m.position.set(x + Math.sin(a) * 0.503, 0.85, z + Math.cos(a) * 0.503); m.rotation.y = a; this.setFor(this.owner).group.add(m); }
    }
    // hall windows (south outer wall): frosted panes with steel frames
    for (const x of [13.5, 18.25, 23]) this.prop(x, 25.49, 0, () => {
      this.box('window', 2.4, 1.1, 0.03, 0, 3.15, 0);
      this.box('mDark', 2.56, 0.08, 0.12, 0, 3.74, -0.03); this.box('mDark', 2.56, 0.08, 0.14, 0, 2.56, -0.04);
      for (const sx of [-1.24, -0.4, 0.4, 1.24]) this.box('mDark', 0.06, 1.18, 0.1, sx, 3.15, -0.03);
      this.box('mDark', 2.5, 0.04, 0.08, 0, 3.15, -0.03);
    });
  }

  // ---------- reusable props ----------
  private crate(x: number, z: number, s: number, ry: number, y = 0): void {
    this.crates.push({ o: this.owner, m: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(s, s, s)) });
    this.prop(x, z, ry, () => this.solid(s, s, s, 0, 0, y));
  }
  private barrel(x: number, z: number, color: number, tipped = false): void {
    const q = new THREE.Quaternion(); const p = new THREE.Vector3(x, 0, z);
    if (tipped) { q.setFromEuler(new THREE.Euler(Math.PI / 2, this.rand() * 6, 0, 'YXZ')); p.y = 0.29; }
    else q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.rand() * 6);
    this.barrels.push({ o: this.owner, m: new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)), c: color });
    if (tipped) { this.col.addBox(x, 0.29, z, 0.45, 0.29, 0.45); this.level.blockWorld(x - 0.45, z - 0.45, x + 0.45, z + 0.45); }
    else { this.col.addCylinder(x, 0.45, z, 0.45, 0.29); this.level.blockWorld(x - 0.29, z - 0.29, x + 0.29, z + 0.29); }
  }
  private pallet(x: number, z: number, ry: number, y = 0): void {
    this.prop(x, z, ry, () => {
      for (const sz of [-0.42, 0, 0.42]) this.box('wood', 1.2, 0.09, 0.1, 0, 0.045, sz);
      for (let i = 0; i < 6; i++) this.box('wood', 0.14, 0.022, 1.0, -0.53 + i * 0.212, 0.102, 0);
    }, y);
  }
  private rack(x: number, z: number, ry: number, len = 4): void {
    this.prop(x, z, ry, () => {
      for (const sx of [-len / 2, 0, len / 2]) for (const sz of [-0.42, 0.42]) { this.box('mBlue', 0.07, 3, 0.07, sx, 1.5, sz); }
      for (const sx of [-len / 2, 0, len / 2]) { this.box('mBlue', 0.03, 0.03, 0.95, sx, 0.5, 0, 0.5); this.box('mBlue', 0.03, 0.03, 0.95, sx, 1.7, 0, -0.5); }
      for (const y of [0.95, 1.9, 2.8]) {
        for (const sz of [-0.42, 0.42]) this.box('mYellow', len, 0.1, 0.05, 0, y, sz);
        this.box('wood', len - 0.1, 0.03, 0.86, 0, y + 0.06, 0);
        let cx = -len / 2 + 0.2;
        while (cx < len / 2 - 0.5) {
          const w = 0.35 + this.rand() * 0.45, h = 0.25 + this.rand() * 0.4, d = 0.4 + this.rand() * 0.35;
          if (this.rand() > 0.25) this.box(this.rand() > 0.3 ? 'card' : 'mGrey', w, h, d, cx + w / 2, y + 0.075 + h / 2, (this.rand() - 0.5) * 0.2, 0, (this.rand() - 0.5) * 0.3);
          cx += w + 0.08 + this.rand() * 0.3;
        }
      }
      this.solid(len, 3, 0.95);
    });
  }
  private lockers(x: number, z: number, ry: number, n: number, mat = 'mGrey'): void {
    this.prop(x, z, ry, () => {
      const w = 0.4, tot = n * w;
      this.box(mat, tot, 1.85, 0.48, 0, 0.975, 0); this.box('mDark', tot + 0.02, 0.05, 0.5, 0, 0.025, 0);
      for (let i = 0; i < n; i++) {
        const cx = -tot / 2 + w * (i + 0.5); const open = this.rand() > 0.82;
        this.box('dark', 0.012, 1.8, 0.01, cx - w / 2 + 0.006, 0.975, 0.241);
        if (open) { this.box('dark', w - 0.04, 1.76, 0.01, cx, 0.975, 0.238); this.box(mat, 0.02, 1.76, w - 0.03, cx + w / 2 - 0.01, 0.975, 0.24 + w / 2); }
        else { for (let k = 0; k < 4; k++) this.box('dark', w * 0.5, 0.012, 0.01, cx, 1.62 - k * 0.04, 0.243); this.box('chrome', 0.02, 0.09, 0.02, cx + w / 2 - 0.06, 1.0, 0.25); }
      }
      this.solid(tot, 1.9, 0.5);
    });
  }
  private chair(x: number, z: number, ry: number): void {
    this.prop(x, z, ry, () => {
      this.box('rubber', 0.46, 0.07, 0.44, 0, 0.47, 0); this.box('rubber', 0.44, 0.5, 0.06, 0, 0.82, -0.21, -0.12);
      this.cyl('chrome', 0.025, 0.4, 0, 0.25, 0, 0, 0, 0, 8); this.box('plastic', 0.05, 0.3, 0.03, 0, 0.6, -0.2);
      for (let i = 0; i < 5; i++) { const a = (i * Math.PI * 2) / 5; this.box('plastic', 0.3, 0.03, 0.045, Math.cos(a) * 0.15, 0.06, Math.sin(a) * 0.15, 0, -a, 0); }
    });
    this.col.addCylinder(x, 0.3, z, 0.3, 0.24); this.level.blockWorld(x - 0.2, z - 0.2, x + 0.2, z + 0.2);
  }
  private desk(x: number, z: number, ry: number, withPc = true): void {
    this.prop(x, z, ry, () => {
      this.box('wood', 1.6, 0.04, 0.78, 0, 0.75, 0);
      this.box('mGrey', 0.42, 0.62, 0.7, 0.55, 0.42, 0); for (let i = 0; i < 3; i++) { this.box('dark', 0.38, 0.008, 0.01, 0.55, 0.28 + i * 0.2, 0.352); this.box('chrome', 0.1, 0.015, 0.02, 0.55, 0.4 + i * 0.2, 0.36); }
      for (const sx of [-0.76, 0.3]) for (const sz of [-0.35, 0.35]) this.box('mDark', 0.04, 0.73, 0.04, sx, 0.365, sz);
      this.box('mDark', 1.5, 0.3, 0.02, 0, 0.55, -0.37);
      if (withPc) {
        this.box('plastic', 0.44, 0.36, 0.4, -0.3, 0.98, -0.12, 0, 0.2); this.box('plastic', 0.2, 0.05, 0.24, -0.3, 0.795, -0.12);
        const on = this.rand() > 0.5; const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.2); const o = new THREE.Vector3(0, 0, 0.202).applyQuaternion(q);
        this.box(on ? 'screen' : 'dark', 0.36, 0.28, 0.01, -0.3 + o.x, 0.99, -0.12 + o.z, 0, 0.2);
        this.box('plastic', 0.42, 0.025, 0.15, -0.25, 0.785, 0.22, 0, 0.1);
      }
      for (let i = 0; i < 4; i++) this.box('paper', 0.21, 0.004, 0.3, 0.1 + this.rand() * 0.5, 0.775 + i * 0.003, (this.rand() - 0.5) * 0.4, 0, this.rand() * 3);
      this.solid(1.6, 0.78, 0.78);
    });
  }
  private barrier(x: number, z: number, ry: number): void {
    const sh = new THREE.Shape(); sh.moveTo(-0.3, 0); sh.lineTo(0.3, 0); sh.lineTo(0.3, 0.08); sh.lineTo(0.13, 0.32); sh.lineTo(0.09, 0.85); sh.lineTo(-0.09, 0.85); sh.lineTo(-0.13, 0.32); sh.lineTo(-0.3, 0.08); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 2.2, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 1 }); g.translate(0, 0, -1.1); g.rotateY(Math.PI / 2);
    this.prop(x, z, ry, () => { this.part('wall', g); this.solid(2.2, 0.85, 0.5); });
  }
  private tubeLight(x: number, z: number, ry: number, o: Partial<LampDef> & { off?: boolean } = {}): void {
    const mat = o.off ? 'lampOff' : o.flicker ? 'lampFlicker' : 'lampOn';
    this.prop(x, z, ry, () => {
      this.box('mBeige', 1.3, 0.05, 0.2, 0, WALL_H - 0.33, 0);
      for (const sx of [-0.5, 0.5]) this.cyl('chrome', 0.006, 0.3, sx, WALL_H - 0.15, 0, 0, 0, 0, 5);
      for (const sz of [-0.05, 0.05]) this.cyl(mat, 0.016, 1.2, 0, WALL_H - 0.375, sz, 0, 0, Math.PI / 2, 8);
    });
    if (!o.off) this.lamps.push({ x, y: WALL_H - 0.42, z, color: 0xfff0dc, intensity: 34, kind: 'tube', ...o });
  }
  private hangLamp(x: number, z: number, o: Partial<LampDef> = {}): void {
    const y = 3.25;
    const pts = [new THREE.Vector2(0.03, 0.2), new THREE.Vector2(0.06, 0.17), new THREE.Vector2(0.1, 0.1), new THREE.Vector2(0.3, 0), new THREE.Vector2(0.31, -0.015)];
    this.prop(x, z, 0, () => {
      this.cyl('rubber', 0.008, WALL_H - y - 0.2, 0, (WALL_H + y + 0.2) / 2, 0, 0, 0, 0, 5);
      this.part('mGreen', new THREE.LatheGeometry(pts, 18), 0, y, 0);
      const inner = new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p.x * 0.97, p.y - 0.004)).reverse(), 18); this.part('mBeige', inner, 0, y, 0);
      this.part('lampWarm', new THREE.SphereGeometry(0.055, 10, 8), 0, y + 0.03, 0);
    });
    this.lamps.push({ x, y: y - 0.02, z, color: 0xffcf96, intensity: 60, kind: 'hang', ...o });
  }
  private pipeRun(x0: number, x1: number, y: number, z: number, r: number, mat = 'steel'): void {
    const len = x1 - x0;
    this.cyl(mat, r, len, (x0 + x1) / 2, y, z, 0, 0, Math.PI / 2, 10);
    for (let x = x0 + 1.5; x < x1; x += 3) { this.cyl(mat, r * 1.45, 0.06, x, y, z, 0, 0, Math.PI / 2, 10); this.box('mDark', 0.04, WALL_H - y, 0.02, x + 0.5, (WALL_H + y) / 2, z); this.box('mDark', 0.05, 0.02, r * 2.6, x + 0.5, y - r - 0.01, z); }
  }
  private sign(text: string, x: number, y: number, z: number, ry: number, w = 1.2, bg = '#b8b3a2', fg = '#1a1a1a'): void {
    const tex = canvasTexture(512, 128, (c) => {
      c.fillStyle = bg; c.fillRect(0, 0, 512, 128); c.fillStyle = fg; c.font = 'bold 54px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, 256, 68);
      c.strokeStyle = fg; c.lineWidth = 5; c.strokeRect(8, 8, 496, 112);
      c.globalAlpha = 0.25; for (let i = 0; i < 260; i++) { c.fillStyle = Math.random() > 0.5 ? '#5a4a36' : '#2a2a2a'; c.fillRect(Math.random() * 512, Math.random() * 128, 2 + Math.random() * 5, 1 + Math.random() * 3); }
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0.2 }));
    m.position.set(x, y, z); m.rotation.y = ry; this.setFor(this.owner).group.add(m);
  }
  private floorLine(x0: number, z0: number, x1: number, z1: number): void {
    const tex = canvasTexture(256, 32, (c) => { c.fillStyle = '#c9a21a'; c.fillRect(0, 0, 256, 32); for (let i = 0; i < 500; i++) { c.clearRect(Math.random() * 256, Math.random() * 32, 2 + Math.random() * 9, 1 + Math.random() * 4); } });
    const len = Math.hypot(x1 - x0, z1 - z0);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.1), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -3, depthWrite: false }));
    m.rotation.order = 'YXZ'; m.rotation.set(-Math.PI / 2, Math.atan2(-(z1 - z0), x1 - x0), 0);
    m.position.set((x0 + x1) / 2, 0.004, (z0 + z1) / 2); m.receiveShadow = true; this.setFor(this.owner).group.add(m);
  }
  private debris(x: number, z: number, n: number, spread: number): void {
    for (let i = 0; i < n; i++) {
      const s = 0.03 + this.rand() * 0.09;
      this.rubble.push({ o: this.owner, m: new THREE.Matrix4().compose(new THREE.Vector3(x + (this.rand() - 0.5) * spread, s * 0.4, z + (this.rand() - 0.5) * spread), new THREE.Quaternion().setFromEuler(new THREE.Euler(this.rand() * 6, this.rand() * 6, this.rand() * 6)), new THREE.Vector3(s * (0.6 + this.rand()), s * 0.6, s * (0.6 + this.rand()))) });
    }
    for (let i = 0; i < n / 4; i++) this.box('paper', 0.21, 0.003, 0.3, x + (this.rand() - 0.5) * spread, 0.004 + i * 0.001, z + (this.rand() - 0.5) * spread, 0, this.rand() * 6);
  }
  private wallBox(x: number, y: number, z: number, ry: number, w = 0.5, h = 0.7): void {
    this.prop(x, z, ry, () => {
      this.box('mGrey', w, h, 0.18, 0, y, 0.09); this.box('dark', w * 0.86, 0.01, 0.01, 0, y + h * 0.3, 0.181); this.box('chrome', 0.03, 0.08, 0.03, w * 0.36, y, 0.19);
      this.cyl('steel', 0.018, WALL_H - y - h / 2, -w * 0.25, (WALL_H + y + h / 2) / 2, 0.05, 0, 0, 0, 6); this.cyl('steel', 0.018, WALL_H - y - h / 2, w * 0.1, (WALL_H + y + h / 2) / 2, 0.05, 0, 0, 0, 6);
    });
  }
  private extinguisher(x: number, z: number, ry: number): void {
    this.prop(x, z, ry, () => { this.cyl('mRed', 0.07, 0.45, 0, 1.05, 0.09, 0, 0, 0, 12); this.cyl('mDark', 0.025, 0.1, 0, 1.32, 0.09, 0, 0, 0, 8); this.box('mDark', 0.1, 0.03, 0.03, 0.04, 1.37, 0.09); this.box('mGrey', 0.16, 0.04, 0.06, 0, 1.0, 0.03); });
  }
  private doorLeaf(x: number, z: number, ry: number, mat = 'mGrey'): void {
    this.prop(x, z, ry, () => { this.box(mat, 1.42, 2.2, 0.05, 0.71, 1.12, 0); this.box('chrome', 0.03, 0.14, 0.09, 1.3, 1.05, 0); this.box('dark', 0.5, 0.012, 0.055, 0.71, 1.75, 0); });
  }

  // ---------- rooms ----------
  private propsLoadingBay(): void {
    // roller door on the south wall (where the player came in)
    this.prop(5, 25.5, 0, () => {
      this.box('ceiling', 4.2, 3.3, 0.06, 0, 1.65, -0.04); this.box('mDark', 0.16, 3.4, 0.16, -2.18, 1.7, -0.08); this.box('mDark', 0.16, 3.4, 0.16, 2.18, 1.7, -0.08);
      this.box('mDark', 4.6, 0.4, 0.4, 0, 3.55, -0.2); this.box('mYellow', 4.2, 0.1, 0.1, 0, 0.05, -0.08);
    });
    this.sign('BAY 02', 5, 3.95, 25.28, Math.PI, 1.3, '#1d3d6e', '#d8d8d0');
    this.hangLamp(5, 21, { shadow: true });
    this.pallet(1.8, 18.6, 0.05); this.crate(1.55, 18.5, 0.9, 0.05, 0.125); this.crate(2.3, 18.9, 0.6, 0.4, 0.125); this.col.addBox(1.8, 0.06, 18.6, 0.6, 0.06, 0.5);
    this.crate(8.9, 24.6, 1.0, 0.1); this.crate(8.95, 24.55, 0.7, 0.5, 1.0); this.crate(7.8, 24.8, 0.8, -0.15);
    this.pallet(1.4, 24.4, 1.57); this.pallet(1.4, 24.4, 1.62, 0.125); this.pallet(1.42, 24.4, 1.5, 0.25);
    this.barrel(9.1, 18.0, 0x2f5f9a); this.barrel(8.4, 17.8, 0x2f5f9a); this.barrel(9.2, 18.8, 0x8d9296);
    this.wallBox(0.5, 1.6, 21.5, Math.PI / 2); this.extinguisher(0.5, 20.4, Math.PI / 2);
    this.floorLine(2.6, 25.3, 2.6, 19.4); this.floorLine(7.4, 25.3, 7.4, 19.4); this.floorLine(7.4, 19.4, 10, 19.4); this.floorLine(7.4, 23.1, 10, 23.1);
    this.sign('WAREHOUSE  >', 9.99, 2.75, 21.25, -Math.PI / 2, 1.6);
    this.debris(6.5, 18.2, 16, 3); this.debris(3, 24.5, 10, 2);
    this.doorLeaf(2.5, 16.48, 1.45);
  }
  private propsBreakRoom(): void {
    this.tubeLight(5, 12.6, 0, { shadow: true });
    this.prop(4.6, 12.9, 0.08, () => { // table
      this.box('mBeige', 1.8, 0.04, 0.85, 0, 0.74, 0); for (const sx of [-0.8, 0.8]) for (const sz of [-0.35, 0.35]) this.cyl('chrome', 0.02, 0.72, sx, 0.36, sz, 0, 0, 0, 6);
      this.cyl('paper', 0.04, 0.1, 0.3, 0.81, 0.1, 0, 0, 0, 8); this.cyl('mRed', 0.033, 0.12, -0.4, 0.82, -0.2, 0, 0, 0, 8); this.box('paper', 0.3, 0.004, 0.42, -0.1, 0.765, 0.1, 0, 0.5);
      this.solid(1.8, 0.78, 0.85);
    });
    this.chair(4.2, 12.0, 0.3); this.chair(5.3, 13.8, 3.3); this.chair(3.4, 13.1, 1.7);
    this.lockers(0.75, 11.5, Math.PI / 2, 6, 'mBlue'); this.lockers(0.75, 14.6, Math.PI / 2, 4, 'mBlue');
    this.prop(8.2, 16.1, Math.PI, () => { // vending cabinet + counter
      this.box('mDark', 0.9, 1.85, 0.75, 0, 0.925, 0); this.box('dark', 0.6, 1.2, 0.01, -0.1, 1.1, 0.376); this.box('ledAmber', 0.12, 0.05, 0.01, 0.33, 1.3, 0.377); this.solid(0.9, 1.85, 0.75);
    });
    this.prop(8.9, 10.2, -Math.PI / 2, () => { // kitchenette counter
      this.box('mBeige', 2.2, 0.86, 0.6, 0, 0.43, 0); this.box('steel', 2.24, 0.04, 0.64, 0, 0.88, 0); this.box('chrome', 0.5, 0.02, 0.4, 0.5, 0.9, 0); this.cyl('chrome', 0.015, 0.25, 0.5, 1.02, -0.2, 0, 0, 0, 6);
      for (const sx of [-0.73, 0, 0.73]) this.box('dark', 0.008, 0.8, 0.01, sx - 0.365, 0.43, 0.301);
      this.box('mBeige', 2.2, 0.6, 0.32, 0, 2.0, -0.14); this.solid(2.2, 0.9, 0.6);
    });
    this.sign('NO SMOKING', 5.2, 2.3, 9.01, 0, 1.0, '#a01c14', '#e2ddd0');
    this.debris(7, 14.5, 12, 3);
    this.doorLeaf(4.5, 9.02, -1.5, 'mBlue');
  }
  private propsHall(): void {
    this.rack(13, 24.95, 0); this.rack(22, 24.95, 0);
    this.rack(25.45, 23.0, Math.PI / 2, 3);
    // crate clusters (cover)
    this.crate(14.4, 9.8, 1.0, 0.1); this.crate(15.5, 9.9, 0.8, -0.2); this.crate(14.5, 9.8, 0.7, 0.5, 1.0);
    this.pallet(20.4, 16.8, 0.1); this.crate(20.2, 16.6, 1.0, 0.1, 0.125); this.crate(20.9, 17.6, 0.7, 0.6); this.crate(20.2, 16.6, 0.6, 0.35, 1.125); this.col.addBox(20.4, 0.06, 16.8, 0.6, 0.06, 0.5);
    this.crate(24.9, 18.7, 1.0, 0); this.crate(24.9, 19.8, 1.0, 0.08); this.crate(24.9, 19.2, 0.8, 0.3, 1.0); this.crate(23.9, 19.4, 0.7, -0.3);
    this.barrier(18.2, 15.4, 0.06); this.barrier(13.4, 21.4, Math.PI / 2 + 0.1); this.barrier(22.9, 11.4, -0.35);
    this.barrel(11.4, 17.2, 0xa82a20); this.barrel(12.1, 17.5, 0xa82a20); this.barrel(11.5, 18.0, 0x8d9296); this.barrel(12.6, 16.6, 0x2f5f9a, true);
    this.barrel(25.2, 9.8, 0x4c6a4a); this.barrel(24.5, 9.7, 0x4c6a4a); this.barrel(25.3, 10.6, 0xd08a1c);
    this.pallet(17.2, 22.6, 0.4); this.pallet(17.25, 22.6, 0.45, 0.125);
    // cable spool
    this.prop(11.6, 12.2, 0.3, () => { this.cyl('wood', 0.6, 0.06, 0, 0.6, -0.33, Math.PI / 2, 0, 0, 20); this.cyl('wood', 0.6, 0.06, 0, 0.6, 0.33, Math.PI / 2, 0, 0, 20); this.cyl('rubber', 0.36, 0.6, 0, 0.6, 0, Math.PI / 2, 0, 0, 16); this.solid(1.2, 1.2, 0.75); });
    this.hangLamp(18.25, 23.2, { intensity: 40 }); this.hangLamp(18.25, 10.9, { intensity: 40 });
    this.wallBox(10.5, 1.6, 15, Math.PI / 2, 0.7, 1.0); this.wallBox(26, 1.6, 16.5, -Math.PI / 2); this.extinguisher(26, 19.6, -Math.PI / 2);
    this.sign('ZONE B - STORAGE', 18.25, 3.2, 9.01, 0, 2.2); this.sign('GENERATOR', 25.99, 2.75, 12.75, -Math.PI / 2, 1.3, '#c9a21a'); this.sign('WORKSHOP', 25.99, 2.75, 21.25, -Math.PI / 2, 1.3);
    this.floorLine(10.6, 19.4, 16.9, 19.4); this.floorLine(16.9, 19.4, 16.9, 9.1); this.floorLine(19.7, 9.1, 19.7, 19.4); this.floorLine(10.6, 23.1, 25.9, 23.1);
    this.debris(18, 18, 40, 12); this.debris(23, 12, 14, 4); this.debris(12, 22, 12, 3);
    // conduit along west wall
    this.prop(10.56, 17, Math.PI / 2, () => { for (const y of [2.9, 3.0, 3.1]) this.cyl('steel', 0.02, 15, 0, y, 0, 0, 0, Math.PI / 2, 6); });
  }
  private propsCorridor(): void {
    this.tubeLight(6, 7, 0, { shadow: true }); this.tubeLight(18.25, 7, 0, { flicker: true, shadow: true }); this.tubeLight(30, 7, 0, { shadow: true }); this.tubeLight(12, 7, 0, { off: true }); this.tubeLight(24.3, 7, 0, { off: true });
    this.pipeRun(0.5, 35.5, 3.75, 5.75, 0.07); this.pipeRun(0.5, 35.5, 3.72, 5.98, 0.045, 'mRed'); this.pipeRun(0.5, 35.5, 3.86, 6.2, 0.03, 'copper');
    // cable tray
    this.box('mGrey', 35, 0.02, 0.3, 18, 3.78, 8.2); this.box('mGrey', 35, 0.08, 0.02, 18, 3.82, 8.05); this.box('mGrey', 35, 0.08, 0.02, 18, 3.82, 8.35);
    for (const z of [8.12, 8.2, 8.27]) this.cyl('rubber', 0.022, 35, 18, 3.81, z, 0, 0, Math.PI / 2, 6);
    for (let x = 2; x < 35; x += 3) this.box('mDark', 0.03, WALL_H - 3.78, 0.03, x, (WALL_H + 3.78) / 2, 8.38);
    this.prop(14.2, 5.86, 0, () => { this.box('mGrey', 0.9, 1.9, 0.42, 0, 0.95, 0); this.box('dark', 0.008, 1.8, 0.01, 0, 0.95, 0.211); this.box('chrome', 0.02, 0.1, 0.03, 0.06, 1.0, 0.22); this.solid(0.9, 1.9, 0.44); });
    this.prop(27, 8.05, 0.04, () => { // trolley
      this.box('mGrey', 1.0, 0.03, 0.55, 0, 0.3, 0); this.box('mGrey', 1.0, 0.03, 0.55, 0, 0.85, 0); for (const sx of [-0.48, 0.48]) for (const sz of [-0.25, 0.25]) { this.cyl('chrome', 0.012, 0.8, sx, 0.5, sz, 0, 0, 0, 6); this.cyl('rubber', 0.05, 0.03, sx, 0.05, sz, Math.PI / 2, 0, 0, 10); }
      this.box('card', 0.4, 0.3, 0.35, -0.2, 1.02, 0, 0, 0.3); this.box('mRed', 0.35, 0.18, 0.2, 0.25, 0.41, 0); this.solid(1.0, 0.9, 0.55);
    });
    this.extinguisher(22.6, 5.5, 0); this.wallBox(8.8, 1.6, 5.5, 0); this.wallBox(33.5, 1.6, 8.5, Math.PI);
    this.sign('ADMIN', 4.25, 2.6, 5.51, 0, 0.8); this.sign('LOCKERS', 12.25, 2.6, 5.51, 0, 0.9); this.sign('CONTROL ROOM', 21.25, 2.6, 5.51, 0, 1.4, '#c9a21a'); this.sign('STORES', 30.75, 2.6, 5.51, 0, 0.8);
    this.sign('<  EXIT', 2, 2.9, 8.49, Math.PI, 0.9, '#1c6b36', '#e6f2e6');
    this.debris(10, 7, 14, 2.4); this.debris(25, 7.2, 14, 2.2); this.box('card', 0.5, 0.35, 0.4, 16.2, 0.175, 8.2, 0, 0.4);
    this.doorLeaf(23, 5.48, 1.52, 'mGrey'); this.doorLeaf(30, 8.52, -1.48, 'mYellow');
  }
  private propsOffices(): void {
    // A: admin
    this.inRoom('officeA');
    this.tubeLight(4.2, 2.8, 0, { shadow: true, intensity: 26 });
    this.desk(2.2, 1.3, 0); this.chair(2.1, 2.2, 0.4); this.desk(6.4, 3.3, -Math.PI / 2); this.chair(5.6, 3.4, -1.9);
    this.prop(7.72, 1.2, -Math.PI / 2, () => { for (const sx of [-0.5, 0, 0.5]) { this.box('mGrey', 0.46, 1.32, 0.6, sx, 0.66, 0); for (let i = 0; i < 4; i++) { this.box('dark', 0.42, 0.008, 0.01, sx, 0.1 + i * 0.32, 0.301); this.box('chrome', 0.12, 0.02, 0.02, sx, 0.26 + i * 0.32, 0.31); } } this.solid(1.5, 1.35, 0.6); });
    this.prop(0.52, 3.2, Math.PI / 2, () => { this.box('wood', 1.5, 1.0, 0.03, 0, 1.7, 0.015); for (let i = 0; i < 9; i++) this.box('paper', 0.2, 0.28, 0.004, -0.55 + (i % 5) * 0.28, 1.9 - Math.floor(i / 5) * 0.4, 0.034, 0, 0, (this.rand() - 0.5) * 0.15); });
    this.debris(4, 3.6, 14, 3);
    // B: lockers
    this.inRoom('officeB');
    this.tubeLight(12.2, 2.8, 0, { intensity: 22, shadow: true });
    this.lockers(11.2, 0.76, 0, 11); this.lockers(15.74, 3.0, -Math.PI / 2, 6);
    this.prop(11.6, 2.9, 0, () => { this.box('wood', 2.4, 0.05, 0.36, 0, 0.45, 0); for (const sx of [-1, 1]) this.box('mDark', 0.05, 0.43, 0.3, sx, 0.215, 0); this.box('card', 0.3, 0.2, 0.25, 0.6, 0.57, 0, 0, 0.3); this.solid(2.4, 0.5, 0.36); });
    this.debris(13, 3.8, 8, 2);
    // C: control room
    this.inRoom('officeC');
    this.tubeLight(21.2, 2.9, 0, { intensity: 20, color: 0xdfeaff, shadow: true });
    this.prop(21.2, 0.95, 0, () => { // control console wall
      this.box('mGrey', 6.4, 0.9, 0.8, 0, 0.45, 0); this.box('mDark', 6.4, 0.06, 0.86, 0, 0.93, 0.02); this.box('mGrey', 6.4, 1.1, 0.35, 0, 1.5, -0.22, -0.18);
      for (let i = 0; i < 6; i++) {
        const cx = -2.65 + i * 1.06; const live = i !== 2 && i !== 4;
        this.box(live ? 'screen' : 'dark', 0.62, 0.42, 0.01, cx, 1.62, -0.02, -0.18);
        for (let k = 0; k < 5; k++) this.box(live ? (['ledGreen', 'ledAmber', 'ledRed', 'ledGreen', 'ledGreen'][(i + k) % 5]) : 'dark', 0.035, 0.035, 0.012, cx - 0.24 + k * 0.12, 1.2, 0.045, -0.18);
        for (let k = 0; k < 4; k++) this.cyl('plastic', 0.022, 0.03, cx - 0.2 + k * 0.13, 0.975, 0.2, 0, 0, 0, 8);
      }
      this.solid(6.4, 2.0, 0.85);
    });
    this.chair(19.6, 1.9, 2.9); this.chair(22.6, 2.1, 3.5); this.desk(24.9, 3.6, -Math.PI / 2);
    this.prop(17.0, 4.0, Math.PI / 2, () => { this.box('mGrey', 1.4, 2.0, 0.5, 0, 1.0, 0); for (let i = 0; i < 12; i++) this.box(['ledGreen', 'ledAmber', 'dark', 'ledGreen'][i % 4], 0.03, 0.03, 0.012, -0.5 + (i % 6) * 0.18, 1.6 - Math.floor(i / 6) * 0.12, 0.252); this.box('dark', 0.008, 1.9, 0.01, 0, 1.0, 0.251); this.solid(1.4, 2.0, 0.5); });
    this.sign('SYSTEM OFFLINE', 21.2, 2.85, 0.51, 0, 1.6, '#16140f', '#c9321a');
    this.debris(21, 4, 8, 3);
    // D: stores (dark)
    this.inRoom('officeD');
    this.tubeLight(31, 2.8, 0, { off: true });
    this.rack(31, 1.0, 0, 4); this.rack(27.0, 3.0, Math.PI / 2, 3); this.rack(35.0, 3.0, Math.PI / 2, 3);
    this.crate(33.2, 4.2, 0.9, 0.2); this.crate(28.6, 4.3, 0.7, -0.4); this.barrel(33.9, 3.2, 0x8d9296);
    this.lamps.push({ x: 31, y: 3.6, z: 3.4, color: 0xff3a22, intensity: 5, kind: 'emergency', range: 7 });
    this.box('lampRed', 0.16, 0.08, 0.08, 31, 3.3, 0.56);
    this.debris(31, 3.5, 14, 3);
  }
  private propsGenerator(): void {
    const gen = (x: number, z: number) => this.prop(x, z, 0, () => {
      this.box('steel', 2.9, 0.16, 1.3, 0, 0.08, 0); this.box('mGreen', 2.6, 1.45, 1.15, 0, 0.9, 0); this.box('mDark', 0.04, 1.1, 0.9, -1.31, 0.95, 0);
      for (let i = 0; i < 9; i++) this.box('mDark', 0.06, 0.03, 0.86, -1.33, 0.5 + i * 0.11, 0, 0, 0, 0.4);
      this.box('mGrey', 0.7, 0.6, 0.06, 0.6, 1.2, 0.6); for (let k = 0; k < 4; k++) this.box(['ledGreen', 'ledAmber', 'ledRed', 'dark'][k], 0.04, 0.04, 0.012, 0.36 + k * 0.14, 1.35, 0.637); this.box('dark', 0.3, 0.16, 0.01, 0.6, 1.1, 0.632);
      this.cyl('steel', 0.09, WALL_H - 1.6, 0.8, (WALL_H + 1.6) / 2, -0.2, 0, 0, 0, 12); this.cyl('steel', 0.13, 0.5, 0.8, 2.2, -0.2, 0, 0, 0, 12);
      this.cyl('mYellow', 0.28, 1.4, -0.3, 1.9, 0, 0, 0, Math.PI / 2, 14); this.solid(2.9, 1.65, 1.3);
    });
    gen(33.4, 11.2); gen(33.4, 15.2);
    this.prop(28.0, 16.3, 0, () => { // pressure tank
      this.cyl('mBeige', 0.75, 2.2, 0, 1.6, 0, 0, 0, 0, 20); this.part('mBeige', new THREE.SphereGeometry(0.75, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0, 2.7, 0);
      for (let i = 0; i < 3; i++) { const a = (i * Math.PI * 2) / 3; this.box('steel', 0.1, 0.55, 0.1, Math.cos(a) * 0.6, 0.275, Math.sin(a) * 0.6); }
      this.cyl('steel', 0.76, 0.06, 0, 1.2, 0, 0, 0, 0, 20); this.cyl('steel', 0.05, 1.5, 0, 3.6, 0, 0, 0, 0, 8); this.cyl('chrome', 0.08, 0.03, 0.74, 1.8, 0, 0, 0, Math.PI / 2, 12);
    });
    this.col.addCylinder(28, 1.6, 16.3, 1.6, 0.78); this.level.blockWorld(27.25, 15.55, 28.75, 17.05);
    // wall pipes + electrical
    for (const [z, r] of [[9.3, 0.08], [9.55, 0.05]] as const) this.cyl('steel', r, 9, 31, 3.3 + r * 2, z, 0, 0, Math.PI / 2, 10);
    this.cyl('steel', 0.08, 3.4, 35.3, 1.7, 9.3, 0, 0, 0, 10); this.cyl('mRed', 0.11, 0.06, 35.3, 1.2, 9.3, 0, 0, 0, 10);
    this.wallBox(35.5, 1.5, 13.2, -Math.PI / 2, 1.2, 1.4); this.wallBox(26.5, 1.6, 10.2, Math.PI / 2);
    this.lamps.push({ x: 30.6, y: 3.7, z: 13.2, color: 0xff4a2a, intensity: 26, kind: 'emergency', shadow: true, range: 13 });
    this.prop(30.6, 13.2, 0, () => { this.cyl('mDark', 0.09, 0.06, 0, WALL_H - 0.03, 0, 0, 0, 0, 10); this.cyl('lampRed', 0.07, 0.12, 0, WALL_H - 0.12, 0, 0, 0, 0, 10); });
    this.barrel(27.1, 12.9, 0xd08a1c); this.barrel(27.15, 14.3, 0xd08a1c); this.crate(34.6, 9.7, 0.8, 0.2);
    this.sign('DANGER  HIGH VOLTAGE', 35.49, 2.6, 13.2, -Math.PI / 2, 1.5, '#c9a21a');
    this.floorLine(31.6, 9.2, 31.6, 17.3);
    this.debris(30, 13, 16, 5);
  }
  private propsWorkshop(): void {
    this.hangLamp(31, 21.8, { shadow: true, intensity: 55 });
    const bench = (x: number, z: number, ry: number) => this.prop(x, z, ry, () => {
      this.box('wood', 2.2, 0.06, 0.75, 0, 0.9, 0); this.box('mGrey', 2.1, 0.03, 0.65, 0, 0.3, 0); for (const sx of [-1.05, 1.05]) for (const sz of [-0.33, 0.33]) this.box('mDark', 0.05, 0.9, 0.05, sx, 0.45, sz);
      this.box('mRed', 0.5, 0.22, 0.25, -0.6, 1.04, -0.1, 0, 0.2); this.box('steel', 0.14, 0.14, 0.2, 0.7, 1.0, 0.2); this.box('steel', 0.2, 0.06, 0.06, 0.7, 1.09, 0.3); this.cyl('chrome', 0.012, 0.3, 0.7, 1.0, 0.42, 0, 0, Math.PI / 2, 6);
      this.box('card', 0.5, 0.25, 0.4, 0.3, 0.44, 0); this.box('mBlue', 0.3, 0.3, 0.3, -0.6, 0.47, 0);
      this.box('wood', 2.2, 1.0, 0.02, 0, 1.75, -0.36); for (let i = 0; i < 7; i++) this.box(i % 2 ? 'steel' : 'plastic', 0.04, 0.2 + this.rand() * 0.25, 0.02, -0.9 + i * 0.3, 1.8, -0.34, 0, 0, (this.rand() - 0.5) * 0.3);
      this.solid(2.2, 0.95, 0.75);
    });
    bench(35.0, 20.2, -Math.PI / 2); bench(35.0, 23.2, -Math.PI / 2);
    this.prop(27.0, 24.2, Math.PI / 2, () => { this.box('mRed', 1.2, 1.7, 0.55, 0, 0.9, 0); for (let i = 0; i < 6; i++) { this.box('dark', 1.14, 0.008, 0.01, 0, 0.2 + i * 0.27, 0.276); this.box('chrome', 0.3, 0.02, 0.025, 0, 0.32 + i * 0.27, 0.285); } this.solid(1.2, 1.75, 0.55); });
    this.crate(29.2, 24.7, 1.0, 0.1); this.crate(30.3, 24.8, 0.8, -0.1); this.crate(29.3, 24.7, 0.6, 0.6, 1.0);
    this.barrel(34.7, 25.0, 0x2f5f9a); this.barrel(34.0, 25.1, 0xa82a20);
    this.prop(28.3, 19.6, 0.5, () => { // welding cart
      this.cyl('mBlue', 0.12, 1.2, -0.15, 0.75, 0, 0, 0, 0, 12); this.cyl('mRed', 0.1, 1.0, 0.15, 0.65, 0, 0, 0, 0, 12); this.box('mDark', 0.6, 0.04, 0.4, 0, 0.13, 0); this.box('mDark', 0.03, 1.2, 0.03, 0, 0.75, -0.19);
      for (const sx of [-0.25, 0.25]) this.cyl('rubber', 0.1, 0.04, sx, 0.1, 0.2, Math.PI / 2, 0, 0, 10); this.solid(0.6, 1.4, 0.45);
    });
    this.wallBox(31.5, 1.6, 25.5, Math.PI);
    this.sign('EYE PROTECTION REQUIRED', 30.5, 2.8, 25.49, Math.PI, 1.7, '#1d3d6e', '#d8d8d0');
    this.debris(31, 22, 20, 5);
    this.doorLeaf(26.52, 20.5, Math.PI / 2 - 0.1, 'mYellow');
  }

  // ---------- flush batches / instances ----------
  private flush(): void {
    for (const [key, geos] of this.batch) {
      const [owner, mat] = key.split('|'); const g = mergeGeometries(geos, false)!; geos.forEach((x) => x.dispose());
      const mesh = new THREE.Mesh(g, this.mats[mat]); mesh.name = key;
      mesh.castShadow = !NO_SHADOW.has(mat); mesh.receiveShadow = !NO_SHADOW.has(mat) || mat === 'paper';
      this.setFor(owner).group.add(mesh);
    }
    this.batch.clear();
    // crates
    const cg: THREE.BufferGeometry[] = [new THREE.BoxGeometry(0.94, 0.94, 0.94).translate(0, 0.5, 0)];
    const e = 0.5, t = 0.09;
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      cg.push(new THREE.BoxGeometry(t, 1, t).translate(a * (e - t / 2), 0.5, b * (e - t / 2)));
      cg.push(new THREE.BoxGeometry(1, t, t).translate(0, 0.5 + a * (e - t / 2), b * (e - t / 2)));
      cg.push(new THREE.BoxGeometry(t, t, 1).translate(b * (e - t / 2), 0.5 + a * (e - t / 2), 0));
    }
    for (const s of [-1, 1]) { cg.push(new THREE.BoxGeometry(1.25, t, 0.03).rotateZ(s * 0.76).translate(0, 0.5, s * 0.485)); cg.push(new THREE.BoxGeometry(0.03, t, 1.25).rotateX(s * 0.76).translate(s * 0.485, 0.5, 0)); }
    const crateGeo = mergeGeometries(cg.map((g) => g.toNonIndexed()), false)!;
    // barrels
    const prof: [number, number][] = [[0, 0], [0.29, 0], [0.29, 0.02], [0.28, 0.03], [0.28, 0.28], [0.296, 0.3], [0.28, 0.32], [0.28, 0.58], [0.296, 0.6], [0.28, 0.62], [0.28, 0.86], [0.29, 0.87], [0.29, 0.9], [0.272, 0.9], [0.272, 0.875], [0, 0.875]];
    const barrelGeo = new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 22);
    const rubbleGeo = new THREE.DodecahedronGeometry(1, 0);
    // one InstancedMesh per prop type per owning room, so a room's instances hide with the room
    const col = new THREE.Color();
    const instanced = <T extends { m: THREE.Matrix4; o: string }>(items: T[], geo: THREE.BufferGeometry, mat: THREE.Material, shadow: boolean, each?: (im: THREE.InstancedMesh, i: number, it: T) => void) => {
      for (const owner of new Set(items.map((i) => i.o))) {
        const mine = items.filter((i) => i.o === owner); const im = new THREE.InstancedMesh(geo, mat, mine.length);
        mine.forEach((it, i) => { im.setMatrixAt(i, it.m); each?.(im, i, it); });
        im.castShadow = shadow; im.receiveShadow = true; im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); this.setFor(owner).group.add(im);
      }
    };
    instanced(this.crates, crateGeo, this.mats.wood, true);
    instanced(this.barrels, barrelGeo, this.mats.inst, true, (im, i, b) => im.setColorAt(i, col.set(b.c)));
    instanced(this.rubble, rubbleGeo, this.mats.wall, false);
  }
}
