import React, {useState} from 'react';
import {Download, X, Smartphone} from 'lucide-react';
import {usePWAInstall} from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  compact?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({compact = false}) => {
  const {isInstallable, isInstalled, isIOS, install} = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      await install();
    } else {
      setShowGuide(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={`inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-[#0D1322] font-mono font-semibold text-slate-200 hover:bg-slate-800 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
          compact ? 'h-9 px-3 text-xs' : 'h-9 px-3.5 text-xs'
        }`}
        title="Install Offline Field OS PWA"
      >
        <Download className="w-3.5 h-3.5 text-[#06B6D4] shrink-0" />
        <span>{isIOS ? 'Install iOS' : compact ? 'Install OS' : 'Install Field OS'}</span>
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-install-title"
        >
          <div className="w-full max-w-sm rounded-xl bg-[#090D16] p-6 shadow-2xl border border-slate-800 text-slate-100">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-[#06B6D4]/15 border border-[#06B6D4]/50 text-[#06B6D4] flex items-center justify-center shrink-0">
                  <Smartphone className="w-4 h-4" />
                </div>
                <h3 id="pwa-install-title" className="text-sm font-semibold text-white">
                  Install HealthSync OS Offline
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="min-h-[38px] min-w-[38px] flex items-center justify-center text-slate-400 hover:text-white rounded-lg cursor-pointer"
                aria-label="Close install instructions"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-4 space-y-2.5 text-xs text-slate-300 leading-relaxed">
              {isIOS ? (
                <>
                  <p>1. Tap the <strong>Share</strong> icon in Safari.</p>
                  <p>
                    2. Select <strong>Add to Home Screen</strong> to cache HealthSync OS v3.2 for
                    zero-network field deployments.
                  </p>
                </>
              ) : (
                <>
                  <p>
                    Service Worker precaching &amp; IndexedDB vaults are active for zero-network
                    rural operations.
                  </p>
                  <p>
                    Open in a standalone browser tab and click the address-bar{' '}
                    <strong>Install App</strong> icon to mount locally.
                  </p>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="mt-5 w-full min-h-[44px] rounded-lg bg-[#06B6D4] hover:bg-cyan-400 text-[#090D16] font-mono text-xs font-bold transition-colors cursor-pointer"
            >
              Acknowledge
            </button>
          </div>
        </div>
      )}
    </>
  );
};
