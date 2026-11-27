import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { YETI_MODEL_URL, getCharacterById } from './config';
import { AccessorySpringController, type AccessoryPhysicsState } from './springPhysics';
import { BladeRibbonTrail, buildSignatureSword, type SignatureSwordRig } from './swordSystem';
import {
  createCyborgBodyTexture,
  createRadialShadowTexture,
} from './textures';
import type { CharacterConfig, CharacterId } from './types';

export type YetiAnimState =
  | 'idle'
  | 'run'
  | 'jump'
  | 'slide'
  | 'flip'
  | 'fly'
  | 'hit'
  | 'slash'
  | 'worldSlide'
  | 'spaceFloat';

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
  private maxAniso: number;

  constructor(
    initialChar: CharacterId,
    onSourceChange?: (src: 'procedural' | 'glb') => void,
    maxAniso = 4,
  ) {
    this.maxAniso = maxAniso;
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

  /**
   * Adds a seamless left (-X) and right (+X) 50/50 split ellipsoid with ONE unified BackSide ink outline
   * so Half-Cyborg and Void Shadow split cleanly down the vertical centerline with zero seam gap!
   * Note: Three.js SphereGeometry uses x = -R*cos(phi)*sin(theta), z = R*sin(phi)*sin(theta):
   *   -X (left half):  phiStart = -Math.PI * 0.5, phiLength = Math.PI
   *   +X (right half): phiStart =  Math.PI * 0.5, phiLength = Math.PI
   */
  private addSplitEllipsoid(
    parent: THREE.Object3D,
    radius: number,
    leftMat: THREE.Material,
    rightMat: THREE.Material,
    pos: [number, number, number],
    scale: [number, number, number],
    outlineMat: THREE.Material | null = this.inkOutlineMat,
    outlineScale = 1.07,
  ): void {
    const leftGeo = new THREE.SphereGeometry(radius, 18, 16, -Math.PI * 0.5, Math.PI);
    const rightGeo = new THREE.SphereGeometry(radius, 18, 16, Math.PI * 0.5, Math.PI);
    this.addOutlined(parent, leftGeo, leftMat, pos, scale, [0, 0, 0], null);
    this.addOutlined(parent, rightGeo, rightMat, pos, scale, [0, 0, 0], null);

    if (outlineMat) {
      const outlineMesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 18, 16), outlineMat);
      outlineMesh.position.set(pos[0], pos[1], pos[2]);
      outlineMesh.scale.set(
        scale[0] * outlineScale,
        scale[1] * outlineScale,
        scale[2] * outlineScale,
      );
      parent.add(outlineMesh);
    }
  }

  /**
   * Sculpted agile Yeti cranium topology: tapers the cheeks/jaw and upper dome while trimming
   * occiput (back-of-head) bulk so every character reads sleek and athletic from all camera angles.
   */
  private createSculptedHeadGeometry(
    radius: number,
    phiStart = 0,
    phiLength = Math.PI * 2,
  ): THREE.SphereGeometry {
    const geo = new THREE.SphereGeometry(radius, 20, 18, phiStart, phiLength);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i);
      const y = pos.getY(i);
      let z = pos.getZ(i);

      const ny = y / radius; // -1 (chin) .. +1 (crown)
      const lower = Math.max(0, 0.08 - ny);
      const upper = Math.max(0, ny - 0.25);

      const jawTaper = 1 - 0.17 * lower * lower - 0.06 * lower;
      const crownTaper = 1 - 0.1 * upper * upper;

      // Narrow lateral girth smoothly across cheeks, jaw, and crown to harmonize with the athletic torso & hands
      x *= 0.85 * jawTaper * crownTaper;

      // Keep the front face well-supported for facial features while trimming rear cranium depth
      if (z < 0) {
        z *= 0.83 * crownTaper;
      } else {
        z *= 0.96;
      }

      pos.setXYZ(i, x, y, z);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  }

  /**
   * 50/50 split sculpted cranium (left -X / right +X) sharing the same agile head topology & unified outline.
   */
  private addSplitHeadCranium(
    parent: THREE.Object3D,
    radius: number,
    leftMat: THREE.Material,
    rightMat: THREE.Material,
    pos: [number, number, number],
    scale: [number, number, number],
    outlineMat: THREE.Material | null = this.inkOutlineMat,
    outlineScale = 1.07,
  ): void {
    const leftGeo = this.createSculptedHeadGeometry(radius, -Math.PI * 0.5, Math.PI);
    const rightGeo = this.createSculptedHeadGeometry(radius, Math.PI * 0.5, Math.PI);
    this.addOutlined(parent, leftGeo, leftMat, pos, scale, [0, 0, 0], null);
    this.addOutlined(parent, rightGeo, rightMat, pos, scale, [0, 0, 0], null);

    if (outlineMat) {
      const outlineMesh = new THREE.Mesh(this.createSculptedHeadGeometry(radius), outlineMat);
      outlineMesh.position.set(pos[0], pos[1], pos[2]);
      outlineMesh.scale.set(
        scale[0] * outlineScale,
        scale[1] * outlineScale,
        scale[2] * outlineScale,
      );
      parent.add(outlineMesh);
    }
  }

  /**
   * Sculpted 2-segment curved Yeti horn (sweeps outward then tips upward cleanly like the original artwork).
   */
  private addCurvedHorn(
    parent: THREE.Object3D,
    mat: THREE.Material,
    side: -1 | 1,
    outlineMat: THREE.Material | null = this.inkOutlineMat,
    size = 1.0,
  ): void {
    const base = new THREE.Group();
    base.position.set(side * 0.24, 0.43, 0.07);
    base.rotation.set(0.18, 0, -side * 0.44);
    parent.add(base);

    this.addOutlined(
      base,
      new THREE.CylinderGeometry(0.068 * size, 0.095 * size, 0.18 * size, 8),
      mat,
      [0, 0.08 * size, 0],
      [1, 1, 1],
      [0, 0, 0],
      outlineMat,
      1.09,
    );
    this.addOutlined(
      base,
      new THREE.ConeGeometry(0.068 * size, 0.2 * size, 8),
      mat,
      [-side * 0.025 * size, 0.24 * size, 0.02 * size],
      [1, 1, 1],
      [0.14, 0, side * 0.34],
      outlineMat,
      1.09,
    );
  }

  /**
   * Sculpted sinuous wavy Pepe-Yeti lips hugging the curved 3D muzzle (inspired directly by
   * the OG Lofi & Half-Cyborg reference art — zero straight sausage capsules!).
   * Supports 'full' (OG Lofi), 'right' (+X organic half), or 'left' (-X mechanical segmented half).
   */
  private addSculptedWavyLips(
    parent: THREE.Object3D,
    upperMat: THREE.Material,
    lowerMat: THREE.Material,
    creaseMat: THREE.Material,
    outlineMat: THREE.Material | null,
    mode: 'full' | 'right' | 'left',
    addMechaRivets = false,
  ): void {
    // Smooth 3D contour wrapping naturally around the rounded muzzle curvature (z pulls back at corners)
    const upperFull: [number, number, number][] = [
      [-0.245, -0.155, 0.415],
      [-0.175, -0.132, 0.478],
      [-0.088, -0.146, 0.514],
      [0.0, -0.162, 0.525],
      [0.088, -0.146, 0.514],
      [0.175, -0.132, 0.478],
      [0.245, -0.155, 0.415],
    ];
    const creaseFull: [number, number, number][] = [
      [-0.242, -0.174, 0.422],
      [-0.168, -0.168, 0.484],
      [-0.082, -0.178, 0.522],
      [0.0, -0.186, 0.532],
      [0.082, -0.178, 0.522],
      [0.168, -0.168, 0.484],
      [0.242, -0.174, 0.422],
    ];
    const lowerFull: [number, number, number][] = [
      [-0.23, -0.194, 0.415],
      [-0.15, -0.218, 0.474],
      [-0.068, -0.226, 0.508],
      [0.0, -0.228, 0.516],
      [0.068, -0.226, 0.508],
      [0.15, -0.218, 0.474],
      [0.23, -0.194, 0.415],
    ];

    const filterPts = (pts: [number, number, number][]): THREE.Vector3[] => {
      const sliced =
        mode === 'right'
          ? pts.filter((p) => p[0] >= -0.005)
          : mode === 'left'
            ? pts.filter((p) => p[0] <= 0.005)
            : pts;
      return sliced.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    };

    const segs = mode === 'full' ? 20 : 12;
    const upperCurve = new THREE.CatmullRomCurve3(filterPts(upperFull));
    const creaseCurve = new THREE.CatmullRomCurve3(filterPts(creaseFull));
    const lowerCurve = new THREE.CatmullRomCurve3(filterPts(lowerFull));

    this.addOutlined(
      parent,
      new THREE.TubeGeometry(upperCurve, segs, 0.032, 8, false),
      upperMat,
      [0, 0, 0],
      [1, 1, 1],
      [0, 0, 0],
      outlineMat,
      1.09,
    );
    this.addOutlined(
      parent,
      new THREE.TubeGeometry(lowerCurve, segs, 0.03, 8, false),
      lowerMat,
      [0, 0, 0],
      [1, 1, 1],
      [0, 0, 0],
      outlineMat,
      1.09,
    );
    // Crisp dark mouth-parting line nestled right between the sculpted upper & lower lips
    this.addOutlined(
      parent,
      new THREE.TubeGeometry(creaseCurve, segs, 0.011, 6, false),
      creaseMat,
      [0, 0, 0.008],
      [1, 1, 1],
      [0, 0, 0],
      null,
    );

    // Smooth rounded mouth corner caps so tube ends feel sculpted and organic
    if (mode === 'full' || mode === 'right') {
      this.addOutlined(parent, new THREE.SphereGeometry(0.032, 8, 8), upperMat, [0.244, -0.165, 0.414], [1, 1.05, 0.9], [0, 0, 0], outlineMat, 1.09);
    }
    if (mode === 'full' || mode === 'left') {
      this.addOutlined(parent, new THREE.SphereGeometry(0.032, 8, 8), upperMat, [-0.244, -0.165, 0.414], [1, 1.05, 0.9], [0, 0, 0], outlineMat, 1.09);
    }

    // Half-Cyborg articulated mechanical joint seams & rivets along the robotic tubing lip
    if (addMechaRivets && mode === 'left') {
      const rivetMat = creaseMat;
      const jointTs = [0.28, 0.62];
      for (const t of jointTs) {
        const up = upperCurve.getPoint(t);
        const lo = lowerCurve.getPoint(t);
        this.addOutlined(parent, new THREE.TorusGeometry(0.035, 0.007, 6, 10), rivetMat, [up.x, up.y, up.z], [1, 1, 1], [0, Math.PI / 2, 0], null);
        this.addOutlined(parent, new THREE.TorusGeometry(0.033, 0.007, 6, 10), rivetMat, [lo.x, lo.y, lo.z], [1, 1, 1], [0, Math.PI / 2, 0], null);
      }
      // Signature tiny bolt pins along the curved metal lip
      this.addOutlined(parent, new THREE.SphereGeometry(0.012, 6, 6), rivetMat, [-0.045, -0.158, 0.548], [1, 1, 1], [0, 0, 0], null);
      this.addOutlined(parent, new THREE.SphereGeometry(0.012, 6, 6), rivetMat, [-0.155, -0.14, 0.512], [1, 1, 1], [0, 0, 0], null);
      this.addOutlined(parent, new THREE.SphereGeometry(0.012, 6, 6), rivetMat, [-0.045, -0.222, 0.54], [1, 1, 1], [0, 0, 0], null);
    }
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
          mats.forEach((m) => {
            if (m && 'map' in m && (m as THREE.MeshStandardMaterial).map) {
              (m as THREE.MeshStandardMaterial).map?.dispose();
            }
            m?.dispose();
          });
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
    head.position.set(0, 0.5, 0.02);
    // Thinner, athletic head scale balanced cleanly with the leaner torso and sturdier hands
    head.scale.set(0.66, 0.77, 0.68);
    chest.add(head);

    const leftShoulder = new THREE.Group();
    leftShoulder.position.set(-0.46, 0.26, 0.02);
    chest.add(leftShoulder);

    const leftElbow = new THREE.Group();
    leftElbow.position.set(-0.055, -0.35, 0.01);
    leftShoulder.add(leftElbow);

    const rightShoulder = new THREE.Group();
    rightShoulder.position.set(0.46, 0.26, 0.02);
    chest.add(rightShoulder);

    const rightElbow = new THREE.Group();
    rightElbow.position.set(0.055, -0.35, 0.01);
    rightShoulder.add(rightElbow);

    const leftHip = new THREE.Group();
    leftHip.position.set(-0.19, -0.02, 0);
    hips.add(leftHip);

    const leftKnee = new THREE.Group();
    leftKnee.position.set(0, -0.44, 0);
    leftHip.add(leftKnee);

    const rightHip = new THREE.Group();
    rightHip.position.set(0.19, -0.02, 0);
    hips.add(rightHip);

    const rightKnee = new THREE.Group();
    rightKnee.position.set(0, -0.44, 0);
    rightHip.add(rightKnee);

    const backAccessory = new THREE.Group();
    backAccessory.position.set(0, 0.14, -0.32);
    chest.add(backAccessory);

    // Spring-driven Ear Flap pivots (hugged close to the slimmer temples)
    const leftEarPivot = new THREE.Group();
    leftEarPivot.position.set(-0.38, 0.1, 0);
    head.add(leftEarPivot);

    const rightEarPivot = new THREE.Group();
    rightEarPivot.position.set(0.38, 0.1, 0);
    head.add(rightEarPivot);

    // Spring-driven Hip Pouch pivots (attached to left & right waist)
    const leftPouchPivot = new THREE.Group();
    leftPouchPivot.position.set(-0.35, 0.08, 0.06);
    hips.add(leftPouchPivot);

    const rightPouchPivot = new THREE.Group();
    rightPouchPivot.position.set(0.35, 0.08, 0.06);
    hips.add(rightPouchPivot);

    // Spring-driven Chest Medallion / Pendant pivot
    const pendantPivot = new THREE.Group();
    pendantPivot.position.set(0, 0.17, 0.34);
    chest.add(pendantPivot);

    // Coupled 2-link Tail / Cape pivots (Root -> Tip)
    const tailRootPivot = new THREE.Group();
    tailRootPivot.position.set(0, -0.22, -0.04);
    backAccessory.add(tailRootPivot);

    const tailTipPivot = new THREE.Group();
    tailTipPivot.position.set(0, -0.34, -0.18);
    tailRootPivot.add(tailTipPivot);

    this.swordGroup.position.set(0.02, -0.37, 0.105);
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
    // True 3D sculpted OG Lofi Yeti: athletic shaggy white fur body with layered chest/belly fur,
    // sculpted 3D sleepy Pepe-style eyes & contoured glacier-blue upper face integrated seamlessly
    // into the cranium (zero flat mask!), rounded cool-grey muzzle, wavy glacier-blue lips,
    // 2-segment curved glacier-blue horns, cup ears, and 3-fingered hands / 3-toed Yeti feet!
    const fur = this.toon(0xf8fafc);
    const furShade = this.toon(0xe2edf8);
    const blueSkin = this.toon(0x5ea3e8);
    const blueDark = this.toon(0x2563eb);
    const faceShade = this.toon(0x2b6cb0);
    const muzzle = this.toon(0xdbe4ef);
    const hornMat = this.toon(0x4b89d6);
    const whiteEye = this.toon(0xffffff);
    const eyeNavy = this.toon(0x172554);

    // Lean athletic shaggy Yeti torso tailored to balance with the hands & head
    this.addOutlined(j.spine, new THREE.SphereGeometry(0.36, 16, 14), fur, [0, 0.08, 0], [0.84, 0.92, 0.8]);
    this.addOutlined(j.spine, new THREE.SphereGeometry(0.27, 14, 12), furShade, [0, 0.06, 0.13], [0.86, 0.85, 0.66], [0, 0, 0], null);
    this.addOutlined(j.chest, new THREE.SphereGeometry(0.4, 16, 14), fur, [0, 0.1, 0], [0.92, 1.04, 0.82]);
    // Sculpted furry pecs & trimmed shaggy collar ruff
    this.addOutlined(j.chest, new THREE.SphereGeometry(0.18, 12, 10), fur, [-0.135, 0.14, 0.21], [0.94, 0.86, 0.66], [0, 0, 0], null);
    this.addOutlined(j.chest, new THREE.SphereGeometry(0.18, 12, 10), fur, [0.135, 0.14, 0.21], [0.94, 0.86, 0.66], [0, 0, 0], null);

    const tuftGeo = new THREE.ConeGeometry(0.105, 0.26, 6);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      this.addOutlined(
        j.chest,
        tuftGeo,
        fur,
        [Math.sin(a) * 0.34, 0.3, Math.cos(a) * 0.29],
        [0.86, 0.92, 0.86],
        [Math.cos(a) * 0.48, 0, -Math.sin(a) * 0.48],
      );
    }
    // Lower waist shaggy fur skirt tufts
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this.addOutlined(
        j.spine,
        tuftGeo,
        fur,
        [Math.sin(a) * 0.29, -0.05, Math.cos(a) * 0.25],
        [0.74, 0.78, 0.74],
        [Math.PI - Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3],
      );
    }

    // Seamless sculpted 3D OG Lofi Head with tapered cranium & trimmed fur halo
    this.addOutlined(j.head, this.createSculptedHeadGeometry(0.47), fur, [0, 0.04, -0.02], [0.98, 1.01, 0.96]);

    // Trimmed shaggy white Yeti fur halo framing the sleeker face without excess side girth
    const headHaloSpikes: [number, number, number, number, number][] = [
      [-0.19, 0.46, 0.0, 0.9, 0.3],
      [-0.03, 0.53, 0.0, 1.04, 0.05],
      [0.12, 0.5, 0.0, 0.98, -0.18],
      [0.24, 0.42, -0.02, 0.86, -0.36],
      [-0.38, 0.22, 0.0, 0.82, 0.92],
      [0.38, 0.22, 0.0, 0.82, -0.92],
      [-0.39, -0.04, 0.02, 0.84, 1.32],
      [0.39, -0.04, 0.02, 0.84, -1.32],
      [-0.3, -0.3, 0.04, 0.78, 2.0],
      [0.3, -0.3, 0.04, 0.78, -2.0],
      [0, -0.41, 0.05, 0.8, Math.PI],
    ];
    for (const [sx, sy, sz, sc, rz] of headHaloSpikes) {
      this.addOutlined(j.head, tuftGeo, fur, [sx, sy, sz], [sc * 0.72, sc * 0.86, sc * 0.72], [0.06, 0, rz]);
    }

    // Seamlessly contoured glacier-blue upper face & rounded cool-grey muzzle fitted to the trimmer cranium
    this.addOutlined(j.head, new THREE.SphereGeometry(0.365, 16, 14), blueSkin, [0, 0.13, 0.2], [0.94, 0.64, 0.82], [0, 0, 0], null);
    this.addOutlined(j.head, new THREE.SphereGeometry(0.34, 16, 14), muzzle, [0, -0.14, 0.24], [0.93, 0.71, 0.84], [0, 0, 0], null);

    // Clean, expressive sleepy 3D Pepe-style almond eyes with glacier-blue brow folds (zero black outlines on face!)
    const eyeGeo = new THREE.SphereGeometry(0.135, 14, 12);
    const pupilGeo = new THREE.SphereGeometry(0.074, 12, 10);
    const specGeo = new THREE.SphereGeometry(0.025, 8, 8);
    for (const side of [-1, 1] as const) {
      this.addOutlined(j.head, eyeGeo, whiteEye, [side * 0.162, 0.125, 0.43], [1.32, 0.8, 0.48], [0, side * 0.18, 0], null);
      this.addOutlined(j.head, pupilGeo, eyeNavy, [side * 0.152, 0.118, 0.485], [1.0, 0.94, 0.42], [0, side * 0.18, 0], null);
      this.addOutlined(j.head, specGeo, whiteEye, [side * 0.152 - 0.024, 0.148, 0.515], [1, 1, 1], [0, 0, 0], null);

      // Smooth glacier-blue upper eyelid fold & soft second brow arch (zero dark outlines)
      const lidCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * 0.025, 0.185, 0.49),
        new THREE.Vector3(side * 0.155, 0.228, 0.472),
        new THREE.Vector3(side * 0.295, 0.185, 0.398),
      ]);
      this.addOutlined(j.head, new THREE.TubeGeometry(lidCurve, 10, 0.032, 7, false), blueSkin, [0, 0, 0], [1, 1, 1], [0, 0, 0], null);
      const upperFoldCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * 0.03, 0.245, 0.468),
        new THREE.Vector3(side * 0.155, 0.282, 0.45),
        new THREE.Vector3(side * 0.29, 0.242, 0.382),
      ]);
      this.addOutlined(j.head, new THREE.TubeGeometry(upperFoldCurve, 10, 0.022, 6, false), blueSkin, [0, 0, 0], [1, 1, 1], [0, 0, 0], null);
    }

    // Sculpted glacier-blue Yeti nose with subtle deep-blue shaded nostrils (no black blotches!)
    this.addOutlined(j.head, new THREE.SphereGeometry(0.088, 12, 10), blueSkin, [0, -0.02, 0.495], [1.26, 0.86, 0.72], [0, 0, 0], null);
    this.addOutlined(j.head, new THREE.SphereGeometry(0.019, 8, 8), faceShade, [-0.04, -0.035, 0.553], [1.05, 0.85, 0.55], [0, 0, 0], null);
    this.addOutlined(j.head, new THREE.SphereGeometry(0.019, 8, 8), faceShade, [0.04, -0.035, 0.553], [1.05, 0.85, 0.55], [0, 0, 0], null);

    // Clean sinuous wavy glacier-blue OG Lofi lips with soft blue mouth crease (zero black ink on face!)
    this.addSculptedWavyLips(j.head, blueSkin, blueSkin, faceShade, null, 'full');

    // 2-segment curved glacier-blue horns & cup ears
    this.addCurvedHorn(j.head, hornMat, -1, this.inkOutlineMat, 0.95);
    this.addCurvedHorn(j.head, hornMat, 1, this.inkOutlineMat, 1.04);

    const earOuterGeo = new THREE.SphereGeometry(0.145, 12, 10);
    const earInnerGeo = new THREE.SphereGeometry(0.085, 10, 8);
    this.addOutlined(j.leftEarPivot, earOuterGeo, blueSkin, [-0.08, -0.02, 0.02], [0.78, 1.0, 0.65]);
    this.addOutlined(j.leftEarPivot, earInnerGeo, blueDark, [-0.08, -0.02, 0.09], [0.72, 0.9, 0.38], [0, 0, 0], null);
    this.addOutlined(j.rightEarPivot, earOuterGeo, blueSkin, [0.08, -0.02, 0.02], [0.78, 1.0, 0.65]);
    this.addOutlined(j.rightEarPivot, earInnerGeo, blueDark, [0.08, -0.02, 0.09], [0.72, 0.9, 0.38], [0, 0, 0], null);

    // Fluffy shaggy tail
    this.addOutlined(j.tailRootPivot, new THREE.CapsuleGeometry(0.15, 0.24, 5, 8), fur, [0, -0.12, -0.1], [1, 1, 1], [-0.85, 0, 0]);
    this.addOutlined(j.tailTipPivot, new THREE.ConeGeometry(0.17, 0.42, 8), fur, [0, -0.04, -0.16], [1, 1, 1], [-Math.PI * 0.62, 0, 0]);

    this.buildArticulatedLimbs(j, fur, fur, blueSkin, blueSkin, fur, this.inkOutlineMat, 'fur');
  }

  private buildInfernoBlaze(j: ArticulatedJoints): void {
    // True 3D sculpted Inferno Blaze: muscular magma-orange & golden-yellow flame torso with glowing
    // solar chest core & flame pauldrons, towering curling golden flame hair, fierce pale-yellow 3D
    // flame brows, and wide clenched 3D toothy grin framed by golden flame lips!
    const flameOrange = this.toon(0xf97316, { emissive: 0xc2410c, emissiveIntensity: 0.36 });
    const flameGold = this.toon(0xfacc15, { emissive: 0xf59e0b, emissiveIntensity: 0.56 });
    const flameCore = this.toon(0xfef08a, { emissive: 0xfde047, emissiveIntensity: 0.75 });
    const emberBody = this.toon(0xea580c, { emissive: 0x9a3412, emissiveIntensity: 0.32 });
    const teethMat = this.toon(0xfef9c3);
    const mouthDark = this.toon(0x7c2d12);

    // Lean sculpted flame torso with glowing golden chest/ab flame ridges
    this.addOutlined(j.spine, new THREE.SphereGeometry(0.355, 16, 14), emberBody, [0, 0.08, 0], [0.84, 0.92, 0.78], [0, 0, 0], this.flameOutlineMat);
    this.addOutlined(j.chest, new THREE.SphereGeometry(0.4, 16, 14), flameOrange, [0, 0.1, 0], [0.92, 1.04, 0.81], [0, 0, 0], this.flameOutlineMat);
    this.addOutlined(j.chest, new THREE.SphereGeometry(0.21, 12, 10), flameGold, [0, 0.1, 0.21], [0.98, 0.92, 0.58], [0, 0, 0], null);
    this.addOutlined(j.spine, new THREE.SphereGeometry(0.165, 10, 8), flameGold, [0, 0.1, 0.2], [0.9, 0.78, 0.54], [0, 0, 0], null);

    // Streamlined collar flame pauldrons hugging the slimmer torso
    const tongueGeo = new THREE.ConeGeometry(0.145, 0.48, 6);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const f = this.addOutlined(
        j.chest,
        tongueGeo,
        i % 2 === 0 ? flameGold : flameOrange,
        [Math.sin(a) * 0.37, 0.34, Math.cos(a) * 0.3],
        [0.92, 1.12, 0.92],
        [0, a, -Math.sin(a) * 0.28],
        this.flameOutlineMat,
      );
      j.flames.push(f);
    }

    // Seamless 3D sculpted Inferno Head + streamlined billowing fire mane
    this.addOutlined(j.head, this.createSculptedHeadGeometry(0.47), flameOrange, [0, 0.04, -0.02], [0.98, 1.02, 0.96], [0, 0, 0], this.flameOutlineMat);

    const crownGeo = new THREE.ConeGeometry(0.21, 0.88, 7);
    const crownSpecs: [number, number, number, number, number, boolean][] = [
      [0, 0.7, -0.04, 1.2, 0, true],
      [-0.22, 0.58, 0.02, 0.96, 0.24, false],
      [0.22, 0.58, 0.02, 0.96, -0.24, false],
      [-0.36, 0.34, -0.02, 0.78, 0.56, false],
      [0.36, 0.34, -0.02, 0.78, -0.56, false],
      [-0.14, 0.62, -0.2, 1.04, 0.12, true],
      [0.14, 0.62, -0.2, 1.04, -0.12, true],
    ];
    for (const [x, y, z, s, rz, isCore] of crownSpecs) {
      const plume = this.addOutlined(
        j.head,
        crownGeo,
        isCore ? flameCore : flameGold,
        [x, y, z],
        [s * 0.9, s * 1.15, s * 0.9],
        [-0.14, 0, rz],
        this.flameOutlineMat,
      );
      j.flames.push(plume);
    }

    // Fierce, focused sculpted flame warrior brows & blazing golden-white squinted eyes!
    const eyeSquintGeo = new THREE.SphereGeometry(0.098, 12, 10);
    for (const side of [-1, 1] as const) {
      // Glowing white-gold warrior eyes narrowed with crimson rim
      this.addOutlined(j.head, eyeSquintGeo, flameCore, [side * 0.165, 0.12, 0.44], [1.34, 0.46, 0.44], [0, side * 0.2, -side * 0.16], this.flameOutlineMat, 1.09);
      // Swept fierce golden flame brow ridge
      const browCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * 0.04, 0.185, 0.495),
        new THREE.Vector3(side * 0.175, 0.24, 0.468),
        new THREE.Vector3(side * 0.32, 0.275, 0.385),
      ]);
      this.addOutlined(j.head, new THREE.TubeGeometry(browCurve, 10, 0.036, 7, false), flameGold, [0, 0, 0], [1, 1, 1], [0, 0, 0], this.flameOutlineMat, 1.08);
    }

    // Sculpted flame Yeti nose with twin dark ember nostrils (inspired by Inferno Blaze artwork)
    this.addOutlined(j.head, new THREE.SphereGeometry(0.085, 12, 10), emberBody, [0, -0.025, 0.49], [1.22, 0.82, 0.72], [0, 0, 0], this.flameOutlineMat, 1.08);
    this.addOutlined(j.head, new THREE.SphereGeometry(0.022, 8, 8), mouthDark, [-0.038, -0.042, 0.545], [1, 0.88, 0.6], [0, 0, 0], null);
    this.addOutlined(j.head, new THREE.SphereGeometry(0.022, 8, 8), mouthDark, [0.038, -0.042, 0.545], [1, 0.88, 0.6], [0, 0, 0], null);

    // Iconic lush sweeping golden-cream flame mustache (directly from Inferno Blaze art!) — ZERO cringe tooth box!
    for (const side of [-1, 1] as const) {
      const stacheMain = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * 0.025, -0.115, 0.515),
        new THREE.Vector3(side * 0.16, -0.095, 0.505),
        new THREE.Vector3(side * 0.31, -0.165, 0.425),
        new THREE.Vector3(side * 0.42, -0.265, 0.325),
      ]);
      this.addOutlined(j.head, new THREE.TubeGeometry(stacheMain, 12, 0.056, 8, false), flameGold, [0, 0, 0], [1, 1, 1], [0, 0, 0], this.flameOutlineMat, 1.08);
      // Bright cream-yellow specular highlight riding the upper crest of the mustache
      const stacheHi = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * 0.04, -0.09, 0.53),
        new THREE.Vector3(side * 0.155, -0.075, 0.52),
        new THREE.Vector3(side * 0.26, -0.12, 0.46),
      ]);
      this.addOutlined(j.head, new THREE.TubeGeometry(stacheHi, 8, 0.028, 6, false), teethMat, [0, 0, 0], [1, 1, 1], [0, 0, 0], null);
    }

    // Cool, understated sculpted confident ember smirk tucked neatly beneath the mustache
    const smirkCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.135, -0.228, 0.478),
      new THREE.Vector3(-0.04, -0.242, 0.505),
      new THREE.Vector3(0.06, -0.236, 0.502),
      new THREE.Vector3(0.155, -0.208, 0.468),
    ]);
    this.addOutlined(j.head, new THREE.TubeGeometry(smirkCurve, 10, 0.017, 6, false), mouthDark, [0, 0, 0], [1, 1, 1], [0, 0, 0], null);
    // Subtle fiery lower lip accent below smirk
    const lowerSmirk = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.095, -0.268, 0.478),
      new THREE.Vector3(0.0, -0.278, 0.495),
      new THREE.Vector3(0.095, -0.262, 0.476),
    ]);
    this.addOutlined(j.head, new THREE.TubeGeometry(lowerSmirk, 8, 0.024, 6, false), flameGold, [0, 0, 0], [1, 1, 1], [0, 0, 0], this.flameOutlineMat, 1.07);

    // Streamlined cheek & chin flame goatee/beard tufts
    const cheekFlameGeo = new THREE.ConeGeometry(0.12, 0.38, 6);
    const beardL = this.addOutlined(j.head, cheekFlameGeo, flameGold, [-0.29, -0.26, 0.16], [0.84, 0.95, 0.76], [0.1, 0, 2.15], this.flameOutlineMat);
    const beardR = this.addOutlined(j.head, cheekFlameGeo, flameGold, [0.29, -0.26, 0.16], [0.84, 0.95, 0.76], [0.1, 0, -2.15], this.flameOutlineMat);
    const beardC = this.addOutlined(j.head, new THREE.ConeGeometry(0.18, 0.4, 6), flameOrange, [0, -0.42, 0.24], [1.0, 0.96, 0.72], [Math.PI - 0.12, 0, 0], this.flameOutlineMat);
    j.flames.push(beardL, beardR, beardC);

    this.addOutlined(j.leftEarPivot, new THREE.SphereGeometry(0.13, 10, 8), flameOrange, [-0.08, -0.02, 0], [0.8, 1.05, 0.7], [0, 0, 0.25], this.flameOutlineMat);
    this.addOutlined(j.rightEarPivot, new THREE.SphereGeometry(0.13, 10, 8), flameOrange, [0.08, -0.02, 0], [0.8, 1.05, 0.7], [0, 0, -0.25], this.flameOutlineMat);

    const rootFlame = this.addOutlined(j.tailRootPivot, new THREE.ConeGeometry(0.2, 0.48, 6), flameOrange, [0, -0.08, -0.12], [1, 1, 1], [-0.85, 0, 0], this.flameOutlineMat);
    const tipFlame = this.addOutlined(j.tailTipPivot, new THREE.ConeGeometry(0.19, 0.58, 6), flameGold, [0, -0.04, -0.18], [1, 1, 1], [-0.95, 0, 0], this.flameOutlineMat);
    j.flames.push(rootFlame, tipFlame);

    this.buildArticulatedLimbs(j, emberBody, flameOrange, flameGold, flameGold, flameGold, this.flameOutlineMat, 'flame');
  }

  private buildNeonSlime(j: ArticulatedJoints): void {
    // True 3D sculpted Neon Slime: translucent mint-emerald gelatinous Yeti body revealing a full
    // glowing chartreuse-lime internal skeleton (spine, 4-rib cage, pelvis & limb bones), and a
    // glossy dripping slime head with sleepy translucent eyes melting into an exposed glowing 3D skull jaw!
    const gelOuter = this.toon(0x4ade80, {
      emissive: 0x16a34a,
      emissiveIntensity: 0.42,
      transparent: true,
      opacity: 0.56,
      depthWrite: false,
    });
    const gelDense = this.toon(0x22c55e, {
      emissive: 0x15803d,
      emissiveIntensity: 0.35,
    });
    const boneCore = this.toon(0xd9f99d, {
      emissive: 0x84cc16,
      emissiveIntensity: 0.88,
    });
    const darkSlime = this.toon(0x052e16);

    // Full internal glowing chartreuse-lime skeleton (pelvis, spine vertebrae & 4 curved ribs fitted to leaner torso)
    this.addOutlined(j.spine, new THREE.TorusGeometry(0.185, 0.05, 6, 14), boneCore, [0, 0.04, 0], [1.02, 0.72, 0.78], [Math.PI / 2, 0, 0], null);
    this.addOutlined(j.chest, new THREE.CylinderGeometry(0.068, 0.075, 0.74, 8), boneCore, [0, 0.04, -0.03], [1, 1, 1], [0, 0, 0], null);
    for (let r = 0; r < 4; r++) {
      this.addOutlined(
        j.chest,
        new THREE.TorusGeometry(0.22 - r * 0.018, 0.036, 6, 16),
        boneCore,
        [0, 0.25 - r * 0.14, 0.015],
        [1.06, 0.8, 0.76],
        [Math.PI / 2, 0, 0],
        null,
      );
    }

    // Translucent lean athletic slime torso shell
    const jellyBelly = this.addOutlined(j.spine, new THREE.SphereGeometry(0.36, 16, 14), gelOuter, [0, 0.08, 0], [0.85, 0.92, 0.8], [0, 0, 0], this.slimeOutlineMat);
    const jellyChest = this.addOutlined(j.chest, new THREE.SphereGeometry(0.4, 16, 14), gelOuter, [0, 0.1, 0], [0.92, 1.04, 0.82], [0, 0, 0], this.slimeOutlineMat);
    j.slimeShells.push(jellyBelly, jellyChest);

    // Real 3D glowing inner skull cranium + protruding exposed 3D grinning skull jaw!
    this.addOutlined(j.head, new THREE.SphereGeometry(0.32, 14, 12), boneCore, [0, 0.08, 0.02], [0.92, 0.94, 0.9], [0, 0, 0], null);
    this.addOutlined(j.head, new THREE.BoxGeometry(0.45, 0.18, 0.23), darkSlime, [0, -0.15, 0.34], [1, 1, 1], [0, 0, 0], this.slimeOutlineMat, 1.06);
    const skullToothGeo = new THREE.BoxGeometry(0.064, 0.14, 0.08);
    for (let t = 0; t < 6; t++) {
      const tx = -0.18 + t * 0.072;
      const tz = 0.448 - Math.abs(tx) * 0.15;
      this.addOutlined(j.head, skullToothGeo, boneCore, [tx, -0.15, tz], [1, 1, 1], [0, tx * 0.6, 0], this.slimeOutlineMat, 1.05);
    }

    // Sleepy translucent green eyes & dripping slime nose melting over the skull grin!
    const eyeGeo = new THREE.SphereGeometry(0.125, 12, 10);
    const pupilGeo = new THREE.SphereGeometry(0.062, 10, 8);
    for (const side of [-1, 1] as const) {
      this.addOutlined(j.head, eyeGeo, boneCore, [side * 0.16, 0.12, 0.42], [1.22, 0.78, 0.48], [0, side * 0.18, 0], this.slimeOutlineMat, 1.08);
      this.addOutlined(j.head, pupilGeo, darkSlime, [side * 0.155, 0.11, 0.47], [1, 0.9, 0.45], [0, side * 0.18, 0], null);
      this.addOutlined(j.head, new THREE.CapsuleGeometry(0.055, 0.2, 5, 8), gelDense, [side * 0.16, 0.195, 0.43], [1, 0.9, 0.72], [0, side * 0.18, Math.PI / 2 - side * 0.08], this.slimeOutlineMat, 1.06);
    }
    this.addOutlined(j.head, new THREE.SphereGeometry(0.075, 10, 8), gelDense, [0, -0.01, 0.48], [1.2, 0.85, 0.75], [0, 0, 0], this.slimeOutlineMat);

    // Translucent sculpted dripping slime outer head dome with reduced girth
    const jellyHead = this.addOutlined(j.head, this.createSculptedHeadGeometry(0.48), gelOuter, [0, 0.05, -0.02], [0.99, 1.02, 0.96], [0, 0, 0], this.slimeOutlineMat);
    j.slimeShells.push(jellyHead);

    const slimeTuftGeo = new THREE.ConeGeometry(0.12, 0.31, 6);
    const slimeSpikes: [number, number, number, number][] = [
      [-0.19, 0.46, 0.0, 0.3],
      [-0.02, 0.54, 0.0, 0.04],
      [0.16, 0.48, 0.0, -0.24],
      [-0.38, 0.18, 0.02, 1.02],
      [0.38, 0.18, 0.02, -1.02],
      [-0.34, -0.17, 0.04, 1.62],
      [0.34, -0.17, 0.04, -1.62],
    ];
    for (const [sx, sy, sz, rz] of slimeSpikes) {
      const drip = this.addOutlined(j.head, slimeTuftGeo, gelOuter, [sx, sy, sz], [0.78, 0.9, 0.76], [0.08, 0, rz], this.slimeOutlineMat);
      j.slimeShells.push(drip);
    }

    this.addCurvedHorn(j.head, gelDense, -1, this.slimeOutlineMat, 0.96);
    this.addCurvedHorn(j.head, gelDense, 1, this.slimeOutlineMat, 0.96);

    const earGelL = this.addOutlined(j.leftEarPivot, new THREE.SphereGeometry(0.14, 10, 8), gelOuter, [-0.08, -0.02, 0], [0.82, 1.02, 0.72], [0, 0, 0.25], this.slimeOutlineMat);
    const earGelR = this.addOutlined(j.rightEarPivot, new THREE.SphereGeometry(0.14, 10, 8), gelOuter, [0.08, -0.02, 0], [0.82, 1.02, 0.72], [0, 0, -0.25], this.slimeOutlineMat);

    const rootDrop = this.addOutlined(j.tailRootPivot, new THREE.CapsuleGeometry(0.15, 0.22, 5, 8), gelOuter, [0, -0.1, -0.1], [1, 1, 1], [-0.8, 0, 0], this.slimeOutlineMat);
    const tipDrop = this.addOutlined(j.tailTipPivot, new THREE.ConeGeometry(0.16, 0.44, 7), gelOuter, [0, -0.04, -0.16], [1, 1, 1], [-0.95, 0, 0], this.slimeOutlineMat);
    j.slimeShells.push(earGelL, earGelR, rootDrop, tipDrop);

    this.buildArticulatedLimbs(j, boneCore, gelOuter, gelOuter, gelOuter, gelDense, this.slimeOutlineMat, 'slime');
  }

  private buildHalfCyborg(j: ArticulatedJoints): void {
    // True 3D sculpted 50/50 split Half-Cyborg Yeti (ZERO flat mask!):
    // -X (character's right / viewer's left): crisp WHITE & CHROME truss endoskeleton, recessed steel
    //    eye socket with concentric machined chrome camera optic & glowing cyan lens, exposed temple
    //    & chest spinning silver clockwork gears, bolted metallic robotic jaw & hydraulic limbs!
    // +X (character's left / viewer's right): fluffy white shaggy OG Lofi fur, contoured glacier-blue
    //    eye zone with sleepy 3D Pepe eye, cool-grey muzzle, wavy blue lip, blue horn & organic limbs!
    const fur = this.toon(0xf8fafc);
    const blueSkin = this.toon(0x5ea3e8);
    const blueDark = this.toon(0x2563eb);
    const muzzle = this.toon(0xdbe4ef);
    const mechaWhite = this.toon(0xf1f5f9);
    const cyborgTex = createCyborgBodyTexture(this.maxAniso);
    const cyborgArmorMat = new THREE.MeshToonMaterial({
      map: cyborgTex,
      gradientMap: this.toonGradient,
    });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xdbe4ee, metalness: 0.9, roughness: 0.16 });
    const darkSteel = this.toon(0x1e293b);
    const opticCyan = this.toon(0x38bdf8, { emissive: 0x38bdf8, emissiveIntensity: 1.1 });
    const whiteEye = this.toon(0xffffff);
    const pupil = this.toon(0x090c14);

    // TRUE LEFT (-X) / RIGHT (+X) 50/50 split lean athletic torso with unified outline!
    this.addSplitEllipsoid(j.spine, 0.36, cyborgArmorMat, fur, [0, 0.08, 0], [0.84, 0.92, 0.8]);
    this.addSplitEllipsoid(j.chest, 0.4, cyborgArmorMat, fur, [0, 0.1, 0], [0.92, 1.04, 0.82]);

    // Exposed dark steel engine recess + meshing silver clockwork gears + hydraulic piston fitted flush to slimmer chest!
    this.addOutlined(j.chest, new THREE.BoxGeometry(0.28, 0.36, 0.12), darkSteel, [-0.155, 0.1, 0.31], [1, 1, 1], [0, -0.22, 0], this.inkOutlineMat, 1.06);
    const gearGeo = new THREE.CylinderGeometry(0.125, 0.125, 0.055, 10);
    gearGeo.rotateX(Math.PI / 2);
    const chestGear = this.addOutlined(j.chest, gearGeo, chrome, [-0.175, 0.16, 0.36], [1, 1, 1], [0, -0.22, 0], this.inkOutlineMat);
    const lowerGear = this.addOutlined(j.chest, gearGeo, chrome, [-0.09, -0.01, 0.37], [0.7, 0.7, 1], [0, -0.15, 0], this.inkOutlineMat);
    const shoulderGear = this.addOutlined(j.leftShoulder, gearGeo, chrome, [-0.07, 0.05, 0.15], [0.82, 0.82, 0.82], [0, 0, 0], this.inkOutlineMat);
    const backGear = this.addOutlined(j.backAccessory, gearGeo, chrome, [-0.14, 0.08, -0.04], [1.0, 1.0, 1.0], [0, 0, 0], this.inkOutlineMat);
    // Chrome hydraulic collar strut on mechanical side
    this.addOutlined(j.chest, new THREE.CylinderGeometry(0.034, 0.034, 0.38, 8), chrome, [-0.31, 0.19, 0.15], [1, 1, 1], [0.2, 0, 0.32], this.inkOutlineMat);
    j.gears.push(chestGear, lowerGear, shoulderGear, backGear);

    // Shaggy white shoulder & collar fur tufts on organic +X side ONLY
    const tuftGeo = new THREE.ConeGeometry(0.11, 0.27, 6);
    for (let i = 0; i < 5; i++) {
      const a = 0.22 + (i / 4) * (Math.PI - 0.44);
      this.addOutlined(
        j.chest,
        tuftGeo,
        fur,
        [Math.sin(a) * 0.36, 0.3, Math.cos(a) * 0.3],
        [0.9, 0.94, 0.9],
        [Math.cos(a) * 0.48, 0, -Math.sin(a) * 0.48],
      );
    }

    // TRUE LEFT (-X) / RIGHT (+X) 50/50 split sculpted agile 3D Yeti Head
    this.addSplitHeadCranium(j.head, 0.47, cyborgArmorMat, fur, [0, 0.04, -0.02], [0.98, 1.01, 0.96]);
    // Crisp dark midline panel seam following the streamlined 50/50 cranium
    this.addOutlined(j.head, new THREE.TorusGeometry(0.462, 0.016, 6, 28), darkSteel, [0, 0.04, -0.01], [0.94, 1.01, 0.94], [0, Math.PI / 2, 0], null);

    // --- ORGANIC +X HALF OF FACE (Exact sculpted OG Lofi right half fitted to sleeker cranium!) ---
    this.addOutlined(j.head, new THREE.SphereGeometry(0.355, 14, 12, Math.PI * 0.5, Math.PI), blueSkin, [0.005, 0.13, 0.21], [0.94, 0.63, 0.8], [0, 0, 0], null);
    this.addOutlined(j.head, new THREE.SphereGeometry(0.335, 14, 12, Math.PI * 0.5, Math.PI), muzzle, [0.005, -0.14, 0.24], [0.93, 0.69, 0.82], [0, 0, 0], null);
    // Sleepy 3D Pepe almond eye + double arched blue brow folds
    this.addOutlined(j.head, new THREE.SphereGeometry(0.132, 14, 12), whiteEye, [0.165, 0.125, 0.43], [1.28, 0.8, 0.48], [0, 0.2, 0], this.inkOutlineMat, 1.09);
    this.addOutlined(j.head, new THREE.SphereGeometry(0.074, 10, 10), pupil, [0.155, 0.118, 0.485], [1, 0.94, 0.42], [0, 0.2, 0], null);
    this.addOutlined(j.head, new THREE.SphereGeometry(0.023, 6, 6), whiteEye, [0.135, 0.148, 0.515], [1, 1, 1], [0, 0, 0], null);
    const orgLidCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.02, 0.185, 0.49),
      new THREE.Vector3(0.155, 0.228, 0.472),
      new THREE.Vector3(0.29, 0.185, 0.398),
    ]);
    this.addOutlined(j.head, new THREE.TubeGeometry(orgLidCurve, 10, 0.03, 7, false), blueSkin, [0, 0, 0], [1, 1, 1], [0, 0, 0], this.inkOutlineMat, 1.08);
    const orgBrowCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.025, 0.245, 0.468),
      new THREE.Vector3(0.155, 0.28, 0.45),
      new THREE.Vector3(0.285, 0.24, 0.382),
    ]);
    this.addOutlined(j.head, new THREE.TubeGeometry(orgBrowCurve, 10, 0.02, 6, false), blueSkin, [0, 0, 0], [1, 1, 1], [0, 0, 0], this.inkOutlineMat, 1.08);
    // Organic half nose with nostril + sinuous wavy glacier-blue right lip half!
    this.addOutlined(j.head, new THREE.SphereGeometry(0.075, 10, 8), blueSkin, [0.042, -0.02, 0.498], [1.02, 0.84, 0.72], [0, 0, 0], this.inkOutlineMat, 1.08);
    this.addOutlined(j.head, new THREE.SphereGeometry(0.02, 6, 6), pupil, [0.046, -0.035, 0.552], [1, 0.9, 0.6], [0, 0, 0], null);
    this.addSculptedWavyLips(j.head, blueSkin, blueSkin, pupil, this.inkOutlineMat, 'right');

    // --- MECHANICAL -X HALF OF FACE (Authentic White-Chrome Camera Iris + Articulated Riveted Wavy Lips!) ---
    // Concentric machined white-chrome circular eye housing + bright iris lens matching reference art!
    this.addOutlined(j.head, new THREE.CylinderGeometry(0.185, 0.195, 0.1, 18), darkSteel, [-0.175, 0.125, 0.41], [1, 1, 1], [Math.PI / 2, -0.22, 0], this.inkOutlineMat, 1.07);
    this.addOutlined(j.head, new THREE.TorusGeometry(0.155, 0.03, 8, 20), mechaWhite, [-0.18, 0.125, 0.458], [1, 1, 1], [0, -0.22, 0], this.inkOutlineMat, 1.07);
    this.addOutlined(j.head, new THREE.CylinderGeometry(0.125, 0.125, 0.07, 16), whiteEye, [-0.182, 0.125, 0.452], [1, 1, 1], [Math.PI / 2, -0.22, 0], null);
    this.addOutlined(j.head, new THREE.TorusGeometry(0.088, 0.016, 6, 16), chrome, [-0.186, 0.125, 0.484], [1, 1, 1], [0, -0.22, 0], this.inkOutlineMat, 1.08);
    this.addOutlined(j.head, new THREE.SphereGeometry(0.068, 12, 10), opticCyan, [-0.188, 0.125, 0.482], [1, 1, 0.48], [0, -0.22, 0], null);
    this.addOutlined(j.head, new THREE.SphereGeometry(0.036, 10, 8), pupil, [-0.192, 0.125, 0.506], [1, 1, 0.45], [0, -0.22, 0], null);
    this.addOutlined(j.head, new THREE.SphereGeometry(0.018, 6, 6), whiteEye, [-0.17, 0.145, 0.522], [1, 1, 1], [0, 0, 0], null);

    // Spinning miniature chrome temple gear nestled flush into the sleeker mecha temple
    const templeGear = this.addOutlined(j.head, gearGeo, chrome, [-0.39, 0.04, 0.16], [0.62, 0.62, 0.65], [0, -Math.PI / 2 + 0.28, 0], this.inkOutlineMat);
    j.gears.push(templeGear);

    // Recessed mechanical jaw plate + exposed silver piston coils beneath articulated robotic wavy lips!
    this.addOutlined(j.head, new THREE.SphereGeometry(0.32, 14, 12, -Math.PI * 0.5, Math.PI), mechaWhite, [-0.005, -0.14, 0.24], [0.92, 0.67, 0.8], [0, 0, 0], null);
    this.addOutlined(j.head, new THREE.CylinderGeometry(0.048, 0.048, 0.08, 10), mechaWhite, [-0.042, -0.02, 0.492], [1, 1, 1], [Math.PI / 2, 0, 0], this.inkOutlineMat);
    this.addOutlined(j.head, new THREE.SphereGeometry(0.02, 6, 6), darkSteel, [-0.046, -0.032, 0.535], [1, 1, 0.6], [0, 0, 0], null);
    // Seamlessly matched articulated white-chrome wavy robotic tubing lip meeting the blue organic lip at x = 0!
    this.addSculptedWavyLips(j.head, mechaWhite, mechaWhite, darkSteel, this.inkOutlineMat, 'left', true);
    // Tiny recessed mechanical jaw coil piston below the robotic chin
    this.addOutlined(j.head, new THREE.CylinderGeometry(0.03, 0.03, 0.15, 8), chrome, [-0.13, -0.3, 0.42], [1, 1, 1], [0.22, 0, 0.5], this.inkOutlineMat);

    // Streamlined shaggy white fur spikes on organic +X side; sleek white-chrome crown fins on -X side
    const rightSpikes: [number, number, number, number][] = [
      [0.11, 0.52, 0.0, -0.16],
      [0.24, 0.43, -0.02, -0.36],
      [0.38, 0.19, 0.0, -0.96],
      [0.38, -0.07, 0.02, -1.38],
      [0.28, -0.32, 0.04, -1.98],
    ];
    for (const [sx, sy, sz, rz] of rightSpikes) {
      this.addOutlined(j.head, tuftGeo, fur, [sx, sy, sz], [0.74, 0.86, 0.72], [0.06, 0, rz]);
    }
    const leftTechSpikes: [number, number, number, number][] = [
      [-0.12, 0.5, 0.0, 0.18],
      [-0.25, 0.4, -0.02, 0.42],
      [-0.37, 0.15, 0.0, 1.02],
    ];
    for (const [sx, sy, sz, rz] of leftTechSpikes) {
      this.addOutlined(j.head, tuftGeo, mechaWhite, [sx, sy, sz], [0.68, 0.78, 0.68], [0.06, 0, rz]);
    }

    // 2-segment curved horns (chrome on -X, glacier-blue on +X) & asymmetric ears
    this.addCurvedHorn(j.head, chrome, -1, this.inkOutlineMat, 0.96);
    this.addCurvedHorn(j.head, blueSkin, 1, this.inkOutlineMat, 1.02);

    this.addOutlined(j.leftEarPivot, new THREE.CylinderGeometry(0.145, 0.145, 0.1, 14), mechaWhite, [-0.07, -0.02, 0.02], [1, 1, 1], [0, 0, Math.PI / 2]);
    this.addOutlined(j.leftEarPivot, new THREE.CylinderGeometry(0.08, 0.08, 0.12, 12), darkSteel, [-0.08, -0.02, 0.02], [1, 1, 1], [0, 0, Math.PI / 2], null);
    this.addOutlined(j.leftEarPivot, new THREE.SphereGeometry(0.038, 8, 8), opticCyan, [-0.14, -0.02, 0.02], [1, 1, 1], [0, 0, 0], null);
    this.addOutlined(j.rightEarPivot, new THREE.SphereGeometry(0.145, 12, 10), blueSkin, [0.08, -0.02, 0.02], [0.78, 1.0, 0.65]);
    this.addOutlined(j.rightEarPivot, new THREE.SphereGeometry(0.085, 10, 8), blueDark, [0.08, -0.02, 0.09], [0.72, 0.9, 0.38], [0, 0, 0], null);

    // Coupled 2-segment servo stabilizer tail
    this.addOutlined(j.tailRootPivot, new THREE.CylinderGeometry(0.11, 0.14, 0.34, 8), chrome, [-0.06, -0.14, -0.06], [1, 1, 1], [0.35, 0, 0]);
    this.addOutlined(j.tailTipPivot, new THREE.ConeGeometry(0.11, 0.32, 7), opticCyan, [-0.06, -0.06, -0.1], [1, 1, 1], [Math.PI + 0.35, 0, 0], null);

    this.buildAsymmetricLimbs(j, mechaWhite, chrome, darkSteel, fur, blueSkin);
  }

  private buildVoidShadow(j: ArticulatedJoints): void {
    // True 3D sculpted 50/50 split Void Shadow Yeti (ZERO flat mask, ZERO floating energons!):
    // -X (character's right / viewer's left): faceted charcoal-slate obsidian armor & cranium,
    //    recessed dark socket with glowing pupil-less pale almond eye, sculpted obsidian jaw with
    //    clenched dark-slate 3D teeth!
    // +X (character's left / viewer's right): deep midnight-indigo shaggy shadow fur cranium & torso,
    //    glowing pale-lavender almond eye, and sculpted 3D stitched violet-grey smile embedded into cheek!
    // Crowned by twin curved 2-segment ELECTRIC SKY-BLUE horns (#38bdf8) + flowing dark shadow cloak!
    const obsidianRock = this.toon(0x272f45);
    const obsidianEdge = this.toon(0x3a4663);
    const midnightFur = this.toon(0x131126);
    const darkIndigo = this.toon(0x211d3d);
    const skyHornMat = this.toon(0x38bdf8, { emissive: 0x0284c7, emissiveIntensity: 0.48 });
    const eyeGlow = this.toon(0xf5f3ff, { emissive: 0xe9d5ff, emissiveIntensity: 1.15 });
    const toothSlate = this.toon(0x64748b);
    const stitchViolet = this.toon(0x8b7ea8);
    const capeMat = this.toon(0x161328);
    const clawMat = this.toon(0x38bdf8, { emissive: 0x0ea5e9, emissiveIntensity: 0.4 });
    const darkCavity = this.toon(0x090814);

    // TRUE LEFT (-X) / RIGHT (+X) 50/50 split lean athletic Shadow Yeti torso with unified outline!
    this.addSplitEllipsoid(j.spine, 0.36, obsidianRock, midnightFur, [0, 0.08, 0], [0.84, 0.92, 0.8]);
    this.addSplitEllipsoid(j.chest, 0.4, obsidianRock, midnightFur, [0, 0.1, 0], [0.93, 1.04, 0.82]);

    // Sculpted faceted obsidian pectoral & rib armor plates hugged flush to slimmer chest!
    this.addOutlined(j.chest, new THREE.BoxGeometry(0.24, 0.21, 0.11), obsidianEdge, [-0.155, 0.17, 0.31], [1, 1, 1], [0.1, -0.26, -0.08], this.inkOutlineMat, 1.07);
    this.addOutlined(j.chest, new THREE.BoxGeometry(0.21, 0.11, 0.1), obsidianEdge, [-0.14, -0.03, 0.32], [1, 1, 1], [0.06, -0.24, -0.06], this.inkOutlineMat, 1.07);

    // Trimmed dark shoulder & collar mantle spikes (split obsidian vs midnight fur)
    const tuftGeo = new THREE.ConeGeometry(0.11, 0.28, 6);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const sx = Math.sin(a) * 0.37;
      this.addOutlined(
        j.chest,
        tuftGeo,
        sx < 0 ? obsidianEdge : darkIndigo,
        [sx, 0.31, Math.cos(a) * 0.3],
        [0.9, 0.96, 0.9],
        [Math.cos(a) * 0.48, 0, -Math.sin(a) * 0.48],
      );
    }

    // TRUE LEFT (-X) / RIGHT (+X) 50/50 split sculpted agile 3D Void Shadow Head
    this.addSplitHeadCranium(j.head, 0.47, obsidianRock, midnightFur, [0, 0.04, -0.02], [0.99, 1.02, 0.96]);

    // Trimmed faceted obsidian cheekbone ridge hugging the sculpted -X cheek
    this.addOutlined(j.head, new THREE.BoxGeometry(0.22, 0.16, 0.14), obsidianEdge, [-0.22, -0.04, 0.34], [1, 1, 1], [0.1, -0.4, 0.1], null);

    // Recessed dark orbital sockets + twin iconic GLOWING PALE-LAVENDER ALMOND EYES (NO pupils!)
    const socketGeo = new THREE.SphereGeometry(0.135, 12, 10);
    const almondEyeGeo = new THREE.SphereGeometry(0.115, 12, 10);
    for (const side of [-1, 1] as const) {
      this.addOutlined(j.head, socketGeo, darkCavity, [side * 0.18, 0.12, 0.43], [1.34, 0.68, 0.45], [0, side * 0.22, -side * 0.18], null);
      this.addOutlined(j.head, almondEyeGeo, eyeGlow, [side * 0.18, 0.12, 0.468], [1.28, 0.52, 0.36], [0, side * 0.22, -side * 0.18], null);
    }

    // --- OBSIDIAN -X JAW: Sculpted clenched dark-slate 3D teeth framed by dark rock lips! ---
    this.addOutlined(j.head, new THREE.BoxGeometry(0.29, 0.18, 0.16), darkCavity, [-0.145, -0.15, 0.41], [1, 1, 1], [0, -0.22, 0], this.inkOutlineMat, 1.06);
    const voidToothGeo = new THREE.BoxGeometry(0.062, 0.14, 0.08);
    for (let t = 0; t < 4; t++) {
      const tx = -0.24 + t * 0.066;
      const tz = 0.468 - Math.abs(tx) * 0.18;
      this.addOutlined(j.head, voidToothGeo, toothSlate, [tx, -0.15, tz], [1, 1, 1], [0, tx * 0.75, 0], this.inkOutlineMat, 1.06);
    }
    this.addOutlined(j.head, new THREE.CapsuleGeometry(0.036, 0.24, 5, 8), obsidianEdge, [-0.145, -0.06, 0.465], [1, 1, 0.65], [0, -0.22, Math.PI / 2], this.inkOutlineMat);
    this.addOutlined(j.head, new THREE.CapsuleGeometry(0.036, 0.24, 5, 8), obsidianEdge, [-0.145, -0.24, 0.455], [1, 1, 0.65], [0, -0.22, Math.PI / 2], this.inkOutlineMat);

    // --- MIDNIGHT FUR +X CHEEK: Seamless 3D curved stitched violet-grey smile (-+-+-+-) ---
    this.addOutlined(j.head, new THREE.CapsuleGeometry(0.024, 0.28, 5, 8), stitchViolet, [0.145, -0.15, 0.46], [1, 1, 0.65], [0, 0.26, Math.PI / 2 + 0.22], null);
    const stitchBarGeo = new THREE.CapsuleGeometry(0.018, 0.075, 4, 6);
    for (let s = 0; s < 4; s++) {
      const frac = (s + 0.5) / 4;
      const sx = 0.04 + frac * 0.23;
      const sy = -0.18 + frac * 0.065;
      const sz = 0.48 - sx * sx * 0.72;
      this.addOutlined(j.head, stitchBarGeo, stitchViolet, [sx, sy, sz], [1, 1, 0.7], [0, 0.26, -0.22], null);
    }

    // Streamlined split shadow mane framing the sleeker head
    const headSpikes: [number, number, number, number][] = [
      [-0.19, 0.47, 0.0, 0.3],
      [-0.02, 0.54, 0.0, 0.04],
      [0.16, 0.5, 0.0, -0.22],
      [-0.38, 0.19, 0.0, 0.96],
      [0.38, 0.19, 0.0, -0.96],
      [-0.38, -0.09, 0.02, 1.42],
      [0.38, -0.09, 0.02, -1.42],
    ];
    for (const [sx, sy, sz, rz] of headSpikes) {
      this.addOutlined(
        j.head,
        tuftGeo,
        sx < 0 ? obsidianEdge : darkIndigo,
        [sx, sy, sz],
        [0.76, 0.9, 0.74],
        [0.08, 0, rz],
      );
    }

    // Twin iconic 2-segment curved ELECTRIC SKY-BLUE horns (#38bdf8)
    this.addCurvedHorn(j.head, skyHornMat, -1, this.inkOutlineMat, 1.08);
    this.addCurvedHorn(j.head, skyHornMat, 1, this.inkOutlineMat, 1.08);

    // Dark ears on spring pivots
    this.addOutlined(j.leftEarPivot, new THREE.SphereGeometry(0.135, 10, 8), obsidianRock, [-0.08, -0.02, 0.02], [0.78, 1.0, 0.65]);
    this.addOutlined(j.rightEarPivot, new THREE.SphereGeometry(0.135, 10, 8), darkIndigo, [0.08, -0.02, 0.02], [0.78, 1.0, 0.65]);

    // Coupled 2-segment flowing matte dark Shadow Cloak tailored to leaner torso width
    j.tailRootPivot.position.set(0, 0.25, 0);
    this.addOutlined(j.tailRootPivot, new THREE.BoxGeometry(0.84, 0.66, 0.075), capeMat, [0, -0.33, -0.05]);
    j.tailTipPivot.position.set(0, -0.62, -0.05);
    this.addOutlined(j.tailTipPivot, new THREE.BoxGeometry(0.76, 0.6, 0.065), midnightFur, [0, -0.3, -0.02]);

    // Clean sculpted split Shadow Yeti limbs with obsidian-crystal sky-blue claw tips (NO floating energons!)
    this.buildArticulatedLimbs(j, obsidianRock, midnightFur, obsidianRock, darkIndigo, obsidianEdge, this.inkOutlineMat, 'void', clawMat);
  }

  /**
   * Sculpted sturdy yet athletic 3-fingered + thumb Yeti hand proportioned to match the leaner torso & head.
   */
  private addSculptedHand(
    parent: THREE.Object3D,
    palmMat: THREE.Material,
    outlineMat: THREE.Material,
    side: -1 | 1,
    clawMat?: THREE.Material,
  ): void {
    // Sturdy sculpted palm with crisp athletic bevel (substantial without looking puffy)
    this.addOutlined(
      parent,
      new THREE.SphereGeometry(0.128, 12, 10),
      palmMat,
      [0, -0.335, 0.032],
      [0.96, 1.02, 0.82],
      [0, 0, 0],
      outlineMat,
      1.07,
    );
    const fingerGeo = new THREE.CapsuleGeometry(0.029, 0.108, 4, 7);
    const thumbGeo = new THREE.CapsuleGeometry(0.03, 0.084, 4, 6);
    const fingerSpecs: [number, number][] = [
      [-0.062, 0.96],
      [0, 1.07],
      [0.062, 0.96],
    ];
    for (const [fx, lenScale] of fingerSpecs) {
      this.addOutlined(
        parent,
        fingerGeo,
        palmMat,
        [fx, -0.438, 0.078],
        [1, lenScale, 0.95],
        [0.32, 0, -fx * 1.25],
        outlineMat,
        1.07,
      );
      if (clawMat) {
        this.addOutlined(
          parent,
          new THREE.ConeGeometry(0.024, 0.118, 5),
          clawMat,
          [fx * 1.06, -0.506, 0.11],
          [1, 1, 1],
          [Math.PI * 0.84, 0, 0],
          null,
        );
      }
    }
    // Sturdy opposable Yeti thumb angled inward
    this.addOutlined(
      parent,
      thumbGeo,
      palmMat,
      [-side * 0.108, -0.356, 0.07],
      [0.98, 0.98, 0.94],
      [0.28, 0, -side * 0.56],
      outlineMat,
      1.07,
    );
  }

  /**
   * Sculpted 3-toed Yeti foot with rounded pad so characters never have plain box shoes.
   */
  private addSculptedFoot(
    parent: THREE.Object3D,
    footMat: THREE.Material,
    outlineMat: THREE.Material,
  ): void {
    this.addOutlined(parent, new THREE.SphereGeometry(0.155, 10, 10), footMat, [0, -0.41, 0.07], [0.94, 0.56, 1.46], [0, 0, 0], outlineMat);
    const toeGeo = new THREE.SphereGeometry(0.058, 8, 8);
    for (const tx of [-0.082, 0, 0.082]) {
      this.addOutlined(parent, toeGeo, footMat, [tx, -0.425, 0.27 - Math.abs(tx) * 0.3], [0.9, 0.72, 1.25], [0, 0, 0], outlineMat, 1.09);
    }
  }

  private buildArticulatedLimbs(
    j: ArticulatedJoints,
    upperMat: THREE.Material,
    lowerMat: THREE.Material,
    handMat: THREE.Material,
    footMat: THREE.Material,
    cuffMat: THREE.Material,
    outlineMat: THREE.Material,
    style: 'fur' | 'flame' | 'slime' | 'void',
    clawMat?: THREE.Material,
  ): void {
    const isSlime = style === 'slime';
    const isVoidSplit = style === 'void';

    // Balanced athletic arms leading into sturdier sculpted hands, paired with leaner legs matching the torso
    const deltoidGeo = new THREE.SphereGeometry(0.154, 10, 10);
    const upperArmGeo = new THREE.CapsuleGeometry(0.12, 0.25, 5, 10);
    const forearmGeo = new THREE.CapsuleGeometry(0.106, 0.235, 5, 10);
    const wristCuffGeo = new THREE.TorusGeometry(0.108, 0.036, 6, 12);
    wristCuffGeo.rotateX(Math.PI / 2);
    const ankleCuffGeo = new THREE.TorusGeometry(0.12, 0.04, 6, 12);
    ankleCuffGeo.rotateX(Math.PI / 2);
    const thighGeo = new THREE.CapsuleGeometry(0.155, 0.26, 5, 10);
    const shinGeo = new THREE.CapsuleGeometry(0.138, 0.24, 5, 10);

    if (isSlime) {
      // Glowing chartreuse-lime humerus, slender forearm bones, femur & tibia inside translucent slime
      const armBoneGeo = new THREE.CylinderGeometry(0.036, 0.036, 0.29, 6);
      const legBoneGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.3, 6);
      const jointBoneGeo = new THREE.SphereGeometry(0.05, 8, 8);
      this.addOutlined(j.leftShoulder, armBoneGeo, upperMat, [-0.025, -0.18, 0], [1, 1, 1], [0, 0, 0], null);
      this.addOutlined(j.leftElbow, armBoneGeo, upperMat, [0, -0.16, 0], [0.82, 0.9, 0.82], [0, 0, 0], null);
      this.addOutlined(j.leftElbow, jointBoneGeo, upperMat, [0, -0.33, 0.03], [0.9, 0.82, 0.7], [0, 0, 0], null);

      this.addOutlined(j.rightShoulder, armBoneGeo, upperMat, [0.025, -0.18, 0], [1, 1, 1], [0, 0, 0], null);
      this.addOutlined(j.rightElbow, armBoneGeo, upperMat, [0, -0.16, 0], [0.82, 0.9, 0.82], [0, 0, 0], null);
      this.addOutlined(j.rightElbow, jointBoneGeo, upperMat, [0, -0.33, 0.03], [0.9, 0.82, 0.7], [0, 0, 0], null);

      this.addOutlined(j.leftHip, legBoneGeo, upperMat, [0, -0.22, 0], [1.05, 1.05, 1.05], [0, 0, 0], null);
      this.addOutlined(j.leftKnee, legBoneGeo, upperMat, [0, -0.22, 0], [0.9, 0.95, 0.9], [0, 0, 0], null);
      this.addOutlined(j.rightHip, legBoneGeo, upperMat, [0, -0.22, 0], [1.05, 1.05, 1.05], [0, 0, 0], null);
      this.addOutlined(j.rightKnee, legBoneGeo, upperMat, [0, -0.22, 0], [0.9, 0.95, 0.9], [0, 0, 0], null);
    }

    const leftUpperMat = isSlime ? lowerMat : upperMat;
    const leftLowerMat = isVoidSplit ? upperMat : lowerMat;
    const rightUpperMat = isSlime ? lowerMat : isVoidSplit ? lowerMat : upperMat;
    const rightLowerMat = lowerMat;

    // Left Arm (-X)
    this.addOutlined(j.leftShoulder, deltoidGeo, leftUpperMat, [-0.015, 0.02, 0], [1.02, 0.94, 0.96], [0, 0, 0], outlineMat);
    this.addOutlined(j.leftShoulder, upperArmGeo, leftUpperMat, [-0.025, -0.18, 0], [1, 1, 1], [0, 0, 0], outlineMat);
    this.addOutlined(j.leftElbow, forearmGeo, leftLowerMat, [0, -0.155, 0], [0.96, 1, 0.96], [0, 0, 0], outlineMat);
    this.addOutlined(j.leftElbow, wristCuffGeo, cuffMat, [0, -0.25, 0], [1.02, 1.05, 1.02], [0, 0, 0], outlineMat);
    this.addSculptedHand(j.leftElbow, handMat, outlineMat, -1, clawMat);

    // Right Arm (+X)
    this.addOutlined(j.rightShoulder, deltoidGeo, rightUpperMat, [0.015, 0.02, 0], [1.02, 0.94, 0.96], [0, 0, 0], outlineMat);
    this.addOutlined(j.rightShoulder, upperArmGeo, rightUpperMat, [0.025, -0.18, 0], [1, 1, 1], [0, 0, 0], outlineMat);
    this.addOutlined(j.rightElbow, forearmGeo, rightLowerMat, [0, -0.155, 0], [0.96, 1, 0.96], [0, 0, 0], outlineMat);
    this.addOutlined(j.rightElbow, wristCuffGeo, isVoidSplit ? rightLowerMat : cuffMat, [0, -0.25, 0], [1.02, 1.05, 1.02], [0, 0, 0], outlineMat);
    this.addSculptedHand(j.rightElbow, isVoidSplit ? footMat : handMat, outlineMat, 1, clawMat);

    // Left Leg (-X)
    this.addOutlined(j.leftHip, thighGeo, leftUpperMat, [0, -0.22, 0], [1.04, 1, 1.04], [0, 0, 0], outlineMat);
    this.addOutlined(j.leftKnee, shinGeo, leftLowerMat, [0, -0.21, 0], [1.04, 1, 1.04], [0, 0, 0], outlineMat);
    this.addOutlined(j.leftKnee, ankleCuffGeo, cuffMat, [0, -0.32, 0], [1.08, 1.08, 1.08], [0, 0, 0], outlineMat);
    this.addSculptedFoot(j.leftKnee, isVoidSplit ? handMat : footMat, outlineMat);

    // Right Leg (+X)
    this.addOutlined(j.rightHip, thighGeo, rightUpperMat, [0, -0.22, 0], [1.04, 1, 1.04], [0, 0, 0], outlineMat);
    this.addOutlined(j.rightKnee, shinGeo, rightLowerMat, [0, -0.21, 0], [1.04, 1, 1.04], [0, 0, 0], outlineMat);
    this.addOutlined(j.rightKnee, ankleCuffGeo, isVoidSplit ? rightLowerMat : cuffMat, [0, -0.32, 0], [1.08, 1.08, 1.08], [0, 0, 0], outlineMat);
    this.addSculptedFoot(j.rightKnee, footMat, outlineMat);
  }

  private buildAsymmetricLimbs(
    j: ArticulatedJoints,
    mechaMat: THREE.Material,
    chromeMat: THREE.Material,
    darkSteel: THREE.Material,
    organicFur: THREE.Material,
    organicSkin: THREE.Material,
  ): void {
    const deltoidGeo = new THREE.SphereGeometry(0.154, 10, 10);
    const upperArmGeo = new THREE.CapsuleGeometry(0.12, 0.25, 5, 10);
    const forearmGeo = new THREE.CapsuleGeometry(0.106, 0.235, 5, 10);
    const wristCuffGeo = new THREE.TorusGeometry(0.108, 0.036, 6, 12);
    wristCuffGeo.rotateX(Math.PI / 2);
    const ankleCuffGeo = new THREE.TorusGeometry(0.12, 0.04, 6, 12);
    ankleCuffGeo.rotateX(Math.PI / 2);
    const thighGeo = new THREE.CapsuleGeometry(0.155, 0.26, 5, 10);
    const shinGeo = new THREE.CapsuleGeometry(0.138, 0.24, 5, 10);

    // MECHANICAL LEFT ARM (-X): Sturdy white-chrome shoulder, hydraulic forearm & articulated robotic hand
    this.addOutlined(j.leftShoulder, new THREE.SphereGeometry(0.158, 12, 10), mechaMat, [-0.015, 0.02, 0]);
    this.addOutlined(j.leftShoulder, new THREE.CylinderGeometry(0.102, 0.09, 0.35, 10), mechaMat, [-0.025, -0.18, 0]);
    this.addOutlined(j.leftShoulder, new THREE.CylinderGeometry(0.025, 0.025, 0.33, 6), chromeMat, [-0.114, -0.18, 0.03], [1, 1, 1], [0, 0, 0], null);
    this.addOutlined(j.leftElbow, new THREE.SphereGeometry(0.098, 10, 8), darkSteel, [0, 0, 0]);
    this.addOutlined(j.leftElbow, new THREE.CylinderGeometry(0.094, 0.084, 0.31, 10), chromeMat, [0, -0.155, 0]);
    this.addOutlined(j.leftElbow, new THREE.BoxGeometry(0.148, 0.175, 0.138), mechaMat, [-0.025, -0.155, 0.02]);
    this.addSculptedHand(j.leftElbow, mechaMat, this.inkOutlineMat, -1);

    // MECHANICAL LEFT LEG (-X): Streamlined hydraulic thigh, bolted steel knee & armored mecha boot
    this.addOutlined(j.leftHip, new THREE.CylinderGeometry(0.136, 0.116, 0.42, 10), mechaMat, [0, -0.22, 0]);
    this.addOutlined(j.leftHip, new THREE.CylinderGeometry(0.032, 0.032, 0.38, 6), chromeMat, [-0.128, -0.22, 0.04], [1, 1, 1], [0, 0, 0], null);
    this.addOutlined(j.leftKnee, new THREE.SphereGeometry(0.12, 10, 8), darkSteel, [0, 0, 0.02]);
    this.addOutlined(j.leftKnee, new THREE.CylinderGeometry(0.114, 0.106, 0.38, 10), chromeMat, [0, -0.21, 0]);
    this.addOutlined(j.leftKnee, new THREE.BoxGeometry(0.175, 0.25, 0.16), mechaMat, [0, -0.21, 0.055]);
    this.addSculptedFoot(j.leftKnee, mechaMat, this.inkOutlineMat);

    // ORGANIC RIGHT ARM & LEG (+X): Balanced shaggy white OG Lofi fur with sturdy blue 3-fingered hand
    this.addOutlined(j.rightShoulder, deltoidGeo, organicFur, [0.015, 0.02, 0], [1.02, 0.94, 0.96]);
    this.addOutlined(j.rightShoulder, upperArmGeo, organicFur, [0.025, -0.18, 0]);
    this.addOutlined(j.rightElbow, forearmGeo, organicFur, [0, -0.155, 0], [0.98, 1, 0.98]);
    this.addOutlined(j.rightElbow, wristCuffGeo, organicFur, [0, -0.25, 0], [1.02, 1.05, 1.02]);
    this.addSculptedHand(j.rightElbow, organicSkin, this.inkOutlineMat, 1);

    this.addOutlined(j.rightHip, thighGeo, organicFur, [0, -0.22, 0], [1.02, 1, 1.02]);
    this.addOutlined(j.rightKnee, shinGeo, organicFur, [0, -0.21, 0], [1.02, 1, 1.02]);
    this.addOutlined(j.rightKnee, ankleCuffGeo, organicFur, [0, -0.32, 0], [1.06, 1.06, 1.06]);
    this.addSculptedFoot(j.rightKnee, organicSkin, this.inkOutlineMat);
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
      const emoteHop = this.emoteTimer > 0 ? Math.sin((this.emoteTimer / 0.78) * Math.PI) * 0.48 : 0;
      // Periodic playful showcase hop every ~7.2s so the waiting ground feels truly alive!
      const cycle7 = elapsed % 7.2;
      const microHop =
        cycle7 > 5.8 && cycle7 < 6.45
          ? Math.sin(((cycle7 - 5.8) / 0.65) * Math.PI) * 0.22
          : 0;
      const idleFloat =
        charId === 'void_shadow'
          ? 0.26 + Math.sin(elapsed * 2.1) * 0.11
          : charId === 'neon_slime'
            ? Math.abs(Math.sin(elapsed * 3.2)) * 0.1
            : Math.abs(Math.sin(elapsed * 2.9)) * 0.045;
      targetBodyY = idleFloat + emoteHop + microHop;
      // Expressive 3/4 character showcase pose with subtle rhythmic weight-shift lean
      targetYaw =
        Math.PI +
        Math.sin(elapsed * 0.62) * 0.36 +
        Math.sin(elapsed * 1.24) * 0.08 +
        (this.emoteTimer > 0 ? (1 - this.emoteTimer / 0.78) * Math.PI * 2 : 0);
      targetRoll = Math.sin(elapsed * 1.45) * 0.045;
      targetPitch = microHop > 0 ? -microHop * 0.35 : 0;
    } else {
      if (state === 'slide') {
        // Neon Slime pancakes flatter & wider; others crouch sleek & low
        targetScaleY = charId === 'neon_slime' ? 0.44 : 0.54;
        targetScaleXZ = charId === 'neon_slime' ? 1.38 : 1.18;
        targetPitch = charId === 'void_shadow' ? 0.32 : 0.48;
      } else if (state === 'worldSlide') {
        // Carving low down the curved Snow / Magma / Slime / Blackhole half-pipe chute!
        targetPitch = 0.16;
        targetRoll = THREE.MathUtils.clamp(-laneVelocity * 0.048, -0.52, 0.52);
      } else if (state === 'spaceFloat') {
        // Weightless Zero-G cosmic drift in Cyborg Space!
        targetBodyY = yPos + Math.sin(elapsed * 2.8) * 0.14;
        targetPitch = -0.22 + Math.sin(elapsed * 2.1) * 0.09;
        targetRoll = THREE.MathUtils.clamp(-laneVelocity * 0.042, -0.45, 0.45) + Math.sin(elapsed * 1.4) * 0.08;
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

    // Keep flying silhouette crisp and clear (no glowing star bubble or spinning rings around the Yeti)
    void flyBarrelProgress;
    void flyLoopProgress;
    this.starAuraGroup.visible = false;

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

      // Arms pump freely OUTSIDE the torso (negative Z = left outward, positive Z = right outward!)
      j.leftShoulder.rotation.set(sR * 0.96 + limbLag * 0.3, 0, -0.28 - Math.abs(sR) * 0.08);
      j.leftElbow.rotation.set(-0.62 - Math.max(0, -sR) * 0.52, 0, -0.06);

      if (swordActive) {
        j.rightShoulder.rotation.set(-0.68 + sL * 0.22, 0, 0.36);
        j.rightElbow.rotation.set(-0.45, 0, 0.06);
      } else {
        j.rightShoulder.rotation.set(sL * 0.96 + limbLag * 0.3, 0, 0.28 + Math.abs(sL) * 0.08);
        j.rightElbow.rotation.set(-0.62 - Math.max(0, -sL) * 0.52, 0, 0.06);
      }
    } else if (state === 'jump' || state === 'flip') {
      const airTilt = THREE.MathUtils.clamp(-velocityY * 0.024, -0.28, 0.34);
      const isFlipping = flipProgress > 0 && flipProgress < 1;

      j.hips.position.y = 0.98;
      j.hips.rotation.set(0, 0, 0);
      j.spine.rotation.set((isFlipping ? 0.35 : 0.12) + airTilt, 0, 0);
      j.chest.rotation.set(0, 0, 0);
      j.head.rotation.set(-0.1 + headLag, 0, 0);

      // Character-unique Jump & Backflip poses with free outward arm clearance!
      if (charId === 'og_lofi') {
        j.leftHip.rotation.x = isFlipping ? -1.35 : -0.92;
        j.leftKnee.rotation.x = isFlipping ? 1.75 : 1.25;
        j.rightHip.rotation.x = isFlipping ? -1.25 : 0.28;
        j.rightKnee.rotation.x = isFlipping ? 1.65 : 0.72;
        j.leftShoulder.rotation.set(isFlipping ? -0.6 : -1.1 + limbLag, 0, isFlipping ? -0.58 : -0.48);
        j.leftElbow.rotation.set(isFlipping ? -1.05 : -0.55, 0, -0.06);
        j.rightShoulder.rotation.set(isFlipping ? -0.6 : -1.1 + limbLag, 0, isFlipping ? 0.58 : 0.48);
        j.rightElbow.rotation.set(isFlipping ? -1.05 : -0.55, 0, 0.06);
      } else if (charId === 'inferno_blaze') {
        j.leftHip.rotation.x = isFlipping ? -1.4 : -0.75;
        j.leftKnee.rotation.x = isFlipping ? 1.85 : 1.1;
        j.rightHip.rotation.x = isFlipping ? -1.4 : -0.45;
        j.rightKnee.rotation.x = isFlipping ? 1.85 : 1.2;
        j.leftShoulder.rotation.set(isFlipping ? -2.2 : -1.4 + limbLag, 0, -0.44);
        j.leftElbow.rotation.set(-0.35, 0, -0.06);
        j.rightShoulder.rotation.set(isFlipping ? -2.2 : -1.4 + limbLag, 0, 0.44);
        j.rightElbow.rotation.set(-0.35, 0, 0.06);
      } else if (charId === 'neon_slime') {
        j.leftHip.rotation.x = isFlipping ? -1.5 : -0.55;
        j.leftKnee.rotation.x = isFlipping ? 1.9 : 0.65;
        j.rightHip.rotation.x = isFlipping ? -1.5 : -0.55;
        j.rightKnee.rotation.x = isFlipping ? 1.9 : 0.65;
        j.leftShoulder.rotation.set(-1.3 + limbLag * 1.4, 0, -0.78);
        j.leftElbow.rotation.set(-0.25, 0, -0.06);
        j.rightShoulder.rotation.set(-1.3 + limbLag * 1.4, 0, 0.78);
        j.rightElbow.rotation.set(-0.25, 0, 0.06);
      } else if (charId === 'half_cyborg') {
        j.leftHip.rotation.x = isFlipping ? -1.25 : -0.85;
        j.leftKnee.rotation.x = isFlipping ? 1.65 : 1.15;
        j.rightHip.rotation.x = isFlipping ? -1.1 : 0.15;
        j.rightKnee.rotation.x = isFlipping ? 1.5 : 0.45;
        j.leftShoulder.rotation.set(0.45 + limbLag * 0.5, 0, -0.44);
        j.leftElbow.rotation.set(-0.3, 0, -0.06);
        j.rightShoulder.rotation.set(-1.25 + limbLag, 0, 0.44);
        j.rightElbow.rotation.set(-0.65, 0, 0.06);
      } else {
        j.leftHip.rotation.x = isFlipping ? -1.42 : -0.95;
        j.leftKnee.rotation.x = isFlipping ? 1.8 : 1.3;
        j.rightHip.rotation.x = isFlipping ? -1.3 : 0.3;
        j.rightKnee.rotation.x = isFlipping ? 1.7 : 0.8;
        j.leftShoulder.rotation.set(0.65 + limbLag * 0.4, 0, -0.68);
        j.leftElbow.rotation.set(-0.35, 0, -0.06);
        j.rightShoulder.rotation.set(0.65 + limbLag * 0.4, 0, 0.68);
        j.rightElbow.rotation.set(-0.35, 0, 0.06);
      }
    } else if (state === 'slide') {
      j.hips.position.y = 0.72;
      j.hips.rotation.set(0, charId === 'og_lofi' ? 0.32 : 0.18, 0);
      j.spine.rotation.set(-0.34, 0, 0);
      j.chest.rotation.set(-0.12, 0, 0);
      j.head.rotation.set(0.26 + headLag * 0.6, -0.18, 0);

      // Character-unique Slide poses with wide outward arm balance!
      if (charId === 'og_lofi') {
        j.leftHip.rotation.x = -1.2;
        j.leftKnee.rotation.x = 0.15;
        j.rightHip.rotation.x = 0.45;
        j.rightKnee.rotation.x = 1.25;
        j.leftShoulder.rotation.set(0.85, 0, -0.58);
        j.leftElbow.rotation.set(-0.25, 0, -0.06);
        j.rightShoulder.rotation.set(-0.75, 0, 0.68);
        j.rightElbow.rotation.set(-0.45, 0, 0.06);
      } else if (charId === 'neon_slime') {
        j.leftHip.rotation.x = -1.1;
        j.leftKnee.rotation.x = 0.1;
        j.rightHip.rotation.x = -1.1;
        j.rightKnee.rotation.x = 0.1;
        j.leftShoulder.rotation.set(0.4, 0, -0.88);
        j.leftElbow.rotation.set(-0.2, 0, -0.06);
        j.rightShoulder.rotation.set(0.4, 0, 0.88);
        j.rightElbow.rotation.set(-0.2, 0, 0.06);
      } else {
        j.leftHip.rotation.x = -1.15;
        j.leftKnee.rotation.x = 0.18;
        j.rightHip.rotation.x = 0.48;
        j.rightKnee.rotation.x = 1.18;
        j.leftShoulder.rotation.set(0.65, 0, -0.54);
        j.leftElbow.rotation.set(-0.4, 0, -0.06);
        j.rightShoulder.rotation.set(0.65, 0, 0.54);
        j.rightElbow.rotation.set(-0.4, 0, 0.06);
      }
    } else if (state === 'fly') {
      j.hips.position.y = 0.96;
      j.hips.rotation.set(0, 0, 0);
      j.spine.rotation.set(0.32 + (flyLoopProgress > 0 ? 0.25 : 0), 0, 0);
      j.chest.rotation.set(0.12, 0, 0);
      j.head.rotation.set(-0.32 + headLag, 0, 0);

      const barrelTuck = flyBarrelProgress > 0 ? Math.sin(flyBarrelProgress * Math.PI) : 0;
      const swoopTuck = flySwoopProgress > 0 ? Math.sin(flySwoopProgress * Math.PI) : 0;

      if (charId === 'inferno_blaze' || charId === 'void_shadow') {
        j.leftShoulder.rotation.set(0.75 + swoopTuck * 0.4, 0, -0.58 + barrelTuck * 0.22);
        j.leftElbow.rotation.set(-0.2, 0, -0.06);
        j.rightShoulder.rotation.set(0.75 + swoopTuck * 0.4, 0, 0.58 - barrelTuck * 0.22);
        j.rightElbow.rotation.set(-0.2, 0, 0.06);
      } else if (charId === 'half_cyborg') {
        j.leftShoulder.rotation.set(0.55, 0, -0.52 + barrelTuck * 0.18);
        j.leftElbow.rotation.set(-0.15, 0, -0.06);
        j.rightShoulder.rotation.set(-1.65, 0, 0.36);
        j.rightElbow.rotation.set(-0.15, 0, 0.06);
      } else {
        j.leftShoulder.rotation.set(-1.6 + swoopTuck * 0.5, 0, -0.48 + barrelTuck * 0.2);
        j.leftElbow.rotation.set(-0.2, 0, -0.06);
        j.rightShoulder.rotation.set(-1.6 + swoopTuck * 0.5, 0, 0.48 - barrelTuck * 0.2);
        j.rightElbow.rotation.set(-0.2, 0, 0.06);
      }

      j.leftHip.rotation.x = 0.32 + Math.sin(elapsed * 8) * 0.14;
      j.leftKnee.rotation.x = 0.28 + barrelTuck * 0.55;
      j.rightHip.rotation.x = 0.32 - Math.sin(elapsed * 8) * 0.14;
      j.rightKnee.rotation.x = 0.28 + barrelTuck * 0.55;
    } else if (state === 'worldSlide') {
      // Dynamic carving snowboard / chute-surf crouch with arms stretched wide outside torso!
      const carve = THREE.MathUtils.clamp(laneVelocity * 0.04, -0.36, 0.36);
      const bump = Math.sin(elapsed * 14) * 0.04;
      j.hips.position.y = 0.78 + bump;
      j.hips.rotation.set(0, 0.52 + carve * 0.35, -carve * 0.45);
      j.spine.rotation.set(0.24, -0.22, -carve * 0.3);
      j.chest.rotation.set(0.08, -0.18, 0);
      j.head.rotation.set(-0.18 + headLag, -0.2 + carve * 0.4, 0);

      j.leftHip.rotation.set(-0.62, 0, -0.12);
      j.leftKnee.rotation.x = 0.95;
      j.rightHip.rotation.set(-0.48, 0, 0.14);
      j.rightKnee.rotation.x = 0.85;

      j.leftShoulder.rotation.set(-0.25 + bump, 0, -0.92 + carve * 0.35);
      j.leftElbow.rotation.set(-0.32, 0, -0.08);
      j.rightShoulder.rotation.set(-0.25 - bump, 0, 0.92 + carve * 0.35);
      j.rightElbow.rotation.set(-0.32, 0, 0.08);
    } else if (state === 'spaceFloat') {
      // Weightless Zero-G cosmic drift pose with arms floating freely outward!
      const drift = Math.sin(elapsed * 2.4);
      const drift2 = Math.cos(elapsed * 1.9);
      j.hips.position.y = 0.96 + drift * 0.05;
      j.hips.rotation.set(0, drift2 * 0.14, drift * 0.08);
      j.spine.rotation.set(0.16 + drift * 0.08, 0, -drift * 0.06);
      j.chest.rotation.set(0.06, 0, 0);
      j.head.rotation.set(-0.14 + headLag, drift2 * 0.15, 0);

      j.leftHip.rotation.x = 0.36 + drift * 0.24;
      j.leftKnee.rotation.x = 0.48 - drift2 * 0.22;
      j.rightHip.rotation.x = 0.14 - drift * 0.24;
      j.rightKnee.rotation.x = 0.62 + drift2 * 0.22;

      j.leftShoulder.rotation.set(-0.48 + drift2 * 0.25, 0, -0.76 - drift * 0.18);
      j.leftElbow.rotation.set(-0.42, 0, -0.08);
      j.rightShoulder.rotation.set(-0.48 - drift2 * 0.25, 0, 0.76 + drift * 0.18);
      j.rightElbow.rotation.set(-0.42, 0, 0.08);
    }

    // 3-Phase (Anticipation -> Explosive Strike Snap -> Follow-Through), 3-Hit Combo Sword Swings!
    if (slashProgress > 0 && slashProgress < 1) {
      const comboStep = slashComboIndex % 3;
      const anticipate = THREE.MathUtils.clamp(slashProgress / 0.18, 0, 1);
      const strikeRaw = THREE.MathUtils.clamp((slashProgress - 0.18) / 0.44, 0, 1);
      const strike = 1 - Math.pow(1 - strikeRaw, 4);
      const follow = THREE.MathUtils.clamp((slashProgress - 0.62) / 0.38, 0, 1);
      const wristSnap = Math.sin(strikeRaw * Math.PI);

      if (comboStep === 0) {
        // HIT 1: High-to-Low Diagonal Forehand Cleave with clear outward arm sweep
        const shX = -0.6 - anticipate * 2.2 + strike * 4.15 - follow * 0.45;
        const shZ = 0.36 + anticipate * 0.62 + wristSnap * 0.48 - follow * 0.25;
        j.rightShoulder.rotation.set(shX, 0.25 * wristSnap, shZ);
        j.rightElbow.rotation.set(-0.72 + strike * 0.62 - follow * 0.22, 0, 0.08);
        this.swordGroup.rotation.set(Math.PI * 0.44 + wristSnap * 0.68, 0, -wristSnap * 0.35);

        j.chest.rotation.y = -0.68 * anticipate + strike * 1.48 - follow * 0.35;
        j.hips.rotation.y = -0.28 * anticipate + strike * 0.62;
        j.spine.rotation.x += -0.18 * anticipate + wristSnap * 0.34;
        j.leftShoulder.rotation.set(0.55 * strike, 0, -0.58 - 0.34 * wristSnap);
      } else if (comboStep === 1) {
        // HIT 2: Low-to-High Reverse Backhand Uppercut Sweep
        const shX = 0.85 + anticipate * 0.75 - strike * 4.1 + follow * 0.55;
        const shZ = 0.32 + anticipate * 0.25 + wristSnap * 0.82;
        j.rightShoulder.rotation.set(shX, -0.35 * wristSnap, shZ);
        j.rightElbow.rotation.set(-0.55 + strike * 0.42, 0, 0.08);
        this.swordGroup.rotation.set(Math.PI * 0.44 - wristSnap * 0.52, Math.PI * 0.85, wristSnap * 0.42);

        j.chest.rotation.y = 0.72 * anticipate - strike * 1.52 + follow * 0.35;
        j.hips.rotation.y = 0.32 * anticipate - strike * 0.65;
        j.spine.rotation.x += 0.16 * anticipate - wristSnap * 0.26;
        j.leftShoulder.rotation.set(-0.45 * strike, 0, -0.68);
      } else {
        // HIT 3: 360° Full-Body Whirlwind Horizontal Spin Cleave (both arms extended wide!)
        j.rightShoulder.rotation.set(-1.32, 0.4 * strike, 1.38);
        j.rightElbow.rotation.set(-0.12, 0, 0.06);
        this.swordGroup.rotation.set(Math.PI * 0.5, 0, -0.42);

        j.chest.rotation.y = 0.48 * strike;
        j.spine.rotation.x += 0.18;
        j.leftShoulder.rotation.set(-0.95, 0, -1.18);
        j.leftElbow.rotation.set(-0.25, 0, -0.06);
      }

      if (charId === 'void_shadow' && comboStep !== 2) {
        j.leftShoulder.rotation.set(-2.3 + strike * 3.5, 0, -0.62 - wristSnap * 0.75);
        j.leftElbow.rotation.set(-0.2, 0, -0.08);
      }
    } else {
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
      // Charismatic waiting-ground Lofi groove: 2-beat knee bounce, alternating weight shift,
      // shoulder roll, curious head look-around, and a friendly wave flourish every ~6.5s!
      const beat = Math.sin(elapsed * 5.2);
      const halfBeat = Math.sin(elapsed * 2.6);
      const bob = Math.abs(beat);
      const shift = Math.sin(elapsed * 1.3);

      // Smooth periodic friendly right-hand wave between 3.6s and 5.4s of each 6.8s loop
      const loopT = elapsed % 6.8;
      const waveBlend =
        loopT > 3.6 && loopT < 5.4
          ? Math.sin(((loopT - 3.6) / 1.8) * Math.PI)
          : 0;
      const waveOsc = Math.sin(elapsed * 11.5) * waveBlend;

      j.hips.position.y = 0.92 - bob * 0.075;
      j.hips.rotation.set(0.03 * bob, shift * 0.16, shift * 0.07);
      j.spine.rotation.set(0.05 + bob * 0.04, -shift * 0.1, -shift * 0.05);
      j.chest.rotation.set(0.03 - emote * 0.18 - waveBlend * 0.08, halfBeat * 0.09, shift * 0.05);
      j.head.rotation.set(
        0.04 + beat * 0.11 - waveBlend * 0.06,
        Math.sin(elapsed * 1.05) * 0.24 - waveBlend * 0.1,
        Math.sin(elapsed * 1.9) * 0.09 + waveBlend * 0.08,
      );

      // Left arm grooves rhythmically OUTSIDE the body; right arm grooves then raises high & wide to wave!
      j.leftShoulder.rotation.set(
        0.1 + halfBeat * 0.24 - emote * 1.35,
        0,
        -0.36 - bob * 0.12 - emote * 0.34,
      );
      j.leftElbow.rotation.set(-0.52 - bob * 0.24 - emote * 0.35, 0, -0.08);

      const grooveRightShX = 0.1 - halfBeat * 0.24 - emote * 1.35;
      const grooveRightShZ = 0.36 + bob * 0.12 + emote * 0.34;
      const grooveRightElbX = -0.52 - bob * 0.24 - emote * 0.35;

      j.rightShoulder.rotation.set(
        THREE.MathUtils.lerp(grooveRightShX, -2.35, waveBlend),
        0,
        THREE.MathUtils.lerp(grooveRightShZ, 0.72 + waveOsc * 0.32, waveBlend),
      );
      j.rightElbow.rotation.set(
        THREE.MathUtils.lerp(grooveRightElbX, -0.5 - Math.abs(waveOsc) * 0.25, waveBlend),
        0,
        THREE.MathUtils.lerp(0.08, 0.18 + waveOsc * 0.14, waveBlend),
      );

      // Alternating bouncy knees & subtle heel-lift step groove
      const leftStep = Math.max(0, halfBeat);
      const rightStep = Math.max(0, -halfBeat);
      j.leftHip.rotation.set(-bob * 0.18 - leftStep * 0.16 - emote * 0.32, 0, -0.05);
      j.leftKnee.rotation.x = bob * 0.34 + leftStep * 0.24 + emote * 0.62;
      j.rightHip.rotation.set(-bob * 0.18 - rightStep * 0.16 - emote * 0.32, 0, 0.05);
      j.rightKnee.rotation.x = bob * 0.34 + rightStep * 0.24 + emote * 0.62;
    } else if (charId === 'inferno_blaze') {
      // Energetic fighter bounce with wide open boxer guard & fist-pump roar!
      const bounce = Math.abs(Math.sin(elapsed * 4.8));
      const sway = Math.sin(elapsed * 2.4);
      const loopT = elapsed % 6.4;
      const pump = loopT > 4.2 && loopT < 5.6 ? Math.sin(((loopT - 4.2) / 1.4) * Math.PI) : 0;

      j.hips.position.y = 0.91 - bounce * 0.06;
      j.hips.rotation.set(0, sway * 0.14, sway * 0.05);
      j.spine.rotation.set(-0.06 - emote * 0.16 - pump * 0.12, -sway * 0.1, 0);
      j.chest.rotation.set(-0.04 + bounce * 0.07, sway * 0.08, 0);
      j.head.rotation.set(-0.06 + bounce * 0.07 - pump * 0.12, Math.sin(elapsed * 1.4) * 0.18, 0);

      j.leftShoulder.rotation.set(-0.62 - sway * 0.2 - emote * 1.0 - pump * 0.95, 0, -0.54 - pump * 0.24);
      j.leftElbow.rotation.set(-1.12 - bounce * 0.18 + pump * 0.3, 0, -0.1);
      j.rightShoulder.rotation.set(-0.62 + sway * 0.2 - emote * 1.0 - pump * 0.95, 0, 0.54 + pump * 0.24);
      j.rightElbow.rotation.set(-1.12 - bounce * 0.18 + pump * 0.3, 0, 0.1);

      j.leftHip.rotation.set(-0.14 - bounce * 0.12, 0, -0.1);
      j.leftKnee.rotation.x = 0.28 + bounce * 0.22;
      j.rightHip.rotation.set(-0.14 - bounce * 0.12, 0, 0.1);
      j.rightKnee.rotation.x = 0.28 + bounce * 0.22;
    } else if (charId === 'neon_slime') {
      // Playful elastic jiggle-groove with fluid rubbery arms swinging freely outside the body
      const wave = Math.sin(elapsed * 3.8);
      const wave2 = Math.sin(elapsed * 3.8 - 0.85);
      j.hips.position.y = 0.93 + wave * 0.065;
      j.hips.rotation.set(0, wave * 0.14, wave * 0.08);
      j.spine.rotation.set(wave2 * 0.09, -wave * 0.08, -wave2 * 0.1);
      j.chest.rotation.set(0, wave2 * 0.06, wave * 0.09);
      j.head.rotation.set(wave2 * 0.12, Math.sin(elapsed * 1.6) * 0.24, -wave * 0.14);

      j.leftShoulder.rotation.set(0.15 + wave * 0.3 - emote * 1.4, 0, -0.48 - wave2 * 0.22);
      j.leftElbow.rotation.set(-0.38 + wave2 * 0.24, 0, -0.1);
      j.rightShoulder.rotation.set(0.15 - wave * 0.3 - emote * 1.4, 0, 0.48 + wave2 * 0.22);
      j.rightElbow.rotation.set(-0.38 - wave2 * 0.24, 0, 0.1);

      j.leftHip.rotation.x = -0.08 - Math.abs(wave) * 0.14 - emote * 0.4;
      j.leftKnee.rotation.x = 0.16 + Math.abs(wave) * 0.26 + emote * 0.7;
      j.rightHip.rotation.x = -0.08 - Math.abs(wave2) * 0.14 - emote * 0.4;
      j.rightKnee.rotation.x = 0.16 + Math.abs(wave2) * 0.26 + emote * 0.7;
    } else if (charId === 'half_cyborg') {
      // Smooth hybrid idle: organic right side grooves while cyber left side performs crisp servo checks!
      const step = Math.floor(elapsed * 1.6);
      const servoAngle = Math.sin(step * 1.9) * 0.32;
      const breathe = Math.sin(elapsed * 3.0);
      const bob = Math.abs(breathe);

      j.hips.position.y = 0.93 - bob * 0.04;
      j.hips.rotation.set(0, Math.sin(elapsed * 1.2) * 0.08, 0);
      j.spine.rotation.set(0.03 + bob * 0.03, 0, 0);
      j.chest.rotation.set(0, Math.sin(elapsed * 1.5) * 0.06, 0);
      j.head.rotation.set(0.02 + breathe * 0.05, THREE.MathUtils.damp(j.head.rotation.y, servoAngle, 12, 0.03), 0);

      j.leftShoulder.rotation.set(-0.55 - emote * 0.9, 0, -0.42);
      j.leftElbow.rotation.set(-0.92 + Math.sin(step * 2.4) * 0.3, 0, -0.08);

      j.rightShoulder.rotation.set(0.12 + breathe * 0.16 - emote * 1.2, 0, 0.36);
      j.rightElbow.rotation.set(-0.42 - bob * 0.18, 0, 0.08);

      j.leftHip.rotation.x = -bob * 0.1;
      j.leftKnee.rotation.x = 0.1 + bob * 0.18;
      j.rightHip.rotation.x = -bob * 0.1;
      j.rightKnee.rotation.x = 0.1 + bob * 0.18;
    } else {
      // Void Shadow: poised ethereal hover with arms floating freely outside the shadow cloak
      const hover = Math.sin(elapsed * 2.4);
      const drift = Math.cos(elapsed * 1.5);
      j.hips.position.y = 0.98 + hover * 0.055;
      j.hips.rotation.set(0, drift * 0.12, hover * 0.04);
      j.spine.rotation.set(-0.05 + hover * 0.04, -drift * 0.06, 0);
      j.chest.rotation.set(0.04 - emote * 0.15, drift * 0.06, 0);
      j.head.rotation.set(0.06 + hover * 0.06, Math.sin(elapsed * 1.1) * 0.2, drift * 0.05);

      j.leftShoulder.rotation.set(-0.32 + drift * 0.14 - emote * 1.0, 0, -0.56 - hover * 0.14);
      j.leftElbow.rotation.set(-0.78 + hover * 0.12, 0, -0.1);
      j.rightShoulder.rotation.set(-0.32 - drift * 0.14 - emote * 1.0, 0, 0.56 + hover * 0.14);
      j.rightElbow.rotation.set(-0.78 - hover * 0.12, 0, 0.1);

      j.leftHip.rotation.x = 0.22 + hover * 0.1;
      j.leftKnee.rotation.x = 0.36 - hover * 0.08;
      j.rightHip.rotation.x = 0.14 - hover * 0.1;
      j.rightKnee.rotation.x = 0.44 + hover * 0.08;
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
