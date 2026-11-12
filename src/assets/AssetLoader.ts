import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { ROOM_MANIFEST } from './RoomManifest';
import type { RoomId } from '../environment/Rooms';

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

  private roomCache = new Map<RoomId, Promise<THREE.Group | null>>();
  /**
   * Loads a room's imported visuals on demand (never during startup). Resolves to null when the room has no
   * manifest entry or its file is not present / not a binary glTF, so a missing asset is not a crash.
   */
  loadRoom(room: RoomId): Promise<THREE.Group | null> {
    let p = this.roomCache.get(room);
    if (!p) {
      p = (async () => {
        const a = ROOM_MANIFEST[room]; if (!a) return null;
        const url = `${BASE}${a.file}?v=${a.version}`;
        const res = await fetch(url).catch(() => null); if (!res || !res.ok) return null;
        const buf = await res.arrayBuffer();
        if (buf.byteLength < 12 || new DataView(buf).getUint32(0, true) !== 0x46546c67) return null; // not 'glTF' (e.g. an SPA fallback page)
        const loader = new GLTFLoader();
        // meshopt-compressed files are supported without adding a dependency; the decoder is only fetched here
        const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');
        loader.setMeshoptDecoder(MeshoptDecoder);
        const gltf = await loader.parseAsync(buf, url.slice(0, url.lastIndexOf('/') + 1));
        return gltf.scene;
      })();
      this.roomCache.set(room, p);
    }
    return p;
  }
}
