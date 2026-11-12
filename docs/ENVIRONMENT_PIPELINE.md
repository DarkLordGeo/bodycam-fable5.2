# Environment pipeline (Phase 1)

Room visuals can be swapped from the procedural build to a Blender-exported GLB, one room at a time,
without touching collision, navigation or gameplay.

## What is gameplay and what is visual

| | Source | Changes with visual mode? |
| --- | --- | --- |
| Walls, door openings, heights | `environment/Level.ts` grid | No |
| Rapier colliders (walls, lintels, floor, ceiling, props) | `EnvironmentBuilder` gameplay calls (`col.addBox`, `col.addCylinder`, `solid()`) | No – created once at startup |
| AI navigation grid | `Level.blockWorld` / `finalizeNav` | No |
| Light positions | `EnvironmentBuilder.lamps` | No |
| Meshes you see | `EnvironmentBuilder` visual sets, or an imported GLB | Yes |

`environment/Rooms.ts` partitions the footprint into ten rooms **for visuals only**. Rects run to the
wall centre lines and tile the whole 36 × 26 m level.

## Visual sets

`EnvironmentBuilder` puts every mesh into a `VisualSet`:

- **Room set** (`officeA` … `workshop`): that room's floor, ceiling, props, fixtures, signs, decals.
- **Shared wall set**: a wall or lintel between rooms. Hidden only when *all* rooms touching it are `glb`.
- **Door frame set**: hidden as soon as *any* adjoining room is `glb` (the imported room brings its own frame).

So with only the corridor in `glb` mode, the walls it shares with still-procedural rooms stay visible.
Imported wall panels should sit up to 5 cm proud of the collision face to cover them.

## Switching a room

Default (all `procedural`) lives in `ROOM_VISUALS` in `environment/Rooms.ts`. To make a change permanent,
edit that table. For development:

- URL: `?glb=corridor` (comma-separated room ids), `?colliders` to draw the collision overlay.
- Console: `await __game.environment.setMode('corridor', 'glb')`, `__game.environment.setMode('corridor', 'procedural')`,
  `__game.environment.showColliders(true)`, `__game.environment.status()`, `__game.environment.validate('corridor')`.

A room can only go to `glb` if it has an entry in `assets/RoomManifest.ts`. If the file is missing, the
room shows no imported visuals (a console warning says so); nothing else changes.

## Room asset manifest

`src/assets/RoomManifest.ts` maps a room id to `{ file, version, maxTriangles }`. Files are fetched by
`AssetLoader.loadRoom()` only when a room is switched to `glb`, never at startup. Meshopt-compressed GLBs
are supported; KTX2 textures are not wired up yet.

Authoring rules for a room GLB:

- Level coordinates: metres, Y up, origin at the level's north-west corner, floor at Y = 0. Do not re-centre.
- Stay inside the room's rect from `Rooms.ts` (0.3 m tolerance) – `validate()` reports violations.
- Visual meshes only. No `UCX_*`, `COL_*` or `REF_*` helpers in the export.
- Core glTF metallic-roughness materials.

## Collision reference

`art/reference/collision_reference.glb` is a mesh copy of the real colliders for Blender / Unreal:

- `COL_structure/` – `COL_wall_###`, `COL_lintel_###`, `COL_floor_001`, `COL_ceiling_001`
- `COL_props/` – `COL_prop_<room>_###` (boxes and cylinders)
- `REF_door_openings/` – translucent volumes that must stay clear (1.5 m or 2.5 m wide, 2.35 m high)
- `REF_rooms/` – one empty per room with its rect in custom properties

Regenerate after any change to `Level.ts` or prop placement:

```bash
npm run build && npm run preview     # terminal 1
npm run export:collision             # terminal 2 → art/reference/collision_reference.glb
```

Or from a running game: `__game.environment.downloadCollisionReference()`.

In Blender, import with the default glTF settings (it converts Y-up to Blender's Z-up), put it in its own
collection and disable selection. In Unreal, import as a static-mesh reference and do not include it in exports.

## Safety net

`scripts/e2e.mjs` holds a fingerprint (hash of every static collider, blocked cell and nav cell). It must
stay equal across mode switches, overlay toggles and exports. If you change the layout on purpose, update
`EXPECTED_FINGERPRINT` in that script and regenerate the collision reference.
