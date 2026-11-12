import * as THREE from 'three';
import { CFG } from '../config';
import type { Input } from '../core/Input';
import type { PlayerPhysics } from './PlayerPhysics';

/** Turns input into movement: acceleration / deceleration, sprint, crouch, gravity. */
export class PlayerController {
  yaw = 0; pitch = 0;
  velocity = new THREE.Vector3();
  crouch = 0; // smoothed 0…1
  crouching = false; sprinting = false;
  sprintBlock = 0; // seconds during which sprint is suppressed (set when firing)
  private vy = 0; private wish = new THREE.Vector3(); private disp = new THREE.Vector3(); private moved = new THREE.Vector3();

  constructor(private input: Input, private physics: PlayerPhysics) {}

  update(dt: number, aiming: boolean, alive: boolean): void {
    const P = CFG.player, I = this.input;
    if (alive) {
      const m = I.consumeMouse();
      this.yaw -= m.dx * CFG.camera.sensitivity; this.pitch = THREE.MathUtils.clamp(this.pitch - m.dy * CFG.camera.sensitivity, -1.4, 1.4);
      if (I.pressed.has('KeyC')) this.crouching = !this.crouching;
    }
    const crouchHeld = this.crouching || I.down('ControlLeft');
    const f = alive ? (I.down('KeyW') ? 1 : 0) - (I.down('KeyS') ? 1 : 0) : 0, r = alive ? (I.down('KeyD') ? 1 : 0) - (I.down('KeyA') ? 1 : 0) : 0;
    this.sprintBlock -= dt;
    this.sprinting = alive && this.sprintBlock <= 0 && I.down('ShiftLeft') && f > 0 && !crouchHeld && !aiming && this.physics.grounded;
    if (this.sprinting) this.crouching = false;
    this.crouch += ((crouchHeld ? 1 : 0) - this.crouch) * Math.min(1, dt * 9);
    this.physics.setHalfHeight(THREE.MathUtils.lerp(P.standHalf, P.crouchHalf, this.crouch));

    const max = this.sprinting ? P.sprintSpeed : crouchHeld ? P.crouchSpeed : aiming ? P.aimSpeed : P.walkSpeed;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    this.wish.set(-sy * f + cy * r, 0, -cy * f - sy * r);
    if (this.wish.lengthSq() > 1) this.wish.normalize();
    this.wish.multiplyScalar(max * (f < 0 ? 0.8 : 1));
    // accelerate toward the wished velocity (different rates for speeding up and slowing down)
    const dvx = this.wish.x - this.velocity.x, dvz = this.wish.z - this.velocity.z; const dv = Math.hypot(dvx, dvz);
    if (dv > 1e-5) {
      const rate = (this.wish.lengthSq() > 0.01 ? P.accel : P.decel) * (this.physics.grounded ? 1 : 0.25) * dt;
      const k = Math.min(1, rate / dv); this.velocity.x += dvx * k; this.velocity.z += dvz * k;
    }
    this.vy = this.physics.grounded ? -2 : this.vy - P.gravity * dt;
    this.disp.set(this.velocity.x * dt, this.vy * dt, this.velocity.z * dt);
    this.physics.move(this.disp, this.moved);
    // feed real (post-collision) motion back so we don't keep pushing into walls
    if (dt > 1e-5) { this.velocity.x = this.moved.x / dt; this.velocity.z = this.moved.z / dt; }
  }

  reset(yaw: number): void { this.yaw = yaw; this.pitch = 0; this.velocity.set(0, 0, 0); this.vy = 0; this.crouch = 0; this.crouching = false; }
}
