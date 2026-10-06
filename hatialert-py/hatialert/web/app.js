/* HatiAlert web client. Talks to the Python API through `transport`:
   fetch() against the stdlib server by default, or the in-browser Python
   engine when the preview build sets window.HATI_TRANSPORT. */
(() => {
  "use strict";

  const transport = window.HATI_TRANSPORT || {
    engine: "Python server",
    canDownload: true,
    ready: Promise.resolve(),
    async request(method, path, body, token) {
      const headers = {};
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (token) headers.Authorization = "Bearer " + token;
      const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, type: res.headers.get("Content-Type") || "", body: await res.text() };
    },
  };

  const state = { meta: null, token: null, user: null, prefill: null, casesFilter: "open", casesVillage: "", days: 30 };
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  // -- utilities ---------------------------------------------------------
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* storage blocked */ } },
  };
  // -- theme -------------------------------------------------------------
  const THEMES = [
    { key: "green", label: "Green", note: "Follows your phone's light or dark mode" },
    { key: "white", label: "White", note: "Bright, for outdoors in daylight" },
    { key: "dark", label: "Dark", note: "Black and grey, less glare at night" },
    { key: "navy", label: "Navy blue", note: "Deep blue with sky-blue buttons" },
  ];
  const currentTheme = () => (THEMES.some((t) => t.key === store.get("hatialert.theme")) ? store.get("hatialert.theme") : "green");
  function applyTheme(key) {
    const root = document.documentElement;
    if (key && key !== "green") root.dataset.skin = key; else delete root.dataset.skin;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = getComputedStyle(root).getPropertyValue("--bg").trim() || meta.content;
  }
  applyTheme(currentTheme());

  // -- language ----------------------------------------------------------
  // English is written in the templates. For Nagamese, a translator swaps
  // interface text as it reaches the page (see nagamese.js). Elements marked
  // translate="no" (messages, notes, names people typed) are left alone.
  const LANGS = [{ key: "en", label: "English" }, { key: "nag", label: "Nagamese" }];
  const NAG = window.HATI_NAGAMESE || { words: {}, patterns: [] };
  const NAG_PATTERNS = NAG.patterns.map(([re, out]) => [new RegExp("^" + re + "$"), out]);
  let lang = store.get("hatialert.lang") === "nag" ? "nag" : "en";
  const isNag = () => lang === "nag";
  function tr(text) {
    if (lang !== "nag" || !text) return text;
    const s = text.trim();
    if (!s) return text;
    let out = Object.prototype.hasOwnProperty.call(NAG.words, s) ? NAG.words[s] : undefined;
    if (out === undefined) {
      for (const [re, tpl] of NAG_PATTERNS) {
        const m = s.match(re);
        if (m) { out = tpl.replace(/\{(\d)\}/g, (_, k) => tr(m[+k] || "")); break; }
      }
    }
    if (out === undefined) return text;
    return text.slice(0, text.length - text.trimStart().length) + out + text.slice(text.trimEnd().length);
  }
  const TR_ATTRS = ["placeholder", "aria-label", "title", "alt"];
  function translateNode(n) {
    if (n.nodeType === 3) { const v = tr(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; return; }
    if (n.nodeType !== 1 || n.getAttribute("translate") === "no" || n.tagName === "SCRIPT" || n.tagName === "STYLE") return;
    for (const a of TR_ATTRS) {
      const old = n.getAttribute(a);
      if (old) { const v = tr(old); if (v !== old) n.setAttribute(a, v); }
    }
    if (n.tagName === "TEXTAREA") return; // its text is what the person typed
    for (const c of n.childNodes) translateNode(c);
  }
  const skipped = (n) => !!(n.parentElement && n.parentElement.closest('[translate="no"]'));
  new MutationObserver((muts) => {
    if (lang !== "nag") return;
    for (const m of muts) {
      if (m.type === "characterData") { if (!skipped(m.target)) translateNode(m.target); }
      else for (const n of m.addedNodes) if (!skipped(n)) translateNode(n);
    }
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  function setLang(key) {
    lang = key === "nag" ? "nag" : "en";
    store.set("hatialert.lang", lang);
    document.documentElement.lang = lang === "nag" ? "nag" : "en";
  }
  document.documentElement.lang = lang === "nag" ? "nag" : "en";
  const langPicker = (id) => `<div class="seg langs" role="group" aria-label="Language / Bhasa" translate="no" id="${id}">${LANGS.map((l) => `<button type="button" data-lang="${l.key}" aria-pressed="${lang === l.key}">${l.label}</button>`).join("")}</div>`;
  function bindLangPicker(root, id) {
    $$(`#${id} [data-lang]`, root).forEach((b) => (b.onclick = () => {
      if (b.dataset.lang === lang) return;
      setLang(b.dataset.lang);
      router();
      toast(lang === "nag" ? "Bhasa: Nagamese" : "Language: English");
    }));
  }

  const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
  function ago(ms) {
    const s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    if (s < 7 * 86400) return plural(Math.floor(s / 86400), "day") + " ago";
    return when(ms);
  }
  const when = (ms) => new Date(ms).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const inr = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");
  const roleName = { villager: "Villager", guard: "Forest guard", officer: "Forest officer" };
  const isStaff = () => state.user && state.user.role !== "villager";
  const sevPill = (key, label) => `<span class="sev sev-${esc(key)}">${esc(label)}</span>`;

  class ApiErr extends Error {
    constructor(status, message, field) { super(message); this.status = status; this.field = field; }
  }

  // Reading pages offline: successful GETs are kept on the phone and shown,
  // with a notice, when the network is down.
  const CACHEABLE = /^\/api\/(meta|me|overview|alerts|incidents(\?|$)|incidents\/\d+$)/;
  // Saved copies are filed under the sign-in (or "pub" for public data) and
  // wiped on sign-out, so a shared phone never shows one person's data to another.
  const cacheKey = (path) => "hatialert.cache:" + (path === "/api/meta" ? "pub" : (state.token || "-").slice(0, 16)) + ":" + path;
  // Keep "who is signed in" on the phone so the app opens offline.
  const saveMe = (user) => { if (state.token && user) store.set(cacheKey("/api/me"), JSON.stringify({ at: Date.now(), data: user })); };
  function clearCache() {
    try { for (const k of Object.keys(localStorage)) if (k.startsWith("hatialert.cache:") && !k.startsWith("hatialert.cache:pub:")) localStorage.removeItem(k); } catch { /* blocked */ }
  }
  async function api(method, path, body) {
    let res;
    try {
      res = await transport.request(method, path, body, state.token);
    } catch (e) {
      if (method === "GET" && CACHEABLE.test(path)) {
        const hit = store.get(cacheKey(path));
        if (hit) {
          const { at, data } = JSON.parse(hit);
          setOffline(at);
          return data;
        }
      }
      setOffline(state.offlineSince || Date.now());
      throw new ApiErr(0, "Can't reach HatiAlert. Check your connection and try again.");
    }
    if (state.offlineSince) setOffline(null);
    if (res.type.startsWith("text/csv")) return res.body;
    let data = {};
    try { data = JSON.parse(res.body || "{}"); } catch { /* not JSON */ }
    if (res.status >= 400) {
      if (res.status === 401 && state.token) signOutLocal();
      if (res.status === 403 && data.field === "pin" && state.user) { state.user.must_change_pin = true; location.hash = "#/new-pin"; }
      throw new ApiErr(res.status, data.error || "Something went wrong.", data.field);
    }
    if (method === "GET" && CACHEABLE.test(path) && res.body.length < 400_000) store.set(cacheKey(path), JSON.stringify({ at: Date.now(), data }));
    return data;
  }
  function setOffline(at) {
    state.offlineSince = at;
    const bar = $("#offline-bar");
    if (bar) { bar.hidden = !at; if (at) bar.textContent = `No connection. Showing what was saved at ${new Date(at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}.`; }
  }

  // -- send-later queue (IndexedDB, so photos fit) -------------------------
  const queueDb = () => new Promise((ok, fail) => {
    const r = indexedDB.open("hatialert-client", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("queue", { keyPath: "client_id" });
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
  const queueTx = async (mode, fn) => {
    const d = await queueDb();
    return new Promise((ok, fail) => {
      const tx = d.transaction("queue", mode), st = tx.objectStore("queue");
      const req = fn(st);
      tx.oncomplete = () => ok(req && req.result);
      tx.onerror = () => fail(tx.error);
    });
  };
  const queue = {
    async add(item) { try { await queueTx("readwrite", (st) => st.put(item)); return true; } catch { return false; } },
    async all() { try { return (await queueTx("readonly", (st) => st.getAll())) || []; } catch { return []; } },
    async remove(id) { try { await queueTx("readwrite", (st) => st.delete(id)); } catch { /* gone */ } },
  };
  const newClientId = () => (crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join(""));
  let flushing = false;
  async function flushQueue() {
    if (flushing || !state.user) return;
    flushing = true;
    try {
      for (const item of await queue.all()) {
        if (item.user_id !== state.user.id) continue;
        try {
          const inc = await api("POST", "/api/incidents", item.body);
          await queue.remove(item.client_id);
          toast(`Saved report sent: ${inc.ref}`);
        } catch (err) {
          if (err.status === 0 || err.status === 401 || err.status === 429 || err.status >= 500) break; // try later
          await queue.remove(item.client_id); // the server refused it; keep the reason visible
          toast(`A saved report couldn't be sent: ${err.message}`);
        }
      }
    } finally {
      flushing = false;
      const n = (await queue.all()).filter((i) => state.user && i.user_id === state.user.id).length;
      const box = $("#queue-note");
      if (box) { box.hidden = !n; const c = $("[data-count]", box); if (c) c.textContent = plural(n, "report"); }
    }
  }
  window.addEventListener("online", flushQueue);
  setInterval(() => { if (navigator.onLine) flushQueue(); }, 60_000);

  // -- app shell offline (service worker; only on the real server over HTTPS or localhost)
  if ("serviceWorker" in navigator && !window.HATI_TRANSPORT && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    navigator.serviceWorker.register("sw.js").catch(() => { /* still works online */ });
  }

  // -- notifications on this phone while the app is open or in the background
  const notify = {
    supported: "Notification" in window,
    on: () => notify.supported && store.get("hatialert.notify") === "1" && Notification.permission === "granted",
    seen: new Set(JSON.parse(store.get("hatialert.seenAlerts") || "[]")),
    async check() {
      if (!notify.on() || !state.user || state.user.must_change_pin) return;
      let o;
      try { o = await api("GET", "/api/overview"); } catch { return; }
      const w = o.warning;
      if (!w || notify.seen.has(w.id)) return;
      notify.seen.add(w.id);
      store.set("hatialert.seenAlerts", JSON.stringify([...notify.seen].slice(-50)));
      const title = `${tr("Elephant warning")} · ${o.village.name}`;
      try {
        const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
        if (reg) reg.showNotification(title, { body: w.message, tag: "alert-" + w.id, icon: "icon.svg" });
        else new Notification(title, { body: w.message, tag: "alert-" + w.id });
      } catch { /* blocked here */ }
    },
  };
  setInterval(() => notify.check(), 60_000);

  let toastTimer;
  function toast(msg) {
    let el = $(".toast");
    if (!el) { el = document.createElement("div"); el.className = "toast"; el.setAttribute("role", "status"); document.body.append(el); }
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  function showErrors(form, err) {
    $$(".err", form).forEach((e) => e.remove());
    $$(".field.bad", form).forEach((e) => e.classList.remove("bad"));
    const target = err.field && form.querySelector(`[data-field="${err.field}"]`);
    const p = document.createElement("p");
    p.className = "err";
    p.setAttribute("role", "alert");
    p.textContent = err.message;
    if (target) { target.classList.add("bad"); target.append(p); }
    else form.querySelector("[data-errors]")?.append(p);
  }

  // -- icons -------------------------------------------------------------
  const ICON = {
    home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10"/>',
    report: '<path d="M12 5v14M5 12h14"/>',
    cases: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
    alerts: '<path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 8 2.5 8h-17S6 15 6 9"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    more: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    camera: '<path d="M3 8.5A2.5 2.5 0 0 1 5.5 6H7l2-2.5h6L17 6h1.5A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/><circle cx="12" cy="12.5" r="3.8"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
    stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
    flip: '<path d="M4.5 10A8 8 0 0 1 18 6.5L20 8.5M19.5 14A8 8 0 0 1 6 17.5L4 15.5"/><path d="M20 4.5v4h-4M4 19.5v-4h4"/>',
  };
  const ICON_SVG = (n) => `<svg viewBox="0 0 24 24">${ICON[n]}</svg>`;
  const icon = (n) => `<span class="ic" aria-hidden="true">${ICON_SVG(n)}</span>`;
  const MARK = `<svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true"><rect class="mk-bg" width="30" height="30" rx="8"/><circle class="mk-dot" cx="15" cy="15" r="3.2"/><circle class="mk-ring" cx="15" cy="15" r="7.5" stroke-width="1.8" stroke-dasharray="3 2.6"/><circle class="mk-ring faint" cx="15" cy="15" r="11.5" stroke-width="1.4"/></svg>`;

  // -- shell -------------------------------------------------------------
  const app = $("#app");
  function shell(active, content) {
    const tabs = [
      ["home", "Home", "#/home"],
      ["report", "Report", "#/report"],
      ["cases", isStaff() ? "Cases" : "My reports", "#/cases"],
      ["alerts", "Alerts", "#/alerts"],
      ["more", "More", "#/more"],
    ];
    app.innerHTML = `
      <div class="shell">
        <header class="topbar">
          <a class="brand" href="#/home">${MARK}<b>HatiAlert</b></a>
          <div class="who small"><span class="muted">${esc(roleName[state.user.role])}</span><span class="tag me">${icon("pin")}${esc(state.user.village)}</span></div>
        </header>
        <div id="offline-bar" class="offline-bar" role="status" hidden></div>
        <nav class="tabs" aria-label="Main">
          ${tabs.map(([k, label, href]) => `<a href="${href}" class="${k === "report" ? "report" : ""}" ${k === active ? 'aria-current="page"' : ""}>${icon(k)}<span>${label}</span></a>`).join("")}
        </nav>
        <main id="main" tabindex="-1">${content}</main>
      </div>`;
    setOffline(state.offlineSince);
    return $("#main");
  }
  const loading = (active) => shell(active, `<p class="muted">Loading…</p>`);
  function failure(main, err) {
    main.innerHTML = `<div class="card"><h2>That didn't load</h2><p class="muted">${esc(err.message)}</p><div><button class="btn" data-retry>Try again</button></div></div>`;
    $("[data-retry]", main).onclick = () => router();
  }

  // -- map ---------------------------------------------------------------
  // Real geography on the UTM zone 46N grid (EPSG:32646). Base layers come
  // from map/layers.json and map/terrain.webp, built by tools/build_map.py
  // from SRTM elevation and Census 2011 boundaries.
  const utmKm = (() => {
    const f = 1 / 298.257223563, n = f / (2 - f), A = 6378137 / (1 + n) * (1 + n * n / 4 + n ** 4 / 64);
    const al = [n / 2 - 2 * n * n / 3 + 5 * n ** 3 / 16, 13 * n * n / 48 - 3 * n ** 3 / 5, 61 * n ** 3 / 240];
    const c = 2 * Math.sqrt(n) / (1 + n), rad = Math.PI / 180;
    return (lat, lon) => {
      const phi = lat * rad, dl = (lon - 93) * rad;
      const t = Math.sinh(Math.atanh(Math.sin(phi)) - c * Math.atanh(c * Math.sin(phi)));
      const xi = Math.atan2(t, Math.cos(dl)), eta = Math.atanh(Math.sin(dl) / Math.sqrt(1 + t * t));
      let e = eta, nn = xi;
      al.forEach((a, j) => { const k = 2 * (j + 1); e += a * Math.cos(k * xi) * Math.sinh(k * eta); nn += a * Math.sin(k * xi) * Math.cosh(k * eta); });
      return [(500000 + 0.9996 * A * e) / 1000, (0.9996 * A * nn) / 1000];
    };
  })();
  // Point `km` from (lat, lng) on bearing `deg` (sphere, as in domain.py).
  function destination(lat, lng, km, deg) {
    const R = 6371.0088, d = km / R, th = deg * Math.PI / 180, p1 = lat * Math.PI / 180, l1 = lng * Math.PI / 180;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(th));
    const l2 = l1 + Math.atan2(Math.sin(th) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return [p2 * 180 / Math.PI, l2 * 180 / Math.PI];
  }

  let layersP = null;
  function loadLayers() {
    if (!layersP) layersP = fetch("map/layers.json").then((r) => (r.ok ? r.json() : null)).then((d) => (d ? prepareLayers(d) : null)).catch(() => null);
    return layersP;
  }
  function prepareLayers(d) {
    const [e0, n0, e1, n1] = d.extent;
    const unpack = (p) => { const out = []; let x = 0, y = 0; for (let i = 0; i < p.length; i += 2) { x += p[i]; y += p[i + 1]; out.push([x / 100, y / 100]); } return out; };
    const toD = (pts, close) => "M" + pts.map(([e, n]) => `${(e - e0).toFixed(2)},${(n1 - n).toFixed(2)}`).join("L") + (close ? "Z" : "");
    const contourLabels = [];
    const contours = { minor: "", index: "" };
    for (const c of d.contours) {
      for (const p of c.paths) {
        const pts = unpack(p);
        contours[c.index ? "index" : "minor"] += toD(pts);
        if (c.index && pts.length > 20) {
          const [e, n] = pts[pts.length >> 1];
          // keep labels of one height at least 6 km apart
          if (!contourLabels.some((l) => l.elev === c.elev && Math.hypot(l.e - e, l.n - n) < 6)) contourLabels.push({ e, n, elev: c.elev, text: c.elev.toLocaleString("en-IN") + " m" });
        }
      }
    }
    const streams = {};
    for (const s of d.streams) streams[s.order] = (streams[s.order] || "") + toD(unpack(s.path));
    const districts = d.districts.map((x) => {
      const rings = x.rings.map(unpack);
      const all = rings.flat();
      return { name: x.name, state: x.state, d: rings.map((r) => toD(r, true)).join(""), ce: all.reduce((s, p) => s + p[0], 0) / all.length, cn: all.reduce((s, p) => s + p[1], 0) / all.length };
    });
    return { e0, n0, e1, n1, W: e1 - e0, H: n1 - n0, terrain: d.terrain.href, contours, contourLabels, streams, districts, peaks: d.peaks, attribution: d.attribution, step: d.contour_step };
  }

  const maps = new Map();
  let mapSeq = 0;
  // Returns HTML for a map; call mountMaps(root) after inserting it.
  function mapBlock(opts) {
    const id = "m" + ++mapSeq;
    maps.set(id, opts);
    return `<div class="mapbox" data-map="${id}">
      <div class="mapframe" tabindex="0" aria-label="Map of Wokha district. Use plus and minus keys to zoom, arrow keys to move.">
        <svg class="map" role="img" aria-label="Map of villages and open incidents"></svg>
        <div class="mapctl"><button type="button" data-z="in" aria-label="Zoom in">+</button><button type="button" data-z="out" aria-label="Zoom out">−</button><button type="button" data-z="fit" aria-label="Fit to area">⤢</button></div>
        <div class="scalebar" aria-hidden="true"><i></i><span></span></div>
      </div>
      ${mapLegend(opts.radius)}
    </div>`;
  }
  function mapLegend(radius) {
    return `<div class="legend">
      <span><i class="dotk critical"></i>Critical</span><span><i class="dotk high"></i>High</span><span><i class="dotk medium"></i>Medium</span><span><i class="dotk low"></i>Low</span>
      <span><i class="vk"></i>Village</span><span><i class="vk unv"></i>Village, position not verified</span>
      ${radius ? `<span><i class="lk ring"></i>Your ${radius} km alert area</span>` : ""}
      <span><i class="lk water"></i>Stream</span><span><i class="lk ct"></i>Contour, 100 m</span><span><i class="lk dist"></i>District boundary</span>
    </div><p class="attrib" data-attrib></p>`;
  }

  function mountMaps(root) {
    $$("[data-map]", root).forEach(async (box) => {
      const opts = maps.get(box.dataset.map);
      maps.delete(box.dataset.map);
      if (!opts) return;
      const L = await loadLayers();
      if (!box.isConnected) return;
      drawMap(box, opts, L);
    });
  }

  function drawMap(box, { incidents = [], home, radius = 0, focus = null }, L) {
    const svg = $("svg", box), frame = $(".mapframe", box);
    const V = state.meta.villages;
    // Map space: x = easting - e0 (km), y = n1 - northing (km), north up.
    const vp = V.map((v) => utmKm(v.lat, v.lng));
    const ip = incidents.map((i) => utmKm(i.lat, i.lng));
    const all = [...vp, ...ip];
    const e0 = L ? L.e0 : Math.min(...all.map((p) => p[0])) - 15, n1 = L ? L.n1 : Math.max(...all.map((p) => p[1])) + 15;
    const W = L ? L.W : 30 + Math.max(...all.map((p) => p[0])) - Math.min(...all.map((p) => p[0])), H = L ? L.H : 30 + Math.max(...all.map((p) => p[1])) - Math.min(...all.map((p) => p[1]));
    const X = ([e]) => e - e0, Y = ([, n]) => n1 - n;
    const hv = V.find((v) => v.name === home);
    const f2 = (v) => v.toFixed(3);

    let base = `<defs><marker id="arrow-${box.dataset.map}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path class="arrowhead" d="M0 0 10 5 0 10z"/></marker></defs>
      <rect class="land" x="${-W}" y="${-H}" width="${3 * W}" height="${3 * H}"/>`;
    if (L) {
      const wokha = L.districts.find((d) => d.name === "Wokha");
      base += `<image class="relief" href="${L.terrain}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none"/>`;
      if (wokha) base += `<path class="outside" fill-rule="evenodd" d="M${-W},${-H}H${2 * W}V${2 * H}H${-W}Z${wokha.d}"/>`;
      base += `<path class="ct" d="${L.contours.minor}"/><path class="ct idx" d="${L.contours.index}"/>`;
      base += Object.entries(L.streams).map(([o, d]) => `<path class="water o${o}" d="${d}"/>`).join("");
      base += L.districts.filter((d) => d.name !== "Wokha").map((d) => `<path class="dist ${d.state === "Assam" ? "assam" : ""}" d="${d.d}"/>`).join("");
      if (wokha) base += `<path class="dist wokha" d="${wokha.d}"/>`;
    }
    base += `<g class="grid"></g>`;
    if (hv && radius) {
      const ring = Array.from({ length: 73 }, (_, k) => utmKm(...destination(hv.lat, hv.lng, radius, k * 5)));
      base += `<path class="ring" d="M${ring.map((p) => `${f2(X(p))},${f2(Y(p))}`).join("L")}Z"/>`;
    }
    // Pins are drawn in screen pixels around (0,0) and scaled on zoom.
    let pins = "";
    const pin = (p, inner, cls = "") => `<g class="pin ${cls}" data-x="${f2(X(p))}" data-y="${f2(Y(p))}">${inner}</g>`;
    if (L) {
      for (const d of L.districts) if (d.name !== "Wokha") pins += pin([d.ce, d.cn], `<text class="dname" text-anchor="middle">${esc(d.name.toUpperCase())}</text>`, "dlabel");
      for (const c of L.contourLabels) pins += pin([c.e, c.n], `<text class="clabel" text-anchor="middle" y="3">${esc(c.text)}</text>`, "clab");
      for (const pk of L.peaks) pins += pin([pk.e, pk.n], `<path class="peak" d="M0,-7 L6,4 L-6,4Z"/><text class="plabel" text-anchor="middle" y="17">${esc(pk.name || "")}</text><text class="plabel elev" text-anchor="middle" y="29">${pk.elev.toLocaleString("en-IN")} m</text>`);
    }
    V.forEach((v, k) => {
      const isHome = v.name === home;
      pins += pin(vp[k], `<circle class="vdot${isHome ? " home" : ""}${v.verified ? "" : " unv"}" r="${isHome ? 6 : 4.5}"/><text class="vlabel${isHome ? " home" : ""}" x="9" y="4">${esc(v.name)}</text><title>${esc(v.name)}: ${esc(v.verified ? v.source : "position not verified")}</title>`, "vpin");
    });
    const dirs = state.meta.directions;
    incidents.forEach((i, k) => {
      const r = 7 + Math.min(i.herd_size || 0, 20) * 0.35;
      let arrow = "";
      if (i.heading) {
        const a = dirs.indexOf(i.heading) * 45 * Math.PI / 180, s0 = r + 2, s1 = r + 24;
        arrow = `<line class="heading" marker-end="url(#arrow-${box.dataset.map})" x1="${(Math.sin(a) * s0).toFixed(1)}" y1="${(-Math.cos(a) * s0).toFixed(1)}" x2="${(Math.sin(a) * s1).toFixed(1)}" y2="${(-Math.cos(a) * s1).toFixed(1)}"/>`;
      }
      const label = `${i.type_label}, ${i.severity_label} severity, near ${i.village}, ${ago(i.created_at)}`;
      pins += pin(ip[k], `${arrow}<a href="#/case/${i.id}" aria-label="${esc(label)}"><title>${esc(label)}</title><circle class="inc ${esc(i.severity)}${i.id === focus ? " focus" : ""}" r="${r.toFixed(1)}"/></a>`, "ipin");
    });
    base += `<g class="pins">${pins}</g>`;
    svg.innerHTML = base;
    const attrib = $("[data-attrib]", box);
    if (attrib) attrib.textContent = L ? "UTM zone 46N grid, km. " + L.attribution.join(". ") + ". Mount Tiyi height from SRTM." : "Base map unavailable; showing villages and incidents only.";

    // -- view: x, y = top-left corner, w = width, all in km --------------
    const pinEls = $$(".pin", svg).map((g) => ({ g, x: +g.dataset.x, y: +g.dataset.y }));
    const gridG = $(".grid", svg);
    let view = null;
    const aspect = () => (frame.clientHeight || 300) / (frame.clientWidth || 400);
    function fit() {
      const pts = [...(incidents.length ? ip : []), ...(hv ? [utmKm(hv.lat, hv.lng)] : [])];
      if (hv && radius) { const c = utmKm(hv.lat, hv.lng); pts.push([c[0] - radius, c[1] - radius], [c[0] + radius, c[1] + radius]); }
      if (!pts.length || (focus && ip.length === 1 && !radius)) pts.push(...(focus ? [[ip[0][0] - 4, ip[0][1] - 4], [ip[0][0] + 4, ip[0][1] + 4]] : vp));
      const xs = pts.map(X), ys = pts.map(Y);
      let w = Math.max(8, Math.max(...xs) - Math.min(...xs) + 3), h = Math.max(...ys) - Math.min(...ys) + 3;
      w = Math.max(w, h / aspect());
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      set({ x: cx - w / 2, y: cy - (w * aspect()) / 2, w });
    }
    function set(v) {
      const maxW = Math.max(W, H / aspect()) * 1.02;
      const w = Math.min(maxW, Math.max(1.5, v.w)), h = w * aspect();
      const x = w >= W ? (W - w) / 2 : Math.min(Math.max(v.x, -w * 0.1), W - w * 0.9);
      const y = h >= H ? (H - h) / 2 : Math.min(Math.max(v.y, -h * 0.1), H - h * 0.9);
      view = { x, y, w };
      svg.setAttribute("viewBox", `${x.toFixed(3)} ${y.toFixed(3)} ${w.toFixed(3)} ${h.toFixed(3)}`);
      const k = w / (frame.clientWidth || 400); // km per screen pixel
      for (const p of pinEls) p.g.setAttribute("transform", `translate(${p.x} ${p.y}) scale(${k.toFixed(5)})`);
      svg.classList.toggle("far", w > 30);
      svg.classList.toggle("mid", w > 9 && w <= 30);
      // grid every 1, 2, 5, 10 or 20 km so 3–8 lines cross the view
      const step = [1, 2, 5, 10, 20].find((s) => w / s <= 8) || 20;
      let g = "";
      for (let gx = Math.ceil((e0 + x) / step) * step; gx <= e0 + x + w; gx += step) {
        const sx = gx - e0;
        g += `<line x1="${sx}" y1="${y}" x2="${sx}" y2="${y + h}"/><text x="${sx + 3 * k}" y="${y + 12 * k}" font-size="${(10 * k).toFixed(4)}">${gx}E</text>`;
      }
      for (let gy = Math.ceil((n1 - y - h) / step) * step; gy <= n1 - y; gy += step) {
        const sy = n1 - gy;
        g += `<line x1="${x}" y1="${sy}" x2="${x + w}" y2="${sy}"/><text x="${x + 3 * k}" y="${sy - 3 * k}" font-size="${(10 * k).toFixed(4)}">${gy}N</text>`;
      }
      gridG.innerHTML = g;
      svg.style.setProperty("--gs", `${(3 * k).toFixed(4)}px`);
      // scale bar: a round distance near 90 px
      const target = 90 * k, nice = [0.25, 0.5, 1, 2, 5, 10, 20, 50].find((s) => s >= target * 0.6) || 50;
      const sb = $(".scalebar", box);
      $("i", sb).style.width = `${(nice / k).toFixed(0)}px`;
      $("span", sb).textContent = nice < 1 ? `${nice * 1000} m` : `${nice} km`;
    }
    const zoomAt = (factor, px, py) => {
      const r = frame.getBoundingClientRect();
      const fx = px === undefined ? 0.5 : (px - r.left) / r.width, fy = py === undefined ? 0.5 : (py - r.top) / r.height;
      const w = view.w * factor, h0 = view.w * aspect();
      set({ x: view.x + fx * (view.w - w), y: view.y + fy * (h0 - w * aspect()), w });
    };
    $(".mapctl", box).onclick = (e) => {
      const b = e.target.closest("[data-z]");
      if (!b) return;
      if (b.dataset.z === "fit") fit(); else zoomAt(b.dataset.z === "in" ? 0.6 : 1 / 0.6);
    };
    frame.addEventListener("wheel", (e) => {
      if (!e.ctrlKey && document.activeElement !== frame) return; // let the page scroll
      e.preventDefault();
      zoomAt(Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX, e.clientY);
    }, { passive: false });
    frame.addEventListener("dblclick", (e) => { e.preventDefault(); zoomAt(0.5, e.clientX, e.clientY); });
    frame.addEventListener("keydown", (e) => {
      const k = view.w / 6, map = { "+": () => zoomAt(0.7), "=": () => zoomAt(0.7), "-": () => zoomAt(1 / 0.7), "0": fit,
        ArrowLeft: () => set({ ...view, x: view.x - k }), ArrowRight: () => set({ ...view, x: view.x + k }),
        ArrowUp: () => set({ ...view, y: view.y - k }), ArrowDown: () => set({ ...view, y: view.y + k }) };
      if (map[e.key]) { e.preventDefault(); map[e.key](); }
    });
    // Mouse drag pans; on touch screens one finger scrolls the page and two
    // fingers pinch-zoom and pan the map.
    const pts = new Map();
    let last = null, moved = 0;
    svg.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // Capture only for a pinch here; a mouse is captured once it really
      // drags, so a plain click still reaches incident links.
      if (pts.size === 2) for (const id of pts.keys()) svg.setPointerCapture(id);
      last = null; moved = 0;
    });
    svg.addEventListener("pointermove", (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (e.pointerType !== "mouse" && pts.size < 2) return;
      const ps = [...pts.values()];
      const cx = ps.reduce((s, p) => s + p.x, 0) / ps.length, cy = ps.reduce((s, p) => s + p.y, 0) / ps.length;
      const span = ps.length > 1 ? Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) : 0;
      if (last) {
        const k = view.w / frame.clientWidth;
        moved += Math.abs(cx - last.cx) + Math.abs(cy - last.cy);
        if (moved > 6 && e.pointerType === "mouse" && !svg.hasPointerCapture(e.pointerId)) svg.setPointerCapture(e.pointerId);
        set({ ...view, x: view.x - (cx - last.cx) * k, y: view.y - (cy - last.cy) * k });
        if (span && last.span) zoomAt(last.span / span, cx, cy);
      }
      last = { cx, cy, span };
    });
    const up = (e) => { pts.delete(e.pointerId); last = null; };
    svg.addEventListener("pointerup", up);
    svg.addEventListener("pointercancel", up);
    svg.addEventListener("click", (e) => { if (moved > 6) { e.preventDefault(); e.stopPropagation(); } }, true);
    new ResizeObserver(() => view && set(view)).observe(frame);
    fit();
  }

  function incidentItem(i, extra = "") {
    return `<a class="item stripe ${esc(i.severity)}" href="#/case/${i.id}">
      <h3>${esc(i.type_label)}${i.herd_size ? ` <span class="muted small tnum">· ${plural(i.herd_size, "elephant")}</span>` : ""}</h3>
      ${sevPill(i.severity, i.severity_label)}
      <div class="meta"><span>${extra || esc(i.village)}</span><span>${ago(i.created_at)}</span><span>${esc(i.status_label)}</span><span class="mono">${esc(i.ref)}</span></div>
    </a>`;
  }

  // -- auth screens -------------------------------------------------------
  function authShell(content) {
    app.innerHTML = `<div class="shell"><main id="main" tabindex="-1">${content}</main></div>`;
    return $("#main");
  }

  function viewLogin() {
    const demo = state.meta.demo_accounts;
    const main = authShell(`
      <div class="hero">
        <div class="row between"><div class="row">${MARK}<b class="label">HatiAlert · Wokha</b></div>${langPicker("lang-login")}</div>
        <h1>See elephants? Warn your village in a minute.</h1>
        <p class="muted">Report sightings and crop raids, follow what the forest staff do about them, and get warnings for your village.</p>
      </div>
      <form class="card" id="login" novalidate>
        <h2>Sign in</h2>
        <label class="field" data-field="phone"><span>Mobile number</span><input id="login-phone" type="tel" inputmode="numeric" autocomplete="tel" placeholder="98765 43210" required></label>
        <label class="field" data-field="pin"><span>PIN</span><input id="login-pin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="6" required></label>
        <div data-errors></div>
        <button class="btn primary big" type="submit">Sign in</button>
        <p class="small muted">New here? <a href="#/register">Create an account</a></p>
        <p class="small muted"><a href="#/forgot">Forgot your PIN?</a></p>
      </form>
      ${demo.length ? `<section class="card"><div class="stack"><h2>Try a demo account</h2><p class="small muted">Each role sees a different app. Tap one to fill in the form.</p></div>
        <div class="demo">${demo.map((d) => `<button type="button" data-phone="${esc(d.phone)}" data-pin="${esc(d.pin)}"><b>${esc(roleName[d.role])}</b><span class="mono muted">PIN ${esc(d.pin)}</span><span class="small muted">${esc(d.name)} · ${esc(d.village)}</span><span class="mono small muted">${esc(d.phone)}</span></button>`).join("")}</div></section>` : ""}`);
    bindLangPicker(main, "lang-login");
    const form = $("#login", main);
    $$(".demo button", main).forEach((b) => (b.onclick = () => { $("#login-phone").value = b.dataset.phone; $("#login-pin").value = b.dataset.pin; form.requestSubmit(); }));
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = $("button[type=submit]", form);
      btn.disabled = true;
      try {
        const res = await api("POST", "/api/auth/login", { phone: $("#login-phone").value, pin: $("#login-pin").value });
        signIn(res);
      } catch (err) { showErrors(form, err); btn.disabled = false; }
    };
  }

  function viewRegister() {
    const main = authShell(`
      <div class="pagehead"><a href="#/login" class="small">← Sign in</a><h1>Create an account</h1><p class="muted">Your village sets which warnings you get.</p></div>
      <form class="card" id="reg" novalidate>
        <label class="field" data-field="name"><span>Full name</span><input id="reg-name" type="text" autocomplete="name" maxlength="60" required></label>
        <label class="field" data-field="phone"><span>Mobile number</span><input id="reg-phone" type="tel" inputmode="numeric" autocomplete="tel" required></label>
        ${state.meta.sms_enabled ? `<div class="field" data-field="code"><span>Code from the text message</span><div class="row"><input id="reg-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" class="grow"><button type="button" class="btn" id="reg-send">Send code</button></div><small id="reg-code-note">We text a 6-digit code to check the number is yours.</small></div>` : ""}
        <label class="field" data-field="village"><span>Village</span><select id="reg-village">${state.meta.villages.map((v) => `<option>${esc(v.name)}</option>`).join("")}</select></label>
        <div class="grid2">
          <label class="field" data-field="pin"><span>Choose a PIN</span><input id="reg-pin" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"><small>4 to 6 digits</small></label>
          <label class="field" data-field="pin2"><span>Repeat PIN</span><input id="reg-pin2" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"></label>
        </div>
        <div data-errors></div>
        <button class="btn primary big" type="submit">Create account</button>
        <p class="small muted">New accounts start as villagers. Forest staff accounts are set up by the forest office.</p>
      </form>`);
    const form = $("#reg", main);
    const send = $("#reg-send", main);
    if (send) send.onclick = async () => {
      try { const r = await api("POST", "/api/auth/otp", { phone: $("#reg-phone").value, purpose: "register" }); $("#reg-code-note").textContent = r.message; $("#reg-code").focus(); }
      catch (err) { showErrors(form, err); }
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      if ($("#reg-pin").value !== $("#reg-pin2").value) return showErrors(form, new ApiErr(400, "The two PINs don't match.", "pin2"));
      try {
        signIn(await api("POST", "/api/auth/register", { name: $("#reg-name").value, phone: $("#reg-phone").value, village: $("#reg-village").value, pin: $("#reg-pin").value, code: $("#reg-code")?.value }));
        toast("Account created");
      } catch (err) { showErrors(form, err); }
    };
  }

  function viewForgot() {
    const sms = state.meta.sms_enabled;
    const main = authShell(`
      <div class="pagehead"><a href="#/login" class="small">← Sign in</a><h1>Forgot your PIN?</h1></div>
      ${sms ? `<form class="card" id="fg" novalidate>
        <p class="muted">We'll text you a code, then you choose a new PIN.</p>
        <label class="field" data-field="phone"><span>Mobile number</span><input id="fg-phone" type="tel" inputmode="numeric" autocomplete="tel"></label>
        <div><button type="button" class="btn" id="fg-send">Send code</button> <small id="fg-note" class="muted"></small></div>
        <label class="field" data-field="code"><span>Code from the text message</span><input id="fg-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></label>
        <div class="grid2">
          <label class="field" data-field="pin"><span>New PIN</span><input id="fg-pin" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"><small>4 to 6 digits</small></label>
          <label class="field" data-field="pin2"><span>Repeat PIN</span><input id="fg-pin2" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"></label>
        </div>
        <div data-errors></div>
        <button class="btn primary big" type="submit">Save new PIN</button>
      </form>` : `<section class="card"><p>Ask a forest officer or forest guard to reset your PIN. They will give you a temporary PIN, and you choose a new one when you sign in.</p>
        <p class="small muted">Text-message codes aren't set up on this server yet.</p></section>`}`);
    const form = $("#fg", main);
    if (!form) return;
    $("#fg-send", main).onclick = async () => {
      try { const r = await api("POST", "/api/auth/otp", { phone: $("#fg-phone").value, purpose: "reset" }); $("#fg-note").textContent = r.message; }
      catch (err) { showErrors(form, err); }
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      if ($("#fg-pin").value !== $("#fg-pin2").value) return showErrors(form, new ApiErr(400, "The two PINs don't match.", "pin2"));
      try { signIn(await api("POST", "/api/auth/reset", { phone: $("#fg-phone").value, code: $("#fg-code").value, pin: $("#fg-pin").value })); toast("New PIN saved"); }
      catch (err) { showErrors(form, err); }
    };
  }

  const pinForm = (id, temp) => `
    <form class="card" id="${id}" novalidate>
      <h2>${temp ? "Choose your own PIN" : "Change PIN"}</h2>
      ${temp ? '<p class="muted">You signed in with a temporary PIN. Choose a new one that only you know.</p>' : ""}
      <label class="field" data-field="old_pin"><span>${temp ? "Temporary PIN" : "Current PIN"}</span><input id="${id}-old" type="password" inputmode="numeric" maxlength="6" autocomplete="current-password"></label>
      <div class="grid2">
        <label class="field" data-field="pin"><span>New PIN</span><input id="${id}-new" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"><small>4 to 6 digits, not 1111 or 1234</small></label>
        <label class="field" data-field="pin2"><span>Repeat PIN</span><input id="${id}-new2" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"></label>
      </div>
      <div data-errors></div>
      <div><button class="btn primary" type="submit">Save new PIN</button></div>
    </form>`;
  function bindPinForm(root, id, done) {
    const form = $("#" + id, root);
    form.onsubmit = async (e) => {
      e.preventDefault();
      if ($(`#${id}-new`).value !== $(`#${id}-new2`).value) return showErrors(form, new ApiErr(400, "The two PINs don't match.", "pin2"));
      try {
        state.user = await api("POST", "/api/me/pin", { old_pin: $(`#${id}-old`).value, pin: $(`#${id}-new`).value });
        saveMe(state.user);
        toast("New PIN saved");
        done();
      } catch (err) { showErrors(form, err); }
    };
  }
  function viewNewPin() {
    const main = authShell(`<div class="pagehead"><div class="row">${MARK}<b class="label">HatiAlert</b></div></div>${pinForm("np", true)}
      <p class="small muted"><button type="button" class="linkbtn" id="np-out">Sign out</button></p>`);
    bindPinForm(main, "np", () => { location.hash = "#/home"; router(); });
    $("#np-out", main).onclick = async () => { try { await api("POST", "/api/auth/logout"); } catch { /* ok */ } signOutLocal(); router(); };
  }

  function signIn({ token, user }) {
    state.token = token; state.user = user;
    store.set("hatialert.token", token);
    saveMe(user);
    location.hash = user.must_change_pin ? "#/new-pin" : "#/home";
    router();
    flushQueue();
  }
  function signOutLocal() {
    clearCache();
    state.token = null; state.user = null;
    store.set("hatialert.token", null);
    location.hash = "#/login";
  }

  // -- home --------------------------------------------------------------
  async function viewHome() {
    const main = loading("home");
    let o, open;
    try { [o, open] = await Promise.all([api("GET", "/api/overview"), api("GET", "/api/incidents?status=open")]); }
    catch (err) { return failure(main, err); }
    const w = o.warning;
    main.innerHTML = `
      ${w ? `<a class="warning" href="#/alerts"><span class="label">Elephant warning · ${esc(o.village.name)}</span><p translate="no">${esc(w.message)}</p><span class="small muted">${ago(w.sent_at)}${w.by ? ` · ${esc(w.by)}` : ""}</span></a>` : ""}
      <div class="pagehead"><span class="label">Within ${o.radius_km} km of ${esc(o.village.name)}</span>
        <h1>${o.nearby.length ? `${plural(o.nearby.length, "open incident")} near you` : "No open incidents near you"}</h1></div>
      ${o.nearby.length ? `<section class="card flush divide">${o.nearby.slice(0, 5).map((i) => incidentItem(i, `<b>${i.km} km ${esc(i.dir)} of ${esc(o.village.name)}</b>`)).join("")}</section>`
        : `<p class="muted">${o.open_total ? `${plural(o.open_total, "open incident")} elsewhere in the district.` : "All quiet across the district."} You'll see new reports here.</p>`}
      <div class="notice" id="queue-note" hidden><span>Waiting to send: <b data-count></b>. They go automatically when you're back online.</span><button class="btn small" id="flush">Send now</button></div>
      <div class="grid2"><a class="btn primary big" href="#/report">${icon("report")} Report elephants</a><a class="btn big" href="#/report/camera">${icon("camera")} Snap a photo and report</a></div>
      <section class="card flush">${mapBlock({ incidents: open, home: o.village.name, radius: o.radius_km })}</section>
      ${isStaff() ? `<div class="kpis"><div class="kpi"><small>Open in district</small><b>${o.open_total}</b></div><div class="kpi"><small>Waiting for a check</small><b>${o.awaiting_check}</b></div><div class="kpi"><small>Reported in 24 h</small><b>${o.reported_24h}</b></div></div>` : ""}
      ${o.has_sample && state.user.role === "officer" ? `<div class="notice"><span>Sample incidents are loaded so you can try the app.</span><span class="confirm" id="sample"><button class="btn small" data-ask>Remove sample data</button></span></div>` : ""}`;
    mountMaps(main);
    $("#flush", main).onclick = () => flushQueue();
    flushQueue();
    notify.check();
    const sample = $("#sample", main);
    if (sample) {
      sample.onclick = async (e) => {
        if (e.target.matches("[data-ask]")) sample.innerHTML = `<span class="small">Delete all sample incidents and alerts?</span><button class="btn small danger" data-yes>Delete</button><button class="btn small" data-no>Keep</button>`;
        else if (e.target.matches("[data-no]")) sample.innerHTML = `<button class="btn small" data-ask>Remove sample data</button>`;
        else if (e.target.matches("[data-yes]")) { await api("DELETE", "/api/sample"); toast("Sample data removed"); viewHome(); }
      };
    }
  }

  // -- photos and voice notes --------------------------------------------
  // Live camera and microphone where the browser allows them; otherwise the
  // phone's own camera or recorder through a file input (capture=...).
  const live = { camera: !!navigator.mediaDevices?.getUserMedia, mic: !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder) };
  const dataUrl = (mime, b64) => `data:${mime};base64,${b64}`;
  const kb = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1000)) + " KB");
  const blobToB64 = (blob) => new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1] || "");
    r.onerror = () => fail(r.error);
    r.readAsDataURL(blob);
  });

  function pickFile(accept, capture) {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = accept;
      if (capture) input.setAttribute("capture", capture);
      input.hidden = true;
      input.onchange = () => { resolve(input.files[0] || null); input.remove(); };
      input.addEventListener("cancel", () => { resolve(null); input.remove(); });
      document.body.append(input);
      input.click();
    });
  }

  // Shrink to at most 1600 px on the long side and re-encode as JPEG, so a
  // phone photo uploads as a few hundred KB on a weak connection.
  async function photoFromSource(source) {
    let img = source;
    if (source instanceof Blob) {
      try { img = await createImageBitmap(source); }
      catch {
        img = await new Promise((ok, fail) => {
          const el = new Image();
          el.onload = () => ok(el);
          el.onerror = () => fail(new ApiErr(415, "That photo couldn't be opened. Try a JPEG or PNG.", "attachments"));
          el.src = URL.createObjectURL(source);
        });
      }
    }
    const w = img.videoWidth || img.naturalWidth || img.width, h = img.videoHeight || img.naturalHeight || img.height;
    if (!w || !h) throw new ApiErr(415, "That photo couldn't be opened. Try a JPEG or PNG.", "attachments");
    const k = Math.min(1, 1600 / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * k); canvas.height = Math.round(h * k);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((ok) => canvas.toBlob(ok, "image/jpeg", 0.82));
    if (!blob) throw new ApiErr(415, "That photo couldn't be opened. Try a JPEG or PNG.", "attachments");
    const data = await blobToB64(blob);
    return { kind: "photo", mime: "image/jpeg", size: blob.size, data, url: dataUrl("image/jpeg", data) };
  }

  async function voiceFromBlob(blob) {
    const rule = state.meta.media.voice;
    if (blob.size > rule.max_bytes) throw new ApiErr(413, `Each voice note must be under ${rule.max_bytes / 1e6} MB.`, "attachments");
    const mime = (blob.type || "audio/webm").split(";")[0];
    const data = await blobToB64(blob);
    return { kind: "voice", mime, size: blob.size, data, url: dataUrl(mime, data) };
  }

  // Full-screen live camera. Resolves a photo item, or null when closed.
  // Rejects when the camera can't be opened, so the caller can fall back.
  async function liveCamera() {
    let facing = "environment", stream;
    const open = async () => {
      stream?.getTracks().forEach((t) => t.stop());
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false });
      video.srcObject = stream;
      await video.play().catch(() => {});
    };
    const box = document.createElement("div");
    box.className = "cam";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", "Camera");
    box.innerHTML = `<video playsinline muted autoplay></video><img alt="Photo you just took" hidden>
      <div class="cam-bar">
        <button type="button" class="cam-btn" data-close aria-label="Close camera">${icon("x")}</button>
        <button type="button" class="shutter" data-shoot aria-label="Take photo"></button>
        <button type="button" class="cam-btn" data-flip aria-label="Switch camera">${icon("flip")}</button>
      </div>
      <div class="cam-bar" hidden data-review>
        <button type="button" class="btn" data-retake>Retake</button>
        <button type="button" class="btn primary" data-use>Use photo</button>
      </div>`;
    const video = $("video", box), still = $("img", box);
    document.body.append(box);
    try { await open(); }
    catch (e) { box.remove(); throw e; }
    $("[data-shoot]", box).focus();
    return new Promise((resolve) => {
      let shot = null;
      const done = (val) => { stream?.getTracks().forEach((t) => t.stop()); box.remove(); document.removeEventListener("keydown", onKey); resolve(val); };
      const onKey = (e) => { if (e.key === "Escape") done(null); };
      document.addEventListener("keydown", onKey);
      const review = (on) => { video.hidden = on; still.hidden = !on; $$(".cam-bar", box)[0].hidden = on; $("[data-review]", box).hidden = !on; };
      box.onclick = async (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        if (b.matches("[data-close]")) done(null);
        else if (b.matches("[data-flip]")) { facing = facing === "environment" ? "user" : "environment"; open().catch(() => toast("Couldn't switch camera")); }
        else if (b.matches("[data-shoot]")) { shot = await photoFromSource(video); still.src = shot.url; review(true); $("[data-use]", box).focus(); }
        else if (b.matches("[data-retake]")) { shot = null; review(false); }
        else if (b.matches("[data-use]")) done(shot);
      };
    });
  }

  async function takePhoto({ gallery = false } = {}) {
    if (!gallery && live.camera) {
      try { return await liveCamera(); }
      catch { live.camera = false; } // blocked here: use the phone's camera app from now on
    }
    const file = await pickFile("image/*", gallery ? null : "environment");
    return file ? photoFromSource(file) : null;
  }

  // Inline voice recorder. `onDone(item)` gets the finished note.
  function voiceRecorder(host, onDone) {
    const max = state.meta.media.voice_max_seconds;
    let rec = null, timer = null, started = 0;
    const idle = () => {
      clearInterval(timer);
      host.innerHTML = `<button type="button" class="btn" data-rec>${icon("mic")} Record voice note</button>`;
    };
    const fail = (msg) => { idle(); toast(msg); };
    async function start() {
      if (!live.mic) return fallback();
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
      catch { live.mic = false; return fallback(); }
      const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((t) => MediaRecorder.isTypeSupported?.(t));
      const chunks = [];
      rec = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : undefined);
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        clearInterval(timer);
        try { onDone(await voiceFromBlob(new Blob(chunks, { type: rec.mimeType || type || "audio/webm" }))); idle(); }
        catch (err) { fail(err.message); }
      };
      rec.start(250);
      started = Date.now();
      host.innerHTML = `<div class="recording" role="status"><span class="rec-dot" aria-hidden="true"></span><b class="tnum" data-time>0:00</b><span class="small muted">of ${max / 60}:00</span><button type="button" class="btn primary" data-stop>${icon("stop")} Stop and keep</button></div>`;
      $("[data-stop]", host).focus();
      timer = setInterval(() => {
        const s = Math.floor((Date.now() - started) / 1000);
        const t = $("[data-time]", host);
        if (t) t.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
        if (s >= max) rec.state === "recording" && rec.stop();
      }, 250);
    }
    async function fallback() {
      const file = await pickFile("audio/*", "user");
      if (!file) return;
      try { onDone(await voiceFromBlob(file)); } catch (err) { fail(err.message); }
    }
    host.addEventListener("click", (e) => {
      if (e.target.closest("[data-rec]")) start();
      else if (e.target.closest("[data-stop]") && rec?.state === "recording") rec.stop();
    });
    idle();
    return { stop: () => rec?.state === "recording" && rec.stop() };
  }

  // Photos first, then voice notes; k stays the item's index in `items`.
  const mediaTiles = (items, removable) => items.map((m, k) => [m, k]).sort((a, b) => (a[0].kind === "photo" ? 0 : 1) - (b[0].kind === "photo" ? 0 : 1)).map(([m, k]) => m.kind === "photo"
    ? `<figure class="thumb"><button type="button" class="thumb-open" data-view="${k}" aria-label="View photo ${k + 1}"><img alt="" ${m.url ? `src="${esc(m.url)}"` : ""} data-att="${m.id ?? ""}"></button>${removable ? `<button type="button" class="thumb-x" data-remove="${k}" aria-label="Remove photo">${icon("x")}</button>` : ""}</figure>`
    : `<div class="voice"><span class="ic" aria-hidden="true">${ICON_SVG("mic")}</span><audio controls preload="metadata" ${m.url ? `src="${esc(m.url)}"` : ""} data-att="${m.id ?? ""}" aria-label="Voice note ${k + 1}"></audio><span class="small muted tnum">${kb(m.size)}</span>${removable ? `<button type="button" class="btn small" data-remove="${k}">Remove</button>` : ""}</div>`).join("");

  function lightbox(src) {
    const box = document.createElement("div");
    box.className = "lightbox";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Photo");
    box.innerHTML = `<img alt="Report photo" src="${esc(src)}"><button type="button" class="cam-btn" aria-label="Close">${icon("x")}</button>`;
    const close = () => { box.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => e.key === "Escape" && close();
    box.onclick = close;
    document.addEventListener("keydown", onKey);
    document.body.append(box);
    $("button", box).focus();
  }

  // Load stored attachments into <img>/<audio> elements marked data-att.
  function hydrateMedia(root) {
    $$("[data-att]", root).forEach(async (el) => {
      if (!el.dataset.att || el.getAttribute("src")) return;
      try { const a = await api("GET", `/api/attachments/${el.dataset.att}`); el.src = dataUrl(a.mime, a.data); }
      catch { el.replaceWith(Object.assign(document.createElement("span"), { className: "small muted", textContent: "File unavailable" })); }
    });
  }

  // -- report ------------------------------------------------------------
  const DAMAGE_TYPES = ["crop_raid", "property_damage", "injury", "death"];
  async function viewReport(mode) {
    const m = state.meta;
    const f = { media: [], type: mode === "camera" ? "sighting" : "", herd_size: 1, village: state.user.village, offset_km: 0, offset_dir: "", heading: "", casualties: 0, crop_acres: "", property_inr: "", place: "", description: "", lat: null, lng: null };
    const main = shell("report", `
      <div class="pagehead"><h1>Report elephants</h1><p class="muted">Only "what happened" is required. Send it now and add detail if you can.</p></div>
      <form id="rep" class="stack" novalidate>
        <section class="card" data-field="type"><h2>What's happening?</h2>
          <div class="types">${m.types.map((t) => `<button type="button" class="type" data-type="${t.key}" aria-pressed="false"><b>${esc(t.label)}</b><small translate="no">${esc(isNag() ? t.label : t.local)}</small></button>`).join("")}</div></section>
        <section class="card" data-field="attachments"><h2>Photo and voice note</h2>
          <p class="small muted">Optional. Take photos only from a safe distance. Never go closer to a herd for a picture.</p>
          <div class="row"><button type="button" class="btn" id="rep-cam">${icon("camera")} Take photo</button><button type="button" class="btn" id="rep-gallery">${icon("image")} From gallery</button><span id="rep-voice"></span></div>
          <div class="thumbs" id="rep-media"></div></section>
        <section class="card" data-field="herd_size"><h2>How many elephants?</h2>
          <div class="row"><div class="stepper"><button type="button" data-step="-1" aria-label="One fewer">−</button><input id="rep-herd" type="number" min="0" max="200" value="1" aria-label="Number of elephants"><button type="button" data-step="1" aria-label="One more">+</button></div>
          <div class="chips">${[1, 3, 5, 10, 20].map((n) => `<button type="button" class="chip" data-herd="${n}">${n}${n === 20 ? "+" : ""}</button>`).join("")}</div></div>
          <small class="muted">A best guess is fine. Count calves too.</small></section>
        <section class="card"><h2>Where?</h2>
          <label class="field" data-field="village"><span>Nearest village</span><select id="rep-village">${m.villages.map((v) => `<option ${v.name === f.village ? "selected" : ""}>${esc(v.name)}</option>`).join("")}</select></label>
          <div class="field" data-field="offset_dir"><span>How far from the village, and which way?</span>
            <div class="row"><select id="rep-km" aria-label="Distance from village" class="grow"><option value="0">At the village</option>${[0.5, 1, 2, 3, 5, 8].map((k) => `<option value="${k}">${k} km away</option>`).join("")}</select></div>
            <div class="rose" id="rep-rose" aria-label="Direction from the village">${["NW", "N", "NE", "W", "", "E", "SW", "S", "SE"].map((d) => d ? `<button type="button" data-odir="${d}" aria-pressed="false">${d}</button>` : `<span class="centre" aria-hidden="true">village</span>`).join("")}</div></div>
          <div class="row"><button type="button" class="btn small" id="rep-gps">${icon("pin")} Use my GPS location instead</button><span id="rep-gps-note" class="small muted"></span></div>
          <label class="field"><span>Landmark <small>(optional)</small></span><input id="rep-place" type="text" maxlength="120" placeholder="e.g. paddy fields below the church"></label></section>
        <section class="card"><h2>Which way are they moving?</h2>
          <div class="chips" id="rep-heading">${["", ...m.directions].map((d) => `<button type="button" class="chip" data-heading="${d}" aria-pressed="${d === "" ? "true" : "false"}">${d || "Not moving / not sure"}</button>`).join("")}</div></section>
        <section class="card" id="rep-damage" hidden><h2>Damage and injuries</h2>
          <div class="grid2">
            <label class="field" data-field="casualties"><span>People hurt or killed</span><input id="rep-cas" type="number" min="0" max="50" value="0"></label>
            <label class="field" data-field="crop_acres"><span>Crops damaged (acres)</span><input id="rep-acres" type="number" min="0" step="0.1" placeholder="0"></label>
            <label class="field" data-field="property_inr"><span>Property loss (₹, estimate)</span><input id="rep-inr" type="number" min="0" step="500" placeholder="0"></label>
          </div></section>
        <section class="card"><label class="field" data-field="description"><span>Anything else? <small>(optional)</small></span><textarea id="rep-desc" maxlength="500" placeholder="Calves with the herd, which fields, who is at risk…"></textarea></label></section>
        <div data-errors></div>
        <div class="preview"><div class="row"><span class="small muted">Severity</span><span id="rep-sev"><span class="muted small">Choose what happened</span></span></div><button class="btn primary" type="submit" id="rep-send">Send report</button></div>
      </form>`);
    const form = $("#rep", main);
    let sevTimer;
    const sync = () => {
      $$("[data-type]", form).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.type === f.type)));
      $$("[data-odir]", form).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.odir === f.offset_dir)));
      $$("[data-heading]", form).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.heading === f.heading)));
      $("#rep-damage").hidden = !DAMAGE_TYPES.includes(f.type);
      $("#rep-rose").hidden = !(+$("#rep-km").value) || f.lat != null;
      clearTimeout(sevTimer);
      if (!f.type) return;
      sevTimer = setTimeout(async () => {
        try {
          const r = await api("POST", "/api/severity", { type: f.type, herd_size: $("#rep-herd").value || 0, casualties: $("#rep-cas").value || 0 });
          $("#rep-sev").innerHTML = sevPill(r.severity, r.label);
        } catch { /* field errors show on submit */ }
      }, 120);
    };
    form.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.type) f.type = b.dataset.type;
      else if (b.dataset.step) $("#rep-herd").value = Math.max(0, Math.min(200, (+$("#rep-herd").value || 0) + +b.dataset.step));
      else if (b.dataset.herd) $("#rep-herd").value = b.dataset.herd;
      else if (b.dataset.odir) f.offset_dir = b.dataset.odir;
      else if (b.dataset.heading !== undefined) f.heading = b.dataset.heading;
      else return;
      sync();
    });
    form.addEventListener("input", sync);
    const rule = m.media;
    const count = (kind) => f.media.filter((x) => x.kind === kind).length;
    const renderMedia = () => {
      $("#rep-media").innerHTML = mediaTiles(f.media, true);
      const full = count("photo") >= rule.photo.max_count;
      $("#rep-cam").disabled = full; $("#rep-gallery").disabled = full;
      $("#rep-voice").hidden = count("voice") >= rule.voice.max_count;
    };
    const addPhoto = async (opts) => {
      try { const p = await takePhoto(opts); if (p) { f.media.push(p); renderMedia(); toast("Photo added"); } }
      catch (err) { showErrors(form, err); }
    };
    $("#rep-cam").onclick = () => addPhoto();
    $("#rep-gallery").onclick = () => addPhoto({ gallery: true });
    const recorder = voiceRecorder($("#rep-voice"), (v) => { f.media.push(v); renderMedia(); toast("Voice note added"); });
    $("#rep-media").onclick = (e) => {
      const rm = e.target.closest("[data-remove]"), view = e.target.closest("[data-view]");
      if (rm) { f.media.splice(+rm.dataset.remove, 1); renderMedia(); }
      else if (view) lightbox(f.media[+view.dataset.view].url);
    };
    window.addEventListener("hashchange", () => recorder.stop(), { once: true });
    $("#rep-gps").onclick = () => {
      const note = $("#rep-gps-note");
      if (f.lat != null) { f.lat = f.lng = null; note.textContent = ""; $("#rep-gps").lastChild.textContent = " Use my GPS location instead"; return sync(); }
      if (!navigator.geolocation) { note.textContent = "This device can't share its location."; return; }
      note.textContent = "Finding you…";
      navigator.geolocation.getCurrentPosition(
        (p) => { f.lat = +p.coords.latitude.toFixed(5); f.lng = +p.coords.longitude.toFixed(5); note.textContent = `Using ${f.lat}, ${f.lng} (±${Math.round(p.coords.accuracy)} m)`; $("#rep-gps").lastChild.textContent = " Use village instead"; sync(); },
        () => { note.textContent = "Location isn't available here. Use the village and direction instead."; },
        { enableHighAccuracy: true, timeout: 10000 },
      );
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (!f.type) return showErrors(form, new ApiErr(400, "Choose what happened.", "type"));
      const body = {
        type: f.type, herd_size: $("#rep-herd").value, village: $("#rep-village").value,
        offset_km: $("#rep-km").value, offset_dir: f.offset_dir, heading: f.heading,
        casualties: $("#rep-cas").value, crop_acres: $("#rep-acres").value, property_inr: $("#rep-inr").value,
        place: $("#rep-place").value, description: $("#rep-desc").value,
      };
      if (!+body.offset_km) body.offset_dir = "";
      if (f.lat != null) Object.assign(body, { lat: f.lat, lng: f.lng });
      if (!DAMAGE_TYPES.includes(f.type)) Object.assign(body, { casualties: 0, crop_acres: 0, property_inr: 0 });
      if (f.media.length) body.attachments = f.media.map(({ kind, data }) => ({ kind, data }));
      body.client_id = f.client_id || (f.client_id = newClientId());
      $("#rep-send").disabled = true;
      $("#rep-send").textContent = f.media.length ? "Sending…" : "Send report";
      try {
        const inc = await api("POST", "/api/incidents", body);
        main.innerHTML = `
          <section class="card">
            <span class="label">Report sent</span>
            <h1>Thank you. Your report number is <span class="mono">${esc(inc.ref)}</span></h1>
            <div class="row">${sevPill(inc.severity, inc.severity_label + " severity")}<span class="muted"><span>${esc(inc.type_label)}</span> · <span translate="no">${esc(inc.village)}</span>${inc.attachments.length ? ` · <span>${plural(inc.attachments.filter((a) => a.kind === "photo").length, "photo")}, ${plural(inc.attachments.filter((a) => a.kind === "voice").length, "voice note")}</span>` : ""}</span></div>
            <p>A forest guard will check it. Keep this number for any compensation claim.</p>
            <p class="muted">Stay well away from the herd and warn your neighbours.</p>
            <div class="row"><a class="btn primary" href="#/case/${inc.id}">View report</a><a class="btn" href="#/home">Back to home</a></div>
          </section>`;
      } catch (err) {
        if (err.status === 0 && (await queue.add({ client_id: body.client_id, user_id: state.user.id, body, queued_at: Date.now() }))) {
          main.innerHTML = `<section class="card"><span class="label">Saved on this phone</span>
            <h1>No connection right now. Your report is saved.</h1>
            <p>It sends by itself when the phone is back online. You'll get a report number then.</p>
            <p class="muted">If people are in danger, phone the forest control room or 112 now.</p>
            <div class="row"><a class="btn primary" href="#/home">Back to home</a><a class="btn" href="#/guide">Emergency numbers</a></div></section>`;
          return;
        }
        showErrors(form, err); $("#rep-send").disabled = false; $("#rep-send").textContent = "Send report";
      }
    };
    sync();
    renderMedia();
    if (mode === "camera") addPhoto();
  }

  // -- cases -------------------------------------------------------------
  async function viewCases() {
    const staff = isStaff();
    const main = loading("cases");
    const qs = staff ? `status=${state.casesFilter}${state.casesVillage ? `&village=${encodeURIComponent(state.casesVillage)}` : ""}` : "mine=1&status=all";
    let rows;
    try { rows = await api("GET", "/api/incidents?" + qs); } catch (err) { return failure(main, err); }
    main.innerHTML = `
      <div class="pagehead"><h1>${staff ? "Cases" : "My reports"}</h1><p class="muted">${staff ? "Check new reports first. Oldest unchecked cases need attention." : "Follow what the forest staff are doing about your reports."}</p></div>
      ${staff ? `<div class="row between"><div class="seg" role="group" aria-label="Status">${[["open", "Open"], ["closed", "Closed"], ["all", "All"]].map(([k, l]) => `<button type="button" data-filter="${k}" aria-pressed="${state.casesFilter === k}">${l}</button>`).join("")}</div>
        <select id="cases-village" class="narrow" aria-label="Filter by village"><option value="">All villages</option>${state.meta.villages.map((v) => `<option ${v.name === state.casesVillage ? "selected" : ""}>${esc(v.name)}</option>`).join("")}</select></div>` : ""}
      <section class="card flush divide">${rows.length ? rows.map((i) => incidentItem(i)).join("") : `<div class="empty"><b>Nothing here</b><span>${staff ? "No cases match this filter." : "Reports you send will appear here."}</span>${staff ? "" : `<a class="btn primary" href="#/report">Report elephants</a>`}</div>`}</section>
      <p class="small muted tnum">${plural(rows.length, "case")}</p>`;
    $$("[data-filter]", main).forEach((b) => (b.onclick = () => { state.casesFilter = b.dataset.filter; viewCases(); }));
    const vs = $("#cases-village", main);
    if (vs) vs.onchange = () => { state.casesVillage = vs.value; viewCases(); };
  }

  async function viewCase(id) {
    const main = loading("cases");
    let i;
    try { i = await api("GET", `/api/incidents/${id}`); } catch (err) { return failure(main, err); }
    const staff = isStaff();
    const verbs = { verified: "Mark verified", responded: "Mark team responded", resolved: "Close as resolved", false_report: "Mark false report" };
    const facts = [
      ["Elephants", esc(i.herd_size || "Not given")],
      ["Heading", esc(i.heading || "Not given")],
      ["Village", esc(i.village)],
      ["Landmark", esc(i.place || "—")],
      ["Reported", esc(when(i.created_at))],
      ["Location", `<span class="mono">${i.lat.toFixed(4)}, ${i.lng.toFixed(4)}</span>`],
    ];
    if (i.casualties) facts.push(["People hurt", esc(i.casualties)]);
    if (i.crop_acres) facts.push(["Crops", esc(`${i.crop_acres} acres`)]);
    if (i.property_inr) facts.push(["Property loss", esc(inr(i.property_inr))]);
    if (i.reporter) facts.push(["Reported by", `${esc(i.reporter.name)}<br><span class="mono small">${esc(i.reporter.phone)}</span>${i.reporter.phone_verified ? "" : '<br><span class="tag">Phone not verified</span>'}`]);
    main.innerHTML = `
      <div class="pagehead"><a class="small" href="#/cases">← ${staff ? "Cases" : "My reports"}</a>
        <div class="row between"><h1>${esc(i.type_label)}</h1>${sevPill(i.severity, i.severity_label)}</div>
        <p class="muted"><span class="mono">${esc(i.ref)}</span> · ${esc(i.status_label)}${i.sample ? ' · <span class="tag">Sample</span>' : ""}</p></div>
      <section class="card flush">${mapBlock({ incidents: [i], home: state.user.village, focus: i.id })}</section>
      <section class="card"><dl class="facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
        ${i.description ? `<p translate="no">${esc(i.description)}</p>` : ""}</section>
      ${i.attachments_hidden ? `<p class="small muted">${plural(i.attachments_hidden, "photo or voice note", "photos or voice notes")}, seen only by the reporter and forest staff.</p>` : ""}
      ${i.attachments.length || i.can_attach ? `<section class="card" id="case-media"><h2>Photos and voice notes</h2>
        ${i.attachments.length ? `<div class="thumbs">${mediaTiles(i.attachments, false)}</div>` : '<p class="small muted">None yet.</p>'}
        ${i.can_attach ? `<div class="row"><button type="button" class="btn small" id="case-cam">${icon("camera")} Add photo</button><span id="case-voice"></span></div>` : ""}</section>` : ""}
      <section class="card"><h2>What has happened</h2>
        <ol class="timeline">${i.events.map((e, k) => `<li><span class="dot"></span><div><b>${k && e.status === i.events[k - 1].status ? "Update" : esc(e.status_label)}</b> <span class="small muted">${when(e.at)}${e.by ? ` · ${esc(e.by)}` : ""}</span>${e.note ? `<p translate="no">${esc(e.note)}</p>` : ""}</div></li>`).join("")}</ol></section>
      ${staff ? `<form class="card" id="act" novalidate><h2>Staff action</h2>
        <label class="field" data-field="note"><span>Note <small>(team sent, damage seen, advice given)</small></span><textarea id="act-note" maxlength="500"></textarea></label>
        <div data-errors></div>
        <div class="row">${i.next.map((s) => `<button type="button" class="btn ${s === "false_report" ? "" : "primary"}" data-status="${s}">${verbs[s]}</button>`).join("")}<button type="button" class="btn" data-status="">Add note only</button></div>
        ${i.open ? `<div class="row between split"><span class="small muted">Tell villages within 5 km.</span><button type="button" class="btn" id="warn">Warn nearby villages</button></div>` : ""}
      </form>` : ""}`;
    mountMaps(main);
    const mediaBox = $("#case-media", main);
    if (mediaBox) {
      hydrateMedia(mediaBox);
      mediaBox.addEventListener("click", (e) => {
        const view = e.target.closest("[data-view]");
        const img = view && $("img", view);
        if (img?.src) lightbox(img.src);
      });
      const upload = async (item) => {
        if (!item) return;
        try { await api("POST", `/api/incidents/${i.id}/attachments`, { kind: item.kind, data: item.data }); toast(item.kind === "photo" ? "Photo added" : "Voice note added"); viewCase(i.id); }
        catch (err) { toast(err.message); }
      };
      const cam = $("#case-cam", main);
      if (cam) {
        cam.onclick = async () => { try { upload(await takePhoto()); } catch (err) { toast(err.message); } };
        const rec = voiceRecorder($("#case-voice", main), upload);
        window.addEventListener("hashchange", () => rec.stop(), { once: true });
      }
    }
    const form = $("#act", main);
    if (!form) return;
    $$("[data-status]", form).forEach((b) => (b.onclick = async () => {
      try {
        await api("PATCH", `/api/incidents/${i.id}`, { status: b.dataset.status || null, note: $("#act-note").value });
        toast(b.dataset.status ? "Status updated" : "Note added");
        viewCase(i.id);
      } catch (err) { showErrors(form, err); }
    }));
    const warn = $("#warn", form);
    if (warn) warn.onclick = async () => {
      const near = await api("GET", `/api/incidents/${i.id}/villages?km=5`);
      const herd = i.herd_size ? `About ${plural(i.herd_size, "elephant")}` : "Elephants";
      const where = `near ${i.village}${i.place ? ` (${i.place})` : ""}`;
      state.prefill = {
        level: "warning", incident_id: i.id, villages: near.map((v) => v.name),
        message: `${herd} reported ${where}${i.heading ? `, moving ${i.heading}` : ""}. Keep away from the fields and stay indoors after dark.`,
      };
      location.hash = "#/alerts";
    };
  }

  // -- alerts ------------------------------------------------------------
  async function viewAlerts() {
    const main = loading("alerts");
    let list;
    try { list = await api("GET", "/api/alerts"); } catch (err) { return failure(main, err); }
    const pre = state.prefill;
    state.prefill = null;
    const m = state.meta, staff = isStaff();
    const compose = staff ? `
      <details class="card" id="compose-wrap" ${pre ? "open" : ""}><summary><b>Send an alert</b> <span class="small muted">to chosen villages</span></summary>
      <form id="compose" class="stack" novalidate>
        <div class="seg" role="group" aria-label="Alert type" data-field="level">${m.alert_levels.map((l) => `<button type="button" data-level="${l.key}" aria-pressed="${(pre?.level || "warning") === l.key}">${esc(l.label)}</button>`).join("")}</div>
        <div class="field" data-field="villages"><span>Villages</span><div class="chips">${m.villages.map((v) => `<button type="button" class="chip" data-v="${esc(v.name)}" aria-pressed="${!!pre?.villages.includes(v.name)}">${esc(v.name)}</button>`).join("")}</div></div>
        <label class="field" data-field="message"><span>Message</span><textarea id="compose-msg" maxlength="400" placeholder="What is happening, where, and what people should do">${esc(pre?.message || "")}</textarea><small class="tnum" id="compose-count"></small></label>
        <div data-errors></div>
        <div><button class="btn primary" type="submit">Send alert</button></div>
      </form></details>` : "";
    main.innerHTML = `
      <div class="pagehead"><h1>Alerts</h1><p class="muted">Warnings from forest staff. Alerts for ${esc(state.user.village)} are marked.</p></div>
      ${compose}
      <section class="card flush divide">${list.length ? list.map((a) => `
        <article class="item stripe ${a.level === "warning" ? "critical" : a.level === "all_clear" ? "low" : ""}">
          <h3>${esc(a.level_label)}${a.active ? ' <span class="sev sev-critical">Active</span>' : ""}</h3><span class="small muted">${ago(a.sent_at)}</span>
          <p class="full" translate="no">${esc(a.message)}</p>
          <div class="meta"><span class="chips">${a.villages.map((v) => `<span class="tag ${v === state.user.village ? "me" : ""}">${esc(v)}</span>`).join("")}</span>${a.by ? `<span>${esc(a.by)}</span>` : ""}${a.incident_id ? `<a href="#/case/${a.incident_id}">View case</a>` : ""}</div>
        </article>`).join("") : `<div class="empty"><b>No alerts yet</b><span>Warnings for your village will show here.</span></div>`}</section>`;
    const form = $("#compose", main);
    if (!form) return;
    const count = () => { $("#compose-count").textContent = `${$("#compose-msg").value.length} / 400`; };
    count();
    form.addEventListener("input", count);
    form.addEventListener("click", (e) => {
      const b = e.target.closest("button[type=button]");
      if (!b) return;
      if (b.dataset.level) $$("[data-level]", form).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      if (b.dataset.v) b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true"));
    });
    form.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const sent = await api("POST", "/api/alerts", {
          level: $("[data-level][aria-pressed=true]", form).dataset.level,
          villages: $$("[data-v][aria-pressed=true]", form).map((b) => b.dataset.v),
          message: $("#compose-msg").value, incident_id: pre?.incident_id ?? null,
        });
        const n = sent.sms ? sent.sms.recipients : 0;
        toast(!n ? "Alert sent" : sent.sms.mode === "manual" ? `Alert sent. ${plural(n, "person", "people")} to text by hand (Admin › Messages)` : `Alert sent. Texting ${plural(n, "person", "people")}`);
        viewAlerts();
      } catch (err) { showErrors(form, err); }
    };
  }

  // -- dashboard ---------------------------------------------------------
  function seriesChart(series) {
    const W = 420, H = 130, top = 12, bottom = 22, left = 22;
    const max = Math.max(1, ...series.map((d) => d.count));
    const bw = (W - left) / series.length;
    const y = (v) => top + (H - top - bottom) * (1 - v / max);
    const fmt = (d) => new Date(d + "T00:00:00+05:30").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
    const bars = series.map((d, k) => `<rect class="bar${d.count ? "" : " zero"}" x="${(left + k * bw + bw * 0.15).toFixed(1)}" y="${(d.count ? y(d.count) : H - bottom - 2).toFixed(1)}" width="${Math.max(1, bw * 0.7).toFixed(1)}" height="${(d.count ? H - bottom - y(d.count) : 2).toFixed(1)}"><title>${fmt(d.date)}: ${plural(d.count, "incident")}</title></rect>`).join("");
    const ticks = [0, Math.floor(series.length / 2), series.length - 1].map((k) => `<text x="${(left + k * bw + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="${k === 0 ? "start" : k === series.length - 1 ? "end" : "middle"}">${fmt(series[k].date)}</text>`).join("");
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Incidents per day"><line class="axis" x1="${left}" y1="${H - bottom}" x2="${W}" y2="${H - bottom}"/><line class="axis" x1="${left}" y1="${y(max)}" x2="${W}" y2="${y(max)}" stroke-dasharray="3 4"/><text x="${left - 6}" y="${y(max) + 4}" text-anchor="end">${max}</text><text x="${left - 6}" y="${H - bottom + 4}" text-anchor="end">0</text>${bars}${ticks}</svg>`;
  }
  const hbars = (rows) => {
    const max = Math.max(1, ...rows.map((r) => r.count));
    return `<div class="hbars">${rows.map((r) => `<div class="hbar"><span>${esc(r.label || r.name)}</span><svg viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true"><rect class="track" width="100" height="12" rx="3"/><rect class="fill" width="${((r.count / max) * 100).toFixed(1)}" height="12" rx="3"/></svg><b>${r.count}</b></div>`).join("")}</div>`;
  };

  async function viewDashboard() {
    if (state.user.role !== "officer") { location.hash = "#/home"; return; }
    const main = loading("more");
    let s;
    try { s = await api("GET", `/api/stats?days=${state.days}`); } catch (err) { return failure(main, err); }
    main.innerHTML = `
      <div class="pagehead"><a class="small" href="#/more">← More</a><h1>District overview</h1></div>
      <div class="row between"><div class="seg" role="group" aria-label="Period">${[7, 30, 90].map((d) => `<button type="button" data-days="${d}" aria-pressed="${state.days === d}">${d} days</button>`).join("")}</div><button class="btn small" id="csv">Export CSV</button></div>
      <div class="kpis">
        <div class="kpi"><small>Incidents</small><b>${s.total}</b><small>${s.open} still open</small></div>
        <div class="kpi"><small>Median time to respond</small><b>${s.median_response_h == null ? "—" : s.median_response_h + " h"}</b><small>across ${plural(s.responded_count, "case")}</small></div>
        <div class="kpi"><small>People hurt or killed</small><b>${s.casualties}</b><small>${s.false_reports} false ${s.false_reports === 1 ? "report" : "reports"}</small></div>
        <div class="kpi"><small>Recorded losses</small><b>${s.crop_acres} ac</b><small>crops · ${inr(s.property_inr)} property</small></div>
      </div>
      <section class="card"><h2>Incidents per day</h2>${seriesChart(s.series)}</section>
      <div class="grid2 wide">
        <section class="card"><h2>Hotspot villages</h2>${s.by_village.length ? hbars(s.by_village.slice(0, 8)) : '<p class="muted">No incidents in this period.</p>'}</section>
        <section class="card"><h2>What happened</h2>${hbars(s.by_type.filter((t) => t.count))}${s.total ? "" : '<p class="muted">No incidents in this period.</p>'}</section>
      </div>
      <section class="card"><h2>Severity</h2>${hbars(s.by_severity)}</section>
      <section class="card" id="csv-out" hidden></section>`;
    $$("[data-days]", main).forEach((b) => (b.onclick = () => { state.days = +b.dataset.days; viewDashboard(); }));
    $("#csv", main).onclick = async () => {
      const text = await api("GET", `/api/export.csv?days=${state.days}`);
      const out = $("#csv-out", main);
      out.hidden = false;
      out.innerHTML = `<div class="row between"><h2>CSV · last ${state.days} days</h2><div class="row">${transport.canDownload ? '<button class="btn small" id="csv-save">Download</button>' : ""}<button class="btn small" id="csv-copy">${icon("copy")} Copy</button></div></div><textarea class="csv" id="csv-text" readonly aria-label="CSV export"></textarea>`;
      $("#csv-text").value = text;
      $("#csv-copy").onclick = () => copy(text, $("#csv-text"));
      const save = $("#csv-save");
      if (save) save.onclick = () => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
        a.download = `hatialert-${state.days}d.csv`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      };
      out.scrollIntoView({ behavior: "smooth", block: "start" });
    };
  }

  async function copy(text, fallbackEl) {
    try { await navigator.clipboard.writeText(text); toast("Copied"); }
    catch { if (fallbackEl) { fallbackEl.focus(); fallbackEl.select?.(); } toast("Press Ctrl+C or long-press to copy"); }
  }

  // -- guide & more ------------------------------------------------------
  function viewGuide() {
    const { safety, contacts, compensation } = state.meta;
    const list = (items, mark) => `<ul class="stack plain">${items.map((i) => `<li class="row top"><b aria-hidden="true">${mark}</b><div class="grow"><p>${esc(i.text)}</p>${isNag() ? `<p class="small muted" translate="no"><i>${esc(i.text)}</i></p>` : i.local ? `<p class="small muted"><i>${esc(i.local)}</i></p>` : ""}</div></li>`).join("")}</ul>`;
    const main = shell("more", `
      <div class="pagehead"><a class="small" href="#/more">← More</a><h1>Safety and help</h1></div>
      <div class="grid2">
        <section class="card"><h2>Do</h2>${list(safety.do, "✓")}</section>
        <section class="card"><h2>Don't</h2>${list(safety.dont, "✕")}</section>
      </div>
      <section class="card flush divide"><div class="item"><h2>Emergency numbers</h2></div>${contacts.map((c, k) => `
        <div class="item"><h3>${esc(c.name)}</h3><button type="button" class="btn small" data-copy="${k}" aria-label="Copy ${esc(c.name)} number">${icon("copy")}</button>
          <div class="meta"><span class="mono">${esc(c.phone)}</span><span>${esc(c.role)}</span>${c.placeholder ? '<span class="tag">Placeholder, not a real line</span>' : ""}</div></div>`).join("")}</section>
      <section class="card"><h2>Compensation (ex-gratia)</h2>
        <dl class="facts">${compensation.rates.map((r) => `<div><dt>${esc(r.item)}</dt><dd>${esc(r.amount)}</dd></div>`).join("")}</dl>
        <p class="small muted">${esc(compensation.note)}</p>
        <div class="grid2"><div class="stack"><h3>How to claim</h3><ol class="stack indent">${compensation.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol></div>
        <div class="stack"><h3>Bring</h3><ul class="stack indent">${compensation.documents.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></div></div></section>`);
    $$("[data-copy]", main).forEach((b) => (b.onclick = () => copy(contacts[+b.dataset.copy].phone.replace(/\s/g, ""))));
  }

  function viewMore() {
    const u = state.user;
    const main = shell("more", `
      <div class="pagehead"><h1>${esc(u.name)}</h1><p class="muted">${esc(roleName[u.role])} · <span class="mono">${esc(u.phone)}</span>${u.phone_verified ? "" : ' · <span class="tag">Phone not verified</span>'}</p></div>
      <section class="card flush divide">
        ${u.role === "officer" ? `<a class="item" href="#/dashboard"><h3>District overview</h3><span class="muted">→</span><div class="meta">Trends, hotspots, response times, CSV export</div></a>
        <a class="item" href="#/admin"><h3>Admin</h3><span class="muted">→</span><div class="meta">People, villages, text messages, backups</div></a>` : ""}
        <a class="item" href="#/guide"><h3>Safety and help</h3><span class="muted">→</span><div class="meta">What to do, emergency numbers, compensation</div></a>
      </section>
      <section class="card"><h2 translate="no">${isNag() ? "Bhasa (Language)" : "Language (Bhasa)"}</h2>
        ${langPicker("lang-more")}
        ${isNag() ? `<p class="small muted" translate="no">Nagamese translation is a draft and has not been checked by a native speaker. Please tell the forest office about anything that reads wrong. / Etu Nagamese translation etiya kacha ase. Kiba bhul dikhile forest office ke kobi.</p>` : ""}
      </section>
      <section class="card"><h2 id="theme-h">Theme</h2>
        <div class="themes" role="radiogroup" aria-labelledby="theme-h">${THEMES.map((t) => `<button type="button" class="theme-opt" role="radio" data-skin-key="${t.key}" aria-checked="${currentTheme() === t.key}" tabindex="${currentTheme() === t.key ? 0 : -1}"><span class="swatch sw-${t.key}" aria-hidden="true"><i></i><i></i><i></i><i></i></span><b>${esc(t.label)}</b><small>${esc(t.note)}</small></button>`).join("")}</div>
      </section>
      <form class="card" id="prof" novalidate><h2>Your settings</h2>
        <label class="field" data-field="name"><span>Name</span><input id="prof-name" type="text" maxlength="60" value="${esc(u.name)}"></label>
        <div class="grid2">
          <label class="field" data-field="village"><span>Home village</span><select id="prof-village">${state.meta.villages.map((v) => `<option ${v.name === u.village ? "selected" : ""}>${esc(v.name)}</option>`).join("")}</select></label>
          <label class="field" data-field="radius_km"><span>Show incidents within</span><select id="prof-radius">${[1, 2, 3, 5, 8, 10, 15].map((k) => `<option value="${k}" ${k === u.radius_km ? "selected" : ""}>${k} km</option>`).join("")}</select></label>
        </div>
        <div data-errors></div>
        <div><button class="btn primary" type="submit">Save</button></div>
      </form>
      <section class="card"><h2>Alerts</h2>
        <label class="switch"><input type="checkbox" id="sms-on" ${u.sms_alerts ? "checked" : ""}><span>Text me alerts for ${esc(u.village)}</span></label>
        <small class="muted">${state.meta.sms_enabled ? "Sent to your mobile number as SMS." : "Forest staff send these by hand until text messages are set up."}</small>
        ${notify.supported ? `<label class="switch"><input type="checkbox" id="notify-on" ${notify.on() ? "checked" : ""}><span>Show alerts on this phone</span></label>
        <small class="muted">Works while HatiAlert is open or in the background. It can't wake a closed app, so keep text alerts on.</small>` : ""}
      </section>
      ${pinForm("cp", false)}
      <section class="card"><h2>Signed-in devices</h2>
        <p class="small muted">Lost a phone, or signed in on someone else's? Sign out everywhere except here.</p>
        <div class="confirm" id="logout-all"><button class="btn" data-ask>Sign out other devices</button></div>
      </section>
      <div class="row between"><button class="btn danger" id="out">Sign out</button><span class="small muted">Engine: ${esc(transport.engine)}</span></div>`);
    bindLangPicker(main, "lang-more");
    bindPinForm(main, "cp", () => viewMore());
    $("#sms-on", main).onchange = async (e) => {
      try { state.user = await api("PATCH", "/api/me", { sms_alerts: e.target.checked }); saveMe(state.user); toast(e.target.checked ? "Text alerts on" : "Text alerts off"); }
      catch (err) { e.target.checked = !e.target.checked; toast(err.message); }
    };
    const nOn = $("#notify-on", main);
    if (nOn) nOn.onchange = async () => {
      if (nOn.checked) {
        let perm = Notification.permission;
        try { if (perm === "default") perm = await Notification.requestPermission(); } catch { perm = "denied"; }
        if (perm !== "granted") { nOn.checked = false; toast("This browser won't show notifications here"); return; }
      }
      store.set("hatialert.notify", nOn.checked ? "1" : "0");
      toast(nOn.checked ? "Alerts will show on this phone" : "Phone alerts off");
      notify.check();
    };
    const la = $("#logout-all", main);
    la.onclick = async (e) => {
      if (e.target.matches("[data-ask]")) la.innerHTML = `<span class="small">Sign out every other phone and browser?</span><button class="btn small danger" data-yes>Sign them out</button><button class="btn small" data-no>Cancel</button>`;
      else if (e.target.matches("[data-no]")) la.innerHTML = `<button class="btn" data-ask>Sign out other devices</button>`;
      else if (e.target.matches("[data-yes]")) { try { await api("POST", "/api/me/logout-all"); toast("Other devices signed out"); } catch (err) { toast(err.message); } la.innerHTML = `<button class="btn" data-ask>Sign out other devices</button>`; }
    };
    const opts = $$("[data-skin-key]", main);
    const choose = (b, focus) => {
      store.set("hatialert.theme", b.dataset.skinKey);
      applyTheme(b.dataset.skinKey);
      opts.forEach((o) => { o.setAttribute("aria-checked", String(o === b)); o.tabIndex = o === b ? 0 : -1; });
      if (focus) b.focus();
    };
    opts.forEach((b, k) => {
      b.onclick = () => { choose(b); toast(`Theme: ${THEMES[k].label}`); };
      b.onkeydown = (e) => {
        const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        if (d) { e.preventDefault(); choose(opts[(k + d + opts.length) % opts.length], true); }
      };
    });
    const form = $("#prof", main);
    form.onsubmit = async (e) => {
      e.preventDefault();
      try {
        state.user = await api("PATCH", "/api/me", { name: $("#prof-name").value, village: $("#prof-village").value, radius_km: +$("#prof-radius").value });
        saveMe(state.user);
        toast("Saved");
        viewMore();
      } catch (err) { showErrors(form, err); }
    };
    $("#out", main).onclick = async () => { try { await api("POST", "/api/auth/logout"); } catch { /* already signed out */ } signOutLocal(); router(); };
  }

  // -- admin (officers) ----------------------------------------------------
  const roleOpts = (cur) => ["villager", "guard", "officer"].map((r) => `<option value="${r}" ${r === cur ? "selected" : ""}>${roleName[r]}</option>`).join("");
  async function viewAdmin(tab = "people") {
    if (state.user.role !== "officer") { location.hash = "#/home"; return; }
    const tabs = [["people", "People"], ["villages", "Villages"], ["messages", "Messages"], ["system", "System"]];
    const main = shell("more", `
      <div class="pagehead"><a class="small" href="#/more">← More</a><h1>Admin</h1></div>
      <div class="seg" role="group" aria-label="Admin sections">${tabs.map(([k, l]) => `<a class="segl" href="#/admin/${k}" ${k === tab ? 'aria-current="page"' : ""}>${l}</a>`).join("")}</div>
      <div id="admin-body" class="stack"><p class="muted">Loading…</p></div>`);
    const body = $("#admin-body", main);
    try {
      if (tab === "villages") await adminVillages(body);
      else if (tab === "messages") await adminMessages(body);
      else if (tab === "system") await adminSystem(body);
      else await adminPeople(body);
    } catch (err) {
      body.innerHTML = `<div class="card"><p>${esc(err.status === 404 ? "This needs the Python engine, which isn't running in this browser." : err.message)}</p></div>`;
    }
  }

  async function adminPeople(body) {
    body.innerHTML = `<div class="row"><input type="search" id="pp-q" class="grow" placeholder="Search name or phone" aria-label="Search people"><select id="pp-role" class="narrow" aria-label="Role"><option value="">Everyone</option>${roleOpts("").replace(' selected', "")}</select></div><section class="card flush divide" id="pp-list"></section><div id="pp-temp"></div>`;
    const list = $("#pp-list", body);
    const load = async () => {
      const q = encodeURIComponent($("#pp-q").value.trim()), r = $("#pp-role").value;
      const people = await api("GET", `/api/users?q=${q}&role=${r}`);
      list.innerHTML = people.length ? people.map((p) => `
        <div class="item" data-uid="${p.id}">
          <h3 translate="no">${esc(p.name)}</h3><span class="tag">${esc(roleName[p.role])}</span>
          <div class="meta"><span class="mono">${esc(p.phone)}</span><span translate="no">${esc(p.village)}</span>
            ${p.active ? "" : '<span class="tag">Switched off</span>'}${p.phone_verified ? "" : '<span class="tag">Phone not verified</span>'}
            ${p.failed_24h ? `<span class="tag">${plural(p.failed_24h, "wrong PIN")} today</span>` : ""}${p.last_seen ? `<span>Last seen ${ago(p.last_seen)}</span>` : ""}</div>
          <div class="full row pp-actions">
            <select data-role aria-label="Role">${roleOpts(p.role)}</select><button type="button" class="btn small" data-act="role">Save role</button>
            <button type="button" class="btn small" data-act="reset">Reset PIN</button>
            ${p.failed_24h ? '<button type="button" class="btn small" data-act="unlock">Unlock</button>' : ""}
            <button type="button" class="btn small ${p.active ? "danger" : ""}" data-act="active" data-on="${p.active ? 0 : 1}">${p.active ? "Switch off" : "Switch on"}</button>
          </div>
        </div>`).join("") : `<div class="empty"><b>No one found</b></div>`;
    };
    let t;
    $("#pp-q", body).oninput = () => { clearTimeout(t); t = setTimeout(() => load().catch((e) => toast(e.message)), 250); };
    $("#pp-role", body).onchange = () => load().catch((e) => toast(e.message));
    list.onclick = async (e) => {
      const b = e.target.closest("[data-act]");
      if (!b) return;
      const row = b.closest("[data-uid]"), uid = row.dataset.uid;
      try {
        if (b.dataset.act === "role") { await api("PATCH", `/api/users/${uid}`, { role: $("[data-role]", row).value }); toast("Role saved"); }
        if (b.dataset.act === "active") { await api("PATCH", `/api/users/${uid}`, { active: b.dataset.on === "1" }); toast(b.dataset.on === "1" ? "Account switched on" : "Account switched off"); }
        if (b.dataset.act === "unlock") { await api("POST", `/api/users/${uid}/unlock`); toast("Unlocked"); }
        if (b.dataset.act === "reset") {
          if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Tap again to reset"; return; }
          const r = await api("POST", `/api/users/${uid}/reset-pin`);
          $("#pp-temp", body).innerHTML = `<section class="card warning"><span class="label">Temporary PIN for <span translate="no">${esc(r.user.name)}</span></span><p class="bigpin mono">${esc(r.temp_pin)}</p><p class="small">Tell them in person or by phone call. They must choose a new PIN when they sign in. It isn't shown again.</p></section>`;
          $("#pp-temp", body).scrollIntoView({ behavior: "smooth", block: "center" });
        }
        await load();
      } catch (err) { toast(err.message); }
    };
    await load();
  }

  async function adminVillages(body) {
    const vs = await api("GET", "/api/villages");
    const unverified = vs.filter((v) => v.active && !v.verified).length;
    body.innerHTML = `
      ${unverified ? `<div class="notice"><span>${plural(unverified, "village position is", "village positions are")} not checked yet. Distances and alert areas depend on them.</span></div>` : ""}
      <section class="card flush divide">${vs.map((v) => `
        <div class="item" data-vid="${v.id}">
          <h3 translate="no">${esc(v.name)}</h3>${v.verified ? '<span class="tag me">Checked</span>' : '<span class="tag">Not checked</span>'}
          <div class="meta"><span class="mono">${v.lat.toFixed(5)}, ${v.lng.toFixed(5)}</span><span translate="no">${esc(v.source || "—")}</span><span>${plural(v.people, "person", "people")}</span><span>${plural(v.incidents, "incident")}</span>${v.active ? "" : '<span class="tag">Hidden</span>'}</div>
          <details class="full"><summary>Edit</summary>
            <form class="stack vform" novalidate>
              <div class="grid2"><label class="field" data-field="lat"><span>Latitude</span><input name="lat" type="text" inputmode="decimal" value="${v.lat}"></label>
                <label class="field" data-field="lng"><span>Longitude</span><input name="lng" type="text" inputmode="decimal" value="${v.lng}"></label></div>
              <label class="field" data-field="source"><span>Where the position comes from</span><input name="source" type="text" maxlength="120" value="${esc(v.source)}" placeholder="e.g. Survey of India sheet 83G/1, GPS by guard"></label>
              <label class="switch"><input type="checkbox" name="verified" ${v.verified ? "checked" : ""}><span>Position checked</span></label>
              <label class="switch"><input type="checkbox" name="active" ${v.active ? "checked" : ""}><span>Show in lists</span></label>
              <div data-errors></div><div><button class="btn primary small" type="submit">Save</button></div>
            </form></details>
        </div>`).join("")}</section>
      <form class="card" id="v-add" novalidate><h2>Add a village</h2>
        <label class="field" data-field="name"><span>Name</span><input name="name" type="text" maxlength="60"></label>
        <div class="grid2"><label class="field" data-field="lat"><span>Latitude</span><input name="lat" type="text" inputmode="decimal" placeholder="26.0972"></label>
          <label class="field" data-field="lng"><span>Longitude</span><input name="lng" type="text" inputmode="decimal" placeholder="94.2582"></label></div>
        <label class="field" data-field="source"><span>Where the position comes from</span><input name="source" type="text" maxlength="120"></label>
        <label class="switch"><input type="checkbox" name="verified"><span>Position checked</span></label>
        <div data-errors></div><div><button class="btn primary" type="submit">Add village</button></div></form>
      <form class="card" id="v-import" novalidate><h2>Import a list</h2>
        <p class="small muted">Paste CSV with a header row <span class="mono">name,lat,lng,source</span>, or choose a file. Names already on the list get the new position; all imported positions count as checked.</p>
        <input type="file" id="v-file" accept=".csv,text/csv,text/plain" aria-label="CSV file">
        <label class="field" data-field="csv"><span>CSV</span><textarea id="v-csv" class="csv" placeholder="name,lat,lng,source&#10;Lotsu,26.2500,94.1000,Census 2011"></textarea></label>
        <div data-errors></div><div><button class="btn primary" type="submit">Import</button></div><p id="v-result" class="small"></p></form>`;
    const refreshMeta = async () => { state.meta = await api("GET", "/api/meta"); };
    $$(".vform", body).forEach((f) => (f.onsubmit = async (e) => {
      e.preventDefault();
      const vid = f.closest("[data-vid]").dataset.vid, d = new FormData(f);
      try {
        await api("PATCH", `/api/villages/${vid}`, { lat: d.get("lat"), lng: d.get("lng"), source: d.get("source"), verified: !!d.get("verified"), active: !!d.get("active") });
        await refreshMeta(); toast("Village saved"); adminVillages(body);
      } catch (err) { showErrors(f, err); }
    }));
    $("#v-add", body).onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target, d = new FormData(f);
      try {
        await api("POST", "/api/villages", { name: d.get("name"), lat: d.get("lat"), lng: d.get("lng"), source: d.get("source"), verified: !!d.get("verified") });
        await refreshMeta(); toast("Village added"); adminVillages(body);
      } catch (err) { showErrors(f, err); }
    };
    $("#v-file", body).onchange = async (e) => { const file = e.target.files[0]; if (file) $("#v-csv").value = await file.text(); };
    $("#v-import", body).onsubmit = async (e) => {
      e.preventDefault();
      try {
        const r = await api("POST", "/api/villages/import", { csv: $("#v-csv").value });
        await refreshMeta();
        toast(`Imported: ${r.added} added, ${r.updated} updated`);
        await adminVillages(body);
        $("#v-result", body).textContent = r.skipped ? `Skipped ${plural(r.skipped, "line")} with a problem: ${r.skipped_lines.join(", ")}` : "";
      } catch (err) { showErrors(e.target, err); }
    };
  }

  async function adminMessages(body) {
    const box = await api("GET", "/api/outbox");
    const label = { queued: "Waiting", sent: "Sent", failed: "Failed", manual: "To send by hand" };
    body.innerHTML = `
      <div class="notice"><span>${box.mode === "manual" ? "Text messages aren't connected to an SMS service yet. Send these from a phone, then mark them sent." : "Alerts are texted automatically. Failed ones can be tried again."}</span></div>
      ${box.batches.length ? box.batches.map((b) => `
        <section class="card" data-batch="${b.alert_id}">
          <div class="row between"><h3>${esc(b.level_label)} · <span translate="no">${esc(b.villages.join(", "))}</span></h3><span class="small muted">${ago(b.sent_at)}</span></div>
          <p class="mono small msgtext" translate="no">${esc(b.text)}</p>
          <div class="chips">${Object.entries(b.counts).map(([k, n]) => `<span class="tag">${label[k] || k}: ${n}</span>`).join("")}</div>
          <div class="row"><button type="button" class="btn small" data-copy-text>${icon("copy")} Copy message</button><button type="button" class="btn small" data-copy-nums>${icon("copy")} Copy numbers</button>
            ${b.counts.manual ? '<button type="button" class="btn small primary" data-mark="sent">Mark all sent</button>' : ""}${b.counts.failed && box.mode !== "manual" ? '<button type="button" class="btn small" data-mark="queued">Try failed again</button>' : ""}</div>
          <details><summary>${plural(b.recipients.length, "person", "people")}</summary><ul class="plain stack small">${b.recipients.map((r) => `<li class="row between"><span translate="no">${esc(r.name || "—")} · ${esc(r.village || "")}</span><span class="mono">${esc(r.phone)}</span><span class="tag">${label[r.status] || r.status}</span></li>`).join("")}</ul></details>
        </section>`).join("") : `<div class="empty"><b>No alert messages yet</b><span>Each alert lists the people in those villages here.</span></div>`}`;
    body.onclick = async (e) => {
      const card = e.target.closest("[data-batch]");
      if (!card) return;
      const b = box.batches.find((x) => String(x.alert_id) === card.dataset.batch);
      if (e.target.closest("[data-copy-text]")) copy(b.text);
      if (e.target.closest("[data-copy-nums]")) copy(b.recipients.map((r) => "+91" + r.phone).join(", "));
      const m = e.target.closest("[data-mark]");
      if (m) {
        const want = m.dataset.mark, from = want === "sent" ? "manual" : "failed";
        try { await api("POST", "/api/outbox/mark", { ids: b.recipients.filter((r) => r.status === from).map((r) => r.id), status: want }); toast(want === "sent" ? "Marked sent" : "Trying again"); adminMessages(body); }
        catch (err) { toast(err.message); }
      }
    };
  }

  async function adminSystem(body) {
    const st = await api("GET", "/api/admin/status");
    const mb = (n) => (n / 1e6).toFixed(1) + " MB";
    const bk = st.system && st.system.backups;
    body.innerHTML = `
      <section class="card"><h2>Text messages</h2><p>${st.sms.enabled ? `Connected (${esc(st.sms.mode)}${st.sms.host ? `, ${esc(st.sms.host)}` : ""}).` : "Not connected. Alerts are listed under Messages for staff to send by hand, and sign-up codes are off."}</p>
        <div class="chips">${Object.entries(st.outbox).map(([k, n]) => `<span class="tag">${esc(k)}: ${n}</span>`).join("") || '<span class="small muted">No messages yet.</span>'}</div></section>
      <section class="card"><h2>Backups</h2>${bk && bk.dir ? `<p>Every ${bk.every_hours} h to <span class="mono">${esc(bk.dir)}</span>, keeping ${bk.keep}.</p><p class="small muted">${bk.last_at ? `Last backup ${ago(bk.last_at)}: <span class="mono">${esc(bk.last_path)}</span>` : "First backup is running."}${bk.error ? ` · Last error: ${esc(bk.error)}` : ""}</p>`
        : `<p>Automatic backups are off.</p><p class="small muted">Start the server with <span class="mono">--backup-dir /path/to/backups</span>, or run <span class="mono">python -m hatialert backup</span> on a schedule.${window.HATI_TRANSPORT ? " In this preview, data stays in this browser only." : ""}</p>`}</section>
      <section class="card"><h2>Storage</h2><dl class="facts"><div><dt>Database</dt><dd>${mb(st.storage.db_bytes)}</dd></div><div><dt>Photos and voice</dt><dd>${mb(st.storage.media_bytes)}</dd></div><div><dt>People</dt><dd>${st.storage.users}</dd></div><div><dt>Incidents</dt><dd>${st.storage.incidents}</dd></div></dl></section>
      <section class="card"><h2>Recent admin actions</h2>${st.audit.length ? `<ul class="plain stack small">${st.audit.map((a) => `<li><b>${esc(a.action.replace(/_/g, " "))}</b> <span class="muted">${ago(a.at)}${a.by ? ` · ${esc(a.by)}` : ""}</span><br><span translate="no">${esc(a.detail)}</span></li>`).join("")}</ul>` : '<p class="small muted">Nothing yet.</p>'}</section>`;
  }

  // -- router ------------------------------------------------------------
  async function router() {
    const [, page = "home", arg] = (location.hash || "#/home").split("/");
    if (!state.user) {
      if (page === "register") return viewRegister();
      if (page === "forgot") return viewForgot();
      return viewLogin();
    }
    window.scrollTo(0, 0);
    if (state.user.must_change_pin) return viewNewPin();
    switch (page) {
      case "admin": return viewAdmin(arg);
      case "report": return viewReport(arg);
      case "cases": return viewCases();
      case "case": return viewCase(arg);
      case "alerts": return viewAlerts();
      case "dashboard": return viewDashboard();
      case "guide": return viewGuide();
      case "more": return viewMore();
      default: return viewHome();
    }
  }

  async function boot() {
    app.innerHTML = `<div class="boot"><div>${MARK}<p id="boot-msg">Starting HatiAlert…</p></div></div>`;
    try {
      await transport.ready;
      state.meta = await api("GET", "/api/meta");
      state.token = store.get("hatialert.token");
      if (state.token) {
        try { state.user = await api("GET", "/api/me"); }
        catch (err) { if (err.status !== 0) { state.token = null; store.set("hatialert.token", null); } }
      }
    } catch (err) {
      app.innerHTML = `<div class="boot"><div class="stack"><h2>HatiAlert couldn't start</h2><p>${esc(err.message)}</p><div><button class="btn" id="reload">Reload</button></div></div></div>`;
      $("#reload").onclick = () => location.reload();
      return;
    }
    window.addEventListener("hashchange", router);
    router();
  }
  window.HATI_BOOT_MSG = (msg) => { const el = document.getElementById("boot-msg"); if (el) el.textContent = msg; };
  boot();
})();
