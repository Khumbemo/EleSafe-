/* Alerts from forest staff, and the form staff send them with. */
import { api } from "../api";
import { $, $$, fill, h } from "../dom";
import { iconSvg } from "../icons";
import { isStaff, me, state } from "../state";
import type { Alert, AlertLevel, SentAlert } from "../types";
import { failure, loading, showErrors, toast } from "../ui";
import { ago, asErr, plural } from "../util";

export async function viewAlerts(): Promise<void> {
  const main = loading("alerts");
  let list: Alert[];
  try { list = await api<Alert[]>("GET", "/api/alerts"); } catch (err) { return failure(main, asErr(err)); }
  const pre = state.prefill;
  state.prefill = null;
  const m = state.meta, staff = isStaff(), u = me();
  let compose: HTMLDetailsElement | null = null;
  if (staff) {
    const msg = h("textarea", { id: "compose-msg", maxlength: 400, placeholder: "What is happening, where, and what people should do" }, pre?.message || "");
    const counter = h("small", { class: "tnum", id: "compose-count" });
    const f = h("form", { id: "compose", class: "stack", novalidate: true },
      h("div", { class: "seg", role: "group", "aria-label": "Alert type", "data-field": "level" },
        m.alert_levels.map((l) => h("button", { type: "button", "data-level": l.key, "aria-pressed": String((pre?.level || "warning") === l.key) }, l.label))),
      h("div", { class: "field", "data-field": "villages" }, h("span", null, "Villages"),
        h("div", { class: "chips" }, m.villages.map((v) => h("button", { type: "button", class: "chip", "data-v": v.name, "aria-pressed": String(!!pre?.villages.includes(v.name)) }, v.name)))),
      h("label", { class: "field", "data-field": "message" }, h("span", null, "Message"), msg, counter),
      h("div", { "data-errors": true }),
      h("div", null, h("button", { class: "btn primary", type: "submit" }, "Send alert")));
    compose = h("details", { class: "card compose", id: "compose-wrap", open: !!pre },
      h("summary", null,
        h("span", { class: "ic-badge", "aria-hidden": "true" }, iconSvg("alerts")),
        h("span", { class: "grow" }, h("b", null, "Send an alert"), h("br"), h("span", { class: "small muted" }, "to chosen villages")),
        h("span", { class: "chev", "aria-hidden": "true" }, "›")),
      f);
    const count = () => { counter.textContent = `${msg.value.length} / 400`; };
    count();
    f.addEventListener("input", count);
    f.addEventListener("click", (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>("button[type=button]");
      if (!b) return;
      if (b.dataset.level) $$("[data-level]", f).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      if (b.dataset.v) b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true"));
    });
    f.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const sent = await api<SentAlert>("POST", "/api/alerts", {
          level: $("[data-level][aria-pressed=true]", f).dataset.level as AlertLevel,
          villages: $$("[data-v][aria-pressed=true]", f).map((b) => b.dataset.v),
          message: msg.value, incident_id: pre?.incident_id ?? null,
        });
        const n = sent.sms ? sent.sms.recipients : 0;
        toast(!n ? "Alert sent" : sent.sms.mode === "manual" ? `Alert sent. ${plural(n, "person", "people")} to text by hand (Admin › Messages)` : `Alert sent. Texting ${plural(n, "person", "people")}`);
        viewAlerts();
      } catch (err) { showErrors(f, asErr(err)); }
    };
  }
  fill(main,
    h("div", { class: "pagehead" }, h("h1", null, "Alerts"), h("p", { class: "muted" }, `Warnings from forest staff. Alerts for ${u.village} are marked.`)),
    compose,
    h("section", { class: "card flush divide" }, list.length
      ? list.map((a) => h("article", { class: `item stripe ${a.level === "warning" ? "critical" : a.level === "all_clear" ? "low" : ""}` },
        h("h3", null, a.level_label, a.active && [" ", h("span", { class: "sev sev-critical" }, "Active")]),
        h("span", { class: "small muted" }, ago(a.sent_at)),
        h("p", { class: "full", translate: "no" }, a.message),
        h("div", { class: "meta" },
          h("span", { class: "chips" }, a.villages.map((v) => h("span", { class: `tag ${v === u.village ? "me" : ""}` }, v))),
          a.by && h("span", null, a.by),
          a.incident_id ? h("a", { href: `#/case/${a.incident_id}` }, "View case") : null)))
      : h("div", { class: "empty" }, h("b", null, "No alerts yet"), h("span", null, "Warnings for your village will show here."))));
}
