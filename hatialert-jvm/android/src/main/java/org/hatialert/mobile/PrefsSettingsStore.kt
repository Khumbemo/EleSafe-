package org.hatialert.mobile

import android.content.Context
import org.hatialert.client.app.Settings
import org.hatialert.client.app.SettingsStore
import org.hatialert.client.app.ThemeChoice

/**
 * Settings in SharedPreferences (private to the app; backups are off in the
 * manifest). The session token is stored encrypted with a Keystore key
 * ([TokenCipher]); a plain token left by an earlier version is encrypted and
 * rewritten on first load. A token that can't be decrypted (the key is gone,
 * e.g. after app data was restored to another phone) is dropped, and the person
 * simply signs in again.
 */
class PrefsSettingsStore(context: Context, private val cipher: TokenCipher = TokenCipher()) : SettingsStore {
    private val prefs = context.applicationContext.getSharedPreferences("hatialert", Context.MODE_PRIVATE)

    /** The token last loaded or saved and its stored form, so unrelated saves don't re-encrypt it. */
    private var known: Pair<String, String>? = null

    /**
     * When the Keystore can't encrypt, the token is kept only for this run of the app
     * (never written in plain text); here so [load] still returns it until then.
     */
    private var memoryOnlyToken: String? = null

    override fun load() = Settings(
        serverUrl = prefs.getString(KEY_SERVER, null) ?: Settings.DEFAULT_SERVER_URL,
        theme = ThemeChoice.fromName(prefs.getString(KEY_THEME, null)),
        token = loadToken(),
        lastPhone = prefs.getString(KEY_PHONE, null) ?: "",
    )

    private fun loadToken(): String? {
        memoryOnlyToken?.let { return it }
        val stored = prefs.getString(KEY_TOKEN, null) ?: return null
        if (!TokenCipher.isEncrypted(stored)) {
            // Written by a version before encryption: encrypt it now, or drop it if that is impossible.
            writeToken(stored)
            return stored
        }
        val token = cipher.decrypt(stored)
        if (token == null) {
            prefs.edit().remove(KEY_TOKEN).apply()
            return null
        }
        known = token to stored
        return token
    }

    override fun save(settings: Settings) {
        prefs.edit()
            .putString(KEY_SERVER, settings.serverUrl)
            .putString(KEY_THEME, settings.theme.name)
            .putString(KEY_PHONE, settings.lastPhone)
            .apply()
        writeToken(settings.token)
    }

    private fun writeToken(token: String?) {
        if (token == null) {
            known = null
            memoryOnlyToken = null
            prefs.edit().remove(KEY_TOKEN).apply()
            return
        }
        val k = known
        if (k != null && k.first == token && memoryOnlyToken == null) return
        val sealed = cipher.encrypt(token)
        if (sealed == null) {
            known = null
            memoryOnlyToken = token
            prefs.edit().remove(KEY_TOKEN).apply()
        } else {
            known = token to sealed
            memoryOnlyToken = null
            prefs.edit().putString(KEY_TOKEN, sealed).apply()
        }
    }

    private companion object {
        const val KEY_SERVER = "server_url"
        const val KEY_THEME = "theme"
        const val KEY_TOKEN = "token"
        const val KEY_PHONE = "last_phone"
    }
}
