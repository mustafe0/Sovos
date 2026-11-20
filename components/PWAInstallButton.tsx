import React, { useState } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { DownloadCloud, Share2, PlusSquare, X, CheckCircle2 } from 'lucide-react';

interface PWAInstallButtonProps {
  className?: string;
  variant?: 'header' | 'banner' | 'compact';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  className = '',
  variant = 'header',
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  // If already installed and running standalone, do not render
  if (isInstalled) {
    return null;
  }

  // Chromium / Android / Desktop flow
  if (isInstallable) {
    if (variant === 'compact') {
      return (
        <button
          onClick={install}
          className={`flex items-center justify-center p-2 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30 transition-all active:scale-95 ${className}`}
          title="Ku rakib App-ka (Install PWA)"
          aria-label="Install App"
        >
          <DownloadCloud className="w-4 h-4 stroke-[2.5]" />
        </button>
      );
    }

    return (
      <button
        onClick={install}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 text-xs font-extrabold shadow-md shadow-emerald-500/20 active:scale-95 transition-all duration-200 ${className}`}
        title="Ku rakib App-ka taleefankaaga (Install App)"
      >
        <DownloadCloud className="w-3.5 h-3.5 stroke-[2.5]" />
        <span>Ku shub App-ka</span>
      </button>
    );
  }

  // iOS Safari flow
  if (isIOS) {
    return (
      <>
        {variant === 'compact' ? (
          <button
            onClick={() => setShowIOSGuide(true)}
            className={`flex items-center justify-center p-2 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30 transition-all active:scale-95 ${className}`}
            title="Sida loogu rakibo iPhone (Install on iOS)"
            aria-label="Install on iPhone"
          >
            <DownloadCloud className="w-4 h-4 stroke-[2.5]" />
          </button>
        ) : (
          <button
            onClick={() => setShowIOSGuide(true)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-emerald-400 border border-emerald-500/30 text-xs font-bold transition-all active:scale-95 ${className}`}
            title="Sida loogu rakibo iPhone (Install on iOS)"
          >
            <DownloadCloud className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Ku shub iPhone</span>
            <span className="sm:hidden">Ku shub</span>
          </button>
        )}

        {showIOSGuide && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in"
            onClick={() => setShowIOSGuide(false)}
          >
            <div
              className="w-full max-w-sm rounded-3xl bg-[#0B1220] border border-slate-800 p-6 shadow-2xl relative text-left"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => setShowIOSGuide(false)}
                className="absolute top-4 right-4 p-1.5 rounded-full text-slate-400 hover:text-white bg-slate-900 border border-slate-800"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>

              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-400 shadow-inner">
                  <DownloadCloud className="w-6 h-6 stroke-[2.5]" />
                </div>
                <div>
                  <h3 className="text-base font-display font-black text-white">Ku shub iPhone / iPad</h3>
                  <p className="text-xs text-slate-400">Ku dar shaashadda guriga (Home Screen)</p>
                </div>
              </div>

              <div className="space-y-3 my-5 text-xs text-slate-300">
                <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-900/90 border border-slate-800/80">
                  <div className="w-6 h-6 rounded-lg bg-emerald-500/20 text-emerald-400 font-bold flex items-center justify-center shrink-0">
                    1
                  </div>
                  <div>
                    Safari-ga hoose ku dhufo batoonka <strong className="text-white">Share</strong> (wuxuu u egyahay sanduuq fallaadh kor kaga baxayso <Share2 className="w-3.5 h-3.5 inline text-sky-400 mx-0.5" />).
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-900/90 border border-slate-800/80">
                  <div className="w-6 h-6 rounded-lg bg-emerald-500/20 text-emerald-400 font-bold flex items-center justify-center shrink-0">
                    2
                  </div>
                  <div>
                    Hoos u rog liiska, kaddibna dooro <strong className="text-emerald-400">Add to Home Screen</strong> (<PlusSquare className="w-3.5 h-3.5 inline text-emerald-400 mx-0.5" />).
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-900/90 border border-slate-800/80">
                  <div className="w-6 h-6 rounded-lg bg-emerald-500/20 text-emerald-400 font-bold flex items-center justify-center shrink-0">
                    3
                  </div>
                  <div>
                    Kaddibna dhufo <strong className="text-white">Add</strong> xagga kore midig. App-ku wuxuu ka soo muuqan doonaa taleefankaaga sida App dhab ah!
                  </div>
                </div>
              </div>

              <button
                onClick={() => setShowIOSGuide(false)}
                className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold shadow-lg shadow-emerald-500/20 transition-colors"
              >
                Fahmay (Done)
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
