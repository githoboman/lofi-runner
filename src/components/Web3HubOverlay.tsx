import { useEffect, useState, type FormEvent } from 'react';
import {
  Check,
  ChevronLeft,
  Cloud,
  Coins,
  Copy,
  Crown,
  Edit3,
  ExternalLink,
  LogOut,
  RefreshCw,
  Sparkles,
  Trophy,
  User as UserIcon,
} from 'lucide-react';
import {
  LOFI_MOVE_PACKAGE_ID,
  fetchSuiNetworkHealth,
  formatSuiIdentifier,
  getExplorerAddressUrl,
  getExplorerTxUrl,
  getMoveCallSnippet,
  isSuiAddress,
  isValidSuiIdentifier,
  normalizeSuiIdentifier,
  type SuiNetworkHealth,
} from '../blockchain/walletService';
import { isInEmbeddedIframe, type GoogleAccountProfile } from '../firebase';
import { CHARACTERS, getCharacterById } from '../game/config';
import { isCharacterUnlocked } from '../game/storage';
import type {
  CharacterId,
  DailyLeaderboardEntry,
  SaveData,
  SuiNetworkId,
} from '../game/types';

export type PendingSuiAction =
  | { type: 'claim_coins' }
  | { type: 'submit_score' }
  | { type: 'mint_yeti'; charId: CharacterId }
  | { type: 'edit_only' };

interface Web3HubOverlayProps {
  save: SaveData;
  account: GoogleAccountProfile | null;
  authReady: boolean;
  suiBalanceFormatted: string | null;
  busyAction: string | null;
  statusMessage: string | null;
  dailyRuns: DailyLeaderboardEntry[];
  dailyRunsLoading: boolean;
  dailyRunsError: string | null;
  onRefreshDailyRuns: () => void;
  onClose: () => void;
  onSignInGoogle: () => void;
  onSignInGoogleRedirect: () => void;
  onSignOutGoogle: () => void;
  onSwitchNetwork: (network: SuiNetworkId) => void;
  onSaveSuiIdentifier: (identifier: string) => Promise<void>;
  onRefreshBalance: () => void;
  onClaimCoins: (overrideIdentifier?: string) => void;
  onSubmitScore: (overrideIdentifier?: string) => void;
  onMintYetiNft: (charId: CharacterId, overrideIdentifier?: string) => void;
}

function formatRelativeAge(timestampMs: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ago`;
}

function RunnerAvatar({
  photoURL,
  displayName,
  accentHex,
}: {
  photoURL: string;
  displayName: string;
  accentHex: string;
}) {
  const [failed, setFailed] = useState(false);

  if (photoURL && !failed) {
    return (
      <img
        src={photoURL}
        alt={displayName}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="h-8 w-8 shrink-0 rounded-lg border border-white/15 object-cover"
      />
    );
  }

  return (
    <div
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/15 font-[var(--font-display)] text-[11px] font-extrabold text-slate-950"
      style={{ backgroundColor: accentHex }}
    >
      {displayName.slice(0, 2).toUpperCase()}
    </div>
  );
}

function GoogleLogo({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"
      />
    </svg>
  );
}

export function Web3HubOverlay({
  save,
  account,
  authReady,
  suiBalanceFormatted,
  busyAction,
  statusMessage,
  dailyRuns,
  dailyRunsLoading,
  dailyRunsError,
  onRefreshDailyRuns,
  onClose,
  onSignInGoogle,
  onSignInGoogleRedirect,
  onSignOutGoogle,
  onSwitchNetwork,
  onSaveSuiIdentifier,
  onRefreshBalance,
  onClaimCoins,
  onSubmitScore,
  onMintYetiNft,
}: Web3HubOverlayProps) {
  const [health, setHealth] = useState<SuiNetworkHealth | null>(null);
  const [copied, setCopied] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);

  // On-demand Sui wallet address / .sui name prompt (only shown when needed or editing!)
  const [pendingAction, setPendingAction] = useState<PendingSuiAction | null>(null);
  const [suiInput, setSuiInput] = useState(save.blockchain.suiIdentifier || '');
  const [inputError, setInputError] = useState<string | null>(null);

  const network = save.blockchain.network;
  const savedSuiId = save.blockchain.suiIdentifier.trim();
  const claimableCoins = Math.max(0, save.lifetimeCoins - save.blockchain.claimedCoins);
  const canSubmitScore =
    save.highScore > 0 && save.highScore > save.blockchain.onChainBestScore;

  useEffect(() => {
    setAvatarFailed(false);
  }, [account?.photoURL]);

  useEffect(() => {
    let active = true;
    setHealth(null);
    fetchSuiNetworkHealth(network).then((res) => {
      if (active) setHealth(res);
    });
    return () => {
      active = false;
    };
  }, [network]);

  const handleCopyIdentifier = () => {
    if (!savedSuiId) return;
    navigator.clipboard?.writeText(savedSuiId).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const openSuiPrompt = (action: PendingSuiAction) => {
    setSuiInput(savedSuiId);
    setInputError(null);
    setPendingAction(action);
  };

  const requestSuiAction = (action: PendingSuiAction) => {
    if (!account) {
      onSignInGoogle();
      return;
    }
    if (!savedSuiId) {
      openSuiPrompt(action);
      return;
    }
    if (action.type === 'claim_coins') onClaimCoins();
    else if (action.type === 'submit_score') onSubmitScore();
    else if (action.type === 'mint_yeti') onMintYetiNft(action.charId);
  };

  const handlePromptSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const normalized = normalizeSuiIdentifier(suiInput);
    if (!isValidSuiIdentifier(normalized)) {
      setInputError('Enter a valid Sui address (0x... 66 chars) or a .sui name like yeti.sui');
      return;
    }
    setInputError(null);
    const nextAction = pendingAction;
    setPendingAction(null);
    await onSaveSuiIdentifier(normalized);

    if (nextAction?.type === 'claim_coins') onClaimCoins(normalized);
    else if (nextAction?.type === 'submit_score') onSubmitScore(normalized);
    else if (nextAction?.type === 'mint_yeti') onMintYetiNft(nextAction.charId, normalized);
  };

  const promptActionLabel =
    pendingAction?.type === 'claim_coins'
      ? `Save & Claim ${claimableCoins.toLocaleString()} Coins`
      : pendingAction?.type === 'submit_score'
        ? 'Save & Submit High Score'
        : pendingAction?.type === 'mint_yeti'
          ? 'Save & Mint Yeti NFT'
          : 'Save Sui Address / Name';

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#060a14]/84 p-3 sm:p-6">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/14 bg-[#0d1424] shadow-2xl">
        {/* Top Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex items-center gap-1 rounded-lg border border-white/14 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Back
            </button>
            <div>
              <h2 className="font-[var(--font-display)] text-lg sm:text-xl font-extrabold text-white leading-tight">
                Account &amp; Sui Rewards
              </h2>
              <p className="text-[11px] text-slate-400">
                Sign in with Google to sync progress across desktop &amp; mobile. No wallet needed to play.
              </p>
            </div>
          </div>

          {/* Network Switcher */}
          <div className="flex items-center gap-1 rounded-xl border border-white/12 bg-[#080d19] p-1 shrink-0">
            {(['testnet', 'mainnet'] as SuiNetworkId[]).map((net) => {
              const active = network === net;
              return (
                <button
                  key={net}
                  type="button"
                  onClick={() => onSwitchNetwork(net)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition-colors cursor-pointer whitespace-nowrap ${
                    active
                      ? 'bg-sky-400 text-slate-950 font-bold'
                      : 'text-slate-300 hover:text-white hover:bg-white/5'
                  }`}
                >
                  Sui {net}
                </button>
              );
            })}
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {/* Google Account Card */}
          <section className="rounded-xl border border-white/12 bg-[#111a2e] p-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {account && account.photoURL && !avatarFailed ? (
                  <img
                    src={account.photoURL}
                    alt={account.displayName}
                    referrerPolicy="no-referrer"
                    onError={() => setAvatarFailed(true)}
                    className="h-11 w-11 shrink-0 rounded-xl border border-sky-400/35 object-cover"
                  />
                ) : (
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-sky-400/30 bg-sky-500/12">
                    <UserIcon className="h-5 w-5 text-sky-300" />
                  </div>
                )}

                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-[var(--font-display)] text-sm font-bold text-white truncate">
                      {account ? account.displayName : 'Sign in with Google'}
                    </h3>
                    {account && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-300">
                        <Cloud className="h-3 w-3" />
                        Cloud Synced
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-400 tabular-nums">
                    <span className="truncate max-w-[240px]">
                      {account
                        ? account.email || 'Google Account connected'
                        : 'Save high scores, Yetis & coins across desktop and mobile'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {health === null
                        ? 'Checking Sui RPC...'
                        : health.reachable && health.checkpoint
                          ? `Sui #${Number(health.checkpoint).toLocaleString()}`
                          : 'Sui RPC offline'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {!account ? (
                  <button
                    type="button"
                    disabled={!authReady || busyAction !== null}
                    onClick={onSignInGoogle}
                    className="flex items-center justify-center gap-2.5 rounded-xl bg-white px-4 py-2.5 text-xs font-bold text-slate-900 hover:bg-slate-100 active:scale-[0.98] transition-all cursor-pointer whitespace-nowrap min-h-[42px] touch-manipulation"
                  >
                    <GoogleLogo className="h-4 w-4" />
                    {busyAction === 'google_auth' ? 'Signing in...' : 'Sign in with Google'}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={onSignOutGoogle}
                    className="flex items-center gap-1.5 rounded-lg border border-white/14 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10 cursor-pointer whitespace-nowrap"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    Sign Out
                  </button>
                )}
              </div>
            </div>

            {/* Optional Sui Address / .sui Name Bar (shown quietly when signed in) */}
            {account && (
              <div className="mt-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-t border-white/10 pt-3.5">
                <div className="text-xs text-slate-300">
                  <span className="text-slate-400">Reward Destination: </span>
                  {savedSuiId ? (
                    <span className="font-[var(--font-mono)] font-semibold text-sky-300">
                      {formatSuiIdentifier(savedSuiId)}
                    </span>
                  ) : (
                    <span className="text-slate-400">
                      Optional — we only ask for your Sui address or .sui name when claiming or minting
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {savedSuiId && (
                    <>
                      <button
                        type="button"
                        onClick={handleCopyIdentifier}
                        className="flex items-center gap-1 rounded-lg border border-white/12 bg-[#080d19] px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 hover:bg-white/5 cursor-pointer whitespace-nowrap"
                      >
                        {copied ? (
                          <Check className="h-3 w-3 text-emerald-400" />
                        ) : (
                          <Copy className="h-3 w-3 text-slate-400" />
                        )}
                        {copied ? 'Copied' : 'Copy'}
                      </button>

                      {isSuiAddress(savedSuiId) && (
                        <a
                          href={getExplorerAddressUrl(network, savedSuiId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 rounded-lg border border-white/12 bg-white/5 px-2.5 py-1.5 text-[11px] font-semibold text-sky-300 hover:bg-white/10 whitespace-nowrap"
                        >
                          SuiScan
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}

                      {suiBalanceFormatted && (
                        <button
                          type="button"
                          onClick={onRefreshBalance}
                          title="Refresh Sui balance"
                          className="flex items-center gap-1 rounded-lg border border-white/12 bg-white/5 px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 hover:bg-white/10 cursor-pointer whitespace-nowrap tabular-nums"
                        >
                          <RefreshCw className="h-3 w-3" />
                          {suiBalanceFormatted}
                        </button>
                      )}
                    </>
                  )}

                  <button
                    type="button"
                    onClick={() => openSuiPrompt({ type: 'edit_only' })}
                    className="flex items-center gap-1 rounded-lg border border-sky-400/35 bg-sky-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-sky-200 hover:bg-sky-500/20 cursor-pointer whitespace-nowrap"
                  >
                    <Edit3 className="h-3 w-3" />
                    {savedSuiId ? 'Change Sui Address' : 'Add Sui Address / .sui'}
                  </button>
                </div>
              </div>
            )}

            {/* On-Demand Sui Wallet Address or .sui Name Input Form */}
            {pendingAction && (
              <form
                onSubmit={handlePromptSubmit}
                className="mt-3.5 rounded-xl border border-sky-400/40 bg-[#080d19] p-3.5 space-y-2.5"
              >
                <div>
                  <div className="text-xs font-bold text-white">
                    Where should we send your Sui rewards?
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    Paste your Sui wallet address (<span className="font-[var(--font-mono)]">0x...</span>) or enter your <span className="font-[var(--font-mono)]">.sui</span> SuiNS name — no wallet extension connection needed.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={suiInput}
                    onChange={(e) => {
                      setSuiInput(e.target.value);
                      setInputError(null);
                    }}
                    placeholder="yeti.sui or 0x..."
                    autoComplete="off"
                    spellCheck={false}
                    className="flex-1 rounded-lg border border-white/15 bg-[#0f172a] px-3 py-2.5 font-[var(--font-mono)] text-xs text-white placeholder:text-slate-500 focus:border-sky-400 focus:outline-none"
                  />
                  <div className="flex gap-2 shrink-0">
                    <button
                      type="submit"
                      className="rounded-lg bg-sky-400 px-4 py-2.5 text-xs font-bold text-slate-950 hover:bg-sky-300 cursor-pointer whitespace-nowrap"
                    >
                      {promptActionLabel}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPendingAction(null);
                        setInputError(null);
                      }}
                      className="rounded-lg border border-white/14 bg-white/5 px-3 py-2.5 text-xs font-semibold text-slate-300 hover:bg-white/10 cursor-pointer whitespace-nowrap"
                    >
                      Cancel
                    </button>
                  </div>
                </div>

                {inputError && <p className="text-[11px] font-medium text-rose-300">{inputError}</p>}
              </form>
            )}

            {statusMessage && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-400/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-200">
                <span>{statusMessage}</span>
                {!account && !isInEmbeddedIframe() && (
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={onSignInGoogleRedirect}
                    className="rounded-md bg-sky-400 px-2.5 py-1 text-[11px] font-bold text-slate-950 hover:bg-sky-300 cursor-pointer whitespace-nowrap touch-manipulation shrink-0"
                  >
                    Use Full-Page Sign-In
                  </button>
                )}
              </div>
            )}
          </section>

          {/* Community Daily Top Run Leaderboard (Rolling 24-Hour Window) */}
          <section className="rounded-xl border border-white/12 bg-[#111a2e] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/10">
              <div className="flex items-center gap-2.5">
                <Crown className="h-4 w-4 text-amber-300 shrink-0" />
                <div>
                  <h3 className="font-[var(--font-display)] text-sm font-bold text-white leading-tight">
                    Daily Top Run
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Top 10 community scores · Rolling 24-hour window
                  </p>
                </div>
              </div>

              <button
                type="button"
                disabled={dailyRunsLoading}
                onClick={onRefreshDailyRuns}
                className="flex items-center gap-1.5 rounded-lg border border-white/12 bg-[#080d19] px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 hover:bg-white/5 disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <RefreshCw className={`h-3 w-3 ${dailyRunsLoading ? 'animate-spin' : ''}`} />
                {dailyRunsLoading ? 'Updating...' : 'Refresh'}
              </button>
            </div>

            {dailyRunsError ? (
              <div className="mt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 rounded-lg border border-rose-400/25 bg-rose-500/10 px-3.5 py-3 text-xs text-rose-200">
                <span>{dailyRunsError}</span>
                <button
                  type="button"
                  onClick={onRefreshDailyRuns}
                  className="rounded-lg border border-rose-300/35 bg-rose-400/15 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-rose-400/25 cursor-pointer whitespace-nowrap shrink-0"
                >
                  Try Again
                </button>
              </div>
            ) : dailyRunsLoading && dailyRuns.length === 0 ? (
              <div className="mt-3 space-y-2">
                {[0, 1, 2].map((idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between rounded-lg border border-white/8 bg-[#080d19] px-3 py-2.5"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-4 w-6 rounded bg-white/10" />
                      <div className="h-8 w-8 rounded-lg bg-white/10" />
                      <div className="space-y-1.5">
                        <div className="h-3 w-28 rounded bg-white/10" />
                        <div className="h-2.5 w-20 rounded bg-white/8" />
                      </div>
                    </div>
                    <div className="h-4 w-16 rounded bg-white/10" />
                  </div>
                ))}
              </div>
            ) : dailyRuns.length === 0 ? (
              <div className="mt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-white/8 bg-[#080d19] px-4 py-4">
                <div>
                  <div className="text-xs font-semibold text-white">
                    No runs posted in the last 24 hours yet
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {account
                      ? 'Complete a run to claim #1 on today’s community leaderboard.'
                      : 'Sign in with Google and complete a run to claim #1 on today’s board.'}
                  </p>
                </div>
                {!account && (
                  <button
                    type="button"
                    disabled={!authReady || busyAction !== null}
                    onClick={onSignInGoogle}
                    className="flex items-center justify-center gap-2 rounded-lg bg-white px-3.5 py-2 text-xs font-bold text-slate-900 hover:bg-slate-100 cursor-pointer whitespace-nowrap shrink-0 touch-manipulation"
                  >
                    <GoogleLogo className="h-3.5 w-3.5" />
                    Sign in to Compete
                  </button>
                )}
              </div>
            ) : (
              <div className="mt-3 space-y-1.5">
                {dailyRuns.slice(0, 10).map((entry, idx) => {
                  const rank = idx + 1;
                  const isMe = account?.uid === entry.uid;
                  const charCfg = getCharacterById(entry.characterId);
                  const rankColor =
                    rank === 1
                      ? 'text-amber-300'
                      : rank === 2
                        ? 'text-slate-200'
                        : rank === 3
                          ? 'text-orange-300'
                          : 'text-slate-400';

                  return (
                    <div
                      key={entry.id}
                      className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 transition-colors ${
                        isMe
                          ? 'border-sky-400/45 bg-sky-500/10'
                          : rank === 1
                            ? 'border-amber-400/30 bg-amber-500/[0.06]'
                            : 'border-white/8 bg-[#080d19]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                        <span
                          className={`w-6 text-center font-[var(--font-mono)] text-xs font-extrabold tabular-nums shrink-0 ${rankColor}`}
                        >
                          #{rank}
                        </span>

                        <RunnerAvatar
                          photoURL={entry.photoURL}
                          displayName={entry.displayName}
                          accentHex={charCfg.accentHex}
                        />

                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-xs font-bold text-white truncate">
                              {entry.displayName}
                            </span>
                            {isMe && (
                              <span className="text-[10px] font-bold uppercase tracking-wider text-sky-300 shrink-0">
                                You
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                            <span className="font-semibold" style={{ color: charCfg.accentHex }}>
                              {charCfg.name}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="capitalize">{entry.difficulty}</span>
                            <span aria-hidden="true">·</span>
                            <span>{formatRelativeAge(entry.createdAtMs)}</span>
                          </div>
                        </div>
                      </div>

                      <div className="text-right font-[var(--font-mono)] tabular-nums shrink-0">
                        <div className="text-xs sm:text-sm font-extrabold text-white">
                          {entry.score.toLocaleString()}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {entry.distance.toLocaleString()}m
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {!account && dailyRuns.length > 0 && (
              <p className="mt-2.5 text-[11px] text-slate-400">
                Sign in with Google to automatically post your completed runs to the 24-hour leaderboard.
              </p>
            )}
          </section>

          {/* Reward Claim + Leaderboard Proof Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <section className="flex flex-col justify-between rounded-xl border border-white/12 bg-[#111a2e] p-4">
              <div>
                <div className="flex items-center gap-2 text-amber-300">
                  <Coins className="h-4 w-4" />
                  <h3 className="font-[var(--font-display)] text-sm font-bold text-white">
                    Claim Run Rewards
                  </h3>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  Record your earned SUI Runner Coins to your Google account and Sui address or .sui name.
                </p>

                <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-white/8 bg-[#080d19] p-3 tabular-nums">
                  <div>
                    <div className="text-[11px] text-slate-400">Claimable Now</div>
                    <div className="mt-0.5 font-[var(--font-mono)] text-base font-bold text-amber-300">
                      {claimableCoins.toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-400">Claimed Total</div>
                    <div className="mt-0.5 font-[var(--font-mono)] text-base font-bold text-white">
                      {save.blockchain.claimedCoins.toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>

              <button
                type="button"
                disabled={(account !== null && claimableCoins <= 0) || busyAction !== null}
                onClick={() => requestSuiAction({ type: 'claim_coins' })}
                className={`mt-3.5 w-full rounded-xl py-2.5 text-xs font-bold transition-colors whitespace-nowrap ${
                  (!account || claimableCoins > 0) && busyAction === null
                    ? 'bg-amber-400 text-slate-950 hover:bg-amber-300 cursor-pointer'
                    : 'border border-white/10 bg-white/5 text-slate-500 cursor-not-allowed'
                }`}
              >
                {busyAction === 'claim_coins'
                  ? 'Recording Claim...'
                  : !account
                    ? 'Sign in with Google to Claim'
                    : claimableCoins <= 0
                      ? 'All Earned Coins Claimed'
                      : `Claim ${claimableCoins.toLocaleString()} Coins`}
              </button>
            </section>

            <section className="flex flex-col justify-between rounded-xl border border-white/12 bg-[#111a2e] p-4">
              <div>
                <div className="flex items-center gap-2 text-sky-300">
                  <Trophy className="h-4 w-4" />
                  <h3 className="font-[var(--font-display)] text-sm font-bold text-white">
                    Verified High Score
                  </h3>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  Submit your best run score and distance to your Sui leaderboard record.
                </p>

                <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-white/8 bg-[#080d19] p-3 tabular-nums">
                  <div>
                    <div className="text-[11px] text-slate-400">Best Score</div>
                    <div className="mt-0.5 font-[var(--font-mono)] text-base font-bold text-sky-300">
                      {save.highScore.toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-400">Verified On-Chain</div>
                    <div className="mt-0.5 font-[var(--font-mono)] text-base font-bold text-white">
                      {save.blockchain.onChainBestScore.toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>

              <button
                type="button"
                disabled={(account !== null && !canSubmitScore) || busyAction !== null}
                onClick={() => requestSuiAction({ type: 'submit_score' })}
                className={`mt-3.5 w-full rounded-xl py-2.5 text-xs font-bold transition-colors whitespace-nowrap ${
                  (!account || canSubmitScore) && busyAction === null
                    ? 'bg-sky-400 text-slate-950 hover:bg-sky-300 cursor-pointer'
                    : 'border border-white/10 bg-white/5 text-slate-500 cursor-not-allowed'
                }`}
              >
                {busyAction === 'submit_score'
                  ? 'Submitting Score...'
                  : !account
                    ? 'Sign in with Google to Submit'
                    : !canSubmitScore
                      ? save.highScore === 0
                        ? 'Complete a Run First'
                        : 'High Score Already Verified'
                      : `Submit ${save.highScore.toLocaleString()} Score`}
              </button>
            </section>
          </div>

          {/* Mint Unlocked Yetis as Sui NFTs */}
          <section className="rounded-xl border border-white/12 bg-[#111a2e] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-violet-300" />
                <h3 className="font-[var(--font-display)] text-sm font-bold text-white">
                  Lofi Mystic Yeti Collectibles (Sui Move)
                </h3>
              </div>
              <span className="text-[11px] text-slate-400 tabular-nums">
                {Object.keys(save.blockchain.mintedNfts).length}/{CHARACTERS.length} Minted
              </span>
            </div>

            <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-2.5">
              {CHARACTERS.map((char) => {
                const unlocked = isCharacterUnlocked(save, char.id);
                const minted = save.blockchain.mintedNfts[char.id];
                const isMinting = busyAction === `mint_${char.id}`;

                return (
                  <div
                    key={char.id}
                    className={`flex flex-col items-center rounded-xl border p-3 text-center ${
                      minted
                        ? 'border-emerald-400/40 bg-emerald-500/8'
                        : 'border-white/10 bg-[#0b1120]'
                    }`}
                  >
                    <img
                      src={char.portraitUrl}
                      alt={char.name}
                      referrerPolicy="no-referrer"
                      className={`h-14 w-14 rounded-xl object-contain bg-[#070b15] p-1 border border-white/10 ${
                        !unlocked ? 'opacity-50' : ''
                      }`}
                    />
                    <div className="mt-2 font-[var(--font-display)] text-xs font-bold text-white truncate max-w-full">
                      {char.name}
                    </div>
                    <div className="mt-0.5 text-[10px] text-slate-400 truncate max-w-full">
                      {char.tier}
                    </div>

                    <div className="mt-2.5 w-full">
                      {minted ? (
                        <a
                          href={getExplorerTxUrl(minted.network, minted.digest)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex w-full items-center justify-center gap-1 rounded-lg border border-emerald-400/35 bg-emerald-500/15 py-1.5 text-[11px] font-bold text-emerald-300 hover:bg-emerald-500/25 whitespace-nowrap"
                        >
                          <Check className="h-3 w-3" />
                          Minted
                        </a>
                      ) : unlocked ? (
                        <button
                          type="button"
                          disabled={busyAction !== null}
                          onClick={() => requestSuiAction({ type: 'mint_yeti', charId: char.id })}
                          className={`w-full rounded-lg py-1.5 text-[11px] font-bold whitespace-nowrap ${
                            busyAction === null
                              ? 'bg-sky-400 text-slate-950 hover:bg-sky-300 cursor-pointer'
                              : 'border border-white/10 bg-white/5 text-slate-500 cursor-not-allowed'
                          }`}
                        >
                          {isMinting ? 'Minting...' : account ? 'Mint NFT' : 'Sign in'}
                        </button>
                      ) : (
                        <span className="block rounded-lg border border-white/8 bg-white/[0.03] py-1.5 text-[11px] text-slate-500 tabular-nums">
                          Unlock at {char.unlockCoins}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Move Contract Info & Recent Transaction Receipts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <section className="rounded-xl border border-white/12 bg-[#111a2e] p-4">
              <h3 className="font-[var(--font-display)] text-xs font-bold uppercase tracking-wider text-slate-300">
                Move Contract Architecture
              </h3>
              <div className="mt-2.5 space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2 rounded-lg bg-[#080d19] px-3 py-2 border border-white/8">
                  <span className="text-slate-400">Module</span>
                  <span className="font-[var(--font-mono)] text-sky-300">
                    lofi_yeti_runner::yeti_game
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 rounded-lg bg-[#080d19] px-3 py-2 border border-white/8">
                  <span className="text-slate-400">Package ID</span>
                  <span className="font-[var(--font-mono)] text-slate-200 truncate max-w-[60%]">
                    {LOFI_MOVE_PACKAGE_ID}
                  </span>
                </div>
                <div className="rounded-lg bg-[#080d19] px-3 py-2 border border-white/8 font-[var(--font-mono)] text-[11px] text-slate-300 break-all">
                  {getMoveCallSnippet()}
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-white/12 bg-[#111a2e] p-4">
              <div className="flex items-center justify-between">
                <h3 className="font-[var(--font-display)] text-xs font-bold uppercase tracking-wider text-slate-300">
                  Recent Sui Receipts
                </h3>
                <span className="text-[11px] text-slate-400 tabular-nums">
                  {save.blockchain.receipts.length} saved
                </span>
              </div>

              {save.blockchain.receipts.length === 0 ? (
                <p className="mt-3 text-xs text-slate-400">
                  No rewards claimed yet. Sign in with Google and claim your earned coins or mint a Yeti to record your first receipt.
                </p>
              ) : (
                <div className="mt-2.5 space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  {save.blockchain.receipts.slice(0, 8).map((rcpt) => (
                    <div
                      key={rcpt.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-white/8 bg-[#080d19] px-3 py-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-white truncate">{rcpt.summary}</div>
                        <div className="font-[var(--font-mono)] text-[10px] text-slate-400 truncate">
                          {rcpt.suiIdentifier ? `${formatSuiIdentifier(rcpt.suiIdentifier)} · ` : ''}
                          {rcpt.digest.slice(0, 12)}... · {rcpt.network}
                        </div>
                      </div>
                      <a
                        href={getExplorerTxUrl(rcpt.network, rcpt.digest)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-[11px] font-semibold text-sky-300 hover:text-sky-200 whitespace-nowrap shrink-0"
                      >
                        Explorer
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
