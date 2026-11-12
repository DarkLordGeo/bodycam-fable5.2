import * as THREE from 'three';
import { WeaponBase, type Pose, type ReloadEvent, type WeaponStats } from './WeaponBase';
import { buildPistol, type GunMats } from './WeaponModels';
import { kf } from './WeaponAnimations';

/** Generic semi-automatic service pistol (fictional balance). */
export class Pistol extends WeaponBase {
  readonly stats: WeaponStats = {
    name: 'P-9 PISTOL', magSize: 15, reserve: 60, damage: 34, headMul: 2.6, fireInterval: 0.13, auto: false, hipSpread: 0.014, aimSpread: 0.0035, range: 70, reloadTime: 1.85, length: 0.2,
    recoil: { pitch: 0.95, yaw: 0.28, roll: 0.5, back: 0.25, climb: 0.007, modelKick: 1.6, modelRot: 9 },
  };
  readonly hip: Pose = { pos: new THREE.Vector3(0.075, -0.135, -0.38), rot: new THREE.Euler(0.02, 0.05, 0) };
  readonly ads: Pose = { pos: new THREE.Vector3(0, -0.048, -0.4), rot: new THREE.Euler(0, 0, 0) };
  readonly sprint: Pose = { pos: new THREE.Vector3(0.1, -0.2, -0.32), rot: new THREE.Euler(0.75, 0.3, -0.1) };
  protected readonly events: [number, ReloadEvent][] = [[0.3, 'magOut'], [1.2, 'magIn'], [1.5, 'rack']];
  private magAxis = new THREE.Vector3(0, -1, 0.135).normalize();

  constructor(m: GunMats) {
    super();
    this.slideTravel = 0.034;
    const grip: [number, number, number][] = [[-0.35, -1.0, -0.7], [-0.55, -1.25, -0.9], [-0.6, -1.3, -0.9], [-0.65, -1.3, -0.9]];
    this.setup(buildPistol(m), m,
      { pos: new THREE.Vector3(0.03, -0.062, 0.012), rot: new THREE.Euler(0.12, -0.32, -Math.PI / 2 + 0.05, 'YXZ'), pose: { curls: [[-0.25, -0.75, -0.5], grip[1], grip[2], grip[3]], thumb: [0.15, 0.5, 0.2], thumbCurl: -0.2 } },
      { pos: new THREE.Vector3(-0.034, -0.082, -0.002), rot: new THREE.Euler(0.3, 0.42, Math.PI / 2 - 0.1, 'YXZ'), pose: { curls: [[-0.5, -1.2, -0.8], grip[1], grip[2], grip[3]], thumb: [0.05, 0.75, 0.1], thumbCurl: -0.15 } });
  }

  protected reloadPose(t: number): void {
    const tilt = kf(t, [[0, 0], [0.26, 1], [1.3, 1], [1.7, 0]]);
    this.animRot.set(0.3 * tilt, 0.1 * tilt, 0.55 * tilt); this.animPos.set(-0.02 * tilt, 0.035 * tilt, 0.03 * tilt);
    // magazine: drops free, then a fresh one is pushed home by the support hand
    const d = t < 0.62 ? kf(t, [[0.3, 0], [0.6, -0.34]]) : kf(t, [[0.88, -0.3], [1.14, -0.03], [1.2, 0]]);
    this.model.mag.visible = !(t > 0.6 && t < 0.88);
    this.model.mag.position.copy(this.magRest).addScaledVector(this.magAxis, -d);
    const keys = [[0, 0, 0, 0], [0.32, -0.04, -0.2, 0.08], [0.6, -0.05, -0.36, 0.1], [0.88, -0.03, -0.36, 0.08], [1.14, 0.0, -0.1, 0.03], [1.2, 0.0, -0.065, 0.02], [1.34, 0.0, -0.065, 0.02], [1.6, 0, 0, 0]];
    this.leftHand.position.set(this.leftRestPos.x + kf(t, keys, 1), this.leftRestPos.y + kf(t, keys, 2), this.leftRestPos.z + kf(t, keys, 3));
  }
}
