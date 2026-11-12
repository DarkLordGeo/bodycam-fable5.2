import * as THREE from 'three';
import type { BodyCameraController } from '../camera/BodyCameraController';
import type { Player } from '../player/Player';
import type { Input } from '../core/Input';
import type { CollisionWorld } from '../environment/CollisionWorld';
import type { AudioManager } from '../audio/AudioManager';
import type { PostProcessing } from '../rendering/PostProcessing';
import type { HUD } from '../ui/HUD';
import type { CombatEffects } from './Effects';
import type { GunMats } from './WeaponModels';
import type { WeaponBase } from './WeaponBase';
import { Pistol } from './Pistol';
import { AssaultRifle } from './AssaultRifle';
import { Spring } from './WeaponAnimations';

export interface BulletHit { dist: number; point: THREE.Vector3; apply(damage: number, headMul: number, dir: THREE.Vector3): void }
export interface BulletTargets { hitscan(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): BulletHit | null; alert(pos: THREE.Vector3, radius: number): void }
export interface WeaponDeps { camera: THREE.PerspectiveCamera; bodyCam: BodyCameraController; player: Player; input: Input; col: CollisionWorld; fx: CombatEffects; audio: AudioManager; post: PostProcessing; hud: HUD; targets: BulletTargets }

/**
 * Owns the two weapons and the first-person rig. The rig follows the *aim* direction (not the lagging
 * camera), so the weapon visibly leads the view. Handles input, hitscan fire, recoil, sway, bob,
 * sprint/aim poses, wall avoidance and switching.
 */
export class WeaponManager {
  readonly rig = new THREE.Group();
  readonly weapons: WeaponBase[];
  index = 0;
  aim = 0;
  shotsFired = 0;
  private aimSpring = new Spring(17, 0.9); private sprintSpring = new Spring(11, 0.85); private retract = new Spring(14, 1);
  private kickZ = new Spring(20, 0.55); private kickRot = new Spring(18, 0.42); private swayY = new Spring(12, 0.6); private swayX = new Spring(12, 0.6); private swayRoll = new Spring(10, 0.55);
  private switchT = 0; private switchPhase: 0 | 1 | 2 = 0; private pending = 0; private heat = 0; private prevYaw = 0; private prevPitch = 0; private t = 0; private wasAiming = false;
  private dir = new THREE.Vector3(); private origin = new THREE.Vector3(); private q = new THREE.Quaternion(); private e = new THREE.Euler(0, 0, 0, 'YXZ'); private v = new THREE.Vector3(); private v2 = new THREE.Vector3(); private mq = new THREE.Quaternion();

  constructor(scene: THREE.Scene, mats: GunMats, private d: WeaponDeps) {
    this.weapons = [new AssaultRifle(mats), new Pistol(mats)];
    this.weapons.forEach((w, i) => { this.rig.add(w.group); w.group.visible = i === 0; });
    const fill = new THREE.PointLight(0xfff1e0, 0.35, 1.5, 2); fill.position.set(0, 0.12, -0.05); this.rig.add(fill); // faint bounce so the weapon never reads as a silhouette
    scene.add(this.rig);
  }
  get current(): WeaponBase { return this.weapons[this.index]; }

  reset(): void {
    this.weapons.forEach((w, i) => { w.reset(); w.group.visible = i === 0; }); this.index = 0; this.switchPhase = 0; this.aim = 0; this.heat = 0; this.shotsFired = 0;
    for (const s of [this.aimSpring, this.sprintSpring, this.retract, this.kickZ, this.kickRot, this.swayX, this.swayY, this.swayRoll]) s.reset();
    this.prevYaw = this.d.bodyCam.aimYaw; this.prevPitch = this.d.bodyCam.aimPitch;
  }

  private requestSwitch(i: number): void {
    if (i === this.index || this.switchPhase !== 0) return;
    this.current.cancelReload(); this.pending = i; this.switchPhase = 1; this.switchT = 0; this.d.audio.mech('switch');
  }

  update(dtIn: number, active: boolean): void {
    const { input, player, bodyCam, camera } = this.d; const w = this.current, c = player.controller; const dt = Math.min(dtIn, 0.033);
    this.t += dt;
    const alive = player.alive && active;
    // ---- input ----
    if (alive) {
      if (input.pressed.has('Digit1')) this.requestSwitch(0); if (input.pressed.has('Digit2')) this.requestSwitch(1);
      if (input.pressed.has('KeyQ') || input.wheel !== 0) this.requestSwitch(1 - this.index);
      if (input.pressed.has('KeyR') && this.switchPhase === 0) { if (w.canReload) { w.startReload(); this.d.hud.hint('RELOADING', w.stats.reloadTime); } else if (w.reserve === 0 && w.mag < w.stats.magSize) this.d.hud.hint('NO RESERVE AMMO'); }
    }
    const wantFire = alive && (w.stats.auto ? input.buttons[0] : input.pressed.has('Mouse0'));
    if (wantFire) c.sprintBlock = 0.35;
    const aiming = alive && input.buttons[2] && !w.reloading && this.switchPhase === 0 && !c.sprinting;
    if (aiming && !this.wasAiming) this.d.audio.mech('aim'); this.wasAiming = aiming;
    this.aim = THREE.MathUtils.clamp(this.aimSpring.step(aiming ? 1 : 0, dt), 0, 1);
    const sprintT = THREE.MathUtils.clamp(this.sprintSpring.step(c.sprinting && !w.reloading ? 1 : 0, dt), 0, 1);

    // ---- switching ----
    let drop = 0;
    if (this.switchPhase === 1) { this.switchT += dt / 0.2; drop = Math.min(1, this.switchT); if (this.switchT >= 1) { w.group.visible = false; this.index = this.pending; this.current.group.visible = true; this.switchPhase = 2; this.switchT = 0; this.d.hud.hint(this.current.stats.name, 1.2); } }
    else if (this.switchPhase === 2) { this.switchT += dt / 0.28; drop = 1 - Math.min(1, this.switchT); drop *= drop; if (this.switchT >= 1) this.switchPhase = 0; }
    const cur = this.current;
    cur.update(dt, (e) => this.d.audio.mech(e));

    // ---- firing ----
    if (wantFire && this.switchPhase === 0 && sprintT < 0.35 && cur.cooldown <= 0 && !cur.reloading) {
      if (cur.mag > 0) this.fire(cur);
      else if (input.pressed.has('Mouse0')) { this.d.audio.mech('dry'); cur.cooldown = 0.2; if (cur.canReload) { cur.startReload(); this.d.hud.hint('RELOADING', cur.stats.reloadTime); } else this.d.hud.hint('EMPTY'); }
    }
    this.heat = Math.max(0, this.heat - dt * 1.6);

    // ---- rig: positioned at the camera, oriented along the true aim ----
    const yawRate = (bodyCam.aimYaw - this.prevYaw) / dt, pitchRate = (bodyCam.aimPitch - this.prevPitch) / dt; this.prevYaw = bodyCam.aimYaw; this.prevPitch = bodyCam.aimPitch;
    this.rig.position.copy(camera.position); this.e.set(bodyCam.aimPitch, bodyCam.aimYaw, 0); this.rig.quaternion.setFromEuler(this.e);
    const sy = this.swayY.step(THREE.MathUtils.clamp(-yawRate * 0.012, -0.09, 0.09), dt), sx = this.swayX.step(THREE.MathUtils.clamp(-pitchRate * 0.012, -0.07, 0.07), dt);
    const sr = this.swayRoll.step(THREE.MathUtils.clamp(yawRate * 0.02, -0.12, 0.12) - (c.velocity.x * Math.cos(c.yaw) - c.velocity.z * Math.sin(c.yaw)) * 0.012, dt);
    // wall avoidance: pull the weapon in / muzzle up when something is right in front
    this.dir.set(0, 0, -1).applyQuaternion(this.rig.quaternion);
    const need = cur.stats.length + 0.42; const wall = this.d.col.raycast(camera.position, this.dir, need);
    const ret = this.retract.step(wall ? THREE.MathUtils.clamp((need - wall.dist) / 0.5, 0, 1) : 0, dt);
    const kz = this.kickZ.step(0, dt), kr = this.kickRot.step(0, dt);
    const ph = bodyCam.stridePhase, bob = bodyCam.speedFactor * (1 - this.aim * 0.75) * (c.sprinting ? 1.9 : 1);
    const idle = 1 - this.aim * 0.8, br = Math.sin(this.t * 1.5);
    const a = this.aim * this.aim * (3 - 2 * this.aim);
    const g = cur.group;
    g.position.lerpVectors(cur.hip.pos, cur.ads.pos, a).lerp(cur.sprint.pos, sprintT);
    g.position.x += Math.sin(ph) * 0.007 * bob + Math.sin(this.t * 0.7) * 0.0015 * idle + cur.animPos.x + sy * 0.25;
    g.position.y += -Math.abs(Math.sin(ph)) * 0.011 * bob + br * 0.0022 * idle + cur.animPos.y - drop * 0.32 - ret * 0.05 - sx * 0.2;
    g.position.z += kz * 0.04 + cur.animPos.z + ret * 0.2 + Math.cos(ph * 2) * 0.004 * bob;
    const lr = (p: number, q2: number, r: number) => (p + (q2 - p) * a) * (1 - sprintT) + r * sprintT;
    g.rotation.set(
      lr(cur.hip.rot.x, cur.ads.rot.x, cur.sprint.rot.x) + sx + kr * 0.012 + cur.animRot.x - drop * 0.7 + ret * 0.75 + br * 0.004 * idle,
      lr(cur.hip.rot.y, cur.ads.rot.y, cur.sprint.rot.y) + sy + cur.animRot.y + Math.sin(ph) * 0.012 * bob + ret * 0.2,
      lr(cur.hip.rot.z, cur.ads.rot.z, cur.sprint.rot.z) + sr + cur.animRot.z + Math.sin(ph) * 0.02 * bob + drop * 0.3,
      'YXZ',
    );
    cur.updateArms();
  }

  private fire(w: WeaponBase): void {
    const { camera, bodyCam, player, fx, audio, col, targets } = this.d; const s = w.stats, c = player.controller;
    w.fire(); this.shotsFired++;
    const spread = THREE.MathUtils.lerp(s.hipSpread, s.aimSpread, this.aim) * (1 + bodyCam.speedFactor * 1.3 + this.heat) * (1 - c.crouch * 0.25);
    this.e.set(bodyCam.aimPitch, bodyCam.aimYaw, 0); this.q.setFromEuler(this.e);
    const ang = Math.random() * Math.PI * 2, rad = Math.sqrt(Math.random()) * spread;
    this.dir.set(Math.cos(ang) * rad, Math.sin(ang) * rad, -1).normalize().applyQuaternion(this.q);
    this.origin.copy(camera.position);
    const wall = col.raycast(this.origin, this.dir, s.range);
    const hit = targets.hitscan(this.origin, this.dir, wall ? wall.dist : s.range);
    this.rig.updateMatrixWorld(true);
    const muzzle = w.model.muzzle.getWorldPosition(this.v); w.model.muzzle.getWorldQuaternion(this.mq);
    fx.muzzleFlash(muzzle, this.mq, s.auto ? 1.15 : 0.8);
    const end = hit ? hit.point : wall ? wall.point : this.v2.copy(this.origin).addScaledVector(this.dir, s.range);
    if (muzzle.distanceTo(end) > 3) fx.tracer(muzzle, end);
    if (hit) { fx.impact(hit.point, this.v2.copy(this.dir).negate(), 'flesh'); audio.impact(hit.point, true); hit.apply(s.damage, s.headMul, this.dir); }
    else if (wall) { fx.impact(wall.point, wall.normal, 'wall'); audio.impact(wall.point, false); }
    // recoil: camera kick (springs back) + a little permanent climb the player must counter
    const r = s.recoil, k = (1 - this.aim * 0.25) * (1 - c.crouch * 0.15);
    bodyCam.kick(r.pitch * k * (0.85 + Math.random() * 0.3), r.yaw * k * (Math.random() - 0.5) * 2, r.roll * (Math.random() - 0.5) * 2, r.back);
    c.pitch += r.climb * k; c.yaw += r.climb * k * (Math.random() - 0.5) * 1.4;
    this.kickZ.v += r.modelKick; this.kickRot.v += r.modelRot * (0.85 + Math.random() * 0.3);
    this.heat = Math.min(1.4, this.heat + (s.auto ? 0.16 : 0.3));
    audio.shot(s.auto ? 'rifle' : 'pistol'); this.d.post.addFlash(0.1);
    targets.alert(this.origin, 45);
    // casing
    const ep = w.model.eject.getWorldPosition(this.v);
    const right = this.v2.set(1, 0, 0).applyQuaternion(this.mq);
    fx.shell(ep, new THREE.Vector3(right.x * (1.6 + Math.random()) + c.velocity.x, 1.4 + Math.random() * 0.8, right.z * (1.6 + Math.random()) + c.velocity.z).addScaledVector(this.dir, -0.4));
  }
}
