#!/bin/sh
# Container entrypoint for HatiAlert.
#   serve (default)        run the server with the production flags below
#   backup                 write one backup now into $HATIALERT_BACKUP_DIR
#   create-officer ...     make an officer account (see deploy/README.md)
#   anything else          run as a command (e.g. sh)
#
# Settings (environment):
#   HATIALERT_DEMO=1          load demo accounts and sample incidents into an
#                             EMPTY database (trying it out only; never on a real server)
#   HATIALERT_DB              default /data/hatialert.db
#   HATIALERT_BACKUP_DIR      default /data/backups
#   HATIALERT_BACKUP_HOURS    default 24
#   HATIALERT_BACKUP_KEEP     default 14
#   HATIALERT_SMS_*           see hatialert/sms.py and deploy/README.md
set -eu

db="${HATIALERT_DB:-/data/hatialert.db}"
backups="${HATIALERT_BACKUP_DIR:-/data/backups}"
keep="${HATIALERT_BACKUP_KEEP:-14}"

# Docker Compose passes unset .env values as empty strings. An empty SMS body
# template would break every send, so fall back to the built-in default.
[ -n "${HATIALERT_SMS_BODY:-}" ] || unset HATIALERT_SMS_BODY

cmd="${1:-serve}"
case "$cmd" in
  serve|-*)
    [ "$cmd" = serve ] && [ $# -gt 0 ] && shift
    if [ "${HATIALERT_DEMO:-0}" = 1 ]; then
      echo "WARNING: HATIALERT_DEMO=1 - demo accounts with published PINs are loaded into an empty database." >&2
      demo=""
    else
      demo="--no-demo"
    fi
    # shellcheck disable=SC2086  # $demo is empty or one word
    exec python -m hatialert serve --host 0.0.0.0 --port 8000 --trust-proxy $demo \
      --db "$db" --backup-dir "$backups" \
      --backup-hours "${HATIALERT_BACKUP_HOURS:-24}" --keep "$keep" "$@"
    ;;
  backup)
    shift
    exec python -m hatialert backup --db "$db" --backup-dir "$backups" --keep "$keep" "$@"
    ;;
  create-officer)
    shift
    exec python -m hatialert create-officer --db "$db" "$@"
    ;;
  *)
    exec "$@"
    ;;
esac
