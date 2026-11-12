import { FullGame } from './core/FullGame';

const canvas = document.getElementById('game') as HTMLCanvasElement;
FullGame.create(canvas)
  .then((game) => { (window as unknown as { __game: unknown }).__game = game; })
  .catch((err) => {
    console.error(err);
    document.getElementById('ov-title')!.textContent = 'FAILED TO START';
    document.getElementById('ov-sub')!.textContent = String(err?.message ?? err);
  });
