import { useSettingsStore } from "~lib/utils/settings";
import type { AnalyzeResponse, PhraseAnalyzeResponse, WebTranslateResponse } from "~lib/types";

export class LlmServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmServiceError";
  }
}

/**
 * Handles LLM API requests directly from the browser extension,
 * bypassing the need for a backend server.
 */
class LlmService {
  private getSettings() {
    // Plasmo store state can be retrieved statically if needed, 
    // but in background we might need to use Storage API.
    // For simplicity, we assume we fetch it via the store or pass it.
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
    
    // Convert OpenAI JSON schema format to Gemini's format if needed, 
    // or just rely on system prompt instructions for JSON.
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
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
      throw new LlmServiceError(`Gemini API Error: ${err}`);
    }

    const data = await res.json();
    return data.candidates[0].content.parts[0].text;
  }

  private async callOpenAI(apiKey: string, baseUrl: string, systemPrompt: string, userPrompt: string, responseFormat?: object): Promise<string> {
    if (!apiKey) throw new LlmServiceError("API Key is missing");
    
    const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
    
    const payload: any = {
      model: "gpt-4o-mini", // fallback model, should be configurable but hardcoded for now
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

  async analyzeText(text: string, isPhrase: boolean = false): Promise<any> {
    const systemPrompt = `You are an expert Japanese to Vietnamese translator and linguist.
Analyze the following Japanese text. Break it down into tokens.
Return a JSON object with:
- "translation": The Vietnamese translation of the text.
- "tokens": A list of token objects, each containing:
  - "text": The Japanese word/token.
  - "reading": Kana reading.
  - "pos": Part of speech.
  - "meaning": Vietnamese meaning of the token.
  - "base_form": Dictionary form of the word.
`;
    const userPrompt = text;
    
    const format = { type: "json_object" };
    const resultText = await this.callApi(systemPrompt, userPrompt, format);
    
    try {
      return JSON.parse(resultText);
    } catch (e) {
      throw new LlmServiceError("Failed to parse LLM response as JSON");
    }
  }

  async translateWebpage(texts: string[], pageUrl: string, pageTitle: string): Promise<WebTranslateResponse> {
    const systemPrompt = `You are a Japanese to Vietnamese translator.
Translate the following array of texts.
Return a JSON object with a "translations" array, containing objects with "id" (matching the input index) and "text" (the translation).`;
    
    const userPrompt = JSON.stringify({ texts: texts.map((t, i) => ({ id: i, text: t })) });
    const format = { type: "json_object" };
    
    const resultText = await this.callApi(systemPrompt, userPrompt, format);
    try {
      const parsed = JSON.parse(resultText);
      return parsed; // Returns { translations: [{ id, text }] }
    } catch (e) {
      throw new LlmServiceError("Failed to parse LLM response as JSON");
    }
  }
}

export const llmService = new LlmService();
