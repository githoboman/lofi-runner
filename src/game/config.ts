import type {
  CharacterConfig,
  CharacterId,
  DifficultyConfig,
  DifficultyId,
  SceneId,
  SoundKey,
  StoreBoosterConfig,
  StoreUpgradeConfig,
} from './types';

export const STORE_UPGRADES: StoreUpgradeConfig[] = [
  {
    id: 'magnet',
    name: 'SUI Coin Magnet',
    description: 'Pulls nearby SUI Coins automatically across lanes for every Yeti.',
    statLabel: '+1.1m pull radius per level',
    maxLevel: 5,
    baseCost: 80,
    costStep: 70,
  },
  {
    id: 'sword',
    name: 'Blade Overclock',
    description: 'Extends Signature Energy Sword duration and forward cleave reach.',
    statLabel: '+1.2s duration · +0.6m reach / lv',
    maxLevel: 5,
    baseCost: 90,
    costStep: 80,
  },
  {
    id: 'star',
    name: 'Star Thrusters',
    description: 'Extends Star Flight duration and amplifies all aerial stunt points.',
    statLabel: '+1.0s flight · +10% stunt score / lv',
    maxLevel: 5,
    baseCost: 100,
    costStep: 85,
  },
  {
    id: 'shield',
    name: 'Aegis Matrix',
    description: 'Longer hit recovery; Lv 3+ grants +1 starting Void Shield every run.',
    statLabel: '+0.25s recovery · +1 shield at Lv 3',
    maxLevel: 5,
    baseCost: 120,
    costStep: 95,
  },
  {
    id: 'yield',
    name: 'SUI Yield Core',
    description: 'Boosts SUI Coin earnings and run score payout at the end of every run.',
    statLabel: '+15% SUI Coin payout per level',
    maxLevel: 5,
    baseCost: 110,
    costStep: 90,
  },
];

export const STORE_BOOSTERS: StoreBoosterConfig[] = [
  {
    id: 'headstart',
    name: 'Hyper Headstart',
    description: 'Launch into Star Flight for 4s with an instant 350m opening burst.',
    cost: 75,
    maxStack: 9,
  },
  {
    id: 'starter_sword',
    name: 'Ignited Blade',
    description: 'Start your run wielding your Yeti Signature 3D Sword immediately.',
    cost: 60,
    maxStack: 9,
  },
  {
    id: 'extra_shield',
    name: 'Void Aegis Charge',
    description: 'Adds +1 extra Void Shield charge to absorb an obstacle hit.',
    cost: 50,
    maxStack: 9,
  },
  {
    id: 'double_coins',
    name: '2x SUI Surge',
    description: 'Doubles every SUI Coin collected during your next run.',
    cost: 90,
    maxStack: 9,
  },
];

export function getUpgradeCost(cfg: StoreUpgradeConfig, currentLevel: number): number {
  return cfg.baseCost + currentLevel * cfg.costStep;
}

export const LANE_WIDTH = 2.6;
export const LANE_X = [-LANE_WIDTH, 0, LANE_WIDTH] as const;

export const SEGMENT_LENGTH = 30;
export const SEGMENT_COUNT = 7; // 210 units of active recycled road
export const SCENE_SWITCH_DISTANCE = 2400; // Longer run per world before portal warp
export const SLIDE_ZONE_START_RATIO = 0.42; // Mid-world slide / zero-G space float begins
export const SLIDE_ZONE_END_RATIO = 0.72; // Transitions cleanly back to road before portal
export const HUNTER_OUTRUN_DISTANCE = 320; // Hunter stops chasing once player runs cleanly this far

export const GRAVITY = 46;
export const JUMP_VELOCITY = 15.6;
export const DOUBLE_JUMP_VELOCITY = 14.2;
export const SLIDE_DURATION = 0.66;
export const SPIN_DURATION = 0.44;
export const SLASH_DURATION = 0.34;
export const STUMBLE_DURATION = 0.45;
export const INVULNERABLE_DURATION = 1.65;

export const SWORD_DURATION = 6.0;
export const STAR_DURATION = 5.0;
export const STAR_FLY_HEIGHT = 4.4;

export const YETI_MODEL_URL = '/assets/yeti.glb';

export const SCENE_ORDER: SceneId[] = [
  'frost_sanctuary',
  'inferno_caldera',
  'slime_catacombs',
  'cyber_foundry',
  'void_gallery',
];

export const SCENE_NAMES: Record<SceneId, string> = {
  frost_sanctuary: 'Glacier Summit',
  inferno_caldera: 'Ember Caldera',
  slime_catacombs: 'Ectoplasm Lab',
  cyber_foundry: 'Mecha Foundry',
  void_gallery: 'Astral Gallery',
};

export const SCENE_SHORT_NAMES: Record<SceneId, string> = {
  frost_sanctuary: 'Glacier',
  inferno_caldera: 'Caldera',
  slime_catacombs: 'Slime Lab',
  cyber_foundry: 'Foundry',
  void_gallery: 'Astral',
};

export const SCENE_PORTAL_THEME: Record<
  SceneId,
  { primary: number; secondary: number; flashHex: string; crestHex: string }
> = {
  frost_sanctuary: {
    primary: 0x38bdf8,
    secondary: 0xffffff,
    flashHex: '#e0f2fe',
    crestHex: '#7dd3fc',
  },
  inferno_caldera: {
    primary: 0xf97316,
    secondary: 0xfef08a,
    flashHex: '#ffedd5',
    crestHex: '#fb923c',
  },
  slime_catacombs: {
    primary: 0x22c55e,
    secondary: 0xd9f99d,
    flashHex: '#dcfce7',
    crestHex: '#4ade80',
  },
  cyber_foundry: {
    primary: 0x06b6d4,
    secondary: 0xa855f7,
    flashHex: '#cffafe',
    crestHex: '#38bdf8',
  },
  void_gallery: {
    primary: 0x8b5cf6,
    secondary: 0xfde047,
    flashHex: '#ede9fe',
    crestHex: '#c4b5fd',
  },
};

export const DIFFICULTIES: Record<DifficultyId, DifficultyConfig> = {
  easy: {
    id: 'easy',
    label: 'Easy',
    description: '4 lives · Fast chill pace',
    lives: 4,
    startSpeed: 26,
    maxSpeed: 52,
    speedRampPerUnit: 0.0055,
    scoreMultiplier: 1.0,
  },
  normal: {
    id: 'normal',
    label: 'Normal',
    description: '3 lives · High-speed arcade',
    lives: 3,
    startSpeed: 33,
    maxSpeed: 64,
    speedRampPerUnit: 0.0075,
    scoreMultiplier: 1.25,
  },
  hard: {
    id: 'hard',
    label: 'Hard',
    description: '2 lives · Turbo · Dense gauntlets',
    lives: 2,
    startSpeed: 40,
    maxSpeed: 74,
    speedRampPerUnit: 0.0095,
    scoreMultiplier: 1.6,
  },
};

export const CHARACTERS: CharacterConfig[] = [
  {
    id: 'og_lofi',
    name: 'OG Lofi',
    tier: 'Tier 1 · OG Yeti',
    tagline: 'Shaggy snowy fur, glacier-blue face, sleepy eyes, and iced SUI medallion.',
    perkName: 'Chill Flow',
    perkDescription: '+30% bonus points on Backflips & Tail-Whip Spins plus smoother air hang-time.',
    homeWorldId: 'frost_sanctuary',
    unlockCoins: 0,
    portraitUrl: '/assets/aistudio/yetihead_-lofi_cutout_logo_9c1b1a23.png',
    primaryHex: '#f8fafc',
    secondaryHex: '#5c9ce6',
    accentHex: '#38bdf8',
    accentColor: 0x38bdf8,
    trailColor: 0x7dd3fc,
    slashColor: 0x38bdf8,
    perks: {
      stuntBonusMult: 1.3,
      spinHangBoost: 1.8,
      swordDurationBonus: 0,
      swordReachBonus: 0,
      jumpMult: 1.0,
      coinMagnetRadius: 0,
      startShields: 0,
      extraInvulnSeconds: 0,
    },
  },
  {
    id: 'inferno_blaze',
    name: 'Inferno Blaze',
    tier: 'Tier 2 · Mystic Flame',
    tagline: 'Blazing golden-crimson fire mane, roaring toothy grin, and ember claws.',
    perkName: 'Flame Surge',
    perkDescription: '+2.5s longer Energy Sword duration and wider forward fiery slash range.',
    homeWorldId: 'inferno_caldera',
    unlockCoins: 100,
    portraitUrl: '/assets/aistudio/LofiMysticYetis_tophero_cutout_0004_Layer-6_e5c2eaa6.png',
    primaryHex: '#fb923c',
    secondaryHex: '#facc15',
    accentHex: '#f97316',
    accentColor: 0xf97316,
    trailColor: 0xfb923c,
    slashColor: 0xf97316,
    perks: {
      stuntBonusMult: 1.0,
      spinHangBoost: 0,
      swordDurationBonus: 2.5,
      swordReachBonus: 4.0,
      jumpMult: 1.0,
      coinMagnetRadius: 0,
      startShields: 0,
      extraInvulnSeconds: 0,
    },
  },
  {
    id: 'neon_slime',
    name: 'Neon Slime',
    tier: 'Tier 3 · Ectoplasm',
    tagline: 'Translucent glowing emerald slime housing a luminous skull & ribcage.',
    perkName: 'Elastic Bounce',
    perkDescription: '+14% higher Jump & Backflip clearance with springy slime bounce.',
    homeWorldId: 'slime_catacombs',
    unlockCoins: 220,
    portraitUrl: '/assets/aistudio/LofiMysticYetis_tophero_cutout_0002_Layer-3_70caaf95.png',
    primaryHex: '#4ade80',
    secondaryHex: '#16a34a',
    accentHex: '#22c55e',
    accentColor: 0x4ade80,
    trailColor: 0x4ade80,
    slashColor: 0x4ade80,
    perks: {
      stuntBonusMult: 1.0,
      spinHangBoost: 0.7,
      swordDurationBonus: 0,
      swordReachBonus: 0,
      jumpMult: 1.14,
      coinMagnetRadius: 0,
      startShields: 0,
      extraInvulnSeconds: 0,
    },
  },
  {
    id: 'half_cyborg',
    name: 'Half-Cyborg',
    tier: 'Tier 3 · Mecha Legend',
    tagline: 'Split organic Lofi & chrome-white clockwork endoskeleton with optic eye.',
    perkName: 'Magnet Core',
    perkDescription: 'Passive magnetic field pulls nearby SUI coins toward you automatically.',
    homeWorldId: 'cyber_foundry',
    unlockCoins: 360,
    portraitUrl: '/assets/aistudio/LofiMysticYetis_tophero_cutout_0000_Layer-2_67fe537c.png',
    primaryHex: '#e2e8f0',
    secondaryHex: '#475569',
    accentHex: '#60a5fa',
    accentColor: 0x60a5fa,
    trailColor: 0x93c5fd,
    slashColor: 0x60a5fa,
    perks: {
      stuntBonusMult: 1.0,
      spinHangBoost: 0,
      swordDurationBonus: 0,
      swordReachBonus: 0,
      jumpMult: 1.0,
      coinMagnetRadius: 5.8,
      startShields: 0,
      extraInvulnSeconds: 0,
    },
  },
  {
    id: 'void_shadow',
    name: 'Void Shadow',
    tier: 'Tier 4 · Mystic Shadow',
    tagline: 'Stitched obsidian & shadow yeti with cyan horns, crystal claws & twin crescents.',
    perkName: 'Phase Step',
    perkDescription: 'Starts every run with +1 Void Shield to absorb a hit & longer invulnerability.',
    homeWorldId: 'void_gallery',
    unlockCoins: 500,
    portraitUrl: '/assets/aistudio/LofiMysticYetis_tophero_cutout_0006_Layer-4_c3afe048.png',
    primaryHex: '#1e1b2e',
    secondaryHex: '#38bdf8',
    accentHex: '#a78bfa',
    accentColor: 0xa78bfa,
    trailColor: 0x8b5cf6,
    slashColor: 0xa78bfa,
    perks: {
      stuntBonusMult: 1.0,
      spinHangBoost: 0,
      swordDurationBonus: 0,
      swordReachBonus: 0,
      jumpMult: 1.0,
      coinMagnetRadius: 0,
      startShields: 1,
      extraInvulnSeconds: 0.65,
    },
  },
];

export function getCharacterById(id: CharacterId): CharacterConfig {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
}

/**
 * Configurable artwork list used in Astral Gallery frames and Mecha Foundry billboards.
 * Automatically falls back to procedurally generated canvas art if any image fails to load.
 */
export const ART_URLS: string[] = [
  '/assets/aistudio/lofimeditate_V2final_e3a92044.jpg',
  '/assets/aistudio/imagescroll_v2_0005_Layer-5_d84db277.jpg',
  '/assets/aistudio/LOFI__PlushieToy_Final_e8c5253d.jpg',
  '/assets/aistudio/sailing_lofi_cutout_compressed_b4872870.png',
  '/assets/aistudio/LofiMysticYetis_tophero_cutout_0004_Layer-6_e5c2eaa6.png',
  '/assets/aistudio/LofiMysticYetis_tophero_cutout_0002_Layer-3_70caaf95.png',
  '/assets/aistudio/LofiMysticYetis_tophero_cutout_0000_Layer-2_67fe537c.png',
  '/assets/aistudio/LofiMysticYetis_tophero_cutout_0006_Layer-4_c3afe048.png',
  '/assets/aistudio/imagescroll_v2_0007_Layer-3_0363aea1.jpg',
];

export const MASCOT_LOGO_URL = '/assets/aistudio/yetihead_-lofi_cutout_logo_9c1b1a23.png';

/**
 * Placeholder file paths for audio assets.
 * Currently synthesized via Web Audio API; drop audio files here and wire decodeAudioData when ready.
 */
export const AUDIO_CONFIG: Record<SoundKey, { path: string; volume: number }> = {
  jump: { path: '/assets/audio/jump.wav', volume: 0.5 },
  flip: { path: '/assets/audio/flip.wav', volume: 0.55 },
  spin: { path: '/assets/audio/spin.wav', volume: 0.45 },
  land: { path: '/assets/audio/land.wav', volume: 0.35 },
  coin: { path: '/assets/audio/coin.wav', volume: 0.42 },
  sword: { path: '/assets/audio/sword_swing.wav', volume: 0.6 },
  star: { path: '/assets/audio/star_pickup.wav', volume: 0.65 },
  hit: { path: '/assets/audio/hit.wav', volume: 0.65 },
  gameOver: { path: '/assets/audio/game_over.wav', volume: 0.7 },
  sceneSwitch: { path: '/assets/audio/scene_switch.wav', volume: 0.5 },
  uiClick: { path: '/assets/audio/ui_click.wav', volume: 0.3 },
  sliceImpact: { path: '/assets/audio/slice_impact.wav', volume: 0.7 },
  flyStunt: { path: '/assets/audio/fly_stunt.wav', volume: 0.55 },
  villainSurge: { path: '/assets/audio/villain_surge.wav', volume: 0.62 },
  portalWarp: { path: '/assets/audio/portal_warp.wav', volume: 0.72 },
};
