/* Home: the home village's warning, incidents nearby and the map. */
import { api } from "../api";
import { fill, h } from "../dom";
import { icon } from "../icons";
import { mapBlock } from "../map";
import { notify } from "../notify";
import { flushQueue } from "../offline";
import { isStaff, me } from "../state";
import type { Incident, Overview } from "../types";
import { failure, incidentItem, loading, toast } from "../ui";
import { ago, asErr, plural } from "../util";

export async function viewHome(): Promise<void> {
  const main = loading("home");
  let o: Overview, open: Incident[];
  try { [o, open] = await Promise.all([api<Overview>("GET", "/api/overview"), api<Incident[]>("GET", "/api/incidents?status=open")]); }
  catch (err) { return failure(main, asErr(err)); }
  const w = o.warning;
  const u = me();
  main.classList.add("wide");
  const askButton = () => h("button", { class: "btn small", "data-ask": true }, "Remove sample data");
  const sample = o.has_sample && u.role === "officer" ? h("span", { class: "confirm", id: "sample" }, askButton()) : null;
  fill(main, h("div", { class: "two-col" },
    h("div", { class: "col" },
      w && h("a", { class: "warning", href: "#/alerts" },
        h("span", { class: "label" }, `Elephant warning · ${o.village.name}`),
        h("p", { translate: "no" }, w.message),
        h("span", { class: "small muted" }, ago(w.sent_at), w.by ? ` · ${w.by}` : "")),
      h("div", { class: "pagehead" },
        h("span", { class: "label" }, `Within ${o.radius_km} km of ${o.village.name}`),
        h("h1", null, o.nearby.length ? `${plural(o.nearby.length, "open incident")} near you` : "No open incidents near you")),
      o.nearby.length
        ? h("section", { class: "card flush divide" }, o.nearby.slice(0, 5).map((i) => incidentItem(i, `${i.km} km ${i.dir} of ${o.village.name}`)))
        : h("p", { class: "muted" }, o.open_total ? `${plural(o.open_total, "open incident")} elsewhere in the district.` : "All quiet across the district.", " You'll see new reports here."),
      h("div", { class: "notice", id: "queue-note", hidden: true },
        h("span", null, "Waiting to send: ", h("b", { "data-count": true }), ". They go automatically when you're back online."),
        h("button", { class: "btn small", id: "flush", on: { click: () => flushQueue() } }, "Send now")),
      h("div", { class: "actions" },
        h("a", { class: "action primary", href: "#/report" }, icon("report"), h("span", null, "Report elephants")),
        h("a", { class: "action", href: "#/report/camera" }, icon("camera"), h("span", null, "Snap a photo and report"))),
      isStaff() && h("div", { class: "kpis three late" },
        h("div", { class: "kpi" }, h("small", null, "Open in district"), h("b", null, o.open_total)),
        h("div", { class: "kpi" }, h("small", null, "Waiting for a check"), h("b", null, o.awaiting_check)),
        h("div", { class: "kpi" }, h("small", null, "Reported in 24 h"), h("b", null, o.reported_24h))),
      sample && h("div", { class: "notice late" }, h("span", null, "Sample incidents are loaded so you can try the app."), sample)),
    h("div", { class: "col sticky-col" }, h("section", { class: "card flush" }, mapBlock({ incidents: open, home: o.village.name, radius: o.radius_km })))));
  flushQueue();
  notify.check();
  if (sample) {
    sample.onclick = async (e) => {
      const t = e.target as Element;
      if (t.matches("[data-ask]")) fill(sample, h("span", { class: "small" }, "Delete all sample incidents and alerts?"), h("button", { class: "btn small danger", "data-yes": true }, "Delete"), h("button", { class: "btn small", "data-no": true }, "Keep"));
      else if (t.matches("[data-no]")) fill(sample, askButton());
      else if (t.matches("[data-yes]")) { await api("DELETE", "/api/sample"); toast("Sample data removed"); viewHome(); }
    };
  }
}
