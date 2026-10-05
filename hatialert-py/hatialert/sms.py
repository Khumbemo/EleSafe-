"""Text messages: alert SMS to villagers and one-time sign-up / PIN codes.

HatiAlert does not pick an SMS company for you. Point it at any provider
that accepts an HTTP POST, using environment variables:

  HATIALERT_SMS_URL     provider endpoint (required to send automatically)
  HATIALERT_SMS_AUTH    value for the Authorization header (optional)
  HATIALERT_SMS_BODY    JSON template; {to} and {message} are filled in
                        (default: {"to": "{to}", "message": "{message}"})
  HATIALERT_SMS_PREFIX  put before the 10-digit number (default: +91)
  HATIALERT_SMS_DEBUG=1 print messages to the console instead (testing)

Without HATIALERT_SMS_URL or DEBUG, alerts are listed for forest staff to
send by hand (More > Admin > Messages) and one-time codes are switched off.
"""

from __future__ import annotations

import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from .store import Store, now_ms

RETRY_MINUTES = [1, 5, 15, 60]  # then give up and mark failed


class SmsConfig:
    def __init__(self, env=None):
        env = os.environ if env is None else env
        self.url = env.get("HATIALERT_SMS_URL", "").strip()
        self.auth = env.get("HATIALERT_SMS_AUTH", "").strip()
        self.body = env.get("HATIALERT_SMS_BODY", '{"to": "{to}", "message": "{message}"}')
        self.prefix = env.get("HATIALERT_SMS_PREFIX", "+91")
        self.debug = env.get("HATIALERT_SMS_DEBUG", "") == "1"

    @property
    def enabled(self) -> bool:
        return bool(self.url) or self.debug

    @property
    def mode(self) -> str:
        return "debug" if self.debug and not self.url else "auto" if self.url else "manual"

    @property
    def host(self) -> str:
        return urllib.parse.urlsplit(self.url).hostname or ""

    def payload(self, phone: str, message: str) -> bytes:
        esc = lambda v: json.dumps(v)[1:-1]  # noqa: E731  (JSON-escape inside the quotes)
        text = self.body.replace("{to}", esc(self.prefix + phone)).replace("{message}", esc(message))
        json.loads(text)  # refuse to send a broken template
        return text.encode()

    def send(self, phone: str, message: str):
        if self.debug and not self.url:
            print(f"[SMS to {self.prefix}{phone}] {message}", flush=True)
            return
        req = urllib.request.Request(self.url, data=self.payload(phone, message), method="POST",
                                     headers={"Content-Type": "application/json", "User-Agent": "HatiAlert/1.0"})
        if self.auth:
            req.add_header("Authorization", self.auth)
        with urllib.request.urlopen(req, timeout=15) as r:
            if not 200 <= r.status < 300:
                raise RuntimeError(f"HTTP {r.status}")


def deliver_due(store: Store, cfg: SmsConfig, now: int | None = None) -> int:
    """Send queued messages once; returns how many were sent."""
    now = now or now_ms()
    sent = 0
    for m in store.due_messages(now):
        try:
            cfg.send(m["phone"], m["body"])
            store.mark_message(m["id"], "sent", now)
            sent += 1
        except (urllib.error.URLError, OSError, RuntimeError, ValueError) as e:
            tries = m["attempts"] + 1
            if tries > len(RETRY_MINUTES):
                store.mark_message(m["id"], "failed", now, str(e))
            else:
                store.mark_message(m["id"], "queued", now, str(e), next_try=now + RETRY_MINUTES[tries - 1] * 60_000)
    return sent


def start_worker(store: Store, cfg: SmsConfig, every_s: float = 5.0):
    """Start the sender thread; returns a wake() function (None when SMS is off).
    Calling wake() sends new messages at once instead of at the next tick."""
    if not cfg.enabled:
        return None
    nudge = threading.Event()

    def loop():
        while True:
            try:
                deliver_due(store, cfg)
            except Exception as e:  # keep the worker alive whatever happens
                print(f"SMS worker error: {e}", flush=True)
            nudge.wait(every_s)
            nudge.clear()

    threading.Thread(target=loop, name="sms", daemon=True).start()
    return nudge.set
