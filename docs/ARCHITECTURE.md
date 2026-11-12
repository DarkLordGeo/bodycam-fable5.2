# Architecture

```
src/
  main.ts                    entry: creates FullGame
  config.ts                  all tunables (camera, effects, player, quality)
  core/      Game.ts         composition root + frame order      FullGame.ts  combat wiring, mission rules
             GameLoop.ts     rAF loop                            GameState.ts mission phases      Input.ts
  rendering/ Renderer.ts     WebGL renderer, dynamic resolution  Lighting.ts  sun, fixtures, light shafts
             PostProcessing.ts  composer + auto exposure         Materials.ts PBR materials, world-space grime
  camera/    BodyCameraController.ts  body-mounted camera rig    CameraEffects.ts  lens + sensor shaders
  player/    Player.ts  PlayerController.ts  PlayerPhysics.ts (Rapier character controller)
  weapons/   WeaponManager.ts  WeaponBase.ts  Pistol.ts  AssaultRifle.ts
             WeaponModels.ts (procedural models)  WeaponAnimations.ts  Effects.ts (pooled VFX)
  enemies/   EnemyManager.ts  Enemy.ts  EnemyAI.ts (state machine)  EnemyAnimations.ts (clips + IK)
             Navigation.ts (grid A*)
  environment/ Level.ts (grid layout)  EnvironmentBuilder.ts  CollisionWorld.ts (Rapier wrapper)
  audio/     AudioManager.ts (synthesised, HRTF, convolution reverb)
  ui/        HUD.ts
  assets/    AssetLoader.ts
```

## Frame order (`Game.tick`)

1. `Player.update` – input → velocity → Rapier character controller.
2. `BodyCameraController.update` – springs, bob, roll, recoil → camera transform.
3. `FullGame.updateSystems` – weapons (rig, firing), enemies (AI, movement, animation), VFX, audio.
4. `CollisionWorld.step`.
5. Lighting (flicker, shadow budget), post (auto exposure, motion-blur vector), HUD, render.

## Camera

Aim yaw/pitch = mouse input + recoil springs. Camera yaw/pitch follow the aim through a damped
spring; roll responds to strafe speed and turn rate; position adds stride bob (phase advances with
distance travelled), footfall and landing dips, breathing and low-amplitude noise. The post chain adds
barrel distortion, edge chromatic aberration, vignette, 5-tap motion blur from the camera's angular
motion, edge softness, auto exposure, AgX tone mapping, then grain / saturation / contrast.

## Enemy AI

States: `idle → patrol → investigate → detect → engage ⇄ reposition → dead`.
Perception runs at 10 Hz: field-of-view cone + Rapier line-of-sight ray, accumulated over a reaction
time that scales with distance. Hearing: gunshots, uncrouched footsteps, ally call-outs.
Three trait sets (aggressive / steady / cautious) change reaction time, accuracy, burst length,
speeds and how reposition points are scored. Pathfinding is 8-way A* on the 0.5 m grid with string
pulling; agents never leave walkable cells.

## Performance measures

Merged static geometry, instanced props, pooled VFX, weapon models merged per material, one shadow
map per frame, dynamic resolution scaling (0.55–1.0), MSAA capped at 4, textures ≤ 1K.
