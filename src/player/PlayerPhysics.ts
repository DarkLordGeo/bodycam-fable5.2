import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CFG } from '../config';
import { type CollisionWorld, groups, GROUP_PLAYER, GROUP_STATIC, GROUP_ENEMY } from '../environment/CollisionWorld';

/** Rapier kinematic character controller: capsule sweep against the real collision world. */
export class PlayerPhysics {
  grounded = true;
  feet = new THREE.Vector3();
  private body: RAPIER.RigidBody; private collider: RAPIER.Collider; private kcc: RAPIER.KinematicCharacterController;
  private half = CFG.player.standHalf;
  private readonly filter = groups(GROUP_PLAYER, GROUP_STATIC | GROUP_ENEMY);

  constructor(private col: CollisionWorld, x: number, z: number) {
    const P = CFG.player; const w = col.world;
    this.body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, this.half + P.radius + 0.02, z));
    this.collider = w.createCollider(RAPIER.ColliderDesc.capsule(this.half, P.radius).setCollisionGroups(this.filter), this.body);
    this.kcc = w.createCharacterController(0.02);
    this.kcc.enableAutostep(0.28, 0.2, true); this.kcc.enableSnapToGround(0.25); this.kcc.setMaxSlopeClimbAngle((50 * Math.PI) / 180); this.kcc.setSlideEnabled(true);
    this.feet.set(x, 0, z);
  }

  /** Attempts the displacement; returns what was actually applied after collisions. */
  move(desired: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    this.kcc.computeColliderMovement(this.collider, desired, undefined, this.filter);
    const m = this.kcc.computedMovement(); this.grounded = this.kcc.computedGrounded();
    const t = this.body.translation();
    const nx = t.x + m.x, ny = t.y + m.y, nz = t.z + m.z;
    this.body.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
    this.feet.set(nx, ny - this.half - CFG.player.radius, nz);
    return out.set(m.x, m.y, m.z);
  }

  /** Resizes the capsule for crouching while keeping the feet planted. */
  setHalfHeight(half: number): void {
    if (Math.abs(half - this.half) < 1e-4) return;
    const t = this.body.translation(); const y = t.y + (half - this.half);
    this.half = half; this.collider.setHalfHeight(half);
    this.body.setTranslation({ x: t.x, y, z: t.z }, true); this.body.setNextKinematicTranslation({ x: t.x, y, z: t.z });
  }

  teleport(x: number, z: number): void {
    const y = this.half + CFG.player.radius + 0.02;
    this.body.setTranslation({ x, y, z }, true); this.body.setNextKinematicTranslation({ x, y, z }); this.feet.set(x, 0, z); this.grounded = true;
  }
}
