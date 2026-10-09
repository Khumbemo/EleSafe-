package org.hatialert.mobile.ui

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.hatialert.client.app.AppState
import org.hatialert.client.app.ThemeChoice
import org.hatialert.client.app.fmtKm
import org.hatialert.core.Contacts
import org.hatialert.mobile.AppViewModel

@Composable
fun SettingsScreen(st: AppState, vm: AppViewModel) {
    val c = vm.controller
    val p = LocalPalette.current
    val context = LocalContext.current
    var server by rememberSaveable { mutableStateOf(st.settings.serverUrl) }
    var serverError by rememberSaveable { mutableStateOf<String?>(null) }

    Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        st.user?.let { u ->
            Text(u.name, style = MaterialTheme.typography.titleMedium)
            Text("${u.role.replaceFirstChar { it.uppercase() }} · ${u.village} · ${u.phone}" + if (u.phoneVerified) "" else " (phone not verified)")
            Text("Alert area: ${fmtKm(u.radiusKm)} km around ${u.village}", color = argb(p.muted))
        }
        HorizontalDivider()

        Text("Theme", style = MaterialTheme.typography.titleMedium)
        for (t in ThemeChoice.entries) {
            Row(
                Modifier.fillMaxWidth().clickable { c.setTheme(t) },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                RadioButton(selected = st.settings.theme == t, onClick = { c.setTheme(t) })
                Text(if (t == ThemeChoice.GREEN) "${t.label} (follows the phone's light or dark mode)" else t.label)
            }
        }
        HorizontalDivider()

        Text("Server", style = MaterialTheme.typography.titleMedium)
        ServerField(server, serverError, onChange = { server = it; serverError = null })
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = {
                serverError = c.setServerUrl(server)
                if (serverError == null) vm.act { loadMeta() }
            }, enabled = server.trim().trimEnd('/') != st.settings.serverUrl) { Text("Save (signs you out)") }
            TextButton(onClick = { server = org.hatialert.client.app.Settings.DEFAULT_SERVER_URL; serverError = null }) { Text("Emulator default") }
        }
        HorizontalDivider()

        Text("Emergency numbers", style = MaterialTheme.typography.titleMedium)
        for (k in Contacts.LIST) {
            Row(
                Modifier.fillMaxWidth().clickable {
                    try {
                        context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + k.phone.filter { it.isDigit() || it == '+' })))
                    } catch (e: ActivityNotFoundException) {
                        // No dialler (e.g. a tablet); the number is on screen.
                    }
                }.padding(vertical = 4.dp),
            ) {
                Column(Modifier.weight(1f)) {
                    Text(k.name, fontWeight = FontWeight.Bold)
                    Text(k.role + if (k.placeholder) " (placeholder number, not a real line)" else "", style = MaterialTheme.typography.bodySmall, color = argb(p.muted))
                }
                Text(k.phone)
            }
        }
        HorizontalDivider()
        Text(
            "Village positions other than Wokha Town are from the original app and not yet verified. " +
                "Times are Indian Standard Time.",
            style = MaterialTheme.typography.bodySmall, color = argb(p.muted),
        )
        Button(onClick = { vm.act { signOut() } }, modifier = Modifier.fillMaxWidth()) { Text("Sign out") }
    }
}
