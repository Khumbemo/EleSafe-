/* HatiAlert web client: entry point for hatialert/web/app.js. */
import { api, transport } from "./api";
import { $, fill, h } from "./dom";
import { startTranslator } from "./i18n/translate";
import { mark } from "./icons";
import { startNotify } from "./notify";
import { startOffline } from "./offline";
import { router } from "./router";
import { nav, state } from "./state";
import { applyTheme, currentTheme } from "./theme";
import type { Meta, User } from "./types";
import { asErr, store } from "./util";

applyTheme(currentTheme());
startTranslator();
startOffline();
startNotify();
nav.router = router;

async function boot(): Promise<void> {
  const app = $("#app");
  fill(app, h("div", { class: "boot" }, h("div", null, mark(), h("p", { id: "boot-msg" }, "Starting HatiAlert…"))));
  try {
    await transport.ready;
    state.meta = await api<Meta>("GET", "/api/meta");
    state.token = store.get("hatialert.token");
    if (state.token) {
      try { state.user = await api<User>("GET", "/api/me"); }
      catch (err) { if (asErr(err).status !== 0) { state.token = null; store.set("hatialert.token", null); } }
    }
  } catch (err) {
    fill(app, h("div", { class: "boot" }, h("div", { class: "stack" },
      h("h2", null, "HatiAlert couldn't start"),
      h("p", null, asErr(err).message),
      h("div", null, h("button", { class: "btn", id: "reload", on: { click: () => location.reload() } }, "Reload")))));
    return;
  }
  window.addEventListener("hashchange", router);
  router();
}
window.HATI_BOOT_MSG = (msg) => { const el = document.getElementById("boot-msg"); if (el) el.textContent = msg; };
boot();
