package org.hatialert.client.app

/**
 * Colour themes, matching the web palettes in hatialert-py/hatialert/web/app.css.
 * GREEN follows the phone's light/dark setting (:root and the
 * prefers-color-scheme block); WHITE, DARK and NAVY are fixed (data-skin=...).
 */
enum class ThemeChoice(val label: String) {
    GREEN("Green"),
    WHITE("White"),
    DARK("Dark"),
    NAVY("Navy blue");

    /** The palette to use given whether the system is in dark mode. */
    fun palette(systemDark: Boolean): Palette = when (this) {
        GREEN -> if (systemDark) Palettes.greenDark else Palettes.greenLight
        WHITE -> Palettes.white
        DARK -> Palettes.dark
        NAVY -> Palettes.navy
    }

    companion object {
        fun fromName(name: String?): ThemeChoice = entries.firstOrNull { it.name == name } ?: GREEN
    }
}

/** Colours as 0xAARRGGBB, named after the CSS custom properties. */
data class Palette(
    val isDark: Boolean,
    val bg: Long,
    val surface: Long,
    val sunken: Long,
    val ink: Long,
    val muted: Long,
    val line: Long,
    val accent: Long,
    val accentInk: Long,
    val accentSoft: Long,
    val crit: Long,
    val high: Long,
    val med: Long,
    val low: Long,
    val critSoft: Long,
    val highSoft: Long,
    val medSoft: Long,
    val lowSoft: Long,
    val focus: Long,
    val land: Long,
    val water: Long,
) {
    /** Text colour for a severity key. */
    fun severity(key: String): Long = when (key) {
        "critical" -> crit
        "high" -> high
        "medium" -> med
        else -> low
    }

    /** Background tint for a severity key. */
    fun severitySoft(key: String): Long = when (key) {
        "critical" -> critSoft
        "high" -> highSoft
        "medium" -> medSoft
        else -> lowSoft
    }
}

private fun c(rgb: Long): Long = 0xFF000000 or rgb

object Palettes {
    val greenLight = Palette(
        isDark = false,
        bg = c(0xf3f5f2), surface = c(0xffffff), sunken = c(0xe8ece7), ink = c(0x16201b), muted = c(0x55625b),
        line = c(0xd7ddd7), accent = c(0x1d5a42), accentInk = c(0xffffff), accentSoft = c(0xdfece5),
        crit = c(0xb3261e), high = c(0xa8481a), med = c(0x7f5f00), low = c(0x2c7349),
        critSoft = c(0xfae3e0), highSoft = c(0xfbe8db), medSoft = c(0xf4edd0), lowSoft = c(0xe0efe5),
        focus = c(0x2a6fdb), land = c(0xe7ebe3), water = c(0x2a69a8),
    )
    val greenDark = Palette(
        isDark = true,
        bg = c(0x0f1412), surface = c(0x161c19), sunken = c(0x1d2521), ink = c(0xe5ebe7), muted = c(0x9ba9a1),
        line = c(0x29332e), accent = c(0x7cc6a0), accentInk = c(0x0a140f), accentSoft = c(0x1b3729),
        crit = c(0xff7f76), high = c(0xffa36e), med = c(0xe2c35c), low = c(0x72d29d),
        critSoft = c(0x3a1d1b), highSoft = c(0x3a2517), medSoft = c(0x342c13), lowSoft = c(0x162f20),
        focus = c(0x8ab4ff), land = c(0x19211c), water = c(0x5aa9e6),
    )
    val white = Palette(
        isDark = false,
        bg = c(0xffffff), surface = c(0xffffff), sunken = c(0xf1f2f4), ink = c(0x14171a), muted = c(0x5a6069),
        line = c(0xe1e4e8), accent = c(0x1f2328), accentInk = c(0xffffff), accentSoft = c(0xeceef1),
        crit = c(0xb3261e), high = c(0xb04a12), med = c(0x7f5f00), low = c(0x23683f),
        critSoft = c(0xfbe6e4), highSoft = c(0xfcebdf), medSoft = c(0xf6efd3), lowSoft = c(0xe2f2e8),
        focus = c(0x2563eb), land = c(0xf3f3f1), water = c(0x2a69a8),
    )
    val dark = Palette(
        isDark = true,
        bg = c(0x111111), surface = c(0x1b1b1d), sunken = c(0x252528), ink = c(0xececec), muted = c(0xa3a3a8),
        line = c(0x323236), accent = c(0xececec), accentInk = c(0x111111), accentSoft = c(0x2c2c30),
        crit = c(0xff7f76), high = c(0xffa36e), med = c(0xe2c35c), low = c(0x72d29d),
        critSoft = c(0x3a1f1d), highSoft = c(0x3a2819), medSoft = c(0x332d16), lowSoft = c(0x18301f),
        focus = c(0x8ab4ff), land = c(0x1c1c1e), water = c(0x5aa9e6),
    )
    val navy = Palette(
        isDark = true,
        bg = c(0x0a1630), surface = c(0x10213f), sunken = c(0x172b4f), ink = c(0xe8eef8), muted = c(0xa3b3cc),
        line = c(0x24395d), accent = c(0x7cb8ff), accentInk = c(0x06122a), accentSoft = c(0x1b3763),
        crit = c(0xff8a80), high = c(0xffab76), med = c(0xe9c96a), low = c(0x7ad7a4),
        critSoft = c(0x3c1f2e), highSoft = c(0x3a2a2a), medSoft = c(0x33301f), lowSoft = c(0x14352f),
        focus = c(0xffd166), land = c(0x13284a), water = c(0x4fd1e8),
    )
}
