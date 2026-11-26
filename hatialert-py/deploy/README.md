# Putting HatiAlert on a server

This folder runs HatiAlert on a small rented server (VPS) or a government
server, with HTTPS, automatic backups and (optionally) text messages.

Two ways to run it:

- **With Docker (recommended):** the app and [Caddy](https://caddyserver.com)
  (the web server that handles HTTPS) each run in a container. Caddy gets and
  renews a free Let's Encrypt certificate by itself.
- **Without Docker:** the app as a systemd service plus Caddy installed on the
  machine. See [Without Docker](#without-docker) near the end.

| File | What it is |
|---|---|
| `Dockerfile` | the app image: Python 3.14 (slim, pinned), no extra packages, runs as user 10001 |
| `entrypoint.sh` | starts the app with the production settings |
| `compose.yaml` | the app + Caddy; only Caddy is reachable from outside (ports 80 and 443) |
| `Caddyfile` | HTTPS, compression, upload size limit, HSTS |
| `.env.example` | settings template: copy to `.env` (never committed) |
| `backup-offsite.sh` | copies a fresh backup off the server (rsync or rclone) |
| `restore.sh` | puts a backup back |
| `hatialert.service` | systemd unit for the install without Docker |

## What you need

- A Linux server (Ubuntu 22.04/24.04 or Debian 12/13) with 1 CPU, 1 GB RAM
  and 20 GB disk or more. Photos and voice notes are stored inside the
  database, and 14 daily backups are kept next to it, so give it room to grow.
- A domain or sub-domain you control, for example `hatialert.example.org`
  (a state IT department can give you a `*.nic.in` / `*.gov.in` sub-domain).
- Ports 80 and 443 open to the internet (Let's Encrypt checks port 80 when
  it issues the certificate).
- An SSH login with `sudo`.

## 1. Point the domain at the server

At your DNS provider, add an **A record** for the name (for example
`hatialert`) with the server's public IPv4 address. If the server has IPv6,
add an **AAAA record** too, or none at all (a wrong AAAA record breaks
certificates). Check it from your computer after a few minutes:

```sh
nslookup hatialert.example.org      # must print the server's address
```

## 2. Install Docker

Follow Docker's own guide for your system:
<https://docs.docker.com/engine/install/> (Ubuntu: "Install using the apt
repository"). Docker Engine 25 or newer with the Compose plugin is needed.
Check:

```sh
docker --version && docker compose version
```

Firewall (if `ufw` is on): `sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw allow 443/udp`.

## 3. Get the code and fill in the settings

```sh
sudo git clone https://github.com/<owner>/<repository>.git /opt/hatialert
cd /opt/hatialert/hatialert-py/deploy
sudo cp .env.example .env
sudo chmod 600 .env
sudo nano .env
```

In `.env`, set at least:

- `HATIALERT_DOMAIN`: your domain, without `https://`.
- `ACME_EMAIL`: a mailbox someone reads (certificate warnings).
- Keep `HATIALERT_DEMO=0`. (`1` loads demo accounts with published PINs: only
  for a trial on a throw-away server. They stay in the database afterwards;
  start the real server with a fresh data volume.)

`.env` holds the SMS key. It is ignored by git: never commit it, never send it
by chat or email.

## 4. Start it

```sh
sudo docker compose up -d --build
sudo docker compose ps          # hatialert should say "healthy"
```

Open `https://<your domain>` on a phone. The first start takes a minute while
Caddy gets the certificate (`sudo docker compose logs caddy` shows progress).
If it fails, the DNS record or the firewall is usually the reason.

## 5. Make the first forest officer

The server starts with no accounts. Create the first officer from the server:

```sh
sudo docker compose exec hatialert hatialert-entrypoint create-officer \
  --phone 98XXXXXXXX --name "Full Name" --village "Wokha Town"
```

It prints a **temporary PIN**. Sign in with the phone number and that PIN; the
app then makes you choose your own PIN before anything else. The village must
be one of the villages in the database (the error message lists them). If the
number already has an account (someone registered in the app), the command
makes that account an officer and leaves its PIN alone.

From then on, officers manage everyone else in the app (More > Admin > People:
roles, PIN resets, switching accounts off). Every use of the command is written
to the admin log.

## 6. Text messages (SMS)

Without SMS, alerts are listed under More > Admin > Messages for staff to text
by hand, and sign-up / forgotten-PIN codes are switched off. To send them
automatically, connect any SMS company that accepts an **HTTP POST with a
JSON body**.

### India: DLT registration comes first

Under TRAI's rules for commercial communications (the Telecom Commercial
Communications Customer Preference Regulations, 2018, "TCCCPR"), every
business or government sender of bulk SMS in India must register on a **DLT
(Distributed Ledger Technology) platform** run by the telecom operators
(Jio, Airtel, Vi, BSNL each run one; registering on one is enough):

1. **Register the sender organisation** (the "principal entity", e.g. the
   forest division) and get its **Entity ID**.
2. **Register a sender ID ("header")**, the short name that appears as the
   sender, for example a six-letter name. The provider tells you the rules.
3. **Register every message template**: the exact fixed wording, with the parts
   that change marked as variables (on most platforms `{#var#}`). Each gets a
   **Template ID**. Choose the category your provider recommends; one-time
   codes and public-safety alerts are normally *transactional* or *service*
   messages, not promotional.

Operators check every message against the registered templates and **drop
messages that don't match**. Registration usually takes a few working days.
Your SMS provider helps with it and needs the Entity ID, header and Template
IDs. Web links or call-back numbers inside messages may also have to be
registered (whitelisted); check with the provider.

### The messages HatiAlert sends (register these)

| When | Exact text (variables in `{…}`) |
|---|---|
| Sign-up and forgotten-PIN code | `HatiAlert code: {6-digit code}. It expires in 10 minutes. Do not share it.` |
| Alert, type "Elephant warning" | `HatiAlert Elephant warning ({villages}): {message}` |
| Alert, type "Information" | `HatiAlert Information ({villages}): {message}` |
| Alert, type "All clear" | `HatiAlert All clear ({villages}): {message}` |

`{villages}` is a comma-separated list of village names, for example
`Wozhuro, Baghty`. `{message}` is what the officer types (up to 400
characters). Things to check with your provider before going live:

- DLT variables usually have a maximum length. A long village list or a long
  officer message may exceed it and be dropped: ask the limit, register the
  alert templates with enough variables, and agree a short message style with
  officers (e.g. "Herd of 6 near Wozhuro school. Stay indoors.").
- Messages over 160 characters (70 if they contain non-Latin letters) go as
  several SMS parts and cost more.
- The wording above is in `hatialert/api.py` (`post_otp`, `post_alert`) and
  `hatialert/domain.py` (`ALERT_LEVELS`). If you change it, register the new
  wording first.

### Connecting the provider

HatiAlert sends one HTTPS POST per message to `HATIALERT_SMS_URL`, with
`Content-Type: application/json`, the body from `HATIALERT_SMS_BODY` (`{to}`
and `{message}` filled in, JSON-escaped), and, if set, the header
`Authorization: <HATIALERT_SMS_AUTH>`. Any 2xx answer counts as sent; anything
else is retried after 1, 5, 15 and 60 minutes, then shown as failed in
More > Admin > Messages.

Open your provider's API documentation (MSG91, Fast2SMS, Kaleyra, Gupshup,
Textlocal, NIC's SMS gateway and others all have one) and find the "send SMS"
call. Then check, one by one:

1. **Method and format.** It must accept POST with a JSON body. (A provider
   that only takes form fields or GET query parameters needs a small code
   change in `hatialert/sms.py`.)
2. **URL** → `HATIALERT_SMS_URL`.
3. **API key.** If it goes in the `Authorization` header, put the whole header
   value in `HATIALERT_SMS_AUTH` (with `Bearer ` or not, as documented). If it
   goes in another header, HatiAlert can't send that today; if the provider
   also accepts it as a JSON field or URL parameter, put it there.
4. **Field names.** Write the JSON body the documentation shows, with `{to}`
   where the number goes and `{message}` where the text goes. Fixed values
   (sender ID/header, DLT Entity ID, Template ID, route) are typed in
   directly. Example shape only, the field names are made up:
   `HATIALERT_SMS_BODY='{"sender": "ABCDEF", "dlt_template_id": "…", "to": "{to}", "text": "{message}"}'`
5. **Number format** → `HATIALERT_SMS_PREFIX`: `+91`, `91` or empty for a
   bare 10-digit number.
6. **Template IDs.** If the provider needs a Template ID in every request,
   note that `HATIALERT_SMS_BODY` is one fixed body for all messages, so it
   can carry only one Template ID. Either use a provider that matches the text
   to your registered templates by itself, or ask a developer to give the code
   message and alert texts their own body settings (`hatialert/sms.py`).
7. **Errors.** Some providers answer HTTP 200 even when they refuse a
   message (the refusal is in the reply). Check the provider's delivery
   report after your first tests.

Put the values in `.env`, then:

```sh
sudo docker compose up -d     # re-reads .env
sudo docker compose logs hatialert | grep "Text messages"   # "auto (<provider host>)"
```

Test: as an officer, send an "Information" alert to your own village (with
your own phone's text alerts on), and try "Forgot PIN" on a test account.
`HATIALERT_SMS_DEBUG=1` (with the URL empty) prints messages in the log
instead of sending, for a dry run.

If the server can only reach the internet through a proxy, add
`HTTPS_PROXY: http://proxy.example:3128` under `hatialert: environment:` in
`compose.yaml`; Python uses it for the SMS calls.

## Everyday tasks

All commands are run in `/opt/hatialert/hatialert-py/deploy` with `sudo`.

**Is it up?** `docker compose ps` shows `healthy` when the app answers. From
outside, `https://<domain>/api/meta` must return JSON. Point a free uptime
monitor at that address to get an email when it goes down. The containers
restart by themselves after a crash or a reboot.

**Logs:** `docker compose logs -f hatialert` (app), `docker compose logs -f caddy`
(every request with the visitor's address; the app's own log shows Caddy's
address instead). Logs are rotated at 5 x 10 MB per container.

**Update to a new version:**

```sh
sudo ./backup-offsite.sh                    # a fresh copy first
sudo git pull
sudo docker compose up -d --build
sudo docker compose ps                      # healthy again?
```

Database changes are applied automatically at start. Python and Caddy are
pinned to exact versions in `Dockerfile` and `compose.yaml`; to take their
security updates, change both the version and the `@sha256:` digest to the
current ones from Docker Hub (`python:3.14.x-slim-trixie`, `caddy:2.x.y-alpine`)
and run the update steps. Also keep the server itself updated
(`sudo apt update && sudo apt upgrade`, or unattended-upgrades).

**Stop / start:** `docker compose stop` / `docker compose start`.
`docker compose down` removes the containers but keeps the data;
**never add `-v`** to it unless you mean to delete the database and
certificates.

## Backups

The app writes a backup at every start and then every
`HATIALERT_BACKUP_HOURS` (default 24) into the data volume, keeping the newest
`HATIALERT_BACKUP_KEEP` (default 14). They are on the same disk, so they don't
help if the server is lost. Copy them off the server:

1. Choose a place: another server you can reach over SSH (rsync), or cloud
   storage through [rclone](https://rclone.org) (Google Drive, S3, and many
   more). The backups contain names, phone numbers, photos and voice notes, so
   choose storage you control and preferably encrypt it (rclone "crypt" remote).
2. In `.env` set `OFFSITE_METHOD=rsync` and
   `OFFSITE_TARGET=user@backup-host:/path/` (set up an SSH key for root first),
   or `OFFSITE_METHOD=rclone` and `OFFSITE_TARGET=remote:folder` (after
   `sudo rclone config`).
3. Run `sudo ./backup-offsite.sh` once by hand. It makes a fresh backup, checks
   it (`integrity: ok`), keeps a copy in `offsite-staging/` and sends it.
4. Run it every night: `sudo crontab -e` and add
   `17 2 * * * cd /opt/hatialert/hatialert-py/deploy && ./backup-offsite.sh >> /var/log/hatialert-offsite.log 2>&1`

Officers can see the last automatic backup under More > Admin > Storage.

### Restoring

```sh
sudo docker compose cp hatialert:/data/backups ./restore-from   # or fetch a file from your off-site copy
ls restore-from/
sudo ./restore.sh restore-from/hatialert-20261120-020000.db
```

`restore.sh` checks the file, stops the app, saves the current database as
`/data/backups/pre-restore-<time>.db`, puts the backup in place (removing
the old `-wal`/`-shm` files) and starts the app. Anything entered after that
backup is gone, so tell staff to re-enter recent reports. **Practise this once**
before you rely on it, for example on a test server.

## Trying it on your own computer

Set `HATIALERT_DOMAIN=localhost` in `.env` (and `HATIALERT_DEMO=1` if you want the
demo accounts), then `docker compose up -d --build` and open
<https://localhost>. Caddy uses its own local certificate authority for
`localhost`; the browser warns until you trust it
(`docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt .` and
import that file). When done: `docker compose down -v` (deletes the test data).

## Without Docker

For a server where Docker isn't allowed. Needs Python 3.10 or newer
(`python3 --version`; Ubuntu 22.04+ and Debian 12+ have it) and Caddy.

```sh
# 1. a user without login rights, and the code (owned by root, read-only to the app)
sudo useradd --system --home-dir /var/lib/hatialert --shell /usr/sbin/nologin hatialert
sudo git clone https://github.com/<owner>/<repository>.git /opt/hatialert

# 2. settings with secrets (only SMS ones are needed here)
sudo install -d -m 0750 /etc/hatialert
sudo install -m 0600 /dev/null /etc/hatialert/hatialert.env
sudo nano /etc/hatialert/hatialert.env    # HATIALERT_SMS_* lines, as in .env.example
#    (leave out HATIALERT_SMS_BODY rather than setting it empty)

# 3. the service: listens on 127.0.0.1:8000, data in /var/lib/hatialert
sudo cp /opt/hatialert/hatialert-py/deploy/hatialert.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hatialert
systemctl status hatialert                # active (running)
journalctl -u hatialert -f                # logs

# 4. Caddy from its official package: https://caddyserver.com/docs/install
sudo cp /opt/hatialert/hatialert-py/deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl edit caddy                 # add the three lines below, save
#   [Service]
#   Environment=HATIALERT_DOMAIN=hatialert.example.org ACME_EMAIL=it-admin@example.org
#   Environment=HATIALERT_UPSTREAM=127.0.0.1:8000
sudo systemctl restart caddy

# 5. first officer (run as the service user so file ownership stays right)
cd /opt/hatialert/hatialert-py
sudo -u hatialert python3 -m hatialert create-officer --db /var/lib/hatialert/hatialert.db \
  --phone 98XXXXXXXX --name "Full Name" --village "Wokha Town"
```

The unit runs the app as `hatialert` with systemd's sandboxing (read-only
system, no home directories, private /tmp, no privilege changes, only network
and its own `/var/lib/hatialert`); `systemd-analyze security hatialert` rates it.
Update with `sudo git -C /opt/hatialert pull && sudo systemctl restart hatialert`.

Off-site backups: in `deploy/.env` set `HATIALERT_HOST_DB=/var/lib/hatialert/hatialert.db`
and `HATIALERT_HOST_BACKUP_DIR=/var/lib/hatialert/backups` plus the `OFFSITE_*`
lines, then use `backup-offsite.sh` as above. To restore: `sudo systemctl stop
hatialert`, copy the backup to `/var/lib/hatialert/hatialert.db`, delete
`hatialert.db-wal` and `hatialert.db-shm` next to it, `sudo chown hatialert:
/var/lib/hatialert/hatialert.db`, `sudo systemctl start hatialert`.

## Government server notes

- **No public internet access to the server** (intranet only): Let's Encrypt
  can't check it. Get a certificate from the department's IT team and put the
  `tls /etc/caddy/certs/fullchain.pem /etc/caddy/certs/privkey.pem` line in the
  `Caddyfile` (it is there, commented out); with Docker, also mount the
  certificate folder into the caddy container in `compose.yaml`. Phones must
  be able to reach the server, or the app is only useful inside the office.
- **Behind the department's load balancer or proxy:** list its addresses
  under `trusted_proxies` in the `Caddyfile` (commented example there), or
  every phone looks like the same address and the sign-in limits (5 wrong
  PINs per 15 minutes per network) lock everyone out together.
- **Outgoing traffic restricted:** the app needs to reach only the SMS
  provider's host; Caddy needs Let's Encrypt (`acme-v02.api.letsencrypt.org`)
  unless you use your own certificate.

## Checklist before real use

Mirrors "Before real use" in `../README.md`.

- [ ] HTTPS works at the real domain; `docker compose ps` says healthy.
- [ ] Started without demo data (`HATIALERT_DEMO=0`, fresh data volume). The
      demo numbers 9000000001-3 must not exist in More > Admin > People.
- [ ] First officer created with `create-officer`, signed in, own PIN chosen.
- [ ] **Village coordinates** checked: only Wokha Town is verified. Correct the
      others in Admin > Villages or import an official list (CSV
      `name,lat,lng,source`).
- [ ] **Forest-department phone numbers** in the app replaced (they are
      placeholders; 112, 108 and 100 are the real national numbers).
- [ ] **Compensation amounts** checked against current Nagaland ex-gratia rates.
- [ ] **SMS**: DLT entity, header and templates approved; provider connected;
      test alert and test code received on a real phone. (Or: staff know to
      send alerts by hand from Admin > Messages.)
- [ ] **Backups** leave the server every night (`backup-offsite.sh` in cron),
      and a restore has been practised.
- [ ] Someone receives the Let's Encrypt and uptime-monitor emails, and
      someone is responsible for updates.
