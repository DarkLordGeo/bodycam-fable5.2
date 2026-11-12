import type { Phase } from '../core/GameState';

const $ = (id: string) => document.getElementById(id)!;

/** Minimal DOM HUD: health, weapon, ammo, bodycam timestamp, short contextual hints. No menus. */
export class HUD {
  private hintTimer = 0; private dmg = 0; private last = '';
  private start = new Date();

  setLoading(f: number): void { $('ov-sub').textContent = Math.round(f * 100) + '%'; }

  setPhase(phase: Phase, hostilesLeft: number, time: number): void {
    const ov = $('overlay'); const title = $('ov-title'), sub = $('ov-sub'), keys = $('ov-keys');
    ov.classList.toggle('hidden', phase === 'playing');
    document.getElementById('hud')!.style.opacity = phase === 'playing' ? '1' : '0.25';
    const controls = 'WASD move · SHIFT sprint · C crouch · LMB fire · RMB aim · R reload · 1/2 weapon';
    if (phase === 'ready') { title.textContent = 'FACILITY 7'; sub.textContent = 'CLICK TO DEPLOY — ELIMINATE ALL HOSTILES'; keys.textContent = controls; }
    else if (phase === 'paused') { title.textContent = 'PAUSED'; sub.textContent = 'CLICK TO RESUME'; keys.textContent = controls; }
    else if (phase === 'dead') { title.textContent = 'SIGNAL LOST'; sub.textContent = `OFFICER DOWN — ${hostilesLeft} HOSTILE${hostilesLeft === 1 ? '' : 'S'} REMAINING`; keys.textContent = 'CLICK TO RESTART'; }
    else if (phase === 'won') { title.textContent = 'FACILITY SECURE'; sub.textContent = `ALL HOSTILES ELIMINATED — ${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`; keys.textContent = 'CLICK TO RESTART'; }
  }

  hint(text: string, seconds = 1.6): void { const h = $('hint'); h.textContent = text; h.style.opacity = '0.85'; this.hintTimer = seconds; }
  damageFlash(amount: number): void { this.dmg = Math.min(1, this.dmg + 0.35 + amount / 60); }

  update(dt: number, health: number, weapon: string, mag: number, reserve: number, hostiles: number, missionTime: number): void {
    if (this.hintTimer > 0 && (this.hintTimer -= dt) <= 0) $('hint').style.opacity = '0';
    this.dmg = Math.max(health < 30 ? 0.35 : 0, this.dmg - dt * 1.3); $('damage').style.opacity = String(this.dmg);
    const key = `${Math.ceil(health)}|${weapon}|${mag}|${reserve}|${hostiles}|${Math.floor(missionTime)}`;
    if (key === this.last) return; this.last = key;
    $('health').textContent = String(Math.ceil(health)); ($('health-fill') as HTMLElement).style.width = Math.min(100, Math.max(0, health)) + '%';
    $('weapon').textContent = weapon; $('ammo').textContent = `${String(mag).padStart(2, '0')} / ${String(reserve).padStart(3, '0')}`;
    $('hostiles').textContent = `HOSTILES ${hostiles}`;
    const d = new Date(this.start.getTime() + missionTime * 1000);
    $('clock').textContent = d.toISOString().replace('T', ' ').slice(0, 19) + 'Z';
  }
}
