// HatiAlert Android app. Included in the build only when an Android SDK is
// configured (see settings.gradle.kts); the Android Gradle plugin is put on the
// root classpath there, so it is applied here without a version.
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "org.hatialert.mobile"
    compileSdk = 35

    defaultConfig {
        applicationId = "org.hatialert.mobile"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Unsigned: sign with your own key before distributing (see README).
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = false
    }

    lint {
        // The app is compiled only in CI (no SDK in the authoring container), so lint
        // reports instead of failing the build; the report is uploaded as an artifact.
        // Lint errors fail the build; warnings are reported in the log.
        abortOnError = true
        checkReleaseBuilds = true
        htmlReport = true
        // Plain-text copy (build/reports/lint-results-debug.txt) that CI prints into its log.
        textReport = true
    }

    packaging {
        resources {
            excludes += setOf("/META-INF/{AL2.0,LGPL2.1}", "/META-INF/versions/9/previous-compilation-data.bin")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(project(":client"))

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.icons)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.exifinterface)
    implementation(libs.androidx.lifecycle.viewmodel.ktx)
    implementation(libs.kotlinx.coroutines.android)
}
