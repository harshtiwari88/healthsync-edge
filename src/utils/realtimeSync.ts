import {TriageRecord} from '../types/triage';

export const HEALTHSYNC_STORAGE_KEY = 'healthsync_edge_v5_records';
const BROADCAST_CHANNEL_NAME = 'healthsync_edge_realtime_bus';
const IDB_NAME = 'healthsync_edge_idb';
const IDB_STORE = 'triage_records';

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
      type: 'sync:init';
      records: TriageRecord[];
      connectedPeers: number;
    }
  | {
      type: 'presence:count';
      connectedPeers: number;
    };

/**
 * Real Browser IndexedDB Mirror for Offline Persistence alongside LocalStorage
 */
function saveRecordsToIndexedDB(records: TriageRecord[]): void {
  if (typeof window === 'undefined' || !('indexedDB' in window)) return;
  try {
    const request = window.indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, {keyPath: 'id'});
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      records.forEach((rec) => {
        store.put(rec);
      });
      tx.oncomplete = () => db.close();
    };
  } catch {
    // Ignore IndexedDB sandbox restrictions if any
  }
}

export function loadStoredRecords(fallback: TriageRecord[]): TriageRecord[] {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(HEALTHSYNC_STORAGE_KEY);
    if (!raw) {
      window.localStorage.setItem(HEALTHSYNC_STORAGE_KEY, JSON.stringify(fallback));
      saveRecordsToIndexedDB(fallback);
      return fallback;
    }
    const parsed = JSON.parse(raw) as TriageRecord[];
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0]?.vitals?.systolic !== undefined) {
      return parsed;
    }
    window.localStorage.setItem(HEALTHSYNC_STORAGE_KEY, JSON.stringify(fallback));
    saveRecordsToIndexedDB(fallback);
    return fallback;
  } catch {
    return fallback;
  }
}

export function persistStoredRecords(records: TriageRecord[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(HEALTHSYNC_STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Ignore quota errors
  }
  saveRecordsToIndexedDB(records);
}

/**
 * Multi-Device & Multi-Tab Real-Time Transport
 * Combines:
 * 1. Full-duplex Server WebSocket (/ws/triage) for real cross-device sync
 * 2. Browser BroadcastChannel for instant zero-latency local multi-tab sync
 * 3. window 'storage' event listener on localStorage + IndexedDB persistence
 */
export class HealthSyncRealtimeClient {
  private ws: WebSocket | null = null;
  private bc: BroadcastChannel | null = null;
  private reconnectTimer: number | null = null;
  private destroyed = false;
  private onMessageCallback: (msg: RealtimeEventMessage) => void;
  private onStorageSyncCallback: (records: TriageRecord[]) => void;

  constructor(
    onMessage: (msg: RealtimeEventMessage) => void,
    onStorageSync: (records: TriageRecord[]) => void,
    initialSeedRecords: TriageRecord[]
  ) {
    this.onMessageCallback = onMessage;
    this.onStorageSyncCallback = onStorageSync;

    if (typeof window !== 'undefined') {
      if ('BroadcastChannel' in window) {
        this.bc = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
        this.bc.onmessage = (ev) => {
          if (ev.data && typeof ev.data.type === 'string') {
            this.onMessageCallback(ev.data as RealtimeEventMessage);
          }
        };
      }

      window.addEventListener('storage', this.handleStorageEvent);
      this.connectWebSocket(initialSeedRecords);
    }
  }

  private handleStorageEvent = (e: StorageEvent) => {
    if (e.key === HEALTHSYNC_STORAGE_KEY && e.newValue) {
      try {
        const updated = JSON.parse(e.newValue) as TriageRecord[];
        if (Array.isArray(updated)) {
          this.onStorageSyncCallback(updated);
        }
      } catch {
        // Ignore parse errors
      }
    }
  };

  private connectWebSocket(seedRecords: TriageRecord[]) {
    if (this.destroyed || typeof window === 'undefined') return;
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/triage`;
      const socket = new WebSocket(wsUrl);
      this.ws = socket;

      socket.onopen = () => {
        socket.send(
          JSON.stringify({
            type: 'records:seed',
            records: seedRecords,
          })
        );
      };

      socket.onmessage = (event) => {
        try {
          const parsed = JSON.parse(String(event.data)) as RealtimeEventMessage;
          this.onMessageCallback(parsed);
        } catch {
          // Ignore invalid JSON
        }
      };

      socket.onclose = () => {
        if (!this.destroyed) {
          this.reconnectTimer = window.setTimeout(() => {
            this.connectWebSocket(seedRecords);
          }, 2500);
        }
      };
    } catch {
      // Fallback gracefully to BroadcastChannel + storage events
    }
  }

  public publishRecordCreated(record: TriageRecord, triggerEmergencySiren: boolean) {
    const payload: RealtimeEventMessage = {
      type: 'record:created',
      record,
      triggerEmergencySiren,
    };

    try {
      this.bc?.postMessage(payload);
    } catch {
      // Ignore
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    } else if (typeof fetch === 'function') {
      fetch('/api/records', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({record, triggerEmergencySiren}),
      }).catch(() => {});
    }
  }

  public publishRecordUpdated(record: TriageRecord) {
    const payload: RealtimeEventMessage = {
      type: 'record:updated',
      record,
    };
    try {
      this.bc?.postMessage(payload);
    } catch {
      // Ignore
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  public destroy() {
    this.destroyed = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', this.handleStorageEvent);
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
