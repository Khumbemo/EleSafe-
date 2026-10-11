package org.hatialert.client

import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

/** The real HttpURLConnection path against a local JDK HTTP server. */
class UrlConnectionTransportTest {
    private lateinit var server: HttpServer
    private val seen = mutableListOf<String>()
    private val base get() = "http://127.0.0.1:${server.address.port}"

    @BeforeTest
    fun start() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { ex ->
            val body = ex.requestBody.readBytes().toString(Charsets.UTF_8)
            seen += "${ex.requestMethod} ${ex.requestURI} ${ex.requestHeaders.getFirst("Authorization")} $body"
            val (status, out) = when (ex.requestURI.path) {
                "/missing", "/api/incidents/404" -> 404 to """{"error": "No incident with that number.", "field": null}"""
                else -> 200 to """{"echo": ${body.ifEmpty { "null" }}}"""
            }
            val bytes = out.toByteArray()
            ex.responseHeaders.add("Content-Type", "application/json")
            ex.sendResponseHeaders(status, bytes.size.toLong())
            ex.responseBody.use { it.write(bytes) }
        }
        server.start()
    }

    @AfterTest
    fun stop() = server.stop(0)

    @Test
    fun getPostPatchAndErrorBodies() {
        val t = UrlConnectionTransport()
        assertEquals(200, t.execute(HttpRequest("GET", "$base/a?x=1", mapOf("Authorization" to "Bearer t"))).status)
        val post = t.execute(HttpRequest("POST", "$base/b", emptyMap(), """{"a":1}""".toByteArray()))
        assertEquals("""{"echo": {"a":1}}""", post.body)
        val patch = t.execute(HttpRequest("PATCH", "$base/c", emptyMap(), """{"status":"verified"}""".toByteArray()))
        assertEquals(200, patch.status)
        val missing = t.execute(HttpRequest("GET", "$base/missing"))
        assertEquals(404, missing.status)
        assertEquals("""{"error": "No incident with that number.", "field": null}""", missing.body)
        assertEquals(
            listOf("GET /a?x=1 Bearer t ", "POST /b null {\"a\":1}", "PATCH /c null {\"status\":\"verified\"}", "GET /missing null "),
            seen,
        )
    }

    @Test
    fun clientSurfacesServerMessage() {
        val c = HatiClient(base, UrlConnectionTransport())
        val e = assertFailsWith<ApiException> { c.incident(404) }
        assertEquals(404, e.status)
        assertEquals("No incident with that number.", e.message)
    }

    @Test
    fun unreachableServerIsNetworkException() {
        val port = server.address.port
        server.stop(0)
        val c = HatiClient("http://127.0.0.1:$port", UrlConnectionTransport(connectTimeoutMs = 2000, readTimeoutMs = 2000))
        assertFailsWith<NetworkException> { c.meta() }
    }
}
