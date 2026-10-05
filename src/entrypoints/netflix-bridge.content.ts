import { initNetflixPageBridge } from "~/features/subtitles/netflix/netflix-bridge";

export default defineContentScript({
  matches: ["https://www.netflix.com/*"],
  world: "MAIN",
  runAt: "document_start",
  main() {
    initNetflixPageBridge();
  },
});
