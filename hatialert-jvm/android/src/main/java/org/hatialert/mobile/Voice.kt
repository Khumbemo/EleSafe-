package org.hatialert.mobile

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.os.Build
import androidx.core.content.ContextCompat
import java.io.File
import java.io.IOException
import org.hatialert.core.MediaKind

/**
 * Records a voice note with the platform [MediaRecorder]: AAC in an MPEG-4
 * (M4A) file, which the server takes as `audio/mp4` (its `sniff_media` looks
 * for `ftyp` at byte 4). Mono, 22.05 kHz, 32 kbit/s: a full minute is about
 * 240 KB, far under the 2 MB limit. Stops by itself after
 * [MediaKind.VOICE_MAX_SECONDS]. Use from the main thread.
 */
class VoiceRecorder(private val context: Context) {
    private var recorder: MediaRecorder? = null
    private var file: File? = null

    val isRecording: Boolean get() = recorder != null

    /**
     * Starts recording; false when the microphone can't be used (no permission, no
     * microphone, in use by another app). [onLimit] runs when the time or size limit stops it.
     */
    @SuppressLint("MissingPermission") // RECORD_AUDIO is checked on the first lines
    fun start(onLimit: () -> Unit): Boolean {
        if (recorder != null) return true
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) return false
        val dir = File(context.cacheDir, "voice").apply { mkdirs() }
        val f = File(dir, "rec-${System.currentTimeMillis()}.m4a")
        val r = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MediaRecorder(context) else legacyRecorder()
        try {
            r.setAudioSource(MediaRecorder.AudioSource.MIC)
            r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            r.setAudioChannels(1)
            r.setAudioSamplingRate(22_050)
            r.setAudioEncodingBitRate(32_000)
            r.setMaxDuration(MediaKind.VOICE_MAX_SECONDS * 1000)
            r.setMaxFileSize(MediaKind.VOICE.maxBytes() - 16_384L)
            r.setOutputFile(f.path)
            r.setOnInfoListener { _, what, _ ->
                if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED || what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_REACHED) onLimit()
            }
            r.prepare()
            r.start()
        } catch (e: IOException) {
            return failed(r, f)
        } catch (e: RuntimeException) { // IllegalStateException, SecurityException, no microphone
            return failed(r, f)
        }
        recorder = r
        file = f
        return true
    }

    /** Stops and returns the recording, or null when nothing usable was recorded (e.g. stopped at once). */
    fun stop(): ByteArray? {
        val r = recorder ?: return null
        val f = file
        recorder = null
        file = null
        try {
            r.stop()
        } catch (e: RuntimeException) {
            // Thrown when no audio was captured, or after the limit already stopped it; the file decides.
        } finally {
            r.release()
        }
        if (f == null) return null
        return try {
            val bytes = f.readBytes()
            if (bytes.size > 64 && MediaKind.sniff(bytes.copyOf(16)) in MediaKind.VOICE.mimes()) bytes else null
        } catch (e: IOException) {
            null
        } finally {
            f.delete()
        }
    }

    /** Throws the recording away. */
    fun cancel() {
        val r = recorder ?: return
        recorder = null
        try {
            r.stop()
        } catch (e: RuntimeException) {
            // nothing recorded
        } finally {
            r.release()
            file?.delete()
            file = null
        }
    }

    private fun failed(r: MediaRecorder, f: File): Boolean {
        r.release()
        f.delete()
        return false
    }

    @Suppress("DEPRECATION") // the Context constructor needs API 31
    private fun legacyRecorder() = MediaRecorder()

    companion object {
        const val PERMISSION = Manifest.permission.RECORD_AUDIO

        fun hasPermission(context: Context) =
            ContextCompat.checkSelfPermission(context, PERMISSION) == PackageManager.PERMISSION_GRANTED

        /** File name extension for a voice note's media type, so the player recognises it. */
        fun extension(mime: String): String = when (mime) {
            "audio/mp4" -> "m4a"
            "audio/ogg" -> "ogg"
            "audio/webm" -> "webm"
            "audio/mpeg" -> "mp3"
            "audio/wav" -> "wav"
            else -> "bin"
        }
    }
}

/**
 * Plays one voice note from memory with the platform [MediaPlayer] (written to a
 * cache file first, which every Android version can open). Use from the main thread.
 */
class VoicePlayer(private val context: Context) {
    private var player: MediaPlayer? = null
    private var file: File? = null

    val isPlaying: Boolean get() = player != null

    /** Starts playing; [onEnd] runs when it finishes or fails. False when it can't be played. */
    fun play(bytes: ByteArray, mime: String, onEnd: () -> Unit): Boolean {
        stop()
        val dir = File(context.cacheDir, "voice").apply { mkdirs() }
        val f = File(dir, "play-${System.nanoTime()}.${VoiceRecorder.extension(mime)}")
        val p = MediaPlayer()
        try {
            f.writeBytes(bytes)
            p.setDataSource(f.path)
            p.setOnCompletionListener {
                stop()
                onEnd()
            }
            p.setOnErrorListener { _, _, _ ->
                stop()
                onEnd()
                true
            }
            p.setOnPreparedListener { it.start() }
            p.prepareAsync()
        } catch (e: IOException) {
            p.release()
            f.delete()
            return false
        } catch (e: RuntimeException) {
            p.release()
            f.delete()
            return false
        }
        player = p
        file = f
        return true
    }

    fun stop() {
        player?.let {
            try {
                it.stop()
            } catch (e: IllegalStateException) {
                // not started yet
            }
            it.release()
        }
        player = null
        file?.delete()
        file = null
    }
}
