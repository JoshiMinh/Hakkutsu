import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { SubtitleScriptDrawer } from "~components/subtitle-script-drawer";
import InlineDictionary from "~contents/inline-dictionary";
import type { TranscriptSnapshot } from "~lib/services/transcript-panel";
import { mergeTranscriptSnapshot } from "~lib/services/transcript-state";
import type { SrsCard } from "~lib/services/local-srs";
import "~/style.css";

function closePanel() {
  if (browser.sidebarAction?.close) void browser.sidebarAction.close();
  else window.close();
}

function TranscriptPanel() {
  const [snapshot, setSnapshot] = useState<TranscriptSnapshot | null>(null);
  const [cards, setCards] = useState<SrsCard[]>([]);
  const portRef = useRef<chrome.runtime.Port | null>(null);
  useEffect(() => {
    let stopped = false;
    let retry: number | undefined;
    let windowId: number | undefined;
    let tabId: number | undefined;
    let generation = 0;
    const watch = (id: number) => {
      tabId = id;
      window.dispatchEvent(new CustomEvent("hakkutsu:analysis-dismiss", { detail: { force: true } }));
      setSnapshot(null);
      portRef.current?.postMessage({ type: "WATCH_TAB", tabId: id });
    };
    const connect = async () => {
      const currentGeneration = ++generation;
      const port = chrome.runtime.connect({ name: "hakkutsu-transcript-panel" });
      portRef.current = port;
      port.onMessage.addListener((message) => {
        if (stopped || port !== portRef.current) return;
        if (message.type === "TRANSCRIPT_SNAPSHOT") setSnapshot((previous) => mergeTranscriptSnapshot(previous, message.payload));
        else if (message.type === "TRANSCRIPT_CUE") setSnapshot((previous) => previous ? { ...previous, currentSegment: message.payload } : previous);
        else if (message.type === "TRANSCRIPT_UNAVAILABLE") setSnapshot(null);
        else if (message.type === "CLOSE_TRANSCRIPT_PANEL") closePanel();
      });
      port.onDisconnect.addListener(() => {
        if (!stopped) retry = window.setTimeout(() => void connect(), 1000);
      });
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (stopped || currentGeneration !== generation) return;
      windowId = tab?.windowId;
      if (tab?.id !== undefined) watch(tab.id);
    };
    const activated = (info: chrome.tabs.TabActiveInfo) => {
      if (info.windowId === windowId) watch(info.tabId);
    };
    const updated = (id: number, change: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && change.status === "loading") watch(id);
    };
    chrome.tabs.onActivated.addListener(activated);
    chrome.tabs.onUpdated.addListener(updated);
    void connect();
    return () => {
      stopped = true;
      if (retry !== undefined) window.clearTimeout(retry);
      portRef.current?.disconnect();
      chrome.tabs.onActivated.removeListener(activated);
      chrome.tabs.onUpdated.removeListener(updated);
    };
  }, []);
  useEffect(() => {
    let stopped = false;
    const load = () => void chrome.runtime.sendMessage({ type: "GET_ALL_SRS_CARDS" })
      .then((response) => { if (!stopped) setCards(response?.payload?.cards || []); }).catch(() => {});
    load();
    window.addEventListener("hakkutsu:srs-updated", load);
    return () => { stopped = true; window.removeEventListener("hakkutsu:srs-updated", load); };
  }, []);
  const savedWords = useMemo(() => new Set(cards.flatMap((card) => [card.word, card.reading].filter(Boolean) as string[])), [cards]);
  const cardMap = useMemo(() => new Map(cards.flatMap((card) => [card.word, card.reading].filter(Boolean).map((word) => [word!, card] as const))), [cards]);
  const seek = useCallback((time: number) => portRef.current?.postMessage({ type: "SEEK_TRANSCRIPT", payload: { time } }), []);
  const retry = useCallback(() => portRef.current?.postMessage({ type: "RETRY_TRANSCRIPT" }), []);
  return <div className="hk-transcript-workspace">
    {snapshot ? <SubtitleScriptDrawer
      isOpen nativePanel onClose={closePanel}
      {...snapshot}
      savedWords={savedWords} srsCardsMap={cardMap}
      onSeekTime={seek}
      onRetry={snapshot.canRetry ? retry : undefined}
    /> : <div className="hk-transcript-panel-empty" role="status">
      <h1>Video Script</h1>
      <p>Open a video and load subtitles with Hakkutsu to read its transcript here.</p>
    </div>}
    <InlineDictionary key={snapshot?.sourceUrl || "empty"} nativePanel sourceUrl={snapshot?.sourceUrl} sourceTitle={snapshot?.videoTitle} />
  </div>;
}

createRoot(document.getElementById("root")!).render(<TranscriptPanel />);
