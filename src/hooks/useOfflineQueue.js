import { useEffect, useCallback } from 'react';
import { db } from '../firebase';
import {
  collection, addDoc, getDocs, deleteDoc, doc, serverTimestamp
} from 'firebase/firestore';

export function useOfflineQueue() {
  // Add item to local offline queue
  const enqueue = useCallback(async (type, payload) => {
    await addDoc(collection(db, 'offlineQueue'), {
      type,
      payload,
      createdAt: serverTimestamp(),
      attempts: 0,
    });
  }, []);

  // Process queue when online
  const processQueue = useCallback(async () => {
    if (!navigator.onLine) return;

    const snapshot = await getDocs(collection(db, 'offlineQueue'));
    for (const qDoc of snapshot.docs) {
      const item = qDoc.data();
      try {
        if (item.type === 'incident') {
          await addDoc(collection(db, 'incidents'), item.payload);
        }
        await deleteDoc(doc(db, 'offlineQueue', qDoc.id));
      } catch (err) {
        console.error('Queue processing error:', err);
      }
    }
  }, []);

  // Listen for connection restore
  useEffect(() => {
    window.addEventListener('online', processQueue);
    return () => window.removeEventListener('online', processQueue);
  }, [processQueue]);

  return { enqueue, processQueue };
}
