import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Home, Map as MapIcon, ClipboardList, Bell, User, LayoutDashboard } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function BottomNav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { userData } = useAuth();

  const isStaff = userData?.role === 'guard' || userData?.role === 'officer' || userData?.role === 'admin';
  const isOfficer = userData?.role === 'officer' || userData?.role === 'admin';

  const navItems = [
    { label: 'Home', icon: Home, path: '/' },
    { label: 'Map', icon: MapIcon, path: '/map' },
    isStaff && { label: 'Reports', icon: ClipboardList, path: '/incidents' },
    isOfficer && { label: 'Dash', icon: LayoutDashboard, path: '/dashboard' },
    { label: 'Alerts', icon: Bell, path: '/alerts' },
    { label: 'Guide', icon: User, path: '/guide' } // Mapping Guide to User/Profile slot for MVP
  ].filter(Boolean);

  // Hide nav on specific screens
  if (['/login', '/verify-otp', '/register', '/report/quick', '/report/full'].includes(pathname)) {
    return null;
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-neutral-200 pb-safe z-50 max-w-md mx-auto">
      <div className="flex justify-around items-center h-[60px] px-2 relative">
        {navItems.map((item, idx) => {
          const isActive = pathname === item.path || (pathname.startsWith(item.path) && item.path !== '/');

          return (
            <button
              key={idx}
              onClick={() => navigate(item.path)}
              className={`flex flex-col items-center justify-center w-full h-full space-y-1 ${
                isActive ? 'text-forest-600' : 'text-neutral-500'
              }`}
            >
              <item.icon size={24} className={isActive ? 'stroke-[2.5px]' : ''} />
              <span className="text-[10px] font-medium">{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
