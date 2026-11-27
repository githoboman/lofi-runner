import * as THREE from 'three';
import { LANE_X, STAR_FLY_HEIGHT } from './config';
import {
  createContainerTexture,
  createCrateTexture,
  createHazardStripeTexture,
  createSuiCoinTexture,
} from './textures';
import type { PoolReplayEntities } from './replayRecorder';
import type { DifficultyId, ObstacleKind, PowerupKind, SceneId } from './types';

export interface PooledObstacle {
  active: boolean;
  kind: ObstacleKind;
  lane: number;
  z: number;
  sliced: boolean;
  sliceTimer: number;
  group: THREE.Group;
  crateViews: Record<SceneId, THREE.Group>;
  overheadViews: Record<SceneId, THREE.Group>;
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

const OBSTACLE_POOL_SIZE = 48;
const COIN_POOL_SIZE = 120;
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

  // Cached materials for matching world-themed obstacles & sheared cut debris
  private crateMat: THREE.MeshStandardMaterial;
  private hazardMat: THREE.MeshStandardMaterial;
  private steelMat: THREE.MeshStandardMaterial;
  private magmaMat: THREE.MeshStandardMaterial;
  private slimeVatMat: THREE.MeshStandardMaterial;
  private cyberUnitMat: THREE.MeshStandardMaterial;
  private galleryPedestalMat: THREE.MeshStandardMaterial;
  private iceBlockMat: THREE.MeshStandardMaterial;

  private lastOpenLane = 1;
  private nextRowDistance = 0;
  private rowsSincePowerup = 0;
  private lastRowHadSpecial = false;
  private lastActionGateRow = false;
  private slideMode = false;
  private currentScene: SceneId = 'frost_sanctuary';
  private difficulty: DifficultyId = 'normal';

  constructor(scene: THREE.Scene, maxAniso: number) {
    scene.add(this.root);

    // Shared per-world obstacle materials
    const crateTex = createCrateTexture(maxAniso);
    this.crateMat = new THREE.MeshStandardMaterial({ map: crateTex, roughness: 0.72, metalness: 0.08 });
    const hazardTex = createHazardStripeTexture(maxAniso);
    this.hazardMat = new THREE.MeshStandardMaterial({ map: hazardTex, roughness: 0.45, metalness: 0.2 });
    this.steelMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.35, metalness: 0.78 });

    // Frost Sanctuary materials (high-contrast deep glacier cobalt, dark slate & alpine cedar — never blinding white!)
    this.iceBlockMat = new THREE.MeshStandardMaterial({
      color: 0x1d4ed8,
      emissive: 0x0c4a6e,
      emissiveIntensity: 0.22,
      roughness: 0.28,
      metalness: 0.18,
    });
    const frostSnowCapMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.62,
      metalness: 0.24,
    });
    const frostTimberMat = new THREE.MeshStandardMaterial({
      color: 0x4a3122,
      roughness: 0.78,
      metalness: 0.12,
    });

    // Inferno Caldera materials (grounded dark volcanic brown basalt + muted amber veins)
    this.magmaMat = new THREE.MeshStandardMaterial({
      color: 0x331f17,
      emissive: 0x9a3412,
      emissiveIntensity: 0.35,
      roughness: 0.72,
      metalness: 0.22,
    });
    const forgedIronMat = new THREE.MeshStandardMaterial({
      color: 0x2c2422,
      roughness: 0.42,
      metalness: 0.85,
    });
    const emberVeinMat = new THREE.MeshBasicMaterial({ color: 0xc2410c });

    // Slime Catacombs materials (grounded dark steel + restrained deep emerald accents — easy on the eyes!)
    this.slimeVatMat = new THREE.MeshStandardMaterial({
      color: 0x0f5132,
      emissive: 0x047857,
      emissiveIntensity: 0.28,
      roughness: 0.28,
      metalness: 0.26,
    });
    const sewerMetalMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.52,
      metalness: 0.7,
    });
    const slimeGlowMat = new THREE.MeshBasicMaterial({ color: 0x10b981 });

    // Cyber Foundry materials
    const cyberContTex = createContainerTexture('#1e293b', maxAniso);
    this.cyberUnitMat = new THREE.MeshStandardMaterial({
      map: cyberContTex,
      roughness: 0.34,
      metalness: 0.65,
    });
    const cyberCyanMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x38bdf8,
      emissiveIntensity: 1.25,
      roughness: 0.2,
    });
    const cyberMagentaMat = new THREE.MeshStandardMaterial({
      color: 0xe879f9,
      emissive: 0xd946ef,
      emissiveIntensity: 1.1,
      roughness: 0.2,
    });

    // Void Gallery materials
    this.galleryPedestalMat = new THREE.MeshStandardMaterial({
      color: 0x161228,
      roughness: 0.16,
      metalness: 0.58,
    });
    const galleryGoldMat = new THREE.MeshStandardMaterial({
      color: 0xd4af37,
      roughness: 0.22,
      metalness: 0.88,
      emissive: 0x92400e,
      emissiveIntensity: 0.25,
    });
    const voidVioletMat = new THREE.MeshBasicMaterial({ color: 0xa78bfa });

    // Shared obstacle geometries (zero duplicate buffers across pool slots)
    const crateGeo = new THREE.BoxGeometry(1.86, 1.32, 1.66);
    const crateCapGeo = new THREE.BoxGeometry(1.96, 0.16, 1.76);
    const crateBandGeo = new THREE.BoxGeometry(1.94, 0.18, 1.74);
    const drumGeo = new THREE.CylinderGeometry(0.86, 0.88, 1.32, 12);
    const drumRingGeo = new THREE.CylinderGeometry(0.92, 0.92, 0.14, 12);

    const postGeo = new THREE.CylinderGeometry(0.14, 0.17, 2.75, 8);
    const stonePostGeo = new THREE.BoxGeometry(0.36, 2.75, 0.42);
    const beamGeo = new THREE.BoxGeometry(2.38, 0.78, 0.56);
    const pipeBeamGeo = new THREE.CylinderGeometry(0.34, 0.34, 2.4, 10);
    pipeBeamGeo.rotateZ(Math.PI / 2);
    const icicleGeo = new THREE.ConeGeometry(0.14, 0.36, 5);
    icicleGeo.rotateX(Math.PI);

    // Tall unjumpable monolith geometries (~4.75-4.95m tall!)
    const frostTowerGeo = new THREE.BoxGeometry(1.98, 3.8, 1.92);
    const frostPeakBigGeo = new THREE.ConeGeometry(0.88, 1.65, 5);
    const frostPeakSmGeo = new THREE.ConeGeometry(0.62, 1.25, 5);

    const infernoTowerGeo = new THREE.BoxGeometry(1.95, 4.1, 1.9);
    const infernoCapGeo = new THREE.ConeGeometry(1.12, 1.15, 4);
    const infernoBandGeo = new THREE.BoxGeometry(2.08, 0.22, 2.02);

    const slimeTankBaseGeo = new THREE.CylinderGeometry(1.02, 1.08, 0.38, 12);
    const slimeTankGlassGeo = new THREE.CylinderGeometry(0.88, 0.88, 4.15, 12);
    const slimeTankRingGeo = new THREE.CylinderGeometry(1.0, 1.0, 0.24, 12);

    const cyberTowerGeo = new THREE.BoxGeometry(2.08, 4.75, 2.55);
    const cyberStripeGeo = new THREE.BoxGeometry(2.16, 0.2, 2.62);

    const voidPillarGeo = new THREE.BoxGeometry(1.86, 4.05, 1.86);
    const voidTrimGeo = new THREE.BoxGeometry(1.98, 0.16, 1.98);
    const voidSpireGeo = new THREE.OctahedronGeometry(0.76, 0);

    // Build pooled world-matched obstacles
    for (let i = 0; i < OBSTACLE_POOL_SIZE; i++) {
      const group = new THREE.Group();
      group.visible = false;

      // ===== 1. JUMPABLE LOW BLOCKS ('crate') — bespoke per world =====
      const frostCrate = new THREE.Group();
      const fBody = new THREE.Mesh(crateGeo, this.iceBlockMat);
      fBody.position.y = 0.66;
      fBody.castShadow = true;
      const fCap = new THREE.Mesh(crateCapGeo, frostSnowCapMat);
      fCap.position.y = 1.32;
      const fIceBand = new THREE.Mesh(crateBandGeo, frostTimberMat);
      fIceBand.position.y = 0.2;
      frostCrate.add(fBody, fCap, fIceBand);

      const infernoCrate = new THREE.Group();
      const iBody = new THREE.Mesh(crateGeo, this.magmaMat);
      iBody.position.y = 0.66;
      iBody.castShadow = true;
      const iCap = new THREE.Mesh(crateCapGeo, forgedIronMat);
      iCap.position.y = 1.32;
      const iVein = new THREE.Mesh(crateBandGeo, emberVeinMat);
      iVein.position.y = 0.68;
      iVein.scale.y = 0.6;
      infernoCrate.add(iBody, iCap, iVein);

      const slimeCrate = new THREE.Group();
      const sDrum = new THREE.Mesh(drumGeo, sewerMetalMat);
      sDrum.position.y = 0.66;
      sDrum.castShadow = true;
      const sGlow = new THREE.Mesh(drumRingGeo, slimeGlowMat);
      sGlow.position.y = 0.72;
      const sCap = new THREE.Mesh(drumRingGeo, this.slimeVatMat);
      sCap.position.y = 1.32;
      slimeCrate.add(sDrum, sGlow, sCap);

      const cyberCrate = new THREE.Group();
      const cBody = new THREE.Mesh(crateGeo, this.cyberUnitMat);
      cBody.position.y = 0.66;
      cBody.castShadow = true;
      const cTop = new THREE.Mesh(crateCapGeo, cyberCyanMat);
      cTop.position.y = 1.32;
      cTop.scale.y = 0.7;
      const cMid = new THREE.Mesh(crateBandGeo, cyberMagentaMat);
      cMid.position.y = 0.64;
      cMid.scale.y = 0.55;
      cyberCrate.add(cBody, cTop, cMid);

      const voidCrate = new THREE.Group();
      const vBody = new THREE.Mesh(crateGeo, this.galleryPedestalMat);
      vBody.position.y = 0.66;
      vBody.castShadow = true;
      const vCap = new THREE.Mesh(crateCapGeo, galleryGoldMat);
      vCap.position.y = 1.32;
      const vBand = new THREE.Mesh(crateBandGeo, voidVioletMat);
      vBand.position.y = 0.66;
      vBand.scale.y = 0.45;
      voidCrate.add(vBody, vCap, vBand);

      const crateViews: Record<SceneId, THREE.Group> = {
        frost_sanctuary: frostCrate,
        inferno_caldera: infernoCrate,
        slime_catacombs: slimeCrate,
        cyber_foundry: cyberCrate,
        void_gallery: voidCrate,
      };

      // ===== 2. SLIDE-UNDER OVERHEAD GATES ('overhead') — bespoke per world =====
      const frostOverhead = new THREE.Group();
      const foL = new THREE.Mesh(postGeo, frostTimberMat);
      foL.position.set(-1.08, 1.38, 0);
      const foR = new THREE.Mesh(postGeo, frostTimberMat);
      foR.position.set(1.08, 1.38, 0);
      const foBeam = new THREE.Mesh(beamGeo, this.iceBlockMat);
      foBeam.position.set(0, 2.02, 0);
      foBeam.castShadow = true;
      const foSnow = new THREE.Mesh(new THREE.BoxGeometry(2.44, 0.16, 0.62), frostSnowCapMat);
      foSnow.position.set(0, 2.42, 0);
      frostOverhead.add(foL, foR, foBeam, foSnow);
      for (const ix of [-0.72, -0.24, 0.24, 0.72]) {
        const icicle = new THREE.Mesh(icicleGeo, this.iceBlockMat);
        icicle.position.set(ix, 1.48, 0);
        frostOverhead.add(icicle);
      }

      const infernoOverhead = new THREE.Group();
      const ioL = new THREE.Mesh(stonePostGeo, this.magmaMat);
      ioL.position.set(-1.08, 1.38, 0);
      const ioR = new THREE.Mesh(stonePostGeo, this.magmaMat);
      ioR.position.set(1.08, 1.38, 0);
      const ioBeam = new THREE.Mesh(beamGeo, forgedIronMat);
      ioBeam.position.set(0, 2.02, 0);
      ioBeam.castShadow = true;
      const ioRune = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.14, 0.62), emberVeinMat);
      ioRune.position.set(0, 1.62, 0);
      infernoOverhead.add(ioL, ioR, ioBeam, ioRune);

      const slimeOverhead = new THREE.Group();
      const soL = new THREE.Mesh(postGeo, sewerMetalMat);
      soL.position.set(-1.08, 1.38, 0);
      const soR = new THREE.Mesh(postGeo, sewerMetalMat);
      soR.position.set(1.08, 1.38, 0);
      const soPipe = new THREE.Mesh(pipeBeamGeo, this.slimeVatMat);
      soPipe.position.set(0, 1.98, 0);
      soPipe.castShadow = true;
      const soStripe = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.74), slimeGlowMat);
      soStripe.position.set(0, 1.62, 0);
      slimeOverhead.add(soL, soR, soPipe, soStripe);

      const cyberOverhead = new THREE.Group();
      const coL = new THREE.Mesh(postGeo, this.steelMat);
      coL.position.set(-1.08, 1.38, 0);
      const coR = new THREE.Mesh(postGeo, this.steelMat);
      coR.position.set(1.08, 1.38, 0);
      const coBeam = new THREE.Mesh(beamGeo, this.cyberUnitMat);
      coBeam.position.set(0, 2.04, 0);
      coBeam.castShadow = true;
      const coLaser = new THREE.Mesh(new THREE.BoxGeometry(2.14, 0.14, 0.62), cyberCyanMat);
      coLaser.position.set(0, 1.6, 0);
      const coTop = new THREE.Mesh(new THREE.BoxGeometry(2.38, 0.12, 0.6), cyberMagentaMat);
      coTop.position.set(0, 2.44, 0);
      cyberOverhead.add(coL, coR, coBeam, coLaser, coTop);

      const voidOverhead = new THREE.Group();
      const voL = new THREE.Mesh(stonePostGeo, this.galleryPedestalMat);
      voL.position.set(-1.08, 1.38, 0);
      const voR = new THREE.Mesh(stonePostGeo, this.galleryPedestalMat);
      voR.position.set(1.08, 1.38, 0);
      const voBeam = new THREE.Mesh(beamGeo, this.galleryPedestalMat);
      voBeam.position.set(0, 2.02, 0);
      voBeam.castShadow = true;
      const voGold = new THREE.Mesh(new THREE.BoxGeometry(2.44, 0.14, 0.62), galleryGoldMat);
      voGold.position.set(0, 2.42, 0);
      const voBar = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.12, 0.62), voidVioletMat);
      voBar.position.set(0, 1.6, 0);
      voidOverhead.add(voL, voR, voBeam, voGold, voBar);

      const overheadViews: Record<SceneId, THREE.Group> = {
        frost_sanctuary: frostOverhead,
        inferno_caldera: infernoOverhead,
        slime_catacombs: slimeOverhead,
        cyber_foundry: cyberOverhead,
        void_gallery: voidOverhead,
      };

      // ===== 3. TALL UNJUMPABLE FULL-HEIGHT WORLD MONOLITHS ('special', ~4.85m tall) =====
      // World 1 (OG Lofi): Towering Glacier Ice Cliff Spire
      const frostSpecial = new THREE.Group();
      const iceMain = new THREE.Mesh(frostTowerGeo, this.iceBlockMat);
      iceMain.position.y = 1.9;
      iceMain.castShadow = true;
      const iceCap = new THREE.Mesh(crateCapGeo, frostSnowCapMat);
      iceCap.position.y = 3.82;
      const iceSpike1 = new THREE.Mesh(frostPeakBigGeo, this.iceBlockMat);
      iceSpike1.position.set(-0.34, 4.55, 0.08);
      const iceSpike2 = new THREE.Mesh(frostPeakSmGeo, frostSnowCapMat);
      iceSpike2.position.set(0.42, 4.35, -0.18);
      frostSpecial.add(iceMain, iceCap, iceSpike1, iceSpike2);

      // World 2 (Inferno Blaze): Towering Volcanic Dark-Brown Basalt Obelisk
      const infernoSpecial = new THREE.Group();
      const basaltCore = new THREE.Mesh(infernoTowerGeo, this.magmaMat);
      basaltCore.position.y = 2.05;
      basaltCore.castShadow = true;
      const ironBand1 = new THREE.Mesh(infernoBandGeo, forgedIronMat);
      ironBand1.position.y = 1.4;
      const ironBand2 = new THREE.Mesh(infernoBandGeo, forgedIronMat);
      ironBand2.position.y = 3.0;
      const magmaVein = new THREE.Mesh(infernoBandGeo, emberVeinMat);
      magmaVein.position.y = 2.2;
      magmaVein.scale.y = 0.72;
      const magmaCrown = new THREE.Mesh(infernoCapGeo, forgedIronMat);
      magmaCrown.position.y = 4.65;
      magmaCrown.rotation.y = Math.PI / 4;
      infernoSpecial.add(basaltCore, ironBand1, ironBand2, magmaVein, magmaCrown);

      // World 3 (Neon Slime): Towering Industrial Bio-Slime Containment Silo
      const slimeSpecial = new THREE.Group();
      const vatBase = new THREE.Mesh(slimeTankBaseGeo, sewerMetalMat);
      vatBase.position.y = 0.19;
      const vatTube = new THREE.Mesh(slimeTankGlassGeo, this.slimeVatMat);
      vatTube.position.y = 2.4;
      vatTube.castShadow = true;
      const vatMidRing = new THREE.Mesh(slimeTankRingGeo, sewerMetalMat);
      vatMidRing.position.y = 2.4;
      const vatGlowRing = new THREE.Mesh(slimeTankRingGeo, slimeGlowMat);
      vatGlowRing.position.y = 3.6;
      vatGlowRing.scale.y = 0.55;
      const vatCap = new THREE.Mesh(slimeTankBaseGeo, sewerMetalMat);
      vatCap.position.y = 4.65;
      slimeSpecial.add(vatBase, vatTube, vatMidRing, vatGlowRing, vatCap);

      // World 4 (Half-Cyborg): Towering Cyberpunk Armored Server / Cargo Monolith
      const cyberSpecial = new THREE.Group();
      const cyberBody = new THREE.Mesh(cyberTowerGeo, this.cyberUnitMat);
      cyberBody.position.y = 2.38;
      cyberBody.castShadow = true;
      const cyberStripe1 = new THREE.Mesh(cyberStripeGeo, cyberCyanMat);
      cyberStripe1.position.y = 1.65;
      const cyberStripe2 = new THREE.Mesh(cyberStripeGeo, cyberMagentaMat);
      cyberStripe2.position.y = 3.25;
      const cyberStripe3 = new THREE.Mesh(cyberStripeGeo, cyberCyanMat);
      cyberStripe3.position.y = 4.55;
      cyberSpecial.add(cyberBody, cyberStripe1, cyberStripe2, cyberStripe3);

      // World 5 (Void Shadow): Towering Obsidian & Gold Astral Gallery Monolith
      const voidSpecial = new THREE.Group();
      const pedBase = new THREE.Mesh(voidPillarGeo, this.galleryPedestalMat);
      pedBase.position.y = 2.02;
      pedBase.castShadow = true;
      const goldTrim1 = new THREE.Mesh(voidTrimGeo, galleryGoldMat);
      goldTrim1.position.y = 1.6;
      const goldTrim2 = new THREE.Mesh(voidTrimGeo, galleryGoldMat);
      goldTrim2.position.y = 4.08;
      const violetLine = new THREE.Mesh(voidTrimGeo, voidVioletMat);
      violetLine.position.y = 2.85;
      violetLine.scale.y = 0.65;
      const sculpture = new THREE.Mesh(voidSpireGeo, galleryGoldMat);
      sculpture.position.y = 4.82;
      voidSpecial.add(pedBase, goldTrim1, goldTrim2, violetLine, sculpture);

      const specialViews: Record<SceneId, THREE.Group> = {
        frost_sanctuary: frostSpecial,
        inferno_caldera: infernoSpecial,
        slime_catacombs: slimeSpecial,
        cyber_foundry: cyberSpecial,
        void_gallery: voidSpecial,
      };

      group.add(
        frostCrate,
        infernoCrate,
        slimeCrate,
        cyberCrate,
        voidCrate,
        frostOverhead,
        infernoOverhead,
        slimeOverhead,
        cyberOverhead,
        voidOverhead,
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
        crateViews,
        overheadViews,
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
      if (obs.active) {
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

  public setSlideMode(active: boolean): void {
    this.slideMode = active;
  }

  public setDifficulty(difficulty: DifficultyId): void {
    this.difficulty = difficulty;
  }

  public reset(): void {
    this.lastOpenLane = 1;
    this.nextRowDistance = this.difficulty === 'hard' ? 4 : this.difficulty === 'normal' ? 16 : 26;
    this.rowsSincePowerup = 0;
    this.lastRowHadSpecial = false;
    this.lastActionGateRow = false;
    this.slideMode = false;

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
    void kind;
    if (this.currentScene === 'frost_sanctuary') return this.iceBlockMat;
    if (this.currentScene === 'inferno_caldera') return this.magmaMat;
    if (this.currentScene === 'slime_catacombs') return this.slimeVatMat;
    if (this.currentScene === 'cyber_foundry') return this.cyberUnitMat;
    if (this.currentScene === 'void_gallery') return this.galleryPedestalMat;
    return this.crateMat;
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
    const baseY = obs.kind === 'overhead' ? 1.85 : obs.kind === 'special' ? 1.85 : 0.72;
    const scaleY = obs.kind === 'special' ? 2.25 : obs.kind === 'overhead' ? 0.62 : 1.0;
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
      let extraStepSpacing = 0;
      if (!pauseObstacleSpawns) {
        extraStepSpacing = this.spawnReachablePattern(SPAWN_START_Z, starActive, distance, speed);
      }
      // Difficulty-scaled spacing that tightens progressively across long sustained runs
      const progressRamp = THREE.MathUtils.clamp(distance / 4500, 0, 1);
      let baseSpacing: number;
      if (this.difficulty === 'hard') {
        const timeWindow = THREE.MathUtils.lerp(0.55, 0.41, progressRamp);
        baseSpacing = THREE.MathUtils.clamp(speed * timeWindow, 18.5, 34);
      } else if (this.difficulty === 'normal') {
        const timeWindow = THREE.MathUtils.lerp(0.84, 0.66, progressRamp);
        baseSpacing = THREE.MathUtils.clamp(speed * timeWindow, 25, 45);
      } else {
        const timeWindow = THREE.MathUtils.lerp(1.02, 0.86, progressRamp);
        baseSpacing = THREE.MathUtils.clamp(speed * timeWindow, 30, 54);
      }
      const slideMult =
        this.difficulty === 'hard' ? 1.02 : this.difficulty === 'normal' ? 1.12 : 1.22;
      const spacing = (this.slideMode ? baseSpacing * slideMult : baseSpacing) + extraStepSpacing;
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

  private spawnReachablePattern(
    zPos: number,
    starActive: boolean,
    distance: number,
    speed: number,
  ): number {
    const isHard = this.difficulty === 'hard';
    const isNormal = this.difficulty === 'normal';
    const prevOpenLane = this.lastOpenLane;

    // Difficulty-scaled lane-switch pressure so Hard constantly demands crisp lateral weaves
    let openLane = prevOpenLane;
    if (isHard) {
      const candidates = [0, 1, 2].filter((l) => l !== prevOpenLane);
      // 84% chance to force a lane change on Hard (including cross-lane swaps when on an outer lane)
      if (Math.random() < 0.84) {
        const adjacent = candidates.filter((l) => Math.abs(l - prevOpenLane) === 1);
        const canCross = candidates.length > adjacent.length && !this.lastActionGateRow;
        if (canCross && Math.random() < 0.34) {
          openLane = candidates.find((l) => Math.abs(l - prevOpenLane) === 2) ?? adjacent[0];
        } else {
          openLane = adjacent[Math.floor(Math.random() * adjacent.length)];
        }
      }
    } else if (isNormal) {
      if (Math.random() < 0.7) {
        const adjacent = [prevOpenLane - 1, prevOpenLane + 1].filter((l) => l >= 0 && l <= 2);
        openLane = adjacent[Math.floor(Math.random() * adjacent.length)];
      }
    } else {
      const delta = Math.floor(Math.random() * 3) - 1;
      openLane = THREE.MathUtils.clamp(prevOpenLane + delta, 0, 2);
    }
    this.lastOpenLane = openLane;

    const otherLanes = [0, 1, 2].filter((l) => l !== openLane);
    // Shuffle otherLanes so single-lane blocks don't always bias toward lane 0
    if (Math.random() < 0.5) {
      otherLanes.reverse();
    }

    const isSpaceFloat = this.slideMode && this.currentScene === 'cyber_foundry';
    const ramp = THREE.MathUtils.clamp(distance / 1800, 0, 1);

    // Determine how many lanes are blocked & whether this row is a 3-Lane Action Gate
    // (2 lanes blocked + reachable lane requires a Jump over a crate or Slide under an overhead!)
    let blockCount: number;
    let actionGateKind: 'crate' | 'overhead' | null = null;
    let extraSpacing = 0;

    if (this.slideMode) {
      // On Hard slide/space chutes, block 2 lanes frequently so slides stay intense!
      blockCount = isHard ? (Math.random() < 0.62 ? 2 : 1) : isNormal ? (Math.random() < 0.25 ? 2 : 1) : 1;
    } else if (isHard) {
      const roll = Math.random();
      const gateChance = THREE.MathUtils.lerp(0.36, 0.48, ramp);
      if (!this.lastActionGateRow && roll < gateChance) {
        blockCount = 2;
        actionGateKind = Math.random() < 0.52 ? 'overhead' : 'crate';
      } else if (roll < 0.9) {
        blockCount = 2;
      } else {
        blockCount = 1;
      }
    } else if (isNormal) {
      const roll = Math.random();
      if (!this.lastActionGateRow && roll < 0.14) {
        blockCount = 2;
        actionGateKind = Math.random() < 0.5 ? 'crate' : 'overhead';
      } else {
        blockCount = Math.random() < 0.65 ? 2 : 1;
      }
    } else {
      blockCount = Math.random() < 0.44 ? 2 : 1;
    }

    this.lastActionGateRow = actionGateKind !== null;

    let spawnedSpecialThisRow = false;
    for (let i = 0; i < blockCount; i++) {
      const lane = otherLanes[i];
      let kind: ObstacleKind = 'crate';
      if (isSpaceFloat) {
        kind = 'special';
      } else if (this.slideMode) {
        kind = Math.random() < (isHard ? 0.42 : 0.55) ? 'crate' : 'special';
      } else if (isHard) {
        // Hard allows double tall unjumpable monolith walls (forcing clean weaves or Jump/Slide gates!)
        const roll = Math.random();
        if (actionGateKind !== null) {
          // Flanking walls around an Action Gate are mostly tall monoliths so you MUST jump/slide the gate
          kind = roll < 0.72 ? 'special' : roll < 0.88 ? 'overhead' : 'crate';
        } else if (roll < 0.46) {
          kind = 'special';
        } else if (roll < 0.78) {
          kind = 'overhead';
        } else {
          kind = 'crate';
        }
      } else {
        const allowSpecial = !this.lastRowHadSpecial && !spawnedSpecialThisRow;
        const roll = Math.random();
        if (roll < 0.42) kind = 'crate';
        else if (roll < 0.74 || !allowSpecial) kind = 'overhead';
        else kind = 'special';
      }
      if (kind === 'special') spawnedSpecialThisRow = true;
      this.acquireObstacle(lane, kind, zPos);
    }

    // Place the Jump/Slide Action Gate obstacle inside the reachable lane (100% fair, high-skill)
    if (actionGateKind) {
      this.acquireObstacle(openLane, actionGateKind, zPos);
      extraSpacing += isHard ? 2.5 : 4.0;
    }

    // On Hard (normal road, non-action-gate rows), weave in staggered rhythmic slalom follow-ups!
    // Spawns an offset obstacle behind this row in an adjacent lane for rapid zig-zag flow.
    if (isHard && !this.slideMode && !actionGateKind && Math.random() < 0.36) {
      const staggerOffset = THREE.MathUtils.clamp(speed * 0.28, 12, 17.5);
      const staggerZ = zPos - staggerOffset;
      const nextSafeChoices = [0, 1, 2].filter((l) => l !== openLane && Math.abs(l - openLane) === 1);
      const staggerOpen =
        nextSafeChoices[Math.floor(Math.random() * nextSafeChoices.length)] ?? (openLane === 1 ? 0 : 1);
      this.lastOpenLane = staggerOpen;

      const staggerBlocked = [0, 1, 2].filter((l) => l !== staggerOpen);
      // Block the player's just-used lane (and 55% of the time the 3rd lane too) for an authentic slalom!
      const staggerCount = Math.random() < 0.55 ? 2 : 1;
      // Ensure openLane is first in staggerBlocked so the player MUST weave out of it
      staggerBlocked.sort((a, b) => (a === openLane ? -1 : b === openLane ? 1 : 0));
      for (let j = 0; j < staggerCount; j++) {
        const sLane = staggerBlocked[j];
        const sKind: ObstacleKind =
          Math.random() < 0.48 ? 'special' : Math.random() < 0.55 ? 'overhead' : 'crate';
        this.acquireObstacle(sLane, sKind, staggerZ);
      }
      extraSpacing += staggerOffset;
    }

    this.lastRowHadSpecial = spawnedSpecialThisRow;

    // Coin lines telegraph the exact fair path (high arc over jump gate, low line under overhead gate!)
    const coinLane = openLane;
    if (starActive) {
      const isSwoopRow = Math.random() < 0.32;
      const baseH = isSwoopRow ? STAR_FLY_HEIGHT - 1.9 : STAR_FLY_HEIGHT + 0.5;
      for (let i = 0; i < 6; i++) {
        const arc = Math.sin((i / 5) * Math.PI) * 0.7;
        this.acquireCoin(coinLane, baseH + arc, zPos - 7 + i * 2.7);
      }
    } else if (isSpaceFloat) {
      for (let i = 0; i < 6; i++) {
        const wave = Math.sin((i / 5) * Math.PI) * 0.45;
        this.acquireCoin(coinLane, 2.55 + wave, zPos - 7 + i * 2.8);
      }
    } else if (actionGateKind === 'crate') {
      // High coin arc clearly signaling JUMP over the gate!
      const arcHeights = [1.35, 2.55, 2.95, 2.55, 1.35];
      for (let i = 0; i < 5; i++) {
        this.acquireCoin(coinLane, arcHeights[i], zPos - 4.4 + i * 2.2);
      }
    } else if (actionGateKind === 'overhead') {
      // Low ground coin trail clearly signaling SLIDE under the overhead beam!
      for (let i = 0; i < 5; i++) {
        this.acquireCoin(coinLane, 0.58, zPos - 5.2 + i * 2.6);
      }
    } else {
      for (let i = 0; i < 5; i++) {
        this.acquireCoin(coinLane, this.slideMode ? 0.95 : 1.05, zPos - 6 + i * 2.7);
      }

      const crateLane = otherLanes[0];
      if (!this.slideMode && Math.random() < 0.4) {
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
    const powerupThreshold = isHard ? 9 : 7;
    if (this.rowsSincePowerup >= powerupThreshold && Math.random() < 0.46) {
      this.rowsSincePowerup = 0;
      const puKind: PowerupKind = Math.random() < 0.54 ? 'sword' : 'star';
      this.acquirePowerup(this.lastOpenLane, puKind, zPos - (extraSpacing > 8 ? 17.5 : 11.5));
    }

    return extraSpacing;
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
    (Object.keys(obs.crateViews) as SceneId[]).forEach((sid) => {
      const match = sid === this.currentScene;
      obs.crateViews[sid].visible = obs.kind === 'crate' && match;
      obs.overheadViews[sid].visible = obs.kind === 'overhead' && match;
      obs.specialViews[sid].visible = obs.kind === 'special' && match;
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

  public captureReplayEntities(): PoolReplayEntities {
    const obstacles: PoolReplayEntities['obstacles'] = [];
    for (let i = 0; i < this.obstacles.length; i++) {
      const obs = this.obstacles[i];
      if (!obs.active) continue;
      obstacles.push({
        poolIndex: i,
        kind: obs.kind,
        lane: obs.lane,
        z: obs.z,
        sliced: obs.sliced,
      });
    }

    const coins: PoolReplayEntities['coins'] = [];
    for (let i = 0; i < this.coins.length; i++) {
      const coin = this.coins[i];
      if (!coin.active) continue;
      coins.push({
        poolIndex: i,
        lane: coin.lane,
        x: coin.x,
        y: coin.y,
        z: coin.z,
        phase: coin.phase,
      });
    }

    const powerups: PoolReplayEntities['powerups'] = [];
    for (let i = 0; i < this.powerups.length; i++) {
      const pu = this.powerups[i];
      if (!pu.active) continue;
      powerups.push({
        poolIndex: i,
        kind: pu.kind,
        lane: pu.lane,
        z: pu.z,
      });
    }

    return { obstacles, coins, powerups };
  }

  public applyReplayEntities(
    snap: PoolReplayEntities,
    nextSnap: PoolReplayEntities | null,
    alpha: number,
    elapsed: number,
  ): void {
    // Hide all slots first, then position only the entities present in this replayed frame
    for (const obs of this.obstacles) {
      obs.group.visible = false;
    }
    for (const coin of this.coins) {
      coin.mesh.visible = false;
    }
    for (const pu of this.powerups) {
      pu.group.visible = false;
    }

    const isSpaceFloat = this.slideMode && this.currentScene === 'cyber_foundry';
    const nextObsMap = nextSnap
      ? new Map(nextSnap.obstacles.map((o) => [o.poolIndex, o]))
      : null;
    for (const item of snap.obstacles) {
      const slot = this.obstacles[item.poolIndex];
      if (!slot || item.sliced) continue;
      const next = nextObsMap?.get(item.poolIndex);
      const z =
        next && next.kind === item.kind && next.lane === item.lane && Math.abs(next.z - item.z) < 25
          ? THREE.MathUtils.lerp(item.z, next.z, alpha)
          : item.z;
      slot.kind = item.kind;
      slot.lane = item.lane;
      slot.z = z;
      slot.sliced = item.sliced;
      const ox = LANE_X[item.lane];
      const oy =
        this.slideMode && !isSpaceFloat
          ? Math.max(0, 5.56 - Math.sqrt(Math.max(1, 5.6 * 5.6 - ox * ox)))
          : isSpaceFloat
            ? 1.5 + Math.sin(elapsed * 2.2 + item.lane) * 0.25
            : 0;
      slot.group.position.set(ox, oy, z);
      slot.group.rotation.set(0, 0, 0);
      slot.group.scale.set(1, 1, 1);
      slot.group.visible = true;
      this.syncObstacleVisual(slot);
    }

    const nextCoinMap = nextSnap
      ? new Map(nextSnap.coins.map((c) => [c.poolIndex, c]))
      : null;
    for (const item of snap.coins) {
      const slot = this.coins[item.poolIndex];
      if (!slot) continue;
      const next = nextCoinMap?.get(item.poolIndex);
      const canLerp = next && Math.abs(next.z - item.z) < 25;
      const x = canLerp ? THREE.MathUtils.lerp(item.x, next.x, alpha) : item.x;
      const y = canLerp ? THREE.MathUtils.lerp(item.y, next.y, alpha) : item.y;
      const z = canLerp ? THREE.MathUtils.lerp(item.z, next.z, alpha) : item.z;
      slot.mesh.position.set(x, y + Math.sin(elapsed * 4.2 + item.phase) * 0.14, z);
      slot.mesh.rotation.y = elapsed * 3.4 + item.phase;
      slot.mesh.visible = true;
    }

    const nextPuMap = nextSnap
      ? new Map(nextSnap.powerups.map((p) => [p.poolIndex, p]))
      : null;
    for (const item of snap.powerups) {
      const slot = this.powerups[item.poolIndex];
      if (!slot) continue;
      const next = nextPuMap?.get(item.poolIndex);
      const z =
        next && next.kind === item.kind && next.lane === item.lane && Math.abs(next.z - item.z) < 25
          ? THREE.MathUtils.lerp(item.z, next.z, alpha)
          : item.z;
      slot.group.position.set(LANE_X[item.lane], 1.55 + Math.sin(elapsed * 4.5) * 0.24, z);
      slot.group.rotation.y = elapsed * 2.8;
      slot.swordView.visible = item.kind === 'sword';
      slot.starView.visible = item.kind === 'star';
      slot.group.visible = true;
    }
  }

  public restoreLiveEntities(snap: PoolReplayEntities): void {
    for (const obs of this.obstacles) {
      obs.active = false;
      obs.sliced = false;
      obs.sliceTimer = 0;
      obs.group.visible = false;
    }
    for (const coin of this.coins) {
      coin.active = false;
      coin.mesh.visible = false;
    }
    for (const pu of this.powerups) {
      pu.active = false;
      pu.group.visible = false;
    }

    const isSpaceFloat = this.slideMode && this.currentScene === 'cyber_foundry';
    for (const item of snap.obstacles) {
      const slot = this.obstacles[item.poolIndex];
      if (!slot) continue;
      slot.active = true;
      slot.kind = item.kind;
      slot.lane = item.lane;
      slot.z = item.z;
      slot.sliced = item.sliced;
      slot.sliceTimer = 0;
      const ox = LANE_X[item.lane];
      const oy =
        this.slideMode && !isSpaceFloat
          ? Math.max(0, 5.56 - Math.sqrt(Math.max(1, 5.6 * 5.6 - ox * ox)))
          : isSpaceFloat
            ? 1.5
            : 0;
      slot.group.position.set(ox, oy, item.z);
      slot.group.rotation.set(0, 0, 0);
      slot.group.scale.set(1, 1, 1);
      slot.group.visible = !item.sliced;
      this.syncObstacleVisual(slot);
    }

    for (const item of snap.coins) {
      const slot = this.coins[item.poolIndex];
      if (!slot) continue;
      slot.active = true;
      slot.lane = item.lane;
      slot.x = item.x;
      slot.y = item.y;
      slot.z = item.z;
      slot.phase = item.phase;
      slot.mesh.position.set(item.x, item.y, item.z);
      slot.mesh.visible = true;
    }

    for (const item of snap.powerups) {
      const slot = this.powerups[item.poolIndex];
      if (!slot) continue;
      slot.active = true;
      slot.kind = item.kind;
      slot.lane = item.lane;
      slot.z = item.z;
      slot.group.position.set(LANE_X[item.lane], 1.5, item.z);
      slot.swordView.visible = item.kind === 'sword';
      slot.starView.visible = item.kind === 'star';
      slot.group.visible = true;
    }
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
