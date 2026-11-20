package org.hatialert.client.app

import org.hatialert.client.AdminStatus
import org.hatialert.client.AdminUser
import org.hatialert.client.AdminVillage
import org.hatialert.client.NewVillage
import org.hatialert.client.Outbox
import org.hatialert.client.OutboxBatch
import org.hatialert.client.PinReset
import org.hatialert.client.Stats
import org.hatialert.client.UserPatch
import org.hatialert.client.VillageImport
import org.hatialert.client.VillagePatch
import org.hatialert.core.Role

/** The officer screens (the web app's District overview and Admin tabs). */
enum class AdminSection(val label: String) {
    STATS("District"),
    PEOPLE("People"),
    VILLAGES("Villages"),
    MESSAGES("Messages"),
    SYSTEM("System"),
}

/** What the officer screens show; part of [AppState], so it is dropped on sign-out. */
data class AdminData(
    val people: List<AdminUser> = emptyList(),
    val query: String = "",
    /** "" for everyone, else a role key. */
    val role: String = "",
    /** The temporary PIN just made; shown once, until the officer leaves the screen. */
    val tempPin: PinReset? = null,
    val villages: List<AdminVillage> = emptyList(),
    /** After an import: which lines were skipped, or null. */
    val importNote: String? = null,
    val outbox: Outbox? = null,
    val status: AdminStatus? = null,
    val stats: Stats? = null,
    val statsDays: Int = 30,
) {
    /** Active villages whose position nobody has checked yet. */
    val unverifiedVillages: Int get() = villages.count { it.active && !it.verified }
}

/**
 * The add/edit village form. Text stays as typed; [validate] uses the server's
 * rules and messages (api.py post_village / patch_village, `_coords`).
 */
data class VillageForm(
    val name: String = "",
    val lat: String = "",
    val lng: String = "",
    val source: String = "",
    val verified: Boolean = false,
    val active: Boolean = true,
) {
    fun validate(isNew: Boolean): Map<String, String> {
        val e = linkedMapOf<String, String>()
        if (isNew) {
            val n = name.trim()
            when {
                n.isEmpty() -> e["name"] = "This field is required."
                n.length > NAME_MAX -> e["name"] = "Keep this under $NAME_MAX characters."
                n.length < 2 -> e["name"] = "Enter the village name."
            }
        }
        coord(lat, LAT)?.let { e["lat"] = it }
        coord(lng, LNG)?.let { e["lng"] = it }
        val src = source.trim()
        when {
            src.length > SOURCE_MAX -> e["source"] = "Keep this under $SOURCE_MAX characters."
            verified && src.isEmpty() -> e["source"] = if (isNew) "This field is required." else "Say where the position comes from before marking it checked."
        }
        return e
    }

    /** Call only when [validate] (isNew = true) is empty. */
    fun toNew() = NewVillage(name.trim(), lat.trim().toDouble(), lng.trim().toDouble(), source.trim(), verified)

    /** Call only when [validate] (isNew = false) is empty. */
    fun toPatch() = VillagePatch(lat.trim().toDouble(), lng.trim().toDouble(), source.trim(), verified, active)

    companion object {
        /** api.py `App.BOUNDS`: Nagaland and its edge. */
        val LAT = 25.5..27.0
        val LNG = 93.5..95.0
        const val NAME_MAX = 60
        const val SOURCE_MAX = 120

        fun of(v: AdminVillage) = VillageForm(v.name, v.lat.toString(), v.lng.toString(), v.source, v.verified, v.active)

        private fun coord(text: String, range: ClosedFloatingPointRange<Double>): String? {
            val v = text.trim().toDoubleOrNull() ?: return "Enter a number."
            return if (v.isNaN() || v !in range) {
                "Enter a value from ${ReportDraft.plain(range.start)} to ${ReportDraft.plain(range.endInclusive)}."
            } else {
                null
            }
        }
    }
}

/** "To send by hand", "Waiting"... for a text's status (admin.ts MESSAGE_LABEL). */
fun messageStatusLabel(status: String): String = when (status) {
    "queued" -> "Waiting"
    "sent" -> "Sent"
    "failed" -> "Failed"
    "manual" -> "To send by hand"
    else -> status
}

/**
 * Officer actions: people, villages, text messages, system status and district
 * numbers. Works on [AppController]'s state and session, so errors, the busy bar
 * and an expired sign-in behave as everywhere else. The server refuses all of it
 * for anyone but a forest officer.
 */
class AdminController internal constructor(private val app: AppController) {
    private val data get() = app.state.value.admin

    private fun set(change: (AdminData) -> AdminData) = app.update { it.copy(admin = change(it.admin)) }

    private fun say(text: String) = app.update { it.copy(message = UiMessage(text, false)) }

    /** Loads what [section] shows. */
    suspend fun load(section: AdminSection) = when (section) {
        AdminSection.STATS -> loadStats(data.statsDays)
        AdminSection.PEOPLE -> loadPeople()
        AdminSection.VILLAGES -> loadVillages()
        AdminSection.MESSAGES -> loadOutbox()
        AdminSection.SYSTEM -> loadStatus()
    }

    // --- people -------------------------------------------------------------------

    suspend fun loadPeople(query: String = data.query, role: String = data.role) {
        set { it.copy(query = query, role = role) }
        val list = app.call { app.api.users(query.trim().take(40), role) } ?: return
        // A slower answer for an older search must not replace a newer one.
        if (data.query == query && data.role == role) set { it.copy(people = list) }
    }

    suspend fun setRole(id: Long, role: Role): Boolean = patchUser(id, UserPatch(role = role.key()), "Role saved")

    suspend fun setActive(id: Long, on: Boolean): Boolean =
        patchUser(id, UserPatch(active = on), if (on) "Account switched on" else "Account switched off")

    private suspend fun patchUser(id: Long, patch: UserPatch, done: String): Boolean {
        app.call { app.api.updateUser(id, patch) } ?: return false
        say(done)
        loadPeople()
        return true
    }

    /** Makes a temporary PIN; it is in [AdminData.tempPin] until [dismissTempPin] or leaving the screen. */
    suspend fun resetPin(id: Long): PinReset? {
        val r = app.call { app.api.resetUserPin(id) } ?: return null
        set { it.copy(tempPin = r) }
        loadPeople()
        return r
    }

    fun dismissTempPin() = set { it.copy(tempPin = null) }

    suspend fun unlock(id: Long): Boolean {
        app.call { app.api.unlockUser(id) } ?: return false
        say("Unlocked")
        loadPeople()
        return true
    }

    // --- villages -----------------------------------------------------------------

    suspend fun loadVillages() {
        val list = app.call { app.api.adminVillages() } ?: return
        set { it.copy(villages = list) }
    }

    suspend fun addVillage(form: VillageForm): Boolean {
        if (!checked(form, isNew = true)) return false
        app.call(fieldErrors = true) { app.api.addVillage(form.toNew()) } ?: return false
        villagesChanged("Village added")
        return true
    }

    suspend fun saveVillage(id: Long, form: VillageForm): Boolean {
        if (!checked(form, isNew = false)) return false
        app.call(fieldErrors = true) { app.api.updateVillage(id, form.toPatch()) } ?: return false
        villagesChanged("Village saved")
        return true
    }

    /** CSV text with a header row `name,lat,lng[,source]`. */
    suspend fun importVillages(csv: String): VillageImport? {
        if (csv.isBlank()) {
            app.update { it.copy(fieldErrors = mapOf("csv" to "Paste a list with a header row: name,lat,lng,source")) }
            return null
        }
        val r = app.call(fieldErrors = true) { app.api.importVillages(csv) } ?: return null
        villagesChanged("Imported: ${r.added} added, ${r.updated} updated")
        set {
            it.copy(importNote = if (r.skipped > 0) "Skipped ${plural(r.skipped, "line")} with a problem: ${r.skippedLines.joinToString()}" else null)
        }
        return r
    }

    private fun checked(form: VillageForm, isNew: Boolean): Boolean {
        val errors = form.validate(isNew)
        app.update { it.copy(fieldErrors = errors) }
        return errors.isEmpty()
    }

    /** Reloads the list and the app's village list (report form, map, alerts). */
    private suspend fun villagesChanged(done: String) {
        app.update { it.copy(fieldErrors = emptyMap()) }
        say(done)
        loadVillages()
        app.loadMeta()
    }

    // --- text messages ------------------------------------------------------------

    suspend fun loadOutbox() {
        val box = app.call { app.api.outbox() } ?: return
        set { it.copy(outbox = box) }
    }

    /** "Mark all sent": the texts of [batch] that staff send by hand. */
    suspend fun markSent(batch: OutboxBatch): Boolean = mark(batch, from = "manual", to = "sent", done = "Marked sent")

    /** "Try failed again" (only with an SMS service). */
    suspend fun retryFailed(batch: OutboxBatch): Boolean = mark(batch, from = "failed", to = "queued", done = "Trying again")

    private suspend fun mark(batch: OutboxBatch, from: String, to: String, done: String): Boolean {
        val ids = batch.recipients.filter { it.status == from }.map { it.id }
        if (ids.isEmpty()) return false
        app.call { app.api.markMessages(ids, to) } ?: return false
        say(done)
        loadOutbox()
        return true
    }

    // --- system and numbers -------------------------------------------------------------

    suspend fun loadStatus() {
        val st = app.call { app.api.adminStatus() } ?: return
        set { it.copy(status = st) }
    }

    suspend fun loadStats(days: Int = data.statsDays) {
        set { it.copy(statsDays = days) }
        val st = app.call { app.api.stats(days) } ?: return
        if (data.statsDays == days) set { it.copy(stats = st) }
    }

    /** The incidents of the last [days] days as CSV text, or null (the reason is shown). */
    suspend fun exportCsv(days: Int = data.statsDays): String? = app.call { app.api.exportCsv(days) }
}
