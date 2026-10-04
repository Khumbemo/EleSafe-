import React, { useState, useEffect } from 'react';
import { MapContainer, Marker, useMap, Circle, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import MapLayers from './MapLayers';
import IncidentPopup from './IncidentPopup';
import { db } from '../../firebase';
import { collection, query, where, onSnapshot, orderBy, limit } from 'firebase/firestore';
import { useGeolocation } from '../../hooks/useGeolocation';
import { severityConfig, incidentTypeConfig } from '../../utils/severity';
import { wokhaVillages } from '../../utils/constants';

// Fix Leaflet default icon path issues
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const WOKHA_CENTER = [26.1040, 94.2601];
const DEFAULT_ZOOM = 11;

// Custom hook to re-center map when GPS coords update
function MapUpdater({ coords }) {
  const map = useMap();
  useEffect(() => {
    if (coords && coords.lat && coords.lng) {
      // map.flyTo([coords.lat, coords.lng], 13);
    }
  }, [coords, map]);
  return null;
}

export default function IncidentMap() {
  const [incidents, setIncidents] = useState([]);
  const [showVillages, setShowVillages] = useState(false);
  const { coords: userCoords } = useGeolocation();

  useEffect(() => {
    const q = query(
      collection(db, 'incidents'),
      where('status', 'in', ['reported', 'verified', 'responded']),
      orderBy('createdAt', 'desc'),
      limit(100)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setIncidents(data);
    });

    return () => unsubscribe();
  }, []);

  const createCustomIcon = (severity, type) => {
    const color = severityConfig[severity]?.mapColor || '#ca8a04';
    const iconStr = incidentTypeConfig[type]?.icon || '🐘';

    return L.divIcon({
      className: 'custom-incident-marker',
      html: `<div style="
        background-color: ${color};
        width: 32px;
        height: 32px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 2px solid white;
        box-shadow: 0 2px 5px rgba(0,0,0,0.3);
        font-size: 16px;
      ">${iconStr}</div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
      popupAnchor: [0, -16]
    });
  };

  const villageIcon = L.divIcon({
    className: 'village-marker',
    html: `<div style="
      background-color: #8b5e3c;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      border: 2px solid white;
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    "></div>`,
    iconSize: [12, 12],
  });

  return (
    <div className="relative w-full h-[calc(100vh-60px)] pb-16">
      <div className="absolute top-4 left-4 z-[1000] bg-white rounded-lg shadow-md p-2 flex items-center gap-2">
        <label className="flex items-center gap-2 text-sm font-medium text-neutral-700 cursor-pointer">
          <input
            type="checkbox"
            checked={showVillages}
            onChange={(e) => setShowVillages(e.target.checked)}
            className="w-4 h-4 text-forest-600 rounded border-neutral-300 focus:ring-forest-500"
          />
          Show Villages
        </label>
      </div>

      <MapContainer
        center={WOKHA_CENTER}
        zoom={DEFAULT_ZOOM}
        className="w-full h-full z-0"
        zoomControl={false}
      >
        <MapLayers />
        <MapUpdater coords={userCoords} />

        {/* User Location */}
        {userCoords && (
          <Circle
            center={[userCoords.lat, userCoords.lng]}
            radius={userCoords.accuracy || 100}
            pathOptions={{ fillColor: '#3b82f6', color: '#3b82f6', weight: 1, fillOpacity: 0.2 }}
          />
        )}
        {userCoords && (
          <Marker
            position={[userCoords.lat, userCoords.lng]}
            icon={L.divIcon({
              className: 'user-marker',
              html: `<div style="background-color: #3b82f6; width: 16px; height: 16px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 5px rgba(0,0,0,0.5);"></div>`,
              iconSize: [16, 16]
            })}
          />
        )}

        {/* Villages */}
        {showVillages && wokhaVillages.map((village, idx) => (
          <Marker
            key={`v_${idx}`}
            position={[village.coordinates.lat, village.coordinates.lng]}
            icon={villageIcon}
          >
            <Tooltip direction="top" offset={[0, -10]} opacity={0.9}>
              {village.name} {village.forestFringe ? '(Fringe)' : ''}
            </Tooltip>
          </Marker>
        ))}

        {/* Incidents */}
        {incidents.map((incident) => (
          <Marker
            key={incident.id}
            position={[incident.coordinates.lat, incident.coordinates.lng]}
            icon={createCustomIcon(incident.severity, incident.type)}
          >
            <IncidentPopup incident={incident} />
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
