import type { ExtensionMessage } from "~/shared/browser/messages";
import { installTranscriptPanelRouter } from "~/features/subtitles/shared/transcript-panel-router";
import { handleDictionaryMessage } from "~/features/dictionary/messages";
import { handleAnkiMessage } from "~/features/anki/messages";
import { handleSrsMessage } from "~/features/srs/messages";
import { handleSettingsMessage } from "~/features/settings/messages";
import { handleOcrMessage } from "~/features/ocr/messages";
import { handleAnalyticsMessage } from "~/features/analytics/messages";
import { handleGenericSubtitleMessage } from "~/features/subtitles/generic/messages";
import { handleSubtitleMessage } from "~/features/subtitles/shared/messages";
import { handleAudioMessage } from "~/shared/browser/audio-messages";
import { handleDictionaryImage } from "~/features/dictionary/image-messages";
import { handleOcrImage } from "~/features/ocr/image-messages";

export function registerBackground() {
  const closeTranscriptPanel = installTranscriptPanelRouter();
  // Listen for messages from popup and content scripts
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (
      message?.type === "RUN_MANGA_OCR_OFFSCREEN" ||
      message?.type === "RUN_MANGA_OCR_BATCH_OFFSCREEN"
    )
      return false;
    if (
      /^TRANSCRIPT_(SNAPSHOT|CUE|UNAVAILABLE|LOOKUP_STATE)$/.test(
        message?.type || "",
      )
    )
      return false;
    if (message?.type === "OPEN_TRANSCRIPT_PANEL") {
      const tabId = sender.tab?.id;
      if (tabId !== undefined && chrome.sidePanel?.open) {
        // Do not await anything before open(): Chrome requires a user gesture.
        chrome.sidePanel
          .open({ tabId })
          .then(() => sendResponse({ ok: true }))
          .catch((error) =>
            sendResponse({ type: "ERROR", payload: { error: error.message } }),
          );
        return true;
      }
      sendResponse({
        type: "ERROR",
        payload: {
          error:
            "Open Video Script from the Hakkutsu toolbar popup to use your browser's sidebar.",
        },
      });
      return false;
    }
    if (message?.type === "CLOSE_TRANSCRIPT_PANEL") {
      if (sender.tab?.id !== undefined) closeTranscriptPanel(sender.tab.id);
      sendResponse({ ok: true });
      return false;
    }
    handleMessage(message, sender)
      .then(sendResponse)
      .catch((error) =>
        sendResponse({
          type: "ERROR" as const,
          payload: { error: error.message },
        }),
      );

    // Return true to indicate we'll respond asynchronously
    return true;
  });
}

export async function handleMessage(
  message: ExtensionMessage,
  sender?: chrome.runtime.MessageSender,
): Promise<ExtensionMessage> {
  switch (message.type) {
    case "ANALYZE_TEXT":
    case "ANALYZE_JAVI":
    case "ANALYZE_PHRASE":
    case "TEXT_SELECTED":
    case "TRANSLATE_TEXT":
      return handleDictionaryMessage(message, sender);
    case "EXPORT_ANKI":
    case "CHECK_ANKI":
      return handleAnkiMessage(message, sender);
    case "ADD_SRS_CARD":
    case "CHECK_CARD_EXISTS":
    case "REMOVE_SRS_CARD":
    case "RESET_LEECH_STATUS":
    case "GET_SMART_DECK_FILTERS":
    case "GET_ALL_SRS_CARDS":
      return handleSrsMessage(message, sender);
    case "GET_SETTINGS":
      return handleSettingsMessage(message, sender);
    case "RUN_MANGA_OCR":
    case "RUN_MANGA_OCR_BATCH":
    case "CAPTURE_SCREENSHOT":
      return handleOcrMessage(message, sender);
    case "TRACK_CHARACTERS_READ":
    case "TRACK_VIDEO_IMMERSION":
    case "GET_IMMERSION_ANALYTICS":
      return handleAnalyticsMessage(message, sender);
    case "MOUNT_GENERIC_SUBTITLES":
      return handleGenericSubtitleMessage(message, sender);
    case "FETCH_TIMEDTEXT_URL":
      return handleSubtitleMessage(message, sender);
    case "FETCH_TTS_AUDIO":
      return handleAudioMessage(message, sender);
    case "FETCH_IMAGE": {
      // The legacy protocol serves dictionary illustration queries and OCR image URLs.
      const { query } = (message.payload || {}) as { query?: string };
      return query ? handleDictionaryImage(message) : handleOcrImage(message);
    }
    case "OPEN_APP": {
      chrome.tabs.create({ url: chrome.runtime.getURL("options.html") });
      return { type: "OPEN_APP_RESULT", payload: {} };
    }
    default:
      return {
        type: "ERROR",
        payload: { error: `Unknown message type: ${message.type}` },
      };
  }
}
