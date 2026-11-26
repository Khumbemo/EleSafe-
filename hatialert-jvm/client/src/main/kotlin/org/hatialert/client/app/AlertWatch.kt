package org.hatialert.client.app

import org.hatialert.client.Alert
import org.hatialert.client.ApiException
import org.hatialert.client.HatiClient
import org.hatialert.client.NetworkException
import org.hatialert.client.Overview

/** Ids of warnings already shown as notifications, oldest first. */
interface SeenAlertStore {
    fun load(): List<Long>
    fun save(ids: List<Long>)
}

class MemorySeenAlertStore(private var ids: List<Long> = emptyList()) : SeenAlertStore {
    override fun load() = ids
    override fun save(ids: List<Long>) {
        this.ids = ids
    }
}

/** One notification to show: an active elephant warning for the user's village. */
data class AlertNotice(
    val alertId: Long,
    /** "Elephant warning · Wozhuro" (pass through the translator; the village name is kept). */
    val title: String,
    /** The alert as the forest staff wrote it (never translated). */
    val message: String,
    /** "Wozhuro, Sanis · 2026-10-01 14:05 IST" style detail. */
    val villages: List<String>,
    val sentAt: Long,
    val incidentId: Long?,
)

/** What one background check found. */
sealed interface PollOutcome {
    /** New warnings to show (often none). */
    data class Notices(val notices: List<AlertNotice>) : PollOutcome

    /** The session is gone (signed out elsewhere, expired): stop checking until the next sign-in. */
    data object SignedOut : PollOutcome

    /** No answer, or a server error worth trying again later. */
    data class TryLater(val reason: String) : PollOutcome

    /** The server refused for another reason (e.g. "Choose a new PIN first."): nothing to show. */
    data class Refused(val reason: String) : PollOutcome
}

/**
 * The background warning check (Android runs it every ~15 minutes with WorkManager):
 * asks `/api/overview` for the active warning of the user's village and turns it
 * into a notification once. Mirrors the web app's notify.ts, which watches the same
 * `warning` field: the server reports the newest `warning` sent to the village in
 * the last 24 hours unless an `all_clear` came after it, so information messages,
 * all-clears, alerts for other villages and older warnings that a newer one replaced
 * never notify. Ids already shown are kept in [seen] (the newest [keep]), so a
 * warning is shown at most once however often the check runs, also across restarts.
 * Plain Kotlin: unit-tested on the JVM and against the real Python server.
 */
class AlertWatch(private val seen: SeenAlertStore, private val keep: Int = 50) {

    /** Fetches the overview with [client] (its token must be set) and returns what is new. Blocking. */
    fun poll(client: HatiClient): PollOutcome {
        if (client.token == null) return PollOutcome.SignedOut
        val ov = try {
            client.overview()
        } catch (e: NetworkException) {
            return PollOutcome.TryLater(e.message ?: "No connection.")
        } catch (e: ApiException) {
            return when {
                e.isUnauthorized -> PollOutcome.SignedOut
                e.status == 408 || e.status == 429 || e.status >= 500 -> PollOutcome.TryLater(e.message ?: "")
                else -> PollOutcome.Refused(e.message ?: "")
            }
        }
        return PollOutcome.Notices(newNotices(ov))
    }

    /** The overview's active warning if it was not shown before; records it as shown. */
    fun newNotices(ov: Overview): List<AlertNotice> {
        val w = ov.warning?.takeIf { isNotifiable(it, ov) } ?: return emptyList()
        val ids = seen.load()
        if (w.id in ids) return emptyList()
        seen.save((ids + w.id).takeLast(keep))
        return listOf(
            AlertNotice(
                alertId = w.id,
                title = "${w.levelLabel.ifEmpty { "Elephant warning" }} · ${ov.village.name}",
                message = w.message,
                villages = w.villages,
                sentAt = w.sentAt,
                incidentId = w.incidentId,
            ),
        )
    }

    /** Marks [ids] as shown without notifying (e.g. warnings already seen in the open app). */
    fun markSeen(ids: Collection<Long>) {
        val have = seen.load()
        val add = ids.filter { it !in have }
        if (add.isNotEmpty()) seen.save((have + add).takeLast(keep))
    }

    private fun isNotifiable(a: Alert, ov: Overview): Boolean =
        a.level == "warning" && (a.affectsMe || ov.village.name in a.villages)
}
