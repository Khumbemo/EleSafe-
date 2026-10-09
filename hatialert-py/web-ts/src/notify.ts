/* Notifications on this phone while the app is open or in the background. */
import { api } from "./api";
import { tr } from "./i18n/translate";
import { state } from "./state";
import type { Overview } from "./types";
import { store } from "./util";

const supported = "Notification" in window;
const seen = new Set<number>(JSON.parse(store.get("hatialert.seenAlerts") || "[]") as number[]);

export const notify = {
  supported,
  on: (): boolean => supported && store.get("hatialert.notify") === "1" && Notification.permission === "granted",
  /** Show the home village's newest warning once. */
  async check(): Promise<void> {
    if (!notify.on() || !state.user || state.user.must_change_pin) return;
    let o: Overview;
    try { o = await api<Overview>("GET", "/api/overview"); } catch { return; }
    const w = o.warning;
    if (!w || seen.has(w.id)) return;
    seen.add(w.id);
    store.set("hatialert.seenAlerts", JSON.stringify([...seen].slice(-50)));
    const title = `${tr("Elephant warning")} · ${o.village.name}`;
    try {
      const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
      if (reg) reg.showNotification(title, { body: w.message, tag: "alert-" + w.id, icon: "icon.svg" });
      else new Notification(title, { body: w.message, tag: "alert-" + w.id });
    } catch { /* blocked here */ }
  },
};

export function startNotify(): void {
  setInterval(() => notify.check(), 60_000);
}
