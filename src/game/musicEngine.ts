import { SCENE_MUSIC_BEATS } from './config';
import type { MusicBeatId, SceneId } from './types';

type ResolvedBeatId = Exclude<MusicBeatId, 'auto'>;

export type MusicMood = 'menu' | 'playing' | 'paused' | 'replay' | 'gameover';

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function makeWarmSaturationCurve(drive: number): Float32Array<ArrayBuffer> {
  const samples = 512;
  const curve = new Float32Array(new ArrayBuffer(samples * 4));
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
  }
  return curve;
}

const BEAT_BPM: Record<ResolvedBeatId, number> = {
  lofi_boombap: 92,
  phonk_trap: 134,
  afro_amapiano: 114,
  cyber_synthwave: 124,
  liquid_dnb: 166,
};

// Swung 16th feel per genre (0 = straight, 0.16 = soulful J Dilla boom-bap swing)
const BEAT_SWING: Record<ResolvedBeatId, number> = {
  lofi_boombap: 0.17,
  phonk_trap: 0.02,
  afro_amapiano: 0.08,
  cyber_synthwave: 0.0,
  liquid_dnb: 0.05,
};

/**
 * Studio-grade Look-Ahead Procedural Instrumental Beat Engine.
 * Synthesizes 5 authentic real-world instrumental beats (Lofi Boom-Bap, Memphis Phonk 808 Trap,
 * Afrobeats / Amapiano Log-Drum, Cyber Synthwave, and Liquid Drum & Bass) with sidechain ducking,
 * soft-clip saturation, stereo echo, and dynamic gameplay reactivity (menu warmth, speed BPM lift,
 * Star Flight sparkle, and slow-mo replay filter sweeps).
 */
export class MusicBeatEngine {
  private ctx: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private satCurve808: Float32Array<ArrayBuffer> | null = null;
  private satCurveLog: Float32Array<ArrayBuffer> | null = null;

  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private musicFilter: BiquadFilterNode | null = null;
  private beatBus: GainNode | null = null;
  private sidechainGain: GainNode | null = null;
  private delaySend: GainNode | null = null;
  private delayNode: DelayNode | null = null;
  private delayFeedback: GainNode | null = null;

  private enabled = true;
  private selectedBeat: MusicBeatId = 'auto';
  private worldId: SceneId = 'frost_sanctuary';
  private activeBeat: ResolvedBeatId = 'lofi_boombap';

  private mood: MusicMood = 'menu';
  private speedRatio = 0;
  private starActive = false;
  private replaySlowMo = false;
  private tabHidden = false;
  private lastTargetGain = -1;
  private lastTargetCutoff = -1;

  private schedulerTimer: number | null = null;
  private nextStepTime = 0;
  private stepIndex = 0; // 0..63 (4 bars of 16th notes)
  private disposed = false;

  constructor() {
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  private handleVisibilityChange = (): void => {
    this.tabHidden = document.hidden;
    if (!this.ctx || !this.masterGain) return;
    if (this.tabHidden) {
      this.applyMixState(true);
      if (this.ctx.state === 'running') {
        void this.ctx.suspend();
      }
    } else if (this.enabled) {
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      this.nextStepTime = Math.max(this.nextStepTime, this.ctx.currentTime + 0.06);
      this.applyMixState(false);
    }
  };

  public setEnabled(flag: boolean): void {
    this.enabled = flag;
    if (flag) {
      this.unlock();
    }
    this.applyMixState(false);
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setBeatSelection(beat: MusicBeatId): void {
    this.selectedBeat = beat;
    const nextResolved = this.resolveBeat();
    if (nextResolved !== this.activeBeat) {
      this.activeBeat = nextResolved;
      this.stepIndex = 0;
      this.syncDelayTime();
    }
  }

  public setWorld(sceneId: SceneId): void {
    this.worldId = sceneId;
    const nextResolved = this.resolveBeat();
    if (nextResolved !== this.activeBeat) {
      this.activeBeat = nextResolved;
      // Align transition to start of next bar so portal warps feel musically tight
      this.stepIndex = Math.floor(this.stepIndex / 16) * 16;
      this.syncDelayTime();
    }
  }

  public setState(
    mood: MusicMood,
    speedRatio = 0,
    starActive = false,
    replaySlowMo = false,
  ): void {
    this.mood = mood;
    this.speedRatio = Math.max(0, Math.min(1.2, speedRatio));
    this.starActive = starActive;
    this.replaySlowMo = replaySlowMo;
    this.applyMixState(false);
  }

  public unlock(): void {
    if (this.disposed || !this.enabled || this.tabHidden) return;
    try {
      if (!this.ctx) {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return;
        this.ctx = new AudioCtx();
        this.initAudioGraph();
      }
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      if (this.schedulerTimer === null) {
        this.nextStepTime = this.ctx.currentTime + 0.06;
        this.schedulerTimer = window.setInterval(this.schedulerTick, 25);
      }
      this.applyMixState(false);
    } catch {
      // Ignore restricted autoplay contexts until user interacts
    }
  }

  private resolveBeat(): ResolvedBeatId {
    if (this.selectedBeat !== 'auto') return this.selectedBeat;
    return SCENE_MUSIC_BEATS[this.worldId];
  }

  private initAudioGraph(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;

    this.satCurve808 = makeWarmSaturationCurve(2.6);
    this.satCurveLog = makeWarmSaturationCurve(1.9);

    // 2-second crisp white noise buffer for snares, claps, hats, shakers, vinyl dust
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buf;

    // Master chain: beatBus & sidechainGain -> musicFilter -> compressor -> masterGain -> destination
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0.0001;
    this.masterGain.connect(ctx.destination);

    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -14;
    this.compressor.knee.value = 18;
    this.compressor.ratio.value = 4.5;
    this.compressor.attack.value = 0.004;
    this.compressor.release.value = 0.16;
    this.compressor.connect(this.masterGain);

    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 2600;
    this.musicFilter.Q.value = 0.75;
    this.musicFilter.connect(this.compressor);

    this.beatBus = ctx.createGain();
    this.beatBus.gain.value = 1.0;
    this.beatBus.connect(this.musicFilter);

    this.sidechainGain = ctx.createGain();
    this.sidechainGain.gain.value = 1.0;
    this.sidechainGain.connect(this.musicFilter);

    // Tempo-synced warm dub/lo-fi stereo echo bus
    this.delaySend = ctx.createGain();
    this.delaySend.gain.value = 0.24;

    this.delayNode = ctx.createDelay(1.0);
    this.delayNode.delayTime.value = 0.32;

    const delayTone = ctx.createBiquadFilter();
    delayTone.type = 'lowpass';
    delayTone.frequency.value = 2400;

    this.delayFeedback = ctx.createGain();
    this.delayFeedback.gain.value = 0.28;

    this.delaySend.connect(this.delayNode);
    this.delayNode.connect(delayTone);
    delayTone.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delayNode);
    delayTone.connect(this.sidechainGain);

    this.activeBeat = this.resolveBeat();
    this.syncDelayTime();
  }

  private syncDelayTime(): void {
    if (!this.ctx || !this.delayNode) return;
    const bpm = BEAT_BPM[this.activeBeat];
    // Dotted-eighth echo time (musical bounce across all 5 genres)
    const dottedEighth = (60 / bpm) * 0.75;
    this.delayNode.delayTime.setTargetAtTime(
      Math.max(0.12, Math.min(0.65, dottedEighth)),
      this.ctx.currentTime,
      0.15,
    );
  }

  private applyMixState(immediate: boolean): void {
    if (!this.ctx || !this.masterGain || !this.musicFilter) return;
    const now = this.ctx.currentTime;
    const tc = immediate ? 0.02 : 0.14;

    let targetGain = 0.0001;
    let targetCutoff = 16000;

    if (this.enabled && !this.tabHidden) {
      switch (this.mood) {
        case 'playing':
          targetGain = this.starActive ? 0.44 : 0.40;
          targetCutoff = 18000;
          break;
        case 'replay':
          targetGain = 0.36;
          targetCutoff = 16000;
          break;
        case 'paused':
          targetGain = 0.16;
          targetCutoff = 620;
          break;
        case 'gameover':
          targetGain = 0.20;
          targetCutoff = 1100;
          break;
        case 'menu':
        default:
          targetGain = 0.24;
          targetCutoff = 2600;
          break;
      }
    }

    if (
      !immediate &&
      Math.abs(targetGain - this.lastTargetGain) < 0.001 &&
      Math.abs(targetCutoff - this.lastTargetCutoff) < 1
    ) {
      return;
    }

    this.lastTargetGain = targetGain;
    this.lastTargetCutoff = targetCutoff;

    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setTargetAtTime(targetGain, now, tc);

    this.musicFilter.frequency.cancelScheduledValues(now);
    this.musicFilter.frequency.setTargetAtTime(targetCutoff, now, tc * 1.15);
  }

  private getCurrentStepDuration(): number {
    const baseBpm = BEAT_BPM[this.activeBeat];
    // Subtle tempo energy lift as runner accelerates
    let tempoMult = 1.0;
    if (this.mood === 'playing') {
      tempoMult = 1.0 + this.speedRatio * 0.065;
    }
    const effectiveBpm = baseBpm * tempoMult;
    return 60 / effectiveBpm / 4; // 16th-note duration in seconds
  }

  private schedulerTick = (): void => {
    if (this.disposed || !this.ctx || !this.enabled || this.tabHidden) return;
    if (this.ctx.state !== 'running') return;

    const lookAhead = 0.12;
    const now = this.ctx.currentTime;

    // Catch up cleanly if the browser throttled timers while backgrounded
    if (this.nextStepTime < now - 0.15) {
      this.nextStepTime = now + 0.05;
    }

    while (this.nextStepTime < now + lookAhead) {
      const stepDur = this.getCurrentStepDuration();
      const swing = BEAT_SWING[this.activeBeat];
      const swingOffset = this.stepIndex % 2 === 1 ? stepDur * swing : 0;
      const playTime = this.nextStepTime + swingOffset;

      this.scheduleStep(this.activeBeat, this.stepIndex, playTime, stepDur);

      this.nextStepTime += stepDur;
      this.stepIndex = (this.stepIndex + 1) % 64;
    }
  };

  private scheduleStep(beat: ResolvedBeatId, step: number, time: number, stepDur: number): void {
    switch (beat) {
      case 'lofi_boombap':
        this.scheduleLofiBoomBap(step, time, stepDur);
        break;
      case 'phonk_trap':
        this.schedulePhonkTrap(step, time, stepDur);
        break;
      case 'afro_amapiano':
        this.scheduleAfroAmapiano(step, time, stepDur);
        break;
      case 'cyber_synthwave':
        this.scheduleCyberSynthwave(step, time, stepDur);
        break;
      case 'liquid_dnb':
        this.scheduleLiquidDnb(step, time, stepDur);
        break;
    }
  }

  // =========================================================================
  // 1. LOFI BOOM-BAP (Frost Sanctuary — 92 BPM, swung 90s Hip-Hop + Rhodes)
  // =========================================================================
  private scheduleLofiBoomBap(step: number, t: number, stepDur: number): void {
    const bar = Math.floor(step / 16);
    const s = step % 16;

    // Classic swung boom-bap kick pocket
    if (s === 0 || s === 9 || s === 10 || (bar === 3 && s === 14)) {
      const vel = s === 9 ? 0.62 : 0.92;
      this.playKick(t, { pitchStart: 132, pitchEnd: 46, decay: 0.21, gain: 0.85 * vel, duck: 0.45 * vel });
    }

    // Crisp dusty snare on 2 & 4 + subtle ghost snare
    if (s === 4 || s === 12) {
      this.playSnare(t, { toneFreq: 192, noiseFreq: 2100, decay: 0.16, gain: 0.56 });
    } else if (s === 15 && (bar === 1 || bar === 3)) {
      this.playSnare(t, { toneFreq: 175, noiseFreq: 1700, decay: 0.08, gain: 0.2 });
    }

    // Dusty swung hi-hats
    if (s % 2 === 0) {
      const accent = s % 4 === 0 ? 0.26 : 0.16;
      this.playHat(t, { open: s === 14 && bar % 2 === 1, gain: accent, hpFreq: 6800 });
    } else if (s === 7 || s === 15) {
      this.playHat(t, { open: false, gain: 0.1, hpFreq: 7400 });
    }

    // Lush jazzy Rhodes chord progression: Dm9 -> G13 -> Cmaj9 -> A7alt
    if (s === 0) {
      const chords: number[][] = [
        [50, 57, 60, 64, 67], // Dm9
        [43, 53, 59, 64, 67], // G13
        [48, 55, 59, 62, 67], // Cmaj9
        [45, 55, 61, 65, 68], // A7b13
      ];
      this.playRhodesChord(t, chords[bar], stepDur * 14.5, 0.22);
    } else if (s === 10 && bar % 2 === 1) {
      // Soulful upbeat chord stab
      const stab = bar === 1 ? [53, 59, 64] : [55, 61, 65];
      this.playRhodesChord(t, stab, stepDur * 4.5, 0.13);
    }

    // Warm deep sub-bass walking groove
    const bassRoots = [38, 43, 36, 45]; // D2, G2, C2, A2
    const bassWalk = [45, 47, 43, 40];
    if (s === 0) {
      this.play808(t, midiToFreq(bassRoots[bar]), stepDur * 8.5, 0.42, false);
    } else if (s === 10) {
      this.play808(t, midiToFreq(bassWalk[bar]), stepDur * 5.2, 0.34, false);
    }

    // Subtle Star Flight top chime melody
    if (this.starActive && (s === 2 || s === 6 || s === 11)) {
      const notes = [74, 76, 79, 81];
      this.playPluck(t, midiToFreq(notes[(bar + s) % notes.length]), 0.24, 0.12);
    }

    // Subtle warm vinyl dust pop
    if (Math.random() < 0.16) {
      this.playVinylPop(t + Math.random() * stepDur * 0.6);
    }
  }

  // =========================================================================
  // 2. MEMPHIS PHONK / 808 TRAP (Inferno Caldera — 134 BPM, half-time slap)
  // =========================================================================
  private schedulePhonkTrap(step: number, t: number, stepDur: number): void {
    const bar = Math.floor(step / 16);
    const s = step % 16;

    // Hard half-time trap kick pattern
    if (s === 0 || s === 6 || s === 10 || (bar === 3 && s === 14)) {
      this.playKick(t, { pitchStart: 165, pitchEnd: 42, decay: 0.22, gain: 0.95, duck: 0.52 });
    }

    // Layered Phonk clap + crisp snare on beat 3 (step 8)
    if (s === 8) {
      this.playClap(t, 0.56);
      this.playSnare(t, { toneFreq: 215, noiseFreq: 3100, decay: 0.15, gain: 0.46 });
    } else if (bar === 3 && (s === 13 || s === 15)) {
      // Bar-4 snare roll fill
      this.playSnare(t, { toneFreq: 225, noiseFreq: 3200, decay: 0.1, gain: 0.32 });
    }

    // Crisp 808 hi-hats with rapid 32nd-note trap rolls!
    if (s % 2 === 0) {
      this.playHat(t, { open: s === 14, gain: s === 14 ? 0.25 : 0.21, hpFreq: 8200 });
    }
    if ((bar === 0 && s === 11) || (bar === 1 && s === 5) || (bar === 2 && s === 13) || (bar === 3 && s === 11)) {
      // 3-hit rapid trap hi-hat roll
      this.playHat(t, { open: false, gain: 0.2, hpFreq: 8600 });
      this.playHat(t + stepDur * 0.33, { open: false, gain: 0.18, hpFreq: 9000 });
      this.playHat(t + stepDur * 0.66, { open: false, gain: 0.16, hpFreq: 9400 });
    }

    // Saturated 808 sub-bass with authentic trap pitch slides (E Phrygian)
    const bassSeq: Record<number, { midi: number; slideTo?: number; dur: number }> = {
      0: { midi: 28, dur: 5.5 }, // E1
      6: { midi: 28, slideTo: 31, dur: 3.8 }, // E1 -> G1 slide
      10: { midi: bar % 2 === 0 ? 29 : 31, dur: 5.2 }, // F1 or G1
    };
    if (bar === 3 && s === 14) {
      this.play808(t, midiToFreq(35), stepDur * 2.2, 0.56, true, midiToFreq(28));
    } else if (bassSeq[s]) {
      const b = bassSeq[s];
      this.play808(
        t,
        midiToFreq(b.midi),
        stepDur * b.dur,
        0.58,
        true,
        b.slideTo ? midiToFreq(b.slideTo) : undefined,
      );
    }

    // Iconic Memphis Phonk 808 Cowbell Riff (E Phrygian minor hook!)
    const cowbellBarA: (number | null)[] = [
      76, null, 76, null, 79, null, 77, null, 76, null, 74, null, 71, null, 72, null,
    ];
    const cowbellBarB: (number | null)[] = [
      76, null, 79, null, 81, null, 79, null, 77, null, 76, 74, 71, null, 74, null,
    ];
    const cbNote = (bar % 2 === 0 ? cowbellBarA : cowbellBarB)[s];
    if (cbNote !== null && (this.mood === 'playing' || this.mood === 'replay' || s % 4 === 0)) {
      const vel = this.mood === 'playing' ? 0.25 : 0.14;
      this.playCowbell(t, midiToFreq(cbNote), vel);
    }

    // Dark brassy trap stab on downbeat of bar 1 & bar 3
    if (s === 0 && bar % 2 === 0) {
      this.playSynthStab(t, [40, 47, 52, 55], stepDur * 6.0, 0.14, 1400);
    }
  }

  // =========================================================================
  // 3. AFROBEATS / AMAPIANO LOG-DRUM (Slime Catacombs — 114 BPM bounce)
  // =========================================================================
  private scheduleAfroAmapiano(step: number, t: number, stepDur: number): void {
    const bar = Math.floor(step / 16);
    const s = step % 16;

    // Warm Amapiano four-on-the-floor kick + syncopated bar-4 lift
    if (s === 0 || s === 4 || s === 8 || s === 12 || (bar === 3 && s === 14)) {
      this.playKick(t, { pitchStart: 138, pitchEnd: 48, decay: 0.19, gain: 0.84, duck: 0.42 });
    }

    // Classic West African Afrobeats 3-3-2 rimshot/clave pattern
    if (s === 3 || s === 6 || s === 10 || s === 14) {
      const accent = s === 3 || s === 10 ? 0.44 : 0.3;
      this.playRim(t, accent);
    }

    // Continuous hypnotic 16th-note Amapiano shaker groove
    const shakerAccents = [0.22, 0.08, 0.15, 0.1, 0.24, 0.09, 0.16, 0.11];
    this.playShaker(t, shakerAccents[s % 8]);

    // Soft offbeat open hat spice
    if (s === 6 || s === 14) {
      this.playHat(t, { open: s === 14 && bar % 2 === 1, gain: 0.15, hpFreq: 7800 });
    }

    // Signature Amapiano Wooden Log-Drum Bassline (F# minor / A major bounce!)
    const logPatternA: (number | null)[] = [
      42, null, null, 45, null, null, 42, null, null, 47, 45, null, 42, null, 40, null,
    ];
    const logPatternB: (number | null)[] = [
      42, null, null, 45, null, 47, null, 49, null, 47, null, 45, 42, null, 45, 47,
    ];
    const logNote = (bar % 2 === 0 ? logPatternA : logPatternB)[s];
    if (logNote !== null) {
      this.playLogDrum(t, midiToFreq(logNote), stepDur * 2.4, 0.62);
    }

    // Lush warm Amapiano Rhodes chords on bar downbeats
    if (s === 0) {
      const chords: number[][] = [
        [54, 57, 61, 64], // F#m7
        [50, 54, 57, 61], // Dmaj7
        [57, 61, 64, 68], // Amaj7
        [52, 56, 59, 64], // Eadd9
      ];
      this.playRhodesChord(t, chords[bar], stepDur * 13.0, 0.16);
    }

    // Catchy muted Afro-guitar / marimba syncopated plucks
    const pluckNotes: Record<number, number> = {
      2: 69,
      5: 66,
      8: 64,
      11: 69,
      14: 73,
    };
    if (pluckNotes[s] !== undefined && (bar % 2 === 1 || s === 2 || s === 11)) {
      const transpose = bar === 1 ? -2 : bar === 3 ? 2 : 0;
      this.playPluck(t, midiToFreq(pluckNotes[s] + transpose), 0.18, 0.18);
    }
  }

  // =========================================================================
  // 4. CYBER SYNTHWAVE / ELECTRO (Cyber Foundry — 124 BPM driving neon pulse)
  // =========================================================================
  private scheduleCyberSynthwave(step: number, t: number, stepDur: number): void {
    const bar = Math.floor(step / 16);
    const s = step % 16;

    // Pounding 909 four-on-the-floor kick
    if (s % 4 === 0) {
      this.playKick(t, { pitchStart: 158, pitchEnd: 46, decay: 0.2, gain: 0.9, duck: 0.55 });
    }

    // Big 80s gated-reverb snare on 2 & 4 + tom/snare fill on bar 4
    if (s === 4 || s === 12) {
      this.playSnare(t, { toneFreq: 185, noiseFreq: 2500, decay: 0.25, gain: 0.62, gated: true });
    } else if (bar === 3 && (s === 14 || s === 15)) {
      this.playSnare(t, { toneFreq: 160, noiseFreq: 2100, decay: 0.14, gain: 0.4 });
    }

    // Crisp offbeat 909 open hi-hat + driving 16th pulse
    if (s % 4 === 2) {
      this.playHat(t, { open: true, gain: 0.24, hpFreq: 7600 });
    } else if (s % 2 === 0) {
      this.playHat(t, { open: false, gain: 0.12, hpFreq: 8600 });
    }

    // Iconic rolling 16th-note Juno/Moog Synthwave octave bassline (Am -> F -> C -> G)
    const roots = [33, 29, 36, 31]; // A1, F1, C2, G1
    const root = roots[bar];
    const octaveJump = s % 2 === 1 ? 12 : 0;
    const bassVel = s % 4 === 0 ? 0.24 : 0.34;
    this.playSynthBass(t, midiToFreq(root + octaveJump), stepDur * 0.88, bassVel);

    // Shimmering 80s retro poly-synth chord stabs
    if (s === 0 || s === 10) {
      const chords: number[][] = [
        [57, 60, 64, 67], // Am7
        [53, 57, 60, 64], // Fmaj7
        [60, 64, 67, 71], // Cmaj7
        [55, 59, 62, 67], // G6
      ];
      this.playSynthStab(t, chords[bar], stepDur * (s === 0 ? 6.5 : 4.2), 0.14, 2400);
    }

    // Neon cyberpunk arpeggio shimmer on bars 3-4 (or always during Star Flight)
    if (bar >= 2 || this.starActive) {
      const arp = [69, 72, 76, 79, 76, 72, 71, 76];
      if (s % 2 === 0) {
        this.playPluck(t, midiToFreq(arp[(s / 2) % arp.length]), 0.16, 0.12);
      }
    }
  }

  // =========================================================================
  // 5. LIQUID DRUM & BASS (Void Gallery — 166 BPM silky UK breakbeat)
  // =========================================================================
  private scheduleLiquidDnb(step: number, t: number, stepDur: number): void {
    const bar = Math.floor(step / 16);
    const s = step % 16;

    // Classic 2-step liquid DnB breakbeat kick (1 & 11)
    if (s === 0 || s === 10 || (bar === 3 && s === 14)) {
      this.playKick(t, { pitchStart: 152, pitchEnd: 52, decay: 0.15, gain: 0.86, duck: 0.44 });
    }

    // Crisp breakbeat snare on 5 & 13 + signature rolling ghost snares on 7, 9, 15
    if (s === 4 || s === 12) {
      this.playSnare(t, { toneFreq: 230, noiseFreq: 3200, decay: 0.13, gain: 0.54 });
    } else if (s === 7 || s === 9 || (bar % 2 === 1 && s === 15)) {
      this.playSnare(t, { toneFreq: 240, noiseFreq: 2800, decay: 0.065, gain: 0.19 });
    }

    // Fast shuffling ride/hat breakbeat top-end
    if (s % 2 === 0) {
      this.playHat(t, { open: s === 6 || s === 14, gain: s % 4 === 2 ? 0.2 : 0.14, hpFreq: 8500 });
    } else if (s === 11 || s === 15) {
      this.playHat(t, { open: false, gain: 0.11, hpFreq: 9200 });
    }

    // Deep gliding Liquid Reese sub-bass (Cm -> Ab -> Bb -> Gm)
    const bassNotes = [36, 32, 34, 31]; // C2, Ab1, Bb1, G1
    if (s === 0) {
      const nextNote = bassNotes[(bar + 1) % 4];
      this.playReeseBass(t, midiToFreq(bassNotes[bar]), midiToFreq(nextNote), stepDur * 15.2, 0.34);
    }

    // Ethereal floating Liquid DnB Rhodes chords
    if (s === 0) {
      const chords: number[][] = [
        [60, 63, 67, 70, 74], // Cm9
        [56, 60, 63, 67, 70], // Abmaj9
        [58, 62, 65, 69, 72], // Bbmaj9
        [55, 58, 62, 65, 69], // Gm9
      ];
      this.playRhodesChord(t, chords[bar], stepDur * 15.0, 0.19);
    }

    // Weightless astral chime arpeggio during Star Flight
    if (this.starActive && (s === 0 || s === 6 || s === 12)) {
      const notes = [79, 82, 86, 84];
      this.playPluck(t, midiToFreq(notes[(bar + s) % notes.length]), 0.25, 0.13);
    }
  }

  // =========================================================================
  // STUDIO WEB AUDIO INSTRUMENT VOICES
  // =========================================================================

  private playKick(
    t: number,
    opts: { pitchStart: number; pitchEnd: number; decay: number; gain: number; duck: number },
  ): void {
    if (!this.ctx || !this.beatBus) return;
    const ctx = this.ctx;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(opts.pitchStart, t);
    osc.frequency.exponentialRampToValueAtTime(opts.pitchEnd, t + 0.048);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, opts.pitchEnd * 0.86), t + opts.decay);

    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(opts.gain, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + opts.decay);

    osc.connect(gain);
    gain.connect(this.beatBus);
    osc.start(t);
    osc.stop(t + opts.decay + 0.02);

    // Subtle punchy beater click so kicks cut cleanly on phone speakers
    const click = ctx.createOscillator();
    const clickGain = ctx.createGain();
    click.type = 'triangle';
    click.frequency.setValueAtTime(360, t);
    click.frequency.exponentialRampToValueAtTime(95, t + 0.014);
    clickGain.gain.setValueAtTime(opts.gain * 0.28, t);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.016);
    click.connect(clickGain);
    clickGain.connect(this.beatBus);
    click.start(t);
    click.stop(t + 0.02);

    // Sidechain pump on chords & bass!
    if (this.sidechainGain && opts.duck > 0) {
      const sc = this.sidechainGain.gain;
      const dip = Math.max(0.35, 1.0 - opts.duck);
      sc.setValueAtTime(1.0, t);
      sc.linearRampToValueAtTime(dip, t + 0.012);
      sc.exponentialRampToValueAtTime(1.0, t + 0.17);
    }
  }

  private playSnare(
    t: number,
    opts: { toneFreq: number; noiseFreq: number; decay: number; gain: number; gated?: boolean },
  ): void {
    if (!this.ctx || !this.beatBus || !this.noiseBuffer) return;
    const ctx = this.ctx;

    // Noise snap
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filt = ctx.createBiquadFilter();
    filt.type = opts.gated ? 'bandpass' : 'highpass';
    filt.frequency.setValueAtTime(opts.noiseFreq, t);
    filt.Q.setValueAtTime(opts.gated ? 0.85 : 0.7, t);

    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(opts.gain, t);
    if (opts.gated) {
      // Classic 80s gated snare plateau -> sudden tight gate drop
      nGain.gain.linearRampToValueAtTime(opts.gain * 0.65, t + opts.decay * 0.72);
      nGain.gain.exponentialRampToValueAtTime(0.0001, t + opts.decay);
    } else {
      nGain.gain.exponentialRampToValueAtTime(0.0001, t + opts.decay);
    }

    noise.connect(filt);
    filt.connect(nGain);
    nGain.connect(this.beatBus);
    noise.start(t, Math.random() * 0.8);
    noise.stop(t + opts.decay + 0.02);

    // Pitched drum shell body
    const body = ctx.createOscillator();
    const bGain = ctx.createGain();
    body.type = 'triangle';
    body.frequency.setValueAtTime(opts.toneFreq, t);
    body.frequency.exponentialRampToValueAtTime(opts.toneFreq * 0.62, t + 0.075);
    bGain.gain.setValueAtTime(opts.gain * 0.62, t);
    bGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);

    body.connect(bGain);
    bGain.connect(this.beatBus);
    body.start(t);
    body.stop(t + 0.11);
  }

  private playClap(t: number, gainLevel: number): void {
    if (!this.ctx || !this.beatBus || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const taps = [0, 0.011, 0.022];

    for (let i = 0; i < taps.length; i++) {
      const start = t + taps[i];
      const isTail = i === taps.length - 1;
      const dur = isTail ? 0.15 : 0.022;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(1250, start);
      bp.Q.setValueAtTime(1.6, start);

      const g = ctx.createGain();
      g.gain.setValueAtTime(gainLevel * (isTail ? 0.95 : 0.65), start);
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur);

      src.connect(bp);
      bp.connect(g);
      g.connect(this.beatBus);
      src.start(start, Math.random() * 0.6);
      src.stop(start + dur + 0.01);
    }
  }

  private playRim(t: number, gainLevel: number): void {
    if (!this.ctx || !this.beatBus) return;
    const ctx = this.ctx;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const bp = ctx.createBiquadFilter();
    const g = ctx.createGain();

    osc1.type = 'triangle';
    osc2.type = 'square';
    osc1.frequency.setValueAtTime(760, t);
    osc1.frequency.exponentialRampToValueAtTime(420, t + 0.028);
    osc2.frequency.setValueAtTime(1620, t);

    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1150, t);
    bp.Q.setValueAtTime(2.6, t);

    g.gain.setValueAtTime(gainLevel, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.042);

    osc1.connect(bp);
    osc2.connect(bp);
    bp.connect(g);
    g.connect(this.beatBus);

    osc1.start(t);
    osc2.start(t);
    osc1.stop(t + 0.048);
    osc2.stop(t + 0.048);
  }

  private playHat(t: number, opts: { open: boolean; gain: number; hpFreq: number }): void {
    if (!this.ctx || !this.beatBus || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const dur = opts.open ? 0.19 : 0.038;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(opts.hpFreq, t);

    const g = ctx.createGain();
    g.gain.setValueAtTime(opts.gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    src.connect(hp);
    hp.connect(g);
    g.connect(this.beatBus);

    src.start(t, Math.random() * 0.9);
    src.stop(t + dur + 0.01);
  }

  private playShaker(t: number, gainLevel: number): void {
    if (!this.ctx || !this.beatBus || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(5800, t);
    bp.Q.setValueAtTime(1.5, t);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gainLevel, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.052);

    src.connect(bp);
    bp.connect(g);
    g.connect(this.beatBus);
    src.start(t, Math.random() * 0.9);
    src.stop(t + 0.06);
  }

  private play808(
    t: number,
    freq: number,
    dur: number,
    gainLevel: number,
    saturated: boolean,
    slideToFreq?: number,
  ): void {
    if (!this.ctx || !this.sidechainGain) return;
    const ctx = this.ctx;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 1.38, t);
    osc.frequency.exponentialRampToValueAtTime(freq, t + 0.025);
    if (slideToFreq) {
      osc.frequency.setValueAtTime(freq, t + dur * 0.45);
      osc.frequency.exponentialRampToValueAtTime(slideToFreq, t + dur * 0.88);
    }

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(saturated ? 310 : 210, t);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gainLevel, t + 0.01);
    g.gain.setValueAtTime(gainLevel * 0.9, t + Math.max(0.05, dur * 0.72));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    if (saturated && this.satCurve808) {
      const shaper = ctx.createWaveShaper();
      shaper.curve = this.satCurve808;
      osc.connect(shaper);
      shaper.connect(lp);
    } else {
      osc.connect(lp);
    }

    lp.connect(g);
    g.connect(this.sidechainGain);

    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  private playLogDrum(t: number, freq: number, dur: number, gainLevel: number): void {
    if (!this.ctx || !this.beatBus) return;
    const ctx = this.ctx;

    // Deep woody Amapiano body
    const body = ctx.createOscillator();
    body.type = 'sine';
    body.frequency.setValueAtTime(freq * 2.25, t);
    body.frequency.exponentialRampToValueAtTime(freq, t + 0.024);

    // Percussive hollow wood knock transient
    const knock = ctx.createOscillator();
    knock.type = 'triangle';
    knock.frequency.setValueAtTime(freq * 3.0, t);
    knock.frequency.exponentialRampToValueAtTime(freq * 1.5, t + 0.026);
    const knockGain = ctx.createGain();
    knockGain.gain.setValueAtTime(gainLevel * 0.42, t);
    knockGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.032);

    const shaper = ctx.createWaveShaper();
    if (this.satCurveLog) shaper.curve = this.satCurveLog;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(520, t);
    lp.frequency.exponentialRampToValueAtTime(240, t + dur);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gainLevel, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    body.connect(shaper);
    knock.connect(knockGain);
    knockGain.connect(shaper);
    shaper.connect(lp);
    lp.connect(g);
    g.connect(this.beatBus);

    body.start(t);
    knock.start(t);
    body.stop(t + dur + 0.02);
    knock.stop(t + 0.045);
  }

  private playCowbell(t: number, freq: number, gainLevel: number): void {
    if (!this.ctx || !this.sidechainGain) return;
    const ctx = this.ctx;

    // Authentic TR-808 dual-square metallic ratio (1 : 1.4815)
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = 'square';
    osc2.type = 'square';
    osc1.frequency.setValueAtTime(freq, t);
    osc2.frequency.setValueAtTime(freq * 1.4815, t);

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(freq * 1.45, t);
    bp.Q.setValueAtTime(3.0, t);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gainLevel, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.21);

    osc1.connect(bp);
    osc2.connect(bp);
    bp.connect(g);
    g.connect(this.sidechainGain);
    if (this.delaySend) g.connect(this.delaySend);

    osc1.start(t);
    osc2.start(t);
    osc1.stop(t + 0.23);
    osc2.stop(t + 0.23);
  }

  private playRhodesChord(t: number, midiNotes: number[], dur: number, gainLevel: number): void {
    if (!this.ctx || !this.sidechainGain) return;
    const ctx = this.ctx;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2400, t);
    lp.frequency.exponentialRampToValueAtTime(1150, t + dur);

    const chordGain = ctx.createGain();
    chordGain.gain.setValueAtTime(0.0001, t);
    chordGain.gain.linearRampToValueAtTime(gainLevel / Math.sqrt(midiNotes.length), t + 0.028);
    chordGain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    lp.connect(chordGain);
    chordGain.connect(this.sidechainGain);
    if (this.delaySend) chordGain.connect(this.delaySend);

    for (let i = 0; i < midiNotes.length; i++) {
      const f = midiToFreq(midiNotes[i]);
      const strumStart = t + i * 0.011;

      const fund = ctx.createOscillator();
      fund.type = 'sine';
      fund.frequency.setValueAtTime(f, strumStart);
      fund.detune.setValueAtTime((i % 2 === 0 ? -3 : 3), strumStart);
      fund.connect(lp);
      fund.start(strumStart);
      fund.stop(t + dur + 0.04);

      // Warm electric-piano tine bell overtone
      const tine = ctx.createOscillator();
      const tineGain = ctx.createGain();
      tine.type = 'triangle';
      tine.frequency.setValueAtTime(f * 2.0, strumStart);
      tineGain.gain.setValueAtTime(0.18, strumStart);
      tineGain.gain.exponentialRampToValueAtTime(0.0001, strumStart + Math.min(0.28, dur * 0.4));
      tine.connect(tineGain);
      tineGain.connect(lp);
      tine.start(strumStart);
      tine.stop(strumStart + 0.3);
    }
  }

  private playSynthBass(t: number, freq: number, dur: number, gainLevel: number): void {
    if (!this.ctx || !this.sidechainGain) return;
    const ctx = this.ctx;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc2.type = 'sawtooth';
    osc1.frequency.setValueAtTime(freq, t);
    osc2.frequency.setValueAtTime(freq, t);
    osc1.detune.setValueAtTime(-6, t);
    osc2.detune.setValueAtTime(6, t);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.setValueAtTime(3.2, t);
    lp.frequency.setValueAtTime(1650, t);
    lp.frequency.exponentialRampToValueAtTime(220, t + dur);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gainLevel, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc1.connect(lp);
    osc2.connect(lp);
    lp.connect(g);
    g.connect(this.sidechainGain);

    osc1.start(t);
    osc2.start(t);
    osc1.stop(t + dur + 0.02);
    osc2.stop(t + dur + 0.02);
  }

  private playSynthStab(
    t: number,
    midiNotes: number[],
    dur: number,
    gainLevel: number,
    cutoff: number,
  ): void {
    if (!this.ctx || !this.sidechainGain) return;
    const ctx = this.ctx;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.setValueAtTime(1.5, t);
    lp.frequency.setValueAtTime(cutoff * 0.45, t);
    lp.frequency.exponentialRampToValueAtTime(cutoff, t + 0.07);
    lp.frequency.exponentialRampToValueAtTime(cutoff * 0.35, t + dur);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gainLevel / Math.sqrt(midiNotes.length), t + 0.022);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    lp.connect(g);
    g.connect(this.sidechainGain);
    if (this.delaySend) g.connect(this.delaySend);

    for (let i = 0; i < midiNotes.length; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(midiToFreq(midiNotes[i]), t);
      osc.detune.setValueAtTime((i % 2 === 0 ? -7 : 7), t);
      osc.connect(lp);
      osc.start(t);
      osc.stop(t + dur + 0.03);
    }
  }

  private playPluck(t: number, freq: number, dur: number, gainLevel: number): void {
    if (!this.ctx || !this.sidechainGain) return;
    const ctx = this.ctx;

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, t);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3400, t);
    lp.frequency.exponentialRampToValueAtTime(850, t + dur);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gainLevel, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(lp);
    lp.connect(g);
    g.connect(this.sidechainGain);
    if (this.delaySend) g.connect(this.delaySend);

    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private playReeseBass(
    t: number,
    freqStart: number,
    freqEnd: number,
    dur: number,
    gainLevel: number,
  ): void {
    if (!this.ctx || !this.sidechainGain) return;
    const ctx = this.ctx;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc2.type = 'sawtooth';
    osc1.frequency.setValueAtTime(freqStart, t);
    osc2.frequency.setValueAtTime(freqStart, t);
    osc1.frequency.setValueAtTime(freqStart, t + dur * 0.82);
    osc2.frequency.setValueAtTime(freqStart, t + dur * 0.82);
    osc1.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    osc2.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    osc1.detune.setValueAtTime(-10, t);
    osc2.detune.setValueAtTime(10, t);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(240, t);
    lp.Q.setValueAtTime(1.8, t);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gainLevel, t + 0.04);
    g.gain.setValueAtTime(gainLevel * 0.88, t + dur * 0.85);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc1.connect(lp);
    osc2.connect(lp);
    lp.connect(g);
    g.connect(this.sidechainGain);

    osc1.start(t);
    osc2.start(t);
    osc1.stop(t + dur + 0.03);
    osc2.stop(t + dur + 0.03);
  }

  private playVinylPop(t: number): void {
    if (!this.ctx || !this.beatBus || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2800 + Math.random() * 2400, t);
    bp.Q.setValueAtTime(4.0, t);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.035, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.008);

    src.connect(bp);
    bp.connect(g);
    g.connect(this.beatBus);
    src.start(t, Math.random() * 1.4);
    src.stop(t + 0.012);
  }

  public dispose(): void {
    this.disposed = true;
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    if (this.schedulerTimer !== null) {
      window.clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
