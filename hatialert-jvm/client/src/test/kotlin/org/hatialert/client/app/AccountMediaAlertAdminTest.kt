package org.hatialert.client.app

import java.io.File
import java.nio.file.Files
import kotlin.io.encoding.Base64
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.hatialert.client.AlertSms
import org.hatialert.client.FakeTransport
import org.hatialert.client.Json
import org.hatialert.client.NearbyVillage
import org.hatialert.client.NewIncident
import org.hatialert.client.OutboxBatch
import org.hatialert.client.OutboxRecipient
import org.hatialert.core.IncidentType
import org.hatialert.core.MediaKind

class AccountMediaAlertAdminTest {
    private val t = FakeTransport().apply {
        on("GET", "/api/meta", body = Json.META)
        on("POST", "/api/auth/login", body = """{"token": "tok", "user": ${Json.USER}}""")
        on("GET", "/api/overview", body = Json.overview(""))
        on("POST", "/api/auth/logout", body = """{"ok": true}""")
    }
    private val store = MemorySettingsStore()
    private val app = AppController(store, Dispatchers.Unconfined, t)

    private val mustChange = Json.USER.replace("\"must_change_pin\": false", "\"must_change_pin\": true")
    private val officer = Json.USER.replace("\"role\": \"villager\"", "\"role\": \"officer\"")
    private val lenient = kotlinx.serialization.json.Json { ignoreUnknownKeys = true }

    private fun incident3() = lenient.decodeFromString(org.hatialert.client.Incident.serializer(), Json.incident(3))

    private val m4a = byteArrayOf(0, 0, 0, 0x20) + "ftypM4A ".toByteArray() + ByteArray(20)

    // --- account --------------------------------------------------------------------

    @Test
    fun temporaryPinGoesToTheNewPinScreenAndNowhereElse() = runBlocking {
        t.on("POST", "/api/auth/login", body = """{"token": "tok", "user": $mustChange}""")
        assertTrue(app.signIn("9000000001", "583920"))
        assertEquals(Screen.NewPin, app.state.value.screen)
        assertFalse(t.requests.any { it.url.endsWith("/api/overview") }, "home would be refused until a new PIN is chosen")
        app.navigate(Screen.Report)
        assertEquals(Screen.NewPin, app.state.value.screen)

        assertFalse(app.changePin("583920", "640913", "640914"))
        assertEquals("The two PINs don't match.", app.state.value.fieldErrors["pin2"])
        t.on("POST", "/api/me/pin", 400, """{"error": "That PIN is too easy to guess. Avoid repeated or running digits.", "field": "pin"}""")
        assertFalse(app.changePin("583920", "1234", "1234"))
        assertEquals("That PIN is too easy to guess. Avoid repeated or running digits.", app.state.value.fieldErrors["pin"])
        t.on("POST", "/api/me/pin", body = Json.USER)
        assertTrue(app.changePin("583920", "640913", "640913"))
        assertEquals(Screen.Home, app.state.value.screen)
        assertEquals("New PIN saved", app.state.value.message?.text)
        assertTrue(t.requests.any { it.url.endsWith("/api/overview") })
    }

    @Test
    fun resumingWithAPinDueOpensTheNewPinScreen() = runBlocking {
        store.save(Settings(token = "saved"))
        t.on("GET", "/api/me", body = mustChange)
        val again = AppController(store, Dispatchers.Unconfined, t)
        again.start()
        assertEquals(Screen.NewPin, again.state.value.screen)
    }

    @Test
    fun aPinResetWhileSignedInIsNoticed() = runBlocking {
        app.signIn("9000000001", "1111")
        t.on("GET", "/api/alerts", 403, """{"error": "Choose a new PIN first.", "field": "pin"}""")
        app.loadAlerts()
        assertEquals(Screen.NewPin, app.state.value.screen)
        assertTrue(app.state.value.user!!.mustChangePin)
        assertEquals("tok", store.load().token, "still signed in")
    }

    @Test
    fun signUpChecksThePinsAndSendsTheCodeOnlyWhenTextsAreOn() = runBlocking {
        app.loadMeta() // sms_enabled false
        app.navigate(Screen.Register)
        assertEquals(Screen.Register, app.state.value.screen)
        assertFalse(app.register("Akum", "9876543210", "Wozhuro", "408215", "408216", "123456"))
        assertEquals(AppController.PINS_DIFFER, app.state.value.fieldErrors["pin2"])
        assertFalse(t.requests.any { it.url.endsWith("/api/auth/register") })
        t.on("POST", "/api/auth/register", body = """{"token": "new", "user": ${Json.USER}}""")
        assertTrue(app.register("Akum", "9876543210", "Wozhuro", "408215", "408215", "123456"))
        assertFalse(t.bodyOf(t.requests.last { it.url.endsWith("/api/auth/register") })!!.contains("code"))
        assertEquals("new", store.load().token)
        assertEquals(Screen.Home, app.state.value.screen)
        assertEquals("Account created", app.state.value.message?.text)
    }

    @Test
    fun codeRequestShowsWhatTheServerSaid() = runBlocking {
        assertFalse(app.requestCode(" ", "reset"))
        assertEquals("Enter a 10-digit mobile number.", app.state.value.fieldErrors["phone"])
        t.on("POST", "/api/auth/otp", 409, """{"error": "Text messages aren't set up on this server. Ask a forest officer.", "field": null}""")
        assertFalse(app.requestCode("9876543210", "reset"))
        assertEquals("Text messages aren't set up on this server. Ask a forest officer.", app.state.value.authNote)
        t.on("POST", "/api/auth/otp", body = """{"sent": true, "message": "If this number can get texts, a 6-digit code is on its way."}""")
        assertTrue(app.requestCode("9876543210", "reset"))
        assertEquals("If this number can get texts, a 6-digit code is on its way.", app.state.value.authNote)
        app.navigate(Screen.SignIn)
        assertNull(app.state.value.authNote)
    }

    @Test
    fun forgotPinSignsIn() = runBlocking {
        t.on("POST", "/api/auth/reset", body = """{"token": "fresh", "user": ${Json.USER}}""")
        assertTrue(app.resetPin("9876543210", "123456", "719356", "719356"))
        assertEquals("fresh", store.load().token)
        assertEquals("New PIN saved", app.state.value.message?.text)
    }

    @Test
    fun otherDevicesAndTextAlerts() = runBlocking {
        app.signIn("9000000001", "1111")
        t.on("POST", "/api/me/logout-all", body = """{"ok": true}""")
        assertTrue(app.signOutOtherDevices())
        assertEquals("Other devices signed out", app.state.value.message?.text)
        t.on("PATCH", "/api/me", body = Json.USER.replace("\"sms_alerts\": true", "\"sms_alerts\": false"))
        assertTrue(app.setSmsAlerts(false))
        assertFalse(app.state.value.user!!.smsAlerts)
        assertEquals("Text alerts off", app.state.value.message?.text)
    }

    // --- photos and voice notes ------------------------------------------------------

    @Test
    fun downloadedFilesAreKeptUntilSignOut() = runBlocking {
        app.signIn("9000000001", "1111")
        t.on("GET", "/api/attachments/5", body = """{"id": 5, "kind": "voice", "mime": "audio/mp4", "size": 28, "data": "${Base64.encode(m4a)}"}""")
        assertContentEquals(m4a, app.attachmentBytes(5))
        assertContentEquals(m4a, app.attachmentBytes(5))
        assertEquals(1, t.requests.count { it.url.endsWith("/api/attachments/5") })
        app.signOut()
        app.signIn("9000000001", "1111")
        app.attachmentBytes(5)
        assertEquals(2, t.requests.count { it.url.endsWith("/api/attachments/5") }, "another sign-in fetches again")
    }

    @Test
    fun refusedFileShowsTheServersReason() = runBlocking {
        app.signIn("9000000001", "1111")
        t.on("GET", "/api/attachments/6", 403, """{"error": "Only the reporter and forest staff can see these files.", "field": null}""")
        assertNull(app.attachmentBytes(6))
        assertEquals("Only the reporter and forest staff can see these files.", app.state.value.message?.text)
    }

    @Test
    fun addingToACaseChecksTheLimitFirst() = runBlocking {
        app.signIn("9000000001", "1111")
        val two = """, "attachments": [{"id": 1, "kind": "voice", "mime": "audio/mp4", "size": 9, "created_at": 1},
            {"id": 2, "kind": "voice", "mime": "audio/ogg", "size": 9, "created_at": 1}]"""
        t.on("GET", "/api/incidents/3", body = Json.incident(3, extra = two).replace("\"attachments\": [], ", ""))
        app.openCase(3)
        assertEquals(2, app.state.value.detail!!.attachments.size)
        assertFalse(app.attachToCase(3, MediaKind.VOICE, m4a))
        assertEquals("A report can have up to 2 voice notes.", app.state.value.message?.text)
        assertFalse(app.attachToCase(3, MediaKind.PHOTO, m4a))
        assertEquals("Use a JPEG, PNG or WebP photo.", app.state.value.message?.text)
        assertFalse(t.requests.any { it.url.endsWith("/attachments") })
        t.on("POST", "/api/incidents/3/attachments", body = Json.incident(3))
        val jpeg = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte()) + ByteArray(10)
        assertTrue(app.attachToCase(3, MediaKind.PHOTO, jpeg))
        assertEquals("Photo added", app.state.value.message?.text)
        assertTrue(t.bodyOf()!!.startsWith("""{"kind":"photo","data":"/9j/4"""))
    }

    @Test
    fun voiceNotesGoWithTheReport() {
        val d = ReportDraft(type = IncidentType.SIGHTING, village = "Wozhuro", voices = listOf(m4a))
        val villages = AppState(Settings()).villages
        assertEquals(emptyMap(), d.validate(villages))
        assertEquals(listOf("voice"), d.toRequest().attachments!!.map { it.kind })
        assertEquals("A report can have up to 2 voice notes.", d.copy(voices = List(3) { m4a }).validate(villages)["attachments"])
        assertEquals("Use a recording in MP3, M4A, WebM, Ogg or WAV.", d.copy(voices = listOf("hello".toByteArray())).validate(villages)["attachments"])
        assertEquals("Each voice note must be under 2 MB.", d.copy(voices = listOf(m4a + ByteArray(2_000_000))).validate(villages)["attachments"])
    }

    @Test
    fun fileOutboxKeepsVoiceNotes() {
        val dir = Files.createTempDirectory("outbox-voice").toFile()
        try {
            val store = FileOutboxStore(dir)
            val jpeg = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte())
            val item = PendingReport.of(NewIncident(type = "sighting", village = "Wozhuro", clientId = "voice-0001"), listOf(jpeg), 1, 5, listOf(m4a))
            store.save(listOf(item))
            assertTrue(File(dir, "voice-0001-0.voice").isFile)
            val back = store.load().single()
            assertContentEquals(m4a, back.voices.single())
            assertEquals(listOf("photo", "voice"), back.toRequest().attachments!!.map { it.kind })
            store.save(emptyList())
            assertFalse(File(dir, "voice-0001-0.voice").exists())
            // An index written before voice notes existed still loads.
            File(dir, "outbox.json").writeText(
                """[{"client_id": "old-00001", "user_id": 1, "report": {"type": "sighting", "village": "Wozhuro"}, "photos": [], "queued_at": 1}]""",
            )
            assertEquals(emptyList(), store.load().single().voices)
        } finally {
            dir.deleteRecursively()
        }
    }

    // --- alerts ------------------------------------------------------------------------

    private suspend fun signInGuard() {
        t.on("POST", "/api/auth/login", body = """{"token": "tok", "user": ${Json.GUARD}}""")
        app.loadMeta()
        app.signIn("9000000002", "2222")
    }

    @Test
    fun warnNearbyFillsInTheAlert() = runBlocking {
        signInGuard()
        t.on("GET", "/api/incidents/3/villages", body = """[{"name": "Wozhuro", "km": 0.0, "dir": "N"}, {"name": "Wokha Town", "km": 1.6, "dir": "W"}]""")
        val inc = incident3()
        assertTrue(app.warnNearby(inc.copy(heading = "NE", place = "school")))
        assertEquals("http://10.0.2.2:8000/api/incidents/3/villages?km=5.0", t.requests.last().url)
        val d = app.state.value.alertDraft
        assertEquals(Screen.ComposeAlert, app.state.value.screen)
        assertEquals(setOf("Wozhuro", "Wokha Town"), d.villages)
        assertEquals("About 6 elephants reported near Wozhuro (school), moving NE. Keep away from the fields and stay indoors after dark.", d.message)
        assertEquals(3L, d.incidentId)

        t.on("POST", "/api/alerts", body = """{"id": 9, "level": "warning", "level_label": "Elephant warning", "message": "m", "villages": ["Wokha Town", "Wozhuro"],
            "incident_id": 3, "sent_at": 1, "sms": {"recipients": 1, "mode": "manual"}}""")
        t.on("GET", "/api/alerts", body = "[]")
        val sent = app.sendAlert()
        assertEquals(9L, sent?.id)
        assertTrue(t.bodyOf(t.requests.last { it.method == "POST" })!!.contains(""""villages":["Wokha Town","Wozhuro"]"""), "in the server's village order")
        assertEquals("Alert sent. 1 person to text by hand (Admin › Messages)", app.state.value.message?.text)
        assertEquals(Screen.Alerts, app.state.value.screen)
        assertEquals(AlertDraft(), app.state.value.alertDraft)
    }

    @Test
    fun alertFormChecks() {
        val known = listOf("Wozhuro", "Wokha Town")
        val e = AlertDraft(level = "panic", message = " ", villages = setOf("Atlantis")).validate(known)
        assertEquals(
            mapOf("level" to "Choose an alert type.", "message" to "This field is required.", "villages" to "Pick at least one village."),
            e,
        )
        assertEquals("Keep this under 400 characters.", AlertDraft(message = "x".repeat(401), villages = setOf("Wozhuro")).validate(known)["message"])
        assertEquals(emptyMap(), AlertDraft(message = "ok", villages = setOf("Wozhuro")).toggle("Wokha Town").validate(known))
        assertEquals(setOf("Wozhuro"), AlertDraft(villages = setOf("Wozhuro", "Wokha Town")).toggle("Wokha Town").villages)
        assertEquals("Alert sent", AlertDraft.sentNote(AlertSms(0, "manual")))
        assertEquals("Alert sent. Texting 3 people", AlertDraft.sentNote(AlertSms(3, "auto")))
        val near = AlertDraft.warningFor(
            incident3().copy(herdSize = 1),
            listOf(NearbyVillage("Wozhuro", 0.2, "N")),
        )
        assertEquals("About 1 elephant reported near Wozhuro. Keep away from the fields and stay indoors after dark.", near.message)
    }

    @Test
    fun villagersCantOpenStaffOrOfficerScreens() = runBlocking {
        app.signIn("9000000001", "1111")
        app.navigate(Screen.ComposeAlert)
        assertEquals(Screen.Home, app.state.value.screen)
        app.navigate(Screen.Admin(AdminSection.PEOPLE))
        assertEquals(Screen.Home, app.state.value.screen)
        app.navigate(Screen.Register)
        assertEquals(Screen.Home, app.state.value.screen)
    }

    // --- officer -----------------------------------------------------------------------

    @Test
    fun officerPeopleAndTemporaryPin() = runBlocking {
        t.on("POST", "/api/auth/login", body = """{"token": "tok", "user": $officer}""")
        app.signIn("9000000003", "3333")
        app.navigate(Screen.Admin(AdminSection.PEOPLE))
        assertEquals(Screen.Admin(AdminSection.PEOPLE), app.state.value.screen)
        val person = """{"id": 4, "name": "Akum", "phone": "9876543210", "village": "Wozhuro", "role": "villager", "failed_24h": 3}"""
        t.on("GET", "/api/users", body = "[$person]")
        app.admin.loadPeople(query = "Akum", role = "villager")
        assertEquals("http://10.0.2.2:8000/api/users?q=Akum&role=villager", t.last.url)
        assertEquals(3, app.state.value.admin.people.single().failed24h)
        t.on("POST", "/api/users/4/reset-pin", body = """{"temp_pin": "583920", "user": $person}""")
        app.admin.resetPin(4)
        assertEquals("583920", app.state.value.admin.tempPin?.tempPin)
        app.navigate(Screen.Admin(AdminSection.PEOPLE))
        assertEquals("583920", app.state.value.admin.tempPin?.tempPin, "still shown on the same screen")
        app.navigate(Screen.Admin(AdminSection.VILLAGES))
        assertNull(app.state.value.admin.tempPin, "shown once")
        t.on("POST", "/api/users/4/unlock", body = person)
        assertTrue(app.admin.unlock(4))
        assertEquals("Unlocked", app.state.value.message?.text)
        t.on("PATCH", "/api/users/4", body = person)
        assertTrue(app.admin.setActive(4, false))
        assertEquals("""{"active":false}""", t.bodyOf(t.requests.last { it.method == "PATCH" }))
        assertEquals("Account switched off", app.state.value.message?.text)
    }

    @Test
    fun villageFormChecksBeforeSending() = runBlocking {
        t.on("POST", "/api/auth/login", body = """{"token": "tok", "user": $officer}""")
        app.signIn("9000000003", "3333")
        val before = t.requests.size
        assertFalse(app.admin.addVillage(VillageForm(name = "L", lat = "", lng = "99", verified = true)))
        assertEquals(
            mapOf(
                "name" to "Enter the village name.", "lat" to "Enter a number.", "lng" to "Enter a value from 93.5 to 95.",
                "source" to "This field is required.",
            ),
            app.state.value.fieldErrors,
        )
        assertEquals(before, t.requests.size)
        assertEquals(
            "Say where the position comes from before marking it checked.",
            VillageForm(lat = "26.1", lng = "94.2", verified = true).validate(isNew = false)["source"],
        )
        assertEquals("Enter a value from 25.5 to 27.", VillageForm(lat = "27.01", lng = "94").validate(false)["lat"])

        t.on("POST", "/api/villages", body = """{"id": 9, "name": "Lotsu", "lat": 26.25, "lng": 94.1, "verified": true, "source": "Census"}""")
        t.on("GET", "/api/villages", body = """[{"id": 9, "name": "Lotsu", "lat": 26.25, "lng": 94.1, "verified": true, "source": "Census", "active": true, "people": 0, "incidents": 0}]""")
        assertTrue(app.admin.addVillage(VillageForm("Lotsu", "26.25", "94.1", "Census", verified = true)))
        assertEquals("""{"name":"Lotsu","lat":26.25,"lng":94.1,"source":"Census","verified":true}""", t.bodyOf(t.requests.last { it.method == "POST" }))
        assertEquals("Village added", app.state.value.message?.text)
        assertEquals(listOf("Lotsu"), app.state.value.admin.villages.map { it.name })
        assertTrue(t.requests.last().url.endsWith("/api/meta"), "the app's village list is reloaded")

        t.on("POST", "/api/villages/import", body = """{"added": 1, "updated": 0, "skipped_lines": [3, 5], "skipped": 2}""")
        app.admin.importVillages("name,lat,lng\nA,26,94")
        assertEquals("Skipped 2 lines with a problem: 3, 5", app.state.value.admin.importNote)
        assertEquals("Imported: 1 added, 0 updated", app.state.value.message?.text)
    }

    @Test
    fun markingTextsSentSendsOnlyTheHandSentOnes() = runBlocking {
        t.on("POST", "/api/auth/login", body = """{"token": "tok", "user": $officer}""")
        app.signIn("9000000003", "3333")
        val batch = OutboxBatch(
            1, "warning",
            recipients = listOf(OutboxRecipient(10, phone = "9000000001", status = "manual"), OutboxRecipient(11, phone = "9000000004", status = "sent")),
        )
        t.on("POST", "/api/outbox/mark", body = """{"updated": 1}""")
        t.on("GET", "/api/outbox", body = """{"mode": "manual", "batches": []}""")
        assertTrue(app.admin.markSent(batch))
        assertEquals("""{"ids":[10],"status":"sent"}""", t.bodyOf(t.requests.last { it.method == "POST" }))
        assertFalse(app.admin.retryFailed(batch), "nothing failed, nothing sent")
        assertEquals("To send by hand", messageStatusLabel("manual"))
    }

    @Test
    fun mediaCacheDropsTheOldestOverItsSize() {
        val c = MediaCache(maxBytes = 10)
        c.put(1, ByteArray(4))
        c.put(2, ByteArray(4))
        c.get(1) // 1 is now the most recent
        c.put(3, ByteArray(4))
        assertNull(c.get(2))
        assertEquals(setOf(1L, 3L), setOf(1L, 2L, 3L).filter { c.get(it) != null }.toSet())
        assertEquals(8, c.totalBytes)
        c.put(4, ByteArray(11))
        assertNull(c.get(4), "larger than the whole cache: not kept")
        c.clear()
        assertEquals(0 to 0L, c.size to c.totalBytes)
    }
}
