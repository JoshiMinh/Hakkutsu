import type { ExtensionMessage } from "~/shared/browser/messages";
import { localSrs } from "~/features/srs/local-srs";
import { densityKnowledge, resolveDensityVocabulary } from "./density-vocabulary";

export async function handleDensityMessage(message: ExtensionMessage): Promise<ExtensionMessage> {
  if (message.type === "GET_DENSITY_KNOWLEDGE") {
    return { type: "DENSITY_KNOWLEDGE_RESULT", payload: densityKnowledge(await localSrs.getAllSrsCards()) };
  }
  const { texts } = (message.payload || {}) as { texts?: unknown };
  if (!Array.isArray(texts) || texts.length > 8 || texts.some(text => typeof text !== "string" || text.length > 2000)) {
    throw new Error("Invalid density batch");
  }
  return { type: "DENSITY_VOCABULARY_RESULT", payload: { words: await resolveDensityVocabulary(texts) } };
}
