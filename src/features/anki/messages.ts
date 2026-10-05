import { getSettings } from "~/features/settings/settings-storage";
import { ankiClient } from "~/features/anki/anki-connect";
import type { ExtensionMessage } from "~/shared/browser/messages";
import type { AnkiExportData } from "~/features/anki/types";

export async function handleAnkiMessage(
  message: ExtensionMessage,
  sender?: chrome.runtime.MessageSender,
): Promise<ExtensionMessage> {
  switch (message.type) {
    case "EXPORT_ANKI": {
      const data = message.payload as AnkiExportData;
      const settings = await getSettings();
      try {
        const noteId = await ankiClient.exportVocabulary(
          data,
          settings.ankiDeck,
          settings.ankiModel,
          settings.ankiFieldMap,
        );
        return { type: "ANKI_RESULT", payload: { noteId } };
      } catch (err: any) {
        return {
          type: "ERROR",
          payload: { error: err?.message || "Failed to export card to Anki" },
        };
      }
    }

    case "CHECK_ANKI": {
      const connected = await ankiClient.isConnected();
      return { type: "ANKI_STATUS", payload: { connected } };
    }
    default:
      return {
        type: "ERROR",
        payload: { error: `Unknown message type: ${message.type}` },
      };
  }
}
