import * as THREE from 'three';
import { AudioEngine } from './audio';
import { Controls } from './controls';
import { buildMazeData, buildMazeMesh, gridToWorld, type MazeData } from './maze';
import { Orbs } from './orbs';
import { Pacman } from './pacman';
import { Player } from './player';
import {
  mazeSizeForFloor,
  pacmanSpeedForFloor,
  soulsForFloor,
  themeForFloor,
  type FloorTheme,
} from './themes';
import {
  defaultModifiers,
  getUpgradeById,
  rollUpgrades,
  type PlayerModifiers,
  type Upgrade,
  type UpgradeTier,
} from './upgrades';

export type Difficulty = 'easy' | 'medium' | 'hard';

export type GameEndReason = 'lose' | 'cliffhanger';

export interface RunStats {
  difficulty: Difficulty;
  floorsCleared: number;
  cumulativeSouls: number;
  upgradesTaken: number;
}

export interface GameCallbacks {
  onSoulUpdate: (collected: number, total: number) => void;
  onStaminaUpdate: (stamina: number) => void;
  onTensionUpdate: (tension: number) => void;
  onFloorEnter: (floor: number, theme: FloorTheme, soulsNeeded: number) => void;
  onMiniProgress: (cumulativeSouls: number, soulsUntilNext: number) => void;
  onUpgradePrompt: (tier: UpgradeTier, choices: Upgrade[]) => void;
  onActiveUpgradesChange: (upgrades: Upgrade[]) => void;
  onDescentStart: (fromFloor: number, toFloor: number) => void;
  onDescentEnd: () => void;
  onBossShardCollected: (count: number, total: number) => void;
  onCliffhanger: (stats: RunStats) => void;
  onEnd: (reason: GameEndReason, stats: RunStats) => void;
}

const TOTAL_FLOORS = 20;

interface RunState {
  difficulty: Difficulty;
  floor: number;
  cumulativeSouls: number;
  soulsThisFloor: number;
  soulsNeededThisFloor: number;
  upgrades: Upgrade[];
  modifiers: PlayerModifiers;
  /** counter: souls collected since last mini-upgrade was awarded. */
  soulsSinceLastMini: number;
}

export class Game {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private clock = new THREE.Clock();
  private controls: Controls;
  private audio: AudioEngine;

  private maze!: MazeData;
  private mazeMesh!: THREE.Group;
  private player!: Player;
  private pacman!: Pacman;
  private orbs!: Orbs;
  private ghostLight: THREE.PointLight | null = null;

  private running = false;
  private paused = false;
  private raf = 0;
  private chompTimer = 0;
  private breathTimer = 0;
  private cbs: GameCallbacks;
  private run: RunState | null = null;
  private shardsCollected = 0;

  /** descent animation state. when non-null we lerp the camera Y offset and skip normal gameplay ticks. */
  private descentFx: { t: number; duration: number; holdDark: number; nextFloor: number } | null = null;
  /** full-screen fade overlay element (added by main.ts via callbacks). */

  constructor(canvas: HTMLCanvasElement, cbs: GameCallbacks) {
    this.cbs = cbs;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = false;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.scene.fog = new THREE.FogExp2(0x000000, 0.16);

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 50);

    this.controls = new Controls(canvas);
    this.audio = new AudioEngine();

    window.addEventListener('resize', this.onResize);
  }

  private onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
  };

  /** Kick off a brand-new run at floor 1. */
  startRun(difficulty: Difficulty) {
    this.reset();
    this.run = {
      difficulty,
      floor: 0,
      cumulativeSouls: 0,
      soulsThisFloor: 0,
      soulsNeededThisFloor: 0,
      upgrades: [],
      modifiers: defaultModifiers(),
      soulsSinceLastMini: 0,
    };
    this.audio.init();
    this.audio.resumeIfSuspended();
    this.audio.startAmbient();
    this.enterFloor(1);
    this.running = true;
    this.clock.start();
    this.loop();
  }

  /** Called when the player picks a card — apply it to modifiers, advance if it was the big (post-floor) card. */
  applyPickedUpgrade(id: string, wasBig: boolean) {
    if (!this.run) return;
    const up = getUpgradeById(id);
    if (!up) return;
    up.apply(this.run.modifiers);
    this.run.upgrades.push(up);
    this.cbs.onActiveUpgradesChange(this.run.upgrades.slice());
    if (wasBig) {
      const next = this.run.floor + 1;
      if (next > TOTAL_FLOORS) {
        // shouldn't happen — boss triggers cliffhanger directly. Defensive.
        this.triggerCliffhanger();
        return;
      }
      this.beginDescent(next);
    } else {
      this.paused = false;
      this.clock.start();
    }
  }

  /** Called from the UI when a mini/big card is dismissed with no pick (shouldn't normally happen, but safe). */
  cancelUpgradePick() {
    this.paused = false;
    this.clock.start();
  }

  private enterFloor(floor: number) {
    if (!this.run) return;
    this.run.floor = floor;
    this.run.soulsThisFloor = 0;
    const extraSouls = this.run.modifiers.nextFloorExtraSouls;
    this.run.modifiers.nextFloorExtraSouls = 0; // consume
    const theme = themeForFloor(floor);
    const size = mazeSizeForFloor(floor, this.run.difficulty);
    const pacSpeed = pacmanSpeedForFloor(floor, this.run.difficulty) * this.run.modifiers.pacmanSpeedMul;

    // clear previous floor
    this.clearScene();

    this.scene.fog = new THREE.FogExp2(theme.fogColor, theme.fogDensity);
    this.scene.background = new THREE.Color(0x000000);

    // lighting tuned to theme
    const ambient = new THREE.AmbientLight(theme.ambientColor, theme.ambientIntensity);
    this.scene.add(ambient);
    const moon = new THREE.DirectionalLight(0x4a5a80, 0.18);
    moon.position.set(1, 4, 2);
    this.scene.add(moon);

    // build maze with theme tint
    this.maze = buildMazeData(size, size);
    this.mazeMesh = buildMazeMesh(this.maze, {
      wall: theme.wallTint,
      floor: theme.floorTint,
      ceiling: theme.ceilingTint,
    });
    this.scene.add(this.mazeMesh);

    const startCell = this.maze.openCells[0];
    const farCell = this.maze.openCells[this.maze.openCells.length - 1];
    const startW = gridToWorld(this.maze, startCell.x, startCell.y);
    const farW = gridToWorld(this.maze, farCell.x, farCell.y);

    this.ghostLight = new THREE.PointLight(theme.ghostLightColor, 0.9, 5.5 * this.run.modifiers.ghostLightRangeMul, 2);
    this.ghostLight.position.set(startW.x, 1.5, startW.z);
    this.scene.add(this.ghostLight);

    this.player = new Player({
      maze: this.maze,
      startX: startW.x,
      startZ: startW.z,
      startYaw: 0,
    });
    // carry stamina: start with a nice heuristic based on cap
    this.player.stamina = this.run.modifiers.staminaCapMul;

    this.pacman = new Pacman({
      maze: this.maze,
      startX: farW.x,
      startZ: farW.z,
      speed: pacSpeed,
    });
    this.pacman.repathPeriod = this.run.modifiers.pacmanRepathPeriod;
    this.pacman.addTo(this.scene);
    // on boss floor, scale up the hunter sprite and dial up glow
    if (floor === TOTAL_FLOORS) {
      this.pacman.sprite.scale.set(2.4, 2.4, 1);
      this.pacman.light.intensity = 2.4;
      this.pacman.light.distance = 8;
    }

    const soulsNeeded = soulsForFloor(floor) + extraSouls;
    this.run.soulsNeededThisFloor = soulsNeeded;
    this.shardsCollected = 0;

    this.orbs = new Orbs(this.scene, this.maze, soulsNeeded, [startCell, farCell]);

    this.cbs.onFloorEnter(floor, theme, soulsNeeded);
    this.cbs.onSoulUpdate(0, soulsNeeded);
    this.cbs.onStaminaUpdate(this.player.stamina);
    this.cbs.onMiniProgress(this.run.cumulativeSouls, this.soulsUntilNextMini());
  }

  private soulsUntilNextMini(): number {
    if (!this.run) return 3;
    return 3 - (this.run.cumulativeSouls % 3);
  }

  private beginDescent(nextFloor: number) {
    if (!this.run) return;
    this.paused = true;
    this.descentFx = { t: 0, duration: 1.2, holdDark: 0.4, nextFloor };
    this.audio.playDescent();
    this.cbs.onDescentStart(this.run.floor, nextFloor);
  }

  private finishDescent() {
    if (!this.descentFx) return;
    const next = this.descentFx.nextFloor;
    this.descentFx = null;
    this.enterFloor(next);
    this.cbs.onDescentEnd();
    this.paused = false;
    this.clock.start();
  }

  private clearScene() {
    while (this.scene.children.length > 0) this.scene.remove(this.scene.children[0]);
    this.ghostLight = null;
  }

  private loop = () => {
    if (!this.running) return;
    const dt = Math.min(0.05, this.clock.getDelta());

    // descent animation — tilt camera down and skip normal ticks until it finishes
    if (this.descentFx) {
      this.descentFx.t += dt;
      const { t, duration, holdDark } = this.descentFx;
      // phase 1: fall (0..duration) — camera tilts and Y drops, screen fades to black
      // phase 2: hold dark (duration..duration+holdDark) — black screen, rebuild next floor at end
      if (t >= duration + holdDark) {
        this.finishDescent();
      }
      // dummy render so framebuffer doesn't flash; fade is handled by DOM overlay via onDescentStart/onDescentEnd
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(this.loop);
      return;
    }

    if (this.paused || !this.run) {
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(this.loop);
      return;
    }

    const mouseDelta = this.controls.sample();
    this.player.update(dt, this.controls.state, mouseDelta, this.run.modifiers);
    this.player.applyToCamera(this.camera);
    if (this.ghostLight) {
      this.ghostLight.position.copy(this.player.position);
      this.ghostLight.distance = 5.5 * this.run.modifiers.ghostLightRangeMul;
    }

    const { caught, distance } = this.pacman.update(dt, this.player.position);

    const pickupRadius = 0.8 * this.run.modifiers.pickupRadiusMul;
    const pickedUp = this.orbs.update(dt, this.player.position, pickupRadius);
    if (pickedUp > 0) {
      this.run.cumulativeSouls += pickedUp;
      this.run.soulsThisFloor += pickedUp;
      this.run.soulsSinceLastMini += pickedUp;
      if (this.run.modifiers.pickupSpeedBurstSec > 0) {
        this.player.burstRemaining = Math.max(this.player.burstRemaining, this.run.modifiers.pickupSpeedBurstSec);
      }
      this.audio.playPickup();
      this.cbs.onSoulUpdate(this.run.soulsThisFloor, this.run.soulsNeededThisFloor);
      this.cbs.onMiniProgress(this.run.cumulativeSouls, this.soulsUntilNextMini());

      // boss shards — each collection weakens pacman
      if (this.run.floor === TOTAL_FLOORS) {
        this.shardsCollected += pickedUp;
        this.pacman.weakened = Math.min(1, this.shardsCollected / this.run.soulsNeededThisFloor);
        this.pacman.speed = this.pacman.baseSpeed * (1 - this.pacman.weakened * 0.35);
        this.audio.playShardBreak();
        this.cbs.onBossShardCollected(this.shardsCollected, this.run.soulsNeededThisFloor);
      }

      // mini-upgrade trigger: every 3 cumulative souls
      const shouldMini =
        this.run.cumulativeSouls > 0 && this.run.cumulativeSouls % 3 === 0 && this.run.soulsThisFloor < this.run.soulsNeededThisFloor;
      if (shouldMini) {
        this.pauseForUpgrade('mini');
        return this.queueNextFrame();
      }

      // floor cleared
      if (this.run.soulsThisFloor >= this.run.soulsNeededThisFloor) {
        if (this.run.floor === TOTAL_FLOORS) {
          // boss defeated — trigger cliffhanger (no big-upgrade pick on boss floor)
          this.triggerCliffhanger();
          return this.queueNextFrame();
        }
        // cumulative-souls mini also triggers right at floor clear? We allow it (the big still follows).
        this.pauseForUpgrade('big');
        return this.queueNextFrame();
      }
    }

    // tension 0..1 based on proximity
    const tension = Math.max(0, Math.min(1, 1 - distance / 10));
    this.cbs.onTensionUpdate(tension);
    this.cbs.onStaminaUpdate(this.player.stamina);
    this.audio.setTension(tension);

    // periodic chomp + heavy breathing when close
    this.chompTimer -= dt;
    if (this.chompTimer <= 0) {
      const interval = 1.8 - tension * 1.2;
      this.chompTimer = Math.max(0.4, interval);
      this.audio.playChomp(0.5 + tension * 0.7);
    }
    if (tension > 0.55) {
      this.breathTimer -= dt;
      if (this.breathTimer <= 0) {
        this.breathTimer = 2.2;
        this.audio.playBreath(tension);
      }
    } else {
      this.breathTimer = 0;
    }

    if (caught) {
      // shield absorbs the catch once
      if (this.run.modifiers.shieldCharges > 0) {
        this.run.modifiers.shieldCharges -= 1;
        // fling the hunter away from the player briefly
        this.pacman.speed *= 0.6;
        this.pacman.position.x += (this.pacman.position.x - this.player.position.x) * 2;
        this.pacman.position.z += (this.pacman.position.z - this.player.position.z) * 2;
        this.audio.playShardBreak();
      } else {
        this.audio.playScream();
        this.running = false;
        this.cbs.onEnd('lose', this.buildStats());
        return;
      }
    }

    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.loop);
  };

  private queueNextFrame() {
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.loop);
  }

  private pauseForUpgrade(tier: UpgradeTier) {
    if (!this.run) return;
    this.paused = true;
    const owned = this.run.upgrades.map((u) => u.id);
    const choices = rollUpgrades(tier, owned, 3, true);
    this.cbs.onUpgradePrompt(tier, choices);
  }

  private triggerCliffhanger() {
    if (!this.run) return;
    this.paused = true;
    this.running = false;
    this.cbs.onCliffhanger(this.buildStats());
  }

  /** Called by main.ts after the cliffhanger cutscene ends — transitions to the end screen. */
  concludeCliffhanger() {
    if (!this.run) return;
    this.cbs.onEnd('cliffhanger', this.buildStats());
  }

  private buildStats(): RunStats {
    const r = this.run!;
    return {
      difficulty: r.difficulty,
      floorsCleared: Math.max(0, r.floor - 1) + (r.soulsThisFloor >= r.soulsNeededThisFloor ? 1 : 0),
      cumulativeSouls: r.cumulativeSouls,
      upgradesTaken: r.upgrades.length,
    };
  }

  stop() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.audio.stopAll();
    this.controls.releasePointerLock();
  }

  reset() {
    this.stop();
    this.clearScene();
    this.run = null;
    this.shardsCollected = 0;
    this.descentFx = null;
    this.paused = false;
  }
}
