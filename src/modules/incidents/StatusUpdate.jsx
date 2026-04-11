import React, { useState } from 'react';
import { db } from '../../firebase';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';

export default function StatusUpdate({ incident, onUpdate }) {
  const { userData } = useAuth();
  const [status, setStatus] = useState(incident.status);
  const [notes, setNotes] = useState(incident.staffNotes || '');
  const [loading, setLoading] = useState(false);

  const handleUpdate = async () => {
    setLoading(true);
    try {
      const updateData = {
        status,
        staffNotes: notes,
        updatedAt: serverTimestamp(),
      };

      if (['closed', 'false_report', 'responded'].includes(status) && !incident.resolvedAt) {
        updateData.resolvedAt = serverTimestamp();
      }

      const docRef = doc(db, 'incidents', incident.id);
      await updateDoc(docRef, updateData);

      onUpdate({ status, staffNotes: notes });
      alert('Status updated successfully');
    } catch (err) {
      console.error(err);
      alert('Failed to update status');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-forest-50 p-4 rounded-xl border border-forest-200">
      <h3 className="font-bold text-forest-800 mb-3">Staff Actions</h3>

      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-forest-700 mb-1">Update Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full border-forest-300 rounded-lg p-2 text-sm bg-white focus:ring-forest-500 focus:border-forest-500"
          >
            <option value="reported">Reported (New)</option>
            <option value="verified">Verified</option>
            <option value="responded">Responded / Action Taken</option>
            <option value="closed">Closed</option>
            <option value="false_report">False Report</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-forest-700 mb-1">Official Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add notes about response, team deployed, etc."
            rows="3"
            className="w-full border-forest-300 rounded-lg p-2 text-sm bg-white focus:ring-forest-500 focus:border-forest-500"
          />
        </div>

        <button
          onClick={handleUpdate}
          disabled={loading || (status === incident.status && notes === incident.staffNotes)}
          className={`w-full py-2 bg-forest-600 text-white font-medium rounded-lg ${loading ? 'opacity-50' : 'hover:bg-forest-700'}`}
        >
          {loading ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}
