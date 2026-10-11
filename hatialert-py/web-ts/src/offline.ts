/* Working without a connection: reports saved on the phone (IndexedDB, so
   photos fit) and sent when the network is back, and the service worker
   that keeps the app itself on the phone. */
import { api } from "./api";
import { $maybe } from "./dom";
import { state } from "./state";
import type { Incident } from "./types";
import { toast } from "./ui";
import { asErr, plural } from "./util";

/** A report waiting to be sent; `body` is exactly what POST /api/incidents gets. */
export interface QueuedReport {
  client_id: string;
  user_id: number;
  body: Record<string, unknown>;
  queued_at: number;
}

const queueDb = (): Promise<IDBDatabase> => new Promise((ok, fail) => {
  const r = indexedDB.open("hatialert-client", 1);
  r.onupgradeneeded = () => r.result.createObjectStore("queue", { keyPath: "client_id" });
  r.onsuccess = () => ok(r.result);
  r.onerror = () => fail(r.error);
});
const queueTx = async <T>(mode: IDBTransactionMode, fn: (st: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> => {
  const d = await queueDb();
  return new Promise((ok, fail) => {
    const tx = d.transaction("queue", mode), st = tx.objectStore("queue");
    const req = fn(st);
    tx.oncomplete = () => ok(req && req.result);
    tx.onerror = () => fail(tx.error);
  });
};
export const queue = {
  async add(item: QueuedReport): Promise<boolean> { try { await queueTx("readwrite", (st) => st.put(item)); return true; } catch { return false; } },
  async all(): Promise<QueuedReport[]> { try { return ((await queueTx("readonly", (st) => st.getAll())) as QueuedReport[] | undefined) || []; } catch { return []; } },
  async remove(id: string): Promise<void> { try { await queueTx("readwrite", (st) => st.delete(id)); } catch { /* gone */ } },
};

/** An id for a report, so sending it twice can't make two incidents. */
export const newClientId = (): string => (crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join(""));

let flushing = false;
/** Send this person's saved reports, oldest first. */
export async function flushQueue(): Promise<void> {
  if (flushing || !state.user) return;
  flushing = true;
  try {
    for (const item of await queue.all()) {
      if (item.user_id !== state.user.id) continue;
      try {
        const inc = await api<Incident>("POST", "/api/incidents", item.body);
        await queue.remove(item.client_id);
        toast(`Saved report sent: ${inc.ref}`);
      } catch (e) {
        const err = asErr(e);
        if (err.status === 0 || err.status === 401 || err.status === 429 || err.status >= 500) break; // try later
        await queue.remove(item.client_id); // the server refused it; keep the reason visible
        toast(`A saved report couldn't be sent: ${err.message}`);
      }
    }
  } finally {
    flushing = false;
    const n = (await queue.all()).filter((i) => state.user && i.user_id === state.user.id).length;
    const box = $maybe("#queue-note");
    if (box) { box.hidden = !n; const c = $maybe("[data-count]", box); if (c) c.textContent = plural(n, "report"); }
  }
}

export function startOffline(): void {
  window.addEventListener("online", flushQueue);
  setInterval(() => { if (navigator.onLine) flushQueue(); }, 60_000);
  // App shell offline: only on the real server over HTTPS or localhost.
  if ("serviceWorker" in navigator && !window.HATI_TRANSPORT && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    navigator.serviceWorker.register("sw.js").catch(() => { /* still works online */ });
  }
}
