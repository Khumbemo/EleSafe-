package org.hatialert.client.app

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import org.hatialert.client.Village
import org.hatialert.core.Geo
import org.hatialert.core.IncidentType
import org.hatialert.core.LatLng
import org.hatialert.core.Severity
import org.hatialert.core.Villages

class ReportDraftTest {
    private val villages = Villages.SEED.map { Village(0, it.name, it.lat, it.lng, it.verified, it.source) }
    private val ok = ReportDraft(type = IncidentType.CROP_RAID, herdSize = "6", village = "Wozhuro", offsetKm = "1", offsetDir = "NE")

    @Test
    fun validDraftBuildsTheServerRequest() {
        assertEquals(emptyMap(), ok.validate(villages))
        val r = ok.toRequest()
        assertEquals("crop_raid", r.type)
        assertEquals(6, r.herdSize)
        assertEquals(1.0, r.offsetKm)
        assertEquals("NE", r.offsetDir)
        assertNull(r.lat)
        assertNull(r.attachments)
        assertTrue(Regex("[A-Za-z0-9_-]{8,64}").matches(r.clientId!!))
        assertEquals(Severity.HIGH, ok.severityPreview())
        val v = Villages.byName("Wozhuro")
        assertEquals(Geo.destination(v.lat, v.lng, 1.0, "NE"), ok.position(villages))
    }

    @Test
    fun sameMessagesAsTheServer() {
        // test_report_validation in hatialert-py, field by field
        assertEquals("Choose what happened.", ok.copy(type = null).validate(villages)["type"])
        assertEquals("Enter a value from 0 to 200.", ok.copy(herdSize = "-1").validate(villages)["herd_size"])
        assertEquals("Enter a number.", ok.copy(herdSize = "many").validate(villages)["herd_size"])
        assertEquals("Say which way from the village.", ok.copy(offsetDir = "").validate(villages)["offset_dir"])
        assertEquals("Choose a direction from the list.", ok.copy(heading = "UP").validate(villages)["heading"])
        assertEquals("Enter a value from 25 to 27.5.", ok.copy(useGps = true, gps = LatLng(10.0, 94.0)).validate(villages)["lat"])
        assertEquals("Choose a village from the list.", ok.copy(village = "Paris").validate(villages)["village"])
        assertEquals("Enter a value from 0 to 15.", ok.copy(offsetKm = "16").validate(villages)["offset_km"])
        assertEquals("Keep this under 500 characters.", ok.copy(description = "x".repeat(501)).validate(villages)["description"])
    }

    @Test
    fun photosAreCheckedByContent() {
        val jpeg = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte()) + ByteArray(60)
        assertEquals(emptyMap(), ok.copy(photos = listOf(jpeg)).validate(villages))
        assertEquals("Use a JPEG, PNG or WebP photo.", ok.copy(photos = listOf("<html>".toByteArray())).validate(villages)["attachments"])
        assertEquals("A report can have up to 6 photos.", ok.copy(photos = List(7) { jpeg }).validate(villages)["attachments"])
        assertEquals("Each photo must be under 1.5 MB.", ok.copy(photos = listOf(jpeg + ByteArray(1_500_000))).validate(villages)["attachments"])
        assertEquals("/9j/4A", ok.copy(photos = listOf(jpeg)).toRequest().attachments!!.single().data.take(6))
    }

    @Test
    fun gpsReportSendsPositionNotOffset() {
        val d = ok.copy(useGps = true, gps = LatLng(26.1, 94.26))
        assertEquals(emptyMap(), d.validate(villages))
        val r = d.toRequest()
        assertEquals(26.1, r.lat)
        assertNull(r.offsetKm)
        assertNull(r.offsetDir)
        assertTrue(ok.copy(useGps = true).validate(villages).containsKey("lat"))
    }

    @Test
    fun injuryAlwaysCountsACasualty() {
        val d = ok.copy(type = IncidentType.INJURY, casualties = "0", herdSize = "1")
        assertEquals(Severity.CRITICAL, d.severityPreview())
        assertEquals(Severity.LOW, ok.copy(type = IncidentType.SIGHTING, herdSize = "1").severityPreview())
    }

    @Test
    fun nearestVillageDescribesAGpsPoint() {
        val v = Villages.byName("Sanis")
        val p = Geo.destination(v.lat, v.lng, 1.2, "SW")
        val placed = nearestVillage(p, villages)!!
        assertEquals("Sanis", placed.village.name)
        assertEquals("1.2 km SW of Sanis", placed.describe())
        assertEquals("At Sanis", nearestVillage(LatLng(v.lat, v.lng), villages)!!.describe())
        assertEquals("15", ReportDraft.plain(15.0))
        assertEquals("27.5", ReportDraft.plain(27.5))
    }
}
