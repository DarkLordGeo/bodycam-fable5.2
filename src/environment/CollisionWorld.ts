import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export const GROUP_STATIC = 0x0001;
export const GROUP_PLAYER = 0x0002;
export const GROUP_ENEMY = 0x0004;
export const groups = (member: number, filter: number): number => ((member << 16) | filter) >>> 0;

/** Record of one static level collider, kept for the collision-reference export and the debug overlay. */
export interface StaticCollider { shape: 'box' | 'cylinder'; cx: number; cy: number; cz: number; hx: number; hy: number; hz: number; rotY: number; tag: string }

export interface RayHit { dist: number; point: THREE.Vector3; normal: THREE.Vector3 }

/** Thin wrapper around the Rapier world: static level colliders + ray queries. */
export class CollisionWorld {
  world!: RAPIER.World;
  /** Every static collider created through addBox / addCylinder, in creation order. */
  readonly statics: StaticCollider[] = [];
  /** Label applied to colliders created from now on (bookkeeping only; no effect on physics). */
  tag = 'structure';
  private ray!: RAPIER.Ray;

  static async create(): Promise<CollisionWorld> {
    await RAPIER.init();
    const c = new CollisionWorld();
    c.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    c.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    return c;
  }

  addBox(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, rotY = 0): void {
    const d = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz).setCollisionGroups(groups(GROUP_STATIC, 0xffff));
    if (rotY) d.setRotation({ x: 0, y: Math.sin(rotY / 2), z: 0, w: Math.cos(rotY / 2) });
    this.world.createCollider(d);
    this.statics.push({ shape: 'box', cx, cy, cz, hx, hy, hz, rotY, tag: this.tag });
  }

  addCylinder(cx: number, cy: number, cz: number, halfH: number, r: number): void {
    this.world.createCollider(RAPIER.ColliderDesc.cylinder(halfH, r).setTranslation(cx, cy, cz).setCollisionGroups(groups(GROUP_STATIC, 0xffff)));
    this.statics.push({ shape: 'cylinder', cx, cy, cz, hx: r, hy: halfH, hz: r, rotY: 0, tag: this.tag });
  }

  /** Ray against static level geometry only. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): RayHit | null {
    this.ray.origin = origin; this.ray.dir = dir;
    const hit = this.world.castRayAndGetNormal(this.ray, maxDist, true, undefined, groups(0xffff, GROUP_STATIC));
    if (!hit) return null;
    const t = hit.timeOfImpact;
    return { dist: t, point: origin.clone().addScaledVector(dir, t), normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z) };
  }

  private _d = new THREE.Vector3();
  /** True when nothing static blocks the segment a→b. */
  lineOfSight(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const d = this._d.subVectors(b, a); const len = d.length(); if (len < 1e-4) return true;
    d.multiplyScalar(1 / len);
    this.ray.origin = a; this.ray.dir = d;
    return !this.world.castRay(this.ray, len - 0.05, true, undefined, groups(0xffff, GROUP_STATIC));
  }

  step(dt: number): void { this.world.timestep = dt; this.world.step(); }
}
