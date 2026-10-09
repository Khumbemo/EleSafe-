/* A small typed DOM builder. h("div", { class: "card" }, "text", child)
   makes real elements; text always goes in as text nodes, so nothing a
   person typed is ever parsed as markup and no escaping is needed.

   Attribute values: true -> present and empty (hidden, selected…),
   false / null / undefined -> left out, anything else -> String(value).
   So aria-pressed and similar need String(bool), not a bare boolean.
   `on: { click() {…} }` sets the element's onclick property.

   Adjacent strings and numbers become one text node, as they would in
   HTML, so the Nagamese translator sees the same whole phrases.

   There is no `style` attribute on purpose: the server's CSP
   (style-src 'self') blocks inline style attributes. Set el.style.x from
   code instead, which CSP allows. */

export type Child = Node | string | number | false | null | undefined | readonly Child[];
export type AttrValue = string | number | boolean | null | undefined;
type Handlers = { [K in keyof HTMLElementEventMap]?: (this: HTMLElement, ev: HTMLElementEventMap[K]) => unknown };
export interface Attrs {
  on?: Handlers;
  style?: never;
  [name: string]: AttrValue | Handlers;
}

const SVG_NS = "http://www.w3.org/2000/svg";

function setAttrs(el: Element, attrs: Attrs | null | undefined): void {
  if (!attrs) return;
  for (const k of Object.keys(attrs)) {
    const v = attrs[k];
    if (k === "on") {
      const on = v as Handlers;
      for (const ev of Object.keys(on)) (el as unknown as Record<string, unknown>)["on" + ev] = on[ev as keyof Handlers];
    } else if (v === true) el.setAttribute(k, "");
    else if (v !== false && v != null) el.setAttribute(k, String(v));
  }
}

/** Append children to a node, joining neighbouring text into one node. */
export function add(parent: Node, ...children: Child[]): void {
  let text = "";
  const flush = () => { if (text) { parent.appendChild(document.createTextNode(text)); text = ""; } };
  const walk = (c: Child): void => {
    if (c == null || c === false || c === "") return;
    if (typeof c === "string" || typeof c === "number") text += c;
    else if (Array.isArray(c)) (c as readonly Child[]).forEach(walk);
    else { flush(); parent.appendChild(c as Node); }
  };
  children.forEach(walk);
  flush();
}

/** An HTML element. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  setAttrs(el, attrs);
  add(el, ...children);
  return el;
}

/** An SVG element (namespaced, so <a>, <title> and <text> are SVG ones). */
export function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  setAttrs(el, attrs);
  add(el, ...children);
  return el;
}

/** Several nodes with no wrapper. */
export function frag(...children: Child[]): DocumentFragment {
  const f = document.createDocumentFragment();
  add(f, ...children);
  return f;
}

/** Replace everything inside `el`. */
export function fill(el: Element, ...children: Child[]): void {
  el.replaceChildren(frag(...children));
}

/** The first match. Like the original app it assumes the element exists;
    use $maybe where it may not. */
export function $<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T {
  return root.querySelector(sel) as T;
}
export function $maybe<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(sel as never) as T | null;
}
export function $$<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] {
  return [...root.querySelectorAll(sel)] as T[];
}

/** The element an event came from, as an Element. */
export const target = (e: Event): Element => e.target as Element;
