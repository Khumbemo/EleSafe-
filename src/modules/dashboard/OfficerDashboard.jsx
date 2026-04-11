import React, { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { collection, query, where, getDocs, onSnapshot, Timestamp } from 'firebase/firestore';
import StatsCards from './StatsCards';
import HotspotChart from './HotspotChart';
import ExportData from './ExportData';

export default function OfficerDashboard() {
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get incidents from the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const q = query(
      collection(db, 'incidents'),
      where('createdAt', '>=', Timestamp.fromDate(thirtyDaysAgo))
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate(),
        resolvedAt: doc.data().resolvedAt?.toDate(),
      }));
      setIncidents(data);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  if (loading) return <div className="p-8 text-center">Loading dashboard...</div>;

  return (
    <div className="min-h-screen bg-neutral-50 p-4 pb-20">
      <div className="mb-6 flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-display font-bold text-neutral-900">Officer Dashboard</h1>
          <p className="text-sm text-neutral-600">Overview of the last 30 days</p>
        </div>
        <ExportData incidents={incidents} />
      </div>

      <div className="space-y-6">
        <StatsCards incidents={incidents} />

        <div className="bg-white p-4 rounded-xl shadow-sm border border-neutral-200">
          <h3 className="font-bold text-neutral-800 mb-4">Incident Hotspots (Last 30 Days)</h3>
          <HotspotChart incidents={incidents} />
        </div>
      </div>
    </div>
  );
}
