/* Shared pieces of the interface: the page shell, toasts, form errors and
   incident rows. */
import { setOffline } from "./api";
import { $, $$, type Child, fill, h } from "./dom";
import { icon, type IconName, mark } from "./icons";
import { isStaff, me, nav, state } from "./state";
import type { Incident } from "./types";
import { type ApiErr, ago, plural, roleName } from "./util";

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string): void {
  let el = document.querySelector<HTMLElement>(".toast");
  if (!el) { el = h("div", { class: "toast", role: "status" }); document.body.append(el); }
  const box = el;
  box.textContent = msg;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, 2600);
}

/** Put an error under the field it names (data-field), or in [data-errors]. */
export function showErrors(form: Element, err: Pick<ApiErr, "message" | "field">): void {
  $$(".err", form).forEach((e) => e.remove());
  $$(".field.bad", form).forEach((e) => e.classList.remove("bad"));
  const target = err.field && form.querySelector(`[data-field="${err.field}"]`);
  const p = h("p", { class: "err", role: "alert" }, err.message);
  if (target) { target.classList.add("bad"); target.append(p); }
  else form.querySelector("[data-errors]")?.append(p);
}

export const sevPill = (key: string, label: string): HTMLSpanElement => h("span", { class: `sev sev-${key}` }, label);

/** Signed-in page: top bar, tabs and <main> holding `content`. */
export function shell(active: string, ...content: Child[]): HTMLElement {
  const u = me();
  const tabs: [IconName, string, string][] = [
    ["home", "Home", "#/home"],
    ["report", "Report", "#/report"],
    ["cases", isStaff() ? "Cases" : "My reports", "#/cases"],
    ["alerts", "Alerts", "#/alerts"],
    ["more", "More", "#/more"],
  ];
  const main = h("main", { id: "main", tabindex: -1 }, content);
  fill($("#app"),
    h("div", { class: "shell" },
      h("header", { class: "topbar" },
        h("a", { class: "brand", href: "#/home" }, mark(), h("b", null, "HatiAlert")),
        h("div", { class: "who small" },
          h("span", { class: "muted" }, roleName[u.role]),
          h("span", { class: "tag me" }, icon("pin"), u.village))),
      h("div", { id: "offline-bar", class: "offline-bar", role: "status", hidden: true }),
      h("nav", { class: "tabs", "aria-label": "Main" },
        tabs.map(([k, label, href]) => h("a", { href, class: k === "report" ? "report" : "", "aria-current": k === active && "page" }, icon(k), h("span", null, label)))),
      main));
  setOffline(state.offlineSince);
  return main;
}

export const loading = (active: string): HTMLElement => shell(active,
  h("div", { class: "skeleton", "aria-busy": "true", "aria-label": "Loading…" },
    h("span", { class: "skel line short" }), h("span", { class: "skel line title" }), h("span", { class: "skel block" }), h("span", { class: "skel block tall" })));

/** A screen's data didn't load: say why and offer a retry. */
export function failure(main: HTMLElement, err: { message: string }): void {
  fill(main, h("div", { class: "card" },
    h("h2", null, "That didn't load"),
    h("p", { class: "muted" }, err.message),
    h("div", null, h("button", { class: "btn", "data-retry": true, on: { click: () => nav.router() } }, "Try again"))));
}

/** Page for screens before sign-in. */
export function authShell(...content: Child[]): HTMLElement {
  const main = h("main", { id: "main", tabindex: -1 }, content);
  fill($("#app"), h("div", { class: "shell" }, main));
  return main;
}

/** One incident in a list. `where` is plain text, e.g. "1.5 km SW of Wokha
    Town"; it defaults to the village. */
export function incidentItem(i: Incident, where = ""): HTMLAnchorElement {
  const sub: Child[] = [];
  if (i.herd_size) sub.push(h("span", null, plural(i.herd_size, "elephant")), h("span", { "aria-hidden": "true" }, " · "));
  sub.push(h("span", null, where || i.village));
  return h("a", { class: `item inc stripe ${i.severity}`, href: `#/case/${i.id}` },
    h("div", { class: "inc-main" }, h("h3", null, i.type_label), h("p", { class: "inc-sub" }, sub)),
    sevPill(i.severity, i.severity_label),
    h("div", { class: "meta" },
      h("span", { class: `status st-${i.status}` }, i.status_label),
      h("span", null, ago(i.created_at)),
      h("span", { class: "mono ref" }, i.ref)));
}
