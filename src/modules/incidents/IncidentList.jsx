import React, { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { severityConfig, incidentTypeConfig } from '../../utils/severity';
import { formatDistanceToNow } from '../../utils/formatters';

export default function IncidentList() {
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // all, open, resolved
  const navigate = useNavigate();

  useEffect(() => {
    const q = query(
      collection(db, 'incidents'),
      orderBy('createdAt', 'desc'),
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setIncidents(data);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const filteredIncidents = incidents.filter(i => {
    if (filter === 'open') return ['reported', 'verified'].includes(i.status);
    if (filter === 'resolved') return ['responded', 'closed', 'false_report'].includes(i.status);
    return true;
  });

  const getStatusColor = (status) => {
    switch(status) {
      case 'reported': return 'bg-alert-red text-white';
      case 'verified': return 'bg-alert-orange text-white';
      case 'responded': return 'bg-forest-500 text-white';
      case 'closed': return 'bg-neutral-500 text-white';
      case 'false_report': return 'bg-neutral-200 text-neutral-800';
      default: return 'bg-neutral-200 text-neutral-800';
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50 p-4 pb-20">
      <h1 className="text-2xl font-display font-bold text-neutral-900 mb-4">Incident Reports</h1>

      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        {['all', 'open', 'resolved'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap ${filter === f ? 'bg-forest-600 text-white' : 'bg-neutral-200 text-neutral-700'}`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-center text-neutral-500 py-8">Loading incidents...</p>
      ) : filteredIncidents.length === 0 ? (
        <p className="text-center text-neutral-500 py-8">No incidents found.</p>
      ) : (
        <div className="space-y-3">
          {filteredIncidents.map(incident => {
            const typeInfo = incidentTypeConfig[incident.type] || { label: incident.type, icon: '📄' };
            const sevInfo = severityConfig[incident.severity] || severityConfig.low;

            return (
              <div
                key={incident.id}
                onClick={() => navigate(`/incident/${incident.id}`)}
                className="bg-white rounded-xl shadow-sm border border-neutral-200 p-4 active:bg-neutral-50 cursor-pointer"
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{typeInfo.icon}</span>
                    <div>
                      <h3 className="font-bold text-neutral-900 leading-tight">{typeInfo.label}</h3>
                      <p className="text-xs text-neutral-500">{incident.reporterVillage} • {formatDistanceToNow(incident.createdAt)}</p>
                    </div>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-1 rounded-sm ${sevInfo.color} text-white uppercase`}>
                    {sevInfo.label}
                  </span>
                </div>

                <div className="flex justify-between items-center mt-3 pt-3 border-t border-neutral-100">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${getStatusColor(incident.status)}`}>
                    {incident.status.replace('_', ' ')}
                  </span>
                  {incident.herdSize > 0 && (
                    <span className="text-xs font-medium text-neutral-600 bg-neutral-100 px-2 py-0.5 rounded">
                      🐘 ~{incident.herdSize}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
