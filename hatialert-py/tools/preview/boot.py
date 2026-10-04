# Runs inside Pyodide in the hosted preview. Builds the same App the server
# uses, on an in-memory SQLite database that is saved to this browser.
import json
import sqlite3

from hatialert.api import App
from hatialert.store import Store

store = Store(":memory:", pin_iterations=2000)
if SAVED:
    store.db.close()
    store.db = sqlite3.connect(":memory:", check_same_thread=False)
    store.db.row_factory = sqlite3.Row
    store.db.executescript(SAVED)
    store.db.execute("PRAGMA foreign_keys = ON")
else:
    store.seed()
app = App(store)


def handle_json(method, path, query, body, auth):
    return app.handle_json(method, path, query, body, auth)


def dump_db():
    return "\n".join(store.db.iterdump())
