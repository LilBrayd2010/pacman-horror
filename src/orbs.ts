import * as THREE from 'three';
import type { MazeData } from './maze';
import { gridToWorld } from './maze';
import { makeOrbTexture } from './textures';

/**
 * A collectible soul. Visually built from three billboarded pieces so the
 * effect reads even in the darkest corners of the maze:
 *   - `core`: bright additive sprite, pulses in scale
 *   - `halo`: larger, softer additive sprite behind the core, slowly counter-
 *     rotating in screen-space for a "spinning" feel
 *   - `light`: point light that flickers subtly
 * Each orb also bobs vertically on its own phase so a cluster never looks
 * perfectly synchronized.
 */
export interface Orb {
  sprite: THREE.Sprite;
  halo: THREE.Sprite;
  light: THREE.PointLight;
  position: THREE.Vector3;
  collected: boolean;
  bobPhase: number;
  /** Persistent randomized phase so halo rotation doesn't reset every frame. */
  spinPhase: number;
}

const BASE_SCALE = 0.55;
const HALO_SCALE = 1.35;

export class Orbs {
  orbs: Orb[] = [];
  /** Dev-tool toggle — when true, orbs render much larger with a brighter
   * point-light range so a developer can see them from anywhere. Read from
   * update() every frame, so toggling it takes effect on the next tick. */
  reveal = false;
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
      const coreMat = new THREE.SpriteMaterial({
        map: this.texture,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const sprite = new THREE.Sprite(coreMat);
      sprite.scale.set(BASE_SCALE, BASE_SCALE, 1);
      const y = 1.2;
      sprite.position.set(w.x, y, w.z);
      scene.add(sprite);

      // Halo sits just behind the core in world space but is drawn at a
      // larger size with lower opacity so the two read as one glowing soul.
      const haloMat = new THREE.SpriteMaterial({
        map: this.texture,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0.45,
      });
      const halo = new THREE.Sprite(haloMat);
      halo.scale.set(HALO_SCALE, HALO_SCALE, 1);
      halo.position.set(w.x, y, w.z);
      scene.add(halo);

      const light = new THREE.PointLight(0xaccfff, 0.8, 2.5, 2);
      light.position.set(w.x, y, w.z);
      scene.add(light);

      this.orbs.push({
        sprite,
        halo,
        light,
        position: new THREE.Vector3(w.x, y, w.z),
        collected: false,
        bobPhase: Math.random() * Math.PI * 2,
        spinPhase: Math.random() * Math.PI * 2,
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
      orb.halo.position.y = orb.sprite.position.y;
      orb.light.position.y = orb.sprite.position.y;

      // Core pulses in scale (~±15%), halo breathes at a different rate so
      // the two never perfectly align — gives the soul a living quality.
      // `reveal` multiplies both so the dev-tool toggle dwarfs the pulse.
      const revealMul = this.reveal ? 2.7 : 1;
      const pulse = 1 + 0.15 * Math.sin(t * 2.3 + orb.bobPhase);
      const haloBreathe = 1 + 0.12 * Math.sin(t * 1.6 + orb.bobPhase * 0.7);
      orb.sprite.scale.setScalar(BASE_SCALE * pulse * revealMul);
      orb.halo.scale.setScalar(HALO_SCALE * haloBreathe * revealMul);

      // Spin in screen-space via SpriteMaterial.rotation (radians). Core and
      // halo rotate opposite directions at slightly different speeds so the
      // halo appears to drift around the core.
      orb.sprite.material.rotation = orb.spinPhase + t * 0.35;
      orb.halo.material.rotation = orb.spinPhase - t * 0.22;

      // gentle flicker on the point light
      orb.light.intensity = 0.7 + 0.3 * Math.sin(t * 3 + orb.bobPhase);

      const dx = playerPos.x - orb.position.x;
      const dz = playerPos.z - orb.position.z;
      if (dx * dx + dz * dz < pickupRadius * pickupRadius) {
        orb.collected = true;
        orb.sprite.visible = false;
        orb.halo.visible = false;
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
      scene.remove(orb.halo);
      scene.remove(orb.light);
    }
    this.orbs = [];
  }
}
