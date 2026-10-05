import { initYouTubePageBridge } from "~/features/subtitles/youtube/youtube-bridge";

export default defineContentScript({
  matches: ["https://www.youtube.com/*", "https://m.youtube.com/*"],
  world: "MAIN",
  runAt: "document_start",
  main() {
    initYouTubePageBridge();
  },
});

