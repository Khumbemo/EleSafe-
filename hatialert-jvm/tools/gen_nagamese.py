#!/usr/bin/env python3
"""Extract the web app's Nagamese phrase table for the JVM/Android app.

    python3 tools/gen_nagamese.py > client/src/main/resources/nagamese.json

Reads hatialert-py/web-ts/src/i18n/nagamese.ts (the one place the phrases are
edited) and prints JSON: {"words": {English: Nagamese}, "patterns": [[regex,
template], ...]} in the order of the source. The table is a DRAFT that no
native speaker has reviewed yet; see the comment at the top of nagamese.ts.

The TypeScript file is a single object literal of double-quoted strings, so a
small tokenizer is enough: no Node or TypeScript is needed. String literals
are decoded as JSON strings, which covers the escapes the file uses (\\\\, \\",
\\uXXXX). Anything else in the literal makes this script fail loudly rather
than guess.

client/src/test/.../NagameseFreshnessTest re-runs this and fails when the
committed JSON no longer matches the TypeScript.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_PY = HERE.parent.parent / "hatialert-py"
SOURCE = Path("web-ts/src/i18n/nagamese.ts")

TOKEN = re.compile(
    r"""
    (?P<ws>\s+)
  | (?P<line>//[^\n]*)
  | (?P<block>/\*.*?\*/)
  | (?P<str>"(?:[^"\\\n]|\\.)*")
  | (?P<ident>[A-Za-z_$][A-Za-z0-9_$]*)
  | (?P<punct>[{}\[\]:,])
    """,
    re.VERBOSE | re.DOTALL,
)


def tokens(text: str):
    pos = 0
    while pos < len(text):
        m = TOKEN.match(text, pos)
        if not m:
            line = text.count("\n", 0, pos) + 1
            raise SystemExit(f"nagamese.ts line {line}: can't read {text[pos:pos + 30]!r}")
        pos = m.end()
        kind = m.lastgroup
        if kind in ("ws", "line", "block"):
            continue
        value = m.group()
        if kind == "str":
            value = json.loads(value)
        yield kind, value


class Parser:
    def __init__(self, toks):
        self.toks = list(toks)
        self.i = 0

    def peek(self):
        return self.toks[self.i] if self.i < len(self.toks) else (None, None)

    def take(self, kind=None, value=None):
        tok = self.peek()
        if tok[0] is None or (kind and tok[0] != kind) or (value is not None and tok[1] != value):
            raise SystemExit(f"nagamese.ts: expected {value or kind}, found {tok[1]!r}")
        self.i += 1
        return tok[1]

    def key(self):
        kind, value = self.peek()
        if kind not in ("str", "ident"):
            raise SystemExit(f"nagamese.ts: expected a key, found {value!r}")
        self.i += 1
        return value

    def words(self):
        out = {}
        self.take("punct", "{")
        while self.peek() != ("punct", "}"):
            k = self.take("str")
            self.take("punct", ":")
            v = self.take("str")
            if k in out:
                raise SystemExit(f"nagamese.ts: {k!r} is listed twice")
            out[k] = v
            if self.peek() == ("punct", ","):
                self.take()
        self.take("punct", "}")
        return out

    def patterns(self):
        out = []
        self.take("punct", "[")
        while self.peek() != ("punct", "]"):
            self.take("punct", "[")
            re_src = self.take("str")
            self.take("punct", ",")
            tpl = self.take("str")
            if self.peek() == ("punct", ","):
                self.take()
            self.take("punct", "]")
            out.append([re_src, tpl])
            if self.peek() == ("punct", ","):
                self.take()
        self.take("punct", "]")
        return out


def extract(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    start = text.find("export const NAGAMESE")
    if start < 0:
        raise SystemExit(f"{path}: no `export const NAGAMESE`")
    body = text[text.index("=", start) + 1:]
    p = Parser(tokens(body[: body.rindex("}") + 1]))
    p.take("punct", "{")
    book = {}
    while p.peek() != ("punct", "}"):
        name = p.key()
        p.take("punct", ":")
        if name == "words":
            book["words"] = p.words()
        elif name == "patterns":
            book["patterns"] = p.patterns()
        else:
            raise SystemExit(f"nagamese.ts: unexpected section {name!r}")
        if p.peek() == ("punct", ","):
            p.take()
    for section in ("words", "patterns"):
        if section not in book:
            raise SystemExit(f"nagamese.ts: no {section}")
    for re_src, _ in book["patterns"]:
        try:
            re.compile(re_src)
        except re.error as e:  # Python and Java read these patterns the same way
            raise SystemExit(f"nagamese.ts: bad pattern {re_src!r}: {e}")
    return book


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--py-dir", default=str(DEFAULT_PY), help="the hatialert-py folder")
    args = ap.parse_args()
    src = Path(args.py_dir) / SOURCE
    book = extract(src)
    out = {
        "_generated": "by hatialert-jvm/tools/gen_nagamese.py from hatialert-py/" + SOURCE.as_posix() + "; edit the phrases there",
        "_status": "DRAFT, not yet checked by a native Nagamese speaker",
        "words": book["words"],
        "patterns": book["patterns"],
    }
    sys.stdout.reconfigure(encoding="utf-8", newline="\n")
    sys.stdout.write(json.dumps(out, ensure_ascii=False, indent=1) + "\n")


if __name__ == "__main__":
    main()
