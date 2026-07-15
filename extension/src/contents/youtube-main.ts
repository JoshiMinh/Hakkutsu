import type { PlasmoCSConfig } from "plasmo";

export const config: PlasmoCSConfig = {
  matches: ["https://www.youtube.com/watch*"],
  world: "MAIN",
  run_at: "document_start"
};

/**
 * Injected script running in YouTube's MAIN world context.
 * Allows us to directly access window.ytInitialPlayerResponse and ytplayer 
 * without making secondary HTTP requests to scrape HTML.
 */

// Helper to safely send to our isolated content script
function notifyPlayerResponse() {
  const ytInitialPlayerResponse = (window as any).ytInitialPlayerResponse;
  
  // Sometimes YouTube stores it in ytplayer.config.args.raw_player_response
  let response = ytInitialPlayerResponse;
  if (!response) {
    const ytplayer = (window as any).ytplayer;
    if (ytplayer?.config?.args?.raw_player_response) {
      try {
        response = JSON.parse(ytplayer.config.args.raw_player_response);
      } catch (e) {
        // Ignore parse error
      }
    }
  }

  if (response) {
    window.postMessage({
      type: "HAKKUTSU_YT_PLAYER_RESPONSE",
      payload: response
    }, "*");
  }
}

// 1. Initial page load
window.addEventListener("load", () => {
  notifyPlayerResponse();
  // Backup timeout in case window.load is too early
  setTimeout(notifyPlayerResponse, 1000);
});

// 2. SPA Navigation (YouTube's custom events)
window.addEventListener("yt-navigate-finish", () => {
  notifyPlayerResponse();
});
