package org.hatialert.mobile.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import java.util.Locale
import org.hatialert.client.Incident
import org.hatialert.client.app.AppState
import org.hatialert.client.app.nearestVillage
import org.hatialert.core.LatLng
import org.hatialert.core.Status
import org.hatialert.mobile.AppViewModel

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun CaseDetailScreen(st: AppState, vm: AppViewModel) {
    val i = st.detail
    val p = LocalPalette.current
    if (i == null) {
        Text(tr(if (st.isBusy) "Loading…" else "Couldn't load this case."), modifier = Modifier.padding(16.dp), color = argb(p.muted))
        return
    }
    var note by rememberSaveable(i.id) { mutableStateOf("") }

    Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(tr(i.typeLabel), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            SeverityBadge(i.severity, i.severityLabel)
        }
        Text("${tr(i.statusLabel)} · ${i.ref}", style = MaterialTheme.typography.titleSmall)
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                facts(i, st).forEach { (k, v, ours) ->
                    Row {
                        Text(tr(k), color = argb(p.muted), modifier = Modifier.width(120.dp))
                        Text(if (ours) tr(v) else v)
                    }
                }
            }
        }
        if (i.description.isNotBlank()) Text(i.description)
        CaseMedia(i, vm)

        val next = i.next.orEmpty()
        val staff = st.user?.isStaff == true
        if (staff) {
            HorizontalDivider()
            Text(tr("Staff action"), style = MaterialTheme.typography.titleMedium)
            OutlinedTextField(
                value = note, onValueChange = { note = it.take(500) }, label = { Text(tr("Note")) }, placeholder = { Text(tr("(team sent, damage seen, advice given)")) },
                minLines = 2, modifier = Modifier.fillMaxWidth(), isError = st.fieldErrors.containsKey("note"),
            )
            FieldError(st.fieldErrors, "note", "status")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (key in next) {
                    Button(onClick = {
                        vm.act { if (changeStatus(i.id, key, note)) note = "" }
                    }, enabled = !st.isBusy) { Text(tr(statusAction(key))) }
                }
                OutlinedButton(onClick = { vm.act { if (changeStatus(i.id, null, note)) note = "" } }, enabled = !st.isBusy && note.isNotBlank()) {
                    Text(tr("Add note only"))
                }
            }
            if (next.isEmpty() && i.open) {
                Text(tr("Only a forest officer can close this case."), style = MaterialTheme.typography.bodySmall, color = argb(p.muted))
            }
            if (i.open) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(tr("Tell villages within 5 km."), style = MaterialTheme.typography.bodySmall, color = argb(p.muted), modifier = Modifier.weight(1f))
                    OutlinedButton(onClick = { vm.act { warnNearby(i) } }, enabled = !st.isBusy) { Text(tr("Warn nearby villages")) }
                }
            }
        }

        HorizontalDivider()
        Text(tr("What has happened"), style = MaterialTheme.typography.titleMedium)
        for (e in i.events.orEmpty()) {
            Column {
                Text(tr(e.statusLabel), fontWeight = FontWeight.Bold)
                if (e.note.isNotBlank()) Text(e.note)
                Text(
                    istTime(e.at) + (e.by?.let { " · $it" } ?: e.byRole?.let { " · $it" } ?: ""),
                    style = MaterialTheme.typography.bodySmall, color = argb(p.muted),
                )
            }
        }
    }
}

/** (label, value, whether the value is the app's own text to translate) for the facts table. */
private fun facts(i: Incident, st: AppState): List<Triple<String, String, Boolean>> = buildList {
    fun add(label: String, value: String, ours: Boolean = false) = add(Triple(label, value, ours))
    add("Reported", istTime(i.createdAt))
    add("Village", i.village)
    val near = nearestVillage(LatLng(i.lat, i.lng), st.villages)
    add("Location", String.format(Locale.ROOT, "%.5f, %.5f", i.lat, i.lng) + (near?.let { "\n" + it.describe() } ?: ""))
    if (i.herdSize > 0) add("Elephants", i.herdSize.toString())
    if (i.heading.isNotEmpty()) add("Heading", i.heading)
    if (i.casualties > 0) add("People hurt", i.casualties.toString())
    if (i.cropAcres > 0) add("Crops", "${i.cropAcres} acres", ours = true)
    if (i.propertyInr > 0) add("Property loss", "₹${i.propertyInr}")
    if (i.place.isNotBlank()) add("Landmark", i.place)
    i.reporter?.let { add("Reported by", "${it.name}, ${it.phone}" + if (it.phoneVerified) "" else " (not verified)") }
    if (i.sample) add("Sample", "Sample data", ours = true)
}

/** The web app's button text for moving a case to the status [key]. */
private fun statusAction(key: String): String = when (key) {
    "verified" -> "Mark verified"
    "responded" -> "Mark team responded"
    "resolved" -> "Close as resolved"
    "false_report" -> "Mark false report"
    else -> "Mark " + (Status.fromKey(key)?.label() ?: key).lowercase()
}
