/* Sign in, sign up, forgotten PIN and choosing a new PIN. */
import { api, saveMe, signOutLocal } from "../api";
import { type Child, h } from "../dom";
import { langPicker } from "../i18n/translate";
import { mark } from "../icons";
import { flushQueue } from "../offline";
import { nav, state } from "../state";
import type { OtpSent, Session, User } from "../types";
import { authShell, showErrors, toast } from "../ui";
import { ApiErr, asErr, roleName, store } from "../util";

/** <label class="field" data-field=…><span>label</span>control…</label> */
export const field = (name: string | null, label: Child, ...control: Child[]): HTMLLabelElement =>
  h("label", { class: "field", "data-field": name }, h("span", null, label), control);

/** A numeric PIN box. */
export const pinInput = (id: string, autocomplete: string, extra: Record<string, string | boolean> = {}): HTMLInputElement =>
  h("input", { id, type: "password", inputmode: "numeric", maxlength: 6, autocomplete, ...extra });

const pinsDiffer = () => new ApiErr(400, "The two PINs don't match.", "pin2");

export function signIn({ token, user }: Session): void {
  state.token = token; state.user = user;
  store.set("hatialert.token", token);
  saveMe(user);
  location.hash = user.must_change_pin ? "#/new-pin" : "#/home";
  nav.router();
  flushQueue();
}

export function viewLogin(): void {
  const demo = state.meta.demo_accounts;
  const phone = h("input", { id: "login-phone", type: "tel", inputmode: "numeric", autocomplete: "tel", placeholder: "98765 43210", required: true });
  const pin = h("input", { id: "login-pin", type: "password", inputmode: "numeric", autocomplete: "current-password", maxlength: 6, required: true });
  const submit = h("button", { class: "btn primary big", type: "submit" }, "Sign in");
  const form = h("form", { class: "card", id: "login", novalidate: true },
    h("h2", null, "Sign in"),
    field("phone", "Mobile number", phone),
    field("pin", "PIN", pin),
    h("div", { "data-errors": true }),
    submit,
    h("p", { class: "small muted" }, "New here? ", h("a", { href: "#/register" }, "Create an account")),
    h("p", { class: "small muted" }, h("a", { href: "#/forgot" }, "Forgot your PIN?")));
  form.onsubmit = async (e) => {
    e.preventDefault();
    submit.disabled = true;
    try {
      signIn(await api<Session>("POST", "/api/auth/login", { phone: phone.value, pin: pin.value }));
    } catch (err) { showErrors(form, asErr(err)); submit.disabled = false; }
  };
  authShell(
    h("div", { class: "hero" },
      h("div", { class: "row between" }, h("div", { class: "row" }, mark(), h("b", { class: "label" }, "HatiAlert · Wokha")), langPicker("lang-login")),
      h("h1", null, "See elephants? Warn your village in a minute."),
      h("p", { class: "muted" }, "Report sightings and crop raids, follow what the forest staff do about them, and get warnings for your village.")),
    form,
    demo.length > 0 && h("section", { class: "card" },
      h("div", { class: "stack" }, h("h2", null, "Try a demo account"), h("p", { class: "small muted" }, "Each role sees a different app. Tap one to fill in the form.")),
      h("div", { class: "demo" }, demo.map((d) => h("button", {
        type: "button", "data-phone": d.phone, "data-pin": d.pin,
        on: { click() { phone.value = d.phone; pin.value = d.pin; form.requestSubmit(); } },
      },
      h("b", null, roleName[d.role]),
      h("span", { class: "mono muted" }, `PIN ${d.pin}`),
      h("span", { class: "small muted" }, `${d.name} · ${d.village}`),
      h("span", { class: "mono small muted" }, d.phone))))));
}

export function viewRegister(): void {
  const name = h("input", { id: "reg-name", type: "text", autocomplete: "name", maxlength: 60, required: true });
  const phone = h("input", { id: "reg-phone", type: "tel", inputmode: "numeric", autocomplete: "tel", required: true });
  const village = h("select", { id: "reg-village" }, state.meta.villages.map((v) => h("option", null, v.name)));
  const pin = pinInput("reg-pin", "new-password"), pin2 = pinInput("reg-pin2", "new-password");
  let code: HTMLInputElement | null = null;
  let codeBox: HTMLElement | null = null;
  if (state.meta.sms_enabled) {
    const c = code = h("input", { id: "reg-code", type: "text", inputmode: "numeric", autocomplete: "one-time-code", maxlength: 6, class: "grow" });
    const note = h("small", { id: "reg-code-note" }, "We text a 6-digit code to check the number is yours.");
    codeBox = h("div", { class: "field", "data-field": "code" },
      h("span", null, "Code from the text message"),
      h("div", { class: "row" }, c, h("button", {
        type: "button", class: "btn", id: "reg-send",
        on: {
          async click() {
            try { const r = await api<OtpSent>("POST", "/api/auth/otp", { phone: phone.value, purpose: "register" }); note.textContent = r.message; c.focus(); }
            catch (err) { showErrors(form, asErr(err)); }
          },
        },
      }, "Send code")),
      note);
  }
  const form: HTMLFormElement = h("form", { class: "card", id: "reg", novalidate: true },
    field("name", "Full name", name),
    field("phone", "Mobile number", phone),
    codeBox,
    field("village", "Village", village),
    h("div", { class: "grid2" },
      field("pin", "Choose a PIN", pin, h("small", null, "4 to 6 digits")),
      field("pin2", "Repeat PIN", pin2)),
    h("div", { "data-errors": true }),
    h("button", { class: "btn primary big", type: "submit" }, "Create account"),
    h("p", { class: "small muted" }, "New accounts start as villagers. Forest staff accounts are set up by the forest office."));
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (pin.value !== pin2.value) return showErrors(form, pinsDiffer());
    try {
      signIn(await api<Session>("POST", "/api/auth/register", { name: name.value, phone: phone.value, village: village.value, pin: pin.value, code: code?.value }));
      toast("Account created");
    } catch (err) { showErrors(form, asErr(err)); }
  };
  authShell(
    h("div", { class: "pagehead" }, h("a", { href: "#/login", class: "small" }, "← Sign in"), h("h1", null, "Create an account"), h("p", { class: "muted" }, "Your village sets which warnings you get.")),
    form);
}

export function viewForgot(): void {
  const head = h("div", { class: "pagehead" }, h("a", { href: "#/login", class: "small" }, "← Sign in"), h("h1", null, "Forgot your PIN?"));
  if (!state.meta.sms_enabled) {
    authShell(head, h("section", { class: "card" },
      h("p", null, "Ask a forest officer or forest guard to reset your PIN. They will give you a temporary PIN, and you choose a new one when you sign in."),
      h("p", { class: "small muted" }, "Text-message codes aren't set up on this server yet.")));
    return;
  }
  const phone = h("input", { id: "fg-phone", type: "tel", inputmode: "numeric", autocomplete: "tel" });
  const note = h("small", { id: "fg-note", class: "muted" });
  const code = h("input", { id: "fg-code", type: "text", inputmode: "numeric", autocomplete: "one-time-code", maxlength: 6 });
  const pin = pinInput("fg-pin", "new-password"), pin2 = pinInput("fg-pin2", "new-password");
  const form: HTMLFormElement = h("form", { class: "card", id: "fg", novalidate: true },
    h("p", { class: "muted" }, "We'll text you a code, then you choose a new PIN."),
    field("phone", "Mobile number", phone),
    h("div", null, h("button", {
      type: "button", class: "btn", id: "fg-send",
      on: {
        async click() {
          try { const r = await api<OtpSent>("POST", "/api/auth/otp", { phone: phone.value, purpose: "reset" }); note.textContent = r.message; }
          catch (err) { showErrors(form, asErr(err)); }
        },
      },
    }, "Send code"), " ", note),
    field("code", "Code from the text message", code),
    h("div", { class: "grid2" },
      field("pin", "New PIN", pin, h("small", null, "4 to 6 digits")),
      field("pin2", "Repeat PIN", pin2)),
    h("div", { "data-errors": true }),
    h("button", { class: "btn primary big", type: "submit" }, "Save new PIN"));
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (pin.value !== pin2.value) return showErrors(form, pinsDiffer());
    try { signIn(await api<Session>("POST", "/api/auth/reset", { phone: phone.value, code: code.value, pin: pin.value })); toast("New PIN saved"); }
    catch (err) { showErrors(form, asErr(err)); }
  };
  authShell(head, form);
}

/** Change-PIN form (`temp`: after signing in with a temporary PIN). */
export function pinForm(id: string, temp: boolean, done: () => void): HTMLFormElement {
  const old = pinInput(`${id}-old`, "current-password"), pin = pinInput(`${id}-new`, "new-password"), pin2 = pinInput(`${id}-new2`, "new-password");
  const form: HTMLFormElement = h("form", { class: "card", id, novalidate: true },
    h("h2", null, temp ? "Choose your own PIN" : "Change PIN"),
    temp && h("p", { class: "muted" }, "You signed in with a temporary PIN. Choose a new one that only you know."),
    field("old_pin", temp ? "Temporary PIN" : "Current PIN", old),
    h("div", { class: "grid2" },
      field("pin", "New PIN", pin, h("small", null, "4 to 6 digits, not 1111 or 1234")),
      field("pin2", "Repeat PIN", pin2)),
    h("div", { "data-errors": true }),
    h("div", null, h("button", { class: "btn primary", type: "submit" }, "Save new PIN")));
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (pin.value !== pin2.value) return showErrors(form, pinsDiffer());
    try {
      state.user = await api<User>("POST", "/api/me/pin", { old_pin: old.value, pin: pin.value });
      saveMe(state.user);
      toast("New PIN saved");
      done();
    } catch (err) { showErrors(form, asErr(err)); }
  };
  return form;
}

export function viewNewPin(): void {
  authShell(
    h("div", { class: "pagehead" }, h("div", { class: "row" }, mark(), h("b", { class: "label" }, "HatiAlert"))),
    pinForm("np", true, () => { location.hash = "#/home"; nav.router(); }),
    h("p", { class: "small muted" }, h("button", {
      type: "button", class: "linkbtn", id: "np-out",
      on: { async click() { try { await api("POST", "/api/auth/logout"); } catch { /* ok */ } signOutLocal(); nav.router(); } },
    }, "Sign out")));
}
