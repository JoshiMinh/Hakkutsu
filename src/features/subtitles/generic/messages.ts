import type { ExtensionMessage } from "~/shared/browser/messages";

export async function handleGenericSubtitleMessage(
  message: ExtensionMessage,
  sender?: chrome.runtime.MessageSender,
): Promise<ExtensionMessage> {
  switch (message.type) {
    case "MOUNT_GENERIC_SUBTITLES": {
      const tabId = sender?.tab?.id;
      if (tabId === undefined) {
        return {
          type: "ERROR",
          payload: { error: "Missing sender tab for subtitle overlay" },
        };
      }
      const frameId = sender?.frameId ?? 0;
      if (chrome.scripting?.executeScript) {
        await chrome.scripting.executeScript({
          target: { tabId, frameIds: [frameId] },
          files: ["content-scripts/generic-subtitles.js"],
        });
      } else {
        await chrome.tabs.executeScript(tabId, {
          file: "/content-scripts/generic-subtitles.js",
          frameId,
        });
      }
      return { type: "IGNORED", payload: { mounted: true } };
    }
    default:
      return {
        type: "ERROR",
        payload: { error: `Unknown message type: ${message.type}` },
      };
  }
}
