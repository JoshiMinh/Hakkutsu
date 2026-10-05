import type { ExtensionMessage } from "~/shared/browser/messages";

export async function handleSubtitleMessage(
  message: ExtensionMessage,
  sender?: chrome.runtime.MessageSender,
): Promise<ExtensionMessage> {
  switch (message.type) {
    case "FETCH_TIMEDTEXT_URL": {
      const { url } = message.payload as { url: string };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(url, {
          credentials: "include",
          signal: controller.signal,
        });
        if (res.ok) {
          const text = await res.text();
          return {
            type: "FETCH_TIMEDTEXT_URL_RESULT",
            payload: { success: true, text },
          };
        }
        return {
          type: "FETCH_TIMEDTEXT_URL_RESULT",
          payload: { success: false, error: `HTTP ${res.status}` },
        };
      } catch (err: any) {
        return {
          type: "FETCH_TIMEDTEXT_URL_RESULT",
          payload: { success: false, error: err.message || String(err) },
        };
      } finally {
        clearTimeout(timer);
      }
    }
    default:
      return {
        type: "ERROR",
        payload: { error: `Unknown message type: ${message.type}` },
      };
  }
}
