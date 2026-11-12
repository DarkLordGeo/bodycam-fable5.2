import * as THREE from 'three';
import { WeaponBase, type Pose, type ReloadEvent, type WeaponStats } from './WeaponBase';
import { buildRifle, type GunMats } from './WeaponModels';
import { kf } from './WeaponAnimations';

/** Generic select-fire assault rifle (fictional balance). */
export class AssaultRifle extends WeaponBase {
  readonly stats: WeaponStats = {
    name: 'AR-5 RIFLE', magSize: 30, reserve: 120, damage: 27, headMul: 2.4, fireInterval: 0.092, auto: true, hipSpread: 0.022, aimSpread: 0.0045, range: 90, reloadTime: 2.4, length: 0.75,
    recoil: { pitch: 0.5, yaw: 0.3, roll: 0.35, back: 0.32, climb: 0.0045, modelKick: 1.1, modelRot: 3.2 },
  };
  readonly hip: Pose = { pos: new THREE.Vector3(0.11, -0.2, -0.36), rot: new THREE.Euler(0.015, 0.075, 0.03) };
  readonly ads: Pose = { pos: new THREE.Vector3(0, -0.12, -0.3), rot: new THREE.Euler(0, 0, 0) };
  readonly sprint: Pose = { pos: new THREE.Vector3(0.06, -0.26, -0.3), rot: new THREE.Euler(-0.32, 0.75, 0.25) };
  protected readonly events: [number, ReloadEvent][] = [[0.42, 'magOut'], [1.4, 'magIn'], [1.82, 'rack']];
  private magAxis = new THREE.Vector3(0, -1, -0.16).normalize();
  private grabQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.5, 0.25, Math.PI / 2 - 0.2, 'YXZ'));

  constructor(m: GunMats) {
    super();
    this.slideTravel = 0.05;
    const grip: [number, number, number][] = [[-0.35, -1.0, -0.7], [-0.55, -1.25, -0.9], [-0.6, -1.3, -0.9], [-0.65, -1.3, -0.9]];
    const hold: [number, number, number][] = [[-0.75, -1.0, -0.6], [-0.8, -1.05, -0.6], [-0.8, -1.05, -0.6], [-0.85, -1.0, -0.6]];
    this.setup(buildRifle(m), m,
      { pos: new THREE.Vector3(0.033, -0.05, 0.0), rot: new THREE.Euler(0.2, -0.3, -Math.PI / 2 + 0.05, 'YXZ'), pose: { curls: [[-0.25, -0.8, -0.5], grip[1], grip[2], grip[3]], thumb: [0.1, 0.55, 0.2], thumbCurl: -0.25 } },
      { pos: new THREE.Vector3(-0.012, 0.0, -0.39), rot: new THREE.Euler(-0.1, -Math.PI / 2 + 0.25, Math.PI + 0.25, 'YXZ'), pose: { curls: hold, thumb: [0.2, 0.9, 0.5], thumbCurl: -0.5, spread: 0.03 } });
  }

  protected reloadPose(t: number): void {
    const w = kf(t, [[0, 0], [0.32, 1], [1.85, 1], [2.3, 0]]);
    this.animRot.set(0.26 * w, 0.2 * w, 0.42 * w); this.animPos.set(-0.03 * w, 0.045 * w, 0.02 * w);
    const d = t < 0.7 ? kf(t, [[0.42, 0], [0.68, -0.26]]) : kf(t, [[0.98, -0.26], [1.32, -0.03], [1.4, 0]]);
    this.model.mag.visible = !(t > 0.68 && t < 0.98);
    this.model.mag.position.copy(this.magRest).addScaledVector(this.magAxis, -d);
    // support hand: handguard → magazine → pull → new magazine → bolt release → handguard
    const k = [[0, 0, 0, 0], [0.34, -0.03, -0.16, 0.27], [0.42, -0.03, -0.16, 0.27], [0.68, -0.05, -0.4, 0.3], [0.98, -0.05, -0.4, 0.3], [1.32, -0.03, -0.19, 0.275], [1.4, -0.03, -0.16, 0.27], [1.55, -0.03, -0.16, 0.27], [1.8, -0.025, 0.03, 0.22], [1.9, -0.025, 0.03, 0.22], [2.25, 0, 0, 0]];
    this.leftHand.position.set(this.leftRestPos.x + kf(t, k, 1), this.leftRestPos.y + kf(t, k, 2), this.leftRestPos.z + kf(t, k, 3));
    this.leftHand.quaternion.copy(this.leftRestQuat).slerp(this.grabQuat, kf(t, [[0.1, 0], [0.34, 1], [1.55, 1], [1.8, 0.6], [2.25, 0]]));
  }
}
