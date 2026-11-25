import * as THREE from 'three';
import type { CharacterId } from './types';

export interface SignatureSwordRig {
  group: THREE.Group;
  baseSocket: THREE.Object3D;
  tipSocket: THREE.Object3D;
  animatedParts: THREE.Object3D[];
  trailColor: number;
  trailTipColor: number;
}

/**
 * Helper to create a beveled 2D extruded blade silhouette along +Y from y=0 to bladeLen.
 */
function createExtrudedBladeGeometry(
  points: [number, number][],
  depth = 0.04,
  bevelSize = 0.014,
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    shape.lineTo(points[i][0], points[i][1]);
  }
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSize,
    bevelThickness: bevelSize,
    bevelSegments: 2,
  });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

/**
 * Builds 5 unmistakable, sculpted multi-part signature 3D swords — one bespoke blade per Lofi Yeti!
 * Each sword exposes world-trackable `baseSocket` and `tipSocket` transforms for live 3D ribbon trails.
 */
export function buildSignatureSword(
  charId: CharacterId,
  toonGradient: THREE.DataTexture,
  inkOutlineMat: THREE.MeshBasicMaterial,
): SignatureSwordRig {
  const group = new THREE.Group();
  const animatedParts: THREE.Object3D[] = [];

  const toon = (color: number, emissive = 0x000000, emissiveIntensity = 0) =>
    new THREE.MeshToonMaterial({
      color,
      gradientMap: toonGradient,
      emissive,
      emissiveIntensity,
    });

  const metal = (color: number, roughness = 0.24, metalness = 0.88) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness });

  const addPart = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    pos: [number, number, number] = [0, 0, 0],
    rot: [number, number, number] = [0, 0, 0],
    scale: [number, number, number] = [1, 1, 1],
    outline = true,
  ): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(pos[0], pos[1], pos[2]);
    m.rotation.set(rot[0], rot[1], rot[2]);
    m.scale.set(scale[0], scale[1], scale[2]);
    if (outline) {
      const o = new THREE.Mesh(geo, inkOutlineMat);
      o.scale.setScalar(1.06);
      m.add(o);
    }
    group.add(m);
    return m;
  };

  let tipY = 2.05;
  let trailColor = 0x38bdf8;
  let trailTipColor = 0xe0f2fe;

  if (charId === 'og_lofi') {
    // 1. OG LOFI — GLACIER FROSTBLADE (Faceted crystal-ice broadblade + snow-steel guard + SUI gem pommel)
    const gripMat = toon(0x1e3a8a);
    const guardMat = metal(0xe2e8f0, 0.2, 0.85);
    const iceBladeMat = new THREE.MeshStandardMaterial({
      color: 0x7dd3fc,
      emissive: 0x0ea5e9,
      emissiveIntensity: 1.05,
      roughness: 0.1,
      metalness: 0.25,
    });
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xf0f9ff });

    addPart(new THREE.CylinderGeometry(0.055, 0.062, 0.44, 8), gripMat, [0, -0.14, 0]);
    // SUI Ice Crystal Pommel
    addPart(new THREE.OctahedronGeometry(0.11, 0), coreMat, [0, -0.4, 0], [0, 0, 0], [0.9, 1.3, 0.9], false);
    // Winged snow-steel crossguard
    addPart(new THREE.BoxGeometry(0.66, 0.12, 0.16), guardMat, [0, 0.1, 0]);
    addPart(new THREE.ConeGeometry(0.08, 0.26, 5), iceBladeMat, [-0.36, 0.18, 0], [0, 0, 0.55], [1, 1, 1], false);
    addPart(new THREE.ConeGeometry(0.08, 0.26, 5), iceBladeMat, [0.36, 0.18, 0], [0, 0, -0.55], [1, 1, 1], false);

    // Sculpted faceted glacier crystal broadblade
    const bladeGeo = createExtrudedBladeGeometry([
      [-0.12, 0.14],
      [-0.17, 0.55],
      [-0.13, 1.55],
      [0, 2.05],
      [0.13, 1.55],
      [0.17, 0.55],
      [0.12, 0.14],
    ]);
    addPart(bladeGeo, iceBladeMat, [0, 0, 0]);
    addPart(new THREE.BoxGeometry(0.05, 1.48, 0.09), coreMat, [0, 0.95, 0], [0, 0, 0], [1, 1, 1], false);

    tipY = 2.08;
    trailColor = 0x38bdf8;
    trailTipColor = 0xffffff;
  } else if (charId === 'inferno_blaze') {
    // 2. INFERNO BLAZE — SOLAR MAGMA GREATSWORD (Serrated obsidian-and-lava fuller blade + horned guard)
    const gripMat = toon(0x450a0a);
    const obsidianMat = metal(0x1f1414, 0.35, 0.72);
    const lavaCoreMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
    const emberEdgeMat = new THREE.MeshStandardMaterial({
      color: 0xf97316,
      emissive: 0xea580c,
      emissiveIntensity: 1.55,
      roughness: 0.18,
    });

    addPart(new THREE.CylinderGeometry(0.06, 0.07, 0.48, 8), gripMat, [0, -0.16, 0]);
    addPart(new THREE.OctahedronGeometry(0.12, 0), emberEdgeMat, [0, -0.44, 0], [0, 0, 0], [1, 1.2, 1], false);
    // Horned volcanic guard
    addPart(new THREE.BoxGeometry(0.76, 0.16, 0.2), obsidianMat, [0, 0.1, 0]);
    addPart(new THREE.ConeGeometry(0.09, 0.36, 5), emberEdgeMat, [-0.42, 0.24, 0], [0, 0, 0.45]);
    addPart(new THREE.ConeGeometry(0.09, 0.36, 5), emberEdgeMat, [0.42, 0.24, 0], [0, 0, -0.45]);

    // Heavy jagged greatsword blade silhouette
    const bladeGeo = createExtrudedBladeGeometry([
      [-0.16, 0.16],
      [-0.22, 0.72],
      [-0.14, 0.88],
      [-0.24, 1.48],
      [-0.14, 1.62],
      [0, 2.28],
      [0.14, 1.62],
      [0.24, 1.48],
      [0.14, 0.88],
      [0.22, 0.72],
      [0.16, 0.16],
    ], 0.055);
    addPart(bladeGeo, obsidianMat, [0, 0, 0]);
    // Incandescent molten magma fuller core
    addPart(new THREE.BoxGeometry(0.09, 1.82, 0.11), emberEdgeMat, [0, 1.12, 0], [0, 0, 0], [1, 1, 1], false);
    addPart(new THREE.BoxGeometry(0.04, 1.55, 0.13), lavaCoreMat, [0, 1.1, 0], [0, 0, 0], [1, 1, 1], false);

    tipY = 2.3;
    trailColor = 0xf97316;
    trailTipColor = 0xfef08a;
  } else if (charId === 'neon_slime') {
    // 3. NEON SLIME — BIO-PLASMA CLEAVER (Industrial containment spine + glowing emerald ectoplasm blade)
    const frameMat = metal(0x1e293b, 0.32, 0.85);
    const slimeEdgeMat = new THREE.MeshStandardMaterial({
      color: 0x4ade80,
      emissive: 0x22c55e,
      emissiveIntensity: 1.4,
      roughness: 0.12,
      transparent: true,
      opacity: 0.88,
    });
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xd9f99d });

    addPart(new THREE.CylinderGeometry(0.058, 0.064, 0.45, 8), frameMat, [0, -0.14, 0]);
    addPart(new THREE.SphereGeometry(0.11, 8, 8), coreMat, [0, -0.4, 0], [0, 0, 0], [1, 1, 1], false);
    // Bio-containment guard collar
    addPart(new THREE.CylinderGeometry(0.22, 0.22, 0.14, 8), frameMat, [0, 0.1, 0], [Math.PI / 2, 0, 0]);
    addPart(new THREE.TorusGeometry(0.24, 0.035, 6, 16), coreMat, [0, 0.1, 0], [0, 0, 0], [1, 1, 1], false);

    // Asymmetric heavy cyber-bio cleaver blade
    const bladeGeo = createExtrudedBladeGeometry([
      [-0.1, 0.16],
      [-0.11, 1.85],
      [0.06, 2.08],
      [0.28, 1.68],
      [0.22, 0.95],
      [0.18, 0.22],
    ], 0.05);
    addPart(bladeGeo, slimeEdgeMat, [0, 0, 0]);
    // Steel containment spine & pulsing bio-vials along the back edge
    addPart(new THREE.BoxGeometry(0.08, 1.75, 0.11), frameMat, [-0.1, 1.0, 0]);
    for (const vy of [0.55, 1.05, 1.52]) {
      const pod = addPart(new THREE.SphereGeometry(0.075, 8, 8), coreMat, [-0.08, vy, 0], [0, 0, 0], [1, 1.4, 1], false);
      animatedParts.push(pod);
    }

    tipY = 2.1;
    trailColor = 0x22c55e;
    trailTipColor = 0xd9f99d;
  } else if (charId === 'half_cyborg') {
    // 4. HALF-CYBORG — HIGH-FREQUENCY CYBER KATANA (Curved chrome-carbon blade + cyan heated edge + circular tsuba)
    const carbonMat = metal(0x0f172a, 0.22, 0.92);
    const chromeMat = metal(0xe2e8f0, 0.12, 0.96);
    const edgeGlowMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    const accentVioletMat = new THREE.MeshBasicMaterial({ color: 0xa855f7 });

    // Wrapped cyber-katana tsuka hilt
    addPart(new THREE.CylinderGeometry(0.048, 0.052, 0.54, 8), carbonMat, [0, -0.18, 0]);
    addPart(new THREE.TorusGeometry(0.06, 0.015, 6, 12), edgeGlowMat, [0, -0.32, 0], [Math.PI / 2, 0, 0], [1, 1, 1], false);
    // Precision circular machined tsuba handguard
    const tsuba = addPart(new THREE.CylinderGeometry(0.24, 0.24, 0.06, 16), chromeMat, [0, 0.1, 0]);
    addPart(new THREE.TorusGeometry(0.25, 0.022, 6, 20), edgeGlowMat, [0, 0.1, 0], [Math.PI / 2, 0, 0], [1, 1, 1], false);
    animatedParts.push(tsuba);

    // Sleek curved katana blade body
    const bladeGeo = createExtrudedBladeGeometry([
      [-0.06, 0.12],
      [-0.08, 0.85],
      [-0.04, 1.55],
      [0.06, 2.22],
      [0.14, 1.85],
      [0.07, 1.1],
      [0.05, 0.12],
    ], 0.028, 0.008);
    addPart(bladeGeo, chromeMat, [0, 0, 0]);

    // Superheated glowing cyan laser cutting edge along the curved leading face
    const edgeGeo = createExtrudedBladeGeometry([
      [0.04, 0.14],
      [0.07, 1.1],
      [0.14, 1.85],
      [0.06, 2.25],
      [0.18, 1.86],
      [0.11, 1.08],
      [0.08, 0.14],
    ], 0.018, 0.004);
    addPart(edgeGeo, edgeGlowMat, [0, 0, 0], [0, 0, 0], [1, 1, 1], false);
    // High-frequency power capacitor node near habaki
    addPart(new THREE.BoxGeometry(0.14, 0.18, 0.11), accentVioletMat, [-0.01, 0.24, 0], [0, 0, 0], [1, 1, 1], false);

    tipY = 2.26;
    trailColor = 0x38bdf8;
    trailTipColor = 0xa855f7;
  } else {
    // 5. VOID SHADOW — ASTRAL ECLIPSE BLADE (Curved obsidian-violet crescent sword + spinning golden eclipse halo)
    const voidMetal = metal(0x1b1530, 0.18, 0.88);
    const violetGlow = new THREE.MeshStandardMaterial({
      color: 0xa78bfa,
      emissive: 0x7c3aed,
      emissiveIntensity: 1.5,
      roughness: 0.15,
    });
    const goldEclipseMat = new THREE.MeshBasicMaterial({ color: 0xfde047 });

    addPart(new THREE.CylinderGeometry(0.052, 0.058, 0.48, 8), voidMetal, [0, -0.16, 0]);
    addPart(new THREE.OctahedronGeometry(0.11, 0), goldEclipseMat, [0, -0.44, 0], [0, 0, 0], [1, 1.3, 1], false);

    // Swept crescent crossguard
    addPart(new THREE.TorusGeometry(0.32, 0.055, 6, 18, Math.PI * 1.15), voidMetal, [0, 0.24, 0], [0, 0, Math.PI * 0.92]);

    // Split twin-edge astral blade framing a spinning floating gold eclipse halo!
    const leftProng = createExtrudedBladeGeometry([
      [-0.13, 0.18],
      [-0.22, 0.95],
      [-0.14, 1.75],
      [0.02, 2.24],
      [-0.03, 1.65],
      [-0.1, 0.92],
      [-0.04, 0.18],
    ], 0.038);
    const rightProng = createExtrudedBladeGeometry([
      [0.04, 0.18],
      [0.1, 0.92],
      [0.05, 1.65],
      [0.02, 2.24],
      [0.16, 1.75],
      [0.22, 0.95],
      [0.13, 0.18],
    ], 0.038);
    addPart(leftProng, voidMetal, [0, 0, 0]);
    addPart(rightProng, violetGlow, [0, 0, 0]);

    const eclipseHalo = addPart(
      new THREE.TorusGeometry(0.16, 0.028, 6, 20),
      goldEclipseMat,
      [0, 1.05, 0],
      [0, 0, 0],
      [1, 1, 1],
      false,
    );
    animatedParts.push(eclipseHalo);

    tipY = 2.26;
    trailColor = 0x8b5cf6;
    trailTipColor = 0xfde047;
  }

  const baseSocket = new THREE.Object3D();
  baseSocket.position.set(0, 0.22, 0);
  group.add(baseSocket);

  const tipSocket = new THREE.Object3D();
  tipSocket.position.set(0, tipY, 0);
  group.add(tipSocket);

  return {
    group,
    baseSocket,
    tipSocket,
    animatedParts,
    trailColor,
    trailTipColor,
  };
}

/**
 * Open-source-inspired real-time world-space Blade Ribbon Trail (inspired by SlashSaber / threejs-trail-ribbon).
 * Samples the sword's live hilt & tip world positions each frame into a pre-allocated ring buffer
 * with zero per-frame allocations, rendering a smooth curved luminous slash arc in 3D space!
 */
export class BladeRibbonTrail {
  public readonly mesh: THREE.Mesh;
  private readonly maxSamples = 18;
  private readonly baseHistory: THREE.Vector3[] = [];
  private readonly tipHistory: THREE.Vector3[] = [];
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshBasicMaterial;

  private activeCount = 0;
  private fadeTimer = 0;
  private colorBase = new THREE.Color(0x38bdf8);
  private colorTip = new THREE.Color(0xffffff);

  private readonly _tmpBase = new THREE.Vector3();
  private readonly _tmpTip = new THREE.Vector3();

  constructor() {
    for (let i = 0; i < this.maxSamples; i++) {
      this.baseHistory.push(new THREE.Vector3());
      this.tipHistory.push(new THREE.Vector3());
    }

    const vertCount = this.maxSamples * 2;
    this.positions = new Float32Array(vertCount * 3);
    this.colors = new Float32Array(vertCount * 3);

    const indices: number[] = [];
    for (let i = 0; i < this.maxSamples - 1; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, b, c, b, d, c);
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setIndex(indices);

    this.material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 6;
  }

  public setColors(baseHex: number, tipHex: number): void {
    this.colorBase.setHex(baseHex);
    this.colorTip.setHex(tipHex);
  }

  public clear(): void {
    this.activeCount = 0;
    this.fadeTimer = 0;
    this.mesh.visible = false;
  }

  public update(
    dt: number,
    emitting: boolean,
    baseSocket: THREE.Object3D,
    tipSocket: THREE.Object3D,
    forwardSpeed: number,
  ): void {
    // Drift historical trail points slightly backward with world speed so slash ribbons stay anchored in space
    const dz = forwardSpeed * dt * 0.45;
    for (let i = 0; i < this.activeCount; i++) {
      this.baseHistory[i].z += dz;
      this.tipHistory[i].z += dz;
    }

    if (emitting) {
      baseSocket.getWorldPosition(this._tmpBase);
      tipSocket.getWorldPosition(this._tmpTip);

      // Shift ring buffer back by 1 slot (zero allocation)
      const shiftTop = Math.min(this.activeCount, this.maxSamples - 1);
      for (let i = shiftTop; i > 0; i--) {
        this.baseHistory[i].copy(this.baseHistory[i - 1]);
        this.tipHistory[i].copy(this.tipHistory[i - 1]);
      }
      this.baseHistory[0].copy(this._tmpBase);
      this.tipHistory[0].copy(this._tmpTip);
      this.activeCount = Math.min(this.maxSamples, this.activeCount + 1);
      this.fadeTimer = 0.22;
    } else if (this.fadeTimer > 0) {
      this.fadeTimer = Math.max(0, this.fadeTimer - dt);
      if (this.fadeTimer <= 0) {
        this.clear();
        return;
      }
    } else {
      this.mesh.visible = false;
      return;
    }

    if (this.activeCount < 2) {
      this.mesh.visible = false;
      return;
    }

    const globalFade = emitting ? 1.0 : this.fadeTimer / 0.22;
    this.material.opacity = 0.92 * globalFade;
    this.mesh.visible = true;

    for (let i = 0; i < this.maxSamples; i++) {
      const sampleIdx = Math.min(i, this.activeCount - 1);
      const b = this.baseHistory[sampleIdx];
      const t = this.tipHistory[sampleIdx];
      const ageNorm = i / Math.max(1, this.activeCount - 1);
      // Taper brightness smoothly toward tail of ribbon
      const intensity = i < this.activeCount ? Math.pow(1 - ageNorm, 1.55) : 0;

      const vBase = i * 6;
      this.positions[vBase] = b.x;
      this.positions[vBase + 1] = b.y;
      this.positions[vBase + 2] = b.z;

      this.positions[vBase + 3] = t.x;
      this.positions[vBase + 4] = t.y;
      this.positions[vBase + 5] = t.z;

      this.colors[vBase] = this.colorBase.r * intensity * 0.72;
      this.colors[vBase + 1] = this.colorBase.g * intensity * 0.72;
      this.colors[vBase + 2] = this.colorBase.b * intensity * 0.72;

      this.colors[vBase + 3] = this.colorTip.r * intensity;
      this.colors[vBase + 4] = this.colorTip.g * intensity;
      this.colors[vBase + 5] = this.colorTip.b * intensity;
    }

    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  public dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
