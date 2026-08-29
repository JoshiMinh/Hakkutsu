import type { PlasmoCSConfig } from "plasmo";

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  exclude_matches: ["*://*.saucenao.com/*", "*://saucenao.com/*"],
  all_frames: true,
};

const ImageOcr = () => {
  return null;
};

export default ImageOcr;
