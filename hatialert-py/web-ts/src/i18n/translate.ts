/* Language. English is written in the views. For Nagamese, a translator
   swaps interface text as it reaches the page (phrases in nagamese.ts,
   loaded as window.HATI_NAGAMESE). Elements marked translate="no"
   (messages, notes, names people typed) are left alone. */
import { h } from "../dom";
import { nav } from "../state";
import { toast } from "../ui";
import { store } from "../util";

export type Lang = "en" | "nag";
const LANGS: { key: Lang; label: string }[] = [{ key: "en", label: "English" }, { key: "nag", label: "Nagamese" }];
const NAG = window.HATI_NAGAMESE || { words: {}, patterns: [] };
const NAG_PATTERNS = NAG.patterns.map(([re, out]): [RegExp, string] => [new RegExp("^" + re + "$"), out]);
let lang: Lang = store.get("hatialert.lang") === "nag" ? "nag" : "en";
export const isNag = (): boolean => lang === "nag";

export function tr(text: string): string;
export function tr(text: string | null): string | null;
export function tr(text: string | null): string | null {
  if (lang !== "nag" || !text) return text;
  const s = text.trim();
  if (!s) return text;
  let out: string | undefined = Object.prototype.hasOwnProperty.call(NAG.words, s) ? NAG.words[s] : undefined;
  if (out === undefined) {
    for (const [re, tpl] of NAG_PATTERNS) {
      const m = s.match(re);
      if (m) { out = tpl.replace(/\{(\d)\}/g, (_, k: string) => tr(m[+k] || "")); break; }
    }
  }
  if (out === undefined) return text;
  return text.slice(0, text.length - text.trimStart().length) + out + text.slice(text.trimEnd().length);
}

const TR_ATTRS = ["placeholder", "aria-label", "title", "alt"];
function translateNode(n: Node): void {
  if (n.nodeType === 3) { const v = tr(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; return; }
  if (!(n instanceof Element) || n.getAttribute("translate") === "no" || n.tagName === "SCRIPT" || n.tagName === "STYLE") return;
  for (const a of TR_ATTRS) {
    const old = n.getAttribute(a);
    if (old) { const v = tr(old); if (v !== old) n.setAttribute(a, v); }
  }
  if (n.tagName === "TEXTAREA") return; // its text is what the person typed
  for (const c of n.childNodes) translateNode(c);
}
const skipped = (n: Node): boolean => !!(n.parentElement && n.parentElement.closest('[translate="no"]'));

/** Translate whatever reaches the page while Nagamese is on. */
export function startTranslator(): void {
  new MutationObserver((muts) => {
    if (lang !== "nag") return;
    for (const m of muts) {
      if (m.type === "characterData") { if (!skipped(m.target)) translateNode(m.target); }
      else for (const n of m.addedNodes) if (!skipped(n)) translateNode(n);
    }
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  document.documentElement.lang = lang === "nag" ? "nag" : "en";
}

function setLang(key: string | undefined): void {
  lang = key === "nag" ? "nag" : "en";
  store.set("hatialert.lang", lang);
  document.documentElement.lang = lang === "nag" ? "nag" : "en";
}

/** English / Nagamese buttons; choosing one re-draws the page. */
export const langPicker = (id: string): HTMLDivElement =>
  h("div", { class: "seg langs", role: "group", "aria-label": "Language / Bhasa", translate: "no", id },
    LANGS.map((l) => h("button", {
      type: "button", "data-lang": l.key, "aria-pressed": String(lang === l.key),
      on: {
        click() {
          if (l.key === lang) return;
          setLang(l.key);
          nav.router();
          toast(lang === "nag" ? "Bhasa: Nagamese" : "Language: English");
        },
      },
    }, l.label)));
