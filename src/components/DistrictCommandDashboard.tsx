import React, {useState, useEffect, useMemo} from 'react';
import {motion} from 'motion/react';
import {
  Clock,
  Activity,
  Siren,
  AlertTriangle,
  CheckCircle2,
  Ambulance,
  Search,
  Download,
  RefreshCw,
  MapPin,
  Radio,
  Building2,
  Smartphone,
  Binary,
  FileSpreadsheet,
  LogOut,
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from 'lucide-react';
import {SeverityLevel, SyncChannel, TriageRecord, VillageSubCenter} from '../types/triage';
import {VILLAGE_SUB_CENTERS} from '../data/initialData';
import {BinarySmsDecoderDrawer} from './BinarySmsDecoderDrawer';
import {PWAInstallButton} from './PWAInstallButton';

interface DistrictCommandDashboardProps {
  dmoEmail: string;
  records: TriageRecord[];
  onDispatchAmbulance: (recordId: string) => void;
  onSyncOfflineQueue: () => number;
  onSwitchToAsha: () => void;
  onLogout: () => void;
}

export const DistrictCommandDashboard: React.FC<DistrictCommandDashboardProps> = ({
  dmoEmail,
  records,
  onDispatchAmbulance,
  onSyncOfflineQueue,
  onSwitchToAsha,
  onLogout,
}) => {
  const [currentTime, setCurrentTime] = useState<Date>(() => new Date());
  const [selectedVillageCode, setSelectedVillageCode] = useState<string>('VIL-204');
  const [mapFilter, setMapFilter] = useState<'all' | SeverityLevel>('all');
  const [mapZoom, setMapZoom] = useState<number>(1);

  // Decoder / Vitals Drawer state
  const [inspectedRecord, setInspectedRecord] = useState<TriageRecord | null>(null);
  const [drawerMode, setDrawerMode] = useState<'decode' | 'vitals'>('decode');

  // Search & Filter table states
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [severityFilter, setSeverityFilter] = useState<'all' | SeverityLevel>('all');
  const [channelFilter, setChannelFilter] = useState<'all' | SyncChannel>('all');

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // KPI Metrics
  const totalScreeningsToday = records.length;
  const pendingOfflineSyncCount = records.filter((r) => r.syncStatus === 'Queued Offline').length;
  const moderateYellowCases = records.filter((r) => r.severity === 'moderate').length;
  const criticalRedAlerts = records.filter((r) => r.severity === 'emergency');
  const unassignedRedCount = criticalRedAlerts.filter(
    (r) => r.dispatchStatus === 'Unassigned'
  ).length;

  // Sort incoming feed so Critical RED emergencies float to the top, unassigned first, then newest
  const sortedAlertFeed = useMemo(() => {
    const weight = (sev: SeverityLevel) =>
      sev === 'emergency' ? 3 : sev === 'moderate' ? 2 : 1;
    return [...records].sort((a, b) => {
      const diffSev = weight(b.severity) - weight(a.severity);
      if (diffSev !== 0) return diffSev;
      if (a.dispatchStatus !== b.dispatchStatus) {
        return a.dispatchStatus === 'Unassigned' ? -1 : 1;
      }
      return b.createdAtMs - a.createdAtMs;
    });
  }, [records]);

  // Compute Village Sub-Center Pin Risk Colors
  const villageStatusMap = useMemo(() => {
    const map = new Map<
      string,
      {
        highestSeverity: SeverityLevel;
        totalCases: number;
        emergencyCount: number;
        dispatchedUnit?: string;
        latestRecord?: TriageRecord;
      }
    >();

    for (const v of VILLAGE_SUB_CENTERS) {
      const vRecords = records.filter((r) => r.villageCode === v.code);
      let highest: SeverityLevel = 'routine';
      for (const r of vRecords) {
        if (r.severity === 'emergency') {
          highest = 'emergency';
          break;
        }
        if (r.severity === 'moderate') {
          highest = 'moderate';
        }
      }
      const emgCount = vRecords.filter((r) => r.severity === 'emergency').length;
      const dispatched = vRecords.find((r) => r.dispatchStatus === 'Dispatched');

      map.set(v.code, {
        highestSeverity: highest,
        totalCases: vRecords.length,
        emergencyCount: emgCount,
        dispatchedUnit: dispatched?.ambulanceUnit,
        latestRecord: vRecords[0],
      });
    }
    return map;
  }, [records]);

  const selectedVillage: VillageSubCenter =
    VILLAGE_SUB_CENTERS.find((v) => v.code === selectedVillageCode) || VILLAGE_SUB_CENTERS[0];
  const selectedVillageStats = villageStatusMap.get(selectedVillage.code);

  const filteredRegistry = useMemo(() => {
    return sortedAlertFeed.filter((r) => {
      if (severityFilter !== 'all' && r.severity !== severityFilter) return false;
      if (channelFilter !== 'all' && r.channel !== channelFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const match =
          r.patientId.toLowerCase().includes(q) ||
          r.patientName.toLowerCase().includes(q) ||
          r.abhaId.toLowerCase().includes(q) ||
          r.villageCode.toLowerCase().includes(q) ||
          r.villageName.toLowerCase().includes(q) ||
          r.ashaWorker.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [sortedAlertFeed, severityFilter, channelFilter, searchQuery]);

  const handleExportCsv = () => {
    const header = [
      'Patient ID',
      'ABHA ID',
      'Patient Name',
      'Age',
      'Gender',
      'Village Code',
      'Sub-Center',
      'ASHA Worker',
      'Systolic BP',
      'Diastolic BP',
      'SpO2 (%)',
      'Temp (F)',
      'Severity',
      'Channel',
      'Binary SMS Payload',
      'Dispatch Status',
    ];
    const rows = filteredRegistry.map((r) => [
      r.patientId,
      r.abhaId,
      `"${r.patientName}"`,
      r.age,
      r.gender,
      r.villageCode,
      `"${r.villageName}"`,
      `"${r.ashaWorker}"`,
      r.vitals.systolic,
      r.vitals.diastolic,
      r.vitals.spo2,
      r.vitals.temperature,
      r.severity.toUpperCase(),
      `"${r.channel}"`,
      `"${r.binarySmsPayload}"`,
      `"${r.ambulanceUnit ? `${r.dispatchStatus} (${r.ambulanceUnit})` : r.dispatchStatus}"`,
    ]);
    const csv = [header.join(','), ...rows.map((row) => row.join(','))].join('\n');
    const blob = new Blob([csv], {type: 'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `healthsync-district24-triage-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const formattedClock = currentTime.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });

  return (
    <div className="min-h-screen bg-slate-50 pb-14">
      {/* 1. Top Navigation Bar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#0F766E] text-white flex items-center justify-center shrink-0">
              <Building2 className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 truncate">
                District 24 Healthcare Command Center
              </h1>
              <p className="text-xs text-slate-500 truncate">
                HealthSync Edge · DMO Session: <span className="font-mono">{dmoEmail}</span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Real-time Clock */}
            <div className="min-h-[44px] px-3.5 rounded-xl bg-slate-100 text-slate-900 text-xs sm:text-sm font-mono font-semibold inline-flex items-center gap-2 tabular-nums whitespace-nowrap">
              <Clock className="w-4 h-4 text-[#0F766E] shrink-0" />
              <span>{formattedClock} IST</span>
            </div>

            {/* Emergency Alert Counter Badge (Flashing Red Count) */}
            <motion.div
              animate={unassignedRedCount > 0 ? {scale: [1, 1.03, 1]} : {scale: 1}}
              transition={{duration: 1.4, repeat: Infinity}}
              className="min-h-[44px] px-3.5 rounded-xl bg-[#EF4444] text-white text-xs font-bold inline-flex items-center gap-2 shadow-sm whitespace-nowrap"
            >
              <Siren className="w-4 h-4 shrink-0" />
              <span>Emergency Alerts</span>
              <span className="px-2 py-0.5 rounded-full bg-white text-[#EF4444] font-mono text-xs font-bold tabular-nums animate-pulse">
                {unassignedRedCount}
              </span>
            </motion.div>

            {/* Switch to ASHA View */}
            <button
              type="button"
              onClick={onSwitchToAsha}
              className="min-h-[44px] px-4 rounded-xl bg-[#0F766E] hover:bg-teal-800 text-white text-xs sm:text-sm font-bold inline-flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Smartphone className="w-4 h-4 shrink-0" />
              <span>Switch to ASHA View</span>
            </button>

            <PWAInstallButton />

            <button
              type="button"
              onClick={onLogout}
              title="Return to Login Page"
              className="min-h-[44px] px-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 inline-flex items-center gap-1.5 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden xl:inline">Logout</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1440px] mx-auto px-4 sm:px-6 pt-6 space-y-6">
        {/* 2. Summary KPI Metrics (4 Cards) */}
        <section
          aria-label="District KPI Summary"
          className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4"
        >
          {/* KPI 1 */}
          <button
            type="button"
            onClick={() => setSeverityFilter('all')}
            className="text-left rounded-2xl bg-white border border-slate-200 hover:border-slate-300 p-5 transition-colors cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500">
                Total Patient Screenings Today
              </span>
              <Activity className="w-4 h-4 text-[#0F766E]" />
            </div>
            <p className="mt-2 font-mono text-3xl font-bold text-slate-900 tabular-nums">
              {totalScreeningsToday}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              7 Sub-Centers · ABDM HIE-CM Linked
            </p>
          </button>

          {/* KPI 2 */}
          <button
            type="button"
            onClick={() => {
              onSyncOfflineQueue();
            }}
            className="text-left rounded-2xl bg-white border border-slate-200 hover:border-[#0F766E] p-5 transition-colors cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500">
                Pending Offline Sync Queue
              </span>
              <RefreshCw className="w-4 h-4 text-[#0F766E]" />
            </div>
            <p className="mt-2 font-mono text-3xl font-bold text-slate-900 tabular-nums">
              {pendingOfflineSyncCount}
            </p>
            <p className="mt-1 text-xs text-[#0F766E] font-medium">
              {pendingOfflineSyncCount > 0
                ? 'Cached on field devices · Click to pull sync'
                : 'All ASHA offline caches synchronized'}
            </p>
          </button>

          {/* KPI 3 */}
          <button
            type="button"
            onClick={() => setSeverityFilter('moderate')}
            className="text-left rounded-2xl bg-white border border-amber-200 hover:border-[#F59E0B] p-5 transition-colors cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-900">Moderate (Yellow) Cases</span>
              <AlertTriangle className="w-4 h-4 text-[#F59E0B]" />
            </div>
            <p className="mt-2 font-mono text-3xl font-bold text-[#F59E0B] tabular-nums">
              {moderateYellowCases}
            </p>
            <p className="mt-1 text-xs text-slate-600">
              Assigned to PHC Medical Officer Tele-Queue
            </p>
          </button>

          {/* KPI 4 */}
          <button
            type="button"
            onClick={() => setSeverityFilter('emergency')}
            className="text-left rounded-2xl bg-red-50/70 border border-red-200 hover:border-[#EF4444] p-5 transition-colors cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-red-900">
                Critical (RED) Emergency Alerts
              </span>
              <Siren className="w-4 h-4 text-[#EF4444]" />
            </div>
            <div className="mt-2 flex items-baseline gap-2.5">
              <span className="font-mono text-3xl font-bold text-[#EF4444] tabular-nums">
                {criticalRedAlerts.length}
              </span>
              <span className="text-xs font-bold text-red-800 tabular-nums">
                ({unassignedRedCount} awaiting 108 ALS)
              </span>
            </div>
            <p className="mt-1 text-xs text-red-900/80">
              Baseband Binary SMS &amp; Data Priority Stream
            </p>
          </button>
        </section>

        {/* 3. Split Dashboard Body: Left 60% Interactive Map, Right 40% Real-time Emergency Alert Feed */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* Left Column (60% -> lg:col-span-7): Simulated Interactive Map of District Sub-Centers */}
          <section
            aria-labelledby="subcenter-map-title"
            className="lg:col-span-7 rounded-2xl bg-white border border-slate-200 p-5 flex flex-col justify-between"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h2 id="subcenter-map-title" className="text-base font-bold text-slate-900">
                  District 24 Sub-Center Live Tele-Triage Map
                </h2>
                <p className="text-xs text-slate-500">
                  Click any color-coded sub-center pin (Green / Yellow / Red) to inspect live
                  field status
                </p>
              </div>

              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
                {(
                  [
                    {id: 'all', label: 'All Pins'},
                    {id: 'emergency', label: 'Red'},
                    {id: 'moderate', label: 'Yellow'},
                    {id: 'routine', label: 'Green'},
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setMapFilter(t.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                      mapFilter === t.id
                        ? 'bg-white text-slate-900 shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Interactive SVG Map */}
            <div className="relative w-full h-[390px] sm:h-[430px] rounded-2xl bg-slate-100 border border-slate-200 overflow-hidden select-none">
              {/* Zoom Controls */}
              <div className="absolute top-3 right-3 z-20 flex flex-col gap-1 bg-white/95 p-1 rounded-xl border border-slate-200 shadow-xs">
                <button
                  type="button"
                  onClick={() => setMapZoom((z) => Math.min(1.35, Number((z + 0.15).toFixed(2))))}
                  aria-label="Zoom In"
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-700 hover:bg-slate-100 cursor-pointer"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setMapZoom((z) => Math.max(0.85, Number((z - 0.15).toFixed(2))))}
                  aria-label="Zoom Out"
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-700 hover:bg-slate-100 cursor-pointer"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setMapZoom(1)}
                  aria-label="Reset Zoom"
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-700 hover:bg-slate-100 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Pin Legend */}
              <div className="absolute bottom-3 left-3 z-20 flex flex-wrap items-center gap-3 bg-white/95 px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-[#EF4444] inline-block" />
                  Red Critical
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-[#F59E0B] inline-block" />
                  Yellow Moderate
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-[#10B981] inline-block" />
                  Green Routine
                </span>
              </div>

              <div
                className="w-full h-full transition-transform duration-200"
                style={{transform: `scale(${mapZoom})`, transformOrigin: 'center center'}}
              >
                <svg
                  viewBox="0 0 800 460"
                  className="w-full h-full"
                  role="img"
                  aria-label="District 24 Sub-Center Map"
                >
                  <defs>
                    <pattern id="hs-grid" width="56" height="56" patternUnits="userSpaceOnUse">
                      <path
                        d="M 56 0 L 0 0 0 56"
                        fill="none"
                        stroke="#CBD5E1"
                        strokeWidth="0.7"
                        strokeDasharray="2 2"
                      />
                    </pattern>
                  </defs>
                  <rect width="800" height="460" fill="#F1F5F9" />
                  <rect width="800" height="460" fill="url(#hs-grid)" />

                  {/* District 24 Boundary */}
                  <path
                    d="M 70 90 L 250 42 L 580 50 L 735 140 L 712 370 L 535 422 L 205 408 L 78 308 Z"
                    fill="#FFFFFF"
                    fillOpacity="0.82"
                    stroke="#94A3B8"
                    strokeWidth="2"
                  />

                  {/* River Contour */}
                  <path
                    d="M 88 192 C 235 212, 315 142, 452 222 C 572 288, 642 246, 732 292"
                    fill="none"
                    stroke="#BAE6FD"
                    strokeWidth="14"
                    strokeLinecap="round"
                  />

                  {/* Ambulance & Road Corridors to District Hospital HQ */}
                  {VILLAGE_SUB_CENTERS.map((v) => {
                    const vx = (v.x / 100) * 800;
                    const vy = (v.y / 100) * 460;
                    const stats = villageStatusMap.get(v.code);
                    const isDispatched = Boolean(stats?.dispatchedUnit);
                    return (
                      <line
                        key={`corridor-${v.code}`}
                        x1={400}
                        y1={235}
                        x2={vx}
                        y2={vy}
                        stroke={isDispatched ? '#0F766E' : '#CBD5E1'}
                        strokeWidth={isDispatched ? '3.2' : '2'}
                        strokeDasharray={isDispatched ? '6 4' : undefined}
                      />
                    );
                  })}

                  {/* Central District 24 Hospital Hub */}
                  <g transform="translate(400, 235)">
                    <circle r="19" fill="#0F766E" />
                    <path
                      d="M -6 -2 H -2 V -6 H 2 V -2 H 6 V 2 H 2 V 6 H -2 V 2 H -6 Z"
                      fill="#FFFFFF"
                    />
                    <text
                      y="33"
                      textAnchor="middle"
                      className="fill-slate-900 text-[11px] font-bold"
                    >
                      District 24 Civil Hospital
                    </text>
                  </g>
                </svg>

                {/* Interactive Sub-Center Pins */}
                {VILLAGE_SUB_CENTERS.map((village) => {
                  const stats = villageStatusMap.get(village.code);
                  const sev = stats?.highestSeverity || 'routine';
                  if (mapFilter !== 'all' && sev !== mapFilter) return null;

                  const isSelected = village.code === selectedVillageCode;
                  const pinStyle =
                    sev === 'emergency'
                      ? 'bg-[#EF4444] text-white border-white'
                      : sev === 'moderate'
                      ? 'bg-[#F59E0B] text-slate-950 border-white'
                      : 'bg-[#10B981] text-white border-white';

                  return (
                    <button
                      key={village.code}
                      type="button"
                      onClick={() => setSelectedVillageCode(village.code)}
                      style={{left: `${village.x}%`, top: `${village.y}%`}}
                      className="absolute -translate-x-1/2 -translate-y-1/2 z-10 group cursor-pointer flex flex-col items-center"
                      aria-label={`${village.code} ${village.name}`}
                    >
                      <span className="relative flex items-center justify-center">
                        {sev === 'emergency' && (
                          <span
                            aria-hidden="true"
                            className="absolute -inset-2 rounded-full bg-[#EF4444]/40 animate-mic-ripple"
                          />
                        )}
                        <span
                          className={`min-h-[38px] px-2.5 rounded-full border-2 shadow-md flex items-center justify-center gap-1 font-mono text-xs font-bold transition-transform ${pinStyle} ${
                            isSelected ? 'scale-115 ring-3 ring-slate-900/80' : 'group-hover:scale-105'
                          }`}
                        >
                          <MapPin className="w-3.5 h-3.5 shrink-0" />
                          <span>{village.code}</span>
                        </span>
                      </span>
                      <span
                        className={`mt-1 px-2 py-0.5 rounded-md text-[11px] font-bold whitespace-nowrap border ${
                          isSelected
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white/95 text-slate-800 border-slate-200'
                        }`}
                      >
                        {village.name.replace(' Sub-Center', '')}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Clicked Pin Sub-Center Details Panel */}
            <div className="mt-4 pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-900">
                  <span>{selectedVillage.name}</span>
                  <span className="text-slate-400">·</span>
                  <span className="font-mono text-xs text-[#0F766E]">{selectedVillage.code}</span>
                  <span className="text-slate-400">·</span>
                  <span className="text-xs font-medium text-slate-600">{selectedVillage.block}</span>
                </div>
                <p className="text-xs text-slate-600">
                  Lead ASHA: <strong>{selectedVillage.ashaName}</strong> · Catchment Pop:{' '}
                  <span className="font-mono tabular-nums">{selectedVillage.population}</span> ·
                  Hospital Distance:{' '}
                  <span className="font-mono tabular-nums">{selectedVillage.phcDistanceKm} km</span>
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-right text-xs font-mono tabular-nums">
                  <div className="font-bold text-slate-900">
                    {selectedVillageStats?.totalCases ?? 0} Screenings ·{' '}
                    <span className="text-[#EF4444]">
                      {selectedVillageStats?.emergencyCount ?? 0} RED
                    </span>
                  </div>
                  {selectedVillageStats?.latestRecord && (
                    <div className="text-slate-500">
                      Latest: {selectedVillageStats.latestRecord.patientId} (BP{' '}
                      {selectedVillageStats.latestRecord.vitals.systolic}/
                      {selectedVillageStats.latestRecord.vitals.diastolic})
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setSearchQuery(selectedVillage.code)}
                  className="min-h-[42px] px-3.5 rounded-xl border border-slate-300 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-800 cursor-pointer whitespace-nowrap"
                >
                  Filter Sub-Center
                </button>
              </div>
            </div>
          </section>

          {/* Right Column (40% -> lg:col-span-5): Real-time Emergency Alert Feed */}
          <section
            aria-labelledby="realtime-feed-title"
            className="lg:col-span-5 rounded-2xl bg-white border border-slate-200 p-5 flex flex-col"
          >
            <div className="flex items-center justify-between gap-2 pb-3.5 border-b border-slate-200">
              <div>
                <h2 id="realtime-feed-title" className="text-base font-bold text-slate-900">
                  Real-Time Emergency Alert Feed
                </h2>
                <p className="text-xs text-slate-500">
                  Critical RED emergencies float to top · SMS &amp; Offline Sync stream
                </p>
              </div>
              <span className="font-mono text-xs font-bold text-[#EF4444] tabular-nums shrink-0">
                {criticalRedAlerts.length} RED
              </span>
            </div>

            <div className="mt-4 space-y-3.5 max-h-[500px] overflow-y-auto pr-1">
              {sortedAlertFeed.map((item) => {
                const isRed = item.severity === 'emergency';
                const isYellow = item.severity === 'moderate';
                const isDispatched = item.dispatchStatus === 'Dispatched';

                return (
                  <article
                    key={item.id}
                    onClick={() => setSelectedVillageCode(item.villageCode)}
                    className={`rounded-2xl p-4 transition-all cursor-pointer ${
                      isRed && !isDispatched
                        ? 'bg-red-50/55 border-2 border-[#EF4444] shadow-xs'
                        : isRed && isDispatched
                        ? 'bg-slate-50 border border-red-200'
                        : isYellow
                        ? 'bg-amber-50/40 border border-amber-200'
                        : 'bg-white border border-slate-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs text-slate-600 tabular-nums">
                          <span className="font-bold text-slate-900">{item.patientId}</span>
                          <span>·</span>
                          <span className="font-semibold text-[#0F766E]">{item.villageCode}</span>
                          <span>·</span>
                          <span>{item.timestamp}</span>
                        </div>
                        <h3 className="mt-1 text-sm font-bold text-slate-900">
                          {item.patientName}{' '}
                          <span className="font-normal text-slate-600">
                            ({item.age}
                            {item.gender} · ASHA {item.ashaWorker})
                          </span>
                        </h3>
                      </div>

                      <div className="text-right shrink-0">
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] font-bold ${
                            isRed
                              ? 'text-[#EF4444]'
                              : isYellow
                              ? 'text-[#F59E0B]'
                              : 'text-[#10B981]'
                          }`}
                        >
                          {isRed && !isDispatched && (
                            <span className="w-2 h-2 rounded-full bg-[#EF4444] animate-ping" />
                          )}
                          {isRed ? 'CRITICAL RED' : isYellow ? 'MODERATE' : 'ROUTINE'}
                        </span>
                        <div className="text-[11px] text-slate-500 flex items-center justify-end gap-1 mt-0.5">
                          <Radio className="w-3 h-3" />
                          <span>{item.channel}</span>
                        </div>
                      </div>
                    </div>

                    {/* Vitals Bar */}
                    <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-white border border-slate-200 p-2.5 text-center font-mono text-xs tabular-nums">
                      <div>
                        <span className="block text-[10px] font-sans text-slate-500">BP</span>
                        <strong
                          className={
                            item.vitals.systolic >= 160 ? 'text-[#EF4444]' : 'text-slate-900'
                          }
                        >
                          {item.vitals.systolic}/{item.vitals.diastolic}
                        </strong>
                      </div>
                      <div className="border-x border-slate-100">
                        <span className="block text-[10px] font-sans text-slate-500">SpO₂</span>
                        <strong
                          className={item.vitals.spo2 < 90 ? 'text-[#EF4444]' : 'text-slate-900'}
                        >
                          {item.vitals.spo2}%
                        </strong>
                      </div>
                      <div>
                        <span className="block text-[10px] font-sans text-slate-500">Temp</span>
                        <strong
                          className={
                            item.vitals.temperature > 100 ? 'text-[#F59E0B]' : 'text-slate-900'
                          }
                        >
                          {item.vitals.temperature.toFixed(1)}°F
                        </strong>
                      </div>
                    </div>

                    {/* 3 Required Action Buttons */}
                    <div className="mt-3 pt-3 border-t border-slate-200/80 space-y-2">
                      {isDispatched ? (
                        <div className="w-full min-h-[42px] px-3 rounded-xl bg-emerald-50 border border-emerald-200 text-[#0F766E] text-xs font-bold flex items-center justify-between">
                          <span className="inline-flex items-center gap-1.5">
                            <CheckCircle2 className="w-4 h-4 text-[#10B981]" />
                            Ambulance {item.ambulanceUnit} En Route
                          </span>
                          <span className="font-mono tabular-nums">ETA {item.etaMinutes} min</span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDispatchAmbulance(item.id);
                          }}
                          className={`w-full min-h-[44px] px-3.5 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer ${
                            isRed
                              ? 'bg-[#EF4444] hover:bg-red-600 text-white'
                              : 'bg-[#0F766E] hover:bg-teal-800 text-white'
                          }`}
                        >
                          <Ambulance className="w-4 h-4 shrink-0" />
                          <span>Dispatch Ambulance</span>
                        </button>
                      )}

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setInspectedRecord(item);
                            setDrawerMode('vitals');
                          }}
                          className="min-h-[40px] px-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-[11px] font-bold text-slate-800 inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                        >
                          <FileSpreadsheet className="w-3.5 h-3.5 text-[#0F766E]" />
                          <span>View Vitals Payload</span>
                        </button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setInspectedRecord(item);
                            setDrawerMode('decode');
                          }}
                          className="min-h-[40px] px-2.5 rounded-xl border border-slate-300 bg-slate-900 hover:bg-slate-800 text-[11px] font-bold text-white inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                        >
                          <Binary className="w-3.5 h-3.5 text-emerald-300" />
                          <span>Decode Binary SMS Payload</span>
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </div>

        {/* Searchable & Filterable Triage Registry Table */}
        <section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                District 24 Longitudinal Patient Triage Registry
              </h2>
              <p className="text-xs text-slate-500">
                Filterable by clinical severity status and sync channel (Data vs. Emergency SMS)
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search ID, ABHA, village..."
                  aria-label="Search patient triage registry"
                  className="min-h-[42px] pl-9 pr-3 w-52 sm:w-60 rounded-xl border border-slate-300 text-xs text-slate-900"
                />
              </div>

              <select
                aria-label="Filter by Severity"
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value as 'all' | SeverityLevel)}
                className="min-h-[42px] px-3 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-800 cursor-pointer"
              >
                <option value="all">Severity: All</option>
                <option value="emergency">Severity: RED Critical</option>
                <option value="moderate">Severity: Yellow Moderate</option>
                <option value="routine">Severity: Green Routine</option>
              </select>

              <select
                aria-label="Filter by Sync Channel"
                value={channelFilter}
                onChange={(e) => setChannelFilter(e.target.value as 'all' | SyncChannel)}
                className="min-h-[42px] px-3 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-800 cursor-pointer"
              >
                <option value="all">Channel: All</option>
                <option value="Data">Channel: Data Sync</option>
                <option value="Emergency SMS">Channel: Emergency SMS</option>
              </select>

              <button
                type="button"
                onClick={handleExportCsv}
                className="min-h-[42px] px-3.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-slate-800 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Download className="w-4 h-4 text-[#0F766E]" />
                <span>Export CSV</span>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="border-b border-slate-200 text-[11px] font-bold text-slate-500 bg-slate-50">
                <tr>
                  <th className="py-3 px-3">Patient / ABHA</th>
                  <th className="py-3 px-3">Sub-Center</th>
                  <th className="py-3 px-3 text-right">BP</th>
                  <th className="py-3 px-3 text-right">SpO₂</th>
                  <th className="py-3 px-3 text-right">Temp</th>
                  <th className="py-3 px-3">Severity</th>
                  <th className="py-3 px-3">Sync Channel</th>
                  <th className="py-3 px-3 text-right">SMS / FHIR Unpack</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredRegistry.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/80">
                    <td className="py-3 px-3 whitespace-nowrap">
                      <div className="font-bold text-slate-900">
                        <span className="font-mono text-[#0F766E]">{row.patientId}</span> ·{' '}
                        {row.patientName} ({row.age}
                        {row.gender})
                      </div>
                      <div className="font-mono text-[11px] text-slate-500 tabular-nums">
                        ABHA: {row.abhaId}
                      </div>
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap">
                      <span className="font-mono font-semibold text-slate-800">
                        {row.villageCode}
                      </span>{' '}
                      · <span className="text-slate-600">{row.ashaWorker}</span>
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-semibold tabular-nums whitespace-nowrap">
                      {row.vitals.systolic}/{row.vitals.diastolic}
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-semibold tabular-nums whitespace-nowrap">
                      {row.vitals.spo2}%
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-semibold tabular-nums whitespace-nowrap">
                      {row.vitals.temperature.toFixed(1)}°F
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap">
                      <span
                        className={`font-bold ${
                          row.severity === 'emergency'
                            ? 'text-[#EF4444]'
                            : row.severity === 'moderate'
                            ? 'text-[#F59E0B]'
                            : 'text-[#10B981]'
                        }`}
                      >
                        {row.severity.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap text-slate-700">
                      {row.channel} · <span className="text-slate-500">{row.syncStatus}</span>
                    </td>
                    <td className="py-3 px-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => {
                          setInspectedRecord(row);
                          setDrawerMode('decode');
                        }}
                        className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Binary className="w-3.5 h-3.5 text-emerald-300" />
                        <span>Decode SMS</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {/* Binary SMS Decoder & Vitals Payload Drawer */}
      <BinarySmsDecoderDrawer
        record={inspectedRecord}
        mode={drawerMode}
        onClose={() => setInspectedRecord(null)}
      />
    </div>
  );
};
