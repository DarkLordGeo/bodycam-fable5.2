import * as THREE from 'three';

type Vec = { x: number; y: number; z: number };
interface NoiseOpt { dur: number; gain: number; type?: BiquadFilterType; f0: number; f1?: number; q?: number; attack?: number; pos?: Vec; wet?: number; rate?: number; delay?: number }
interface ToneOpt { dur: number; gain: number; f0: number; f1?: number; wave?: OscillatorType; pos?: Vec; wet?: number; delay?: number; attack?: number }

/**
 * Fully synthesised audio (Web Audio API): no sample files, so nothing to license or download.
 * Gunshots, mechanics, footsteps, impacts and ambience are built from filtered noise + oscillators,
 * routed through HRTF panners and a generated-impulse convolution reverb for the indoor space.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode; private reverb!: ConvolverNode; private wetBus!: GainNode; private noise!: AudioBuffer;
  private heart = 0; private dripT = 3; private stepAlt = false;
  private fwd = new THREE.Vector3(); private up = new THREE.Vector3();

  /** Must be called from a user gesture. */
  init(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = (this.ctx = new AC());
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6; comp.attack.value = 0.002; comp.release.value = 0.18; comp.connect(ctx.destination);
    this.master = ctx.createGain(); this.master.gain.value = 0.8; this.master.connect(comp);
    // noise source
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = this.noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // generated impulse response: concrete hall, ~1.7 s tail with early reflections
    const len = Math.floor(ctx.sampleRate * 1.7); const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const b = ir.getChannelData(ch); let lp = 0; for (let i = 0; i < len; i++) { const t = i / len; const n = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.2); lp += (n - lp) * (0.55 - t * 0.4); b[i] = lp; } for (const [ms, g] of [[11, 0.5], [23, 0.35], [37, 0.3], [58, 0.2]]) b[Math.floor(((ms + ch * 3) / 1000) * ctx.sampleRate)] += g; }
    this.reverb = ctx.createConvolver(); this.reverb.buffer = ir; this.wetBus = ctx.createGain(); this.wetBus.gain.value = 0.55; this.reverb.connect(this.wetBus); this.wetBus.connect(this.master);
    this.startAmbience();
  }
  get on(): boolean { return !!this.ctx && this.ctx.state === 'running'; }

  private out(src: AudioNode, gain: GainNode, pos: Vec | undefined, wet: number): void {
    const ctx = this.ctx!; let node: AudioNode = gain; src.connect(gain);
    if (pos) { const p = ctx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 2.2; p.rolloffFactor = 1.1; p.maxDistance = 60; p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; gain.connect(p); node = p; }
    node.connect(this.master);
    if (wet > 0) { const w = ctx.createGain(); w.gain.value = wet; node.connect(w); w.connect(this.reverb); }
  }
  private burst(o: NoiseOpt): void {
    const ctx = this.ctx!; const t = ctx.currentTime + (o.delay ?? 0);
    const s = ctx.createBufferSource(); s.buffer = this.noise; s.playbackRate.value = o.rate ?? 1; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = o.type ?? 'lowpass'; f.Q.value = o.q ?? 0.7; f.frequency.setValueAtTime(o.f0, t); if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(o.gain, t + (o.attack ?? 0.002)); g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    s.connect(f); this.out(f, g, o.pos, o.wet ?? 0.2); s.start(t, Math.random() * 1.5); s.stop(t + o.dur + 0.05);
  }
  private tone(o: ToneOpt): void {
    const ctx = this.ctx!; const t = ctx.currentTime + (o.delay ?? 0);
    const s = ctx.createOscillator(); s.type = o.wave ?? 'sine'; s.frequency.setValueAtTime(o.f0, t); if (o.f1) s.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(o.gain, t + (o.attack ?? 0.002)); g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    this.out(s, g, o.pos, o.wet ?? 0.15); s.start(t); s.stop(t + o.dur + 0.05);
  }

  shot(kind: 'pistol' | 'rifle' | 'enemy', pos?: Vec): void {
    if (!this.on) return;
    if (kind === 'pistol') { this.burst({ dur: 0.16, gain: 1.0, type: 'bandpass', f0: 3200, f1: 500, q: 0.6, wet: 0.5 }); this.burst({ dur: 0.05, gain: 0.9, type: 'highpass', f0: 2500, wet: 0.2 }); this.tone({ dur: 0.12, gain: 0.9, f0: 190, f1: 55, wet: 0.3 }); this.burst({ dur: 0.5, gain: 0.25, f0: 900, f1: 200, wet: 0.9 }); }
    else if (kind === 'rifle') { this.burst({ dur: 0.2, gain: 1.1, type: 'bandpass', f0: 2100, f1: 300, q: 0.5, wet: 0.55 }); this.burst({ dur: 0.04, gain: 1.0, type: 'highpass', f0: 3500, wet: 0.2 }); this.tone({ dur: 0.16, gain: 1.1, f0: 140, f1: 42, wet: 0.35 }); this.burst({ dur: 0.7, gain: 0.3, f0: 700, f1: 150, wet: 1.0 }); this.tone({ dur: 0.03, gain: 0.25, f0: 2400, f1: 1500, wave: 'square', delay: 0.03, wet: 0 }); }
    else { this.burst({ dur: 0.22, gain: 1.5, type: 'bandpass', f0: 1500, f1: 250, q: 0.5, pos, wet: 0.8 }); this.tone({ dur: 0.18, gain: 1.4, f0: 130, f1: 45, pos, wet: 0.5 }); this.burst({ dur: 0.6, gain: 0.35, f0: 600, f1: 140, pos, wet: 1.0 }); }
  }
  mech(kind: 'magOut' | 'magIn' | 'rack' | 'dry' | 'switch' | 'aim'): void {
    if (!this.on) return;
    const click = (f: number, g: number, delay = 0, dur = 0.035) => { this.burst({ dur, gain: g, type: 'bandpass', f0: f, q: 3, delay, wet: 0.1 }); this.tone({ dur: dur * 0.8, gain: g * 0.35, f0: f * 0.9, f1: f * 0.5, wave: 'triangle', delay, wet: 0.05 }); };
    if (kind === 'magOut') { click(1800, 0.3); this.burst({ dur: 0.12, gain: 0.12, type: 'bandpass', f0: 900, q: 1, delay: 0.03 }); }
    else if (kind === 'magIn') { this.burst({ dur: 0.09, gain: 0.14, type: 'bandpass', f0: 700, q: 1 }); click(1300, 0.4, 0.07, 0.05); click(2600, 0.2, 0.09); }
    else if (kind === 'rack') { click(2200, 0.35); this.burst({ dur: 0.07, gain: 0.2, type: 'bandpass', f0: 1500, f1: 3000, q: 1.5, delay: 0.02 }); click(1700, 0.45, 0.1, 0.05); }
    else if (kind === 'dry') click(3200, 0.22, 0, 0.02);
    else if (kind === 'aim') this.burst({ dur: 0.08, gain: 0.035, type: 'bandpass', f0: 2400, q: 0.8 });
    else { this.burst({ dur: 0.22, gain: 0.09, type: 'bandpass', f0: 1200, f1: 500, q: 0.7 }); click(1500, 0.16, 0.16); }
  }
  footstep(sprint: boolean, pos?: Vec): void {
    if (!this.on) return;
    this.stepAlt = !this.stepAlt; const g = (sprint ? 0.34 : 0.2) * (pos ? 1.6 : 1), p = this.stepAlt ? 1 : 0.88;
    this.burst({ dur: 0.09, gain: g, f0: 420 * p, f1: 90, pos, wet: 0.35 }); this.burst({ dur: 0.035, gain: g * 0.5, type: 'bandpass', f0: 1900 * p, q: 1.2, pos, wet: 0.3 });
    if (sprint || pos) this.burst({ dur: 0.06, gain: g * 0.25, type: 'highpass', f0: 3000, delay: 0.02, pos, wet: 0.2 }); // gear rustle
  }
  impact(pos: Vec, flesh: boolean): void {
    if (!this.on) return;
    if (flesh) { this.burst({ dur: 0.09, gain: 0.5, f0: 600, f1: 120, pos, wet: 0.15 }); return; }
    this.burst({ dur: 0.07, gain: 0.6, type: 'highpass', f0: 1800, pos, wet: 0.5 }); this.burst({ dur: 0.18, gain: 0.3, f0: 800, f1: 150, pos, wet: 0.5 });
    if (Math.random() < 0.3) this.tone({ dur: 0.35, gain: 0.12, f0: 3600 + Math.random() * 1500, f1: 900, pos, wet: 0.6 });
  }
  shell(pos: Vec): void { if (this.on) { const f = 4200 + Math.random() * 1800; this.tone({ dur: 0.09, gain: 0.07, f0: f, f1: f * 0.92, pos, wet: 0.4 }); this.tone({ dur: 0.06, gain: 0.04, f0: f * 1.5, pos, wet: 0.4, delay: 0.07 }); } }
  hurt(): void { if (this.on) { this.tone({ dur: 0.25, gain: 0.8, f0: 110, f1: 40, wet: 0.1 }); this.burst({ dur: 0.12, gain: 0.35, f0: 500, f1: 100, wet: 0.1 }); } }
  bodyFall(pos: Vec): void { if (this.on) { this.burst({ dur: 0.22, gain: 0.8, f0: 260, f1: 60, pos, wet: 0.4 }); this.burst({ dur: 0.1, gain: 0.3, type: 'bandpass', f0: 1500, q: 1, pos, delay: 0.05, wet: 0.3 }); } }
  nearMiss(): void { if (this.on) this.burst({ dur: 0.1, gain: 0.3, type: 'bandpass', f0: 5000, f1: 1500, q: 3, wet: 0.2 }); }

  private startAmbience(): void {
    const ctx = this.ctx!;
    // room tone
    const s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 180; const g = ctx.createGain(); g.gain.value = 0.11; s.connect(f); f.connect(g); g.connect(this.master); s.start();
    // air handling: slowly modulated band noise
    const s2 = ctx.createBufferSource(); s2.buffer = this.noise; s2.loop = true; s2.playbackRate.value = 0.6; const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 520; f2.Q.value = 0.5; const g2 = ctx.createGain(); g2.gain.value = 0.018;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; const lg = ctx.createGain(); lg.gain.value = 0.009; lfo.connect(lg); lg.connect(g2.gain); lfo.start(); s2.connect(f2); f2.connect(g2); g2.connect(this.master); g2.connect(this.reverb); s2.start();
    // positional electrical hum (generator room) and flickering tube buzz (corridor)
    const hum = (x: number, z: number, freq: number, gain: number) => { const p = ctx.createPanner(); p.panningModel = 'HRTF'; p.refDistance = 2.5; p.rolloffFactor = 1.6; p.positionX.value = x; p.positionY.value = 1.5; p.positionZ.value = z; const gg = ctx.createGain(); gg.gain.value = gain; for (const [m, a] of [[1, 1], [2, 0.5], [3, 0.3], [5, 0.1]]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq * m; const og = ctx.createGain(); og.gain.value = a; const lp = ctx.createBiquadFilter(); lp.frequency.value = 400; o.connect(lp); lp.connect(og); og.connect(gg); o.start(); } gg.connect(p); p.connect(this.master); };
    hum(33.4, 13.2, 50, 0.16); hum(18.25, 7, 100, 0.03); hum(21.2, 1, 120, 0.035);
  }

  /** Per-frame: listener pose, heartbeat at low health, random environmental one-shots. */
  update(dt: number, camera: THREE.Camera, health: number, alive: boolean): void {
    if (!this.on) return;
    const ctx = this.ctx!, l = ctx.listener, p = camera.position;
    camera.getWorldDirection(this.fwd); this.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    if (l.positionX) { l.positionX.value = p.x; l.positionY.value = p.y; l.positionZ.value = p.z; l.forwardX.value = this.fwd.x; l.forwardY.value = this.fwd.y; l.forwardZ.value = this.fwd.z; l.upX.value = this.up.x; l.upY.value = this.up.y; l.upZ.value = this.up.z; }
    else { l.setPosition(p.x, p.y, p.z); l.setOrientation(this.fwd.x, this.fwd.y, this.fwd.z, this.up.x, this.up.y, this.up.z); }
    if (alive && health < 40) { this.heart -= dt; if (this.heart <= 0) { this.heart = 0.55 + health / 100; this.tone({ dur: 0.12, gain: 0.5, f0: 70, f1: 40, wet: 0 }); this.tone({ dur: 0.1, gain: 0.35, f0: 60, f1: 38, delay: 0.17, wet: 0 }); } }
    this.dripT -= dt;
    if (this.dripT <= 0) {
      this.dripT = 2.5 + Math.random() * 7; const pos = { x: p.x + (Math.random() - 0.5) * 16, y: 0.2 + Math.random() * 3.5, z: p.z + (Math.random() - 0.5) * 16 };
      if (Math.random() < 0.6) this.tone({ dur: 0.07, gain: 0.07, f0: 1500 + Math.random() * 900, f1: 700, pos, wet: 0.9 }); else this.burst({ dur: 0.5, gain: 0.05, type: 'bandpass', f0: 180 + Math.random() * 200, q: 4, pos, wet: 1, attack: 0.1 }); // drip / metal creak
    }
  }
}
