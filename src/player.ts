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

  /** Accessibility: when true, all camera motion not driven by player input
   * (head-bob, screen-shake, sway) is suppressed. Exposed so Settings can
   * flip it without touching camera internals. */
  reducedMotion = false;
  /** Screen-shake magnitude in world units. Decays exponentially each frame.
   * Set via {@link triggerShake}; read by {@link applyToCamera}. */
  private shakeAmp = 0;
  /** Cached bob phase so reducing dt (pause) doesn't teleport the bob. */
  private bobPhase = 0;

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

    // Advance head-bob phase at a speed proportional to how fast the player
    // is moving — stops cleanly when stationary so idle doesn't bob.
    const speedMag = Math.hypot(vx, vz);
    if (speedMag > 0.1) {
      // Sprinting raises the step cadence noticeably; matches "leaning into a run".
      const cadence = this.sprinting ? 9.5 : 6.0;
      this.bobPhase += dt * cadence;
    }

    // Decay screen-shake. Exponential so big hits taper quickly without ever
    // hitting exactly zero (just clamped below).
    if (this.shakeAmp > 0) {
      this.shakeAmp = Math.max(0, this.shakeAmp * Math.pow(0.01, dt) - 0.001 * dt);
    }
  }

  /** Kick the camera with a transient shake. Amp is world units; typical
   * values: 0.05 (shield absorb), 0.15 (catch). Ignored when `reducedMotion`
   * is on so motion-sensitive players never get shaken. */
  triggerShake(amp: number) {
    if (this.reducedMotion) return;
    if (amp > this.shakeAmp) this.shakeAmp = amp;
  }

  applyToCamera(camera: THREE.PerspectiveCamera) {
    camera.position.copy(this.position);
    // Head-bob: vertical sine + tiny lateral sway tied to same phase. Amplitude
    // scales with movement speed; sprinting bobs ~2x harder.
    const moving = this.velocity.length() > 0.1;
    let bobY = 0;
    let bobX = 0;
    if (moving && !this.reducedMotion) {
      const ampY = this.sprinting ? 0.085 : 0.045;
      const ampX = this.sprinting ? 0.03 : 0.015;
      bobY = Math.sin(this.bobPhase) * ampY;
      bobX = Math.cos(this.bobPhase * 0.5) * ampX;
    }
    // Screen-shake: random offset scaled by current amplitude. Uses time-based
    // noise so the shake looks jittery rather than smooth.
    let shakeX = 0;
    let shakeY = 0;
    if (this.shakeAmp > 0 && !this.reducedMotion) {
      const t = performance.now() * 0.06;
      shakeX = Math.sin(t * 11 + 1.3) * this.shakeAmp;
      shakeY = Math.sin(t * 13 + 0.7) * this.shakeAmp;
    }
    // Build final camera position. Sway is applied along the camera's local
    // right vector so it reads as head movement regardless of facing.
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);
    camera.position.x = this.position.x + (bobX + shakeX) * rightX;
    camera.position.y = this.position.y + bobY + shakeY;
    camera.position.z = this.position.z + (bobX + shakeX) * rightZ;
    // order YXZ: yaw then pitch then roll — suitable for FPS cameras
    camera.rotation.order = 'YXZ';
    camera.rotation.set(this.pitch, this.yaw, 0);
  }
}
