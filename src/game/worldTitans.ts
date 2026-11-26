import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { SceneId } from './types';

export interface WorldTitanFleetHandle {
  group: THREE.Group;
  update: (elapsed: number, dt: number, dz: number) => void;
  dispose: () => void;
}

// Reusable zero-GC math scratchpad for instanced articulated Titan bone composition
const _rootMat = new THREE.Matrix4();
const _bodyMat = new THREE.Matrix4();
const _headMat = new THREE.Matrix4();
const _eyeMat = new THREE.Matrix4();
const _leftArmMat = new THREE.Matrix4();
const _rightArmMat = new THREE.Matrix4();
const _specialMat = new THREE.Matrix4();
const _localMat = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();

type BoneKey = 'body' | 'head' | 'eyes' | 'leftArm' | 'rightArm' | 'special';

interface PartCollector {
  entries: Map<THREE.Material, THREE.BufferGeometry[]>;
}

interface MergedLayer {
  mesh: THREE.InstancedMesh;
  bone: BoneKey;
}

interface TitanSlot {
  x: number;
  y: number;
  z: number;
  rotY: number;
  scale: number;
  phaseOffset: number;
  scrolls: boolean;
}

/**
 * Smooth, clean PBR / stylized shading for colossal Lofi Titans —
 * ZERO outline shells, ZERO rings, ZERO halos, ZERO extra decorative lines around them!
 */
function titanMat(
  color: number,
  options?: {
    roughness?: number;
    metalness?: number;
    emissive?: number;
    emissiveIntensity?: number;
    transparent?: boolean;
    opacity?: number;
    depthWrite?: boolean;
  },
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: options?.roughness ?? 0.56,
    metalness: options?.metalness ?? 0.08,
    emissive: options?.emissive ?? 0x000000,
    emissiveIntensity: options?.emissiveIntensity ?? 0,
    transparent: options?.transparent ?? false,
    opacity: options?.opacity ?? 1,
    depthWrite: options?.depthWrite ?? true,
    fog: false,
  });
}

function normalizeGeometryForMerge(
  src: THREE.BufferGeometry,
  pos: [number, number, number],
  scale: [number, number, number],
  rot: [number, number, number],
): THREE.BufferGeometry {
  const geo = src.index ? src.toNonIndexed() : src.clone();
  // Strip unused UV attribute so heterogeneous primitives merge cleanly without attribute mismatch
  if (geo.hasAttribute('uv')) {
    geo.deleteAttribute('uv');
  }
  if (!geo.hasAttribute('normal')) {
    geo.computeVertexNormals();
  }
  _euler.set(rot[0], rot[1], rot[2]);
  _quat.setFromEuler(_euler);
  _pos.set(pos[0], pos[1], pos[2]);
  _scale.set(scale[0], scale[1], scale[2]);
  _localMat.compose(_pos, _quat, _scale);
  geo.applyMatrix4(_localMat);
  return geo;
}

class TitanBlueprintBuilder {
  private buckets: Record<BoneKey, PartCollector> = {
    body: { entries: new Map() },
    head: { entries: new Map() },
    eyes: { entries: new Map() },
    leftArm: { entries: new Map() },
    rightArm: { entries: new Map() },
    special: { entries: new Map() },
  };
  private tempGeos: THREE.BufferGeometry[] = [];
  private materials = new Set<THREE.Material>();

  public add(
    bone: BoneKey,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    pos: [number, number, number] = [0, 0, 0],
    scale: [number, number, number] = [1, 1, 1],
    rot: [number, number, number] = [0, 0, 0],
  ): void {
    this.materials.add(mat);
    const transformed = normalizeGeometryForMerge(geo, pos, scale, rot);
    const map = this.buckets[bone].entries;
    let list = map.get(mat);
    if (!list) {
      list = [];
      map.set(mat, list);
    }
    list.push(transformed);
    this.tempGeos.push(geo);
  }

  public compile(instanceCount: number): {
    layers: MergedLayer[];
    geometries: THREE.BufferGeometry[];
    materials: THREE.Material[];
  } {
    const layers: MergedLayer[] = [];
    const mergedGeometries: THREE.BufferGeometry[] = [];
    const boneKeys: BoneKey[] = ['body', 'head', 'eyes', 'leftArm', 'rightArm', 'special'];

    for (const bone of boneKeys) {
      for (const [mat, list] of this.buckets[bone].entries.entries()) {
        if (list.length === 0) continue;
        const merged = mergeGeometries(list, false);
        for (const g of list) g.dispose();
        if (!merged) continue;
        mergedGeometries.push(merged);
        const im = new THREE.InstancedMesh(merged, mat, instanceCount);
        im.frustumCulled = false;
        layers.push({ mesh: im, bone });
      }
    }

    // Dispose raw source primitive geometries
    const uniqueTemp = new Set(this.tempGeos);
    uniqueTemp.forEach((g) => g.dispose());
    this.tempGeos.length = 0;

    return {
      layers,
      geometries: mergedGeometries,
      materials: Array.from(this.materials),
    };
  }
}

/**
 * Helper to create a wavy Pepe-Yeti lip tube along a curved 3D path matching OG Lofi & Half-Cyborg artwork.
 */
function makeTitanWavyLipGeo(
  yOffset: number,
  radius: number,
  side: 'full' | 'left' | 'right',
  isUpper: boolean,
): THREE.TubeGeometry {
  const fullPts: [number, number, number][] = isUpper
    ? [
        [-4.6, yOffset + 0.3, 10.2],
        [-2.8, yOffset + 0.65, 11.45],
        [-1.3, yOffset + 0.3, 11.95],
        [0, yOffset + 0.05, 12.1],
        [1.3, yOffset + 0.3, 11.95],
        [2.8, yOffset + 0.65, 11.45],
        [4.6, yOffset + 0.3, 10.2],
      ]
    : [
        [-4.4, yOffset + 0.25, 10.1],
        [-2.4, yOffset - 0.38, 11.35],
        [0, yOffset - 0.45, 11.85],
        [2.4, yOffset - 0.38, 11.35],
        [4.4, yOffset + 0.25, 10.1],
      ];

  let chosen = fullPts;
  if (side === 'left') {
    chosen = fullPts.filter((p) => p[0] <= 0.05);
  } else if (side === 'right') {
    chosen = fullPts.filter((p) => p[0] >= -0.05);
  }

  const curve = new THREE.CatmullRomCurve3(chosen.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  return new THREE.TubeGeometry(curve, 14, radius, 7, false);
}

// -----------------------------------------------------------------------------
// BLUEPRINT 1: OG LOFI TITAN (Clean, Expressive Wavy Pepe Lips, Blinking & Waving)
// -----------------------------------------------------------------------------
function populateOgLofiBlueprint(b: TitanBlueprintBuilder): void {
  const fur = titanMat(0xf8fafc, { roughness: 0.65, emissive: 0x38bdf8, emissiveIntensity: 0.08 });
  const blueSkin = titanMat(0x5c9ce6, { roughness: 0.45, emissive: 0x1d4ed8, emissiveIntensity: 0.14 });
  const hornMat = titanMat(0x4b89d6, { roughness: 0.35, metalness: 0.15 });
  const muzzle = titanMat(0xdbe3ec, { roughness: 0.52 });
  const whiteEye = titanMat(0xffffff, { roughness: 0.2, emissive: 0xffffff, emissiveIntensity: 0.25 });
  const blueFaceShade = titanMat(0x2b6cb0, { roughness: 0.45 });
  const eyeNavy = titanMat(0x172554, { roughness: 0.2 });
  const chainMat = titanMat(0xbae6fd, { roughness: 0.2, metalness: 0.88 });

  // Torso (bone: body, origin at y = 12)
  b.add('body', new THREE.SphereGeometry(10.8, 16, 12), fur, [0, -2.5, 0], [1.1, 0.94, 0.94]);
  b.add('body', new THREE.CapsuleGeometry(10.2, 5.5, 6, 16), fur, [0, 8.2, 0], [1.14, 1.0, 0.96]);
  const tuftGeo = new THREE.ConeGeometry(3.2, 6.8, 6);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    b.add(
      'body',
      tuftGeo,
      fur,
      [Math.sin(a) * 10.2, 15.2, Math.cos(a) * 8.8],
      [1, 1, 1],
      [Math.cos(a) * 0.45, 0, -Math.sin(a) * 0.45],
    );
  }
  b.add('body', new THREE.TorusGeometry(6.8, 0.72, 7, 18), chainMat, [0, 12.2, 5.2], [1, 1, 1], [Math.PI * 0.42, 0, 0]);
  b.add('body', new THREE.CylinderGeometry(3.2, 3.2, 1.1, 14), chainMat, [0, 5.6, 10.6], [1, 1, 1], [Math.PI / 2, 0, 0]);

  // Head (bone: head, local origin at head center)
  b.add('head', new THREE.DodecahedronGeometry(10.8, 2), fur, [0, 0, 0], [1.08, 1.0, 0.96]);
  const hairSpikes: [number, number, number, number][] = [
    [-4.2, 9.8, 1.0, 0.28],
    [-0.8, 11.2, 0.8, 0.06],
    [2.8, 10.5, 0.8, -0.18],
    [5.4, 9.0, 0.0, -0.35],
    [-8.2, 5.8, -1.2, 0.65],
    [8.2, 5.8, -1.2, -0.65],
  ];
  for (const [sx, sy, sz, rz] of hairSpikes) {
    b.add('head', tuftGeo, fur, [sx, sy, sz], [0.85, 0.95, 0.85], [0.1, 0, rz]);
  }
  const hornGeo = new THREE.ConeGeometry(1.9, 6.4, 8);
  b.add('head', hornGeo, hornMat, [-5.8, 10.4, 2.6], [1, 1, 1], [0.15, 0, 0.28]);
  b.add('head', hornGeo, hornMat, [5.8, 10.4, 2.6], [1, 1, 1], [0.15, 0, -0.28]);

  const earGeo = new THREE.CapsuleGeometry(2.4, 4.8, 5, 8);
  b.add('head', earGeo, blueSkin, [-11.5, 0.4, 0], [0.72, 1.05, 0.72], [0, 0, 0.35]);
  b.add('head', new THREE.SphereGeometry(2.1, 8, 8), fur, [-13.2, -3.2, 0]);
  b.add('head', earGeo, blueSkin, [11.5, 0.4, 0], [0.72, 1.05, 0.72], [0, 0, -0.35]);
  b.add('head', new THREE.SphereGeometry(2.1, 8, 8), fur, [13.2, -3.2, 0]);

  b.add('head', new THREE.SphereGeometry(8.4, 14, 12), blueSkin, [0, 2.4, 4.6], [1.02, 0.62, 0.82]);
  b.add('head', new THREE.SphereGeometry(7.8, 14, 12), muzzle, [0, -2.6, 5.4], [1.08, 0.74, 0.82]);

  // Eyelids + sculpted nose with soft blue nostrils + wavy glacier-blue lips (no harsh black marks)
  const lidGeo = new THREE.CapsuleGeometry(0.95, 4.4, 5, 8);
  b.add('head', lidGeo, blueSkin, [-3.4, 4.2, 10.2], [1, 1, 0.75], [0, -0.15, Math.PI / 2 + 0.06]);
  b.add('head', lidGeo, blueSkin, [3.4, 4.2, 10.2], [1, 1, 0.75], [0, 0.15, Math.PI / 2 - 0.06]);
  b.add('head', new THREE.SphereGeometry(1.75, 10, 8), blueSkin, [0, -0.2, 11.8], [1.28, 0.8, 0.76]);
  b.add('head', new THREE.SphereGeometry(0.4, 6, 6), blueFaceShade, [-0.75, -0.45, 12.95]);
  b.add('head', new THREE.SphereGeometry(0.4, 6, 6), blueFaceShade, [0.75, -0.45, 12.95]);
  b.add('head', makeTitanWavyLipGeo(-3.4, 0.92, 'full', true), blueSkin);
  b.add('head', makeTitanWavyLipGeo(-4.4, 0.84, 'full', false), blueSkin);
  b.add('head', makeTitanWavyLipGeo(-3.95, 0.24, 'full', true), blueFaceShade, [0, 0, 0.35]);

  // Blinking Eyes (bone: eyes)
  const eyeGeo = new THREE.SphereGeometry(2.7, 12, 10);
  b.add('eyes', eyeGeo, whiteEye, [-3.4, 2.4, 10.1], [1.28, 0.78, 0.48]);
  b.add('eyes', eyeGeo, whiteEye, [3.4, 2.4, 10.1], [1.28, 0.78, 0.48]);
  const pupilGeo = new THREE.SphereGeometry(1.5, 10, 8);
  b.add('eyes', pupilGeo, eyeNavy, [-3.2, 2.3, 11.3], [1, 0.9, 0.45]);
  b.add('eyes', pupilGeo, eyeNavy, [3.2, 2.3, 11.3], [1, 0.9, 0.45]);
  const glintGeo = new THREE.SphereGeometry(0.5, 6, 6);
  b.add('eyes', glintGeo, whiteEye, [-2.5, 3.0, 12.0]);
  b.add('eyes', glintGeo, whiteEye, [3.9, 3.0, 12.0]);

  // Articulated Yeti Arms (leftArm & rightArm)
  const upperArm = new THREE.CapsuleGeometry(3.4, 6.2, 5, 10);
  const foreArm = new THREE.CapsuleGeometry(3.1, 5.6, 5, 10);
  const paw = new THREE.SphereGeometry(3.8, 10, 10);
  b.add('leftArm', upperArm, fur, [-1.0, -4.4, 0]);
  b.add('leftArm', foreArm, fur, [-1.4, -12.4, 1.2], [1, 1, 1], [0.28, 0, 0]);
  b.add('leftArm', paw, blueSkin, [-1.4, -16.8, 2.8], [1, 0.9, 1.15]);

  b.add('rightArm', upperArm, fur, [1.0, -4.4, 0]);
  b.add('rightArm', foreArm, fur, [1.4, -12.4, 1.2], [1, 1, 1], [0.28, 0, 0]);
  b.add('rightArm', paw, blueSkin, [1.4, -16.8, 2.8], [1, 0.9, 1.15]);
}

// -----------------------------------------------------------------------------
// BLUEPRINT 2: INFERNO BLAZE TITAN (Fierce Golden Mustache & Flame Crown — Zero Cringe Grin!)
// -----------------------------------------------------------------------------
function populateInfernoBlueprint(b: TitanBlueprintBuilder): void {
  const flameOrange = titanMat(0xf97316, { roughness: 0.48, emissive: 0xea580c, emissiveIntensity: 0.56 });
  const flameGold = titanMat(0xfacc15, { roughness: 0.35, emissive: 0xf59e0b, emissiveIntensity: 0.78 });
  const flameCore = titanMat(0xfef08a, { roughness: 0.25, emissive: 0xfde047, emissiveIntensity: 0.92 });
  const emberLimb = titanMat(0xea580c, { roughness: 0.55, emissive: 0x9a3412, emissiveIntensity: 0.4 });
  const darkEmber = titanMat(0x7c2d12, { roughness: 0.5 });

  b.add('body', new THREE.SphereGeometry(10.6, 14, 12), emberLimb, [0, -2.5, 0], [1.08, 0.94, 0.94]);
  b.add('body', new THREE.CapsuleGeometry(10.6, 5.8, 6, 14), flameOrange, [0, 8.2, 0], [1.18, 1.0, 0.96]);

  const collarFlameGeo = new THREE.ConeGeometry(4.0, 11.5, 6);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.add(
      'body',
      collarFlameGeo,
      i % 2 === 0 ? flameGold : flameOrange,
      [Math.sin(a) * 10.6, 15.8, Math.cos(a) * 8.6],
      [1, 1.15, 1],
      [0, a, -Math.sin(a) * 0.22],
    );
  }

  // Head
  b.add('head', new THREE.DodecahedronGeometry(10.6, 2), flameOrange, [0, 0, 0], [1.08, 1.02, 0.96]);
  b.add('head', new THREE.CapsuleGeometry(2.2, 4.4, 5, 8), flameOrange, [-11.4, 0.4, 0], [0.72, 1.0, 0.75], [0, 0, 0.34]);
  b.add('head', new THREE.CapsuleGeometry(2.2, 4.4, 5, 8), flameOrange, [11.4, 0.4, 0], [0.72, 1.0, 0.75], [0, 0, -0.34]);

  // Fierce flame brows + glowing golden squinted eyes + sculpted nose + majestic curling flame mustache!
  const browGeo = new THREE.CapsuleGeometry(1.15, 4.5, 5, 8);
  b.add('head', browGeo, flameCore, [-3.6, 4.0, 10.0], [1, 1, 0.75], [0, -0.18, Math.PI / 2 - 0.28]);
  b.add('head', browGeo, flameCore, [3.6, 4.0, 10.0], [1, 1, 0.75], [0, 0.18, Math.PI / 2 + 0.28]);

  b.add('eyes', new THREE.SphereGeometry(2.1, 10, 8), flameCore, [-3.4, 2.2, 10.2], [1.28, 0.48, 0.48], [0, -0.18, -0.18]);
  b.add('eyes', new THREE.SphereGeometry(2.1, 10, 8), flameCore, [3.4, 2.2, 10.2], [1.28, 0.48, 0.48], [0, 0.18, 0.18]);

  // Sculpted nose + two ember nostrils
  b.add('head', new THREE.SphereGeometry(1.7, 10, 8), emberLimb, [0, -0.4, 11.2], [1.22, 0.8, 0.75]);
  b.add('head', new THREE.SphereGeometry(0.45, 6, 6), darkEmber, [-0.65, -0.65, 12.25]);
  b.add('head', new THREE.SphereGeometry(0.45, 6, 6), darkEmber, [0.65, -0.65, 12.25]);

  // Iconic sweeping golden-white flame mustache (matching reference art!) + fiery beard
  const stacheCurveL = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.3, -2.0, 11.6),
    new THREE.Vector3(-3.4, -1.6, 11.3),
    new THREE.Vector3(-6.4, -3.2, 9.8),
    new THREE.Vector3(-8.4, -5.2, 8.2),
  ]);
  const stacheCurveR = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.3, -2.0, 11.6),
    new THREE.Vector3(3.4, -1.6, 11.3),
    new THREE.Vector3(6.4, -3.2, 9.8),
    new THREE.Vector3(8.4, -5.2, 8.2),
  ]);
  b.add('head', new THREE.TubeGeometry(stacheCurveL, 12, 1.35, 7, false), flameCore);
  b.add('head', new THREE.TubeGeometry(stacheCurveR, 12, 1.35, 7, false), flameCore);
  b.add('head', new THREE.ConeGeometry(4.5, 8.2, 7), flameGold, [0, -7.8, 8.0], [1.2, 1, 0.7], [Math.PI, 0, 0]);

  // Flickering flame crown (bone: special, anchored to head)
  const crownGeo = new THREE.ConeGeometry(4.8, 17.5, 7);
  const crownSpecs: [number, number, number, number, number][] = [
    [0, 13.8, -0.4, 1.18, 0],
    [-5.4, 12.0, 0.8, 0.96, 0.24],
    [5.4, 12.0, 0.8, 0.96, -0.24],
    [-3.2, 12.6, -4.0, 1.06, 0.12],
    [3.2, 12.6, -4.0, 1.06, -0.12],
  ];
  for (const [x, y, z, s, rz] of crownSpecs) {
    b.add('special', crownGeo, flameGold, [x, y, z], [s, s * 1.15, s], [-0.12, 0, rz]);
  }

  // Arms
  const upperArm = new THREE.CapsuleGeometry(3.6, 6.4, 5, 10);
  const foreArm = new THREE.CapsuleGeometry(3.3, 5.8, 5, 10);
  const fist = new THREE.SphereGeometry(4.2, 10, 8);
  b.add('leftArm', upperArm, emberLimb, [-1.2, -4.5, 0]);
  b.add('leftArm', foreArm, flameOrange, [-1.6, -12.6, 1.4], [1, 1, 1], [0.28, 0, 0]);
  b.add('leftArm', fist, flameGold, [-1.6, -17.2, 3.0]);

  b.add('rightArm', upperArm, emberLimb, [1.2, -4.5, 0]);
  b.add('rightArm', foreArm, flameOrange, [1.6, -12.6, 1.4], [1, 1, 1], [0.28, 0, 0]);
  b.add('rightArm', fist, flameGold, [1.6, -17.2, 3.0]);
}

// -----------------------------------------------------------------------------
// BLUEPRINT 3: NEON SLIME TITAN (Translucent Slime + Glowing Inner Skeleton)
// -----------------------------------------------------------------------------
function populateNeonSlimeBlueprint(b: TitanBlueprintBuilder): void {
  const gelOuter = titanMat(0x4ade80, {
    roughness: 0.16,
    metalness: 0.08,
    emissive: 0x16a34a,
    emissiveIntensity: 0.52,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
  });
  const boneCore = titanMat(0xbef264, { roughness: 0.32, emissive: 0x4ade80, emissiveIntensity: 0.85 });
  const darkEye = titanMat(0x14532d, { roughness: 0.2 });

  // Inner skeleton + outer gel body
  b.add('body', new THREE.CylinderGeometry(1.8, 1.8, 15, 8), boneCore, [0, 7.5, 0]);
  for (let r = 0; r < 3; r++) {
    b.add('body', new THREE.TorusGeometry(5.6 - r * 0.45, 0.95, 7, 16), boneCore, [0, 11.4 - r * 3.8, 0.4], [1.16, 0.85, 0.85], [Math.PI / 2, 0, 0]);
  }
  b.add('body', new THREE.SphereGeometry(10.6, 14, 12), gelOuter, [0, -2.0, 0], [1.1, 0.94, 0.96]);
  b.add('body', new THREE.CapsuleGeometry(10.8, 6.2, 6, 14), gelOuter, [0, 8.2, 0], [1.14, 1.0, 0.98]);

  // Head
  b.add('head', new THREE.SphereGeometry(7.2, 12, 10), boneCore, [0, 1.2, 0.4], [1.0, 0.95, 0.92]);
  b.add('head', new THREE.BoxGeometry(10.2, 3.6, 4.8), boneCore, [0, -3.2, 5.4]);
  b.add('head', new THREE.DodecahedronGeometry(11.2, 2), gelOuter, [0, 0.4, 0], [1.08, 1.02, 0.98]);
  const hornGeo = new THREE.ConeGeometry(1.8, 5.8, 8);
  b.add('head', hornGeo, boneCore, [-5.6, 10.6, 1.8], [1, 1, 1], [0.15, 0, 0.28]);
  b.add('head', hornGeo, boneCore, [5.6, 10.6, 1.8], [1, 1, 1], [0.15, 0, -0.28]);
  const earGeo = new THREE.CapsuleGeometry(2.4, 4.5, 5, 8);
  b.add('head', earGeo, gelOuter, [-11.8, 0.2, 0], [0.85, 1.05, 0.8], [0, 0, 0.4]);
  b.add('head', earGeo, gelOuter, [11.8, 0.2, 0], [0.85, 1.05, 0.8], [0, 0, -0.4]);

  b.add('eyes', new THREE.SphereGeometry(2.6, 10, 8), boneCore, [-3.2, 2.6, 8.0], [1.2, 0.74, 0.5]);
  b.add('eyes', new THREE.SphereGeometry(2.6, 10, 8), boneCore, [3.2, 2.6, 8.0], [1.2, 0.74, 0.5]);
  b.add('eyes', new THREE.SphereGeometry(1.25, 8, 8), darkEye, [-3.2, 2.4, 9.2], [1, 0.9, 0.5]);
  b.add('eyes', new THREE.SphereGeometry(1.25, 8, 8), darkEye, [3.2, 2.4, 9.2], [1, 0.9, 0.5]);

  // Arms
  const boneArm = new THREE.CylinderGeometry(1.2, 1.2, 7.2, 8);
  const gelUpper = new THREE.CapsuleGeometry(3.4, 6.2, 5, 10);
  const gelFore = new THREE.CapsuleGeometry(3.1, 5.6, 5, 10);
  const gelHand = new THREE.SphereGeometry(3.8, 10, 10);
  b.add('leftArm', boneArm, boneCore, [-1.0, -4.4, 0]);
  b.add('leftArm', gelUpper, gelOuter, [-1.0, -4.4, 0]);
  b.add('leftArm', gelFore, gelOuter, [-1.4, -12.4, 1.2], [1, 1, 1], [0.25, 0, 0]);
  b.add('leftArm', gelHand, gelOuter, [-1.4, -16.8, 2.8]);

  b.add('rightArm', boneArm, boneCore, [1.0, -4.4, 0]);
  b.add('rightArm', gelUpper, gelOuter, [1.0, -4.4, 0]);
  b.add('rightArm', gelFore, gelOuter, [1.4, -12.4, 1.2], [1, 1, 1], [0.25, 0, 0]);
  b.add('rightArm', gelHand, gelOuter, [1.4, -16.8, 2.8]);
}

// -----------------------------------------------------------------------------
// BLUEPRINT 4: HALF-CYBORG TITAN (True 50/50 Organic Yeti & White-Chrome Mecha)
// -----------------------------------------------------------------------------
function populateHalfCyborgBlueprint(b: TitanBlueprintBuilder): void {
  const fur = titanMat(0xf8fafc, { roughness: 0.62, emissive: 0x38bdf8, emissiveIntensity: 0.06 });
  const blueSkin = titanMat(0x5c9ce6, { roughness: 0.45, emissive: 0x2563eb, emissiveIntensity: 0.1 });
  const muzzle = titanMat(0xdbe3ec, { roughness: 0.5 });
  const mechaWhite = titanMat(0xe2e8f0, { roughness: 0.32, metalness: 0.48 });
  const darkChassis = titanMat(0x1e293b, { roughness: 0.38, metalness: 0.72 });
  const chrome = titanMat(0x94a3b8, { roughness: 0.2, metalness: 0.92 });
  const opticCyan = titanMat(0x38bdf8, { roughness: 0.18, emissive: 0x38bdf8, emissiveIntensity: 1.15 });
  const whiteEye = titanMat(0xffffff, { roughness: 0.2, emissive: 0xffffff, emissiveIntensity: 0.2 });
  const pupilMat = titanMat(0x0b0f19, { roughness: 0.2 });

  // Torso
  b.add('body', new THREE.SphereGeometry(10.0, 14, 12), fur, [1.4, -2.2, 0], [0.95, 0.9, 0.92]);
  b.add('body', new THREE.BoxGeometry(11.4, 15.8, 15.4), fur, [5.4, 8.2, 0]);
  b.add('body', new THREE.BoxGeometry(10.8, 15.0, 14.2), darkChassis, [-5.2, 8.2, 0]);
  b.add('body', new THREE.BoxGeometry(11.2, 2.8, 15.4), mechaWhite, [-5.3, 14.6, 0]);
  b.add('body', new THREE.BoxGeometry(10.6, 2.6, 14.8), mechaWhite, [-5.2, 4.0, 0]);

  // Spinning chest gear (bone: special)
  const gearGeo = new THREE.CylinderGeometry(4.0, 4.0, 1.6, 10);
  gearGeo.rotateX(Math.PI / 2);
  b.add('special', gearGeo, chrome, [0, 0, 0]);

  // Head: True 50/50 Split Ellipsoids + matching curved wavy split lips!
  b.add('head', new THREE.SphereGeometry(10.8, 14, 12, Math.PI * 0.5, Math.PI), fur, [0, 0, 0], [1.06, 1.0, 0.96]);
  b.add('head', new THREE.SphereGeometry(10.8, 14, 12, -Math.PI * 0.5, Math.PI), mechaWhite, [0, 0, 0], [1.06, 1.0, 0.96]);

  // Organic +X face half
  b.add('head', new THREE.SphereGeometry(8.2, 12, 10, Math.PI * 0.5, Math.PI), blueSkin, [0.1, 2.4, 4.6], [1.0, 0.62, 0.8]);
  b.add('head', new THREE.SphereGeometry(7.6, 12, 10, Math.PI * 0.5, Math.PI), muzzle, [0.1, -2.6, 5.4], [1.06, 0.72, 0.8]);
  b.add('head', makeTitanWavyLipGeo(-3.4, 0.9, 'right', true), blueSkin);
  b.add('head', makeTitanWavyLipGeo(-4.4, 0.82, 'right', false), blueSkin);
  b.add('head', makeTitanWavyLipGeo(-3.95, 0.26, 'right', true), pupilMat, [0, 0, 0.35]);
  b.add('head', new THREE.ConeGeometry(1.8, 6.2, 8), blueSkin, [5.8, 10.2, 2.2], [1, 1, 1], [0.15, 0, -0.26]);
  b.add('head', new THREE.CapsuleGeometry(2.2, 4.4, 5, 8), blueSkin, [11.8, 0.2, 0], [0.7, 1.0, 0.72], [0, 0, -0.35]);

  b.add('eyes', new THREE.SphereGeometry(2.55, 10, 8), whiteEye, [3.6, 2.4, 10.0], [1.2, 0.78, 0.48]);
  b.add('eyes', new THREE.SphereGeometry(1.5, 8, 8), pupilMat, [3.6, 2.3, 11.2], [1, 0.9, 0.45]);

  // Mechanical -X face half (concentric white-chrome iris optic + matching curved robotic chrome lips!)
  b.add('head', new THREE.TorusGeometry(3.2, 0.7, 8, 16), chrome, [-3.8, 2.4, 9.6], [1, 1, 1], [0, -0.22, 0]);
  b.add('head', new THREE.CylinderGeometry(2.4, 2.4, 1.2, 14), darkChassis, [-3.8, 2.4, 9.4], [1, 1, 1], [Math.PI / 2, -0.22, 0]);
  b.add('head', new THREE.SphereGeometry(1.45, 10, 8), opticCyan, [-3.9, 2.4, 10.1], [1, 1, 0.55]);
  b.add('head', makeTitanWavyLipGeo(-3.4, 0.88, 'left', true), mechaWhite);
  b.add('head', makeTitanWavyLipGeo(-4.4, 0.8, 'left', false), chrome);
  b.add('head', makeTitanWavyLipGeo(-3.95, 0.26, 'left', true), darkChassis, [0, 0, 0.35]);
  b.add('head', new THREE.CylinderGeometry(0.55, 0.55, 5.8, 8), opticCyan, [-11.4, 4.6, 0], [1, 1, 1], [0, 0, 0.22]);

  // Asymmetric arms
  b.add('leftArm', new THREE.CylinderGeometry(2.9, 2.5, 8.6, 10), mechaWhite, [-0.8, -4.4, 0]);
  b.add('leftArm', new THREE.CylinderGeometry(2.4, 2.2, 7.6, 10), chrome, [-1.0, -12.4, 1.2], [1, 1, 1], [0.25, 0, 0]);
  b.add('leftArm', new THREE.BoxGeometry(4.8, 4.4, 5.6), mechaWhite, [-1.0, -16.8, 2.8]);

  b.add('rightArm', new THREE.CapsuleGeometry(3.4, 6.2, 5, 10), fur, [1.0, -4.4, 0]);
  b.add('rightArm', new THREE.CapsuleGeometry(3.1, 5.6, 5, 10), fur, [1.4, -12.4, 1.2], [1, 1, 1], [0.25, 0, 0]);
  b.add('rightArm', new THREE.SphereGeometry(3.8, 10, 10), blueSkin, [1.4, -16.8, 2.8], [1, 0.9, 1.15]);
}

// -----------------------------------------------------------------------------
// BLUEPRINT 5: VOID SHADOW TITAN (Stealth Shadow Yeti — Zero Rings/Energons!)
// -----------------------------------------------------------------------------
function populateVoidShadowBlueprint(b: TitanBlueprintBuilder): void {
  const obsidianFur = titanMat(0x1b182e, { roughness: 0.62, emissive: 0x3b0764, emissiveIntensity: 0.14 });
  const charcoalFur = titanMat(0x2f2c47, { roughness: 0.56, emissive: 0x312e81, emissiveIntensity: 0.12 });
  const slateSkin = titanMat(0x4b5170, { roughness: 0.45 });
  const muzzleDark = titanMat(0x32354f, { roughness: 0.52 });
  const hornCyan = titanMat(0x38bdf8, { roughness: 0.28, emissive: 0x0284c7, emissiveIntensity: 0.55 });
  const scarfMat = titanMat(0x4c2982, { roughness: 0.52, emissive: 0x4c1d95, emissiveIntensity: 0.18 });
  const capeMat = titanMat(0x201b36, { roughness: 0.64 });
  const eyeViolet = titanMat(0xe9d5ff, { roughness: 0.2, emissive: 0xa855f7, emissiveIntensity: 1.0 });

  b.add('body', new THREE.SphereGeometry(10.6, 14, 12), obsidianFur, [0, -2.5, 0], [1.08, 0.94, 0.94]);
  b.add('body', new THREE.CapsuleGeometry(10.2, 5.5, 6, 14), obsidianFur, [0, 8.2, 0], [1.14, 1.0, 0.96]);
  b.add('body', new THREE.TorusGeometry(9.0, 2.4, 7, 16), scarfMat, [0, 14.8, 0.4], [1.08, 0.95, 1.0], [Math.PI * 0.48, 0, 0]);
  const tuftGeo = new THREE.ConeGeometry(3.0, 6.4, 6);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    b.add('body', tuftGeo, charcoalFur, [Math.sin(a) * 10.2, 13.8, Math.cos(a) * 8.6], [1, 0.95, 1], [Math.cos(a) * 0.45, 0, -Math.sin(a) * 0.45]);
  }

  // Swaying shadow cloak (bone: special)
  b.add('special', new THREE.BoxGeometry(22.5, 22.0, 1.8), capeMat, [0, -11.0, -1.0]);

  // Head
  b.add('head', new THREE.SphereGeometry(10.8, 14, 12, -Math.PI * 0.5, Math.PI), charcoalFur, [0, 0, 0], [1.08, 1.0, 0.96]);
  b.add('head', new THREE.SphereGeometry(10.8, 14, 12, Math.PI * 0.5, Math.PI), obsidianFur, [0, 0, 0], [1.08, 1.0, 0.96]);
  const hornGeo = new THREE.ConeGeometry(1.9, 7.0, 8);
  b.add('head', hornGeo, hornCyan, [-5.8, 10.8, 2.2], [1, 1, 1], [0.18, 0, 0.3]);
  b.add('head', hornGeo, hornCyan, [5.8, 10.8, 2.2], [1, 1, 1], [0.18, 0, -0.3]);

  const earGeo = new THREE.CapsuleGeometry(2.2, 4.8, 5, 8);
  b.add('head', earGeo, slateSkin, [-11.4, 0.4, 0], [0.7, 1.05, 0.72], [0, 0, 0.38]);
  b.add('head', earGeo, slateSkin, [11.4, 0.4, 0], [0.7, 1.05, 0.72], [0, 0, -0.38]);
  b.add('head', new THREE.SphereGeometry(7.6, 12, 10), muzzleDark, [0, -2.6, 5.4], [1.08, 0.76, 0.78]);
  b.add('head', new THREE.BoxGeometry(6.2, 1.35, 3.0), obsidianFur, [-3.4, 4.2, 10.2], [1, 1, 1], [0, 0, -0.16]);
  b.add('head', new THREE.BoxGeometry(6.2, 1.35, 3.0), obsidianFur, [3.4, 4.2, 10.2], [1, 1, 1], [0, 0, 0.16]);
  b.add('head', makeTitanWavyLipGeo(-3.6, 0.7, 'full', false), slateSkin);

  b.add('eyes', new THREE.SphereGeometry(2.6, 10, 8), eyeViolet, [-3.4, 2.4, 10.2], [1.26, 0.62, 0.46], [0, 0, -0.1]);
  b.add('eyes', new THREE.SphereGeometry(2.6, 10, 8), eyeViolet, [3.4, 2.4, 10.2], [1.26, 0.62, 0.46], [0, 0, 0.1]);

  // Arms
  b.add('leftArm', new THREE.CapsuleGeometry(3.4, 6.2, 5, 10), obsidianFur, [-1.0, -4.4, 0]);
  b.add('leftArm', new THREE.CapsuleGeometry(3.1, 5.6, 5, 10), charcoalFur, [-1.4, -12.4, 1.2], [1, 1, 1], [0.22, 0, 0]);
  b.add('leftArm', new THREE.SphereGeometry(3.8, 10, 10), slateSkin, [-1.4, -16.8, 2.8], [1, 0.9, 1.15]);

  b.add('rightArm', new THREE.CapsuleGeometry(3.4, 6.2, 5, 10), obsidianFur, [1.0, -4.4, 0]);
  b.add('rightArm', new THREE.CapsuleGeometry(3.1, 5.6, 5, 10), charcoalFur, [1.4, -12.4, 1.2], [1, 1, 1], [0.22, 0, 0]);
  b.add('rightArm', new THREE.SphereGeometry(3.8, 10, 10), slateSkin, [1.4, -16.8, 2.8], [1, 0.9, 1.15]);
}

/**
 * Pooled Articulated InstancedMesh Titan Fleet!
 * Renders ALL 9 colossal Lofi Titans per world (3 Horizon Trio + 6 Flanking Trance Colossi)
 * through ONE shared merged InstancedMesh pool (~8-12 draw calls total instead of ~342!),
 * preserving full breathing, nodding, blinking, arm waving, flame flicker, and Z-recycling!
 */
export function createPooledTitanFleet(
  sceneId: SceneId,
  totalLength: number,
  wrapFrontZ: number,
): WorldTitanFleetHandle {
  const group = new THREE.Group();

  // Build fixed-capacity pool of 9 Titan slots: 3 Horizon Titans + 6 Recycled Flanking Titans
  const slots: TitanSlot[] = [];

  const horizonBaseY = sceneId === 'inferno_caldera' ? 1 : sceneId === 'slime_catacombs' ? 3 : 2;
  // 0: Center Horizon Titan
  slots.push({ x: 0, y: horizonBaseY, z: -122, rotY: 0, scale: 1.12, phaseOffset: 0, scrolls: false });
  // 1: Left Horizon Titan
  slots.push({ x: -41, y: horizonBaseY - 1.5, z: -128, rotY: 0.32, scale: 0.94, phaseOffset: 1.8, scrolls: false });
  // 2: Right Horizon Titan
  slots.push({ x: 41, y: horizonBaseY - 1.5, z: -128, rotY: -0.32, scale: 0.94, phaseOffset: 3.6, scrolls: false });

  // 3..8: Flanking Trance Colossi along left & right running corridor (recycled in-place!)
  const pairCount = 3;
  const spacing = totalLength / pairCount;
  const sideDist = sceneId === 'cyber_foundry' ? 28.5 : sceneId === 'slime_catacombs' ? 24.5 : 26.0;
  for (let i = 0; i < pairCount; i++) {
    const baseZ = wrapFrontZ - 26 - i * spacing;
    for (const side of [-1, 1]) {
      const staggerZ = side > 0 ? -spacing * 0.36 : 0;
      slots.push({
        x: side * sideDist,
        y: 0.5,
        z: baseZ + staggerZ,
        rotY: side < 0 ? 1.04 : -1.04,
        scale: 0.42,
        phaseOffset: i * 1.7 + (side > 0 ? 0.9 : 0),
        scrolls: true,
      });
    }
  }

  const builder = new TitanBlueprintBuilder();
  if (sceneId === 'frost_sanctuary') populateOgLofiBlueprint(builder);
  else if (sceneId === 'inferno_caldera') populateInfernoBlueprint(builder);
  else if (sceneId === 'slime_catacombs') populateNeonSlimeBlueprint(builder);
  else if (sceneId === 'cyber_foundry') populateHalfCyborgBlueprint(builder);
  else populateVoidShadowBlueprint(builder);

  const { layers, geometries, materials } = builder.compile(slots.length);
  for (const layer of layers) {
    group.add(layer.mesh);
  }

  const boneMatrices: Record<BoneKey, THREE.Matrix4> = {
    body: _bodyMat,
    head: _headMat,
    eyes: _eyeMat,
    leftArm: _leftArmMat,
    rightArm: _rightArmMat,
    special: _specialMat,
  };

  let gearAngle = 0;

  const update = (elapsed: number, dt: number, dz: number) => {
    gearAngle += dt * 1.65;

    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (s.scrolls) {
        s.z += dz;
        if (s.z > wrapFrontZ + 12) {
          s.z -= totalLength;
        }
      }

      const t = elapsed + s.phaseOffset;

      // Root world transform
      _pos.set(s.x, s.y, s.z);
      _euler.set(0, s.rotY, 0);
      _quat.setFromEuler(_euler);
      _scale.setScalar(s.scale);
      _rootMat.compose(_pos, _quat, _scale);

      // Per-archetype breathing & swaying torso transform
      const breath = Math.sin(t * 1.45);
      const sway = Math.sin(t * 0.72);
      const bodyY = 12 + breath * (sceneId === 'slime_catacombs' ? 2.8 : 2.4);
      const bodyRotZ = sceneId === 'inferno_caldera' ? 0 : sway * (sceneId === 'slime_catacombs' ? 0.08 : 0.045);
      const bodyRotX = sceneId === 'inferno_caldera' ? breath * 0.065 : 0;
      const squash = sceneId === 'slime_catacombs' ? Math.sin(t * 3.1) * 0.05 : breath * 0.03;

      _pos.set(0, bodyY, 0);
      _euler.set(bodyRotX, 0, bodyRotZ);
      _quat.setFromEuler(_euler);
      _scale.set(1 + squash, 1 - squash * 0.5, 1 + squash);
      _localMat.compose(_pos, _quat, _scale);
      _bodyMat.multiplyMatrices(_rootMat, _localMat);

      // Head nod & curious gaze
      _pos.set(0, 23.0, 1.0);
      _euler.set(0.05 + Math.sin(t * 1.8) * 0.09, Math.sin(t * 0.65) * 0.25, Math.sin(t * 1.1) * 0.04);
      _quat.setFromEuler(_euler);
      _scale.set(1, 1, 1);
      _localMat.compose(_pos, _quat, _scale);
      _headMat.multiplyMatrices(_bodyMat, _localMat);

      // Natural blinking eye scale
      const blinkCycle = t % 4.8;
      const eyeScaleY = blinkCycle > 4.65 ? 0.14 : 1.0;
      _pos.set(0, 0, 0);
      _quat.identity();
      _scale.set(1, eyeScaleY, 1);
      _localMat.compose(_pos, _quat, _scale);
      _eyeMat.multiplyMatrices(_headMat, _localMat);

      // Articulated Left & Right waving arms
      const shoulderX = sceneId === 'inferno_caldera' ? 14.0 : 13.4;
      _pos.set(-shoulderX, 11.6, 1.0);
      _euler.set(-0.55 + Math.sin(t * 1.5) * 0.4, 0, 0.44 + Math.cos(t * 1.5) * 0.34);
      _quat.setFromEuler(_euler);
      _scale.set(1, 1, 1);
      _localMat.compose(_pos, _quat, _scale);
      _leftArmMat.multiplyMatrices(_bodyMat, _localMat);

      _pos.set(shoulderX, 11.6, 1.0);
      _euler.set(-0.92 + Math.sin(t * 1.75 + 0.8) * 0.38, 0, -0.52 - Math.sin(t * 1.75 + 0.8) * 0.38);
      _quat.setFromEuler(_euler);
      _localMat.compose(_pos, _quat, _scale);
      _rightArmMat.multiplyMatrices(_bodyMat, _localMat);

      // Archetype special animated layer (flame crown, spinning chest gear, or flowing shadow cloak)
      if (sceneId === 'inferno_caldera') {
        _pos.set(0, 0, 0);
        _quat.identity();
        _scale.set(1, 1.02 + Math.sin(t * 7.2) * 0.18, 1);
        _localMat.compose(_pos, _quat, _scale);
        _specialMat.multiplyMatrices(_headMat, _localMat);
      } else if (sceneId === 'cyber_foundry') {
        _pos.set(-4.8, 9.2, 7.6);
        _euler.set(0, 0, gearAngle + s.phaseOffset);
        _quat.setFromEuler(_euler);
        _scale.set(1, 1, 1);
        _localMat.compose(_pos, _quat, _scale);
        _specialMat.multiplyMatrices(_bodyMat, _localMat);
      } else if (sceneId === 'void_gallery') {
        _pos.set(0, 14.2, -9.6);
        _euler.set(0.14 + Math.sin(t * 1.7) * 0.12, 0, 0);
        _quat.setFromEuler(_euler);
        _scale.set(1, 1, 1);
        _localMat.compose(_pos, _quat, _scale);
        _specialMat.multiplyMatrices(_bodyMat, _localMat);
      } else {
        _specialMat.copy(_bodyMat);
      }

      for (let l = 0; l < layers.length; l++) {
        const layer = layers[l];
        layer.mesh.setMatrixAt(i, boneMatrices[layer.bone]);
      }
    }

    for (let l = 0; l < layers.length; l++) {
      layers[l].mesh.instanceMatrix.needsUpdate = true;
    }
  };

  // Seed initial matrices immediately so frame 0 renders cleanly
  update(0, 0, 0);

  return {
    group,
    update,
    dispose: () => {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}
