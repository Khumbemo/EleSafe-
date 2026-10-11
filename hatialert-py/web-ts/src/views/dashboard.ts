/* District overview for forest officers: counts, charts and CSV export. */
import { api, transport } from "../api";
import { $$, fill, h, s } from "../dom";
import { icon } from "../icons";
import { me, state } from "../state";
import type { CountRow, Stats } from "../types";
import { failure, loading, toast } from "../ui";
import { asErr, inr, plural } from "../util";

/** Copy to the clipboard, or select `fallbackEl` so the person can. */
export async function copy(text: string, fallbackEl?: HTMLTextAreaElement): Promise<void> {
  try { await navigator.clipboard.writeText(text); toast("Copied"); }
  catch { if (fallbackEl) { fallbackEl.focus(); fallbackEl.select?.(); } toast("Press Ctrl+C or long-press to copy"); }
}

function seriesChart(series: Stats["series"]): SVGSVGElement {
  const W = 420, H = 130, top = 12, bottom = 22, left = 22;
  const max = Math.max(1, ...series.map((d) => d.count));
  const bw = (W - left) / series.length;
  const y = (v: number) => top + (H - top - bottom) * (1 - v / max);
  const fmt = (d: string) => new Date(d + "T00:00:00+05:30").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
  const bars = series.map((d, k) => s("rect", {
    class: `bar${d.count ? "" : " zero"}`,
    x: (left + k * bw + bw * 0.15).toFixed(1), y: (d.count ? y(d.count) : H - bottom - 2).toFixed(1),
    width: Math.max(1, bw * 0.7).toFixed(1), height: (d.count ? H - bottom - y(d.count) : 2).toFixed(1),
  }, s("title", null, `${fmt(d.date)}: ${plural(d.count, "incident")}`)));
  const ticks = [0, Math.floor(series.length / 2), series.length - 1].map((k) => s("text", {
    x: (left + k * bw + bw / 2).toFixed(1), y: H - 6, "text-anchor": k === 0 ? "start" : k === series.length - 1 ? "end" : "middle",
  }, fmt(series[k].date)));
  return s("svg", { class: "chart", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Incidents per day" },
    s("line", { class: "axis", x1: left, y1: H - bottom, x2: W, y2: H - bottom }),
    s("line", { class: "axis", x1: left, y1: y(max), x2: W, y2: y(max), "stroke-dasharray": "3 4" }),
    s("text", { x: left - 6, y: y(max) + 4, "text-anchor": "end" }, max),
    s("text", { x: left - 6, y: H - bottom + 4, "text-anchor": "end" }, "0"),
    bars, ticks);
}

const hbars = (rows: CountRow[]): HTMLDivElement => {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return h("div", { class: "hbars" }, rows.map((r) => h("div", { class: "hbar" },
    h("span", null, r.label || r.name),
    s("svg", { viewBox: "0 0 100 12", preserveAspectRatio: "none", "aria-hidden": "true" },
      s("rect", { class: "track", width: 100, height: 12, rx: 3 }),
      s("rect", { class: "fill", width: ((r.count / max) * 100).toFixed(1), height: 12, rx: 3 })),
    h("b", null, r.count))));
};

export async function viewDashboard(): Promise<void> {
  if (me().role !== "officer") { location.hash = "#/home"; return; }
  const main = loading("more");
  let st: Stats;
  try { st = await api<Stats>("GET", `/api/stats?days=${state.days}`); } catch (err) { return failure(main, asErr(err)); }
  const out = h("section", { class: "card", id: "csv-out", hidden: true });
  const csvButton = h("button", { class: "btn small", id: "csv" }, "Export CSV");
  const kpi = (label: string, value: string | number, note: string) => h("div", { class: "kpi" }, h("small", null, label), h("b", null, value), h("small", null, note));
  const none = () => h("p", { class: "muted" }, "No incidents in this period.");
  fill(main,
    h("div", { class: "pagehead" }, h("a", { class: "small", href: "#/more" }, "← More"), h("h1", null, "District overview")),
    h("div", { class: "row between" },
      h("div", { class: "seg", role: "group", "aria-label": "Period" }, [7, 30, 90].map((d) => h("button", {
        type: "button", "data-days": d, "aria-pressed": String(state.days === d),
      }, `${d} days`))),
      csvButton),
    h("div", { class: "kpis" },
      kpi("Incidents", st.total, `${st.open} still open`),
      kpi("Median time to respond", st.median_response_h == null ? "—" : st.median_response_h + " h", `across ${plural(st.responded_count, "case")}`),
      kpi("People hurt or killed", st.casualties, `${st.false_reports} false ${st.false_reports === 1 ? "report" : "reports"}`),
      kpi("Recorded losses", `${st.crop_acres} ac`, `crops · ${inr(st.property_inr)} property`)),
    h("section", { class: "card" }, h("h2", null, "Incidents per day"), seriesChart(st.series)),
    h("div", { class: "grid2 wide" },
      h("section", { class: "card" }, h("h2", null, "Hotspot villages"), st.by_village.length ? hbars(st.by_village.slice(0, 8)) : none()),
      h("section", { class: "card" }, h("h2", null, "What happened"), hbars(st.by_type.filter((t) => t.count)), st.total ? null : none())),
    h("section", { class: "card" }, h("h2", null, "Severity"), hbars(st.by_severity)),
    out);
  $$("[data-days]", main).forEach((b) => (b.onclick = () => { state.days = +(b.dataset.days as string); viewDashboard(); }));
  csvButton.onclick = async () => {
    const text = await api<string>("GET", `/api/export.csv?days=${state.days}`);
    out.hidden = false;
    const area = h("textarea", { class: "csv", id: "csv-text", readonly: true, "aria-label": "CSV export" });
    const save = transport.canDownload ? h("button", { class: "btn small", id: "csv-save" }, "Download") : null;
    fill(out,
      h("div", { class: "row between" },
        h("h2", null, `CSV · last ${state.days} days`),
        h("div", { class: "row" }, save, h("button", { class: "btn small", id: "csv-copy", on: { click: () => copy(text, area) } }, icon("copy"), " Copy"))),
      area);
    area.value = text;
    if (save) save.onclick = () => {
      const a = h("a", { href: URL.createObjectURL(new Blob([text], { type: "text/csv" })), download: `hatialert-${state.days}d.csv` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    out.scrollIntoView({ behavior: "smooth", block: "start" });
  };
}
