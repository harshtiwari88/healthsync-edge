/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {useState, useEffect, useRef} from 'react';
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
import {
  CrdtVectorClock,
  SystemHardwareTelemetry,
  incrementCrdtClock,
  loadCrdtClock,
  probeHardwareTelemetry,
  syncRecordsToIndexedDB,
} from './utils/deviceTelemetry';
import {LoginPage} from './components/LoginPage';
import {TopRoleToolbar} from './components/TopRoleToolbar';
import {AshaWorkerPWA} from './components/AshaWorkerPWA';
import {DistrictCommandDashboard} from './components/DistrictCommandDashboard';
import {BitstreamInspectorDrawer} from './components/BitstreamInspectorDrawer';

type AppRoute = 'login' | 'asha' | 'command';

const INCENTIVES_STORAGE_KEY = 'healthsync_incentives_v32';

export default function App() {
  const [route, setRoute] = useState<AppRoute>('login');
  const [language, setLanguage] = useState<Language>('en');
  const [ashaId, setAshaId] = useState<string>('ASHA-8842-UP');
  const [dmoEmail, setDmoEmail] = useState<string>('dmo.district24@nhm.up.gov.in');
  const [networkState, setNetworkState] = useState<NetworkState>('4g');
  const [audioMuted, setAudioMuted] = useState<boolean>(false);
  const [connectedPeers, setConnectedPeers] = useState<number>(1);

  // Shared Active Biometric Telemetry State (inspected live by Global Bitstream Drawer)
  const [activeVitals, setActiveVitals] = useState<VitalsSnapshot>({
    systolic: 140,
    diastolic: 90,
    spo2: 96,
    temperature: 98.8,
    heartRate: 84,
  });
  const [activeSymptoms, setActiveSymptoms] = useState<SymptomKey[]>([]);
  const [conjunctivaMetrics, setConjunctivaMetrics] = useState<
    ConjunctivaPixelMetrics | undefined
  >(undefined);
  const [coughMetrics, setCoughMetrics] = useState<CoughAudioMetrics | undefined>(
    undefined
  );

  // CRDT Vector Clock & Hardware Telemetry
  const [crdtClock, setCrdtClock] = useState<CrdtVectorClock>(() =>
    loadCrdtClock('ASHA_VIL_204')
  );
  const [hardwareTelemetry, setHardwareTelemetry] = useState<SystemHardwareTelemetry>({
    batteryPct: 94,
    batteryCharging: true,
    storageUsedKb: 18.4,
    idbStatus: 'MOUNTED',
    idbDocCount: INITIAL_TRIAGE_RECORDS.length,
    swCacheStatus: 'SW-CACHE: ACTIVE',
    rttLatencyMs: 12,
  });

  // Emergency Siren & Banner State
  const [activeEmergencyBanner, setActiveEmergencyBanner] = useState<TriageRecord | null>(
    null
  );
  const [isSirenRinging, setIsSirenRinging] = useState<boolean>(false);

  const [records, setRecords] = useState<TriageRecord[]>(() => {
    const loaded = loadStoredRecords(INITIAL_TRIAGE_RECORDS);
    // Ensure any stored records carry 160-character v3.2 HS3# packets for full War-Room inspection
    return loaded.map((rec, idx) =>
      rec.binarySmsPayload.startsWith('HS3#')
        ? rec
        : {
            ...rec,
            binarySmsPayload: encodeVitalsToSMS({
              patientId: rec.patientId,
              villageCode: rec.villageCode,
              vitals: rec.vitals,
              symptoms: rec.symptoms,
              edgeAi: rec.edgeAi,
              severity: rec.severity,
              crdtNodeId: `ASHA_${rec.villageCode.replace('-', '_')}`,
              crdtSeq: 142 - idx,
            }),
          }
    );
  });

  const [incentives, setIncentives] = useState<IncentiveEntry[]>(() => {
    try {
      const raw = window.localStorage.getItem(INCENTIVES_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as IncentiveEntry[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // Fallback
    }
    return INITIAL_INCENTIVE_LEDGER;
  });

  const realtimeRef = useRef<HealthSyncRealtimeClient | null>(null);

  // Persist records to localStorage AND IndexedDB + refresh hardware telemetry
  useEffect(() => {
    persistStoredRecords(records);
    let cancelled = false;
    (async () => {
      const idbCount = await syncRecordsToIndexedDB(records);
      const probed = await probeHardwareTelemetry(idbCount);
      if (!cancelled) {
        setHardwareTelemetry(probed);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [records]);

  // Periodic RTT & Battery hardware telemetry poll
  useEffect(() => {
    const interval = window.setInterval(async () => {
      const probed = await probeHardwareTelemetry(records.length);
      setHardwareTelemetry(probed);
    }, 12000);
    return () => window.clearInterval(interval);
  }, [records.length]);

  useEffect(() => {
    try {
      window.localStorage.setItem(INCENTIVES_STORAGE_KEY, JSON.stringify(incentives));
    } catch {
      // Ignore quota
    }
  }, [incentives]);

  const triggerIncomingEmergencyAlert = (incomingRecord: TriageRecord) => {
    setActiveEmergencyBanner(incomingRecord);
    if (!sirenEngine.getMasterMuted()) {
      sirenEngine.startLoopingSiren();
      setIsSirenRinging(true);
    }
  };

  // Initialize Real-Time WebSocket + BroadcastChannel + Storage Sync
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
          setCrdtClock((c) => incrementCrdtClock(c, 'DIST_HQ_24'));
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
          setCrdtClock((c) => incrementCrdtClock(c, 'DIST_HQ_24'));
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
    setNetworkState((prev) =>
      prev === '4g' ? '2g' : prev === '2g' ? 'offline' : '4g'
    );
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
      VILLAGE_SUB_CENTERS.find((v) => v.code === params.villageCode) ||
      VILLAGE_SUB_CENTERS[0];
    const evaluation = evaluateTriage(params.vitals, params.symptoms, params.edgeAi);
    const effectiveSeverity =
      params.channel === 'Emergency SMS' ? 'emergency' : evaluation.severity;

    const updatedClock = incrementCrdtClock(
      crdtClock,
      params.channel === 'Emergency SMS' ? 'SMS_GW_01' : 'ASHA_VIL_204'
    );
    setCrdtClock(updatedClock);

    const patientId = `PT${8925 + records.length + 1}`;
    const binarySmsPayload = encodeVitalsToSMS({
      patientId,
      villageCode: village.code,
      vitals: params.vitals,
      symptoms: params.symptoms,
      edgeAi: params.edgeAi,
      severity: effectiveSeverity,
      crdtNodeId: updatedClock.nodeId,
      crdtSeq: updatedClock.seq,
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

    const shouldBroadcastNow =
      params.channel === 'Emergency SMS' || networkState !== 'offline';
    const isCriticalRed = effectiveSeverity === 'emergency';

    if (shouldBroadcastNow) {
      realtimeRef.current?.publishRecordCreated(newRecord, isCriticalRed);
    }

    if (isCriticalRed) {
      triggerIncomingEmergencyAlert(newRecord);
    }

    const rewardAmount =
      isCriticalRed ? 100 : effectiveSeverity === 'moderate' ? 50 : 20;
    const newIncentive: IncentiveEntry = {
      id: `inc-${Date.now()}`,
      taskTitle: isCriticalRed
        ? 'Critical RED Emergency Stabilization & 160B SMS'
        : effectiveSeverity === 'moderate'
        ? 'WASM Conjunctiva / FFT Cough Triage'
        : 'Routine Telemetry Screening',
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
      setCrdtClock((c) => incrementCrdtClock(c, 'ASHA_VIL_204'));
      setRecords(updatedList);
      persistStoredRecords(updatedList);
    }
    return syncedCount;
  };

  const handleDispatchAmbulance = (recordId: string) => {
    setCrdtClock((c) => incrementCrdtClock(c, 'DIST_HQ_24'));
    setRecords((prev) =>
      prev.map((rec, idx) => {
        if (rec.id !== recordId) return rec;
        const village = VILLAGE_SUB_CENTERS.find((v) => v.code === rec.villageCode);
        const eta = village
          ? Math.max(8, Math.round(village.phcDistanceKm * 1.15))
          : 14;
        const unitNum = String(((idx + 2) % 9) + 1).padStart(2, '0');
        const updatedRec: TriageRecord = {
          ...rec,
          dispatchStatus: 'Dispatched',
          ambulanceUnit: `ALS-108-${unitNum}`,
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

  const activeEdgeAi: EdgeAiDiagnostics = {
    anemiaSuspected: Boolean(conjunctivaMetrics?.pallorDetected),
    estimatedHb: conjunctivaMetrics?.estimatedHb,
    conjunctivaMetrics,
    respiratoryRiskHigh: Boolean(coughMetrics?.highRespiratoryRisk),
    coughPeakHz: coughMetrics?.dominantFrequencyHz,
    coughMetrics,
  };

  const activeEvaluation = evaluateTriage(activeVitals, activeSymptoms, activeEdgeAi);
  const nextPatientId = `PT${8925 + records.length + 1}`;

  return (
    <div className="min-h-screen flex flex-col bg-[#090D16] text-slate-100">
      {route === 'login' ? (
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
      ) : (
        <>
          <TopRoleToolbar
            activeView={route}
            onSelectView={(v) => setRoute(v)}
            networkState={networkState}
            onCycleNetwork={handleCycleNetwork}
            audioMuted={audioMuted}
            onToggleAudioMuted={handleToggleAudioMuted}
            language={language}
            onLanguageChange={setLanguage}
            unassignedRedCount={unassignedRedCount}
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
                hardwareTelemetry={hardwareTelemetry}
                vitals={activeVitals}
                symptoms={activeSymptoms}
                conjunctivaMetrics={conjunctivaMetrics}
                coughMetrics={coughMetrics}
                onChangeVitals={setActiveVitals}
                onChangeSymptoms={setActiveSymptoms}
                onChangeConjunctiva={setConjunctivaMetrics}
                onChangeCough={setCoughMetrics}
                onSaveRecord={handleSaveRecord}
                onSyncOfflineQueue={handleSyncOfflineQueue}
                onSwitchToCommand={() => setRoute('command')}
              />
            ) : (
              <DistrictCommandDashboard
                dmoEmail={dmoEmail}
                records={records}
                hardwareTelemetry={hardwareTelemetry}
                activeEmergencyBanner={activeEmergencyBanner}
                isSirenRinging={isSirenRinging}
                onAcknowledgeEmergency={handleAcknowledgeEmergency}
                onTestSiren={handleTestSiren}
                onDispatchAmbulance={handleDispatchAmbulance}
                onSyncOfflineQueue={handleSyncOfflineQueue}
              />
            )}
          </div>
        </>
      )}

      {/* GLOBAL COLLAPSIBLE BITSTREAM & PROTOCOL INSPECTOR (ACCESSIBLE ANYWHERE IN THE OS) */}
      <BitstreamInspectorDrawer
        patientId={nextPatientId}
        villageCode="VIL-204"
        vitals={activeVitals}
        symptoms={activeSymptoms}
        edgeAi={activeEdgeAi}
        severity={activeEvaluation.severity}
        crdtClock={crdtClock}
        connectedPeers={connectedPeers}
      />
    </div>
  );
}
