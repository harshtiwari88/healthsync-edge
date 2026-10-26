import React, {useState, useRef, useEffect} from 'react';
import {motion, AnimatePresence} from 'motion/react';
import {
  Mic,
  MicOff,
  BatteryCharging,
  HardDrive,
  Database,
  Layers,
  Save,
  Radio,
  Volume2,
  Coins,
  Bot,
  RefreshCw,
  Minus,
  Plus,
  X,
  ArrowUpRight,
} from 'lucide-react';
import {
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
} from '../types/triage';
import {
  BrowserSpeechRecognition,
  DetectedEntityBadge,
  createBrowserSpeechRecognition,
  parseClinicalTranscript,
  speakClinicalGuidance,
} from '../utils/speechEngine';
import {SystemHardwareTelemetry} from '../utils/deviceTelemetry';
import {VitalsTelemetryMonitor} from './VitalsTelemetryMonitor';
import {EdgeAiDiagnosticsPanel} from './EdgeAiDiagnosticsPanel';
import {AshaSaheliModal, SaheliFormPatch} from './AshaSaheliModal';
import {IncentiveLedgerModal} from './IncentiveLedgerModal';

interface SubjectProfile {
  id: string;
  name: string;
  age: number;
  gender: 'M' | 'F' | 'O';
  abhaId: string;
}

const HOUSEHOLD_SUBJECTS: SubjectProfile[] = [
  {
    id: 'SUB-01',
    name: 'Ramesh Kumar',
    age: 48,
    gender: 'M',
    abhaId: '91-8834-2201-5590',
  },
  {
    id: 'SUB-02',
    name: 'Shanti Devi',
    age: 63,
    gender: 'F',
    abhaId: '91-7712-4908-3312',
  },
  {
    id: 'SUB-03',
    name: 'Kavita Verma',
    age: 27,
    gender: 'F',
    abhaId: '91-6409-1182-7741',
  },
  {
    id: 'SUB-04',
    name: 'Mahesh Nishad',
    age: 55,
    gender: 'M',
    abhaId: '91-5023-8841-1904',
  },
];

const VOICE_COMMAND_TRIGGERS = [
  'BP 168 by 104 Oxygen 87 Chest Pain',
  'BP 142 by 90 Bukhar 102 Cough',
  'BP 118 by 76 Oxygen 98',
] as const;

interface AshaWorkerPWAProps {
  ashaId: string;
  records: TriageRecord[];
  incentives: IncentiveEntry[];
  language: Language;
  networkState: NetworkState;
  audioMuted: boolean;
  hardwareTelemetry: SystemHardwareTelemetry;
  vitals: VitalsSnapshot;
  symptoms: SymptomKey[];
  conjunctivaMetrics?: ConjunctivaPixelMetrics;
  coughMetrics?: CoughAudioMetrics;
  onChangeVitals: (next: VitalsSnapshot) => void;
  onChangeSymptoms: (next: SymptomKey[]) => void;
  onChangeConjunctiva: (next: ConjunctivaPixelMetrics | undefined) => void;
  onChangeCough: (next: CoughAudioMetrics | undefined) => void;
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

export const AshaWorkerPWA: React.FC<AshaWorkerPWAProps> = ({
  ashaId,
  records,
  incentives,
  language,
  networkState,
  audioMuted,
  hardwareTelemetry,
  vitals,
  symptoms,
  conjunctivaMetrics,
  coughMetrics,
  onChangeVitals,
  onChangeSymptoms,
  onChangeConjunctiva,
  onChangeCough,
  onSaveRecord,
  onSyncOfflineQueue,
  onSwitchToCommand,
}) => {
  const [selectedSubjectIdx, setSelectedSubjectIdx] = useState<number>(0);
  const [subjectAge, setSubjectAge] = useState<number>(HOUSEHOLD_SUBJECTS[0].age);
  const [subjectGender, setSubjectGender] = useState<'M' | 'F' | 'O'>(
    HOUSEHOLD_SUBJECTS[0].gender
  );
  const [clinicalNotes, setClinicalNotes] = useState<string>(
    'Field telemetry capture · Sub-Center VIL-204.'
  );

  // Voice Command Assistant ("ASHA Saheli") State
  const [isListeningVoice, setIsListeningVoice] = useState<boolean>(false);
  const [liveTranscript, setLiveTranscript] = useState<string>('');
  const [detectedBadges, setDetectedBadges] = useState<DetectedEntityBadge[]>([]);
  const [speechNotice, setSpeechNotice] = useState<string | null>(null);

  // Overlays & Banners
  const [saheliModalOpen, setSaheliModalOpen] = useState<boolean>(false);
  const [incentiveModalOpen, setIncentiveModalOpen] = useState<boolean>(false);
  const [dispatchBanner, setDispatchBanner] = useState<{
    tone: 'cyan' | 'red';
    text: string;
  } | null>(null);

  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const prevSeverityRef = useRef<string>('routine');

  const activeSubject = HOUSEHOLD_SUBJECTS[selectedSubjectIdx];
  const pendingQueueCount = records.filter((r) => r.syncStatus === 'Queued Offline').length;
  const totalIncentiveInr = incentives.reduce((sum, item) => sum + item.amountInr, 0);

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

  const handleSelectSubject = (idx: number) => {
    setSelectedSubjectIdx(idx);
    setSubjectAge(HOUSEHOLD_SUBJECTS[idx].age);
    setSubjectGender(HOUSEHOLD_SUBJECTS[idx].gender);
  };

  const applyVoiceCommand = (utterance: string, speakConfirmation = false) => {
    setLiveTranscript(utterance);
    const parsed = parseClinicalTranscript(utterance);
    setDetectedBadges(parsed.badges);

    if (Object.keys(parsed.vitalsPatch).length > 0) {
      onChangeVitals({...vitals, ...parsed.vitalsPatch});
    }
    if (parsed.detectedSymptoms.length > 0) {
      const merged = Array.from(new Set([...symptoms, ...parsed.detectedSymptoms]));
      onChangeSymptoms(merged);
    }
    setClinicalNotes(`Voice Stream [${language.toUpperCase()}]: "${utterance}"`);

    if (speakConfirmation && parsed.badges.length > 0) {
      speakClinicalGuidance(
        `टेलीमेट्री अपडेट: ${parsed.badges.map((b) => b.label).join(', ')}`,
        'hi-IN',
        audioMuted
      );
    }
  };

  const handleToggleSpeechSphere = () => {
    setSpeechNotice(null);
    if (isListeningVoice) {
      recognitionRef.current?.stop();
      setIsListeningVoice(false);
      return;
    }

    const recognition = createBrowserSpeechRecognition(
      language === 'en' ? 'en-IN' : 'hi-IN'
    );
    if (!recognition) {
      setSpeechNotice(
        'Browser SpeechRecognition unavailable — trigger any Voice Command Preset on the right.'
      );
      return;
    }

    let finalSpoken = '';
    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const piece = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalSpoken += piece + ' ';
        } else {
          interim += piece;
        }
      }
      const combined = (finalSpoken + interim).trim();
      if (combined) {
        applyVoiceCommand(combined, false);
      }
    };

    recognition.onerror = (ev) => {
      setIsListeningVoice(false);
      setSpeechNotice(`Speech sensor status: ${ev.error}.`);
    };

    recognition.onend = () => {
      setIsListeningVoice(false);
      if (finalSpoken.trim()) {
        applyVoiceCommand(finalSpoken.trim(), true);
      }
    };

    try {
      recognitionRef.current = recognition;
      setIsListeningVoice(true);
      recognition.start();
    } catch {
      setIsListeningVoice(false);
    }
  };

  const handleSaheliPatch = (patch: SaheliFormPatch) => {
    if (patch.vitals) {
      onChangeVitals({...vitals, ...patch.vitals});
    }
    if (patch.symptoms) {
      onChangeSymptoms(Array.from(new Set([...symptoms, ...patch.symptoms])));
    }
    if (patch.clinicalNotes) {
      setClinicalNotes(patch.clinicalNotes);
    }
    if (patch.rawTranscript) {
      setLiveTranscript(patch.rawTranscript);
      setDetectedBadges(parseClinicalTranscript(patch.rawTranscript).badges);
    }
  };

  const handleToggleSymptom = (sym: SymptomKey) => {
    if (symptoms.includes(sym)) {
      onChangeSymptoms(symptoms.filter((s) => s !== sym));
    } else {
      onChangeSymptoms([...symptoms, sym]);
    }
  };

  const handleCommitRecord = (channel: 'Data' | 'Emergency SMS') => {
    const saved = onSaveRecord({
      patientName: activeSubject.name,
      age: subjectAge,
      gender: subjectGender,
      abhaId: activeSubject.abhaId,
      villageCode: 'VIL-204',
      vitals,
      symptoms,
      edgeAi: edgeAiState,
      clinicalNotes,
      channel,
    });

    setDispatchBanner({
      tone: channel === 'Emergency SMS' || saved.severity === 'emergency' ? 'red' : 'cyan',
      text:
        channel === 'Emergency SMS'
          ? `160-Char CRC32 Baseband SMS (${saved.patientId}) transmitted to District 24 War-Room.`
          : networkState === 'offline'
          ? `Committed ${saved.patientId} to IndexedDB & CRDT Offline Log (${pendingQueueCount + 1} queued).`
          : `Synced ${saved.patientId} to District 24 War-Room via WebSocket & IndexedDB.`,
    });
  };

  return (
    <div className="os-grid-surface pb-16 pt-4 px-2 sm:px-5 flex justify-center">
      {/* RUGGEDIZED FIELD TABLET CHASSIS */}
      <div className="w-full max-w-5xl rounded-2xl border-2 border-slate-700/90 bg-[#0B101D]/95 shadow-2xl overflow-hidden">
        {/* TOP RUGGEDIZED HARDWARE SYSTEM STATUS BAR */}
        <div className="px-4 py-2.5 bg-[#060911] border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 font-mono text-[11px] tabular-nums">
          <div className="flex flex-wrap items-center gap-3 text-slate-300">
            <span className="inline-flex items-center gap-1.5 text-[#06B6D4] font-semibold">
              <BatteryCharging className="w-3.5 h-3.5" />
              BAT {hardwareTelemetry.batteryPct}%
              {hardwareTelemetry.batteryCharging ? '⚡' : ''}
            </span>
            <span className="text-slate-700">·</span>
            <span className="inline-flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5 text-[#F59E0B]" />
              MEM {hardwareTelemetry.storageUsedKb} KB
            </span>
            <span className="text-slate-700">·</span>
            <span className="inline-flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 text-emerald-400" />
              IDB: {hardwareTelemetry.idbStatus} ({hardwareTelemetry.idbDocCount})
            </span>
            <span className="text-slate-700 hidden sm:inline">·</span>
            <span className="hidden sm:inline-flex items-center gap-1.5 text-slate-400">
              <Layers className="w-3.5 h-3.5 text-[#06B6D4]" />
              {hardwareTelemetry.swCacheStatus}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-slate-400">
              OP: <strong className="text-slate-200">{ashaId}</strong> · VIL-204
            </span>

            {pendingQueueCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (networkState !== 'offline') {
                    const flushed = onSyncOfflineQueue();
                    setDispatchBanner({
                      tone: 'cyan',
                      text: `Flushed ${flushed} queued CRDT packet(s) to District HQ.`,
                    });
                  }
                }}
                className="px-2 py-0.5 rounded bg-[#F59E0B]/15 border border-[#F59E0B]/50 text-[#F59E0B] font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
              >
                <RefreshCw className="w-3 h-3" />
                <span>QUEUE:{pendingQueueCount}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setIncentiveModalOpen(true)}
              className="px-2.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
            >
              <Coins className="w-3 h-3" />
              <span>NHM ₹{totalIncentiveInr}</span>
            </button>
          </div>
        </div>

        {/* TABLET WORKSPACE BODY */}
        <div className="p-4 sm:p-5 space-y-4">
          {/* Action Telemetry Confirmation Banner */}
          <AnimatePresence>
            {dispatchBanner && (
              <motion.div
                initial={{opacity: 0, y: -6}}
                animate={{opacity: 1, y: 0}}
                exit={{opacity: 0, y: -6}}
                className={`rounded-lg border px-4 py-3 flex items-center justify-between gap-3 text-xs ${
                  dispatchBanner.tone === 'red'
                    ? 'bg-[#EF4444]/15 border-[#EF4444] text-red-100'
                    : 'bg-[#06B6D4]/15 border-[#06B6D4] text-cyan-100'
                }`}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-mono font-semibold">{dispatchBanner.text}</span>
                  <button
                    type="button"
                    onClick={onSwitchToCommand}
                    className="inline-flex items-center gap-1 font-mono font-bold underline text-[#F59E0B] cursor-pointer whitespace-nowrap"
                  >
                    <span>Inspect in War-Room</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setDispatchBanner(null)}
                  aria-label="Dismiss notice"
                  className="text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* TOP SPLIT: HOUSEHOLD SUBJECT SELECTOR + LIVE VOICE COMMAND SPHERE ("ASHA SAHELI") */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
            {/* Household Registry Tactile Selector (Zero Text Inputs) */}
            <section className="lg:col-span-5 rounded-xl bg-[#0D1322] border border-slate-800 p-4 flex flex-col justify-between space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200">
                  Subject Roster · PHC Rampur
                </span>
                <span className="font-mono text-xs text-[#06B6D4] tabular-nums">
                  NEXT ID: {nextPatientId}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {HOUSEHOLD_SUBJECTS.map((subj, idx) => {
                  const selected = idx === selectedSubjectIdx;
                  return (
                    <button
                      key={subj.id}
                      type="button"
                      onClick={() => handleSelectSubject(idx)}
                      className={`min-h-[52px] px-3 py-2 rounded-lg border text-left transition-colors cursor-pointer ${
                        selected
                          ? 'bg-[#06B6D4]/15 border-[#06B6D4] text-white'
                          : 'bg-[#090D16] border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                      }`}
                    >
                      <div className="text-xs font-semibold truncate">{subj.name}</div>
                      <div className="font-mono text-[10px] text-slate-400 tabular-nums mt-0.5">
                        {subj.age}Y/{subj.gender} · {subj.abhaId.slice(0, 7)}…
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Glove-Friendly Age & Sex Tactile Steppers */}
              <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSubjectAge((a) => Math.max(1, a - 1))}
                    aria-label="Decrease Subject Age"
                    className="min-h-[44px] min-w-[44px] rounded-lg bg-[#090D16] border border-slate-700 text-slate-200 flex items-center justify-center cursor-pointer"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <div className="px-2.5 text-center font-mono tabular-nums">
                    <span className="block text-[9px] text-slate-500">AGE</span>
                    <span className="text-sm font-bold text-slate-100">{subjectAge}Y</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSubjectAge((a) => Math.min(105, a + 1))}
                    aria-label="Increase Subject Age"
                    className="min-h-[44px] min-w-[44px] rounded-lg bg-[#090D16] border border-slate-700 text-slate-200 flex items-center justify-center cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex items-center gap-1 bg-[#090D16] p-1 rounded-lg border border-slate-800">
                  {(['M', 'F', 'O'] as const).map((sex) => (
                    <button
                      key={sex}
                      type="button"
                      onClick={() => setSubjectGender(sex)}
                      className={`min-h-[36px] min-w-[36px] rounded font-mono text-xs font-bold cursor-pointer ${
                        subjectGender === sex
                          ? 'bg-[#F59E0B] text-[#090D16]'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {sex}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            {/* Live Voice Command Assistant ("ASHA Saheli") with Visualizer Sphere */}
            <section className="lg:col-span-7 rounded-xl bg-[#0D1322] border border-slate-800 p-4 flex flex-col justify-between space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-semibold text-slate-200">
                    ASHA Saheli · Live Voice Command Telemetry
                  </span>
                  <span className="text-xs text-slate-500 ml-2 font-mono">
                    [{language.toUpperCase()} ASR + TTS]
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => speakClinicalGuidance(triage.protocolHi, 'hi-IN', false)}
                    className="min-h-[38px] px-2.5 rounded-lg bg-[#090D16] border border-slate-700 text-[11px] font-mono text-[#06B6D4] inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                    <span>Speak Advice</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSaheliModalOpen(true)}
                    className="min-h-[38px] px-2.5 rounded-lg bg-[#090D16] border border-slate-700 text-[11px] font-mono text-[#F59E0B] inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <Bot className="w-3.5 h-3.5" />
                    <span>2-Way Console</span>
                  </button>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-4">
                {/* Pulsing Visualizer Sphere / Wave Ring */}
                <button
                  type="button"
                  onClick={handleToggleSpeechSphere}
                  aria-pressed={isListeningVoice}
                  aria-label="Toggle ASHA Saheli Live Voice Capture"
                  className="relative w-24 h-24 rounded-full flex items-center justify-center shrink-0 cursor-pointer group"
                >
                  <motion.span
                    animate={
                      isListeningVoice
                        ? {scale: [1, 1.32, 1], opacity: [0.7, 0.15, 0.7]}
                        : {scale: [1, 1.08, 1], opacity: [0.35, 0.15, 0.35]}
                    }
                    transition={{
                      duration: isListeningVoice ? 0.9 : 2.4,
                      repeat: Infinity,
                      ease: 'easeInOut',
                    }}
                    className={`absolute inset-0 rounded-full border-2 ${
                      isListeningVoice ? 'border-[#EF4444]' : 'border-[#06B6D4]'
                    }`}
                  />
                  <motion.span
                    animate={
                      isListeningVoice
                        ? {scale: [1, 1.18, 1], opacity: [0.9, 0.3, 0.9]}
                        : {scale: 1, opacity: 0.5}
                    }
                    transition={{duration: 0.7, repeat: Infinity}}
                    className={`absolute inset-2.5 rounded-full border ${
                      isListeningVoice ? 'border-[#F59E0B]' : 'border-[#06B6D4]/60'
                    }`}
                  />
                  <span
                    className={`relative z-10 w-14 h-14 rounded-full flex flex-col items-center justify-center border ${
                      isListeningVoice
                        ? 'bg-[#EF4444] border-red-300 text-white'
                        : 'bg-[#090D16] border-[#06B6D4] text-[#06B6D4] group-hover:bg-[#06B6D4]/15'
                    }`}
                  >
                    {isListeningVoice ? (
                      <MicOff className="w-5 h-5" />
                    ) : (
                      <Mic className="w-5 h-5" />
                    )}
                    <span className="font-mono text-[9px] font-bold mt-0.5">
                      {isListeningVoice ? 'LIVE' : 'SPEAK'}
                    </span>
                  </span>
                </button>

                {/* Real-Time Text Stream + Neon Keyword Extraction Boxes */}
                <div className="flex-1 w-full rounded-lg bg-[#070B13] border border-slate-800 p-3 space-y-2 min-h-[96px]">
                  <div className="font-mono text-xs text-slate-200 leading-relaxed">
                    {liveTranscript ? (
                      <span>&gt; &ldquo;{liveTranscript}&rdquo;</span>
                    ) : (
                      <span className="text-slate-500">
                        &gt; Tap visualizer sphere &amp; speak e.g. &ldquo;BP 160 by 100 Oxygen 88
                        Bukhar 102&rdquo;
                      </span>
                    )}
                  </div>

                  {detectedBadges.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {detectedBadges.map((b) => (
                        <span
                          key={b.key}
                          className={`px-2 py-0.5 rounded-xs font-mono text-[11px] font-semibold border ${
                            b.tone === 'red'
                              ? 'bg-[#EF4444]/15 border-[#EF4444] text-[#EF4444]'
                              : b.tone === 'amber'
                              ? 'bg-[#F59E0B]/15 border-[#F59E0B] text-[#F59E0B]'
                              : 'bg-[#06B6D4]/15 border-[#06B6D4] text-[#06B6D4]'
                          }`}
                        >
                          {b.label}
                        </span>
                      ))}
                    </div>
                  )}

                  {speechNotice && (
                    <p className="font-mono text-[10px] text-[#F59E0B]">{speechNotice}</p>
                  )}
                </div>
              </div>

              {/* Tactical Voice Stream Presets */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="font-mono text-[10px] text-slate-500 mr-1">
                  VOICE STREAM SIM:
                </span>
                {VOICE_COMMAND_TRIGGERS.map((phrase) => (
                  <button
                    key={phrase}
                    type="button"
                    onClick={() => applyVoiceCommand(phrase, true)}
                    className="min-h-[34px] px-2.5 py-1 rounded bg-[#090D16] hover:bg-slate-900 border border-slate-800 hover:border-[#06B6D4]/60 font-mono text-[11px] text-slate-300 cursor-pointer transition-colors"
                  >
                    {phrase}
                  </button>
                ))}
              </div>
            </section>
          </div>

          {/* 01. TELEMETRY VITALS CONTROLLER (CANVAS PPG/ECG + ROTARY DIALS + BITMASK) */}
          <VitalsTelemetryMonitor
            vitals={vitals}
            symptoms={symptoms}
            onChangeVitals={onChangeVitals}
            onToggleSymptom={handleToggleSymptom}
          />

          {/* 02 & 03. EDGE-AI HUD EYE CONJUNCTIVA SCANNER + AUDIO SPECTROGRAM */}
          <EdgeAiDiagnosticsPanel
            title="Edge-AI Optical & Acoustic Diagnostics"
            conjunctivaResult={conjunctivaMetrics}
            coughResult={coughMetrics}
            onConjunctivaAnalyzed={onChangeConjunctiva}
            onCoughAnalyzed={onChangeCough}
          />

          {/* LIVE TRIAGE SEVERITY ENGINE & DUAL HARDWARE DISPATCH BAR */}
          <section
            aria-live="polite"
            className={`rounded-xl border p-4 space-y-4 ${
              triage.severity === 'emergency'
                ? 'bg-[#EF4444]/10 border-[#EF4444] hazard-alert-frame'
                : triage.severity === 'moderate'
                ? 'bg-[#F59E0B]/10 border-[#F59E0B]'
                : 'bg-[#0D1322] border-slate-800'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <span
                  className={`font-mono text-sm font-bold tabular-nums ${
                    triage.severity === 'emergency'
                      ? 'text-[#EF4444]'
                      : triage.severity === 'moderate'
                      ? 'text-[#F59E0B]'
                      : 'text-[#06B6D4]'
                  }`}
                >
                  {triage.severity === 'emergency'
                    ? '✖ TR3 · CRITICAL EMERGENCY'
                    : triage.severity === 'moderate'
                    ? '▲ TR2 · MODERATE RISK'
                    : '● TR1 · ROUTINE BASELINE'}
                </span>
                <span className="text-slate-600">·</span>
                <span className="font-mono text-xs text-slate-300">
                  {triage.triggers.join(' · ')}
                </span>
              </div>
              <span className="font-mono text-[11px] text-slate-400">
                160-CHAR GSM-7 PACKET READY
              </span>
            </div>

            <p className="text-sm text-slate-200 leading-relaxed">{triage.protocolEn}</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <button
                type="button"
                onClick={() => handleCommitRecord('Data')}
                className="min-h-[52px] px-4 rounded-lg bg-[#06B6D4] hover:bg-cyan-400 text-[#090D16] font-mono text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors whitespace-nowrap"
              >
                <Save className="w-4 h-4 shrink-0" />
                <span>Commit Record to IndexedDB</span>
              </button>

              <button
                type="button"
                onClick={() => handleCommitRecord('Emergency SMS')}
                className="min-h-[52px] px-4 rounded-lg bg-[#EF4444] hover:bg-red-500 text-white font-mono text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors whitespace-nowrap"
              >
                <Radio className="w-4 h-4 shrink-0" />
                <span>Transmit 160B Emergency SMS</span>
              </button>
            </div>
          </section>
        </div>
      </div>

      {/* Two-Way Voice Console Modal */}
      <AshaSaheliModal
        isOpen={saheliModalOpen}
        audioMuted={audioMuted}
        onClose={() => setSaheliModalOpen(false)}
        onApplyFormPatch={handleSaheliPatch}
      />

      {/* NHM Performance Ledger Modal */}
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
