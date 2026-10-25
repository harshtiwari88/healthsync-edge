export type Language = 'en' | 'hi';

export type SeverityLevel = 'routine' | 'moderate' | 'emergency';

export type SyncChannel = 'Data' | 'Emergency SMS';

export type SyncStatus = 'Queued Offline' | 'Synced' | 'SMS Delivered';

export type AmbulanceDispatchStatus = 'Unassigned' | 'Dispatched';

export interface VitalsSnapshot {
  systolic: number;
  diastolic: number;
  spo2: number;
  temperature: number;
}

export interface TriageRecord {
  id: string;
  patientId: string;
  patientName: string;
  age: number;
  gender: 'F' | 'M';
  villageCode: string;
  villageName: string;
  ashaWorker: string;
  vitals: VitalsSnapshot;
  severity: SeverityLevel;
  clinicalNotes: string;
  channel: SyncChannel;
  syncStatus: SyncStatus;
  timestamp: string;
  createdAtMs: number;
  dispatchStatus: AmbulanceDispatchStatus;
  ambulanceUnit?: string;
  etaMinutes?: number;
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
  triggersEn: string[];
  triggersHi: string[];
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
      if ((value >= 140 && value < 160) || (value >= 80 && value < 90)) return 'moderate';
      return 'routine';
    case 'diastolic':
      if (value >= 100 || value < 50) return 'emergency';
      if (value >= 90 && value < 100) return 'moderate';
      return 'routine';
    case 'spo2':
      if (value <= 90) return 'emergency';
      if (value >= 91 && value <= 94) return 'moderate';
      return 'routine';
    case 'temperature':
      if (value >= 102.0 || value < 95.0) return 'emergency';
      if (value >= 99.5 && value < 102.0) return 'moderate';
      return 'routine';
  }
}

export function evaluateTriage(vitals: VitalsSnapshot): TriageEvaluation {
  const emergencyEn: string[] = [];
  const emergencyHi: string[] = [];
  const moderateEn: string[] = [];
  const moderateHi: string[] = [];

  // SpO2 checks
  if (vitals.spo2 <= 90) {
    emergencyEn.push(`Severe Hypoxia (SpO₂ ${vitals.spo2}%)`);
    emergencyHi.push(`गंभीर ऑक्सीजन कमी (SpO₂ ${vitals.spo2}%)`);
  } else if (vitals.spo2 <= 94) {
    moderateEn.push(`Borderline SpO₂ (${vitals.spo2}%)`);
    moderateHi.push(`कम ऑक्सीजन स्तर (${vitals.spo2}%)`);
  }

  // Systolic BP checks
  if (vitals.systolic >= 160) {
    emergencyEn.push(`Hypertensive Crisis (Sys ${vitals.systolic} mmHg)`);
    emergencyHi.push(`अत्यधिक उच्च रक्तचाप (Sys ${vitals.systolic} mmHg)`);
  } else if (vitals.systolic < 80) {
    emergencyEn.push(`Hypotensive Shock Risk (Sys ${vitals.systolic} mmHg)`);
    emergencyHi.push(`गंभीर निम्न रक्तचाप (Sys ${vitals.systolic} mmHg)`);
  } else if (vitals.systolic >= 140) {
    moderateEn.push(`Elevated Systolic BP (${vitals.systolic} mmHg)`);
    moderateHi.push(`बढ़ा हुआ सिस्टोलिक बीपी (${vitals.systolic} mmHg)`);
  } else if (vitals.systolic < 90) {
    moderateEn.push(`Low Systolic BP (${vitals.systolic} mmHg)`);
    moderateHi.push(`कम सिस्टोलिक बीपी (${vitals.systolic} mmHg)`);
  }

  // Diastolic BP checks
  if (vitals.diastolic >= 100 || vitals.diastolic < 50) {
    emergencyEn.push(`Critical Diastolic BP (${vitals.diastolic} mmHg)`);
    emergencyHi.push(`गंभीर डायस्टोलिक बीपी (${vitals.diastolic} mmHg)`);
  } else if (vitals.diastolic >= 90) {
    moderateEn.push(`Elevated Diastolic BP (${vitals.diastolic} mmHg)`);
    moderateHi.push(`बढ़ा हुआ डायस्टोलिक बीपी (${vitals.diastolic} mmHg)`);
  }

  // Temperature checks
  if (vitals.temperature >= 102.0) {
    emergencyEn.push(`High Grade Fever (${vitals.temperature.toFixed(1)}°F)`);
    emergencyHi.push(`तेज बुखार (${vitals.temperature.toFixed(1)}°F)`);
  } else if (vitals.temperature < 95.0) {
    emergencyEn.push(`Hypothermia (${vitals.temperature.toFixed(1)}°F)`);
    emergencyHi.push(`अल्पताप (${vitals.temperature.toFixed(1)}°F)`);
  } else if (vitals.temperature >= 99.5) {
    moderateEn.push(`Febrile (${vitals.temperature.toFixed(1)}°F)`);
    moderateHi.push(`हल्का/मध्यम बुखार (${vitals.temperature.toFixed(1)}°F)`);
  }

  if (emergencyEn.length > 0) {
    return {
      severity: 'emergency',
      triggersEn: emergencyEn,
      triggersHi: emergencyHi,
      protocolEn:
        'Immediate referral required. Trigger Emergency SMS Bypass to District 24 Command & request 108 Ambulance.',
      protocolHi:
        'तुरंत रेफरल आवश्यक। जिला 24 कमांड को आपातकालीन SMS भेजें और 108 एम्बुलेंस बुलाएं।',
    };
  }

  if (moderateEn.length > 0) {
    return {
      severity: 'moderate',
      triggersEn: moderateEn,
      triggersHi: moderateHi,
      protocolEn:
        'Schedule same-day PHC Medical Officer tele-consult and repeat vitals check within 2 hours.',
      protocolHi:
        'आज ही PHC चिकित्सा अधिकारी से टेली-परामर्श कराएं और 2 घंटे में दोबारा जांच करें।',
    };
  }

  return {
    severity: 'routine',
    triggersEn: ['All parameters within physiological baseline'],
    triggersHi: ['सभी जीवन संकेत सामान्य सीमा में हैं'],
    protocolEn:
      'Continue standard community health monitoring and log household visit in sub-center register.',
    protocolHi:
      'नियमित सामुदायिक स्वास्थ्य निगरानी जारी रखें और उप-केंद्र रजिस्टर में दर्ज करें।',
  };
}

export function buildCompactSmsPayload(
  patientId: string,
  villageCode: string,
  vitals: VitalsSnapshot,
  severity: SeverityLevel
): string {
  const sevCode = severity === 'emergency' ? 'RED' : severity === 'moderate' ? 'YLW' : 'GRN';
  return `D24|${sevCode}|${patientId}|${villageCode}|BP:${vitals.systolic}/${vitals.diastolic}|SPO2:${vitals.spo2}%|TMP:${vitals.temperature.toFixed(1)}F`;
}
