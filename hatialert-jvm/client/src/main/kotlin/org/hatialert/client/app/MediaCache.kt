package org.hatialert.client.app

/**
 * Downloaded photos and voice notes by attachment id, least recently used
 * dropped first once more than [maxBytes] are held (a single file larger than
 * that is not kept). Thread-safe. The app clears it on sign-out, since the next
 * account may not be allowed to see these files.
 */
class MediaCache(private val maxBytes: Long = 12_000_000) {
    private val map = LinkedHashMap<Long, ByteArray>(16, 0.75f, true) // access order
    private var bytes = 0L

    @Synchronized
    fun get(id: Long): ByteArray? = map[id]

    @Synchronized
    fun put(id: Long, data: ByteArray) {
        map.remove(id)?.let { bytes -= it.size }
        if (data.size > maxBytes) return
        map[id] = data
        bytes += data.size
        val it = map.entries.iterator()
        while (bytes > maxBytes && it.hasNext()) {
            val e = it.next()
            bytes -= e.value.size
            it.remove()
        }
    }

    @Synchronized
    fun clear() {
        map.clear()
        bytes = 0
    }

    @get:Synchronized
    val size: Int get() = map.size

    @get:Synchronized
    val totalBytes: Long get() = bytes
}
