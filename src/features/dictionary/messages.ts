import { getSettings } from "~/features/settings/settings-storage";
import { apiClient } from "~/features/dictionary/api-client";
import type { ExtensionMessage } from "~/shared/browser/messages";
import type { AnalyzeRequest } from "~/features/dictionary/types";
import { analyzeLocal, fetchDictionaryFallback } from "./background-analysis";
import { translateWithGoogle } from "./background-translation";

export async function handleDictionaryMessage(
  message: ExtensionMessage,
  sender?: chrome.runtime.MessageSender,
): Promise<ExtensionMessage> {
  switch (message.type) {
    case "ANALYZE_TEXT":

    case "ANALYZE_JAVI": {
      const request = message.payload as AnalyzeRequest;
      if (request.include_definitions === false) {
        try {
          const localResult = await analyzeLocal(request.text, false);
          return { type: "ANALYZE_RESULT", payload: localResult };
        } catch {
          // fall through to apiClient
        }
      }

      try {
        const result = await apiClient.analyzePhrase(request);
        return { type: "ANALYZE_RESULT", payload: result };
      } catch (llmErr) {
        console.warn(
          "[Hakkutsu] LLM analysis unavailable, using local tokenizer:",
          llmErr,
        );
        try {
          const fallbackResult = await analyzeLocal(request.text);
          return { type: "ANALYZE_RESULT", payload: fallbackResult };
        } catch (dictErr) {
          console.warn(
            "[Hakkutsu] Local tokenizer failed, using dictionary fallback:",
            dictErr,
          );
          try {
            const dictResult = await fetchDictionaryFallback(request.text);
            return { type: "ANALYZE_RESULT", payload: dictResult };
          } catch {
            return {
              type: "ANALYZE_RESULT",
              payload: {
                text: request.text,
                sentence_reading: "",
                token_count: 1,
                difficulty_score: null,
                difficulty_label: null,
                tokens: [
                  {
                    surface: request.text,
                    dictionary_form: request.text,
                    pos: "Word",
                    pos_detail: [],
                    reading: { hiragana: "", romaji: "" },
                    is_japanese: true,
                    jlpt_level: null,
                    frequency_rank: null,
                    definitions: [],
                  },
                ],
              },
            };
          }
        }
      }
    }

    case "ANALYZE_PHRASE": {
      const request = message.payload as AnalyzeRequest;
      try {
        const result = await apiClient.analyzePhrase(request);
        return { type: "ANALYZE_PHRASE_RESULT", payload: result };
      } catch (err) {
        console.warn(
          "[Hakkutsu] Phrase LLM analysis failed, fallback to dictionary:",
          err,
        );
        try {
          const dictResult = await fetchDictionaryFallback(request.text);
          return {
            type: "ANALYZE_PHRASE_RESULT",
            payload: {
              ...dictResult,
              translation:
                dictResult.tokens[0]?.definitions?.[0]?.glosses
                  ?.slice(0, 3)
                  .join(", ") || "",
            },
          };
        } catch {
          const fallbackResult = await analyzeLocal(request.text);
          return {
            type: "ANALYZE_PHRASE_RESULT",
            payload: { ...fallbackResult, translation: "" },
          };
        }
      }
    }

    case "TEXT_SELECTED":
      return { type: "IGNORED", payload: {} };

    case "TRANSLATE_TEXT": {
      const payload = message.payload as any;
      const settings = await getSettings();
      const targetLang = payload?.targetLang || settings.targetLanguage || "vi";

      const textList: string[] = Array.isArray(payload?.texts)
        ? payload.texts
        : typeof payload?.text === "string"
          ? [payload.text]
          : [];

      const translations = await Promise.all(
        textList.map((t) => translateWithGoogle(t, targetLang)),
      );

      return {
        type: "TRANSLATE_RESULT",
        payload: {
          source_language: "auto",
          target_language: targetLang,
          translation: translations[0] || "",
          translations,
          items: textList.map((t, idx) => ({
            index: idx,
            source: t,
            translation: translations[idx] || "",
            tokens: [],
          })),
        },
      };
    }
    default:
      return {
        type: "ERROR",
        payload: { error: `Unknown message type: ${message.type}` },
      };
  }
}
