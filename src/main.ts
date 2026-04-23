import { Controls } from './controls';
import { Game, type Difficulty, type RunStats } from './game';
import { getAllUpgrades, type Upgrade, type UpgradeTier } from './upgrades';
import { installSettingsPanel } from './settings';

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

/** Placeholder strings — swap in the real lore line(s) when @LilBrayd2010 provides them. */
const LORE_LINE_PLACEHOLDER = '{{LORE_LINE_PLACEHOLDER}}';
const BIGGER_HUNTER_NAME = '{{BIGGER_HUNTER_NAME}}';

function main() {
  const canvas = $<HTMLCanvasElement>('game-canvas');
  const titleScreen = $('title-screen');
  const startScreen = $('start-screen');
  const abilitiesScreen = $('abilities-screen');
  const hud = $('hud');
  const touchControls = $('touch-controls');
  const soulCountEl = $('hud-soul-count');
  const soulTargetEl = $('hud-soul-target');
  const staminaBar = $('hud-stamina-bar');
  const vignette = $('hud-vignette');
  const heartbeat = $('hud-heartbeat');
  const warning = $('hud-warning');
  const floorLabel = $('hud-floor');
  const miniFill = $('hud-minibar-fill');
  const shieldIcon = $('hud-shieldicon');
  const activeUpgradesEl = $('hud-activeupgrades');
  const floorTitle = $('hud-floortitle');
  const floorTitleNum = $('hud-floortitle-num');
  const floorTitleName = $('hud-floortitle-name');
  const descentOverlay = $('descent-overlay');
  const descentCaption = $('descent-caption');
  const upgradeOverlay = $('upgrade-overlay');
  const upgradeTierLabel = $('upgrade-tier');
  const upgradeCardsEl = $('upgrade-cards');
  const cutsceneOverlay = $('cutscene-overlay');
  const cutsceneFrame = $('cutscene-frame');
  const cutsceneCaption = $('cutscene-caption');
  const cutsceneSkip = $<HTMLButtonElement>('cutscene-skip');
  const loseScreen = $('lose-screen');
  const loseAgain = $<HTMLButtonElement>('lose-again');
  const loseStats = $('lose-stats');
  const cliffScreen = $('cliffhanger-screen');
  const cliffAgain = $<HTMLButtonElement>('cliff-again');
  const cliffStats = $('cliff-stats');

  const isTouch = Controls.isTouchDevice();

  // track how many upgrades the player owns so the HUD can reflect active effects
  const game = new Game(canvas, {
    onSoulUpdate: (collected, total) => {
      soulCountEl.textContent = String(collected);
      soulTargetEl.textContent = String(total);
    },
    onStaminaUpdate: (stamina) => {
      staminaBar.style.width = `${Math.round(Math.max(0, Math.min(1, stamina)) * 100)}%`;
      staminaBar.classList.toggle('low', stamina < 0.25);
    },
    onTensionUpdate: (tension) => {
      vignette.classList.toggle('danger', tension > 0.55);
      heartbeat.style.opacity = String(Math.min(1, tension));
      warning.classList.toggle('hidden', tension <= 0.8);
    },
    onFloorEnter: (floor, theme, soulsNeeded) => {
      const labelPrefix = floor === 20 ? 'BOSS · ' : `FLOOR ${floor} · `;
      floorLabel.textContent = labelPrefix + theme.name;
      floorLabel.style.color = theme.accentHex;
      soulCountEl.textContent = '0';
      soulTargetEl.textContent = String(soulsNeeded);
      // center flash
      floorTitleNum.textContent = floor === 20 ? 'BOSS FLOOR' : `FLOOR ${floor} / 20`;
      floorTitleName.textContent = theme.name;
      floorTitle.classList.remove('hidden');
      // retrigger animation
      floorTitle.style.animation = 'none';
      void floorTitle.offsetWidth;
      floorTitle.style.animation = '';
      window.setTimeout(() => floorTitle.classList.add('hidden'), 2400);
    },
    onMiniProgress: (cumulative, until) => {
      // fill bar based on how far into current 3-soul window the player is
      const within = 3 - until; // 0..3
      miniFill.style.width = `${(within / 3) * 100}%`;
      void cumulative;
    },
    onUpgradePrompt: (tier, choices) => {
      showUpgradePicker(tier, choices);
    },
    onActiveUpgradesChange: (upgrades) => {
      renderActiveUpgrades(upgrades);
      updateShieldIcon(upgrades);
    },
    onDescentStart: (_from, to) => {
      descentCaption.textContent = to === 20 ? 'THE MAW' : to >= 16 ? 'STATIC' : to >= 10 ? 'DEEPER' : 'DOWN';
      descentOverlay.classList.remove('hidden');
      descentOverlay.style.animation = 'none';
      void descentOverlay.offsetWidth;
      descentOverlay.style.animation = '';
    },
    onDescentEnd: () => {
      window.setTimeout(() => descentOverlay.classList.add('hidden'), 100);
    },
    onBossShardCollected: (_count, _total) => {
      // briefly flash the soul counter accent
      soulCountEl.animate(
        [{ textShadow: '0 0 40px #fff' }, { textShadow: '0 0 10px rgba(255,212,0,0.5)' }],
        { duration: 800 },
      );
    },
    onCliffhanger: (stats) => {
      hud.classList.add('hidden');
      if (isTouch) touchControls.classList.add('hidden');
      playCutscene().then(() => {
        game.concludeCliffhanger();
        showCliffhangerScreen(stats);
      });
    },
    onEnd: (reason, stats) => {
      hud.classList.add('hidden');
      if (isTouch) touchControls.classList.add('hidden');
      if (reason === 'lose') {
        loseStats.innerHTML = renderStats(stats);
        loseScreen.classList.remove('hidden');
        loseScreen.classList.add('visible');
      } else {
        // cliffhanger screen already shown via showCliffhangerScreen()
      }
    },
  });

  // -------- screen navigation --------
  const allOverlays = [titleScreen, startScreen, abilitiesScreen, loseScreen, cliffScreen];
  const showScreen = (target: HTMLElement | null) => {
    for (const o of allOverlays) {
      if (!o) continue;
      o.classList.add('hidden');
      o.classList.remove('visible');
    }
    if (target) {
      target.classList.remove('hidden');
      target.classList.add('visible');
    }
  };

  // Start a run when a difficulty button is clicked
  const beginRun = (difficulty: Difficulty) => {
    showScreen(null);
    hud.classList.remove('hidden');
    if (isTouch) touchControls.classList.remove('hidden');
    // reset hud state
    vignette.classList.remove('danger');
    heartbeat.style.opacity = '0';
    warning.classList.add('hidden');
    miniFill.style.width = '0%';
    activeUpgradesEl.innerHTML = '';
    shieldIcon.classList.add('hidden');
    game.startRun(difficulty);
  };

  for (const btn of document.querySelectorAll<HTMLButtonElement>('.diff-btn')) {
    btn.addEventListener('click', () => {
      const diff = btn.dataset.difficulty as Difficulty;
      beginRun(diff);
    });
  }

  // Title -> sub-screens
  $<HTMLButtonElement>('title-play').addEventListener('click', () => showScreen(startScreen));
  $<HTMLButtonElement>('title-abilities').addEventListener('click', () => {
    renderAbilities('mini');
    showScreen(abilitiesScreen);
  });
  $<HTMLButtonElement>('start-back').addEventListener('click', () => showScreen(titleScreen));
  $<HTMLButtonElement>('abilities-back').addEventListener('click', () => showScreen(titleScreen));

  // Abilities tabs
  for (const tab of document.querySelectorAll<HTMLButtonElement>('.ab-tab')) {
    tab.addEventListener('click', () => {
      for (const t of document.querySelectorAll('.ab-tab')) t.classList.remove('active');
      tab.classList.add('active');
      renderAbilities((tab.dataset.tier || 'mini') as UpgradeTier);
    });
  }

  function renderAbilities(tier: UpgradeTier) {
    const listEl = $('abilities-list');
    const all = getAllUpgrades().filter((u) => u.tier === tier);
    listEl.innerHTML = '';
    for (const u of all) {
      const card = document.createElement('div');
      card.className = 'ab-card' + (tier === 'big' ? ' big' : '');
      card.innerHTML = `
        <div class="name">${escapeHtml(u.name)}</div>
        <div class="up">${escapeHtml(u.upside)}</div>
        <div class="down">${escapeHtml(u.downside)}</div>
      `;
      listEl.appendChild(card);
    }
  }

  const backToTitle = () => {
    hud.classList.add('hidden');
    touchControls.classList.add('hidden');
    showScreen(titleScreen);
  };
  loseAgain.addEventListener('click', backToTitle);
  cliffAgain.addEventListener('click', backToTitle);

  // -------- settings panel (openable from title + HUD) --------
  installSettingsPanel(game);

  // Dev-tool "preview cutscene from title" event — plays the same cutscene pipeline
  // with no active run, then returns to the title screen.
  document.addEventListener('soulchase:preview-cutscene', () => {
    hud.classList.add('hidden');
    touchControls.classList.add('hidden');
    showScreen(null);
    playCutscene().then(() => showScreen(titleScreen));
  });

  function showUpgradePicker(tier: UpgradeTier, choices: Upgrade[]) {
    upgradeTierLabel.textContent = tier === 'mini' ? 'MINI UPGRADE' : 'BIG UPGRADE';
    upgradeTierLabel.classList.toggle('big', tier === 'big');
    upgradeCardsEl.innerHTML = '';
    for (const choice of choices) {
      const btn = document.createElement('button');
      btn.className = 'upgrade-card';
      btn.innerHTML = `
        <div class="name">${escapeHtml(choice.name)}</div>
        <div class="up">${escapeHtml(choice.upside)}</div>
        <div class="down">${escapeHtml(choice.downside)}</div>
      `;
      btn.addEventListener('click', () => {
        upgradeOverlay.classList.add('hidden');
        game.applyPickedUpgrade(choice.id, tier === 'big');
      });
      upgradeCardsEl.appendChild(btn);
    }
    upgradeOverlay.classList.remove('hidden');
  }

  function renderActiveUpgrades(upgrades: Upgrade[]) {
    activeUpgradesEl.innerHTML = '';
    // show the last 6 taken, newest first
    const recent = upgrades.slice(-6).reverse();
    for (const u of recent) {
      const row = document.createElement('div');
      row.className = 'u-row';
      row.textContent = u.name;
      activeUpgradesEl.appendChild(row);
    }
  }

  function updateShieldIcon(upgrades: Upgrade[]) {
    // count owned second-chance upgrades; the modifier state is tracked by the game
    // but we can approximate visibility here — refined hook would read from game
    const hasShield = upgrades.some((u) => u.id === 'secondchance');
    shieldIcon.classList.toggle('hidden', !hasShield);
  }

  function renderStats(stats: RunStats): string {
    return `
      <div><b>${stats.floorsCleared}</b> floors cleared</div>
      <div><b>${stats.cumulativeSouls}</b> souls taken</div>
      <div><b>${stats.upgradesTaken}</b> upgrades absorbed</div>
      <div style="color:#666; font-size:11px; margin-top:8px;">difficulty: ${stats.difficulty.toUpperCase()}</div>
    `;
  }

  function showCliffhangerScreen(stats: RunStats) {
    cliffStats.innerHTML = renderStats(stats);
    cliffScreen.classList.remove('hidden');
    cliffScreen.classList.add('visible');
  }

  /**
   * Boss-defeat cliffhanger cutscene. Sequence:
   *   1. Pac-Man's soul tears out of his body — visible as a flaming trail that flees deeper
   *   2. Distant heavy rumble — something bigger is approaching
   *   3. The player takes Pac-Man's old body to hide
   *   4. Placeholder lore line
   *
   * Resolves after the last caption + a short hold.
   */
  async function playCutscene(): Promise<void> {
    cutsceneOverlay.classList.remove('hidden');
    cutsceneFrame.innerHTML = '';
    // layer the scene: dead pacman body, ghost trail escaping, encroaching shadow
    const body = document.createElement('div');
    body.className = 'dead-pacman';
    cutsceneFrame.appendChild(body);
    const trail = document.createElement('div');
    trail.className = 'ghost-trail';
    cutsceneFrame.appendChild(trail);
    const shadow = document.createElement('div');
    shadow.className = 'big-hunter-shadow';
    cutsceneFrame.appendChild(shadow);

    const gameAudio = (game as unknown as { audio: { playSoulEscape: () => void; playDistantRumble: (n: number) => void } }).audio;

    cutsceneSkip.classList.remove('hidden');
    let skipped = false;
    const skip = () => {
      skipped = true;
    };
    cutsceneSkip.addEventListener('click', skip);

    const beats: { text: string; ms: number; onPlay?: () => void }[] = [
      { text: '', ms: 300 },
      { text: 'You hit him a third time.', ms: 1700 },
      { text: "He shouldn't have cracked.\nBut he did.", ms: 2400, onPlay: () => gameAudio?.playSoulEscape?.() },
      {
        text: "His soul tore loose from the chomping body\nand fled further down the hall.",
        ms: 3000,
      },
      {
        text: 'Somewhere below, something heavier is chasing him.',
        ms: 2600,
        onPlay: () => gameAudio?.playDistantRumble?.(5),
      },
      {
        text:
          'You climb into the empty mouth.\nThe teeth close around you like a door.\n\nYou are inside the hunter now.',
        ms: 4200,
      },
      {
        text: `${BIGGER_HUNTER_NAME} passes overhead.\nIt does not look down.`,
        ms: 3000,
      },
      {
        text: `<span class="lore">${LORE_LINE_PLACEHOLDER}</span>`,
        ms: 3800,
      },
    ];

    for (const beat of beats) {
      if (skipped) break;
      cutsceneCaption.innerHTML = beat.text;
      beat.onPlay?.();
      await wait(beat.ms);
    }
    cutsceneSkip.classList.add('hidden');
    cutsceneOverlay.classList.add('hidden');
    cutsceneFrame.innerHTML = '';
    cutsceneSkip.removeEventListener('click', skip);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c] as string));
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms));
}

document.addEventListener('DOMContentLoaded', main);
