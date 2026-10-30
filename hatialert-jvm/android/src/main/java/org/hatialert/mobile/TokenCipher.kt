package org.hatialert.mobile

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.io.IOException
import java.security.GeneralSecurityException
import java.security.KeyStore
import java.security.ProviderException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Encrypts the session token with an AES-256/GCM key that lives in the Android
 * Keystore (never in the app's files), so a copy of the app's storage alone
 * does not give away the session. Stored form: `v1:` + base64(12-byte IV + ciphertext and tag).
 *
 * Failure handling, in one place: both functions return null instead of
 * throwing. [encrypt] returns null when the Keystore can't be used; the caller
 * then keeps the token in memory only. [decrypt] returns null when the key is
 * gone or no longer matches (app data restored to another phone, lock screen
 * reset, Keystore wiped) or the stored text is damaged; the caller then treats
 * the person as signed out.
 */
class TokenCipher(private val alias: String = "hatialert_token") {

    fun encrypt(plain: String): String? = guarded {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key(create = true))
        val iv = cipher.iv
        val sealed = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        PREFIX + Base64.encodeToString(iv + sealed, Base64.NO_WRAP)
    }

    fun decrypt(stored: String): String? = guarded {
        if (!isEncrypted(stored)) return@guarded null
        val raw = Base64.decode(stored.substring(PREFIX.length), Base64.NO_WRAP)
        if (raw.size <= IV_BYTES) return@guarded null
        val key = key(create = false) ?: return@guarded null // never make a new key to read an old token
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, raw, 0, IV_BYTES))
        String(cipher.doFinal(raw, IV_BYTES, raw.size - IV_BYTES), Charsets.UTF_8)
    }

    private fun key(create: Boolean): SecretKey? {
        val ks = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (ks.getKey(alias, null) as? SecretKey)?.let { return it }
        if (!create) return null
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        gen.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return gen.generateKey()
    }

    /** Keystore and cipher failures (checked or not) become null. */
    private inline fun guarded(block: () -> String?): String? = try {
        block()
    } catch (e: GeneralSecurityException) { // includes AEADBadTagException, KeyPermanentlyInvalidatedException
        null
    } catch (e: ProviderException) { // Keystore daemon trouble on some devices
        null
    } catch (e: IOException) { // KeyStore.load can fail with an IOException
        null
    } catch (e: IllegalArgumentException) { // not base64
        null
    } catch (e: IllegalStateException) {
        null
    }

    companion object {
        private const val KEYSTORE = "AndroidKeyStore"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val PREFIX = "v1:"
        private const val IV_BYTES = 12
        private const val TAG_BITS = 128

        /** False for a token saved in plain text by an earlier version of the app. */
        fun isEncrypted(stored: String) = stored.startsWith(PREFIX)
    }
}
