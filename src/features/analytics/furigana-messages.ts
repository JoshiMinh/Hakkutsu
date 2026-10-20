import { getDB, searchDictionary } from "~/features/dictionary/local-lookup";
import { localSrs } from "~/features/srs/local-srs";
import type { ExtensionMessage } from "~/shared/browser/messages";
import { learnedVocabulary } from "./page-text";
import { resolveFuriganaTexts } from "./furigana-readings";

export async function handleFuriganaMessage(message: ExtensionMessage): Promise<ExtensionMessage> {
  if (message.type === "GET_LEARNED_VOCABULARY") {
    return { type: "LEARNED_VOCABULARY_RESULT", payload: {
      words: learnedVocabulary(await localSrs.getAllSrsCards()),
    } };
  }
  const { texts } = (message.payload || {}) as { texts?: unknown };
  if (!Array.isArray(texts) || texts.length > 8 || texts.some(text => typeof text !== "string" || text.length > 2000)) {
    throw new Error("Invalid furigana batch");
  }
  const db = await getDB();
  if (await db.count("jmdict") === 0) {
    throw new Error("Install a local dictionary in Settings before enabling furigana.");
  }
  return { type: "FURIGANA_READINGS_RESULT", payload: {
    readings: await resolveFuriganaTexts(texts, searchDictionary),
  } };
}
