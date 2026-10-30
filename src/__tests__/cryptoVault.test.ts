import {describe, expect, it} from 'vitest';
import {
  base64ToBytes,
  bytesToBase64,
  decryptVaultData,
  deriveAesGcmVaultKey,
  encryptVaultData,
  generateRandomSalt,
  isEncryptedVaultEnvelope,
} from '../utils/cryptoVault';

describe('Web Crypto PBKDF2-SHA256 + AES-256-GCM Client Vault', () => {
  it('encrypts patient PHI so zero plaintext strings exist in serialized storage envelope', async () => {
    const salt = generateRandomSalt(16);
    const key = await deriveAesGcmVaultKey('ASHA-8842-UP', '9472', salt);

    const sensitiveRecords = [
      {
        id: 'rec-phi-1',
        patientName: 'Kamla Devi Sharma',
        abhaId: '91-4821-7730-9912',
        clinicalNotes: 'Severe postpartum dizziness and elevated blood pressure',
      },
    ];

    const envelope = await encryptVaultData(key, salt, sensitiveRecords);
    expect(isEncryptedVaultEnvelope(envelope)).toBe(true);
    expect(envelope.alg).toBe('AES-256-GCM');
    expect(envelope.kdf).toBe('PBKDF2-SHA256-600K');

    const serialized = JSON.stringify(envelope);
    expect(serialized).not.toContain('Kamla Devi Sharma');
    expect(serialized).not.toContain('91-4821-7730-9912');
    expect(serialized).not.toContain('postpartum');

    const decrypted = await decryptVaultData<typeof sensitiveRecords>(key, envelope);
    expect(decrypted).toEqual(sensitiveRecords);
  });

  it('produces distinct ciphertexts and IVs across repeated encryptions of identical data', async () => {
    const salt = generateRandomSalt(16);
    const key = await deriveAesGcmVaultKey('ASHA-8842-UP', '9472', salt);
    const payload = {patientId: 'PT-9001', spo2: 88};

    const env1 = await encryptVaultData(key, salt, payload);
    const env2 = await encryptVaultData(key, salt, payload);

    expect(env1.ivB64).not.toBe(env2.ivB64);
    expect(env1.ciphertextB64).not.toBe(env2.ciphertextB64);
  });

  it('rejects decryption when given an incorrect PIN or tampered ciphertext', async () => {
    const salt = generateRandomSalt(16);
    const validKey = await deriveAesGcmVaultKey('ASHA-8842-UP', '9472', salt);
    const wrongPinKey = await deriveAesGcmVaultKey('ASHA-8842-UP', '0000', salt);

    const envelope = await encryptVaultData(validKey, salt, {secretNote: 'Critical hypoxia'});

    await expect(decryptVaultData(wrongPinKey, envelope)).rejects.toThrow();

    // Flip a byte in the AES-GCM ciphertext/tag and verify authenticated tag failure
    const rawCipher = base64ToBytes(envelope.ciphertextB64);
    rawCipher[0] ^= 0xff;
    const tamperedEnvelope = {
      ...envelope,
      ciphertextB64: bytesToBase64(rawCipher),
    };

    await expect(decryptVaultData(validKey, tamperedEnvelope)).rejects.toThrow();
  });

  it('isolates encrypted offline vaults per user on shared rural devices without destroying other workers data', async () => {
    const store = new Map<string, string>();
    const mockLocalStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => {
        store.set(k, String(v));
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size;
      },
    } as Storage;

    const prevDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      value: mockLocalStorage,
      configurable: true,
      writable: true,
    });

    try {
      const {saveOfflineLoginVerifier, verifyOfflineLogin} = await import('../utils/cryptoVault');
      const {buildUserVaultScope, loadEncryptedRecords, persistEncryptedRecords} = await import(
        '../utils/realtimeSync'
      );
      type TriageRecord = import('../types/triage').TriageRecord;

      // Worker A logs in online, caches offline verifier, and saves 2 offline records
      const workerAAuth = await saveOfflineLoginVerifier({
        identifier: 'ASHA-1001-UP',
        role: 'ASHA',
        displayName: 'Sunita Devi',
        villageCode: 'VIL-204',
        secret: '4829',
      });
      const scopeA = buildUserVaultScope('ASHA', 'ASHA-1001-UP');

      const workerARecords = [
        {
          id: 'rec-worker-a-1',
          patientId: 'PT1001',
          abhaId: '91-1111-2222-3333',
          patientName: 'Radha Bai',
          age: 29,
          gender: 'F',
          villageCode: 'VIL-204',
          villageName: 'Rampur Kalan',
          ashaWorker: 'Sunita Devi (ASHA-1001-UP)',
          vitals: {systolic: 158, diastolic: 98, spo2: 91, temperature: 100.4, heartRate: 102},
          symptoms: ['Fever'],
          severity: 'moderate',
          clinicalNotes: 'Worker A offline visit',
          channel: 'Data',
          syncStatus: 'Queued Offline',
          binarySmsPayload: 'HS#A1001#BP158/98#SPO291#YLW',
          timestamp: '09:15 AM',
          createdAtMs: 1700000100000,
          dispatchStatus: 'Unassigned',
        },
      ] as TriageRecord[];

      await persistEncryptedRecords(workerAAuth.vaultKey, workerAAuth.salt, workerARecords, scopeA);

      // Worker B logs in on the SAME shared device, loads empty vault, and saves Worker B's own record
      const workerBAuth = await saveOfflineLoginVerifier({
        identifier: 'ASHA-2002-UP',
        role: 'ASHA',
        displayName: 'Geeta Kumari',
        villageCode: 'VIL-108',
        secret: '9153',
      });
      const scopeB = buildUserVaultScope('ASHA', 'ASHA-2002-UP');
      expect(scopeB).not.toBe(scopeA);

      const loadedForB = await loadEncryptedRecords(workerBAuth.vaultKey, [], scopeB);
      expect(loadedForB).toEqual([]);

      const workerBRecords = [
        {
          ...workerARecords[0],
          id: 'rec-worker-b-1',
          patientId: 'PT2001',
          patientName: 'Mohan Lal',
          ashaWorker: 'Geeta Kumari (ASHA-2002-UP)',
        },
      ] as TriageRecord[];
      await persistEncryptedRecords(workerBAuth.vaultKey, workerBAuth.salt, workerBRecords, scopeB);

      // Worker A logs back in completely offline and recovers 100% of Worker A's offline records intact!
      const workerAOffline = await verifyOfflineLogin({
        identifier: 'ASHA-1001-UP',
        role: 'ASHA',
        secret: '4829',
      });
      const recoveredForA = await loadEncryptedRecords(workerAOffline.vaultKey, [], scopeA);
      expect(recoveredForA.length).toBe(1);
      expect(recoveredForA[0].patientName).toBe('Radha Bai');
      expect(recoveredForA[0].id).toBe('rec-worker-a-1');
    } finally {
      if (prevDescriptor) {
        Object.defineProperty(globalThis, 'localStorage', prevDescriptor);
      }
    }
  });
});
