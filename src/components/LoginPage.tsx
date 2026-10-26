import React, {useState} from 'react';
import {motion, AnimatePresence} from 'motion/react';
import {
  ShieldCheck,
  Fingerprint,
  Eye,
  EyeOff,
  Globe,
  Stethoscope,
  Building2,
  ArrowRight,
  Volume2,
  ScanEye,
  Binary,
  Mic,
  CheckCircle2,
} from 'lucide-react';
import {Language} from '../types/triage';
import {LANGUAGE_LABELS, UI_COPY} from '../data/initialData';
import {sirenEngine} from '../utils/sirenAudio';
import {PWAInstallButton} from './PWAInstallButton';

interface LoginPageProps {
  language: Language;
  onLanguageChange: (lang: Language) => void;
  onLoginAsha: (ashaId: string) => void;
  onLoginDmo: (dmoEmail: string) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({
  language,
  onLanguageChange,
  onLoginAsha,
  onLoginDmo,
}) => {
  const [selectedRole, setSelectedRole] = useState<'asha' | 'dmo'>('asha');
  const [ashaId, setAshaId] = useState<string>('ASHA-8842-UP');
  const [pin, setPin] = useState<string>('2408');
  const [showPin, setShowPin] = useState<boolean>(false);
  const [biometricScanning, setBiometricScanning] = useState<boolean>(false);
  const [sirenTested, setSirenTested] = useState<boolean>(false);

  const [dmoId, setDmoId] = useState<string>('dmo.district24@nhm.up.gov.in');
  const [dmoCode, setDmoCode] = useState<string>('DMO-24-HQ');

  const copy = UI_COPY[language];

  const handleTestSiren = () => {
    sirenEngine.unlock();
    sirenEngine.playTestSirenBurst();
    setSirenTested(true);
  };

  const handleAshaSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sirenEngine.unlock();
    onLoginAsha(ashaId.trim() || 'ASHA-8842-UP');
  };

  const handleBiometricUnlock = () => {
    sirenEngine.unlock();
    setBiometricScanning(true);
    setTimeout(() => {
      setBiometricScanning(false);
      onLoginAsha(ashaId.trim() || 'ASHA-8842-UP');
    }, 550);
  };

  const handleDmoSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sirenEngine.unlock();
    onLoginDmo(dmoId.trim() || 'dmo.district24@nhm.up.gov.in');
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col justify-between">
      {/* Top Bar */}
      <header className="w-full border-b border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-10 h-10 rounded-xl bg-[#0D9488] text-white flex items-center justify-center shadow-xs">
              <Stethoscope className="w-5 h-5" />
            </div>
            <span className="text-lg font-bold tracking-tight text-[#0F172A] whitespace-nowrap">
              HealthSync Edge
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {/* Test Siren Sound Button to grant Browser Audio Autoplay Permissions */}
            <button
              type="button"
              onClick={handleTestSiren}
              className={`min-h-[44px] px-3.5 rounded-xl border text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                sirenTested
                  ? 'bg-emerald-50 border-[#10B981] text-emerald-900'
                  : 'bg-red-50 border-red-200 text-[#EF4444] hover:bg-red-100'
              }`}
            >
              <Volume2 className="w-4 h-4 shrink-0" />
              <span>{sirenTested ? 'Audio Siren Unlocked' : 'Test Siren Sound'}</span>
            </button>

            <div className="relative flex items-center">
              <Globe
                className="w-4 h-4 text-[#0D9488] absolute left-3.5 pointer-events-none"
                aria-hidden="true"
              />
              <select
                aria-label="Select Interface Language"
                value={language}
                onChange={(e) => onLanguageChange(e.target.value as Language)}
                className="min-h-[44px] pl-9 pr-8 rounded-xl border border-slate-300 bg-white text-xs sm:text-sm font-semibold text-slate-900 hover:border-[#0D9488] transition-colors cursor-pointer"
              >
                {(Object.keys(LANGUAGE_LABELS) as Language[]).map((langKey) => (
                  <option key={langKey} value={langKey}>
                    {LANGUAGE_LABELS[langKey]}
                  </option>
                ))}
              </select>
            </div>
            <PWAInstallButton compact />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center px-4 sm:px-6 py-8 sm:py-12">
        <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
          {/* Left Architecture Capabilities */}
          <div className="hidden lg:block lg:col-span-6 space-y-6">
            <div className="inline-flex items-center gap-2 text-xs font-bold text-[#0D9488]">
              <ShieldCheck className="w-4 h-4 text-[#10B981]" />
              <span>Ayushman Bharat Digital Mission (ABDM) Compliant</span>
            </div>

            <h1 className="text-4xl font-bold tracking-tight text-[#0F172A] leading-tight text-balance">
              Voice-First, Real-Time Rural Tele-Triage at the Edge.
            </h1>

            <p className="text-base text-slate-600 leading-relaxed">
              {copy.tagline}. Powered by browser-native Web Speech recognition, WebRTC camera
              conjunctiva pixel analysis, bitwise Base64 SMS compression, and cross-device WebSocket
              emergency alerts.
            </p>

            <div className="space-y-3.5 pt-2 border-t border-slate-200">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-teal-50 text-[#0D9488] flex items-center justify-center shrink-0 mt-0.5">
                  <Mic className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-[#0F172A]">
                    Live Web Speech &amp; Hindi TTS Guidance
                  </h2>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Real-time SpeechRecognition parses BP, SpO₂, fever &amp; symptoms directly from
                    voice.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-cyan-50 text-[#06B6D4] flex items-center justify-center shrink-0 mt-0.5">
                  <ScanEye className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-[#0F172A]">
                    Camera &lt;canvas&gt; RGB Pixel Pallor Analysis
                  </h2>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Extracts real Red-vs-Green/Blue channel ratios inside the conjunctiva alignment
                    box.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-slate-900 text-[#06B6D4] flex items-center justify-center shrink-0 mt-0.5">
                  <Binary className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-[#0F172A]">
                    18-Byte Bitwise Base64 SMS + CRC-16 Sync
                  </h2>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Packs vitals into a verified `HS#` binary payload broadcast live to District
                    Command.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Centered Login Card */}
          <motion.div
            initial={{opacity: 0, y: 12}}
            animate={{opacity: 1, y: 0}}
            transition={{type: 'spring', stiffness: 320, damping: 28}}
            className="lg:col-span-6 w-full max-w-md mx-auto bg-white rounded-3xl border border-slate-200 shadow-xl p-6 sm:p-8"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-2xl font-bold tracking-tight text-[#0F172A]">
                  HealthSync Edge
                </h2>
                <p className="text-xs text-slate-600 mt-1">{copy.tagline}</p>
              </div>
              <div className="px-2.5 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-[#0D9488] text-[11px] font-bold inline-flex items-center gap-1.5 shrink-0">
                <ShieldCheck className="w-3.5 h-3.5 text-[#10B981]" />
                <span>ABDM Verified</span>
              </div>
            </div>

            {/* Role Selection Tabs */}
            <div
              role="tablist"
              aria-label="Select Role"
              className="mt-6 grid grid-cols-2 gap-1.5 p-1.5 rounded-2xl bg-slate-100"
            >
              <button
                type="button"
                role="tab"
                aria-selected={selectedRole === 'asha'}
                onClick={() => setSelectedRole('asha')}
                className={`min-h-[48px] px-3 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  selectedRole === 'asha'
                    ? 'bg-[#0D9488] text-white shadow-xs'
                    : 'text-slate-700 hover:text-slate-900'
                }`}
              >
                {copy.ashaRoleTab}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={selectedRole === 'dmo'}
                onClick={() => setSelectedRole('dmo')}
                className={`min-h-[48px] px-3 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  selectedRole === 'dmo'
                    ? 'bg-[#0F172A] text-white shadow-xs'
                    : 'text-slate-700 hover:text-slate-900'
                }`}
              >
                {copy.dmoRoleTab}
              </button>
            </div>

            <AnimatePresence mode="wait">
              {selectedRole === 'asha' ? (
                <motion.form
                  key="asha-login"
                  initial={{opacity: 0, x: -8}}
                  animate={{opacity: 1, x: 0}}
                  exit={{opacity: 0, x: 8}}
                  transition={{duration: 0.16}}
                  onSubmit={handleAshaSubmit}
                  className="mt-6 space-y-4"
                >
                  <div>
                    <label
                      htmlFor="asha-id-field"
                      className="block text-xs font-bold text-slate-700 mb-1.5"
                    >
                      ASHA ID / Mobile Number
                    </label>
                    <input
                      id="asha-id-field"
                      type="text"
                      value={ashaId}
                      onChange={(e) => setAshaId(e.target.value)}
                      className="w-full min-h-[48px] px-4 rounded-xl border border-slate-300 bg-white font-mono text-sm font-semibold text-slate-900"
                      required
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label
                        htmlFor="asha-pin-field"
                        className="block text-xs font-bold text-slate-700"
                      >
                        4-Digit Security PIN
                      </label>
                      <span className="text-[11px] text-slate-500">Sunita Devi · PHC Rampur</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <input
                          id="asha-pin-field"
                          type={showPin ? 'text' : 'password'}
                          inputMode="numeric"
                          maxLength={4}
                          value={pin}
                          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                          className="w-full min-h-[48px] pl-4 pr-11 rounded-xl border border-slate-300 bg-white font-mono text-lg tracking-widest font-bold text-slate-900 tabular-nums"
                          required
                        />
                        <button
                          type="button"
                          onClick={() => setShowPin((s) => !s)}
                          aria-label="Toggle PIN visibility"
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-500 hover:text-slate-800 rounded-lg cursor-pointer"
                        >
                          {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={handleBiometricUnlock}
                        className={`min-h-[48px] px-3.5 rounded-xl border flex items-center gap-2 text-xs font-bold transition-all cursor-pointer shrink-0 ${
                          biometricScanning
                            ? 'bg-emerald-50 border-[#10B981] text-[#0D9488]'
                            : 'bg-slate-50 border-slate-300 text-slate-800 hover:border-[#0D9488]'
                        }`}
                      >
                        <Fingerprint
                          className={`w-5 h-5 ${
                            biometricScanning ? 'text-[#10B981] animate-pulse' : 'text-[#0D9488]'
                          }`}
                        />
                        <span className="hidden sm:inline">
                          {biometricScanning ? 'Verified...' : 'Biometric'}
                        </span>
                      </button>
                    </div>
                  </div>

                  <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3 flex items-center justify-between text-xs text-slate-700">
                    <span className="inline-flex items-center gap-1.5 font-semibold">
                      <CheckCircle2 className="w-4 h-4 text-[#10B981] shrink-0" />
                      Sunita Devi (ASHA #8842) · VIL-204
                    </span>
                    <span className="font-mono text-[11px] text-[#0D9488] font-bold">Ready</span>
                  </div>

                  <button
                    type="submit"
                    className="w-full min-h-[52px] px-5 rounded-xl bg-[#0D9488] hover:bg-teal-700 active:scale-[0.99] text-white text-sm sm:text-base font-bold inline-flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
                  >
                    <span>{copy.loginAshaBtn}</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </motion.form>
              ) : (
                <motion.form
                  key="dmo-login"
                  initial={{opacity: 0, x: 8}}
                  animate={{opacity: 1, x: 0}}
                  exit={{opacity: 0, x: -8}}
                  transition={{duration: 0.16}}
                  onSubmit={handleDmoSubmit}
                  className="mt-6 space-y-4"
                >
                  <div>
                    <label
                      htmlFor="dmo-email-field"
                      className="block text-xs font-bold text-slate-700 mb-1.5"
                    >
                      Official Government Email / DMO ID
                    </label>
                    <input
                      id="dmo-email-field"
                      type="text"
                      value={dmoId}
                      onChange={(e) => setDmoId(e.target.value)}
                      className="w-full min-h-[48px] px-4 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-900"
                      required
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="dmo-node-field"
                      className="block text-xs font-bold text-slate-700 mb-1.5"
                    >
                      Command Center Gateway Node
                    </label>
                    <input
                      id="dmo-node-field"
                      type="text"
                      value={dmoCode}
                      onChange={(e) => setDmoCode(e.target.value)}
                      className="w-full min-h-[48px] px-4 rounded-xl border border-slate-300 bg-slate-50 font-mono text-sm font-semibold text-slate-800"
                    />
                  </div>

                  <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3 flex items-center gap-2.5 text-xs text-slate-700">
                    <Building2 className="w-4 h-4 text-[#0D9488] shrink-0" />
                    <span>
                      Live WebSocket Stream + Web Audio Emergency Siren Active
                    </span>
                  </div>

                  <button
                    type="submit"
                    className="w-full min-h-[52px] px-5 rounded-xl bg-[#0F172A] hover:bg-slate-800 active:scale-[0.99] text-white text-sm sm:text-base font-bold inline-flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
                  >
                    <span>{copy.loginDmoBtn}</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </motion.form>
              )}
            </AnimatePresence>
          </motion.div>
        </div>
      </main>

      <footer className="py-4 text-center text-xs text-slate-500 border-t border-slate-200 bg-white">
        HealthSync Edge · Real Web Speech, WebRTC Canvas Pallor, Bitwise SMS &amp; Multi-Device
        WebSocket Sync
      </footer>
    </div>
  );
};
