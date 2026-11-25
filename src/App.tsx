import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  Coins,
  Heart,
  Lock,
  Pause,
  Play,
  RotateCcw,
  Settings,
  Shield,
  Sparkles,
  Sword,
  Trophy,
  User,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  CHARACTERS,
  DIFFICULTIES,
  SCENE_NAMES,
  SCENE_ORDER,
  SCENE_SHORT_NAMES,
  STAR_DURATION,
  SWORD_DURATION,
  getCharacterById,
} from './game/config';
import { RunnerEngine } from './game/engine';
import { loadSaveData, resetSaveData, writeSaveData } from './game/storage';
import type {
  CharacterId,
  DifficultyId,
  GameScreen,
  HudSnapshot,
  SaveData,
  SceneId,
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

  const saveRef = useRef(save);
  saveRef.current = save;

  const screenRef = useRef(screen);
  screenRef.current = screen;

  const updateSave = useCallback((updater: (prev: SaveData) => SaveData) => {
    setSave((prev) => {
      const next = updater(prev);
      writeSaveData(next);
      return next;
    });
  }, []);

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
      {
        onHudUpdate: (snapshot) => {
          setHud(snapshot);
        },
        onGameOver: (result) => {
          const prev = saveRef.current;
          const isNewBest = result.score > prev.highScore;
          setLastRun({ ...result, isNewBest });
          setScreen('gameover');
          updateSave((cur) => ({
            ...cur,
            lifetimeCoins: cur.lifetimeCoins + result.runCoins,
            highScore: Math.max(cur.highScore, result.score),
            bestDistance: Math.max(cur.bestDistance, result.distance),
          }));
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

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [updateSave]);

  const handleStartGame = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    setConfirmReset(false);
    engine.setCharacter(saveRef.current.selectedCharacter, false);
    setScreen('playing');
    engine.startRun();
  }, []);

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

  const handleOpenSettings = useCallback(() => {
    const engine = engineRef.current;
    setConfirmReset(false);
    setScreen('settings');
    if (engine) {
      engine.audio.play('uiClick');
      engine.setScreen('settings');
    }
  }, []);

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
      } else if (screen === 'character' || screen === 'settings') {
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
                  <span>{save.lifetimeCoins.toLocaleString()} SUI Coins</span>
                  <span aria-hidden="true">·</span>
                  <span>{DIFFICULTIES[save.settings.difficulty].label}</span>
                </div>
              </div>
            </div>

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
          </header>

          {/* Bottom Unified Action Dock */}
          <footer className="pointer-events-auto mx-auto w-full max-w-xl">
            <div className="rounded-2xl border border-white/12 bg-[#0c1220]/90 p-3 sm:p-4 shadow-2xl">
              <div className="mb-2.5 flex items-center justify-between text-xs text-slate-300 px-1">
                <span>
                  Active Perk: <strong className="text-white">{equippedChar.perkName}</strong>
                </span>
                <span className="text-slate-400 hidden sm:inline truncate max-w-[60%]">
                  {equippedChar.perkDescription}
                </span>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleStartGame}
                  className="flex-1 flex items-center justify-center gap-2.5 rounded-xl bg-sky-400 px-6 py-3.5 font-[var(--font-display)] text-base font-bold text-slate-950 transition-transform active:scale-[0.98] hover:bg-sky-300 cursor-pointer whitespace-nowrap"
                >
                  <Play className="h-5 w-5 fill-current" />
                  Play Run
                </button>

                <button
                  type="button"
                  onClick={handleOpenCharacter}
                  className="flex items-center justify-center gap-2 rounded-xl border border-white/14 bg-white/5 px-5 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-white/10 cursor-pointer whitespace-nowrap"
                >
                  <User className="h-4 w-4 text-sky-300" />
                  Yetis ({CHARACTERS.filter((c) => save.lifetimeCoins >= c.unlockCoins).length}/{CHARACTERS.length})
                </button>

                <button
                  type="button"
                  onClick={handleOpenSettings}
                  className="flex items-center justify-center gap-2 rounded-xl border border-white/14 bg-white/5 px-5 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-white/10 cursor-pointer whitespace-nowrap"
                >
                  <Settings className="h-4 w-4 text-slate-300" />
                  Settings
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

            <div className="rounded-xl border border-white/12 bg-[#0c1220]/90 px-4 py-2 text-sm font-semibold text-amber-300 tabular-nums flex items-center gap-2">
              <Coins className="h-4 w-4" />
              {save.lifetimeCoins.toLocaleString()} SUI Coins
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
                ) : save.lifetimeCoins >= previewChar.unlockCoins ? (
                  <span className="text-emerald-300 font-semibold">Unlocked</span>
                ) : (
                  <span className="text-amber-300 font-semibold">
                    Needs {(previewChar.unlockCoins - save.lifetimeCoins).toLocaleString()} more SUI coins
                  </span>
                )}
              </div>
            </div>

            {/* 5 Character Cards Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {CHARACTERS.map((char) => {
                const unlocked = save.lifetimeCoins >= char.unlockCoins;
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

      {/* ==================== SETTINGS SCREEN ==================== */}
      {screen === 'settings' && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#060a14]/75 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/14 bg-[#0d1424] p-6 shadow-2xl">
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

      {/* ==================== IN-GAME HUD ==================== */}
      {(screen === 'playing' || screen === 'paused') && (
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
              <span>Total Bank: {save.lifetimeCoins.toLocaleString()} SUI</span>
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
