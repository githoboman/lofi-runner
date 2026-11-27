import * as THREE from 'three';
import { ART_URLS, SCENE_NAMES, SEGMENT_COUNT, SEGMENT_LENGTH } from './config';
import {
  createBrownMagmaTexture,
  createFlowingSlimeTexture,
  createParallaxHorizonTexture,
  createRoadTexture,
  createSkyGradientTexture,
  createSlideSurfaceTexture,
  loadArtTextures,
} from './textures';
import type { SceneId } from './types';
import { InfernoAnimeController } from './infernoAnime';
import {
  createLavaTemplePool,
  createNeonSewerPool,
  type PooledWorldSystem,
} from './worldPools';
import {
  createPooledTitanFleet,
  type WorldTitanFleetHandle,
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
    fogColor: 0x9ac8eb,
    fogNear: 108,
    fogFar: 290,
    skyTop: '#1d4ed8',
    skyMid: '#60a5fa',
    skyBottom: '#d4ecfc',
    hemiSky: 0xdbeefe,
    hemiGround: 0x7baee8,
    hemiIntensity: 1.06,
    keyColor: 0xfff8e6,
    keyIntensity: 1.55,
    rimColor: 0x7dd3fc,
    rimIntensity: 0.92,
    roadRoughness: 0.44,
    roadMetalness: 0.08,
  },
  inferno_caldera: {
    id: 'inferno_caldera',
    name: SCENE_NAMES.inferno_caldera,
    fogColor: 0x2b1811,
    fogNear: 104,
    fogFar: 282,
    skyTop: '#140c09',
    skyMid: '#2d1b13',
    skyBottom: '#5a3322',
    hemiSky: 0xd9b394,
    hemiGround: 0x3b2115,
    hemiIntensity: 1.15,
    keyColor: 0xfde8cc,
    keyIntensity: 1.85,
    rimColor: 0xb45309,
    rimIntensity: 1.15,
    roadRoughness: 0.56,
    roadMetalness: 0.18,
  },
  slime_catacombs: {
    id: 'slime_catacombs',
    name: SCENE_NAMES.slime_catacombs,
    fogColor: 0x0b151a,
    fogNear: 100,
    fogFar: 275,
    skyTop: '#060c12',
    skyMid: '#0e1b24',
    skyBottom: '#162b30',
    hemiSky: 0x94a3b8,
    hemiGround: 0x0f172a,
    hemiIntensity: 1.05,
    keyColor: 0xe2e8f0,
    keyIntensity: 1.58,
    rimColor: 0x10b981,
    rimIntensity: 0.52,
    roadRoughness: 0.28,
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
  slideTrackGroup: THREE.Group;
  slideTexture: THREE.CanvasTexture;
  hideOnSlide: THREE.Object3D[];
  slideRings: THREE.Object3D[];
  instancedProps: THREE.InstancedMesh[];
  scrollingGroups: THREE.Object3D[];
  parallaxLayers: ParallaxLayer[];
  titanFleet: WorldTitanFleetHandle;
  pooledSystem?: PooledWorldSystem;
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
  private slideMode = false;
  private maxAniso: number;

  private hemiLight: THREE.HemisphereLight;
  private keyLight: THREE.DirectionalLight;
  private rimLight: THREE.DirectionalLight;
  private threeScene: THREE.Scene;
  private infernoAnime: InfernoAnimeController | null = null;

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

  public setSlideMode(active: boolean): void {
    this.slideMode = active;
    const bundle = this.bundles.get(this.currentSceneId);
    if (!bundle) return;
    bundle.slideTrackGroup.visible = active;
    for (const obj of bundle.hideOnSlide) {
      obj.visible = !active;
    }
  }

  public activateScene(sceneId: SceneId): void {
    this.currentSceneId = sceneId;
    const spec = SCENE_SPECS[sceneId];

    this.bundles.forEach((b, id) => {
      const isActive = id === sceneId;
      b.root.visible = isActive;
      b.slideTrackGroup.visible = false;
      if (b.particles) {
        b.particles.points.visible = isActive;
      }
      for (const obj of b.hideOnSlide) {
        obj.visible = true;
      }
    });
    this.slideMode = false;

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

    // Run anime.js choreography only while the Inferno Caldera world is active
    this.infernoAnime?.setActive(sceneId === 'inferno_caldera');
  }

  public update(dt: number, speed: number, elapsed: number, playerX = 0): void {
    const bundle = this.bundles.get(this.currentSceneId);
    if (!bundle) return;

    const dz = speed * dt;

    // Scroll road or active half-pipe slide chute texture smoothly
    bundle.roadTexture.offset.y += dz / (TOTAL_LENGTH / 4);
    if (this.slideMode) {
      bundle.slideTexture.offset.y += (dz / (TOTAL_LENGTH / 4)) * 1.65;
      for (let i = 0; i < bundle.slideRings.length; i++) {
        const ring = bundle.slideRings[i];
        ring.position.z += dz * 1.05;
        if (ring.position.z > WRAP_FRONT_Z - 6) {
          ring.position.z -= 160;
        }
        ring.rotation.z += dt * (i % 2 === 0 ? 0.85 : -0.85);
      }
    }

    // Animate all 9 pooled Horizon + Flanking Lofi Titans via shared InstancedMesh fleet!
    bundle.titanFleet.update(elapsed, dt, dz);

    // Update pooled Lava Temple / Neon Sewer InstancedMesh ring buffers
    bundle.pooledSystem?.update(dt, dz, elapsed);

    // Multi-depth parallax horizon backdrops ("Lofi in motion" atmospheric depth)
    for (const layer of bundle.parallaxLayers) {
      layer.texture.offset.x = (layer.texture.offset.x + layer.driftSpeed * dt) % 1;
      layer.mesh.position.x = -playerX * layer.lateralFactor;
    }

    // Per-world active animations (magma drift, flowing slime UV, drones, shards)
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

    // Animated magma / slime liquid ocean surface (Inferno Caldera uses anime.js choreography!)
    if (bundle.liquidFloor && bundle.id !== 'inferno_caldera') {
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

  private createSlideTrack(sceneId: SceneId): {
    group: THREE.Group;
    texture: THREE.CanvasTexture;
    rings: THREE.Object3D[];
  } {
    const group = new THREE.Group();
    group.visible = false;
    const texture = createSlideSurfaceTexture(sceneId, this.maxAniso);
    const rings: THREE.Object3D[] = [];
    const centerZ = WRAP_FRONT_Z - TOTAL_LENGTH / 2;

    if (sceneId === 'cyber_foundry') {
      // FLOATING TO SPACE: Clean open cosmos with ONLY ultra-fine grain tiny stars & sleek guide rails (no confusing rings!)
      texture.repeat.set(1, 18);
      const starCount = 260;
      const starPos = new Float32Array(starCount * 3);
      const starColors = new Float32Array(starCount * 3);
      const palette = [0xe2e8f0, 0xbae6fd];
      for (let i = 0; i < starCount; i++) {
        starPos[i * 3] = (Math.random() - 0.5) * 110;
        starPos[i * 3 + 1] = -14 + Math.random() * 48;
        starPos[i * 3 + 2] = 18 - Math.random() * 190;
        _color.setHex(palette[i % palette.length]);
        starColors[i * 3] = _color.r;
        starColors[i * 3 + 1] = _color.g;
        starColors[i * 3 + 2] = _color.b;
      }
      const starGeo = new THREE.BufferGeometry();
      starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
      starGeo.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
      const stars = new THREE.Points(
        starGeo,
        new THREE.PointsMaterial({
          size: 0.12,
          vertexColors: true,
          transparent: true,
          opacity: 0.45,
          depthWrite: false,
        }),
      );
      stars.frustumCulled = false;
      group.add(stars);

      // Subtle holographic cosmic grid way beneath the Zero-G flight path
      const spaceFloor = new THREE.Mesh(
        new THREE.PlaneGeometry(11.4, TOTAL_LENGTH),
        new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          opacity: 0.2,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      spaceFloor.rotation.x = -Math.PI / 2;
      spaceFloor.position.set(0, -3.4, centerZ);
      group.add(spaceFloor);

      // Clean straight anti-gravity energy guide rails (zero distracting round tunnel rings!)
      const railGeo = new THREE.CylinderGeometry(0.14, 0.14, TOTAL_LENGTH, 8);
      railGeo.rotateX(Math.PI / 2);
      const leftRail = new THREE.Mesh(railGeo, new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
      leftRail.position.set(-4.95, 0.95, centerZ);
      const rightRail = new THREE.Mesh(railGeo, new THREE.MeshBasicMaterial({ color: 0xe879f9 }));
      rightRail.position.set(4.95, 0.95, centerZ);
      group.add(leftRail, rightRail);

      return { group, texture, rings };
    }

    // CURVED HALF-PIPE SLIDE CHUTES (Snow Slide, Magma Slide, Slime Slide, Blackhole Slide)
    texture.repeat.set(1, 20);
    const chuteGeo = new THREE.CylinderGeometry(
      5.6,
      5.6,
      TOTAL_LENGTH,
      24,
      1,
      true,
      -Math.PI * 0.34,
      Math.PI * 0.68,
    );
    chuteGeo.rotateX(Math.PI / 2);

    const chuteMat =
      sceneId === 'frost_sanctuary'
        ? new THREE.MeshStandardMaterial({
            map: texture,
            roughness: 0.14,
            metalness: 0.1,
            side: THREE.DoubleSide,
          })
        : sceneId === 'inferno_caldera'
          ? new THREE.MeshStandardMaterial({
              map: texture,
              emissiveMap: texture,
              emissive: 0x9a3412,
              emissiveIntensity: 0.45,
              roughness: 0.36,
              metalness: 0.18,
              side: THREE.DoubleSide,
            })
          : sceneId === 'slime_catacombs'
            ? new THREE.MeshStandardMaterial({
                map: texture,
                emissiveMap: texture,
                emissive: 0x047857,
                emissiveIntensity: 0.26,
                roughness: 0.18,
                metalness: 0.2,
                side: THREE.DoubleSide,
              })
            : new THREE.MeshStandardMaterial({
                map: texture,
                emissiveMap: texture,
                emissive: 0x5b21b6,
                emissiveIntensity: 0.42,
                roughness: 0.18,
                metalness: 0.42,
                side: THREE.DoubleSide,
              });

    const chuteMesh = new THREE.Mesh(chuteGeo, chuteMat);
    chuteMesh.position.set(0, 5.56, centerZ);
    chuteMesh.receiveShadow = true;
    group.add(chuteMesh);

    // Smooth glossy rim rails perched flush along the top left/right half-pipe lips
    const rimColor =
      sceneId === 'frost_sanctuary'
        ? 0x3b82f6
        : sceneId === 'inferno_caldera'
          ? 0xd97706
          : sceneId === 'slime_catacombs'
            ? 0x10b981
            : 0xd4af37;
    const rimGeo = new THREE.CylinderGeometry(0.24, 0.24, TOTAL_LENGTH, 8);
    rimGeo.rotateX(Math.PI / 2);
    const rimMat = new THREE.MeshBasicMaterial({ color: rimColor });
    const leftRim = new THREE.Mesh(rimGeo, rimMat);
    leftRim.position.set(-4.91, 2.86, centerZ);
    const rightRim = new THREE.Mesh(rimGeo, rimMat);
    rightRim.position.set(4.91, 2.86, centerZ);
    group.add(leftRim, rightRim);

    if (sceneId === 'void_gallery') {
      // BLACKHOLE SLIDE: Clean distant singularity silhouette only (zero loopy round rings around the slide!)
      const singularity = new THREE.Mesh(
        new THREE.SphereGeometry(9.2, 24, 18),
        new THREE.MeshBasicMaterial({ color: 0x03010a, fog: false }),
      );
      singularity.position.set(0, 8.5, -138);
      const accretionInner = new THREE.Mesh(
        new THREE.TorusGeometry(13.5, 0.72, 10, 42),
        new THREE.MeshBasicMaterial({ color: 0xd4af37, fog: false }),
      );
      accretionInner.position.set(0, 8.5, -138);
      accretionInner.rotation.set(Math.PI * 0.36, 0.14, 0);
      group.add(singularity, accretionInner);
    }

    return { group, texture, rings };
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
    color: number | number[],
    count: number,
    size: number,
    directionY: number,
    speedBase: number,
    windShearX = 0,
    opacity = 0.9,
  ): AmbientParticles {
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count);
    const isPalette = Array.isArray(color);
    const colors = isPalette ? new Float32Array(count * 3) : null;

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 52;
      positions[i * 3 + 1] = Math.random() * 26;
      positions[i * 3 + 2] = 16 - Math.random() * 130;
      velocities[i] = speedBase + Math.random() * speedBase;
      if (isPalette && colors) {
        _color.setHex(color[i % color.length]);
        colors[i * 3] = _color.r;
        colors[i * 3 + 1] = _color.g;
        colors[i * 3 + 2] = _color.b;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    if (colors) {
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }

    const mat = new THREE.PointsMaterial({
      color: isPalette ? 0xffffff : color,
      vertexColors: isPalette,
      size,
      transparent: true,
      opacity,
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
      new THREE.MeshStandardMaterial({ color: 0xc4dbf0, roughness: 0.88, metalness: 0.03 }),
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
      new THREE.MeshStandardMaterial({ color: 0xdbeafe, roughness: 0.62 }),
      treeCount,
    );
    foliageTop.frustumCulled = false;

    // Glacier crags & glowing ice crystal spires flanking the alpine pass
    const ridgeCount = SEGMENT_COUNT * 4;
    const ridges = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(7.2, 0),
      new THREE.MeshStandardMaterial({ color: 0x93b7dc, roughness: 0.65, metalness: 0.08 }),
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

    const parallaxLayers = this.createParallaxBackdrops('frost_sanctuary', 0.005, 0.015, 0.68);
    parallaxLayers.forEach((l) => root.add(l.mesh));

    const titanFleet = createPooledTitanFleet('frost_sanctuary', TOTAL_LENGTH, WRAP_FRONT_Z);
    root.add(titanFleet.group);

    const { group: slideTrackGroup, texture: slideTexture, rings: slideRings } =
      this.createSlideTrack('frost_sanctuary');
    root.add(slideTrackGroup);

    return {
      id: 'frost_sanctuary',
      root,
      skyTexture: createSkyGradientTexture(spec.skyTop, spec.skyMid, spec.skyBottom),
      roadTexture,
      roadMesh,
      slideTrackGroup,
      slideTexture,
      hideOnSlide: [roadMesh],
      slideRings,
      instancedProps,
      scrollingGroups,
      parallaxLayers,
      titanFleet,
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

    // Grounded cooled brown volcanic magma crust flowing slowly beneath the elevated temple causeway
    const brownMagmaTex = createBrownMagmaTexture(this.maxAniso);
    brownMagmaTex.repeat.set(16, 14);
    const lavaMat = new THREE.MeshStandardMaterial({
      map: brownMagmaTex,
      emissiveMap: brownMagmaTex,
      emissive: 0x9a3412,
      emissiveIntensity: 0.42,
      roughness: 0.64,
      metalness: 0.14,
    });
    const liquidFloor = new THREE.Mesh(new THREE.PlaneGeometry(280, TOTAL_LENGTH + 40), lavaMat);
    liquidFloor.rotation.x = -Math.PI / 2;
    liquidFloor.position.set(0, -1.7, WRAP_FRONT_Z - TOTAL_LENGTH / 2);
    root.add(liquidFloor);

    // Dedicated anime.js v4 choreography for Inferno Caldera (magma surge, staggered braziers, runes, gusts & light breathing)
    const infernoAnime = new InfernoAnimeController(SEGMENT_COUNT * 4);
    this.infernoAnime = infernoAnime;

    // Pooled InstancedMesh Lava Temple Ruins + Swinging Iron Pendulum Chains (~189 -> 13 draw calls!)
    const pooledSystem = createLavaTemplePool(TOTAL_LENGTH, WRAP_FRONT_Z, infernoAnime);
    root.add(pooledSystem.group);

    const updateDynamic = (_elapsed: number, dt: number) => {
      const a = infernoAnime.state;
      // anime.js-driven tectonic magma ocean heave, emissive glow surge, and lateral volcanic sway
      liquidFloor.position.y = a.magmaWaveY;
      lavaMat.emissiveIntensity = a.magmaEmissive;
      brownMagmaTex.offset.y = (brownMagmaTex.offset.y + dt * a.magmaFlowRate) % 1;
      brownMagmaTex.offset.x = a.magmaSwayX;
      // Subtle volcanic light breathing choreographed by anime.js timeline
      this.rimLight.intensity = spec.rimIntensity * a.rimIntensityMult;
      this.keyLight.intensity = spec.keyIntensity * a.keyIntensityMult;
    };

    const parallaxLayers = this.createParallaxBackdrops('inferno_caldera', 0.005, 0.016, 0.72);
    parallaxLayers.forEach((l) => root.add(l.mesh));

    const titanFleet = createPooledTitanFleet('inferno_caldera', TOTAL_LENGTH, WRAP_FRONT_Z);
    root.add(titanFleet.group);

    const { group: slideTrackGroup, texture: slideTexture, rings: slideRings } =
      this.createSlideTrack('inferno_caldera');
    root.add(slideTrackGroup);

    return {
      id: 'inferno_caldera',
      root,
      skyTexture: createSkyGradientTexture(spec.skyTop, spec.skyMid, spec.skyBottom),
      roadTexture,
      roadMesh,
      slideTrackGroup,
      slideTexture,
      hideOnSlide: [roadMesh, ...pooledSystem.hideOnSlide],
      slideRings,
      instancedProps,
      scrollingGroups,
      parallaxLayers,
      titanFleet,
      pooledSystem,
      liquidFloor,
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

    // Deep, eye-friendly emerald slime river beneath the elevated dark industrial catwalk
    const slimeRiverTex = createFlowingSlimeTexture(this.maxAniso);
    slimeRiverTex.repeat.set(16, 14);
    const slimeFloorMat = new THREE.MeshStandardMaterial({
      map: slimeRiverTex,
      color: 0x0f5132,
      emissive: 0x047857,
      emissiveMap: slimeRiverTex,
      emissiveIntensity: 0.3,
      roughness: 0.24,
      metalness: 0.18,
    });
    const liquidFloor = new THREE.Mesh(new THREE.PlaneGeometry(280, TOTAL_LENGTH + 40), slimeFloorMat);
    liquidFloor.rotation.x = -Math.PI / 2;
    liquidFloor.position.set(0, -1.65, WRAP_FRONT_Z - TOTAL_LENGTH / 2);
    root.add(liquidFloor);

    // Continuous pouring liquid slime material with calm emerald intensity (no eye strain!)
    const slimePourTex = createFlowingSlimeTexture(this.maxAniso);
    slimePourTex.center.set(0.5, 0.5);
    slimePourTex.rotation = Math.PI / 2;
    slimePourTex.repeat.set(1.5, 3.0);
    const slimePourMat = new THREE.MeshStandardMaterial({
      map: slimePourTex,
      color: 0x15803d,
      emissive: 0x059669,
      emissiveMap: slimePourTex,
      emissiveIntensity: 0.34,
      roughness: 0.2,
      metalness: 0.14,
    });

    // Pooled InstancedMesh Neon Sewer Segments, Pipes, Pouring Slime & Rising Toxic Bubbles!
    const pooledSystem = createNeonSewerPool(TOTAL_LENGTH, WRAP_FRONT_Z, slimePourMat);
    root.add(pooledSystem.group);

    const updateDynamic = (elapsed: number, dt: number) => {
      // Continuously flow & swirl the viscous toxic slime river and pouring outfall waterfalls!
      slimeRiverTex.offset.y = (slimeRiverTex.offset.y + dt * 0.65) % 1;
      slimeRiverTex.offset.x = Math.sin(elapsed * 0.45) * 0.14;
      slimePourTex.offset.y = (slimePourTex.offset.y - dt * 1.55) % 1;
    };

    const parallaxLayers = this.createParallaxBackdrops('slime_catacombs', 0.005, 0.02, 0.76);
    parallaxLayers.forEach((l) => root.add(l.mesh));

    const titanFleet = createPooledTitanFleet('slime_catacombs', TOTAL_LENGTH, WRAP_FRONT_Z);
    root.add(titanFleet.group);

    const { group: slideTrackGroup, texture: slideTexture, rings: slideRings } =
      this.createSlideTrack('slime_catacombs');
    root.add(slideTrackGroup);

    return {
      id: 'slime_catacombs',
      root,
      skyTexture: createSkyGradientTexture(spec.skyTop, spec.skyMid, spec.skyBottom),
      roadTexture,
      roadMesh,
      slideTrackGroup,
      slideTexture,
      hideOnSlide: [roadMesh, ...pooledSystem.hideOnSlide],
      slideRings,
      instancedProps,
      scrollingGroups,
      parallaxLayers,
      titanFleet,
      pooledSystem,
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

    const parallaxLayers = this.createParallaxBackdrops('cyber_foundry', 0.007, 0.024, 0.85);
    parallaxLayers.forEach((l) => root.add(l.mesh));

    const titanFleet = createPooledTitanFleet('cyber_foundry', TOTAL_LENGTH, WRAP_FRONT_Z);
    root.add(titanFleet.group);

    const { group: slideTrackGroup, texture: slideTexture, rings: slideRings } =
      this.createSlideTrack('cyber_foundry');
    root.add(slideTrackGroup);

    return {
      id: 'cyber_foundry',
      root,
      skyTexture: createSkyGradientTexture(spec.skyTop, spec.skyMid, spec.skyBottom),
      roadTexture,
      roadMesh,
      slideTrackGroup,
      slideTexture,
      hideOnSlide: [roadMesh, ground, leftCurb, rightCurb],
      slideRings,
      instancedProps,
      scrollingGroups,
      parallaxLayers,
      titanFleet,
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

    // Grounded obsidian columns lining the astral gallery (zero floating crystals or shards!)
    const colCount = SEGMENT_COUNT * 4;
    const columns = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.9, 10.5, 0.9),
      new THREE.MeshStandardMaterial({ color: 0x201936, roughness: 0.32, metalness: 0.45 }),
      colCount,
    );
    columns.frustumCulled = false;

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
          colIdx++;

          // Gold-framed Lofi Yeti artworks lining the astral corridor!
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

    columns.instanceMatrix.needsUpdate = true;
    root.add(columns);
    instancedProps.push(columns);

    const parallaxLayers = this.createParallaxBackdrops('void_gallery', 0.006, 0.018, 0.86);
    parallaxLayers.forEach((l) => root.add(l.mesh));

    const titanFleet = createPooledTitanFleet('void_gallery', TOTAL_LENGTH, WRAP_FRONT_Z);
    root.add(titanFleet.group);

    const { group: slideTrackGroup, texture: slideTexture, rings: slideRings } =
      this.createSlideTrack('void_gallery');
    root.add(slideTrackGroup);

    return {
      id: 'void_gallery',
      root,
      skyTexture: createSkyGradientTexture(spec.skyTop, spec.skyMid, spec.skyBottom),
      roadTexture,
      roadMesh,
      slideTrackGroup,
      slideTexture,
      hideOnSlide: [roadMesh, floorWide],
      slideRings,
      instancedProps,
      scrollingGroups,
      parallaxLayers,
      titanFleet,
    };
  }

  public dispose(): void {
    this.infernoAnime?.dispose();
    this.infernoAnime = null;
    this.artTextures.forEach((t) => t.dispose());
    this.artMaterials.forEach((m) => m.dispose());
    this.skyDome.geometry.dispose();
    this.skyMat.dispose();
    this.bundles.forEach((b) => {
      b.skyTexture.dispose();
      b.roadTexture.dispose();
      b.slideTexture.dispose();
      b.parallaxLayers.forEach((l) => l.texture.dispose());
      b.titanFleet.dispose();
      b.pooledSystem?.dispose();
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
