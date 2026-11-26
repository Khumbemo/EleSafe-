package org.hatialert.mobile.ui

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Switch
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
import androidx.core.net.toUri
import org.hatialert.client.app.AdminSection
import org.hatialert.client.app.AppState
import org.hatialert.client.app.Language
import org.hatialert.client.app.Screen
import org.hatialert.client.app.ThemeChoice
import org.hatialert.client.app.fmtKm
import org.hatialert.core.Contacts
import org.hatialert.core.Role
import org.hatialert.mobile.AppViewModel
import org.hatialert.mobile.Warnings

@Composable
fun SettingsScreen(st: AppState, vm: AppViewModel) {
    val c = vm.controller
    val p = LocalPalette.current
    val context = LocalContext.current
    var server by rememberSaveable { mutableStateOf(st.settings.serverUrl) }
    var serverError by rememberSaveable { mutableStateOf<String?>(null) }
    // Android 13+ asks the person before notifications can show; the switch follows the answer.
    val notifyPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        c.setNotifications(granted)
    }
    var askLogoutAll by rememberSaveable { mutableStateOf(false) }

    Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        st.user?.let { u ->
            Text(u.name, style = MaterialTheme.typography.titleMedium)
            Text("${u.role.replaceFirstChar { it.uppercase() }} · ${u.village} · ${u.phone}" + if (u.phoneVerified) "" else " (phone not verified)")
            Text(tr("Alert area: ${fmtKm(u.radiusKm)} km around ${u.village}"), color = argb(p.muted))
            if (u.roleEnum == Role.OFFICER) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { openAdmin(vm, AdminSection.STATS) }) { Text(tr("District overview")) }
                    OutlinedButton(onClick = { openAdmin(vm, AdminSection.PEOPLE) }) { Text(tr("Admin")) }
                }
            }
        }
        HorizontalDivider()

        Text(tr("Language"), style = MaterialTheme.typography.titleMedium)
        for (l in Language.entries) {
            Row(
                Modifier.fillMaxWidth().clickable { c.setLanguage(l) },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                RadioButton(selected = st.settings.language == l, onClick = { c.setLanguage(l) })
                Text(l.label)
            }
        }
        Text(
            "Nagamese is a draft translation, to be checked by a native speaker.",
            style = MaterialTheme.typography.bodySmall, color = argb(p.muted),
        )
        HorizontalDivider()

        Text(tr("Theme"), style = MaterialTheme.typography.titleMedium)
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

        st.user?.let { u ->
            Text(tr("Alerts"), style = MaterialTheme.typography.titleMedium)
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(tr("Text me alerts for ${u.village}"), modifier = Modifier.weight(1f))
                Switch(checked = u.smsAlerts, onCheckedChange = { on -> vm.act { setSmsAlerts(on) } }, enabled = !st.isBusy)
            }
            Text(
                if (st.meta?.smsEnabled == true) "Sent to your mobile number as SMS." else "Forest staff send these by hand until text messages are set up.",
                style = MaterialTheme.typography.bodySmall, color = argb(p.muted),
            )
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(tr("Show alerts on this phone"), modifier = Modifier.weight(1f))
                Switch(
                    checked = st.settings.notifications && Warnings.mayNotify(context),
                    onCheckedChange = { on ->
                        if (on && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !Warnings.mayNotify(context)) {
                            notifyPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                        } else {
                            c.setNotifications(on)
                        }
                    },
                )
            }
            Text(
                tr("Checked about every 15 minutes while the app is closed, so text messages are faster."),
                style = MaterialTheme.typography.bodySmall, color = argb(p.muted),
            )
            HorizontalDivider()
        }

        PinChangeForm(st, vm, temp = false)
        HorizontalDivider()

        Text(tr("Signed-in devices"), style = MaterialTheme.typography.titleMedium)
        Text(tr("Lost a phone, or signed in on someone else's? Sign out everywhere except here."), style = MaterialTheme.typography.bodySmall, color = argb(p.muted))
        OutlinedButton(onClick = { askLogoutAll = true }, enabled = !st.isBusy) { Text(tr("Sign out other devices")) }
        if (askLogoutAll) {
            AlertDialog(
                onDismissRequest = { askLogoutAll = false },
                title = { Text(tr("Sign out other devices?")) },
                text = { Text(tr("Every other phone and browser signed in to this account is signed out. This phone stays signed in.")) },
                confirmButton = {
                    TextButton(onClick = {
                        askLogoutAll = false
                        vm.act { signOutOtherDevices() }
                    }) { Text(tr("Sign them out")) }
                },
                dismissButton = { TextButton(onClick = { askLogoutAll = false }) { Text(tr("Cancel")) } },
            )
        }
        HorizontalDivider()

        Text(tr("Server"), style = MaterialTheme.typography.titleMedium)
        ServerField(server, serverError, onChange = { server = it; serverError = null })
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = {
                serverError = c.setServerUrl(server)
                if (serverError == null) vm.act { loadMeta() }
            }, enabled = server.trim().trimEnd('/') != st.settings.serverUrl) { Text(tr("Save (signs you out)")) }
            TextButton(onClick = { server = org.hatialert.client.app.Settings.DEFAULT_SERVER_URL; serverError = null }) { Text(tr("Emulator default")) }
        }
        HorizontalDivider()

        Text(tr("Emergency numbers"), style = MaterialTheme.typography.titleMedium)
        for (k in Contacts.LIST) {
            Row(
                Modifier.fillMaxWidth().clickable {
                    try {
                        context.startActivity(Intent(Intent.ACTION_DIAL, ("tel:" + k.phone.filter { it.isDigit() || it == '+' }).toUri()))
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
        Button(onClick = { vm.act { signOut() } }, modifier = Modifier.fillMaxWidth()) { Text(tr("Sign out")) }
    }
}

/** Opens an officer screen and loads it. */
fun openAdmin(vm: AppViewModel, section: AdminSection) {
    vm.controller.navigate(Screen.Admin(section))
    vm.act { admin.load(section) }
}
