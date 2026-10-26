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
  Radio,
  WifiOff,
  Mic,
  CheckCircle2,
} from 'lucide-react';
import {Language} from '../types/triage';
import {LANGUAGE_LABELS, UI_COPY} from '../data/initialData';
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

  const [dmoId, setDmoId] = useState<string>('dmo.district24@nhm.up.gov.in');
  const [dmoCode, setDmoCode] = useState<string>('DMO-24-HQ');

  const copy = UI_COPY[language];

  const handleAshaSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onLoginAsha(ashaId.trim() || 'ASHA-8842-UP');
  };

  const handleBiometricUnlock = () => {
    setBiometricScanning(true);
    setTimeout(() => {
      setBiometricScanning(false);
      onLoginAsha(ashaId.trim() || 'ASHA-8842-UP');
    }, 650);
  };

  const handleDmoSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onLoginDmo(dmoId.trim() || 'dmo.district24@nhm.up.gov.in');
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between">
      {/* Top Bar */}
      <header className="w-full border-b border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-10 h-10 rounded-xl bg-[#0F766E] text-white flex items-center justify-center shadow-xs">
              <Stethoscope className="w-5 h-5" />
            </div>
            <span className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap">
              HealthSync Edge
            </span>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <div className="relative flex items-center">
              <Globe
                className="w-4 h-4 text-[#0F766E] absolute left-3.5 pointer-events-none"
                aria-hidden="true"
              />
              <select
                aria-label="Select Interface Language"
                value={language}
                onChange={(e) => onLanguageChange(e.target.value as Language)}
                className="min-h-[48px] pl-9 pr-8 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-900 hover:border-[#0F766E] transition-colors cursor-pointer"
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

      {/* Main Centered Onboarding & Login Grid */}
      <main className="flex-1 flex items-center justify-center px-4 sm:px-6 py-8 sm:py-12">
        <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
          {/* Left Context Column (Visible on Desktop to anchor 1440px viewport cleanly) */}
          <div className="hidden lg:block lg:col-span-6 space-y-6">
            <div className="inline-flex items-center gap-2 text-xs font-bold text-[#0F766E]">
              <ShieldCheck className="w-4 h-4 text-[#10B981]" />
              <span>ABDM (Ayushman Bharat Digital Mission) Compliant Architecture</span>
            </div>

            <h1 className="text-4xl font-bold tracking-tight text-slate-900 leading-tight text-balance">
              Voice-First, Zero-Network Rural Tele-Triage at the Last Mile.
            </h1>

            <p className="text-base text-slate-600 leading-relaxed">
              {copy.tagline}. Built for frontline ASHA &amp; ANM workers to capture vitals by voice,
              run on-device anemia &amp; respiratory micro-diagnostics, and dispatch 160-character
              bit-packed emergency SMS alerts without internet.
            </p>

            <div className="space-y-3.5 pt-2 border-t border-slate-200">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-teal-50 text-[#0F766E] flex items-center justify-center shrink-0 mt-0.5">
                  <Mic className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900">
                    ASHA Saheli Bilingual Voice Triage
                  </h2>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Hands-free Hindi &amp; regional speech-to-vitals capture with spoken clinical
                    guidance.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-50 text-[#10B981] flex items-center justify-center shrink-0 mt-0.5">
                  <Radio className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900">
                    Baseband Binary SMS &amp; BLE Mesh Relay
                  </h2>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Compresses ABHA vitals into a verified 160-character Base64 GSM packet unpacked
                    into FHIR JSON at District HQ.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-50 text-[#F59E0B] flex items-center justify-center shrink-0 mt-0.5">
                  <WifiOff className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900">
                    Offline Queue &amp; Automated NHM Incentives
                  </h2>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Stores screenings offline on device and tracks real-time Mera Incentive BMO
                    vouchers.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Centered Modern Login Card */}
          <motion.div
            initial={{opacity: 0, y: 12}}
            animate={{opacity: 1, y: 0}}
            transition={{duration: 0.22}}
            className="lg:col-span-6 w-full max-w-md mx-auto bg-white rounded-3xl border border-slate-200 shadow-xl p-6 sm:p-8"
          >
            {/* Card Branding & ABDM Compliance Badge */}
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-2xl font-bold tracking-tight text-slate-900">
                  HealthSync Edge
                </h2>
                <p className="text-xs text-slate-600 mt-1">{copy.tagline}</p>
              </div>
              <div className="px-2.5 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-[#0F766E] text-[11px] font-bold inline-flex items-center gap-1.5 shrink-0">
                <ShieldCheck className="w-3.5 h-3.5 text-[#10B981]" />
                <span>ABDM Verified</span>
              </div>
            </div>

            {/* Role Selection Tabs */}
            <div
              role="tablist"
              aria-label="Select User Role"
              className="mt-6 grid grid-cols-2 gap-1.5 p-1.5 rounded-2xl bg-slate-100"
            >
              <button
                type="button"
                role="tab"
                aria-selected={selectedRole === 'asha'}
                onClick={() => setSelectedRole('asha')}
                className={`min-h-[48px] px-3 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  selectedRole === 'asha'
                    ? 'bg-[#0F766E] text-white shadow-xs'
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
                    ? 'bg-[#0F766E] text-white shadow-xs'
                    : 'text-slate-700 hover:text-slate-900'
                }`}
              >
                {copy.dmoRoleTab}
              </button>
            </div>

            {/* Role Forms */}
            <AnimatePresence mode="wait">
              {selectedRole === 'asha' ? (
                <motion.form
                  key="asha-form"
                  initial={{opacity: 0, x: -8}}
                  animate={{opacity: 1, x: 0}}
                  exit={{opacity: 0, x: 8}}
                  transition={{duration: 0.16}}
                  onSubmit={handleAshaSubmit}
                  className="mt-6 space-y-4"
                >
                  <div>
                    <label
                      htmlFor="asha-id-input"
                      className="block text-xs font-bold text-slate-700 mb-1.5"
                    >
                      ASHA ID / Mobile Number
                    </label>
                    <input
                      id="asha-id-input"
                      type="text"
                      value={ashaId}
                      onChange={(e) => setAshaId(e.target.value)}
                      placeholder="ASHA-8842-UP"
                      className="w-full min-h-[48px] px-4 rounded-xl border border-slate-300 bg-white font-mono text-sm font-semibold text-slate-900"
                      required
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label
                        htmlFor="asha-pin-input"
                        className="block text-xs font-bold text-slate-700"
                      >
                        4-Digit Security PIN
                      </label>
                      <span className="text-[11px] text-slate-500">Offline Keystore Cached</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <input
                          id="asha-pin-input"
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
                          aria-label={showPin ? 'Hide Security PIN' : 'Show Security PIN'}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-500 hover:text-slate-800 rounded-lg cursor-pointer"
                        >
                          {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>

                      {/* Biometric Unlock Button */}
                      <button
                        type="button"
                        onClick={handleBiometricUnlock}
                        title="Unlock with Device Biometrics"
                        aria-label="Biometric Fingerprint Unlock"
                        className={`min-h-[48px] px-3.5 rounded-xl border flex items-center gap-2 text-xs font-bold transition-all cursor-pointer shrink-0 ${
                          biometricScanning
                            ? 'bg-emerald-50 border-[#10B981] text-[#0F766E]'
                            : 'bg-slate-50 border-slate-300 text-slate-800 hover:border-[#0F766E]'
                        }`}
                      >
                        <Fingerprint
                          className={`w-5 h-5 ${
                            biometricScanning ? 'text-[#10B981] animate-pulse' : 'text-[#0F766E]'
                          }`}
                        />
                        <span className="hidden sm:inline">
                          {biometricScanning ? 'Verified...' : 'Biometric'}
                        </span>
                      </button>
                    </div>
                  </div>

                  <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3 flex items-center justify-between text-xs text-slate-600">
                    <span className="inline-flex items-center gap-1.5 font-medium text-slate-800">
                      <CheckCircle2 className="w-4 h-4 text-[#10B981] shrink-0" />
                      Assigned Sub-Center: Sunita Devi · VIL-204
                    </span>
                    <span className="font-mono text-[11px] text-slate-500">Offline Ready</span>
                  </div>

                  <button
                    type="submit"
                    className="w-full min-h-[52px] px-5 rounded-xl bg-[#0F766E] hover:bg-teal-800 active:scale-[0.99] text-white text-sm sm:text-base font-bold inline-flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
                  >
                    <span>{copy.loginAshaBtn}</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </motion.form>
              ) : (
                <motion.form
                  key="dmo-form"
                  initial={{opacity: 0, x: 8}}
                  animate={{opacity: 1, x: 0}}
                  exit={{opacity: 0, x: -8}}
                  transition={{duration: 0.16}}
                  onSubmit={handleDmoSubmit}
                  className="mt-6 space-y-4"
                >
                  <div>
                    <label
                      htmlFor="dmo-email-input"
                      className="block text-xs font-bold text-slate-700 mb-1.5"
                    >
                      Official Government Email / DMO ID
                    </label>
                    <input
                      id="dmo-email-input"
                      type="text"
                      value={dmoId}
                      onChange={(e) => setDmoId(e.target.value)}
                      placeholder="dmo.district24@nhm.up.gov.in"
                      className="w-full min-h-[48px] px-4 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-900"
                      required
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="dmo-hq-input"
                      className="block text-xs font-bold text-slate-700 mb-1.5"
                    >
                      District Command Node Code
                    </label>
                    <input
                      id="dmo-hq-input"
                      type="text"
                      value={dmoCode}
                      onChange={(e) => setDmoCode(e.target.value)}
                      className="w-full min-h-[48px] px-4 rounded-xl border border-slate-300 bg-slate-50 font-mono text-sm font-semibold text-slate-800"
                    />
                  </div>

                  <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3 flex items-center gap-2.5 text-xs text-slate-700">
                    <Building2 className="w-4 h-4 text-[#0F766E] shrink-0" />
                    <span>
                      Connected to District 24 Baseband SMS Gateway &amp; 108 ALS Dispatch Feed
                    </span>
                  </div>

                  <button
                    type="submit"
                    className="w-full min-h-[52px] px-5 rounded-xl bg-slate-900 hover:bg-slate-800 active:scale-[0.99] text-white text-sm sm:text-base font-bold inline-flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
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
        HealthSync Edge · ABDM HIE-CM &amp; FHIR R4 Tele-Triage Prototype · District 24 Rural Health
        Network
      </footer>
    </div>
  );
};
