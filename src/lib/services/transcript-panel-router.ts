/** Only connected sidebar instances receive updates; no transcript is persisted. */
export function installTranscriptPanelRouter() {
  const panels = new Map<chrome.runtime.Port, { tabId?: number; request: number }>();
  const visibility = (tabId: number, open: boolean) => {
    void chrome.tabs.sendMessage(tabId, { type: "TRANSCRIPT_VISIBILITY", payload: { open } }).catch(() => {});
  };
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "hakkutsu-transcript-panel") return;
    const state: { tabId?: number; request: number } = { request: 0 };
    panels.set(port, state);
    port.onMessage.addListener(async (message) => {
      if (message.type === "WATCH_TAB" && Number.isInteger(message.tabId)) {
        const oldTab = state.tabId;
        state.tabId = message.tabId;
        const request = ++state.request;
        if (oldTab !== undefined && oldTab !== state.tabId) visibility(oldTab, false);
        visibility(message.tabId, true);
        let response;
        try { response = await chrome.tabs.sendMessage(message.tabId, { type: "GET_TRANSCRIPT" }); }
        catch { response = { type: "TRANSCRIPT_UNAVAILABLE" }; }
        if (panels.has(port) && state.request === request) port.postMessage(response || { type: "TRANSCRIPT_UNAVAILABLE" });
      } else if (["SEEK_TRANSCRIPT", "RETRY_TRANSCRIPT"].includes(message.type) && state.tabId !== undefined) {
        void chrome.tabs.sendMessage(state.tabId, message).catch(() => {});
      }
    });
    port.onDisconnect.addListener(() => {
      panels.delete(port);
      if (state.tabId !== undefined) visibility(state.tabId, false);
    });
  });
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!/^TRANSCRIPT_(SNAPSHOT|CUE|UNAVAILABLE)$/.test(message?.type || "")) return;
    for (const [port, state] of panels) {
      if (state.tabId === sender.tab?.id) port.postMessage(message);
    }
    // A newly mounted SPA player must be subscribed even after replacement.
    if (message.type === "TRANSCRIPT_SNAPSHOT" && sender.tab?.id !== undefined &&
      [...panels.values()].some((state) => state.tabId === sender.tab!.id)) visibility(sender.tab.id, true);
    sendResponse({ ok: true });
  });
  return (tabId: number) => {
    for (const [port, state] of panels) if (state.tabId === tabId) port.postMessage({ type: "CLOSE_TRANSCRIPT_PANEL" });
  };
}
