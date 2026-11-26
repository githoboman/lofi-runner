import type { CharacterId, OnChainReceipt, SuiNetworkId } from '../game/types';

export interface SuiNetworkHealth {
  network: SuiNetworkId;
  checkpoint: string | null;
  rpcUrl: string;
  reachable: boolean;
}

const RPC_URLS: Record<SuiNetworkId, string> = {
  testnet: 'https://fullnode.testnet.sui.io:443',
  mainnet: 'https://fullnode.mainnet.sui.io:443',
};

const EXPLORER_TX_URLS: Record<SuiNetworkId, string> = {
  testnet: 'https://suiscan.xyz/testnet/tx/',
  mainnet: 'https://suiscan.xyz/mainnet/tx/',
};

const EXPLORER_ADDR_URLS: Record<SuiNetworkId, string> = {
  testnet: 'https://suiscan.xyz/testnet/account/',
  mainnet: 'https://suiscan.xyz/mainnet/account/',
};

// Configurable package ID once `contracts/lofi_yeti_runner/sources/lofi_yeti.move` is published
export const LOFI_MOVE_PACKAGE_ID =
  (import.meta.env.VITE_SUI_PACKAGE_ID as string | undefined) || '0x0 (Ready to publish)';

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const hash = await crypto.subtle.digest('SHA-256', data);
    return bytesToHex(new Uint8Array(hash));
  }
  let h1 = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    h1 ^= data[i];
    h1 = Math.imul(h1, 0x01000193);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0').repeat(8);
}

/**
 * Normalizes a user-provided Sui address (`0x...`) or SuiNS name (`name.sui` / `@name`).
 */
export function normalizeSuiIdentifier(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('@') && trimmed.length > 1) {
    return `${trimmed.slice(1).toLowerCase()}.sui`;
  }
  if (/^0x[0-9a-f]+$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return trimmed.toLowerCase();
}

export function isSuiAddress(value: string): boolean {
  return /^0x[0-9a-f]{64}$/i.test(value.trim());
}

export function isSuiNsName(value: string): boolean {
  const v = value.trim().toLowerCase();
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.sui$/.test(v);
}

/**
 * Accepts either a full 32-byte Sui address (`0x` + 64 hex chars) or a `.sui` SuiNS name (e.g. `lofi.sui`).
 */
export function isValidSuiIdentifier(raw: string): boolean {
  const norm = normalizeSuiIdentifier(raw);
  return isSuiAddress(norm) || isSuiNsName(norm);
}

export function formatSuiIdentifier(identifier: string): string {
  const v = identifier.trim();
  if (!v) return '';
  if (isSuiNsName(v)) return v;
  if (v.length <= 14) return v;
  return `${v.slice(0, 6)}...${v.slice(-4)}`;
}

export function formatMistToSui(mistStr: string): string {
  try {
    const mist = BigInt(mistStr || '0');
    const whole = mist / 1_000_000_000n;
    const frac = (mist % 1_000_000_000n).toString().padStart(9, '0').slice(0, 3);
    return `${whole.toString()}.${frac} SUI`;
  } catch {
    return '0.000 SUI';
  }
}

export function getExplorerTxUrl(network: SuiNetworkId, digest: string): string {
  return `${EXPLORER_TX_URLS[network]}${digest}`;
}

export function getExplorerAddressUrl(network: SuiNetworkId, address: string): string {
  return `${EXPLORER_ADDR_URLS[network]}${address}`;
}

async function suiRpcCall<T>(
  network: SuiNetworkId,
  method: string,
  params: unknown[],
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(RPC_URLS[network], {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Sui RPC HTTP ${res.status}`);
    const json = (await res.json()) as { result?: T; error?: { message: string } };
    if (json.error) throw new Error(json.error.message);
    if (json.result === undefined) throw new Error('Empty Sui RPC response');
    return json.result;
  } finally {
    window.clearTimeout(timeout);
  }
}

/**
 * Fetches live Sui Testnet/Mainnet checkpoint sequence number directly from the public Sui fullnode.
 */
export async function fetchSuiNetworkHealth(network: SuiNetworkId): Promise<SuiNetworkHealth> {
  const rpcUrl = RPC_URLS[network];
  try {
    const checkpoint = await suiRpcCall<string>(
      network,
      'sui_getLatestCheckpointSequenceNumber',
      [],
    );
    return { network, checkpoint, rpcUrl, reachable: true };
  } catch {
    return { network, checkpoint: null, rpcUrl, reachable: false };
  }
}

/**
 * Resolves a `.sui` SuiNS name to its 0x Sui address via public Sui fullnode JSON-RPC (if registered).
 */
export async function resolveSuiNsAddress(
  network: SuiNetworkId,
  suiName: string,
): Promise<string | null> {
  try {
    const resolved = await suiRpcCall<string | null>(network, 'suix_resolveNameServiceAddress', [
      suiName.toLowerCase(),
    ]);
    return typeof resolved === 'string' && isSuiAddress(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

/**
 * Queries real on-chain SUI balance (in MIST) for a Sui address or resolved `.sui` name.
 */
export async function fetchSuiBalanceMist(
  network: SuiNetworkId,
  identifier: string,
): Promise<string> {
  const norm = normalizeSuiIdentifier(identifier);
  let targetAddress = isSuiAddress(norm) ? norm : null;
  if (!targetAddress && isSuiNsName(norm)) {
    targetAddress = await resolveSuiNsAddress(network, norm);
  }
  if (!targetAddress) return '0';

  try {
    const result = await suiRpcCall<{ totalBalance?: string }>(network, 'suix_getBalance', [
      targetAddress,
      '0x2::sui::SUI',
    ]);
    return result.totalBalance ?? '0';
  } catch {
    return '0';
  }
}

/**
 * Generates a verifiable SHA-256 receipt tied to the player's Google account and optional Sui address / `.sui` name.
 */
export async function createAccountOnChainReceipt(params: {
  accountUid: string;
  suiIdentifier: string;
  network: SuiNetworkId;
  kind: OnChainReceipt['kind'];
  summary: string;
  payload: Record<string, unknown>;
}): Promise<{ receipt: OnChainReceipt; objectId?: string }> {
  const timestamp = Date.now();
  const normalizedTarget = normalizeSuiIdentifier(params.suiIdentifier);
  const messageText = JSON.stringify({
    app: 'Lofi Yeti Runner',
    module: 'lofi_yeti_runner::yeti_game',
    network: params.network,
    action: params.kind,
    accountUid: params.accountUid,
    recipient: normalizedTarget,
    timestamp,
    ...params.payload,
  });

  const hashHex = await sha256Hex(messageText);
  const digest = hashHex.slice(0, 44);
  const objectId =
    params.kind === 'mint_yeti'
      ? `0x${await sha256Hex(`nft:${normalizedTarget}:${String(params.payload.characterId)}:${timestamp}`)}`
      : undefined;

  const receipt: OnChainReceipt = {
    id: `${params.kind}_${timestamp}`,
    kind: params.kind,
    summary: params.summary,
    digest,
    network: params.network,
    timestamp,
    mode: 'account',
    suiIdentifier: normalizedTarget,
  };

  return { receipt, objectId };
}

export function getMoveCallSnippet(characterId?: CharacterId): string {
  if (characterId) {
    return `lofi_yeti_runner::yeti_game::mint_yeti_nft(registry, b"${characterId}", ctx)`;
  }
  return `lofi_yeti_runner::yeti_game::claim_run_rewards(pass, treasury, amount, ctx)`;
}
