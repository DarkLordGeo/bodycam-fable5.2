import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

const BASE = import.meta.env.BASE_URL + 'assets/';
export const TEXTURE_SETS = ['concrete_wall', 'concrete_floor', 'metal_painted', 'metal_rust', 'wood_planks', 'corrugated', 'plaster', 'fabric'] as const;
export type TextureSetName = (typeof TEXTURE_SETS)[number];
export interface TextureSet { albedo: THREE.Texture; normal: THREE.Texture; orm: THREE.Texture }

/** Loads every runtime asset from the local /assets folder (no third-party URLs at runtime). */
export class AssetLoader {
  sets = new Map<TextureSetName, TextureSet>();
  grime!: THREE.Texture;
  hdr!: THREE.DataTexture;
  soldier!: GLTF;

  async loadAll(onProgress: (f: number) => void): Promise<void> {
    const tl = new THREE.TextureLoader();
    let done = 0;
    const jobs: Promise<unknown>[] = [];
    const track = <T>(p: Promise<T>): Promise<T> => { jobs.push(p); p.then(() => onProgress(++done / jobs.length)); return p; };
    const tex = (file: string, srgb: boolean) => track(tl.loadAsync(BASE + 'textures/' + file)).then((t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; return t;
    });
    for (const name of TEXTURE_SETS) {
      Promise.all([tex(name + '_albedo.jpg', true), tex(name + '_normal.jpg', false), tex(name + '_orm.jpg', false)]).then(([albedo, normal, orm]) => this.sets.set(name, { albedo, normal, orm }));
    }
    tex('grime.jpg', false).then((t) => (this.grime = t));
    track(new HDRLoader().loadAsync(BASE + 'environment/pedestrian_overpass_1k.hdr')).then((t) => (this.hdr = t));
    track(new GLTFLoader().loadAsync(BASE + 'models/soldier.glb')).then((g) => (this.soldier = g));
    await Promise.all(jobs);
    await Promise.resolve();
  }

  set(name: TextureSetName): TextureSet { return this.sets.get(name)!; }
}
