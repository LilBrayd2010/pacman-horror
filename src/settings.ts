/**
 * Settings panel + dev-tools wiring.
 *
 * Exposes a single `installSettingsPanel(game)` call that:
 *   - Restores persisted settings from localStorage and applies them
 *   - Wires the gear button (HUD), title "SETTINGS" button, and close button
 *   - Tab switching (Display / Audio / Dev)
 *   - Dev tools: password gate (2010), then floor-jump, toggles, animation replays, upgrade grants
 *
 * Dev tools are NOT hidden behind a build flag — they ship in production but are
 * unusable without the password, so casual players never see them.
 */
import type { Game } from './game';
import { play as playJumpscare, playRandom as playRandomJumpscare, JUMPSCARE_COUNT, type JumpscareId } from './jumpscares';

const STORAGE_KEY = 'soulchase.settings.v1';
const DEV_STORAGE_KEY = 'soulchase.dev.unlocked';
const DEV_PASSWORD = '2010';

interface Settings {
  renderScale: number;   // 0.4 .. 1.5
  joystickScale: number; // 0.6 .. 1.6
  hudScale: number;      // 0.75 .. 1.6
  fov: number;           // 60 .. 100
  masterVol: number;     // 0 .. 1
  lookSensitivity: number; // 0.25 .. 3
  invertY: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  renderScale: 1.0,
  joystickScale: 1.0,
  hudScale: 1.0,
  fov: 75,
  masterVol: 0.8,
  lookSensitivity: 1,
  invertY: false,
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(s: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // ignore quota errors — not fatal
  }
}

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

export function installSettingsPanel(game: Game): void {
  const panel = $('settings-panel');
  const openFromTitle = $<HTMLButtonElement>('title-settings');
  const openFromHud = $<HTMLButtonElement>('hud-settings-btn');
  const closeBtn = $<HTMLButtonElement>('settings-close');

  const settings = loadSettings();

  // -------- apply settings to game + DOM (runs on load + on every change) --------
  const apply = () => {
    game.setRenderScale(settings.renderScale);
    game.setFov(settings.fov);
    document.documentElement.style.setProperty('--joystick-scale', String(settings.joystickScale));
    document.documentElement.style.setProperty('--hud-scale', String(settings.hudScale));
    game.audio.setMasterVolume(settings.masterVol);
    game.setLookSensitivity(settings.lookSensitivity);
    game.setInvertPitch(settings.invertY);
  };
  apply();

  // -------- open / close panel --------
  // When opened mid-match, pause the run so the hunt doesn't keep ticking
  // while the player tunes sliders. Title-screen opens are noops for the game
  // clock because no run is active yet.
  const open = () => {
    panel.classList.remove('hidden');
    panel.classList.add('visible');
    if (game.hasActiveRun()) game.setSettingsPaused(true);
    refreshDevState();
  };
  const close = () => {
    panel.classList.add('hidden');
    panel.classList.remove('visible');
    game.setSettingsPaused(false);
  };
  openFromTitle.addEventListener('click', open);
  openFromHud.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  panel.addEventListener('click', (e) => {
    // click outside settings-window closes
    if (e.target === panel) close();
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && !panel.classList.contains('hidden')) close();
  });

  // -------- tab switching --------
  const tabs = document.querySelectorAll<HTMLButtonElement>('.set-tab');
  const panes = document.querySelectorAll<HTMLDivElement>('.set-pane');
  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      for (const t of tabs) t.classList.remove('active');
      tab.classList.add('active');
      for (const p of panes) p.classList.remove('active');
      const target = document.querySelector<HTMLDivElement>(`.set-pane[data-pane="${tab.dataset.tab}"]`);
      target?.classList.add('active');
    });
  }

  // -------- sliders --------
  const bindSlider = (
    id: string,
    valId: string,
    suffix: string,
    divisor: number,
    onChange: (v: number) => void,
    initial: number,
  ) => {
    const input = $<HTMLInputElement>(id);
    const valEl = $(valId);
    const percent = Math.round(initial * (divisor === 1 ? 1 : 100));
    input.value = String(divisor === 1 ? initial : percent);
    valEl.textContent = (divisor === 1 ? String(initial) : percent + '') + suffix;
    input.addEventListener('input', () => {
      const raw = Number(input.value);
      const real = divisor === 1 ? raw : raw / 100;
      valEl.textContent = (divisor === 1 ? String(raw) : raw + '') + suffix;
      onChange(real);
    });
  };

  bindSlider('set-render-scale', 'set-render-scale-val', '%', 100, (v) => {
    settings.renderScale = v;
    game.setRenderScale(v);
    saveSettings(settings);
  }, settings.renderScale);

  bindSlider('set-joystick-size', 'set-joystick-size-val', '%', 100, (v) => {
    settings.joystickScale = v;
    document.documentElement.style.setProperty('--joystick-scale', String(v));
    saveSettings(settings);
  }, settings.joystickScale);

  bindSlider('set-hud-scale', 'set-hud-scale-val', '%', 100, (v) => {
    settings.hudScale = v;
    document.documentElement.style.setProperty('--hud-scale', String(v));
    saveSettings(settings);
  }, settings.hudScale);

  bindSlider('set-fov', 'set-fov-val', '°', 1, (v) => {
    settings.fov = v;
    game.setFov(v);
    saveSettings(settings);
  }, settings.fov);

  bindSlider('set-master-vol', 'set-master-vol-val', '%', 100, (v) => {
    settings.masterVol = v;
    const audio = (game as unknown as { audio?: { setMasterVolume?: (vv: number) => void } }).audio;
    audio?.setMasterVolume?.(v);
    saveSettings(settings);
  }, settings.masterVol);

  bindSlider('set-look-sens', 'set-look-sens-val', '%', 100, (v) => {
    settings.lookSensitivity = v;
    game.setLookSensitivity(v);
    saveSettings(settings);
  }, settings.lookSensitivity);

  const invertYInput = $<HTMLInputElement>('set-invert-y');
  invertYInput.checked = settings.invertY;
  invertYInput.addEventListener('change', () => {
    settings.invertY = invertYInput.checked;
    game.setInvertPitch(invertYInput.checked);
    saveSettings(settings);
  });

  // =====================================================================
  // Dev tools
  // =====================================================================
  const devLocked = $('dev-locked');
  const devPanel = $('dev-panel');
  const devPwInput = $<HTMLInputElement>('dev-password');
  const devUnlockBtn = $<HTMLButtonElement>('dev-unlock');
  const devLockErr = $('dev-lock-err');

  const isDevUnlocked = () => {
    try { return sessionStorage.getItem(DEV_STORAGE_KEY) === '1'; } catch { return false; }
  };
  const setDevUnlocked = (v: boolean) => {
    try { if (v) sessionStorage.setItem(DEV_STORAGE_KEY, '1'); else sessionStorage.removeItem(DEV_STORAGE_KEY); } catch { /* ignore */ }
  };

  const showDevPanel = () => {
    devLocked.classList.add('hidden');
    devPanel.classList.remove('hidden');
    refreshDevState();
  };

  if (isDevUnlocked()) showDevPanel();

  const tryUnlock = () => {
    if (devPwInput.value.trim() === DEV_PASSWORD) {
      setDevUnlocked(true);
      devLockErr.classList.add('hidden');
      devPwInput.value = '';
      showDevPanel();
    } else {
      devLockErr.classList.remove('hidden');
      devPwInput.value = '';
      devPwInput.focus();
    }
  };
  devUnlockBtn.addEventListener('click', tryUnlock);
  devPwInput.addEventListener('keydown', (e) => {
    if (e.code === 'Enter') tryUnlock();
  });

  // ----- floor jump -----
  const floorSlider = $<HTMLInputElement>('dev-floor-slider');
  const floorValEl = $('dev-floor-val');
  floorSlider.addEventListener('input', () => {
    floorValEl.textContent = floorSlider.value;
  });
  $<HTMLButtonElement>('dev-jump-floor').addEventListener('click', () => {
    const n = Number(floorSlider.value);
    game.devJumpToFloor(n);
    close();
  });

  // ----- toggles -----
  $<HTMLInputElement>('dev-invincible').addEventListener('change', (e) => {
    game.setInvincible((e.target as HTMLInputElement).checked);
    refreshDevState();
  });
  $<HTMLInputElement>('dev-reveal-orbs').addEventListener('change', (e) => {
    game.setRevealOrbs((e.target as HTMLInputElement).checked);
  });
  $<HTMLInputElement>('dev-slow-pacman').addEventListener('change', (e) => {
    game.setSlowPacman((e.target as HTMLInputElement).checked);
    refreshDevState();
  });
  $<HTMLInputElement>('dev-infinite-stamina').addEventListener('change', (e) => {
    game.setInfiniteStamina((e.target as HTMLInputElement).checked);
    refreshDevState();
  });

  // ----- animation playback -----
  $<HTMLButtonElement>('dev-play-descent').addEventListener('click', () => {
    const overlay = $('descent-overlay');
    const caption = $('descent-caption');
    caption.textContent = 'DEEPER';
    overlay.classList.remove('hidden');
    overlay.style.animation = 'none';
    void overlay.offsetWidth;
    overlay.style.animation = '';
    window.setTimeout(() => overlay.classList.add('hidden'), 1600);
  });

  $<HTMLButtonElement>('dev-play-cutscene').addEventListener('click', () => {
    close();
    // Use the exposed game hook so all the real cutscene logic runs.
    // If there's an active run, trigger cliffhanger directly; else we just run the
    // DOM-side cutscene preview via a custom event main.ts listens to.
    if (game.isRunActive()) {
      game.devTriggerCliffhanger();
    } else {
      document.dispatchEvent(new CustomEvent('soulchase:preview-cutscene'));
    }
  });

  // ----- jumpscare previews (dev sampler for the 8 variants) -----
  const jumpAudio = { play: (id: number) => game.audio.playScreamVariant(id) };
  $<HTMLButtonElement>('dev-play-jumpscare-random').addEventListener('click', () => {
    close();
    void playRandomJumpscare(jumpAudio);
  });
  for (let i = 0; i < JUMPSCARE_COUNT; i++) {
    const btn = document.getElementById(`dev-play-jumpscare-${i}`) as HTMLButtonElement | null;
    if (!btn) continue;
    btn.addEventListener('click', () => {
      close();
      void playJumpscare(i as JumpscareId, jumpAudio);
    });
  }

  $<HTMLButtonElement>('dev-play-floortitle').addEventListener('click', () => {
    const title = $('hud-floortitle');
    const num = $('hud-floortitle-num');
    const name = $('hud-floortitle-name');
    num.textContent = 'FLOOR TEST / 20';
    name.textContent = 'PREVIEW';
    title.classList.remove('hidden');
    title.style.animation = 'none';
    void title.offsetWidth;
    title.style.animation = '';
    window.setTimeout(() => title.classList.add('hidden'), 2400);
  });

  // ----- grant upgrade -----
  $<HTMLButtonElement>('dev-grant-mini').addEventListener('click', () => {
    close();
    game.devForceUpgrade('mini');
  });
  $<HTMLButtonElement>('dev-grant-big').addEventListener('click', () => {
    close();
    game.devForceUpgrade('big');
  });

  // ----- run control -----
  $<HTMLButtonElement>('dev-win-floor').addEventListener('click', () => {
    close();
    game.devWinCurrentFloor();
  });
  $<HTMLButtonElement>('dev-kill-player').addEventListener('click', () => {
    close();
    game.devKillPlayer();
  });
  $<HTMLButtonElement>('dev-trigger-cliffhanger').addEventListener('click', () => {
    close();
    game.devTriggerCliffhanger();
  });

  function refreshDevState() {
    const el = document.getElementById('dev-state-readout');
    if (!el) return;
    el.textContent = game.devGetState();
  }
}
