package org.hatialert.client.app

import java.util.UUID
import kotlin.io.encoding.Base64
import org.hatialert.client.NewAttachment
import org.hatialert.client.NewIncident
import org.hatialert.client.Village
import org.hatialert.core.Geo
import org.hatialert.core.IncidentType
import org.hatialert.core.LatLng
import org.hatialert.core.Limits
import org.hatialert.core.MediaKind
import org.hatialert.core.Severity

/**
 * The report form. Text fields stay as typed so the form can show what the
 * person entered; [validate] checks them with the server's own rules and
 * messages (api.py post_incident) before anything is sent.
 */
data class ReportDraft(
    val type: IncidentType? = null,
    val herdSize: String = "1",
    val casualties: String = "0",
    val village: String? = null,
    val offsetKm: String = "0",
    val offsetDir: String = "",
    val heading: String = "",
    val useGps: Boolean = false,
    val gps: LatLng? = null,
    val gpsAccuracyM: Float? = null,
    val description: String = "",
    /** JPEG/PNG/WebP bytes, already shrunk by the app. */
    val photos: List<ByteArray> = emptyList(),
    /** Same id on a resend, so a dropped connection can't create a duplicate. */
    val clientId: String = UUID.randomUUID().toString().replace("-", ""),
) {
    /** Field -> message for everything the server would refuse. Empty when the draft can be sent. */
    fun validate(villages: List<Village>): Map<String, String> {
        val e = linkedMapOf<String, String>()
        if (type == null) e["type"] = "Choose what happened."
        if (village == null || villages.none { it.name == village }) e["village"] = "Choose a village from the list."
        intIn(herdSize, Limits.HERD_SIZE_MIN, Limits.HERD_SIZE_MAX)?.let { e["herd_size"] = it }
        if (type?.isCasualty == true) intIn(casualties, Limits.CASUALTIES_MIN, Limits.CASUALTIES_MAX)?.let { e["casualties"] = it }
        if (useGps) {
            val p = gps
            if (p == null) {
                e["lat"] = "No GPS position yet. Wait for a fix or use distance from a village."
            } else {
                rangeMessage(p.lat, Limits.REPORT_LAT_MIN, Limits.REPORT_LAT_MAX)?.let { e["lat"] = it }
                rangeMessage(p.lng, Limits.REPORT_LNG_MIN, Limits.REPORT_LNG_MAX)?.let { e["lng"] = it }
            }
        } else {
            val km = offsetKm.trim().ifEmpty { "0" }.toDoubleOrNull()
            when {
                km == null || km.isNaN() -> e["offset_km"] = "Enter a number."
                km < Limits.OFFSET_KM_MIN || km > Limits.OFFSET_KM_MAX ->
                    e["offset_km"] = "Enter a value from ${plain(Limits.OFFSET_KM_MIN)} to ${plain(Limits.OFFSET_KM_MAX)}."
                km > 0 && offsetDir !in Geo.DIRECTIONS -> e["offset_dir"] = "Say which way from the village."
            }
        }
        if (heading.isNotEmpty() && heading !in Geo.DIRECTIONS) e["heading"] = "Choose a direction from the list."
        if (description.trim().length > Limits.DESCRIPTION_MAX) e["description"] = "Keep this under ${Limits.DESCRIPTION_MAX} characters."
        val rule = MediaKind.PHOTO
        when {
            photos.size > rule.maxCount() -> e["attachments"] = "A report can have up to ${rule.maxCount()} photos."
            photos.any { it.size > rule.maxBytes() } -> e["attachments"] = "Each photo must be under ${plain(rule.maxBytes() / 1_000_000.0)} MB."
            photos.any { it.isEmpty() } -> e["attachments"] = "That file is empty."
            photos.any { MediaKind.sniff(it.copyOf(minOf(16, it.size))) !in rule.mimes() } -> e["attachments"] = "Use a JPEG, PNG or WebP photo."
        }
        return e
    }

    /** Severity the server will give this report (it always counts a casualty for injury or death). */
    fun severityPreview(): Severity? {
        val t = type ?: return null
        val herd = herdSize.trim().toIntOrNull() ?: 1
        var cas = if (t.isCasualty) casualties.trim().toIntOrNull() ?: 0 else 0
        if (t.isCasualty && cas == 0) cas = 1
        return Severity.classify(t, herd, cas)
    }

    /** Where the report will be placed, as the server works it out. */
    fun position(villages: List<Village>): LatLng? {
        if (useGps) return gps
        val v = villages.firstOrNull { it.name == village } ?: return null
        val km = offsetKm.trim().ifEmpty { "0" }.toDoubleOrNull() ?: return null
        return Geo.destination(v.lat, v.lng, km, offsetDir)
    }

    /** The request body. Call only when [validate] is empty. */
    fun toRequest(): NewIncident {
        val t = requireNotNull(type) { "type" }
        val gpsPoint = gps.takeIf { useGps }
        return NewIncident(
            type = t.key(),
            village = requireNotNull(village) { "village" },
            herdSize = herdSize.trim().toIntOrNull() ?: 1,
            casualties = if (t.isCasualty) casualties.trim().toIntOrNull() ?: 0 else 0,
            heading = heading,
            lat = gpsPoint?.lat,
            lng = gpsPoint?.lng,
            offsetKm = if (gpsPoint == null) offsetKm.trim().ifEmpty { "0" }.toDouble() else null,
            offsetDir = if (gpsPoint == null) offsetDir else null,
            description = description.trim(),
            clientId = clientId,
            attachments = photos.map { NewAttachment(MediaKind.PHOTO.key(), Base64.encode(it)) }.ifEmpty { null },
        )
    }

    companion object {
        /** api.py's `_plain`: 15.0 -> "15", 27.5 -> "27.5". */
        fun plain(x: Double): String = if (x == Math.floor(x) && !x.isInfinite()) x.toLong().toString() else x.toString()

        private fun intIn(text: String, lo: Int, hi: Int): String? {
            val v = text.trim().ifEmpty { null }?.toIntOrNull() ?: return if (text.isBlank()) null else "Enter a number."
            return if (v < lo || v > hi) "Enter a value from $lo to $hi." else null
        }

        private fun rangeMessage(v: Double, lo: Double, hi: Double): String? =
            if (v.isNaN() || v < lo || v > hi) "Enter a value from ${plain(lo)} to ${plain(hi)}." else null
    }
}

/** A point described from its nearest village, e.g. "1.2 km NE of Wozhuro". */
data class Placement(val village: Village, val km: Double, val dir: String) {
    fun describe(): String = if (km < 0.05) "At ${village.name}" else "${fmtKm(km)} km $dir of ${village.name}"
}

/** Nearest village to a GPS point, with distance and direction from it. */
fun nearestVillage(p: LatLng, villages: List<Village>): Placement? = villages
    .minByOrNull { Geo.haversineKm(it.lat, it.lng, p.lat, p.lng) }
    ?.let { v -> Placement(v, Geo.haversineKm(v.lat, v.lng, p.lat, p.lng), Geo.compass(Geo.bearingDeg(v.lat, v.lng, p.lat, p.lng))) }

/** One decimal, as the server rounds distances. */
fun fmtKm(km: Double): String = String.format(java.util.Locale.ROOT, "%.1f", Geo.round(km, 1))
