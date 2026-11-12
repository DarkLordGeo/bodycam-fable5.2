/** Keyboard + mouse state with pointer lock. `pressed` holds edge-triggered keys for the current frame. */
export class Input {
  keys = new Set<string>();
  pressed = new Set<string>();
  buttons = [false, false, false];
  wheel = 0;
  locked = false;
  onLockChange: ((locked: boolean) => void) | null = null;
  private dx = 0; private dy = 0;

  constructor(private canvas: HTMLCanvasElement, private testMode: boolean) {
    document.addEventListener('keydown', (e) => { if (e.code === 'Tab' || e.code === 'Space') e.preventDefault(); if (!e.repeat) { this.keys.add(e.code); this.pressed.add(e.code); } });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    document.addEventListener('mousemove', (e) => { if (this.locked) { this.dx += e.movementX; this.dy += e.movementY; } });
    document.addEventListener('mousedown', (e) => { if (this.locked && e.button < 3) { this.buttons[e.button] = true; this.pressed.add('Mouse' + e.button); } });
    document.addEventListener('mouseup', (e) => { if (e.button < 3) this.buttons[e.button] = false; });
    document.addEventListener('wheel', (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => { if (this.testMode) return; this.locked = document.pointerLockElement === this.canvas; if (!this.locked) { this.keys.clear(); this.buttons.fill(false); } this.onLockChange?.(this.locked); });
    window.addEventListener('blur', () => { this.keys.clear(); this.buttons.fill(false); });
  }

  requestLock(): void {
    if (this.testMode) { this.locked = true; this.onLockChange?.(true); return; }
    const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
    p?.catch?.(() => {});
  }
  down(code: string): boolean { return this.keys.has(code); }
  consumeMouse(): { dx: number; dy: number } { const r = { dx: this.dx, dy: this.dy }; this.dx = 0; this.dy = 0; return r; }
  /** Test hook: inject look movement. */
  injectMouse(dx: number, dy: number): void { this.dx += dx; this.dy += dy; }
  endFrame(): void { this.pressed.clear(); this.wheel = 0; }
}
