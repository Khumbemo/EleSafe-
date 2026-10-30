package org.hatialert.mobile

import android.app.Application
import android.net.ConnectivityManager
import android.net.Network
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import java.io.File
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import org.hatialert.client.app.AppController
import org.hatialert.client.app.AppState
import org.hatialert.client.app.FileOutboxStore

/**
 * Thin Android wrapper: owns the [AppController] (all behaviour lives there,
 * in :client, and is unit-tested on the JVM) and runs its suspend actions in
 * [viewModelScope], so they survive rotation and stop when the app is closed.
 * Reports saved while offline wait in `filesDir/outbox` and are sent when the
 * phone gets a network again.
 */
class AppViewModel(app: Application) : AndroidViewModel(app) {
    val controller = AppController(PrefsSettingsStore(app), outbox = FileOutboxStore(File(app.filesDir, "outbox")))
    val state: StateFlow<AppState> = controller.state

    private val connectivity: ConnectivityManager? = app.getSystemService(ConnectivityManager::class.java)

    /** Called on a system thread; the flush itself runs in [viewModelScope]. */
    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            act { flushOutbox() }
        }
    }
    private var callbackRegistered = false

    init {
        act { start() }
        try {
            // API 24+. Also fires once right away when a network is already up; a flush with
            // nothing waiting, or before sign-in, does nothing.
            connectivity?.registerDefaultNetworkCallback(networkCallback)
            callbackRegistered = connectivity != null
        } catch (e: RuntimeException) {
            // SecurityException without ACCESS_NETWORK_STATE, or too many callbacks on some
            // devices: reports still go out on launch, sign-in and refreshing home.
        }
    }

    /** Runs a controller action, e.g. `vm.act { loadAlerts() }`. */
    fun act(action: suspend AppController.() -> Unit) {
        viewModelScope.launch { controller.action() }
    }

    override fun onCleared() {
        if (callbackRegistered) {
            try {
                connectivity?.unregisterNetworkCallback(networkCallback)
            } catch (e: IllegalArgumentException) {
                // already unregistered
            }
            callbackRegistered = false
        }
        super.onCleared()
    }
}
