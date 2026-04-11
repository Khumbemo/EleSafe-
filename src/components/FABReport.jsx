import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

export default function FABReport() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // Hide on auth screens and report screens
  if (['/login', '/verify-otp', '/register', '/report/quick', '/report/full'].includes(pathname)) {
    return null;
  }

  return (
    <div className="fixed bottom-[80px] left-0 right-0 z-50 mb-safe max-w-md mx-auto relative pointer-events-none">
      <div className="absolute right-4 bottom-0 flex flex-col gap-3 items-end pointer-events-auto">
      <button
        onClick={() => navigate('/report/full')}
        className="bg-white text-forest-600 w-12 h-12 rounded-full shadow-lg border-2 border-forest-600 flex items-center justify-center font-bold"
        aria-label="Detailed Report"
      >
        📝
      </button>
      <button
        onClick={() => navigate('/report/quick')}
        className="bg-alert-red text-white h-16 px-6 rounded-full shadow-lg shadow-red-500/30 flex items-center justify-center gap-2 active:scale-95 transition-transform"
      >
        <span className="text-2xl">🐘</span>
        <span className="font-bold tracking-wide">REPORT</span>
      </button>
      </div>
    </div>
  );
}
