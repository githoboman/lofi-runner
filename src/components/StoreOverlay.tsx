import { useState } from 'react';
import {
  Check,
  ChevronLeft,
  Coins,
  Flame,
  Lock,
  Magnet,
  Rocket,
  Shield,
  Sparkles,
  Sword,
  TrendingUp,
  Zap,
} from 'lucide-react';
import {
  CHARACTERS,
  STORE_BOOSTERS,
  STORE_UPGRADES,
  getUpgradeCost,
} from '../game/config';
import { isCharacterUnlocked } from '../game/storage';
import type { BoosterId, CharacterId, SaveData, UpgradeId } from '../game/types';

type StoreTab = 'upgrades' | 'boosters' | 'yetis';

interface StoreOverlayProps {
  save: SaveData;
  onClose: () => void;
  onBuyUpgrade: (upgradeId: UpgradeId) => void;
  onBuyBooster: (boosterId: BoosterId) => void;
  onToggleBooster: (boosterId: BoosterId) => void;
  onUnlockCharacter: (charId: CharacterId) => void;
  onEquipCharacter: (charId: CharacterId) => void;
}

function UpgradeIcon({ id }: { id: UpgradeId }) {
  switch (id) {
    case 'magnet':
      return <Magnet className="h-5 w-5 text-sky-300" />;
    case 'sword':
      return <Sword className="h-5 w-5 text-orange-300" />;
    case 'star':
      return <Sparkles className="h-5 w-5 text-amber-300" />;
    case 'shield':
      return <Shield className="h-5 w-5 text-violet-300" />;
    case 'yield':
      return <TrendingUp className="h-5 w-5 text-emerald-300" />;
  }
}

function BoosterIcon({ id }: { id: BoosterId }) {
  switch (id) {
    case 'headstart':
      return <Rocket className="h-5 w-5 text-amber-300" />;
    case 'starter_sword':
      return <Flame className="h-5 w-5 text-orange-300" />;
    case 'extra_shield':
      return <Shield className="h-5 w-5 text-violet-300" />;
    case 'double_coins':
      return <Zap className="h-5 w-5 text-emerald-300" />;
  }
}

export function StoreOverlay({
  save,
  onClose,
  onBuyUpgrade,
  onBuyBooster,
  onToggleBooster,
  onUnlockCharacter,
  onEquipCharacter,
}: StoreOverlayProps) {
  const [tab, setTab] = useState<StoreTab>('upgrades');

  const armedCount = save.equippedBoosters.length;

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#060a14]/82 p-2.5 sm:p-6">
      <div className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/14 bg-[#0d1424] shadow-2xl">
        {/* Top Header */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-white/10 px-3.5 py-3 sm:px-6 sm:py-3.5">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <button
              type="button"
              onClick={onClose}
              className="flex items-center gap-1 rounded-lg border border-white/14 bg-white/5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10 transition-colors cursor-pointer whitespace-nowrap shrink-0 touch-manipulation min-h-[36px]"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Back
            </button>
            <div className="min-w-0">
              <h2 className="font-[var(--font-display)] text-base sm:text-xl font-extrabold text-white leading-tight truncate">
                Yeti Runner Store
              </h2>
              <p className="hidden sm:block text-[11px] text-slate-400">
                Spend SUI Coins on permanent upgrades, single-run boosters, and Yetis
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-1.5 sm:px-3.5 sm:py-2 text-xs sm:text-sm font-bold text-amber-300 tabular-nums shrink-0">
            <Coins className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            <span>{save.coinBalance.toLocaleString()}</span>
            <span className="hidden sm:inline">SUI Coins</span>
          </div>
        </div>

        {/* Navigation Tabs (horizontally scrollable on narrow phones) */}
        <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-[#090e1a] px-3.5 py-2 sm:px-6 sm:py-2.5">
          <div className="flex items-center gap-1.5 overflow-x-auto touch-pan-x no-scrollbar">
            {(
              [
                { id: 'upgrades', label: 'Upgrades' },
                {
                  id: 'boosters',
                  label: armedCount > 0 ? `Boosters (${armedCount})` : 'Boosters',
                },
                { id: 'yetis', label: 'Yeti Unlocks' },
              ] as { id: StoreTab; label: string }[]
            ).map((item) => {
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`rounded-lg px-3 sm:px-3.5 py-2 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 touch-manipulation ${
                    active
                      ? 'bg-sky-400 text-slate-950 font-bold'
                      : 'text-slate-300 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          <span className="hidden sm:inline text-[11px] text-slate-400 tabular-nums shrink-0">
            Lifetime Earned: {save.lifetimeCoins.toLocaleString()} SUI
          </span>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto overscroll-contain touch-pan-y p-3.5 sm:p-6">
          {tab === 'upgrades' && (
            <div className="space-y-3">
              {STORE_UPGRADES.map((upg) => {
                const level = save.upgrades[upg.id] ?? 0;
                const isMax = level >= upg.maxLevel;
                const cost = getUpgradeCost(upg, level);
                const canAfford = save.coinBalance >= cost;

                return (
                  <div
                    key={upg.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#111a2e] p-3.5 sm:p-4"
                  >
                    <div className="flex items-start gap-3.5">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-[#090e1a]">
                        <UpgradeIcon id={upg.id} />
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-[var(--font-display)] text-sm font-bold text-white">
                            {upg.name}
                          </h3>
                          <span className="text-xs font-semibold text-sky-300 tabular-nums">
                            Lv {level}/{upg.maxLevel}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-300">{upg.description}</p>
                        <div className="mt-2 flex items-center gap-2">
                          <div className="flex items-center gap-1">
                            {Array.from({ length: upg.maxLevel }).map((_, idx) => (
                              <span
                                key={idx}
                                className={`h-1.5 w-6 rounded-sm ${
                                  idx < level ? 'bg-sky-400' : 'bg-white/12'
                                }`}
                              />
                            ))}
                          </div>
                          <span className="text-[11px] text-slate-400">{upg.statLabel}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex sm:flex-col items-center sm:items-end justify-end shrink-0">
                      {isMax ? (
                        <div className="flex items-center gap-1.5 rounded-lg border border-emerald-400/30 bg-emerald-500/12 px-3.5 py-2 text-xs font-bold text-emerald-300 whitespace-nowrap">
                          <Check className="h-3.5 w-3.5" />
                          Max Level
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={!canAfford}
                          onClick={() => onBuyUpgrade(upg.id)}
                          className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-bold transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                            canAfford
                              ? 'bg-sky-400 text-slate-950 hover:bg-sky-300 cursor-pointer'
                              : 'border border-white/10 bg-white/5 text-slate-500 cursor-not-allowed'
                          }`}
                        >
                          <Coins className="h-3.5 w-3.5" />
                          Upgrade · {cost}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'boosters' && (
            <div className="space-y-3">
              <div className="rounded-xl border border-sky-400/20 bg-sky-500/8 px-3.5 py-2.5 text-xs text-sky-200">
                Arm any owned boosters below to activate them automatically when you press Play Run.
                One charge per armed booster is consumed at run start.
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {STORE_BOOSTERS.map((booster) => {
                  const owned = save.boosters[booster.id] ?? 0;
                  const armed = save.equippedBoosters.includes(booster.id);
                  const canBuy = owned < booster.maxStack && save.coinBalance >= booster.cost;

                  return (
                    <div
                      key={booster.id}
                      className={`flex flex-col justify-between rounded-xl border p-4 transition-colors ${
                        armed
                          ? 'border-sky-400/60 bg-sky-500/12'
                          : 'border-white/10 bg-[#111a2e]'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-[#090e1a]">
                          <BoosterIcon id={booster.id} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="font-[var(--font-display)] text-sm font-bold text-white truncate">
                              {booster.name}
                            </h3>
                            <span className="text-xs font-semibold text-slate-300 tabular-nums shrink-0">
                              Owned {owned}/{booster.maxStack}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-slate-300 leading-relaxed">
                            {booster.description}
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 flex items-center gap-2">
                        <button
                          type="button"
                          disabled={!canBuy}
                          onClick={() => onBuyBooster(booster.id)}
                          className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition-colors whitespace-nowrap tabular-nums ${
                            canBuy
                              ? 'bg-amber-400 text-slate-950 hover:bg-amber-300 cursor-pointer'
                              : 'border border-white/10 bg-white/5 text-slate-500 cursor-not-allowed'
                          }`}
                        >
                          <Coins className="h-3.5 w-3.5" />
                          {owned >= booster.maxStack ? 'Stack Full' : `Buy · ${booster.cost}`}
                        </button>

                        <button
                          type="button"
                          disabled={owned === 0}
                          onClick={() => onToggleBooster(booster.id)}
                          className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                            owned === 0
                              ? 'border-white/8 bg-white/[0.03] text-slate-500 cursor-not-allowed'
                              : armed
                                ? 'border-sky-400 bg-sky-400 text-slate-950 font-bold cursor-pointer'
                                : 'border-white/15 bg-white/5 text-white hover:bg-white/10 cursor-pointer'
                          }`}
                        >
                          {armed ? (
                            <>
                              <Check className="h-3.5 w-3.5" />
                              Armed
                            </>
                          ) : (
                            'Equip Next Run'
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {tab === 'yetis' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {CHARACTERS.map((char) => {
                const unlocked = isCharacterUnlocked(save, char.id);
                const equipped = save.selectedCharacter === char.id;
                const canAfford = save.coinBalance >= char.unlockCoins;

                return (
                  <div
                    key={char.id}
                    className={`flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 rounded-xl border p-3.5 ${
                      equipped
                        ? 'border-sky-400/60 bg-sky-500/10'
                        : 'border-white/10 bg-[#111a2e]'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <img
                        src={char.portraitUrl}
                        alt={char.name}
                        referrerPolicy="no-referrer"
                        className="h-12 w-12 sm:h-14 sm:w-14 rounded-xl object-contain bg-[#090e1a] p-1 border border-white/12 shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="font-[var(--font-display)] text-sm font-bold text-white truncate">
                          {char.name}
                        </div>
                        <div className="text-[11px] font-semibold" style={{ color: char.accentHex }}>
                          {char.perkName}
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-400 line-clamp-2">
                          {char.perkDescription}
                        </div>
                      </div>
                    </div>

                    <div className="w-full sm:w-auto flex justify-end shrink-0">
                      {equipped ? (
                        <span className="inline-flex items-center gap-1 rounded-lg border border-sky-400/40 bg-sky-500/15 px-3 py-2 text-xs font-bold text-sky-200 whitespace-nowrap">
                          <Check className="h-3.5 w-3.5" />
                          Equipped
                        </span>
                      ) : unlocked ? (
                        <button
                          type="button"
                          onClick={() => onEquipCharacter(char.id)}
                          className="rounded-lg border border-white/15 bg-white/8 px-3.5 py-2 text-xs font-semibold text-white hover:bg-white/15 cursor-pointer whitespace-nowrap"
                        >
                          Equip
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={!canAfford}
                          onClick={() => onUnlockCharacter(char.id)}
                          className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold whitespace-nowrap tabular-nums ${
                            canAfford
                              ? 'bg-sky-400 text-slate-950 hover:bg-sky-300 cursor-pointer'
                              : 'border border-white/10 bg-white/5 text-slate-500 cursor-not-allowed'
                          }`}
                        >
                          <Lock className="h-3 w-3" />
                          Unlock · {char.unlockCoins}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
