import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useGeolocation } from '../../hooks/useGeolocation';
import { useOfflineQueue } from '../../hooks/useOfflineQueue';
import { incidentTypeConfig, classifySeverity } from '../../utils/severity';
import * as Icons from 'lucide-react';

export default function QuickReport() {
  const [step, setStep] = useState(1);
  const [selectedType, setSelectedType] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { userData } = useAuth();
  const { coords, error, loading } = useGeolocation();
  const { enqueue } = useOfflineQueue();
  const navigate = useNavigate();

  const handleTypeSelect = (type) => {
    setSelectedType(type);
    setStep(2);
  };

  const handleSubmit = async () => {
    if (!selectedType || !coords) return;

    setIsSubmitting(true);

    const severity = classifySeverity(selectedType, 1, 0); // Default values for quick report

    const incidentPayload = {
      reportedBy: userData?.uid || 'anonymous',
      reporterName: userData?.name || 'Unknown',
      reporterPhone: userData?.phone || '',
      reporterVillage: userData?.village || 'Unknown',
      type: selectedType,
      severity,
      coordinates: coords,
      locationDescription: '',
      herdSize: 1,
      movementDirection: 'unknown',
      photoUrls: [],
      voiceNoteUrl: null,
      description: 'Emergency quick report',
      status: 'reported',
      assignedTo: null,
      staffNotes: '',
      cropDamageAcres: null,
      propertyDamageINR: null,
      humanCasualties: 0,
      createdAt: new Date(), // Local timestamp, will be converted to server timestamp in hook
      updatedAt: new Date(),
      resolvedAt: null,
      synced: false
    };

    await enqueue('incident', incidentPayload);
    setIsSubmitting(false);
    navigate('/', { state: { message: 'Emergency report submitted. Authorities have been alerted.' } });
  };

  if (step === 1) {
    return (
      <div className="min-h-screen bg-neutral-50 p-4">
        <div className="max-w-md mx-auto">
          <h2 className="text-2xl font-bold text-alert-red mb-6 text-center">Emergency Report</h2>
          <p className="text-center mb-8 text-neutral-600">What is happening right now?</p>

          <div className="grid grid-cols-2 gap-4">
            {Object.entries(incidentTypeConfig).map(([key, config]) => (
              <button
                key={key}
                onClick={() => handleTypeSelect(key)}
                className="flex flex-col items-center justify-center p-6 bg-white rounded-xl shadow-sm border border-neutral-200 hover:border-alert-red active:bg-red-50 min-h-[120px]"
              >
                <span className="text-4xl mb-2">{config.icon}</span>
                <span className="font-bold text-center text-sm">{config.label}</span>
                <span className="text-xs text-neutral-500 mt-1">{config.nagamese}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50 p-4 flex flex-col justify-center">
      <div className="max-w-md w-full mx-auto bg-white rounded-xl shadow-lg p-6 text-center">
        <h2 className="text-2xl font-bold mb-4">Confirm Location</h2>

        {loading ? (
          <p className="text-neutral-600 mb-6 py-4">Getting your exact location...</p>
        ) : error ? (
          <p className="text-alert-red mb-6 py-4">Error: {error}. Using nearest village.</p>
        ) : (
          <div className="bg-forest-50 text-forest-700 p-4 rounded-lg mb-6">
            <Icons.MapPin className="w-8 h-8 mx-auto mb-2" />
            <p className="font-mono text-sm">Lat: {coords?.lat.toFixed(4)}</p>
            <p className="font-mono text-sm">Lng: {coords?.lng.toFixed(4)}</p>
            <p className="text-xs mt-2 opacity-70">Accuracy: ±{Math.round(coords?.accuracy || 0)}m</p>
          </div>
        )}

        <div className="flex flex-col gap-3">
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || loading}
            className={`w-full py-4 bg-alert-red text-white font-bold text-xl rounded-lg min-h-[56px] shadow-md ${(isSubmitting || loading) ? 'opacity-50' : ''}`}
          >
            {isSubmitting ? 'SENDING...' : 'SEND EMERGENCY ALERT'}
          </button>

          <button
            onClick={() => setStep(1)}
            disabled={isSubmitting}
            className="w-full py-3 bg-neutral-200 text-neutral-800 font-medium rounded-lg min-h-[48px]"
          >
            Cancel / Go Back
          </button>
        </div>
      </div>
    </div>
  );
}
