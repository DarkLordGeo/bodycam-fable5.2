// Room partition used ONLY to organise visuals (procedural vs imported GLB).
// It does not define gameplay: walls, collision and navigation still come from Level.ts.
// Rects run to the wall centre lines, so together they tile the whole 36 x 26 m footprint.
import type { Rect } from './Level';

export const ROOM_IDS = ['officeA', 'officeB', 'officeC', 'officeD', 'corridor', 'breakRoom', 'loadingBay', 'hall', 'generator', 'workshop'] as const;
export type RoomId = (typeof ROOM_IDS)[number];
/** How a room's visuals are produced. Colliders and navigation are identical in both modes. */
export type RoomVisualMode = 'procedural' | 'glb';

export const ROOM_RECTS: Record<RoomId, Rect> = {
  officeA: { x0: 0, z0: 0, x1: 8.25, z1: 5.25 },
  officeB: { x0: 8.25, z0: 0, x1: 16.25, z1: 5.25 },
  officeC: { x0: 16.25, z0: 0, x1: 26.25, z1: 5.25 },
  officeD: { x0: 26.25, z0: 0, x1: 36, z1: 5.25 },
  corridor: { x0: 0, z0: 5.25, x1: 36, z1: 8.75 },
  breakRoom: { x0: 0, z0: 8.75, x1: 10.25, z1: 16.75 },
  loadingBay: { x0: 0, z0: 16.75, x1: 10.25, z1: 26 },
  hall: { x0: 10.25, z0: 8.75, x1: 26.25, z1: 26 },
  generator: { x0: 26.25, z0: 8.75, x1: 36, z1: 17.75 },
  workshop: { x0: 26.25, z0: 17.75, x1: 36, z1: 26 },
};

/** Default: every room renders its procedural visuals. Change a room to 'glb' once its asset exists. */
export const ROOM_VISUALS: Record<RoomId, RoomVisualMode> = {
  officeA: 'procedural', officeB: 'procedural', officeC: 'procedural', officeD: 'procedural', corridor: 'procedural',
  breakRoom: 'procedural', loadingBay: 'procedural', hall: 'procedural', generator: 'procedural', workshop: 'procedural',
};

/** Rooms whose rect touches the given rect (used to decide which rooms share a wall or doorway). */
export function roomsTouching(r: Rect): RoomId[] {
  const e = 0.01;
  return ROOM_IDS.filter((id) => { const q = ROOM_RECTS[id]; return r.x0 < q.x1 - e && r.x1 > q.x0 + e && r.z0 < q.z1 - e && r.z1 > q.z0 + e; });
}

export const isRoomId = (s: string): s is RoomId => (ROOM_IDS as readonly string[]).includes(s);
