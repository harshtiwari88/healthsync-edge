import React, {useState, useRef, useEffect} from 'react';
import {motion, AnimatePresence} from 'motion/react';
import {
  Mic,
  MicOff,
  Heart,
  Thermometer,
  Activity,
  CheckCircle2,
  AlertTriangle,
  Siren,
  Save,
  MessageSquareLock,
  RefreshCw,
  Minus,
  Plus,
  Bluetooth,
  Bot,
  Coins,
  X,
  Send,
  ShieldCheck,
  Volume2,
} from 'lucide-react';
import {
  ALL_SYMPTOMS,
  ConjunctivaPixelMetrics,
  CoughAudioMetrics,
  EdgeAiDiagnostics,
  IncentiveEntry,
  Language,
  NetworkState,
  SymptomKey,
  TriageRecord,
  VitalsSnapshot,
  evaluateTriage,
  evaluateVitalStatus,
} from '../types/triage';
import {UI_COPY} from '../data/initialData';
import {encodeVitalsToSMS} from '../utils/binarySmsCodec';
import {
  BrowserSpeechRecognition,
  DetectedEntityBadge,
  createBrowserSpeechRecognition,
  parseClinicalTranscript,
  speakClinicalGuidance,
} from '../utils/speechEngine';
import {LungsIcon} from './Icons';
import {EdgeAiDiagnosticsPanel} from './EdgeAiDiagnosticsPanel';
import {AshaSaheliModal, SaheliFormPatch} from './AshaSaheliModal';
import {IncentiveLedgerModal} from './IncentiveLedgerModal';

interface AshaWorkerPWAProps {
  ashaId: string;
  records: TriageRecord[];
  incentives: IncentiveEntry[];
  language: Language;
  networkState: NetworkState;
  audioMuted: boolean;
  onSaveRecord: (params: {
    patientName: string;
    age: number;
    gender: 'F' | 'M' | 'O';
    abhaId: string;
    villageCode: string;
    vitals: VitalsSnapshot;
    symptoms: SymptomKey[];
    edgeAi: EdgeAiDiagnostics;
    clinicalNotes: string;
    channel: 'Data' | 'Emergency SMS';
  }) => TriageRecord;
  onSyncOfflineQueue: () => number;
  onSwitchToCommand: () => void;
}

const VOICE_TEST_CHIPS = [
  'BP 160/100 SpO2 88%',
  'Bukhar 102°F khansi',
  'Emergency First-Aid Steps',
] as const;

export const AshaWorkerPWA: React.FC<AshaWorkerPWAProps> = ({
  ashaId,
  records,
  incentives,
  language,
  networkState,
  audioMuted,
  onSaveRecord,
  onSyncOfflineQueue,
  onSwitchToCommand,
}) => {
  const copy = UI_COPY[language];

  // Patient & Vitals state
  const [patientName, setPatientName] = useState<string>('Ramesh Kumar');
  const [age, setAge] = useState<number>(48);
  const [gender, setGender] = useState<'F' | 'M' | 'O'>('M');
  const [abhaId, setAbhaId] = useState<string>('91-8834-2201-5590');
  const [vitals, setVitals] = useState<VitalsSnapshot>({
    systolic: 124,
    diastolic: 80,
    spo2: 98,
    temperature: 98.6,
    heartRate: 78,
  });
  const [symptoms, setSymptoms] = useState<SymptomKey[]>([]);
  const [clinicalNotes, setClinicalNotes] = useState<string>(
    'Household rural primary screening at PHC Village Rampur.'
  );

  // Real SpeechRecognition state
  const [isListeningVoice, setIsListeningVoice] = useState<boolean>(false);
  const [liveTranscript, setLiveTranscript] = useState<string>('');
  const [detectedBadges, setDetectedBadges] = useState<DetectedEntityBadge[]>([]);
  const [speechErrorMsg, setSpeechErrorMsg] = useState<string | null>(null);

  // Real Camera & Web Audio Diagnostic results
  const [conjunctivaMetrics, setConjunctivaMetrics] = useState<
    ConjunctivaPixelMetrics | undefined
  >(undefined);
  const [coughMetrics, setCoughMetrics] = useState<CoughAudioMetrics | undefined>(undefined);

  // Modals & Toasts
  const [saheliModalOpen, setSaheliModalOpen] = useState<boolean>(false);
  const [incentiveModalOpen, setIncentiveModalOpen] = useState<boolean>(false);
  const [smsModalOpen, setSmsModalOpen] = useState<boolean>(false);
  const [toastBanner, setToastBanner] = useState<{
    tone: 'teal' | 'red';
    message: string;
  } | null>(null);

  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const prevSeverityRef = useRef<string>('routine');

  const pendingSyncCount = records.filter((r) => r.syncStatus === 'Queued Offline').length;
  const totalIncentiveToday = incentives.reduce((sum, item) => sum + item.amountInr, 0);

  const edgeAiState: EdgeAiDiagnostics = {
    anemiaSuspected: Boolean(conjunctivaMetrics?.pallorDetected),
    estimatedHb: conjunctivaMetrics?.estimatedHb,
    conjunctivaMetrics,
    respiratoryRiskHigh: Boolean(coughMetrics?.highRespiratoryRisk),
    coughPeakHz: coughMetrics?.dominantFrequencyHz,
    coughMetrics,
  };

  const triage = evaluateTriage(vitals, symptoms, edgeAiState);
  const nextPatientId = `PT${8925 + records.length + 1}`;
  const liveBitPackedSms = encodeVitalsToSMS({
    patientId: nextPatientId,
    villageCode: 'VIL-204',
    vitals,
    symptoms,
    edgeAi: edgeAiState,
    severity: triage.severity === 'routine' ? 'emergency' : triage.severity,
  });

  // Automatically speak out Hindi clinical advice when Triage Score reaches RED
  useEffect(() => {
    if (triage.severity === 'emergency' && prevSeverityRef.current !== 'emergency') {
      speakClinicalGuidance(triage.protocolHi, 'hi-IN', audioMuted);
    }
    prevSeverityRef.current = triage.severity;
  }, [triage.severity, triage.protocolHi, audioMuted]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  const applyParsedTranscript = (spokenText: string, speakReply = false) => {
    setLiveTranscript(spokenText);
    const parsed = parseClinicalTranscript(spokenText);
    setDetectedBadges(parsed.badges);

    if (parsed.isEmergencyFirstAidQuery) {
      const adviceHi =
        'दीदी, आपातकालीन प्राथमिक उपचार: मरीज़ को सहारा देकर बिठाएं, श्वास मार्ग खुला रखें, और तुरंत एन्क्रिप्टेड इमरजेंसी एसएमएस भेजें।';
      setClinicalNotes('Emergency First-Aid Steps reviewed via ASHA Saheli Voice.');
      if (speakReply) {
        speakClinicalGuidance(adviceHi, 'hi-IN', audioMuted);
      }
      return;
    }

    if (Object.keys(parsed.vitalsPatch).length > 0) {
      setVitals((prev) => ({...prev, ...parsed.vitalsPatch}));
    }
    if (parsed.detectedSymptoms.length > 0) {
      setSymptoms((prev) => Array.from(new Set([...prev, ...parsed.detectedSymptoms])));
    }
    setClinicalNotes(`Live Voice Capture: "${spokenText}"`);

    if (speakReply && parsed.badges.length > 0) {
      const summaryText = parsed.badges.map((b) => b.label).join(', ');
      speakClinicalGuidance(
        `वाइटल्स दर्ज किए गए: ${summaryText}`,
        'hi-IN',
        audioMuted
      );
    }
  };

  const handleToggleRealVoice = () => {
    setSpeechErrorMsg(null);
    if (isListeningVoice) {
      recognitionRef.current?.stop();
      setIsListeningVoice(false);
      return;
    }

    const recognition = createBrowserSpeechRecognition(
      language === 'en' ? 'en-IN' : 'hi-IN'
    );
    if (!recognition) {
      setSpeechErrorMsg(
        'Browser SpeechRecognition API unavailable here. Use Chrome/Edge or tap a Voice Test Chip below.'
      );
      return;
    }

    let finalAccumulated = '';
    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const piece = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalAccumulated += piece + ' ';
        } else {
          interim += piece;
        }
      }
      const combined = (finalAccumulated + interim).trim();
      if (combined) {
        applyParsedTranscript(combined, false);
      }
    };

    recognition.onerror = (ev) => {
      setIsListeningVoice(false);
      setSpeechErrorMsg(`Microphone status: ${ev.error}. Ensure microphone access is allowed.`);
    };

    recognition.onend = () => {
      setIsListeningVoice(false);
      if (finalAccumulated.trim()) {
        applyParsedTranscript(finalAccumulated.trim(), true);
      }
    };

    try {
      recognitionRef.current = recognition;
      setIsListeningVoice(true);
      recognition.start();
    } catch {
      setIsListeningVoice(false);
      setSpeechErrorMsg('Unable to start microphone speech recognition.');
    }
  };

  const handleSaheliModalPatch = (patch: SaheliFormPatch) => {
    if (patch.vitals) {
      setVitals((prev) => ({...prev, ...patch.vitals}));
    }
    if (patch.symptoms) {
      setSymptoms((prev) => Array.from(new Set([...prev, ...patch.symptoms!])));
    }
    if (patch.clinicalNotes) {
      setClinicalNotes(patch.clinicalNotes);
    }
    if (patch.rawTranscript) {
      setLiveTranscript(patch.rawTranscript);
      setDetectedBadges(parseClinicalTranscript(patch.rawTranscript).badges);
    }
  };

  const adjustVital = (field: keyof VitalsSnapshot, delta: number) => {
    setVitals((prev) => {
      const next = Number((prev[field] + delta).toFixed(1));
      if (field === 'systolic') return {...prev, systolic: Math.min(250, Math.max(55, next))};
      if (field === 'diastolic') return {...prev, diastolic: Math.min(155, Math.max(35, next))};
      if (field === 'spo2') return {...prev, spo2: Math.min(100, Math.max(55, next))};
      if (field === 'heartRate') return {...prev, heartRate: Math.min(220, Math.max(35, next))};
      return {...prev, temperature: Math.min(108, Math.max(93, next))};
    });
  };

  const toggleSymptom = (sym: SymptomKey) => {
    setSymptoms((prev) =>
      prev.includes(sym) ? prev.filter((s) => s !== sym) : [...prev, sym]
    );
  };

  const handleSaveOffline = () => {
    const saved = onSaveRecord({
      patientName: patientName.trim() || 'Unnamed Patient',
      age,
      gender,
      abhaId,
      villageCode: 'VIL-204',
      vitals,
      symptoms,
      edgeAi: edgeAiState,
      clinicalNotes,
      channel: 'Data',
    });

    setToastBanner({
      tone: saved.severity === 'emergency' ? 'red' : 'teal',
      message:
        networkState === 'offline'
          ? `Stored ${saved.patientId} in localStorage ('healthsync_records') · Offline Queue Updated!`
          : `Saved & broadcast ${saved.patientId} live to District Command Center!`,
    });
  };

  const handleConfirmSendSms = () => {
    const sent = onSaveRecord({
      patientName: patientName.trim() || 'Emergency Patient',
      age,
      gender,
      abhaId,
      villageCode: 'VIL-204',
      vitals,
      symptoms,
      edgeAi: edgeAiState,
      clinicalNotes,
      channel: 'Emergency SMS',
    });
    setSmsModalOpen(false);
    setToastBanner({
      tone: 'red',
      message: `Bit-packed SMS (${sent.binarySmsPayload}) broadcast live to District Command!`,
    });
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] py-6 px-2 sm:px-4 flex justify-center items-start">
      {/* Realistic iPhone/Android Glassmorphic Bezel Frame */}
      <div className="w-full max-w-md rounded-[40px] shadow-2xl border-8 border-slate-800 bg-slate-900/5 p-2.5 sm:p-3">
        <div className="rounded-[28px] bg-white overflow-hidden border border-slate-200 flex flex-col">
          {/* Bezel Speaker Pill */}
          <div className="bg-[#0F172A] px-5 py-2 flex items-center justify-between text-[11px] font-mono text-slate-300">
            <span>PHC Rampur · VIL-204</span>
            <div className="w-16 h-1.5 rounded-full bg-slate-700" />
            <span className="text-[#06B6D4] font-semibold">ABDM Edge</span>
          </div>

          {/* Mobile Header */}
          <header className="p-4 bg-white border-b border-slate-200 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-11 h-11 rounded-2xl bg-[#0D9488] text-white font-bold text-sm flex items-center justify-center shrink-0 shadow-xs">
                  SD
                </div>
                <div className="min-w-0">
                  <h1 className="text-sm font-bold text-[#0F172A] truncate">
                    Sunita Devi ({ashaId.includes('8842') ? 'ASHA #8842' : ashaId})
                  </h1>
                  <p className="text-xs font-medium text-slate-600 truncate">
                    PHC: Village Rampur · <span className="font-mono text-[#0D9488]">VIL-204</span>
                  </p>
                </div>
              </div>

              {pendingSyncCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    if (networkState !== 'offline') {
                      const c = onSyncOfflineQueue();
                      setToastBanner({
                        tone: 'teal',
                        message: `Synced ${c} queued offline records to District HQ.`,
                      });
                    }
                  }}
                  title="Pending Offline Sync Queue"
                  className="min-h-[40px] px-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer shrink-0 tabular-nums"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-[#F59E0B]" />
                  <span>{pendingSyncCount} Queued</span>
                </button>
              )}
            </div>

            {/* Interactive "Mera Incentive" Badge with Green Coin Animation */}
            <button
              type="button"
              onClick={() => setIncentiveModalOpen(true)}
              className="w-full min-h-[48px] px-3.5 py-2 rounded-2xl bg-emerald-50 hover:bg-emerald-100/80 border border-emerald-200 flex items-center justify-between gap-2 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2.5">
                <motion.span
                  animate={{rotateY: [0, 180, 360]}}
                  transition={{duration: 3.2, repeat: Infinity, ease: 'easeInOut'}}
                  className="w-7 h-7 rounded-full bg-[#10B981] text-white flex items-center justify-center shadow-2xs shrink-0"
                >
                  <Coins className="w-4 h-4" />
                </motion.span>
                <span className="text-xs font-bold text-emerald-950 tabular-nums">
                  Mera Incentive: ₹{totalIncentiveToday} Earned Today
                </span>
              </div>
              <span className="text-[11px] font-bold text-[#0D9488]">View Ledger →</span>
            </button>
          </header>

          {/* Main Field App Content */}
          <div className="p-4 space-y-5 bg-[#F8FAFC]">
            {/* Action Feedback Toast */}
            <AnimatePresence>
              {toastBanner && (
                <motion.div
                  initial={{opacity: 0, y: -8}}
                  animate={{opacity: 1, y: 0}}
                  exit={{opacity: 0, y: -8}}
                  className={`rounded-2xl border p-3.5 flex items-start justify-between gap-2 text-xs font-semibold ${
                    toastBanner.tone === 'red'
                      ? 'bg-red-50 border-[#EF4444] text-red-950'
                      : 'bg-teal-50 border-[#0D9488] text-teal-950'
                  }`}
                >
                  <div className="space-y-1">
                    <p>{toastBanner.message}</p>
                    <button
                      type="button"
                      onClick={onSwitchToCommand}
                      className="underline font-bold text-[#0D9488] cursor-pointer"
                    >
                      Open District Command Center →
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setToastBanner(null)}
                    aria-label="Close alert"
                    className="p-1 text-slate-500 hover:text-slate-900 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Hero Module: "ASHA Saheli" Conversational Voice Assistant */}
            <section className="rounded-3xl bg-[#0F172A] text-white p-4 sm:p-5 space-y-3.5 shadow-md">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="text-[11px] font-mono font-semibold text-[#06B6D4]">
                    ASHA SAHELI · REAL WEB SPEECH
                  </span>
                  <h2 className="text-base font-bold text-white">
                    Conversational Voice-to-Triage
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setSaheliModalOpen(true)}
                  className="min-h-[40px] px-3 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-bold text-[#06B6D4] inline-flex items-center gap-1.5 cursor-pointer shrink-0"
                >
                  <Bot className="w-4 h-4" />
                  <span>Chat Modal</span>
                </button>
              </div>

              {/* Animated SVG Soundwave Visualizer */}
              <div className="rounded-2xl bg-slate-900/90 border border-slate-800 px-3 py-2.5 flex items-center justify-center">
                <svg
                  viewBox="0 0 280 42"
                  className="w-full h-10"
                  aria-hidden="true"
                >
                  {Array.from({length: 24}).map((_, idx) => {
                    const baseH = 8 + ((idx * 7) % 18);
                    return (
                      <motion.rect
                        key={idx}
                        x={8 + idx * 11.2}
                        y={21 - baseH / 2}
                        width="5"
                        rx="2.5"
                        height={baseH}
                        fill={isListeningVoice ? '#EF4444' : '#06B6D4'}
                        animate={
                          isListeningVoice
                            ? {
                                height: [8, 34, 12, 28, 10],
                                y: [17, 4, 15, 7, 16],
                              }
                            : {
                                height: [baseH * 0.5, baseH, baseH * 0.55],
                                y: [21 - baseH * 0.25, 21 - baseH / 2, 21 - baseH * 0.27],
                              }
                        }
                        transition={{
                          duration: isListeningVoice ? 0.55 : 1.6,
                          repeat: Infinity,
                          delay: idx * 0.04,
                        }}
                      />
                    );
                  })}
                </svg>
              </div>

              {/* Main Voice Recognition Trigger Button */}
              <button
                type="button"
                onClick={handleToggleRealVoice}
                aria-pressed={isListeningVoice}
                className={`w-full min-h-[52px] px-4 rounded-2xl text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer ${
                  isListeningVoice
                    ? 'bg-[#EF4444] hover:bg-red-600 text-white animate-pulse'
                    : 'bg-[#0D9488] hover:bg-teal-600 text-white'
                }`}
              >
                {isListeningVoice ? (
                  <>
                    <MicOff className="w-5 h-5 shrink-0" />
                    <span>Listening Live... Tap to Finish Speaking</span>
                  </>
                ) : (
                  <span>{copy.boleinBtn}</span>
                )}
              </button>

              {speechErrorMsg && (
                <p className="text-[11px] text-amber-300 bg-amber-950/60 border border-amber-700/50 rounded-xl px-3 py-2">
                  {speechErrorMsg}
                </p>
              )}

              {/* Live Speech Transcript Box with Highlighted Auto-Detected Entities */}
              <div className="rounded-2xl bg-white text-slate-900 p-3.5 space-y-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-bold text-slate-500">Live Speech Transcript</span>
                  {liveTranscript && (
                    <button
                      type="button"
                      onClick={() =>
                        speakClinicalGuidance(triage.protocolHi, 'hi-IN', false)
                      }
                      className="inline-flex items-center gap-1 font-bold text-[#0D9488] cursor-pointer"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                      <span>Speak Advice</span>
                    </button>
                  )}
                </div>

                <p className="text-xs font-medium text-slate-800 min-h-[20px]">
                  {liveTranscript
                    ? `“${liveTranscript}”`
                    : 'Say e.g. "BP 140 by 90 Oxygen 92 Bukhar 101 Cough"'}
                </p>

                {detectedBadges.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1 border-t border-slate-100">
                    {detectedBadges.map((b) => (
                      <span
                        key={b.key}
                        className={`px-2 py-0.5 rounded-md text-[11px] font-bold ${
                          b.tone === 'red'
                            ? 'bg-red-100 text-red-800'
                            : b.tone === 'amber'
                            ? 'bg-amber-100 text-amber-900'
                            : 'bg-teal-100 text-teal-800'
                        }`}
                      >
                        {b.label}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Quick Voice Test Chips */}
              <div className="space-y-1.5">
                <span className="block text-[10px] font-semibold text-slate-400">
                  Quick Voice Test Chips:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {VOICE_TEST_CHIPS.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => applyParsedTranscript(chip, true)}
                      className="min-h-[36px] px-3 py-1 rounded-full bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] font-semibold text-teal-200 transition-colors cursor-pointer"
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            {/* Patient Identity Card */}
            <section className="rounded-3xl bg-white border border-slate-200 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-bold text-[#0F172A]">Patient &amp; ABHA Identity</h2>
                <span className="font-mono text-[11px] text-[#0D9488] font-bold tabular-nums">
                  {nextPatientId}
                </span>
              </div>

              <div className="grid grid-cols-12 gap-2.5">
                <div className="col-span-8">
                  <label htmlFor="field-pt-name" className="block text-[11px] font-bold text-slate-600 mb-1">
                    Patient Name
                  </label>
                  <input
                    id="field-pt-name"
                    type="text"
                    value={patientName}
                    onChange={(e) => setPatientName(e.target.value)}
                    className="w-full min-h-[48px] px-3 rounded-xl border border-slate-300 text-sm font-bold text-slate-900"
                  />
                </div>
                <div className="col-span-4">
                  <label htmlFor="field-pt-age" className="block text-[11px] font-bold text-slate-600 mb-1">
                    Age / Sex
                  </label>
                  <div className="flex gap-1">
                    <input
                      id="field-pt-age"
                      type="number"
                      value={age}
                      onChange={(e) => setAge(Math.max(1, Number(e.target.value) || 1))}
                      className="w-full min-h-[48px] px-2 rounded-xl border border-slate-300 font-mono text-sm font-bold text-center tabular-nums"
                    />
                    <button
                      type="button"
                      onClick={() => setGender((g) => (g === 'M' ? 'F' : g === 'F' ? 'O' : 'M'))}
                      className="min-h-[48px] px-2.5 rounded-xl bg-slate-100 border border-slate-300 text-xs font-bold text-slate-800 cursor-pointer"
                    >
                      {gender}
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor="field-abha-id" className="text-[11px] font-bold text-slate-600">
                    ABHA Health ID
                  </label>
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#0D9488]">
                    <ShieldCheck className="w-3 h-3 text-[#10B981]" />
                    ABDM
                  </span>
                </div>
                <input
                  id="field-abha-id"
                  type="text"
                  value={abhaId}
                  onChange={(e) => setAbhaId(e.target.value)}
                  className="w-full min-h-[46px] px-3 rounded-xl border border-slate-300 font-mono text-xs font-semibold text-slate-800 tabular-nums"
                />
              </div>
            </section>

            {/* Vital Metrics Input Cards (Tactile UI) */}
            <section className="rounded-3xl bg-white border border-slate-200 p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-[#0F172A]">{copy.triageFormTitle}</h2>
                <span className="text-[11px] text-slate-500">Tap + / −</span>
              </div>

              {/* Blood Pressure Full-Width Dual Card (Systolic / Diastolic) */}
              <div
                className={`rounded-2xl border p-3.5 ${
                  evaluateVitalStatus('systolic', vitals.systolic) === 'emergency' ||
                  evaluateVitalStatus('diastolic', vitals.diastolic) === 'emergency'
                    ? 'border-[#EF4444] bg-red-50/50'
                    : evaluateVitalStatus('systolic', vitals.systolic) === 'moderate'
                    ? 'border-[#F59E0B] bg-amber-50/50'
                    : 'border-slate-200 bg-slate-50/70'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-bold text-slate-800 mb-2">
                  <span className="inline-flex items-center gap-1.5">
                    <Heart className="w-4 h-4 text-[#0D9488]" />
                    Systolic / Diastolic BP
                  </span>
                  <span className="font-mono text-[11px] text-slate-500">mmHg</span>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div className="flex items-center justify-between bg-white rounded-xl border border-slate-200 p-1">
                    <button
                      type="button"
                      onClick={() => adjustVital('systolic', -5)}
                      aria-label="Decrease Systolic BP"
                      className="min-h-[44px] min-w-[40px] rounded-lg hover:bg-slate-100 flex items-center justify-center cursor-pointer"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <div className="text-center">
                      <span className="block text-[9px] text-slate-400 font-bold">SYS</span>
                      <input
                        type="number"
                        aria-label="Systolic BP"
                        value={vitals.systolic}
                        onChange={(e) =>
                          setVitals((v) => ({...v, systolic: Number(e.target.value) || 0}))
                        }
                        className="w-14 text-center font-mono text-lg font-bold text-slate-900 bg-transparent tabular-nums"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => adjustVital('systolic', 5)}
                      aria-label="Increase Systolic BP"
                      className="min-h-[44px] min-w-[40px] rounded-lg hover:bg-slate-100 flex items-center justify-center cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex items-center justify-between bg-white rounded-xl border border-slate-200 p-1">
                    <button
                      type="button"
                      onClick={() => adjustVital('diastolic', -2)}
                      aria-label="Decrease Diastolic BP"
                      className="min-h-[44px] min-w-[40px] rounded-lg hover:bg-slate-100 flex items-center justify-center cursor-pointer"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <div className="text-center">
                      <span className="block text-[9px] text-slate-400 font-bold">DIA</span>
                      <input
                        type="number"
                        aria-label="Diastolic BP"
                        value={vitals.diastolic}
                        onChange={(e) =>
                          setVitals((v) => ({...v, diastolic: Number(e.target.value) || 0}))
                        }
                        className="w-14 text-center font-mono text-lg font-bold text-slate-900 bg-transparent tabular-nums"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => adjustVital('diastolic', 2)}
                      aria-label="Increase Diastolic BP"
                      className="min-h-[44px] min-w-[40px] rounded-lg hover:bg-slate-100 flex items-center justify-center cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              {/* SpO2, Body Temp, Heart Rate Cards */}
              <div className="grid grid-cols-3 gap-2">
                {/* SpO2 */}
                <div
                  className={`rounded-2xl border p-2.5 flex flex-col justify-between ${
                    evaluateVitalStatus('spo2', vitals.spo2) === 'emergency'
                      ? 'border-[#EF4444] bg-red-50/50'
                      : evaluateVitalStatus('spo2', vitals.spo2) === 'moderate'
                      ? 'border-[#F59E0B] bg-amber-50/50'
                      : 'border-slate-200 bg-slate-50/70'
                  }`}
                >
                  <div className="flex items-center justify-between text-[11px] font-bold text-slate-700">
                    <LungsIcon className="w-3.5 h-3.5 text-[#0D9488]" />
                    <span>SpO₂ %</span>
                  </div>
                  <input
                    type="number"
                    aria-label="SpO2"
                    value={vitals.spo2}
                    onChange={(e) =>
                      setVitals((v) => ({...v, spo2: Number(e.target.value) || 0}))
                    }
                    className="my-1.5 w-full text-center font-mono text-xl font-bold text-slate-900 bg-transparent tabular-nums"
                  />
                  <div className="grid grid-cols-2 gap-1">
                    <button
                      type="button"
                      onClick={() => adjustVital('spo2', -1)}
                      className="min-h-[40px] rounded-lg bg-white border border-slate-200 flex items-center justify-center cursor-pointer"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => adjustVital('spo2', 1)}
                      className="min-h-[40px] rounded-lg bg-white border border-slate-200 flex items-center justify-center cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Body Temp */}
                <div
                  className={`rounded-2xl border p-2.5 flex flex-col justify-between ${
                    evaluateVitalStatus('temperature', vitals.temperature) === 'emergency'
                      ? 'border-[#EF4444] bg-red-50/50'
                      : evaluateVitalStatus('temperature', vitals.temperature) === 'moderate'
                      ? 'border-[#F59E0B] bg-amber-50/50'
                      : 'border-slate-200 bg-slate-50/70'
                  }`}
                >
                  <div className="flex items-center justify-between text-[11px] font-bold text-slate-700">
                    <Thermometer className="w-3.5 h-3.5 text-[#0D9488]" />
                    <span>Temp °F</span>
                  </div>
                  <input
                    type="number"
                    step="0.1"
                    aria-label="Body Temperature"
                    value={vitals.temperature}
                    onChange={(e) =>
                      setVitals((v) => ({...v, temperature: Number(e.target.value) || 0}))
                    }
                    className="my-1.5 w-full text-center font-mono text-xl font-bold text-slate-900 bg-transparent tabular-nums"
                  />
                  <div className="grid grid-cols-2 gap-1">
                    <button
                      type="button"
                      onClick={() => adjustVital('temperature', -0.5)}
                      className="min-h-[40px] rounded-lg bg-white border border-slate-200 flex items-center justify-center cursor-pointer"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => adjustVital('temperature', 0.5)}
                      className="min-h-[40px] rounded-lg bg-white border border-slate-200 flex items-center justify-center cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Heart Rate (BPM) */}
                <div
                  className={`rounded-2xl border p-2.5 flex flex-col justify-between ${
                    evaluateVitalStatus('heartRate', vitals.heartRate) === 'emergency'
                      ? 'border-[#EF4444] bg-red-50/50'
                      : evaluateVitalStatus('heartRate', vitals.heartRate) === 'moderate'
                      ? 'border-[#F59E0B] bg-amber-50/50'
                      : 'border-slate-200 bg-slate-50/70'
                  }`}
                >
                  <div className="flex items-center justify-between text-[11px] font-bold text-slate-700">
                    <Activity className="w-3.5 h-3.5 text-[#0D9488]" />
                    <span>HR BPM</span>
                  </div>
                  <input
                    type="number"
                    aria-label="Heart Rate BPM"
                    value={vitals.heartRate}
                    onChange={(e) =>
                      setVitals((v) => ({...v, heartRate: Number(e.target.value) || 0}))
                    }
                    className="my-1.5 w-full text-center font-mono text-xl font-bold text-slate-900 bg-transparent tabular-nums"
                  />
                  <div className="grid grid-cols-2 gap-1">
                    <button
                      type="button"
                      onClick={() => adjustVital('heartRate', -4)}
                      className="min-h-[40px] rounded-lg bg-white border border-slate-200 flex items-center justify-center cursor-pointer"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => adjustVital('heartRate', 4)}
                      className="min-h-[40px] rounded-lg bg-white border border-slate-200 flex items-center justify-center cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Symptom Selection Matrix */}
              <div className="pt-2 border-t border-slate-100">
                <span className="block text-xs font-bold text-slate-700 mb-2">
                  Symptom Selection Matrix:
                </span>
                <div className="grid grid-cols-2 gap-2">
                  {ALL_SYMPTOMS.map((sym) => {
                    const active = symptoms.includes(sym);
                    const criticalSym = sym === 'Severe Chest Pain' || sym === 'Bleeding';
                    return (
                      <button
                        key={sym}
                        type="button"
                        onClick={() => toggleSymptom(sym)}
                        className={`min-h-[48px] px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer text-left flex items-center justify-between ${
                          active
                            ? criticalSym
                              ? 'bg-[#EF4444] border-[#EF4444] text-white shadow-xs'
                              : 'bg-[#0D9488] border-[#0D9488] text-white shadow-xs'
                            : 'bg-slate-50 border-slate-200 text-slate-800 hover:bg-slate-100'
                        }`}
                      >
                        <span>{sym}</span>
                        {active && <CheckCircle2 className="w-4 h-4 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* Edge-AI Micro-Diagnostics Accordion Section */}
            <EdgeAiDiagnosticsPanel
              title={copy.edgeAiTitle}
              conjunctivaResult={conjunctivaMetrics}
              coughResult={coughMetrics}
              onConjunctivaAnalyzed={setConjunctivaMetrics}
              onCoughAnalyzed={setCoughMetrics}
            />

            {/* Dynamic Triage Scorecard */}
            <section
              aria-live="polite"
              className={`rounded-3xl border-2 p-4 space-y-2 transition-colors ${
                triage.severity === 'emergency'
                  ? 'bg-red-50 border-[#EF4444] text-red-950'
                  : triage.severity === 'moderate'
                  ? 'bg-amber-50 border-[#F59E0B] text-amber-950'
                  : 'bg-emerald-50 border-[#10B981] text-emerald-950'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold">Live Triage Scorecard</span>
                <span
                  className={`px-3 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1.5 ${
                    triage.severity === 'emergency'
                      ? 'bg-[#EF4444] text-white'
                      : triage.severity === 'moderate'
                      ? 'bg-[#F59E0B] text-slate-950'
                      : 'bg-[#10B981] text-white'
                  }`}
                >
                  {triage.severity === 'emergency' ? (
                    <Siren className="w-3.5 h-3.5" />
                  ) : triage.severity === 'moderate' ? (
                    <AlertTriangle className="w-3.5 h-3.5" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {triage.severity === 'emergency'
                      ? 'RED · CRITICAL'
                      : triage.severity === 'moderate'
                      ? 'YELLOW · MODERATE'
                      : 'GREEN · ROUTINE'}
                  </span>
                </span>
              </div>

              <p className="text-xs font-bold leading-snug">{triage.triggers.join(' · ')}</p>
              <p className="text-xs opacity-90 leading-relaxed">{triage.protocolEn}</p>
            </section>

            {/* Offline & Baseband SMS Action Bar */}
            <section className="rounded-3xl bg-white border border-slate-200 p-4 space-y-3">
              <div className="flex items-center justify-between text-xs">
                {networkState === 'offline' ? (
                  <span className="inline-flex items-center gap-1.5 font-bold text-[#0D9488]">
                    <Bluetooth className="w-4 h-4 text-[#06B6D4]" />
                    <span>BLE Peer Relay Ready (Offline Mode)</span>
                  </span>
                ) : (
                  <span className="text-slate-600 font-semibold">
                    Live WebSocket &amp; localStorage Sync Active
                  </span>
                )}
                <span className="font-mono text-[10px] text-slate-400">CRC-16</span>
              </div>

              <button
                type="button"
                onClick={handleSaveOffline}
                className="w-full min-h-[50px] px-4 rounded-2xl bg-[#0D9488] hover:bg-teal-700 active:scale-[0.99] text-white text-sm font-bold inline-flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <Save className="w-4 h-4 shrink-0" />
                <span>{copy.saveOfflineBtn}</span>
              </button>

              <button
                type="button"
                onClick={() => setSmsModalOpen(true)}
                className="w-full min-h-[50px] px-4 rounded-2xl bg-[#EF4444] hover:bg-red-600 active:scale-[0.99] text-white text-sm font-bold inline-flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
              >
                <MessageSquareLock className="w-4 h-4 shrink-0" />
                <span>{copy.sendEncryptedSmsBtn}</span>
              </button>
            </section>
          </div>
        </div>
      </div>

      {/* Real Bit-Packed Base64 SMS Preview Modal */}
      <AnimatePresence>
        {smsModalOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/65 backdrop-blur-xs p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sms-modal-title"
          >
            <motion.div
              initial={{opacity: 0, scale: 0.95, y: 12}}
              animate={{opacity: 1, scale: 1, y: 0}}
              exit={{opacity: 0, scale: 0.95, y: 12}}
              transition={{type: 'spring', stiffness: 350, damping: 28}}
              className="w-full max-w-md rounded-3xl bg-white border border-slate-200 shadow-2xl overflow-hidden"
            >
              <div className="bg-[#EF4444] text-white px-5 py-4 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <MessageSquareLock className="w-5 h-5 shrink-0" />
                  <div>
                    <h3 id="sms-modal-title" className="text-base font-bold">
                      18-Byte Bit-Packed Base64 SMS
                    </h3>
                    <p className="text-xs text-red-100">
                      Encoded via `encodeVitalsToSMS()` + CRC-16 Checksum
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSmsModalOpen(false)}
                  className="min-h-[40px] min-w-[40px] rounded-xl bg-white/15 hover:bg-white/25 flex items-center justify-center cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>Target: <strong>District 24 SMS Gateway</strong></span>
                  <span className="font-mono font-bold text-[#0D9488] tabular-nums">
                    {liveBitPackedSms.length} chars (27-char Binary Frame)
                  </span>
                </div>

                <div className="rounded-2xl bg-slate-950 text-[#06B6D4] font-mono text-sm p-4 break-all border border-slate-800">
                  {liveBitPackedSms}
                </div>

                <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3.5 text-xs text-slate-700 space-y-1 font-mono tabular-nums">
                  <p className="font-sans font-bold text-slate-900">Bitwise Packed Telemetry:</p>
                  <p>
                    {nextPatientId} · VIL-204 · BP {vitals.systolic}/{vitals.diastolic} · SpO₂{' '}
                    {vitals.spo2}% · {vitals.temperature.toFixed(1)}°F · HR {vitals.heartRate}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setSmsModalOpen(false)}
                    className="min-h-[48px] px-4 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-700 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmSendSms}
                    className="min-h-[48px] px-4 rounded-xl bg-[#EF4444] hover:bg-red-600 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Send className="w-4 h-4" />
                    <span>Broadcast Emergency SMS</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Two-Way ASHA Saheli Voice Chatbot Modal */}
      <AshaSaheliModal
        isOpen={saheliModalOpen}
        audioMuted={audioMuted}
        onClose={() => setSaheliModalOpen(false)}
        onApplyFormPatch={handleSaheliModalPatch}
      />

      {/* Mera Incentive Breakdown Ledger Modal */}
      <IncentiveLedgerModal
        isOpen={incentiveModalOpen}
        onClose={() => setIncentiveModalOpen(false)}
        entries={incentives}
        ashaName="Sunita Devi"
        ashaId={ashaId}
      />
    </div>
  );
};
