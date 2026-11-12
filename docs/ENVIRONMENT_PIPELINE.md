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

## Tool roles

| Tool | Role | Ships to players? |
| --- | --- | --- |
| Three.js (this repo) | Game runtime: rendering, physics (Rapier), AI, gameplay | Yes |
| Blender | **Source of truth for shipping assets.** Modelling, UVs, materials, GLB export | Via GLB only |
| Unreal Engine 5.8 (`../BodycamVisDev`) | Visual development and scene composition: blockout reviews, lighting/mood studies, layout exploration | No |
| GLB / glTF 2.0 | **Shipping format** for imported room visuals | Yes |

Automation for these tools (Unreal MCP, headless Blender, `tools/blender/glb-report.mjs --room <id>`) is described in
`docs/DEVELOPMENT_SETUP.md`.

## Existing performance budgets

| Budget | Value | Where |
| --- | --- | --- |
| Room GLB static triangles | per room `maxTriangles` (corridor: 60,000) | `src/assets/RoomManifest.ts` |
| Shadow maps updated per frame | 1 (sun on even frames, one fixture round-robin on odd) | `src/rendering/Lighting.ts` |
| Shadow-casting fixtures | max 4: surface materials use 7 texture units + sun shadow 1, against a 16-unit limit on some GPUs (commit b9e4ea0) | `src/rendering/Lighting.ts` |
| Sun / fixture shadow maps | 2048 (`CFG.quality.shadowMap`) / 1024 | `src/config.ts`, `Lighting.ts` |
| MSAA / max pixel ratio | ≤ 4 / 1.5 | `src/config.ts` |
| Dynamic resolution | 0.55–1.0, steps down when average frame time > 19 ms | `src/rendering/Renderer.ts` |
| Draw calls (e2e sanity check) | 20 < calls < 900 at 960×540, software WebGL | `scripts/e2e.mjs` |
| Textures | ≤ 1K | `docs/ARCHITECTURE.md` |
| Observed (not a budget) | about 700–1400 draw calls and 0.6–1.2 M triangles per frame incl. shadow pass (pre-Phase-1). 2026-11-12 Windows e2e end-of-run sample: 361 calls / 194k tris before Phase 1, 629 calls / 119k tris after | `docs/TEST_PLAN.md`, `docs/DEVELOPMENT_SETUP.md` |

Note: imported room meshes get `castShadow` and `receiveShadow` (`RoomVisuals.setMode`). Their materials count against the
same 16-texture-unit fragment budget as the procedural surfaces.

## Licensing constraints

From `docs/ASSET_CREDITS.md`:
- Current runtime assets are CC0 (Poly Haven HDR, generated textures), original work (procedural geometry, audio,
  canvas textures), or Mixamo (`soldier.glb`). **Review the Mixamo terms before any commercial release.**
- No real-world trademarks on weapons and props.
- Every new shipping asset (e.g. `room_corridor.glb` and any textures in it) gets a row in `docs/ASSET_CREDITS.md`
  with source and licence.

## Open decisions

These items were not found in the repository or on this machine. Claude must not assume an answer.
U-numbers match the first draft of this list (dev-environment setup, 2026-11-12). Items settled by Phase 1 are listed at the end.

| # | Decision | Notes |
| --- | --- | --- |
| U1 | Recover the original environment production assessment | Not on this machine; probably in the claude.ai session that built Phase 1 |
| U2 | Phase 1 acceptance criteria for the corridor **asset** (visual bar, sign-off) | The Phase 1 commit lists what was built and tested in code, not the criteria for the art |
| U6 | Where `.blend` sources live (`art/` in this repo, Git LFS, or elsewhere) and file naming | `art/reference/` holds only the generated collision reference |
| U7 | Object/material naming conventions and custom-property metadata in room GLBs | Only the forbidden prefixes (`UCX_`, `COL_`, `REF_`) are defined |
| U8 | Texture format: embedded JPEG/PNG vs KTX2 | KTX2 is not wired up in `AssetLoader.loadRoom` |
| U9 | Whether room GLBs reuse the procedural world-space-UV / grime material look or ship their own UVs and materials | Pipeline doc says "core glTF metallic-roughness materials" |
| U10 | Per-room material count and draw-call budget | Only triangles are budgeted |
| U11 | Unreal ↔ Blender exchange direction and format | UE glTF import axis/unit mapping not yet verified |
| U12 | LODs and baked lighting (lightmaps / AO) for room GLBs | — |
| U13 | Art direction / reference set for the corridor | — |

Settled by Phase 1 (commit 5fda95a):
- U3, which room: `corridor` in `src/environment/Rooms.ts`, x 0–36, z 5.25–8.75.
- U4, triangle budget: per-room `maxTriangles` in `RoomManifest.ts`; corridor 60,000.
- U5, alignment check: `RoomVisuals.validate()`, the `?colliders` overlay, the collision reference, and the e2e fingerprint.
- U8 (partly): meshopt supported, KTX2 not.
