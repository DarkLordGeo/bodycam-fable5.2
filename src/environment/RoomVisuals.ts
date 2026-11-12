import * as THREE from 'three';
import type { AssetLoader } from '../assets/AssetLoader';
import { ROOM_MANIFEST } from '../assets/RoomManifest';
import type { VisualSet } from './EnvironmentBuilder';
import type { CollisionWorld } from './CollisionWorld';
import type { Level } from './Level';
import { buildCollisionReference, exportCollisionReferenceGLB } from './CollisionReference';
import { ROOM_IDS, ROOM_RECTS, ROOM_VISUALS, isRoomId, type RoomId, type RoomVisualMode } from './Rooms';

export interface RoomValidation { room: RoomId; ok: boolean; triangles: number; issues: string[] }

/**
 * Chooses, per room, between the procedural visuals and an imported GLB.
 *
 * This class only ever touches THREE objects. It has no way to create colliders or edit the nav grid:
 * `col` and `level` are read (for the debug overlay and the reference export) and never written, so
 * switching modes cannot change physics or AI navigation.
 */
export class RoomVisuals {
  readonly modes: Record<RoomId, RoomVisualMode> = { ...ROOM_VISUALS };
  private imported = new Map<RoomId, THREE.Group>();
  private overlay: THREE.Group | null = null;
  private importRoot = new THREE.Group();

  constructor(private scene: THREE.Scene, private sets: Map<string, VisualSet>, private assets: AssetLoader, private col: CollisionWorld, private level: Level) {
    this.importRoot.name = 'imported-rooms'; scene.add(this.importRoot);
    this.apply();
  }

  /** Applies ?glb=corridor,hall and ?colliders from the page URL (development convenience). */
  async applyUrlOverrides(params: URLSearchParams): Promise<void> {
    for (const id of (params.get('glb') ?? '').split(',').filter(isRoomId)) await this.setMode(id, 'glb');
    if (params.has('colliders')) this.showColliders(true);
  }

  /** Switches one room. Returns false (and leaves the room procedural) if it has no manifest entry. */
  async setMode(room: RoomId, mode: RoomVisualMode): Promise<boolean> {
    if (mode === 'glb') {
      if (!ROOM_MANIFEST[room]) { console.warn(`[rooms] ${room} has no entry in ROOM_MANIFEST; staying procedural`); return false; }
      if (!this.imported.has(room)) {
        const g = await this.assets.loadRoom(room);
        if (g) {
          g.name = 'imported:' + room;
          g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
          this.imported.set(room, g); this.importRoot.add(g);
          const v = this.validate(room); if (!v.ok) console.warn(`[rooms] ${room} validation: ${v.issues.join('; ')}`);
        } else console.warn(`[rooms] ${ROOM_MANIFEST[room]!.file} not found: ${room} shows no imported visuals yet`);
      }
    }
    this.modes[room] = mode; this.apply();
    return true;
  }

  /** Shows / hides every visual set according to the current modes. */
  private apply(): void {
    const glb = (r: RoomId) => this.modes[r] === 'glb';
    for (const v of this.sets.values()) v.group.visible = v.rule === 'all' ? !v.rooms.every(glb) : !v.rooms.some(glb);
    for (const [room, g] of this.imported) g.visible = glb(room);
  }

  /** Wireframe of the real collision geometry, drawn over whatever visuals are active. */
  showColliders(on: boolean): void {
    if (on && !this.overlay) {
      const ref = buildCollisionReference(this.col, this.level); const o = (this.overlay = new THREE.Group()); o.name = 'collider-overlay';
      const lines = new Map<number, THREE.LineBasicMaterial>();
      ref.updateMatrixWorld(true);
      ref.traverse((n) => {
        const m = n as THREE.Mesh; if (!m.isMesh) return;
        const color = (m.material as THREE.MeshStandardMaterial).color.getHex();
        let lm = lines.get(color); if (!lm) lines.set(color, (lm = new THREE.LineBasicMaterial({ color: n.userData.kind === 'door_opening' ? 0x35ff6a : n.userData.category === 'prop' ? 0xffa51e : 0x39c5ff, depthTest: false, transparent: true, opacity: 0.85, fog: false, toneMapped: false })));
        const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), lm); e.applyMatrix4(m.matrixWorld); e.renderOrder = 20; e.frustumCulled = false; o.add(e);
        m.geometry.dispose();
      });
      this.scene.add(o);
    }
    if (this.overlay) this.overlay.visible = on;
  }
  get collidersShown(): boolean { return !!this.overlay?.visible; }

  /** Checks an imported room against its footprint and budget. Visual-only; never alters gameplay. */
  validate(room: RoomId): RoomValidation {
    const g = this.imported.get(room), a = ROOM_MANIFEST[room]; const issues: string[] = []; let triangles = 0;
    if (!g || !a) return { room, ok: false, triangles, issues: ['no imported visuals loaded'] };
    g.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g), q = ROOM_RECTS[room], tol = 0.3;
    if (box.min.x < q.x0 - tol || box.max.x > q.x1 + tol || box.min.z < q.z0 - tol || box.max.z > q.z1 + tol) issues.push(`geometry leaves the room footprint (x ${box.min.x.toFixed(2)}..${box.max.x.toFixed(2)}, z ${box.min.z.toFixed(2)}..${box.max.z.toFixed(2)})`);
    if (box.min.y < -0.5 || box.max.y > 5.5) issues.push(`geometry outside the vertical range (y ${box.min.y.toFixed(2)}..${box.max.y.toFixed(2)})`);
    g.traverse((o) => {
      const m = o as THREE.Mesh; if (!m.isMesh) return;
      triangles += (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3;
      if (/^(UCX_|COL_|REF_)/.test(m.name)) issues.push(`helper mesh "${m.name}" must not be exported with the room`);
    });
    if (triangles > a.maxTriangles) issues.push(`${Math.round(triangles)} triangles exceeds the budget of ${a.maxTriangles}`);
    return { room, ok: issues.length === 0, triangles: Math.round(triangles), issues };
  }

  /** Binary glTF of the collision reference (for Blender / Unreal). */
  exportCollisionReference(): Promise<ArrayBuffer> { return exportCollisionReferenceGLB(this.col, this.level); }
  /** Saves collision_reference.glb from the browser. */
  async downloadCollisionReference(): Promise<void> {
    const url = URL.createObjectURL(new Blob([await this.exportCollisionReference()], { type: 'model/gltf-binary' }));
    const a = document.createElement('a'); a.href = url; a.download = 'collision_reference.glb'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Summary for tests and the console. */
  status(): { modes: Record<RoomId, RoomVisualMode>; proceduralVisible: Record<string, boolean>; imported: RoomId[]; colliders: boolean } {
    const proceduralVisible: Record<string, boolean> = {}; for (const id of ROOM_IDS) proceduralVisible[id] = this.sets.get(id)!.group.visible;
    return { modes: { ...this.modes }, proceduralVisible, imported: [...this.imported.keys()], colliders: this.collidersShown };
  }
}
