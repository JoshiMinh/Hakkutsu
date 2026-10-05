import { analyticsService } from "~/features/analytics/analytics-service";
import type { ExtensionMessage } from "~/shared/browser/messages";

export async function handleAnalyticsMessage(
  message: ExtensionMessage,
  sender?: chrome.runtime.MessageSender,
): Promise<ExtensionMessage> {
  switch (message.type) {
    case "TRACK_CHARACTERS_READ": {
      const { count } = (message.payload || {}) as { count: number };
      await analyticsService.recordCharactersRead(count || 0);
      return {
        type: "TRACK_CHARACTERS_READ_RESULT",
        payload: { success: true },
      };
    }

    case "TRACK_VIDEO_IMMERSION": {
      const { seconds } = (message.payload || {}) as { seconds: number };
      await analyticsService.recordVideoImmersion(seconds || 0);
      return {
        type: "TRACK_VIDEO_IMMERSION_RESULT",
        payload: { success: true },
      };
    }

    case "GET_IMMERSION_ANALYTICS": {
      const summary = await analyticsService.getOverallAnalytics();
      return { type: "IMMERSION_ANALYTICS_RESULT", payload: summary };
    }
    default:
      return {
        type: "ERROR",
        payload: { error: `Unknown message type: ${message.type}` },
      };
  }
}
