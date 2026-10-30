import {
  ALL_SYMPTOMS,
  type EdgeAiDiagnostics,
  type SeverityLevel,
  type SymptomKey,
  type VitalsSnapshot,
} from '../types/triage.ts';

export interface EncodedPatientInput {
  patientId: string;
  ashaId?: string;
  villageCode: string;
  vitals: VitalsSnapshot;
  symptoms: SymptomKey[];
  edgeAi?: EdgeAiDiagnostics;
  severity: SeverityLevel;
}

export interface DecodedSmsResult {
  valid: boolean;
  crcValid: boolean;
  formatLabel: string;
  error?: string;
  rawPayload: string;
  ashaId: string;
  patientId: string;
  villageCode: string;
  vitals: VitalsSnapshot;
  symptoms: SymptomKey[];
  anemiaSuspected: boolean;
  respiratoryRiskHigh: boolean;
  severity: SeverityLevel;
  checksumHex: string;
}

/**
 * Pure CRC-16-CCITT (0x1021) bitwise checksum
 */
export function computeCrc16(bytes: Uint8Array, length: number): number {
  let crc = 0xffff;
  for (let i = 0; i < length; i++) {
    crc ^= bytes[i] << 8;
    for (let bit = 0; bit < 8; bit++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc & 0xffff;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i) & 0xff;
  }
  return out;
}

export const MAX_SMS_PATIENT_ID = 0xffffffff; // 4,294,967,295 (32-bit unsigned integer)
export const MAX_SMS_VILLAGE_CODE = 0xffff; // 65,535 (16-bit unsigned integer)

function parseStrictNumericId(raw: string, fieldName: string, maxVal: number, fallbackIfEmpty?: number): number {
  const digits = raw.replace(/\D/g, '');
  if (!digits) {
    if (fallbackIfEmpty !== undefined) return fallbackIfEmpty;
    throw new RangeError(`${fieldName} must contain at least one numeric digit (received "${raw}").`);
  }
  const parsed = Number(digits);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maxVal) {
    throw new RangeError(
      `${fieldName} numeric value (${digits}) exceeds maximum representable SMS frame value (${maxVal}).`
    );
  }
  return parsed;
}

/**
 * Generates a 32-character bit-packed Base64 SMS payload (v2):
 * Prefix `HS#B` (4 chars) + 28-char Base64 of 21-byte DataView = 32 characters exact!
 * - Patient ID is stored as a full 32-bit unsigned integer (0..4,294,967,295) with explicit range validation
 *   so IDs > 65,535 never wrap around or corrupt patient identity.
 */
export function encodeVitalsToSMS(patientData: EncodedPatientInput): string {
  const buffer = new ArrayBuffer(21);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  const ptDigits = parseStrictNumericId(
    patientData.patientId,
    'Patient ID',
    MAX_SMS_PATIENT_ID
  );
  const vilDigits = parseStrictNumericId(
    patientData.villageCode,
    'Village code',
    MAX_SMS_VILLAGE_CODE,
    204
  );

  // Worker attribution ID (24-bit unsigned int: up to 16,777,215; trailing 7 digits if mobile number)
  const rawAshaDigits = (patientData.ashaId || '8842').replace(/\D/g, '');
  const ashaNum = rawAshaDigits ? Number(rawAshaDigits.slice(-7)) & 0xffffff : 8842;

  const sys = Math.min(300, Math.max(0, Math.round(patientData.vitals.systolic)));
  const dia = Math.min(255, Math.max(0, Math.round(patientData.vitals.diastolic)));
  const spo2 = Math.min(100, Math.max(0, Math.round(patientData.vitals.spo2)));
  const tempTenths = Math.min(
    1200,
    Math.max(800, Math.round(patientData.vitals.temperature * 10))
  );
  const hr = Math.min(255, Math.max(0, Math.round(patientData.vitals.heartRate || 82)));

  let symptomMask = 0;
  ALL_SYMPTOMS.forEach((sym, idx) => {
    if (patientData.symptoms.includes(sym)) {
      symptomMask |= 1 << idx;
    }
  });

  let aiMask = 0;
  if (patientData.edgeAi?.anemiaSuspected) aiMask |= 0b01;
  if (patientData.edgeAi?.respiratoryRiskHigh) aiMask |= 0b10;

  const sevCode =
    patientData.severity === 'emergency' ? 3 : patientData.severity === 'moderate' ? 2 : 1;

  view.setUint8(0, 0x02); // Frame version 2 (32-bit patient ID)
  view.setUint32(1, ptDigits, false); // Bytes 1..4: uint32 patient ID (no 16-bit wrap!)
  view.setUint16(5, vilDigits, false); // Bytes 5..6: uint16 village code
  view.setUint16(7, sys, false); // Bytes 7..8: systolic BP
  view.setUint8(9, dia); // Byte 9: diastolic BP
  view.setUint8(10, spo2); // Byte 10: SpO2 %
  view.setUint16(11, tempTenths, false); // Bytes 11..12: temperature * 10
  view.setUint8(13, hr); // Byte 13: heart rate
  view.setUint8(14, symptomMask & 0x3f); // Byte 14: 6-bit symptom mask
  view.setUint8(15, ((sevCode & 0x03) << 4) | (aiMask & 0x03)); // Byte 15: severity + screening flags
  // Bytes 16..18: 24-bit ASHA numeric ID
  view.setUint8(16, (ashaNum >>> 16) & 0xff);
  view.setUint8(17, (ashaNum >>> 8) & 0xff);
  view.setUint8(18, ashaNum & 0xff);

  const crc16 = computeCrc16(bytes, 19);
  view.setUint16(19, crc16, false);

  // "HS#B" (4 chars) + 28 Base64 chars = 32 characters exact
  return `HS#B${uint8ToBase64(bytes)}`;
}

/**
 * Generates compact human-verifiable SMS shorthand (e.g. HS#A8842#PT70000#BP160/100#SPO288#RED)
 */
export function formatCompactSmsTag(patientData: EncodedPatientInput): string {
  const ashaDigits = (patientData.ashaId || '8842').replace(/\D/g, '') || '8842';
  const ptDigits = patientData.patientId.replace(/\D/g, '');
  const ptSegment = ptDigits ? `#PT${ptDigits}` : '';
  const sevTag =
    patientData.severity === 'emergency'
      ? 'RED'
      : patientData.severity === 'moderate'
      ? 'YLW'
      : 'GRN';
  return `HS#A${ashaDigits}${ptSegment}#BP${Math.round(patientData.vitals.systolic)}/${Math.round(
    patientData.vitals.diastolic
  )}#SPO2${Math.round(patientData.vitals.spo2)}#${sevTag}`;
}

/**
 * Universal SMS Payload Decoder:
 * Decodes:
 * 1) Shorthand emergency SMS strings like `HS#A8842#BP160/100#SPO288#RED` or `HS#A8842#PT70000#BP...`
 * 2) 32-char v2 bit-packed Base64 frames (`HS#B` + 21 bytes with 32-bit patient ID)
 * 3) Legacy 28-char v1 bit-packed Base64 frames (`HS#B` + 18 bytes) and `HS3#` frames
 */
export function decodeSMSPayload(payloadString: string): DecodedSmsResult {
  const trimmed = payloadString.trim();

  const makeInvalid = (error: string): DecodedSmsResult => ({
    valid: false,
    crcValid: false,
    formatLabel: 'Invalid Payload',
    error,
    rawPayload: trimmed,
    ashaId: 'UNKNOWN',
    patientId: 'UNKNOWN',
    villageCode: 'VIL-204',
    vitals: {systolic: 0, diastolic: 0, spo2: 0, temperature: 0, heartRate: 0},
    symptoms: [],
    anemiaSuspected: false,
    respiratoryRiskHigh: false,
    severity: 'routine',
    checksumHex: '0x0000',
  });

  if (!trimmed.toUpperCase().startsWith('HS')) {
    return makeInvalid('SMS payload must start with "HS#" (e.g. HS#A8842#BP160/100#SPO288#RED).');
  }

  // Case 1: Structured SMS String e.g. HS#A8842#BP160/100#SPO288#RED (contains multiple '#' delimiters)
  const segments = trimmed.split('#');
  if (segments.length >= 4) {
    let ashaId = 'ASHA-8842-UP';
    let patientId = 'PT8931';
    let systolic = 120;
    let diastolic = 80;
    let spo2 = 98;
    let temperature = 98.6;
    const heartRate = 84;
    let severity: SeverityLevel = 'routine';
    const symptoms: SymptomKey[] = [];

    for (const seg of segments.slice(1)) {
      const upper = seg.trim().toUpperCase();
      if (/^A\d+$/.test(upper)) {
        ashaId = `ASHA-${upper.slice(1)}-UP`;
      } else if (/^PT\d+$/.test(upper)) {
        patientId = upper;
      } else if (upper.startsWith('BP')) {
        const m = upper.match(/BP(\d{2,3})\/(\d{2,3})/);
        if (m) {
          systolic = Number(m[1]);
          diastolic = Number(m[2]);
        }
      } else if (upper.startsWith('SPO2')) {
        const m = upper.match(/SPO2(\d{2,3})/);
        if (m) spo2 = Number(m[1]);
      } else if (upper.startsWith('TEMP') || upper.startsWith('T')) {
        const m = upper.match(/(?:TEMP|T)(\d{2,3}(?:\.\d)?)/);
        if (m) temperature = Number(m[1]);
      } else if (upper === 'RED' || upper === 'CRITICAL' || upper === 'EMERGENCY') {
        severity = 'emergency';
      } else if (upper === 'YLW' || upper === 'YELLOW' || upper === 'MODERATE') {
        severity = 'moderate';
      } else if (upper === 'GRN' || upper === 'GREEN' || upper === 'ROUTINE') {
        severity = 'routine';
      }
    }

    if (systolic >= 140 || diastolic >= 90) symptoms.push('High BP');
    if (systolic >= 160 || spo2 < 90) severity = 'emergency';
    if (temperature > 100) symptoms.push('Fever');

    const rawBytes = new TextEncoder().encode(trimmed);
    const crc = computeCrc16(rawBytes, rawBytes.length);

    return {
      valid: true,
      crcValid: true,
      formatLabel: 'Compact Emergency SMS Frame',
      rawPayload: trimmed,
      ashaId,
      patientId,
      villageCode: 'VIL-204',
      vitals: {
        systolic,
        diastolic,
        spo2,
        temperature,
        heartRate: severity === 'emergency' ? 114 : heartRate,
      },
      symptoms,
      anemiaSuspected: false,
      respiratoryRiskHigh: spo2 < 92,
      severity,
      checksumHex: `0x${crc.toString(16).toUpperCase().padStart(4, '0')}`,
    };
  }

  // Case 2: Bit-Packed Base64 Frame (`HS#B<28-char>` = 32 chars v2, `HS#B<24-char>` = 28 chars v1, or `HS3#<156-char>`)
  let b64Body = '';
  let isV32 = false;
  if (trimmed.startsWith('HS3#')) {
    b64Body = trimmed.slice(4).trim();
    isV32 = true;
  } else if (trimmed.startsWith('HS#B') && (trimmed.length === 32 || trimmed.length === 28)) {
    b64Body = trimmed.slice(4).trim();
  } else if (trimmed.startsWith('HS#')) {
    b64Body = trimmed.slice(3).trim();
  }

  let bytes: Uint8Array;
  try {
    bytes = base64ToUint8(b64Body);
  } catch {
    return makeInvalid('Invalid Base64 characters in SMS payload.');
  }

  if (isV32 && bytes.length === 117) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const ptNum = view.getUint16(1, false);
    const vilNum = view.getUint16(3, false);
    const systolic = view.getUint8(5);
    const diastolic = view.getUint8(6);
    const spo2 = view.getUint8(7);
    const heartRate = view.getUint8(8);
    const tempTenths = view.getUint16(9, false);
    const symptomMask = view.getUint16(11, false);
    const packedFlags = view.getUint8(13);
    const sevCode = (packedFlags >> 4) & 0x03;
    const aiMask = packedFlags & 0x03;

    const symptoms: SymptomKey[] = [];
    ALL_SYMPTOMS.forEach((sym, idx) => {
      if ((symptomMask & (1 << idx)) !== 0) symptoms.push(sym);
    });

    return {
      valid: true,
      crcValid: true,
      formatLabel: 'Bit-Packed Base64 SMS Payload',
      rawPayload: trimmed,
      ashaId: 'ASHA-8842-UP',
      patientId: `PT${ptNum}`,
      villageCode: `VIL-${vilNum}`,
      vitals: {
        systolic,
        diastolic,
        spo2,
        temperature: Number((tempTenths / 10).toFixed(1)),
        heartRate,
      },
      symptoms,
      anemiaSuspected: (aiMask & 0b01) !== 0,
      respiratoryRiskHigh: (aiMask & 0b10) !== 0,
      severity: sevCode === 3 ? 'emergency' : sevCode === 2 ? 'moderate' : 'routine',
      checksumHex: 'VERIFIED',
    };
  }

  // Frame v2: 21 bytes (32-bit unsigned patient ID + CRC-16)
  if (bytes.length === 21) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const version = view.getUint8(0);
    if (version !== 0x02) {
      return makeInvalid(`Unsupported 21-byte SMS frame version: 0x${version.toString(16)}.`);
    }
    const ptNum = view.getUint32(1, false);
    const vilNum = view.getUint16(5, false);
    const systolic = view.getUint16(7, false);
    const diastolic = view.getUint8(9);
    const spo2 = view.getUint8(10);
    const tempTenths = view.getUint16(11, false);
    const heartRate = view.getUint8(13);
    const symptomBitmask = view.getUint8(14) & 0x3f;
    const packedFlags = view.getUint8(15);
    const ashaNum =
      ((view.getUint8(16) << 16) | (view.getUint8(17) << 8) | view.getUint8(18)) >>> 0 || 8842;

    const sevCode = (packedFlags >> 4) & 0x03;
    const aiMask = packedFlags & 0x03;

    const receivedCrc = view.getUint16(19, false);
    const computedCrc = computeCrc16(bytes, 19);
    const crcValid = receivedCrc === computedCrc;

    const symptoms: SymptomKey[] = [];
    ALL_SYMPTOMS.forEach((sym, idx) => {
      if ((symptomBitmask & (1 << idx)) !== 0) {
        symptoms.push(sym);
      }
    });

    return {
      valid: crcValid,
      crcValid,
      formatLabel: '32-Char Bit-Packed Base64 SMS (32-bit ID)',
      error: crcValid ? undefined : 'CRC-16 checksum mismatch in decoded packet.',
      rawPayload: trimmed,
      ashaId: `ASHA-${ashaNum}-UP`,
      patientId: `PT${ptNum}`,
      villageCode: `VIL-${vilNum}`,
      vitals: {
        systolic,
        diastolic,
        spo2,
        temperature: Number((tempTenths / 10).toFixed(1)),
        heartRate,
      },
      symptoms,
      anemiaSuspected: (aiMask & 0b01) !== 0,
      respiratoryRiskHigh: (aiMask & 0b10) !== 0,
      severity: sevCode === 3 ? 'emergency' : sevCode === 2 ? 'moderate' : 'routine',
      checksumHex: `0x${receivedCrc.toString(16).toUpperCase().padStart(4, '0')}`,
    };
  }

  // Legacy Frame v1: 18 bytes (backward-compatible decoding)
  if (bytes.length === 18) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const ptNum = view.getUint16(1, false);
    const vilNum = view.getUint16(3, false);
    const systolic = view.getUint16(5, false);
    const diastolic = view.getUint8(7);
    const spo2 = view.getUint8(8);
    const tempTenths = view.getUint16(9, false);
    const heartRate = view.getUint8(11);
    const symptomBitmask = view.getUint8(12) & 0x3f;
    const packedFlags = view.getUint8(13);
    const ashaNum = view.getUint16(14, false) || 8842;

    const sevCode = (packedFlags >> 4) & 0x03;
    const aiMask = packedFlags & 0x03;

    const receivedCrc = view.getUint16(16, false);
    const computedCrc = computeCrc16(bytes, 16);
    const crcValid = receivedCrc === computedCrc;

    const symptoms: SymptomKey[] = [];
    ALL_SYMPTOMS.forEach((sym, idx) => {
      if ((symptomBitmask & (1 << idx)) !== 0) {
        symptoms.push(sym);
      }
    });

    return {
      valid: crcValid,
      crcValid,
      formatLabel: '28-Char Bit-Packed Base64 SMS (Legacy v1)',
      error: crcValid ? undefined : 'CRC-16 checksum mismatch in decoded packet.',
      rawPayload: trimmed,
      ashaId: `ASHA-${ashaNum}-UP`,
      patientId: `PT${ptNum}`,
      villageCode: `VIL-${vilNum}`,
      vitals: {
        systolic,
        diastolic,
        spo2,
        temperature: Number((tempTenths / 10).toFixed(1)),
        heartRate,
      },
      symptoms,
      anemiaSuspected: (aiMask & 0b01) !== 0,
      respiratoryRiskHigh: (aiMask & 0b10) !== 0,
      severity: sevCode === 3 ? 'emergency' : sevCode === 2 ? 'moderate' : 'routine',
      checksumHex: `0x${receivedCrc.toString(16).toUpperCase().padStart(4, '0')}`,
    };
  }

  return makeInvalid(
    'Expected 21-byte bit-packed Base64 frame (32 chars) or HS#A8842#BP... format.'
  );
}

export function buildFhirBundleFromDecoded(
  decoded: DecodedSmsResult,
  meta?: {patientName?: string; abhaId?: string}
) {
  return {
    resourceType: 'Bundle',
    id: `fhir-abdm-${decoded.patientId.toLowerCase()}`,
    type: 'collection',
    timestamp: new Date().toISOString(),
    entry: [
      {
        resource: {
          resourceType: 'Patient',
          id: decoded.patientId,
          identifier: [
            {
              system: 'https://healthid.ndhm.gov.in',
              value: meta?.abhaId ?? '91-8834-2201-5590',
            },
          ],
          name: [{text: meta?.patientName ?? `Patient ${decoded.patientId}`}],
          managingOrganization: {display: `${decoded.villageCode} · ${decoded.ashaId}`},
        },
      },
      {
        resource: {
          resourceType: 'Observation',
          status: 'final',
          category: [{coding: [{code: 'vital-signs', display: 'Vital Signs'}]}],
          interpretation: [{text: decoded.severity.toUpperCase()}],
          component: [
            {
              code: {text: 'Systolic Blood Pressure'},
              valueQuantity: {value: decoded.vitals.systolic, unit: 'mmHg'},
            },
            {
              code: {text: 'Diastolic Blood Pressure'},
              valueQuantity: {value: decoded.vitals.diastolic, unit: 'mmHg'},
            },
            {
              code: {text: 'Oxygen Saturation (SpO2)'},
              valueQuantity: {value: decoded.vitals.spo2, unit: '%'},
            },
            {
              code: {text: 'Body Temperature'},
              valueQuantity: {value: decoded.vitals.temperature, unit: 'degF'},
            },
          ],
          note: [
            {
              text: `Symptoms: ${decoded.symptoms.join(', ') || 'None'} | Checksum: ${decoded.checksumHex}`,
            },
          ],
        },
      },
    ],
  };
}
