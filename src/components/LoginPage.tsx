import React, {useState} from 'react';
import {
  Fingerprint,
  Volume2,
  ArrowRight,
  Cpu,
  Radio,
  Database,
  Delete,
} from 'lucide-react';
import {Language} from '../types/triage';
import {LANGUAGE_LABELS} from '../data/initialData';
import {sirenEngine} from '../utils/sirenAudio';
import {PWAInstallButton} from './PWAInstallButton';

interface LoginPageProps {
  language: Language;
  onLanguageChange: (lang: Language) => void;
  onLoginAsha: (ashaId: string) => void;
  onLoginDmo: (dmoEmail: string) => void;
}

const ASHA_OPERATOR_NODES = [
  {id: 'ASHA-8842-UP', label: 'Sunita Devi · Sub-Center VIL-204'},
  {id: 'ASHA-8859-UP', label: 'Geeta Verma · Sub-Center VIL-208'},
] as const;

const DMO_COMMAND_NODES = [
  {id: 'dmo.district24@nhm.up.gov.in', label: 'CMO / DMO War-Room · District 24 HQ'},
  {id: 'als108.dispatch@nhm.up.gov.in', label: 'ALS-108 Emergency Dispatch Desk'},
] as const;

export const LoginPage: React.FC<LoginPageProps> = ({
  language,
  onLanguageChange,
  onLoginAsha,
  onLoginDmo,
}) => {
  const [selectedRole, setSelectedRole] = useState<'asha' | 'dmo'>('asha');
  const [selectedAshaIdx, setSelectedAshaIdx] = useState<number>(0);
  const [selectedDmoIdx, setSelectedDmoIdx] = useState<number>(0);
  const [pinDigits, setPinDigits] = useState<string>('2408');
  const [biometricScanning, setBiometricScanning] = useState<boolean>(false);
  const [sirenArmed, setSirenArmed] = useState<boolean>(false);

  const handleArmAudio = () => {
    sirenEngine.unlock();
    sirenEngine.playTestSirenBurst();
    setSirenArmed(true);
  };

  const handleKeypadDigit = (digit: string) => {
    setPinDigits((prev) => (prev.length >= 4 ? digit : prev + digit));
  };

  const handleLaunchRole = () => {
    sirenEngine.unlock();
    if (selectedRole === 'asha') {
      onLoginAsha(ASHA_OPERATOR_NODES[selectedAshaIdx].id);
    } else {
      onLoginDmo(DMO_COMMAND_NODES[selectedDmoIdx].id);
    }
  };

  const handleBiometricVerify = () => {
    sirenEngine.unlock();
    setBiometricScanning(true);
    window.setTimeout(() => {
      setBiometricScanning(false);
      handleLaunchRole();
    }, 360);
  };

  return (
    <div className="min-h-screen os-grid-surface text-slate-100 flex flex-col justify-between pb-12">
      {/* Top 3-Zone Header */}
      <header className="border-b border-slate-800 bg-[#090D16]/95">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-8">
          <span className="font-mono text-base font-bold tracking-tight text-white whitespace-nowrap shrink-0">
            HealthSync OS v3.2
          </span>

          <div className="hidden md:flex items-center gap-6 font-mono text-xs text-slate-400">
            <span className="whitespace-nowrap">ONNX-WASM READY</span>
            <span className="whitespace-nowrap">160B CRC32 CODEC</span>
            <span className="whitespace-nowrap">CRDT VECTOR SYNC</span>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <select
              aria-label="Interface Language"
              value={language}
              onChange={(e) => onLanguageChange(e.target.value as Language)}
              className="h-9 px-3 rounded-lg bg-[#0D1322] border border-slate-700 font-mono text-xs text-slate-200 cursor-pointer"
            >
              {(Object.keys(LANGUAGE_LABELS) as Language[]).map((langKey) => (
                <option key={langKey} value={langKey}>
                  {LANGUAGE_LABELS[langKey]}
                </option>
              ))}
            </select>
            <PWAInstallButton compact />
          </div>
        </div>
      </header>

      {/* Main Tactical Boot & Terminal Authentication Split */}
      <main className="flex-1 flex items-center justify-center px-4 sm:px-6 py-8">
        <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          {/* Left 6 Cols: System Capabilities & Self-Test Telemetry */}
          <div className="lg:col-span-6 rounded-xl bg-[#0D1322]/90 border border-slate-800 p-6 sm:p-8 flex flex-col justify-between space-y-6">
            <div className="space-y-4">
              <div className="font-mono text-xs text-[#06B6D4]">
                ABDM HIE · TACTICAL MEDICAL FIELD OS
              </div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white leading-tight text-balance">
                High-Density Biometric Telemetry &amp; Zero-Network Triage.
              </h1>
              <p className="text-sm text-slate-400 leading-relaxed">
                Engineered for rural frontline ASHA tablets and District 24 emergency command.
                Combines 60fps PPG/ECG canvas oscilloscopes, local WASM conjunctiva pallor
                analysis, 1024-pt Web Audio cough spectrograms, and 160-character CRC32 Base64 SMS
                packets.
              </p>
            </div>

            <div className="space-y-3 pt-4 border-t border-slate-800 font-mono text-xs">
              <div className="flex items-center justify-between text-slate-300">
                <span className="inline-flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-[#06B6D4]" />
                  <span>WASM Optical &amp; FFT DSP</span>
                </span>
                <span className="text-[#06B6D4]">● CALIBRATED</span>
              </div>
              <div className="flex items-center justify-between text-slate-300">
                <span className="inline-flex items-center gap-2">
                  <Radio className="w-4 h-4 text-[#F59E0B]" />
                  <span>GSM-7 160B Bitstream Codec</span>
                </span>
                <span className="text-[#F59E0B]">● CRC32 ARMED</span>
              </div>
              <div className="flex items-center justify-between text-slate-300">
                <span className="inline-flex items-center gap-2">
                  <Database className="w-4 h-4 text-emerald-400" />
                  <span>IndexedDB + SQLCipher Vault</span>
                </span>
                <span className="text-emerald-400">● MOUNTED</span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleArmAudio}
              className={`min-h-[46px] px-4 rounded-lg border font-mono text-xs font-semibold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors ${
                sirenArmed
                  ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
                  : 'bg-[#090D16] border-slate-700 hover:border-[#F59E0B] text-[#F59E0B]'
              }`}
            >
              <Volume2 className="w-4 h-4 shrink-0" />
              <span>
                {sirenArmed
                  ? 'Web Audio Siren & TTS Synthesizer Verified'
                  : 'Run Audio Siren Self-Test (Unlock Web Audio)'}
              </span>
            </button>
          </div>

          {/* Right 6 Cols: Tactile Hardware Keypad & Node Selector (Zero Plain Forms) */}
          <div className="lg:col-span-6 rounded-xl bg-[#0D1322] border border-slate-800 p-6 sm:p-8 flex flex-col justify-between space-y-5">
            {/* Segmented Mode Selector */}
            <div
              role="tablist"
              aria-label="Select Terminal Mode"
              className="grid grid-cols-2 gap-1.5 p-1 rounded-lg bg-[#090D16] border border-slate-800"
            >
              <button
                type="button"
                role="tab"
                aria-selected={selectedRole === 'asha'}
                onClick={() => setSelectedRole('asha')}
                className={`min-h-[46px] px-3 rounded-md font-mono text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                  selectedRole === 'asha'
                    ? 'bg-[#06B6D4] text-[#090D16]'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                01. ASHA Field OS
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={selectedRole === 'dmo'}
                onClick={() => setSelectedRole('dmo')}
                className={`min-h-[46px] px-3 rounded-md font-mono text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                  selectedRole === 'dmo'
                    ? 'bg-[#F59E0B] text-[#090D16]'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                02. District War-Room
              </button>
            </div>

            {/* Hardware Node Selector Buttons */}
            <div className="space-y-2">
              <span className="block font-mono text-[11px] text-slate-400">
                SELECT ASSIGNED HARDWARE TERMINAL NODE
              </span>
              {selectedRole === 'asha' ? (
                <div className="space-y-2">
                  {ASHA_OPERATOR_NODES.map((node, idx) => (
                    <button
                      key={node.id}
                      type="button"
                      onClick={() => setSelectedAshaIdx(idx)}
                      className={`w-full min-h-[50px] px-3.5 py-2 rounded-lg border text-left flex items-center justify-between cursor-pointer transition-colors ${
                        selectedAshaIdx === idx
                          ? 'bg-[#06B6D4]/15 border-[#06B6D4] text-white'
                          : 'bg-[#090D16] border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <div>
                        <div className="text-xs font-semibold">{node.label}</div>
                        <div className="font-mono text-[11px] text-[#06B6D4]">{node.id}</div>
                      </div>
                      <span className="font-mono text-[10px] text-emerald-400">READY</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {DMO_COMMAND_NODES.map((node, idx) => (
                    <button
                      key={node.id}
                      type="button"
                      onClick={() => setSelectedDmoIdx(idx)}
                      className={`w-full min-h-[50px] px-3.5 py-2 rounded-lg border text-left flex items-center justify-between cursor-pointer transition-colors ${
                        selectedDmoIdx === idx
                          ? 'bg-[#F59E0B]/15 border-[#F59E0B] text-white'
                          : 'bg-[#090D16] border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <div>
                        <div className="text-xs font-semibold">{node.label}</div>
                        <div className="font-mono text-[11px] text-[#F59E0B]">{node.id}</div>
                      </div>
                      <span className="font-mono text-[10px] text-emerald-400">ONLINE</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Tactile Cryptographic PIN Pad + Biometric Trigger */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between font-mono text-[11px]">
                <span className="text-slate-400">OPERATOR CRYPTOGRAPHIC KEYPAD</span>
                <span className="text-[#06B6D4] tracking-widest tabular-nums">
                  PIN: {pinDigits.padEnd(4, '·').replace(/./g, (c) => (c === '·' ? '○' : '●'))}
                </span>
              </div>

              <div className="grid grid-cols-6 gap-1.5 font-mono">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => handleKeypadDigit(d)}
                    className="min-h-[44px] rounded-lg bg-[#090D16] hover:bg-slate-900 border border-slate-800 text-sm font-bold text-slate-200 cursor-pointer tabular-nums"
                  >
                    {d}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setPinDigits((p) => p.slice(0, -1))}
                  aria-label="Clear PIN digit"
                  className="min-h-[44px] rounded-lg bg-[#090D16] hover:bg-slate-900 border border-slate-800 text-slate-400 flex items-center justify-center cursor-pointer"
                >
                  <Delete className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={handleBiometricVerify}
                  title="Biometric Hardware Unlock"
                  className={`min-h-[44px] rounded-lg border flex items-center justify-center cursor-pointer ${
                    biometricScanning
                      ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                      : 'bg-[#090D16] border-[#06B6D4]/50 text-[#06B6D4]'
                  }`}
                >
                  <Fingerprint className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Primary Boot Execution Button */}
            <button
              type="button"
              onClick={handleLaunchRole}
              className={`w-full min-h-[52px] px-5 rounded-lg font-mono text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors ${
                selectedRole === 'asha'
                  ? 'bg-[#06B6D4] hover:bg-cyan-400 text-[#090D16]'
                  : 'bg-[#F59E0B] hover:bg-amber-400 text-[#090D16]'
              }`}
            >
              <span>
                {selectedRole === 'asha'
                  ? 'Boot ASHA Field OS v3.2'
                  : 'Open District 24 War-Room'}
              </span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </main>
    </div>
  );
};
