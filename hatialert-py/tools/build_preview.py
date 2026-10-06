"""Build the single-page hosted preview.

    python tools/build_preview.py --pyodide path/to/pyodide-package --out build/preview

Writes index.html (body content for the artifact host), test.html (the same
page as a full document, for local checks) and pyodide/ (runtime files that
are published next to the page). Pyodide's standard-library zip is embedded
in the page as base64 because the host doesn't serve .zip files. The Python that runs in the page is the
hatialert package itself, copied in unchanged.
"""

import argparse
import base64
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from hatialert.api import App  # noqa: E402
from hatialert.store import DEMO_ACCOUNTS, Store  # noqa: E402

PY_MODULES = ["__init__.py", "domain.py", "security.py", "store.py", "api.py"]
PYODIDE_FILES = ["pyodide.asm.mjs", "pyodide.asm.wasm", "pyodide-lock.json"]  # stdlib zip is inlined
FONTS = (
    "https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400"
    "&family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700&family=IBM+Plex+Mono:wght@500&display=swap"
)
T = 1_800_000_000_000


def seed_export():
    """The Python seed, as rows with times relative to 'now' (for the JS fallback)."""
    store = Store(":memory:", pin_iterations=1000)
    store.seed(at=T)
    pins = {a["phone"]: a["pin"] for a in DEMO_ACCOUNTS}
    users = [
        {**{k: u[k] for k in ("id", "name", "phone", "village", "role", "radius_km", "sample",
                             "phone_verified", "must_change_pin", "active", "sms_alerts")},
         "pin": pins[u["phone"]], "created_at": u["created_at"] - T}
        for u in store.all("SELECT * FROM users")
    ]
    incidents = [{**r, "created_at": r["created_at"] - T, "updated_at": r["updated_at"] - T} for r in store.all("SELECT * FROM incidents")]
    events = [{**{k: e[k] for k in ("id", "incident_id", "status", "note", "user_id")}, "at": e["at"] - T} for e in store.all("SELECT * FROM events")]
    alerts = [{**{k: a[k] for k in ("id", "level", "message", "villages", "incident_id", "user_id", "sample")}, "sent_at": a["sent_at"] - T} for a in store.alerts(1000)]
    meta = App(store).get_meta(None, {}, {})
    demo = meta.pop("demo_accounts")
    return {"meta": meta, "demo_accounts": demo, "users": users, "incidents": incidents, "events": events, "alerts": alerts}


def script_safe(js: str) -> str:
    return js.replace("</script", "<\\/script").replace("<!--", "<\\!--")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pyodide", required=True, type=Path, help="unpacked pyodide npm package directory")
    ap.add_argument("--out", required=True, type=Path)
    args = ap.parse_args()

    version = json.loads((args.pyodide / "package.json").read_text())["version"]
    web, tools = ROOT / "hatialert" / "web", ROOT / "tools" / "preview"
    py_files = {name: (ROOT / "hatialert" / name).read_text() for name in PY_MODULES}
    bridge = (
        (tools / "bridge.js").read_text()
        .replace("__PY_FILES__", json.dumps(py_files))
        .replace("__BOOT_PY__", json.dumps((tools / "boot.py").read_text()))
        .replace("__SEED__", json.dumps(seed_export()))
        .replace("__PYODIDE_VERSION__", version)
    )
    body = "\n".join([
        "<title>HatiAlert</title>",
        '<meta name="description" content="Elephant incident reporting for Wokha district, Nagaland">',
        f'<link rel="stylesheet" href="{FONTS}">',
        f"<style>\n{(web / 'app.css').read_text()}\n</style>",
        '<div id="app"></div>',
        f'<script type="text/plain" id="hati-stdlib">{base64.b64encode((args.pyodide / "python_stdlib.zip").read_bytes()).decode()}</script>',
        f"<script>\n{script_safe((tools / 'fallback.js').read_text())}\n</script>",
        f"<script>\n{script_safe(bridge)}\n</script>",
        f"<script>\n{script_safe((web / 'nagamese.js').read_text())}\n</script>",
        f"<script>\n{script_safe((web / 'app.js').read_text())}\n</script>",
    ])
    out = args.out
    (out / "pyodide").mkdir(parents=True, exist_ok=True)
    (out / "index.html").write_text(body)
    (out / "test.html").write_text(
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head>'
        f"<body>{body}</body></html>"
    )
    for name in PYODIDE_FILES:
        shutil.copy2(args.pyodide / name, out / "pyodide" / name)
    (out / "map").mkdir(exist_ok=True)
    for name in ("layers.json", "terrain.webp"):
        shutil.copy2(web / "map" / name, out / "map" / name)
    print(f"Built {out}/index.html ({len(body) // 1024} KB) with Pyodide {version}")


if __name__ == "__main__":
    main()
