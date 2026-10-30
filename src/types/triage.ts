export type Language = 'en' | 'hi' | 'mr' | 'ta';

export type NetworkState = '4g' | '2g' | 'offline';

export type SeverityLevel = 'routine' | 'moderate' | 'emergency';

export type SyncChannel = 'Data' | 'Emergency SMS';

export type SyncStatus = 'Queued Offline' | 'Synced' | 'SMS Delivered';

export type AmbulanceDispatchStatus = 'Unassigned' | 'Dispatched';

export type SymptomKey =
  | 'Fever'
  | 'High BP'
  | 'Severe Chest Pain'
  | 'Dizziness'
  | 'Cough'
  | 'Bleeding';

export const ALL_SYMPTOMS: SymptomKey[] = [
  'Fever',
  'High BP',
  'Severe Chest Pain',
  'Dizziness',
  'Cough',
  'Bleeding',
];

export interface VitalsSnapshot {
  systolic: number;
  diastolic: number;
  spo2: number;
  temperature: number;
  heartRate: number;
}

export interface ConjunctivaPixelMetrics {
  avgR: number;
  avgG: number;
  avgB: number;
  redGreenBlueRatio: number;
  erythemaIndex: number;
  estimatedHb: number;
  pallorDetected: boolean;
  diagnosticLabel: string;
  capturedDataUrl?: string;
}

export interface CoughAudioMetrics {
  dominantFrequencyHz: number;
  rmsIntensity: number;
  highRespiratoryRisk: boolean;
  diagnosticLabel: string;
}

export interface EdgeAiDiagnostics {
  anemiaSuspected: boolean;
  estimatedHb?: number;
  conjunctivaMetrics?: ConjunctivaPixelMetrics;
  respiratoryRiskHigh: boolean;
  coughPeakHz?: number;
  coughMetrics?: CoughAudioMetrics;
}

export type LawfulBasisType = 'explicit_consent' | 'medical_emergency_vital_interest';

export interface PatientConsentMetadata {
  lawfulBasis: LawfulBasisType;
  consentGranted: boolean;
  consentTimestampMs: number;
  isMinor: boolean;
  guardianName?: string;
  guardianRelationship?: 'Mother' | 'Father' | 'Legal Guardian';
  verifiableGuardianConsent?: boolean;
  aiProcessingConsent?: boolean;
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
  patientConsent?: PatientConsentMetadata;
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
  protocolEn: string;
  protocolHi: string;
}

export function evaluateVitalStatus(
  field: keyof VitalsSnapshot,
  value: number
): SeverityLevel {
  const safeVal = Number.isFinite(Number(value)) ? Number(value) : 0;
  switch (field) {
    case 'systolic':
      if (safeVal >= 160 || safeVal < 80) return 'emergency';
      if (safeVal > 130 || (safeVal >= 80 && safeVal < 90)) return 'moderate';
      return 'routine';
    case 'diastolic':
      if (safeVal >= 100 || safeVal < 50) return 'emergency';
      if (safeVal >= 88) return 'moderate';
      return 'routine';
    case 'spo2':
      if (safeVal < 90) return 'emergency';
      if (safeVal <= 94) return 'moderate';
      return 'routine';
    case 'temperature':
      if (safeVal >= 103.0 || safeVal < 95.0) return 'emergency';
      if (safeVal > 100.0) return 'moderate';
      return 'routine';
    case 'heartRate':
      if (safeVal >= 130 || safeVal < 45) return 'emergency';
      if (safeVal > 100 || safeVal < 55) return 'moderate';
      return 'routine';
  }
}

export function evaluateTriage(
  vitals?: Partial<VitalsSnapshot> | null,
  symptoms: SymptomKey[] | null | undefined = [],
  edgeAi?: EdgeAiDiagnostics | null
): TriageEvaluation {
  const systolic = Number.isFinite(Number(vitals?.systolic)) ? Number(vitals?.systolic) : 120;
  const diastolic = Number.isFinite(Number(vitals?.diastolic)) ? Number(vitals?.diastolic) : 80;
  const spo2 = Number.isFinite(Number(vitals?.spo2)) ? Number(vitals?.spo2) : 98;
  const temperature = Number.isFinite(Number(vitals?.temperature))
    ? Number(vitals?.temperature)
    : 98.6;
  const heartRate = Number.isFinite(Number(vitals?.heartRate)) ? Number(vitals?.heartRate) : 76;
  const safeSymptoms = Array.isArray(symptoms) ? symptoms : [];

  const redReasons: string[] = [];
  const yellowReasons: string[] = [];

  if (systolic >= 160 || systolic < 80) {
    redReasons.push(`Critical Systolic BP (${systolic}/${diastolic} mmHg)`);
  }
  if (diastolic >= 105) {
    redReasons.push(`Critical Diastolic BP (${diastolic} mmHg)`);
  }
  if (spo2 < 90) {
    redReasons.push(`Severe Hypoxia (SpO₂ ${spo2}% < 90%)`);
  }
  if (heartRate >= 130 || heartRate < 45) {
    redReasons.push(`Critical Heart Rate (${heartRate} BPM)`);
  }
  if (safeSymptoms.includes('Severe Chest Pain')) {
    redReasons.push('Severe Chest Pain Reported');
  }
  if (safeSymptoms.includes('Bleeding')) {
    redReasons.push('Active Hemorrhage / Bleeding Flagged');
  }

  if (systolic > 130 && systolic < 160) {
    yellowReasons.push(`Elevated BP (${systolic}/${diastolic} mmHg)`);
  } else if (diastolic >= 90 && diastolic < 105 && systolic <= 130) {
    yellowReasons.push(`Elevated Diastolic BP (${diastolic} mmHg)`);
  }
  if (temperature > 100.0) {
    yellowReasons.push(`Fever (${temperature.toFixed(1)}°F > 100°F)`);
  }
  if (spo2 >= 90 && spo2 <= 94) {
    yellowReasons.push(`Borderline SpO₂ (${spo2}%)`);
  }
  if (heartRate > 100 && heartRate < 130) {
    yellowReasons.push(`Tachycardia (${heartRate} BPM)`);
  }
  if (safeSymptoms.includes('High BP') && systolic <= 130) {
    yellowReasons.push('History / Symptom of High BP');
  }
  if (safeSymptoms.includes('Dizziness')) {
    yellowReasons.push('Dizziness / Syncope Warning');
  }
  const estimatedHb =
    typeof edgeAi?.estimatedHb === 'number' && Number.isFinite(edgeAi.estimatedHb)
      ? edgeAi.estimatedHb
      : undefined;
  const hasAnemiaRisk =
    (estimatedHb !== undefined && estimatedHb < 10.0) || Boolean(edgeAi?.anemiaSuspected);

  if (estimatedHb !== undefined && estimatedHb < 7.0) {
    redReasons.push(
      `Severe Anemia Risk (Est. Hb ${estimatedHb.toFixed(1)} g/dL < 7.0 g/dL)`
    );
  } else if (hasAnemiaRisk) {
    yellowReasons.push(
      `Anemia Risk Flagged (Est. Hb ${
        estimatedHb !== undefined ? `${estimatedHb.toFixed(1)} g/dL < 10.0` : '< 10.0'
      } g/dL)`
    );
  }
  if (edgeAi?.respiratoryRiskHigh) {
    yellowReasons.push(
      `Cough Spectral Risk (${edgeAi?.coughPeakHz ?? 890} Hz Bronchial Signature)`
    );
  }

  if (redReasons.length > 0) {
    return {
      severity: 'emergency',
      scoreCode: 'TR3',
      triggers: [...redReasons, ...yellowReasons],
      protocolEn:
        'Urgent care needed: Help the patient sit upright comfortably, keep their airway clear, alert the hospital doctor immediately, and arrange ambulance transport.',
      protocolHi:
        'तुरंत डॉक्टर की सहायता आवश्यक है: मरीज़ को आराम से सहारा देकर बिठाएं, अस्पताल को तुरंत सूचना भेजें और 108 एम्बुलेंस की व्यवस्था करें।',
    };
  }

  if (yellowReasons.length > 0) {
    return {
      severity: 'moderate',
      scoreCode: 'TR2',
      triggers: yellowReasons,
      protocolEn:
        'Doctor review recommended: Arrange a same-day consultation with the clinic doctor and recheck vital signs within 2 hours.',
      protocolHi:
        'डॉक्टर की सलाह आवश्यक: आज ही प्राथमिक स्वास्थ्य केंद्र के डॉक्टर से परामर्श कराएं और 2 घंटे में दोबारा जांच करें।',
    };
  }

  return {
    severity: 'routine',
    scoreCode: 'TR1',
    triggers: ['All recorded vital signs are within the expected everyday range'],
    protocolEn:
      'Vital signs are within normal range: Save this checkup record and continue routine wellness follow-up.',
    protocolHi:
      'सभी जीवन संकेत सामान्य सीमा में हैं: यह स्वास्थ्य जांच रिकॉर्ड सुरक्षित करें।',
  };
}

export const SUB_CENTER_DIRECTORY: VillageSubCenter[] = [
  {
    code: 'VIL-204',
    name: 'Rampur Health Sub-Center',
    nameHi: 'रामपुर उप-केंद्र',
    block: 'Varanasi Rural Block',
    ashaName: 'Rampur Care Team',
    x: 26,
    y: 32,
    population: 4820,
    phcDistanceKm: 11.4,
  },
  {
    code: 'VIL-208',
    name: 'Devgarh Health Sub-Center',
    nameHi: 'देवगढ़ उप-केंद्र',
    block: 'Cholapur Block',
    ashaName: 'Devgarh Care Team',
    x: 68,
    y: 24,
    population: 3910,
    phcDistanceKm: 14.8,
  },
  {
    code: 'VIL-215',
    name: 'Shivpur North Sub-Center',
    nameHi: 'शिवपुर उत्तर उप-केंद्र',
    block: 'Pindra Block',
    ashaName: 'Shivpur Care Team',
    x: 80,
    y: 58,
    population: 5290,
    phcDistanceKm: 16.5,
  },
];

export const ALLOWED_VILLAGE_CODES: ReadonlySet<string> = new Set([
  ...SUB_CENTER_DIRECTORY.map((c) => c.code),
  'VIL-108',
]);

export function isAllowedVillageCode(code: string): boolean {
  return ALLOWED_VILLAGE_CODES.has(code.trim().toUpperCase());
}

export function maskHealthId(abhaId: string): string {
  const clean = (abhaId || '').trim();
  if (clean.length < 6) return 'Protected ID';
  const prefix = clean.slice(0, 2);
  const suffix = clean.slice(-4);
  return `${prefix}-••••-••••-${suffix}`;
}


