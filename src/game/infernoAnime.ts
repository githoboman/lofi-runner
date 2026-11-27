import { animate, createTimeline, stagger, type JSAnimation, type Timeline } from 'animejs';

export interface BrazierFlameAnimState {
  scaleY: number;
  scaleXZ: number;
  tiltX: number;
  tiltZ: number;
}

export interface InfernoAnimeState {
  magmaWaveY: number;
  magmaEmissive: number;
  magmaFlowRate: number;
  magmaSwayX: number;
  emberPulse: number;
  pendulumWindGust: number;
  pendulumSwingBoost: number;
  cageHeatScale: number;
  rimIntensityMult: number;
  keyIntensityMult: number;
}

/**
 * anime.js v4 choreography controller dedicated to World 2 (Inferno Caldera).
 * Drives staggered temple brazier flame flares, volcanic magma surges, iron pendulum wind gusts,
 * and temple rune / atmospheric rim-light pulses with zero per-frame allocations.
 */
export class InfernoAnimeController {
  public readonly state: InfernoAnimeState = {
    magmaWaveY: -1.7,
    magmaEmissive: 0.42,
    magmaFlowRate: 0.14,
    magmaSwayX: 0,
    emberPulse: 0.25,
    pendulumWindGust: 0,
    pendulumSwingBoost: 1,
    cageHeatScale: 1,
    rimIntensityMult: 1,
    keyIntensityMult: 1,
  };

  public readonly brazierSlots: BrazierFlameAnimState[];

  private timelines: Timeline[] = [];
  private animations: JSAnimation[] = [];
  private active = false;

  constructor(brazierCount: number) {
    this.brazierSlots = Array.from({ length: Math.max(1, brazierCount) }, () => ({
      scaleY: 1,
      scaleXZ: 1,
      tiltX: 0,
      tiltZ: 0,
    }));

    // 1. Volcanic Magma Surge & Tectonic Pulse Timeline
    const magmaTl = createTimeline({
      loop: true,
      autoplay: false,
    })
      .add(
        this.state,
        {
          magmaWaveY: [-1.82, -1.46, -1.68, -1.36, -1.82],
          magmaEmissive: [0.34, 0.72, 0.46, 0.86, 0.34],
          magmaFlowRate: [0.12, 0.24, 0.15, 0.28, 0.12],
          magmaSwayX: [-0.045, 0.05, -0.025, 0.06, -0.045],
          duration: 5400,
          ease: 'inOutSine',
        },
        0,
      )
      .add(
        this.state,
        {
          rimIntensityMult: [0.88, 1.32, 0.96, 1.42, 0.88],
          keyIntensityMult: [0.95, 1.12, 0.98, 1.16, 0.95],
          duration: 5400,
          ease: 'inOutQuad',
        },
        0,
      );
    this.timelines.push(magmaTl);

    // 2. Temple Rune & Ember Heartbeat (sharp flare-up, slow smoldering decay)
    const emberTl = createTimeline({
      loop: true,
      autoplay: false,
    })
      .add(this.state, {
        emberPulse: 1,
        cageHeatScale: 1.24,
        duration: 420,
        ease: 'outExpo',
      })
      .add(this.state, {
        emberPulse: 0.18,
        cageHeatScale: 0.94,
        duration: 1680,
        ease: 'inOutCubic',
      })
      .add(this.state, {
        emberPulse: 0.76,
        cageHeatScale: 1.14,
        duration: 340,
        ease: 'outQuart',
      })
      .add(this.state, {
        emberPulse: 0.15,
        cageHeatScale: 0.96,
        duration: 1260,
        ease: 'inOutSine',
      });
    this.timelines.push(emberTl);

    // 3. Choreographed Volcanic Wind Gusts for Swinging Iron Pendulum Chains
    const gustTl = createTimeline({
      loop: true,
      autoplay: false,
    })
      .add(this.state, {
        pendulumWindGust: 0.17,
        pendulumSwingBoost: 1.38,
        duration: 1650,
        ease: 'inOutBack(1.4)',
      })
      .add(this.state, {
        pendulumWindGust: -0.14,
        pendulumSwingBoost: 0.92,
        duration: 1950,
        ease: 'inOutSine',
      })
      .add(this.state, {
        pendulumWindGust: 0.05,
        pendulumSwingBoost: 1.12,
        duration: 1300,
        ease: 'inOutQuad',
      });
    this.timelines.push(gustTl);

    // 4. Staggered Brazier Flame Choreography along the Inferno Temple Causeway
    const brazierWave = animate(this.brazierSlots, {
      scaleY: [0.84, 1.48, 0.96, 1.34],
      scaleXZ: [0.92, 1.18, 0.94, 1.12],
      tiltX: [-0.08, 0.13, -0.06, 0.09],
      tiltZ: [-0.14, 0.16, -0.11, 0.12],
      duration: 1350,
      delay: stagger(85, { from: 'center' }),
      loop: true,
      alternate: true,
      ease: 'inOutQuad',
      autoplay: false,
    });
    this.animations.push(brazierWave);
  }

  public setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (active) {
      for (const tl of this.timelines) tl.play();
      for (const anim of this.animations) anim.play();
    } else {
      for (const tl of this.timelines) tl.pause();
      for (const anim of this.animations) anim.pause();
    }
  }

  public dispose(): void {
    this.active = false;
    for (const tl of this.timelines) tl.revert();
    for (const anim of this.animations) anim.revert();
    this.timelines.length = 0;
    this.animations.length = 0;
  }
}
