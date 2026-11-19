package org.hatialert.mobile.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import org.hatialert.client.app.AppState
import org.hatialert.mobile.AppViewModel

/** A labelled text box whose error comes from [AppState.fieldErrors] under [field]. */
@Composable
fun FormField(
    st: AppState,
    field: String,
    label: String,
    value: String,
    onChange: (String) -> Unit,
    keyboard: KeyboardType = KeyboardType.Text,
    secret: Boolean = false,
    hint: String? = null,
    minLines: Int = 1,
) {
    val error = st.fieldErrors[field]
    OutlinedTextField(
        value = value, onValueChange = onChange, label = { Text(label) },
        singleLine = minLines == 1, minLines = minLines,
        isError = error != null,
        supportingText = (error ?: hint)?.let { t -> { Text(t) } },
        visualTransformation = if (secret) PasswordVisualTransformation() else VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = keyboard),
        modifier = Modifier.fillMaxWidth(),
    )
}

private fun digits(v: String, max: Int = 6) = v.filter { it.isDigit() }.take(max)

@Composable
fun PinFields(st: AppState, pin: String, pin2: String, onPin: (String) -> Unit, onPin2: (String) -> Unit, newLabel: String = "New PIN") {
    FormField(st, "pin", newLabel, pin, { onPin(digits(it)) }, KeyboardType.NumberPassword, secret = true, hint = "4 to 6 digits, not 1111 or 1234")
    FormField(st, "pin2", "Repeat PIN", pin2, { onPin2(digits(it)) }, KeyboardType.NumberPassword, secret = true)
}

/** Phone box with "Send code" beside it, and what the server answered under it. */
@Composable
private fun CodeRequest(st: AppState, vm: AppViewModel, phone: String, purpose: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text("We text a 6-digit code to check the number is yours.", style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
        OutlinedButton(onClick = { vm.act { requestCode(phone, purpose) } }, enabled = !st.isBusy) { Text("Send code") }
    }
    st.authNote?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
}

@Composable
private fun VillageChoice(st: AppState, selected: String?, onSelect: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        OutlinedButton(onClick = { open = true }, modifier = Modifier.fillMaxWidth()) {
            Text(selected?.let { "Village: $it" } ?: "Choose your village")
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            for (v in st.villages) {
                DropdownMenuItem(text = { Text(v.name) }, onClick = {
                    onSelect(v.name)
                    open = false
                })
            }
        }
    }
    FieldError(st.fieldErrors, "village")
}

/** Sign-up (auth.ts viewRegister): with a texted code when the server sends texts. */
@Composable
fun RegisterScreen(st: AppState, vm: AppViewModel) {
    var name by rememberSaveable { mutableStateOf("") }
    var phone by rememberSaveable { mutableStateOf("") }
    var code by rememberSaveable { mutableStateOf("") }
    var village by rememberSaveable { mutableStateOf<String?>(null) }
    var pin by rememberSaveable { mutableStateOf("") }
    var pin2 by rememberSaveable { mutableStateOf("") }
    val sms = st.meta?.smsEnabled == true

    Column(Modifier.verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("Your village sets which warnings you get.", style = MaterialTheme.typography.bodyLarge)
        FormField(st, "name", "Full name", name, { name = it.take(60) })
        FormField(st, "phone", "Mobile number", phone, { phone = it.take(16) }, KeyboardType.Phone)
        if (sms) {
            CodeRequest(st, vm, phone, "register")
            FormField(st, "code", "Code from the text message", code, { code = digits(it) }, KeyboardType.Number)
        }
        VillageChoice(st, village) { village = it }
        PinFields(st, pin, pin2, { pin = it }, { pin2 = it }, newLabel = "Choose a PIN")
        Button(
            onClick = { vm.act { register(name, phone, village, pin, pin2, code.takeIf { sms }) } },
            enabled = !st.isBusy, modifier = Modifier.fillMaxWidth(),
        ) { Text("Create account") }
        Text(
            "New accounts start as villagers. Forest staff accounts are set up by the forest office.",
            style = MaterialTheme.typography.bodySmall, color = argb(LocalPalette.current.muted),
        )
    }
}

/** Forgotten PIN (auth.ts viewForgot). */
@Composable
fun ForgotPinScreen(st: AppState, vm: AppViewModel) {
    var phone by rememberSaveable { mutableStateOf(st.settings.lastPhone) }
    var code by rememberSaveable { mutableStateOf("") }
    var pin by rememberSaveable { mutableStateOf("") }
    var pin2 by rememberSaveable { mutableStateOf("") }
    val p = LocalPalette.current

    Column(Modifier.verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (st.meta?.smsEnabled != true) {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Ask a forest officer or forest guard to reset your PIN. They will give you a temporary PIN, and you choose a new one when you sign in.")
                    Text("Text-message codes aren't set up on this server yet.", style = MaterialTheme.typography.bodySmall, color = argb(p.muted))
                }
            }
            return@Column
        }
        Text("We'll text you a code, then you choose a new PIN.", color = argb(p.muted))
        FormField(st, "phone", "Mobile number", phone, { phone = it.take(16) }, KeyboardType.Phone)
        CodeRequest(st, vm, phone, "reset")
        FormField(st, "code", "Code from the text message", code, { code = digits(it) }, KeyboardType.Number)
        PinFields(st, pin, pin2, { pin = it }, { pin2 = it })
        Button(onClick = { vm.act { resetPin(phone, code, pin, pin2) } }, enabled = !st.isBusy, modifier = Modifier.fillMaxWidth()) {
            Text("Save new PIN")
        }
    }
}

/** Change PIN (Settings) or, with [temp], the forced choice after a temporary PIN (auth.ts pinForm). */
@Composable
fun PinChangeForm(st: AppState, vm: AppViewModel, temp: Boolean) {
    var old by rememberSaveable { mutableStateOf("") }
    var pin by rememberSaveable { mutableStateOf("") }
    var pin2 by rememberSaveable { mutableStateOf("") }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(if (temp) "Choose your own PIN" else "Change PIN", style = MaterialTheme.typography.titleMedium)
        if (temp) Text("You signed in with a temporary PIN. Choose a new one that only you know.")
        FormField(st, "old_pin", if (temp) "Temporary PIN" else "Current PIN", old, { old = digits(it) }, KeyboardType.NumberPassword, secret = true)
        PinFields(st, pin, pin2, { pin = it }, { pin2 = it })
        Button(onClick = {
            vm.act {
                if (changePin(old, pin, pin2)) {
                    old = ""
                    pin = ""
                    pin2 = ""
                }
            }
        }, enabled = !st.isBusy) { Text("Save new PIN") }
    }
}

/** Shown instead of the app while the server wants a new PIN first. */
@Composable
fun NewPinScreen(st: AppState, vm: AppViewModel) {
    Column(Modifier.verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        PinChangeForm(st, vm, temp = true)
        TextButton(onClick = { vm.act { signOut() } }) { Text("Sign out") }
    }
}
