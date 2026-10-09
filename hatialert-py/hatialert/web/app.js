/* GENERATED from web-ts/src/main.ts by `npm run build` in web-ts/. Do not edit here: edit the TypeScript there. */
"use strict";
(() => {
  // src/dom.ts
  var SVG_NS = "http://www.w3.org/2000/svg";
  function setAttrs(el, attrs) {
    if (!attrs) return;
    for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (k === "on") {
        const on = v;
        for (const ev of Object.keys(on)) el["on" + ev] = on[ev];
      } else if (v === true) el.setAttribute(k, "");
      else if (v !== false && v != null) el.setAttribute(k, String(v));
    }
  }
  function add(parent, ...children) {
    let text = "";
    const flush = () => {
      if (text) {
        parent.appendChild(document.createTextNode(text));
        text = "";
      }
    };
    const walk = (c2) => {
      if (c2 == null || c2 === false || c2 === "") return;
      if (typeof c2 === "string" || typeof c2 === "number") text += c2;
      else if (Array.isArray(c2)) c2.forEach(walk);
      else {
        flush();
        parent.appendChild(c2);
      }
    };
    children.forEach(walk);
    flush();
  }
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    setAttrs(el, attrs);
    add(el, ...children);
    return el;
  }
  function s(tag, attrs, ...children) {
    const el = document.createElementNS(SVG_NS, tag);
    setAttrs(el, attrs);
    add(el, ...children);
    return el;
  }
  function frag(...children) {
    const f = document.createDocumentFragment();
    add(f, ...children);
    return f;
  }
  function fill(el, ...children) {
    el.replaceChildren(frag(...children));
  }
  function $(sel, root = document) {
    return root.querySelector(sel);
  }
  function $maybe(sel, root = document) {
    return root.querySelector(sel);
  }
  function $$(sel, root = document) {
    return [...root.querySelectorAll(sel)];
  }

  // src/state.ts
  var state = {
    /** Loaded at boot before any screen draws, so screens can rely on it. */
    meta: null,
    token: null,
    user: null,
    /** Filled by "Warn nearby villages" for the alert form. */
    prefill: null,
    casesFilter: "open",
    casesVillage: "",
    days: 30,
    /** When the network went away, or null when online. */
    offlineSince: null
  };
  function me() {
    if (!state.user) throw new Error("Not signed in");
    return state.user;
  }
  var isStaff = () => !!state.user && state.user.role !== "villager";
  var nav = { router: () => {
  } };

  // src/util.ts
  var store = {
    get(k) {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        if (v == null) localStorage.removeItem(k);
        else localStorage.setItem(k, v);
      } catch {
      }
    }
  };
  var plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
  var when = (ms) => new Date(ms).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  function ago(ms) {
    const s2 = Math.max(0, (Date.now() - ms) / 1e3);
    if (s2 < 60) return "just now";
    if (s2 < 3600) return `${Math.floor(s2 / 60)} min ago`;
    if (s2 < 86400) return `${Math.floor(s2 / 3600)} h ago`;
    if (s2 < 7 * 86400) return plural(Math.floor(s2 / 86400), "day") + " ago";
    return when(ms);
  }
  var inr = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");
  var kb = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1e3)) + " KB";
  var roleName = { villager: "Villager", guard: "Forest guard", officer: "Forest officer" };
  var ApiErr = class extends Error {
    constructor(status, message, field2) {
      super(message);
      this.status = status;
      this.field = field2;
    }
  };
  var asErr = (e) => e instanceof ApiErr ? e : new ApiErr(-1, e instanceof Error ? e.message : String(e));

  // src/api.ts
  var transport = window.HATI_TRANSPORT || {
    engine: "Python server",
    canDownload: true,
    ready: Promise.resolve(),
    async request(method, path, body, token) {
      const headers = {};
      if (body !== void 0) headers["Content-Type"] = "application/json";
      if (token) headers.Authorization = "Bearer " + token;
      const res = await fetch(path, { method, headers, body: body === void 0 ? void 0 : JSON.stringify(body) });
      return { status: res.status, type: res.headers.get("Content-Type") || "", body: await res.text() };
    }
  };
  var CACHEABLE = /^\/api\/(meta|me|overview|alerts|incidents(\?|$)|incidents\/\d+$)/;
  var cacheKey = (path) => "hatialert.cache:" + (path === "/api/meta" ? "pub" : (state.token || "-").slice(0, 16)) + ":" + path;
  var saveMe = (user) => {
    if (state.token && user) store.set(cacheKey("/api/me"), JSON.stringify({ at: Date.now(), data: user }));
  };
  function clearCache() {
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith("hatialert.cache:") && !k.startsWith("hatialert.cache:pub:")) localStorage.removeItem(k);
    } catch {
    }
  }
  async function api(method, path, body) {
    let res;
    try {
      res = await transport.request(method, path, body, state.token);
    } catch {
      if (method === "GET" && CACHEABLE.test(path)) {
        const hit = store.get(cacheKey(path));
        if (hit) {
          const { at, data: data2 } = JSON.parse(hit);
          setOffline(at);
          return data2;
        }
      }
      setOffline(state.offlineSince || Date.now());
      throw new ApiErr(0, "Can't reach HatiAlert. Check your connection and try again.");
    }
    if (state.offlineSince) setOffline(null);
    if (res.type.startsWith("text/csv")) return res.body;
    let data = {};
    try {
      data = JSON.parse(res.body || "{}");
    } catch {
    }
    if (res.status >= 400) {
      const e = data;
      if (res.status === 401 && state.token) signOutLocal();
      if (res.status === 403 && e.field === "pin" && state.user) {
        state.user.must_change_pin = true;
        location.hash = "#/new-pin";
      }
      throw new ApiErr(res.status, e.error || "Something went wrong.", e.field);
    }
    if (method === "GET" && CACHEABLE.test(path) && res.body.length < 4e5) store.set(cacheKey(path), JSON.stringify({ at: Date.now(), data }));
    return data;
  }
  function setOffline(at) {
    state.offlineSince = at;
    const bar = $maybe("#offline-bar");
    if (bar) {
      bar.hidden = !at;
      if (at) bar.textContent = `No connection. Showing what was saved at ${new Date(at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}.`;
    }
  }
  function signOutLocal() {
    clearCache();
    state.token = null;
    state.user = null;
    store.set("hatialert.token", null);
    location.hash = "#/login";
  }

  // src/icons.ts
  var p = (d) => ["path", { d }];
  var c = (cx, cy, r2) => ["circle", { cx, cy, r: r2 }];
  var r = (x, y, width, height, rx) => ["rect", { x, y, width, height, rx }];
  var ICON = {
    home: [p("M3 11.5 12 4l9 7.5"), p("M5.5 10v10h13V10")],
    report: [p("M12 5v14M5 12h14")],
    cases: [p("M9 6h11M9 12h11M9 18h11"), p("M4 6h.01M4 12h.01M4 18h.01")],
    alerts: [p("M6 9a6 6 0 0 1 12 0c0 6 2.5 8 2.5 8h-17S6 15 6 9"), p("M10 20.5a2 2 0 0 0 4 0")],
    more: [p("M4 7h16M4 12h16M4 17h16")],
    copy: [r(8, 8, 12, 12, 2), p("M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3")],
    pin: [p("M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"), c(12, 9.5, 2.5)],
    camera: [p("M3 8.5A2.5 2.5 0 0 1 5.5 6H7l2-2.5h6L17 6h1.5A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"), c(12, 12.5, 3.8)],
    mic: [r(9, 3, 6, 11, 3), p("M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21")],
    stop: [r(6.5, 6.5, 11, 11, 2)],
    x: [p("M6 6l12 12M18 6 6 18")],
    image: [r(3, 4, 18, 16, 2), c(9, 10, 2), p("m21 16-5-5-9 9")],
    flip: [p("M4.5 10A8 8 0 0 1 18 6.5L20 8.5M19.5 14A8 8 0 0 1 6 17.5L4 15.5"), p("M20 4.5v4h-4M4 19.5v-4h4")]
  };
  var iconSvg = (n) => s("svg", { viewBox: "0 0 24 24" }, ICON[n].map(([tag, attrs]) => s(tag, attrs)));
  var icon = (n) => h("span", { class: "ic", "aria-hidden": "true" }, iconSvg(n));
  var mark = () => s(
    "svg",
    { width: 30, height: 30, viewBox: "0 0 30 30", "aria-hidden": "true" },
    s("rect", { class: "mk-bg", width: 30, height: 30, rx: 8 }),
    s("circle", { class: "mk-dot", cx: 15, cy: 15, r: 3.2 }),
    s("circle", { class: "mk-ring", cx: 15, cy: 15, r: 7.5, "stroke-width": 1.8, "stroke-dasharray": "3 2.6" }),
    s("circle", { class: "mk-ring faint", cx: 15, cy: 15, r: 11.5, "stroke-width": 1.4 })
  );

  // src/ui.ts
  var toastTimer;
  function toast(msg) {
    let el = document.querySelector(".toast");
    if (!el) {
      el = h("div", { class: "toast", role: "status" });
      document.body.append(el);
    }
    const box = el;
    box.textContent = msg;
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      box.hidden = true;
    }, 2600);
  }
  function showErrors(form, err) {
    var _a2;
    $$(".err", form).forEach((e) => e.remove());
    $$(".field.bad", form).forEach((e) => e.classList.remove("bad"));
    const target = err.field && form.querySelector(`[data-field="${err.field}"]`);
    const p2 = h("p", { class: "err", role: "alert" }, err.message);
    if (target) {
      target.classList.add("bad");
      target.append(p2);
    } else (_a2 = form.querySelector("[data-errors]")) == null ? void 0 : _a2.append(p2);
  }
  var sevPill = (key, label) => h("span", { class: `sev sev-${key}` }, label);
  function shell(active, ...content) {
    const u = me();
    const tabs = [
      ["home", "Home", "#/home"],
      ["report", "Report", "#/report"],
      ["cases", isStaff() ? "Cases" : "My reports", "#/cases"],
      ["alerts", "Alerts", "#/alerts"],
      ["more", "More", "#/more"]
    ];
    const main = h("main", { id: "main", tabindex: -1 }, content);
    fill(
      $("#app"),
      h(
        "div",
        { class: "shell" },
        h(
          "header",
          { class: "topbar" },
          h("a", { class: "brand", href: "#/home" }, mark(), h("b", null, "HatiAlert")),
          h(
            "div",
            { class: "who small" },
            h("span", { class: "muted" }, roleName[u.role]),
            h("span", { class: "tag me" }, icon("pin"), u.village)
          )
        ),
        h("div", { id: "offline-bar", class: "offline-bar", role: "status", hidden: true }),
        h(
          "nav",
          { class: "tabs", "aria-label": "Main" },
          tabs.map(([k, label, href]) => h("a", { href, class: k === "report" ? "report" : "", "aria-current": k === active && "page" }, icon(k), h("span", null, label)))
        ),
        main
      )
    );
    setOffline(state.offlineSince);
    return main;
  }
  var loading = (active) => shell(
    active,
    h(
      "div",
      { class: "skeleton", "aria-busy": "true", "aria-label": "Loading…" },
      h("span", { class: "skel line short" }),
      h("span", { class: "skel line title" }),
      h("span", { class: "skel block" }),
      h("span", { class: "skel block tall" })
    )
  );
  function failure(main, err) {
    fill(main, h(
      "div",
      { class: "card" },
      h("h2", null, "That didn't load"),
      h("p", { class: "muted" }, err.message),
      h("div", null, h("button", { class: "btn", "data-retry": true, on: { click: () => nav.router() } }, "Try again"))
    ));
  }
  function authShell(...content) {
    const main = h("main", { id: "main", tabindex: -1 }, content);
    fill($("#app"), h("div", { class: "shell" }, main));
    return main;
  }
  function incidentItem(i, where = "") {
    const sub = [];
    if (i.herd_size) sub.push(h("span", null, plural(i.herd_size, "elephant")), h("span", { "aria-hidden": "true" }, " · "));
    sub.push(h("span", null, where || i.village));
    return h(
      "a",
      { class: `item inc stripe ${i.severity}`, href: `#/case/${i.id}` },
      h("div", { class: "inc-main" }, h("h3", null, i.type_label), h("p", { class: "inc-sub" }, sub)),
      sevPill(i.severity, i.severity_label),
      h(
        "div",
        { class: "meta" },
        h("span", { class: `status st-${i.status}` }, i.status_label),
        h("span", null, ago(i.created_at)),
        h("span", { class: "mono ref" }, i.ref)
      )
    );
  }

  // src/i18n/translate.ts
  var LANGS = [{ key: "en", label: "English" }, { key: "nag", label: "Nagamese" }];
  var NAG = window.HATI_NAGAMESE || { words: {}, patterns: [] };
  var NAG_PATTERNS = NAG.patterns.map(([re, out]) => [new RegExp("^" + re + "$"), out]);
  var lang = store.get("hatialert.lang") === "nag" ? "nag" : "en";
  var isNag = () => lang === "nag";
  function tr(text) {
    if (lang !== "nag" || !text) return text;
    const s2 = text.trim();
    if (!s2) return text;
    let out = Object.prototype.hasOwnProperty.call(NAG.words, s2) ? NAG.words[s2] : void 0;
    if (out === void 0) {
      for (const [re, tpl] of NAG_PATTERNS) {
        const m = s2.match(re);
        if (m) {
          out = tpl.replace(/\{(\d)\}/g, (_, k) => tr(m[+k] || ""));
          break;
        }
      }
    }
    if (out === void 0) return text;
    return text.slice(0, text.length - text.trimStart().length) + out + text.slice(text.trimEnd().length);
  }
  var TR_ATTRS = ["placeholder", "aria-label", "title", "alt"];
  function translateNode(n) {
    if (n.nodeType === 3) {
      const v = tr(n.nodeValue);
      if (v !== n.nodeValue) n.nodeValue = v;
      return;
    }
    if (!(n instanceof Element) || n.getAttribute("translate") === "no" || n.tagName === "SCRIPT" || n.tagName === "STYLE") return;
    for (const a of TR_ATTRS) {
      const old = n.getAttribute(a);
      if (old) {
        const v = tr(old);
        if (v !== old) n.setAttribute(a, v);
      }
    }
    if (n.tagName === "TEXTAREA") return;
    for (const c2 of n.childNodes) translateNode(c2);
  }
  var skipped = (n) => !!(n.parentElement && n.parentElement.closest('[translate="no"]'));
  function startTranslator() {
    new MutationObserver((muts) => {
      if (lang !== "nag") return;
      for (const m of muts) {
        if (m.type === "characterData") {
          if (!skipped(m.target)) translateNode(m.target);
        } else for (const n of m.addedNodes) if (!skipped(n)) translateNode(n);
      }
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    document.documentElement.lang = lang === "nag" ? "nag" : "en";
  }
  function setLang(key) {
    lang = key === "nag" ? "nag" : "en";
    store.set("hatialert.lang", lang);
    document.documentElement.lang = lang === "nag" ? "nag" : "en";
  }
  var langPicker = (id) => h(
    "div",
    { class: "seg langs", role: "group", "aria-label": "Language / Bhasa", translate: "no", id },
    LANGS.map((l) => h("button", {
      type: "button",
      "data-lang": l.key,
      "aria-pressed": String(lang === l.key),
      on: {
        click() {
          if (l.key === lang) return;
          setLang(l.key);
          nav.router();
          toast(lang === "nag" ? "Bhasa: Nagamese" : "Language: English");
        }
      }
    }, l.label))
  );

  // src/notify.ts
  var supported = "Notification" in window;
  var seen = new Set(JSON.parse(store.get("hatialert.seenAlerts") || "[]"));
  var notify = {
    supported,
    on: () => supported && store.get("hatialert.notify") === "1" && Notification.permission === "granted",
    /** Show the home village's newest warning once. */
    async check() {
      if (!notify.on() || !state.user || state.user.must_change_pin) return;
      let o;
      try {
        o = await api("GET", "/api/overview");
      } catch {
        return;
      }
      const w = o.warning;
      if (!w || seen.has(w.id)) return;
      seen.add(w.id);
      store.set("hatialert.seenAlerts", JSON.stringify([...seen].slice(-50)));
      const title = `${tr("Elephant warning")} · ${o.village.name}`;
      try {
        const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
        if (reg) reg.showNotification(title, { body: w.message, tag: "alert-" + w.id, icon: "icon.svg" });
        else new Notification(title, { body: w.message, tag: "alert-" + w.id });
      } catch {
      }
    }
  };
  function startNotify() {
    setInterval(() => notify.check(), 6e4);
  }

  // src/offline.ts
  var queueDb = () => new Promise((ok, fail) => {
    const r2 = indexedDB.open("hatialert-client", 1);
    r2.onupgradeneeded = () => r2.result.createObjectStore("queue", { keyPath: "client_id" });
    r2.onsuccess = () => ok(r2.result);
    r2.onerror = () => fail(r2.error);
  });
  var queueTx = async (mode, fn) => {
    const d = await queueDb();
    return new Promise((ok, fail) => {
      const tx = d.transaction("queue", mode), st = tx.objectStore("queue");
      const req = fn(st);
      tx.oncomplete = () => ok(req && req.result);
      tx.onerror = () => fail(tx.error);
    });
  };
  var queue = {
    async add(item) {
      try {
        await queueTx("readwrite", (st) => st.put(item));
        return true;
      } catch {
        return false;
      }
    },
    async all() {
      try {
        return await queueTx("readonly", (st) => st.getAll()) || [];
      } catch {
        return [];
      }
    },
    async remove(id) {
      try {
        await queueTx("readwrite", (st) => st.delete(id));
      } catch {
      }
    }
  };
  var newClientId = () => crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  var flushing = false;
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
        } catch (e) {
          const err = asErr(e);
          if (err.status === 0 || err.status === 401 || err.status === 429 || err.status >= 500) break;
          await queue.remove(item.client_id);
          toast(`A saved report couldn't be sent: ${err.message}`);
        }
      }
    } finally {
      flushing = false;
      const n = (await queue.all()).filter((i) => state.user && i.user_id === state.user.id).length;
      const box = $maybe("#queue-note");
      if (box) {
        box.hidden = !n;
        const c2 = $maybe("[data-count]", box);
        if (c2) c2.textContent = plural(n, "report");
      }
    }
  }
  function startOffline() {
    window.addEventListener("online", flushQueue);
    setInterval(() => {
      if (navigator.onLine) flushQueue();
    }, 6e4);
    if ("serviceWorker" in navigator && !window.HATI_TRANSPORT && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
      navigator.serviceWorker.register("sw.js").catch(() => {
      });
    }
  }

  // src/views/dashboard.ts
  async function copy(text, fallbackEl) {
    var _a2;
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied");
    } catch {
      if (fallbackEl) {
        fallbackEl.focus();
        (_a2 = fallbackEl.select) == null ? void 0 : _a2.call(fallbackEl);
      }
      toast("Press Ctrl+C or long-press to copy");
    }
  }
  function seriesChart(series) {
    const W = 420, H = 130, top = 12, bottom = 22, left = 22;
    const max = Math.max(1, ...series.map((d) => d.count));
    const bw = (W - left) / series.length;
    const y = (v) => top + (H - top - bottom) * (1 - v / max);
    const fmt = (d) => (/* @__PURE__ */ new Date(d + "T00:00:00+05:30")).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
    const bars = series.map((d, k) => s("rect", {
      class: `bar${d.count ? "" : " zero"}`,
      x: (left + k * bw + bw * 0.15).toFixed(1),
      y: (d.count ? y(d.count) : H - bottom - 2).toFixed(1),
      width: Math.max(1, bw * 0.7).toFixed(1),
      height: (d.count ? H - bottom - y(d.count) : 2).toFixed(1)
    }, s("title", null, `${fmt(d.date)}: ${plural(d.count, "incident")}`)));
    const ticks = [0, Math.floor(series.length / 2), series.length - 1].map((k) => s("text", {
      x: (left + k * bw + bw / 2).toFixed(1),
      y: H - 6,
      "text-anchor": k === 0 ? "start" : k === series.length - 1 ? "end" : "middle"
    }, fmt(series[k].date)));
    return s(
      "svg",
      { class: "chart", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Incidents per day" },
      s("line", { class: "axis", x1: left, y1: H - bottom, x2: W, y2: H - bottom }),
      s("line", { class: "axis", x1: left, y1: y(max), x2: W, y2: y(max), "stroke-dasharray": "3 4" }),
      s("text", { x: left - 6, y: y(max) + 4, "text-anchor": "end" }, max),
      s("text", { x: left - 6, y: H - bottom + 4, "text-anchor": "end" }, "0"),
      bars,
      ticks
    );
  }
  var hbars = (rows) => {
    const max = Math.max(1, ...rows.map((r2) => r2.count));
    return h("div", { class: "hbars" }, rows.map((r2) => h(
      "div",
      { class: "hbar" },
      h("span", null, r2.label || r2.name),
      s(
        "svg",
        { viewBox: "0 0 100 12", preserveAspectRatio: "none", "aria-hidden": "true" },
        s("rect", { class: "track", width: 100, height: 12, rx: 3 }),
        s("rect", { class: "fill", width: (r2.count / max * 100).toFixed(1), height: 12, rx: 3 })
      ),
      h("b", null, r2.count)
    )));
  };
  async function viewDashboard() {
    if (me().role !== "officer") {
      location.hash = "#/home";
      return;
    }
    const main = loading("more");
    let st;
    try {
      st = await api("GET", `/api/stats?days=${state.days}`);
    } catch (err) {
      return failure(main, asErr(err));
    }
    const out = h("section", { class: "card", id: "csv-out", hidden: true });
    const csvButton = h("button", { class: "btn small", id: "csv" }, "Export CSV");
    const kpi = (label, value, note) => h("div", { class: "kpi" }, h("small", null, label), h("b", null, value), h("small", null, note));
    const none = () => h("p", { class: "muted" }, "No incidents in this period.");
    fill(
      main,
      h("div", { class: "pagehead" }, h("a", { class: "small", href: "#/more" }, "← More"), h("h1", null, "District overview")),
      h(
        "div",
        { class: "row between" },
        h("div", { class: "seg", role: "group", "aria-label": "Period" }, [7, 30, 90].map((d) => h("button", {
          type: "button",
          "data-days": d,
          "aria-pressed": String(state.days === d)
        }, `${d} days`))),
        csvButton
      ),
      h(
        "div",
        { class: "kpis" },
        kpi("Incidents", st.total, `${st.open} still open`),
        kpi("Median time to respond", st.median_response_h == null ? "—" : st.median_response_h + " h", `across ${plural(st.responded_count, "case")}`),
        kpi("People hurt or killed", st.casualties, `${st.false_reports} false ${st.false_reports === 1 ? "report" : "reports"}`),
        kpi("Recorded losses", `${st.crop_acres} ac`, `crops · ${inr(st.property_inr)} property`)
      ),
      h("section", { class: "card" }, h("h2", null, "Incidents per day"), seriesChart(st.series)),
      h(
        "div",
        { class: "grid2 wide" },
        h("section", { class: "card" }, h("h2", null, "Hotspot villages"), st.by_village.length ? hbars(st.by_village.slice(0, 8)) : none()),
        h("section", { class: "card" }, h("h2", null, "What happened"), hbars(st.by_type.filter((t) => t.count)), st.total ? null : none())
      ),
      h("section", { class: "card" }, h("h2", null, "Severity"), hbars(st.by_severity)),
      out
    );
    $$("[data-days]", main).forEach((b) => b.onclick = () => {
      state.days = +b.dataset.days;
      viewDashboard();
    });
    csvButton.onclick = async () => {
      const text = await api("GET", `/api/export.csv?days=${state.days}`);
      out.hidden = false;
      const area = h("textarea", { class: "csv", id: "csv-text", readonly: true, "aria-label": "CSV export" });
      const save = transport.canDownload ? h("button", { class: "btn small", id: "csv-save" }, "Download") : null;
      fill(
        out,
        h(
          "div",
          { class: "row between" },
          h("h2", null, `CSV · last ${state.days} days`),
          h("div", { class: "row" }, save, h("button", { class: "btn small", id: "csv-copy", on: { click: () => copy(text, area) } }, icon("copy"), " Copy"))
        ),
        area
      );
      area.value = text;
      if (save) save.onclick = () => {
        const a = h("a", { href: URL.createObjectURL(new Blob([text], { type: "text/csv" })), download: `hatialert-${state.days}d.csv` });
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1e3);
      };
      out.scrollIntoView({ behavior: "smooth", block: "start" });
    };
  }

  // src/views/admin.ts
  var ROLES = ["villager", "guard", "officer"];
  var roleOpts = (cur) => ROLES.map((r2) => h("option", { value: r2, selected: r2 === cur }, roleName[r2]));
  async function viewAdmin(tab = "people") {
    if (me().role !== "officer") {
      location.hash = "#/home";
      return;
    }
    const tabs = [["people", "People"], ["villages", "Villages"], ["messages", "Messages"], ["system", "System"]];
    const body = h("div", { id: "admin-body", class: "stack" }, h("p", { class: "muted" }, "Loading…"));
    shell(
      "more",
      h("div", { class: "pagehead" }, h("a", { class: "small", href: "#/more" }, "← More"), h("h1", null, "Admin")),
      h("div", { class: "seg", role: "group", "aria-label": "Admin sections" }, tabs.map(([k, l]) => h("a", { class: "segl", href: `#/admin/${k}`, "aria-current": k === tab && "page" }, l))),
      body
    );
    try {
      if (tab === "villages") await adminVillages(body);
      else if (tab === "messages") await adminMessages(body);
      else if (tab === "system") await adminSystem(body);
      else await adminPeople(body);
    } catch (e) {
      const err = asErr(e);
      fill(body, h("div", { class: "card" }, h("p", null, err.status === 404 ? "This needs the Python engine, which isn't running in this browser." : err.message)));
    }
  }
  async function adminPeople(body) {
    const q = h("input", { type: "search", id: "pp-q", class: "grow", placeholder: "Search name or phone", "aria-label": "Search people" });
    const role = h("select", { id: "pp-role", class: "narrow", "aria-label": "Role" }, h("option", { value: "" }, "Everyone"), roleOpts(""));
    const list = h("section", { class: "card flush divide", id: "pp-list" });
    const temp = h("div", { id: "pp-temp" });
    fill(body, h("div", { class: "row" }, q, role), list, temp);
    const tag = (text) => h("span", { class: "tag" }, text);
    const load = async () => {
      const people = await api("GET", `/api/users?q=${encodeURIComponent(q.value.trim())}&role=${role.value}`);
      fill(list, people.length ? people.map((p2) => h(
        "div",
        { class: "item", "data-uid": p2.id },
        h("h3", { translate: "no" }, p2.name),
        tag(roleName[p2.role]),
        h(
          "div",
          { class: "meta" },
          h("span", { class: "mono" }, p2.phone),
          h("span", { translate: "no" }, p2.village),
          !p2.active && tag("Switched off"),
          !p2.phone_verified && tag("Phone not verified"),
          p2.failed_24h > 0 && tag(`${plural(p2.failed_24h, "wrong PIN")} today`),
          p2.last_seen ? h("span", null, `Last seen ${ago(p2.last_seen)}`) : null
        ),
        h(
          "div",
          { class: "full row pp-actions" },
          h("select", { "data-role": true, "aria-label": "Role" }, roleOpts(p2.role)),
          h("button", { type: "button", class: "btn small", "data-act": "role" }, "Save role"),
          h("button", { type: "button", class: "btn small", "data-act": "reset" }, "Reset PIN"),
          p2.failed_24h > 0 && h("button", { type: "button", class: "btn small", "data-act": "unlock" }, "Unlock"),
          h("button", { type: "button", class: `btn small ${p2.active ? "danger" : ""}`, "data-act": "active", "data-on": p2.active ? 0 : 1 }, p2.active ? "Switch off" : "Switch on")
        )
      )) : h("div", { class: "empty" }, h("b", null, "No one found")));
    };
    let t;
    q.oninput = () => {
      clearTimeout(t);
      t = setTimeout(() => load().catch((e) => toast(asErr(e).message)), 250);
    };
    role.onchange = () => load().catch((e) => toast(asErr(e).message));
    list.onclick = async (e) => {
      const b = e.target.closest("[data-act]");
      if (!b) return;
      const row = b.closest("[data-uid]"), uid = row.dataset.uid;
      try {
        if (b.dataset.act === "role") {
          await api("PATCH", `/api/users/${uid}`, { role: $("[data-role]", row).value });
          toast("Role saved");
        }
        if (b.dataset.act === "active") {
          await api("PATCH", `/api/users/${uid}`, { active: b.dataset.on === "1" });
          toast(b.dataset.on === "1" ? "Account switched on" : "Account switched off");
        }
        if (b.dataset.act === "unlock") {
          await api("POST", `/api/users/${uid}/unlock`);
          toast("Unlocked");
        }
        if (b.dataset.act === "reset") {
          if (b.dataset.sure !== "1") {
            b.dataset.sure = "1";
            b.textContent = "Tap again to reset";
            return;
          }
          const r2 = await api("POST", `/api/users/${uid}/reset-pin`);
          fill(temp, h(
            "section",
            { class: "card warning" },
            h("span", { class: "label" }, "Temporary PIN for ", h("span", { translate: "no" }, r2.user.name)),
            h("p", { class: "bigpin mono" }, r2.temp_pin),
            h("p", { class: "small" }, "Tell them in person or by phone call. They must choose a new PIN when they sign in. It isn't shown again.")
          ));
          temp.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        await load();
      } catch (err) {
        toast(asErr(err).message);
      }
    };
    await load();
  }
  async function adminVillages(body) {
    const vs = await api("GET", "/api/villages");
    const unverified = vs.filter((v) => v.active && !v.verified).length;
    const refreshMeta = async () => {
      state.meta = await api("GET", "/api/meta");
    };
    const text = (name, attrs = {}) => h("input", { name, type: "text", ...attrs });
    const coord = (name, label, attrs) => h("label", { class: "field", "data-field": name }, h("span", null, label), text(name, { inputmode: "decimal", ...attrs }));
    const check = (name, label, on) => h("label", { class: "switch" }, h("input", { type: "checkbox", name, checked: on }), h("span", null, label));
    const sourceField = (attrs) => h("label", { class: "field", "data-field": "source" }, h("span", null, "Where the position comes from"), text("source", { maxlength: 120, ...attrs }));
    const saveRow = (label, cls = "btn primary") => [h("div", { "data-errors": true }), h("div", null, h("button", { class: cls, type: "submit" }, label))];
    const csv = h("textarea", { id: "v-csv", class: "csv", placeholder: "name,lat,lng,source\nLotsu,26.2500,94.1000,Census 2011" });
    const result = h("p", { id: "v-result", class: "small" });
    const file = h("input", { type: "file", id: "v-file", accept: ".csv,text/csv,text/plain", "aria-label": "CSV file" });
    const add2 = h(
      "form",
      { class: "card", id: "v-add", novalidate: true },
      h("h2", null, "Add a village"),
      h("label", { class: "field", "data-field": "name" }, h("span", null, "Name"), text("name", { maxlength: 60 })),
      h("div", { class: "grid2" }, coord("lat", "Latitude", { placeholder: "26.0972" }), coord("lng", "Longitude", { placeholder: "94.2582" })),
      sourceField({}),
      check("verified", "Position checked", false),
      saveRow("Add village")
    );
    const imp = h(
      "form",
      { class: "card", id: "v-import", novalidate: true },
      h("h2", null, "Import a list"),
      h("p", { class: "small muted" }, "Paste CSV with a header row ", h("span", { class: "mono" }, "name,lat,lng,source"), ", or choose a file. Names already on the list get the new position; all imported positions count as checked."),
      file,
      h("label", { class: "field", "data-field": "csv" }, h("span", null, "CSV"), csv),
      saveRow("Import"),
      result
    );
    fill(
      body,
      unverified > 0 && h("div", { class: "notice" }, h("span", null, `${plural(unverified, "village position is", "village positions are")} not checked yet. Distances and alert areas depend on them.`)),
      h("section", { class: "card flush divide" }, vs.map((v) => {
        const f = h(
          "form",
          { class: "stack vform", novalidate: true },
          h("div", { class: "grid2" }, coord("lat", "Latitude", { value: v.lat }), coord("lng", "Longitude", { value: v.lng })),
          sourceField({ value: v.source, placeholder: "e.g. Survey of India sheet 83G/1, GPS by guard" }),
          check("verified", "Position checked", v.verified),
          check("active", "Show in lists", !!v.active),
          saveRow("Save", "btn primary small")
        );
        f.onsubmit = async (e) => {
          e.preventDefault();
          const d = new FormData(f);
          try {
            await api("PATCH", `/api/villages/${v.id}`, { lat: d.get("lat"), lng: d.get("lng"), source: d.get("source"), verified: !!d.get("verified"), active: !!d.get("active") });
            await refreshMeta();
            toast("Village saved");
            adminVillages(body);
          } catch (err) {
            showErrors(f, asErr(err));
          }
        };
        return h(
          "div",
          { class: "item", "data-vid": v.id },
          h("h3", { translate: "no" }, v.name),
          v.verified ? h("span", { class: "tag me" }, "Checked") : h("span", { class: "tag" }, "Not checked"),
          h(
            "div",
            { class: "meta" },
            h("span", { class: "mono" }, `${v.lat.toFixed(5)}, ${v.lng.toFixed(5)}`),
            h("span", { translate: "no" }, v.source || "—"),
            h("span", null, plural(v.people, "person", "people")),
            h("span", null, plural(v.incidents, "incident")),
            !v.active && h("span", { class: "tag" }, "Hidden")
          ),
          h("details", { class: "full" }, h("summary", null, "Edit"), f)
        );
      })),
      add2,
      imp
    );
    add2.onsubmit = async (e) => {
      e.preventDefault();
      const d = new FormData(add2);
      try {
        await api("POST", "/api/villages", { name: d.get("name"), lat: d.get("lat"), lng: d.get("lng"), source: d.get("source"), verified: !!d.get("verified") });
        await refreshMeta();
        toast("Village added");
        adminVillages(body);
      } catch (err) {
        showErrors(add2, asErr(err));
      }
    };
    file.onchange = async () => {
      const fl = file.files && file.files[0];
      if (fl) csv.value = await fl.text();
    };
    imp.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const r2 = await api("POST", "/api/villages/import", { csv: csv.value });
        await refreshMeta();
        toast(`Imported: ${r2.added} added, ${r2.updated} updated`);
        await adminVillages(body);
        $("#v-result", body).textContent = r2.skipped ? `Skipped ${plural(r2.skipped, "line")} with a problem: ${r2.skipped_lines.join(", ")}` : "";
      } catch (err) {
        showErrors(imp, asErr(err));
      }
    };
  }
  var MESSAGE_LABEL = { queued: "Waiting", sent: "Sent", failed: "Failed", manual: "To send by hand" };
  var statusLabel = (k) => MESSAGE_LABEL[k] || k;
  async function adminMessages(body) {
    const box = await api("GET", "/api/outbox");
    fill(
      body,
      h("div", { class: "notice" }, h("span", null, box.mode === "manual" ? "Text messages aren't connected to an SMS service yet. Send these from a phone, then mark them sent." : "Alerts are texted automatically. Failed ones can be tried again.")),
      box.batches.length ? box.batches.map((b) => h(
        "section",
        { class: "card", "data-batch": b.alert_id },
        h(
          "div",
          { class: "row between" },
          h("h3", null, `${b.level_label} · `, h("span", { translate: "no" }, b.villages.join(", "))),
          h("span", { class: "small muted" }, ago(b.sent_at))
        ),
        h("p", { class: "mono small msgtext", translate: "no" }, b.text),
        h("div", { class: "chips" }, Object.entries(b.counts).map(([k, n]) => h("span", { class: "tag" }, `${statusLabel(k)}: ${n}`))),
        h(
          "div",
          { class: "row" },
          h("button", { type: "button", class: "btn small", "data-copy-text": true }, icon("copy"), " Copy message"),
          h("button", { type: "button", class: "btn small", "data-copy-nums": true }, icon("copy"), " Copy numbers"),
          b.counts.manual ? h("button", { type: "button", class: "btn small primary", "data-mark": "sent" }, "Mark all sent") : null,
          b.counts.failed && box.mode !== "manual" ? h("button", { type: "button", class: "btn small", "data-mark": "queued" }, "Try failed again") : null
        ),
        h(
          "details",
          null,
          h("summary", null, plural(b.recipients.length, "person", "people")),
          h("ul", { class: "plain stack small" }, b.recipients.map((r2) => h(
            "li",
            { class: "row between" },
            h("span", { translate: "no" }, `${r2.name || "—"} · ${r2.village || ""}`),
            h("span", { class: "mono" }, r2.phone),
            h("span", { class: "tag" }, statusLabel(r2.status))
          )))
        )
      )) : h("div", { class: "empty" }, h("b", null, "No alert messages yet"), h("span", null, "Each alert lists the people in those villages here."))
    );
    body.onclick = async (e) => {
      const t = e.target;
      const card = t.closest("[data-batch]");
      if (!card) return;
      const b = box.batches.find((x) => String(x.alert_id) === card.dataset.batch);
      if (!b) return;
      if (t.closest("[data-copy-text]")) copy(b.text);
      if (t.closest("[data-copy-nums]")) copy(b.recipients.map((r2) => "+91" + r2.phone).join(", "));
      const m = t.closest("[data-mark]");
      if (m) {
        const want = m.dataset.mark, from = want === "sent" ? "manual" : "failed";
        try {
          await api("POST", "/api/outbox/mark", { ids: b.recipients.filter((r2) => r2.status === from).map((r2) => r2.id), status: want });
          toast(want === "sent" ? "Marked sent" : "Trying again");
          adminMessages(body);
        } catch (err) {
          toast(asErr(err).message);
        }
      }
    };
  }
  async function adminSystem(body) {
    const st = await api("GET", "/api/admin/status");
    const mb = (n) => (n / 1e6).toFixed(1) + " MB";
    const bk = st.system && st.system.backups;
    const mono = (text) => h("span", { class: "mono" }, text);
    const tags = Object.entries(st.outbox).map(([k, n]) => h("span", { class: "tag" }, `${k}: ${n}`));
    fill(
      body,
      h(
        "section",
        { class: "card" },
        h("h2", null, "Text messages"),
        h("p", null, st.sms.enabled ? `Connected (${st.sms.mode}${st.sms.host ? `, ${st.sms.host}` : ""}).` : "Not connected. Alerts are listed under Messages for staff to send by hand, and sign-up codes are off."),
        h("div", { class: "chips" }, tags.length ? tags : h("span", { class: "small muted" }, "No messages yet."))
      ),
      h(
        "section",
        { class: "card" },
        h("h2", null, "Backups"),
        bk && bk.dir ? [
          h("p", null, `Every ${bk.every_hours} h to `, mono(bk.dir), `, keeping ${bk.keep}.`),
          h(
            "p",
            { class: "small muted" },
            bk.last_at ? [`Last backup ${ago(bk.last_at)}: `, mono(bk.last_path || "")] : "First backup is running.",
            bk.error ? ` · Last error: ${bk.error}` : ""
          )
        ] : [
          h("p", null, "Automatic backups are off."),
          h("p", { class: "small muted" }, "Start the server with ", mono("--backup-dir /path/to/backups"), ", or run ", mono("python -m hatialert backup"), " on a schedule.", window.HATI_TRANSPORT ? " In this preview, data stays in this browser only." : "")
        ]
      ),
      h(
        "section",
        { class: "card" },
        h("h2", null, "Storage"),
        h(
          "dl",
          { class: "facts" },
          h("div", null, h("dt", null, "Database"), h("dd", null, mb(st.storage.db_bytes))),
          h("div", null, h("dt", null, "Photos and voice"), h("dd", null, mb(st.storage.media_bytes))),
          h("div", null, h("dt", null, "People"), h("dd", null, st.storage.users)),
          h("div", null, h("dt", null, "Incidents"), h("dd", null, st.storage.incidents))
        )
      ),
      h(
        "section",
        { class: "card" },
        h("h2", null, "Recent admin actions"),
        st.audit.length ? h("ul", { class: "plain stack small" }, st.audit.map((a) => h(
          "li",
          null,
          h("b", null, a.action.replace(/_/g, " ")),
          " ",
          h("span", { class: "muted" }, ago(a.at), a.by ? ` · ${a.by}` : ""),
          h("br"),
          h("span", { translate: "no" }, a.detail)
        ))) : h("p", { class: "small muted" }, "Nothing yet.")
      )
    );
  }

  // src/views/alerts.ts
  async function viewAlerts() {
    const main = loading("alerts");
    let list;
    try {
      list = await api("GET", "/api/alerts");
    } catch (err) {
      return failure(main, asErr(err));
    }
    const pre = state.prefill;
    state.prefill = null;
    const m = state.meta, staff = isStaff(), u = me();
    let compose = null;
    if (staff) {
      const msg = h("textarea", { id: "compose-msg", maxlength: 400, placeholder: "What is happening, where, and what people should do" }, (pre == null ? void 0 : pre.message) || "");
      const counter = h("small", { class: "tnum", id: "compose-count" });
      const f = h(
        "form",
        { id: "compose", class: "stack", novalidate: true },
        h(
          "div",
          { class: "seg", role: "group", "aria-label": "Alert type", "data-field": "level" },
          m.alert_levels.map((l) => h("button", { type: "button", "data-level": l.key, "aria-pressed": String(((pre == null ? void 0 : pre.level) || "warning") === l.key) }, l.label))
        ),
        h(
          "div",
          { class: "field", "data-field": "villages" },
          h("span", null, "Villages"),
          h("div", { class: "chips" }, m.villages.map((v) => h("button", { type: "button", class: "chip", "data-v": v.name, "aria-pressed": String(!!(pre == null ? void 0 : pre.villages.includes(v.name))) }, v.name)))
        ),
        h("label", { class: "field", "data-field": "message" }, h("span", null, "Message"), msg, counter),
        h("div", { "data-errors": true }),
        h("div", null, h("button", { class: "btn primary", type: "submit" }, "Send alert"))
      );
      compose = h(
        "details",
        { class: "card compose", id: "compose-wrap", open: !!pre },
        h(
          "summary",
          null,
          h("span", { class: "ic-badge", "aria-hidden": "true" }, iconSvg("alerts")),
          h("span", { class: "grow" }, h("b", null, "Send an alert"), h("br"), h("span", { class: "small muted" }, "to chosen villages")),
          h("span", { class: "chev", "aria-hidden": "true" }, "›")
        ),
        f
      );
      const count = () => {
        counter.textContent = `${msg.value.length} / 400`;
      };
      count();
      f.addEventListener("input", count);
      f.addEventListener("click", (e) => {
        const b = e.target.closest("button[type=button]");
        if (!b) return;
        if (b.dataset.level) $$("[data-level]", f).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        if (b.dataset.v) b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true"));
      });
      f.onsubmit = async (e) => {
        var _a2;
        e.preventDefault();
        try {
          const sent = await api("POST", "/api/alerts", {
            level: $("[data-level][aria-pressed=true]", f).dataset.level,
            villages: $$("[data-v][aria-pressed=true]", f).map((b) => b.dataset.v),
            message: msg.value,
            incident_id: (_a2 = pre == null ? void 0 : pre.incident_id) != null ? _a2 : null
          });
          const n = sent.sms ? sent.sms.recipients : 0;
          toast(!n ? "Alert sent" : sent.sms.mode === "manual" ? `Alert sent. ${plural(n, "person", "people")} to text by hand (Admin › Messages)` : `Alert sent. Texting ${plural(n, "person", "people")}`);
          viewAlerts();
        } catch (err) {
          showErrors(f, asErr(err));
        }
      };
    }
    fill(
      main,
      h("div", { class: "pagehead" }, h("h1", null, "Alerts"), h("p", { class: "muted" }, `Warnings from forest staff. Alerts for ${u.village} are marked.`)),
      compose,
      h("section", { class: "card flush divide" }, list.length ? list.map((a) => h(
        "article",
        { class: `item stripe ${a.level === "warning" ? "critical" : a.level === "all_clear" ? "low" : ""}` },
        h("h3", null, a.level_label, a.active && [" ", h("span", { class: "sev sev-critical" }, "Active")]),
        h("span", { class: "small muted" }, ago(a.sent_at)),
        h("p", { class: "full", translate: "no" }, a.message),
        h(
          "div",
          { class: "meta" },
          h("span", { class: "chips" }, a.villages.map((v) => h("span", { class: `tag ${v === u.village ? "me" : ""}` }, v))),
          a.by && h("span", null, a.by),
          a.incident_id ? h("a", { href: `#/case/${a.incident_id}` }, "View case") : null
        )
      )) : h("div", { class: "empty" }, h("b", null, "No alerts yet"), h("span", null, "Warnings for your village will show here.")))
    );
  }

  // src/views/auth.ts
  var field = (name, label, ...control) => h("label", { class: "field", "data-field": name }, h("span", null, label), control);
  var pinInput = (id, autocomplete, extra = {}) => h("input", { id, type: "password", inputmode: "numeric", maxlength: 6, autocomplete, ...extra });
  var pinsDiffer = () => new ApiErr(400, "The two PINs don't match.", "pin2");
  function signIn({ token, user }) {
    state.token = token;
    state.user = user;
    store.set("hatialert.token", token);
    saveMe(user);
    location.hash = user.must_change_pin ? "#/new-pin" : "#/home";
    nav.router();
    flushQueue();
  }
  function viewLogin() {
    const demo = state.meta.demo_accounts;
    const phone = h("input", { id: "login-phone", type: "tel", inputmode: "numeric", autocomplete: "tel", placeholder: "98765 43210", required: true });
    const pin = h("input", { id: "login-pin", type: "password", inputmode: "numeric", autocomplete: "current-password", maxlength: 6, required: true });
    const submit = h("button", { class: "btn primary big", type: "submit" }, "Sign in");
    const form = h(
      "form",
      { class: "card", id: "login", novalidate: true },
      h("h2", null, "Sign in"),
      field("phone", "Mobile number", phone),
      field("pin", "PIN", pin),
      h("div", { "data-errors": true }),
      submit,
      h("p", { class: "small muted" }, "New here? ", h("a", { href: "#/register" }, "Create an account")),
      h("p", { class: "small muted" }, h("a", { href: "#/forgot" }, "Forgot your PIN?"))
    );
    form.onsubmit = async (e) => {
      e.preventDefault();
      submit.disabled = true;
      try {
        signIn(await api("POST", "/api/auth/login", { phone: phone.value, pin: pin.value }));
      } catch (err) {
        showErrors(form, asErr(err));
        submit.disabled = false;
      }
    };
    authShell(
      h(
        "div",
        { class: "hero" },
        h("div", { class: "row between" }, h("div", { class: "row" }, mark(), h("b", { class: "label" }, "HatiAlert · Wokha")), langPicker("lang-login")),
        h("h1", null, "See elephants? Warn your village in a minute."),
        h("p", { class: "muted" }, "Report sightings and crop raids, follow what the forest staff do about them, and get warnings for your village.")
      ),
      form,
      demo.length > 0 && h(
        "section",
        { class: "card" },
        h("div", { class: "stack" }, h("h2", null, "Try a demo account"), h("p", { class: "small muted" }, "Each role sees a different app. Tap one to fill in the form.")),
        h("div", { class: "demo" }, demo.map((d) => h(
          "button",
          {
            type: "button",
            "data-phone": d.phone,
            "data-pin": d.pin,
            on: { click() {
              phone.value = d.phone;
              pin.value = d.pin;
              form.requestSubmit();
            } }
          },
          h("b", null, roleName[d.role]),
          h("span", { class: "mono muted" }, `PIN ${d.pin}`),
          h("span", { class: "small muted" }, `${d.name} · ${d.village}`),
          h("span", { class: "mono small muted" }, d.phone)
        )))
      )
    );
  }
  function viewRegister() {
    const name = h("input", { id: "reg-name", type: "text", autocomplete: "name", maxlength: 60, required: true });
    const phone = h("input", { id: "reg-phone", type: "tel", inputmode: "numeric", autocomplete: "tel", required: true });
    const village = h("select", { id: "reg-village" }, state.meta.villages.map((v) => h("option", null, v.name)));
    const pin = pinInput("reg-pin", "new-password"), pin2 = pinInput("reg-pin2", "new-password");
    let code = null;
    let codeBox = null;
    if (state.meta.sms_enabled) {
      const c2 = code = h("input", { id: "reg-code", type: "text", inputmode: "numeric", autocomplete: "one-time-code", maxlength: 6, class: "grow" });
      const note = h("small", { id: "reg-code-note" }, "We text a 6-digit code to check the number is yours.");
      codeBox = h(
        "div",
        { class: "field", "data-field": "code" },
        h("span", null, "Code from the text message"),
        h("div", { class: "row" }, c2, h("button", {
          type: "button",
          class: "btn",
          id: "reg-send",
          on: {
            async click() {
              try {
                const r2 = await api("POST", "/api/auth/otp", { phone: phone.value, purpose: "register" });
                note.textContent = r2.message;
                c2.focus();
              } catch (err) {
                showErrors(form, asErr(err));
              }
            }
          }
        }, "Send code")),
        note
      );
    }
    const form = h(
      "form",
      { class: "card", id: "reg", novalidate: true },
      field("name", "Full name", name),
      field("phone", "Mobile number", phone),
      codeBox,
      field("village", "Village", village),
      h(
        "div",
        { class: "grid2" },
        field("pin", "Choose a PIN", pin, h("small", null, "4 to 6 digits")),
        field("pin2", "Repeat PIN", pin2)
      ),
      h("div", { "data-errors": true }),
      h("button", { class: "btn primary big", type: "submit" }, "Create account"),
      h("p", { class: "small muted" }, "New accounts start as villagers. Forest staff accounts are set up by the forest office.")
    );
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (pin.value !== pin2.value) return showErrors(form, pinsDiffer());
      try {
        signIn(await api("POST", "/api/auth/register", { name: name.value, phone: phone.value, village: village.value, pin: pin.value, code: code == null ? void 0 : code.value }));
        toast("Account created");
      } catch (err) {
        showErrors(form, asErr(err));
      }
    };
    authShell(
      h("div", { class: "pagehead" }, h("a", { href: "#/login", class: "small" }, "← Sign in"), h("h1", null, "Create an account"), h("p", { class: "muted" }, "Your village sets which warnings you get.")),
      form
    );
  }
  function viewForgot() {
    const head = h("div", { class: "pagehead" }, h("a", { href: "#/login", class: "small" }, "← Sign in"), h("h1", null, "Forgot your PIN?"));
    if (!state.meta.sms_enabled) {
      authShell(head, h(
        "section",
        { class: "card" },
        h("p", null, "Ask a forest officer or forest guard to reset your PIN. They will give you a temporary PIN, and you choose a new one when you sign in."),
        h("p", { class: "small muted" }, "Text-message codes aren't set up on this server yet.")
      ));
      return;
    }
    const phone = h("input", { id: "fg-phone", type: "tel", inputmode: "numeric", autocomplete: "tel" });
    const note = h("small", { id: "fg-note", class: "muted" });
    const code = h("input", { id: "fg-code", type: "text", inputmode: "numeric", autocomplete: "one-time-code", maxlength: 6 });
    const pin = pinInput("fg-pin", "new-password"), pin2 = pinInput("fg-pin2", "new-password");
    const form = h(
      "form",
      { class: "card", id: "fg", novalidate: true },
      h("p", { class: "muted" }, "We'll text you a code, then you choose a new PIN."),
      field("phone", "Mobile number", phone),
      h("div", null, h("button", {
        type: "button",
        class: "btn",
        id: "fg-send",
        on: {
          async click() {
            try {
              const r2 = await api("POST", "/api/auth/otp", { phone: phone.value, purpose: "reset" });
              note.textContent = r2.message;
            } catch (err) {
              showErrors(form, asErr(err));
            }
          }
        }
      }, "Send code"), " ", note),
      field("code", "Code from the text message", code),
      h(
        "div",
        { class: "grid2" },
        field("pin", "New PIN", pin, h("small", null, "4 to 6 digits")),
        field("pin2", "Repeat PIN", pin2)
      ),
      h("div", { "data-errors": true }),
      h("button", { class: "btn primary big", type: "submit" }, "Save new PIN")
    );
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (pin.value !== pin2.value) return showErrors(form, pinsDiffer());
      try {
        signIn(await api("POST", "/api/auth/reset", { phone: phone.value, code: code.value, pin: pin.value }));
        toast("New PIN saved");
      } catch (err) {
        showErrors(form, asErr(err));
      }
    };
    authShell(head, form);
  }
  function pinForm(id, temp, done) {
    const old = pinInput(`${id}-old`, "current-password"), pin = pinInput(`${id}-new`, "new-password"), pin2 = pinInput(`${id}-new2`, "new-password");
    const form = h(
      "form",
      { class: "card", id, novalidate: true },
      h("h2", null, temp ? "Choose your own PIN" : "Change PIN"),
      temp && h("p", { class: "muted" }, "You signed in with a temporary PIN. Choose a new one that only you know."),
      field("old_pin", temp ? "Temporary PIN" : "Current PIN", old),
      h(
        "div",
        { class: "grid2" },
        field("pin", "New PIN", pin, h("small", null, "4 to 6 digits, not 1111 or 1234")),
        field("pin2", "Repeat PIN", pin2)
      ),
      h("div", { "data-errors": true }),
      h("div", null, h("button", { class: "btn primary", type: "submit" }, "Save new PIN"))
    );
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (pin.value !== pin2.value) return showErrors(form, pinsDiffer());
      try {
        state.user = await api("POST", "/api/me/pin", { old_pin: old.value, pin: pin.value });
        saveMe(state.user);
        toast("New PIN saved");
        done();
      } catch (err) {
        showErrors(form, asErr(err));
      }
    };
    return form;
  }
  function viewNewPin() {
    authShell(
      h("div", { class: "pagehead" }, h("div", { class: "row" }, mark(), h("b", { class: "label" }, "HatiAlert"))),
      pinForm("np", true, () => {
        location.hash = "#/home";
        nav.router();
      }),
      h("p", { class: "small muted" }, h("button", {
        type: "button",
        class: "linkbtn",
        id: "np-out",
        on: { async click() {
          try {
            await api("POST", "/api/auth/logout");
          } catch {
          }
          signOutLocal();
          nav.router();
        } }
      }, "Sign out"))
    );
  }

  // src/geo.ts
  var utmKm = (() => {
    const f = 1 / 298.257223563, n = f / (2 - f), A = 6378137 / (1 + n) * (1 + n * n / 4 + n ** 4 / 64);
    const al = [n / 2 - 2 * n * n / 3 + 5 * n ** 3 / 16, 13 * n * n / 48 - 3 * n ** 3 / 5, 61 * n ** 3 / 240];
    const c2 = 2 * Math.sqrt(n) / (1 + n), rad = Math.PI / 180;
    return (lat, lon) => {
      const phi = lat * rad, dl = (lon - 93) * rad;
      const t = Math.sinh(Math.atanh(Math.sin(phi)) - c2 * Math.atanh(c2 * Math.sin(phi)));
      const xi = Math.atan2(t, Math.cos(dl)), eta = Math.atanh(Math.sin(dl) / Math.sqrt(1 + t * t));
      let e = eta, nn = xi;
      al.forEach((a, j) => {
        const k = 2 * (j + 1);
        e += a * Math.cos(k * xi) * Math.sinh(k * eta);
        nn += a * Math.sin(k * xi) * Math.cosh(k * eta);
      });
      return [(5e5 + 0.9996 * A * e) / 1e3, 0.9996 * A * nn / 1e3];
    };
  })();
  function destination(lat, lng, km, deg) {
    const R = 6371.0088, d = km / R, th = deg * Math.PI / 180, p1 = lat * Math.PI / 180, l1 = lng * Math.PI / 180;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(th));
    const l2 = l1 + Math.atan2(Math.sin(th) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return [p2 * 180 / Math.PI, l2 * 180 / Math.PI];
  }

  // src/map.ts
  var layersP = null;
  function loadLayers() {
    if (!layersP) layersP = fetch("map/layers.json").then((r2) => r2.ok ? r2.json() : null).then((d) => d ? prepareLayers(d) : null).catch(() => null);
    return layersP;
  }
  function prepareLayers(d) {
    const [e0, n0, e1, n1] = d.extent;
    const unpack = (p2) => {
      const out = [];
      let x = 0, y = 0;
      for (let i = 0; i < p2.length; i += 2) {
        x += p2[i];
        y += p2[i + 1];
        out.push([x / 100, y / 100]);
      }
      return out;
    };
    const toD = (pts, close) => "M" + pts.map(([e, n]) => `${(e - e0).toFixed(2)},${(n1 - n).toFixed(2)}`).join("L") + (close ? "Z" : "");
    const contourLabels = [];
    const contours = { minor: "", index: "" };
    for (const c2 of d.contours) {
      for (const p2 of c2.paths) {
        const pts = unpack(p2);
        contours[c2.index ? "index" : "minor"] += toD(pts);
        if (c2.index && pts.length > 20) {
          const [e, n] = pts[pts.length >> 1];
          if (!contourLabels.some((l) => l.elev === c2.elev && Math.hypot(l.e - e, l.n - n) < 6)) contourLabels.push({ e, n, elev: c2.elev, text: c2.elev.toLocaleString("en-IN") + " m" });
        }
      }
    }
    const streams = {};
    for (const st of d.streams) streams[st.order] = (streams[st.order] || "") + toD(unpack(st.path));
    const districts = d.districts.map((x) => {
      const rings = x.rings.map(unpack);
      const all = rings.flat();
      return { name: x.name, state: x.state, d: rings.map((r2) => toD(r2, true)).join(""), ce: all.reduce((s2, p2) => s2 + p2[0], 0) / all.length, cn: all.reduce((s2, p2) => s2 + p2[1], 0) / all.length };
    });
    return { e0, n0, e1, n1, W: e1 - e0, H: n1 - n0, terrain: d.terrain.href, contours, contourLabels, streams, districts, peaks: d.peaks, attribution: d.attribution, step: d.contour_step };
  }
  var mapSeq = 0;
  function mapBlock(opts) {
    const id = "m" + ++mapSeq;
    const box = h(
      "div",
      { class: "mapbox", "data-map": id },
      h(
        "div",
        { class: "mapframe", tabindex: 0, "aria-label": "Map of Wokha district. Use plus and minus keys to zoom, arrow keys to move." },
        s("svg", { class: "map", role: "img", "aria-label": "Map of villages and open incidents" }),
        h(
          "div",
          { class: "mapctl" },
          h("button", { type: "button", "data-z": "in", "aria-label": "Zoom in" }, "+"),
          h("button", { type: "button", "data-z": "out", "aria-label": "Zoom out" }, "−"),
          h("button", { type: "button", "data-z": "fit", "aria-label": "Fit to area" }, "⤢")
        ),
        h("div", { class: "scalebar", "aria-hidden": "true" }, h("i"), h("span"))
      ),
      mapLegend(opts.radius)
    );
    loadLayers().then((L) => {
      if (box.isConnected) drawMap(box, opts, L);
    });
    return box;
  }
  function mapLegend(radius) {
    const key = (cls, label) => h("span", null, h("i", { class: cls }), label);
    return [
      h(
        "div",
        { class: "legend" },
        key("dotk critical", "Critical"),
        key("dotk high", "High"),
        key("dotk medium", "Medium"),
        key("dotk low", "Low"),
        key("vk", "Village"),
        key("vk unv", "Village, position not verified"),
        radius ? key("lk ring", `Your ${radius} km alert area`) : null,
        key("lk water", "Stream"),
        key("lk ct", "Contour, 100 m"),
        key("lk dist", "District boundary")
      ),
      h("details", { class: "attrib" }, h("summary", null, "Map sources"), h("p", { "data-attrib": true }))
    ];
  }
  function drawMap(box, { incidents = [], home, radius = 0, focus = null }, L) {
    const svg = $("svg", box), frame = $(".mapframe", box);
    const V = state.meta.villages;
    const vp = V.map((v) => utmKm(v.lat, v.lng));
    const ip = incidents.map((i) => utmKm(i.lat, i.lng));
    const all = [...vp, ...ip];
    const e0 = L ? L.e0 : Math.min(...all.map((p2) => p2[0])) - 15, n1 = L ? L.n1 : Math.max(...all.map((p2) => p2[1])) + 15;
    const W = L ? L.W : 30 + Math.max(...all.map((p2) => p2[0])) - Math.min(...all.map((p2) => p2[0])), H = L ? L.H : 30 + Math.max(...all.map((p2) => p2[1])) - Math.min(...all.map((p2) => p2[1]));
    const X = ([e]) => e - e0, Y = ([, n]) => n1 - n;
    const hv = V.find((v) => v.name === home);
    const f2 = (v) => v.toFixed(3);
    const mapId = box.dataset.map;
    const base = [
      s("defs", null, s("marker", { id: `arrow-${mapId}`, viewBox: "0 0 10 10", refX: 5, refY: 5, markerWidth: 4, markerHeight: 4, orient: "auto-start-reverse" }, s("path", { class: "arrowhead", d: "M0 0 10 5 0 10z" }))),
      s("rect", { class: "land", x: -W, y: -H, width: 3 * W, height: 3 * H })
    ];
    if (L) {
      const wokha = L.districts.find((d) => d.name === "Wokha");
      base.push(s("image", { class: "relief", href: L.terrain, x: 0, y: 0, width: W, height: H, preserveAspectRatio: "none" }));
      if (wokha) base.push(s("path", { class: "outside", "fill-rule": "evenodd", d: `M${-W},${-H}H${2 * W}V${2 * H}H${-W}Z${wokha.d}` }));
      base.push(s("path", { class: "ct", d: L.contours.minor }), s("path", { class: "ct idx", d: L.contours.index }));
      for (const [o, d] of Object.entries(L.streams)) base.push(s("path", { class: `water o${o}`, d }));
      for (const d of L.districts) if (d.name !== "Wokha") base.push(s("path", { class: `dist ${d.state === "Assam" ? "assam" : ""}`, d: d.d }));
      if (wokha) base.push(s("path", { class: "dist wokha", d: wokha.d }));
    }
    const gridG = s("g", { class: "grid" });
    base.push(gridG);
    if (hv && radius) {
      const ring = Array.from({ length: 73 }, (_, k) => utmKm(...destination(hv.lat, hv.lng, radius, k * 5)));
      base.push(s("path", { class: "ring", d: `M${ring.map((p2) => `${f2(X(p2))},${f2(Y(p2))}`).join("L")}Z` }));
    }
    const pins = [];
    const pin = (p2, inner, cls = "") => pins.push(s("g", { class: `pin ${cls}`, "data-x": f2(X(p2)), "data-y": f2(Y(p2)) }, inner));
    if (L) {
      for (const d of L.districts) if (d.name !== "Wokha") pin([d.ce, d.cn], [s("text", { class: "dname", "data-pri": 7, "text-anchor": "middle" }, d.name.toUpperCase())], "dlabel");
      for (const c2 of L.contourLabels) pin([c2.e, c2.n], [s("text", { class: "clabel", "data-pri": 8, "text-anchor": "middle", y: 3 }, c2.text)], "clab");
      for (const pk of L.peaks) pin([pk.e, pk.n], [
        s("path", { class: "peak", d: "M0,-7 L6,4 L-6,4Z" }),
        s("text", { class: "plabel", "data-pri": 5, "text-anchor": "middle", y: 17 }, pk.name || ""),
        s("text", { class: "plabel elev", "data-pri": 6, "data-with-prev": 1, "text-anchor": "middle", y: 29 }, `${pk.elev.toLocaleString("en-IN")} m`)
      ]);
    }
    V.forEach((v, k) => {
      const isHome = v.name === home;
      pin(vp[k], [
        s("circle", { class: `vdot${isHome ? " home" : ""}${v.verified ? "" : " unv"}`, r: isHome ? 6 : 4.5 }),
        s("text", { class: `vlabel${isHome ? " home" : ""}`, "data-pri": isHome ? 0 : v.verified ? 3 : 4, x: 9, y: 4 }, v.name),
        s("title", null, `${v.name}: ${v.verified ? v.source : "position not verified"}`)
      ], "vpin");
    });
    const dirs = state.meta.directions;
    incidents.forEach((i, k) => {
      const r2 = 7 + Math.min(i.herd_size || 0, 20) * 0.35;
      let arrow = null;
      if (i.heading) {
        const a = dirs.indexOf(i.heading) * 45 * Math.PI / 180, s0 = r2 + 2, s1 = r2 + 24;
        arrow = s("line", { class: "heading", "marker-end": `url(#arrow-${mapId})`, x1: (Math.sin(a) * s0).toFixed(1), y1: (-Math.cos(a) * s0).toFixed(1), x2: (Math.sin(a) * s1).toFixed(1), y2: (-Math.cos(a) * s1).toFixed(1) });
      }
      const label = `${i.type_label}, ${i.severity_label} severity, near ${i.village}, ${ago(i.created_at)}`;
      pin(ip[k], [arrow, s("a", { href: `#/case/${i.id}`, "aria-label": label }, s("title", null, label), s("circle", { class: `inc ${i.severity}${i.id === focus ? " focus" : ""}`, r: r2.toFixed(1) }))], "ipin");
    });
    base.push(s("g", { class: "pins" }, pins));
    svg.replaceChildren(...base);
    const attrib = $maybe("[data-attrib]", box);
    if (attrib) attrib.textContent = L ? "UTM zone 46N grid, km. " + L.attribution.join(". ") + ". Mount Tiyi height from SRTM." : "Base map unavailable; showing villages and incidents only.";
    const pinEls = $$(".pin", svg).map((g) => ({ g, x: +g.dataset.x, y: +g.dataset.y }));
    const labels = $$("text[data-pri]", svg).sort((a, b) => +a.dataset.pri - +b.dataset.pri);
    const marks = $$(".inc, .vdot, .peak", svg);
    function declutter() {
      labels.forEach((t) => t.classList.remove("hidden-label"));
      const taken = marks.map((m) => m.getBoundingClientRect()).filter((r2) => r2.width);
      const hit = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
      for (const t of labels) {
        const r2 = t.getBoundingClientRect();
        if (!r2.width) continue;
        const prev = t.previousElementSibling;
        const orphan = t.dataset.withPrev && prev && prev.classList.contains("hidden-label");
        if (orphan || t.dataset.pri !== "0" && taken.some((x) => hit(r2, x))) t.classList.add("hidden-label");
        else taken.push(r2);
      }
    }
    let view = { x: 0, y: 0, w: 0 };
    let raf = 0;
    const aspect = () => (frame.clientHeight || 300) / (frame.clientWidth || 400);
    function fit() {
      const pts2 = [...incidents.length ? ip : [], ...hv ? [utmKm(hv.lat, hv.lng)] : []];
      if (hv && radius) {
        const c2 = utmKm(hv.lat, hv.lng);
        pts2.push([c2[0] - radius, c2[1] - radius], [c2[0] + radius, c2[1] + radius]);
      }
      if (!pts2.length || focus && ip.length === 1 && !radius) pts2.push(...focus ? [[ip[0][0] - 4, ip[0][1] - 4], [ip[0][0] + 4, ip[0][1] + 4]] : vp);
      const xs = pts2.map(X), ys = pts2.map(Y);
      let w = Math.max(8, Math.max(...xs) - Math.min(...xs) + 3);
      const h2 = Math.max(...ys) - Math.min(...ys) + 3;
      w = Math.max(w, h2 / aspect());
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      set({ x: cx - w / 2, y: cy - w * aspect() / 2, w });
    }
    function set(v) {
      const maxW = Math.max(W, H / aspect()) * 1.02;
      const w = Math.min(maxW, Math.max(1.5, v.w)), h2 = w * aspect();
      const x = w >= W ? (W - w) / 2 : Math.min(Math.max(v.x, -w * 0.1), W - w * 0.9);
      const y = h2 >= H ? (H - h2) / 2 : Math.min(Math.max(v.y, -h2 * 0.1), H - h2 * 0.9);
      view = { x, y, w };
      svg.setAttribute("viewBox", `${x.toFixed(3)} ${y.toFixed(3)} ${w.toFixed(3)} ${h2.toFixed(3)}`);
      const k = w / (frame.clientWidth || 400);
      for (const p2 of pinEls) p2.g.setAttribute("transform", `translate(${p2.x} ${p2.y}) scale(${k.toFixed(5)})`);
      svg.classList.toggle("far", w > 30);
      svg.classList.toggle("mid", w > 9 && w <= 30);
      const step = [1, 2, 5, 10, 20].find((st) => w / st <= 8) || 20;
      const g = [];
      for (let gx = Math.ceil((e0 + x) / step) * step; gx <= e0 + x + w; gx += step) {
        const sx = gx - e0;
        g.push(s("line", { x1: sx, y1: y, x2: sx, y2: y + h2 }), s("text", { x: sx + 3 * k, y: y + 12 * k, "font-size": (10 * k).toFixed(4) }, `${gx}E`));
      }
      for (let gy = Math.ceil((n1 - y - h2) / step) * step; gy <= n1 - y; gy += step) {
        const sy = n1 - gy;
        g.push(s("line", { x1: x, y1: sy, x2: x + w, y2: sy }), s("text", { x: x + 3 * k, y: sy - 3 * k, "font-size": (10 * k).toFixed(4) }, `${gy}N`));
      }
      gridG.replaceChildren(...g);
      svg.style.setProperty("--gs", `${(3 * k).toFixed(4)}px`);
      const target = 90 * k, nice = [0.25, 0.5, 1, 2, 5, 10, 20, 50].find((st) => st >= target * 0.6) || 50;
      const sb = $(".scalebar", box);
      $("i", sb).style.width = `${(nice / k).toFixed(0)}px`;
      $("span", sb).textContent = nice < 1 ? `${nice * 1e3} m` : `${nice} km`;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(declutter);
    }
    const zoomAt = (factor, px, py) => {
      const r2 = frame.getBoundingClientRect();
      const fx = px === void 0 ? 0.5 : (px - r2.left) / r2.width, fy = py === void 0 ? 0.5 : (py - r2.top) / r2.height;
      const w = view.w * factor, h0 = view.w * aspect();
      set({ x: view.x + fx * (view.w - w), y: view.y + fy * (h0 - w * aspect()), w });
    };
    $(".mapctl", box).onclick = (e) => {
      const b = e.target.closest("[data-z]");
      if (!b) return;
      if (b.dataset.z === "fit") fit();
      else zoomAt(b.dataset.z === "in" ? 0.6 : 1 / 0.6);
    };
    frame.addEventListener("wheel", (e) => {
      if (!e.ctrlKey && document.activeElement !== frame) return;
      e.preventDefault();
      zoomAt(Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 15e-4)), e.clientX, e.clientY);
    }, { passive: false });
    frame.addEventListener("dblclick", (e) => {
      e.preventDefault();
      zoomAt(0.5, e.clientX, e.clientY);
    });
    frame.addEventListener("keydown", (e) => {
      const k = view.w / 6;
      const keys = {
        "+": () => zoomAt(0.7),
        "=": () => zoomAt(0.7),
        "-": () => zoomAt(1 / 0.7),
        "0": fit,
        ArrowLeft: () => set({ ...view, x: view.x - k }),
        ArrowRight: () => set({ ...view, x: view.x + k }),
        ArrowUp: () => set({ ...view, y: view.y - k }),
        ArrowDown: () => set({ ...view, y: view.y + k })
      };
      if (keys[e.key]) {
        e.preventDefault();
        keys[e.key]();
      }
    });
    const pts = /* @__PURE__ */ new Map();
    let last = null, moved = 0;
    svg.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) for (const id of pts.keys()) svg.setPointerCapture(id);
      last = null;
      moved = 0;
    });
    svg.addEventListener("pointermove", (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (e.pointerType !== "mouse" && pts.size < 2) return;
      const ps = [...pts.values()];
      const cx = ps.reduce((sum, p2) => sum + p2.x, 0) / ps.length, cy = ps.reduce((sum, p2) => sum + p2.y, 0) / ps.length;
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
    const up = (e) => {
      pts.delete(e.pointerId);
      last = null;
    };
    svg.addEventListener("pointerup", up);
    svg.addEventListener("pointercancel", up);
    svg.addEventListener("click", (e) => {
      if (moved > 6) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
    new ResizeObserver(() => {
      if (view.w) set(view);
    }).observe(frame);
    fit();
  }

  // src/media.ts
  var _a;
  var canCapture = typeof ((_a = navigator.mediaDevices) == null ? void 0 : _a.getUserMedia) === "function";
  var live = { camera: canCapture, mic: canCapture && typeof window.MediaRecorder === "function" };
  var dataUrl = (mime, b64) => `data:${mime};base64,${b64}`;
  var blobToB64 = (blob) => new Promise((ok, fail) => {
    const r2 = new FileReader();
    r2.onload = () => ok(String(r2.result).split(",")[1] || "");
    r2.onerror = () => fail(r2.error);
    r2.readAsDataURL(blob);
  });
  function pickFile(accept, capture) {
    return new Promise((resolve) => {
      const input = h("input", { type: "file", accept, capture, hidden: true });
      input.onchange = () => {
        resolve(input.files && input.files[0] || null);
        input.remove();
      };
      input.addEventListener("cancel", () => {
        resolve(null);
        input.remove();
      });
      document.body.append(input);
      input.click();
    });
  }
  var badPhoto = () => new ApiErr(415, "That photo couldn't be opened. Try a JPEG or PNG.", "attachments");
  async function photoFromSource(source) {
    let img;
    if (source instanceof Blob) {
      try {
        img = await createImageBitmap(source);
      } catch {
        img = await new Promise((ok, fail) => {
          const el = new Image();
          el.onload = () => ok(el);
          el.onerror = () => fail(badPhoto());
          el.src = URL.createObjectURL(source);
        });
      }
    } else img = source;
    const w = "videoWidth" in img && img.videoWidth || "naturalWidth" in img && img.naturalWidth || img.width;
    const ht = "videoHeight" in img && img.videoHeight || "naturalHeight" in img && img.naturalHeight || img.height;
    if (!w || !ht) throw badPhoto();
    const k = Math.min(1, 1600 / Math.max(w, ht));
    const canvas = h("canvas");
    canvas.width = Math.round(w * k);
    canvas.height = Math.round(ht * k);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((ok) => canvas.toBlob(ok, "image/jpeg", 0.82));
    if (!blob) throw badPhoto();
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
  async function liveCamera() {
    let facing = "environment", stream;
    const video = h("video", { playsinline: true, muted: true, autoplay: true });
    video.muted = true;
    const still = h("img", { alt: "Photo you just took", hidden: true });
    const shoot = h("button", { type: "button", class: "shutter", "data-shoot": true, "aria-label": "Take photo" });
    const use = h("button", { type: "button", class: "btn primary", "data-use": true }, "Use photo");
    const bar = h(
      "div",
      { class: "cam-bar" },
      h("button", { type: "button", class: "cam-btn", "data-close": true, "aria-label": "Close camera" }, icon("x")),
      shoot,
      h("button", { type: "button", class: "cam-btn", "data-flip": true, "aria-label": "Switch camera" }, icon("flip"))
    );
    const reviewBar = h(
      "div",
      { class: "cam-bar", hidden: true, "data-review": true },
      h("button", { type: "button", class: "btn", "data-retake": true }, "Retake"),
      use
    );
    const box = h("div", { class: "cam", role: "dialog", "aria-modal": "true", "aria-label": "Camera" }, video, still, bar, reviewBar);
    const open = async () => {
      stream == null ? void 0 : stream.getTracks().forEach((t) => t.stop());
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false });
      video.srcObject = stream;
      await video.play().catch(() => {
      });
    };
    document.body.append(box);
    try {
      await open();
    } catch (e) {
      box.remove();
      throw e;
    }
    shoot.focus();
    return new Promise((resolve) => {
      let shot = null;
      const done = (val) => {
        stream == null ? void 0 : stream.getTracks().forEach((t) => t.stop());
        box.remove();
        document.removeEventListener("keydown", onKey);
        resolve(val);
      };
      const onKey = (e) => {
        if (e.key === "Escape") done(null);
      };
      document.addEventListener("keydown", onKey);
      const review = (on) => {
        video.hidden = on;
        still.hidden = !on;
        bar.hidden = on;
        reviewBar.hidden = !on;
      };
      box.onclick = async (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        if (b.matches("[data-close]")) done(null);
        else if (b.matches("[data-flip]")) {
          facing = facing === "environment" ? "user" : "environment";
          open().catch(() => toast("Couldn't switch camera"));
        } else if (b.matches("[data-shoot]")) {
          shot = await photoFromSource(video);
          still.src = shot.url;
          review(true);
          use.focus();
        } else if (b.matches("[data-retake]")) {
          shot = null;
          review(false);
        } else if (b.matches("[data-use]")) done(shot);
      };
    });
  }
  async function takePhoto({ gallery = false } = {}) {
    if (!gallery && live.camera) {
      try {
        return await liveCamera();
      } catch {
        live.camera = false;
      }
    }
    const file = await pickFile("image/*", gallery ? null : "environment");
    return file ? photoFromSource(file) : null;
  }
  function voiceRecorder(host, onDone) {
    const max = state.meta.media.voice_max_seconds;
    let rec = null, timer, started = 0;
    const idle = () => {
      clearInterval(timer);
      fill(host, h("button", { type: "button", class: "btn", "data-rec": true }, icon("mic"), " Record voice note"));
    };
    const fail = (msg) => {
      idle();
      toast(msg);
    };
    async function start() {
      if (!live.mic) return fallback();
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      } catch {
        live.mic = false;
        return fallback();
      }
      const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((t) => {
        var _a2;
        return (_a2 = MediaRecorder.isTypeSupported) == null ? void 0 : _a2.call(MediaRecorder, t);
      });
      const chunks = [];
      const r2 = rec = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32e3 } : void 0);
      r2.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      r2.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        clearInterval(timer);
        try {
          onDone(await voiceFromBlob(new Blob(chunks, { type: r2.mimeType || type || "audio/webm" })));
          idle();
        } catch (err) {
          fail(asErr(err).message);
        }
      };
      r2.start(250);
      started = Date.now();
      const time = h("b", { class: "tnum", "data-time": true }, "0:00");
      const stop = h("button", { type: "button", class: "btn primary", "data-stop": true }, icon("stop"), " Stop and keep");
      fill(host, h(
        "div",
        { class: "recording", role: "status" },
        h("span", { class: "rec-dot", "aria-hidden": "true" }),
        time,
        h("span", { class: "small muted" }, `of ${max / 60}:00`),
        stop
      ));
      stop.focus();
      timer = setInterval(() => {
        const s2 = Math.floor((Date.now() - started) / 1e3);
        if (host.contains(time)) time.textContent = `${Math.floor(s2 / 60)}:${String(s2 % 60).padStart(2, "0")}`;
        if (s2 >= max && r2.state === "recording") r2.stop();
      }, 250);
    }
    async function fallback() {
      const file = await pickFile("audio/*", "user");
      if (!file) return;
      try {
        onDone(await voiceFromBlob(file));
      } catch (err) {
        fail(asErr(err).message);
      }
    }
    host.addEventListener("click", (e) => {
      const t = e.target;
      if (t.closest("[data-rec]")) start();
      else if (t.closest("[data-stop]") && (rec == null ? void 0 : rec.state) === "recording") rec.stop();
    });
    idle();
    return { stop: () => {
      if ((rec == null ? void 0 : rec.state) === "recording") rec.stop();
    } };
  }
  var mediaTiles = (items, removable) => items.map((m, k) => [m, k]).sort((a, b) => (a[0].kind === "photo" ? 0 : 1) - (b[0].kind === "photo" ? 0 : 1)).map(([m, k]) => {
    var _a2, _b;
    return m.kind === "photo" ? h(
      "figure",
      { class: "thumb" },
      h(
        "button",
        { type: "button", class: "thumb-open", "data-view": k, "aria-label": `View photo ${k + 1}` },
        h("img", { alt: "", src: m.url || null, "data-att": (_a2 = m.id) != null ? _a2 : "" })
      ),
      removable && h("button", { type: "button", class: "thumb-x", "data-remove": k, "aria-label": "Remove photo" }, icon("x"))
    ) : h(
      "div",
      { class: "voice" },
      icon("mic"),
      h("audio", { controls: true, preload: "metadata", src: m.url || null, "data-att": (_b = m.id) != null ? _b : "", "aria-label": `Voice note ${k + 1}` }),
      h("span", { class: "small muted tnum" }, kb(m.size)),
      removable && h("button", { type: "button", class: "btn small", "data-remove": k }, "Remove")
    );
  });
  function lightbox(src) {
    const btn = h("button", { type: "button", class: "cam-btn", "aria-label": "Close" }, icon("x"));
    const box = h("div", { class: "lightbox", role: "dialog", "aria-label": "Photo" }, h("img", { alt: "Report photo", src }), btn);
    const close = () => {
      box.remove();
      document.removeEventListener("keydown", onKey);
    };
    const onKey = (e) => {
      if (e.key === "Escape") close();
    };
    box.onclick = close;
    document.addEventListener("keydown", onKey);
    document.body.append(box);
    btn.focus();
  }
  function hydrateMedia(root) {
    $$("[data-att]", root).forEach(async (el) => {
      if (!el.dataset.att || el.getAttribute("src")) return;
      try {
        const a = await api("GET", `/api/attachments/${el.dataset.att}`);
        el.src = dataUrl(a.mime, a.data);
      } catch {
        el.replaceWith(h("span", { class: "small muted" }, "File unavailable"));
      }
    });
  }

  // src/views/cases.ts
  async function viewCases() {
    const staff = isStaff();
    const main = loading("cases");
    const qs = staff ? `status=${state.casesFilter}${state.casesVillage ? `&village=${encodeURIComponent(state.casesVillage)}` : ""}` : "mine=1&status=all";
    let rows;
    try {
      rows = await api("GET", "/api/incidents?" + qs);
    } catch (err) {
      return failure(main, asErr(err));
    }
    const filters = [["open", "Open"], ["closed", "Closed"], ["all", "All"]];
    fill(
      main,
      h(
        "div",
        { class: "pagehead" },
        h("h1", null, staff ? "Cases" : "My reports"),
        h("p", { class: "muted" }, staff ? "Check new reports first. Oldest unchecked cases need attention." : "Follow what the forest staff are doing about your reports.")
      ),
      staff && h(
        "div",
        { class: "row between" },
        h("div", { class: "seg", role: "group", "aria-label": "Status" }, filters.map(([k, l]) => h("button", {
          type: "button",
          "data-filter": k,
          "aria-pressed": String(state.casesFilter === k),
          on: { click() {
            state.casesFilter = k;
            viewCases();
          } }
        }, l))),
        h("select", {
          id: "cases-village",
          class: "narrow",
          "aria-label": "Filter by village",
          on: { change() {
            state.casesVillage = this.value;
            viewCases();
          } }
        }, h("option", { value: "" }, "All villages"), state.meta.villages.map((v) => h("option", { selected: v.name === state.casesVillage }, v.name)))
      ),
      h("section", { class: "card flush divide" }, rows.length ? rows.map((i) => incidentItem(i)) : h(
        "div",
        { class: "empty" },
        h("b", null, "Nothing here"),
        h("span", null, staff ? "No cases match this filter." : "Reports you send will appear here."),
        !staff && h("a", { class: "btn primary", href: "#/report" }, "Report elephants")
      )),
      h("p", { class: "small muted tnum" }, plural(rows.length, "case"))
    );
  }
  var VERBS = { verified: "Mark verified", responded: "Mark team responded", resolved: "Close as resolved", false_report: "Mark false report" };
  async function viewCase(id) {
    const main = loading("cases");
    let i;
    try {
      i = await api("GET", `/api/incidents/${id}`);
    } catch (err) {
      return failure(main, asErr(err));
    }
    const staff = isStaff();
    const facts = [
      ["Elephants", i.herd_size || "Not given"],
      ["Heading", i.heading || "Not given"],
      ["Village", i.village],
      ["Landmark", i.place || "—"],
      ["Reported", when(i.created_at)],
      ["Location", h("span", { class: "mono" }, `${i.lat.toFixed(4)}, ${i.lng.toFixed(4)}`)]
    ];
    if (i.casualties) facts.push(["People hurt", i.casualties]);
    if (i.crop_acres) facts.push(["Crops", `${i.crop_acres} acres`]);
    if (i.property_inr) facts.push(["Property loss", inr(i.property_inr)]);
    if (i.reporter) facts.push(["Reported by", [i.reporter.name, h("br"), h("span", { class: "mono small" }, i.reporter.phone), !i.reporter.phone_verified && [h("br"), h("span", { class: "tag" }, "Phone not verified")]]]);
    main.classList.add("wide");
    const note = h("textarea", { id: "act-note", maxlength: 500 });
    let form = null;
    if (staff) {
      const f = form = h(
        "form",
        { class: "card", id: "act", novalidate: true },
        h("h2", null, "Staff action"),
        field("note", ["Note ", h("small", null, "(team sent, damage seen, advice given)")], note),
        h("div", { "data-errors": true }),
        h(
          "div",
          { class: "row" },
          i.next.map((st) => h("button", { type: "button", class: `btn ${st === "false_report" ? "" : "primary"}`, "data-status": st }, VERBS[st])),
          h("button", { type: "button", class: "btn", "data-status": "" }, "Add note only")
        ),
        i.open && h(
          "div",
          { class: "row between split" },
          h("span", { class: "small muted" }, "Tell villages within 5 km."),
          h("button", { type: "button", class: "btn", id: "warn", on: { click: () => warn() } }, "Warn nearby villages")
        )
      );
      $$("[data-status]", f).forEach((b) => b.onclick = async () => {
        try {
          await api("PATCH", `/api/incidents/${i.id}`, { status: b.dataset.status || null, note: note.value });
          toast(b.dataset.status ? "Status updated" : "Note added");
          viewCase(String(i.id));
        } catch (err) {
          showErrors(f, asErr(err));
        }
      });
    }
    const warn = async () => {
      const near = await api("GET", `/api/incidents/${i.id}/villages?km=5`);
      const herd = i.herd_size ? `About ${plural(i.herd_size, "elephant")}` : "Elephants";
      const where = `near ${i.village}${i.place ? ` (${i.place})` : ""}`;
      state.prefill = {
        level: "warning",
        incident_id: i.id,
        villages: near.map((v) => v.name),
        message: `${herd} reported ${where}${i.heading ? `, moving ${i.heading}` : ""}. Keep away from the fields and stay indoors after dark.`
      };
      location.hash = "#/alerts";
    };
    fill(
      main,
      h(
        "div",
        { class: "pagehead" },
        h("a", { class: "small", href: "#/cases" }, `← ${staff ? "Cases" : "My reports"}`),
        h("div", { class: "row between" }, h("h1", null, i.type_label), sevPill(i.severity, i.severity_label)),
        h("p", { class: "muted" }, h("span", { class: "mono" }, i.ref), ` · ${i.status_label}`, i.sample && [" · ", h("span", { class: "tag" }, "Sample")])
      ),
      h(
        "div",
        { class: "two-col" },
        h(
          "div",
          { class: "col" },
          h("section", { class: "card flush" }, mapBlock({ incidents: [i], home: me().village, focus: i.id })),
          h(
            "section",
            { class: "card" },
            h("dl", { class: "facts" }, facts.map(([k, v]) => h("div", null, h("dt", null, k), h("dd", null, v)))),
            i.description && h("p", { translate: "no" }, i.description)
          ),
          i.attachments_hidden > 0 && h("p", { class: "small muted" }, `${plural(i.attachments_hidden, "photo or voice note", "photos or voice notes")}, seen only by the reporter and forest staff.`),
          (i.attachments.length > 0 || i.can_attach) && h(
            "section",
            { class: "card", id: "case-media" },
            h("h2", null, "Photos and voice notes"),
            i.attachments.length ? h("div", { class: "thumbs" }, mediaTiles(i.attachments, false)) : h("p", { class: "small muted" }, "None yet."),
            i.can_attach && h("div", { class: "row" }, h("button", { type: "button", class: "btn small", id: "case-cam" }, icon("camera"), " Add photo"), h("span", { id: "case-voice" }))
          )
        ),
        h(
          "div",
          { class: "col" },
          h(
            "section",
            { class: "card" },
            h("h2", null, "What has happened"),
            h("ol", { class: "timeline" }, i.events.map((e, k) => h(
              "li",
              null,
              h("span", { class: "dot" }),
              h(
                "div",
                null,
                h("b", null, k && e.status === i.events[k - 1].status ? "Update" : e.status_label),
                " ",
                h("span", { class: "small muted" }, when(e.at), e.by ? ` · ${e.by}` : ""),
                e.note && h("p", { translate: "no" }, e.note)
              )
            )))
          ),
          form
        )
      )
    );
    const mediaBox = $maybe("#case-media", main);
    if (mediaBox) {
      hydrateMedia(mediaBox);
      mediaBox.addEventListener("click", (e) => {
        const view = e.target.closest("[data-view]");
        const img = view && view.querySelector("img");
        if (img == null ? void 0 : img.src) lightbox(img.src);
      });
      const upload = async (item) => {
        if (!item) return;
        try {
          await api("POST", `/api/incidents/${i.id}/attachments`, { kind: item.kind, data: item.data });
          toast(item.kind === "photo" ? "Photo added" : "Voice note added");
          viewCase(String(i.id));
        } catch (err) {
          toast(asErr(err).message);
        }
      };
      const cam = $maybe("#case-cam", main);
      if (cam) {
        cam.onclick = async () => {
          try {
            upload(await takePhoto());
          } catch (err) {
            toast(asErr(err).message);
          }
        };
        const rec = voiceRecorder($maybe("#case-voice", main), upload);
        window.addEventListener("hashchange", () => rec.stop(), { once: true });
      }
    }
  }

  // src/views/guide.ts
  function viewGuide() {
    const { safety, contacts, compensation } = state.meta;
    const list = (items, markText) => h("ul", { class: "stack plain" }, items.map((i) => h(
      "li",
      { class: "row top" },
      h("b", { "aria-hidden": "true" }, markText),
      h(
        "div",
        { class: "grow" },
        h("p", null, i.text),
        isNag() ? h("p", { class: "small muted", translate: "no" }, h("i", null, i.text)) : i.local ? h("p", { class: "small muted" }, h("i", null, i.local)) : null
      )
    )));
    shell(
      "more",
      h("div", { class: "pagehead" }, h("a", { class: "small", href: "#/more" }, "← More"), h("h1", null, "Safety and help")),
      h(
        "div",
        { class: "grid2" },
        h("section", { class: "card" }, h("h2", null, "Do"), list(safety.do, "✓")),
        h("section", { class: "card" }, h("h2", null, "Don't"), list(safety.dont, "✕"))
      ),
      h(
        "section",
        { class: "card flush divide" },
        h("div", { class: "item" }, h("h2", null, "Emergency numbers")),
        contacts.map((c2, k) => h(
          "div",
          { class: "item" },
          h("h3", null, c2.name),
          h("button", { type: "button", class: "btn small", "data-copy": k, "aria-label": `Copy ${c2.name} number`, on: { click: () => copy(c2.phone.replace(/\s/g, "")) } }, icon("copy")),
          h(
            "div",
            { class: "meta" },
            h("span", { class: "mono" }, c2.phone),
            h("span", null, c2.role),
            c2.placeholder && h("span", { class: "tag" }, "Placeholder, not a real line")
          )
        ))
      ),
      h(
        "section",
        { class: "card" },
        h("h2", null, "Compensation (ex-gratia)"),
        h("dl", { class: "facts" }, compensation.rates.map((r2) => h("div", null, h("dt", null, r2.item), h("dd", null, r2.amount)))),
        h("p", { class: "small muted" }, compensation.note),
        h(
          "div",
          { class: "grid2" },
          h("div", { class: "stack" }, h("h3", null, "How to claim"), h("ol", { class: "stack indent" }, compensation.steps.map((st) => h("li", null, st)))),
          h("div", { class: "stack" }, h("h3", null, "Bring"), h("ul", { class: "stack indent" }, compensation.documents.map((st) => h("li", null, st))))
        )
      )
    );
  }

  // src/views/home.ts
  async function viewHome() {
    const main = loading("home");
    let o, open;
    try {
      [o, open] = await Promise.all([api("GET", "/api/overview"), api("GET", "/api/incidents?status=open")]);
    } catch (err) {
      return failure(main, asErr(err));
    }
    const w = o.warning;
    const u = me();
    main.classList.add("wide");
    const askButton2 = () => h("button", { class: "btn small", "data-ask": true }, "Remove sample data");
    const sample = o.has_sample && u.role === "officer" ? h("span", { class: "confirm", id: "sample" }, askButton2()) : null;
    fill(main, h(
      "div",
      { class: "two-col" },
      h(
        "div",
        { class: "col" },
        w && h(
          "a",
          { class: "warning", href: "#/alerts" },
          h("span", { class: "label" }, `Elephant warning · ${o.village.name}`),
          h("p", { translate: "no" }, w.message),
          h("span", { class: "small muted" }, ago(w.sent_at), w.by ? ` · ${w.by}` : "")
        ),
        h(
          "div",
          { class: "pagehead" },
          h("span", { class: "label" }, `Within ${o.radius_km} km of ${o.village.name}`),
          h("h1", null, o.nearby.length ? `${plural(o.nearby.length, "open incident")} near you` : "No open incidents near you")
        ),
        o.nearby.length ? h("section", { class: "card flush divide" }, o.nearby.slice(0, 5).map((i) => incidentItem(i, `${i.km} km ${i.dir} of ${o.village.name}`))) : h("p", { class: "muted" }, o.open_total ? `${plural(o.open_total, "open incident")} elsewhere in the district.` : "All quiet across the district.", " You'll see new reports here."),
        h(
          "div",
          { class: "notice", id: "queue-note", hidden: true },
          h("span", null, "Waiting to send: ", h("b", { "data-count": true }), ". They go automatically when you're back online."),
          h("button", { class: "btn small", id: "flush", on: { click: () => flushQueue() } }, "Send now")
        ),
        h(
          "div",
          { class: "actions" },
          h("a", { class: "action primary", href: "#/report" }, icon("report"), h("span", null, "Report elephants")),
          h("a", { class: "action", href: "#/report/camera" }, icon("camera"), h("span", null, "Snap a photo and report"))
        ),
        isStaff() && h(
          "div",
          { class: "kpis three late" },
          h("div", { class: "kpi" }, h("small", null, "Open in district"), h("b", null, o.open_total)),
          h("div", { class: "kpi" }, h("small", null, "Waiting for a check"), h("b", null, o.awaiting_check)),
          h("div", { class: "kpi" }, h("small", null, "Reported in 24 h"), h("b", null, o.reported_24h))
        ),
        sample && h("div", { class: "notice late" }, h("span", null, "Sample incidents are loaded so you can try the app."), sample)
      ),
      h("div", { class: "col sticky-col" }, h("section", { class: "card flush" }, mapBlock({ incidents: open, home: o.village.name, radius: o.radius_km })))
    ));
    flushQueue();
    notify.check();
    if (sample) {
      sample.onclick = async (e) => {
        const t = e.target;
        if (t.matches("[data-ask]")) fill(sample, h("span", { class: "small" }, "Delete all sample incidents and alerts?"), h("button", { class: "btn small danger", "data-yes": true }, "Delete"), h("button", { class: "btn small", "data-no": true }, "Keep"));
        else if (t.matches("[data-no]")) fill(sample, askButton2());
        else if (t.matches("[data-yes]")) {
          await api("DELETE", "/api/sample");
          toast("Sample data removed");
          viewHome();
        }
      };
    }
  }

  // src/theme.ts
  var THEMES = [
    { key: "green", label: "Green", note: "Follows your phone's light or dark mode" },
    { key: "white", label: "White", note: "Bright, for outdoors in daylight" },
    { key: "dark", label: "Dark", note: "Black and grey, less glare at night" },
    { key: "navy", label: "Navy blue", note: "Deep blue with sky-blue buttons" }
  ];
  var currentTheme = () => {
    const saved = store.get("hatialert.theme");
    return THEMES.some((t) => t.key === saved) ? saved : "green";
  };
  function applyTheme(key) {
    const root = document.documentElement;
    if (key && key !== "green") root.dataset.skin = key;
    else delete root.dataset.skin;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = getComputedStyle(root).getPropertyValue("--bg").trim() || meta.content;
  }

  // src/views/more.ts
  var askButton = () => h("button", { class: "btn", "data-ask": true }, "Sign out other devices");
  function viewMore() {
    const u = me();
    const smsOn = h("input", { type: "checkbox", id: "sms-on", checked: u.sms_alerts });
    const notifyOn = notify.supported ? h("input", { type: "checkbox", id: "notify-on", checked: notify.on() }) : null;
    const name = h("input", { id: "prof-name", type: "text", maxlength: 60, value: u.name });
    const village = h("select", { id: "prof-village" }, state.meta.villages.map((v) => h("option", { selected: v.name === u.village }, v.name)));
    const radius = h("select", { id: "prof-radius" }, [1, 2, 3, 5, 8, 10, 15].map((k) => h("option", { value: k, selected: k === u.radius_km }, `${k} km`)));
    const logoutAll = h("div", { class: "confirm", id: "logout-all" }, askButton());
    const prof = h(
      "form",
      { class: "card", id: "prof", novalidate: true },
      h("h2", null, "Your settings"),
      field("name", "Name", name),
      h(
        "div",
        { class: "grid2" },
        field("village", "Home village", village),
        field("radius_km", "Show incidents within", radius)
      ),
      h("div", { "data-errors": true }),
      h("div", null, h("button", { class: "btn primary", type: "submit" }, "Save"))
    );
    const item = (href, title, meta) => h("a", { class: "item", href }, h("h3", null, title), h("span", { class: "muted" }, "→"), h("div", { class: "meta" }, meta));
    const main = shell(
      "more",
      h(
        "div",
        { class: "pagehead" },
        h("h1", null, u.name),
        h("p", { class: "muted" }, `${roleName[u.role]} · `, h("span", { class: "mono" }, u.phone), !u.phone_verified && [" · ", h("span", { class: "tag" }, "Phone not verified")])
      ),
      h(
        "section",
        { class: "card flush divide" },
        u.role === "officer" && [
          item("#/dashboard", "District overview", "Trends, hotspots, response times, CSV export"),
          item("#/admin", "Admin", "People, villages, text messages, backups")
        ],
        item("#/guide", "Safety and help", "What to do, emergency numbers, compensation")
      ),
      h(
        "section",
        { class: "card" },
        h("h2", { translate: "no" }, isNag() ? "Bhasa (Language)" : "Language (Bhasa)"),
        langPicker("lang-more"),
        isNag() && h("p", { class: "small muted", translate: "no" }, "Nagamese translation is a draft and has not been checked by a native speaker. Please tell the forest office about anything that reads wrong. / Etu Nagamese translation etiya kacha ase. Kiba bhul dikhile forest office ke kobi.")
      ),
      h(
        "section",
        { class: "card" },
        h("h2", { id: "theme-h" }, "Theme"),
        h("div", { class: "themes", role: "radiogroup", "aria-labelledby": "theme-h" }, THEMES.map((t) => h("button", {
          type: "button",
          class: "theme-opt",
          role: "radio",
          "data-skin-key": t.key,
          "aria-checked": String(currentTheme() === t.key),
          tabindex: currentTheme() === t.key ? 0 : -1
        }, h("span", { class: `swatch sw-${t.key}`, "aria-hidden": "true" }, h("i"), h("i"), h("i"), h("i")), h("b", null, t.label), h("small", null, t.note))))
      ),
      prof,
      h(
        "section",
        { class: "card" },
        h("h2", null, "Alerts"),
        h("label", { class: "switch" }, smsOn, h("span", null, `Text me alerts for ${u.village}`)),
        h("small", { class: "muted" }, state.meta.sms_enabled ? "Sent to your mobile number as SMS." : "Forest staff send these by hand until text messages are set up."),
        notifyOn && [
          h("label", { class: "switch" }, notifyOn, h("span", null, "Show alerts on this phone")),
          h("small", { class: "muted" }, "Works while HatiAlert is open or in the background. It can't wake a closed app, so keep text alerts on.")
        ]
      ),
      pinForm("cp", false, () => viewMore()),
      h(
        "section",
        { class: "card" },
        h("h2", null, "Signed-in devices"),
        h("p", { class: "small muted" }, "Lost a phone, or signed in on someone else's? Sign out everywhere except here."),
        logoutAll
      ),
      h(
        "div",
        { class: "row between" },
        h("button", {
          class: "btn danger",
          id: "out",
          on: { async click() {
            try {
              await api("POST", "/api/auth/logout");
            } catch {
            }
            signOutLocal();
            nav.router();
          } }
        }, "Sign out"),
        h("span", { class: "small muted" }, `Engine: ${transport.engine}`)
      )
    );
    smsOn.onchange = async () => {
      try {
        state.user = await api("PATCH", "/api/me", { sms_alerts: smsOn.checked });
        saveMe(state.user);
        toast(smsOn.checked ? "Text alerts on" : "Text alerts off");
      } catch (err) {
        smsOn.checked = !smsOn.checked;
        toast(asErr(err).message);
      }
    };
    if (notifyOn) notifyOn.onchange = async () => {
      if (notifyOn.checked) {
        let perm = Notification.permission;
        try {
          if (perm === "default") perm = await Notification.requestPermission();
        } catch {
          perm = "denied";
        }
        if (perm !== "granted") {
          notifyOn.checked = false;
          toast("This browser won't show notifications here");
          return;
        }
      }
      store.set("hatialert.notify", notifyOn.checked ? "1" : "0");
      toast(notifyOn.checked ? "Alerts will show on this phone" : "Phone alerts off");
      notify.check();
    };
    logoutAll.onclick = async (e) => {
      const t = e.target;
      if (t.matches("[data-ask]")) fill(logoutAll, h("span", { class: "small" }, "Sign out every other phone and browser?"), h("button", { class: "btn small danger", "data-yes": true }, "Sign them out"), h("button", { class: "btn small", "data-no": true }, "Cancel"));
      else if (t.matches("[data-no]")) fill(logoutAll, askButton());
      else if (t.matches("[data-yes]")) {
        try {
          await api("POST", "/api/me/logout-all");
          toast("Other devices signed out");
        } catch (err) {
          toast(asErr(err).message);
        }
        fill(logoutAll, askButton());
      }
    };
    const opts = $$("[data-skin-key]", main);
    const choose = (b, focus) => {
      const key = b.dataset.skinKey;
      store.set("hatialert.theme", key);
      applyTheme(key);
      opts.forEach((o) => {
        o.setAttribute("aria-checked", String(o === b));
        o.tabIndex = o === b ? 0 : -1;
      });
      if (focus) b.focus();
    };
    opts.forEach((b, k) => {
      b.onclick = () => {
        choose(b);
        toast(`Theme: ${THEMES[k].label}`);
      };
      b.onkeydown = (e) => {
        const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        if (d) {
          e.preventDefault();
          choose(opts[(k + d + opts.length) % opts.length], true);
        }
      };
    });
    prof.onsubmit = async (e) => {
      e.preventDefault();
      try {
        state.user = await api("PATCH", "/api/me", { name: name.value, village: village.value, radius_km: +radius.value });
        saveMe(state.user);
        toast("Saved");
        viewMore();
      } catch (err) {
        showErrors(prof, asErr(err));
      }
    };
  }

  // src/views/report.ts
  var DAMAGE_TYPES = ["crop_raid", "property_damage", "injury", "death"];
  function viewReport(mode) {
    const m = state.meta, u = me();
    const f = { media: [], type: mode === "camera" ? "sighting" : "", offset_dir: "", heading: "", lat: null, lng: null };
    const herd = h("input", { id: "rep-herd", type: "number", min: 0, max: 200, value: 1, "aria-label": "Number of elephants" });
    const village = h("select", { id: "rep-village" }, m.villages.map((v) => h("option", { selected: v.name === u.village }, v.name)));
    const km = h(
      "select",
      { id: "rep-km", "aria-label": "Distance from village", class: "grow" },
      h("option", { value: 0 }, "At the village"),
      [0.5, 1, 2, 3, 5, 8].map((k) => h("option", { value: k }, `${k} km away`))
    );
    const rose = h(
      "div",
      { class: "rose", id: "rep-rose", "aria-label": "Direction from the village" },
      ["NW", "N", "NE", "W", "", "E", "SW", "S", "SE"].map((d) => d ? h("button", { type: "button", "data-odir": d, "aria-pressed": "false" }, d) : h("span", { class: "centre", "aria-hidden": "true" }, "village"))
    );
    const gps = h("button", { type: "button", class: "btn small", id: "rep-gps" }, icon("pin"), " Use my GPS location instead");
    const gpsNote = h("span", { id: "rep-gps-note", class: "small muted" });
    const place = h("input", { id: "rep-place", type: "text", maxlength: 120, placeholder: "e.g. paddy fields below the church" });
    const cas = h("input", { id: "rep-cas", type: "number", min: 0, max: 50, value: 0 });
    const acres = h("input", { id: "rep-acres", type: "number", min: 0, step: 0.1, placeholder: 0 });
    const inrBox = h("input", { id: "rep-inr", type: "number", min: 0, step: 500, placeholder: 0 });
    const damage = h(
      "section",
      { class: "card", id: "rep-damage", hidden: true },
      h("h2", null, "Damage and injuries"),
      h(
        "div",
        { class: "grid2" },
        field("casualties", "People hurt or killed", cas),
        field("crop_acres", "Crops damaged (acres)", acres),
        field("property_inr", "Property loss (₹, estimate)", inrBox)
      )
    );
    const desc = h("textarea", { id: "rep-desc", maxlength: 500, placeholder: "Calves with the herd, which fields, who is at risk…" });
    const sev = h("span", { id: "rep-sev" }, h("span", { class: "muted small" }, "Choose what happened"));
    const send = h("button", { class: "btn primary", type: "submit", id: "rep-send" }, "Send report");
    const cam = h("button", { type: "button", class: "btn", id: "rep-cam" }, icon("camera"), " Take photo");
    const gallery = h("button", { type: "button", class: "btn", id: "rep-gallery" }, icon("image"), " From gallery");
    const voice = h("span", { id: "rep-voice" });
    const mediaBox = h("div", { class: "thumbs", id: "rep-media" });
    const form = h(
      "form",
      { id: "rep", class: "stack", novalidate: true },
      h(
        "section",
        { class: "card", "data-field": "type" },
        h("h2", null, "What's happening?"),
        h("div", { class: "types" }, m.types.map((t) => h(
          "button",
          { type: "button", class: "type", "data-type": t.key, "aria-pressed": "false" },
          h("b", null, t.label),
          h("small", { translate: "no" }, isNag() ? t.label : t.local)
        )))
      ),
      h(
        "section",
        { class: "card", "data-field": "attachments" },
        h("h2", null, "Photo and voice note"),
        h("p", { class: "small muted" }, "Optional. Take photos only from a safe distance. Never go closer to a herd for a picture."),
        h("div", { class: "row" }, cam, gallery, voice),
        mediaBox
      ),
      h(
        "section",
        { class: "card", "data-field": "herd_size" },
        h("h2", null, "How many elephants?"),
        h(
          "div",
          { class: "row" },
          h(
            "div",
            { class: "stepper" },
            h("button", { type: "button", "data-step": -1, "aria-label": "One fewer" }, "−"),
            herd,
            h("button", { type: "button", "data-step": 1, "aria-label": "One more" }, "+")
          ),
          h("div", { class: "chips" }, [1, 3, 5, 10, 20].map((n) => h("button", { type: "button", class: "chip", "data-herd": n }, n, n === 20 ? "+" : "")))
        ),
        h("small", { class: "muted" }, "A best guess is fine. Count calves too.")
      ),
      h(
        "section",
        { class: "card" },
        h("h2", null, "Where?"),
        field("village", "Nearest village", village),
        h(
          "div",
          { class: "field", "data-field": "offset_dir" },
          h("span", null, "How far from the village, and which way?"),
          h("div", { class: "row" }, km),
          rose
        ),
        h("div", { class: "row" }, gps, gpsNote),
        field(null, ["Landmark ", h("small", null, "(optional)")], place)
      ),
      h(
        "section",
        { class: "card" },
        h("h2", null, "Which way are they moving?"),
        h("div", { class: "chips", id: "rep-heading" }, ["", ...m.directions].map((d) => h("button", { type: "button", class: "chip", "data-heading": d, "aria-pressed": d === "" ? "true" : "false" }, d || "Not moving / not sure")))
      ),
      damage,
      h("section", { class: "card" }, field("description", ["Anything else? ", h("small", null, "(optional)")], desc)),
      h("div", { "data-errors": true }),
      h("div", { class: "preview" }, h("div", { class: "row" }, h("span", { class: "small muted" }, "Severity"), sev), send)
    );
    const main = shell(
      "report",
      h("div", { class: "pagehead" }, h("h1", null, "Report elephants"), h("p", { class: "muted" }, 'Only "what happened" is required. Send it now and add detail if you can.')),
      form
    );
    let sevTimer;
    const sync = () => {
      $$("[data-type]", form).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.type === f.type)));
      $$("[data-odir]", form).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.odir === f.offset_dir)));
      $$("[data-heading]", form).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.heading === f.heading)));
      damage.hidden = !DAMAGE_TYPES.includes(f.type);
      rose.hidden = !+km.value || f.lat != null;
      clearTimeout(sevTimer);
      if (!f.type) return;
      sevTimer = setTimeout(async () => {
        try {
          const r2 = await api("POST", "/api/severity", { type: f.type, herd_size: herd.value || 0, casualties: cas.value || 0 });
          fill(sev, sevPill(r2.severity, r2.label));
        } catch {
        }
      }, 120);
    };
    form.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.type) f.type = b.dataset.type;
      else if (b.dataset.step) herd.value = String(Math.max(0, Math.min(200, (+herd.value || 0) + +b.dataset.step)));
      else if (b.dataset.herd) herd.value = b.dataset.herd;
      else if (b.dataset.odir) f.offset_dir = b.dataset.odir;
      else if (b.dataset.heading !== void 0) f.heading = b.dataset.heading;
      else return;
      sync();
    });
    form.addEventListener("input", sync);
    const rule = m.media;
    const count = (kind) => f.media.filter((x) => x.kind === kind).length;
    const renderMedia = () => {
      fill(mediaBox, mediaTiles(f.media, true));
      const full = count("photo") >= rule.photo.max_count;
      cam.disabled = full;
      gallery.disabled = full;
      voice.hidden = count("voice") >= rule.voice.max_count;
    };
    const addPhoto = async (opts) => {
      try {
        const p2 = await takePhoto(opts);
        if (p2) {
          f.media.push(p2);
          renderMedia();
          toast("Photo added");
        }
      } catch (err) {
        showErrors(form, asErr(err));
      }
    };
    cam.onclick = () => addPhoto();
    gallery.onclick = () => addPhoto({ gallery: true });
    const recorder = voiceRecorder(voice, (v) => {
      f.media.push(v);
      renderMedia();
      toast("Voice note added");
    });
    mediaBox.onclick = (e) => {
      const t = e.target;
      const rm = t.closest("[data-remove]"), view = t.closest("[data-view]");
      if (rm) {
        f.media.splice(+rm.dataset.remove, 1);
        renderMedia();
      } else if (view) lightbox(f.media[+view.dataset.view].url);
    };
    window.addEventListener("hashchange", () => recorder.stop(), { once: true });
    gps.onclick = () => {
      const label = gps.lastChild;
      if (f.lat != null) {
        f.lat = f.lng = null;
        gpsNote.textContent = "";
        label.textContent = " Use my GPS location instead";
        return sync();
      }
      if (!navigator.geolocation) {
        gpsNote.textContent = "This device can't share its location.";
        return;
      }
      gpsNote.textContent = "Finding you…";
      navigator.geolocation.getCurrentPosition(
        (p2) => {
          const lat = f.lat = +p2.coords.latitude.toFixed(5), lng = f.lng = +p2.coords.longitude.toFixed(5);
          gpsNote.textContent = `Using ${lat}, ${lng} (±${Math.round(p2.coords.accuracy)} m)`;
          label.textContent = " Use village instead";
          sync();
        },
        () => {
          gpsNote.textContent = "Location isn't available here. Use the village and direction instead.";
        },
        { enableHighAccuracy: true, timeout: 1e4 }
      );
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (!f.type) return showErrors(form, new ApiErr(400, "Choose what happened.", "type"));
      const body = {
        type: f.type,
        herd_size: herd.value,
        village: village.value,
        offset_km: km.value,
        offset_dir: f.offset_dir,
        heading: f.heading,
        casualties: cas.value,
        crop_acres: acres.value,
        property_inr: inrBox.value,
        place: place.value,
        description: desc.value
      };
      if (!+body.offset_km) body.offset_dir = "";
      if (f.lat != null) Object.assign(body, { lat: f.lat, lng: f.lng });
      if (!DAMAGE_TYPES.includes(f.type)) Object.assign(body, { casualties: 0, crop_acres: 0, property_inr: 0 });
      if (f.media.length) body.attachments = f.media.map(({ kind, data }) => ({ kind, data }));
      const clientId = body.client_id = f.client_id || (f.client_id = newClientId());
      send.disabled = true;
      send.textContent = f.media.length ? "Sending…" : "Send report";
      try {
        const inc = await api("POST", "/api/incidents", body);
        const photos = inc.attachments.filter((a) => a.kind === "photo").length, notes = inc.attachments.filter((a) => a.kind === "voice").length;
        fill(main, h(
          "section",
          { class: "card" },
          h("span", { class: "label" }, "Report sent"),
          h("h1", null, "Thank you. Your report number is ", h("span", { class: "mono" }, inc.ref)),
          h(
            "div",
            { class: "row" },
            sevPill(inc.severity, inc.severity_label + " severity"),
            h(
              "span",
              { class: "muted" },
              h("span", null, inc.type_label),
              " · ",
              h("span", { translate: "no" }, inc.village),
              inc.attachments.length > 0 && [" · ", h("span", null, `${plural(photos, "photo")}, ${plural(notes, "voice note")}`)]
            )
          ),
          h("p", null, "A forest guard will check it. Keep this number for any compensation claim."),
          h("p", { class: "muted" }, "Stay well away from the herd and warn your neighbours."),
          h("div", { class: "row" }, h("a", { class: "btn primary", href: `#/case/${inc.id}` }, "View report"), h("a", { class: "btn", href: "#/home" }, "Back to home"))
        ));
      } catch (e2) {
        const err = asErr(e2);
        if (err.status === 0 && await queue.add({ client_id: clientId, user_id: me().id, body, queued_at: Date.now() })) {
          fill(main, h(
            "section",
            { class: "card" },
            h("span", { class: "label" }, "Saved on this phone"),
            h("h1", null, "No connection right now. Your report is saved."),
            h("p", null, "It sends by itself when the phone is back online. You'll get a report number then."),
            h("p", { class: "muted" }, "If people are in danger, phone the forest control room or 112 now."),
            h("div", { class: "row" }, h("a", { class: "btn primary", href: "#/home" }, "Back to home"), h("a", { class: "btn", href: "#/guide" }, "Emergency numbers"))
          ));
          return;
        }
        showErrors(form, err);
        send.disabled = false;
        send.textContent = "Send report";
      }
    };
    sync();
    renderMedia();
    if (mode === "camera") addPhoto();
  }

  // src/router.ts
  function router() {
    const [, page = "home", arg] = (location.hash || "#/home").split("/");
    if (!state.user) {
      if (page === "register") return viewRegister();
      if (page === "forgot") return viewForgot();
      return viewLogin();
    }
    window.scrollTo(0, 0);
    if (state.user.must_change_pin) return viewNewPin();
    switch (page) {
      case "admin":
        viewAdmin(arg);
        return;
      case "report":
        return viewReport(arg);
      case "cases":
        viewCases();
        return;
      case "case":
        viewCase(arg);
        return;
      case "alerts":
        viewAlerts();
        return;
      case "dashboard":
        viewDashboard();
        return;
      case "guide":
        return viewGuide();
      case "more":
        return viewMore();
      default:
        viewHome();
    }
  }

  // src/main.ts
  applyTheme(currentTheme());
  startTranslator();
  startOffline();
  startNotify();
  nav.router = router;
  async function boot() {
    const app = $("#app");
    fill(app, h("div", { class: "boot" }, h("div", null, mark(), h("p", { id: "boot-msg" }, "Starting HatiAlert…"))));
    try {
      await transport.ready;
      state.meta = await api("GET", "/api/meta");
      state.token = store.get("hatialert.token");
      if (state.token) {
        try {
          state.user = await api("GET", "/api/me");
        } catch (err) {
          if (asErr(err).status !== 0) {
            state.token = null;
            store.set("hatialert.token", null);
          }
        }
      }
    } catch (err) {
      fill(app, h("div", { class: "boot" }, h(
        "div",
        { class: "stack" },
        h("h2", null, "HatiAlert couldn't start"),
        h("p", null, asErr(err).message),
        h("div", null, h("button", { class: "btn", id: "reload", on: { click: () => location.reload() } }, "Reload"))
      )));
      return;
    }
    window.addEventListener("hashchange", router);
    router();
  }
  window.HATI_BOOT_MSG = (msg) => {
    const el = document.getElementById("boot-msg");
    if (el) el.textContent = msg;
  };
  boot();
})();
