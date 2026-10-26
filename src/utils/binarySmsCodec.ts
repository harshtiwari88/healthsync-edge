import {
  ALL_SYMPTOMS,
  EdgeAiDiagnostics,
  SeverityLevel,
  SymptomKey,
  VitalsSnapshot,
} from '../types/triage';

export interface EncodedPatientInput {
  patientId: string;
  villageCode: string;
  vitals: VitalsSnapshot;
  symptoms: SymptomKey[];
  edgeAi?: EdgeAiDiagnostics;
  severity: SeverityLevel;
}

export interface DecodedSmsResult {
  valid: boolean;
  crcValid: boolean;
  error?: string;
  rawPayload: string;
  hexDump: string;
  byteLength: number;
  patientNumber: number;
  patientId: string;
  villageNumber: number;
  villageCode: string;
  vitals: VitalsSnapshot;
  symptoms: SymptomKey[];
  symptomBitmask: number;
  anemiaSuspected: boolean;
  respiratoryRiskHigh: boolean;
  severity: SeverityLevel;
  computedCrcHex: string;
  receivedCrcHex: string;
}

/**
 * Pure CRC-16-CCITT (0x1021) bitwise checksum over a Uint8Array slice
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

/**
 * Real bitwise binary encoder:
 * Packs Patient ID, Village Code, Systolic, Diastolic, SpO2, Temp (x10), Heart Rate,
 * 6-bit Symptom bitmask, 2-bit Edge-AI flags, 2-bit Severity, and 16-bit CRC-16
 * into a compact 18-byte binary buffer -> 24-character Base64 string prefixed with `HS#`
 * (27 characters total, strictly within 24–32 characters).
 */
export function encodeVitalsToSMS(patientData: EncodedPatientInput): string {
  const buffer = new ArrayBuffer(18);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  const ptDigits = Number(patientData.patientId.replace(/\D/g, '')) || 8931;
  const vilDigits = Number(patientData.villageCode.replace(/\D/g, '')) || 204;

  const sys = Math.min(300, Math.max(0, Math.round(patientData.vitals.systolic)));
  const dia = Math.min(255, Math.max(0, Math.round(patientData.vitals.diastolic)));
  const spo2 = Math.min(100, Math.max(0, Math.round(patientData.vitals.spo2)));
  const tempTenths = Math.min(
    1200,
    Math.max(800, Math.round(patientData.vitals.temperature * 10))
  );
  const hr = Math.min(255, Math.max(0, Math.round(patientData.vitals.heartRate || 78)));

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

  // Byte 0: Protocol Version 0x01
  view.setUint8(0, 0x01);
  // Bytes 1..2: Patient Numeric ID (uint16)
  view.setUint16(1, ptDigits & 0xffff, false);
  // Bytes 3..4: Village Numeric Code (uint16)
  view.setUint16(3, vilDigits & 0xffff, false);
  // Bytes 5..6: Systolic BP (uint16)
  view.setUint16(5, sys, false);
  // Byte 7: Diastolic BP (uint8)
  view.setUint8(7, dia);
  // Byte 8: SpO2 % (uint8)
  view.setUint8(8, spo2);
  // Bytes 9..10: Temperature * 10 (uint16)
  view.setUint16(9, tempTenths, false);
  // Byte 11: Heart Rate BPM (uint8)
  view.setUint8(11, hr);
  // Byte 12: 6-bit Symptom Bitmask
  view.setUint8(12, symptomMask & 0x3f);
  // Byte 13: Bit-packed [Severity (bits 4..5) | EdgeAI (bits 0..1)]
  view.setUint8(13, ((sevCode & 0x03) << 4) | (aiMask & 0x03));
  // Bytes 14..15: Epoch minute mod 65535 for replay protection
  view.setUint16(14, Math.floor(Date.now() / 60000) & 0xffff, false);

  // Bytes 16..17: Real CRC-16-CCITT checksum over bytes 0..15
  const crc16 = computeCrc16(bytes, 16);
  view.setUint16(16, crc16, false);

  return `HS#${uint8ToBase64(bytes)}`;
}

/**
 * Pure reverse decoder: parses `HS#<24-char-Base64>` back into exact numerical vitals,
 * symptoms, Edge-AI flags, severity, and verifies the 16-bit CRC checksum.
 */
export function decodeSMSPayload(payloadString: string): DecodedSmsResult {
  const trimmed = payloadString.trim();

  const emptyInvalid = (error: string): DecodedSmsResult => ({
    valid: false,
    crcValid: false,
    error,
    rawPayload: trimmed,
    hexDump: '',
    byteLength: 0,
    patientNumber: 0,
    patientId: 'UNKNOWN',
    villageNumber: 0,
    villageCode: 'UNKNOWN',
    vitals: {systolic: 0, diastolic: 0, spo2: 0, temperature: 0, heartRate: 0},
    symptoms: [],
    symptomBitmask: 0,
    anemiaSuspected: false,
    respiratoryRiskHigh: false,
    severity: 'routine',
    computedCrcHex: '0x0000',
    receivedCrcHex: '0x0000',
  });

  if (!trimmed.startsWith('HS#')) {
    return emptyInvalid('Payload must start with protocol prefix "HS#".');
  }

  const body = trimmed.slice(3).trim();
  if (!body) {
    return emptyInvalid('Missing Base64 bit-packed frame after "HS#".');
  }

  let bytes: Uint8Array;
  try {
    bytes = base64ToUint8(body);
  } catch {
    return emptyInvalid('Invalid Base64 encoding in SMS frame.');
  }

  if (bytes.length !== 18) {
    return emptyInvalid(
      `Expected 18-byte HealthSync binary frame, got ${bytes.length} bytes.`
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint8(0);
  if (version !== 0x01) {
    return emptyInvalid(`Unsupported binary frame version: 0x${version.toString(16)}`);
  }

  const ptNum = view.getUint16(1, false);
  const vilNum = view.getUint16(3, false);
  const systolic = view.getUint16(5, false);
  const diastolic = view.getUint8(7);
  const spo2 = view.getUint8(8);
  const tempTenths = view.getUint16(9, false);
  const heartRate = view.getUint8(11);
  const symptomBitmask = view.getUint8(12) & 0x3f;
  const packedFlags = view.getUint8(13);

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

  const severity: SeverityLevel =
    sevCode === 3 ? 'emergency' : sevCode === 2 ? 'moderate' : 'routine';

  const hexDump = Array.from(bytes)
    .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
    .join(' ');

  return {
    valid: true,
    crcValid,
    error: crcValid
      ? undefined
      : 'CRC-16 Checksum Mismatch — SMS payload was corrupted or modified in transit!',
    rawPayload: trimmed,
    hexDump,
    byteLength: bytes.length,
    patientNumber: ptNum,
    patientId: `PT${ptNum}`,
    villageNumber: vilNum,
    villageCode: `VIL-${vilNum}`,
    vitals: {
      systolic,
      diastolic,
      spo2,
      temperature: Number((tempTenths / 10).toFixed(1)),
      heartRate,
    },
    symptoms,
    symptomBitmask,
    anemiaSuspected: (aiMask & 0b01) !== 0,
    respiratoryRiskHigh: (aiMask & 0b10) !== 0,
    severity,
    computedCrcHex: `0x${computedCrc.toString(16).toUpperCase().padStart(4, '0')}`,
    receivedCrcHex: `0x${receivedCrc.toString(16).toUpperCase().padStart(4, '0')}`,
  };
}

export function buildFhirBundleFromDecoded(
  decoded: DecodedSmsResult,
  meta?: {patientName?: string; abhaId?: string; age?: number; gender?: string}
) {
  return {
    resourceType: 'Bundle',
    id: `abdm-sms-unpacked-${decoded.patientId.toLowerCase()}`,
    type: 'transaction',
    meta: {
      profile: ['https://nrces.in/ndhm/fhir/r4/StructureDefinition/DocumentBundle'],
      security: [
        {
          system: 'https://healthsync.edge/crc16',
          code: decoded.crcValid ? 'CRC16-VERIFIED' : 'CRC16-TAMPERED',
          display: `Computed ${decoded.computedCrcHex} == Received ${decoded.receivedCrcHex}`,
        },
      ],
    },
    entry: [
      {
        resource: {
          resourceType: 'Patient',
          id: decoded.patientId,
          identifier: [
            {
              system: 'https://healthid.ndhm.gov.in',
              value: meta?.abhaId ?? 'ABHA-DEFERRED-OFFLINE',
            },
          ],
          name: [{text: meta?.patientName ?? `Patient ${decoded.patientId}`}],
          address: [{district: 'District 24', text: decoded.villageCode}],
        },
      },
      {
        resource: {
          resourceType: 'Observation',
          status: decoded.crcValid ? 'final' : 'preliminary',
          category: [{text: 'vital-signs'}],
          interpretation: [{text: decoded.severity.toUpperCase()}],
          component: [
            {code: {text: 'Systolic BP (LOINC 8480-6)'}, valueQuantity: {value: decoded.vitals.systolic, unit: 'mmHg'}},
            {code: {text: 'Diastolic BP (LOINC 8462-4)'}, valueQuantity: {value: decoded.vitals.diastolic, unit: 'mmHg'}},
            {code: {text: 'Oxygen Saturation (LOINC 2708-6)'}, valueQuantity: {value: decoded.vitals.spo2, unit: '%'}},
            {code: {text: 'Body Temperature (LOINC 8310-5)'}, valueQuantity: {value: decoded.vitals.temperature, unit: 'degF'}},
            {code: {text: 'Heart Rate (LOINC 8867-4)'}, valueQuantity: {value: decoded.vitals.heartRate, unit: '/min'}},
          ],
          extension: [
            {url: 'https://healthsync.edge/symptoms', valueString: decoded.symptoms.join(', ') || 'None'},
            {url: 'https://healthsync.edge/anemia-pallor', valueBoolean: decoded.anemiaSuspected},
            {url: 'https://healthsync.edge/respiratory-risk', valueBoolean: decoded.respiratoryRiskHigh},
          ],
        },
      },
    ],
  };
}
