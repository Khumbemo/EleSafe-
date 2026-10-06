"""Run a request scenario (JSON on stdin) through the Python API with a fixed
clock; print the seed export and every response. Used by parity.cjs."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_preview import T, seed_export  # noqa: E402
from hatialert.api import App  # noqa: E402
from hatialert.store import Store  # noqa: E402

now = [T]
store = Store(":memory:", pin_iterations=1000)
store.seed(at=T)
app = App(store, clock=lambda: now[0])
tokens, out = {}, []
for step in json.load(sys.stdin):
    now[0] += step.get("advance", 0)
    path, _, query = step["path"].partition("?")
    auth = f"Bearer {tokens[step['as']]}" if step.get("as") else ""
    body = json.dumps(step["body"]) if "body" in step else ""
    res = json.loads(app.handle_json(step["method"], path, query, body, auth))
    if step.get("login") and res["status"] == 200:
        tokens[step["login"]] = json.loads(res["body"])["token"]
    out.append(res)
print(json.dumps({"seed": seed_export(), "results": out}))
