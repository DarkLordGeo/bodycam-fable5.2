import * as THREE from 'three';
import type { AssetLoader, TextureSetName } from '../assets/AssetLoader';

export type Mats = Record<string, THREE.MeshStandardMaterial>;
/** World-space texel density (texture repeats per metre) used by the environment batcher. */
export const DENSITY: Record<string, number> = { wall: 0.34, floor: 0.26, ceiling: 0.5, plaster: 0.4, steel: 0.7, wood: 0.9 };

type Mode = 'wall' | 'floor' | 'prop';

/** Adds world-space grime / tone breakup (and painted dado + damp for walls) so tiling is never visible. */
function patchSurface(mat: THREE.MeshStandardMaterial, grime: THREE.Texture, mode: Mode): void {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uGrime = { value: grime };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 wpB = vec4(transformed, 1.0); vec3 wnB = normal;
        #ifdef USE_INSTANCING
          wpB = instanceMatrix * wpB; wnB = mat3(instanceMatrix) * wnB;
        #endif
        vWPos = (modelMatrix * wpB).xyz; vWNrm = normalize(mat3(modelMatrix) * wnB);`);
    const wall = `
        if (an.y < 0.5) {
          float band = smoothstep(1.36, 1.4, vWPos.y);
          float chip = smoothstep(0.62, 0.74, g2.g * 0.7 + g.r * 0.5);
          vec3 paint = vec3(0.16, 0.235, 0.215) * (0.75 + 0.5 * g.g);
          diffuseColor.rgb = mix(mix(paint, diffuseColor.rgb, chip), diffuseColor.rgb, band);
          float damp = 1.0 - smoothstep(0.0, 0.7, vWPos.y - g.b * 0.5 + 0.1);
          diffuseColor.rgb *= 1.0 - damp * 0.5;
          diffuseColor.rgb *= 1.0 - g.b * 0.3 * smoothstep(1.0, 4.2, vWPos.y);
          diffuseColor.rgb *= mix(1.0, 0.7, smoothstep(3.5, 4.2, vWPos.y));
        }`;
    const floor = `diffuseColor.rgb *= mix(0.8, 1.08, g2.b);`;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uGrime;\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 an = abs(vWNrm);
        vec2 guv = an.y > 0.5 ? vWPos.xz : (an.x > 0.5 ? vWPos.zy : vWPos.xy);
        vec3 g = texture2D(uGrime, guv * 0.071).rgb; vec3 g2 = texture2D(uGrime, guv * 0.233 + 0.37).rgb;
        diffuseColor.rgb *= mix(0.8, 1.1, g.g) * mix(0.9, 1.05, g2.r);
        ${mode === 'wall' ? wall : mode === 'floor' ? floor : ''}`);
  };
  mat.customProgramCacheKey = () => 'surf-' + mode;
}

export function createMaterials(a: AssetLoader): Mats {
  const pbr = (set: TextureSetName, color = 0xffffff, mode: Mode | null = 'prop', extra: THREE.MeshStandardMaterialParameters = {}) => {
    const s = a.set(set);
    const m = new THREE.MeshStandardMaterial({ map: s.albedo, normalMap: s.normal, aoMap: s.orm, roughnessMap: s.orm, metalnessMap: s.orm, roughness: 1, metalness: 1, color, ...extra });
    if (mode) patchSurface(m, a.grime, mode);
    return m;
  };
  const flat = (color: number, roughness = 0.7, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  const glow = (color: number, intensity: number) => new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: intensity, roughness: 0.4 });
  return {
    wall: pbr('concrete_wall', 0xffffff, 'wall', { normalScale: new THREE.Vector2(0.55, 0.55) }),
    floor: pbr('concrete_floor', 0xffffff, 'floor'),
    ceiling: pbr('corrugated', 0x8a9090, 'prop', { normalScale: new THREE.Vector2(0.6, 0.6) }),
    plaster: pbr('plaster', 0xb9b7ae),
    steel: pbr('metal_rust'),
    wood: pbr('wood_planks'),
    mGrey: pbr('metal_painted', 0x8d9296), mBlue: pbr('metal_painted', 0x2f5f9a), mRed: pbr('metal_painted', 0xa82a20), mGreen: pbr('metal_painted', 0x4c6a4a),
    mYellow: pbr('metal_painted', 0xd08a1c), mDark: pbr('metal_painted', 0x33373a), mBeige: pbr('metal_painted', 0xb5ab92),
    inst: pbr('metal_painted', 0xffffff), // instanced barrels (per-instance colour)
    card: flat(0x9b7a52, 0.9), rubber: flat(0x101010, 0.85), plastic: flat(0x1c1d1f, 0.45), paper: flat(0x8d897c, 0.9), dark: flat(0x050505, 0.9),
    chrome: flat(0x999999, 0.25, 1), copper: flat(0xb87333, 0.4, 1),
    lampOn: glow(0xfff1d6, 7), lampFlicker: glow(0xfff1d6, 7), lampWarm: glow(0xffc37a, 9), lampOff: flat(0x8a8a82, 0.4), lampRed: glow(0xff2a12, 6),
    window: glow(0xbfd4e6, 2.6), sky: glow(0xcfe0f0, 5.5), screen: glow(0x4fd68a, 1.3), ledRed: glow(0xff2a12, 4), ledGreen: glow(0x35ff6a, 3), ledAmber: glow(0xffa51e, 3),
  };
}

/** Small canvas-texture helpers for signs / decals (generated locally at runtime). */
export function canvasTexture(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
