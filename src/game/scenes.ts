import * as THREE from 'three';
import { ART_URLS, SCENE_NAMES, SEGMENT_COUNT, SEGMENT_LENGTH } from './config';
import {
  createFlowingSlimeTexture,
  createParallaxHorizonTexture,
  createRoadTexture,
  createSkyGradientTexture,
  loadArtTextures,
} from './textures';
import type { SceneId } from './types';
import {
  createFlankingTranceTitans,
  createWorldTitan,
  type FlankingTitansHandle,
  type WorldTitanHandle,
} from './worldTitans';

const TOTAL_LENGTH = SEGMENT_LENGTH * SEGMENT_COUNT; // 210 units
const WRAP_FRONT_Z = 28; // Recycle once behind camera

export interface SceneThemeSpec {
  id: SceneId;
  name: string;
  fogColor: number;
  fogNear: number;
  fogFar: number;
  skyTop: string;
  skyMid: string;
  skyBottom: string;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  keyColor: number;
  keyIntensity: number;
  rimColor: number;
  rimIntensity: number;
  roadRoughness: number;
  roadMetalness: number;
}

export const SCENE_SPECS: Record<SceneId, SceneThemeSpec> = {
  frost_sanctuary: {
    id: 'frost_sanctuary',
    name: SCENE_NAMES.frost_sanctuary,
    fogColor: 0xa6d8fa,
    fogNear: 108,
    fogFar: 290,
    skyTop: '#1d4ed8',
    skyMid: '#60a5fa',
    skyBottom: '#e0f2fe',
    hemiSky: 0xe8f6ff,
    hemiGround: 0x93c5fd,
    hemiIntensity: 1.24,
    keyColor: 0xfffbeb,
    keyIntensity: 1.95,
    rimColor: 0x7dd3fc,
    rimIntensity: 1.15,
    roadRoughness: 0.4,
    roadMetalness: 0.08,
  },
  inferno_caldera: {
    id: 'inferno_caldera',
    name: SCENE_NAMES.inferno_caldera,
    fogColor: 0x3b150e,
    fogNear: 102,
    fogFar: 278,
    skyTop: '#1a0605',
    skyMid: '#5c190c',
    skyBottom: '#c2410c',
    hemiSky: 0xfdba74,
    hemiGround: 0x571a09,
    hemiIntensity: 1.18,
    keyColor: 0xfef08a,
    keyIntensity: 1.95,
    rimColor: 0xf97316,
    rimIntensity: 1.45,
    roadRoughness: 0.52,
    roadMetalness: 0.2,
  },
  slime_catacombs: {
    id: 'slime_catacombs',
    name: SCENE_NAMES.slime_catacombs,
    fogColor: 0x0a291c,
    fogNear: 100,
    fogFar: 275,
    skyTop: '#04140e',
    skyMid: '#0b3422',
    skyBottom: '#155436',
    hemiSky: 0x86efac,
    hemiGround: 0x0c3d22,
    hemiIntensity: 1.22,
    keyColor: 0xecfccb,
    keyIntensity: 1.88,
    rimColor: 0x4ade80,
    rimIntensity: 1.45,
    roadRoughness: 0.22,
    roadMetalness: 0.36,
  },
  cyber_foundry: {
    id: 'cyber_foundry',
    name: SCENE_NAMES.cyber_foundry,
    fogColor: 0x0d1430,
    fogNear: 104,
    fogFar: 285,
    skyTop: '#060a1e',
    skyMid: '#121d46',
    skyBottom: '#241e5c',
    hemiSky: 0x7dd3fc,
    hemiGround: 0x4c1d95,
    hemiIntensity: 1.16,
    keyColor: 0xf8fafc,
    keyIntensity: 1.85,
    rimColor: 0xf0abfc,
    rimIntensity: 1.45,
    roadRoughness: 0.16,
    roadMetalness: 0.32,
  },
  void_gallery: {
    id: 'void_gallery',
    name: SCENE_NAMES.void_gallery,
    fogColor: 0x171130,
    fogNear: 102,
    fogFar: 280,
    skyTop: '#09061a',
    skyMid: '#211547',
    skyBottom: '#3c2473',
    hemiSky: 0xddd6fe,
    hemiGround: 0x2e1065,
    hemiIntensity: 1.16,
    keyColor: 0xfef9c3,
    keyIntensity: 1.9,
    rimColor: 0xc4b5fd,
    rimIntensity: 1.4,
    roadRoughness: 0.14,
    roadMetalness: 0.3,
  },
};

interface AmbientParticles {
  points: THREE.Points;
  velocities: Float32Array;
  directionY: number; // -1 falling snow, +1 rising embers/slime bubbles/astral motes
  windShearX: number; // Lateral blizzard wind gust strength
}

interface ParallaxLayer {
  mesh: THREE.Mesh;
  texture: THREE.CanvasTexture;
  driftSpeed: number;
  lateralFactor: number;
}

interface SceneBundle {
  id: SceneId;
  root: THREE.Group;
  skyTexture: THREE.CanvasTexture;
  roadTexture: THREE.CanvasTexture;
  roadMesh: THREE.Mesh;
  instancedProps: THREE.InstancedMesh[];
  scrollingGroups: THREE.Object3D[];
  parallaxLayers: ParallaxLayer[];
  titan: WorldTitanHandle;
  flankingTitans: FlankingTitansHandle;
  liquidFloor?: THREE.Mesh;
  particles?: AmbientParticles;
  updateDynamic?: (elapsed: number, dt: number, speed: number) => void;
}

const _dummy = new THREE.Object3D();
const _color = new THREE.Color();

/**
 * Manages the 5 dedicated 3D Yeti Worlds — one bespoke realm per Lofi Yeti —
 * each featuring recycled world segments, InstancedMesh architecture, ambient particles,
 * and a colossal animated "Big Lofi" Titan towering in meditative trance or monumental motion!
 */
export class WorldManager {
  public readonly worldRoot = new THREE.Group();
  private skyDome: THREE.Mesh;
  private skyMat: THREE.MeshBasicMaterial;
  private bundles = new Map<SceneId, SceneBundle>();
  private artTextures: THREE.Texture[] = [];
  private artMaterials: THREE.MeshStandardMaterial[] = [];
  private currentSceneId: SceneId = 'frost_sanctuary';
  private maxAniso: number;

  private hemiLight: THREE.HemisphereLight;
  private keyLight: THREE.DirectionalLight;
  private rimLight: THREE.DirectionalLight;
  private threeScene: THREE.Scene;

  constructor(
    scene: THREE.Scene,
    hemiLight: THREE.HemisphereLight,
    keyLight: THREE.DirectionalLight,
    rimLight: THREE.DirectionalLight,
    maxAniso: number,
  ) {
    this.threeScene = scene;
    this.hemiLight = hemiLight;
    this.keyLight = keyLight;
    this.rimLight = rimLight;
    this.maxAniso = maxAniso;

    scene.add(this.worldRoot);

    this.skyMat = new THREE.MeshBasicMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.skyDome = new THREE.Mesh(new THREE.SphereGeometry(245, 20, 14), this.skyMat);
    scene.add(this.skyDome);

    // Load configurable ART_URLS with instant procedural fallbacks
    this.artTextures = loadArtTextures(ART_URLS, maxAniso, (idx, tex) => {
      const mat = this.artMaterials[idx];
      if (mat) {
        mat.map = tex;
        mat.needsUpdate = true;
      }
    });

    this.artMaterials = this.artTextures.map(
      (tex) =>
        new THREE.MeshStandardMaterial({
          map: tex,
          roughness: 0.35,
          metalness: 0.05,
          emissive: 0xffffff,
          emissiveMap: tex,
          emissiveIntensity: 0.25,
        }),
    );

    // Pre-build all 5 Yeti Worlds once so transitions have zero allocation stutter
    this.bundles.set('frost_sanctuary', this.buildFrostSanctuary());
    this.bundles.set('inferno_caldera', this.buildInfernoCaldera());
    this.bundles.set('slime_catacombs', this.buildSlimeCatacombs());
    this.bundles.set('cyber_foundry', this.buildCyberFoundry());
    this.bundles.set('void_gallery', this.buildVoidGallery());

    this.bundles.forEach((b) => {
      b.root.visible = false;
      this.worldRoot.add(b.root);
    });

    this.activateScene('frost_sanctuary');
  }

  public getCurrentSceneId(): SceneId {
    return this.currentSceneId;
  }

  public activateScene(sceneId: SceneId): void {
    this.currentSceneId = sceneId;
    const spec = SCENE_SPECS[sceneId];

    this.bundles.forEach((b, id) => {
      b.root.visible = id === sceneId;
    });

    const activeBundle = this.bundles.get(sceneId)!;
    this.skyMat.map = activeBundle.skyTexture;
    this.skyMat.needsUpdate = true;

    this.threeScene.background = new THREE.Color(spec.fogColor);
    this.threeScene.fog = new THREE.Fog(spec.fogColor, spec.fogNear, spec.fogFar);

    this.hemiLight.color.setHex(spec.hemiSky);
    this.hemiLight.groundColor.setHex(spec.hemiGround);
    this.hemiLight.intensity = spec.hemiIntensity;

    this.keyLight.color.setHex(spec.keyColor);
    this.keyLight.intensity = spec.keyIntensity;

    this.rimLight.color.setHex(spec.rimColor);
    this.rimLight.intensity = spec.rimIntensity;
  }

  public update(dt: number, speed: number, elapsed: number, playerX = 0): void {
    const bundle = this.bundles.get(this.currentSceneId);
    if (!bundle) return;

    const dz = speed * dt;

    // Scroll road texture smoothly
    bundle.roadTexture.offset.y += dz / (TOTAL_LENGTH / 4);

    // Animate the 3 side-by-side Horizon Big Lofi Titans + Flanking Trance Colossi along both sides!
    bundle.titan.update(elapsed, dt);
    bundle.flankingTitans.update(elapsed, dt, dz);

    // Multi-depth parallax horizon backdrops ("Lofi in motion" atmospheric depth)
    for (const layer of bundle.parallaxLayers) {
      layer.texture.offset.x = (layer.texture.offset.x + layer.driftSpeed * dt) % 1;
      layer.mesh.position.x = -playerX * layer.lateralFactor;
    }

    // Per-world active instanced animations (frost clouds, lava geysers, slime bubbles, drones, shards)
    bundle.updateDynamic?.(elapsed, dt, speed);

    // Recycle InstancedMesh props in-place (zero GC)
    for (const im of bundle.instancedProps) {
      const arr = im.instanceMatrix.array as Float32Array;
      const count = im.count;
      for (let i = 0; i < count; i++) {
        const zIdx = i * 16 + 14;
        let z = arr[zIdx] + dz;
        if (z > WRAP_FRONT_Z) {
          z -= TOTAL_LENGTH;
        }
        arr[zIdx] = z;
      }
      im.instanceMatrix.needsUpdate = true;
    }

    // Recycle grouped art/billboard segments
    for (const grp of bundle.scrollingGroups) {
      grp.position.z += dz;
      if (grp.position.z > WRAP_FRONT_Z) {
        grp.position.z -= TOTAL_LENGTH;
      }
    }

    // Animated magma / slime liquid ocean surface
    if (bundle.liquidFloor) {
      bundle.liquidFloor.position.y = -1.6 + Math.sin(elapsed * 2.1) * 0.14;
    }

    // Update ambient 3D particle systems (blizzard snow gusts, rising embers, slime spores, astral motes)
    if (bundle.particles) {
      const { points, velocities, directionY, windShearX } = bundle.particles;
      const posAttr = points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const pos = posAttr.array as Float32Array;
      const count = posAttr.count;
      const gust = windShearX !== 0 ? windShearX * (0.78 + Math.sin(elapsed * 0.85) * 0.35) : 0;
      for (let i = 0; i < count; i++) {
        const idx = i * 3;
        pos[idx] += (gust + Math.sin(elapsed * 1.6 + i) * 1.45) * dt;
        pos[idx + 1] += directionY * velocities[i] * dt;
        pos[idx + 2] += dz * (windShearX !== 0 ? 0.96 : 0.82);

        if (pos[idx] > 28) pos[idx] -= 56;
        else if (pos[idx] < -28) pos[idx] += 56;

        if (directionY < 0 && pos[idx + 1] < 0) {
          pos[idx + 1] = 24 + Math.random() * 8;
        } else if (directionY > 0 && pos[idx + 1] > 28) {
          pos[idx + 1] = 0.2 + Math.random() * 2;
        }

        if (pos[idx + 2] > 18) {
          pos[idx + 2] -= 130;
          pos[idx] = (Math.random() - 0.5) * 52;
        }
      }
      posAttr.needsUpdate = true;
    }
  }

  private createRoadMesh(sceneId: SceneId): { mesh: THREE.Mesh; texture: THREE.CanvasTexture } {
    const spec = SCENE_SPECS[sceneId];
    const roadTex = createRoadTexture(sceneId, this.maxAniso);
    roadTex.repeat.set(1, 24);
    const roadGeo = new THREE.PlaneGeometry(9.6, TOTAL_LENGTH);
    const roadMat = new THREE.MeshStandardMaterial({
      map: roadTex,
      roughness: spec.roadRoughness,
      metalness: spec.roadMetalness,
    });
    const mesh = new THREE.Mesh(roadGeo, roadMat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, 0, WRAP_FRONT_Z - TOTAL_LENGTH / 2);
    mesh.receiveShadow = true;
    return { mesh, texture: roadTex };
  }

  private createParallaxBackdrops(
    sceneId: SceneId,
    farDrift: number,
    midDrift: number,
    midOpacity = 0.86,
  ): ParallaxLayer[] {
    // Curved far skyline/mountain backdrop & closer drifting cloud/mist ribbon (open cylinder arcs)
    const farTex = createParallaxHorizonTexture(sceneId, 'far', this.maxAniso);
    const farMat = new THREE.MeshBasicMaterial({
      map: farTex,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      fog: false,
      opacity: 0.94,
    });
    const farMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(176, 176, 62, 36, 1, true, Math.PI * 0.52, Math.PI * 0.96),
      farMat,
    );
    farMesh.position.set(0, 22, -10);

    const midTex = createParallaxHorizonTexture(sceneId, 'mid', this.maxAniso);
    const midMat = new THREE.MeshBasicMaterial({
      map: midTex,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      fog: false,
      opacity: midOpacity,
    });
    const midMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(124, 124, 44, 32, 1, true, Math.PI * 0.56, Math.PI * 0.88),
      midMat,
    );
    midMesh.position.set(0, 26, -8);

    return [
      { mesh: farMesh, texture: farTex, driftSpeed: farDrift, lateralFactor: 0.45 },
      { mesh: midMesh, texture: midTex, driftSpeed: midDrift, lateralFactor: 1.05 },
    ];
  }

  private createAmbientParticles(
    color: number,
    count: number,
    size: number,
    directionY: number,
    speedBase: number,
    windShearX = 0,
  ): AmbientParticles {
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 52;
      positions[i * 3 + 1] = Math.random() * 26;
      positions[i * 3 + 2] = 16 - Math.random() * 130;
      velocities[i] = speedBase + Math.random() * speedBase;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color,
      size,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    return { points, velocities, directionY, windShearX };
  }

  // ---------------------------------------------------------------------------
  // WORLD 1: OG LOFI'S CLASSIC GLACIER SUMMIT (Crisp Alpine Blue Sky + Pines)
  // ---------------------------------------------------------------------------
  private buildFrostSanctuary(): SceneBundle {
    const spec = SCENE_SPECS.frost_sanctuary;
    const root = new THREE.Group();
    const instancedProps: THREE.InstancedMesh[] = [];
    const scrollingGroups: THREE.Object3D[] = [];

    const { mesh: roadMesh, texture: roadTexture } = this.createRoadMesh('frost_sanctuary');
    root.add(roadMesh);

    const snowField = new THREE.Mesh(
      new THREE.PlaneGeometry(300, TOTAL_LENGTH),
      new THREE.MeshStandardMaterial({ color: 0xebf5ff, roughness: 0.85, metalness: 0.03 }),
    );
    snowField.rotation.x = -Math.PI / 2;
    snowField.position.set(0, -0.05, WRAP_FRONT_Z - TOTAL_LENGTH / 2);
    root.add(snowField);

    // Classic dark-green snow-capped evergreen alpine pines
    const treeCount = SEGMENT_COUNT * 10;
    const trunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.28, 0.42, 2.2, 6),
      new THREE.MeshStandardMaterial({ color: 0x5c3a21, roughness: 0.92 }),
      treeCount,
    );
    trunks.frustumCulled = false;
    const foliageLow = new THREE.InstancedMesh(
      new THREE.ConeGeometry(2.25, 4.4, 7),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78 }),
      treeCount,
    );
    foliageLow.frustumCulled = false;
    const foliageTop = new THREE.InstancedMesh(
      new THREE.ConeGeometry(1.7, 3.4, 7),
      new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.58 }),
      treeCount,
    );
    foliageTop.frustumCulled = false;

    // Glacier crags & glowing ice crystal spires flanking the alpine pass
    const ridgeCount = SEGMENT_COUNT * 4;
    const ridges = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(7.2, 0),
      new THREE.MeshStandardMaterial({ color: 0xdbeafe, roughness: 0.62, metalness: 0.08 }),
      ridgeCount,
    );
    ridges.frustumCulled = false;

    const spires = new THREE.InstancedMesh(
      new THREE.OctahedronGeometry(1.25, 0),
      new THREE.MeshStandardMaterial({
        color: 0x7dd3fc,
        emissive: 0x0ea5e9,
        emissiveIntensity: 0.35,
        roughness: 0.16,
        metalness: 0.25,
      }),
      ridgeCount,
    );
    spires.frustumCulled = false;

    const pineShades = [0x14532d, 0x166534, 0x0f5132, 0x1e4d38];
    let tIdx = 0;
    let rIdx = 0;

    for (let seg = 0; seg < SEGMENT_COUNT; seg++) {
      const segZ = WRAP_FRONT_Z - seg * SEGMENT_LENGTH - SEGMENT_LENGTH * 0.5;
      for (const side of [-1, 1]) {
        for (let k = 0; k < 5; k++) {
          const z = segZ - 12 + k * 6;
          const x = side * (9.8 + (k % 3) * 3.9 + ((seg + k) % 2) * 1.4);
          const sc = 0.85 + ((seg * 3 + k * 5) % 4) * 0.15;

          _dummy.position.set(x, 1.1 * sc, z);
          _dummy.rotation.set(0, k * 0.8, 0);
          _dummy.scale.setScalar(sc);
          _dummy.updateMatrix();
          trunks.setMatrixAt(tIdx, _dummy.matrix);

          _dummy.position.set(x, 3.35 * sc, z);
          _dummy.updateMatrix();
          foliageLow.setMatrixAt(tIdx, _dummy.matrix);
          foliageLow.setColorAt(tIdx, _color.setHex(pineShades[(tIdx + seg) % pineShades.length]));

          _dummy.position.set(x, 5.45 * sc, z);
          _dummy.updateMatrix();
          foliageTop.setMatrixAt(tIdx, _dummy.matrix);
          tIdx++;
        }

        for (let k = 0; k < 2; k++) {
          const z = segZ + (k === 0 ? -8 : 8);
          // Push outer glacier ridges behind the Flanking Glacier Trance Colossi (x = ±25.5)
          _dummy.position.set(side * 37, 5.6 + (k % 2) * 4.2, z);
          _dummy.rotation.set(0.2, seg + k, 0.1);
          _dummy.scale.set(1.45, 2.0 + ((seg + k) % 3) * 0.35, 1.5);
          _dummy.updateMatrix();
          ridges.setMatrixAt(rIdx, _dummy.matrix);

          _dummy.position.set(side * 6.5, 1.25, z + 2);
          _dummy.rotation.set(0.15, k, side * 0.18);
          _dummy.scale.set(0.75, 1.75, 0.75);
          _dummy.updateMatrix();
          spires.setMatrixAt(rIdx, _dummy.matrix);
          rIdx++;
        }
      }
    }

    [trunks, foliageLow, foliageTop, ridges, spires].forEach((im) => {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      root.add(im);
      instancedProps.push(im);
    });

    // High-altitude sunlit alpine clouds drifting peacefully across the crisp blue sky
    const cloudCount = 16;
    const cloudMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    });
    const alpineClouds = new THREE.InstancedMesh(new THREE.SphereGeometry(4.4, 8, 6), cloudMat, cloudCount);
    alpineClouds.frustumCulled = false;
    const cloudData = new Float32Array(cloudCount * 5);
    for (let i = 0; i < cloudCount; i++) {
      cloudData[i * 5] = (Math.random() - 0.5) * 96;
      cloudData[i * 5 + 1] = 16 + Math.random() * 18;
      cloudData[i * 5 + 2] = -24 - Math.random() * 120;
      cloudData[i * 5 + 3] = 1.4 + Math.random() * 1.6;
      cloudData[i * 5 + 4] = 2.4 + Math.random() * 3.0;
    }
    root.add(alpineClouds);

    const updateDynamic = (elapsed: number, dt: number) => {
      for (let i = 0; i < cloudCount; i++) {
        const idx = i * 5;
        let x = cloudData[idx] + cloudData[idx + 4] * dt;
        if (x > 58) x = -58;
        cloudData[idx] = x;
        const y = cloudData[idx + 1] + Math.sin(elapsed * 0.65 + i) * 0.55;
        const scX = cloudData[idx + 3];
        _dummy.position.set(x, y, cloudData[idx + 2]);
        _dummy.rotation.set(0, 0, 0);
        _dummy.scale.set(scX * 1.75, scX * 0.38, scX * 0.85);
        _dummy.updateMatrix();
        alpineClouds.setMatrixAt(i, _dummy.matrix);
      }
      alpineClouds.instanceMatrix.needsUpdate = true;
    };

    const parallaxLayers = this.createParallaxBackdrops('frost_sanctuary', 0.005, 0.015, 0.68);
    parallaxLayers.forEach((l) => root.add(l.mesh));

    // Clean gentle alpine snowfall — ONLY OG Lofi's Glacier Summit has falling snow!
    const particles = this.createAmbientParticles(0xffffff, 320, 0.28, -1, 2.4, 0);
    root.add(particles.points);

    const titan = createWorldTitan('frost_sanctuary');
    root.add(titan.group);

    const flankingTitans = createFlankingTranceTitans('frost_sanctuary', TOTAL_LENGTH, WRAP_FRONT_Z);
    root.add(flankingTitans.group);

    return {
      id: 'frost_sanctuary',
      root,
      skyTexture: createSkyGradientTexture(spec.skyTop, spec.skyMid, spec.skyBottom),
      roadTexture,
      roadMesh,
      instancedProps,
      scrollingGroups,
      parallaxLayers,
      titan,
      flankingTitans,
      particles,
      updateDynamic,
    };
  }

  // ---------------------------------------------------------------------------
  // WORLD 2: INFERNO BLAZE'S LAVA TEMPLE RUINS (Sculpted Columns + Swinging Chains)
  // ---------------------------------------------------------------------------
  private buildInfernoCaldera(): SceneBundle {
    const spec = SCENE_SPECS.inferno_caldera;
    const root = new THREE.Group();
    const instancedProps: THREE.InstancedMesh[] = [];
    const scrollingGroups: THREE.Object3D[] = [];

    const { mesh: roadMesh, texture: roadTexture } = this.createRoadMesh('inferno_caldera');
    root.add(roadMesh);

    // Molten magma canyon flowing clearly beneath the elevated temple causeway
    const lavaMat = new THREE.MeshStandardMaterial({
      color: 0xea580c,
      emissive: 0xf97316,
      emissiveIntensity: 1.25,
      roughness: 0.28,
      metalness: 0.12,
    });
    const liquidFloor = new THREE.Mesh(new THREE.PlaneGeometry(280, TOTAL_LENGTH + 40), lavaMat);
    liquidFloor.rotation.x = -Math.PI / 2;
    liquidFloor.position.set(0, -1.7, WRAP_FRONT_Z - TOTAL_LENGTH / 2);
    root.add(liquidFloor);

    // Carved temple bridge stone parapets + glowing ember trim separating track from ruins
    const bridgeWallGeo = new THREE.BoxGeometry(1.5, 2.2, TOTAL_LENGTH);
    const basaltMat = new THREE.MeshStandardMaterial({ color: 0x2b1918, roughness: 0.78, metalness: 0.24 });
    const emberEdgeMat = new THREE.MeshBasicMaterial({ color: 0xfb923c });
    const leftWall = new THREE.Mesh(bridgeWallGeo, basaltMat);
    leftWall.position.set(-5.55, -0.75, WRAP_FRONT_Z - TOTAL_LENGTH / 2);
    const rightWall = new THREE.Mesh(bridgeWallGeo, basaltMat);
    rightWall.position.set(5.55, -0.75, WRAP_FRONT_Z - TOTAL_LENGTH / 2);
    const edgeStripGeo = new THREE.BoxGeometry(0.18, 0.22, TOTAL_LENGTH);
    const leftEdge = new THREE.Mesh(edgeStripGeo, emberEdgeMat);
    leftEdge.position.set(-4.88, 0.28, WRAP_FRONT_Z - TOTAL_LENGTH / 2);
    const rightEdge = new THREE.Mesh(edgeStripGeo, emberEdgeMat);
    rightEdge.position.set(4.88, 0.28, WRAP_FRONT_Z - TOTAL_LENGTH / 2);
    root.add(leftWall, rightWall, leftEdge, rightEdge);

    // Sculpted Fluted Obsidian Temple Columns, Stepped Altar Plinths, Carved Capitals & Broken Lintels
    const colCount = SEGMENT_COUNT * 4;
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, metalness: 0.26 });
    const columns = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.05, 1.48, 13.8, 10), stoneMat, colCount);
    columns.frustumCulled = false;

    const capitals = new THREE.InstancedMesh(new THREE.CylinderGeometry(2.15, 1.25, 1.55, 8), stoneMat, colCount);
    capitals.frustumCulled = false;

    const plinths = new THREE.InstancedMesh(new THREE.BoxGeometry(3.8, 2.6, 3.8), stoneMat, colCount);
    plinths.frustumCulled = false;

    // Broken slanted stone temple architraves & cross-cornices overhanging the magma flanks
    const lintels = new THREE.InstancedMesh(
      new THREE.BoxGeometry(9.2, 1.55, 2.35),
      new THREE.MeshStandardMaterial({ color: 0x341f1b, roughness: 0.76, metalness: 0.2 }),
      SEGMENT_COUNT * 2,
    );
    lintels.frustumCulled = false;

    // Carved bronze fire braziers + roaring temple flames lining the bridge parapet
    const brazierBowls = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(1.18, 0.62, 1.3, 8),
      new THREE.MeshStandardMaterial({ color: 0x261a18, roughness: 0.48, metalness: 0.72 }),
      colCount,
    );
    brazierBowls.frustumCulled = false;

    const flameTops = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.9, 3.1, 7),
      new THREE.MeshBasicMaterial({ color: 0xfde047 }),
      colCount,
    );
    flameTops.frustumCulled = false;

    // Far volcanic spires pushed behind the Flanking Inferno Trance Colossi (x = ±25.5)
    const crags = new THREE.InstancedMesh(
      new THREE.ConeGeometry(10.0, 23, 6),
      new THREE.MeshStandardMaterial({ color: 0x261210, roughness: 0.85 }),
      colCount,
    );
    crags.frustumCulled = false;

    // Heavy forged iron chains: catenary side drapes + dynamically swinging pendulum chains with ember cages!
    const ironChainMat = new THREE.MeshStandardMaterial({
      color: 0x4b4240,
      roughness: 0.36,
      metalness: 0.9,
    });
    const runeGlowMat = new THREE.MeshBasicMaterial({ color: 0xf97316 });
    const emberCoreMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });

    const sideChainCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 11.4, -7.5),
      new THREE.Vector3(0.45, 7.6, 0),
      new THREE.Vector3(0, 11.4, 7.5),
    ]);
    const sideChainGeo = new THREE.TubeGeometry(sideChainCurve, 18, 0.25, 6, false);

    // High overhead temple chain spanning cleanly above the corridor (y = 14.8 -> 12.0 -> 14.8)
    const spanChainCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-9.6, 14.6, 0),
      new THREE.Vector3(-4.8, 12.6, 0),
      new THREE.Vector3(0, 12.0, 0),
      new THREE.Vector3(4.8, 12.6, 0),
      new THREE.Vector3(9.6, 14.6, 0),
    ]);
    const spanChainGeo = new THREE.TubeGeometry(spanChainCurve, 22, 0.24, 6, false);

    // Shared forged chain-link & hanging glowing ember-cage geometry for swinging pendulums
    const chainLinkGeo = new THREE.TorusGeometry(0.24, 0.08, 6, 10);
    const cageRingGeo = new THREE.TorusGeometry(0.72, 0.1, 6, 10);
    const emberCoreGeo = new THREE.OctahedronGeometry(0.52, 0);

    interface SwingingChainPendulum {
      pivot: THREE.Group;
      phase: number;
      freq: number;
      amp: number;
    }
    const swingChains: SwingingChainPendulum[] = [];

    const templeShades = [0x331f1c, 0x422620, 0x2b1a19, 0x4a2a21];
    let pIdx = 0;
    let lIdx = 0;

    for (let seg = 0; seg < SEGMENT_COUNT; seg++) {
      const segZ = WRAP_FRONT_Z - seg * SEGMENT_LENGTH - SEGMENT_LENGTH * 0.5;
      const chainGroup = new THREE.Group();
      chainGroup.position.set(0, 0, segZ);

      // Overhead sagging iron chain connecting left & right obsidian temple columns
      const topChain = new THREE.Mesh(spanChainGeo, ironChainMat);
      topChain.position.z = -7.5;
      chainGroup.add(topChain);

      for (const side of [-1, 1]) {
        // Side-to-side catenary iron chain draped between adjacent temple columns
        const flankChain = new THREE.Mesh(sideChainGeo, ironChainMat);
        flankChain.position.set(side * 9.6, 0, 0);
        chainGroup.add(flankChain);

        // Glowing carved temple fire-rune tablet mounted on inner column face
        const runeStrip = new THREE.Mesh(new THREE.BoxGeometry(0.24, 4.2, 0.85), runeGlowMat);
        runeStrip.position.set(side * 8.45, 6.4, -7.5);
        chainGroup.add(runeStrip);

        // Dynamically Swinging Heavy Iron Pendulum Chain + Glowing Ember Censer hanging over the lava flank!
        const pendPivot = new THREE.Group();
        pendPivot.position.set(side * 12.2, 13.4, 7.5);
        const linkCount = 8;
        for (let ln = 0; ln < linkCount; ln++) {
          const link = new THREE.Mesh(chainLinkGeo, ironChainMat);
          link.position.y = -0.35 - ln * 0.42;
          link.rotation.y = ln % 2 === 0 ? 0 : Math.PI / 2;
          pendPivot.add(link);
        }
        // Forged iron ember brazier cage swinging at the bottom of the chain
        const cageY = -0.55 - linkCount * 0.42;
        const cageV1 = new THREE.Mesh(cageRingGeo, ironChainMat);
        cageV1.position.y = cageY;
        const cageV2 = new THREE.Mesh(cageRingGeo, ironChainMat);
        cageV2.position.y = cageY;
        cageV2.rotation.y = Math.PI / 2;
        const cageCore = new THREE.Mesh(emberCoreGeo, emberCoreMat);
        cageCore.position.y = cageY;
        pendPivot.add(cageV1, cageV2, cageCore);
        chainGroup.add(pendPivot);

        swingChains.push({
          pivot: pendPivot,
          phase: seg * 1.35 + (side > 0 ? 1.8 : 0),
          freq: 1.55 + (seg % 3) * 0.25,
          amp: 0.26 + (seg % 2) * 0.08,
        });

        // Ruined slanted stone architrave lintel extending outward from the temple capital
        _dummy.position.set(side * 12.8, 13.8, segZ + 7.5);
        _dummy.rotation.set(0, 0, side * -0.08);
        _dummy.scale.set(1, 1, 1);
        _dummy.updateMatrix();
        lintels.setMatrixAt(lIdx++, _dummy.matrix);

        for (let k = 0; k < 2; k++) {
          const z = segZ + (k === 0 ? -7.5 : 7.5);
          const colHeightScale = k === 0 ? 1.08 : 0.94;
          const colX = side * 9.6;
          const shade = templeShades[(pIdx + seg) % templeShades.length];

          _dummy.position.set(colX, 6.7 * colHeightScale, z);
          _dummy.rotation.set(0, Math.PI / 10, 0);
          _dummy.scale.set(1, colHeightScale, 1);
          _dummy.updateMatrix();
          columns.setMatrixAt(pIdx, _dummy.matrix);
          columns.setColorAt(pIdx, _color.setHex(shade));

          _dummy.position.set(colX, 13.6 * colHeightScale, z);
          _dummy.rotation.set(0, 0, 0);
          _dummy.scale.set(1, 1, 1);
          _dummy.updateMatrix();
          capitals.setMatrixAt(pIdx, _dummy.matrix);
          capitals.setColorAt(pIdx, _color.setHex(shade));

          _dummy.position.set(colX, 0.5, z);
          _dummy.updateMatrix();
          plinths.setMatrixAt(pIdx, _dummy.matrix);
          plinths.setColorAt(pIdx, _color.setHex(shade));

          // Stone brazier pedestal + flame along the bridge parapet
          _dummy.position.set(side * 6.2, 1.15, z);
          _dummy.scale.set(1, 1, 1);
          _dummy.updateMatrix();
          brazierBowls.setMatrixAt(pIdx, _dummy.matrix);

          _dummy.position.set(side * 6.2, 2.75, z);
          _dummy.scale.set(1, 1, 1);
          _dummy.updateMatrix();
          flameTops.setMatrixAt(pIdx, _dummy.matrix);

          // Distant jagged volcanic crags behind the Flanking Inferno Trance Colossi
          _dummy.position.set(side * 38, 8.8 + (k % 2) * 5, z);
          _dummy.rotation.set(0, seg + k, 0);
          _dummy.scale.set(1.3, 1.4 + ((seg + k) % 2) * 0.4, 1.3);
          _dummy.updateMatrix();
          crags.setMatrixAt(pIdx, _dummy.matrix);
          pIdx++;
        }
      }

      root.add(chainGroup);
      scrollingGroups.push(chainGroup);
    }

    [columns, capitals, plinths, lintels, brazierBowls, flameTops, crags].forEach((im) => {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      root.add(im);
      instancedProps.push(im);
    });

    // Staggered erupting molten lava geysers + rising 3D glowing thermal heat rings (NO snow particles!)
    const geyserCount = 14;
    const geyserColumns = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.45, 1.15, 1, 7),
      new THREE.MeshBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.9 }),
      geyserCount,
    );
    geyserColumns.frustumCulled = false;
    const geyserCrowns = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(1.15, 0),
      new THREE.MeshBasicMaterial({ color: 0xfef08a }),
      geyserCount,
    );
    geyserCrowns.frustumCulled = false;
    const geyserData = new Float32Array(geyserCount * 4);
    for (let i = 0; i < geyserCount; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      geyserData[i * 4] = side * (16.2 + (i % 3) * 3.6);
      geyserData[i * 4 + 1] = -14 - i * 8.8;
      geyserData[i * 4 + 2] = i * 1.17;
      geyserData[i * 4 + 3] = 11.5 + (i % 4) * 3.8;
    }

    const heatRingCount = 16;
    const heatRingGeo = new THREE.TorusGeometry(1.35, 0.1, 6, 16);
    heatRingGeo.rotateX(Math.PI / 2);
    const heatRings = new THREE.InstancedMesh(
      heatRingGeo,
      new THREE.MeshBasicMaterial({ color: 0xfb923c, transparent: true, opacity: 0.65 }),
      heatRingCount,
    );
    heatRings.frustumCulled = false;
    const heatRingData = new Float32Array(heatRingCount * 4); // x, y, z, speedY
    for (let i = 0; i < heatRingCount; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      heatRingData[i * 4] = side * (14 + (i % 3) * 4.5);
      heatRingData[i * 4 + 1] = (i * 1.4) % 16;
      heatRingData[i * 4 + 2] = -12 - i * 7.8;
      heatRingData[i * 4 + 3] = 3.2 + (i % 3) * 1.1;
    }
    root.add(geyserColumns, geyserCrowns, heatRings);

    const updateDynamic = (elapsed: number, dt: number) => {
      // Smoothly swing all hanging iron temple chains & ember cages
      for (let i = 0; i < swingChains.length; i++) {
        const sc = swingChains[i];
        sc.pivot.rotation.z = Math.sin(elapsed * sc.freq + sc.phase) * sc.amp;
        sc.pivot.rotation.x = Math.cos(elapsed * sc.freq * 0.72 + sc.phase) * (sc.amp * 0.35);
      }

      for (let i = 0; i < geyserCount; i++) {
        const idx = i * 4;
        const x = geyserData[idx];
        const z = geyserData[idx + 1];
        const raw = Math.sin(elapsed * 1.65 + geyserData[idx + 2]);
        const burst = Math.pow(Math.max(0, raw), 2.4);
        const h = 0.4 + burst * geyserData[idx + 3];

        _dummy.position.set(x, -1.7 + h * 0.5, z);
        _dummy.rotation.set(0, elapsed * 1.2 + i, 0);
        _dummy.scale.set(0.65 + burst * 0.55, h, 0.65 + burst * 0.55);
        _dummy.updateMatrix();
        geyserColumns.setMatrixAt(i, _dummy.matrix);

        _dummy.position.set(x, -1.6 + h, z);
        _dummy.rotation.set(elapsed * 2, i, elapsed * 1.5);
        const crownSc = 0.25 + burst * 1.25;
        _dummy.scale.setScalar(crownSc);
        _dummy.updateMatrix();
        geyserCrowns.setMatrixAt(i, _dummy.matrix);
      }
      geyserColumns.instanceMatrix.needsUpdate = true;
      geyserCrowns.instanceMatrix.needsUpdate = true;

      for (let i = 0; i < heatRingCount; i++) {
        const idx = i * 4;
        let y = heatRingData[idx + 1] + heatRingData[idx + 3] * dt;
        if (y > 16.5) y = -0.8;
        heatRingData[idx + 1] = y;
        const p = THREE.MathUtils.clamp((y + 0.8) / 17.3, 0, 1);
        const sc = 0.6 + p * 1.5;
        _dummy.position.set(heatRingData[idx], y, heatRingData[idx + 2]);
        _dummy.rotation.set(0, elapsed * 0.8 + i, 0);
        _dummy.scale.set(sc, 1, sc);
        _dummy.updateMatrix();
        heatRings.setMatrixAt(i, _dummy.matrix);
      }
      heatRings.instanceMatrix.needsUpdate = true;
    };

    const parallaxLayers = this.createParallaxBackdrops('inferno_caldera', 0.006, 0.022, 0.84);
    parallaxLayers.forEach((l) => root.add(l.mesh));

    // Rising glowing molten embers drifting upward from the lava canyon (directionY = +1, never falling snow)
    const particles = this.createAmbientParticles(0xfb923c, 280, 0.32, 1, 3.8, 0.9);
    root.add(particles.points);

    const titan = createWorldTitan('inferno_caldera');
    root.add(titan.group);

    const flankingTitans = createFlankingTranceTitans('inferno_caldera', TOTAL_LENGTH, WRAP_FRONT_Z);
    root.add(flankingTitans.group);

    return {
      id: 'inferno_caldera',
      root,
      skyTexture: createSkyGradientTexture(spec.skyTop, spec.skyMid, spec.skyBottom),
      roadTexture,
      roadMesh,
      instancedProps,
      scrollingGroups,
      parallaxLayers,
      titan,
      flankingTitans,
      liquidFloor,
      particles,
      updateDynamic,
    };
  }

  // ---------------------------------------------------------------------------
  // WORLD 3: NEON SLIME'S OPEN-SKY FLOWING NEON SEWER CANYON
  // Distinct catwalk bridge + open-top vaulted sewer flanks + real animated flowing toxic slime & rising bubbles
  // ---------------------------------------------------------------------------
  private buildSlimeCatacombs(): SceneBundle {
    const spec = SCENE_SPECS.slime_catacombs;
    const root = new THREE.Group();
    const instancedProps: THREE.InstancedMesh[] = [];
    const scrollingGroups: THREE.Object3D[] = [];

    const { mesh: roadMesh, texture: roadTexture } = this.createRoadMesh('slime_catacombs');
    root.add(roadMesh);

    // Wide animated flowing viscous toxic slime river beneath the elevated grated catwalk!
    const slimeRiverTex = createFlowingSlimeTexture(this.maxAniso);
    slimeRiverTex.repeat.set(16, 14);
    const slimeFloorMat = new THREE.MeshStandardMaterial({
      map: slimeRiverTex,
      color: 0xbef264,
      emissive: 0x22c55e,
      emissiveMap: slimeRiverTex,
      emissiveIntensity: 0.95,
      roughness: 0.14,
      metalness: 0.16,
    });
    const liquidFloor = new THREE.Mesh(new THREE.PlaneGeometry(280, TOTAL_LENGTH + 40), slimeFloorMat);
    liquidFloor.rotation.x = -Math.PI / 2;
    liquidFloor.position.set(0, -1.65, WRAP_FRONT_Z - TOTAL_LENGTH / 2);
    root.add(liquidFloor);

    // Continuous pouring liquid slime material (rotated 90° so swirling bands stream straight down each curved tube!)
    const slimePourTex = createFlowingSlimeTexture(this.maxAniso);
    slimePourTex.center.set(0.5, 0.5);
    slimePourTex.rotation = Math.PI / 2;
    slimePourTex.repeat.set(1.5, 3.0);
    const slimePourMat = new THREE.MeshStandardMaterial({
      map: slimePourTex,
      color: 0xd9f99d,
      emissive: 0x4ade80,
      emissiveMap: slimePourTex,
      emissiveIntensity: 1.05,
      roughness: 0.12,
      metalness: 0.1,
    });

    // Crisp elevated catwalk deck curbs + glowing lime hazard strips separating path from sewer canal
    const ledgeMat = new THREE.MeshStandardMaterial({ color: 0x1e2c26, roughness: 0.72, metalness: 0.42 });
    const railMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.32, metalness: 0.84 });
    const limeGlowMat = new THREE.MeshBasicMaterial({ color: 0xa3e635 });

    const leftLedge = new THREE.Mesh(new THREE.BoxGeometry(1.7, 2.2, TOTAL_LENGTH), ledgeMat);
    leftLedge.position.set(-5.65, -0.75, WRAP_FRONT_Z - TOTAL_LENGTH / 2);
    const rightLedge = new THREE.Mesh(new THREE.BoxGeometry(1.7, 2.2, TOTAL_LENGTH), ledgeMat);
    rightLedge.position.set(5.65, -0.75, WRAP_FRONT_Z - TOTAL_LENGTH / 2);

    const leftCurbGlow = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, TOTAL_LENGTH), limeGlowMat);
    leftCurbGlow.position.set(-4.85, 0.25, WRAP_FRONT_Z - TOTAL_LENGTH / 2);
    const rightCurbGlow = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, TOTAL_LENGTH), limeGlowMat);
    rightCurbGlow.position.set(4.85, 0.25, WRAP_FRONT_Z - TOTAL_LENGTH / 2);

    const leftRail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, TOTAL_LENGTH), railMat);
    leftRail.position.set(-5.05, 1.05, WRAP_FRONT_Z - TOTAL_LENGTH / 2);
    const rightRail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, TOTAL_LENGTH), railMat);
    rightRail.position.set(5.05, 1.05, WRAP_FRONT_Z - TOTAL_LENGTH / 2);
    root.add(leftLedge, rightLedge, leftCurbGlow, rightCurbGlow, leftRail, rightRail);

    // Continuous industrial neon-green & steel sewer manifold pipes mounted on the outer canal flanks (x = ±11.2)
    const neonPipeMat = new THREE.MeshStandardMaterial({
      color: 0x4ade80,
      emissive: 0x22c55e,
      emissiveIntensity: 1.2,
      roughness: 0.16,
      metalness: 0.28,
    });
    const steelPipeMat = new THREE.MeshStandardMaterial({ color: 0x263544, roughness: 0.36, metalness: 0.82 });
    const pipeGeo = new THREE.CylinderGeometry(0.48, 0.48, TOTAL_LENGTH, 10);
    pipeGeo.rotateX(Math.PI / 2);
    const bigPipeGeo = new THREE.CylinderGeometry(0.84, 0.84, TOTAL_LENGTH, 10);
    bigPipeGeo.rotateX(Math.PI / 2);

    for (const side of [-1, 1]) {
      const lowNeonPipe = new THREE.Mesh(pipeGeo, neonPipeMat);
      lowNeonPipe.position.set(side * 10.6, 2.5, WRAP_FRONT_Z - TOTAL_LENGTH / 2);
      const midSteelPipe = new THREE.Mesh(bigPipeGeo, steelPipeMat);
      midSteelPipe.position.set(side * 11.4, 4.8, WRAP_FRONT_Z - TOTAL_LENGTH / 2);
      const highNeonPipe = new THREE.Mesh(pipeGeo, neonPipeMat);
      highNeonPipe.position.set(side * 10.8, 7.1, WRAP_FRONT_Z - TOTAL_LENGTH / 2);
      root.add(lowNeonPipe, midSteelPipe, highNeonPipe);
    }

    // OPEN-TOP Sculpted Curved Sewer Half-Vault Ribs along outer canal walls (sky & Titans 100% open!)
    const ribCount = SEGMENT_COUNT * 4;
    const halfRibGeo = new THREE.TorusGeometry(9.6, 0.62, 8, 12, Math.PI * 0.34);
    const sewerRibs = new THREE.InstancedMesh(
      halfRibGeo,
      new THREE.MeshStandardMaterial({ color: 0x1e302a, roughness: 0.58, metalness: 0.52 }),
      ribCount,
    );
    sewerRibs.frustumCulled = false;

    const halfRibNeonGeo = new THREE.TorusGeometry(8.92, 0.15, 6, 12, Math.PI * 0.34);
    const sewerRibNeons = new THREE.InstancedMesh(
      halfRibNeonGeo,
      new THREE.MeshBasicMaterial({ color: 0x86efac }),
      ribCount,
    );
    sewerRibNeons.frustumCulled = false;

    // Industrial bolted pipe flange collar rings, pressure valve wheels & overhanging outfall nozzles
    const flangeRings = new THREE.InstancedMesh(
      new THREE.TorusGeometry(0.98, 0.16, 6, 12),
      new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.34, metalness: 0.85 }),
      ribCount,
    );
    flangeRings.frustumCulled = false;

    const valveWheels = new THREE.InstancedMesh(
      new THREE.TorusGeometry(0.58, 0.1, 6, 10),
      new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.32, metalness: 0.5 }),
      ribCount,
    );
    valveWheels.frustumCulled = false;

    const nozzlePipes = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.62, 0.68, 3.4, 10),
      steelPipeMat,
      ribCount,
    );
    nozzlePipes.frustumCulled = false;

    const nozzleLips = new THREE.InstancedMesh(
      new THREE.TorusGeometry(0.66, 0.14, 6, 10),
      new THREE.MeshBasicMaterial({ color: 0x4ade80 }),
      ribCount,
    );
    nozzleLips.frustumCulled = false;

    // Smooth curved liquid slime pour streams arcing out of each outfall nozzle directly into the flowing canal!
    const pourCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 6.2, 0),
      new THREE.Vector3(-0.95, 5.7, 0),
      new THREE.Vector3(-1.45, 3.1, 0),
      new THREE.Vector3(-1.55, -1.8, 0),
    ]);
    const pourStreamGeo = new THREE.TubeGeometry(pourCurve, 14, 0.44, 8, false);
    const slimePours = new THREE.InstancedMesh(pourStreamGeo, slimePourMat, ribCount);
    slimePours.frustumCulled = false;

    let rIdx = 0;
    for (let seg = 0; seg < SEGMENT_COUNT; seg++) {
      const segZ = WRAP_FRONT_Z - seg * SEGMENT_LENGTH - SEGMENT_LENGTH * 0.5;
      for (let k = 0; k < 2; k++) {
        const z = segZ + (k === 0 ? -7.5 : 7.5);
        for (const side of [-1, 1]) {
          // Open-top flanking sewer half-rib curving upward cleanly outside x = ±11.6
          _dummy.position.set(side * 2.2, 0.2, z);
          _dummy.rotation.set(0, side > 0 ? 0 : Math.PI, 0);
          _dummy.scale.set(1, 1.05, 1);
          _dummy.updateMatrix();
          sewerRibs.setMatrixAt(rIdx, _dummy.matrix);
          sewerRibNeons.setMatrixAt(rIdx, _dummy.matrix);

          // Bolted collar flange around the mid steel manifold pipe
          _dummy.position.set(side * 11.4, 4.8, z);
          _dummy.rotation.set(0, 0, 0);
          _dummy.scale.set(1, 1, 1);
          _dummy.updateMatrix();
          flangeRings.setMatrixAt(rIdx, _dummy.matrix);

          // Bright industrial pressure valve wheel facing the catwalk
          _dummy.position.set(side * 10.1, 4.8, z + 3.2);
          _dummy.rotation.set(0, Math.PI / 2, 0);
          _dummy.updateMatrix();
          valveWheels.setMatrixAt(rIdx, _dummy.matrix);

          // Overhanging sewer discharge nozzle extending over the canal (distinct from runner path!)
          _dummy.position.set(side * 9.8, 6.2, z + 3.5);
          _dummy.rotation.set(0, 0, Math.PI / 2);
          _dummy.updateMatrix();
          nozzlePipes.setMatrixAt(rIdx, _dummy.matrix);

          // Glowing slime-coated mouth ring at nozzle tip
          _dummy.position.set(side * 8.1, 6.2, z + 3.5);
          _dummy.rotation.set(0, Math.PI / 2, 0);
          _dummy.updateMatrix();
          nozzleLips.setMatrixAt(rIdx, _dummy.matrix);

          // Continuous animated flowing slime waterfall curving smoothly from nozzle mouth into the river!
          _dummy.position.set(side * 8.2, 0, z + 3.5);
          _dummy.rotation.set(0, side > 0 ? 0 : Math.PI, 0);
          _dummy.scale.set(1, 1, 1);
          _dummy.updateMatrix();
          slimePours.setMatrixAt(rIdx, _dummy.matrix);
          rIdx++;
        }
      }
    }

    [sewerRibs, sewerRibNeons, flangeRings, valveWheels, nozzlePipes, nozzleLips, slimePours].forEach((im) => {
      im.instanceMatrix.needsUpdate = true;
      root.add(im);
      instancedProps.push(im);
    });

    // Buoyant glossy translucent toxic bubbles rising out of the flowing slime river (NO droplets, NO snow!)
    const bubbleCount = 34;
    const bubbleMat = new THREE.MeshStandardMaterial({
      color: 0xbef264,
      emissive: 0x22c55e,
      emissiveIntensity: 0.95,
      roughness: 0.08,
      metalness: 0.14,
      transparent: true,
      opacity: 0.72,
    });
    const bubbles = new THREE.InstancedMesh(new THREE.SphereGeometry(1.0, 12, 10), bubbleMat, bubbleCount);
    bubbles.frustumCulled = false;
    const bubbleData = new Float32Array(bubbleCount * 5);
    for (let i = 0; i < bubbleCount; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      bubbleData[i * 5] = side * (6.8 + Math.random() * 6.8);
      bubbleData[i * 5 + 1] = Math.random() * 14.5;
      bubbleData[i * 5 + 2] = -8 - Math.random() * 118;
      bubbleData[i * 5 + 3] = 2.0 + Math.random() * 2.6;
      bubbleData[i * 5 + 4] = 0.55 + Math.random() * 0.95;
    }
    root.add(bubbles);

    const updateDynamic = (elapsed: number, dt: number) => {
      // Continuously flow & swirl the viscous toxic slime river and pouring outfall waterfalls!
      slimeRiverTex.offset.y = (slimeRiverTex.offset.y + dt * 0.65) % 1;
      slimeRiverTex.offset.x = Math.sin(elapsed * 0.45) * 0.14;
      slimePourTex.offset.y = (slimePourTex.offset.y - dt * 1.55) % 1;

      for (let i = 0; i < bubbleCount; i++) {
        const idx = i * 5;
        let y = bubbleData[idx + 1] + bubbleData[idx + 3] * dt;
        if (y > 14.8) y = -1.3;
        bubbleData[idx + 1] = y;
        const progress = THREE.MathUtils.clamp((y + 1.3) / 16.1, 0, 1);
        const sc = bubbleData[idx + 4] * (0.4 + Math.sin(progress * Math.PI) * 1.05);
        const wobbleX = bubbleData[idx] + Math.sin(elapsed * 2.1 + i) * 0.48;
        _dummy.position.set(wobbleX, y, bubbleData[idx + 2]);
        _dummy.rotation.set(0, 0, 0);
        _dummy.scale.set(
          sc * (1 + Math.sin(elapsed * 4.2 + i) * 0.08),
          sc * (1 - Math.sin(elapsed * 4.2 + i) * 0.06),
          sc,
        );
        _dummy.updateMatrix();
        bubbles.setMatrixAt(i, _dummy.matrix);
      }
      bubbles.instanceMatrix.needsUpdate = true;
    };

    const parallaxLayers = this.createParallaxBackdrops('slime_catacombs', 0.005, 0.02, 0.76);
    parallaxLayers.forEach((l) => root.add(l.mesh));

    const titan = createWorldTitan('slime_catacombs');
    root.add(titan.group);

    const flankingTitans = createFlankingTranceTitans('slime_catacombs', TOTAL_LENGTH, WRAP_FRONT_Z);
    root.add(flankingTitans.group);

    return {
      id: 'slime_catacombs',
      root,
      skyTexture: createSkyGradientTexture(spec.skyTop, spec.skyMid, spec.skyBottom),
      roadTexture,
      roadMesh,
      instancedProps,
      scrollingGroups,
      parallaxLayers,
      titan,
      flankingTitans,
      liquidFloor,
      updateDynamic,
    };
  }

  // ---------------------------------------------------------------------------
  // WORLD 4: HALF-CYBORG'S PURE CYBERPUNK CITY (Neon Skyline + Composite 3D VTOL Drones)
  // ---------------------------------------------------------------------------
  private buildCyberFoundry(): SceneBundle {
    const spec = SCENE_SPECS.cyber_foundry;
    const root = new THREE.Group();
    const instancedProps: THREE.InstancedMesh[] = [];
    const scrollingGroups: THREE.Object3D[] = [];

    const { mesh: roadMesh, texture: roadTexture } = this.createRoadMesh('cyber_foundry');
    root.add(roadMesh);

    // Rain-slick dark cyberpunk plaza deck (ZERO snow!)
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(280, TOTAL_LENGTH),
      new THREE.MeshStandardMaterial({ color: 0x060916, roughness: 0.28, metalness: 0.42 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.05, WRAP_FRONT_Z - TOTAL_LENGTH / 2);
    root.add(ground);

    const curbGeo = new THREE.BoxGeometry(3.8, 0.38, TOTAL_LENGTH);
    const curbMat = new THREE.MeshStandardMaterial({ color: 0x162036, roughness: 0.35, metalness: 0.62 });
    const leftCurb = new THREE.Mesh(curbGeo, curbMat);
    leftCurb.position.set(-6.7, 0.19, WRAP_FRONT_Z - TOTAL_LENGTH / 2);
    const rightCurb = new THREE.Mesh(curbGeo, curbMat);
    rightCurb.position.set(6.7, 0.19, WRAP_FRONT_Z - TOTAL_LENGTH / 2);
    root.add(leftCurb, rightCurb);

    // Tiered Cyberpunk Skyscrapers, Horizontal Neon Window Strips, Signs & Elevated Monorail Beams
    const bldgCount = SEGMENT_COUNT * 6;
    const bldgs = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.38, metalness: 0.58 }),
      bldgCount,
    );
    bldgs.frustumCulled = false;

    const neonTrim = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.04, 0.35, 1.04),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      bldgCount,
    );
    neonTrim.frustumCulled = false;

    const signCount = SEGMENT_COUNT * 4;
    const signs = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.35, 4.2, 2.0),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.55 }),
      signCount,
    );
    signs.frustumCulled = false;

    const poles = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.11, 0.15, 6.4, 6),
      new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.28, metalness: 0.88 }),
      signCount,
    );
    poles.frustumCulled = false;

    const bulbs = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.25, 0.18, 0.45),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8 }),
      signCount,
    );
    bulbs.frustumCulled = false;

    // Elevated glowing cyberpunk sky-bridge monorail beams spanning high overhead every other segment
    const skyBridges = new THREE.InstancedMesh(
      new THREE.BoxGeometry(24, 0.95, 1.8),
      new THREE.MeshStandardMaterial({
        color: 0x162038,
        emissive: 0x38bdf8,
        emissiveIntensity: 0.45,
        roughness: 0.3,
        metalness: 0.78,
      }),
      SEGMENT_COUNT,
    );
    skyBridges.frustumCulled = false;

    const neonPalette = [0x38bdf8, 0xe879f9, 0x22d3ee, 0xa855f7, 0xf43f5e];
    const bldgPalette = [0x0f162b, 0x141d38, 0x0c1124, 0x181b3b];
    let bIdx = 0;
    let sIdx = 0;

    for (let seg = 0; seg < SEGMENT_COUNT; seg++) {
      const segZ = WRAP_FRONT_Z - seg * SEGMENT_LENGTH - SEGMENT_LENGTH * 0.5;

      // High overhead cyber sky-bridge rail (leaves center Titans completely unobstructed)
      _dummy.position.set(0, 18.5 + (seg % 2) * 3.0, segZ);
      _dummy.rotation.set(0, 0, 0);
      _dummy.scale.set(1, 1, 1);
      _dummy.updateMatrix();
      skyBridges.setMatrixAt(seg, _dummy.matrix);

      for (const side of [-1, 1]) {
        for (let k = 0; k < 3; k++) {
          const w = 5.6 + ((seg + k) % 2) * 1.6;
          // Keep foreground neon towers compact with clear sightlines so Flanking Mecha Trance Colossi (x = ±28.5) tower prominently!
          const h = 8.5 + ((seg * 5 + k * 7 + (side > 0 ? 3 : 0)) % 9);
          const x = side * (14.4 + (k % 2) * 1.6);
          const z = segZ + (k - 1) * 10;

          _dummy.position.set(x, h / 2, z);
          _dummy.rotation.set(0, 0, 0);
          _dummy.scale.set(w, h, 7.0);
          _dummy.updateMatrix();
          bldgs.setMatrixAt(bIdx, _dummy.matrix);
          bldgs.setColorAt(bIdx, _color.setHex(bldgPalette[(bIdx + seg) % bldgPalette.length]));

          // Glowing cyberpunk rooftop neon crown band
          _dummy.position.set(x, h - 0.55, z);
          _dummy.scale.set(w, 1, 7.0);
          _dummy.updateMatrix();
          neonTrim.setMatrixAt(bIdx, _dummy.matrix);
          neonTrim.setColorAt(bIdx, _color.setHex(neonPalette[(bIdx + seg) % neonPalette.length]));
          bIdx++;
        }

        for (let k = 0; k < 2; k++) {
          const z = segZ + (k === 0 ? -7.5 : 7.5);
          _dummy.position.set(side * 9.8, 6.5 + (k % 2) * 2.6, z);
          _dummy.rotation.set(0, 0, 0);
          _dummy.scale.set(1, 1, 1);
          _dummy.updateMatrix();
          signs.setMatrixAt(sIdx, _dummy.matrix);
          signs.setColorAt(sIdx, _color.setHex(neonPalette[(sIdx + seg) % neonPalette.length]));

          _dummy.position.set(side * 5.8, 3.2, z);
          _dummy.updateMatrix();
          poles.setMatrixAt(sIdx, _dummy.matrix);

          _dummy.position.set(side * 5.2, 6.4, z);
          _dummy.updateMatrix();
          bulbs.setMatrixAt(sIdx, _dummy.matrix);
          sIdx++;
        }
      }

      // Holographic Cyberpunk Lofi Billboards displaying uploaded artwork
      const bbGroup = new THREE.Group();
      const side = seg % 2 === 0 ? -1 : 1;
      bbGroup.position.set(side * 12.0, 12.8, segZ);
      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(0.45, 4.7, 7.4),
        new THREE.MeshStandardMaterial({
          color: 0x0f172a,
          emissive: side > 0 ? 0x38bdf8 : 0xe879f9,
          emissiveIntensity: 0.4,
          roughness: 0.32,
          metalness: 0.78,
        }),
      );
      const artPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(6.6, 4.1),
        this.artMaterials[seg % this.artMaterials.length],
      );
      artPlane.position.x = -side * 0.26;
      artPlane.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      bbGroup.add(frame, artPlane);
      root.add(bbGroup);
      scrollingGroups.push(bbGroup);
    }

    [bldgs, neonTrim, signs, poles, bulbs, skyBridges].forEach((im) => {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      root.add(im);
      instancedProps.push(im);
    });

    // -------------------------------------------------------------------------
    // CRYSTAL-CLEAR COMPOSITE MULTI-PART 3D VTOL CYBER DRONES!
    // Chamfered metallic hull + wraparound optical visor + swept wings +
    // 4 tilted glowing quadrotor rings + tail fins + downward scan spotlight cone
    // -------------------------------------------------------------------------
    interface CyberVtolDrone {
      group: THREE.Group;
      rotors: THREE.Object3D[];
      baseY: number;
      speedX: number;
      speedZ: number;
      phase: number;
    }

    const droneHullMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.26, metalness: 0.86 });
    const droneTrimMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.3, metalness: 0.72 });
    const droneCyanMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    const dronePinkMat = new THREE.MeshBasicMaterial({ color: 0xe879f9 });
    const droneScanMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const hullGeo = new THREE.BoxGeometry(1.55, 0.56, 2.65);
    const noseGeo = new THREE.ConeGeometry(0.72, 1.05, 4);
    noseGeo.rotateX(Math.PI / 2);
    noseGeo.rotateZ(Math.PI / 4);
    const canopyGeo = new THREE.BoxGeometry(1.32, 0.24, 0.92);
    const wingGeo = new THREE.BoxGeometry(3.7, 0.12, 0.82);
    const finGeo = new THREE.BoxGeometry(0.12, 0.72, 0.85);
    const podGeo = new THREE.CylinderGeometry(0.46, 0.5, 0.22, 12, 1, true);
    const rotorRingGeo = new THREE.TorusGeometry(0.42, 0.06, 6, 14);
    rotorRingGeo.rotateX(Math.PI / 2);
    const bladeGeo = new THREE.BoxGeometry(0.76, 0.04, 0.12);
    const scanConeGeo = new THREE.ConeGeometry(1.45, 5.2, 12, 1, true);

    const vtolDrones: CyberVtolDrone[] = [];
    const droneCount = 10;

    for (let i = 0; i < droneCount; i++) {
      const accentMat = i % 2 === 0 ? droneCyanMat : dronePinkMat;
      const g = new THREE.Group();

      const body = new THREE.Mesh(hullGeo, droneHullMat);
      g.add(body);

      const armorTop = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.14, 1.9), droneTrimMat);
      armorTop.position.set(0, 0.32, -0.05);
      g.add(armorTop);

      const nose = new THREE.Mesh(noseGeo, droneHullMat);
      nose.position.set(0, -0.02, 1.72);
      g.add(nose);

      // Unmistakable wraparound glowing visor & sensor eye on the front
      const visor = new THREE.Mesh(canopyGeo, accentMat);
      visor.position.set(0, 0.14, 1.02);
      g.add(visor);

      // Swept forward/side drone wings + twin rear vertical stabilizers
      const wings = new THREE.Mesh(wingGeo, droneTrimMat);
      wings.position.set(0, 0.04, 0.08);
      g.add(wings);

      const leftFin = new THREE.Mesh(finGeo, droneHullMat);
      leftFin.position.set(-0.68, 0.42, -1.08);
      leftFin.rotation.z = 0.24;
      const rightFin = new THREE.Mesh(finGeo, droneHullMat);
      rightFin.position.set(0.68, 0.42, -1.08);
      rightFin.rotation.z = -0.24;
      g.add(leftFin, rightFin);

      // Glowing twin rear jet thrusters
      const jetL = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.35, 8), accentMat);
      jetL.rotation.x = Math.PI / 2;
      jetL.position.set(-0.42, -0.02, -1.42);
      const jetR = jetL.clone();
      jetR.position.x = 0.42;
      g.add(jetL, jetR);

      // 4 Quadrotor VTOL glowing turbine pods with spinning rotor blades!
      const rotors: THREE.Object3D[] = [];
      const rotorOffsets: [number, number, number][] = [
        [-1.85, 0.12, 0.85],
        [1.85, 0.12, 0.85],
        [-1.65, 0.16, -0.95],
        [1.65, 0.16, -0.95],
      ];
      for (const [rx, ry, rz] of rotorOffsets) {
        const pod = new THREE.Mesh(podGeo, droneHullMat);
        pod.position.set(rx, ry, rz);
        const ring = new THREE.Mesh(rotorRingGeo, accentMat);
        ring.position.set(rx, ry + 0.02, rz);
        const spinner = new THREE.Group();
        spinner.position.set(rx, ry + 0.04, rz);
        const b1 = new THREE.Mesh(bladeGeo, accentMat);
        const b2 = new THREE.Mesh(bladeGeo, accentMat);
        b2.rotation.y = Math.PI / 2;
        spinner.add(b1, b2);
        rotors.push(spinner);
        g.add(pod, ring, spinner);
      }

      // Subtle translucent downward patrol scan cone
      const scanCone = new THREE.Mesh(scanConeGeo, droneScanMat);
      scanCone.position.set(0, -2.8, 0.55);
      g.add(scanCone);

      const crossPatrol = i % 2 === 0;
      const startX = crossPatrol ? -42 + i * 9.5 : (i % 4 < 2 ? -1 : 1) * (10.5 + (i % 3) * 3.8);
      const baseY = 8.4 + (i % 4) * 2.5;
      const startZ = -18 - i * 10.2;
      const speedX = crossPatrol ? (i % 4 === 0 ? 1 : -1) * (11.5 + (i % 3) * 3.2) : 0;
      const speedZ = crossPatrol ? 0 : (i % 3 === 0 ? 1 : -1) * (16 + (i % 3) * 4.5);

      g.position.set(startX, baseY, startZ);
      g.scale.setScalar(1.12);
      root.add(g);

      vtolDrones.push({ group: g, rotors, baseY, speedX, speedZ, phase: i * 1.15 });
    }

    // High-speed glowing cyberpunk sky-highway light streaks zipping across the neon skyline (ZERO snow particles!)
    const streakCount = 20;
    const streakMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(6.8, 0.14, 0.22),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      streakCount,
    );
    streakMesh.frustumCulled = false;
    const streakData = new Float32Array(streakCount * 4); // x, y, z, vx
    for (let i = 0; i < streakCount; i++) {
      streakData[i * 4] = (Math.random() - 0.5) * 110;
      streakData[i * 4 + 1] = 12.5 + (i % 5) * 3.4;
      streakData[i * 4 + 2] = -20 - i * 5.8;
      streakData[i * 4 + 3] = (i % 2 === 0 ? 1 : -1) * (32 + (i % 4) * 10);
      streakMesh.setColorAt(i, _color.setHex(i % 2 === 0 ? 0x38bdf8 : 0xe879f9));
    }
    if (streakMesh.instanceColor) streakMesh.instanceColor.needsUpdate = true;
    root.add(streakMesh);

    const updateDynamic = (elapsed: number, dt: number) => {
      for (let i = 0; i < vtolDrones.length; i++) {
        const d = vtolDrones[i];
        let x = d.group.position.x + d.speedX * dt;
        let z = d.group.position.z + d.speedZ * dt;
        if (x > 46) x = -46;
        else if (x < -46) x = 46;
        if (z > 12) z = -126;
        else if (z < -128) z = 10;

        const y = d.baseY + Math.sin(elapsed * 2.8 + d.phase) * 0.55;
        const heading = Math.atan2(d.speedX, d.speedZ);
        d.group.position.set(x, y, z);
        d.group.rotation.set(0.1, heading, Math.sin(elapsed * 2.1 + d.phase) * 0.14);

        for (let r = 0; r < d.rotors.length; r++) {
          d.rotors[r].rotation.y += dt * (r % 2 === 0 ? 22 : -22);
        }
      }

      for (let i = 0; i < streakCount; i++) {
        const idx = i * 4;
        let x = streakData[idx] + streakData[idx + 3] * dt;
        if (x > 64) x = -64;
        else if (x < -64) x = 64;
        streakData[idx] = x;
        _dummy.position.set(x, streakData[idx + 1], streakData[idx + 2]);
        _dummy.rotation.set(0, 0, 0);
        _dummy.scale.set(1, 1, 1);
        _dummy.updateMatrix();
        streakMesh.setMatrixAt(i, _dummy.matrix);
      }
      streakMesh.instanceMatrix.needsUpdate = true;
    };

    const parallaxLayers = this.createParallaxBackdrops('cyber_foundry', 0.007, 0.024, 0.85);
    parallaxLayers.forEach((l) => root.add(l.mesh));

    // Weightless upward-floating neon city particles (directionY = +1, zero falling snow!)
    const particles = this.createAmbientParticles(0x38bdf8, 220, 0.28, 1, 1.35, 1.1);
    root.add(particles.points);

    const titan = createWorldTitan('cyber_foundry');
    root.add(titan.group);

    const flankingTitans = createFlankingTranceTitans('cyber_foundry', TOTAL_LENGTH, WRAP_FRONT_Z);
    root.add(flankingTitans.group);

    return {
      id: 'cyber_foundry',
      root,
      skyTexture: createSkyGradientTexture(spec.skyTop, spec.skyMid, spec.skyBottom),
      roadTexture,
      roadMesh,
      instancedProps,
      scrollingGroups,
      parallaxLayers,
      titan,
      flankingTitans,
      particles,
      updateDynamic,
    };
  }

  // ---------------------------------------------------------------------------
  // WORLD 5: VOID SHADOW'S ASTRAL GALLERY (Colossal Astral Void Lofi + Framed Art)
  // ---------------------------------------------------------------------------
  private buildVoidGallery(): SceneBundle {
    const spec = SCENE_SPECS.void_gallery;
    const root = new THREE.Group();
    const instancedProps: THREE.InstancedMesh[] = [];
    const scrollingGroups: THREE.Object3D[] = [];

    const { mesh: roadMesh, texture: roadTexture } = this.createRoadMesh('void_gallery');
    root.add(roadMesh);

    // Wide glossy obsidian astral floor (open sky overhead so the Colossal Void Shadow Titan towers!)
    const floorWide = new THREE.Mesh(
      new THREE.PlaneGeometry(24, TOTAL_LENGTH),
      new THREE.MeshStandardMaterial({ color: 0x0f0c1d, roughness: 0.14, metalness: 0.35 }),
    );
    floorWide.rotation.x = -Math.PI / 2;
    floorWide.position.set(0, -0.02, WRAP_FRONT_Z - TOTAL_LENGTH / 2);
    root.add(floorWide);

    // Floating obsidian columns & glowing violet crystal spires lining the astral gallery
    const colCount = SEGMENT_COUNT * 4;
    const columns = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.9, 10.5, 0.9),
      new THREE.MeshStandardMaterial({ color: 0x201936, roughness: 0.32, metalness: 0.45 }),
      colCount,
    );
    columns.frustumCulled = false;

    const crystals = new THREE.InstancedMesh(
      new THREE.OctahedronGeometry(1.8, 0),
      new THREE.MeshStandardMaterial({
        color: 0xa78bfa,
        emissive: 0x6d28d9,
        emissiveIntensity: 0.75,
        roughness: 0.15,
        metalness: 0.4,
      }),
      colCount,
    );
    crystals.frustumCulled = false;

    const frameMat = new THREE.MeshStandardMaterial({
      color: 0xd4af37,
      roughness: 0.25,
      metalness: 0.85,
    });
    const lampCapMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });

    let colIdx = 0;
    let artCounter = 0;

    for (let seg = 0; seg < SEGMENT_COUNT; seg++) {
      const segZ = WRAP_FRONT_Z - seg * SEGMENT_LENGTH - SEGMENT_LENGTH * 0.5;
      const segArtGroup = new THREE.Group();
      segArtGroup.position.set(0, 0, segZ);

      for (const side of [-1, 1]) {
        for (let k = 0; k < 2; k++) {
          const localZ = k === 0 ? -7.5 : 7.5;

          _dummy.position.set(side * 9.8, 5.2, segZ + localZ + 7.5);
          _dummy.rotation.set(0, 0, 0);
          _dummy.scale.set(1, 1, 1);
          _dummy.updateMatrix();
          columns.setMatrixAt(colIdx, _dummy.matrix);

          // Floating astral crystals hovering outside the art monoliths
          _dummy.position.set(side * 16.5, 9 + (k % 2) * 5, segZ + localZ);
          _dummy.rotation.set(0.3, seg + k, 0.2);
          _dummy.scale.set(0.85, 1.8, 0.85);
          _dummy.updateMatrix();
          crystals.setMatrixAt(colIdx, _dummy.matrix);
          colIdx++;

          // Floating gold-framed Lofi Yeti artworks lining the astral corridor!
          const frame = new THREE.Mesh(new THREE.BoxGeometry(0.32, 4.9, 4.9), frameMat);
          frame.position.set(side * 9.6, 4.3, localZ);

          const artMat = this.artMaterials[artCounter % this.artMaterials.length];
          artCounter++;
          const artMesh = new THREE.Mesh(new THREE.PlaneGeometry(4.35, 4.35), artMat);
          artMesh.position.set(side * 9.4, 4.3, localZ);
          artMesh.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;

          const picLight = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 2.2), lampCapMat);
          picLight.position.set(side * 9.1, 7.15, localZ);

          segArtGroup.add(frame, artMesh, picLight);
        }
      }

      root.add(segArtGroup);
      scrollingGroups.push(segArtGroup);
    }

    [columns, crystals].forEach((im) => {
      im.instanceMatrix.needsUpdate = true;
      root.add(im);
      instancedProps.push(im);
    });

    // Floating orbiting obsidian-gold monolith shards & streaking astral comets!
    const shardCount = 24;
    const shardMat = new THREE.MeshStandardMaterial({
      color: 0x1e1638,
      emissive: 0x7c3aed,
      emissiveIntensity: 0.65,
      roughness: 0.18,
      metalness: 0.72,
    });
    const monolithShards = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1.1, 0), shardMat, shardCount);
    monolithShards.frustumCulled = false;
    const shardData = new Float32Array(shardCount * 5); // x, baseY, z, phase, scale
    for (let i = 0; i < shardCount; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      shardData[i * 5] = side * (11.5 + (i % 4) * 5.2);
      shardData[i * 5 + 1] = 6.5 + (i % 5) * 3.8;
      shardData[i * 5 + 2] = -14 - i * 5.2;
      shardData[i * 5 + 3] = i * 0.9;
      shardData[i * 5 + 4] = 0.75 + (i % 3) * 0.45;
    }
    root.add(monolithShards);

    const cometCount = 8;
    const comets = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.06, 0.28, 7.5, 6),
      new THREE.MeshBasicMaterial({ color: 0xfef08a, transparent: true, opacity: 0.8 }),
      cometCount,
    );
    comets.frustumCulled = false;
    const cometData = new Float32Array(cometCount * 4); // x, y, z, speedX
    for (let i = 0; i < cometCount; i++) {
      cometData[i * 4] = (Math.random() - 0.5) * 110;
      cometData[i * 4 + 1] = 22 + Math.random() * 18;
      cometData[i * 4 + 2] = -40 - Math.random() * 90;
      cometData[i * 4 + 3] = 26 + Math.random() * 18;
    }
    root.add(comets);

    // Pulsing violet-gold astral aura rings drifting peacefully alongside the gallery flanks (NO snow motes!)
    const auraRingCount = 14;
    const auraRingGeo = new THREE.TorusGeometry(1.85, 0.08, 6, 20);
    auraRingGeo.rotateX(Math.PI / 2);
    const auraRings = new THREE.InstancedMesh(
      auraRingGeo,
      new THREE.MeshBasicMaterial({ color: 0xc4b5fd, transparent: true, opacity: 0.72 }),
      auraRingCount,
    );
    auraRings.frustumCulled = false;
    const auraRingData = new Float32Array(auraRingCount * 4); // x, y, z, phase
    for (let i = 0; i < auraRingCount; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      auraRingData[i * 4] = side * (14.5 + (i % 3) * 3.8);
      auraRingData[i * 4 + 1] = 2.5 + (i % 4) * 3.2;
      auraRingData[i * 4 + 2] = -14 - i * 8.5;
      auraRingData[i * 4 + 3] = i * 1.1;
    }
    root.add(auraRings);

    const updateDynamic = (elapsed: number, dt: number) => {
      for (let i = 0; i < shardCount; i++) {
        const idx = i * 5;
        const ph = shardData[idx + 3];
        const sc = shardData[idx + 4];
        const y = shardData[idx + 1] + Math.sin(elapsed * 1.45 + ph) * 1.6;
        _dummy.position.set(shardData[idx], y, shardData[idx + 2]);
        _dummy.rotation.set(elapsed * 0.6 + ph, elapsed * 1.1 + ph, Math.sin(elapsed + ph) * 0.3);
        _dummy.scale.set(sc * 0.65, sc * 2.1, sc * 0.65);
        _dummy.updateMatrix();
        monolithShards.setMatrixAt(i, _dummy.matrix);
      }
      monolithShards.instanceMatrix.needsUpdate = true;

      for (let i = 0; i < cometCount; i++) {
        const idx = i * 4;
        let x = cometData[idx] + cometData[idx + 3] * dt;
        if (x > 64) x = -64;
        cometData[idx] = x;
        _dummy.position.set(x, cometData[idx + 1], cometData[idx + 2]);
        _dummy.rotation.set(0, 0, Math.PI / 2 - 0.22);
        _dummy.scale.set(1, 1, 1);
        _dummy.updateMatrix();
        comets.setMatrixAt(i, _dummy.matrix);
      }
      comets.instanceMatrix.needsUpdate = true;

      for (let i = 0; i < auraRingCount; i++) {
        const idx = i * 4;
        const ph = auraRingData[idx + 3];
        const pulse = 0.75 + Math.sin(elapsed * 1.7 + ph) * 0.35;
        const y = auraRingData[idx + 1] + Math.sin(elapsed * 0.9 + ph) * 1.1;
        _dummy.position.set(auraRingData[idx], y, auraRingData[idx + 2]);
        _dummy.rotation.set(Math.sin(elapsed * 0.5 + ph) * 0.22, elapsed * 0.7 + ph, 0);
        _dummy.scale.set(pulse, 1, pulse);
        _dummy.updateMatrix();
        auraRings.setMatrixAt(i, _dummy.matrix);
      }
      auraRings.instanceMatrix.needsUpdate = true;
    };

    const parallaxLayers = this.createParallaxBackdrops('void_gallery', 0.006, 0.018, 0.86);
    parallaxLayers.forEach((l) => root.add(l.mesh));

    // Gentle upward-drifting violet astral star wisps (directionY = +1, zero falling snow!)
    const particles = this.createAmbientParticles(0xc4b5fd, 200, 0.26, 1, 1.1, 0.45);
    root.add(particles.points);

    const titan = createWorldTitan('void_gallery');
    root.add(titan.group);

    const flankingTitans = createFlankingTranceTitans('void_gallery', TOTAL_LENGTH, WRAP_FRONT_Z);
    root.add(flankingTitans.group);

    return {
      id: 'void_gallery',
      root,
      skyTexture: createSkyGradientTexture(spec.skyTop, spec.skyMid, spec.skyBottom),
      roadTexture,
      roadMesh,
      instancedProps,
      scrollingGroups,
      parallaxLayers,
      titan,
      flankingTitans,
      particles,
      updateDynamic,
    };
  }

  public dispose(): void {
    this.artTextures.forEach((t) => t.dispose());
    this.artMaterials.forEach((m) => m.dispose());
    this.skyDome.geometry.dispose();
    this.skyMat.dispose();
    this.bundles.forEach((b) => {
      b.skyTexture.dispose();
      b.roadTexture.dispose();
      b.parallaxLayers.forEach((l) => l.texture.dispose());
      b.root.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const mesh = obj as THREE.Mesh;
          mesh.geometry?.dispose();
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          mats.forEach((m) => m?.dispose());
        }
      });
    });
  }
}
