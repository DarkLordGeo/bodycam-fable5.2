import * as THREE from 'three';
import { makeArm, makeHand, type GunMats, type GunModel, type HandPose } from './WeaponModels';

export interface WeaponStats {
  name: string; magSize: number; reserve: number; damage: number; headMul: number; fireInterval: number; auto: boolean;
  hipSpread: number; aimSpread: number; range: number; reloadTime: number; length: number;
  recoil: { pitch: number; yaw: number; roll: number; back: number; climb: number; modelKick: number; modelRot: number };
}
export interface Pose { pos: THREE.Vector3; rot: THREE.Euler }
export type ReloadEvent = 'magOut' | 'magIn' | 'rack';
export interface HandRest { pos: THREE.Vector3; rot: THREE.Euler; pose: HandPose }

/**
 * A procedurally animated first-person weapon: model + both hands + forearms.
 * Subclasses provide the model, stats, poses and the reload choreography.
 */
export abstract class WeaponBase {
  readonly group = new THREE.Group();
  abstract readonly stats: WeaponStats;
  abstract readonly hip: Pose; abstract readonly ads: Pose; abstract readonly sprint: Pose;
  mag = 0; reserve = 0;
  reloading = false; reloadT = 0; cooldown = 0;
  /** Extra offsets written by the reload animation and applied by the manager. */
  animPos = new THREE.Vector3(); animRot = new THREE.Euler();
  model!: GunModel; rightHand!: THREE.Group; leftHand!: THREE.Group;
  protected leftRestPos = new THREE.Vector3(); protected leftRestQuat = new THREE.Quaternion();
  protected magRest = new THREE.Vector3();
  protected slideTravel = 0.03; protected slideT = 0; protected locked = false; protected wasEmpty = false;
  private arms: THREE.Mesh[] = []; private fired = 0;
  private elbowR = new THREE.Vector3(0.26, -0.5, -0.02); private elbowL = new THREE.Vector3(-0.24, -0.52, -0.06);
  protected abstract readonly events: [number, ReloadEvent][];
  protected abstract reloadPose(t: number): void;

  protected setup(model: GunModel, m: GunMats, right: HandRest, left: HandRest): void {
    this.model = model; this.group.add(model.root);
    this.rightHand = makeHand(1, right.pose, m); this.rightHand.position.copy(right.pos); this.rightHand.rotation.copy(right.rot);
    this.leftHand = makeHand(-1, left.pose, m); this.leftHand.position.copy(left.pos); this.leftHand.rotation.copy(left.rot);
    this.leftRestPos.copy(left.pos); this.leftRestQuat.copy(this.leftHand.quaternion); this.magRest.copy(model.mag.position);
    this.group.add(this.rightHand, this.leftHand);
    for (let i = 0; i < 2; i++) { const a = makeArm(m); this.arms.push(a); this.group.add(a); }
    this.mag = this.stats.magSize; this.reserve = this.stats.reserve;
    this.group.traverse((o) => { o.frustumCulled = false; });
  }

  reset(): void { this.mag = this.stats.magSize; this.reserve = this.stats.reserve; this.cancelReload(); this.locked = false; this.slideT = 0; this.cooldown = 0; }
  get canFire(): boolean { return !this.reloading && this.cooldown <= 0 && this.mag > 0; }
  get canReload(): boolean { return !this.reloading && this.mag < this.stats.magSize && this.reserve > 0; }

  /** Consumes a round and starts the slide/bolt cycle. */
  fire(): void { this.mag--; this.cooldown = this.stats.fireInterval; this.slideT = 1; if (this.mag === 0) this.locked = true; }
  startReload(): void { if (!this.canReload) return; this.reloading = true; this.reloadT = 0; this.fired = 0; this.wasEmpty = this.mag === 0; }
  cancelReload(): void {
    this.reloading = false; this.reloadT = 0; this.animPos.set(0, 0, 0); this.animRot.set(0, 0, 0);
    if (this.model) { this.model.mag.position.copy(this.magRest); this.model.mag.visible = true; this.leftHand.position.copy(this.leftRestPos); this.leftHand.quaternion.copy(this.leftRestQuat); }
  }

  /** Advances cooldown, slide and reload. Emits reload events exactly when the animation reaches them. */
  update(dt: number, emit: (e: ReloadEvent) => void): void {
    this.cooldown -= dt;
    this.slideT = Math.max(0, this.slideT - dt * 16);
    const s = this.locked ? Math.max(this.slideT, 0.85) : this.slideT;
    this.model.slide.position.z = Math.sin(Math.min(1, s) * Math.PI * (this.locked ? 0.5 : 1)) * this.slideTravel;
    if (this.model.trigger) this.model.trigger.rotation.x = 0.28 + (this.cooldown > 0 ? 0.3 : 0);
    if (this.reloading) {
      this.reloadT += dt;
      while (this.fired < this.events.length && this.reloadT >= this.events[this.fired][0]) {
        const e = this.events[this.fired++][1];
        if (e === 'rack' && !this.wasEmpty) continue;
        if (e === 'magIn') { const need = Math.min(this.stats.magSize - this.mag, this.reserve); this.mag += need; this.reserve -= need; }
        if (e === 'rack') this.locked = false;
        emit(e);
      }
      if (this.reloadT >= this.stats.reloadTime) { this.locked = false; this.cancelReload(); } else this.reloadPose(this.reloadT);
    }
  }

  private w = new THREE.Vector3(); private q = new THREE.Quaternion(); private e = new THREE.Vector3(); private inv = new THREE.Quaternion();
  /** Re-aims the forearms from the wrists toward elbow anchors fixed to the body (rig space). */
  updateArms(): void {
    this.inv.copy(this.group.quaternion).invert();
    for (let i = 0; i < 2; i++) {
      const hand = i === 0 ? this.rightHand : this.leftHand, arm = this.arms[i];
      this.w.set(0, 0, 0.115).applyQuaternion(hand.quaternion).add(hand.position); // wrist in weapon space
      this.e.copy(i === 0 ? this.elbowR : this.elbowL).sub(this.group.position).applyQuaternion(this.inv); // elbow anchor → weapon space
      arm.position.copy(this.w); const len = this.e.distanceTo(this.w);
      this.q.setFromUnitVectors(Z, this.e.sub(this.w).normalize()); arm.quaternion.copy(this.q); arm.scale.set(1, 0.9, len);
    }
  }
}
const Z = new THREE.Vector3(0, 0, 1);
