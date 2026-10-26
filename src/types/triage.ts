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
        'CRITICAL RED ALERT: Position patient semi-upright, keep airway clear, transmit Encrypted Baseband SMS immediately, and prepare for 108 Ambulance.',
      protocolHi:
        'सावधान दीदी! यह गंभीर रेड इमरजेंसी है। मरीज़ को सहारा देकर बिठाएं, तुरंत एन्क्रिप्टेड इमरजेंसी एसएमएस भेजें और 108 एम्बुलेंस बुलाएं।',
    };
  }

  if (yellowReasons.length > 0) {
    return {
      severity: 'moderate',
      scoreCode: 'TR2',
      triggers: yellowReasons,
      protocolEn:
        'MODERATE RISK: Schedule same-day PHC Medical Officer tele-consultation and re-verify vitals within 2 hours.',
      protocolHi:
        'मध्यम जोखिम: आज ही पीएचसी डॉक्टर से टेली-परामर्श कराएं और दो घंटे में दोबारा जांच करें।',
    };
  }

  return {
    severity: 'routine',
    scoreCode: 'TR1',
    triggers: ['All physiological vitals & camera/audio checks nominal'],
    protocolEn:
      'ROUTINE GREEN: Vitals within normal physiological baseline. Save to ABDM offline health record.',
    protocolHi:
      'सामान्य स्थिति: मरीज़ के सभी जीवन संकेत सामान्य हैं। रिकॉर्ड सुरक्षित करें।',
  };
}
