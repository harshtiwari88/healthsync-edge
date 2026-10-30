import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type {IncentiveEntry, TriageRecord} from '../types/triage.ts';

export type ServerUserRole = 'ASHA' | 'DMO';

export interface AuthenticatedUser {
  id: string;
  identifier: string;
  role: ServerUserRole;
  displayName: string;
  villageCode: string;
}

export interface SmsDispatchLog {
  id: string;
  recordId: string | null;
  toPhone: string;
  provider: string;
  status: string;
  providerMessageId: string | null;
  payloadText: string;
  errorMessage: string | null;
  createdAtMs: number;
}

function resolveWritableDbPath(requestedPath: string): string {
  if (requestedPath === ':memory:') {
    return ':memory:';
  }
  try {
    const dir = path.dirname(requestedPath);
    fs.mkdirSync(dir, {recursive: true});
    fs.accessSync(dir, fs.constants.W_OK);
    return requestedPath;
  } catch {
    const fallbackDir = path.join(os.tmpdir(), 'healthsync-edge');
    fs.mkdirSync(fallbackDir, {recursive: true});
    return path.join(fallbackDir, path.basename(requestedPath) || 'healthsync.sqlite');
  }
}

function resolveMasterKey(dbPath: string, explicitKey?: string): Buffer {
  const envKey = explicitKey ?? process.env.VAULT_ENCRYPTION_KEY;
  if (envKey && envKey.trim().length > 0) {
    return crypto.createHash('sha256').update(envKey.trim()).digest();
  }
  if (dbPath === ':memory:') {
    return crypto.createHash('sha256').update('healthsync-ephemeral-test-key').digest();
  }
  try {
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, {recursive: true});
    const keyFile = path.join(dir, '.vault_key');
    if (fs.existsSync(keyFile)) {
      const hex = fs.readFileSync(keyFile, 'utf8').trim();
      if (hex.length === 64) {
        return Buffer.from(hex, 'hex');
      }
    }
    const generated = crypto.randomBytes(32);
    fs.writeFileSync(keyFile, generated.toString('hex'), {mode: 0o600});
    return generated;
  } catch {
    return crypto.randomBytes(32);
  }
}

export class HealthSyncDatabase {
  private db: Database.Database;
  private masterKey: Buffer;

  constructor(dbPath = process.env.SQLITE_DB_PATH || './data/healthsync.sqlite', explicitKey?: string) {
    const effectivePath = resolveWritableDbPath(dbPath);
    this.masterKey = resolveMasterKey(effectivePath, explicitKey);
    this.db = new Database(effectivePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        identifier TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL CHECK(role IN ('ASHA', 'DMO')),
        display_name TEXT NOT NULL,
        village_code TEXT NOT NULL DEFAULT 'VIL-204',
        secret_salt TEXT NOT NULL,
        secret_hash TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at_ms INTEGER NOT NULL,
        created_at_ms INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS triage_records (
        id TEXT PRIMARY KEY,
        owner_identifier TEXT NOT NULL DEFAULT '',
        patient_id TEXT NOT NULL,
        village_code TEXT NOT NULL,
        severity TEXT NOT NULL,
        sync_status TEXT NOT NULL,
        dispatch_status TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        encrypted_payload TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_triage_created ON triage_records(created_at_ms DESC);

      CREATE TABLE IF NOT EXISTS incentive_entries (
        id TEXT PRIMARY KEY,
        user_identifier TEXT NOT NULL,
        task_title TEXT NOT NULL,
        program_code TEXT NOT NULL,
        patient_ref TEXT NOT NULL,
        amount_inr INTEGER NOT NULL,
        timestamp_label TEXT NOT NULL,
        abdm_verified INTEGER NOT NULL DEFAULT 1,
        created_at_ms INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sms_dispatches (
        id TEXT PRIMARY KEY,
        record_id TEXT,
        to_phone TEXT NOT NULL,
        provider TEXT NOT NULL,
        status TEXT NOT NULL,
        provider_message_id TEXT,
        payload_text TEXT NOT NULL,
        error_message TEXT,
        created_at_ms INTEGER NOT NULL
      );
    `);

    // Idempotent schema migration for pre-existing SQLite databases lacking owner_identifier
    const triageCols = this.db.prepare('PRAGMA table_info(triage_records)').all() as Array<{
      name: string;
    }>;
    if (!triageCols.some((c) => c.name === 'owner_identifier')) {
      this.db.exec("ALTER TABLE triage_records ADD COLUMN owner_identifier TEXT NOT NULL DEFAULT ''");
    }
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_triage_owner ON triage_records(owner_identifier)');
  }

  public encryptPhi(data: unknown): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKey, iv);
    const plaintext = Buffer.from(JSON.stringify(data), 'utf8');
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  public decryptPhi<T>(envelope: string): T {
    const parts = envelope.split(':');
    if (parts.length !== 4 || parts[0] !== 'v1') {
      throw new Error('Malformed AES-256-GCM envelope');
    }
    const iv = Buffer.from(parts[1], 'hex');
    const tag = Buffer.from(parts[2], 'hex');
    const ciphertext = Buffer.from(parts[3], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.masterKey, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8')) as T;
  }

  public getRawEncryptedRecordBlob(id: string): string | null {
    const row = this.db
      .prepare('SELECT encrypted_payload FROM triage_records WHERE id = ?')
      .get(id) as {encrypted_payload: string} | undefined;
    return row ? row.encrypted_payload : null;
  }

  private normalizeIdentifier(identifier: string, role: ServerUserRole): string {
    const trimmed = identifier.trim();
    return role === 'DMO' ? trimmed.toLowerCase() : trimmed.toUpperCase();
  }

  private hashSecretAsync(secret: string, saltHex: string): Promise<Buffer> {
    const saltBuffer = Buffer.from(saltHex, 'hex');
    return new Promise((resolve, reject) => {
      crypto.scrypt(secret, saltBuffer, 64, (err, derivedKey) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(derivedKey);
      });
    });
  }

  public countUsers(): number {
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM users').get() as {cnt: number};
    return row.cnt;
  }

  public async registerUser(params: {
    identifier: string;
    secret: string;
    role: ServerUserRole;
    displayName: string;
    villageCode?: string;
  }): Promise<AuthenticatedUser> {
    const normalizedId = this.normalizeIdentifier(params.identifier, params.role);
    if (!normalizedId) {
      throw new Error('Account identifier is required.');
    }
    const minLen = params.role === 'ASHA' ? 4 : 6;
    if (!params.secret || params.secret.length < minLen) {
      throw new Error(
        params.role === 'ASHA'
          ? 'ASHA Security PIN must be at least 4 characters.'
          : 'DMO password must be at least 6 characters.'
      );
    }

    const existing = this.db
      .prepare('SELECT id FROM users WHERE identifier = ?')
      .get(normalizedId);
    if (existing) {
      throw new Error(`Account "${normalizedId}" is already registered. Please sign in.`);
    }

    const id = `usr-${crypto.randomUUID()}`;
    const saltHex = crypto.randomBytes(16).toString('hex');
    const derivedKey = await this.hashSecretAsync(params.secret, saltHex);
    const hashHex = derivedKey.toString('hex');
    const villageCode = (params.villageCode || 'VIL-204').trim() || 'VIL-204';
    const displayName =
      params.displayName.trim() ||
      (params.role === 'ASHA' ? `ASHA Worker (${normalizedId})` : `District Officer (${normalizedId})`);

    try {
      this.db
        .prepare(
          `INSERT INTO users (id, identifier, role, display_name, village_code, secret_salt, secret_hash, created_at_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(id, normalizedId, params.role, displayName, villageCode, saltHex, hashHex, Date.now());
    } catch (err) {
      if (err instanceof Error && err.message.includes('UNIQUE')) {
        throw new Error(`Account "${normalizedId}" is already registered. Please sign in.`);
      }
      throw err;
    }

    return {
      id,
      identifier: normalizedId,
      role: params.role,
      displayName,
      villageCode,
    };
  }

  public async authenticateUser(
    identifier: string,
    secret: string,
    expectedRole: ServerUserRole
  ): Promise<{token: string; user: AuthenticatedUser; expiresAtMs: number}> {
    const normalizedId = this.normalizeIdentifier(identifier, expectedRole);
    const row = this.db
      .prepare(
        `SELECT id, identifier, role, display_name, village_code, secret_salt, secret_hash
         FROM users WHERE identifier = ? AND role = ?`
      )
      .get(normalizedId, expectedRole) as
      | {
          id: string;
          identifier: string;
          role: ServerUserRole;
          display_name: string;
          village_code: string;
          secret_salt: string;
          secret_hash: string;
        }
      | undefined;

    if (!row) {
      throw new Error('Invalid credentials or unregistered account.');
    }

    const candidateHash = await this.hashSecretAsync(secret, row.secret_salt);
    const storedHash = Buffer.from(row.secret_hash, 'hex');
    if (
      candidateHash.length !== storedHash.length ||
      !crypto.timingSafeEqual(candidateHash, storedHash)
    ) {
      throw new Error('Invalid credentials or unregistered account.');
    }

    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const now = Date.now();
    const expiresAtMs = now + 7 * 24 * 60 * 60 * 1000;

    this.db
      .prepare(
        `INSERT INTO sessions (token_hash, user_id, expires_at_ms, created_at_ms)
         VALUES (?, ?, ?, ?)`
      )
      .run(tokenHash, row.id, expiresAtMs, now);

    return {
      token: rawToken,
      expiresAtMs,
      user: {
        id: row.id,
        identifier: row.identifier,
        role: row.role,
        displayName: row.display_name,
        villageCode: row.village_code,
      },
    };
  }

  public verifySessionToken(rawToken: string | undefined | null): AuthenticatedUser | null {
    if (!rawToken || typeof rawToken !== 'string') return null;
    const tokenHash = crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
    const row = this.db
      .prepare(
        `SELECT s.expires_at_ms, u.id, u.identifier, u.role, u.display_name, u.village_code
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?`
      )
      .get(tokenHash) as
      | {
          expires_at_ms: number;
          id: string;
          identifier: string;
          role: ServerUserRole;
          display_name: string;
          village_code: string;
        }
      | undefined;

    if (!row) return null;
    if (row.expires_at_ms < Date.now()) {
      this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
      return null;
    }

    return {
      id: row.id,
      identifier: row.identifier,
      role: row.role,
      displayName: row.display_name,
      villageCode: row.village_code,
    };
  }

  public revokeSessionToken(rawToken: string | undefined | null): void {
    if (!rawToken) return;
    const tokenHash = crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  public upsertRecord(record: TriageRecord, ownerIdentifier = ''): TriageRecord {
    const encryptedPayload = this.encryptPhi(record);
    const cleanOwner = ownerIdentifier.trim();
    this.db
      .prepare(
        `INSERT INTO triage_records (
          id, owner_identifier, patient_id, village_code, severity, sync_status, dispatch_status, created_at_ms, encrypted_payload
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          owner_identifier = CASE
            WHEN triage_records.owner_identifier != '' THEN triage_records.owner_identifier
            ELSE excluded.owner_identifier
          END,
          patient_id = excluded.patient_id,
          village_code = excluded.village_code,
          severity = excluded.severity,
          sync_status = excluded.sync_status,
          dispatch_status = excluded.dispatch_status,
          created_at_ms = excluded.created_at_ms,
          encrypted_payload = excluded.encrypted_payload`
      )
      .run(
        record.id,
        cleanOwner,
        record.patientId,
        record.villageCode,
        record.severity,
        record.syncStatus,
        record.dispatchStatus,
        record.createdAtMs || Date.now(),
        encryptedPayload
      );
    return record;
  }

  public getRecordById(id: string): TriageRecord | null {
    const row = this.db
      .prepare('SELECT encrypted_payload FROM triage_records WHERE id = ?')
      .get(id) as {encrypted_payload: string} | undefined;
    if (!row) return null;
    return this.decryptPhi<TriageRecord>(row.encrypted_payload);
  }

  public getRecordWithOwner(id: string): {record: TriageRecord; ownerIdentifier: string} | null {
    const row = this.db
      .prepare('SELECT owner_identifier, encrypted_payload FROM triage_records WHERE id = ?')
      .get(id) as {owner_identifier: string; encrypted_payload: string} | undefined;
    if (!row) return null;
    return {
      record: this.decryptPhi<TriageRecord>(row.encrypted_payload),
      ownerIdentifier: row.owner_identifier || '',
    };
  }

  // REQUIRED FIX: Enforce limits to prevent synchronous decryption from blocking the Node event loop
  public listRecords(limit = 500): TriageRecord[] {
    const rows = this.db
      .prepare('SELECT encrypted_payload FROM triage_records ORDER BY created_at_ms DESC LIMIT ?')
      .all(limit) as Array<{encrypted_payload: string}>;

    const out: TriageRecord[] = [];
    for (const row of rows) {
      try {
        out.push(this.decryptPhi<TriageRecord>(row.encrypted_payload));
      } catch (err) {
        console.error('[HealthSync DB] Corrupted or undecryptable triage record skipped:', err);
      }
    }
    return out;
  }

  public listRecordsForUser(user: AuthenticatedUser, limit = 500): TriageRecord[] {
    if (user.role === 'DMO') {
      return this.listRecords(limit);
    }
    const rows = this.db
      .prepare(
        'SELECT encrypted_payload FROM triage_records WHERE owner_identifier = ? ORDER BY created_at_ms DESC LIMIT ?'
      )
      .all(user.identifier, limit) as Array<{encrypted_payload: string}>;

    const out: TriageRecord[] = [];
    for (const row of rows) {
      try {
        out.push(this.decryptPhi<TriageRecord>(row.encrypted_payload));
      } catch (err) {
        console.error('[HealthSync DB] Corrupted or undecryptable user triage record skipped:', err);
      }
    }
    return out;
  }

  public insertIncentive(entry: IncentiveEntry, userIdentifier: string): IncentiveEntry {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO incentive_entries (
          id, user_identifier, task_title, program_code, patient_ref, amount_inr, timestamp_label, abdm_verified, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.id,
        userIdentifier.toUpperCase(),
        entry.taskTitle,
        entry.programCode,
        entry.patientRef,
        entry.amountInr,
        entry.timestamp,
        entry.abdmVerified ? 1 : 0,
        Date.now()
      );
    return entry;
  }

  public listIncentives(userIdentifier?: string): IncentiveEntry[] {
    const rows = userIdentifier
      ? (this.db
          .prepare(
            `SELECT id, task_title, program_code, patient_ref, amount_inr, timestamp_label, abdm_verified
             FROM incentive_entries
             WHERE user_identifier = ? OR user_identifier = 'SEED'
             ORDER BY created_at_ms DESC`
          )
          .all(userIdentifier.toUpperCase()) as Array<{
          id: string;
          task_title: string;
          program_code: string;
          patient_ref: string;
          amount_inr: number;
          timestamp_label: string;
          abdm_verified: number;
        }>)
      : (this.db
          .prepare(
            `SELECT id, task_title, program_code, patient_ref, amount_inr, timestamp_label, abdm_verified
             FROM incentive_entries
             ORDER BY created_at_ms DESC`
          )
          .all() as Array<{
          id: string;
          task_title: string;
          program_code: string;
          patient_ref: string;
          amount_inr: number;
          timestamp_label: string;
          abdm_verified: number;
        }>);

    return rows.map((r) => ({
      id: r.id,
      taskTitle: r.task_title,
      programCode: r.program_code,
      patientRef: r.patient_ref,
      amountInr: r.amount_inr,
      timestamp: r.timestamp_label,
      abdmVerified: Boolean(r.abdm_verified),
    }));
  }

  public seedInitialDataIfEmpty(
    seedRecords: TriageRecord[],
    seedIncentives: IncentiveEntry[]
  ): void {
    const recCount = (
      this.db.prepare('SELECT COUNT(*) as cnt FROM triage_records').get() as {cnt: number}
    ).cnt;
    if (recCount === 0) {
      const tx = this.db.transaction(() => {
        for (const rec of seedRecords) {
          this.upsertRecord(rec);
        }
      });
      tx();
    }

    const incCount = (
      this.db.prepare('SELECT COUNT(*) as cnt FROM incentive_entries').get() as {cnt: number}
    ).cnt;
    if (incCount === 0) {
      const tx = this.db.transaction(() => {
        for (const inc of seedIncentives) {
          this.insertIncentive(inc, 'SEED');
        }
      });
      tx();
    }
  }

  public logSmsDispatch(entry: Omit<SmsDispatchLog, 'id' | 'createdAtMs'>): SmsDispatchLog {
    const full: SmsDispatchLog = {
      id: `sms-${crypto.randomUUID()}`,
      createdAtMs: Date.now(),
      ...entry,
    };
    this.db
      .prepare(
        `INSERT INTO sms_dispatches (
          id, record_id, to_phone, provider, status, provider_message_id, payload_text, error_message, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        full.id,
        full.recordId,
        full.toPhone,
        full.provider,
        full.status,
        full.providerMessageId,
        full.payloadText,
        full.errorMessage,
        full.createdAtMs
      );
    return full;
  }

  public hasSmsDispatchForRecord(recordId: string, provider = 'inbound_webhook'): boolean {
    const row = this.db
      .prepare('SELECT id FROM sms_dispatches WHERE record_id = ? AND provider = ? LIMIT 1')
      .get(recordId, provider) as {id: string} | undefined;
    return Boolean(row);
  }

  public listSmsDispatches(limit = 50): SmsDispatchLog[] {
    const rows = this.db
      .prepare(
        `SELECT id, record_id, to_phone, provider, status, provider_message_id, payload_text, error_message, created_at_ms
         FROM sms_dispatches
         ORDER BY created_at_ms DESC
         LIMIT ?`
      )
      .all(limit) as Array<{
      id: string;
      record_id: string | null;
      to_phone: string;
      provider: string;
      status: string;
      provider_message_id: string | null;
      payload_text: string;
      error_message: string | null;
      created_at_ms: number;
    }>;

    return rows.map((r) => ({
      id: r.id,
      recordId: r.record_id,
      toPhone: r.to_phone,
      provider: r.provider,
      status: r.status,
      providerMessageId: r.provider_message_id,
      payloadText: r.payload_text,
      errorMessage: r.error_message,
      createdAtMs: r.created_at_ms,
    }));
  }

  public close(): void {
    this.db.close();
  }
}
