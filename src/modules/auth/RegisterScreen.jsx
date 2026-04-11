import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../../firebase';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { wokhaVillages } from '../../utils/constants';

export default function RegisterScreen() {
  const [formData, setFormData] = useState({
    name: '',
    village: '',
    role: 'villager',
    staffCode: '',
    language: 'en'
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const user = auth.currentUser;

  // Ideally fetched from config/app, hardcoded for MVP
  const STAFF_REGISTRATION_CODE = 'FOREST123';

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!user) {
      navigate('/login');
      return;
    }

    if (formData.role !== 'villager' && formData.staffCode !== STAFF_REGISTRATION_CODE) {
      setError('Invalid staff registration code');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const selectedVillage = wokhaVillages.find(v => v.name === formData.village);

      const userDocData = {
        uid: user.uid,
        phone: user.phoneNumber,
        name: formData.name,
        role: formData.role,
        village: formData.village,
        district: "Wokha",
        state: "Nagaland",
        coordinates: selectedVillage ? selectedVillage.coordinates : null,
        alertRadiusKm: 10,
        fcmToken: null, // Will be updated when permission requested
        language: formData.language,
        createdAt: serverTimestamp(),
        lastActive: serverTimestamp()
      };

      await setDoc(doc(db, 'users', user.uid), userDocData);

      // Navigate to home and trigger FCM permission request there
      navigate('/');
    } catch (err) {
      setError('Registration failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50 p-6 flex flex-col justify-center">
      <div className="max-w-md w-full mx-auto bg-white rounded-xl shadow-lg p-6">
        <h2 className="text-2xl font-display font-bold text-neutral-900 mb-6 text-center">Complete Registration</h2>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Full Name</label>
            <input
              type="text"
              required
              className="w-full border border-neutral-300 rounded-lg px-4 py-3 min-h-[48px] focus:ring-forest-500 focus:border-forest-500"
              value={formData.name}
              onChange={(e) => setFormData({...formData, name: e.target.value})}
              placeholder="e.g. John Doe"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Village</label>
            <select
              required
              className="w-full border border-neutral-300 rounded-lg px-4 py-3 min-h-[48px] focus:ring-forest-500 focus:border-forest-500 bg-white"
              value={formData.village}
              onChange={(e) => setFormData({...formData, village: e.target.value})}
            >
              <option value="">Select your village</option>
              {wokhaVillages.map((v) => (
                <option key={v.name} value={v.name}>{v.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Preferred Language</label>
            <select
              className="w-full border border-neutral-300 rounded-lg px-4 py-3 min-h-[48px] focus:ring-forest-500 focus:border-forest-500 bg-white"
              value={formData.language}
              onChange={(e) => setFormData({...formData, language: e.target.value})}
            >
              <option value="en">English</option>
              <option value="nagamese">Nagamese</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Role</label>
            <select
              className="w-full border border-neutral-300 rounded-lg px-4 py-3 min-h-[48px] focus:ring-forest-500 focus:border-forest-500 bg-white"
              value={formData.role}
              onChange={(e) => setFormData({...formData, role: e.target.value})}
            >
              <option value="villager">Villager</option>
              <option value="guard">Forest Guard</option>
              <option value="officer">Range Officer</option>
            </select>
          </div>

          {formData.role !== 'villager' && (
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">Staff Access Code</label>
              <input
                type="text"
                required
                className="w-full border border-neutral-300 rounded-lg px-4 py-3 min-h-[48px] focus:ring-forest-500 focus:border-forest-500"
                value={formData.staffCode}
                onChange={(e) => setFormData({...formData, staffCode: e.target.value})}
                placeholder="Enter staff code"
              />
            </div>
          )}

          {error && <p className="text-alert-red text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className={`w-full py-4 mt-4 rounded-lg shadow-sm text-lg font-medium text-white bg-forest-600 hover:bg-forest-700 min-h-[48px] ${loading ? 'opacity-50' : ''}`}
          >
            {loading ? 'Saving...' : 'Complete Profile'}
          </button>
        </form>
      </div>
    </div>
  );
}
