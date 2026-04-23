import * as THREE from 'three';
import type { MazeData } from './maze';
import { bfsPath, circleCollides, gridToWorld, worldToGrid } from './maze';
import { makePacmanTexture } from './textures';

export interface PacmanOptions {
  maze: MazeData;
  startX: number;
  startZ: number;
  speed: number; // units/sec
  onCaughtRadius?: number;
}

/**
 * The hunter. A billboarded Pac-Man sprite that pathfinds toward the player
 * using BFS on the maze grid. Animates chomp by cycling between two textures.
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

  private maze: MazeData;
  private frames: THREE.Texture[] = [];
  private chompPhase = 0;
  private currentPath: Array<{ x: number; y: number }> = [];
  private pathIndex = 0;
  private repathTimer = 0;
  private yOffset: number;

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

  update(dt: number, playerPos: THREE.Vector3): { caught: boolean; distance: number } {
    // chomp animation — faster when closer
    const dist = this.position.distanceTo(playerPos);
    const chompRate = 4 + Math.max(0, 10 - dist) * 0.8;
    this.chompPhase += dt * chompRate;
    const frameIdx =
      Math.floor((Math.sin(this.chompPhase) * 0.5 + 0.5) * (this.frames.length - 1)) %
      this.frames.length;
    this.sprite.material.map = this.frames[frameIdx];
    this.sprite.material.needsUpdate = true;

    // repath every repathPeriod (configurable by upgrades) or when path exhausted
    this.repathTimer -= dt;
    if (this.repathTimer <= 0 || this.pathIndex >= this.currentPath.length) {
      this.recomputePath(playerPos);
      this.repathTimer = this.repathPeriod;
    }

    // follow current path
    if (this.currentPath.length > 0 && this.pathIndex < this.currentPath.length) {
      const target = this.currentPath[this.pathIndex];
      const w = gridToWorld(this.maze, target.x, target.y);
      const dx = w.x - this.position.x;
      const dz = w.z - this.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.1) {
        this.pathIndex++;
      } else {
        const nx = dx / d;
        const nz = dz / d;
        const stepX = this.position.x + nx * this.speed * dt;
        const stepZ = this.position.z + nz * this.speed * dt;
        // collision guard — shouldn't happen with pathfinding but be safe
        if (!circleCollides(this.maze, stepX, this.position.z, this.radius)) {
          this.position.x = stepX;
        }
        if (!circleCollides(this.maze, this.position.x, stepZ, this.radius)) {
          this.position.z = stepZ;
        }
      }
    }

    this.sprite.position.set(this.position.x, this.yOffset + Math.sin(this.chompPhase * 1.3) * 0.05, this.position.z);
    this.light.position.copy(this.sprite.position);
    // pulse the light with tension
    const pulse = 0.6 + 0.4 * Math.sin(this.chompPhase * 3);
    this.light.intensity = (dist < 6 ? 2.4 : 1.2) * pulse;

    return { caught: dist < this.caughtRadius, distance: dist };
  }

  private recomputePath(playerPos: THREE.Vector3) {
    const start = worldToGrid(this.maze, this.position.x, this.position.z);
    const goal = worldToGrid(this.maze, playerPos.x, playerPos.z);
    const path = bfsPath(this.maze, start.x, start.y, goal.x, goal.y);
    if (path && path.length > 1) {
      this.currentPath = path.slice(1); // skip current cell
      this.pathIndex = 0;
    }
  }
}
