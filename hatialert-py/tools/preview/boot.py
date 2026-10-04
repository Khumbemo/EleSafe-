# Runs inside Pyodide in the hosted preview. Builds the same App the server
# uses, on an in-memory SQLite database that is saved to this browser
# (IndexedDB) as a binary snapshot.

import hatialert.store as store_module
from hatialert.api import App
from hatialert.store import Store

store = Store(":memory:", pin_iterations=2000)
if SAVED is not None:
    store.db.deserialize(bytes(SAVED.to_py()))
    store.db.execute("PRAGMA foreign_keys = ON")
    store.db.executescript(store_module.SCHEMA)  # adds tables new since the snapshot
else:
    store.seed()
app = App(store)


def handle_json(method, path, query, body, auth):
    return app.handle_json(method, path, query, body, auth)


def dump_db():
    return store.db.serialize()
