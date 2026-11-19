package org.hatialert.client.app

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import org.hatialert.client.NewIncident

/**
 * A report that could not reach the server, waiting on the phone to be sent
 * (the web app's `QueuedReport` in offline.ts). [report] is the request body
 * without its photos; [photos] are kept apart so a store can put them in files.
 * [clientId] is the report's `client_id`, so a resend can never create a second case.
 */
class PendingReport(
    val clientId: String,
    val userId: Long,
    val report: NewIncident,
    val photos: List<ByteArray> = emptyList(),
    val queuedAt: Long = System.currentTimeMillis(),
    val voices: List<ByteArray> = emptyList(),
) {
    /** The exact body for POST /api/incidents. */
    fun toRequest(): NewIncident = report.copy(clientId = clientId, attachments = ReportDraft.attachmentsOf(photos, voices))

    companion object {
        /** Splits a request (as built by [ReportDraft.toRequest]) into a queue entry. */
        fun of(
            request: NewIncident,
            photos: List<ByteArray>,
            userId: Long,
            queuedAt: Long = System.currentTimeMillis(),
            voices: List<ByteArray> = emptyList(),
        ) = PendingReport(requireNotNull(request.clientId) { "client_id" }, userId, request.copy(attachments = null), photos, queuedAt, voices)
    }
}

/**
 * Where [PendingReport]s wait, oldest first. Blocking; [AppController] calls it
 * off the main thread and never from two coroutines at once.
 */
interface OutboxStore {
    fun load(): List<PendingReport>
    fun save(items: List<PendingReport>)
}

class MemoryOutboxStore(items: List<PendingReport> = emptyList()) : OutboxStore {
    @Volatile
    private var items: List<PendingReport> = items.toList()
    override fun load() = items
    override fun save(items: List<PendingReport>) {
        this.items = items.toList()
    }
}

/**
 * [OutboxStore] in a folder (on Android, under `filesDir`): an `outbox.json`
 * index plus one file per photo, so large photos are never base64'd into the
 * index. Every file is written to a temporary name and renamed into place,
 * photos before the index that names them, so a crash or a full disk leaves
 * either the old queue or the new one, never half of one. Uses only `java.io`
 * (no `java.nio.file`, which needs API 26 on Android).
 */
class FileOutboxStore(private val dir: File) : OutboxStore {
    private val index = File(dir, "outbox.json")

    @Serializable
    private class Entry(
        @SerialName("client_id") val clientId: String,
        @SerialName("user_id") val userId: Long,
        val report: NewIncident,
        val photos: List<String>,
        @SerialName("queued_at") val queuedAt: Long,
        /** Added with voice notes; an index written before has none. */
        val voices: List<String> = emptyList(),
    )

    override fun load(): List<PendingReport> {
        if (!index.isFile) return emptyList()
        val entries = try {
            json.decodeFromString(ListSerializer(Entry.serializer()), index.readText(Charsets.UTF_8))
        } catch (e: IOException) {
            return emptyList()
        } catch (e: IllegalArgumentException) { // SerializationException extends it: a damaged index
            return emptyList()
        }
        return entries.mapNotNull { e ->
            val (photos, voices) = try {
                e.photos.map { File(dir, it).readBytes() } to e.voices.map { File(dir, it).readBytes() }
            } catch (_: IOException) {
                return@mapNotNull null // a file is gone; the report can't be sent as made
            }
            PendingReport(e.clientId, e.userId, e.report, photos, e.queuedAt, voices)
        }
    }

    override fun save(items: List<PendingReport>) {
        if (!dir.isDirectory && !dir.mkdirs()) throw IOException("Can't create $dir")
        val entries = items.map { item ->
            Entry(
                item.clientId, item.userId, item.report.copy(attachments = null),
                files(item.clientId, item.photos, "photo"), item.queuedAt, files(item.clientId, item.voices, "voice"),
            )
        }
        writeAtomically(index, json.encodeToString(ListSerializer(Entry.serializer()), entries).toByteArray(Charsets.UTF_8))
        val keep = entries.flatMap { it.photos + it.voices }.toSet()
        dir.listFiles()?.forEach { f ->
            if ((f.name.endsWith(".photo") || f.name.endsWith(".voice")) && f.name !in keep) f.delete()
            if (f.name.endsWith(".tmp")) f.delete()
        }
    }

    /** Writes each file as `<client id>-<n>.<ext>` and returns the names. */
    private fun files(clientId: String, blobs: List<ByteArray>, ext: String): List<String> = blobs.mapIndexed { i, bytes ->
        val name = "${safe(clientId)}-$i.$ext"
        val f = File(dir, name)
        // A queued file never changes, so one already in place is kept.
        if (!(f.isFile && f.length() == bytes.size.toLong())) writeAtomically(f, bytes)
        name
    }

    private fun writeAtomically(target: File, bytes: ByteArray) {
        val tmp = File(target.parentFile, target.name + ".tmp")
        FileOutputStream(tmp).use { out ->
            out.write(bytes)
            out.fd.sync()
        }
        // rename() replaces the target atomically on Linux/Android; elsewhere fall back to delete + rename.
        if (!tmp.renameTo(target) && !(target.delete() && tmp.renameTo(target))) {
            tmp.delete()
            throw IOException("Can't write $target")
        }
    }

    private companion object {
        val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

        /** Client ids are `[A-Za-z0-9_-]`; anything else is kept out of file names. */
        fun safe(id: String) = if (Regex("[A-Za-z0-9_-]{1,64}").matches(id)) id else "h" + Integer.toHexString(id.hashCode())
    }
}
