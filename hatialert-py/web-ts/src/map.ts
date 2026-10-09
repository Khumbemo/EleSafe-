/* The topographic map of Wokha district. Base layers come from
   map/layers.json and map/terrain.webp, built by tools/build_map.py from
   SRTM elevation and Census 2011 boundaries; villages and incidents are
   drawn on top. Map space: x = easting - e0 (km), y = n1 - northing (km),
   north up. */
import { $, $$, $maybe, type Child, h, s } from "./dom";
import { destination, type Km, utmKm } from "./geo";
import { state } from "./state";
import type { Incident } from "./types";
import { ago } from "./util";

/** map/layers.json as written by tools/build_map.py. Paths are packed as
    deltas in units of 10 m. */
interface RawLayers {
  extent: [number, number, number, number];
  terrain: { href: string };
  contours: { elev: number; index: boolean; paths: number[][] }[];
  streams: { order: number; path: number[] }[];
  districts: { name: string; state: string; rings: number[][] }[];
  peaks: { name?: string; e: number; n: number; elev: number }[];
  attribution: string[];
  contour_step: number;
}

interface Layers {
  e0: number; n0: number; e1: number; n1: number; W: number; H: number;
  terrain: string;
  contours: { minor: string; index: string };
  contourLabels: { e: number; n: number; elev: number; text: string }[];
  streams: Record<string, string>;
  districts: { name: string; state: string; d: string; ce: number; cn: number }[];
  peaks: RawLayers["peaks"];
  attribution: string[];
  step: number;
}

export interface MapOptions {
  incidents?: Incident[];
  /** Home village name: drawn larger, and the centre of the alert ring. */
  home?: string;
  /** Alert ring radius in km (0 = none). */
  radius?: number;
  /** Incident id to zoom to. */
  focus?: number | null;
}

let layersP: Promise<Layers | null> | null = null;
function loadLayers(): Promise<Layers | null> {
  if (!layersP) layersP = fetch("map/layers.json").then((r) => (r.ok ? r.json() as Promise<RawLayers> : null)).then((d) => (d ? prepareLayers(d) : null)).catch(() => null);
  return layersP;
}

function prepareLayers(d: RawLayers): Layers {
  const [e0, n0, e1, n1] = d.extent;
  const unpack = (p: number[]): Km[] => { const out: Km[] = []; let x = 0, y = 0; for (let i = 0; i < p.length; i += 2) { x += p[i]; y += p[i + 1]; out.push([x / 100, y / 100]); } return out; };
  const toD = (pts: Km[], close?: boolean): string => "M" + pts.map(([e, n]) => `${(e - e0).toFixed(2)},${(n1 - n).toFixed(2)}`).join("L") + (close ? "Z" : "");
  const contourLabels: Layers["contourLabels"] = [];
  const contours = { minor: "", index: "" };
  for (const c of d.contours) {
    for (const p of c.paths) {
      const pts = unpack(p);
      contours[c.index ? "index" : "minor"] += toD(pts);
      if (c.index && pts.length > 20) {
        const [e, n] = pts[pts.length >> 1];
        // keep labels of one height at least 6 km apart
        if (!contourLabels.some((l) => l.elev === c.elev && Math.hypot(l.e - e, l.n - n) < 6)) contourLabels.push({ e, n, elev: c.elev, text: c.elev.toLocaleString("en-IN") + " m" });
      }
    }
  }
  const streams: Record<string, string> = {};
  for (const st of d.streams) streams[st.order] = (streams[st.order] || "") + toD(unpack(st.path));
  const districts = d.districts.map((x) => {
    const rings = x.rings.map(unpack);
    const all = rings.flat();
    return { name: x.name, state: x.state, d: rings.map((r) => toD(r, true)).join(""), ce: all.reduce((s, p) => s + p[0], 0) / all.length, cn: all.reduce((s, p) => s + p[1], 0) / all.length };
  });
  return { e0, n0, e1, n1, W: e1 - e0, H: n1 - n0, terrain: d.terrain.href, contours, contourLabels, streams, districts, peaks: d.peaks, attribution: d.attribution, step: d.contour_step };
}

let mapSeq = 0;

/** A map box. It draws itself once the base layers have loaded, if it is
    on the page by then, so insert it straight away. */
export function mapBlock(opts: MapOptions): HTMLDivElement {
  const id = "m" + ++mapSeq;
  const box = h("div", { class: "mapbox", "data-map": id },
    h("div", { class: "mapframe", tabindex: 0, "aria-label": "Map of Wokha district. Use plus and minus keys to zoom, arrow keys to move." },
      s("svg", { class: "map", role: "img", "aria-label": "Map of villages and open incidents" }),
      h("div", { class: "mapctl" },
        h("button", { type: "button", "data-z": "in", "aria-label": "Zoom in" }, "+"),
        h("button", { type: "button", "data-z": "out", "aria-label": "Zoom out" }, "−"),
        h("button", { type: "button", "data-z": "fit", "aria-label": "Fit to area" }, "⤢")),
      h("div", { class: "scalebar", "aria-hidden": "true" }, h("i"), h("span"))),
    mapLegend(opts.radius));
  loadLayers().then((L) => { if (box.isConnected) drawMap(box, opts, L); });
  return box;
}

function mapLegend(radius: number | undefined): Child[] {
  const key = (cls: string, label: string) => h("span", null, h("i", { class: cls }), label);
  return [
    h("div", { class: "legend" },
      key("dotk critical", "Critical"), key("dotk high", "High"), key("dotk medium", "Medium"), key("dotk low", "Low"),
      key("vk", "Village"), key("vk unv", "Village, position not verified"),
      radius ? key("lk ring", `Your ${radius} km alert area`) : null,
      key("lk water", "Stream"), key("lk ct", "Contour, 100 m"), key("lk dist", "District boundary")),
    h("details", { class: "attrib" }, h("summary", null, "Map sources"), h("p", { "data-attrib": true })),
  ];
}

interface View { x: number; y: number; w: number }

function drawMap(box: HTMLElement, { incidents = [], home, radius = 0, focus = null }: MapOptions, L: Layers | null): void {
  const svg = $<SVGSVGElement>("svg", box), frame = $(".mapframe", box);
  const V = state.meta.villages;
  const vp = V.map((v) => utmKm(v.lat, v.lng));
  const ip = incidents.map((i) => utmKm(i.lat, i.lng));
  const all = [...vp, ...ip];
  const e0 = L ? L.e0 : Math.min(...all.map((p) => p[0])) - 15, n1 = L ? L.n1 : Math.max(...all.map((p) => p[1])) + 15;
  const W = L ? L.W : 30 + Math.max(...all.map((p) => p[0])) - Math.min(...all.map((p) => p[0])), H = L ? L.H : 30 + Math.max(...all.map((p) => p[1])) - Math.min(...all.map((p) => p[1]));
  const X = ([e]: Km) => e - e0, Y = ([, n]: Km) => n1 - n;
  const hv = V.find((v) => v.name === home);
  const f2 = (v: number) => v.toFixed(3);
  const mapId = box.dataset.map;

  const base: SVGElement[] = [
    s("defs", null, s("marker", { id: `arrow-${mapId}`, viewBox: "0 0 10 10", refX: 5, refY: 5, markerWidth: 4, markerHeight: 4, orient: "auto-start-reverse" }, s("path", { class: "arrowhead", d: "M0 0 10 5 0 10z" }))),
    s("rect", { class: "land", x: -W, y: -H, width: 3 * W, height: 3 * H }),
  ];
  if (L) {
    const wokha = L.districts.find((d) => d.name === "Wokha");
    base.push(s("image", { class: "relief", href: L.terrain, x: 0, y: 0, width: W, height: H, preserveAspectRatio: "none" }));
    if (wokha) base.push(s("path", { class: "outside", "fill-rule": "evenodd", d: `M${-W},${-H}H${2 * W}V${2 * H}H${-W}Z${wokha.d}` }));
    base.push(s("path", { class: "ct", d: L.contours.minor }), s("path", { class: "ct idx", d: L.contours.index }));
    for (const [o, d] of Object.entries(L.streams)) base.push(s("path", { class: `water o${o}`, d }));
    for (const d of L.districts) if (d.name !== "Wokha") base.push(s("path", { class: `dist ${d.state === "Assam" ? "assam" : ""}`, d: d.d }));
    if (wokha) base.push(s("path", { class: "dist wokha", d: wokha.d }));
  }
  const gridG = s("g", { class: "grid" });
  base.push(gridG);
  if (hv && radius) {
    const ring = Array.from({ length: 73 }, (_, k) => utmKm(...destination(hv.lat, hv.lng, radius, k * 5)));
    base.push(s("path", { class: "ring", d: `M${ring.map((p) => `${f2(X(p))},${f2(Y(p))}`).join("L")}Z` }));
  }
  // Pins are drawn in screen pixels around (0,0) and scaled on zoom.
  const pins: SVGGElement[] = [];
  const pin = (p: Km, inner: Child[], cls = "") => pins.push(s("g", { class: `pin ${cls}`, "data-x": f2(X(p)), "data-y": f2(Y(p)) }, inner));
  if (L) {
    // data-pri: lower numbers win when labels would overlap
    for (const d of L.districts) if (d.name !== "Wokha") pin([d.ce, d.cn], [s("text", { class: "dname", "data-pri": 7, "text-anchor": "middle" }, d.name.toUpperCase())], "dlabel");
    for (const c of L.contourLabels) pin([c.e, c.n], [s("text", { class: "clabel", "data-pri": 8, "text-anchor": "middle", y: 3 }, c.text)], "clab");
    for (const pk of L.peaks) pin([pk.e, pk.n], [
      s("path", { class: "peak", d: "M0,-7 L6,4 L-6,4Z" }),
      s("text", { class: "plabel", "data-pri": 5, "text-anchor": "middle", y: 17 }, pk.name || ""),
      s("text", { class: "plabel elev", "data-pri": 6, "data-with-prev": 1, "text-anchor": "middle", y: 29 }, `${pk.elev.toLocaleString("en-IN")} m`),
    ]);
  }
  V.forEach((v, k) => {
    const isHome = v.name === home;
    pin(vp[k], [
      s("circle", { class: `vdot${isHome ? " home" : ""}${v.verified ? "" : " unv"}`, r: isHome ? 6 : 4.5 }),
      s("text", { class: `vlabel${isHome ? " home" : ""}`, "data-pri": isHome ? 0 : v.verified ? 3 : 4, x: 9, y: 4 }, v.name),
      s("title", null, `${v.name}: ${v.verified ? v.source : "position not verified"}`),
    ], "vpin");
  });
  const dirs = state.meta.directions;
  incidents.forEach((i, k) => {
    const r = 7 + Math.min(i.herd_size || 0, 20) * 0.35;
    let arrow: SVGLineElement | null = null;
    if (i.heading) {
      const a = dirs.indexOf(i.heading) * 45 * Math.PI / 180, s0 = r + 2, s1 = r + 24;
      arrow = s("line", { class: "heading", "marker-end": `url(#arrow-${mapId})`, x1: (Math.sin(a) * s0).toFixed(1), y1: (-Math.cos(a) * s0).toFixed(1), x2: (Math.sin(a) * s1).toFixed(1), y2: (-Math.cos(a) * s1).toFixed(1) });
    }
    const label = `${i.type_label}, ${i.severity_label} severity, near ${i.village}, ${ago(i.created_at)}`;
    pin(ip[k], [arrow, s("a", { href: `#/case/${i.id}`, "aria-label": label }, s("title", null, label), s("circle", { class: `inc ${i.severity}${i.id === focus ? " focus" : ""}`, r: r.toFixed(1) }))], "ipin");
  });
  base.push(s("g", { class: "pins" }, pins));
  svg.replaceChildren(...base);
  const attrib = $maybe("[data-attrib]", box);
  if (attrib) attrib.textContent = L ? "UTM zone 46N grid, km. " + L.attribution.join(". ") + ". Mount Tiyi height from SRTM." : "Base map unavailable; showing villages and incidents only.";

  // -- view: x, y = top-left corner, w = width, all in km --------------
  const pinEls = $$<SVGGElement>(".pin", svg).map((g) => ({ g, x: +(g.dataset.x as string), y: +(g.dataset.y as string) }));
  const labels = $$<SVGTextElement>("text[data-pri]", svg).sort((a, b) => +(a.dataset.pri as string) - +(b.dataset.pri as string));
  const marks = $$<SVGElement>(".inc, .vdot, .peak", svg);
  // Hide a label when it would sit on a marker or a more important label.
  function declutter() {
    labels.forEach((t) => t.classList.remove("hidden-label"));
    const taken = marks.map((m) => m.getBoundingClientRect()).filter((r) => r.width);
    const hit = (a: DOMRect, b: DOMRect) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    for (const t of labels) {
      const r = t.getBoundingClientRect();
      if (!r.width) continue; // hidden at this zoom by CSS
      const prev = t.previousElementSibling;
      const orphan = t.dataset.withPrev && prev && prev.classList.contains("hidden-label");
      if (orphan || (t.dataset.pri !== "0" && taken.some((x) => hit(r, x)))) t.classList.add("hidden-label");
      else taken.push(r);
    }
  }
  let view: View = { x: 0, y: 0, w: 0 };
  let raf = 0;
  const aspect = () => (frame.clientHeight || 300) / (frame.clientWidth || 400);
  function fit() {
    const pts: Km[] = [...(incidents.length ? ip : []), ...(hv ? [utmKm(hv.lat, hv.lng)] : [])];
    if (hv && radius) { const c = utmKm(hv.lat, hv.lng); pts.push([c[0] - radius, c[1] - radius], [c[0] + radius, c[1] + radius]); }
    if (!pts.length || (focus && ip.length === 1 && !radius)) pts.push(...(focus ? [[ip[0][0] - 4, ip[0][1] - 4], [ip[0][0] + 4, ip[0][1] + 4]] as Km[] : vp));
    const xs = pts.map(X), ys = pts.map(Y);
    let w = Math.max(8, Math.max(...xs) - Math.min(...xs) + 3);
    const h = Math.max(...ys) - Math.min(...ys) + 3;
    w = Math.max(w, h / aspect());
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    set({ x: cx - w / 2, y: cy - (w * aspect()) / 2, w });
  }
  function set(v: View) {
    const maxW = Math.max(W, H / aspect()) * 1.02;
    const w = Math.min(maxW, Math.max(1.5, v.w)), h = w * aspect();
    const x = w >= W ? (W - w) / 2 : Math.min(Math.max(v.x, -w * 0.1), W - w * 0.9);
    const y = h >= H ? (H - h) / 2 : Math.min(Math.max(v.y, -h * 0.1), H - h * 0.9);
    view = { x, y, w };
    svg.setAttribute("viewBox", `${x.toFixed(3)} ${y.toFixed(3)} ${w.toFixed(3)} ${h.toFixed(3)}`);
    const k = w / (frame.clientWidth || 400); // km per screen pixel
    for (const p of pinEls) p.g.setAttribute("transform", `translate(${p.x} ${p.y}) scale(${k.toFixed(5)})`);
    svg.classList.toggle("far", w > 30);
    svg.classList.toggle("mid", w > 9 && w <= 30);
    // grid every 1, 2, 5, 10 or 20 km so 3–8 lines cross the view
    const step = [1, 2, 5, 10, 20].find((st) => w / st <= 8) || 20;
    const g: SVGElement[] = [];
    for (let gx = Math.ceil((e0 + x) / step) * step; gx <= e0 + x + w; gx += step) {
      const sx = gx - e0;
      g.push(s("line", { x1: sx, y1: y, x2: sx, y2: y + h }), s("text", { x: sx + 3 * k, y: y + 12 * k, "font-size": (10 * k).toFixed(4) }, `${gx}E`));
    }
    for (let gy = Math.ceil((n1 - y - h) / step) * step; gy <= n1 - y; gy += step) {
      const sy = n1 - gy;
      g.push(s("line", { x1: x, y1: sy, x2: x + w, y2: sy }), s("text", { x: x + 3 * k, y: sy - 3 * k, "font-size": (10 * k).toFixed(4) }, `${gy}N`));
    }
    gridG.replaceChildren(...g);
    svg.style.setProperty("--gs", `${(3 * k).toFixed(4)}px`);
    // scale bar: a round distance near 90 px
    const target = 90 * k, nice = [0.25, 0.5, 1, 2, 5, 10, 20, 50].find((st) => st >= target * 0.6) || 50;
    const sb = $(".scalebar", box);
    $("i", sb).style.width = `${(nice / k).toFixed(0)}px`;
    $("span", sb).textContent = nice < 1 ? `${nice * 1000} m` : `${nice} km`;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(declutter);
  }
  const zoomAt = (factor: number, px?: number, py?: number) => {
    const r = frame.getBoundingClientRect();
    const fx = px === undefined ? 0.5 : (px - r.left) / r.width, fy = py === undefined ? 0.5 : (py - r.top) / r.height;
    const w = view.w * factor, h0 = view.w * aspect();
    set({ x: view.x + fx * (view.w - w), y: view.y + fy * (h0 - w * aspect()), w });
  };
  $(".mapctl", box).onclick = (e) => {
    const b = (e.target as Element).closest<HTMLElement>("[data-z]");
    if (!b) return;
    if (b.dataset.z === "fit") fit(); else zoomAt(b.dataset.z === "in" ? 0.6 : 1 / 0.6);
  };
  frame.addEventListener("wheel", (e) => {
    if (!e.ctrlKey && document.activeElement !== frame) return; // let the page scroll
    e.preventDefault();
    zoomAt(Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX, e.clientY);
  }, { passive: false });
  frame.addEventListener("dblclick", (e) => { e.preventDefault(); zoomAt(0.5, e.clientX, e.clientY); });
  frame.addEventListener("keydown", (e) => {
    const k = view.w / 6;
    const keys: Record<string, () => void> = {
      "+": () => zoomAt(0.7), "=": () => zoomAt(0.7), "-": () => zoomAt(1 / 0.7), "0": fit,
      ArrowLeft: () => set({ ...view, x: view.x - k }), ArrowRight: () => set({ ...view, x: view.x + k }),
      ArrowUp: () => set({ ...view, y: view.y - k }), ArrowDown: () => set({ ...view, y: view.y + k }),
    };
    if (keys[e.key]) { e.preventDefault(); keys[e.key](); }
  });
  // Mouse drag pans; on touch screens one finger scrolls the page and two
  // fingers pinch-zoom and pan the map.
  const pts = new Map<number, { x: number; y: number }>();
  let last: { cx: number; cy: number; span: number } | null = null, moved = 0;
  svg.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // Capture only for a pinch here; a mouse is captured once it really
    // drags, so a plain click still reaches incident links.
    if (pts.size === 2) for (const id of pts.keys()) svg.setPointerCapture(id);
    last = null; moved = 0;
  });
  svg.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (e.pointerType !== "mouse" && pts.size < 2) return;
    const ps = [...pts.values()];
    const cx = ps.reduce((sum, p) => sum + p.x, 0) / ps.length, cy = ps.reduce((sum, p) => sum + p.y, 0) / ps.length;
    const span = ps.length > 1 ? Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) : 0;
    if (last) {
      const k = view.w / frame.clientWidth;
      moved += Math.abs(cx - last.cx) + Math.abs(cy - last.cy);
      if (moved > 6 && e.pointerType === "mouse" && !svg.hasPointerCapture(e.pointerId)) svg.setPointerCapture(e.pointerId);
      set({ ...view, x: view.x - (cx - last.cx) * k, y: view.y - (cy - last.cy) * k });
      if (span && last.span) zoomAt(last.span / span, cx, cy);
    }
    last = { cx, cy, span };
  });
  const up = (e: PointerEvent) => { pts.delete(e.pointerId); last = null; };
  svg.addEventListener("pointerup", up);
  svg.addEventListener("pointercancel", up);
  svg.addEventListener("click", (e) => { if (moved > 6) { e.preventDefault(); e.stopPropagation(); } }, true);
  new ResizeObserver(() => { if (view.w) set(view); }).observe(frame);
  fit();
}
