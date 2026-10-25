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
        className={`inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
          compact ? 'min-h-[44px] px-3 text-xs' : 'min-h-[40px] px-3.5 py-2 text-xs'
        }`}
        title="Install Offline Field PWA"
      >
        <Download className="w-3.5 h-3.5 text-[#0F766E] shrink-0" />
        <span>{isIOS ? 'Install on iOS' : compact ? 'Install' : 'Install PWA'}</span>
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-install-title"
        >
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl border border-slate-200">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-teal-50 text-[#0F766E] flex items-center justify-center shrink-0">
                  <Smartphone className="w-5 h-5" />
                </div>
                <h3 id="pwa-install-title" className="text-base font-bold text-slate-900">
                  Install Offline Field App
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="min-h-[44px] min-w-[44px] -m-2 flex items-center justify-center text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
                aria-label="Close install instructions"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-4 space-y-2.5 text-sm text-slate-600 leading-relaxed">
              {isIOS ? (
                <>
                  <p>1. Tap the <strong>Share</strong> icon in your Safari toolbar.</p>
                  <p>2. Scroll down and tap <strong>Add to Home Screen</strong> to cache SwasthyaSetu for offline village visits.</p>
                </>
              ) : (
                <>
                  <p>SwasthyaSetu is configured with offline service-worker caching for zero-network sub-centers.</p>
                  <p>Open the app in a top-level browser tab and click the address-bar <strong>Install App</strong> icon (or browser menu → <strong>Install SwasthyaSetu</strong>).</p>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="mt-5 w-full min-h-[48px] rounded-xl bg-[#0F766E] text-white text-sm font-semibold hover:bg-teal-800 transition-colors cursor-pointer"
            >
              Got It
            </button>
          </div>
        </div>
      )}
    </>
  );
};
