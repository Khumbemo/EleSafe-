import React from 'react';
import Papa from 'papaparse';
import { Download } from 'lucide-react';

export default function ExportData({ incidents }) {
  const handleExport = () => {
    if (!incidents || incidents.length === 0) {
      alert("No data to export");
      return;
    }

    const exportData = incidents.map(i => ({
      ID: i.id,
      Date: i.createdAt ? new Date(i.createdAt).toLocaleString() : 'N/A',
      Type: i.type,
      Severity: i.severity,
      Village: i.reporterVillage,
      Latitude: i.coordinates?.lat,
      Longitude: i.coordinates?.lng,
      Status: i.status,
      Herd_Size: i.herdSize,
      Casualties: i.humanCasualties || 0,
      Crop_Damage_Acres: i.cropDamageAcres || 0,
      Property_Damage_INR: i.propertyDamageINR || 0,
      Reported_By_Name: i.reporterName
    }));

    const csv = Papa.unparse(exportData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `HatiAlert_Export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <button
      onClick={handleExport}
      className="flex items-center gap-2 bg-neutral-200 text-neutral-800 px-3 py-2 rounded-lg text-sm font-medium hover:bg-neutral-300 transition-colors"
    >
      <Download size={16} />
      Export CSV
    </button>
  );
}
