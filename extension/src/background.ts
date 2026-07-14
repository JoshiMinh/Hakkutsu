/**
 * Background service worker.
 *
 * Routes messages between content scripts and services,
 * manages extension state and API proxying.
 */

import { getSettings } from "~services/storage";
import { apiClient } from "~services/api-client";
import { ankiClient } from "~services/anki-connect";
import type { ExtensionMessage, AnalyzeRequest, SubtitleRequest, AnkiExportData, AnalyzeResponse } from "~types";

// Fallback logic for when the local backend is offline
async function fetchFromJisho(text: string): Promise<AnalyzeResponse> {
  const url = `https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(text)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Jisho API failed");
  const json = await res.json();
  
  if (!json.data || json.data.length === 0) {
    throw new Error("No results found in public dictionary");
  }

  const data = json.data;
  const mainEntry = data[0];
  
  return {
    text,
    sentence_reading: mainEntry.japanese?.[0]?.reading || "",
    token_count: 1,
    difficulty_score: null,
    difficulty_label: null,
    tokens: [
      {
        surface: text,
        dictionary_form: mainEntry.japanese?.[0]?.word || mainEntry.slug || text,
        pos: mainEntry.senses?.[0]?.parts_of_speech?.[0] || "Unknown",
        pos_detail: [],
        reading: {
          hiragana: mainEntry.japanese?.[0]?.reading || "",
          romaji: ""
        },
        is_japanese: true,
        frequency_rank: mainEntry.is_common ? 1 : undefined,
        jlpt_level: mainEntry.jlpt?.length ? mainEntry.jlpt[0].replace(/jlpt-/i, "").toUpperCase() : null,
        definitions: data.slice(0, 3).map((d: any) => ({
          dictionary: "Jisho",
          glosses: d.senses.flatMap((s: any) => s.english_definitions)
        }))
      }
    ]
  };
}

// Initialize API client with stored settings
async function initializeApiClient(): Promise<void> {
  const settings = await getSettings();
  apiClient.setBaseUrl(settings.backendUrl);
}

initializeApiClient();

// Listen for messages from popup and content scripts
chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    handleMessage(message)
      .then(sendResponse)
      .catch((error) =>
        sendResponse({
          type: "ERROR" as const,
          payload: { error: error.message },
        })
      );

    // Return true to indicate we'll respond asynchronously
    return true;
  }
);

async function handleMessage(message: ExtensionMessage): Promise<ExtensionMessage> {
  switch (message.type) {
    case "ANALYZE_TEXT": {
      const request = message.payload as AnalyzeRequest;
      try {
        const result = await apiClient.analyzeText(request);
        return { type: "ANALYZE_RESULT", payload: result };
      } catch (err) {
        console.warn("Backend failed, falling back to Jisho API for", request.text);
        try {
          // If the text is long (like a subtitle sentence), Jisho might fail or return junk.
          // But for a double-clicked single word, Jisho works perfectly.
          const fallbackResult = await fetchFromJisho(request.text);
          return { type: "ANALYZE_RESULT", payload: fallbackResult };
        } catch (fallbackErr) {
          // If fallback fails, throw the original backend error
          throw err;
        }
      }
    }

    case "TEXT_SELECTED":
      // Handled by popup if open. We just return success to avoid background errors.
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

    case "CHECK_ANKI": {
      const connected = await ankiClient.isConnected();
      return { type: "ANKI_STATUS", payload: { connected } };
    }

    case "GET_SETTINGS": {
      const settings = await getSettings();
      return { type: "GET_SETTINGS", payload: settings };
    }

    default:
      return { type: "ERROR", payload: { error: `Unknown message type: ${message.type}` } };
  }
}

export {};
