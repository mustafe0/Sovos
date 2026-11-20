import React from 'react';
import { useOnlineStatus } from '../hooks/usePWAInstall';
import { WifiOff } from 'lucide-react';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-16 sm:bottom-4 left-4 right-4 sm:right-auto z-50 flex items-center justify-between sm:justify-start gap-2.5 rounded-2xl bg-amber-500/95 backdrop-blur-md px-4 py-2.5 text-xs font-bold text-slate-950 shadow-2xl border border-amber-400/80 animate-in slide-in-from-bottom"
    >
      <div className="flex items-center gap-2">
        <WifiOff className="w-4 h-4 text-slate-950 animate-pulse shrink-0" />
        <span>Khad la'aan (Offline) — App-ku wuxuu ku shaqaynayaa qasnadda offline-ka.</span>
      </div>
    </div>
  );
};
