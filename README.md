# SOULCHASE

A first-person horror game built with Three.js where **you play the ghost** and a distorted, bloody-mouthed Pac-Man hunts you through a dark 2.5D maze. Collect enough glowing souls to escape before he catches you.

## Gameplay

- First-person ghost movement through a grid-based maze
- A relentless Pac-Man hunter that pathfinds toward you using BFS; he chomps, breathes heavier the closer he gets, and pulses a red glow
- **Easy** (10 souls / small maze / slow hunter), **Medium** (20 / medium / keen), **Hard** (30 / large / relentless)
- Sprint drains stamina; walk to recover
- Win by collecting every soul; lose if he reaches you

The world is rendered as true 3D geometry (walls, floor, ceiling with procedural grimy textures) while the hunter and souls are billboarded 2D sprites — hitting that 2.5D feel.

## Controls

- **Desktop**: WASD to move, mouse to look (click canvas to lock mouse), **Shift** to sprint
- **Mobile**: left touch zone = move, right touch zone = look, on-screen **SPRINT** button
- **Joy-Cons / Gamepad** (paired via Bluetooth, exposed via the Web Gamepad API): left stick = move, right stick = look, **ZR / R2** to sprint

## Running locally

```bash
npm install
npm run dev
```

Open the printed URL (default <http://localhost:5173>). `npm run build` produces a static bundle in `dist/`.

## Tech

Vanilla TypeScript + [Three.js](https://threejs.org) + Vite. No binary assets — textures and audio are procedurally generated, so the whole build stays tiny and self-contained.

## Project layout

| File | Purpose |
|------|---------|
| `src/main.ts` | Entry point, UI wiring (start screen / HUD / end screens) |
| `src/game.ts` | Main game class, loop, difficulty config |
| `src/maze.ts` | Maze generation (recursive backtracker + extra loops), mesh building, collision, BFS pathfinding |
| `src/player.ts` | First-person controller, stamina/sprint |
| `src/pacman.ts` | Hunter AI, chomp animation, proximity-driven lighting |
| `src/orbs.ts` | Soul pickups |
| `src/controls.ts` | Unified input (keyboard, mouse, touch joysticks, Gamepad API) |
| `src/audio.ts` | Procedural Web Audio (ambient drone, heartbeat, chomp, breath, scream, win chime) |
| `src/textures.ts` | Canvas-drawn textures (walls, floor, ceiling, Pac-Man frames, souls) |
