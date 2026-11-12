import * as THREE from 'three';

const B = (root: THREE.Object3D, n: string): THREE.Bone => root.getObjectByName('mixamorig' + n) as THREE.Bone;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion(), _wq = new THREE.Quaternion(), _pq = new THREE.Quaternion();

/** Rotates a bone (in world space) so the segment bone→child points along dir. Skeleton-agnostic. */
function aimBone(bone: THREE.Object3D, child: THREE.Object3D, dir: THREE.Vector3): void {
  bone.getWorldPosition(_a); child.getWorldPosition(_b); _b.sub(_a).normalize();
  _q.setFromUnitVectors(_b, dir); bone.getWorldQuaternion(_wq).premultiply(_q);
  bone.parent!.getWorldQuaternion(_pq).invert(); bone.quaternion.copy(_pq.multiply(_wq)); bone.updateMatrixWorld(true);
}
/** Applies an extra world-space rotation to a bone. */
function rotateWorld(bone: THREE.Object3D, q: THREE.Quaternion): void {
  bone.getWorldQuaternion(_wq).premultiply(q); bone.parent!.getWorldQuaternion(_pq).invert(); bone.quaternion.copy(_pq.multiply(_wq)); bone.updateMatrixWorld(true);
}

export type Locomotion = 'Idle' | 'Walk' | 'Run';
export interface UpperPose { yaw: number; aimDir: THREE.Vector3; ready: number; flinch: number; flinchAxis: THREE.Vector3; armed: boolean; lean: number; leanAxis: THREE.Vector3 }

/**
 * Locomotion comes from the model's mocap clips (idle / walk / run, cross-faded).
 * The upper body is procedural: two-bone IK plants both hands on the rifle, which blends between a
 * low-ready carry and a shouldered firing stance; hit flinches and the death collapse are layered on top.
 */
export class EnemyAnimations {
  mixer: THREE.AnimationMixer;
  private actions = new Map<Locomotion, THREE.AnimationAction>(); private current: Locomotion = 'Idle';
  private spine: THREE.Bone; private chest: THREE.Bone; private rArm: THREE.Bone; private rFore: THREE.Bone; private rHand: THREE.Bone; private lArm: THREE.Bone; private lFore: THREE.Bone; private lHand: THREE.Bone;
  private lenUpper: number; private lenFore: number;
  private grip = new THREE.Vector3(); private dir = new THREE.Vector3(); private fwd = new THREE.Vector3(); private right = new THREE.Vector3(); private tmp = new THREE.Vector3(); private e = new THREE.Vector3(); private s = new THREE.Vector3(); private pole = new THREE.Vector3(); private n = new THREE.Vector3();
  private fq = new THREE.Quaternion(); private m = new THREE.Matrix4();
  static readonly UP = new THREE.Vector3(0, 1, 0);

  constructor(private model: THREE.Object3D, clips: THREE.AnimationClip[], public rifle: THREE.Object3D) {
    this.mixer = new THREE.AnimationMixer(model);
    for (const name of ['Idle', 'Walk', 'Run'] as Locomotion[]) { const a = this.mixer.clipAction(THREE.AnimationClip.findByName(clips, name)!); a.play(); a.setEffectiveWeight(name === 'Idle' ? 1 : 0); this.actions.set(name, a); }
    this.spine = B(model, 'Spine'); this.chest = B(model, 'Spine2'); this.rArm = B(model, 'RightArm'); this.rFore = B(model, 'RightForeArm'); this.rHand = B(model, 'RightHand'); this.lArm = B(model, 'LeftArm'); this.lFore = B(model, 'LeftForeArm'); this.lHand = B(model, 'LeftHand');
    model.updateMatrixWorld(true);
    this.lenUpper = this.rArm.getWorldPosition(_a).distanceTo(this.rFore.getWorldPosition(_b)); this.lenFore = this.rFore.getWorldPosition(_a).distanceTo(this.rHand.getWorldPosition(_b));
  }

  setLocomotion(next: Locomotion, timeScale = 1): void {
    this.actions.get(next)!.timeScale = timeScale;
    if (next === this.current) return;
    const from = this.actions.get(this.current)!, to = this.actions.get(next)!;
    to.enabled = true; to.setEffectiveWeight(1); to.time = next === 'Idle' ? 0 : from.time % to.getClip().duration; to.crossFadeFrom(from, 0.28, true);
    this.current = next;
  }

  private ik(upper: THREE.Bone, fore: THREE.Bone, hand: THREE.Bone, target: THREE.Vector3, pole: THREE.Vector3): void {
    upper.getWorldPosition(this.s); const L1 = this.lenUpper, L2 = this.lenFore;
    this.n.subVectors(target, this.s); const d = Math.min(this.n.length(), (L1 + L2) * 0.995); this.n.normalize();
    const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    this.pole.copy(pole).addScaledVector(this.n, -pole.dot(this.n)).normalize();
    this.e.copy(this.s).addScaledVector(this.n, a).addScaledVector(this.pole, h);
    aimBone(upper, fore, this.tmp.subVectors(this.e, this.s).normalize());
    fore.getWorldPosition(_a); this.tmp.copy(this.s).addScaledVector(this.n, d).sub(_a).normalize(); aimBone(fore, hand, this.tmp);
  }

  /** dt-advance clips, then layer the procedural upper body. */
  update(dt: number, p: UpperPose): void {
    this.mixer.update(dt);
    this.model.updateMatrixWorld(true);
    if (p.lean > 0.001) { this.fq.setFromAxisAngle(p.leanAxis, p.lean); rotateWorld(this.spine, this.fq); }
    if (Math.abs(p.flinch) > 0.001) { this.fq.setFromAxisAngle(p.flinchAxis, p.flinch); rotateWorld(this.chest, this.fq); }
    if (!p.armed) return;
    this.fwd.set(Math.sin(p.yaw), 0, Math.cos(p.yaw)); this.right.set(-this.fwd.z, 0, this.fwd.x); // right = fwd × up
    this.chest.getWorldPosition(this.tmp);
    const r = p.ready, up = EnemyAnimations.UP;
    // rifle direction: low-ready (muzzle down & across) → on target
    this.dir.copy(this.fwd).multiplyScalar(0.72).addScaledVector(up, -0.56).addScaledVector(this.right, -0.36).normalize().lerp(p.aimDir, r).normalize();
    this.grip.copy(this.tmp).addScaledVector(this.fwd, THREE.MathUtils.lerp(0.2, 0.17, r)).addScaledVector(this.right, THREE.MathUtils.lerp(0.2, 0.13, r)).addScaledVector(up, THREE.MathUtils.lerp(-0.2, 0.02, r));
    this.ik(this.rArm, this.rFore, this.rHand, this.grip, this.tmp.copy(this.right).multiplyScalar(0.7).addScaledVector(up, -1));
    const lt = _b.copy(this.grip).addScaledVector(this.dir, 0.33).addScaledVector(up, 0.015).clone();
    this.ik(this.lArm, this.lFore, this.lHand, lt, this.tmp.copy(this.right).multiplyScalar(-0.55).addScaledVector(up, -1));
    // rifle follows the right hand
    this.rHand.getWorldPosition(this.s);
    this.rifle.position.copy(this.s).addScaledVector(this.dir, 0.06).addScaledVector(up, 0.035);
    this.m.lookAt(this.rifle.position, this.tmp.copy(this.rifle.position).add(this.dir), up); this.rifle.quaternion.setFromRotationMatrix(this.m);
  }
}
