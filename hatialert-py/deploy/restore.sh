#!/bin/sh
# Put a HatiAlert backup back in place (Docker Compose install).
#
#   ./restore.sh path/to/hatialert-YYYYmmdd-HHMMSS.db
#
# Steps: checks the file is a sound SQLite database, saves a copy of the
# current database next to the backups (pre-restore-*.db), stops the app,
# copies the backup in as /data/hatialert.db (removing the old -wal/-shm
# files, which belong to the old database), and starts the app again.
# Everything entered since that backup was made is lost; the pre-restore copy
# keeps it in case you need to go back.
set -eu
cd "$(dirname "$0")"

src="${1:?usage: ./restore.sh BACKUP_FILE}"
[ -f "$src" ] || { echo "No such file: $src" >&2; exit 1; }
src=$(cd "$(dirname "$src")" && pwd)/$(basename "$src")

# The file is streamed in on stdin, so it may be owned by root with mode 600.
check='import sqlite3,sys
c = sqlite3.connect("file:" + sys.argv[1] + "?mode=ro&immutable=1", uri=True)
r = c.execute("PRAGMA integrity_check").fetchone()[0]
n = c.execute("SELECT COUNT(*) FROM users").fetchone()[0]
print("integrity:", r, "- accounts:", n)
sys.exit(r != "ok")'

echo "Checking $src ..."
docker compose run --rm --no-deps -T --entrypoint sh hatialert -c \
  "cat > /tmp/restore.db && python -c '$check' /tmp/restore.db" < "$src"

stamp=$(date -u +%Y%m%d-%H%M%S)
echo "Stopping the app ..."
docker compose stop hatialert
# Whatever happens next, start the app again (with the old database if a step failed).
trap 'echo "Starting the app ..."; docker compose start hatialert' EXIT

echo "Saving the current database as /data/backups/pre-restore-$stamp.db and copying the backup in ..."
docker compose run --rm --no-deps -T --entrypoint sh hatialert -c "
  set -e
  cat > /data/hatialert.db.restoring
  python -c '$check' /data/hatialert.db.restoring
  if [ -f /data/hatialert.db ]; then
    python -c \"import sqlite3; s=sqlite3.connect('/data/hatialert.db'); d=sqlite3.connect('/data/backups/pre-restore-$stamp.db'); s.backup(d); d.close(); s.close()\"
  fi
  rm -f /data/hatialert.db-wal /data/hatialert.db-shm
  mv /data/hatialert.db.restoring /data/hatialert.db" < "$src"

echo "Restored. Sign in after it starts and check the latest cases are the ones you expect."
