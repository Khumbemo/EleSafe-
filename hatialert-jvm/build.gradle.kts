// Kotlin plugins are loaded once, here, and shared by :client and :android.
// The Android Gradle plugin is added to this classpath by settings.gradle.kts
// only when an Android SDK is configured.
plugins {
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.kotlin.compose) apply false
}

// The offline base map is drawn from the same files as the web map. The Android app keeps
// copies in its assets; after `python tools/build_map.py` in hatialert-py, run
// `./gradlew syncMapAssets` (client's MapAssetsTest fails while the copies differ).
tasks.register<Copy>("syncMapAssets") {
    group = "hatialert"
    description = "Copies map/layers.json and map/terrain.webp from hatialert-py into the Android assets."
    from(file("../hatialert-py/hatialert/web/map")) { include("layers.json", "terrain.webp") }
    into(file("android/src/main/assets/map"))
}
