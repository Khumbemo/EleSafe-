/* Small helpers with no DOM: storage, wording and number formats. */
import type { Role } from "./types";

/** localStorage that never throws (it can be blocked or full). */
export const store = {
  get(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string | null): void { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

export const plural = (n: number, one: string, many = one + "s"): string => `${n} ${n === 1 ? one : many}`;

export const when = (ms: number): string => new Date(ms).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function ago(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return plural(Math.floor(s / 86400), "day") + " ago";
  return when(ms);
}

export const inr = (n: number | null | undefined): string => "₹" + Number(n || 0).toLocaleString("en-IN");
export const kb = (n: number): string => (n >= 1e6 ? (n / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1000)) + " KB");
export const roleName: Record<Role, string> = { villager: "Villager", guard: "Forest guard", officer: "Forest officer" };

/** An API failure; status 0 means the network could not be reached. */
export class ApiErr extends Error {
  status: number;
  field: string | undefined;
  constructor(status: number, message: string, field?: string) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

/** Anything caught, as an ApiErr-like value with a message. */
export const asErr = (e: unknown): ApiErr => (e instanceof ApiErr ? e : new ApiErr(-1, e instanceof Error ? e.message : String(e)));
