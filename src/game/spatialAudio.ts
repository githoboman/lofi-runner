import type { SceneId } from './types';

interface WorldBedNodes {
  masterGain: GainNode;
  noiseGain: GainNode;
  filter: BiquadFilterNode;
  droneOsc1: OscillatorNode;
  droneOsc2: OscillatorNode;
  droneGain: GainNode;
  lfoOsc: OscillatorNode;
  lfoGain: GainNode;
}

/**
 * Seamless Procedural Web Audio Spatial Ambient Manager for all 5 Yeti Home Worlds.
 * Loops distinct atmospheric sound beds with smooth 1.2s cross-fades across portals
 * and fires stereo-panned environmental cues (alpine wind & distant foghorn, lava geysers &
 * temple chains, dripping neon sewer bubbles, cyberpunk neon hum & VTOL drone flybys, astral chimes).
 */
export class SpatialWorldAudioManager {
  private ctx: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private globalGain: GainNode | null = null;
  private beds = new Map<SceneId, WorldBedNodes>();

  private enabled = true;
  private started = false;
  private currentWorld: SceneId = 'frost_sanctuary';
  private isPlaying = false;
  private speedRatio = 0;
  private playerX = 0;
  private cueTimer = 2.6;

  public setEnabled(flag: boolean): void {
    this.enabled = flag;
    if (this.ctx && this.globalGain) {
      const now = this.ctx.currentTime;
      const target = this.enabled ? (this.isPlaying ? 0.85 : 0.32) : 0.0001;
      this.globalGain.gain.cancelScheduledValues(now);
      this.globalGain.gain.setTargetAtTime(target, now, 0.14);
    }
  }

  public unlock(): void {
    if (!this.enabled) return;
    try {
      if (!this.ctx) {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return;
        this.ctx = new AudioCtx();
        this.initGraph();
      }
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
    } catch {
      // Ignore audio initialization failures in restricted environments
    }
  }

  private initGraph(): void {
    if (!this.ctx || this.started) return;
    this.started = true;
    const ctx = this.ctx;

    this.globalGain = ctx.createGain();
    this.globalGain.gain.value = this.enabled ? 0.32 : 0.0001;
    this.globalGain.connect(ctx.destination);

    // 4-second seamless pink-ish noise loop buffer for wind, lava rumble, sewer hum & city rain
    const length = ctx.sampleRate * 4;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.12;
    }
    // Cross-fade last 1024 samples into start for 100% click-free looping
    for (let i = 0; i < 1024; i++) {
      const t = i / 1024;
      data[length - 1024 + i] = data[length - 1024 + i] * (1 - t) + data[i] * t;
    }
    this.noiseBuffer = buffer;

    this.createWorldBed('frost_sanctuary', {
      filterType: 'bandpass',
      filterFreq: 680,
      filterQ: 1.4,
      noiseLevel: 0.14,
      droneFreq1: 110,
      droneFreq2: 164.81,
      droneType: 'sine',
      droneLevel: 0.025,
      lfoRate: 0.22,
      lfoDepth: 260,
    });

    this.createWorldBed('inferno_caldera', {
      filterType: 'lowpass',
      filterFreq: 190,
      filterQ: 1.2,
      noiseLevel: 0.24,
      droneFreq1: 55,
      droneFreq2: 82.41,
      droneType: 'sawtooth',
      droneLevel: 0.032,
      lfoRate: 0.35,
      lfoDepth: 65,
    });

    this.createWorldBed('slime_catacombs', {
      filterType: 'bandpass',
      filterFreq: 310,
      filterQ: 2.6,
      noiseLevel: 0.13,
      droneFreq1: 73.42,
      droneFreq2: 110.0,
      droneType: 'triangle',
      droneLevel: 0.035,
      lfoRate: 0.42,
      lfoDepth: 95,
    });

    this.createWorldBed('cyber_foundry', {
      filterType: 'bandpass',
      filterFreq: 420,
      filterQ: 1.1,
      noiseLevel: 0.11,
      droneFreq1: 60.0,
      droneFreq2: 120.0,
      droneType: 'sawtooth',
      droneLevel: 0.03,
      lfoRate: 0.5,
      lfoDepth: 110,
    });

    this.createWorldBed('void_gallery', {
      filterType: 'lowpass',
      filterFreq: 480,
      filterQ: 0.8,
      noiseLevel: 0.08,
      droneFreq1: 130.81,
      droneFreq2: 196.0,
      droneType: 'sine',
      droneLevel: 0.048,
      lfoRate: 0.18,
      lfoDepth: 120,
    });

    this.applyWorldCrossfade(this.currentWorld, 0.25);
  }

  private createWorldBed(
    sceneId: SceneId,
    cfg: {
      filterType: BiquadFilterType;
      filterFreq: number;
      filterQ: number;
      noiseLevel: number;
      droneFreq1: number;
      droneFreq2: number;
      droneType: OscillatorType;
      droneLevel: number;
      lfoRate: number;
      lfoDepth: number;
    },
  ): void {
    if (!this.ctx || !this.globalGain || !this.noiseBuffer) return;
    const ctx = this.ctx;

    const masterGain = ctx.createGain();
    masterGain.gain.value = 0.0001;
    masterGain.connect(this.globalGain);

    // Looping noise source -> shaped filter -> noiseGain
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = this.noiseBuffer;
    noiseSrc.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = cfg.filterType;
    filter.frequency.value = cfg.filterFreq;
    filter.Q.value = cfg.filterQ;

    const noiseGain = ctx.createGain();
    noiseGain.gain.value = cfg.noiseLevel;

    noiseSrc.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(masterGain);
    noiseSrc.start();

    // LFO gently modulating the ambient filter for organic breathing/wind/hum
    const lfoOsc = ctx.createOscillator();
    lfoOsc.type = 'sine';
    lfoOsc.frequency.value = cfg.lfoRate;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = cfg.lfoDepth;
    lfoOsc.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfoOsc.start();

    // Soft dual-oscillator tonal bed through lowpass warmth filter
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 340;

    const droneGain = ctx.createGain();
    droneGain.gain.value = cfg.droneLevel;

    const droneOsc1 = ctx.createOscillator();
    droneOsc1.type = cfg.droneType;
    droneOsc1.frequency.value = cfg.droneFreq1;

    const droneOsc2 = ctx.createOscillator();
    droneOsc2.type = 'sine';
    droneOsc2.frequency.value = cfg.droneFreq2;

    droneOsc1.connect(droneFilter);
    droneOsc2.connect(droneFilter);
    droneFilter.connect(droneGain);
    droneGain.connect(masterGain);
    droneOsc1.start();
    droneOsc2.start();

    this.beds.set(sceneId, {
      masterGain,
      noiseGain,
      filter,
      droneOsc1,
      droneOsc2,
      droneGain,
      lfoOsc,
      lfoGain,
    });
  }

  public setWorld(sceneId: SceneId): void {
    this.currentWorld = sceneId;
    this.cueTimer = 1.6;
    if (this.ctx && this.started) {
      this.applyWorldCrossfade(sceneId, 1.15);
    }
  }

  private applyWorldCrossfade(activeWorld: SceneId, fadeSeconds: number): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.beds.forEach((bed, id) => {
      bed.masterGain.gain.cancelScheduledValues(now);
      const target = id === activeWorld ? 1.0 : 0.0001;
      bed.masterGain.gain.setTargetAtTime(target, now, fadeSeconds * 0.35);
    });
  }

  public setActivity(playing: boolean, speedRatio: number, playerX: number): void {
    this.isPlaying = playing;
    this.speedRatio = speedRatio;
    this.playerX = playerX;

    if (this.ctx && this.globalGain) {
      const now = this.ctx.currentTime;
      const target = !this.enabled ? 0.0001 : playing ? 0.72 + speedRatio * 0.22 : 0.24;
      this.globalGain.gain.setTargetAtTime(target, now, 0.22);
    }
  }

  public update(dt: number): void {
    if (!this.enabled || !this.ctx || !this.started || !this.isPlaying) return;
    if (this.ctx.state !== 'running') return;

    this.cueTimer -= dt;
    if (this.cueTimer <= 0) {
      this.triggerSpatialWorldCue(this.currentWorld);
      this.cueTimer = 3.2 + Math.random() * 3.8 - this.speedRatio * 0.75;
    }
  }

  /**
   * Fires a stereo-panned spatial environmental cue unique to the active world!
   */
  private triggerSpatialWorldCue(sceneId: SceneId): void {
    if (!this.ctx || !this.globalGain || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const randomSide = Math.random() > 0.5 ? 1 : -1;
    // Offset pan slightly by player's current lane so world feels grounded in 3D space
    const basePan = Math.max(-0.92, Math.min(0.92, randomSide * (0.45 + Math.random() * 0.42) - this.playerX * 0.06));

    const hasStereoPanner = typeof ctx.createStereoPanner === 'function';
    const panner = hasStereoPanner ? ctx.createStereoPanner() : null;
    const outputNode: AudioNode = panner ?? this.globalGain;
    if (panner) {
      panner.pan.setValueAtTime(basePan, now);
      panner.connect(this.globalGain);
    }

    if (sceneId === 'frost_sanctuary') {
      // Distant alpine glacier / harbor foghorn OR crystalline ice-wind shimmer
      if (Math.random() > 0.42) {
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const filt = ctx.createBiquadFilter();
        const gain = ctx.createGain();
        osc1.type = 'sawtooth';
        osc2.type = 'triangle';
        osc1.frequency.setValueAtTime(92.5, now);
        osc1.frequency.linearRampToValueAtTime(87.3, now + 1.8);
        osc2.frequency.setValueAtTime(138.6, now);
        osc2.frequency.linearRampToValueAtTime(130.8, now + 1.8);
        filt.type = 'lowpass';
        filt.frequency.value = 260;

        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(0.065, now + 0.35);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.9);

        osc1.connect(filt);
        osc2.connect(filt);
        filt.connect(gain);
        gain.connect(outputNode);
        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 1.95);
        osc2.stop(now + 1.95);
      } else {
        // Sweeping wind gust panning across stereo field
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        const filt = ctx.createBiquadFilter();
        filt.type = 'bandpass';
        filt.frequency.setValueAtTime(520, now);
        filt.frequency.exponentialRampToValueAtTime(1450, now + 0.7);
        filt.frequency.exponentialRampToValueAtTime(420, now + 1.5);
        filt.Q.value = 3.2;

        if (panner) {
          panner.pan.setValueAtTime(-randomSide * 0.85, now);
          panner.pan.linearRampToValueAtTime(randomSide * 0.85, now + 1.5);
        }

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(0.11, now + 0.55);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.55);

        src.connect(filt);
        filt.connect(gain);
        gain.connect(outputNode);
        src.start(now);
        src.stop(now + 1.6);
      }
    } else if (sceneId === 'inferno_caldera') {
      // Erupting magma geyser hiss + heavy volcanic chain clank
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const filt = ctx.createBiquadFilter();
      filt.type = 'bandpass';
      filt.frequency.setValueAtTime(240, now);
      filt.frequency.exponentialRampToValueAtTime(860, now + 0.45);
      filt.frequency.exponentialRampToValueAtTime(180, now + 1.15);
      filt.Q.value = 1.6;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.15, now + 0.25);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);

      src.connect(filt);
      filt.connect(gain);
      gain.connect(outputNode);
      src.start(now);
      src.stop(now + 1.25);

      // Metallic chain clink overtone
      const clank = ctx.createOscillator();
      const clankGain = ctx.createGain();
      clank.type = 'square';
      clank.frequency.setValueAtTime(320 + Math.random() * 140, now + 0.12);
      clank.frequency.exponentialRampToValueAtTime(140, now + 0.34);
      clankGain.gain.setValueAtTime(0.0001, now + 0.12);
      clankGain.gain.linearRampToValueAtTime(0.028, now + 0.14);
      clankGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);
      clank.connect(clankGain);
      clankGain.connect(outputNode);
      clank.start(now + 0.12);
      clank.stop(now + 0.4);
    } else if (sceneId === 'slime_catacombs') {
      // Resonant neon sewer pipe drip + bubbling acid blips
      for (let i = 0; i < 3; i++) {
        const t = now + i * (0.14 + Math.random() * 0.08);
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        const f0 = 260 + Math.random() * 240;
        osc.frequency.setValueAtTime(f0, t);
        osc.frequency.exponentialRampToValueAtTime(f0 * 2.1, t + 0.11);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.linearRampToValueAtTime(0.055, t + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
        osc.connect(gain);
        gain.connect(outputNode);
        osc.start(t);
        osc.stop(t + 0.16);
      }
    } else if (sceneId === 'cyber_foundry') {
      // High-tech VTOL Cyber Drone Doppler flyby panning across stereo field!
      const osc = ctx.createOscillator();
      const sub = ctx.createOscillator();
      const filt = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      sub.type = 'triangle';
      osc.frequency.setValueAtTime(340, now);
      osc.frequency.exponentialRampToValueAtTime(155, now + 0.95);
      sub.frequency.setValueAtTime(170, now);
      sub.frequency.exponentialRampToValueAtTime(84, now + 0.95);

      filt.type = 'bandpass';
      filt.frequency.setValueAtTime(980, now);
      filt.frequency.exponentialRampToValueAtTime(320, now + 0.95);
      filt.Q.value = 2.0;

      if (panner) {
        panner.pan.setValueAtTime(-randomSide * 0.92, now);
        panner.pan.linearRampToValueAtTime(randomSide * 0.92, now + 0.95);
      }

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.068, now + 0.32);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.98);

      osc.connect(filt);
      sub.connect(filt);
      filt.connect(gain);
      gain.connect(outputNode);
      osc.start(now);
      sub.start(now);
      osc.stop(now + 1.02);
      sub.stop(now + 1.02);
    } else {
      // void_gallery: Ethereal stereo-panned astral harmonic bell shimmer
      const notes = [523.25, 659.25, 783.99, 987.77];
      const f = notes[Math.floor(Math.random() * notes.length)];
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now);
      osc.frequency.linearRampToValueAtTime(f * 1.015, now + 1.3);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.042, now + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.35);
      osc.connect(gain);
      gain.connect(outputNode);
      osc.start(now);
      osc.stop(now + 1.4);
    }
  }

  public dispose(): void {
    this.beds.forEach((bed) => {
      try {
        bed.droneOsc1.stop();
        bed.droneOsc2.stop();
        bed.lfoOsc.stop();
      } catch {
        // Already stopped
      }
    });
    this.beds.clear();
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
    this.started = false;
  }
}
