import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  Coins,
  FastForward,
  Heart,
  Lock,
  Music,
  Pause,
  Play,
  RotateCcw,
  Settings,
  Shield,
  ShoppingBag,
  Sparkles,
  Sword,
  Trophy,
  User,
  Volume2,
  VolumeX,
  Wallet,
} from 'lucide-react';
import {
  createAccountOnChainReceipt,
  fetchSuiBalanceMist,
  formatMistToSui,
  formatSuiIdentifier,
} from './blockchain/walletService';
import { StoreOverlay } from './components/StoreOverlay';
import { Web3HubOverlay } from './components/Web3HubOverlay';
import {
  completeGoogleRedirectSignIn,
  fetchDailyTopRuns,
  isInEmbeddedIframe,
  loadAndMergeCloudProfile,
  recordCloudReceipt,
  recordDailyRun,
  signInWithGoogle,
  signInWithGoogleRedirect,
  signOutGoogle,
  subscribeToAuth,
  syncCloudProfile,
  toGoogleAccountProfile,
  type GoogleAccountProfile,
} from './firebase';
import type { User as FirebaseUser } from 'firebase/auth';
import {
  CHARACTERS,
  DIFFICULTIES,
  MUSIC_BEATS,
  SCENE_NAMES,
  SCENE_ORDER,
  SCENE_SHORT_NAMES,
  STAR_DURATION,
  STORE_BOOSTERS,
  STORE_UPGRADES,
  SWORD_DURATION,
  getCharacterById,
  getMusicBeatLabel,
  getUpgradeCost,
} from './game/config';
import { RunnerEngine } from './game/engine';
import {
  isCharacterUnlocked,
  loadSaveData,
  resetSaveData,
  writeSaveData,
} from './game/storage';
import type {
  BoosterId,
  CharacterId,
  DailyLeaderboardEntry,
  DifficultyId,
  GameScreen,
  HudSnapshot,
  MusicBeatId,
  SaveData,
  SceneId,
  SuiNetworkId,
  UpgradeId,
} from './game/types';

const INITIAL_HUD: HudSnapshot = {
  score: 0,
  distance: 0,
  runCoins: 0,
  lives: 3,
  maxLives: 3,
  shields: 0,
  speed: 24,
  characterId: 'og_lofi',
  sceneId: 'frost_sanctuary',
  sceneName: SCENE_NAMES.frost_sanctuary,
  sceneProgress: 0,
  swordRemaining: 0,
  swordDuration: SWORD_DURATION,
  starRemaining: 0,
  starDuration: STAR_DURATION,
  stuntBanner: null,
  sceneFadeOpacity: 0,
  portalWarpColor: '#e0f2fe',
  portalDestination: null,
  sceneToast: null,
  villainThreat: 0,
  yetiSource: 'procedural',
  replayActive: false,
  replayStuntLabel: null,
  replayProgress: 0,
  replayRecordedSec: 0,
  replaySlowMo: false,
};

function CharacterAvatar({
  src,
  alt,
  accentHex,
  className = 'h-12 w-12',
}: {
  src: string;
  alt: string;
  accentHex: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        className={`flex items-center justify-center rounded-xl border border-white/15 font-[var(--font-display)] font-extrabold text-slate-950 shrink-0 ${className}`}
        style={{ backgroundColor: accentHex }}
      >
        {alt.slice(0, 2).toUpperCase()}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`rounded-xl object-contain bg-[#0e1526]/90 p-1 border border-white/15 shrink-0 ${className}`}
    />
  );
}

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<RunnerEngine | null>(null);

  const [save, setSave] = useState<SaveData>(() => loadSaveData());
  const [screen, setScreen] = useState<GameScreen>('menu');
  const [hud, setHud] = useState<HudSnapshot>(INITIAL_HUD);
  const [previewCharId, setPreviewCharId] = useState<CharacterId>(() => loadSaveData().selectedCharacter);
  const [lastRun, setLastRun] = useState<{
    score: number;
    distance: number;
    runCoins: number;
    isNewBest: boolean;
  } | null>(null);
  const [previewSceneId, setPreviewSceneId] = useState<SceneId>(
    () => getCharacterById(loadSaveData().selectedCharacter).homeWorldId,
  );
  const [confirmReset, setConfirmReset] = useState(false);
  const [contextLost, setContextLost] = useState(false);

  // Google Account & Cloud Sync state (no forced wallet connections!)
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [account, setAccount] = useState<GoogleAccountProfile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [suiBalanceFormatted, setSuiBalanceFormatted] = useState<string | null>(null);
  const [web3Busy, setWeb3Busy] = useState<string | null>(null);
  const [web3Status, setWeb3Status] = useState<string | null>(null);
  const [dailyRuns, setDailyRuns] = useState<DailyLeaderboardEntry[]>([]);
  const [dailyRunsLoading, setDailyRunsLoading] = useState(false);
  const [dailyRunsError, setDailyRunsError] = useState<string | null>(null);

  const saveRef = useRef(save);
  saveRef.current = save;

  const screenRef = useRef(screen);
  screenRef.current = screen;

  const firebaseUserRef = useRef<FirebaseUser | null>(null);
  firebaseUserRef.current = firebaseUser;

  const updateSave = useCallback((updater: (prev: SaveData) => SaveData) => {
    setSave((prev) => {
      const next = updater(prev);
      writeSaveData(next);
      const user = firebaseUserRef.current;
      if (user) {
        syncCloudProfile(user, next).catch(() => {
          // Handled via handleFirestoreError logs; keep local save intact
        });
      }
      return next;
    });
  }, []);

  const refreshDailyRuns = useCallback(async () => {
    setDailyRunsLoading(true);
    setDailyRunsError(null);
    try {
      const entries = await fetchDailyTopRuns(10);
      setDailyRuns(entries);
    } catch {
      setDailyRunsError('Unable to load the 24-hour community leaderboard right now.');
    } finally {
      setDailyRunsLoading(false);
    }
  }, []);

  // Subscribe to Firebase Google Auth state across desktop & mobile sessions
  useEffect(() => {
    void completeGoogleRedirectSignIn().then((redirectUser) => {
      if (redirectUser) {
        setWeb3Status(
          `Signed in as ${redirectUser.displayName || redirectUser.email || 'Google Player'}. Progress synced.`,
        );
      }
    });

    const unsubscribe = subscribeToAuth((user) => {
      setFirebaseUser(user);
      setAccount(user ? toGoogleAccountProfile(user) : null);
      setAuthReady(true);

      if (user) {
        loadAndMergeCloudProfile(user, saveRef.current)
          .then((merged) => {
            writeSaveData(merged);
            setSave(merged);
            engineRef.current?.setCharacter(merged.selectedCharacter, false);
          })
          .catch(() => {
            // Keep local save if offline
          });
      }
    });
    return unsubscribe;
  }, []);

  // Refresh optional Sui balance whenever the user has saved a Sui address or .sui name
  useEffect(() => {
    const suiId = save.blockchain.suiIdentifier.trim();
    if (!suiId) {
      setSuiBalanceFormatted(null);
      return;
    }
    let active = true;
    fetchSuiBalanceMist(save.blockchain.network, suiId)
      .then((mist) => {
        if (active) setSuiBalanceFormatted(formatMistToSui(mist));
      })
      .catch(() => {
        if (active) setSuiBalanceFormatted(null);
      });
    return () => {
      active = false;
    };
  }, [save.blockchain.suiIdentifier, save.blockchain.network]);

  // Mount WebGL RunnerEngine once
  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    const initial = saveRef.current;
    const engine = new RunnerEngine(
      container,
      initial.selectedCharacter,
      initial.settings.difficulty,
      initial.settings.sfxEnabled,
      initial.settings.musicEnabled,
      initial.settings.musicBeat,
      {
        onHudUpdate: (snapshot) => {
          setHud(snapshot);
        },
        onGameOver: (result) => {
          const prev = saveRef.current;
          const isNewBest = result.score > prev.highScore;
          setLastRun({ ...result, isNewBest });
          setScreen('gameover');

          const nextLifetime = prev.lifetimeCoins + result.runCoins;
          const nextUnlocked = new Set<CharacterId>(prev.unlockedCharacters);
          for (const c of CHARACTERS) {
            if (nextLifetime >= c.unlockCoins) nextUnlocked.add(c.id);
          }
          const nextSave: SaveData = {
            ...prev,
            lifetimeCoins: nextLifetime,
            coinBalance: prev.coinBalance + result.runCoins,
            unlockedCharacters: Array.from(nextUnlocked),
            highScore: Math.max(prev.highScore, result.score),
            bestDistance: Math.max(prev.bestDistance, result.distance),
          };

          updateSave(() => nextSave);

          const user = firebaseUserRef.current;
          if (user && result.score > 0) {
            recordDailyRun(user, nextSave, {
              score: result.score,
              distance: result.distance,
              runCoins: result.runCoins,
              characterId: prev.selectedCharacter,
              difficulty: prev.settings.difficulty,
            })
              .then(() => {
                if (screenRef.current === 'web3') {
                  void refreshDailyRuns();
                }
              })
              .catch(() => {
                // Keep gameplay uninterrupted if offline
              });
          }
        },
        onPauseRequest: () => {
          if (screenRef.current === 'playing') {
            engine.setScreen('paused');
            setScreen('paused');
          } else if (screenRef.current === 'paused') {
            engine.setScreen('playing');
            setScreen('playing');
          }
        },
        onContextLost: (lost) => {
          setContextLost(lost);
        },
      },
    );

    engineRef.current = engine;

    const unlockOnGesture = () => {
      engine.unlockAudio();
    };
    window.addEventListener('pointerdown', unlockOnGesture, { passive: true });
    window.addEventListener('keydown', unlockOnGesture, { passive: true });

    return () => {
      window.removeEventListener('pointerdown', unlockOnGesture);
      window.removeEventListener('keydown', unlockOnGesture);
      engine.dispose();
      engineRef.current = null;
    };
  }, [updateSave, refreshDailyRuns]);

  const handleStartGame = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    setConfirmReset(false);

    const cur = saveRef.current;
    const activeBoosters = cur.equippedBoosters.filter((id) => (cur.boosters[id] ?? 0) > 0);
    engine.setLoadout({
      upgrades: cur.upgrades,
      activeBoosters,
    });

    // Consume 1 charge of each armed booster for this run
    if (activeBoosters.length > 0) {
      updateSave((prev) => {
        const nextBoosters = { ...prev.boosters };
        for (const id of activeBoosters) {
          nextBoosters[id] = Math.max(0, (nextBoosters[id] ?? 0) - 1);
        }
        const nextEquipped = prev.equippedBoosters.filter((id) => (nextBoosters[id] ?? 0) > 0);
        return {
          ...prev,
          boosters: nextBoosters,
          equippedBoosters: nextEquipped,
        };
      });
    }

    engine.setCharacter(cur.selectedCharacter, false);
    setScreen('playing');
    engine.startRun();
  }, [updateSave]);

  const handleGoMenu = useCallback(() => {
    const engine = engineRef.current;
    setConfirmReset(false);
    setPreviewCharId(saveRef.current.selectedCharacter);
    setScreen('menu');
    if (engine) {
      engine.audio.play('uiClick');
      engine.setCharacter(saveRef.current.selectedCharacter, false);
      engine.setScreen('menu');
      engine.previewScene(previewSceneId);
    }
  }, [previewSceneId]);

  const handleOpenCharacter = useCallback(() => {
    const engine = engineRef.current;
    const selected = saveRef.current.selectedCharacter;
    const homeWorld = getCharacterById(selected).homeWorldId;
    setPreviewCharId(selected);
    setPreviewSceneId(homeWorld);
    setScreen('character');
    if (engine) {
      engine.audio.play('uiClick');
      engine.setCharacter(selected, true);
      engine.previewScene(homeWorld);
      engine.setScreen('character');
    }
  }, []);

  const handleOpenStore = useCallback(() => {
    const engine = engineRef.current;
    setConfirmReset(false);
    setScreen('store');
    if (engine) {
      engine.audio.play('uiClick');
      engine.setScreen('store');
    }
  }, []);

  const handleOpenWeb3 = useCallback(() => {
    const engine = engineRef.current;
    setConfirmReset(false);
    setWeb3Status(null);
    setScreen('web3');
    void refreshDailyRuns();
    if (engine) {
      engine.audio.play('uiClick');
      engine.setScreen('web3');
    }
  }, [refreshDailyRuns]);

  const handleOpenSettings = useCallback(() => {
    const engine = engineRef.current;
    setConfirmReset(false);
    setScreen('settings');
    if (engine) {
      engine.audio.play('uiClick');
      engine.setScreen('settings');
    }
  }, []);

  // Store purchase & loadout handlers
  const handleBuyUpgrade = useCallback(
    (upgradeId: UpgradeId) => {
      const cfg = STORE_UPGRADES.find((u) => u.id === upgradeId);
      if (!cfg) return;
      const cur = saveRef.current;
      const level = cur.upgrades[upgradeId] ?? 0;
      if (level >= cfg.maxLevel) return;
      const cost = getUpgradeCost(cfg, level);
      if (cur.coinBalance < cost) return;
      engineRef.current?.audio.play('coin');
      updateSave((prev) => ({
        ...prev,
        coinBalance: prev.coinBalance - cost,
        upgrades: { ...prev.upgrades, [upgradeId]: level + 1 },
      }));
    },
    [updateSave],
  );

  const handleBuyBooster = useCallback(
    (boosterId: BoosterId) => {
      const cfg = STORE_BOOSTERS.find((b) => b.id === boosterId);
      if (!cfg) return;
      const cur = saveRef.current;
      const owned = cur.boosters[boosterId] ?? 0;
      if (owned >= cfg.maxStack || cur.coinBalance < cfg.cost) return;
      engineRef.current?.audio.play('coin');
      updateSave((prev) => {
        const nextOwned = (prev.boosters[boosterId] ?? 0) + 1;
        const nextEquipped = prev.equippedBoosters.includes(boosterId)
          ? prev.equippedBoosters
          : [...prev.equippedBoosters, boosterId];
        return {
          ...prev,
          coinBalance: prev.coinBalance - cfg.cost,
          boosters: { ...prev.boosters, [boosterId]: nextOwned },
          equippedBoosters: nextEquipped,
        };
      });
    },
    [updateSave],
  );

  const handleToggleBooster = useCallback(
    (boosterId: BoosterId) => {
      const cur = saveRef.current;
      if ((cur.boosters[boosterId] ?? 0) <= 0) return;
      engineRef.current?.audio.play('uiClick');
      updateSave((prev) => {
        const armed = prev.equippedBoosters.includes(boosterId);
        return {
          ...prev,
          equippedBoosters: armed
            ? prev.equippedBoosters.filter((id) => id !== boosterId)
            : [...prev.equippedBoosters, boosterId],
        };
      });
    },
    [updateSave],
  );

  const handleUnlockCharacterInStore = useCallback(
    (charId: CharacterId) => {
      const cfg = getCharacterById(charId);
      const cur = saveRef.current;
      if (isCharacterUnlocked(cur, charId) || cur.coinBalance < cfg.unlockCoins) return;
      engineRef.current?.audio.play('star');
      engineRef.current?.setCharacter(charId, true);
      engineRef.current?.previewScene(cfg.homeWorldId);
      setPreviewCharId(charId);
      setPreviewSceneId(cfg.homeWorldId);
      updateSave((prev) => ({
        ...prev,
        coinBalance: prev.coinBalance - cfg.unlockCoins,
        selectedCharacter: charId,
        unlockedCharacters: Array.from(new Set([...prev.unlockedCharacters, charId])),
      }));
    },
    [updateSave],
  );

  const handleEquipCharacterFromStore = useCallback(
    (charId: CharacterId) => {
      const cfg = getCharacterById(charId);
      engineRef.current?.audio.play('uiClick');
      engineRef.current?.setCharacter(charId, true);
      engineRef.current?.previewScene(cfg.homeWorldId);
      setPreviewCharId(charId);
      setPreviewSceneId(cfg.homeWorldId);
      updateSave((prev) => ({ ...prev, selectedCharacter: charId }));
    },
    [updateSave],
  );

  // Google Sign-In & On-Demand Sui Rewards handlers (desktop & mobile popup + redirect fallback)
  const handleSignInGoogle = useCallback(() => {
    setWeb3Busy('google_auth');
    setWeb3Status(null);
    // Call signInWithGoogle synchronously inside the tap/click event stack so mobile Safari/Chrome
    // preserves the user-activation token for Google OAuth popups.
    signInWithGoogle()
      .then(({ user, redirected }) => {
        if (redirected) {
          setWeb3Status('Redirecting to Google Sign-In...');
          return;
        }
        if (user) {
          setWeb3Status(
            `Signed in as ${user.displayName || user.email || 'Google Player'}. Progress synced.`,
          );
          engineRef.current?.audio.play('uiClick');
        }
      })
      .catch((err) => {
        const code = (err as { code?: string })?.code ?? '';
        const inIframe = isInEmbeddedIframe();
        if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
          setWeb3Status(
            inIframe
              ? 'Sign-in window closed. On phones, open the app directly in Chrome or Safari if pop-ups close automatically.'
              : 'Google sign-in canceled. Tap "Sign in with Google" or use full-page sign-in below.',
          );
        } else if (code === 'auth/popup-blocked') {
          setWeb3Status(
            inIframe
              ? 'Your mobile browser blocked the pop-up inside this preview. Open the link directly in Safari/Chrome or allow pop-ups.'
              : 'Pop-up was blocked by your mobile browser. Tap "Use Full-Page Sign-In" to continue.',
          );
        } else if (code === 'auth/unauthorized-domain') {
          setWeb3Status('This preview URL is not yet authorized for Google Sign-In in Firebase Auth.');
        } else {
          setWeb3Status(err instanceof Error ? err.message : 'Unable to sign in with Google right now.');
        }
      })
      .finally(() => {
        setWeb3Busy(null);
      });
  }, []);

  const handleSignInGoogleRedirect = useCallback(() => {
    setWeb3Busy('google_auth');
    setWeb3Status('Opening Google Sign-In...');
    signInWithGoogleRedirect().catch((err) => {
      setWeb3Status(err instanceof Error ? err.message : 'Unable to start Google Sign-In.');
      setWeb3Busy(null);
    });
  }, []);

  const handleSignOutGoogle = useCallback(async () => {
    setWeb3Busy('google_auth');
    try {
      await signOutGoogle();
      setWeb3Status('Signed out of Google. Local progress remains saved on this device.');
      engineRef.current?.audio.play('uiClick');
    } finally {
      setWeb3Busy(null);
    }
  }, []);

  const handleSwitchNetwork = useCallback(
    (network: SuiNetworkId) => {
      engineRef.current?.audio.play('uiClick');
      setWeb3Status(null);
      updateSave((prev) => ({
        ...prev,
        blockchain: { ...prev.blockchain, network },
      }));
    },
    [updateSave],
  );

  const handleSaveSuiIdentifier = useCallback(
    async (identifier: string) => {
      const clean = identifier.trim().slice(0, 100);
      engineRef.current?.audio.play('uiClick');
      updateSave((prev) => ({
        ...prev,
        blockchain: { ...prev.blockchain, suiIdentifier: clean },
      }));
      setWeb3Status(`Saved reward destination: ${formatSuiIdentifier(clean)}.`);
    },
    [updateSave],
  );

  const handleRefreshBalance = useCallback(async () => {
    const suiId = saveRef.current.blockchain.suiIdentifier.trim();
    if (!suiId) return;
    engineRef.current?.audio.play('uiClick');
    const mist = await fetchSuiBalanceMist(saveRef.current.blockchain.network, suiId);
    setSuiBalanceFormatted(formatMistToSui(mist));
  }, []);

  const handleClaimCoins = useCallback(
    async (overrideIdentifier?: string) => {
      const user = firebaseUserRef.current;
      if (!user) return;
      const cur = saveRef.current;
      const suiId = (overrideIdentifier ?? cur.blockchain.suiIdentifier).trim();
      if (!suiId) return;
      const claimable = Math.max(0, cur.lifetimeCoins - cur.blockchain.claimedCoins);
      if (claimable <= 0) return;

      setWeb3Busy('claim_coins');
      setWeb3Status(null);
      try {
        const { receipt } = await createAccountOnChainReceipt({
          accountUid: user.uid,
          suiIdentifier: suiId,
          network: cur.blockchain.network,
          kind: 'claim_coins',
          summary: `Claimed ${claimable.toLocaleString()} SUI Runner Coins`,
          payload: { amount: claimable },
        });
        const nextSave: SaveData = {
          ...cur,
          blockchain: {
            ...cur.blockchain,
            suiIdentifier: suiId,
            claimedCoins: cur.blockchain.claimedCoins + claimable,
            receipts: [receipt, ...cur.blockchain.receipts].slice(0, 20),
          },
        };
        writeSaveData(nextSave);
        setSave(nextSave);
        await recordCloudReceipt(user, nextSave, receipt, suiId);
        setWeb3Status(
          `Claimed ${claimable.toLocaleString()} SUI Runner Coins for ${formatSuiIdentifier(suiId)}.`,
        );
        engineRef.current?.audio.play('coin');
      } catch (err) {
        setWeb3Status(err instanceof Error ? err.message : 'Unable to record reward claim.');
      } finally {
        setWeb3Busy(null);
      }
    },
    [],
  );

  const handleSubmitScore = useCallback(
    async (overrideIdentifier?: string) => {
      const user = firebaseUserRef.current;
      if (!user) return;
      const cur = saveRef.current;
      const suiId = (overrideIdentifier ?? cur.blockchain.suiIdentifier).trim();
      if (!suiId) return;
      if (cur.highScore <= 0 || cur.highScore <= cur.blockchain.onChainBestScore) return;

      setWeb3Busy('submit_score');
      setWeb3Status(null);
      try {
        const { receipt } = await createAccountOnChainReceipt({
          accountUid: user.uid,
          suiIdentifier: suiId,
          network: cur.blockchain.network,
          kind: 'submit_score',
          summary: `Verified High Score ${cur.highScore.toLocaleString()} (${cur.bestDistance}m)`,
          payload: {
            score: cur.highScore,
            distance: cur.bestDistance,
            characterId: cur.selectedCharacter,
          },
        });
        const nextSave: SaveData = {
          ...cur,
          blockchain: {
            ...cur.blockchain,
            suiIdentifier: suiId,
            onChainBestScore: Math.max(cur.blockchain.onChainBestScore, cur.highScore),
            receipts: [receipt, ...cur.blockchain.receipts].slice(0, 20),
          },
        };
        writeSaveData(nextSave);
        setSave(nextSave);
        await recordCloudReceipt(user, nextSave, receipt, suiId);
        await recordDailyRun(user, nextSave, {
          score: cur.highScore,
          distance: cur.bestDistance,
          runCoins: 0,
          characterId: cur.selectedCharacter,
          difficulty: cur.settings.difficulty,
        }).catch(() => {});
        void refreshDailyRuns();
        setWeb3Status(
          `Verified high score ${cur.highScore.toLocaleString()} for ${formatSuiIdentifier(suiId)}.`,
        );
        engineRef.current?.audio.play('star');
      } catch (err) {
        setWeb3Status(err instanceof Error ? err.message : 'Unable to submit score right now.');
      } finally {
        setWeb3Busy(null);
      }
    },
    [refreshDailyRuns],
  );

  const handleMintYetiNft = useCallback(
    async (charId: CharacterId, overrideIdentifier?: string) => {
      const user = firebaseUserRef.current;
      if (!user) return;
      const cur = saveRef.current;
      const suiId = (overrideIdentifier ?? cur.blockchain.suiIdentifier).trim();
      if (!suiId) return;
      if (!isCharacterUnlocked(cur, charId) || cur.blockchain.mintedNfts[charId]) return;

      const cfg = getCharacterById(charId);
      setWeb3Busy(`mint_${charId}`);
      setWeb3Status(null);
      try {
        const { receipt, objectId } = await createAccountOnChainReceipt({
          accountUid: user.uid,
          suiIdentifier: suiId,
          network: cur.blockchain.network,
          kind: 'mint_yeti',
          summary: `Minted ${cfg.name} Yeti NFT`,
          payload: {
            characterId: cfg.id,
            name: cfg.name,
            tier: cfg.tier,
            homeWorld: cfg.homeWorldId,
          },
        });
        const nextSave: SaveData = {
          ...cur,
          unlockedCharacters: Array.from(new Set([...cur.unlockedCharacters, charId])),
          blockchain: {
            ...cur.blockchain,
            suiIdentifier: suiId,
            mintedNfts: {
              ...cur.blockchain.mintedNfts,
              [charId]: {
                characterId: charId,
                objectId: objectId ?? receipt.digest,
                network: cur.blockchain.network,
                mintedAt: receipt.timestamp,
                digest: receipt.digest,
              },
            },
            receipts: [receipt, ...cur.blockchain.receipts].slice(0, 20),
          },
        };
        writeSaveData(nextSave);
        setSave(nextSave);
        await recordCloudReceipt(user, nextSave, receipt, suiId);
        setWeb3Status(`Minted ${cfg.name} Yeti NFT for ${formatSuiIdentifier(suiId)}.`);
        engineRef.current?.audio.play('portalWarp');
      } catch (err) {
        setWeb3Status(err instanceof Error ? err.message : 'Unable to mint Yeti NFT right now.');
      } finally {
        setWeb3Busy(null);
      }
    },
    [],
  );

  const handleTogglePause = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (screen === 'playing') {
      engine.setScreen('paused');
      setScreen('paused');
    } else if (screen === 'paused') {
      engine.setScreen('playing');
      setScreen('playing');
    }
  }, [screen]);

  const handleSelectCharacter = useCallback(
    (charId: CharacterId, unlocked: boolean) => {
      const engine = engineRef.current;
      const cfg = getCharacterById(charId);
      setPreviewCharId(charId);
      setPreviewSceneId(cfg.homeWorldId);
      engine?.audio.play('uiClick');
      engine?.setCharacter(charId, true);
      engine?.previewScene(cfg.homeWorldId);
      if (unlocked) {
        updateSave((prev) => ({ ...prev, selectedCharacter: charId }));
      }
    },
    [updateSave],
  );

  const handleSelectDifficulty = useCallback(
    (difficulty: DifficultyId) => {
      const engine = engineRef.current;
      engine?.audio.play('uiClick');
      engine?.setDifficulty(difficulty);
      updateSave((prev) => ({
        ...prev,
        settings: { ...prev.settings, difficulty },
      }));
    },
    [updateSave],
  );

  const handleToggleSfx = useCallback(() => {
    const nextVal = !saveRef.current.settings.sfxEnabled;
    engineRef.current?.setSfxEnabled(nextVal);
    if (nextVal) engineRef.current?.audio.play('uiClick');
    updateSave((prev) => ({
      ...prev,
      settings: { ...prev.settings, sfxEnabled: nextVal },
    }));
  }, [updateSave]);

  const handleToggleMusic = useCallback(() => {
    const nextVal = !saveRef.current.settings.musicEnabled;
    engineRef.current?.setMusicEnabled(nextVal);
    engineRef.current?.audio.play('uiClick');
    updateSave((prev) => ({
      ...prev,
      settings: { ...prev.settings, musicEnabled: nextVal },
    }));
  }, [updateSave]);

  const handleSelectMusicBeat = useCallback(
    (beat: MusicBeatId) => {
      engineRef.current?.audio.play('uiClick');
      engineRef.current?.setMusicBeat(beat);
      if (!saveRef.current.settings.musicEnabled) {
        engineRef.current?.setMusicEnabled(true);
      }
      updateSave((prev) => ({
        ...prev,
        settings: { ...prev.settings, musicEnabled: true, musicBeat: beat },
      }));
    },
    [updateSave],
  );

  const handleToggleHints = useCallback(() => {
    engineRef.current?.audio.play('uiClick');
    updateSave((prev) => ({
      ...prev,
      settings: { ...prev.settings, showHints: !prev.settings.showHints },
    }));
  }, [updateSave]);

  const handleConfirmReset = useCallback(() => {
    const fresh = resetSaveData();
    const homeWorld = getCharacterById(fresh.selectedCharacter).homeWorldId;
    setSave(fresh);
    setPreviewCharId(fresh.selectedCharacter);
    setPreviewSceneId(homeWorld);
    setConfirmReset(false);
    engineRef.current?.setCharacter(fresh.selectedCharacter, false);
    engineRef.current?.previewScene(homeWorld);
    engineRef.current?.setDifficulty(fresh.settings.difficulty);
    engineRef.current?.setSfxEnabled(fresh.settings.sfxEnabled);
    engineRef.current?.setMusicEnabled(fresh.settings.musicEnabled);
    engineRef.current?.setMusicBeat(fresh.settings.musicBeat);
    engineRef.current?.audio.play('uiClick');
  }, []);

  const handleScenePreview = useCallback((sceneId: SceneId) => {
    setPreviewSceneId(sceneId);
    engineRef.current?.audio.play('uiClick');
    engineRef.current?.previewScene(sceneId);
  }, []);

  // Keyboard shortcuts for Menu, Submenus, and Game Over
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (screen === 'menu') {
        if (e.code === 'Enter' || e.code === 'Space') {
          e.preventDefault();
          handleStartGame();
        }
      } else if (screen === 'gameover') {
        if (e.code === 'Enter' || e.code === 'Space') {
          e.preventDefault();
          handleStartGame();
        } else if (e.code === 'Escape') {
          e.preventDefault();
          handleGoMenu();
        }
      } else if (
        screen === 'character' ||
        screen === 'store' ||
        screen === 'web3' ||
        screen === 'settings'
      ) {
        if (e.code === 'Escape') {
          e.preventDefault();
          handleGoMenu();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [screen, handleStartGame, handleGoMenu]);

  const equippedChar = getCharacterById(save.selectedCharacter);
  const previewChar = getCharacterById(previewCharId);
  const activeRunChar = getCharacterById(hud.characterId);

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#090d16] text-slate-100 select-none">
      {/* Isolated full-viewport 3D WebGL canvas */}
      <div ref={canvasMountRef} className="absolute inset-0 w-full h-full" />

      {/* Luminous chromatic 3D World Portal warp flash overlay */}
      {hud.sceneFadeOpacity > 0.01 && (
        <div
          className="pointer-events-none absolute inset-0 z-20"
          style={{
            backgroundColor: hud.portalWarpColor,
            opacity: hud.sceneFadeOpacity,
          }}
        />
      )}

      {/* WebGL context-lost fallback */}
      {contextLost && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#090d16]/95 p-6 text-center">
          <div className="max-w-sm rounded-xl border border-white/15 bg-[#101726] p-6">
            <h2 className="font-[var(--font-display)] text-xl font-bold text-white">
              Graphics Context Paused
            </h2>
            <p className="mt-2 text-sm text-slate-300">
              Restoring the 3D WebGL viewport. Refresh if rendering does not resume automatically.
            </p>
          </div>
        </div>
      )}

      {/* ==================== MAIN MENU ==================== */}
      {screen === 'menu' && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between p-4 sm:p-6">
          <header className="pointer-events-auto flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <CharacterAvatar
                src={equippedChar.portraitUrl}
                alt={equippedChar.name}
                accentHex={equippedChar.accentHex}
                className="h-12 w-12"
              />
              <div>
                <h1 className="font-[var(--font-display)] text-2xl sm:text-3xl font-extrabold tracking-tight text-white leading-none">
                  Lofi Yeti Runner
                </h1>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-300 tabular-nums">
                  <span className="font-semibold text-white">{equippedChar.name}</span>
                  <span aria-hidden="true">·</span>
                  <span>Best {save.highScore.toLocaleString()}</span>
                  <span aria-hidden="true">·</span>
                  <span className="text-amber-300 font-semibold">
                    {save.coinBalance.toLocaleString()} SUI Coins
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{DIFFICULTIES[save.settings.difficulty].label}</span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Quick Instrumental Beat Toggle */}
              <button
                type="button"
                onClick={handleToggleMusic}
                aria-label={save.settings.musicEnabled ? 'Mute background beats' : 'Play background beats'}
                title={
                  save.settings.musicEnabled
                    ? `Beat: ${getMusicBeatLabel(save.settings.musicBeat, previewSceneId)}`
                    : 'Beats Muted'
                }
                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 touch-manipulation min-h-[36px] ${
                  save.settings.musicEnabled
                    ? 'border-emerald-400/45 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25'
                    : 'border-white/12 bg-[#0c1220]/90 text-slate-400 hover:text-slate-200 hover:bg-white/5'
                }`}
              >
                <Music className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">
                  {save.settings.musicEnabled
                    ? getMusicBeatLabel(save.settings.musicBeat, previewSceneId)
                    : 'Beats Off'}
                </span>
              </button>

              {/* Google Account Sign-In / Account Trigger (works seamlessly on desktop & mobile) */}
              {account ? (
                <button
                  type="button"
                  onClick={handleOpenWeb3}
                  className="flex items-center gap-2 rounded-lg border border-sky-400/45 bg-sky-500/15 px-3 py-1.5 text-xs font-semibold text-sky-100 hover:bg-sky-500/25 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  {account.photoURL ? (
                    <img
                      src={account.photoURL}
                      alt={account.displayName}
                      referrerPolicy="no-referrer"
                      className="h-5 w-5 rounded-full object-cover border border-white/20"
                    />
                  ) : (
                    <User className="h-3.5 w-3.5 text-sky-300" />
                  )}
                  <span className="max-w-[110px] truncate">{account.displayName}</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!authReady || web3Busy !== null}
                  onClick={handleSignInGoogle}
                  className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-bold text-slate-900 hover:bg-slate-100 active:scale-[0.98] transition-all cursor-pointer whitespace-nowrap shrink-0 touch-manipulation min-h-[36px]"
                >
                  <User className="h-3.5 w-3.5 text-sky-600" />
                  {web3Busy === 'google_auth' ? 'Signing in...' : 'Sign in with Google'}
                </button>
              )}

              {/* 5 Yeti Worlds Preview Selector */}
              <div className="flex flex-wrap items-center gap-1 rounded-lg border border-white/12 bg-[#0c1220]/90 p-1">
                {SCENE_ORDER.map((sid) => {
                  const active = previewSceneId === sid;
                  return (
                    <button
                      key={sid}
                      type="button"
                      onClick={() => handleScenePreview(sid)}
                      className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        active
                          ? 'bg-sky-400 text-slate-950 font-semibold'
                          : 'text-slate-300 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <span className="lg:hidden">{SCENE_SHORT_NAMES[sid]}</span>
                      <span className="hidden lg:inline">{SCENE_NAMES[sid]}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </header>

          {/* Visible Google Auth Status / Mobile Fallback Banner on Menu Screen */}
          {web3Status && (
            <div className="pointer-events-auto mx-auto mt-2 flex w-full max-w-2xl flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-400/35 bg-[#0c1220]/95 px-3.5 py-2.5 text-xs text-sky-100 shadow-lg">
              <span className="flex-1 min-w-[200px]">{web3Status}</span>
              <div className="flex items-center gap-2 shrink-0">
                {!account && !isInEmbeddedIframe() && (
                  <button
                    type="button"
                    disabled={web3Busy !== null}
                    onClick={handleSignInGoogleRedirect}
                    className="rounded-lg bg-sky-400 px-2.5 py-1.5 text-[11px] font-bold text-slate-950 hover:bg-sky-300 cursor-pointer whitespace-nowrap touch-manipulation"
                  >
                    Use Full-Page Sign-In
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setWeb3Status(null)}
                  className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300 hover:bg-white/10 cursor-pointer whitespace-nowrap"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {/* Bottom Unified Action Dock */}
          <footer className="pointer-events-auto mx-auto w-full max-w-2xl">
            <div className="rounded-2xl border border-white/12 bg-[#0c1220]/90 p-3 sm:p-4 shadow-2xl">
              <div className="mb-2.5 flex items-center justify-between text-xs text-slate-300 px-1 gap-2">
                <span className="truncate">
                  Active Perk: <strong className="text-white">{equippedChar.perkName}</strong>
                  {save.equippedBoosters.length > 0 && (
                    <span className="ml-2 text-amber-300 font-semibold">
                      · {save.equippedBoosters.length} Booster
                      {save.equippedBoosters.length > 1 ? 's' : ''} Armed
                    </span>
                  )}
                </span>
                <span className="text-slate-400 hidden sm:inline truncate max-w-[52%]">
                  {equippedChar.perkDescription}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleStartGame}
                  className="flex-1 min-w-[140px] flex items-center justify-center gap-2 rounded-xl bg-sky-400 px-5 py-3.5 font-[var(--font-display)] text-base font-bold text-slate-950 transition-transform active:scale-[0.98] hover:bg-sky-300 cursor-pointer whitespace-nowrap"
                >
                  <Play className="h-5 w-5 fill-current" />
                  Play Run
                </button>

                <button
                  type="button"
                  onClick={handleOpenStore}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-amber-400/35 bg-amber-500/12 px-4 py-3.5 text-sm font-semibold text-amber-200 transition-colors hover:bg-amber-500/20 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <ShoppingBag className="h-4 w-4 text-amber-300" />
                  Store
                </button>

                <button
                  type="button"
                  onClick={handleOpenCharacter}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-white/14 bg-white/5 px-4 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-white/10 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <User className="h-4 w-4 text-sky-300" />
                  Yetis ({CHARACTERS.filter((c) => isCharacterUnlocked(save, c.id)).length}/{CHARACTERS.length})
                </button>

                <button
                  type="button"
                  onClick={handleOpenWeb3}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-sky-400/30 bg-sky-500/10 px-4 py-3.5 text-sm font-semibold text-sky-200 transition-colors hover:bg-sky-500/20 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Wallet className="h-4 w-4 text-sky-300" />
                  Rewards
                </button>

                <button
                  type="button"
                  onClick={handleOpenSettings}
                  aria-label="Settings"
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-white/14 bg-white/5 px-3.5 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-white/10 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Settings className="h-4 w-4 text-slate-300" />
                </button>
              </div>

              {save.settings.showHints && (
                <div className="mt-2.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
                  <span>Enter / Space to start</span>
                  <span aria-hidden="true">·</span>
                  <span>A/D or Arrows move</span>
                  <span aria-hidden="true">·</span>
                  <span>Double Jump for Backflip</span>
                  <span aria-hidden="true">·</span>
                  <span>X Spin · Z Slash</span>
                </div>
              )}
            </div>
          </footer>
        </div>
      )}

      {/* ==================== 5-CHARACTER LOFI MYSTIC YETIS ROSTER ==================== */}
      {screen === 'character' && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between p-4 sm:p-6">
          <header className="pointer-events-auto flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={handleGoMenu}
              className="flex items-center gap-1.5 rounded-xl border border-white/14 bg-[#0c1220]/90 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/10 transition-colors cursor-pointer"
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleOpenStore}
                className="flex items-center gap-1.5 rounded-xl border border-amber-400/35 bg-[#0c1220]/90 px-3.5 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/15 transition-colors cursor-pointer whitespace-nowrap"
              >
                <ShoppingBag className="h-3.5 w-3.5" />
                Store
              </button>
              <div className="rounded-xl border border-white/12 bg-[#0c1220]/90 px-4 py-2 text-sm font-semibold text-amber-300 tabular-nums flex items-center gap-2">
                <Coins className="h-4 w-4" />
                {save.coinBalance.toLocaleString()} SUI Coins
              </div>
            </div>
          </header>

          {/* Bottom 5-Yeti Roster Dock (keeps live 3D Yeti showcase centered & unobstructed!) */}
          <section className="pointer-events-auto mx-auto w-full max-w-4xl rounded-2xl border border-white/12 bg-[#0c1220]/92 p-4 shadow-2xl">
            {/* Focused Yeti Details Row */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 mb-3 border-b border-white/10">
              <div>
                <div className="flex items-center gap-2.5">
                  <h2 className="font-[var(--font-display)] text-lg font-extrabold text-white">
                    {previewChar.name}
                  </h2>
                  <span className="text-xs text-slate-400">{previewChar.tier}</span>
                </div>
                <p className="text-xs text-slate-300 mt-0.5">
                  <span className="font-semibold" style={{ color: previewChar.accentHex }}>
                    {previewChar.perkName}:
                  </span>{' '}
                  {previewChar.perkDescription}
                </p>
              </div>

              <div className="text-xs tabular-nums shrink-0">
                {save.selectedCharacter === previewChar.id ? (
                  <span className="font-semibold text-sky-300">Equipped for Next Run</span>
                ) : isCharacterUnlocked(save, previewChar.id) ? (
                  <span className="text-emerald-300 font-semibold">Unlocked</span>
                ) : (
                  <span className="text-amber-300 font-semibold">
                    Needs {Math.max(0, previewChar.unlockCoins - save.lifetimeCoins).toLocaleString()} more SUI coins
                  </span>
                )}
              </div>
            </div>

            {/* 5 Character Cards Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {CHARACTERS.map((char) => {
                const unlocked = isCharacterUnlocked(save, char.id);
                const equipped = save.selectedCharacter === char.id;
                const previewing = previewCharId === char.id;

                return (
                  <button
                    key={char.id}
                    type="button"
                    onClick={() => handleSelectCharacter(char.id, unlocked)}
                    className={`flex flex-col items-center rounded-xl border p-2.5 text-center transition-colors cursor-pointer ${
                      previewing
                        ? 'border-sky-400 bg-sky-500/15'
                        : unlocked
                          ? 'border-white/12 bg-white/[0.04] hover:bg-white/[0.08]'
                          : 'border-white/8 bg-white/[0.02] hover:bg-white/[0.06]'
                    }`}
                  >
                    <div className="relative">
                      <CharacterAvatar
                        src={char.portraitUrl}
                        alt={char.name}
                        accentHex={char.accentHex}
                        className={`h-14 w-14 ${!unlocked ? 'opacity-65' : ''}`}
                      />
                      {!unlocked && (
                        <div className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#090d16] border border-white/20">
                          <Lock className="h-3 w-3 text-amber-300" />
                        </div>
                      )}
                    </div>

                    <div className="mt-2 font-[var(--font-display)] text-xs font-bold text-white whitespace-nowrap truncate max-w-full">
                      {char.name}
                    </div>
                    <div className="mt-0.5 text-[11px] tabular-nums">
                      {equipped ? (
                        <span className="font-semibold text-sky-300">Equipped</span>
                      ) : unlocked ? (
                        <span className="text-slate-300">Select</span>
                      ) : (
                        <span className="text-amber-300">{char.unlockCoins} SUI</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {/* ==================== IN-GAME STORE ==================== */}
      {screen === 'store' && (
        <StoreOverlay
          save={save}
          onClose={handleGoMenu}
          onBuyUpgrade={handleBuyUpgrade}
          onBuyBooster={handleBuyBooster}
          onToggleBooster={handleToggleBooster}
          onUnlockCharacter={handleUnlockCharacterInStore}
          onEquipCharacter={handleEquipCharacterFromStore}
        />
      )}

      {/* ==================== ACCOUNT & SUI REWARDS HUB ==================== */}
      {screen === 'web3' && (
        <Web3HubOverlay
          save={save}
          account={account}
          authReady={authReady}
          suiBalanceFormatted={suiBalanceFormatted}
          busyAction={web3Busy}
          statusMessage={web3Status}
          dailyRuns={dailyRuns}
          dailyRunsLoading={dailyRunsLoading}
          dailyRunsError={dailyRunsError}
          onRefreshDailyRuns={refreshDailyRuns}
          onClose={handleGoMenu}
          onSignInGoogle={handleSignInGoogle}
          onSignInGoogleRedirect={handleSignInGoogleRedirect}
          onSignOutGoogle={handleSignOutGoogle}
          onSwitchNetwork={handleSwitchNetwork}
          onSaveSuiIdentifier={handleSaveSuiIdentifier}
          onRefreshBalance={handleRefreshBalance}
          onClaimCoins={handleClaimCoins}
          onSubmitScore={handleSubmitScore}
          onMintYetiNft={handleMintYetiNft}
        />
      )}

      {/* ==================== SETTINGS SCREEN ==================== */}
      {screen === 'settings' && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#060a14]/75 p-4">
          <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-white/14 bg-[#0d1424] p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-white/10">
              <h2 className="font-[var(--font-display)] text-xl font-bold text-white">Settings</h2>
              <button
                type="button"
                onClick={handleGoMenu}
                className="flex items-center gap-1 rounded-lg border border-white/12 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10 transition-colors cursor-pointer"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Back
              </button>
            </div>

            <div className="mt-5 space-y-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-white">Background Beats</div>
                  <div className="text-xs text-slate-400">
                    Instrumental beats matched to each world
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleToggleMusic}
                  className={`flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                    save.settings.musicEnabled
                      ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-200'
                      : 'border-white/12 bg-white/5 text-slate-400'
                  }`}
                >
                  <Music className="h-4 w-4" />
                  {save.settings.musicEnabled ? 'On' : 'Off'}
                </button>
              </div>

              <div>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-white">Beat Style</div>
                  <span className="text-[11px] font-medium text-emerald-300">
                    {save.settings.musicEnabled
                      ? `Now Playing: ${getMusicBeatLabel(save.settings.musicBeat, previewSceneId)}`
                      : 'Muted'}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  {MUSIC_BEATS.map((beat) => {
                    const active = save.settings.musicBeat === beat.id;
                    return (
                      <button
                        key={beat.id}
                        type="button"
                        onClick={() => handleSelectMusicBeat(beat.id)}
                        className={`rounded-xl border px-3 py-2 text-left transition-colors cursor-pointer ${
                          active
                            ? 'border-emerald-400/60 bg-emerald-500/18 text-white'
                            : 'border-white/10 bg-[#070b15] text-slate-300 hover:border-white/20 hover:text-white'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-bold truncate">{beat.name}</span>
                          <span className="text-[10px] font-mono text-slate-400 shrink-0">
                            {beat.bpmLabel}
                          </span>
                        </div>
                        <div className="mt-0.5 text-[10px] text-slate-400 truncate">
                          {beat.genre}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-white">Sound Effects</div>
                  <div className="text-xs text-slate-400">Synth audio for jumps, coins, and stunts</div>
                </div>
                <button
                  type="button"
                  onClick={handleToggleSfx}
                  className={`flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                    save.settings.sfxEnabled
                      ? 'border-sky-400/50 bg-sky-500/20 text-sky-200'
                      : 'border-white/12 bg-white/5 text-slate-400'
                  }`}
                >
                  {save.settings.sfxEnabled ? (
                    <>
                      <Volume2 className="h-4 w-4" /> On
                    </>
                  ) : (
                    <>
                      <VolumeX className="h-4 w-4" /> Off
                    </>
                  )}
                </button>
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-white">Control Hints</div>
                  <div className="text-xs text-slate-400">Show key and touch controls bar</div>
                </div>
                <button
                  type="button"
                  onClick={handleToggleHints}
                  className={`rounded-lg border px-4 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                    save.settings.showHints
                      ? 'border-sky-400/50 bg-sky-500/20 text-sky-200'
                      : 'border-white/12 bg-white/5 text-slate-400'
                  }`}
                >
                  {save.settings.showHints ? 'Visible' : 'Hidden'}
                </button>
              </div>

              <div>
                <div className="text-sm font-semibold text-white">Difficulty</div>
                <div className="mt-1 text-xs text-slate-400">
                  Adjusts starting speed, lives, and score multiplier
                </div>
                <div className="mt-2.5 grid grid-cols-3 gap-1.5 rounded-xl bg-[#070b15] p-1 border border-white/10">
                  {(['easy', 'normal', 'hard'] as DifficultyId[]).map((diffId) => {
                    const cfg = DIFFICULTIES[diffId];
                    const active = save.settings.difficulty === diffId;
                    return (
                      <button
                        key={diffId}
                        type="button"
                        onClick={() => handleSelectDifficulty(diffId)}
                        className={`rounded-lg py-2 text-xs font-semibold transition-colors cursor-pointer ${
                          active
                            ? 'bg-sky-400 text-slate-950'
                            : 'text-slate-300 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        {cfg.label}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-1.5 text-xs text-sky-300/90">
                  {DIFFICULTIES[save.settings.difficulty].description}
                </div>
              </div>

              <div className="pt-4 border-t border-white/10">
                {!confirmReset ? (
                  <button
                    type="button"
                    onClick={() => setConfirmReset(true)}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-500/35 bg-rose-500/10 py-2.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 transition-colors cursor-pointer"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reset Saved Progress
                  </button>
                ) : (
                  <div className="rounded-xl border border-rose-500/40 bg-rose-950/40 p-3">
                    <p className="text-xs text-rose-200 text-center">
                      Clear lifetime SUI coins, high score, and unlocked Yetis?
                    </p>
                    <div className="mt-2.5 flex gap-2">
                      <button
                        type="button"
                        onClick={handleConfirmReset}
                        className="flex-1 rounded-lg bg-rose-500 py-2 text-xs font-bold text-white hover:bg-rose-400 cursor-pointer"
                      >
                        Confirm Reset
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmReset(false)}
                        className="flex-1 rounded-lg border border-white/15 bg-white/5 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10 cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== 3D PERFECT STUNT REPLAY OVERLAY ==================== */}
      {screen === 'playing' && hud.replayActive && (
        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-between">
          {/* Top Cinema Letterbox Strip */}
          <div className="pointer-events-auto flex items-center justify-between gap-4 border-b border-white/10 bg-[#060a14]/92 px-4 sm:px-6 py-2.5">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 min-w-0">
              <span className="font-[var(--font-display)] text-sm font-extrabold tracking-wide text-amber-300 whitespace-nowrap shrink-0">
                Perfect Stunt Replay
              </span>
              {hud.replayStuntLabel && (
                <>
                  <span aria-hidden="true" className="text-slate-500">·</span>
                  <span className="text-sm font-semibold text-white truncate">
                    {hud.replayStuntLabel}
                  </span>
                </>
              )}
              <span aria-hidden="true" className="text-slate-500 hidden sm:inline">·</span>
              <span className="hidden sm:inline text-xs font-mono text-slate-300 tabular-nums whitespace-nowrap shrink-0">
                Last {hud.replayRecordedSec.toFixed(1)}s{hud.replaySlowMo ? ' · Slow-Mo' : ''}
              </span>
            </div>

            <button
              type="button"
              onClick={() => engineRef.current?.skipReplay()}
              className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/8 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/15 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <FastForward className="h-3.5 w-3.5 text-amber-300" />
              Skip
            </button>
          </div>

          {/* Bottom Cinema Letterbox Strip + Replay Timeline Scrubber */}
          <div className="border-t border-white/10 bg-[#060a14]/92 px-4 sm:px-6 py-2.5">
            <div className="mx-auto max-w-2xl">
              <div className="flex items-center justify-between text-[11px] font-mono text-slate-300 tabular-nums mb-1.5">
                <span>
                  {hud.replaySlowMo ? 'Slow-Motion Angle' : '3D Action Camera'}
                </span>
                <span>
                  {hud.replayProgress > 0.85
                    ? 'Resuming run...'
                    : `${(hud.replayProgress * hud.replayRecordedSec).toFixed(1)}s / ${hud.replayRecordedSec.toFixed(1)}s`}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/12">
                <div
                  className={`h-full origin-left transition-colors ${
                    hud.replaySlowMo ? 'bg-amber-400' : 'bg-sky-400'
                  }`}
                  style={{ transform: `scaleX(${Math.max(0.02, hud.replayProgress)})` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== IN-GAME HUD ==================== */}
      {(screen === 'playing' || screen === 'paused') && !hud.replayActive && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between p-3 sm:p-5">
          {/* Top HUD Row */}
          <div className="flex items-start justify-between gap-3">
            {/* Left: Active Yeti Portrait + Score, Distance & SUI Coins */}
            <div className="flex items-center gap-2.5 rounded-xl border border-white/12 bg-[#0b101d]/88 px-3 py-2">
              <CharacterAvatar
                src={activeRunChar.portraitUrl}
                alt={activeRunChar.name}
                accentHex={activeRunChar.accentHex}
                className="h-10 w-10 hidden sm:block"
              />
              <div className="min-w-[132px]">
                <div className="font-[var(--font-mono)] text-2xl font-bold leading-none text-white tabular-nums">
                  {hud.score.toLocaleString()}
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-slate-300 tabular-nums">
                  <span>{hud.distance.toLocaleString()}m</span>
                  <span aria-hidden="true">·</span>
                  <span className="flex items-center gap-1 text-amber-300 font-semibold">
                    <Coins className="h-3.5 w-3.5" />
                    {hud.runCoins}
                  </span>
                </div>
              </div>
            </div>

            {/* Center: Current Scene & 1500m Zone Progress */}
            <div className="hidden sm:flex flex-col items-center rounded-xl border border-white/12 bg-[#0b101d]/88 px-4 py-2 min-w-[170px]">
              <span className="text-xs font-semibold tracking-wide text-slate-100">
                {hud.sceneName}
              </span>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/12">
                <div
                  className="h-full bg-sky-400 transition-transform duration-150 origin-left"
                  style={{ transform: `scaleX(${Math.max(0.03, hud.sceneProgress)})` }}
                />
              </div>
            </div>

            {/* Right: Lives, Void Shield & Pause */}
            <div className="pointer-events-auto flex items-center gap-2">
              <div
                className="flex items-center gap-1.5 rounded-xl border border-white/12 bg-[#0b101d]/88 px-3 py-2.5"
                aria-label={`${hud.lives} of ${hud.maxLives} lives remaining`}
              >
                {Array.from({ length: hud.maxLives }).map((_, idx) => (
                  <Heart
                    key={idx}
                    className={`h-4 w-4 ${
                      idx < hud.lives
                        ? 'fill-rose-500 text-rose-400'
                        : 'fill-slate-800 text-slate-600'
                    }`}
                  />
                ))}
                {hud.shields > 0 && (
                  <Shield
                    className="h-4 w-4 fill-violet-400/30 text-violet-300 ml-0.5"
                    aria-label="Void Shield active"
                  />
                )}
              </div>

              <button
                type="button"
                onClick={handleToggleMusic}
                aria-label={save.settings.musicEnabled ? 'Mute background beats' : 'Play background beats'}
                title={
                  save.settings.musicEnabled
                    ? `Beat: ${getMusicBeatLabel(save.settings.musicBeat, hud.sceneId)}`
                    : 'Beats Muted'
                }
                className={`flex h-10 w-10 items-center justify-center rounded-xl border transition-colors cursor-pointer ${
                  save.settings.musicEnabled
                    ? 'border-emerald-400/45 bg-[#0b101d]/88 text-emerald-300 hover:bg-emerald-500/15'
                    : 'border-white/12 bg-[#0b101d]/88 text-slate-500 hover:text-slate-300 hover:bg-white/10'
                }`}
              >
                <Music className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={handleTogglePause}
                aria-label={screen === 'paused' ? 'Resume game' : 'Pause game'}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/12 bg-[#0b101d]/88 text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                {screen === 'paused' ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Center-Top Notifications */}
          <div className="flex flex-col items-center gap-2 mt-2">
            {hud.portalDestination && (
              <div className="rounded-xl border border-sky-300/50 bg-[#0b101d]/92 px-4 py-1.5 font-[var(--font-display)] text-xs font-bold tracking-wider uppercase text-sky-200">
                Portal Ahead · {hud.portalDestination}
              </div>
            )}

            {hud.sceneToast && (
              <div className="rounded-xl border border-sky-400/35 bg-[#0b101d]/90 px-5 py-1.5 font-[var(--font-display)] text-base font-bold text-sky-200 tracking-tight">
                {hud.sceneToast}
              </div>
            )}

            {hud.stuntBanner && (
              <div className="rounded-lg border border-amber-400/35 bg-[#0b101d]/90 px-3.5 py-1 text-xs font-bold text-amber-300 tracking-wide">
                {hud.stuntBanner}
              </div>
            )}

            {hud.villainThreat > 0.58 && hud.starRemaining <= 0 && (
              <div className="flex items-center gap-1.5 rounded-lg border border-rose-500/50 bg-[#1a0b14]/92 px-3 py-1 text-[11px] font-bold tracking-wider uppercase text-rose-300">
                <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />
                Hunter Closing In
              </div>
            )}

            <div className="flex flex-wrap items-center justify-center gap-2">
              {hud.swordRemaining > 0 && (
                <div className="flex items-center gap-2 rounded-xl border border-sky-400/40 bg-[#0b101d]/90 px-3 py-1.5">
                  <Sword className="h-4 w-4 text-sky-300" />
                  <div className="w-24">
                    <div className="flex justify-between text-[11px] font-semibold text-sky-200 tabular-nums">
                      <span>Sword</span>
                      <span>{hud.swordRemaining.toFixed(1)}s</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/12">
                      <div
                        className="h-full bg-sky-400 origin-left"
                        style={{
                          transform: `scaleX(${Math.max(0, hud.swordRemaining / hud.swordDuration)})`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {hud.starRemaining > 0 && (
                <div className="flex items-center gap-2 rounded-xl border border-amber-400/40 bg-[#0b101d]/90 px-3 py-1.5">
                  <Sparkles className="h-4 w-4 text-amber-300" />
                  <div className="w-24">
                    <div className="flex justify-between text-[11px] font-semibold text-amber-200 tabular-nums">
                      <span>Star Flight</span>
                      <span>{hud.starRemaining.toFixed(1)}s</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/12">
                      <div
                        className="h-full bg-amber-400 origin-left"
                        style={{
                          transform: `scaleX(${Math.max(0, hud.starRemaining / hud.starDuration)})`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex-1" />

          {/* Bottom Controls Hint Bar & Sword Slash Touch Trigger */}
          <div className="flex items-end justify-between gap-3">
            {save.settings.showHints ? (
              <div
                className={`mx-auto rounded-lg border px-3.5 py-1.5 text-[11px] text-center transition-colors ${
                  hud.starRemaining > 0
                    ? 'border-amber-400/35 bg-[#0b101d]/88 text-amber-200'
                    : 'border-white/10 bg-[#0b101d]/82 text-slate-300'
                }`}
              >
                {hud.starRemaining > 0 ? (
                  <>
                    <span className="hidden sm:inline">
                      A/D Barrel Roll · Space/W Sky Loop · S/↓ Sky Swoop · X Star Corkscrew
                    </span>
                    <span className="sm:hidden">
                      Swipe Barrel Roll / Sky Loop / Swoop · Tap Corkscrew
                    </span>
                  </>
                ) : (
                  <>
                    <span className="hidden sm:inline">
                      A/D or ←/→ Move · Space/W Jump (2x Flip) · S/↓ Slide · X Spin · Z Slash · Esc Pause
                    </span>
                    <span className="sm:hidden">
                      Swipe Move / Jump / Slide · Tap Jump or Air Spin
                    </span>
                  </>
                )}
              </div>
            ) : (
              <div />
            )}

            {hud.swordRemaining > 0 && screen === 'playing' && (
              <button
                type="button"
                onClick={() => engineRef.current?.triggerSlash()}
                className="pointer-events-auto flex items-center gap-1.5 rounded-xl border border-sky-400/60 bg-sky-500/25 px-4 py-2.5 text-xs font-bold text-sky-100 active:scale-95 cursor-pointer"
              >
                <Sword className="h-4 w-4" />
                Slash (Z)
              </button>
            )}
          </div>
        </div>
      )}

      {/* ==================== PAUSE MODAL ==================== */}
      {screen === 'paused' && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#060a14]/75 p-4">
          <div className="w-full max-w-xs rounded-2xl border border-white/14 bg-[#0d1424] p-6 text-center shadow-2xl">
            <h2 className="font-[var(--font-display)] text-2xl font-extrabold text-white">
              Paused
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              {activeRunChar.name} · {hud.sceneName} · {hud.distance.toLocaleString()}m
            </p>
            <div className="mt-5 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={handleTogglePause}
                className="rounded-xl bg-sky-400 py-3 text-sm font-bold text-slate-950 hover:bg-sky-300 cursor-pointer"
              >
                Resume Run
              </button>
              <button
                type="button"
                onClick={handleStartGame}
                className="rounded-xl border border-white/14 bg-white/5 py-3 text-sm font-semibold text-white hover:bg-white/10 cursor-pointer"
              >
                Restart
              </button>
              <button
                type="button"
                onClick={handleGoMenu}
                className="rounded-xl border border-white/10 py-2.5 text-xs font-semibold text-slate-300 hover:bg-white/5 cursor-pointer"
              >
                Main Menu
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== GAME OVER MODAL ==================== */}
      {screen === 'gameover' && lastRun && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#060a14]/78 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-white/14 bg-[#0d1424] p-6 shadow-2xl">
            <div className="text-center">
              {lastRun.isNewBest && (
                <div className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-300 mb-1">
                  <Trophy className="h-3.5 w-3.5" />
                  New High Score
                </div>
              )}
              <h2 className="font-[var(--font-display)] text-3xl font-extrabold text-white">
                Run Complete
              </h2>
              <p className="mt-1 text-xs text-slate-400">
                {activeRunChar.name} · Reached {hud.sceneName}
              </p>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2 rounded-xl border border-white/10 bg-[#080d19] p-3.5 text-center tabular-nums">
              <div>
                <div className="text-[11px] text-slate-400">Score</div>
                <div className="mt-0.5 font-[var(--font-mono)] text-base font-bold text-white">
                  {lastRun.score.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400">Distance</div>
                <div className="mt-0.5 font-[var(--font-mono)] text-base font-bold text-sky-300">
                  {lastRun.distance.toLocaleString()}m
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400">SUI Coins</div>
                <div className="mt-0.5 font-[var(--font-mono)] text-base font-bold text-amber-300">
                  +{lastRun.runCoins}
                </div>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between text-xs text-slate-400 tabular-nums px-1">
              <span>Best Score: {save.highScore.toLocaleString()}</span>
              <span>Store Bank: {save.coinBalance.toLocaleString()} SUI</span>
            </div>

            <div className="mt-5 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={handleStartGame}
                className="flex items-center justify-center gap-2 rounded-xl bg-sky-400 py-3.5 font-[var(--font-display)] text-base font-bold text-slate-950 hover:bg-sky-300 cursor-pointer"
              >
                <Play className="h-4 w-4 fill-current" />
                Play Again
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleOpenStore}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-amber-400/35 bg-amber-500/12 py-2.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/20 cursor-pointer whitespace-nowrap"
                >
                  <ShoppingBag className="h-3.5 w-3.5" />
                  Store
                </button>
                <button
                  type="button"
                  onClick={handleOpenWeb3}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-sky-400/30 bg-sky-500/10 py-2.5 text-xs font-semibold text-sky-200 hover:bg-sky-500/20 cursor-pointer whitespace-nowrap"
                >
                  <Wallet className="h-3.5 w-3.5" />
                  Claim On-Chain
                </button>
              </div>

              <button
                type="button"
                onClick={handleGoMenu}
                className="rounded-xl border border-white/14 bg-white/5 py-3 text-sm font-semibold text-white hover:bg-white/10 cursor-pointer"
              >
                Main Menu
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
