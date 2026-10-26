/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {useState, useEffect} from 'react';
import {
  EdgeAiDiagnostics,
  IncentiveEntry,
  Language,
  NetworkState,
  SymptomKey,
  TriageRecord,
  VitalsSnapshot,
  buildEncryptedEmergencySms,
  evaluateTriage,
} from './types/triage';
import {
  INITIAL_INCENTIVE_LEDGER,
  INITIAL_TRIAGE_RECORDS,
  VILLAGE_SUB_CENTERS,
} from './data/initialData';
import {LoginPage} from './components/LoginPage';
import {AshaWorkerPWA} from './components/AshaWorkerPWA';
import {DistrictCommandDashboard} from './components/DistrictCommandDashboard';

type AppRoute = 'login' | 'asha' | 'command';

const RECORDS_STORAGE_KEY = 'healthsync_edge_records_v2';
const INCENTIVES_STORAGE_KEY = 'healthsync_edge_incentives_v2';

export default function App() {
  // Default Initial Screen: Login & Onboarding Page
  const [route, setRoute] = useState<AppRoute>('login');
  const [language, setLanguage] = useState<Language>('en');
  const [ashaId, setAshaId] = useState<string>('ASHA-8842-UP');
  const [dmoEmail, setDmoEmail] = useState<string>('dmo.district24@nhm.up.gov.in');
  const [networkState, setNetworkState] = useState<NetworkState>('offline');

  const [records, setRecords] = useState<TriageRecord[]>(() => {
    try {
      const raw = localStorage.getItem(RECORDS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as TriageRecord[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {
      // Fallback to initial seeded records
    }
    return INITIAL_TRIAGE_RECORDS;
  });

  const [incentives, setIncentives] = useState<IncentiveEntry[]>(() => {
    try {
      const raw = localStorage.getItem(INCENTIVES_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as IncentiveEntry[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {
      // Fallback to initial ₹240 ledger
    }
    return INITIAL_INCENTIVE_LEDGER;
  });

  useEffect(() => {
    try {
      localStorage.setItem(RECORDS_STORAGE_KEY, JSON.stringify(records));
    } catch {
      // Ignore storage quota errors
    }
  }, [records]);

  useEffect(() => {
    try {
      localStorage.setItem(INCENTIVES_STORAGE_KEY, JSON.stringify(incentives));
    } catch {
      // Ignore storage quota errors
    }
  }, [incentives]);

  const handleCycleNetworkState = () => {
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

    const patientId = `PT${8924 + records.length + 1}`;
    const binarySmsPayload = buildEncryptedEmergencySms({
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
      id: `rec-${Date.now()}`,
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

    setRecords((prev) => [newRecord, ...prev]);

    // Credit NHM Mera Incentive Ledger automatically
    const rewardAmount = effectiveSeverity === 'routine' ? 20 : 50;
    const newIncentive: IncentiveEntry = {
      id: `inc-${Date.now()}`,
      taskTitle:
        effectiveSeverity === 'emergency'
          ? 'Critical Emergency Triage & Referral'
          : effectiveSeverity === 'moderate'
          ? 'High-Risk / Edge-AI Diagnostic Screening'
          : 'Routine NCD Community Check',
      programCode: effectiveSeverity === 'routine' ? 'NPCDCS-02' : 'NHM-EMG-08',
      patientRef: `${patientId} · ${params.patientName}`,
      amountInr: rewardAmount,
      timestamp: formattedTime,
      abdmVerified: true,
    };
    setIncentives((prev) => [newIncentive, ...prev]);

    return newRecord;
  };

  const handleSyncOfflineQueue = (): number => {
    let synced = 0;
    setRecords((prev) =>
      prev.map((r) => {
        if (r.syncStatus === 'Queued Offline') {
          synced += 1;
          return {...r, syncStatus: 'Synced'};
        }
        return r;
      })
    );
    return synced;
  };

  const handleDispatchAmbulance = (recordId: string) => {
    setRecords((prev) =>
      prev.map((rec, idx) => {
        if (rec.id !== recordId) return rec;
        const village = VILLAGE_SUB_CENTERS.find((v) => v.code === rec.villageCode);
        const eta = village ? Math.max(8, Math.round(village.phcDistanceKm * 1.15)) : 14;
        const unitNum = String(((idx + 2) % 9) + 1).padStart(2, '0');
        return {
          ...rec,
          dispatchStatus: 'Dispatched',
          ambulanceUnit: `108-ALS-${unitNum}`,
          etaMinutes: eta,
        };
      })
    );
  };

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

  if (route === 'asha') {
    return (
      <AshaWorkerPWA
        ashaId={ashaId}
        records={records}
        incentives={incentives}
        language={language}
        onLanguageChange={setLanguage}
        networkState={networkState}
        onCycleNetworkState={handleCycleNetworkState}
        onSaveRecord={handleSaveRecord}
        onSyncOfflineQueue={handleSyncOfflineQueue}
        onSwitchToCommand={() => setRoute('command')}
        onLogout={() => setRoute('login')}
      />
    );
  }

  return (
    <DistrictCommandDashboard
      dmoEmail={dmoEmail}
      records={records}
      onDispatchAmbulance={handleDispatchAmbulance}
      onSyncOfflineQueue={handleSyncOfflineQueue}
      onSwitchToAsha={() => setRoute('asha')}
      onLogout={() => setRoute('login')}
    />
  );
}
