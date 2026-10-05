import { createRoot } from "react-dom/client";
import { customCss } from "~/features/dictionary/host-styles";
import InlineDictionary from "~/features/dictionary/inline-dictionary";
import { ImmersionDensityBadge } from "~/features/analytics/immersion-density-badge";

export default defineContentScript({
  matches: ["<all_urls>"],
  excludeMatches: ["*://*.saucenao.com/*", "*://saucenao.com/*"],
  allFrames: true,
  cssInjectionMode: "ui",
  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: "hakkutsu-inline-dictionary-host",
      position: "inline",
      anchor: "body",
      css: customCss,
      onMount: (container) => {
        const root = createRoot(container);
        root.render(
          <>
            <ImmersionDensityBadge />
            <InlineDictionary />
          </>
        );
        return root;
      },
      onRemove: (root) => {
        root?.unmount();
      },
    });
    ui.mount();
  },
});

