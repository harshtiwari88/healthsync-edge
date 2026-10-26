import React, {useState, useEffect, useMemo} from 'react';
import {motion, AnimatePresence} from 'motion/react';
import {
  AlertTriangle,
  Ambulance,
  CheckCircle2,
  Cpu,
  Download,
  Eye,
  Layers,
  Lock,
  Play,
  Radio,
  RefreshCw,
  Terminal,
  Volume2,
  VolumeX,
  X,
  Copy,
  Check,
} from 'lucide-react';
import {SeverityLevel, SyncChannel, TriageRecord} from '../types/triage';
import {VILLAGE_SUB_CENTERS} from '../data/initialData';
import {
  buildFhirBundleFromDecoded,
  decodeSMSPayload,
} from '../utils/binarySmsCodec';
import {SystemHardwareTelemetry} from '../utils/deviceTelemetry';
import {BinarySmsDecoderDrawer} from './BinarySmsDecoderDrawer';

interface DistrictCommandDashboardProps {
  dmoEmail: string;
  records: TriageRecord[];
  hardwareTelemetry: SystemHardwareTelemetry;
  activeEmergencyBanner: TriageRecord | null;
  isSirenRinging: boolean;
  onAcknowledgeEmergency: () => void;
  onTestSiren: () => void;
  onDispatchAmbulance: (recordId: string) => void;
  onSyncOfflineQueue: () => number;
}

export const DistrictCommandDashboard: React.FC<DistrictCommandDashboardProps> = ({
  dmoEmail,
  records,
  hardwareTelemetry,
  activeEmergencyBanner,
  isSirenRinging,
  onAcknowledgeEmergency,
  onTestSiren,
  onDispatchAmbulance,
  onSyncOfflineQueue,
}) => {
  const [clockUtc, setClockUtc] = useState<string>('');
  const [selectedVillageCode, setSelectedVillageCode] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<'ALL' | SeverityLevel>('ALL');
  const [channelFilter, setChannelFilter] = useState<'ALL' | SyncChannel>('ALL');

  // Geospatial Tactical Map Layer Toggles
  const [show4gCoverage, setShow4gCoverage] = useState<boolean>(true);
  const [showBlackoutZones, setShowBlackoutZones] = useState<boolean>(true);
  const [showSignalRelays, setShowSignalRelays] = useState<boolean>(true);

  // Embedded Interactive SMS Binary Payload Decoder Console State
  const [decoderInput, setDecoderInput] = useState<string>(
    () => records[0]?.binarySmsPayload ?? ''
  );
  const [unpackStage, setUnpackStage] = useState<number>(4); // 0=idle, 1..4=step-by-step animation
  const [isUnpacking, setIsUnpacking] = useState<boolean>(false);
  const [copiedFhir, setCopiedFhir] = useState<boolean>(false);

  // Side Drawer for Secondary Inspection
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
    const updateClock = () => {
      setClockUtc(
        new Date().toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        })
      );
    };
    updateClock();
    const t = window.setInterval(updateClock, 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (!decoderInput && records.length > 0) {
      setDecoderInput(records[0].binarySmsPayload);
    }
  }, [records, decoderInput]);

  const decodedPacket = useMemo(
    () => decodeSMSPayload(decoderInput),
    [decoderInput]
  );

  const matchedRecordForFhir = useMemo(
    () =>
      records.find(
        (r) =>
          r.binarySmsPayload === decoderInput.trim() ||
          r.patientId === decodedPacket.patientId
      ) ?? null,
    [records, decoderInput, decodedPacket.patientId]
  );

  const fhirBundleJson = useMemo(() => {
    if (!decodedPacket.valid) return '';
    return JSON.stringify(
      buildFhirBundleFromDecoded(decodedPacket, {
        patientName: matchedRecordForFhir?.patientName,
        abhaId: matchedRecordForFhir?.abhaId,
        age: matchedRecordForFhir?.age,
        gender: matchedRecordForFhir?.gender,
      }),
      null,
      2
    );
  }, [decodedPacket, matchedRecordForFhir]);

  const triggerStepByStepUnpack = (payloadToLoad?: string) => {
    if (typeof payloadToLoad === 'string') {
      setDecoderInput(payloadToLoad);
    }
    setIsUnpacking(true);
    setUnpackStage(1);
    window.setTimeout(() => setUnpackStage(2), 220);
    window.setTimeout(() => setUnpackStage(3), 460);
    window.setTimeout(() => {
      setUnpackStage(4);
      setIsUnpacking(false);
    }, 720);
  };

  // Telemetry Counters
  const smsGatewayCount = records.filter(
    (r) => r.channel === 'Emergency SMS' || r.syncStatus === 'Queued Offline'
  ).length;
  const criticalRecords = records.filter((r) => r.severity === 'emergency');
  const unassignedRedCount = criticalRecords.filter(
    (r) => r.dispatchStatus === 'Unassigned'
  ).length;

  // Geospatial Sub-Center Stats
  const villageNodes = useMemo(() => {
    return VILLAGE_SUB_CENTERS.map((v) => {
      const list = records.filter((r) => r.villageCode === v.code);
      const redOpen = list.filter(
        (r) => r.severity === 'emergency' && r.dispatchStatus === 'Unassigned'
      ).length;
      const redTotal = list.filter((r) => r.severity === 'emergency').length;
      const yellowTotal = list.filter((r) => r.severity === 'moderate').length;
      const risk: SeverityLevel =
        redTotal > 0 ? 'emergency' : yellowTotal > 0 ? 'moderate' : 'routine';
      return {
        ...v,
        totalCases: list.length,
        redOpen,
        redTotal,
        yellowTotal,
        risk,
      };
    });
  }, [records]);

  // Sorted Live Alert Feed (Critical Unassigned RED float to top)
  const alertStream = useMemo(() => {
    return [...records]
      .filter((r) => {
        if (selectedVillageCode && r.villageCode !== selectedVillageCode) return false;
        if (severityFilter !== 'ALL' && r.severity !== severityFilter) return false;
        if (channelFilter !== 'ALL' && r.channel !== channelFilter) return false;
        return true;
      })
      .sort((a, b) => {
        const rank = (rec: TriageRecord) => {
          if (rec.severity === 'emergency' && rec.dispatchStatus === 'Unassigned') return 4;
          if (rec.severity === 'emergency') return 3;
          if (rec.severity === 'moderate') return 2;
          return 1;
        };
        const d = rank(b) - rank(a);
        return d !== 0 ? d : b.createdAtMs - a.createdAtMs;
      });
  }, [records, selectedVillageCode, severityFilter, channelFilter]);

  const handleExportRegistryCsv = () => {
    const headers = [
      'Patient_ID',
      'Subject_Name',
      'Village_Node',
      'BP_mmHg',
      'SpO2_Pct',
      'HR_BPM',
      'Temp_F',
      'Severity',
      'Channel',
      'Dispatch',
      'Packet_160B',
    ];
    const rows = alertStream.map((r) => [
      r.patientId,
      `"${r.patientName}"`,
      r.villageCode,
      `${r.vitals.systolic}/${r.vitals.diastolic}`,
      r.vitals.spo2,
      r.vitals.heartRate,
      r.vitals.temperature.toFixed(1),
      r.severity.toUpperCase(),
      r.channel,
      r.ambulanceUnit ? `${r.dispatchStatus} (${r.ambulanceUnit})` : r.dispatchStatus,
      r.binarySmsPayload,
    ]);
    const blob = new Blob(
      [[headers.join(','), ...rows.map((x) => x.join(','))].join('\n')],
      {type: 'text/csv;charset=utf-8;'}
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `healthsync_os_warroom_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="os-grid-surface min-h-[calc(100vh-52px)] pb-16 text-slate-100 flex flex-col">
      {/* ACTIVE CYBER-RED EMERGENCY SIREN HAZARD BANNER */}
      {(activeEmergencyBanner || isSirenRinging) && (
        <div
          role="alert"
          className="bg-[#EF4444]/20 border-b-2 border-[#EF4444] hazard-alert-frame"
        >
          <div className="max-w-[1440px] mx-auto px-4 lg:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-6 h-6 text-[#EF4444] shrink-0" />
              <div>
                <p className="font-mono text-xs sm:text-sm font-bold text-white">
                  CRITICAL EMERGENCY RECEIVED FROM SUB-CENTER{' '}
                  {activeEmergencyBanner?.villageCode ?? 'VIL-204'}
                </p>
                {activeEmergencyBanner && (
                  <p className="font-mono text-xs text-red-200 tabular-nums">
                    {activeEmergencyBanner.patientId} · {activeEmergencyBanner.patientName} · BP{' '}
                    {activeEmergencyBanner.vitals.systolic}/
                    {activeEmergencyBanner.vitals.diastolic} mmHg · SpO₂{' '}
                    {activeEmergencyBanner.vitals.spo2}% · {activeEmergencyBanner.channel}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {activeEmergencyBanner &&
                activeEmergencyBanner.dispatchStatus === 'Unassigned' && (
                  <button
                    type="button"
                    onClick={() => onDispatchAmbulance(activeEmergencyBanner.id)}
                    className="min-h-[40px] px-3.5 rounded-lg bg-[#EF4444] hover:bg-red-500 text-white font-mono text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <Ambulance className="w-4 h-4" />
                    <span>Dispatch ALS-108</span>
                  </button>
                )}
              <button
                type="button"
                onClick={onAcknowledgeEmergency}
                className="min-h-[40px] px-3.5 rounded-lg bg-[#090D16] hover:bg-slate-900 border border-[#EF4444] text-white font-mono text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <VolumeX className="w-4 h-4 text-[#F59E0B]" />
                <span>Mute Siren / Acknowledge</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOP WAR-ROOM TELEMETRY RIBBON */}
      <div className="bg-[#060911] border-b border-slate-800">
        <div className="max-w-[1440px] mx-auto px-4 lg:px-6 py-3 grid grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Metric 1: System Latency */}
          <div className="rounded-lg bg-[#0D1322] border border-slate-800 px-3.5 py-2.5 flex items-center justify-between">
            <div>
              <span className="block font-mono text-[10px] text-slate-400">
                SYSTEM LATENCY (RTT)
              </span>
              <div className="mt-0.5 flex items-baseline gap-1.5">
                <span className="text-xl font-mono font-bold text-[#06B6D4] tabular-nums">
                  {hardwareTelemetry.rttLatencyMs || 12}
                </span>
                <span className="font-mono text-xs text-slate-500">ms</span>
              </div>
            </div>
            <span className="font-mono text-[11px] text-emerald-400">● WS LIVE</span>
          </div>

          {/* Metric 2: Active SMS Gateway Queue */}
          <div className="rounded-lg bg-[#0D1322] border border-slate-800 px-3.5 py-2.5 flex items-center justify-between">
            <div>
              <span className="block font-mono text-[10px] text-slate-400">
                ACTIVE SMS GATEWAY QUEUE
              </span>
              <div className="mt-0.5 flex items-baseline gap-1.5">
                <span className="text-xl font-mono font-bold text-[#F59E0B] tabular-nums">
                  {smsGatewayCount}
                </span>
                <span className="font-mono text-xs text-slate-500">PACKETS</span>
              </div>
            </div>
            <button
              type="button"
              onClick={onSyncOfflineQueue}
              title="Flush Pending CRDT Sync Queue"
              className="min-h-[34px] px-2.5 rounded bg-[#090D16] hover:bg-slate-900 border border-slate-700 font-mono text-[11px] text-[#06B6D4] inline-flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Sync</span>
            </button>
          </div>

          {/* Metric 3: Total Emergency Triage Stream */}
          <div className="rounded-lg bg-[#0D1322] border border-slate-800 px-3.5 py-2.5 flex items-center justify-between">
            <div>
              <span className="block font-mono text-[10px] text-slate-400">
                EMERGENCY TRIAGE STREAM
              </span>
              <div className="mt-0.5 flex items-baseline gap-2">
                <span className="text-xl font-mono font-bold text-[#EF4444] tabular-nums">
                  {criticalRecords.length} RED
                </span>
                <span className="font-mono text-xs text-slate-400 tabular-nums">
                  / {records.length} TOTAL
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={onTestSiren}
              className="min-h-[34px] px-2.5 rounded bg-[#EF4444]/15 hover:bg-[#EF4444]/25 border border-[#EF4444]/50 font-mono text-[11px] text-[#EF4444] inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
            >
              <Volume2 className="w-3 h-3" />
              <span>Siren</span>
            </button>
          </div>

          {/* Metric 4: Local SQLCipher DB Status */}
          <div className="rounded-lg bg-[#0D1322] border border-slate-800 px-3.5 py-2.5 flex items-center justify-between">
            <div>
              <span className="block font-mono text-[10px] text-slate-400">
                LOCAL SQLCIPHER DB STATUS
              </span>
              <div className="mt-0.5 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-[#06B6D4]" />
                <span className="font-mono text-sm font-bold text-slate-100">
                  AES-256 MOUNTED
                </span>
              </div>
            </div>
            <span className="font-mono text-[11px] text-slate-400 tabular-nums">
              {clockUtc || '--:--:--'} IST
            </span>
          </div>
        </div>
      </div>

      {/* MAIN TACTICAL WAR-ROOM WORKSPACE */}
      <main className="max-w-[1440px] w-full mx-auto px-4 lg:px-6 py-5 space-y-5 flex-1">
        {/* PRIMARY 2-COLUMN SPLIT: GEOSPATIAL COVERAGE MAP (7 COLS) + LIVE ALERT FEED (5 COLS) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          {/* LEFT 7 COLS: GEOSPATIAL COVERAGE VECTOR MAP WITH RF LAYER TOGGLES */}
          <section className="lg:col-span-7 rounded-xl bg-[#0D1322] border border-slate-800 overflow-hidden flex flex-col justify-between">
            <div className="px-4 py-3 bg-[#090D16] border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h1 className="text-sm font-semibold text-slate-100">
                  District 24 Geospatial RF &amp; Sub-Center Telemetry Map
                </h1>
                <p className="font-mono text-[11px] text-slate-400">
                  Commander: {dmoEmail} · Sector 26.84°N, 80.94°E
                </p>
              </div>

              {/* Interactive Layer Toggle Controls */}
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setShow4gCoverage((v) => !v)}
                  aria-pressed={show4gCoverage}
                  className={`min-h-[34px] px-2.5 rounded border font-mono text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap transition-colors ${
                    show4gCoverage
                      ? 'bg-[#06B6D4]/20 border-[#06B6D4] text-[#06B6D4]'
                      : 'bg-[#0D1322] border-slate-700 text-slate-400'
                  }`}
                >
                  <Layers className="w-3 h-3" />
                  <span>3G/4G Coverage</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowBlackoutZones((v) => !v)}
                  aria-pressed={showBlackoutZones}
                  className={`min-h-[34px] px-2.5 rounded border font-mono text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap transition-colors ${
                    showBlackoutZones
                      ? 'bg-[#F59E0B]/20 border-[#F59E0B] text-[#F59E0B]'
                      : 'bg-[#0D1322] border-slate-700 text-slate-400'
                  }`}
                >
                  <AlertTriangle className="w-3 h-3" />
                  <span>Blackout Zones</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowSignalRelays((v) => !v)}
                  aria-pressed={showSignalRelays}
                  className={`min-h-[34px] px-2.5 rounded border font-mono text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap transition-colors ${
                    showSignalRelays
                      ? 'bg-[#EF4444]/20 border-[#EF4444] text-red-300'
                      : 'bg-[#0D1322] border-slate-700 text-slate-400'
                  }`}
                >
                  <Radio className="w-3 h-3" />
                  <span>Signal Relays</span>
                </button>
              </div>
            </div>

            {/* Dark Vector Map Viewport */}
            <div className="relative bg-[#05080F] flex-1 min-h-[360px] overflow-hidden os-scanlines">
              <svg
                viewBox="0 0 100 66"
                className="w-full h-full cursor-crosshair"
                aria-label="District 24 Tactical Coverage Map"
              >
                <defs>
                  <pattern
                    id="tacticalCoordGrid"
                    width="10"
                    height="10"
                    patternUnits="userSpaceOnUse"
                  >
                    <path
                      d="M 10 0 L 0 0 0 10"
                      fill="none"
                      stroke="rgba(6,182,212,0.08)"
                      strokeWidth="0.22"
                    />
                  </pattern>
                  <pattern
                    id="blackoutHatch"
                    width="3"
                    height="3"
                    patternTransform="rotate(45 0 0)"
                    patternUnits="userSpaceOnUse"
                  >
                    <line
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="3"
                      stroke="rgba(245,158,11,0.45)"
                      strokeWidth="0.6"
                    />
                  </pattern>
                </defs>

                <rect width="100" height="66" fill="url(#tacticalCoordGrid)" />

                {/* District Perimeter Vector */}
                <path
                  d="M 8,14 L 29,5 L 66,7 L 93,18 L 89,52 L 62,61 L 23,58 L 7,39 Z"
                  fill="rgba(15,23,42,0.72)"
                  stroke="rgba(6,182,212,0.4)"
                  strokeWidth="0.45"
                />

                {/* LAYER 1: 3G/4G Cellular Propagation Contours */}
                {show4gCoverage && (
                  <g>
                    <circle
                      cx="50"
                      cy="33"
                      r="20"
                      fill="rgba(6,182,212,0.08)"
                      stroke="rgba(6,182,212,0.32)"
                      strokeWidth="0.3"
                      strokeDasharray="1.5 1"
                    />
                    <circle
                      cx="68"
                      cy="20"
                      r="12"
                      fill="rgba(6,182,212,0.06)"
                      stroke="rgba(6,182,212,0.25)"
                      strokeWidth="0.25"
                    />
                    <text
                      x="50"
                      y="15"
                      textAnchor="middle"
                      fill="#06B6D4"
                      fontSize="2"
                      fontFamily="monospace"
                    >
                      LTE BAND-40 (-82 dBm)
                    </text>
                  </g>
                )}

                {/* LAYER 2: Zero-Network RF Blackout Zones */}
                {showBlackoutZones && (
                  <g>
                    <polygon
                      points="12,18 35,14 33,34 14,35"
                      fill="url(#blackoutHatch)"
                      stroke="#F59E0B"
                      strokeWidth="0.4"
                    />
                    <text
                      x="23.5"
                      y="17"
                      textAnchor="middle"
                      fill="#F59E0B"
                      fontSize="1.9"
                      fontFamily="monospace"
                    >
                      RF BLACKOUT · RAMPUR SECTOR
                    </text>

                    <polygon
                      points="69,36 90,34 86,54 67,52"
                      fill="url(#blackoutHatch)"
                      stroke="#EF4444"
                      strokeWidth="0.4"
                    />
                    <text
                      x="78"
                      y="56.5"
                      textAnchor="middle"
                      fill="#EF4444"
                      fontSize="1.9"
                      fontFamily="monospace"
                    >
                      ZERO-DATA ZONE · GSM SMS ONLY
                    </text>
                  </g>
                )}

                {/* LAYER 3: Emergency Signal Relays & Baseband Links */}
                {showSignalRelays && (
                  <g>
                    {/* Relay Towers */}
                    {[
                      {id: 'RLY-N1', rx: 38, ry: 22},
                      {id: 'RLY-E2', rx: 66, ry: 38},
                    ].map((relay) => (
                      <g key={relay.id}>
                        <line
                          x1={relay.rx}
                          y1={relay.ry}
                          x2={50}
                          y2={33}
                          stroke="#F59E0B"
                          strokeWidth="0.38"
                          strokeDasharray="1 0.8"
                        />
                        <polygon
                          points={`${relay.rx},${relay.ry - 2} ${relay.rx - 1.8},${relay.ry + 1.5} ${relay.rx + 1.8},${relay.ry + 1.5}`}
                          fill="#F59E0B"
                        />
                        <text
                          x={relay.rx}
                          y={relay.ry - 2.8}
                          textAnchor="middle"
                          fill="#F59E0B"
                          fontSize="1.9"
                          fontFamily="monospace"
                        >
                          {relay.id}
                        </text>
                      </g>
                    ))}
                  </g>
                )}

                {/* District 24 Command Hub */}
                <g transform="translate(50, 33)">
                  <rect
                    x="-3"
                    y="-3"
                    width="6"
                    height="6"
                    rx="1"
                    fill="#06B6D4"
                    stroke="#090D16"
                    strokeWidth="0.6"
                  />
                  <text
                    x="0"
                    y="1.1"
                    textAnchor="middle"
                    fill="#090D16"
                    fontSize="3.2"
                    fontWeight="bold"
                    fontFamily="monospace"
                  >
                    HQ
                  </text>
                  <text
                    x="0"
                    y="6.2"
                    textAnchor="middle"
                    fill="#06B6D4"
                    fontSize="2.2"
                    fontWeight="bold"
                    fontFamily="monospace"
                  >
                    DIST-24 WAR-ROOM
                  </text>
                </g>

                {/* Village Sub-Center Nodes */}
                {villageNodes.map((v) => {
                  const vy = Math.max(11, Math.min(56, v.y * 0.64));
                  const selected = selectedVillageCode === v.code;
                  const nodeColor =
                    v.risk === 'emergency'
                      ? '#EF4444'
                      : v.risk === 'moderate'
                      ? '#F59E0B'
                      : '#06B6D4';

                  return (
                    <g
                      key={v.code}
                      transform={`translate(${v.x}, ${vy})`}
                      onClick={() => setSelectedVillageCode(selected ? null : v.code)}
                      className="cursor-pointer"
                    >
                      {showSignalRelays && v.risk === 'emergency' && (
                        <line
                          x1={0}
                          y1={0}
                          x2={50 - v.x}
                          y2={33 - vy}
                          stroke="rgba(239,68,68,0.55)"
                          strokeWidth="0.35"
                          strokeDasharray="1.4 1"
                        />
                      )}

                      {v.redOpen > 0 && (
                        <circle
                          r="5"
                          fill="none"
                          stroke="#EF4444"
                          strokeWidth="0.5"
                        >
                          <animate
                            attributeName="r"
                            from="2.6"
                            to="6.8"
                            dur="1.3s"
                            repeatCount="indefinite"
                          />
                          <animate
                            attributeName="opacity"
                            from="0.95"
                            to="0"
                            dur="1.3s"
                            repeatCount="indefinite"
                          />
                        </circle>
                      )}

                      <circle
                        r={selected ? '3.1' : '2.4'}
                        fill={nodeColor}
                        stroke="#090D16"
                        strokeWidth="0.6"
                      />
                      {selected && (
                        <rect
                          x="-4.6"
                          y="-4.6"
                          width="9.2"
                          height="9.2"
                          fill="none"
                          stroke="#FFFFFF"
                          strokeWidth="0.4"
                        />
                      )}
                      <text
                        x="0"
                        y="-3.8"
                        textAnchor="middle"
                        fill="#F8FAFC"
                        fontSize="2.3"
                        fontWeight="bold"
                        fontFamily="monospace"
                      >
                        {v.code}
                      </text>
                      <text
                        x="0"
                        y="5.2"
                        textAnchor="middle"
                        fill="#94A3B8"
                        fontSize="1.95"
                        fontFamily="monospace"
                      >
                        [{v.totalCases}]
                      </text>
                    </g>
                  );
                })}
              </svg>

              {/* Map Legend & Filter Lock Indicator */}
              <div className="px-4 py-2 bg-[#090D16]/95 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
                <div className="flex items-center gap-4 text-slate-400">
                  <span className="text-[#06B6D4]">● NOMINAL</span>
                  <span className="text-[#F59E0B]">▲ MODERATE</span>
                  <span className="text-[#EF4444]">✖ CRITICAL RED</span>
                </div>
                {selectedVillageCode ? (
                  <button
                    type="button"
                    onClick={() => setSelectedVillageCode(null)}
                    className="px-2 py-0.5 rounded bg-[#06B6D4]/20 border border-[#06B6D4] text-[#06B6D4] inline-flex items-center gap-1 cursor-pointer"
                  >
                    <span>SECTOR LOCK: {selectedVillageCode}</span>
                    <X className="w-3 h-3" />
                  </button>
                ) : (
                  <span className="text-slate-500">CLICK SECTOR NODE TO ISOLATE STREAM</span>
                )}
              </div>
            </div>
          </section>

          {/* RIGHT 5 COLS: HIGH-PRIORITY PULSING ALERT FEED */}
          <section className="lg:col-span-5 rounded-xl bg-[#0D1322] border border-slate-800 flex flex-col max-h-[520px]">
            <div className="px-4 py-3 bg-[#090D16] border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">
                  Live Triage Telemetry Feed
                </h2>
                <p className="font-mono text-[11px] text-slate-400 tabular-nums">
                  {unassignedRedCount} Unassigned Critical · {alertStream.length} Shown
                </p>
              </div>

              <div className="flex items-center gap-1.5 font-mono text-[11px]">
                <select
                  aria-label="Filter Severity"
                  value={severityFilter}
                  onChange={(e) =>
                    setSeverityFilter(e.target.value as 'ALL' | SeverityLevel)
                  }
                  className="h-8 px-2 rounded bg-[#0D1322] border border-slate-700 text-slate-200 cursor-pointer"
                >
                  <option value="ALL">ALL SEV</option>
                  <option value="emergency">RED CRIT</option>
                  <option value="moderate">AMBER MOD</option>
                  <option value="routine">CYAN NOM</option>
                </select>
                <select
                  aria-label="Filter Transport Channel"
                  value={channelFilter}
                  onChange={(e) =>
                    setChannelFilter(e.target.value as 'ALL' | SyncChannel)
                  }
                  className="h-8 px-2 rounded bg-[#0D1322] border border-slate-700 text-slate-200 cursor-pointer"
                >
                  <option value="ALL">ALL CH</option>
                  <option value="Emergency SMS">GSM SMS</option>
                  <option value="Data">DATA</option>
                </select>
                <button
                  type="button"
                  onClick={handleExportRegistryCsv}
                  title="Export CSV"
                  className="h-8 px-2 rounded bg-[#0D1322] hover:bg-slate-800 border border-slate-700 text-[#06B6D4] cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="p-3 space-y-2.5 overflow-y-auto flex-1">
              {alertStream.map((rec) => {
                const isRed = rec.severity === 'emergency';
                const isYellow = rec.severity === 'moderate';
                const isOpenRed = isRed && rec.dispatchStatus === 'Unassigned';

                return (
                  <div
                    key={rec.id}
                    className={`rounded-lg border p-3 space-y-2.5 transition-colors ${
                      isOpenRed
                        ? 'bg-[#EF4444]/10 border-[#EF4444] hazard-alert-frame'
                        : isRed
                        ? 'bg-[#090D16] border-[#EF4444]/50'
                        : isYellow
                        ? 'bg-[#090D16] border-[#F59E0B]/50'
                        : 'bg-[#090D16] border-slate-800'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-mono text-[11px] flex flex-wrap items-center gap-2 tabular-nums">
                          <span
                            className={`font-bold ${
                              isRed
                                ? 'text-[#EF4444]'
                                : isYellow
                                ? 'text-[#F59E0B]'
                                : 'text-[#06B6D4]'
                            }`}
                          >
                            {isRed ? '✖ CRIT-RED' : isYellow ? '▲ MODERATE' : '● ROUTINE'}
                          </span>
                          <span className="text-slate-600">·</span>
                          <span className="text-slate-200 font-semibold">{rec.patientId}</span>
                          <span className="text-slate-600">·</span>
                          <span className="text-[#06B6D4]">{rec.villageCode}</span>
                          <span className="text-slate-600">·</span>
                          <span className="text-[#F59E0B]">{rec.channel}</span>
                        </div>
                        <h3 className="text-sm font-semibold text-white mt-0.5">
                          {rec.patientName}{' '}
                          <span className="font-mono text-xs text-slate-400">
                            ({rec.age}Y/{rec.gender})
                          </span>
                        </h3>
                      </div>
                      <span className="font-mono text-[10px] text-slate-500 tabular-nums shrink-0">
                        {rec.timestamp}
                      </span>
                    </div>

                    {/* High-Density Telemetry Metrics Row */}
                    <div className="grid grid-cols-4 gap-1.5 rounded bg-[#05080F] border border-slate-800/90 px-2.5 py-1.5 font-mono text-xs text-center tabular-nums">
                      <div>
                        <span className="block text-[9px] text-slate-500">NIBP</span>
                        <strong
                          className={
                            rec.vitals.systolic >= 160 ? 'text-[#EF4444]' : 'text-slate-100'
                          }
                        >
                          {rec.vitals.systolic}/{rec.vitals.diastolic}
                        </strong>
                      </div>
                      <div>
                        <span className="block text-[9px] text-slate-500">SpO₂</span>
                        <strong
                          className={rec.vitals.spo2 < 90 ? 'text-[#EF4444]' : 'text-[#06B6D4]'}
                        >
                          {rec.vitals.spo2}%
                        </strong>
                      </div>
                      <div>
                        <span className="block text-[9px] text-slate-500">HR</span>
                        <strong className="text-[#F59E0B]">{rec.vitals.heartRate}</strong>
                      </div>
                      <div>
                        <span className="block text-[9px] text-slate-500">TEMP</span>
                        <strong className="text-slate-100">
                          {rec.vitals.temperature.toFixed(1)}°
                        </strong>
                      </div>
                    </div>

                    {/* Action Controls */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => triggerStepByStepUnpack(rec.binarySmsPayload)}
                          className="min-h-[34px] px-2.5 rounded bg-[#11192C] hover:bg-slate-800 border border-slate-700 font-mono text-[11px] text-[#06B6D4] inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                        >
                          <Cpu className="w-3.5 h-3.5" />
                          <span>Unpack SMS</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setDrawerState({
                              isOpen: true,
                              record: rec,
                              mode: 'vitals',
                            })
                          }
                          className="min-h-[34px] px-2.5 rounded bg-[#11192C] hover:bg-slate-800 border border-slate-700 font-mono text-[11px] text-slate-300 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>FHIR</span>
                        </button>
                      </div>

                      {rec.dispatchStatus === 'Dispatched' ? (
                        <span className="font-mono text-[11px] font-semibold text-emerald-400 inline-flex items-center gap-1 tabular-nums">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {rec.ambulanceUnit} · ETA {rec.etaMinutes}m
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onDispatchAmbulance(rec.id)}
                          className={`min-h-[34px] px-3 rounded font-mono text-[11px] font-bold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition-colors ${
                            isRed
                              ? 'bg-[#EF4444] hover:bg-red-500 text-white'
                              : 'bg-[#06B6D4] hover:bg-cyan-400 text-[#090D16]'
                          }`}
                        >
                          <Ambulance className="w-3.5 h-3.5" />
                          <span>Dispatch ALS-108</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* EMBEDDED SMS BINARY PAYLOAD DECODER CONSOLE WITH STEP-BY-STEP UNPACKING ANIMATION */}
        <section className="rounded-xl bg-[#0D1322] border border-slate-800 overflow-hidden">
          <div className="px-4 py-3 bg-[#090D16] border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Terminal className="w-4 h-4 text-[#F59E0B]" />
              <div>
                <h2 className="text-sm font-semibold text-slate-100">
                  Embedded SMS Binary Payload Decoder &amp; FHIR Unpacker
                </h2>
                <p className="font-mono text-[11px] text-slate-400">
                  Paste 160-character `HS3#` CRC32 packet (or legacy `HS#` packet) and execute
                  bitstream demux
                </p>
              </div>
            </div>

            <span className="font-mono text-xs text-[#06B6D4] tabular-nums">
              LEN: {decoderInput.trim().length} CHARS ·{' '}
              {decodedPacket.valid ? decodedPacket.protocolVersion : 'AWAITING VALID FRAME'}
            </span>
          </div>

          <div className="p-4 sm:p-5 space-y-4">
            {/* Console Input Bar + Unpack Bitstream Trigger */}
            <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2.5">
              <input
                type="text"
                aria-label="Raw Base64 SMS Payload String"
                value={decoderInput}
                onChange={(e) => setDecoderInput(e.target.value)}
                placeholder="Paste raw HS3#... 160-character Base64 SMS packet"
                className="flex-1 min-h-[46px] px-3.5 rounded-lg bg-[#05080F] border border-slate-700 font-mono text-xs text-[#06B6D4] focus:border-[#06B6D4]"
              />
              <button
                type="button"
                disabled={isUnpacking}
                onClick={() => triggerStepByStepUnpack()}
                className="min-h-[46px] px-5 rounded-lg bg-[#F59E0B] hover:bg-amber-400 disabled:opacity-60 text-[#090D16] font-mono text-xs font-bold inline-flex items-center justify-center gap-2 cursor-pointer shrink-0 whitespace-nowrap transition-colors"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>{isUnpacking ? 'Unpacking Bitstream...' : 'Unpack Bitstream'}</span>
              </button>
            </div>

            {!decodedPacket.valid ? (
              <div className="rounded-lg bg-[#EF4444]/15 border border-[#EF4444] px-4 py-3 font-mono text-xs text-red-200">
                DECODER FAULT: {decodedPacket.error}
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                {/* Left 6 Cols: Step-by-Step Pipeline Stages 1..3 */}
                <div className="lg:col-span-6 space-y-3 font-mono text-xs">
                  {/* Stage 1: Frame Demux & Hex Buffer */}
                  <AnimatePresence>
                    {unpackStage >= 1 && (
                      <motion.div
                        initial={{opacity: 0, y: 6}}
                        animate={{opacity: 1, y: 0}}
                        transition={{duration: 0.16}}
                        className="rounded-lg bg-[#05080F] border border-slate-800 p-3 space-y-1.5"
                      >
                        <div className="flex items-center justify-between text-[11px] text-[#06B6D4]">
                          <span>[STAGE 01] BASE64 DEMUX &rarr; {decodedPacket.byteLength}B BUFFER</span>
                          <span>MAGIC 0x32 OK</span>
                        </div>
                        <p className="text-[11px] text-slate-400 break-all leading-relaxed">
                          {decodedPacket.hexDump}
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Stage 2: CRC32 & CRDT Vector Clock Verification */}
                  <AnimatePresence>
                    {unpackStage >= 2 && (
                      <motion.div
                        initial={{opacity: 0, y: 6}}
                        animate={{opacity: 1, y: 0}}
                        transition={{duration: 0.16}}
                        className={`rounded-lg border p-3 space-y-1 ${
                          decodedPacket.crcValid
                            ? 'bg-[#05080F] border-emerald-500/40'
                            : 'bg-[#EF4444]/15 border-[#EF4444]'
                        }`}
                      >
                        <div className="flex items-center justify-between text-[11px]">
                          <span
                            className={
                              decodedPacket.crcValid ? 'text-emerald-400' : 'text-[#EF4444]'
                            }
                          >
                            [STAGE 02] {decodedPacket.crcValid ? 'CRC32 VERIFIED' : 'CRC32 CORRUPTED'}
                          </span>
                          <span className="text-slate-300 tabular-nums">
                            {decodedPacket.computedCrcHex} == {decodedPacket.receivedCrcHex}
                          </span>
                        </div>
                        <div className="text-[11px] text-[#F59E0B] tabular-nums">
                          CRDT Vector Clock &rarr; node_id: {decodedPacket.crdtNodeId}, seq:{' '}
                          {decodedPacket.crdtSeq}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Stage 3: Unpacked Bitwise Hardware Registers */}
                  <AnimatePresence>
                    {unpackStage >= 3 && (
                      <motion.div
                        initial={{opacity: 0, y: 6}}
                        animate={{opacity: 1, y: 0}}
                        transition={{duration: 0.16}}
                        className="rounded-lg bg-[#05080F] border border-slate-800 p-3 space-y-2"
                      >
                        <div className="flex items-center justify-between text-[11px] text-[#F59E0B]">
                          <span>[STAGE 03] BITWISE REGISTER EXTRACTION</span>
                          <span>
                            {decodedPacket.patientId} · {decodedPacket.villageCode}
                          </span>
                        </div>
                        <div className="divide-y divide-slate-800/80 text-[11px] tabular-nums">
                          {decodedPacket.registers.map((r) => (
                            <div
                              key={r.registerName}
                              className="py-1.5 flex items-center justify-between gap-2"
                            >
                              <span className="text-slate-400">{r.fieldLabel}</span>
                              <span className="text-[#06B6D4]">{r.binaryString}</span>
                              <strong className="text-slate-100">{r.rawValue}</strong>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Right 6 Cols: Stage 4 Complete ABDM FHIR R4 JSON Clinical Expansion */}
                <div className="lg:col-span-6">
                  <AnimatePresence>
                    {unpackStage >= 4 && (
                      <motion.div
                        initial={{opacity: 0, y: 6}}
                        animate={{opacity: 1, y: 0}}
                        transition={{duration: 0.18}}
                        className="rounded-lg bg-[#05080F] border border-slate-800 p-3 h-full flex flex-col justify-between space-y-2"
                      >
                        <div className="flex items-center justify-between font-mono text-[11px]">
                          <span className="text-emerald-400 font-semibold">
                            [STAGE 04] EXPANDED HL7 FHIR R4 CLINICAL BUNDLE
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard?.writeText(fhirBundleJson);
                              setCopiedFhir(true);
                              setTimeout(() => setCopiedFhir(false), 1800);
                            }}
                            className="px-2.5 py-1 rounded bg-[#11192C] hover:bg-slate-800 border border-slate-700 text-[#06B6D4] inline-flex items-center gap-1 cursor-pointer"
                          >
                            {copiedFhir ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-400" />
                                <span>Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                <span>Copy FHIR JSON</span>
                              </>
                            )}
                          </button>
                        </div>

                        <pre className="font-mono text-[11px] text-slate-200 overflow-x-auto max-h-[290px] leading-relaxed">
                          {fhirBundleJson}
                        </pre>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>

      <BinarySmsDecoderDrawer
        record={drawerState.record}
        isOpen={drawerState.isOpen}
        initialPayload={drawerState.initialPayload}
        mode={drawerState.mode}
        onClose={() => setDrawerState((prev) => ({...prev, isOpen: false}))}
      />
    </div>
  );
};
