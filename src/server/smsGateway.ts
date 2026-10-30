import crypto from 'crypto';
import type {TriageRecord} from '../types/triage.ts';
import {decodeSMSPayload} from '../utils/binarySmsCodec.ts';
import type {HealthSyncDatabase, SmsDispatchLog} from './db.ts';

export interface OutboundSmsResult {
  sent: boolean;
  gatewayConfigured: boolean;
  provider: 'twilio' | 'fast2sms' | 'unconfigured';
  toPhone: string;
  providerMessageId: string | null;
  nativeSmsUri: string;
  statusMessage: string;
  dispatchLog: SmsDispatchLog;
}

export class SmsAuthorizationError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode = 403) {
    super(message);
    this.name = 'SmsAuthorizationError';
    this.statusCode = statusCode;
  }
}

export function normalizeE164Phone(raw: string): string {
  const cleaned = raw.trim().replace(/[\s()-]/g, '');
  if (!cleaned) return '';
  return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
}

export function maskPhoneNumber(rawPhone: string): string {
  const clean = (rawPhone || '').trim();
  if (clean.length <= 6) return '••••••';
  return `${clean.slice(0, 3)}••••••${clean.slice(-4)}`;
}

export function getAllowedSmsRecipients(): string[] {
  const primary = normalizeE164Phone(process.env.DMO_EMERGENCY_PHONE || '+9118001801104');
  const allowlistRaw = process.env.ALLOWED_SMS_RECIPIENTS || '';
  const extras = allowlistRaw
    .split(',')
    .map((p) => normalizeE164Phone(p))
    .filter((p) => /^\+\d{8,15}$/.test(p));
  return Array.from(new Set([primary, ...extras].filter((p) => /^\+\d{8,15}$/.test(p))));
}

export function validateOutboundEmergencySmsPayload(payloadText: string): void {
  const trimmed = String(payloadText || '').trim();
  if (!trimmed || trimmed.length > 160) {
    throw new SmsAuthorizationError(
      'Invalid SMS payload: Must be a compact HealthSync frame (max 160 characters).',
      400
    );
  }
  const decoded = decodeSMSPayload(trimmed);
  if (!decoded.valid || !decoded.crcValid) {
    throw new SmsAuthorizationError(
      'Rejected SMS payload: Frame failed HealthSync CRC-16 integrity verification.',
      400
    );
  }
  if (decoded.severity !== 'emergency') {
    throw new SmsAuthorizationError(
      'Forbidden: Outbound carrier SMS gateway is restricted strictly to emergency (TR3) patient alerts.',
      403
    );
  }
}

export function getConfiguredSmsGatewayStatus(options?: {includeSensitive?: boolean}): {
  configured: boolean;
  provider: 'twilio' | 'fast2sms' | 'unconfigured';
  maskedRecipient: string;
  dmoEmergencyPhone?: string;
} {
  const dmoEmergencyPhone = normalizeE164Phone(process.env.DMO_EMERGENCY_PHONE || '+9118001801104');
  const maskedRecipient = maskPhoneNumber(dmoEmergencyPhone);
  const hasTwilio = Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() &&
      process.env.TWILIO_AUTH_TOKEN?.trim() &&
      process.env.TWILIO_FROM_NUMBER?.trim()
  );
  const hasFast2Sms = Boolean(process.env.FAST2SMS_API_KEY?.trim());
  const provider: 'twilio' | 'fast2sms' | 'unconfigured' = hasTwilio
    ? 'twilio'
    : hasFast2Sms
    ? 'fast2sms'
    : 'unconfigured';

  return {
    configured: provider !== 'unconfigured',
    provider,
    maskedRecipient,
    ...(options?.includeSensitive ? {dmoEmergencyPhone} : {}),
  };
}

export function buildNativeSmsUri(toPhone: string, body: string): string {
  const cleanPhone = toPhone.replace(/[^\d+]/g, '');
  return `sms:${cleanPhone}?body=${encodeURIComponent(body)}`;
}

export async function dispatchEmergencySms(params: {
  db: HealthSyncDatabase;
  payloadText: string;
  recordId?: string | null;
  requestedToPhone?: string;
}): Promise<OutboundSmsResult> {
  validateOutboundEmergencySmsPayload(params.payloadText);

  const allowedRecipients = getAllowedSmsRecipients();
  let toPhone = allowedRecipients[0] || '+9118001801104';

  if (params.requestedToPhone !== undefined && params.requestedToPhone.trim() !== '') {
    const candidate = normalizeE164Phone(params.requestedToPhone);
    if (!allowedRecipients.includes(candidate)) {
      throw new SmsAuthorizationError(
        'Forbidden: Arbitrary toPhone overrides are prohibited. SMS alerts can only be sent to verified hospital emergency numbers.',
        403
      );
    }
    toPhone = candidate;
  }

  const dailyGlobalCap = Math.max(5, Number(process.env.SMS_DAILY_GLOBAL_LIMIT) || 100);
  if (params.db.countRecentOutboundSms(24 * 60 * 60 * 1000) >= dailyGlobalCap) {
    throw new SmsAuthorizationError(
      'Carrier SMS daily safety cap reached. Use native device GSM text fallback or contact DMO administration.',
      429
    );
  }

  const gateway = getConfiguredSmsGatewayStatus({includeSensitive: true});
  const maskedPhone = maskPhoneNumber(toPhone);
  const nativeSmsUri = buildNativeSmsUri(toPhone, params.payloadText);

  if (gateway.provider === 'twilio') {
    const sid = process.env.TWILIO_ACCOUNT_SID!.trim();
    const token = process.env.TWILIO_AUTH_TOKEN!.trim();
    const from = process.env.TWILIO_FROM_NUMBER!.trim();
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`;
    const authHeader = Buffer.from(`${sid}:${token}`).toString('base64');

    try {
      const form = new URLSearchParams({
        To: toPhone,
        From: from,
        Body: params.payloadText,
      });
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${authHeader}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      });
      const rawTwilioText = await resp.text();
      let json: {sid?: string; message?: string} = {};
      try {
        json = JSON.parse(rawTwilioText) as {sid?: string; message?: string};
      } catch {
        json = {};
      }
      if (!resp.ok) {
        const errMsg = json.message || `Twilio HTTP ${resp.status}`;
        const log = params.db.logSmsDispatch({
          recordId: params.recordId ?? null,
          toPhone: maskedPhone,
          provider: 'twilio',
          status: 'failed',
          providerMessageId: null,
          payloadText: params.payloadText,
          errorMessage: errMsg,
        });
        return {
          sent: false,
          gatewayConfigured: true,
          provider: 'twilio',
          toPhone: maskedPhone,
          providerMessageId: null,
          nativeSmsUri,
          statusMessage: `Twilio SMS error: ${errMsg}`,
          dispatchLog: log,
        };
      }

      const log = params.db.logSmsDispatch({
        recordId: params.recordId ?? null,
        toPhone: maskedPhone,
        provider: 'twilio',
        status: 'sent',
        providerMessageId: json.sid ?? null,
        payloadText: params.payloadText,
        errorMessage: null,
      });

      return {
        sent: true,
        gatewayConfigured: true,
        provider: 'twilio',
        toPhone: maskedPhone,
        providerMessageId: json.sid ?? null,
        nativeSmsUri,
        statusMessage: `Delivered to Twilio carrier gateway (SID: ${json.sid ?? 'OK'})`,
        dispatchLog: log,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const log = params.db.logSmsDispatch({
        recordId: params.recordId ?? null,
        toPhone: maskedPhone,
        provider: 'twilio',
        status: 'failed',
        providerMessageId: null,
        payloadText: params.payloadText,
        errorMessage: errMsg,
      });
      return {
        sent: false,
        gatewayConfigured: true,
        provider: 'twilio',
        toPhone: maskedPhone,
        providerMessageId: null,
        nativeSmsUri,
        statusMessage: `Twilio network failure: ${errMsg}`,
        dispatchLog: log,
      };
    }
  }

  if (gateway.provider === 'fast2sms') {
    const apiKey = process.env.FAST2SMS_API_KEY!.trim();
    const digitsOnly = toPhone.replace(/\D/g, '').slice(-10);
    try {
      const resp = await fetch('https://www.fast2sms.com/dev/bulkV2', {
        method: 'POST',
        headers: {
          authorization: apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          route: 'q',
          message: params.payloadText,
          language: 'english',
          flash: 0,
          numbers: digitsOnly,
        }),
      });
      const rawFastText = await resp.text();
      let json: {
        return?: boolean;
        request_id?: string;
        message?: string[] | string;
      } = {};
      try {
        json = JSON.parse(rawFastText) as {
          return?: boolean;
          request_id?: string;
          message?: string[] | string;
        };
      } catch {
        json = {};
      }
      if (!resp.ok || json.return === false) {
        const errMsg = Array.isArray(json.message)
          ? json.message.join(', ')
          : json.message || `Fast2SMS HTTP ${resp.status}`;
        const log = params.db.logSmsDispatch({
          recordId: params.recordId ?? null,
          toPhone: maskedPhone,
          provider: 'fast2sms',
          status: 'failed',
          providerMessageId: null,
          payloadText: params.payloadText,
          errorMessage: errMsg,
        });
        return {
          sent: false,
          gatewayConfigured: true,
          provider: 'fast2sms',
          toPhone: maskedPhone,
          providerMessageId: null,
          nativeSmsUri,
          statusMessage: `Fast2SMS error: ${errMsg}`,
          dispatchLog: log,
        };
      }

      const log = params.db.logSmsDispatch({
        recordId: params.recordId ?? null,
        toPhone: maskedPhone,
        provider: 'fast2sms',
        status: 'sent',
        providerMessageId: json.request_id ?? null,
        payloadText: params.payloadText,
        errorMessage: null,
      });

      return {
        sent: true,
        gatewayConfigured: true,
        provider: 'fast2sms',
        toPhone: maskedPhone,
        providerMessageId: json.request_id ?? null,
        nativeSmsUri,
        statusMessage: `Delivered via Fast2SMS gateway (Request ID: ${json.request_id ?? 'OK'})`,
        dispatchLog: log,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const log = params.db.logSmsDispatch({
        recordId: params.recordId ?? null,
        toPhone: maskedPhone,
        provider: 'fast2sms',
        status: 'failed',
        providerMessageId: null,
        payloadText: params.payloadText,
        errorMessage: errMsg,
      });
      return {
        sent: false,
        gatewayConfigured: true,
        provider: 'fast2sms',
        toPhone: maskedPhone,
        providerMessageId: null,
        nativeSmsUri,
        statusMessage: `Fast2SMS network failure: ${errMsg}`,
        dispatchLog: log,
      };
    }
  }

  // Honest unconfigured carrier state: logs payload in SQLite and provides native device sms: URI
  const log = params.db.logSmsDispatch({
    recordId: params.recordId ?? null,
    toPhone: maskedPhone,
    provider: 'unconfigured',
    status: 'queued_no_credentials',
    providerMessageId: null,
    payloadText: params.payloadText,
    errorMessage:
      'Server carrier gateway (TWILIO_* or FAST2SMS_API_KEY) not set; use native device SMS app link or configure carrier secrets.',
  });

  return {
    sent: false,
    gatewayConfigured: false,
    provider: 'unconfigured',
    toPhone: maskedPhone,
    providerMessageId: null,
    nativeSmsUri,
    statusMessage:
      'Logged to server SMS queue. Carrier API credentials (TWILIO_* / FAST2SMS_API_KEY) are not configured — tap "Open Device SMS App" on mobile to transmit over GSM.',
    dispatchLog: log,
  };
}

/**
 * Computes a deterministic idempotency record ID for inbound carrier SMS webhooks so
 * carrier retries (Twilio / Fast2SMS / GSM gateways) never create duplicate triage records:
 * 1) Uses carrier `providerMessageId` (`MessageSid`, `SmsSid`, `request_id`) when provided, OR
 * 2) Hashes normalized `(fromPhone, rawPayload)` within a 15-minute carrier retry window.
 */
export function computeInboundSmsRecordId(
  fromPhone: string,
  rawPayload: string,
  providerMessageId?: string | null,
  nowMs = Date.now()
): string {
  const trimmedSid = providerMessageId?.trim() || '';
  if (trimmedSid.length > 0) {
    const digest = crypto.createHash('sha256').update(`sid:${trimmedSid}`, 'utf8').digest('hex');
    return `rec-sms-${digest.slice(0, 24)}`;
  }

  const normalizedPhone = (fromPhone || 'GSM-MODEM').trim().toUpperCase();
  const normalizedPayload = rawPayload.trim();
  const retryWindowBucket = Math.floor(nowMs / (15 * 60 * 1000));
  const digest = crypto
    .createHash('sha256')
    .update(`msg:${normalizedPhone}:${normalizedPayload}:${retryWindowBucket}`, 'utf8')
    .digest('hex');
  return `rec-sms-${digest.slice(0, 24)}`;
}

/**
 * Parses an inbound carrier SMS webhook (Twilio `Body` & `From`, or generic `{ body, from }`)
 * into a persisted TriageRecord with a deterministic idempotency ID.
 */
export function parseInboundSmsWebhookToRecord(
  fromPhone: string,
  smsBody: string,
  options?: {providerMessageId?: string | null; nowMs?: number}
): TriageRecord {
  const decoded = decodeSMSPayload(smsBody);
  if (!decoded.valid) {
    throw new Error(decoded.error || 'Invalid inbound HealthSync SMS payload');
  }

  const effectiveNowMs = options?.nowMs ?? Date.now();
  const now = new Date(effectiveNowMs);
  const timeStr = now.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
  const deterministicId = computeInboundSmsRecordId(
    fromPhone,
    decoded.rawPayload,
    options?.providerMessageId,
    effectiveNowMs
  );

  return {
    id: deterministicId,
    patientId: decoded.patientId,
    abhaId: '91-0000-0000-0000',
    patientName: `SMS Referral (${decoded.patientId})`,
    age: 45,
    gender: 'O',
    villageCode: decoded.villageCode,
    villageName: `${decoded.villageCode} Sub-Center`,
    ashaWorker: `${decoded.ashaId} (${fromPhone || 'GSM'})`,
    vitals: decoded.vitals,
    symptoms: decoded.symptoms,
    edgeAi: {
      anemiaSuspected: decoded.anemiaSuspected,
      respiratoryRiskHigh: decoded.respiratoryRiskHigh,
    },
    severity: decoded.severity,
    clinicalNotes: `Inbound Carrier SMS Webhook from ${fromPhone || 'field modem'} (${decoded.formatLabel})`,
    channel: 'Emergency SMS',
    syncStatus: 'SMS Delivered',
    binarySmsPayload: decoded.rawPayload,
    timestamp: timeStr,
    createdAtMs: effectiveNowMs,
    dispatchStatus: 'Unassigned',
  };
}

function timingSafeCompareStrings(a: string, b: string): boolean {
  const digestA = crypto.createHash('sha256').update(a, 'utf8').digest();
  const digestB = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

function readSingleHeader(
  headers: Record<string, string | string[] | undefined>,
  lowerName: string
): string {
  const raw = headers[lowerName] ?? headers[lowerName.toLowerCase()];
  if (Array.isArray(raw)) return (raw[0] || '').trim();
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * Computes Twilio's official X-Twilio-Signature HMAC-SHA1 Base64 digest:
 * Full URL + alphabetically sorted POST body keys & values concatenated.
 */
export function computeTwilioWebhookSignature(
  authToken: string,
  fullUrl: string,
  params: Record<string, unknown>
): string {
  let payload = fullUrl;
  if (params && typeof params === 'object') {
    const sortedKeys = Object.keys(params).sort();
    for (const key of sortedKeys) {
      const val = params[key];
      if (val !== undefined && val !== null) {
        payload += key + String(val);
      }
    }
  }
  return crypto.createHmac('sha1', authToken).update(payload, 'utf8').digest('base64');
}

/**
 * Authenticates inbound `/api/sms/webhook` requests (fail-closed):
 * 1) Validates Twilio `X-Twilio-Signature` using `TWILIO_AUTH_TOKEN` (HMAC-SHA1 + timingSafeEqual), OR
 * 2) Validates `SMS_WEBHOOK_SECRET` (min 12 chars) from `X-Webhook-Secret`, `X-Fast2SMS-Signature`, or Bearer header.
 * Rejects unauthenticated requests if neither valid credential is verified.
 */
export function verifyInboundSmsWebhookAuth(reqContext: {
  headers: Record<string, string | string[] | undefined>;
  protocol: string;
  host: string;
  originalUrl: string;
  body: Record<string, unknown>;
}): {authorized: boolean; method?: 'twilio_hmac' | 'webhook_secret'; error?: string} {
  const twilioToken = process.env.TWILIO_AUTH_TOKEN?.trim() || '';
  const twilioSig = readSingleHeader(reqContext.headers, 'x-twilio-signature');

  if (twilioToken && twilioSig) {
    const forwardedProto = readSingleHeader(reqContext.headers, 'x-forwarded-proto').split(',')[0]?.trim();
    const forwardedHost = readSingleHeader(reqContext.headers, 'x-forwarded-host').split(',')[0]?.trim();
    const effectiveProto = forwardedProto || reqContext.protocol || 'http';
    const effectiveHost = forwardedHost || reqContext.host || 'localhost';

    const candidateUrls = new Set<string>([
      `${effectiveProto}://${effectiveHost}${reqContext.originalUrl}`,
      `${reqContext.protocol || 'http'}://${reqContext.host || 'localhost'}${reqContext.originalUrl}`,
    ]);
    const configuredAppUrl = process.env.APP_URL?.trim();
    if (configuredAppUrl && configuredAppUrl !== 'MY_APP_URL') {
      candidateUrls.add(`${configuredAppUrl.replace(/\/$/, '')}${reqContext.originalUrl}`);
    }

    for (const url of candidateUrls) {
      const expected = computeTwilioWebhookSignature(twilioToken, url, reqContext.body || {});
      if (timingSafeCompareStrings(twilioSig, expected)) {
        return {authorized: true, method: 'twilio_hmac'};
      }
    }
    return {
      authorized: false,
      error: 'Unauthorized: Invalid X-Twilio-Signature HMAC verification.',
    };
  }

  const webhookSecret = process.env.SMS_WEBHOOK_SECRET?.trim() || '';
  if (webhookSecret && webhookSecret.length >= 12) {
    const authHeader = readSingleHeader(reqContext.headers, 'authorization');
    const bearerSecret = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const headerSecret =
      readSingleHeader(reqContext.headers, 'x-webhook-secret') ||
      readSingleHeader(reqContext.headers, 'x-fast2sms-signature') ||
      bearerSecret;

    if (headerSecret && timingSafeCompareStrings(headerSecret, webhookSecret)) {
      return {authorized: true, method: 'webhook_secret'};
    }
    return {
      authorized: false,
      error: 'Unauthorized: Missing or invalid SMS webhook authentication secret.',
    };
  }

  if (twilioToken) {
    return {
      authorized: false,
      error: 'Unauthorized: Missing X-Twilio-Signature header for Twilio webhook.',
    };
  }

  return {
    authorized: false,
    error:
      'Unauthorized: Inbound SMS webhook authentication is not configured (set TWILIO_AUTH_TOKEN or SMS_WEBHOOK_SECRET >= 12 chars).',
  };
}
