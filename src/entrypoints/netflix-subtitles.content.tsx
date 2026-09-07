import { createRoot } from "react-dom/client";
import cssText from "~/style.css?inline";
import { youtubeSubtitleCss } from "~/lib/utils/youtube-subtitle-styles";
import NetflixSubtitlesOverlay from "~/contents/netflix-subtitles";

const netflixSpecificCss = `
  /* ── Subtitle container position on Netflix ── */
  .watch-video .hk-sub__container,
  .VideoContainer .hk-sub__container {
    bottom: 110px;
    transition: bottom 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease;
  }

  .watch-video.active .hk-sub__container,
  .watch-video:hover .hk-sub__container,
  .watch-video--bottom-controls-container:hover ~ * .hk-sub__container {
    bottom: 170px;
  }

  .watch-video.inactive .hk-sub__container {
    bottom: 90px;
  }
`;

export default defineContentScript({
  matches: ["https://www.netflix.com/watch/*", "https://www.netflix.com/*"],
  cssInjectionMode: "ui",
  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: "hakkutsu-netflix-subtitles-host",
      position: "inline",
      anchor: () => {
        const netflixPlayer =
          document.querySelector<HTMLElement>(".watch-video") ||
          document.querySelector<HTMLElement>(".VideoContainer");
        return netflixPlayer || document.body;
      },
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
    ui.mount();
  },
});

