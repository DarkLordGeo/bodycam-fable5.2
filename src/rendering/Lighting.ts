import * as THREE from 'three';
import type { LampDef, Level } from '../environment/Level';
import { WALL_H } from '../environment/Level';
import type { Mats } from './Materials';
import { CFG } from '../config';

interface Lamp { light: THREE.SpotLight; def: LampDef; base: number; f: number }

/**
 * Sun through the hall skylights (one shadow map) + ceiling fixtures as downward spot lights.
 * Fixture shadow maps are static and refreshed round-robin (one per frame) so dynamic
 * casters still get shadows without paying for every light every frame.
 */
export class Lighting {
  sun: THREE.DirectionalLight;
  lamps: Lamp[] = [];
  private rr = 0; private frame = 0;
  private shafts: THREE.Mesh[] = [];

  constructor(private scene: THREE.Scene, defs: LampDef[], private mats: Mats, private level: Level) {
    scene.add(new THREE.HemisphereLight(0x9aa7b4, 0x7a7268, 0.95));
    const sun = (this.sun = new THREE.DirectionalLight(0xfff0db, 4.2));
    sun.position.set(18 + 7, 30, 13 - 9); sun.target.position.set(18, 0, 13);
    sun.castShadow = true; sun.shadow.mapSize.set(CFG.quality.shadowMap, CFG.quality.shadowMap);
    const c = sun.shadow.camera; c.left = -21; c.right = 21; c.top = 16; c.bottom = -16; c.near = 5; c.far = 60;
    sun.shadow.autoUpdate = false; sun.shadow.needsUpdate = true;
    sun.shadow.bias = -0.0012; sun.shadow.normalBias = 0.06;
    scene.add(sun, sun.target);

    // Texture-unit budget: many GPUs (e.g. Apple/Metal) expose only 16 units per fragment shader.
    // Surface materials use 7, the sun shadow 1 — so at most 4 fixtures may cast shadows.
    const keep = new Set(defs.filter((d) => d.shadow).filter((d) => d.kind !== 'tube' || d.flicker || (d.x === 5 && d.z === 12.6)).slice(0, 4));
    for (const def of defs) {
      const l = new THREE.SpotLight(def.color, def.intensity * 1.5, def.range ?? 14, def.kind === 'hang' ? 1.15 : 1.3, 0.85, 1.6);
      l.position.set(def.x, def.y, def.z); l.target.position.set(def.x, 0, def.z);
      if (keep.has(def)) {
        l.castShadow = true; l.shadow.mapSize.set(1024, 1024); l.shadow.bias = -0.003; l.shadow.normalBias = 0.02;
        l.shadow.camera.near = 0.25; l.shadow.camera.far = def.range ?? 14; l.shadow.autoUpdate = false; l.shadow.needsUpdate = true;
      }
      scene.add(l, l.target);
      this.lamps.push({ light: l, def, base: def.intensity, f: 1 });
    }
    this.buildShafts();
  }

  /** Fake volumetric light shafts under the skylights (additive, depth-faded). */
  private buildShafts(): void {
    const dir = this.sun.target.position.clone().sub(this.sun.position).normalize();
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      uniforms: { uColor: { value: new THREE.Color(0xfff2dc) }, uTime: { value: 0 } },
      vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `uniform vec3 uColor; uniform float uTime; varying vec2 vUv; varying vec3 vW;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        void main(){ float e = smoothstep(0.0,0.18,vUv.x)*smoothstep(1.0,0.82,vUv.x); float v = smoothstep(0.0,0.25,vUv.y)*(0.35+0.65*vUv.y);
          float d = 0.6 + 0.4*n(vec2(vW.x*0.9 + uTime*0.03, vW.y*0.5 - uTime*0.05));
          gl_FragColor = vec4(uColor * e * v * d * 0.05, 1.0); }`,
    });
    for (const s of this.level.skylights) {
      for (let i = 0; i < 4; i++) {
        const z = s.z0 + ((s.z1 - s.z0) * (i + 0.5)) / 4; const w = s.x1 - s.x0;
        const g = new THREE.PlaneGeometry(w, WALL_H, 1, 1); const p = g.getAttribute('position');
        for (let k = 0; k < p.count; k++) { const y = p.getY(k) + WALL_H / 2; const t = (WALL_H - y) / -dir.y; p.setXYZ(k, p.getX(k) + dir.x * t, y, dir.z * t); }
        const m = new THREE.Mesh(g, mat); m.position.set((s.x0 + s.x1) / 2, 0, z); m.frustumCulled = false; m.renderOrder = 5;
        this.scene.add(m); this.shafts.push(m);
      }
    }
  }

  update(t: number, playerPos: THREE.Vector3): void {
    (this.shafts[0]?.material as THREE.ShaderMaterial | undefined)?.uniforms.uTime && (((this.shafts[0].material as THREE.ShaderMaterial).uniforms.uTime.value = t));
    let flick = 1;
    for (const l of this.lamps) {
      if (l.def.flicker) {
        const n = Math.sin(t * 23.1) * Math.sin(t * 7.3 + 1.3) * Math.sin(t * 3.1); l.f = n > 0.35 ? 0.15 : n < -0.55 ? 0.6 : 1; flick = l.f;
        l.light.intensity = l.base * l.f;
      } else if (l.def.kind === 'emergency') { l.f = 0.75 + 0.25 * Math.sin(t * 2.2); l.light.intensity = l.base * l.f; }
    }
    this.mats.lampFlicker.emissiveIntensity = 7 * flick;
    this.mats.lampRed.emissiveIntensity = 4 + 2 * Math.sin(t * 2.2);
    // shadow budget: one shadow map per frame — the sun on even frames, one nearby fixture (round-robin) on odd frames
    if ((this.frame++ & 1) === 0) { this.sun.shadow.needsUpdate = true; return; }
    for (let i = 0; i < this.lamps.length; i++) {
      this.rr = (this.rr + 1) % this.lamps.length; const l = this.lamps[this.rr];
      if (l.light.castShadow && Math.hypot(l.def.x - playerPos.x, l.def.z - playerPos.z) < 20) { l.light.shadow.needsUpdate = true; break; }
    }
  }

  /** Cheap scene-brightness estimate at a position; drives the bodycam auto-exposure. */
  brightnessAt(p: THREE.Vector3): number {
    let b = 0.05;
    for (const l of this.lamps) { const d2 = (l.def.x - p.x) ** 2 + (l.def.z - p.z) ** 2; b += (l.base * l.f * 0.012) / (1 + d2 * 0.09); }
    for (const s of this.level.skylights) { const dx = Math.max(s.x0 - p.x, 0, p.x - s.x1), dz = Math.max(s.z0 - p.z, 0, p.z - s.z1); b += 0.55 / (1 + (dx * dx + dz * dz) * 0.06); }
    return b;
  }
}
