/**
 * True Client-Side Cryptographic Storage Vault (Web Crypto API)
 * - Key Derivation: PBKDF2-HMAC-SHA256 (600,000 iterations) from strong passcode + per-user 16-byte salt
 * - Authenticated Encryption: AES-256-GCM with fresh 96-bit (12-byte) CSPRNG IV per write
 * - Hardened Offline Verifier (v2):
 *   1. Strong passcode policy (8+ chars, alphanumeric diversity, anti-common dictionary check).
 *   2. Slot keys hashed with SHA-256 (zero plaintext worker IDs or roles in localStorage keys).
 *   3. Worker profile metadata (identifier, displayName, villageCode, role) encrypted inside an AES-256-GCM
 *      envelope under `vaultKey` (zero plaintext metadata in localStorage).
 *   4. Constant-time verifier comparison + dummy 600K PBKDF2 burn for unknown/locked accounts.
 *   5. Brute-force protection: 15-minute lockout after 5 failed offline attempts; automatic slot wipe after 10 failures.
 */

export interface EncryptedVaultEnvelope {
  v: 1;
  alg: 'AES-256-GCM';
  kdf: 'PBKDF2-SHA256-600K' | 'PBKDF2-SHA256-100K';
  saltB64: string;
  ivB64: string;
  ciphertextB64: string;
}

export interface HardenedOfflineVerifierSlot {
  v: 2;
  saltB64: string;
  verifierB64: string;
  encryptedProfile: EncryptedVaultEnvelope;
  failedAttempts: number;
  lockoutUntilMs: number;
}

interface DecryptedOfflineUserProfile {
  identifier: string;
  role: 'ASHA' | 'DMO';
  displayName: string;
  villageCode: string;
}

interface LegacyOfflineVerifierRecord {
  identifier: string;
  role: 'ASHA' | 'DMO';
  displayName: string;
  villageCode: string;
  saltB64: string;
  verifierB64: string;
}

const OFFLINE_VERIFIERS_V2_KEY = 'healthsync_auth_verifiers_v2';
const LEGACY_OFFLINE_VERIFIERS_V1_KEY = 'healthsync_auth_verifiers_v1';

const OFFLINE_LOCKOUT_THRESHOLD = 5;
const OFFLINE_WIPE_THRESHOLD = 10;
const OFFLINE_LOCKOUT_DURATION_MS = 15 * 60 * 1000;

const WEAK_COMMON_PASSCODES = new Set([
  '12345678',
  '123456789',
  '1234567890',
  '87654321',
  '00000000',
  '11111111',
  'password',
  'password1',
  'password123',
  'qwerty123',
  'asha1234',
  'admin123',
  'welcome1',
  'india123',
  'health123',
  'swasthya1',
]);

export function validateClientPasscode(secret: string): {valid: boolean; error?: string} {
  const clean = String(secret || '');
  if (clean.length < 8) {
    return {
      valid: false,
      error: 'Passcode must be at least 8 characters long to protect patient records.',
    };
  }
  if (clean.length > 128) {
    return {
      valid: false,
      error: 'Passcode must not exceed 128 characters.',
    };
  }
  const hasLetter = /[A-Za-z]/.test(clean);
  const hasNumberOrSymbol = /[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(clean);
  if (!hasLetter || !hasNumberOrSymbol) {
    return {
      valid: false,
      error: 'Passcode must include both letters and at least one number or symbol.',
    };
  }
  if (/^(.)\1+$/.test(clean) || WEAK_COMMON_PASSCODES.has(clean.toLowerCase())) {
    return {
      valid: false,
      error: 'Passcode is too common or predictable. Choose a stronger passcode.',
    };
  }
  return {valid: true};
}

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

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * Constant-time byte array comparison without data-dependent branches.
 */
export function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  const maxLen = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < maxLen; i++) {
    const byteA = i < a.length ? a[i] : 0;
    const byteB = i < b.length ? b[i] : 0;
    diff |= byteA ^ byteB;
  }
  return diff === 0;
}

export function generateRandomSalt(byteLength = 16): Uint8Array {
  const salt = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(salt);
  return salt;
}

async function computeVerifierSlotId(role: 'ASHA' | 'DMO', identifier: string): Promise<string> {
  const subtle = getSubtle();
  const payload = new TextEncoder().encode(
    `healthsync-verifier-slot-v2|${role}|${identifier.trim().toUpperCase()}`
  );
  const digest = await subtle.digest('SHA-256', payload);
  return `slot_${bytesToHex(new Uint8Array(digest)).slice(0, 32)}`;
}

async function computeDummySalt(role: 'ASHA' | 'DMO', identifier: string): Promise<Uint8Array> {
  const subtle = getSubtle();
  const payload = new TextEncoder().encode(
    `healthsync-dummy-salt-v2|${role}|${identifier.trim().toUpperCase()}`
  );
  const digest = await subtle.digest('SHA-256', payload);
  return new Uint8Array(digest).slice(0, 16);
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
      iterations: 600_000,
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

async function computeAuthVerifierBytes(
  identifier: string,
  role: 'ASHA' | 'DMO',
  secret: string,
  salt: Uint8Array
): Promise<Uint8Array> {
  const subtle = getSubtle();
  const raw = new TextEncoder().encode(
    `healthsync-auth-verifier-v1|${role}|${identifier.trim().toUpperCase()}|${secret}`
  );
  const baseKey = await subtle.importKey('raw', raw, 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: 600_000,
      hash: 'SHA-256',
    },
    baseKey,
    256
  );
  return new Uint8Array(bits);
}

function getStorage(): Storage | null {
  try {
    if (
      typeof globalThis !== 'undefined' &&
      'localStorage' in globalThis &&
      globalThis.localStorage
    ) {
      return globalThis.localStorage;
    }
  } catch {
    // Ignore sandbox access errors
  }
  return null;
}

function loadV2VerifierMap(): Record<string, HardenedOfflineVerifierSlot> {
  const storage = getStorage();
  if (!storage) return {};
  try {
    const raw = storage.getItem(OFFLINE_VERIFIERS_V2_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, HardenedOfflineVerifierSlot>)
      : {};
  } catch {
    return {};
  }
}

function saveV2VerifierMap(map: Record<string, HardenedOfflineVerifierSlot>): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(OFFLINE_VERIFIERS_V2_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage quota errors
  }
}

function loadLegacyV1VerifierMap(): Record<string, LegacyOfflineVerifierRecord> {
  const storage = getStorage();
  if (!storage) return {};
  try {
    const raw = storage.getItem(LEGACY_OFFLINE_VERIFIERS_V1_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, LegacyOfflineVerifierRecord>)
      : {};
  } catch {
    return {};
  }
}

function removeLegacyV1Slot(normKey: string): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    const v1 = loadLegacyV1VerifierMap();
    if (v1[normKey]) {
      delete v1[normKey];
      if (Object.keys(v1).length === 0) {
        storage.removeItem(LEGACY_OFFLINE_VERIFIERS_V1_KEY);
      } else {
        storage.setItem(LEGACY_OFFLINE_VERIFIERS_V1_KEY, JSON.stringify(v1));
      }
    }
  } catch {
    // Ignore
  }
}

export async function saveOfflineLoginVerifier(params: {
  identifier: string;
  role: 'ASHA' | 'DMO';
  displayName: string;
  villageCode: string;
  secret: string;
}): Promise<{vaultKey: CryptoKey; salt: Uint8Array}> {
  const policy = validateClientPasscode(params.secret);
  if (!policy.valid) {
    throw new Error(policy.error);
  }

  const slotId = await computeVerifierSlotId(params.role, params.identifier);
  const v2Map = loadV2VerifierMap();
  const legacyNormKey = `${params.role}:${params.identifier.trim().toUpperCase()}`;
  const legacyMap = loadLegacyV1VerifierMap();

  const existingSalt = v2Map[slotId]?.saltB64
    ? base64ToBytes(v2Map[slotId].saltB64)
    : legacyMap[legacyNormKey]?.saltB64
    ? base64ToBytes(legacyMap[legacyNormKey].saltB64)
    : generateRandomSalt(16);

  const verifierBytes = await computeAuthVerifierBytes(
    params.identifier,
    params.role,
    params.secret,
    existingSalt
  );
  const vaultKey = await deriveAesGcmVaultKey(params.identifier, params.secret, existingSalt);

  const profilePayload: DecryptedOfflineUserProfile = {
    identifier: params.identifier.trim(),
    role: params.role,
    displayName: params.displayName,
    villageCode: params.villageCode,
  };
  const encryptedProfile = await encryptVaultData(vaultKey, existingSalt, profilePayload);

  v2Map[slotId] = {
    v: 2,
    saltB64: bytesToBase64(existingSalt),
    verifierB64: bytesToBase64(verifierBytes),
    encryptedProfile,
    failedAttempts: 0,
    lockoutUntilMs: 0,
  };
  saveV2VerifierMap(v2Map);
  removeLegacyV1Slot(legacyNormKey);

  return {vaultKey, salt: existingSalt};
}

export async function hasOfflineLoginVerifier(
  identifier: string,
  role: 'ASHA' | 'DMO'
): Promise<boolean> {
  const slotId = await computeVerifierSlotId(role, identifier);
  const v2Map = loadV2VerifierMap();
  if (v2Map[slotId]) return true;
  const legacyMap = loadLegacyV1VerifierMap();
  const normKey = `${role}:${identifier.trim().toUpperCase()}`;
  return Boolean(legacyMap[normKey]);
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
  const now = Date.now();
  const slotId = await computeVerifierSlotId(params.role, params.identifier);
  const v2Map = loadV2VerifierMap();
  const slot = v2Map[slotId];

  if (slot) {
    const salt = base64ToBytes(slot.saltB64);
    // Always run 600K PBKDF2 even when locked out so timing never leaks lockout state
    const candidateBytes = await computeAuthVerifierBytes(
      params.identifier,
      params.role,
      params.secret,
      salt
    );
    const expectedBytes = base64ToBytes(slot.verifierB64);
    const matches = timingSafeEqualBytes(candidateBytes, expectedBytes);

    if (slot.lockoutUntilMs && slot.lockoutUntilMs > now) {
      throw new Error(
        'Too many failed offline passcode attempts. Offline sign-in is temporarily locked for 15 minutes.'
      );
    }

    if (!matches) {
      const nextFailures = (slot.failedAttempts || 0) + 1;
      if (nextFailures >= OFFLINE_WIPE_THRESHOLD) {
        delete v2Map[slotId];
        saveV2VerifierMap(v2Map);
        throw new Error(
          'Maximum offline passcode failures exceeded. Local offline login verifier was wiped; reconnect online to re-authenticate.'
        );
      }
      slot.failedAttempts = nextFailures;
      if (nextFailures >= OFFLINE_LOCKOUT_THRESHOLD) {
        slot.lockoutUntilMs = now + OFFLINE_LOCKOUT_DURATION_MS;
      }
      v2Map[slotId] = slot;
      saveV2VerifierMap(v2Map);
      throw new Error('Invalid credentials.');
    }

    // Reset failure counter on verified login
    if (slot.failedAttempts > 0 || slot.lockoutUntilMs > 0) {
      slot.failedAttempts = 0;
      slot.lockoutUntilMs = 0;
      v2Map[slotId] = slot;
      saveV2VerifierMap(v2Map);
    }

    const vaultKey = await deriveAesGcmVaultKey(params.identifier, params.secret, salt);
    const decryptedProfile = await decryptVaultData<DecryptedOfflineUserProfile>(
      vaultKey,
      slot.encryptedProfile
    );

    return {
      user: decryptedProfile,
      vaultKey,
      salt,
    };
  }

  // Check non-destructive legacy v1 slot and auto-migrate if valid
  const legacyNormKey = `${params.role}:${params.identifier.trim().toUpperCase()}`;
  const legacyMap = loadLegacyV1VerifierMap();
  const legacyRecord = legacyMap[legacyNormKey];
  if (legacyRecord) {
    const salt = base64ToBytes(legacyRecord.saltB64);
    const candidateBytes = await computeAuthVerifierBytes(
      params.identifier,
      params.role,
      params.secret,
      salt
    );
    const expectedBytes = base64ToBytes(legacyRecord.verifierB64);
    if (!timingSafeEqualBytes(candidateBytes, expectedBytes)) {
      throw new Error('Invalid credentials.');
    }
    const vaultKey = await deriveAesGcmVaultKey(params.identifier, params.secret, salt);
    if (validateClientPasscode(params.secret).valid) {
      await saveOfflineLoginVerifier({
        identifier: legacyRecord.identifier,
        role: legacyRecord.role,
        displayName: legacyRecord.displayName,
        villageCode: legacyRecord.villageCode,
        secret: params.secret,
      });
    }
    return {
      user: {
        identifier: legacyRecord.identifier,
        role: legacyRecord.role,
        displayName: legacyRecord.displayName,
        villageCode: legacyRecord.villageCode,
      },
      vaultKey,
      salt,
    };
  }

  // Unknown account: burn 600K PBKDF2 iterations on deterministic dummy salt for constant-time anti-enumeration
  const dummySalt = await computeDummySalt(params.role, params.identifier);
  const dummyCandidate = await computeAuthVerifierBytes(
    params.identifier,
    params.role,
    params.secret,
    dummySalt
  );
  timingSafeEqualBytes(dummyCandidate, new Uint8Array(32));
  throw new Error(
    'Offline login unavailable for this account on this device: connect online once to register/cache cryptographic verifier.'
  );
}
