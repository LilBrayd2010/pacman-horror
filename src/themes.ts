/**
 * Per-floor themes for the 20-floor descent. Controls the color tint of
 * walls/floor/ceiling, fog color, ambient lighting, and the name shown on
 * the descent card.
 *
 * Textures themselves are reused across floors (same procedural grimy brick)
 * and just tinted via `material.color` so there's no per-floor regen cost.
 */

export interface FloorTheme {
  name: string;
  /** multiplied into the wall material color — so white (0xffffff) = original. */
  wallTint: number;
  floorTint: number;
  ceilingTint: number;
  fogColor: number;
  fogDensity: number;
  ambientColor: number;
  ambientIntensity: number;
  /** the color of the ghostly point light that follows the player. */
  ghostLightColor: number;
  /** hex string shown behind HUD accents (e.g. floor title flash). */
  accentHex: string;
}

const CRYPT: FloorTheme = {
  name: 'DUSTY CRYPT',
  wallTint: 0xc9b99a,
  floorTint: 0x7a6f58,
  ceilingTint: 0x4a4235,
  fogColor: 0x1a1612,
  fogDensity: 0.17,
  ambientColor: 0x3a2e1e,
  ambientIntensity: 0.55,
  ghostLightColor: 0x88aaff,
  accentHex: '#c9b99a',
};

const FLESH: FloorTheme = {
  name: 'FLESH HALLS',
  wallTint: 0xd26e7a,
  floorTint: 0x8a3a44,
  ceilingTint: 0x4a1a22,
  fogColor: 0x200808,
  fogDensity: 0.2,
  ambientColor: 0x4a1418,
  ambientIntensity: 0.5,
  ghostLightColor: 0xffc0c8,
  accentHex: '#d26e7a',
};

const BONE: FloorTheme = {
  name: 'BONE LABYRINTH',
  wallTint: 0xd8d4c4,
  floorTint: 0x9a9080,
  ceilingTint: 0x504840,
  fogColor: 0x181614,
  fogDensity: 0.19,
  ambientColor: 0x4a483c,
  ambientIntensity: 0.55,
  ghostLightColor: 0xaaccff,
  accentHex: '#d8d4c4',
};

const DROWNING: FloorTheme = {
  name: 'DROWNING DEPTHS',
  wallTint: 0x3a6a78,
  floorTint: 0x1a4050,
  ceilingTint: 0x0a1e2a,
  fogColor: 0x051820,
  fogDensity: 0.23,
  ambientColor: 0x184050,
  ambientIntensity: 0.55,
  ghostLightColor: 0x88ffdd,
  accentHex: '#3a6a78',
};

const INFERNO: FloorTheme = {
  name: 'INFERNO',
  wallTint: 0xd46030,
  floorTint: 0x7a2810,
  ceilingTint: 0x2a0a04,
  fogColor: 0x180604,
  fogDensity: 0.2,
  ambientColor: 0x5a1a08,
  ambientIntensity: 0.6,
  ghostLightColor: 0xffcc88,
  accentHex: '#d46030',
};

const VOID: FloorTheme = {
  name: 'STATIC VOID',
  wallTint: 0x707078,
  floorTint: 0x3a3a40,
  ceilingTint: 0x14141a,
  fogColor: 0x0a0a0e,
  fogDensity: 0.22,
  ambientColor: 0x202028,
  ambientIntensity: 0.45,
  ghostLightColor: 0xbbbbff,
  accentHex: '#707078',
};

const MAW: FloorTheme = {
  name: 'THE MAW',
  wallTint: 0x200400,
  floorTint: 0x100200,
  ceilingTint: 0x000000,
  fogColor: 0x080000,
  fogDensity: 0.14,
  ambientColor: 0x400808,
  ambientIntensity: 0.35,
  ghostLightColor: 0xff2820,
  accentHex: '#ff2820',
};

// Floor index (1-based) -> theme band
const BANDS: { from: number; to: number; theme: FloorTheme }[] = [
  { from: 1, to: 3, theme: CRYPT },
  { from: 4, to: 6, theme: FLESH },
  { from: 7, to: 9, theme: BONE },
  { from: 10, to: 12, theme: DROWNING },
  { from: 13, to: 15, theme: INFERNO },
  { from: 16, to: 19, theme: VOID },
  { from: 20, to: 20, theme: MAW },
];

export function themeForFloor(floor: number): FloorTheme {
  for (const b of BANDS) if (floor >= b.from && floor <= b.to) return b.theme;
  return BANDS[BANDS.length - 1].theme;
}

/**
 * Number of souls required to clear floor N. Ramps from 3 on floor 1 to ~12
 * by floor 19; floor 20 is the boss floor (uses shards, not souls).
 */
export function soulsForFloor(floor: number): number {
  if (floor >= 20) return 3; // boss: three shards
  // roughly: 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12
  return 3 + Math.floor((floor - 1) / 2);
}

/** Maze size (cols=rows, always odd) for floor N. */
export function mazeSizeForFloor(floor: number, difficulty: 'easy' | 'medium' | 'hard'): number {
  const base = difficulty === 'easy' ? 11 : difficulty === 'medium' ? 13 : 15;
  // grow slowly: +2 every 4 floors, capped
  const bonus = Math.min(10, Math.floor((floor - 1) / 4) * 2);
  const size = base + bonus;
  // keep odd
  return size % 2 === 1 ? size : size + 1;
}

/**
 * Pac-Man speed for floor N. Compounds per floor — 1.035^N at medium.
 * Easy base is slower, hard is faster.
 */
export function pacmanSpeedForFloor(floor: number, difficulty: 'easy' | 'medium' | 'hard'): number {
  const base = difficulty === 'easy' ? 1.6 : difficulty === 'medium' ? 2.1 : 2.6;
  const ramp = Math.pow(1.035, Math.max(0, floor - 1));
  return base * ramp;
}
