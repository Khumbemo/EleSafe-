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
