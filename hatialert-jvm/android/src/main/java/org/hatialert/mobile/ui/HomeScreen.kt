package org.hatialert.mobile.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.hatialert.client.app.AppState
import org.hatialert.client.app.MapScene
import org.hatialert.client.app.NearbyItem
import org.hatialert.client.app.fmtKm

@Composable
fun HomeScreen(st: AppState, onOpen: (Long) -> Unit) {
    val ov = st.overview
    val p = LocalPalette.current
    val home = st.homeVillage
    val radius = ov?.radiusKm ?: st.user?.radiusKm ?: 5.0
    val scene = remember(st.villages, st.nearby, home, radius) {
        MapScene.build(st.villages, st.nearby.map { it.incident }, home, radius)
    }
    LazyColumn(
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        ov?.warning?.let { w ->
            item {
                Card(colors = CardDefaults.cardColors(containerColor = argb(p.critSoft))) {
                    Column(Modifier.padding(12.dp)) {
                        Text(w.levelLabel, color = argb(p.crit), fontWeight = FontWeight.Bold)
                        Text(w.message, color = argb(p.ink))
                        Text("${w.villages.joinToString()} · ${istTime(w.sentAt)}", style = MaterialTheme.typography.bodySmall, color = argb(p.muted))
                    }
                }
            }
        }
        item {
            Text(
                if (ov == null) "Loading..." else
                    "${st.nearby.size} open incident${if (st.nearby.size == 1) "" else "s"} within ${fmtKm(radius)} km of ${home?.name ?: "your village"}" +
                        " · ${ov.openTotal} open in the district",
                style = MaterialTheme.typography.titleSmall,
            )
        }
        item {
            Card {
                MapCanvas(scene, onIncident = onOpen, modifier = Modifier.fillMaxWidth().height(300.dp))
                Text(
                    "UTM zone 46N grid (km). Dashed ring: your ${fmtKm(radius)} km alert area. Hollow dots: village position not verified.",
                    style = MaterialTheme.typography.bodySmall, color = argb(p.muted), modifier = Modifier.padding(8.dp),
                )
            }
        }
        if (ov != null && st.nearby.isEmpty()) {
            item { Text("No open incidents near you. Stay alert and report anything you see.", color = argb(p.muted)) }
        }
        items(st.nearby, key = { it.incident.id }) { n -> NearbyRow(n, onOpen) }
        if (ov?.hasSample == true) {
            item { Text("Some incidents are sample data from the demo server.", style = MaterialTheme.typography.bodySmall, color = argb(p.muted)) }
        }
    }
}

@Composable
private fun NearbyRow(n: NearbyItem, onOpen: (Long) -> Unit) {
    val i = n.incident
    val p = LocalPalette.current
    Card(Modifier.fillMaxWidth().clickable { onOpen(i.id) }) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(fmtKm(n.km), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Text("km ${n.dir}", style = MaterialTheme.typography.labelMedium, color = argb(p.muted))
            }
            Column(Modifier.weight(1f)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(i.typeLabel, fontWeight = FontWeight.Bold)
                    SeverityBadge(i.severity, i.severityLabel)
                }
                Text(
                    "${i.village} · ${if (i.herdSize > 0) "${i.herdSize} elephant${if (i.herdSize == 1) "" else "s"} · " else ""}${i.statusLabel}",
                    style = MaterialTheme.typography.bodyMedium,
                )
                Text("${i.ref} · ${istTime(i.createdAt)}", style = MaterialTheme.typography.bodySmall, color = argb(p.muted))
            }
        }
    }
}
