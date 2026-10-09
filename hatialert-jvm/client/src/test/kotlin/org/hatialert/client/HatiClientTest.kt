package org.hatialert.client

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json as KJson
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject

class HatiClientTest {
    private val t = FakeTransport()
    private val c = HatiClient("http://10.0.2.2:8000/", t)

    @Test
    fun loginStoresTokenAndSendsBearer() {
        t.on("POST", "/api/auth/login", body = """{"token": "tok123", "user": ${Json.USER}}""")
        t.on("GET", "/api/me", body = Json.USER)
        val s = c.login("9000000001", "1111")
        assertEquals("tok123", c.token)
        assertEquals("villager", s.user.role)
        assertEquals("""{"phone":"9000000001","pin":"1111"}""", t.bodyOf())
        assertNull(t.last.headers["Authorization"])
        assertEquals("application/json; charset=utf-8", t.last.headers["Content-Type"])
        c.me()
        assertEquals("Bearer tok123", t.last.headers["Authorization"])
        assertEquals("http://10.0.2.2:8000/api/me", t.last.url)
        assertNull(t.last.body)
    }

    @Test
    fun logoutClearsTokenEvenWhenOffline() {
        c.token = "abc"
        t.offline = true
        assertFailsWith<NetworkException> { c.logout() }
        assertNull(c.token)
    }

    @Test
    fun incidentsQueryAndUnknownFieldsIgnored() {
        t.on("GET", "/api/incidents", body = "[${Json.incident(7)}]")
        val list = c.incidents(status = "all", mine = true, village = "Wokha Town")
        assertEquals("http://10.0.2.2:8000/api/incidents?status=all&mine=1&village=Wokha+Town", t.last.url)
        assertEquals(1, list.size)
        assertEquals("HA-2609-0007", list[0].ref)
        assertEquals(1.25, list[0].cropAcres)
        assertNull(list[0].events)
    }

    @Test
    fun createIncidentOmitsNullsAndSendsClientId() {
        t.on("POST", "/api/incidents", body = Json.incident(14))
        c.createIncident(NewIncident(type = "crop_raid", village = "Wozhuro", herdSize = 6, offsetKm = 1.0, offsetDir = "NE", clientId = "abcdefgh12"))
        val body = KJson.parseToJsonElement(t.bodyOf()!!).jsonObject
        assertFalse("lat" in body)
        assertFalse("attachments" in body)
        assertEquals("1.0", body["offset_km"].toString())
        assertEquals("\"NE\"", body["offset_dir"].toString())
        assertEquals("\"abcdefgh12\"", body["client_id"].toString())
        assertEquals("6", body["herd_size"].toString())
    }

    @Test
    fun statusUpdateIsPatch() {
        t.on("PATCH", "/api/incidents/3", body = Json.incident(3, "verified", extra = """, "events": [], "next": ["responded", "false_report"]"""))
        val inc = c.updateStatus(3, "verified", "Tracks seen")
        assertEquals("PATCH", t.last.method)
        assertEquals("""{"status":"verified","note":"Tracks seen"}""", t.bodyOf())
        assertEquals(listOf("responded", "false_report"), inc.next)
    }

    @Test
    fun attachmentIsBase64() {
        t.on("POST", "/api/incidents/3/attachments", body = Json.incident(3))
        c.addAttachment(3, "photo", byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte()))
        assertEquals("""{"kind":"photo","data":"/9j/4A=="}""", t.bodyOf())
    }

    @Test
    fun serverErrorsCarryMessageAndField() {
        t.on("POST", "/api/auth/login", 401, """{"error": "That phone number and PIN don't match.", "field": "pin"}""")
        val e = assertFailsWith<ApiException> { c.login("9000000001", "0000") }
        assertEquals(401, e.status)
        assertEquals("pin", e.field)
        assertEquals("That phone number and PIN don't match.", e.message)
        assertTrue(e.isUnauthorized)
        assertNull(c.token)

        t.on("GET", "/api/alerts", 502, "<html>Bad gateway</html>")
        val e2 = assertFailsWith<ApiException> { c.alerts() }
        assertEquals("The server had a problem (502). Try again later.", e2.message)
        assertNull(e2.field)
    }

    @Test
    fun unexpectedBodyIsAnApiError() {
        t.on("GET", "/api/me", body = "[1, 2]")
        assertFailsWith<ApiException> { c.me() }
    }

    @Test
    fun networkFailureIsNetworkException() {
        t.offline = true
        val e = assertFailsWith<NetworkException> { c.meta() }
        assertTrue(e.message!!.contains("http://10.0.2.2:8000"))
    }

    @Test
    fun metaParsesAndKeepsFlexibleParts() {
        t.on("GET", "/api/meta", body = Json.META)
        val m = c.meta()
        assertEquals(listOf("Wokha Town", "Wozhuro"), m.villages.map { it.name })
        assertEquals(listOf("verified", "false_report"), m.transitions["reported"])
        assertTrue(m.limits["herd_size"] != null)
        assertTrue(m.safety is JsonObject)
        assertEquals(m.villages, c.villages())
    }

    @Test
    fun nearbyVillagesAndOverview() {
        t.on("GET", "/api/incidents/1/villages", body = """[{"name": "Tening", "km": 0.9, "dir": "NE"}]""")
        assertEquals(NearbyVillage("Tening", 0.9, "NE"), c.nearbyVillages(1, 5.0).single())
        assertEquals("http://10.0.2.2:8000/api/incidents/1/villages?km=5.0", t.last.url)
        t.on("GET", "/api/overview", body = Json.overview(Json.incident(1, extra = """, "km": 0.4, "dir": "E"""")))
        val ov = c.overview()
        assertEquals("Wozhuro", ov.village.name)
        assertEquals(0.4, ov.nearby.single().km)
    }

    @Test
    fun baseUrlNormalisation() {
        assertEquals("http://10.0.2.2:8000", HatiClient.normalizeBaseUrl(" http://10.0.2.2:8000/ "))
        assertEquals("http://192.168.1.5:8000", HatiClient.normalizeBaseUrl("192.168.1.5:8000"))
        assertEquals("https://hati.example.org", HatiClient.normalizeBaseUrl("HTTPS://hati.example.org//"))
        assertFailsWith<IllegalArgumentException> { HatiClient.normalizeBaseUrl("ftp://x") }
        assertFailsWith<IllegalArgumentException> { HatiClient.normalizeBaseUrl("  ") }
        assertFailsWith<IllegalArgumentException> { HatiClient.normalizeBaseUrl("http://") }
    }
}
