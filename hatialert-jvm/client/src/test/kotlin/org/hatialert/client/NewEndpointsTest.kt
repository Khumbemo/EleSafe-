package org.hatialert.client

import kotlin.io.encoding.Base64
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

/** Request bodies and answers of the account, media, alert and officer calls. */
class NewEndpointsTest {
    private val t = FakeTransport()
    private val c = HatiClient("http://h:8000", t, token = "tok")

    @Test
    fun accountCalls() {
        t.on("POST", "/api/auth/otp", body = """{"sent": true, "message": "If this number can get texts, a 6-digit code is on its way."}""")
        assertEquals("If this number can get texts, a 6-digit code is on its way.", c.requestCode("9876543210", "register").message)
        assertEquals("""{"phone":"9876543210","purpose":"register"}""", t.bodyOf())

        t.on("POST", "/api/auth/register", body = """{"token": "new", "user": ${Json.USER}}""")
        c.register("Akum", "9876543210", "Wozhuro", "408215", "123456")
        assertEquals("""{"name":"Akum","phone":"9876543210","village":"Wozhuro","pin":"408215","code":"123456"}""", t.bodyOf())
        c.register("Akum", "9876543210", "Wozhuro", "408215")
        assertEquals("""{"name":"Akum","phone":"9876543210","village":"Wozhuro","pin":"408215"}""", t.bodyOf(), "no code without texts")

        t.on("POST", "/api/auth/reset", body = """{"token": "reset", "user": ${Json.USER}}""")
        c.resetPin("9876543210", "654321", "719356")
        assertEquals("reset", c.token)
        assertEquals("""{"phone":"9876543210","code":"654321","pin":"719356"}""", t.bodyOf())

        t.on("POST", "/api/me/pin", body = Json.USER)
        c.changePin("1111", "582947")
        assertEquals("""{"old_pin":"1111","pin":"582947"}""", t.bodyOf())

        t.on("POST", "/api/me/logout-all", body = """{"ok": true}""")
        c.logoutAll()
        assertEquals("Bearer reset", t.last.headers["Authorization"])

        t.on("PATCH", "/api/me", body = Json.USER)
        c.updateMe(ProfileUpdate(smsAlerts = false))
        assertEquals("""{"sms_alerts":false}""", t.bodyOf())

        t.on("POST", "/api/auth/otp", 409, """{"error": "Text messages aren't set up on this server. Ask a forest officer.", "field": null}""")
        val e = assertFailsWith<ApiException> { c.requestCode("9876543210", "reset") }
        assertEquals(409 to "Text messages aren't set up on this server. Ask a forest officer.", e.status to e.message)
    }

    @Test
    fun attachmentsComeBackAsBytes() {
        val bytes = byteArrayOf(0, 0, 0, 0x20) + "ftypM4A ".toByteArray()
        t.on("GET", "/api/attachments/7", body = """{"id": 7, "kind": "voice", "mime": "audio/mp4", "size": 12, "data": "${Base64.encode(bytes)}"}""")
        assertContentEquals(bytes, c.attachmentBytes(7))
        t.on("GET", "/api/attachments/8", body = """{"id": 8, "kind": "voice", "mime": "audio/mp4", "size": 12, "data": "%%%"}""")
        assertEquals("The server sent something this app doesn't understand.", assertFailsWith<ApiException> { c.attachmentBytes(8) }.message)
        t.on("GET", "/api/attachments/9", 403, """{"error": "Only the reporter and forest staff can see these files.", "field": null}""")
        assertEquals(403, assertFailsWith<ApiException> { c.attachmentBytes(9) }.status)
    }

    @Test
    fun sentAlertCarriesItsTexts() {
        t.on(
            "POST", "/api/alerts",
            body = """{"id": 9, "level": "warning", "level_label": "Elephant warning", "message": "m", "villages": ["Wozhuro"],
                "incident_id": 3, "by": "Guard", "sent_at": 1, "sample": false, "affects_me": false, "active": true,
                "sms": {"recipients": 4, "mode": "manual"}}""",
        )
        val a = c.sendAlert(NewAlert("warning", "m", listOf("Wozhuro"), 3))
        assertEquals(AlertSms(4, "manual"), a.sms)
        assertEquals("""{"level":"warning","message":"m","villages":["Wozhuro"],"incident_id":3}""", t.bodyOf())
    }

    @Test
    fun officerCalls() {
        t.on("GET", "/api/users", body = """[{"id": 4, "name": "Akum", "phone": "9876543210", "village": "Wozhuro", "role": "villager",
            "radius_km": 5.0, "phone_verified": true, "must_change_pin": false, "sms_alerts": true, "active": true,
            "created_at": 1, "last_seen": null, "failed_24h": 2, "sample": false}]""")
        assertEquals(2, c.users("Ak um", "villager").single().failed24h)
        assertEquals("http://h:8000/api/users?q=Ak+um&role=villager", t.last.url)

        t.on("PATCH", "/api/users/4", body = """{"id": 4, "name": "Akum", "phone": "9876543210", "village": "Wozhuro", "role": "guard"}""")
        c.updateUser(4, UserPatch(role = "guard"))
        assertEquals("""{"role":"guard"}""", t.bodyOf())
        c.updateUser(4, UserPatch(active = false))
        assertEquals("""{"active":false}""", t.bodyOf())

        t.on("POST", "/api/users/4/reset-pin", body = """{"temp_pin": "583920", "user": {"id": 4, "name": "Akum", "phone": "9876543210", "village": "Wozhuro", "role": "villager", "must_change_pin": true}}""")
        val r = c.resetUserPin(4)
        assertEquals("583920" to true, r.tempPin to r.user.mustChangePin)

        t.on("PATCH", "/api/villages/2", body = """{"id": 2, "name": "Wozhuro", "lat": 26.1, "lng": 94.2, "verified": true, "source": "GPS", "active": true}""")
        c.updateVillage(2, VillagePatch(lat = 26.1, verified = true, source = "GPS"))
        assertEquals("""{"lat":26.1,"source":"GPS","verified":true}""", t.bodyOf())

        t.on("POST", "/api/villages/import", body = """{"added": 1, "updated": 2, "skipped_lines": [4], "skipped": 1}""")
        assertEquals(VillageImport(1, 2, 1, listOf(4)), c.importVillages("name,lat,lng\nA,26,94"))
        assertEquals("""{"csv":"name,lat,lng\nA,26,94"}""", t.bodyOf())

        t.on("POST", "/api/outbox/mark", body = """{"updated": 3}""")
        assertEquals(3, c.markMessages(listOf(1, 2, 3), "sent"))
        assertEquals("""{"ids":[1,2,3],"status":"sent"}""", t.bodyOf())

        t.on("GET", "/api/export.csv", body = "report_no,reported_ist\nHA-2611-0001,2026-11-19 10:00\n")
        assertEquals("report_no,reported_ist\nHA-2611-0001,2026-11-19 10:00\n", c.exportCsv(7))
        assertEquals("http://h:8000/api/export.csv?days=7", t.last.url)

        t.on("GET", "/api/admin/status", body = """{"sms": {"enabled": false, "mode": "manual", "host": ""},
            "storage": {"db_bytes": 1, "media_bytes": 2, "users": 3, "incidents": 4}, "outbox": {"manual": 2},
            "system": {}, "audit": [{"action": "unlock", "detail": "x", "by": null, "at": 5}]}""")
        val st = c.adminStatus()
        assertEquals(mapOf("manual" to 2), st.outbox)
        assertEquals(null, st.system.backups)
        assertEquals("unlock", st.audit.single().action)
    }
}
