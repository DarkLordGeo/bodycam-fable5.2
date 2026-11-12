# BODYCAM // Facility 7 — Claude Code project context

Single-player, browser-based first-person shooter with a body-mounted camera look.
**The game runtime is Three.js + TypeScript + Vite + Rapier. It is not Unreal Engine.**
Unreal Editor and Blender are offline content tools (see "Content pipeline").

Conventions and key decisions: @PROJECT_GUIDE.md

## Commands

```bash
npm ci                    # install locked dependencies
npm run dev               # http://localhost:5173  (?glb=corridor  ?colliders  for environment work)
npm run typecheck         # tsc --noEmit
npm run build             # typecheck + vite build -> dist/
npm run preview           # serve dist/ on :4173 (needed by test:e2e and export:collision)
npm run test:e2e          # 53-check gameplay + environment-pipeline test
npm run export:collision  # regenerate art/reference/collision_reference.glb (needs preview running)
npm run verify:env        # dev-environment health check (repo, docs, Unreal MCP, Blender)
```

On Windows, `test:e2e` and `export:collision` need `CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"`
(they default to a Linux path). `test:e2e` overwrites `docs/screenshots/e2e-final-frame.png`. Run `git restore`
on it unless updating that screenshot is intended.

## Architecture (see docs/ARCHITECTURE.md)

- `core/Game.ts` is the composition root and owns frame order. `core/FullGame.ts` is the only place that wires
  weapons, enemies, audio and HUD together. Systems never import each other sideways.
- Tunables live in `src/config.ts`. Test hooks are on `window.__game.test`, active only with `?test`.
  `__game.test.fingerprint()` hashes every static collider, blocked cell and nav cell.

### Coordinate system and units
- Metres and seconds. **Y is up.** The player looks down **-Z** at yaw 0. Enemy forward = `(sin yaw, 0, cos yaw)`.
- Level footprint: 36 m (x) × 26 m (z), origin at the north-west corner, floor at Y = 0. 0.5 m cell grid (`GW=72`, `GH=52`).
  Wall height 4.2 m, door height 2.35 m.
- Blender → GLB → three.js (verified by `tools/blender/selftest.mjs`): Blender `(x, y, z)` → three.js `(x, z, -y)`.
  Blender +Y is the player's forward at yaw 0. 1 Blender unit = 1 m. Author room GLBs in level coordinates; do not re-centre.
- Unreal Engine is Z-up, left-handed, centimetres. The glTF ↔ UE import mapping has **not** been verified yet.

### Environment responsibilities
| File | Owns |
| --- | --- |
| `src/environment/Level.ts` | **Single source of truth for layout.** 0.5 m grid of walls and door openings. Derives wall rects, the `blocked` grid and the agent nav grid. Also holds player spawn, enemy spawns and patrols, and skylights. |
| `src/environment/EnvironmentBuilder.ts` | Two independent outputs. **Gameplay:** Rapier colliders (`col.addBox/addCylinder`, `solid()`) and nav blocking, created exactly once. **Visuals:** meshes grouped into `VisualSet`s (one per room, plus shared walls and door frames), merged per material within each set. Repeated props use `InstancedMesh`. |
| `src/environment/Rooms.ts` | Partitions the footprint into 10 rooms **for visuals only** (`ROOM_RECTS`). `ROOM_VISUALS` sets the default mode per room (all `procedural`). |
| `src/environment/RoomVisuals.ts` | Switches rooms between `procedural` and `glb` visuals, shows the collider overlay, validates imported rooms, and exports the collision reference. Never writes colliders or nav. Reached as `__game.environment`. |
| `src/environment/CollisionWorld.ts` | Rapier wrapper with static colliders (recorded in `statics` with a `tag`), raycast and line of sight. |
| `src/environment/CollisionReference.ts` | Builds the mesh copy of the real colliders (`COL_*`), door-opening volumes (`REF_door_opening_*`) and room markers (`ROOM_*`). |
| `src/enemies/Navigation.ts` | 8-way A* on the nav grid with string pulling. |
| `src/assets/AssetLoader.ts` | Startup assets from local `public/assets`: texture sets `*_albedo/_normal/_orm.jpg`, grime, HDR, `soldier.glb`. `loadRoom()` fetches a room GLB on demand, with meshopt supported. Draco and KTX2 are **not** wired up. |
| `src/assets/RoomManifest.ts` | `room → { file, version, maxTriangles }`. Only `corridor` is listed: `models/env/room_corridor.glb`, 60,000 triangles. **That file does not exist yet.** |

## Content pipeline (rules — details in docs/ENVIRONMENT_PIPELINE.md)

- **Blender is the source of truth for shipping assets.** Shipping format is **GLB/glTF 2.0**.
- **Unreal Editor is a visual-development and scene-composition workspace only** (`../BodycamVisDev`). Nothing ships from it.
- **Physics and navigation stay independent of imported visuals.** Colliders and nav come from `Level.ts` and
  explicit `solid()` calls, never from GLB geometry. The e2e fingerprint (`EXPECTED_FINGERPRINT` in `scripts/e2e.mjs`)
  must stay unchanged.
- **Phase 1 (service corridor): pipeline code is on `main`.** The corridor GLB itself is not produced yet. Status and open items
  are in docs/ENVIRONMENT_PHASE_1.md.
- Room GLB authoring: level coordinates, inside the room rect ±0.3 m, Y between −0.5 and 5.5 m, triangles within the
  manifest budget, and no `UCX_`/`COL_`/`REF_` helper meshes. Check with `node tools/blender/glb-report.mjs file.glb --room corridor`.
- Use `art/reference/collision_reference.glb` as the modelling reference in Blender and Unreal. Never export it with a room.
- No runtime third-party URLs. Textures ≤ 1K. Licensing per docs/ASSET_CREDITS.md.
- Open decisions are listed in docs/ENVIRONMENT_PIPELINE.md. **Do not invent answers to them**; ask.

## Guardrails for Claude

- Do not change `Level.ts`, colliders, navigation or physics unless the user explicitly asks for that change.
  If a layout change is intended, also update `EXPECTED_FINGERPRINT` and regenerate the collision reference.
- Do not write into `public/assets` unless the task is explicitly about shipping an asset
  (`tools/blender/export_glb.py` refuses without `--allow-public-assets`).
- Never save or overwrite a user's `.blend` file from automation; export to a new path.
- Unreal MCP tool calls run serially on the editor's game thread: never issue overlapping calls. Start with read-only
  tools (`get_current_level`, `find_actors`) before anything that mutates the level.
- Do not commit or push without asking. Keep machine-specific config out of the repo.

## Tools available to Claude in this repo

- **Unreal MCP** (`unreal-mcp`, Epic's experimental UE 5.8 plugin), registered at Claude Code *local* scope →
  `http://127.0.0.1:8000/mcp`. Needs the editor running: `powershell -File tools/unreal/launch-editor.ps1`.
  Tool-search mode: `list_toolsets` → `describe_toolset` → `call_tool {toolset_name, tool_name, arguments}`.
  Smoke test: `npm run verify:unreal`.
- **Blender 5.2 LTS** via headless Python (`bpy`). Scripts in `tools/blender/`:
  - `inspect_scene.py`: read-only scene report.
  - `export_glb.py`: GLB export.
  - `glb-report.mjs`: validator; `--room <id>` applies the `RoomVisuals.validate` rules.
  - `selftest.mjs`: end-to-end check.

  Usage in docs/DEVELOPMENT_SETUP.md.
- Three.js debugging MCPs come from the user-level `parallax-threejs` plugin (not configured by this repo).
