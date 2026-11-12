import { Game } from './Game';
import { AudioManager } from '../audio/AudioManager';
import { CombatEffects } from '../weapons/Effects';
import { WeaponManager } from '../weapons/WeaponManager';
import { createGunMaterials } from '../weapons/WeaponModels';
import { EnemyManager } from '../enemies/EnemyManager';

/** Game + combat systems (weapons, enemies, audio) and the mission rules. */
export class FullGame extends Game {
  audio = new AudioManager();
  fx!: CombatEffects; weapons!: WeaponManager; enemies!: EnemyManager;
  private endTimer = 0;

  static async create(canvas: HTMLCanvasElement): Promise<FullGame> { const g = new FullGame(); await g.init(canvas); return g; }

  protected override initSystems(): void {
    const scene = this.renderer.scene, gm = createGunMaterials(this.assets);
    this.fx = new CombatEffects(scene);
    this.enemies = new EnemyManager(scene, this.assets, this.level, this.col, gm, this.player, this.audio, this.fx);
    this.weapons = new WeaponManager(scene, gm, { camera: this.renderer.camera, bodyCam: this.bodyCam, player: this.player, input: this.input, col: this.col, fx: this.fx, audio: this.audio, post: this.post, hud: this.hud, targets: this.enemies });
    this.fx.onShellBounce = (p) => this.audio.shell(p);
    this.bodyCam.onFootstep = (sprint) => {
      this.audio.footstep(sprint);
      if (this.player.controller.crouch < 0.5) this.enemies.alert(this.player.feet, sprint ? 9 : 3.5); // crouch-walking is silent
    };
    this.player.onDamage = (amount, side) => { this.hud.damageFlash(amount); this.bodyCam.flinch(0.5 + amount / 30, side); this.audio.hurt(); };
    this.player.onDeath = () => { this.endTimer = 1.6; };
    this.enemies.onKill = (_e, remaining) => { this.hud.hint(remaining ? `HOSTILE DOWN — ${remaining} REMAINING` : 'ALL HOSTILES DOWN', 2.4); if (!remaining) this.endTimer = 2.6; };
    const unlockAudio = () => this.audio.init();
    document.addEventListener('pointerdown', unlockAudio); document.addEventListener('keydown', unlockAudio);
  }

  protected override updateSystems(dt: number): void {
    const playing = this.state.phase === 'playing';
    this.weapons.update(dt, playing);
    this.enemies.update(dt);
    this.fx.update(dt);
    this.audio.update(dt, this.renderer.camera, this.player.health, this.player.alive);
    if (playing && this.endTimer > 0 && (this.endTimer -= dt) <= 0) {
      this.state.set(this.player.alive ? 'won' : 'dead');
      if (!this.testMode) document.exitPointerLock();
    }
  }

  protected override aimAmount(): number { return this.weapons?.aim ?? 0; }
  protected override hudWeapon(): { name: string; mag: number; reserve: number } { const w = this.weapons.current; return { name: w.stats.name, mag: w.mag, reserve: w.reserve }; }
  override hostilesLeft(): number { return this.enemies?.aliveCount ?? 0; }
  protected override resetSystems(): void { this.endTimer = 0; this.weapons.reset(); this.enemies.reset(); this.fx.reset(); }
}
