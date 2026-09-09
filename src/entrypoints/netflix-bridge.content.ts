import { initNetflixPageBridge } from "~/lib/services/netflix-bridge";

export default defineContentScript({
  matches: ["https://www.netflix.com/*"],
  world: "MAIN",
  runAt: "document_start",
  main() {
    initNetflixPageBridge();
  },
});
