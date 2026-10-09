// Pure domain logic ported from hatialert-py (domain.py, geo.py).
// Java 17 bytecode, no runtime dependencies, nothing Android lacks at minSdk 24
// (no java.time, java.util.Base64, java.net.http or records).
plugins {
    `java-library`
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

tasks.withType<JavaCompile>().configureEach {
    options.release.set(17)
    options.encoding = "UTF-8"
    options.compilerArgs.addAll(listOf("-Xlint:all", "-Werror"))
}

dependencies {
    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.launcher)
}

tasks.test {
    useJUnitPlatform()
    // The fixture-freshness test re-runs tools/gen_python_vectors.py when Python is present.
    systemProperty("hatialert.jvm.dir", rootProject.projectDir.absolutePath)
    systemProperty("hatialert.py.dir", rootProject.file("../hatialert-py").absolutePath)
    testLogging { events("failed", "skipped"); exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL }
}
