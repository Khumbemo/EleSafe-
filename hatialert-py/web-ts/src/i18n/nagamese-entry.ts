/* Entry for hatialert/web/nagamese.js. The page loads it before app.js,
   which reads window.HATI_NAGAMESE; tools/check_i18n.cjs and the preview
   build read the built file too. */
import { NAGAMESE } from "./nagamese";

window.HATI_NAGAMESE = NAGAMESE;
