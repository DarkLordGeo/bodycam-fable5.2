import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { EnemyAnimations, type Locomotion } from './EnemyAnimations';
import type { P2 } from './Navigation';
import type { EnemySpawn } from '../environment/Level';
import { type CollisionWorld, groups, GROUP_ENEMY, GROUP_PLAYER } from '../environment/CollisionWorld';

export type AIState = 'idle' | 'patrol' | 'investigate' | 'detect' | 'engage' | 'reposition' | 'dead';
export interface Traits { reaction: number; accuracy: number; walk: number; run: number; burst: [number, number]; pause: [number, number]; repositionAfter: number; turn: number }
const TRAITS: Record<EnemySpawn['trait'], Traits> = {
  aggressive: { reaction: 0.42, accuracy: 0.46, walk: 1.55, run: 4.3, burst: [4, 7], pause: [0.55, 1.0], repositionAfter: 2, turn: 7 },
  steady: { reaction: 0.6, accuracy: 0.55, walk: 1.35, run: 3.9, burst: [3, 5], pause: [0.8, 1.4], repositionAfter: 4, turn: 5.5 },
  cautious: { reaction: 0.8, accuracy: 0.5, walk: 1.2, run: 4.0, burst: [2, 4], pause: [1.0, 1.8], repositionAfter: 2, turn: 5 },
};
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** One hostile: model, animation, kinematics and per-agent AI memory. Decisions live in EnemyAI. */
export class Enemy {
  readonly root = new THREE.Group();
  readonly anim: EnemyAnimations;
  readonly traits: Traits;
  pos = new THREE.Vector3(); yaw = 0; health = 100;
  state: AIState = 'idle'; stateT = 0;
  // memory / perception
  sees = false; seeT = 0; lostT = 0; lastKnown = new THREE.Vector3(); alerted = false; perceiveT = 0;
  // movement
  justArrived = false; lookT = 0;
  path: P2[] = []; pathI = 0; speed = 0; moving = false; repathT = 0; patrolI = 0; waitT = 0; lookYaw = 0; stagger = 0; strideD = 0;
  // combat
  ready = 0; wantReady = 0; burstLeft = 0; shotT = 0; pauseT = 0; burstsDone = 0; firstBurst = true; aimDir = new THREE.Vector3(0, 0, 1); muzzle = new THREE.Vector3();
  // reactions
  flinch = 0; flinchV = 0; flinchAxis = new THREE.Vector3(1, 0, 0); deathT = 0; fallAxis = new THREE.Vector3(1, 0, 0); fallDir = new THREE.Vector3(); private landed = false;
  private body: RAPIER.RigidBody; private collider: RAPIER.Collider; private rifleFrom = new THREE.Vector3(); private rifleQ = new THREE.Quaternion(); private qYaw = new THREE.Quaternion(); private qFall = new THREE.Quaternion();

  constructor(public readonly id: number, public readonly spawn: EnemySpawn, model: THREE.Object3D, clips: THREE.AnimationClip[], public readonly rifle: THREE.Object3D, private col: CollisionWorld, private scene: THREE.Scene) {
    this.traits = TRAITS[spawn.trait];
    this.root.add(model); scene.add(this.root, rifle);
    model.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; } });
    rifle.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.frustumCulled = false; } });
    this.anim = new EnemyAnimations(model, clips, rifle);
    this.body = col.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    this.collider = col.world.createCollider(RAPIER.ColliderDesc.capsule(0.55, 0.3).setCollisionGroups(groups(GROUP_ENEMY, GROUP_PLAYER)), this.body);
    this.reset();
  }

  get alive(): boolean { return this.state !== 'dead'; }
  get eye(): THREE.Vector3 { return this._eye.set(this.pos.x, 1.62, this.pos.z); }
  private _eye = new THREE.Vector3();

  reset(): void {
    this.pos.set(this.spawn.x, 0, this.spawn.z); this.yaw = this.spawn.yaw; this.lookYaw = this.yaw; this.health = 100; this.state = 'idle'; this.stateT = 0; this.waitT = 1 + this.id * 0.7;
    this.sees = false; this.seeT = 0; this.lostT = 0; this.alerted = false; this.path = []; this.pathI = 0; this.moving = false; this.patrolI = 0; this.ready = 0; this.wantReady = 0; this.burstLeft = 0; this.burstsDone = 0; this.firstBurst = true;
    this.flinch = 0; this.flinchV = 0; this.deathT = 0; this.stagger = 0; this.landed = false;
    this.collider.setEnabled(true); this.root.visible = true; this.rifle.visible = true;
    this.root.quaternion.setFromAxisAngle(EnemyAnimations.UP, this.yaw); this.root.position.copy(this.pos);
    this.anim.setLocomotion('Idle');
    this.syncBody();
  }
  private syncBody(): void { this.body.setNextKinematicTranslation({ x: this.pos.x, y: 0.87, z: this.pos.z }); }

  setState(s: AIState): void { if (this.state !== s) { this.state = s; this.stateT = 0; } }
  setPath(p: P2[] | null): boolean { if (!p || !p.length) { this.path = []; this.moving = false; return false; } this.path = p; this.pathI = 0; this.moving = true; return true; }
  stop(): void { this.moving = false; this.path = []; }
  /** Turns toward a yaw at the agent's turn rate; returns remaining angle. */
  face(target: number, dt: number, rate = this.traits.turn): number { const d = wrap(target - this.yaw); this.yaw += THREE.MathUtils.clamp(d, -rate * dt, rate * dt); return Math.abs(d); }
  yawTo(x: number, z: number): number { return Math.atan2(x - this.pos.x, z - this.pos.z); }

  /** Body shot / head shot. Returns true if this killed the enemy. */
  damage(amount: number, dir: THREE.Vector3): boolean {
    if (!this.alive) return false;
    this.health -= amount; this.flinchV += 5 + amount * 0.06; this.flinchAxis.set(dir.z, 0, -dir.x).normalize(); this.stagger = 0.28;
    if (this.health > 0) return false;
    this.state = 'dead'; this.stateT = 0; this.deathT = 0; this.stop(); this.collider.setEnabled(false);
    this.fallDir.set(dir.x, 0, dir.z).normalize(); if (this.fallDir.lengthSq() < 0.5) this.fallDir.set(0, 0, 1);
    this.fallAxis.crossVectors(EnemyAnimations.UP, this.fallDir).normalize();
    this.rifleFrom.copy(this.rifle.position); this.rifleQ.copy(this.rifle.quaternion);
    return true;
  }

  /** Advances along the current path. Returns true on arrival. */
  private followPath(dt: number, walkable: (x: number, z: number) => boolean): boolean {
    if (!this.moving) return false;
    const t = this.path[this.pathI]; const dx = t.x - this.pos.x, dz = t.z - this.pos.z; const d = Math.hypot(dx, dz);
    if (d < 0.22) { if (++this.pathI >= this.path.length) { this.moving = false; return true; } return false; }
    const step = Math.min(d, this.speed * dt * (this.stagger > 0 ? 0.15 : 1)); const nx = this.pos.x + (dx / d) * step, nz = this.pos.z + (dz / d) * step;
    if (walkable(nx, nz) || !walkable(this.pos.x, this.pos.z)) { this.pos.x = nx; this.pos.z = nz; this.strideD += step; } else this.repathT = 0;
    this.lookYaw = Math.atan2(dx, dz);
    return false;
  }

  /** Kinematics + animation, after EnemyAI has decided what to do this frame. onStep fires per footfall. */
  integrate(dt: number, walkable: (x: number, z: number) => boolean, onStep: () => void, onBodyFall: () => void): boolean {
    if (this.state === 'dead') { this.updateDeath(dt, onBodyFall); return false; }
    this.stagger -= dt; this.stateT += dt;
    const arrived = this.followPath(dt, walkable);
    if (this.moving && this.wantReady < 0.5) this.face(this.lookYaw, dt);
    if (this.strideD > (this.speed > 2.5 ? 1.25 : 0.78)) { this.strideD = 0; onStep(); }
    this.ready += (this.wantReady - this.ready) * Math.min(1, dt * 7);
    this.flinchV += (-this.flinch * 160 - this.flinchV * 13) * dt; this.flinch += this.flinchV * dt;
    const loco: Locomotion = !this.moving || this.stagger > 0 || this.speed < 0.1 ? 'Idle' : this.speed > 2.6 ? 'Run' : 'Walk';
    this.anim.setLocomotion(loco, loco === 'Walk' ? this.speed / 1.45 : loco === 'Run' ? this.speed / 4.0 : 1);
    this.root.position.copy(this.pos); this.root.quaternion.setFromAxisAngle(EnemyAnimations.UP, this.yaw);
    this.syncBody();
    this.anim.update(dt, { yaw: this.yaw, aimDir: this.aimDir, ready: this.ready, flinch: this.flinch, flinchAxis: this.flinchAxis, armed: true, lean: 0, leanAxis: this.fallAxis });
    this.rifle.updateMatrixWorld(true); this.muzzle.set(0, 0.045, -0.74).applyMatrix4(this.rifle.matrixWorld);
    return arrived;
  }

  private updateDeath(dt: number, onBodyFall: () => void): void {
    if (this.deathT > 3) return; // settled: nothing left to animate
    this.deathT += dt; const t = Math.min(1, this.deathT / 0.85);
    let ang = t * t * 1.5; if (t >= 1) { const b = Math.min(1, (this.deathT - 0.85) / 0.25); ang = 1.5 - Math.sin(b * Math.PI) * 0.05; if (!this.landed) { this.landed = true; onBodyFall(); } }
    this.qYaw.setFromAxisAngle(EnemyAnimations.UP, this.yaw); this.qFall.setFromAxisAngle(this.fallAxis, ang);
    this.root.quaternion.copy(this.qFall).multiply(this.qYaw);
    const sink = Math.sin(Math.min(1, t) * Math.PI) * 0.12; // knees buckle: drop the hips mid-fall
    this.root.position.set(this.pos.x - this.fallDir.x * sink * 1.5, Math.sin(ang) * 0.16 - sink * 0.6 * (1 - t), this.pos.z - this.fallDir.z * sink * 1.5);
    this.anim.setLocomotion('Idle', 0.25);
    this.anim.update(dt * (1 - t), { yaw: this.yaw, aimDir: this.aimDir, ready: 0, flinch: 0, flinchAxis: this.flinchAxis, armed: false, lean: -Math.sin(Math.min(1, this.deathT / 0.6) * Math.PI) * 0.45 - t * 0.12, leanAxis: this.fallAxis });
    // rifle drops beside the body
    const r = Math.min(1, this.deathT / 0.55), g = r * r;
    this.rifle.position.set(this.rifleFrom.x + this.fallDir.x * 0.5 * r - this.fallAxis.x * 0.35 * r, THREE.MathUtils.lerp(this.rifleFrom.y, 0.035, g), this.rifleFrom.z + this.fallDir.z * 0.5 * r - this.fallAxis.z * 0.35 * r);
    this.rifle.quaternion.copy(this.rifleQ).slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.yaw + 0.8, Math.PI / 2)), g);
  }
}
