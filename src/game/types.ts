export type GameScreen = 'menu' | 'character' | 'settings' | 'playing' | 'paused' | 'gameover';

export type DifficultyId = 'easy' | 'normal' | 'hard';

export type CharacterId =
  | 'og_lofi'
  | 'inferno_blaze'
  | 'neon_slime'
  | 'half_cyborg'
  | 'void_shadow';

export type SceneId =
  | 'frost_sanctuary'
  | 'inferno_caldera'
  | 'slime_catacombs'
  | 'cyber_foundry'
  | 'void_gallery';

export type ObstacleKind = 'crate' | 'overhead' | 'special';

export type PowerupKind = 'sword' | 'star';

export interface DifficultyConfig {
  id: DifficultyId;
  label: string;
  description: string;
  lives: number;
  startSpeed: number;
  maxSpeed: number;
  speedRampPerUnit: number;
  scoreMultiplier: number;
}

export interface CharacterPerks {
  stuntBonusMult: number;
  spinHangBoost: number;
  swordDurationBonus: number;
  swordReachBonus: number;
  jumpMult: number;
  coinMagnetRadius: number;
  startShields: number;
  extraInvulnSeconds: number;
}

export interface CharacterConfig {
  id: CharacterId;
  name: string;
  tier: string;
  tagline: string;
  perkName: string;
  perkDescription: string;
  homeWorldId: SceneId;
  unlockCoins: number;
  portraitUrl: string;
  primaryHex: string;
  secondaryHex: string;
  accentHex: string;
  accentColor: number;
  trailColor: number;
  slashColor: number;
  perks: CharacterPerks;
}

export interface GameSettings {
  sfxEnabled: boolean;
  showHints: boolean;
  difficulty: DifficultyId;
}

export interface SaveData {
  lifetimeCoins: number;
  highScore: number;
  bestDistance: number;
  selectedCharacter: CharacterId;
  settings: GameSettings;
}

export interface HudSnapshot {
  score: number;
  distance: number;
  runCoins: number;
  lives: number;
  maxLives: number;
  shields: number;
  speed: number;
  characterId: CharacterId;
  sceneId: SceneId;
  sceneName: string;
  sceneProgress: number; // 0..1 within current 1500-unit zone
  swordRemaining: number; // seconds
  swordDuration: number;
  starRemaining: number; // seconds
  starDuration: number;
  villainThreat: number; // 0..1 proximity of chasing villain
  stuntBanner: string | null;
  sceneFadeOpacity: number; // 0..1 luminous portal warp flash intensity
  portalWarpColor: string; // Hex tint for portal warp flash
  portalDestination: string | null; // Approaching 3D portal destination label
  sceneToast: string | null;
  yetiSource: 'procedural' | 'glb';
}

export type SoundKey =
  | 'jump'
  | 'flip'
  | 'spin'
  | 'land'
  | 'coin'
  | 'sword'
  | 'star'
  | 'hit'
  | 'gameOver'
  | 'sceneSwitch'
  | 'uiClick'
  | 'sliceImpact'
  | 'flyStunt'
  | 'villainSurge'
  | 'portalWarp';
