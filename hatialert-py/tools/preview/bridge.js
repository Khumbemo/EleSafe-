/* Hosted-preview transport: runs the hatialert Python package in the browser
   with Pyodide. If the page can't run WebAssembly, it switches to the
   JavaScript fallback engine so the app still works. */
(() => {
  "use strict";
  const PY_FILES = __PY_FILES__;
  const BOOT_PY = __BOOT_PY__;
  const SEED = __SEED__;
  const PYODIDE_JS = "https://cdn.jsdelivr.net/npm/pyodide@__PYODIDE_VERSION__/pyodide.js";
  const say = (m) => window.HATI_BOOT_MSG && window.HATI_BOOT_MSG(m);
  // The database snapshot lives in IndexedDB (photos outgrow localStorage).
  // Any failure here just means changes last until the page is closed.
  const idb = () => new Promise((ok, fail) => {
    const req = indexedDB.open("hatialert-preview", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  });
  async function load() {
    try {
      const d = await idb();
      return await new Promise((ok) => { const r = d.transaction("kv").objectStore("kv").get("db"); r.onsuccess = () => ok(r.result || null); r.onerror = () => ok(null); });
    } catch { return null; }
  }
  let saving = Promise.resolve();
  function save(bytes) {
    saving = saving.then(async () => {
      try { const d = await idb(); d.transaction("kv", "readwrite").objectStore("kv").put(bytes, "db"); }
      catch { /* storage blocked: keep going in memory */ }
    });
  }
  try { localStorage.removeItem("hatialert.preview.db.v1"); } catch { /* old text snapshot */ }

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
    // The standard library zip ships inside this page (#hati-stdlib, base64);
    // answer Pyodide's request for it from there.
    const b64 = document.getElementById("hati-stdlib").textContent.trim();
    const zip = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const realFetch = window.fetch;
    window.fetch = (input, init) => String(input && input.url ? input.url : input).endsWith("/python_stdlib.zip")
      ? Promise.resolve(new Response(zip, { headers: { "Content-Type": "application/zip" } }))
      : realFetch(input, init);
    let py;
    try { py = await window.loadPyodide({ indexURL: new URL("pyodide/", location.href).href, stdout: () => {}, stderr: () => {} }); }
    finally { window.fetch = realFetch; }
    say("Loading HatiAlert…");
    py.FS.mkdirTree("/home/pyodide/hatialert");
    for (const [name, src] of Object.entries(PY_FILES)) py.FS.writeFile("/home/pyodide/hatialert/" + name, src);
    const saved = await load();
    py.globals.set("SAVED", saved || undefined); // undefined arrives as None; null would be jsnull
    try { py.runPython(BOOT_PY); }
    catch (e) { console.warn("HatiAlert: saved data unreadable, starting fresh", e); py.globals.set("SAVED", undefined); py.runPython(BOOT_PY); }
    const handle = py.globals.get("handle_json"), dump = py.globals.get("dump_db");
    const version = py.runPython("import sys; sys.version.split()[0]");
    t.engine = `Python ${version} in your browser (Pyodide)`;
    return (m, path, q, body, auth) => {
      const out = JSON.parse(handle(m, path, q, body, auth));
      if (m !== "GET" && out.status < 400) { const snap = dump(); save(snap.toJs()); snap.destroy(); }
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
