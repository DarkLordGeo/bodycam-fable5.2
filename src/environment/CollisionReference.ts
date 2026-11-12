import * as THREE from 'three';
import type { CollisionWorld, StaticCollider } from './CollisionWorld';
import { DOOR_H, type Level } from './Level';
import { ROOM_IDS, ROOM_RECTS } from './Rooms';

const COLORS: Record<string, number> = { wall: 0x8a8f96, lintel: 0x6f7786, floor: 0x4a4d52, ceiling: 0x3a3d42, prop: 0xd08a1c, door: 0x35c46a };
const pad = (n: number) => String(n).padStart(3, '0');
const category = (c: StaticCollider) => (c.tag.startsWith('prop:') ? 'prop' : c.tag);

/**
 * Builds a mesh copy of the gameplay collision: every static Rapier collider (walls, lintels, floor,
 * ceiling, prop boxes/cylinders) plus the door openings and room markers, in level coordinates
 * (metres, Y up). Read-only by construction: it is derived from `col.statics` and never fed back.
 * Used for the Blender/Unreal modelling reference and for the in-game debug overlay.
 */
export function buildCollisionReference(col: CollisionWorld, level: Level): THREE.Group {
  const root = new THREE.Group(); root.name = 'collision_reference';
  const mats = new Map<string, THREE.MeshStandardMaterial>();
  const mat = (k: string) => { let m = mats.get(k); if (!m) { m = new THREE.MeshStandardMaterial({ color: COLORS[k], roughness: 1, metalness: 0, transparent: k === 'door', opacity: k === 'door' ? 0.35 : 1 }); m.name = 'REF_' + k; mats.set(k, m); } return m; };
  const groups = new Map<string, THREE.Group>();
  const groupFor = (k: string) => { let g = groups.get(k); if (!g) { g = new THREE.Group(); g.name = k; groups.set(k, g); root.add(g); } return g; };
  const counts = new Map<string, number>();

  for (const c of col.statics) {
    const cat = category(c); const room = c.tag.startsWith('prop:') ? c.tag.slice(5) : '';
    const geo = c.shape === 'box' ? new THREE.BoxGeometry(c.hx * 2, c.hy * 2, c.hz * 2) : new THREE.CylinderGeometry(c.hx, c.hx, c.hy * 2, 16);
    const m = new THREE.Mesh(geo, mat(cat));
    const key = cat + (room ? '_' + room : ''); const n = (counts.get(key) ?? 0) + 1; counts.set(key, n);
    m.name = `COL_${key}_${pad(n)}`;
    m.position.set(c.cx, c.cy, c.cz); m.rotation.y = c.rotY;
    m.userData = { kind: 'collider', category: cat, room, shape: c.shape, size: [c.hx * 2, c.hy * 2, c.hz * 2] };
    groupFor(cat === 'prop' ? 'COL_props' : 'COL_structure').add(m);
  }
  // door openings are the absence of a collider: mark the clear volume so artists keep it empty
  level.doorRects().forEach((r, i) => {
    const w = r.x1 - r.x0, d = r.z1 - r.z0;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, DOOR_H, d), mat('door')); m.name = `REF_door_opening_${pad(i + 1)}`;
    m.position.set(r.x0 + w / 2, DOOR_H / 2, r.z0 + d / 2); m.userData = { kind: 'door_opening', clearWidth: Math.max(w, d), clearHeight: DOOR_H };
    groupFor('REF_door_openings').add(m);
  });
  // room markers (empties) at each room centre, carrying the room's visual bounds
  for (const id of ROOM_IDS) {
    const q = ROOM_RECTS[id]; const o = new THREE.Object3D(); o.name = `ROOM_${id}`;
    o.position.set((q.x0 + q.x1) / 2, 0, (q.z0 + q.z1) / 2); o.userData = { kind: 'room', x0: q.x0, z0: q.z0, x1: q.x1, z1: q.z1 };
    groupFor('REF_rooms').add(o);
  }
  root.userData = { units: 'metres', up: '+Y', origin: 'level north-west corner, floor at Y=0', generatedFrom: 'Rapier static colliders', note: 'Reference only. Do not ship. Regenerate after any Level.ts or prop change.' };
  return root;
}

/** Serialises the reference to a binary glTF. The exporter is loaded on demand (not part of the game bundle). */
export async function exportCollisionReferenceGLB(col: CollisionWorld, level: Level): Promise<ArrayBuffer> {
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
  const root = buildCollisionReference(col, level);
  const out = await new GLTFExporter().parseAsync(root, { binary: true });
  root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
  return out as ArrayBuffer;
}
