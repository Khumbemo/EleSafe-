package org.hatialert.client

import java.io.File
import java.io.IOException
import java.net.ServerSocket
import java.nio.file.Files
import java.util.concurrent.TimeUnit
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.hatialert.client.app.AppController
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
    private var reportId = 0L

    private val jpeg = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte()) + ByteArray(60)

    @BeforeAll
    fun startServer() {
        val pyDir = File(System.getProperty("hatialert.py.dir", "../../hatialert-py"))
        assumeTrue(File(pyDir, "hatialert/__main__.py").isFile, "hatialert-py not found at $pyDir")
        val python = findPython()
        assumeTrue(python != null, "Python 3.10+ not found; skipping the server integration test")
        dir = Files.createTempDirectory("hatialert-it").toFile()
        val port = ServerSocket(0).use { it.localPort }
        base = "http://127.0.0.1:$port"
        server = ProcessBuilder(python, "-m", "hatialert", "--db", File(dir, "hatialert.db").path, "--host", "127.0.0.1", "--port", "$port")
            .directory(pyDir)
            .redirectErrorStream(true)
            .redirectOutput(File(dir, "server.log"))
            .start()
        val probe = HatiClient(base, UrlConnectionTransport(connectTimeoutMs = 500, readTimeoutMs = 2000))
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(60)
        while (true) {
            try {
                probe.meta()
                break
            } catch (e: NetworkException) {
                check(server!!.isAlive) { "server exited: " + File(dir, "server.log").readText() }
                check(System.nanoTime() < deadline) { "server did not start: " + File(dir, "server.log").readText() }
                Thread.sleep(200)
            }
        }
    }

    @AfterAll
    fun stopServer() {
        server?.let {
            it.destroy()
            if (!it.waitFor(10, TimeUnit.SECONDS)) it.destroyForcibly()
        }
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
