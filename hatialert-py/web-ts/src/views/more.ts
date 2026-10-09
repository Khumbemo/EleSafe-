/* "More": profile, language, theme, alert settings, PIN and sign-out. */
import { api, saveMe, signOutLocal, transport } from "../api";
import { $$, fill, h } from "../dom";
import { isNag, langPicker } from "../i18n/translate";
import { notify } from "../notify";
import { me, nav, state } from "../state";
import { applyTheme, currentTheme, THEMES } from "../theme";
import type { User } from "../types";
import { shell, showErrors, toast } from "../ui";
import { asErr, roleName, store } from "../util";
import { field, pinForm } from "./auth";

const askButton = () => h("button", { class: "btn", "data-ask": true }, "Sign out other devices");

export function viewMore(): void {
  const u = me();
  const smsOn = h("input", { type: "checkbox", id: "sms-on", checked: u.sms_alerts });
  const notifyOn = notify.supported ? h("input", { type: "checkbox", id: "notify-on", checked: notify.on() }) : null;
  const name = h("input", { id: "prof-name", type: "text", maxlength: 60, value: u.name });
  const village = h("select", { id: "prof-village" }, state.meta.villages.map((v) => h("option", { selected: v.name === u.village }, v.name)));
  const radius = h("select", { id: "prof-radius" }, [1, 2, 3, 5, 8, 10, 15].map((k) => h("option", { value: k, selected: k === u.radius_km }, `${k} km`)));
  const logoutAll = h("div", { class: "confirm", id: "logout-all" }, askButton());
  const prof = h("form", { class: "card", id: "prof", novalidate: true },
    h("h2", null, "Your settings"),
    field("name", "Name", name),
    h("div", { class: "grid2" },
      field("village", "Home village", village),
      field("radius_km", "Show incidents within", radius)),
    h("div", { "data-errors": true }),
    h("div", null, h("button", { class: "btn primary", type: "submit" }, "Save")));
  const item = (href: string, title: string, meta: string) => h("a", { class: "item", href }, h("h3", null, title), h("span", { class: "muted" }, "→"), h("div", { class: "meta" }, meta));
  const main = shell("more",
    h("div", { class: "pagehead" },
      h("h1", null, u.name),
      h("p", { class: "muted" }, `${roleName[u.role]} · `, h("span", { class: "mono" }, u.phone), !u.phone_verified && [" · ", h("span", { class: "tag" }, "Phone not verified")])),
    h("section", { class: "card flush divide" },
      u.role === "officer" && [
        item("#/dashboard", "District overview", "Trends, hotspots, response times, CSV export"),
        item("#/admin", "Admin", "People, villages, text messages, backups"),
      ],
      item("#/guide", "Safety and help", "What to do, emergency numbers, compensation")),
    h("section", { class: "card" },
      h("h2", { translate: "no" }, isNag() ? "Bhasa (Language)" : "Language (Bhasa)"),
      langPicker("lang-more"),
      isNag() && h("p", { class: "small muted", translate: "no" }, "Nagamese translation is a draft and has not been checked by a native speaker. Please tell the forest office about anything that reads wrong. / Etu Nagamese translation etiya kacha ase. Kiba bhul dikhile forest office ke kobi.")),
    h("section", { class: "card" },
      h("h2", { id: "theme-h" }, "Theme"),
      h("div", { class: "themes", role: "radiogroup", "aria-labelledby": "theme-h" }, THEMES.map((t) => h("button", {
        type: "button", class: "theme-opt", role: "radio", "data-skin-key": t.key, "aria-checked": String(currentTheme() === t.key), tabindex: currentTheme() === t.key ? 0 : -1,
      }, h("span", { class: `swatch sw-${t.key}`, "aria-hidden": "true" }, h("i"), h("i"), h("i"), h("i")), h("b", null, t.label), h("small", null, t.note))))),
    prof,
    h("section", { class: "card" },
      h("h2", null, "Alerts"),
      h("label", { class: "switch" }, smsOn, h("span", null, `Text me alerts for ${u.village}`)),
      h("small", { class: "muted" }, state.meta.sms_enabled ? "Sent to your mobile number as SMS." : "Forest staff send these by hand until text messages are set up."),
      notifyOn && [
        h("label", { class: "switch" }, notifyOn, h("span", null, "Show alerts on this phone")),
        h("small", { class: "muted" }, "Works while HatiAlert is open or in the background. It can't wake a closed app, so keep text alerts on."),
      ]),
    pinForm("cp", false, () => viewMore()),
    h("section", { class: "card" },
      h("h2", null, "Signed-in devices"),
      h("p", { class: "small muted" }, "Lost a phone, or signed in on someone else's? Sign out everywhere except here."),
      logoutAll),
    h("div", { class: "row between" },
      h("button", {
        class: "btn danger", id: "out",
        on: { async click() { try { await api("POST", "/api/auth/logout"); } catch { /* already signed out */ } signOutLocal(); nav.router(); } },
      }, "Sign out"),
      h("span", { class: "small muted" }, `Engine: ${transport.engine}`)));

  smsOn.onchange = async () => {
    try { state.user = await api<User>("PATCH", "/api/me", { sms_alerts: smsOn.checked }); saveMe(state.user); toast(smsOn.checked ? "Text alerts on" : "Text alerts off"); }
    catch (err) { smsOn.checked = !smsOn.checked; toast(asErr(err).message); }
  };
  if (notifyOn) notifyOn.onchange = async () => {
    if (notifyOn.checked) {
      let perm = Notification.permission;
      try { if (perm === "default") perm = await Notification.requestPermission(); } catch { perm = "denied"; }
      if (perm !== "granted") { notifyOn.checked = false; toast("This browser won't show notifications here"); return; }
    }
    store.set("hatialert.notify", notifyOn.checked ? "1" : "0");
    toast(notifyOn.checked ? "Alerts will show on this phone" : "Phone alerts off");
    notify.check();
  };
  logoutAll.onclick = async (e) => {
    const t = e.target as Element;
    if (t.matches("[data-ask]")) fill(logoutAll, h("span", { class: "small" }, "Sign out every other phone and browser?"), h("button", { class: "btn small danger", "data-yes": true }, "Sign them out"), h("button", { class: "btn small", "data-no": true }, "Cancel"));
    else if (t.matches("[data-no]")) fill(logoutAll, askButton());
    else if (t.matches("[data-yes]")) { try { await api("POST", "/api/me/logout-all"); toast("Other devices signed out"); } catch (err) { toast(asErr(err).message); } fill(logoutAll, askButton()); }
  };
  const opts = $$("[data-skin-key]", main);
  const choose = (b: HTMLElement, focus?: boolean) => {
    const key = b.dataset.skinKey as string;
    store.set("hatialert.theme", key);
    applyTheme(key);
    opts.forEach((o) => { o.setAttribute("aria-checked", String(o === b)); o.tabIndex = o === b ? 0 : -1; });
    if (focus) b.focus();
  };
  opts.forEach((b, k) => {
    b.onclick = () => { choose(b); toast(`Theme: ${THEMES[k].label}`); };
    b.onkeydown = (e) => {
      const d = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[e.key];
      if (d) { e.preventDefault(); choose(opts[(k + d + opts.length) % opts.length], true); }
    };
  });
  prof.onsubmit = async (e) => {
    e.preventDefault();
    try {
      state.user = await api<User>("PATCH", "/api/me", { name: name.value, village: village.value, radius_km: +radius.value });
      saveMe(state.user);
      toast("Saved");
      viewMore();
    } catch (err) { showErrors(prof, asErr(err)); }
  };
}
