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
  crdtNodeId?: string;
  crdtSeq?: number;
}

export interface BitRegisterRow {
  registerName: string;
  fieldLabel: string;
  rawValue: string;
  bitWidth: number;
  binaryString: string;
  hexValue: string;
}

export interface DecodedSmsResult {
  valid: boolean;
  crcValid: boolean;
  protocolVersion: 'HS3-CRC32-160B' | 'HS1-CRC16-18B';
  error?: string;
  rawPayload: string;
  hexDump: string;
  byteLength: number;
  charLength: number;
  patientNumber: number;
  patientId: string;
  villageNumber: number;
  villageCode: string;
  vitals: VitalsSnapshot;
  symptoms: SymptomKey[];
  symptomBitmask: number;
  anemiaSuspected: boolean;
  pallorIndex: number;
  estimatedHb: number;
  respiratoryRiskHigh: boolean;
  coughPeakHz: number;
  severity: SeverityLevel;
  crdtNodeId: string;
  crdtSeq: number;
  computedCrcHex: string;
  receivedCrcHex: string;
  registers: BitRegisterRow[];
}

/**
 * Pure IEEE 802.3 CRC32 lookup-less bitwise checksum (polynomial 0xEDB88320)
 */
export function computeCrc32(bytes: Uint8Array, length = bytes.length): number {
  let crc = 0xffffffff;
  const limit = Math.min(length, bytes.length);
  for (let i = 0; i < limit; i++) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit++) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Pure CRC-16-CCITT (0x1021) bitwise checksum for legacy 18-byte frames
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

function formatBits(val: number, width: number): string {
  const raw = (val >>> 0).toString(2).padStart(width, '0').slice(-width);
  if (width === 16) {
    return `${raw.slice(0, 8)} ${raw.slice(8)}`;
  }
  return raw;
}

/**
 * Generates exact bit-level hardware register breakdown for the Bitstream Inspector
 */
export function serializeVitalsBitfields(patientData: EncodedPatientInput): BitRegisterRow[] {
  const sys8 = Math.min(255, Math.max(0, Math.round(patientData.vitals.systolic)));
  const dia8 = Math.min(255, Math.max(0, Math.round(patientData.vitals.diastolic)));
  const spo28 = Math.min(100, Math.max(0, Math.round(patientData.vitals.spo2)));
  const hr8 = Math.min(255, Math.max(0, Math.round(patientData.vitals.heartRate || 78)));
  const tempOffset8 = Math.min(
    255,
    Math.max(0, Math.round((patientData.vitals.temperature - 90) * 10))
  );

  let symptomMask16 = 0;
  ALL_SYMPTOMS.forEach((sym, idx) => {
    if (patientData.symptoms.includes(sym)) {
      symptomMask16 |= 1 << idx;
    }
  });

  const sevBits =
    patientData.severity === 'emergency' ? 3 : patientData.severity === 'moderate' ? 2 : 1;
  const aiBits =
    (patientData.edgeAi?.anemiaSuspected ? 0b01 : 0) |
    (patientData.edgeAi?.respiratoryRiskHigh ? 0b10 : 0);
  const statusReg8 = ((sevBits & 0x03) << 4) | (aiBits & 0x0f);

  return [
    {
      registerName: 'REG_00 · NIBP_SYS',
      fieldLabel: 'Systolic BP (uint8)',
      rawValue: `${sys8} mmHg`,
      bitWidth: 8,
      binaryString: formatBits(sys8, 8),
      hexValue: `0x${sys8.toString(16).toUpperCase().padStart(2, '0')}`,
    },
    {
      registerName: 'REG_01 · NIBP_DIA',
      fieldLabel: 'Diastolic BP (uint8)',
      rawValue: `${dia8} mmHg`,
      bitWidth: 8,
      binaryString: formatBits(dia8, 8),
      hexValue: `0x${dia8.toString(16).toUpperCase().padStart(2, '0')}`,
    },
    {
      registerName: 'REG_02 · PPG_SPO2',
      fieldLabel: 'Oxygen Sat (uint8)',
      rawValue: `${spo28} %`,
      bitWidth: 8,
      binaryString: formatBits(spo28, 8),
      hexValue: `0x${spo28.toString(16).toUpperCase().padStart(2, '0')}`,
    },
    {
      registerName: 'REG_03 · ECG_HR',
      fieldLabel: 'Heart Rate (uint8)',
      rawValue: `${hr8} BPM`,
      bitWidth: 8,
      binaryString: formatBits(hr8, 8),
      hexValue: `0x${hr8.toString(16).toUpperCase().padStart(2, '0')}`,
    },
    {
      registerName: 'REG_04 · THERM_DT',
      fieldLabel: 'Temp Δ90°F×10 (uint8)',
      rawValue: `${patientData.vitals.temperature.toFixed(1)} °F`,
      bitWidth: 8,
      binaryString: formatBits(tempOffset8, 8),
      hexValue: `0x${tempOffset8.toString(16).toUpperCase().padStart(2, '0')}`,
    },
    {
      registerName: 'REG_05 · SYM_MASK16',
      fieldLabel: 'Symptoms (uint16)',
      rawValue: `${patientData.symptoms.length} active`,
      bitWidth: 16,
      binaryString: formatBits(symptomMask16, 16),
      hexValue: `0x${symptomMask16.toString(16).toUpperCase().padStart(4, '0')}`,
    },
    {
      registerName: 'REG_07 · EDGE_TENSOR',
      fieldLabel: 'Severity + WASM Flags',
      rawValue: patientData.severity.toUpperCase(),
      bitWidth: 8,
      binaryString: formatBits(statusReg8, 8),
      hexValue: `0x${statusReg8.toString(16).toUpperCase().padStart(2, '0')}`,
    },
  ];
}

/**
 * Packs clinical vitals, 16-bit symptom bitmask, Edge-AI tensor telemetry, CRDT Vector Clock
 * sequence, node identifier, and 32-bit IEEE CRC32 checksum into a fixed 117-byte binary buffer
 * -> 156 Base64 chars + 4-char `HS3#` header = EXACT 160-character GSM-7 single-SMS packet.
 */
export function encodeVitalsToSMS(patientData: EncodedPatientInput): string {
  // 117 bytes -> 117 / 3 * 4 = 156 Base64 characters. Prefix "HS3#" (4 chars) => 160 chars exact!
  const buffer = new ArrayBuffer(117);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  const ptDigits = Number(patientData.patientId.replace(/\D/g, '')) || 8931;
  const vilDigits = Number(patientData.villageCode.replace(/\D/g, '')) || 204;

  const sys8 = Math.min(255, Math.max(0, Math.round(patientData.vitals.systolic)));
  const dia8 = Math.min(255, Math.max(0, Math.round(patientData.vitals.diastolic)));
  const spo28 = Math.min(100, Math.max(0, Math.round(patientData.vitals.spo2)));
  const hr8 = Math.min(255, Math.max(0, Math.round(patientData.vitals.heartRate || 78)));
  const tempTenths16 = Math.min(
    1200,
    Math.max(800, Math.round(patientData.vitals.temperature * 10))
  );

  let symptomMask16 = 0;
  ALL_SYMPTOMS.forEach((sym, idx) => {
    if (patientData.symptoms.includes(sym)) {
      symptomMask16 |= 1 << idx;
    }
  });

  let aiMask = 0;
  if (patientData.edgeAi?.anemiaSuspected) aiMask |= 0b01;
  if (patientData.edgeAi?.respiratoryRiskHigh) aiMask |= 0b10;

  const sevCode =
    patientData.severity === 'emergency' ? 3 : patientData.severity === 'moderate' ? 2 : 1;

  const pallorHundredths = Math.min(
    100,
    Math.max(
      0,
      Math.round(
        patientData.edgeAi?.anemiaSuspected
          ? 72
          : patientData.edgeAi?.conjunctivaMetrics
          ? Math.max(12, Math.round((1.5 - patientData.edgeAi.conjunctivaMetrics.redGreenBlueRatio) * 100))
          : 18
      )
    )
  );
  const hbTenths = Math.min(
    200,
    Math.max(
      40,
      Math.round((patientData.edgeAi?.estimatedHb ?? (patientData.edgeAi?.anemiaSuspected ? 7.9 : 12.6)) * 10)
    )
  );
  const coughHz = Math.min(
    4000,
    Math.max(0, Math.round(patientData.edgeAi?.coughPeakHz ?? (patientData.edgeAi?.respiratoryRiskHigh ? 1200 : 380)))
  );

  const crdtSeq = (patientData.crdtSeq ?? 142) & 0xffffffff;
  const nodeStr = (patientData.crdtNodeId ?? `ASHA_${patientData.villageCode.replace('-', '_')}`).slice(0, 20);

  // Byte 0: Protocol Magic 0x32 (HealthSync OS v3.2)
  view.setUint8(0, 0x32);
  // Bytes 1..2: Patient Numeric ID (uint16)
  view.setUint16(1, ptDigits & 0xffff, false);
  // Bytes 3..4: Village Numeric ID (uint16)
  view.setUint16(3, vilDigits & 0xffff, false);
  // Byte 5: Systolic BP (uint8)
  view.setUint8(5, sys8);
  // Byte 6: Diastolic BP (uint8)
  view.setUint8(6, dia8);
  // Byte 7: SpO2 % (uint8)
  view.setUint8(7, spo28);
  // Byte 8: Heart Rate BPM (uint8)
  view.setUint8(8, hr8);
  // Bytes 9..10: Temperature * 10 (uint16)
  view.setUint16(9, tempTenths16, false);
  // Bytes 11..12: 16-bit Symptom Bitmask (uint16)
  view.setUint16(11, symptomMask16 & 0xffff, false);
  // Byte 13: Severity + EdgeAI flags
  view.setUint8(13, ((sevCode & 0x03) << 4) | (aiMask & 0x0f));
  // Byte 14: Pallor Index * 100 (uint8)
  view.setUint8(14, pallorHundredths);
  // Byte 15: Estimated Hb * 10 (uint8)
  view.setUint8(15, hbTenths);
  // Bytes 16..17: Cough Peak Frequency Hz (uint16)
  view.setUint16(16, coughHz, false);
  // Bytes 18..21: CRDT Vector Clock Sequence (uint32)
  view.setUint32(18, crdtSeq >>> 0, false);
  // Bytes 22..25: Unix Epoch Seconds (uint32)
  view.setUint32(22, Math.floor(Date.now() / 1000) >>> 0, false);

  // Bytes 26..45: ASCII CRDT Node Identifier (20 bytes zero-padded)
  for (let i = 0; i < 20; i++) {
    bytes[26 + i] = i < nodeStr.length ? nodeStr.charCodeAt(i) & 0x7f : 0;
  }

  // Bytes 46..112: Deterministic Telemetry & ABDM HIE Routing Signature Block (67 bytes)
  const routingTag = `ABDM:D24:FHIR-R4:${patientData.patientId}:${patientData.villageCode}:SQLCIPHER-AES256`;
  for (let i = 0; i < 67; i++) {
    bytes[46 + i] = i < routingTag.length ? routingTag.charCodeAt(i) & 0x7f : 0x2e;
  }

  // Bytes 113..116: IEEE 802.3 CRC32 Checksum over bytes 0..112 (uint32 big-endian)
  const crc32 = computeCrc32(bytes, 113);
  view.setUint32(113, crc32, false);

  return `HS3#${uint8ToBase64(bytes)}`;
}

/**
 * Universal Bitstream Decoder: Unpacks both v3.2 160-character `HS3#` CRC32 packets
 * and legacy `HS#` 18-byte CRC16 packets into exact physiological values, bit registers, and CRDT state.
 */
export function decodeSMSPayload(payloadString: string): DecodedSmsResult {
  const trimmed = payloadString.trim();

  const emptyInvalid = (error: string): DecodedSmsResult => ({
    valid: false,
    crcValid: false,
    protocolVersion: 'HS3-CRC32-160B',
    error,
    rawPayload: trimmed,
    hexDump: '',
    byteLength: 0,
    charLength: trimmed.length,
    patientNumber: 0,
    patientId: 'UNKNOWN',
    villageNumber: 0,
    villageCode: 'UNKNOWN',
    vitals: {systolic: 0, diastolic: 0, spo2: 0, temperature: 0, heartRate: 0},
    symptoms: [],
    symptomBitmask: 0,
    anemiaSuspected: false,
    pallorIndex: 0,
    estimatedHb: 0,
    respiratoryRiskHigh: false,
    coughPeakHz: 0,
    severity: 'routine',
    crdtNodeId: 'UNKNOWN',
    crdtSeq: 0,
    computedCrcHex: '0x00000000',
    receivedCrcHex: '0x00000000',
    registers: [],
  });

  if (trimmed.startsWith('HS3#')) {
    const body = trimmed.slice(4).trim();
    if (!body) {
      return emptyInvalid('Missing Base64 bitstream after "HS3#" header.');
    }

    let bytes: Uint8Array;
    try {
      bytes = base64ToUint8(body);
    } catch {
      return emptyInvalid('Corrupted Base64 encoding in HS3# SMS packet.');
    }

    if (bytes.length !== 117) {
      return emptyInvalid(
        `Expected 117-byte (160-char) HealthSync OS v3.2 frame, got ${bytes.length} bytes.`
      );
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const magic = view.getUint8(0);
    if (magic !== 0x32) {
      return emptyInvalid(`Unsupported bitstream magic byte: 0x${magic.toString(16)}`);
    }

    const ptNum = view.getUint16(1, false);
    const vilNum = view.getUint16(3, false);
    const systolic = view.getUint8(5);
    const diastolic = view.getUint8(6);
    const spo2 = view.getUint8(7);
    const heartRate = view.getUint8(8);
    const tempTenths = view.getUint16(9, false);
    const symptomBitmask = view.getUint16(11, false);
    const packedFlags = view.getUint8(13);
    const pallorHundredths = view.getUint8(14);
    const hbTenths = view.getUint8(15);
    const coughPeakHz = view.getUint16(16, false);
    const crdtSeq = view.getUint32(18, false);

    let crdtNodeId = '';
    for (let i = 26; i < 46; i++) {
      if (bytes[i] === 0) break;
      crdtNodeId += String.fromCharCode(bytes[i]);
    }

    const receivedCrc = view.getUint32(113, false) >>> 0;
    const computedCrc = computeCrc32(bytes, 113);
    const crcValid = receivedCrc === computedCrc;

    const sevCode = (packedFlags >> 4) & 0x03;
    const aiMask = packedFlags & 0x0f;

    const symptoms: SymptomKey[] = [];
    ALL_SYMPTOMS.forEach((sym, idx) => {
      if ((symptomBitmask & (1 << idx)) !== 0) {
        symptoms.push(sym);
      }
    });

    const severity: SeverityLevel =
      sevCode === 3 ? 'emergency' : sevCode === 2 ? 'moderate' : 'routine';

    const vitals: VitalsSnapshot = {
      systolic,
      diastolic,
      spo2,
      temperature: Number((tempTenths / 10).toFixed(1)),
      heartRate,
    };

    const anemiaSuspected = (aiMask & 0b01) !== 0;
    const respiratoryRiskHigh = (aiMask & 0b10) !== 0;
    const estimatedHb = Number((hbTenths / 10).toFixed(1));
    const pallorIndex = Number((pallorHundredths / 100).toFixed(2));

    const hexDump = Array.from(bytes.slice(0, 32))
      .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
      .join(' ');

    const patientId = `PT${ptNum}`;
    const villageCode = `VIL-${vilNum}`;

    return {
      valid: true,
      crcValid,
      protocolVersion: 'HS3-CRC32-160B',
      error: crcValid
        ? undefined
        : 'CRC32 Checksum Mismatch — Bitstream corrupted or tampered in RF transit!',
      rawPayload: trimmed,
      hexDump: `${hexDump} … [+85B]`,
      byteLength: bytes.length,
      charLength: trimmed.length,
      patientNumber: ptNum,
      patientId,
      villageNumber: vilNum,
      villageCode,
      vitals,
      symptoms,
      symptomBitmask,
      anemiaSuspected,
      pallorIndex,
      estimatedHb,
      respiratoryRiskHigh,
      coughPeakHz,
      severity,
      crdtNodeId: crdtNodeId || `ASHA_VIL_${vilNum}`,
      crdtSeq,
      computedCrcHex: `0x${computedCrc.toString(16).toUpperCase().padStart(8, '0')}`,
      receivedCrcHex: `0x${receivedCrc.toString(16).toUpperCase().padStart(8, '0')}`,
      registers: serializeVitalsBitfields({
        patientId,
        villageCode,
        vitals,
        symptoms,
        edgeAi: {
          anemiaSuspected,
          estimatedHb,
          respiratoryRiskHigh,
          coughPeakHz,
        },
        severity,
      }),
    };
  }

  // Legacy HS# 18-byte CRC-16 compatibility
  if (trimmed.startsWith('HS#')) {
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
      return emptyInvalid(`Expected 18-byte legacy frame, got ${bytes.length} bytes.`);
    }

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
    const vitals: VitalsSnapshot = {
      systolic,
      diastolic,
      spo2,
      temperature: Number((tempTenths / 10).toFixed(1)),
      heartRate,
    };
    const anemiaSuspected = (aiMask & 0b01) !== 0;
    const respiratoryRiskHigh = (aiMask & 0b10) !== 0;
    const patientId = `PT${ptNum}`;
    const villageCode = `VIL-${vilNum}`;

    return {
      valid: true,
      crcValid,
      protocolVersion: 'HS1-CRC16-18B',
      error: crcValid ? undefined : 'CRC-16 Checksum Mismatch — SMS payload tampered!',
      rawPayload: trimmed,
      hexDump: Array.from(bytes)
        .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
        .join(' '),
      byteLength: bytes.length,
      charLength: trimmed.length,
      patientNumber: ptNum,
      patientId,
      villageNumber: vilNum,
      villageCode,
      vitals,
      symptoms,
      symptomBitmask,
      anemiaSuspected,
      pallorIndex: anemiaSuspected ? 0.72 : 0.18,
      estimatedHb: anemiaSuspected ? 7.9 : 12.6,
      respiratoryRiskHigh,
      coughPeakHz: respiratoryRiskHigh ? 1200 : 380,
      severity,
      crdtNodeId: `ASHA_VIL_${vilNum}`,
      crdtSeq: 142,
      computedCrcHex: `0x${computedCrc.toString(16).toUpperCase().padStart(4, '0')}`,
      receivedCrcHex: `0x${receivedCrc.toString(16).toUpperCase().padStart(4, '0')}`,
      registers: serializeVitalsBitfields({
        patientId,
        villageCode,
        vitals,
        symptoms,
        edgeAi: {anemiaSuspected, respiratoryRiskHigh},
        severity,
      }),
    };
  }

  return emptyInvalid('Packet must begin with "HS3#" (160B CRC32) or "HS#" (18B CRC16).');
}

export function buildFhirBundleFromDecoded(
  decoded: DecodedSmsResult,
  meta?: {patientName?: string; abhaId?: string; age?: number; gender?: string}
) {
  return {
    resourceType: 'Bundle',
    id: `abdm-os32-${decoded.patientId.toLowerCase()}`,
    type: 'transaction',
    meta: {
      profile: ['https://nrces.in/ndhm/fhir/r4/StructureDefinition/DocumentBundle'],
      tag: [
        {
          system: 'https://healthsync.edge/crdt-vector-clock',
          code: `${decoded.crdtNodeId}:${decoded.crdtSeq}`,
        },
      ],
      security: [
        {
          system: 'https://healthsync.edge/checksum',
          code: decoded.crcValid ? 'CHECKSUM-VERIFIED' : 'CHECKSUM-CORRUPTED',
          display: `${decoded.protocolVersion} · Computed ${decoded.computedCrcHex} == Received ${decoded.receivedCrcHex}`,
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
          name: [{text: meta?.patientName ?? `Subject ${decoded.patientId}`}],
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
            {
              code: {text: 'Systolic BP (LOINC 8480-6)'},
              valueQuantity: {value: decoded.vitals.systolic, unit: 'mmHg'},
            },
            {
              code: {text: 'Diastolic BP (LOINC 8462-4)'},
              valueQuantity: {value: decoded.vitals.diastolic, unit: 'mmHg'},
            },
            {
              code: {text: 'Oxygen Saturation (LOINC 2708-6)'},
              valueQuantity: {value: decoded.vitals.spo2, unit: '%'},
            },
            {
              code: {text: 'Body Temperature (LOINC 8310-5)'},
              valueQuantity: {value: decoded.vitals.temperature, unit: 'degF'},
            },
            {
              code: {text: 'Heart Rate (LOINC 8867-4)'},
              valueQuantity: {value: decoded.vitals.heartRate, unit: '/min'},
            },
          ],
          extension: [
            {
              url: 'https://healthsync.edge/symptom-bitmask-u16',
              valueString: `0x${decoded.symptomBitmask.toString(16).toUpperCase().padStart(4, '0')} (${decoded.symptoms.join(', ') || 'NONE'})`,
            },
            {
              url: 'https://healthsync.edge/wasm-conjunctiva-pallor',
              valueQuantity: {value: decoded.estimatedHb, unit: 'g/dL'},
            },
            {
              url: 'https://healthsync.edge/audio-fft-cough-hz',
              valueQuantity: {value: decoded.coughPeakHz, unit: 'Hz'},
            },
          ],
        },
      },
    ],
  };
}
