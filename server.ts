import 'dotenv/config';
import crypto from 'crypto';
import express, {type NextFunction, type Request, type Response} from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import {fileURLToPath} from 'url';
import {WebSocketServer, WebSocket} from 'ws';
import {
  HealthSyncDatabase,
  type AuthenticatedUser,
  type ServerUserRole,
} from './src/server/db.ts';
import {generateClinicalTriageSummary} from './src/server/geminiService.ts';
import {
  dispatchEmergencySms,
  getConfiguredSmsGatewayStatus,
  parseInboundSmsWebhookToRecord,
  verifyInboundSmsWebhookAuth,
} from './src/server/smsGateway.ts';
import type {IncentiveEntry, TriageRecord} from './src/types/triage.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface AuthedRequest extends Request {
  authUser?: AuthenticatedUser;
  rawToken?: string;
}

class RecordAuthorizationError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode = 403) {
    super(message);
    this.name = 'RecordAuthorizationError';
    this.statusCode = statusCode;
  }
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

function verifyDmoProvisioningSecret(providedCode: string): boolean {
  const configured = process.env.DMO_PROVISIONING_SECRET?.trim() || '';
  if (!configured || configured.length < 12 || configured === 'MY_DMO_PROVISIONING_SECRET') {
    return false;
  }
  if (!providedCode) return false;
  const expectedDigest = crypto.createHash('sha256').update(configured, 'utf8').digest();
  const actualDigest = crypto.createHash('sha256').update(providedCode, 'utf8').digest();
  return crypto.timingSafeEqual(expectedDigest, actualDigest);
}

/**
 * Enforces Object-Level Authorization (BOLA / IDOR protection) and field-level RBAC on triage records:
 * - Prevents ASHA Worker B from overwriting or tampering with records created by ASHA Worker A or SMS webhooks.
 * - Prevents non-DMO accounts from forging or modifying `dispatchStatus`, `ambulanceUnit`, or `etaMinutes`.
 */
function authorizeAndSanitizeRecordWrite(
  db: HealthSyncDatabase,
  user: AuthenticatedUser,
  incoming: TriageRecord
): {sanitized: TriageRecord; ownerIdentifier: string} {
  const existing = db.getRecordWithOwner(incoming.id);

  if (existing) {
    if (user.role !== 'DMO') {
      if (!existing.ownerIdentifier || existing.ownerIdentifier !== user.identifier) {
        throw new RecordAuthorizationError(
          'Forbidden: You cannot modify or overwrite triage records belonging to another worker.'
        );
      }
      // ASHA owner can update clinical observations on their own record, NEVER ambulance dispatch fields
      if (
        incoming.dispatchStatus &&
        incoming.dispatchStatus !== existing.record.dispatchStatus &&
        incoming.dispatchStatus === 'Dispatched'
      ) {
        throw new RecordAuthorizationError(
          'Forbidden: Only District Medical Officers (DMO) can authorize ambulance dispatch.'
        );
      }
      const sanitized: TriageRecord = {
        ...incoming,
        ashaWorker: `${user.displayName} (${user.identifier})`,
        dispatchStatus: existing.record.dispatchStatus,
        ambulanceUnit: existing.record.ambulanceUnit,
        etaMinutes: existing.record.etaMinutes,
      };
      return {sanitized, ownerIdentifier: existing.ownerIdentifier};
    }

    // DMO updating an existing record: preserve original record owner attribution
    return {
      sanitized: {...incoming},
      ownerIdentifier: existing.ownerIdentifier,
    };
  }

  // Creating a brand-new triage record
  if (user.role !== 'DMO') {
    const sanitized: TriageRecord = {
      ...incoming,
      ashaWorker: `${user.displayName} (${user.identifier})`,
      dispatchStatus: 'Unassigned',
      ambulanceUnit: undefined,
      etaMinutes: undefined,
    };
    return {sanitized, ownerIdentifier: user.identifier};
  }

  return {
    sanitized: {
      ...incoming,
      dispatchStatus: incoming.dispatchStatus === 'Dispatched' ? 'Dispatched' : 'Unassigned',
    },
    ownerIdentifier: user.identifier,
  };
}

export interface HealthSyncServerOptions {
  heartbeatIntervalMs?: number;
  wsAuthTimeoutMs?: number;
}

export async function createHealthSyncServer(
  customDb?: HealthSyncDatabase,
  options?: HealthSyncServerOptions
) {
  const db = customDb ?? new HealthSyncDatabase();
  const heartbeatIntervalMs = options?.heartbeatIntervalMs ?? 25_000;
  const wsAuthTimeoutMs = options?.wsAuthTimeoutMs ?? 5_000;

  const app = express();
  app.use(express.json({limit: '1mb'}));
  app.use(express.urlencoded({extended: false}));

  // Serve public PWA assets (/icon.svg, /pwa-192x192.png, etc.) reliably in dev & prod
  app.use(express.static(path.join(__dirname, 'public')));

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({noServer: true});
  const clients = new Map<WebSocket, AuthenticatedUser>();
  const trackedSockets = new Set<WebSocket>();
  const socketAlive = new WeakMap<WebSocket, boolean>();

  const broadcastJson = (payload: unknown, exclude?: WebSocket) => {
    const serialized = JSON.stringify(payload);
    for (const [client] of clients) {
      if (client !== exclude && client.readyState === WebSocket.OPEN) {
        client.send(serialized);
      }
    }
  };

  /**
   * Scopes patient PHI WebSocket broadcasts strictly to authorized recipients:
   * all connected DMO officers + the specific ASHA worker who owns the record.
   */
  const broadcastRecordEvent = (
    payload: unknown,
    ownerIdentifier: string,
    exclude?: WebSocket
  ) => {
    const serialized = JSON.stringify(payload);
    for (const [client, clientUser] of clients) {
      if (client === exclude || client.readyState !== WebSocket.OPEN) continue;
      if (
        clientUser.role === 'DMO' ||
        (ownerIdentifier !== '' && clientUser.identifier === ownerIdentifier)
      ) {
        client.send(serialized);
      }
    }
  };

  const requireAuth = (req: AuthedRequest, res: Response, next: NextFunction) => {
    const token = extractBearerToken(req);
    const user = db.verifySessionToken(token);
    if (!user) {
      res.status(401).json({error: 'Unauthorized: Valid session token required.'});
      return;
    }
    req.authUser = user;
    req.rawToken = token ?? undefined;
    next();
  };

  // --- AUTHENTICATION ROUTES ---
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      connectedDevices: clients.size,
      smsGateway: getConfiguredSmsGatewayStatus(),
    });
  });

  app.get('/api/auth/status', (_req, res) => {
    const configuredSecret = process.env.DMO_PROVISIONING_SECRET?.trim() || '';
    res.json({
      hasRegisteredUsers: db.countUsers() > 0,
      dmoProvisioningEnabled:
        configuredSecret.length >= 12 && configuredSecret !== 'MY_DMO_PROVISIONING_SECRET',
      smsGateway: getConfiguredSmsGatewayStatus(),
    });
  });

  // Global Auth Rate Limiter + Memory Cleanup (protects both /api/auth/register and /api/auth/login)
  const authAttempts = new Map<string, {count: number; resetAt: number}>();

  const authCleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of authAttempts.entries()) {
      if (data.resetAt <= now) {
        authAttempts.delete(ip);
      }
    }
  }, 60_000);
  authCleanupTimer.unref?.();

  const authRateLimiter = (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const throttle = authAttempts.get(ip);

    if (throttle && throttle.resetAt > now && throttle.count >= 15) {
      res.status(429).json({error: 'Too many authentication attempts. Try again later.'});
      return;
    }
    next();
  };

  const recordAuthFailure = (req: Request) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const existing = authAttempts.get(ip);
    const current =
      existing && existing.resetAt > now
        ? existing
        : {count: 0, resetAt: now + 5 * 60 * 1000};
    authAttempts.set(ip, {count: current.count + 1, resetAt: current.resetAt});
  };

  app.post('/api/auth/register', authRateLimiter, async (req, res) => {
    try {
      const {identifier, secret, role, displayName, villageCode, dmoProvisioningCode} =
        req.body || {};
      if (role !== 'ASHA' && role !== 'DMO') {
        recordAuthFailure(req);
        res.status(400).json({error: 'Role must be ASHA or DMO.'});
        return;
      }

      // SECURITY FIX #1: Prevent unauthenticated DMO privilege escalation
      if (role === 'DMO') {
        const caller = db.verifySessionToken(extractBearerToken(req));
        const headerSecret =
          typeof req.headers['x-dmo-provisioning-secret'] === 'string'
            ? req.headers['x-dmo-provisioning-secret'].trim()
            : '';
        const providedSecret = headerSecret || String(dmoProvisioningCode || '').trim();

        const isAuthorizedByExistingDmo = caller?.role === 'DMO';
        const isAuthorizedByProvisioningSecret = verifyDmoProvisioningSecret(providedSecret);

        if (!isAuthorizedByExistingDmo && !isAuthorizedByProvisioningSecret) {
          recordAuthFailure(req);
          res.status(403).json({
            error:
              'Forbidden: District Medical Officer (DMO) registration requires an authenticated DMO administrator or valid Hospital Authorization Code.',
          });
          return;
        }
      }

      await db.registerUser({
        identifier: String(identifier || ''),
        secret: String(secret || ''),
        role: role as ServerUserRole,
        displayName: String(displayName || ''),
        villageCode: villageCode ? String(villageCode) : 'VIL-204',
      });
      const session = await db.authenticateUser(
        String(identifier || ''),
        String(secret || ''),
        role as ServerUserRole
      );
      res.status(201).json(session);
    } catch (err) {
      recordAuthFailure(req);
      const msg = err instanceof Error ? err.message : 'Registration failed.';
      res.status(400).json({error: msg});
    }
  });

  app.post('/api/auth/login', authRateLimiter, async (req, res) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    try {
      const {identifier, secret, role} = req.body || {};
      if (role !== 'ASHA' && role !== 'DMO') {
        recordAuthFailure(req);
        res.status(400).json({error: 'Role must be ASHA or DMO.'});
        return;
      }
      const session = await db.authenticateUser(
        String(identifier || ''),
        String(secret || ''),
        role as ServerUserRole
      );

      // Clear failures on success
      authAttempts.delete(ip);
      res.json(session);
    } catch (err) {
      recordAuthFailure(req);
      const msg = err instanceof Error ? err.message : 'Authentication failed.';
      res.status(401).json({error: msg});
    }
  });

  app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
    res.json({user: req.authUser});
  });

  app.post('/api/auth/logout', requireAuth, (req: AuthedRequest, res) => {
    db.revokeSessionToken(req.rawToken);
    res.json({ok: true});
  });

  // --- TRIAGE RECORDS & INCENTIVES (PERSISTED IN SQLITE WITH AES-256-GCM PHI ENCRYPTION & BOLA/IDOR RBAC) ---
  app.get('/api/records', requireAuth, (req: AuthedRequest, res) => {
    res.json({records: db.listRecordsForUser(req.authUser!)});
  });

  app.post('/api/records', requireAuth, (req: AuthedRequest, res) => {
    const {record, triggerEmergencySiren, incentive} = req.body || {};
    if (!record || typeof record.id !== 'string' || !record.id.trim() || !record.vitals) {
      res.status(400).json({error: 'Invalid triage record payload.'});
      return;
    }

    try {
      const {sanitized, ownerIdentifier} = authorizeAndSanitizeRecordWrite(
        db,
        req.authUser!,
        record as TriageRecord
      );
      const saved = db.upsertRecord(sanitized, ownerIdentifier);
      if (incentive && incentive.id && req.authUser) {
        db.insertIncentive(incentive as IncentiveEntry, req.authUser.identifier);
      }
      broadcastRecordEvent(
        {
          type: 'record:created',
          record: saved,
          triggerEmergencySiren: Boolean(triggerEmergencySiren),
        },
        ownerIdentifier
      );
      res.status(201).json({ok: true, record: saved});
    } catch (err) {
      if (err instanceof RecordAuthorizationError) {
        res.status(err.statusCode).json({error: err.message});
        return;
      }
      console.error('[HealthSync DB Error] Failed to save triage record via POST /api/records:', err);
      res.status(500).json({error: 'Database error: Failed to persist triage record.'});
    }
  });

  app.patch('/api/records/:id/dispatch', requireAuth, (req: AuthedRequest, res) => {
    if (req.authUser?.role !== 'DMO') {
      res.status(403).json({error: 'Forbidden: Only DMO officers can dispatch ambulances.'});
      return;
    }
    try {
      const existingWithOwner = db.getRecordWithOwner(req.params.id);
      if (!existingWithOwner) {
        res.status(404).json({error: 'Triage record not found.'});
        return;
      }
      const updated: TriageRecord = {
        ...existingWithOwner.record,
        dispatchStatus: 'Dispatched',
        ambulanceUnit: req.body?.ambulanceUnit || '108-AMB-UP65',
        etaMinutes: Number(req.body?.etaMinutes) || 11,
      };
      db.upsertRecord(updated, existingWithOwner.ownerIdentifier);
      broadcastRecordEvent(
        {type: 'record:updated', record: updated},
        existingWithOwner.ownerIdentifier
      );
      res.json({ok: true, record: updated});
    } catch (err) {
      console.error('[HealthSync DB Error] Failed to update dispatch status:', err);
      res.status(500).json({error: 'Database error: Failed to persist ambulance dispatch.'});
    }
  });

  app.get('/api/incentives', requireAuth, (req: AuthedRequest, res) => {
    res.json({incentives: db.listIncentives(req.authUser?.identifier)});
  });

  // --- SERVER-SIDE GEMINI CLINICAL CO-PILOT ---
  app.post('/api/gemini/clinical-summary', requireAuth, async (req, res) => {
    try {
      const {patientName, age, vitals, symptoms, edgeAi, transcript, language} = req.body || {};
      if (!vitals || typeof vitals.systolic !== 'number') {
        res.status(400).json({error: 'Patient vitals are required for clinical summary.'});
        return;
      }
      const summary = await generateClinicalTriageSummary({
        patientName,
        age,
        vitals,
        symptoms: Array.isArray(symptoms) ? symptoms : [],
        edgeAi,
        transcript,
        language,
      });
      res.json(summary);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gemini clinical summary failed.';
      res.status(502).json({error: msg});
    }
  });

  // --- REAL SMS GATEWAY & AUTHENTICATED INBOUND WEBHOOK ---
  app.post('/api/sms/send', requireAuth, async (req, res) => {
    const {payloadText, recordId, toPhone} = req.body || {};
    if (!payloadText || typeof payloadText !== 'string') {
      res.status(400).json({error: 'SMS payloadText is required.'});
      return;
    }
    const outcome = await dispatchEmergencySms({
      db,
      payloadText,
      recordId: recordId ?? null,
      overrideToPhone: toPhone ? String(toPhone) : undefined,
    });
    res.json(outcome);
  });

  app.get('/api/sms/logs', requireAuth, (req: AuthedRequest, res) => {
    if (req.authUser?.role !== 'DMO') {
      res.status(403).json({error: 'Forbidden: Only DMO officers can inspect district SMS logs.'});
      return;
    }
    res.json({logs: db.listSmsDispatches(30), gateway: getConfiguredSmsGatewayStatus()});
  });

  // SECURITY FIX #4: Carrier inbound webhook requires Twilio HMAC-SHA1 or SMS_WEBHOOK_SECRET
  app.post('/api/sms/webhook', (req, res) => {
    const webhookAuth = verifyInboundSmsWebhookAuth({
      headers: req.headers,
      protocol: req.protocol,
      host: req.get('host') || 'localhost',
      originalUrl: req.originalUrl,
      body: (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>,
    });

    if (!webhookAuth.authorized) {
      res.status(401).json({error: webhookAuth.error || 'Unauthorized SMS webhook request.'});
      return;
    }

    try {
      const rawBody = String(req.body?.Body ?? req.body?.body ?? '').trim();
      const fromPhone = String(req.body?.From ?? req.body?.from ?? 'GSM-MODEM').trim();
      const providerMessageId =
        String(
          req.body?.MessageSid ??
            req.body?.SmsSid ??
            req.body?.MessageId ??
            req.body?.request_id ??
            ''
        ).trim() || null;
      if (!rawBody) {
        res.status(400).json({error: 'Empty inbound SMS body.'});
        return;
      }

      const record = parseInboundSmsWebhookToRecord(fromPhone, rawBody, {providerMessageId});
      const existingRecord = db.getRecordWithOwner(record.id);

      // Idempotency guard: ignore duplicate carrier webhook retries without duplicating records or analytics
      if (existingRecord || db.hasSmsDispatchForRecord(record.id, 'inbound_webhook')) {
        res.type('text/xml').send('<Response></Response>');
        return;
      }

      db.upsertRecord(record, '');
      db.logSmsDispatch({
        recordId: record.id,
        toPhone: fromPhone,
        provider: 'inbound_webhook',
        status: 'received',
        providerMessageId,
        payloadText: rawBody,
        errorMessage: null,
      });
      broadcastRecordEvent(
        {
          type: 'record:created',
          record,
          triggerEmergencySiren: record.severity === 'emergency',
        },
        ''
      );
      res.type('text/xml').send('<Response></Response>');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid SMS payload';
      res.status(400).json({error: msg});
    }
  });

  // --- AUTHENTICATED WEBSOCKET SERVER WITH PING/PONG HEARTBEAT & POST-UPGRADE FRAME AUTH ---
  const sendSafeJson = (sock: WebSocket, payload: unknown) => {
    if (sock.readyState === WebSocket.OPEN) {
      try {
        sock.send(JSON.stringify(payload));
      } catch (err) {
        console.error('[HealthSync WS] Failed to send frame:', err);
      }
    }
  };

  const activateAuthenticatedSocket = (ws: WebSocket, user: AuthenticatedUser) => {
    clients.set(ws, user);
    sendSafeJson(ws, {
      type: 'sync:init',
      records: db.listRecordsForUser(user),
      connectedPeers: clients.size,
    });
    broadcastJson({type: 'presence:count', connectedPeers: clients.size}, ws);
  };

  wss.on('connection', (ws: WebSocket, initialUser: AuthenticatedUser | null) => {
    trackedSockets.add(ws);
    socketAlive.set(ws, true);

    ws.on('pong', () => {
      socketAlive.set(ws, true);
    });

    let authedUser: AuthenticatedUser | null = initialUser ?? null;
    let authDeadlineTimer: ReturnType<typeof setTimeout> | null = null;

    if (authedUser) {
      activateAuthenticatedSocket(ws, authedUser);
    } else {
      authDeadlineTimer = setTimeout(() => {
        if (!authedUser) {
          sendSafeJson(ws, {
            type: 'auth:error',
            error: 'Authentication timeout: No valid auth frame received.',
          });
          try {
            ws.close(4001, 'Authentication timeout');
          } catch {
            ws.terminate();
          }
        }
      }, wsAuthTimeoutMs);
      authDeadlineTimer.unref?.();
    }

    ws.on('message', (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(raw)) as Record<string, unknown>;
      } catch (err) {
        console.error('[HealthSync WS] Malformed JSON message received:', err);
        sendSafeJson(ws, {
          type: 'sync:error',
          recordId: null,
          error: 'Malformed WebSocket JSON payload.',
          retryable: false,
        });
        return;
      }

      if (!authedUser) {
        if (msg.type === 'auth' && typeof msg.token === 'string') {
          const verified = db.verifySessionToken(msg.token);
          if (!verified) {
            sendSafeJson(ws, {
              type: 'auth:error',
              error: 'Unauthorized: Invalid or expired session token.',
            });
            ws.close(4001, 'Unauthorized');
            return;
          }
          if (authDeadlineTimer) {
            clearTimeout(authDeadlineTimer);
            authDeadlineTimer = null;
          }
          authedUser = verified;
          activateAuthenticatedSocket(ws, verified);
          return;
        }

        sendSafeJson(ws, {
          type: 'auth:error',
          error: 'Unauthorized: Authenticate first via { type: "auth", token }.',
        });
        ws.close(4001, 'Unauthorized');
        return;
      }

      const incomingRec = msg.record as TriageRecord | undefined;
      const incomingRecordId =
        incomingRec && typeof incomingRec.id === 'string' ? incomingRec.id : null;

      try {
        if (msg.type === 'record:created' && incomingRec?.id && incomingRec?.vitals) {
          const {sanitized, ownerIdentifier} = authorizeAndSanitizeRecordWrite(
            db,
            authedUser,
            incomingRec
          );
          const saved = db.upsertRecord(sanitized, ownerIdentifier);
          sendSafeJson(ws, {
            type: 'sync:ack',
            recordId: saved.id,
            record: saved,
          });
          broadcastRecordEvent(
            {
              type: 'record:created',
              record: saved,
              triggerEmergencySiren: Boolean(msg.triggerEmergencySiren),
            },
            ownerIdentifier,
            ws
          );
        } else if (msg.type === 'record:updated' && incomingRec?.id && incomingRec?.vitals) {
          if (authedUser.role !== 'DMO') {
            sendSafeJson(ws, {
              type: 'sync:error',
              recordId: incomingRecordId,
              error: 'Forbidden: Only DMO officers can update dispatch records.',
              retryable: false,
            });
            return;
          }
          const {sanitized, ownerIdentifier} = authorizeAndSanitizeRecordWrite(
            db,
            authedUser,
            incomingRec
          );
          const saved = db.upsertRecord(sanitized, ownerIdentifier);
          sendSafeJson(ws, {
            type: 'sync:ack',
            recordId: saved.id,
            record: saved,
          });
          broadcastRecordEvent({type: 'record:updated', record: saved}, ownerIdentifier, ws);
        }
      } catch (err) {
        if (err instanceof RecordAuthorizationError) {
          sendSafeJson(ws, {
            type: 'sync:error',
            recordId: incomingRecordId,
            error: err.message,
            retryable: false,
          });
          return;
        }
        console.error('[HealthSync WS Sync Error] Database write failed during WebSocket sync:', err);
        sendSafeJson(ws, {
          type: 'sync:error',
          recordId: incomingRecordId,
          error: 'Database error: Failed to persist triage record.',
          retryable: true,
        });
      }
    });

    const cleanupSocket = () => {
      if (authDeadlineTimer) {
        clearTimeout(authDeadlineTimer);
        authDeadlineTimer = null;
      }
      trackedSockets.delete(ws);
      if (clients.delete(ws)) {
        broadcastJson({type: 'presence:count', connectedPeers: clients.size});
      }
    };

    ws.on('close', cleanupSocket);
    ws.on('error', (err) => {
      console.error('[HealthSync WS] Socket transport error:', err);
      cleanupSocket();
    });
  });

  // Periodic ping/pong heartbeat to detect and reap dropped/zombie mobile sockets
  const heartbeatTimer = setInterval(() => {
    let prunedAuthedClient = false;
    for (const sock of Array.from(trackedSockets)) {
      if (socketAlive.get(sock) === false) {
        trackedSockets.delete(sock);
        if (clients.delete(sock)) {
          prunedAuthedClient = true;
        }
        try {
          sock.terminate();
        } catch {
          // Ignore termination error on dead socket
        }
        continue;
      }

      socketAlive.set(sock, false);
      if (sock.readyState === WebSocket.OPEN) {
        try {
          sock.ping();
        } catch {
          // Will be terminated on next sweep if broken
        }
      }
    }
    if (prunedAuthedClient) {
      broadcastJson({type: 'presence:count', connectedPeers: clients.size});
    }
  }, heartbeatIntervalMs);
  heartbeatTimer.unref?.();

  let heartbeatStopped = false;
  const stopWebSocketHeartbeat = () => {
    if (heartbeatStopped) return;
    heartbeatStopped = true;
    clearInterval(heartbeatTimer);
    clearInterval(authCleanupTimer);
    authAttempts.clear();
    for (const sock of Array.from(trackedSockets)) {
      trackedSockets.delete(sock);
      try {
        sock.terminate();
      } catch {
        // Ignore
      }
    }
    clients.clear();
  };

  httpServer.on('close', stopWebSocketHeartbeat);
  wss.on('close', stopWebSocketHeartbeat);

  httpServer.on('upgrade', (request, socket, head) => {
    try {
      const parsedUrl = new URL(request.url || '/', 'http://localhost');
      if (parsedUrl.pathname === '/ws/triage') {
        // SECURITY FIX: Never allow session tokens in WebSocket URL query parameters (prevents proxy/LB log leakage)
        if (parsedUrl.searchParams.has('token')) {
          socket.write(
            'HTTP/1.1 400 Bad Request\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nSession tokens must not be passed in URL query parameters.\r\n'
          );
          socket.destroy();
          return;
        }

        const headerAuth =
          typeof request.headers.authorization === 'string' &&
          request.headers.authorization.startsWith('Bearer ')
            ? request.headers.authorization.slice(7).trim()
            : null;

        let initialUser: AuthenticatedUser | null = null;
        if (headerAuth) {
          initialUser = db.verifySessionToken(headerAuth);
          if (!initialUser) {
            socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
          }
        }

        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, initialUser);
        });
      }
    } catch (err) {
      console.error('[HealthSync WS Upgrade Error]:', err);
      socket.destroy();
    }
  });

  return {app, httpServer, db};
}

async function startServer() {
  const {app, httpServer} = await createHealthSyncServer();

  if (process.env.NODE_ENV !== 'production') {
    const {createServer: createViteServer} = await import('vite');
    const vite = await createViteServer({
      server: {middlewareMode: true},
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    const indexHtmlPath = path.join(distPath, 'index.html');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      if (fs.existsSync(indexHtmlPath)) {
        res.sendFile(indexHtmlPath);
      } else {
        res.status(503).send('Production bundle not built yet.');
      }
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`HealthSync Edge Server & SQLite Vault listening on http://0.0.0.0:${PORT}`);
  });
}

// Only auto-listen when executed as main entry point (not when imported by Vitest)
const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMainModule) {
  startServer();
}
