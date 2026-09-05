// Worker gone returns HTTP 410 Gone with a self-contained retirement page.

import LOGO_SVG from "./logo.svg";
import { createRetirementPage } from "./page.js";
import { applySafeHeaders, handleRequest } from "./router.js";

const retirementPage = createRetirementPage(LOGO_SVG, "vmst.io");

export default {
  fetch(request) {
    try {
      return handleRequest(request, retirementPage);
    } catch (e) {
      console.error(JSON.stringify({ message: "request failed", error: e instanceof Error ? e.message : String(e) }));
      return applySafeHeaders(Response.json({ error: "Internal Server Error" }, { status: 500 }));
    }
  },
};
