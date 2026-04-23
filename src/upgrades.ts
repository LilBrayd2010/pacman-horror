/**
 * Roguelike upgrade pool. Every upgrade has a real upside and a real downside,
 * both shown to the player up-front so they can weigh the tradeoff.
 *
 * `mini` upgrades trigger every 3 cumulative souls collected across the run.
 * `big` upgrades trigger on every floor cleared.
 *
 * Upgrades are applied by mutating a shared `PlayerModifiers` object on the
 * Game's run state. The Player and Pacman read from those modifiers each
 * frame, so effects are live the moment the player picks.
 */

export type UpgradeTier = 'mini' | 'big';

/** Mutable knobs that upgrades can tweak. The game applies them to the player/pacman each frame. */
export interface PlayerModifiers {
  moveSpeedMul: number;        // walk + sprint scalar
  sprintSpeedMul: number;      // only sprint (stacks with moveSpeedMul)
  staminaCapMul: number;       // max stamina (default 1.0)
  staminaDrainMul: number;     // rate of drain when sprinting
  staminaRegenMul: number;     // rate of regen when walking
  pickupRadiusMul: number;     // orb pickup distance scalar
  pacmanSpeedMul: number;      // scale applied to base floor speed
  pacmanRepathPeriod: number;  // seconds between re-paths (default 0.35)
  pickupSpeedBurstSec: number; // seconds of +speed burst after a soul pickup
  ghostLightRangeMul: number;  // visibility halo scalar
  /** next caught hit is absorbed (does not kill). Set to 0 after consuming. */
  shieldCharges: number;
  /** skip next big-upgrade card pick and take a pre-picked upgrade automatically (0/1). */
  autoSkipBigCharges: number;
  /** extra souls added to next floor's target. */
  nextFloorExtraSouls: number;
  /** one-shot: walk through one wall this floor (UI TBD; for now acts as a 1-use "ghost dash"). */
  phaseWallCharges: number;
}

export function defaultModifiers(): PlayerModifiers {
  return {
    moveSpeedMul: 1,
    sprintSpeedMul: 1,
    staminaCapMul: 1,
    staminaDrainMul: 1,
    staminaRegenMul: 1,
    pickupRadiusMul: 1,
    pacmanSpeedMul: 1,
    pacmanRepathPeriod: 0.35,
    pickupSpeedBurstSec: 0,
    ghostLightRangeMul: 1,
    shieldCharges: 0,
    autoSkipBigCharges: 0,
    nextFloorExtraSouls: 0,
    phaseWallCharges: 0,
  };
}

export interface Upgrade {
  id: string;
  name: string;
  upside: string;
  downside: string;
  tier: UpgradeTier;
  apply: (mods: PlayerModifiers) => void;
}

const MINI: Upgrade[] = [
  {
    id: 'quickfoot',
    name: 'Quickfoot',
    upside: '+10% move speed',
    downside: 'Stamina drains 15% faster',
    tier: 'mini',
    apply: (m) => {
      m.moveSpeedMul *= 1.1;
      m.staminaDrainMul *= 1.15;
    },
  },
  {
    id: 'deeplungs',
    name: 'Deep Lungs',
    upside: 'Stamina cap +50%',
    downside: 'Walk speed −8%',
    tier: 'mini',
    apply: (m) => {
      m.staminaCapMul *= 1.5;
      m.moveSpeedMul *= 0.92;
    },
  },
  {
    id: 'soulreach',
    name: 'Soul Reach',
    upside: 'Soul pickup radius +40%',
    downside: 'Pac-Man hears you from 30% further',
    tier: 'mini',
    apply: (m) => {
      m.pickupRadiusMul *= 1.4;
      m.pacmanRepathPeriod = Math.max(0.18, m.pacmanRepathPeriod * 0.85);
    },
  },
  {
    id: 'driftstep',
    name: 'Drift Step',
    upside: 'Burst of speed 0.5s after each pickup',
    downside: 'Max stamina −5% permanently',
    tier: 'mini',
    apply: (m) => {
      m.pickupSpeedBurstSec = Math.max(m.pickupSpeedBurstSec, 0.5);
      m.staminaCapMul *= 0.95;
    },
  },
  {
    id: 'mercysleep',
    name: 'Mercy Sleep',
    upside: 'Stamina regen +40% while walking',
    downside: 'Sprint speed −10%',
    tier: 'mini',
    apply: (m) => {
      m.staminaRegenMul *= 1.4;
      m.sprintSpeedMul *= 0.9;
    },
  },
  {
    id: 'blindfold',
    name: "Hunter's Blindfold",
    upside: 'Pac-Man repaths 30% slower (easier to juke)',
    downside: "Your ghost-halo dims — you see 25% less around you",
    tier: 'mini',
    apply: (m) => {
      m.pacmanRepathPeriod = Math.min(0.8, m.pacmanRepathPeriod * 1.3);
      m.ghostLightRangeMul *= 0.75;
    },
  },
  {
    id: 'heavywake',
    name: 'Heavy Wake',
    upside: "Pac-Man's base speed −7% this floor only",
    downside: 'You start the next floor with 40% stamina',
    tier: 'mini',
    apply: (m) => {
      m.pacmanSpeedMul *= 0.93;
      // stamina-on-floor-start handled by game when it sees staminaCapMul carried — just keep lasting drain
      m.staminaDrainMul *= 1.08;
    },
  },
  {
    id: 'thinveil',
    name: 'Thin Veil',
    upside: 'Halo range +50% (see farther in the dark)',
    downside: "Pac-Man's red glow is also +40% (he spots you sooner)",
    tier: 'mini',
    apply: (m) => {
      m.ghostLightRangeMul *= 1.5;
      // Pac-Man "spots sooner" is represented here as slightly faster repath
      m.pacmanRepathPeriod = Math.max(0.2, m.pacmanRepathPeriod * 0.9);
    },
  },
];

const BIG: Upgrade[] = [
  {
    id: 'wraithform',
    name: 'Wraithform',
    upside: 'Phase through one wall this floor',
    downside: 'Pac-Man starts next floor +5% faster',
    tier: 'big',
    apply: (m) => {
      m.phaseWallCharges += 1;
      m.pacmanSpeedMul *= 1.05;
    },
  },
  {
    id: 'embersoul',
    name: 'Ember Soul',
    upside: 'Sprint speed +15%',
    downside: 'Stamina regen −25%',
    tier: 'big',
    apply: (m) => {
      m.sprintSpeedMul *= 1.15;
      m.staminaRegenMul *= 0.75;
    },
  },
  {
    id: 'secondchance',
    name: 'Second Chance',
    upside: 'One-time shield — survive the next catch',
    downside: 'Next floor spawns +1 extra soul',
    tier: 'big',
    apply: (m) => {
      m.shieldCharges += 1;
      m.nextFloorExtraSouls += 1;
    },
  },
  {
    id: 'deadreckon',
    name: 'Dead Reckoning',
    upside: 'Pickup radius +60%',
    downside: 'Pac-Man repaths 20% faster (smarter AI)',
    tier: 'big',
    apply: (m) => {
      m.pickupRadiusMul *= 1.6;
      m.pacmanRepathPeriod = Math.max(0.15, m.pacmanRepathPeriod * 0.8);
    },
  },
  {
    id: 'purgeheart',
    name: 'Purge Heart',
    upside: 'Max stamina +80%',
    downside: 'Stamina drains 25% faster',
    tier: 'big',
    apply: (m) => {
      m.staminaCapMul *= 1.8;
      m.staminaDrainMul *= 1.25;
    },
  },
  {
    id: 'hungertax',
    name: "Hunter's Tax",
    upside: 'Pac-Man base speed −12% from now on',
    downside: 'Each soul you pick up on future floors emits a louder chime',
    tier: 'big',
    apply: (m) => {
      m.pacmanSpeedMul *= 0.88;
      // louder chime = Pac-Man repaths faster when you pick up (representation)
      m.pacmanRepathPeriod = Math.max(0.15, m.pacmanRepathPeriod * 0.95);
    },
  },
];

const ALL: Upgrade[] = [...MINI, ...BIG];

/**
 * Roll N distinct upgrade choices of the given tier, optionally excluding IDs
 * the player already owns (stackable upgrades will appear anyway — the
 * caller can let duplicates through for stacking, or filter them).
 */
export function rollUpgrades(
  tier: UpgradeTier,
  taken: readonly string[],
  n = 3,
  allowDuplicates = true,
): Upgrade[] {
  const pool = ALL.filter((u) => u.tier === tier);
  const candidates = allowDuplicates ? [...pool] : pool.filter((u) => !taken.includes(u.id));
  // shuffle
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  return candidates.slice(0, Math.min(n, candidates.length));
}

export function getUpgradeById(id: string): Upgrade | undefined {
  return ALL.find((u) => u.id === id);
}
