package org.hatialert.mobile.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.unit.dp

/**
 * How the app lays itself out for the current window, following the Material
 * window size classes (compact < 600 dp wide, medium 600-839 dp, expanded >= 840 dp;
 * compact height < 480 dp, i.e. a phone held sideways).
 */
data class WindowLayout(val widthDp: Int, val heightDp: Int) {
    /** Navigation rail at the side instead of the bottom bar: tablets and phones held sideways. */
    val rail: Boolean get() = widthDp >= 600 || heightDp < 480
    /** Cases list and the open case side by side. */
    val twoPane: Boolean get() = widthDp >= 840
    /** Home map next to the incident list rather than above it. */
    val mapBeside: Boolean get() = widthDp >= 840 || (widthDp >= 600 && widthDp > heightDp)
    /** Taller map when it sits above the list on a tablet in portrait. */
    val mapHeightDp: Int get() = if (widthDp >= 600) 420 else 300

    companion object {
        /** Readable line length for forms and text on wide screens. */
        val READABLE = 720.dp
    }
}

/**
 * The size of the app's own window (not the whole screen), so split screen and
 * freeform windows get the layout that fits them. Recomputed when it changes:
 * rotation, split screen, window resizing.
 */
@Composable
fun rememberWindowLayout(): WindowLayout {
    val size = LocalWindowInfo.current.containerSize // pixels
    return with(LocalDensity.current) {
        WindowLayout(size.width.toDp().value.toInt(), size.height.toDp().value.toInt())
    }
}

/** Fills the space it is given, but no wider than [WindowLayout.READABLE]. */
fun Modifier.readable(): Modifier = this.widthIn(max = WindowLayout.READABLE).fillMaxSize()
