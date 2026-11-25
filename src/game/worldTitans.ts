import * as THREE from 'three';
import type { SceneId } from './types';

export interface WorldTitanHandle {
  group: THREE.Group;
  update: (elapsed: number, dt: number) => void;
}

export interface FlankingTitansHandle {
  group: THREE.Group;
  update: (elapsed: number, dt: number, dz: number) => void;
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

function addPart(
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  pos: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] = [1, 1, 1],
  rot: [number, number, number] = [0, 0, 0],
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(pos[0], pos[1], pos[2]);
  m.scale.set(scale[0], scale[1], scale[2]);
  m.rotation.set(rot[0], rot[1], rot[2]);
  parent.add(m);
  return m;
}

function buildSingleTitan(sceneId: SceneId): WorldTitanHandle {
  if (sceneId === 'frost_sanctuary') return buildOgLofiTitan();
  if (sceneId === 'inferno_caldera') return buildInfernoBlazeTitan();
  if (sceneId === 'slime_catacombs') return buildNeonSlimeTitan();
  if (sceneId === 'cyber_foundry') return buildHalfCyborgTitan();
  return buildVoidShadowTitan();
}

/**
 * Builds a monumental trio of THREE colossal, pure, character-faithful animated "Big Lofi" Titans
 * side-by-side on the horizon — zero rings/lines around them, larger scale, vivid breathing & waving!
 */
export function createWorldTitan(sceneId: SceneId): WorldTitanHandle {
  const trioRoot = new THREE.Group();

  const center = buildSingleTitan(sceneId);
  const left = buildSingleTitan(sceneId);
  const right = buildSingleTitan(sceneId);

  center.group.position.z = -122;
  center.group.scale.setScalar(1.12);

  left.group.position.x = -41;
  left.group.position.y -= 1.5;
  left.group.position.z = -128;
  left.group.scale.setScalar(0.94);
  left.group.rotation.y = 0.32;

  right.group.position.x = 41;
  right.group.position.y -= 1.5;
  right.group.position.z = -128;
  right.group.scale.setScalar(0.94);
  right.group.rotation.y = -0.32;

  trioRoot.add(left.group, center.group, right.group);

  return {
    group: trioRoot,
    update(elapsed: number, dt: number) {
      center.update(elapsed, dt);
      left.update(elapsed + 1.8, dt);
      right.update(elapsed + 3.6, dt);
    },
  };
}

/**
 * Builds colossal animated Flanking Trance Lofi Titans standing along BOTH Left & Right sides
 * of every running map — faithfully matching each world's Yeti character with zero lines/rings around them!
 */
export function createFlankingTranceTitans(
  sceneId: SceneId,
  totalLength: number,
  wrapFrontZ: number,
): FlankingTitansHandle {
  const root = new THREE.Group();
  const entries: { holder: THREE.Group; titan: WorldTitanHandle; phaseOffset: number }[] = [];

  const pairCount = 3;
  const spacing = totalLength / pairCount;
  const sideDist = sceneId === 'cyber_foundry' ? 28.5 : sceneId === 'slime_catacombs' ? 24.5 : 26.0;

  for (let i = 0; i < pairCount; i++) {
    const baseZ = wrapFrontZ - 26 - i * spacing;
    for (const side of [-1, 1]) {
      const titan = buildSingleTitan(sceneId);
      titan.group.position.set(0, 0, 0);

      const holder = new THREE.Group();
      const staggerZ = side > 0 ? -spacing * 0.36 : 0;
      holder.position.set(side * sideDist, 0.5, baseZ + staggerZ);
      holder.scale.setScalar(0.42);
      // Angled warmly inward toward the runner corridor so their faces & gestures shine clearly
      holder.rotation.y = side < 0 ? 1.04 : -1.04;
      holder.add(titan.group);
      root.add(holder);

      entries.push({
        holder,
        titan,
        phaseOffset: i * 1.7 + (side > 0 ? 0.9 : 0),
      });
    }
  }

  return {
    group: root,
    update(elapsed: number, dt: number, dz: number) {
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        e.holder.position.z += dz;
        if (e.holder.position.z > wrapFrontZ + 12) {
          e.holder.position.z -= totalLength;
        }
        e.titan.update(elapsed + e.phaseOffset, dt);
      }
    },
  };
}

// -----------------------------------------------------------------------------
// 1. OG LOFI TITAN — Faithful Giant Glacier Yeti (Clean, Alive, Blinking & Waving)
// -----------------------------------------------------------------------------
function buildOgLofiTitan(): WorldTitanHandle {
  const root = new THREE.Group();
  root.position.set(0, 2, -122);

  const fur = titanMat(0xf8fafc, { roughness: 0.65, emissive: 0x38bdf8, emissiveIntensity: 0.08 });
  const blueSkin = titanMat(0x5c9ce6, { roughness: 0.45, emissive: 0x1d4ed8, emissiveIntensity: 0.14 });
  const hornMat = titanMat(0x4b89d6, { roughness: 0.35, metalness: 0.15 });
  const muzzle = titanMat(0xdbe3ec, { roughness: 0.52 });
  const whiteEye = titanMat(0xffffff, { roughness: 0.2, emissive: 0xffffff, emissiveIntensity: 0.25 });
  const pupilMat = titanMat(0x0b0f19, { roughness: 0.2 });
  const goldMat = titanMat(0xfacc15, { roughness: 0.22, metalness: 0.85 });
  const chainMat = titanMat(0xbae6fd, { roughness: 0.2, metalness: 0.88 });

  const body = new THREE.Group();
  body.position.set(0, 12, 0);
  root.add(body);

  // Shaggy Yeti lower torso & breathing chest
  addPart(body, new THREE.SphereGeometry(10.8, 18, 14), fur, [0, -2.5, 0], [1.1, 0.94, 0.94]);
  const chest = addPart(body, new THREE.CapsuleGeometry(10.2, 5.5, 8, 18), fur, [0, 8.2, 0], [1.14, 1.0, 0.96]);

  // Fluffy collar fur tufts matching playable OG Lofi
  const tuftGeo = new THREE.ConeGeometry(3.2, 6.8, 7);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    addPart(
      body,
      tuftGeo,
      fur,
      [Math.sin(a) * 10.2, 15.2, Math.cos(a) * 8.8],
      [1, 1, 1],
      [Math.cos(a) * 0.45, 0, -Math.sin(a) * 0.45],
    );
  }

  // Iced SUI medallion resting cleanly on chest
  addPart(body, new THREE.TorusGeometry(6.8, 0.72, 8, 22), chainMat, [0, 12.2, 5.2], [1, 1, 1], [Math.PI * 0.42, 0, 0]);
  addPart(body, new THREE.CylinderGeometry(3.2, 3.2, 1.1, 16), chainMat, [0, 5.6, 10.6], [1, 1, 1], [Math.PI / 2, 0, 0]);

  // Faithful OG Lofi Head with spiky hair tufts, blue horns, ear flaps & expressive blinking eyes!
  const head = new THREE.Group();
  head.position.set(0, 22.8, 1.0);
  body.add(head);

  addPart(head, new THREE.DodecahedronGeometry(10.8, 2), fur, [0, 0, 0], [1.08, 1.0, 0.96]);
  const hairSpikes: [number, number, number, number][] = [
    [-4.2, 9.8, 1.0, 0.28],
    [-0.8, 11.2, 0.8, 0.06],
    [2.8, 10.5, 0.8, -0.18],
    [5.4, 9.0, 0.0, -0.35],
    [-8.2, 5.8, -1.2, 0.65],
    [8.2, 5.8, -1.2, -0.65],
  ];
  for (const [sx, sy, sz, rz] of hairSpikes) {
    addPart(head, tuftGeo, fur, [sx, sy, sz], [0.85, 0.95, 0.85], [0.1, 0, rz]);
  }

  const hornGeo = new THREE.ConeGeometry(1.9, 6.4, 10);
  addPart(head, hornGeo, hornMat, [-5.8, 10.4, 2.6], [1, 1, 1], [0.15, 0, 0.28]);
  addPart(head, hornGeo, hornMat, [5.8, 10.4, 2.6], [1, 1, 1], [0.15, 0, -0.28]);

  // Glacier-blue Ear Flaps with plush white fur tips
  const earGeo = new THREE.CapsuleGeometry(2.4, 4.8, 6, 10);
  addPart(head, earGeo, blueSkin, [-11.5, 0.4, 0], [0.72, 1.05, 0.72], [0, 0, 0.35]);
  addPart(head, new THREE.SphereGeometry(2.1, 10, 10), fur, [-13.2, -3.2, 0]);
  addPart(head, earGeo, blueSkin, [11.5, 0.4, 0], [0.72, 1.05, 0.72], [0, 0, -0.35]);
  addPart(head, new THREE.SphereGeometry(2.1, 10, 10), fur, [13.2, -3.2, 0]);

  // Iconic OG Lofi blue brow mask, muzzle, eyes, eyelids, nose & gold-tooth grin!
  addPart(head, new THREE.BoxGeometry(13.8, 6.2, 5.4), blueSkin, [0, 2.4, 8.2]);
  addPart(head, new THREE.SphereGeometry(7.6, 16, 14), muzzle, [0, -2.6, 7.4], [1.08, 0.76, 0.74]);

  const eyeGroup = new THREE.Group();
  head.add(eyeGroup);
  const eyeGeo = new THREE.SphereGeometry(2.7, 14, 12);
  addPart(eyeGroup, eyeGeo, whiteEye, [-3.4, 2.4, 10.2], [1.28, 0.78, 0.48]);
  addPart(eyeGroup, eyeGeo, whiteEye, [3.4, 2.4, 10.2], [1.28, 0.78, 0.48]);
  const pupilGeo = new THREE.SphereGeometry(1.55, 12, 10);
  addPart(eyeGroup, pupilGeo, pupilMat, [-3.2, 2.3, 11.4], [1, 0.9, 0.45]);
  addPart(eyeGroup, pupilGeo, pupilMat, [3.2, 2.3, 11.4], [1, 0.9, 0.45]);
  const glintGeo = new THREE.SphereGeometry(0.5, 8, 8);
  addPart(eyeGroup, glintGeo, whiteEye, [-2.5, 3.0, 12.1]);
  addPart(eyeGroup, glintGeo, whiteEye, [3.9, 3.0, 12.1]);

  const lidGeo = new THREE.BoxGeometry(6.8, 1.3, 3.0);
  addPart(head, lidGeo, blueSkin, [-3.4, 4.1, 10.2], [1, 1, 1], [0, 0, 0.06]);
  addPart(head, lidGeo, blueSkin, [3.4, 4.1, 10.2], [1, 1, 1], [0, 0, -0.06]);

  addPart(head, new THREE.SphereGeometry(1.8, 12, 10), blueSkin, [0, -0.3, 12.0], [1.25, 0.82, 0.78]);
  addPart(head, new THREE.CapsuleGeometry(1.5, 8.5, 8, 12), blueSkin, [0, -3.9, 11.4], [1, 1, 0.65], [0, 0, Math.PI / 2]);
  addPart(head, new THREE.BoxGeometry(1.45, 1.35, 1.1), goldMat, [1.6, -3.9, 12.3]);

  // Articulated Shoulder + Elbow Yeti Arms waving warmly!
  const leftShoulder = new THREE.Group();
  leftShoulder.position.set(-13.2, 11.5, 1.0);
  addPart(leftShoulder, new THREE.CapsuleGeometry(3.4, 6.2, 6, 12), fur, [-1.0, -4.4, 0]);
  const leftElbow = new THREE.Group();
  leftElbow.position.set(-1.4, -8.8, 0);
  addPart(leftElbow, new THREE.CapsuleGeometry(3.1, 5.6, 6, 12), fur, [0, -3.8, 0.8], [1, 1, 1], [0.22, 0, 0]);
  addPart(leftElbow, new THREE.SphereGeometry(3.8, 12, 12), blueSkin, [0, -8.2, 2.0], [1, 0.9, 1.15]);
  leftShoulder.add(leftElbow);
  body.add(leftShoulder);

  const rightShoulder = new THREE.Group();
  rightShoulder.position.set(13.2, 11.5, 1.0);
  addPart(rightShoulder, new THREE.CapsuleGeometry(3.4, 6.2, 6, 12), fur, [1.0, -4.4, 0]);
  const rightElbow = new THREE.Group();
  rightElbow.position.set(1.4, -8.8, 0);
  addPart(rightElbow, new THREE.CapsuleGeometry(3.1, 5.6, 6, 12), fur, [0, -3.8, 0.8], [1, 1, 1], [0.22, 0, 0]);
  addPart(rightElbow, new THREE.SphereGeometry(3.8, 12, 12), blueSkin, [0, -8.2, 2.0], [1, 0.9, 1.15]);
  rightShoulder.add(rightElbow);
  body.add(rightShoulder);

  return {
    group: root,
    update: (elapsed) => {
      const breath = Math.sin(elapsed * 1.4);
      const sway = Math.sin(elapsed * 0.7);
      body.position.y = 12 + breath * 2.4;
      body.rotation.z = sway * 0.045;
      chest.scale.set(1.14 + breath * 0.06, 1.0 + breath * 0.05, 0.96 + breath * 0.06);

      // Chill lofi head nod + curious look around + natural eye blink
      head.rotation.x = 0.06 + Math.sin(elapsed * 2.1) * 0.09;
      head.rotation.y = Math.sin(elapsed * 0.6) * 0.24;
      const blinkCycle = elapsed % 4.6;
      eyeGroup.scale.y = blinkCycle > 4.44 ? 0.12 : 1.0;

      // Expressive warm waving & relaxed lofi groove
      leftShoulder.rotation.set(-0.45 + Math.sin(elapsed * 1.35) * 0.35, 0, 0.42 + Math.sin(elapsed * 1.35) * 0.38);
      leftElbow.rotation.x = -0.55 - Math.cos(elapsed * 1.35) * 0.32;

      rightShoulder.rotation.set(-1.15 + Math.sin(elapsed * 1.8) * 0.28, 0, -0.58 - Math.sin(elapsed * 1.8) * 0.42);
      rightElbow.rotation.x = -0.85 + Math.sin(elapsed * 3.2) * 0.28;
    },
  };
}

// -----------------------------------------------------------------------------
// 2. INFERNO BLAZE TITAN — Faithful Giant Blazing Fire Yeti (Pure Alive Flames)
// -----------------------------------------------------------------------------
function buildInfernoBlazeTitan(): WorldTitanHandle {
  const root = new THREE.Group();
  root.position.set(0, 1, -122);

  const flameOrange = titanMat(0xf97316, { roughness: 0.48, emissive: 0xea580c, emissiveIntensity: 0.62 });
  const flameGold = titanMat(0xfacc15, { roughness: 0.35, emissive: 0xf59e0b, emissiveIntensity: 0.85 });
  const flameCore = titanMat(0xfef08a, { roughness: 0.25, emissive: 0xfde047, emissiveIntensity: 0.95 });
  const emberLimb = titanMat(0xea580c, { roughness: 0.55, emissive: 0x9a3412, emissiveIntensity: 0.42 });
  const teethMat = titanMat(0xfef9c3, { roughness: 0.3, emissive: 0xfef08a, emissiveIntensity: 0.3 });

  const body = new THREE.Group();
  body.position.set(0, 12, 0);
  root.add(body);

  addPart(body, new THREE.SphereGeometry(10.6, 16, 14), emberLimb, [0, -2.5, 0], [1.08, 0.94, 0.94]);
  const chest = addPart(body, new THREE.CapsuleGeometry(10.6, 5.8, 8, 16), flameOrange, [0, 8.2, 0], [1.18, 1.0, 0.96]);

  const flames: THREE.Mesh[] = [];
  const collarFlameGeo = new THREE.ConeGeometry(4.0, 11.5, 7);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const f = addPart(
      body,
      collarFlameGeo,
      i % 2 === 0 ? flameGold : flameOrange,
      [Math.sin(a) * 10.6, 15.8, Math.cos(a) * 8.6],
      [1, 1.15, 1],
      [0, a, -Math.sin(a) * 0.22],
    );
    flames.push(f);
  }

  // Faithful Inferno Blaze Head: fiery furrowed brows, blazing teeth grin, golden mustache, beard & 5-plume crown!
  const head = new THREE.Group();
  head.position.set(0, 23.2, 1.2);
  body.add(head);

  addPart(head, new THREE.DodecahedronGeometry(10.6, 2), flameOrange, [0, 0, 0], [1.08, 1.02, 0.96]);

  const crownGeo = new THREE.ConeGeometry(4.8, 17.5, 8);
  const crownSpecs: [number, number, number, number, number][] = [
    [0, 13.8, -0.4, 1.18, 0],
    [-5.4, 12.0, 0.8, 0.96, 0.24],
    [5.4, 12.0, 0.8, 0.96, -0.24],
    [-3.2, 12.6, -4.0, 1.06, 0.12],
    [3.2, 12.6, -4.0, 1.06, -0.12],
  ];
  for (const [x, y, z, s, rz] of crownSpecs) {
    const plume = addPart(head, crownGeo, flameGold, [x, y, z], [s, s * 1.15, s], [-0.12, 0, rz]);
    flames.push(plume);
  }

  // Flaming ear flaps
  addPart(head, new THREE.CapsuleGeometry(2.2, 4.4, 6, 8), flameOrange, [-11.4, 0.4, 0], [0.72, 1.0, 0.75], [0, 0, 0.34]);
  addPart(head, new THREE.CapsuleGeometry(2.2, 4.4, 6, 8), flameOrange, [11.4, 0.4, 0], [0.72, 1.0, 0.75], [0, 0, -0.34]);

  // Fierce brows, blazing grin, golden mustache & beard
  const browGeo = new THREE.BoxGeometry(5.8, 1.7, 2.8);
  addPart(head, browGeo, flameCore, [-3.4, 3.8, 10.0], [1, 1, 1], [0, 0, -0.24]);
  addPart(head, browGeo, flameCore, [3.4, 3.8, 10.0], [1, 1, 1], [0, 0, 0.24]);
  addPart(head, new THREE.BoxGeometry(11.6, 3.6, 3.8), teethMat, [0, -1.4, 9.8]);
  addPart(head, new THREE.CapsuleGeometry(1.0, 9.8, 6, 8), flameGold, [0, 0.6, 11.2], [1, 1, 0.7], [0, 0, Math.PI / 2]);
  addPart(head, new THREE.CapsuleGeometry(1.0, 9.8, 6, 8), flameGold, [0, -3.4, 11.2], [1, 1, 0.7], [0, 0, Math.PI / 2]);
  const stacheGeo = new THREE.ConeGeometry(2.4, 7.6, 7);
  addPart(head, stacheGeo, flameCore, [-4.8, -2.6, 10.6], [1, 1, 0.7], [0, 0, 1.25]);
  addPart(head, stacheGeo, flameCore, [4.8, -2.6, 10.6], [1, 1, 0.7], [0, 0, -1.25]);
  const beard = addPart(head, new THREE.ConeGeometry(4.5, 8.2, 7), flameGold, [0, -7.6, 8.0], [1.2, 1, 0.7], [Math.PI, 0, 0]);
  flames.push(beard);

  // Articulated Roaring Muscular Fire Arms flexing & rallying!
  const leftShoulder = new THREE.Group();
  leftShoulder.position.set(-14.0, 11.8, 1.0);
  addPart(leftShoulder, new THREE.CapsuleGeometry(3.6, 6.4, 6, 10), emberLimb, [-1.2, -4.5, 0]);
  const leftElbow = new THREE.Group();
  leftElbow.position.set(-1.6, -9.0, 0);
  addPart(leftElbow, new THREE.CapsuleGeometry(3.3, 5.8, 6, 10), flameOrange, [0, -4.0, 1.0], [1, 1, 1], [0.25, 0, 0]);
  addPart(leftElbow, new THREE.SphereGeometry(4.2, 12, 10), flameGold, [0, -8.6, 2.2]);
  leftShoulder.add(leftElbow);
  body.add(leftShoulder);

  const rightShoulder = new THREE.Group();
  rightShoulder.position.set(14.0, 11.8, 1.0);
  addPart(rightShoulder, new THREE.CapsuleGeometry(3.6, 6.4, 6, 10), emberLimb, [1.2, -4.5, 0]);
  const rightElbow = new THREE.Group();
  rightElbow.position.set(1.6, -9.0, 0);
  addPart(rightElbow, new THREE.CapsuleGeometry(3.3, 5.8, 6, 10), flameOrange, [0, -4.0, 1.0], [1, 1, 1], [0.25, 0, 0]);
  addPart(rightElbow, new THREE.SphereGeometry(4.2, 12, 10), flameGold, [0, -8.6, 2.2]);
  rightShoulder.add(rightElbow);
  body.add(rightShoulder);

  return {
    group: root,
    update: (elapsed) => {
      const heave = Math.sin(elapsed * 1.6);
      body.position.y = 12 + heave * 2.5;
      body.rotation.x = heave * 0.07;
      chest.scale.set(1.18 + heave * 0.08, 1.0 + heave * 0.06, 0.96 + heave * 0.08);
      head.rotation.x = -0.05 + Math.sin(elapsed * 1.6 - 0.5) * 0.12;
      head.rotation.y = Math.sin(elapsed * 0.72) * 0.24;

      // Expressive fiery flex & wave gestures
      leftShoulder.rotation.set(-0.78 + Math.sin(elapsed * 1.75) * 0.45, 0, 0.52 + Math.cos(elapsed * 1.75) * 0.3);
      leftElbow.rotation.x = -0.95 - Math.sin(elapsed * 1.75) * 0.35;
      rightShoulder.rotation.set(-0.78 + Math.sin(elapsed * 1.75 + 0.9) * 0.45, 0, -0.52 - Math.cos(elapsed * 1.75 + 0.9) * 0.3);
      rightElbow.rotation.x = -0.95 - Math.sin(elapsed * 1.75 + 0.9) * 0.35;

      for (let i = 0; i < flames.length; i++) {
        flames[i].scale.y = 1.02 + Math.sin(elapsed * 7.5 + i * 1.2) * 0.24;
      }
    },
  };
}

// -----------------------------------------------------------------------------
// 3. NEON SLIME TITAN — Faithful Giant Translucent Jelly Yeti with Glowing Inner Skeleton
// -----------------------------------------------------------------------------
function buildNeonSlimeTitan(): WorldTitanHandle {
  const root = new THREE.Group();
  root.position.set(0, 3, -122);

  const gelOuter = titanMat(0x4ade80, {
    roughness: 0.16,
    metalness: 0.08,
    emissive: 0x16a34a,
    emissiveIntensity: 0.52,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
  });
  const boneCore = titanMat(0xbef264, {
    roughness: 0.32,
    emissive: 0x4ade80,
    emissiveIntensity: 0.85,
  });
  const darkEye = titanMat(0x14532d, { roughness: 0.2 });

  const body = new THREE.Group();
  body.position.set(0, 12, 0);
  root.add(body);

  // Luminous lime inner spine & ribcage glowing cleanly through translucent slime!
  addPart(body, new THREE.CylinderGeometry(1.8, 1.8, 15, 10), boneCore, [0, 7.5, 0]);
  for (let r = 0; r < 3; r++) {
    addPart(body, new THREE.TorusGeometry(5.6 - r * 0.45, 0.95, 8, 18), boneCore, [0, 11.4 - r * 3.8, 0.4], [1.16, 0.85, 0.85], [Math.PI / 2, 0, 0]);
  }
  const jellyBelly = addPart(body, new THREE.SphereGeometry(10.6, 18, 14), gelOuter, [0, -2.0, 0], [1.1, 0.94, 0.96]);
  const jellyChest = addPart(body, new THREE.CapsuleGeometry(10.8, 6.2, 8, 18), gelOuter, [0, 8.2, 0], [1.14, 1.0, 0.98]);

  // Faithful Neon Slime Head: glowing skull, jaw, expressive eyes, lime horns, jelly outer dome & wobbly ear flaps
  const head = new THREE.Group();
  head.position.set(0, 23.0, 1.0);
  body.add(head);

  addPart(head, new THREE.SphereGeometry(7.2, 14, 12), boneCore, [0, 1.2, 0.4], [1.0, 0.95, 0.92]);
  addPart(head, new THREE.BoxGeometry(10.2, 3.6, 4.8), boneCore, [0, -3.2, 5.4]);

  const eyeGroup = new THREE.Group();
  head.add(eyeGroup);
  addPart(eyeGroup, new THREE.SphereGeometry(2.6, 12, 10), boneCore, [-3.2, 2.6, 8.0], [1.2, 0.74, 0.5]);
  addPart(eyeGroup, new THREE.SphereGeometry(2.6, 12, 10), boneCore, [3.2, 2.6, 8.0], [1.2, 0.74, 0.5]);
  addPart(eyeGroup, new THREE.SphereGeometry(1.25, 10, 10), darkEye, [-3.2, 2.4, 9.2], [1, 0.9, 0.5]);
  addPart(eyeGroup, new THREE.SphereGeometry(1.25, 10, 10), darkEye, [3.2, 2.4, 9.2], [1, 0.9, 0.5]);

  const jellyHead = addPart(head, new THREE.DodecahedronGeometry(11.2, 2), gelOuter, [0, 0.4, 0], [1.08, 1.02, 0.98]);

  const hornGeo = new THREE.ConeGeometry(1.8, 5.8, 8);
  addPart(head, hornGeo, boneCore, [-5.6, 10.6, 1.8], [1, 1, 1], [0.15, 0, 0.28]);
  addPart(head, hornGeo, boneCore, [5.6, 10.6, 1.8], [1, 1, 1], [0.15, 0, -0.28]);

  const earGeo = new THREE.CapsuleGeometry(2.4, 4.5, 6, 10);
  addPart(head, earGeo, gelOuter, [-11.8, 0.2, 0], [0.85, 1.05, 0.8], [0, 0, 0.4]);
  addPart(head, earGeo, gelOuter, [11.8, 0.2, 0], [0.85, 1.05, 0.8], [0, 0, -0.4]);

  // Articulated Jelly Arms with visible inner arm bones!
  const leftShoulder = new THREE.Group();
  leftShoulder.position.set(-13.6, 11.4, 1.0);
  addPart(leftShoulder, new THREE.CylinderGeometry(1.2, 1.2, 7.2, 8), boneCore, [-1.0, -4.4, 0]);
  addPart(leftShoulder, new THREE.CapsuleGeometry(3.4, 6.2, 6, 12), gelOuter, [-1.0, -4.4, 0]);
  const leftElbow = new THREE.Group();
  leftElbow.position.set(-1.4, -8.8, 0);
  addPart(leftElbow, new THREE.CapsuleGeometry(3.1, 5.6, 6, 12), gelOuter, [0, -3.8, 0.8], [1, 1, 1], [0.22, 0, 0]);
  addPart(leftElbow, new THREE.SphereGeometry(3.8, 12, 12), gelOuter, [0, -8.2, 2.0]);
  leftShoulder.add(leftElbow);
  body.add(leftShoulder);

  const rightShoulder = new THREE.Group();
  rightShoulder.position.set(13.6, 11.4, 1.0);
  addPart(rightShoulder, new THREE.CylinderGeometry(1.2, 1.2, 7.2, 8), boneCore, [1.0, -4.4, 0]);
  addPart(rightShoulder, new THREE.CapsuleGeometry(3.4, 6.2, 6, 12), gelOuter, [1.0, -4.4, 0]);
  const rightElbow = new THREE.Group();
  rightElbow.position.set(1.4, -8.8, 0);
  addPart(rightElbow, new THREE.CapsuleGeometry(3.1, 5.6, 6, 12), gelOuter, [0, -3.8, 0.8], [1, 1, 1], [0.22, 0, 0]);
  addPart(rightElbow, new THREE.SphereGeometry(3.8, 12, 12), gelOuter, [0, -8.2, 2.0]);
  rightShoulder.add(rightElbow);
  body.add(rightShoulder);

  return {
    group: root,
    update: (elapsed) => {
      const pulse = Math.sin(elapsed * 1.65);
      const wobble = Math.sin(elapsed * 3.1) * 0.08;
      body.position.y = 12 + pulse * 2.8;
      body.rotation.z = Math.sin(elapsed * 0.95) * 0.09;

      jellyBelly.scale.set(1.1 + wobble, 0.94 - wobble, 0.96 + wobble * 0.5);
      jellyChest.scale.set(1.14 - wobble * 0.8, 1.0 + wobble, 0.98);
      jellyHead.scale.set(1.08 + wobble * 0.8, 1.02 - wobble * 0.8, 0.98);

      head.rotation.y = Math.sin(elapsed * 0.78) * 0.24;
      head.rotation.z = Math.sin(elapsed * 1.3) * 0.09;
      const blinkCycle = elapsed % 5.1;
      eyeGroup.scale.y = blinkCycle > 4.95 ? 0.14 : 1.0;

      // Buoyant undulating jelly wave!
      leftShoulder.rotation.set(-0.5 + Math.sin(elapsed * 1.85) * 0.42, 0, 0.48 + Math.cos(elapsed * 1.85) * 0.42);
      leftElbow.rotation.x = -0.5 + Math.sin(elapsed * 1.85 - 0.8) * 0.35;
      rightShoulder.rotation.set(-0.5 + Math.sin(elapsed * 1.85 + 1.0) * 0.42, 0, -0.48 - Math.cos(elapsed * 1.85 + 1.0) * 0.42);
      rightElbow.rotation.x = -0.5 + Math.sin(elapsed * 1.85 + 0.2) * 0.35;
    },
  };
}

// -----------------------------------------------------------------------------
// 4. HALF-CYBORG TITAN — Faithful Giant 50/50 Organic Yeti & Sleek Mecha Cyborg
// -----------------------------------------------------------------------------
function buildHalfCyborgTitan(): WorldTitanHandle {
  const root = new THREE.Group();
  root.position.set(0, 2, -122);

  const fur = titanMat(0xf8fafc, { roughness: 0.62, emissive: 0x38bdf8, emissiveIntensity: 0.06 });
  const blueSkin = titanMat(0x5c9ce6, { roughness: 0.45, emissive: 0x2563eb, emissiveIntensity: 0.1 });
  const muzzle = titanMat(0xdbe3ec, { roughness: 0.5 });
  const mechaWhite = titanMat(0xe2e8f0, { roughness: 0.32, metalness: 0.48 });
  const darkChassis = titanMat(0x1e293b, { roughness: 0.38, metalness: 0.72 });
  const chrome = titanMat(0x94a3b8, { roughness: 0.2, metalness: 0.92 });
  const opticCyan = titanMat(0x38bdf8, { roughness: 0.18, emissive: 0x38bdf8, emissiveIntensity: 1.15 });
  const whiteEye = titanMat(0xffffff, { roughness: 0.2, emissive: 0xffffff, emissiveIntensity: 0.2 });
  const pupilMat = titanMat(0x0b0f19, { roughness: 0.2 });

  const body = new THREE.Group();
  body.position.set(0, 12, 0);
  root.add(body);

  // Faithful 50/50 Split Torso: Right Organic Yeti Fur + Left Sleek Mecha Armor & Embedded Chest Gear
  addPart(body, new THREE.SphereGeometry(10.0, 16, 14), fur, [1.4, -2.2, 0], [0.95, 0.9, 0.92]);
  addPart(body, new THREE.BoxGeometry(11.4, 15.8, 15.4), fur, [5.4, 8.2, 0]);
  addPart(body, new THREE.BoxGeometry(10.8, 15.0, 14.2), darkChassis, [-5.2, 8.2, 0]);
  addPart(body, new THREE.BoxGeometry(11.2, 2.8, 15.4), mechaWhite, [-5.3, 14.6, 0]);
  addPart(body, new THREE.BoxGeometry(10.6, 2.6, 14.8), mechaWhite, [-5.2, 4.0, 0]);

  // Embedded spinning mechanical chrome gears directly on chest & left shoulder (no floating background rings!)
  const gearGeo = new THREE.CylinderGeometry(4.0, 4.0, 1.6, 10);
  gearGeo.rotateX(Math.PI / 2);
  const chestGear = addPart(body, gearGeo, chrome, [-4.8, 9.2, 7.6]);

  // Faithful Half-Cyborg Head: Right Organic Yeti face + Left Mecha Armor & Cyan Optic Eye!
  const head = new THREE.Group();
  head.position.set(0, 23.0, 1.0);
  body.add(head);

  addPart(head, new THREE.BoxGeometry(10.6, 16.8, 16.4), fur, [5.1, 0, 0]);
  addPart(head, new THREE.BoxGeometry(10.2, 16.0, 15.4), mechaWhite, [-4.9, 0, 0]);

  // Right organic side
  addPart(head, new THREE.BoxGeometry(7.2, 6.2, 4.8), blueSkin, [3.6, 2.4, 8.0]);
  addPart(head, new THREE.BoxGeometry(7.2, 5.8, 4.4), muzzle, [3.6, -3.1, 7.5]);
  const orgEye = new THREE.Group();
  head.add(orgEye);
  addPart(orgEye, new THREE.SphereGeometry(2.55, 12, 10), whiteEye, [3.6, 2.4, 9.9], [1.2, 0.78, 0.48]);
  addPart(orgEye, new THREE.SphereGeometry(1.5, 10, 10), pupilMat, [3.6, 2.3, 11.1], [1, 0.9, 0.45]);
  addPart(head, new THREE.CapsuleGeometry(1.3, 4.5, 6, 8), blueSkin, [3.6, -3.6, 10.2], [1, 1, 0.65], [0, 0, Math.PI / 2]);
  addPart(head, new THREE.ConeGeometry(1.8, 6.2, 8), blueSkin, [5.8, 10.2, 2.2], [1, 1, 1], [0.15, 0, -0.26]);
  addPart(head, new THREE.CapsuleGeometry(2.2, 4.4, 6, 8), blueSkin, [11.8, 0.2, 0], [0.7, 1.0, 0.72], [0, 0, -0.35]);

  // Left cybernetic side (chrome bezel + glowing cyan optic lens + mecha ear antenna)
  addPart(head, new THREE.CylinderGeometry(3.6, 3.6, 3.2, 16), chrome, [-3.8, 2.4, 8.0], [1, 1, 1], [Math.PI / 2, 0, 0]);
  addPart(head, new THREE.CylinderGeometry(2.0, 2.0, 3.6, 14), opticCyan, [-3.8, 2.4, 8.4], [1, 1, 1], [Math.PI / 2, 0, 0]);
  addPart(head, new THREE.CapsuleGeometry(1.2, 4.4, 6, 8), mechaWhite, [-3.6, -3.6, 9.8], [1, 1, 0.7], [0, 0, Math.PI / 2]);
  addPart(head, new THREE.CylinderGeometry(0.55, 0.55, 5.8, 8), opticCyan, [-11.4, 4.6, 0], [1, 1, 1], [0, 0, 0.22]);

  // Asymmetric Articulated Arms: Left Mecha Piston Arm + Right Organic Yeti Arm!
  const leftShoulder = new THREE.Group();
  leftShoulder.position.set(-13.6, 11.8, 1.0);
  const shoulderGear = addPart(leftShoulder, gearGeo, chrome, [-1.8, 1.2, 3.2], [0.9, 0.9, 0.9]);
  addPart(leftShoulder, new THREE.CylinderGeometry(2.9, 2.5, 8.6, 10), mechaWhite, [-0.8, -4.4, 0]);
  const leftElbow = new THREE.Group();
  leftElbow.position.set(-1.0, -8.8, 0);
  addPart(leftElbow, new THREE.CylinderGeometry(2.4, 2.2, 7.6, 10), chrome, [0, -3.8, 0.8], [1, 1, 1], [0.22, 0, 0]);
  addPart(leftElbow, new THREE.BoxGeometry(4.8, 4.4, 5.6), mechaWhite, [0, -8.2, 2.0]);
  leftShoulder.add(leftElbow);
  body.add(leftShoulder);

  const rightShoulder = new THREE.Group();
  rightShoulder.position.set(13.6, 11.8, 1.0);
  addPart(rightShoulder, new THREE.CapsuleGeometry(3.4, 6.2, 6, 12), fur, [1.0, -4.4, 0]);
  const rightElbow = new THREE.Group();
  rightElbow.position.set(1.4, -8.8, 0);
  addPart(rightElbow, new THREE.CapsuleGeometry(3.1, 5.6, 6, 12), fur, [0, -3.8, 0.8], [1, 1, 1], [0.22, 0, 0]);
  addPart(rightElbow, new THREE.SphereGeometry(3.8, 12, 12), blueSkin, [0, -8.2, 2.0], [1, 0.9, 1.15]);
  rightShoulder.add(rightElbow);
  body.add(rightShoulder);

  return {
    group: root,
    update: (elapsed, dt) => {
      chestGear.rotation.z += dt * 1.6;
      shoulderGear.rotation.z -= dt * 2.1;

      const breath = Math.sin(elapsed * 1.45);
      body.position.y = 12 + breath * 2.0;

      // Crisp cyber diagnostic head scan + organic blink
      head.rotation.y = Math.sin(elapsed * 0.72) * 0.34;
      head.rotation.x = 0.04 + breath * 0.07;
      const blinkCycle = elapsed % 4.9;
      orgEye.scale.y = blinkCycle > 4.76 ? 0.12 : 1.0;

      // Left mecha arm calibrates cleanly; right organic arm waves naturally
      leftShoulder.rotation.set(-0.68 + Math.sin(elapsed * 1.5) * 0.38, 0, 0.34 + Math.cos(elapsed * 1.5) * 0.2);
      leftElbow.rotation.x = -0.88 + Math.sin(elapsed * 2.4) * 0.28;

      rightShoulder.rotation.set(-0.55 + Math.sin(elapsed * 1.45 + 0.8) * 0.38, 0, -0.44 - Math.sin(elapsed * 1.45 + 0.8) * 0.36);
      rightElbow.rotation.x = -0.62 - Math.cos(elapsed * 1.45) * 0.28;
    },
  };
}

// -----------------------------------------------------------------------------
// 5. VOID SHADOW TITAN — Faithful Giant Stealth Shadow Yeti (Zero Rings/Energons!)
// -----------------------------------------------------------------------------
function buildVoidShadowTitan(): WorldTitanHandle {
  const root = new THREE.Group();
  root.position.set(0, 2, -122);

  const obsidianFur = titanMat(0x1b182e, { roughness: 0.62, emissive: 0x3b0764, emissiveIntensity: 0.14 });
  const charcoalFur = titanMat(0x2f2c47, { roughness: 0.56, emissive: 0x312e81, emissiveIntensity: 0.12 });
  const slateSkin = titanMat(0x4b5170, { roughness: 0.45 });
  const muzzleDark = titanMat(0x32354f, { roughness: 0.52 });
  const hornObsidian = titanMat(0x231f38, { roughness: 0.35, metalness: 0.25 });
  const scarfMat = titanMat(0x4c2982, { roughness: 0.52, emissive: 0x4c1d95, emissiveIntensity: 0.18 });
  const capeMat = titanMat(0x201b36, { roughness: 0.64 });
  const eyeViolet = titanMat(0xe9d5ff, { roughness: 0.2, emissive: 0xa855f7, emissiveIntensity: 1.0 });
  const pupilDark = titanMat(0x1e1b4b, { roughness: 0.2 });

  const body = new THREE.Group();
  body.position.set(0, 12, 0);
  root.add(body);

  // Faithful Stealth Shadow Yeti shaggy torso + layered ninja collar & flowing cape
  addPart(body, new THREE.SphereGeometry(10.6, 18, 14), obsidianFur, [0, -2.5, 0], [1.08, 0.94, 0.94]);
  const chest = addPart(body, new THREE.CapsuleGeometry(10.2, 5.5, 8, 18), obsidianFur, [0, 8.2, 0], [1.14, 1.0, 0.96]);

  addPart(body, new THREE.TorusGeometry(9.0, 2.4, 8, 18), scarfMat, [0, 14.8, 0.4], [1.08, 0.95, 1.0], [Math.PI * 0.48, 0, 0]);
  const tuftGeo = new THREE.ConeGeometry(3.0, 6.4, 7);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    addPart(
      body,
      tuftGeo,
      charcoalFur,
      [Math.sin(a) * 10.2, 13.8, Math.cos(a) * 8.6],
      [1, 0.95, 1],
      [Math.cos(a) * 0.45, 0, -Math.sin(a) * 0.45],
    );
  }

  // Flowing dark shadow cloak behind shoulders (sways organically with breathing!)
  const cloakPivot = new THREE.Group();
  cloakPivot.position.set(0, 14.2, -9.6);
  addPart(cloakPivot, new THREE.BoxGeometry(22.5, 22.0, 1.8), capeMat, [0, -11.0, -1.0]);
  body.add(cloakPivot);

  // Faithful Stealth Shadow Yeti Head: shaggy fur crown, curved obsidian horns, focused pale-violet eyes!
  const head = new THREE.Group();
  head.position.set(0, 22.8, 1.0);
  body.add(head);

  addPart(head, new THREE.DodecahedronGeometry(10.8, 2), obsidianFur, [0, 0, 0], [1.08, 1.0, 0.96]);
  const hairSpikes: [number, number, number, number][] = [
    [-4.4, 10.0, 0.8, 0.32],
    [-0.6, 11.4, 0.6, 0.05],
    [3.0, 10.6, 0.8, -0.22],
    [5.6, 9.0, 0.0, -0.38],
    [-8.2, 6.0, -1.0, 0.68],
    [8.2, 6.0, -1.0, -0.68],
  ];
  for (const [sx, sy, sz, rz] of hairSpikes) {
    addPart(head, tuftGeo, charcoalFur, [sx, sy, sz], [0.88, 1.02, 0.88], [0.1, 0, rz]);
  }

  const hornGeo = new THREE.ConeGeometry(1.9, 7.0, 8);
  addPart(head, hornGeo, hornObsidian, [-5.8, 10.8, 2.2], [1, 1, 1], [0.18, 0, 0.3]);
  addPart(head, hornGeo, hornObsidian, [5.8, 10.8, 2.2], [1, 1, 1], [0.18, 0, -0.3]);

  const earGeo = new THREE.CapsuleGeometry(2.2, 4.8, 6, 10);
  addPart(head, earGeo, slateSkin, [-11.4, 0.4, 0], [0.7, 1.05, 0.72], [0, 0, 0.38]);
  addPart(head, earGeo, slateSkin, [11.4, 0.4, 0], [0.7, 1.05, 0.72], [0, 0, -0.38]);

  addPart(head, new THREE.BoxGeometry(13.8, 6.2, 5.4), slateSkin, [0, 2.4, 8.2]);
  addPart(head, new THREE.SphereGeometry(7.6, 16, 14), muzzleDark, [0, -2.6, 7.4], [1.08, 0.76, 0.74]);

  const eyeGroup = new THREE.Group();
  head.add(eyeGroup);
  const eyeGeo = new THREE.SphereGeometry(2.6, 12, 10);
  addPart(eyeGroup, eyeGeo, eyeViolet, [-3.4, 2.4, 10.2], [1.26, 0.64, 0.46], [0, 0, -0.1]);
  addPart(eyeGroup, eyeGeo, eyeViolet, [3.4, 2.4, 10.2], [1.26, 0.64, 0.46], [0, 0, 0.1]);
  addPart(eyeGroup, new THREE.SphereGeometry(1.25, 10, 10), pupilDark, [-3.2, 2.3, 11.4], [1, 0.9, 0.45]);
  addPart(eyeGroup, new THREE.SphereGeometry(1.25, 10, 10), pupilDark, [3.2, 2.3, 11.4], [1, 0.9, 0.45]);

  const browGeo = new THREE.BoxGeometry(6.2, 1.35, 3.0);
  addPart(head, browGeo, obsidianFur, [-3.4, 4.2, 10.2], [1, 1, 1], [0, 0, -0.16]);
  addPart(head, browGeo, obsidianFur, [3.4, 4.2, 10.2], [1, 1, 1], [0, 0, 0.16]);
  addPart(head, new THREE.SphereGeometry(1.7, 10, 8), slateSkin, [0, -0.3, 12.0], [1.2, 0.8, 0.75]);
  addPart(head, new THREE.CapsuleGeometry(1.25, 7.6, 6, 10), slateSkin, [0, -3.8, 11.4], [1, 1, 0.65], [0, 0, Math.PI / 2]);

  // Articulated Stealth Shadow Yeti Arms (NO floating crescents, NO glowing orbs!)
  const leftShoulder = new THREE.Group();
  leftShoulder.position.set(-13.2, 11.5, 1.0);
  addPart(leftShoulder, new THREE.CapsuleGeometry(3.4, 6.2, 6, 12), obsidianFur, [-1.0, -4.4, 0]);
  const leftElbow = new THREE.Group();
  leftElbow.position.set(-1.4, -8.8, 0);
  addPart(leftElbow, new THREE.CapsuleGeometry(3.1, 5.6, 6, 12), charcoalFur, [0, -3.8, 0.8], [1, 1, 1], [0.22, 0, 0]);
  addPart(leftElbow, new THREE.SphereGeometry(3.8, 12, 12), slateSkin, [0, -8.2, 2.0], [1, 0.9, 1.15]);
  leftShoulder.add(leftElbow);
  body.add(leftShoulder);

  const rightShoulder = new THREE.Group();
  rightShoulder.position.set(13.2, 11.5, 1.0);
  addPart(rightShoulder, new THREE.CapsuleGeometry(3.4, 6.2, 6, 12), obsidianFur, [1.0, -4.4, 0]);
  const rightElbow = new THREE.Group();
  rightElbow.position.set(1.4, -8.8, 0);
  addPart(rightElbow, new THREE.CapsuleGeometry(3.1, 5.6, 6, 12), charcoalFur, [0, -3.8, 0.8], [1, 1, 1], [0.22, 0, 0]);
  addPart(rightElbow, new THREE.SphereGeometry(3.8, 12, 12), slateSkin, [0, -8.2, 2.0], [1, 0.9, 1.15]);
  rightShoulder.add(rightElbow);
  body.add(rightShoulder);

  return {
    group: root,
    update: (elapsed) => {
      const hover = Math.sin(elapsed * 1.3);
      body.position.y = 12 + hover * 2.8;
      chest.scale.set(1.14 + hover * 0.05, 1.0 + hover * 0.04, 0.96 + hover * 0.05);
      cloakPivot.rotation.x = 0.14 + Math.sin(elapsed * 1.7) * 0.12;

      head.rotation.y = Math.sin(elapsed * 0.65) * 0.24;
      head.rotation.x = 0.05 + hover * 0.08;
      const blinkCycle = elapsed % 5.4;
      eyeGroup.scale.y = blinkCycle > 5.26 ? 0.12 : 1.0;

      leftShoulder.rotation.set(-0.48 + Math.sin(elapsed * 1.45) * 0.38, 0, 0.44 + Math.cos(elapsed * 1.45) * 0.34);
      leftElbow.rotation.x = -0.68 - Math.sin(elapsed * 1.45) * 0.28;
      rightShoulder.rotation.set(-0.48 + Math.sin(elapsed * 1.45 + 0.8) * 0.38, 0, -0.44 - Math.cos(elapsed * 1.45 + 0.8) * 0.34);
      rightElbow.rotation.x = -0.68 - Math.sin(elapsed * 1.45 + 0.8) * 0.28;
    },
  };
}
