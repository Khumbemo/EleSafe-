# HatiAlert for the JVM and Android

The JVM side of HatiAlert, the elephant-incident reporting app for the villages around Wokha, Nagaland. It talks to
the Python server in [`../hatialert-py`](../hatialert-py), which stays the reference implementation.

| Module | Language | What it is |
|---|---|---|
| `core` | Java 17, no dependencies | Pure domain logic ported from `domain.py` and `geo.py`: incident types, severity rules, statuses and who may move them, media limits and type sniffing, haversine, bearing, compass points, destination point, IST report numbers `HA-yymm-NNNN`, seed villages (with verified/source flags), emergency contacts, UTM zone 46N forward and inverse. |
| `client` | Kotlin/JVM | Typed client for the whole JSON API (`HatiClient`), plus the app's state layer (`AppController`, `AdminController`, report and alert form rules, village form rules, map projection, themes). Uses `HttpURLConnection` and kotlinx.serialization, so it runs unchanged on Android. |
| `android` | Kotlin, Jetpack Compose, Material 3 | The phone app (minSdk 24, compileSdk 37, targetSdk 36). A thin layer over `client`: sign in, sign up and forgotten PIN with texted codes, home with nearby incidents and a native map, report with photos and voice notes, cases and case detail (photos, voice notes, warn nearby villages), alerts and sending them, settings (PIN, devices, text alerts), and the officer's district overview and admin. |

```
hatialert-jvm/
  settings.gradle.kts        includes :android only when an Android SDK is configured
  build.gradle.kts           Kotlin plugins, loaded once for all modules
  gradle/libs.versions.toml  every version pin
  gradlew, gradle/wrapper/   Gradle 9.6.0 wrapper (checksum-pinned)
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
                                               MapScene/Viewport, ThemeChoice/Palettes,
                                               Outbox (PendingReport, OutboxStore, FileOutboxStore),
                                               Alerts (AlertDraft), Admin (AdminController, AdminData,
                                               VillageForm), MediaCache
    src/test/kotlin/...                        unit tests + PythonServerIntegrationTest
  android/
    src/main/java/org/hatialert/mobile/        MainActivity, AppViewModel, PrefsSettingsStore, TokenCipher, Gps,
                                               Photos, Voice (VoiceRecorder, VoicePlayer)
    src/main/java/org/hatialert/mobile/ui/     one file per screen (AccountScreens, ComposeAlertScreen,
                                               AdminScreen, ...), Media (photos/voice), MapCanvas, Theme
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
  `python -m hatialert --db <temp file> --port <free port>`, from `../hatialert-py`, with
  `HATIALERT_SMS_DEBUG=1` so the server prints texts (one-time codes included) to its log, where the test reads
  them as the browser tests do. It signs in with the demo
  accounts (villager 9000000001/1111, guard 9000000002/2222, officer 9000000003/3333), lists cases, checks that
  distances and directions worked out on the phone match the server's, files a report with a photo, resends it
  (same case comes back), has the guard verify and respond and the officer resolve, checks that a villager and a
  guard are refused the moves they may not make, signs out and checks the old token is refused. It then runs the
  same flow through `AppController`, the layer the Android app uses. Last, it stops the server, files a report
  through `AppController` (saved to a `FileOutboxStore` on disk), starts the server again on the same database,
  lets the app send the saved report and checks that exactly one incident (with its photo) was made, also when
  the same saved report is sent a second time. Then: sign-up with the texted code (weak PINs and a wrong code
  refused with the server's messages), forgotten PIN with a second code (old sessions end), change PIN and
  "sign out other devices", the text-alert switch, an officer's PIN reset forcing the new-PIN screen (the
  server answers 403 "Choose a new PIN first." until then), unlock after wrong PINs, role change and
  switching an account off; a report with a photo and an M4A voice note, a second voice note added to the case,
  the third refused, all three downloaded byte for byte, another villager seeing only "3 hidden" and getting 403
  for the file; a guard's "warn nearby villages" (villages within 5 km from `/api/incidents/{id}/villages`, the
  web app's wording) sent as an alert with its SMS result; officer people search/role filter, villages add,
  edit (bounds and "say where the position comes from" refusals), hide, CSV import, the alert texts in the
  outbox, system status, statistics and CSV export, also through `AdminController`; and every staff/officer call
  refused (403, with the server's message) for a villager and the officer calls for a guard. Last, a second
  server **without** texts: asking for a code gives "Text messages aren't set up on this server. Ask a forest
  officer.", sign-up works without a code, an alert's texts are "to send by hand" and the officer marks them
  sent.
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

- **Sign in** with phone and PIN (demo accounts listed on the sign-in screen); the session token is sent as `Authorization: Bearer <token>`, like the web
  app. It is kept in the app's private storage (backups are switched off) **encrypted** with AES-256/GCM under a
  key held in the Android Keystore (`TokenCipher`, alias `hatialert_token`; no extra library). A plain token
  saved by an earlier version is encrypted on first launch. If the token can't be decrypted (the key is gone,
  e.g. app data restored onto another phone) the app treats you as signed out; if the Keystore can't encrypt at
  all, the token is kept in memory only and you sign in again next launch.
- **Create an account** (as the web app): name, mobile number, village, a PIN typed twice. When the server sends
  texts, **Send code** texts a 6-digit code that goes with the form; the server's answer ("If this number can get
  texts, a 6-digit code is on its way.") or refusal is shown under the button. Weak PINs are refused with the
  server's own messages ("That PIN is too easy to guess..."). Without texts on the server no code is asked for.
- **Forgot your PIN?** Phone, **Send code**, the texted code and a new PIN twice; signs in. When the server has
  no text-message service the screen says to ask a forest officer for a temporary PIN instead (and the server's
  "Text messages aren't set up on this server..." is shown if a code is asked for anyway).
- **New PIN after a temporary one:** when the user signs in with a PIN an officer reset (`must_change_pin`),
  or the server answers "Choose a new PIN first." to any call, the app shows only "Choose your own PIN"
  (temporary PIN, new PIN twice) and a sign-out link until it is changed.
- **Home:** an active warning for your village, open incidents within your alert radius with distance and
  compass direction (worked out on the phone with `core`, identical to the server's), and a native Canvas map on
  the UTM zone 46N km grid with villages (hollow when not verified), incidents by severity, the geodesic alert
  ring (73 points, as the web map) and a scale bar. Tap an incident on the map or in the list to open it.
- **Report:** type, number of elephants, people hurt (injury/death), either nearest village plus distance and
  direction or a GPS fix from the platform `LocationManager` (no Google Play services needed), herd heading,
  notes, up to 6 photos from the phone's camera app (shrunk to 1600 px JPEG under 1.5 MB) and up to 2 **voice
  notes** of up to 60 s each (recorded with `MediaRecorder` as AAC in MPEG-4/M4A, mono 22 kHz 32 kbit/s, about
  240 KB a minute; the server's `sniff_media` takes it as `audio/mp4`; the microphone permission is asked for the
  first time someone records). Each can be played back or removed before sending. The severity the
  server will assign is shown before sending; the form uses the server's own validation messages. Each draft
  carries a client id, so a resend after a dropped connection can't create a duplicate.
- **Send later (no signal):** as in the web app, a report that can't reach the server at all (no network,
  server down, timeout) is saved on the phone with its photos ("Your report is saved on this phone and will be
  sent when you're back online."), the form is cleared, and Home and Report show "N reports waiting to send"
  with a **Send now** button. Saved reports are sent oldest first on launch, on sign-in, on refreshing Home
  and whenever Android reports a network again (`ConnectivityManager.registerDefaultNetworkCallback`). Each
  keeps its `client_id`, so the server returns the first copy instead of making a second case if an earlier
  attempt did get through. Sending stops at the first report that can't get through (no connection, 5xx, 429,
  expired sign-in) and keeps the rest; a report the server refuses outright (another 4xx) is removed and the
  reason shown. A report the server refuses when first sent (a validation error) is not saved: the form stays
  as it was so you can fix it. Saved reports belong to the account that wrote them and wait across sign-outs.
  Storage: `filesDir/outbox/outbox.json` plus one file per photo or voice note, each written to a temporary file and renamed
  into place (`FileOutboxStore`, in `client`, so it is unit-tested on the JVM).
- **Cases:** villagers see their own reports, forest staff see every case. **Case detail** shows the facts,
  reporter (staff only), and the timeline; guards and officers get the status moves they are allowed
  (verify, team responded, false report; only officers resolve) and can add notes.
- **Photos and voice notes on a case:** the reporter and forest staff see photo thumbnails (fetched from
  `/api/attachments/{id}` with the session token, decoded small with `BitmapFactory` `inSampleSize` and kept in
  an in-memory `LruCache` of 1/16 of the app's memory; tap for full screen) and play voice notes (`MediaPlayer`);
  they can add a photo or record a voice note (same limits as a report). Everyone else sees only "N photos or
  voice notes, seen only by the reporter and forest staff", as the server sends no files to them. Downloaded
  files are kept in memory (12 MB, `MediaCache` in `client`) and both caches are emptied on sign-out.
- **Alerts** with level, villages, time, whether each is active or affects your village, and a link to its case.
- **Sending alerts** (guards and officers): **Send an alert** on the Alerts screen opens a form with the alert
  type, villages (chips, with All/None) and the message (400 characters, counted). On an open case,
  **Warn nearby villages** fills it in from `/api/incidents/{id}/villages?km=5`, with the web app's wording
  ("About 6 elephants reported near Wozhuro... Keep away from the fields and stay indoors after dark."). After
  sending, the app says what happened to the texts: "Alert sent. Texting 4 people", or "... 4 people to text by
  hand (Admin > Messages)" when the server has no SMS service.
- **Settings:** theme (Green follows the phone's light/dark mode; White, Dark and Navy are fixed; colours from
  `hatialert-py/hatialert/web/app.css`), **text me alerts** on/off, **change PIN** (current PIN, new PIN twice;
  other devices are signed out by the server), **sign out other devices** (after a confirmation), server address
  (changing it signs you out), emergency numbers (tap to dial; placeholder forest numbers are marked), sign out.
  Officers also get **District overview** and **Admin**.
- **District overview** (officers): incidents, median time to respond, people hurt, losses, incidents per day,
  hotspot villages, types and severities for 7, 30 or 90 days. **Export CSV** fetches `/api/export.csv` with the
  session token and opens the share sheet with the file (`cache/exports`, through the app's `FileProvider`), so
  it can go to e-mail, Drive or a spreadsheet app.
- **Admin** (officers), in sections as the web app:
  **People**: search by name or phone, filter by role, change role, switch an account off or on, **reset PIN**
  (after a confirmation; the temporary PIN is shown once, in large type, until "Done" or leaving the section),
  unlock after wrong PINs. **Villages**: list with a Checked / Not checked badge, how many people and incidents,
  hidden ones marked; add a village; edit latitude, longitude, source, "position checked" and "show in lists"
  (the form uses the server's bounds and messages); import a CSV list pasted or picked from a file (skipped lines
  are listed). **Messages**: the alert texts by alert with their counts, copy the message or the numbers, **mark
  all sent** for texts sent by hand, try failed ones again when an SMS service is set up. **System**: the SMS
  service, backups, storage and the recent admin actions.

The screens a role may not use are not offered (villagers get no alert form, guards no admin), and
`AppController.navigate` refuses them too; the server checks every call again.

**Phones and tablets.** The layout follows the Material window size classes and changes on rotation, split
screen and window resizing:

| Window | Navigation | Home | Cases |
|---|---|---|---|
| Phone, portrait (under 600 dp wide) | bottom bar | map above the list | list, then the case |
| Phone sideways (under 480 dp tall) | side rail | map beside the list | list, then the case |
| Tablet portrait (600-839 dp) | side rail | taller map above the list | list, then the case |
| Tablet landscape (840 dp +) | side rail | map beside the list | list and case side by side |

Forms and text are capped at 720 dp wide, content keeps clear of camera cut-outs, and the app does not require a
touchscreen, camera, GPS or phone line, so tablets and Chromebooks can install it.

Still only in the web app: the profile form (name, home village, alert radius), browser notifications, the
language switch (Nagamese), the safety guide and compensation pages, the in-browser demo engine, and removing the
sample data. The app records voice notes as M4A only; it plays whatever the server stores through Android's own
decoders (voice notes recorded in a browser are usually WebM or Ogg with Opus, which Android 7 and later can
play; not yet tried on a device).

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
| Android Kotlin sources compile | type-checked only, against stand-ins (see below) | yes, with the real toolchain |
| `:android` builds with AGP (manifest, resources, dexing, lint) and produces an APK | **no** | yes |
| App runs on a device or emulator | no | no (install the APK and try it) |

Android lint runs in CI and prints its findings into the build log ("Android lint findings" step); lint
**errors** fail the build.

**Android SDK levels.** The app is compiled against API 37 (needed by the current AndroidX/Compose releases) but
targets API 36 (Android 16), the newest stable release whose behaviour changes are documented. The app already
meets them: it draws edge-to-edge, handles back with Compose's `BackHandler` (works with predictive back; no
`onBackPressed` overrides), and does not lock orientation or resizability. Move `targetSdk` to 37 once Android 17
is final and the app has been tried on it; lint will flag it until then.

**AGP 9 notes.** AGP 9 compiles Kotlin itself ("built-in Kotlin"), so the module no longer applies
`org.jetbrains.kotlin.android`; the JVM target follows `compileOptions.targetCompatibility` (17). The Compose
compiler plugin (`org.jetbrains.kotlin.plugin.compose`) is still applied.

The container this was written in could not reach Google's Maven repository (`dl.google.com`), so neither the
Android SDK nor AndroidX could be downloaded and the Android module was **not compiled with AGP there**; CI is
the only full build. Its Kotlin sources were type-checked in a throwaway Gradle project instead, compiled
against Robolectric's `android-all` jar `17-robolectric-16653203` (the real Android API 37 framework classes,
`compileOnly`), the built `core`/`client` jars, kotlinx-serialization 1.13.0 and coroutines 1.11.0, with Kotlin
2.4.21 and its Compose compiler plugin. For Compose it used JetBrains' Compose Multiplatform **1.7.3** desktop
artifacts (Compose 1.7 / Material 3 1.3 API), not a current release: since 1.8 the desktop artifacts depend on
AndroidX artifacts (`androidx.compose.runtime`, `collection`, `annotation`, `lifecycle`) that are published only
on Google's Maven. So APIs newer than Compose 1.7 / Material 3 1.3 were not checked there (the app uses none on
purpose), and `LocalWindowInfo.containerSize`, experimental in 1.7, needed an opt-in there only. Hand-written
stubs stood in for the AndroidX entry points that exist only on Google's Maven: `ComponentActivity`,
`setContent`, `viewModels`, `enableEdgeToEdge`, `SystemBarStyle`, `BackHandler`,
`rememberLauncherForActivityResult` with `ActivityResultLauncher` and the `RequestMultiplePermissions`,
`RequestPermission`, `TakePicture` and `GetContent` contracts, `FileProvider`, `ContextCompat`,
`SharedPreferences.edit`, `Bitmap.scale`, `String.toUri`, `ExifInterface`, `ViewModel`/`AndroidViewModel`/
`viewModelScope`, `LocalContext` and `Bitmap.asImageBitmap`. No `android.*` class was stubbed. All Android
sources compiled there without errors or warnings; the stubbed signatures, the XML resources (manifest,
`FileProvider` paths), lint and the AGP build are first checked by CI.

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

Kotlin 2.4.21, kotlinx-serialization 1.13.0, kotlinx-coroutines 1.11.0, JUnit 5.11.4, Android Gradle plugin 9.5.1,
Compose BOM 2026.09.00, activity-compose 1.13.0, lifecycle 2.11.0, core-ktx 1.19.1, exifinterface 1.4.2,
Gradle 9.6.0. All are in
`gradle/libs.versions.toml`. The AndroidX and AGP versions could not be resolved in the authoring container; CI is
the first place they are downloaded.
