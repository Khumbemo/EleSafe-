import React from 'react';
import { useAlerts } from '../../contexts/AlertContext';
import { AlertTriangle, Info, BellRing } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from '../../utils/formatters';

export default function AlertBanner() {
  const { alerts } = useAlerts();
  const navigate = useNavigate();

  // Find the most recent warning alert within the last 24 hours
  const activeAlert = alerts.find(a => {
    if (a.type !== 'warning') return false;
    const alertTime = a.sentAt?.toDate ? a.sentAt.toDate() : new Date(a.sentAt);
    const now = new Date();
    return (now - alertTime) < 24 * 60 * 60 * 1000;
  });

  if (!activeAlert) return null;

  return (
    <div
      onClick={() => navigate('/alerts')}
      className="bg-alert-red text-white p-3 shadow-md flex items-start gap-3 cursor-pointer animate-pulse"
    >
      <BellRing className="shrink-0 mt-0.5" />
      <div className="flex-1">
        <h4 className="font-bold text-sm uppercase">Active Warning</h4>
        <p className="text-xs opacity-90 leading-tight">Alert in your area! Tap for details.</p>
        <p className="text-[10px] opacity-75 mt-1">{formatDistanceToNow(activeAlert.sentAt)}</p>
      </div>
    </div>
  );
}
