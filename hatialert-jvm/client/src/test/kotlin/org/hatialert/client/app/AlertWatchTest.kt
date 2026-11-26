package org.hatialert.client.app

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.hatialert.client.FakeTransport
import org.hatialert.client.HatiClient
import org.hatialert.client.Json

class AlertWatchTest {
    private val t = FakeTransport()
    private val client = HatiClient("http://h", t, token = "tok")
    private val seen = MemorySeenAlertStore()
    private val watch = AlertWatch(seen, keep = 3)

    private fun alert(id: Long, level: String = "warning", villages: String = "\"Wozhuro\"", affects: Boolean = true) =
        """{"id": $id, "level": "$level", "level_label": "${if (level == "warning") "Elephant warning" else "Information"}",
            "message": "Herd of 6 near the school. Stay indoors.", "villages": [$villages], "incident_id": 7,
            "by": "Guard Renthung", "sent_at": 1790000000000, "sample": false, "affects_me": $affects, "active": true}"""

    private fun overview(warning: String?) {
        val base = Json.overview("")
        t.on("GET", "/api/overview", body = if (warning == null) base else base.replace("\"warning\": null", "\"warning\": $warning"))
    }

    @Test
    fun newWarningNotifiesOnce() {
        overview(alert(11))
        val first = assertIs<PollOutcome.Notices>(watch.poll(client)).notices
        assertEquals(1, first.size)
        val n = first[0]
        assertEquals(11, n.alertId)
        assertEquals("Elephant warning · Wozhuro", n.title)
        assertEquals("Herd of 6 near the school. Stay indoors.", n.message)
        assertEquals(listOf("Wozhuro"), n.villages)
        assertEquals(7L, n.incidentId)
        assertEquals("Bearer tok", t.last.headers["Authorization"])
        assertTrue(t.last.url.endsWith("/api/overview"))
        // the same warning again: nothing
        assertEquals(emptyList(), assertIs<PollOutcome.Notices>(watch.poll(client)).notices)
        // a newer one replaces it
        overview(alert(12))
        assertEquals(listOf(12L), assertIs<PollOutcome.Notices>(watch.poll(client)).notices.map { it.alertId })
        assertEquals(listOf(11L, 12L), seen.load())
    }

    @Test
    fun noWarningOrNotAWarningIsQuiet() {
        overview(null)
        assertEquals(emptyList(), assertIs<PollOutcome.Notices>(watch.poll(client)).notices)
        overview(alert(13, level = "info"))
        assertEquals(emptyList(), assertIs<PollOutcome.Notices>(watch.poll(client)).notices)
        overview(alert(14, villages = "\"Sanis\"", affects = false))
        assertEquals(emptyList(), assertIs<PollOutcome.Notices>(watch.poll(client)).notices)
        assertEquals(emptyList(), seen.load())
    }

    @Test
    fun keepsOnlyTheNewestIds() {
        for (id in 1L..5L) {
            overview(alert(id))
            watch.poll(client)
        }
        assertEquals(listOf(3L, 4L, 5L), seen.load())
        watch.markSeen(listOf(5L, 6L))
        assertEquals(listOf(4L, 5L, 6L), seen.load())
        overview(alert(6))
        assertEquals(emptyList(), assertIs<PollOutcome.Notices>(watch.poll(client)).notices)
    }

    @Test
    fun failuresSayWhatToDo() {
        assertEquals(PollOutcome.SignedOut, watch.poll(HatiClient("http://h", t)))
        t.on("GET", "/api/overview", 401, """{"error": "Your sign-in has expired. Sign in again.", "field": null}""")
        assertEquals(PollOutcome.SignedOut, watch.poll(client))
        t.on("GET", "/api/overview", 403, """{"error": "Choose a new PIN first.", "field": "pin"}""")
        assertEquals(PollOutcome.Refused("Choose a new PIN first."), watch.poll(client))
        t.on("GET", "/api/overview", 503, """{"error": "busy", "field": null}""")
        assertIs<PollOutcome.TryLater>(watch.poll(client))
        t.offline = true
        assertIs<PollOutcome.TryLater>(watch.poll(client))
        assertEquals(emptyList(), seen.load())
    }

    @Test
    fun notificationTapOpensAlertsAfterSignIn() = runBlocking {
        t.on("GET", "/api/meta", body = Json.META)
        t.on("POST", "/api/auth/login", body = """{"token": "tok", "user": ${Json.USER}}""")
        overview(null)
        t.on("GET", "/api/alerts", body = "[${alert(21)}]")
        val store = MemorySettingsStore()
        val app = AppController(store, Dispatchers.Unconfined, t)
        app.openWhenReady(Screen.Alerts) // tapped before the session is back
        assertEquals(Screen.SignIn, app.state.value.screen)
        assertTrue(app.signIn("9000000001", "1111"))
        assertEquals(Screen.Alerts, app.state.value.screen)
        assertEquals(listOf(21L), app.state.value.alerts.map { it.id })
        // once signed in it opens straight away
        app.navigate(Screen.Home)
        app.openWhenReady(Screen.Alerts)
        assertEquals(Screen.Alerts, app.state.value.screen)
        // and a later sign-in goes Home as usual
        app.signOut()
        assertTrue(app.signIn("9000000001", "1111"))
        assertEquals(Screen.Home, app.state.value.screen)
    }

    @Test
    fun languageAndNotificationSettingsAreSaved() {
        val store = MemorySettingsStore()
        val app = AppController(store, Dispatchers.Unconfined, t)
        app.setLanguage(Language.NAGAMESE)
        app.setNotifications(true)
        assertEquals(Language.NAGAMESE, store.load().language)
        assertTrue(store.load().notifications)
        assertEquals(AppController.NOTIFY_ON, app.state.value.message?.text)
        app.setNotifications(false)
        assertEquals(false, store.load().notifications)
        assertEquals(Language.NAGAMESE, app.state.value.settings.language)
    }
}
