import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { YETI_MODEL_URL, getCharacterById } from './config';
import { AccessorySpringController, type AccessoryPhysicsState } from './springPhysics';
import { BladeRibbonTrail, buildSignatureSword, type SignatureSwordRig } from './swordSystem';
import { createRadialShadowTexture } from './textures';
import type { CharacterConfig, CharacterId } from './types';

export type YetiAnimState = 'idle' | 'run' | 'jump' | 'slide' | 'flip' | 'fly' | 'hit' | 'slash';

export interface YetiMotionParams {
  dt: number;
  elapsed: number;
  state: YetiAnimState;
  speedRatio: number;
  forwardSpeed: number;
  laneVelocity: number;
  yPos: number;
  velocityY: number;
  flipProgress: number;
  spinProgress: number;
  slashProgress: number;
  slashComboIndex: number; // 0 = forehand cleave, 1 = reverse backhand slash, 2 = 360 whirlwind spin cleave
  stumbleProgress: number;
  flyBarrelProgress: number; // 0..1 during aerial barrel roll
  flyBarrelDir: number; // -1 left, +1 right
  flyLoopProgress: number; // 0..1 during sky loop-de-loop
  flySwoopProgress: number; // 0..1 during low dive swoop
  swordActive: boolean;
  starActive: boolean;
  shieldActive: boolean;
  invulnerable: boolean;
  invulnTimer: number;
  isMenuPreview: boolean;
}

const CLIP_NAMES = ['run', 'jump', 'slide', 'flip', 'fly', 'hit', 'slash'] as const;

interface ArticulatedJoints {
  hips: THREE.Group;
  spine: THREE.Group;
  chest: THREE.Group;
  head: THREE.Group;
  leftShoulder: THREE.Group;
  leftElbow: THREE.Group;
  rightShoulder: THREE.Group;
  rightElbow: THREE.Group;
  leftHip: THREE.Group;
  leftKnee: THREE.Group;
  rightHip: THREE.Group;
  rightKnee: THREE.Group;
  backAccessory: THREE.Group;
  // Spring-driven articulated accessory pivots
  leftEarPivot: THREE.Group;
  rightEarPivot: THREE.Group;
  leftPouchPivot: THREE.Group;
  rightPouchPivot: THREE.Group;
  pendantPivot: THREE.Group;
  tailRootPivot: THREE.Group;
  tailTipPivot: THREE.Group;
  flames: THREE.Object3D[];
  gears: THREE.Object3D[];
  slimeShells: THREE.Object3D[];
  crescents: THREE.Object3D[];
}

function createToonGradientTexture(): THREE.DataTexture {
  const data = new Uint8Array([102, 188, 255]);
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Lofi & Mystic Yetis 5-Character Controller.
 * Features sculpted toon-outlined 3D anatomy, 2-segment articulated limbs,
 * dedicated 2nd-order secondary motion springs for limbs & accessories,
 * unique character idles/stunts, aerial flight stunts, and forehand/backhand sword slashes.
 */
export class YetiController {
  public readonly root = new THREE.Group();
  public readonly bodyPivot = new THREE.Group();
  public readonly contactShadow: THREE.Mesh;
  public readonly swordTrailMesh: THREE.Mesh;

  private toonGradient: THREE.DataTexture;
  private inkOutlineMat: THREE.MeshBasicMaterial;
  private flameOutlineMat: THREE.MeshBasicMaterial;
  private slimeOutlineMat: THREE.MeshBasicMaterial;

  private proceduralRoot = new THREE.Group();
  private characterContainer = new THREE.Group();
  private glbGroup: THREE.Group | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private activeActionKey: string | null = null;
  private usingGlb = false;

  private joints!: ArticulatedJoints;
  private currentChar: CharacterConfig;

  // Signature 3D Sword + Live World-Space Ribbon Trail + Power-up VFX
  private swordGroup = new THREE.Group();
  private signatureSword: SignatureSwordRig | null = null;
  private bladeTrail = new BladeRibbonTrail();
  private slashArcMesh!: THREE.Mesh;
  private slashArcMat!: THREE.MeshBasicMaterial;
  private slashArcSecondary!: THREE.Mesh; // Second X-cross arc for Void Shadow & power slashes
  private starAuraGroup = new THREE.Group();
  private starRing1!: THREE.Mesh;
  private starRing2!: THREE.Mesh;
  private spinRingMesh!: THREE.Mesh;
  private spinRingMat!: THREE.MeshBasicMaterial;
  private voidShieldMesh!: THREE.Mesh;

  // Dedicated Dampened Harmonic Oscillator physics controller for ear flaps, pouches, pendant & tail/cape
  private springPhysics = new AccessorySpringController();

  private runCycle = 0;
  private emoteTimer = 0;
  private wasGrounded = true;
  private lastVelocityY = 0;

  constructor(
    initialChar: CharacterId,
    onSourceChange?: (src: 'procedural' | 'glb') => void,
  ) {
    this.currentChar = getCharacterById(initialChar);
    this.swordTrailMesh = this.bladeTrail.mesh;
    this.root.add(this.bodyPivot);

    this.toonGradient = createToonGradientTexture();
    this.inkOutlineMat = new THREE.MeshBasicMaterial({
      color: 0x090c14,
      side: THREE.BackSide,
    });
    this.flameOutlineMat = new THREE.MeshBasicMaterial({
      color: 0x991b1b,
      side: THREE.BackSide,
    });
    this.slimeOutlineMat = new THREE.MeshBasicMaterial({
      color: 0x14532d,
      side: THREE.BackSide,
    });

    const shadowTex = createRadialShadowTexture();
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.56,
    });
    this.contactShadow = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), shadowMat);
    this.contactShadow.rotation.x = -Math.PI / 2;
    this.contactShadow.position.y = 0.03;
    this.root.add(this.contactShadow);

    this.proceduralRoot.rotation.y = Math.PI;
    this.proceduralRoot.add(this.characterContainer);
    this.bodyPivot.add(this.proceduralRoot);

    this.buildPowerupEffects();
    this.springPhysics.configureForCharacter(this.currentChar.id);
    this.rebuildCharacter(this.currentChar.id);

    void this.tryLoadGlbModel(onSourceChange);
  }

  public isUsingGlb(): boolean {
    return this.usingGlb;
  }

  public getCharacter(): CharacterConfig {
    return this.currentChar;
  }

  public triggerLandingImpact(impactSpeed = 14): void {
    this.springPhysics.onLandingImpact(impactSpeed);
  }

  public triggerJumpLaunch(isDoubleJump = false): void {
    this.springPhysics.onJumpLaunch(isDoubleJump);
  }

  public triggerSlideDrop(): void {
    this.springPhysics.onSlideDrop();
  }

  public triggerLaneSnap(dir: number): void {
    this.springPhysics.onLaneSnap(dir);
  }

  public triggerSlashImpact(): void {
    this.springPhysics.onSlashImpact();
  }

  public triggerFlightStuntImpulse(dir = 1): void {
    this.springPhysics.onFlightStunt(dir);
  }

  public triggerEmote(): void {
    this.emoteTimer = 0.78;
    this.springPhysics.onJumpLaunch(false);
  }

  public setCharacter(charId: CharacterId, playEmote = false): void {
    const next = getCharacterById(charId);
    if (this.currentChar.id !== next.id || !this.joints) {
      this.currentChar = next;
      this.springPhysics.configureForCharacter(next.id);
      this.rebuildCharacter(next.id);
      this.syncAccentColors();
    }
    if (playEmote) {
      this.triggerEmote();
    }
  }

  public clearSwordTrail(): void {
    this.bladeTrail.clear();
  }

  private syncAccentColors(): void {
    if (this.signatureSword) {
      this.bladeTrail.setColors(this.signatureSword.trailColor, this.signatureSword.trailTipColor);
    }
    if (this.slashArcMat) {
      this.slashArcMat.color.setHex(this.currentChar.slashColor);
    }
    if (this.spinRingMat) {
      this.spinRingMat.color.setHex(this.currentChar.accentColor);
    }

    if (this.glbGroup) {
      const tint = new THREE.Color(this.currentChar.primaryHex);
      this.glbGroup.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mat = (child as THREE.Mesh).material;
          if (mat && 'color' in mat && mat.color instanceof THREE.Color) {
            mat.color.copy(tint);
          }
        }
      });
    }
  }

  private toon(
    color: number,
    options?: {
      emissive?: number;
      emissiveIntensity?: number;
      transparent?: boolean;
      opacity?: number;
      depthWrite?: boolean;
    },
  ): THREE.MeshToonMaterial {
    return new THREE.MeshToonMaterial({
      color,
      gradientMap: this.toonGradient,
      emissive: options?.emissive ?? 0x000000,
      emissiveIntensity: options?.emissiveIntensity ?? 0,
      transparent: options?.transparent ?? false,
      opacity: options?.opacity ?? 1,
      depthWrite: options?.depthWrite ?? true,
    });
  }

  private addOutlined(
    parent: THREE.Object3D,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    pos: [number, number, number] = [0, 0, 0],
    scale: [number, number, number] = [1, 1, 1],
    rot: [number, number, number] = [0, 0, 0],
    outlineMat: THREE.Material | null = this.inkOutlineMat,
    outlineScale = 1.075,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.scale.set(scale[0], scale[1], scale[2]);
    mesh.rotation.set(rot[0], rot[1], rot[2]);
    mesh.castShadow = true;

    if (outlineMat) {
      const outline = new THREE.Mesh(geo, outlineMat);
      outline.scale.setScalar(outlineScale);
      mesh.add(outline);
    }

    parent.add(mesh);
    return mesh;
  }

  private disposeSignatureSword(): void {
    if (!this.signatureSword) return;
    this.signatureSword.group.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        if (mesh.material !== this.inkOutlineMat) {
          mesh.geometry?.dispose();
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          mats.forEach((m) => m?.dispose());
        }
      }
    });
    this.swordGroup.clear();
    this.signatureSword = null;
  }

  private disposeContainer(): void {
    if (this.swordGroup.parent) {
      this.swordGroup.parent.remove(this.swordGroup);
    }
    this.disposeSignatureSword();
    this.characterContainer.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        if (
          mesh.material !== this.inkOutlineMat &&
          mesh.material !== this.flameOutlineMat &&
          mesh.material !== this.slimeOutlineMat
        ) {
          mesh.geometry?.dispose();
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          mats.forEach((m) => m?.dispose());
        }
      }
    });
    this.characterContainer.clear();
  }

  private createEmptySkeleton(): ArticulatedJoints {
    const hips = new THREE.Group();
    hips.position.y = 0.94;
    this.characterContainer.add(hips);

    const spine = new THREE.Group();
    spine.position.y = 0.14;
    hips.add(spine);

    const chest = new THREE.Group();
    chest.position.y = 0.42;
    spine.add(chest);

    const head = new THREE.Group();
    head.position.set(0, 0.62, 0.03);
    chest.add(head);

    const leftShoulder = new THREE.Group();
    leftShoulder.position.set(-0.56, 0.28, 0);
    chest.add(leftShoulder);

    const leftElbow = new THREE.Group();
    leftElbow.position.set(-0.04, -0.36, 0);
    leftShoulder.add(leftElbow);

    const rightShoulder = new THREE.Group();
    rightShoulder.position.set(0.56, 0.28, 0);
    chest.add(rightShoulder);

    const rightElbow = new THREE.Group();
    rightElbow.position.set(0.04, -0.36, 0);
    rightShoulder.add(rightElbow);

    const leftHip = new THREE.Group();
    leftHip.position.set(-0.24, -0.02, 0);
    hips.add(leftHip);

    const leftKnee = new THREE.Group();
    leftKnee.position.set(0, -0.44, 0);
    leftHip.add(leftKnee);

    const rightHip = new THREE.Group();
    rightHip.position.set(0.24, -0.02, 0);
    hips.add(rightHip);

    const rightKnee = new THREE.Group();
    rightKnee.position.set(0, -0.44, 0);
    rightHip.add(rightKnee);

    const backAccessory = new THREE.Group();
    backAccessory.position.set(0, 0.15, -0.42);
    chest.add(backAccessory);

    // Spring-driven Ear Flap pivots (attached to sides of head)
    const leftEarPivot = new THREE.Group();
    leftEarPivot.position.set(-0.46, 0.1, 0);
    head.add(leftEarPivot);

    const rightEarPivot = new THREE.Group();
    rightEarPivot.position.set(0.46, 0.1, 0);
    head.add(rightEarPivot);

    // Spring-driven Hip Pouch pivots (attached to left & right waist)
    const leftPouchPivot = new THREE.Group();
    leftPouchPivot.position.set(-0.46, 0.08, 0.08);
    hips.add(leftPouchPivot);

    const rightPouchPivot = new THREE.Group();
    rightPouchPivot.position.set(0.46, 0.08, 0.08);
    hips.add(rightPouchPivot);

    // Spring-driven Chest Medallion / Pendant pivot
    const pendantPivot = new THREE.Group();
    pendantPivot.position.set(0, 0.18, 0.45);
    chest.add(pendantPivot);

    // Coupled 2-link Tail / Cape pivots (Root -> Tip)
    const tailRootPivot = new THREE.Group();
    tailRootPivot.position.set(0, -0.22, -0.04);
    backAccessory.add(tailRootPivot);

    const tailTipPivot = new THREE.Group();
    tailTipPivot.position.set(0, -0.34, -0.18);
    tailRootPivot.add(tailTipPivot);

    this.swordGroup.position.set(0.04, -0.34, 0.14);
    this.swordGroup.rotation.set(Math.PI * 0.44, 0, 0);
    rightElbow.add(this.swordGroup);

    return {
      hips,
      spine,
      chest,
      head,
      leftShoulder,
      leftElbow,
      rightShoulder,
      rightElbow,
      leftHip,
      leftKnee,
      rightHip,
      rightKnee,
      backAccessory,
      leftEarPivot,
      rightEarPivot,
      leftPouchPivot,
      rightPouchPivot,
      pendantPivot,
      tailRootPivot,
      tailTipPivot,
      flames: [],
      gears: [],
      slimeShells: [],
      crescents: [],
    };
  }

  private rebuildCharacter(id: CharacterId): void {
    this.disposeContainer();
    const j = this.createEmptySkeleton();
    this.joints = j;

    if (id === 'og_lofi') this.buildOgLofi(j);
    else if (id === 'inferno_blaze') this.buildInfernoBlaze(j);
    else if (id === 'neon_slime') this.buildNeonSlime(j);
    else if (id === 'half_cyborg') this.buildHalfCyborg(j);
    else this.buildVoidShadow(j);

    // Mount this Yeti's bespoke multi-part Signature 3D Sword onto rightElbow
    this.signatureSword = buildSignatureSword(id, this.toonGradient, this.inkOutlineMat);
    this.swordGroup.add(this.signatureSword.group);
    this.bladeTrail.clear();
    this.syncAccentColors();
  }

  private buildOgLofi(j: ArticulatedJoints): void {
    const fur = this.toon(0xf6f9fc);
    const blueSkin = this.toon(0x5c9ce6);
    const muzzle = this.toon(0xdbe3ec);
    const horn = this.toon(0x4b89d6);
    const whiteEye = this.toon(0xffffff);
    const pupil = this.toon(0x0b0f19);
    const gold = new THREE.MeshStandardMaterial({ color: 0xfacc15, metalness: 0.88, roughness: 0.2 });
    const chainMat = new THREE.MeshStandardMaterial({ color: 0xbae6fd, metalness: 0.9, roughness: 0.18 });

    this.addOutlined(j.spine, new THREE.SphereGeometry(0.45, 14, 12), fur, [0, 0.1, 0], [1.06, 0.9, 0.92]);
    this.addOutlined(j.chest, new THREE.CapsuleGeometry(0.44, 0.26, 6, 14), fur, [0, 0.04, 0], [1.14, 1.0, 0.96]);

    const tuftGeo = new THREE.ConeGeometry(0.14, 0.3, 6);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      this.addOutlined(
        j.chest,
        tuftGeo,
        fur,
        [Math.sin(a) * 0.44, 0.36, Math.cos(a) * 0.38],
        [1, 1, 1],
        [Math.cos(a) * 0.45, 0, -Math.sin(a) * 0.45],
      );
    }

    // Swinging iced SUI medallion on spring pendantPivot
    const chain = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.032, 8, 22), chainMat);
    chain.position.set(0, 0.2, 0.22);
    chain.rotation.x = Math.PI * 0.42;
    j.chest.add(chain);
    this.addOutlined(
      j.pendantPivot,
      new THREE.CylinderGeometry(0.14, 0.14, 0.05, 16),
      chainMat,
      [0, -0.2, 0.02],
      [1, 1, 1],
      [Math.PI / 2, 0, 0],
    );

    this.addOutlined(j.head, new THREE.DodecahedronGeometry(0.48, 2), fur, [0, 0.04, 0], [1.08, 1.0, 0.96]);
    const spikeOffsets: [number, number, number, number][] = [
      [-0.18, 0.44, 0.05, 0.28],
      [-0.04, 0.5, 0.04, 0.06],
      [0.12, 0.47, 0.04, -0.18],
      [0.24, 0.4, 0.0, -0.35],
      [-0.36, 0.26, -0.06, 0.65],
      [0.36, 0.26, -0.06, -0.65],
    ];
    for (const [sx, sy, sz, rz] of spikeOffsets) {
      this.addOutlined(j.head, tuftGeo, fur, [sx, sy, sz], [0.85, 0.95, 0.85], [0.1, 0, rz]);
    }

    const hornGeo = new THREE.ConeGeometry(0.08, 0.28, 8);
    this.addOutlined(j.head, hornGeo, horn, [-0.26, 0.46, 0.12], [1, 1, 1], [0.15, 0, 0.28]);
    this.addOutlined(j.head, hornGeo, horn, [0.26, 0.46, 0.12], [1, 1, 1], [0.15, 0, -0.28]);

    // Spring-driven articulated glacier-blue Ear Flaps with plush fur tips!
    const earFlapGeo = new THREE.CapsuleGeometry(0.11, 0.22, 5, 10);
    this.addOutlined(j.leftEarPivot, earFlapGeo, blueSkin, [-0.1, -0.1, 0], [0.7, 1.05, 0.72], [0, 0, 0.35]);
    this.addOutlined(j.leftEarPivot, new THREE.SphereGeometry(0.09, 8, 8), fur, [-0.16, -0.24, 0]);
    this.addOutlined(j.rightEarPivot, earFlapGeo, blueSkin, [0.1, -0.1, 0], [0.7, 1.05, 0.72], [0, 0, -0.35]);
    this.addOutlined(j.rightEarPivot, new THREE.SphereGeometry(0.09, 8, 8), fur, [0.16, -0.24, 0]);

    // Spring-driven Hip Utility Pouches (streetwear SUI pouches with gold clasps)
    const pouchMat = this.toon(0x1d4ed8);
    const pouchGeo = new THREE.BoxGeometry(0.22, 0.28, 0.24);
    const claspGeo = new THREE.BoxGeometry(0.1, 0.08, 0.27);
    this.addOutlined(j.leftPouchPivot, pouchGeo, pouchMat, [-0.08, -0.14, 0]);
    this.addOutlined(j.leftPouchPivot, claspGeo, gold, [-0.08, -0.06, 0], [1, 1, 1], [0, 0, 0], null);
    this.addOutlined(j.rightPouchPivot, pouchGeo, pouchMat, [0.08, -0.14, 0]);
    this.addOutlined(j.rightPouchPivot, claspGeo, gold, [0.08, -0.06, 0], [1, 1, 1], [0, 0, 0], null);

    this.addOutlined(j.head, new THREE.BoxGeometry(0.62, 0.28, 0.24), blueSkin, [0, 0.11, 0.37], [1, 1, 1], [0, 0, 0], this.inkOutlineMat, 1.05);
    this.addOutlined(j.head, new THREE.SphereGeometry(0.34, 14, 12), muzzle, [0, -0.11, 0.33], [1.08, 0.76, 0.74], [0, 0, 0], this.inkOutlineMat, 1.05);

    const eyeGeo = new THREE.SphereGeometry(0.12, 12, 10);
    this.addOutlined(j.head, eyeGeo, whiteEye, [-0.15, 0.11, 0.46], [1.28, 0.76, 0.48], [0, 0, 0], this.inkOutlineMat, 1.08);
    this.addOutlined(j.head, eyeGeo, whiteEye, [0.15, 0.11, 0.46], [1.28, 0.76, 0.48], [0, 0, 0], this.inkOutlineMat, 1.08);

    const pupilGeo = new THREE.SphereGeometry(0.072, 10, 10);
    this.addOutlined(j.head, pupilGeo, pupil, [-0.14, 0.105, 0.515], [1, 0.9, 0.45], [0, 0, 0], null);
    this.addOutlined(j.head, pupilGeo, pupil, [0.14, 0.105, 0.515], [1, 0.9, 0.45], [0, 0, 0], null);

    const dotGeo = new THREE.SphereGeometry(0.022, 6, 6);
    this.addOutlined(j.head, dotGeo, whiteEye, [-0.11, 0.135, 0.545], [1, 1, 1], [0, 0, 0], null);
    this.addOutlined(j.head, dotGeo, whiteEye, [0.17, 0.135, 0.545], [1, 1, 1], [0, 0, 0], null);

    const lidGeo = new THREE.BoxGeometry(0.3, 0.055, 0.14);
    this.addOutlined(j.head, lidGeo, blueSkin, [-0.15, 0.185, 0.46], [1, 1, 1], [0, 0, 0.06], this.inkOutlineMat, 1.06);
    this.addOutlined(j.head, lidGeo, blueSkin, [0.15, 0.185, 0.46], [1, 1, 1], [0, 0, -0.06], this.inkOutlineMat, 1.06);

    this.addOutlined(j.head, new THREE.SphereGeometry(0.08, 10, 8), blueSkin, [0, -0.01, 0.54], [1.25, 0.82, 0.78]);
    this.addOutlined(j.head, new THREE.CapsuleGeometry(0.068, 0.38, 6, 10), blueSkin, [0, -0.17, 0.51], [1, 1, 0.65], [0, 0, Math.PI / 2]);
    this.addOutlined(j.head, new THREE.BoxGeometry(0.065, 0.06, 0.05), gold, [0.07, -0.17, 0.55], [1, 1, 1], [0, 0, 0], null);

    // Coupled 2-segment spring-driven shaggy Yeti Tail!
    this.addOutlined(j.tailRootPivot, new THREE.CapsuleGeometry(0.15, 0.24, 5, 8), fur, [0, -0.12, -0.1], [1, 1, 1], [-0.85, 0, 0]);
    this.addOutlined(j.tailTipPivot, new THREE.ConeGeometry(0.17, 0.42, 8), fur, [0, -0.04, -0.16], [1, 1, 1], [-Math.PI * 0.62, 0, 0]);

    this.buildArticulatedLimbs(j, fur, fur, blueSkin, blueSkin, this.inkOutlineMat);
  }

  private buildInfernoBlaze(j: ArticulatedJoints): void {
    const flameOrange = this.toon(0xf97316, { emissive: 0xc2410c, emissiveIntensity: 0.35 });
    const flameGold = this.toon(0xfacc15, { emissive: 0xf59e0b, emissiveIntensity: 0.55 });
    const flameCore = this.toon(0xfef08a, { emissive: 0xfde047, emissiveIntensity: 0.75 });
    const emberLimb = this.toon(0xea580c, { emissive: 0x9a3412, emissiveIntensity: 0.3 });
    const teethMat = this.toon(0xfef9c3);

    this.addOutlined(j.spine, new THREE.SphereGeometry(0.44, 14, 12), emberLimb, [0, 0.1, 0], [1.05, 0.9, 0.92], [0, 0, 0], this.flameOutlineMat);
    this.addOutlined(j.chest, new THREE.CapsuleGeometry(0.45, 0.28, 6, 14), flameOrange, [0, 0.04, 0], [1.16, 1.0, 0.96], [0, 0, 0], this.flameOutlineMat);

    const tongueGeo = new THREE.ConeGeometry(0.18, 0.52, 6);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const f = this.addOutlined(
        j.chest,
        tongueGeo,
        i % 2 === 0 ? flameGold : flameOrange,
        [Math.sin(a) * 0.46, 0.42, Math.cos(a) * 0.38],
        [1, 1.15, 1],
        [0, a, -Math.sin(a) * 0.2],
        this.flameOutlineMat,
      );
      j.flames.push(f);
    }

    this.addOutlined(j.head, new THREE.DodecahedronGeometry(0.47, 2), flameOrange, [0, 0.04, 0], [1.06, 1.02, 0.96], [0, 0, 0], this.flameOutlineMat);

    const crownGeo = new THREE.ConeGeometry(0.22, 0.78, 7);
    const crownSpecs: [number, number, number, number, number][] = [
      [0, 0.62, -0.02, 1.15, 0],
      [-0.24, 0.54, 0.04, 0.95, 0.22],
      [0.24, 0.54, 0.04, 0.95, -0.22],
      [-0.14, 0.56, -0.18, 1.05, 0.12],
      [0.14, 0.56, -0.18, 1.05, -0.12],
    ];
    for (const [x, y, z, s, rz] of crownSpecs) {
      const plume = this.addOutlined(j.head, crownGeo, flameGold, [x, y, z], [s, s * 1.15, s], [-0.12, 0, rz], this.flameOutlineMat);
      j.flames.push(plume);
    }

    // Spring-driven flaming Ear Flaps
    this.addOutlined(j.leftEarPivot, new THREE.CapsuleGeometry(0.1, 0.2, 5, 8), flameOrange, [-0.08, -0.08, 0], [0.7, 1.0, 0.75], [0, 0, 0.32], this.flameOutlineMat);
    this.addOutlined(j.rightEarPivot, new THREE.CapsuleGeometry(0.1, 0.2, 5, 8), flameOrange, [0.08, -0.08, 0], [0.7, 1.0, 0.75], [0, 0, -0.32], this.flameOutlineMat);

    // Spring-driven Ember Fuel Canisters on hips + swinging solar charm
    const canisterGeo = new THREE.CylinderGeometry(0.1, 0.11, 0.28, 8);
    this.addOutlined(j.leftPouchPivot, canisterGeo, emberLimb, [-0.08, -0.14, 0], [1, 1, 1], [0, 0, 0.15], this.flameOutlineMat);
    this.addOutlined(j.rightPouchPivot, canisterGeo, emberLimb, [0.08, -0.14, 0], [1, 1, 1], [0, 0, -0.15], this.flameOutlineMat);
    this.addOutlined(j.pendantPivot, new THREE.OctahedronGeometry(0.13, 0), flameCore, [0, -0.18, 0.02], [1, 1.2, 0.7], [0, 0, 0], this.flameOutlineMat);

    const browGeo = new THREE.BoxGeometry(0.26, 0.075, 0.12);
    this.addOutlined(j.head, browGeo, flameCore, [-0.15, 0.17, 0.45], [1, 1, 1], [0, 0, -0.22], this.flameOutlineMat);
    this.addOutlined(j.head, browGeo, flameCore, [0.15, 0.17, 0.45], [1, 1, 1], [0, 0, 0.22], this.flameOutlineMat);

    this.addOutlined(j.head, new THREE.BoxGeometry(0.52, 0.16, 0.18), teethMat, [0, -0.06, 0.44], [1, 1, 1], [0, 0, 0], this.flameOutlineMat, 1.06);
    this.addOutlined(j.head, new THREE.CapsuleGeometry(0.045, 0.44, 6, 8), flameGold, [0, 0.03, 0.51], [1, 1, 0.7], [0, 0, Math.PI / 2], this.flameOutlineMat);
    this.addOutlined(j.head, new THREE.CapsuleGeometry(0.045, 0.44, 6, 8), flameGold, [0, -0.15, 0.51], [1, 1, 0.7], [0, 0, Math.PI / 2], this.flameOutlineMat);

    const stacheGeo = new THREE.ConeGeometry(0.11, 0.34, 6);
    this.addOutlined(j.head, stacheGeo, flameCore, [-0.22, -0.12, 0.48], [1, 1, 0.7], [0, 0, 1.25], this.flameOutlineMat);
    this.addOutlined(j.head, stacheGeo, flameCore, [0.22, -0.12, 0.48], [1, 1, 0.7], [0, 0, -1.25], this.flameOutlineMat);
    const beard = this.addOutlined(j.head, new THREE.ConeGeometry(0.2, 0.36, 6), flameGold, [0, -0.34, 0.36], [1.2, 1, 0.7], [Math.PI, 0, 0], this.flameOutlineMat);
    j.flames.push(beard);

    // Coupled 2-segment roaring Flame Tail!
    const rootFlame = this.addOutlined(j.tailRootPivot, new THREE.ConeGeometry(0.2, 0.46, 6), flameOrange, [0, -0.08, -0.12], [1, 1, 1], [-0.85, 0, 0], this.flameOutlineMat);
    const tipFlame = this.addOutlined(j.tailTipPivot, new THREE.ConeGeometry(0.18, 0.56, 6), flameGold, [0, -0.04, -0.18], [1, 1, 1], [-0.95, 0, 0], this.flameOutlineMat);
    j.flames.push(rootFlame, tipFlame);

    this.buildArticulatedLimbs(j, emberLimb, flameOrange, flameGold, flameGold, this.flameOutlineMat);
  }

  private buildNeonSlime(j: ArticulatedJoints): void {
    const gelOuter = this.toon(0x4ade80, {
      emissive: 0x16a34a,
      emissiveIntensity: 0.45,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
    });
    const boneCore = this.toon(0xbef264, {
      emissive: 0x4ade80,
      emissiveIntensity: 0.7,
    });
    const darkSlime = this.toon(0x15803d);

    this.addOutlined(j.chest, new THREE.CylinderGeometry(0.08, 0.08, 0.65, 8), boneCore, [0, 0.02, 0], [1, 1, 1], [0, 0, 0], null);
    for (let r = 0; r < 3; r++) {
      this.addOutlined(
        j.chest,
        new THREE.TorusGeometry(0.25 - r * 0.02, 0.045, 6, 14),
        boneCore,
        [0, 0.18 - r * 0.17, 0.02],
        [1.15, 0.85, 0.85],
        [Math.PI / 2, 0, 0],
        null,
      );
    }

    const jellyBelly = this.addOutlined(j.spine, new THREE.SphereGeometry(0.46, 14, 12), gelOuter, [0, 0.1, 0], [1.08, 0.92, 0.94], [0, 0, 0], this.slimeOutlineMat);
    const jellyChest = this.addOutlined(j.chest, new THREE.CapsuleGeometry(0.48, 0.3, 6, 14), gelOuter, [0, 0.06, 0], [1.14, 1.0, 0.98], [0, 0, 0], this.slimeOutlineMat);
    j.slimeShells.push(jellyBelly, jellyChest);

    this.addOutlined(j.head, new THREE.SphereGeometry(0.32, 12, 10), boneCore, [0, 0.06, 0.02], [1.0, 0.95, 0.92], [0, 0, 0], null);
    this.addOutlined(j.head, new THREE.BoxGeometry(0.46, 0.16, 0.22), boneCore, [0, -0.14, 0.24], [1, 1, 1], [0, 0, 0], this.slimeOutlineMat, 1.05);

    this.addOutlined(j.head, new THREE.SphereGeometry(0.115, 10, 10), boneCore, [-0.14, 0.12, 0.36], [1.2, 0.72, 0.5], [0, 0, 0], this.slimeOutlineMat);
    this.addOutlined(j.head, new THREE.SphereGeometry(0.115, 10, 10), boneCore, [0.14, 0.12, 0.36], [1.2, 0.72, 0.5], [0, 0, 0], this.slimeOutlineMat);
    this.addOutlined(j.head, new THREE.SphereGeometry(0.055, 8, 8), darkSlime, [-0.14, 0.11, 0.41], [1, 0.9, 0.5], [0, 0, 0], null);
    this.addOutlined(j.head, new THREE.SphereGeometry(0.055, 8, 8), darkSlime, [0.14, 0.11, 0.41], [1, 0.9, 0.5], [0, 0, 0], null);

    const jellyHead = this.addOutlined(j.head, new THREE.DodecahedronGeometry(0.5, 2), gelOuter, [0, 0.04, 0], [1.08, 1.02, 0.98], [0, 0, 0], this.slimeOutlineMat);
    j.slimeShells.push(jellyHead);

    const hornGeo = new THREE.ConeGeometry(0.08, 0.26, 7);
    this.addOutlined(j.head, hornGeo, boneCore, [-0.25, 0.47, 0.08], [1, 1, 1], [0.15, 0, 0.28], this.slimeOutlineMat);
    this.addOutlined(j.head, hornGeo, boneCore, [0.25, 0.47, 0.08], [1, 1, 1], [0.15, 0, -0.28], this.slimeOutlineMat);

    // Spring-driven wobbling Jelly Ear Flaps & Ectoplasm Hip Pods + Bone Charm
    const earGelL = this.addOutlined(j.leftEarPivot, new THREE.CapsuleGeometry(0.11, 0.2, 5, 8), gelOuter, [-0.09, -0.1, 0], [0.85, 1.05, 0.8], [0, 0, 0.4], this.slimeOutlineMat);
    const earGelR = this.addOutlined(j.rightEarPivot, new THREE.CapsuleGeometry(0.11, 0.2, 5, 8), gelOuter, [0.09, -0.1, 0], [0.85, 1.05, 0.8], [0, 0, -0.4], this.slimeOutlineMat);
    this.addOutlined(j.leftPouchPivot, new THREE.SphereGeometry(0.14, 10, 10), gelOuter, [-0.08, -0.14, 0], [1, 1.25, 1], [0, 0, 0], this.slimeOutlineMat);
    this.addOutlined(j.rightPouchPivot, new THREE.SphereGeometry(0.14, 10, 10), gelOuter, [0.08, -0.14, 0], [1, 1.25, 1], [0, 0, 0], this.slimeOutlineMat);
    this.addOutlined(j.pendantPivot, new THREE.DodecahedronGeometry(0.11, 0), boneCore, [0, -0.18, 0.02], [1, 1, 0.8], [0, 0, 0], this.slimeOutlineMat);

    // Coupled 2-segment dripping Slime Tail!
    const rootDrop = this.addOutlined(j.tailRootPivot, new THREE.CapsuleGeometry(0.15, 0.22, 5, 8), gelOuter, [0, -0.1, -0.1], [1, 1, 1], [-0.8, 0, 0], this.slimeOutlineMat);
    const tipDrop = this.addOutlined(j.tailTipPivot, new THREE.ConeGeometry(0.16, 0.44, 7), gelOuter, [0, -0.04, -0.16], [1, 1, 1], [-0.95, 0, 0], this.slimeOutlineMat);
    j.slimeShells.push(earGelL, earGelR, rootDrop, tipDrop);

    this.buildArticulatedLimbs(j, boneCore, gelOuter, gelOuter, gelOuter, this.slimeOutlineMat, true);
  }

  private buildHalfCyborg(j: ArticulatedJoints): void {
    const fur = this.toon(0xf8fafc);
    const blueSkin = this.toon(0x5c9ce6);
    const muzzle = this.toon(0xdbe3ec);
    const mechaWhite = this.toon(0xe2e8f0);
    const chrome = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.9, roughness: 0.2 });
    const darkChassis = this.toon(0x1e293b);
    const opticCyan = this.toon(0x38bdf8, { emissive: 0x38bdf8, emissiveIntensity: 1.2 });
    const whiteEye = this.toon(0xffffff);
    const pupil = this.toon(0x0b0f19);

    this.addOutlined(j.spine, new THREE.SphereGeometry(0.44, 14, 12), fur, [0.06, 0.1, 0], [0.95, 0.88, 0.9]);
    this.addOutlined(j.chest, new THREE.BoxGeometry(0.52, 0.72, 0.72), fur, [0.24, 0.05, 0]);
    this.addOutlined(j.chest, new THREE.BoxGeometry(0.48, 0.68, 0.64), darkChassis, [-0.23, 0.05, 0]);
    this.addOutlined(j.chest, new THREE.BoxGeometry(0.5, 0.12, 0.7), mechaWhite, [-0.24, 0.34, 0]);
    this.addOutlined(j.chest, new THREE.BoxGeometry(0.46, 0.12, 0.68), mechaWhite, [-0.23, -0.14, 0]);

    const gearGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.08, 8);
    gearGeo.rotateX(Math.PI / 2);
    const chestGear = this.addOutlined(j.chest, gearGeo, chrome, [-0.22, 0.1, 0.36], [1, 1, 1], [0, 0, 0], this.inkOutlineMat);
    const shoulderGear = this.addOutlined(j.leftShoulder, gearGeo, chrome, [-0.08, 0.06, 0.14], [0.95, 0.95, 0.95], [0, 0, 0], this.inkOutlineMat);
    const backGear = this.addOutlined(j.backAccessory, gearGeo, chrome, [-0.18, 0.08, -0.04], [1.1, 1.1, 1.1], [0, 0, 0], this.inkOutlineMat);
    j.gears.push(chestGear, shoulderGear, backGear);

    // Coupled 2-segment Servo Thruster Tail!
    this.addOutlined(j.tailRootPivot, new THREE.CylinderGeometry(0.12, 0.15, 0.34, 8), chrome, [-0.08, -0.14, -0.06], [1, 1, 1], [0.35, 0, 0]);
    this.addOutlined(j.tailTipPivot, new THREE.ConeGeometry(0.12, 0.34, 7), opticCyan, [-0.08, -0.06, -0.1], [1, 1, 1], [Math.PI + 0.35, 0, 0], null);

    // Asymmetric Spring-driven Ear Flaps (Mecha antenna ring left + Organic ear flap right) & Tactical Pouches
    this.addOutlined(j.leftEarPivot, new THREE.TorusGeometry(0.13, 0.04, 8, 14), mechaWhite, [-0.06, -0.04, 0], [1, 1, 1], [0, Math.PI / 2, 0]);
    this.addOutlined(j.leftEarPivot, new THREE.CylinderGeometry(0.025, 0.025, 0.26, 6), opticCyan, [-0.06, 0.14, 0], [1, 1, 1], [0, 0, 0.25], null);
    this.addOutlined(j.rightEarPivot, new THREE.CapsuleGeometry(0.1, 0.2, 5, 8), blueSkin, [0.1, -0.1, 0], [0.7, 1.0, 0.72], [0, 0, -0.35]);

    this.addOutlined(j.leftPouchPivot, new THREE.BoxGeometry(0.22, 0.3, 0.24), darkChassis, [-0.08, -0.14, 0]);
    this.addOutlined(j.leftPouchPivot, new THREE.BoxGeometry(0.14, 0.08, 0.26), opticCyan, [-0.08, -0.14, 0], [1, 1, 1], [0, 0, 0], null);
    this.addOutlined(j.rightPouchPivot, new THREE.BoxGeometry(0.2, 0.26, 0.22), blueSkin, [0.08, -0.14, 0]);
    this.addOutlined(j.pendantPivot, new THREE.CylinderGeometry(0.11, 0.11, 0.06, 12), opticCyan, [0, -0.16, 0.02], [1, 1, 1], [Math.PI / 2, 0, 0], null);

    this.addOutlined(j.head, new THREE.BoxGeometry(0.48, 0.78, 0.76), fur, [0.23, 0.04, 0]);
    this.addOutlined(j.head, new THREE.BoxGeometry(0.46, 0.74, 0.7), mechaWhite, [-0.22, 0.04, 0]);

    this.addOutlined(j.head, new THREE.BoxGeometry(0.32, 0.28, 0.22), blueSkin, [0.16, 0.11, 0.36]);
    this.addOutlined(j.head, new THREE.BoxGeometry(0.32, 0.26, 0.2), muzzle, [0.16, -0.14, 0.34]);
    this.addOutlined(j.head, new THREE.SphereGeometry(0.115, 10, 10), whiteEye, [0.16, 0.11, 0.45], [1.2, 0.78, 0.48]);
    this.addOutlined(j.head, new THREE.SphereGeometry(0.068, 10, 10), pupil, [0.16, 0.105, 0.505], [1, 0.9, 0.45], [0, 0, 0], null);
    this.addOutlined(j.head, new THREE.CapsuleGeometry(0.06, 0.2, 6, 8), blueSkin, [0.16, -0.16, 0.46], [1, 1, 0.65], [0, 0, Math.PI / 2]);
    this.addOutlined(j.head, new THREE.ConeGeometry(0.08, 0.28, 8), blueSkin, [0.26, 0.46, 0.1], [1, 1, 1], [0.15, 0, -0.26]);

    this.addOutlined(j.head, new THREE.CylinderGeometry(0.16, 0.16, 0.14, 14), chrome, [-0.17, 0.11, 0.36], [1, 1, 1], [Math.PI / 2, 0, 0]);
    this.addOutlined(j.head, new THREE.CylinderGeometry(0.09, 0.09, 0.16, 12), opticCyan, [-0.17, 0.11, 0.38], [1, 1, 1], [Math.PI / 2, 0, 0], null);
    this.addOutlined(j.head, new THREE.CapsuleGeometry(0.055, 0.2, 6, 8), mechaWhite, [-0.16, -0.16, 0.44], [1, 1, 0.7], [0, 0, Math.PI / 2]);

    this.buildAsymmetricLimbs(j, mechaWhite, chrome, fur, blueSkin);
  }

  private buildVoidShadow(j: ArticulatedJoints): void {
    // Redesigned Stealth Shadow Yeti: sculpted midnight-obsidian shaggy fur, layered ninja scarf,
    // sleek dark-slate Yeti face mask & muzzle, sharp obsidian horns, flowing shadow cloak —
    // ZERO floating energons, ZERO floating crescents, ZERO glowing hand spikes!
    const obsidianFur = this.toon(0x161424);
    const charcoalFur = this.toon(0x28263d);
    const slateSkin = this.toon(0x434863);
    const muzzleDark = this.toon(0x2e3147);
    const hornObsidian = this.toon(0x1e1b2e);
    const scarfMat = this.toon(0x3b2266);
    const capeMat = this.toon(0x1e1a33);
    const buckleSilver = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.82,
      roughness: 0.28,
    });
    const eyeViolet = this.toon(0xe9d5ff, { emissive: 0xa855f7, emissiveIntensity: 0.85 });
    const pupilDark = this.toon(0x1e1b4b);

    // Sculpted athletic shaggy Shadow Yeti torso (no boxy blocks!)
    this.addOutlined(j.spine, new THREE.SphereGeometry(0.45, 14, 12), obsidianFur, [0, 0.1, 0], [1.06, 0.9, 0.92]);
    this.addOutlined(j.chest, new THREE.CapsuleGeometry(0.44, 0.26, 6, 14), obsidianFur, [0, 0.04, 0], [1.14, 1.0, 0.96]);

    // Layered stealth collar & charcoal fur shoulder mantle
    this.addOutlined(
      j.chest,
      new THREE.TorusGeometry(0.4, 0.12, 8, 18),
      scarfMat,
      [0, 0.34, 0.02],
      [1.08, 0.95, 1.0],
      [Math.PI * 0.48, 0, 0],
    );
    const tuftGeo = new THREE.ConeGeometry(0.13, 0.28, 6);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      this.addOutlined(
        j.chest,
        tuftGeo,
        charcoalFur,
        [Math.sin(a) * 0.44, 0.28, Math.cos(a) * 0.38],
        [1, 0.95, 1],
        [Math.cos(a) * 0.45, 0, -Math.sin(a) * 0.45],
      );
    }

    // Sleek matte silver-and-obsidian collar clasp on pendantPivot (no floating glowing crystal!)
    this.addOutlined(
      j.pendantPivot,
      new THREE.BoxGeometry(0.16, 0.16, 0.06),
      buckleSilver,
      [0, -0.14, 0.02],
      [1, 1, 1],
      [0, 0, Math.PI / 4],
      this.inkOutlineMat,
    );

    // Sculpted shaggy Shadow Yeti head + spiky dark fur hair crown
    this.addOutlined(j.head, new THREE.DodecahedronGeometry(0.48, 2), obsidianFur, [0, 0.04, 0], [1.08, 1.0, 0.96]);
    const spikeOffsets: [number, number, number, number][] = [
      [-0.2, 0.45, 0.04, 0.32],
      [-0.03, 0.52, 0.03, 0.05],
      [0.14, 0.48, 0.04, -0.22],
      [0.26, 0.4, 0.0, -0.38],
      [-0.36, 0.28, -0.05, 0.68],
      [0.36, 0.28, -0.05, -0.68],
    ];
    for (const [sx, sy, sz, rz] of spikeOffsets) {
      this.addOutlined(j.head, tuftGeo, charcoalFur, [sx, sy, sz], [0.88, 1.02, 0.88], [0.1, 0, rz]);
    }

    // Curved sleek obsidian Yeti horns
    const hornGeo = new THREE.ConeGeometry(0.085, 0.32, 8);
    this.addOutlined(j.head, hornGeo, hornObsidian, [-0.26, 0.48, 0.1], [1, 1, 1], [0.18, 0, 0.3]);
    this.addOutlined(j.head, hornGeo, hornObsidian, [0.26, 0.48, 0.1], [1, 1, 1], [0.18, 0, -0.3]);

    // Dark-slate Yeti face mask & sculpted muzzle with sharp focused violet eyes
    this.addOutlined(j.head, new THREE.BoxGeometry(0.62, 0.28, 0.24), slateSkin, [0, 0.11, 0.37], [1, 1, 1], [0, 0, 0], this.inkOutlineMat, 1.05);
    this.addOutlined(j.head, new THREE.SphereGeometry(0.34, 14, 12), muzzleDark, [0, -0.11, 0.33], [1.08, 0.76, 0.74], [0, 0, 0], this.inkOutlineMat, 1.05);

    const eyeGeo = new THREE.SphereGeometry(0.115, 12, 10);
    this.addOutlined(j.head, eyeGeo, eyeViolet, [-0.15, 0.11, 0.46], [1.26, 0.64, 0.46], [0, 0, -0.1], this.inkOutlineMat, 1.08);
    this.addOutlined(j.head, eyeGeo, eyeViolet, [0.15, 0.11, 0.46], [1.26, 0.64, 0.46], [0, 0, 0.1], this.inkOutlineMat, 1.08);
    const pupilGeo = new THREE.SphereGeometry(0.055, 8, 8);
    this.addOutlined(j.head, pupilGeo, pupilDark, [-0.14, 0.105, 0.51], [1, 0.9, 0.45], [0, 0, 0], null);
    this.addOutlined(j.head, pupilGeo, pupilDark, [0.14, 0.105, 0.51], [1, 0.9, 0.45], [0, 0, 0], null);

    // Focused angled shadow brows + calm cool smirk
    const browGeo = new THREE.BoxGeometry(0.28, 0.06, 0.14);
    this.addOutlined(j.head, browGeo, obsidianFur, [-0.15, 0.19, 0.46], [1, 1, 1], [0, 0, -0.16], this.inkOutlineMat, 1.06);
    this.addOutlined(j.head, browGeo, obsidianFur, [0.15, 0.19, 0.46], [1, 1, 1], [0, 0, 0.16], this.inkOutlineMat, 1.06);
    this.addOutlined(j.head, new THREE.SphereGeometry(0.075, 10, 8), slateSkin, [0, -0.01, 0.54], [1.2, 0.8, 0.75]);
    this.addOutlined(j.head, new THREE.CapsuleGeometry(0.055, 0.34, 6, 10), slateSkin, [0, -0.17, 0.51], [1, 1, 0.65], [0, 0, Math.PI / 2]);

    // Spring-driven articulated Shadow Yeti Ear Flaps & Stealth Hip Pouches
    const earFlapGeo = new THREE.CapsuleGeometry(0.1, 0.22, 5, 10);
    this.addOutlined(j.leftEarPivot, earFlapGeo, slateSkin, [-0.1, -0.1, 0], [0.7, 1.05, 0.72], [0, 0, 0.38]);
    this.addOutlined(j.leftEarPivot, new THREE.SphereGeometry(0.085, 8, 8), charcoalFur, [-0.16, -0.24, 0]);
    this.addOutlined(j.rightEarPivot, earFlapGeo, slateSkin, [0.1, -0.1, 0], [0.7, 1.05, 0.72], [0, 0, -0.38]);
    this.addOutlined(j.rightEarPivot, new THREE.SphereGeometry(0.085, 8, 8), charcoalFur, [0.16, -0.24, 0]);

    const pouchGeo = new THREE.BoxGeometry(0.21, 0.27, 0.23);
    const claspGeo = new THREE.BoxGeometry(0.1, 0.07, 0.25);
    this.addOutlined(j.leftPouchPivot, pouchGeo, scarfMat, [-0.08, -0.14, 0]);
    this.addOutlined(j.leftPouchPivot, claspGeo, buckleSilver, [-0.08, -0.07, 0], [1, 1, 1], [0, 0, 0], null);
    this.addOutlined(j.rightPouchPivot, pouchGeo, scarfMat, [0.08, -0.14, 0]);
    this.addOutlined(j.rightPouchPivot, claspGeo, buckleSilver, [0.08, -0.07, 0], [1, 1, 1], [0, 0, 0], null);

    // Coupled 2-segment flowing matte Shadow Cloak!
    j.tailRootPivot.position.set(0, 0.26, 0);
    this.addOutlined(j.tailRootPivot, new THREE.BoxGeometry(1.04, 0.66, 0.08), capeMat, [0, -0.33, -0.05]);
    j.tailTipPivot.position.set(0, -0.64, -0.05);
    this.addOutlined(j.tailTipPivot, new THREE.BoxGeometry(0.92, 0.6, 0.07), obsidianFur, [0, -0.3, -0.02]);

    // Clean athletic Shadow Yeti limbs (NO floating crescents, NO glowing crystal spikes!)
    this.buildArticulatedLimbs(j, obsidianFur, charcoalFur, slateSkin, slateSkin, this.inkOutlineMat);
  }

  private buildArticulatedLimbs(
    j: ArticulatedJoints,
    upperMat: THREE.Material,
    lowerMat: THREE.Material,
    handMat: THREE.Material,
    footMat: THREE.Material,
    outlineMat: THREE.Material,
    isSlimeInnerBone = false,
  ): void {
    const upperArmGeo = new THREE.CapsuleGeometry(0.15, 0.24, 5, 10);
    const forearmGeo = new THREE.CapsuleGeometry(0.14, 0.22, 5, 10);
    const handGeo = new THREE.SphereGeometry(0.165, 10, 10);
    const thighGeo = new THREE.CapsuleGeometry(0.175, 0.26, 5, 10);
    const shinGeo = new THREE.CapsuleGeometry(0.155, 0.24, 5, 10);
    const footGeo = new THREE.BoxGeometry(0.28, 0.17, 0.45);

    if (isSlimeInnerBone) {
      const boneGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.3, 6);
      this.addOutlined(j.leftShoulder, boneGeo, upperMat, [-0.03, -0.18, 0], [1, 1, 1], [0, 0, 0], null);
      this.addOutlined(j.rightShoulder, boneGeo, upperMat, [0.03, -0.18, 0], [1, 1, 1], [0, 0, 0], null);
      this.addOutlined(j.leftHip, boneGeo, upperMat, [0, -0.22, 0], [1, 1, 1], [0, 0, 0], null);
      this.addOutlined(j.rightHip, boneGeo, upperMat, [0, -0.22, 0], [1, 1, 1], [0, 0, 0], null);
    }

    const matUpper = isSlimeInnerBone ? lowerMat : upperMat;

    this.addOutlined(j.leftShoulder, upperArmGeo, matUpper, [-0.03, -0.18, 0], [1, 1, 1], [0, 0, 0], outlineMat);
    this.addOutlined(j.leftElbow, forearmGeo, lowerMat, [0, -0.16, 0], [1, 1, 1], [0, 0, 0], outlineMat);
    this.addOutlined(j.leftElbow, handGeo, handMat, [0, -0.34, 0.04], [1, 0.9, 1.15], [0, 0, 0], outlineMat);

    this.addOutlined(j.rightShoulder, upperArmGeo, matUpper, [0.03, -0.18, 0], [1, 1, 1], [0, 0, 0], outlineMat);
    this.addOutlined(j.rightElbow, forearmGeo, lowerMat, [0, -0.16, 0], [1, 1, 1], [0, 0, 0], outlineMat);
    this.addOutlined(j.rightElbow, handGeo, handMat, [0, -0.34, 0.04], [1, 0.9, 1.15], [0, 0, 0], outlineMat);

    this.addOutlined(j.leftHip, thighGeo, matUpper, [0, -0.22, 0], [1, 1, 1], [0, 0, 0], outlineMat);
    this.addOutlined(j.leftKnee, shinGeo, lowerMat, [0, -0.22, 0], [1, 1, 1], [0, 0, 0], outlineMat);
    this.addOutlined(j.leftKnee, footGeo, footMat, [0, -0.4, 0.11], [1, 1, 1], [0, 0, 0], outlineMat);

    this.addOutlined(j.rightHip, thighGeo, matUpper, [0, -0.22, 0], [1, 1, 1], [0, 0, 0], outlineMat);
    this.addOutlined(j.rightKnee, shinGeo, lowerMat, [0, -0.22, 0], [1, 1, 1], [0, 0, 0], outlineMat);
    this.addOutlined(j.rightKnee, footGeo, footMat, [0, -0.4, 0.11], [1, 1, 1], [0, 0, 0], outlineMat);
  }

  private buildAsymmetricLimbs(
    j: ArticulatedJoints,
    mechaMat: THREE.Material,
    chromeMat: THREE.Material,
    organicFur: THREE.Material,
    organicSkin: THREE.Material,
  ): void {
    const upperArmGeo = new THREE.CapsuleGeometry(0.15, 0.24, 5, 10);
    const forearmGeo = new THREE.CapsuleGeometry(0.14, 0.22, 5, 10);
    const handGeo = new THREE.SphereGeometry(0.165, 10, 10);
    const thighGeo = new THREE.CapsuleGeometry(0.175, 0.26, 5, 10);
    const shinGeo = new THREE.CapsuleGeometry(0.155, 0.24, 5, 10);
    const footGeo = new THREE.BoxGeometry(0.28, 0.17, 0.45);

    this.addOutlined(j.leftShoulder, new THREE.CylinderGeometry(0.13, 0.11, 0.38, 8), mechaMat, [-0.03, -0.18, 0]);
    this.addOutlined(j.leftElbow, new THREE.CylinderGeometry(0.11, 0.1, 0.34, 8), chromeMat, [0, -0.16, 0]);
    this.addOutlined(j.leftElbow, new THREE.BoxGeometry(0.22, 0.2, 0.26), mechaMat, [0, -0.34, 0.04]);

    this.addOutlined(j.leftHip, new THREE.CylinderGeometry(0.15, 0.13, 0.42, 8), mechaMat, [0, -0.22, 0]);
    this.addOutlined(j.leftKnee, new THREE.CylinderGeometry(0.12, 0.11, 0.4, 8), chromeMat, [0, -0.22, 0]);
    this.addOutlined(j.leftKnee, footGeo, mechaMat, [0, -0.4, 0.11]);

    this.addOutlined(j.rightShoulder, upperArmGeo, organicFur, [0.03, -0.18, 0]);
    this.addOutlined(j.rightElbow, forearmGeo, organicFur, [0, -0.16, 0]);
    this.addOutlined(j.rightElbow, handGeo, organicSkin, [0, -0.34, 0.04], [1, 0.9, 1.15]);

    this.addOutlined(j.rightHip, thighGeo, organicFur, [0, -0.22, 0]);
    this.addOutlined(j.rightKnee, shinGeo, organicFur, [0, -0.22, 0]);
    this.addOutlined(j.rightKnee, footGeo, organicSkin, [0, -0.4, 0.11]);
  }

  private buildPowerupEffects(): void {
    this.swordGroup.visible = false;

    // Subtle complementary plasma flash rings paired with the real-time 3D BladeRibbonTrail
    const arcGeo = new THREE.RingGeometry(1.1, 2.35, 26, 1, -Math.PI * 0.46, Math.PI * 0.92);
    this.slashArcMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.slashArcMesh = new THREE.Mesh(arcGeo, this.slashArcMat);
    this.slashArcMesh.position.set(0, 1.25, -1.15);
    this.slashArcMesh.visible = false;
    this.bodyPivot.add(this.slashArcMesh);

    this.slashArcSecondary = new THREE.Mesh(arcGeo, this.slashArcMat);
    this.slashArcSecondary.position.set(0, 1.25, -1.25);
    this.slashArcSecondary.visible = false;
    this.bodyPivot.add(this.slashArcSecondary);

    // Star Flight Aura
    const auraSphereMat = new THREE.MeshBasicMaterial({
      color: 0xfde047,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const auraSphere = new THREE.Mesh(new THREE.SphereGeometry(1.38, 18, 14), auraSphereMat);
    auraSphere.position.y = 1.15;

    this.starRing1 = new THREE.Mesh(
      new THREE.TorusGeometry(1.38, 0.055, 8, 32),
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.starRing1.position.y = 1.15;
    this.starRing2 = new THREE.Mesh(
      new THREE.TorusGeometry(1.18, 0.045, 8, 32),
      new THREE.MeshBasicMaterial({
        color: 0xfacc15,
        transparent: true,
        opacity: 0.82,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.starRing2.position.y = 1.15;

    this.starAuraGroup.add(auraSphere, this.starRing1, this.starRing2);
    this.starAuraGroup.visible = false;
    this.bodyPivot.add(this.starAuraGroup);

    // Spin / Corkscrew Vortex Ring
    this.spinRingMat = new THREE.MeshBasicMaterial({
      color: 0x7dd3fc,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.spinRingMesh = new THREE.Mesh(new THREE.RingGeometry(0.75, 1.55, 24), this.spinRingMat);
    this.spinRingMesh.rotation.x = -Math.PI / 2;
    this.spinRingMesh.position.y = 1.05;
    this.spinRingMesh.visible = false;
    this.bodyPivot.add(this.spinRingMesh);

    // Void Shadow Phase Shield
    const shieldMat = new THREE.MeshBasicMaterial({
      color: 0xa78bfa,
      wireframe: true,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.voidShieldMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1.36, 1), shieldMat);
    this.voidShieldMesh.position.y = 1.15;
    this.voidShieldMesh.visible = false;
    this.bodyPivot.add(this.voidShieldMesh);
  }

  private async tryLoadGlbModel(onSourceChange?: (src: 'procedural' | 'glb') => void): Promise<void> {
    try {
      const response = await fetch(YETI_MODEL_URL);
      if (!response.ok) return;
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength < 12) return;

      const view = new DataView(buffer);
      if (view.getUint32(0, true) !== 0x46546c67) return;

      const loader = new GLTFLoader();
      const gltf = await new Promise<import('three/addons/loaders/GLTFLoader.js').GLTF>(
        (resolve, reject) => {
          loader.parse(buffer, '', resolve, reject);
        },
      );

      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);

      const scale = size.y > 0.001 ? 2.2 / size.y : 1;
      model.scale.setScalar(scale);
      model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
      model.rotation.y = Math.PI;

      model.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        }
      });

      this.glbGroup = new THREE.Group();
      this.glbGroup.add(model);

      if (gltf.animations.length > 0) {
        this.mixer = new THREE.AnimationMixer(model);
        for (const clipName of CLIP_NAMES) {
          const found = gltf.animations.find(
            (c) => c.name.toLowerCase() === clipName || c.name.toLowerCase().includes(clipName),
          );
          if (found) {
            const action = this.mixer.clipAction(found);
            if (clipName === 'jump' || clipName === 'flip' || clipName === 'hit' || clipName === 'slash') {
              action.setLoop(THREE.LoopOnce, 1);
              action.clampWhenFinished = true;
            }
            this.actions.set(clipName, action);
          }
        }
      }

      this.bodyPivot.remove(this.proceduralRoot);
      this.bodyPivot.add(this.glbGroup);
      this.usingGlb = true;
      this.syncAccentColors();
      onSourceChange?.('glb');
    } catch {
      // Missing /assets/yeti.glb stays cleanly on sculpted 5-character toon rig
    }
  }

  private playGlbClip(name: string): void {
    if (!this.mixer) return;
    const next = this.actions.get(name) ?? this.actions.get('run');
    if (!next || this.activeActionKey === name) return;

    const prev = this.activeActionKey ? this.actions.get(this.activeActionKey) : null;
    next.reset().setEffectiveWeight(1).play();
    if (prev && prev !== next) {
      prev.crossFadeTo(next, 0.14, true);
    }
    this.activeActionKey = name;
  }

  public update(params: YetiMotionParams): void {
    const {
      dt,
      elapsed,
      state,
      speedRatio,
      forwardSpeed,
      laneVelocity,
      yPos,
      velocityY,
      flipProgress,
      spinProgress,
      slashProgress,
      slashComboIndex,
      stumbleProgress,
      flyBarrelProgress,
      flyBarrelDir,
      flyLoopProgress,
      flySwoopProgress,
      swordActive,
      starActive,
      shieldActive,
      invulnerable,
      invulnTimer,
      isMenuPreview,
    } = params;

    const charId = this.currentChar.id;

    // Landing impact detection proportional to actual falling impact speed
    const groundedNow = yPos <= 0.01 && !starActive;
    if (groundedNow && !this.wasGrounded && !isMenuPreview) {
      this.triggerLandingImpact(Math.max(10, Math.abs(this.lastVelocityY)));
    }
    this.wasGrounded = groundedNow;
    this.lastVelocityY = velocityY;

    // Step the Dampened Harmonic Oscillator physics controller for all accessories & squash/stretch!
    const phys = this.springPhysics.step({
      dt,
      elapsed,
      laneVelocity,
      velocityY,
      forwardSpeed,
      isSliding: state === 'slide',
      isFlying: starActive || state === 'fly',
      isFlipping: flipProgress > 0 && flipProgress < 1,
      isMenuPreview,
      swordActive,
    });
    const squashY = phys.squashY;
    const invSquashXZ = 1 / Math.sqrt(squashY);

    if (this.emoteTimer > 0) {
      this.emoteTimer = Math.max(0, this.emoteTimer - dt);
    }

    if (invulnerable && !starActive) {
      this.bodyPivot.visible = Math.floor(invulnTimer * 18) % 2 === 0;
    } else {
      this.bodyPivot.visible = true;
    }

    const heightScale = Math.max(0.28, 1 - yPos * 0.12);
    this.contactShadow.scale.setScalar(heightScale);
    (this.contactShadow.material as THREE.MeshBasicMaterial).opacity =
      Math.max(0.1, 0.56 - yPos * 0.08);

    if (this.usingGlb && this.mixer) {
      const clipTarget = state === 'idle' ? 'run' : state;
      this.playGlbClip(clipTarget);
      this.mixer.update(dt * (state === 'run' ? 0.95 + speedRatio * 0.65 : 1));
    }

    // Root body kinematics (shared across GLB & procedural rig)
    let targetBodyY = yPos;
    let targetPitch = 0;
    let targetRoll = THREE.MathUtils.clamp(-laneVelocity * 0.03, -0.4, 0.4);
    let targetYaw = 0;
    let targetScaleY = squashY;
    let targetScaleXZ = invSquashXZ;

    if (isMenuPreview) {
      const emoteHop = this.emoteTimer > 0 ? Math.sin((this.emoteTimer / 0.78) * Math.PI) * 0.45 : 0;
      const idleFloat =
        charId === 'void_shadow'
          ? 0.24 + Math.sin(elapsed * 2.2) * 0.1
          : charId === 'neon_slime'
            ? Math.abs(Math.sin(elapsed * 3.1)) * 0.08
            : Math.sin(elapsed * 2.4) * 0.03;
      targetBodyY = idleFloat + emoteHop;
      targetYaw =
        Math.PI +
        Math.sin(elapsed * 0.7) * 0.48 +
        (this.emoteTimer > 0 ? (1 - this.emoteTimer / 0.78) * Math.PI * 2 : 0);
      targetRoll = 0;
    } else {
      if (state === 'slide') {
        // Neon Slime pancakes flatter & wider; others crouch sleek & low
        targetScaleY = charId === 'neon_slime' ? 0.44 : 0.54;
        targetScaleXZ = charId === 'neon_slime' ? 1.38 : 1.18;
        targetPitch = charId === 'void_shadow' ? 0.32 : 0.48;
      } else if (state === 'fly' || starActive) {
        const swoopDip = flySwoopProgress > 0 ? Math.sin(flySwoopProgress * Math.PI) * -2.1 : 0;
        const loopLift = flyLoopProgress > 0 ? Math.sin(flyLoopProgress * Math.PI) * 1.45 : 0;
        targetBodyY = yPos + Math.sin(elapsed * 7.5) * 0.2 + swoopDip + loopLift;
        targetPitch = -0.38;
        if (flySwoopProgress > 0) {
          targetPitch += Math.sin(flySwoopProgress * Math.PI * 2) * 0.48;
        }
        targetRoll = THREE.MathUtils.clamp(-laneVelocity * 0.05, -0.52, 0.52);

        // Full 360° Aerial Barrel Roll!
        if (flyBarrelProgress > 0 && flyBarrelProgress < 1) {
          targetRoll += -flyBarrelDir * flyBarrelProgress * Math.PI * 2;
        }
        // Full 360° Sky Loop-de-Loop!
        if (flyLoopProgress > 0 && flyLoopProgress < 1) {
          targetPitch += flyLoopProgress * Math.PI * 2;
        }
      }

      // Grounded double-jump Backflip (unique spin twist on Inferno Blaze!)
      if (flipProgress > 0 && flipProgress < 1) {
        targetPitch += flipProgress * Math.PI * 2;
        if (charId === 'inferno_blaze') {
          targetYaw += flipProgress * Math.PI * 2; // Blazing corkscrew torpedo backflip!
        } else if (charId === 'neon_slime') {
          const stretch = Math.sin(flipProgress * Math.PI) * 0.25;
          targetScaleY += stretch;
          targetScaleXZ -= stretch * 0.45;
        }
      }

      // Tail-Whip Spin (or Meteor Corkscrew while flying!)
      if (spinProgress > 0 && spinProgress < 1) {
        const turns = starActive ? 2 : 1;
        targetYaw += spinProgress * Math.PI * 2 * turns;
      }

      // Combo Hit #3 (index 2): Explosive 360° Full-Body Whirlwind Spin Cleave!
      if (slashProgress > 0 && slashProgress < 1 && slashComboIndex % 3 === 2) {
        const wind = THREE.MathUtils.clamp((slashProgress - 0.14) / 0.72, 0, 1);
        const easedSpin = 1 - Math.pow(1 - wind, 3);
        targetYaw += easedSpin * Math.PI * 2;
      }

      if (stumbleProgress > 0 && stumbleProgress < 1) {
        targetPitch += Math.sin(stumbleProgress * Math.PI * 3) * 0.28;
        targetRoll += Math.sin(stumbleProgress * Math.PI * 4) * 0.32;
      }
    }

    this.bodyPivot.position.y = targetBodyY;
    const snapRotation =
      (flipProgress > 0 && flipProgress < 1) ||
      (flyLoopProgress > 0 && flyLoopProgress < 1) ||
      (flyBarrelProgress > 0 && flyBarrelProgress < 1);
    this.bodyPivot.rotation.x = snapRotation
      ? targetPitch
      : THREE.MathUtils.damp(this.bodyPivot.rotation.x, targetPitch, 18, dt);
    this.bodyPivot.rotation.z =
      flyBarrelProgress > 0 && flyBarrelProgress < 1
        ? targetRoll
        : THREE.MathUtils.damp(this.bodyPivot.rotation.z, targetRoll, 16, dt);
    this.bodyPivot.rotation.y = isMenuPreview
      ? THREE.MathUtils.damp(this.bodyPivot.rotation.y, targetYaw, 8, dt)
      : targetYaw;
    this.bodyPivot.scale.set(
      THREE.MathUtils.damp(this.bodyPivot.scale.x, targetScaleXZ, 18, dt),
      THREE.MathUtils.damp(this.bodyPivot.scale.y, targetScaleY, 18, dt),
      THREE.MathUtils.damp(this.bodyPivot.scale.z, targetScaleXZ, 18, dt),
    );

    if (!this.usingGlb && this.joints) {
      this.animateArticulatedJoints({
        dt,
        elapsed,
        state,
        speedRatio,
        laneVelocity,
        velocityY,
        flipProgress,
        slashProgress,
        slashComboIndex,
        flyBarrelProgress,
        flyLoopProgress,
        flySwoopProgress,
        swordActive,
        starActive,
        isMenuPreview,
        phys,
      });
    }

    // Power-up visuals, signature sword animated accents & live socket-sampled 3D BladeRibbonTrail!
    const showSword = swordActive || slashProgress > 0;
    this.swordGroup.visible = showSword;

    if (this.signatureSword) {
      if (showSword && this.signatureSword.animatedParts.length > 0) {
        const spinBoost = slashProgress > 0 ? 4.2 : 1.0;
        for (let i = 0; i < this.signatureSword.animatedParts.length; i++) {
          const part = this.signatureSword.animatedParts[i];
          part.rotation.y += dt * 4.5 * spinBoost * (i % 2 === 0 ? 1 : -1);
          part.rotation.z += dt * 2.2 * spinBoost;
        }
      }

      // Sync matrices before sampling world positions of sword hilt/tip sockets
      this.root.updateMatrixWorld(true);
      const emitRibbon = !isMenuPreview && slashProgress > 0.12 && slashProgress < 0.88;
      this.bladeTrail.update(
        dt,
        emitRibbon,
        this.signatureSword.baseSocket,
        this.signatureSword.tipSocket,
        forwardSpeed,
      );
    }

    // Complementary thin plasma slash flash synced to the 3-hit combo plane
    if (slashProgress > 0.16 && slashProgress < 0.92) {
      const comboStep = slashComboIndex % 3;
      const cutSign = comboStep === 1 ? -1 : 1;
      const arcPhase = THREE.MathUtils.clamp((slashProgress - 0.16) / 0.76, 0, 1);
      const arcAlpha = Math.sin(arcPhase * Math.PI);
      const reachScale = 0.95 + (this.currentChar.perks.swordReachBonus > 0 ? 0.42 : 0);

      this.slashArcMesh.visible = true;
      this.slashArcMat.opacity = arcAlpha * 0.56;
      if (comboStep === 2) {
        // Horizontal 360° whirlwind shock ring
        this.slashArcMesh.rotation.set(Math.PI * 0.5, 0, arcPhase * Math.PI * 3.5);
        this.slashArcMesh.scale.setScalar(reachScale * 1.15 + arcPhase * 0.52);
      } else {
        this.slashArcMesh.rotation.set(Math.PI * 0.42, cutSign * 0.48, cutSign * (-1.35 + arcPhase * 2.85));
        this.slashArcMesh.scale.setScalar(reachScale + arcPhase * 0.44);
      }

      if (charId === 'void_shadow' || charId === 'inferno_blaze') {
        this.slashArcSecondary.visible = true;
        this.slashArcSecondary.rotation.set(
          Math.PI * 0.42,
          -cutSign * 0.48,
          -cutSign * (-1.2 + arcPhase * 2.65),
        );
        this.slashArcSecondary.scale.setScalar(reachScale * 0.92 + arcPhase * 0.4);
      } else {
        this.slashArcSecondary.visible = false;
      }
    } else {
      this.slashArcMesh.visible = false;
      this.slashArcSecondary.visible = false;
    }

    this.starAuraGroup.visible = starActive;
    if (starActive) {
      const spinBoost = flyBarrelProgress > 0 || flyLoopProgress > 0 ? 2.4 : 1.0;
      this.starRing1.rotation.x = elapsed * 3.6 * spinBoost;
      this.starRing1.rotation.y = elapsed * 2.3 * spinBoost;
      this.starRing2.rotation.y = -elapsed * 4.2 * spinBoost;
      this.starRing2.rotation.z = elapsed * 2.9 * spinBoost;
    }

    if (spinProgress > 0 && spinProgress < 1) {
      this.spinRingMesh.visible = true;
      this.spinRingMat.opacity = Math.sin(spinProgress * Math.PI) * 0.85;
      this.spinRingMesh.rotation.z = spinProgress * Math.PI * 5;
      this.spinRingMesh.scale.setScalar(0.95 + spinProgress * (starActive ? 0.85 : 0.55));
    } else {
      this.spinRingMesh.visible = false;
    }

    // Reserve wireframe energon aura strictly for future threshold abilities (never shown passively around Void Shadow)
    void shieldActive;
    this.voidShieldMesh.visible = false;
  }

  private animateArticulatedJoints(ctx: {
    dt: number;
    elapsed: number;
    state: YetiAnimState;
    speedRatio: number;
    laneVelocity: number;
    velocityY: number;
    flipProgress: number;
    slashProgress: number;
    slashComboIndex: number;
    flyBarrelProgress: number;
    flyLoopProgress: number;
    flySwoopProgress: number;
    swordActive: boolean;
    starActive: boolean;
    isMenuPreview: boolean;
    phys: AccessoryPhysicsState;
  }): void {
    const {
      dt,
      elapsed,
      state,
      speedRatio,
      laneVelocity,
      velocityY,
      flipProgress,
      slashProgress,
      slashComboIndex,
      flyBarrelProgress,
      flyLoopProgress,
      flySwoopProgress,
      swordActive,
      isMenuPreview,
      phys,
    } = ctx;

    const capePitch = phys.tailRootPitch;
    const capeRoll = phys.tailRootRoll;
    const headLag = phys.headLag;
    const limbLag = phys.limbLag;
    const accessorySurge = phys.accessorySurge;

    const j = this.joints;
    const charId = this.currentChar.id;
    const strideFreq = 11.2 + speedRatio * 6.8;
    this.runCycle += dt * strideFreq;

    if (isMenuPreview) {
      this.animateUniqueIdle(j, charId, elapsed);
    } else if (state === 'run') {
      const ph = this.runCycle;
      const sL = Math.sin(ph);
      const sR = Math.sin(ph + Math.PI);
      const cL = Math.cos(ph);
      const cR = Math.cos(ph + Math.PI);
      const bounce = Math.abs(Math.cos(ph));

      j.hips.position.y = 0.88 + bounce * 0.16;
      j.hips.rotation.set(0, sL * 0.16, sL * 0.06);

      j.spine.rotation.set(0.14 + speedRatio * 0.12 + bounce * 0.04, -sL * 0.14, 0);
      j.chest.rotation.set(0, -sL * 0.14, 0);
      j.head.rotation.set(
        -0.12 - speedRatio * 0.08 + headLag,
        sL * 0.14 + THREE.MathUtils.clamp(laneVelocity * 0.022, -0.25, 0.25),
        0,
      );

      j.leftHip.rotation.x = sL * 0.96 - 0.1;
      j.leftKnee.rotation.x = Math.max(0.08, -cL * 1.15 + 0.35);
      j.rightHip.rotation.x = sR * 0.96 - 0.1;
      j.rightKnee.rotation.x = Math.max(0.08, -cR * 1.15 + 0.35);

      j.leftShoulder.rotation.set(sR * 0.92 + limbLag * 0.3, 0, 0.14);
      j.leftElbow.rotation.x = -0.58 - Math.max(0, -sR) * 0.55;

      if (swordActive) {
        j.rightShoulder.rotation.set(-0.68 + sL * 0.22, 0, -0.24);
        j.rightElbow.rotation.x = -0.45;
      } else {
        j.rightShoulder.rotation.set(sL * 0.92 + limbLag * 0.3, 0, -0.14);
        j.rightElbow.rotation.x = -0.58 - Math.max(0, -sL) * 0.55;
      }
    } else if (state === 'jump' || state === 'flip') {
      const airTilt = THREE.MathUtils.clamp(-velocityY * 0.024, -0.28, 0.34);
      const isFlipping = flipProgress > 0 && flipProgress < 1;

      j.hips.position.y = 0.98;
      j.hips.rotation.set(0, 0, 0);
      j.spine.rotation.set((isFlipping ? 0.35 : 0.12) + airTilt, 0, 0);
      j.chest.rotation.set(0, 0, 0);
      j.head.rotation.set(-0.1 + headLag, 0, 0);

      // Character-unique Jump & Backflip poses!
      if (charId === 'og_lofi') {
        // Chill tucked grab backflip / relaxed parkour vault
        j.leftHip.rotation.x = isFlipping ? -1.35 : -0.92;
        j.leftKnee.rotation.x = isFlipping ? 1.75 : 1.25;
        j.rightHip.rotation.x = isFlipping ? -1.25 : 0.28;
        j.rightKnee.rotation.x = isFlipping ? 1.65 : 0.72;
        j.leftShoulder.rotation.set(isFlipping ? -0.6 : -1.1 + limbLag, 0, isFlipping ? 0.55 : 0.42);
        j.leftElbow.rotation.x = isFlipping ? -1.1 : -0.55;
        j.rightShoulder.rotation.set(isFlipping ? -0.6 : -1.1 + limbLag, 0, isFlipping ? -0.55 : -0.42);
        j.rightElbow.rotation.x = isFlipping ? -1.1 : -0.55;
      } else if (charId === 'inferno_blaze') {
        // Aggressive blazing torpedo tuck
        j.leftHip.rotation.x = isFlipping ? -1.4 : -0.75;
        j.leftKnee.rotation.x = isFlipping ? 1.85 : 1.1;
        j.rightHip.rotation.x = isFlipping ? -1.4 : -0.45;
        j.rightKnee.rotation.x = isFlipping ? 1.85 : 1.2;
        j.leftShoulder.rotation.set(isFlipping ? -2.2 : -1.4 + limbLag, 0, 0.35);
        j.leftElbow.rotation.x = -0.35;
        j.rightShoulder.rotation.set(isFlipping ? -2.2 : -1.4 + limbLag, 0, -0.35);
        j.rightElbow.rotation.x = -0.35;
      } else if (charId === 'neon_slime') {
        // Springy elastic cannonball / star stretch
        j.leftHip.rotation.x = isFlipping ? -1.5 : -0.55;
        j.leftKnee.rotation.x = isFlipping ? 1.9 : 0.65;
        j.rightHip.rotation.x = isFlipping ? -1.5 : -0.55;
        j.rightKnee.rotation.x = isFlipping ? 1.9 : 0.65;
        j.leftShoulder.rotation.set(-1.3 + limbLag * 1.4, 0, 0.75);
        j.leftElbow.rotation.x = -0.25;
        j.rightShoulder.rotation.set(-1.3 + limbLag * 1.4, 0, -0.75);
        j.rightElbow.rotation.x = -0.25;
      } else if (charId === 'half_cyborg') {
        // Thruster-stabilized precision aerial stance
        j.leftHip.rotation.x = isFlipping ? -1.25 : -0.85;
        j.leftKnee.rotation.x = isFlipping ? 1.65 : 1.15;
        j.rightHip.rotation.x = isFlipping ? -1.1 : 0.15;
        j.rightKnee.rotation.x = isFlipping ? 1.5 : 0.45;
        j.leftShoulder.rotation.set(0.45 + limbLag * 0.5, 0, 0.35);
        j.leftElbow.rotation.x = -0.3;
        j.rightShoulder.rotation.set(-1.25 + limbLag, 0, -0.35);
        j.rightElbow.rotation.x = -0.65;
      } else {
        // Void Shadow: sleek ninja somersault with clawed arms swept back
        j.leftHip.rotation.x = isFlipping ? -1.42 : -0.95;
        j.leftKnee.rotation.x = isFlipping ? 1.8 : 1.3;
        j.rightHip.rotation.x = isFlipping ? -1.3 : 0.3;
        j.rightKnee.rotation.x = isFlipping ? 1.7 : 0.8;
        j.leftShoulder.rotation.set(0.65 + limbLag * 0.4, 0, 0.65);
        j.leftElbow.rotation.x = -0.35;
        j.rightShoulder.rotation.set(0.65 + limbLag * 0.4, 0, -0.65);
        j.rightElbow.rotation.x = -0.35;
      }
    } else if (state === 'slide') {
      j.hips.position.y = 0.72;
      j.hips.rotation.set(0, charId === 'og_lofi' ? 0.32 : 0.18, 0);
      j.spine.rotation.set(-0.34, 0, 0);
      j.chest.rotation.set(-0.12, 0, 0);
      j.head.rotation.set(0.26 + headLag * 0.6, -0.18, 0);

      // Character-unique Slide poses!
      if (charId === 'og_lofi') {
        // Stylish one-hand surfer power-slide
        j.leftHip.rotation.x = -1.2;
        j.leftKnee.rotation.x = 0.15;
        j.rightHip.rotation.x = 0.45;
        j.rightKnee.rotation.x = 1.25;
        j.leftShoulder.rotation.set(0.85, 0, 0.55);
        j.leftElbow.rotation.x = -0.25;
        j.rightShoulder.rotation.set(-0.75, 0, -0.65);
        j.rightElbow.rotation.x = -0.45;
      } else if (charId === 'neon_slime') {
        // Flat ooze glide
        j.leftHip.rotation.x = -1.1;
        j.leftKnee.rotation.x = 0.1;
        j.rightHip.rotation.x = -1.1;
        j.rightKnee.rotation.x = 0.1;
        j.leftShoulder.rotation.set(0.4, 0, 0.85);
        j.leftElbow.rotation.x = -0.2;
        j.rightShoulder.rotation.set(0.4, 0, -0.85);
        j.rightElbow.rotation.x = -0.2;
      } else {
        // Athletic baseball / phantom / hydraulic slide
        j.leftHip.rotation.x = -1.15;
        j.leftKnee.rotation.x = 0.18;
        j.rightHip.rotation.x = 0.48;
        j.rightKnee.rotation.x = 1.18;
        j.leftShoulder.rotation.set(0.65, 0, 0.48);
        j.leftElbow.rotation.x = -0.4;
        j.rightShoulder.rotation.set(0.65, 0, -0.48);
        j.rightElbow.rotation.x = -0.4;
      }
    } else if (state === 'fly') {
      j.hips.position.y = 0.96;
      j.hips.rotation.set(0, 0, 0);
      j.spine.rotation.set(0.32 + (flyLoopProgress > 0 ? 0.25 : 0), 0, 0);
      j.chest.rotation.set(0.12, 0, 0);
      j.head.rotation.set(-0.32 + headLag, 0, 0);

      // Character-unique Star Flight poses + Barrel Roll / Loop / Swoop wing articulation!
      const barrelTuck = flyBarrelProgress > 0 ? Math.sin(flyBarrelProgress * Math.PI) : 0;
      const swoopTuck = flySwoopProgress > 0 ? Math.sin(flySwoopProgress * Math.PI) : 0;

      if (charId === 'inferno_blaze' || charId === 'void_shadow') {
        // Swept-back rocket/phantom jet pose
        j.leftShoulder.rotation.set(0.75 + swoopTuck * 0.4, 0, 0.55 - barrelTuck * 0.35);
        j.leftElbow.rotation.x = -0.2;
        j.rightShoulder.rotation.set(0.75 + swoopTuck * 0.4, 0, -0.55 + barrelTuck * 0.35);
        j.rightElbow.rotation.x = -0.2;
      } else if (charId === 'half_cyborg') {
        // Iron-jet thruster stabilizer pose
        j.leftShoulder.rotation.set(0.55, 0, 0.45 - barrelTuck * 0.25);
        j.leftElbow.rotation.x = -0.15;
        j.rightShoulder.rotation.set(-1.65, 0, -0.25);
        j.rightElbow.rotation.x = -0.15;
      } else {
        // Classic Superman / Star-Glider twin-arm forward soar
        j.leftShoulder.rotation.set(-1.6 + swoopTuck * 0.5, 0, 0.42 - barrelTuck * 0.3);
        j.leftElbow.rotation.x = -0.2;
        j.rightShoulder.rotation.set(-1.6 + swoopTuck * 0.5, 0, -0.42 + barrelTuck * 0.3);
        j.rightElbow.rotation.x = -0.2;
      }

      j.leftHip.rotation.x = 0.32 + Math.sin(elapsed * 8) * 0.14;
      j.leftKnee.rotation.x = 0.28 + barrelTuck * 0.55;
      j.rightHip.rotation.x = 0.32 - Math.sin(elapsed * 8) * 0.14;
      j.rightKnee.rotation.x = 0.28 + barrelTuck * 0.55;
    }

    // 3-Phase (Anticipation -> Explosive Strike Snap -> Follow-Through), 3-Hit Combo Sword Swings!
    // Inspired by SlashSaber & SamuraiThirdPersonTemplateThreeJS full-body kinetic slash curves.
    if (slashProgress > 0 && slashProgress < 1) {
      const comboStep = slashComboIndex % 3;
      const anticipate = THREE.MathUtils.clamp(slashProgress / 0.18, 0, 1);
      const strikeRaw = THREE.MathUtils.clamp((slashProgress - 0.18) / 0.44, 0, 1);
      // Explosive quintic ease-out snap during strike window
      const strike = 1 - Math.pow(1 - strikeRaw, 4);
      const follow = THREE.MathUtils.clamp((slashProgress - 0.62) / 0.38, 0, 1);
      const wristSnap = Math.sin(strikeRaw * Math.PI);

      if (comboStep === 0) {
        // HIT 1: High-to-Low Diagonal Forehand Cleave with torso coil & hip follow-through
        const shX = -0.6 - anticipate * 2.2 + strike * 4.15 - follow * 0.45;
        const shZ = -0.25 - anticipate * 0.65 - wristSnap * 0.95 + follow * 0.4;
        j.rightShoulder.rotation.set(shX, 0.25 * wristSnap, shZ);
        j.rightElbow.rotation.x = -0.75 + strike * 0.65 - follow * 0.25;
        this.swordGroup.rotation.set(Math.PI * 0.44 + wristSnap * 0.68, 0, -wristSnap * 0.35);

        j.chest.rotation.y = -0.68 * anticipate + strike * 1.48 - follow * 0.35;
        j.hips.rotation.y = -0.28 * anticipate + strike * 0.62;
        j.spine.rotation.x += -0.18 * anticipate + wristSnap * 0.34;
        j.leftShoulder.rotation.set(0.55 * strike, 0, 0.52 + 0.35 * wristSnap);
      } else if (comboStep === 1) {
        // HIT 2: Low-to-High Reverse Backhand Uppercut Sweep
        const shX = 0.85 + anticipate * 0.75 - strike * 4.1 + follow * 0.55;
        const shZ = -0.15 + anticipate * 0.35 - wristSnap * 1.15;
        j.rightShoulder.rotation.set(shX, -0.35 * wristSnap, shZ);
        j.rightElbow.rotation.x = -0.55 + strike * 0.42;
        this.swordGroup.rotation.set(Math.PI * 0.44 - wristSnap * 0.52, Math.PI * 0.85, wristSnap * 0.42);

        j.chest.rotation.y = 0.72 * anticipate - strike * 1.52 + follow * 0.35;
        j.hips.rotation.y = 0.32 * anticipate - strike * 0.65;
        j.spine.rotation.x += 0.16 * anticipate - wristSnap * 0.26;
        j.leftShoulder.rotation.set(-0.45 * strike, 0, 0.65);
      } else {
        // HIT 3: 360° Full-Body Whirlwind Horizontal Spin Cleave (sword extended wide!)
        j.rightShoulder.rotation.set(-1.32, 0.4 * strike, -1.38);
        j.rightElbow.rotation.x = -0.12;
        this.swordGroup.rotation.set(Math.PI * 0.5, 0, -0.42);

        j.chest.rotation.y = 0.48 * strike;
        j.spine.rotation.x += 0.18;
        j.leftShoulder.rotation.set(-0.95, 0, 1.15);
        j.leftElbow.rotation.x = -0.25;
      }

      // Void Shadow sweeps BOTH arms for dramatic twin-blade flair
      if (charId === 'void_shadow' && comboStep !== 2) {
        j.leftShoulder.rotation.set(-2.3 + strike * 3.5, 0, 0.58 + wristSnap * 0.85);
        j.leftElbow.rotation.x = -0.2;
      }
    } else {
      // Return sword grip rotation cleanly to athletic ready angle when not mid-slash
      this.swordGroup.rotation.set(Math.PI * 0.44, 0, 0);
    }

    // Apply Dampened Harmonic Oscillator physics directly to ear flaps, hip pouches, pendant & 2-link tail/cape!
    j.leftEarPivot.rotation.set(phys.leftEarPitch, 0, phys.leftEarRoll);
    j.rightEarPivot.rotation.set(phys.rightEarPitch, 0, phys.rightEarRoll);

    j.leftPouchPivot.rotation.set(phys.leftPouchPitch, 0, phys.leftPouchRoll);
    j.rightPouchPivot.rotation.set(phys.rightPouchPitch, 0, phys.rightPouchRoll);

    j.pendantPivot.rotation.set(phys.pendantPitch, 0, phys.pendantRoll);

    j.tailRootPivot.rotation.set(phys.tailRootPitch, 0, phys.tailRootRoll);
    j.tailTipPivot.rotation.set(phys.tailTipPitch, 0, phys.tailTipRoll);

    // Secondary-motion spring application to flames, gears, slime shells & void crescents
    const surgeAmp = 1 + accessorySurge * 0.45;
    for (let i = 0; i < j.flames.length; i++) {
      const f = j.flames[i];
      const wave = Math.sin(elapsed * 14 + i * 1.4);
      f.scale.y = (0.94 + wave * 0.24) * surgeAmp;
      f.rotation.z = wave * 0.16 + capeRoll * 0.45;
      f.rotation.x = -0.12 - capePitch * 0.32;
    }

    for (let i = 0; i < j.gears.length; i++) {
      const turbo = 1 + speedRatio + accessorySurge * 2.2;
      j.gears[i].rotation.z += dt * (i % 2 === 0 ? 3.4 : -4.6) * turbo;
    }

    for (let i = 0; i < j.slimeShells.length; i++) {
      const wobble = Math.sin(elapsed * 8.2 + i * 1.15) * (0.045 + accessorySurge * 0.06);
      j.slimeShells[i].rotation.z = wobble + capeRoll * 0.35;
      j.slimeShells[i].rotation.x = headLag * 0.35;
    }

    for (let i = 0; i < j.crescents.length; i++) {
      const side = i === 0 ? -1 : 1;
      const flare = accessorySurge * 0.28;
      j.crescents[i].position.x = side * (0.42 + flare);
      j.crescents[i].position.y = 0.25 + Math.sin(elapsed * 3.6 + i * Math.PI) * 0.06 + flare * 0.3;
      j.crescents[i].rotation.z = (i === 0 ? Math.PI * 0.62 : -Math.PI * 0.44) + side * flare * 0.8;
    }
  }

  /**
   * 5 Distinct Showcase & Menu Idle Animations matching each Lofi Yeti's personality!
   */
  private animateUniqueIdle(j: ArticulatedJoints, charId: CharacterId, elapsed: number): void {
    const emote = this.emoteTimer > 0 ? Math.sin((this.emoteTimer / 0.78) * Math.PI) : 0;

    if (charId === 'og_lofi') {
      // Chill lofi hip-hop beat head-nod & relaxed bounce
      const beat = Math.sin(elapsed * 4.2);
      const bob = Math.abs(beat);
      j.hips.position.y = 0.92 - bob * 0.05;
      j.hips.rotation.set(0, Math.sin(elapsed * 2.1) * 0.08, 0);
      j.spine.rotation.set(0.05, 0, Math.sin(elapsed * 2.1) * 0.05);
      j.chest.rotation.set(0.03 - emote * 0.16, 0, 0);
      j.head.rotation.set(0.08 + beat * 0.12, Math.sin(elapsed * 1.4) * 0.18, Math.sin(elapsed * 2.1) * 0.06);

      j.leftShoulder.rotation.set(0.14 + beat * 0.12 - emote * 1.3, 0, 0.22 + emote * 0.35);
      j.leftElbow.rotation.x = -0.42 - bob * 0.18 - emote * 0.4;
      j.rightShoulder.rotation.set(0.14 - beat * 0.12 - emote * 1.3, 0, -0.22 - emote * 0.35);
      j.rightElbow.rotation.x = -0.42 - bob * 0.18 - emote * 0.4;

      j.leftHip.rotation.x = -bob * 0.14 - emote * 0.3;
      j.leftKnee.rotation.x = bob * 0.28 + emote * 0.6;
      j.rightHip.rotation.x = -bob * 0.14 - emote * 0.3;
      j.rightKnee.rotation.x = bob * 0.28 + emote * 0.6;
    } else if (charId === 'inferno_blaze') {
      // Fierce power-up flex stance with roaring chest heave & pumping fists
      const roar = Math.sin(elapsed * 3.8);
      j.hips.position.y = 0.92 + roar * 0.03;
      j.hips.rotation.set(0, 0, 0);
      j.spine.rotation.set(-0.08 - emote * 0.15, 0, 0);
      j.chest.rotation.set(-0.06 + roar * 0.06, 0, 0);
      j.head.rotation.set(-0.08 + roar * 0.08, Math.sin(elapsed * 1.6) * 0.14, 0);

      j.leftShoulder.rotation.set(-0.65 - roar * 0.18 - emote * 0.9, 0, 0.55 + roar * 0.12);
      j.leftElbow.rotation.x = -1.15 - roar * 0.2;
      j.rightShoulder.rotation.set(-0.65 - roar * 0.18 - emote * 0.9, 0, -0.55 - roar * 0.12);
      j.rightElbow.rotation.x = -1.15 - roar * 0.2;

      j.leftHip.rotation.set(-0.12, 0, -0.1);
      j.leftKnee.rotation.x = 0.22;
      j.rightHip.rotation.set(-0.12, 0, 0.1);
      j.rightKnee.rotation.x = 0.22;
    } else if (charId === 'neon_slime') {
      // Buoyant gelatinous ooze wave & wobbly arms
      const wave = Math.sin(elapsed * 3.4);
      const wave2 = Math.sin(elapsed * 3.4 - 0.9);
      j.hips.position.y = 0.94 + wave * 0.05;
      j.hips.rotation.set(0, wave * 0.09, wave * 0.06);
      j.spine.rotation.set(wave2 * 0.08, -wave * 0.06, -wave2 * 0.08);
      j.chest.rotation.set(0, 0, wave * 0.07);
      j.head.rotation.set(wave2 * 0.1, Math.sin(elapsed * 1.7) * 0.2, -wave * 0.12);

      j.leftShoulder.rotation.set(0.2 + wave * 0.22 - emote * 1.4, 0, 0.35 + wave2 * 0.18);
      j.leftElbow.rotation.x = -0.35 + wave2 * 0.2;
      j.rightShoulder.rotation.set(0.2 - wave * 0.22 - emote * 1.4, 0, -0.35 - wave2 * 0.18);
      j.rightElbow.rotation.x = -0.35 - wave2 * 0.2;

      j.leftHip.rotation.x = -emote * 0.4;
      j.leftKnee.rotation.x = emote * 0.7;
      j.rightHip.rotation.x = -emote * 0.4;
      j.rightKnee.rotation.x = emote * 0.7;
    } else if (charId === 'half_cyborg') {
      // Crisp quantized mechanical servo ticks on left arm + diagnostic head scan
      const step = Math.floor(elapsed * 1.8);
      const servoAngle = Math.sin(step * 1.9) * 0.35;
      const organicBreathe = Math.sin(elapsed * 2.5);

      j.hips.position.y = 0.94 + organicBreathe * 0.015;
      j.hips.rotation.set(0, 0, 0);
      j.spine.rotation.set(0.02, 0, 0);
      j.chest.rotation.set(0, 0, 0);
      j.head.rotation.set(0.02, THREE.MathUtils.damp(j.head.rotation.y, servoAngle, 12, 0.03), 0);

      // Mecha left arm calibrates with crisp elbow lift
      j.leftShoulder.rotation.set(-0.55 - emote * 0.9, 0, 0.28);
      j.leftElbow.rotation.x = -0.95 + Math.sin(step * 2.4) * 0.28;

      // Organic right arm stays chilled
      j.rightShoulder.rotation.set(0.1 + organicBreathe * 0.08 - emote * 1.2, 0, -0.18);
      j.rightElbow.rotation.x = -0.3;

      j.leftHip.rotation.x = 0;
      j.leftKnee.rotation.x = 0.05;
      j.rightHip.rotation.x = 0;
      j.rightKnee.rotation.x = 0.05;
    } else {
      // Void Shadow: mystical levitation pose with clawed hands hovering & dark aura
      const hover = Math.sin(elapsed * 2.2);
      j.hips.position.y = 0.98 + hover * 0.04;
      j.hips.rotation.set(0, Math.sin(elapsed * 0.9) * 0.08, 0);
      j.spine.rotation.set(-0.06, 0, 0);
      j.chest.rotation.set(0.04 - emote * 0.15, 0, 0);
      j.head.rotation.set(0.08 + hover * 0.05, Math.sin(elapsed * 1.1) * 0.16, 0);

      j.leftShoulder.rotation.set(-0.35 - emote * 1.0, 0, 0.42 + hover * 0.08);
      j.leftElbow.rotation.x = -0.82;
      j.rightShoulder.rotation.set(-0.35 - emote * 1.0, 0, -0.42 - hover * 0.08);
      j.rightElbow.rotation.x = -0.82;

      // Relaxed hovering legs trailing slightly back
      j.leftHip.rotation.x = 0.24 + hover * 0.08;
      j.leftKnee.rotation.x = 0.35;
      j.rightHip.rotation.x = 0.14 - hover * 0.08;
      j.rightKnee.rotation.x = 0.45;
    }
  }

  public dispose(): void {
    this.disposeContainer();
    this.bladeTrail.dispose();
    this.toonGradient.dispose();
    this.inkOutlineMat.dispose();
    this.flameOutlineMat.dispose();
    this.slimeOutlineMat.dispose();
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
