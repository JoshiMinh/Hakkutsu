import { localSrs } from "~/features/srs/local-srs";
import type { ExtensionMessage } from "~/shared/browser/messages";

export async function handleSrsMessage(
  message: ExtensionMessage,
  sender?: chrome.runtime.MessageSender,
): Promise<ExtensionMessage> {
  switch (message.type) {
    case "ADD_SRS_CARD": {
      const data = message.payload as {
        word: string;
        reading?: string;
        meaning?: string;
        sentence?: string;
      };
      try {
        const card = await localSrs.addSrsCard(data);
        return { type: "SRS_RESULT", payload: card };
      } catch (err: any) {
        return {
          type: "ERROR",
          payload: { error: err.message || "Failed to add to library" },
        };
      }
    }

    case "CHECK_CARD_EXISTS": {
      const { word } = (message.payload || {}) as { word: string };
      if (!word)
        return { type: "CARD_EXISTS_RESULT", payload: { exists: false } };
      const card = await localSrs.getCardByWord(word);
      return { type: "CARD_EXISTS_RESULT", payload: { exists: !!card, card } };
    }

    case "REMOVE_SRS_CARD": {
      const { word } = (message.payload || {}) as { word: string };
      if (!word)
        return { type: "REMOVE_SRS_CARD_RESULT", payload: { success: false } };
      const success = await localSrs.deleteSrsCardByWord(word);
      return { type: "REMOVE_SRS_CARD_RESULT", payload: { success } };
    }

    case "RESET_LEECH_STATUS": {
      const { cardId } = (message.payload || {}) as { cardId: string };
      if (!cardId)
        return { type: "ERROR", payload: { error: "Missing cardId" } };
      const card = await localSrs.resetLeechStatus(cardId);
      return { type: "RESET_LEECH_RESULT", payload: card };
    }

    case "GET_SMART_DECK_FILTERS": {
      const filters = await localSrs.getAvailableSmartDeckFilters();
      return { type: "SMART_DECK_FILTERS_RESULT", payload: filters };
    }

    case "GET_ALL_SRS_CARDS": {
      const cards = await localSrs.getAllSrsCards();
      return { type: "ALL_SRS_CARDS_RESULT", payload: { cards } };
    }
    default:
      return {
        type: "ERROR",
        payload: { error: `Unknown message type: ${message.type}` },
      };
  }
}
