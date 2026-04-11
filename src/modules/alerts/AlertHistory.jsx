import React from 'react';
import { useAlerts } from '../../contexts/AlertContext';
import { Bell, AlertTriangle, CheckCircle } from 'lucide-react';
import { formatDistanceToNow } from '../../utils/formatters';

export default function AlertHistory() {
  const { alerts, loading } = useAlerts();

  if (loading) return <div className="p-8 text-center text-neutral-500">Loading alerts...</div>;

  return (
    <div className="min-h-screen bg-neutral-50 pb-20">
      <div className="bg-forest-600 text-white p-6 sticky top-0 z-10 shadow-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Bell size={24} />
            <h1 className="text-2xl font-bold">Alerts</h1>
          </div>
          <a href="/alerts/settings" className="text-sm underline opacity-80">Settings</a>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {alerts.length === 0 ? (
          <div className="text-center py-10 bg-white rounded-xl border border-neutral-200 shadow-sm">
            <Bell className="mx-auto text-neutral-300 mb-3" size={40} />
            <p className="text-neutral-500">No recent alerts in your area.</p>
          </div>
        ) : (
          alerts.map(alert => (
            <div
              key={alert.id}
              className={`p-4 rounded-xl shadow-sm border ${
                alert.type === 'warning' ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'
              }`}
            >
              <div className="flex items-start gap-3">
                {alert.type === 'warning' ? (
                  <AlertTriangle className="text-alert-red shrink-0" />
                ) : (
                  <CheckCircle className="text-alert-green shrink-0" />
                )}
                <div>
                  <h3 className={`font-bold text-sm ${alert.type === 'warning' ? 'text-alert-red' : 'text-alert-green'}`}>
                    {alert.type === 'warning' ? 'ELEPHANT WARNING' : 'ALL CLEAR'}
                  </h3>
                  <p className="text-xs text-neutral-500 mb-1">{formatDistanceToNow(alert.sentAt)}</p>

                  {alert.message && (
                    <p className="text-sm font-medium text-neutral-800 mt-2">{alert.message}</p>
                  )}

                  {alert.affectedVillages?.length > 0 && (
                    <div className="mt-2 text-xs text-neutral-600 bg-white/50 p-2 rounded">
                      <strong>Affected areas:</strong> {alert.affectedVillages.join(', ')}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
