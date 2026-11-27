import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  browserSessionPersistence,
  getAuth,
  getRedirectResult,
  indexedDBLocalPersistence,
  initializeAuth,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth';
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  initializeFirestore,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { CHARACTERS, STORE_BOOSTERS, STORE_UPGRADES } from './game/config';
import { DEFAULT_BOOSTERS, DEFAULT_UPGRADES } from './game/storage';
import type {
  BoosterId,
  CharacterId,
  DailyLeaderboardEntry,
  DifficultyId,
  MintedYetiNft,
  OnChainReceipt,
  SaveData,
  SuiNetworkId,
  UpgradeId,
} from './game/types';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  };
}

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// Initialize Auth with IndexedDB -> Local -> Session persistence chain + explicit popupRedirectResolver
// so mobile Safari, mobile Chrome, and standalone webviews retain Google sessions cleanly without racing.
export const auth = (() => {
  try {
    return initializeAuth(app, {
      persistence: [
        indexedDBLocalPersistence,
        browserLocalPersistence,
        browserSessionPersistence,
      ],
      popupRedirectResolver: browserPopupRedirectResolver,
    });
  } catch {
    return getAuth(app);
  }
})();

// Force HTTP long-polling so Cloud Firestore connects reliably through sandboxed iframes,
// mobile networks, and strict proxies that stall WebChannel streaming connections.
export const db = (() => {
  try {
    return initializeFirestore(
      app,
      {
        experimentalForceLongPolling: true,
        experimentalLongPollingOptions: { timeoutSeconds: 20 },
      },
      firebaseConfig.firestoreDatabaseId,
    );
  } catch {
    return getFirestore(app, firebaseConfig.firestoreDatabaseId);
  }
})();

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export function isMobileBrowser(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  return (
    /Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile/i.test(navigator.userAgent) ||
    window.matchMedia?.('(pointer: coarse)').matches === true
  );
}

export function isInEmbeddedIframe(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData.map((provider) => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

export interface GoogleAccountProfile {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
}

export function toGoogleAccountProfile(user: User): GoogleAccountProfile {
  return {
    uid: user.uid,
    displayName: (user.displayName || user.email?.split('@')[0] || 'Yeti Runner').slice(0, 80),
    email: (user.email || '').slice(0, 160),
    photoURL: (user.photoURL || '').slice(0, 500),
  };
}

export interface GoogleSignInOutcome {
  user: User | null;
  redirected: boolean;
}

/**
 * Completes a returning mobile Google OAuth redirect sign-in on app startup.
 */
export async function completeGoogleRedirectSignIn(): Promise<User | null> {
  try {
    const result = await getRedirectResult(auth, browserPopupRedirectResolver);
    return result?.user ?? null;
  } catch (err) {
    console.warn('Google redirect sign-in check:', err);
    return null;
  }
}

/**
 * Starts Google Sign-In using signInWithPopup first (preserving the synchronous user tap gesture
 * for iOS Safari / Android Chrome and embedded previews), and automatically falls back to
 * signInWithRedirect on top-level mobile browsers when popups are blocked or unsupported.
 */
export async function signInWithGoogle(): Promise<GoogleSignInOutcome> {
  const startedAt = Date.now();
  try {
    const result = await signInWithPopup(auth, googleProvider, browserPopupRedirectResolver);
    return { user: result.user, redirected: false };
  } catch (err) {
    const code = (err as { code?: string })?.code ?? '';
    const elapsedMs = Date.now() - startedAt;
    const isMobile = isMobileBrowser();
    const inIframe = isInEmbeddedIframe();

    const shouldFallbackToRedirect =
      !inIframe &&
      isMobile &&
      (code === 'auth/popup-blocked' ||
        code === 'auth/operation-not-supported-in-this-environment' ||
        code === 'auth/web-storage-unsupported' ||
        code === 'auth/internal-error' ||
        (code === 'auth/popup-closed-by-user' && elapsedMs < 900));

    if (shouldFallbackToRedirect) {
      await signInWithRedirect(auth, googleProvider, browserPopupRedirectResolver);
      return { user: null, redirected: true };
    }

    throw err;
  }
}

/**
 * Explicit full-page redirect sign-in fallback for mobile browsers that block popups.
 */
export async function signInWithGoogleRedirect(): Promise<void> {
  await signInWithRedirect(auth, googleProvider, browserPopupRedirectResolver);
}

export async function signOutGoogle(): Promise<void> {
  await signOut(auth);
}

export function subscribeToAuth(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, callback);
}

interface CloudProfileDoc {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
  suiIdentifier: string;
  network: SuiNetworkId;
  lifetimeCoins: number;
  coinBalance: number;
  highScore: number;
  bestDistance: number;
  selectedCharacter: CharacterId;
  unlockedCharacters: string[];
  upgrades: Record<UpgradeId, number>;
  boosters: Record<BoosterId, number>;
  equippedBoosters: string[];
  claimedCoins: number;
  onChainBestScore: number;
  mintedYetiIds: string[];
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

interface CloudReceiptDoc {
  uid: string;
  kind: OnChainReceipt['kind'];
  summary: string;
  suiIdentifier: string;
  network: SuiNetworkId;
  digest: string;
  createdAt?: Timestamp;
}

function sanitizeUpgrades(upgrades: Record<UpgradeId, number>): Record<UpgradeId, number> {
  const clean: Record<UpgradeId, number> = { ...DEFAULT_UPGRADES };
  for (const u of STORE_UPGRADES) {
    const val = upgrades[u.id] ?? 0;
    clean[u.id] = Math.min(u.maxLevel, Math.max(0, Math.floor(Number.isFinite(val) ? val : 0)));
  }
  return clean;
}

function sanitizeBoosters(boosters: Record<BoosterId, number>): Record<BoosterId, number> {
  const clean: Record<BoosterId, number> = { ...DEFAULT_BOOSTERS };
  for (const b of STORE_BOOSTERS) {
    const val = boosters[b.id] ?? 0;
    clean[b.id] = Math.min(b.maxStack, Math.max(0, Math.floor(Number.isFinite(val) ? val : 0)));
  }
  return clean;
}

function buildMutableProfilePayload(user: User, save: SaveData) {
  const acct = toGoogleAccountProfile(user);
  const validCharIds = new Set(CHARACTERS.map((c) => c.id));
  const selectedCharacter: CharacterId = validCharIds.has(save.selectedCharacter)
    ? save.selectedCharacter
    : 'og_lofi';

  const unlockedCharacters = Array.from(
    new Set(['og_lofi', ...save.unlockedCharacters.filter((c) => validCharIds.has(c))]),
  ).slice(0, 10);

  const validBoosterIds = new Set(STORE_BOOSTERS.map((b) => b.id));
  const boosters = sanitizeBoosters(save.boosters);
  const equippedBoosters = Array.from(
    new Set(save.equippedBoosters.filter((b) => validBoosterIds.has(b) && boosters[b] > 0)),
  ).slice(0, 10);

  const mintedYetiIds = Object.keys(save.blockchain.mintedNfts)
    .filter((id) => validCharIds.has(id as CharacterId))
    .slice(0, 10);

  return {
    displayName: acct.displayName,
    email: acct.email,
    photoURL: acct.photoURL,
    suiIdentifier: (save.blockchain.suiIdentifier || '').trim().slice(0, 100),
    network: (save.blockchain.network === 'mainnet' ? 'mainnet' : 'testnet') as SuiNetworkId,
    lifetimeCoins: Math.max(0, Math.floor(save.lifetimeCoins)),
    coinBalance: Math.max(0, Math.floor(save.coinBalance)),
    highScore: Math.max(0, Math.floor(save.highScore)),
    bestDistance: Math.max(0, Math.floor(save.bestDistance)),
    selectedCharacter,
    unlockedCharacters,
    upgrades: sanitizeUpgrades(save.upgrades),
    boosters,
    equippedBoosters,
    claimedCoins: Math.max(0, Math.floor(save.blockchain.claimedCoins)),
    onChainBestScore: Math.max(0, Math.floor(save.blockchain.onChainBestScore)),
    mintedYetiIds,
  };
}

/**
 * Loads the player's cloud save + recent Sui receipts and merges them cleanly with local progress
 * so switching between desktop and mobile preserves the best of both sessions.
 */
export async function loadAndMergeCloudProfile(
  user: User,
  localSave: SaveData,
): Promise<SaveData> {
  const userPath = `users/${user.uid}`;
  const userRef = doc(db, 'users', user.uid);
  let snap;
  try {
    snap = await getDoc(userRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, userPath);
  }

  if (!snap.exists()) {
    const payload = buildMutableProfilePayload(user, localSave);
    try {
      await setDoc(userRef, {
        uid: user.uid,
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, userPath);
    }
    return localSave;
  }

  const remote = snap.data() as Partial<CloudProfileDoc>;

  // Fetch recent immutable on-chain receipts owned by this user (sorted client-side to avoid composite index requirements)
  const receiptsPath = `users/${user.uid}/receipts`;
  let remoteReceipts: OnChainReceipt[] = [];
  try {
    const q = query(
      collection(db, 'users', user.uid, 'receipts'),
      where('uid', '==', user.uid),
      limit(25),
    );
    const receiptSnap = await getDocs(q);
    remoteReceipts = receiptSnap.docs
      .map((d) => {
        const r = d.data() as CloudReceiptDoc;
        return {
          id: d.id,
          kind: r.kind,
          summary: r.summary,
          digest: r.digest,
          network: r.network,
          timestamp: r.createdAt ? r.createdAt.toMillis() : Date.now(),
          mode: 'account' as const,
          suiIdentifier: r.suiIdentifier,
        };
      })
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 20);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, receiptsPath);
  }

  const validCharIds = new Set(CHARACTERS.map((c) => c.id));
  const mergedUnlocked = new Set<CharacterId>(['og_lofi', ...localSave.unlockedCharacters]);
  if (Array.isArray(remote.unlockedCharacters)) {
    for (const c of remote.unlockedCharacters) {
      if (validCharIds.has(c as CharacterId)) mergedUnlocked.add(c as CharacterId);
    }
  }

  const mergedUpgrades: Record<UpgradeId, number> = { ...localSave.upgrades };
  if (remote.upgrades && typeof remote.upgrades === 'object') {
    for (const u of STORE_UPGRADES) {
      const rv = remote.upgrades[u.id];
      if (typeof rv === 'number' && Number.isFinite(rv)) {
        mergedUpgrades[u.id] = Math.min(u.maxLevel, Math.max(mergedUpgrades[u.id] ?? 0, Math.floor(rv)));
      }
    }
  }

  const mergedBoosters: Record<BoosterId, number> = { ...localSave.boosters };
  if (remote.boosters && typeof remote.boosters === 'object') {
    for (const b of STORE_BOOSTERS) {
      const rv = remote.boosters[b.id];
      if (typeof rv === 'number' && Number.isFinite(rv)) {
        mergedBoosters[b.id] = Math.min(b.maxStack, Math.max(mergedBoosters[b.id] ?? 0, Math.floor(rv)));
      }
    }
  }

  const mergedMinted: Partial<Record<CharacterId, MintedYetiNft>> = {
    ...localSave.blockchain.mintedNfts,
  };
  if (Array.isArray(remote.mintedYetiIds)) {
    for (const cid of remote.mintedYetiIds) {
      if (validCharIds.has(cid as CharacterId)) {
        const charId = cid as CharacterId;
        mergedUnlocked.add(charId);
        if (!mergedMinted[charId]) {
          const matchingReceipt = remoteReceipts.find(
            (r) => r.kind === 'mint_yeti' && r.summary.toLowerCase().includes(charId.replace('_', ' ')),
          );
          mergedMinted[charId] = {
            characterId: charId,
            objectId: matchingReceipt?.digest ?? `cloud_${charId}`,
            network: remote.network === 'mainnet' ? 'mainnet' : 'testnet',
            mintedAt: matchingReceipt?.timestamp ?? Date.now(),
            digest: matchingReceipt?.digest ?? `cloud_${charId}`,
          };
        }
      }
    }
  }

  const seenDigests = new Set<string>();
  const combinedReceipts: OnChainReceipt[] = [];
  for (const r of [...remoteReceipts, ...localSave.blockchain.receipts]) {
    if (!seenDigests.has(r.digest)) {
      seenDigests.add(r.digest);
      combinedReceipts.push(r);
    }
  }

  const mergedLifetime = Math.max(localSave.lifetimeCoins, Math.floor(remote.lifetimeCoins ?? 0));
  const mergedBalance = Math.max(localSave.coinBalance, Math.floor(remote.coinBalance ?? 0));
  const mergedHighScore = Math.max(localSave.highScore, Math.floor(remote.highScore ?? 0));
  const mergedBestDist = Math.max(localSave.bestDistance, Math.floor(remote.bestDistance ?? 0));
  const mergedSuiId =
    (remote.suiIdentifier && remote.suiIdentifier.trim()) ||
    localSave.blockchain.suiIdentifier ||
    '';

  const mergedSave: SaveData = {
    ...localSave,
    lifetimeCoins: mergedLifetime,
    coinBalance: mergedBalance,
    highScore: mergedHighScore,
    bestDistance: mergedBestDist,
    unlockedCharacters: Array.from(mergedUnlocked),
    upgrades: mergedUpgrades,
    boosters: mergedBoosters,
    blockchain: {
      ...localSave.blockchain,
      suiIdentifier: mergedSuiId,
      network: remote.network === 'mainnet' || remote.network === 'testnet'
        ? remote.network
        : localSave.blockchain.network,
      claimedCoins: Math.max(
        localSave.blockchain.claimedCoins,
        Math.floor(remote.claimedCoins ?? 0),
      ),
      onChainBestScore: Math.max(
        localSave.blockchain.onChainBestScore,
        Math.floor(remote.onChainBestScore ?? 0),
      ),
      mintedNfts: mergedMinted,
      receipts: combinedReceipts.slice(0, 20),
    },
  };

  // Push merged state back so cloud stays up-to-date
  await syncCloudProfile(user, mergedSave);
  return mergedSave;
}

/**
 * Syncs player progression & optional Sui address / .sui name to Firestore.
 */
export async function syncCloudProfile(user: User, save: SaveData): Promise<void> {
  const userPath = `users/${user.uid}`;
  const userRef = doc(db, 'users', user.uid);
  const payload = buildMutableProfilePayload(user, save);

  let exists = false;
  try {
    const snap = await getDoc(userRef);
    exists = snap.exists();
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, userPath);
  }

  if (!exists) {
    try {
      await setDoc(userRef, {
        uid: user.uid,
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, userPath);
    }
  } else {
    try {
      await updateDoc(userRef, {
        ...payload,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, userPath);
    }
  }
}

/**
 * Records an immutable Sui claim / mint / leaderboard receipt in /users/{uid}/receipts/{receiptId}.
 */
export async function recordCloudReceipt(
  user: User,
  save: SaveData,
  receipt: OnChainReceipt,
  suiIdentifier: string,
): Promise<void> {
  // Ensure parent profile doc exists (required by Master Gate in firestore.rules)
  await syncCloudProfile(user, save);

  const safeId = receipt.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  const receiptPath = `users/${user.uid}/receipts/${safeId}`;
  const receiptRef = doc(db, 'users', user.uid, 'receipts', safeId);

  try {
    await setDoc(receiptRef, {
      uid: user.uid,
      kind: receipt.kind,
      summary: receipt.summary.slice(0, 160),
      suiIdentifier: suiIdentifier.trim().slice(0, 100),
      network: receipt.network,
      digest: receipt.digest.slice(0, 128),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, receiptPath);
  }
}

export const DAILY_LEADERBOARD_WINDOW_MS = 24 * 60 * 60 * 1000;

interface CloudDailyRunDoc {
  uid: string;
  displayName: string;
  photoURL: string;
  characterId: CharacterId;
  difficulty: DifficultyId;
  score: number;
  distance: number;
  runCoins: number;
  createdAt?: Timestamp;
}

const VALID_CHARACTER_IDS = new Set<CharacterId>(CHARACTERS.map((c) => c.id));
const VALID_DIFFICULTIES = new Set<DifficultyId>(['easy', 'normal', 'hard']);

/**
 * Records an immutable, PII-free community run score in /dailyRuns/{runId}
 * for the rolling 24-hour Daily Top Run leaderboard.
 */
export async function recordDailyRun(
  user: User,
  save: SaveData,
  run: {
    score: number;
    distance: number;
    runCoins: number;
    characterId: CharacterId;
    difficulty: DifficultyId;
  },
): Promise<DailyLeaderboardEntry | null> {
  const cleanScore = Math.min(100_000_000, Math.floor(Number.isFinite(run.score) ? run.score : 0));
  if (cleanScore < 1 || !user.emailVerified) {
    return null;
  }

  // Ensure parent user profile exists (required by Master Gate in firestore.rules)
  await syncCloudProfile(user, save);

  const safeUidPart = user.uid.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'runner';
  const randPart = Math.random().toString(36).slice(2, 8);
  const runId = `run_${Date.now()}_${safeUidPart}_${randPart}`.slice(0, 120);
  const runPath = `dailyRuns/${runId}`;
  const runRef = doc(db, 'dailyRuns', runId);

  const displayName =
    (user.displayName || user.email?.split('@')[0] || 'Yeti Runner').trim().slice(0, 80) ||
    'Yeti Runner';
  const photoURL = (user.photoURL || '').slice(0, 500);
  const characterId: CharacterId = VALID_CHARACTER_IDS.has(run.characterId)
    ? run.characterId
    : 'og_lofi';
  const difficulty: DifficultyId = VALID_DIFFICULTIES.has(run.difficulty)
    ? run.difficulty
    : 'normal';
  const distance = Math.min(10_000_000, Math.max(0, Math.floor(Number.isFinite(run.distance) ? run.distance : 0)));
  const runCoins = Math.min(10_000_000, Math.max(0, Math.floor(Number.isFinite(run.runCoins) ? run.runCoins : 0)));

  try {
    await setDoc(runRef, {
      uid: user.uid,
      displayName,
      photoURL,
      characterId,
      difficulty,
      score: cleanScore,
      distance,
      runCoins,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, runPath);
  }

  return {
    id: runId,
    uid: user.uid,
    displayName,
    photoURL,
    characterId,
    difficulty,
    score: cleanScore,
    distance,
    runCoins,
    createdAtMs: Date.now(),
  };
}

/**
 * Fetches the top community runs recorded within the rolling 24-hour window.
 * Uses a single-field createdAt range query (zero composite index required)
 * and ranks each player's highest 24-hour run client-side.
 */
export async function fetchDailyTopRuns(maxEntries = 10): Promise<DailyLeaderboardEntry[]> {
  const cutoffMs = Date.now() - DAILY_LEADERBOARD_WINDOW_MS;
  const cutoffTs = Timestamp.fromMillis(cutoffMs);

  let snap;
  try {
    const q = query(
      collection(db, 'dailyRuns'),
      where('createdAt', '>=', cutoffTs),
      orderBy('createdAt', 'desc'),
      limit(200),
    );
    snap = await getDocs(q);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'dailyRuns');
  }

  const bestByPlayer = new Map<string, DailyLeaderboardEntry>();

  for (const d of snap.docs) {
    const raw = d.data() as Partial<CloudDailyRunDoc>;
    if (!raw || typeof raw.uid !== 'string' || typeof raw.score !== 'number' || raw.score < 1) {
      continue;
    }
    const createdAtMs = raw.createdAt ? raw.createdAt.toMillis() : 0;
    if (createdAtMs < cutoffMs) continue;

    const entry: DailyLeaderboardEntry = {
      id: d.id,
      uid: raw.uid,
      displayName: (typeof raw.displayName === 'string' && raw.displayName.trim()) || 'Yeti Runner',
      photoURL: typeof raw.photoURL === 'string' ? raw.photoURL : '',
      characterId: VALID_CHARACTER_IDS.has(raw.characterId as CharacterId)
        ? (raw.characterId as CharacterId)
        : 'og_lofi',
      difficulty: VALID_DIFFICULTIES.has(raw.difficulty as DifficultyId)
        ? (raw.difficulty as DifficultyId)
        : 'normal',
      score: Math.floor(raw.score),
      distance: typeof raw.distance === 'number' && Number.isFinite(raw.distance) ? Math.max(0, Math.floor(raw.distance)) : 0,
      runCoins: typeof raw.runCoins === 'number' && Number.isFinite(raw.runCoins) ? Math.max(0, Math.floor(raw.runCoins)) : 0,
      createdAtMs,
    };

    const existingBest = bestByPlayer.get(entry.uid);
    if (
      !existingBest ||
      entry.score > existingBest.score ||
      (entry.score === existingBest.score && entry.distance > existingBest.distance)
    ) {
      bestByPlayer.set(entry.uid, entry);
    }
  }

  return Array.from(bestByPlayer.values())
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.distance !== a.distance) return b.distance - a.distance;
      return b.createdAtMs - a.createdAtMs;
    })
    .slice(0, maxEntries);
}
