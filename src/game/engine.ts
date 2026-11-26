import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { SoundManager } from './audio';
import {
  DIFFICULTIES,
  DOUBLE_JUMP_VELOCITY,
  GRAVITY,
  INVULNERABLE_DURATION,
  JUMP_VELOCITY,
  LANE_X,
  SCENE_NAMES,
  SCENE_ORDER,
  SCENE_PORTAL_THEME,
  SCENE_SWITCH_DISTANCE,
  SLASH_DURATION,
  SLIDE_DURATION,
  SPIN_DURATION,
  STAR_DURATION,
  STAR_FLY_HEIGHT,
  STUMBLE_DURATION,
  SWORD_DURATION,
  getCharacterById,
} from './config';
import { EntityPoolManager } from './pools';
import { WorldManager } from './scenes';
import { SpatialWorldAudioManager } from './spatialAudio';
import type { CharacterId, DifficultyId, GameScreen, HudSnapshot, SceneId } from './types';
import { VillainChaserController } from './villainChaser';
import { WorldPortalController } from './worldPortal';
import { YetiController, type YetiAnimState } from './yetiRig';

export interface EngineCallbacks {
  onHudUpdate: (snapshot: HudSnapshot) => void;
  onGameOver: (result: { score: number; distance: number; runCoins: number }) => void;
  onPauseRequest: () => void;
  onContextLost?: (lost: boolean) => void;
}

const _camTargetPos = new THREE.Vector3();
const _camLookAt = new THREE.Vector3();

const FLY_BARREL_DURATION = 0.44;
const FLY_LOOP_DURATION = 0.62;
const FLY_SWOOP_DURATION = 0.68;

function detectSoftwareWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export class RunnerEngine {
  private container: HTMLElement;
  private callbacks: EngineCallbacks;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private isSoftwareGl: boolean;

  private hemiLight: THREE.HemisphereLight;
  private keyLight: THREE.DirectionalLight;
  private rimLight: THREE.DirectionalLight;

  private world: WorldManager;
  private portal: WorldPortalController;
  private yeti: YetiController;
  private villain: VillainChaserController;
  private pools: EntityPoolManager;
  public readonly audio: SoundManager;
  private spatialAudio: SpatialWorldAudioManager;

  // Loop & lifecycle
  private frameId = 0;
  private disposed = false;
  private lastTimestamp = 0;
  private elapsed = 0;
  private hudSyncAccum = 0;
  private trailAccum = 0;
  private hitStopTimer = 0; // Crisp micro-freeze on realistic box/obstacle slices!

  // Game mode & settings
  private screen: GameScreen = 'menu';
  private difficultyId: DifficultyId = 'normal';
  private characterId: CharacterId = 'og_lofi';

  // Run state
  private score = 0;
  private distance = 0;
  private runCoins = 0;
  private lives = 3;
  private maxLives = 3;
  private shields = 0;
  private speed = 24;

  // Player kinematics
  private lane = 1;
  private playerX = 0;
  private prevPlayerX = 0;
  private playerY = 0;
  private velocityY = 0;
  private isGrounded = true;
  private jumpsUsed = 0;

  // Action & stunt timers
  private slideTimer = 0;
  private flipTimer = 0;
  private flipDuration = 0.56;
  private spinTimer = 0;
  private slashTimer = 0;
  private slashComboIndex = 0;
  private stumbleTimer = 0;
  private invulnTimer = 0;

  // Aerial Star-Flight Stunt timers
  private flyBarrelTimer = 0;
  private flyBarrelDir = 1;
  private flyLoopTimer = 0;
  private flySwoopTimer = 0;

  // Power-ups
  private swordTimer = 0;
  private activeSwordDuration = SWORD_DURATION;
  private starTimer = 0;

  // Scene progression & 3D World Portal state
  private sceneIndex = 0;
  private nextPortalDistance = SCENE_SWITCH_DISTANCE;
  private fadeOpacity = 0;
  private portalWarpColor = '#e0f2fe';
  private portalDestination: string | null = null;
  private sceneToast: string | null = null;
  private sceneToastTimer = 0;

  // Stunt banner & camera juice
  private stuntBanner: string | null = null;
  private stuntBannerTimer = 0;
  private cameraShake = 0;
  private cameraFovKick = 0;
  private yetiSource: 'procedural' | 'glb' = 'procedural';

  // Touch gesture state
  private touchStartX = 0;
  private touchStartY = 0;
  private touchStartTime = 0;
  private touchHandledSwipe = false;

  constructor(
    container: HTMLElement,
    initialCharacter: CharacterId,
    initialDifficulty: DifficultyId,
    sfxEnabled: boolean,
    callbacks: EngineCallbacks,
  ) {
    this.container = container;
    this.callbacks = callbacks;
    this.characterId = initialCharacter;
    this.difficultyId = initialDifficulty;
    this.isSoftwareGl = detectSoftwareWebGL();

    this.audio = new SoundManager();
    this.audio.setEnabled(sfxEnabled);
    this.spatialAudio = new SpatialWorldAudioManager();
    this.spatialAudio.setEnabled(sfxEnabled);

    this.scene = new THREE.Scene();

    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    this.camera = new THREE.PerspectiveCamera(62, width / height, 0.2, 320);

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    container.appendChild(canvas);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.hemiLight = new THREE.HemisphereLight(0x60a5fa, 0x1e1b4b, 0.8);
    this.scene.add(this.hemiLight);

    this.keyLight = new THREE.DirectionalLight(0xffe4b5, 1.6);
    this.keyLight.position.set(12, 22, 16);
    this.keyLight.castShadow = !this.isSoftwareGl;
    this.keyLight.shadow.mapSize.set(1024, 1024);
    this.keyLight.shadow.camera.near = 2;
    this.keyLight.shadow.camera.far = 70;
    this.keyLight.shadow.camera.left = -16;
    this.keyLight.shadow.camera.right = 16;
    this.keyLight.shadow.camera.top = 16;
    this.keyLight.shadow.camera.bottom = -16;
    this.keyLight.shadow.bias = -0.0005;
    this.keyLight.shadow.normalBias = 0.02;
    this.scene.add(this.keyLight);

    this.rimLight = new THREE.DirectionalLight(0x38bdf8, 1.1);
    this.rimLight.position.set(-10, 12, -16);
    this.scene.add(this.rimLight);

    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();

    this.world = new WorldManager(this.scene, this.hemiLight, this.keyLight, this.rimLight, maxAniso);
    this.portal = new WorldPortalController(maxAniso);
    this.scene.add(this.portal.root);
    this.yeti = new YetiController(initialCharacter, (src) => {
      this.yetiSource = src;
      this.emitHud();
    });
    this.scene.add(this.yeti.root);
    this.scene.add(this.yeti.swordTrailMesh);
    this.villain = new VillainChaserController();
    this.scene.add(this.villain.root);
    this.pools = new EntityPoolManager(this.scene, maxAniso);

    // Open showcase in the equipped Yeti's dedicated home world
    const initialHome = getCharacterById(initialCharacter).homeWorldId;
    const homeIdx = Math.max(0, SCENE_ORDER.indexOf(initialHome));
    this.sceneIndex = homeIdx;
    const startWorld = SCENE_ORDER[homeIdx];
    this.world.activateScene(startWorld);
    this.pools.setScene(startWorld);
    this.spatialAudio.setWorld(startWorld);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    window.addEventListener('resize', this.handleResize);
    window.addEventListener('keydown', this.handleKeyDown, { passive: false });
    canvas.addEventListener('touchstart', this.handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', this.handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', this.handleTouchEnd, { passive: false });
    canvas.addEventListener('webglcontextlost', this.handleContextLost);
    canvas.addEventListener('webglcontextrestored', this.handleContextRestored);

    this.handleResize();
    this.emitHud();

    this.lastTimestamp = performance.now();
    this.scheduleNextFrame();
  }

  public setScreen(screen: GameScreen): void {
    this.screen = screen;
    if (screen === 'menu' || screen === 'character' || screen === 'settings') {
      this.playerX = 0;
      this.lane = 1;
      this.playerY = 0;
      this.yeti.root.position.set(0, 0, 0);
      this.yeti.clearSwordTrail();
      this.villain.hide();
      this.portal.hide();
      this.portalDestination = null;
      this.fadeOpacity = 0;
      this.hitStopTimer = 0;
    }
    this.spatialAudio.setActivity(screen === 'playing', 0, this.playerX);
    this.emitHud();
  }

  public setCharacter(charId: CharacterId, playEmote = false): void {
    this.characterId = charId;
    this.yeti.setCharacter(charId, playEmote);
    this.emitHud();
  }

  public setDifficulty(diff: DifficultyId): void {
    this.difficultyId = diff;
  }

  public setSfxEnabled(enabled: boolean): void {
    this.audio.setEnabled(enabled);
    this.spatialAudio.setEnabled(enabled);
    if (enabled) {
      this.spatialAudio.unlock();
    }
  }

  public previewScene(sceneId: SceneId): void {
    const idx = SCENE_ORDER.indexOf(sceneId);
    if (idx >= 0) {
      this.sceneIndex = idx;
      this.world.activateScene(sceneId);
      this.pools.setScene(sceneId);
      this.spatialAudio.unlock();
      this.spatialAudio.setWorld(sceneId);
      this.emitHud();
    }
  }

  public startRun(): void {
    const diff = DIFFICULTIES[this.difficultyId];
    const charCfg = getCharacterById(this.characterId);

    this.score = 0;
    this.distance = 0;
    this.runCoins = 0;
    this.lives = diff.lives;
    this.maxLives = diff.lives;
    this.shields = charCfg.perks.startShields;
    this.speed = diff.startSpeed;

    this.lane = 1;
    this.playerX = 0;
    this.prevPlayerX = 0;
    this.playerY = 0;
    this.velocityY = 0;
    this.isGrounded = true;
    this.jumpsUsed = 0;

    this.slideTimer = 0;
    this.flipTimer = 0;
    this.spinTimer = 0;
    this.slashTimer = 0;
    this.slashComboIndex = 0;
    this.stumbleTimer = 0;
    this.invulnTimer = 0;
    this.flyBarrelTimer = 0;
    this.flyLoopTimer = 0;
    this.flySwoopTimer = 0;
    this.hitStopTimer = 0;

    this.swordTimer = 0;
    this.activeSwordDuration = SWORD_DURATION + charCfg.perks.swordDurationBonus;
    this.starTimer = 0;
    this.cameraShake = 0;
    this.cameraFovKick = 0;
    this.trailAccum = 0;

    const homeIdx = Math.max(0, SCENE_ORDER.indexOf(charCfg.homeWorldId));
    this.sceneIndex = homeIdx;
    this.nextPortalDistance = SCENE_SWITCH_DISTANCE;
    const startSceneId = SCENE_ORDER[homeIdx];

    this.fadeOpacity = 0;
    this.portalWarpColor = SCENE_PORTAL_THEME[startSceneId].flashHex;
    this.portalDestination = null;
    this.portal.hide();
    this.sceneToast = SCENE_NAMES[startSceneId];
    this.sceneToastTimer = 2.0;
    this.stuntBanner = `${charCfg.name} · ${charCfg.perkName}`;
    this.stuntBannerTimer = 1.8;

    this.world.activateScene(startSceneId);
    this.pools.reset();
    this.pools.setScene(startSceneId);
    this.yeti.clearSwordTrail();
    this.villain.startChase();

    this.screen = 'playing';
    this.audio.play('uiClick');
    this.spatialAudio.unlock();
    this.spatialAudio.setWorld(startSceneId);
    this.spatialAudio.setActivity(true, 0, 0);
    this.emitHud();
  }

  public moveLeft(): void {
    if (this.screen !== 'playing') return;
    if (this.lane > 0) {
      this.lane--;
      this.yeti.triggerLaneSnap(-1);
      const charCfg = getCharacterById(this.characterId);
      if (this.starTimer > 0 && this.flyBarrelTimer <= 0) {
        this.flyBarrelTimer = FLY_BARREL_DURATION;
        this.flyBarrelDir = -1;
        this.yeti.triggerFlightStuntImpulse(-1);
        const pts = Math.round(45 * charCfg.perks.stuntBonusMult);
        this.addBonus(pts, `Barrel Roll +${pts}`);
        this.audio.play('flyStunt');
        this.cameraFovKick = 4.5;
        this.pools.spawnBurst(this.playerX, this.playerY + 1.0, 0, 0xfde047, 12);
      } else {
        this.pools.spawnBurst(this.playerX, this.playerY + 0.3, 0.2, charCfg.trailColor, 4);
      }
    }
  }

  public moveRight(): void {
    if (this.screen !== 'playing') return;
    if (this.lane < 2) {
      this.lane++;
      this.yeti.triggerLaneSnap(1);
      const charCfg = getCharacterById(this.characterId);
      if (this.starTimer > 0 && this.flyBarrelTimer <= 0) {
        this.flyBarrelTimer = FLY_BARREL_DURATION;
        this.flyBarrelDir = 1;
        this.yeti.triggerFlightStuntImpulse(1);
        const pts = Math.round(45 * charCfg.perks.stuntBonusMult);
        this.addBonus(pts, `Barrel Roll +${pts}`);
        this.audio.play('flyStunt');
        this.cameraFovKick = 4.5;
        this.pools.spawnBurst(this.playerX, this.playerY + 1.0, 0, 0xfde047, 12);
      } else {
        this.pools.spawnBurst(this.playerX, this.playerY + 0.3, 0.2, charCfg.trailColor, 4);
      }
    }
  }

  public triggerJump(): void {
    if (this.screen !== 'playing') return;
    const charCfg = getCharacterById(this.characterId);

    // While Star Flying -> perform an exhilarating Sky Loop-de-Loop stunt!
    if (this.starTimer > 0) {
      if (this.flyLoopTimer <= 0) {
        this.flyLoopTimer = FLY_LOOP_DURATION;
        this.flySwoopTimer = 0;
        this.yeti.triggerFlightStuntImpulse(1);
        const pts = Math.round(60 * charCfg.perks.stuntBonusMult);
        this.addBonus(pts, `Sky Loop +${pts}`);
        this.audio.play('flyStunt');
        this.cameraFovKick = 6.5;
        this.pools.spawnBurst(this.playerX, this.playerY + 1.1, 0, 0xfacc15, 16);
        this.pools.spawnBurst(this.playerX, this.playerY + 1.1, 0, charCfg.accentColor, 10);
      }
      return;
    }

    const jumpMult = charCfg.perks.jumpMult;

    if (this.isGrounded) {
      this.isGrounded = false;
      this.jumpsUsed = 1;
      this.velocityY = JUMP_VELOCITY * jumpMult;
      this.slideTimer = 0;
      this.yeti.triggerJumpLaunch(false);
      this.audio.play('jump');
      this.pools.spawnBurst(this.playerX, 0.2, 0.2, charCfg.trailColor, 6);
    } else if (this.jumpsUsed === 1) {
      this.jumpsUsed = 2;
      this.velocityY = DOUBLE_JUMP_VELOCITY * jumpMult;
      this.flipTimer = this.flipDuration;
      this.slideTimer = 0;
      this.yeti.triggerJumpLaunch(true);
      const pts = Math.round(50 * charCfg.perks.stuntBonusMult);
      this.addBonus(pts, `Backflip +${pts}`);
      this.audio.play('flip');
      this.cameraFovKick = 3.5;
      this.pools.spawnBurst(this.playerX, this.playerY + 0.6, 0, charCfg.accentColor, 12);
    }
  }

  public triggerSlide(): void {
    if (this.screen !== 'playing') return;
    const charCfg = getCharacterById(this.characterId);

    // While Star Flying -> perform a Low Sky Swoop to scoop lower coin trails!
    if (this.starTimer > 0) {
      if (this.flySwoopTimer <= 0) {
        this.flySwoopTimer = FLY_SWOOP_DURATION;
        this.flyLoopTimer = 0;
        this.yeti.triggerFlightStuntImpulse(-1);
        const pts = Math.round(40 * charCfg.perks.stuntBonusMult);
        this.addBonus(pts, `Sky Swoop +${pts}`);
        this.audio.play('spin');
        this.cameraFovKick = 5.0;
        this.pools.spawnBurst(this.playerX, this.playerY + 0.5, 0, 0x38bdf8, 12);
      }
      return;
    }

    if (!this.isGrounded) {
      this.velocityY = Math.min(this.velocityY, -28);
    }
    this.slideTimer = SLIDE_DURATION;
    this.flipTimer = 0;
    this.yeti.triggerSlideDrop();
  }

  public triggerSpin(): void {
    if (this.screen !== 'playing') return;
    const charCfg = getCharacterById(this.characterId);

    // While Star Flying -> blazing Meteor Corkscrew spin!
    if (this.starTimer > 0) {
      if (this.spinTimer <= 0) {
        this.spinTimer = SPIN_DURATION * 1.15;
        this.yeti.triggerFlightStuntImpulse(1);
        const pts = Math.round(55 * charCfg.perks.stuntBonusMult);
        this.addBonus(pts, `Star Corkscrew +${pts}`);
        this.audio.play('flyStunt');
        this.cameraFovKick = 5.5;
        this.pools.spawnBurst(this.playerX, this.playerY + 1.0, 0, 0xfde047, 16);
      }
      return;
    }

    if (!this.isGrounded && this.spinTimer <= 0) {
      this.spinTimer = SPIN_DURATION;
      this.velocityY = Math.max(this.velocityY, 4.2 + charCfg.perks.spinHangBoost);
      const pts = Math.round(40 * charCfg.perks.stuntBonusMult);
      this.addBonus(pts, `Tail-Whip Spin +${pts}`);
      this.audio.play('spin');
      this.pools.spawnBurst(this.playerX, this.playerY + 1.0, 0, charCfg.accentColor, 10);
    }
  }

  public triggerSlash(): void {
    if (this.screen !== 'playing') return;
    if (this.slashTimer > 0) return;

    const charCfg = getCharacterById(this.characterId);
    this.slashTimer = SLASH_DURATION;
    const comboStep = this.slashComboIndex;
    this.slashComboIndex = (this.slashComboIndex + 1) % 3;
    const cutDir = comboStep === 1 ? -1 : 1;
    const comboLabel =
      comboStep === 0 ? 'Forehand Cleave' : comboStep === 1 ? 'Reverse Slash' : 'Whirlwind Cut';
    this.audio.play('sword');

    if (this.swordTimer > 0) {
      const reachZ = -12.5 - charCfg.perks.swordReachBonus;
      let slicedAny = false;
      for (const obs of this.pools.obstacles) {
        if (!obs.active || obs.sliced) continue;
        if (obs.lane === this.lane && obs.z > reachZ && obs.z < 2.2) {
          this.pools.sliceObstacle(obs, charCfg.slashColor, cutDir);
          slicedAny = true;
          const pts = Math.round((comboStep === 2 ? 100 : 80) * charCfg.perks.stuntBonusMult);
          this.addBonus(pts, `${comboLabel} +${pts}`);
        }
      }
      if (slicedAny) {
        this.onRealBoxCutImpact();
      }
    }
  }

  private onRealBoxCutImpact(): void {
    this.hitStopTimer = 0.036; // Crisp 36ms impact freeze-frame for realistic weighty cut!
    this.cameraShake = Math.max(this.cameraShake, 0.34);
    this.cameraFovKick = Math.max(this.cameraFovKick, 4.5);
    this.yeti.triggerSlashImpact();
    this.villain.triggerDodgeBack();
    this.audio.play('sliceImpact');
  }

  private addBonus(points: number, label: string): void {
    this.score += Math.round(points * DIFFICULTIES[this.difficultyId].scoreMultiplier);
    this.stuntBanner = label;
    this.stuntBannerTimer = 1.15;
    this.emitHud();
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    const code = e.code;
    this.spatialAudio.unlock();

    if (this.screen === 'playing') {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(code)) {
        e.preventDefault();
      }
      if (code === 'ArrowLeft' || code === 'KeyA') this.moveLeft();
      else if (code === 'ArrowRight' || code === 'KeyD') this.moveRight();
      else if (code === 'Space' || code === 'KeyW' || code === 'ArrowUp') this.triggerJump();
      else if (code === 'KeyS' || code === 'ArrowDown') this.triggerSlide();
      else if (code === 'KeyX') this.triggerSpin();
      else if (code === 'KeyZ') this.triggerSlash();
      else if (code === 'Escape' || code === 'KeyP') {
        this.callbacks.onPauseRequest();
      }
    } else if (this.screen === 'paused') {
      if (code === 'Escape' || code === 'KeyP') {
        this.callbacks.onPauseRequest();
      }
    }
  };

  private handleTouchStart = (e: TouchEvent): void => {
    this.spatialAudio.unlock();
    if (this.screen !== 'playing' || e.touches.length === 0) return;
    e.preventDefault();
    const t = e.touches[0];
    this.touchStartX = t.clientX;
    this.touchStartY = t.clientY;
    this.touchStartTime = performance.now();
    this.touchHandledSwipe = false;
  };

  private handleTouchMove = (e: TouchEvent): void => {
    if (this.screen !== 'playing' || this.touchHandledSwipe || e.touches.length === 0) return;
    e.preventDefault();
    const t = e.touches[0];
    const dx = t.clientX - this.touchStartX;
    const dy = t.clientY - this.touchStartY;
    const threshold = 28;

    if (Math.abs(dx) > threshold || Math.abs(dy) > threshold) {
      this.touchHandledSwipe = true;
      if (Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0) this.moveLeft();
        else this.moveRight();
      } else {
        if (dy < 0) this.triggerJump();
        else this.triggerSlide();
      }
    }
  };

  private handleTouchEnd = (e: TouchEvent): void => {
    if (this.screen !== 'playing') return;
    e.preventDefault();
    const elapsed = performance.now() - this.touchStartTime;
    if (!this.touchHandledSwipe && elapsed < 260) {
      if (this.starTimer > 0) {
        this.triggerSpin(); // Tap while flying -> Star Corkscrew!
      } else if (this.isGrounded) {
        this.triggerJump();
      } else {
        this.triggerSpin();
      }
    }
  };

  private handleResize = (): void => {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    const aspect = width / height;

    this.camera.aspect = aspect;
    this.camera.fov = aspect < 0.85 ? 74 : aspect < 1.1 ? 68 : 60;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
  };

  private handleContextLost = (e: Event): void => {
    e.preventDefault();
    this.callbacks.onContextLost?.(true);
  };

  private handleContextRestored = (): void => {
    this.callbacks.onContextLost?.(false);
  };

  private scheduleNextFrame(): void {
    if (this.disposed) return;
    if (this.isSoftwareGl) {
      this.afterDraw(() => this.tick());
    } else {
      this.frameId = requestAnimationFrame(() => this.tick());
    }
  }

  private afterDraw(cb: () => void): void {
    if (this.disposed) return;
    try {
      const gl = this.renderer.getContext() as WebGL2RenderingContext;
      if (gl && typeof gl.fenceSync === 'function') {
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        const poll = () => {
          if (this.disposed) return;
          const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
          if (state === gl.UNSIGNALED) {
            this.frameId = window.setTimeout(poll, 5);
          } else {
            if (sync) gl.deleteSync(sync);
            this.frameId = window.setTimeout(cb, 80);
          }
        };
        this.frameId = window.setTimeout(poll, 5);
        return;
      }
    } catch {
      // Fallback
    }
    this.frameId = window.setTimeout(cb, 80);
  }

  private tick(): void {
    if (this.disposed) return;
    const now = performance.now();
    const dt = Math.min((now - this.lastTimestamp) / 1000, 0.05);
    this.lastTimestamp = now;
    this.elapsed += dt;

    if (this.screen === 'playing') {
      this.updatePlaying(dt);
    } else if (this.screen === 'menu' || this.screen === 'character' || this.screen === 'settings') {
      this.updateShowcase(dt);
    } else if (this.screen === 'gameover') {
      this.updateGameOverIdle(dt);
    }

    this.spatialAudio.update(dt);
    this.renderer.render(this.scene, this.camera);
    this.scheduleNextFrame();
  }

  private updateShowcase(dt: number): void {
    this.world.update(dt, 4.5, this.elapsed);

    const isCharScreen = this.screen === 'character';
    const aspect = this.camera.aspect;

    const camX = isCharScreen ? Math.sin(this.elapsed * 0.5) * 0.95 : Math.sin(this.elapsed * 0.35) * 0.9;
    const camY = isCharScreen ? 1.85 : 2.35;
    const camZ = isCharScreen ? (aspect < 0.85 ? 5.1 : 4.1) : (aspect < 0.85 ? 6.8 : 5.6);

    _camTargetPos.set(camX, camY, camZ);
    this.camera.position.lerp(_camTargetPos, 1 - Math.exp(-5 * dt));

    _camLookAt.set(0, isCharScreen ? 1.25 : 1.55, -2);
    this.camera.lookAt(_camLookAt);

    const charCfg = getCharacterById(this.characterId);
    this.yeti.update({
      dt,
      elapsed: this.elapsed,
      state: 'idle',
      speedRatio: 0,
      forwardSpeed: 0,
      laneVelocity: 0,
      yPos: 0,
      velocityY: 0,
      flipProgress: 0,
      spinProgress: 0,
      slashProgress: 0,
      slashComboIndex: 0,
      stumbleProgress: 0,
      flyBarrelProgress: 0,
      flyBarrelDir: 1,
      flyLoopProgress: 0,
      flySwoopProgress: 0,
      swordActive: false,
      starActive: false,
      shieldActive: charCfg.perks.startShields > 0,
      invulnerable: false,
      invulnTimer: 0,
      isMenuPreview: true,
    });
  }

  private updateGameOverIdle(dt: number): void {
    this.world.update(dt, 1.2, this.elapsed);
    this.villain.update({
      dt,
      elapsed: this.elapsed,
      playerX: this.playerX,
      playerY: 0,
      isPlayerSliding: false,
      isPlayerFlying: false,
      speedRatio: 0,
      isGameOver: true,
      isMenuPreview: false,
    });
    _camTargetPos.set(this.playerX * 0.6 + 1.1, 3.6, 7.6);
    this.camera.position.lerp(_camTargetPos, 1 - Math.exp(-3 * dt));
    _camLookAt.set(this.playerX * 0.5 + 0.35, 1.45, -1.5);
    this.camera.lookAt(_camLookAt);
  }

  private updatePlaying(dt: number): void {
    // Hit-stop micro-freeze on weighty box/obstacle slices!
    if (this.hitStopTimer > 0) {
      this.hitStopTimer = Math.max(0, this.hitStopTimer - dt);
      const shakeX = (Math.random() - 0.5) * this.cameraShake * 0.55;
      const shakeY = (Math.random() - 0.5) * this.cameraShake * 0.45;
      this.camera.position.x += shakeX * 0.25;
      this.camera.position.y += shakeY * 0.25;
      return;
    }

    const diff = DIFFICULTIES[this.difficultyId];
    const charCfg = getCharacterById(this.characterId);

    this.speed = Math.min(diff.maxSpeed, diff.startSpeed + this.distance * diff.speedRampPerUnit);
    const activeSpeed = this.starTimer > 0 ? this.speed * 1.24 : this.speed;
    const stepDist = activeSpeed * dt;
    this.distance += stepDist;
    this.score += stepDist * 1.5 * diff.scoreMultiplier;

    // Physical 3D World Portal Gate spawns approaching every 1,500m biome boundary!
    if (!this.portal.isActive() && this.distance >= this.nextPortalDistance - 144) {
      const nextIdx = (this.sceneIndex + 1) % SCENE_ORDER.length;
      const nextId = SCENE_ORDER[nextIdx];
      this.portal.spawn(nextId, -148);
      this.portalDestination = SCENE_NAMES[nextId];
      this.pools.clearObstaclesInRange(-165, -108);
      this.emitHud();
    }

    const portalStatus = this.portal.update(dt, activeSpeed, this.elapsed);
    if (portalStatus === 'crossed') {
      const nextId = this.portal.getDestinationSceneId();
      this.sceneIndex = Math.max(0, SCENE_ORDER.indexOf(nextId));
      this.nextPortalDistance += SCENE_SWITCH_DISTANCE;
      this.world.activateScene(nextId);
      this.pools.setScene(nextId);
      this.pools.clearObstaclesInRange(-52, 8);
      this.spatialAudio.setWorld(nextId);

      const theme = SCENE_PORTAL_THEME[nextId];
      this.portalWarpColor = theme.flashHex;
      this.fadeOpacity = 0.88;
      this.cameraFovKick = Math.max(this.cameraFovKick, 9.5);
      this.cameraShake = Math.max(this.cameraShake, 0.25);
      this.pools.spawnBurst(this.playerX, this.playerY + 1.2, 0, theme.primary, 24);
      this.pools.spawnBurst(this.playerX, this.playerY + 1.4, -0.4, theme.secondary, 16);
      this.audio.play('portalWarp');
      this.portalDestination = null;
      this.sceneToast = SCENE_NAMES[nextId];
      this.sceneToastTimer = 2.4;
      this.emitHud();
    }

    if (this.fadeOpacity > 0) {
      this.fadeOpacity = Math.max(0, this.fadeOpacity - dt * 2.35);
    }

    if (this.slideTimer > 0) this.slideTimer = Math.max(0, this.slideTimer - dt);
    if (this.flipTimer > 0) this.flipTimer = Math.max(0, this.flipTimer - dt);
    if (this.spinTimer > 0) this.spinTimer = Math.max(0, this.spinTimer - dt);
    if (this.slashTimer > 0) this.slashTimer = Math.max(0, this.slashTimer - dt);
    if (this.stumbleTimer > 0) this.stumbleTimer = Math.max(0, this.stumbleTimer - dt);
    if (this.invulnTimer > 0) this.invulnTimer = Math.max(0, this.invulnTimer - dt);
    if (this.flyBarrelTimer > 0) this.flyBarrelTimer = Math.max(0, this.flyBarrelTimer - dt);
    if (this.flyLoopTimer > 0) this.flyLoopTimer = Math.max(0, this.flyLoopTimer - dt);
    if (this.flySwoopTimer > 0) this.flySwoopTimer = Math.max(0, this.flySwoopTimer - dt);

    if (this.swordTimer > 0) this.swordTimer = Math.max(0, this.swordTimer - dt);
    if (this.starTimer > 0) {
      this.starTimer = Math.max(0, this.starTimer - dt);
      if (this.starTimer === 0) {
        this.invulnTimer = Math.max(this.invulnTimer, 1.0);
        this.flyBarrelTimer = 0;
        this.flyLoopTimer = 0;
        this.flySwoopTimer = 0;
      }
    }
    if (this.stuntBannerTimer > 0) {
      this.stuntBannerTimer = Math.max(0, this.stuntBannerTimer - dt);
      if (this.stuntBannerTimer === 0) this.stuntBanner = null;
    }
    if (this.sceneToastTimer > 0) {
      this.sceneToastTimer = Math.max(0, this.sceneToastTimer - dt);
      if (this.sceneToastTimer === 0) this.sceneToast = null;
    }
    if (this.cameraShake > 0) {
      this.cameraShake = Math.max(0, this.cameraShake - dt * 1.9);
    }
    if (this.cameraFovKick > 0) {
      this.cameraFovKick = THREE.MathUtils.damp(this.cameraFovKick, 0, 7, dt);
    }

    // Smooth lateral lane damping
    this.prevPlayerX = this.playerX;
    const targetX = LANE_X[this.lane];
    this.playerX = THREE.MathUtils.damp(this.playerX, targetX, 17, dt);
    const laneVelocity = (this.playerX - this.prevPlayerX) / Math.max(dt, 0.001);

    // Vertical physics (Star flight vs gravity jump)
    if (this.starTimer > 0) {
      this.playerY = THREE.MathUtils.damp(this.playerY, STAR_FLY_HEIGHT, 7, dt);
      this.velocityY = 0;
      this.isGrounded = false;
      this.slideTimer = 0;
    } else {
      if (!this.isGrounded || this.playerY > 0) {
        const effGravity = this.spinTimer > 0 ? GRAVITY * 0.8 : GRAVITY;
        this.velocityY -= effGravity * dt;
        this.playerY += this.velocityY * dt;
        if (this.playerY <= 0) {
          this.playerY = 0;
          this.velocityY = 0;
          if (!this.isGrounded) {
            this.audio.play('land');
            this.pools.spawnBurst(this.playerX, 0.15, 0.15, charCfg.trailColor, 5);
          }
          this.isGrounded = true;
          this.jumpsUsed = 0;
          this.flipTimer = 0;
          this.spinTimer = 0;
        }
      }
    }

    this.yeti.root.position.set(this.playerX, 0, 0);

    // Subtle ground sprint trail sparks (disabled during Star Flight for crystal-clear aerial visibility)
    if (this.starTimer <= 0) {
      this.trailAccum += dt;
      if (this.trailAccum >= 0.16) {
        this.trailAccum = 0;
        this.pools.spawnBurst(
          this.playerX + (Math.random() - 0.5) * 0.5,
          Math.max(0.2, this.playerY + 0.22),
          0.55,
          charCfg.trailColor,
          2,
        );
      }
    }

    const pauseSpawnsForPortal =
      this.distance >= this.nextPortalDistance - 160 ||
      (this.portal.isApproaching() && this.portal.getZ() < -6);

    this.world.update(dt, activeSpeed, this.elapsed, this.playerX);
    this.pools.update(
      dt,
      activeSpeed,
      this.elapsed,
      this.distance,
      this.starTimer > 0,
      pauseSpawnsForPortal,
    );

    this.checkCollisions(dt);

    let animState: YetiAnimState = 'run';
    if (this.starTimer > 0) animState = 'fly';
    else if (this.stumbleTimer > 0) animState = 'hit';
    else if (this.slashTimer > 0) animState = 'slash';
    else if (this.flipTimer > 0) animState = 'flip';
    else if (!this.isGrounded) animState = 'jump';
    else if (this.slideTimer > 0) animState = 'slide';

    const speedRatio = THREE.MathUtils.clamp(
      (activeSpeed - diff.startSpeed) / Math.max(1, diff.maxSpeed - diff.startSpeed),
      0,
      1,
    );
    this.spatialAudio.setActivity(true, speedRatio, this.playerX);

    const flyBarrelProgress =
      this.flyBarrelTimer > 0 ? 1 - this.flyBarrelTimer / FLY_BARREL_DURATION : 0;
    const flyLoopProgress =
      this.flyLoopTimer > 0 ? 1 - this.flyLoopTimer / FLY_LOOP_DURATION : 0;
    const flySwoopProgress =
      this.flySwoopTimer > 0 ? 1 - this.flySwoopTimer / FLY_SWOOP_DURATION : 0;

    this.yeti.update({
      dt,
      elapsed: this.elapsed,
      state: animState,
      speedRatio,
      forwardSpeed: activeSpeed,
      laneVelocity,
      yPos: this.playerY,
      velocityY: this.velocityY,
      flipProgress: this.flipTimer > 0 ? 1 - this.flipTimer / this.flipDuration : 0,
      spinProgress: this.spinTimer > 0 ? 1 - this.spinTimer / SPIN_DURATION : 0,
      slashProgress: this.slashTimer > 0 ? 1 - this.slashTimer / SLASH_DURATION : 0,
      slashComboIndex: (this.slashComboIndex + 2) % 3,
      stumbleProgress: this.stumbleTimer > 0 ? 1 - this.stumbleTimer / STUMBLE_DURATION : 0,
      flyBarrelProgress,
      flyBarrelDir: this.flyBarrelDir,
      flyLoopProgress,
      flySwoopProgress,
      swordActive: this.swordTimer > 0,
      starActive: this.starTimer > 0,
      shieldActive: this.shields > 0,
      invulnerable: this.invulnTimer > 0,
      invulnTimer: this.invulnTimer,
      isMenuPreview: false,
    });

    // Update pursuing 3D Villain Chaser right behind the Yeti
    this.villain.update({
      dt,
      elapsed: this.elapsed,
      playerX: this.playerX,
      playerY: this.playerY,
      isPlayerSliding: this.slideTimer > 0,
      isPlayerFlying: this.starTimer > 0,
      speedRatio,
      isGameOver: false,
      isMenuPreview: false,
    });

    // Dynamic chase camera framing both the pursuing Villain behind and the colossal Big Lofi Titan ahead
    const isPortrait = this.camera.aspect < 0.85;
    const baseCamZ = isPortrait ? 10.6 : 8.5;
    const baseCamY = isPortrait ? 5.25 : 4.55;
    const shakeX = this.cameraShake > 0 ? (Math.random() - 0.5) * this.cameraShake * 0.7 : 0;
    const shakeY = this.cameraShake > 0 ? (Math.random() - 0.5) * this.cameraShake * 0.5 : 0;

    _camTargetPos.set(
      this.playerX * 0.62 + shakeX,
      baseCamY + this.playerY * 0.55 + shakeY,
      baseCamZ + (this.starTimer > 0 ? 1.6 : 0),
    );
    this.camera.position.lerp(_camTargetPos, 1 - Math.exp(-9 * dt));

    const targetFov =
      (isPortrait ? 74 : 60) + speedRatio * 7 + (this.starTimer > 0 ? 5.5 : 0) + this.cameraFovKick;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 6, dt);
      this.camera.updateProjectionMatrix();
    }

    _camLookAt.set(this.playerX * 0.45, 1.95 + this.playerY * 0.62, -16);
    this.camera.lookAt(_camLookAt);

    this.hudSyncAccum += dt;
    if (this.hudSyncAccum >= 0.05 || this.fadeOpacity > 0) {
      this.hudSyncAccum = 0;
      this.emitHud();
    }
  }

  private checkCollisions(dt: number): void {
    const charCfg = getCharacterById(this.characterId);
    const swoopOffset =
      this.flySwoopTimer > 0
        ? Math.sin((1 - this.flySwoopTimer / FLY_SWOOP_DURATION) * Math.PI) * -2.1
        : 0;
    const effectiveY = Math.max(0, this.playerY + swoopOffset);
    const playerCenterY = effectiveY + (this.slideTimer > 0 ? 0.55 : 1.05);
    const playerTopY = effectiveY + (this.slideTimer > 0 ? 1.1 : 2.1);

    // 1. SUI Coins + Half-Cyborg Magnet Core pull (plus gentle Star flight pull)
    const magnetRadius = Math.max(charCfg.perks.coinMagnetRadius, this.starTimer > 0 ? 4.4 : 0);
    const coinRadiusX = this.starTimer > 0 ? 2.6 : 1.25;
    const coinRadiusY = this.starTimer > 0 ? 2.6 : 1.45;

    for (const coin of this.pools.coins) {
      if (!coin.active) continue;

      if (magnetRadius > 0 && coin.z > -11 && coin.z < 2) {
        const dx = this.playerX - coin.x;
        const dy = playerCenterY - coin.y;
        const dz = -coin.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq < magnetRadius * magnetRadius) {
          const pull = 1 - Math.exp(-12.5 * dt);
          coin.x += dx * pull;
          coin.y += dy * pull;
          coin.z += dz * pull * 0.5;
        }
      }

      if (
        Math.abs(coin.z) < 1.45 &&
        Math.abs(coin.x - this.playerX) < coinRadiusX &&
        Math.abs(coin.y - playerCenterY) < coinRadiusY
      ) {
        coin.active = false;
        coin.mesh.visible = false;
        this.runCoins++;
        this.score += Math.round(15 * DIFFICULTIES[this.difficultyId].scoreMultiplier);
        this.audio.play('coin');
      }
    }

    // 2. Power-ups (Sword & Star)
    for (const pu of this.pools.powerups) {
      if (!pu.active) continue;
      const puX = LANE_X[pu.lane];
      if (Math.abs(pu.z) < 1.65 && Math.abs(puX - this.playerX) < 1.35 && effectiveY < 3.4) {
        pu.active = false;
        pu.group.visible = false;
        if (pu.kind === 'sword') {
          this.activeSwordDuration = SWORD_DURATION + charCfg.perks.swordDurationBonus;
          this.swordTimer = this.activeSwordDuration;
          this.addBonus(
            100,
            charCfg.perks.swordDurationBonus > 0 ? 'Flame Sword Active!' : 'Energy Sword Active!',
          );
          this.audio.play('sword');
          this.pools.spawnBurst(puX, 1.5, 0, charCfg.slashColor, 14);
        } else {
          this.starTimer = STAR_DURATION;
          this.addBonus(120, 'Star Flight · Stunts Ready!');
          this.audio.play('star');
        }
      }
    }

    // 3. Obstacles (Star flight grants complete obstacle immunity)
    if (this.starTimer > 0) return;

    const autoCutRangeZ = -4.2 - charCfg.perks.swordReachBonus * 0.45;

    for (const obs of this.pools.obstacles) {
      if (!obs.active || obs.sliced) continue;
      const obsX = LANE_X[obs.lane];
      const halfDepth =
        obs.kind === 'special' && this.world.getCurrentSceneId() === 'cyber_foundry' ? 2.15 : 1.05;

      // Signature Sword slices cleanly through obstacles with 3-hit combo swings & hit-stop!
      if (
        this.swordTimer > 0 &&
        Math.abs(obsX - this.playerX) < 1.35 &&
        obs.z > autoCutRangeZ &&
        obs.z < 1.1
      ) {
        this.slashTimer = SLASH_DURATION;
        const comboStep = this.slashComboIndex;
        this.slashComboIndex = (this.slashComboIndex + 1) % 3;
        const cutDir = comboStep === 1 ? -1 : 1;
        const comboLabel =
          comboStep === 0 ? 'Forehand Cleave' : comboStep === 1 ? 'Reverse Slash' : 'Whirlwind Cut';
        this.pools.sliceObstacle(obs, charCfg.slashColor, cutDir);
        this.onRealBoxCutImpact();
        const pts = Math.round((comboStep === 2 ? 95 : 75) * charCfg.perks.stuntBonusMult);
        this.addBonus(pts, `${comboLabel} +${pts}`);
        continue;
      }

      if (Math.abs(obs.z) < halfDepth && Math.abs(obsX - this.playerX) < 1.08) {
        let hit = false;
        if (obs.kind === 'crate') {
          hit = this.playerY < 1.25;
        } else if (obs.kind === 'overhead') {
          hit = playerTopY > 1.36 && this.playerY < 2.35;
        } else {
          // Tall world monoliths are unjumpable on foot (must dodge lanes, sword-slice, or Star Fly!)
          hit = this.playerY < 5.0;
        }

        if (hit && this.invulnTimer <= 0) {
          this.handleObstacleHit(obs);
          break;
        }
      }
    }
  }

  private handleObstacleHit(obs: { lane: number; z: number; sliced: boolean }): void {
    const charCfg = getCharacterById(this.characterId);
    obs.sliced = true;

    if (this.shields > 0) {
      this.shields--;
      this.invulnTimer = INVULNERABLE_DURATION + charCfg.perks.extraInvulnSeconds;
      this.cameraShake = 0.35;
      this.villain.triggerSurge(5.2);
      this.audio.play('spin');
      this.audio.play('villainSurge');
      this.pools.spawnBurst(this.playerX, this.playerY + 1.1, 0, 0xa78bfa, 22);
      this.stuntBanner = 'Void Shield Absorbed Hit!';
      this.stuntBannerTimer = 1.4;
      this.emitHud();
      return;
    }

    this.lives--;
    this.stumbleTimer = STUMBLE_DURATION;
    this.invulnTimer = INVULNERABLE_DURATION + charCfg.perks.extraInvulnSeconds;
    this.cameraShake = 0.55;
    this.pools.spawnBurst(this.playerX, this.playerY + 1.1, 0, 0xf43f5e, 16);

    if (this.lives <= 0) {
      this.lives = 0;
      this.screen = 'gameover';
      this.spatialAudio.setActivity(false, 0, this.playerX);
      this.audio.play('gameOver');
      this.emitHud();
      this.callbacks.onGameOver({
        score: Math.floor(this.score),
        distance: Math.floor(this.distance),
        runCoins: this.runCoins,
      });
    } else {
      this.villain.triggerSurge(6.5);
      this.audio.play('hit');
      this.audio.play('villainSurge');
      this.stuntBanner = `Hunter Closing In! ${this.lives} ${this.lives === 1 ? 'life' : 'lives'} left`;
      this.stuntBannerTimer = 1.45;
      this.emitHud();
    }
  }

  private emitHud(): void {
    const currentId = SCENE_ORDER[this.sceneIndex];
    const sceneProgress = (this.distance % SCENE_SWITCH_DISTANCE) / SCENE_SWITCH_DISTANCE;

    this.callbacks.onHudUpdate({
      score: Math.floor(this.score),
      distance: Math.floor(this.distance),
      runCoins: this.runCoins,
      lives: this.lives,
      maxLives: this.maxLives,
      shields: this.shields,
      speed: Math.round(this.speed),
      characterId: this.characterId,
      sceneId: currentId,
      sceneName: SCENE_NAMES[currentId],
      sceneProgress,
      swordRemaining: this.swordTimer,
      swordDuration: this.activeSwordDuration,
      starRemaining: this.starTimer,
      starDuration: STAR_DURATION,
      stuntBanner: this.stuntBanner,
      sceneFadeOpacity: this.fadeOpacity,
      portalWarpColor: this.portalWarpColor,
      portalDestination: this.portalDestination,
      sceneToast: this.sceneToast,
      villainThreat: this.villain.getThreatLevel(),
      yetiSource: this.yetiSource,
    });
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    window.clearTimeout(this.frameId);

    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.handleKeyDown);
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('touchstart', this.handleTouchStart);
    canvas.removeEventListener('touchmove', this.handleTouchMove);
    canvas.removeEventListener('touchend', this.handleTouchEnd);
    canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);

    this.world.dispose();
    this.portal.dispose();
    this.yeti.dispose();
    this.villain.dispose();
    this.pools.dispose();
    this.audio.dispose();
    this.spatialAudio.dispose();
    this.renderer.dispose();
    if (canvas.parentElement === this.container) {
      this.container.removeChild(canvas);
    }
  }
}
