import type { ExtensionMessage } from "~/shared/browser/messages";
import { fetchIrasutoyaImagesDirect } from "~/features/dictionary/irasutoya-service";

export async function handleDictionaryImage(
  message: ExtensionMessage,
): Promise<ExtensionMessage> {
  const { query, targetLang, meaning } = (message.payload || {}) as {
    query?: string;
    targetLang?: string;
    meaning?: string;
    url?: string;
  };
  if (query) {
    try {
      const images = await fetchIrasutoyaImagesDirect(
        query,
        targetLang,
        meaning,
      );
      return { type: "FETCH_IMAGE_RESULT", payload: { images } };
    } catch (err: any) {
      return { type: "FETCH_IMAGE_RESULT", payload: { images: [] } };
    }
  }
  return { type: "FETCH_IMAGE_RESULT", payload: { images: [] } };
}
