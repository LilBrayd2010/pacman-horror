import * as THREE from 'three';
import type { MazeData } from './maze';
import { circleCollides } from './maze';
import type { PlayerModifiers } from './upgrades';

export interface PlayerOptions {
  maze: MazeData;
  startX: number; // world x
  startZ: number; // world z
  startYaw?: number;
}

export class Player {
  position = new THREE.Vector3();
  yaw = 0; // radians, 0 = +Z
  pitch = 0;
  velocity = new THREE.Vector3();
  stamina = 1; // 0..1
  sprinting = false;
  /** seconds of pickup-burst speed still active (from Drift Step upgrade). */
  burstRemaining = 0;

  radius = 0.35;
  height = 1.55;
  walkSpeed = 3.2;
  sprintSpeed = 5.4;
  mouseSensitivity = 0.0022;
  stickSensitivity = 2.6; // radians/sec at full stick
  staminaDrain = 0.22; // per sec sprinting
  staminaRegen = 0.15; // per sec idle

  private maze: MazeData;

  constructor(opts: PlayerOptions) {
    this.maze = opts.maze;
    this.position.set(opts.startX, this.height, opts.startZ);
    this.yaw = opts.startYaw ?? 0;
  }

  update(
    dt: number,
    input: {
      moveX: number;
      moveY: number;
      lookX: number;
      lookY: number;
      sprint: boolean;
    },
    mouseDelta: { lookDX: number; lookDY: number },
    mods?: PlayerModifiers,
  ) {
    // look — mouse delta + right stick
    this.yaw -= mouseDelta.lookDX * this.mouseSensitivity;
    this.pitch -= mouseDelta.lookDY * this.mouseSensitivity;
    this.yaw -= input.lookX * this.stickSensitivity * dt;
    this.pitch -= input.lookY * this.stickSensitivity * dt;
    const maxPitch = Math.PI / 2 - 0.1;
    this.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.pitch));

    const moveMul = mods?.moveSpeedMul ?? 1;
    const sprintMul = mods?.sprintSpeedMul ?? 1;
    const staminaCap = mods?.staminaCapMul ?? 1;
    const drainMul = mods?.staminaDrainMul ?? 1;
    const regenMul = mods?.staminaRegenMul ?? 1;

    // sprint / stamina
    const wantsSprint = input.sprint && (Math.abs(input.moveX) > 0.05 || Math.abs(input.moveY) > 0.05);
    this.sprinting = wantsSprint && this.stamina > 0.01;
    const walkSpeed = this.walkSpeed * moveMul;
    const sprintSpeed = this.sprintSpeed * moveMul * sprintMul;
    let baseSpeed = this.sprinting ? sprintSpeed : walkSpeed;
    // Drift Step pickup burst
    if (this.burstRemaining > 0) {
      this.burstRemaining = Math.max(0, this.burstRemaining - dt);
      baseSpeed *= 1.7;
    }
    if (this.sprinting) {
      this.stamina = Math.max(0, this.stamina - this.staminaDrain * drainMul * dt);
    } else {
      this.stamina = Math.min(staminaCap, this.stamina + this.staminaRegen * regenMul * dt);
    }
    // clamp stamina if cap shrank (e.g. Deep Lungs then a -cap upgrade)
    if (this.stamina > staminaCap) this.stamina = staminaCap;

    // Movement basis in world space. Three.js cameras look at -Z by default,
    // so for yaw=0 the player's forward is (0, 0, -1) and their right is
    // (+1, 0, 0) — i.e. right = cross(forward, up) in a right-handed frame.
    const forwardX = -Math.sin(this.yaw);
    const forwardZ = -Math.cos(this.yaw);
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);

    let vx = (forwardX * input.moveY + rightX * input.moveX) * baseSpeed;
    let vz = (forwardZ * input.moveY + rightZ * input.moveX) * baseSpeed;

    // separate-axis collision so sliding along walls feels natural
    const nextX = this.position.x + vx * dt;
    if (!circleCollides(this.maze, nextX, this.position.z, this.radius)) {
      this.position.x = nextX;
    } else {
      vx = 0;
    }
    const nextZ = this.position.z + vz * dt;
    if (!circleCollides(this.maze, this.position.x, nextZ, this.radius)) {
      this.position.z = nextZ;
    } else {
      vz = 0;
    }

    this.velocity.set(vx, 0, vz);
  }

  applyToCamera(camera: THREE.PerspectiveCamera) {
    camera.position.copy(this.position);
    // slight head-bob while moving
    const bob = this.velocity.length() > 0.1 ? Math.sin(performance.now() * 0.012) * 0.04 : 0;
    camera.position.y = this.position.y + bob;
    // order YXZ: yaw then pitch then roll — suitable for FPS cameras
    camera.rotation.order = 'YXZ';
    camera.rotation.set(this.pitch, this.yaw, 0);
  }
}
