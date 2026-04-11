import React from 'react';
import { useOffline } from '../contexts/OfflineContext';
import { Wifi, WifiOff } from 'lucide-react';

export default function SyncStatusBadge() {
  const { isOnline } = useOffline();

  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
      isOnline
        ? 'bg-green-100 text-green-700 border border-green-200'
        : 'bg-orange-100 text-orange-700 border border-orange-200'
    }`}>
      {isOnline ? (
        <>
          <Wifi size={12} />
          <span>Online</span>
        </>
      ) : (
        <>
          <WifiOff size={12} />
          <span>Offline</span>
        </>
      )}
    </div>
  );
}
