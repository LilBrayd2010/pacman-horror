/**
 * Eight procedural jumpscare variants, rendered to canvas at runtime so we
 * don't need any external art assets. Each variant pairs a distinct face/effect
 * with a matching audio sting. When Pac-Man catches the player, `playRandom`
 * picks a random variant, shows it full-screen for ~0.9 s, and resolves.
 *
 * All drawing is procedural (no PNGs), which keeps the bundle light and means
 * the scare looks crisp at any resolution the player chose.
 */

export type JumpscareId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const JUMPSCARE_COUNT = 8;

export interface JumpscareAudio {
  /** Plays the chosen variant's sting synchronously. */
  play(id: JumpscareId): void;
}

interface JumpscareHandles {
  root: HTMLDivElement;
  canvas: HTMLCanvasElement;
}

let handles: JumpscareHandles | null = null;

function ensureHandles(): JumpscareHandles {
  if (handles) return handles;
  const existing = document.getElementById('jumpscare-overlay') as HTMLDivElement | null;
  const existingCanvas = document.getElementById('jumpscare-canvas') as HTMLCanvasElement | null;
  if (existing && existingCanvas) {
    handles = { root: existing, canvas: existingCanvas };
    return handles;
  }
  const root = document.createElement('div');
  root.id = 'jumpscare-overlay';
  root.className = 'jumpscare-overlay hidden';
  const canvas = document.createElement('canvas');
  canvas.id = 'jumpscare-canvas';
  root.appendChild(canvas);
  document.body.appendChild(root);
  handles = { root, canvas };
  return handles;
}

/** Pick a random jumpscare ID different from the given one (if provided). */
export function pickJumpscareId(excluding?: JumpscareId): JumpscareId {
  let id = Math.floor(Math.random() * JUMPSCARE_COUNT) as JumpscareId;
  if (excluding !== undefined && id === excluding) {
    id = ((id + 1) % JUMPSCARE_COUNT) as JumpscareId;
  }
  return id;
}

let lastPlayed: JumpscareId | undefined;

/**
 * Show a random jumpscare full-screen for ~`durationMs` milliseconds, then
 * fade out. Resolves when the overlay is hidden again so callers can chain
 * the lose screen afterwards.
 *
 * Consecutive catches never replay the same variant back-to-back.
 */
export function playRandom(audio: JumpscareAudio, durationMs = 900): Promise<void> {
  const id = pickJumpscareId(lastPlayed);
  lastPlayed = id;
  return play(id, audio, durationMs);
}

export function play(id: JumpscareId, audio: JumpscareAudio, durationMs = 900): Promise<void> {
  const { root, canvas } = ensureHandles();
  // Size the canvas to the viewport. We draw at half-res to keep paint cheap
  // on mobile — the overlay is black-on-black so the low res is invisible.
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.floor(window.innerWidth * dpr * 0.5);
  const h = Math.floor(window.innerHeight * dpr * 0.5);
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = '100vw';
  canvas.style.height = '100vh';
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve();

  root.classList.remove('hidden');
  root.classList.add('visible');
  root.setAttribute('data-variant', String(id));
  audio.play(id);

  const start = performance.now();
  let raf = 0;
  return new Promise<void>((resolve) => {
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      ctx.save();
      drawVariant(ctx, id, w, h, t);
      ctx.restore();
      if (t >= 1) {
        cancelAnimationFrame(raf);
        root.classList.add('hidden');
        root.classList.remove('visible');
        resolve();
      } else {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
  });
}

/**
 * Dispatch for the 8 variants. Each paints a distinct face/effect; parameter
 * `t` is a normalized 0..1 progress so you can ramp scale, glitch, etc.
 */
function drawVariant(ctx: CanvasRenderingContext2D, id: JumpscareId, w: number, h: number, t: number) {
  // always start with black
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  switch (id) {
    case 0:
      return drawBloodyGrin(ctx, w, h, t);
    case 1:
      return drawEyeLunge(ctx, w, h, t);
    case 2:
      return drawStaticBurst(ctx, w, h, t);
    case 3:
      return drawFaceDistort(ctx, w, h, t);
    case 4:
      return drawChompSilhouette(ctx, w, h, t);
    case 5:
      return drawInvertedGrin(ctx, w, h, t);
    case 6:
      return drawBleedingPacman(ctx, w, h, t);
    case 7:
      return drawShatterFace(ctx, w, h, t);
  }
}

// ---------- shared helpers ---------------------------------------------------

function pacmanHead(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, mouthOpen: number) {
  // base yellow disc — standard Pac-Man silhouette with the wedge carved out
  const mouth = mouthOpen * Math.PI * 0.45;
  ctx.fillStyle = '#f6d21a';
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, r, mouth, Math.PI * 2 - mouth);
  ctx.closePath();
  ctx.fill();
  // dark interior of mouth
  ctx.fillStyle = '#0a0000';
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(-mouth) * r, cy + Math.sin(-mouth) * r);
  ctx.lineTo(cx + r * 0.9, cy);
  ctx.lineTo(cx + Math.cos(mouth) * r, cy + Math.sin(mouth) * r);
  ctx.closePath();
  ctx.fill();
}

function bloodDrips(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, count: number, t: number) {
  ctx.fillStyle = '#8a0606';
  for (let i = 0; i < count; i++) {
    const a = ((i / count) - 0.5) * 0.9;
    const x = cx + Math.cos(a) * r * 0.85;
    const yTop = cy + Math.sin(a) * r * 0.85;
    const len = r * (0.25 + Math.sin(i * 13 + t * 6) * 0.2) + t * r * 0.6;
    ctx.fillRect(x - 3, yTop, 6, len);
    ctx.beginPath();
    ctx.arc(x, yTop + len, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function jaggedTeeth(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, mouthOpen: number) {
  const mouth = mouthOpen * Math.PI * 0.45;
  const topY = cy - Math.sin(mouth) * r * 0.98;
  const botY = cy + Math.sin(mouth) * r * 0.98;
  const leftX = cx + 8;
  const rightX = cx + r * 0.9;
  ctx.fillStyle = '#efe7c0';
  const toothCount = 9;
  for (let i = 0; i < toothCount; i++) {
    const frac = i / (toothCount - 1);
    const x = leftX + (rightX - leftX) * frac;
    const h = 14 + Math.sin(i * 7.7) * 8;
    // upper tooth
    ctx.beginPath();
    ctx.moveTo(x - 6, topY);
    ctx.lineTo(x + 6, topY);
    ctx.lineTo(x, topY + h);
    ctx.closePath();
    ctx.fill();
    // lower tooth
    ctx.beginPath();
    ctx.moveTo(x - 6, botY);
    ctx.lineTo(x + 6, botY);
    ctx.lineTo(x, botY - h);
    ctx.closePath();
    ctx.fill();
  }
}

function crazyEye(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, t: number, bloodshot: boolean) {
  // white sclera with wobble
  ctx.fillStyle = '#f2e8d9';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  // red veins
  if (bloodshot) {
    ctx.strokeStyle = '#8a0606';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + t * 1.3;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * r * 0.2, y + Math.sin(a) * r * 0.2);
      ctx.quadraticCurveTo(
        x + Math.cos(a + 0.3) * r * 0.6,
        y + Math.sin(a + 0.3) * r * 0.6,
        x + Math.cos(a) * r * 0.95,
        y + Math.sin(a) * r * 0.95,
      );
      ctx.stroke();
    }
  }
  // iris
  ctx.fillStyle = '#111';
  const jitterX = Math.sin(t * 30) * 3;
  const jitterY = Math.cos(t * 27) * 2;
  ctx.beginPath();
  ctx.arc(x + jitterX, y + jitterY, r * 0.45, 0, Math.PI * 2);
  ctx.fill();
  // highlight
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(x + jitterX - r * 0.15, y + jitterY - r * 0.18, r * 0.12, 0, Math.PI * 2);
  ctx.fill();
}

// ---------- 8 variants -------------------------------------------------------

function drawBloodyGrin(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) * (0.25 + t * 0.25);
  pacmanHead(ctx, cx, cy, r, 1.0);
  jaggedTeeth(ctx, cx, cy, r, 1.0);
  bloodDrips(ctx, cx, cy, r, 10, t);
  // red-tint vignette
  const grad = ctx.createRadialGradient(cx, cy, r * 0.8, cx, cy, Math.max(w, h));
  grad.addColorStop(0, 'rgba(120,0,0,0)');
  grad.addColorStop(1, `rgba(120,0,0,${0.7 * t})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

function drawEyeLunge(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const cx = w / 2;
  const cy = h / 2;
  // a single giant eye that grows to fill the frame
  const r = Math.min(w, h) * (0.1 + t * 0.55);
  crazyEye(ctx, cx, cy, r, t, true);
  // black bars at top/bottom for letterbox tension
  const bar = h * 0.12 * (1 - t);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, bar);
  ctx.fillRect(0, h - bar, w, bar);
}

function drawStaticBurst(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  // TV static snow with the faint outline of Pac-Man
  const id = ctx.createImageData(w, h);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.random() * 255;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  // silhouette head overlay
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) * 0.35;
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = '#000';
  pacmanHead(ctx, cx, cy, r, 0.9);
  ctx.globalAlpha = 1;
  // red scan line sweep
  const y = (t * h) | 0;
  ctx.fillStyle = 'rgba(200,20,20,0.5)';
  ctx.fillRect(0, y - 2, w, 4);
}

function drawFaceDistort(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) * 0.35;
  // stretched/warped head — scale Y non-uniformly over time
  ctx.save();
  ctx.translate(cx, cy);
  const sx = 1 + Math.sin(t * 18) * 0.12;
  const sy = 1 - Math.sin(t * 18) * 0.12;
  ctx.scale(sx, sy);
  pacmanHead(ctx, 0, 0, r, 0.85);
  jaggedTeeth(ctx, 0, 0, r, 0.85);
  ctx.restore();
  // chromatic aberration ghost
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.35;
  ctx.drawImage(ctx.canvas, 8 * t, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

function drawChompSilhouette(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  // back-lit silhouette against red glow
  const cx = w / 2;
  const cy = h / 2;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(w, h));
  grad.addColorStop(0, '#d61818');
  grad.addColorStop(0.4, '#400404');
  grad.addColorStop(1, '#000');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  const r = Math.min(w, h) * (0.28 + t * 0.08);
  const mouth = 0.4 + Math.sin(t * 30) * 0.6;
  ctx.fillStyle = '#000';
  pacmanHead(ctx, cx, cy, r, Math.max(0.2, mouth));
}

function drawInvertedGrin(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  // upside-down jaw with two eyes on the bottom half — classic uncanny look
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) * (0.28 + t * 0.18);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.PI); // upside-down
  pacmanHead(ctx, 0, 0, r, 0.95);
  jaggedTeeth(ctx, 0, 0, r, 0.95);
  ctx.restore();
  // two bloodshot eyes hovering
  const er = r * 0.18;
  crazyEye(ctx, cx - r * 0.45, cy + r * 0.55, er, t, true);
  crazyEye(ctx, cx + r * 0.45, cy + r * 0.55, er, t, true);
}

function drawBleedingPacman(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) * (0.3 + t * 0.15);
  pacmanHead(ctx, cx, cy, r, 0.6);
  // tears of blood from where eyes should be
  ctx.fillStyle = '#8a0606';
  for (const ex of [cx - r * 0.35, cx + r * 0.35]) {
    const ey = cy - r * 0.3;
    ctx.beginPath();
    ctx.arc(ex, ey, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(ex - 4, ey, 8, r * 0.6 + r * t);
  }
  // mouth drool
  bloodDrips(ctx, cx, cy + r * 0.1, r * 0.9, 6, t);
}

function drawShatterFace(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) * 0.35;
  pacmanHead(ctx, cx, cy, r, 0.9);
  jaggedTeeth(ctx, cx, cy, r, 0.9);
  // crack lines radiating outward as `t` increases
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 4;
  const cracks = 14;
  for (let i = 0; i < cracks; i++) {
    const a = (i / cracks) * Math.PI * 2 + Math.sin(i * 5.3);
    const startR = r * 0.2;
    const endR = r * (0.5 + t * 1.2);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * startR, cy + Math.sin(a) * startR);
    // jagged 3-segment crack
    for (let s = 1; s <= 3; s++) {
      const f = s / 3;
      const wobble = Math.sin(i * 11 + s * 3) * 18;
      const pa = a + wobble * 0.01;
      const pr = startR + (endR - startR) * f;
      ctx.lineTo(cx + Math.cos(pa) * pr + wobble, cy + Math.sin(pa) * pr + wobble);
    }
    ctx.stroke();
  }
}
