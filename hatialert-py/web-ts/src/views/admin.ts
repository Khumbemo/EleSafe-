/* Admin for forest officers: people, villages, text messages, system. */
import { api } from "../api";
import { $, fill, h } from "../dom";
import { icon } from "../icons";
import { me, state } from "../state";
import type { AdminStatus, AdminUser, AdminVillage, Meta, MessageStatus, Outbox, PinReset, Role, VillageImport } from "../types";
import { shell, showErrors, toast } from "../ui";
import { ago, asErr, plural, roleName } from "../util";
import { copy } from "./dashboard";

const ROLES: Role[] = ["villager", "guard", "officer"];
const roleOpts = (cur: string) => ROLES.map((r) => h("option", { value: r, selected: r === cur }, roleName[r]));

export async function viewAdmin(tab = "people"): Promise<void> {
  if (me().role !== "officer") { location.hash = "#/home"; return; }
  const tabs: [string, string][] = [["people", "People"], ["villages", "Villages"], ["messages", "Messages"], ["system", "System"]];
  const body = h("div", { id: "admin-body", class: "stack" }, h("p", { class: "muted" }, "Loading…"));
  shell("more",
    h("div", { class: "pagehead" }, h("a", { class: "small", href: "#/more" }, "← More"), h("h1", null, "Admin")),
    h("div", { class: "seg", role: "group", "aria-label": "Admin sections" }, tabs.map(([k, l]) => h("a", { class: "segl", href: `#/admin/${k}`, "aria-current": k === tab && "page" }, l))),
    body);
  try {
    if (tab === "villages") await adminVillages(body);
    else if (tab === "messages") await adminMessages(body);
    else if (tab === "system") await adminSystem(body);
    else await adminPeople(body);
  } catch (e) {
    const err = asErr(e);
    fill(body, h("div", { class: "card" }, h("p", null, err.status === 404 ? "This needs the Python engine, which isn't running in this browser." : err.message)));
  }
}

async function adminPeople(body: HTMLElement): Promise<void> {
  const q = h("input", { type: "search", id: "pp-q", class: "grow", placeholder: "Search name or phone", "aria-label": "Search people" });
  const role = h("select", { id: "pp-role", class: "narrow", "aria-label": "Role" }, h("option", { value: "" }, "Everyone"), roleOpts(""));
  const list = h("section", { class: "card flush divide", id: "pp-list" });
  const temp = h("div", { id: "pp-temp" });
  fill(body, h("div", { class: "row" }, q, role), list, temp);
  const tag = (text: string) => h("span", { class: "tag" }, text);
  const load = async () => {
    const people = await api<AdminUser[]>("GET", `/api/users?q=${encodeURIComponent(q.value.trim())}&role=${role.value}`);
    fill(list, people.length ? people.map((p) => h("div", { class: "item", "data-uid": p.id },
      h("h3", { translate: "no" }, p.name), tag(roleName[p.role]),
      h("div", { class: "meta" },
        h("span", { class: "mono" }, p.phone), h("span", { translate: "no" }, p.village),
        !p.active && tag("Switched off"), !p.phone_verified && tag("Phone not verified"),
        p.failed_24h > 0 && tag(`${plural(p.failed_24h, "wrong PIN")} today`), p.last_seen ? h("span", null, `Last seen ${ago(p.last_seen)}`) : null),
      h("div", { class: "full row pp-actions" },
        h("select", { "data-role": true, "aria-label": "Role" }, roleOpts(p.role)), h("button", { type: "button", class: "btn small", "data-act": "role" }, "Save role"),
        h("button", { type: "button", class: "btn small", "data-act": "reset" }, "Reset PIN"),
        p.failed_24h > 0 && h("button", { type: "button", class: "btn small", "data-act": "unlock" }, "Unlock"),
        h("button", { type: "button", class: `btn small ${p.active ? "danger" : ""}`, "data-act": "active", "data-on": p.active ? 0 : 1 }, p.active ? "Switch off" : "Switch on"))))
      : h("div", { class: "empty" }, h("b", null, "No one found")));
  };
  let t: ReturnType<typeof setTimeout> | undefined;
  q.oninput = () => { clearTimeout(t); t = setTimeout(() => load().catch((e) => toast(asErr(e).message)), 250); };
  role.onchange = () => load().catch((e) => toast(asErr(e).message));
  list.onclick = async (e) => {
    const b = (e.target as Element).closest<HTMLElement>("[data-act]");
    if (!b) return;
    const row = b.closest("[data-uid]") as HTMLElement, uid = row.dataset.uid;
    try {
      if (b.dataset.act === "role") { await api("PATCH", `/api/users/${uid}`, { role: $<HTMLSelectElement>("[data-role]", row).value }); toast("Role saved"); }
      if (b.dataset.act === "active") { await api("PATCH", `/api/users/${uid}`, { active: b.dataset.on === "1" }); toast(b.dataset.on === "1" ? "Account switched on" : "Account switched off"); }
      if (b.dataset.act === "unlock") { await api("POST", `/api/users/${uid}/unlock`); toast("Unlocked"); }
      if (b.dataset.act === "reset") {
        if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Tap again to reset"; return; }
        const r = await api<PinReset>("POST", `/api/users/${uid}/reset-pin`);
        fill(temp, h("section", { class: "card warning" },
          h("span", { class: "label" }, "Temporary PIN for ", h("span", { translate: "no" }, r.user.name)),
          h("p", { class: "bigpin mono" }, r.temp_pin),
          h("p", { class: "small" }, "Tell them in person or by phone call. They must choose a new PIN when they sign in. It isn't shown again.")));
        temp.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      await load();
    } catch (err) { toast(asErr(err).message); }
  };
  await load();
}

async function adminVillages(body: HTMLElement): Promise<void> {
  const vs = await api<AdminVillage[]>("GET", "/api/villages");
  const unverified = vs.filter((v) => v.active && !v.verified).length;
  const refreshMeta = async () => { state.meta = await api<Meta>("GET", "/api/meta"); };
  const text = (name: string, attrs: Record<string, string | number> = {}) => h("input", { name, type: "text", ...attrs });
  const coord = (name: string, label: string, attrs: Record<string, string | number>) => h("label", { class: "field", "data-field": name }, h("span", null, label), text(name, { inputmode: "decimal", ...attrs }));
  const check = (name: string, label: string, on: boolean) => h("label", { class: "switch" }, h("input", { type: "checkbox", name, checked: on }), h("span", null, label));
  const sourceField = (attrs: Record<string, string | number>) => h("label", { class: "field", "data-field": "source" }, h("span", null, "Where the position comes from"), text("source", { maxlength: 120, ...attrs }));
  const saveRow = (label: string, cls = "btn primary") => [h("div", { "data-errors": true }), h("div", null, h("button", { class: cls, type: "submit" }, label))];

  const csv = h("textarea", { id: "v-csv", class: "csv", placeholder: "name,lat,lng,source\nLotsu,26.2500,94.1000,Census 2011" });
  const result = h("p", { id: "v-result", class: "small" });
  const file = h("input", { type: "file", id: "v-file", accept: ".csv,text/csv,text/plain", "aria-label": "CSV file" });
  const add = h("form", { class: "card", id: "v-add", novalidate: true },
    h("h2", null, "Add a village"),
    h("label", { class: "field", "data-field": "name" }, h("span", null, "Name"), text("name", { maxlength: 60 })),
    h("div", { class: "grid2" }, coord("lat", "Latitude", { placeholder: "26.0972" }), coord("lng", "Longitude", { placeholder: "94.2582" })),
    sourceField({}),
    check("verified", "Position checked", false),
    saveRow("Add village"));
  const imp = h("form", { class: "card", id: "v-import", novalidate: true },
    h("h2", null, "Import a list"),
    h("p", { class: "small muted" }, "Paste CSV with a header row ", h("span", { class: "mono" }, "name,lat,lng,source"), ", or choose a file. Names already on the list get the new position; all imported positions count as checked."),
    file,
    h("label", { class: "field", "data-field": "csv" }, h("span", null, "CSV"), csv),
    saveRow("Import"),
    result);
  fill(body,
    unverified > 0 && h("div", { class: "notice" }, h("span", null, `${plural(unverified, "village position is", "village positions are")} not checked yet. Distances and alert areas depend on them.`)),
    h("section", { class: "card flush divide" }, vs.map((v) => {
      const f = h("form", { class: "stack vform", novalidate: true },
        h("div", { class: "grid2" }, coord("lat", "Latitude", { value: v.lat }), coord("lng", "Longitude", { value: v.lng })),
        sourceField({ value: v.source, placeholder: "e.g. Survey of India sheet 83G/1, GPS by guard" }),
        check("verified", "Position checked", v.verified),
        check("active", "Show in lists", !!v.active),
        saveRow("Save", "btn primary small"));
      f.onsubmit = async (e) => {
        e.preventDefault();
        const d = new FormData(f);
        try {
          await api("PATCH", `/api/villages/${v.id}`, { lat: d.get("lat"), lng: d.get("lng"), source: d.get("source"), verified: !!d.get("verified"), active: !!d.get("active") });
          await refreshMeta(); toast("Village saved"); adminVillages(body);
        } catch (err) { showErrors(f, asErr(err)); }
      };
      return h("div", { class: "item", "data-vid": v.id },
        h("h3", { translate: "no" }, v.name), v.verified ? h("span", { class: "tag me" }, "Checked") : h("span", { class: "tag" }, "Not checked"),
        h("div", { class: "meta" },
          h("span", { class: "mono" }, `${v.lat.toFixed(5)}, ${v.lng.toFixed(5)}`),
          h("span", { translate: "no" }, v.source || "—"),
          h("span", null, plural(v.people, "person", "people")),
          h("span", null, plural(v.incidents, "incident")),
          !v.active && h("span", { class: "tag" }, "Hidden")),
        h("details", { class: "full" }, h("summary", null, "Edit"), f));
    })),
    add,
    imp);
  add.onsubmit = async (e) => {
    e.preventDefault();
    const d = new FormData(add);
    try {
      await api("POST", "/api/villages", { name: d.get("name"), lat: d.get("lat"), lng: d.get("lng"), source: d.get("source"), verified: !!d.get("verified") });
      await refreshMeta(); toast("Village added"); adminVillages(body);
    } catch (err) { showErrors(add, asErr(err)); }
  };
  file.onchange = async () => { const fl = file.files && file.files[0]; if (fl) csv.value = await fl.text(); };
  imp.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api<VillageImport>("POST", "/api/villages/import", { csv: csv.value });
      await refreshMeta();
      toast(`Imported: ${r.added} added, ${r.updated} updated`);
      await adminVillages(body);
      $("#v-result", body).textContent = r.skipped ? `Skipped ${plural(r.skipped, "line")} with a problem: ${r.skipped_lines.join(", ")}` : "";
    } catch (err) { showErrors(imp, asErr(err)); }
  };
}

const MESSAGE_LABEL: Record<MessageStatus, string> = { queued: "Waiting", sent: "Sent", failed: "Failed", manual: "To send by hand" };
const statusLabel = (k: string) => MESSAGE_LABEL[k as MessageStatus] || k;

async function adminMessages(body: HTMLElement): Promise<void> {
  const box = await api<Outbox>("GET", "/api/outbox");
  fill(body,
    h("div", { class: "notice" }, h("span", null, box.mode === "manual" ? "Text messages aren't connected to an SMS service yet. Send these from a phone, then mark them sent." : "Alerts are texted automatically. Failed ones can be tried again.")),
    box.batches.length ? box.batches.map((b) => h("section", { class: "card", "data-batch": b.alert_id },
      h("div", { class: "row between" },
        h("h3", null, `${b.level_label} · `, h("span", { translate: "no" }, b.villages.join(", "))),
        h("span", { class: "small muted" }, ago(b.sent_at))),
      h("p", { class: "mono small msgtext", translate: "no" }, b.text),
      h("div", { class: "chips" }, Object.entries(b.counts).map(([k, n]) => h("span", { class: "tag" }, `${statusLabel(k)}: ${n}`))),
      h("div", { class: "row" },
        h("button", { type: "button", class: "btn small", "data-copy-text": true }, icon("copy"), " Copy message"),
        h("button", { type: "button", class: "btn small", "data-copy-nums": true }, icon("copy"), " Copy numbers"),
        b.counts.manual ? h("button", { type: "button", class: "btn small primary", "data-mark": "sent" }, "Mark all sent") : null,
        b.counts.failed && box.mode !== "manual" ? h("button", { type: "button", class: "btn small", "data-mark": "queued" }, "Try failed again") : null),
      h("details", null,
        h("summary", null, plural(b.recipients.length, "person", "people")),
        h("ul", { class: "plain stack small" }, b.recipients.map((r) => h("li", { class: "row between" },
          h("span", { translate: "no" }, `${r.name || "—"} · ${r.village || ""}`),
          h("span", { class: "mono" }, r.phone),
          h("span", { class: "tag" }, statusLabel(r.status)))))))) : h("div", { class: "empty" }, h("b", null, "No alert messages yet"), h("span", null, "Each alert lists the people in those villages here.")));
  body.onclick = async (e) => {
    const t = e.target as Element;
    const card = t.closest<HTMLElement>("[data-batch]");
    if (!card) return;
    const b = box.batches.find((x) => String(x.alert_id) === card.dataset.batch);
    if (!b) return;
    if (t.closest("[data-copy-text]")) copy(b.text);
    if (t.closest("[data-copy-nums]")) copy(b.recipients.map((r) => "+91" + r.phone).join(", "));
    const m = t.closest<HTMLElement>("[data-mark]");
    if (m) {
      const want = m.dataset.mark, from = want === "sent" ? "manual" : "failed";
      try { await api("POST", "/api/outbox/mark", { ids: b.recipients.filter((r) => r.status === from).map((r) => r.id), status: want }); toast(want === "sent" ? "Marked sent" : "Trying again"); adminMessages(body); }
      catch (err) { toast(asErr(err).message); }
    }
  };
}

async function adminSystem(body: HTMLElement): Promise<void> {
  const st = await api<AdminStatus>("GET", "/api/admin/status");
  const mb = (n: number) => (n / 1e6).toFixed(1) + " MB";
  const bk = st.system && st.system.backups;
  const mono = (text: string) => h("span", { class: "mono" }, text);
  const tags = Object.entries(st.outbox).map(([k, n]) => h("span", { class: "tag" }, `${k}: ${n}`));
  fill(body,
    h("section", { class: "card" },
      h("h2", null, "Text messages"),
      h("p", null, st.sms.enabled ? `Connected (${st.sms.mode}${st.sms.host ? `, ${st.sms.host}` : ""}).` : "Not connected. Alerts are listed under Messages for staff to send by hand, and sign-up codes are off."),
      h("div", { class: "chips" }, tags.length ? tags : h("span", { class: "small muted" }, "No messages yet."))),
    h("section", { class: "card" },
      h("h2", null, "Backups"),
      bk && bk.dir
        ? [
          h("p", null, `Every ${bk.every_hours} h to `, mono(bk.dir), `, keeping ${bk.keep}.`),
          h("p", { class: "small muted" },
            bk.last_at ? [`Last backup ${ago(bk.last_at)}: `, mono(bk.last_path || "")] : "First backup is running.",
            bk.error ? ` · Last error: ${bk.error}` : ""),
        ]
        : [
          h("p", null, "Automatic backups are off."),
          h("p", { class: "small muted" }, "Start the server with ", mono("--backup-dir /path/to/backups"), ", or run ", mono("python -m hatialert backup"), " on a schedule.", window.HATI_TRANSPORT ? " In this preview, data stays in this browser only." : ""),
        ]),
    h("section", { class: "card" },
      h("h2", null, "Storage"),
      h("dl", { class: "facts" },
        h("div", null, h("dt", null, "Database"), h("dd", null, mb(st.storage.db_bytes))),
        h("div", null, h("dt", null, "Photos and voice"), h("dd", null, mb(st.storage.media_bytes))),
        h("div", null, h("dt", null, "People"), h("dd", null, st.storage.users)),
        h("div", null, h("dt", null, "Incidents"), h("dd", null, st.storage.incidents)))),
    h("section", { class: "card" },
      h("h2", null, "Recent admin actions"),
      st.audit.length
        ? h("ul", { class: "plain stack small" }, st.audit.map((a) => h("li", null,
          h("b", null, a.action.replace(/_/g, " ")), " ",
          h("span", { class: "muted" }, ago(a.at), a.by ? ` · ${a.by}` : ""),
          h("br"),
          h("span", { translate: "no" }, a.detail))))
        : h("p", { class: "small muted" }, "Nothing yet.")));
}

