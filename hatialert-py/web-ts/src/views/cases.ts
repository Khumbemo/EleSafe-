/* The case list (staff) or "My reports" (villagers), and one case. */
import { api } from "../api";
import { $maybe, $$, type Child, fill, h } from "../dom";
import { icon } from "../icons";
import { mapBlock } from "../map";
import { hydrateMedia, lightbox, type MediaItem, mediaTiles, takePhoto, voiceRecorder } from "../media";
import { type CasesFilter, isStaff, me, state } from "../state";
import type { Incident, IncidentDetail, NearVillage, Status } from "../types";
import { failure, incidentItem, loading, sevPill, showErrors, toast } from "../ui";
import { asErr, inr, plural, when } from "../util";
import { field } from "./auth";

export async function viewCases(): Promise<void> {
  const staff = isStaff();
  const main = loading("cases");
  const qs = staff ? `status=${state.casesFilter}${state.casesVillage ? `&village=${encodeURIComponent(state.casesVillage)}` : ""}` : "mine=1&status=all";
  let rows: Incident[];
  try { rows = await api<Incident[]>("GET", "/api/incidents?" + qs); } catch (err) { return failure(main, asErr(err)); }
  const filters: [CasesFilter, string][] = [["open", "Open"], ["closed", "Closed"], ["all", "All"]];
  fill(main,
    h("div", { class: "pagehead" },
      h("h1", null, staff ? "Cases" : "My reports"),
      h("p", { class: "muted" }, staff ? "Check new reports first. Oldest unchecked cases need attention." : "Follow what the forest staff are doing about your reports.")),
    staff && h("div", { class: "row between" },
      h("div", { class: "seg", role: "group", "aria-label": "Status" }, filters.map(([k, l]) => h("button", {
        type: "button", "data-filter": k, "aria-pressed": String(state.casesFilter === k),
        on: { click() { state.casesFilter = k; viewCases(); } },
      }, l))),
      h("select", {
        id: "cases-village", class: "narrow", "aria-label": "Filter by village",
        on: { change() { state.casesVillage = (this as HTMLSelectElement).value; viewCases(); } },
      }, h("option", { value: "" }, "All villages"), state.meta.villages.map((v) => h("option", { selected: v.name === state.casesVillage }, v.name)))),
    h("section", { class: "card flush divide" }, rows.length
      ? rows.map((i) => incidentItem(i))
      : h("div", { class: "empty" },
        h("b", null, "Nothing here"),
        h("span", null, staff ? "No cases match this filter." : "Reports you send will appear here."),
        !staff && h("a", { class: "btn primary", href: "#/report" }, "Report elephants"))),
    h("p", { class: "small muted tnum" }, plural(rows.length, "case")));
}

const VERBS: Partial<Record<Status, string>> = { verified: "Mark verified", responded: "Mark team responded", resolved: "Close as resolved", false_report: "Mark false report" };

export async function viewCase(id: string | undefined): Promise<void> {
  const main = loading("cases");
  let i: IncidentDetail;
  try { i = await api<IncidentDetail>("GET", `/api/incidents/${id}`); } catch (err) { return failure(main, asErr(err)); }
  const staff = isStaff();
  const facts: [string, Child][] = [
    ["Elephants", i.herd_size || "Not given"],
    ["Heading", i.heading || "Not given"],
    ["Village", i.village],
    ["Landmark", i.place || "—"],
    ["Reported", when(i.created_at)],
    ["Location", h("span", { class: "mono" }, `${i.lat.toFixed(4)}, ${i.lng.toFixed(4)}`)],
  ];
  if (i.casualties) facts.push(["People hurt", i.casualties]);
  if (i.crop_acres) facts.push(["Crops", `${i.crop_acres} acres`]);
  if (i.property_inr) facts.push(["Property loss", inr(i.property_inr)]);
  if (i.reporter) facts.push(["Reported by", [i.reporter.name, h("br"), h("span", { class: "mono small" }, i.reporter.phone), !i.reporter.phone_verified && [h("br"), h("span", { class: "tag" }, "Phone not verified")]]]);
  main.classList.add("wide");

  const note = h("textarea", { id: "act-note", maxlength: 500 });
  let form: HTMLFormElement | null = null;
  if (staff) {
    const f: HTMLFormElement = form = h("form", { class: "card", id: "act", novalidate: true },
      h("h2", null, "Staff action"),
      field("note", ["Note ", h("small", null, "(team sent, damage seen, advice given)")], note),
      h("div", { "data-errors": true }),
      h("div", { class: "row" },
        i.next.map((st) => h("button", { type: "button", class: `btn ${st === "false_report" ? "" : "primary"}`, "data-status": st }, VERBS[st])),
        h("button", { type: "button", class: "btn", "data-status": "" }, "Add note only")),
      i.open && h("div", { class: "row between split" },
        h("span", { class: "small muted" }, "Tell villages within 5 km."),
        h("button", { type: "button", class: "btn", id: "warn", on: { click: () => warn() } }, "Warn nearby villages")));
    $$("[data-status]", f).forEach((b) => (b.onclick = async () => {
      try {
        await api("PATCH", `/api/incidents/${i.id}`, { status: b.dataset.status || null, note: note.value });
        toast(b.dataset.status ? "Status updated" : "Note added");
        viewCase(String(i.id));
      } catch (err) { showErrors(f, asErr(err)); }
    }));
  }
  const warn = async () => {
    const near = await api<NearVillage[]>("GET", `/api/incidents/${i.id}/villages?km=5`);
    const herd = i.herd_size ? `About ${plural(i.herd_size, "elephant")}` : "Elephants";
    const where = `near ${i.village}${i.place ? ` (${i.place})` : ""}`;
    state.prefill = {
      level: "warning", incident_id: i.id, villages: near.map((v) => v.name),
      message: `${herd} reported ${where}${i.heading ? `, moving ${i.heading}` : ""}. Keep away from the fields and stay indoors after dark.`,
    };
    location.hash = "#/alerts";
  };

  fill(main,
    h("div", { class: "pagehead" },
      h("a", { class: "small", href: "#/cases" }, `← ${staff ? "Cases" : "My reports"}`),
      h("div", { class: "row between" }, h("h1", null, i.type_label), sevPill(i.severity, i.severity_label)),
      h("p", { class: "muted" }, h("span", { class: "mono" }, i.ref), ` · ${i.status_label}`, i.sample && [" · ", h("span", { class: "tag" }, "Sample")])),
    h("div", { class: "two-col" },
      h("div", { class: "col" },
        h("section", { class: "card flush" }, mapBlock({ incidents: [i], home: me().village, focus: i.id })),
        h("section", { class: "card" },
          h("dl", { class: "facts" }, facts.map(([k, v]) => h("div", null, h("dt", null, k), h("dd", null, v)))),
          i.description && h("p", { translate: "no" }, i.description)),
        i.attachments_hidden > 0 && h("p", { class: "small muted" }, `${plural(i.attachments_hidden, "photo or voice note", "photos or voice notes")}, seen only by the reporter and forest staff.`),
        (i.attachments.length > 0 || i.can_attach) && h("section", { class: "card", id: "case-media" },
          h("h2", null, "Photos and voice notes"),
          i.attachments.length ? h("div", { class: "thumbs" }, mediaTiles(i.attachments, false)) : h("p", { class: "small muted" }, "None yet."),
          i.can_attach && h("div", { class: "row" }, h("button", { type: "button", class: "btn small", id: "case-cam" }, icon("camera"), " Add photo"), h("span", { id: "case-voice" })))),
      h("div", { class: "col" },
        h("section", { class: "card" },
          h("h2", null, "What has happened"),
          h("ol", { class: "timeline" }, i.events.map((e, k) => h("li", null,
            h("span", { class: "dot" }),
            h("div", null,
              h("b", null, k && e.status === i.events[k - 1].status ? "Update" : e.status_label),
              " ",
              h("span", { class: "small muted" }, when(e.at), e.by ? ` · ${e.by}` : ""),
              e.note && h("p", { translate: "no" }, e.note)))))),
        form)));

  const mediaBox = $maybe("#case-media", main);
  if (mediaBox) {
    hydrateMedia(mediaBox);
    mediaBox.addEventListener("click", (e) => {
      const view = (e.target as Element).closest("[data-view]");
      const img = view && view.querySelector("img");
      if (img?.src) lightbox(img.src);
    });
    const upload = async (item: MediaItem | null) => {
      if (!item) return;
      try { await api("POST", `/api/incidents/${i.id}/attachments`, { kind: item.kind, data: item.data }); toast(item.kind === "photo" ? "Photo added" : "Voice note added"); viewCase(String(i.id)); }
      catch (err) { toast(asErr(err).message); }
    };
    const cam = $maybe("#case-cam", main);
    if (cam) {
      cam.onclick = async () => { try { upload(await takePhoto()); } catch (err) { toast(asErr(err).message); } };
      const rec = voiceRecorder($maybe("#case-voice", main) as HTMLElement, upload);
      window.addEventListener("hashchange", () => rec.stop(), { once: true });
    }
  }
}
