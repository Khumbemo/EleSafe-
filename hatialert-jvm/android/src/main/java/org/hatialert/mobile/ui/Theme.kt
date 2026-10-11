package org.hatialert.mobile.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import org.hatialert.client.app.Palette
import org.hatialert.client.app.Palettes
import org.hatialert.client.app.ThemeChoice

/** The web palette in use, for colours Material has no slot for (severity, map). */
val LocalPalette = staticCompositionLocalOf { Palettes.greenLight }

fun argb(value: Long): Color = Color(value)

/** Green follows the phone's dark mode; White, Dark and Navy are fixed, as in the web app. */
@Composable
fun HatiTheme(choice: ThemeChoice, content: @Composable () -> Unit) {
    val p = choice.palette(isSystemInDarkTheme())
    CompositionLocalProvider(LocalPalette provides p) {
        MaterialTheme(colorScheme = scheme(p), content = content)
    }
}

private fun scheme(p: Palette) = if (p.isDark) {
    darkColorScheme(
        primary = argb(p.accent), onPrimary = argb(p.accentInk),
        primaryContainer = argb(p.accentSoft), onPrimaryContainer = argb(p.ink),
        secondary = argb(p.accent), onSecondary = argb(p.accentInk),
        secondaryContainer = argb(p.accentSoft), onSecondaryContainer = argb(p.ink),
        background = argb(p.bg), onBackground = argb(p.ink),
        surface = argb(p.surface), onSurface = argb(p.ink),
        surfaceVariant = argb(p.sunken), onSurfaceVariant = argb(p.muted),
        surfaceContainer = argb(p.surface), surfaceContainerHigh = argb(p.sunken),
        outline = argb(p.line), outlineVariant = argb(p.line),
        error = argb(p.crit), onError = argb(p.bg), errorContainer = argb(p.critSoft), onErrorContainer = argb(p.crit),
    )
} else {
    lightColorScheme(
        primary = argb(p.accent), onPrimary = argb(p.accentInk),
        primaryContainer = argb(p.accentSoft), onPrimaryContainer = argb(p.ink),
        secondary = argb(p.accent), onSecondary = argb(p.accentInk),
        secondaryContainer = argb(p.accentSoft), onSecondaryContainer = argb(p.ink),
        background = argb(p.bg), onBackground = argb(p.ink),
        surface = argb(p.surface), onSurface = argb(p.ink),
        surfaceVariant = argb(p.sunken), onSurfaceVariant = argb(p.muted),
        surfaceContainer = argb(p.surface), surfaceContainerHigh = argb(p.sunken),
        outline = argb(p.line), outlineVariant = argb(p.line),
        error = argb(p.crit), onError = argb(0xFFFFFFFF), errorContainer = argb(p.critSoft), onErrorContainer = argb(p.crit),
    )
}
