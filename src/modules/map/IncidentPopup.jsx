import React from 'react';
import { Popup } from 'react-leaflet';
import { severityConfig, incidentTypeConfig } from '../../utils/severity';
import { formatDistanceToNow } from '../../utils/formatters';

export default function IncidentPopup({ incident }) {
  const sevConfig = severityConfig[incident.severity] || severityConfig.low;
  const typeConfig = incidentTypeConfig[incident.type] || { label: incident.type, icon: '📍' };

  return (
    <Popup className="incident-popup">
      <div className="w-48">
        <div className="flex items-center gap-2 mb-2 border-b pb-2">
          <span className="text-xl">{typeConfig.icon}</span>
          <div>
            <h4 className="font-bold text-sm leading-tight text-neutral-900">{typeConfig.label}</h4>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-sm text-white ${sevConfig.color}`}>
              {sevConfig.label}
            </span>
          </div>
        </div>

        <div className="text-xs text-neutral-700 space-y-1 mb-2">
          <p><strong>Village:</strong> {incident.reporterVillage}</p>
          <p><strong>Time:</strong> {formatDistanceToNow(incident.createdAt)}</p>
          {incident.herdSize > 0 && <p><strong>Herd:</strong> ~{incident.herdSize} elephants</p>}
        </div>

        {incident.photoUrls?.length > 0 && (
          <div className="mt-2 flex gap-1 overflow-hidden h-16 rounded">
            {incident.photoUrls.slice(0, 2).map((url, i) => (
              <img key={i} src={url} alt="Evidence" className="w-1/2 object-cover" />
            ))}
            {incident.photoUrls.length > 2 && (
              <div className="w-1/2 bg-neutral-200 flex items-center justify-center text-xs font-bold text-neutral-600">
                +{incident.photoUrls.length - 2}
              </div>
            )}
          </div>
        )}

        <div className="mt-3 text-center">
          <a href={`/incident/${incident.id}`} className="text-forest-600 text-xs font-bold hover:underline block py-1 border border-forest-200 rounded">
            View Full Details
          </a>
        </div>
      </div>
    </Popup>
  );
}
