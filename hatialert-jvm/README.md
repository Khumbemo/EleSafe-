# HatiAlert for the JVM and Android

The JVM side of HatiAlert, the elephant-incident reporting app for the villages around Wokha, Nagaland. It talks to
the Python server in [`../hatialert-py`](../hatialert-py), which stays the reference implementation.

| Module | Language | What it is |
|---|---|---|
| `core` | Java 17, no dependencies | Pure domain logic ported from `domain.py` and `geo.py`: incident types, severity rules, statuses and who may move them, media limits and type sniffing, haversine, bearing, compass points, destination point, IST report numbers `HA-yymm-NNNN`, seed villages (with verified/source flags), emergency contacts, UTM zone 46N forward and inverse. |
| `client` | Kotlin/JVM | Typed client for the JSON API (`HatiClient`), plus the app's state layer (`AppController`, report form rules, map projection, themes). Uses `HttpURLConnection` and kotlinx.serialization, so it runs unchanged on Android. |
| `android` | Kotlin, Jetpack Compose, Material 3 | The phone app (minSdk 24, compileSdk/targetSdk 35). A thin layer over `client`: sign in, home with nearby incidents and a native map, report, cases and case detail, alerts, settings. |

```
hatialert-jvm/
  settings.gradle.kts        includes :android only when an Android SDK is configured
  build.gradle.kts           Kotlin plugins, loaded once for all modules
  gradle/libs.versions.toml  every version pin
  gradlew, gradle/wrapper/   Gradle 8.14.3 wrapper (checksum-pinned)
  tools/gen_python_vectors.py  runs the Python code to produce the cross-check fixture
  core/
    src/main/java/org/hatialert/core/   Severity, Status, Role, IncidentType, AlertLevel, MediaKind, Limits,
                                        Geo, Utm, Ist, Village(s), Contacts, LatLng
    src/test/java/...                   DomainTest (vectors from tests/test_hatialert.py),
                                        PythonVectorsTest (fixture), FixtureFreshnessTest
    src/test/resources/python-vectors.json
  client/
    src/main/kotlin/org/hatialert/client/      HatiClient, Models, Http (transport), Errors
    src/main/kotlin/org/hatialert/client/app/  AppController (state + actions), ReportDraft, nearbyIncidents,
                                               MapScene/Viewport, ThemeChoice/Palettes
    src/test/kotlin/...                        unit tests + PythonServerIntegrationTest
  android/
    src/main/java/org/hatialert/mobile/        MainActivity, AppViewModel, PrefsSettingsStore, Gps, Photos
    src/main/java/org/hatialert/mobile/ui/     one file per screen, MapCanvas, Theme
    src/main/res/xml/network_security_config.xml   release cleartext policy
    src/debug/res/xml/network_security_config.xml  debug cleartext policy
```

## Build and test

Needs a JDK 17 or newer. The wrapper downloads Gradle itself.

```sh
cd hatialert-jvm
./gradlew build            # core + client: compile, unit tests, Python cross-checks, server integration test
./gradlew :core:test       # just the domain port
./gradlew :client:test     # client, app layer, and the live-server test
```

Without an Android SDK, the build prints `HatiAlert: no Android SDK configured, building :core and :client only.`
and nothing is fetched from Google's Maven.

### Tests that use Python

Both need Python 3.10+ on the `PATH` as `python3` or `python` (or set `HATIALERT_PYTHON`). Without it they are
reported as skipped, not failed.

- **`PythonServerIntegrationTest`** (client) starts the real server,
  `python -m hatialert --db <temp file> --port <free port>`, from `../hatialert-py`. It signs in with the demo
  accounts (villager 9000000001/1111, guard 9000000002/2222, officer 9000000003/3333), lists cases, checks that
  distances and directions worked out on the phone match the server's, files a report with a photo, resends it
  (same case comes back), has the guard verify and respond and the officer resolve, checks that a villager and a
  guard are refused the moves they may not make, signs out and checks the old token is refused. It then runs the
  same flow through `AppController`, the layer the Android app uses.
- **`FixtureFreshnessTest`** (core) re-runs `tools/gen_python_vectors.py` and fails if the output no longer
  matches the committed `core/src/test/resources/python-vectors.json`, so a change to the Python rules can't
  silently drift from the port. After an intended change on the Python side, regenerate the fixture:

  ```sh
  python3 tools/gen_python_vectors.py > core/src/test/resources/python-vectors.json
  ```

`PythonVectorsTest` itself needs no Python: it checks the Java port against the committed numbers (168 severity
cases, 71 compass bearings, 225 distance/bearing pairs, 600 destination points, 146 ring points, 66 UTM forward
and 42 inverse points, 14 IST times, 84 report numbers, 18 file headers, and the full meta tables: types,
statuses, transitions and roles, limits, media rules, villages, contacts).

## The Android app

### Building it

`:android` is part of the build when an SDK is found: `sdk.dir` in `hatialert-jvm/local.properties`, or the
`ANDROID_HOME` / `ANDROID_SDK_ROOT` environment variable. (Android Studio writes `local.properties` when you open
the folder.) To build the other modules on a machine that has an SDK, pass `-Phatialert.skipAndroid=true`.

```sh
./gradlew :android:assembleDebug
# APK: android/build/outputs/apk/debug/android-debug.apk
```

Every push that touches `hatialert-jvm/` also builds it on GitHub Actions (`.github/workflows/jvm.yml`); the
debug APK is attached to the run as the `hatialert-debug-apk` artifact.

### Installing it

1. Start the server where the phone can reach it:
   - **Emulator:** `python -m hatialert` on the development machine; the app's default server address
     `http://10.0.2.2:8000` is that machine as seen from the emulator.
   - **Phone on the same Wi-Fi:** `python -m hatialert --host 0.0.0.0`, then set the server address on the
     sign-in screen (or in Settings) to `http://<laptop address>:8000`. This needs a **debug** build (see below).
2. Install: `adb install -r android/build/outputs/apk/debug/android-debug.apk`, or copy the APK from the CI
   artifact to the phone and open it (allow "install unknown apps" for the file manager).
3. Sign in with a demo account; the sign-in screen lists them and fills them in on a tap.

`assembleRelease` produces an unsigned APK; sign it with your own key (`apksigner`) before giving it to anyone.

### Plain HTTP (cleartext)

Android blocks plain `http://` by default. The app allows it only through its network security config:

- **Release builds** (`src/main/res/xml/network_security_config.xml`): HTTPS everywhere, except `10.0.2.2`
  (emulator host), `localhost` and `127.0.0.1`.
- **Debug builds** (`src/debug/res/xml/network_security_config.xml`): plain HTTP to any address, because a
  laptop's Wi-Fi address can't be listed in advance (the config can't match IP ranges).

A real deployment should run the server behind HTTPS (see the Python README) and use a release build.

### What the app does

- **Sign in** with phone and PIN; the session token is sent as `Authorization: Bearer <token>`, like the web
  app, and kept in the app's private storage (backups are switched off).
- **Home:** an active warning for your village, open incidents within your alert radius with distance and
  compass direction (worked out on the phone with `core`, identical to the server's), and a native Canvas map on
  the UTM zone 46N km grid with villages (hollow when not verified), incidents by severity, the geodesic alert
  ring (73 points, as the web map) and a scale bar. Tap an incident on the map or in the list to open it.
- **Report:** type, number of elephants, people hurt (injury/death), either nearest village plus distance and
  direction or a GPS fix from the platform `LocationManager` (no Google Play services needed), herd heading,
  notes, and up to 6 photos from the phone's camera app (shrunk to 1600 px JPEG under 1.5 MB). The severity the
  server will assign is shown before sending; the form uses the server's own validation messages. Each draft
  carries a client id, so a resend after a dropped connection can't create a duplicate.
- **Cases:** villagers see their own reports, forest staff see every case. **Case detail** shows the facts,
  reporter (staff only), and the timeline; guards and officers get the status moves they are allowed
  (verify, team responded, false report; only officers resolve) and can add notes.
- **Alerts** with level, villages, time, and whether each is active or affects your village.
- **Settings:** theme (Green follows the phone's light/dark mode; White, Dark and Navy are fixed; colours from
  `hatialert-py/hatialert/web/app.css`), server address (changing it signs you out), emergency numbers (tap to
  dial; placeholder forest numbers are marked), sign out.

Not in the app yet (use the web app): registering, changing a PIN, voice notes, viewing photos, sending alerts,
officer statistics and admin, offline queueing of reports.

## Using the client from Kotlin

```kotlin
val api = HatiClient("http://127.0.0.1:8000")
api.login("9000000002", "2222")
val case = api.createIncident(NewIncident(type = "crop_raid", village = "Wozhuro", herdSize = 6, offsetKm = 1.0, offsetDir = "NE"))
api.updateStatus(case.id, "verified", "Tracks seen")
api.logout()
```

Calls block; run them off the main thread. Errors are `ApiException` (the server's message, meant for people,
and the form field it concerns) or `NetworkException` (no answer). On a desktop JVM, PATCH (status changes) needs
`--add-opens java.base/java.net=ALL-UNNAMED` because the JDK's `HttpURLConnection` refuses that method; the tests
pass it. Android's `HttpURLConnection` supports PATCH, and you can also give `HatiClient` your own `HttpTransport`.

## What is verified where

| Check | Here (authoring container) | CI |
|---|---|---|
| `core` compiles (`--release 17`, `-Werror`) and its tests pass | yes | yes |
| Java port matches Python numbers and tables | yes | yes |
| `client` compiles (warnings are errors) and its tests pass, including the live Python server | yes | yes |
| Android Kotlin sources type-check against the Android API 35 framework and Compose 1.7 / Material 3 1.3 | yes, in a throwaway harness (see below) | yes, with the real toolchain |
| `:android` builds with AGP (manifest, resources, dexing, lint) and produces an APK | **no** | yes |
| App runs on a device or emulator | no | no (install the APK and try it) |

The container this was written in could not reach Google's Maven repository (`dl.google.com`), so neither the
Android SDK nor AndroidX could be downloaded and the Android module was **not compiled with AGP there**. To catch
API mistakes anyway, its Kotlin sources were compiled against Robolectric's `android-all` jar for API 35 (the
real framework classes), JetBrains' Compose Multiplatform 1.7.3 desktop artifacts (the same Compose 1.7 and
Material 3 1.3 API as the pinned Compose BOM 2025.02.00), and hand-written stubs for the few AndroidX entry
points that exist only on Google's Maven (`ComponentActivity`, `setContent`, `viewModels`, `enableEdgeToEdge`,
`SystemBarStyle`, `rememberLauncherForActivityResult` and its two contracts, `BackHandler`, `FileProvider`,
`ContextCompat`, `AndroidViewModel`/`viewModelScope`, `LocalContext`, `Bitmap.asImageBitmap`). All Android
sources compiled there without warnings; the stubbed signatures, the XML resources and the AGP build script
are first checked by CI.

## Behaviour compared with the Python code

The port follows `domain.py` and `geo.py` line by line; the fixture shows UTM within 5e-10 m, distances within
4e-12 km and all 600 rounded destination points bit-for-bit equal. Where it differs or adds:

- **Compass:** the Python app uses **8** points (N, NE, ... NW), so `Geo.compass` does too.
- `Geo.compass(NaN)` throws `IllegalArgumentException`, as Python's `int(nan)` raises.
- `Geo.destinationBearing` (unrounded, any bearing) comes from `app.js`, which draws the alert ring with it;
  `domain.py` only has the rounded 8-direction version (`Geo.destination`, ported exactly, including
  Python's round-half-even).
- IST is computed with plain arithmetic (no `java.time`, which needs API 26 on Android); identical results for
  all tested times, including midnight, month, year and leap-day boundaries and before 1970.
- `Status.nextFor(role)` / `canMoveTo` combine `TRANSITIONS` and `TRANSITION_ROLES` the way `api.py` builds
  `next` and checks a PATCH.
- `CONTACTS` are ported; `SAFETY` and `COMPENSATION` are not (they come from `/api/meta` as JSON).
- The report form repeats the server's checks and messages so people see problems before sending; the
  server's answer still decides.
- On the map, a 5 km ring computed on the sphere (as the server and web app do) measures within about 0.5% of
  5 km on the ellipsoidal UTM grid.

## Versions

Kotlin 2.1.10, kotlinx-serialization 1.8.0, kotlinx-coroutines 1.10.1, JUnit 5.11.4, Android Gradle plugin 8.8.2,
Compose BOM 2025.02.00, activity-compose 1.10.0, lifecycle 2.8.7, core-ktx 1.15.0, Gradle 8.14.3. All are in
`gradle/libs.versions.toml`. The AndroidX and AGP versions could not be resolved in the authoring container; CI is
the first place they are downloaded.
