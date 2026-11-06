import { createSubtitleRequests } from "./subtitle-requests";
import { cleanSubtitleText } from "./subtitle-parsers";

const translations = createSubtitleRequests<string>(async (text, language) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      chrome.runtime.sendMessage({ type: "TRANSLATE_TEXT", payload: { text, targetLang: language } }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Subtitle translation timed out")), 10000); }),
    ]);
    const translation = response?.type === "TRANSLATE_RESULT" && typeof response.payload?.translation === "string"
      ? cleanSubtitleText(response.payload.translation) : "";
    if (!translation) throw new Error("Subtitle translation unavailable");
    return translation;
  } finally { clearTimeout(timer); }
});

export const requestSubtitleTranslation = translations.request;
export const peekSubtitleTranslation = translations.peek;
