import Database from 'better-sqlite3';
import fs from 'fs';
import {AddressInfo} from 'net';
import os from 'os';
import path from 'path';
import {afterEach, describe, expect, it} from 'vitest';
import {createHealthSyncServer} from '../../server';
import {HealthSyncDatabase} from '../server/db';
import {TriageRecord} from '../types/triage';

function makeSampleRecord(index: number): TriageRecord {
  return {
    id: `rec-persist-${index}`,
    patientId: `PT-${1000 + index}`,
    abhaId: `91-8800-1100-${String(index).padStart(4, '0')}`,
    patientName: `Sensitive Patient ${index}`,
    age: 34,
    gender: 'F',
    villageCode: 'VIL-204',
    villageName: 'Rampur Kalan',
    ashaWorker: 'Sunita Devi (ASHA-8842-UP)',
    vitals: {
      systolic: 124,
      diastolic: 82,
      spo2: 97,
      temperature: 98.6,
      heartRate: 78,
    },
    symptoms: [],
    severity: 'routine',
    clinicalNotes: `Private clinical note #${index}`,
    channel: 'Data',
    syncStatus: 'Synced',
    binarySmsPayload: 'HS#A8842#BP124/82#SPO297#GRN',
    timestamp: '10:30 AM',
    createdAtMs: 1_700_000_000_000 + index,
    dispatchStatus: 'Unassigned',
  };
}

describe('SQLite Persistence, AES-256-GCM At-Rest PHI Encryption & Authenticated Server API', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, {recursive: true, force: true});
    }
  });

  it('persists >250 records across SQLite restarts (no 200 cap) and encrypts PHI at rest', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'healthsync-sqlite-test-'));
    tempDirs.push(tmpDir);
    const dbFile = path.join(tmpDir, 'test.sqlite');
    const masterSecret = 'unit-test-master-encryption-secret-256';

    const db1 = new HealthSyncDatabase(dbFile, masterSecret);
    for (let i = 1; i <= 260; i++) {
      db1.upsertRecord(makeSampleRecord(i));
    }
    db1.close();

    // Inspect raw SQLite column directly to verify AES-256-GCM encryption at rest
    const rawSqlite = new Database(dbFile, {readonly: true});
    const rawRow = rawSqlite
      .prepare('SELECT encrypted_payload FROM triage_records WHERE id = ?')
      .get('rec-persist-42') as {encrypted_payload: string};
    expect(rawRow.encrypted_payload).toBeTruthy();
    expect(rawRow.encrypted_payload).not.toContain('Sensitive Patient 42');
    expect(rawRow.encrypted_payload).not.toContain('91-8800-1100-0042');
    rawSqlite.close();

    // Reopen database (simulating full server restart) and verify all 260 records survive
    const db2 = new HealthSyncDatabase(dbFile, masterSecret);
    const restored = db2.listRecords();
    expect(restored.length).toBe(260);
    const target = restored.find((r) => r.id === 'rec-persist-42');
    expect(target?.patientName).toBe('Sensitive Patient 42');
    expect(target?.abhaId).toBe('91-8800-1100-0042');
    db2.close();
  });

  it('enforces DMO registration auth, BOLA/IDOR record ownership, SMS webhook auth, and /icon.svg', async () => {
    const prevDmoSecret = process.env.DMO_PROVISIONING_SECRET;
    const prevWebhookSecret = process.env.SMS_WEBHOOK_SECRET;
    const prevTwilioToken = process.env.TWILIO_AUTH_TOKEN;

    process.env.DMO_PROVISIONING_SECRET = 'District24-Admin-Provision-2026!';
    process.env.SMS_WEBHOOK_SECRET = 'Fast2SMS-Carrier-Webhook-Secret-99!';
    delete process.env.TWILIO_AUTH_TOKEN;

    const memDb = new HealthSyncDatabase(':memory:', 'api-test-key');
    const {httpServer} = await createHealthSyncServer(memDb);

    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
    const port = (httpServer.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // 1. Static /icon.svg is served for offline PWA manifest
      const iconRes = await fetch(`${baseUrl}/icon.svg`);
      expect(iconRes.status).toBe(200);
      const iconSvg = await iconRes.text();
      expect(iconSvg).toContain('<svg');

      // 2. Unauthenticated access to /api/records is strictly rejected with 401
      const unauthRes = await fetch(`${baseUrl}/api/records`);
      expect(unauthRes.status).toBe(401);

      // 3. SECURITY FIX #1: Unauthenticated curl attempt to self-register as DMO MUST fail with 403
      const rogueDmoRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          identifier: 'attacker@evil.example',
          secret: 'AttackerPass#123',
          role: 'DMO',
          displayName: 'Fake DMO',
        }),
      });
      expect(rogueDmoRes.status).toBe(403);

      // Wrong provisioning code also fails with 403
      const wrongCodeDmoRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          identifier: 'attacker2@evil.example',
          secret: 'AttackerPass#123',
          role: 'DMO',
          displayName: 'Fake DMO 2',
          dmoProvisioningCode: 'wrong-code-12345',
        }),
      });
      expect(wrongCodeDmoRes.status).toBe(403);

      // 4. Register ASHA Worker A and ASHA Worker B, and verify wrong PIN fails login
      const regAshaARes = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          identifier: 'ASHA-9001-UP',
          secret: '7391',
          role: 'ASHA',
          displayName: 'Meera Devi',
          villageCode: 'VIL-204',
        }),
      });
      expect(regAshaARes.status).toBe(201);
      const ashaASession = (await regAshaARes.json()) as {token: string};
      expect(ashaASession.token.length).toBeGreaterThan(20);

      const regAshaBRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          identifier: 'ASHA-9002-UP',
          secret: '8462',
          role: 'ASHA',
          displayName: 'Kavita Verma',
          villageCode: 'VIL-108',
        }),
      });
      expect(regAshaBRes.status).toBe(201);
      const ashaBSession = (await regAshaBRes.json()) as {token: string};

      // ASHA worker attempting to register a DMO account using ASHA token MUST fail with 403
      const ashaEscalationRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ashaASession.token}`,
        },
        body: JSON.stringify({
          identifier: 'escalated@evil.example',
          secret: 'StrongPass#2026',
          role: 'DMO',
          displayName: 'Escalated DMO',
        }),
      });
      expect(ashaEscalationRes.status).toBe(403);

      const wrongLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          identifier: 'ASHA-9001-UP',
          secret: '1234',
          role: 'ASHA',
        }),
      });
      expect(wrongLoginRes.status).toBe(401);

      // 5. SECURITY FIX #2 (BOLA / IDOR): ASHA Worker A creates a record; forged dispatchStatus is stripped
      const workerARecord: TriageRecord = {
        ...makeSampleRecord(999),
        dispatchStatus: 'Dispatched', // Spoofed by client — server must force 'Unassigned'
        ambulanceUnit: 'FAKE-AMB-999',
      };
      const postRecRes = await fetch(`${baseUrl}/api/records`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ashaASession.token}`,
        },
        body: JSON.stringify({record: workerARecord, triggerEmergencySiren: true}),
      });
      expect(postRecRes.status).toBe(201);
      const postRecBody = (await postRecRes.json()) as {record: TriageRecord};
      expect(postRecBody.record.dispatchStatus).toBe('Unassigned');
      expect(postRecBody.record.ambulanceUnit).toBeUndefined();

      // ASHA Worker B attempting to overwrite ASHA Worker A's record MUST be blocked with 403
      const bolaAttackPayload: TriageRecord = {
        ...workerARecord,
        patientName: 'TAMPERED BY WORKER B',
        vitals: {...workerARecord.vitals, spo2: 99},
      };
      const bolaAttackRes = await fetch(`${baseUrl}/api/records`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ashaBSession.token}`,
        },
        body: JSON.stringify({record: bolaAttackPayload}),
      });
      expect(bolaAttackRes.status).toBe(403);

      // ASHA Worker B listing /api/records cannot read ASHA Worker A's patient records
      const workerBListRes = await fetch(`${baseUrl}/api/records`, {
        headers: {Authorization: `Bearer ${ashaBSession.token}`},
      });
      const workerBList = (await workerBListRes.json()) as {records: TriageRecord[]};
      expect(workerBList.records.length).toBe(0);

      // ASHA Worker A attempting to self-approve dispatchStatus on her own existing record MUST fail with 403
      const selfDispatchViaPostRes = await fetch(`${baseUrl}/api/records`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ashaASession.token}`,
        },
        body: JSON.stringify({
          record: {...postRecBody.record, dispatchStatus: 'Dispatched'},
        }),
      });
      expect(selfDispatchViaPostRes.status).toBe(403);

      // 6. Verify ASHA worker is forbidden (403) from PATCH /dispatch
      const ashaDispatchRes = await fetch(
        `${baseUrl}/api/records/${workerARecord.id}/dispatch`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${ashaASession.token}`,
          },
          body: JSON.stringify({ambulanceUnit: '108-AMB-UP65', etaMinutes: 9}),
        }
      );
      expect(ashaDispatchRes.status).toBe(403);

      // 7. Provision DMO officer with valid DMO_PROVISIONING_SECRET and dispatch 108 ambulance (200 OK)
      const regDmoRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          identifier: 'dmo.district24@nhm.gov.in',
          secret: 'StrongPass#2026',
          role: 'DMO',
          displayName: 'Dr. R. K. Verma',
          dmoProvisioningCode: 'District24-Admin-Provision-2026!',
        }),
      });
      expect(regDmoRes.status).toBe(201);
      const dmoSession = (await regDmoRes.json()) as {token: string};

      const dmoDispatchRes = await fetch(
        `${baseUrl}/api/records/${workerARecord.id}/dispatch`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${dmoSession.token}`,
          },
          body: JSON.stringify({ambulanceUnit: '108-AMB-UP65', etaMinutes: 9}),
        }
      );
      expect(dmoDispatchRes.status).toBe(200);
      const dispatchedPayload = (await dmoDispatchRes.json()) as {record: TriageRecord};
      expect(dispatchedPayload.record.dispatchStatus).toBe('Dispatched');

      // 8. SECURITY FIX #4: Unauthenticated inbound SMS webhook MUST be rejected with 401
      const unauthWebhookRes = await fetch(`${baseUrl}/api/sms/webhook`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          From: '+919911223344',
          Body: 'HS#A8842#BP170/106#SPO285#RED',
        }),
      });
      expect(unauthWebhookRes.status).toBe(401);

      // Authenticated webhook with valid X-Webhook-Secret succeeds (200 OK)
      const authWebhookRes = await fetch(`${baseUrl}/api/sms/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': 'Fast2SMS-Carrier-Webhook-Secret-99!',
        },
        body: JSON.stringify({
          From: '+919911223344',
          Body: 'HS#A8842#BP170/106#SPO285#RED',
        }),
      });
      expect(authWebhookRes.status).toBe(200);

      // Also verify Twilio X-Twilio-Signature HMAC-SHA1 validation
      const {computeTwilioWebhookSignature} = await import('../server/smsGateway');
      process.env.TWILIO_AUTH_TOKEN = 'twilio-unit-test-secret-token';
      const webhookUrl = `${baseUrl}/api/sms/webhook`;
      const twilioBody = {
        From: '+919811002233',
        Body: 'HS#A8842#PT70123#BP176/110#SPO284#RED',
      };
      const validTwilioSig = computeTwilioWebhookSignature(
        process.env.TWILIO_AUTH_TOKEN,
        webhookUrl,
        twilioBody
      );

      const forgedTwilioRes = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-twilio-signature': 'forged-invalid-signature',
        },
        body: JSON.stringify(twilioBody),
      });
      expect(forgedTwilioRes.status).toBe(401);

      const validTwilioRes = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-twilio-signature': validTwilioSig,
        },
        body: JSON.stringify(twilioBody),
      });
      expect(validTwilioRes.status).toBe(200);

      const listAfterWebhook = await fetch(`${baseUrl}/api/records`, {
        headers: {Authorization: `Bearer ${dmoSession.token}`},
      });
      const listJson = (await listAfterWebhook.json()) as {records: TriageRecord[]};
      expect(listJson.records.some((r) => r.vitals.systolic === 170 && r.vitals.spo2 === 85)).toBe(
        true
      );
      expect(
        listJson.records.some((r) => r.patientId === 'PT70123' && r.vitals.systolic === 176)
      ).toBe(true);
      // Confirm Worker A's patient name was NEVER overwritten by Worker B
      expect(listJson.records.find((r) => r.id === workerARecord.id)?.patientName).toBe(
        'Sensitive Patient 999'
      );
    } finally {
      if (prevDmoSecret === undefined) delete process.env.DMO_PROVISIONING_SECRET;
      else process.env.DMO_PROVISIONING_SECRET = prevDmoSecret;

      if (prevWebhookSecret === undefined) delete process.env.SMS_WEBHOOK_SECRET;
      else process.env.SMS_WEBHOOK_SECRET = prevWebhookSecret;

      if (prevTwilioToken === undefined) delete process.env.TWILIO_AUTH_TOKEN;
      else process.env.TWILIO_AUTH_TOKEN = prevTwilioToken;

      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      memDb.close();
    }
  });

  it('prevents event-loop blocking during scrypt auth, rejects URL query tokens, reaps zombie WebSockets, deduplicates SMS webhook retries, and emits sync:error on DB failures', async () => {
    const prevWebhookSecret = process.env.SMS_WEBHOOK_SECRET;
    const prevTwilioToken = process.env.TWILIO_AUTH_TOKEN;
    process.env.SMS_WEBHOOK_SECRET = 'Idempotency-Carrier-Secret-2026!';
    delete process.env.TWILIO_AUTH_TOKEN;

    const {WebSocket: WsClient} = await import('ws');
    const memDb = new HealthSyncDatabase(':memory:', 'reliability-test-key');
    const {httpServer} = await createHealthSyncServer(memDb, {
      heartbeatIntervalMs: 70,
      wsAuthTimeoutMs: 250,
    });

    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
    const port = (httpServer.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;
    const wsBaseUrl = `ws://127.0.0.1:${port}`;

    try {
      // 1. EVENT LOOP NON-BLOCKING CHECK: Fire timer ticks while concurrent async scrypt hashes run
      let eventLoopTicksDuringAuth = 0;
      const tickTimer = setInterval(() => {
        eventLoopTicksDuringAuth += 1;
      }, 5);

      const authPromises = Array.from({length: 6}, (_, idx) =>
        memDb.registerUser({
          identifier: `ASHA-ASYNC-${idx}`,
          secret: `Pin#${1000 + idx}`,
          role: 'ASHA',
          displayName: `Worker ${idx}`,
        })
      );
      await Promise.all(authPromises);
      clearInterval(tickTimer);
      expect(eventLoopTicksDuringAuth).toBeGreaterThan(0);

      const sessionA = await memDb.authenticateUser('ASHA-ASYNC-0', 'Pin#1000', 'ASHA');
      expect(sessionA.token.length).toBeGreaterThan(20);

      // 2. SESSION CREDENTIAL LEAKAGE FIX: Query-string ?token= MUST be rejected on upgrade
      const leakedUrlRejected = await new Promise<boolean>((resolve) => {
        const badWs = new WsClient(
          `${wsBaseUrl}/ws/triage?token=${encodeURIComponent(sessionA.token)}`
        );
        badWs.on('unexpected-response', (_req, res) => {
          resolve(res.statusCode === 400);
          badWs.terminate();
        });
        badWs.on('error', () => resolve(true));
        badWs.on('open', () => {
          badWs.close();
          resolve(false);
        });
      });
      expect(leakedUrlRejected).toBe(true);

      // 3. POST-UPGRADE FRAME AUTH + EXPLICIT sync:ack & sync:error (NO SILENT DATA LOSS)
      const authedWs = new WsClient(`${wsBaseUrl}/ws/triage`);
      const receivedFrames: Array<Record<string, unknown>> = [];

      await new Promise<void>((resolve, reject) => {
        authedWs.on('open', () => {
          authedWs.send(JSON.stringify({type: 'auth', token: sessionA.token}));
        });
        authedWs.on('message', (data) => {
          const parsed = JSON.parse(String(data)) as Record<string, unknown>;
          receivedFrames.push(parsed);
          if (parsed.type === 'sync:init') {
            resolve();
          }
        });
        authedWs.on('error', reject);
      });

      // Valid WebSocket record write receives explicit sync:ack
      const validRec = makeSampleRecord(501);
      const ackFrame = await new Promise<Record<string, unknown>>((resolve) => {
        authedWs.once('message', (data) => resolve(JSON.parse(String(data))));
        authedWs.send(
          JSON.stringify({
            type: 'record:created',
            record: validRec,
            triggerEmergencySiren: false,
          })
        );
      });
      expect(ackFrame.type).toBe('sync:ack');
      expect(ackFrame.recordId).toBe(validRec.id);

      // Simulate SQLite write error -> client MUST receive sync:error (never silent drop!)
      const origUpsert = memDb.upsertRecord.bind(memDb);
      memDb.upsertRecord = () => {
        throw new Error('Simulated SQLITE_FULL disk write failure');
      };
      try {
        const failedRec = makeSampleRecord(502);
        const errFrame = await new Promise<Record<string, unknown>>((resolve) => {
          authedWs.once('message', (data) => resolve(JSON.parse(String(data))));
          authedWs.send(
            JSON.stringify({
              type: 'record:created',
              record: failedRec,
              triggerEmergencySiren: false,
            })
          );
        });
        expect(errFrame.type).toBe('sync:error');
        expect(errFrame.recordId).toBe(failedRec.id);
        expect(errFrame.retryable).toBe(true);
      } finally {
        memDb.upsertRecord = origUpsert;
      }

      authedWs.close();
      await new Promise((r) => setTimeout(r, 40));

      // 4. ZOMBIE WEBSOCKET HEARTBEAT TERMINATION: Client with autoPong: false is reaped automatically
      const zombieWs = new WsClient(`${wsBaseUrl}/ws/triage`, {autoPong: false});
      await new Promise<void>((resolve, reject) => {
        zombieWs.on('open', () => {
          zombieWs.send(JSON.stringify({type: 'auth', token: sessionA.token}));
        });
        zombieWs.on('message', (data) => {
          const parsed = JSON.parse(String(data)) as {type?: string};
          if (parsed.type === 'sync:init') resolve();
        });
        zombieWs.on('error', reject);
      });

      const healthDuringZombie = await (await fetch(`${baseUrl}/api/health`)).json();
      expect(healthDuringZombie.connectedDevices).toBe(1);

      // Wait ~2.5 heartbeat intervals (70ms * 3 = 210ms) for server ping + zombie termination
      await new Promise<void>((resolve) => {
        zombieWs.on('close', () => resolve());
        setTimeout(() => resolve(), 400);
      });

      const healthAfterSweep = await (await fetch(`${baseUrl}/api/health`)).json();
      expect(healthAfterSweep.connectedDevices).toBe(0);

      // 5. SMS WEBHOOK IDEMPOTENCY: Replaying carrier retries MUST NOT create duplicate records
      const webhookPayload = {
        From: '+919876543210',
        Body: 'HS#A8842#PT90210#BP168/104#SPO286#RED',
        MessageSid: 'SM998877665544332211',
      };
      for (let attempt = 0; attempt < 3; attempt++) {
        const retryRes = await fetch(`${baseUrl}/api/sms/webhook`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-webhook-secret': 'Idempotency-Carrier-Secret-2026!',
          },
          body: JSON.stringify(webhookPayload),
        });
        expect(retryRes.status).toBe(200);
      }

      // Also replay 3 retries WITHOUT a MessageSid (e.g. Fast2SMS / raw GSM modem)
      const sidlessPayload = {
        from: '+919811223344',
        body: 'HS#A8842#PT90211#BP164/102#SPO287#RED',
      };
      for (let attempt = 0; attempt < 3; attempt++) {
        const retryRes = await fetch(`${baseUrl}/api/sms/webhook`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-webhook-secret': 'Idempotency-Carrier-Secret-2026!',
          },
          body: JSON.stringify(sidlessPayload),
        });
        expect(retryRes.status).toBe(200);
      }

      const allRecords = memDb.listRecords();
      const pt90210Matches = allRecords.filter((r) => r.patientId === 'PT90210');
      const pt90211Matches = allRecords.filter((r) => r.patientId === 'PT90211');
      expect(pt90210Matches.length).toBe(1);
      expect(pt90211Matches.length).toBe(1);

      const smsDispatches = memDb.listSmsDispatches(50);
      expect(smsDispatches.filter((d) => d.recordId === pt90210Matches[0].id).length).toBe(1);
      expect(smsDispatches.filter((d) => d.recordId === pt90211Matches[0].id).length).toBe(1);
    } finally {
      if (prevWebhookSecret === undefined) delete process.env.SMS_WEBHOOK_SECRET;
      else process.env.SMS_WEBHOOK_SECRET = prevWebhookSecret;

      if (prevTwilioToken === undefined) delete process.env.TWILIO_AUTH_TOKEN;
      else process.env.TWILIO_AUTH_TOKEN = prevTwilioToken;

      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      memDb.close();
    }
  });

  it('virtualizes 10,000 historical triage records in DistrictCommandDashboard so DOM row count stays O(1)', async () => {
    const React = await import('react');
    const {renderToStaticMarkup} = await import('react-dom/server');
    const {DistrictCommandDashboard} = await import('../components/DistrictCommandDashboard');
    const {computeVirtualWindow} = await import('../utils/virtualWindow');

    const slice = computeVirtualWindow({
      totalCount: 10_000,
      scrollTop: 32_000,
      viewportHeight: 580,
      itemHeight: 64,
      overscan: 6,
    });
    expect(slice.endIndex - slice.startIndex).toBeLessThanOrEqual(24);
    expect(slice.topSpacerPx).toBeGreaterThan(0);
    expect(slice.bottomSpacerPx).toBeGreaterThan(0);

    const tenThousandRecords: TriageRecord[] = Array.from({length: 10_000}, (_, idx) =>
      makeSampleRecord(idx + 1)
    );

    const html = renderToStaticMarkup(
      React.createElement(DistrictCommandDashboard, {
        dmoEmail: 'dmo@nhm.gov.in',
        dmoDisplayName: 'Dr. Verma',
        sessionToken: 'OFFLINE_LOCAL_SESSION',
        records: tenThousandRecords,
        isLoadingRecords: false,
        activeTab: 'records',
        onSelectTab: () => {},
        sirenActive: false,
        sirenMuted: false,
        onTriggerTestSiren: () => {},
        onToggleMuteSiren: () => {},
        onDispatchAmbulance: () => {},
      })
    );

    expect(html).toContain('Showing 10000 of 10000 recorded patient visits');
    // Count rendered <tr> elements: header + 2 spacer rows + visible slice (~16 rows) << 50 total (vs 10,000+ previously!)
    const trMatches = html.match(/<tr[\s>]/g) ?? [];
    expect(trMatches.length).toBeGreaterThan(5);
    expect(trMatches.length).toBeLessThan(40);
  });

  it('enforces default 500-row SQL LIMIT on bulk decryption and blocks brute forcing after 15 failed auth attempts across /api/auth/login and /api/auth/register with HTTP 429', async () => {
    const memDb = new HealthSyncDatabase(':memory:', 'limit-and-throttle-key');
    const {httpServer} = await createHealthSyncServer(memDb);

    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
    const port = (httpServer.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // 1. Insert 620 records and verify listRecords() enforces default LIMIT 500
      for (let i = 1; i <= 620; i++) {
        memDb.upsertRecord(makeSampleRecord(i), 'ASHA-LIMIT-1');
      }
      expect(memDb.listRecords().length).toBe(500);
      expect(memDb.listRecords(25).length).toBe(25);

      const ashaUser = await memDb.registerUser({
        identifier: 'ASHA-LIMIT-1',
        secret: '5839',
        role: 'ASHA',
        displayName: 'Sita Devi',
      });
      expect(memDb.listRecordsForUser(ashaUser).length).toBe(500);
      expect(memDb.listRecordsForUser(ashaUser, 10).length).toBe(10);

      // 2. Mix 8 wrong DMO_PROVISIONING_SECRET registration attempts + 7 wrong PIN login attempts = 15 failures
      for (let attempt = 0; attempt < 8; attempt++) {
        const regRes = await fetch(`${baseUrl}/api/auth/register`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            identifier: `dmo-guess-${attempt}@uphealth.gov.in`,
            secret: 'StrongPass123!',
            role: 'DMO',
            displayName: 'Attacker DMO',
            dmoProvisioningCode: `wrong-secret-guess-${attempt}`,
          }),
        });
        expect(regRes.status).toBe(403);
      }

      for (let attempt = 0; attempt < 7; attempt++) {
        const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            identifier: 'ASHA-LIMIT-1',
            secret: `000${attempt}`,
            role: 'ASHA',
          }),
        });
        expect(loginRes.status).toBe(401);
      }

      // 16th attempt on BOTH /api/auth/register and /api/auth/login MUST return HTTP 429
      const throttledRegRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          identifier: 'dmo-guess-blocked@uphealth.gov.in',
          secret: 'StrongPass123!',
          role: 'DMO',
          displayName: 'Attacker DMO',
          dmoProvisioningCode: 'another-guess',
        }),
      });
      expect(throttledRegRes.status).toBe(429);

      const throttledLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          identifier: 'ASHA-LIMIT-1',
          secret: '5839',
          role: 'ASHA',
        }),
      });
      expect(throttledLoginRes.status).toBe(429);
      const throttledJson = (await throttledLoginRes.json()) as {error: string};
      expect(throttledJson.error).toContain('Too many authentication attempts');
    } finally {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      memDb.close();
    }
  });

  it('prevents overlapping OscillatorNode stacking when playTestSirenBurst is called repeatedly before onended', async () => {
    const {sirenEngine} = await import('../utils/sirenAudio.ts');
    let createdOscillators = 0;
    let lastOnEnded: (() => void) | null = null;

    const originalWindow = (globalThis as {window?: unknown}).window;
    (globalThis as {window?: unknown}).window = {
      AudioContext: class MockAudioContext {
        public state = 'running';
        public currentTime = 0;
        public destination = {};
        public resume() {
          return Promise.resolve();
        }
        public createOscillator() {
          createdOscillators += 1;
          const osc = {
            type: 'triangle',
            frequency: {
              setValueAtTime: () => {},
              exponentialRampToValueAtTime: () => {},
            },
            connect: () => {},
            disconnect: () => {},
            start: () => {},
            stop: () => {},
            set onended(cb: (() => void) | null) {
              lastOnEnded = cb;
            },
            get onended() {
              return lastOnEnded;
            },
          };
          return osc;
        }
        public createGain() {
          return {
            gain: {
              setValueAtTime: () => {},
              linearRampToValueAtTime: () => {},
              exponentialRampToValueAtTime: () => {},
            },
            connect: () => {},
            disconnect: () => {},
          };
        }
      },
    };

    try {
      // Rapidly trigger 5 bursts back-to-back while the first burst is still playing
      sirenEngine.playTestSirenBurst();
      sirenEngine.playTestSirenBurst();
      sirenEngine.playTestSirenBurst();
      sirenEngine.playTestSirenBurst();
      sirenEngine.playTestSirenBurst();

      expect(createdOscillators).toBe(1);
      expect(sirenEngine.isTestBurstActive()).toBe(true);

      // Simulate Web Audio osc.onended firing when the 1.58s burst completes
      expect(lastOnEnded).not.toBeNull();
      lastOnEnded!();
      expect(sirenEngine.isTestBurstActive()).toBe(false);

      // Subsequent burst after completion is permitted again
      sirenEngine.playTestSirenBurst();
      expect(createdOscillators).toBe(2);
      lastOnEnded!();
    } finally {
      (globalThis as {window?: unknown}).window = originalWindow;
    }
  });

  it('safely handles non-JSON "The page could not be found" responses, Express /api JSON errors, and Vercel /api/index rewrites', async () => {
    const {isBackendUnavailableResponse, safeReadJson} = await import(
      '../utils/safeFetchJson.ts'
    );

    // 1. Reproduce exact screenshot error payload ("The page could not be found")
    const vercel404 = new Response('The page could not be found\n\nNOT_FOUND', {
      status: 404,
      headers: {'Content-Type': 'text/plain; charset=utf-8'},
    });
    const parsed404 = await safeReadJson<{error?: string}>(vercel404);
    expect(parsed404.isJson).toBe(false);
    expect(parsed404.data).toBeNull();
    expect(isBackendUnavailableResponse(vercel404, parsed404)).toBe(true);

    // 2. Reproduce SPA HTML fallback (200 text/html)
    const htmlFallback = new Response('<!doctype html><html><body>SwasthyaSetu</body></html>', {
      status: 200,
      headers: {'Content-Type': 'text/html'},
    });
    const parsedHtml = await safeReadJson(htmlFallback);
    expect(parsedHtml.isJson).toBe(false);
    expect(isBackendUnavailableResponse(htmlFallback, parsedHtml)).toBe(true);

    // 3. Verify Express /api unknown route and malformed JSON body return valid JSON (never HTML/text)
    const memDb = new HealthSyncDatabase(':memory:', 'json-safety-key');
    const {httpServer} = await createHealthSyncServer(memDb);
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
    const port = (httpServer.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const unknownApiRes = await fetch(`${baseUrl}/api/non-existent-route`);
      expect(unknownApiRes.status).toBe(404);
      const unknownParsed = await safeReadJson<{error?: string}>(unknownApiRes);
      expect(unknownParsed.isJson).toBe(true);
      expect(unknownParsed.data?.error).toContain('not found');

      const malformedBodyRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: '{invalid-json',
      });
      expect(malformedBodyRes.status).toBe(400);
      const malformedParsed = await safeReadJson<{error?: string}>(malformedBodyRes);
      expect(malformedParsed.isJson).toBe(true);
    } finally {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      memDb.close();
    }

    // 4. Verify Vercel serverless handler (/api/index.ts) routes rewritten /api/auth/register cleanly
    const http = await import('http');
    const {default: vercelHandler} = await import('../../api/index.ts');
    const vercelServer = http.createServer((req, res) => {
      void vercelHandler(req, res);
    });
    await new Promise<void>((resolve) => vercelServer.listen(0, '127.0.0.1', () => resolve()));
    const vPort = (vercelServer.address() as AddressInfo).port;
    try {
      const uniqueAshaId = `ASHA-234-${Date.now()}`;
      const regRes = await fetch(
        `http://127.0.0.1:${vPort}/api/index?__hs_path=auth/register`,
        {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            identifier: uniqueAshaId,
            secret: '1234',
            role: 'ASHA',
            displayName: 'Sushma devi',
            villageCode: 'VIL-204',
          }),
        }
      );
      expect(regRes.status).toBe(201);
      const regParsed = await safeReadJson<{token?: string; user?: {identifier: string}}>(regRes);
      expect(regParsed.isJson).toBe(true);
      expect(regParsed.data?.token).toBeTruthy();
      expect(regParsed.data?.user?.identifier).toBe(uniqueAshaId.toUpperCase());
    } finally {
      await new Promise<void>((resolve) => vercelServer.close(() => resolve()));
    }
  });

  it('serves valid PWA PNG icons, reports DMO provisioning status, persists ASHA stipends, and handles Gemini API config cleanly', async () => {
    const publicDir = path.resolve(process.cwd(), 'public');
    for (const iconName of [
      'pwa-192x192.png',
      'pwa-512x512.png',
      'pwa-maskable-512x512.png',
      'apple-touch-icon.png',
    ]) {
      const iconBytes = fs.readFileSync(path.join(publicDir, iconName));
      expect(iconBytes.length).toBeGreaterThan(64);
      // PNG magic header: 89 50 4E 47
      expect(iconBytes[0]).toBe(0x89);
      expect(iconBytes[1]).toBe(0x50);
      expect(iconBytes[2]).toBe(0x4e);
      expect(iconBytes[3]).toBe(0x47);
    }

    const prevGemKey = process.env.GEMINI_API_KEY;
    const prevDmoSecret = process.env.DMO_PROVISIONING_SECRET;
    delete process.env.GEMINI_API_KEY;
    delete process.env.DMO_PROVISIONING_SECRET;

    const memDb = new HealthSyncDatabase(':memory:', 'stipend-gemini-test-key');
    const {httpServer} = await createHealthSyncServer(memDb);
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
    const port = (httpServer.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const statusRes = await fetch(`${baseUrl}/api/auth/status`);
      expect(statusRes.status).toBe(200);
      const statusJson = (await statusRes.json()) as {
        hasRegisteredUsers: boolean;
        dmoProvisioningEnabled: boolean;
      };
      expect(statusJson.dmoProvisioningEnabled).toBe(false);

      const regRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          identifier: 'ASHA-7711-UP',
          secret: '4829',
          role: 'ASHA',
          displayName: 'Rekha Devi',
          villageCode: 'VIL-204',
        }),
      });
      expect(regRes.status).toBe(201);
      const {token} = (await regRes.json()) as {token: string};

      const rec = makeSampleRecord(501);
      const saveRes = await fetch(`${baseUrl}/api/records`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          record: rec,
          incentive: {
            id: `inc-${rec.id}`,
            taskTitle: 'Priority Referral & Health Stabilization',
            programCode: 'NHM-HRP-50',
            patientRef: `${rec.patientId} · ${rec.patientName}`,
            amountInr: 150,
            timestamp: rec.timestamp,
            abdmVerified: true,
          },
        }),
      });
      expect(saveRes.status).toBe(201);

      const listRes = await fetch(`${baseUrl}/api/records`, {
        headers: {Authorization: `Bearer ${token}`},
      });
      const listed = (await listRes.json()) as {
        records: TriageRecord[];
      };
      expect(listed.records.some((r) => r.id === rec.id)).toBe(true);

      const incRes = await fetch(`${baseUrl}/api/incentives`, {
        headers: {Authorization: `Bearer ${token}`},
      });
      expect(incRes.status).toBe(200);
      const incJson = (await incRes.json()) as {
        incentives: Array<{id: string; amountInr: number}>;
      };
      expect(incJson.incentives.some((i) => i.id === `inc-${rec.id}` && i.amountInr === 150)).toBe(
        true
      );

      const geminiRes = await fetch(`${baseUrl}/api/gemini/clinical-summary`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          patientName: 'Sita Devi',
          age: 29,
          vitals: rec.vitals,
          symptoms: ['Fever'],
          transcript: 'Fever for two days',
        }),
      });
      expect(geminiRes.status).toBe(502);
      const geminiErr = (await geminiRes.json()) as {error?: string};
      expect(geminiErr.error).toContain('GEMINI_API_KEY');
    } finally {
      if (prevGemKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = prevGemKey;

      if (prevDmoSecret === undefined) delete process.env.DMO_PROVISIONING_SECRET;
      else process.env.DMO_PROVISIONING_SECRET = prevDmoSecret;

      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      memDb.close();
    }
  });
});



