package org.hatialert.mobile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.TextButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.hatialert.core.Geo
import org.hatialert.core.Ist

/** Small coloured label, e.g. a severity. */
@Composable
fun Badge(text: String, fg: Long, bg: Long, modifier: Modifier = Modifier) {
    Text(
        text,
        color = argb(fg),
        style = MaterialTheme.typography.labelMedium,
        fontWeight = FontWeight.Bold,
        modifier = modifier
            .background(argb(bg), RoundedCornerShape(6.dp))
            .padding(horizontal = 8.dp, vertical = 2.dp),
    )
}

@Composable
fun SeverityBadge(key: String, label: String) {
    val p = LocalPalette.current
    Badge(label, p.severity(key), p.severitySoft(key))
}

/** "None" plus the 8 compass points; [none] is the label for the empty choice. */
@OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)
@Composable
fun DirectionChips(selected: String, none: String, onSelect: (String) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        FilterChip(selected = selected.isEmpty(), onClick = { onSelect("") }, label = { Text(none) })
        for (d in Geo.DIRECTIONS) {
            FilterChip(selected = selected == d, onClick = { onSelect(d) }, label = { Text(d) })
        }
    }
}

@Composable
fun FieldError(errors: Map<String, String>, vararg keys: String) {
    val msg = keys.firstNotNullOfOrNull { errors[it] } ?: return
    Text(msg, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
}

/** "2 reports waiting to send" with a button to try now (the web app's queue note). */
@Composable
fun PendingNote(text: String, onSendNow: () -> Unit) {
    val p = LocalPalette.current
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = argb(p.medSoft))) {
        Row(Modifier.padding(start = 12.dp, end = 4.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(text, color = argb(p.ink), fontWeight = FontWeight.Bold)
                Text("Saved on this phone. They send by themselves when you're back online.", style = MaterialTheme.typography.bodySmall, color = argb(p.muted))
            }
            TextButton(onClick = onSendNow) { Text("Send now") }
        }
    }
}

/** IST time as the web app shows it ("2026-10-01 14:05 IST"). */
fun istTime(ms: Long) = Ist.stamp(ms) + " IST"
