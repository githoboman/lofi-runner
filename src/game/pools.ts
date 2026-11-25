import * as THREE from 'three';
import { LANE_X, STAR_FLY_HEIGHT } from './config';
import {
  createContainerTexture,
  createCrateTexture,
  createHazardStripeTexture,
  createSuiCoinTexture,
} from './textures';
import type { ObstacleKind, PowerupKind, SceneId } from './types';

export interface PooledObstacle {
  active: boolean;
  kind: ObstacleKind;
  lane: number;
  z: number;
  sliced: boolean;
  sliceTimer: number;
  group: THREE.Group;
  crateView: THREE.Group;
  overheadView: THREE.Group;
  specialViews: Record<SceneId, THREE.Group>;
}

export interface PooledCoin {
  active: boolean;
  lane: number;
  x: number;
  y: number;
  z: number;
  phase: number;
  mesh: THREE.Mesh;
}

export interface PooledPowerup {
  active: boolean;
  kind: PowerupKind;
  lane: number;
  z: number;
  group: THREE.Group;
  swordView: THREE.Group;
  starView: THREE.Group;
}

interface BurstParticle {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  color: THREE.Color;
}

interface SlicedHalfDebris {
  active: boolean;
  group: THREE.Group;
  outerMesh: THREE.Mesh;
  seamMesh: THREE.Mesh;
  seamMat: THREE.MeshBasicMaterial;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  vrx: number;
  vry: number;
  vrz: number;
  life: number;
  maxLife: number;
  baseScaleY: number;
}

interface CutFlashPlane {
  active: boolean;
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  life: number;
  maxLife: number;
}

const OBSTACLE_POOL_SIZE = 28;
const COIN_POOL_SIZE = 96;
const POWERUP_POOL_SIZE = 6;
const PARTICLE_POOL_SIZE = 160;
const DEBRIS_HALF_POOL_SIZE = 24; // Up to 12 simultaneously sliced boxes (2 halves each)
const CUT_FLASH_POOL_SIZE = 8;

const SPAWN_START_Z = -135;
const DESPAWN_Z = 14;

const _dummy = new THREE.Object3D();
const _zeroMat = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * Builds two complementary 3D diagonal wedge geometries that fit together into a 1.85 x 1.4 x 1.65 box
 * so slicing a crate or block splits it realistically along a diagonal shear plane.
 */
function createDiagonalWedgeGeometries(): {
  upperGeo: THREE.ExtrudeGeometry;
  lowerGeo: THREE.ExtrudeGeometry;
  seamGeo: THREE.PlaneGeometry;
} {
  const hw = 0.92;
  const hh = 0.7;
  const depth = 1.64;

  // Upper-left diagonal half
  const upperShape = new THREE.Shape();
  upperShape.moveTo(-hw, -hh);
  upperShape.lineTo(hw, hh);
  upperShape.lineTo(-hw, hh);
  upperShape.closePath();

  const upperGeo = new THREE.ExtrudeGeometry(upperShape, {
    depth,
    bevelEnabled: true,
    bevelSize: 0.03,
    bevelThickness: 0.03,
    bevelSegments: 1,
  });
  upperGeo.translate(0, 0, -depth / 2);

  // Lower-right diagonal half
  const lowerShape = new THREE.Shape();
  lowerShape.moveTo(-hw, -hh);
  lowerShape.lineTo(hw, -hh);
  lowerShape.lineTo(hw, hh);
  lowerShape.closePath();

  const lowerGeo = new THREE.ExtrudeGeometry(lowerShape, {
    depth,
    bevelEnabled: true,
    bevelSize: 0.03,
    bevelThickness: 0.03,
    bevelSegments: 1,
  });
  lowerGeo.translate(0, 0, -depth / 2);

  // Diagonal glowing seared cut-seam plane
  const diagLen = Math.hypot(hw * 2, hh * 2);
  const seamGeo = new THREE.PlaneGeometry(diagLen, depth * 0.98);

  return { upperGeo, lowerGeo, seamGeo };
}

/**
 * Pooled Obstacles, SUI Gold Coins, Sword/Star Power-ups, Burst Sparks,
 * and Realistic Sheared 3D Box-Cutting Debris Physics.
 */
export class EntityPoolManager {
  public readonly root = new THREE.Group();
  public readonly obstacles: PooledObstacle[] = [];
  public readonly coins: PooledCoin[] = [];
  public readonly powerups: PooledPowerup[] = [];

  private particles: BurstParticle[] = [];
  private particleMesh: THREE.InstancedMesh;
  private debrisHalves: SlicedHalfDebris[] = [];
  private cutFlashes: CutFlashPlane[] = [];

  // Cached materials for matching cut debris to obstacle type/scene
  private crateMat: THREE.MeshStandardMaterial;
  private hazardMat: THREE.MeshStandardMaterial;
  private steelMat: THREE.MeshStandardMaterial;
  private magmaMat: THREE.MeshStandardMaterial;
  private slimeVatMat: THREE.MeshStandardMaterial;
  private galleryPedestalMat: THREE.MeshStandardMaterial;
  private iceBlockMat: THREE.MeshStandardMaterial;

  private lastOpenLane = 1;
  private nextRowDistance = 0;
  private rowsSincePowerup = 0;
  private currentScene: SceneId = 'frost_sanctuary';

  constructor(scene: THREE.Scene, maxAniso: number) {
    scene.add(this.root);

    // Shared obstacle materials
    const crateTex = createCrateTexture(maxAniso);
    this.crateMat = new THREE.MeshStandardMaterial({ map: crateTex, roughness: 0.72, metalness: 0.08 });
    const hazardTex = createHazardStripeTexture(maxAniso);
    this.hazardMat = new THREE.MeshStandardMaterial({ map: hazardTex, roughness: 0.45, metalness: 0.2 });
    this.steelMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.35, metalness: 0.78 });
    const neonBarMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x38bdf8,
      emissiveIntensity: 1.35,
      roughness: 0.2,
    });
    this.magmaMat = new THREE.MeshStandardMaterial({
      color: 0x291512,
      emissive: 0xf97316,
      emissiveIntensity: 0.85,
      roughness: 0.45,
      metalness: 0.25,
    });
    const lavaGlowMat = new THREE.MeshBasicMaterial({ color: 0xfde047 });
    this.slimeVatMat = new THREE.MeshStandardMaterial({
      color: 0x16a34a,
      emissive: 0x22c55e,
      emissiveIntensity: 0.75,
      roughness: 0.18,
      metalness: 0.22,
      transparent: true,
      opacity: 0.88,
    });
    const harborContTex = createContainerTexture('#2563eb', maxAniso);
    const cyberUnitMat = new THREE.MeshStandardMaterial({
      map: harborContTex,
      roughness: 0.42,
      metalness: 0.52,
    });
    this.galleryPedestalMat = new THREE.MeshStandardMaterial({
      color: 0x18142b,
      roughness: 0.16,
      metalness: 0.55,
    });
    const galleryGoldMat = new THREE.MeshStandardMaterial({
      color: 0xd4af37,
      roughness: 0.22,
      metalness: 0.88,
      emissive: 0x92400e,
      emissiveIntensity: 0.25,
    });
    this.iceBlockMat = new THREE.MeshStandardMaterial({
      color: 0x7dd3fc,
      emissive: 0x0284c7,
      emissiveIntensity: 0.28,
      roughness: 0.14,
      metalness: 0.2,
      transparent: true,
      opacity: 0.9,
    });

    const crateGeo = new THREE.BoxGeometry(1.85, 1.35, 1.65);
    const crateCapGeo = new THREE.BoxGeometry(1.94, 0.14, 1.74);
    const postGeo = new THREE.CylinderGeometry(0.11, 0.13, 2.75, 8);
    const beamGeo = new THREE.BoxGeometry(2.3, 0.78, 0.55);

    // Build pooled obstacles
    for (let i = 0; i < OBSTACLE_POOL_SIZE; i++) {
      const group = new THREE.Group();
      group.visible = false;

      const crateView = new THREE.Group();
      const crateBody = new THREE.Mesh(crateGeo, this.crateMat);
      crateBody.position.y = 0.68;
      crateBody.castShadow = true;
      const crateTrim = new THREE.Mesh(crateCapGeo, this.steelMat);
      crateTrim.position.y = 1.38;
      crateView.add(crateBody, crateTrim);

      const overheadView = new THREE.Group();
      const leftPost = new THREE.Mesh(postGeo, this.steelMat);
      leftPost.position.set(-1.05, 1.38, 0);
      const rightPost = new THREE.Mesh(postGeo, this.steelMat);
      rightPost.position.set(1.05, 1.38, 0);
      const crossBeam = new THREE.Mesh(beamGeo, this.hazardMat);
      crossBeam.position.set(0, 1.98, 0);
      crossBeam.castShadow = true;
      const lightStrip = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.12, 0.6), neonBarMat);
      lightStrip.position.set(0, 1.56, 0);
      overheadView.add(leftPost, rightPost, crossBeam, lightStrip);

      // World 1 (OG Lofi): Frost Sanctuary Ice Spires
      const frostSpecial = new THREE.Group();
      const iceMain = new THREE.Mesh(new THREE.BoxGeometry(1.95, 2.35, 1.95), this.iceBlockMat);
      iceMain.position.y = 1.18;
      iceMain.castShadow = true;
      const iceSpike1 = new THREE.Mesh(new THREE.ConeGeometry(0.65, 1.3, 5), this.iceBlockMat);
      iceSpike1.position.set(-0.35, 2.55, 0.1);
      const iceSpike2 = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.05, 5), this.iceBlockMat);
      iceSpike2.position.set(0.42, 2.4, -0.2);
      frostSpecial.add(iceMain, iceSpike1, iceSpike2);

      // World 2 (Inferno Blaze): Ember Caldera Molten Basalt Monolith
      const infernoSpecial = new THREE.Group();
      const basaltCore = new THREE.Mesh(new THREE.BoxGeometry(1.9, 2.4, 1.9), this.magmaMat);
      basaltCore.position.y = 1.2;
      basaltCore.castShadow = true;
      const magmaVein = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.24, 1.98), lavaGlowMat);
      magmaVein.position.y = 1.35;
      const magmaCrown = new THREE.Mesh(new THREE.ConeGeometry(0.85, 1.2, 5), this.magmaMat);
      magmaCrown.position.y = 2.65;
      infernoSpecial.add(basaltCore, magmaVein, magmaCrown);

      // World 3 (Neon Slime): Ectoplasm Lab Bio-Hazard Vat
      const slimeSpecial = new THREE.Group();
      const vatBase = new THREE.Mesh(new THREE.CylinderGeometry(0.98, 1.05, 0.35, 12), this.steelMat);
      vatBase.position.y = 0.18;
      const vatTube = new THREE.Mesh(new THREE.CylinderGeometry(0.86, 0.86, 2.1, 12), this.slimeVatMat);
      vatTube.position.y = 1.35;
      vatTube.castShadow = true;
      const vatCap = new THREE.Mesh(new THREE.CylinderGeometry(0.98, 0.98, 0.32, 12), this.steelMat);
      vatCap.position.y = 2.45;
      slimeSpecial.add(vatBase, vatTube, vatCap);

      // World 4 (Half-Cyborg): Mecha Foundry Cyber Barricade / Cargo Pod
      const cyberSpecial = new THREE.Group();
      const cyberBody = new THREE.Mesh(new THREE.BoxGeometry(2.05, 2.35, 2.6), cyberUnitMat);
      cyberBody.position.y = 1.18;
      cyberBody.castShadow = true;
      const cyberStripe = new THREE.Mesh(new THREE.BoxGeometry(2.12, 0.25, 2.66), neonBarMat);
      cyberStripe.position.y = 1.85;
      cyberSpecial.add(cyberBody, cyberStripe);

      // World 5 (Void Shadow): Astral Gallery Obsidian Pedestal + Gold Relic
      const voidSpecial = new THREE.Group();
      const pedBase = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.45, 1.8), this.galleryPedestalMat);
      pedBase.position.y = 0.72;
      pedBase.castShadow = true;
      const sculpture = new THREE.Mesh(new THREE.OctahedronGeometry(0.72, 0), galleryGoldMat);
      sculpture.position.y = 2.15;
      const goldTrim = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.14, 1.9), galleryGoldMat);
      goldTrim.position.y = 1.46;
      voidSpecial.add(pedBase, goldTrim, sculpture);

      const specialViews: Record<SceneId, THREE.Group> = {
        frost_sanctuary: frostSpecial,
        inferno_caldera: infernoSpecial,
        slime_catacombs: slimeSpecial,
        cyber_foundry: cyberSpecial,
        void_gallery: voidSpecial,
      };

      group.add(
        crateView,
        overheadView,
        frostSpecial,
        infernoSpecial,
        slimeSpecial,
        cyberSpecial,
        voidSpecial,
      );
      this.root.add(group);

      this.obstacles.push({
        active: false,
        kind: 'crate',
        lane: 1,
        z: 0,
        sliced: false,
        sliceTimer: 0,
        group,
        crateView,
        overheadView,
        specialViews,
      });
    }

    // Build pooled realistic diagonally sheared debris halves (pairs of upper/lower wedges)
    const { upperGeo, lowerGeo, seamGeo } = createDiagonalWedgeGeometries();
    const diagAngle = Math.atan2(1.4, 1.84);
    for (let i = 0; i < DEBRIS_HALF_POOL_SIZE; i++) {
      const isUpper = i % 2 === 0;
      const group = new THREE.Group();
      group.visible = false;

      const outerMesh = new THREE.Mesh(isUpper ? upperGeo : lowerGeo, this.crateMat);
      outerMesh.castShadow = true;

      const seamMat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.92,
      });
      const seamMesh = new THREE.Mesh(seamGeo, seamMat);
      seamMesh.rotation.x = Math.PI / 2;
      seamMesh.rotation.y = diagAngle;
      // Offset seam slightly toward open face to prevent Z-fighting
      seamMesh.position.set(isUpper ? 0.02 : -0.02, isUpper ? -0.02 : 0.02, 0);

      group.add(outerMesh, seamMesh);
      this.root.add(group);

      this.debrisHalves.push({
        active: false,
        group,
        outerMesh,
        seamMesh,
        seamMat,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        rx: 0,
        ry: 0,
        rz: 0,
        vrx: 0,
        vry: 0,
        vrz: 0,
        life: 0,
        maxLife: 0.95,
        baseScaleY: 1,
      });
    }

    // Build pooled glowing plasma cut-flash planes
    const flashGeo = new THREE.PlaneGeometry(3.4, 0.28);
    for (let i = 0; i < CUT_FLASH_POOL_SIZE; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(flashGeo, mat);
      mesh.visible = false;
      this.root.add(mesh);
      this.cutFlashes.push({
        active: false,
        mesh,
        mat,
        life: 0,
        maxLife: 0.18,
      });
    }

    // Build pooled Gold Coins with blue "SUI" cap faces
    const coinTex = createSuiCoinTexture(maxAniso);
    const coinEdgeMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      roughness: 0.22,
      metalness: 0.9,
      emissive: 0x78350f,
      emissiveIntensity: 0.2,
    });
    const coinFaceMat = new THREE.MeshStandardMaterial({
      map: coinTex,
      roughness: 0.2,
      metalness: 0.72,
      emissive: 0x1d4ed8,
      emissiveIntensity: 0.14,
    });
    const coinGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.13, 18);
    coinGeo.rotateZ(Math.PI / 2);

    for (let i = 0; i < COIN_POOL_SIZE; i++) {
      const mesh = new THREE.Mesh(coinGeo, [coinEdgeMat, coinFaceMat, coinFaceMat]);
      mesh.visible = false;
      this.root.add(mesh);
      this.coins.push({
        active: false,
        lane: 1,
        x: 0,
        y: 1,
        z: 0,
        phase: i * 0.35,
        mesh,
      });
    }

    // Build pooled Power-ups (Sword & Star)
    const swordBladeMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x38bdf8,
      emissiveIntensity: 1.5,
      roughness: 0.18,
      metalness: 0.6,
    });
    const starMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      emissive: 0xf59e0b,
      emissiveIntensity: 1.25,
      roughness: 0.15,
      metalness: 0.82,
    });
    const ringGlowMat = new THREE.MeshBasicMaterial({
      color: 0x7dd3fc,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    });

    for (let i = 0; i < POWERUP_POOL_SIZE; i++) {
      const group = new THREE.Group();
      group.visible = false;

      const swordView = new THREE.Group();
      const sBlade = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.35, 0.08), swordBladeMat);
      sBlade.position.y = 0.25;
      const sGuard = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.12, 0.16), galleryGoldMat);
      sGuard.position.y = -0.35;
      const sGrip = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.36, 8), this.steelMat);
      sGrip.position.y = -0.58;
      const sRing = new THREE.Mesh(new THREE.TorusGeometry(0.88, 0.045, 8, 24), ringGlowMat);
      swordView.add(sBlade, sGuard, sGrip, sRing);
      swordView.rotation.z = -0.32;

      const starView = new THREE.Group();
      const starCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.62, 0), starMat);
      const starSpike = new THREE.Mesh(new THREE.OctahedronGeometry(0.62, 0), starMat);
      starSpike.rotation.y = Math.PI / 4;
      starSpike.rotation.z = Math.PI / 4;
      const starHalo = new THREE.Mesh(
        new THREE.TorusGeometry(0.92, 0.05, 8, 24),
        new THREE.MeshBasicMaterial({ color: 0xfde047, transparent: true, opacity: 0.7 }),
      );
      starView.add(starCore, starSpike, starHalo);

      group.add(swordView, starView);
      this.root.add(group);

      this.powerups.push({
        active: false,
        kind: 'sword',
        lane: 1,
        z: 0,
        group,
        swordView,
        starView,
      });
    }

    // Build instanced burst particle pool
    const pGeo = new THREE.OctahedronGeometry(0.16, 0);
    const pMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.particleMesh = new THREE.InstancedMesh(pGeo, pMat, PARTICLE_POOL_SIZE);
    this.particleMesh.frustumCulled = false;
    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
      this.particleMesh.setMatrixAt(i, _zeroMat);
      this.particleMesh.setColorAt(i, new THREE.Color(0xfacc15));
      this.particles.push({
        active: false,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 0.4,
        color: new THREE.Color(0xfacc15),
      });
    }
    this.particleMesh.instanceMatrix.needsUpdate = true;
    this.root.add(this.particleMesh);
  }

  public setScene(sceneId: SceneId): void {
    this.currentScene = sceneId;
    for (const obs of this.obstacles) {
      if (obs.active && obs.kind === 'special') {
        this.syncObstacleVisual(obs);
      }
    }
  }

  public clearObstaclesInRange(minZ: number, maxZ: number): void {
    for (const obs of this.obstacles) {
      if (obs.active && obs.z >= minZ && obs.z <= maxZ) {
        obs.active = false;
        obs.sliced = false;
        obs.group.visible = false;
      }
    }
  }

  public reset(): void {
    this.lastOpenLane = 1;
    this.nextRowDistance = 28;
    this.rowsSincePowerup = 0;

    for (const o of this.obstacles) {
      o.active = false;
      o.sliced = false;
      o.group.visible = false;
    }
    for (const d of this.debrisHalves) {
      d.active = false;
      d.group.visible = false;
    }
    for (const f of this.cutFlashes) {
      f.active = false;
      f.mesh.visible = false;
    }
    for (const c of this.coins) {
      c.active = false;
      c.mesh.visible = false;
    }
    for (const p of this.powerups) {
      p.active = false;
      p.group.visible = false;
    }
    for (let i = 0; i < this.particles.length; i++) {
      this.particles[i].active = false;
      this.particleMesh.setMatrixAt(i, _zeroMat);
    }
    this.particleMesh.instanceMatrix.needsUpdate = true;
  }

  public spawnBurst(x: number, y: number, z: number, hexColor: number, count = 12): void {
    let spawned = 0;
    for (let i = 0; i < this.particles.length && spawned < count; i++) {
      const p = this.particles[i];
      if (!p.active) {
        p.active = true;
        p.x = x;
        p.y = y;
        p.z = z;
        const angle = Math.random() * Math.PI * 2;
        const spd = 3.2 + Math.random() * 5.8;
        p.vx = Math.cos(angle) * spd;
        p.vy = 2.8 + Math.random() * 5.2;
        p.vz = Math.sin(angle) * spd;
        p.life = 0;
        p.maxLife = 0.34 + Math.random() * 0.24;
        p.color.setHex(hexColor);
        this.particleMesh.setColorAt(i, p.color);
        spawned++;
      }
    }
    if (this.particleMesh.instanceColor) {
      this.particleMesh.instanceColor.needsUpdate = true;
    }
  }

  private getMaterialForObstacle(kind: ObstacleKind): THREE.Material {
    if (kind === 'crate') return this.crateMat;
    if (kind === 'overhead') return this.hazardMat;
    if (this.currentScene === 'frost_sanctuary') return this.iceBlockMat;
    if (this.currentScene === 'inferno_caldera') return this.magmaMat;
    if (this.currentScene === 'slime_catacombs') return this.slimeVatMat;
    if (this.currentScene === 'void_gallery') return this.galleryPedestalMat;
    return this.steelMat;
  }

  /**
   * Realistically shears an obstacle into two 3D diagonal halves with seared plasma cut edges,
   * directional splinter bursts, and a glowing slash flash line across the cut plane!
   */
  public sliceObstacle(obs: PooledObstacle, slashColor = 0x38bdf8, cutDir = 1): void {
    if (obs.sliced) return;
    obs.sliced = true;
    obs.active = false;
    obs.group.visible = false;

    const baseX = LANE_X[obs.lane];
    const baseY = obs.kind === 'overhead' ? 1.85 : obs.kind === 'special' ? 1.2 : 0.72;
    const scaleY = obs.kind === 'special' ? 1.55 : obs.kind === 'overhead' ? 0.62 : 1.0;
    const scaleZ = obs.kind === 'special' && this.currentScene === 'cyber_foundry' ? 1.45 : 1.0;
    const mat = this.getMaterialForObstacle(obs.kind);

    // Find a free pair of upper/lower diagonal wedge halves
    for (let i = 0; i < this.debrisHalves.length - 1; i += 2) {
      const upper = this.debrisHalves[i];
      const lower = this.debrisHalves[i + 1];
      if (!upper.active && !lower.active) {
        const flipX = cutDir < 0 ? -1 : 1;

        // Upper-left sheared piece pops up and spins away
        upper.active = true;
        upper.life = 0;
        upper.maxLife = 1.05;
        upper.outerMesh.material = mat;
        upper.seamMat.color.setHex(slashColor);
        upper.seamMat.opacity = 1;
        upper.x = baseX - 0.14 * flipX;
        upper.y = baseY + 0.18;
        upper.z = obs.z;
        upper.vx = (-4.8 - Math.random() * 2.2) * flipX;
        upper.vy = 7.4 + Math.random() * 2.4;
        upper.vz = -4.5 - Math.random() * 2.5;
        upper.rx = 0;
        upper.ry = 0;
        upper.rz = 0;
        upper.vrx = -4.5 - Math.random() * 3.0;
        upper.vry = (-3.2 - Math.random() * 2.5) * flipX;
        upper.vrz = (6.8 + Math.random() * 3.0) * flipX;
        upper.baseScaleY = scaleY;
        upper.group.scale.set(flipX, scaleY, scaleZ);
        upper.group.position.set(upper.x, upper.y, upper.z);
        upper.group.rotation.set(0, 0, 0);
        upper.group.visible = true;

        // Lower-right sheared piece kicks outward and tumbles low with bounce
        lower.active = true;
        lower.life = 0;
        lower.maxLife = 1.05;
        lower.outerMesh.material = mat;
        lower.seamMat.color.setHex(slashColor);
        lower.seamMat.opacity = 1;
        lower.x = baseX + 0.14 * flipX;
        lower.y = baseY - 0.08;
        lower.z = obs.z;
        lower.vx = (5.2 + Math.random() * 2.4) * flipX;
        lower.vy = 3.8 + Math.random() * 1.8;
        lower.vz = -2.0 + Math.random() * 1.8;
        lower.rx = 0;
        lower.ry = 0;
        lower.rz = 0;
        lower.vrx = 3.8 + Math.random() * 2.5;
        lower.vry = (3.4 + Math.random() * 2.2) * flipX;
        lower.vrz = (-5.8 - Math.random() * 2.8) * flipX;
        lower.baseScaleY = scaleY;
        lower.group.scale.set(flipX, scaleY, scaleZ);
        lower.group.position.set(lower.x, lower.y, lower.z);
        lower.group.rotation.set(0, 0, 0);
        lower.group.visible = true;
        break;
      }
    }

    // Spawn bright diagonal plasma slash flash plane right through the obstacle
    const flash = this.cutFlashes.find((f) => !f.active);
    if (flash) {
      flash.active = true;
      flash.life = 0;
      flash.maxLife = 0.2;
      flash.mat.color.setHex(slashColor);
      flash.mat.opacity = 0.95;
      flash.mesh.position.set(baseX, baseY + 0.15, obs.z + 0.6);
      flash.mesh.rotation.set(0, 0, cutDir * 0.64);
      flash.mesh.scale.set(0.6, 1.4, 1);
      flash.mesh.visible = true;
    }

    // Splinter & plasma spark shower along the diagonal cut!
    const splinterColor =
      obs.kind === 'crate'
        ? 0xd97706
        : this.currentScene === 'frost_sanctuary'
          ? 0xbae6fd
          : this.currentScene === 'inferno_caldera'
            ? 0xf97316
            : this.currentScene === 'slime_catacombs'
              ? 0x4ade80
              : 0xfacc15;
    this.spawnBurst(baseX, baseY + 0.25, obs.z, slashColor, 14);
    this.spawnBurst(baseX, baseY + 0.1, obs.z, splinterColor, 12);
  }

  public update(
    dt: number,
    speed: number,
    elapsed: number,
    distance: number,
    starActive: boolean,
    pauseObstacleSpawns = false,
  ): void {
    const dz = speed * dt;

    if (distance >= this.nextRowDistance) {
      if (!pauseObstacleSpawns) {
        this.spawnReachablePattern(SPAWN_START_Z, starActive);
      }
      const spacing = THREE.MathUtils.clamp(25 - speed * 0.14, 17, 25);
      this.nextRowDistance = distance + spacing;
    }

    // Move intact obstacles
    for (const obs of this.obstacles) {
      if (!obs.active) continue;
      obs.z += dz;
      obs.group.position.z = obs.z;
      if (obs.z > DESPAWN_Z) {
        obs.active = false;
        obs.group.visible = false;
      }
    }

    // Update realistic tumbling sheared obstacle halves with gravity & floor bounce!
    for (const d of this.debrisHalves) {
      if (!d.active) continue;
      d.life += dt;
      if (d.life >= d.maxLife || d.z > DESPAWN_Z + 8) {
        d.active = false;
        d.group.visible = false;
        continue;
      }

      d.vy -= 26 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += (d.vz + speed * 0.72) * dt;

      // Ground bounce with friction & spin kick
      const floorY = 0.42;
      if (d.y < floorY) {
        d.y = floorY;
        d.vy = Math.abs(d.vy) * 0.36;
        d.vx *= 0.82;
        d.vrz *= 0.78;
      }

      d.rx += d.vrx * dt;
      d.ry += d.vry * dt;
      d.rz += d.vrz * dt;

      d.group.position.set(d.x, d.y, d.z);
      d.group.rotation.set(d.rx, d.ry, d.rz);

      // Cool down glowing cut seam and fade out smoothly at end of life
      const t = d.life / d.maxLife;
      d.seamMat.opacity = Math.max(0.15, 1 - t * 1.4);
      if (t > 0.72) {
        const shrink = Math.max(0.01, 1 - (t - 0.72) / 0.28);
        const signX = d.group.scale.x < 0 ? -1 : 1;
        d.group.scale.set(signX * shrink, d.baseScaleY * shrink, shrink);
      }
    }

    // Update plasma cut-flash planes
    for (const f of this.cutFlashes) {
      if (!f.active) continue;
      f.life += dt;
      if (f.life >= f.maxLife) {
        f.active = false;
        f.mesh.visible = false;
        continue;
      }
      const p = f.life / f.maxLife;
      f.mesh.position.z += dz * 0.5;
      f.mesh.scale.set(0.75 + p * 1.65, Math.max(0.1, 1.35 * (1 - p)), 1);
      f.mat.opacity = (1 - p) * 0.95;
    }

    // Move & spin SUI coins
    for (const coin of this.coins) {
      if (!coin.active) continue;
      coin.z += dz;
      coin.mesh.position.set(coin.x, coin.y + Math.sin(elapsed * 4.2 + coin.phase) * 0.12, coin.z);
      coin.mesh.rotation.y = elapsed * 3.4 + coin.phase;
      if (coin.z > DESPAWN_Z) {
        coin.active = false;
        coin.mesh.visible = false;
      }
    }

    // Move & hover power-ups
    for (const pu of this.powerups) {
      if (!pu.active) continue;
      pu.z += dz;
      pu.group.position.set(LANE_X[pu.lane], 1.5 + Math.sin(elapsed * 4.5) * 0.22, pu.z);
      pu.group.rotation.y = elapsed * 2.4;
      if (pu.z > DESPAWN_Z) {
        pu.active = false;
        pu.group.visible = false;
      }
    }

    // Update burst particles
    let anyParticles = false;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      anyParticles = true;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.active = false;
        this.particleMesh.setMatrixAt(i, _zeroMat);
        continue;
      }
      p.vy -= 18 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += (p.vz + speed * 0.35) * dt;

      const scale = Math.max(0.01, 1 - p.life / p.maxLife);
      _dummy.position.set(p.x, Math.max(0.08, p.y), p.z);
      _dummy.rotation.set(p.life * 8, p.life * 6, 0);
      _dummy.scale.setScalar(scale * 1.15);
      _dummy.updateMatrix();
      this.particleMesh.setMatrixAt(i, _dummy.matrix);
    }
    if (anyParticles) {
      this.particleMesh.instanceMatrix.needsUpdate = true;
    }
  }

  private spawnReachablePattern(zPos: number, starActive: boolean): void {
    const delta = Math.floor(Math.random() * 3) - 1;
    const openLane = THREE.MathUtils.clamp(this.lastOpenLane + delta, 0, 2);
    this.lastOpenLane = openLane;

    const otherLanes = [0, 1, 2].filter((l) => l !== openLane);
    const blockCount = Math.random() < 0.74 ? 2 : 1;

    for (let i = 0; i < blockCount; i++) {
      const lane = otherLanes[i];
      const roll = Math.random();
      let kind: ObstacleKind = 'crate';
      if (roll < 0.38) kind = 'crate';
      else if (roll < 0.68) kind = 'overhead';
      else kind = 'special';
      this.acquireObstacle(lane, kind, zPos);
    }

    const coinLane = openLane;
    if (starActive) {
      // High sky coin arcs + occasional low swoop coins during Star flight!
      const isSwoopRow = Math.random() < 0.32;
      const baseH = isSwoopRow ? STAR_FLY_HEIGHT - 1.9 : STAR_FLY_HEIGHT + 0.5;
      for (let i = 0; i < 6; i++) {
        const arc = Math.sin((i / 5) * Math.PI) * 0.7;
        this.acquireCoin(coinLane, baseH + arc, zPos - 7 + i * 2.5);
      }
    } else {
      for (let i = 0; i < 5; i++) {
        this.acquireCoin(coinLane, 1.05, zPos - 6 + i * 2.6);
      }

      const crateLane = otherLanes[0];
      if (Math.random() < 0.45) {
        const obs = this.obstacles.find((o) => o.active && o.z === zPos && o.lane === crateLane);
        if (obs && obs.kind === 'crate') {
          const arcHeights = [1.4, 2.55, 2.9, 2.55, 1.4];
          for (let i = 0; i < 5; i++) {
            this.acquireCoin(crateLane, arcHeights[i], zPos - 4.4 + i * 2.2);
          }
        }
      }
    }

    this.rowsSincePowerup++;
    if (this.rowsSincePowerup >= 7 && Math.random() < 0.48) {
      this.rowsSincePowerup = 0;
      const puKind: PowerupKind = Math.random() < 0.54 ? 'sword' : 'star';
      this.acquirePowerup(openLane, puKind, zPos - 10.5);
    }
  }

  private acquireObstacle(lane: number, kind: ObstacleKind, z: number): void {
    const slot = this.obstacles.find((o) => !o.active);
    if (!slot) return;

    slot.active = true;
    slot.kind = kind;
    slot.lane = lane;
    slot.z = z;
    slot.sliced = false;
    slot.sliceTimer = 0;

    slot.group.visible = true;
    slot.group.position.set(LANE_X[lane], 0, z);
    slot.group.rotation.set(0, 0, 0);
    slot.group.scale.set(1, 1, 1);

    this.syncObstacleVisual(slot);
  }

  private syncObstacleVisual(obs: PooledObstacle): void {
    obs.crateView.visible = obs.kind === 'crate';
    obs.overheadView.visible = obs.kind === 'overhead';
    (Object.keys(obs.specialViews) as SceneId[]).forEach((sid) => {
      obs.specialViews[sid].visible = obs.kind === 'special' && sid === this.currentScene;
    });
  }

  private acquireCoin(lane: number, y: number, z: number): void {
    const slot = this.coins.find((c) => !c.active);
    if (!slot) return;
    slot.active = true;
    slot.lane = lane;
    slot.x = LANE_X[lane];
    slot.y = y;
    slot.z = z;
    slot.mesh.visible = true;
    slot.mesh.position.set(slot.x, y, z);
  }

  private acquirePowerup(lane: number, kind: PowerupKind, z: number): void {
    const slot = this.powerups.find((p) => !p.active);
    if (!slot) return;
    slot.active = true;
    slot.kind = kind;
    slot.lane = lane;
    slot.z = z;
    slot.group.visible = true;
    slot.group.position.set(LANE_X[lane], 1.5, z);
    slot.swordView.visible = kind === 'sword';
    slot.starView.visible = kind === 'star';
  }

  public dispose(): void {
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
