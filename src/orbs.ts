import * as THREE from 'three';
import type { MazeData } from './maze';
import { gridToWorld } from './maze';
import { makeOrbTexture } from './textures';

export interface Orb {
  sprite: THREE.Sprite;
  light: THREE.PointLight;
  position: THREE.Vector3;
  collected: boolean;
  bobPhase: number;
}

export class Orbs {
  orbs: Orb[] = [];
  private texture: THREE.Texture;

  constructor(
    scene: THREE.Scene,
    maze: MazeData,
    count: number,
    avoidCells: Array<{ x: number; y: number }>,
  ) {
    this.texture = makeOrbTexture();

    // pick unique open cells not too close to the player start or hunter start
    const avoidSet = new Set(avoidCells.map((c) => `${c.x},${c.y}`));
    const candidates = maze.openCells.filter((c) => !avoidSet.has(`${c.x},${c.y}`));
    // shuffle
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const chosen = candidates.slice(0, Math.min(count, candidates.length));

    for (const cell of chosen) {
      const w = gridToWorld(maze, cell.x, cell.y);
      const mat = new THREE.SpriteMaterial({
        map: this.texture,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(0.55, 0.55, 1);
      const y = 1.2;
      sprite.position.set(w.x, y, w.z);
      scene.add(sprite);

      const light = new THREE.PointLight(0xaccfff, 0.8, 2.5, 2);
      light.position.set(w.x, y, w.z);
      scene.add(light);

      this.orbs.push({
        sprite,
        light,
        position: new THREE.Vector3(w.x, y, w.z),
        collected: false,
        bobPhase: Math.random() * Math.PI * 2,
      });
    }
  }

  update(dt: number, playerPos: THREE.Vector3, pickupRadius = 0.8): number {
    let collected = 0;
    const t = performance.now() * 0.002;
    for (const orb of this.orbs) {
      if (orb.collected) continue;
      const bob = Math.sin(t + orb.bobPhase) * 0.12;
      orb.sprite.position.y = orb.position.y + bob;
      orb.light.position.y = orb.sprite.position.y;
      // gentle flicker
      orb.light.intensity = 0.7 + 0.3 * Math.sin(t * 3 + orb.bobPhase);

      const dx = playerPos.x - orb.position.x;
      const dz = playerPos.z - orb.position.z;
      if (dx * dx + dz * dz < pickupRadius * pickupRadius) {
        orb.collected = true;
        orb.sprite.visible = false;
        orb.light.visible = false;
        collected++;
      }
    }
    // silence unused warning on dt — used implicitly for timing consistency
    void dt;
    return collected;
  }

  remainingCount(): number {
    return this.orbs.filter((o) => !o.collected).length;
  }

  total(): number {
    return this.orbs.length;
  }

  dispose(scene: THREE.Scene) {
    for (const orb of this.orbs) {
      scene.remove(orb.sprite);
      scene.remove(orb.light);
    }
    this.orbs = [];
  }
}
