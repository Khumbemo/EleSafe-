# HatiAlert preview (built)

A ready-to-host copy of the app that runs the real `hatialert` Python code in
the browser with [Pyodide](https://pyodide.org), on demo data saved in that
browser. Rebuild it with `python tools/build_preview.py --pyodide <pyodide
npm package dir> --out preview`.

- Open it from any static web host, e.g. GitHub Pages pointed at this
  folder, or locally with `python -m http.server -d preview` and
  http://127.0.0.1:8000/ (opening the file directly won't work: browsers
  block the runtime files from `file://`).
- `index.html` is the complete page; `artifact.html` is the same page body
  for hosts that add their own `<head>`.
- `pyodide/` holds Pyodide 314.0.7 (MPL-2.0); the loader script comes from
  cdn.jsdelivr.net. `map/` holds the base map.
- The demo data is fake and there is no real server: for actual use run
  `python -m hatialert`.
