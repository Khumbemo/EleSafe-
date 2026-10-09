package org.hatialert.mobile.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.hatialert.client.app.AppState

@Composable
fun CasesScreen(st: AppState, onOpen: (Long) -> Unit) {
    val p = LocalPalette.current
    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (st.cases.isEmpty()) {
            item {
                Text(
                    if (st.isBusy) "Loading..." else if (st.user?.isStaff == true) "No cases." else "You haven't sent any reports yet.",
                    color = argb(p.muted),
                )
            }
        }
        items(st.cases, key = { it.id }) { i ->
            Card(Modifier.fillMaxWidth().clickable { onOpen(i.id) }) {
                Column(Modifier.padding(12.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(i.ref, fontWeight = FontWeight.Bold)
                        SeverityBadge(i.severity, i.severityLabel)
                        Text(
                            i.statusLabel,
                            color = if (i.open) argb(p.accent) else argb(p.muted),
                            style = MaterialTheme.typography.labelLarge,
                        )
                    }
                    Text("${i.typeLabel} · ${i.village}", style = MaterialTheme.typography.bodyMedium)
                    Text(istTime(i.createdAt), style = MaterialTheme.typography.bodySmall, color = argb(p.muted))
                }
            }
        }
    }
}
