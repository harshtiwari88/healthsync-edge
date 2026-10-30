import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Award,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  HeartPulse,
  Mic,
  Minus,
  Plus,
  Save,
  Search,
  Send,
  Stethoscope,
  X,
} from 'lucide-react';
import {
  EdgeAiDiagnostics,
  evaluateTriage,
  evaluateVitalStatus,
  IncentiveEntry,
  maskHealthId,
  NetworkState,
  SeverityLevel,
  SUB_CENTER_DIRECTORY,
  SymptomKey,
  TriageRecord,
  VitalsSnapshot,
} from '../types/triage';
import {encodeVitalsToSMS, formatCompactSmsTag} from '../utils/binarySmsCodec';
import {useVirtualWindow} from '../utils/virtualWindow';
import {EdgeAiDiagnosticsPanel} from './EdgeAiDiagnosticsPanel';
import {AshaSaheliModal} from './AshaSaheliModal';
import {IncentiveLedgerModal} from './IncentiveLedgerModal';
import {AshaNavTab} from './TopRoleToolbar';

interface AshaWorkerPWAProps {
  ashaId: string;
  ashaDisplayName: string;
  villageCode: string;
  sessionToken: string;
  networkState: NetworkState;
  records: TriageRecord[];
  incentives: IncentiveEntry[];
  pendingOfflineCount: number;
  isLoadingRecords?: boolean;
  activeTab: AshaNavTab;
  onSelectTab: (tab: AshaNavTab) => void;
  onSaveRecord: (record: TriageRecord, isEmergencySms: boolean) => void;
}

const SYMPTOM_OPTIONS: Array<{key: SymptomKey; label: string; helper: string}> = [
  {key: 'Fever', label: 'Fever or chills', helper: 'Warm forehead or shivering'},
  {key: 'High BP', label: 'Known high BP', helper: 'Past history or headache'},
  {key: 'Severe Chest Pain', label: 'Chest pain or pressure', helper: 'Urgent warning sign'},
  {key: 'Dizziness', label: 'Dizziness or weakness', helper: 'Lightheaded when standing'},
  {key: 'Cough', label: 'Persistent cough', helper: 'Lasting more than 3 days'},
  {key: 'Bleeding', label: 'Unusual bleeding', helper: 'Urgent warning sign'},
];

function StatusBadgeText({severity}: {severity: SeverityLevel}) {
  if (severity === 'emergency') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700">
        <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
        <span>Urgent Care Needed</span>
      </span>
    );
  }
  if (severity === 'moderate') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-800">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
        <span>Needs Doctor Review</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
      <span>Normal</span>
    </span>
  );
}

export const AshaWorkerPWA: React.FC<AshaWorkerPWAProps> = ({
  ashaId,
  ashaDisplayName,
  villageCode,
  sessionToken,
  networkState,
  records,
  incentives,
  pendingOfflineCount,
  isLoadingRecords = false,
  activeTab,
  onSelectTab,
  onSaveRecord,
}) => {
  // Patient Details (clean empty initial name — never pre-filled with fake patient data)
  const [patientName, setPatientName] = useState('');
  const [patientAge, setPatientAge] = useState<string>('35');
  const [patientGender, setPatientGender] = useState<'F' | 'M' | 'O'>('F');
  const [abhaNumber, setAbhaNumber] = useState<string>('');
  const [clinicalNoteInput, setClinicalNoteInput] = useState<string>('');

  // Standard baseline starting values for convenient adjustment
  const [vitals, setVitals] = useState<VitalsSnapshot>({
    systolic: 120,
    diastolic: 80,
    spo2: 98,
    temperature: 98.6,
    heartRate: 76,
  });
  const [symptoms, setSymptoms] = useState<SymptomKey[]>([]);
  const [edgeAi, setEdgeAi] = useState<EdgeAiDiagnostics>({
    anemiaSuspected: false,
    respiratoryRiskHigh: false,
  });

  const [showOptionalScreening, setShowOptionalScreening] = useState(false);
  const [lastVoiceTranscript, setLastVoiceTranscript] = useState('');
  const [saheliModalOpen, setSaheliModalOpen] = useState(false);
  const [smsModalOpen, setSmsModalOpen] = useState(false);
  const [copiedPayload, setCopiedPayload] = useState(false);
  const [sendingGatewaySms, setSendingGatewaySms] = useState(false);
  const [smsGatewayFeedback, setSmsGatewayFeedback] = useState<{
    sent: boolean;
    message: string;
    nativeUri: string;
  } | null>(null);

  const [formError, setFormError] = useState<string | null>(null);
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);

  // Saved Records Filter & Privacy State
  const [recordSearch, setRecordSearch] = useState('');
  const [revealHealthIds, setRevealHealthIds] = useState(false);

  const isMountedRef = useRef<boolean>(true);
  const feedbackTimerRef = useRef<number | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (feedbackTimerRef.current !== null) {
        window.clearTimeout(feedbackTimerRef.current);
        feedbackTimerRef.current = null;
      }
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
        copyTimerRef.current = null;
      }
    };
  }, []);

  const clinicMeta = useMemo(
    () =>
      SUB_CENTER_DIRECTORY.find((c) => c.code === villageCode) || {
        code: villageCode,
        name: `${villageCode} Health Clinic`,
      },
    [villageCode]
  );

  const totalIncentiveInr = useMemo(
    () => incentives.reduce((sum, item) => sum + item.amountInr, 0),
    [incentives]
  );

  const triage = useMemo(
    () => evaluateTriage(vitals, symptoms, edgeAi),
    [vitals, symptoms, edgeAi]
  );

  const nextPatientId = useMemo(() => `PT${1001 + records.length}`, [records.length]);

  const bitPacked28CharSms = useMemo(
    () =>
      encodeVitalsToSMS({
        patientId: nextPatientId,
        ashaId,
        villageCode,
        vitals,
        symptoms,
        edgeAi,
        severity: triage.severity,
      }),
    [nextPatientId, ashaId, villageCode, vitals, symptoms, edgeAi, triage.severity]
  );

  const compactSmsTag = useMemo(
    () =>
      formatCompactSmsTag({
        patientId: nextPatientId,
        ashaId,
        villageCode,
        vitals,
        symptoms,
        edgeAi,
        severity: triage.severity,
      }),
    [nextPatientId, ashaId, villageCode, vitals, symptoms, edgeAi, triage.severity]
  );

  const defaultNativeSmsUri = useMemo(
    () => `sms:+9118001801104?body=${encodeURIComponent(bitPacked28CharSms)}`,
    [bitPacked28CharSms]
  );

  const filteredRecords = useMemo(() => {
    const q = recordSearch.trim().toLowerCase();
    if (!q) return records;
    return records.filter(
      (r) =>
        r.patientName.toLowerCase().includes(q) ||
        r.patientId.toLowerCase().includes(q) ||
        r.villageCode.toLowerCase().includes(q)
    );
  }, [records, recordSearch]);

  const savedRecordsVirtual = useVirtualWindow<HTMLDivElement, HTMLDivElement>({
    count: filteredRecords.length,
    itemHeight: 96,
    viewportHeight: 560,
    overscan: 6,
    resetKey: `${recordSearch}|${activeTab}`,
  });

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

  const toggleSymptom = (sym: SymptomKey) => {
    setSymptoms((prev) =>
      prev.includes(sym) ? prev.filter((item) => item !== sym) : [...prev, sym]
    );
  };

  const adjustVital = (
    field: keyof VitalsSnapshot,
    delta: number,
    min: number,
    max: number,
    decimals = 0
  ) => {
    setVitals((prev) => {
      const nextRaw = Math.min(max, Math.max(min, prev[field] + delta));
      const nextVal = decimals > 0 ? Number(nextRaw.toFixed(decimals)) : Math.round(nextRaw);
      return {...prev, [field]: nextVal};
    });
  };

  const resetFormForNextPatient = () => {
    setPatientName('');
    setPatientAge('35');
    setPatientGender('F');
    setAbhaNumber('');
    setClinicalNoteInput('');
    setVitals({
      systolic: 120,
      diastolic: 80,
      spo2: 98,
      temperature: 98.6,
      heartRate: 76,
    });
    setSymptoms([]);
    setEdgeAi({anemiaSuspected: false, respiratoryRiskHigh: false});
    setLastVoiceTranscript('');
    setFormError(null);
  };

  const buildRecord = (isEmergencySms: boolean): TriageRecord => {
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
    const parsedAge = Math.min(115, Math.max(1, Number(patientAge) || 35));
    const uniqueSuffix =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10);

    return {
      id: `rec-${Date.now()}-${uniqueSuffix}`,
      patientId: nextPatientId,
      abhaId: abhaNumber.trim() || 'Not provided',
      patientName: patientName.trim(),
      age: parsedAge,
      gender: patientGender,
      villageCode,
      villageName: clinicMeta.name,
      ashaWorker: `${ashaDisplayName} (${ashaId})`,
      vitals: {...vitals},
      symptoms: [...symptoms],
      edgeAi: {...edgeAi},
      severity: triage.severity,
      clinicalNotes:
        clinicalNoteInput.trim() ||
        (lastVoiceTranscript ? `Voice note: "${lastVoiceTranscript}"` : triage.protocolEn),
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
    setFormError(null);
    if (!patientName.trim()) {
      setFormError('Please enter the patient’s name before saving this checkup.');
      return;
    }

    if (networkState === 'offline' && triage.severity === 'emergency') {
      setSmsGatewayFeedback(null);
      setSmsModalOpen(true);
      return;
    }

    const record = buildRecord(false);
    onSaveRecord(record, false);

    if (networkState === 'offline') {
      setFeedbackNotice(
        `Saved privately on this device for ${record.patientName}. It will sync automatically when internet returns.`
      );
    } else if (triage.severity === 'emergency') {
      setFeedbackNotice(
        `Urgent checkup saved for ${record.patientName} and shared immediately with the hospital doctor.`
      );
    } else {
      setFeedbackNotice(`Checkup saved for ${record.patientName}.`);
    }

    resetFormForNextPatient();
    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current);
    }
    feedbackTimerRef.current = window.setTimeout(() => {
      feedbackTimerRef.current = null;
      if (isMountedRef.current) {
        setFeedbackNotice(null);
      }
    }, 6000);
  };

  const handleConfirmSendEmergencySms = async () => {
    if (!patientName.trim()) {
      setFormError('Please enter the patient’s name first.');
      setSmsModalOpen(false);
      return;
    }

    const record = buildRecord(true);
    onSaveRecord(record, true);

    if (networkState === 'offline' || sessionToken === 'OFFLINE_LOCAL_SESSION') {
      setSmsGatewayFeedback({
        sent: false,
        message:
          'Checkup saved on this device. Because internet is offline, tap "Open Phone Text Message App" below to send the urgent code over basic cellular signal.',
        nativeUri: defaultNativeSmsUri,
      });
      resetFormForNextPatient();
      return;
    }

    setSendingGatewaySms(true);
    try {
      const resp = await fetch('/api/sms/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          payloadText: bitPacked28CharSms,
          recordId: record.id,
        }),
      });
      const data = (await resp.json()) as {
        sent?: boolean;
        statusMessage?: string;
        nativeSmsUri?: string;
      };
      if (!isMountedRef.current) return;
      setSmsGatewayFeedback({
        sent: Boolean(data.sent),
        message: data.statusMessage || 'Urgent SMS request processed.',
        nativeUri: data.nativeSmsUri || defaultNativeSmsUri,
      });
      resetFormForNextPatient();
    } catch {
      if (!isMountedRef.current) return;
      setSmsGatewayFeedback({
        sent: false,
        message:
          'Could not reach server SMS service. Tap "Open Phone Text Message App" below to send directly from your phone.',
        nativeUri: defaultNativeSmsUri,
      });
    } finally {
      if (isMountedRef.current) {
        setSendingGatewaySms(false);
      }
    }
  };

  const systolicStatus = evaluateVitalStatus('systolic', vitals.systolic);
  const diastolicStatus = evaluateVitalStatus('diastolic', vitals.diastolic);
  const spo2Status = evaluateVitalStatus('spo2', vitals.spo2);
  const tempStatus = evaluateVitalStatus('temperature', vitals.temperature);
  const pulseStatus = evaluateVitalStatus('heartRate', vitals.heartRate);

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 pb-24 sm:px-6 md:pb-10">
      {/* Workspace Header */}
      <div className="mb-6 flex flex-col justify-between gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-center">
        <div>
          <p className="text-xs font-medium text-slate-500">
            {clinicMeta.name} · {ashaDisplayName} ({ashaId})
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
            {activeTab === 'checkup'
              ? 'Patient Health Checkup'
              : activeTab === 'records'
              ? 'Saved Patient Checkups'
              : activeTab === 'assistant'
              ? 'Voice Input & Care Helper'
              : 'Completed Visits & Stipend'}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {activeTab === 'checkup' && (
            <button
              type="button"
              onClick={() => setSaheliModalOpen(true)}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap cursor-pointer"
            >
              <Mic className="h-4 w-4 text-teal-700 shrink-0" />
              <span>Fill by Voice</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => onSelectTab('activity')}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap cursor-pointer tabular-nums"
          >
            <Award className="h-4 w-4 text-teal-700 shrink-0" />
            <span>Stipend Log: ₹{totalIncentiveInr}</span>
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedbackNotice && (
        <div
          role="status"
          className="mb-6 flex items-start justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950"
        >
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
            <span>{feedbackNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedbackNotice(null)}
            aria-label="Dismiss message"
            className="text-emerald-800 hover:text-emerald-950 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* TAB 1: NEW PATIENT CHECKUP */}
      {activeTab === 'checkup' && (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 items-start">
          {/* Left 7 Columns: Simple, Clear Form */}
          <div className="lg:col-span-7 space-y-6">
            {formError && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"
              >
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
                <span>{formError}</span>
              </div>
            )}

            {lastVoiceTranscript && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-teal-200 bg-teal-50/70 px-4 py-3 text-xs text-teal-950">
                <span>
                  <strong className="font-semibold">Filled from voice:</strong> “{lastVoiceTranscript}”
                </span>
                <button
                  type="button"
                  onClick={() => setLastVoiceTranscript('')}
                  className="text-xs font-semibold text-teal-800 hover:underline shrink-0 cursor-pointer"
                >
                  Clear
                </button>
              </div>
            )}

            {/* Section 1: Basic Patient Information */}
            <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 space-y-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">1. Patient Details</h2>
                <p className="text-xs text-slate-600">
                  Enter the patient&apos;s name and age. Health ID is optional and kept private.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
                <div className="sm:col-span-7">
                  <label
                    htmlFor="pt-name-input"
                    className="mb-1.5 block text-sm font-medium text-slate-800"
                  >
                    Patient Full Name <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="pt-name-input"
                    type="text"
                    value={patientName}
                    onChange={(e) => {
                      setPatientName(e.target.value);
                      if (formError) setFormError(null);
                    }}
                    placeholder="e.g. Sunita Kumari"
                    className="min-h-[48px] w-full rounded-xl border border-slate-300 bg-white px-3.5 text-base text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label
                    htmlFor="pt-age-input"
                    className="mb-1.5 block text-sm font-medium text-slate-800"
                  >
                    Age
                  </label>
                  <input
                    id="pt-age-input"
                    type="number"
                    min={1}
                    max={115}
                    value={patientAge}
                    onChange={(e) => setPatientAge(e.target.value)}
                    className="min-h-[48px] w-full rounded-xl border border-slate-300 bg-white px-3 text-base font-semibold text-slate-900 tabular-nums focus:border-teal-700 focus:outline-none"
                  />
                </div>

                <div className="sm:col-span-3">
                  <label
                    htmlFor="pt-gender-select"
                    className="mb-1.5 block text-sm font-medium text-slate-800"
                  >
                    Gender
                  </label>
                  <select
                    id="pt-gender-select"
                    value={patientGender}
                    onChange={(e) => setPatientGender(e.target.value as 'F' | 'M' | 'O')}
                    className="min-h-[48px] w-full rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 focus:border-teal-700 focus:outline-none"
                  >
                    <option value="F">Female</option>
                    <option value="M">Male</option>
                    <option value="O">Other</option>
                  </select>
                </div>
              </div>

              <div>
                <label
                  htmlFor="pt-abha-input"
                  className="mb-1.5 block text-sm font-medium text-slate-800"
                >
                  ABHA Health ID <span className="font-normal text-slate-500">(Optional)</span>
                </label>
                <input
                  id="pt-abha-input"
                  type="text"
                  value={abhaNumber}
                  onChange={(e) => setAbhaNumber(e.target.value)}
                  placeholder="e.g. 91-0000-0000-0000"
                  className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3.5 font-mono text-sm text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:border-teal-700 focus:outline-none"
                />
              </div>
            </section>

            {/* Section 2: Vital Signs in Plain Language */}
            <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 space-y-5">
              <div>
                <h2 className="text-base font-bold text-slate-900">2. Vital Signs</h2>
                <p className="text-xs text-slate-600">
                  Type numbers directly or tap the minus and plus buttons to adjust.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Systolic BP */}
                <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="vital-sys"
                      className="text-sm font-semibold text-slate-900"
                    >
                      BP — Top (Systolic)
                    </label>
                    <StatusBadgeText severity={systolicStatus} />
                  </div>
                  <p className="text-xs text-slate-500">Normal range: 90–120 mmHg</p>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => adjustVital('systolic', -2, 50, 260)}
                      aria-label="Decrease systolic blood pressure"
                      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 cursor-pointer"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <input
                      id="vital-sys"
                      type="number"
                      min={50}
                      max={260}
                      value={vitals.systolic}
                      onChange={(e) =>
                        setVitals((prev) => ({...prev, systolic: Number(e.target.value)}))
                      }
                      className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 text-center font-mono text-lg font-semibold text-slate-900 tabular-nums focus:border-teal-700 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => adjustVital('systolic', 2, 50, 260)}
                      aria-label="Increase systolic blood pressure"
                      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 cursor-pointer"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Diastolic BP */}
                <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="vital-dia"
                      className="text-sm font-semibold text-slate-900"
                    >
                      BP — Bottom (Diastolic)
                    </label>
                    <StatusBadgeText severity={diastolicStatus} />
                  </div>
                  <p className="text-xs text-slate-500">Normal range: 60–80 mmHg</p>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => adjustVital('diastolic', -2, 35, 170)}
                      aria-label="Decrease diastolic blood pressure"
                      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 cursor-pointer"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <input
                      id="vital-dia"
                      type="number"
                      min={35}
                      max={170}
                      value={vitals.diastolic}
                      onChange={(e) =>
                        setVitals((prev) => ({...prev, diastolic: Number(e.target.value)}))
                      }
                      className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 text-center font-mono text-lg font-semibold text-slate-900 tabular-nums focus:border-teal-700 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => adjustVital('diastolic', 2, 35, 170)}
                      aria-label="Increase diastolic blood pressure"
                      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 cursor-pointer"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Blood Oxygen SpO2 */}
                <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="vital-spo2"
                      className="text-sm font-semibold text-slate-900"
                    >
                      Blood Oxygen (SpO₂ %)
                    </label>
                    <StatusBadgeText severity={spo2Status} />
                  </div>
                  <p className="text-xs text-slate-500">Normal range: 95–100%</p>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => adjustVital('spo2', -1, 50, 100)}
                      aria-label="Decrease blood oxygen"
                      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 cursor-pointer"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <input
                      id="vital-spo2"
                      type="number"
                      min={50}
                      max={100}
                      value={vitals.spo2}
                      onChange={(e) =>
                        setVitals((prev) => ({...prev, spo2: Number(e.target.value)}))
                      }
                      className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 text-center font-mono text-lg font-semibold text-slate-900 tabular-nums focus:border-teal-700 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => adjustVital('spo2', 1, 50, 100)}
                      aria-label="Increase blood oxygen"
                      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 cursor-pointer"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Body Temperature */}
                <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="vital-temp"
                      className="text-sm font-semibold text-slate-900"
                    >
                      Temperature (°F)
                    </label>
                    <StatusBadgeText severity={tempStatus} />
                  </div>
                  <p className="text-xs text-slate-500">Normal range: 97.0–99.5°F</p>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => adjustVital('temperature', -0.2, 93, 109, 1)}
                      aria-label="Decrease body temperature"
                      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 cursor-pointer"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <input
                      id="vital-temp"
                      type="number"
                      step="0.1"
                      min={93}
                      max={109}
                      value={vitals.temperature}
                      onChange={(e) =>
                        setVitals((prev) => ({...prev, temperature: Number(e.target.value)}))
                      }
                      className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 text-center font-mono text-lg font-semibold text-slate-900 tabular-nums focus:border-teal-700 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => adjustVital('temperature', 0.2, 93, 109, 1)}
                      aria-label="Increase body temperature"
                      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 cursor-pointer"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Pulse Rate */}
              <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <label htmlFor="vital-hr" className="text-sm font-semibold text-slate-900">
                      Pulse (Heartbeats per minute)
                    </label>
                    <StatusBadgeText severity={pulseStatus} />
                  </div>
                  <p className="text-xs text-slate-500">Normal resting range: 60–100 bpm</p>
                </div>

                <div className="flex items-center gap-2 sm:w-52">
                  <button
                    type="button"
                    onClick={() => adjustVital('heartRate', -2, 35, 220)}
                    aria-label="Decrease pulse"
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 cursor-pointer"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <input
                    id="vital-hr"
                    type="number"
                    min={35}
                    max={220}
                    value={vitals.heartRate}
                    onChange={(e) =>
                      setVitals((prev) => ({...prev, heartRate: Number(e.target.value)}))
                    }
                    className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 text-center font-mono text-base font-semibold text-slate-900 tabular-nums focus:border-teal-700 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => adjustVital('heartRate', 2, 35, 220)}
                    aria-label="Increase pulse"
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 cursor-pointer"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </section>

            {/* Section 3: Symptoms */}
            <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 space-y-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">3. Current Symptoms</h2>
                <p className="text-xs text-slate-600">
                  Select any symptoms the patient is experiencing today.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {SYMPTOM_OPTIONS.map((opt) => {
                  const checked = symptoms.includes(opt.key);
                  return (
                    <label
                      key={opt.key}
                      className={`flex min-h-[52px] cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors ${
                        checked
                          ? 'border-teal-700 bg-teal-50/60 text-slate-900'
                          : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSymptom(opt.key)}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-teal-700"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">{opt.label}</span>
                        <span className="block text-xs text-slate-500">{opt.helper}</span>
                      </span>
                    </label>
                  );
                })}
              </div>

              <div>
                <label
                  htmlFor="pt-notes-input"
                  className="mb-1.5 block text-sm font-medium text-slate-800"
                >
                  Short Care Note <span className="font-normal text-slate-500">(Optional)</span>
                </label>
                <textarea
                  id="pt-notes-input"
                  rows={2}
                  value={clinicalNoteInput}
                  onChange={(e) => setClinicalNoteInput(e.target.value)}
                  placeholder="Any helpful context for the doctor (e.g. pregnant 7 months, taking BP medicine)..."
                  className="w-full rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none"
                />
              </div>
            </section>

            {/* Section 4: Optional Camera & Cough Observation (Collapsible to prevent clutter) */}
            <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
              <button
                type="button"
                onClick={() => setShowOptionalScreening((prev) => !prev)}
                aria-expanded={showOptionalScreening}
                className="flex min-h-[44px] w-full items-center justify-between gap-3 text-left cursor-pointer"
              >
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    4. Optional Camera &amp; Cough Check
                  </h2>
                  <p className="text-xs text-slate-600">
                    {edgeAi.anemiaSuspected || edgeAi.respiratoryRiskHigh
                      ? 'Observation recorded — tap to review or reset'
                      : 'Open only if you want to check eyelid paleness or cough sound'}
                  </p>
                </div>
                {showOptionalScreening ? (
                  <ChevronUp className="h-5 w-5 shrink-0 text-slate-500" />
                ) : (
                  <ChevronDown className="h-5 w-5 shrink-0 text-slate-500" />
                )}
              </button>

              {showOptionalScreening && (
                <div className="mt-4 border-t border-slate-200 pt-4">
                  <EdgeAiDiagnosticsPanel diagnostics={edgeAi} onChange={setEdgeAi} />
                </div>
              )}
            </section>
          </div>

          {/* Right 5 Columns: Live Plain-Language Health Summary & Save Actions */}
          <div className="lg:col-span-5 lg:sticky lg:top-20 space-y-4">
            <section
              className={`rounded-2xl border p-5 sm:p-6 space-y-4 ${
                triage.severity === 'emergency'
                  ? 'border-red-200 bg-red-50/70'
                  : triage.severity === 'moderate'
                  ? 'border-amber-200 bg-amber-50/70'
                  : 'border-slate-200 bg-white'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-slate-600">Health Assessment</p>
                  <div className="mt-1 flex items-center gap-2">
                    {triage.severity === 'emergency' ? (
                      <>
                        <AlertCircle className="h-5 w-5 shrink-0 text-red-600" />
                        <h2 className="text-lg font-bold text-red-900">Urgent Care Needed</h2>
                      </>
                    ) : triage.severity === 'moderate' ? (
                      <>
                        <AlertTriangle className="h-5 w-5 shrink-0 text-amber-700" />
                        <h2 className="text-lg font-bold text-amber-950">Needs Doctor Review</h2>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-700" />
                        <h2 className="text-lg font-bold text-slate-900">Within Normal Range</h2>
                      </>
                    )}
                  </div>
                </div>

                <span className="font-mono text-xs text-slate-600 tabular-nums">
                  {vitals.systolic}/{vitals.diastolic} · {vitals.spo2}%
                </span>
              </div>

              <p className="text-sm leading-relaxed text-slate-700">{triage.protocolEn}</p>

              {/* Plain-Language Reasons */}
              <div className="border-t border-slate-200/80 pt-3.5">
                <p className="mb-2 text-xs font-semibold text-slate-700">What we noticed:</p>
                <ul className="space-y-1.5 text-xs text-slate-700">
                  {triage.triggers.map((reason, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span aria-hidden="true" className="text-slate-400">
                        •
                      </span>
                      <span>{reason}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {triage.severity === 'emergency' && networkState === 'offline' && (
                <div className="rounded-xl border border-red-200 bg-white p-3.5 text-xs leading-relaxed text-red-900">
                  <strong>Offline Urgent Care:</strong> Because internet is off, tapping below will
                  save this checkup and open a compact emergency text message (SMS) you can send to
                  the hospital over basic mobile signal.
                </div>
              )}

              {/* Primary Action Buttons (48px touch targets) */}
              <div className="space-y-2.5 pt-2">
                <button
                  type="button"
                  onClick={handlePrimarySaveClick}
                  className={`flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white transition-colors whitespace-nowrap cursor-pointer ${
                    triage.severity === 'emergency'
                      ? 'bg-red-600 hover:bg-red-700'
                      : 'bg-teal-700 hover:bg-teal-800'
                  }`}
                >
                  <Save className="h-4 w-4 shrink-0" />
                  <span>
                    {triage.severity === 'emergency' && networkState === 'offline'
                      ? 'Save & Prepare Urgent SMS'
                      : 'Save Patient Checkup'}
                  </span>
                </button>

                {triage.severity === 'emergency' && networkState !== 'offline' && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!patientName.trim()) {
                        setFormError('Please enter the patient’s name before sending an SMS alert.');
                        return;
                      }
                      setSmsGatewayFeedback(null);
                      setSmsModalOpen(true);
                    }}
                    className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl border border-red-300 bg-white px-4 py-2.5 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50 whitespace-nowrap cursor-pointer"
                  >
                    <Send className="h-4 w-4 shrink-0" />
                    <span>Also Send Backup Text Message (SMS)</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={resetFormForNextPatient}
                  className="flex min-h-[42px] w-full items-center justify-center rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
                >
                  Reset Form
                </button>
              </div>
            </section>
          </div>
        </div>
      )}

      {/* TAB 2: SAVED PATIENT RECORDS */}
      {activeTab === 'records' && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="search"
                value={recordSearch}
                onChange={(e) => setRecordSearch(e.target.value)}
                placeholder="Search by patient name or ID..."
                className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white pl-10 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setRevealHealthIds((prev) => !prev)}
                className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                {revealHealthIds ? (
                  <>
                    <EyeOff className="h-3.5 w-3.5 text-slate-500" />
                    <span>Mask Health IDs</span>
                  </>
                ) : (
                  <>
                    <Eye className="h-3.5 w-3.5 text-slate-500" />
                    <span>Show Health IDs</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => onSelectTab('checkup')}
                className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 whitespace-nowrap cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                <span>New Checkup</span>
              </button>
            </div>
          </div>

          {isLoadingRecords ? (
            <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-6">
              <div className="h-14 animate-pulse rounded-xl bg-slate-100" />
              <div className="h-14 animate-pulse rounded-xl bg-slate-100" />
              <div className="h-14 animate-pulse rounded-xl bg-slate-100" />
            </div>
          ) : filteredRecords.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
                <ClipboardList className="h-6 w-6" />
              </div>
              <h2 className="mt-3 text-base font-semibold text-slate-900">
                {records.length === 0
                  ? 'No patient checkups saved yet'
                  : 'No matching patient records'}
              </h2>
              <p className="mt-1 max-w-sm text-sm text-slate-600">
                {records.length === 0
                  ? 'Start a patient checkup to record blood pressure, oxygen, and symptoms safely on this device.'
                  : 'Try clearing your search filter to see all saved checkups.'}
              </p>
              {records.length === 0 && (
                <button
                  type="button"
                  onClick={() => onSelectTab('checkup')}
                  className="mt-5 min-h-[44px] rounded-xl bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 cursor-pointer"
                >
                  Start First Checkup
                </button>
              )}
            </div>
          ) : (
            <div
              ref={savedRecordsVirtual.containerRef}
              onScroll={savedRecordsVirtual.handleScroll}
              className="custom-scrollbar max-h-[560px] overflow-y-auto rounded-2xl border border-slate-200 bg-white"
            >
              <div ref={savedRecordsVirtual.topSpacerRef} aria-hidden="true" />
              <div className="divide-y divide-slate-200">
                {filteredRecords
                  .slice(savedRecordsVirtual.startIndex, savedRecordsVirtual.endIndex)
                  .map((rec) => (
                    <div
                      key={rec.id}
                      className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-base font-semibold text-slate-900">
                            {rec.patientName}
                          </h3>
                          <span className="text-xs text-slate-500">
                            · {rec.age} yrs · {rec.patientId}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 tabular-nums">
                          BP {rec.vitals.systolic}/{rec.vitals.diastolic} mmHg · Oxygen{' '}
                          {rec.vitals.spo2}% · Temp {rec.vitals.temperature}°F · Pulse{' '}
                          {rec.vitals.heartRate} bpm
                        </p>
                        <p className="text-xs text-slate-500">
                          {rec.timestamp} · {rec.syncStatus} · Health ID:{' '}
                          <span className="font-mono">
                            {revealHealthIds ? rec.abhaId : maskHealthId(rec.abhaId)}
                          </span>
                          {rec.dispatchStatus === 'Dispatched'
                            ? ` · Ambulance on the way (${rec.etaMinutes ?? 11} min)`
                            : ''}
                        </p>
                      </div>

                      <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end">
                        <StatusBadgeText severity={rec.severity} />
                      </div>
                    </div>
                  ))}
              </div>
              <div ref={savedRecordsVirtual.bottomSpacerRef} aria-hidden="true" />
            </div>
          )}
        </div>
      )}

      {/* TAB 3: VOICE HELPER (INLINE) */}
      {activeTab === 'assistant' && (
        <div className="max-w-3xl">
          <AshaSaheliModal
            open={true}
            inline={true}
            onClose={() => onSelectTab('checkup')}
            sessionToken={sessionToken}
            networkState={networkState}
            currentVitals={vitals}
            currentSymptoms={symptoms}
            currentEdgeAi={edgeAi}
            patientName={patientName}
            patientAge={Number(patientAge) || 35}
            onApplyVoiceEntities={applyVoiceEntities}
          />
        </div>
      )}

      {/* TAB 4: ACTIVITY & STIPEND LOG (INLINE) */}
      {activeTab === 'activity' && (
        <div className="max-w-3xl">
          <IncentiveLedgerModal
            open={true}
            inline={true}
            workerName={ashaDisplayName}
            onClose={() => onSelectTab('checkup')}
            onStartCheckup={() => onSelectTab('checkup')}
            entries={incentives}
          />
        </div>
      )}

      {/* MOBILE BOTTOM NAVIGATION BAR (< md, natural thumb zone) */}
      <nav
        aria-label="Mobile Navigation"
        className="fixed bottom-0 left-0 right-0 z-30 grid h-16 grid-cols-4 items-center border-t border-slate-200 bg-white/95 backdrop-blur-md pb-safe md:hidden"
      >
        <button
          type="button"
          onClick={() => onSelectTab('checkup')}
          className={`flex h-full flex-col items-center justify-center gap-0.5 cursor-pointer ${
            activeTab === 'checkup' ? 'text-teal-700 font-semibold' : 'text-slate-500'
          }`}
        >
          <HeartPulse className="h-5 w-5" />
          <span className="text-[11px] whitespace-nowrap">Checkup</span>
        </button>

        <button
          type="button"
          onClick={() => onSelectTab('records')}
          className={`flex h-full flex-col items-center justify-center gap-0.5 cursor-pointer ${
            activeTab === 'records' ? 'text-teal-700 font-semibold' : 'text-slate-500'
          }`}
        >
          <ClipboardList className="h-5 w-5" />
          <span className="text-[11px] whitespace-nowrap">
            Records{pendingOfflineCount > 0 ? ` (${pendingOfflineCount})` : ''}
          </span>
        </button>

        <button
          type="button"
          onClick={() => onSelectTab('assistant')}
          className={`flex h-full flex-col items-center justify-center gap-0.5 cursor-pointer ${
            activeTab === 'assistant' ? 'text-teal-700 font-semibold' : 'text-slate-500'
          }`}
        >
          <Stethoscope className="h-5 w-5" />
          <span className="text-[11px] whitespace-nowrap">Voice</span>
        </button>

        <button
          type="button"
          onClick={() => onSelectTab('activity')}
          className={`flex h-full flex-col items-center justify-center gap-0.5 cursor-pointer ${
            activeTab === 'activity' ? 'text-teal-700 font-semibold' : 'text-slate-500'
          }`}
        >
          <Award className="h-5 w-5" />
          <span className="text-[11px] whitespace-nowrap">Visits</span>
        </button>
      </nav>

      {/* Voice Helper Modal (when opened from Checkup button) */}
      <AshaSaheliModal
        open={saheliModalOpen}
        onClose={() => setSaheliModalOpen(false)}
        sessionToken={sessionToken}
        networkState={networkState}
        currentVitals={vitals}
        currentSymptoms={symptoms}
        currentEdgeAi={edgeAi}
        patientName={patientName}
        patientAge={Number(patientAge) || 35}
        onApplyVoiceEntities={applyVoiceEntities}
      />

      {/* Emergency Text Message (SMS) Modal */}
      {smsModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sms-modal-title"
        >
          <div className="custom-scrollbar max-h-[88vh] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-50 text-red-600">
                  <AlertCircle className="h-5 w-5 shrink-0" />
                </div>
                <div>
                  <h3 id="sms-modal-title" className="text-base font-bold text-slate-900">
                    Send Urgent Text Alert (SMS)
                  </h3>
                  <p className="text-xs text-slate-600">
                    Reaches the hospital even without mobile internet
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSmsModalOpen(false)}
                className="flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
                aria-label="Close SMS dialog"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs text-slate-600">
                  <span className="font-semibold text-slate-800">Compact SMS Code</span>
                  <span className="font-mono tabular-nums">{bitPacked28CharSms.length} chars</span>
                </div>
                <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 font-mono text-sm font-semibold text-slate-900">
                  <span className="truncate">{bitPacked28CharSms}</span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(bitPacked28CharSms);
                      setCopiedPayload(true);
                      if (copyTimerRef.current !== null) {
                        window.clearTimeout(copyTimerRef.current);
                      }
                      copyTimerRef.current = window.setTimeout(() => {
                        copyTimerRef.current = null;
                        if (isMountedRef.current) {
                          setCopiedPayload(false);
                        }
                      }, 2000);
                    }}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 font-sans text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    <span>{copiedPayload ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-700">
                <p className="font-semibold text-slate-800">Readable Summary Format</p>
                <p className="mt-1 font-mono text-slate-900 break-all">{compactSmsTag}</p>
              </div>

              {smsGatewayFeedback && (
                <div
                  className={`rounded-xl border p-3.5 text-xs leading-relaxed ${
                    smsGatewayFeedback.sent
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
                      : 'border-amber-200 bg-amber-50 text-amber-950'
                  }`}
                >
                  {smsGatewayFeedback.message}
                </div>
              )}

              <div className="space-y-2.5">
                <button
                  type="button"
                  disabled={sendingGatewaySms}
                  onClick={handleConfirmSendEmergencySms}
                  className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-60 cursor-pointer"
                >
                  <Send className="h-4 w-4" />
                  <span>
                    {sendingGatewaySms ? 'Sending Urgent SMS...' : 'Send via Hospital SMS Service'}
                  </span>
                </button>

                <a
                  href={smsGatewayFeedback?.nativeUri || defaultNativeSmsUri}
                  className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50"
                >
                  <ExternalLink className="h-4 w-4 text-teal-700" />
                  <span>Open Phone Text Message App</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
