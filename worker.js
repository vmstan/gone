// Worker gone returns HTTP 410 Gone with a self-contained retirement page.

import LOGO_SVG from "./logo.svg";
import { createRetirementPage } from "./page.js";
import { handleRequest } from "./router.js";

const retirementPage = createRetirementPage(LOGO_SVG, "vmst.io");

export default {
  fetch(request) {
    return handleRequest(request, retirementPage);
  },
};
