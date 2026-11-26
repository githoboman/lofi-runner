import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  initializeFirestore,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Timestamp,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { CHARACTERS, STORE_BOOSTERS, STORE_UPGRADES } from './game/config';
import { DEFAULT_BOOSTERS, DEFAULT_UPGRADES } from './game/storage';
import type {
  BoosterId,
  CharacterId,
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
export const auth = getAuth(app);

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

// Ensure smooth session persistence across desktop and mobile reloads
setPersistence(auth, browserLocalPersistence).catch(() => {
  // Ignore if restricted in private browsing
});

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

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

/**
 * Initiates Sign in with Google via signInWithPopup (works smoothly on both desktop & mobile
 * when called directly from a user tap/click handler).
 */
export async function signInWithGoogle(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
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
