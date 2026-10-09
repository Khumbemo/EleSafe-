/* Safety advice, emergency numbers and how to claim compensation. */
import { h } from "../dom";
import { isNag } from "../i18n/translate";
import { icon } from "../icons";
import { state } from "../state";
import type { SafetyTip } from "../types";
import { shell } from "../ui";
import { copy } from "./dashboard";

export function viewGuide(): void {
  const { safety, contacts, compensation } = state.meta;
  const list = (items: SafetyTip[], markText: string) => h("ul", { class: "stack plain" }, items.map((i) => h("li", { class: "row top" },
    h("b", { "aria-hidden": "true" }, markText),
    h("div", { class: "grow" },
      h("p", null, i.text),
      isNag() ? h("p", { class: "small muted", translate: "no" }, h("i", null, i.text))
        : i.local ? h("p", { class: "small muted" }, h("i", null, i.local)) : null))));
  shell("more",
    h("div", { class: "pagehead" }, h("a", { class: "small", href: "#/more" }, "← More"), h("h1", null, "Safety and help")),
    h("div", { class: "grid2" },
      h("section", { class: "card" }, h("h2", null, "Do"), list(safety.do, "✓")),
      h("section", { class: "card" }, h("h2", null, "Don't"), list(safety.dont, "✕"))),
    h("section", { class: "card flush divide" },
      h("div", { class: "item" }, h("h2", null, "Emergency numbers")),
      contacts.map((c, k) => h("div", { class: "item" },
        h("h3", null, c.name),
        h("button", { type: "button", class: "btn small", "data-copy": k, "aria-label": `Copy ${c.name} number`, on: { click: () => copy(c.phone.replace(/\s/g, "")) } }, icon("copy")),
        h("div", { class: "meta" },
          h("span", { class: "mono" }, c.phone),
          h("span", null, c.role),
          c.placeholder && h("span", { class: "tag" }, "Placeholder, not a real line"))))),
    h("section", { class: "card" },
      h("h2", null, "Compensation (ex-gratia)"),
      h("dl", { class: "facts" }, compensation.rates.map((r) => h("div", null, h("dt", null, r.item), h("dd", null, r.amount)))),
      h("p", { class: "small muted" }, compensation.note),
      h("div", { class: "grid2" },
        h("div", { class: "stack" }, h("h3", null, "How to claim"), h("ol", { class: "stack indent" }, compensation.steps.map((st) => h("li", null, st)))),
        h("div", { class: "stack" }, h("h3", null, "Bring"), h("ul", { class: "stack indent" }, compensation.documents.map((st) => h("li", null, st)))))));
}
