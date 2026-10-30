import React from 'react';
import {AlertTriangle, RefreshCw, ShieldCheck} from 'lucide-react';

interface GlobalErrorBoundaryProps {
  children: React.ReactNode;
}

interface GlobalErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

const TRANSIENT_SESSION_KEYS = [
  'healthsync_active_session_v1',
  'healthsync_active_auth_token',
];

/**
 * Purges only corrupted JSON entries in browser storage while preserving valid
 * AES-256-GCM encrypted offline patient vaults.
 */
export function sanitizeBrowserStorageForRecovery(): void {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      for (const key of TRANSIENT_SESSION_KEYS) {
        try {
          window.sessionStorage.removeItem(key);
        } catch {
          // Ignore sandboxed storage restriction
        }
      }
    }
  } catch {
    // Ignore sessionStorage access errors
  }

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const keysToRemove: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (!key || !key.startsWith('healthsync_')) continue;
        const raw = window.localStorage.getItem(key);
        if (!raw) continue;
        try {
          JSON.parse(raw);
        } catch {
          // Corrupt JSON detected — mark strictly corrupted entry for cleanup
          keysToRemove.push(key);
        }
      }
      for (const corruptKey of keysToRemove) {
        try {
          window.localStorage.removeItem(corruptKey);
        } catch {
          // Ignore storage removal errors
        }
      }
    }
  } catch {
    // Ignore localStorage access errors
  }
}

export class GlobalErrorBoundary extends React.Component<
  GlobalErrorBoundaryProps,
  GlobalErrorBoundaryState
> {
  public state: GlobalErrorBoundaryState = {
    hasError: false,
    errorMessage: '',
  };

  public static getDerivedStateFromError(error: Error): GlobalErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'An unexpected interface error occurred.',
    };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.warn(
      '[SwasthyaSetu ErrorBoundary] Caught unexpected component exception:',
      error?.message || error,
      errorInfo?.componentStack || ''
    );
  }

  private handleResetAndReload = (): void => {
    sanitizeBrowserStorageForRecovery();
    this.setState({hasError: false, errorMessage: ''});
    if (typeof window !== 'undefined' && window.location) {
      window.location.reload();
    }
  };

  private handleSoftRecover = (): void => {
    this.setState({hasError: false, errorMessage: ''});
  };

  public render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div
        role="alert"
        className="min-h-screen bg-slate-50 text-slate-900 flex flex-col items-center justify-center p-4 sm:p-6"
      >
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-50 border border-amber-200 text-amber-700">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-slate-900">
                SwasthyaSetu Safe Recovery
              </h1>
              <p className="text-xs font-medium text-slate-500">
                Offline Triage &amp; Command Resilience Guard
              </p>
            </div>
          </div>

          <p className="mt-4 text-sm leading-relaxed text-slate-700">
            A screen component encountered an unexpected state. Your encrypted offline patient
            records remain safely protected on this device.
          </p>

          {this.state.errorMessage && (
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs font-mono text-slate-600 break-words">
              {this.state.errorMessage}
            </div>
          )}

          <div className="mt-5 space-y-2.5">
            <button
              type="button"
              onClick={this.handleResetAndReload}
              className="w-full min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 py-3 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-teal-800 cursor-pointer"
            >
              <RefreshCw className="h-4 w-4 shrink-0" />
              <span>🔄 Reset &amp; Reload App</span>
            </button>

            <button
              type="button"
              onClick={this.handleSoftRecover}
              className="w-full min-h-[44px] inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 cursor-pointer"
            >
              Try Continuing Without Reload
            </button>
          </div>

          <div className="mt-5 flex items-center gap-2 border-t border-slate-100 pt-4 text-xs text-slate-500">
            <ShieldCheck className="h-4 w-4 shrink-0 text-teal-700" />
            <span>AES-256-GCM local vault &amp; unsynced field checkups are preserved.</span>
          </div>
        </div>
      </div>
    );
  }
}
