import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { SoundManager } from './audio';
import {
  DIFFICULTIES,
  DOUBLE_JUMP_VELOCITY,
  GRAVITY,
  HUNTER_OUTRUN_DISTANCE,
  INVULNERABLE_DURATION,
  JUMP_VELOCITY,
  LANE_X,
  SCENE_NAMES,
  SCENE_ORDER,
  SCENE_PORTAL_THEME,
  SCENE_SWITCH_DISTANCE,
  SLASH_DURATION,
  SLIDE_DURATION,
  SLIDE_ZONE_END_RATIO,
  SLIDE_ZONE_START_RATIO,
  SPIN_DURATION,
  STAR_DURATION,
  STAR_FLY_HEIGHT,
  STUMBLE_DURATION,
  SWORD_DURATION,
  computeProgressiveSpeed,
  getCharacterById,
} from './config';
import { MusicBeatEngine } from './musicEngine';
import { EntityPoolManager } from './pools';
import { RunReplayRecorder, type PoolReplayEntities } from './replayRecorder';
import { WorldManager } from './scenes';
import { SpatialWorldAudioManager } from './spatialAudio';
import type {
  ActiveRunLoadout,
  CharacterId,
  DifficultyId,
  GameScreen,
  HudSnapshot,
  MusicBeatId,
  SceneId,
} from './types';
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
  public readonly music: MusicBeatEngine;
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

  // Power-ups & Store Loadout
  private swordTimer = 0;
  private activeSwordDuration = SWORD_DURATION;
  private starTimer = 0;
  private activeStarDuration = STAR_DURATION;
  private doubleCoinsActive = false;
  private loadout: ActiveRunLoadout = {
    upgrades: { magnet: 0, sword: 0, star: 0, shield: 0, yield: 0 },
    activeBoosters: [],
  };

  // Scene progression, Hunter outrun & World Slide / Space Float state
  private sceneIndex = 0;
  private nextPortalDistance = SCENE_SWITCH_DISTANCE;
  private nextSpeedSurgeDistance = 1500;
  private cleanRunDistance = 0;
  private hunterActive = true;
  private worldSlideActive = false;
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

  // 5-second rolling Perfect Stunt 3D Replay Recorder & Playback state
  private replayRecorder = new RunReplayRecorder();
  private replayActive = false;
  private replayStuntLabel: string | null = null;
  private replayProgress = 0;
  private replayRecordedSec = 0;
  private replaySlowMo = false;
  private replayCooldown = 0;
  private replayCameraSide: -1 | 1 = 1;
  private replayVisualElapsed = 0;
  private replaySceneId: SceneId = 'frost_sanctuary';
  private replaySlideMode = false;
  private pendingPerfectReplayTimer = 0;
  private pendingPerfectStuntLabel: string | null = null;
  private liveReplayRestore: {
    sceneId: SceneId;
    worldSlideActive: boolean;
    playerX: number;
    playerY: number;
    entities: PoolReplayEntities;
  } | null = null;
  private closeSlideAwardedObs = new WeakSet<object>();

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
    musicEnabled: boolean,
    musicBeat: MusicBeatId,
    callbacks: EngineCallbacks,
  ) {
    this.container = container;
    this.callbacks = callbacks;
    this.characterId = initialCharacter;
    this.difficultyId = initialDifficulty;
    this.isSoftwareGl = detectSoftwareWebGL();

    this.audio = new SoundManager();
    this.audio.setEnabled(sfxEnabled);
    this.music = new MusicBeatEngine();
    this.music.setEnabled(musicEnabled);
    this.music.setBeatSelection(musicBeat);
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
    this.yeti = new YetiController(
      initialCharacter,
      (src) => {
        this.yetiSource = src;
        this.emitHud();
      },
      maxAniso,
    );
    this.scene.add(this.yeti.root);
    this.scene.add(this.yeti.swordTrailMesh);
    this.villain = new VillainChaserController();
    this.scene.add(this.villain.root);
    this.pools = new EntityPoolManager(this.scene, maxAniso);
    this.pools.setDifficulty(initialDifficulty);

    // Open showcase in the equipped Yeti's dedicated home world
    const initialHome = getCharacterById(initialCharacter).homeWorldId;
    const homeIdx = Math.max(0, SCENE_ORDER.indexOf(initialHome));
    this.sceneIndex = homeIdx;
    const startWorld = SCENE_ORDER[homeIdx];
    this.world.activateScene(startWorld);
    this.pools.setScene(startWorld);
    this.spatialAudio.setWorld(startWorld);
    this.music.setWorld(startWorld);
    this.music.setState('menu', 0, false, false);

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
    if (
      screen === 'menu' ||
      screen === 'character' ||
      screen === 'store' ||
      screen === 'web3' ||
      screen === 'settings'
    ) {
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
      this.cleanRunDistance = 0;
      this.hunterActive = true;
      this.worldSlideActive = false;
      this.world.setSlideMode(false);
      this.pools.setSlideMode(false);
      this.replayActive = false;
      this.replayStuntLabel = null;
      this.replayProgress = 0;
      this.replayRecordedSec = 0;
      this.replaySlowMo = false;
      this.pendingPerfectReplayTimer = 0;
      this.pendingPerfectStuntLabel = null;
      this.liveReplayRestore = null;
      this.replayRecorder.reset();
    }
    this.spatialAudio.setActivity(screen === 'playing', 0, this.playerX);
    if (screen === 'playing') {
      this.music.unlock();
      this.music.setState(this.replayActive ? 'replay' : 'playing', 0, this.starTimer > 0, this.replaySlowMo);
    } else if (screen === 'paused') {
      this.music.setState('paused', 0, false, false);
    } else if (screen === 'gameover') {
      this.music.setState('gameover', 0, false, false);
    } else {
      this.music.setState('menu', 0, false, false);
    }
    this.emitHud();
  }

  public skipReplay(): void {
    if (!this.replayActive) return;
    this.finishReplay();
  }

  public setLoadout(loadout: ActiveRunLoadout): void {
    this.loadout = {
      upgrades: { ...loadout.upgrades },
      activeBoosters: [...loadout.activeBoosters],
    };
  }

  public setCharacter(charId: CharacterId, playEmote = false): void {
    this.characterId = charId;
    this.yeti.setCharacter(charId, playEmote);
    this.emitHud();
  }

  public setDifficulty(diff: DifficultyId): void {
    this.difficultyId = diff;
    this.pools.setDifficulty(diff);
  }

  public setSfxEnabled(enabled: boolean): void {
    this.audio.setEnabled(enabled);
    this.spatialAudio.setEnabled(enabled);
    if (enabled) {
      this.spatialAudio.unlock();
    }
  }

  public setMusicEnabled(enabled: boolean): void {
    this.music.setEnabled(enabled);
  }

  public setMusicBeat(beat: MusicBeatId): void {
    this.music.setBeatSelection(beat);
    this.music.unlock();
  }

  public unlockAudio(): void {
    this.spatialAudio.unlock();
    this.music.unlock();
  }

  public previewScene(sceneId: SceneId): void {
    const idx = SCENE_ORDER.indexOf(sceneId);
    if (idx >= 0) {
      this.sceneIndex = idx;
      this.world.activateScene(sceneId);
      this.pools.setScene(sceneId);
      this.spatialAudio.unlock();
      this.spatialAudio.setWorld(sceneId);
      this.music.unlock();
      this.music.setWorld(sceneId);
      this.emitHud();
    }
  }

  public startRun(): void {
    const diff = DIFFICULTIES[this.difficultyId];
    const charCfg = getCharacterById(this.characterId);
    const upg = this.loadout.upgrades;
    const boosters = new Set(this.loadout.activeBoosters);

    const hasHeadstart = boosters.has('headstart');
    const hasStarterSword = boosters.has('starter_sword');
    const hasExtraShield = boosters.has('extra_shield');
    this.doubleCoinsActive = boosters.has('double_coins');

    this.score = hasHeadstart ? Math.round(350 * 1.5 * diff.scoreMultiplier) : 0;
    this.distance = hasHeadstart ? 350 : 0;
    this.runCoins = 0;
    this.lives = diff.lives;
    this.maxLives = diff.lives;
    this.shields =
      charCfg.perks.startShields + (upg.shield >= 3 ? 1 : 0) + (hasExtraShield ? 1 : 0);
    this.speed = diff.startSpeed;

    this.lane = 1;
    this.playerX = 0;
    this.prevPlayerX = 0;
    this.playerY = hasHeadstart ? STAR_FLY_HEIGHT * 0.65 : 0;
    this.velocityY = 0;
    this.isGrounded = !hasHeadstart;
    this.jumpsUsed = 0;

    this.slideTimer = 0;
    this.flipTimer = 0;
    this.spinTimer = 0;
    this.slashTimer = 0;
    this.slashComboIndex = 0;
    this.stumbleTimer = 0;
    this.invulnTimer = hasHeadstart ? 1.5 : 0;
    this.flyBarrelTimer = 0;
    this.flyLoopTimer = 0;
    this.flySwoopTimer = 0;
    this.hitStopTimer = 0;

    this.activeSwordDuration =
      SWORD_DURATION + charCfg.perks.swordDurationBonus + upg.sword * 1.2;
    this.activeStarDuration = STAR_DURATION + upg.star * 1.0;
    this.swordTimer = hasStarterSword ? this.activeSwordDuration : 0;
    this.starTimer = hasHeadstart ? Math.max(4.0, 4.0 + upg.star * 0.4) : 0;
    if (this.starTimer > this.activeStarDuration) {
      this.activeStarDuration = this.starTimer;
    }
    this.cameraShake = 0;
    this.cameraFovKick = hasHeadstart ? 6.5 : 0;
    this.trailAccum = 0;

    // Reset 5-second rolling stunt replay recorder
    this.replayRecorder.reset();
    this.replayActive = false;
    this.replayStuntLabel = null;
    this.replayProgress = 0;
    this.replayRecordedSec = 0;
    this.replaySlowMo = false;
    this.replayCooldown = 1.5;
    this.pendingPerfectReplayTimer = 0;
    this.pendingPerfectStuntLabel = null;
    this.liveReplayRestore = null;
    this.closeSlideAwardedObs = new WeakSet<object>();

    const homeIdx = Math.max(0, SCENE_ORDER.indexOf(charCfg.homeWorldId));
    this.sceneIndex = homeIdx;
    this.nextPortalDistance = SCENE_SWITCH_DISTANCE;
    this.nextSpeedSurgeDistance = 1500;
    this.cleanRunDistance = hasHeadstart ? HUNTER_OUTRUN_DISTANCE : 0;
    this.hunterActive = !hasHeadstart;
    this.worldSlideActive = false;
    const startSceneId = SCENE_ORDER[homeIdx];

    this.fadeOpacity = 0;
    this.portalWarpColor = SCENE_PORTAL_THEME[startSceneId].flashHex;
    this.portalDestination = null;
    this.portal.hide();
    this.sceneToast = SCENE_NAMES[startSceneId];
    this.sceneToastTimer = 2.0;

    const activeBoosterLabels: string[] = [];
    if (hasHeadstart) activeBoosterLabels.push('Headstart 350m');
    if (hasStarterSword) activeBoosterLabels.push('Ignited Blade');
    if (this.doubleCoinsActive) activeBoosterLabels.push('2x SUI');
    if (hasExtraShield) activeBoosterLabels.push('+1 Shield');
    this.stuntBanner =
      activeBoosterLabels.length > 0
        ? activeBoosterLabels.join(' · ')
        : `${charCfg.name} · ${charCfg.perkName}`;
    this.stuntBannerTimer = 2.0;

    this.world.activateScene(startSceneId);
    this.world.setSlideMode(false);
    this.pools.setDifficulty(this.difficultyId);
    this.pools.reset();
    this.pools.setScene(startSceneId);
    this.pools.setSlideMode(false);
    if (hasHeadstart) {
      this.pools.clearObstaclesInRange(-95, 12);
    }
    this.yeti.clearSwordTrail();
    if (this.hunterActive) {
      this.villain.startChase();
    } else {
      this.villain.hide();
    }

    this.screen = 'playing';
    this.audio.play(hasHeadstart ? 'star' : 'uiClick');
    this.spatialAudio.unlock();
    this.spatialAudio.setWorld(startSceneId);
    this.spatialAudio.setActivity(true, 0, 0);
    this.music.unlock();
    this.music.setWorld(startSceneId);
    this.music.setState('playing', 0, hasHeadstart, false);
    this.emitHud();
  }

  public moveLeft(): void {
    if (this.screen !== 'playing' || this.replayActive) return;
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
    if (this.screen !== 'playing' || this.replayActive) return;
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
    if (this.screen !== 'playing' || this.replayActive) return;
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
        this.triggerPerfectStunt('Sky Loop');
      }
      return;
    }

    // While Floating in Cyborg Space -> playful Zero-G Cosmic Backflip!
    if (this.worldSlideActive && SCENE_ORDER[this.sceneIndex] === 'cyber_foundry') {
      if (this.flipTimer <= 0) {
        this.flipTimer = this.flipDuration;
        this.yeti.triggerJumpLaunch(true);
        const pts = Math.round(45 * charCfg.perks.stuntBonusMult);
        this.addBonus(pts, `Zero-G Flip +${pts}`);
        this.audio.play('flip');
        this.triggerPerfectStunt('Zero-G Flip');
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
      this.pools.spawnBurst(this.playerX, this.playerY + 0.2, 0.2, charCfg.trailColor, 6);
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

      // Perfect Backflip if vaulting cleanly over an obstacle or executing at high jump apex!
      const vaultingObs = this.hasNearbyLaneObstacle(-12.5, 2.2);
      if (vaultingObs) {
        this.triggerPerfectStunt('Backflip Vault');
      } else if (this.playerY >= 1.4) {
        this.triggerPerfectStunt('Apex Backflip');
      }
    }
  }

  public triggerSlide(): void {
    if (this.screen !== 'playing' || this.replayActive) return;
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

    // While Floating in Cyborg Space -> Zero-G Barrel Spin!
    if (this.worldSlideActive && SCENE_ORDER[this.sceneIndex] === 'cyber_foundry') {
      if (this.spinTimer <= 0) {
        this.spinTimer = SPIN_DURATION;
        this.audio.play('spin');
        const pts = Math.round(35 * charCfg.perks.stuntBonusMult);
        this.addBonus(pts, `Zero-G Spin +${pts}`);
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
    if (this.screen !== 'playing' || this.replayActive) return;
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
        this.triggerPerfectStunt('Star Corkscrew');
      }
      return;
    }

    if (!this.isGrounded && this.spinTimer <= 0) {
      const chainedFromFlip = this.flipTimer > 0;
      this.spinTimer = SPIN_DURATION;
      this.velocityY = Math.max(this.velocityY, 4.2 + charCfg.perks.spinHangBoost);
      const pts = Math.round(40 * charCfg.perks.stuntBonusMult);
      this.addBonus(pts, `Tail-Whip Spin +${pts}`);
      this.audio.play('spin');
      this.pools.spawnBurst(this.playerX, this.playerY + 1.0, 0, charCfg.accentColor, 10);

      if (chainedFromFlip) {
        this.triggerPerfectStunt('Aerial Flip-Spin');
      } else if (this.hasNearbyLaneObstacle(-11.5, 2.2)) {
        this.triggerPerfectStunt('Tail-Whip Vault');
      }
    }
  }

  public triggerSlash(): void {
    if (this.screen !== 'playing' || this.replayActive) return;
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
      const reachZ = -12.5 - charCfg.perks.swordReachBonus - this.loadout.upgrades.sword * 0.6;
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
        this.triggerPerfectStunt(comboStep === 2 ? 'Whirlwind Cut' : 'Blade Cleave');
      }
    }
  }

  private hasNearbyLaneObstacle(minZ: number, maxZ: number): boolean {
    for (const obs of this.pools.obstacles) {
      if (!obs.active || obs.sliced) continue;
      if (obs.lane === this.lane && obs.z >= minZ && obs.z <= maxZ) {
        return true;
      }
    }
    return false;
  }

  private triggerPerfectStunt(stuntLabel: string): void {
    if (this.replayActive || this.screen !== 'playing') return;
    const charCfg = getCharacterById(this.characterId);
    const perfectBonus = Math.round(150 * charCfg.perks.stuntBonusMult);
    this.addBonus(perfectBonus, `PERFECT · ${stuntLabel} +${perfectBonus}`);
    this.cameraFovKick = Math.max(this.cameraFovKick, 6.2);
    this.pools.spawnBurst(this.playerX, this.playerY + 1.25, 0, 0xfde047, 18);
    this.pools.spawnBurst(this.playerX, this.playerY + 1.1, 0, charCfg.accentColor, 14);

    // Queue a brief follow-through so the 5-second recording captures the stunt apex, then launch 3D replay
    if (
      this.pendingPerfectReplayTimer <= 0 &&
      this.replayCooldown <= 0 &&
      !this.portal.isActive() &&
      this.fadeOpacity <= 0.05 &&
      this.replayRecorder.hasEnoughFootage()
    ) {
      this.pendingPerfectStuntLabel = stuntLabel;
      this.pendingPerfectReplayTimer = 0.34;
    }
  }

  private beginPerfectReplay(stuntLabel: string): void {
    if (this.replayActive || this.screen !== 'playing') return;
    const liveSceneId = SCENE_ORDER[this.sceneIndex];
    const entities = this.pools.captureReplayEntities();
    const started = this.replayRecorder.beginReplay(stuntLabel);
    if (!started) return;

    this.liveReplayRestore = {
      sceneId: liveSceneId,
      worldSlideActive: this.worldSlideActive,
      playerX: this.playerX,
      playerY: this.playerY,
      entities,
    };
    this.replayActive = true;
    this.replayStuntLabel = stuntLabel;
    this.replayProgress = 0;
    this.replayRecordedSec = this.replayRecorder.getRecordedDuration();
    this.replaySlowMo = false;
    this.replayVisualElapsed = this.elapsed;
    this.replaySceneId = liveSceneId;
    this.replaySlideMode = this.worldSlideActive;
    // Orbit camera toward open center of track so side architecture never blocks the hero view
    this.replayCameraSide = this.playerX >= 0 ? -1 : 1;
    this.stuntBanner = null;
    this.stuntBannerTimer = 0;
    this.yeti.clearSwordTrail();
    this.spatialAudio.setActivity(true, 0.25, this.playerX);
    this.music.setState('replay', 0.2, false, false);
    this.emitHud();
  }

  private finishReplay(): void {
    if (!this.replayActive) return;
    this.replayRecorder.stopReplay();
    this.replayRecorder.reset();
    this.replayActive = false;
    this.replayStuntLabel = null;
    this.replayProgress = 0;
    this.replayRecordedSec = 0;
    this.replaySlowMo = false;
    this.replayCooldown = 12.0;

    if (this.liveReplayRestore) {
      const restore = this.liveReplayRestore;
      this.liveReplayRestore = null;
      if (this.replaySceneId !== restore.sceneId) {
        this.world.activateScene(restore.sceneId);
        this.pools.setScene(restore.sceneId);
      }
      if (this.replaySlideMode !== restore.worldSlideActive) {
        this.world.setSlideMode(restore.worldSlideActive);
        this.pools.setSlideMode(restore.worldSlideActive);
      }
      this.pools.restoreLiveEntities(restore.entities);
      this.playerX = restore.playerX;
      this.prevPlayerX = restore.playerX;
      this.playerY = restore.playerY;
      this.yeti.root.position.set(this.playerX, 0, 0);
    }

    // Brief grace invulnerability so resuming from the 3D replay camera always feels fair and smooth
    this.invulnTimer = Math.max(this.invulnTimer, 1.65);
    this.cameraFovKick = 3.2;
    this.stuntBanner = 'Back to Run!';
    this.stuntBannerTimer = 0.85;

    // Snap camera close to chase vantage so transition back to forward view is instant and readable
    const isPortrait = this.camera.aspect < 0.85;
    this.camera.position.set(
      this.playerX * 0.62,
      (isPortrait ? 5.25 : 4.55) + this.playerY * 0.55,
      (isPortrait ? 10.6 : 8.5) + (this.starTimer > 0 ? 1.5 : 0),
    );
    _camLookAt.set(this.playerX * 0.45, 1.95 + this.playerY * 0.62, -16);
    this.camera.lookAt(_camLookAt);
    this.music.setState('playing', 0.3, this.starTimer > 0, false);
    this.emitHud();
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
    const starStuntMult = this.starTimer > 0 ? 1 + this.loadout.upgrades.star * 0.1 : 1;
    this.score += Math.round(points * starStuntMult * DIFFICULTIES[this.difficultyId].scoreMultiplier);
    this.stuntBanner = label;
    this.stuntBannerTimer = 1.15;
    this.emitHud();
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    const code = e.code;
    this.spatialAudio.unlock();
    this.music.unlock();

    if (this.screen === 'playing') {
      if (this.replayActive) {
        if (['Space', 'Enter', 'Escape'].includes(code)) {
          e.preventDefault();
          this.skipReplay();
        }
        return;
      }
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
    this.music.unlock();
    if (this.screen !== 'playing' || e.touches.length === 0) return;
    e.preventDefault();
    const t = e.touches[0];
    this.touchStartX = t.clientX;
    this.touchStartY = t.clientY;
    this.touchStartTime = performance.now();
    this.touchHandledSwipe = false;
  };

  private handleTouchMove = (e: TouchEvent): void => {
    if (this.screen !== 'playing' || this.replayActive || this.touchHandledSwipe || e.touches.length === 0) return;
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
    if (this.replayActive) {
      this.skipReplay();
      return;
    }
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
      if (this.replayActive) {
        this.updateReplay(dt);
      } else {
        this.updatePlaying(dt);
      }
    } else if (
      this.screen === 'menu' ||
      this.screen === 'character' ||
      this.screen === 'store' ||
      this.screen === 'web3' ||
      this.screen === 'settings'
    ) {
      this.updateShowcase(dt);
    } else if (this.screen === 'gameover') {
      this.updateGameOverIdle(dt);
    }

    this.spatialAudio.update(dt);
    this.renderer.render(this.scene, this.camera);
    this.scheduleNextFrame();
  }

  private updateShowcase(dt: number): void {
    this.world.update(dt, 4.0, this.elapsed);

    const isCharScreen = this.screen === 'character';
    const aspect = this.camera.aspect;

    // Smooth, living showcase camera orbit with gentle breathing elevation
    const camX = isCharScreen
      ? Math.sin(this.elapsed * 0.58) * 1.15
      : Math.sin(this.elapsed * 0.42) * 1.05;
    const camY =
      (isCharScreen ? 1.82 : 2.15) + Math.sin(this.elapsed * 1.15) * 0.08;
    const camZ = isCharScreen
      ? aspect < 0.85
        ? 4.95
        : 3.95
      : aspect < 0.85
        ? 6.45
        : 5.25;

    _camTargetPos.set(camX, camY, camZ);
    this.camera.position.lerp(_camTargetPos, 1 - Math.exp(-5.5 * dt));

    _camLookAt.set(
      Math.sin(this.elapsed * 0.42) * 0.12,
      isCharScreen ? 1.24 : 1.42,
      -1.2,
    );
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
      isChasing: true,
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

    this.speed = computeProgressiveSpeed(diff, this.distance);
    const slideSpeedMult = this.worldSlideActive ? 1.15 : 1.0;
    const activeSpeed = this.speed * slideSpeedMult * (this.starTimer > 0 ? 1.24 : 1.0);
    const stepDist = activeSpeed * dt;
    this.distance += stepDist;
    this.score += stepDist * 1.5 * diff.scoreMultiplier;

    // Subtle speed-surge feedback on sustained long runs
    if (this.distance >= this.nextSpeedSurgeDistance) {
      const isOverdrive = this.speed >= diff.maxSpeed;
      this.nextSpeedSurgeDistance += 1500;
      this.cameraFovKick = Math.max(this.cameraFovKick, isOverdrive ? 5.5 : 3.8);
      if (!this.stuntBanner) {
        this.stuntBanner = isOverdrive
          ? `Overdrive Pace · ${Math.round(this.speed)} m/s`
          : `Speed Surge · ${Math.round(this.speed)} m/s`;
        this.stuntBannerTimer = 1.45;
      }
    }

    // Hunter drops off after running cleanly for HUNTER_OUTRUN_DISTANCE (returns only if player hits an obstacle!)
    this.cleanRunDistance += stepDist;
    if (this.hunterActive && this.cleanRunDistance >= HUNTER_OUTRUN_DISTANCE) {
      this.hunterActive = false;
      this.stuntBanner = 'Hunter Outrun!';
      this.stuntBannerTimer = 1.5;
    }

    // Mid-world transformation: Road turns into world-specific Slide Chute or Cyber Zero-G Space Float!
    const currentSceneId = SCENE_ORDER[this.sceneIndex];
    const worldStartDist = this.nextPortalDistance - SCENE_SWITCH_DISTANCE;
    const worldRatio = (this.distance - worldStartDist) / SCENE_SWITCH_DISTANCE;
    const shouldSlide =
      worldRatio >= SLIDE_ZONE_START_RATIO &&
      worldRatio < SLIDE_ZONE_END_RATIO &&
      !this.portal.isActive();

    if (shouldSlide !== this.worldSlideActive) {
      this.worldSlideActive = shouldSlide;
      this.world.setSlideMode(shouldSlide);
      this.pools.setSlideMode(shouldSlide);
      this.pools.clearObstaclesInRange(-52, 12);
      this.cameraFovKick = Math.max(this.cameraFovKick, 6.5);
      if (shouldSlide) {
        const slideTitle =
          currentSceneId === 'frost_sanctuary'
            ? 'SNOW SLIDE!'
            : currentSceneId === 'inferno_caldera'
              ? 'MAGMA SLIDE!'
              : currentSceneId === 'slime_catacombs'
                ? 'SLIME SLIDE!'
                : currentSceneId === 'cyber_foundry'
                  ? 'FLOATING TO SPACE!'
                  : 'BLACKHOLE SLIDE!';
        this.sceneToast = slideTitle;
        this.sceneToastTimer = 2.1;
        this.stuntBanner =
          currentSceneId === 'cyber_foundry'
            ? 'Zero-G Space Drift · Dodge & Collect!'
            : 'Carve the Chute · Speed Boost!';
        this.stuntBannerTimer = 1.8;
        this.audio.play('flyStunt');
      } else {
        this.invulnTimer = Math.max(this.invulnTimer, 0.85);
        this.stuntBanner = 'Back on Track!';
        this.stuntBannerTimer = 1.25;
      }
      this.emitHud();
    }

    // Physical 3D World Portal Gate spawns approaching every biome boundary
    if (!this.portal.isActive() && this.distance >= this.nextPortalDistance - 155) {
      const nextIdx = (this.sceneIndex + 1) % SCENE_ORDER.length;
      const nextId = SCENE_ORDER[nextIdx];
      this.portal.spawn(nextId, -155);
      this.portalDestination = SCENE_NAMES[nextId];
      this.pools.clearObstaclesInRange(-170, -108);
      this.emitHud();
    }

    const portalStatus = this.portal.update(dt, activeSpeed, this.elapsed);
    if (portalStatus === 'crossed') {
      const nextId = this.portal.getDestinationSceneId();
      this.sceneIndex = Math.max(0, SCENE_ORDER.indexOf(nextId));
      this.nextPortalDistance += SCENE_SWITCH_DISTANCE;
      this.worldSlideActive = false;
      this.world.activateScene(nextId);
      this.world.setSlideMode(false);
      this.pools.setScene(nextId);
      this.pools.setSlideMode(false);
      this.pools.clearObstaclesInRange(-52, 8);
      this.spatialAudio.setWorld(nextId);
      this.music.setWorld(nextId);

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

    // Crisp, responsive lateral lane damping that tightens smoothly as progressive speed climbs
    const speedRatioPre = THREE.MathUtils.clamp(
      (activeSpeed - diff.startSpeed) / Math.max(1, diff.maxSpeed + 16 - diff.startSpeed),
      0,
      1,
    );
    this.prevPlayerX = this.playerX;
    const targetX = LANE_X[this.lane];
    this.playerX = THREE.MathUtils.damp(this.playerX, targetX, 21 + speedRatioPre * 8, dt);
    const laneVelocity = (this.playerX - this.prevPlayerX) / Math.max(dt, 0.001);

    const activeSceneNow = SCENE_ORDER[this.sceneIndex];
    const isCyberSpaceFloat = this.worldSlideActive && activeSceneNow === 'cyber_foundry';
    const slideFloorY =
      this.worldSlideActive && !isCyberSpaceFloat
        ? Math.max(0, 5.56 - Math.sqrt(Math.max(1, 5.6 * 5.6 - this.playerX * this.playerX)))
        : 0;

    // Vertical physics (Star flight vs Cyber Zero-G Space Float vs gravity jump + curved slide chute)
    if (this.starTimer > 0) {
      this.playerY = THREE.MathUtils.damp(this.playerY, STAR_FLY_HEIGHT, 7, dt);
      this.velocityY = 0;
      this.isGrounded = false;
      this.slideTimer = 0;
    } else if (isCyberSpaceFloat) {
      const floatTarget = 2.25 + Math.sin(this.elapsed * 2.8) * 0.22;
      this.playerY = THREE.MathUtils.damp(this.playerY, floatTarget, 6.5, dt);
      this.velocityY = 0;
      this.isGrounded = false;
      this.slideTimer = 0;
    } else {
      if (!this.isGrounded || this.playerY > slideFloorY + 0.02) {
        const effGravity = this.spinTimer > 0 ? GRAVITY * 0.8 : GRAVITY;
        this.velocityY -= effGravity * dt;
        this.playerY += this.velocityY * dt;
        if (this.playerY <= slideFloorY) {
          this.playerY = slideFloorY;
          this.velocityY = 0;
          if (!this.isGrounded) {
            this.audio.play('land');
            this.pools.spawnBurst(this.playerX, slideFloorY + 0.15, 0.15, charCfg.trailColor, 5);
          }
          this.isGrounded = true;
          this.jumpsUsed = 0;
          this.flipTimer = 0;
          this.spinTimer = 0;
        }
      } else {
        this.playerY = slideFloorY;
      }
    }

    this.yeti.root.position.set(this.playerX, 0, 0);
    // Keep track crystal clear — default continuous foot-trail particle emitter disabled!
    void this.trailAccum;

    const nearSlideBoundary =
      Math.abs(worldRatio - SLIDE_ZONE_START_RATIO) < 0.028 ||
      Math.abs(worldRatio - SLIDE_ZONE_END_RATIO) < 0.028;
    const pauseSpawnsForPortal =
      nearSlideBoundary ||
      this.distance >= this.nextPortalDistance - 165 ||
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
    else if (isCyberSpaceFloat) animState = 'spaceFloat';
    else if (!this.isGrounded) animState = 'jump';
    else if (this.slideTimer > 0) animState = 'slide';
    else if (this.worldSlideActive) animState = 'worldSlide';

    const speedRatio = THREE.MathUtils.clamp(
      (activeSpeed - diff.startSpeed) / Math.max(1, diff.maxSpeed + 16 - diff.startSpeed),
      0,
      1.2,
    );
    this.spatialAudio.setActivity(true, speedRatio, this.playerX);
    this.music.setState('playing', speedRatio, this.starTimer > 0, false);

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

    // Update pursuing 3D Villain Chaser (drops off behind camera once outrun; surges back on hit!)
    this.villain.update({
      dt,
      elapsed: this.elapsed,
      playerX: this.playerX,
      playerY: this.playerY,
      isPlayerSliding: this.slideTimer > 0,
      isPlayerFlying: this.starTimer > 0 || isCyberSpaceFloat,
      speedRatio,
      isChasing: this.hunterActive && !this.worldSlideActive,
      isGameOver: false,
      isMenuPreview: false,
    });

    if (this.replayCooldown > 0) {
      this.replayCooldown = Math.max(0, this.replayCooldown - dt);
    }

    // Record compact 30 Hz rolling 5-second snapshot for Perfect Stunt 3D Replay
    if (this.replayRecorder.shouldSample(dt)) {
      this.replayRecorder.pushFrame({
        time: this.elapsed,
        sceneId: activeSceneNow,
        worldSlideActive: this.worldSlideActive,
        playerX: this.playerX,
        playerY: this.playerY,
        velocityY: this.velocityY,
        laneVelocity,
        activeSpeed,
        speedRatio,
        animState,
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
        isChasing: this.hunterActive && !this.worldSlideActive,
        isPlayerSliding: this.slideTimer > 0,
        isPlayerFlying: this.starTimer > 0 || isCyberSpaceFloat,
        entities: this.pools.captureReplayEntities(),
      });
    }

    // Launch brief 3D replay right after the Perfect Stunt follow-through apex completes
    if (this.pendingPerfectReplayTimer > 0) {
      this.pendingPerfectReplayTimer = Math.max(0, this.pendingPerfectReplayTimer - dt);
      if (this.pendingPerfectReplayTimer === 0 && this.pendingPerfectStuntLabel) {
        const label = this.pendingPerfectStuntLabel;
        this.pendingPerfectStuntLabel = null;
        this.beginPerfectReplay(label);
        if (this.replayActive) return;
      }
    }

    // Dynamic chase camera framing the Yeti, slide chutes & towering horizon Titans
    const isPortrait = this.camera.aspect < 0.85;
    const baseCamZ = isPortrait ? 10.6 : 8.5;
    const baseCamY = isPortrait ? 5.25 : 4.55;
    const shakeX = this.cameraShake > 0 ? (Math.random() - 0.5) * this.cameraShake * 0.7 : 0;
    const shakeY = this.cameraShake > 0 ? (Math.random() - 0.5) * this.cameraShake * 0.5 : 0;

    _camTargetPos.set(
      this.playerX * 0.62 + shakeX,
      baseCamY + this.playerY * 0.55 + shakeY,
      baseCamZ + (this.starTimer > 0 || isCyberSpaceFloat ? 1.5 : 0),
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

  private updateReplay(dt: number): void {
    const sample = this.replayRecorder.step(dt);
    if (!sample) {
      this.finishReplay();
      return;
    }

    const { frame, nextFrame, alpha, progress, isSlowMo, playbackRate, done } = sample;
    const scaledDt = Math.min(0.05, dt * playbackRate);
    this.replayVisualElapsed += scaledDt;
    this.replayProgress = progress;
    this.replaySlowMo = isSlowMo;
    this.music.setState('replay', frame.speedRatio, frame.starActive, isSlowMo);

    // Sync biome/slide visuals if the 5-second clip crossed a transition
    if (frame.sceneId !== this.replaySceneId) {
      this.replaySceneId = frame.sceneId;
      this.world.activateScene(frame.sceneId);
      this.pools.setScene(frame.sceneId);
    }
    if (frame.worldSlideActive !== this.replaySlideMode) {
      this.replaySlideMode = frame.worldSlideActive;
      this.world.setSlideMode(frame.worldSlideActive);
      this.pools.setSlideMode(frame.worldSlideActive);
    }

    const interpX = nextFrame
      ? THREE.MathUtils.lerp(frame.playerX, nextFrame.playerX, alpha)
      : frame.playerX;
    const interpY = nextFrame
      ? THREE.MathUtils.lerp(frame.playerY, nextFrame.playerY, alpha)
      : frame.playerY;
    const interpVelY = nextFrame
      ? THREE.MathUtils.lerp(frame.velocityY, nextFrame.velocityY, alpha)
      : frame.velocityY;
    const interpLaneVel = nextFrame
      ? THREE.MathUtils.lerp(frame.laneVelocity, nextFrame.laneVelocity, alpha)
      : frame.laneVelocity;

    const lerpCycle = (a: number, b: number): number =>
      nextFrame && b >= a ? THREE.MathUtils.lerp(a, b, alpha) : a;

    // Scroll world & apply interpolated pooled obstacles/coins/powerups
    this.world.update(scaledDt, frame.activeSpeed, this.replayVisualElapsed, interpX);
    this.pools.applyReplayEntities(
      frame.entities,
      nextFrame ? nextFrame.entities : null,
      alpha,
      this.replayVisualElapsed,
    );

    // Drive Yeti rig with interpolated recorded kinematics
    this.yeti.root.position.set(interpX, 0, 0);
    this.yeti.update({
      dt: scaledDt,
      elapsed: this.replayVisualElapsed,
      state: frame.animState,
      speedRatio: frame.speedRatio,
      forwardSpeed: frame.activeSpeed,
      laneVelocity: interpLaneVel,
      yPos: interpY,
      velocityY: interpVelY,
      flipProgress: lerpCycle(frame.flipProgress, nextFrame?.flipProgress ?? frame.flipProgress),
      spinProgress: lerpCycle(frame.spinProgress, nextFrame?.spinProgress ?? frame.spinProgress),
      slashProgress: lerpCycle(frame.slashProgress, nextFrame?.slashProgress ?? frame.slashProgress),
      slashComboIndex: frame.slashComboIndex,
      stumbleProgress: lerpCycle(
        frame.stumbleProgress,
        nextFrame?.stumbleProgress ?? frame.stumbleProgress,
      ),
      flyBarrelProgress: lerpCycle(
        frame.flyBarrelProgress,
        nextFrame?.flyBarrelProgress ?? frame.flyBarrelProgress,
      ),
      flyBarrelDir: frame.flyBarrelDir,
      flyLoopProgress: lerpCycle(
        frame.flyLoopProgress,
        nextFrame?.flyLoopProgress ?? frame.flyLoopProgress,
      ),
      flySwoopProgress: lerpCycle(
        frame.flySwoopProgress,
        nextFrame?.flySwoopProgress ?? frame.flySwoopProgress,
      ),
      swordActive: frame.swordActive,
      starActive: frame.starActive,
      shieldActive: frame.shieldActive,
      invulnerable: false,
      invulnTimer: 0,
      isMenuPreview: false,
    });

    this.villain.update({
      dt: scaledDt,
      elapsed: this.replayVisualElapsed,
      playerX: interpX,
      playerY: interpY,
      isPlayerSliding: frame.isPlayerSliding,
      isPlayerFlying: frame.isPlayerFlying,
      speedRatio: frame.speedRatio,
      isChasing: frame.isChasing,
      isGameOver: false,
      isMenuPreview: false,
    });

    // Dramatic sweeping 3D side-orbit / low-angle hero replay camera
    const smoothP = progress * progress * (3 - 2 * progress);
    const orbitAngle = THREE.MathUtils.lerp(0.68, -0.58, smoothP);
    const isPortrait = this.camera.aspect < 0.85;
    const radius = (isSlowMo ? 5.05 : 5.75) * (isPortrait ? 1.18 : 1.0);
    const camX = interpX + this.replayCameraSide * Math.cos(orbitAngle) * radius;
    const camY = Math.max(1.25, interpY + 1.55 + Math.sin(smoothP * Math.PI) * 0.45);
    const camZ = Math.sin(orbitAngle) * radius + 0.55;

    _camTargetPos.set(camX, camY, camZ);
    if (progress < 0.04) {
      this.camera.position.copy(_camTargetPos);
    } else {
      this.camera.position.lerp(_camTargetPos, 1 - Math.exp(-10 * dt));
    }

    const replayFov = (isPortrait ? 60 : 50) + (isSlowMo ? -3 : 3);
    if (Math.abs(this.camera.fov - replayFov) > 0.05) {
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, replayFov, 7, dt);
      this.camera.updateProjectionMatrix();
    }

    _camLookAt.set(interpX, interpY + 1.18, -0.35);
    this.camera.lookAt(_camLookAt);

    this.hudSyncAccum += dt;
    if (this.hudSyncAccum >= 0.04) {
      this.hudSyncAccum = 0;
      this.emitHud();
    }

    if (done) {
      this.finishReplay();
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

    // 1. SUI Coins + Half-Cyborg / Store Magnet Core pull (plus gentle Star flight pull)
    const upg = this.loadout.upgrades;
    const baseMagnet = charCfg.perks.coinMagnetRadius + upg.magnet * 1.1;
    const magnetRadius = Math.max(baseMagnet, this.starTimer > 0 ? 4.4 + upg.magnet * 0.5 : 0);
    const coinRadiusX = this.starTimer > 0 ? 2.6 : 1.25;
    const coinRadiusY = this.starTimer > 0 ? 2.6 : 1.45;
    const coinGain = this.doubleCoinsActive ? 2 : 1;

    for (const coin of this.pools.coins) {
      if (!coin.active) continue;

      if (magnetRadius > 0 && coin.z > -12.5 && coin.z < 2.2) {
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
        this.runCoins += coinGain;
        this.score += Math.round(15 * coinGain * DIFFICULTIES[this.difficultyId].scoreMultiplier);
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
          this.activeSwordDuration =
            SWORD_DURATION + charCfg.perks.swordDurationBonus + upg.sword * 1.2;
          this.swordTimer = this.activeSwordDuration;
          this.addBonus(
            100,
            charCfg.perks.swordDurationBonus > 0 ? 'Flame Sword Active!' : 'Energy Sword Active!',
          );
          this.audio.play('sword');
          this.pools.spawnBurst(puX, 1.5, 0, charCfg.slashColor, 14);
        } else {
          this.activeStarDuration = STAR_DURATION + upg.star * 1.0;
          this.starTimer = this.activeStarDuration;
          this.addBonus(120, 'Star Flight · Stunts Ready!');
          this.audio.play('star');
        }
      }
    }

    // 3. Obstacles (Star flight grants complete obstacle immunity)
    if (this.starTimer > 0) return;

    const autoCutRangeZ = -4.2 - charCfg.perks.swordReachBonus * 0.45 - upg.sword * 0.35;

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

        // Perfect close-call slide right underneath an overhead barrier!
        if (
          !hit &&
          obs.kind === 'overhead' &&
          this.slideTimer > 0 &&
          obs.z > -0.35 &&
          obs.z < 1.35 &&
          !this.closeSlideAwardedObs.has(obs)
        ) {
          this.closeSlideAwardedObs.add(obs);
          this.triggerPerfectStunt('Slide Under');
        }
      }
    }
  }

  private handleObstacleHit(obs: { lane: number; z: number; sliced: boolean }): void {
    const charCfg = getCharacterById(this.characterId);
    obs.sliced = true;

    // Cancel any pending Perfect Stunt replay if the player crashes during follow-through
    this.pendingPerfectReplayTimer = 0;
    this.pendingPerfectStuntLabel = null;

    // Hitting an obstacle immediately brings the Hunter charging back into pursuit!
    this.cleanRunDistance = 0;
    this.hunterActive = true;

    const extraRecovery = this.loadout.upgrades.shield * 0.25;

    if (this.shields > 0) {
      this.shields--;
      this.invulnTimer = INVULNERABLE_DURATION + charCfg.perks.extraInvulnSeconds + extraRecovery;
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
    this.invulnTimer = INVULNERABLE_DURATION + charCfg.perks.extraInvulnSeconds + extraRecovery;
    this.cameraShake = 0.55;
    this.pools.spawnBurst(this.playerX, this.playerY + 1.1, 0, 0xf43f5e, 16);

    if (this.lives <= 0) {
      this.lives = 0;
      this.screen = 'gameover';
      this.spatialAudio.setActivity(false, 0, this.playerX);
      this.music.setState('gameover', 0, false, false);
      this.audio.play('gameOver');
      const yieldMult = 1 + this.loadout.upgrades.yield * 0.15;
      const finalCoins = Math.round(this.runCoins * yieldMult);
      const finalScore = Math.floor(this.score * yieldMult);
      this.runCoins = finalCoins;
      this.score = finalScore;
      this.emitHud();
      this.callbacks.onGameOver({
        score: finalScore,
        distance: Math.floor(this.distance),
        runCoins: finalCoins,
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
      starDuration: this.activeStarDuration,
      stuntBanner: this.stuntBanner,
      sceneFadeOpacity: this.fadeOpacity,
      portalWarpColor: this.portalWarpColor,
      portalDestination: this.portalDestination,
      sceneToast: this.sceneToast,
      villainThreat: this.villain.getThreatLevel(),
      yetiSource: this.yetiSource,
      replayActive: this.replayActive,
      replayStuntLabel: this.replayStuntLabel,
      replayProgress: this.replayProgress,
      replayRecordedSec: this.replayRecordedSec,
      replaySlowMo: this.replaySlowMo,
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
    this.music.dispose();
    this.spatialAudio.dispose();
    this.renderer.dispose();
    if (canvas.parentElement === this.container) {
      this.container.removeChild(canvas);
    }
  }
}
