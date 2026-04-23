import * as THREE from 'three';
import { AudioEngine } from './audio';
import { Controls } from './controls';
import { buildMazeData, buildMazeMesh, gridToWorld, type MazeData } from './maze';
import { Orbs } from './orbs';
import { Pacman } from './pacman';
import { Player } from './player';

export type Difficulty = 'easy' | 'medium' | 'hard';

interface DifficultyConfig {
  souls: number;
  pacmanSpeed: number;
  mazeCols: number;
  mazeRows: number;
}

const DIFFICULTIES: Record<Difficulty, DifficultyConfig> = {
  easy: { souls: 10, pacmanSpeed: 1.7, mazeCols: 13, mazeRows: 13 },
  medium: { souls: 20, pacmanSpeed: 2.3, mazeCols: 17, mazeRows: 17 },
  hard: { souls: 30, pacmanSpeed: 2.9, mazeCols: 21, mazeRows: 21 },
};

export type GameEndReason = 'win' | 'lose';

export interface GameCallbacks {
  onSoulUpdate: (collected: number, total: number) => void;
  onStaminaUpdate: (stamina: number) => void;
  onTensionUpdate: (tension: number) => void;
  onEnd: (reason: GameEndReason) => void;
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
  private raf = 0;
  private chompTimer = 0;
  private breathTimer = 0;
  private totalSouls = 0;
  private collectedSouls = 0;
  private cbs: GameCallbacks;

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

  start(difficulty: Difficulty) {
    this.reset();
    const cfg = DIFFICULTIES[difficulty];
    this.totalSouls = cfg.souls;
    this.collectedSouls = 0;

    this.maze = buildMazeData(cfg.mazeCols, cfg.mazeRows);
    this.mazeMesh = buildMazeMesh(this.maze);
    this.scene.add(this.mazeMesh);

    // lighting — dim ambient so the hunter's and orbs' lights pop
    const ambient = new THREE.AmbientLight(0x1a2030, 0.55);
    this.scene.add(ambient);
    const moon = new THREE.DirectionalLight(0x4a5a80, 0.2);
    moon.position.set(1, 4, 2);
    this.scene.add(moon);

    // choose player start in a corner, hunter start in the opposite corner
    const startCell = this.maze.openCells[0]; // near (1,1) thanks to generator
    const farCell = this.maze.openCells[this.maze.openCells.length - 1];
    const startW = gridToWorld(this.maze, startCell.x, startCell.y);
    const farW = gridToWorld(this.maze, farCell.x, farCell.y);

    // a faint ghostly glow on the player so they can see immediate surroundings
    this.ghostLight = new THREE.PointLight(0x88aaff, 0.9, 5.5, 2);
    this.ghostLight.position.set(startW.x, 1.5, startW.z);
    this.scene.add(this.ghostLight);

    this.player = new Player({
      maze: this.maze,
      startX: startW.x,
      startZ: startW.z,
      startYaw: 0,
    });

    this.pacman = new Pacman({
      maze: this.maze,
      startX: farW.x,
      startZ: farW.z,
      speed: cfg.pacmanSpeed,
    });
    this.pacman.addTo(this.scene);

    // place orbs — avoid start cell and hunter cell
    this.orbs = new Orbs(this.scene, this.maze, cfg.souls, [startCell, farCell]);

    this.cbs.onSoulUpdate(0, this.totalSouls);
    this.cbs.onStaminaUpdate(1);

    this.audio.init();
    this.audio.resumeIfSuspended();
    this.audio.startAmbient();

    this.running = true;
    this.clock.start();
    this.loop();
  }

  private loop = () => {
    if (!this.running) return;
    const dt = Math.min(0.05, this.clock.getDelta());

    const mouseDelta = this.controls.sample();
    this.player.update(dt, this.controls.state, mouseDelta);
    this.player.applyToCamera(this.camera);
    if (this.ghostLight) {
      this.ghostLight.position.copy(this.player.position);
    }

    const { caught, distance } = this.pacman.update(dt, this.player.position);

    const pickedUp = this.orbs.update(dt, this.player.position);
    if (pickedUp > 0) {
      this.collectedSouls += pickedUp;
      this.cbs.onSoulUpdate(this.collectedSouls, this.totalSouls);
      this.audio.playPickup();
      if (this.collectedSouls >= this.totalSouls) {
        this.audio.playWin();
        this.running = false;
        this.cbs.onEnd('win');
        return;
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
      this.audio.playScream();
      this.running = false;
      this.cbs.onEnd('lose');
      return;
    }

    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.loop);
  };

  stop() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.audio.stopAll();
    this.controls.releasePointerLock();
  }

  reset() {
    this.stop();
    this.ghostLight = null;
    // remove everything that was added last run (lights, pacman sprite, orbs, maze)
    while (this.scene.children.length > 0) {
      this.scene.remove(this.scene.children[0]);
    }
  }
}
