package org.hatialert.mobile

import android.content.Context
import org.hatialert.client.app.Settings
import org.hatialert.client.app.SettingsStore
import org.hatialert.client.app.ThemeChoice

/**
 * Settings in SharedPreferences (private to the app; backups are off in the
 * manifest, so the session token stays on the phone).
 */
class PrefsSettingsStore(context: Context) : SettingsStore {
    private val prefs = context.applicationContext.getSharedPreferences("hatialert", Context.MODE_PRIVATE)

    override fun load() = Settings(
        serverUrl = prefs.getString(KEY_SERVER, null) ?: Settings.DEFAULT_SERVER_URL,
        theme = ThemeChoice.fromName(prefs.getString(KEY_THEME, null)),
        token = prefs.getString(KEY_TOKEN, null),
        lastPhone = prefs.getString(KEY_PHONE, null) ?: "",
    )

    override fun save(settings: Settings) {
        prefs.edit()
            .putString(KEY_SERVER, settings.serverUrl)
            .putString(KEY_THEME, settings.theme.name)
            .putString(KEY_TOKEN, settings.token)
            .putString(KEY_PHONE, settings.lastPhone)
            .apply()
    }

    private companion object {
        const val KEY_SERVER = "server_url"
        const val KEY_THEME = "theme"
        const val KEY_TOKEN = "token"
        const val KEY_PHONE = "last_phone"
    }
}
