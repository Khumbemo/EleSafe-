import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '../../firebase';
import { doc, getDoc } from 'firebase/firestore';
import { severityConfig, incidentTypeConfig } from '../../utils/severity';
import { useAuth } from '../../contexts/AuthContext';
import StatusUpdate from './StatusUpdate';
import { MapPin, Phone, User, Calendar, Image as ImageIcon, PlayCircle } from 'lucide-react';

export default function IncidentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { userData } = useAuth();

  const [incident, setIncident] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchIncident = async () => {
      try {
        const docRef = doc(db, 'incidents', id);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setIncident({ id: docSnap.id, ...docSnap.data() });
        } else {
          setError('Incident not found');
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchIncident();
  }, [id]);

  if (loading) return <div className="p-8 text-center">Loading details...</div>;
  if (error) return <div className="p-8 text-center text-alert-red">{error}</div>;
  if (!incident) return null;

  const typeInfo = incidentTypeConfig[incident.type] || { label: incident.type, icon: '📄' };
  const sevInfo = severityConfig[incident.severity] || severityConfig.low;
  const isStaff = userData?.role === 'guard' || userData?.role === 'officer' || userData?.role === 'admin';

  return (
    <div className="min-h-screen bg-neutral-50 pb-20">
      <div className={`${sevInfo.color} text-white p-4 sticky top-0 z-10 shadow-md flex justify-between items-center`}>
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-1">&larr;</button>
          <h1 className="text-xl font-bold">{typeInfo.label}</h1>
        </div>
        <span className="bg-white/20 px-2 py-1 rounded text-sm font-bold">{sevInfo.label}</span>
      </div>

      <div className="p-4 space-y-4 max-w-lg mx-auto">

        {/* Status Box */}
        <div className="bg-white p-4 rounded-xl shadow-sm border border-neutral-200">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium text-neutral-500">Current Status</span>
            <span className="px-2 py-1 bg-neutral-100 rounded text-xs font-bold uppercase border border-neutral-200">
              {incident.status.replace('_', ' ')}
            </span>
          </div>
          {incident.staffNotes && (
            <div className="mt-2 text-sm bg-yellow-50 p-3 rounded border border-yellow-100 text-yellow-800">
              <strong>Staff Note:</strong> {incident.staffNotes}
            </div>
          )}
        </div>

        {/* Details Box */}
        <div className="bg-white p-4 rounded-xl shadow-sm border border-neutral-200 space-y-4">
          <div className="flex items-start gap-3">
            <Calendar className="text-neutral-400 shrink-0" size={20} />
            <div>
              <p className="text-xs text-neutral-500">Reported At</p>
              <p className="text-sm font-medium">{incident.createdAt?.toDate ? incident.createdAt.toDate().toLocaleString() : new Date(incident.createdAt).toLocaleString()}</p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <MapPin className="text-neutral-400 shrink-0" size={20} />
            <div>
              <p className="text-xs text-neutral-500">Location</p>
              <p className="text-sm font-medium">{incident.reporterVillage}</p>
              <p className="text-xs text-neutral-600 mt-1">{incident.locationDescription}</p>
              {incident.coordinates && (
                <p className="text-xs font-mono text-blue-600 mt-1">
                  {incident.coordinates.lat.toFixed(4)}, {incident.coordinates.lng.toFixed(4)}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 border-t border-neutral-100 pt-4 mt-4">
            <div>
              <p className="text-xs text-neutral-500">Herd Size</p>
              <p className="text-sm font-medium">{incident.herdSize} elephants</p>
            </div>
            <div>
              <p className="text-xs text-neutral-500">Direction</p>
              <p className="text-sm font-medium">{incident.movementDirection}</p>
            </div>
            {(incident.humanCasualties > 0 || incident.cropDamageAcres > 0 || incident.propertyDamageINR > 0) && (
              <div className="col-span-2 space-y-1">
                <p className="text-xs font-bold text-alert-red uppercase">Reported Damages</p>
                {incident.humanCasualties > 0 && <p className="text-sm text-alert-red">Casualties: {incident.humanCasualties}</p>}
                {incident.cropDamageAcres > 0 && <p className="text-sm text-alert-orange">Crop: {incident.cropDamageAcres} acres</p>}
                {incident.propertyDamageINR > 0 && <p className="text-sm text-alert-orange">Property: ₹{incident.propertyDamageINR}</p>}
              </div>
            )}
          </div>
        </div>

        {/* Reporter Info (Visible to staff mostly, or just basic name to others) */}
        <div className="bg-white p-4 rounded-xl shadow-sm border border-neutral-200">
           <h3 className="font-semibold text-neutral-900 mb-3 border-b pb-2">Reporter Information</h3>
           <div className="space-y-2">
             <div className="flex items-center gap-2 text-sm">
               <User size={16} className="text-neutral-500" />
               <span>{incident.reporterName}</span>
             </div>
             {isStaff && incident.reporterPhone && (
               <div className="flex items-center gap-2 text-sm">
                 <Phone size={16} className="text-neutral-500" />
                 <a href={`tel:${incident.reporterPhone}`} className="text-forest-600 hover:underline">{incident.reporterPhone}</a>
               </div>
             )}
           </div>
        </div>

        {/* Media */}
        {(incident.photoUrls?.length > 0 || incident.voiceNoteUrl) && (
          <div className="bg-white p-4 rounded-xl shadow-sm border border-neutral-200">
             <h3 className="font-semibold text-neutral-900 mb-3 border-b pb-2">Evidence</h3>

             {incident.photoUrls?.length > 0 && (
               <div className="mb-4">
                 <div className="flex items-center gap-2 text-sm text-neutral-600 mb-2">
                   <ImageIcon size={16} /> Photos
                 </div>
                 <div className="flex gap-2 overflow-x-auto pb-2">
                   {incident.photoUrls.map((url, i) => (
                     <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                       <img src={url} alt={`Evidence ${i+1}`} className="w-24 h-24 object-cover rounded border" />
                     </a>
                   ))}
                 </div>
               </div>
             )}

             {incident.voiceNoteUrl && (
               <div>
                 <div className="flex items-center gap-2 text-sm text-neutral-600 mb-2">
                   <PlayCircle size={16} /> Voice Note
                 </div>
                 <audio controls src={incident.voiceNoteUrl} className="w-full h-10" />
               </div>
             )}
          </div>
        )}

        {/* Staff Actions */}
        {isStaff && (
          <div className="mt-8">
            <StatusUpdate incident={incident} onUpdate={(updatedData) => setIncident({...incident, ...updatedData})} />
          </div>
        )}

      </div>
    </div>
  );
}
