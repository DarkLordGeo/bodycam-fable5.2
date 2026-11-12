/** requestAnimationFrame loop with clamped delta. `manual` lets automated tests step the simulation deterministically. */
export class GameLoop {
  manual = false;
  frameMs = 16;
  private last = 0;
  constructor(private tick: (dt: number, render: boolean) => void) {}
  start(): void { this.last = performance.now(); requestAnimationFrame(this.frame); }
  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const ms = now - this.last; this.last = now; this.frameMs = ms;
    if (!this.manual) this.tick(Math.min(Math.max(ms, 0) / 1000, 0.05), true);
  };
}
