import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode } from 'postprocessing';
import { BodycamLensEffect, BodycamGradeEffect } from '../camera/CameraEffects';
import { CFG } from '../config';
import type { Renderer } from './Renderer';

/** Post chain: scene → bloom → lens (distortion/CA/blur/vignette/exposure) → AgX tone map → sensor grade. */
export class PostProcessing {
  composer: EffectComposer;
  lens = new BodycamLensEffect();
  grade = new BodycamGradeEffect();
  bloom: BloomEffect;
  private exposure = 1;
  private flash = 0;

  constructor(r: Renderer) {
    const maxSamples = r.renderer.capabilities.maxSamples;
    this.composer = new EffectComposer(r.renderer, { frameBufferType: THREE.HalfFloatType, multisampling: Math.min(CFG.quality.msaa, maxSamples) });
    this.composer.addPass(new RenderPass(r.scene, r.camera));
    this.bloom = new BloomEffect({ intensity: CFG.effects.bloom, luminanceThreshold: 1.0, luminanceSmoothing: 0.4, mipmapBlur: true, radius: 0.7 });
    this.composer.addPass(new EffectPass(r.camera, this.bloom));
    this.composer.addPass(new EffectPass(r.camera, this.lens, new ToneMappingEffect({ mode: ToneMappingMode.AGX }), this.grade));
    r.onResize = (w, h) => this.composer.setSize(w, h);
  }

  /** Re-reads CFG.effects so effects can be tuned live (e.g. from the console). */
  applyConfig(): void {
    const u = this.lens.uniforms, e = CFG.effects;
    u.get('uDistortion')!.value = e.distortion; u.get('uCA')!.value = e.chromaticAberration; u.get('uVignette')!.value = e.vignette; u.get('uEdgeSoft')!.value = e.edgeSoftness;
    const g = this.grade.uniforms; g.get('uGrain')!.value = e.grain; g.get('uSaturation')!.value = e.saturation; g.get('uContrast')!.value = e.contrast;
    this.bloom.intensity = e.bloom;
  }

  /** Muzzle flash etc. briefly blows out, then the auto-exposure dips and recovers. */
  addFlash(v: number): void { this.flash = Math.min(0.3, this.flash + v); }

  update(dt: number, sceneBrightness: number, blur: THREE.Vector2): void {
    // auto exposure: slow adaptation toward a target that keeps mid-grey roughly constant (clamped like a real sensor)
    const target = THREE.MathUtils.clamp(0.42 / (sceneBrightness + this.flash * 0.5), 0.55, 2.4) * CFG.effects.exposure;
    this.exposure += (target - this.exposure) * Math.min(1, dt * CFG.effects.autoExposureSpeed);
    this.flash = Math.max(0, this.flash - dt * 2.2);
    this.lens.uniforms.get('uExposure')!.value = this.exposure;
    (this.lens.uniforms.get('uBlur')!.value as THREE.Vector2).copy(blur).multiplyScalar(CFG.effects.motionBlur);
  }

  render(dt: number): void { this.composer.render(dt); }
}
