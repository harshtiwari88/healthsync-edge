/**
 * True Client-Side Cryptographic Storage Vault (Web Crypto API)
 * - Key Derivation: PBKDF2-HMAC-SHA256 (600,000 iterations) from user credential + per-user 16-byte salt
 * - Authenticated Encryption: AES-256-GCM with fresh 96-bit (12-byte) CSPRNG IV per write
 * - Ensures zero plaintext patient PHI sits in localStorage or IndexedDB.
 */

export interface EncryptedVaultEnvelope {
  v: 1;
  alg: 'AES-256-GCM';
  kdf: 'PBKDF2-SHA256-600K' | 'PBKDF2-SHA256-100K';
  saltB64: string;
  ivB64: string;
  ciphertextB64: string;
}

export interface OfflineAuthVerifierRecord {
  identifier: string;
  role: 'ASHA' | 'DMO';
  displayName: string;
  villageCode: string;
  saltB64: string;
  verifierB64: string;
}

const OFFLINE_VERIFIERS_KEY = 'healthsync_auth_verifiers_v1';

function getSubtle(): SubtleCrypto {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj || !cryptoObj.subtle) {
    throw new Error('Web Crypto API (crypto.subtle) is required for AES-256-GCM vault encryption.');
  }
  return cryptoObj.subtle;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i) & 0xff;
  }
  return out;
}

export function generateRandomSalt(byteLength = 16): Uint8Array {
  const salt = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(salt);
  return salt;
}

export async function deriveAesGcmVaultKey(
  identifier: string,
  secret: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const subtle = getSubtle();
  const materialBytes = new TextEncoder().encode(
    `healthsync-vault-v1|${identifier.trim().toUpperCase()}|${secret}`
  );
  const baseKey = await subtle.importKey('raw', materialBytes, 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: 600_000, // REQUIRED FIX: Heavily tax GPU brute-force attempts
      hash: 'SHA-256',
    },
    baseKey,
    {name: 'AES-GCM', length: 256},
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptVaultData(
  key: CryptoKey,
  salt: Uint8Array,
  data: unknown
): Promise<EncryptedVaultEnvelope> {
  const subtle = getSubtle();
  const iv = new Uint8Array(12);
  globalThis.crypto.getRandomValues(iv);
  const encoded = new TextEncoder().encode(JSON.stringify(data));
  const encryptedBuf = await subtle.encrypt(
    {name: 'AES-GCM', iv: iv as BufferSource},
    key,
    encoded
  );

  return {
    v: 1,
    alg: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256-600K',
    saltB64: bytesToBase64(salt),
    ivB64: bytesToBase64(iv),
    ciphertextB64: bytesToBase64(new Uint8Array(encryptedBuf)),
  };
}

export async function decryptVaultData<T>(
  key: CryptoKey,
  envelope: EncryptedVaultEnvelope
): Promise<T> {
  if (!envelope || envelope.v !== 1 || envelope.alg !== 'AES-256-GCM') {
    throw new Error('Invalid AES-256-GCM vault envelope');
  }
  const subtle = getSubtle();
  const iv = base64ToBytes(envelope.ivB64);
  const ciphertext = base64ToBytes(envelope.ciphertextB64);
  const decryptedBuf = await subtle.decrypt(
    {name: 'AES-GCM', iv: iv as BufferSource},
    key,
    ciphertext as BufferSource
  );
  const jsonText = new TextDecoder().decode(decryptedBuf);
  return JSON.parse(jsonText) as T;
}

export function isEncryptedVaultEnvelope(val: unknown): val is EncryptedVaultEnvelope {
  if (!val || typeof val !== 'object') return false;
  const candidate = val as Partial<EncryptedVaultEnvelope>;
  return (
    candidate.v === 1 &&
    candidate.alg === 'AES-256-GCM' &&
    typeof candidate.ivB64 === 'string' &&
    typeof candidate.ciphertextB64 === 'string' &&
    typeof candidate.saltB64 === 'string'
  );
}

/**
 * Domain-separated PBKDF2 offline login verifier (distinct prefix from encryption key!)
 * Allows field workers who previously authenticated online to unlock their encrypted local vault
 * when 100% offline without storing their PIN in plaintext.
 */
async function computeAuthVerifierB64(
  identifier: string,
  role: 'ASHA' | 'DMO',
  secret: string,
  salt: Uint8Array
): Promise<string> {
  const subtle = getSubtle();
  const raw = new TextEncoder().encode(
    `healthsync-auth-verifier-v1|${role}|${identifier.trim().toUpperCase()}|${secret}`
  );
  const baseKey = await subtle.importKey('raw', raw, 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: 600_000, // REQUIRED FIX: Heavily tax GPU brute-force attempts
      hash: 'SHA-256',
    },
    baseKey,
    256
  );
  return bytesToBase64(new Uint8Array(bits));
}

function getStorage(): Storage | null {
  try {
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    // Ignore sandbox access errors
  }
  return null;
}

function loadVerifierMap(): Record<string, OfflineAuthVerifierRecord> {
  const storage = getStorage();
  if (!storage) return {};
  try {
    const raw = storage.getItem(OFFLINE_VERIFIERS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, OfflineAuthVerifierRecord>;
  } catch {
    return {};
  }
}

export async function saveOfflineLoginVerifier(params: {
  identifier: string;
  role: 'ASHA' | 'DMO';
  displayName: string;
  villageCode: string;
  secret: string;
}): Promise<{vaultKey: CryptoKey; salt: Uint8Array}> {
  const map = loadVerifierMap();
  const normKey = `${params.role}:${params.identifier.trim().toUpperCase()}`;
  const existingSalt = map[normKey]?.saltB64
    ? base64ToBytes(map[normKey].saltB64)
    : generateRandomSalt(16);

  const verifierB64 = await computeAuthVerifierB64(
    params.identifier,
    params.role,
    params.secret,
    existingSalt
  );

  map[normKey] = {
    identifier: params.identifier.trim(),
    role: params.role,
    displayName: params.displayName,
    villageCode: params.villageCode,
    saltB64: bytesToBase64(existingSalt),
    verifierB64,
  };

  const storage = getStorage();
  if (storage) {
    try {
      storage.setItem(OFFLINE_VERIFIERS_KEY, JSON.stringify(map));
    } catch {
      // Ignore storage quota errors
    }
  }

  const vaultKey = await deriveAesGcmVaultKey(params.identifier, params.secret, existingSalt);
  return {vaultKey, salt: existingSalt};
}

export async function verifyOfflineLogin(params: {
  identifier: string;
  role: 'ASHA' | 'DMO';
  secret: string;
}): Promise<{
  user: {identifier: string; role: 'ASHA' | 'DMO'; displayName: string; villageCode: string};
  vaultKey: CryptoKey;
  salt: Uint8Array;
}> {
  const map = loadVerifierMap();
  const normKey = `${params.role}:${params.identifier.trim().toUpperCase()}`;
  const record = map[normKey];
  if (!record) {
    throw new Error(
      'Offline login unavailable for this account on this device: connect online once to register/cache cryptographic verifier.'
    );
  }

  const salt = base64ToBytes(record.saltB64);
  const candidateB64 = await computeAuthVerifierB64(
    params.identifier,
    params.role,
    params.secret,
    salt
  );
  if (candidateB64 !== record.verifierB64) {
    throw new Error('Invalid offline PIN / password.');
  }

  const vaultKey = await deriveAesGcmVaultKey(params.identifier, params.secret, salt);
  return {
    user: {
      identifier: record.identifier,
      role: record.role,
      displayName: record.displayName,
      villageCode: record.villageCode,
    },
    vaultKey,
    salt,
  };
}
