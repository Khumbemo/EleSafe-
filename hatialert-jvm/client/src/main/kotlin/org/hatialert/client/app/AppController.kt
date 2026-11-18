package org.hatialert.client.app

import java.io.IOException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.hatialert.client.Alert
import org.hatialert.client.ApiException
import org.hatialert.client.HatiClient
import org.hatialert.client.HatiException
import org.hatialert.client.HttpTransport
import org.hatialert.client.Incident
import org.hatialert.client.Meta
import org.hatialert.client.NetworkException
import org.hatialert.client.Overview
import org.hatialert.client.User
import org.hatialert.client.Village
import org.hatialert.core.Villages

/** What the app keeps between launches. */
data class Settings(
    val serverUrl: String = DEFAULT_SERVER_URL,
    val theme: ThemeChoice = ThemeChoice.GREEN,
    val token: String? = null,
    val lastPhone: String = "",
) {
    companion object {
        /** The development machine as seen from the Android emulator. */
        const val DEFAULT_SERVER_URL = "http://10.0.2.2:8000"
    }
}

/** Where [Settings] live (SharedPreferences on Android, memory in tests). */
interface SettingsStore {
    fun load(): Settings
    fun save(settings: Settings)
}

class MemorySettingsStore(private var settings: Settings = Settings()) : SettingsStore {
    override fun load() = settings
    override fun save(settings: Settings) {
        this.settings = settings
    }
}

sealed interface Screen {
    data object SignIn : Screen
    data object Home : Screen
    data object Report : Screen
    data object Cases : Screen
    data class CaseDetail(val id: Long) : Screen
    data object Alerts : Screen
    data object Settings : Screen
}

data class UiMessage(val text: String, val isError: Boolean)

data class AppState(
    val settings: Settings,
    val screen: Screen = Screen.SignIn,
    val user: User? = null,
    val meta: Meta? = null,
    val overview: Overview? = null,
    /** Worked out on the phone with :core from [overview]. */
    val nearby: List<NearbyItem> = emptyList(),
    val cases: List<Incident> = emptyList(),
    val detail: Incident? = null,
    val alerts: List<Alert> = emptyList(),
    val draft: ReportDraft = ReportDraft(),
    val fieldErrors: Map<String, String> = emptyMap(),
    val busy: Int = 0,
    val message: UiMessage? = null,
    /** This user's reports saved on the phone, waiting for a connection. */
    val pendingReports: Int = 0,
) {
    val isBusy get() = busy > 0

    /** "2 reports waiting to send", or null when nothing is waiting. */
    val pendingNote: String?
        get() = if (pendingReports == 0) null else "$pendingReports report${if (pendingReports == 1) "" else "s"} waiting to send"

    /** The server's villages once loaded, else the built-in list. */
    val villages: List<Village>
        get() = meta?.villages ?: Villages.SEED.map { Village(0, it.name, it.lat, it.lng, it.verified, it.source) }

    val homeVillage: Village?
        get() = overview?.village ?: user?.let { u -> villages.firstOrNull { it.name == u.village } }
}

/**
 * The app's behaviour, independent of Android: sign-in, home, reports, cases,
 * alerts and settings, as a [StateFlow] of [AppState]. The Android ViewModel
 * only forwards UI events here and launches these suspend functions; blocking
 * network calls run on [io].
 */
class AppController(
    private val store: SettingsStore,
    private val io: CoroutineDispatcher = Dispatchers.IO,
    private val transport: HttpTransport? = null,
    /** Reports waiting for a connection (a [FileOutboxStore] on Android). */
    private val outbox: OutboxStore = MemoryOutboxStore(),
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val _state = MutableStateFlow(AppState(settings = store.load()))
    val state: StateFlow<AppState> = _state.asStateFlow()

    @Volatile
    private var client = newClient(_state.value.settings)

    private fun newClient(s: Settings) =
        if (transport != null) HatiClient(s.serverUrl, transport, s.token) else HatiClient(s.serverUrl, token = s.token)

    // --- navigation and small state changes -------------------------------------

    fun navigate(screen: Screen) {
        _state.update { it.copy(screen = screen, fieldErrors = emptyMap()) }
    }

    fun dismissMessage() = _state.update { it.copy(message = null) }

    fun editDraft(change: (ReportDraft) -> ReportDraft) = _state.update { st ->
        val d = change(st.draft)
        // Clear the errors of fields the edit touched.
        st.copy(draft = d, fieldErrors = st.fieldErrors.filterKeys { k -> fieldOf(k, st.draft) == fieldOf(k, d) })
    }

    private fun fieldOf(key: String, d: ReportDraft): Any? = when (key) {
        "type" -> d.type
        "village" -> d.village
        "herd_size" -> d.herdSize
        "casualties" -> d.casualties
        "offset_km" -> d.offsetKm
        "offset_dir" -> d.offsetDir to d.offsetKm
        "heading" -> d.heading
        "lat", "lng" -> d.gps to d.useGps
        "description" -> d.description
        "attachments" -> d.photos.size
        else -> null
    }

    fun setTheme(theme: ThemeChoice) = saveSettings { it.copy(theme = theme) }

    /**
     * Points the app at another server. Returns an error message for a bad
     * address. Signs out locally when the address changes (the token belongs to the old server).
     */
    fun setServerUrl(raw: String): String? {
        val url = try {
            HatiClient.normalizeBaseUrl(raw)
        } catch (e: IllegalArgumentException) {
            return e.message
        }
        val old = _state.value.settings
        if (url == old.serverUrl) return null
        saveSettings { it.copy(serverUrl = url, token = null) }
        client = newClient(_state.value.settings)
        _state.update { AppState(settings = it.settings, screen = Screen.SignIn, message = UiMessage("Server set to $url. Sign in again.", false)) }
        return null
    }

    private fun saveSettings(change: (Settings) -> Settings) {
        val s = change(_state.value.settings)
        store.save(s)
        _state.update { it.copy(settings = s) }
    }

    // --- network actions --------------------------------------------------------

    /** On launch: resume a saved session if the server still accepts it. */
    suspend fun start() {
        loadMeta()
        if (_state.value.settings.token == null) {
            navigate(Screen.SignIn)
            return
        }
        val me = call { client.me() } ?: return
        _state.update { it.copy(user = me, screen = Screen.Home) }
        refreshHome() // also sends any saved reports
    }

    suspend fun signIn(phone: String, pin: String): Boolean {
        val errors = buildMap {
            if (phone.isBlank()) put("phone", "Enter a 10-digit mobile number.")
            if (pin.isBlank()) put("pin", "Enter your PIN.")
        }
        if (errors.isNotEmpty()) {
            _state.update { it.copy(fieldErrors = errors) }
            return false
        }
        val session = call(fieldErrors = true) { client.login(phone.trim(), pin.trim()) } ?: return false
        saveSettings { it.copy(token = session.token, lastPhone = session.user.phone) }
        _state.update {
            it.copy(
                user = session.user, screen = Screen.Home, fieldErrors = emptyMap(),
                message = if (session.user.mustChangePin) UiMessage("Choose a new PIN in the web app before carrying on.", true) else null,
            )
        }
        loadMeta()
        refreshHome()
        return true
    }

    suspend fun signOut() {
        try {
            withContext(io) { client.logout() }
        } catch (_: HatiException) {
            // Signed out locally either way; the server drops unused sessions itself.
        }
        signedOut(null)
    }

    private fun signedOut(message: UiMessage?) {
        saveSettings { it.copy(token = null) }
        client.token = null
        _state.update { AppState(settings = it.settings, meta = it.meta, screen = Screen.SignIn, message = message) }
        // Saved reports stay on the phone for when this person signs in again.
    }

    suspend fun loadMeta() {
        val meta = call(quiet = true) { client.meta() } ?: return
        _state.update { it.copy(meta = meta) }
    }

    /** Sends saved reports first, so a report that just went out shows on the map. */
    suspend fun refreshHome() {
        flushOutbox()
        val ov = call { client.overview() } ?: return
        val nearby = nearbyIncidents(ov.village, ov.radiusKm, ov.nearby)
        _state.update { it.copy(overview = ov, nearby = nearby) }
    }

    /** Villagers see their own reports; forest staff see every case. */
    suspend fun loadCases() {
        val staff = _state.value.user?.isStaff == true
        val list = call { if (staff) client.incidents(status = "all") else client.incidents(status = "all", mine = true) } ?: return
        _state.update { it.copy(cases = list) }
    }

    suspend fun openCase(id: Long) {
        _state.update { it.copy(screen = Screen.CaseDetail(id), detail = it.detail?.takeIf { d -> d.id == id }) }
        val inc = call { client.incident(id) } ?: return
        _state.update { it.copy(detail = inc) }
    }

    /** Guard/officer action on the open case. */
    suspend fun changeStatus(id: Long, status: String?, note: String): Boolean {
        val inc = call(fieldErrors = true) { client.updateStatus(id, status, note.trim()) } ?: return false
        _state.update {
            it.copy(detail = inc, cases = it.cases.map { c -> if (c.id == id) inc else c }, message = UiMessage("Case ${inc.ref}: ${inc.statusLabel}", false))
        }
        return true
    }

    /** Validates and sends the current draft; on success opens the new case. */
    suspend fun submitReport(): Incident? {
        val st = _state.value
        val errors = st.draft.validate(st.villages)
        if (errors.isNotEmpty()) {
            _state.update { it.copy(fieldErrors = errors, message = UiMessage(errors.values.first(), true)) }
            return null
        }
        val request = st.draft.toRequest()
        val inc = try {
            call(fieldErrors = true, rethrowNetwork = true) { client.createIncident(request) }
        } catch (e: NetworkException) {
            // No answer at all: keep it on the phone and send it later (same client_id, so a
            // report the server did get before the connection dropped is not made twice).
            val user = st.user
            if (user != null && enqueue(PendingReport.of(request, st.draft.photos, user.id, clock()))) {
                _state.update {
                    it.copy(
                        draft = ReportDraft(village = it.user?.village), screen = Screen.Home, fieldErrors = emptyMap(),
                        message = UiMessage(SAVED_OFFLINE, false),
                    )
                }
            } else {
                _state.update { it.copy(message = UiMessage(e.message ?: "No connection.", true)) }
            }
            null
        } ?: return null
        _state.update {
            it.copy(
                draft = ReportDraft(village = it.user?.village), detail = inc, screen = Screen.CaseDetail(inc.id),
                fieldErrors = emptyMap(), message = UiMessage("Report sent. Your report number is ${inc.ref}.", false),
            )
        }
        return inc
    }

    suspend fun loadAlerts() {
        val list = call { client.alerts() } ?: return
        _state.update { it.copy(alerts = list) }
    }

    // --- reports saved while offline ---------------------------------------------

    private val outboxLock = Mutex()
    private val flushing = Mutex()

    private suspend fun enqueue(item: PendingReport): Boolean = try {
        outboxLock.withLock {
            withContext(io) { outbox.save(outbox.load().filter { it.clientId != item.clientId } + item) }
        }
        updatePendingCount()
        true
    } catch (e: IOException) { // disk full, storage gone: tell the person instead of losing the report silently
        false
    } catch (e: SecurityException) {
        false
    }

    private suspend fun removeFromOutbox(clientId: String) {
        outboxLock.withLock { withContext(io) { outbox.save(outbox.load().filter { it.clientId != clientId }) } }
    }

    private suspend fun pendingForUser(): List<PendingReport> {
        val id = _state.value.user?.id ?: return emptyList()
        return outboxLock.withLock { withContext(io) { outbox.load() } }.filter { it.userId == id }
    }

    /** Re-reads how many of this user's reports are waiting (AppState.pendingReports). */
    suspend fun updatePendingCount() {
        val n = try {
            pendingForUser().size
        } catch (e: IOException) {
            0
        }
        _state.update { it.copy(pendingReports = n) }
    }

    /**
     * Sends this user's saved reports, oldest first (offline.ts flushQueue). Each one
     * leaves the queue when the server accepts it, or when the server refuses it for
     * good (a 4xx about the report itself), with the reason shown. It stops at the
     * first one that can't get through (no connection, server error, too many
     * reports, signed out) and keeps it and the rest for later. Does nothing while a
     * flush is already running. Returns how many reports were sent.
     */
    suspend fun flushOutbox(): Int {
        if (!flushing.tryLock()) return 0
        var sent = 0
        try {
            val items = pendingForUser()
            val refs = mutableListOf<String>()
            val refused = mutableListOf<String>()
            for (item in items) {
                try {
                    val inc = withContext(io) { client.createIncident(item.toRequest()) }
                    removeFromOutbox(item.clientId)
                    refs += inc.ref
                    sent++
                } catch (e: NetworkException) {
                    break
                } catch (e: ApiException) {
                    when {
                        e.isUnauthorized -> {
                            if (_state.value.user != null) signedOut(UiMessage(e.message ?: "Sign in again.", true))
                            break
                        }
                        e.status < 400 -> { // accepted, but the answer couldn't be read
                            removeFromOutbox(item.clientId)
                            sent++
                        }
                        e.status == 408 || e.status == 429 || e.status >= 500 -> break // try later
                        else -> { // the server refused this report itself; resending won't help
                            removeFromOutbox(item.clientId)
                            refused += e.message ?: "refused by the server"
                        }
                    }
                }
            }
            val sentText = when (refs.size) {
                0 -> null
                1 -> "Saved report sent. Your report number is ${refs[0]}."
                else -> "${refs.size} saved reports sent: ${refs.joinToString()}."
            }
            val message = when {
                refused.isNotEmpty() -> UiMessage(
                    (if (refused.size == 1) "A saved report couldn't be sent: ${refused[0]}" else "${refused.size} saved reports couldn't be sent: ${refused.joinToString(" / ")}") +
                        (sentText?.let { " $it" } ?: ""),
                    true,
                )
                sentText != null -> UiMessage(sentText, false)
                else -> null
            }
            if (message != null) _state.update { it.copy(message = message) }
        } catch (e: IOException) {
            // The store failed; what was not removed is sent again next time (same client_id, no duplicate).
        } finally {
            flushing.unlock()
            updatePendingCount()
        }
        return sent
    }

    /** Runs a blocking client call on [io]; failures become a message instead of an exception. */
    private suspend fun <T> call(fieldErrors: Boolean = false, quiet: Boolean = false, rethrowNetwork: Boolean = false, block: () -> T): T? {
        _state.update { it.copy(busy = it.busy + 1) }
        try {
            return withContext(io) { block() }
        } catch (e: ApiException) {
            if (e.isUnauthorized && _state.value.user != null) {
                signedOut(UiMessage(e.message ?: "Sign in again.", true))
            } else if (!quiet) {
                _state.update {
                    it.copy(
                        message = UiMessage(e.message ?: "Something went wrong.", true),
                        fieldErrors = if (fieldErrors && e.field != null) it.fieldErrors + (e.field to (e.message ?: "")) else it.fieldErrors,
                    )
                }
            }
        } catch (e: NetworkException) {
            if (rethrowNetwork) throw e
            if (!quiet) _state.update { it.copy(message = UiMessage(e.message ?: "No connection.", true)) }
        } finally {
            _state.update { it.copy(busy = it.busy - 1) }
        }
        return null
    }

    companion object {
        /** What the web app says when a report is kept for later. */
        const val SAVED_OFFLINE = "No connection right now. Your report is saved on this phone and will be sent when you're back online."
    }
}
