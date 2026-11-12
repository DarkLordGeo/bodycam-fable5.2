export type Phase = 'loading' | 'ready' | 'playing' | 'paused' | 'dead' | 'won';

/** Minimal mission state machine. */
export class GameState {
  phase: Phase = 'loading';
  missionTime = 0;
  onChange: ((phase: Phase, prev: Phase) => void) | null = null;
  set(phase: Phase): void { if (phase === this.phase) return; const prev = this.phase; this.phase = phase; this.onChange?.(phase, prev); }
  get active(): boolean { return this.phase === 'playing'; }
  get ended(): boolean { return this.phase === 'dead' || this.phase === 'won'; }
}
