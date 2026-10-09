/* Hash routes: #/page/arg. Before sign-in only login, register and forgot. */
import { state } from "./state";
import { viewAdmin } from "./views/admin";
import { viewAlerts } from "./views/alerts";
import { viewForgot, viewLogin, viewNewPin, viewRegister } from "./views/auth";
import { viewCase, viewCases } from "./views/cases";
import { viewDashboard } from "./views/dashboard";
import { viewGuide } from "./views/guide";
import { viewHome } from "./views/home";
import { viewMore } from "./views/more";
import { viewReport } from "./views/report";

export function router(): void {
  const [, page = "home", arg] = (location.hash || "#/home").split("/");
  if (!state.user) {
    if (page === "register") return viewRegister();
    if (page === "forgot") return viewForgot();
    return viewLogin();
  }
  window.scrollTo(0, 0);
  if (state.user.must_change_pin) return viewNewPin();
  switch (page) {
    case "admin": viewAdmin(arg); return;
    case "report": return viewReport(arg);
    case "cases": viewCases(); return;
    case "case": viewCase(arg); return;
    case "alerts": viewAlerts(); return;
    case "dashboard": viewDashboard(); return;
    case "guide": return viewGuide();
    case "more": return viewMore();
    default: viewHome();
  }
}
