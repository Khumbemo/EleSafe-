"""Standard-library web server: serves the UI from web/ and the JSON API."""

from __future__ import annotations

import mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from .api import App

WEB = Path(__file__).with_name("web")
MAX_BODY = 20 * 1024 * 1024  # 6 photos + 2 voice notes at their size limits, as base64
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(self), microphone=(self), geolocation=(self)",
    "Content-Security-Policy": (
        "default-src 'self'; style-src 'self'; font-src 'self'; "
        "img-src 'self' data: blob:; media-src 'self' data: blob:; frame-ancestors 'none'"
    ),
}


def make_handler(app: App, trust_proxy: bool = False):
    class Handler(BaseHTTPRequestHandler):
        server_version = "HatiAlert"

        def _send(self, status, ctype, body, extra=None):
            data = body.encode() if isinstance(body, str) else body
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            for k, v in {**SECURITY_HEADERS, **(extra or {})}.items():
                self.send_header(k, v)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(data)

        def _api(self):
            url = urlsplit(self.path)
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_BODY:
                return self._send(413, "application/json", '{"error": "Request too large."}')
            body = self.rfile.read(length) if length else b""
            headers = {k: v for k, v in self.headers.items() if k.lower() != "x-hatialert-client"}
            client = self.client_address[0]
            if trust_proxy and self.headers.get("X-Forwarded-For"):
                client = self.headers["X-Forwarded-For"].split(",")[-1].strip()  # the address the proxy saw
            headers["X-HatiAlert-Client"] = client
            status, ctype, text = app.handle(self.command, url.path, url.query, body, headers)
            extra = {}
            if ctype.startswith("text/csv"):
                extra["Content-Disposition"] = 'attachment; filename="hatialert-incidents.csv"'
            self._send(status, ctype, text, extra)

        def _static(self):
            path = urlsplit(self.path).path
            target = (WEB / ("index.html" if path in ("/", "") else path.lstrip("/"))).resolve()
            if WEB.resolve() not in target.parents or not target.is_file():
                return self._send(404, "text/plain; charset=utf-8", "Not found")
            ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
            if ctype.startswith("text/") or ctype in ("application/javascript", "image/svg+xml"):
                ctype += "; charset=utf-8"
            extra = {"Service-Worker-Allowed": "/"} if target.name == "sw.js" else None
            self._send(200, ctype, target.read_bytes(), extra)

        def _route(self):
            if urlsplit(self.path).path.startswith("/api/"):
                return self._api()
            if self.command in ("GET", "HEAD"):
                return self._static()
            self._send(405, "text/plain; charset=utf-8", "Method not allowed")

        do_GET = do_HEAD = do_POST = do_PATCH = do_PUT = do_DELETE = _route

        def log_message(self, fmt, *args):
            print(f"{self.address_string()} {self.command} {self.path} -> {args[1] if len(args) > 1 else ''}")

    return Handler


def serve(app: App, host: str, port: int, trust_proxy: bool = False):
    httpd = ThreadingHTTPServer((host, port), make_handler(app, trust_proxy))
    print(f"HatiAlert running at http://{host}:{port}  (Ctrl+C to stop)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
