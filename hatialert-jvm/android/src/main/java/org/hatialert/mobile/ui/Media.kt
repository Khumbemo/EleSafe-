package org.hatialert.mobile.ui

import android.content.ActivityNotFoundException
import android.graphics.Bitmap
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import java.io.File
import java.io.IOException
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.hatialert.client.Attachment
import org.hatialert.client.Incident
import org.hatialert.core.MediaKind
import org.hatialert.mobile.AppViewModel
import org.hatialert.mobile.Photos
import org.hatialert.mobile.VoicePlayer
import org.hatialert.mobile.VoiceRecorder

/**
 * A "take a photo" action through the phone's camera app; the shrunk JPEG goes to
 * [onPhoto], problems to [onError]. Returns the function to call from a button.
 */
@Composable
fun rememberPhotoCapture(onPhoto: (ByteArray) -> Unit, onError: (String) -> Unit): () -> Unit {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var pendingPhoto by rememberSaveable { mutableStateOf<String?>(null) }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { saved ->
        val path = pendingPhoto
        pendingPhoto = null
        if (saved && path != null) {
            scope.launch {
                try {
                    onPhoto(withContext(Dispatchers.IO) { Photos.shrink(File(path)) })
                } catch (e: IOException) {
                    onError(e.message ?: "Couldn't read the photo.")
                }
            }
        } else if (path != null) {
            File(path).delete()
        }
    }
    return {
        try {
            val (file, uri) = Photos.newCaptureTarget(context)
            pendingPhoto = file.path
            camera.launch(uri)
        } catch (e: ActivityNotFoundException) {
            pendingPhoto = null
            onError("No camera app found on this phone.")
        } catch (e: IllegalArgumentException) {
            pendingPhoto = null
            onError("Couldn't prepare a file for the photo.")
        }
    }
}

/**
 * "Record voice note": asks for the microphone the first time, records up to
 * [MediaKind.VOICE_MAX_SECONDS] with a running count, and hands the M4A bytes to [onDone].
 */
@Composable
fun VoiceRecordButton(enabled: Boolean, onDone: (ByteArray) -> Unit, onError: (String) -> Unit) {
    val context = LocalContext.current
    val recorder = remember { VoiceRecorder(context) }
    var recording by remember { mutableStateOf(false) }
    var seconds by remember { mutableIntStateOf(0) }
    val max = MediaKind.VOICE_MAX_SECONDS

    fun finish() {
        recording = false
        val bytes = recorder.stop()
        if (bytes == null) onError("Nothing was recorded. Hold the phone near your mouth and try again.") else onDone(bytes)
    }

    fun begin() {
        if (recorder.start(onLimit = { if (recording) finish() })) {
            seconds = 0
            recording = true
        } else {
            onError("Couldn't use the microphone. Check that HatiAlert may record audio.")
        }
    }

    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) begin() else onError("Microphone permission refused. You can still write what you saw in the notes.")
    }

    LaunchedEffect(recording) {
        while (recording) {
            delay(1000)
            seconds++
            if (seconds >= max + 2) finish() // the recorder's own limit should have stopped it already
        }
    }
    DisposableEffect(Unit) { onDispose { recorder.cancel() } }

    if (recording) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(String.format(Locale.ROOT, "Recording %d:%02d / %d:%02d", seconds / 60, seconds % 60, max / 60, max % 60), color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.Bold)
            OutlinedButton(onClick = { finish() }) { Text("Stop") }
            TextButton(onClick = {
                recording = false
                recorder.cancel()
            }) { Text("Cancel") }
        }
    } else {
        OutlinedButton(enabled = enabled, onClick = {
            if (VoiceRecorder.hasPermission(context)) begin() else permission.launch(VoiceRecorder.PERMISSION)
        }) { Text("Record voice note") }
    }
}

/** Play / Stop for one voice note; [load] fetches its bytes (from memory or the server). */
@Composable
fun VoicePlayButton(key: Any, mime: String, label: String, load: suspend () -> ByteArray?) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val player = remember(key) { VoicePlayer(context) }
    var playing by remember(key) { mutableStateOf(false) }
    var problem by remember(key) { mutableStateOf<String?>(null) }
    DisposableEffect(key) { onDispose { player.stop() } }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(onClick = {
            if (playing) {
                player.stop()
                playing = false
            } else {
                scope.launch {
                    val bytes = load() ?: return@launch
                    playing = player.play(bytes, mime) { playing = false }
                    problem = if (playing) null else "This phone can't play that recording."
                }
            }
        }) { Text(if (playing) "Stop" else "Play") }
        Column {
            Text(label)
            problem?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
        }
    }
}

/** Photo from memory or the server, decoded small and kept in [AppViewModel.thumbnails]. */
@Composable
private fun PhotoThumb(a: Attachment, vm: AppViewModel, onOpen: () -> Unit) {
    val p = LocalPalette.current
    var bmp by remember(a.id) { mutableStateOf<Bitmap?>(vm.thumbnails.get(a.id)) }
    LaunchedEffect(a.id) {
        if (bmp == null) {
            val bytes = vm.controller.attachmentBytes(a.id) ?: return@LaunchedEffect
            bmp = withContext(Dispatchers.Default) { Photos.thumbnail(bytes, THUMB_PX) }?.also { vm.thumbnails.put(a.id, it) }
        }
    }
    Box(
        Modifier.size(104.dp).clip(RoundedCornerShape(8.dp)).background(argb(p.sunken)).clickable(onClick = onOpen),
        contentAlignment = Alignment.Center,
    ) {
        val b = bmp
        if (b != null) {
            Image(b.asImageBitmap(), contentDescription = "Photo, tap to see it full size", contentScale = ContentScale.Crop, modifier = Modifier.size(104.dp))
        } else {
            Text("Loading...", style = MaterialTheme.typography.bodySmall, color = argb(p.muted))
        }
    }
}

/** One photo over the whole screen; tap or back to close. */
@Composable
private fun PhotoViewer(id: Long, vm: AppViewModel, onClose: () -> Unit) {
    var bmp by remember(id) { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(id) {
        val bytes = vm.controller.attachmentBytes(id) ?: return@LaunchedEffect onClose()
        bmp = withContext(Dispatchers.Default) { Photos.thumbnail(bytes, FULL_PX) }
    }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize().background(Color.Black).clickable(onClick = onClose), contentAlignment = Alignment.Center) {
            val b = bmp
            if (b != null) {
                Image(b.asImageBitmap(), contentDescription = "Photo", contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize())
            } else {
                Text("Loading...", color = Color.White)
            }
        }
    }
}

/**
 * The photos and voice notes of a case, as the server lets this person see them:
 * the reporter and forest staff get the files, everyone else only how many there are.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun CaseMedia(i: Incident, vm: AppViewModel) {
    val p = LocalPalette.current
    val c = vm.controller
    var viewing by rememberSaveable(i.id) { mutableStateOf<Long?>(null) }
    var note by remember(i.id) { mutableStateOf<String?>(null) }
    val takePhoto = rememberPhotoCapture(
        onPhoto = { bytes -> vm.act { c.attachToCase(i.id, MediaKind.PHOTO, bytes) } },
        onError = { note = it },
    )

    if (i.attachmentsHidden > 0) {
        Text(
            "${i.attachmentsHidden} ${if (i.attachmentsHidden == 1) "photo or voice note" else "photos or voice notes"}, seen only by the reporter and forest staff.",
            style = MaterialTheme.typography.bodySmall, color = argb(p.muted),
        )
    }
    val canAttach = i.canAttach == true
    if (i.attachments.isEmpty() && !canAttach) return

    Text("Photos and voice notes", style = MaterialTheme.typography.titleMedium)
    val photos = i.attachments.filter { it.kind == MediaKind.PHOTO.key() }
    val voices = i.attachments.filter { it.kind == MediaKind.VOICE.key() }
    if (i.attachments.isEmpty()) Text("None yet.", style = MaterialTheme.typography.bodySmall, color = argb(p.muted))
    if (photos.isNotEmpty()) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            for (a in photos) PhotoThumb(a, vm) { viewing = a.id }
        }
    }
    voices.forEachIndexed { n, a ->
        VoicePlayButton(a.id, a.mime, "Voice note ${n + 1} · ${kb(a.size)} · ${istTime(a.createdAt)}") { c.attachmentBytes(a.id) }
    }
    if (canAttach) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            OutlinedButton(enabled = photos.size < MediaKind.PHOTO.maxCount(), onClick = takePhoto) { Text("Add photo") }
            VoiceRecordButton(
                enabled = voices.size < MediaKind.VOICE.maxCount(),
                onDone = { bytes -> vm.act { c.attachToCase(i.id, MediaKind.VOICE, bytes) } },
                onError = { note = it },
            )
        }
    }
    note?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = argb(p.muted), modifier = Modifier.padding(top = 2.dp)) }
    viewing?.let { id -> PhotoViewer(id, vm) { viewing = null } }
}

/** "48 KB", "1.2 MB". */
fun kb(bytes: Long): String =
    if (bytes >= 1_000_000) String.format(Locale.ROOT, "%.1f MB", bytes / 1_000_000.0) else "${(bytes + 999) / 1000} KB"

private const val THUMB_PX = 320
private const val FULL_PX = 2048
