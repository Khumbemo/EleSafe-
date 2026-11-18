package org.hatialert.client.app

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import org.hatialert.client.NewAttachment
import org.hatialert.client.NewIncident
import org.hatialert.core.MediaKind
import kotlin.io.encoding.Base64

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
) {
    /** The exact body for POST /api/incidents. */
    fun toRequest(): NewIncident = report.copy(
        clientId = clientId,
        attachments = photos.map { NewAttachment(MediaKind.PHOTO.key(), Base64.encode(it)) }.ifEmpty { null },
    )

    companion object {
        /** Splits a request (as built by [ReportDraft.toRequest]) into a queue entry. */
        fun of(request: NewIncident, photos: List<ByteArray>, userId: Long, queuedAt: Long = System.currentTimeMillis()) =
            PendingReport(requireNotNull(request.clientId) { "client_id" }, userId, request.copy(attachments = null), photos, queuedAt)
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
            val photos = try {
                e.photos.map { File(dir, it).readBytes() }
            } catch (_: IOException) {
                return@mapNotNull null // a photo file is gone; the report can't be sent as taken
            }
            PendingReport(e.clientId, e.userId, e.report, photos, e.queuedAt)
        }
    }

    override fun save(items: List<PendingReport>) {
        if (!dir.isDirectory && !dir.mkdirs()) throw IOException("Can't create $dir")
        val entries = items.map { item ->
            val names = item.photos.mapIndexed { i, bytes ->
                val name = "${safe(item.clientId)}-$i.photo"
                val f = File(dir, name)
                // A queued photo never changes, so one already in place is kept.
                if (!(f.isFile && f.length() == bytes.size.toLong())) writeAtomically(f, bytes)
                name
            }
            Entry(item.clientId, item.userId, item.report.copy(attachments = null), names, item.queuedAt)
        }
        writeAtomically(index, json.encodeToString(ListSerializer(Entry.serializer()), entries).toByteArray(Charsets.UTF_8))
        val keep = entries.flatMap { it.photos }.toSet()
        dir.listFiles()?.forEach { f ->
            if (f.name.endsWith(".photo") && f.name !in keep) f.delete()
            if (f.name.endsWith(".tmp")) f.delete()
        }
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
