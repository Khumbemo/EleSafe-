package org.hatialert.client

import java.io.IOException
import java.net.URLEncoder
import kotlin.io.encoding.Base64
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.serializer

/**
 * Typed, blocking client for the HatiAlert JSON API (hatialert-py's api.py).
 * Call it off the main thread. Signs requests with `Authorization: Bearer <token>`,
 * as the web app does; [login] stores the token and [logout] clears it.
 *
 * Every call throws [ApiException] when the server says no (its message is
 * meant for people) and [NetworkException] when there is no answer at all.
 */
class HatiClient(
    baseUrl: String,
    private val transport: HttpTransport = UrlConnectionTransport(),
    @Volatile var token: String? = null,
) {
    val baseUrl: String = normalizeBaseUrl(baseUrl)

    // --- public -------------------------------------------------------------

    /** Villages, types, statuses, workflow, limits, contacts... (no sign-in needed). */
    fun meta(): Meta = get("/api/meta")

    /** The village list the server uses (from [meta]; officers can edit it on the server). */
    fun villages(): List<Village> = meta().villages

    // --- auth ---------------------------------------------------------------

    /** Signs in and keeps the session token for later calls. */
    fun login(phone: String, pin: String): Session {
        val s: Session = send("POST", "/api/auth/login", Login(phone, pin))
        token = s.token
        return s
    }

    /** New villager account; signs in on success. [code] is needed only when the server sends texts. */
    fun register(name: String, phone: String, village: String, pin: String, code: String? = null): Session {
        val s: Session = send("POST", "/api/auth/register", Registration(name, phone, village, pin, code))
        token = s.token
        return s
    }

    /** Ends this session on the server and forgets the token (also when the server is unreachable). */
    fun logout() {
        try {
            if (token != null) send<JsonObject, JsonObject>("POST", "/api/auth/logout", JsonObject(emptyMap()))
        } finally {
            token = null
        }
    }

    fun me(): User = get("/api/me")

    fun updateMe(update: ProfileUpdate): User = send("PATCH", "/api/me", update)

    // --- incidents ----------------------------------------------------------

    /**
     * Cases. [status] is `open` (default), `closed` or `all`; closed and all need
     * forest staff unless [mine] is set. [village] filters by village name.
     */
    fun incidents(status: String = "open", mine: Boolean = false, village: String? = null): List<Incident> {
        val q = buildList {
            add("status" to status)
            if (mine) add("mine" to "1")
            if (!village.isNullOrEmpty()) add("village" to village)
        }
        return get("/api/incidents" + query(q), ListSerializer(Incident.serializer()))
    }

    /** One case with its timeline ([Incident.events]) and the moves this user may make ([Incident.next]). */
    fun incident(id: Long): Incident = get("/api/incidents/$id")

    /** Files a report; returns the saved case (severity is worked out by the server). */
    fun createIncident(report: NewIncident): Incident = send("POST", "/api/incidents", report)

    /** Moves a case on and/or adds a note (forest staff only). */
    fun updateStatus(id: Long, status: String?, note: String = ""): Incident =
        send("PATCH", "/api/incidents/$id", StatusUpdate(status, note))

    /** Adds a photo or voice note to a case (reporter or staff). */
    fun addAttachment(id: Long, kind: String, bytes: ByteArray): Incident =
        send("POST", "/api/incidents/$id/attachments", NewAttachment(kind, Base64.encode(bytes)))

    /** Home screen data: the user's village, alert radius and open incidents within it. */
    fun overview(): Overview = get("/api/overview")

    /** Villages within [km] of a case, nearest first (staff only; "Warn nearby villages"). */
    fun nearbyVillages(incidentId: Long, km: Double = 5.0): List<NearbyVillage> =
        get("/api/incidents/$incidentId/villages" + query(listOf("km" to km.toString())), ListSerializer(NearbyVillage.serializer()))

    // --- alerts -------------------------------------------------------------

    fun alerts(): List<Alert> = get("/api/alerts", ListSerializer(Alert.serializer()))

    /** Sends a warning, information or all-clear to villages (staff only). */
    fun sendAlert(alert: NewAlert): Alert = send("POST", "/api/alerts", alert)

    // --- plumbing -----------------------------------------------------------

    private inline fun <reified T> get(path: String): T = get(path, serializer<T>())

    private fun <T> get(path: String, out: KSerializer<T>): T = decode(call("GET", path, null), out)

    private inline fun <reified B, reified T> send(method: String, path: String, body: B): T =
        decode(call(method, path, json.encodeToString(serializer<B>(), body)), serializer<T>())

    private fun <T> decode(text: String, out: KSerializer<T>): T = try {
        json.decodeFromString(out, text)
    } catch (e: IllegalArgumentException) { // SerializationException extends it
        throw ApiException(200, "The server sent something this app doesn't understand.", cause = e)
    }

    private fun call(method: String, path: String, body: String?): String {
        val headers = buildMap {
            put("Accept", "application/json")
            put("User-Agent", USER_AGENT)
            if (body != null) put("Content-Type", "application/json; charset=utf-8")
            token?.let { put("Authorization", "Bearer $it") }
        }
        val response = try {
            transport.execute(HttpRequest(method, baseUrl + path, headers, body?.toByteArray(Charsets.UTF_8)))
        } catch (e: IOException) {
            throw NetworkException("Can't reach the HatiAlert server at $baseUrl. Check the connection and the server address.", e)
        }
        if (response.status !in 200..299) throw errorFrom(response)
        return response.body
    }

    companion object {
        const val USER_AGENT = "HatiAlert-JVM/0.1"

        internal val json = Json {
            ignoreUnknownKeys = true
            explicitNulls = false
            encodeDefaults = true
            coerceInputValues = true
        }

        /** Trims spaces and trailing slashes; adds http:// when no scheme is given. */
        fun normalizeBaseUrl(raw: String): String {
            var s = raw.trim()
            require(s.isNotEmpty()) { "Enter the server address." }
            if (!s.contains("://")) s = "http://$s"
            val scheme = s.substringBefore("://").lowercase()
            require(scheme == "http" || scheme == "https") { "The server address must start with http:// or https://" }
            val rest = s.substringAfter("://").trimEnd('/')
            require(rest.isNotEmpty() && !rest.startsWith("/")) { "Enter the server address." }
            return "$scheme://$rest"
        }

        internal fun query(pairs: List<Pair<String, String>>): String =
            if (pairs.isEmpty()) "" else pairs.joinToString("&", prefix = "?") { (k, v) ->
                URLEncoder.encode(k, "UTF-8") + "=" + URLEncoder.encode(v, "UTF-8")
            }

        internal fun errorFrom(r: HttpResponse): ApiException {
            val parsed = try {
                json.parseToJsonElement(r.body) as? JsonObject
            } catch (e: IllegalArgumentException) {
                null
            }
            val message = parsed?.get("error")?.jsonPrimitive?.contentOrNull
                ?: when (r.status) {
                    401 -> "Sign in to continue."
                    403 -> "You can't do this with your account."
                    404 -> "Not found. Check the server address."
                    413 -> "That's too large to send."
                    429 -> "Too many tries. Wait a little and try again."
                    in 500..599 -> "The server had a problem (${r.status}). Try again later."
                    else -> "The server answered ${r.status}."
                }
            val field = parsed?.get("field")?.let { if (it is JsonObject) null else it.jsonPrimitive.contentOrNull }
            return ApiException(r.status, message, field)
        }
    }
}
