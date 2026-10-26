import React from 'react';
import {
  ShieldCheck,
  Stethoscope,
  Volume2,
  VolumeX,
  LogOut,
  Globe,
  BellRing,
} from 'lucide-react';
import {Language, NetworkState} from '../types/triage';
import {LANGUAGE_LABELS} from '../data/initialData';
import {PWAInstallButton} from './PWAInstallButton';

interface TopRoleToolbarProps {
  activeView: 'asha' | 'command';
  onSelectView: (view: 'asha' | 'command') => void;
  networkState: NetworkState;
  onCycleNetwork: () => void;
  audioMuted: boolean;
  onToggleAudioMuted: () => void;
  onTestSiren: () => void;
  language: Language;
  onLanguageChange: (lang: Language) => void;
  unassignedRedCount: number;
  connectedPeers: number;
  onLogout: () => void;
}

export const TopRoleToolbar: React.FC<TopRoleToolbarProps> = ({
  activeView,
  onSelectView,
  networkState,
  onCycleNetwork,
  audioMuted,
  onToggleAudioMuted,
  onTestSiren,
  language,
  onLanguageChange,
  unassignedRedCount,
  connectedPeers,
  onLogout,
}) => {
  const networkConfig =
    networkState === '4g'
      ? {
          label: '🟢 4G Sync Active',
          style: 'bg-emerald-500/15 border-emerald-400/40 text-emerald-300',
        }
      : networkState === '2g'
      ? {
          label: '🟡 2G Delta Mode',
          style: 'bg-amber-500/15 border-amber-400/40 text-amber-300',
        }
      : {
          label: '🔴 100% Offline (No Internet)',
          style: 'bg-red-500/15 border-red-400/40 text-red-300',
        };

  return (
    <header className="bg-[#0F172A] text-white border-b border-slate-800 sticky top-0 z-40">
      <div className="max-w-[1440px] mx-auto px-3 sm:px-5 py-2.5 flex flex-wrap items-center justify-between gap-3">
        {/* Brand + ABDM Badge */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-9 h-9 rounded-xl bg-[#0D9488] flex items-center justify-center shadow-xs">
            <Stethoscope className="w-5 h-5 text-white" />
          </div>
          <span className="text-base font-bold tracking-tight whitespace-nowrap">
            HealthSync Edge
          </span>
          <span className="hidden md:inline-flex items-center gap-1 text-[11px] font-semibold text-[#06B6D4] pl-1">
            <ShieldCheck className="w-3.5 h-3.5 text-[#10B981]" />
            ABDM Compliant · {connectedPeers} {connectedPeers === 1 ? 'Node' : 'Nodes'} Live
          </span>
        </div>

        {/* Interactive Mode Toggle: ASHA Field App vs District Command Center */}
        <div
          role="tablist"
          aria-label="Workspace View Switcher"
          className="flex items-center gap-1 p-1 rounded-2xl bg-slate-800/90 border border-slate-700"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeView === 'asha'}
            onClick={() => onSelectView('asha')}
            className={`min-h-[40px] px-3.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeView === 'asha'
                ? 'bg-[#0D9488] text-white shadow-xs'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            📱 ASHA Field App (Mobile)
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeView === 'command'}
            onClick={() => onSelectView('command')}
            className={`min-h-[40px] px-3.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
              activeView === 'command'
                ? 'bg-[#0D9488] text-white shadow-xs'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <span>🏥 District Command Center (Desktop)</span>
            {unassignedRedCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-[#EF4444] text-white font-mono text-[11px] font-bold tabular-nums animate-pulse">
                {unassignedRedCount}
              </span>
            )}
          </button>
        </div>

        {/* Right Controls: Live Connectivity Switch + Audio Siren Master Control + Language + Logout */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {/* Live Connectivity Simulator Switch */}
          <button
            type="button"
            onClick={onCycleNetwork}
            title="Click to cycle 4G Sync / 2G Delta / 100% Offline"
            className={`min-h-[40px] px-3 rounded-xl border text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${networkConfig.style}`}
          >
            {networkConfig.label}
          </button>

          {/* Audio Siren Master Control */}
          <button
            type="button"
            onClick={onToggleAudioMuted}
            title={audioMuted ? 'Unmute Emergency Siren Audio' : 'Mute Emergency Siren Audio'}
            className={`min-h-[40px] px-3 rounded-xl border text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
              audioMuted
                ? 'bg-slate-800 border-slate-700 text-slate-400'
                : 'bg-teal-500/15 border-[#06B6D4]/40 text-[#06B6D4]'
            }`}
          >
            {audioMuted ? (
              <VolumeX className="w-4 h-4 shrink-0" />
            ) : (
              <Volume2 className="w-4 h-4 shrink-0" />
            )}
            <span className="hidden sm:inline">{audioMuted ? 'Siren Muted' : 'Siren Armed'}</span>
          </button>

          <button
            type="button"
            onClick={onTestSiren}
            title="Test Siren Sound"
            className="min-h-[40px] px-2.5 rounded-xl bg-red-500/15 hover:bg-red-500/25 border border-red-400/35 text-red-300 text-xs font-bold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
          >
            <BellRing className="w-3.5 h-3.5" />
            <span className="hidden xl:inline">Test Siren</span>
          </button>

          <div className="relative hidden sm:flex items-center">
            <Globe className="w-3.5 h-3.5 text-[#06B6D4] absolute left-2.5 pointer-events-none" />
            <select
              aria-label="Language"
              value={language}
              onChange={(e) => onLanguageChange(e.target.value as Language)}
              className="min-h-[40px] pl-8 pr-6 rounded-xl bg-slate-800 border border-slate-700 text-xs font-semibold text-white cursor-pointer"
            >
              {(Object.keys(LANGUAGE_LABELS) as Language[]).map((k) => (
                <option key={k} value={k}>
                  {LANGUAGE_LABELS[k]}
                </option>
              ))}
            </select>
          </div>

          <PWAInstallButton compact />

          <button
            type="button"
            onClick={onLogout}
            title="Return to Login"
            className="min-h-[40px] px-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white inline-flex items-center justify-center cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
