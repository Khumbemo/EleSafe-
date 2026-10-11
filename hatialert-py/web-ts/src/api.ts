/* Talking to the Python API through `transport`: fetch() against the
   stdlib server by default, or the in-browser Python engine when the
   preview build sets window.HATI_TRANSPORT. */
import { $maybe } from "./dom";
import { state } from "./state";
import type { Transport, User } from "./types";
import { ApiErr, store } from "./util";

export const transport: Transport = window.HATI_TRANSPORT || {
  engine: "Python server",
  canDownload: true,
  ready: Promise.resolve(),
  async request(method, path, body, token) {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = "Bearer " + token;
    const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, type: res.headers.get("Content-Type") || "", body: await res.text() };
  },
};

// Reading pages offline: successful GETs are kept on the phone and shown,
// with a notice, when the network is down.
const CACHEABLE = /^\/api\/(meta|me|overview|alerts|incidents(\?|$)|incidents\/\d+$)/;
// Saved copies are filed under the sign-in (or "pub" for public data) and
// wiped on sign-out, so a shared phone never shows one person's data to another.
const cacheKey = (path: string): string => "hatialert.cache:" + (path === "/api/meta" ? "pub" : (state.token || "-").slice(0, 16)) + ":" + path;

/** Keep "who is signed in" on the phone so the app opens offline. */
export const saveMe = (user: User | null): void => { if (state.token && user) store.set(cacheKey("/api/me"), JSON.stringify({ at: Date.now(), data: user })); };

function clearCache(): void {
  try { for (const k of Object.keys(localStorage)) if (k.startsWith("hatialert.cache:") && !k.startsWith("hatialert.cache:pub:")) localStorage.removeItem(k); } catch { /* blocked */ }
}

interface ErrorBody { error?: string; field?: string }

/** Call the API. Resolves the parsed JSON (typed by the caller), or the
    text for CSV; rejects with ApiErr. */
export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res;
  try {
    res = await transport.request(method, path, body, state.token);
  } catch {
    if (method === "GET" && CACHEABLE.test(path)) {
      const hit = store.get(cacheKey(path));
      if (hit) {
        const { at, data } = JSON.parse(hit) as { at: number; data: T };
        setOffline(at);
        return data;
      }
    }
    setOffline(state.offlineSince || Date.now());
    throw new ApiErr(0, "Can't reach HatiAlert. Check your connection and try again.");
  }
  if (state.offlineSince) setOffline(null);
  if (res.type.startsWith("text/csv")) return res.body as T;
  let data: unknown = {};
  try { data = JSON.parse(res.body || "{}"); } catch { /* not JSON */ }
  if (res.status >= 400) {
    const e = data as ErrorBody;
    if (res.status === 401 && state.token) signOutLocal();
    if (res.status === 403 && e.field === "pin" && state.user) { state.user.must_change_pin = true; location.hash = "#/new-pin"; }
    throw new ApiErr(res.status, e.error || "Something went wrong.", e.field);
  }
  if (method === "GET" && CACHEABLE.test(path) && res.body.length < 400_000) store.set(cacheKey(path), JSON.stringify({ at: Date.now(), data }));
  return data as T;
}

/** Show or hide the "No connection" bar; `at` is when the shown data was saved. */
export function setOffline(at: number | null): void {
  state.offlineSince = at;
  const bar = $maybe("#offline-bar");
  if (bar) { bar.hidden = !at; if (at) bar.textContent = `No connection. Showing what was saved at ${new Date(at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}.`; }
}

/** Forget the sign-in on this phone (the server session may live on). */
export function signOutLocal(): void {
  clearCache();
  state.token = null; state.user = null;
  store.set("hatialert.token", null);
  location.hash = "#/login";
}
