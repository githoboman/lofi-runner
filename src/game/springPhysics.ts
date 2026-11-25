import * as THREE from 'three';
import type { CharacterId } from './types';

const MAX_SUBSTEP = 1 / 120;

/**
 * Second-order Dampened Harmonic Oscillator (F = -omega^2 * (x - target) - 2 * zeta * omega * v + externalForce).
 * Uses sub-stepped semi-implicit Euler integration so high-stiffness springs stay unconditionally stable
 * even during frame-time spikes or software-WebGL pacing.
 */
export class HarmonicOscillator1D {
  public value: number;
  public velocity = 0;
  public omega: number; // Natural angular frequency (rad/s)
  public zeta: number; // Damping ratio (< 1 underdamped/bouncy, = 1 critical, > 1 overdamped)

  constructor(initial = 0, omega = 14, zeta = 0.42) {
    this.value = initial;
    this.omega = omega;
    this.zeta = zeta;
  }

  public tune(omega: number, zeta: number): void {
    this.omega = omega;
    this.zeta = zeta;
  }

  public impulse(deltaVelocity: number): void {
    this.velocity += deltaVelocity;
  }

  public reset(value = 0): void {
    this.value = value;
    this.velocity = 0;
  }

  public step(
    target: number,
    dt: number,
    externalAccel = 0,
    minVal = -Infinity,
    maxVal = Infinity,
  ): number {
    const safeDt = Math.min(Math.max(dt, 0), 0.05);
    if (safeDt <= 0) return this.value;

    const steps = Math.max(1, Math.ceil(safeDt / MAX_SUBSTEP));
    const h = safeDt / steps;
    const k = this.omega * this.omega;
    const c = 2 * this.zeta * this.omega;

    for (let i = 0; i < steps; i++) {
      const accel = -k * (this.value - target) - c * this.velocity + externalAccel;
      this.velocity += accel * h;
      this.value += this.velocity * h;
      if (this.value < minVal) {
        this.value = minVal;
        if (this.velocity < 0) this.velocity *= -0.25;
      } else if (this.value > maxVal) {
        this.value = maxVal;
        if (this.velocity > 0) this.velocity *= -0.25;
      }
    }

    return this.value;
  }
}

/**
 * Dual-axis (pitch + roll) Dampened Harmonic Oscillator for dangling 3D character accessories
 * (ear flaps, hip pouches, chest pendants, cape/tail segments).
 */
export class HarmonicOscillator2D {
  public readonly pitch: HarmonicOscillator1D;
  public readonly roll: HarmonicOscillator1D;

  constructor(omega = 13, zeta = 0.36, initPitch = 0, initRoll = 0) {
    this.pitch = new HarmonicOscillator1D(initPitch, omega, zeta);
    this.roll = new HarmonicOscillator1D(initRoll, omega, zeta);
  }

  public tune(omega: number, zeta: number): void {
    this.pitch.tune(omega, zeta);
    this.roll.tune(omega, zeta);
  }

  public impulse(dPitchVel: number, dRollVel: number): void {
    this.pitch.impulse(dPitchVel);
    this.roll.impulse(dRollVel);
  }

  public reset(initPitch = 0, initRoll = 0): void {
    this.pitch.reset(initPitch);
    this.roll.reset(initRoll);
  }
}

export interface AccessoryPhysicsInput {
  dt: number;
  elapsed: number;
  laneVelocity: number;
  velocityY: number;
  forwardSpeed: number;
  isSliding: boolean;
  isFlying: boolean;
  isFlipping: boolean;
  isMenuPreview: boolean;
  swordActive: boolean;
}

export interface AccessoryPhysicsState {
  squashY: number;
  headLag: number;
  limbLag: number;
  accessorySurge: number;
  leftEarPitch: number;
  leftEarRoll: number;
  rightEarPitch: number;
  rightEarRoll: number;
  leftPouchPitch: number;
  leftPouchRoll: number;
  rightPouchPitch: number;
  rightPouchRoll: number;
  pendantPitch: number;
  pendantRoll: number;
  tailRootPitch: number;
  tailRootRoll: number;
  tailTipPitch: number;
  tailTipRoll: number;
}

/**
 * Spring-based secondary-motion physics controller for the Yeti's accessories & body elasticity.
 * Differentiates real linear acceleration (ax, ay, az) every frame and feeds inertial forces into
 * coupled damped harmonic oscillators for ear flaps, hip pouches, chest medallion, and a 2-link tail/cape.
 */
export class AccessorySpringController {
  // Core body / limb oscillators
  public readonly squash = new HarmonicOscillator1D(1, 14.5, 0.45);
  public readonly headLag = new HarmonicOscillator1D(0, 12.0, 0.48);
  public readonly limbLag = new HarmonicOscillator1D(0, 11.5, 0.46);
  public readonly accessorySurge = new HarmonicOscillator1D(0, 10.5, 0.42);

  // Articulated accessory oscillators
  public readonly leftEar = new HarmonicOscillator2D(15.5, 0.32);
  public readonly rightEar = new HarmonicOscillator2D(15.5, 0.32);
  public readonly leftPouch = new HarmonicOscillator2D(12.2, 0.34);
  public readonly rightPouch = new HarmonicOscillator2D(12.2, 0.34);
  public readonly pendant = new HarmonicOscillator2D(13.8, 0.28);

  // Coupled 2-link tail / cape chain (root drives tip for whip-like follow-through)
  public readonly tailRoot = new HarmonicOscillator2D(10.8, 0.38, 0.22, 0);
  public readonly tailTip = new HarmonicOscillator2D(9.2, 0.3, 0.14, 0);

  // Previous velocities for true acceleration derivation (a = dv / dt)
  private prevVelX = 0;
  private prevVelY = 0;
  private prevForwardSpeed = 0;
  private elasticity = 1.0;

  public configureForCharacter(charId: CharacterId): void {
    if (charId === 'neon_slime') {
      // Soft, ultra-bouncy underdamped gelatinous harmonics
      this.elasticity = 1.42;
      this.squash.tune(10.8, 0.26);
      this.leftEar.tune(12.5, 0.22);
      this.rightEar.tune(12.5, 0.22);
      this.leftPouch.tune(10.0, 0.22);
      this.rightPouch.tune(10.0, 0.22);
      this.pendant.tune(11.5, 0.2);
      this.tailRoot.tune(9.2, 0.24);
      this.tailTip.tune(8.0, 0.2);
    } else if (charId === 'half_cyborg') {
      // Crisp, tight mechanical servo harmonics with quick settling
      this.elasticity = 0.78;
      this.squash.tune(17.2, 0.62);
      this.leftEar.tune(19.0, 0.54);
      this.rightEar.tune(15.5, 0.36); // Asymmetric: organic right ear stays bouncier!
      this.leftPouch.tune(16.5, 0.52);
      this.rightPouch.tune(13.0, 0.36);
      this.pendant.tune(15.5, 0.45);
      this.tailRoot.tune(14.0, 0.5);
      this.tailTip.tune(12.0, 0.42);
    } else if (charId === 'void_shadow') {
      // Flowing low-gravity mystic cloak & whisper-light accessories
      this.elasticity = 1.12;
      this.squash.tune(13.8, 0.42);
      this.leftEar.tune(14.5, 0.32);
      this.rightEar.tune(14.5, 0.32);
      this.leftPouch.tune(11.5, 0.3);
      this.rightPouch.tune(11.5, 0.3);
      this.pendant.tune(12.4, 0.26);
      this.tailRoot.tune(8.8, 0.32);
      this.tailTip.tune(7.4, 0.26);
    } else if (charId === 'inferno_blaze') {
      // Energetic snapping ember harmonics
      this.elasticity = 1.18;
      this.squash.tune(15.0, 0.38);
      this.leftEar.tune(16.2, 0.3);
      this.rightEar.tune(16.2, 0.3);
      this.leftPouch.tune(13.0, 0.32);
      this.rightPouch.tune(13.0, 0.32);
      this.pendant.tune(14.2, 0.28);
      this.tailRoot.tune(11.4, 0.32);
      this.tailTip.tune(10.0, 0.25);
    } else {
      // OG Lofi: plush, weighty furry ear flaps, street pouches & shaggy tail
      this.elasticity = 1.05;
      this.squash.tune(14.2, 0.42);
      this.leftEar.tune(14.2, 0.29);
      this.rightEar.tune(14.2, 0.29);
      this.leftPouch.tune(11.8, 0.31);
      this.rightPouch.tune(11.8, 0.31);
      this.pendant.tune(13.2, 0.26);
      this.tailRoot.tune(10.5, 0.34);
      this.tailTip.tune(8.8, 0.27);
    }
  }

  public onJumpLaunch(isDoubleJump = false): void {
    const m = this.elasticity * (isDoubleJump ? 1.32 : 1.0);
    this.squash.impulse(4.1 * m);
    this.headLag.impulse(-2.8 * m);
    this.limbLag.impulse(-4.4 * m);
    this.accessorySurge.impulse(isDoubleJump ? 6.8 : 3.8);

    // Upward acceleration pushes dangling ears, pouches, medallion & tail downward!
    this.leftEar.impulse(-3.2 * m, -5.8 * m);
    this.rightEar.impulse(-3.2 * m, 5.8 * m);
    this.leftPouch.impulse(5.5 * m, -3.4 * m);
    this.rightPouch.impulse(5.5 * m, 3.4 * m);
    this.pendant.impulse(6.8 * m, (Math.random() - 0.5) * 2.5);
    this.tailRoot.impulse(6.0 * m, 0);
    this.tailTip.impulse(-3.5 * m, 0); // Delayed counter-whip at the tip
  }

  public onLandingImpact(impactSpeed = 14): void {
    const strength = THREE.MathUtils.clamp(impactSpeed / 14, 0.65, 1.8) * this.elasticity;
    this.squash.impulse(-5.2 * strength);
    this.headLag.impulse(3.6 * strength);
    this.limbLag.impulse(4.0 * strength);
    this.accessorySurge.impulse(3.2 * strength);

    // Sudden deceleration flings ears outward/upward, bounces pouches & snaps tail down then up!
    this.leftEar.impulse(4.5 * strength, 7.6 * strength);
    this.rightEar.impulse(4.5 * strength, -7.6 * strength);
    this.leftPouch.impulse(-7.4 * strength, 6.2 * strength);
    this.rightPouch.impulse(-7.4 * strength, -6.2 * strength);
    this.pendant.impulse(-8.5 * strength, (Math.random() - 0.5) * 3.0);
    this.tailRoot.impulse(-6.5 * strength, 0);
    this.tailTip.impulse(-5.2 * strength, 0);
  }

  public onSlideDrop(): void {
    const m = this.elasticity;
    this.squash.impulse(-3.8 * m);
    this.headLag.impulse(-2.4 * m);
    this.accessorySurge.impulse(3.6);

    // Rapid crouch whips ears back, flings pouches forward/up, and streams tail behind
    this.leftEar.impulse(-5.8 * m, 4.8 * m);
    this.rightEar.impulse(-5.8 * m, -4.8 * m);
    this.leftPouch.impulse(-6.2 * m, 5.4 * m);
    this.rightPouch.impulse(-6.2 * m, -5.4 * m);
    this.pendant.impulse(-6.8 * m, 0);
    this.tailRoot.impulse(7.2 * m, 0);
    this.tailTip.impulse(5.5 * m, 0);
  }

  public onLaneSnap(dir: number): void {
    const m = this.elasticity;
    // Lateral jolt swings ears, pouches, medallion & tail opposite to lane switch direction
    this.leftEar.impulse(0, -dir * 5.2 * m);
    this.rightEar.impulse(0, -dir * 5.2 * m);
    this.leftPouch.impulse(1.4 * m, -dir * 6.4 * m);
    this.rightPouch.impulse(1.4 * m, -dir * 6.4 * m);
    this.pendant.impulse(1.8 * m, -dir * 7.8 * m);
    this.tailRoot.impulse(0, -dir * 6.6 * m);
    this.tailTip.impulse(0, dir * 3.8 * m);
  }

  public onSlashImpact(): void {
    const m = this.elasticity;
    this.squash.impulse(3.0 * m);
    this.headLag.impulse(-2.6 * m);
    this.accessorySurge.impulse(7.8);
    this.leftEar.impulse(-3.8 * m, 3.6 * m);
    this.rightEar.impulse(-3.8 * m, -3.6 * m);
    this.leftPouch.impulse(4.8 * m, 4.4 * m);
    this.rightPouch.impulse(4.8 * m, -4.4 * m);
    this.pendant.impulse(6.5 * m, 5.2 * m);
    this.tailRoot.impulse(5.2 * m, 5.8 * m);
    this.tailTip.impulse(4.2 * m, -4.5 * m);
  }

  public onFlightStunt(dir = 1): void {
    const m = this.elasticity;
    this.squash.impulse(2.6 * m);
    this.accessorySurge.impulse(6.5);
    this.leftEar.impulse(-4.5 * m, dir * 5.2 * m);
    this.rightEar.impulse(-4.5 * m, dir * 5.2 * m);
    this.leftPouch.impulse(4.5 * m, -dir * 6.0 * m);
    this.rightPouch.impulse(4.5 * m, -dir * 6.0 * m);
    this.pendant.impulse(5.0 * m, -dir * 6.5 * m);
    this.tailRoot.impulse(4.5 * m, dir * 7.4 * m);
    this.tailTip.impulse(3.2 * m, -dir * 5.6 * m);
  }

  public step(input: AccessoryPhysicsInput): AccessoryPhysicsState {
    const {
      dt,
      elapsed,
      laneVelocity,
      velocityY,
      forwardSpeed,
      isSliding,
      isFlying,
      isFlipping,
      isMenuPreview,
      swordActive,
    } = input;

    const safeDt = Math.max(dt, 0.004);
    const rawAx = (laneVelocity - this.prevVelX) / safeDt;
    const rawAy = (velocityY - this.prevVelY) / safeDt;
    const rawAz = (forwardSpeed - this.prevForwardSpeed) / safeDt;
    this.prevVelX = laneVelocity;
    this.prevVelY = velocityY;
    this.prevForwardSpeed = forwardSpeed;

    // Clamp derived linear accelerations so sudden teleports/resets never spike oscillators
    const ax = isMenuPreview ? 0 : THREE.MathUtils.clamp(rawAx, -95, 95);
    const ay = isMenuPreview ? 0 : THREE.MathUtils.clamp(rawAy, -110, 110);
    const az = isMenuPreview ? 0 : THREE.MathUtils.clamp(rawAz, -60, 60);

    const speedNorm = isMenuPreview ? 0 : THREE.MathUtils.clamp(forwardSpeed / 44, 0, 1.35);
    const windFlutter = isMenuPreview
      ? Math.sin(elapsed * 2.6) * 0.04
      : Math.sin(elapsed * (13 + speedNorm * 8)) * (0.06 + speedNorm * 0.08);

    // Core body & limb harmonics
    const squashY = this.squash.step(1, dt, -ay * 0.05, 0.68, 1.34);
    const headLagTarget = isMenuPreview
      ? 0
      : THREE.MathUtils.clamp(-velocityY * 0.016, -0.28, 0.28);
    const headLag = this.headLag.step(headLagTarget, dt, -ay * 0.12, -0.44, 0.44);

    const limbLagTarget = isMenuPreview
      ? 0
      : THREE.MathUtils.clamp(-velocityY * 0.03, -0.5, 0.5);
    const limbLag = this.limbLag.step(limbLagTarget, dt, -ay * 0.18, -0.78, 0.78);

    const surgeTarget = isFlying ? 0.7 : swordActive ? 0.45 : isFlipping ? 0.55 : 0;
    const accessorySurge = this.accessorySurge.step(surgeTarget, dt, 0, -0.2, 2.3);

    // Ear flaps: react to vertical acceleration (flop down on ascent, flare up on drop/land),
    // wind drag pitches them slightly back, lateral acceleration banks them sideways!
    const earPitchTarget = isMenuPreview
      ? 0.04
      : -0.14 - speedNorm * 0.34 - (isSliding ? 0.35 : 0) - (isFlying ? 0.42 : 0) + windFlutter * 0.6;
    const earRollBase = isMenuPreview ? 0.03 : THREE.MathUtils.clamp(-velocityY * 0.025, -0.32, 0.42);
    const earLateralBias = THREE.MathUtils.clamp(-laneVelocity * 0.025, -0.35, 0.35);

    const leftEarPitch = this.leftEar.pitch.step(
      earPitchTarget,
      dt,
      -az * 0.24 - ay * 0.14,
      -0.95,
      0.75,
    );
    const leftEarRoll = this.leftEar.roll.step(
      earRollBase + earLateralBias,
      dt,
      -ay * 0.28 - ax * 0.22,
      -0.88,
      0.88,
    );
    const rightEarPitch = this.rightEar.pitch.step(
      earPitchTarget,
      dt,
      -az * 0.24 - ay * 0.14,
      -0.95,
      0.75,
    );
    const rightEarRoll = this.rightEar.roll.step(
      -earRollBase + earLateralBias,
      dt,
      ay * 0.28 - ax * 0.22,
      -0.88,
      0.88,
    );

    // Hip pouches: dangle under gravity, trail back with forward speed, kick outward on land/slide/turn!
    const pouchPitchTarget = isMenuPreview
      ? 0.04
      : 0.18 + speedNorm * 0.46 + (isSliding ? -0.35 : 0) + (isFlying ? 0.58 : 0) + windFlutter * 0.8;
    const pouchOutward = isMenuPreview ? 0.05 : 0.08 + Math.abs(velocityY) * 0.015;
    const pouchLat = THREE.MathUtils.clamp(-laneVelocity * 0.04, -0.48, 0.48);

    const leftPouchPitch = this.leftPouch.pitch.step(
      pouchPitchTarget,
      dt,
      az * 0.22 + ay * 0.24,
      -0.75,
      1.15,
    );
    const leftPouchRoll = this.leftPouch.roll.step(
      pouchOutward + pouchLat,
      dt,
      -ax * 0.3 - ay * 0.18,
      -0.85,
      0.85,
    );
    const rightPouchPitch = this.rightPouch.pitch.step(
      pouchPitchTarget,
      dt,
      az * 0.22 + ay * 0.24,
      -0.75,
      1.15,
    );
    const rightPouchRoll = this.rightPouch.roll.step(
      -pouchOutward + pouchLat,
      dt,
      -ax * 0.3 + ay * 0.18,
      -0.85,
      0.85,
    );

    // Chest medallion / charm: lively free-swinging pendulum
    const pendantPitchTarget = isMenuPreview
      ? 0.02
      : -0.1 - speedNorm * 0.28 - (isSliding ? 0.25 : 0);
    const pendantPitch = this.pendant.pitch.step(
      pendantPitchTarget,
      dt,
      -ay * 0.26 - az * 0.2,
      -0.95,
      0.75,
    );
    const pendantRoll = this.pendant.roll.step(
      THREE.MathUtils.clamp(-laneVelocity * 0.048, -0.58, 0.58),
      dt,
      -ax * 0.36,
      -0.95,
      0.95,
    );

    // 2-Segment coupled tail / cape chain!
    const tailTargetPitch = isMenuPreview
      ? 0.16
      : isFlying
        ? 0.96 + speedNorm * 0.22
        : isSliding
          ? 1.06
          : 0.42 + speedNorm * 0.44 + THREE.MathUtils.clamp(-velocityY * 0.036, -0.38, 0.46) + windFlutter;
    const tailTargetRoll = THREE.MathUtils.clamp(-laneVelocity * 0.042, -0.52, 0.52);

    const tailRootPitch = this.tailRoot.pitch.step(
      tailTargetPitch,
      dt,
      -ay * 0.22 + az * 0.2,
      -0.42,
      1.48,
    );
    const tailRootRoll = this.tailRoot.roll.step(
      tailTargetRoll,
      dt,
      -ax * 0.32,
      -0.82,
      0.82,
    );

    // Tail tip follows tail root with phase lag + inertial coupling from root velocity!
    const tailTipPitch = this.tailTip.pitch.step(
      tailRootPitch * 0.52 + windFlutter * 1.4,
      dt,
      -this.tailRoot.pitch.velocity * 1.45 - ay * 0.18,
      -0.85,
      1.15,
    );
    const tailTipRoll = this.tailTip.roll.step(
      tailRootRoll * 0.65,
      dt,
      -this.tailRoot.roll.velocity * 1.6 - ax * 0.22,
      -0.95,
      0.95,
    );

    return {
      squashY,
      headLag,
      limbLag,
      accessorySurge,
      leftEarPitch,
      leftEarRoll,
      rightEarPitch,
      rightEarRoll,
      leftPouchPitch,
      leftPouchRoll,
      rightPouchPitch,
      rightPouchRoll,
      pendantPitch,
      pendantRoll,
      tailRootPitch,
      tailRootRoll,
      tailTipPitch,
      tailTipRoll,
    };
  }
}
