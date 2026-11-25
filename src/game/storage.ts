import { CHARACTERS } from './config';
import type { CharacterId, DifficultyId, SaveData } from './types';

const STORAGE_KEY = 'lofi_yeti_runner_save_v2';
const LEGACY_STORAGE_KEY = 'lofi_yeti_runner_save_v1';

export const DEFAULT_SAVE: SaveData = {
  lifetimeCoins: 0,
  highScore: 0,
  bestDistance: 0,
  selectedCharacter: 'og_lofi',
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

export function loadSaveData(): SaveData {
  try {
    const raw =
      window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_SAVE);
    const parsed = JSON.parse(raw) as Partial<SaveData> & { selectedSkin?: string };

    const lifetimeCoins =
      typeof parsed.lifetimeCoins === 'number' && Number.isFinite(parsed.lifetimeCoins)
        ? Math.max(0, Math.floor(parsed.lifetimeCoins))
        : 0;

    const highScore =
      typeof parsed.highScore === 'number' && Number.isFinite(parsed.highScore)
        ? Math.max(0, Math.floor(parsed.highScore))
        : 0;

    const bestDistance =
      typeof parsed.bestDistance === 'number' && Number.isFinite(parsed.bestDistance)
        ? Math.max(0, Math.floor(parsed.bestDistance))
        : 0;

    let selectedCharacter: CharacterId = isValidCharacter(parsed.selectedCharacter)
      ? parsed.selectedCharacter
      : 'og_lofi';

    const charObj = CHARACTERS.find((c) => c.id === selectedCharacter);
    if (charObj && lifetimeCoins < charObj.unlockCoins) {
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
      highScore,
      bestDistance,
      selectedCharacter,
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
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Ignore errors
  }
  return fresh;
}
