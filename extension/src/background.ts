/**
 * Background service worker.
 *
 * Routes messages between content scripts and services,
 * manages extension state and API proxying.
 */

import { getSettings } from "~services/storage";
import { apiClient } from "~services/api-client";
import { ankiClient } from "~services/anki-connect";
import type { ExtensionMessage, AnalyzeRequest, SubtitleRequest, AnkiExportData } from "~types";

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
      const result = await apiClient.analyzeText(request);
      return { type: "ANALYZE_RESULT", payload: result };
    }

    case "GET_SUBTITLES": {
      const request = message.payload as SubtitleRequest;
      const result = await apiClient.getSubtitles(request);
      return { type: "SUBTITLES_RESULT", payload: result };
    }

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
