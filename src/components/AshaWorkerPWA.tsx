import React, {useState, useRef} from 'react';
import {motion, AnimatePresence} from 'motion/react';
import {
  Mic,
  Heart,
  Thermometer,
  CheckCircle2,
  AlertTriangle,
  Siren,
  Save,
  MessageSquareLock,
  IndianRupee,
  RefreshCw,
  Minus,
  Plus,
  Camera,
  Upload,
  AudioWaveform,
  Bluetooth,
  LayoutDashboard,
  LogOut,
  Globe,
  X,
  Send,
  ShieldCheck,
  Eye,
} from 'lucide-react';
import {
  ALL_SYMPTOMS,
  EdgeAiDiagnostics,
  IncentiveEntry,
  Language,
  NetworkState,
  SymptomKey,
  TriageRecord,
  VitalsSnapshot,
  buildEncryptedEmergencySms,
  evaluateTriage,
  evaluateVitalStatus,
} from '../types/triage';
import {LANGUAGE_LABELS, UI_COPY} from '../data/initialData';
import {LungsIcon} from './Icons';
import {AshaSaheliModal, SaheliFormPatch} from './AshaSaheliModal';
import {IncentiveLedgerModal} from './IncentiveLedgerModal';
import {PWAInstallButton} from './PWAInstallButton';

interface AshaWorkerPWAProps {
  ashaId: string;
  records: TriageRecord[];
  incentives: IncentiveEntry[];
  language: Language;
  onLanguageChange: (lang: Language) => void;
  networkState: NetworkState;
  onCycleNetworkState: () => void;
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
  onLogout: () => void;
}

export const AshaWorkerPWA: React.FC<AshaWorkerPWAProps> = ({
  ashaId,
  records,
  incentives,
  language,
  onLanguageChange,
  networkState,
  onCycleNetworkState,
  onSaveRecord,
  onSyncOfflineQueue,
  onSwitchToCommand,
  onLogout,
}) => {
  const copy = UI_COPY[language];

  // Form states
  const [patientName, setPatientName] = useState<string>('Ramesh Kumar');
  const [age, setAge] = useState<number>(48);
  const [gender, setGender] = useState<'F' | 'M' | 'O'>('M');
  const [abhaId, setAbhaId] = useState<string>('91-8834-2201-5590');
  const [vitals, setVitals] = useState<VitalsSnapshot>({
    systolic: 124,
    diastolic: 80,
    spo2: 98,
    temperature: 98.6,
  });
  const [symptoms, setSymptoms] = useState<SymptomKey[]>([]);
  const [clinicalNotes, setClinicalNotes] = useState<string>(
    'Door-to-door village wellness & NCD screening.'
  );

  // Edge-AI Micro-Diagnostics state
  const [activeDiagTab, setActiveDiagTab] = useState<'anemia' | 'cough'>('anemia');
  const [anemiaScanning, setAnemiaScanning] = useState<boolean>(false);
  const [uploadedEyePreview, setUploadedEyePreview] = useState<string | null>(null);
  const [anemiaFlagged, setAnemiaFlagged] = useState<boolean>(false);
  const [estimatedHb, setEstimatedHb] = useState<number | undefined>(undefined);

  const [coughRecording, setCoughRecording] = useState<boolean>(false);
  const [coughSecondsLeft, setCoughSecondsLeft] = useState<number>(5);
  const [respiratoryFlagged, setRespiratoryFlagged] = useState<boolean>(false);
  const [coughPeakHz, setCoughPeakHz] = useState<number | undefined>(undefined);

  // Modals & notifications
  const [saheliOpen, setSaheliOpen] = useState<boolean>(false);
  const [incentiveOpen, setIncentiveOpen] = useState<boolean>(false);
  const [smsPreviewOpen, setSmsPreviewOpen] = useState<boolean>(false);
  const [toastBanner, setToastBanner] = useState<{
    tone: 'teal' | 'red';
    text: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const pendingSyncCount = records.filter((r) => r.syncStatus === 'Queued Offline').length;
  const totalIncentiveToday = incentives.reduce((acc, item) => acc + item.amountInr, 0);

  const edgeAiState: EdgeAiDiagnostics = {
    anemiaSuspected: anemiaFlagged,
    estimatedHb,
    respiratoryRiskHigh: respiratoryFlagged,
    coughPeakHz,
  };

  const triage = evaluateTriage(vitals, symptoms, edgeAiState);
  const nextPatientId = `PT${8924 + records.length + 1}`;
  const liveSmsPayload = buildEncryptedEmergencySms({
    patientId: nextPatientId,
    villageCode: 'VIL-204',
    vitals,
    symptoms,
    edgeAi: edgeAiState,
    severity: triage.severity === 'routine' ? 'emergency' : triage.severity,
  });

  const handleApplySaheliPatch = (patch: SaheliFormPatch) => {
    if (patch.vitals) {
      setVitals((prev) => ({...prev, ...patch.vitals}));
    }
    if (patch.symptoms) {
      setSymptoms((prev) => Array.from(new Set([...prev, ...patch.symptoms!])));
    }
    if (patch.patientName) {
      setPatientName(patch.patientName);
    }
    if (patch.clinicalNotes) {
      setClinicalNotes(patch.clinicalNotes);
    }
  };

  const toggleSymptom = (sym: SymptomKey) => {
    setSymptoms((prev) =>
      prev.includes(sym) ? prev.filter((s) => s !== sym) : [...prev, sym]
    );
  };

  const adjustVital = (field: keyof VitalsSnapshot, delta: number) => {
    setVitals((prev) => {
      const next = Number((prev[field] + delta).toFixed(1));
      if (field === 'systolic') return {...prev, systolic: Math.min(240, Math.max(60, next))};
      if (field === 'diastolic') return {...prev, diastolic: Math.min(150, Math.max(40, next))};
      if (field === 'spo2') return {...prev, spo2: Math.min(100, Math.max(60, next))};
      return {...prev, temperature: Math.min(107, Math.max(94, next))};
    });
  };

  // Eye Conjunctiva Anemia Scanner Simulator
  const runConjunctivaAnalysis = (previewUrl?: string) => {
    if (previewUrl) setUploadedEyePreview(previewUrl);
    setAnemiaScanning(true);
    setTimeout(() => {
      setAnemiaScanning(false);
      setAnemiaFlagged(true);
      setEstimatedHb(7.2);
      setClinicalNotes((prev) =>
        prev.includes('Conjunctiva')
          ? prev
          : `${prev} | Edge-AI Conjunctiva Scan: Suspected Severe Anemia (Hb 7.2 g/dL < 8 g/dL).`
      );
    }, 1100);
  };

  const handleEyePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    runConjunctivaAnalysis(objectUrl);
  };

  // 5-Second Cough Audio Diagnostic Simulator
  const startCoughRecorder = () => {
    if (coughRecording) return;
    setCoughRecording(true);
    setCoughSecondsLeft(5);

    let remaining = 5;
    const interval = setInterval(() => {
      remaining -= 1;
      setCoughSecondsLeft(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
        setCoughRecording(false);
        setRespiratoryFlagged(true);
        setCoughPeakHz(915);
        if (!symptoms.includes('Cough')) {
          setSymptoms((prev) => [...prev, 'Cough']);
        }
        setClinicalNotes((prev) =>
          prev.includes('Acoustic')
            ? prev
            : `${prev} | Edge-AI 5s Cough Acoustic Scan: High Respiratory Risk (915 Hz wet crackles).`
        );
      }
    }, 1000);
  };

  const handleSaveOfflineRecord = () => {
    const created = onSaveRecord({
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
      tone: 'teal',
      text:
        networkState === 'offline'
          ? `Saved ${created.patientId} to Offline Encrypted Store (+₹${
              created.severity === 'routine' ? 20 : 50
            } Mera Incentive).`
          : `Synced ${created.patientId} over ${networkState.toUpperCase()} to District 24 HQ (+₹${
              created.severity === 'routine' ? 20 : 50
            } Incentive).`,
    });
  };

  const handleTransmitEmergencySms = () => {
    const created = onSaveRecord({
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
    setSmsPreviewOpen(false);
    setToastBanner({
      tone: 'red',
      text: `Encrypted Baseband SMS (${created.patientId}) transmitted to District 24 Command Feed!`,
    });
  };

  const networkButtonConfig =
    networkState === '4g'
      ? {
          label: '🟢 4G Connected',
          classes: 'bg-emerald-50 border-emerald-300 text-emerald-900',
        }
      : networkState === '2g'
      ? {
          label: '🟡 Low 2G',
          classes: 'bg-amber-50 border-amber-300 text-amber-950',
        }
      : {
          label: '🔴 Offline (No Network)',
          classes: 'bg-red-50 border-red-300 text-red-900',
        };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      {/* Top Workspace Utility Bar above Mobile Frame */}
      <div className="bg-slate-900 text-white border-b border-slate-800">
        <div className="max-w-6xl mx-auto px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="text-sm font-bold tracking-tight text-white">HealthSync Edge</span>
            <span className="text-slate-500">·</span>
            <span className="font-mono text-xs text-teal-300">{ashaId}</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex items-center">
              <Globe className="w-3.5 h-3.5 text-teal-300 absolute left-2.5 pointer-events-none" />
              <select
                aria-label="Change Language"
                value={language}
                onChange={(e) => onLanguageChange(e.target.value as Language)}
                className="min-h-[38px] pl-8 pr-6 rounded-lg bg-slate-800 border border-slate-700 text-xs font-semibold text-white cursor-pointer"
              >
                {(Object.keys(LANGUAGE_LABELS) as Language[]).map((k) => (
                  <option key={k} value={k}>
                    {LANGUAGE_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={onSwitchToCommand}
              className="min-h-[38px] px-3 rounded-lg bg-[#0F766E] hover:bg-teal-700 text-xs font-bold text-white inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <LayoutDashboard className="w-3.5 h-3.5" />
              <span>District Command</span>
            </button>

            <PWAInstallButton compact />

            <button
              type="button"
              onClick={onLogout}
              title="Back to Role Login"
              className="min-h-[38px] px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 hover:text-white inline-flex items-center gap-1 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
      </div>

      {/* Centered Realistic Mobile Device Mockup Frame */}
      <div className="flex-1 py-5 sm:py-8 px-2 sm:px-4 flex justify-center items-start">
        <div className="w-full max-w-md rounded-3xl border-4 border-slate-800 bg-white shadow-2xl overflow-hidden flex flex-col">
          {/* Device Top Speaker Notch Bar */}
          <div className="bg-slate-900 px-5 py-2 flex items-center justify-between text-[11px] font-mono text-slate-300">
            <span>HealthSync OS · ABDM</span>
            <div className="w-16 h-1.5 rounded-full bg-slate-700" />
            <span className="tabular-nums">VIL-204</span>
          </div>

          {/* 1. Header Bar */}
          <header className="px-4 pt-4 pb-3.5 bg-white border-b border-slate-200 space-y-3">
            <div className="flex items-center justify-between gap-2">
              {/* Profile Avatar & Name */}
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-11 h-11 rounded-2xl bg-[#0F766E] text-white font-bold text-sm flex items-center justify-center shrink-0 shadow-xs">
                  SD
                </div>
                <div className="min-w-0">
                  <h1 className="text-sm font-bold text-slate-900 truncate">
                    Sunita Devi (ASHA)
                  </h1>
                  <p className="text-xs font-mono text-slate-600">
                    Village Code: <strong className="text-[#0F766E]">VIL-204</strong>
                  </p>
                </div>
              </div>

              {/* Network Toggle Switch */}
              <button
                type="button"
                onClick={onCycleNetworkState}
                title="Tap to cycle 4G / Low 2G / Offline"
                className={`min-h-[48px] px-3 rounded-xl border text-xs font-bold transition-colors cursor-pointer shrink-0 whitespace-nowrap ${networkButtonConfig.classes}`}
              >
                {networkButtonConfig.label}
              </button>
            </div>

            {/* Interactive Ledger & Pending Offline Sync Triggers */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setIncentiveOpen(true)}
                className="min-h-[48px] px-3 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-left flex items-center gap-2 transition-colors cursor-pointer"
              >
                <IndianRupee className="w-4 h-4 text-[#0F766E] shrink-0" />
                <span className="text-[11px] font-bold text-emerald-950 leading-tight tabular-nums">
                  Mera Incentive: ₹{totalIncentiveToday} Earned Today
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (pendingSyncCount > 0 && networkState !== 'offline') {
                    const count = onSyncOfflineQueue();
                    setToastBanner({
                      tone: 'teal',
                      text: `Synchronized ${count} pending offline records to District 24 HQ.`,
                    });
                  } else if (pendingSyncCount > 0) {
                    setToastBanner({
                      tone: 'teal',
                      text: `${pendingSyncCount} records encrypted locally. Switch network to 4G/2G to upload.`,
                    });
                  }
                }}
                className="min-h-[48px] px-3 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-200 text-left flex items-center gap-2 transition-colors cursor-pointer"
              >
                <RefreshCw className="w-4 h-4 text-[#F59E0B] shrink-0" />
                <span className="text-[11px] font-bold text-amber-950 leading-tight tabular-nums">
                  {pendingSyncCount} Pending Offline Syncs
                </span>
              </button>
            </div>
          </header>

          {/* Main Mobile Body */}
          <div className="p-4 space-y-5 bg-slate-50">
            {/* Live Action Toast inside Mobile Viewport */}
            <AnimatePresence>
              {toastBanner && (
                <motion.div
                  initial={{opacity: 0, y: -6}}
                  animate={{opacity: 1, y: 0}}
                  exit={{opacity: 0, y: -6}}
                  className={`rounded-2xl border p-3.5 flex items-start justify-between gap-2 text-xs font-semibold ${
                    toastBanner.tone === 'red'
                      ? 'bg-red-50 border-[#EF4444] text-red-950'
                      : 'bg-teal-50 border-[#0F766E] text-teal-950'
                  }`}
                >
                  <div className="space-y-1.5">
                    <p>{toastBanner.text}</p>
                    <button
                      type="button"
                      onClick={onSwitchToCommand}
                      className="underline font-bold text-[#0F766E] cursor-pointer"
                    >
                      Inspect in District 24 Command Center →
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setToastBanner(null)}
                    aria-label="Dismiss notification"
                    className="p-1 text-slate-500 hover:text-slate-900 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* 2. "ASHA Saheli" Interactive Voice Assistant Banner */}
            <section className="rounded-3xl bg-[#0F766E] text-white p-5 text-center relative overflow-hidden">
              <div className="relative inline-flex items-center justify-center my-1">
                <span
                  aria-hidden="true"
                  className="absolute inset-0 rounded-full bg-[#10B981]/40 animate-mic-ripple"
                />
                <span
                  aria-hidden="true"
                  className="absolute inset-0 rounded-full bg-white/25 animate-mic-ripple-delayed"
                />
                <button
                  type="button"
                  onClick={() => setSaheliOpen(true)}
                  aria-label="Open ASHA Saheli Voice Assistant"
                  className="relative z-10 w-20 h-20 rounded-full bg-white text-[#0F766E] flex items-center justify-center shadow-lg active:scale-95 transition-transform cursor-pointer"
                >
                  <Mic className="w-9 h-9" />
                </button>
              </div>

              {/* Animated Acoustic Wave Bars */}
              <div
                aria-hidden="true"
                className="mt-3 flex items-center justify-center gap-1 h-4"
              >
                {[0.5, 0.9, 0.6, 1, 0.7, 0.95, 0.55].map((scale, idx) => (
                  <motion.span
                    key={idx}
                    animate={{scaleY: [0.4, scale, 0.45]}}
                    transition={{
                      duration: 1.1,
                      repeat: Infinity,
                      delay: idx * 0.1,
                      ease: 'easeInOut',
                    }}
                    className="w-1 h-4 rounded-full bg-emerald-300 inline-block origin-center"
                  />
                ))}
              </div>

              <h2 className="mt-2 text-base font-bold text-white">
                ASHA Saheli — Bilingual Voice Triage
              </h2>
              <p className="text-xs text-teal-100 mt-0.5">
                “Namaste Didi, patient ke vitals bataiye”
              </p>

              <button
                type="button"
                onClick={() => setSaheliOpen(true)}
                className="mt-3.5 w-full min-h-[48px] px-4 rounded-xl bg-white hover:bg-teal-50 text-[#0F766E] text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 shadow-xs transition-colors cursor-pointer"
              >
                <Mic className="w-4 h-4 shrink-0" />
                <span>{copy.saheliBtn}</span>
              </button>
            </section>

            {/* 3. Quick Patient Triage Form */}
            <section className="rounded-3xl bg-white border border-slate-200 p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-900">{copy.triageFormTitle}</h2>
                <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                  Ref · {nextPatientId}
                </span>
              </div>

              {/* Demographics + ABHA ID */}
              <div className="space-y-3">
                <div>
                  <label
                    htmlFor="pt-name"
                    className="block text-xs font-bold text-slate-700 mb-1"
                  >
                    Patient Name
                  </label>
                  <input
                    id="pt-name"
                    type="text"
                    value={patientName}
                    onChange={(e) => setPatientName(e.target.value)}
                    className="w-full min-h-[48px] px-3.5 rounded-xl border border-slate-300 text-sm font-semibold text-slate-900"
                  />
                </div>

                <div className="grid grid-cols-12 gap-2.5">
                  <div className="col-span-4">
                    <label
                      htmlFor="pt-age"
                      className="block text-xs font-bold text-slate-700 mb-1"
                    >
                      Age
                    </label>
                    <input
                      id="pt-age"
                      type="number"
                      min={1}
                      max={110}
                      value={age}
                      onChange={(e) => setAge(Math.max(1, Number(e.target.value) || 1))}
                      className="w-full min-h-[48px] px-3 rounded-xl border border-slate-300 font-mono text-sm font-bold text-slate-900 tabular-nums text-center"
                    />
                  </div>

                  <div className="col-span-8">
                    <span className="block text-xs font-bold text-slate-700 mb-1">Gender</span>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(
                        [
                          {val: 'F', label: 'Female'},
                          {val: 'M', label: 'Male'},
                          {val: 'O', label: 'Other'},
                        ] as const
                      ).map((g) => (
                        <button
                          key={g.val}
                          type="button"
                          onClick={() => setGender(g.val)}
                          className={`min-h-[48px] rounded-xl border text-xs font-bold transition-colors cursor-pointer ${
                            gender === g.val
                              ? 'bg-[#0F766E] border-[#0F766E] text-white'
                              : 'bg-slate-50 border-slate-300 text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          {g.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label htmlFor="pt-abha" className="text-xs font-bold text-slate-700">
                      ABHA ID (Ayushman Bharat Health Account)
                    </label>
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#0F766E]">
                      <ShieldCheck className="w-3 h-3 text-[#10B981]" />
                      14-Digit
                    </span>
                  </div>
                  <input
                    id="pt-abha"
                    type="text"
                    value={abhaId}
                    onChange={(e) => setAbhaId(e.target.value)}
                    className="w-full min-h-[48px] px-3.5 rounded-xl border border-slate-300 font-mono text-xs font-semibold text-slate-900 tabular-nums"
                  />
                </div>
              </div>

              {/* Vitals Input 2x2 Grid */}
              <div className="grid grid-cols-2 gap-2.5 pt-2 border-t border-slate-100">
                {/* Systolic BP */}
                <div
                  className={`rounded-2xl border p-3 ${
                    evaluateVitalStatus('systolic', vitals.systolic) === 'emergency'
                      ? 'border-[#EF4444] bg-red-50/50'
                      : evaluateVitalStatus('systolic', vitals.systolic) === 'moderate'
                      ? 'border-[#F59E0B] bg-amber-50/50'
                      : 'border-slate-200 bg-slate-50/60'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                    <span className="inline-flex items-center gap-1.5">
                      <Heart className="w-4 h-4 text-[#0F766E]" />
                      Systolic BP
                    </span>
                    <span className="text-[10px] text-slate-500">mmHg</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-1">
                    <button
                      type="button"
                      onClick={() => adjustVital('systolic', -5)}
                      aria-label="Decrease Systolic BP"
                      className="min-h-[48px] min-w-[44px] rounded-xl bg-white border border-slate-300 flex items-center justify-center text-slate-800 cursor-pointer"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <input
                      type="number"
                      aria-label="Systolic BP"
                      value={vitals.systolic}
                      onChange={(e) =>
                        setVitals((v) => ({...v, systolic: Number(e.target.value) || 0}))
                      }
                      className="w-full min-w-0 text-center font-mono text-xl font-bold text-slate-900 bg-transparent tabular-nums"
                    />
                    <button
                      type="button"
                      onClick={() => adjustVital('systolic', 5)}
                      aria-label="Increase Systolic BP"
                      className="min-h-[48px] min-w-[44px] rounded-xl bg-white border border-slate-300 flex items-center justify-center text-slate-800 cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Diastolic BP */}
                <div
                  className={`rounded-2xl border p-3 ${
                    evaluateVitalStatus('diastolic', vitals.diastolic) === 'emergency'
                      ? 'border-[#EF4444] bg-red-50/50'
                      : evaluateVitalStatus('diastolic', vitals.diastolic) === 'moderate'
                      ? 'border-[#F59E0B] bg-amber-50/50'
                      : 'border-slate-200 bg-slate-50/60'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                    <span className="inline-flex items-center gap-1.5">
                      <Heart className="w-4 h-4 text-[#0F766E]" />
                      Diastolic BP
                    </span>
                    <span className="text-[10px] text-slate-500">mmHg</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-1">
                    <button
                      type="button"
                      onClick={() => adjustVital('diastolic', -2)}
                      aria-label="Decrease Diastolic BP"
                      className="min-h-[48px] min-w-[44px] rounded-xl bg-white border border-slate-300 flex items-center justify-center text-slate-800 cursor-pointer"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <input
                      type="number"
                      aria-label="Diastolic BP"
                      value={vitals.diastolic}
                      onChange={(e) =>
                        setVitals((v) => ({...v, diastolic: Number(e.target.value) || 0}))
                      }
                      className="w-full min-w-0 text-center font-mono text-xl font-bold text-slate-900 bg-transparent tabular-nums"
                    />
                    <button
                      type="button"
                      onClick={() => adjustVital('diastolic', 2)}
                      aria-label="Increase Diastolic BP"
                      className="min-h-[48px] min-w-[44px] rounded-xl bg-white border border-slate-300 flex items-center justify-center text-slate-800 cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* SpO2 % */}
                <div
                  className={`rounded-2xl border p-3 ${
                    evaluateVitalStatus('spo2', vitals.spo2) === 'emergency'
                      ? 'border-[#EF4444] bg-red-50/50'
                      : evaluateVitalStatus('spo2', vitals.spo2) === 'moderate'
                      ? 'border-[#F59E0B] bg-amber-50/50'
                      : 'border-slate-200 bg-slate-50/60'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                    <span className="inline-flex items-center gap-1.5">
                      <LungsIcon className="w-4 h-4 text-[#0F766E]" />
                      SpO₂ %
                    </span>
                    <span className="text-[10px] text-slate-500">%</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-1">
                    <button
                      type="button"
                      onClick={() => adjustVital('spo2', -1)}
                      aria-label="Decrease SpO2"
                      className="min-h-[48px] min-w-[44px] rounded-xl bg-white border border-slate-300 flex items-center justify-center text-slate-800 cursor-pointer"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <input
                      type="number"
                      aria-label="SpO2 Percentage"
                      value={vitals.spo2}
                      onChange={(e) =>
                        setVitals((v) => ({
                          ...v,
                          spo2: Math.min(100, Math.max(0, Number(e.target.value) || 0)),
                        }))
                      }
                      className="w-full min-w-0 text-center font-mono text-xl font-bold text-slate-900 bg-transparent tabular-nums"
                    />
                    <button
                      type="button"
                      onClick={() => adjustVital('spo2', 1)}
                      aria-label="Increase SpO2"
                      className="min-h-[48px] min-w-[44px] rounded-xl bg-white border border-slate-300 flex items-center justify-center text-slate-800 cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Temperature °F */}
                <div
                  className={`rounded-2xl border p-3 ${
                    evaluateVitalStatus('temperature', vitals.temperature) === 'emergency'
                      ? 'border-[#EF4444] bg-red-50/50'
                      : evaluateVitalStatus('temperature', vitals.temperature) === 'moderate'
                      ? 'border-[#F59E0B] bg-amber-50/50'
                      : 'border-slate-200 bg-slate-50/60'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                    <span className="inline-flex items-center gap-1.5">
                      <Thermometer className="w-4 h-4 text-[#0F766E]" />
                      Temp °F
                    </span>
                    <span className="text-[10px] text-slate-500">°F</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-1">
                    <button
                      type="button"
                      onClick={() => adjustVital('temperature', -0.5)}
                      aria-label="Decrease Temperature"
                      className="min-h-[48px] min-w-[44px] rounded-xl bg-white border border-slate-300 flex items-center justify-center text-slate-800 cursor-pointer"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <input
                      type="number"
                      step="0.1"
                      aria-label="Temperature Fahrenheit"
                      value={vitals.temperature}
                      onChange={(e) =>
                        setVitals((v) => ({...v, temperature: Number(e.target.value) || 0}))
                      }
                      className="w-full min-w-0 text-center font-mono text-xl font-bold text-slate-900 bg-transparent tabular-nums"
                    />
                    <button
                      type="button"
                      onClick={() => adjustVital('temperature', 0.5)}
                      aria-label="Increase Temperature"
                      className="min-h-[48px] min-w-[44px] rounded-xl bg-white border border-slate-300 flex items-center justify-center text-slate-800 cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Symptom Chips */}
              <div className="pt-2 border-t border-slate-100">
                <p className="text-xs font-bold text-slate-700 mb-2">
                  Presenting Symptoms (Tap to toggle):
                </p>
                <div className="flex flex-wrap gap-2">
                  {ALL_SYMPTOMS.map((sym) => {
                    const active = symptoms.includes(sym);
                    const isCriticalSym = sym === 'Chest Pain';
                    return (
                      <button
                        key={sym}
                        type="button"
                        onClick={() => toggleSymptom(sym)}
                        className={`min-h-[48px] px-3.5 rounded-xl border text-xs font-bold transition-colors cursor-pointer ${
                          active
                            ? isCriticalSym
                              ? 'bg-[#EF4444] border-[#EF4444] text-white'
                              : 'bg-[#0F766E] border-[#0F766E] text-white'
                            : 'bg-slate-50 border-slate-300 text-slate-800 hover:bg-slate-100'
                        }`}
                      >
                        {sym}
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* 4. Edge-AI Micro-Diagnostics Tab */}
            <section className="rounded-3xl bg-white border border-slate-200 p-4 space-y-3.5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-900">{copy.edgeAiTitle}</h2>
                <span className="text-[11px] font-mono text-[#0F766E] font-semibold">
                  On-Device TFLite
                </span>
              </div>

              {/* Sub-tabs */}
              <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-2xl">
                <button
                  type="button"
                  onClick={() => setActiveDiagTab('anemia')}
                  className={`min-h-[44px] px-3 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                    activeDiagTab === 'anemia'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5 text-[#0F766E]" />
                  <span>Conjunctiva Anemia</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveDiagTab('cough')}
                  className={`min-h-[44px] px-3 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                    activeDiagTab === 'cough'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <AudioWaveform className="w-3.5 h-3.5 text-[#0F766E]" />
                  <span>Cough Audio (5s)</span>
                </button>
              </div>

              {activeDiagTab === 'anemia' ? (
                <div className="space-y-3">
                  {/* Simulated Camera / Uploaded Eyelid Viewfinder */}
                  <div className="relative h-36 rounded-2xl bg-slate-900 overflow-hidden border border-slate-800 flex items-center justify-center">
                    {uploadedEyePreview ? (
                      <img
                        src={uploadedEyePreview}
                        alt="Uploaded lower eyelid conjunctiva preview"
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover opacity-85"
                      />
                    ) : (
                      <svg
                        viewBox="0 0 320 140"
                        className="w-full h-full"
                        aria-label="Simulated Palpebral Conjunctiva Viewfinder"
                      >
                        <rect width="320" height="140" fill="#1E293B" />
                        <path
                          d="M 45 70 Q 160 15 275 70 Q 160 120 45 70 Z"
                          fill="#F8FAFC"
                          opacity="0.92"
                        />
                        <circle cx="160" cy="66" r="24" fill="#334155" />
                        <circle cx="160" cy="66" r="10" fill="#0F172A" />
                        {/* Pale lower palpebral conjunctiva band */}
                        <path
                          d="M 70 82 Q 160 116 250 82 Q 160 102 70 82 Z"
                          fill={anemiaFlagged ? '#FCA5A5' : '#F87171'}
                        />
                        <rect
                          x="65"
                          y="72"
                          width="190"
                          height="34"
                          rx="8"
                          fill="none"
                          stroke="#10B981"
                          strokeWidth="1.5"
                          strokeDasharray="4 3"
                        />
                      </svg>
                    )}

                    {anemiaScanning && (
                      <motion.div
                        initial={{y: -60}}
                        animate={{y: 60}}
                        transition={{duration: 0.9, repeat: Infinity, repeatType: 'reverse'}}
                        className="absolute inset-x-4 h-0.5 bg-[#10B981] shadow-md"
                      />
                    )}
                  </div>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleEyePhotoUpload}
                    className="hidden"
                  />

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => runConjunctivaAnalysis()}
                      disabled={anemiaScanning}
                      className="min-h-[48px] px-3 rounded-xl bg-[#0F766E] hover:bg-teal-800 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Camera className="w-4 h-4 shrink-0" />
                      <span>{anemiaScanning ? 'Analyzing Pallor...' : 'Simulate Eyelid Scan'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="min-h-[48px] px-3 rounded-xl border border-slate-300 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-800 inline-flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Upload className="w-4 h-4 shrink-0" />
                      <span>Upload Photo</span>
                    </button>
                  </div>

                  {anemiaFlagged && (
                    <div className="rounded-2xl bg-red-50 border border-[#EF4444] p-3 flex items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-bold text-red-900">
                          Suspected Severe Anemia (Hb &lt; 8 g/dL)
                        </p>
                        <p className="text-[11px] text-red-800 font-mono tabular-nums mt-0.5">
                          Est. Hemoglobin: {estimatedHb} g/dL · Erythema Index Low (94% conf.)
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setAnemiaFlagged(false);
                          setEstimatedHb(undefined);
                        }}
                        className="text-[11px] font-bold text-slate-600 underline cursor-pointer shrink-0"
                      >
                        Clear
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-2xl bg-slate-900 p-4 text-white space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-300 font-medium">
                        5-Second Acoustic Cough Spectrogram
                      </span>
                      <span className="font-mono font-bold text-emerald-300 tabular-nums">
                        {coughRecording ? `00:0${coughSecondsLeft}s` : '5.0s Window'}
                      </span>
                    </div>

                    <div className="h-14 flex items-center justify-center gap-1.5">
                      {[0.35, 0.7, 0.95, 0.5, 1, 0.8, 0.45, 0.9, 0.6, 0.85, 0.4, 0.75].map(
                        (amp, i) => (
                          <motion.span
                            key={i}
                            animate={
                              coughRecording
                                ? {scaleY: [0.25, amp, 0.3]}
                                : {scaleY: respiratoryFlagged ? amp * 0.85 : 0.25}
                            }
                            transition={{
                              duration: 0.45,
                              repeat: coughRecording ? Infinity : 0,
                              delay: i * 0.04,
                            }}
                            className={`w-2 h-12 rounded-full inline-block origin-center ${
                              respiratoryFlagged ? 'bg-[#EF4444]' : 'bg-[#10B981]'
                            }`}
                          />
                        )
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={startCoughRecorder}
                    disabled={coughRecording}
                    className="w-full min-h-[48px] px-4 rounded-xl bg-[#0F766E] hover:bg-teal-800 disabled:opacity-60 text-white text-xs font-bold inline-flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Mic className="w-4 h-4" />
                    <span>
                      {coughRecording
                        ? `Recording Patient Cough (${coughSecondsLeft}s)...`
                        : 'Record 5-Second Cough Sample'}
                    </span>
                  </button>

                  {respiratoryFlagged && (
                    <div className="rounded-2xl bg-red-50 border border-[#EF4444] p-3 flex items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-bold text-red-900">High Respiratory Risk</p>
                        <p className="text-[11px] text-red-800 font-mono tabular-nums mt-0.5">
                          Spectral Peak: {coughPeakHz} Hz · Wet Bronchial Crackle Detected
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setRespiratoryFlagged(false);
                          setCoughPeakHz(undefined);
                        }}
                        className="text-[11px] font-bold text-slate-600 underline cursor-pointer shrink-0"
                      >
                        Clear
                      </button>
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* 5. Dynamic Triage Scorecard */}
            <section
              aria-live="polite"
              className={`rounded-3xl border-2 p-4 space-y-2.5 transition-colors ${
                triage.severity === 'emergency'
                  ? 'bg-red-50 border-[#EF4444] text-red-950'
                  : triage.severity === 'moderate'
                  ? 'bg-amber-50 border-[#F59E0B] text-amber-950'
                  : 'bg-emerald-50 border-[#10B981] text-emerald-950'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold">Dynamic Triage Scorecard</span>
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
                      ? 'RED · CRITICAL EMERGENCY'
                      : triage.severity === 'moderate'
                      ? 'YELLOW · Moderate Risk'
                      : 'GREEN · Routine'}
                  </span>
                </span>
              </div>

              <p className="text-xs font-bold leading-snug">{triage.triggers.join(' · ')}</p>
              <p className="text-xs opacity-90 leading-relaxed">{triage.protocol}</p>
            </section>

            {/* 6. Emergency Action Bar */}
            <section className="rounded-3xl bg-white border border-slate-200 p-4 space-y-3">
              {/* BLE Mesh Relay Status */}
              <div className="flex items-center justify-between text-xs px-1">
                {networkState === 'offline' ? (
                  <span className="inline-flex items-center gap-1.5 font-bold text-[#0F766E]">
                    <Bluetooth className="w-4 h-4 text-[#10B981]" />
                    <span>BLE Peer Relay Ready (ANM Sub-Center Hop Active)</span>
                  </span>
                ) : (
                  <span className="text-slate-600 font-medium">
                    Direct {networkState.toUpperCase()} Packet &amp; Baseband SMS Ready
                  </span>
                )}
                <span className="font-mono text-[11px] text-slate-400">AES-128</span>
              </div>

              <button
                type="button"
                onClick={handleSaveOfflineRecord}
                className="w-full min-h-[50px] px-4 rounded-xl bg-[#0F766E] hover:bg-teal-800 active:scale-[0.99] text-white text-sm font-bold inline-flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <Save className="w-4 h-4 shrink-0" />
                <span>{copy.saveOfflineBtn}</span>
              </button>

              <button
                type="button"
                onClick={() => setSmsPreviewOpen(true)}
                className="w-full min-h-[50px] px-4 rounded-xl bg-[#EF4444] hover:bg-red-600 active:scale-[0.99] text-white text-sm font-bold inline-flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
              >
                <MessageSquareLock className="w-4 h-4 shrink-0" />
                <span>{copy.sendEncryptedSmsBtn}</span>
              </button>
            </section>
          </div>
        </div>
      </div>

      {/* Encrypted Emergency SMS Preview Modal */}
      <AnimatePresence>
        {smsPreviewOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/65 backdrop-blur-xs p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sms-preview-modal-title"
          >
            <motion.div
              initial={{opacity: 0, scale: 0.96, y: 10}}
              animate={{opacity: 1, scale: 1, y: 0}}
              exit={{opacity: 0, scale: 0.96, y: 10}}
              transition={{duration: 0.18}}
              className="w-full max-w-md rounded-3xl bg-white border border-slate-200 shadow-2xl overflow-hidden"
            >
              <div className="bg-[#EF4444] text-white px-5 py-4 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <MessageSquareLock className="w-5 h-5 shrink-0" />
                  <div>
                    <h3 id="sms-preview-modal-title" className="text-base font-bold">
                      Encrypted Baseband Emergency SMS
                    </h3>
                    <p className="text-xs text-red-100">
                      Zero-Internet GSM 7-Bit Bit-Packed Transmission
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSmsPreviewOpen(false)}
                  aria-label="Close SMS Preview"
                  className="min-h-[40px] min-w-[40px] rounded-xl bg-white/15 hover:bg-white/25 flex items-center justify-center cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>Gateway Shortcode: <strong>108-2400 (District 24 HQ)</strong></span>
                  <span className="font-mono font-bold text-[#0F766E] tabular-nums">
                    {liveSmsPayload.length}/160 chars
                  </span>
                </div>

                <div className="rounded-2xl bg-slate-950 text-emerald-300 font-mono text-xs p-4 break-all leading-relaxed border border-slate-800">
                  {liveSmsPayload}
                </div>

                <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3.5 text-xs text-slate-700 space-y-1">
                  <p className="font-bold text-slate-900">Packed Clinical Fields:</p>
                  <p>
                    Patient: <strong>{patientName}</strong> ({nextPatientId}) · Village{' '}
                    <strong>VIL-204</strong>
                  </p>
                  <p className="font-mono tabular-nums">
                    BP {vitals.systolic}/{vitals.diastolic} mmHg · SpO₂ {vitals.spo2}% · Temp{' '}
                    {vitals.temperature.toFixed(1)}°F
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setSmsPreviewOpen(false)}
                    className="min-h-[48px] px-4 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleTransmitEmergencySms}
                    className="min-h-[48px] px-4 rounded-xl bg-[#EF4444] hover:bg-red-600 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Send className="w-4 h-4" />
                    <span>Transmit SMS Now</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Two-Way ASHA Saheli Voice Chatbot Modal */}
      <AshaSaheliModal
        isOpen={saheliOpen}
        onClose={() => setSaheliOpen(false)}
        onApplyFormPatch={handleApplySaheliPatch}
      />

      {/* Mera Incentive Ledger Modal */}
      <IncentiveLedgerModal
        isOpen={incentiveOpen}
        onClose={() => setIncentiveOpen(false)}
        entries={incentives}
        ashaName="Sunita Devi"
        ashaId={ashaId}
      />
    </div>
  );
};
