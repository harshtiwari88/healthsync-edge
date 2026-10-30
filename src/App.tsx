import React, {useCallback, useEffect, useRef, useState} from 'react';
import {IncentiveEntry, NetworkState, TriageRecord} from './types/triage';
import {
  buildUserVaultScope,
  HealthSyncRealtimeClient,
  loadEncryptedRecords,
  persistEncryptedRecords,
  purgeLegacyPlaintextStorage,
  RealtimeEventMessage,
} from './utils/realtimeSync';
import {persistActiveAuthToken} from './utils/clinicalSummaryClient';
import {safeReadJson} from './utils/safeFetchJson';
import {sirenEngine} from './utils/sirenAudio';
import {
  AshaNavTab,
  CurrentView,
  DmoNavTab,
  TopRoleToolbar,
  UserRole,
} from './components/TopRoleToolbar';
import {AuthenticatedSessionPayload, LoginPage} from './components/LoginPage';
import {AshaWorkerPWA} from './components/AshaWorkerPWA';
import {DistrictCommandDashboard} from './components/DistrictCommandDashboard';

function mergeRecordsById(primary: TriageRecord[], secondary: TriageRecord[]): TriageRecord[] {
  const byId = new Map<string, TriageRecord>();
  for (const rec of secondary || []) {
    if (rec?.id) byId.set(rec.id, rec);
  }
  for (const rec of primary || []) {
    if (rec?.id) byId.set(rec.id, rec);
  }
  return Array.from(byId.values()).sort(
    (a, b) => (Number(b?.createdAtMs) || 0) - (Number(a?.createdAtMs) || 0)
  );
}

function buildIncentiveForRecord(rec: TriageRecord): IncentiveEntry {
  const isHighRisk = rec?.severity === 'emergency' || rec?.severity === 'moderate';
  return {
    id: `inc-${rec?.id || Date.now()}`,
    taskTitle: isHighRisk
      ? 'Priority Referral & Health Stabilization'
      : 'Community Vital Signs Checkup',
    programCode: isHighRisk ? 'NHM-HRP-50' : 'NPCDCS-20',
    patientRef: `${rec?.patientId || 'PT0000'} · ${rec?.patientName || 'Patient'}`,
    amountInr: isHighRisk ? 50 : 20,
    timestamp: rec?.timestamp || 'Just now',
    abdmVerified: true,
  };
}

function mergeIncentivesById(
  serverEntries: IncentiveEntry[],
  derivedEntries: IncentiveEntry[]
): IncentiveEntry[] {
  const byId = new Map<string, IncentiveEntry>();
  for (const item of derivedEntries || []) {
    if (item?.id) byId.set(item.id, item);
  }
  for (const item of serverEntries || []) {
    if (item?.id) byId.set(item.id, item);
  }
  return Array.from(byId.values());
}

export function App() {
  // 1. STRICT AUTHENTICATION & SERVER SESSION STATE
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [userRole, setUserRole] = useState<UserRole>(null);
  const [currentView, setCurrentView] = useState<CurrentView>('LOGIN');
  const [sessionToken, setSessionToken] = useState<string>('');
  const [authUser, setAuthUser] = useState<AuthenticatedSessionPayload['user'] | null>(null);

  // Navigation Tabs for Field Worker & Hospital Dashboard
  const [ashaTab, setAshaTab] = useState<AshaNavTab>('checkup');
  const [dmoTab, setDmoTab] = useState<DmoNavTab>('overview');

  // Derived Web Crypto AES-256-GCM key + PBKDF2 salt + per-user vault scope held only in memory while authenticated
  const vaultKeyRef = useRef<CryptoKey | null>(null);
  const vaultSaltRef = useRef<Uint8Array | null>(null);
  const vaultScopeRef = useRef<string>('');
  const authIdentifierRef = useRef<string>('');

  // 2. REAL-TIME REACTIVE NETWORK ENGINE
  const [browserOnline, setBrowserOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [networkState, setNetworkState] = useState<NetworkState>(() =>
    typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : '4g'
  );

  // Real Triage Records & Visit Stipend Log (zero fabricated mock records)
  const [records, setRecords] = useState<TriageRecord[]>([]);
  const [incentives, setIncentives] = useState<IncentiveEntry[]>([]);
  const [isLoadingRecords, setIsLoadingRecords] = useState<boolean>(false);

  // Web Audio Alert Chime State
  const [sirenActive, setSirenActive] = useState<boolean>(false);
  const [sirenMuted, setSirenMuted] = useState<boolean>(false);

  const realtimeRef = useRef<HealthSyncRealtimeClient | null>(null);
  const userRoleRef = useRef<UserRole>(userRole);
  const isAuthRef = useRef<boolean>(isAuthenticated);
  const recordsRef = useRef<TriageRecord[]>(records);
  const isVaultHydratedRef = useRef<boolean>(false);

  // Keep recordsRef synchronized and persist committed records outside pure state updaters
  recordsRef.current = records;

  useEffect(() => {
    purgeLegacyPlaintextStorage();
  }, []);

  useEffect(() => {
    userRoleRef.current = userRole;
    isAuthRef.current = isAuthenticated;
  }, [userRole, isAuthenticated]);

  useEffect(() => {
    recordsRef.current = records;
    if (!isVaultHydratedRef.current || !isAuthRef.current) return;
    if (!vaultKeyRef.current || !vaultSaltRef.current || !vaultScopeRef.current) return;
    void persistEncryptedRecords(
      vaultKeyRef.current,
      vaultSaltRef.current,
      records,
      vaultScopeRef.current
    );
  }, [records]);

  const networkStateRef = useRef<NetworkState>(networkState);
  networkStateRef.current = networkState;

  const isAshaVerifiedRef = useRef<boolean>(authUser?.isVerified !== false);
  isAshaVerifiedRef.current = authUser?.isVerified !== false;

  const flushOfflineQueue = useCallback(() => {
    // Defer network side-effects outside React state updaters so StrictMode/concurrent renders never double-fire
    window.setTimeout(() => {
      if (networkStateRef.current === 'offline') return;
      if (userRoleRef.current === 'ASHA' && !isAshaVerifiedRef.current) return;
      const queued = (recordsRef.current || []).filter((rec) => rec?.syncStatus === 'Queued Offline');
      if (queued.length === 0) return;

      for (const rec of queued) {
        const candidateSynced: TriageRecord = {
          ...rec,
          syncStatus: rec.channel === 'Emergency SMS' ? 'SMS Delivered' : 'Synced',
        };
        const incentive =
          userRoleRef.current === 'ASHA' ? buildIncentiveForRecord(rec) : undefined;
        void realtimeRef.current
          ?.publishRecordCreated(
            candidateSynced,
            candidateSynced.severity === 'emergency',
            incentive
          )
          .then((res) => {
            if (res?.ok && res.incentive) {
              setIncentives((prev) => {
                const filtered = (prev || []).filter((inc) => inc?.id !== `inc-${rec.id}`);
                return mergeIncentivesById([res.incentive!], filtered);
              });
            }
          })
          .catch((err) => {
            console.warn('[HealthSync Offline Queue] Deferred sync retry scheduled:', err);
          });
      }
    }, 0);
  }, []);

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
  }, [flushOfflineQueue]);

  // Authenticated WebSocket + BroadcastChannel Real-Time Transport
  useEffect(() => {
    if (
      !isAuthenticated ||
      !sessionToken ||
      (userRole === 'ASHA' && authUser?.isVerified === false)
    ) {
      realtimeRef.current?.destroy();
      realtimeRef.current = null;
      return;
    }

    const canCurrentUserAccessRecord = (rec: TriageRecord): boolean => {
      if (!rec?.id) return false;
      if (userRoleRef.current === 'DMO') return true;
      const currentId = authIdentifierRef.current.trim().toUpperCase();
      if (!currentId) return false;
      return String(rec?.ashaWorker || '').toUpperCase().includes(`(${currentId})`);
    };

    const handleRealtimeMessage = (msg: RealtimeEventMessage) => {
      if (msg.type === 'sync:init' && Array.isArray(msg.records)) {
        const allowedRecords = msg.records.filter(canCurrentUserAccessRecord);
        setRecords((prev) => mergeRecordsById(allowedRecords, prev));
        if (networkStateRef.current !== 'offline') {
          flushOfflineQueue();
        }
      } else if (msg.type === 'record:created') {
        if (!canCurrentUserAccessRecord(msg.record)) return;
        const alreadyKnown = recordsRef.current.some((r) => r.id === msg.record.id);
        setRecords((prev) => {
          if (prev.some((r) => r.id === msg.record.id)) return prev;
          return [msg.record, ...prev];
        });

        if (!alreadyKnown) {
          if (msg.triggerEmergencySiren || msg.record.severity === 'emergency') {
            setSirenActive(true);
            if (isAuthRef.current && userRoleRef.current === 'DMO') {
              sirenEngine.startLoopingSiren();
            }
          } else if (isAuthRef.current && userRoleRef.current === 'DMO') {
            sirenEngine.playAlertBeep();
          }
        }
      } else if (msg.type === 'record:updated') {
        setRecords((prev) => {
          if (!prev.some((r) => r.id === msg.record.id) && userRoleRef.current !== 'DMO') {
            return prev;
          }
          return prev.map((r) => (r.id === msg.record.id ? msg.record : r));
        });
      } else if (msg.type === 'record:deleted') {
        setRecords((prev) => prev.filter((r) => r.id !== msg.recordId));
      } else if (msg.type === 'sync:ack') {
        setRecords((prev) => {
          if (!prev.some((r) => r.id === msg.recordId)) return prev;
          return prev.map((r) =>
            r.id === msg.recordId
              ? {
                  ...msg.record,
                  syncStatus:
                    msg.record.channel === 'Emergency SMS'
                      ? ('SMS Delivered' as const)
                      : ('Synced' as const),
                }
              : r
          );
        });
      } else if (msg.type === 'sync:error') {
        if (!msg.recordId) return;
        setRecords((prev) => {
          if (!prev.some((r) => r.id === msg.recordId)) return prev;
          return prev.map((r) => {
            if (r.id === msg.recordId && r.syncStatus !== 'SMS Delivered') {
              return {
                ...r,
                syncStatus: msg.retryable ? ('Queued Offline' as const) : ('Synced' as const),
              };
            }
            return r;
          });
        });
      }
    };

    const client = new HealthSyncRealtimeClient(sessionToken, handleRealtimeMessage);
    realtimeRef.current = client;

    return () => {
      client.destroy();
      realtimeRef.current = null;
    };
  }, [isAuthenticated, sessionToken, userRole, authUser?.isVerified, flushOfflineQueue]);

  // Periodic shift session token rotation (every 30 minutes while online)
  useEffect(() => {
    if (
      !isAuthenticated ||
      !sessionToken ||
      sessionToken === 'OFFLINE_LOCAL_SESSION' ||
      networkState === 'offline'
    ) {
      return;
    }
    const rotateTimer = window.setInterval(async () => {
      try {
        const resp = await fetch('/api/auth/rotate-session', {
          method: 'POST',
          headers: {Authorization: `Bearer ${sessionToken}`},
        });
        const parsed = await safeReadJson<{token?: string}>(resp);
        if (resp.ok && parsed.isJson && parsed.data?.token) {
          const nextTok = parsed.data.token;
          persistActiveAuthToken(nextTok);
          realtimeRef.current?.updateSessionToken(nextTok);
          setSessionToken(nextTok);
        }
      } catch {
        // Ignore transient rotation errors
      }
    }, 30 * 60 * 1000);
    return () => {
      window.clearInterval(rotateTimer);
    };
  }, [isAuthenticated, sessionToken, networkState]);

  const handleSelectNetwork = (nextMode: NetworkState) => {
    const wasOffline = networkState === 'offline';
    setNetworkState(nextMode);
    if (wasOffline && nextMode !== 'offline') {
      flushOfflineQueue();
    }
  };

  // STRICT AUTHENTICATION HANDLER (Server SQLite Session + Per-User Web Crypto AES-256-GCM Vault)
  const handleAuthenticated = async (session: AuthenticatedSessionPayload) => {
    sirenEngine.unlock();
    const userScope = buildUserVaultScope(session.user.role, session.user.identifier);
    isVaultHydratedRef.current = false;
    vaultKeyRef.current = session.vaultKey;
    vaultSaltRef.current = session.salt;
    vaultScopeRef.current = userScope;
    authIdentifierRef.current = session.user.identifier;
    isAuthRef.current = true;
    userRoleRef.current = session.user.role;
    persistActiveAuthToken(session.token);
    setSessionToken(session.token);
    setAuthUser(session.user);
    setIsAuthenticated(true);
    setUserRole(session.user.role);
    setAshaTab('checkup');
    setDmoTab('overview');
    setCurrentView(session.user.role === 'ASHA' ? 'ASHA_MOBILE' : 'DMO_DASHBOARD');
    setIsLoadingRecords(true);

    try {
      // 1. Decrypt THIS user's isolated local AES-256-GCM offline vault
      const localDecrypted = await loadEncryptedRecords(session.vaultKey, [], userScope);
      isVaultHydratedRef.current = true;
      setRecords([...localDecrypted]);
      const localDerivedIncentives =
        session.user.role === 'ASHA' ? localDecrypted.map(buildIncentiveForRecord) : [];
      if (localDerivedIncentives.length > 0) {
        setIncentives(localDerivedIncentives);
      }

      // 2. Sync authoritative records & incentives from SQLite server when online and verified
      if (
        networkState !== 'offline' &&
        session.token !== 'OFFLINE_LOCAL_SESSION' &&
        (session.user.role !== 'ASHA' || session.user.isVerified !== false)
      ) {
        const [recordsRes, incentivesRes] = await Promise.all([
          fetch('/api/records', {
            headers: {Authorization: `Bearer ${session.token}`},
          }).catch((err) => {
            console.warn('[HealthSync Auth Sync] /api/records fetch unavailable, using local vault:', err);
            return null;
          }),
          fetch('/api/incentives', {
            headers: {Authorization: `Bearer ${session.token}`},
          }).catch((err) => {
            console.warn('[HealthSync Auth Sync] /api/incentives fetch unavailable, using local log:', err);
            return null;
          }),
        ]);

        if (recordsRes?.ok) {
          const parsedRecords = await safeReadJson<{records?: TriageRecord[]}>(recordsRes);
          const data = parsedRecords.isJson && parsedRecords.data ? parsedRecords.data : null;
          if (data && Array.isArray(data.records)) {
            const unsynced = localDecrypted.filter((r) => r?.syncStatus === 'Queued Offline');
            const confirmedSyncedById = new Map<string, TriageRecord>();

            for (const q of unsynced) {
              const syncedCopy: TriageRecord = {
                ...q,
                syncStatus: q.channel === 'Emergency SMS' ? 'SMS Delivered' : 'Synced',
              };
              const derivedIncentive =
                session.user.role === 'ASHA' ? buildIncentiveForRecord(q) : undefined;
              try {
                const postRes = await fetch('/api/records', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${session.token}`,
                  },
                  body: JSON.stringify({
                    record: syncedCopy,
                    triggerEmergencySiren: syncedCopy.severity === 'emergency',
                    incentive: derivedIncentive,
                  }),
                });
                const parsedPost = await safeReadJson<{record?: TriageRecord}>(postRes);
                if (postRes.ok && parsedPost.isJson) {
                  confirmedSyncedById.set(q.id, parsedPost.data?.record ?? syncedCopy);
                } else {
                  console.warn(
                    `[HealthSync Offline Sync] Server deferred queued record ${q.id} (HTTP ${postRes.status}). Keeping in offline queue.`
                  );
                }
              } catch (syncErr) {
                console.warn(
                  `[HealthSync Offline Sync] Network unavailable syncing record ${q.id}. Keeping in offline queue:`,
                  syncErr
                );
              }
            }

            // Pure functional state update merging against LIVE state (vault persistence runs via useEffect)
            setRecords((currentRecords) => {
              const normalizedCurrent = (currentRecords || []).map((r) =>
                confirmedSyncedById.has(r.id) ? confirmedSyncedById.get(r.id)! : r
              );
              return mergeRecordsById(data.records || [], normalizedCurrent);
            });
          }
        }

        if (incentivesRes?.ok) {
          const parsedInc = await safeReadJson<{incentives?: IncentiveEntry[]}>(incentivesRes);
          if (parsedInc.isJson && Array.isArray(parsedInc.data?.incentives)) {
            setIncentives(mergeIncentivesById(parsedInc.data.incentives, localDerivedIncentives));
          }
        }
      }
    } catch (err) {
      console.warn('[HealthSync Auth Sync] Offline or transient sync fallback active:', err);
    } finally {
      setIsLoadingRecords(false);
    }
  };

  const clearClientSessionState = () => {
    isVaultHydratedRef.current = false;
    isAuthRef.current = false;
    userRoleRef.current = null;
    realtimeRef.current?.destroy();
    realtimeRef.current = null;
    vaultKeyRef.current = null;
    vaultSaltRef.current = null;
    vaultScopeRef.current = '';
    authIdentifierRef.current = '';
    sirenEngine.stopSiren();
    setSirenActive(false);
    persistActiveAuthToken(null);
    setSessionToken('');
    setAuthUser(null);
    setRecords([]);
    setIncentives([]);
    setIsAuthenticated(false);
    setUserRole(null);
    setCurrentView('LOGIN');
  };

  const handleLogout = () => {
    if (sessionToken && sessionToken !== 'OFFLINE_LOCAL_SESSION') {
      void fetch('/api/auth/logout', {
        method: 'POST',
        headers: {Authorization: `Bearer ${sessionToken}`},
      }).catch(() => {});
    }
    clearClientSessionState();
  };

  const handleLogoutAllDevices = () => {
    if (sessionToken && sessionToken !== 'OFFLINE_LOCAL_SESSION') {
      void fetch('/api/auth/logout-all', {
        method: 'POST',
        headers: {Authorization: `Bearer ${sessionToken}`},
      }).catch(() => {});
    }
    clearClientSessionState();
  };

  const handleAshaVerified = (rotatedToken?: string) => {
    setAuthUser((prev) => (prev ? {...prev, isVerified: true} : prev));
    if (rotatedToken) {
      persistActiveAuthToken(rotatedToken);
      setSessionToken(rotatedToken);
    }
    flushOfflineQueue();
  };

  const handleDeleteRecord = async (recordId: string) => {
    if (!sessionToken || userRole !== 'DMO') return;
    if (sessionToken === 'OFFLINE_LOCAL_SESSION') {
      setRecords((prev) => prev.filter((r) => r.id !== recordId));
      return;
    }
    try {
      const resp = await fetch(`/api/records/${encodeURIComponent(recordId)}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({reason: 'DPDP Section 8 authorized DMO erasure'}),
      });
      if (resp.ok) {
        setRecords((prev) => prev.filter((r) => r.id !== recordId));
      }
    } catch {
      // Ignore transient errors
    }
  };

  const handleSaveRecord = (newRecord: TriageRecord, isEmergencySms: boolean) => {
    sirenEngine.unlock();

    // Until the server confirms SQLite persistence via sync:ack, store records safely as 'Queued Offline'
    const safeLocalRecord: TriageRecord = {...newRecord, syncStatus: 'Queued Offline'};

    setRecords((prev) => {
      if (prev.some((r) => r.id === safeLocalRecord.id)) return prev;
      return [safeLocalRecord, ...prev];
    });

    const newIncentive = buildIncentiveForRecord(newRecord);
    setIncentives((prev) => {
      if (prev.some((inc) => inc.id === newIncentive.id)) return prev;
      return [newIncentive, ...prev];
    });

    if (
      networkState !== 'offline' &&
      sessionToken !== 'OFFLINE_LOCAL_SESSION' &&
      authUser?.isVerified !== false
    ) {
      const triggerSiren = isEmergencySms || newRecord.severity === 'emergency';
      const serverPayload: TriageRecord = {
        ...newRecord,
        syncStatus: isEmergencySms ? 'SMS Delivered' : 'Synced',
      };
      void realtimeRef.current
        ?.publishRecordCreated(serverPayload, triggerSiren, newIncentive)
        .then((res) => {
          if (res?.ok && res.incentive) {
            setIncentives((prev) => {
              const withoutDraft = (prev || []).filter((inc) => inc?.id !== newIncentive.id);
              return mergeIncentivesById([res.incentive!], withoutDraft);
            });
          }
        })
        .catch((err) => {
          console.warn('[HealthSync Sync] Record queued locally after publish failure:', err);
        });
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

    setRecords((prev) =>
      (prev || []).map((rec) => {
        if (rec?.id !== recordId) return rec;
        return {
          ...rec,
          dispatchStatus: 'Dispatched' as const,
          ambulanceUnit: '108-AMB-UP65',
          etaMinutes: 11,
        };
      })
    );

    void realtimeRef.current
      ?.publishRecordDispatched(recordId, '108-AMB-UP65', 11)
      .catch((err) => {
        console.warn('[HealthSync Dispatch] Dispatch status queued locally:', err);
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

  const pendingOfflineCount = (records || []).filter((r) => r?.syncStatus === 'Queued Offline').length;
  const userIdentifier = authUser?.identifier ?? '';

  return (
    <div className="min-h-screen w-full bg-slate-50 text-slate-900 overflow-x-hidden flex flex-col">
      <TopRoleToolbar
        isAuthenticated={isAuthenticated}
        userRole={userRole}
        userIdentifier={userIdentifier}
        userDisplayName={authUser?.displayName}
        isLocalSession={sessionToken === 'OFFLINE_LOCAL_SESSION'}
        networkState={networkState}
        browserOnline={browserOnline}
        pendingOfflineCount={pendingOfflineCount}
        ashaTab={ashaTab}
        onSelectAshaTab={setAshaTab}
        dmoTab={dmoTab}
        onSelectDmoTab={setDmoTab}
        onSelectNetwork={handleSelectNetwork}
        onLogout={handleLogout}
        onLogoutAllDevices={handleLogoutAllDevices}
      />

      {/* STRICT ROUTING GUARD: Unauthenticated users ONLY ever see LOGIN */}
      <main className="flex-1 flex flex-col w-full">
        {!isAuthenticated || userRole === null || currentView === 'LOGIN' || !authUser ? (
          <LoginPage networkState={networkState} onAuthenticated={handleAuthenticated} />
        ) : userRole === 'ASHA' && currentView === 'ASHA_MOBILE' ? (
          <AshaWorkerPWA
            ashaId={authUser.identifier}
            ashaDisplayName={authUser.displayName}
            villageCode={authUser.villageCode}
            sessionToken={sessionToken}
            isAshaVerified={authUser.isVerified !== false}
            onAshaVerified={handleAshaVerified}
            networkState={networkState}
            records={records}
            incentives={incentives}
            pendingOfflineCount={pendingOfflineCount}
            isLoadingRecords={isLoadingRecords}
            activeTab={ashaTab}
            onSelectTab={setAshaTab}
            onSaveRecord={handleSaveRecord}
          />
        ) : userRole === 'DMO' && currentView === 'DMO_DASHBOARD' ? (
          <DistrictCommandDashboard
            dmoEmail={authUser.identifier}
            dmoDisplayName={authUser.displayName}
            sessionToken={sessionToken}
            records={records}
            isLoadingRecords={isLoadingRecords}
            activeTab={dmoTab}
            onSelectTab={setDmoTab}
            sirenActive={sirenActive}
            sirenMuted={sirenMuted}
            onTriggerTestSiren={handleTriggerTestSiren}
            onToggleMuteSiren={handleToggleMuteSiren}
            onDispatchAmbulance={handleDispatchAmbulance}
            onDeleteRecord={handleDeleteRecord}
          />
        ) : (
          <LoginPage networkState={networkState} onAuthenticated={handleAuthenticated} />
        )}
      </main>
    </div>
  );
}

export default App;
