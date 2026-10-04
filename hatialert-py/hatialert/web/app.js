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

  async function api(method, path, body) {
    let res;
    try {
      res = await transport.request(method, path, body, state.token);
    } catch (e) {
      throw new ApiErr(0, "Can't reach HatiAlert. Check your connection and try again.");
    }
    if (res.type.startsWith("text/csv")) return res.body;
    let data = {};
    try { data = JSON.parse(res.body || "{}"); } catch { /* not JSON */ }
    if (res.status >= 400) {
      if (res.status === 401 && state.token) signOutLocal();
      throw new ApiErr(res.status, data.error || "Something went wrong.", data.field);
    }
    return data;
  }

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
  };
  const icon = (n) => `<span class="ic" aria-hidden="true"><svg viewBox="0 0 24 24">${ICON[n]}</svg></span>`;
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
        <nav class="tabs" aria-label="Main">
          ${tabs.map(([k, label, href]) => `<a href="${href}" class="${k === "report" ? "report" : ""}" ${k === active ? 'aria-current="page"' : ""}>${icon(k)}<span>${label}</span></a>`).join("")}
        </nav>
        <main id="main" tabindex="-1">${content}</main>
      </div>`;
    return $("#main");
  }
  const loading = (active) => shell(active, `<p class="muted">Loading…</p>`);
  function failure(main, err) {
    main.innerHTML = `<div class="card"><h2>That didn't load</h2><p class="muted">${esc(err.message)}</p><div><button class="btn" data-retry>Try again</button></div></div>`;
    $("[data-retry]", main).onclick = () => router();
  }

  // -- map ---------------------------------------------------------------
  function mapSvg({ incidents = [], home, radius = 0, focus = null }) {
    const V = state.meta.villages;
    const lat0 = V.reduce((s, v) => s + v.lat, 0) / V.length;
    const lng0 = V.reduce((s, v) => s + v.lng, 0) / V.length;
    const kx = 111.32 * Math.cos((lat0 * Math.PI) / 180), ky = 110.57; // km per degree
    const P = (lat, lng) => [(lng - lng0) * kx, -(lat - lat0) * ky];
    const pts = [...V.map((v) => P(v.lat, v.lng)), ...incidents.map((i) => P(i.lat, i.lng))];
    const hv = V.find((v) => v.name === home);
    const ringKm = Math.min(radius, 6);
    if (hv && ringKm) { const [x, y] = P(hv.lat, hv.lng); pts.push([x - ringKm, y - ringKm], [x + ringKm, y + ringKm]); }
    const pad = 1.6;
    const minX = Math.min(...pts.map((p) => p[0])) - pad, maxX = Math.max(...pts.map((p) => p[0])) + pad;
    const minY = Math.min(...pts.map((p) => p[1])) - pad, maxY = Math.max(...pts.map((p) => p[1])) + pad;
    const W = 420, s = W / (maxX - minX), H = Math.round((maxY - minY) * s);
    const X = (km) => ((km - minX) * s).toFixed(1), Y = (km) => ((km - minY) * s).toFixed(1);
    let g = "";
    for (let k = Math.ceil(minX / 2) * 2; k <= maxX; k += 2) g += `<line class="grid" x1="${X(k)}" y1="0" x2="${X(k)}" y2="${H}"/>`;
    for (let k = Math.ceil(minY / 2) * 2; k <= maxY; k += 2) g += `<line class="grid" x1="0" y1="${Y(k)}" x2="${W}" y2="${Y(k)}"/>`;
    if (hv && radius) {
      const [x, y] = P(hv.lat, hv.lng);
      g += `<circle class="ring" cx="${X(x)}" cy="${Y(y)}" r="${(radius * s).toFixed(1)}"/>`;
    }
    let labels = "";
    for (const v of V) {
      const [x, y] = P(v.lat, v.lng);
      const right = (x - minX) * s < W - 80;
      const cls = v.name === home ? " home" : "";
      g += `<circle class="vdot${cls}" cx="${X(x)}" cy="${Y(y)}" r="${cls ? 6 : 4.5}"/>`;
      labels += `<text class="vlabel${cls}" x="${(+X(x) + (right ? 8 : -8)).toFixed(1)}" y="${(+Y(y) + 4).toFixed(1)}" text-anchor="${right ? "start" : "end"}">${esc(v.name)}</text>`;
    }
    const dirs = state.meta.directions;
    for (const i of incidents) {
      const [x, y] = P(i.lat, i.lng);
      const r = 7 + Math.min(i.herd_size || 0, 20) * 0.35;
      let arrow = "";
      if (i.heading) {
        const a = (dirs.indexOf(i.heading) * 45 * Math.PI) / 180, len = 1.15 * s;
        const sx = +X(x) + Math.sin(a) * (r + 2), sy = +Y(y) - Math.cos(a) * (r + 2);
        arrow = `<line class="heading" x1="${sx.toFixed(1)}" y1="${sy.toFixed(1)}" x2="${(sx + Math.sin(a) * len).toFixed(1)}" y2="${(sy - Math.cos(a) * len).toFixed(1)}"/>`;
      }
      const label = `${i.type_label}, ${i.severity_label} severity, near ${i.village}, ${ago(i.created_at)}`;
      g += `${arrow}<a href="#/case/${i.id}" aria-label="${esc(label)}"><title>${esc(label)}</title><circle class="inc ${esc(i.severity)}${i.id === focus ? " focus" : ""}" cx="${X(x)}" cy="${Y(y)}" r="${r.toFixed(1)}"/></a>`;
    }
    g += labels;
    const bar = 2 * s;
    g += `<line class="scale" x1="16" y1="${H - 16}" x2="${(16 + bar).toFixed(1)}" y2="${H - 16}"/><line class="scale" x1="16" y1="${H - 21}" x2="16" y2="${H - 11}"/><line class="scale" x1="${(16 + bar).toFixed(1)}" y1="${H - 21}" x2="${(16 + bar).toFixed(1)}" y2="${H - 11}"/><text class="scaletext" x="${(16 + bar / 2).toFixed(1)}" y="${H - 24}" text-anchor="middle">2 km</text>`;
    g += `<text class="north" x="${W - 18}" y="22" text-anchor="middle">N</text><path class="northmark" d="M${W - 18} 27 l-5 10 h10 z"/>`;
    return `<svg class="map" viewBox="0 0 ${W} ${H}" role="img" aria-label="Map of villages around Wokha with open incidents">
      <defs><marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z"/></marker></defs>${g}</svg>`;
  }
  const legend = (radius) => `<div class="legend"><span><i class="critical"></i>Critical</span><span><i class="high"></i>High</span><span><i class="medium"></i>Medium</span><span><i class="low"></i>Low</span>${radius ? `<span>Dashed ring: your ${radius} km alert area</span>` : ""}<span>Arrow: herd heading</span></div>`;

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
        <div class="row">${MARK}<b class="label">HatiAlert · Wokha</b></div>
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
      </form>
      ${demo.length ? `<section class="card"><div class="stack"><h2>Try a demo account</h2><p class="small muted">Each role sees a different app. Tap one to fill in the form.</p></div>
        <div class="demo">${demo.map((d) => `<button type="button" data-phone="${esc(d.phone)}" data-pin="${esc(d.pin)}"><b>${esc(roleName[d.role])}</b><span class="mono muted">PIN ${esc(d.pin)}</span><span class="small muted">${esc(d.name)} · ${esc(d.village)}</span><span class="mono small muted">${esc(d.phone)}</span></button>`).join("")}</div></section>` : ""}`);
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
    form.onsubmit = async (e) => {
      e.preventDefault();
      if ($("#reg-pin").value !== $("#reg-pin2").value) return showErrors(form, new ApiErr(400, "The two PINs don't match.", "pin2"));
      try {
        signIn(await api("POST", "/api/auth/register", { name: $("#reg-name").value, phone: $("#reg-phone").value, village: $("#reg-village").value, pin: $("#reg-pin").value }));
        toast("Account created");
      } catch (err) { showErrors(form, err); }
    };
  }

  function signIn({ token, user }) {
    state.token = token; state.user = user;
    store.set("hatialert.token", token);
    location.hash = "#/home";
    router();
  }
  function signOutLocal() {
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
      ${w ? `<a class="warning" href="#/alerts"><span class="label">Elephant warning · ${esc(o.village.name)}</span><p>${esc(w.message)}</p><span class="small muted">${ago(w.sent_at)}${w.by ? ` · ${esc(w.by)}` : ""}</span></a>` : ""}
      <div class="pagehead"><span class="label">Within ${o.radius_km} km of ${esc(o.village.name)}</span>
        <h1>${o.nearby.length ? `${plural(o.nearby.length, "open incident")} near you` : "No open incidents near you"}</h1></div>
      ${o.nearby.length ? `<section class="card flush divide">${o.nearby.slice(0, 5).map((i) => incidentItem(i, `<b>${i.km} km ${esc(i.dir)}</b> of ${esc(o.village.name)}`)).join("")}</section>`
        : `<p class="muted">${o.open_total ? `${plural(o.open_total, "open incident")} elsewhere in the district.` : "All quiet across the district."} You'll see new reports here.</p>`}
      <a class="btn primary big" href="#/report">${icon("report")} Report elephants</a>
      <section class="card flush">${mapSvg({ incidents: open, home: o.village.name, radius: o.radius_km })}${legend(o.radius_km)}</section>
      ${isStaff() ? `<div class="kpis"><div class="kpi"><small>Open in district</small><b>${o.open_total}</b></div><div class="kpi"><small>Waiting for a check</small><b>${o.awaiting_check}</b></div><div class="kpi"><small>Reported in 24 h</small><b>${o.reported_24h}</b></div></div>` : ""}
      ${o.has_sample && state.user.role === "officer" ? `<div class="notice"><span>Sample incidents are loaded so you can try the app.</span><span class="confirm" id="sample"><button class="btn small" data-ask>Remove sample data</button></span></div>` : ""}`;
    const sample = $("#sample", main);
    if (sample) {
      sample.onclick = async (e) => {
        if (e.target.matches("[data-ask]")) sample.innerHTML = `<span class="small">Delete all sample incidents and alerts?</span><button class="btn small danger" data-yes>Delete</button><button class="btn small" data-no>Keep</button>`;
        else if (e.target.matches("[data-no]")) sample.innerHTML = `<button class="btn small" data-ask>Remove sample data</button>`;
        else if (e.target.matches("[data-yes]")) { await api("DELETE", "/api/sample"); toast("Sample data removed"); viewHome(); }
      };
    }
  }

  // -- report ------------------------------------------------------------
  const DAMAGE_TYPES = ["crop_raid", "property_damage", "injury", "death"];
  async function viewReport() {
    const m = state.meta;
    const f = { type: "", herd_size: 1, village: state.user.village, offset_km: 0, offset_dir: "", heading: "", casualties: 0, crop_acres: "", property_inr: "", place: "", description: "", lat: null, lng: null };
    const main = shell("report", `
      <div class="pagehead"><h1>Report elephants</h1><p class="muted">Only "what happened" is required. Send it now and add detail if you can.</p></div>
      <form id="rep" class="stack" novalidate>
        <section class="card" data-field="type"><h2>What's happening?</h2>
          <div class="types">${m.types.map((t) => `<button type="button" class="type" data-type="${t.key}" aria-pressed="false"><b>${esc(t.label)}</b><small>${esc(t.local)}</small></button>`).join("")}</div></section>
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
      $("#rep-send").disabled = true;
      try {
        const inc = await api("POST", "/api/incidents", body);
        main.innerHTML = `
          <section class="card">
            <span class="label">Report sent</span>
            <h1>Thank you. Your report number is <span class="mono">${esc(inc.ref)}</span></h1>
            <div class="row">${sevPill(inc.severity, inc.severity_label + " severity")}<span class="muted">${esc(inc.type_label)} · ${esc(inc.village)}</span></div>
            <p>A forest guard will check it. Keep this number for any compensation claim.</p>
            <p class="muted">Stay well away from the herd and warn your neighbours.</p>
            <div class="row"><a class="btn primary" href="#/case/${inc.id}">View report</a><a class="btn" href="#/home">Back to home</a></div>
          </section>`;
      } catch (err) { showErrors(form, err); $("#rep-send").disabled = false; }
    };
    sync();
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
    if (i.reporter) facts.push(["Reported by", `${esc(i.reporter.name)}<br><span class="mono small">${esc(i.reporter.phone)}</span>`]);
    main.innerHTML = `
      <div class="pagehead"><a class="small" href="#/cases">← ${staff ? "Cases" : "My reports"}</a>
        <div class="row between"><h1>${esc(i.type_label)}</h1>${sevPill(i.severity, i.severity_label)}</div>
        <p class="muted"><span class="mono">${esc(i.ref)}</span> · ${esc(i.status_label)}${i.sample ? ' · <span class="tag">Sample</span>' : ""}</p></div>
      <section class="card flush">${mapSvg({ incidents: [i], home: state.user.village, focus: i.id })}</section>
      <section class="card"><dl class="facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
        ${i.description ? `<p>${esc(i.description)}</p>` : ""}</section>
      <section class="card"><h2>What has happened</h2>
        <ol class="timeline">${i.events.map((e) => `<li><span class="dot"></span><div><b>${esc(e.status_label)}</b> <span class="small muted">${when(e.at)}${e.by ? ` · ${esc(e.by)}` : ""}</span>${e.note ? `<p>${esc(e.note)}</p>` : ""}</div></li>`).join("")}</ol></section>
      ${staff ? `<form class="card" id="act" novalidate><h2>Staff action</h2>
        <label class="field" data-field="note"><span>Note <small>(team sent, damage seen, advice given)</small></span><textarea id="act-note" maxlength="500"></textarea></label>
        <div data-errors></div>
        <div class="row">${i.next.map((s) => `<button type="button" class="btn ${s === "false_report" ? "" : "primary"}" data-status="${s}">${verbs[s]}</button>`).join("")}<button type="button" class="btn" data-status="">Add note only</button></div>
        ${i.open ? `<div class="row between split"><span class="small muted">Tell villages within 5 km.</span><button type="button" class="btn" id="warn">Warn nearby villages</button></div>` : ""}
      </form>` : ""}`;
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
          <p class="full">${esc(a.message)}</p>
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
        await api("POST", "/api/alerts", {
          level: $("[data-level][aria-pressed=true]", form).dataset.level,
          villages: $$("[data-v][aria-pressed=true]", form).map((b) => b.dataset.v),
          message: $("#compose-msg").value, incident_id: pre?.incident_id ?? null,
        });
        toast("Alert sent");
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
    const list = (items, mark) => `<ul class="stack plain">${items.map((i) => `<li class="row top"><b aria-hidden="true">${mark}</b><div class="grow"><p>${esc(i.text)}</p>${i.local ? `<p class="small muted"><i>${esc(i.local)}</i></p>` : ""}</div></li>`).join("")}</ul>`;
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
      <div class="pagehead"><h1>${esc(u.name)}</h1><p class="muted">${esc(roleName[u.role])} · <span class="mono">${esc(u.phone)}</span></p></div>
      <section class="card flush divide">
        ${u.role === "officer" ? `<a class="item" href="#/dashboard"><h3>District overview</h3><span class="muted">→</span><div class="meta">Trends, hotspots, response times, CSV export</div></a>` : ""}
        <a class="item" href="#/guide"><h3>Safety and help</h3><span class="muted">→</span><div class="meta">What to do, emergency numbers, compensation</div></a>
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
      <div class="row between"><button class="btn danger" id="out">Sign out</button><span class="small muted">Engine: ${esc(transport.engine)}</span></div>`);
    const form = $("#prof", main);
    form.onsubmit = async (e) => {
      e.preventDefault();
      try {
        state.user = await api("PATCH", "/api/me", { name: $("#prof-name").value, village: $("#prof-village").value, radius_km: +$("#prof-radius").value });
        toast("Saved");
        viewMore();
      } catch (err) { showErrors(form, err); }
    };
    $("#out", main).onclick = async () => { try { await api("POST", "/api/auth/logout"); } catch { /* already signed out */ } signOutLocal(); router(); };
  }

  // -- router ------------------------------------------------------------
  async function router() {
    const [, page = "home", arg] = (location.hash || "#/home").split("/");
    if (!state.user) {
      if (page === "register") return viewRegister();
      return viewLogin();
    }
    window.scrollTo(0, 0);
    switch (page) {
      case "report": return viewReport();
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
        try { state.user = await api("GET", "/api/me"); } catch { state.token = null; store.set("hatialert.token", null); }
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
