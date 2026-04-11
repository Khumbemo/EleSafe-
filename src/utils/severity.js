// Determines severity level based on incident type and inputs
// Based on Wildlife Institute of India HEC assessment guidelines

export function classifySeverity(type, herdSize, casualties) {
  if (casualties > 0 || type === 'death' || type === 'injury') return 'critical';
  if (type === 'property_damage') return 'high';
  if (type === 'crop_raid') return herdSize >= 5 ? 'high' : 'medium';
  if (type === 'herd_movement' && herdSize >= 10) return 'high';
  if (type === 'sighting' && herdSize >= 5) return 'medium';
  return 'low';
}

export const severityConfig = {
  critical: { color: 'bg-red-600', label: 'Critical', icon: 'AlertOctagon', mapColor: '#dc2626' },
  high:     { color: 'bg-orange-500', label: 'High', icon: 'AlertTriangle', mapColor: '#ea580c' },
  medium:   { color: 'bg-yellow-500', label: 'Medium', icon: 'AlertCircle', mapColor: '#ca8a04' },
  low:      { color: 'bg-green-600', label: 'Low', icon: 'Info', mapColor: '#16a34a' },
};

export const incidentTypeConfig = {
  sighting:         { label: 'Elephant Sighted', icon: '🐘', nagamese: 'Hati Dekha' },
  crop_raid:        { label: 'Crop Raid', icon: '🌾', nagamese: 'Kheti Barbad' },
  property_damage:  { label: 'Property Damage', icon: '🏠', nagamese: 'Ghar Tuta' },
  injury:           { label: 'Human Injury', icon: '🤕', nagamese: 'Manuh Ahata' },
  death:            { label: 'Human Death', icon: '💀', nagamese: 'Manuh Mara' },
  herd_movement:    { label: 'Herd Moving', icon: '➡️', nagamese: 'Pal Jaache' },
};
