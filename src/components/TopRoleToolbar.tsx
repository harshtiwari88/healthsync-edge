import React from 'react';
import {
  Volume2,
  VolumeX,
  LogOut,
  Globe,
  Radio,
} from 'lucide-react';
import {Language, NetworkState} from '../types/triage';
import {LANGUAGE_LABELS} from '../data/initialData';

interface TopRoleToolbarProps {
  activeView: 'asha' | 'command';
  onSelectView: (view: 'asha' | 'command') => void;
  networkState: NetworkState;
  onCycleNetwork: () => void;
  audioMuted: boolean;
  onToggleAudioMuted: () => void;
  language: Language;
  onLanguageChange: (lang: Language) => void;
  unassignedRedCount: number;
  onLogout: () => void;
}

export const TopRoleToolbar: React.FC<TopRoleToolbarProps> = ({
  activeView,
  onSelectView,
  networkState,
  onCycleNetwork,
  audioMuted,
  onToggleAudioMuted,
  language,
  onLanguageChange,
  unassignedRedCount,
  onLogout,
}) => {
  const rfLabel =
    networkState === '4g'
      ? 'RF: 4G-LTE'
      : networkState === '2g'
      ? 'RF: 2G-EDGE'
      : 'RF: ZERO-NET';

  const rfColor =
    networkState === '4g'
      ? 'text-[#06B6D4] border-[#06B6D4]/50 bg-[#06B6D4]/10'
      : networkState === '2g'
      ? 'text-[#F59E0B] border-[#F59E0B]/50 bg-[#F59E0B]/10'
      : 'text-[#EF4444] border-[#EF4444]/50 bg-[#EF4444]/10';

  return (
    <header className="bg-[#090D16] text-slate-100 border-b border-slate-800 sticky top-0 z-40">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-13 flex items-center justify-between gap-8">
        {/* Zone 1: Single-Line Brand Wordmark */}
        <span className="font-mono text-sm sm:text-base font-bold tracking-tight text-white whitespace-nowrap shrink-0">
          HealthSync OS v3.2
        </span>

        {/* Zone 2: Clean Single-Line Navigation Links */}
        <nav
          aria-label="Primary OS Navigation"
          className="flex items-center gap-5 sm:gap-7 text-xs sm:text-sm font-medium"
        >
          <button
            type="button"
            onClick={() => onSelectView('asha')}
            className={`py-1 border-b-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              activeView === 'asha'
                ? 'border-[#06B6D4] text-white font-semibold'
                : 'border-transparent text-slate-400 hover:text-slate-100'
            }`}
          >
            Field Slate
          </button>

          <button
            type="button"
            onClick={() => onSelectView('command')}
            className={`py-1 border-b-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              activeView === 'command'
                ? 'border-[#F59E0B] text-white font-semibold'
                : 'border-transparent text-slate-400 hover:text-slate-100'
            }`}
          >
            War-Room{unassignedRedCount > 0 ? ` (${unassignedRedCount})` : ''}
          </button>

          <button
            type="button"
            onClick={onCycleNetwork}
            title="Cycle RF Transport Mode"
            className={`hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded border font-mono text-xs cursor-pointer whitespace-nowrap shrink-0 ${rfColor}`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>{rfLabel}</span>
          </button>

          <button
            type="button"
            onClick={onToggleAudioMuted}
            className="hidden sm:inline-flex items-center gap-1.5 text-xs font-mono text-slate-300 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
          >
            {audioMuted ? (
              <VolumeX className="w-3.5 h-3.5 text-slate-500" />
            ) : (
              <Volume2 className="w-3.5 h-3.5 text-[#06B6D4]" />
            )}
            <span>{audioMuted ? 'Audio Off' : 'Audio Armed'}</span>
          </button>

          <div className="hidden lg:flex items-center relative shrink-0">
            <Globe className="w-3.5 h-3.5 text-[#06B6D4] absolute left-2 pointer-events-none" />
            <select
              aria-label="Select Language"
              value={language}
              onChange={(e) => onLanguageChange(e.target.value as Language)}
              className="h-8 pl-7 pr-5 rounded bg-[#0D1322] border border-slate-800 text-xs font-mono text-slate-200 cursor-pointer"
            >
              {(Object.keys(LANGUAGE_LABELS) as Language[]).map((k) => (
                <option key={k} value={k}>
                  {k.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
        </nav>

        {/* Zone 3: Single Primary Action */}
        <button
          type="button"
          onClick={onLogout}
          className="h-9 px-3.5 rounded-lg bg-[#11192C] hover:bg-slate-800 border border-slate-700 font-mono text-xs font-semibold text-slate-200 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
        >
          <LogOut className="w-3.5 h-3.5 text-[#F59E0B]" />
          <span>Lock Terminal</span>
        </button>
      </div>
    </header>
  );
};
