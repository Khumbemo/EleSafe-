package org.hatialert.mobile.ui

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import java.io.File
import java.io.IOException
import java.text.NumberFormat
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.hatialert.client.AdminUser
import org.hatialert.client.AdminVillage
import org.hatialert.client.CountRow
import org.hatialert.client.OutboxBatch
import org.hatialert.client.app.AdminSection
import org.hatialert.client.app.AppState
import org.hatialert.client.app.ReportDraft
import org.hatialert.client.app.VillageForm
import org.hatialert.client.app.messageStatusLabel
import org.hatialert.client.app.plural
import org.hatialert.core.Role
import org.hatialert.mobile.AppViewModel

/** Forest officers: district numbers and the admin sections, chosen with chips at the top. */
@OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)
@Composable
fun AdminScreen(st: AppState, vm: AppViewModel, section: AdminSection) {
    Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (s in AdminSection.entries) {
                FilterChip(selected = s == section, onClick = { if (s != section) openAdmin(vm, s) }, label = { Text(s.label) })
            }
        }
        when (section) {
            AdminSection.STATS -> StatsSection(st, vm)
            AdminSection.PEOPLE -> PeopleSection(st, vm)
            AdminSection.VILLAGES -> VillagesSection(st, vm)
            AdminSection.MESSAGES -> MessagesSection(st, vm)
            AdminSection.SYSTEM -> SystemSection(st)
        }
    }
}

@Composable
private fun Muted(text: String) = Text(text, style = MaterialTheme.typography.bodySmall, color = argb(LocalPalette.current.muted))

@Composable
private fun Loading(st: AppState) = Muted(if (st.isBusy) "Loading..." else "Nothing loaded yet. Tap refresh at the top.")

private fun inr(v: Long) = "₹" + NumberFormat.getIntegerInstance(Locale.forLanguageTag("en-IN")).format(v)

private fun ago(ms: Long?): String {
    if (ms == null) return "never"
    val min = (System.currentTimeMillis() - ms) / 60_000
    return when {
        min < 1 -> "just now"
        min < 60 -> "$min min ago"
        min < 48 * 60 -> "${min / 60} h ago"
        else -> "${min / 1440} days ago"
    }
}

private fun copy(context: Context, label: String, text: String) {
    context.getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText(label, text))
}

// --- district overview -------------------------------------------------------------

@OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)
@Composable
private fun StatsSection(st: AppState, vm: AppViewModel) {
    val a = st.admin
    val s = a.stats
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var exportNote by remember { mutableStateOf<String?>(null) }

    Row(verticalAlignment = Alignment.CenterVertically) {
        FlowRow(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            for (d in listOf(7, 30, 90)) {
                FilterChip(selected = a.statsDays == d, onClick = { vm.act { admin.loadStats(d) } }, label = { Text("$d days") })
            }
        }
        OutlinedButton(enabled = !st.isBusy, onClick = {
            scope.launch {
                val days = a.statsDays
                val csv = vm.controller.admin.exportCsv(days) ?: return@launch
                exportNote = try {
                    shareCsv(context, csv, days)
                    null
                } catch (e: IOException) {
                    "Couldn't save the file: ${e.message}"
                } catch (e: ActivityNotFoundException) {
                    "No app on this phone can take the file."
                } catch (e: IllegalArgumentException) {
                    "Couldn't share the file."
                }
            }
        }) { Text("Export CSV") }
    }
    exportNote?.let { Muted(it) }
    if (s == null) return Loading(st)

    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Kpi("Incidents", s.total.toString(), "${s.open} still open")
        Kpi("Median time to respond", s.medianResponseH?.let { "$it h" } ?: "—", "across ${plural(s.respondedCount, "case")}")
        Kpi("People hurt or killed", s.casualties.toString(), "${s.falseReports} false ${if (s.falseReports == 1) "report" else "reports"}")
        Kpi("Recorded losses", "${s.cropAcres} ac", "crops · ${inr(s.propertyInr)} property")
    }
    Text("Incidents per day", style = MaterialTheme.typography.titleMedium)
    DayBars(s.series.map { it.count })
    if (s.series.isNotEmpty()) {
        Row { Muted(s.series.first().date); Box(Modifier.weight(1f)); Muted(s.series.last().date) }
    }
    Text("Hotspot villages", style = MaterialTheme.typography.titleMedium)
    if (s.byVillage.isEmpty()) Muted("No incidents in this period.") else HBars(s.byVillage.take(8))
    Text("What happened", style = MaterialTheme.typography.titleMedium)
    if (s.total == 0) Muted("No incidents in this period.") else HBars(s.byType.filter { it.count > 0 })
    Text("Severity", style = MaterialTheme.typography.titleMedium)
    HBars(s.bySeverity)
    Muted("Export CSV shares the incidents of the chosen period as a spreadsheet file (e.g. to e-mail or Drive).")
}

/** Writes the CSV to cache/exports and opens the share sheet for it. */
private suspend fun shareCsv(context: Context, csv: String, days: Int) {
    val file = withContext(Dispatchers.IO) {
        File(File(context.cacheDir, "exports").apply { mkdirs() }, "hatialert-${days}d.csv").apply { writeText(csv, Charsets.UTF_8) }
    }
    val uri = FileProvider.getUriForFile(context, context.packageName + ".photos", file)
    val send = Intent(Intent.ACTION_SEND)
        .setType("text/csv")
        .putExtra(Intent.EXTRA_STREAM, uri)
        .putExtra(Intent.EXTRA_SUBJECT, "HatiAlert incidents, last $days days")
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    context.startActivity(Intent.createChooser(send, "Share CSV"))
}

@Composable
private fun Kpi(label: String, value: String, note: String) {
    Card(Modifier.widthIn(min = 150.dp)) {
        Column(Modifier.padding(12.dp)) {
            Muted(label)
            Text(value, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Muted(note)
        }
    }
}

@Composable
private fun DayBars(counts: List<Int>) {
    val p = LocalPalette.current
    val max = (counts.maxOrNull() ?: 0).coerceAtLeast(1)
    Row(Modifier.fillMaxWidth().height(96.dp), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(1.dp)) {
        for (n in counts) {
            Box(Modifier.weight(1f).fillMaxHeight(if (n == 0) 0.02f else n.toFloat() / max).background(argb(if (n == 0) p.line else p.accent)))
        }
    }
    Muted("Highest day: $max")
}

@Composable
private fun HBars(rows: List<CountRow>) {
    val p = LocalPalette.current
    val max = (rows.maxOfOrNull { it.count } ?: 0).coerceAtLeast(1)
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        for (r in rows) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(r.title, modifier = Modifier.width(130.dp), style = MaterialTheme.typography.bodySmall)
                Box(Modifier.weight(1f).height(12.dp).background(argb(p.sunken), RoundedCornerShape(3.dp))) {
                    if (r.count > 0) Box(Modifier.fillMaxWidth(r.count.toFloat() / max).height(12.dp).background(argb(p.accent), RoundedCornerShape(3.dp)))
                }
                Text(r.count.toString(), modifier = Modifier.width(36.dp).padding(start = 6.dp), fontWeight = FontWeight.Bold)
            }
        }
    }
}

// --- people ------------------------------------------------------------------------

private val ROLE_LABELS = mapOf("villager" to "Villager", "guard" to "Forest guard", "officer" to "Forest officer")

@OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)
@Composable
private fun PeopleSection(st: AppState, vm: AppViewModel) {
    val a = st.admin
    var query by rememberSaveable { mutableStateOf(a.query) }
    LaunchedEffect(query) {
        if (query == a.query) return@LaunchedEffect
        delay(300) // search as the officer types, not on every letter
        vm.controller.admin.loadPeople(query = query)
    }

    a.tempPin?.let { r ->
        Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = argb(LocalPalette.current.medSoft))) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Temporary PIN for ${r.user.name}", fontWeight = FontWeight.Bold)
                Text(r.tempPin, fontFamily = FontFamily.Monospace, fontSize = 36.sp, fontWeight = FontWeight.Bold)
                Text("Tell them in person or by phone call. They must choose a new PIN when they sign in. It isn't shown again.")
                TextButton(onClick = { vm.controller.admin.dismissTempPin() }) { Text("Done") }
            }
        }
    }
    OutlinedTextField(
        value = query, onValueChange = { query = it.take(40) }, singleLine = true,
        label = { Text("Search name or phone") }, modifier = Modifier.fillMaxWidth(),
    )
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        FilterChip(selected = a.role.isEmpty(), onClick = { vm.act { admin.loadPeople(role = "") } }, label = { Text("Everyone") })
        for (r in Role.entries) {
            FilterChip(selected = a.role == r.key(), onClick = { vm.act { admin.loadPeople(role = r.key()) } }, label = { Text(ROLE_LABELS[r.key()] ?: r.key()) })
        }
    }
    if (a.people.isEmpty()) {
        Muted(if (st.isBusy) "Loading..." else "No one found")
    }
    for (person in a.people) PersonCard(st, vm, person)
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PersonCard(st: AppState, vm: AppViewModel, u: AdminUser) {
    val p = LocalPalette.current
    var roleMenu by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf<Pair<String, suspend () -> Unit>?>(null) }
    val admin = vm.controller.admin
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(u.name, fontWeight = FontWeight.Bold)
                Badge(ROLE_LABELS[u.role] ?: u.role, p.accent, p.accentSoft)
            }
            Text("${u.phone} · ${u.village}", style = MaterialTheme.typography.bodyMedium)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                if (!u.active) Badge("Switched off", p.crit, p.critSoft)
                if (!u.phoneVerified) Badge("Phone not verified", p.muted, p.sunken)
                if (u.mustChangePin) Badge("Temporary PIN", p.med, p.medSoft)
                if (u.failed24h > 0) Badge("${plural(u.failed24h, "wrong PIN")} today", p.crit, p.critSoft)
            }
            Muted("Last seen ${ago(u.lastSeen)}")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Box {
                    OutlinedButton(onClick = { roleMenu = true }, enabled = !st.isBusy) { Text("Role...") }
                    DropdownMenu(expanded = roleMenu, onDismissRequest = { roleMenu = false }) {
                        for (r in Role.entries) {
                            DropdownMenuItem(text = { Text(ROLE_LABELS[r.key()] ?: r.key()) }, enabled = r.key() != u.role, onClick = {
                                roleMenu = false
                                confirm = "Make ${u.name} a ${(ROLE_LABELS[r.key()] ?: r.key()).lowercase()}? They are signed out everywhere." to { admin.setRole(u.id, r) }
                            })
                        }
                    }
                }
                OutlinedButton(onClick = {
                    confirm = "Give ${u.name} a temporary PIN? They are signed out everywhere and must choose a new PIN when they sign in." to { admin.resetPin(u.id) }
                }, enabled = !st.isBusy) { Text("Reset PIN") }
                if (u.failed24h > 0) OutlinedButton(onClick = { vm.act { admin.unlock(u.id) } }, enabled = !st.isBusy) { Text("Unlock") }
                OutlinedButton(onClick = {
                    if (u.active) {
                        confirm = "Switch off ${u.name}'s account? They can't sign in until it is switched on again." to { admin.setActive(u.id, false) }
                    } else {
                        vm.act { admin.setActive(u.id, true) }
                    }
                }, enabled = !st.isBusy) { Text(if (u.active) "Switch off" else "Switch on") }
            }
        }
    }
    confirm?.let { (question, action) ->
        AlertDialog(
            onDismissRequest = { confirm = null },
            text = { Text(question) },
            confirmButton = {
                TextButton(onClick = {
                    confirm = null
                    vm.act { action() }
                }) { Text("Yes") }
            },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text("Cancel") } },
        )
    }
}

// --- villages -----------------------------------------------------------------------

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun VillagesSection(st: AppState, vm: AppViewModel) {
    val a = st.admin
    val p = LocalPalette.current
    val context = LocalContext.current
    var editing by remember { mutableStateOf<AdminVillage?>(null) }
    var adding by remember { mutableStateOf(false) }
    var csv by rememberSaveable { mutableStateOf("") }
    var fileNote by remember { mutableStateOf<String?>(null) }
    val pickFile = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) {
            fileNote = try {
                val text = context.contentResolver.openInputStream(uri)?.use { it.readBytes().toString(Charsets.UTF_8) }
                if (text == null) "Couldn't open that file." else {
                    csv = text.take(500_000)
                    null
                }
            } catch (e: IOException) {
                "Couldn't open that file."
            } catch (e: SecurityException) {
                "Couldn't open that file."
            }
        }
    }

    if (a.unverifiedVillages > 0) {
        Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = argb(p.medSoft))) {
            Text(
                "${plural(a.unverifiedVillages, "village position is", "village positions are")} not checked yet. Distances and alert areas depend on them.",
                modifier = Modifier.padding(12.dp),
            )
        }
    }
    Button(onClick = {
        vm.controller.clearFieldErrors()
        adding = true
    }) { Text("Add a village") }
    if (a.villages.isEmpty()) Loading(st)
    for (v in a.villages) {
        Card(Modifier.fillMaxWidth()) {
            Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(v.name, fontWeight = FontWeight.Bold)
                        if (v.verified) Badge("Checked", p.low, p.lowSoft) else Badge("Not checked", p.med, p.medSoft)
                        if (!v.active) Badge("Hidden", p.muted, p.sunken)
                    }
                    Text(String.format(Locale.ROOT, "%.5f, %.5f", v.lat, v.lng), fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
                    Muted("${v.source.ifEmpty { "—" }} · ${plural(v.people, "person", "people")} · ${plural(v.incidents, "incident")}")
                }
                TextButton(onClick = {
                    vm.controller.clearFieldErrors()
                    editing = v
                }) { Text("Edit") }
            }
        }
    }

    HorizontalDivider()
    Text("Import a list", style = MaterialTheme.typography.titleMedium)
    Muted("Paste CSV with a header row name,lat,lng,source, or choose a file. Names already on the list get the new position; all imported positions count as checked.")
    OutlinedButton(onClick = {
        try {
            pickFile.launch("text/*")
        } catch (e: ActivityNotFoundException) {
            fileNote = "No file picker on this phone. Paste the list instead."
        }
    }) { Text("Choose a file") }
    fileNote?.let { Muted(it) }
    FormField(st, "csv", "CSV", csv, { csv = it }, minLines = 4, hint = "name,lat,lng,source")
    Button(onClick = { vm.act { if (admin.importVillages(csv) != null) csv = "" } }, enabled = !st.isBusy) { Text("Import") }
    a.importNote?.let { Text(it, style = MaterialTheme.typography.bodySmall) }

    editing?.let { v -> VillageDialog(st, vm, v) { editing = null } }
    if (adding) VillageDialog(st, vm, null) { adding = false }
}

/** Add ([village] null) or edit a village's position, source, checked flag and visibility. */
@Composable
private fun VillageDialog(st: AppState, vm: AppViewModel, village: AdminVillage?, onClose: () -> Unit) {
    var f by remember(village?.id) { mutableStateOf(village?.let { VillageForm.of(it) } ?: VillageForm()) }
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text(village?.name ?: "Add a village") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                if (village == null) FormField(st, "name", "Name", f.name, { f = f.copy(name = it.take(60)) })
                FormField(st, "lat", "Latitude", f.lat, { f = f.copy(lat = it.take(14)) }, KeyboardType.Decimal, hint = "e.g. 26.0972")
                FormField(st, "lng", "Longitude", f.lng, { f = f.copy(lng = it.take(14)) }, KeyboardType.Decimal, hint = "e.g. 94.2582")
                FormField(st, "source", "Where the position comes from", f.source, { f = f.copy(source = it.take(120)) }, hint = "e.g. Survey of India sheet 83G/1, GPS by guard")
                CheckRow("Position checked", f.verified) { f = f.copy(verified = it) }
                if (village != null) CheckRow("Show in lists", f.active) { f = f.copy(active = it) }
                FieldError(st.fieldErrors, "active")
            }
        },
        confirmButton = {
            TextButton(enabled = !st.isBusy, onClick = {
                vm.act {
                    val ok = if (village == null) admin.addVillage(f) else admin.saveVillage(village.id, f)
                    if (ok) onClose()
                }
            }) { Text(if (village == null) "Add village" else "Save") }
        },
        dismissButton = { TextButton(onClick = onClose) { Text("Cancel") } },
    )
}

@Composable
private fun CheckRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Checkbox(checked = checked, onCheckedChange = onChange)
        Text(label)
    }
}

// --- text messages ------------------------------------------------------------------------

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun MessagesSection(st: AppState, vm: AppViewModel) {
    val box = st.admin.outbox ?: return Loading(st)
    val p = LocalPalette.current
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = argb(p.accentSoft))) {
        Text(
            if (box.mode == "manual") "Text messages aren't connected to an SMS service yet. Send these from a phone, then mark them sent."
            else "Alerts are texted automatically. Failed ones can be tried again.",
            modifier = Modifier.padding(12.dp),
        )
    }
    if (box.batches.isEmpty()) {
        Text("No alert messages yet", fontWeight = FontWeight.Bold)
        Muted("Each alert lists the people in those villages here.")
    }
    for (b in box.batches) BatchCard(st, vm, b, manualMode = box.mode == "manual")
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun BatchCard(st: AppState, vm: AppViewModel, b: OutboxBatch, manualMode: Boolean) {
    val p = LocalPalette.current
    val context = LocalContext.current
    var open by rememberSaveable(b.alertId) { mutableStateOf(false) }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("${b.levelLabel.ifEmpty { b.level }} · ${b.villages.joinToString()}", fontWeight = FontWeight.Bold)
            Muted(istTime(b.sentAt))
            Text(b.text, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                for ((k, n) in b.counts) Badge("${messageStatusLabel(k)}: $n", p.ink, p.sunken)
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                OutlinedButton(onClick = { copy(context, "Alert text", b.text) }) { Text("Copy message") }
                OutlinedButton(onClick = { copy(context, "Phone numbers", b.recipients.joinToString { "+91" + it.phone }) }) { Text("Copy numbers") }
                if ((b.counts["manual"] ?: 0) > 0) Button(onClick = { vm.act { admin.markSent(b) } }, enabled = !st.isBusy) { Text("Mark all sent") }
                if ((b.counts["failed"] ?: 0) > 0 && !manualMode) OutlinedButton(onClick = { vm.act { admin.retryFailed(b) } }, enabled = !st.isBusy) { Text("Try failed again") }
            }
            TextButton(onClick = { open = !open }) { Text((if (open) "Hide " else "Show ") + plural(b.recipients.size, "person", "people")) }
            if (open) {
                for (r in b.recipients) {
                    Row {
                        Text("${r.name ?: "—"} · ${r.village.orEmpty()}", modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                        Text(r.phone, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(end = 6.dp))
                        Text(messageStatusLabel(r.status), style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }
}

// --- system ---------------------------------------------------------------------------

@Composable
private fun SystemSection(st: AppState) {
    val s = st.admin.status ?: return Loading(st)
    val mb = { n: Long -> String.format(Locale.ROOT, "%.1f MB", n / 1e6) }
    Text("Text messages", style = MaterialTheme.typography.titleMedium)
    Text(
        if (s.sms.enabled) "Connected (${s.sms.mode}${if (s.sms.host.isNotEmpty()) ", ${s.sms.host}" else ""})."
        else "Not connected. Alerts are listed under Messages for staff to send by hand, and sign-up codes are off.",
    )
    Muted(if (s.outbox.isEmpty()) "No messages yet." else s.outbox.entries.joinToString(" · ") { (k, n) -> "$k: $n" })
    HorizontalDivider()
    Text("Backups", style = MaterialTheme.typography.titleMedium)
    val bk = s.system.backups
    if (bk?.dir != null) {
        Text("Every ${bk.everyHours?.let { ReportDraft.plain(it) } ?: "?"} h to ${bk.dir}, keeping ${bk.keep ?: "?"}.")
        Muted((bk.lastAt?.let { "Last backup ${ago(it)}: ${bk.lastPath.orEmpty()}" } ?: "First backup is running.") + (bk.error?.let { " · Last error: $it" } ?: ""))
    } else {
        Text("Automatic backups are off.")
        Muted("Start the server with --backup-dir /path/to/backups, or run python -m hatialert backup on a schedule.")
    }
    HorizontalDivider()
    Text("Storage", style = MaterialTheme.typography.titleMedium)
    for ((k, v) in listOf(
        "Database" to mb(s.storage.dbBytes), "Photos and voice" to mb(s.storage.mediaBytes),
        "People" to s.storage.users.toString(), "Incidents" to s.storage.incidents.toString(),
    )) {
        Row { Text(k, modifier = Modifier.width(160.dp), color = argb(LocalPalette.current.muted)); Text(v) }
    }
    HorizontalDivider()
    Text("Recent admin actions", style = MaterialTheme.typography.titleMedium)
    if (s.audit.isEmpty()) Muted("Nothing yet.")
    for (e in s.audit) {
        Column {
            Text(e.action.replace('_', ' '), fontWeight = FontWeight.Bold)
            Muted(ago(e.at) + (e.by?.let { " · $it" } ?: ""))
            Text(e.detail, style = MaterialTheme.typography.bodySmall)
        }
    }
}
