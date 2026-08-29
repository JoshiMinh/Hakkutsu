/**
 * Background service worker.
 *
 * Routes messages between content scripts and services,
 * manages extension state and API proxying.
 */

import { getSettings } from "~lib/services/storage";
import { apiClient } from "~lib/services/api-client";
import { localSrs } from "~lib/services/local-srs";
import { ankiClient } from "~lib/services/anki-connect";
import { localOcrService } from "~lib/services/ocr-service";
import { llmService } from "~lib/services/llm-service";
import type {
  ExtensionMessage,
  AnalyzeRequest,
  AnkiExportData,
  AnalyzeResponse,
  TokenAnalysis,
  DictionaryEntry
} from "~lib/types";
import { tokenize } from "~lib/services/local-tokenizer";
import { searchDictionary } from "~lib/services/local-lookup";
import { getHanViet } from "~lib/utils/hanviet-dict";
import { containsJapanese, katakanaToHiragana } from "~lib/utils/japanese";
import { lookupWord } from "~lib/services/dictionary-lookup";
import { predictJlpt } from "~lib/utils/jlpt-classifier";

// Fallback logic for public dictionary lookups
async function fetchDictionaryFallback(text: string): Promise<AnalyzeResponse> {
  const settings = await getSettings();
  const targetLang = settings.targetLanguage || "vi";
  const info = await lookupWord(text, targetLang);
  const isVietnamese = targetLang === "vi";

  return {
    text,
    sentence_reading: info.reading || text,
    token_count: 1,
    difficulty_score: null,
    difficulty_label: null,
    tokens: [
      {
        surface: text,
        dictionary_form: text,
        pos: "Word",
        pos_detail: [],
        reading: { hiragana: info.reading || "", romaji: "" },
        is_japanese: true,
        jlpt_level: info.jlpt || null,
        frequency_rank: null,
        vietnamese_sound: isVietnamese ? (info.hanviet || getHanViet(text)) : undefined,
        definitions: info.meaning ? [{ dictionary: info.source || "Dict", glosses: [info.meaning], pos: ["Word"], field: null, misc: [] }] : []
      }
    ]
  };
}

async function analyzeLocal(text: string): Promise<AnalyzeResponse> {
  const tokens = await tokenize(text);
  const settings = await getSettings();
  const targetLang = settings.targetLanguage || "vi";
  const isVietnamese = targetLang === "vi";

  const tokenAnalyses: TokenAnalysis[] = await Promise.all(
    tokens.map(async (t) => {
      const surface = t.surface_form;
      const is_jp = containsJapanese(surface);
      if (!is_jp) {
        return {
          surface,
          dictionary_form: surface,
          pos: t.pos,
          pos_detail: [],
          reading: { hiragana: "", romaji: "" },
          is_japanese: false,
          jlpt_level: null,
          frequency_rank: null,
          definitions: [],
        };
      }

      const dictEntries = await searchDictionary(surface);
      const firstEntry = dictEntries[0];
      const kanjiForm = firstEntry?.kanjiElements?.[0] || surface;
      const rawReading = firstEntry?.readingElements?.[0] || (t as any).reading || "";
      const reading = katakanaToHiragana(rawReading);

      return {
        surface,
        dictionary_form: kanjiForm,
        pos: t.pos,
        pos_detail: [],
        reading: { hiragana: reading, romaji: "" },
        is_japanese: true,
        jlpt_level: firstEntry?.jlpt || predictJlpt(surface),
        frequency_rank: null,
        vietnamese_sound: isVietnamese ? getHanViet(surface) : undefined,
        definitions: dictEntries.flatMap((d) =>
          d.senses.map((s) => ({
            dictionary: "JMdict",
            glosses: s.glosses,
            pos: s.partOfSpeech || ["Word"],
            field: null,
            misc: [],
          }))
        ),
      };
    })
  );

  return {
    text,
    sentence_reading: text,
    tokens: tokenAnalyses,
    token_count: tokens.length,
    difficulty_score: null,
    difficulty_label: null,
  };
}

// Listen for messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) =>
      sendResponse({
        type: "ERROR" as const,
        payload: { error: error.message },
      })
    );

  // Return true to indicate we'll respond asynchronously
  return true;
});

async function translateWithGoogle(text: string, targetLang: string): Promise<string> {
  const clean = text.trim();
  if (!clean) return "";

  const tl = targetLang.startsWith("vi")
    ? "vi"
    : targetLang.startsWith("en")
      ? "en"
      : targetLang.startsWith("ja")
        ? "ja"
        : targetLang;

  // 1. Primary: gtx single endpoint with browser headers
  try {
    const url1 = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(clean)}`;
    const res1 = await fetch(url1, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: "https://translate.google.com/",
      },
    });
    if (res1.ok) {
      const data = await res1.json();
      if (Array.isArray(data) && data[0]) {
        const trans = data[0].map((item: any) => item[0]).filter(Boolean).join("");
        if (trans) return trans;
      }
    }
  } catch {}

  // 2. Secondary fallback: dict-chrome-ex client
  try {
    const url2 = `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=${encodeURIComponent(tl)}&q=${encodeURIComponent(clean)}`;
    const res2 = await fetch(url2, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    if (res2.ok) {
      const data = await res2.json();
      if (Array.isArray(data) && data[0]) {
        return String(data[0]);
      } else if (typeof data === "string") {
        return data;
      }
    }
  } catch {}

  return "";
}

async function handleMessage(
  message: ExtensionMessage,
  sender?: chrome.runtime.MessageSender
): Promise<ExtensionMessage> {
  switch (message.type) {
    case "ANALYZE_TEXT":
    case "ANALYZE_JAVI": {
      const request = message.payload as AnalyzeRequest;
      if (request.include_definitions === false) {
        try {
          const localResult = await analyzeLocal(request.text);
          return { type: "ANALYZE_RESULT", payload: localResult };
        } catch {
          // fall through to apiClient
        }
      }

      try {
        const result = await apiClient.analyzePhrase(request);
        return { type: "ANALYZE_RESULT", payload: result };
      } catch (llmErr) {
        console.warn("[Hakkutsu] LLM analysis unavailable, using local tokenizer:", llmErr);
        try {
          const fallbackResult = await analyzeLocal(request.text);
          return { type: "ANALYZE_RESULT", payload: fallbackResult };
        } catch (dictErr) {
          console.warn("[Hakkutsu] Local tokenizer failed, using dictionary fallback:", dictErr);
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
                    definitions: []
                  }
                ]
              }
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
        console.warn("[Hakkutsu] Phrase LLM analysis failed, fallback to dictionary:", err);
        try {
          const dictResult = await fetchDictionaryFallback(request.text);
          return {
            type: "ANALYZE_PHRASE_RESULT",
            payload: {
              ...dictResult,
              translation: dictResult.tokens[0]?.definitions?.[0]?.glosses?.slice(0, 3).join(", ") || ""
            }
          };
        } catch {
          const fallbackResult = await analyzeLocal(request.text);
          return {
            type: "ANALYZE_PHRASE_RESULT",
            payload: { ...fallbackResult, translation: "" }
          };
        }
      }
    }

    case "TEXT_SELECTED":
      return { type: "IGNORED", payload: {} };

    case "EXPORT_ANKI": {
      const data = message.payload as AnkiExportData;
      const settings = await getSettings();
      const noteId = await ankiClient.exportVocabulary(
        data,
        settings.ankiDeck,
        settings.ankiModel
      );
      return { type: "ANKI_RESULT", payload: { noteId } };
    }

    case "ADD_SRS_CARD": {
      const data = message.payload as { word: string; reading?: string; meaning?: string; sentence?: string };
      const card = await localSrs.addSrsCard(data);
      return { type: "SRS_RESULT", payload: card };
    }

    case "CHECK_ANKI": {
      const connected = await ankiClient.isConnected();
      return { type: "ANKI_STATUS", payload: { connected } };
    }

    case "GET_SETTINGS": {
      const settings = await getSettings();
      return { type: "GET_SETTINGS", payload: settings };
    }

    case "START_OCR_FLOW": {
      const { tabId } = (message.payload as { tabId?: number }) || {};
      if (tabId) {
        await triggerOcrFlow(tabId);
      } else {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]?.id) triggerOcrFlow(tabs[0].id);
        });
      }
      return { type: "START_OCR_FLOW_RESULT", payload: {} };
    }

    case "CAPTURE_SCREENSHOT": {
      return new Promise((resolve, reject) => {
        const windowId = sender.tab?.windowId;
        chrome.tabs.captureVisibleTab(
          windowId !== undefined ? windowId : null,
          { format: "png" },
          (dataUrl) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve({ type: "SCREENSHOT_RESULT", payload: { dataUrl } });
            }
          }
        );
      });
    }

    case "FETCH_TTS_AUDIO": {
      const { text, lang = "ja" } = message.payload as { text: string; lang?: string };
      try {
        const cleanText = text.trim().slice(0, 200);
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(cleanText)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Google TTS fetch returned status ${res.status}`);
        const arrayBuffer = await res.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let binary = "";
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);
        const dataUrl = `data:audio/mpeg;base64,${base64}`;
        return { type: "TTS_AUDIO_RESULT", payload: { dataUrl } };
      } catch (err: any) {
        console.warn("[Hakkutsu Background] TTS audio fetch error:", err);
        throw new Error(`Failed to fetch TTS audio: ${err.message || err}`);
      }
    }

    case "FETCH_IMAGE": {
      const { url } = message.payload as { url: string };
      try {
        const res = await fetch(url);
        const blob = await res.blob();
        const reader = new FileReader();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        return { type: "FETCH_IMAGE_RESULT", payload: { dataUrl } };
      } catch (err: any) {
        throw new Error(`Failed to fetch image: ${err.message || err}`);
      }
    }

    case "FETCH_TIMEDTEXT_URL": {
      const { url } = message.payload as { url: string };
      try {
        const res = await fetch(url);
        if (res.ok) {
          const text = await res.text();
          return { type: "FETCH_TIMEDTEXT_URL_RESULT", payload: { success: true, text } };
        }
        return { type: "FETCH_TIMEDTEXT_URL_RESULT", payload: { success: false, error: `HTTP ${res.status}` } };
      } catch (err: any) {
        return { type: "FETCH_TIMEDTEXT_URL_RESULT", payload: { success: false, error: err.message || String(err) } };
      }
    }

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
        textList.map((t) => translateWithGoogle(t, targetLang))
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

    case "OCR_IMAGE": {
      const { image_data, language } = message.payload as { image_data: string; language?: string };
      const settings = await getSettings();
      const targetLang = settings.targetLanguage || "vi";

      let rawText = "";
      try {
        rawText = await localOcrService.recognizeImage(image_data);
      } catch (error: any) {
        throw new Error(`Nhận diện OCR thất bại: ${error.message || error}`);
      }

      if (!rawText || !rawText.trim()) {
        throw new Error("Không tìm thấy chữ tiếng Nhật trong vùng ảnh được chọn.");
      }

      // Automatically analyze recognized text through Hakkutsu dictionary & translation pipeline
      let analysis: any = null;
      try {
        analysis = await llmService.analyzeText(rawText, false, targetLang);
      } catch (analErr) {
        console.warn("[Hakkutsu] OCR text analysis warning:", analErr);
      }

      return {
        type: "OCR_RESULT",
        payload: {
          full_text: rawText,
          engine: "local",
          tokens: analysis?.tokens || null,
          translation: analysis?.translation || "",
          regions: [{ text: rawText, confidence: 1.0, bbox: null }],
          language: language || "jpn"
        }
      };
    }

    case "OPEN_APP": {
      chrome.tabs.create({ url: chrome.runtime.getURL("app.html") });
      return { type: "OPEN_APP_RESULT", payload: {} };
    }

    default:
      return { type: "ERROR", payload: { error: `Unknown message type: ${message.type}` } };
  }
}

async function triggerOcrFlow(tabId: number) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "START_SCREENSHOT_FLOW" });
  } catch (err) {
    console.warn("[Hakkutsu Background] Content script not responding on tab, attempting injection:", tabId, err);
    try {
      if (chrome.scripting) {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ["contents/screenshot-overlay.js"]
        });
        setTimeout(() => {
          chrome.tabs.sendMessage(tabId, { type: "START_SCREENSHOT_FLOW" });
        }, 250);
      }
    } catch (injErr) {
      console.error("[Hakkutsu Background] Script injection error:", injErr);
    }
  }
}

chrome.commands.onCommand.addListener((command) => {
  if (command === "start-ocr") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        triggerOcrFlow(tabs[0].id);
      }
    });
  }
});

export {};
