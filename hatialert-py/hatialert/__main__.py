"""Run HatiAlert.

    python -m hatialert [--db FILE] [--host H] [--port N] [--no-demo]
                        [--backup-dir DIR] [--backup-hours 24] [--keep 14]
                        [--trust-proxy]
    python -m hatialert backup --db FILE --backup-dir DIR [--keep 14]
    python -m hatialert create-officer --db FILE --phone N --name NAME --village V

SMS settings come from environment variables; see hatialert/sms.py.
"""

import argparse
import os
import secrets
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from .api import App
from .server import serve
from .sms import SmsConfig, start_worker
from .store import Store, now_ms

_last_backup = {"path": None, "at": None, "error": None}


def run_backup(store: Store, directory: str, keep: int = 14, stamp: str | None = None) -> Path:
    """Copy the live database to DIR/hatialert-YYYYmmdd-HHMMSS.db; keep the newest `keep`."""
    d = Path(directory)
    d.mkdir(parents=True, exist_ok=True)
    stamp = stamp or datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    path = d / f"hatialert-{stamp}.db"
    tmp = path.with_suffix(".tmp")
    store.backup(str(tmp))
    os.replace(tmp, path)
    for old in sorted(d.glob("hatialert-*.db"))[:-keep] if keep > 0 else []:
        old.unlink()
    _last_backup.update(path=str(path), at=int(time.time() * 1000), error=None)
    return path


def temp_pin() -> str:
    """Six random digits with at least three different ones (passes the weak-PIN rule)."""
    while True:
        pin = f"{secrets.randbelow(10**6):06d}"
        if len(set(pin)) > 2 and pin not in "0123456789" and pin not in "9876543210":
            return pin


def create_officer(store: Store, phone: str, name: str, village: str) -> tuple[dict, str | None]:
    """Make the first (or another) forest officer from the command line.

    A new number gets an account with a temporary PIN that must be changed at
    the first sign-in; the PIN is returned. An existing account is promoted to
    officer, keeps its own PIN (None is returned) and is signed out everywhere.
    Raises ValueError with a readable message on bad input."""
    from .api import ApiError, normalize_phone
    from . import domain

    try:
        phone = normalize_phone(phone)
    except ApiError as e:
        raise ValueError(e.args[0] if e.args else "Enter a 10-digit mobile number.") from None
    existing = store.user_by_phone(phone)
    if existing:
        store.update_user(existing["id"], {"role": "officer", "active": 1})
        store.drop_sessions(existing["id"])
        store.audit(None, "cli_create_officer", f"{existing['name']} ({phone}) promoted to officer", now_ms())
        return store.user(existing["id"]), None
    name = (name or "").strip()
    if not 2 <= len(name) <= domain.LIMITS["name"]:
        raise ValueError(f"Give a name of 2 to {domain.LIMITS['name']} characters.")
    v = store.village(village)
    if not v or not v["active"]:
        names = ", ".join(x["name"] for x in store.villages())
        raise ValueError(f"Unknown village {village!r}. Choose one of: {names}")
    pin = temp_pin()
    user = store.create_user(name, phone, v["name"], pin, role="officer", at=now_ms(), phone_verified=1)
    store.set_pin(user["id"], pin, must_change=True)
    store.audit(None, "cli_create_officer", f"{name} ({phone}) created as officer", now_ms())
    return store.user(user["id"]), pin


def _backup_loop(store, directory, hours, keep):
    while True:
        try:
            p = run_backup(store, directory, keep)
            print(f"Backup written: {p}")
        except Exception as e:  # report and keep trying
            _last_backup["error"] = str(e)
            print(f"Backup failed: {e}")
        time.sleep(hours * 3600)


def main(argv=None):
    p = argparse.ArgumentParser(prog="hatialert", description="HatiAlert elephant-incident reporting server")
    p.add_argument("command", nargs="?", default="serve", choices=["serve", "backup", "create-officer"])
    p.add_argument("--db", default="hatialert.db", help="SQLite file (default: hatialert.db)")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--no-demo", action="store_true", help="skip demo accounts and sample incidents")
    p.add_argument("--backup-dir", default="", help="folder for automatic backups (off when empty)")
    p.add_argument("--backup-hours", type=float, default=24, help="hours between backups (default 24)")
    p.add_argument("--keep", type=int, default=14, help="backups to keep (default 14)")
    p.add_argument("--trust-proxy", action="store_true", help="use X-Forwarded-For from a reverse proxy for rate limits")
    p.add_argument("--phone", help="create-officer: 10-digit mobile number")
    p.add_argument("--name", help="create-officer: full name (new accounts)")
    p.add_argument("--village", help="create-officer: home village (new accounts), e.g. 'Wokha Town'")
    args = p.parse_args(argv)

    store = Store(args.db)
    if args.command == "backup":
        if not args.backup_dir:
            p.error("backup needs --backup-dir")
        print(f"Backup written: {run_backup(store, args.backup_dir, args.keep)}")
        return
    if args.command == "create-officer":
        if not args.phone:
            p.error("create-officer needs --phone (and --name and --village for a new account)")
        try:
            user, pin = create_officer(store, args.phone, args.name or "", args.village or "")
        except ValueError as e:
            p.exit(2, f"hatialert create-officer: {e}\n")
        if pin:
            print(f"Officer created: {user['name']} ({user['phone']}, {user['village']})")
            print(f"Temporary PIN: {pin}  (sign in with it; the app then asks for a new PIN)")
        else:
            print(f"{user['name']} ({user['phone']}) is now a forest officer; their PIN is unchanged.")
        return

    if store.is_empty() and not args.no_demo:
        store.seed()
        print("Loaded demo accounts and sample incidents (officers can remove the samples).")
    sms = SmsConfig()
    wake = start_worker(store, sms)
    if wake:
        print(f"Text messages: {sms.mode} ({sms.host or 'console'})")
    else:
        print("Text messages: not set up; alerts are listed for staff to send by hand (see hatialert/sms.py)")
    if args.backup_dir:
        threading.Thread(target=_backup_loop, args=(store, args.backup_dir, args.backup_hours, args.keep), daemon=True).start()
        print(f"Backups: every {args.backup_hours:g} h to {args.backup_dir}, keeping {args.keep}")

    def system():
        return {"backups": {"dir": args.backup_dir or None, "every_hours": args.backup_hours if args.backup_dir else None,
                            "keep": args.keep, "last_path": _last_backup["path"], "last_at": _last_backup["at"],
                            "error": _last_backup["error"]}}

    app = App(store, demo=not args.no_demo, sms=sms, system=system, wake=wake)
    serve(app, args.host, args.port, trust_proxy=args.trust_proxy)


if __name__ == "__main__":
    main()
