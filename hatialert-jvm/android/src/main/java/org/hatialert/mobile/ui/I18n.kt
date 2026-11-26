package org.hatialert.mobile.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import org.hatialert.client.app.Translator

/**
 * The interface language chosen in Settings. English is written in the code; with
 * Nagamese, [tr] swaps each English text for the web app's phrase (client's [Translator],
 * from nagamese.json), leaving it in English when the table has no entry.
 */
val LocalTranslator = staticCompositionLocalOf { Translator.ENGLISH }

/**
 * Interface text in the chosen language. Only for text the app itself writes and for the
 * server's labels and messages that the web app translates too (types, statuses, severities,
 * alert types, error messages); never for names, alert messages, notes or report numbers.
 */
@Composable
@ReadOnlyComposable
fun tr(text: String): String = LocalTranslator.current.tr(text)
