/**
 * Procedural horror-game audio built on the Web Audio API.
 * No binary assets — everything synthesized from oscillators and noise buffers.
 */

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  // ambient
  private ambientGain: GainNode | null = null;
  private ambientNodes: AudioNode[] = [];

  // heartbeat loop
  private heartbeatTimer: number | null = null;

  private masterVolume = 0.7;

  /** Must be called from a user gesture (the difficulty-select click). */
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.masterVolume;
    this.master.connect(this.ctx.destination);
    this.noiseBuffer = this.makeNoiseBuffer(2);
  }

  /** User-adjustable master gain, 0..1. Safe to call before init(). */
  setMasterVolume(v: number) {
    this.masterVolume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.masterVolume;
  }

  private makeNoiseBuffer(seconds: number): AudioBuffer {
    const sampleRate = this.ctx!.sampleRate;
    const buf = this.ctx!.createBuffer(1, sampleRate * seconds, sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  resumeIfSuspended() {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  startAmbient() {
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    this.stopAmbient();
    this.ambientGain = this.ctx.createGain();
    this.ambientGain.gain.value = 0.07;
    this.ambientGain.connect(this.master);

    // low rumble drone
    const drone = this.ctx.createOscillator();
    drone.type = 'sawtooth';
    drone.frequency.value = 42;
    const droneFilter = this.ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 120;
    const droneGain = this.ctx.createGain();
    droneGain.gain.value = 0.25;
    drone.connect(droneFilter).connect(droneGain).connect(this.ambientGain);
    drone.start();

    // wind/hiss
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;
    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 600;
    noiseFilter.Q.value = 0.6;
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.value = 0.3;
    // slowly modulate the filter to make it feel alive
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 300;
    lfo.connect(lfoGain).connect(noiseFilter.frequency);
    noise.connect(noiseFilter).connect(noiseGain).connect(this.ambientGain);
    noise.start();
    lfo.start();

    this.ambientNodes = [drone, noise, lfo];
  }

  stopAmbient() {
    for (const n of this.ambientNodes) {
      try {
        (n as OscillatorNode).stop?.();
      } catch {
        /* noop */
      }
      n.disconnect();
    }
    this.ambientNodes = [];
    this.ambientGain?.disconnect();
    this.ambientGain = null;
  }

  /** Called continuously; adjusts heartbeat tempo and ambient intensity based on proximity (0..1, 1 = close). */
  setTension(t: number) {
    if (!this.ctx || !this.master) return;
    this.ensureHeartbeat(t);
  }

  private ensureHeartbeat(tension: number) {
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (tension <= 0.05 || !this.ctx) return;
    const minBpm = 60;
    const maxBpm = 160;
    const bpm = minBpm + (maxBpm - minBpm) * tension;
    const intervalMs = 60000 / bpm;
    const beat = () => this.playHeartbeat(0.25 + 0.9 * tension);
    beat();
    this.heartbeatTimer = window.setInterval(beat, intervalMs);
  }

  playHeartbeat(volume: number) {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    const makeThud = (t: number, vol: number) => {
      const osc = this.ctx!.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(95, t);
      osc.frequency.exponentialRampToValueAtTime(35, t + 0.18);
      const g = this.ctx!.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      osc.connect(g).connect(this.master!);
      osc.start(t);
      osc.stop(t + 0.25);
    };
    makeThud(now, volume);
    makeThud(now + 0.14, volume * 0.7);
  }

  /** Soft high chime when a soul is collected. */
  playPickup() {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      const base = [880, 1320, 1760][i];
      osc.frequency.setValueAtTime(base, now);
      osc.frequency.exponentialRampToValueAtTime(base * 1.5, now + 0.5);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.15, now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
      osc.connect(g).connect(this.master);
      osc.start(now);
      osc.stop(now + 0.65);
    }
  }

  /** Wet chomp + flesh crunch. Played periodically by the hunter. */
  playChomp(volumeScale = 1) {
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    // low thunk
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(55, now + 0.12);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.0001, now);
    og.gain.exponentialRampToValueAtTime(0.22 * volumeScale, now + 0.01);
    og.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
    osc.connect(og).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.16);

    // noise crunch
    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuffer;
    const nf = this.ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 1200;
    nf.Q.value = 1.5;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.0001, now);
    ng.gain.exponentialRampToValueAtTime(0.18 * volumeScale, now + 0.015);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    n.connect(nf).connect(ng).connect(this.master);
    n.start(now);
    n.stop(now + 0.14);
  }

  /** Raspy breathing — plays when hunter is very close. */
  playBreath(volumeScale = 1) {
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuffer;
    const nf = this.ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 350;
    nf.Q.value = 1.5;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.0001, now);
    ng.gain.linearRampToValueAtTime(0.2 * volumeScale, now + 0.25);
    ng.gain.linearRampToValueAtTime(0.0001, now + 0.9);
    n.connect(nf).connect(ng).connect(this.master);
    n.start(now);
    n.stop(now + 1.0);
  }

  /** Final scream / jumpscare when caught. */
  playScream() {
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 1.4);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.5, now + 0.05);
    g.gain.linearRampToValueAtTime(0.0001, now + 1.6);
    const dist = this.ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1024) * 2 - 1;
      curve[i] = Math.tanh(x * 5);
    }
    dist.curve = curve;
    osc.connect(dist).connect(g).connect(this.master);
    osc.start(now);
    osc.stop(now + 1.7);

    // noise burst
    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuffer;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.0001, now);
    ng.gain.linearRampToValueAtTime(0.35, now + 0.05);
    ng.gain.linearRampToValueAtTime(0.0001, now + 0.8);
    n.connect(ng).connect(this.master);
    n.start(now);
    n.stop(now + 0.85);
  }

  /** Triumphant exhale when you escape. */
  playWin() {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    for (let i = 0; i < 4; i++) {
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      const freq = [261.63, 329.63, 392.0, 523.25][i];
      osc.frequency.setValueAtTime(freq, now + i * 0.2);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, now + i * 0.2);
      g.gain.linearRampToValueAtTime(0.15, now + i * 0.2 + 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.2 + 1.0);
      osc.connect(g).connect(this.master);
      osc.start(now + i * 0.2);
      osc.stop(now + i * 0.2 + 1.05);
    }
  }

  /** Downward woosh + low drop tone when the player descends through the floor. */
  playDescent() {
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 1.2);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.0001, now);
    og.gain.linearRampToValueAtTime(0.22, now + 0.1);
    og.gain.exponentialRampToValueAtTime(0.0001, now + 1.3);
    osc.connect(og).connect(this.master);
    osc.start(now);
    osc.stop(now + 1.4);

    // rushing air
    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuffer;
    const nf = this.ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.setValueAtTime(2400, now);
    nf.frequency.exponentialRampToValueAtTime(300, now + 1.1);
    nf.Q.value = 0.8;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0, now);
    ng.gain.linearRampToValueAtTime(0.3, now + 0.15);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 1.3);
    n.connect(nf).connect(ng).connect(this.master);
    n.start(now);
    n.stop(now + 1.4);
  }

  /** Sharp glassy crack when a boss shard breaks (and when a shield absorbs a hit). */
  playShardBreak() {
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      const base = 2200 - i * 400;
      osc.frequency.setValueAtTime(base, now + i * 0.015);
      osc.frequency.exponentialRampToValueAtTime(base * 0.3, now + i * 0.015 + 0.18);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, now + i * 0.015);
      g.gain.exponentialRampToValueAtTime(0.25, now + i * 0.015 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.015 + 0.25);
      osc.connect(g).connect(this.master);
      osc.start(now + i * 0.015);
      osc.stop(now + i * 0.015 + 0.3);
    }
    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuffer;
    const nf = this.ctx.createBiquadFilter();
    nf.type = 'highpass';
    nf.frequency.value = 1800;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0, now);
    ng.gain.linearRampToValueAtTime(0.22, now + 0.01);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    n.connect(nf).connect(ng).connect(this.master);
    n.start(now);
    n.stop(now + 0.22);
  }

  /** Distant, impossibly heavy rumble — the "bigger hunter" approaching for the cliffhanger. */
  playDistantRumble(durationSec = 6) {
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(28, now);
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 110;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.4, now + durationSec * 0.7);
    g.gain.linearRampToValueAtTime(0.0001, now + durationSec);
    osc.connect(filt).connect(g).connect(this.master);
    osc.start(now);
    osc.stop(now + durationSec + 0.05);

    // slow heavy footstep thuds every ~1.2s, getting louder
    const steps = Math.max(1, Math.floor(durationSec / 1.1));
    for (let i = 0; i < steps; i++) {
      const t = now + 0.4 + i * 1.15;
      const s = this.ctx.createOscillator();
      s.type = 'sine';
      s.frequency.setValueAtTime(60, t);
      s.frequency.exponentialRampToValueAtTime(20, t + 0.35);
      const sg = this.ctx.createGain();
      const loud = 0.1 + (i / steps) * 0.5;
      sg.gain.setValueAtTime(0.0001, t);
      sg.gain.exponentialRampToValueAtTime(loud, t + 0.02);
      sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      s.connect(sg).connect(this.master);
      s.start(t);
      s.stop(t + 0.5);
    }
  }

  /** Pac-Man's soul ripping free — high warbling cry. */
  playSoulEscape() {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      const base = 740 + i * 180;
      osc.frequency.setValueAtTime(base, now);
      osc.frequency.exponentialRampToValueAtTime(base * 0.25, now + 2);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.22, now + 0.2);
      g.gain.linearRampToValueAtTime(0, now + 2.2);
      osc.connect(g).connect(this.master);
      osc.start(now);
      osc.stop(now + 2.3);
    }
  }

  stopAll() {
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.stopAmbient();
  }
}
