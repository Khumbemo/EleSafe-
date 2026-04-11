import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { db, messaging } from '../../firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { getToken } from 'firebase/messaging';
import * as Switch from '@radix-ui/react-switch';
import { Bell, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function AlertSettings() {
  const { userData, currentUser } = useAuth();
  const navigate = useNavigate();
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [radius, setRadius] = useState(userData?.alertRadiusKm || 10);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setNotificationsEnabled(!!userData?.fcmToken);
    if (userData?.alertRadiusKm) setRadius(userData.alertRadiusKm);
  }, [userData]);

  const handleTogglePush = async (checked) => {
    if (!currentUser) return;
    setSaving(true);

    try {
      let token = null;
      if (checked) {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          token = await getToken(messaging, { vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY });
        } else {
          alert("Please enable notifications in your browser/device settings.");
          setNotificationsEnabled(false);
          setSaving(false);
          return;
        }
      }

      await updateDoc(doc(db, 'users', currentUser.uid), {
        fcmToken: token
      });
      setNotificationsEnabled(checked);
    } catch (err) {
      console.error(err);
      alert("Failed to update notification settings");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveRadius = async () => {
    if (!currentUser) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'users', currentUser.uid), {
        alertRadiusKm: radius
      });
      alert("Settings saved!");
    } catch (err) {
      console.error(err);
      alert("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50 pb-20">
      <div className="bg-white border-b p-4 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => navigate(-1)}><ArrowLeft /></button>
        <h1 className="text-xl font-bold">Alert Settings</h1>
      </div>

      <div className="p-4 space-y-6">
        <div className="bg-white p-4 rounded-xl shadow-sm border border-neutral-200 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-neutral-900 flex items-center gap-2"><Bell size={18} /> Push Notifications</h3>
            <p className="text-xs text-neutral-500 mt-1">Receive critical alerts immediately</p>
          </div>
          <Switch.Root
            checked={notificationsEnabled}
            onCheckedChange={handleTogglePush}
            disabled={saving}
            className="w-[42px] h-[25px] bg-neutral-200 rounded-full relative data-[state=checked]:bg-forest-600 outline-none cursor-pointer"
          >
            <Switch.Thumb className="block w-[21px] h-[21px] bg-white rounded-full transition-transform duration-100 translate-x-0.5 will-change-transform data-[state=checked]:translate-x-[19px]" />
          </Switch.Root>
        </div>

        <div className="bg-white p-4 rounded-xl shadow-sm border border-neutral-200">
          <h3 className="font-bold text-neutral-900 mb-2">Alert Radius</h3>
          <p className="text-xs text-neutral-500 mb-4">Notify me about incidents within this distance from my village.</p>

          <div className="flex items-center gap-4">
            <input
              type="range"
              min="5"
              max="50"
              step="5"
              value={radius}
              onChange={(e) => setRadius(Number(e.target.value))}
              className="flex-1 h-2 bg-neutral-200 rounded-lg appearance-none cursor-pointer accent-forest-600"
            />
            <span className="font-bold text-forest-600 w-12 text-right">{radius} km</span>
          </div>

          <button
            onClick={handleSaveRadius}
            disabled={saving || radius === userData?.alertRadiusKm}
            className={`mt-6 w-full py-3 bg-neutral-900 text-white font-medium rounded-lg ${saving || radius === userData?.alertRadiusKm ? 'opacity-50' : ''}`}
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
