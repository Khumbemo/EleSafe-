/* Hosted-preview transport: runs the hatialert Python package in the browser
   with Pyodide. If the page can't run WebAssembly, it switches to the
   JavaScript fallback engine so the app still works. */
(() => {
  "use strict";
  const PY_FILES = __PY_FILES__;
  const BOOT_PY = __BOOT_PY__;
  const SEED = __SEED__;
  const PYODIDE_JS = "https://cdn.jsdelivr.net/npm/pyodide@__PYODIDE_VERSION__/pyodide.js";
  const SAVE_KEY = "hatialert.preview.db.v1";
  const say = (m) => window.HATI_BOOT_MSG && window.HATI_BOOT_MSG(m);
  const load = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const save = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked: keep going in memory */ } };

  const t = { engine: "starting", canDownload: false };
  let call;

  function loadScript(src) {
    return new Promise((ok, fail) => {
      const s = document.createElement("script");
      s.src = src; s.onload = ok; s.onerror = () => fail(new Error("couldn't load " + src));
      document.head.append(s);
    });
  }
  const timeout = (ms) => new Promise((_, fail) => setTimeout(() => fail(new Error("timed out")), ms));

  async function startPython() {
    if (typeof WebAssembly !== "object") throw new Error("WebAssembly isn't available");
    say("Starting Python in your browser…");
    if (!window.loadPyodide) await loadScript(PYODIDE_JS);
    const py = await window.loadPyodide({ indexURL: new URL("pyodide/", location.href).href, stdout: () => {}, stderr: () => {} });
    say("Loading HatiAlert…");
    py.FS.mkdirTree("/home/pyodide/hatialert");
    for (const [name, src] of Object.entries(PY_FILES)) py.FS.writeFile("/home/pyodide/hatialert/" + name, src);
    py.globals.set("SAVED", load(SAVE_KEY) || "");
    try { py.runPython(BOOT_PY); }
    catch (e) { py.globals.set("SAVED", ""); py.runPython(BOOT_PY); }
    const handle = py.globals.get("handle_json"), dump = py.globals.get("dump_db");
    const version = py.runPython("import sys; sys.version.split()[0]");
    t.engine = `Python ${version} in your browser (Pyodide)`;
    return (m, path, q, body, auth) => {
      const out = JSON.parse(handle(m, path, q, body, auth));
      if (m !== "GET" && out.status < 400) save(SAVE_KEY, dump());
      return out;
    };
  }

  function startFallback(reason) {
    const eng = createFallbackEngine(SEED);
    t.engine = "JavaScript copy of the Python API (Python couldn't start here: " + reason + "). Changes reset on reload";
    return (m, path, q, body, auth) => eng.handle(m, path, q, body, auth);
  }

  t.ready = Promise.race([startPython(), timeout(90000)])
    .catch((e) => { console.warn("HatiAlert: Python engine unavailable,", e); return startFallback(e && e.message ? e.message : "unknown error"); })
    .then((fn) => { call = fn; });

  t.request = async (method, url, body, token) => {
    await t.ready;
    const [path, query = ""] = url.split("?");
    return call(method, path, query, body === undefined ? "" : JSON.stringify(body), token ? "Bearer " + token : "");
  };
  window.HATI_TRANSPORT = t;
})();
