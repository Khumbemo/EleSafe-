package org.hatialert.client

import java.io.File
import java.io.IOException
import java.net.ServerSocket
import java.nio.file.Files
import java.util.concurrent.TimeUnit
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.hatialert.client.app.AdminData
import org.hatialert.client.app.AdminSection
import org.hatialert.client.app.AlertDraft
import org.hatialert.client.app.AlertWatch
import org.hatialert.client.app.MemorySeenAlertStore
import org.hatialert.client.app.PollOutcome
import org.hatialert.client.app.AppController
import org.hatialert.client.app.VillageForm
import org.hatialert.client.app.plural
import org.hatialert.core.MediaKind
import org.hatialert.client.app.FileOutboxStore
import org.hatialert.client.app.MemorySettingsStore
import org.hatialert.client.app.Screen
import org.hatialert.client.app.Settings
import org.hatialert.client.app.nearbyIncidents
import org.hatialert.core.Geo
import org.hatialert.core.IncidentType
import org.hatialert.core.Ist
import org.hatialert.core.Role
import org.hatialert.core.Status
import org.hatialert.core.Villages
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.MethodOrderer
import org.junit.jupiter.api.Order
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.junit.jupiter.api.TestMethodOrder

/**
 * Starts the real hatialert-py server (`python -m hatialert --db <tmp> --port <free>`)
 * and drives it through [HatiClient] over [UrlConnectionTransport], the same
 * code path the Android app uses. Skipped when Python 3.10+ or hatialert-py is missing.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation::class)
class PythonServerIntegrationTest {
    private var server: Process? = null
    private lateinit var base: String
    private lateinit var dir: File
    private lateinit var python: String
    private var port = 0
    private var reportId = 0L

    private val jpeg = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte()) + ByteArray(60)

    @BeforeAll
    fun startServer() {
        val pyDir = File(System.getProperty("hatialert.py.dir", "../../hatialert-py"))
        assumeTrue(File(pyDir, "hatialert/__main__.py").isFile, "hatialert-py not found at $pyDir")
        val py = findPython()
        assumeTrue(py != null, "Python 3.10+ not found; skipping the server integration test")
        python = py!!
        dir = Files.createTempDirectory("hatialert-it").toFile()
        port = ServerSocket(0).use { it.localPort }
        base = "http://127.0.0.1:$port"
        launch()
    }

    private val log get() = File(dir, "server.log")

    /**
     * Starts the server on [port] with the same database and waits until it answers. Texts are
     * on in debug mode (HATIALERT_SMS_DEBUG=1): the server prints them, one-time codes included,
     * to its log, where [codeFor] reads them as the browser tests do.
     */
    private fun launch() {
        server = startServer(File(dir, "hatialert.db"), port, log, sms = true)
    }

    private fun startServer(db: File, port: Int, log: File, sms: Boolean): Process {
        val pyDir = File(System.getProperty("hatialert.py.dir", "../../hatialert-py"))
        val pb = ProcessBuilder(python, "-m", "hatialert", "--db", db.path, "--host", "127.0.0.1", "--port", "$port")
            .directory(pyDir)
            .redirectErrorStream(true)
            .redirectOutput(ProcessBuilder.Redirect.appendTo(log))
        pb.environment().remove("HATIALERT_SMS_URL")
        if (sms) pb.environment()["HATIALERT_SMS_DEBUG"] = "1" else pb.environment().remove("HATIALERT_SMS_DEBUG")
        pb.environment()["PYTHONUNBUFFERED"] = "1"
        val proc = pb.start()
        val probe = HatiClient("http://127.0.0.1:$port", UrlConnectionTransport(connectTimeoutMs = 500, readTimeoutMs = 2000))
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(60)
        while (true) {
            try {
                probe.meta()
                return proc
            } catch (e: NetworkException) {
                check(proc.isAlive) { "server exited: " + log.readText() }
                check(System.nanoTime() < deadline) { "server did not start: " + log.readText() }
                Thread.sleep(200)
            }
        }
    }

    private fun codes(phone: String): List<String> =
        Regex("""\[SMS to \+91$phone] HatiAlert code: (\d{6})""").findAll(log.readText()).map { it.groupValues[1] }.toList()

    /** The newest texted code for [phone], waiting for the [n]th one to reach the log. */
    private fun codeFor(phone: String, n: Int): String {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20)
        while (true) {
            val all = codes(phone)
            if (all.size >= n) return all[n - 1]
            check(System.nanoTime() < deadline) { "no code for $phone in the server log: " + log.readText().takeLast(2000) }
            Thread.sleep(100)
        }
    }

    private fun stop() {
        server?.let { kill(it) }
        server = null
    }

    private fun kill(p: Process) {
        p.destroy()
        if (!p.waitFor(10, TimeUnit.SECONDS)) p.destroyForcibly().waitFor(10, TimeUnit.SECONDS)
    }

    @AfterAll
    fun stopServer() {
        stop()
        if (::dir.isInitialized) dir.deleteRecursively()
    }

    private fun client() = HatiClient(base)

    @Test
    @Order(1)
    fun metaMatchesCore() {
        val meta = client().meta()
        assertEquals(listOf("9000000001", "9000000002", "9000000003"), meta.demoAccounts.map { it.phone })
        assertEquals(Villages.SEED.map { Triple(it.name, it.lat, it.lng) }, meta.villages.map { Triple(it.name, it.lat, it.lng) })
        assertEquals(IncidentType.entries.map { it.key() }, meta.types.map { it.key })
        for (s in Status.entries) assertEquals(s.transitions().map { it.key() }, meta.transitions[s.key()], s.key())
    }

    @Test
    @Order(2)
    fun villagerSignsInListsAndReports() {
        val vil = client()
        val session = vil.login("9000000001", "1111")
        assertEquals("villager", session.user.role)
        assertEquals("Wozhuro", vil.me().village)

        val open = vil.incidents()
        assertTrue(open.isNotEmpty(), "demo data has open incidents")
        assertTrue(open.all { it.open })

        // Home: distance and direction worked out by :core equal the server's.
        val ov = vil.overview()
        val mine = nearbyIncidents(ov.village, ov.radiusKm, vil.incidents())
        assertEquals(ov.nearby.map { Triple(it.id, it.km, it.dir) }, mine.map { Triple(it.incident.id, it.km, it.dir) })

        val report = NewIncident(
            type = "crop_raid", village = "Wozhuro", herdSize = 6, offsetKm = 1.0, offsetDir = "NE",
            description = "Paddy trampled near the stream", clientId = "jvm-it-0001",
            attachments = listOf(NewAttachment("photo", kotlin.io.encoding.Base64.encode(jpeg))),
        )
        val inc = vil.createIncident(report)
        reportId = inc.id
        assertEquals("high", inc.severity)
        assertEquals(org.hatialert.core.Severity.classify("crop_raid", 6, 0).key(), inc.severity)
        assertEquals("reported", inc.status)
        assertEquals(Ist.reference(inc.id, inc.createdAt), inc.ref)
        val w = Villages.byName("Wozhuro")
        val want = Geo.destination(w.lat, w.lng, 1.0, "NE")
        assertEquals(want.lat, inc.lat, 0.0)
        assertEquals(want.lng, inc.lng, 0.0)
        assertEquals(listOf("image/jpeg"), inc.attachments.map { it.mime })
        assertEquals(listOf("reported"), inc.events!!.map { it.status })
        assertEquals(emptyList(), inc.next)

        // A resend after a dropped connection returns the same case.
        assertEquals(inc.id, vil.createIncident(report).id)

        val e = assertFailsWith<ApiException> { vil.updateStatus(inc.id, "verified") }
        assertEquals(403, e.status)
        val bad = assertFailsWith<ApiException> { vil.createIncident(report.copy(clientId = null, type = "party")) }
        assertEquals(400 to "type", bad.status to bad.field)
    }

    @Test
    @Order(3)
    fun guardAndOfficerMoveTheCase() {
        val guard = client()
        guard.login("9000000002", "2222")
        val verified = guard.updateStatus(reportId, "verified", "Tracks seen")
        assertEquals("verified", verified.status)
        assertEquals(Status.VERIFIED.nextFor(Role.GUARD).map { it.key() }, verified.next)
        assertEquals("Tracks seen", verified.events!!.last().note)
        assertNotNull(verified.reporter) // staff see the reporter
        assertEquals(409, assertFailsWith<ApiException> { guard.updateStatus(reportId, "resolved") }.status)
        guard.updateStatus(reportId, "responded")
        assertEquals(403, assertFailsWith<ApiException> { guard.updateStatus(reportId, "resolved") }.status)
        assertTrue(guard.nearbyVillages(reportId, 5.0).any { it.name == "Wozhuro" })
        guard.logout()

        val officer = client()
        officer.login("9000000003", "3333")
        val done = officer.updateStatus(reportId, "resolved", "Herd moved back to the forest")
        assertEquals(listOf("reported", "verified", "responded", "resolved"), done.events!!.map { it.status })
        assertEquals(false, done.open)
        officer.logout()
    }

    @Test
    @Order(4)
    fun villagerSeesOutcomeAlertsAndSignsOut() {
        val vil = client()
        vil.login("9000000001", "1111")
        val mine = vil.incidents(status = "all", mine = true)
        assertEquals("resolved", mine.first { it.id == reportId }.status)
        assertTrue(vil.alerts().isNotEmpty(), "demo data has alerts")
        assertEquals(403, assertFailsWith<ApiException> { vil.incidents(status = "closed") }.status)
        val token = vil.token
        vil.logout()
        val stale = HatiClient(base, token = token)
        assertEquals(401, assertFailsWith<ApiException> { stale.me() }.status)
    }

    @Test
    @Order(5)
    fun appControllerEndToEnd() = runBlocking {
        val store = MemorySettingsStore(Settings(serverUrl = base))
        val app = AppController(store, Dispatchers.IO)
        app.start()
        assertEquals(Screen.SignIn, app.state.value.screen)
        assertTrue(app.signIn("9000000002", "2222"), app.state.value.message?.text ?: "")
        assertEquals(Screen.Home, app.state.value.screen)
        app.loadCases()
        assertTrue(app.state.value.cases.any { it.id == reportId }, "staff see every case")
        app.editDraft { it.copy(type = IncidentType.SIGHTING, herdSize = "3", village = "Baghty", offsetKm = "0.5", offsetDir = "S") }
        val inc = app.submitReport()
        assertNotNull(inc, app.state.value.message?.text)
        assertEquals("low", inc.severity)
        assertEquals(Screen.CaseDetail(inc.id), app.state.value.screen)
        assertTrue(app.changeStatus(inc.id, "false_report", "Cattle, not elephants"))
        assertEquals("false_report", app.state.value.detail!!.status)
        app.loadAlerts()
        assertTrue(app.state.value.alerts.isNotEmpty())
        app.signOut()
        assertEquals(Screen.SignIn, app.state.value.screen)
        assertEquals(null, store.load().token)
    }

    @Test
    @Order(6)
    fun reportSavedWhileServerIsDownIsSentOnceWhenItIsBack() = runBlocking {
        val outbox = FileOutboxStore(File(dir, "outbox"))
        val app = AppController(MemorySettingsStore(Settings(serverUrl = base)), Dispatchers.IO, outbox = outbox)
        assertTrue(app.signIn("9000000001", "1111"), app.state.value.message?.text ?: "")
        val marker = "Offline queue check ${System.nanoTime()}"
        app.editDraft {
            it.copy(type = IncidentType.CROP_RAID, herdSize = "2", village = "Wozhuro", offsetKm = "0.3", offsetDir = "W", description = marker, photos = listOf(jpeg))
        }
        val clientId = app.state.value.draft.clientId

        stop() // the phone loses the server
        assertEquals(null, app.submitReport())
        assertEquals(AppController.SAVED_OFFLINE, app.state.value.message?.text)
        assertEquals(1, app.state.value.pendingReports)
        assertEquals(0, app.flushOutbox(), "still down: nothing sent, nothing lost")
        assertEquals(listOf(clientId), outbox.load().map { it.clientId })

        launch() // back online, same database
        app.refreshHome() // flushes, as on start, sign-in and when the network returns
        assertEquals(0, app.state.value.pendingReports, app.state.value.message?.text)
        assertEquals(emptyList(), outbox.load())
        assertTrue(app.state.value.message!!.text.startsWith("Saved report sent. Your report number is HA-"), app.state.value.message!!.text)

        val vil = client()
        vil.login("9000000001", "1111")
        val made = vil.incidents(status = "all", mine = true).filter { it.description == marker }
        assertEquals(1, made.size, "exactly one incident")
        assertEquals(listOf("image/jpeg"), vil.incident(made[0].id).attachments.map { it.mime })

        // The answer lost on the way back: the same queued report sent again is the same case.
        val again = org.hatialert.client.app.PendingReport.of(
            NewIncident(type = "crop_raid", village = "Wozhuro", herdSize = 2, offsetKm = 0.3, offsetDir = "W", description = marker, clientId = clientId),
            listOf(jpeg), vil.me().id,
        )
        outbox.save(listOf(again))
        assertEquals(1, app.flushOutbox())
        assertEquals(1, vil.incidents(status = "all", mine = true).count { it.description == marker }, "client_id de-duplicated the resend")
        app.signOut()
    }

    // --- account, media, alerts and admin -------------------------------------------------

    private val newPhone = "9876543210"
    private var newPin = "408215"
    private var guardCase = 0L

    @Test
    @Order(7)
    fun registerWithTextedCodeAndForgotPin() = runBlocking {
        assertTrue(client().meta().smsEnabled)
        val c = client()
        val sent = c.requestCode(newPhone, "register")
        assertEquals("If this number can get texts, a 6-digit code is on its way.", sent.message)
        val code = codeFor(newPhone, 1)

        val weak = assertFailsWith<ApiException> { c.register("Akum Jamir", newPhone, "Wozhuro", "1234", code) }
        assertEquals(400 to "pin", weak.status to weak.field)
        assertEquals("That PIN is too easy to guess. Avoid repeated or running digits.", weak.message)
        assertEquals("Choose a PIN of 4 to 6 digits.", assertFailsWith<ApiException> { c.register("Akum Jamir", newPhone, "Wozhuro", "12a", code) }.message)
        val wrong = assertFailsWith<ApiException> { c.register("Akum Jamir", newPhone, "Wozhuro", newPin, if (code == "000000") "111111" else "000000") }
        assertEquals("That code isn't right." to "code", wrong.message to wrong.field)

        val s = c.register("Akum Jamir", newPhone, "Wozhuro", newPin, code)
        assertEquals("villager", s.user.role)
        assertTrue(s.user.phoneVerified, "a texted code verifies the number")
        assertEquals(409, assertFailsWith<ApiException> { client().requestCode(newPhone, "register") }.status)

        // Forgot PIN, through the app layer.
        val app = AppController(MemorySettingsStore(Settings(serverUrl = base)), Dispatchers.IO)
        app.loadMeta()
        app.navigate(Screen.ForgotPin)
        assertEquals(Screen.ForgotPin, app.state.value.screen)
        assertTrue(app.requestCode(newPhone, "reset"))
        assertEquals("If this number can get texts, a 6-digit code is on its way.", app.state.value.authNote)
        val resetCode = codeFor(newPhone, 2)
        assertTrue(!app.resetPin(newPhone, resetCode, "719356", "719357"))
        assertEquals(AppController.PINS_DIFFER, app.state.value.fieldErrors["pin2"])
        assertTrue(app.resetPin(newPhone, resetCode, "719356", "719356"), app.state.value.message?.text)
        newPin = "719356"
        assertEquals(Screen.Home, app.state.value.screen)
        assertEquals("New PIN saved", app.state.value.message?.text)
        assertEquals(401, assertFailsWith<ApiException> { c.me() }.status, "a PIN reset ends the other sessions")
        assertEquals(401, assertFailsWith<ApiException> { client().login(newPhone, "408215") }.status)
        client().login(newPhone, newPin)
        app.signOut()
    }

    @Test
    @Order(8)
    fun changePinAndSignOutOtherDevices() {
        val a = client()
        a.login(newPhone, newPin)
        val b = client()
        b.login(newPhone, newPin)
        assertEquals("Your current PIN isn't right." to "old_pin", assertFailsWith<ApiException> { a.changePin("000000", "582947") }.let { it.message to it.field })
        assertEquals("Choose a PIN different from the old one.", assertFailsWith<ApiException> { a.changePin(newPin, newPin) }.message)
        assertEquals(400 to "pin", assertFailsWith<ApiException> { a.changePin(newPin, "1111") }.let { it.status to it.field })
        val u = a.changePin(newPin, "582947")
        newPin = "582947"
        assertEquals(false, u.mustChangePin)
        assertEquals(401, assertFailsWith<ApiException> { b.me() }.status, "changing the PIN signs out the other devices")
        assertEquals(newPhone, a.me().phone)

        val c = client()
        c.login(newPhone, newPin)
        a.logoutAll()
        assertEquals(401, assertFailsWith<ApiException> { c.me() }.status)
        assertEquals(newPhone, a.me().phone, "this device stays signed in")

        val off = a.updateMe(ProfileUpdate(smsAlerts = false))
        assertEquals(false, off.smsAlerts)
        assertEquals(true, a.updateMe(ProfileUpdate(smsAlerts = true)).smsAlerts)
        a.logout()
    }

    @Test
    @Order(9)
    fun officerResetForcesANewPin() = runBlocking {
        val officer = client()
        officer.login("9000000003", "3333")
        val akum = officer.users(q = "Akum").single()
        val reset = officer.resetUserPin(akum.id)
        assertTrue(Regex("\\d{6}").matches(reset.tempPin), reset.tempPin)
        assertTrue(reset.user.mustChangePin)

        val raw = client()
        assertTrue(raw.login(newPhone, reset.tempPin).user.mustChangePin)
        val blocked = assertFailsWith<ApiException> { raw.overview() }
        assertEquals(Triple(403, "pin", "Choose a new PIN first."), Triple(blocked.status, blocked.field, blocked.message))

        val app = AppController(MemorySettingsStore(Settings(serverUrl = base)), Dispatchers.IO)
        assertTrue(app.signIn(newPhone, reset.tempPin))
        assertEquals(Screen.NewPin, app.state.value.screen)
        app.navigate(Screen.Cases)
        assertEquals(Screen.NewPin, app.state.value.screen, "nothing else until a new PIN is chosen")
        assertTrue(app.changePin(reset.tempPin, "640913", "640913"), app.state.value.message?.text)
        newPin = "640913"
        assertEquals(Screen.Home, app.state.value.screen)
        assertEquals(false, app.state.value.user!!.mustChangePin)
        assertNotNull(app.state.value.overview)
        app.signOut()

        // Locked out by wrong PINs, then unlocked.
        repeat(2) { assertFailsWith<ApiException> { client().login(newPhone, "999999") } }
        assertTrue(officer.users(q = newPhone).single().failed24h >= 2)
        assertEquals(0, officer.unlockUser(akum.id).failed24h)

        // Role and switching off.
        assertEquals("guard", officer.updateUser(akum.id, UserPatch(role = "guard")).role)
        assertEquals("villager", officer.updateUser(akum.id, UserPatch(role = "villager")).role)
        assertEquals(false, officer.updateUser(akum.id, UserPatch(active = false)).active)
        assertEquals("This account is switched off. Contact the forest office.", assertFailsWith<ApiException> { client().login(newPhone, newPin) }.message)
        assertEquals(true, officer.updateUser(akum.id, UserPatch(active = true)).active)
        client().login(newPhone, newPin)
        val me = officer.me()
        assertEquals(400, assertFailsWith<ApiException> { officer.updateUser(me.id, UserPatch(role = "guard")) }.status)
        officer.logout()
    }

    private val m4a = byteArrayOf(0, 0, 0, 0x20) + "ftypM4A ".toByteArray() + ByteArray(200) { (it % 7).toByte() }
    private val ogg = "OggS".toByteArray() + ByteArray(120) { 1 }

    @Test
    @Order(10)
    fun voiceNotesAndPhotosUpAndDown() = runBlocking {
        val app = AppController(MemorySettingsStore(Settings(serverUrl = base)), Dispatchers.IO)
        assertTrue(app.signIn("9000000001", "1111"))
        val photo = jpeg + ByteArray(30) { 9 }
        app.editDraft {
            it.copy(type = IncidentType.CROP_RAID, herdSize = "6", village = "Wozhuro", offsetKm = "1", offsetDir = "N", photos = listOf(photo), voices = listOf(m4a))
        }
        val inc = assertNotNull(app.submitReport(), app.state.value.message?.text)
        guardCase = inc.id
        assertEquals(listOf("photo" to "image/jpeg", "voice" to "audio/mp4"), inc.attachments.map { it.kind to it.mime })

        assertTrue(app.attachToCase(inc.id, MediaKind.VOICE, ogg), app.state.value.message?.text)
        assertEquals("Voice note added", app.state.value.message?.text)
        assertEquals(listOf("photo", "voice", "voice"), app.state.value.detail!!.attachments.map { it.kind })
        assertTrue(!app.attachToCase(inc.id, MediaKind.VOICE, m4a))
        assertEquals("A report can have up to 2 voice notes.", app.state.value.message?.text)

        val ids = app.state.value.detail!!.attachments.map { it.id }
        assertTrue(photo.contentEquals(app.attachmentBytes(ids[0])))
        assertTrue(m4a.contentEquals(app.attachmentBytes(ids[1])))
        assertTrue(ogg.contentEquals(app.attachmentBytes(ids[2])))

        val vil = client()
        vil.login("9000000001", "1111")
        assertEquals("A report can have up to 2 voice notes.", assertFailsWith<ApiException> { vil.addAttachment(inc.id, "voice", m4a) }.message)
        assertEquals(415 to "Use a JPEG, PNG or WebP photo.", assertFailsWith<ApiException> { vil.addAttachment(inc.id, "photo", m4a) }.let { it.status to it.message })
        assertEquals("Use a recording in MP3, M4A, WebM, Ogg or WAV.", assertFailsWith<ApiException> { client().apply { login("9000000002", "2222") }.addAttachment(inc.id, "voice", "<html>".toByteArray()) }.message)

        // Staff see and fetch the files; another villager sees only how many there are.
        val guard = client()
        guard.login("9000000002", "2222")
        assertTrue(ogg.contentEquals(guard.attachmentBytes(ids[2])))
        val other = client()
        other.login(newPhone, newPin)
        val seen = other.incident(inc.id)
        assertEquals(emptyList(), seen.attachments)
        assertEquals(3, seen.attachmentsHidden)
        assertEquals("Only the reporter and forest staff can see these files.", assertFailsWith<ApiException> { other.attachment(ids[0]) }.message)
        app.signOut()
    }

    @Test
    @Order(11)
    fun guardWarnsNearbyVillages() = runBlocking {
        val app = AppController(MemorySettingsStore(Settings(serverUrl = base)), Dispatchers.IO)
        assertTrue(app.signIn("9000000002", "2222"))
        app.openCase(guardCase)
        val case = app.state.value.detail!!
        assertTrue(app.warnNearby(case))
        val st = app.state.value
        assertEquals(Screen.ComposeAlert, st.screen)
        val near = client().apply { login("9000000002", "2222") }.nearbyVillages(guardCase, 5.0)
        assertEquals(near.map { it.name }.toSet(), st.alertDraft.villages)
        assertTrue("Wozhuro" in st.alertDraft.villages)
        assertEquals(guardCase, st.alertDraft.incidentId)
        assertTrue(st.alertDraft.message.startsWith("About 6 elephants reported near Wozhuro."), st.alertDraft.message)

        val sent = assertNotNull(app.sendAlert(), app.state.value.message?.text)
        assertEquals("debug", sent.sms?.mode)
        assertEquals(guardCase, sent.incidentId)
        assertEquals(Screen.Alerts, app.state.value.screen)
        assertEquals(AlertDraft.sentNote(sent.sms), app.state.value.message?.text)
        assertEquals(sent.id, app.state.value.alerts.first().id)
        assertTrue(sent.sms!!.recipients >= 2, "the villager and Akum in Wozhuro get texts")

        app.composeAlert()
        app.editAlert { it.copy(message = "Herd near the school") }
        assertEquals(null, app.sendAlert())
        assertEquals("Pick at least one village.", app.state.value.fieldErrors["villages"])
        app.signOut()

        val vil = AppController(MemorySettingsStore(Settings(serverUrl = base)), Dispatchers.IO)
        assertTrue(vil.signIn("9000000001", "1111"))
        vil.composeAlert(AlertDraft(message = "x", villages = setOf("Wozhuro")))
        assertEquals(Screen.Home, vil.state.value.screen, "villagers can't open the alert form")
        vil.signOut()
    }

    @Test
    @Order(12)
    fun officerAdmin() = runBlocking {
        val o = client()
        o.login("9000000003", "3333")
        val people = o.users()
        assertTrue(people.map { it.phone }.containsAll(listOf("9000000001", "9000000002", "9000000003", newPhone)))
        assertEquals(listOf("9000000002"), o.users(role = "guard").map { it.phone })
        assertEquals(listOf("Officer Kikon"), o.users(q = "Officer").map { it.name })

        val added = o.addVillage(NewVillage("Lotsu", 26.25, 94.1, "Census 2011", verified = true))
        assertEquals(true, added.verified)
        assertEquals(409, assertFailsWith<ApiException> { o.addVillage(NewVillage("Lotsu", 26.25, 94.1)) }.status)
        assertTrue(o.meta().villages.any { it.name == "Lotsu" })
        val lat = assertFailsWith<ApiException> { o.updateVillage(added.id, VillagePatch(lat = 30.0)) }
        assertEquals("Enter a value from 25.5 to 27." to "lat", lat.message to lat.field)
        assertEquals(VillageForm(lat = "30", lng = "94.1").validate(isNew = false)["lat"], lat.message)
        val src = assertFailsWith<ApiException> { o.updateVillage(added.id, VillagePatch(source = "")) }
        assertEquals("Say where the position comes from before marking it checked.", src.message)
        val hidden = o.updateVillage(added.id, VillagePatch(lat = 26.26, active = false))
        assertEquals(26.26 to false, hidden.lat to hidden.active)
        assertTrue(o.meta().villages.none { it.name == "Lotsu" })
        assertTrue(o.adminVillages().any { it.name == "Lotsu" && !it.active })
        o.updateVillage(added.id, VillagePatch(active = true))
        val imp = o.importVillages("name,lat,lng,source\nChudi,26.21,94.18,GPS by guard\nBad,99,1,x\n")
        assertEquals(Triple(1, 0, listOf(3)), Triple(imp.added, imp.updated, imp.skippedLines))

        val box = o.outbox()
        assertEquals("debug", box.mode)
        val batch = box.batches.first()
        assertEquals("warning", batch.level)
        assertTrue(batch.recipients.isNotEmpty())
        // In debug mode the server "sends" them itself (prints them); only texts to send by hand
        // or failed ones can be marked, so marking these changes nothing.
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20)
        while (o.outbox().batches.first().counts != mapOf("sent" to batch.recipients.size)) {
            check(System.nanoTime() < deadline) { "alert texts not sent: " + o.outbox().batches.first().counts }
            Thread.sleep(100)
        }
        assertEquals(0, o.markMessages(batch.recipients.map { it.id }, "sent"))

        val status = o.adminStatus()
        assertEquals(SmsStatus(true, "debug", ""), status.sms)
        assertTrue(status.storage.users >= 4 && status.storage.mediaBytes > 0)
        assertTrue(status.audit.map { it.action }.containsAll(listOf("village_add", "pin_reset", "unlock", "village_import")))
        assertEquals(14, status.system.backups?.keep)

        val stats = o.stats(30)
        assertEquals(30, stats.series.size)
        assertTrue(stats.total > 0 && stats.byType.sumOf { it.count } == stats.total)
        assertTrue(o.exportCsv(30).startsWith("report_no,reported_ist,type,"))

        // The same through the app layer.
        val app = AppController(MemorySettingsStore(Settings(serverUrl = base)), Dispatchers.IO)
        assertTrue(app.signIn("9000000003", "3333"))
        for (section in AdminSection.entries) {
            app.navigate(Screen.Admin(section))
            app.admin.load(section)
        }
        val a = app.state.value.admin
        assertEquals(Screen.Admin(AdminSection.SYSTEM), app.state.value.screen)
        assertNotNull(a.stats)
        assertTrue(a.people.isNotEmpty() && a.villages.any { it.name == "Chudi" } && a.outbox != null && a.status != null)
        app.admin.loadPeople(query = "Akum")
        val akum = app.state.value.admin.people.single()
        assertNotNull(app.admin.resetPin(akum.id))
        assertEquals(akum.id, app.state.value.admin.tempPin?.user?.id)
        assertTrue(app.state.value.admin.people.single().mustChangePin)
        assertTrue(!app.admin.addVillage(VillageForm(name = "X", lat = "26.1", lng = "94.1")))
        assertEquals("Enter the village name.", app.state.value.fieldErrors["name"])
        assertTrue(app.admin.addVillage(VillageForm(name = "Pangti", lat = "26.18", lng = "94.33", source = "GPS by guard", verified = true)))
        assertTrue(app.state.value.villages.any { it.name == "Pangti" }, "the app's village list is refreshed")
        val pangti = app.state.value.admin.villages.first { it.name == "Pangti" }
        assertTrue(app.admin.saveVillage(pangti.id, VillageForm.of(pangti).copy(verified = false, source = "")))
        assertEquals(false, app.state.value.admin.villages.first { it.name == "Pangti" }.verified)
        assertTrue(app.admin.exportCsv(7)!!.startsWith("report_no,"))
        app.signOut()
        assertEquals(AdminData(), app.state.value.admin, "admin data is dropped on sign-out")
        o.logout()
    }

    @Test
    @Order(13)
    fun villagersAndGuardsAreRefusedStaffAndOfficerCalls() {
        val vil = client()
        vil.login("9000000001", "1111")
        val staffOnly = "Only forest staff can do this."
        val officerOnly = "Only forest officers can do this."
        val calls: List<Pair<String, () -> Unit>> = listOf(
            staffOnly to { vil.sendAlert(NewAlert("warning", "x", listOf("Wozhuro"))) },
            staffOnly to { vil.nearbyVillages(guardCase) },
            staffOnly to { vil.updateStatus(guardCase, "verified") },
            officerOnly to { vil.users() },
            officerOnly to { vil.updateUser(1, UserPatch(role = "officer")) },
            officerOnly to { vil.resetUserPin(2) },
            officerOnly to { vil.unlockUser(2) },
            officerOnly to { vil.adminVillages() },
            officerOnly to { vil.addVillage(NewVillage("Nope", 26.2, 94.2)) },
            officerOnly to { vil.updateVillage(1, VillagePatch(active = false)) },
            officerOnly to { vil.importVillages("name,lat,lng\nNope,26.2,94.2") },
            officerOnly to { vil.outbox() },
            officerOnly to { vil.markMessages(listOf(1), "sent") },
            officerOnly to { vil.adminStatus() },
            officerOnly to { vil.stats() },
            officerOnly to { vil.exportCsv() },
        )
        for ((msg, call) in calls) {
            val e = assertFailsWith<ApiException> { call() }
            assertEquals(403 to msg, e.status to e.message)
        }
        val guard = client()
        guard.login("9000000002", "2222")
        for (call in listOf({ guard.users() }, { guard.stats() }, { guard.adminStatus() }, { guard.outbox() })) {
            assertEquals(403 to officerOnly, assertFailsWith<ApiException> { call() }.let { it.status to it.message })
        }
    }

    @Test
    @Order(14)
    fun serverWithoutTextMessages() = runBlocking {
        val p2 = ServerSocket(0).use { it.localPort }
        val log2 = File(dir, "plain.log")
        val proc = startServer(File(dir, "plain.db"), p2, log2, sms = false)
        try {
            val url = "http://127.0.0.1:$p2"
            assertEquals(false, HatiClient(url).meta().smsEnabled)
            val e = assertFailsWith<ApiException> { HatiClient(url).requestCode(newPhone, "register") }
            assertEquals(409 to "Text messages aren't set up on this server. Ask a forest officer.", e.status to e.message)
            assertEquals(
                "Text messages aren't set up on this server. Ask a forest officer to reset your PIN.",
                assertFailsWith<ApiException> { HatiClient(url).resetPin(newPhone, "123456", "582947") }.message,
            )

            val app = AppController(MemorySettingsStore(Settings(serverUrl = url)), Dispatchers.IO)
            app.loadMeta()
            assertTrue(!app.requestCode(newPhone, "reset"))
            assertEquals("Text messages aren't set up on this server. Ask a forest officer.", app.state.value.authNote)
            // Without texts, sign-up needs no code (and the number stays unverified).
            assertTrue(app.register("Akum Jamir", newPhone, "Wozhuro", "408215", "408215", null), app.state.value.message?.text)
            assertEquals("Account created", app.state.value.message?.text)
            assertEquals(false, app.state.value.user!!.phoneVerified)
            app.signOut()

            val guard = AppController(MemorySettingsStore(Settings(serverUrl = url)), Dispatchers.IO)
            assertTrue(guard.signIn("9000000002", "2222"))
            guard.composeAlert(AlertDraft(message = "Herd near Wozhuro", villages = setOf("Wozhuro")))
            val sent = assertNotNull(guard.sendAlert())
            assertEquals("manual", sent.sms?.mode)
            assertEquals("Alert sent. ${plural(sent.sms!!.recipients, "person", "people")} to text by hand (Admin › Messages)", guard.state.value.message?.text)
            guard.signOut()

            val officer = AppController(MemorySettingsStore(Settings(serverUrl = url)), Dispatchers.IO)
            assertTrue(officer.signIn("9000000003", "3333"))
            officer.admin.loadOutbox()
            val box = officer.state.value.admin.outbox!!
            assertEquals("manual", box.mode)
            val batch = box.batches.first { it.alertId == sent.id }
            assertEquals(mapOf("manual" to sent.sms.recipients), batch.counts)
            assertTrue(officer.admin.markSent(batch))
            assertEquals(mapOf("sent" to sent.sms.recipients), officer.state.value.admin.outbox!!.batches.first { it.alertId == sent.id }.counts)
            assertTrue(!officer.admin.retryFailed(batch), "nothing failed")
            officer.signOut()
        } finally {
            kill(proc)
        }
    }

    /**
     * The background warning check (Android's WorkManager job) against the real server: a
     * guard's warning to the villager's village gives exactly one notification, the next check
     * none; a warning for another village, an information message and an all-clear give none.
     */
    @Test
    @Order(15)
    fun warningNotificationsAreShownOnce() {
        val vil = client()
        vil.login("9000000001", "1111")
        val watch = AlertWatch(MemorySeenAlertStore())
        // whatever is active from earlier tests is shown (or not) now, so the steps below start clean
        assertIs<PollOutcome.Notices>(watch.poll(vil))
        assertEquals(emptyList(), assertIs<PollOutcome.Notices>(watch.poll(vil)).notices)

        val guard = client()
        guard.login("9000000002", "2222")
        val sent = guard.sendAlert(NewAlert("warning", "Herd of 4 at the river crossing. Stay indoors after dark.", listOf("Wozhuro", "Sanis")))
        val notices = assertIs<PollOutcome.Notices>(watch.poll(vil)).notices
        assertEquals(1, notices.size, "exactly one new notification")
        val n = notices.single()
        assertEquals(sent.id, n.alertId)
        assertEquals("Elephant warning · Wozhuro", n.title)
        assertEquals("Hati sabdhan · Wozhuro", org.hatialert.client.app.Translator.nagamese.tr(n.title))
        assertEquals("Herd of 4 at the river crossing. Stay indoors after dark.", n.message)
        assertEquals(listOf("Wozhuro", "Sanis"), n.villages)
        assertEquals(emptyList(), assertIs<PollOutcome.Notices>(watch.poll(vil)).notices, "the second check shows nothing")

        // not for the villager's village, or not a warning: nothing
        guard.sendAlert(NewAlert("warning", "Herd near Sanis.", listOf("Sanis")))
        guard.sendAlert(NewAlert("info", "Patrol in Wozhuro tonight.", listOf("Wozhuro")))
        assertEquals(emptyList(), assertIs<PollOutcome.Notices>(watch.poll(vil)).notices)
        // an all-clear ends the warning; the next warning is new again
        guard.sendAlert(NewAlert("all_clear", "The herd has gone back to the forest.", listOf("Wozhuro")))
        assertEquals(emptyList(), assertIs<PollOutcome.Notices>(watch.poll(vil)).notices)
        assertEquals(null, vil.overview().warning)
        val again = guard.sendAlert(NewAlert("warning", "The herd is back near the school.", listOf("Wozhuro")))
        assertEquals(listOf(again.id), assertIs<PollOutcome.Notices>(watch.poll(vil)).notices.map { it.alertId })

        // signed out: the check stops
        vil.logout()
        assertEquals(PollOutcome.SignedOut, watch.poll(vil))
        val stale = HatiClient(base, token = "not-a-session")
        assertEquals(PollOutcome.SignedOut, watch.poll(stale))
        guard.logout()
    }

    companion object {
        fun findPython(): String? {
            val names = System.getenv("HATIALERT_PYTHON")?.let { listOf(it) } ?: listOf("python3", "python")
            for (exe in names) {
                try {
                    val p = ProcessBuilder(exe, "-c", "import sys; print(sys.version_info >= (3, 10))").redirectErrorStream(true).start()
                    val out = p.inputStream.readBytes().toString(Charsets.UTF_8).trim()
                    if (p.waitFor(30, TimeUnit.SECONDS) && p.exitValue() == 0 && out == "True") return exe
                } catch (_: IOException) {
                    // next
                }
            }
            return null
        }
    }
}
