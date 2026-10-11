package org.hatialert.mobile.ui

import android.content.ActivityNotFoundException
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import java.io.File
import java.io.IOException
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.hatialert.client.app.AppState
import org.hatialert.client.app.nearestVillage
import org.hatialert.core.IncidentType
import org.hatialert.core.LatLng
import org.hatialert.core.MediaKind
import org.hatialert.mobile.AppViewModel
import org.hatialert.mobile.Gps
import org.hatialert.mobile.Photos

@OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)
@Composable
fun ReportScreen(st: AppState, vm: AppViewModel) {
    val c = vm.controller
    val d = st.draft
    val err = st.fieldErrors
    val p = LocalPalette.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var gpsBusy by remember { mutableStateOf(false) }
    var gpsNote by remember { mutableStateOf<String?>(null) }
    var pendingPhoto by rememberSaveable { mutableStateOf<String?>(null) }

    LaunchedEffect(st.user?.village) {
        if (d.village == null) st.user?.village?.let { v -> c.editDraft { it.copy(village = v) } }
    }

    fun locate() {
        gpsBusy = true
        gpsNote = "Getting your position..."
        scope.launch {
            val loc = Gps.currentLocation(context)
            gpsBusy = false
            if (loc == null) {
                gpsNote = "No position. Turn on location, or use distance from a village."
            } else {
                gpsNote = null
                c.editDraft { it.copy(useGps = true, gps = LatLng(loc.latitude, loc.longitude), gpsAccuracyM = if (loc.hasAccuracy()) loc.accuracy else null) }
            }
        }
    }

    val permissions = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { grants ->
        if (grants.values.any { it }) locate() else gpsNote = "Location permission refused. Use distance from a village instead."
    }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { saved ->
        val path = pendingPhoto
        pendingPhoto = null
        if (saved && path != null) {
            scope.launch {
                try {
                    val bytes = withContext(Dispatchers.IO) { Photos.shrink(File(path)) }
                    c.editDraft { it.copy(photos = it.photos + bytes) }
                } catch (e: IOException) {
                    gpsNote = e.message
                }
            }
        } else if (path != null) {
            File(path).delete()
        }
    }

    Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("What happened?", style = MaterialTheme.typography.titleMedium)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (t in IncidentType.entries) {
                FilterChip(selected = d.type == t, onClick = { c.editDraft { it.copy(type = t) } }, label = { Text(t.label()) })
            }
        }
        FieldError(err, "type")

        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedTextField(
                value = d.herdSize, onValueChange = { v -> c.editDraft { it.copy(herdSize = v.filter(Char::isDigit).take(3)) } },
                label = { Text("How many elephants") }, singleLine = true, isError = err.containsKey("herd_size"),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.weight(1f),
            )
            if (d.type?.isCasualty == true) {
                OutlinedTextField(
                    value = d.casualties, onValueChange = { v -> c.editDraft { it.copy(casualties = v.filter(Char::isDigit).take(2)) } },
                    label = { Text("People hurt") }, singleLine = true, isError = err.containsKey("casualties"),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.weight(1f),
                )
            }
        }
        FieldError(err, "herd_size", "casualties")

        Text("Where?", style = MaterialTheme.typography.titleMedium)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(selected = !d.useGps, onClick = { c.editDraft { it.copy(useGps = false) } }, label = { Text("Distance from a village") })
            FilterChip(selected = d.useGps, onClick = {
                c.editDraft { it.copy(useGps = true) }
                if (d.gps == null && !gpsBusy) {
                    if (Gps.hasPermission(context)) locate() else permissions.launch(Gps.PERMISSIONS)
                }
            }, label = { Text("My GPS position") })
        }
        VillagePicker(st, d.village) { v -> c.editDraft { it.copy(village = v) } }
        FieldError(err, "village")
        if (!d.useGps) {
            OutlinedTextField(
                value = d.offsetKm, onValueChange = { v -> c.editDraft { it.copy(offsetKm = v.filter { ch -> ch.isDigit() || ch == '.' }.take(5)) } },
                label = { Text("Distance from the village (km)") }, singleLine = true, isError = err.containsKey("offset_km"),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.fillMaxWidth(),
            )
            Text("Which way from the village?", style = MaterialTheme.typography.bodyMedium)
            DirectionChips(d.offsetDir, none = "At the village") { dir -> c.editDraft { it.copy(offsetDir = dir) } }
            FieldError(err, "offset_km", "offset_dir")
        } else {
            val g = d.gps
            if (g != null) {
                val near = nearestVillage(g, st.villages)
                Text(
                    String.format(Locale.ROOT, "%.5f, %.5f", g.lat, g.lng) +
                        (d.gpsAccuracyM?.let { " (±${it.toInt()} m)" } ?: "") +
                        (near?.let { " · ${it.describe()}" } ?: ""),
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            TextButton(enabled = !gpsBusy, onClick = { if (Gps.hasPermission(context)) locate() else permissions.launch(Gps.PERMISSIONS) }) {
                Text(if (g == null) "Get my position" else "Update my position")
            }
            FieldError(err, "lat", "lng")
        }
        gpsNote?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = argb(p.muted)) }

        Text("Which way is the herd heading?", style = MaterialTheme.typography.bodyMedium)
        DirectionChips(d.heading, none = "Not sure") { dir -> c.editDraft { it.copy(heading = dir) } }

        OutlinedTextField(
            value = d.description, onValueChange = { v -> c.editDraft { it.copy(description = v.take(500)) } },
            label = { Text("Notes (what you saw, damage)") }, minLines = 3, isError = err.containsKey("description"),
            modifier = Modifier.fillMaxWidth(),
        )
        FieldError(err, "description")

        Text("Photos (${d.photos.size} of ${MediaKind.PHOTO.maxCount()})", style = MaterialTheme.typography.bodyMedium)
        if (d.photos.isNotEmpty()) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                d.photos.forEachIndexed { index, bytes ->
                    val thumb = remember(bytes) { Photos.thumbnail(bytes) }
                    Column {
                        Box(Modifier.size(88.dp)) {
                            if (thumb != null) {
                                Image(thumb.asImageBitmap(), contentDescription = "Photo ${index + 1}", contentScale = ContentScale.Crop, modifier = Modifier.size(88.dp))
                            }
                        }
                        TextButton(onClick = { c.editDraft { it.copy(photos = it.photos.filterIndexed { i, _ -> i != index }) } }) { Text("Remove") }
                    }
                }
            }
        }
        OutlinedButton(
            enabled = d.photos.size < MediaKind.PHOTO.maxCount(),
            onClick = {
                try {
                    val (file, uri) = Photos.newCaptureTarget(context)
                    pendingPhoto = file.path
                    camera.launch(uri)
                } catch (e: ActivityNotFoundException) {
                    pendingPhoto = null
                    gpsNote = "No camera app found on this phone."
                } catch (e: IllegalArgumentException) {
                    pendingPhoto = null
                    gpsNote = "Couldn't prepare a file for the photo."
                }
            },
        ) { Text("Take a photo") }
        FieldError(err, "attachments")

        d.severityPreview()?.let { s ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Severity:", fontWeight = FontWeight.Bold)
                SeverityBadge(s.key(), s.label())
            }
        }
        Button(onClick = { vm.act { submitReport() } }, enabled = !st.isBusy, modifier = Modifier.fillMaxWidth()) {
            Text("Send report")
        }
        Text("In danger now? Move away first, then call 112.", style = MaterialTheme.typography.bodySmall, color = argb(p.muted))
    }
}

@Composable
private fun VillagePicker(st: AppState, selected: String?, onSelect: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        OutlinedButton(onClick = { open = true }, modifier = Modifier.fillMaxWidth()) {
            Text(selected?.let { "Nearest village: $it" } ?: "Choose the nearest village")
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            for (v in st.villages) {
                DropdownMenuItem(
                    text = { Text(if (v.verified) v.name else "${v.name} (position not verified)") },
                    onClick = {
                        onSelect(v.name)
                        open = false
                    },
                )
            }
        }
    }
}
