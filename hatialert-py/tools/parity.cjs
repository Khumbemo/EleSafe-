// Checks that the JavaScript fallback engine answers exactly like the Python
// API. Run: node tools/parity.cjs   (needs python3 on PATH)
const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");
// fallback.js is a plain browser script; load it the way the page does.
const createFallbackEngine = new Function(fs.readFileSync(path.join(__dirname, "preview/fallback.js"), "utf8") + "\nreturn createFallbackEngine;")();

const H = 3600000;
const login = (role, phone, pin) => ({ method: "POST", path: "/api/auth/login", body: { phone, pin }, login: role });
const S = [
  { method: "GET", path: "/api/meta" },
  { method: "POST", path: "/api/severity", body: { type: "crop_raid", herd_size: 5 } },
  { method: "POST", path: "/api/severity", body: { type: "crop_raid", herd_size: "x" } },
  login("v", "9000000001", "1111"), login("g", "+91 90000 00002", "2222"), login("o", "09000000003", "3333"),
  { method: "POST", path: "/api/auth/login", body: { phone: "9000000001", pin: "9999" } },
  { method: "POST", path: "/api/auth/login", body: { phone: "123", pin: "1" } },
  { as: "v", method: "GET", path: "/api/me" },
  { as: "v", method: "GET", path: "/api/overview" },
  { as: "v", method: "GET", path: "/api/incidents" },
  { as: "v", method: "GET", path: "/api/incidents?status=closed" },
  { as: "g", method: "GET", path: "/api/incidents?status=all&village=Baghty" },
  { as: "v", method: "GET", path: "/api/incidents/2" },
  { as: "g", method: "GET", path: "/api/incidents/2" },
  { as: "v", method: "GET", path: "/api/incidents/999" },
  { as: "v", method: "POST", path: "/api/incidents", body: { type: "crop_raid", herd_size: "7", village: "Sanis", offset_km: "2", offset_dir: "SW", heading: "N", crop_acres: "1.333", property_inr: "2500", place: "=SUM(A1)", description: " fields " }, advance: H },
  { as: "v", method: "POST", path: "/api/incidents", body: { type: "injury", village: "Ralan", lat: 26.07, lng: 94.28 } },
  { as: "v", method: "POST", path: "/api/incidents", body: { type: "sighting", village: "Ralan", herd_size: 900 } },
  { as: "v", method: "POST", path: "/api/incidents", body: { type: "sighting", village: "Ralan", property_inr: 99999999 } },
  { as: "v", method: "POST", path: "/api/incidents", body: { type: "sighting", village: "Ralan", offset_km: 1 } },
  { as: "v", method: "POST", path: "/api/incidents", body: { type: "sighting", village: "Nowhere" } },
  { as: "v", method: "GET", path: "/api/incidents?mine=1&status=all" },
  { as: "v", method: "PATCH", path: "/api/incidents/14", body: { status: "verified" } },
  { as: "g", method: "PATCH", path: "/api/incidents/14", body: { status: "resolved" }, advance: H },
  { as: "g", method: "PATCH", path: "/api/incidents/14", body: { status: "verified", note: "Seen" } },
  { as: "g", method: "PATCH", path: "/api/incidents/14", body: { status: "responded" }, advance: 2 * H },
  { as: "g", method: "PATCH", path: "/api/incidents/14", body: { status: "resolved" } },
  { as: "o", method: "PATCH", path: "/api/incidents/14", body: { status: "resolved", note: "Paid" }, advance: 3 * H },
  { as: "g", method: "PATCH", path: "/api/incidents/14", body: {} },
  { as: "g", method: "GET", path: "/api/incidents/14/villages?km=6" },
  { as: "g", method: "POST", path: "/api/alerts", body: { level: "all_clear", message: "Herd left", villages: ["Wozhuro", "Tening"], incident_id: 1 } },
  { as: "g", method: "POST", path: "/api/alerts", body: { level: "warning", message: "", villages: ["Wozhuro"] } },
  { as: "v", method: "GET", path: "/api/alerts" },
  { as: "v", method: "GET", path: "/api/overview" },
  { as: "v", method: "PATCH", path: "/api/me", body: { village: "Tening", radius_km: "10" } },
  { as: "v", method: "GET", path: "/api/overview" },
  { as: "v", method: "PATCH", path: "/api/me", body: { radius_km: 99 } },
  { as: "g", method: "GET", path: "/api/stats" },
  { as: "o", method: "GET", path: "/api/stats?days=7" },
  { as: "o", method: "GET", path: "/api/stats?days=90", advance: 30 * 60000 },
  { as: "o", method: "GET", path: "/api/export.csv?days=90" },
  { method: "POST", path: "/api/auth/register", body: { name: "Akum Jamir", phone: "9876543210", village: "Englan", pin: "2468" }, login: "n" },
  { method: "POST", path: "/api/auth/register", body: { name: "Akum Jamir", phone: "9876543210", village: "Englan", pin: "2468" } },
  { as: "n", method: "GET", path: "/api/overview", advance: 25 * H },
  { as: "o", method: "DELETE", path: "/api/sample" },
  { as: "o", method: "GET", path: "/api/stats?days=90" },
  { as: "v", method: "GET", path: "/api/incidents?mine=1&status=all" },
  { as: "n", method: "POST", path: "/api/auth/logout" },
  { as: "n", method: "GET", path: "/api/me" },
  { method: "GET", path: "/api/nothing" },
  { method: "PUT", path: "/api/meta" },
];

const py = JSON.parse(execFileSync("python3", [path.join(__dirname, "parity_py.py")], { input: JSON.stringify(S), maxBuffer: 1 << 26 }).toString());
let now = 1_800_000_000_000;
const eng = createFallbackEngine(py.seed, { clock: () => now });
const tokens = {};
const strip = (v) => (Array.isArray(v) ? v.map(strip) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== "token").map(([k, x]) => [k, strip(x)])) : v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
let bad = 0;
S.forEach((step, k) => {
  now += step.advance || 0;
  const [p, q = ""] = step.path.split("?");
  const res = eng.handle(step.method, p, q, step.body ? JSON.stringify(step.body) : "", step.as ? "Bearer " + tokens[step.as] : "");
  if (step.login && res.status === 200) tokens[step.login] = JSON.parse(res.body).token;
  const want = py.results[k];
  const norm = (r) => ({ status: r.status, type: r.type, body: r.type.startsWith("text/csv") ? r.body : sortKeys(strip(JSON.parse(r.body))) });
  const a = norm(want), b = norm(res);
  if (!same(a, b)) {
    bad++;
    console.log(`DIFF step ${k}: ${step.method} ${step.path}`);
    console.log("  python:", JSON.stringify(a).slice(0, 600));
    console.log("  js    :", JSON.stringify(b).slice(0, 600));
  }
});
console.log(bad ? `${bad} of ${S.length} responses differ` : `All ${S.length} responses match`);
process.exit(bad ? 1 : 0);
