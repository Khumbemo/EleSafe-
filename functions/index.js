const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

// Haversine formula logic duplicated for server environment
function haversineDistance(coord1, coord2) {
  const R = 6371; // Earth radius in km
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(coord2.lat - coord1.lat);
  const dLng = toRad(coord2.lng - coord1.lng);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(coord1.lat)) *
    Math.cos(toRad(coord2.lat)) *
    Math.sin(dLng / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // km
}

exports.onNewIncident = functions.firestore
  .document('incidents/{incidentId}')
  .onCreate(async (snap, context) => {
    const incident = snap.data();
    const { coordinates, severity, type, reporterVillage } = incident;

    if (!coordinates) {
      console.warn('Incident missing coordinates, skipping alert');
      return null;
    }

    try {
      // Find users within alert radius
      const usersSnapshot = await admin.firestore().collection('users').get();

      const alertRadius = severity === 'critical' ? 25 :
                          severity === 'high' ? 15 :
                          severity === 'medium' ? 10 : 5;

      const tokensToNotify = [];
      const villagesAlerted = new Set();

      usersSnapshot.docs.forEach(doc => {
        const user = doc.data();
        if (!user.fcmToken || !user.coordinates) return;

        const dist = haversineDistance(coordinates, user.coordinates);

        // Notify if user is within global alert radius OR their personal radius preference
        const triggerRadius = Math.max(alertRadius, user.alertRadiusKm || 0);

        if (dist <= triggerRadius) {
          tokensToNotify.push(user.fcmToken);
          if (user.village) villagesAlerted.add(user.village);
        }
      });

      // Send FCM multicast
      if (tokensToNotify.length > 0) {
        const payload = {
          tokens: tokensToNotify,
          notification: {
            title: `🐘 Elephant Alert — ${type.replace('_', ' ').toUpperCase()}`,
            body: `Reported near ${reporterVillage || 'your area'}. Stay alert and stay safe.`,
          },
          data: { incidentId: context.params.incidentId },
        };

        const response = await admin.messaging().sendEachForMulticast(payload);
        console.log(`Successfully sent ${response.successCount} messages; Failed ${response.failureCount}`);
      }

      // Log alert
      await admin.firestore().collection('alerts').add({
        incidentId: context.params.incidentId,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        affectedVillages: Array.from(villagesAlerted),
        radiusKm: alertRadius,
        type: 'warning',
        message: `Elephant activity (${type.replace('_', ' ')}) reported near ${reporterVillage}.`,
      });

      return null;
    } catch (err) {
      console.error('Error processing incident alert:', err);
      return null;
    }
  });
