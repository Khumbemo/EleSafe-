import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import SyncStatusBadge from './SyncStatusBadge';
import { Settings, LogOut } from 'lucide-react';
import { auth } from '../firebase';

export default function NavBar() {
  const { userData } = useAuth();

  const handleLogout = () => {
    auth.signOut();
  };

  return (
    <div className="bg-white border-b border-neutral-200 px-4 py-3 flex items-center justify-between sticky top-0 z-40">
      <div>
        <h1 className="font-display font-bold text-forest-700 text-lg leading-tight">HatiAlert</h1>
        <p className="text-xs text-neutral-500">{userData?.village || 'Nagaland'}</p>
      </div>

      <div className="flex items-center gap-3">
        <SyncStatusBadge />
        <button onClick={handleLogout} className="text-neutral-400 hover:text-neutral-600">
          <LogOut size={20} />
        </button>
      </div>
    </div>
  );
}
