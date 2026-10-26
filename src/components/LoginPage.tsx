import React, {useState} from 'react';
import {
  AlertCircle,
  ArrowRight,
  Building2,
  Eye,
  EyeOff,
  Lock,
  ShieldCheck,
  Smartphone,
  Stethoscope,
} from 'lucide-react';
import {sirenEngine} from '../utils/sirenAudio';

interface LoginPageProps {
  onLoginAsha: (ashaId: string) => void;
  onLoginDmo: (dmoEmail: string) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({
  onLoginAsha,
  onLoginDmo,
}) => {
  const [activeTab, setActiveTab] = useState<'ASHA' | 'DMO'>('ASHA');
  const [ashaId, setAshaId] = useState<string>('ASHA-8842-UP');
  const [pin, setPin] = useState<string>('1234');
  const [showPin, setShowPin] = useState<boolean>(false);

  const [dmoEmail, setDmoEmail] = useState<string>('dmo.varanasi@nhm.gov.in');
  const [dmoPasscode, setDmoPasscode] = useState<string>('DMO-24');
  const [authError, setAuthError] = useState<string | null>(null);

  const handleAshaSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);

    const trimmedId = ashaId.trim();
    if (!trimmedId) {
      setAuthError('Please enter a valid ASHA Worker ID.');
      return;
    }
    if (pin !== '1234') {
      setAuthError('Authentication failed: Invalid 4-Digit Security PIN (expected 1234).');
      return;
    }

    sirenEngine.unlock();
    onLoginAsha(trimmedId);
  };

  const handleDmoSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);

    const trimmedEmail = dmoEmail.trim();
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setAuthError('Please enter a valid official District Health Officer email.');
      return;
    }
    if (!dmoPasscode.trim()) {
      setAuthError('Please enter your District Command authorization code.');
      return;
    }

    sirenEngine.unlock();
    onLoginDmo(trimmedEmail);
  };

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-8">
      {/* Fixed-size rock-solid centered card */}
      <div className="max-w-md w-full mx-auto my-auto p-6 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl">
        {/* Branding Header */}
        <div className="text-center space-y-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-600 text-white">
            <Stethoscope className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100">
            HealthSync Edge
          </h1>
          <p className="text-sm text-slate-400">
            Voice-First, Offline-First Rural Tele-Triage Platform
          </p>
          <p className="pt-0.5 text-xs font-medium text-teal-400">
            <ShieldCheck className="mr-1 inline h-3.5 w-3.5 align-text-bottom text-emerald-400" />
            Ayushman Bharat Digital Mission (ABDM) Compliant
          </p>
        </div>

        {/* Clean Role Tab Switcher */}
        <div
          role="tablist"
          aria-label="Select Role to Authenticate"
          className="mt-6 grid grid-cols-2 gap-1.5 rounded-xl border border-slate-800 bg-slate-950 p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'ASHA'}
            onClick={() => {
              setActiveTab('ASHA');
              setAuthError(null);
            }}
            className={`min-h-[44px] rounded-lg px-3 text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'ASHA'
                ? 'bg-teal-600 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Smartphone className="h-3.5 w-3.5 shrink-0" />
            <span>ASHA Worker</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'DMO'}
            onClick={() => {
              setActiveTab('DMO');
              setAuthError(null);
            }}
            className={`min-h-[44px] rounded-lg px-3 text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'DMO'
                ? 'bg-teal-600 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Building2 className="h-3.5 w-3.5 shrink-0" />
            <span>District Officer (DMO)</span>
          </button>
        </div>

        {authError && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-950/60 p-3 text-xs font-medium text-red-200"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
            <span>{authError}</span>
          </div>
        )}

        {/* ASHA Worker Login Form */}
        {activeTab === 'ASHA' ? (
          <form onSubmit={handleAshaSubmit} className="mt-5 space-y-4">
            <div>
              <label
                htmlFor="asha-id-input"
                className="mb-1.5 block text-xs font-semibold text-slate-300"
              >
                ASHA Worker ID / Mobile
              </label>
              <input
                id="asha-id-input"
                type="text"
                value={ashaId}
                onChange={(e) => setAshaId(e.target.value)}
                required
                className="min-h-[46px] w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 font-mono text-sm font-semibold text-slate-100 focus:border-teal-500 focus:outline-none"
              />
              <p className="mt-1 text-xs text-slate-500">
                Field Unit: Sunita Devi · Rampur Sub-Center (VIL-204)
              </p>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label
                  htmlFor="asha-pin-input"
                  className="text-xs font-semibold text-slate-300"
                >
                  4-Digit Security PIN
                </label>
                <span className="font-mono text-[11px] text-slate-400">PIN: 1234</span>
              </div>
              <div className="relative">
                <input
                  id="asha-pin-input"
                  type={showPin ? 'text' : 'password'}
                  inputMode="numeric"
                  maxLength={4}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  required
                  placeholder="••••"
                  className="min-h-[46px] w-full rounded-xl border border-slate-700 bg-slate-950 pl-3.5 pr-12 font-mono text-base font-bold tracking-widest text-slate-100 tabular-nums focus:border-teal-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPin((prev) => !prev)}
                  aria-label={showPin ? 'Hide PIN' : 'Show PIN'}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  {showPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-teal-500 whitespace-nowrap cursor-pointer"
            >
              <Lock className="h-4 w-4" />
              <span>Login to ASHA Field App</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>
        ) : (
          /* District Officer (DMO) Login Form */
          <form onSubmit={handleDmoSubmit} className="mt-5 space-y-4">
            <div>
              <label
                htmlFor="dmo-email-input"
                className="mb-1.5 block text-xs font-semibold text-slate-300"
              >
                Official Government Email / ID
              </label>
              <input
                id="dmo-email-input"
                type="email"
                value={dmoEmail}
                onChange={(e) => setDmoEmail(e.target.value)}
                required
                className="min-h-[46px] w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 text-sm font-semibold text-slate-100 focus:border-teal-500 focus:outline-none"
              />
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label
                  htmlFor="dmo-code-input"
                  className="text-xs font-semibold text-slate-300"
                >
                  Command Access Code
                </label>
                <span className="font-mono text-[11px] text-slate-400">Default: DMO-24</span>
              </div>
              <input
                id="dmo-code-input"
                type="password"
                value={dmoPasscode}
                onChange={(e) => setDmoPasscode(e.target.value)}
                required
                className="min-h-[46px] w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 font-mono text-sm font-semibold text-slate-100 focus:border-teal-500 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-teal-500 whitespace-nowrap cursor-pointer"
            >
              <Lock className="h-4 w-4" />
              <span>Access District Command Dashboard</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
