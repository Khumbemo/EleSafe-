import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useGeolocation } from '../../hooks/useGeolocation';
import { useOfflineQueue } from '../../hooks/useOfflineQueue';
import { incidentTypeConfig, classifySeverity } from '../../utils/severity';
import PhotoCapture from './PhotoCapture';
import VoiceNote from './VoiceNote';
import { MapPin } from 'lucide-react';

export default function FullReportForm() {
  const { userData } = useAuth();
  const { coords, loading: gpsLoading } = useGeolocation();
  const { enqueue } = useOfflineQueue();
  const navigate = useNavigate();

  // Temporary incident ID for file uploads
  const [tempId] = useState(`temp_${Date.now()}`);

  const [formData, setFormData] = useState({
    type: '',
    herdSize: 1,
    movementDirection: 'unknown',
    locationDescription: '',
    humanCasualties: 0,
    cropDamageToggle: false,
    cropDamageAcres: '',
    propertyDamageToggle: false,
    propertyDamageINR: '',
    description: '',
  });

  const [photos, setPhotos] = useState([]);
  const [voiceUrl, setVoiceUrl] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const directions = [
    { label: 'N', val: 'N' }, { label: 'NE', val: 'NE' },
    { label: 'E', val: 'E' }, { label: 'SE', val: 'SE' },
    { label: 'S', val: 'S' }, { label: 'SW', val: 'SW' },
    { label: 'W', val: 'W' }, { label: 'NW', val: 'NW' },
    { label: 'Unknown', val: 'unknown' }
  ];

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.type) {
      alert("Please select an incident type");
      return;
    }

    setIsSubmitting(true);

    const severity = classifySeverity(
      formData.type,
      Number(formData.herdSize),
      Number(formData.humanCasualties)
    );

    const incidentPayload = {
      reportedBy: userData?.uid || 'anonymous',
      reporterName: userData?.name || 'Unknown',
      reporterPhone: userData?.phone || '',
      reporterVillage: userData?.village || 'Unknown',
      type: formData.type,
      severity,
      coordinates: coords || { lat: 0, lng: 0 }, // Should ideally mandate coords, but handle gracefully
      locationDescription: formData.locationDescription,
      herdSize: Number(formData.herdSize),
      movementDirection: formData.movementDirection,
      photoUrls: photos,
      voiceNoteUrl: voiceUrl,
      description: formData.description,
      status: 'reported',
      assignedTo: null,
      staffNotes: '',
      cropDamageAcres: formData.cropDamageToggle ? Number(formData.cropDamageAcres) : null,
      propertyDamageINR: formData.propertyDamageToggle ? Number(formData.propertyDamageINR) : null,
      humanCasualties: Number(formData.humanCasualties),
      createdAt: new Date(),
      updatedAt: new Date(),
      resolvedAt: null,
      synced: false
    };

    try {
      await enqueue('incident', incidentPayload);
      navigate('/', { state: { message: 'Detailed report saved successfully.' } });
    } catch (err) {
      console.error(err);
      alert('Failed to save report.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50 pb-20">
      <div className="bg-forest-600 text-white p-4 sticky top-0 z-10 shadow-md">
        <h1 className="text-xl font-bold">Detailed Report</h1>
        <p className="text-sm opacity-90">Please provide accurate information</p>
      </div>

      <form onSubmit={handleSubmit} className="p-4 space-y-6 max-w-lg mx-auto">

        {/* 1. Incident Type */}
        <div className="space-y-3">
          <label className="block text-sm font-medium text-neutral-700">1. Incident Type (Required)</label>
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(incidentTypeConfig).map(([key, config]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFormData({...formData, type: key})}
                className={`p-3 rounded-lg border flex items-center gap-3 text-left transition-colors ${
                  formData.type === key
                    ? 'border-forest-500 bg-forest-50 ring-1 ring-forest-500'
                    : 'border-neutral-200 bg-white hover:border-neutral-300'
                }`}
              >
                <span className="text-2xl">{config.icon}</span>
                <div>
                  <div className="font-semibold text-sm text-neutral-900">{config.label}</div>
                  <div className="text-xs text-neutral-500">{config.nagamese}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* 2. Number of Elephants */}
        <div className="space-y-3 bg-white p-4 rounded-xl shadow-sm border border-neutral-100">
          <label className="block text-sm font-medium text-neutral-700">
            2. Estimated Number of Elephants: <span className="text-forest-600 font-bold text-lg">{formData.herdSize}{formData.herdSize >= 50 ? '+' : ''}</span>
          </label>
          <input
            type="range"
            min="1"
            max="50"
            value={formData.herdSize}
            onChange={(e) => setFormData({...formData, herdSize: e.target.value})}
            className="w-full h-2 bg-neutral-200 rounded-lg appearance-none cursor-pointer accent-forest-600"
          />
          <div className="flex justify-between text-xs text-neutral-500 font-medium px-1">
            <span>1</span>
            <span>25</span>
            <span>50+</span>
          </div>
        </div>

        {/* 3. Movement Direction */}
        <div className="space-y-3 bg-white p-4 rounded-xl shadow-sm border border-neutral-100">
          <label className="block text-sm font-medium text-neutral-700">3. Movement Direction</label>
          <div className="flex flex-wrap gap-2">
            {directions.map((dir) => (
              <button
                key={dir.val}
                type="button"
                onClick={() => setFormData({...formData, movementDirection: dir.val})}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  formData.movementDirection === dir.val
                    ? 'bg-forest-600 text-white shadow-md'
                    : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                }`}
              >
                {dir.label}
              </button>
            ))}
          </div>
        </div>

        {/* 4. Location */}
        <div className="space-y-3 bg-white p-4 rounded-xl shadow-sm border border-neutral-100">
          <label className="block text-sm font-medium text-neutral-700">4. Location</label>
          <div className="bg-neutral-50 p-3 rounded-lg border border-neutral-200 flex items-start gap-3">
            <MapPin className="text-forest-600 mt-1 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              {gpsLoading ? (
                <p className="text-sm text-neutral-600">Acquiring GPS...</p>
              ) : coords ? (
                <>
                  <p className="text-sm font-mono text-neutral-800 truncate">{coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}</p>
                  <p className="text-xs text-neutral-500 mt-1">Accuracy: ±{Math.round(coords.accuracy || 0)}m</p>
                </>
              ) : (
                <p className="text-sm text-alert-red">GPS unavailable. Defaulting to village center.</p>
              )}
            </div>
          </div>
          <input
            type="text"
            placeholder="Additional location details (e.g., Near Doyang river)"
            className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm focus:ring-forest-500 focus:border-forest-500"
            value={formData.locationDescription}
            onChange={(e) => setFormData({...formData, locationDescription: e.target.value})}
          />
        </div>

        {/* 6 & 7. Media */}
        <div className="space-y-4 bg-white p-4 rounded-xl shadow-sm border border-neutral-100">
          <PhotoCapture photos={photos} setPhotos={setPhotos} incidentId={tempId} />
          <div className="h-px bg-neutral-200 w-full my-4"></div>
          <VoiceNote voiceUrl={voiceUrl} setVoiceUrl={setVoiceUrl} incidentId={tempId} />
        </div>

        {/* 8, 9, 10. Damages */}
        <div className="space-y-4 bg-white p-4 rounded-xl shadow-sm border border-neutral-100">
          <h3 className="font-semibold text-neutral-900 border-b pb-2">Damages & Casualties</h3>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Human Casualties (Injuries/Deaths)</label>
            <input
              type="number"
              min="0"
              className="w-24 border border-neutral-300 rounded-lg px-3 py-2 text-center focus:ring-forest-500 focus:border-forest-500"
              value={formData.humanCasualties}
              onChange={(e) => setFormData({...formData, humanCasualties: e.target.value})}
            />
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-3 p-3 border rounded-lg bg-neutral-50 cursor-pointer">
              <input
                type="checkbox"
                className="w-5 h-5 text-forest-600 rounded border-neutral-300 focus:ring-forest-500"
                checked={formData.cropDamageToggle}
                onChange={(e) => setFormData({...formData, cropDamageToggle: e.target.checked})}
              />
              <span className="text-sm font-medium text-neutral-700">Crop Damage occurred</span>
            </label>
            {formData.cropDamageToggle && (
              <input
                type="number"
                step="0.1"
                placeholder="Estimated Area (Acres)"
                className="w-full border border-neutral-300 rounded-lg px-3 py-2 mt-2 focus:ring-forest-500 focus:border-forest-500"
                value={formData.cropDamageAcres}
                onChange={(e) => setFormData({...formData, cropDamageAcres: e.target.value})}
              />
            )}
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-3 p-3 border rounded-lg bg-neutral-50 cursor-pointer">
              <input
                type="checkbox"
                className="w-5 h-5 text-forest-600 rounded border-neutral-300 focus:ring-forest-500"
                checked={formData.propertyDamageToggle}
                onChange={(e) => setFormData({...formData, propertyDamageToggle: e.target.checked})}
              />
              <span className="text-sm font-medium text-neutral-700">Property Damage occurred</span>
            </label>
            {formData.propertyDamageToggle && (
              <input
                type="number"
                placeholder="Estimated Value (INR)"
                className="w-full border border-neutral-300 rounded-lg px-3 py-2 mt-2 focus:ring-forest-500 focus:border-forest-500"
                value={formData.propertyDamageINR}
                onChange={(e) => setFormData({...formData, propertyDamageINR: e.target.value})}
              />
            )}
          </div>
        </div>

        {/* 11. Description */}
        <div className="bg-white p-4 rounded-xl shadow-sm border border-neutral-100">
          <label className="block text-sm font-medium text-neutral-700 mb-2">11. Additional Details</label>
          <textarea
            rows="3"
            placeholder="Any other important information..."
            className="w-full border border-neutral-300 rounded-lg px-3 py-2 focus:ring-forest-500 focus:border-forest-500"
            value={formData.description}
            onChange={(e) => setFormData({...formData, description: e.target.value})}
          ></textarea>
        </div>

        <button
          type="submit"
          disabled={isSubmitting || !formData.type}
          className={`w-full py-4 bg-forest-600 text-white font-bold text-lg rounded-xl shadow-md transition-transform active:scale-[0.98] ${(isSubmitting || !formData.type) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-forest-700'}`}
        >
          {isSubmitting ? 'Submitting Report...' : 'Submit Detailed Report'}
        </button>
      </form>
    </div>
  );
}
