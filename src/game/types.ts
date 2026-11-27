export type GameScreen =
  | 'menu'
  | 'character'
  | 'store'
  | 'web3'
  | 'settings'
  | 'playing'
  | 'paused'
  | 'gameover';

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

export type UpgradeId = 'magnet' | 'sword' | 'star' | 'shield' | 'yield';

export type BoosterId = 'headstart' | 'starter_sword' | 'extra_shield' | 'double_coins';

export type SuiNetworkId = 'testnet' | 'mainnet';

export interface StoreUpgradeConfig {
  id: UpgradeId;
  name: string;
  description: string;
  statLabel: string;
  maxLevel: number;
  baseCost: number;
  costStep: number;
}

export interface StoreBoosterConfig {
  id: BoosterId;
  name: string;
  description: string;
  cost: number;
  maxStack: number;
}

export interface ActiveRunLoadout {
  upgrades: Record<UpgradeId, number>;
  activeBoosters: BoosterId[];
}

export interface OnChainReceipt {
  id: string;
  kind: 'claim_coins' | 'mint_yeti' | 'submit_score';
  summary: string;
  digest: string;
  network: SuiNetworkId;
  timestamp: number;
  mode: 'account' | 'wallet' | 'sandbox';
  suiIdentifier?: string;
}

export interface MintedYetiNft {
  characterId: CharacterId;
  objectId: string;
  network: SuiNetworkId;
  mintedAt: number;
  digest: string;
}

export interface DailyLeaderboardEntry {
  id: string;
  uid: string;
  displayName: string;
  photoURL: string;
  characterId: CharacterId;
  difficulty: DifficultyId;
  score: number;
  distance: number;
  runCoins: number;
  createdAtMs: number;
}

export interface BlockchainSaveState {
  suiIdentifier: string;
  network: SuiNetworkId;
  claimedCoins: number;
  onChainBestScore: number;
  mintedNfts: Partial<Record<CharacterId, MintedYetiNft>>;
  receipts: OnChainReceipt[];
}

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

export type MusicBeatId =
  | 'auto'
  | 'lofi_boombap'
  | 'phonk_trap'
  | 'afro_amapiano'
  | 'cyber_synthwave'
  | 'liquid_dnb';

export interface MusicBeatConfig {
  id: MusicBeatId;
  name: string;
  genre: string;
  bpmLabel: string;
  worldHint: string;
}

export interface GameSettings {
  sfxEnabled: boolean;
  musicEnabled: boolean;
  musicBeat: MusicBeatId;
  showHints: boolean;
  difficulty: DifficultyId;
}

export interface SaveData {
  lifetimeCoins: number;
  coinBalance: number;
  highScore: number;
  bestDistance: number;
  selectedCharacter: CharacterId;
  unlockedCharacters: CharacterId[];
  upgrades: Record<UpgradeId, number>;
  boosters: Record<BoosterId, number>;
  equippedBoosters: BoosterId[];
  blockchain: BlockchainSaveState;
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
  sceneProgress: number; // 0..1 within current zone
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
  replayActive: boolean;
  replayStuntLabel: string | null;
  replayProgress: number; // 0..1 playback progress across captured highlight
  replayRecordedSec: number; // seconds captured (up to 5.0s)
  replaySlowMo: boolean;
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
