import * as THREE from 'three';
import { CFG } from '../config';
import type { Input } from '../core/Input';
import type { CollisionWorld } from '../environment/CollisionWorld';
import { PlayerPhysics } from './PlayerPhysics';
import { PlayerController } from './PlayerController';

/** Player entity: health + the movement stack. */
export class Player {
  health = CFG.player.health;
  alive = true;
  physics: PlayerPhysics;
  controller: PlayerController;
  onDamage: ((amount: number, side: number) => void) | null = null;
  onDeath: (() => void) | null = null;
  private sinceHit = 99;
  private chest = new THREE.Vector3();

  constructor(input: Input, col: CollisionWorld, private spawn: { x: number; z: number; yaw: number }) {
    this.physics = new PlayerPhysics(col, spawn.x, spawn.z);
    this.controller = new PlayerController(input, this.physics);
    this.controller.yaw = spawn.yaw;
  }

  get feet(): THREE.Vector3 { return this.physics.feet; }
  /** Point enemies aim at / check visibility against. */
  get chestPos(): THREE.Vector3 { return this.chest.copy(this.physics.feet).setY(this.physics.feet.y + THREE.MathUtils.lerp(1.25, 0.75, this.controller.crouch)); }

  update(dt: number, aiming: boolean): void {
    this.controller.update(dt, aiming, this.alive);
    this.sinceHit += dt;
    if (this.alive && this.sinceHit > 7 && this.health < 50) this.health = Math.min(50, this.health + dt * 4); // slow recovery to half
  }

  /** from: world position of the shooter (for directional feedback). */
  damage(amount: number, from: THREE.Vector3): void {
    if (!this.alive) return;
    this.health = Math.max(0, this.health - amount); this.sinceHit = 0;
    const dx = from.x - this.feet.x, dz = from.z - this.feet.z; const yaw = this.controller.yaw;
    const side = Math.sign(dx * Math.cos(yaw) - dz * Math.sin(yaw)) || 1;
    this.onDamage?.(amount, side);
    if (this.health <= 0) { this.alive = false; this.onDeath?.(); }
  }

  respawn(): void { this.health = CFG.player.health; this.alive = true; this.sinceHit = 99; this.physics.teleport(this.spawn.x, this.spawn.z); this.controller.reset(this.spawn.yaw); }
}
