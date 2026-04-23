import { Controls } from './controls';
import { Game, type Difficulty } from './game';

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

function main() {
  const canvas = $<HTMLCanvasElement>('game-canvas');
  const startScreen = $('start-screen');
  const hud = $('hud');
  const touchControls = $('touch-controls');
  const soulCountEl = $('hud-soul-count');
  const soulTargetEl = $('hud-soul-target');
  const staminaBar = $('hud-stamina-bar');
  const vignette = $('hud-vignette');
  const heartbeat = $('hud-heartbeat');
  const warning = $('hud-warning');
  const winScreen = $('win-screen');
  const loseScreen = $('lose-screen');
  const winAgain = $('win-again');
  const loseAgain = $('lose-again');

  const isTouch = Controls.isTouchDevice();

  const game = new Game(canvas, {
    onSoulUpdate: (collected, total) => {
      soulCountEl.textContent = String(collected);
      soulTargetEl.textContent = String(total);
    },
    onStaminaUpdate: (stamina) => {
      staminaBar.style.width = `${Math.round(stamina * 100)}%`;
      staminaBar.classList.toggle('low', stamina < 0.25);
    },
    onTensionUpdate: (tension) => {
      vignette.classList.toggle('danger', tension > 0.55);
      heartbeat.style.opacity = String(Math.min(1, tension));
      warning.classList.toggle('hidden', tension <= 0.8);
    },
    onEnd: (reason) => {
      if (isTouch) touchControls.classList.add('hidden');
      hud.classList.add('hidden');
      if (reason === 'win') {
        winScreen.classList.remove('hidden');
        winScreen.classList.add('visible');
      } else {
        loseScreen.classList.remove('hidden');
        loseScreen.classList.add('visible');
      }
    },
  });

  const showStart = () => {
    winScreen.classList.add('hidden');
    winScreen.classList.remove('visible');
    loseScreen.classList.add('hidden');
    loseScreen.classList.remove('visible');
    hud.classList.add('hidden');
    touchControls.classList.add('hidden');
    startScreen.classList.remove('hidden');
    startScreen.classList.add('visible');
  };

  const beginGame = (difficulty: Difficulty) => {
    startScreen.classList.add('hidden');
    startScreen.classList.remove('visible');
    hud.classList.remove('hidden');
    if (isTouch) touchControls.classList.remove('hidden');
    // reset hud state
    vignette.classList.remove('danger');
    heartbeat.style.opacity = '0';
    warning.classList.add('hidden');
    game.start(difficulty);
  };

  for (const btn of document.querySelectorAll<HTMLButtonElement>('.diff-btn')) {
    btn.addEventListener('click', () => {
      const diff = btn.dataset.difficulty as Difficulty;
      beginGame(diff);
    });
  }

  winAgain.addEventListener('click', showStart);
  loseAgain.addEventListener('click', showStart);
}

document.addEventListener('DOMContentLoaded', main);
