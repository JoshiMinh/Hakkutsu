import { createRoot } from "react-dom/client";
import cssText from "~/styles/global.css?inline";
import { youtubeSubtitleCss } from "~/features/subtitles/shared/overlay-styles";
import { genericPlayerCss } from "~/features/subtitles/generic/player-styles";
import GenericSubtitlesOverlay from "~/features/subtitles/generic/generic-subtitles";
import { findPrimaryVideo } from "~/features/subtitles/shared/video-runtime";

export default defineContentScript({
  matches: ["<all_urls>"],
  excludeMatches: [
    "*://*.netflix.com/*",
    "*://netflix.com/*",
    "*://*.youtube.com/*",
    "*://youtube.com/*",
  ],
  registration: "runtime",
  cssInjectionMode: "ui",
  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: "hakkutsu-generic-subtitles-host",
      position: "inline",
      anchor: () => {
        const video = findPrimaryVideo() || document.querySelector("video");
        return video?.parentElement || video || document.body;
      },
      css: cssText + youtubeSubtitleCss + genericPlayerCss,
      onMount: (container) => {
        const root = createRoot(container);
        root.render(<GenericSubtitlesOverlay />);
        return root;
      },
      onRemove: (root) => {
        root?.unmount();
      },
    });
    ui.mount();
  },
});
