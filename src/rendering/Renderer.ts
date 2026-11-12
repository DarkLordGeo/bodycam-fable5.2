import * as THREE from 'three';
import { CFG } from '../config';

/** Owns the WebGL renderer, scene and camera, plus dynamic resolution scaling. */
export class Renderer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(CFG.camera.fov, 1, 0.04, 80);
  scale = 1; // dynamic resolution factor
  adaptive = true;
  onResize: ((w: number, h: number) => void) | null = null;
  private acc = 0; private frames = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true });
    this.renderer.info.autoReset = false; // reset once per frame in Game.tick so stats cover the whole post chain
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping; // tone mapping happens in the post chain
    this.scene.background = new THREE.Color(0x050608);
    this.scene.fog = new THREE.FogExp2(0x14171a, 0.018); // dusty air, adds depth
    this.scene.add(this.camera);
    window.addEventListener('resize', () => this.resize());
  }

  setEnvironment(hdr: THREE.DataTexture): void {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    this.scene.environment = pmrem.fromEquirectangular(hdr).texture;
    this.scene.environmentIntensity = 0.4;
    hdr.dispose(); pmrem.dispose();
  }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, CFG.quality.maxPixelRatio) * this.scale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.onResize?.(w, h);
  }

  /** Lowers / raises internal resolution to hold frame rate (responsive rendering resolution). */
  trackFrame(ms: number): void {
    if (!this.adaptive) return;
    this.acc += ms; this.frames++;
    if (this.acc < 1500) return;
    const avg = this.acc / this.frames; this.acc = 0; this.frames = 0;
    const prev = this.scale;
    if (avg > 19 && this.scale > 0.55) this.scale = Math.max(0.55, this.scale - 0.1);
    else if (avg < 12 && this.scale < 1) this.scale = Math.min(1, this.scale + 0.05);
    if (prev !== this.scale) this.resize();
  }
}
