# HatiAlert (Python)

Elephant-incident reporting for the villages around Wokha, Nagaland.
Villagers report sightings, crop raids and injuries; forest guards verify and
respond; officers close cases, warn villages and track trends.

This is a Python rebuild of the React/Firebase app in the repository root. It
has **no dependencies**: the server, database and password hashing all come
from the Python standard library (3.10+).

## Run it

```sh
cd hatialert-py
python -m hatialert            # http://127.0.0.1:8000
python -m hatialert --port 9000 --db /path/to/hatialert.db
python -m hatialert --no-demo  # empty database, no demo accounts
```

On first start it creates `hatialert.db` with three demo accounts and a month
of **sample** incidents (an officer can remove them from the Home screen):

| Role | Phone | PIN |
|---|---|---|
| Villager (Wozhuro) | 9000000001 | 1111 |
| Forest guard (Baghty) | 9000000002 | 2222 |
| Forest officer (Wokha Town) | 9000000003 | 3333 |

## What it does

- **Report** in under a minute: what happened, how many elephants, nearest
  village plus distance and direction (or GPS), herd heading, damage.
  Severity is worked out on the server with the original app's rules.
- **Photos and voice notes.** "Snap a photo and report" opens the camera
  straight away; the report form takes up to 6 photos (shrunk to 1600 px
  JPEG on the phone) and 2 voice notes (up to 60 s). The reporter and forest
  staff can add more to a case later. Where the browser allows it the app
  uses a live camera and an in-app recorder; otherwise (plain-HTTP network
  addresses, embedded pages) the buttons open the phone's own camera or
  recorder. The server checks each file's real type from its first bytes,
  so a file can't pretend to be a photo.
- **Report numbers** like `HA-2610-0014` (IST year-month + id) for
  compensation claims.
- **Case workflow**: reported → verified → team responded → resolved, or
  false report. Guards can verify and respond; only officers can close.
  Every step is kept in a timeline with notes.
- **Alerts** to chosen villages. "Warn nearby villages" pre-fills every village
  within 5 km of a case. A warning stays active for 24 hours or until an
  all-clear for that village.
- **Home** shows open incidents within your alert radius with distance and
  compass direction, and a drawn map of the villages (no map tiles needed,
  so it works on weak connections).
- **District overview** (officers): incidents per day, hotspot villages,
  median response time, losses, CSV export.
- Safety guidance, emergency numbers and compensation steps.

## Layout

```
hatialert/
  domain.py     villages, incident types, severity rules, geography (haversine, bearing)
  security.py   PBKDF2-SHA256 PIN hashing, session tokens
  store.py      SQLite schema, queries, sample data
  api.py        JSON API, independent of HTTP (App.handle)
  server.py     http.server front end with security headers
  web/          index.html, app.css, app.js (no build step)
tests/          unittest suite: python -m unittest
tools/          hosted-preview build (Pyodide) and the JS-fallback parity check
```

## Tests

```sh
python -m unittest             # 29 tests: rules, geography, auth, workflow, media, alerts, stats, CSV
node tools/parity.cjs          # the preview's JS fallback answers 68 requests exactly like api.py
```

## Hosted preview

`tools/build_preview.py` builds a single page that runs this same `hatialert`
package in the browser with [Pyodide](https://pyodide.org) on an in-memory
SQLite database, saved to the viewer's browser (IndexedDB); the
standard-library zip is embedded in the page. If a browser won't run
WebAssembly, the page switches to `tools/preview/fallback.js`, a JavaScript
copy of the API that `tools/parity.cjs` keeps in step with `api.py`. The
More screen shows which engine is running.

## Before real use

- **Village coordinates** come from the original app and look approximate.
  Check them against Survey of India or Census village locations.
- **Forest-department phone numbers** are placeholders (marked in the app).
  112, 108 and 100 are the real national numbers.
- **Compensation amounts** come from the original app. Confirm current
  Nagaland ex-gratia rates.
- **Sign-in** is phone number + PIN with lockout after 5 wrong tries. There is
  no SMS verification, and staff roles are set in the database:
  `UPDATE users SET role = 'guard' WHERE phone = '…';`
- Run it behind HTTPS (for example a reverse proxy) when it's on a network.
  Browsers only allow the live camera and microphone on HTTPS or localhost;
  on plain HTTP the app falls back to the phone's camera and recorder apps.
- Photos and voice notes are stored inside the SQLite file. Back it up, and
  remember photos can show people's faces and homes.
