/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {useState, useEffect, useRef} from 'react';
import {
  EdgeAiDiagnostics,
  IncentiveEntry,
  Language,
  NetworkState,
  SymptomKey,
  TriageRecord,
  VitalsSnapshot,
  evaluateTriage,
} from './types/triage';
import {
  INITIAL_INCENTIVE_LEDGER,
  INITIAL_TRIAGE_RECORDS,
  VILLAGE_SUB_CENTERS,
} from './data/initialData';
import {encodeVitalsToSMS} from './utils/binarySmsCodec';
import {sirenEngine} from './utils/sirenAudio';
import {
  HealthSyncRealtimeClient,
  loadStoredRecords,
  persistStoredRecords,
} from './utils/realtimeSync';
import {LoginPage} from './components/LoginPage';
import {TopRoleToolbar} from './components/TopRoleToolbar';
import {AshaWorkerPWA} from './components/AshaWorkerPWA';
import {DistrictCommandDashboard} from './components/DistrictCommandDashboard';

type AppRoute = 'login' | 'asha' | 'command';

const INCENTIVES_STORAGE_KEY = 'healthsync_incentives_v3';

export default function App() {
  const [route, setRoute] = useState<AppRoute>('login');
  const [language, setLanguage] = useState<Language>('en');
  const [ashaId, setAshaId] = useState<string>('ASHA-8842-UP');
  const [dmoEmail, setDmoEmail] = useState<string>('dmo.district24@nhm.up.gov.in');
  const [networkState, setNetworkState] = useState<NetworkState>('4g');
  const [audioMuted, setAudioMuted] = useState<boolean>(false);
  const [connectedPeers, setConnectedPeers] = useState<number>(1);

  // Active flashing emergency banner & siren state for District Command Dashboard
  const [activeEmergencyBanner, setActiveEmergencyBanner] = useState<TriageRecord | null>(null);
  const [isSirenRinging, setIsSirenRinging] = useState<boolean>(false);

  const [records, setRecords] = useState<TriageRecord[]>(() =>
    loadStoredRecords(INITIAL_TRIAGE_RECORDS)
  );

  const [incentives, setIncentives] = useState<IncentiveEntry[]>(() => {
    try {
      const raw = window.localStorage.getItem(INCENTIVES_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as IncentiveEntry[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // Fallback to ₹280 ledger
    }
    return INITIAL_INCENTIVE_LEDGER;
  });

  const realtimeRef = useRef<HealthSyncRealtimeClient | null>(null);

  // Persist records under `healthsync_records` in localStorage
  useEffect(() => {
    persistStoredRecords(records);
  }, [records]);

  useEffect(() => {
    try {
      window.localStorage.setItem(INCENTIVES_STORAGE_KEY, JSON.stringify(incentives));
    } catch {
      // Ignore quota errors
    }
  }, [incentives]);

  // Trigger Emergency Audio Siren + Banner helper
  const triggerIncomingEmergencyAlert = (incomingRecord: TriageRecord) => {
    setActiveEmergencyBanner(incomingRecord);
    if (!sirenEngine.getMasterMuted()) {
      sirenEngine.startLoopingSiren();
      setIsSirenRinging(true);
    }
  };

  // Initialize Real-Time WebSocket + BroadcastChannel + localStorage 'storage' event sync
  useEffect(() => {
    const client = new HealthSyncRealtimeClient(
      (msg) => {
        if (msg.type === 'presence:count') {
          setConnectedPeers(Math.max(1, msg.connectedPeers));
        } else if (msg.type === 'sync:init') {
          setConnectedPeers(Math.max(1, msg.connectedPeers));
          if (Array.isArray(msg.records) && msg.records.length > 0) {
            setRecords((prev) => {
              const merged = [...prev];
              for (const serverRec of msg.records) {
                if (!merged.some((r) => r.id === serverRec.id)) {
                  merged.push(serverRec);
                }
              }
              return merged.sort((a, b) => b.createdAtMs - a.createdAtMs);
            });
          }
        } else if (msg.type === 'record:created') {
          setRecords((prev) => {
            if (prev.some((r) => r.id === msg.record.id)) return prev;
            return [msg.record, ...prev];
          });

          if (msg.record.severity === 'emergency' || msg.triggerEmergencySiren) {
            triggerIncomingEmergencyAlert(msg.record);
          } else {
            sirenEngine.playAlertBeep();
          }
        } else if (msg.type === 'record:updated') {
          setRecords((prev) =>
            prev.map((r) => (r.id === msg.record.id ? msg.record : r))
          );
        }
      },
      (storageRecords) => {
        setRecords((prev) => {
          const prevLatestId = prev[0]?.id;
          const nextLatest = storageRecords[0];
          if (nextLatest && nextLatest.id !== prevLatestId) {
            if (nextLatest.severity === 'emergency') {
              triggerIncomingEmergencyAlert(nextLatest);
            } else {
              sirenEngine.playAlertBeep();
            }
          }
          return storageRecords;
        });
      },
      records
    );

    realtimeRef.current = client;
    return () => {
      client.destroy();
      sirenEngine.stopSiren();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggleAudioMuted = () => {
    const next = !audioMuted;
    setAudioMuted(next);
    sirenEngine.setMasterMuted(next);
    if (next) {
      setIsSirenRinging(false);
    }
  };

  const handleAcknowledgeEmergency = () => {
    sirenEngine.stopSiren();
    setIsSirenRinging(false);
    setActiveEmergencyBanner(null);
  };

  const handleTestSiren = () => {
    sirenEngine.unlock();
    if (audioMuted) {
      setAudioMuted(false);
      sirenEngine.setMasterMuted(false);
    }
    sirenEngine.playTestSirenBurst();
  };

  const handleCycleNetwork = () => {
    setNetworkState((prev) => (prev === '4g' ? '2g' : prev === '2g' ? 'offline' : '4g'));
  };

  const handleSaveRecord = (params: {
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
  }): TriageRecord => {
    const village =
      VILLAGE_SUB_CENTERS.find((v) => v.code === params.villageCode) || VILLAGE_SUB_CENTERS[0];
    const evaluation = evaluateTriage(params.vitals, params.symptoms, params.edgeAi);
    const effectiveSeverity =
      params.channel === 'Emergency SMS' ? 'emergency' : evaluation.severity;

    const patientId = `PT${8925 + records.length + 1}`;
    const binarySmsPayload = encodeVitalsToSMS({
      patientId,
      villageCode: village.code,
      vitals: params.vitals,
      symptoms: params.symptoms,
      edgeAi: params.edgeAi,
      severity: effectiveSeverity,
    });

    const formattedTime = new Date().toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

    const newRecord: TriageRecord = {
      id: `rec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      patientId,
      abhaId: params.abhaId,
      patientName: params.patientName,
      age: params.age,
      gender: params.gender,
      villageCode: village.code,
      villageName: village.name,
      ashaWorker: village.ashaName,
      vitals: {...params.vitals},
      symptoms: [...params.symptoms],
      edgeAi: {...params.edgeAi},
      severity: effectiveSeverity,
      clinicalNotes: params.clinicalNotes,
      channel: params.channel,
      syncStatus:
        params.channel === 'Emergency SMS'
          ? 'SMS Delivered'
          : networkState === 'offline'
          ? 'Queued Offline'
          : 'Synced',
      binarySmsPayload,
      timestamp: formattedTime,
      createdAtMs: Date.now(),
      dispatchStatus: 'Unassigned',
    };

    const nextRecords = [newRecord, ...records];
    setRecords(nextRecords);
    persistStoredRecords(nextRecords);

    // Broadcast globally if online OR if transmitted via Baseband Emergency SMS
    const shouldBroadcastNow =
      params.channel === 'Emergency SMS' || networkState !== 'offline';
    const isCriticalRed = effectiveSeverity === 'emergency';

    if (shouldBroadcastNow) {
      realtimeRef.current?.publishRecordCreated(newRecord, isCriticalRed);
    }

    if (isCriticalRed) {
      triggerIncomingEmergencyAlert(newRecord);
    }

    // Credit NHM Mera Incentive Ledger
    const rewardAmount = isCriticalRed ? 100 : effectiveSeverity === 'moderate' ? 50 : 20;
    const newIncentive: IncentiveEntry = {
      id: `inc-${Date.now()}`,
      taskTitle: isCriticalRed
        ? 'Critical RED Emergency Stabilization & SMS Alert'
        : effectiveSeverity === 'moderate'
        ? 'Moderate Risk / Camera-Audio Diagnostic Triage'
        : 'Routine NCD Community Screening',
      programCode: isCriticalRed ? 'NHM-108-EMG' : 'NPCDCS-02',
      patientRef: `${patientId} · ${params.patientName}`,
      amountInr: rewardAmount,
      timestamp: formattedTime,
      abdmVerified: true,
    };
    setIncentives((prev) => [newIncentive, ...prev]);

    return newRecord;
  };

  const handleSyncOfflineQueue = (): number => {
    let syncedCount = 0;
    const updatedList = records.map((rec) => {
      if (rec.syncStatus === 'Queued Offline') {
        syncedCount += 1;
        const syncedRec: TriageRecord = {...rec, syncStatus: 'Synced'};
        realtimeRef.current?.publishRecordUpdated(syncedRec);
        return syncedRec;
      }
      return rec;
    });
    if (syncedCount > 0) {
      setRecords(updatedList);
      persistStoredRecords(updatedList);
    }
    return syncedCount;
  };

  const handleDispatchAmbulance = (recordId: string) => {
    setRecords((prev) =>
      prev.map((rec, idx) => {
        if (rec.id !== recordId) return rec;
        const village = VILLAGE_SUB_CENTERS.find((v) => v.code === rec.villageCode);
        const eta = village ? Math.max(8, Math.round(village.phcDistanceKm * 1.15)) : 14;
        const unitNum = String(((idx + 2) % 9) + 1).padStart(2, '0');
        const updatedRec: TriageRecord = {
          ...rec,
          dispatchStatus: 'Dispatched',
          ambulanceUnit: `108-ALS-${unitNum}`,
          etaMinutes: eta,
        };
        realtimeRef.current?.publishRecordUpdated(updatedRec);
        return updatedRec;
      })
    );
    handleAcknowledgeEmergency();
  };

  const unassignedRedCount = records.filter(
    (r) => r.severity === 'emergency' && r.dispatchStatus === 'Unassigned'
  ).length;

  if (route === 'login') {
    return (
      <LoginPage
        language={language}
        onLanguageChange={setLanguage}
        onLoginAsha={(id) => {
          setAshaId(id);
          setRoute('asha');
        }}
        onLoginDmo={(email) => {
          setDmoEmail(email);
          setRoute('command');
        }}
      />
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] text-[#0F172A]">
      <TopRoleToolbar
        activeView={route}
        onSelectView={(v) => setRoute(v)}
        networkState={networkState}
        onCycleNetwork={handleCycleNetwork}
        audioMuted={audioMuted}
        onToggleAudioMuted={handleToggleAudioMuted}
        onTestSiren={handleTestSiren}
        language={language}
        onLanguageChange={setLanguage}
        unassignedRedCount={unassignedRedCount}
        connectedPeers={connectedPeers}
        onLogout={() => {
          handleAcknowledgeEmergency();
          setRoute('login');
        }}
      />

      <div className="flex-1">
        {route === 'asha' ? (
          <AshaWorkerPWA
            ashaId={ashaId}
            records={records}
            incentives={incentives}
            language={language}
            networkState={networkState}
            audioMuted={audioMuted}
            onSaveRecord={handleSaveRecord}
            onSyncOfflineQueue={handleSyncOfflineQueue}
            onSwitchToCommand={() => setRoute('command')}
          />
        ) : (
          <DistrictCommandDashboard
            dmoEmail={dmoEmail}
            records={records}
            activeEmergencyBanner={activeEmergencyBanner}
            isSirenRinging={isSirenRinging}
            onAcknowledgeEmergency={handleAcknowledgeEmergency}
            onTestSiren={handleTestSiren}
            onDispatchAmbulance={handleDispatchAmbulance}
            onSyncOfflineQueue={handleSyncOfflineQueue}
          />
        )}
      </div>
    </div>
  );
}
