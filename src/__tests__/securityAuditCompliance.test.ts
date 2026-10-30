import Database from 'better-sqlite3';
import fs from 'fs';
import {AddressInfo} from 'net';
import os from 'os';
import path from 'path';
import {afterEach, describe, expect, it} from 'vitest';
import {createHealthSyncServer, resolveTrustProxySetting} from '../../server';
import {HealthSyncDatabase, VaultConfigurationError} from '../server/db';
import {ServerlessPersistenceError} from '../server/durableRemoteStore';
import {anonymizePersonalIdentifiers, buildHardenedClinicalPrompt} from '../server/geminiService';
import {encodeVitalsToSMS} from '../utils/binarySmsCodec';
import {
  fetchCareSummaryWithFallback,
  persistActiveAuthToken,
  resolveActiveAuthToken,
} from '../utils/clinicalSummaryClient';
import {TriageRecord} from '../types/triage';

function makeValidEmergencyRecord(id: string, age = 32): TriageRecord {
  const vitals = {
    systolic: 172,
    diastolic: 108,
    spo2: 86,
    temperature: 101.8,
    heartRate: 118,
  };
  return {
    id,
    patientId: 'PT4001',
    abhaId: '91-4400-5500-6600',
    patientName: 'Sunita Kumari',
    age,
    gender: 'F',
    villageCode: 'VIL-204',
    villageName: 'Rampur Kalan Health Sub-Center',
    ashaWorker: 'Meera Devi (ASHA-5501-UP)',
    vitals,
    symptoms: ['Fever', 'Severe Chest Pain'],
    severity: 'emergency',
    clinicalNotes: 'Chest pain and low oxygen',
    channel: 'Emergency SMS',
    syncStatus: 'SMS Delivered',
    binarySmsPayload: encodeVitalsToSMS({
      patientId: 'PT4001',
      ashaId: 'ASHA-5501-UP',
      villageCode: 'VIL-204',
      vitals,
      symptoms: ['Fever', 'Severe Chest Pain'],
      severity: 'emergency',
    }),
    timestamp: '11:15 AM',
    createdAtMs: Date.now(),
    dispatchStatus: 'Unassigned',
  };
}

describe('Comprehensive Security Audit & DPDP Compliance Suite (All 11 Categories)', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, {recursive: true, force: true});
    }
  });

  it('1. DPDP Compliance: enforces Section 9 minor guardian consent, Section 8 patient erasure, tamper-resistant hash-chained audit logs, breach reporting, and Gemini PII anonymization', async () => {
    const prevDmo = process.env.DMO_PROVISIONING_SECRET;
    const prevAsha = process.env.ASHA_ENROLLMENT_SECRET;
    process.env.DMO_PROVISIONING_SECRET = 'DPDP-Admin-Provision-Secret-2026!';
    process.env.ASHA_ENROLLMENT_SECRET = 'DPDP-Clinic-Enrollment-Secret-2026!';

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'healthsync-dpdp-test-'));
    tempDirs.push(tmpDir);
    const dbFile = path.join(tmpDir, 'dpdp.sqlite');
    const db = new HealthSyncDatabase(dbFile, 'dpdp-test-vault-encryption-key-256-bits!');
    const {httpServer} = await createHealthSyncServer(db);
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
    const port = (httpServer.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // Register verified ASHA & DMO
      const ashaRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          identifier: 'ASHA-5501-UP',
          secret: 'MeeraSafe#2026',
          role: 'ASHA',
          displayName: 'Meera Devi',
          villageCode: 'VIL-204',
          ashaEnrollmentCode: 'DPDP-Clinic-Enrollment-Secret-2026!',
        }),
      });
      expect(ashaRes.status).toBe(201);
      const {token: ashaToken} = (await ashaRes.json()) as {token: string};

      const dmoRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          identifier: 'dmo.dpdp@district24.gov.in',
          secret: 'OfficerSafe#2026',
          role: 'DMO',
          displayName: 'Dr. Ananya Rao',
          dmoProvisioningCode: 'DPDP-Admin-Provision-Secret-2026!',
        }),
      });
      expect(dmoRes.status).toBe(201);
      const {token: dmoToken} = (await dmoRes.json()) as {token: string};

      // A) Minor patient (age 14) WITHOUT guardian consent MUST be rejected with 400
      const minorWithoutConsent = makeValidEmergencyRecord('rec-minor-no-consent', 14);
      const rejectMinorRes = await fetch(`${baseUrl}/api/records`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ashaToken}`,
        },
        body: JSON.stringify({record: minorWithoutConsent}),
      });
      expect(rejectMinorRes.status).toBe(400);
      const rejectMinorJson = (await rejectMinorRes.json()) as {error: string};
      expect(rejectMinorJson.error).toContain('DPDP Section 9');

      // B) Minor patient WITH verifiable parent/guardian consent succeeds and encrypts guardian PII at rest
      const minorWithConsent: TriageRecord = {
        ...makeValidEmergencyRecord('rec-minor-valid-consent', 12),
        patientConsent: {
          isMinor: true,
          guardianName: 'Ramesh Kumar',
          guardianRelationship: 'Father',
          verifiableGuardianConsent: true,
          consentGranted: true,
          consentTimestampMs: Date.now(),
          lawfulBasis: 'explicit_consent',
        },
      };
      const saveMinorRes = await fetch(`${baseUrl}/api/records`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ashaToken}`,
        },
        body: JSON.stringify({record: minorWithConsent}),
      });
      expect(saveMinorRes.status).toBe(201);

      const rawSqlite = new Database(dbFile, {readonly: true});
      const consentRow = rawSqlite
        .prepare(
          'SELECT is_minor, verifiable_consent, guardian_name_encrypted FROM consent_records WHERE record_id = ?'
        )
        .get('rec-minor-valid-consent') as {
        is_minor: number;
        verifiable_consent: number;
        guardian_name_encrypted: string;
      };
      expect(consentRow.is_minor).toBe(1);
      expect(consentRow.verifiable_consent).toBe(1);
      expect(consentRow.guardian_name_encrypted).not.toContain('Ramesh Kumar');
      rawSqlite.close();

      // C) Gemini PII Anonymization: patient names, phones, and ABHA IDs are scrubbed unless adult explicit consent exists
      const scrubbed = anonymizePersonalIdentifiers(
        'Patient Sunita Kumari ABHA 91-4400-5500-6600 phone +919876543210 has fever',
        'Sunita Kumari'
      );
      expect(scrubbed).not.toContain('Sunita');
      expect(scrubbed).not.toContain('Kumari');
      expect(scrubbed).not.toContain('91-4400-5500-6600');
      expect(scrubbed).not.toContain('9876543210');

      const defaultPrompt = buildHardenedClinicalPrompt({
        patientName: 'Sunita Kumari',
        age: 12,
        explicitAiConsent: true, // Even if true, minors (<18) are ALWAYS anonymized!
        lawfulBasis: 'explicit_consent',
        vitals: minorWithConsent.vitals,
        symptoms: ['Fever'],
        transcript: 'Sunita Kumari phone 9876543210 has high fever',
      });
      expect(defaultPrompt.anonymized).toBe(true);
      expect(defaultPrompt.prompt).toContain(
        '<untrusted_patient_label data_only="true">ANONYMIZED_PATIENT</untrusted_patient_label>'
      );
      expect(defaultPrompt.prompt).not.toContain('Sunita');
      expect(defaultPrompt.prompt).not.toContain('9876543210');

      // D) DPDP Section 8 Erasure: ASHA cannot delete (403); DMO deletes permanently with audit log
      const ashaDeleteAttempt = await fetch(`${baseUrl}/api/records/rec-minor-valid-consent`, {
        method: 'DELETE',
        headers: {Authorization: `Bearer ${ashaToken}`},
      });
      expect(ashaDeleteAttempt.status).toBe(403);

      const dmoDeleteRes = await fetch(`${baseUrl}/api/records/rec-minor-valid-consent`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${dmoToken}`,
        },
        body: JSON.stringify({reason: 'Parent requested erasure under DPDP Section 8'}),
      });
      expect(dmoDeleteRes.status).toBe(200);
      expect(db.getRecordWithOwner('rec-minor-valid-consent')).toBeNull();

      // E) Data Breach Reporting endpoint (DPDP Section 8(6))
      const breachRes = await fetch(`${baseUrl}/api/compliance/breach-report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${dmoToken}`,
        },
        body: JSON.stringify({
          severity: 'high',
          incidentType: 'Lost field tablet reported in Rampur sub-center',
          affectedRecordsEstimate: 4,
          description: 'Device lost during monsoon transit; local AES-256-GCM vault was locked.',
          containmentActions: 'Revoked all active sessions via logout-all and rotated credentials.',
          dpbNotified: true,
          affectedPrincipalsNotified: true,
        }),
      });
      expect(breachRes.status).toBe(201);
      const breachBody = (await breachRes.json()) as {
        statutoryObligations: {dataProtectionBoardDeadlineHours: number};
      };
      expect(breachBody.statutoryObligations.dataProtectionBoardDeadlineHours).toBe(72);

      // F) Tamper-Resistant Hash-Chained Audit Logs + SQLite Immutability Triggers
      const auditRes = await fetch(`${baseUrl}/api/compliance/audit-logs`, {
        headers: {Authorization: `Bearer ${dmoToken}`},
      });
      expect(auditRes.status).toBe(200);
      const auditJson = (await auditRes.json()) as {
        integrity: {valid: boolean; checkedEntries: number};
        logs: Array<{action: string; ipHash: string | null}>;
      };
      expect(auditJson.integrity.valid).toBe(true);
      expect(auditJson.integrity.checkedEntries).toBeGreaterThanOrEqual(5);
      expect(auditJson.logs.some((l) => l.action === 'DPDP_PATIENT_RECORD_ERASED')).toBe(true);
      expect(auditJson.logs.some((l) => l.action === 'DPDP_BREACH_REPORT_FILED')).toBe(true);
      // Confirm IP addresses are hashed (never raw 127.0.0.1)
      expect(JSON.stringify(auditJson.logs)).not.toContain('127.0.0.1');

      const rwSqlite = new Database(dbFile);
      expect(() =>
        rwSqlite.prepare("UPDATE audit_logs SET action = 'TAMPERED' WHERE seq = 1").run()
      ).toThrow(/immutable/);
      expect(() => rwSqlite.prepare('DELETE FROM audit_logs WHERE seq = 1').run()).toThrow(
        /cannot be deleted/
      );
      rwSqlite.close();
    } finally {
      if (prevDmo === undefined) delete process.env.DMO_PROVISIONING_SECRET;
      else process.env.DMO_PROVISIONING_SECRET = prevDmo;
      if (prevAsha === undefined) delete process.env.ASHA_ENROLLMENT_SECRET;
      else process.env.ASHA_ENROLLMENT_SECRET = prevAsha;
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      db.close();
    }
  });

  it('2, 3, 4 & 5. Enforces ASHA verification gate, server-side incentive ownership, SMS recipient allowlist + CRC validation, and dedicated API rate limits', async () => {
    const prevDmo = process.env.DMO_PROVISIONING_SECRET;
    const prevAsha = process.env.ASHA_ENROLLMENT_SECRET;
    const prevPhone = process.env.DMO_EMERGENCY_PHONE;
    process.env.DMO_PROVISIONING_SECRET = 'District24-DMO-Verify-Secret-2026!';
    process.env.ASHA_ENROLLMENT_SECRET = 'District24-ASHA-Verify-Secret-2026!';
    process.env.DMO_EMERGENCY_PHONE = '+9118001801104';

    const {WebSocket: WsClient} = await import('ws');
    const db = new HealthSyncDatabase(':memory:', 'verify-sms-rate-key-32-chars-minimum!');
    const {httpServer} = await createHealthSyncServer(db);
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
    const port = (httpServer.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;
    const wsUrl = `ws://127.0.0.1:${port}/ws/triage`;

    try {
      // Invalid villageCode or invalid displayName rejected at registration (400)
      const badVillageRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          identifier: 'ASHA-BAD-1',
          secret: 'ValidPass#2026',
          role: 'ASHA',
          displayName: 'Valid Name',
          villageCode: 'FAKE-999',
        }),
      });
      expect(badVillageRes.status).toBe(400);

      const badNameRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          identifier: 'ASHA-BAD-2',
          secret: 'ValidPass#2026',
          role: 'ASHA',
          displayName: '<script>alert(1)</script>',
          villageCode: 'VIL-204',
        }),
      });
      expect(badNameRes.status).toBe(400);

      // Register UNVERIFIED ASHA (no enrollment code)
      const unverifiedRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          identifier: 'ASHA-UNVERIFIED-1',
          secret: 'PendingPass#2026',
          role: 'ASHA',
          displayName: 'Pooja Devi',
          villageCode: 'VIL-204',
        }),
      });
      expect(unverifiedRes.status).toBe(201);
      const unverifiedBody = (await unverifiedRes.json()) as {
        token: string;
        user: {isVerified: boolean};
      };
      expect(unverifiedBody.user.isVerified).toBe(false);

      // Unverified ASHA is blocked (403) from submitting emergency records, incentives, SMS, and WebSockets
      const fakeEmergRec = makeValidEmergencyRecord('rec-fake-emergency');
      const blockedRecRes = await fetch(`${baseUrl}/api/records`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${unverifiedBody.token}`,
        },
        body: JSON.stringify({record: fakeEmergRec, triggerEmergencySiren: true}),
      });
      expect(blockedRecRes.status).toBe(403);

      const blockedSmsRes = await fetch(`${baseUrl}/api/sms/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${unverifiedBody.token}`,
        },
        body: JSON.stringify({payloadText: fakeEmergRec.binarySmsPayload}),
      });
      expect(blockedSmsRes.status).toBe(403);

      const wsRejectedForUnverified = await new Promise<boolean>((resolve) => {
        const ws = new WsClient(wsUrl);
        ws.on('open', () => {
          ws.send(JSON.stringify({type: 'auth', token: unverifiedBody.token}));
        });
        ws.on('message', (raw) => {
          const msg = JSON.parse(String(raw)) as {type?: string};
          if (msg.type === 'auth:error') {
            ws.close();
            resolve(true);
          }
        });
        ws.on('close', (code) => {
          if (code === 4003) resolve(true);
        });
      });
      expect(wsRejectedForUnverified).toBe(true);

      // Provision DMO and approve ASHA-UNVERIFIED-1 via /api/auth/asha/:identifier/verify
      const dmoRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          identifier: 'dmo.verify@district24.gov.in',
          secret: 'DoctorVerify#2026',
          role: 'DMO',
          displayName: 'Dr. S. Kulkarni',
          dmoProvisioningCode: 'District24-DMO-Verify-Secret-2026!',
        }),
      });
      const {token: dmoToken} = (await dmoRes.json()) as {token: string};

      const pendingListRes = await fetch(`${baseUrl}/api/auth/asha/pending`, {
        headers: {Authorization: `Bearer ${dmoToken}`},
      });
      const pendingList = (await pendingListRes.json()) as {
        pending: Array<{identifier: string}>;
      };
      expect(pendingList.pending.some((p) => p.identifier === 'ASHA-UNVERIFIED-1')).toBe(true);

      const approveRes = await fetch(`${baseUrl}/api/auth/asha/ASHA-UNVERIFIED-1/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${dmoToken}`,
        },
        body: JSON.stringify({verified: true}),
      });
      expect(approveRes.status).toBe(200);

      // Now verified ASHA can save her emergency record
      const allowedRecRes = await fetch(`${baseUrl}/api/records`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${unverifiedBody.token}`,
        },
        body: JSON.stringify({record: fakeEmergRec, triggerEmergencySiren: true}),
      });
      expect(allowedRecRes.status).toBe(201);

      // 4. SMS API Security: arbitrary `toPhone` override MUST be rejected with 403
      const hijackSmsRes = await fetch(`${baseUrl}/api/sms/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${unverifiedBody.token}`,
        },
        body: JSON.stringify({
          payloadText: fakeEmergRec.binarySmsPayload,
          toPhone: '+15550009999', // Unauthorized premium/external phone number
        }),
      });
      expect(hijackSmsRes.status).toBe(403);

      // Non-emergency or malformed SMS payload MUST be rejected with 400
      const routineSms = encodeVitalsToSMS({
        patientId: 'PT4002',
        villageCode: 'VIL-204',
        vitals: {systolic: 118, diastolic: 78, spo2: 98, temperature: 98.6, heartRate: 74},
        symptoms: [],
        severity: 'routine',
      });
      const nonEmergSmsRes = await fetch(`${baseUrl}/api/sms/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${unverifiedBody.token}`,
        },
        body: JSON.stringify({payloadText: routineSms}),
      });
      expect(nonEmergSmsRes.status).toBe(403);

      // Valid emergency SMS to default hospital number succeeds once, and duplicate recordId is blocked (409)
      const validSmsRes = await fetch(`${baseUrl}/api/sms/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${unverifiedBody.token}`,
        },
        body: JSON.stringify({
          payloadText: fakeEmergRec.binarySmsPayload,
          recordId: fakeEmergRec.id,
        }),
      });
      expect(validSmsRes.status).toBe(200);

      const dupSmsRes = await fetch(`${baseUrl}/api/sms/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${unverifiedBody.token}`,
        },
        body: JSON.stringify({
          payloadText: fakeEmergRec.binarySmsPayload,
          recordId: fakeEmergRec.id,
        }),
      });
      expect(dupSmsRes.status).toBe(409);

      // 5. Dedicated SMS rate limit (5 per 15 min per verified user -> 5th succeeds, 6th returns 429)
      const fifthVerifiedSms = await fetch(`${baseUrl}/api/sms/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${unverifiedBody.token}`,
        },
        body: JSON.stringify({payloadText: fakeEmergRec.binarySmsPayload}),
      });
      expect(fifthVerifiedSms.status).toBe(200);

      const hit429Sms = await fetch(`${baseUrl}/api/sms/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${unverifiedBody.token}`,
        },
        body: JSON.stringify({payloadText: fakeEmergRec.binarySmsPayload}),
      });
      expect(hit429Sms.status).toBe(429);
    } finally {
      if (prevDmo === undefined) delete process.env.DMO_PROVISIONING_SECRET;
      else process.env.DMO_PROVISIONING_SECRET = prevDmo;
      if (prevAsha === undefined) delete process.env.ASHA_ENROLLMENT_SECRET;
      else process.env.ASHA_ENROLLMENT_SECRET = prevAsha;
      if (prevPhone === undefined) delete process.env.DMO_EMERGENCY_PHONE;
      else process.env.DMO_EMERGENCY_PHONE = prevPhone;
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      db.close();
    }
  });

  it('6, 7, 8, 9, 10 & 11. Enforces Helmet security headers, session rotation, logout-all-devices, account lockout, key continuity, serverless safety, and local self-hosted fonts', async () => {
    const prevAsha = process.env.ASHA_ENROLLMENT_SECRET;
    process.env.ASHA_ENROLLMENT_SECRET = 'Headers-Session-Clinic-Secret-2026!';

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'healthsync-key-continuity-'));
    tempDirs.push(tmpDir);
    const keyContinuityDbFile = path.join(tmpDir, 'continuity.sqlite');

    // 10A) Key Continuity Check: Opening an existing encrypted DB with a different VAULT_ENCRYPTION_KEY MUST fail closed
    const dbInitial = new HealthSyncDatabase(
      keyContinuityDbFile,
      'Original-Master-Vault-Encryption-Key-32Chars!'
    );
    dbInitial.close();

    expect(
      () =>
        new HealthSyncDatabase(
          keyContinuityDbFile,
          'Different-Accidental-Rotated-Vault-Key-32Chars!'
        )
    ).toThrow(VaultConfigurationError);

    // 10B) Production, Cloud Run & Serverless Startup Validation
    const prevNodeEnv = process.env.NODE_ENV;
    const prevVaultKey = process.env.VAULT_ENCRYPTION_KEY;
    const prevReqKey = process.env.REQUIRE_VAULT_KEY;
    const prevVercel = process.env.VERCEL;
    const prevTursoUrl = process.env.TURSO_DATABASE_URL;
    try {
      // Cloud Run production container without VAULT_ENCRYPTION_KEY boots cleanly using co-located .vault_key
      process.env.NODE_ENV = 'production';
      delete process.env.VAULT_ENCRYPTION_KEY;
      delete process.env.REQUIRE_VAULT_KEY;
      const cloudRunDir = path.join(tmpDir, 'cloudrun-boot');
      const cloudRunDbPath = path.join(cloudRunDir, 'healthsync.sqlite');
      const cloudRunDb = new HealthSyncDatabase(cloudRunDbPath);
      cloudRunDb.close();

      // Deleting .vault_key when encrypted metadata already exists MUST fail closed (never overwrite key!)
      fs.unlinkSync(path.join(cloudRunDir, '.vault_key'));
      expect(() => new HealthSyncDatabase(cloudRunDbPath)).toThrow(VaultConfigurationError);

      // Short VAULT_ENCRYPTION_KEY (< 32 chars) or REQUIRE_VAULT_KEY=true without key MUST fail closed
      process.env.VAULT_ENCRYPTION_KEY = 'too-short-key';
      expect(() => new HealthSyncDatabase(path.join(tmpDir, 'short-key.sqlite'))).toThrow(
        VaultConfigurationError
      );
      delete process.env.VAULT_ENCRYPTION_KEY;
      process.env.REQUIRE_VAULT_KEY = 'true';
      expect(() => new HealthSyncDatabase(path.join(tmpDir, 'strict-no-key.sqlite'))).toThrow(
        VaultConfigurationError
      );
      delete process.env.REQUIRE_VAULT_KEY;

      process.env.VAULT_ENCRYPTION_KEY = 'Valid-Production-Vault-Master-Key-2026-Secure!';
      process.env.VERCEL = '1';
      delete process.env.TURSO_DATABASE_URL;
      expect(() => new HealthSyncDatabase('/tmp/healthsync.sqlite')).toThrow(
        ServerlessPersistenceError
      );
      expect(resolveTrustProxySetting()).toBe(1);
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
      if (prevVaultKey === undefined) delete process.env.VAULT_ENCRYPTION_KEY;
      else process.env.VAULT_ENCRYPTION_KEY = prevVaultKey;
      if (prevReqKey === undefined) delete process.env.REQUIRE_VAULT_KEY;
      else process.env.REQUIRE_VAULT_KEY = prevReqKey;
      if (prevVercel === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = prevVercel;
      if (prevTursoUrl === undefined) delete process.env.TURSO_DATABASE_URL;
      else process.env.TURSO_DATABASE_URL = prevTursoUrl;
    }

    // 11) Privacy: Confirm zero Google Fonts CDN URLs remain in index.html
    const indexHtml = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
    expect(indexHtml).not.toContain('fonts.googleapis.com');
    expect(indexHtml).not.toContain('fonts.gstatic.com');

    // 7, 8 & 9) Helmet headers, sensitive info protection, session rotation, logout-all, and 8-failure account lockout
    const db = new HealthSyncDatabase(':memory:', 'session-headers-test-key-32-chars-min!');
    const {httpServer} = await createHealthSyncServer(db);
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
    const port = (httpServer.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const healthRes = await fetch(`${baseUrl}/api/health`);
      expect(healthRes.status).toBe(200);
      // Verify Helmet security headers
      expect(healthRes.headers.get('content-security-policy')).toContain("default-src 'self'");
      expect(healthRes.headers.get('strict-transport-security')).toContain('max-age=31536000');
      expect(healthRes.headers.get('x-frame-options')).toBe('SAMEORIGIN');
      expect(healthRes.headers.get('x-content-type-options')).toBe('nosniff');
      expect(healthRes.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
      expect(healthRes.headers.get('permissions-policy')).toContain('camera=(self)');

      const healthJson = await healthRes.json();
      expect(healthJson).toEqual({status: 'ok'});

      // Register ASHA & create two independent device sessions
      const regRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          identifier: 'ASHA-SESSION-1',
          secret: 'SessionSafe#2026',
          role: 'ASHA',
          displayName: 'Lata Devi',
          villageCode: 'VIL-204',
          ashaEnrollmentCode: 'Headers-Session-Clinic-Secret-2026!',
        }),
      });
      const session1 = (await regRes.json()) as {token: string};

      const loginRes2 = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          identifier: 'ASHA-SESSION-1',
          secret: 'SessionSafe#2026',
          role: 'ASHA',
        }),
      });
      const session2 = (await loginRes2.json()) as {token: string};

      // Rotate session1 -> old token immediately invalidated, rotated token works
      const rotateRes = await fetch(`${baseUrl}/api/auth/rotate-session`, {
        method: 'POST',
        headers: {Authorization: `Bearer ${session1.token}`},
      });
      expect(rotateRes.status).toBe(200);
      const rotated = (await rotateRes.json()) as {token: string};
      expect(rotated.token).not.toBe(session1.token);

      const oldTokenCheck = await fetch(`${baseUrl}/api/auth/me`, {
        headers: {Authorization: `Bearer ${session1.token}`},
      });
      expect(oldTokenCheck.status).toBe(401);

      // Logout-all from rotated session -> revokes BOTH rotated session AND session2!
      const logoutAllRes = await fetch(`${baseUrl}/api/auth/logout-all`, {
        method: 'POST',
        headers: {Authorization: `Bearer ${rotated.token}`},
      });
      expect(logoutAllRes.status).toBe(200);
      const logoutAllJson = (await logoutAllRes.json()) as {revokedSessions: number};
      expect(logoutAllJson.revokedSessions).toBe(2);

      const device2Check = await fetch(`${baseUrl}/api/auth/me`, {
        headers: {Authorization: `Bearer ${session2.token}`},
      });
      expect(device2Check.status).toBe(401);

      // Per-Account Brute-Force Lockout: 8 failed passcodes lock the account even if valid passcode is supplied on 9th try
      for (let i = 0; i < 8; i++) {
        const bad = await fetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            identifier: 'ASHA-SESSION-1',
            secret: `BadPasscode#${i}`,
            role: 'ASHA',
          }),
        });
        expect(bad.status).toBe(401);
      }

      const lockedEvenWithValidPasscode = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          identifier: 'ASHA-SESSION-1',
          secret: 'SessionSafe#2026',
          role: 'ASHA',
        }),
      });
      expect(lockedEvenWithValidPasscode.status).toBe(401);

      // Care Summary route NEVER returns 401 Unauthorized when called without a session token (demo/offline fallback mode)
      const prevGem = process.env.GEMINI_API_KEY;
      delete process.env.GEMINI_API_KEY;
      try {
        for (const summaryRoute of [
          '/api/gemini/clinical-summary',
          '/api/ai/care-summary',
          '/api/triage/summary',
        ]) {
          const demoSummaryRes = await fetch(`${baseUrl}${summaryRoute}`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
              age: 44,
              vitals: {systolic: 168, diastolic: 106, spo2: 88, temperature: 101.4, heartRate: 112},
              symptoms: ['Fever', 'Severe Chest Pain'],
            }),
          });
          expect(demoSummaryRes.status).not.toBe(401);
          expect(demoSummaryRes.status).not.toBe(403);
        }
      } finally {
        if (prevGem === undefined) delete process.env.GEMINI_API_KEY;
        else process.env.GEMINI_API_KEY = prevGem;
      }

      // Client helper attaches Authorization: Bearer <token> and falls back cleanly without "Unauthorized" errors
      let capturedAuthHeader = '';
      const origFetch = globalThis.fetch;
      try {
        globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
          const hdrs = (init?.headers || {}) as Record<string, string>;
          capturedAuthHeader = hdrs.Authorization || '';
          return new Response(
            JSON.stringify({error: 'GEMINI_API_KEY is not configured on the server.'}),
            {status: 502, headers: {'Content-Type': 'application/json'}}
          );
        }) as typeof fetch;

        const fallbackResult = await fetchCareSummaryWithFallback({
          sessionToken: 'live-bearer-token-xyz',
          networkState: '4g',
          age: 52,
          vitals: {systolic: 170, diastolic: 108, spo2: 87, temperature: 101.2, heartRate: 116},
          symptoms: ['Severe Chest Pain'],
        });
        expect(capturedAuthHeader).toBe('Bearer live-bearer-token-xyz');
        expect(fallbackResult.handoffSummary).toContain('170/108');
        expect(fallbackResult.handoffSummary).not.toContain('Unauthorized');
        expect(fallbackResult.stabilizationSteps.length).toBeGreaterThan(0);

        persistActiveAuthToken('stored-token-abc');
        expect(resolveActiveAuthToken('')).toBe('stored-token-abc');
        persistActiveAuthToken(null);
      } finally {
        globalThis.fetch = origFetch;
      }
    } finally {
      if (prevAsha === undefined) delete process.env.ASHA_ENROLLMENT_SECRET;
      else process.env.ASHA_ENROLLMENT_SECRET = prevAsha;
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      db.close();
    }
  });
});
