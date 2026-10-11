// HatiAlert JVM/Android build.
//
// :core and :client build anywhere with a JDK. :android is included only when an
// Android SDK is configured (ANDROID_HOME / ANDROID_SDK_ROOT, or sdk.dir in
// local.properties), so `./gradlew build` also works on machines without one.
import java.util.Properties

pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}

rootProject.name = "hatialert-jvm"

include(":core", ":client")

fun androidSdkDir(): File? {
    val local = file("local.properties")
    val fromLocal = if (local.isFile) {
        Properties().apply { local.inputStream().use { load(it) } }.getProperty("sdk.dir")
    } else null
    return listOfNotNull(fromLocal, System.getenv("ANDROID_HOME"), System.getenv("ANDROID_SDK_ROOT"))
        .map { File(it) }
        .firstOrNull { it.isDirectory }
}

val sdk = androidSdkDir()
val withAndroid = sdk != null && providers.gradleProperty("hatialert.skipAndroid").orNull != "true"

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        mavenCentral()
        if (withAndroid) {
            // AndroidX and friends; only consulted when :android is part of the build.
            google {
                content {
                    includeGroupByRegex("androidx\\..*")
                    includeGroupByRegex("com\\.android(\\..*)?")
                    includeGroupByRegex("com\\.google\\.android\\..*")
                    includeGroupByRegex("com\\.google\\.testing\\..*")
                }
            }
        }
    }
}

if (withAndroid) {
    include(":android")
    // AGP must sit in the same classloader as the Kotlin plugin (declared in the
    // root build script), so it goes on the root build-script classpath, but
    // only here: without an SDK nothing from Google's Maven is ever resolved.
    val agp = file("gradle/libs.versions.toml").readLines()
        .first { it.trim().startsWith("agp ") || it.trim().startsWith("agp=") }
        .substringAfter('"').substringBefore('"')
    gradle.rootProject {
        buildscript {
            repositories {
                google()
                mavenCentral()
            }
            dependencies { classpath("com.android.tools.build:gradle:$agp") }
        }
    }
} else {
    logger.lifecycle("HatiAlert: no Android SDK configured, building :core and :client only.")
}
