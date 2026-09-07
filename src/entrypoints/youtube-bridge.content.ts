import { initYouTubePageBridge } from "~/lib/services/youtube-bridge";

export default defineContentScript({
  matches: ["https://www.youtube.com/*", "https://m.youtube.com/*"],
  world: "MAIN",
  runAt: "document_start",
  main() {
    initYouTubePageBridge();
  },
});

