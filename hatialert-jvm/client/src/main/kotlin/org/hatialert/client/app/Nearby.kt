package org.hatialert.client.app

import org.hatialert.client.Incident
import org.hatialert.client.Village
import org.hatialert.core.Geo

/** An open incident seen from the user's village. */
data class NearbyItem(val incident: Incident, val km: Double, val dir: String)

/**
 * Open incidents within [radiusKm] of [home], nearest first then newest, with
 * distance (km, one decimal) and compass direction worked out on the phone by
 * :core, the same way the server's /api/overview does.
 */
fun nearbyIncidents(home: Village, radiusKm: Double, incidents: List<Incident>): List<NearbyItem> = incidents
    .asSequence()
    .filter { it.open }
    .mapNotNull { i ->
        val d = Geo.haversineKm(home.lat, home.lng, i.lat, i.lng)
        if (d > radiusKm) null else NearbyItem(i, Geo.round(d, 1), Geo.compass(Geo.bearingDeg(home.lat, home.lng, i.lat, i.lng)))
    }
    .sortedWith(compareBy<NearbyItem> { it.km }.thenByDescending { it.incident.createdAt })
    .toList()
