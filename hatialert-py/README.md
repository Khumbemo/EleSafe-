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
python -m hatialert --backup-dir /srv/hatialert-backups --backup-hours 24 --keep 14
python -m hatialert backup --db hatialert.db --backup-dir /srv/hatialert-backups   # one-off, e.g. from cron
```

Behind a reverse proxy (needed for HTTPS), add `--trust-proxy` so rate limits
see each phone's own address.

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
  compass direction on a topographic map of Wokha district that works
  offline (no tile server): shaded relief and 100 m contours from SRTM
  elevation, streams derived from that elevation, Census 2011 district
  boundaries, Mount Tiyi's spot height, a UTM zone 46N km grid, a scale bar
  and a true geodesic alert ring. Zoom with the buttons, mouse wheel (click
  the map first), two-finger pinch or the + / − / arrow keys.
- **Nagamese** (sign-in screen or More > Language): the whole interface,
  including server messages. The translation in
  `web-ts/src/i18n/nagamese.ts` is a draft that still needs a native
  speaker's review; edit that file and rebuild (see "Browser client" below)
  to correct it. Text people type is never translated.
- **District overview** (officers): incidents per day, hotspot villages,
  median response time, losses, CSV export.
- **Themes** (More > Theme): Green follows the phone's light or dark mode;
  White, Dark and Navy blue are fixed. The choice is kept on the device.
  Every text colour pair meets WCAG AA contrast (4.5:1).
- **Alerts by text message.** Each alert queues one SMS for every person in
  those villages who has text alerts on. Connect any SMS provider that takes
  an HTTP POST (settings below); until then officers see the messages under
  More › Admin › Messages with copy buttons, send them from a phone and mark
  them sent. Phones can also show alerts while the app is open or in the
  background.
- **Works offline.** The app opens without signal (service worker), shows
  the last saved information, and reports made offline wait on the phone and
  send themselves when the connection returns (each carries an id, so a
  resend never creates a duplicate).
- **Accounts.** Weak PINs (1111, 1234…) are refused. Sign-ins end after 30
  days unused or 180 days in total; "Sign out other devices" in More. Wrong
  PINs are limited per number and per network, kept in the database: 5 per
  15 minutes from one network, 20 per day per number (an officer can
  unlock), 30 per 15 minutes per network. Forgotten PIN: with SMS set up,
  a texted code; without it, an officer resets it to a temporary PIN that
  must be changed at the next sign-in. With SMS set up, sign-up also needs
  a texted code; without it, new accounts show "Phone not verified".
- **Admin for officers** (More › Admin): find people, change roles, switch
  accounts off, reset PINs, unlock; correct village positions, mark them
  checked with their source, add villages or import an official list as CSV
  (`name,lat,lng,source`); the SMS outbox; storage, backups and a log of
  admin actions.
- **Privacy and limits.** Photos and voice notes are visible only to the
  reporter and forest staff. Villagers can send 20 reports an hour, staff
  100; 60 MB of photos and recordings per person per day; 30 alerts an hour.
- Safety guidance, emergency numbers and compensation steps.

## Layout

```
hatialert/
  domain.py     villages, incident types, severity rules, geography (haversine, bearing)
  security.py   PBKDF2-SHA256 PIN hashing, session tokens
  store.py      SQLite schema, queries, sample data
  api.py        JSON API, independent of HTTP (App.handle)
  sms.py        SMS sending (any HTTP provider) with retries
  geo.py        WGS 84 <-> UTM zone 46N
  server.py     http.server front end with security headers
  web/          index.html, app.css; app.js, nagamese.js, sw.js are built from web-ts/ (committed)
web-ts/         TypeScript source of the browser client (see "Browser client")
tests/          unittest suite: python -m unittest
tools/          map build (map-source/ = downloaded inputs), preview build, parity and i18n checks
preview/        built preview: the app running in the browser with Pyodide (see preview/README.md)
```

## Tests

```sh
python -m unittest             # 64 tests: rules, geography, UTM vs PROJ, map data, auth and lockout, sessions,
                               # PINs and codes, admin, villages, privacy, limits, SMS, backups, migrations, CSV
node tools/parity.cjs          # the preview's JS fallback answers 97 requests exactly like api.py
node tools/check_i18n.cjs      # Nagamese patterns are valid; the browser's UTM maths (web-ts/src/geo.ts) matches PROJ
cd web-ts && npm run check     # TypeScript type check of the browser client
```

## Browser client

The browser client is written in TypeScript in `web-ts/src/` and bundled
by esbuild into plain scripts in `hatialert/web/`: `app.js`, `nagamese.js`
(the phrase book; the page loads it before `app.js`, which reads
`window.HATI_NAGAMESE`) and `sw.js` (the service worker). The built files
are committed, so running the server never needs Node; edit the TypeScript,
not the built files, which say so at the top.

```sh
cd web-ts
npm ci              # once: TypeScript and esbuild, versions pinned in package.json
npm run check       # tsc --noEmit, strict (page code and service worker)
npm run build       # writes ../hatialert/web/app.js, nagamese.js, sw.js
npm run watch       # rebuild on save
```

Output is ES2019 classic scripts (no modules, no eval, no inline styles),
so older Android Chrome runs it and it fits the server's
Content-Security-Policy. Commit the rebuilt files with the source change,
and bump `VERSION` in `src/sw.ts` when the app files change so phones
fetch the new copy.

- `main.ts` starts everything and boots; `router.ts` maps `#/page/arg` to
  `views/*.ts` (one file per screen).
- `dom.ts` is the element builder used instead of HTML strings:
  `h("button", { class: "btn", "data-ask": true }, "Text")` for HTML,
  `s(...)` for SVG. Text goes in as text nodes, so nothing needs escaping;
  neighbouring strings join into one text node so the Nagamese translator
  sees whole phrases.
- `types.ts` describes the API's JSON (from `hatialert/api.py`), `api.ts`
  calls it and keeps offline copies, `offline.ts` holds the send-later
  queue and registers the service worker, `map.ts` and `geo.ts` draw the
  map, `media.ts` handles photos and voice notes, `i18n/` the Nagamese
  phrase book and translator, `theme.ts` the colour themes.

## Hosted preview

A built copy is in `preview/`; host that folder on any static web server (for
example GitHub Pages) to try the app without installing anything.
`tools/build_preview.py` builds a single page that runs this same `hatialert`
package in the browser with [Pyodide](https://pyodide.org) on an in-memory
SQLite database, saved to the viewer's browser (IndexedDB); the
standard-library zip is embedded in the page. If a browser won't run
WebAssembly, the page switches to `tools/preview/fallback.js`, a JavaScript
copy of the API that `tools/parity.cjs` keeps in step with `api.py`. The
More screen shows which engine is running.

## Text messages (SMS)

Set these before starting the server (any provider with an HTTP API):

| Variable | Meaning |
|---|---|
| `HATIALERT_SMS_URL` | provider endpoint that receives a POST |
| `HATIALERT_SMS_AUTH` | value for the `Authorization` header, if needed |
| `HATIALERT_SMS_BODY` | JSON template with `{to}` and `{message}`, default `{"to": "{to}", "message": "{message}"}` |
| `HATIALERT_SMS_PREFIX` | put before the 10-digit number, default `+91` |
| `HATIALERT_SMS_DEBUG=1` | print messages to the console instead (testing) |

Failed sends are retried after 1, 5, 15 and 60 minutes, then marked failed
for an officer to retry. Indian bulk SMS needs a DLT-registered sender and
templates; set those up with your provider.

## Map data

`tools/build_map.py` rebuilds `hatialert/web/map/` (needs numpy, pillow,
pyshp and contourpy for the build only):

- Elevation: NASA SRTM via AWS Terrain Tiles (zoom 12, about 34 m), resampled
  to a 40 m UTM grid. Hillshade uses Horn's method (sun 315°, 45° up).
- Streams: priority-flood depression filling, D8 flow directions and flow
  accumulation; drawn where the catchment exceeds 5 km², width by Strahler
  order. They are modelled from the terrain, not surveyed.
- Boundaries: Census of India 2011 districts (DataMeet, CC BY 2.5 India);
  boundaries are approximate at village scale.
- Projection: WGS 84 / UTM zone 46N (EPSG:32646), `hatialert/geo.py`,
  checked against PROJ to under a millimetre.

## Before real use

- **Village coordinates:** only Wokha Town is checked (GeoNames). The other
  nine come from the original app; they fall inside the district but are
  not verified, and the map draws them as dashed "not verified" points.
  Correct them in Admin › Villages, or import an official list (Survey of
  India, Census, OpenStreetMap) as CSV there; the district has many more
  villages than these ten.
- **Forest-department phone numbers** are placeholders (marked in the app).
  112, 108 and 100 are the real national numbers.
- **Compensation amounts** come from the original app. Confirm current
  Nagaland ex-gratia rates.
- **Connect an SMS provider** (see above) so alerts reach people whose app is
  closed and sign-ups prove they own the number. Until then alerts must be
  texted by hand from Admin › Messages.
- **Make the first real officer:** register normally, then run
  `sqlite3 hatialert.db "UPDATE users SET role='officer' WHERE phone='…'"`
  once; after that, officers manage roles in Admin › People. Start with
  `--no-demo` (or remove the demo accounts) on a real server.
- Run it behind HTTPS (for example a reverse proxy) when it's on a network.
  Browsers only allow the live camera and microphone on HTTPS or localhost;
  on plain HTTP the app falls back to the phone's camera and recorder apps.
- Photos and voice notes are stored inside the SQLite file, so turn on
  `--backup-dir` and copy the backups off the machine now and then.
