import React, {useState} from 'react';
import {Download, Smartphone, X} from 'lucide-react';
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
        className={`inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white font-semibold text-slate-700 transition-colors hover:border-teal-600/40 hover:bg-slate-50 hover:text-slate-900 whitespace-nowrap shrink-0 cursor-pointer ${
          compact ? 'min-h-[40px] px-3.5 text-xs' : 'min-h-[44px] px-4 text-sm'
        }`}
      >
        <Download className="h-4 w-4 text-teal-700 shrink-0" />
        <span>{isIOS ? 'Install on iPhone' : 'Install App'}</span>
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-install-title"
        >
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-lg">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
                  <Smartphone className="h-5 w-5" />
                </div>
                <h3 id="pwa-install-title" className="text-base font-semibold text-slate-900">
                  Use SwasthyaSetu Offline
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
                aria-label="Close install instructions"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-2.5 text-sm leading-relaxed text-slate-600">
              {isIOS ? (
                <>
                  <p>
                    1. Tap the <strong>Share</strong> icon in Safari.
                  </p>
                  <p>
                    2. Choose <strong>Add to Home Screen</strong> so you can open SwasthyaSetu even
                    without mobile internet.
                  </p>
                </>
              ) : (
                <>
                  <p>
                    SwasthyaSetu saves patient checkups privately on your phone or tablet when
                    internet service is unavailable.
                  </p>
                  <p>
                    Open this page in a browser tab and select the <strong>Install</strong> icon in
                    your address bar to add it to your home screen.
                  </p>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="mt-5 w-full min-h-[44px] rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-800 cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
};
