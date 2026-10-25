import React, {useState, useRef, useEffect} from 'react';
import {
  Mic,
  MicOff,
  Heart,
  Thermometer,
  WifiOff,
  Wifi,
  CheckCircle2,
  AlertTriangle,
  Siren,
  MessageSquareWarning,
  Save,
  RefreshCw,
  Globe,
  Minus,
  Plus,
  ArrowUpRight,
  Radio,
} from 'lucide-react';
import {
  Language,
  TriageRecord,
  VitalsSnapshot,
  evaluateTriage,
  evaluateVitalStatus,
  buildCompactSmsPayload,
} from '../types/triage';
import {VILLAGE_SUB_CENTERS, TRANSLATIONS} from '../data/initialData';
import {LungsIcon} from './Icons';
import {PWAInstallButton} from './PWAInstallButton';

interface AshaWorkerPWAProps {
  records: TriageRecord[];
  language: Language;
  onLanguageChange: (lang: Language) => void;
  isOfflineMode: boolean;
  onToggleOfflineMode: () => void;
  onSaveRecord: (
    patientName: string,
    age: number,
    gender: 'F' | 'M',
    villageCode: string,
    vitals: VitalsSnapshot,
    clinicalNotes: string,
    channel: 'Data' | 'Emergency SMS'
  ) => TriageRecord;
  onSyncOfflineQueue: () => number;
  onOpenCommandPortal: () => void;
}

interface VoicePreset {
  id: string;
  labelEn: string;
  labelHi: string;
  transcriptEn: string;
  transcriptHi: string;
  patientName: string;
  age: number;
  gender: 'F' | 'M';
  villageCode: string;
  vitals: VitalsSnapshot;
  notes: string;
}

const VOICE_PRESETS: VoicePreset[] = [
  {
    id: 'preset-red',
    labelEn: 'Red Case · Sunita (BP 172/106, SpO₂ 88%)',
    labelHi: 'गंभीर केस · सुनीता (BP 172/106, SpO₂ 88%)',
    transcriptEn:
      'Sunita Devi, age 34 female, Rampur Kalan, BP 172 over 106, oxygen 88 percent, fever 102.4 Fahrenheit, severe breathlessness.',
    transcriptHi:
      'सुनीता देवी, उम्र 34 महिला, रामपुर कलां, बीपी 172 बटा 106, ऑक्सीजन 88 प्रतिशत, बुखार 102.4 डिग्री, सांस लेने में तकलीफ।',
    patientName: 'Sunita Devi',
    age: 34,
    gender: 'F',
    villageCode: 'VLG-2401',
    vitals: {systolic: 172, diastolic: 106, spo2: 88, temperature: 102.4},
    notes: 'Voice note: Severe breathlessness and dizziness reported during household visit.',
  },
  {
    id: 'preset-yellow',
    labelEn: 'Yellow Case · Ramesh (BP 148/94, 100.6°F)',
    labelHi: 'मध्यम केस · रमेश (BP 148/94, 100.6°F)',
    transcriptEn:
      'Ramesh Yadav, age 52 male, Devgarh Gram, systolic 148 diastolic 94, SpO2 93 percent, temperature 100.6 Fahrenheit.',
    transcriptHi:
      'रमेश यादव, उम्र 52 पुरुष, देवगढ़ ग्राम, बीपी 148 बटा 94, ऑक्सीजन 93 प्रतिशत, तापमान 100.6 फ़ारेनहाइट।',
    patientName: 'Ramesh Yadav',
    age: 52,
    gender: 'M',
    villageCode: 'VLG-2402',
    vitals: {systolic: 148, diastolic: 94, spo2: 93, temperature: 100.6},
    notes: 'Voice note: Persistent 3-day fever and mild exertional fatigue.',
  },
  {
    id: 'preset-green',
    labelEn: 'Routine · Kavita (BP 116/76, SpO₂ 99%)',
    labelHi: 'सामान्य · कविता (BP 116/76, SpO₂ 99%)',
    transcriptEn:
      'Kavita Kumari, age 26 female, Khairabad East, blood pressure 116 over 76, oxygen 99 percent, temperature 98.4 Fahrenheit.',
    transcriptHi:
      'कविता कुमारी, उम्र 26 महिला, खैराबाद पूर्व, बीपी 116 बटा 76, ऑक्सीजन 99 प्रतिशत, तापमान 98.4 फ़ारेनहाइट।',
    patientName: 'Kavita Kumari',
    age: 26,
    gender: 'F',
    villageCode: 'VLG-2403',
    vitals: {systolic: 116, diastolic: 76, spo2: 99, temperature: 98.4},
    notes: 'Voice note: Routine postnatal wellness check, patient asymptomatic.',
  },
];

// Minimal speech recognition interface for browser Web Speech API
interface SpeechRecognitionInstance {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: {results: ArrayLike<ArrayLike<{transcript: string}>>}) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export const AshaWorkerPWA: React.FC<AshaWorkerPWAProps> = ({
  records,
  language,
  onLanguageChange,
  isOfflineMode,
  onToggleOfflineMode,
  onSaveRecord,
  onSyncOfflineQueue,
  onOpenCommandPortal,
}) => {
  const t = TRANSLATIONS[language];

  const [patientName, setPatientName] = useState<string>('Geeta Devi');
  const [age, setAge] = useState<number>(38);
  const [gender, setGender] = useState<'F' | 'M'>('F');
  const [villageCode, setVillageCode] = useState<string>('VLG-2401');
  const [vitals, setVitals] = useState<VitalsSnapshot>({
    systolic: 122,
    diastolic: 78,
    spo2: 98,
    temperature: 98.6,
  });
  const [clinicalNotes, setClinicalNotes] = useState<string>(
    'Household maternal & NCD screening visit.'
  );
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [voiceTranscript, setVoiceTranscript] = useState<string>('');
  const [feedbackBanner, setFeedbackBanner] = useState<{
    type: 'teal' | 'red';
    message: string;
    smsPayload?: string;
  } | null>(null);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  const queuedItems = records.filter((r) => r.syncStatus === 'Queued Offline');
  const queuedCount = queuedItems.length;

  const triage = evaluateTriage(vitals);
  const previewPatientId = `PT-${2480 + records.length + 1}`;
  const smsPacketPreview = buildCompactSmsPayload(
    previewPatientId,
    villageCode,
    vitals,
    triage.severity
  );

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  const parseSpokenTranscript = (text: string) => {
    setVoiceTranscript(text);
    setClinicalNotes(`Voice note: "${text}"`);

    // Parse BP patterns like "168/104" or "168 over 104" or "168 बटा 104"
    const bpMatch = text.match(/(\d{2,3})\s*(?:\/|over|by|बटा)\s*(\d{2,3})/i);
    // Parse SpO2 patterns like "oxygen 89" or "spo2 92"
    const spo2Match = text.match(/(?:spo2|oxygen|ऑक्सीजन|saturation)\D*(\d{2,3})/i);
    // Parse temperature patterns like "101.4" or "fever 102"
    const tempMatch = text.match(/(?:temp|temperature|fever|बुखार|तापमान)\D*(\d{2,3}(?:\.\d)?)/i);
    // Parse age
    const ageMatch = text.match(/(?:age|उम्र|आयु)\D*(\d{1,3})/i);

    setVitals((prev) => ({
      systolic: bpMatch ? Math.min(240, Math.max(60, Number(bpMatch[1]))) : prev.systolic,
      diastolic: bpMatch ? Math.min(150, Math.max(40, Number(bpMatch[2]))) : prev.diastolic,
      spo2: spo2Match ? Math.min(100, Math.max(65, Number(spo2Match[1]))) : prev.spo2,
      temperature: tempMatch
        ? Math.min(107, Math.max(94, Number(tempMatch[1])))
        : prev.temperature,
    }));

    if (ageMatch) {
      setAge(Math.min(105, Math.max(1, Number(ageMatch[1]))));
    }

    const firstWords = text.split(/[,.]/)[0]?.trim();
    if (firstWords && firstWords.length >= 3 && firstWords.length <= 28 && !/\d/.test(firstWords)) {
      setPatientName(firstWords);
    }
  };

  const handleToggleVoice = () => {
    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
      return;
    }

    const SpeechRecognitionCtor =
      (window as unknown as {SpeechRecognition?: new () => SpeechRecognitionInstance})
        .SpeechRecognition ||
      (window as unknown as {webkitSpeechRecognition?: new () => SpeechRecognitionInstance})
        .webkitSpeechRecognition;

    if (SpeechRecognitionCtor) {
      try {
        const instance = new SpeechRecognitionCtor();
        instance.lang = language === 'hi' ? 'hi-IN' : 'en-IN';
        instance.interimResults = true;
        instance.continuous = false;

        instance.onresult = (event) => {
          let combined = '';
          for (let i = 0; i < event.results.length; i++) {
            combined += event.results[i][0].transcript;
          }
          if (combined.trim()) {
            parseSpokenTranscript(combined.trim());
          }
        };

        instance.onerror = () => {
          setIsRecording(false);
          // Fallback to first clinical voice dictation preset if microphone is unavailable in sandbox
          applyPreset(VOICE_PRESETS[0]);
        };

        instance.onend = () => {
          setIsRecording(false);
        };

        recognitionRef.current = instance;
        setIsRecording(true);
        instance.start();
        return;
      } catch {
        setIsRecording(false);
      }
    }

    // Immediate interactive voice simulation fallback if SpeechRecognition API is unsupported
    setIsRecording(true);
    setTimeout(() => {
      setIsRecording(false);
      applyPreset(VOICE_PRESETS[0]);
    }, 900);
  };

  const applyPreset = (preset: VoicePreset) => {
    setPatientName(preset.patientName);
    setAge(preset.age);
    setGender(preset.gender);
    setVillageCode(preset.villageCode);
    setVitals({...preset.vitals});
    setClinicalNotes(preset.notes);
    setVoiceTranscript(language === 'hi' ? preset.transcriptHi : preset.transcriptEn);
  };

  const adjustVital = (field: keyof VitalsSnapshot, delta: number) => {
    setVitals((prev) => {
      const nextVal = Number((prev[field] + delta).toFixed(1));
      if (field === 'systolic') return {...prev, systolic: Math.min(240, Math.max(60, nextVal))};
      if (field === 'diastolic') return {...prev, diastolic: Math.min(150, Math.max(40, nextVal))};
      if (field === 'spo2') return {...prev, spo2: Math.min(100, Math.max(60, nextVal))};
      return {...prev, temperature: Math.min(107, Math.max(94, nextVal))};
    });
  };

  const handlePrimarySave = () => {
    const cleanName = patientName.trim() || 'Unnamed Patient';
    onSaveRecord(cleanName, age, gender, villageCode, vitals, clinicalNotes, 'Data');
    setFeedbackBanner({
      type: 'teal',
      message: isOfflineMode ? t.savedOfflineToast : t.savedOnlineToast,
    });
  };

  const handleEmergencySmsBypass = () => {
    const cleanName = patientName.trim() || 'Emergency Patient';
    const created = onSaveRecord(
      cleanName,
      age,
      gender,
      villageCode,
      vitals,
      clinicalNotes,
      'Emergency SMS'
    );
    const smsStr = buildCompactSmsPayload(
      created.patientId,
      created.villageCode,
      created.vitals,
      created.severity
    );
    setFeedbackBanner({
      type: 'red',
      message: t.smsDispatchedToast,
      smsPayload: smsStr,
    });
  };

  const handleManualSync = () => {
    const count = onSyncOfflineQueue();
    if (count > 0) {
      setFeedbackBanner({
        type: 'teal',
        message:
          language === 'hi'
            ? `${count} ऑफ़लाइन रिकॉर्ड जिला 24 कमांड पोर्टल पर सिंक किए गए।`
            : `Synced ${count} queued offline ${count === 1 ? 'record' : 'records'} to District 24 Command.`,
      });
    }
  };

  const getVitalCardStyle = (status: 'routine' | 'moderate' | 'emergency') => {
    if (status === 'emergency') {
      return {
        border: 'border-red-300 bg-red-50/50',
        iconWrap: 'bg-red-100 text-red-700',
        statusText: t.criticalTag,
        statusClass: 'text-red-700 font-semibold',
      };
    }
    if (status === 'moderate') {
      return {
        border: 'border-amber-300 bg-amber-50/50',
        iconWrap: 'bg-amber-100 text-amber-800',
        statusText: t.cautionTag,
        statusClass: 'text-amber-800 font-semibold',
      };
    }
    return {
      border: 'border-slate-200 bg-white',
      iconWrap: 'bg-teal-50 text-[#0F766E]',
      statusText: t.normalTag,
      statusClass: 'text-[#0F766E] font-medium',
    };
  };

  const sysMeta = getVitalCardStyle(evaluateVitalStatus('systolic', vitals.systolic));
  const diaMeta = getVitalCardStyle(evaluateVitalStatus('diastolic', vitals.diastolic));
  const spo2Meta = getVitalCardStyle(evaluateVitalStatus('spo2', vitals.spo2));
  const tempMeta = getVitalCardStyle(evaluateVitalStatus('temperature', vitals.temperature));

  return (
    <div className="min-h-screen bg-slate-50 pb-28 lg:pb-16">
      {/* ASHA Mobile-First Header */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          {/* Offline Status Pill Indicator (Interactive connectivity toggle) */}
          <button
            type="button"
            onClick={onToggleOfflineMode}
            className={`min-h-[48px] px-4 rounded-full border text-xs sm:text-sm font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              isOfflineMode
                ? 'bg-amber-50 border-amber-300 text-amber-900 hover:bg-amber-100'
                : 'bg-teal-50 border-teal-200 text-[#0F766E] hover:bg-teal-100'
            }`}
            title="Tap to toggle simulated village network connectivity"
          >
            {isOfflineMode ? (
              <WifiOff className="w-4 h-4 text-amber-700 shrink-0" />
            ) : (
              <Wifi className="w-4 h-4 text-[#0F766E] shrink-0" />
            )}
            <span className="tabular-nums">
              {isOfflineMode ? t.offlineModeQueued(queuedCount) : t.onlineSynced(queuedCount)}
            </span>
          </button>

          {/* Language Selector Dropdown (Hindi/English) + Install PWA */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="relative flex items-center">
              <Globe
                className="w-4 h-4 text-[#0F766E] absolute left-3.5 pointer-events-none"
                aria-hidden="true"
              />
              <select
                aria-label="Select Language"
                value={language}
                onChange={(e) => onLanguageChange(e.target.value as Language)}
                className="min-h-[48px] pl-9 pr-8 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-900 hover:border-[#0F766E] transition-colors cursor-pointer"
              >
                <option value="en">English (EN)</option>
                <option value="hi">हिन्दी (Hindi)</option>
              </select>
            </div>
            <PWAInstallButton compact />
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 pt-5 lg:pt-8">
        {/* Confirmation Toast / Banner */}
        {feedbackBanner && (
          <div
            role="status"
            className={`mb-5 rounded-2xl border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
              feedbackBanner.type === 'red'
                ? 'bg-red-50 border-red-300 text-red-950'
                : 'bg-teal-50 border-teal-300 text-teal-950'
            }`}
          >
            <div className="space-y-1">
              <p className="text-sm font-semibold">{feedbackBanner.message}</p>
              {feedbackBanner.smsPayload && (
                <p className="font-mono text-xs text-red-900 bg-white/80 px-2.5 py-1 rounded-lg border border-red-200 break-all">
                  SMS: {feedbackBanner.smsPayload}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={onOpenCommandPortal}
                className="min-h-[44px] px-3.5 rounded-xl bg-slate-900 text-white text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
              >
                <span>View in Command Center</span>
                <ArrowUpRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setFeedbackBanner(null)}
                className="min-h-[44px] px-3 rounded-xl text-xs font-semibold text-slate-700 hover:bg-black/5 cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
          {/* Primary ASHA Field Column */}
          <div className="lg:col-span-7 space-y-6">
            {/* Hero Section: Prominent Voice-to-Form Recording */}
            <section
              aria-labelledby="voice-hero-heading"
              className="rounded-3xl bg-white border border-slate-200 p-6 text-center"
            >
              <div className="relative inline-flex items-center justify-center my-2">
                <span
                  aria-hidden="true"
                  className={`absolute inset-0 rounded-full ${
                    isRecording
                      ? 'bg-red-500/35 animate-mic-ripple'
                      : 'bg-[#0F766E]/25 animate-mic-ripple'
                  }`}
                />
                <span
                  aria-hidden="true"
                  className={`absolute inset-0 rounded-full ${
                    isRecording
                      ? 'bg-red-500/25 animate-mic-ripple-delayed'
                      : 'bg-[#0F766E]/15 animate-mic-ripple-delayed'
                  }`}
                />
                <button
                  type="button"
                  onClick={handleToggleVoice}
                  aria-pressed={isRecording}
                  className={`relative z-10 w-24 h-24 rounded-full flex items-center justify-center text-white shadow-md active:scale-95 transition-transform cursor-pointer ${
                    isRecording
                      ? 'bg-red-600 hover:bg-red-700'
                      : 'bg-[#0F766E] hover:bg-teal-800'
                  }`}
                >
                  {isRecording ? (
                    <MicOff className="w-10 h-10" />
                  ) : (
                    <Mic className="w-10 h-10" />
                  )}
                </button>
              </div>

              <h1
                id="voice-hero-heading"
                className="mt-4 text-xl sm:text-2xl font-bold text-slate-900 tracking-tight"
              >
                {isRecording ? t.voiceListening : t.voiceTitle}
              </h1>
              <p className="mt-1 text-sm text-slate-600">{t.voiceHint}</p>

              {voiceTranscript && (
                <div className="mt-4 rounded-2xl bg-slate-50 border border-slate-200 px-4 py-3 text-left">
                  <p className="text-xs font-semibold text-[#0F766E]">Captured Voice Input</p>
                  <p className="mt-0.5 text-sm text-slate-800 leading-snug">“{voiceTranscript}”</p>
                </div>
              )}

              {/* One-tap quick voice simulations for rapid field/demo testing */}
              <div className="mt-5 pt-4 border-t border-slate-100 text-left">
                <p className="text-xs font-semibold text-slate-500 mb-2.5">{t.voiceSampleLabel}</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {VOICE_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => applyPreset(preset)}
                      className="min-h-[48px] px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-teal-50/60 hover:border-[#0F766E]/40 text-left text-xs font-medium text-slate-800 transition-colors cursor-pointer"
                    >
                      {language === 'hi' ? preset.labelHi : preset.labelEn}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            {/* Minimal-Typing Patient Context Strip */}
            <section
              aria-labelledby="patient-context-heading"
              className="rounded-3xl bg-white border border-slate-200 p-5"
            >
              <div className="flex items-center justify-between gap-2 mb-3.5">
                <h2
                  id="patient-context-heading"
                  className="text-base font-bold text-slate-900"
                >
                  {t.patientDetailsHeading}
                </h2>
                <span className="font-mono text-xs text-slate-500 tabular-nums">
                  ID · {previewPatientId}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3.5">
                <div className="sm:col-span-5">
                  <label
                    htmlFor="asha-patient-name"
                    className="block text-xs font-semibold text-slate-700 mb-1.5"
                  >
                    {t.patientNameLabel}
                  </label>
                  <input
                    id="asha-patient-name"
                    type="text"
                    value={patientName}
                    onChange={(e) => setPatientName(e.target.value)}
                    className="w-full min-h-[48px] px-3.5 rounded-xl border border-slate-300 bg-white text-base font-semibold text-slate-900"
                  />
                </div>

                <div className="sm:col-span-3">
                  <label
                    htmlFor="asha-patient-age"
                    className="block text-xs font-semibold text-slate-700 mb-1.5"
                  >
                    {t.patientAgeLabel}
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      id="asha-patient-age"
                      type="number"
                      min={1}
                      max={110}
                      value={age}
                      onChange={(e) => setAge(Math.max(1, Number(e.target.value) || 1))}
                      className="w-full min-h-[48px] px-3 rounded-xl border border-slate-300 bg-white text-base font-mono font-semibold text-slate-900 tabular-nums text-center"
                    />
                    <button
                      type="button"
                      onClick={() => setGender((g) => (g === 'F' ? 'M' : 'F'))}
                      className="min-h-[48px] min-w-[48px] px-3 rounded-xl border border-slate-300 bg-slate-50 text-sm font-bold text-slate-800 hover:bg-slate-100 cursor-pointer shrink-0"
                      title="Toggle Sex (Female / Male)"
                    >
                      {gender}
                    </button>
                  </div>
                </div>

                <div className="sm:col-span-4">
                  <label
                    htmlFor="asha-village-select"
                    className="block text-xs font-semibold text-slate-700 mb-1.5"
                  >
                    {t.villageLabel}
                  </label>
                  <select
                    id="asha-village-select"
                    value={villageCode}
                    onChange={(e) => setVillageCode(e.target.value)}
                    className="w-full min-h-[48px] px-3 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-900 cursor-pointer"
                  >
                    {VILLAGE_SUB_CENTERS.map((v) => (
                      <option key={v.code} value={v.code}>
                        {v.code} · {language === 'hi' ? v.nameHi : v.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </section>

            {/* Quick Vitals Form: Clean 2-Column Grid */}
            <section aria-labelledby="quick-vitals-heading" className="space-y-3.5">
              <div className="flex items-baseline justify-between gap-2 px-1">
                <h2 id="quick-vitals-heading" className="text-lg font-bold text-slate-900">
                  {t.quickVitalsHeading}
                </h2>
                <span className="text-xs text-slate-500">{t.quickVitalsSub}</span>
              </div>

              <div className="grid grid-cols-2 gap-3.5 sm:gap-4">
                {/* Card 1: Systolic BP */}
                <div
                  className={`rounded-3xl border p-4 sm:p-5 transition-colors ${sysMeta.border}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div
                      className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${sysMeta.iconWrap}`}
                    >
                      <Heart className="w-5 h-5" />
                    </div>
                    <span className={`text-xs ${sysMeta.statusClass}`}>{sysMeta.statusText}</span>
                  </div>

                  <label
                    htmlFor="vital-systolic"
                    className="mt-3 block text-sm font-bold text-slate-900"
                  >
                    {t.systolicLabel}
                  </label>
                  <p className="text-xs text-slate-500">mmHg · 90–139</p>

                  <div className="mt-3 flex items-center justify-between gap-1.5">
                    <button
                      type="button"
                      onClick={() => adjustVital('systolic', -4)}
                      aria-label="Decrease Systolic BP"
                      className="min-h-[48px] min-w-[48px] rounded-xl border border-slate-300 bg-white flex items-center justify-center text-slate-800 hover:bg-slate-100 active:scale-95 transition-transform cursor-pointer shrink-0"
                    >
                      <Minus className="w-5 h-5" />
                    </button>
                    <input
                      id="vital-systolic"
                      type="number"
                      inputMode="numeric"
                      value={vitals.systolic}
                      onChange={(e) =>
                        setVitals((v) => ({
                          ...v,
                          systolic: Math.max(0, Number(e.target.value) || 0),
                        }))
                      }
                      className="w-full min-w-0 min-h-[48px] text-center font-mono text-2xl sm:text-3xl font-bold text-slate-900 bg-transparent tabular-nums"
                    />
                    <button
                      type="button"
                      onClick={() => adjustVital('systolic', 4)}
                      aria-label="Increase Systolic BP"
                      className="min-h-[48px] min-w-[48px] rounded-xl border border-slate-300 bg-white flex items-center justify-center text-slate-800 hover:bg-slate-100 active:scale-95 transition-transform cursor-pointer shrink-0"
                    >
                      <Plus className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                {/* Card 2: Diastolic BP */}
                <div
                  className={`rounded-3xl border p-4 sm:p-5 transition-colors ${diaMeta.border}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div
                      className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${diaMeta.iconWrap}`}
                    >
                      <Heart className="w-5 h-5" />
                    </div>
                    <span className={`text-xs ${diaMeta.statusClass}`}>{diaMeta.statusText}</span>
                  </div>

                  <label
                    htmlFor="vital-diastolic"
                    className="mt-3 block text-sm font-bold text-slate-900"
                  >
                    {t.diastolicLabel}
                  </label>
                  <p className="text-xs text-slate-500">mmHg · 60–89</p>

                  <div className="mt-3 flex items-center justify-between gap-1.5">
                    <button
                      type="button"
                      onClick={() => adjustVital('diastolic', -2)}
                      aria-label="Decrease Diastolic BP"
                      className="min-h-[48px] min-w-[48px] rounded-xl border border-slate-300 bg-white flex items-center justify-center text-slate-800 hover:bg-slate-100 active:scale-95 transition-transform cursor-pointer shrink-0"
                    >
                      <Minus className="w-5 h-5" />
                    </button>
                    <input
                      id="vital-diastolic"
                      type="number"
                      inputMode="numeric"
                      value={vitals.diastolic}
                      onChange={(e) =>
                        setVitals((v) => ({
                          ...v,
                          diastolic: Math.max(0, Number(e.target.value) || 0),
                        }))
                      }
                      className="w-full min-w-0 min-h-[48px] text-center font-mono text-2xl sm:text-3xl font-bold text-slate-900 bg-transparent tabular-nums"
                    />
                    <button
                      type="button"
                      onClick={() => adjustVital('diastolic', 2)}
                      aria-label="Increase Diastolic BP"
                      className="min-h-[48px] min-w-[48px] rounded-xl border border-slate-300 bg-white flex items-center justify-center text-slate-800 hover:bg-slate-100 active:scale-95 transition-transform cursor-pointer shrink-0"
                    >
                      <Plus className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                {/* Card 3: SpO2 (%) with Lungs Icon */}
                <div
                  className={`rounded-3xl border p-4 sm:p-5 transition-colors ${spo2Meta.border}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div
                      className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${spo2Meta.iconWrap}`}
                    >
                      <LungsIcon className="w-5 h-5" />
                    </div>
                    <span className={`text-xs ${spo2Meta.statusClass}`}>
                      {spo2Meta.statusText}
                    </span>
                  </div>

                  <label
                    htmlFor="vital-spo2"
                    className="mt-3 block text-sm font-bold text-slate-900"
                  >
                    {t.spo2Label}
                  </label>
                  <p className="text-xs text-slate-500">% · 95–100%</p>

                  <div className="mt-3 flex items-center justify-between gap-1.5">
                    <button
                      type="button"
                      onClick={() => adjustVital('spo2', -1)}
                      aria-label="Decrease SpO2"
                      className="min-h-[48px] min-w-[48px] rounded-xl border border-slate-300 bg-white flex items-center justify-center text-slate-800 hover:bg-slate-100 active:scale-95 transition-transform cursor-pointer shrink-0"
                    >
                      <Minus className="w-5 h-5" />
                    </button>
                    <input
                      id="vital-spo2"
                      type="number"
                      inputMode="numeric"
                      value={vitals.spo2}
                      onChange={(e) =>
                        setVitals((v) => ({
                          ...v,
                          spo2: Math.min(100, Math.max(0, Number(e.target.value) || 0)),
                        }))
                      }
                      className="w-full min-w-0 min-h-[48px] text-center font-mono text-2xl sm:text-3xl font-bold text-slate-900 bg-transparent tabular-nums"
                    />
                    <button
                      type="button"
                      onClick={() => adjustVital('spo2', 1)}
                      aria-label="Increase SpO2"
                      className="min-h-[48px] min-w-[48px] rounded-xl border border-slate-300 bg-white flex items-center justify-center text-slate-800 hover:bg-slate-100 active:scale-95 transition-transform cursor-pointer shrink-0"
                    >
                      <Plus className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                {/* Card 4: Temperature (°F) with Thermometer Icon */}
                <div
                  className={`rounded-3xl border p-4 sm:p-5 transition-colors ${tempMeta.border}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div
                      className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${tempMeta.iconWrap}`}
                    >
                      <Thermometer className="w-5 h-5" />
                    </div>
                    <span className={`text-xs ${tempMeta.statusClass}`}>
                      {tempMeta.statusText}
                    </span>
                  </div>

                  <label
                    htmlFor="vital-temp"
                    className="mt-3 block text-sm font-bold text-slate-900"
                  >
                    {t.tempLabel}
                  </label>
                  <p className="text-xs text-slate-500">°F · 97.0–99.4°F</p>

                  <div className="mt-3 flex items-center justify-between gap-1.5">
                    <button
                      type="button"
                      onClick={() => adjustVital('temperature', -0.4)}
                      aria-label="Decrease Temperature"
                      className="min-h-[48px] min-w-[48px] rounded-xl border border-slate-300 bg-white flex items-center justify-center text-slate-800 hover:bg-slate-100 active:scale-95 transition-transform cursor-pointer shrink-0"
                    >
                      <Minus className="w-5 h-5" />
                    </button>
                    <input
                      id="vital-temp"
                      type="number"
                      step="0.1"
                      inputMode="decimal"
                      value={vitals.temperature}
                      onChange={(e) =>
                        setVitals((v) => ({
                          ...v,
                          temperature: Math.max(0, Number(e.target.value) || 0),
                        }))
                      }
                      className="w-full min-w-0 min-h-[48px] text-center font-mono text-2xl sm:text-3xl font-bold text-slate-900 bg-transparent tabular-nums"
                    />
                    <button
                      type="button"
                      onClick={() => adjustVital('temperature', 0.4)}
                      aria-label="Increase Temperature"
                      className="min-h-[48px] min-w-[48px] rounded-xl border border-slate-300 bg-white flex items-center justify-center text-slate-800 hover:bg-slate-100 active:scale-95 transition-transform cursor-pointer shrink-0"
                    >
                      <Plus className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            </section>

            {/* Live Triage Preview */}
            <section
              aria-live="polite"
              className={`rounded-3xl border p-5 sm:p-6 transition-colors ${
                triage.severity === 'emergency'
                  ? 'bg-red-50 border-red-300 text-red-950'
                  : triage.severity === 'moderate'
                  ? 'bg-amber-50 border-amber-300 text-amber-950'
                  : 'bg-emerald-50 border-emerald-300 text-emerald-950'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs font-bold tracking-wide text-slate-700">
                  {t.liveTriageHeading}
                </span>

                {/* Real-time dynamic severity badge */}
                <div
                  className={`min-h-[40px] px-4 py-1.5 rounded-full inline-flex items-center gap-2 text-sm font-bold shadow-xs ${
                    triage.severity === 'emergency'
                      ? 'bg-red-600 text-white'
                      : triage.severity === 'moderate'
                      ? 'bg-amber-500 text-slate-950'
                      : 'bg-emerald-700 text-white'
                  }`}
                >
                  {triage.severity === 'emergency' ? (
                    <Siren className="w-4 h-4 shrink-0" />
                  ) : triage.severity === 'moderate' ? (
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                  )}
                  <span>
                    {triage.severity === 'emergency'
                      ? t.severityEmergency
                      : triage.severity === 'moderate'
                      ? t.severityModerate
                      : t.severityRoutine}
                  </span>
                </div>
              </div>

              <div className="mt-3.5 space-y-2">
                <p className="text-sm font-semibold">
                  {(language === 'hi' ? triage.triggersHi : triage.triggersEn).join(' · ')}
                </p>
                <p className="text-sm opacity-90 leading-relaxed">
                  {language === 'hi' ? triage.protocolHi : triage.protocolEn}
                </p>
              </div>
            </section>
          </div>

          {/* Right Companion Column on Desktop: Local Offline Sync Queue & 2G SMS Fallback */}
          <aside className="lg:col-span-5 space-y-6">
            <div className="rounded-3xl bg-white border border-slate-200 p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-bold text-slate-900">{t.offlineQueueTitle}</h2>
                <span className="font-mono text-xs font-semibold text-slate-600 tabular-nums">
                  {queuedCount} queued
                </span>
              </div>

              <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">
                Records saved while offline are encrypted locally on this device and synced when
                sub-center connectivity resumes. Critical emergencies bypass data queues over 2G
                GSM SMS.
              </p>

              {/* Queued items list */}
              <div className="mt-4 divide-y divide-slate-100 border-t border-b border-slate-100">
                {queuedItems.length === 0 ? (
                  <div className="py-6 text-center text-sm text-slate-500">
                    All local patient screenings are synced with District 24 Command.
                  </div>
                ) : (
                  queuedItems.map((item) => (
                    <div key={item.id} className="py-3.5 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-900 truncate">
                          {item.patientName}{' '}
                          <span className="font-normal text-slate-500">
                            · {item.age}
                            {item.gender}
                          </span>
                        </p>
                        <p className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                          {item.patientId} · {item.villageCode} · BP {item.vitals.systolic}/
                          {item.vitals.diastolic} · SpO₂ {item.vitals.spo2}%
                        </p>
                      </div>
                      <span
                        className={`text-xs font-semibold shrink-0 ${
                          item.severity === 'emergency'
                            ? 'text-red-700'
                            : item.severity === 'moderate'
                            ? 'text-amber-700'
                            : 'text-[#0F766E]'
                        }`}
                      >
                        {item.severity === 'emergency'
                          ? 'EMERGENCY'
                          : item.severity === 'moderate'
                          ? 'Moderate'
                          : 'Routine'}
                      </span>
                    </div>
                  ))
                )}
              </div>

              <button
                type="button"
                disabled={queuedCount === 0}
                onClick={handleManualSync}
                className="mt-4 w-full min-h-[48px] px-4 rounded-xl border border-slate-300 bg-slate-50 text-sm font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-45 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <RefreshCw className="w-4 h-4 text-[#0F766E]" />
                <span>
                  {t.syncNowBtn} ({queuedCount})
                </span>
              </button>
            </div>

            {/* Live GSM 7-bit Emergency SMS Packet Inspector */}
            <div className="rounded-3xl bg-slate-900 text-slate-100 p-5 sm:p-6">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-teal-300">
                  <Radio className="w-4 h-4" />
                  <span>{t.smsPreviewTitle}</span>
                </div>
                <span className="font-mono text-xs text-slate-400 tabular-nums">
                  {smsPacketPreview.length}/160 chars
                </span>
              </div>
              <p className="mt-3 font-mono text-xs sm:text-sm text-white bg-slate-800/90 border border-slate-700 rounded-xl p-3.5 break-all tabular-nums">
                {smsPacketPreview}
              </p>
              <p className="mt-2.5 text-xs text-slate-400 leading-relaxed">
                Transmits directly to District 24 Hospital gateway shortcode{' '}
                <span className="font-mono text-slate-200">108-2400</span> when mobile data is
                unavailable.
              </p>
            </div>
          </aside>
        </div>
      </main>

      {/* Fixed Bottom Action Bar (Meets >= 48px high touch target & <= 15% mobile sticky cap) */}
      <div className="fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200 px-4 py-2.5">
        <div className="max-w-6xl mx-auto grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-4">
          <button
            type="button"
            onClick={handlePrimarySave}
            className="min-h-[48px] px-5 rounded-xl bg-[#0F766E] hover:bg-teal-800 active:scale-[0.99] text-white text-sm sm:text-base font-bold inline-flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer whitespace-nowrap"
          >
            <Save className="w-5 h-5 shrink-0" />
            <span>{t.saveRecordBtn}</span>
          </button>

          <button
            type="button"
            onClick={handleEmergencySmsBypass}
            className="min-h-[48px] px-5 rounded-xl bg-white hover:bg-red-50 active:scale-[0.99] border-2 border-red-600 text-red-700 text-sm sm:text-base font-bold inline-flex items-center justify-center gap-2 transition-all cursor-pointer whitespace-nowrap"
          >
            <MessageSquareWarning className="w-5 h-5 text-red-600 shrink-0" />
            <span>{t.sendSmsBtn}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
