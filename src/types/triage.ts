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
  protocolEn: string;
  protocolHi: string;
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
    case 'heartRate':
      if (value >= 130 || value < 45) return 'emergency';
      if (value > 100 || value < 55) return 'moderate';
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

  if (vitals.systolic >= 160 || vitals.systolic < 80) {
    redReasons.push(`Critical Systolic BP (${vitals.systolic}/${vitals.diastolic} mmHg)`);
  }
  if (vitals.diastolic >= 105) {
    redReasons.push(`Critical Diastolic BP (${vitals.diastolic} mmHg)`);
  }
  if (vitals.spo2 < 90) {
    redReasons.push(`Severe Hypoxia (SpO₂ ${vitals.spo2}% < 90%)`);
  }
  if (vitals.heartRate >= 130 || vitals.heartRate < 45) {
    redReasons.push(`Critical Heart Rate (${vitals.heartRate} BPM)`);
  }
  if (symptoms.includes('Severe Chest Pain')) {
    redReasons.push('Severe Chest Pain Reported');
  }
  if (symptoms.includes('Bleeding')) {
    redReasons.push('Active Hemorrhage / Bleeding Flagged');
  }

  if (vitals.systolic > 130 && vitals.systolic < 160) {
    yellowReasons.push(`Elevated BP (${vitals.systolic}/${vitals.diastolic} mmHg)`);
  } else if (vitals.diastolic >= 90 && vitals.diastolic < 105 && vitals.systolic <= 130) {
    yellowReasons.push(`Elevated Diastolic BP (${vitals.diastolic} mmHg)`);
  }
  if (vitals.temperature > 100.0) {
    yellowReasons.push(`Fever (${vitals.temperature.toFixed(1)}°F > 100°F)`);
  }
  if (vitals.spo2 >= 90 && vitals.spo2 <= 94) {
    yellowReasons.push(`Borderline SpO₂ (${vitals.spo2}%)`);
  }
  if (vitals.heartRate > 100 && vitals.heartRate < 130) {
    yellowReasons.push(`Tachycardia (${vitals.heartRate} BPM)`);
  }
  if (symptoms.includes('High BP') && vitals.systolic <= 130) {
    yellowReasons.push('History / Symptom of High BP');
  }
  if (symptoms.includes('Dizziness')) {
    yellowReasons.push('Dizziness / Syncope Warning');
  }
  if (edgeAi?.anemiaSuspected) {
    yellowReasons.push(
      `Camera Pallor Detected (Est. Hb ${edgeAi.estimatedHb?.toFixed(1) ?? '< 8.5'} g/dL)`
    );
  }
  if (edgeAi?.respiratoryRiskHigh) {
    yellowReasons.push(
      `Cough Spectral Risk (${edgeAi.coughPeakHz ?? 890} Hz Bronchial Signature)`
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

export function maskHealthId(abhaId: string): string {
  const clean = (abhaId || '').trim();
  if (clean.length < 6) return 'Protected ID';
  const prefix = clean.slice(0, 2);
  const suffix = clean.slice(-4);
  return `${prefix}-••••-••••-${suffix}`;
}

