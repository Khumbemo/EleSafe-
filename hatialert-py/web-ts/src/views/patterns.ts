/* District overview, second half: where and when elephants cause trouble.
   Hotspot villages (ranked by a severity score), a map of shaded UTM grid
   squares, reports by month of the year (seasons) and by hour of the day
   (night shaded). Every chart has a table with the same numbers. Data:
   GET /api/stats/patterns; false reports are left out by the server. */
import { api } from "../api";
import { $$, type Child, fill, h, s } from "../dom";
import { utmKm } from "../geo";
import { heatLevel, mapBlock } from "../map";
import { state } from "../state";
import type { IncidentType, Patterns } from "../types";
import { asErr, plural } from "../util";

/** Below this many reports, show counts only: shares of a handful mislead. */
const MIN_FOR_SHARE = 20;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const hh = (k: number): string => String(k).padStart(2, "0") + ":00";

/** "12 (40%)", the share only when there are enough reports for it to mean something. */
const share = (n: number, total: number): string => (total >= MIN_FOR_SHARE && total > 0 ? `${n} (${Math.round((100 * n) / total)}%)` : String(n));

const monthYear = (ms: number): string => new Date(ms).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "Asia/Kolkata" });

/** A table with the chart's numbers, folded away under "Show as a table". */
function table(caption: string, head: string[], rows: Child[][]): HTMLDetailsElement {
  return h("details", { class: "tbl-fold" },
    h("summary", null, "Show as a table"),
    h("div", { class: "tblwrap" },
      h("table", { class: "tbl" },
        h("caption", null, caption),
        h("thead", null, h("tr", null, head.map((x, k) => h("th", { scope: "col", class: k ? "num" : "" }, x)))),
        h("tbody", null, rows.map((r) => h("tr", null, r.map((c, k) => (k ? h("td", { class: "num" }, c) : h("th", { scope: "row" }, c)))))))));
}

/** A column chart. `shade(k)` marks columns drawn over a shaded band
    (night); `ticks` are the columns that get a label under them. */
function columns(vals: number[], labels: string[], o: { label: string; ticks: number[]; tip: (k: number) => string; shade?: (k: number) => boolean; shadeLabel?: string }): SVGSVGElement {
  const W = 420, H = 160, top = 18, bottom = 22, left = 24, n = vals.length;
  const max = Math.max(1, ...vals), bw = (W - left) / n, base = H - bottom;
  const y = (v: number) => top + (base - top) * (1 - v / max);
  const x = (k: number) => left + k * bw;
  const bands: SVGElement[] = [];
  if (o.shade) {
    for (let k = 0; k < n;) {
      if (!o.shade(k)) { k++; continue; }
      let e = k;
      while (e < n && o.shade(e)) e++;
      bands.push(s("rect", { class: "band", x: x(k).toFixed(1), y: 2, width: ((e - k) * bw).toFixed(1), height: base - 2 }),
        s("text", { class: "bandlabel", x: (x(k) + 4).toFixed(1), y: 13 }, o.shadeLabel || ""));
      k = e;
    }
  }
  const peak = vals.indexOf(Math.max(...vals));
  return s("svg", { class: "chart cols", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": o.label },
    bands,
    s("line", { class: "axis", x1: left, y1: base, x2: W, y2: base }),
    s("line", { class: "axis", x1: left, y1: y(max), x2: W, y2: y(max), "stroke-dasharray": "3 4" }),
    s("text", { x: left - 6, y: y(max) + 4, "text-anchor": "end" }, max),
    s("text", { x: left - 6, y: base + 4, "text-anchor": "end" }, "0"),
    vals.map((v, k) => s("rect", {
      class: `bar${v ? "" : " zero"}`, x: (x(k) + bw * 0.14).toFixed(1), y: (v ? y(v) : base - 2).toFixed(1),
      width: Math.max(1, bw * 0.72).toFixed(1), height: (v ? base - y(v) : 2).toFixed(1),
    }, s("title", null, o.tip(k)))),
    vals[peak] > 0 && s("text", { class: "peak", x: (x(peak) + bw / 2).toFixed(1), y: (y(vals[peak]) - 4).toFixed(1), "text-anchor": "middle" }, vals[peak]),
    o.ticks.map((k) => s("text", { x: (x(k) + bw / 2).toFixed(1), y: H - 6, "text-anchor": "middle" }, labels[k])));
}

/** Nearest village to the middle of a grid square, for the squares table. */
function nearestVillage(e: number, n: number): string {
  let best = "", d = Infinity;
  for (const v of state.meta.villages) {
    const [ve, vn] = utmKm(v.lat, v.lng), dd = Math.hypot(ve - e, vn - n);
    if (dd < d) { d = dd; best = v.name; }
  }
  return `${best}, ${d.toFixed(1)} km`;
}

const url = (sample: boolean): string => `/api/stats/patterns?months=${state.patternMonths}&sample=${sample ? 1 : 0}`;

/** Fill `box` with the patterns; it loads its own data. */
export async function loadPatterns(box: HTMLElement): Promise<void> {
  fill(box, h("div", { class: "skeleton", "aria-busy": "true", "aria-label": "Loading…" }, h("span", { class: "skel line title" }), h("span", { class: "skel block tall" })));
  let p: Patterns;
  try {
    p = await api<Patterns>("GET", url(state.patternSample === true));
    // With no real reports yet (a new or demo database), show the sample
    // reports rather than empty charts, and say so plainly.
    if (state.patternSample === null && p.total === 0 && p.sample_reports > 0) p = await api<Patterns>("GET", url(true));
  } catch (err) {
    fill(box, h("section", { class: "card" }, h("h2", null, "Patterns"), h("p", { class: "muted" }, asErr(err).message)));
    return;
  }
  if (box.isConnected) renderPatterns(box, p);
}

function renderPatterns(box: HTMLElement, p: Patterns): void {
  const typeKey = state.patternType && p.types.some((t) => t.key === state.patternType && t.count) ? state.patternType : "";
  const typeLabel = typeKey ? (p.types.find((t) => t.key === typeKey) as { label: string }).label : "";
  const pick = (b: { count: number; types: Record<IncidentType, number> }) => (typeKey ? b.types[typeKey] : b.count);
  const period = p.months ? `since ${monthYear(p.since as number)}` : "from all time";
  const sampleBox = h("input", { type: "checkbox", id: "pat-sample", checked: p.include_sample });
  const head = [
    h("div", { class: "pagehead" },
      h("h2", { class: "section-title" }, "Patterns: where and when"),
      h("p", { class: "muted", id: "pat-basis" }, `Based on ${plural(p.total, "report")} ${period}. False reports are left out.`)),
    h("div", { class: "row between" },
      h("div", { class: "seg", role: "group", "aria-label": "Patterns period" }, [[12, "12 months"], [0, "All time"]].map(([m, label]) => h("button", {
        type: "button", "data-pmonths": m, "aria-pressed": String(state.patternMonths === m),
      }, label))),
      p.sample_reports > 0 && h("label", { class: "switch" }, sampleBox, h("span", null, `Include ${plural(p.sample_reports, "sample report")}`))),
    p.include_sample && p.sample_reports > 0 && h("p", { class: "notice", id: "pat-sample-note" },
      h("span", null, "Showing sample reports. They are made-up demo data, not real incidents.")),
  ];
  const wire = () => {
    $$("[data-pmonths]", box).forEach((b) => (b.onclick = () => { state.patternMonths = +(b.dataset.pmonths as string); loadPatterns(box); }));
    sampleBox.onchange = () => { state.patternSample = sampleBox.checked; loadPatterns(box); };
    $$("[data-ptype]", box).forEach((b) => (b.onclick = () => { state.patternType = (b.dataset.ptype || "") as IncidentType | ""; renderPatterns(box, p); }));
  };
  if (!p.total) {
    fill(box, head, h("section", { class: "card" }, h("p", { class: "muted" }, "No reports to show for this period.")));
    wire();
    return;
  }
  const few = p.total < MIN_FOR_SHARE && h("p", { class: "notice", id: "pat-few" },
    h("span", null, `Only ${plural(p.total, "report")} so far: read these as counts, not as trends.`));

  // -- hotspot villages -------------------------------------------------
  const vmax = Math.max(...p.villages.map((v) => v.score));
  // type names in their own elements, so the Nagamese translator finds them
  const breakdown = (t: Record<IncidentType, number>) => p.types.filter((x) => t[x.key]).map((x) => [" · ", h("span", null, x.label), ` ${t[x.key]}`]);
  const w = p.weights;
  const villages = h("section", { class: "card", id: "pat-villages" },
    h("h2", null, "Hotspot villages"),
    h("p", { class: "small muted" }, `Ranked by severity score: each report counts critical ${w.critical}, high ${w.high}, medium ${w.medium}, low ${w.low}.`),
    h("ol", { class: "hot" }, p.villages.slice(0, 10).map((v) => h("li", null,
      h("div", { class: "hot-head" },
        h("b", null, v.name),
        h("span", { class: "hot-score" }, h("i", { class: `hk heat${heatLevel(v.score, vmax)}`, "aria-hidden": "true" }), `score ${v.score}`)),
      s("svg", { class: "hot-bar", viewBox: "0 0 100 8", preserveAspectRatio: "none", "aria-hidden": "true" },
        s("rect", { class: "track", width: 100, height: 8, rx: 3 }),
        s("rect", { class: `fill heat${heatLevel(v.score, vmax)}`, width: ((v.score / vmax) * 100).toFixed(1), height: 8, rx: 3 })),
      h("small", null, h("span", null, `${plural(v.count, "report")}, ${v.night} at night`), breakdown(v.types))))),
    p.villages.length > 10 && h("p", { class: "small muted" }, `${p.villages.length - 10} more villages with fewer reports.`),
    table("Reports by village", ["Village", "Score", "Reports", "At night", ...p.types.filter((t) => t.count).map((t) => t.label)],
      p.villages.map((v) => [v.name, v.score, v.count, v.night, ...p.types.filter((t) => t.count).map((t) => v.types[t.key])])));

  // -- grid squares on the map ------------------------------------------
  const top = p.cells.slice(0, 10);
  const squares = h("section", { class: "card", id: "pat-map" },
    h("h2", null, "Hotspot map"),
    h("p", { class: "small muted" }, `Reports grouped into ${p.cell_km} × ${p.cell_km} km squares of the UTM zone 46N grid, shaded by severity score. ${plural(p.cells.length, "square")} had reports.`),
    mapBlock({ cells: p.cells, cellKm: p.cell_km, label: `Map of ${plural(p.cells.length, "grid square")} with reports, shaded by severity score` }),
    table(`Busiest ${p.cell_km} km squares`, ["Square (south-west corner, km)", "Nearest village", "Reports", "Score"],
      top.map((c) => [`${c.e} E, ${c.n} N`, nearestVillage(c.e + p.cell_km / 2, c.n + p.cell_km / 2), c.count, c.score])));

  // -- type filter for the two time charts ------------------------------
  const filter = h("div", { class: "seg", role: "group", "aria-label": "Type of incident in the charts", id: "pat-types" },
    h("button", { type: "button", "data-ptype": "", "aria-pressed": String(!typeKey) }, "All types"),
    p.types.filter((t) => t.count).map((t) => h("button", { type: "button", "data-ptype": t.key, "aria-pressed": String(typeKey === t.key) }, t.label)));
  const what = typeKey ? typeLabel : "All reports";
  const shown = typeKey ? p.types.find((t) => t.key === typeKey)?.count || 0 : p.total;

  // -- months -----------------------------------------------------------
  const mv = p.months_of_year.map(pick);
  const busiest = Math.max(...mv);
  const peakMonths = mv.map((v, k) => (v === busiest && v ? MONTH_NAMES[k] : "")).filter(Boolean).join(", ");
  const seasons = h("section", { class: "card", id: "pat-months" },
    h("h2", null, "Time of year"),
    h("p", { class: "small muted" }, `${what} by month, ${p.months ? "over the last 12 months" : "added up across all years"}.`),
    columns(mv, MONTHS, {
      label: `${what} by month of the year. Busiest: ${peakMonths || "none"}.`, ticks: MONTHS.map((_, k) => k),
      tip: (k) => `${MONTH_NAMES[k]}: ${plural(mv[k], "report")}`,
    }),
    h("p", { class: "small" }, busiest ? `Busiest: ${peakMonths} (${plural(busiest, "report")}).` : "No reports of this type."),
    table(`${what} by month`, ["Month", "Reports"], MONTH_NAMES.map((m, k) => [m, share(mv[k], shown)])));

  // -- hours ------------------------------------------------------------
  const hv = p.hours.map(pick);
  const nf = p.night.from_hour, nt = p.night.to_hour, isNight = (k: number) => k >= nf || k < nt;
  const nightN = hv.reduce((a, v, k) => a + (isNight(k) ? v : 0), 0);
  const nightText = `Night is ${hh(nf)} to ${hh(nt)} IST`;
  const clock = h("section", { class: "card", id: "pat-hours" },
    h("h2", null, "Time of day"),
    h("p", { class: "small muted" }, `${what} by hour of the day, Indian Standard Time. ${nightText} (shaded).`),
    columns(hv, hv.map((_, k) => hh(k)), {
      label: `${what} by hour of the day. ${nightN} of ${shown} at night.`, ticks: [0, 6, 12, 18],
      tip: (k) => `${hh(k)} to ${hh((k + 1) % 24)}: ${plural(hv[k], "report")}`, shade: isNight, shadeLabel: "Night",
    }),
    h("div", { class: "kpis" },
      h("div", { class: "kpi" }, h("small", null, "At night"), h("b", { id: "pat-night" }, share(nightN, shown)), h("small", null, `${hh(nf)} to ${hh(nt)}`)),
      h("div", { class: "kpi" }, h("small", null, "By day"), h("b", null, share(shown - nightN, shown)), h("small", null, `${hh(nt)} to ${hh(nf)}`))),
    table(`${what} by hour (IST)`, ["Hour", "Reports"], hv.map((v, k) => [`${hh(k)}–${hh((k + 1) % 24)}${isNight(k) ? " (night)" : ""}`, share(v, shown)])));

  fill(box, head, few, villages, squares, h("div", { class: "pat-filter" }, h("span", { class: "label" }, "Show"), filter), seasons, clock);
  wire();
}
