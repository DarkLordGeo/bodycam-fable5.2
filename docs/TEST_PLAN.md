# Test plan and results

## Automated end-to-end test

`npm run test:e2e` (script: `scripts/e2e.mjs`) drives the production build in headless Chrome with
real keyboard and mouse events and steps the simulation deterministically.

Last run: **53 / 53 checks passed** (the original 40 plus 13 environment-pipeline checks) against `vite preview` of the production build.

| Area | Checks |
| --- | --- |
| Loading | reaches ready state; no console errors; no failed requests; no external runtime requests |
| Pointer lock | click-to-enter acquires pointer lock and starts the mission |
| Movement | walk, sprint speed, deceleration, crouch height, mouse look with camera inertia |
| Collision | stopped by the south wall and the west wall; stays grounded |
| Weapons | rifle auto fire, impact decals, recoil, aim down sights, reload from reserve, switch to pistol, semi-auto fire, switch back |
| Enemies | enemy model in the scene; patrol; never inside walls or props; line-of-sight detection; detect → engage; player takes damage |
| Mission | hostile killed with weapon fire; all AI states exercised; win state and overlay; restart resets everything; player death, death overlay, restart after death |
| Environment pipeline | gameplay fingerprint equals the pre-refactor baseline; all rooms default to procedural; corridor switches to GLB and back; switching, overlay and export leave colliders and nav unchanged; no duplicate colliders; wall collision and AI path still work in GLB mode; collision reference exports as binary glTF |
| Rendering | draw-call count within budget; no console errors during play |

Also executed: `npm install`, `tsc --noEmit`, `vite build`.

## Not tested – verify by hand

- **Frame rate on a real GPU.** The build environment only had software WebGL (SwiftShader), so
  smoothness at 1080p is unmeasured. Indicators from the test run: roughly 700–1400 draw calls and
  0.6–1.2 M triangles per frame including the shadow pass. If it is slow, lower
  `CFG.quality.shadowMap` / `msaa`; dynamic resolution also engages automatically.
- **Audio.** The synthesis code runs without errors, but nobody has listened to it.
- **Feel.** Camera inertia, recoil and AI difficulty were tuned from screenshots and numbers, not
  from hands-on play.
- **Browsers other than Chrome.**

## Manual checklist

1. Load the page, click, confirm the pointer locks and the HUD appears.
2. Walk into walls, door frames, crates and barrels; nothing should be passable.
3. Fire both weapons, empty a magazine, reload, switch mid-reload.
4. Let a patrol see you; confirm they turn, raise the rifle, then fire.
5. Fire in the loading bay and confirm others come to investigate.
6. Kill the hostile; confirm FACILITY SECURE and restart.
7. Die; confirm SIGNAL LOST and restart.
