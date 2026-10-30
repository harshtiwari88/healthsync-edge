import {IncentiveEntry, TriageRecord} from '../types/triage';
import {
  decryptVaultData,
  EncryptedVaultEnvelope,
  encryptVaultData,
  isEncryptedVaultEnvelope,
} from './cryptoVault';
import {safeReadJson} from './safeFetchJson';

export const LEGACY_SINGLETON_VAULT_KEY = 'healthsync_aes_gcm_vault_v1';
export const SCOPED_VAULT_KEY_PREFIX = 'healthsync_aes_gcm_vault_v2_';
const LEGACY_PLAINTEXT_KEYS = [
  'healthsync_records',
  'healthsync_edge_v4_records',
  'healthsync_edge_v5_records',
];
const BROADCAST_CHANNEL_NAME = 'healthsync_edge_realtime_bus';
const IDB_NAME = 'healthsync_encrypted_idb_v1';
const IDB_STORE = 'encrypted_vault_envelopes';

/**
 * Produces an injective, collision-free per-account vault scope identifier from (role, identifier).
 * Prevents shared-device data destruction when multiple ASHA workers or DMOs share a tablet/phone.
 */
export function buildUserVaultScope(role: 'ASHA' | 'DMO', identifier: string): string {
  const normalized = `${role}:${identifier.trim().toUpperCase()}`;
  const bytes = new TextEncoder().encode(normalized);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return `${role}_${hex}`;
}

export function getScopedVaultStorageKey(userScope: string): string {
  if (!userScope || !userScope.trim()) {
    throw new Error('User vault scope is required to access encrypted local storage.');
  }
  return `${SCOPED_VAULT_KEY_PREFIX}${userScope.trim()}`;
}

export function getScopedVaultIdbSlot(userScope: string): string {
  if (!userScope || !userScope.trim()) {
    throw new Error('User vault scope is required to access encrypted IndexedDB slot.');
  }
  return `vault_v2_${userScope.trim()}`;
}

function getLocalStorage(): Storage | null {
  try {
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    // Ignore storage access errors
  }
  return null;
}

export type RealtimeEventMessage =
  | {
      type: 'record:created';
      record: TriageRecord;
      triggerEmergencySiren: boolean;
    }
  | {
      type: 'record:updated';
      record: TriageRecord;
    }
  | {
      type: 'record:deleted';
      recordId: string;
    }
  | {
      type: 'sync:init';
      records: TriageRecord[];
      connectedPeers: number;
    }
  | {
      type: 'sync:ack';
      recordId: string;
      record: TriageRecord;
    }
  | {
      type: 'sync:error';
      recordId: string | null;
      error: string;
      retryable: boolean;
    }
  | {
      type: 'auth:error';
      error: string;
    }
  | {
      type: 'presence:count';
      connectedPeers: number;
    };

/**
 * Purges any legacy unencrypted localStorage keys & legacy IndexedDB databases
 * so zero plaintext PHI ever lingers in browser storage.
 */
export function purgeLegacyPlaintextStorage(): void {
  const storage = getLocalStorage();
  if (storage) {
    try {
      for (const key of LEGACY_PLAINTEXT_KEYS) {
        storage.removeItem(key);
      }
    } catch {
      // Ignore storage errors
    }
  }
  try {
    if (typeof window !== 'undefined' && 'indexedDB' in window) {
      window.indexedDB.deleteDatabase('healthsync_edge_idb');
      window.indexedDB.deleteDatabase('healthsync_os_v32');
    }
  } catch {
    // Ignore IndexedDB errors
  }
}

// REQUIRED FIX: Global queue to prevent IDB transaction race conditions
let idbWriteQueue: Promise<void> = Promise.resolve();

function saveEncryptedEnvelopeToIndexedDB(userScope: string, envelope: EncryptedVaultEnvelope): void {
  if (typeof window === 'undefined' || !('indexedDB' in window) || !userScope) return;

  idbWriteQueue = idbWriteQueue.then(
    () =>
      new Promise<void>((resolve) => {
        try {
          const slotKey = getScopedVaultIdbSlot(userScope);
          const request = window.indexedDB.open(IDB_NAME, 1);
          request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(IDB_STORE)) {
              db.createObjectStore(IDB_STORE, {keyPath: 'slot'});
            }
          };
          request.onsuccess = () => {
            try {
              const db = request.result;
              const tx = db.transaction(IDB_STORE, 'readwrite');
              tx.objectStore(IDB_STORE).put({slot: slotKey, ...envelope});
              tx.oncomplete = () => {
                db.close();
                resolve();
              };
              tx.onerror = () => {
                db.close();
                resolve();
              };
            } catch {
              resolve();
            }
          };
          request.onerror = () => resolve();
        } catch {
          resolve(); // Do not block queue on sandbox restriction
        }
      })
  );
}

function loadEncryptedEnvelopeFromIndexedDB(userScope: string): Promise<EncryptedVaultEnvelope | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window) || !userScope) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const slotKey = getScopedVaultIdbSlot(userScope);
      const request = window.indexedDB.open(IDB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, {keyPath: 'slot'});
        }
      };
      request.onsuccess = () => {
        try {
          const db = request.result;
          const tx = db.transaction(IDB_STORE, 'readonly');
          const getReq = tx.objectStore(IDB_STORE).get(slotKey);
          getReq.onsuccess = () => {
            const val = getReq.result;
            db.close();
            resolve(isEncryptedVaultEnvelope(val) ? val : null);
          };
          getReq.onerror = () => {
            db.close();
            resolve(null);
          };
        } catch {
          resolve(null);
        }
      };
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Encrypts records with Web Crypto AES-256-GCM BEFORE writing to the user's isolated
 * localStorage key and IndexedDB slot. Never touches any other user's vault on a shared device.
 */
export async function persistEncryptedRecords(
  vaultKey: CryptoKey | null,
  salt: Uint8Array | null,
  records: TriageRecord[],
  userScope: string
): Promise<void> {
  const storage = getLocalStorage();
  if (!vaultKey || !salt || !userScope || !userScope.trim()) return;
  try {
    const scopedKey = getScopedVaultStorageKey(userScope);
    const envelope = await encryptVaultData(vaultKey, salt, records);
    if (storage) {
      storage.setItem(scopedKey, JSON.stringify(envelope));
    }
    saveEncryptedEnvelopeToIndexedDB(userScope, envelope);
  } catch {
    // Ignore quota or encryption errors
  }
}

/**
 * Reads and verifies the AES-256-GCM encrypted vault for a specific `userScope`.
 * - Isolated per user so Worker B logging in on a shared tablet never reads or overwrites Worker A's vault.
 * - Safely migrates a legacy v1 vault ONLY if `vaultKey` cryptographically authenticates it;
 *   if decryption fails (belonging to a different user), legacy v1 is left untouched for its owner.
 */
export async function loadEncryptedRecords(
  vaultKey: CryptoKey,
  fallback: TriageRecord[],
  userScope: string
): Promise<TriageRecord[]> {
  if (!userScope || !userScope.trim()) return fallback;
  const storage = getLocalStorage();
  const scopedKey = getScopedVaultStorageKey(userScope);

  // 1. Check the user's isolated v2 localStorage vault
  if (storage) {
    try {
      const raw = storage.getItem(scopedKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (isEncryptedVaultEnvelope(parsed)) {
          const decrypted = await decryptVaultData<TriageRecord[]>(vaultKey, parsed);
          return Array.isArray(decrypted) ? decrypted : fallback;
        }
      }
    } catch {
      return fallback;
    }
  }

  // 2. Fallback to the user's isolated v2 IndexedDB vault slot
  const idbEnvelope = await loadEncryptedEnvelopeFromIndexedDB(userScope);
  if (idbEnvelope) {
    try {
      const decrypted = await decryptVaultData<TriageRecord[]>(vaultKey, idbEnvelope);
      if (Array.isArray(decrypted)) {
        if (storage) {
          try {
            storage.setItem(scopedKey, JSON.stringify(idbEnvelope));
          } catch {
            // Ignore quota errors
          }
        }
        return decrypted;
      }
    } catch {
      return fallback;
    }
  }

  // 3. Non-destructive legacy singleton migration: ONLY migrate if THIS user's key decrypts it!
  if (storage) {
    try {
      const legacyRaw = storage.getItem(LEGACY_SINGLETON_VAULT_KEY);
      if (legacyRaw) {
        const legacyParsed = JSON.parse(legacyRaw);
        if (isEncryptedVaultEnvelope(legacyParsed)) {
          const migrated = await decryptVaultData<TriageRecord[]>(vaultKey, legacyParsed);
          if (Array.isArray(migrated)) {
            storage.setItem(scopedKey, legacyRaw);
            saveEncryptedEnvelopeToIndexedDB(userScope, legacyParsed);
            storage.removeItem(LEGACY_SINGLETON_VAULT_KEY);
            return migrated;
          }
        }
      }
    } catch {
      // Legacy vault belongs to a different user on this shared device — leave it completely intact!
    }
  }

  return fallback;
}

/**
 * Authenticated Multi-Device & Multi-Tab Real-Time Transport
 */
export class HealthSyncRealtimeClient {
  private ws: WebSocket | null = null;
  private bc: BroadcastChannel | null = null;
  private reconnectTimer: number | null = null;
  private httpPollTimer: number | null = null;
  private lastDeltaSyncMs = 0;
  private reconnectAttempts = 0;
  private destroyed = false;
  private sessionToken: string;
  private onMessageCallback: (msg: RealtimeEventMessage) => void;

  constructor(sessionToken: string, onMessage: (msg: RealtimeEventMessage) => void) {
    this.sessionToken = sessionToken;
    this.onMessageCallback = onMessage;

    if (typeof window !== 'undefined') {
      if ('BroadcastChannel' in window) {
        this.bc = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
        this.bc.onmessage = (ev) => {
          if (ev.data && typeof ev.data.type === 'string') {
            this.onMessageCallback(ev.data as RealtimeEventMessage);
          }
        };
      }

      if (this.sessionToken && this.sessionToken !== 'OFFLINE_LOCAL_SESSION') {
        this.connectWebSocket();
      }
    }
  }

  public updateSessionToken(newToken: string): void {
    if (!newToken || this.destroyed) return;
    this.sessionToken = newToken;
  }

  private startServerlessHttpDeltaPolling(): void {
    if (
      this.destroyed ||
      this.httpPollTimer !== null ||
      typeof window === 'undefined' ||
      !this.sessionToken ||
      this.sessionToken === 'OFFLINE_LOCAL_SESSION'
    ) {
      return;
    }
    this.httpPollTimer = window.setInterval(async () => {
      if (
        this.destroyed ||
        !this.sessionToken ||
        this.sessionToken === 'OFFLINE_LOCAL_SESSION' ||
        (typeof navigator !== 'undefined' && !navigator.onLine)
      ) {
        return;
      }
      try {
        const sinceParam = this.lastDeltaSyncMs > 0 ? `?since=${this.lastDeltaSyncMs}` : '';
        const resp = await fetch(`/api/records${sinceParam}`, {
          headers: {Authorization: `Bearer ${this.sessionToken}`},
        });
        if (!resp.ok) return;
        const parsed = await safeReadJson<{records?: TriageRecord[]}>(resp);
        if (parsed.isJson && Array.isArray(parsed.data?.records) && parsed.data.records.length > 0) {
          this.lastDeltaSyncMs = Date.now() - 2_000;
          this.onMessageCallback({
            type: 'sync:init',
            records: parsed.data.records,
            connectedPeers: 1,
          });
        }
      } catch {
        // Ignore transient offline errors during delta polling
      }
    }, 15_000);
  }

  private stopServerlessHttpDeltaPolling(): void {
    if (this.httpPollTimer !== null && typeof window !== 'undefined') {
      window.clearInterval(this.httpPollTimer);
      this.httpPollTimer = null;
    }
  }

  private connectWebSocket() {
    if (
      this.destroyed ||
      typeof window === 'undefined' ||
      !this.sessionToken ||
      this.sessionToken === 'OFFLINE_LOCAL_SESSION'
    ) {
      return;
    }

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      // SECURITY FIX: Never place session tokens in the WebSocket URL query string.
      // Authenticate post-upgrade over an in-band WebSocket frame.
      const wsUrl = `${protocol}//${window.location.host}/ws/triage`;
      const socket = new WebSocket(wsUrl);
      this.ws = socket;

      socket.onopen = () => {
        if (this.destroyed || socket.readyState !== WebSocket.OPEN) return;
        this.stopServerlessHttpDeltaPolling();
        socket.send(
          JSON.stringify({
            type: 'auth',
            token: this.sessionToken,
          })
        );
      };

      socket.onmessage = (event) => {
        try {
          const parsed = JSON.parse(String(event.data)) as RealtimeEventMessage;
          if (parsed.type === 'sync:init') {
            this.reconnectAttempts = 0;
            this.lastDeltaSyncMs = Date.now() - 2_000;
          }
          this.onMessageCallback(parsed);
        } catch (err) {
          console.error('[HealthSync WS] Invalid JSON frame from server:', err);
        }
      };

      socket.onclose = (event) => {
        if (this.destroyed || event.code === 4001 || event.code === 4003) {
          return;
        }
        if (this.reconnectAttempts < 8) {
          const delayMs = Math.min(30_000, 3_000 * 2 ** this.reconnectAttempts);
          this.reconnectAttempts += 1;
          if (this.reconnectAttempts >= 2) {
            // Fall back to authenticated HTTP delta-sync on serverless runtimes without persistent WebSockets
            this.startServerlessHttpDeltaPolling();
          }
          this.reconnectTimer = window.setTimeout(() => {
            this.connectWebSocket();
          }, delayMs);
        } else {
          this.startServerlessHttpDeltaPolling();
        }
      };
    } catch (err) {
      console.error('[HealthSync WS] Failed to initialize WebSocket transport:', err);
      this.startServerlessHttpDeltaPolling();
    }
  }

   public async publishRecordCreated(
    record: TriageRecord,
    triggerEmergencySiren: boolean,
    incentive?: IncentiveEntry
  ): Promise<{
    ok: boolean;
    record?: TriageRecord;
    incentive?: IncentiveEntry;
    error?: string;
    retryable?: boolean;
  }> {
    const payload: RealtimeEventMessage = {
      type: 'record:created',
      record,
      triggerEmergencySiren,
    };

    try {
      this.bc?.postMessage(payload);
    } catch {
      // Ignore BroadcastChannel cloning issues
    }

    if (!this.sessionToken || this.sessionToken === 'OFFLINE_LOCAL_SESSION') {
      const offlineMsg = 'Offline local session: record queued locally until server sign-in.';
      this.onMessageCallback({
        type: 'sync:error',
        recordId: record.id,
        error: offlineMsg,
        retryable: true,
      });
      return {ok: false, error: offlineMsg, retryable: true};
    }

    try {
      const resp = await fetch('/api/records', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.sessionToken}`,
        },
        body: JSON.stringify({record, triggerEmergencySiren, incentive}),
      });

      const parsed = await safeReadJson<{
        ok?: boolean;
        record?: TriageRecord;
        incentive?: IncentiveEntry;
        error?: string;
      }>(resp);

      if (!parsed.isJson) {
        const unavailableMsg =
          'Server sync endpoint unavailable on this connection; record safely queued offline.';
        this.onMessageCallback({
          type: 'sync:error',
          recordId: record.id,
          error: unavailableMsg,
          retryable: true,
        });
        return {ok: false, error: unavailableMsg, retryable: true};
      }

      const body = parsed.data || {};
      if (!resp.ok) {
        const errMsg = body.error || `Server rejected triage sync (HTTP ${resp.status}).`;
        const retryable = resp.status >= 500 || resp.status === 429;
        console.error('[HealthSync Sync Error] Failed to persist record:', errMsg);
        this.onMessageCallback({
          type: 'sync:error',
          recordId: record.id,
          error: errMsg,
          retryable,
        });
        return {ok: false, error: errMsg, retryable};
      }

      const savedRecord: TriageRecord = body.record ?? {
        ...record,
        syncStatus: record.channel === 'Emergency SMS' ? 'SMS Delivered' : 'Synced',
      };
      this.onMessageCallback({
        type: 'sync:ack',
        recordId: savedRecord.id,
        record: savedRecord,
      });
      return {ok: true, record: savedRecord, incentive: body.incentive};
    } catch (err) {
      const errMsg =
        err instanceof Error ? err.message : 'Network error while syncing triage record.';
      console.error('[HealthSync Sync Error] Network/transport failure:', err);
      this.onMessageCallback({
        type: 'sync:error',
        recordId: record.id,
        error: errMsg,
        retryable: true,
      });
      return {ok: false, error: errMsg, retryable: true};
    }
  }

  public async publishRecordDispatched(
    recordId: string,
    ambulanceUnit = '108-AMB-UP65',
    etaMinutes = 11
  ): Promise<TriageRecord | null> {
    if (!this.sessionToken || this.sessionToken === 'OFFLINE_LOCAL_SESSION') {
      return null;
    }
    try {
      const resp = await fetch(`/api/records/${encodeURIComponent(recordId)}/dispatch`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.sessionToken}`,
        },
        body: JSON.stringify({ambulanceUnit, etaMinutes}),
      });
      if (!resp.ok) return null;
      const parsed = await safeReadJson<{record?: TriageRecord}>(resp);
      if (parsed.isJson && parsed.data?.record) {
        this.bc?.postMessage({type: 'record:updated', record: parsed.data.record});
        return parsed.data.record;
      }
      return null;
    } catch {
      return null;
    }
  }

  public destroy() {
    this.destroyed = true;
    this.stopServerlessHttpDeltaPolling();
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
    }
    try {
      this.bc?.close();
    } catch {
      // Ignore
    }
    try {
      this.ws?.close();
    } catch {
      // Ignore
    }
  }
}
