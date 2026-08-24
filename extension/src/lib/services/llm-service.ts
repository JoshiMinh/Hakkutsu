import { useSettingsStore } from "~lib/utils/settings";
import type { AnalyzeResponse, PhraseAnalyzeResponse, WebTranslateResponse } from "~lib/types";
import { googleTranslateService } from "./google-translate";
import { lookupWord } from "./dictionary-lookup";

export class LlmServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmServiceError";
  }
}

/**
 * Handles LLM API requests directly from the browser extension,
 * with automatic Google Translate fallback when LLM is unavailable.
 */
class LlmService {
  private getSettings() {
    const state = useSettingsStore.getState();
    return state.settings;
  }

  private async callApi(systemPrompt: string, userPrompt: string, responseFormat?: object): Promise<string> {
    const settings = this.getSettings();
    if (settings.llmProvider === "gemini") {
      return this.callGemini(settings.llmApiKey, systemPrompt, userPrompt, responseFormat);
    } else if (settings.llmProvider === "openai") {
      return this.callOpenAI(settings.llmApiKey, "https://api.openai.com/v1", systemPrompt, userPrompt, responseFormat);
    } else if (settings.llmProvider === "custom") {
      if (!settings.llmCustomUrl) throw new LlmServiceError("Custom LLM URL is not configured");
      return this.callOpenAI(settings.llmApiKey, settings.llmCustomUrl, systemPrompt, userPrompt, responseFormat);
    }
    throw new LlmServiceError("LLM Provider is not configured");
  }

  private async callGemini(apiKey: string, systemPrompt: string, userPrompt: string, responseFormat?: object): Promise<string> {
    if (!apiKey) throw new LlmServiceError("Gemini API Key is missing");
    
    const models = ["gemini-2.0-flash", "gemini-1.5-flash"];
    let lastError: Error | null = null;

    for (const model of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const payload: any = {
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          generationConfig: {
            temperature: 0.1,
          }
        };
        
        if (responseFormat) {
          payload.generationConfig.responseMimeType = "application/json";
        }

        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          const err = await res.text();
          throw new LlmServiceError(`Gemini API (${model}) Error: ${err}`);
        }

        const data = await res.json();
        return data.candidates[0].content.parts[0].text;
      } catch (err) {
        lastError = err instanceof Error ? err : new LlmServiceError(String(err));
      }
    }

    throw lastError || new LlmServiceError("Gemini API call failed");
  }

  private async callOpenAI(apiKey: string, baseUrl: string, systemPrompt: string, userPrompt: string, responseFormat?: object): Promise<string> {
    if (!apiKey) throw new LlmServiceError("API Key is missing");
    
    const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
    
    const payload: any = {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.1
    };

    if (responseFormat) {
      payload.response_format = responseFormat;
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.text();
      throw new LlmServiceError(`OpenAI API Error: ${err}`);
    }

    const data = await res.json();
    return data.choices[0].message.content;
  }

  async analyzeText(text: string, isPhrase: boolean = false, targetLang: string = "vi"): Promise<any> {
    const langName = targetLang === "en" ? "English" : "Vietnamese";
    const settings = this.getSettings();

    // Check if we have an API key configured. If not, bypass to Google Translate fallback directly.
    if (settings.llmApiKey && settings.llmApiKey.trim()) {
      try {
        const systemPrompt = `You are an expert Japanese to ${langName} translator and linguist.
Analyze the following Japanese text. Break it down into tokens.
Return a JSON object with:
- "translation": The ${langName} translation of the text.
- "tokens": A list of token objects, each containing:
  - "surface": The exact Japanese word/token snippet.
  - "reading": Kana reading (Hiragana).
  - "pos": Part of speech in English.
  - "meaning": ${langName} meaning of the token.
  - "dictionary_form": Dictionary form / lemma of the word.
`;
        const userPrompt = text;
        const format = { type: "json_object" };
        const resultText = await this.callApi(systemPrompt, userPrompt, format);
        const parsed = JSON.parse(resultText);
        return { ...parsed, usedFallback: false };
      } catch (err) {
        console.warn("[Hakkutsu] LLM text analysis failed, falling back to Google Translate:", err);
      }
    }

    // Google Translate + Local Tokenizer & Dictionary fallback
    const translation = await googleTranslateService.translate(text, targetLang, "ja");
    
    try {
      const { katakanaToHiragana, containsJapanese, hasKanji, segmentJapaneseTokens } = await import("~lib/utils/japanese");
      const { getHanViet } = await import("~lib/utils/hanviet-dict");
      const { predictJlpt } = await import("~lib/utils/jlpt-classifier");

      let tokenList: Array<{ surface: string; base_form: string; reading?: string; pos?: string }> = [];

      try {
        const { tokenize } = await import("./local-tokenizer");
        const kTokens = await tokenize(text);
        if (kTokens && kTokens.length > 0) {
          tokenList = kTokens.map(t => ({ surface: t.surface_form, base_form: t.base_form || t.surface_form, reading: t.reading, pos: t.pos }));
        }
      } catch {
        // Kuromoji not ready or offline
      }

      if (tokenList.length === 0) {
        const segs = segmentJapaneseTokens(text);
        tokenList = segs.map(s => ({ surface: s, base_form: s, pos: "Word" }));
      }

      if (tokenList && tokenList.length > 0) {
        const tokens = await Promise.all(
          tokenList.map(async (t) => {
            const surface = t.surface;
            const baseForm = t.base_form || surface;
            const isJp = containsJapanese(surface);

            if (!isJp) {
              return {
                surface,
                reading: surface,
                pos: t.pos || "Symbol",
                meaning: "",
                dictionary_form: baseForm,
                is_japanese: false,
              };
            }

            const dict = await lookupWord(baseForm, targetLang);
            const readingKana = t.reading
              ? katakanaToHiragana(t.reading)
              : (hasKanji(baseForm) ? (dict.reading || surface) : surface);

            return {
              surface,
              reading: readingKana,
              pos: t.pos || "Word",
              meaning: dict.meaning || "",
              dictionary_form: baseForm,
              jlpt: dict.jlpt || predictJlpt(baseForm),
              vietnamese_sound: targetLang === "vi" && hasKanji(baseForm) ? (dict.hanviet || getHanViet(baseForm || surface)) : undefined,
              is_japanese: true,
            };
          })
        );

        return {
          translation,
          usedFallback: true,
          tokens,
        };
      }
    } catch (e) {
      console.warn("[Hakkutsu] Fallback local tokenization error:", e);
    }

    const dictLookup = await lookupWord(text, targetLang);

    return {
      translation,
      usedFallback: true,
      tokens: [
        {
          surface: text,
          reading: dictLookup.reading || text,
          pos: "Word",
          meaning: dictLookup.meaning || translation,
          dictionary_form: text,
          jlpt: dictLookup.jlpt,
          vietnamese_sound: targetLang === "vi" ? dictLookup.hanviet : undefined,
        },
      ],
    };
  }

  async translateWebpage(
    texts: string[],
    pageUrl: string,
    pageTitle: string,
    targetLang: string = "vi"
  ): Promise<WebTranslateResponse> {
    const langName = targetLang === "en" ? "English" : "Vietnamese";
    const settings = this.getSettings();

    if (settings.llmApiKey && settings.llmApiKey.trim()) {
      try {
        const systemPrompt = `You are a Japanese to ${langName} translator.
Translate the following array of texts.
Return a JSON object with a "translations" array, containing objects with "id" (matching the input index) and "text" (the translation).`;
        
        const userPrompt = JSON.stringify({ texts: texts.map((t, i) => ({ id: i, text: t })) });
        const format = { type: "json_object" };
        
        const resultText = await this.callApi(systemPrompt, userPrompt, format);
        const parsed = JSON.parse(resultText);
        return parsed;
      } catch (err) {
        console.warn("[Hakkutsu] LLM webpage translation failed, falling back to Google Translate:", err);
      }
    }

    // Google Translate batch fallback
    const translations = await googleTranslateService.translateBatch(texts, targetLang, "ja");
    return { translations };
  }
}

export const llmService = new LlmService();
