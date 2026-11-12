# Project guide

Conventions and decisions to keep future work consistent.

## Conventions

- **Units** are metres and seconds. Y is up. The player looks down **-Z** at yaw 0; enemies use
  forward = `(sin yaw, 0, cos yaw)`.
- **One source of truth for the level:** `environment/Level.ts` holds a 0.5 m cell grid. Walls, door
  openings, Rapier colliders and the AI nav grid are all derived from it. Add walls there, never as
  loose meshes.
- **Props** are placed in `EnvironmentBuilder` with `prop(x, z, ry, () => …)`. Call `solid(w, h, d)`
  inside to register a collider *and* block the nav grid in one step.
- **Static geometry is batched** per material within each room's visual set; repeated props use
  `InstancedMesh`. Do not add individual static meshes to the scene.
- **Gameplay and visuals are separate.** Colliders and nav blocking are created once and never depend on
  how a room is rendered. Rooms can switch between `procedural` and `glb` visuals; see
  `docs/ENVIRONMENT_PIPELINE.md`.
- **Tunables live in `src/config.ts`.** Every camera effect has its own value and can be zeroed.
  After changing `CFG.effects` at runtime call `game.post.applyConfig()`.
- **No runtime third-party URLs.** Everything is served from `public/assets`. Audio is synthesised.
- **Systems do not import each other sideways.** `core/FullGame.ts` is the only place that wires
  weapons, enemies, audio and HUD together (callbacks, not globals).
- **Test hooks** are on `window.__game.test` and only change behaviour with `?test` in the URL.

## Key decisions

- **Aim leads, camera follows.** Mouse input drives the aim direction instantly; the camera is pulled
  after it by damped springs. The weapon rig is attached to the aim, so the gun visibly moves first.
  Bullets travel along the aim direction from the camera position.
- **Procedural weapon and hand models.** Sketchfab was not reachable from the build environment, so
  the guns, hands and all weapon animation are generated in code (`weapons/WeaponModels.ts`).
- **Procedural PBR textures, baked offline.** Poly Haven and ambientCG were not reachable either.
  `scripts/bake-textures.mjs` generates tileable albedo / normal / ORM sets as JPGs. Swap in scanned
  sets by replacing the files in `public/assets/textures` (same names).
- **Enemy upper body is IK-driven.** The soldier model ships with idle / walk / run only. Hands are
  planted on the rifle with two-bone IK; hit flinch and death are procedural.
- **Shadow budget is one shadow map per frame:** the sun on even frames, one nearby fixture on odd.
- **Tone mapping is AgX in the post chain**, after the lens effect and before the sensor grade.

## Known limitations

See `docs/TEST_PLAN.md` (untested items) and `docs/ASSET_CREDITS.md` (placeholder-quality assets).
