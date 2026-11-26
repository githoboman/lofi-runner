import { CHARACTERS, STORE_BOOSTERS, STORE_UPGRADES } from './config';
import type {
  BoosterId,
  CharacterId,
  DifficultyId,
  MintedYetiNft,
  OnChainReceipt,
  SaveData,
  SuiNetworkId,
  UpgradeId,
} from './types';

const STORAGE_KEY = 'lofi_yeti_runner_save_v3';
const LEGACY_KEYS = ['lofi_yeti_runner_save_v2', 'lofi_yeti_runner_save_v1'];

export const DEFAULT_UPGRADES: Record<UpgradeId, number> = {
  magnet: 0,
  sword: 0,
  star: 0,
  shield: 0,
  yield: 0,
};

export const DEFAULT_BOOSTERS: Record<BoosterId, number> = {
  headstart: 0,
  starter_sword: 0,
  extra_shield: 0,
  double_coins: 0,
};

export const DEFAULT_SAVE: SaveData = {
  lifetimeCoins: 0,
  coinBalance: 0,
  highScore: 0,
  bestDistance: 0,
  selectedCharacter: 'og_lofi',
  unlockedCharacters: ['og_lofi'],
  upgrades: { ...DEFAULT_UPGRADES },
  boosters: { ...DEFAULT_BOOSTERS },
  equippedBoosters: [],
  blockchain: {
    suiIdentifier: '',
    network: 'testnet',
    claimedCoins: 0,
    onChainBestScore: 0,
    mintedNfts: {},
    receipts: [],
  },
  settings: {
    sfxEnabled: true,
    showHints: true,
    difficulty: 'normal',
  },
};

function isValidDifficulty(val: unknown): val is DifficultyId {
  return val === 'easy' || val === 'normal' || val === 'hard';
}

function isValidCharacter(val: unknown): val is CharacterId {
  return CHARACTERS.some((c) => c.id === val);
}

function isValidBooster(val: unknown): val is BoosterId {
  return STORE_BOOSTERS.some((b) => b.id === val);
}

function isValidNetwork(val: unknown): val is SuiNetworkId {
  return val === 'testnet' || val === 'mainnet';
}

export function isCharacterUnlocked(save: SaveData, charId: CharacterId): boolean {
  if (charId === 'og_lofi') return true;
  if (save.unlockedCharacters.includes(charId)) return true;
  if (save.blockchain.mintedNfts[charId]) return true;
  const cfg = CHARACTERS.find((c) => c.id === charId);
  return Boolean(cfg && save.lifetimeCoins >= cfg.unlockCoins);
}

export function loadSaveData(): SaveData {
  try {
    let raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      for (const legacyKey of LEGACY_KEYS) {
        const hit = window.localStorage.getItem(legacyKey);
        if (hit) {
          raw = hit;
          break;
        }
      }
    }
    if (!raw) return structuredClone(DEFAULT_SAVE);
    const parsed = JSON.parse(raw) as Partial<SaveData>;

    const lifetimeCoins =
      typeof parsed.lifetimeCoins === 'number' && Number.isFinite(parsed.lifetimeCoins)
        ? Math.max(0, Math.floor(parsed.lifetimeCoins))
        : 0;

    // Migrate v2 saves cleanly: if coinBalance didn't exist yet, initialize it to lifetimeCoins!
    const coinBalance =
      typeof parsed.coinBalance === 'number' && Number.isFinite(parsed.coinBalance)
        ? Math.max(0, Math.floor(parsed.coinBalance))
        : lifetimeCoins;

    const highScore =
      typeof parsed.highScore === 'number' && Number.isFinite(parsed.highScore)
        ? Math.max(0, Math.floor(parsed.highScore))
        : 0;

    const bestDistance =
      typeof parsed.bestDistance === 'number' && Number.isFinite(parsed.bestDistance)
        ? Math.max(0, Math.floor(parsed.bestDistance))
        : 0;

    const unlockedSet = new Set<CharacterId>(['og_lofi']);
    if (Array.isArray(parsed.unlockedCharacters)) {
      for (const c of parsed.unlockedCharacters) {
        if (isValidCharacter(c)) unlockedSet.add(c);
      }
    }
    for (const cfg of CHARACTERS) {
      if (lifetimeCoins >= cfg.unlockCoins) {
        unlockedSet.add(cfg.id);
      }
    }

    const upgrades: Record<UpgradeId, number> = { ...DEFAULT_UPGRADES };
    if (parsed.upgrades && typeof parsed.upgrades === 'object') {
      for (const u of STORE_UPGRADES) {
        const val = parsed.upgrades[u.id];
        if (typeof val === 'number' && Number.isFinite(val)) {
          upgrades[u.id] = Math.min(u.maxLevel, Math.max(0, Math.floor(val)));
        }
      }
    }

    const boosters: Record<BoosterId, number> = { ...DEFAULT_BOOSTERS };
    if (parsed.boosters && typeof parsed.boosters === 'object') {
      for (const b of STORE_BOOSTERS) {
        const val = parsed.boosters[b.id];
        if (typeof val === 'number' && Number.isFinite(val)) {
          boosters[b.id] = Math.min(b.maxStack, Math.max(0, Math.floor(val)));
        }
      }
    }

    const equippedBoosters: BoosterId[] = Array.isArray(parsed.equippedBoosters)
      ? Array.from(
          new Set(
            parsed.equippedBoosters.filter(
              (b): b is BoosterId => isValidBooster(b) && boosters[b] > 0,
            ),
          ),
        )
      : [];

    const mintedNfts: Partial<Record<CharacterId, MintedYetiNft>> = {};
    if (parsed.blockchain?.mintedNfts && typeof parsed.blockchain.mintedNfts === 'object') {
      for (const [k, v] of Object.entries(parsed.blockchain.mintedNfts)) {
        if (isValidCharacter(k) && v && typeof v.objectId === 'string') {
          mintedNfts[k] = v;
          unlockedSet.add(k);
        }
      }
    }

    const receipts: OnChainReceipt[] = Array.isArray(parsed.blockchain?.receipts)
      ? parsed.blockchain.receipts
          .filter((r): r is OnChainReceipt => Boolean(r && typeof r.digest === 'string'))
          .slice(0, 20)
      : [];

    const blockchain = {
      suiIdentifier:
        typeof parsed.blockchain?.suiIdentifier === 'string'
          ? parsed.blockchain.suiIdentifier.trim().slice(0, 100)
          : '',
      network: isValidNetwork(parsed.blockchain?.network) ? parsed.blockchain.network : 'testnet',
      claimedCoins:
        typeof parsed.blockchain?.claimedCoins === 'number' &&
        Number.isFinite(parsed.blockchain.claimedCoins)
          ? Math.max(0, Math.floor(parsed.blockchain.claimedCoins))
          : 0,
      onChainBestScore:
        typeof parsed.blockchain?.onChainBestScore === 'number' &&
        Number.isFinite(parsed.blockchain.onChainBestScore)
          ? Math.max(0, Math.floor(parsed.blockchain.onChainBestScore))
          : 0,
      mintedNfts,
      receipts,
    };

    let selectedCharacter: CharacterId = isValidCharacter(parsed.selectedCharacter)
      ? parsed.selectedCharacter
      : 'og_lofi';
    if (!unlockedSet.has(selectedCharacter)) {
      selectedCharacter = 'og_lofi';
    }

    const sfxEnabled =
      typeof parsed.settings?.sfxEnabled === 'boolean' ? parsed.settings.sfxEnabled : true;
    const showHints =
      typeof parsed.settings?.showHints === 'boolean' ? parsed.settings.showHints : true;
    const difficulty = isValidDifficulty(parsed.settings?.difficulty)
      ? parsed.settings.difficulty
      : 'normal';

    return {
      lifetimeCoins,
      coinBalance,
      highScore,
      bestDistance,
      selectedCharacter,
      unlockedCharacters: Array.from(unlockedSet),
      upgrades,
      boosters,
      equippedBoosters,
      blockchain,
      settings: {
        sfxEnabled,
        showHints,
        difficulty,
      },
    };
  } catch {
    return structuredClone(DEFAULT_SAVE);
  }
}

export function writeSaveData(data: SaveData): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore storage quota or private browsing errors gracefully
  }
}

export function resetSaveData(): SaveData {
  const fresh = structuredClone(DEFAULT_SAVE);
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    for (const k of LEGACY_KEYS) {
      window.localStorage.removeItem(k);
    }
  } catch {
    // Ignore errors
  }
  return fresh;
}
