package org.hatialert.mobile

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import org.hatialert.client.app.AppController
import org.hatialert.client.app.AppState

/**
 * Thin Android wrapper: owns the [AppController] (all behaviour lives there,
 * in :client, and is unit-tested on the JVM) and runs its suspend actions in
 * [viewModelScope], so they survive rotation and stop when the app is closed.
 */
class AppViewModel(app: Application) : AndroidViewModel(app) {
    val controller = AppController(PrefsSettingsStore(app))
    val state: StateFlow<AppState> = controller.state

    init {
        act { start() }
    }

    /** Runs a controller action, e.g. `vm.act { loadAlerts() }`. */
    fun act(action: suspend AppController.() -> Unit) {
        viewModelScope.launch { controller.action() }
    }
}
