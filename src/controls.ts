/**
 * Unified input manager — merges keyboard/mouse, touch joysticks, and Gamepad API
 * (Joy-Cons paired over Bluetooth expose themselves via the Gamepad API).
 */

export interface InputState {
  moveX: number; // -1..1
  moveY: number; // -1..1  (forward +1, back -1)
  lookX: number; // -1..1
  lookY: number; // -1..1
  sprint: boolean;
}

type TouchStick = {
  active: boolean;
  pointerId: number | null;
  originX: number;
  originY: number;
  dx: number;
  dy: number;
  el: HTMLElement;
  knob: HTMLElement;
  radius: number;
};

export class Controls {
  state: InputState = { moveX: 0, moveY: 0, lookX: 0, lookY: 0, sprint: false };

  private keys = new Set<string>();
  private mouseDeltaX = 0;
  private mouseDeltaY = 0;
  private pointerLocked = false;

  private leftStick: TouchStick | null = null;
  private rightStick: TouchStick | null = null;
  private sprintTouched = false;

  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.attachKeyboard();
    this.attachMouse();
    this.attachTouch();
  }

  private attachKeyboard() {
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.state.sprint = true;
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.state.sprint = false;
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.state.sprint = false;
    });
  }

  private attachMouse() {
    this.canvas.addEventListener('click', () => {
      if (!this.pointerLocked) this.canvas.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.mouseDeltaX += e.movementX;
      this.mouseDeltaY += e.movementY;
    });
  }

  private attachTouch() {
    const left = document.getElementById('touch-left');
    const leftKnob = document.getElementById('touch-left-knob');
    const right = document.getElementById('touch-right');
    const rightKnob = document.getElementById('touch-right-knob');
    const sprintBtn = document.getElementById('touch-sprint');
    if (!left || !leftKnob || !right || !rightKnob || !sprintBtn) return;

    const makeStick = (el: HTMLElement, knob: HTMLElement): TouchStick => ({
      active: false,
      pointerId: null,
      originX: 0,
      originY: 0,
      dx: 0,
      dy: 0,
      el,
      knob,
      radius: 0,
    });
    this.leftStick = makeStick(left, leftKnob);
    this.rightStick = makeStick(right, rightKnob);

    const bindStick = (stick: TouchStick) => {
      stick.el.addEventListener('pointerdown', (e) => {
        if (stick.active) return;
        try {
          stick.el.setPointerCapture(e.pointerId);
        } catch {
          // Some browsers throw if the pointer is already captured elsewhere.
          // The global pointermove listener below handles the fallback.
        }
        stick.pointerId = e.pointerId;
        stick.active = true;
        const rect = stick.el.getBoundingClientRect();
        stick.radius = rect.width / 2;
        // Floating origin: wherever the user first touched becomes the stick
        // center. Gives full 360° travel in every direction without having
        // to first drag the finger back to the visual center of the pad.
        stick.originX = e.clientX;
        stick.originY = e.clientY;
        stick.dx = 0;
        stick.dy = 0;
        stick.knob.style.transform = 'translate(-50%, -50%)';
        e.preventDefault();
      });
      const move = (e: PointerEvent) => {
        if (!stick.active || stick.pointerId !== e.pointerId) return;
        let dx = e.clientX - stick.originX;
        let dy = e.clientY - stick.originY;
        const len = Math.hypot(dx, dy);
        const max = stick.radius * 0.9;
        if (len > max) {
          dx = (dx / len) * max;
          dy = (dy / len) * max;
        }
        stick.dx = dx / max;
        stick.dy = dy / max;
        stick.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      };
      const release = (e: PointerEvent) => {
        if (stick.pointerId !== e.pointerId) return;
        stick.active = false;
        stick.pointerId = null;
        stick.dx = 0;
        stick.dy = 0;
        stick.knob.style.transform = 'translate(-50%, -50%)';
      };
      // Listen at both the stick element AND window, so a finger that leaves
      // the circular pad (e.g. dragging outside the visual bounds) still
      // drives the stick until it's lifted. Without the window fallback,
      // iOS Safari sometimes stops sending pointermove once the pointer exits
      // the capturing element.
      stick.el.addEventListener('pointermove', move);
      window.addEventListener('pointermove', move);
      stick.el.addEventListener('pointerup', release);
      stick.el.addEventListener('pointercancel', release);
      window.addEventListener('pointerup', release);
      window.addEventListener('pointercancel', release);
    };
    bindStick(this.leftStick);
    bindStick(this.rightStick);

    const setSprint = (on: boolean) => {
      this.sprintTouched = on;
      sprintBtn.classList.toggle('active', on);
    };
    // Track the active pointer id so we can reliably clear sprint on release
    // even when the pointer event fires on window (iOS Safari sometimes loses
    // pointerup on a captured button after a fullscreen/orientation change).
    let sprintPointer: number | null = null;
    sprintBtn.addEventListener('pointerdown', (e) => {
      try {
        sprintBtn.setPointerCapture(e.pointerId);
      } catch {
        // iOS occasionally throws if the pointer is mid-capture by another
        // element; we still want sprint to engage via the window-level
        // pointerup fallback below.
      }
      sprintPointer = e.pointerId;
      setSprint(true);
      e.preventDefault();
    });
    const clearSprint = (e: PointerEvent) => {
      if (sprintPointer !== null && e.pointerId !== sprintPointer) return;
      sprintPointer = null;
      setSprint(false);
    };
    sprintBtn.addEventListener('pointerup', clearSprint);
    sprintBtn.addEventListener('pointercancel', clearSprint);
    // Fallback: iOS Safari in fullscreen / landscape sometimes routes pointerup
    // to window after a layout shift. Listen there too so sprint never gets
    // stuck in the "on" state.
    window.addEventListener('pointerup', clearSprint);
    window.addEventListener('pointercancel', clearSprint);
    // NOTE: we deliberately do NOT listen for `pointerleave`. With a light
    // finger drift (common on mobile) the pointer can briefly leave the
    // button bounds even while held — and `pointerleave` would flip sprint
    // off. Pointer capture should keep events flowing to the button, and
    // when it doesn't (iOS quirks), the window fallback above covers us.
  }

  /** Check if running on a touch-primary device and show touch controls accordingly. */
  static isTouchDevice(): boolean {
    return (
      'ontouchstart' in window || (navigator.maxTouchPoints !== undefined && navigator.maxTouchPoints > 0)
    );
  }

  /** Call once per frame. Returns accumulated mouse look delta (pixels) since last call. */
  sample(): { lookDX: number; lookDY: number } {
    // movement keys
    let mx = 0;
    let my = 0;
    if (this.keys.has('KeyW')) my += 1;
    if (this.keys.has('KeyS')) my -= 1;
    if (this.keys.has('KeyA')) mx -= 1;
    if (this.keys.has('KeyD')) mx += 1;

    // keyboard-only look: arrow keys yaw/pitch (also Q/E for yaw)
    let lx = 0;
    let ly = 0;
    if (this.keys.has('ArrowLeft') || this.keys.has('KeyQ')) lx -= 1;
    if (this.keys.has('ArrowRight') || this.keys.has('KeyE')) lx += 1;
    if (this.keys.has('ArrowUp')) ly -= 1;
    if (this.keys.has('ArrowDown')) ly += 1;

    // touch
    if (this.leftStick?.active) {
      mx = this.leftStick.dx;
      my = -this.leftStick.dy;
    }
    if (this.rightStick?.active) {
      // On touch, the look joystick is horizontal-only (yaw). Vertical pitch
      // from swiping up/down on the right pad felt disorienting and made it
      // easy to accidentally look at the floor; keep the axis deliberately
      // 1-D. Desktop arrow-up/down still pitches via the earlier keyboard
      // branch.
      lx = this.rightStick.dx;
      ly = 0;
    }

    // gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let padSprint = false;
    for (const pad of pads) {
      if (!pad) continue;
      const deadzone = 0.15;
      // A single Joy-Con shows up as one gamepad; a paired pair can be combined or appear as two
      // depending on driver. We just take whichever axes are non-zero.
      const ax0 = pad.axes[0] ?? 0;
      const ax1 = pad.axes[1] ?? 0;
      const ax2 = pad.axes[2] ?? 0;
      const ax3 = pad.axes[3] ?? 0;
      if (Math.abs(ax0) > deadzone || Math.abs(ax1) > deadzone) {
        mx = ax0;
        my = -ax1;
      }
      if (Math.abs(ax2) > deadzone || Math.abs(ax3) > deadzone) {
        lx = ax2;
        ly = ax3;
      }
      // triggers / shoulder buttons for sprint (standard mapping: 6=LT, 7=RT, 5=RB)
      const trig = (i: number) => pad.buttons[i]?.value ?? 0;
      if (trig(7) > 0.3 || trig(5) > 0.3 || trig(6) > 0.3 || pad.buttons[0]?.pressed) {
        padSprint = true;
      }
    }

    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }

    this.state.moveX = mx;
    this.state.moveY = my;
    this.state.lookX = lx;
    this.state.lookY = ly;
    this.state.sprint =
      this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.sprintTouched || padSprint;

    const lookDX = this.mouseDeltaX;
    const lookDY = this.mouseDeltaY;
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    return { lookDX, lookDY };
  }

  isPointerLocked() {
    return this.pointerLocked;
  }

  releasePointerLock() {
    if (this.pointerLocked) document.exitPointerLock();
  }
}
