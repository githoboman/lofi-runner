import * as THREE from 'three';
import { SCENE_NAMES, SCENE_PORTAL_THEME } from './config';
import type { SceneId } from './types';

export type PortalUpdateStatus = 'idle' | 'approaching' | 'crossed';

const VORTEX_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const VORTEX_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  varying vec2 vUv;

  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    p.x *= 1.18;
    float r = length(p);
    float angle = atan(p.y, p.x);

    // Swirling multi-arm dimensional plasma vortex
    float swirl1 = sin(angle * 5.0 - uTime * 5.2 + r * 8.5);
    float swirl2 = cos(angle * 3.0 + uTime * 3.6 - r * 11.0);
    float rings = sin(r * 16.0 - uTime * 7.5);
    float energy = 0.5 + 0.28 * swirl1 + 0.16 * swirl2 + 0.14 * rings;

    // Bright hot center + intense rim glow
    float coreGlow = smoothstep(0.62, 0.0, r);
    float rimGlow = smoothstep(0.55, 0.92, r) * (1.0 - smoothstep(0.92, 1.02, r));
    float mask = 1.0 - smoothstep(0.86, 1.02, r);

    vec3 col = mix(uColorA, uColorB, clamp(energy * 0.72 + coreGlow * 0.65, 0.0, 1.0));
    col += uColorB * rimGlow * 1.45;
    col += vec3(1.0) * coreGlow * 0.55;

    float alpha = mask * (0.68 + 0.28 * energy + rimGlow * 0.35);
    if (alpha < 0.02) discard;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.94));
  }
`;

/**
 * Full-width 3D Dimensional World Portal Gate spanning all 3 lanes.
 * Spawns ahead on the highway before each 1,500m biome boundary so the Yeti
 * physically sprints straight through the swirling GLSL vortex to warp worlds!
 */
export class WorldPortalController {
  public readonly root = new THREE.Group();

  private active = false;
  private crossed = false;
  private z = -150;
  private destination: SceneId = 'inferno_caldera';

  private vortexMat: THREE.ShaderMaterial;
  private primaryGlowMat: THREE.MeshBasicMaterial;
  private secondaryGlowMat: THREE.MeshBasicMaterial;
  private thresholdMat: THREE.MeshBasicMaterial;
  private outerRing: THREE.Mesh;
  private innerRing: THREE.Mesh;
  private orbitGroup = new THREE.Group();

  private signCanvas: HTMLCanvasElement;
  private signCtx: CanvasRenderingContext2D;
  private signTexture: THREE.CanvasTexture;
  private signMat: THREE.MeshBasicMaterial;

  constructor(maxAniso: number) {
    this.root.visible = false;

    const stoneMat = new THREE.MeshStandardMaterial({
      color: 0x161c2e,
      roughness: 0.42,
      metalness: 0.68,
    });
    const trimMetalMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.25,
      metalness: 0.88,
    });
    this.primaryGlowMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
    });
    this.secondaryGlowMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
    });

    // Twin composite sculpted flanking pylons (spanning outside the 3 lanes at x = ±5.45)
    const pylonBodyGeo = new THREE.BoxGeometry(1.35, 8.6, 1.65);
    const pylonBaseGeo = new THREE.BoxGeometry(2.05, 0.95, 2.35);
    const pylonCapGeo = new THREE.OctahedronGeometry(0.92, 0);
    const conduitGeo = new THREE.BoxGeometry(0.28, 7.2, 1.75);

    for (const side of [-1, 1]) {
      const px = side * 5.45;

      const base = new THREE.Mesh(pylonBaseGeo, trimMetalMat);
      base.position.set(px, 0.48, 0);
      this.root.add(base);

      const pylon = new THREE.Mesh(pylonBodyGeo, stoneMat);
      pylon.position.set(px, 4.3, 0);
      pylon.castShadow = true;
      this.root.add(pylon);

      const conduit = new THREE.Mesh(conduitGeo, this.primaryGlowMat);
      conduit.position.set(px - side * 0.52, 4.3, 0);
      this.root.add(conduit);

      const cap = new THREE.Mesh(pylonCapGeo, this.secondaryGlowMat);
      cap.position.set(px, 9.25, 0);
      cap.scale.set(0.85, 1.35, 0.85);
      this.root.add(cap);
    }

    // Monumental sculpted overhead archway lintel
    const topBeam = new THREE.Mesh(new THREE.BoxGeometry(12.6, 1.25, 1.85), stoneMat);
    topBeam.position.set(0, 8.35, 0);
    this.root.add(topBeam);

    const topTrim = new THREE.Mesh(new THREE.BoxGeometry(11.4, 0.26, 2.02), this.primaryGlowMat);
    topTrim.position.set(0, 7.72, 0);
    this.root.add(topTrim);

    // Dynamic glowing destination banner across the crown of the portal
    this.signCanvas = document.createElement('canvas');
    this.signCanvas.width = 512;
    this.signCanvas.height = 128;
    this.signCtx = this.signCanvas.getContext('2d')!;
    this.signTexture = new THREE.CanvasTexture(this.signCanvas);
    this.signTexture.colorSpace = THREE.SRGBColorSpace;
    this.signTexture.anisotropy = Math.min(8, Math.max(1, maxAniso));

    this.signMat = new THREE.MeshBasicMaterial({
      map: this.signTexture,
      transparent: true,
      fog: false,
    });
    const signBoard = new THREE.Mesh(new THREE.PlaneGeometry(8.6, 2.15), this.signMat);
    signBoard.position.set(0, 9.65, 0.65);
    this.root.add(signBoard);

    // Custom GLSL Swirling Dimensional Vortex Curtain filling the full 3-lane opening
    this.vortexMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColorA: { value: new THREE.Color(0x38bdf8) },
        uColorB: { value: new THREE.Color(0xffffff) },
      },
      vertexShader: VORTEX_VERTEX_SHADER,
      fragmentShader: VORTEX_FRAGMENT_SHADER,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const vortexPlane = new THREE.Mesh(new THREE.PlaneGeometry(10.6, 7.8), this.vortexMat);
    vortexPlane.position.set(0, 3.95, 0);
    vortexPlane.renderOrder = 4;
    this.root.add(vortexPlane);

    // Dual counter-rotating 3D energy torus rings framing the portal
    this.outerRing = new THREE.Mesh(
      new THREE.TorusGeometry(4.65, 0.16, 10, 42),
      this.primaryGlowMat,
    );
    this.outerRing.position.set(0, 4.1, 0.12);
    this.outerRing.scale.set(1.12, 0.86, 1);
    this.root.add(this.outerRing);

    this.innerRing = new THREE.Mesh(
      new THREE.TorusGeometry(3.85, 0.11, 8, 36),
      this.secondaryGlowMat,
    );
    this.innerRing.position.set(0, 4.1, 0.22);
    this.innerRing.scale.set(1.12, 0.86, 1);
    this.root.add(this.innerRing);

    // Orbiting dimensional crystal shards around the archway
    this.orbitGroup.position.set(0, 4.1, 0.35);
    const shardGeo = new THREE.OctahedronGeometry(0.32, 0);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const shard = new THREE.Mesh(
        shardGeo,
        i % 2 === 0 ? this.primaryGlowMat : this.secondaryGlowMat,
      );
      shard.position.set(Math.cos(a) * 5.2, Math.sin(a) * 3.85, 0);
      shard.scale.set(0.75, 1.5, 0.75);
      this.orbitGroup.add(shard);
    }
    this.root.add(this.orbitGroup);

    // Glowing floor warp threshold strip across all 3 lanes (offset to avoid Z-fighting)
    this.thresholdMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const thresholdStrip = new THREE.Mesh(new THREE.PlaneGeometry(9.6, 2.2), this.thresholdMat);
    thresholdStrip.rotation.x = -Math.PI / 2;
    thresholdStrip.position.set(0, 0.05, 0);
    this.root.add(thresholdStrip);
  }

  private renderDestinationSign(sceneId: SceneId): void {
    const ctx = this.signCtx;
    const w = this.signCanvas.width;
    const h = this.signCanvas.height;
    const theme = SCENE_PORTAL_THEME[sceneId];
    const name = SCENE_NAMES[sceneId].toUpperCase();

    ctx.clearRect(0, 0, w, h);

    // Rounded dark obsidian energy plaque with glowing destination border
    ctx.fillStyle = 'rgba(8, 12, 24, 0.9)';
    ctx.strokeStyle = theme.crestHex;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.roundRect(10, 12, w - 20, h - 24, 22);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.font = '700 22px "Bricolage Grotesque", sans-serif';
    ctx.fillStyle = theme.crestHex;
    ctx.fillText('WORLD PORTAL', w / 2, 42);

    ctx.font = '800 40px "Bricolage Grotesque", sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(name, w / 2, 84);

    this.signTexture.needsUpdate = true;
  }

  public spawn(destinationSceneId: SceneId, startZ = -148): void {
    this.destination = destinationSceneId;
    this.z = startZ;
    this.active = true;
    this.crossed = false;

    const theme = SCENE_PORTAL_THEME[destinationSceneId];
    this.primaryGlowMat.color.setHex(theme.primary);
    this.secondaryGlowMat.color.setHex(theme.secondary);
    this.thresholdMat.color.setHex(theme.primary);
    this.vortexMat.uniforms.uColorA.value.setHex(theme.primary);
    this.vortexMat.uniforms.uColorB.value.setHex(theme.secondary);

    this.renderDestinationSign(destinationSceneId);

    this.root.position.set(0, 0, this.z);
    this.root.visible = true;
  }

  public hide(): void {
    this.active = false;
    this.crossed = false;
    this.root.visible = false;
  }

  public isActive(): boolean {
    return this.active;
  }

  public isApproaching(): boolean {
    return this.active && !this.crossed;
  }

  public getZ(): number {
    return this.z;
  }

  public getDestinationSceneId(): SceneId {
    return this.destination;
  }

  public update(dt: number, speed: number, elapsed: number): PortalUpdateStatus {
    if (!this.active) return 'idle';

    this.z += speed * dt;
    this.root.position.set(0, 0, this.z);

    // Animate GLSL vortex, counter-rotating energy rings & orbiting rune shards
    this.vortexMat.uniforms.uTime.value = elapsed;
    this.outerRing.rotation.z = elapsed * 1.45;
    this.innerRing.rotation.z = -elapsed * 2.35;
    this.orbitGroup.rotation.z = elapsed * 1.1;

    const pulse = 1 + Math.sin(elapsed * 8.5) * 0.04;
    this.innerRing.scale.set(1.12 * pulse, 0.86 * pulse, 1);

    if (!this.crossed && this.z >= 0) {
      this.crossed = true;
      return 'crossed';
    }

    if (this.z > 14) {
      this.hide();
      return 'idle';
    }

    return this.crossed ? 'idle' : 'approaching';
  }

  public dispose(): void {
    this.signTexture.dispose();
    this.vortexMat.dispose();
    this.primaryGlowMat.dispose();
    this.secondaryGlowMat.dispose();
    this.thresholdMat.dispose();
    this.signMat.dispose();
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
