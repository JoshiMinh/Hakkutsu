import { findPrimaryVideo } from "~/lib/services/video-runtime";

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
    let requested = false;

    const requestOverlay = () => {
      if (requested || !findPrimaryVideo()) return;
      requested = true;
      observer.disconnect();
      void chrome.runtime.sendMessage({ type: "MOUNT_GENERIC_SUBTITLES" }).catch(() => {
        requested = false;
        observer.observe(document.documentElement, { childList: true, subtree: true });
      });
    };

    const observer = new MutationObserver(requestOverlay);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener("loadedmetadata", requestOverlay, true);
    requestOverlay();

    ctx.onInvalidated(() => {
      observer.disconnect();
      document.removeEventListener("loadedmetadata", requestOverlay, true);
    });
  },
});
