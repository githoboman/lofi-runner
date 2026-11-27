import type { ObstacleKind, PowerupKind, SceneId } from './types';
import type { YetiAnimState } from './yetiRig';

export interface ReplayObstacleSnap {
  poolIndex: number;
  kind: ObstacleKind;
  lane: number;
  z: number;
  sliced: boolean;
}

export interface ReplayCoinSnap {
  poolIndex: number;
  lane: number;
  x: number;
  y: number;
  z: number;
  phase: number;
}

export interface ReplayPowerupSnap {
  poolIndex: number;
  kind: PowerupKind;
  lane: number;
  z: number;
}

export interface PoolReplayEntities {
  obstacles: ReplayObstacleSnap[];
  coins: ReplayCoinSnap[];
  powerups: ReplayPowerupSnap[];
}

export interface ReplayFrame {
  time: number;
  sceneId: SceneId;
  worldSlideActive: boolean;
  playerX: number;
  playerY: number;
  velocityY: number;
  laneVelocity: number;
  activeSpeed: number;
  speedRatio: number;
  animState: YetiAnimState;
  flipProgress: number;
  spinProgress: number;
  slashProgress: number;
  slashComboIndex: number;
  stumbleProgress: number;
  flyBarrelProgress: number;
  flyBarrelDir: number;
  flyLoopProgress: number;
  flySwoopProgress: number;
  swordActive: boolean;
  starActive: boolean;
  shieldActive: boolean;
  isChasing: boolean;
  isPlayerSliding: boolean;
  isPlayerFlying: boolean;
  entities: PoolReplayEntities;
}

export interface ReplaySampleResult {
  frame: ReplayFrame;
  nextFrame: ReplayFrame | null;
  alpha: number;
  progress: number;
  isSlowMo: boolean;
  playbackRate: number;
  done: boolean;
}

const MAX_RECORD_SECONDS = 5.0;
const SAMPLE_INTERVAL = 1 / 30; // 30 Hz rolling capture
const RING_CAPACITY = Math.ceil(MAX_RECORD_SECONDS / SAMPLE_INTERVAL) + 6; // ~156 frames

/**
 * Rolling 5-second 3D run recorder & highlight replay sequencer.
 * Continuously records compact 3D pose + world/entity snapshots into a fixed-size
 * ring buffer during live gameplay, and plays back the last 5 seconds with brisk
 * lead-in pacing + cinematic slow-motion over the Perfect Stunt climax.
 */
export class RunReplayRecorder {
  private ring: (ReplayFrame | null)[] = new Array(RING_CAPACITY).fill(null);
  private writeIndex = 0;
  private count = 0;
  private sampleAccum = 0;

  // Active playback clip state
  private clip: ReplayFrame[] = [];
  private clipStartTime = 0;
  private clipDuration = 0;
  private playheadOffset = 0; // seconds into clip [0 .. clipDuration]
  private activeStuntLabel = '';
  private playing = false;

  public reset(): void {
    this.ring.fill(null);
    this.writeIndex = 0;
    this.count = 0;
    this.sampleAccum = 0;
    this.clip = [];
    this.clipStartTime = 0;
    this.clipDuration = 0;
    this.playheadOffset = 0;
    this.activeStuntLabel = '';
    this.playing = false;
  }

  public shouldSample(dt: number): boolean {
    this.sampleAccum += dt;
    if (this.sampleAccum >= SAMPLE_INTERVAL) {
      this.sampleAccum -= SAMPLE_INTERVAL;
      if (this.sampleAccum > SAMPLE_INTERVAL) {
        this.sampleAccum = 0;
      }
      return true;
    }
    return false;
  }

  public pushFrame(frame: ReplayFrame): void {
    this.ring[this.writeIndex] = frame;
    this.writeIndex = (this.writeIndex + 1) % RING_CAPACITY;
    if (this.count < RING_CAPACITY) {
      this.count++;
    }
  }

  public hasEnoughFootage(): boolean {
    return this.count >= 8;
  }

  public beginReplay(stuntLabel: string): boolean {
    if (this.count < 6) return false;

    const ordered: ReplayFrame[] = [];
    const startIdx = (this.writeIndex - this.count + RING_CAPACITY) % RING_CAPACITY;
    for (let i = 0; i < this.count; i++) {
      const f = this.ring[(startIdx + i) % RING_CAPACITY];
      if (f) ordered.push(f);
    }
    if (ordered.length < 6) return false;

    const latestTime = ordered[ordered.length - 1].time;
    const minTime = latestTime - MAX_RECORD_SECONDS;
    let firstValid = 0;
    while (firstValid < ordered.length - 1 && ordered[firstValid].time < minTime) {
      firstValid++;
    }

    this.clip = ordered.slice(firstValid);
    if (this.clip.length < 4) return false;

    this.clipStartTime = this.clip[0].time;
    this.clipDuration = Math.max(0.25, latestTime - this.clipStartTime);
    this.playheadOffset = 0;
    this.activeStuntLabel = stuntLabel;
    this.playing = true;
    return true;
  }

  public isPlaying(): boolean {
    return this.playing;
  }

  public getStuntLabel(): string {
    return this.activeStuntLabel;
  }

  public getRecordedDuration(): number {
    return Math.min(MAX_RECORD_SECONDS, this.clipDuration);
  }

  public stopReplay(): void {
    this.playing = false;
    this.clip = [];
    this.playheadOffset = 0;
    this.activeStuntLabel = '';
  }

  /**
   * Advances playback across the captured 5-second clip:
   * - Lead-in (first ~72% of recorded footage) plays briskly at ~2.35x so the player sees
   *   the full 5-second approach in a snappy ~1.5s.
   * - Climax (final ~28%, ~1.3s containing the Perfect Stunt) smoothly shifts to 0.56x
   *   cinematic slow-motion so the 3D replay camera showcases the stunt in full glory.
   */
  public step(dt: number): ReplaySampleResult | null {
    if (!this.playing || this.clip.length === 0) return null;

    const slowMoWindow = Math.min(1.25, this.clipDuration * 0.42);
    const slowMoStart = Math.max(0, this.clipDuration - slowMoWindow);
    const inSlowMo = this.playheadOffset >= slowMoStart;

    // Smoothly ramp speed down as we approach the slow-motion climax window
    let playbackRate = 2.35;
    if (inSlowMo) {
      playbackRate = 0.56;
    } else if (slowMoStart > 0.25 && this.playheadOffset > slowMoStart - 0.35) {
      const blend = (this.playheadOffset - (slowMoStart - 0.35)) / 0.35;
      playbackRate = 2.35 + (0.56 - 2.35) * blend;
    }

    this.playheadOffset += dt * playbackRate;
    const done = this.playheadOffset >= this.clipDuration;
    const clampedOffset = Math.min(this.clipDuration, this.playheadOffset);
    const targetTime = this.clipStartTime + clampedOffset;

    // Locate surrounding keyframes for silky interpolation
    let idx = 0;
    let lo = 0;
    let hi = this.clip.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.clip[mid].time <= targetTime) lo = mid;
      else hi = mid - 1;
    }
    idx = lo;

    const frame = this.clip[idx];
    const nextFrame = idx + 1 < this.clip.length ? this.clip[idx + 1] : null;
    let alpha = 0;
    if (nextFrame && nextFrame.time > frame.time) {
      alpha = Math.max(0, Math.min(1, (targetTime - frame.time) / (nextFrame.time - frame.time)));
    }

    return {
      frame,
      nextFrame,
      alpha,
      progress: Math.max(0, Math.min(1, clampedOffset / Math.max(0.001, this.clipDuration))),
      isSlowMo: inSlowMo,
      playbackRate,
      done,
    };
  }
}
