import * as THREE from 'three';
import { canvasTexture } from '../rendering/Materials';

const MAX_P = 500, MAX_DECALS = 90, MAX_SHELLS = 24, MAX_TRACERS = 14;

/** Pooled combat VFX: muzzle flash, tracers, bullet-hole decals, sparks/dust/blood particles, ejected casings. */
export class CombatEffects {
  onShellBounce: ((pos: THREE.Vector3) => void) | null = null;
  private flash = new THREE.Group(); private flashLight = new THREE.PointLight(0xffb469, 0, 12, 1.8); private flashT = 0;
  private decals: THREE.Mesh[] = []; private decalI = 0;
  private points: THREE.Points; private pPos = new Float32Array(MAX_P * 3); private pVel = new Float32Array(MAX_P * 3); private pCol = new Float32Array(MAX_P * 4); private pSize = new Float32Array(MAX_P);
  private pLife = new Float32Array(MAX_P); private pMax = new Float32Array(MAX_P); private pGrav = new Float32Array(MAX_P); private pI = 0;
  private shells: THREE.InstancedMesh; private sPos: THREE.Vector3[] = []; private sVel: THREE.Vector3[] = []; private sRot: THREE.Euler[] = []; private sSpin: THREE.Vector3[] = []; private sLife = new Float32Array(MAX_SHELLS); private sBounced = new Uint8Array(MAX_SHELLS); private sI = 0;
  private tracers: { mesh: THREE.Mesh; from: THREE.Vector3; dir: THREE.Vector3; dist: number; t: number }[] = [];
  private m4 = new THREE.Matrix4(); private q = new THREE.Quaternion(); private one = new THREE.Vector3(1, 1, 1);

  constructor(private scene: THREE.Scene) {
    // muzzle flash: three crossed additive quads + a short-lived light
    const ft = canvasTexture(128, 128, (c) => {
      c.filter = 'blur(3px)'; c.translate(64, 64); c.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 9; i++) { // soft irregular gas jets
        const a = Math.random() * Math.PI * 2, len = 26 + Math.random() * 32, w = 5 + Math.random() * 7;
        const g = c.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len); g.addColorStop(0, 'rgba(255,236,190,0.9)'); g.addColorStop(0.5, 'rgba(255,170,70,0.45)'); g.addColorStop(1, 'rgba(255,110,20,0)');
        c.strokeStyle = g; c.lineWidth = w; c.lineCap = 'round'; c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a) * len, Math.sin(a) * len); c.stroke();
      }
      const g = c.createRadialGradient(0, 0, 1, 0, 0, 30); g.addColorStop(0, 'rgba(255,252,235,1)'); g.addColorStop(0.4, 'rgba(255,214,140,0.6)'); g.addColorStop(1, 'rgba(255,140,40,0)');
      c.fillStyle = g; c.beginPath(); c.arc(0, 0, 30, 0, 7); c.fill();
    });
    const fm = new THREE.MeshBasicMaterial({ map: ft, color: new THREE.Color(3.2, 2.7, 1.9), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false });
    const front = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), fm); this.flash.add(front);
    for (let i = 0; i < 2; i++) { const p = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.42).translate(0, 0.16, 0).rotateX(-Math.PI / 2), fm); p.rotation.z = (i * Math.PI) / 2; this.flash.add(p); }
    this.flash.visible = false; scene.add(this.flash, this.flashLight);
    // decals
    const dt = canvasTexture(64, 64, (c) => {
      const g = c.createRadialGradient(32, 32, 1, 32, 32, 30); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.2, 'rgba(8,8,8,0.95)'); g.addColorStop(0.32, 'rgba(120,115,105,0.75)'); g.addColorStop(0.55, 'rgba(60,58,54,0.3)'); g.addColorStop(1, 'rgba(40,40,40,0)');
      c.fillStyle = g; c.fillRect(0, 0, 64, 64); c.strokeStyle = 'rgba(15,15,15,0.6)'; c.lineWidth = 1; for (let i = 0; i < 6; i++) { const a = Math.random() * 6.28; c.beginPath(); c.moveTo(32 + Math.cos(a) * 6, 32 + Math.sin(a) * 6); c.lineTo(32 + Math.cos(a + 0.2) * (14 + Math.random() * 12), 32 + Math.sin(a + 0.2) * (14 + Math.random() * 12)); c.stroke(); }
    });
    const dm = new THREE.MeshStandardMaterial({ map: dt, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.9 });
    const dg = new THREE.PlaneGeometry(0.11, 0.11);
    for (let i = 0; i < MAX_DECALS; i++) { const d = new THREE.Mesh(dg, dm); d.visible = false; d.renderOrder = 2; scene.add(d); this.decals.push(d); }
    // particles
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3)); pg.setAttribute('aColor', new THREE.BufferAttribute(this.pCol, 4)); pg.setAttribute('aSize', new THREE.BufferAttribute(this.pSize, 1));
    this.points = new THREE.Points(pg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: 'attribute vec4 aColor; attribute float aSize; varying vec4 vC; void main(){ vC = aColor; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = aSize * 620.0 / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying vec4 vC; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.12, d) * vC.a; if (a < 0.004) discard; gl_FragColor = vec4(vC.rgb, a); }',
    }));
    this.points.frustumCulled = false; this.points.renderOrder = 6; scene.add(this.points);
    // casings
    const sg = new THREE.CylinderGeometry(0.0048, 0.0052, 0.022, 8); sg.rotateX(Math.PI / 2);
    this.shells = new THREE.InstancedMesh(sg, new THREE.MeshStandardMaterial({ color: 0xb8923c, metalness: 1, roughness: 0.3 }), MAX_SHELLS);
    this.shells.frustumCulled = false; this.shells.castShadow = false;
    for (let i = 0; i < MAX_SHELLS; i++) { this.sPos.push(new THREE.Vector3(0, -50, 0)); this.sVel.push(new THREE.Vector3()); this.sRot.push(new THREE.Euler()); this.sSpin.push(new THREE.Vector3()); this.shells.setMatrixAt(i, this.m4.makeTranslation(0, -50, 0)); }
    scene.add(this.shells);
    // tracers
    const tg = new THREE.BoxGeometry(0.012, 0.012, 1).translate(0, 0, -0.5);
    const tm = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 4.2, 2), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    for (let i = 0; i < MAX_TRACERS; i++) { const mesh = new THREE.Mesh(tg, tm); mesh.visible = false; mesh.frustumCulled = false; scene.add(mesh); this.tracers.push({ mesh, from: new THREE.Vector3(), dir: new THREE.Vector3(), dist: 0, t: 99 }); }
  }

  muzzleFlash(pos: THREE.Vector3, quat: THREE.Quaternion, scale: number): void {
    this.flash.position.copy(pos); this.flash.quaternion.copy(quat); this.flash.rotateZ(Math.random() * 6.28);
    const s = scale * (0.75 + Math.random() * 0.5); this.flash.scale.set(s, s, s * (0.8 + Math.random() * 0.6)); this.flash.visible = true; this.flashT = 0.045;
    const d = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
    this.flashLight.position.copy(pos).addScaledVector(d, 0.45).setY(pos.y + 0.12); this.flashLight.intensity = 4 * scale;
    for (let i = 0; i < 5; i++) this.particle(pos.x, pos.y, pos.z, d.x * (1 + Math.random() * 2) + (Math.random() - 0.5) * 0.6, d.y * 2 + 0.3 + Math.random() * 0.4, d.z * (1 + Math.random() * 2) + (Math.random() - 0.5) * 0.6, 0.5, 0.5, 0.5, 0.12, 0.05 + Math.random() * 0.05, 0.5 + Math.random() * 0.4, -0.3);
  }

  /** Lightweight flash for enemy muzzles. */
  flashAt(p: THREE.Vector3): void { for (let i = 0; i < 3; i++) this.particle(p.x, p.y, p.z, (Math.random() - 0.5) * 2, Math.random(), (Math.random() - 0.5) * 2, 9, 6, 3, 1, 0.05 + Math.random() * 0.04, 0.05, 20); }

  private particle(x: number, y: number, z: number, vx: number, vy: number, vz: number, r: number, g: number, b: number, a: number, size: number, life: number, grav: number): void {
    const i = this.pI; this.pI = (this.pI + 1) % MAX_P;
    this.pPos.set([x, y, z], i * 3); this.pVel.set([vx, vy, vz], i * 3); this.pCol.set([r, g, b, a], i * 4); this.pSize[i] = size; this.pLife[i] = life; this.pMax[i] = life; this.pGrav[i] = grav;
  }

  /** Bullet impact on level geometry or a body. */
  impact(p: THREE.Vector3, n: THREE.Vector3, kind: 'wall' | 'flesh'): void {
    if (kind === 'wall') {
      const d = this.decals[this.decalI]; this.decalI = (this.decalI + 1) % MAX_DECALS;
      d.position.copy(p).addScaledVector(n, 0.004); d.lookAt(p.x + n.x, p.y + n.y, p.z + n.z); d.rotateZ(Math.random() * 6.28); const s = 0.7 + Math.random() * 0.7; d.scale.set(s, s, 1); d.visible = true;
      for (let i = 0; i < 9; i++) { const sp = 2 + Math.random() * 5; this.particle(p.x, p.y, p.z, n.x * sp + (Math.random() - 0.5) * 4, n.y * sp + (Math.random() - 0.3) * 4, n.z * sp + (Math.random() - 0.5) * 4, 6, 3.5, 1.2, 1, 0.006 + Math.random() * 0.006, 0.12 + Math.random() * 0.2, 9); }
      for (let i = 0; i < 7; i++) { const sp = 0.4 + Math.random() * 1.4; this.particle(p.x + n.x * 0.03, p.y + n.y * 0.03, p.z + n.z * 0.03, n.x * sp + (Math.random() - 0.5) * 0.7, n.y * sp + Math.random() * 0.5, n.z * sp + (Math.random() - 0.5) * 0.7, 0.45, 0.43, 0.4, 0.22, 0.05 + Math.random() * 0.07, 0.6 + Math.random() * 0.7, 0.6); }
    } else {
      for (let i = 0; i < 10; i++) { const sp = 0.6 + Math.random() * 2.2; this.particle(p.x, p.y, p.z, n.x * sp + (Math.random() - 0.5) * 1.5, n.y * sp + (Math.random() - 0.2) * 1.5, n.z * sp + (Math.random() - 0.5) * 1.5, 0.22, 0.01, 0.01, 0.7, 0.012 + Math.random() * 0.022, 0.25 + Math.random() * 0.3, 7); }
      for (let i = 0; i < 3; i++) this.particle(p.x, p.y, p.z, n.x * 0.5, 0.2, n.z * 0.5, 0.25, 0.03, 0.03, 0.25, 0.07, 0.35, 0.5);
    }
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3): void {
    const t = this.tracers.find((x) => x.t > 1) ?? this.tracers[0];
    t.from.copy(from); t.dir.subVectors(to, from); t.dist = t.dir.length(); t.dir.normalize(); t.t = 0;
    t.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), t.dir);
  }

  shell(pos: THREE.Vector3, vel: THREE.Vector3): void {
    const i = this.sI; this.sI = (this.sI + 1) % MAX_SHELLS;
    this.sPos[i].copy(pos); this.sVel[i].copy(vel); this.sRot[i].set(Math.random() * 6, Math.random() * 6, 0); this.sSpin[i].set(8 + Math.random() * 20, Math.random() * 14, Math.random() * 10); this.sLife[i] = 6; this.sBounced[i] = 0;
  }

  update(dt: number): void {
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) { this.flash.visible = false; this.flashLight.intensity = 0; } }
    for (let i = 0; i < MAX_P; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt; const j = i * 3;
      if (this.pLife[i] <= 0) { this.pCol[i * 4 + 3] = 0; continue; }
      this.pVel[j + 1] -= this.pGrav[i] * dt; const drag = this.pGrav[i] < 2 ? 1 - Math.min(1, dt * 2.5) : 1;
      this.pVel[j] *= drag; this.pVel[j + 1] *= drag; this.pVel[j + 2] *= drag;
      this.pPos[j] += this.pVel[j] * dt; this.pPos[j + 1] += this.pVel[j + 1] * dt; this.pPos[j + 2] += this.pVel[j + 2] * dt;
      if (this.pPos[j + 1] < 0.01) { this.pPos[j + 1] = 0.01; this.pVel[j + 1] *= -0.3; }
      const k = this.pLife[i] / this.pMax[i]; if (this.pGrav[i] < 2) { this.pSize[i] += dt * 0.12; this.pCol[i * 4 + 3] *= 1 - Math.min(1, dt * 2.2); } else this.pCol[i * 4 + 3] = k;
    }
    const g = this.points.geometry; g.attributes.position.needsUpdate = true; g.attributes.aColor.needsUpdate = true; g.attributes.aSize.needsUpdate = true;
    for (let i = 0; i < MAX_SHELLS; i++) {
      if (this.sLife[i] <= 0) continue;
      this.sLife[i] -= dt; const p = this.sPos[i], v = this.sVel[i];
      if (p.y > 0.006 || Math.abs(v.y) > 0.3) {
        v.y -= 9.8 * dt; p.addScaledVector(v, dt); const r = this.sRot[i], s = this.sSpin[i]; r.x += s.x * dt; r.y += s.y * dt; r.z += s.z * dt;
        if (p.y < 0.006) { p.y = 0.006; v.y *= -0.35; v.x *= 0.5; v.z *= 0.5; s.multiplyScalar(0.4); if (!this.sBounced[i]) { this.sBounced[i] = 1; this.onShellBounce?.(p); } if (Math.abs(v.y) < 0.3) { r.x = 0; r.z = 0; } }
      }
      this.shells.setMatrixAt(i, this.m4.compose(this.sLife[i] > 0 ? p : new THREE.Vector3(0, -50, 0), this.q.setFromEuler(this.sRot[i]), this.one));
    }
    this.shells.instanceMatrix.needsUpdate = true;
    for (const t of this.tracers) {
      if (t.t > 1) continue;
      t.t += (dt * 260) / Math.max(t.dist, 1);
      if (t.t > 1) { t.mesh.visible = false; continue; }
      const head = t.t * t.dist, len = Math.min(5, head, t.dist * 0.5 + 0.5);
      t.mesh.position.copy(t.from).addScaledVector(t.dir, head - len); t.mesh.scale.set(1, 1, len); t.mesh.visible = true;
    }
  }

  reset(): void { this.decals.forEach((d) => (d.visible = false)); this.pLife.fill(0); for (let i = 0; i < MAX_P; i++) this.pCol[i * 4 + 3] = 0; this.sLife.fill(0); for (let i = 0; i < MAX_SHELLS; i++) this.shells.setMatrixAt(i, this.m4.makeTranslation(0, -50, 0)); this.tracers.forEach((t) => { t.t = 99; t.mesh.visible = false; }); }
}
