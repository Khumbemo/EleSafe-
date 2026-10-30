package org.hatialert.mobile.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
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
fun HomeScreen(st: AppState, win: WindowLayout, onOpen: (Long) -> Unit, onSendNow: () -> Unit) {
    val ov = st.overview
    val p = LocalPalette.current
    val home = st.homeVillage
    val radius = ov?.radiusKm ?: st.user?.radiusKm ?: 5.0
    val scene = remember(st.villages, st.nearby, home, radius) {
        MapScene.build(st.villages, st.nearby.map { it.incident }, home, radius)
    }
    val caption = "UTM zone 46N grid (km). Dashed ring: your ${fmtKm(radius)} km alert area. Hollow dots: village position not verified."

    if (win.mapBeside) {
        // Tablets and phones held sideways: map on the left at full height, list on the right.
        Row(Modifier.fillMaxSize().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Card(Modifier.weight(1.1f).fillMaxHeight()) {
                MapCanvas(scene, onIncident = onOpen, modifier = Modifier.fillMaxWidth().weight(1f))
                Text(caption, style = MaterialTheme.typography.bodySmall, color = argb(p.muted), modifier = Modifier.padding(8.dp))
            }
            LazyColumn(Modifier.weight(1f).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                homeItems(st, radius, onOpen, onSendNow)
            }
        }
        return
    }
    LazyColumn(
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        homeItems(st, radius, onOpen, onSendNow, map = {
            Card {
                MapCanvas(scene, onIncident = onOpen, modifier = Modifier.fillMaxWidth().height(win.mapHeightDp.dp))
                Text(caption, style = MaterialTheme.typography.bodySmall, color = argb(p.muted), modifier = Modifier.padding(8.dp))
            }
        })
    }
}

/** Saved reports, warning, summary, (map), incident rows and the sample-data note, in that order. */
private fun LazyListScope.homeItems(st: AppState, radius: Double, onOpen: (Long) -> Unit, onSendNow: () -> Unit, map: (@Composable () -> Unit)? = null) {
    val ov = st.overview
    val home = st.homeVillage
    st.pendingNote?.let { note -> item { PendingNote(note, onSendNow) } }
    ov?.warning?.let { w ->
        item {
            val p = LocalPalette.current
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
    if (map != null) item { map() }
    if (ov != null && st.nearby.isEmpty()) {
        item { Text("No open incidents near you. Stay alert and report anything you see.", color = argb(LocalPalette.current.muted)) }
    }
    items(st.nearby, key = { it.incident.id }) { n -> NearbyRow(n, onOpen) }
    if (ov?.hasSample == true) {
        item { Text("Some incidents are sample data from the demo server.", style = MaterialTheme.typography.bodySmall, color = argb(LocalPalette.current.muted)) }
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
