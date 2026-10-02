import { useCallback, useEffect, useRef, useState } from "react";
import type { SubtitleFetchResult, SubtitleSegment } from "~lib/utils/types";

export interface TranscriptSnapshot {
  subtitleData: SubtitleFetchResult | null;
  secondaryData?: SubtitleFetchResult | null;
  currentSegment: SubtitleSegment | null;
  offset: number;
  videoTitle: string;
  sourceUrl: string;
  loading?: boolean;
  error?: string | null;
  canRetry?: boolean;
}

export function useTranscriptPanelToggle() {
  const [isOpen, setIsOpen] = useState(false);
  const openRef = useRef(false);
  useEffect(() => {
    const listener = (message: { type: string; payload?: { open: boolean } }) => {
      if (message.type !== "TRANSCRIPT_VISIBILITY") return;
      openRef.current = Boolean(message.payload?.open);
      setIsOpen(openRef.current);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);
  const toggle = useCallback((value: boolean | ((previous: boolean) => boolean)) => {
    const next = typeof value === "function" ? value(openRef.current) : value;
    // Send directly from the click/keyboard handler to preserve the gesture.
    void chrome.runtime.sendMessage({ type: next ? "OPEN_TRANSCRIPT_PANEL" : "CLOSE_TRANSCRIPT_PANEL" })
      .then((response) => {
        if (response?.type === "ERROR") window.alert(response.payload.error);
      }).catch((error) => window.alert(error.message));
  }, []);
  return [isOpen, toggle] as const;
}

export function useTranscriptSource(snapshot: TranscriptSnapshot, onSeek: (time: number) => void, onRetry?: () => void) {
  const latest = useRef({ snapshot, onSeek, onRetry });
  latest.current = { snapshot, onSeek, onRetry };
  const subscribed = useRef(false);
  const lastCue = useRef<SubtitleSegment | null>(null);
  useEffect(() => {
    const listener = (message: { type: string; payload?: { time: number; open: boolean } },
      _sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => {
      if (message.type === "GET_TRANSCRIPT") {
        subscribed.current = true;
        lastCue.current = latest.current.snapshot.currentSegment;
        sendResponse({ type: "TRANSCRIPT_SNAPSHOT", payload: latest.current.snapshot });
      } else if (message.type === "SEEK_TRANSCRIPT" && Number.isFinite(message.payload?.time)) {
        latest.current.onSeek(message.payload!.time);
        sendResponse({ ok: true });
      } else if (message.type === "TRANSCRIPT_VISIBILITY") {
        subscribed.current = Boolean(message.payload?.open);
      } else if (message.type === "RETRY_TRANSCRIPT") {
        latest.current.onRetry?.();
        sendResponse({ ok: true });
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    // Announce replacement SPA players so an already-open sidebar subscribes.
    void chrome.runtime.sendMessage({ type: "TRANSCRIPT_SNAPSHOT", payload: latest.current.snapshot }).catch(() => {});
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
      void chrome.runtime.sendMessage({ type: "TRANSCRIPT_UNAVAILABLE" }).catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (subscribed.current) void chrome.runtime.sendMessage({ type: "TRANSCRIPT_SNAPSHOT", payload: snapshot }).catch(() => {});
  }, [snapshot.subtitleData, snapshot.secondaryData, snapshot.offset, snapshot.videoTitle, snapshot.sourceUrl, snapshot.loading, snapshot.error, snapshot.canRetry]);
  useEffect(() => {
    const cue = snapshot.currentSegment;
    const previous = lastCue.current;
    if (previous?.text === cue?.text && previous?.start === cue?.start && previous?.duration === cue?.duration) return;
    lastCue.current = cue;
    if (subscribed.current) void chrome.runtime.sendMessage({ type: "TRANSCRIPT_CUE", payload: cue }).catch(() => {});
  }, [snapshot.currentSegment]);
}

