package org.hatialert.client.app

import java.io.File
import java.io.IOException
import java.nio.file.Files
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.hatialert.client.FakeTransport
import org.hatialert.client.HttpRequest
import org.hatialert.client.HttpResponse
import org.hatialert.client.HttpTransport
import org.hatialert.client.Json
import org.hatialert.client.NewIncident
import org.hatialert.core.IncidentType
import kotlinx.serialization.json.Json as KJson

class OutboxTest {
    private val jpeg = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte()) + ByteArray(60) { it.toByte() }

    /** Incident ids per client_id, as the server de-duplicates them; fails POSTs on demand. */
    private inner class Server : HttpTransport {
        val fake = FakeTransport().apply {
            on("GET", "/api/meta", body = Json.META)
            on("POST", "/api/auth/login", body = """{"token": "tok", "user": ${Json.USER}}""")
            on("GET", "/api/overview", body = Json.overview(""))
        }
        val created = linkedMapOf<String, Long>()
        val posts = mutableListOf<String?>()

        /** Answer for the n-th POST /api/incidents (1-based); default: create or return the same case. */
        var answer: (n: Int, clientId: String?) -> HttpResponse? = { _, _ -> null }
        var offline = false

        /** The server stores the report, then the connection drops before the answer arrives. */
        var dropAnswer = false

        override fun execute(request: HttpRequest): HttpResponse {
            if (offline) throw IOException("no route to host")
            if (request.method != "POST" || !request.url.endsWith("/api/incidents")) return fake.execute(request)
            val body = KJson.parseToJsonElement(request.body!!.toString(Charsets.UTF_8)).jsonObject
            val cid = body["client_id"]?.jsonPrimitive?.content
            posts += cid
            answer(posts.size, cid)?.let { return it }
            val id = created.getOrPut(cid ?: "anon-${posts.size}") { 100L + created.size }
            if (dropAnswer) throw IOException("connection reset")
            return HttpResponse(200, Json.incident(id), "application/json")
        }
    }

    private val server = Server()
    private val outbox = MemoryOutboxStore()
    private val app = AppController(MemorySettingsStore(), Dispatchers.Unconfined, server, outbox, clock = { 1_790_000_000_000 })
    private val tmp: File = Files.createTempDirectory("outbox-test").toFile()

    @AfterTest
    fun cleanUp() {
        tmp.deleteRecursively()
    }

    private fun validDraft() = app.editDraft {
        it.copy(type = IncidentType.SIGHTING, village = "Wozhuro", herdSize = "4", offsetKm = "1", offsetDir = "N", photos = listOf(jpeg))
    }

    private fun pending(cid: String, user: Long = 1) =
        PendingReport(cid, user, NewIncident(type = "sighting", village = "Wozhuro", offsetKm = 0.0, offsetDir = ""), listOf(jpeg))

    @Test
    fun networkFailureSavesTheReportAndClearsTheDraft() = runBlocking {
        app.signIn("9000000001", "1111")
        validDraft()
        val cid = app.state.value.draft.clientId
        server.offline = true
        assertNull(app.submitReport())
        val s = app.state.value
        assertEquals(AppController.SAVED_OFFLINE, s.message!!.text)
        assertFalse(s.message!!.isError)
        assertEquals(Screen.Home, s.screen)
        assertNull(s.draft.type, "draft cleared")
        assertTrue(s.draft.clientId != cid, "the next report gets a new id")
        assertEquals("Wozhuro", s.draft.village)
        assertEquals(1, s.pendingReports)
        assertEquals("1 report waiting to send", s.pendingNote)
        val item = outbox.load().single()
        assertEquals(cid, item.clientId)
        assertEquals(1L, item.userId)
        assertEquals(4, item.report.herdSize)
        assertContentEquals(jpeg, item.photos.single())
        assertEquals(cid, item.toRequest().clientId)
        assertEquals(1, item.toRequest().attachments!!.size)
    }

    @Test
    fun aRefusedReportIsNotSaved() = runBlocking {
        app.signIn("9000000001", "1111")
        validDraft()
        server.answer = { _, _ -> HttpResponse(400, """{"error": "Choose a village from the list.", "field": "village"}""") }
        assertNull(app.submitReport())
        val s = app.state.value
        assertEquals(emptyList(), outbox.load())
        assertEquals(0, s.pendingReports)
        assertNull(s.pendingNote)
        assertEquals("Choose a village from the list.", s.fieldErrors["village"])
        assertTrue(s.message!!.isError)
        assertEquals(IncidentType.SIGHTING, s.draft.type, "draft kept for correction")
    }

    @Test
    fun serverErrorIsNotSavedEither() = runBlocking {
        app.signIn("9000000001", "1111")
        validDraft()
        server.answer = { _, _ -> HttpResponse(500, """{"error": "Internal error.", "field": null}""") }
        assertNull(app.submitReport())
        assertEquals(emptyList(), outbox.load())
        assertEquals("Internal error.", app.state.value.message!!.text)
    }

    @Test
    fun flushSendsOldestFirstAndOnlyThisUsersReports() = runBlocking {
        outbox.save(listOf(pending("aaaaaaaa"), pending("bbbbbbbb", user = 2), pending("cccccccc"), pending("dddddddd")))
        app.signIn("9000000001", "1111") // refreshHome flushes
        assertEquals(listOf<String?>("aaaaaaaa", "cccccccc", "dddddddd"), server.posts)
        assertEquals(listOf("bbbbbbbb"), outbox.load().map { it.clientId })
        val s = app.state.value
        assertEquals(0, s.pendingReports)
        assertEquals("3 saved reports sent: HA-2609-0100, HA-2609-0101, HA-2609-0102.", s.message!!.text)
        assertFalse(s.message!!.isError)
        assertEquals(0, app.flushOutbox(), "nothing left for this user")
    }

    @Test
    fun flushStopsAtTheFirstNetworkFailure() = runBlocking {
        app.signIn("9000000001", "1111")
        outbox.save(listOf(pending("aaaaaaaa"), pending("bbbbbbbb"), pending("cccccccc")))
        server.answer = { n, _ -> if (n == 2) throw IOException("signal lost") else null }
        assertEquals(1, app.flushOutbox())
        assertEquals(listOf<String?>("aaaaaaaa", "bbbbbbbb"), server.posts, "nothing tried after the failure")
        assertEquals(listOf("bbbbbbbb", "cccccccc"), outbox.load().map { it.clientId })
        assertEquals(2, app.state.value.pendingReports)
        assertEquals("2 reports waiting to send", app.state.value.pendingNote)

        server.answer = { _, _ -> null }
        assertEquals(2, app.flushOutbox())
        assertEquals(emptyList(), outbox.load())
        assertEquals(0, app.state.value.pendingReports)
    }

    @Test
    fun serverTroubleKeepsTheReportForLater() = runBlocking {
        app.signIn("9000000001", "1111")
        outbox.save(listOf(pending("aaaaaaaa"), pending("bbbbbbbb")))
        for (status in listOf(429, 500, 503)) {
            server.posts.clear()
            server.answer = { _, _ -> HttpResponse(status, """{"error": "Busy.", "field": null}""") }
            assertEquals(0, app.flushOutbox())
            assertEquals(listOf<String?>("aaaaaaaa"), server.posts)
            assertEquals(2, outbox.load().size)
        }
    }

    @Test
    fun aPermanentRefusalDropsThatReportWithTheReason() = runBlocking {
        app.signIn("9000000001", "1111")
        outbox.save(listOf(pending("aaaaaaaa"), pending("bbbbbbbb")))
        server.answer = { _, cid -> if (cid == "aaaaaaaa") HttpResponse(400, """{"error": "Choose a village from the list.", "field": "village"}""") else null }
        assertEquals(1, app.flushOutbox())
        assertEquals(emptyList(), outbox.load())
        val m = app.state.value.message!!
        assertTrue(m.isError)
        assertEquals("A saved report couldn't be sent: Choose a village from the list. Saved report sent. Your report number is HA-2609-0100.", m.text)
    }

    @Test
    fun expiredSessionDuringFlushSignsOutAndKeepsTheReport() = runBlocking {
        app.signIn("9000000001", "1111")
        outbox.save(listOf(pending("aaaaaaaa")))
        server.answer = { _, _ -> HttpResponse(401, """{"error": "Your sign-in has expired. Sign in again.", "field": null}""") }
        assertEquals(0, app.flushOutbox())
        assertEquals(Screen.SignIn, app.state.value.screen)
        assertEquals(1, outbox.load().size)
    }

    @Test
    fun aDroppedAnswerIsResentWithTheSameIdAndMakesOneCase() = runBlocking {
        app.signIn("9000000001", "1111")
        validDraft()
        val cid = app.state.value.draft.clientId
        server.dropAnswer = true // the server stores it, the phone never hears back
        assertNull(app.submitReport())
        assertEquals(1, app.state.value.pendingReports)
        server.dropAnswer = false
        app.refreshHome()
        assertEquals(listOf<String?>(cid, cid), server.posts)
        assertEquals(mapOf(cid to 100L), server.created, "the server made one case")
        assertEquals(0, app.state.value.pendingReports)
        assertEquals("Saved report sent. Your report number is HA-2609-0100.", app.state.value.message!!.text)
    }

    @Test
    fun startSendsSavedReports() = runBlocking {
        val settings = MemorySettingsStore(Settings(token = "saved"))
        server.fake.on("GET", "/api/me", body = Json.USER)
        outbox.save(listOf(pending("aaaaaaaa")))
        val again = AppController(settings, Dispatchers.Unconfined, server, outbox)
        again.start()
        assertEquals(listOf<String?>("aaaaaaaa"), server.posts)
        assertEquals(emptyList(), outbox.load())
    }

    @Test
    fun signedOutNothingIsSentAndNothingCounted() = runBlocking {
        outbox.save(listOf(pending("aaaaaaaa")))
        assertEquals(0, app.flushOutbox())
        assertEquals(emptyList(), server.posts)
        assertEquals(0, app.state.value.pendingReports)
    }

    @Test
    fun fileStoreKeepsPhotosBesideTheIndex() {
        val dir = File(tmp, "outbox")
        val store = FileOutboxStore(dir)
        assertEquals(emptyList(), store.load(), "no folder yet")
        val big = ByteArray(1_400_000) { (it * 31).toByte() }
        val a = PendingReport.of(NewIncident(type = "crop_raid", village = "Wozhuro", herdSize = 6, lat = 26.1, lng = 94.2, clientId = "aaaaaaaa"), listOf(jpeg, big), 1, 5)
        val b = pending("bbbbbbbb", user = 2)
        store.save(listOf(a, b))

        val back = FileOutboxStore(dir).load()
        assertEquals(listOf("aaaaaaaa", "bbbbbbbb"), back.map { it.clientId })
        assertEquals(listOf(1L, 2L), back.map { it.userId })
        assertEquals(a.report, back[0].report)
        assertEquals(5L, back[0].queuedAt)
        assertContentEquals(jpeg, back[0].photos[0])
        assertContentEquals(big, back[0].photos[1])
        assertEquals(1, back[1].photos.size)

        val index = File(dir, "outbox.json").readText()
        assertTrue(index.length < 5_000, "photos are files, not base64 in the index")
        val parsed = KJson.parseToJsonElement(index).jsonArray
        assertEquals(listOf("aaaaaaaa-0.photo", "aaaaaaaa-1.photo"), parsed[0].jsonObject["photos"]!!.jsonArray.map { it.jsonPrimitive.content })
        assertEquals(setOf("outbox.json", "aaaaaaaa-0.photo", "aaaaaaaa-1.photo", "bbbbbbbb-0.photo"), dir.list()!!.toSet(), "no temp files left")

        store.save(listOf(b))
        assertEquals(setOf("outbox.json", "bbbbbbbb-0.photo"), dir.list()!!.toSet(), "sent report's photos removed")
        assertEquals(listOf("bbbbbbbb"), store.load().map { it.clientId })

        File(dir, "outbox.json").writeText("{not json")
        assertEquals(emptyList(), store.load(), "a damaged index reads as empty instead of crashing")
    }

    @Test
    fun fileStoreWorksUnderTheController() = runBlocking {
        val store = FileOutboxStore(File(tmp, "q"))
        val withFiles = AppController(MemorySettingsStore(), Dispatchers.Unconfined, server, store)
        withFiles.signIn("9000000001", "1111")
        withFiles.editDraft { it.copy(type = IncidentType.SIGHTING, village = "Wozhuro", photos = listOf(jpeg)) }
        server.offline = true
        assertNull(withFiles.submitReport())
        assertEquals(1, FileOutboxStore(File(tmp, "q")).load().size, "on disk for the next launch")
        server.offline = false
        assertEquals(1, withFiles.flushOutbox())
        assertEquals(emptyList(), store.load())
        assertEquals(setOf("outbox.json"), File(tmp, "q").list()!!.toSet())
    }
}
