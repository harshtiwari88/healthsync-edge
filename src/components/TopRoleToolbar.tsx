import React from 'react';
import {LogOut, Stethoscope, Wifi, WifiOff} from 'lucide-react';
import {NetworkState} from '../types/triage';

export type UserRole = 'ASHA' | 'DMO' | null;
export type CurrentView = 'LOGIN' | 'ASHA_MOBILE' | 'DMO_DASHBOARD';

interface TopRoleToolbarProps {
  isAuthenticated: boolean;
  userRole: UserRole;
  userIdentifier: string;
  networkState: NetworkState;
  browserOnline: boolean;
  onSelectNetwork: (mode: NetworkState) => void;
  onLogout: () => void;
}

export const TopRoleToolbar: React.FC<TopRoleToolbarProps> = ({
  isAuthenticated,
  userRole,
  userIdentifier,
  networkState,
  browserOnline,
  onSelectNetwork,
  onLogout,
}) => {
  return (
    <div className="sticky top-0 z-40 w-full shrink-0">
      {/* Main Top Navigation Bar — Strict Auth Guard: NO unauthenticated view switchers */}
      <header className="w-full border-b border-slate-800 bg-slate-900/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-2.5 sm:px-6">
          {/* Zone 1: Brand Wordmark */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-600 text-white">
              <Stethoscope className="h-4 w-4" />
            </div>
            <span className="text-base font-bold tracking-tight text-slate-100 whitespace-nowrap">
              HealthSync Edge
            </span>
          </div>

          {/* Zone 2: Interactive Network Mode Override Switch */}
          <div
            role="group"
            aria-label="Network Mode Override Switch"
            className="flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1"
          >
            <button
              type="button"
              onClick={() => onSelectNetwork('4g')}
              className={`min-h-[36px] rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                networkState === '4g'
                  ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              🟢 4G / Wi-Fi
            </button>
            <button
              type="button"
              onClick={() => onSelectNetwork('2g')}
              className={`min-h-[36px] rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                networkState === '2g'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              🟡 Low 2G Delta
            </button>
            <button
              type="button"
              onClick={() => onSelectNetwork('offline')}
              className={`min-h-[36px] rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                networkState === 'offline'
                  ? 'bg-red-600/25 text-red-300 border border-red-500/50'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              🔴 100% Offline (No Data)
            </button>
          </div>

          {/* Zone 3: Authenticated Session & Logout (Strictly hidden when unauthenticated) */}
          <div className="flex items-center gap-3 shrink-0">
            {isAuthenticated && userRole ? (
              <>
                <span className="hidden text-xs text-slate-400 sm:inline whitespace-nowrap">
                  {userRole === 'ASHA' ? 'ASHA Session' : 'DMO Session'} ·{' '}
                  <strong className="font-mono text-slate-200">{userIdentifier}</strong>
                </span>
                <button
                  type="button"
                  onClick={onLogout}
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-1.5 text-xs font-semibold text-slate-100 transition-colors hover:border-red-500/50 hover:bg-red-950/60 hover:text-red-200 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>Logout</span>
                </button>
              </>
            ) : (
              <span className="text-xs font-medium text-slate-400 whitespace-nowrap">
                Authentication Required
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Reactive Real-Time Network Status Banner */}
      {networkState === 'offline' ? (
        <div
          role="status"
          className="w-full border-b border-red-500/40 bg-red-950/90 px-4 py-2 text-center text-xs font-semibold text-red-200"
        >
          <span className="inline-flex items-center justify-center gap-2">
            <WifiOff className="h-3.5 w-3.5 text-red-400 shrink-0" />
            <span>
              OFFLINE MODE: Cloud Sync Suspended. Data saving to LocalStorage / IndexedDB.
              {!browserOnline ? ' (Browser navigator.onLine = false)' : ''}
            </span>
          </span>
        </div>
      ) : networkState === '2g' ? (
        <div
          role="status"
          className="w-full border-b border-amber-500/30 bg-amber-950/70 px-4 py-1.5 text-center text-xs font-medium text-amber-200"
        >
          <span className="inline-flex items-center justify-center gap-2">
            <Wifi className="h-3.5 w-3.5 text-amber-400 shrink-0" />
            <span>
              LOW 2G DELTA: Micro-packet sync active · Bandwidth-optimized telemetry enabled
            </span>
          </span>
        </div>
      ) : (
        <div
          role="status"
          className="w-full border-b border-emerald-500/25 bg-emerald-950/60 px-4 py-1.5 text-center text-xs font-medium text-emerald-300"
        >
          <span className="inline-flex items-center justify-center gap-2">
            <Wifi className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
            <span>ONLINE: Real-time Cloud Sync Active</span>
          </span>
        </div>
      )}
    </div>
  );
};
