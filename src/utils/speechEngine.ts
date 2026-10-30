import {SymptomKey, VitalsSnapshot} from '../types/triage';

export interface DetectedEntityBadge {
  key: string;
  label: string;
  tone: 'teal' | 'red' | 'amber';
}

export interface ParsedVoiceEntities {
  vitalsPatch: Partial<VitalsSnapshot>;
  detectedSymptoms: SymptomKey[];
  badges: DetectedEntityBadge[];
  isEmergencyFirstAidQuery: boolean;
}

/**
 * Real Regex & Clinical Keyword Parser over live Hindi / Hinglish / English speech transcripts.
 */
export function parseClinicalTranscript(transcript?: string | null): ParsedVoiceEntities {
  const vitalsPatch: Partial<VitalsSnapshot> = {};
  const detectedSymptoms: SymptomKey[] = [];
  const badges: DetectedEntityBadge[] = [];

  const text = String(transcript || '').trim();
  if (!text) {
    return {vitalsPatch, detectedSymptoms, badges, isEmergencyFirstAidQuery: false};
  }

  const isEmergencyFirstAidQuery =
    /first[\s-]*aid|emergency\s*steps|प्राथमिक\s*उपचार|बचाव/i.test(text);

  // 1. Extract Blood Pressure: e.g. "BP 140 by 90", "Pressure 160/100", "BP 150 over 95", "बीपी 160 बटा 100"
  const bpPairRegex =
    /(?:bp|pressure|blood\s*pressure|बीपी|रक्तचाप)?\s*(\d{2,3})\s*(?:\/|by|over|बटा|पर)\s*(\d{2,3})/i;
  const bpPairMatch = text.match(bpPairRegex);
  if (bpPairMatch) {
    const sys = Math.min(260, Math.max(50, Number(bpPairMatch[1])));
    const dia = Math.min(160, Math.max(35, Number(bpPairMatch[2])));
    vitalsPatch.systolic = sys;
    vitalsPatch.diastolic = dia;
    badges.push({
      key: 'bp',
      label: `BP: ${sys}/${dia}`,
      tone: sys >= 160 || dia >= 100 ? 'red' : sys > 130 ? 'amber' : 'teal',
    });
    if (sys >= 140 || dia >= 90) {
      detectedSymptoms.push('High BP');
    }
  } else {
    const singleBpMatch = text.match(/(?:bp|pressure|बीपी)\s*(?:is|है|:)?\s*(\d{2,3})/i);
    if (singleBpMatch) {
      const sys = Math.min(260, Math.max(50, Number(singleBpMatch[1])));
      vitalsPatch.systolic = sys;
      badges.push({
        key: 'bp-sys',
        label: `Sys BP: ${sys}`,
        tone: sys >= 160 ? 'red' : sys > 130 ? 'amber' : 'teal',
      });
    }
  }

  // 2. Extract SpO2 / Oxygen: e.g. "Oxygen 92", "SpO2 88%", "ऑक्सीजन 89"
  const spo2Match = text.match(
    /(?:oxygen|spo2|sp\s*o2|o2|ऑक्सीजन|सैचुरेशन)\s*(?:level|is|है|:)?\s*(\d{2,3})\s*%?/i
  );
  if (spo2Match) {
    const spo2 = Math.min(100, Math.max(50, Number(spo2Match[1])));
    vitalsPatch.spo2 = spo2;
    badges.push({
      key: 'spo2',
      label: `SpO₂: ${spo2}%`,
      tone: spo2 < 90 ? 'red' : spo2 <= 94 ? 'amber' : 'teal',
    });
  }

  // 3. Extract Temperature / Bukhar: e.g. "Bukhar 101", "Temperature 102.4", "बुखार 102"
  const tempMatch = text.match(
    /(?:temperature|temp|bukhar|fever|बुखार|तापमान)\s*(?:is|है|:)?\s*(\d{2,3}(?:\.\d)?)\s*(?:°f|f|degree|डिग्री)?/i
  );
  if (tempMatch) {
    const temp = Math.min(108, Math.max(93, Number(tempMatch[1])));
    vitalsPatch.temperature = temp;
    if (temp > 99.5 && !detectedSymptoms.includes('Fever')) {
      detectedSymptoms.push('Fever');
    }
    badges.push({
      key: 'temp',
      label: `Temp: ${temp}°F`,
      tone: temp >= 103 ? 'red' : temp > 100 ? 'amber' : 'teal',
    });
  }

  // 4. Extract Heart Rate / Pulse: e.g. "Pulse 112", "Heart rate 96", "HR 118", "धड़कन 110"
  const hrMatch = text.match(
    /(?:heart\s*rate|pulse|hr|bpm|धड़कन|नब्ज)\s*(?:is|है|:)?\s*(\d{2,3})/i
  );
  if (hrMatch) {
    const hr = Math.min(220, Math.max(35, Number(hrMatch[1])));
    vitalsPatch.heartRate = hr;
    badges.push({
      key: 'hr',
      label: `HR: ${hr} BPM`,
      tone: hr >= 130 ? 'red' : hr > 100 ? 'amber' : 'teal',
    });
  }

  // 5. Symptom Keyword Detection (English + Hindi + Hinglish)
  const symptomMatchers: Array<{symptom: SymptomKey; regex: RegExp; critical?: boolean}> = [
    {
      symptom: 'Fever',
      regex: /\b(fever|bukhar|febrile|तेज\s*बुखार|बुखार|ताप)\b/i,
    },
    {
      symptom: 'High BP',
      regex: /\b(high\s*bp|hypertension|उच्च\s*रक्तचाप|हाई\s*बीपी)\b/i,
    },
    {
      symptom: 'Severe Chest Pain',
      regex: /(chest\s*pain|seene\s*mein\s*dard|chhati\s*mein\s*dard|सीने\s*में\s*दर्द|छाती\s*में\s*दर्द)/i,
      critical: true,
    },
    {
      symptom: 'Dizziness',
      regex: /\b(dizziness|dizzy|chakkar|vertigo|चक्कर|बेहोशी)\b/i,
    },
    {
      symptom: 'Cough',
      regex: /\b(cough|coughing|khansi|खांसी|खाँसी|कफ)\b/i,
    },
    {
      symptom: 'Bleeding',
      regex: /\b(bleeding|hemorrhage|khoon|रक्तस्राव|खून)\b/i,
      critical: true,
    },
  ];

  for (const m of symptomMatchers) {
    if (m.regex.test(text) && !detectedSymptoms.includes(m.symptom)) {
      detectedSymptoms.push(m.symptom);
    }
  }

  for (const sym of detectedSymptoms) {
    badges.push({
      key: `sym-${sym}`,
      label: sym,
      tone: sym === 'Severe Chest Pain' || sym === 'Bleeding' ? 'red' : 'teal',
    });
  }

  return {
    vitalsPatch,
    detectedSymptoms,
    badges,
    isEmergencyFirstAidQuery,
  };
}

/**
 * Real Browser Text-to-Speech (window.speechSynthesis) with Hindi ('hi-IN') & English ('en-IN') voices
 */
export function speakClinicalGuidance(
  message: string,
  langCode: 'hi-IN' | 'en-IN' = 'hi-IN',
  muted = false
): boolean {
  if (muted || typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return false;
  }

  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.lang = langCode;
    utterance.rate = 0.98;
    utterance.pitch = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const preferredVoice =
      voices.find((v) => v.lang.toLowerCase() === langCode.toLowerCase()) ||
      voices.find((v) => v.lang.toLowerCase().startsWith(langCode.slice(0, 2).toLowerCase())) ||
      voices.find((v) => v.lang.toLowerCase().includes('in'));

    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }

    window.speechSynthesis.speak(utterance);
    return true;
  } catch {
    return false;
  }
}

export interface BrowserSpeechResultEvent {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      0: {transcript: string};
    };
  };
}

export interface BrowserSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: BrowserSpeechResultEvent) => void) | null;
  onerror: ((e: {error: string}) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export function isBrowserSpeechRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(
    (window as unknown as {SpeechRecognition?: unknown}).SpeechRecognition ||
      (window as unknown as {webkitSpeechRecognition?: unknown}).webkitSpeechRecognition
  );
}

export function createBrowserSpeechRecognition(
  lang: 'hi-IN' | 'en-IN' = 'hi-IN'
): BrowserSpeechRecognition | null {
  if (!isBrowserSpeechRecognitionSupported()) return null;
  try {
    const Ctor =
      (window as unknown as {SpeechRecognition?: new () => BrowserSpeechRecognition})
        .SpeechRecognition ||
      (window as unknown as {webkitSpeechRecognition?: new () => BrowserSpeechRecognition})
        .webkitSpeechRecognition;

    if (!Ctor) return null;

    const instance = new Ctor();
    instance.lang = lang;
    instance.continuous = false;
    instance.interimResults = true;
    return instance;
  } catch (err) {
    console.warn('[SwasthyaSetu Speech] SpeechRecognition unavailable; falling back to manual input:', err);
    return null;
  }
}
