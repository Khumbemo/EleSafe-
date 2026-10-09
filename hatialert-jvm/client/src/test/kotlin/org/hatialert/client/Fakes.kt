package org.hatialert.client

import java.io.IOException

/** Records requests and answers from a route table: "METHOD /path" -> (status, body). */
class FakeTransport(private val routes: MutableMap<String, Pair<Int, String>> = mutableMapOf()) : HttpTransport {
    val requests = mutableListOf<HttpRequest>()
    var offline = false

    fun on(method: String, path: String, status: Int = 200, body: String) {
        routes["$method $path"] = status to body
    }

    override fun execute(request: HttpRequest): HttpResponse {
        requests += request
        if (offline) throw IOException("no route to host")
        val path = request.url.substringAfter("://").substringAfter('/', "").let { "/$it" }
        val hit = routes["${request.method} $path"] ?: routes["${request.method} ${path.substringBefore('?')}"]
            ?: return HttpResponse(404, """{"error": "Not found.", "field": null}""")
        return HttpResponse(hit.first, hit.second, "application/json")
    }

    val last get() = requests.last()
    fun bodyOf(r: HttpRequest = last) = r.body?.toString(Charsets.UTF_8)
}

object Json {
    const val USER = """{"id": 1, "name": "Yanbeni Ezung", "phone": "9000000001", "village": "Wozhuro", "role": "villager",
        "radius_km": 5.0, "phone_verified": false, "must_change_pin": false, "sms_alerts": true}"""
    const val GUARD = """{"id": 2, "name": "Guard Renthung", "phone": "9000000002", "village": "Baghty", "role": "guard",
        "radius_km": 10.0, "phone_verified": false, "must_change_pin": false, "sms_alerts": true}"""

    fun incident(id: Long, status: String = "reported", lat: Double = 26.0975, lng: Double = 94.2513, createdAt: Long = 1_790_000_000_000,
                 extra: String = ""): String = """{"id": $id, "type": "crop_raid", "severity": "high", "status": "$status",
        "herd_size": 6, "casualties": 0, "crop_acres": 1.25, "property_inr": 0, "heading": "", "village": "Wozhuro",
        "lat": $lat, "lng": $lng, "place": "", "description": "", "created_at": $createdAt, "updated_at": $createdAt,
        "ref": "HA-2609-${"%04d".format(id)}", "type_label": "Crop raid", "severity_label": "High", "status_label": "Reported",
        "open": ${status in listOf("reported", "verified", "responded")}, "sample": false, "mine": true,
        "attachments": [], "attachments_hidden": 0, "brand_new_field": {"x": 1}$extra}"""

    val META = """{"villages": [
        {"id": 1, "name": "Wokha Town", "lat": 26.09717, "lng": 94.25817, "verified": true, "source": "GeoNames gazetteer"},
        {"id": 2, "name": "Wozhuro", "lat": 26.0912, "lng": 94.2434, "verified": false, "source": "Original app, not verified"}],
      "types": [{"key": "sighting", "label": "Elephant sighted", "local": "Hati dekha"}],
      "severities": [{"key": "critical", "label": "Critical"}],
      "statuses": [{"key": "reported", "label": "Reported", "open": true}],
      "transitions": {"reported": ["verified", "false_report"], "resolved": []},
      "transition_roles": {"verified": ["guard", "officer"]},
      "alert_levels": [{"key": "warning", "label": "Elephant warning"}],
      "directions": ["N", "NE", "E", "SE", "S", "SW", "W", "NW"],
      "limits": {"herd_size": [0, 200], "description": 500},
      "media": {"photo": {"mimes": ["image/jpeg"], "max_bytes": 1500000, "max_count": 6}, "voice_max_seconds": 60},
      "contacts": [], "safety": {"do": [], "dont": []}, "compensation": {"note": ""},
      "sms_enabled": false, "demo_accounts": []}"""

    fun overview(nearby: String) = """{"village": {"id": 2, "name": "Wozhuro", "lat": 26.0912, "lng": 94.2434, "verified": false, "source": "x"},
        "radius_km": 5.0, "nearby": [$nearby], "warning": null, "open_total": 3, "reported_24h": 1, "awaiting_check": 2, "has_sample": true}"""
}
