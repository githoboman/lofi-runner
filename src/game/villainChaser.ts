import * as THREE from 'three';
import { HarmonicOscillator2D } from './springPhysics';
import { createRadialShadowTexture } from './textures';

export interface VillainUpdateParams {
  dt: number;
  elapsed: number;
  playerX: number;
  playerY: number;
  isPlayerSliding: boolean;
  isPlayerFlying: boolean;
  isChasing: boolean;
  speedRatio: number;
  isGameOver: boolean;
  isMenuPreview: boolean;
}

function createVillainToonGradient(): THREE.DataTexture {
  const data = new Uint8Array([84, 172, 255]);
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 3D Articulated Villain Chaser ("Baron Frostbane / The Yeti Hunter").
 * Pursues the Yeti from behind like a classic street-runner enforcer:
 * bursts in at run start, lunges onto the Yeti's heels on any stumble/hit,
 * banks across lanes, jet-hops obstacles, flinches from sliced crates, and captures on Game Over.
 */
export class VillainChaserController {
  public readonly root = new THREE.Group();
  private bodyPivot = new THREE.Group();
  private contactShadow: THREE.Mesh;

  private toonGradient: THREE.DataTexture;
  private inkOutlineMat: THREE.MeshBasicMaterial;

  // Articulated skeleton
  private hips = new THREE.Group();
  private spine = new THREE.Group();
  private chest = new THREE.Group();
  private head = new THREE.Group();
  private leftShoulder = new THREE.Group();
  private leftElbow = new THREE.Group();
  private rightShoulder = new THREE.Group();
  private rightElbow = new THREE.Group();
  private leftHip = new THREE.Group();
  private leftKnee = new THREE.Group();
  private rightHip = new THREE.Group();
  private rightKnee = new THREE.Group();
  private capeRoot = new THREE.Group();
  private capeTip = new THREE.Group();
  private stunRing1!: THREE.Mesh;
  private stunRing2!: THREE.Mesh;
  private leftJetFlame!: THREE.Mesh;
  private rightJetFlame!: THREE.Mesh;
  private visorEye!: THREE.Mesh;

  // Spring physics for hunter's flowing cape
  private capeRootSpring = new HarmonicOscillator2D(10.2, 0.34, 0.35, 0);
  private capeTipSpring = new HarmonicOscillator2D(8.5, 0.28, 0.2, 0);

  // Pursuit state
  private x = 0;
  private prevX = 0;
  private y = 0;
  private z = 4.6;
  private targetZ = 5.4;
  private surgeTimer = 0;
  private flinchTimer = 0;
  private runCycle = 0;
  private batonSwing = 0;

  constructor() {
    this.toonGradient = createVillainToonGradient();
    this.inkOutlineMat = new THREE.MeshBasicMaterial({
      color: 0x050509,
      side: THREE.BackSide,
    });

    const shadowTex = createRadialShadowTexture();
    this.contactShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.5, 2.5),
      new THREE.MeshBasicMaterial({
        map: shadowTex,
        transparent: true,
        depthWrite: false,
        opacity: 0.6,
      }),
    );
    this.contactShadow.rotation.x = -Math.PI / 2;
    this.contactShadow.position.y = 0.03;
    this.root.add(this.contactShadow);

    // Face forward (-Z, chasing the Yeti)
    this.bodyPivot.rotation.y = Math.PI;
    this.root.add(this.bodyPivot);

    this.buildVillainMesh();
    this.root.visible = false;
  }

  private toon(
    color: number,
    emissive = 0x000000,
    emissiveIntensity = 0,
  ): THREE.MeshToonMaterial {
    return new THREE.MeshToonMaterial({
      color,
      gradientMap: this.toonGradient,
      emissive,
      emissiveIntensity,
    });
  }

  private addOutlined(
    parent: THREE.Object3D,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    pos: [number, number, number] = [0, 0, 0],
    scale: [number, number, number] = [1, 1, 1],
    rot: [number, number, number] = [0, 0, 0],
    withOutline = true,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.scale.set(scale[0], scale[1], scale[2]);
    mesh.rotation.set(rot[0], rot[1], rot[2]);
    mesh.castShadow = true;

    if (withOutline) {
      const outline = new THREE.Mesh(geo, this.inkOutlineMat);
      outline.scale.setScalar(1.075);
      mesh.add(outline);
    }

    parent.add(mesh);
    return mesh;
  }

  private buildVillainMesh(): void {
    const armorDark = this.toon(0x181924);
    const armorSlate = this.toon(0x2d3348);
    const gunmetal = new THREE.MeshStandardMaterial({
      color: 0x475569,
      roughness: 0.3,
      metalness: 0.85,
    });
    const crimsonGlow = this.toon(0xff2e54, 0xe11d48, 1.55);
    const crimsonTrim = this.toon(0x9f1239, 0x881337, 0.35);
    const capeMat = this.toon(0x1e1022);
    const jetMat = new THREE.MeshBasicMaterial({
      color: 0xf43f5e,
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    // Articulated skeletal hierarchy (slightly taller/broader than the Yeti for imposing silhouette)
    this.hips.position.y = 1.05;
    this.bodyPivot.add(this.hips);

    this.spine.position.y = 0.16;
    this.hips.add(this.spine);

    this.chest.position.y = 0.46;
    this.spine.add(this.chest);

    this.head.position.set(0, 0.64, 0.04);
    this.chest.add(this.head);

    this.leftShoulder.position.set(-0.66, 0.32, 0);
    this.chest.add(this.leftShoulder);
    this.leftElbow.position.set(-0.04, -0.4, 0);
    this.leftShoulder.add(this.leftElbow);

    this.rightShoulder.position.set(0.66, 0.32, 0);
    this.chest.add(this.rightShoulder);
    this.rightElbow.position.set(0.04, -0.4, 0);
    this.rightShoulder.add(this.rightElbow);

    this.leftHip.position.set(-0.27, -0.02, 0);
    this.hips.add(this.leftHip);
    this.leftKnee.position.set(0, -0.5, 0);
    this.leftHip.add(this.leftKnee);

    this.rightHip.position.set(0.27, -0.02, 0);
    this.hips.add(this.rightHip);
    this.rightKnee.position.set(0, -0.5, 0);
    this.rightHip.add(this.rightKnee);

    // Waist & utility belt
    this.addOutlined(this.hips, new THREE.BoxGeometry(0.86, 0.28, 0.56), armorDark, [0, 0.04, 0]);
    this.addOutlined(this.hips, new THREE.BoxGeometry(0.26, 0.18, 0.62), crimsonGlow, [0, 0.05, 0.02], [1, 1, 1], [0, 0, 0], false);

    // Broad armored torso + crimson reactor core
    this.addOutlined(this.spine, new THREE.CylinderGeometry(0.42, 0.36, 0.45, 8), armorSlate, [0, 0.18, 0]);
    this.addOutlined(this.chest, new THREE.BoxGeometry(1.16, 0.78, 0.68), armorDark, [0, 0.08, 0]);
    this.addOutlined(this.chest, new THREE.BoxGeometry(0.92, 0.32, 0.74), crimsonTrim, [0, 0.24, 0]);
    this.addOutlined(
      this.chest,
      new THREE.OctahedronGeometry(0.18, 0),
      crimsonGlow,
      [0, 0.12, 0.38],
      [1, 1, 0.6],
      [0, 0, 0],
      false,
    );

    // Spiked heavy shoulder pauldrons
    const pauldronGeo = new THREE.DodecahedronGeometry(0.32, 0);
    const spikeGeo = new THREE.ConeGeometry(0.08, 0.34, 5);
    this.addOutlined(this.leftShoulder, pauldronGeo, armorSlate, [-0.08, 0.08, 0], [1.15, 0.9, 1.05]);
    this.addOutlined(this.leftShoulder, spikeGeo, gunmetal, [-0.26, 0.28, 0], [1, 1, 1], [0, 0, 0.6]);
    this.addOutlined(this.rightShoulder, pauldronGeo, armorSlate, [0.08, 0.08, 0], [1.15, 0.9, 1.05]);
    this.addOutlined(this.rightShoulder, spikeGeo, gunmetal, [0.26, 0.28, 0], [1, 1, 1], [0, 0, -0.6]);

    // Horned cyber-bounty hunter helmet + glowing crimson scanner visor
    this.addOutlined(this.head, new THREE.DodecahedronGeometry(0.42, 1), armorDark, [0, 0.06, 0], [0.98, 1.06, 1.04]);
    this.addOutlined(this.head, new THREE.BoxGeometry(0.68, 0.2, 0.22), gunmetal, [0, 0.1, 0.34]);
    this.visorEye = this.addOutlined(
      this.head,
      new THREE.BoxGeometry(0.58, 0.09, 0.12),
      crimsonGlow,
      [0, 0.1, 0.43],
      [1, 1, 1],
      [0, 0, 0],
      false,
    );
    // Swept-back cyber horns
    const hornGeo = new THREE.ConeGeometry(0.09, 0.52, 6);
    this.addOutlined(this.head, hornGeo, crimsonTrim, [-0.32, 0.42, -0.04], [1, 1, 1], [-0.38, 0, 0.42]);
    this.addOutlined(this.head, hornGeo, crimsonTrim, [0.32, 0.42, -0.04], [1, 1, 1], [-0.38, 0, -0.42]);

    // Articulated armored arms
    const upperArmGeo = new THREE.CapsuleGeometry(0.16, 0.26, 5, 8);
    const foreArmGeo = new THREE.CapsuleGeometry(0.145, 0.24, 5, 8);
    const gauntletGeo = new THREE.BoxGeometry(0.24, 0.24, 0.28);

    this.addOutlined(this.leftShoulder, upperArmGeo, armorDark, [-0.04, -0.2, 0]);
    this.addOutlined(this.leftElbow, foreArmGeo, armorSlate, [0, -0.18, 0]);
    this.addOutlined(this.leftElbow, gauntletGeo, gunmetal, [0, -0.38, 0.04]);

    this.addOutlined(this.rightShoulder, upperArmGeo, armorDark, [0.04, -0.2, 0]);
    this.addOutlined(this.rightElbow, foreArmGeo, armorSlate, [0, -0.18, 0]);
    this.addOutlined(this.rightElbow, gauntletGeo, gunmetal, [0, -0.38, 0.04]);

    // Crackling Crimson Plasma Stun-Baton / Capture Staff in right hand!
    const batonGroup = new THREE.Group();
    batonGroup.position.set(0.04, -0.38, 0.16);
    batonGroup.rotation.set(Math.PI * 0.42, 0, 0);
    this.addOutlined(batonGroup, new THREE.CylinderGeometry(0.055, 0.065, 1.55, 8), gunmetal, [0, 0.55, 0]);
    this.addOutlined(batonGroup, new THREE.CylinderGeometry(0.11, 0.11, 0.42, 8), crimsonGlow, [0, 1.28, 0], [1, 1, 1], [0, 0, 0], false);

    const ringGeo = new THREE.TorusGeometry(0.24, 0.028, 6, 16);
    this.stunRing1 = new THREE.Mesh(ringGeo, crimsonGlow);
    this.stunRing1.position.y = 1.28;
    this.stunRing2 = new THREE.Mesh(ringGeo, crimsonGlow);
    this.stunRing2.position.y = 1.28;
    this.stunRing2.rotation.x = Math.PI / 2;
    batonGroup.add(this.stunRing1, this.stunRing2);
    this.rightElbow.add(batonGroup);

    // Articulated armored legs + rocket thruster boots
    const thighGeo = new THREE.CapsuleGeometry(0.18, 0.3, 5, 8);
    const shinGeo = new THREE.CapsuleGeometry(0.16, 0.28, 5, 8);
    const bootGeo = new THREE.BoxGeometry(0.32, 0.22, 0.52);
    const jetGeo = new THREE.ConeGeometry(0.13, 0.45, 7);

    this.addOutlined(this.leftHip, thighGeo, armorDark, [0, -0.25, 0]);
    this.addOutlined(this.leftKnee, shinGeo, armorSlate, [0, -0.24, 0]);
    this.addOutlined(this.leftKnee, bootGeo, gunmetal, [0, -0.45, 0.1]);
    this.leftJetFlame = new THREE.Mesh(jetGeo, jetMat);
    this.leftJetFlame.position.set(0, -0.58, -0.18);
    this.leftJetFlame.rotation.x = Math.PI * 0.72;
    this.leftKnee.add(this.leftJetFlame);

    this.addOutlined(this.rightHip, thighGeo, armorDark, [0, -0.25, 0]);
    this.addOutlined(this.rightKnee, shinGeo, armorSlate, [0, -0.24, 0]);
    this.addOutlined(this.rightKnee, bootGeo, gunmetal, [0, -0.45, 0.1]);
    this.rightJetFlame = new THREE.Mesh(jetGeo, jetMat);
    this.rightJetFlame.position.set(0, -0.58, -0.18);
    this.rightJetFlame.rotation.x = Math.PI * 0.72;
    this.rightKnee.add(this.rightJetFlame);

    // 2-segment spring-physics tattered dark hunter cape!
    this.capeRoot.position.set(0, 0.36, -0.36);
    this.chest.add(this.capeRoot);
    this.addOutlined(this.capeRoot, new THREE.BoxGeometry(1.12, 0.72, 0.07), capeMat, [0, -0.36, -0.04]);

    this.capeTip.position.set(0, -0.7, -0.04);
    this.capeRoot.add(this.capeTip);
    this.addOutlined(this.capeTip, new THREE.BoxGeometry(0.98, 0.62, 0.06), crimsonTrim, [0, -0.3, -0.02]);
  }

  public startChase(): void {
    this.root.visible = true;
    this.x = 0;
    this.prevX = 0;
    this.y = 0;
    this.z = 3.2;
    this.targetZ = 3.2;
    this.surgeTimer = 4.2; // Dramatic initial pursuit burst right behind the Yeti!
    this.flinchTimer = 0;
    this.capeRootSpring.reset(0.45, 0);
    this.capeTipSpring.reset(0.25, 0);
    this.root.position.set(this.x, 0, this.z);
  }

  public hide(): void {
    this.root.visible = false;
  }

  public triggerSurge(duration = 6.5): void {
    if (!this.root.visible) {
      // Rush back into frame dramatically from behind the camera when player hits an obstacle!
      this.root.visible = true;
      this.z = Math.max(this.z, 9.8);
    }
    this.surgeTimer = Math.max(this.surgeTimer, duration);
    this.batonSwing = 1.0;
    this.capeRootSpring.impulse(4.8, 0);
  }

  public triggerDodgeBack(): void {
    this.flinchTimer = 0.85;
    this.z = Math.min(this.z + 0.9, 6.6);
  }

  public getThreatLevel(): number {
    if (!this.root.visible) return 0;
    return THREE.MathUtils.clamp(1 - (this.z - 2.3) / 3.4, 0, 1);
  }

  public update(params: VillainUpdateParams): void {
    const {
      dt,
      elapsed,
      playerX,
      playerY,
      isPlayerSliding,
      isPlayerFlying,
      isChasing,
      speedRatio,
      isGameOver,
      isMenuPreview,
    } = params;

    if (isMenuPreview) {
      this.root.visible = false;
      return;
    }

    if (this.surgeTimer > 0) this.surgeTimer = Math.max(0, this.surgeTimer - dt);
    if (this.flinchTimer > 0) this.flinchTimer = Math.max(0, this.flinchTimer - dt);
    if (this.batonSwing > 0) this.batonSwing = Math.max(0, this.batonSwing - dt * 1.6);

    // If outrun cleanly (not chasing & not game over), smoothly drop behind the camera and stay hidden until next hit!
    if (!isChasing && !isGameOver) {
      if (!this.root.visible) return;
      this.targetZ = 15.2;
      this.z = THREE.MathUtils.damp(this.z, this.targetZ, 2.2, dt);
      this.root.position.set(this.x, 0, this.z);
      if (this.z > 13.4) {
        this.root.visible = false;
        return;
      }
    } else {
      this.root.visible = true;
      if (isGameOver) {
        this.targetZ = 1.55;
      } else if (isPlayerFlying) {
        this.targetZ = 5.6;
      } else if (this.flinchTimer > 0) {
        this.targetZ = 5.4;
      } else if (this.surgeTimer > 0) {
        this.targetZ = 2.45 + Math.sin(elapsed * 4.5) * 0.22;
      } else {
        this.targetZ = 4.45 + Math.sin(elapsed * 1.4) * 0.35;
      }

      const zRate = isGameOver ? 6.5 : this.surgeTimer > 0 ? 5.2 : 2.6;
      this.z = THREE.MathUtils.damp(this.z, this.targetZ, zRate, dt);
    }

    // Track Yeti's lane with chase inertia
    this.prevX = this.x;
    const chaseXTarget = isGameOver ? playerX + 0.95 : playerX;
    this.x = THREE.MathUtils.damp(this.x, chaseXTarget, isGameOver ? 6 : 8.8, dt);
    const vx = (this.x - this.prevX) / Math.max(dt, 0.004);

    // Vertical pursuit: rocket-hops when player jumps, hovers low when player flies
    const targetY = isGameOver
      ? 0
      : isPlayerFlying
        ? 1.1 + Math.sin(elapsed * 6.5) * 0.25
        : playerY > 0.4
          ? Math.min(playerY * 0.78, 2.6)
          : 0;
    this.y = THREE.MathUtils.damp(this.y, targetY, 10, dt);

    this.root.position.set(this.x, 0, this.z);
    this.bodyPivot.position.y = this.y;

    // Contact shadow grounding
    const shadowScale = Math.max(0.35, 1 - this.y * 0.14);
    this.contactShadow.scale.setScalar(shadowScale);
    (this.contactShadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.12, 0.6 - this.y * 0.1);

    // Lean & bank into lane switches
    const targetRoll = THREE.MathUtils.clamp(-vx * 0.036, -0.42, 0.42);
    const targetPitch = isGameOver
      ? 0.05
      : isPlayerSliding && this.y < 0.2
        ? 0.42
        : 0.16 + speedRatio * 0.1;
    this.bodyPivot.rotation.z = THREE.MathUtils.damp(this.bodyPivot.rotation.z, targetRoll, 12, dt);
    this.bodyPivot.rotation.x = THREE.MathUtils.damp(this.bodyPivot.rotation.x, targetPitch, 12, dt);
    const targetScaleY = !isGameOver && isPlayerSliding && this.y < 0.2 ? 0.62 : 1.0;
    this.bodyPivot.scale.set(
      1,
      THREE.MathUtils.damp(this.bodyPivot.scale.y, targetScaleY, 14, dt),
      1,
    );

    // Spin electric rings on capture baton & pulse visor
    this.stunRing1.rotation.z = elapsed * 8.5;
    this.stunRing1.rotation.y = elapsed * 5.2;
    this.stunRing2.rotation.x = elapsed * 7.2;
    this.stunRing2.rotation.y = -elapsed * 6.4;
    this.visorEye.scale.x = 0.94 + Math.sin(elapsed * 9) * 0.08;

    // Thruster flames active during surge, jumps, or flight chase
    const jetsActive = !isGameOver && (this.surgeTimer > 0 || this.y > 0.22 || isPlayerFlying);
    this.leftJetFlame.visible = jetsActive;
    this.rightJetFlame.visible = jetsActive;
    if (jetsActive) {
      const flicker = 0.85 + Math.sin(elapsed * 42) * 0.28;
      this.leftJetFlame.scale.set(1, flicker, 1);
      this.rightJetFlame.scale.set(1, 1.8 - flicker, 1);
    }

    // Limb articulation: victory capture pose vs aggressive sprint/hover chase
    if (isGameOver) {
      const triumph = Math.sin(elapsed * 3.5);
      this.hips.position.y = 1.05 + triumph * 0.03;
      this.hips.rotation.set(0, -0.35, 0);
      this.spine.rotation.set(-0.08, 0, 0);
      this.chest.rotation.set(0, 0.25, 0);
      this.head.rotation.set(0.12, -0.25, 0);

      // Right arm raises glowing stun-baton high in victory!
      this.rightShoulder.rotation.set(-2.45 + triumph * 0.14, 0, -0.32);
      this.rightElbow.rotation.x = -0.35;
      this.leftShoulder.rotation.set(-0.4, 0, 0.45);
      this.leftElbow.rotation.x = -0.85;

      this.leftHip.rotation.x = -0.15;
      this.leftKnee.rotation.x = 0.25;
      this.rightHip.rotation.x = 0.15;
      this.rightKnee.rotation.x = 0.2;
    } else if (isPlayerFlying || this.y > 0.35) {
      // Rocket-boot aerial pursuit stance
      this.hips.position.y = 1.05;
      this.hips.rotation.set(0, 0, 0);
      this.spine.rotation.set(0.26, 0, 0);
      this.chest.rotation.set(0.1, 0, 0);
      this.head.rotation.set(-0.28, 0, 0);

      this.leftShoulder.rotation.set(0.65, 0, 0.45);
      this.leftElbow.rotation.x = -0.3;
      this.rightShoulder.rotation.set(-1.35 + Math.sin(elapsed * 10) * 0.28, 0, -0.35);
      this.rightElbow.rotation.x = -0.5;

      this.leftHip.rotation.x = 0.35;
      this.leftKnee.rotation.x = 0.45;
      this.rightHip.rotation.x = -0.25;
      this.rightKnee.rotation.x = 0.65;
    } else {
      // Heavy, pounding pursuit sprint!
      const strideFreq = 11.8 + speedRatio * 6.5 + (this.surgeTimer > 0 ? 2.8 : 0);
      this.runCycle += dt * strideFreq;
      const ph = this.runCycle;
      const sL = Math.sin(ph);
      const sR = Math.sin(ph + Math.PI);
      const cL = Math.cos(ph);
      const cR = Math.cos(ph + Math.PI);
      const bounce = Math.abs(Math.cos(ph));

      this.hips.position.y = 0.98 + bounce * 0.16;
      this.hips.rotation.set(0, sL * 0.18, sL * 0.06);
      this.spine.rotation.set(0.22 + speedRatio * 0.12, -sL * 0.16, 0);
      this.chest.rotation.set(0, -sL * 0.15, 0);
      this.head.rotation.set(-0.18, sL * 0.12, 0);

      this.leftHip.rotation.x = sL * 0.98 - 0.1;
      this.leftKnee.rotation.x = Math.max(0.1, -cL * 1.15 + 0.35);
      this.rightHip.rotation.x = sR * 0.98 - 0.1;
      this.rightKnee.rotation.x = Math.max(0.1, -cR * 1.15 + 0.35);

      this.leftShoulder.rotation.set(sR * 0.98, 0, 0.2);
      this.leftElbow.rotation.x = -0.75 - Math.max(0, -sR) * 0.5;

      // Right arm brandishes & swings the crackling stun-baton forward when surging!
      const threatSwing = this.surgeTimer > 0 ? Math.sin(elapsed * 11) * 0.55 : sL * 0.35;
      this.rightShoulder.rotation.set(-1.35 + threatSwing - this.batonSwing * 0.7, 0, -0.32);
      this.rightElbow.rotation.x = -0.55 + Math.sin(elapsed * 11) * 0.2;
    }

    // Step dampened harmonic oscillators for hunter's cape!
    const capeTargetPitch = isGameOver ? 0.12 : 0.58 + speedRatio * 0.45 + (this.surgeTimer > 0 ? 0.24 : 0);
    const capeTargetRoll = THREE.MathUtils.clamp(-vx * 0.045, -0.6, 0.6);
    const rootP = this.capeRootSpring.pitch.step(capeTargetPitch, dt, 0, -0.2, 1.4);
    const rootR = this.capeRootSpring.roll.step(capeTargetRoll, dt, 0, -0.8, 0.8);
    const tipP = this.capeTipSpring.pitch.step(
      rootP * 0.55 + Math.sin(elapsed * 14) * 0.14,
      dt,
      -this.capeRootSpring.pitch.velocity * 1.35,
      -0.6,
      1.1,
    );
    const tipR = this.capeTipSpring.roll.step(
      rootR * 0.65,
      dt,
      -this.capeRootSpring.roll.velocity * 1.4,
      -0.9,
      0.9,
    );

    this.capeRoot.rotation.set(rootP, 0, rootR);
    this.capeTip.rotation.set(tipP, 0, tipR);
  }

  public dispose(): void {
    this.toonGradient.dispose();
    this.inkOutlineMat.dispose();
    this.root.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m) => m?.dispose());
      }
    });
  }
}
