import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Enemy } from './Enemy';
import { Navigation } from './Navigation';
import { think, hear, type AIContext } from './EnemyAI';
import type { AssetLoader } from '../assets/AssetLoader';
import type { Level } from '../environment/Level';
import type { CollisionWorld } from '../environment/CollisionWorld';
import type { Player } from '../player/Player';
import type { AudioManager } from '../audio/AudioManager';
import type { CombatEffects } from '../weapons/Effects';
import type { BulletHit, BulletTargets } from '../weapons/WeaponManager';
import { buildRifle, mergeStatic, type GunMats } from '../weapons/WeaponModels';

/** Which way the soldier mesh faces at yaw 0 relative to our +Z-forward convention. */
const MODEL_YAW = Math.PI;

/** Spawns and updates all hostiles; answers bullet queries and routes sound events to the AI. */
export class EnemyManager implements BulletTargets {
  enemies: Enemy[] = [];
  nav: Navigation;
  onKill: ((e: Enemy, remaining: number) => void) | null = null;
  private ctx: AIContext; private seed = 12345;
  private v = new THREE.Vector3(); private d = new THREE.Vector3(); private o = new THREE.Vector3();

  constructor(scene: THREE.Scene, assets: AssetLoader, private level: Level, private col: CollisionWorld, gunMats: GunMats, private player: Player, private audio: AudioManager, private fx: CombatEffects) {
    this.nav = new Navigation(level);
    const rand = () => ((this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    this.ctx = { player, nav: this.nav, col, rand, fire: (e, hit) => this.enemyFire(e, hit), callOut: (e) => this.callOut(e) };
    const rifleProto = buildRifle(gunMats).root; mergeStatic(rifleProto); // enemy rifles have no moving parts: one mesh per material
    // re-tint the bright desert armour to a dark drab kit that suits the setting
    assets.soldier.scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if (m?.isMeshStandardMaterial) { m.color.set(m.name.includes('Visor') ? 0x30343a : 0x6f7868); m.roughness = m.name.includes('Visor') ? 0.25 : 0.82; } });
    level.enemySpawns.forEach((s, i) => {
      const n = this.nav.nearest(s.x, s.z); s.x = n.x; s.z = n.z;
      const model = cloneSkinned(assets.soldier.scene); model.rotation.y = MODEL_YAW;
      this.enemies.push(new Enemy(i, s, model, assets.soldier.animations, rifleProto.clone(), col, scene));
    });
  }

  get aliveCount(): number { let n = 0; for (const e of this.enemies) if (e.alive) n++; return n; }
  reset(): void { this.seed = 12345; this.enemies.forEach((e) => e.reset()); }

  update(dt: number): void {
    const walk = (x: number, z: number) => this.level.walkableWorld(x, z);
    for (const e of this.enemies) {
      think(e, dt, this.ctx);
      e.justArrived = e.integrate(dt, walk, () => this.audio.footstep(e.speed > 2.6, this.v.set(e.pos.x, 0.1, e.pos.z)), () => this.audio.bodyFall(this.v.set(e.pos.x + e.fallDir.x, 0.2, e.pos.z + e.fallDir.z)));
    }
    // keep agents from stacking on each other
    for (let i = 0; i < this.enemies.length; i++) for (let j = i + 1; j < this.enemies.length; j++) {
      const a = this.enemies[i], b = this.enemies[j]; if (!a.alive || !b.alive) continue;
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.8 && d > 1e-3) { const k = (0.8 - d) / 2 / d; if (walk(a.pos.x - dx * k, a.pos.z - dz * k)) { a.pos.x -= dx * k; a.pos.z -= dz * k; } if (walk(b.pos.x + dx * k, b.pos.z + dz * k)) { b.pos.x += dx * k; b.pos.z += dz * k; } }
    }
  }

  // ---- BulletTargets ----
  hitscan(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): BulletHit | null {
    let best: Enemy | null = null, bestT = maxDist, head = false;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      // head: sphere
      this.o.set(origin.x - e.pos.x, origin.y - 1.64, origin.z - e.pos.z); const b = this.o.dot(dir), c = this.o.lengthSq() - 0.155 * 0.155; let disc = b * b - c;
      if (disc > 0) { const t = -b - Math.sqrt(disc); if (t > 0 && t < bestT) { bestT = t; best = e; head = true; } }
      // torso + legs: vertical cylinder
      const a2 = dir.x * dir.x + dir.z * dir.z; if (a2 < 1e-6) continue;
      const ox = origin.x - e.pos.x, oz = origin.z - e.pos.z; const hb = ox * dir.x + oz * dir.z; disc = hb * hb - a2 * (ox * ox + oz * oz - 0.27 * 0.27);
      if (disc > 0) { const t = (-hb - Math.sqrt(disc)) / a2; const y = origin.y + dir.y * t; if (t > 0 && t < bestT && y > 0.05 && y < 1.5) { bestT = t; best = e; head = false; } }
    }
    if (!best) return null;
    const enemy = best, isHead = head, point = origin.clone().addScaledVector(dir, bestT);
    return { dist: bestT, point, apply: (damage, headMul, d) => {
      const legs = !isHead && point.y < 0.85;
      if (enemy.damage(damage * (isHead ? headMul : legs ? 0.75 : 1), d)) { this.onKill?.(enemy, this.aliveCount); for (const o of this.enemies) if (o.alive && o.pos.distanceTo(enemy.pos) < 16) hear(o, this.ctx, this.player.feet, false); }
      else if (enemy.state !== 'engage' && enemy.state !== 'detect') { enemy.lastKnown.copy(this.player.feet); enemy.alerted = true; enemy.stop(); enemy.wantReady = 1; enemy.setState('detect'); enemy.stateT = enemy.traits.reaction * 0.5; }
    } };
  }

  /** Noise at pos audible within radius (walls muffle it). */
  alert(pos: THREE.Vector3, radius: number): void {
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(pos.x - e.pos.x, pos.z - e.pos.z);
      if (d > radius) continue;
      if (d > radius * 0.55 && !this.nav.gridSight(pos.x, pos.z, e.pos.x, e.pos.z)) continue;
      hear(e, this.ctx, pos, d < 8);
    }
  }

  private callOut(e: Enemy): void { for (const o of this.enemies) if (o !== e && o.alive && o.pos.distanceTo(e.pos) < 15) hear(o, this.ctx, e.lastKnown, true); }

  private enemyFire(e: Enemy, hit: boolean): void {
    const tgt = this.player.chestPos; const m = e.muzzle;
    this.audio.shot('enemy', m); this.fx.flashAt(m);
    if (hit && this.col.lineOfSight(m, tgt)) { this.fx.tracer(m, tgt); this.player.damage(5 + this.ctx.rand() * 4, e.pos); return; }
    // miss: send the round past the player and let it land in the level
    const off = 0.35 + this.ctx.rand() * 1.1, ang = this.ctx.rand() * Math.PI * 2;
    this.d.set(tgt.x + Math.cos(ang) * off - m.x, tgt.y + Math.sin(ang) * off * 0.6 - m.y, tgt.z + Math.sin(ang) * off - m.z).normalize();
    const w = this.col.raycast(m, this.d, 80);
    if (w) { this.fx.tracer(m, w.point); this.fx.impact(w.point, w.normal, 'wall'); this.audio.impact(w.point, false); }
    if (off < 0.9) this.audio.nearMiss();
  }
}
