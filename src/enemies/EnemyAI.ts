import * as THREE from 'three';
import type { Enemy } from './Enemy';
import type { Navigation, P2 } from './Navigation';
import type { Player } from '../player/Player';
import type { CollisionWorld } from '../environment/CollisionWorld';

export interface AIContext {
  player: Player; nav: Navigation; col: CollisionWorld; rand: () => number;
  /** Enemy pulls the trigger; `hit` was rolled by the AI's accuracy model. */
  fire(e: Enemy, hit: boolean): void;
  /** Called when an enemy confirms the player; nearby allies converge. */
  callOut(e: Enemy): void;
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const _t = new THREE.Vector3();
const CHASE_DELAY = { aggressive: 0.5, steady: 1.2, cautious: 2.6 } as const;

function perceive(e: Enemy, c: AIContext, dt: number): void {
  const p = c.player; let vis = false;
  if (p.alive) {
    const tgt = p.chestPos; const dx = tgt.x - e.pos.x, dz = tgt.z - e.pos.z; const dist = Math.hypot(dx, dz);
    if (dist < 38) {
      const ang = Math.abs(wrap(Math.atan2(dx, dz) - e.yaw));
      if (ang < (e.alerted ? 1.9 : 1.15) || dist < 2.2) vis = c.col.lineOfSight(e.eye, tgt);
    }
  }
  e.sees = vis;
  if (vis) { e.seeT += dt; e.lostT = 0; e.lastKnown.copy(p.feet); } else { e.seeT = Math.max(0, e.seeT - dt * 0.5); e.lostT += dt; }
}

function goTo(e: Enemy, c: AIContext, x: number, z: number): boolean { return e.setPath(c.nav.findPath(e.pos.x, e.pos.z, x, z)); }

function pickReposition(e: Enemy, c: AIContext): P2 | null {
  const pl = c.player.feet; let best: P2 | null = null, bestScore = -1e9; const trait = e.spawn.trait;
  for (let i = 0; i < 12; i++) {
    const p = c.nav.randomNear(e.pos.x, e.pos.z, 2.5, 8.5, c.rand); if (!p) continue;
    const dP = Math.hypot(p.x - pl.x, p.z - pl.z), dE = Math.hypot(p.x - e.pos.x, p.z - e.pos.z); const los = c.nav.gridSight(p.x, p.z, pl.x, pl.z);
    let s = c.rand() * 0.5;
    if (trait === 'aggressive') s += (los ? 2 : 0) - Math.abs(dP - 7) * 0.4;        // push up, keep eyes on
    else if (trait === 'cautious') s += (los ? 0 : 3) - dE * 0.2 - Math.abs(dP - 12) * 0.1; // break line of sight
    else s += (los ? 1.5 : 0) - Math.abs(dP - 11) * 0.25 + dE * 0.1;                 // hold range, shift angle
    if (dP < 3) s -= 4;
    if (s > bestScore) { bestScore = s; best = p; }
  }
  return best;
}

function startDetect(e: Enemy): void { e.setState('detect'); e.stop(); e.wantReady = 1; }

/** One decision step for one enemy. Movement/animation are integrated afterwards by Enemy.integrate. */
export function think(e: Enemy, dt: number, c: AIContext): void {
  if (e.state === 'dead') return;
  e.perceiveT -= dt; if (e.perceiveT <= 0) { perceive(e, c, 0.1); e.perceiveT += 0.1; }
  const p = c.player, T = e.traits; const pf = p.feet; const dist = Math.hypot(pf.x - e.pos.x, pf.z - e.pos.z);
  if (e.sees) { const tgt = p.chestPos; e.aimDir.set(tgt.x - e.pos.x, tgt.y - 1.38, tgt.z - e.pos.z).normalize(); }
  const noticed = e.sees && e.seeT > T.reaction * (0.35 + dist / 22) * (p.controller.crouch > 0.5 ? 1.5 : 1) * (e.alerted ? 0.4 : 1);

  switch (e.state) {
    case 'idle': {
      e.wantReady = e.alerted ? 0.3 : 0; e.speed = 0;
      if (noticed) { startDetect(e); break; }
      e.waitT -= dt;
      if (e.stateT % 5 < dt) e.lookYaw = e.yaw + (c.rand() - 0.5) * 1.6; // glance around
      e.face(e.lookYaw, dt, 1.4);
      if (e.waitT <= 0) {
        if (e.spawn.patrol.length) { const pt = e.spawn.patrol[e.patrolI % e.spawn.patrol.length]; if (goTo(e, c, pt[0], pt[1])) e.setState('patrol'); else e.waitT = 2; }
        else if (Math.hypot(e.pos.x - e.spawn.x, e.pos.z - e.spawn.z) > 1.5 && goTo(e, c, e.spawn.x, e.spawn.z)) e.setState('patrol'); else e.waitT = 4;
      }
      break;
    }
    case 'patrol': {
      e.wantReady = e.alerted ? 0.3 : 0; e.speed = T.walk;
      if (noticed) { startDetect(e); break; }
      if (e.justArrived || !e.moving) { e.patrolI++; e.waitT = 1.5 + c.rand() * 3.5; e.lookYaw = e.yaw + (c.rand() - 0.5) * 2; e.setState('idle'); }
      break;
    }
    case 'investigate': {
      e.wantReady = 0.35; e.speed = T.walk * 1.55; e.alerted = true;
      if (noticed) { startDetect(e); break; }
      if (e.stateT < e.waitT) { e.face(e.yawTo(e.lastKnown.x, e.lastKnown.z), dt); e.speed = 0; if (e.moving && e.stateT + dt >= e.waitT) e.repathT = 0; break; } // hesitation before moving
      if (!e.moving) {
        e.lookT += dt; e.face(e.lookYaw, dt, 2.2);
        if (e.lookT % 1.6 < dt) e.lookYaw = e.yaw + (c.rand() > 0.5 ? 1 : -1) * (0.8 + c.rand() * 1.2);
        if (e.lookT > 5.5) { e.waitT = 0.5; e.setState('idle'); }
      } else e.lookT = 0;
      break;
    }
    case 'detect': {
      e.wantReady = 1; e.speed = 0; e.alerted = true;
      e.face(e.yawTo(e.lastKnown.x, e.lastKnown.z), dt);
      if (e.stateT > T.reaction) { e.setState('engage'); e.burstLeft = 0; e.pauseT = 0.05; e.burstsDone = 0; e.firstBurst = true; c.callOut(e); }
      break;
    }
    case 'engage': {
      e.alerted = true;
      if (!p.alive) { e.wantReady = 0.3; e.stop(); e.waitT = 3; e.setState('idle'); break; }
      if (e.sees) {
        e.stop(); e.wantReady = 1; const err = e.face(e.yawTo(pf.x, pf.z), dt);
        if (e.burstLeft > 0) {
          e.shotT -= dt;
          if (e.shotT <= 0 && err < 0.3 && e.ready > 0.85 && e.stagger <= 0) {
            e.shotT = 0.1 + c.rand() * 0.045; e.burstLeft--;
            const sp = Math.hypot(p.controller.velocity.x, p.controller.velocity.z);
            let chance = T.accuracy * THREE.MathUtils.clamp(1.15 - dist / 34, 0.25, 1);
            chance *= sp > 3.5 ? 0.6 : sp > 1 ? 0.85 : 1; if (p.controller.crouch > 0.5) chance *= 0.8; if (e.firstBurst) chance *= 0.45;
            c.fire(e, c.rand() < chance);
            if (e.burstLeft === 0) { e.firstBurst = false; e.burstsDone++; e.pauseT = T.pause[0] + c.rand() * (T.pause[1] - T.pause[0]); }
          }
        } else {
          e.pauseT -= dt;
          if (e.pauseT <= 0) {
            if (e.burstsDone >= T.repositionAfter || (e.spawn.trait === 'aggressive' && dist > 13)) { const pt = pickReposition(e, c); if (pt && goTo(e, c, pt.x, pt.z)) { e.burstsDone = 0; e.setState('reposition'); break; } e.burstsDone = 0; }
            e.burstLeft = T.burst[0] + Math.floor(c.rand() * (T.burst[1] - T.burst[0] + 1)); e.shotT = 0.12;
          }
        }
      } else {
        // lost sight: hold on the last known position for a moment, then push to it
        e.wantReady = 0.75; e.burstLeft = 0;
        if (!e.moving) {
          e.face(e.yawTo(e.lastKnown.x, e.lastKnown.z), dt);
          if (e.lostT > CHASE_DELAY[e.spawn.trait]) {
            if (Math.hypot(e.lastKnown.x - e.pos.x, e.lastKnown.z - e.pos.z) < 1.2 || !goTo(e, c, e.lastKnown.x, e.lastKnown.z)) { e.waitT = 0; e.lookT = 0; e.lookYaw = e.yaw + 1.5; e.setState('investigate'); }
          }
        } else { e.speed = e.spawn.trait === 'aggressive' ? T.run : T.walk * 1.7; e.wantReady = 0.45; }
      }
      break;
    }
    case 'reposition': {
      e.speed = T.run; e.wantReady = 0.3;
      if (e.justArrived || !e.moving || e.stateT > 6) { e.stop(); e.pauseT = 0.25; e.setState('engage'); }
      break;
    }
  }
  // moving agents re-plan if they got blocked
  if (e.moving && e.repathT <= 0 && e.path.length) { const g = e.path[e.path.length - 1]; e.repathT = 1.2; if (!c.nav.lineWalkable(e.pos.x, e.pos.z, e.path[e.pathI].x, e.path[e.pathI].z)) goTo(e, c, g.x, g.z); }
  e.repathT -= dt;
  void _t;
}

/** External stimulus (gunshot, footstep, ally call-out) at a position. */
export function hear(e: Enemy, c: AIContext, pos: THREE.Vector3, precise: boolean): void {
  if (!e.alive || e.state === 'engage' || e.state === 'detect' || e.state === 'reposition') { if (e.alive && !e.sees) e.lastKnown.copy(pos); return; }
  const err = precise ? 0.5 : 2.2;
  e.lastKnown.set(pos.x + (c.rand() - 0.5) * err, 0, pos.z + (c.rand() - 0.5) * err);
  e.alerted = true; e.lookT = 0; e.lookYaw = e.yawTo(pos.x, pos.z);
  if (goTo(e, c, e.lastKnown.x, e.lastKnown.z)) { e.setState('investigate'); e.stateT = 0; e.waitT = 0.35 + c.rand() * 0.8; }
  else { e.setState('investigate'); e.stateT = 0; e.waitT = 0; }
}
