/* Line icons (24 x 24, stroked by app.css) and the HatiAlert mark, built
   as SVG elements. */
import { h, s } from "./dom";

type Shape = ["path", { d: string }] | ["circle", { cx: number; cy: number; r: number }] | ["rect", { x: number; y: number; width: number; height: number; rx: number }];
const p = (d: string): Shape => ["path", { d }];
const c = (cx: number, cy: number, r: number): Shape => ["circle", { cx, cy, r }];
const r = (x: number, y: number, width: number, height: number, rx: number): Shape => ["rect", { x, y, width, height, rx }];

const ICON = {
  home: [p("M3 11.5 12 4l9 7.5"), p("M5.5 10v10h13V10")],
  report: [p("M12 5v14M5 12h14")],
  cases: [p("M9 6h11M9 12h11M9 18h11"), p("M4 6h.01M4 12h.01M4 18h.01")],
  alerts: [p("M6 9a6 6 0 0 1 12 0c0 6 2.5 8 2.5 8h-17S6 15 6 9"), p("M10 20.5a2 2 0 0 0 4 0")],
  more: [p("M4 7h16M4 12h16M4 17h16")],
  copy: [r(8, 8, 12, 12, 2), p("M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3")],
  pin: [p("M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"), c(12, 9.5, 2.5)],
  camera: [p("M3 8.5A2.5 2.5 0 0 1 5.5 6H7l2-2.5h6L17 6h1.5A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"), c(12, 12.5, 3.8)],
  mic: [r(9, 3, 6, 11, 3), p("M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21")],
  stop: [r(6.5, 6.5, 11, 11, 2)],
  x: [p("M6 6l12 12M18 6 6 18")],
  image: [r(3, 4, 18, 16, 2), c(9, 10, 2), p("m21 16-5-5-9 9")],
  flip: [p("M4.5 10A8 8 0 0 1 18 6.5L20 8.5M19.5 14A8 8 0 0 1 6 17.5L4 15.5"), p("M20 4.5v4h-4M4 19.5v-4h4")],
} satisfies Record<string, Shape[]>;
export type IconName = keyof typeof ICON;

/** The bare <svg> of an icon. */
export const iconSvg = (n: IconName): SVGSVGElement => s("svg", { viewBox: "0 0 24 24" }, ICON[n].map(([tag, attrs]) => s(tag, attrs)));

/** An icon in its <span class="ic">, hidden from screen readers. */
export const icon = (n: IconName): HTMLSpanElement => h("span", { class: "ic", "aria-hidden": "true" }, iconSvg(n));

/** The HatiAlert mark: a dot with two dashed rings. */
export const mark = (): SVGSVGElement =>
  s("svg", { width: 30, height: 30, viewBox: "0 0 30 30", "aria-hidden": "true" },
    s("rect", { class: "mk-bg", width: 30, height: 30, rx: 8 }),
    s("circle", { class: "mk-dot", cx: 15, cy: 15, r: 3.2 }),
    s("circle", { class: "mk-ring", cx: 15, cy: 15, r: 7.5, "stroke-width": 1.8, "stroke-dasharray": "3 2.6" }),
    s("circle", { class: "mk-ring faint", cx: 15, cy: 15, r: 11.5, "stroke-width": 1.4 }));
