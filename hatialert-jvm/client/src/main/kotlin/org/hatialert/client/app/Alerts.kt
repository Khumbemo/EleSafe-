package org.hatialert.client.app

import org.hatialert.client.AlertSms
import org.hatialert.client.Incident
import org.hatialert.client.NearbyVillage
import org.hatialert.client.NewAlert
import org.hatialert.core.Limits

/**
 * The alert form for forest staff (alerts.ts compose). [validate] repeats the
 * server's checks and messages (api.py post_alert) before anything is sent.
 */
data class AlertDraft(
    val level: String = "warning",
    val message: String = "",
    val villages: Set<String> = emptySet(),
    /** The case this alert is about, when it was started from one. */
    val incidentId: Long? = null,
) {
    fun toggle(village: String) = copy(villages = if (village in villages) villages - village else villages + village)

    /** Field -> message; empty when the alert can be sent. */
    fun validate(knownVillages: List<String>, levels: List<String> = LEVELS): Map<String, String> {
        val e = linkedMapOf<String, String>()
        if (level !in levels) e["level"] = "Choose an alert type."
        val text = message.trim()
        when {
            text.isEmpty() -> e["message"] = "This field is required."
            text.length > Limits.MESSAGE_MAX -> e["message"] = "Keep this under ${Limits.MESSAGE_MAX} characters."
        }
        if (villages.isEmpty() || villages.any { it !in knownVillages }) e["villages"] = "Pick at least one village."
        return e
    }

    /** The request body, villages in the server's list order. */
    fun toRequest(knownVillages: List<String>): NewAlert =
        NewAlert(level, message.trim(), knownVillages.filter { it in villages } + villages.filter { it !in knownVillages }, incidentId)

    companion object {
        /** domain.py ALERT_LEVELS, used until /api/meta has been loaded. */
        val LEVELS = listOf("warning", "info", "all_clear")

        /** "Warn nearby villages" covers villages this close to the case (as the web app). */
        const val NEARBY_KM = 5.0

        /** The web app's prefilled warning for a case (cases.ts `warn`). */
        fun warningFor(i: Incident, near: List<NearbyVillage>): AlertDraft {
            val herd = if (i.herdSize > 0) "About ${plural(i.herdSize, "elephant")}" else "Elephants"
            val where = "near ${i.village}" + if (i.place.isNotBlank()) " (${i.place})" else ""
            val heading = if (i.heading.isNotEmpty()) ", moving ${i.heading}" else ""
            return AlertDraft(
                level = "warning",
                incidentId = i.id,
                villages = near.map { it.name }.toSet(),
                message = "$herd reported $where$heading. Keep away from the fields and stay indoors after dark.",
            )
        }

        /** What happened to the texts of a sent alert (the web app's toast). */
        fun sentNote(sms: AlertSms?): String {
            val n = sms?.recipients ?: 0
            return when {
                n == 0 -> "Alert sent"
                sms?.mode == "manual" -> "Alert sent. ${plural(n, "person", "people")} to text by hand (Admin > Messages)"
                else -> "Alert sent. Texting ${plural(n, "person", "people")}"
            }
        }
    }
}

/** util.ts `plural`: "1 person", "3 people", "2 elephants". */
fun plural(n: Int, one: String, many: String = one + "s"): String = "$n ${if (n == 1) one else many}"
