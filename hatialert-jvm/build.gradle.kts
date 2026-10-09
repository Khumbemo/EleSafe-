// Kotlin plugins are loaded once, here, and shared by :client and :android.
// The Android Gradle plugin is added to this classpath by settings.gradle.kts
// only when an Android SDK is configured.
plugins {
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.kotlin.compose) apply false
}
