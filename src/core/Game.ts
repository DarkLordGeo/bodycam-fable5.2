import * as THREE from 'three';
import { CFG } from '../config';
import { AssetLoader } from '../assets/AssetLoader';
import { Renderer } from '../rendering/Renderer';
import { Lighting } from '../rendering/Lighting';
import { PostProcessing } from '../rendering/PostProcessing';
import { createMaterials } from '../rendering/Materials';
import { CollisionWorld } from '../environment/CollisionWorld';
import { Level } from '../environment/Level';
import { EnvironmentBuilder } from '../environment/EnvironmentBuilder';
import { BodyCameraController, type BodyState } from '../camera/BodyCameraController';
import { Player } from '../player/Player';
import { HUD } from '../ui/HUD';
import { Input } from './Input';
import { GameLoop } from './GameLoop';
import { GameState } from './GameState';

/** Composition root: owns every subsystem and runs the frame. */
export class Game {
  ready = false;
  cfg = CFG;
  state = new GameState();
  hud = new HUD();
  assets = new AssetLoader();
  input!: Input; renderer!: Renderer; post!: PostProcessing; lighting!: Lighting; col!: CollisionWorld; level!: Level;
  player!: Player; bodyCam!: BodyCameraController; loop!: GameLoop;
  time = 0;
  readonly testMode = new URLSearchParams(location.search).has('test');
  private body: BodyState = { feet: new THREE.Vector3(), velocity: new THREE.Vector3(), grounded: true, crouch: 0, sprinting: false, aiming: 0, inputYaw: 0, inputPitch: 0, dead: 0 };

  static async create(canvas: HTMLCanvasElement): Promise<Game> { const g = new Game(); await g.init(canvas); return g; }

  protected async init(canvas: HTMLCanvasElement): Promise<void> {
    this.input = new Input(canvas, this.testMode);
    this.renderer = new Renderer(canvas);
    if (this.testMode) this.renderer.adaptive = false;
    const [col] = await Promise.all([CollisionWorld.create(), this.assets.loadAll((f) => this.hud.setLoading(f))]);
    this.col = col;
    this.renderer.setEnvironment(this.assets.hdr);
    const mats = createMaterials(this.assets);
    this.level = new Level();
    const env = new EnvironmentBuilder(this.level, this.col, mats);
    this.renderer.scene.add(env.build());
    this.lighting = new Lighting(this.renderer.scene, env.lamps, mats, this.level);
    this.post = new PostProcessing(this.renderer);
    this.player = new Player(this.input, this.col, this.level.playerSpawn);
    this.bodyCam = new BodyCameraController(this.renderer.camera);
    this.bodyCam.reset(this.level.playerSpawn.yaw);
    this.initSystems(mats);
    this.col.step(1 / 60);

    this.state.onChange = (p) => this.hud.setPhase(p, this.hostilesLeft(), this.state.missionTime);
    this.input.onLockChange = (locked) => { if (locked && (this.state.phase === 'ready' || this.state.phase === 'paused')) this.state.set('playing'); else if (!locked && this.state.phase === 'playing') this.state.set('paused'); };
    document.getElementById('overlay')!.addEventListener('click', () => this.onOverlayClick());
    this.renderer.resize();
    this.loop = new GameLoop((dt, render) => this.tick(dt, render));
    this.state.set('ready');
    this.tick(1 / 60, true);
    this.loop.start();
    this.ready = true;
  }

  // --- extension points filled in by later systems ---
  protected initSystems(_mats: ReturnType<typeof createMaterials>): void {}
  protected updateSystems(_dt: number): void {}
  protected aimAmount(): number { return 0; }
  protected hudWeapon(): { name: string; mag: number; reserve: number } { return { name: '', mag: 0, reserve: 0 }; }
  hostilesLeft(): number { return 0; }
  protected resetSystems(): void {}

  private onOverlayClick(): void {
    if (this.state.ended) this.restart();
    this.input.requestLock();
  }

  restart(): void {
    this.player.respawn(); this.bodyCam.reset(this.level.playerSpawn.yaw); this.resetSystems();
    this.state.missionTime = 0; this.state.phase = 'ready'; this.hud.setPhase('ready', this.hostilesLeft(), 0);
    if (this.input.locked) this.state.set('playing');
  }

  tick(dt: number, render: boolean): void {
    const t0 = performance.now();
    const playing = this.state.phase === 'playing', sim = playing || this.state.phase === 'dead' || this.state.phase === 'won';
    const c = this.player.controller, b = this.body;
    if (sim) {
      this.time += dt; if (playing) this.state.missionTime += dt;
      this.player.update(dt, this.aimAmount() > 0.5);
    }
    b.feet.copy(this.player.feet); b.velocity.copy(c.velocity); b.grounded = this.player.physics.grounded; b.crouch = c.crouch; b.sprinting = c.sprinting;
    b.aiming = this.aimAmount(); b.inputYaw = c.yaw; b.inputPitch = c.pitch; b.dead += ((this.player.alive ? 0 : 1) - b.dead) * Math.min(1, dt * 3.5);
    if (sim || !this.ready) this.bodyCam.update(dt, b);
    if (sim) { this.updateSystems(dt); this.col.step(dt); }
    this.lighting.update(this.time, this.player.feet);
    this.post.update(dt, this.lighting.brightnessAt(this.renderer.camera.position), this.bodyCam.blur);
    const w = this.hudWeapon();
    this.hud.update(dt, this.player.health, w.name, w.mag, w.reserve, this.hostilesLeft(), this.state.missionTime);
    if (render) { this.renderer.renderer.info.reset(); this.post.render(dt); }
    this.input.endFrame();
    if (render) this.renderer.trackFrame(Math.max(this.loop?.frameMs ?? 16, performance.now() - t0));
  }

  /** Hooks used by automated tests and the screenshot script (active with ?test). */
  test = {
    start: () => { this.loop.manual = true; this.input.requestLock(); },
    step: (n: number, dt = 1 / 60) => { for (let i = 0; i < n; i++) this.tick(dt, i === n - 1); },
    view: (x: number, z: number, yawDeg: number, pitchDeg = 0) => { this.player.physics.teleport(x, z); this.player.controller.velocity.set(0, 0, 0); this.player.controller.yaw = THREE.MathUtils.degToRad(yawDeg); this.player.controller.pitch = THREE.MathUtils.degToRad(pitchDeg); this.col.step(1 / 60); this.bodyCam.reset(this.player.controller.yaw); },
    aimAt: (x: number, y: number, z: number) => { const c = this.renderer.camera.position; const dx = x - c.x, dy = y - c.y, dz = z - c.z; this.player.controller.yaw = Math.atan2(-dx, -dz); this.player.controller.pitch = Math.atan2(dy, Math.hypot(dx, dz)); },
    info: () => ({ calls: this.renderer.renderer.info.render.calls, tris: this.renderer.renderer.info.render.triangles, geos: this.renderer.renderer.info.memory.geometries, tex: this.renderer.renderer.info.memory.textures }),
  };
}
