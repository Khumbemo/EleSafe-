// Checks web/nagamese.js: every pattern compiles, uses only groups it has,
// and the JS UTM formula in app.js agrees with PROJ reference values.
// Run: node tools/check_i18n.cjs
const fs = require("fs");
const path = require("path");
const web = path.join(__dirname, "..", "hatialert", "web");
const window = {};
new Function("window", fs.readFileSync(path.join(web, "nagamese.js"), "utf8"))(window);
const N = window.HATI_NAGAMESE;
let bad = 0;
for (const [re, tpl] of N.patterns) {
  let rx;
  try { rx = new RegExp("^" + re + "$"); } catch (e) { console.log("BAD REGEX", re, e.message); bad++; continue; }
  const groups = new RegExp(re + "|").exec("").length - 1;
  for (const m of tpl.matchAll(/\{(\d)\}/g)) if (+m[1] > groups || +m[1] < 1) { console.log("BAD GROUP", re, tpl); bad++; }
}
// Every pattern must match a real example of the English it is for.
const SAMPLES = [
  "Elephant warning · Wozhuro", "Within 5 km of Wozhuro", "3 open incidents near you", "1 open incident near you",
  "2 open incidents elsewhere in the district. You'll see new reports here.", "2.3 km SW of Wokha Town", "· 6 elephants",
  "5 min ago", "3 h ago", "2 days ago", "of 1:00", "0.5 km away", "Using 26.1, 94.2 (±12 m)", "1 photo, 1 voice note", "3 cases",
  "1.5 acres", "Warnings from forest staff. Alerts for Sanis are marked.", "30 days", "4 still open", "across 9 cases",
  "1 false report", "crops · ₹87,000 property", "CSV · last 30 days", "4 Oct: 2 incidents", "Copy Police number",
  "Theme: Navy blue", "Language: English", "Engine: Python server", "View photo 2", "Voice note 1", "Your 5 km alert area",
  "Sanis: position not verified", "Enter a value from 0 to 200.", "Keep this under 400 characters.",
  "Each photo must be under 1.5 MB.", "A report can have up to 2 voice notes.", "Too many wrong PINs. Try again in 3 min.",
  "A verified case can't move to that status.", "2 reports", "No connection. Showing what was saved at 07:48 am.",
  "Saved report sent: HA-2610-0015", "A saved report couldn't be sent: Choose what happened.",
  "2 photos or voice notes, seen only by the reporter and forest staff.", "Alert sent. 3 people to text by hand (Admin › Messages)",
  "Alert sent. Texting 1 person", "Text me alerts for Wozhuro", "2 wrong PINs today", "Last seen 5 min ago", "Temporary PIN for",
  "8 village positions are not checked yet. Distances and alert areas depend on them.", "Imported: 1 added, 1 updated",
  "Skipped 1 line with a problem: 4", "2 people", "1 incident", "Sent: 1", "6 elephants",
];
const compiled = N.patterns.map(([re, tpl]) => [new RegExp("^" + re + "$"), re]);
for (const [rx, re] of compiled) if (!SAMPLES.some((t) => rx.test(t))) { console.log("PATTERN MATCHES NO SAMPLE", re); bad++; }
for (const [k, v] of Object.entries(N.words)) if (typeof v !== "string" || !v.trim()) { console.log("EMPTY", k); bad++; }
const src = fs.readFileSync(path.join(web, "app.js"), "utf8");
const utmSrc = src.slice(src.indexOf("const utmKm = ("), src.indexOf("// Point `km` from"));
const utmKm = new Function(utmSrc + "; return utmKm;")();
for (const [[lat, lon], [e, n]] of [[[26.09717, 94.25817], [625817.193, 2887052.62]], [[25.9208, 93.9549], [595630.908, 2867261.356]], [[26.5595, 94.3908], [638530.297, 2938399.207]]]) {
  const [ke, kn] = utmKm(lat, lon);
  if (Math.abs(ke * 1000 - e) > 0.01 || Math.abs(kn * 1000 - n) > 0.01) { console.log("UTM MISMATCH", lat, lon, ke, kn); bad++; }
}
console.log(bad ? `${bad} problems` : `OK: ${Object.keys(N.words).length} phrases, ${N.patterns.length} patterns, JS UTM matches PROJ`);
process.exit(bad ? 1 : 0);
