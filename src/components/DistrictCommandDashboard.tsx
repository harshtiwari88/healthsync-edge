import React, {useState, useEffect, useMemo, useRef} from 'react';
import {
  Clock,
  Activity,
  Siren,
  AlertTriangle,
  CheckCircle2,
  Ambulance,
  Search,
  ChevronUp,
  ChevronDown,
  Download,
  RefreshCw,
  MapPin,
  Radio,
  Wifi,
  Building2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from 'lucide-react';
import {SeverityLevel, SyncChannel, TriageRecord, VillageSubCenter} from '../types/triage';
import {VILLAGE_SUB_CENTERS} from '../data/initialData';
import {PWAInstallButton} from './PWAInstallButton';

interface DistrictCommandDashboardProps {
  records: TriageRecord[];
  onDispatchAmbulance: (recordId: string) => void;
  onSyncOfflineQueue: () => number;
}

type DrawerState = 'collapsed' | 'docked' | 'expanded';

export const DistrictCommandDashboard: React.FC<DistrictCommandDashboardProps> = ({
  records,
  onDispatchAmbulance,
  onSyncOfflineQueue,
}) => {
  const [currentTime, setCurrentTime] = useState<Date>(() => new Date());
  const [selectedVillageCode, setSelectedVillageCode] = useState<string>('VLG-2402');
  const [mapFilter, setMapFilter] = useState<'all' | SeverityLevel>('all');
  const [mapZoom, setMapZoom] = useState<number>(1);
  const [lastHealthPing, setLastHealthPing] = useState<string>('All 7 sub-center gateways reachable');
  const [isCheckingSync, setIsCheckingSync] = useState<boolean>(false);

  // Bottom Drawer & Search/Filter states
  const [drawerState, setDrawerState] = useState<DrawerState>('docked');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [severityFilter, setSeverityFilter] = useState<'all' | SeverityLevel>('all');
  const [channelFilter, setChannelFilter] = useState<'all' | SyncChannel>('all');

  const alertFeedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Summary Metrics
  const totalScreeningsToday = records.length;
  const pendingSyncsCount = records.filter((r) => r.syncStatus === 'Queued Offline').length;
  const moderateRiskCount = records.filter((r) => r.severity === 'moderate').length;
  const criticalRedEmergencies = records.filter((r) => r.severity === 'emergency');
  const unassignedRedCount = criticalRedEmergencies.filter(
    (r) => r.dispatchStatus === 'Unassigned'
  ).length;

  // Compute highest severity per Village Sub-Center for Map Pins
  const villageStatusMap = useMemo(() => {
    const map = new Map<
      string,
      {
        highestSeverity: SeverityLevel;
        count: number;
        unassignedEmergencies: number;
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
      const unassigned = vRecords.filter(
        (r) => r.severity === 'emergency' && r.dispatchStatus === 'Unassigned'
      ).length;
      const dispatchedRec = vRecords.find((r) => r.dispatchStatus === 'Dispatched');

      map.set(v.code, {
        highestSeverity: highest,
        count: vRecords.length,
        unassignedEmergencies: unassigned,
        dispatchedUnit: dispatchedRec?.ambulanceUnit,
        latestRecord: vRecords[0],
      });
    }
    return map;
  }, [records]);

  const selectedVillage: VillageSubCenter =
    VILLAGE_SUB_CENTERS.find((v) => v.code === selectedVillageCode) || VILLAGE_SUB_CENTERS[0];
  const selectedVillageStats = villageStatusMap.get(selectedVillage.code);

  // Filtered Table History
  const filteredHistory = useMemo(() => {
    return records.filter((r) => {
      if (severityFilter !== 'all' && r.severity !== severityFilter) return false;
      if (channelFilter !== 'all' && r.channel !== channelFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const match =
          r.patientId.toLowerCase().includes(q) ||
          r.patientName.toLowerCase().includes(q) ||
          r.villageCode.toLowerCase().includes(q) ||
          r.villageName.toLowerCase().includes(q) ||
          r.ashaWorker.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [records, severityFilter, channelFilter, searchQuery]);

  const handleRunConnectivityCheck = () => {
    setIsCheckingSync(true);
    const syncedNow = onSyncOfflineQueue();
    setTimeout(() => {
      setIsCheckingSync(false);
      setLastHealthPing(
        syncedNow > 0
          ? `Synced ${syncedNow} pending sub-center record${syncedNow > 1 ? 's' : ''} · SMS & Data healthy`
          : 'SMS Gateway 99.9% · Sub-center sync healthy'
      );
    }, 350);
  };

  const handleExportCsv = () => {
    const header = [
      'Patient ID',
      'Patient Name',
      'Age',
      'Sex',
      'Village Code',
      'Sub-Center',
      'ASHA Worker',
      'Systolic BP',
      'Diastolic BP',
      'SpO2 (%)',
      'Temp (F)',
      'Severity',
      'Channel',
      'Sync Status',
      'Dispatch Status',
      'Timestamp',
    ];
    const rows = filteredHistory.map((r) => [
      r.patientId,
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
      `"${r.syncStatus}"`,
      `"${r.ambulanceUnit ? `${r.dispatchStatus} (${r.ambulanceUnit})` : r.dispatchStatus}"`,
      `"${r.timestamp}"`,
    ]);
    const csv = [header.join(','), ...rows.map((row) => row.join(','))].join('\n');
    const blob = new Blob([csv], {type: 'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `district24-triage-log-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const formattedClock = currentTime.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });

  const bottomPaddingClass =
    drawerState === 'expanded' ? 'pb-96' : drawerState === 'docked' ? 'pb-80' : 'pb-20';

  return (
    <div className={`min-h-screen bg-slate-50 ${bottomPaddingClass}`}>
      {/* Command Center Top Bar */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#0F766E] text-white flex items-center justify-center shrink-0">
              <Building2 className="w-5 h-5" />
            </div>
            <h1 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 truncate">
              District 24 Triage Command Portal
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
            {/* Real-time Clock */}
            <div className="min-h-[40px] px-3.5 rounded-xl bg-slate-100 text-slate-800 text-xs sm:text-sm font-mono font-semibold inline-flex items-center gap-2 tabular-nums whitespace-nowrap">
              <Clock className="w-4 h-4 text-[#0F766E] shrink-0" />
              <span>{formattedClock} IST</span>
            </div>

            {/* Sync Connectivity Health Check Badge */}
            <button
              type="button"
              onClick={handleRunConnectivityCheck}
              className="min-h-[40px] px-3.5 rounded-xl border border-teal-200 bg-teal-50 hover:bg-teal-100 text-[#0F766E] text-xs font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
              title={lastHealthPing}
            >
              {isCheckingSync ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
              ) : (
                <Wifi className="w-3.5 h-3.5 shrink-0" />
              )}
              <span>
                {pendingSyncsCount > 0
                  ? `Sync Health: ${pendingSyncsCount} Pending (Pull Now)`
                  : 'Sync Health: Nominal (7/7 SCs)'}
              </span>
            </button>

            {/* Emergency Alert Counter Badge in Red */}
            <button
              type="button"
              onClick={() => alertFeedRef.current?.scrollIntoView({behavior: 'smooth'})}
              className="min-h-[40px] px-3.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold inline-flex items-center gap-2 shadow-xs transition-colors cursor-pointer whitespace-nowrap"
            >
              <Siren className="w-4 h-4 shrink-0" />
              <span>Active Emergencies</span>
              <span className="px-2 py-0.5 rounded-full bg-white text-red-700 font-mono text-xs font-bold tabular-nums">
                {unassignedRedCount}
              </span>
            </button>

            <PWAInstallButton />
          </div>
        </div>
      </header>

      <main className="max-w-[1440px] mx-auto px-4 sm:px-6 pt-6 space-y-6">
        {/* Metrics Row: 4 Summary Cards */}
        <section aria-label="District Summary Metrics" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {/* Card 1: Total Screenings Today */}
          <button
            type="button"
            onClick={() => {
              setSeverityFilter('all');
              setDrawerState('docked');
            }}
            className="text-left rounded-2xl bg-white border border-slate-200 hover:border-slate-300 p-5 transition-colors cursor-pointer"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-500">Total Screenings Today</span>
              <Activity className="w-4 h-4 text-[#0F766E]" />
            </div>
            <p className="mt-2 font-mono text-3xl font-bold text-slate-900 tabular-nums">
              {totalScreeningsToday}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Across 7 reporting village sub-centers
            </p>
          </button>

          {/* Card 2: Pending Syncs */}
          <button
            type="button"
            onClick={handleRunConnectivityCheck}
            className="text-left rounded-2xl bg-white border border-slate-200 hover:border-slate-300 p-5 transition-colors cursor-pointer"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-500">Pending Syncs</span>
              <RefreshCw className="w-4 h-4 text-slate-600" />
            </div>
            <p className="mt-2 font-mono text-3xl font-bold text-slate-900 tabular-nums">
              {pendingSyncsCount}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {pendingSyncsCount > 0
                ? 'Cached on field devices · Click to sync'
                : 'All offline field queues synchronized'}
            </p>
          </button>

          {/* Card 3: Moderate Yellow Risk */}
          <button
            type="button"
            onClick={() => {
              setSeverityFilter('moderate');
              setDrawerState('docked');
            }}
            className="text-left rounded-2xl bg-white border border-amber-200 hover:border-amber-300 p-5 transition-colors cursor-pointer"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-amber-900">Moderate Yellow Risk</span>
              <AlertTriangle className="w-4 h-4 text-amber-600" />
            </div>
            <p className="mt-2 font-mono text-3xl font-bold text-amber-700 tabular-nums">
              {moderateRiskCount}
            </p>
            <p className="mt-1 text-xs text-slate-600">
              Queued for PHC Medical Officer tele-review
            </p>
          </button>

          {/* Card 4: Critical RED Emergencies */}
          <button
            type="button"
            onClick={() => {
              setSeverityFilter('emergency');
              setDrawerState('docked');
            }}
            className="text-left rounded-2xl bg-red-50/60 border border-red-200 hover:border-red-300 p-5 transition-colors cursor-pointer"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-red-900">Critical RED Emergencies</span>
              <Siren className="w-4 h-4 text-red-600" />
            </div>
            <div className="mt-2 flex items-baseline gap-2.5">
              <span className="font-mono text-3xl font-bold text-red-700 tabular-nums">
                {criticalRedEmergencies.length}
              </span>
              <span className="text-xs font-semibold text-red-800 tabular-nums">
                ({unassignedRedCount} awaiting dispatch)
              </span>
            </div>
            <p className="mt-1 text-xs text-red-900/80">
              Priority SMS &amp; Data bypass stream
            </p>
          </button>
        </section>

        {/* Main View: 2-Column Grid — Left 60% (lg:col-span-7) Map, Right 40% (lg:col-span-5) Alert Feed */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* Left 60%: Interactive Village Sub-Center Map */}
          <section
            aria-labelledby="district-map-heading"
            className="lg:col-span-7 rounded-2xl bg-white border border-slate-200 p-5 flex flex-col justify-between"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h2 id="district-map-heading" className="text-base font-bold text-slate-900">
                  District 24 Sub-Center Risk Topology
                </h2>
                <p className="text-xs text-slate-500">
                  Select any village pin to inspect sub-center vitals, ASHA worker &amp; PHC distance
                </p>
              </div>

              {/* Interactive Map Risk Filter */}
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
                {(
                  [
                    {id: 'all', label: 'All (7)'},
                    {id: 'emergency', label: 'Red'},
                    {id: 'moderate', label: 'Yellow'},
                    {id: 'routine', label: 'Green'},
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setMapFilter(tab.id)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      mapFilter === tab.id
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Interactive SVG Map Viewport */}
            <div className="relative w-full h-[360px] sm:h-[400px] rounded-xl bg-slate-100 border border-slate-200 overflow-hidden select-none">
              {/* Zoom controls */}
              <div className="absolute top-3 right-3 z-20 flex flex-col gap-1.5 bg-white/90 backdrop-blur-xs p-1 rounded-xl border border-slate-200">
                <button
                  type="button"
                  onClick={() => setMapZoom((z) => Math.min(1.35, Number((z + 0.15).toFixed(2))))}
                  aria-label="Zoom in map"
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-700 hover:bg-slate-100 cursor-pointer"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setMapZoom((z) => Math.max(0.85, Number((z - 0.15).toFixed(2))))}
                  aria-label="Zoom out map"
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-700 hover:bg-slate-100 cursor-pointer"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setMapZoom(1)}
                  aria-label="Reset map zoom"
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-700 hover:bg-slate-100 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Legend */}
              <div className="absolute bottom-3 left-3 z-20 flex flex-wrap items-center gap-3 bg-white/95 backdrop-blur-xs px-3 py-2 rounded-xl border border-slate-200 text-xs font-medium text-slate-700">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-red-600 inline-block" />
                  Red Emergency
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-amber-500 inline-block" />
                  Yellow Risk
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-emerald-600 inline-block" />
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
                  aria-label="District 24 Interactive Sub-Center Map"
                >
                  {/* Subtle coordinate grid */}
                  <defs>
                    <pattern id="d24-grid" width="60" height="60" patternUnits="userSpaceOnUse">
                      <path
                        d="M 60 0 L 0 0 0 60"
                        fill="none"
                        stroke="#CBD5E1"
                        strokeWidth="0.7"
                        strokeDasharray="2 2"
                      />
                    </pattern>
                  </defs>
                  <rect width="800" height="460" fill="#F1F5F9" />
                  <rect width="800" height="460" fill="url(#d24-grid)" />

                  {/* District 24 Administrative Boundary Polygon */}
                  <path
                    d="M 75 95 L 250 45 L 575 52 L 730 140 L 710 365 L 535 420 L 210 405 L 80 305 Z"
                    fill="#FFFFFF"
                    fillOpacity="0.78"
                    stroke="#94A3B8"
                    strokeWidth="2"
                  />

                  {/* Gomti River Basin Waterway */}
                  <path
                    d="M 90 190 C 230 210, 310 145, 450 220 C 570 285, 640 245, 730 290"
                    fill="none"
                    stroke="#BAE6FD"
                    strokeWidth="14"
                    strokeLinecap="round"
                  />

                  {/* Rural Road Network connecting Sub-Centers to Central District Hospital (400, 235) */}
                  {VILLAGE_SUB_CENTERS.map((v) => {
                    const vx = (v.x / 100) * 800;
                    const vy = (v.y / 100) * 460;
                    const stats = villageStatusMap.get(v.code);
                    const isDispatched = Boolean(stats?.dispatchedUnit);
                    return (
                      <line
                        key={`road-${v.code}`}
                        x1={400}
                        y1={235}
                        x2={vx}
                        y2={vy}
                        stroke={isDispatched ? '#0F766E' : '#CBD5E1'}
                        strokeWidth={isDispatched ? '3' : '2'}
                        strokeDasharray={isDispatched ? '6 4' : undefined}
                      />
                    );
                  })}

                  {/* Central District 24 Civil Hospital Hub */}
                  <g transform="translate(400, 235)">
                    <circle r="18" fill="#0F766E" />
                    <path
                      d="M -6 -2 H -2 V -6 H 2 V -2 H 6 V 2 H 2 V 6 H -2 V 2 H -6 Z"
                      fill="#FFFFFF"
                    />
                    <text
                      y="32"
                      textAnchor="middle"
                      className="fill-slate-900 text-[11px] font-bold"
                    >
                      District 24 Hospital HQ
                    </text>
                  </g>
                </svg>

                {/* Interactive HTML Pin Buttons overlaid accurately by percentage coordinates */}
                {VILLAGE_SUB_CENTERS.map((village) => {
                  const stats = villageStatusMap.get(village.code);
                  const sev = stats?.highestSeverity || 'routine';
                  if (mapFilter !== 'all' && sev !== mapFilter) return null;

                  const isSelected = village.code === selectedVillageCode;
                  const pinColors =
                    sev === 'emergency'
                      ? 'bg-red-600 text-white border-white'
                      : sev === 'moderate'
                      ? 'bg-amber-500 text-slate-950 border-white'
                      : 'bg-emerald-600 text-white border-white';

                  return (
                    <button
                      key={village.code}
                      type="button"
                      onClick={() => setSelectedVillageCode(village.code)}
                      style={{left: `${village.x}%`, top: `${village.y}%`}}
                      className={`absolute -translate-x-1/2 -translate-y-1/2 z-10 group cursor-pointer flex flex-col items-center`}
                      aria-label={`${village.name} (${village.code}) — ${sev} status`}
                    >
                      <span className="relative flex items-center justify-center">
                        {sev === 'emergency' && (
                          <span
                            aria-hidden="true"
                            className="absolute -inset-2 rounded-full bg-red-500/35 animate-mic-ripple"
                          />
                        )}
                        <span
                          className={`min-h-[38px] min-w-[38px] px-2.5 rounded-full border-2 shadow-md flex items-center justify-center gap-1 font-mono text-xs font-bold transition-transform ${pinColors} ${
                            isSelected ? 'scale-115 ring-3 ring-slate-900/80' : 'group-hover:scale-105'
                          }`}
                        >
                          <MapPin className="w-3.5 h-3.5 shrink-0" />
                          <span>{village.code.replace('VLG-', '')}</span>
                        </span>
                      </span>
                      <span
                        className={`mt-1 px-2 py-0.5 rounded-md text-[11px] font-semibold whitespace-nowrap border ${
                          isSelected
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white/95 text-slate-800 border-slate-200'
                        }`}
                      >
                        {village.name.replace(' SC', '')}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Selected Sub-Center Inspector Strip */}
            <div className="mt-4 pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                  <span>{selectedVillage.name}</span>
                  <span className="text-slate-400">·</span>
                  <span className="font-mono text-xs text-slate-600">{selectedVillage.code}</span>
                  <span className="text-slate-400">·</span>
                  <span className="text-xs font-medium text-slate-600">{selectedVillage.block}</span>
                </div>
                <p className="mt-1 text-xs text-slate-600">
                  ASHA: <strong>{selectedVillage.ashaName}</strong> · Pop:{' '}
                  <span className="font-mono tabular-nums">{selectedVillage.population}</span> ·
                  Dist to HQ:{' '}
                  <span className="font-mono tabular-nums">{selectedVillage.phcDistanceKm} km</span>
                </p>
              </div>

              <div className="flex items-center gap-3">
                {selectedVillageStats?.latestRecord && (
                  <div className="text-right font-mono text-xs text-slate-700 tabular-nums">
                    <div>
                      Latest: {selectedVillageStats.latestRecord.patientId} (BP{' '}
                      {selectedVillageStats.latestRecord.vitals.systolic}/
                      {selectedVillageStats.latestRecord.vitals.diastolic} · SpO₂{' '}
                      {selectedVillageStats.latestRecord.vitals.spo2}%)
                    </div>
                    {selectedVillageStats.dispatchedUnit && (
                      <div className="text-[#0F766E] font-semibold">
                        Unit {selectedVillageStats.dispatchedUnit} En Route
                      </div>
                    )}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery(selectedVillage.code);
                    setSeverityFilter('all');
                    setChannelFilter('all');
                    setDrawerState('docked');
                  }}
                  className="min-h-[40px] px-3.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 transition-colors cursor-pointer whitespace-nowrap"
                >
                  Filter History
                </button>
              </div>
            </div>
          </section>

          {/* Right 40%: High-Priority RED Emergency Alert Feed */}
          <section
            ref={alertFeedRef}
            aria-labelledby="priority-feed-heading"
            className="lg:col-span-5 rounded-2xl bg-white border border-slate-200 p-5 flex flex-col"
          >
            <div className="flex items-center justify-between gap-2 pb-3.5 border-b border-slate-200">
              <div>
                <h2 id="priority-feed-heading" className="text-base font-bold text-slate-900">
                  High-Priority RED Emergency Feed
                </h2>
                <p className="text-xs text-slate-500">
                  Incoming critical SMS bypass &amp; field data alerts
                </p>
              </div>
              <span className="font-mono text-xs font-bold text-red-700 tabular-nums whitespace-nowrap">
                {criticalRedEmergencies.length} Total · {unassignedRedCount} Open
              </span>
            </div>

            <div className="mt-4 space-y-3.5 max-h-[450px] overflow-y-auto pr-1">
              {criticalRedEmergencies.length === 0 ? (
                <div className="py-12 text-center space-y-2">
                  <CheckCircle2 className="w-8 h-8 text-[#0F766E] mx-auto" />
                  <p className="text-sm font-semibold text-slate-800">
                    Zero Active RED Emergencies
                  </p>
                  <p className="text-xs text-slate-500">
                    Incoming emergency SMS or critical vitals will appear here immediately.
                  </p>
                </div>
              ) : (
                criticalRedEmergencies.map((alert) => {
                  const isDispatched = alert.dispatchStatus === 'Dispatched';
                  return (
                    <article
                      key={alert.id}
                      onClick={() => setSelectedVillageCode(alert.villageCode)}
                      className={`rounded-2xl border p-4 transition-colors cursor-pointer ${
                        isDispatched
                          ? 'bg-slate-50 border-slate-200'
                          : 'bg-red-50/45 border-red-200 hover:border-red-300'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2 text-xs text-slate-600 font-mono tabular-nums">
                            <span className="font-bold text-slate-900">{alert.patientId}</span>
                            <span>·</span>
                            <span>{alert.villageCode}</span>
                            <span>·</span>
                            <span>{alert.timestamp}</span>
                          </div>
                          <h3 className="mt-1 text-sm font-bold text-slate-900">
                            {alert.patientName}{' '}
                            <span className="font-normal text-slate-600">
                              ({alert.age}
                              {alert.gender} · {alert.villageName})
                            </span>
                          </h3>
                        </div>

                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 whitespace-nowrap shrink-0">
                          <Radio className="w-3.5 h-3.5" />
                          {alert.channel}
                        </span>
                      </div>

                      {/* Vitals Snapshot */}
                      <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-white border border-slate-200 p-2.5 text-center font-mono tabular-nums">
                        <div>
                          <div className="text-[11px] text-slate-500 font-sans">BP (mmHg)</div>
                          <div
                            className={`text-xs sm:text-sm font-bold ${
                              alert.vitals.systolic >= 160 ||
                              alert.vitals.systolic < 80 ||
                              alert.vitals.diastolic >= 100
                                ? 'text-red-700'
                                : 'text-slate-900'
                            }`}
                          >
                            {alert.vitals.systolic}/{alert.vitals.diastolic}
                          </div>
                        </div>
                        <div className="border-l border-r border-slate-100">
                          <div className="text-[11px] text-slate-500 font-sans">SpO₂</div>
                          <div
                            className={`text-xs sm:text-sm font-bold ${
                              alert.vitals.spo2 <= 90 ? 'text-red-700' : 'text-slate-900'
                            }`}
                          >
                            {alert.vitals.spo2}%
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] text-slate-500 font-sans">Temp</div>
                          <div
                            className={`text-xs sm:text-sm font-bold ${
                              alert.vitals.temperature >= 102.0 ? 'text-red-700' : 'text-slate-900'
                            }`}
                          >
                            {alert.vitals.temperature.toFixed(1)}°F
                          </div>
                        </div>
                      </div>

                      <p className="mt-2.5 text-xs text-slate-600 line-clamp-2">
                        {alert.clinicalNotes}
                      </p>

                      <div className="mt-3.5">
                        {isDispatched ? (
                          <div className="w-full min-h-[42px] px-3.5 rounded-xl bg-teal-50 border border-teal-200 text-[#0F766E] text-xs font-bold flex items-center justify-between gap-2">
                            <span className="inline-flex items-center gap-2">
                              <Ambulance className="w-4 h-4 shrink-0" />
                              <span>Ambulance {alert.ambulanceUnit} Dispatched</span>
                            </span>
                            <span className="font-mono tabular-nums">
                              ETA {alert.etaMinutes} min
                            </span>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDispatchAmbulance(alert.id);
                            }}
                            className="w-full min-h-[44px] px-4 rounded-xl bg-red-600 hover:bg-red-700 active:scale-[0.99] text-white text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 transition-all cursor-pointer whitespace-nowrap"
                          >
                            <Ambulance className="w-4 h-4 shrink-0" />
                            <span>Dispatch Ambulatory Care</span>
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </section>
        </div>
      </main>

      {/* Bottom Drawer: Searchable & Filterable Patient Triage History Data Table */}
      <section
        aria-label="Patient Triage History Drawer"
        className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-slate-300 shadow-xl"
      >
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6">
          {/* Drawer Header & Filter Controls */}
          <div className="py-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() =>
                  setDrawerState((s) =>
                    s === 'collapsed' ? 'docked' : s === 'docked' ? 'expanded' : 'collapsed'
                  )
                }
                className="min-h-[40px] px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-900 text-xs sm:text-sm font-bold inline-flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
              >
                {drawerState === 'collapsed' ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
                <span>Patient Triage History</span>
                <span className="font-mono text-xs text-slate-600 tabular-nums">
                  ({filteredHistory.length})
                </span>
              </button>

              {drawerState !== 'collapsed' && (
                <button
                  type="button"
                  onClick={() =>
                    setDrawerState((s) => (s === 'expanded' ? 'docked' : 'expanded'))
                  }
                  className="hidden sm:inline-flex min-h-[36px] px-2.5 rounded-lg text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 cursor-pointer whitespace-nowrap"
                >
                  {drawerState === 'expanded' ? 'Restore Split Height' : 'Expand Full Table'}
                </button>
              )}
            </div>

            {drawerState !== 'collapsed' && (
              <div className="flex flex-wrap items-center gap-2.5">
                {/* Search Input */}
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search ID, patient, village..."
                    aria-label="Search triage history"
                    className="min-h-[38px] pl-9 pr-3 w-48 sm:w-56 rounded-xl border border-slate-300 text-xs text-slate-900"
                  />
                </div>

                {/* Severity Filter */}
                <select
                  aria-label="Filter by Severity Status"
                  value={severityFilter}
                  onChange={(e) => setSeverityFilter(e.target.value as 'all' | SeverityLevel)}
                  className="min-h-[38px] px-3 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-800 cursor-pointer"
                >
                  <option value="all">Severity: All</option>
                  <option value="emergency">Severity: RED Emergency</option>
                  <option value="moderate">Severity: Yellow Moderate</option>
                  <option value="routine">Severity: Green Routine</option>
                </select>

                {/* Sync Channel Filter */}
                <select
                  aria-label="Filter by Sync Channel"
                  value={channelFilter}
                  onChange={(e) => setChannelFilter(e.target.value as 'all' | SyncChannel)}
                  className="min-h-[38px] px-3 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-800 cursor-pointer"
                >
                  <option value="all">Channel: All</option>
                  <option value="Data">Channel: Data Sync</option>
                  <option value="Emergency SMS">Channel: Emergency SMS</option>
                </select>

                {/* Export CSV */}
                <button
                  type="button"
                  onClick={handleExportCsv}
                  className="min-h-[38px] px-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5 text-[#0F766E]" />
                  <span>Download CSV</span>
                </button>
              </div>
            )}
          </div>

          {/* Scrollable High-Density Data Table */}
          {drawerState !== 'collapsed' && (
            <div
              className={`overflow-x-auto overflow-y-auto transition-all ${
                drawerState === 'expanded' ? 'max-h-[340px]' : 'max-h-[210px]'
              }`}
            >
              {filteredHistory.length === 0 ? (
                <div className="py-10 text-center space-y-2">
                  <p className="text-sm font-semibold text-slate-800">
                    No matching patient triage records
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setSeverityFilter('all');
                      setChannelFilter('all');
                    }}
                    className="min-h-[38px] px-3.5 rounded-xl bg-slate-900 text-white text-xs font-semibold cursor-pointer"
                  >
                    Reset Filters
                  </button>
                </div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500">
                    <tr>
                      <th className="py-2.5 pr-4">Patient ID</th>
                      <th className="py-2.5 px-3">Patient</th>
                      <th className="py-2.5 px-3">Sub-Center</th>
                      <th className="py-2.5 px-3 text-right">BP (mmHg)</th>
                      <th className="py-2.5 px-3 text-right">SpO₂</th>
                      <th className="py-2.5 px-3 text-right">Temp</th>
                      <th className="py-2.5 px-3">Severity</th>
                      <th className="py-2.5 px-3">Channel &amp; Sync</th>
                      <th className="py-2.5 pl-3 text-right">Action / Care</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {filteredHistory.map((row) => (
                      <tr
                        key={row.id}
                        onClick={() => setSelectedVillageCode(row.villageCode)}
                        className="hover:bg-slate-50/90 cursor-pointer"
                      >
                        <td className="py-2.5 pr-4 font-mono font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                          {row.patientId}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span className="font-semibold text-slate-900">{row.patientName}</span>{' '}
                          <span className="text-slate-500 font-mono tabular-nums">
                            · {row.age}
                            {row.gender}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-700 whitespace-nowrap">
                          <span className="font-mono text-slate-500">{row.villageCode}</span> ·{' '}
                          {row.villageName}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-900 whitespace-nowrap">
                          {row.vitals.systolic}/{row.vitals.diastolic}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-900 whitespace-nowrap">
                          {row.vitals.spo2}%
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-900 whitespace-nowrap">
                          {row.vitals.temperature.toFixed(1)}°F
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span
                            className={`font-bold ${
                              row.severity === 'emergency'
                                ? 'text-red-700'
                                : row.severity === 'moderate'
                                ? 'text-amber-700'
                                : 'text-[#0F766E]'
                            }`}
                          >
                            {row.severity === 'emergency'
                              ? 'EMERGENCY'
                              : row.severity === 'moderate'
                              ? 'Moderate Risk'
                              : 'Routine'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap">
                          {row.channel} · {row.syncStatus}
                        </td>
                        <td className="py-2.5 pl-3 text-right whitespace-nowrap">
                          {row.severity === 'emergency' ? (
                            row.dispatchStatus === 'Dispatched' ? (
                              <span className="font-mono text-[#0F766E] font-semibold tabular-nums">
                                {row.ambulanceUnit} ({row.etaMinutes}m)
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onDispatchAmbulance(row.id);
                                }}
                                className="px-2.5 py-1 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold cursor-pointer"
                              >
                                Dispatch 108
                              </button>
                            )
                          ) : (
                            <span className="text-slate-400">Logged · {row.timestamp}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
