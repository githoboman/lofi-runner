import * as THREE from 'three';
import { SEGMENT_COUNT, SEGMENT_LENGTH } from './config';
import type { InfernoAnimeController } from './infernoAnime';

const _dummy = new THREE.Object3D();
const _color = new THREE.Color();
const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3(1, 1, 1);
const _pivotPos = new THREE.Vector3();
const _localPos = new THREE.Vector3();
const _emberCoolColor = new THREE.Color(0x9a3412);
const _emberHotColor = new THREE.Color(0xfbbf24);
const _coreCoolColor = new THREE.Color(0xc2410c);
const _coreHotColor = new THREE.Color(0xfde047);

/**
 * Reusable zero-GC object pool handle for world environment segments.
 * Consolidates repeated architecture and animated props into batched InstancedMeshes
 * with ring-buffer Z recycling so draw calls stay minimal and frame pacing locks at 60 fps.
 */
export interface PooledWorldSystem {
  group: THREE.Group;
  hideOnSlide: THREE.Object3D[];
  update: (dt: number, dz: number, elapsed: number) => void;
  dispose: () => void;
}

/**
 * Recycles Z-translation values directly inside an InstancedMesh's Float32Array matrix buffer
 * with zero per-frame allocations.
 */
function scrollInstancedZ(
  mesh: THREE.InstancedMesh,
  dz: number,
  wrapFrontZ: number,
  totalLength: number,
): void {
  const arr = mesh.instanceMatrix.array as Float32Array;
  const count = mesh.count;
  for (let i = 0; i < count; i++) {
    const zIdx = i * 16 + 14;
    let z = arr[zIdx] + dz;
    if (z > wrapFrontZ) {
      z -= totalLength;
    }
    arr[zIdx] = z;
  }
  mesh.instanceMatrix.needsUpdate = true;
}

interface PendulumSlot {
  x: number;
  y: number;
  z: number;
  phase: number;
  freq: number;
  amp: number;
}

interface BrazierSlot {
  x: number;
  y: number;
  z: number;
}

/**
 * Pooled InstancedMesh system for World 2 (Ember Caldera): Lava Temple Ruins + Swinging Iron Chains.
 * Replaces ~189 individual chain/rune/cage Mesh draw calls with 13 pooled InstancedMesh draw calls
 * across all recycled segments, driven by anime.js choreography for braziers, ember runes & pendulums.
 */
export function createLavaTemplePool(
  totalLength: number,
  wrapFrontZ: number,
  animeCtrl?: InfernoAnimeController,
): PooledWorldSystem {
  const group = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const staticInstanced: THREE.InstancedMesh[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };

  // Carved temple bridge stone parapets + muted terracotta ember trim (batched into 2 InstancedMeshes)
  const basaltMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x2b1b15, roughness: 0.8, metalness: 0.2 }));
  const emberEdgeMat = trackMat(new THREE.MeshBasicMaterial({ color: 0xb45309 }));
  const centerZ = wrapFrontZ - totalLength / 2;

  const parapetWalls = new THREE.InstancedMesh(
    trackGeo(new THREE.BoxGeometry(1.5, 2.2, totalLength)),
    basaltMat,
    2,
  );
  parapetWalls.frustumCulled = false;
  const parapetEdges = new THREE.InstancedMesh(
    trackGeo(new THREE.BoxGeometry(0.18, 0.22, totalLength)),
    emberEdgeMat,
    2,
  );
  parapetEdges.frustumCulled = false;
  for (let s = 0; s < 2; s++) {
    const side = s === 0 ? -1 : 1;
    _dummy.position.set(side * 5.55, -0.75, centerZ);
    _dummy.rotation.set(0, 0, 0);
    _dummy.scale.set(1, 1, 1);
    _dummy.updateMatrix();
    parapetWalls.setMatrixAt(s, _dummy.matrix);

    _dummy.position.set(side * 4.88, 0.28, centerZ);
    _dummy.updateMatrix();
    parapetEdges.setMatrixAt(s, _dummy.matrix);
  }
  parapetWalls.instanceMatrix.needsUpdate = true;
  parapetEdges.instanceMatrix.needsUpdate = true;
  group.add(parapetWalls, parapetEdges);

  // Pooled Fluted Obsidian Temple Columns, Capitals, Plinths, Lintels, Braziers, Flames, Crags
  const colCount = SEGMENT_COUNT * 4;
  const sidePairCount = SEGMENT_COUNT * 2;
  const stoneMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.76, metalness: 0.22 }));

  const columns = new THREE.InstancedMesh(trackGeo(new THREE.CylinderGeometry(1.05, 1.48, 13.8, 10)), stoneMat, colCount);
  const capitals = new THREE.InstancedMesh(trackGeo(new THREE.CylinderGeometry(2.15, 1.25, 1.55, 8)), stoneMat, colCount);
  const plinths = new THREE.InstancedMesh(trackGeo(new THREE.BoxGeometry(3.8, 2.6, 3.8)), stoneMat, colCount);
  const lintels = new THREE.InstancedMesh(
    trackGeo(new THREE.BoxGeometry(9.2, 1.55, 2.35)),
    trackMat(new THREE.MeshStandardMaterial({ color: 0x35221b, roughness: 0.78, metalness: 0.18 })),
    sidePairCount,
  );
  const brazierBowls = new THREE.InstancedMesh(
    trackGeo(new THREE.CylinderGeometry(1.18, 0.62, 1.3, 8)),
    trackMat(new THREE.MeshStandardMaterial({ color: 0x261a16, roughness: 0.5, metalness: 0.72 })),
    colCount,
  );
  const flameTops = new THREE.InstancedMesh(
    trackGeo(new THREE.ConeGeometry(0.76, 2.35, 7)),
    trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xc2410c,
        emissive: 0xd97706,
        emissiveIntensity: 0.85,
        roughness: 0.4,
      }),
    ),
    colCount,
  );
  const crags = new THREE.InstancedMesh(
    trackGeo(new THREE.ConeGeometry(10.0, 23, 6)),
    trackMat(new THREE.MeshStandardMaterial({ color: 0x281812, roughness: 0.86 })),
    colCount,
  );

  // Pooled Forged Iron Chains (Overhead Span Chains, Flank Catenary Chains, Carved Rune Strips)
  const ironChainMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x4b423f,
      roughness: 0.38,
      metalness: 0.88,
    }),
  );
  const runeGlowMat = trackMat(new THREE.MeshBasicMaterial({ color: 0xb45309 }));
  const emberCoreMat = trackMat(new THREE.MeshBasicMaterial({ color: 0xd97706 }));

  const sideChainCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 11.4, -7.5),
    new THREE.Vector3(0.45, 7.6, 0),
    new THREE.Vector3(0, 11.4, 7.5),
  ]);
  const spanChainCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-9.6, 14.6, 0),
    new THREE.Vector3(-4.8, 12.6, 0),
    new THREE.Vector3(0, 12.0, 0),
    new THREE.Vector3(4.8, 12.6, 0),
    new THREE.Vector3(9.6, 14.6, 0),
  ]);

  const spanChains = new THREE.InstancedMesh(
    trackGeo(new THREE.TubeGeometry(spanChainCurve, 20, 0.24, 6, false)),
    ironChainMat,
    SEGMENT_COUNT,
  );
  const flankChains = new THREE.InstancedMesh(
    trackGeo(new THREE.TubeGeometry(sideChainCurve, 16, 0.25, 6, false)),
    ironChainMat,
    sidePairCount,
  );
  const runeStrips = new THREE.InstancedMesh(
    trackGeo(new THREE.BoxGeometry(0.24, 4.2, 0.85)),
    runeGlowMat,
    sidePairCount,
  );

  // Pooled Swinging Iron Pendulum Chains + Forged Ember Cages + Glowing Cores (3 InstancedMeshes total!)
  const LINKS_PER_PENDULUM = 8;
  const pendulumCount = sidePairCount;
  const pendulumLinks = new THREE.InstancedMesh(
    trackGeo(new THREE.TorusGeometry(0.24, 0.08, 6, 10)),
    ironChainMat,
    pendulumCount * LINKS_PER_PENDULUM,
  );
  pendulumLinks.frustumCulled = false;

  const pendulumCages = new THREE.InstancedMesh(
    trackGeo(new THREE.TorusGeometry(0.72, 0.1, 6, 10)),
    ironChainMat,
    pendulumCount * 2,
  );
  pendulumCages.frustumCulled = false;

  const pendulumCores = new THREE.InstancedMesh(
    trackGeo(new THREE.OctahedronGeometry(0.52, 0)),
    emberCoreMat,
    pendulumCount,
  );
  pendulumCores.frustumCulled = false;

  const pendulums: PendulumSlot[] = [];
  const braziers: BrazierSlot[] = [];
  const templeShades = [0x331f1c, 0x422620, 0x2b1a19, 0x4a2a21];

  let pIdx = 0;
  let pairIdx = 0;

  for (let seg = 0; seg < SEGMENT_COUNT; seg++) {
    const segZ = wrapFrontZ - seg * SEGMENT_LENGTH - SEGMENT_LENGTH * 0.5;

    // Overhead span chain
    _dummy.position.set(0, 0, segZ - 7.5);
    _dummy.rotation.set(0, 0, 0);
    _dummy.scale.set(1, 1, 1);
    _dummy.updateMatrix();
    spanChains.setMatrixAt(seg, _dummy.matrix);

    for (const side of [-1, 1]) {
      // Side catenary chain
      _dummy.position.set(side * 9.6, 0, segZ);
      _dummy.rotation.set(0, 0, 0);
      _dummy.scale.set(1, 1, 1);
      _dummy.updateMatrix();
      flankChains.setMatrixAt(pairIdx, _dummy.matrix);

      // Glowing fire-rune tablet on inner column face
      _dummy.position.set(side * 8.45, 6.4, segZ - 7.5);
      _dummy.updateMatrix();
      runeStrips.setMatrixAt(pairIdx, _dummy.matrix);

      // Slanted stone architrave lintel
      _dummy.position.set(side * 12.8, 13.8, segZ + 7.5);
      _dummy.rotation.set(0, 0, side * -0.08);
      _dummy.scale.set(1, 1, 1);
      _dummy.updateMatrix();
      lintels.setMatrixAt(pairIdx, _dummy.matrix);

      // Register swinging pendulum slot in ring pool
      pendulums.push({
        x: side * 12.2,
        y: 13.4,
        z: segZ + 7.5,
        phase: seg * 1.35 + (side > 0 ? 1.8 : 0),
        freq: 1.55 + (seg % 3) * 0.25,
        amp: 0.26 + (seg % 2) * 0.08,
      });
      pairIdx++;

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

        _dummy.position.set(side * 6.2, 1.15, z);
        _dummy.updateMatrix();
        brazierBowls.setMatrixAt(pIdx, _dummy.matrix);

        _dummy.position.set(side * 6.2, 2.75, z);
        _dummy.updateMatrix();
        flameTops.setMatrixAt(pIdx, _dummy.matrix);
        braziers.push({ x: side * 6.2, y: 2.75, z });

        _dummy.position.set(side * 38, 8.8 + (k % 2) * 5, z);
        _dummy.rotation.set(0, seg + k, 0);
        _dummy.scale.set(1.3, 1.4 + ((seg + k) % 2) * 0.4, 1.3);
        _dummy.updateMatrix();
        crags.setMatrixAt(pIdx, _dummy.matrix);
        pIdx++;
      }
    }
  }

  const allStatic = [
    columns,
    capitals,
    plinths,
    lintels,
    brazierBowls,
    crags,
    spanChains,
    flankChains,
    runeStrips,
  ];
  flameTops.frustumCulled = false;
  flameTops.instanceMatrix.needsUpdate = true;
  group.add(flameTops);
  for (const im of allStatic) {
    im.frustumCulled = false;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    group.add(im);
    staticInstanced.push(im);
  }

  group.add(pendulumLinks, pendulumCages, pendulumCores);

  const cageLocalY = -0.55 - LINKS_PER_PENDULUM * 0.42;
  const _linkQuat = new THREE.Quaternion();
  const _rot90Y = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);

  const flameMat = flameTops.material as THREE.MeshStandardMaterial;

  const updateBraziers = (dz: number) => {
    const slots = animeCtrl?.brazierSlots;
    const slotCount = slots ? slots.length : 0;
    for (let i = 0; i < braziers.length; i++) {
      const b = braziers[i];
      b.z += dz;
      if (b.z > wrapFrontZ) {
        b.z -= totalLength;
      }
      const anim = slotCount > 0 ? slots![i % slotCount] : null;
      const sy = anim ? anim.scaleY : 1;
      const sxz = anim ? anim.scaleXZ : 1;
      _pos.set(b.x, b.y + (sy - 1) * 0.92, b.z);
      _euler.set(anim ? anim.tiltX : 0, 0, anim ? anim.tiltZ : 0);
      _quat.setFromEuler(_euler);
      _scale.set(sxz, sy, sxz);
      _mat4.compose(_pos, _quat, _scale);
      flameTops.setMatrixAt(i, _mat4);
    }
    _scale.set(1, 1, 1);
    flameTops.instanceMatrix.needsUpdate = true;
  };

  const updatePendulums = (dz: number, elapsed: number) => {
    let linkIdx = 0;
    let cageIdx = 0;
    const windGust = animeCtrl ? animeCtrl.state.pendulumWindGust : 0;
    const swingBoost = animeCtrl ? animeCtrl.state.pendulumSwingBoost : 1;
    const cageHeatScale = animeCtrl ? animeCtrl.state.cageHeatScale : 1;

    for (let i = 0; i < pendulums.length; i++) {
      const p = pendulums[i];
      p.z += dz;
      if (p.z > wrapFrontZ) {
        p.z -= totalLength;
      }

      const rotZ = Math.sin(elapsed * p.freq + p.phase) * p.amp * swingBoost + windGust;
      const rotX = Math.cos(elapsed * p.freq * 0.72 + p.phase) * (p.amp * 0.35 * swingBoost);
      _euler.set(rotX, 0, rotZ);
      _quat.setFromEuler(_euler);
      _pivotPos.set(p.x, p.y, p.z);

      _scale.set(1, 1, 1);
      for (let ln = 0; ln < LINKS_PER_PENDULUM; ln++) {
        _localPos.set(0, -0.35 - ln * 0.42, 0).applyQuaternion(_quat).add(_pivotPos);
        if (ln % 2 === 0) {
          _mat4.compose(_localPos, _quat, _scale);
        } else {
          _linkQuat.copy(_quat).multiply(_rot90Y);
          _mat4.compose(_localPos, _linkQuat, _scale);
        }
        pendulumLinks.setMatrixAt(linkIdx++, _mat4);
      }

      _localPos.set(0, cageLocalY, 0).applyQuaternion(_quat).add(_pivotPos);
      _mat4.compose(_localPos, _quat, _scale);
      pendulumCages.setMatrixAt(cageIdx++, _mat4);

      _scale.setScalar(cageHeatScale);
      _mat4.compose(_localPos, _quat, _scale);
      pendulumCores.setMatrixAt(i, _mat4);

      _scale.set(1, 1, 1);
      _linkQuat.copy(_quat).multiply(_rot90Y);
      _mat4.compose(_localPos, _linkQuat, _scale);
      pendulumCages.setMatrixAt(cageIdx++, _mat4);
    }

    pendulumLinks.instanceMatrix.needsUpdate = true;
    pendulumCages.instanceMatrix.needsUpdate = true;
    pendulumCores.instanceMatrix.needsUpdate = true;
  };

  // Initialize brazier & pendulum matrices on frame 0
  updateBraziers(0);
  updatePendulums(0, 0);

  return {
    group,
    hideOnSlide: [parapetWalls, parapetEdges],
    update: (_dt, dz, elapsed) => {
      for (let i = 0; i < staticInstanced.length; i++) {
        scrollInstancedZ(staticInstanced[i], dz, wrapFrontZ, totalLength);
      }
      if (animeCtrl) {
        const pulse = animeCtrl.state.emberPulse;
        runeGlowMat.color.lerpColors(_emberCoolColor, _emberHotColor, pulse);
        emberEdgeMat.color.lerpColors(_emberCoolColor, _emberHotColor, pulse * 0.85);
        emberCoreMat.color.lerpColors(_coreCoolColor, _coreHotColor, pulse);
        flameMat.emissiveIntensity = 0.72 + pulse * 0.95;
      }
      updateBraziers(dz);
      updatePendulums(dz, elapsed);
    },
    dispose: () => {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}

/**
 * Pooled InstancedMesh system for World 3 (Ectoplasm Lab): Neon Sewer Segments & Flowing Slime.
 * Consolidates catwalk ledges, glowing hazard curbs, industrial rails, side manifold pipes,
 * open-top vaulted sewer ribs, flange collars, valve wheels, outfall nozzles, pouring slime streams,
 * and rising toxic bubbles into tightly pooled InstancedMeshes with zero-GC Z recycling.
 */
export function createNeonSewerPool(
  totalLength: number,
  wrapFrontZ: number,
  slimePourMat: THREE.Material,
): PooledWorldSystem {
  const group = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const staticInstanced: THREE.InstancedMesh[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };

  const centerZ = wrapFrontZ - totalLength / 2;

  // Batched catwalk ledges, restrained emerald curbs, rails & side manifold pipes (easy on the eyes!)
  const ledgeMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x1a2433, roughness: 0.72, metalness: 0.44 }));
  const railMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.34, metalness: 0.82 }));
  const limeGlowMat = trackMat(new THREE.MeshBasicMaterial({ color: 0x10b981 }));
  const neonPipeMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x115e46,
      emissive: 0x047857,
      emissiveIntensity: 0.32,
      roughness: 0.28,
      metalness: 0.38,
    }),
  );
  const steelPipeMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x263544, roughness: 0.36, metalness: 0.82 }));

  const catwalkLedges = new THREE.InstancedMesh(trackGeo(new THREE.BoxGeometry(1.7, 2.2, totalLength)), ledgeMat, 2);
  const catwalkCurbs = new THREE.InstancedMesh(trackGeo(new THREE.BoxGeometry(0.16, 0.18, totalLength)), limeGlowMat, 2);
  const catwalkRails = new THREE.InstancedMesh(trackGeo(new THREE.BoxGeometry(0.16, 0.2, totalLength)), railMat, 2);

  const pipeGeo = trackGeo(new THREE.CylinderGeometry(0.48, 0.48, totalLength, 10));
  pipeGeo.rotateX(Math.PI / 2);
  const neonPipes = new THREE.InstancedMesh(pipeGeo, neonPipeMat, 4);

  const bigPipeGeo = trackGeo(new THREE.CylinderGeometry(0.84, 0.84, totalLength, 10));
  bigPipeGeo.rotateX(Math.PI / 2);
  const steelPipes = new THREE.InstancedMesh(bigPipeGeo, steelPipeMat, 2);

  for (let s = 0; s < 2; s++) {
    const side = s === 0 ? -1 : 1;
    _dummy.rotation.set(0, 0, 0);
    _dummy.scale.set(1, 1, 1);

    _dummy.position.set(side * 5.65, -0.75, centerZ);
    _dummy.updateMatrix();
    catwalkLedges.setMatrixAt(s, _dummy.matrix);

    _dummy.position.set(side * 4.85, 0.25, centerZ);
    _dummy.updateMatrix();
    catwalkCurbs.setMatrixAt(s, _dummy.matrix);

    _dummy.position.set(side * 5.05, 1.05, centerZ);
    _dummy.updateMatrix();
    catwalkRails.setMatrixAt(s, _dummy.matrix);

    _dummy.position.set(side * 10.6, 2.5, centerZ);
    _dummy.updateMatrix();
    neonPipes.setMatrixAt(s * 2, _dummy.matrix);

    _dummy.position.set(side * 10.8, 7.1, centerZ);
    _dummy.updateMatrix();
    neonPipes.setMatrixAt(s * 2 + 1, _dummy.matrix);

    _dummy.position.set(side * 11.4, 4.8, centerZ);
    _dummy.updateMatrix();
    steelPipes.setMatrixAt(s, _dummy.matrix);
  }
  [catwalkLedges, catwalkCurbs, catwalkRails, neonPipes, steelPipes].forEach((im) => {
    im.frustumCulled = false;
    im.instanceMatrix.needsUpdate = true;
    group.add(im);
  });

  // Pooled Open-Top Vaulted Sewer Ribs, Neon Strips, Pipe Flanges, Valves, Nozzles & Slime Waterfalls
  const ribCount = SEGMENT_COUNT * 4;
  const sewerRibs = new THREE.InstancedMesh(
    trackGeo(new THREE.TorusGeometry(9.6, 0.62, 8, 12, Math.PI * 0.34)),
    trackMat(new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.58, metalness: 0.54 })),
    ribCount,
  );
  const sewerRibNeons = new THREE.InstancedMesh(
    trackGeo(new THREE.TorusGeometry(8.92, 0.14, 6, 12, Math.PI * 0.34)),
    trackMat(new THREE.MeshBasicMaterial({ color: 0x059669 })),
    ribCount,
  );
  const flangeRings = new THREE.InstancedMesh(
    trackGeo(new THREE.TorusGeometry(0.98, 0.16, 6, 12)),
    railMat,
    ribCount,
  );
  const valveWheels = new THREE.InstancedMesh(
    trackGeo(new THREE.TorusGeometry(0.58, 0.1, 6, 10)),
    trackMat(new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.36, metalness: 0.52 })),
    ribCount,
  );
  const nozzlePipes = new THREE.InstancedMesh(
    trackGeo(new THREE.CylinderGeometry(0.62, 0.68, 3.4, 10)),
    steelPipeMat,
    ribCount,
  );
  const nozzleLips = new THREE.InstancedMesh(
    trackGeo(new THREE.TorusGeometry(0.66, 0.14, 6, 10)),
    trackMat(new THREE.MeshBasicMaterial({ color: 0x10b981 })),
    ribCount,
  );

  const pourCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 6.2, 0),
    new THREE.Vector3(-0.95, 5.7, 0),
    new THREE.Vector3(-1.45, 3.1, 0),
    new THREE.Vector3(-1.55, -1.8, 0),
  ]);
  const slimePours = new THREE.InstancedMesh(
    trackGeo(new THREE.TubeGeometry(pourCurve, 14, 0.44, 8, false)),
    slimePourMat,
    ribCount,
  );

  let rIdx = 0;
  for (let seg = 0; seg < SEGMENT_COUNT; seg++) {
    const segZ = wrapFrontZ - seg * SEGMENT_LENGTH - SEGMENT_LENGTH * 0.5;
    for (let k = 0; k < 2; k++) {
      const z = segZ + (k === 0 ? -7.5 : 7.5);
      for (const side of [-1, 1]) {
        _dummy.position.set(side * 2.2, 0.2, z);
        _dummy.rotation.set(0, side > 0 ? 0 : Math.PI, 0);
        _dummy.scale.set(1, 1.05, 1);
        _dummy.updateMatrix();
        sewerRibs.setMatrixAt(rIdx, _dummy.matrix);
        sewerRibNeons.setMatrixAt(rIdx, _dummy.matrix);

        _dummy.position.set(side * 11.4, 4.8, z);
        _dummy.rotation.set(0, 0, 0);
        _dummy.scale.set(1, 1, 1);
        _dummy.updateMatrix();
        flangeRings.setMatrixAt(rIdx, _dummy.matrix);

        _dummy.position.set(side * 10.1, 4.8, z + 3.2);
        _dummy.rotation.set(0, Math.PI / 2, 0);
        _dummy.updateMatrix();
        valveWheels.setMatrixAt(rIdx, _dummy.matrix);

        _dummy.position.set(side * 9.8, 6.2, z + 3.5);
        _dummy.rotation.set(0, 0, Math.PI / 2);
        _dummy.updateMatrix();
        nozzlePipes.setMatrixAt(rIdx, _dummy.matrix);

        _dummy.position.set(side * 8.1, 6.2, z + 3.5);
        _dummy.rotation.set(0, Math.PI / 2, 0);
        _dummy.updateMatrix();
        nozzleLips.setMatrixAt(rIdx, _dummy.matrix);

        _dummy.position.set(side * 8.2, 0, z + 3.5);
        _dummy.rotation.set(0, side > 0 ? 0 : Math.PI, 0);
        _dummy.scale.set(1, 1, 1);
        _dummy.updateMatrix();
        slimePours.setMatrixAt(rIdx, _dummy.matrix);
        rIdx++;
      }
    }
  }

  const allStatic = [
    sewerRibs,
    sewerRibNeons,
    flangeRings,
    valveWheels,
    nozzlePipes,
    nozzleLips,
    slimePours,
  ];
  for (const im of allStatic) {
    im.frustumCulled = false;
    im.instanceMatrix.needsUpdate = true;
    group.add(im);
    staticInstanced.push(im);
  }

  return {
    group,
    hideOnSlide: [catwalkLedges, catwalkCurbs, catwalkRails],
    update: (_dt, dz) => {
      for (let i = 0; i < staticInstanced.length; i++) {
        scrollInstancedZ(staticInstanced[i], dz, wrapFrontZ, totalLength);
      }
    },
    dispose: () => {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}
