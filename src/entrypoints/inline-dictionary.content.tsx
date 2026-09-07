import { createRoot } from "react-dom/client";
import cssText from "~/style.css?inline";
import InlineDictionary from "~/contents/inline-dictionary";

const customCss =
  cssText +
  `
    :host {
      all: initial;
      z-index: 2147483647 !important;
      position: absolute !important;
      inset: 0 !important;
      pointer-events: none !important;
      /* Re-declare JLPT vars erased by all:initial */
      --hk-jlpt-n5: #22c55e;
      --hk-jlpt-n4: #3b82f6;
      --hk-jlpt-n3: #f59e0b;
      --hk-jlpt-n2: #ef4444;
      --hk-jlpt-n1: #a855f7;
    }
    .hk-popup {
      pointer-events: auto !important;
      background: #0d0d11 !important;
      border: 1px solid rgba(255, 255, 255, 0.14) !important;
      border-radius: 12px !important;
      box-shadow: 0 20px 48px -8px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.08) !important;
      color: #f4f4f5 !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
      overflow: hidden !important;
      display: flex !important;
      flex-direction: column !important;
      box-sizing: border-box !important;
    }
    .hk-popup *, .hk-popup *::before, .hk-popup *::after {
      box-sizing: border-box !important;
    }
    .hk-header {
      background: #141418 !important;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
      padding: 10px 14px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      flex-shrink: 0 !important;
    }
    .hk-header__logo {
      display: flex !important;
      align-items: center !important;
      gap: 8px !important;
    }
    .hk-header__title {
      font-size: 14px !important;
      font-weight: 700 !important;
      color: #f4f4f5 !important;
      margin: 0 !important;
      line-height: 1.2 !important;
    }
    .hk-content {
      padding: 14px !important;
      overflow-y: auto !important;
      flex: 1 !important;
      background: #0d0d11 !important;
    }
    /* Modern sleek custom dark scrollbar */
    .hk-popup *::-webkit-scrollbar,
    ::-webkit-scrollbar {
      width: 5px !important;
      height: 5px !important;
    }
    .hk-popup *::-webkit-scrollbar-track,
    ::-webkit-scrollbar-track {
      background: transparent !important;
    }
    .hk-popup *::-webkit-scrollbar-thumb,
    ::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.18) !important;
      border-radius: 9999px !important;
    }
    .hk-popup *::-webkit-scrollbar-thumb:hover,
    ::-webkit-scrollbar-thumb:hover {
      background: rgba(192, 132, 252, 0.5) !important;
    }
    * {
      scrollbar-width: thin !important;
      scrollbar-color: rgba(255, 255, 255, 0.18) transparent !important;
    }
  `;

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
        root.render(<InlineDictionary />);
        return root;
      },
      onRemove: (root) => {
        root?.unmount();
      },
    });
    ui.mount();
  },
});

