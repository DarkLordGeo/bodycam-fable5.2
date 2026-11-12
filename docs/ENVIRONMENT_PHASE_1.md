# Environment Phase 1: service corridor

Status (2026-11-12): **pipeline code is merged on `main` (commit 5fda95a). The corridor GLB asset is not produced yet.**
How-to details are in `ENVIRONMENT_PIPELINE.md`. This file records what Phase 1 contains and what is still open.

## Implemented (commit 5fda95a, "Phase 1: separate gameplay from visuals, per-room visual modes, collision reference")

| Item | Where |
| --- | --- |
| Gameplay (colliders, nav blocking) created once, separated from visuals | `src/environment/EnvironmentBuilder.ts` |
| Visuals grouped into per-room / shared-wall / door-frame `VisualSet`s | `EnvironmentBuilder.ts` |
| 10 visual-only rooms tiling the 36 × 26 m footprint; all default to `procedural` | `src/environment/Rooms.ts` |
| Per-room switch `procedural` ↔ `glb`, collider overlay, `validate()` | `src/environment/RoomVisuals.ts` (`__game.environment`, `?glb=corridor`, `?colliders`) |
| Room asset manifest with the corridor entry `models/env/room_corridor.glb`, 60,000-triangle budget | `src/assets/RoomManifest.ts` |
| On-demand room GLB loading, meshopt supported | `AssetLoader.loadRoom()` |
| Collision reference for Blender / Unreal | `art/reference/collision_reference.glb`, `npm run export:collision` |
| 13 new e2e checks incl. gameplay fingerprint `598d34f6` (130 static colliders); 53/53 | `scripts/e2e.mjs` |

## The corridor room

- Room id `corridor`, rect x 0–36 m, z 5.25–8.75 m (to wall centre lines). Floor at Y = 0, ceiling at 4.2 m.
- Walls on grid rows 10 and 17 (faces at z 5.5 and 8.5). Door openings on the north side are at x 3.5–5.0, 11.5–13.0, 20.5–22.0
  and 30.0–31.5. South side: x 4.5–6.0, 17.0–19.5, 30.0–31.5. Exact volumes are in `REF_door_openings/` of the collision reference.
- The current procedural dressing (`propsCorridor()`) stays visible until the corridor is switched to `glb`.
  Corridor prop colliders (locker cabinet, trolley) stay regardless of mode, so the GLB must place matching visuals there.

## Room GLB acceptance checks that exist today

`RoomVisuals.validate()` runs in game. `node tools/blender/glb-report.mjs room_corridor.glb --room corridor` applies the
same rules offline:
- bounds within the room rect ±0.3 m, and Y within −0.5…5.5 m
- triangles ≤ `maxTriangles` (60,000)
- no `UCX_*`, `COL_*`, `REF_*` meshes
- the e2e fingerprint is unchanged after switching (`npm run test:e2e`)

## Still open

- [ ] **Acceptance criteria for the corridor art** (visual quality bar, review/sign-off). See `ENVIRONMENT_PIPELINE.md` U1/U2.
- [ ] Decisions U6–U13 in `ENVIRONMENT_PIPELINE.md` (source-file location, naming, textures, materials, draw-call budget, LODs, art direction).
- [ ] Produce `public/assets/models/env/room_corridor.glb` in Blender. This is the next production step and has **not been started**.
- [ ] Credit it in `docs/ASSET_CREDITS.md`, then decide whether to flip `ROOM_VISUALS.corridor` to `'glb'`.
