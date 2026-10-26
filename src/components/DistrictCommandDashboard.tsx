import {useState, useEffect, useMemo} from 'react';
import {
  Activity,
  AlertTriangle,
  Ambulance,
  CheckCircle2,
  Clock,
  Cpu,
  Download,
  Eye,
  Filter,
  HeartPulse,
  MapPin,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
  Terminal,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {SeverityLevel, SyncChannel, TriageRecord} from '../types/triage';
import {VILLAGE_SUB_CENTERS} from '../data/initialData';
import {decodeSMSPayload} from '../utils/binarySmsCodec';
import {BinarySmsDecoderDrawer} from './BinarySmsDecoderDrawer';

interface DistrictCommandDashboardProps {
  dmoEmail: string;
  records: TriageRecord[];
  activeEmergencyBanner: TriageRecord | null;
  isSirenRinging: boolean;
  onAcknowledgeEmergency: () => void;
  onTestSiren: () => void;
  onDispatchAmbulance: (recordId: string) => void;
  onSyncOfflineQueue: () => number;
}

export function DistrictCommandDashboard({
  dmoEmail,
  records,
  activeEmergencyBanner,
  isSirenRinging,
  onAcknowledgeEmergency,
  onTestSiren,
  onDispatchAmbulance,
  onSyncOfflineQueue,
}: DistrictCommandDashboardProps) {
  const [clockText, setClockText] = useState<string>('');
  const [selectedVillageCode, setSelectedVillageCode] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [severityFilter, setSeverityFilter] = useState<'ALL' | SeverityLevel>('ALL');
  const [channelFilter, setChannelFilter] = useState<'ALL' | SyncChannel>('ALL');
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  // Live "Paste SMS Payload to Test Decoder" state
  const [pasteSmsInput, setPasteSmsInput] = useState<string>(
    () => records[0]?.binarySmsPayload ?? ''
  );

  // Drawer state for inspecting full binary unpack or ABDM FHIR vitals payload
  const [drawerState, setDrawerState] = useState<{
    isOpen: boolean;
    record: TriageRecord | null;
    initialPayload?: string;
    mode: 'decode' | 'vitals';
  }>({
    isOpen: false,
    record: null,
    mode: 'decode',
  });

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setClockText(
        now.toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        })
      );
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  // Keep default test decoder input populated if empty when records arrive
  useEffect(() => {
    if (!pasteSmsInput && records.length > 0) {
      setPasteSmsInput(records[0].binarySmsPayload);
    }
  }, [records, pasteSmsInput]);

  const inlineDecoded = useMemo(
    () => (pasteSmsInput.trim() ? decodeSMSPayload(pasteSmsInput) : null),
    [pasteSmsInput]
  );

  // Real-time KPI Metrics
  const totalScreenings = records.length;
  const pendingSyncs = records.filter((r) => r.syncStatus === 'Queued Offline').length;
  const moderateYellowCount = records.filter((r) => r.severity === 'moderate').length;
  const criticalRedRecords = records.filter((r) => r.severity === 'emergency');
  const unassignedRedCount = criticalRedRecords.filter(
    (r) => r.dispatchStatus === 'Unassigned'
  ).length;

  // Village Sub-Center aggregation for interactive SVG map
  const villageStats = useMemo(() => {
    return VILLAGE_SUB_CENTERS.map((village) => {
      const vilRecords = records.filter((r) => r.villageCode === village.code);
      const redCount = vilRecords.filter((r) => r.severity === 'emergency').length;
      const openRedCount = vilRecords.filter(
        (r) => r.severity === 'emergency' && r.dispatchStatus === 'Unassigned'
      ).length;
      const yellowCount = vilRecords.filter((r) => r.severity === 'moderate').length;

      const highestRisk: SeverityLevel =
        redCount > 0 ? 'emergency' : yellowCount > 0 ? 'moderate' : 'routine';

      return {
        ...village,
        totalCases: vilRecords.length,
        redCount,
        openRedCount,
        yellowCount,
        highestRisk,
      };
    });
  }, [records]);

  const selectedVillageDetail = villageStats.find((v) => v.code === selectedVillageCode) || null;

  // High-Priority Alert Feed sorted with Critical RED unassigned first
  const priorityAlertFeed = useMemo(() => {
    return [...records]
      .filter((r) =>
        selectedVillageCode ? r.villageCode === selectedVillageCode : true
      )
      .sort((a, b) => {
        const score = (rec: TriageRecord) => {
          if (rec.severity === 'emergency' && rec.dispatchStatus === 'Unassigned') return 4;
          if (rec.severity === 'emergency') return 3;
          if (rec.severity === 'moderate') return 2;
          return 1;
        };
        const diff = score(b) - score(a);
        if (diff !== 0) return diff;
        return b.createdAtMs - a.createdAtMs;
      });
  }, [records, selectedVillageCode]);

  // Longitudinal Registry Table filtering
  const filteredTableRecords = useMemo(() => {
    return records.filter((r) => {
      if (selectedVillageCode && r.villageCode !== selectedVillageCode) return false;
      if (severityFilter !== 'ALL' && r.severity !== severityFilter) return false;
      if (channelFilter !== 'ALL' && r.channel !== channelFilter) return false;
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        const hay =
          `${r.patientId} ${r.patientName} ${r.villageCode} ${r.villageName} ${r.abhaId} ${r.ashaWorker} ${r.binarySmsPayload}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [records, selectedVillageCode, severityFilter, channelFilter, searchQuery]);

  const handleManualSyncFlush = () => {
    const flushed = onSyncOfflineQueue();
    setSyncNotice(
      flushed > 0
        ? `Synchronized ${flushed} queued field record(s) into District 24 Registry`
        : 'All sub-center queues are up to date (0 pending)'
    );
    window.setTimeout(() => setSyncNotice(null), 3500);
  };

  const handleExportCsv = () => {
    const headers = [
      'Patient_ID',
      'Patient_Name',
      'ABHA_ID',
      'Age',
      'Gender',
      'Village_Code',
      'Sub_Center',
      'ASHA_Worker',
      'BP_mmHg',
      'SpO2_Pct',
      'Temp_F',
      'HeartRate_BPM',
      'Symptoms',
      'Severity',
      'Channel',
      'Sync_Status',
      'Binary_SMS_Payload',
      'Dispatch_Status',
      'Timestamp',
    ];
    const rows = filteredTableRecords.map((r) => [
      r.patientId,
      `"${r.patientName.replace(/"/g, '""')}"`,
      r.abhaId,
      r.age,
      r.gender,
      r.villageCode,
      `"${r.villageName}"`,
      `"${r.ashaWorker}"`,
      `${r.vitals.systolic}/${r.vitals.diastolic}`,
      r.vitals.spo2,
      r.vitals.temperature.toFixed(1),
      r.vitals.heartRate,
      `"${r.symptoms.join('; ')}"`,
      r.severity.toUpperCase(),
      r.channel,
      r.syncStatus,
      r.binarySmsPayload,
      r.ambulanceUnit ? `${r.dispatchStatus} (${r.ambulanceUnit})` : r.dispatchStatus,
      r.timestamp,
    ]);
    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
    const blob = new Blob([csvContent], {type: 'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `healthsync_district24_registry_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-[calc(100vh-56px)] bg-[#F8FAFC] text-[#0F172A] flex flex-col">
      {/* FLASHING RED EMERGENCY BANNER + SIREN ACKNOWLEDGE BAR */}
      {(activeEmergencyBanner || isSirenRinging) && (
        <div
          role="alert"
          className="bg-[#EF4444] text-white border-b-2 border-red-900 shadow-lg animate-pulse"
        >
          <div className="max-w-[1440px] mx-auto px-4 lg:px-6 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start sm:items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-red-950/50 border border-white/30 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-6 h-6 text-white" />
              </div>
              <div>
                <p className="text-xs sm:text-sm font-black uppercase tracking-wider">
                  CRITICAL EMERGENCY RECEIVED FROM SUB-CENTER{' '}
                  {activeEmergencyBanner?.villageCode ?? 'VIL-204'}
                </p>
                {activeEmergencyBanner && (
                  <p className="text-xs font-medium text-red-100 mt-0.5">
                    Patient {activeEmergencyBanner.patientName} ({activeEmergencyBanner.patientId}) ·
                    BP {activeEmergencyBanner.vitals.systolic}/
                    {activeEmergencyBanner.vitals.diastolic} mmHg · SpO₂{' '}
                    {activeEmergencyBanner.vitals.spo2}% · Channel:{' '}
                    {activeEmergencyBanner.channel}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {activeEmergencyBanner &&
                activeEmergencyBanner.dispatchStatus === 'Unassigned' && (
                  <button
                    type="button"
                    onClick={() => onDispatchAmbulance(activeEmergencyBanner.id)}
                    className="h-10 px-4 rounded-lg bg-white text-red-700 hover:bg-red-50 text-xs font-black uppercase tracking-wider flex items-center gap-1.5 shadow-sm cursor-pointer transition-colors"
                  >
                    <Ambulance className="w-4 h-4" />
                    Dispatch 108 Now
                  </button>
                )}
              <button
                type="button"
                onClick={onAcknowledgeEmergency}
                className="h-10 px-4 rounded-lg bg-slate-950 hover:bg-slate-900 text-white border border-white/30 text-xs font-black uppercase tracking-wider flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                <VolumeX className="w-4 h-4 text-amber-300" />
                MUTE SIREN / ACKNOWLEDGE EMERGENCY
              </button>
            </div>
          </div>
        </div>
      )}

      {/* COMMAND SUB-HEADER */}
      <div className="bg-[#0F172A] text-white border-b border-slate-800">
        <div className="max-w-[1440px] mx-auto px-4 lg:px-6 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#0D9488] to-[#06B6D4] flex items-center justify-center shadow-sm">
              <HeartPulse className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-base sm:text-lg font-extrabold tracking-tight">
                  District 24 Triage Command Portal
                </h1>
                <span className="hidden md:inline-flex items-center gap-1 text-[11px] font-mono font-semibold text-teal-300 bg-teal-950/80 border border-teal-700/70 px-2 py-0.5 rounded">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  ABDM HICM NODE
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Officer on Duty: <span className="text-slate-200 font-semibold">{dmoEmail}</span> ·
                Live WebSocket + Baseband SMS Gateway Active
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Sync Queue Flush */}
            <button
              type="button"
              onClick={handleManualSyncFlush}
              className="h-9 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5 text-[#06B6D4]" />
              <span>Sync Health Check</span>
              {pendingSyncs > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono text-[10px]">
                  {pendingSyncs} queued
                </span>
              )}
            </button>

            {/* Test Web Audio Siren Button */}
            <button
              type="button"
              onClick={onTestSiren}
              className="h-9 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-cyan-300 flex items-center gap-1.5 cursor-pointer transition-colors"
              title="Trigger Web Audio API Hi-Lo Emergency Siren Burst"
            >
              <Volume2 className="w-3.5 h-3.5" />
              Test Siren Sound
            </button>

            {/* Live IST Clock */}
            <div className="h-9 px-3 rounded-lg bg-slate-900 border border-slate-800 flex items-center gap-1.5 text-xs font-mono text-slate-200 tabular-nums">
              <Clock className="w-3.5 h-3.5 text-teal-400" />
              <span>{clockText || '--:--:--'} IST</span>
            </div>

            {/* Red Alert Counter */}
            <div
              className={`h-9 px-3 rounded-lg flex items-center gap-2 text-xs font-extrabold border ${
                unassignedRedCount > 0
                  ? 'bg-red-600 text-white border-red-400 shadow-sm'
                  : 'bg-slate-800 text-slate-300 border-slate-700'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span className="tabular-nums">{unassignedRedCount} Open RED Alerts</span>
            </div>
          </div>
        </div>
      </div>

      {syncNotice && (
        <div className="bg-teal-900 text-teal-50 text-xs font-semibold px-4 py-2 text-center border-b border-teal-700">
          {syncNotice}
        </div>
      )}

      {/* MAIN CONTENT CONTAINER */}
      <main className="max-w-[1440px] w-full mx-auto px-4 lg:px-6 py-5 space-y-5 flex-1">
        {/* 1. METRICS ROW (4 KPI SUMMARY CARDS) */}
        <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex items-start justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Total Screenings Today
              </p>
              <p className="text-3xl font-black text-slate-900 tabular-nums mt-1.5">
                {totalScreenings}
              </p>
              <p className="text-xs text-teal-700 font-semibold mt-1">
                Across {VILLAGE_SUB_CENTERS.length} Rural Sub-Centers
              </p>
            </div>
            <div className="w-10 h-10 rounded-lg bg-teal-50 border border-teal-200 flex items-center justify-center text-[#0D9488]">
              <Activity className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex items-start justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Pending Syncs
              </p>
              <p className="text-3xl font-black text-slate-900 tabular-nums mt-1.5">
                {pendingSyncs}
              </p>
              <p className="text-xs text-slate-500 font-medium mt-1">
                Stored in local offline queue
              </p>
            </div>
            <div className="w-10 h-10 rounded-lg bg-cyan-50 border border-cyan-200 flex items-center justify-center text-[#06B6D4]">
              <Radio className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-white rounded-xl border border-amber-200/90 p-4 shadow-xs flex items-start justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-amber-700">
                Moderate Yellow Risk
              </p>
              <p className="text-3xl font-black text-amber-600 tabular-nums mt-1.5">
                {moderateYellowCount}
              </p>
              <p className="text-xs text-amber-800/80 font-medium mt-1">
                Same-day PHC MO tele-review
              </p>
            </div>
            <div className="w-10 h-10 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center text-[#F59E0B]">
              <Clock className="w-5 h-5" />
            </div>
          </div>

          <div
            className={`rounded-xl border p-4 shadow-xs flex items-start justify-between ${
              unassignedRedCount > 0
                ? 'bg-red-50/70 border-red-300'
                : 'bg-white border-slate-200'
            }`}
          >
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-red-700">
                Critical RED Emergencies
              </p>
              <div className="flex items-baseline gap-2 mt-1.5">
                <p className="text-3xl font-black text-[#EF4444] tabular-nums">
                  {criticalRedRecords.length}
                </p>
                <span className="text-xs font-bold text-red-700">
                  ({unassignedRedCount} awaiting 108)
                </span>
              </div>
              <p className="text-xs text-red-800/80 font-medium mt-1">
                Immediate 108 ALS dispatch SLA
              </p>
            </div>
            <div className="w-10 h-10 rounded-lg bg-red-100 border border-red-200 flex items-center justify-center text-[#EF4444]">
              <AlertTriangle className="w-5 h-5" />
            </div>
          </div>
        </section>

        {/* 2. LIVE BINARY SMS PAYLOAD TEST DECODER BAR */}
        <section className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 shrink-0">
              <div className="w-9 h-9 rounded-lg bg-slate-900 text-teal-400 flex items-center justify-center">
                <Terminal className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-xs font-extrabold uppercase tracking-wider text-slate-900">
                  Paste SMS Payload to Test Decoder
                </h2>
                <p className="text-[11px] text-slate-500">
                  Bitwise 18-byte Base64 (`HS#...`) unpacker + CRC-16-CCITT integrity verification
                </p>
              </div>
            </div>

            <div className="flex-1 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 max-w-3xl">
              <input
                type="text"
                value={pasteSmsInput}
                onChange={(e) => setPasteSmsInput(e.target.value)}
                placeholder="Paste HS# Base64 SMS frame (e.g. HS#...)"
                className="flex-1 h-10 px-3 rounded-lg bg-slate-950 text-teal-300 font-mono text-xs border border-slate-700 focus:outline-none focus:border-[#0D9488]"
              />
              <button
                type="button"
                onClick={() =>
                  setDrawerState({
                    isOpen: true,
                    record: null,
                    initialPayload: pasteSmsInput,
                    mode: 'decode',
                  })
                }
                className="h-10 px-4 rounded-lg bg-[#0D9488] hover:bg-teal-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 shrink-0 cursor-pointer transition-colors"
              >
                <Cpu className="w-3.5 h-3.5" />
                Inspect Full Byte Frame
              </button>
            </div>
          </div>

          {/* Inline Real-Time Decoded Output Preview */}
          {inlineDecoded && (
            <div
              className={`mt-3 rounded-lg border px-3.5 py-2.5 text-xs flex flex-wrap items-center justify-between gap-2 ${
                inlineDecoded.valid && inlineDecoded.crcValid
                  ? 'bg-slate-50 border-slate-200 text-slate-800'
                  : 'bg-red-50 border-red-200 text-red-800'
              }`}
            >
              {inlineDecoded.valid ? (
                <>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px]">
                    <span className="font-bold text-slate-900">
                      ID: {inlineDecoded.patientId} ({inlineDecoded.villageCode})
                    </span>
                    <span>
                      BP:{' '}
                      <strong className="text-slate-900">
                        {inlineDecoded.vitals.systolic}/{inlineDecoded.vitals.diastolic}
                      </strong>{' '}
                      mmHg
                    </span>
                    <span>
                      SpO₂:{' '}
                      <strong className="text-slate-900">{inlineDecoded.vitals.spo2}%</strong>
                    </span>
                    <span>
                      Temp:{' '}
                      <strong className="text-slate-900">
                        {inlineDecoded.vitals.temperature.toFixed(1)}°F
                      </strong>
                    </span>
                    <span>
                      HR:{' '}
                      <strong className="text-slate-900">
                        {inlineDecoded.vitals.heartRate} bpm
                      </strong>
                    </span>
                    <span>
                      Symptoms:{' '}
                      <strong className="text-slate-900">
                        {inlineDecoded.symptoms.length > 0
                          ? inlineDecoded.symptoms.join(', ')
                          : 'None'}
                      </strong>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded font-bold uppercase text-[10px] ${
                        inlineDecoded.severity === 'emergency'
                          ? 'bg-red-100 text-red-700 border border-red-300'
                          : inlineDecoded.severity === 'moderate'
                          ? 'bg-amber-100 text-amber-800 border border-amber-300'
                          : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                      }`}
                    >
                      {inlineDecoded.severity}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded font-mono font-bold text-[10px] ${
                        inlineDecoded.crcValid
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-red-200 text-red-900'
                      }`}
                    >
                      CRC16 {inlineDecoded.computedCrcHex}{' '}
                      {inlineDecoded.crcValid ? 'VALID' : 'TAMPERED'}
                    </span>
                  </div>
                </>
              ) : (
                <span className="font-semibold">
                  Decoder Error: {inlineDecoded.error}
                </span>
              )}
            </div>
          )}
        </section>

        {/* 3. MAIN 2-COLUMN COMMAND GRID: 60% SUB-CENTER MAP + 40% HIGH-PRIORITY ALERT FEED */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* LEFT 60% (7 cols): Interactive District 24 Village Sub-Center Telemetry Map */}
          <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="px-4 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-[#0D9488]" />
                <div>
                  <h2 className="text-sm font-extrabold text-slate-900">
                    District 24 Village Sub-Center Risk Telemetry Map
                  </h2>
                  <p className="text-[11px] text-slate-500">
                    Click any village pin to filter incoming emergency alerts & longitudinal records
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 text-[11px] font-semibold">
                <span className="flex items-center gap-1 text-emerald-700">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#10B981]" /> Routine
                </span>
                <span className="flex items-center gap-1 text-amber-700">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#F59E0B]" /> Moderate
                </span>
                <span className="flex items-center gap-1 text-red-700">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#EF4444]" /> Emergency
                </span>
                {selectedVillageCode && (
                  <button
                    type="button"
                    onClick={() => setSelectedVillageCode(null)}
                    className="ml-1 px-2 py-0.5 rounded bg-slate-900 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                  >
                    {selectedVillageCode} <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            {/* Interactive Topographic SVG Canvas */}
            <div className="relative bg-[#0F172A] aspect-[16/10] w-full overflow-hidden select-none">
              <svg
                viewBox="0 0 100 64"
                className="w-full h-full"
                aria-label="District 24 Sub-Center Interactive Map"
              >
                <defs>
                  <pattern
                    id="commandGrid"
                    width="8"
                    height="8"
                    patternUnits="userSpaceOnUse"
                  >
                    <path
                      d="M 8 0 L 0 0 0 8"
                      fill="none"
                      stroke="rgba(148,163,184,0.09)"
                      strokeWidth="0.25"
                    />
                  </pattern>
                </defs>

                <rect width="100" height="64" fill="url(#commandGrid)" />

                {/* District Boundary Polygon */}
                <path
                  d="M 9,14 L 30,6 L 64,8 L 91,17 L 88,49 L 61,58 L 24,55 L 8,38 Z"
                  fill="rgba(13,148,136,0.09)"
                  stroke="rgba(20,184,166,0.35)"
                  strokeWidth="0.45"
                />

                {/* River & Highway Corridors */}
                <path
                  d="M 5,28 Q 35,22 52,32 T 96,26"
                  fill="none"
                  stroke="rgba(6,182,212,0.28)"
                  strokeWidth="1.1"
                />
                <line
                  x1="50"
                  y1="31"
                  x2="24"
                  y2="20"
                  stroke="rgba(148,163,184,0.28)"
                  strokeDasharray="1.2,1.2"
                  strokeWidth="0.35"
                />
                <line
                  x1="50"
                  y1="31"
                  x2="75"
                  y2="18"
                  stroke="rgba(148,163,184,0.28)"
                  strokeDasharray="1.2,1.2"
                  strokeWidth="0.35"
                />
                <line
                  x1="50"
                  y1="31"
                  x2="31"
                  y2="46"
                  stroke="rgba(148,163,184,0.28)"
                  strokeDasharray="1.2,1.2"
                  strokeWidth="0.35"
                />
                <line
                  x1="50"
                  y1="31"
                  x2="74"
                  y2="44"
                  stroke="rgba(148,163,184,0.28)"
                  strokeDasharray="1.2,1.2"
                  strokeWidth="0.35"
                />

                {/* Central District 24 Tertiary Hospital Hub */}
                <g transform="translate(50, 31)">
                  <rect
                    x="-3"
                    y="-3"
                    width="6"
                    height="6"
                    rx="1.2"
                    fill="#0D9488"
                    stroke="#FFFFFF"
                    strokeWidth="0.5"
                  />
                  <text
                    x="0"
                    y="1"
                    textAnchor="middle"
                    fill="#FFFFFF"
                    fontSize="3.2"
                    fontWeight="bold"
                  >
                    H
                  </text>
                  <text
                    x="0"
                    y="6"
                    textAnchor="middle"
                    fill="#99F6E4"
                    fontSize="2.3"
                    fontWeight="bold"
                  >
                    DIST-24 HQ
                  </text>
                </g>

                {/* Sub-Center Pins */}
                {villageStats.map((v) => {
                  const mapY = Math.max(10, Math.min(54, v.y * 0.62));
                  const isSelected = selectedVillageCode === v.code;
                  const pinColor =
                    v.highestRisk === 'emergency'
                      ? '#EF4444'
                      : v.highestRisk === 'moderate'
                      ? '#F59E0B'
                      : '#10B981';

                  return (
                    <g
                      key={v.code}
                      transform={`translate(${v.x}, ${mapY})`}
                      onClick={() =>
                        setSelectedVillageCode(isSelected ? null : v.code)
                      }
                      className="cursor-pointer"
                    >
                      {v.openRedCount > 0 && (
                        <circle
                          r="5.2"
                          fill="none"
                          stroke="#EF4444"
                          strokeWidth="0.5"
                          opacity="0.75"
                        >
                          <animate
                            attributeName="r"
                            from="2.8"
                            to="6.8"
                            dur="1.4s"
                            repeatCount="indefinite"
                          />
                          <animate
                            attributeName="opacity"
                            from="0.9"
                            to="0"
                            dur="1.4s"
                            repeatCount="indefinite"
                          />
                        </circle>
                      )}

                      <circle
                        r={isSelected ? '3.3' : '2.6'}
                        fill={pinColor}
                        stroke="#FFFFFF"
                        strokeWidth={isSelected ? '0.8' : '0.45'}
                      />
                      <text
                        x="0"
                        y="-4.2"
                        textAnchor="middle"
                        fill="#F8FAFC"
                        fontSize="2.4"
                        fontWeight="bold"
                      >
                        {v.code}
                      </text>
                      <text
                        x="0"
                        y="5.6"
                        textAnchor="middle"
                        fill="#CBD5E1"
                        fontSize="2.1"
                      >
                        {v.name.replace('PHC ', '').replace('SC ', '')} ({v.totalCases})
                      </text>
                    </g>
                  );
                })}
              </svg>

              {/* Selected Village Overlay Card */}
              {selectedVillageDetail && (
                <div className="absolute bottom-3 left-3 right-3 sm:right-auto sm:w-80 bg-slate-900/95 backdrop-blur-md border border-slate-700 rounded-xl p-3 text-white shadow-xl">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-[10px] font-mono font-bold text-teal-300 uppercase">
                        {selectedVillageDetail.code} · {selectedVillageDetail.block}
                      </span>
                      <h3 className="text-sm font-extrabold">
                        {selectedVillageDetail.name}
                      </h3>
                      <p className="text-[11px] text-slate-300">
                        ASHA: {selectedVillageDetail.ashaName} ·{' '}
                        {selectedVillageDetail.phcDistanceKm} km to HQ
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedVillageCode(null)}
                      className="text-slate-400 hover:text-white p-1 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-2.5 pt-2.5 border-t border-slate-800 text-center text-[11px]">
                    <div>
                      <span className="text-slate-400 block">Total</span>
                      <strong className="text-sm font-black">
                        {selectedVillageDetail.totalCases}
                      </strong>
                    </div>
                    <div>
                      <span className="text-amber-300 block">Yellow</span>
                      <strong className="text-sm font-black text-amber-400">
                        {selectedVillageDetail.yellowCount}
                      </strong>
                    </div>
                    <div>
                      <span className="text-red-300 block">RED</span>
                      <strong className="text-sm font-black text-red-400">
                        {selectedVillageDetail.redCount}
                      </strong>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT 40% (5 cols): High-Priority Real-Time Emergency Alert Feed */}
          <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 shadow-xs flex flex-col max-h-[560px]">
            <div className="px-4 py-3.5 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#EF4444] animate-ping" />
                <div>
                  <h2 className="text-sm font-extrabold text-slate-900">
                    High-Priority Incoming Alert Feed
                  </h2>
                  <p className="text-[11px] text-slate-500">
                    Live RED SMS & Data dispatches sorted by clinical urgency
                  </p>
                </div>
              </div>
              <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                {priorityAlertFeed.length} records
              </span>
            </div>

            <div className="p-3 space-y-3 overflow-y-auto flex-1">
              {priorityAlertFeed.map((rec) => {
                const isRed = rec.severity === 'emergency';
                const isYellow = rec.severity === 'moderate';
                return (
                  <div
                    key={rec.id}
                    className={`rounded-xl border p-3.5 transition-all ${
                      isRed && rec.dispatchStatus === 'Unassigned'
                        ? 'bg-red-50/75 border-red-300 shadow-xs'
                        : isRed
                        ? 'bg-white border-red-200'
                        : isYellow
                        ? 'bg-amber-50/40 border-amber-200'
                        : 'bg-slate-50/70 border-slate-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${
                              isRed
                                ? 'bg-[#EF4444] text-white'
                                : isYellow
                                ? 'bg-[#F59E0B] text-slate-950'
                                : 'bg-[#10B981] text-white'
                            }`}
                          >
                            {rec.severity}
                          </span>
                          <span className="text-xs font-mono font-bold text-slate-700">
                            {rec.patientId}
                          </span>
                          <span className="text-[11px] font-mono font-semibold text-teal-800 bg-teal-50 border border-teal-200 px-1.5 py-0.5 rounded">
                            {rec.villageCode}
                          </span>
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                              rec.channel === 'Emergency SMS'
                                ? 'bg-slate-900 text-amber-300 font-mono'
                                : 'bg-cyan-50 text-cyan-800 border border-cyan-200'
                            }`}
                          >
                            {rec.channel}
                          </span>
                        </div>
                        <h3 className="text-sm font-extrabold text-slate-900 mt-1">
                          {rec.patientName}{' '}
                          <span className="text-xs font-medium text-slate-500">
                            ({rec.age}y/{rec.gender}) · {rec.villageName}
                          </span>
                        </h3>
                      </div>
                      <span className="text-[11px] font-mono text-slate-500 shrink-0">
                        {rec.timestamp}
                      </span>
                    </div>

                    {/* Vitals Snapshot Strip */}
                    <div className="grid grid-cols-4 gap-1.5 mt-2.5 bg-white/90 rounded-lg border border-slate-200/90 p-2 text-center">
                      <div>
                        <span className="text-[10px] text-slate-500 block">BP</span>
                        <strong
                          className={`text-xs font-mono font-extrabold ${
                            rec.vitals.systolic >= 160 ? 'text-red-600' : 'text-slate-900'
                          }`}
                        >
                          {rec.vitals.systolic}/{rec.vitals.diastolic}
                        </strong>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block">SpO₂</span>
                        <strong
                          className={`text-xs font-mono font-extrabold ${
                            rec.vitals.spo2 < 90 ? 'text-red-600' : 'text-slate-900'
                          }`}
                        >
                          {rec.vitals.spo2}%
                        </strong>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block">Temp</span>
                        <strong className="text-xs font-mono font-extrabold text-slate-900">
                          {rec.vitals.temperature.toFixed(1)}°F
                        </strong>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block">Pulse</span>
                        <strong className="text-xs font-mono font-extrabold text-slate-900">
                          {rec.vitals.heartRate}
                        </strong>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setDrawerState({
                              isOpen: true,
                              record: rec,
                              mode: 'vitals',
                            })
                          }
                          className="h-8 px-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-[11px] font-bold text-slate-700 flex items-center gap-1 cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5 text-[#0D9488]" />
                          View Vitals
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setDrawerState({
                              isOpen: true,
                              record: rec,
                              mode: 'decode',
                            })
                          }
                          className="h-8 px-2.5 rounded-lg border border-slate-300 bg-slate-900 hover:bg-slate-800 text-[11px] font-mono font-bold text-teal-300 flex items-center gap-1 cursor-pointer"
                        >
                          <Cpu className="w-3.5 h-3.5" />
                          Decode SMS
                        </button>
                      </div>

                      {rec.dispatchStatus === 'Dispatched' ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 bg-emerald-100 border border-emerald-300 px-2.5 py-1 rounded-lg">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {rec.ambulanceUnit} · ETA {rec.etaMinutes}m
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onDispatchAmbulance(rec.id)}
                          className={`h-8 px-3 rounded-lg text-xs font-extrabold flex items-center gap-1.5 cursor-pointer transition-colors ${
                            isRed
                              ? 'bg-[#EF4444] hover:bg-red-700 text-white shadow-xs'
                              : 'bg-[#0D9488] hover:bg-teal-700 text-white'
                          }`}
                        >
                          <Ambulance className="w-3.5 h-3.5" />
                          Dispatch Ambulatory Care
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* 4. BOTTOM LONGITUDINAL PATIENT TRIAGE REGISTRY TABLE */}
        <section className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="px-4 py-3.5 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-extrabold text-slate-900">
                Patient Triage Longitudinal Registry (`healthsync_records`)
              </h2>
              <p className="text-[11px] text-slate-500">
                Real-time persisted records synced via WebSocket, BroadcastChannel & LocalStorage
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search ID, name, village, HS#..."
                  className="h-9 pl-8 pr-3 rounded-lg border border-slate-300 text-xs text-slate-900 focus:outline-none focus:border-[#0D9488] w-56"
                />
              </div>

              <div className="flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5 text-slate-400" />
                <select
                  value={severityFilter}
                  onChange={(e) =>
                    setSeverityFilter(e.target.value as 'ALL' | SeverityLevel)
                  }
                  aria-label="Filter by severity"
                  className="h-9 px-2.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 bg-white"
                >
                  <option value="ALL">All Severities</option>
                  <option value="emergency">Critical RED</option>
                  <option value="moderate">Moderate Yellow</option>
                  <option value="routine">Routine Green</option>
                </select>

                <select
                  value={channelFilter}
                  onChange={(e) =>
                    setChannelFilter(e.target.value as 'ALL' | SyncChannel)
                  }
                  aria-label="Filter by channel"
                  className="h-9 px-2.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 bg-white"
                >
                  <option value="ALL">All Channels</option>
                  <option value="Data">4G/2G Data</option>
                  <option value="Emergency SMS">Emergency SMS</option>
                </select>
              </div>

              <button
                type="button"
                onClick={handleExportCsv}
                className="h-9 px-3 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-800 flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-[#0D9488]" />
                Export CSV
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="py-2.5 px-4">Patient</th>
                  <th className="py-2.5 px-3">Sub-Center</th>
                  <th className="py-2.5 px-3">Vitals Snapshot</th>
                  <th className="py-2.5 px-3">Severity</th>
                  <th className="py-2.5 px-3">Channel & Sync</th>
                  <th className="py-2.5 px-3">Bit-Packed SMS Frame</th>
                  <th className="py-2.5 px-4 text-right">Dispatch / Inspect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {filteredTableRecords.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-900">
                        {r.patientName}{' '}
                        <span className="font-mono text-[11px] text-slate-500">
                          ({r.patientId})
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        {r.age}y/{r.gender} · ABHA {r.abhaId}
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <span className="font-mono font-bold text-teal-800">
                        {r.villageCode}
                      </span>
                      <div className="text-[11px] text-slate-500">{r.villageName}</div>
                    </td>
                    <td className="py-3 px-3 font-mono text-[11px] tabular-nums">
                      <span className="font-bold text-slate-900">
                        {r.vitals.systolic}/{r.vitals.diastolic}
                      </span>{' '}
                      mmHg · SpO₂ <span className="font-bold">{r.vitals.spo2}%</span> ·{' '}
                      {r.vitals.temperature.toFixed(1)}°F
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                          r.severity === 'emergency'
                            ? 'bg-red-100 text-red-700 border border-red-300'
                            : r.severity === 'moderate'
                            ? 'bg-amber-100 text-amber-800 border border-amber-300'
                            : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                        }`}
                      >
                        {r.severity}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-semibold text-slate-800">{r.channel}</div>
                      <div className="text-[11px] text-slate-500">
                        {r.syncStatus} · {r.timestamp}
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <button
                        type="button"
                        onClick={() => {
                          setPasteSmsInput(r.binarySmsPayload);
                          setDrawerState({
                            isOpen: true,
                            record: r,
                            mode: 'decode',
                          });
                        }}
                        className="font-mono text-[11px] bg-slate-900 text-teal-300 px-2 py-1 rounded hover:bg-slate-800 cursor-pointer"
                        title="Click to decode binary SMS frame"
                      >
                        {r.binarySmsPayload}
                      </button>
                    </td>
                    <td className="py-3 px-4 text-right">
                      {r.dispatchStatus === 'Dispatched' ? (
                        <span className="text-[11px] font-bold text-emerald-700">
                          {r.ambulanceUnit} ({r.etaMinutes}m)
                        </span>
                      ) : r.severity === 'emergency' ? (
                        <button
                          type="button"
                          onClick={() => onDispatchAmbulance(r.id)}
                          className="h-7 px-2.5 rounded bg-[#EF4444] hover:bg-red-700 text-white text-[11px] font-bold cursor-pointer"
                        >
                          Dispatch 108
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            setDrawerState({
                              isOpen: true,
                              record: r,
                              mode: 'vitals',
                            })
                          }
                          className="h-7 px-2.5 rounded border border-slate-300 hover:bg-slate-100 text-[11px] font-semibold text-slate-700 cursor-pointer"
                        >
                          FHIR Bundle
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {/* BINARY SMS & FHIR UNPACKING DRAWER */}
      <BinarySmsDecoderDrawer
        record={drawerState.record}
        isOpen={drawerState.isOpen}
        initialPayload={drawerState.initialPayload}
        mode={drawerState.mode}
        onClose={() => setDrawerState((prev) => ({...prev, isOpen: false}))}
      />
    </div>
  );
}
