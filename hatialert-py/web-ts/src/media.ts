/* Photos and voice notes. Live camera and microphone where the browser
   allows them; otherwise the phone's own camera or recorder through a file
   input (capture=...). */
import { api } from "./api";
import { $$, fill, h } from "./dom";
import { icon } from "./icons";
import { state } from "./state";
import type { AttachmentData, MediaKind } from "./types";
import { toast } from "./ui";
import { ApiErr, asErr, kb } from "./util";

/** A photo or voice note made on this phone, ready to upload. */
export interface MediaItem {
  kind: MediaKind;
  mime: string;
  size: number;
  data: string; // base64
  url: string; // data: URL for showing it
}

/** What a thumbnail needs: a new item (with url) or a stored one (with id). */
export interface Tile {
  kind: MediaKind;
  size: number;
  url?: string;
  id?: number;
}

// (typeof checks: older browsers and plain-HTTP pages have no mediaDevices)
const canCapture = typeof navigator.mediaDevices?.getUserMedia === "function";
const live = { camera: canCapture, mic: canCapture && typeof window.MediaRecorder === "function" };
const dataUrl = (mime: string, b64: string) => `data:${mime};base64,${b64}`;
const blobToB64 = (blob: Blob): Promise<string> => new Promise((ok, fail) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(",")[1] || "");
  r.onerror = () => fail(r.error);
  r.readAsDataURL(blob);
});

function pickFile(accept: string, capture: string | null): Promise<File | null> {
  return new Promise((resolve) => {
    const input = h("input", { type: "file", accept, capture, hidden: true });
    input.onchange = () => { resolve((input.files && input.files[0]) || null); input.remove(); };
    input.addEventListener("cancel", () => { resolve(null); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

const badPhoto = () => new ApiErr(415, "That photo couldn't be opened. Try a JPEG or PNG.", "attachments");

// Shrink to at most 1600 px on the long side and re-encode as JPEG, so a
// phone photo uploads as a few hundred KB on a weak connection.
async function photoFromSource(source: Blob | HTMLVideoElement): Promise<MediaItem> {
  let img: ImageBitmap | HTMLImageElement | HTMLVideoElement;
  if (source instanceof Blob) {
    try { img = await createImageBitmap(source); }
    catch {
      img = await new Promise<HTMLImageElement>((ok, fail) => {
        const el = new Image();
        el.onload = () => ok(el);
        el.onerror = () => fail(badPhoto());
        el.src = URL.createObjectURL(source);
      });
    }
  } else img = source;
  const w = ("videoWidth" in img && img.videoWidth) || ("naturalWidth" in img && img.naturalWidth) || img.width;
  const ht = ("videoHeight" in img && img.videoHeight) || ("naturalHeight" in img && img.naturalHeight) || img.height;
  if (!w || !ht) throw badPhoto();
  const k = Math.min(1, 1600 / Math.max(w, ht));
  const canvas = h("canvas");
  canvas.width = Math.round(w * k); canvas.height = Math.round(ht * k);
  (canvas.getContext("2d") as CanvasRenderingContext2D).drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.82));
  if (!blob) throw badPhoto();
  const data = await blobToB64(blob);
  return { kind: "photo", mime: "image/jpeg", size: blob.size, data, url: dataUrl("image/jpeg", data) };
}

async function voiceFromBlob(blob: Blob): Promise<MediaItem> {
  const rule = state.meta.media.voice;
  if (blob.size > rule.max_bytes) throw new ApiErr(413, `Each voice note must be under ${rule.max_bytes / 1e6} MB.`, "attachments");
  const mime = (blob.type || "audio/webm").split(";")[0];
  const data = await blobToB64(blob);
  return { kind: "voice", mime, size: blob.size, data, url: dataUrl(mime, data) };
}

// Full-screen live camera. Resolves a photo item, or null when closed.
// Rejects when the camera can't be opened, so the caller can fall back.
async function liveCamera(): Promise<MediaItem | null> {
  let facing = "environment", stream: MediaStream | undefined;
  const video = h("video", { playsinline: true, muted: true, autoplay: true });
  video.muted = true; // the attribute alone doesn't mute an element made in script
  const still = h("img", { alt: "Photo you just took", hidden: true });
  const shoot = h("button", { type: "button", class: "shutter", "data-shoot": true, "aria-label": "Take photo" });
  const use = h("button", { type: "button", class: "btn primary", "data-use": true }, "Use photo");
  const bar = h("div", { class: "cam-bar" },
    h("button", { type: "button", class: "cam-btn", "data-close": true, "aria-label": "Close camera" }, icon("x")),
    shoot,
    h("button", { type: "button", class: "cam-btn", "data-flip": true, "aria-label": "Switch camera" }, icon("flip")));
  const reviewBar = h("div", { class: "cam-bar", hidden: true, "data-review": true },
    h("button", { type: "button", class: "btn", "data-retake": true }, "Retake"),
    use);
  const box = h("div", { class: "cam", role: "dialog", "aria-modal": "true", "aria-label": "Camera" }, video, still, bar, reviewBar);
  const open = async () => {
    stream?.getTracks().forEach((t) => t.stop());
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false });
    video.srcObject = stream;
    await video.play().catch(() => {});
  };
  document.body.append(box);
  try { await open(); }
  catch (e) { box.remove(); throw e; }
  shoot.focus();
  return new Promise((resolve) => {
    let shot: MediaItem | null = null;
    const done = (val: MediaItem | null) => { stream?.getTracks().forEach((t) => t.stop()); box.remove(); document.removeEventListener("keydown", onKey); resolve(val); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") done(null); };
    document.addEventListener("keydown", onKey);
    const review = (on: boolean) => { video.hidden = on; still.hidden = !on; bar.hidden = on; reviewBar.hidden = !on; };
    box.onclick = async (e) => {
      const b = (e.target as Element).closest("button");
      if (!b) return;
      if (b.matches("[data-close]")) done(null);
      else if (b.matches("[data-flip]")) { facing = facing === "environment" ? "user" : "environment"; open().catch(() => toast("Couldn't switch camera")); }
      else if (b.matches("[data-shoot]")) { shot = await photoFromSource(video); still.src = shot.url; review(true); use.focus(); }
      else if (b.matches("[data-retake]")) { shot = null; review(false); }
      else if (b.matches("[data-use]")) done(shot);
    };
  });
}

/** A photo from the live camera, the phone's camera app, or the gallery. */
export async function takePhoto({ gallery = false } = {}): Promise<MediaItem | null> {
  if (!gallery && live.camera) {
    try { return await liveCamera(); }
    catch { live.camera = false; } // blocked here: use the phone's camera app from now on
  }
  const file = await pickFile("image/*", gallery ? null : "environment");
  return file ? photoFromSource(file) : null;
}

/** Inline voice recorder in `host`. `onDone(item)` gets the finished note. */
export function voiceRecorder(host: HTMLElement, onDone: (item: MediaItem) => unknown): { stop: () => void } {
  const max = state.meta.media.voice_max_seconds;
  let rec: MediaRecorder | null = null, timer: ReturnType<typeof setInterval> | undefined, started = 0;
  const idle = () => {
    clearInterval(timer);
    fill(host, h("button", { type: "button", class: "btn", "data-rec": true }, icon("mic"), " Record voice note"));
  };
  const fail = (msg: string) => { idle(); toast(msg); };
  async function start() {
    if (!live.mic) return fallback();
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch { live.mic = false; return fallback(); }
    const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((t) => MediaRecorder.isTypeSupported?.(t));
    const chunks: Blob[] = [];
    const r = rec = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : undefined);
    r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    r.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(timer);
      try { onDone(await voiceFromBlob(new Blob(chunks, { type: r.mimeType || type || "audio/webm" }))); idle(); }
      catch (err) { fail(asErr(err).message); }
    };
    r.start(250);
    started = Date.now();
    const time = h("b", { class: "tnum", "data-time": true }, "0:00");
    const stop = h("button", { type: "button", class: "btn primary", "data-stop": true }, icon("stop"), " Stop and keep");
    fill(host, h("div", { class: "recording", role: "status" },
      h("span", { class: "rec-dot", "aria-hidden": "true" }), time, h("span", { class: "small muted" }, `of ${max / 60}:00`), stop));
    stop.focus();
    timer = setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000);
      if (host.contains(time)) time.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      if (s >= max && r.state === "recording") r.stop();
    }, 250);
  }
  async function fallback() {
    const file = await pickFile("audio/*", "user");
    if (!file) return;
    try { onDone(await voiceFromBlob(file)); } catch (err) { fail(asErr(err).message); }
  }
  host.addEventListener("click", (e) => {
    const t = e.target as Element;
    if (t.closest("[data-rec]")) start();
    else if (t.closest("[data-stop]") && rec?.state === "recording") rec.stop();
  });
  idle();
  return { stop: () => { if (rec?.state === "recording") rec.stop(); } };
}

/** Thumbnails: photos first, then voice notes; k stays the item's index in
    `items` (data-view / data-remove). */
export const mediaTiles = (items: Tile[], removable: boolean): HTMLElement[] => items
  .map((m, k): [Tile, number] => [m, k])
  .sort((a, b) => (a[0].kind === "photo" ? 0 : 1) - (b[0].kind === "photo" ? 0 : 1))
  .map(([m, k]) => m.kind === "photo"
    ? h("figure", { class: "thumb" },
      h("button", { type: "button", class: "thumb-open", "data-view": k, "aria-label": `View photo ${k + 1}` },
        h("img", { alt: "", src: m.url || null, "data-att": m.id ?? "" })),
      removable && h("button", { type: "button", class: "thumb-x", "data-remove": k, "aria-label": "Remove photo" }, icon("x")))
    : h("div", { class: "voice" },
      icon("mic"),
      h("audio", { controls: true, preload: "metadata", src: m.url || null, "data-att": m.id ?? "", "aria-label": `Voice note ${k + 1}` }),
      h("span", { class: "small muted tnum" }, kb(m.size)),
      removable && h("button", { type: "button", class: "btn small", "data-remove": k }, "Remove")));

/** Full-screen photo; a tap or Escape closes it. */
export function lightbox(src: string): void {
  const btn = h("button", { type: "button", class: "cam-btn", "aria-label": "Close" }, icon("x"));
  const box = h("div", { class: "lightbox", role: "dialog", "aria-label": "Photo" }, h("img", { alt: "Report photo", src }), btn);
  const close = () => { box.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
  box.onclick = close;
  document.addEventListener("keydown", onKey);
  document.body.append(box);
  btn.focus();
}

/** Load stored attachments into <img>/<audio> elements marked data-att. */
export function hydrateMedia(root: ParentNode): void {
  $$<HTMLImageElement | HTMLAudioElement>("[data-att]", root).forEach(async (el) => {
    if (!el.dataset.att || el.getAttribute("src")) return;
    try { const a = await api<AttachmentData>("GET", `/api/attachments/${el.dataset.att}`); el.src = dataUrl(a.mime, a.data); }
    catch { el.replaceWith(h("span", { class: "small muted" }, "File unavailable")); }
  });
}
