package org.hatialert.client.app

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.hatialert.client.FakeTransport
import org.hatialert.client.Json
import org.hatialert.core.IncidentType

class AppControllerTest {
    private val t = FakeTransport().apply {
        on("GET", "/api/meta", body = Json.META)
        on("POST", "/api/auth/login", body = """{"token": "tok", "user": ${Json.USER}}""")
        on("GET", "/api/overview", body = Json.overview(Json.incident(1, lat = 26.0912, lng = 94.2534)))
        on("POST", "/api/auth/logout", body = """{"ok": true}""")
    }
    private val store = MemorySettingsStore()
    private val app = AppController(store, Dispatchers.Unconfined, t)

    @Test
    fun signInLoadsHomeAndSavesToken() = runBlocking {
        assertTrue(app.signIn("9000000001", "1111"))
        val s = app.state.value
        assertEquals(Screen.Home, s.screen)
        assertEquals("tok", store.load().token)
        assertEquals("9000000001", store.load().lastPhone)
        assertEquals(1, s.nearby.size)
        assertEquals("E", s.nearby[0].dir)
        assertEquals(1.0, s.nearby[0].km)
        assertEquals(0, s.busy)
        app.signOut()
        assertEquals(Screen.SignIn, app.state.value.screen)
        assertNull(store.load().token)
        assertNull(app.state.value.user)
        assertTrue(t.requests.any { it.url.endsWith("/api/auth/logout") && it.headers["Authorization"] == "Bearer tok" })
    }

    @Test
    fun wrongPinShowsServerMessageOnTheField() = runBlocking {
        t.on("POST", "/api/auth/login", 401, """{"error": "That phone number and PIN don't match.", "field": "pin"}""")
        assertTrue(!app.signIn("9000000001", "0000"))
        val s = app.state.value
        assertEquals(Screen.SignIn, s.screen)
        assertEquals("That phone number and PIN don't match.", s.fieldErrors["pin"])
        assertTrue(s.message!!.isError)
    }

    @Test
    fun expiredSessionReturnsToSignIn() = runBlocking {
        app.signIn("9000000001", "1111")
        t.on("GET", "/api/alerts", 401, """{"error": "Your sign-in has expired. Sign in again.", "field": null}""")
        app.loadAlerts()
        assertEquals(Screen.SignIn, app.state.value.screen)
        assertEquals("Your sign-in has expired. Sign in again.", app.state.value.message!!.text)
        assertNull(store.load().token)
    }

    @Test
    fun resumeSavedSession() = runBlocking {
        store.save(Settings(token = "saved"))
        val again = AppController(store, Dispatchers.Unconfined, t)
        t.on("GET", "/api/me", body = Json.USER)
        again.start()
        assertEquals(Screen.Home, again.state.value.screen)
        assertEquals("Bearer saved", t.requests.first { it.url.endsWith("/api/me") }.headers["Authorization"])
    }

    @Test
    fun invalidReportIsNotSent() = runBlocking {
        app.signIn("9000000001", "1111")
        val before = t.requests.size
        app.editDraft { it.copy(type = null, village = "Wozhuro") }
        assertNull(app.submitReport())
        assertEquals(before, t.requests.size)
        assertEquals("Choose what happened.", app.state.value.fieldErrors["type"])
        app.editDraft { it.copy(type = IncidentType.SIGHTING) }
        assertNull(app.state.value.fieldErrors["type"])
    }

    @Test
    fun serverUrlChangeSignsOutAndValidates() {
        assertEquals("The server address must start with http:// or https://", app.setServerUrl("ftp://x"))
        assertNull(app.setServerUrl("192.168.1.20:8000"))
        assertEquals("http://192.168.1.20:8000", store.load().serverUrl)
        app.setTheme(ThemeChoice.NAVY)
        assertEquals(ThemeChoice.NAVY, store.load().theme)
    }

    @Test
    fun offlineIsAMessageNotACrash() = runBlocking {
        t.offline = true
        assertTrue(!app.signIn("9000000001", "1111"))
        assertTrue(app.state.value.message!!.text.startsWith("Can't reach the HatiAlert server"))
    }
}
