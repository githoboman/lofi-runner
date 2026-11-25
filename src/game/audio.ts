import { AUDIO_CONFIG } from './config';
import type { SoundKey } from './types';

/**
 * Placeholder Web Audio synth sound manager.
 * File paths live in AUDIO_CONFIG so recorded SFX can replace synth tones seamlessly.
 */
export class SoundManager {
  private ctx: AudioContext | null = null;
  private enabled = true;
  private coinStreak = 0;
  private lastCoinTime = 0;

  public readonly config = AUDIO_CONFIG;

  public setEnabled(flag: boolean): void {
    this.enabled = flag;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  private ensureContext(): AudioContext | null {
    if (!this.enabled) return null;
    try {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return null;
        this.ctx = new AudioCtx();
      }
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return this.ctx;
    } catch {
      return null;
    }
  }

  public play(key: SoundKey): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const vol = AUDIO_CONFIG[key]?.volume ?? 0.4;
    const now = ctx.currentTime;

    switch (key) {
      case 'jump':
        this.tone(ctx, 'triangle', 220, 520, now, 0.14, vol * 0.55);
        break;

      case 'flip':
        this.tone(ctx, 'sine', 360, 780, now, 0.16, vol * 0.5);
        this.tone(ctx, 'triangle', 540, 960, now + 0.06, 0.14, vol * 0.38);
        break;

      case 'spin':
        this.tone(ctx, 'sine', 420, 680, now, 0.1, vol * 0.38);
        this.tone(ctx, 'sine', 680, 480, now + 0.09, 0.1, vol * 0.28);
        break;

      case 'land':
        this.tone(ctx, 'sine', 130, 58, now, 0.09, vol * 0.5);
        break;

      case 'coin': {
        const t = performance.now();
        if (t - this.lastCoinTime < 650) {
          this.coinStreak = Math.min(this.coinStreak + 1, 10);
        } else {
          this.coinStreak = 0;
        }
        this.lastCoinTime = t;
        const base = 740 * Math.pow(1.045, this.coinStreak);
        this.tone(ctx, 'sine', base, base * 1.25, now, 0.075, vol * 0.45);
        this.tone(ctx, 'triangle', base * 1.5, base * 1.55, now + 0.045, 0.09, vol * 0.3);
        break;
      }

      case 'sword':
        this.noiseBurst(ctx, now, 0.13, vol * 0.45, 1600);
        this.tone(ctx, 'sawtooth', 760, 210, now, 0.15, vol * 0.35);
        break;

      case 'star':
        [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
          this.tone(ctx, 'triangle', freq, freq * 1.02, now + i * 0.065, 0.2, vol * 0.4);
        });
        break;

      case 'hit':
        this.noiseBurst(ctx, now, 0.18, vol * 0.65, 420);
        this.tone(ctx, 'sawtooth', 165, 52, now, 0.22, vol * 0.55);
        break;

      case 'gameOver':
        [349.23, 311.13, 277.18, 220.0].forEach((freq, i) => {
          this.tone(ctx, 'sawtooth', freq, freq * 0.94, now + i * 0.14, 0.24, vol * 0.35);
        });
        break;

      case 'sceneSwitch':
        this.tone(ctx, 'sine', 330, 660, now, 0.28, vol * 0.35);
        this.tone(ctx, 'triangle', 495, 990, now + 0.09, 0.3, vol * 0.28);
        break;

      case 'uiClick':
        this.tone(ctx, 'sine', 560, 690, now, 0.055, vol * 0.35);
        break;

      case 'sliceImpact':
        // Crisp plasma cut shimmer + wood/crate split crack + low punch
        this.noiseBurst(ctx, now, 0.09, vol * 0.65, 2400);
        this.tone(ctx, 'sawtooth', 980, 260, now, 0.11, vol * 0.38);
        this.noiseBurst(ctx, now + 0.03, 0.14, vol * 0.55, 650);
        this.tone(ctx, 'triangle', 190, 64, now + 0.02, 0.14, vol * 0.5);
        break;

      case 'flyStunt':
        this.tone(ctx, 'sine', 440, 880, now, 0.18, vol * 0.42);
        this.tone(ctx, 'triangle', 660, 1320, now + 0.05, 0.2, vol * 0.32);
        break;

      case 'villainSurge':
        // Deep cyber-horn warning growl + electric baton crackle
        this.tone(ctx, 'sawtooth', 120, 74, now, 0.32, vol * 0.48);
        this.tone(ctx, 'square', 180, 110, now + 0.04, 0.26, vol * 0.26);
        this.noiseBurst(ctx, now + 0.06, 0.16, vol * 0.42, 1900);
        break;

      case 'portalWarp':
        // Dimensional vortex whoosh + shimmering harmonic chord + arrival bass thump
        this.noiseBurst(ctx, now, 0.34, vol * 0.55, 1400);
        this.tone(ctx, 'sine', 220, 880, now, 0.32, vol * 0.45);
        this.tone(ctx, 'triangle', 330, 1320, now + 0.05, 0.35, vol * 0.36);
        this.tone(ctx, 'sine', 130, 52, now + 0.04, 0.26, vol * 0.58);
        break;
    }
  }

  private tone(
    ctx: AudioContext,
    type: OscillatorType,
    freqStart: number,
    freqEnd: number,
    startTime: number,
    duration: number,
    peakGain: number,
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, startTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), startTime + duration);

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
  }

  private noiseBurst(
    ctx: AudioContext,
    startTime: number,
    duration: number,
    peakGain: number,
    filterFreq: number,
  ): void {
    const sampleRate = ctx.sampleRate;
    const frameCount = Math.max(1, Math.floor(sampleRate * duration));
    const buffer = ctx.createBuffer(1, frameCount, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frameCount; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(filterFreq, startTime);
    filter.Q.setValueAtTime(1.1, startTime);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(peakGain, startTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start(startTime);
  }

  public dispose(): void {
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
