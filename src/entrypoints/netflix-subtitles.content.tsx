import { createRoot } from "react-dom/client";
import cssText from "~/styles/global.css?inline";
import { youtubeSubtitleCss } from "~/features/subtitles/shared/overlay-styles";
import NetflixSubtitlesOverlay from "~/features/subtitles/netflix/netflix-subtitles";

import { netflixSpecificCss } from "~/features/subtitles/netflix/player-styles";

export default defineContentScript({
  matches: ["https://www.netflix.com/watch/*", "https://www.netflix.com/*"],
  cssInjectionMode: "ui",
  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: "hakkutsu-netflix-subtitles-host",
      position: "inline",
      anchor: ".watch-video, .VideoContainer",
      css: cssText + youtubeSubtitleCss + netflixSpecificCss,
      onMount: (container) => {
        const root = createRoot(container);
        root.render(<NetflixSubtitlesOverlay />);
        return root;
      },
      onRemove: (root) => {
        root?.unmount();
      },
    });
    ui.autoMount();
  },
});
