package org.hatialert.mobile

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import org.hatialert.client.app.Screen
import org.hatialert.client.app.Translator
import org.hatialert.mobile.ui.HatiApp
import org.hatialert.mobile.ui.HatiTheme
import org.hatialert.mobile.ui.LocalTranslator

class MainActivity : ComponentActivity() {
    private val vm: AppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        handleOpen(intent)
        setContent {
            val state by vm.state.collectAsState()
            val dark = state.settings.theme.palette(isSystemInDarkTheme()).isDark
            LaunchedEffect(dark) {
                // Status and navigation bar icons follow the app theme, not only the system setting.
                val style = if (dark) {
                    SystemBarStyle.dark(Color.TRANSPARENT)
                } else {
                    SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
                }
                enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
            }
            val signedIn = state.user != null
            LaunchedEffect(state.settings.notifications, signedIn) {
                // The background check runs only while switched on and someone is signed in.
                Warnings.schedule(applicationContext, state.settings.notifications && signedIn)
            }
            val translator = remember(state.settings.language) { Translator.forLanguage(state.settings.language) }
            CompositionLocalProvider(LocalTranslator provides translator) {
                HatiTheme(state.settings.theme) {
                    HatiApp(vm)
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleOpen(intent)
    }

    /** A tapped warning notification opens Alerts (after sign-in if needed). */
    private fun handleOpen(intent: Intent?) {
        if (intent?.getStringExtra(Warnings.EXTRA_OPEN) == Warnings.OPEN_ALERTS) {
            intent.removeExtra(Warnings.EXTRA_OPEN) // not again after a rotation
            vm.act { openWhenReady(Screen.Alerts) }
        }
    }
}
