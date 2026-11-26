package org.hatialert.mobile.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.hatialert.client.app.AppState

@Composable
fun AlertsScreen(st: AppState, onCompose: () -> Unit, onOpenCase: (Long) -> Unit) {
    val p = LocalPalette.current
    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (st.user?.isStaff == true) {
            item {
                Button(onClick = onCompose, modifier = Modifier.fillMaxWidth()) { Text(tr("Send an alert")) }
            }
        }
        item {
            Text(tr("Warnings from forest staff. Alerts for ${st.user?.village ?: "your village"} are marked."), style = MaterialTheme.typography.bodySmall, color = argb(p.muted))
        }
        if (st.alerts.isEmpty()) item { Text(tr(if (st.isBusy) "Loading…" else "No alerts yet"), color = argb(p.muted)) }
        items(st.alerts, key = { it.id }) { a ->
            val (fg, bg) = when (a.level) {
                "warning" -> p.crit to p.critSoft
                "all_clear" -> p.low to p.lowSoft
                else -> p.accent to p.accentSoft
            }
            Card(
                Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = if (a.active || a.affectsMe) argb(bg) else argb(p.surface)),
            ) {
                Column(Modifier.padding(12.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(tr(a.levelLabel), color = argb(fg), fontWeight = FontWeight.Bold)
                        if (a.active) Badge("Active", p.crit, p.critSoft)
                        if (a.affectsMe) Badge("Your village", p.accent, p.accentSoft)
                    }
                    Text(a.message)
                    Text(
                        a.villages.joinToString() + " · " + istTime(a.sentAt) + (a.by?.let { " · $it" } ?: ""),
                        style = MaterialTheme.typography.bodySmall, color = argb(p.muted),
                    )
                    a.incidentId?.let { id -> TextButton(onClick = { onOpenCase(id) }) { Text(tr("View case")) } }
                }
            }
        }
    }
}
