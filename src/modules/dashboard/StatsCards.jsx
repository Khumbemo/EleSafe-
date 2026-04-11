import React, { useMemo } from 'react';
import { FileText, Clock, AlertTriangle, MapPin } from 'lucide-react';

export default function StatsCards({ incidents }) {
  const stats = useMemo(() => {
    const total = incidents.length;
    const unresolved = incidents.filter(i => i.status === 'reported' || i.status === 'verified').length;

    // Average response time
    const resolvedIncidents = incidents.filter(i => i.resolvedAt && i.createdAt);
    let avgResponseHours = 0;
    if (resolvedIncidents.length > 0) {
      const totalHours = resolvedIncidents.reduce((acc, i) => {
        const hours = (i.resolvedAt - i.createdAt) / (1000 * 60 * 60);
        return acc + hours;
      }, 0);
      avgResponseHours = totalHours / resolvedIncidents.length;
    }

    // Most affected village
    const villageCounts = incidents.reduce((acc, i) => {
      acc[i.reporterVillage] = (acc[i.reporterVillage] || 0) + 1;
      return acc;
    }, {});

    let topVillage = 'N/A';
    let maxCount = 0;
    Object.entries(villageCounts).forEach(([village, count]) => {
      if (count > maxCount && village !== 'Unknown') {
        maxCount = count;
        topVillage = village;
      }
    });

    return {
      total,
      unresolved,
      avgResponseHours: avgResponseHours.toFixed(1),
      topVillage
    };
  }, [incidents]);

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="bg-white p-4 rounded-xl shadow-sm border border-neutral-200">
        <div className="flex items-center gap-2 text-forest-600 mb-2">
          <FileText size={18} />
          <span className="font-medium text-sm">Total Cases</span>
        </div>
        <p className="text-3xl font-bold text-neutral-900">{stats.total}</p>
      </div>

      <div className="bg-white p-4 rounded-xl shadow-sm border border-neutral-200">
        <div className="flex items-center gap-2 text-alert-red mb-2">
          <AlertTriangle size={18} />
          <span className="font-medium text-sm">Open / Unresolved</span>
        </div>
        <p className="text-3xl font-bold text-neutral-900">{stats.unresolved}</p>
      </div>

      <div className="bg-white p-4 rounded-xl shadow-sm border border-neutral-200">
        <div className="flex items-center gap-2 text-alert-orange mb-2">
          <Clock size={18} className="text-orange-600" />
          <span className="font-medium text-sm">Avg. Response Time</span>
        </div>
        <p className="text-3xl font-bold text-neutral-900">{stats.avgResponseHours} <span className="text-lg text-neutral-500 font-normal">hrs</span></p>
      </div>

      <div className="bg-white p-4 rounded-xl shadow-sm border border-neutral-200">
        <div className="flex items-center gap-2 text-forest-600 mb-2">
          <MapPin size={18} />
          <span className="font-medium text-sm">Top Hotspot</span>
        </div>
        <p className="text-xl font-bold text-neutral-900 truncate" title={stats.topVillage}>{stats.topVillage}</p>
      </div>
    </div>
  );
}
