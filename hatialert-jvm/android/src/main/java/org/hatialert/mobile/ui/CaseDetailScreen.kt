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
        Text(if (st.isBusy) "Loading..." else "Couldn't load this case.", modifier = Modifier.padding(16.dp), color = argb(p.muted))
        return
    }
    var note by rememberSaveable(i.id) { mutableStateOf("") }

    Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(i.typeLabel, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            SeverityBadge(i.severity, i.severityLabel)
        }
        Text("${i.statusLabel} · report number ${i.ref}", style = MaterialTheme.typography.titleSmall)
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                facts(i, st).forEach { (k, v) ->
                    Row {
                        Text(k, color = argb(p.muted), modifier = Modifier.width(120.dp))
                        Text(v)
                    }
                }
            }
        }
        if (i.description.isNotBlank()) Text(i.description)
        if (i.attachments.isNotEmpty() || i.attachmentsHidden > 0) {
            val photos = i.attachments.count { it.kind == "photo" }
            val voice = i.attachments.count { it.kind == "voice" }
            Text(
                if (i.attachments.isNotEmpty()) "$photos photo(s), $voice voice note(s) on this case (open the web app to view them)."
                else "${i.attachmentsHidden} file(s), visible to the reporter and forest staff only.",
                style = MaterialTheme.typography.bodySmall, color = argb(p.muted),
            )
        }

        val next = i.next.orEmpty()
        val staff = st.user?.isStaff == true
        if (staff) {
            HorizontalDivider()
            Text("Update this case", style = MaterialTheme.typography.titleMedium)
            OutlinedTextField(
                value = note, onValueChange = { note = it.take(500) }, label = { Text("Note (optional)") },
                minLines = 2, modifier = Modifier.fillMaxWidth(), isError = st.fieldErrors.containsKey("note"),
            )
            FieldError(st.fieldErrors, "note", "status")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (key in next) {
                    val label = Status.fromKey(key)?.label() ?: key
                    Button(onClick = {
                        vm.act { if (changeStatus(i.id, key, note)) note = "" }
                    }, enabled = !st.isBusy) { Text("Mark $label".lowercase().replaceFirstChar { it.uppercase() }) }
                }
                OutlinedButton(onClick = { vm.act { if (changeStatus(i.id, null, note)) note = "" } }, enabled = !st.isBusy && note.isNotBlank()) {
                    Text("Add note")
                }
            }
            if (next.isEmpty() && i.open) {
                Text("Only a forest officer can close this case.", style = MaterialTheme.typography.bodySmall, color = argb(p.muted))
            }
        }

        HorizontalDivider()
        Text("Timeline", style = MaterialTheme.typography.titleMedium)
        for (e in i.events.orEmpty()) {
            Column {
                Text(e.statusLabel, fontWeight = FontWeight.Bold)
                if (e.note.isNotBlank()) Text(e.note)
                Text(
                    istTime(e.at) + (e.by?.let { " · $it" } ?: e.byRole?.let { " · $it" } ?: ""),
                    style = MaterialTheme.typography.bodySmall, color = argb(p.muted),
                )
            }
        }
    }
}

private fun facts(i: Incident, st: AppState): List<Pair<String, String>> = buildList {
    add("Reported" to istTime(i.createdAt))
    add("Village" to i.village)
    val near = nearestVillage(LatLng(i.lat, i.lng), st.villages)
    add("Position" to String.format(Locale.ROOT, "%.5f, %.5f", i.lat, i.lng) + (near?.let { "\n" + it.describe() } ?: ""))
    if (i.herdSize > 0) add("Elephants" to i.herdSize.toString())
    if (i.heading.isNotEmpty()) add("Heading" to i.heading)
    if (i.casualties > 0) add("People hurt" to i.casualties.toString())
    if (i.cropAcres > 0) add("Crops lost" to "${i.cropAcres} acres")
    if (i.propertyInr > 0) add("Property" to "₹${i.propertyInr}")
    if (i.place.isNotBlank()) add("Place" to i.place)
    i.reporter?.let { add("Reporter" to "${it.name}, ${it.phone}" + if (it.phoneVerified) "" else " (not verified)") }
    if (i.sample) add("Note" to "Sample data")
}
