#!/bin/sh
# Copy a fresh HatiAlert backup off this server.
#
# What it does:
#   1. asks the running app for a fresh, consistent backup (SQLite online backup)
#   2. checks the copy is a sound SQLite database (PRAGMA integrity_check)
#   3. copies it into OFFSITE_STAGING on this server (keeps the newest OFFSITE_KEEP)
#   4. sends it to OFFSITE_TARGET with rsync or rclone (OFFSITE_METHOD)
#
# Settings come from deploy/.env (see .env.example) or the environment:
#   OFFSITE_METHOD   rsync | rclone | none            (default none)
#   OFFSITE_TARGET   rsync: user@host:/path/   rclone: remote:path
#   OFFSITE_STAGING  local folder for copies           (default ./offsite-staging)
#   OFFSITE_KEEP     copies to keep in OFFSITE_STAGING (default 30)
#   HATIALERT_HOST_DB / HATIALERT_HOST_BACKUP_DIR / HATIALERT_HOST_APP
#                    for a host (systemd) install without Docker, e.g.
#                    /var/lib/hatialert/hatialert.db, /var/lib/hatialert/backups
#                    and /opt/hatialert/hatialert-py (the default)
#
# Run it daily from cron, e.g. (crontab -e as root):
#   17 2 * * * cd /opt/hatialert/hatialert-py/deploy && ./backup-offsite.sh >> /var/log/hatialert-offsite.log 2>&1
#
# The backups hold names, phone numbers, photos and voice notes: send them only
# to storage you control, preferably encrypted (e.g. an rclone "crypt" remote).
set -eu
cd "$(dirname "$0")"

if [ -f .env ]; then
  # Take only the OFFSITE_* and HATIALERT_HOST_* lines; .env is never run as a
  # script. A value already set in the environment wins.
  while IFS='=' read -r key value; do
    case "$key" in
      OFFSITE_*|HATIALERT_HOST_*) printenv "$key" >/dev/null || export "$key=$value" ;;
    esac
  done < .env
fi
METHOD="${OFFSITE_METHOD:-none}"
TARGET="${OFFSITE_TARGET:-}"
STAGING="${OFFSITE_STAGING:-./offsite-staging}"
KEEP="${OFFSITE_KEEP:-30}"

mkdir -p "$STAGING"
chmod 700 "$STAGING"

if [ -n "${HATIALERT_HOST_DB:-}" ]; then
  # Host install: the hatialert user owns the files; run the backup as that user.
  dir="${HATIALERT_HOST_BACKUP_DIR:?set HATIALERT_HOST_BACKUP_DIR too}"
  runas() { if [ "$(id -u)" = 0 ]; then runuser -u hatialert -- "$@"; else "$@"; fi; }
  out=$(cd "${HATIALERT_HOST_APP:-/opt/hatialert/hatialert-py}" && runas python3 -m hatialert backup --db "$HATIALERT_HOST_DB" --backup-dir "$dir" --keep 14)
  file=${out#Backup written: }
  python3 -c "import sqlite3,sys; r=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro&immutable=1',uri=True).execute('PRAGMA integrity_check').fetchone()[0]; sys.exit(r!='ok')" "$file"
  name=$(basename "$file")
  cp "$file" "$STAGING/$name"
else
  out=$(docker compose exec -T hatialert hatialert-entrypoint backup)
  file=${out#Backup written: }
  docker compose exec -T hatialert python -c "import sqlite3,sys; r=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro&immutable=1',uri=True).execute('PRAGMA integrity_check').fetchone()[0]; print('integrity:', r); sys.exit(r!='ok')" "$file"
  name=$(basename "$file")
  docker compose cp "hatialert:$file" "$STAGING/$name"
fi
chmod 600 "$STAGING/$name"
echo "Local copy: $STAGING/$name"

# Keep the newest $KEEP copies in the staging folder.
ls -1 "$STAGING"/hatialert-*.db 2>/dev/null | sort | head -n "-$KEEP" | while read -r old; do rm -f -- "$old"; done

case "$METHOD" in
  rsync)
    [ -n "$TARGET" ] || { echo "Set OFFSITE_TARGET" >&2; exit 1; }
    rsync -a --chmod=F600 "$STAGING/$name" "$TARGET"
    ;;
  rclone)
    [ -n "$TARGET" ] || { echo "Set OFFSITE_TARGET" >&2; exit 1; }
    rclone copy "$STAGING/$name" "$TARGET"
    ;;
  none)
    echo "OFFSITE_METHOD=none: the copy is still on this server. Set rsync or rclone in .env." >&2
    exit 0
    ;;
  *)
    echo "Unknown OFFSITE_METHOD '$METHOD' (use rsync, rclone or none)" >&2
    exit 1
    ;;
esac
echo "Sent $name to $TARGET"
