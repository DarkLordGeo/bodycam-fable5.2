import { Uniform, Vector2 } from 'three';
import { Effect, EffectAttribute } from 'postprocessing';
import { CFG } from '../config';

const lensFrag = /* glsl */ `
uniform float uDistortion; uniform float uCA; uniform float uVignette; uniform float uExposure; uniform float uEdgeSoft; uniform vec2 uBlur;
#define TAPS 5
vec2 barrel(vec2 uv, float k) {
  vec2 c = uv - 0.5; c.x *= aspect; float r2 = dot(c, c); float rmax2 = 0.25 * (aspect * aspect + 1.0);
  c *= (1.0 + k * r2) / (1.0 + k * rmax2); c.x /= aspect; return c + 0.5;
}
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 c = uv - 0.5; float r2 = dot(c, c) * 2.0;
  vec2 duv = barrel(uv, uDistortion);
  vec2 ca = (duv - 0.5) * uCA * r2 * 2.0;              // chromatic aberration grows toward the edges
  vec2 radial = normalize(c + 1e-5) * uEdgeSoft * r2;  // cheap lens softness at the periphery
  vec3 col = vec3(0.0);
  for (int i = 0; i < TAPS; i++) {
    float t = float(i) / float(TAPS - 1) - 0.5;
    vec2 o = uBlur * t + radial * t * 2.0;
    col.r += texture2D(inputBuffer, duv + o + ca).r;
    col.g += texture2D(inputBuffer, duv + o).g;
    col.b += texture2D(inputBuffer, duv + o - ca).b;
  }
  col /= float(TAPS);
  col *= clamp(1.0 - uVignette * pow(r2, 1.3), 0.0, 1.0);
  outputColor = vec4(col * uExposure, inputColor.a);
}`;

const gradeFrag = /* glsl */ `
uniform float uGrain; uniform float uSaturation; uniform float uContrast;
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb; float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSaturation);
  c = (c - 0.5) * uContrast + 0.5;
  c = c * vec3(0.985, 1.0, 0.975) + vec3(0.010, 0.014, 0.012);           // small-sensor look: lifted, slightly green blacks
  float n = hash12(uv * resolution + fract(time * 7.13) * vec2(913.0, 517.0)) - 0.5;
  c += n * uGrain * (1.25 - l);                                            // sensor noise, stronger in shadows
  c += (hash12(vec2(floor(uv.y * resolution.y * 0.5), floor(time * 30.0))) - 0.5) * uGrain * 0.12; // faint row noise
  outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
}`;

/** Lens model: barrel distortion, edge chromatic aberration, vignette, motion blur, edge softness, exposure. */
export class BodycamLensEffect extends Effect {
  constructor() {
    super('BodycamLens', lensFrag, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, Uniform>([
        ['uDistortion', new Uniform(CFG.effects.distortion)], ['uCA', new Uniform(CFG.effects.chromaticAberration)], ['uVignette', new Uniform(CFG.effects.vignette)],
        ['uExposure', new Uniform(CFG.effects.exposure)], ['uEdgeSoft', new Uniform(CFG.effects.edgeSoftness)], ['uBlur', new Uniform(new Vector2())],
      ]),
    });
  }
}

/** Sensor model: grain, saturation, contrast, colour cast (runs after tone mapping). */
export class BodycamGradeEffect extends Effect {
  constructor() {
    super('BodycamGrade', gradeFrag, {
      uniforms: new Map<string, Uniform>([['uGrain', new Uniform(CFG.effects.grain)], ['uSaturation', new Uniform(CFG.effects.saturation)], ['uContrast', new Uniform(CFG.effects.contrast)]]),
    });
  }
}
