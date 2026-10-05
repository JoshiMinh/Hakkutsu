import { registerGenericPlayerDetection } from "~/features/subtitles/generic/detect-player";

export default defineContentScript({
  matches: ["<all_urls>"],
  excludeMatches: [
    "*://*.netflix.com/*",
    "*://netflix.com/*",
    "*://*.youtube.com/*",
    "*://youtube.com/*",
  ],
  allFrames: true,
  main(ctx) {
    registerGenericPlayerDetection(ctx);
  },
});
