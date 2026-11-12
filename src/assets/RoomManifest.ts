import type { RoomId } from '../environment/Rooms';

/**
 * One imported room visual. Files live under public/assets/ and are fetched only when the room is
 * switched to 'glb' mode, so listing a room here costs nothing until it is used.
 */
export interface RoomAsset {
  /** Path relative to public/assets/, e.g. 'models/env/room_corridor.glb'. */
  file: string;
  /** Bumped whenever the file changes; appended as a cache-busting query. */
  version: string;
  /** Static-geometry triangle budget for this room; exceeding it is reported by validation. */
  maxTriangles: number;
}

/**
 * Room asset manifest. A room without an entry cannot be switched to 'glb'.
 * The corridor is the Phase 1 target; its file does not exist yet and is produced in Blender
 * (see docs/ENVIRONMENT_PIPELINE.md). Meshes must be authored in level coordinates:
 * metres, Y up, origin at the level's north-west corner, floor at Y = 0.
 */
export const ROOM_MANIFEST: Partial<Record<RoomId, RoomAsset>> = {
  corridor: { file: 'models/env/room_corridor.glb', version: '1', maxTriangles: 60000 },
};
