// Typed client for the hatialert-py JSON API, plus the app's state layer
// (AppController) that the Android ViewModel wraps. Plain Kotlin/JVM: uses
// HttpURLConnection and kotlinx.serialization, both of which run unchanged on Android.
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
        allWarningsAsErrors.set(true)
        optIn.add("kotlin.io.encoding.ExperimentalEncodingApi")
    }
}

dependencies {
    api(project(":core"))
    api(libs.kotlinx.serialization.json)
    api(libs.kotlinx.coroutines.core)

    testImplementation(kotlin("test"))
    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.launcher)
}

tasks.test {
    useJUnitPlatform()
    // The integration test starts the real Python server from here (skipped without Python 3.10+).
    systemProperty("hatialert.py.dir", rootProject.file("../hatialert-py").absolutePath)
    // The JDK's HttpURLConnection refuses PATCH; UrlConnectionTransport then sets the
    // method reflectively, which needs this on JDK 16+. Android's HttpURLConnection
    // supports PATCH natively, so the app needs nothing like it.
    jvmArgs("--add-opens", "java.base/java.net=ALL-UNNAMED")
    testLogging {
        events("failed", "skipped")
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
        showStandardStreams = false
    }
}
