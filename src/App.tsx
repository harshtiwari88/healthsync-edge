/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {useState, useEffect} from 'react';
import {Smartphone, LayoutDashboard} from 'lucide-react';
import {
  Language,
  TriageRecord,
  VitalsSnapshot,
  evaluateTriage,
} from './types/triage';
import {INITIAL_TRIAGE_RECORDS, VILLAGE_SUB_CENTERS, TRANSLATIONS} from './data/initialData';
import {AshaWorkerPWA} from './components/AshaWorkerPWA';
import {DistrictCommandDashboard} from './components/DistrictCommandDashboard';

type ActivePortal = 'asha' | 'command';

const STORAGE_KEY = 'swasthyasetu_district24_records_v1';

export default function App() {
  const [activePortal, setActivePortal] = useState<ActivePortal>('asha');
  const [language, setLanguage] = useState<Language>('en');
  // Starts in simulated rural offline mode with 2 queued records to showcase the offline field workflow immediately
  const [isOfflineMode, setIsOfflineMode] = useState<boolean>(true);

  const [records, setRecords] = useState<TriageRecord[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as TriageRecord[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {
      // Fallback to initial seeded records
    }
    return INITIAL_TRIAGE_RECORDS;
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    } catch {
      // Ignore storage quota errors in restricted frames
    }
  }, [records]);

  const handleSaveRecord = (
    patientName: string,
    age: number,
    gender: 'F' | 'M',
    villageCode: string,
    vitals: VitalsSnapshot,
    clinicalNotes: string,
    channel: 'Data' | 'Emergency SMS'
  ): TriageRecord => {
    const village =
      VILLAGE_SUB_CENTERS.find((v) => v.code === villageCode) || VILLAGE_SUB_CENTERS[0];
    const evaluation = evaluateTriage(vitals);

    // Emergency SMS bypasses data outage and always delivers as RED high-priority alert if triggered via emergency SMS button
    const effectiveSeverity =
      channel === 'Emergency SMS' && evaluation.severity === 'routine'
        ? 'emergency'
        : channel === 'Emergency SMS'
        ? 'emergency'
        : evaluation.severity;

    const now = new Date();
    const formattedTime = now.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

    const newRecord: TriageRecord = {
      id: `rec-${Date.now()}`,
      patientId: `PT-${2480 + records.length + 1}`,
      patientName,
      age,
      gender,
      villageCode: village.code,
      villageName: village.name,
      ashaWorker: village.ashaName,
      vitals: {...vitals},
      severity: effectiveSeverity,
      clinicalNotes,
      channel,
      syncStatus:
        channel === 'Emergency SMS'
          ? 'SMS Delivered'
          : isOfflineMode
          ? 'Queued Offline'
          : 'Synced',
      timestamp: formattedTime,
      createdAtMs: Date.now(),
      dispatchStatus: 'Unassigned',
    };

    setRecords((prev) => [newRecord, ...prev]);
    return newRecord;
  };

  const handleSyncOfflineQueue = (): number => {
    let syncedCount = 0;
    setRecords((prev) =>
      prev.map((rec) => {
        if (rec.syncStatus === 'Queued Offline') {
          syncedCount += 1;
          return {...rec, syncStatus: 'Synced'};
        }
        return rec;
      })
    );
    if (syncedCount > 0) {
      setIsOfflineMode(false);
    }
    return syncedCount;
  };

  const handleDispatchAmbulance = (recordId: string) => {
    setRecords((prev) =>
      prev.map((rec, idx) => {
        if (rec.id !== recordId) return rec;
        const village = VILLAGE_SUB_CENTERS.find((v) => v.code === rec.villageCode);
        const eta = village ? Math.max(8, Math.round(village.phcDistanceKm * 1.15)) : 14;
        const unitNum = String(((idx + 3) % 9) + 1).padStart(2, '0');
        return {
          ...rec,
          dispatchStatus: 'Dispatched',
          ambulanceUnit: `108-ALS-${unitNum}`,
          etaMinutes: eta,
        };
      })
    );
  };

  const unassignedEmergencies = records.filter(
    (r) => r.severity === 'emergency' && r.dispatchStatus === 'Unassigned'
  ).length;
  const queuedOfflineCount = records.filter((r) => r.syncStatus === 'Queued Offline').length;
  const t = TRANSLATIONS[language];

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Unified Role Switcher Bar */}
      <div className="bg-slate-900 text-white border-b border-slate-800">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-2 flex items-center justify-between gap-4">
          <span className="text-sm font-bold tracking-tight text-white whitespace-nowrap shrink-0">
            SwasthyaSetu
          </span>

          <div
            role="tablist"
            aria-label="Application View Switcher"
            className="flex items-center gap-1 p-1 rounded-xl bg-slate-800"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activePortal === 'asha'}
              onClick={() => setActivePortal('asha')}
              className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap ${
                activePortal === 'asha'
                  ? 'bg-[#0F766E] text-white shadow-xs'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5 shrink-0" />
              <span>{t.ashaPortalLabel}</span>
              {queuedOfflineCount > 0 && (
                <span className="font-mono tabular-nums opacity-90">({queuedOfflineCount})</span>
              )}
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activePortal === 'command'}
              onClick={() => setActivePortal('command')}
              className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap ${
                activePortal === 'command'
                  ? 'bg-[#0F766E] text-white shadow-xs'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <LayoutDashboard className="w-3.5 h-3.5 shrink-0" />
              <span>{t.commandPortalLabel}</span>
              {unassignedEmergencies > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-red-600 text-white font-mono text-[11px] font-bold tabular-nums">
                  {unassignedEmergencies}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Active Workspace */}
      <div className="flex-1">
        {activePortal === 'asha' ? (
          <AshaWorkerPWA
            records={records}
            language={language}
            onLanguageChange={setLanguage}
            isOfflineMode={isOfflineMode}
            onToggleOfflineMode={() => setIsOfflineMode((prev) => !prev)}
            onSaveRecord={handleSaveRecord}
            onSyncOfflineQueue={handleSyncOfflineQueue}
            onOpenCommandPortal={() => setActivePortal('command')}
          />
        ) : (
          <DistrictCommandDashboard
            records={records}
            onDispatchAmbulance={handleDispatchAmbulance}
            onSyncOfflineQueue={handleSyncOfflineQueue}
          />
        )}
      </div>
    </div>
  );
}
