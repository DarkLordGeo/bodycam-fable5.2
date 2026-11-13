# Environment Phase 1: service corridor — production brief

Status (2026-11-13): **pipeline code is on `main` (commit 5fda95a). The corridor GLB has not been produced. Modeling has not started.**
How-to and tooling are in `ENVIRONMENT_PIPELINE.md` and `DEVELOPMENT_SETUP.md`.

## Sources and what is missing

Every fact below is read from the code on `main`, the collision reference (`art/reference/collision_reference.glb`), or a
measurement of the running build. Each one cites where it comes from.

**The original environment production assessment was not recovered.** Searched (2026-11-13):
- every git ref and all history
- the working tree
- local Claude Code session transcripts
- recent documents on Desktop, Documents and Downloads
- the connected Google Drive

Nothing was found. The Phase 1 commit points at a claude.ai cloud session, which cannot be read from here. Requirements that only the
assessment could define are listed as **OPEN**. None have been invented.

## 1. Corridor dimensions

| Item | Value | Source |
| --- | --- | --- |
| Room id / visual rect (to wall centre lines) | `corridor`: x 0–36, z 5.25–8.75 m | `src/environment/Rooms.ts` |
| Walkable interior (between wall faces) | x 0.5–35.5, z 5.5–8.5 m (35 × 3 m) | collision reference `COL_wall_*` |
| Floor / ceiling | floor top at Y = 0. Ceiling collider underside at Y = 4.2 m (`WALL_H`) | `Level.ts`, `COL_floor_001`, `COL_ceiling_001` |
| North wall (offices side) | collider faces z 5.0–5.5, segments `COL_wall_008`–`015` | collision reference |
| South wall (hall / break room / generator side) | collider faces z 8.5–9.0, segments `COL_wall_016`–`019` | collision reference |
| West / east end walls | x 0–0.5 (`COL_wall_002`), x 35.5–36 (`COL_wall_006`) | collision reference |
| Coordinates | metres, Y up, origin at the level's north-west corner. Blender: three (x, y, z) = Blender (x, −z, y) | `ENVIRONMENT_PIPELINE.md`, verified by `tools/blender/selftest.mjs` |

### Door openings (must stay clear; volumes `REF_door_opening_*`, clear height 2.35 m)

| Opening | Wall | x range | Clear width | Lintel collider above |
| --- | --- | --- | --- | --- |
| `REF_door_opening_002` | north (admin) | 3.5–5.0 | 1.5 m | `COL_lintel_002`, y 2.35–4.2 |
| `REF_door_opening_003` | north (lockers) | 11.5–13.0 | 1.5 m | `COL_lintel_003` |
| `REF_door_opening_004` | north (control room) | 20.5–22.0 | 1.5 m | `COL_lintel_004` |
| `REF_door_opening_005` | north (stores) | 30.0–31.5 | 1.5 m | `COL_lintel_005` |
| `REF_door_opening_006` | south (break room) | 4.5–6.0 | 1.5 m | `COL_lintel_006` |
| `REF_door_opening_007` | south (hall) | 17.0–19.5 | 2.5 m | `COL_lintel_007` |
| `REF_door_opening_008` | south (generator) | 30.0–31.5 | 1.5 m | `COL_lintel_008` |

## 2. Modeling boundaries

These are enforced by `RoomVisuals.validate()` in game and by `node tools/blender/glb-report.mjs <file> --room corridor` offline:
- All geometry must sit within the room rect ± 0.3 m, i.e. x −0.3…36.3 and z 4.95…9.05.
- Y must stay within −0.5…5.5 m.
- No `UCX_*`, `COL_*` or `REF_*` meshes in the export.

From `ENVIRONMENT_PIPELINE.md` and the `EnvironmentBuilder` visual-set rules:
- Author in level coordinates. Do not re-centre the model.
- In GLB mode, **door frames** on corridor openings are hidden as soon as either adjoining room is `glb`. The corridor GLB
  must therefore model its own frames for all 7 openings.
- **Shared walls** stay procedural and visible until every room touching them is `glb`. That includes all corridor walls,
  because the neighbouring rooms stay procedural. Imported wall panels should sit up to 5 cm proud of the collision face to
  cover them. North panel faces go between z 5.50 and 5.55, south panel faces between z 8.45 and 8.50.
- Keep every `REF_door_opening_*` volume empty (width × 2.35 m high).

## 3. Collision constraints (unchanged by visuals)

Gameplay comes from `Level.ts` and `EnvironmentBuilder` gameplay calls only. Switching the corridor to `glb` must not change
the e2e fingerprint **`598d34f6` (130 static colliders, 1529 walkable nav cells)** (`scripts/e2e.mjs`, re-measured 2026-11-13).
The corridor GLB must provide visuals that match these existing colliders:

| Collider | Box (x / z / y) | Current visual |
| --- | --- | --- |
| `COL_prop_corridor_001` | x 13.75–14.65, z 5.64–6.08, y 0–1.9 | locker cabinet against the north wall |
| `COL_prop_corridor_002` | x 26.5–27.5, z 7.775–8.325, y 0–0.9 (yaw 2.3°) | trolley against the south wall |

These dressing items have **no collider** and are visual only: pipe runs, cable tray, extinguisher, wall boxes, signs,
debris, the card box at (16.2, 8.2), and the two open door leaves at x 23 and x 30. If a new solid prop is wanted, it needs a
`solid()` call in code plus an `EXPECTED_FINGERPRINT` update. That is a gameplay change and needs explicit approval.

## 4. Asset requirements

| Requirement | Value | Source |
| --- | --- | --- |
| File | `public/assets/models/env/room_corridor.glb` (binary glTF 2.0, self-contained) | `src/assets/RoomManifest.ts` |
| Manifest | bump `version` whenever the file changes (cache-busting query) | `RoomManifest.ts` |
| Triangle budget | ≤ **60,000** static triangles | `RoomManifest.ts` `maxTriangles` |
| Compression | meshopt allowed. Draco and KTX2/Basis are **not** supported | `AssetLoader.loadRoom()` |
| URIs | none external. Textures embedded | `PROJECT_GUIDE.md`, `glb-report.mjs` |
| Shadows | every imported mesh gets `castShadow` and `receiveShadow` | `RoomVisuals.setMode()` |
| Credits | add a row to `docs/ASSET_CREDITS.md` (source, licence) | `ASSET_CREDITS.md` |
| Object / material naming | **OPEN** (U7). Only the forbidden prefixes are defined | — |
| Source `.blend` location | **OPEN** (U6) | — |

## 5. Material standards

- Core glTF metallic-roughness materials (`ENVIRONMENT_PIPELINE.md`). Textures ≤ 1K (`docs/ARCHITECTURE.md`).
- **Texture-unit budget.** `Lighting.ts` caps shadow fixtures because some GPUs allow only 16 fragment texture units. Procedural
  surfaces use 7, and an imported material that uses more puts the 16-unit limit at risk (commit b9e4ea0 fixed exactly this
  failure). *Derived constraint:* keep each imported material at or below the procedural surfaces' usage:
  - base colour, normal, and one ORM texture
  - no extra glTF material extensions that add samplers
- Imported materials do **not** get the procedural world-space grime / dado patch (`patchSurface` in `Materials.ts` only applies
  to procedural materials). Whether the corridor should match that look is **OPEN** (U9).
- Reference texel density of the procedural surfaces, in repeats per metre (`DENSITY` in `Materials.ts`): wall 0.34, floor 0.26,
  ceiling 0.5, plaster 0.4, steel 0.7, wood 0.9. Use these as reference only; the standard for imported textures is **OPEN**.

## 6. Lighting

The lights stay in code. In `glb` mode the procedural fixture meshes are hidden with the rest of the corridor's visuals, but
the lights themselves remain. These values were measured in the running build on 2026-11-13:

| Fixture | Position (x, y, z) | Light | Shadows |
| --- | --- | --- | --- |
| tube | 6, 3.78, 7 | spot, range 14 m, cone 1.3 rad | no |
| tube, **flickering** | 18.25, 3.78, 7 | spot, range 14 m | **yes** (one of 4 fixture shadow casters level-wide) |
| tube | 30, 3.78, 7 | spot, range 14 m | no |
| tube, **off** (no light) | 12, —, 7 and 24.3, —, 7 | none | — |

- The GLB must model visible fixtures at these 5 positions. The procedural tube housing is 1.3 × 0.05 × 0.2 m, hung at
  Y ≈ 3.8–4.2. Otherwise light would come from empty ceiling.
- Flicker animates the procedural `lampFlicker` material's emissive intensity (`Lighting.ts`). An imported emissive material
  will **not** flicker. How the corridor GLB should show flicker is **OPEN** (new item U14).
- Image-based light: HDR environment at intensity 0.4 (`Renderer.ts`). Tone mapping is AgX in the post chain, followed by bloom.
- Baked lighting / lightmaps for imported rooms: **OPEN** (U12).

## 7. Performance budgets

| Budget | Value | Source |
| --- | --- | --- |
| Corridor static triangles | ≤ 60,000 | `RoomManifest.ts` |
| Draw calls (e2e sanity check) | 20 < calls < 900 at 960×540. Current end-of-run sample 629 (2026-11-13) | `scripts/e2e.mjs` |
| Shadow maps | 1 update per frame. Max 4 shadow fixtures. Sun 2048, fixtures 1024 | `Lighting.ts`, `config.ts` |
| Textures | ≤ 1K | `docs/ARCHITECTURE.md` |
| Per-room material count / draw calls | **OPEN** (U10) | — |

## 8. Reproducible workflow (all steps tested 2026-11-13 except where marked)

1. **Reference in Blender.** Open or create the corridor `.blend` and run `tools/blender/import_reference.py`. It imports
   `collision_reference.glb` into a locked, wireframe, non-render collection `REF_collision_reference`. *Verified:*
   `COL_wall_008` lands at Blender (2, −5.25, 2.1) with size 3 × 0.5 × 4.2 m.
2. **Model** in a separate collection, e.g. `Corridor`, in level coordinates.
3. **Export only that collection:** `blender -b corridor.blend --python tools/blender/export_glb.py -- --out <tmp>/room_corridor.glb --collection Corridor`.
   *Verified:* the reference is excluded, and the export never saves the `.blend`.
4. **Validate:** `node tools/blender/glb-report.mjs <tmp>/room_corridor.glb --room corridor`. Fix every ERROR.
5. **Ship (needs approval).** Re-run the export with `--out public/assets/models/env/room_corridor.glb --allow-public-assets`.
   Bump the manifest `version` and add the credit row.
6. **Check in game:** `npm run build && npm run preview`, then open `http://localhost:4173/?glb=corridor&colliders`. Also run
   `__game.environment.validate('corridor')` and `npm run test:e2e` (53/53, fingerprint unchanged).
7. **Unreal (optional, visual review only; manual, not verified).** In the BodycamVisDev editor, drag `collision_reference.glb` or
   the corridor GLB into the Content Browser. It goes through the Interchange glTF importer, which is enabled by default in 5.8.
   Unreal MCP's `import_file` tool cannot do this step: it accepts FBX/OBJ only (tested). The glTF → Unreal axis/unit mapping
   is not verified (U11). Nothing exported from Unreal ships.

## 9. Acceptance checks that exist today (automated)

- `glb-report --room corridor` / `RoomVisuals.validate()`: bounds, Y range, ≤ 60k triangles, no helper meshes.
- `npm run test:e2e`: 53 checks. These include corridor GLB switching, the fingerprint (unchanged across switching), corridor wall
  collision and the AI path through the corridor in GLB mode.
- **Art acceptance criteria** (visual quality bar, reference images, review and sign-off): **OPEN** (U1/U2). The assessment
  is not available.

## 10. Blockers before modeling

| # | Blocker | Why it blocks | Who |
| --- | --- | --- | --- |
| B1 | Art acceptance criteria and reference set (U1, U2, U13) | Without them a finished corridor cannot be accepted or rejected | Project owner (recover the assessment or decide) |
| B2 | Material approach (U9) and texture standard (U8) | Determines UVs, texel density and whether the corridor matches the procedural rooms | Project owner |
| B3 | Flicker for the imported fixture at x 18.25 (U14) | Imported emissive will not animate; needs a code-side decision | Project owner, then a small code change |
| B4 | Source-file location and naming (U6, U7) | Needed before the first `.blend` is committed | Project owner |

Non-blocking open items: draw-call / material budget (U10), LODs and baked lighting (U12), Unreal ↔ Blender exchange and
glTF-into-Unreal mapping (U11).

**Readiness:** the tooling and technical constraints are ready and tested. Corridor modeling should start only after
B1–B4 are decided. B1 needs the original assessment or a fresh decision. B4 needs only a short decision.
