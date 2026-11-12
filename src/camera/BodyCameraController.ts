import * as THREE from 'three';
import { CFG } from '../config';

export interface BodyState {
  feet: THREE.Vector3; // player feet position
  velocity: THREE.Vector3; // world-space horizontal velocity
  grounded: boolean;
  crouch: number; // 0 standing … 1 crouched
  sprinting: boolean;
  aiming: number; // 0…1
  inputYaw: number; inputPitch: number; // raw look input
  dead: number; // 0 alive … 1 collapsed
}

class Spring { x = 0; v = 0; step(target: number, omega: number, zeta: number, dt: number): number { this.v += (omega * omega * (target - this.x) - 2 * zeta * omega * this.v) * dt; this.x += this.v * dt; return this.x; } }

/**
 * Simulates a camera strapped to the player's upper body.
 * The *aim* direction (where the weapon points) responds instantly to the mouse; the camera is
 * dragged after it by damped springs, rolls with strafing/turning, bobs with each footfall,
 * dips on landing and is kicked by recoil — so it reads as mass attached to a moving torso.
 */
export class BodyCameraController {
  /** True aim direction (input + recoil). Weapons fire along this. */
  aimYaw = 0; aimPitch = 0;
  /** Screen-space motion vector of the last frame (uv units), used for motion blur. */
  blur = new THREE.Vector2();
  onFootstep: ((sprinting: boolean) => void) | null = null;
  stridePhase = 0;
  speedFactor = 0; // 0…1 smoothed movement amount, shared with the weapon rig

  private yaw = new Spring(); private pitch = new Spring(); private roll = new Spring(); private drop = new Spring();
  private recoilPitch = new Spring(); private recoilYaw = new Spring(); private kickRoll = new Spring(); private kickBack = new Spring();
  private flinchPitch = new Spring(); private flinchYaw = new Spring();
  private t = 0; private exertion = 0; private fov = CFG.camera.fov; private lastVel = new THREE.Vector3(); private wasGrounded = true; private smoothedY = 0; private init = false;
  private prevYaw = 0; private prevPitch = 0;
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(private camera: THREE.PerspectiveCamera) {}

  reset(yaw: number): void { for (const s of [this.yaw, this.pitch, this.roll, this.drop, this.recoilPitch, this.recoilYaw, this.kickRoll, this.kickBack, this.flinchPitch, this.flinchYaw]) { s.x = 0; s.v = 0; } this.yaw.x = yaw; this.prevYaw = yaw; this.init = false; this.exertion = 0; }

  /** Recoil impulse (radians/s style impulses; springs bring the aim back). */
  kick(pitch: number, yaw: number, roll: number, back: number): void { this.recoilPitch.v += pitch; this.recoilYaw.v += yaw; this.kickRoll.v += roll; this.kickBack.v += back; }
  /** Damage flinch. */
  flinch(strength: number, side: number): void { this.flinchPitch.v += strength * 2.2; this.flinchYaw.v += side * strength * 2.5; this.kickRoll.v += side * strength * 1.6; }

  update(dtIn: number, s: BodyState): void {
    const C = CFG.camera; const steps = Math.max(1, Math.ceil(dtIn / 0.012)); const dt = dtIn / steps;
    const speed = Math.hypot(s.velocity.x, s.velocity.z);
    const walkAmt = s.grounded ? Math.min(1, speed / CFG.player.walkSpeed) : 0;
    this.speedFactor += (walkAmt - this.speedFactor) * Math.min(1, dtIn * 8);
    this.exertion += ((s.sprinting ? 1 : 0) - this.exertion) * Math.min(1, dtIn * (s.sprinting ? 0.35 : 0.2));
    this.t += dtIn;

    // stride: phase advances with distance travelled; each PI is one footfall
    const stride = s.sprinting ? 1.05 : s.crouch > 0.5 ? 0.6 : 0.78;
    const prevPhase = this.stridePhase;
    if (s.grounded) this.stridePhase += (speed * dtIn * Math.PI) / stride;
    if (Math.floor(this.stridePhase / Math.PI) !== Math.floor(prevPhase / Math.PI) && speed > 0.6) { this.onFootstep?.(s.sprinting); this.drop.v -= s.sprinting ? 0.16 : 0.07; }

    // local-space velocity / acceleration → lean
    const cy = Math.cos(this.yaw.x), sy = Math.sin(this.yaw.x);
    const strafe = s.velocity.x * cy - s.velocity.z * sy; // +right
    const fwdAcc = (-(s.velocity.x - this.lastVel.x) * sy - (s.velocity.z - this.lastVel.z) * cy) / Math.max(dtIn, 1e-4);
    this.lastVel.copy(s.velocity);
    if (s.grounded && !this.wasGrounded) this.drop.v -= 0.9; // landing dip
    this.wasGrounded = s.grounded;

    for (let i = 0; i < steps; i++) {
      this.recoilPitch.step(0, 11, 0.62, dt); this.recoilYaw.step(0, 10, 0.6, dt); this.kickRoll.step(0, 16, 0.5, dt); this.kickBack.step(0, 22, 0.65, dt);
      this.flinchPitch.step(0, 13, 0.5, dt); this.flinchYaw.step(0, 12, 0.5, dt); this.drop.step(0, 15, 0.55, dt);
      this.aimYaw = s.inputYaw + this.recoilYaw.x; this.aimPitch = THREE.MathUtils.clamp(s.inputPitch + this.recoilPitch.x, -1.45, 1.45);
      const w = C.followFreq * (1 + s.aiming * 0.35);
      this.yaw.step(this.aimYaw, w, C.followDamping, dt); this.pitch.step(this.aimPitch, w, C.followDamping, dt);
      const rollTarget = THREE.MathUtils.clamp(-strafe * C.rollStrafe - this.yaw.v * C.rollTurn, -0.16, 0.16);
      this.roll.step(rollTarget, 9, 0.75, dt);
    }

    const bobMul = (s.sprinting ? C.sprintBobMul : 1) * (1 - s.crouch * (1 - C.crouchBobMul)) * (1 - s.aiming * 0.45) * this.speedFactor;
    const ph = this.stridePhase;
    const bobY = -Math.abs(Math.sin(ph)) * C.bobVertical * 2 * bobMul + C.bobVertical * bobMul;
    const bobX = Math.sin(ph) * C.bobLateral * bobMul;
    const breath = Math.sin(this.t * (1.5 + this.exertion * 2.2)) * C.breathing * (1 + this.exertion * 3.5);
    const n = (f: number, o: number) => Math.sin(this.t * f + o) * Math.sin(this.t * f * 0.37 + o * 2.1);
    const shake = C.microShake * (1 + this.speedFactor * 2 + this.exertion * 2);

    const height = THREE.MathUtils.lerp(THREE.MathUtils.lerp(C.height, C.crouchHeight, s.crouch), 0.28, s.dead * s.dead);
    if (!this.init) { this.smoothedY = s.feet.y; this.init = true; }
    this.smoothedY += (s.feet.y - this.smoothedY) * Math.min(1, dtIn * 14);

    const yaw = this.yaw.x + this.flinchYaw.x + Math.sin(ph) * 0.006 * bobMul + n(2.3, 1) * shake;
    const pitch = this.pitch.x + this.flinchPitch.x + breath + Math.cos(ph * 2) * 0.004 * bobMul - (s.sprinting ? 0.045 * this.speedFactor : 0) + THREE.MathUtils.clamp(-fwdAcc * 0.0012, -0.03, 0.03) + n(1.7, 4) * shake;
    const roll = s.dead * 1.15 + this.roll.x + this.kickRoll.x + Math.sin(ph) * C.bobRoll * bobMul * (s.sprinting ? 1.6 : 1) + n(1.3, 7) * shake * 0.7;
    this.euler.set(pitch, yaw, roll);
    this.camera.quaternion.setFromEuler(this.euler);

    const fx = -Math.sin(this.yaw.x), fz = -Math.cos(this.yaw.x);
    const off = C.forwardOffset - this.kickBack.x;
    this.camera.position.set(s.feet.x + fx * off + cy * bobX, this.smoothedY + height + bobY + this.drop.x + breath * 0.6, s.feet.z + fz * off - sy * bobX);

    const fovTarget = THREE.MathUtils.lerp(s.sprinting && this.speedFactor > 0.5 ? C.sprintFov : C.fov, C.aimFov, s.aiming);
    if (Math.abs(fovTarget - this.fov) > 0.01) { this.fov += (fovTarget - this.fov) * Math.min(1, dtIn * 7); this.camera.fov = this.fov; this.camera.updateProjectionMatrix(); }

    const vfov = THREE.MathUtils.degToRad(this.fov), hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    this.blur.set(THREE.MathUtils.clamp((yaw - this.prevYaw) / hfov, -0.03, 0.03), THREE.MathUtils.clamp((pitch - this.prevPitch) / vfov, -0.03, 0.03));
    this.prevYaw = yaw; this.prevPitch = pitch;
  }
}
