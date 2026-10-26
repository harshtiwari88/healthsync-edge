import React, {useEffect, useRef, useState} from 'react';
import {
  INITIAL_INCENTIVE_LEDGER,
  INITIAL_TRIAGE_RECORDS,
} from './data/initialData';
import {IncentiveEntry, NetworkState, TriageRecord} from './types/triage';
import {
  HealthSyncRealtimeClient,
  loadStoredRecords,
  persistStoredRecords,
  RealtimeEventMessage,
} from './utils/realtimeSync';
import {sirenEngine} from './utils/sirenAudio';
import {CurrentView, TopRoleToolbar, UserRole} from './components/TopRoleToolbar';
import {LoginPage} from './components/LoginPage';
import {AshaWorkerPWA} from './components/AshaWorkerPWA';
import {DistrictCommandDashboard} from './components/DistrictCommandDashboard';

export function App() {
  // 1. STRICT AUTHENTICATION & ROUTING GUARD STATE
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [userRole, setUserRole] = useState<UserRole>(null);
  const [currentView, setCurrentView] = useState<CurrentView>('LOGIN');

  // Authenticated user metadata
  const [ashaId, setAshaId] = useState<string>('ASHA-8842-UP');
  const [dmoEmail, setDmoEmail] = useState<string>('dmo.varanasi@nhm.gov.in');

  // 2. REAL-TIME REACTIVE NETWORK ENGINE
  const [browserOnline, setBrowserOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [networkState, setNetworkState] = useState<NetworkState>(() =>
    typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : '4g'
  );

  // Shared Triage Records & ASHA Daily Incentive Ledger
  const [records, setRecords] = useState<TriageRecord[]>(() =>
    loadStoredRecords(INITIAL_TRIAGE_RECORDS)
  );
  const [incentives, setIncentives] = useState<IncentiveEntry[]>(INITIAL_INCENTIVE_LEDGER);

  // Web Audio Emergency Siren State
  const [sirenActive, setSirenActive] = useState<boolean>(false);
  const [sirenMuted, setSirenMuted] = useState<boolean>(false);

  const realtimeRef = useRef<HealthSyncRealtimeClient | null>(null);
  const userRoleRef = useRef<UserRole>(userRole);
  const isAuthRef = useRef<boolean>(isAuthenticated);

  useEffect(() => {
    userRoleRef.current = userRole;
    isAuthRef.current = isAuthenticated;
  }, [userRole, isAuthenticated]);

  const flushOfflineQueue = () => {
    setRecords((curr) => {
      let hasChanges = false;
      const updated = curr.map((rec) => {
        if (rec.syncStatus === 'Queued Offline') {
          hasChanges = true;
          return {...rec, syncStatus: 'Synced' as const};
        }
        return rec;
      });
      if (hasChanges) {
        persistStoredRecords(updated);
        updated.forEach((rec) => realtimeRef.current?.publishRecordUpdated(rec));
      }
      return hasChanges ? updated : curr;
    });
  };

  // Real browser navigator.onLine + window 'online'/'offline' event listeners
  useEffect(() => {
    const handleBrowserOnline = () => {
      setBrowserOnline(true);
      setNetworkState('4g');
      flushOfflineQueue();
    };

    const handleBrowserOffline = () => {
      setBrowserOnline(false);
      setNetworkState('offline');
    };

    window.addEventListener('online', handleBrowserOnline);
    window.addEventListener('offline', handleBrowserOffline);
    return () => {
      window.removeEventListener('online', handleBrowserOnline);
      window.removeEventListener('offline', handleBrowserOffline);
    };
  }, []);

  // Multi-tab BroadcastChannel + WebSocket Real-Time Transport
  useEffect(() => {
    const handleRealtimeMessage = (msg: RealtimeEventMessage) => {
      if (msg.type === 'sync:init' && Array.isArray(msg.records) && msg.records.length > 0) {
        const looksValid = msg.records.some((r) => r.binarySmsPayload?.startsWith('HS#'));
        if (looksValid) {
          setRecords(msg.records);
          persistStoredRecords(msg.records);
        }
      } else if (msg.type === 'record:created') {
        setRecords((prev) => {
          if (prev.some((r) => r.id === msg.record.id)) return prev;
          const next = [msg.record, ...prev];
          persistStoredRecords(next);
          return next;
        });

        // Trigger emergency siren immediately on DMO Dashboard when RED Critical Alert arrives
        if (msg.triggerEmergencySiren || msg.record.severity === 'emergency') {
          setSirenActive(true);
          if (isAuthRef.current && userRoleRef.current === 'DMO') {
            sirenEngine.startLoopingSiren();
          }
        } else if (isAuthRef.current && userRoleRef.current === 'DMO') {
          sirenEngine.playAlertBeep();
        }
      } else if (msg.type === 'record:updated') {
        setRecords((prev) => {
          const next = prev.map((r) => (r.id === msg.record.id ? msg.record : r));
          persistStoredRecords(next);
          return next;
        });
      }
    };

    const client = new HealthSyncRealtimeClient(
      handleRealtimeMessage,
      (syncedRecords) => setRecords(syncedRecords),
      records
    );
    realtimeRef.current = client;

    return () => {
      client.destroy();
      sirenEngine.stopSiren();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Interactive Network Mode Override Switch
  const handleSelectNetwork = (nextMode: NetworkState) => {
    setNetworkState((prev) => {
      if (prev === 'offline' && nextMode !== 'offline') {
        flushOfflineQueue();
      }
      return nextMode;
    });
  };

  // STRICT AUTHENTICATION HANDLERS
  const handleLoginAsha = (validAshaId: string) => {
    sirenEngine.unlock();
    setAshaId(validAshaId);
    setIsAuthenticated(true);
    setUserRole('ASHA');
    setCurrentView('ASHA_MOBILE');
  };

  const handleLoginDmo = (validEmail: string) => {
    sirenEngine.unlock();
    setDmoEmail(validEmail);
    setIsAuthenticated(true);
    setUserRole('DMO');
    setCurrentView('DMO_DASHBOARD');
  };

  const handleLogout = () => {
    sirenEngine.stopSiren();
    setSirenActive(false);
    setIsAuthenticated(false);
    setUserRole(null);
    setCurrentView('LOGIN');
  };

  const handleSaveRecord = (newRecord: TriageRecord, isEmergencySms: boolean) => {
    sirenEngine.unlock();

    setRecords((prev) => {
      const next = [newRecord, ...prev];
      persistStoredRecords(next);
      return next;
    });

    // ASHA Incentive Ledger: +₹50 for High Risk (Emergency / Moderate), +₹20 for NCD Routine
    const isHighRisk = newRecord.severity === 'emergency' || newRecord.severity === 'moderate';
    const rewardAmount = isHighRisk ? 50 : 20;
    const newIncentive: IncentiveEntry = {
      id: `inc-${Date.now()}`,
      taskTitle: isHighRisk
        ? 'High-Risk Triage & Referral Stabilization'
        : 'NCD Community Vitals Screening',
      programCode: isHighRisk ? 'NHM-HRP-50' : 'NPCDCS-20',
      patientRef: `${newRecord.patientId} · ${newRecord.patientName}`,
      amountInr: rewardAmount,
      timestamp: newRecord.timestamp,
      abdmVerified: true,
    };
    setIncentives((prev) => [newIncentive, ...prev]);

    // Real-time Cloud Sync when 4G / 2G OR Emergency Binary SMS bypass
    if (networkState !== 'offline' || isEmergencySms) {
      const triggerSiren = isEmergencySms || newRecord.severity === 'emergency';
      realtimeRef.current?.publishRecordCreated(newRecord, triggerSiren);
      if (triggerSiren) {
        setSirenActive(true);
        if (!sirenMuted) {
          sirenEngine.playTestSirenBurst();
        }
      }
    }
  };

  const handleDispatchAmbulance = (recordId: string) => {
    sirenEngine.stopSiren();
    setSirenActive(false);

    setRecords((prev) => {
      const next = prev.map((rec) => {
        if (rec.id !== recordId) return rec;
        const updated: TriageRecord = {
          ...rec,
          dispatchStatus: 'Dispatched',
          ambulanceUnit: '108-AMB-UP65',
          etaMinutes: 11,
        };
        realtimeRef.current?.publishRecordUpdated(updated);
        return updated;
      });
      persistStoredRecords(next);
      return next;
    });
  };

  const handleTriggerTestSiren = () => {
    sirenEngine.unlock();
    if (sirenActive) {
      sirenEngine.stopSiren();
      setSirenActive(false);
    } else {
      if (sirenMuted) {
        sirenEngine.setMasterMuted(false);
        setSirenMuted(false);
      }
      sirenEngine.startLoopingSiren();
      setSirenActive(true);
    }
  };

  const handleToggleMuteSiren = () => {
    const nextMuted = !sirenMuted;
    setSirenMuted(nextMuted);
    sirenEngine.setMasterMuted(nextMuted);
    if (nextMuted) {
      setSirenActive(false);
    }
  };

  const pendingOfflineCount = records.filter((r) => r.syncStatus === 'Queued Offline').length;
  const userIdentifier = userRole === 'ASHA' ? ashaId : userRole === 'DMO' ? dmoEmail : '';

  return (
    <div className="min-h-screen w-full bg-slate-950 text-slate-100 overflow-x-hidden flex flex-col">
      {/* Top Bar with Reactive Network Switch & Strict Authenticated Logout */}
      <TopRoleToolbar
        isAuthenticated={isAuthenticated}
        userRole={userRole}
        userIdentifier={userIdentifier}
        networkState={networkState}
        browserOnline={browserOnline}
        onSelectNetwork={handleSelectNetwork}
        onLogout={handleLogout}
      />

      {/* STRICT ROUTING GUARD: Unauthenticated users ONLY ever see LOGIN */}
      <main className="flex-1 flex flex-col w-full">
        {!isAuthenticated || userRole === null || currentView === 'LOGIN' ? (
          <LoginPage onLoginAsha={handleLoginAsha} onLoginDmo={handleLoginDmo} />
        ) : userRole === 'ASHA' && currentView === 'ASHA_MOBILE' ? (
          <AshaWorkerPWA
            ashaId={ashaId}
            networkState={networkState}
            incentives={incentives}
            pendingOfflineCount={pendingOfflineCount}
            onSaveRecord={handleSaveRecord}
          />
        ) : userRole === 'DMO' && currentView === 'DMO_DASHBOARD' ? (
          <DistrictCommandDashboard
            dmoEmail={dmoEmail}
            records={records}
            sirenActive={sirenActive}
            sirenMuted={sirenMuted}
            onTriggerTestSiren={handleTriggerTestSiren}
            onToggleMuteSiren={handleToggleMuteSiren}
            onDispatchAmbulance={handleDispatchAmbulance}
          />
        ) : (
          <LoginPage onLoginAsha={handleLoginAsha} onLoginDmo={handleLoginDmo} />
        )}
      </main>
    </div>
  );
}

export default App;
