/* Reporting elephants. Only the type is required; everything else helps. */
import { api } from "../api";
import { $$, fill, h } from "../dom";
import { isNag } from "../i18n/translate";
import { icon } from "../icons";
import { lightbox, type MediaItem, mediaTiles, takePhoto, voiceRecorder } from "../media";
import { newClientId, queue } from "../offline";
import { me, state } from "../state";
import type { Incident, IncidentType, SeverityResult } from "../types";
import { sevPill, shell, showErrors, toast } from "../ui";
import { ApiErr, asErr, plural } from "../util";
import { field } from "./auth";

const DAMAGE_TYPES: string[] = ["crop_raid", "property_damage", "injury", "death"];

interface ReportDraft {
  media: MediaItem[];
  type: IncidentType | "";
  offset_dir: string;
  heading: string;
  lat: number | null;
  lng: number | null;
  client_id?: string;
}

export function viewReport(mode: string | undefined): void {
  const m = state.meta, u = me();
  const f: ReportDraft = { media: [], type: mode === "camera" ? "sighting" : "", offset_dir: "", heading: "", lat: null, lng: null };

  const herd = h("input", { id: "rep-herd", type: "number", min: 0, max: 200, value: 1, "aria-label": "Number of elephants" });
  const village = h("select", { id: "rep-village" }, m.villages.map((v) => h("option", { selected: v.name === u.village }, v.name)));
  const km = h("select", { id: "rep-km", "aria-label": "Distance from village", class: "grow" },
    h("option", { value: 0 }, "At the village"),
    [0.5, 1, 2, 3, 5, 8].map((k) => h("option", { value: k }, `${k} km away`)));
  const rose = h("div", { class: "rose", id: "rep-rose", "aria-label": "Direction from the village" },
    ["NW", "N", "NE", "W", "", "E", "SW", "S", "SE"].map((d) => d
      ? h("button", { type: "button", "data-odir": d, "aria-pressed": "false" }, d)
      : h("span", { class: "centre", "aria-hidden": "true" }, "village")));
  const gps = h("button", { type: "button", class: "btn small", id: "rep-gps" }, icon("pin"), " Use my GPS location instead");
  const gpsNote = h("span", { id: "rep-gps-note", class: "small muted" });
  const place = h("input", { id: "rep-place", type: "text", maxlength: 120, placeholder: "e.g. paddy fields below the church" });
  const cas = h("input", { id: "rep-cas", type: "number", min: 0, max: 50, value: 0 });
  const acres = h("input", { id: "rep-acres", type: "number", min: 0, step: 0.1, placeholder: 0 });
  const inrBox = h("input", { id: "rep-inr", type: "number", min: 0, step: 500, placeholder: 0 });
  const damage = h("section", { class: "card", id: "rep-damage", hidden: true },
    h("h2", null, "Damage and injuries"),
    h("div", { class: "grid2" },
      field("casualties", "People hurt or killed", cas),
      field("crop_acres", "Crops damaged (acres)", acres),
      field("property_inr", "Property loss (₹, estimate)", inrBox)));
  const desc = h("textarea", { id: "rep-desc", maxlength: 500, placeholder: "Calves with the herd, which fields, who is at risk…" });
  const sev = h("span", { id: "rep-sev" }, h("span", { class: "muted small" }, "Choose what happened"));
  const send = h("button", { class: "btn primary", type: "submit", id: "rep-send" }, "Send report");
  const cam = h("button", { type: "button", class: "btn", id: "rep-cam" }, icon("camera"), " Take photo");
  const gallery = h("button", { type: "button", class: "btn", id: "rep-gallery" }, icon("image"), " From gallery");
  const voice = h("span", { id: "rep-voice" });
  const mediaBox = h("div", { class: "thumbs", id: "rep-media" });

  const form = h("form", { id: "rep", class: "stack", novalidate: true },
    h("section", { class: "card", "data-field": "type" }, h("h2", null, "What's happening?"),
      h("div", { class: "types" }, m.types.map((t) => h("button", { type: "button", class: "type", "data-type": t.key, "aria-pressed": "false" },
        h("b", null, t.label), h("small", { translate: "no" }, isNag() ? t.label : t.local))))),
    h("section", { class: "card", "data-field": "attachments" }, h("h2", null, "Photo and voice note"),
      h("p", { class: "small muted" }, "Optional. Take photos only from a safe distance. Never go closer to a herd for a picture."),
      h("div", { class: "row" }, cam, gallery, voice),
      mediaBox),
    h("section", { class: "card", "data-field": "herd_size" }, h("h2", null, "How many elephants?"),
      h("div", { class: "row" },
        h("div", { class: "stepper" },
          h("button", { type: "button", "data-step": -1, "aria-label": "One fewer" }, "−"),
          herd,
          h("button", { type: "button", "data-step": 1, "aria-label": "One more" }, "+")),
        h("div", { class: "chips" }, [1, 3, 5, 10, 20].map((n) => h("button", { type: "button", class: "chip", "data-herd": n }, n, n === 20 ? "+" : "")))),
      h("small", { class: "muted" }, "A best guess is fine. Count calves too.")),
    h("section", { class: "card" }, h("h2", null, "Where?"),
      field("village", "Nearest village", village),
      h("div", { class: "field", "data-field": "offset_dir" }, h("span", null, "How far from the village, and which way?"),
        h("div", { class: "row" }, km),
        rose),
      h("div", { class: "row" }, gps, gpsNote),
      field(null, ["Landmark ", h("small", null, "(optional)")], place)),
    h("section", { class: "card" }, h("h2", null, "Which way are they moving?"),
      h("div", { class: "chips", id: "rep-heading" }, ["", ...m.directions].map((d) => h("button", { type: "button", class: "chip", "data-heading": d, "aria-pressed": d === "" ? "true" : "false" }, d || "Not moving / not sure")))),
    damage,
    h("section", { class: "card" }, field("description", ["Anything else? ", h("small", null, "(optional)")], desc)),
    h("div", { "data-errors": true }),
    h("div", { class: "preview" }, h("div", { class: "row" }, h("span", { class: "small muted" }, "Severity"), sev), send));

  const main = shell("report",
    h("div", { class: "pagehead" }, h("h1", null, "Report elephants"), h("p", { class: "muted" }, "Only \"what happened\" is required. Send it now and add detail if you can.")),
    form);

  let sevTimer: ReturnType<typeof setTimeout> | undefined;
  const sync = () => {
    $$("[data-type]", form).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.type === f.type)));
    $$("[data-odir]", form).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.odir === f.offset_dir)));
    $$("[data-heading]", form).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.heading === f.heading)));
    damage.hidden = !DAMAGE_TYPES.includes(f.type);
    rose.hidden = !(+km.value) || f.lat != null;
    clearTimeout(sevTimer);
    if (!f.type) return;
    sevTimer = setTimeout(async () => {
      try {
        const r = await api<SeverityResult>("POST", "/api/severity", { type: f.type, herd_size: herd.value || 0, casualties: cas.value || 0 });
        fill(sev, sevPill(r.severity, r.label));
      } catch { /* field errors show on submit */ }
    }, 120);
  };
  form.addEventListener("click", (e) => {
    const b = (e.target as Element).closest("button");
    if (!b) return;
    if (b.dataset.type) f.type = b.dataset.type as IncidentType;
    else if (b.dataset.step) herd.value = String(Math.max(0, Math.min(200, (+herd.value || 0) + +b.dataset.step)));
    else if (b.dataset.herd) herd.value = b.dataset.herd;
    else if (b.dataset.odir) f.offset_dir = b.dataset.odir;
    else if (b.dataset.heading !== undefined) f.heading = b.dataset.heading;
    else return;
    sync();
  });
  form.addEventListener("input", sync);
  const rule = m.media;
  const count = (kind: string) => f.media.filter((x) => x.kind === kind).length;
  const renderMedia = () => {
    fill(mediaBox, mediaTiles(f.media, true));
    const full = count("photo") >= rule.photo.max_count;
    cam.disabled = full; gallery.disabled = full;
    voice.hidden = count("voice") >= rule.voice.max_count;
  };
  const addPhoto = async (opts?: { gallery?: boolean }) => {
    try { const p = await takePhoto(opts); if (p) { f.media.push(p); renderMedia(); toast("Photo added"); } }
    catch (err) { showErrors(form, asErr(err)); }
  };
  cam.onclick = () => addPhoto();
  gallery.onclick = () => addPhoto({ gallery: true });
  const recorder = voiceRecorder(voice, (v) => { f.media.push(v); renderMedia(); toast("Voice note added"); });
  mediaBox.onclick = (e) => {
    const t = e.target as Element;
    const rm = t.closest<HTMLElement>("[data-remove]"), view = t.closest<HTMLElement>("[data-view]");
    if (rm) { f.media.splice(+(rm.dataset.remove as string), 1); renderMedia(); }
    else if (view) lightbox(f.media[+(view.dataset.view as string)].url);
  };
  window.addEventListener("hashchange", () => recorder.stop(), { once: true });
  gps.onclick = () => {
    const label = gps.lastChild as Text;
    if (f.lat != null) { f.lat = f.lng = null; gpsNote.textContent = ""; label.textContent = " Use my GPS location instead"; return sync(); }
    if (!navigator.geolocation) { gpsNote.textContent = "This device can't share its location."; return; }
    gpsNote.textContent = "Finding you…";
    navigator.geolocation.getCurrentPosition(
      (p) => { const lat = f.lat = +p.coords.latitude.toFixed(5), lng = f.lng = +p.coords.longitude.toFixed(5); gpsNote.textContent = `Using ${lat}, ${lng} (±${Math.round(p.coords.accuracy)} m)`; label.textContent = " Use village instead"; sync(); },
      () => { gpsNote.textContent = "Location isn't available here. Use the village and direction instead."; },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!f.type) return showErrors(form, new ApiErr(400, "Choose what happened.", "type"));
    const body: Record<string, unknown> = {
      type: f.type, herd_size: herd.value, village: village.value,
      offset_km: km.value, offset_dir: f.offset_dir, heading: f.heading,
      casualties: cas.value, crop_acres: acres.value, property_inr: inrBox.value,
      place: place.value, description: desc.value,
    };
    if (!+(body.offset_km as string)) body.offset_dir = "";
    if (f.lat != null) Object.assign(body, { lat: f.lat, lng: f.lng });
    if (!DAMAGE_TYPES.includes(f.type)) Object.assign(body, { casualties: 0, crop_acres: 0, property_inr: 0 });
    if (f.media.length) body.attachments = f.media.map(({ kind, data }) => ({ kind, data }));
    const clientId = body.client_id = f.client_id || (f.client_id = newClientId());
    send.disabled = true;
    send.textContent = f.media.length ? "Sending…" : "Send report";
    try {
      const inc = await api<Incident>("POST", "/api/incidents", body);
      const photos = inc.attachments.filter((a) => a.kind === "photo").length, notes = inc.attachments.filter((a) => a.kind === "voice").length;
      fill(main, h("section", { class: "card" },
        h("span", { class: "label" }, "Report sent"),
        h("h1", null, "Thank you. Your report number is ", h("span", { class: "mono" }, inc.ref)),
        h("div", { class: "row" },
          sevPill(inc.severity, inc.severity_label + " severity"),
          h("span", { class: "muted" },
            h("span", null, inc.type_label), " · ", h("span", { translate: "no" }, inc.village),
            inc.attachments.length > 0 && [" · ", h("span", null, `${plural(photos, "photo")}, ${plural(notes, "voice note")}`)])),
        h("p", null, "A forest guard will check it. Keep this number for any compensation claim."),
        h("p", { class: "muted" }, "Stay well away from the herd and warn your neighbours."),
        h("div", { class: "row" }, h("a", { class: "btn primary", href: `#/case/${inc.id}` }, "View report"), h("a", { class: "btn", href: "#/home" }, "Back to home"))));
    } catch (e) {
      const err = asErr(e);
      if (err.status === 0 && (await queue.add({ client_id: clientId, user_id: me().id, body, queued_at: Date.now() }))) {
        fill(main, h("section", { class: "card" },
          h("span", { class: "label" }, "Saved on this phone"),
          h("h1", null, "No connection right now. Your report is saved."),
          h("p", null, "It sends by itself when the phone is back online. You'll get a report number then."),
          h("p", { class: "muted" }, "If people are in danger, phone the forest control room or 112 now."),
          h("div", { class: "row" }, h("a", { class: "btn primary", href: "#/home" }, "Back to home"), h("a", { class: "btn", href: "#/guide" }, "Emergency numbers"))));
        return;
      }
      showErrors(form, err); send.disabled = false; send.textContent = "Send report";
    }
  };
  sync();
  renderMedia();
  if (mode === "camera") addPhoto();
}
