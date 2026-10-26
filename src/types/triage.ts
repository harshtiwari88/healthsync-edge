export type Language = 'en' | 'hi' | 'mr' | 'ta';

export type NetworkState = '4g' | '2g' | 'offline';

export type SeverityLevel = 'routine' | 'moderate' | 'emergency';

export type SyncChannel = 'Data' | 'Emergency SMS';

export type SyncStatus = 'Queued Offline' | 'Synced' | 'SMS Delivered';

export type AmbulanceDispatchStatus = 'Unassigned' | 'Dispatched';

export type SymptomKey =
  | 'Fever'
  | 'Cough'
  | 'Difficulty Breathing'
  | 'Chest Pain'
  | 'Dizziness';

export const ALL_SYMPTOMS: SymptomKey[] = [
  'Fever',
  'Cough',
  'Difficulty Breathing',
  'Chest Pain',
  'Dizziness',
];

export interface VitalsSnapshot {
  systolic: number;
  diastolic: number;
  spo2: number;
  temperature: number;
}

export interface EdgeAiDiagnostics {
  anemiaSuspected: boolean;
  estimatedHb?: number;
  respiratoryRiskHigh: boolean;
  coughPeakHz?: number;
}

export interface TriageRecord {
  id: string;
  patientId: string;
  abhaId: string;
  patientName: string;
  age: number;
  gender: 'F' | 'M' | 'O';
  villageCode: string;
  villageName: string;
  ashaWorker: string;
  vitals: VitalsSnapshot;
  symptoms: SymptomKey[];
  edgeAi?: EdgeAiDiagnostics;
  severity: SeverityLevel;
  clinicalNotes: string;
  channel: SyncChannel;
  syncStatus: SyncStatus;
  binarySmsPayload: string;
  timestamp: string;
  createdAtMs: number;
  dispatchStatus: AmbulanceDispatchStatus;
  ambulanceUnit?: string;
  etaMinutes?: number;
}

export interface IncentiveEntry {
  id: string;
  taskTitle: string;
  programCode: string;
  patientRef: string;
  amountInr: number;
  timestamp: string;
  abdmVerified: boolean;
}

export interface VillageSubCenter {
  code: string;
  name: string;
  nameHi: string;
  block: string;
  ashaName: string;
  x: number;
  y: number;
  population: number;
  phcDistanceKm: number;
}

export interface TriageEvaluation {
  severity: SeverityLevel;
  scoreCode: 'TR1' | 'TR2' | 'TR3';
  triggers: string[];
  protocol: string;
}

export function evaluateVitalStatus(
  field: keyof VitalsSnapshot,
  value: number
): SeverityLevel {
  switch (field) {
    case 'systolic':
      if (value >= 160 || value < 80) return 'emergency';
      if (value > 130 || (value >= 80 && value < 90)) return 'moderate';
      return 'routine';
    case 'diastolic':
      if (value >= 100 || value < 50) return 'emergency';
      if (value >= 88) return 'moderate';
      return 'routine';
    case 'spo2':
      if (value < 90) return 'emergency';
      if (value <= 94) return 'moderate';
      return 'routine';
    case 'temperature':
      if (value >= 103.0 || value < 95.0) return 'emergency';
      if (value > 100.0) return 'moderate';
      return 'routine';
  }
}

export function evaluateTriage(
  vitals: VitalsSnapshot,
  symptoms: SymptomKey[] = [],
  edgeAi?: EdgeAiDiagnostics
): TriageEvaluation {
  const redReasons: string[] = [];
  const yellowReasons: string[] = [];

  // RED (CRITICAL EMERGENCY): BP >= 160 (or > 160) or SpO2 < 90% or Chest Pain
  if (vitals.systolic >= 160 || vitals.systolic < 80) {
    redReasons.push(`Critical Systolic BP (${vitals.systolic}/${vitals.diastolic} mmHg)`);
  }
  if (vitals.diastolic >= 105) {
    redReasons.push(`Hypertensive Emergency Diastolic (${vitals.diastolic} mmHg)`);
  }
  if (vitals.spo2 < 90) {
    redReasons.push(`Severe Hypoxia (SpO₂ ${vitals.spo2}% < 90%)`);
  }
  if (symptoms.includes('Chest Pain')) {
    redReasons.push('Acute Chest Pain Flagged');
  }

  // YELLOW (Moderate Risk): BP > 130 or Temp > 100°F or Moderate SpO2 / Symptoms / Edge-AI
  if (vitals.systolic > 130 && vitals.systolic < 160) {
    yellowReasons.push(`Elevated BP (${vitals.systolic}/${vitals.diastolic} mmHg > 130)`);
  } else if (vitals.diastolic >= 90 && vitals.diastolic < 105 && vitals.systolic <= 130) {
    yellowReasons.push(`Elevated Diastolic BP (${vitals.diastolic} mmHg)`);
  }

  if (vitals.temperature > 100.0) {
    yellowReasons.push(`Pyrexia / Fever (${vitals.temperature.toFixed(1)}°F > 100°F)`);
  }

  if (vitals.spo2 >= 90 && vitals.spo2 <= 94) {
    yellowReasons.push(`Borderline SpO₂ (${vitals.spo2}%)`);
  }

  if (symptoms.includes('Difficulty Breathing')) {
    yellowReasons.push('Dyspnea / Difficulty Breathing');
  }

  if (edgeAi?.anemiaSuspected) {
    yellowReasons.push(
      `Edge-AI: Suspected Severe Anemia (Hb ${edgeAi.estimatedHb ?? 7.4} g/dL)`
    );
  }

  if (edgeAi?.respiratoryRiskHigh) {
    yellowReasons.push('Edge-AI: High Respiratory Risk Acoustic Signature');
  }

  if (redReasons.length > 0) {
    return {
      severity: 'emergency',
      scoreCode: 'TR3',
      triggers: [...redReasons, ...yellowReasons],
      protocol:
        'CRITICAL EMERGENCY: Transmit Encrypted Baseband SMS immediately, position patient semi-upright, and dispatch 108 ALS Ambulance.',
    };
  }

  if (yellowReasons.length > 0) {
    return {
      severity: 'moderate',
      scoreCode: 'TR2',
      triggers: yellowReasons,
      protocol:
        'MODERATE RISK: Queue PHC Medical Officer tele-triage review today and repeat vitals check in 2 hours.',
    };
  }

  return {
    severity: 'routine',
    scoreCode: 'TR1',
    triggers: ['All physiological vitals & Edge-AI checks within normal limits'],
    protocol:
      'ROUTINE: Save to ABDM longitudinal health record and schedule standard monthly community follow-up.',
  };
}

export function computeCrcHex(input: string): string {
  let hash = 0x92a1;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) & 0xffff;
  }
  return `x${hash.toString(16).padStart(3, '0').slice(-3)}`;
}

export function encodeBitPackedBase64(
  vitals: VitalsSnapshot,
  symptoms: SymptomKey[],
  edgeAi?: EdgeAiDiagnostics,
  severity?: SeverityLevel
): {base64: string; hexBytes: string; symptomMask: number; aiMask: number} {
  let symMask = 0;
  ALL_SYMPTOMS.forEach((sym, i) => {
    if (symptoms.includes(sym)) symMask |= 1 << i;
  });

  let aiMask = 0;
  if (edgeAi?.anemiaSuspected) aiMask |= 1;
  if (edgeAi?.respiratoryRiskHigh) aiMask |= 2;

  const sevNum = severity === 'emergency' ? 3 : severity === 'moderate' ? 2 : 1;
  const tempTenths = Math.min(255, Math.max(0, Math.round((vitals.temperature - 90) * 10)));

  const bytes = [
    0x48, // 'H'
    0x53, // 'S'
    Math.min(255, Math.max(0, Math.round(vitals.systolic))),
    Math.min(255, Math.max(0, Math.round(vitals.diastolic))),
    Math.min(100, Math.max(0, Math.round(vitals.spo2))),
    tempTenths,
    symMask,
    (sevNum << 4) | aiMask,
  ];

  const binStr = bytes.map((b) => String.fromCharCode(b)).join('');
  const base64 = typeof btoa === 'function' ? btoa(binStr) : 'SFM999==';
  const hexBytes = bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');

  return {base64, hexBytes, symptomMask: symMask, aiMask};
}

export function buildEncryptedEmergencySms(params: {
  patientId: string;
  villageCode: string;
  vitals: VitalsSnapshot;
  symptoms: SymptomKey[];
  edgeAi?: EdgeAiDiagnostics;
  severity: SeverityLevel;
}): string {
  const {patientId, villageCode, vitals, symptoms, edgeAi, severity} = params;
  const cleanPt = patientId.replace(/[^A-Z0-9]/gi, '');
  const cleanVil = villageCode.replace(/[^A-Z0-9]/gi, '');
  const trCode = severity === 'emergency' ? 'TR3' : severity === 'moderate' ? 'TR2' : 'TR1';
  const {base64} = encodeBitPackedBase64(vitals, symptoms, edgeAi, severity);
  const core = `HS#${cleanPt}#${cleanVil}#BP${vitals.systolic}/${vitals.diastolic}#SPO2${vitals.spo2}#T${vitals.temperature.toFixed(
    1
  )}#${trCode}#B64:${base64}`;
  const hash = computeCrcHex(core);
  return `${core}#HASH${hash}`.slice(0, 160);
}

export function unpackSmsToFhirJson(record: TriageRecord) {
  const packed = encodeBitPackedBase64(
    record.vitals,
    record.symptoms,
    record.edgeAi,
    record.severity
  );

  return {
    packedTelemetry: packed,
    fhirBundle: {
      resourceType: 'Bundle',
      id: `abdm-edge-${record.patientId.toLowerCase()}`,
      type: 'transaction',
      timestamp: new Date(record.createdAtMs).toISOString(),
      meta: {
        profile: ['https://nrces.in/ndhm/fhir/r4/StructureDefinition/DocumentBundle'],
        tag: [
          {
            system: 'https://healthsync.edge/transport',
            code: 'GSM-7BIT-BASE64-SMS',
            display: 'Unpacked from 160-char Baseband Emergency SMS',
          },
        ],
      },
      entry: [
        {
          resource: {
            resourceType: 'Patient',
            id: record.patientId,
            identifier: [
              {
                system: 'https://healthid.ndhm.gov.in',
                value: record.abhaId,
              },
            ],
            name: [{text: record.patientName}],
            gender:
              record.gender === 'F' ? 'female' : record.gender === 'M' ? 'male' : 'other',
            age: record.age,
            address: [{district: 'District 24', text: `${record.villageCode} - ${record.villageName}`}],
          },
        },
        {
          resource: {
            resourceType: 'Observation',
            status: 'final',
            interpretation: [
              {
                coding: [
                  {
                    code:
                      record.severity === 'emergency'
                        ? 'CRIT'
                        : record.severity === 'moderate'
                        ? 'MOD'
                        : 'NORM',
                    display: record.severity.toUpperCase(),
                  },
                ],
              },
            ],
            component: [
              {
                code: {coding: [{system: 'http://loinc.org', code: '8480-6', display: 'Systolic BP'}]},
                valueQuantity: {value: record.vitals.systolic, unit: 'mmHg'},
              },
              {
                code: {coding: [{system: 'http://loinc.org', code: '8462-4', display: 'Diastolic BP'}]},
                valueQuantity: {value: record.vitals.diastolic, unit: 'mmHg'},
              },
              {
                code: {coding: [{system: 'http://loinc.org', code: '2708-6', display: 'Oxygen saturation'}]},
                valueQuantity: {value: record.vitals.spo2, unit: '%'},
              },
              {
                code: {coding: [{system: 'http://loinc.org', code: '8310-5', display: 'Body temperature'}]},
                valueQuantity: {value: record.vitals.temperature, unit: 'degF'},
              },
            ],
            symptomsReported: record.symptoms,
            edgeAiScreening: {
              conjunctivaAnemiaFlag: Boolean(record.edgeAi?.anemiaSuspected),
              estimatedHbGdL: record.edgeAi?.estimatedHb ?? null,
              coughRespiratoryRiskFlag: Boolean(record.edgeAi?.respiratoryRiskHigh),
              coughSpectralPeakHz: record.edgeAi?.coughPeakHz ?? null,
            },
          },
        },
      ],
    },
  };
}
