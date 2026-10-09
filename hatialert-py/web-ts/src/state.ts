/* What the client keeps in memory while it runs. */
import type { AlertPrefill, Meta, User } from "./types";

export type CasesFilter = "open" | "closed" | "all";

export const state = {
  /** Loaded at boot before any screen draws, so screens can rely on it. */
  meta: null as unknown as Meta,
  token: null as string | null,
  user: null as User | null,
  /** Filled by "Warn nearby villages" for the alert form. */
  prefill: null as AlertPrefill | null,
  casesFilter: "open" as CasesFilter,
  casesVillage: "",
  days: 30,
  /** When the network went away, or null when online. */
  offlineSince: null as number | null,
};

/** The signed-in person; screens behind sign-in call this. */
export function me(): User {
  if (!state.user) throw new Error("Not signed in");
  return state.user;
}

export const isStaff = (): boolean => !!state.user && state.user.role !== "villager";

/** Late-bound so modules can re-draw the page without importing the router. */
export const nav = { router: (): void => {} };
