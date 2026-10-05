import { createRoot } from "react-dom/client";
import cssText from "~/styles/global.css?inline";
import { youtubeSubtitleCss } from "~/features/subtitles/shared/overlay-styles";
import YouTubeSubtitlesOverlay from "~/features/subtitles/youtube/youtube-subtitles";

export default defineContentScript({
  matches: ["https://www.youtube.com/*", "https://m.youtube.com/*"],
  cssInjectionMode: "ui",
  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: "hakkutsu-youtube-subtitles-host",
      position: "inline",
      anchor: "#movie_player, .html5-video-player",
      css: cssText + youtubeSubtitleCss,
      onMount: (container) => {
        const root = createRoot(container);
        root.render(<YouTubeSubtitlesOverlay />);
        return root;
      },
      onRemove: (root) => {
        root?.unmount();
      },
    });
    ui.autoMount();
  },
});
