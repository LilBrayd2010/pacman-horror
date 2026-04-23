import * as THREE from 'three';

// Procedural textures — drawn to a canvas and turned into a THREE texture.
// Keeps the project self-contained (no binary assets).

function makeCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  return { canvas, ctx };
}

function toTexture(canvas: HTMLCanvasElement, repeat = 1): THREE.Texture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipMapLinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** Rough, grimy wall — dark bricks with cracks and blood splatter. */
export function makeWallTexture(): THREE.Texture {
  const SIZE = 256;
  const { canvas, ctx } = makeCanvas(SIZE);

  // base
  ctx.fillStyle = '#141318';
  ctx.fillRect(0, 0, SIZE, SIZE);

  // noise grain
  const img = ctx.getImageData(0, 0, SIZE, SIZE);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 18;
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);

  // bricks
  const brickH = 32;
  const brickW = 64;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.lineWidth = 2;
  for (let y = 0; y < SIZE; y += brickH) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(SIZE, y);
    ctx.stroke();
    const offset = ((y / brickH) % 2) * (brickW / 2);
    for (let x = -brickW; x < SIZE + brickW; x += brickW) {
      ctx.beginPath();
      ctx.moveTo(x + offset, y);
      ctx.lineTo(x + offset, y + brickH);
      ctx.stroke();
    }
  }

  // cracks
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 12; i++) {
    ctx.beginPath();
    let x = Math.random() * SIZE;
    let y = Math.random() * SIZE;
    ctx.moveTo(x, y);
    for (let s = 0; s < 5; s++) {
      x += (Math.random() - 0.5) * 30;
      y += (Math.random() - 0.5) * 30;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // blood splatter
  for (let i = 0; i < 3; i++) {
    const x = Math.random() * SIZE;
    const y = Math.random() * SIZE;
    const grad = ctx.createRadialGradient(x, y, 2, x, y, 30 + Math.random() * 20);
    grad.addColorStop(0, 'rgba(100, 5, 5, 0.9)');
    grad.addColorStop(0.5, 'rgba(60, 0, 0, 0.6)');
    grad.addColorStop(1, 'rgba(20, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, 30 + Math.random() * 20, 0, Math.PI * 2);
    ctx.fill();
    // drip
    ctx.fillStyle = 'rgba(60, 0, 0, 0.6)';
    ctx.fillRect(x - 1, y, 2 + Math.random() * 2, 40 + Math.random() * 30);
  }

  return toTexture(canvas, 1);
}

/** Floor — damp concrete with dark stains. */
export function makeFloorTexture(): THREE.Texture {
  const SIZE = 256;
  const { canvas, ctx } = makeCanvas(SIZE);
  ctx.fillStyle = '#0a0a0c';
  ctx.fillRect(0, 0, SIZE, SIZE);
  const img = ctx.getImageData(0, 0, SIZE, SIZE);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 22;
    img.data[i] = Math.max(0, img.data[i] + n);
    img.data[i + 1] = Math.max(0, img.data[i + 1] + n);
    img.data[i + 2] = Math.max(0, img.data[i + 2] + n);
  }
  ctx.putImageData(img, 0, 0);

  // stains
  for (let i = 0; i < 8; i++) {
    const x = Math.random() * SIZE;
    const y = Math.random() * SIZE;
    const r = 15 + Math.random() * 40;
    const grad = ctx.createRadialGradient(x, y, 2, x, y, r);
    grad.addColorStop(0, 'rgba(30, 10, 10, 0.8)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return toTexture(canvas, 1);
}

/** Ceiling — pitch black with faint grain. */
export function makeCeilingTexture(): THREE.Texture {
  const SIZE = 128;
  const { canvas, ctx } = makeCanvas(SIZE);
  ctx.fillStyle = '#020203';
  ctx.fillRect(0, 0, SIZE, SIZE);
  const img = ctx.getImageData(0, 0, SIZE, SIZE);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = Math.random() * 10;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(canvas, 1);
}

/**
 * Pac-Man hunter sprite — genuinely unsettling.
 * Yellow distorted face, human teeth, bloody mouth, hollow eyes.
 * `mouthOpen` 0..1 controls how wide the maw gapes (for chomp animation).
 * Returns a transparent PNG-style texture meant to be rendered as a billboard.
 */
export function makePacmanTexture(mouthOpen: number): THREE.Texture {
  const SIZE = 512;
  const { canvas, ctx } = makeCanvas(SIZE);
  ctx.clearRect(0, 0, SIZE, SIZE);

  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const radius = SIZE * 0.42;

  // sickly yellow body with dark veins
  const bodyGrad = ctx.createRadialGradient(cx - 40, cy - 60, 20, cx, cy, radius);
  bodyGrad.addColorStop(0, '#fff27a');
  bodyGrad.addColorStop(0.4, '#e8c200');
  bodyGrad.addColorStop(0.75, '#8a6a00');
  bodyGrad.addColorStop(1, '#2a1d00');

  // wedge angle
  const mouthAngle = (0.15 + mouthOpen * 0.75) * Math.PI; // 0.15π..0.9π
  const startAngle = mouthAngle / 2;
  const endAngle = Math.PI * 2 - mouthAngle / 2;

  ctx.save();
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, radius, startAngle, endAngle);
  ctx.closePath();
  ctx.fill();

  // veins
  ctx.strokeStyle = 'rgba(40, 20, 0, 0.55)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 14; i++) {
    const ang = Math.random() * Math.PI * 2;
    const r0 = radius * (0.4 + Math.random() * 0.3);
    const r1 = radius * (0.8 + Math.random() * 0.2);
    ctx.beginPath();
    let x = cx + Math.cos(ang) * r0;
    let y = cy + Math.sin(ang) * r0;
    ctx.moveTo(x, y);
    for (let s = 0; s < 4; s++) {
      const t = (s + 1) / 4;
      const rr = r0 + (r1 - r0) * t;
      const aa = ang + (Math.random() - 0.5) * 0.2;
      x = cx + Math.cos(aa) * rr;
      y = cy + Math.sin(aa) * rr;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();

  // mouth interior — deep red/black void
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, radius * 0.98, -mouthAngle / 2, mouthAngle / 2, false);
  ctx.closePath();
  ctx.clip();
  const mouthGrad = ctx.createRadialGradient(cx, cy, 10, cx, cy, radius);
  mouthGrad.addColorStop(0, '#000');
  mouthGrad.addColorStop(0.6, '#2a0000');
  mouthGrad.addColorStop(1, '#6a0000');
  ctx.fillStyle = mouthGrad;
  ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

  // human teeth along the mouth edges (top + bottom)
  const drawTeeth = (ySign: number) => {
    const teethCount = 8;
    for (let i = 0; i < teethCount; i++) {
      const t = i / (teethCount - 1);
      const ang = -mouthAngle / 2 + t * mouthAngle;
      const tipX = cx + Math.cos(ang) * radius;
      const tipY = cy + Math.sin(ang) * radius;
      const bisectorX = cx + Math.cos(ang) * (radius * 0.85);
      const bisectorY = cy + Math.sin(ang) * (radius * 0.85) - ySign * 6;
      const toothW = 14;
      const toothH = 34 + (Math.abs(0.5 - t) < 0.15 ? 12 : 0); // longer canines near center
      ctx.save();
      ctx.translate(tipX, tipY);
      ctx.rotate(ang + Math.PI / 2);
      ctx.fillStyle = '#d9cfb5';
      ctx.beginPath();
      ctx.moveTo(-toothW / 2, 0);
      ctx.lineTo(toothW / 2, 0);
      ctx.lineTo(0, -ySign * toothH);
      ctx.closePath();
      ctx.fill();
      // shadow on tooth
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.moveTo(-toothW / 2, 0);
      ctx.lineTo(0, -ySign * toothH);
      ctx.lineTo(-toothW / 4, -ySign * toothH * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      // blood dripping from some teeth
      if (i % 3 === 1 && ySign > 0) {
        ctx.fillStyle = 'rgba(120, 0, 0, 0.85)';
        ctx.fillRect(bisectorX - 2, bisectorY, 3, 24 + Math.random() * 10);
      }
    }
  };
  drawTeeth(1);
  drawTeeth(-1);

  // tongue / deeper throat
  const throatR = radius * 0.3;
  const tg = ctx.createRadialGradient(cx + 30, cy + 10, 5, cx, cy, throatR);
  tg.addColorStop(0, '#400');
  tg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = tg;
  ctx.beginPath();
  ctx.arc(cx, cy, throatR, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  // blood smear around mouth
  ctx.strokeStyle = 'rgba(110, 0, 0, 0.85)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 1.02, -mouthAngle / 2 - 0.1, mouthAngle / 2 + 0.1);
  ctx.stroke();

  // hollow eye — single eye above the mouth
  const eyeX = cx - radius * 0.25;
  const eyeY = cy - radius * 0.55;
  const eyeR = radius * 0.12;
  // dark socket
  const socketGrad = ctx.createRadialGradient(eyeX, eyeY, 2, eyeX, eyeY, eyeR * 1.6);
  socketGrad.addColorStop(0, '#000');
  socketGrad.addColorStop(0.7, '#100000');
  socketGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = socketGrad;
  ctx.beginPath();
  ctx.arc(eyeX, eyeY, eyeR * 1.6, 0, Math.PI * 2);
  ctx.fill();
  // red glowing pupil
  const pupilGrad = ctx.createRadialGradient(eyeX, eyeY, 0, eyeX, eyeY, eyeR);
  pupilGrad.addColorStop(0, '#fff');
  pupilGrad.addColorStop(0.25, '#ff3030');
  pupilGrad.addColorStop(1, '#400');
  ctx.fillStyle = pupilGrad;
  ctx.beginPath();
  ctx.arc(eyeX, eyeY, eyeR * 0.6, 0, Math.PI * 2);
  ctx.fill();

  // second eye — asymmetric, lower, bloodshot
  const eye2X = cx + radius * 0.05;
  const eye2Y = cy - radius * 0.35;
  const eye2R = radius * 0.08;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(eye2X, eye2Y, eye2R * 1.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(eye2X, eye2Y, eye2R, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#900';
  ctx.beginPath();
  ctx.arc(eye2X + 1, eye2Y + 1, eye2R * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#b00';
  ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    const a = Math.random() * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(eye2X, eye2Y);
    ctx.lineTo(eye2X + Math.cos(a) * eye2R * 0.9, eye2Y + Math.sin(a) * eye2R * 0.9);
    ctx.stroke();
  }

  // outer dark outline
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, startAngle, endAngle);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Soul orb sprite — glowing pale ball with a faint face. */
export function makeOrbTexture(): THREE.Texture {
  const SIZE = 128;
  const { canvas, ctx } = makeCanvas(SIZE);
  ctx.clearRect(0, 0, SIZE, SIZE);
  const cx = SIZE / 2;
  const cy = SIZE / 2;

  // glow halo
  const halo = ctx.createRadialGradient(cx, cy, 4, cx, cy, SIZE / 2);
  halo.addColorStop(0, 'rgba(220, 240, 255, 1)');
  halo.addColorStop(0.35, 'rgba(160, 200, 255, 0.5)');
  halo.addColorStop(0.7, 'rgba(100, 140, 200, 0.15)');
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // core
  const core = ctx.createRadialGradient(cx - 4, cy - 6, 1, cx, cy, SIZE * 0.25);
  core.addColorStop(0, '#ffffff');
  core.addColorStop(0.7, '#cfe4ff');
  core.addColorStop(1, 'rgba(150, 190, 240, 0)');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, SIZE * 0.28, 0, Math.PI * 2);
  ctx.fill();

  // faint face hint (two eyes + o mouth) suggests a trapped soul
  ctx.fillStyle = 'rgba(40, 50, 80, 0.35)';
  ctx.beginPath();
  ctx.arc(cx - 6, cy - 4, 2, 0, Math.PI * 2);
  ctx.arc(cx + 6, cy - 4, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(40, 50, 80, 0.35)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy + 4, 3, 0, Math.PI * 2);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
