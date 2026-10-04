"""Run HatiAlert:  python -m hatialert [--db FILE] [--port 8000] [--no-demo]"""

import argparse

from .api import App
from .server import serve
from .store import Store


def main():
    p = argparse.ArgumentParser(prog="hatialert", description="HatiAlert elephant-incident reporting server")
    p.add_argument("--db", default="hatialert.db", help="SQLite file (default: hatialert.db)")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--no-demo", action="store_true", help="skip demo accounts and sample incidents")
    args = p.parse_args()

    store = Store(args.db)
    if store.is_empty() and not args.no_demo:
        store.seed()
        print("Loaded demo accounts and sample incidents (officers can remove the samples).")
    serve(App(store, demo=not args.no_demo), args.host, args.port)


if __name__ == "__main__":
    main()
