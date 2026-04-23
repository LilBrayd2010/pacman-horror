import * as THREE from 'three';
import { makeWallTexture, makeFloorTexture, makeCeilingTexture } from './textures';

export type Cell = 0 | 1; // 0 = open, 1 = wall
export interface MazeData {
  grid: Cell[][]; // [y][x]
  width: number;
  height: number;
  cellSize: number;
  wallHeight: number;
  openCells: Array<{ x: number; y: number }>;
}

/** Recursive-backtracker maze generator. Produces an odd-sized maze. */
export function generateMaze(cols: number, rows: number): Cell[][] {
  if (cols % 2 === 0) cols += 1;
  if (rows % 2 === 0) rows += 1;
  const grid: Cell[][] = Array.from({ length: rows }, () => Array<Cell>(cols).fill(1));
  const stack: Array<[number, number]> = [];
  const startX = 1;
  const startY = 1;
  grid[startY][startX] = 0;
  stack.push([startX, startY]);

  while (stack.length > 0) {
    const [cx, cy] = stack[stack.length - 1];
    const neighbors: Array<[number, number, number, number]> = [];
    for (const [dx, dy] of [
      [2, 0],
      [-2, 0],
      [0, 2],
      [0, -2],
    ] as const) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx > 0 && nx < cols - 1 && ny > 0 && ny < rows - 1 && grid[ny][nx] === 1) {
        neighbors.push([nx, ny, cx + dx / 2, cy + dy / 2]);
      }
    }
    if (neighbors.length === 0) {
      stack.pop();
      continue;
    }
    const [nx, ny, wx, wy] = neighbors[Math.floor(Math.random() * neighbors.length)];
    grid[ny][nx] = 0;
    grid[wy][wx] = 0;
    stack.push([nx, ny]);
  }

  // carve a few extra loops so it's not a pure tree — makes chase more interesting
  const extra = Math.floor((cols * rows) / 40);
  for (let i = 0; i < extra; i++) {
    const x = 1 + 2 * Math.floor(Math.random() * ((cols - 1) / 2));
    const y = 1 + 2 * Math.floor(Math.random() * ((rows - 1) / 2));
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    const [dx, dy] = dirs[Math.floor(Math.random() * dirs.length)];
    const wx = x + dx;
    const wy = y + dy;
    if (wx > 0 && wx < cols - 1 && wy > 0 && wy < rows - 1) {
      grid[wy][wx] = 0;
    }
  }

  return grid;
}

export function buildMazeData(cols: number, rows: number, cellSize = 2.2, wallHeight = 3): MazeData {
  const grid = generateMaze(cols, rows);
  const openCells: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[0].length; x++) {
      if (grid[y][x] === 0) openCells.push({ x, y });
    }
  }
  return {
    grid,
    width: grid[0].length,
    height: grid.length,
    cellSize,
    wallHeight,
    openCells,
  };
}

export interface MazeMeshTint {
  wall: number;
  floor: number;
  ceiling: number;
}

export function buildMazeMesh(maze: MazeData, tint?: MazeMeshTint): THREE.Group {
  const group = new THREE.Group();
  const wallTex = makeWallTexture();
  const floorTex = makeFloorTexture();
  const ceilTex = makeCeilingTexture();
  floorTex.repeat.set(maze.width, maze.height);
  ceilTex.repeat.set(maze.width, maze.height);

  const { width, height, cellSize, wallHeight, grid } = maze;

  // floor
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(width * cellSize, height * cellSize),
    new THREE.MeshStandardMaterial({
      map: floorTex,
      roughness: 0.95,
      metalness: 0,
      color: tint?.floor ?? 0xffffff,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((width * cellSize) / 2, 0, (height * cellSize) / 2);
  floor.receiveShadow = true;
  group.add(floor);

  // ceiling
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(width * cellSize, height * cellSize),
    new THREE.MeshStandardMaterial({
      map: ceilTex,
      roughness: 1,
      metalness: 0,
      color: tint?.ceiling ?? 0xffffff,
    }),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set((width * cellSize) / 2, wallHeight, (height * cellSize) / 2);
  group.add(ceiling);

  // walls — instance each cell as a box (small maze, fine for perf)
  const wallGeo = new THREE.BoxGeometry(cellSize, wallHeight, cellSize);
  const wallMat = new THREE.MeshStandardMaterial({
    map: wallTex,
    roughness: 0.9,
    metalness: 0.0,
    color: tint?.wall ?? 0xffffff,
  });
  const dummy = new THREE.Object3D();
  let wallCount = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (grid[y][x] === 1) wallCount++;
    }
  }
  const walls = new THREE.InstancedMesh(wallGeo, wallMat, wallCount);
  walls.castShadow = true;
  walls.receiveShadow = true;
  let i = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (grid[y][x] === 1) {
        dummy.position.set(
          x * cellSize + cellSize / 2,
          wallHeight / 2,
          y * cellSize + cellSize / 2,
        );
        dummy.updateMatrix();
        walls.setMatrixAt(i++, dummy.matrix);
      }
    }
  }
  walls.instanceMatrix.needsUpdate = true;
  group.add(walls);

  return group;
}

/** Grid-space collision — return true if world point (px, pz) is blocked (inside a wall). */
export function isBlocked(maze: MazeData, px: number, pz: number): boolean {
  const gx = Math.floor(px / maze.cellSize);
  const gy = Math.floor(pz / maze.cellSize);
  if (gx < 0 || gx >= maze.width || gy < 0 || gy >= maze.height) return true;
  return maze.grid[gy][gx] === 1;
}

/** Check if the circle (px,pz, radius) collides with any wall cell. */
export function circleCollides(maze: MazeData, px: number, pz: number, radius: number): boolean {
  const minX = Math.floor((px - radius) / maze.cellSize);
  const maxX = Math.floor((px + radius) / maze.cellSize);
  const minY = Math.floor((pz - radius) / maze.cellSize);
  const maxY = Math.floor((pz + radius) / maze.cellSize);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (x < 0 || y < 0 || x >= maze.width || y >= maze.height) return true;
      if (maze.grid[y][x] === 1) {
        const cx = x * maze.cellSize;
        const cy = y * maze.cellSize;
        const closestX = Math.max(cx, Math.min(px, cx + maze.cellSize));
        const closestY = Math.max(cy, Math.min(pz, cy + maze.cellSize));
        const dx = px - closestX;
        const dz = pz - closestY;
        if (dx * dx + dz * dz < radius * radius) return true;
      }
    }
  }
  return false;
}

/** BFS shortest-path from (sx,sy) to (tx,ty) on the grid. Returns list of cells [start..target] or null. */
export function bfsPath(
  maze: MazeData,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
): Array<{ x: number; y: number }> | null {
  if (maze.grid[sy]?.[sx] !== 0 || maze.grid[ty]?.[tx] !== 0) return null;
  const prev: Array<Array<[number, number] | null>> = Array.from({ length: maze.height }, () =>
    Array<[number, number] | null>(maze.width).fill(null),
  );
  const visited: boolean[][] = Array.from({ length: maze.height }, () =>
    Array<boolean>(maze.width).fill(false),
  );
  const queue: Array<[number, number]> = [[sx, sy]];
  visited[sy][sx] = true;
  let found = false;
  while (queue.length > 0) {
    const [x, y] = queue.shift()!;
    if (x === tx && y === ty) {
      found = true;
      break;
    }
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (
        nx >= 0 &&
        ny >= 0 &&
        nx < maze.width &&
        ny < maze.height &&
        !visited[ny][nx] &&
        maze.grid[ny][nx] === 0
      ) {
        visited[ny][nx] = true;
        prev[ny][nx] = [x, y];
        queue.push([nx, ny]);
      }
    }
  }
  if (!found) return null;
  const path: Array<{ x: number; y: number }> = [];
  let cur: [number, number] | null = [tx, ty];
  while (cur) {
    path.push({ x: cur[0], y: cur[1] });
    cur = prev[cur[1]][cur[0]];
  }
  path.reverse();
  return path;
}

export function worldToGrid(maze: MazeData, wx: number, wz: number): { x: number; y: number } {
  return {
    x: Math.floor(wx / maze.cellSize),
    y: Math.floor(wz / maze.cellSize),
  };
}

export function gridToWorld(maze: MazeData, gx: number, gy: number): { x: number; z: number } {
  return {
    x: gx * maze.cellSize + maze.cellSize / 2,
    z: gy * maze.cellSize + maze.cellSize / 2,
  };
}
