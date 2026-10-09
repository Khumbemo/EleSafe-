package org.hatialert.client

import java.io.IOException
import java.net.HttpURLConnection
import java.net.ProtocolException
import java.net.URI

/** One HTTP exchange. [body] is sent as-is (the client always sends JSON). */
class HttpRequest(
    val method: String,
    val url: String,
    val headers: Map<String, String> = emptyMap(),
    val body: ByteArray? = null,
)

class HttpResponse(val status: Int, val body: String, val contentType: String? = null)

/** How [HatiClient] talks to the network; swap it out in tests. Blocking. */
fun interface HttpTransport {
    @Throws(IOException::class)
    fun execute(request: HttpRequest): HttpResponse
}

/**
 * [HttpTransport] on [HttpURLConnection], which exists on every JVM and on Android.
 *
 * Android's implementation accepts PATCH. The JDK's rejects it; there the
 * method is set reflectively, which needs `--add-opens java.base/java.net=ALL-UNNAMED`
 * (this project's tests pass it). Without that, PATCH fails with a [ProtocolException]
 * that says so.
 */
class UrlConnectionTransport(
    private val connectTimeoutMs: Int = 15_000,
    private val readTimeoutMs: Int = 30_000,
) : HttpTransport {

    override fun execute(request: HttpRequest): HttpResponse {
        val conn = URI(request.url).toURL().openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = connectTimeoutMs
            conn.readTimeout = readTimeoutMs
            conn.useCaches = false
            conn.instanceFollowRedirects = false
            setMethod(conn, request.method)
            for ((k, v) in request.headers) conn.setRequestProperty(k, v)
            val body = request.body
            if (body != null) {
                conn.doOutput = true
                conn.setFixedLengthStreamingMode(body.size)
                conn.outputStream.use { it.write(body) }
            }
            val status = conn.responseCode
            val stream = if (status >= 400) conn.errorStream else conn.inputStream
            val text = stream?.use { it.readBytes().toString(Charsets.UTF_8) } ?: ""
            return HttpResponse(status, text, conn.contentType)
        } finally {
            conn.disconnect()
        }
    }

    private fun setMethod(conn: HttpURLConnection, method: String) {
        try {
            conn.requestMethod = method
        } catch (refused: ProtocolException) {
            forceMethod(conn, method, refused)
        }
    }

    private fun forceMethod(conn: HttpURLConnection, method: String, refused: ProtocolException) {
        try {
            val field = HttpURLConnection::class.java.getDeclaredField("method")
            field.isAccessible = true
            field.set(conn, method)
            // HTTPS on the JDK wraps a second connection object that does the work.
            var c: Class<*>? = conn.javaClass
            while (c != null && c != HttpURLConnection::class.java) {
                val delegate = c.declaredFields.firstOrNull { it.name == "delegate" }
                if (delegate != null) {
                    delegate.isAccessible = true
                    (delegate.get(conn) as? HttpURLConnection)?.let { field.set(it, method) }
                    break
                }
                c = c.superclass
            }
        } catch (e: Exception) {
            throw ProtocolException(
                "This JVM's HttpURLConnection refuses $method. Run with " +
                    "--add-opens java.base/java.net=ALL-UNNAMED, or give HatiClient another HttpTransport. (${refused.message})",
            ).apply { initCause(e) }
        }
    }
}
