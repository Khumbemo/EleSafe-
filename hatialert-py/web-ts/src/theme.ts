/* Colour themes. The CSS keys off <html data-skin="…">; "green" is the
   default and has no attribute. */
import { store } from "./util";

export interface Theme { key: string; label: string; note: string }

export const THEMES: Theme[] = [
  { key: "green", label: "Green", note: "Follows your phone's light or dark mode" },
  { key: "white", label: "White", note: "Bright, for outdoors in daylight" },
  { key: "dark", label: "Dark", note: "Black and grey, less glare at night" },
  { key: "navy", label: "Navy blue", note: "Deep blue with sky-blue buttons" },
];

export const currentTheme = (): string => {
  const saved = store.get("hatialert.theme");
  return THEMES.some((t) => t.key === saved) ? (saved as string) : "green";
};

export function applyTheme(key: string): void {
  const root = document.documentElement;
  if (key && key !== "green") root.dataset.skin = key; else delete root.dataset.skin;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(root).getPropertyValue("--bg").trim() || meta.content;
}
