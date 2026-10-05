import { getSettings } from "~/features/settings/settings-storage";
import type { ExtensionMessage } from "~/shared/browser/messages";

export async function handleSettingsMessage(
  message: ExtensionMessage,
  sender?: chrome.runtime.MessageSender,
): Promise<ExtensionMessage> {
  switch (message.type) {
    case "GET_SETTINGS": {
      const settings = await getSettings();
      return { type: "GET_SETTINGS", payload: settings };
    }
    default:
      return {
        type: "ERROR",
        payload: { error: `Unknown message type: ${message.type}` },
      };
  }
}
