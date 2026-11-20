package org.hatialert.mobile.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import org.hatialert.client.KeyLabel
import org.hatialert.client.app.AlertDraft
import org.hatialert.client.app.AppState
import org.hatialert.core.Limits
import org.hatialert.mobile.AppViewModel

/** Forest staff: an alert to chosen villages (alerts.ts compose form). */
@OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)
@Composable
fun ComposeAlertScreen(st: AppState, vm: AppViewModel) {
    val c = vm.controller
    val d = st.alertDraft
    val p = LocalPalette.current
    val err = st.fieldErrors
    val levels = st.meta?.alertLevels?.ifEmpty { null }
        ?: AlertDraft.LEVELS.map { KeyLabel(it, it.replace('_', ' ').replaceFirstChar { ch -> ch.uppercase() }) }

    Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        d.incidentId?.let { id ->
            val ref = st.detail?.takeIf { it.id == id }?.ref
            Text("About case ${ref ?: "#$id"}. Villages within 5 km are chosen; change them if needed.", color = argb(p.muted))
        }
        Text("Alert type", style = MaterialTheme.typography.titleSmall)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (l in levels) {
                FilterChip(selected = d.level == l.key, onClick = { c.editAlert { it.copy(level = l.key) } }, label = { Text(l.label) })
            }
        }
        FieldError(err, "level")

        Row {
            Text("Villages (${d.villages.size} chosen)", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f).padding(top = 12.dp))
            TextButton(onClick = { c.editAlert { it.copy(villages = st.villages.map { v -> v.name }.toSet()) } }) { Text("All") }
            TextButton(onClick = { c.editAlert { it.copy(villages = emptySet()) } }) { Text("None") }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            for (v in st.villages) {
                FilterChip(selected = v.name in d.villages, onClick = { c.editAlert { it.toggle(v.name) } }, label = { Text(v.name) })
            }
        }
        FieldError(err, "villages")

        OutlinedTextField(
            value = d.message, onValueChange = { v -> c.editAlert { it.copy(message = v.take(Limits.MESSAGE_MAX)) } },
            label = { Text("Message") }, minLines = 4, isError = err.containsKey("message"),
            placeholder = { Text("What is happening, where, and what people should do") },
            supportingText = { Text(err["message"] ?: "${d.message.length} / ${Limits.MESSAGE_MAX}") },
            modifier = Modifier.fillMaxWidth(),
        )
        Button(onClick = { vm.act { sendAlert() } }, enabled = !st.isBusy, modifier = Modifier.fillMaxWidth()) { Text("Send alert") }
        Text(
            if (st.meta?.smsEnabled == true) "People in these villages who want text alerts get one."
            else "Text messages aren't set up: the texts are listed for an officer to send by hand (Admin > Messages).",
            style = MaterialTheme.typography.bodySmall, color = argb(p.muted),
        )
    }
}
