package org.hatialert.mobile.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import org.hatialert.client.app.AppState
import org.hatialert.mobile.AppViewModel

@Composable
fun SignInScreen(st: AppState, vm: AppViewModel) {
    var phone by rememberSaveable { mutableStateOf(st.settings.lastPhone) }
    var pin by rememberSaveable { mutableStateOf("") }
    var editServer by rememberSaveable { mutableStateOf(false) }
    var server by rememberSaveable { mutableStateOf(st.settings.serverUrl) }
    var serverError by rememberSaveable { mutableStateOf<String?>(null) }

    Column(
        Modifier.verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Elephant incident reporting for the villages around Wokha.", style = MaterialTheme.typography.bodyLarge)
        OutlinedTextField(
            value = phone, onValueChange = { phone = it },
            label = { Text("Mobile number") }, singleLine = true,
            isError = st.fieldErrors.containsKey("phone"),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
            modifier = Modifier.fillMaxWidth(),
        )
        FieldError(st.fieldErrors, "phone")
        OutlinedTextField(
            value = pin, onValueChange = { v -> pin = v.filter { it.isDigit() }.take(6) },
            label = { Text("PIN") }, singleLine = true,
            isError = st.fieldErrors.containsKey("pin"),
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
            modifier = Modifier.fillMaxWidth(),
        )
        FieldError(st.fieldErrors, "pin")
        Button(onClick = { vm.act { signIn(phone, pin) } }, enabled = !st.isBusy, modifier = Modifier.fillMaxWidth()) {
            Text("Sign in")
        }

        val demo = st.meta?.demoAccounts.orEmpty()
        if (demo.isNotEmpty()) {
            Spacer(Modifier.height(4.dp))
            Text("Demo accounts on this server (tap to fill in):", style = MaterialTheme.typography.titleSmall)
            for (a in demo) {
                Card(Modifier.fillMaxWidth().clickable { phone = a.phone; pin = a.pin }) {
                    Column(Modifier.padding(12.dp)) {
                        Text("${a.name} (${a.role}, ${a.village})", style = MaterialTheme.typography.bodyMedium)
                        Text("${a.phone} / PIN ${a.pin}", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }

        Spacer(Modifier.height(8.dp))
        if (!editServer) {
            Row {
                Text("Server: ${st.settings.serverUrl}", style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f).padding(top = 12.dp))
                TextButton(onClick = { server = st.settings.serverUrl; editServer = true }) { Text("Change") }
            }
        } else {
            ServerField(server, serverError, onChange = { server = it; serverError = null })
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = {
                    serverError = vm.controller.setServerUrl(server)
                    if (serverError == null) {
                        editServer = false
                        vm.act { loadMeta() }
                    }
                }) { Text("Use this server") }
                TextButton(onClick = { editServer = false }) { Text("Cancel") }
            }
        }
    }
}

@Composable
fun ServerField(value: String, error: String?, onChange: (String) -> Unit) {
    OutlinedTextField(
        value = value, onValueChange = onChange, singleLine = true,
        label = { Text("Server address") },
        isError = error != null,
        supportingText = {
            Text(error ?: "Emulator: http://10.0.2.2:8000. A phone on Wi-Fi: http://<laptop address>:8000 (debug builds only).")
        },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
        modifier = Modifier.fillMaxWidth(),
    )
}
