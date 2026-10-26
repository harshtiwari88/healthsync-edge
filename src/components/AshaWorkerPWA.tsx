import React, {useMemo, useState} from 'react';
import {
  AlertOctagon,
  Award,
  CheckCircle2,
  Copy,
  HeartPulse,
  Lock,
  Mic,
  Save,
  Send,
  ShieldAlert,
  Thermometer,
  User,
  Wind,
  X,
} from 'lucide-react';
import {
  EdgeAiDiagnostics,
  evaluateTriage,
  IncentiveEntry,
  NetworkState,
  SymptomKey,
  TriageRecord,
  VitalsSnapshot,
} from '../types/triage';
import {encodeVitalsToSMS, formatCompactSmsTag} from '../utils/binarySmsCodec';
import {parseClinicalTranscript, speakClinicalGuidance} from '../utils/speechEngine';
import {EdgeAiDiagnosticsPanel} from './EdgeAiDiagnosticsPanel';
import {AshaSaheliModal} from './AshaSaheliModal';
import {IncentiveLedgerModal} from './IncentiveLedgerModal';

interface AshaWorkerPWAProps {
  ashaId: string;
  networkState: NetworkState;
  incentives: IncentiveEntry[];
  pendingOfflineCount: number;
  onSaveRecord: (record: TriageRecord, isEmergencySms: boolean) => void;
}

const FORM_SYMPTOMS: SymptomKey[] = [
  'Fever',
  'High BP',
  'Severe Chest Pain',
  'Dizziness',
  'Cough',
];

const QUICK_VOICE_CHIPS = [
  'BP 160/100 SpO2 88%',
  'Bukhar 102 khansi',
  'Emergency First-Aid',
];

export const AshaWorkerPWA: React.FC<AshaWorkerPWAProps> = ({
  ashaId,
  networkState,
  incentives,
  pendingOfflineCount,
  onSaveRecord,
}) => {
  const [patientName, setPatientName] = useState('Rameshwar Prasad');
  const [patientAge, setPatientAge] = useState<number>(56);
  const [vitals, setVitals] = useState<VitalsSnapshot>({
    systolic: 124,
    diastolic: 82,
    spo2: 98,
    temperature: 98.6,
    heartRate: 80,
  });
  const [symptoms, setSymptoms] = useState<SymptomKey[]>([]);
  const [edgeAi, setEdgeAi] = useState<EdgeAiDiagnostics>({
    anemiaSuspected: false,
    respiratoryRiskHigh: false,
  });

  const [lastVoiceTranscript, setLastVoiceTranscript] = useState('');
  const [saheliOpen, setSaheliOpen] = useState(false);
  const [incentiveModalOpen, setIncentiveModalOpen] = useState(false);
  const [smsModalOpen, setSmsModalOpen] = useState(false);
  const [copiedPayload, setCopiedPayload] = useState(false);
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);

  const totalIncentiveInr = useMemo(
    () => incentives.reduce((sum, item) => sum + item.amountInr, 0),
    [incentives]
  );

  const triage = useMemo(
    () => evaluateTriage(vitals, symptoms, edgeAi),
    [vitals, symptoms, edgeAi]
  );

  const bitPacked28CharSms = useMemo(
    () =>
      encodeVitalsToSMS({
        patientId: 'PT8932',
        ashaId,
        villageCode: 'VIL-204',
        vitals,
        symptoms,
        edgeAi,
        severity: triage.severity,
      }),
    [ashaId, vitals, symptoms, edgeAi, triage.severity]
  );

  const compactSmsTag = useMemo(
    () =>
      formatCompactSmsTag({
        patientId: 'PT8932',
        ashaId,
        villageCode: 'VIL-204',
        vitals,
        symptoms,
        edgeAi,
        severity: triage.severity,
      }),
    [ashaId, vitals, symptoms, edgeAi, triage.severity]
  );

  const applyVoiceEntities = (
    vitalsPatch: Partial<VitalsSnapshot>,
    detectedSymptoms: SymptomKey[],
    transcript: string
  ) => {
    setLastVoiceTranscript(transcript);
    if (Object.keys(vitalsPatch).length > 0) {
      setVitals((prev) => ({
        ...prev,
        ...vitalsPatch,
      }));
    }
    if (detectedSymptoms.length > 0) {
      setSymptoms((prev) => Array.from(new Set([...prev, ...detectedSymptoms])));
    }
  };

  const handleQuickChipClick = (chip: string) => {
    const parsed = parseClinicalTranscript(chip);
    applyVoiceEntities(parsed.vitalsPatch, parsed.detectedSymptoms, chip);
    if (parsed.isEmergencyFirstAidQuery) {
      setSaheliOpen(true);
    } else if (
      (parsed.vitalsPatch.systolic && parsed.vitalsPatch.systolic >= 160) ||
      (parsed.vitalsPatch.spo2 && parsed.vitalsPatch.spo2 < 90)
    ) {
      speakClinicalGuidance(
        'Critical Red Alert detected. Vitals populated. Save or send Emergency SMS immediately.',
        'en-IN',
        false
      );
    }
  };

  const toggleSymptom = (sym: SymptomKey) => {
    setSymptoms((prev) =>
      prev.includes(sym) ? prev.filter((item) => item !== sym) : [...prev, sym]
    );
  };

  const buildRecord = (isEmergencySms: boolean): TriageRecord => {
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
    const randomNum = Math.floor(8932 + Math.random() * 60);

    return {
      id: `rec-${Date.now()}`,
      patientId: `PT${randomNum}`,
      abhaId: `91-${Math.floor(1000 + Math.random() * 8999)}-4410-8821`,
      patientName: patientName.trim() || 'Rural Patient',
      age: Number(patientAge) || 45,
      gender: 'M',
      villageCode: 'VIL-204',
      villageName: 'Rampur Sub-Center',
      ashaWorker: `Sunita Devi (${ashaId})`,
      vitals: {...vitals},
      symptoms: [...symptoms],
      edgeAi: {...edgeAi},
      severity: triage.severity,
      clinicalNotes: lastVoiceTranscript
        ? `Voice Transcript: "${lastVoiceTranscript}"`
        : triage.protocolEn,
      channel: isEmergencySms ? 'Emergency SMS' : 'Data',
      syncStatus: isEmergencySms
        ? 'SMS Delivered'
        : networkState === 'offline'
        ? 'Queued Offline'
        : 'Synced',
      binarySmsPayload: bitPacked28CharSms,
      timestamp: timeStr,
      createdAtMs: Date.now(),
      dispatchStatus: 'Unassigned',
    };
  };

  const handlePrimarySaveClick = () => {
    // STRICT REACTIVE NETWORK RULE:
    // When Offline, saving a RED Critical Alert MUST directly open the Encrypted Binary SMS Payload modal
    // instead of attempting cloud sync.
    if (networkState === 'offline' && triage.severity === 'emergency') {
      setSmsModalOpen(true);
      return;
    }

    const record = buildRecord(false);
    const reward = triage.severity === 'routine' ? 20 : 50;
    onSaveRecord(record, false);

    if (networkState === 'offline') {
      setFeedbackNotice(
        `Saved to LocalStorage & IndexedDB Offline Queue (${record.patientName}) · +₹${reward} Incentive Added.`
      );
    } else if (triage.severity === 'emergency') {
      setFeedbackNotice(
        `CRITICAL RED Alert synced in real-time to DMO Command & Emergency Siren triggered! (+₹${reward} High-Risk Incentive)`
      );
    } else {
      setFeedbackNotice(
        `Patient Record synced to District Cloud (${record.patientName}) · +₹${reward} Incentive Added.`
      );
    }
    window.setTimeout(() => setFeedbackNotice(null), 5500);
  };

  const handleConfirmSendEmergencySms = () => {
    const record = buildRecord(true);
    onSaveRecord(record, true);
    setSmsModalOpen(false);
    setFeedbackNotice(
      `Encrypted 28-Char Binary SMS (${bitPacked28CharSms}) dispatched via GSM Baseband to DMO Command! (+₹50 High-Risk Incentive)`
    );
    window.setTimeout(() => setFeedbackNotice(null), 6000);
  };

  return (
    <div className="w-full px-3">
      {/* Rock-Solid Fixed Mobile Viewport Mockup Container */}
      <div className="custom-scrollbar max-w-md w-full mx-auto my-6 bg-slate-900 rounded-[32px] border-4 border-slate-800 p-4 shadow-2xl space-y-4 overflow-y-auto max-h-[85vh]">
        {/* 1. Mobile Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3.5">
          <div className="min-w-0">
            <p className="text-xs font-medium text-teal-400 truncate">
              Rampur Sub-Center · VIL-204
            </p>
            <h1 className="mt-0.5 text-base font-bold text-slate-100 truncate">
              Sunita Devi ({ashaId})
            </h1>
            <p className="mt-0.5 text-xs text-slate-400 tabular-nums">
              {networkState === 'offline'
                ? `${pendingOfflineCount} Queued in LocalStorage / IDB`
                : `Cloud Sync Ready · ${pendingOfflineCount} Pending`}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setIncentiveModalOpen(true)}
            className="inline-flex min-h-[42px] shrink-0 items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-950/50 px-3 py-1.5 text-xs font-bold text-emerald-300 transition hover:bg-emerald-900/50 whitespace-nowrap cursor-pointer tabular-nums"
          >
            <Award className="h-4 w-4 text-emerald-400 shrink-0" />
            <span>₹{totalIncentiveInr} Today</span>
          </button>
        </div>

        {/* Status Toast inside Mobile Container */}
        {feedbackNotice && (
          <div
            role="status"
            className="flex items-start gap-2 rounded-xl border border-teal-500/40 bg-teal-950/50 p-3 text-xs font-medium text-teal-200"
          >
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-teal-400" />
            <span>{feedbackNotice}</span>
          </div>
        )}

        {/* 2. "ASHA Saheli" Voice Assistant Section */}
        <section className="space-y-2.5 rounded-2xl border border-slate-800 bg-slate-950/70 p-3.5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-100">ASHA Saheli Voice Assistant</h2>
              <p className="text-xs text-slate-400">
                Speak BP, SpO2 &amp; Temperature in Hindi or English
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setSaheliOpen(true)}
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-teal-500 cursor-pointer whitespace-nowrap"
          >
            <Mic className="h-4 w-4 shrink-0" />
            <span>Tap to Speak Patient Vitals</span>
          </button>

          {lastVoiceTranscript && (
            <p className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-300">
              <strong className="text-teal-400">Parsed:</strong> “{lastVoiceTranscript}”
            </p>
          )}

          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {QUICK_VOICE_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => handleQuickChipClick(chip)}
                className="rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition hover:border-teal-500/50 hover:text-teal-300 cursor-pointer"
              >
                {chip}
              </button>
            ))}
          </div>
        </section>

        {/* 3. Patient & Quick Vitals Form */}
        <section className="space-y-3 border-t border-slate-800 pt-3.5">
          <h2 className="text-sm font-bold text-slate-100">Patient &amp; Vitals Screening</h2>

          <div className="grid grid-cols-3 gap-2.5">
            <div className="col-span-2">
              <label
                htmlFor="pt-name-input"
                className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-400"
              >
                <User className="h-3.5 w-3.5 text-teal-400" />
                <span>Patient Name</span>
              </label>
              <input
                id="pt-name-input"
                type="text"
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                className="min-h-[44px] w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-sm font-semibold text-slate-100 focus:border-teal-500 focus:outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="pt-age-input"
                className="mb-1 block text-xs font-medium text-slate-400"
              >
                Age (Yrs)
              </label>
              <input
                id="pt-age-input"
                type="number"
                min={1}
                max={115}
                value={patientAge}
                onChange={(e) => setPatientAge(Number(e.target.value))}
                className="min-h-[44px] w-full rounded-xl border border-slate-800 bg-slate-950 px-3 font-mono text-sm font-bold text-slate-100 tabular-nums focus:border-teal-500 focus:outline-none"
              />
            </div>
          </div>

          {/* 2x2 Vitals Grid */}
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="mb-1 flex items-center justify-between text-xs font-medium text-slate-400">
                <span>Systolic BP (mmHg)</span>
                <HeartPulse className="h-3.5 w-3.5 text-rose-400" />
              </label>
              <input
                type="number"
                min={50}
                max={260}
                value={vitals.systolic}
                onChange={(e) =>
                  setVitals((prev) => ({...prev, systolic: Number(e.target.value)}))
                }
                className="min-h-[46px] w-full rounded-xl border border-slate-800 bg-slate-950 px-3 font-mono text-lg font-bold text-slate-100 tabular-nums focus:border-teal-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 flex items-center justify-between text-xs font-medium text-slate-400">
                <span>Diastolic BP (mmHg)</span>
                <HeartPulse className="h-3.5 w-3.5 text-rose-400" />
              </label>
              <input
                type="number"
                min={35}
                max={170}
                value={vitals.diastolic}
                onChange={(e) =>
                  setVitals((prev) => ({...prev, diastolic: Number(e.target.value)}))
                }
                className="min-h-[46px] w-full rounded-xl border border-slate-800 bg-slate-950 px-3 font-mono text-lg font-bold text-slate-100 tabular-nums focus:border-teal-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 flex items-center justify-between text-xs font-medium text-slate-400">
                <span>SpO2 (%)</span>
                <Wind className="h-3.5 w-3.5 text-sky-400" />
              </label>
              <input
                type="number"
                min={50}
                max={100}
                value={vitals.spo2}
                onChange={(e) =>
                  setVitals((prev) => ({...prev, spo2: Number(e.target.value)}))
                }
                className="min-h-[46px] w-full rounded-xl border border-slate-800 bg-slate-950 px-3 font-mono text-lg font-bold text-slate-100 tabular-nums focus:border-teal-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 flex items-center justify-between text-xs font-medium text-slate-400">
                <span>Temp (°F)</span>
                <Thermometer className="h-3.5 w-3.5 text-amber-400" />
              </label>
              <input
                type="number"
                step="0.1"
                min={93}
                max={109}
                value={vitals.temperature}
                onChange={(e) =>
                  setVitals((prev) => ({...prev, temperature: Number(e.target.value)}))
                }
                className="min-h-[46px] w-full rounded-xl border border-slate-800 bg-slate-950 px-3 font-mono text-lg font-bold text-slate-100 tabular-nums focus:border-teal-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Symptoms */}
          <div className="pt-1">
            <p className="mb-2 text-xs font-medium text-slate-400">Observed Clinical Symptoms</p>
            <div className="grid grid-cols-2 gap-2">
              {FORM_SYMPTOMS.map((sym) => {
                const checked = symptoms.includes(sym);
                return (
                  <label
                    key={sym}
                    className={`flex min-h-[42px] cursor-pointer items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                      checked
                        ? sym === 'Severe Chest Pain'
                          ? 'border-red-500/60 bg-red-950/50 text-red-200'
                          : 'border-teal-500/60 bg-teal-950/50 text-teal-200'
                        : 'border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSymptom(sym)}
                      className="h-4 w-4 accent-teal-500"
                    />
                    <span className="truncate">{sym}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </section>

        {/* 4. Edge-AI Camera & Cough Diagnostics */}
        <EdgeAiDiagnosticsPanel diagnostics={edgeAi} onChange={setEdgeAi} />

        {/* 5. Live Triage Severity & Reactive Save / SMS Actions */}
        <section
          className={`space-y-3 rounded-2xl border p-4 ${
            triage.severity === 'emergency'
              ? 'border-red-500/60 bg-red-950/35'
              : triage.severity === 'moderate'
              ? 'border-amber-500/50 bg-amber-950/25'
              : 'border-emerald-500/40 bg-emerald-950/25'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-300">Live Triage Classification</span>
            <span
              className={`rounded-lg px-2.5 py-1 text-xs font-bold whitespace-nowrap ${
                triage.severity === 'emergency'
                  ? 'bg-red-600 text-white'
                  : triage.severity === 'moderate'
                  ? 'bg-amber-500 text-slate-950'
                  : 'bg-emerald-600 text-white'
              }`}
            >
              {triage.severity === 'emergency'
                ? 'RED · CRITICAL (+₹50)'
                : triage.severity === 'moderate'
                ? 'YELLOW · HIGH RISK (+₹50)'
                : 'GREEN · NCD ROUTINE (+₹20)'}
            </span>
          </div>

          <p className="text-xs leading-relaxed text-slate-300">{triage.protocolEn}</p>

          {triage.severity === 'emergency' && networkState === 'offline' && (
            <div className="flex items-start gap-2 rounded-xl border border-red-500/50 bg-red-950/70 p-2.5 text-xs text-red-200">
              <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <span>
                Offline Critical Guard: Saving this RED alert opens the Encrypted Binary SMS Payload
                bypass modal since Cloud Sync is suspended.
              </span>
            </div>
          )}

          <div className="space-y-2 pt-1">
            <button
              type="button"
              onClick={handlePrimarySaveClick}
              className={`flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white transition cursor-pointer whitespace-nowrap ${
                triage.severity === 'emergency' && networkState === 'offline'
                  ? 'bg-red-600 hover:bg-red-500'
                  : 'bg-teal-600 hover:bg-teal-500'
              }`}
            >
              <Save className="h-4 w-4 shrink-0" />
              <span>
                {triage.severity === 'emergency' && networkState === 'offline'
                  ? 'Save Critical Alert (Opens SMS Payload)'
                  : 'Save Patient Record'}
              </span>
            </button>

            {triage.severity === 'emergency' && networkState !== 'offline' && (
              <button
                type="button"
                onClick={() => setSmsModalOpen(true)}
                className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-red-500/60 bg-red-950/60 px-4 py-2 text-xs font-bold text-red-200 transition hover:bg-red-900/60 cursor-pointer whitespace-nowrap"
              >
                <ShieldAlert className="h-4 w-4 text-red-400 shrink-0" />
                <span>Inspect / Send Encrypted Binary SMS Backup</span>
              </button>
            )}
          </div>
        </section>
      </div>

      {/* Modals (Bounded to max-w-md & max-h-[85vh]) */}
      <AshaSaheliModal
        open={saheliOpen}
        onClose={() => setSaheliOpen(false)}
        onApplyVoiceEntities={applyVoiceEntities}
      />

      <IncentiveLedgerModal
        open={incentiveModalOpen}
        onClose={() => setIncentiveModalOpen(false)}
        entries={incentives}
      />

      {smsModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sms-modal-title"
        >
          <div className="custom-scrollbar max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-red-500/40 bg-slate-900 text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 bg-red-950/60 px-5 py-4">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-red-400 shrink-0" />
                <div>
                  <h3 id="sms-modal-title" className="text-base font-bold text-slate-100">
                    Encrypted Binary SMS Payload
                  </h3>
                  <p className="text-xs text-red-200">
                    Zero-Internet GSM Baseband Emergency Channel
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSmsModalOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-100 cursor-pointer"
                aria-label="Close modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="inline-flex items-center gap-1 font-semibold text-slate-300">
                    <Lock className="h-3.5 w-3.5 text-teal-400" />
                    28-Char Bit-Packed Base64 Frame
                  </span>
                  <span className="font-mono text-slate-400 tabular-nums">
                    {bitPacked28CharSms.length} chars · CRC-16
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-3 font-mono text-sm font-bold text-emerald-400">
                  <span className="truncate">{bitPacked28CharSms}</span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(bitPacked28CharSms);
                      setCopiedPayload(true);
                      window.setTimeout(() => setCopiedPayload(false), 2000);
                    }}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 font-sans text-xs font-semibold text-slate-200 hover:border-teal-500/60 cursor-pointer"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    <span>{copiedPayload ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5 text-xs">
                <p className="font-semibold text-slate-300">Compact SMS Gateway Fallback String</p>
                <p className="mt-1 font-mono font-bold text-red-400 break-all">{compactSmsTag}</p>
                <p className="mt-1.5 text-slate-400">
                  Contains Patient BP ({vitals.systolic}/{vitals.diastolic}), SpO2 ({vitals.spo2}%),
                  Temp ({vitals.temperature}°F) &amp; ASHA ID ({ashaId}).
                </p>
              </div>

              <button
                type="button"
                onClick={handleConfirmSendEmergencySms}
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-red-500 cursor-pointer"
              >
                <Send className="h-4 w-4" />
                <span>Transmit Emergency SMS to DMO Command</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
