import * as THREE from 'three';
import type { MazeData } from './maze';
import {
  bfsPath,
  circleCollides,
  gridToWorld,
  hasLineOfSight,
  worldToGrid,
} from './maze';
import { makePacmanTexture } from './textures';

export interface PacmanOptions {
  maze: MazeData;
  startX: number;
  startZ: number;
  speed: number; // units/sec
  onCaughtRadius?: number;
}

export type PacmanState = 'wander' | 'alert' | 'chase';

export interface PacmanUpdate {
  caught: boolean;
  distance: number;
  canSee: boolean;
  state: PacmanState;
}

/**
 * Vision parameters for the hunter. The cone is symmetric around the sprite's
 * current facing direction (which we derive from its last movement vector).
 */
const VISION = {
  /** Farthest distance at which Pacman can spot the player (world units). */
  range: 18,
  /** Half-angle of the vision cone in radians (~55° total FOV). */
  halfAngleCos: Math.cos((55 * Math.PI) / 180),
  /** Short "peripheral" range where he sees you even outside the cone
   * (e.g. you walked right up behind him). */
  peripheralRange: 2.2,
};

/** How long Pacman keeps chasing after losing sight (seconds). */
const SEARCH_MEMORY_SEC = 3.5;
/** How long Pacman wanders to a random target before picking a new one. */
const WANDER_TARGET_SEC = 6.0;
/** Wander speed multiplier (slower than chase). */
const WANDER_SPEED_MUL = 0.55;
/** Alert-search speed multiplier (between wander and chase). */
const ALERT_SPEED_MUL = 0.85;

/**
 * The hunter. A billboarded Pac-Man sprite that pathfinds on the grid.
 *
 * Behaves like a guard rather than a heat-seeker:
 *   - `wander`: no sight of player. Picks a random reachable cell and plods
 *     toward it at reduced speed.
 *   - `alert`: saw the player recently but has lost line-of-sight. Keeps
 *     heading to the last-known position; if still empty after
 *     `SEARCH_MEMORY_SEC`, drops back to `wander`.
 *   - `chase`: currently has line-of-sight. Full speed, real-time repaths.
 */
export class Pacman {
  position = new THREE.Vector3();
  radius = 0.45;
  speed: number;
  baseSpeed: number;
  repathPeriod = 0.35;
  caughtRadius: number;
  sprite: THREE.Sprite;
  light: THREE.PointLight;
  /** 0..1 — boss-floor weakening factor. 0 = full health, 1 = shattered. */
  weakened = 0;
  state: PacmanState = 'wander';

  private maze: MazeData;
  private frames: THREE.Texture[] = [];
  private chompPhase = 0;
  private currentPath: Array<{ x: number; y: number }> = [];
  private pathIndex = 0;
  private repathTimer = 0;
  private yOffset: number;
  /** Unit vector (x,z) Pac-Man is currently facing. Updated whenever he moves. */
  private facingX = 1;
  private facingZ = 0;
  /** Remaining seconds to keep chasing after last LOS. */
  private searchTimer = 0;
  /** Last-seen player grid cell; used as the waypoint during `alert`. */
  private lastSeen: { x: number; y: number } | null = null;
  /** Current wander target (grid cell) + its expiration timer. */
  private wanderTarget: { x: number; y: number } | null = null;
  private wanderTimer = 0;

  constructor(opts: PacmanOptions) {
    this.maze = opts.maze;
    this.speed = opts.speed;
    this.baseSpeed = opts.speed;
    this.caughtRadius = opts.onCaughtRadius ?? 0.65;
    this.yOffset = 1.1;
    this.position.set(opts.startX, this.yOffset, opts.startZ);

    // precompute chomp frames
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      this.frames.push(makePacmanTexture(t));
    }

    const mat = new THREE.SpriteMaterial({
      map: this.frames[0],
      transparent: true,
      depthTest: true,
      depthWrite: false,
    });
    this.sprite = new THREE.Sprite(mat);
    this.sprite.scale.set(1.6, 1.6, 1);
    this.sprite.position.copy(this.position);

    this.light = new THREE.PointLight(0xff2222, 1.8, 5, 2);
    this.light.position.copy(this.position);
  }

  addTo(scene: THREE.Scene) {
    scene.add(this.sprite);
    scene.add(this.light);
  }

  removeFrom(scene: THREE.Scene) {
    scene.remove(this.sprite);
    scene.remove(this.light);
  }

  update(dt: number, playerPos: THREE.Vector3): PacmanUpdate {
    // chomp animation — faster when closer AND we're actively chasing.
    const dist = this.position.distanceTo(playerPos);
    const canSee = this.canSeePlayer(playerPos);

    // ---- state machine ---------------------------------------------------
    if (canSee) {
      this.state = 'chase';
      this.searchTimer = SEARCH_MEMORY_SEC;
      this.lastSeen = worldToGrid(this.maze, playerPos.x, playerPos.z);
    } else if (this.state === 'chase') {
      // just lost sight — transition to alert
      this.state = 'alert';
    }
    if (this.state === 'alert') {
      this.searchTimer -= dt;
      if (this.searchTimer <= 0 || !this.lastSeen) {
        this.state = 'wander';
        this.searchTimer = 0;
        this.lastSeen = null;
        this.currentPath = [];
        this.pathIndex = 0;
      } else {
        // If we've reached the last-known cell and still don't see the player,
        // give up early — no point standing on the exact spot.
        const me = worldToGrid(this.maze, this.position.x, this.position.z);
        if (me.x === this.lastSeen.x && me.y === this.lastSeen.y) {
          this.state = 'wander';
          this.searchTimer = 0;
          this.lastSeen = null;
          this.currentPath = [];
          this.pathIndex = 0;
        }
      }
    }

    // ---- effective speed + animation rate --------------------------------
    const speedMul =
      this.state === 'chase'
        ? 1
        : this.state === 'alert'
          ? ALERT_SPEED_MUL
          : WANDER_SPEED_MUL;
    const effectiveSpeed = this.speed * speedMul;

    const chompRate =
      this.state === 'chase' ? 4 + Math.max(0, 10 - dist) * 0.8 : 2.2;
    this.chompPhase += dt * chompRate;
    const frameIdx =
      Math.floor((Math.sin(this.chompPhase) * 0.5 + 0.5) * (this.frames.length - 1)) %
      this.frames.length;
    this.sprite.material.map = this.frames[frameIdx];
    this.sprite.material.needsUpdate = true;

    // ---- pick a target depending on state --------------------------------
    let target: THREE.Vector3 | null = null;
    if (this.state === 'chase') {
      target = playerPos;
    } else if (this.state === 'alert' && this.lastSeen) {
      const w = gridToWorld(this.maze, this.lastSeen.x, this.lastSeen.y);
      target = new THREE.Vector3(w.x, 0, w.z);
    } else {
      // wander — refresh a random reachable target periodically.
      this.wanderTimer -= dt;
      if (!this.wanderTarget || this.wanderTimer <= 0 || this.pathExhausted()) {
        this.wanderTarget = this.pickWanderTarget();
        this.wanderTimer = WANDER_TARGET_SEC;
        this.currentPath = [];
        this.pathIndex = 0;
      }
      if (this.wanderTarget) {
        const w = gridToWorld(this.maze, this.wanderTarget.x, this.wanderTarget.y);
        target = new THREE.Vector3(w.x, 0, w.z);
      }
    }

    // ---- path maintenance ------------------------------------------------
    this.repathTimer -= dt;
    const needRepath =
      this.repathTimer <= 0 ||
      this.pathIndex >= this.currentPath.length ||
      this.currentPath.length === 0;
    if (needRepath && target) {
      this.recomputePath(target);
      // Chase repaths ~3x faster than wandering since the player moves.
      this.repathTimer =
        this.state === 'chase' ? this.repathPeriod : this.repathPeriod * 2.5;
    }

    // ---- follow current path --------------------------------------------
    if (this.currentPath.length > 0 && this.pathIndex < this.currentPath.length) {
      const step = this.currentPath[this.pathIndex];
      const w = gridToWorld(this.maze, step.x, step.y);
      const dx = w.x - this.position.x;
      const dz = w.z - this.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.1) {
        this.pathIndex++;
      } else {
        const nx = dx / d;
        const nz = dz / d;
        // update facing for vision cone; smoothed so quick sidesteps don't
        // instantly rotate his cone.
        this.facingX = this.facingX * 0.8 + nx * 0.2;
        this.facingZ = this.facingZ * 0.8 + nz * 0.2;
        const fLen = Math.hypot(this.facingX, this.facingZ) || 1;
        this.facingX /= fLen;
        this.facingZ /= fLen;

        const stepX = this.position.x + nx * effectiveSpeed * dt;
        const stepZ = this.position.z + nz * effectiveSpeed * dt;
        if (!circleCollides(this.maze, stepX, this.position.z, this.radius)) {
          this.position.x = stepX;
        }
        if (!circleCollides(this.maze, this.position.x, stepZ, this.radius)) {
          this.position.z = stepZ;
        }
      }
    }

    // ---- sprite + light update ------------------------------------------
    this.sprite.position.set(
      this.position.x,
      this.yOffset + Math.sin(this.chompPhase * 1.3) * 0.05,
      this.position.z,
    );
    this.light.position.copy(this.sprite.position);
    // Red glow pulses when actively chasing; dim + steady otherwise so the
    // player can use the absence of red as a signal they're unseen.
    const chasingPulse = 0.6 + 0.4 * Math.sin(this.chompPhase * 3);
    this.light.intensity =
      this.state === 'chase'
        ? (dist < 6 ? 2.4 : 1.2) * chasingPulse
        : this.state === 'alert'
          ? 0.9
          : 0.5;
    // Shift color slightly toward white when wandering so the player can read
    // the state without a HUD.
    this.light.color.setHex(
      this.state === 'chase' ? 0xff2222 : this.state === 'alert' ? 0xff9955 : 0xbb8844,
    );

    return {
      caught: this.state === 'chase' && dist < this.caughtRadius,
      distance: dist,
      canSee,
      state: this.state,
    };
  }

  /**
   * Returns true if the player is within Pacman's vision cone AND has a
   * clear grid line-of-sight. Also true if the player is within a short
   * peripheral radius regardless of angle (so you can't crouch against his
   * back and stay invisible from 0.5 m away).
   */
  canSeePlayer(playerPos: THREE.Vector3): boolean {
    const dx = playerPos.x - this.position.x;
    const dz = playerPos.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.0001) return true;
    if (dist < VISION.peripheralRange) {
      return hasLineOfSight(
        this.maze,
        this.position.x,
        this.position.z,
        playerPos.x,
        playerPos.z,
      );
    }
    if (dist > VISION.range) return false;
    const nx = dx / dist;
    const nz = dz / dist;
    const dot = nx * this.facingX + nz * this.facingZ;
    if (dot < VISION.halfAngleCos) return false;
    return hasLineOfSight(
      this.maze,
      this.position.x,
      this.position.z,
      playerPos.x,
      playerPos.z,
    );
  }

  private pathExhausted(): boolean {
    return this.pathIndex >= this.currentPath.length;
  }

  private pickWanderTarget(): { x: number; y: number } | null {
    // Pick a random open cell, weighted to be at least a few cells away.
    const me = worldToGrid(this.maze, this.position.x, this.position.z);
    for (let tries = 0; tries < 30; tries++) {
      const gx = Math.floor(Math.random() * this.maze.width);
      const gy = Math.floor(Math.random() * this.maze.height);
      if (this.maze.grid[gy]?.[gx] !== 0) continue;
      const manhattan = Math.abs(gx - me.x) + Math.abs(gy - me.y);
      if (manhattan < 4) continue;
      if (bfsPath(this.maze, me.x, me.y, gx, gy)) {
        return { x: gx, y: gy };
      }
    }
    return null;
  }

  private recomputePath(targetWorld: THREE.Vector3) {
    const start = worldToGrid(this.maze, this.position.x, this.position.z);
    const goal = worldToGrid(this.maze, targetWorld.x, targetWorld.z);
    const path = bfsPath(this.maze, start.x, start.y, goal.x, goal.y);
    if (path && path.length > 1) {
      this.currentPath = path.slice(1); // skip current cell
      this.pathIndex = 0;
    }
  }
}
