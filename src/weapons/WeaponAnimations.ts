/** Small procedural-animation toolkit shared by the weapons. */

/** Damped spring (semi-implicit Euler). */
export class Spring {
  x = 0; v = 0;
  constructor(public omega: number, public zeta: number) {}
  step(target: number, dt: number): number { this.v += (this.omega * this.omega * (target - this.x) - 2 * this.zeta * this.omega * this.v) * dt; this.x += this.v * dt; return this.x; }
  reset(x = 0): void { this.x = x; this.v = 0; }
}

const ease = (t: number): number => t * t * (3 - 2 * t);

/**
 * Keyframe sampler. keys = [[time, v0, v1, …], …] sorted by time; values are eased between keys.
 * Returns the interpolated value at channel `ch`.
 */
export function kf(t: number, keys: number[][], ch = 1): number {
  if (t <= keys[0][0]) return keys[0][ch];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) { const a = keys[i - 1], b = keys[i]; const u = ease((t - a[0]) / (b[0] - a[0])); return a[ch] + (b[ch] - a[ch]) * u; }
  }
  return keys[keys.length - 1][ch];
}
