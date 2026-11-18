# HatiAlert

Elephant-incident reporting for the villages around Wokha, Nagaland. Villagers
report sightings, crop raids and injuries; forest guards verify and respond;
officers close cases, warn villages and follow trends.

**Try it in the browser:** the demo runs entirely on your device (no server):
open `hatialert-py/preview/` from GitHub Pages, or open
[index.html](index.html) on any static host. Demo sign-ins are listed in
[hatialert-py/README.md](hatialert-py/README.md).

## What is here

| Folder | Language | What it is |
|---|---|---|
| [`hatialert-py/`](hatialert-py/) | Python (standard library only) | The server and its database: sign-in, reports, cases, alerts, text messages, admin. Serves the web app. |
| [`hatialert-py/web-ts/`](hatialert-py/web-ts/) | TypeScript | The web app for phones, tablets and laptops (installable, works offline), built into `hatialert-py/hatialert/web/`. |
| [`hatialert-jvm/core/`](hatialert-jvm/) | Java | The shared rules: severity, distances and directions, the UTM map grid, report numbers. |
| [`hatialert-jvm/client/`](hatialert-jvm/) | Kotlin | A typed client for the server's API and the app logic, including saving reports offline. |
| [`hatialert-jvm/android/`](hatialert-jvm/) | Kotlin, Jetpack Compose | The Android app for phones and tablets. |

## Run it

```sh
cd hatialert-py
python -m hatialert            # then open http://127.0.0.1:8000
```

The Android app is built by GitHub Actions; download the debug APK from the
latest **HatiAlert JVM and Android** run. See each folder's README for building,
testing and what is verified where.

## Before real use

Village positions (9 of 10 not yet verified), the forest helpline numbers
(placeholders), a native-speaker review of the Nagamese text, an SMS provider
and HTTPS hosting are still needed; see "Before real use" in
[hatialert-py/README.md](hatialert-py/README.md).

The first version of HatiAlert (React and Firebase) was removed from this
repository in favour of the apps above; it remains in the git history.
