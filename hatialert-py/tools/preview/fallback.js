/* JavaScript stand-in for hatialert/api.py, used by the hosted preview only
   when the browser refuses to run Python (WebAssembly blocked). It mirrors
   the Python API route for route; tools/parity.cjs checks the two agree.
   Seed rows come from the Python seed, exported by build_preview.py. */
function createFallbackEngine(SEED, opts = {}) {
  const clock = opts.clock || (() => Date.now());
  const M = SEED.meta;
  const DAY = 86400000, HOUR = 3600000;
  const OPEN = ["reported", "verified", "responded"];
  const STAFF = ["guard", "officer"];
  const VBY = Object.fromEntries(M.villages.map((v) => [v.name, v]));
  const TYPES = Object.fromEntries(M.types.map((t) => [t.key, t]));
  const SEVL = Object.fromEntries(M.severities.map((s) => [s.key, s.label]));
  const STL = Object.fromEntries(M.statuses.map((s) => [s.key, s.label]));
  const ALL = Object.fromEntries(M.alert_levels.map((a) => [a.key, a.label]));
  const DIRS = M.directions, LIM = M.limits;
  const R = 6371.0088, rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;

  // -- data, re-based so sample times are relative to now ---------------
  const base = clock();
  const db = {
    users: SEED.users.map((u) => ({ ...u, created_at: base + u.created_at })),
    sessions: [],
    incidents: SEED.incidents.map((i) => ({ ...i, created_at: base + i.created_at, updated_at: base + i.updated_at })),
    events: SEED.events.map((e) => ({ ...e, at: base + e.at })),
    alerts: SEED.alerts.map((a) => ({ ...a, sent_at: base + a.sent_at })),
    attachments: [],
  };
  const nextId = (t) => db[t].reduce((m, r) => Math.max(m, r.id), 0) + 1;
  const failures = {};

  class E { constructor(status, message, field = null) { this.status = status; this.message = message; this.field = field; } }

  // -- domain -----------------------------------------------------------
  function classify(kind, herd, cas) {
    if (cas > 0 || kind === "death" || kind === "injury") return "critical";
    if (kind === "property_damage") return "high";
    if (kind === "crop_raid") return herd >= 5 ? "high" : "medium";
    if (kind === "herd_movement" && herd >= 10) return "high";
    if (kind === "sighting" && herd >= 5) return "medium";
    return "low";
  }
  function hav(a1, o1, a2, o2) {
    const p1 = rad(a1), p2 = rad(a2), dp = p2 - p1, dl = rad(o2 - o1);
    const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  function bearing(a1, o1, a2, o2) {
    const p1 = rad(a1), p2 = rad(a2), dl = rad(o2 - o1);
    const y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (deg(Math.atan2(y, x)) + 360) % 360;
  }
  const compass = (b) => DIRS[Math.floor((b % 360) / 45 + 0.5) % 8];
  const round = (x, n) => Number(x.toFixed(n));
  function destination(lat, lng, km, dir) {
    if (km <= 0 || !DIRS.includes(dir)) return [lat, lng];
    const th = rad(DIRS.indexOf(dir) * 45), d = km / R, p1 = rad(lat), l1 = rad(lng);
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(th));
    const l2 = l1 + Math.atan2(Math.sin(th) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return [round(deg(p2), 5), round(deg(l2), 5)];
  }
  const ist = (ms) => new Date(ms + 5.5 * HOUR).toISOString();
  const istDate = (ms) => ist(ms).slice(0, 10);
  const istStamp = (ms) => ist(ms).slice(0, 16).replace("T", " ");
  const ref = (id, ms) => "HA-" + ist(ms).slice(2, 4) + ist(ms).slice(5, 7) + "-" + String(id).padStart(4, "0");

  // -- input helpers (same messages as api.py) ---------------------------
  const fmt = (n) => String(n);
  function num(body, key, kind, lo, hi, dflt = 0) {
    let raw = body[key] === undefined ? dflt : body[key];
    if (raw === "" || raw === null) raw = dflt;
    let val;
    if (kind === "int") {
      if (typeof raw === "boolean") val = +raw;
      else if (typeof raw === "number") val = Math.trunc(raw);
      else if (/^\s*[+-]?\d+\s*$/.test(String(raw))) val = parseInt(raw, 10);
      else throw new E(400, "Enter a number.", key);
    } else {
      val = typeof raw === "number" ? raw : /^\s*[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*$/i.test(String(raw)) ? parseFloat(raw) : NaN;
      if (typeof raw !== "number" && Number.isNaN(val)) throw new E(400, "Enter a number.", key);
    }
    if (Number.isNaN(val) || val < lo || val > hi) throw new E(400, `Enter a value from ${fmt(lo)} to ${fmt(hi)}.`, key);
    return val;
  }
  function text(body, key, max, required = false) {
    const val = String(body[key] || "").trim();
    if (required && !val) throw new E(400, "This field is required.", key);
    if (val.length > max) throw new E(400, `Keep this under ${max} characters.`, key);
    return val;
  }
  function village(body, key = "village") {
    if (!(body[key] in VBY)) throw new E(400, "Choose a village from the list.", key);
    return body[key];
  }
  function phone(raw) {
    let d = String(raw || "").replace(/\D/g, "");
    if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
    if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
    if (!/^[6-9]\d{9}$/.test(d)) throw new E(400, "Enter a 10-digit mobile number.", "phone");
    return d;
  }
  // media: same rules as domain.MEDIA / api._media
  const MEDIA = M.media;
  function sniff(b) {
    const s4 = String.fromCharCode(...b.slice(0, 4)), s8_12 = String.fromCharCode(...b.slice(8, 12));
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
    if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, k) => b[k] === x)) return "image/png";
    if (s4 === "RIFF" && s8_12 === "WEBP") return "image/webp";
    if (s4 === "RIFF" && s8_12 === "WAVE") return "audio/wav";
    if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "audio/webm";
    if (s4 === "OggS") return "audio/ogg";
    if (String.fromCharCode(...b.slice(4, 8)) === "ftyp") return "audio/mp4";
    if (String.fromCharCode(...b.slice(0, 3)) === "ID3" || (b.length > 1 && b[0] === 0xff && [0xfb, 0xf3, 0xf2, 0xfa].includes(b[1]))) return "audio/mpeg";
    return null;
  }
  function media(item, field = "attachments") {
    if (!item || typeof item !== "object" || Array.isArray(item) || !(item.kind in MEDIA) || item.kind === "voice_max_seconds") throw new E(400, "Attach a photo or a voice note.", field);
    const kind = item.kind, rule = MEDIA[kind];
    let raw = String(item.data || "");
    if (raw.startsWith("data:")) raw = raw.slice(raw.indexOf(",") + 1 || raw.length);
    raw = raw.replace(/\s/g, "");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(raw) || raw.length % 4) throw new E(400, "That file didn't upload properly. Try again.", field);
    const pad = raw.endsWith("==") ? 2 : raw.endsWith("=") ? 1 : 0, size = (raw.length / 4) * 3 - pad;
    if (!size) throw new E(400, "That file is empty.", field);
    if (size > rule.max_bytes) throw new E(413, `Each ${kind === "photo" ? "photo" : "voice note"} must be under ${rule.max_bytes / 1e6} MB.`, field);
    const head = Uint8Array.from(atob(raw.slice(0, 24)), (c) => c.charCodeAt(0));
    const mime = sniff(head);
    if (!rule.mimes.includes(mime)) throw new E(415, kind === "photo" ? "Use a JPEG, PNG or WebP photo." : "Use a recording in MP3, M4A, WebM, Ogg or WAV.", field);
    return { kind, mime, size, data: raw };
  }
  function mediaList(items, existing = {}) {
    if (items === undefined || items === null) return [];
    if (!Array.isArray(items)) throw new E(400, "Attach a photo or a voice note.", "attachments");
    const out = items.map((i) => media(i)), counts = { ...existing };
    for (const m of out) {
      counts[m.kind] = (counts[m.kind] || 0) + 1;
      if (counts[m.kind] > MEDIA[m.kind].max_count) throw new E(400, `A report can have up to ${MEDIA[m.kind].max_count} ${m.kind === "photo" ? "photos" : "voice notes"}.`, "attachments");
    }
    return out;
  }
  const attsOf = (iid) => db.attachments.filter((a) => a.incident_id === iid).sort((a, b) => a.id - b.id);
  function addAttachment(iid, m, uid, at) { db.attachments.push({ id: nextId("attachments"), incident_id: iid, kind: m.kind, mime: m.mime, size: m.size, data: m.data, user_id: uid, created_at: at }); }
  const cell = (v) => (typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? "'" + v : v);
  const csvField = (v) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const pyNum = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v)); // Python prints floats as 1.0

  // -- views ------------------------------------------------------------
  const userView = (u) => ({ id: u.id, name: u.name, phone: u.phone, village: u.village, role: u.role, radius_km: u.radius_km });
  const userById = (id) => db.users.find((u) => u.id === id) || null;
  const byCreated = (a, b) => b.created_at - a.created_at || b.id - a.id;
  function incView(r, viewer, events) {
    const staff = viewer && STAFF.includes(viewer.role), mine = !!(viewer && r.reporter_id === viewer.id);
    const out = {};
    for (const k of ["id", "type", "severity", "status", "herd_size", "casualties", "crop_acres", "property_inr", "heading", "village", "lat", "lng", "place", "description", "created_at", "updated_at"]) out[k] = r[k];
    Object.assign(out, { ref: ref(r.id, r.created_at), type_label: TYPES[r.type].label, severity_label: SEVL[r.severity], status_label: STL[r.status], open: OPEN.includes(r.status), sample: !!r.sample, mine });
    out.attachments = attsOf(r.id).map((a) => ({ id: a.id, kind: a.kind, mime: a.mime, size: a.size, created_at: a.created_at }));
    if (staff || mine) { const u = userById(r.reporter_id); out.reporter = u ? { name: u.name, phone: u.phone } : null; }
    if (events) {
      out.events = events.map((e) => { const u = userById(e.user_id); return { status: e.status, status_label: STL[e.status], note: e.note, at: e.at, by: u && (staff || STAFF.includes(u.role)) ? u.name : null, by_role: u ? u.role : null }; });
      out.can_attach = !!(staff || mine);
      out.next = M.transitions[r.status].filter((s) => viewer && M.transition_roles[s].includes(viewer.role));
    }
    return out;
  }
  const eventsOf = (id) => db.events.filter((e) => e.incident_id === id).sort((a, b) => a.at - b.at || a.id - b.id);
  const alertsSorted = () => [...db.alerts].sort((a, b) => b.sent_at - a.sent_at || b.id - a.id);
  function activeWarnings(now) {
    const latest = {};
    for (const a of alertsSorted().slice(0, 200).reverse()) if (a.level === "warning" || a.level === "all_clear") for (const v of a.villages) latest[v] = a;
    const out = {};
    for (const [v, a] of Object.entries(latest)) if (a.level === "warning" && now - a.sent_at < DAY) out[v] = a;
    return out;
  }
  const alertView = (a, user, active) => ({ id: a.id, level: a.level, level_label: ALL[a.level], message: a.message, villages: a.villages, incident_id: a.incident_id, by: userById(a.user_id)?.name ?? null, sent_at: a.sent_at, sample: !!a.sample, affects_me: a.villages.includes(user.village), active: active.has(a.id) });
  const activeIds = () => new Set(Object.values(activeWarnings(clock())).map((a) => a.id));
  function getIncident(id) { const r = db.incidents.find((i) => i.id === +id); if (!r) throw new E(404, "No incident with that number."); return r; }
  function addEvent(iid, status, note, uid, at, newStatus) {
    db.events.push({ id: nextId("events"), incident_id: iid, status, note, user_id: uid, at });
    const r = getIncident(iid); r.updated_at = at; if (newStatus) r.status = newStatus;
  }
  function session(u) { const token = "fb-" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); db.sessions.push({ token, user_id: u.id }); return { token, user: userView(u) }; }
  function windowRows(q) {
    const days = num(q, "days", "int", 1, 365, 30), since = clock() - days * DAY;
    return [days, db.incidents.filter((i) => i.created_at >= since).sort(byCreated)];
  }
  function firstTimes(status) { const out = {}; for (const e of db.events) if (e.status === status && (out[e.incident_id] === undefined || e.at < out[e.incident_id])) out[e.incident_id] = e.at; return out; }
  const median = (xs) => { const s = [...xs].sort((a, b) => a - b), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };

  // -- routes -----------------------------------------------------------
  const routes = [
    ["GET", /^\/api\/meta$/, null, () => ({ ...M, demo_accounts: SEED.demo_accounts })],
    ["POST", /^\/api\/severity$/, null, (u, b) => {
      if (!(b.type in TYPES)) throw new E(400, "Choose what happened.", "type");
      const s = classify(b.type, num(b, "herd_size", "int", ...LIM.herd_size, 1), num(b, "casualties", "int", ...LIM.casualties));
      return { severity: s, label: SEVL[s] };
    }],
    ["POST", /^\/api\/auth\/login$/, null, (u, b) => {
      const p = phone(b.phone), now = clock();
      const recent = (failures[p] || []).filter((t) => now - t < 300000);
      if (recent.length >= 5) throw new E(429, `Too many wrong PINs. Try again in ${Math.floor((300000 - (now - recent[0])) / 60000) + 1} min.`, "pin");
      const found = db.users.find((x) => x.phone === p);
      if (!found || String(b.pin ?? "") !== found.pin) { failures[p] = [...recent, now]; throw new E(401, "That phone number and PIN don't match.", "pin"); }
      delete failures[p];
      return session(found);
    }],
    ["POST", /^\/api\/auth\/register$/, null, (u, b) => {
      const name = text(b, "name", LIM.name, true);
      if (name.length < 2) throw new E(400, "Enter your full name.", "name");
      const p = phone(b.phone), v = village(b), pin = String(b.pin ?? "");
      if (!/^\d{4,6}$/.test(pin)) throw new E(400, "Choose a PIN of 4 to 6 digits.", "pin");
      if (db.users.some((x) => x.phone === p)) throw new E(409, "This number is already registered. Sign in instead.", "phone");
      const nu = { id: nextId("users"), name, phone: p, village: v, role: "villager", radius_km: 5, pin, sample: 0, created_at: clock() };
      db.users.push(nu);
      return session(nu);
    }],
    ["POST", /^\/api\/auth\/logout$/, "user", (u) => { db.sessions = db.sessions.filter((s) => s.token !== u._token); return { ok: true }; }],
    ["GET", /^\/api\/me$/, "user", (u) => userView(u)],
    ["PATCH", /^\/api\/me$/, "user", (u, b) => {
      const f = {};
      if ("name" in b) f.name = text(b, "name", LIM.name, true);
      if ("village" in b) f.village = village(b);
      if ("radius_km" in b) f.radius_km = num(b, "radius_km", "float", ...LIM.radius_km);
      Object.assign(userById(u.id), f);
      return userView(userById(u.id));
    }],
    ["GET", /^\/api\/incidents$/, "user", (u, b, q) => {
      const status = q.status || "open";
      let rows = db.incidents;
      if (q.mine === "1") rows = rows.filter((r) => r.reporter_id === u.id);
      else if (status !== "open" && !STAFF.includes(u.role)) throw new E(403, "Only forest staff can see closed cases.");
      if (status === "open") rows = rows.filter((r) => OPEN.includes(r.status));
      else if (status === "closed") rows = rows.filter((r) => !OPEN.includes(r.status));
      else if (status !== "all") throw new E(400, "status must be open, closed or all.");
      if (q.village) rows = rows.filter((r) => r.village === q.village);
      return [...rows].sort(byCreated).slice(0, 500).map((r) => incView(r, u));
    }],
    ["GET", /^\/api\/incidents\/(\d+)$/, "user", (u, b, q, id) => { const r = getIncident(id); return incView(r, u, eventsOf(r.id)); }],
    ["POST", /^\/api\/incidents$/, "user", (u, b) => {
      if (!(b.type in TYPES)) throw new E(400, "Choose what happened.", "type");
      const v = village(b);
      const herd = num(b, "herd_size", "int", ...LIM.herd_size, 1);
      let cas = num(b, "casualties", "int", ...LIM.casualties);
      if ((b.type === "injury" || b.type === "death") && cas === 0) cas = 1;
      const heading = b.heading || "";
      if (heading && !DIRS.includes(heading)) throw new E(400, "Choose a direction from the list.", "heading");
      let lat, lng;
      if ("lat" in b && "lng" in b && b.lat !== "" && b.lat !== null) { lat = num(b, "lat", "float", 25, 27.5); lng = num(b, "lng", "float", 93, 95.5); }
      else {
        const off = num(b, "offset_km", "float", ...LIM.offset_km), dir = b.offset_dir || "";
        if (off && !DIRS.includes(dir)) throw new E(400, "Say which way from the village.", "offset_dir");
        [lat, lng] = destination(VBY[v].lat, VBY[v].lng, off, dir);
      }
      const rec = {
        type: b.type, severity: classify(b.type, herd, cas), herd_size: herd, casualties: cas,
        crop_acres: round(num(b, "crop_acres", "float", ...LIM.crop_acres), 2), property_inr: num(b, "property_inr", "int", ...LIM.property_inr),
        heading, village: v, lat, lng, place: text(b, "place", 120), description: text(b, "description", LIM.description),
      };
      const files = mediaList(b.attachments);
      const at = clock(), id = nextId("incidents");
      db.incidents.push({ id, ...rec, status: "reported", reporter_id: u.id, sample: 0, created_at: at, updated_at: at });
      db.events.push({ id: nextId("events"), incident_id: id, status: "reported", note: "", user_id: u.id, at });
      for (const m of files) addAttachment(id, m, u.id, at);
      return incView(getIncident(id), u, eventsOf(id));
    }],
    ["POST", /^\/api\/incidents\/(\d+)\/attachments$/, "user", (u, b, q, id) => {
      const r = getIncident(id);
      if (!STAFF.includes(u.role) && r.reporter_id !== u.id) throw new E(403, "Only the reporter or forest staff can add to this case.");
      const have = {};
      for (const a of attsOf(r.id)) have[a.kind] = (have[a.kind] || 0) + 1;
      const m = mediaList([b], have)[0], now = clock();
      addAttachment(r.id, m, u.id, now);
      addEvent(r.id, r.status, m.kind === "photo" ? "Added a photo" : "Added a voice note", u.id, now, null);
      return incView(r, u, eventsOf(r.id));
    }],
    ["GET", /^\/api\/attachments\/(\d+)$/, "user", (u, b, q, id) => {
      const a = db.attachments.find((x) => x.id === +id);
      if (!a) throw new E(404, "That file is no longer available.");
      return { id: a.id, kind: a.kind, mime: a.mime, size: a.size, data: a.data };
    }],
    ["PATCH", /^\/api\/incidents\/(\d+)$/, "staff", (u, b, q, id) => {
      const r = getIncident(id), status = b.status || null, note = text(b, "note", LIM.description);
      if (!status && !note) throw new E(400, "Choose a new status or write a note.", "note");
      if (status) {
        if (!(M.transitions[r.status] || []).includes(status)) throw new E(409, `A ${STL[r.status].toLowerCase()} case can't move to that status.`, "status");
        if (!M.transition_roles[status].includes(u.role)) throw new E(403, "Only a forest officer can close a case.", "status");
      }
      addEvent(r.id, status || r.status, note, u.id, clock(), status);
      return incView(r, u, eventsOf(r.id));
    }],
    ["GET", /^\/api\/incidents\/(\d+)\/villages$/, "staff", (u, b, q, id) => {
      const r = getIncident(id), km = num(q, "km", "float", 0.5, 30, 5);
      return M.villages.map((v) => ({ v, d: hav(v.lat, v.lng, r.lat, r.lng) })).filter((x) => x.d <= km)
        .map(({ v, d }) => ({ name: v.name, km: round(d, 1), dir: compass(bearing(v.lat, v.lng, r.lat, r.lng)) }))
        .sort((a, c) => a.km - c.km);
    }],
    ["GET", /^\/api\/alerts$/, "user", (u) => { const act = activeIds(); return alertsSorted().slice(0, 50).map((a) => alertView(a, u, act)); }],
    ["POST", /^\/api\/alerts$/, "staff", (u, b) => {
      if (!(b.level in ALL)) throw new E(400, "Choose an alert type.", "level");
      const message = text(b, "message", LIM.message, true);
      const vs = b.villages || [];
      if (!Array.isArray(vs) || !vs.length || vs.some((v) => !(v in VBY))) throw new E(400, "Pick at least one village.", "villages");
      let iid = b.incident_id ?? null;
      if (iid !== null) iid = getIncident(iid).id;
      const a = { id: nextId("alerts"), level: b.level, message, villages: M.villages.map((v) => v.name).filter((n) => vs.includes(n)), incident_id: iid, user_id: u.id, sample: 0, sent_at: clock() };
      db.alerts.push(a);
      return alertView(a, u, activeIds());
    }],
    ["GET", /^\/api\/overview$/, "user", (u) => {
      const now = clock(), home = VBY[u.village];
      const open = db.incidents.filter((r) => OPEN.includes(r.status)).sort(byCreated);
      const nearby = [];
      for (const r of open) {
        const d = hav(home.lat, home.lng, r.lat, r.lng);
        if (d <= u.radius_km) nearby.push({ ...incView(r, u), km: round(d, 1), dir: compass(bearing(home.lat, home.lng, r.lat, r.lng)) });
      }
      nearby.sort((a, b) => a.km - b.km || b.created_at - a.created_at);
      const w = activeWarnings(now)[u.village];
      return {
        village: home, radius_km: u.radius_km, nearby, warning: w ? alertView(w, u, new Set([w.id])) : null,
        open_total: open.length, reported_24h: open.filter((r) => now - r.created_at < DAY).length,
        awaiting_check: open.filter((r) => r.status === "reported").length, has_sample: db.incidents.some((r) => r.sample),
      };
    }],
    ["GET", /^\/api\/stats$/, "officer", (u, b, q) => {
      const [days, rows] = windowRows(q), resp = firstTimes("responded");
      const hours = rows.filter((r) => r.id in resp).map((r) => (resp[r.id] - r.created_at) / HOUR);
      const byV = {};
      for (const r of rows) byV[r.village] = (byV[r.village] || 0) + 1;
      const ser = {};
      for (const r of rows) ser[istDate(r.created_at)] = (ser[istDate(r.created_at)] || 0) + 1;
      const end = clock(), count = (f) => rows.filter(f).length;
      return {
        days, total: rows.length, open: count((r) => OPEN.includes(r.status)), resolved: count((r) => r.status === "resolved"),
        false_reports: count((r) => r.status === "false_report"), median_response_h: hours.length ? round(median(hours), 1) : null, responded_count: hours.length,
        by_type: M.types.map((t) => ({ key: t.key, label: t.label, count: count((r) => r.type === t.key) })),
        by_severity: M.severities.map((s) => ({ key: s.key, label: s.label, count: count((r) => r.severity === s.key) })),
        by_village: Object.entries(byV).sort((a, c) => c[1] - a[1] || (a[0] < c[0] ? -1 : 1)).map(([name, n]) => ({ name, count: n })),
        series: Array.from({ length: days }, (_, k) => istDate(end - (days - 1 - k) * DAY)).map((d) => ({ date: d, count: ser[d] || 0 })),
        crop_acres: round(rows.reduce((s, r) => s + r.crop_acres, 0), 2), property_inr: rows.reduce((s, r) => s + r.property_inr, 0), casualties: rows.reduce((s, r) => s + r.casualties, 0),
      };
    }],
    ["GET", /^\/api\/export\.csv$/, "officer", (u, b, q) => {
      const [, rows] = windowRows(q), resp = firstTimes("responded");
      const lines = [["report_no", "reported_ist", "type", "severity", "status", "village", "lat", "lng", "herd_size", "casualties", "crop_acres", "property_inr", "heading", "place", "response_hours", "photos", "voice_notes"]];
      for (const r of [...rows].reverse()) {
        const rh = r.id in resp ? pyNum(round((resp[r.id] - r.created_at) / HOUR, 1)) : "";
        lines.push([ref(r.id, r.created_at), istStamp(r.created_at), r.type, r.severity, r.status, r.village, pyNum(r.lat), pyNum(r.lng), r.herd_size, r.casualties, pyNum(r.crop_acres), r.property_inr, r.heading, cell(r.place), rh, attsOf(r.id).filter((a) => a.kind === "photo").length, attsOf(r.id).filter((a) => a.kind === "voice").length]);
      }
      return { csv: lines.map((l) => l.map(csvField).join(",")).join("\n") + "\n" };
    }],
    ["DELETE", /^\/api\/sample$/, "officer", () => {
      const gone = new Set(db.incidents.filter((r) => r.sample).map((r) => r.id));
      db.alerts = db.alerts.filter((a) => !a.sample).map((a) => (gone.has(a.incident_id) ? { ...a, incident_id: null } : a));
      db.incidents = db.incidents.filter((r) => !r.sample);
      db.events = db.events.filter((e) => !gone.has(e.incident_id));
      db.attachments = db.attachments.filter((a) => !gone.has(a.incident_id));
      return { ok: true };
    }],
  ];

  function handle(method, path, query, bodyText, auth) {
    const q = Object.fromEntries(new URLSearchParams(query || ""));
    try {
      let pathMatched = false;
      for (const [m, re, level, fn] of routes) {
        const match = path.match(re);
        if (!match) continue;
        pathMatched = true;
        if (m !== method) continue;
        const token = String(auth || "").replace(/^Bearer /, "").trim();
        const s = token && db.sessions.find((x) => x.token === token);
        const user = s ? { ...userById(s.user_id), _token: token } : null;
        if (level) {
          if (!user) throw new E(401, "Sign in to continue.");
          if (level === "staff" && !STAFF.includes(user.role)) throw new E(403, "Only forest staff can do this.");
          if (level === "officer" && user.role !== "officer") throw new E(403, "Only forest officers can do this.");
        }
        let body = {};
        if (["POST", "PATCH", "PUT"].includes(method) && bodyText) {
          try { body = JSON.parse(bodyText); } catch { throw new E(400, "Request body must be JSON."); }
          if (!body || typeof body !== "object" || Array.isArray(body)) throw new E(400, "Request body must be a JSON object.");
        }
        const out = fn(user, body, q, ...match.slice(1));
        if (out && out.csv !== undefined) return { status: 200, type: "text/csv; charset=utf-8", body: out.csv };
        return { status: 200, type: "application/json", body: JSON.stringify(out) };
      }
      throw pathMatched ? new E(405, "Method not allowed.") : new E(404, "Not found.");
    } catch (e) {
      if (!(e instanceof E)) throw e;
      return { status: e.status, type: "application/json", body: JSON.stringify({ error: e.message, field: e.field }) };
    }
  }
  return { handle };
}
