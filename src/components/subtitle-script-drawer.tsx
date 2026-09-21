import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  X,
  Search,
  ChevronUp,
  ChevronDown,
  Play,
  Volume2,
  Copy,
  Check,
  Star,
  Sparkles,
  BarChart2,
  Eye,
  EyeOff,
  Maximize2,
  Minimize2,
  ArrowDownCircle,
  HelpCircle,
} from "lucide-react";
import type { SubtitleSegment, SubtitleFetchResult, TokenAnalysis } from "~lib/utils/types";
import type { SrsCard } from "~lib/services/local-srs";
import { useSettingsStore } from "~lib/utils/settings";
import { useTranslation } from "~lib/locales";
import { deduplicateCueText } from "~lib/services/subtitle-parsers";
import { distributeFurigana, containsJapanese, sanitizeReading, isKanji } from "~lib/utils/japanese";
import { predictJlpt } from "~lib/utils/jlpt-classifier";

// ── Helpers & Cache ──────────────────────────────────────────────────────────

function formatTimestamp(sec: number): string {
  if (isNaN(sec) || sec < 0) return "00:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

let cachedSegmenter: any = null;
function getJapaneseSegmenter() {
  if (cachedSegmenter) return cachedSegmenter;
  if (typeof Intl !== "undefined" && (Intl as any).Segmenter) {
    try {
      cachedSegmenter = new (Intl as any).Segmenter("ja-JP", { granularity: "word" });
    } catch {}
  }
  return cachedSegmenter;
}

const tokenCache = new Map<string, TokenAnalysis[]>();
function tokenizeTextFast(text: string): TokenAnalysis[] {
  const clean = text.trim();
  if (!clean) return [];
  if (tokenCache.has(clean)) return tokenCache.get(clean)!;

  let tokens: TokenAnalysis[] = [];
  try {
    const segmenter = getJapaneseSegmenter();
    if (segmenter) {
      const segments = Array.from(segmenter.segment(clean)) as any[];
      tokens = segments.map((s) => {
        const segText = s.segment;
        const isJp = containsJapanese(segText);
        return {
          surface: segText,
          dictionary_form: segText,
          pos: s.isWordLike ? "Word" : "Punctuation",
          pos_detail: [],
          reading: { hiragana: "", romaji: "" },
          is_japanese: isJp,
          jlpt_level: isJp ? predictJlpt(segText) : null,
          frequency_rank: null,
          definitions: [],
        };
      });
    }
  } catch {}

  if (tokens.length === 0) {
    const parts = clean.match(/[\u4e00-\u9faf]+|[\u3040-\u309f]+|[\u30a0-\u30ff]+|[a-zA-Z0-9]+|[^\s\w]/g) || [clean];
    tokens = parts.map((part) => {
      const isJp = containsJapanese(part);
      return {
        surface: part,
        dictionary_form: part,
        pos: isJp ? "Word" : "Other",
        pos_detail: [],
        reading: { hiragana: "", romaji: "" },
        is_japanese: isJp,
        jlpt_level: isJp ? predictJlpt(part) : null,
        frequency_rank: null,
        definitions: [],
      };
    });
  }

  if (tokenCache.size > 500) {
    const first = tokenCache.keys().next().value;
    if (first !== undefined) tokenCache.delete(first);
  }
  tokenCache.set(clean, tokens);
  return tokens;
}

// ── Props ────────────────────────────────────────────────────────────────────

export interface SubtitleScriptDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  subtitleData: SubtitleFetchResult | null;
  secondaryData?: SubtitleFetchResult | null;
  currentSegment: SubtitleSegment | null;
  offset?: number;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  onSeekToCue?: (cue: SubtitleSegment) => void;
  onSeekTime?: (timeSec: number) => void;
  savedWords?: Set<string>;
  srsCardsMap?: Map<string, SrsCard>;
  videoTitle?: string;
}

export const SubtitleScriptDrawer: React.FC<SubtitleScriptDrawerProps> = ({
  isOpen,
  onClose,
  subtitleData,
  secondaryData,
  currentSegment,
  offset = 0,
  videoRef,
  onSeekToCue,
  onSeekTime,
  savedWords = new Set(),
  srsCardsMap = new Map(),
  videoTitle = "",
}) => {
  const { settings, updateSettings } = useSettingsStore();
  const { t } = useTranslation();

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "matched">("all");
  const [currentMatchIdx, setCurrentMatchIdx] = useState(0);

  // UI state
  const [isWide, setIsWide] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [isSyncEnabled, setIsSyncEnabled] = useState(true);
  const [userHasScrolled, setUserHasScrolled] = useState(false);
  const [copiedCueIdx, setCopiedCueIdx] = useState<number | null>(null);
  const [minedCueIndices, setMinedCueIndices] = useState<Set<number>>(new Set());
  const [playingTtsIdx, setPlayingTtsIdx] = useState<number | null>(null);

  const listContainerRef = useRef<HTMLDivElement | null>(null);
  const activeCueRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const scrollTimeoutRef = useRef<number | null>(null);

  const segments = subtitleData?.segments || [];
  const secondarySegments = secondaryData?.segments || [];

  // Map secondary segments by approximate start time for fast lookup
  const secondaryMap = useMemo(() => {
    const map = new Map<number, string>();
    if (secondarySegments.length === 0) return map;
    secondarySegments.forEach((s) => {
      const key = Math.round(s.start * 2) / 2;
      map.set(key, deduplicateCueText(s.text));
    });
    return map;
  }, [secondarySegments]);

  // Find active cue index
  const activeCueIndex = useMemo(() => {
    if (!currentSegment || segments.length === 0) return -1;
    return segments.findIndex(
      (s) => Math.abs(s.start - currentSegment.start) < 0.1 && s.text === currentSegment.text
    );
  }, [currentSegment, segments]);

  // ── Video Script Analytics Summary ─────────────────────────────────────────

  const scriptAnalytics = useMemo(() => {
    if (segments.length === 0) {
      return {
        totalLines: 0,
        totalChars: 0,
        uniqueWordsCount: 0,
        jlptCounts: { N5: 0, N4: 0, N3: 0, N2: 0, N1: 0, unranked: 0 },
        knownPercentage: 0,
        unlearnedPercentage: 0,
        knownCount: 0,
        unlearnedCount: 0,
      };
    }

    let totalChars = 0;
    const uniqueWords = new Set<string>();
    const jlptCounts = { N5: 0, N4: 0, N3: 0, N2: 0, N1: 0, unranked: 0 };
    let knownCount = 0;
    let unlearnedCount = 0;

    for (const cue of segments) {
      const clean = deduplicateCueText(cue.text);
      totalChars += clean.replace(/\s+/g, "").length;
      const tokens = tokenizeTextFast(clean);

      for (const tok of tokens) {
        if (!tok.is_japanese || tok.pos === "Punctuation") continue;
        const w = tok.surface.trim();
        if (w.length <= 1 && !/[\u4e00-\u9faf]/.test(w)) continue;

        if (!uniqueWords.has(w)) {
          uniqueWords.add(w);
          const lvl = tok.jlpt_level || predictJlpt(w);
          if (lvl === "N5") jlptCounts.N5++;
          else if (lvl === "N4") jlptCounts.N4++;
          else if (lvl === "N3") jlptCounts.N3++;
          else if (lvl === "N2") jlptCounts.N2++;
          else if (lvl === "N1") jlptCounts.N1++;
          else jlptCounts.unranked++;

          const isSaved = savedWords.has(w) || Boolean(tok.dictionary_form && savedWords.has(tok.dictionary_form));
          if (isSaved) {
            knownCount++;
          } else {
            unlearnedCount++;
          }
        }
      }
    }

    const totalUnique = uniqueWords.size || 1;
    const knownPercentage = Math.round((knownCount / totalUnique) * 100);
    const unlearnedPercentage = Math.max(0, 100 - knownPercentage);

    return {
      totalLines: segments.length,
      totalChars,
      uniqueWordsCount: uniqueWords.size,
      jlptCounts,
      knownPercentage,
      unlearnedPercentage,
      knownCount,
      unlearnedCount,
    };
  }, [segments, savedWords]);

  // ── Full-Text Search Filtering & Matching ──────────────────────────────────

  const matchedCueIndices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const indices: number[] = [];

    segments.forEach((cue, idx) => {
      const cueText = (cue.text || "").toLowerCase();
      const secKey = Math.round(cue.start * 2) / 2;
      const secText = (secondaryMap.get(secKey) || "").toLowerCase();

      if (cueText.includes(q) || secText.includes(q)) {
        indices.push(idx);
      }
    });

    return indices;
  }, [searchQuery, segments, secondaryMap]);

  // Reset match index when query changes
  useEffect(() => {
    setCurrentMatchIdx(0);
  }, [searchQuery]);

  // Jump to next / previous match
  const jumpToNextMatch = useCallback(() => {
    if (matchedCueIndices.length === 0) return;
    const next = (currentMatchIdx + 1) % matchedCueIndices.length;
    setCurrentMatchIdx(next);
    const cueIdx = matchedCueIndices[next];
    const el = document.getElementById(`hk-script-cue-${cueIdx}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [currentMatchIdx, matchedCueIndices]);

  const jumpToPrevMatch = useCallback(() => {
    if (matchedCueIndices.length === 0) return;
    const prev = (currentMatchIdx - 1 + matchedCueIndices.length) % matchedCueIndices.length;
    setCurrentMatchIdx(prev);
    const cueIdx = matchedCueIndices[prev];
    const el = document.getElementById(`hk-script-cue-${cueIdx}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [currentMatchIdx, matchedCueIndices]);

  // ── Auto-Scroll Synchronization ────────────────────────────────────────────

  const scrollToActiveCue = useCallback(
    (smooth = true) => {
      if (activeCueIndex < 0) return;
      const el = document.getElementById(`hk-script-cue-${activeCueIndex}`);
      if (el && listContainerRef.current) {
        el.scrollIntoView({
          behavior: smooth ? "smooth" : "auto",
          block: "center",
        });
        setUserHasScrolled(false);
      }
    },
    [activeCueIndex]
  );

  useEffect(() => {
    if (!isOpen || !isSyncEnabled || userHasScrolled) return;
    if (activeCueIndex >= 0) {
      scrollToActiveCue(true);
    }
  }, [activeCueIndex, isOpen, isSyncEnabled, userHasScrolled, scrollToActiveCue]);

  // Focus search on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        scrollToActiveCue(false);
      }, 150);
    }
  }, [isOpen, scrollToActiveCue]);

  // Handle manual user scrolling
  const handleScroll = () => {
    if (scrollTimeoutRef.current) {
      window.clearTimeout(scrollTimeoutRef.current);
    }
    // Mark user as scrolled if they scroll during playback
    setUserHasScrolled(true);
  };

  // ── Seeking & Actions ──────────────────────────────────────────────────────

  const handleSeek = (cue: SubtitleSegment) => {
    const targetTime = Math.max(0, cue.start + offset);
    if (onSeekToCue) {
      onSeekToCue(cue);
    } else if (onSeekTime) {
      onSeekTime(targetTime);
    }
    const video = videoRef?.current || document.querySelector<HTMLVideoElement>("video");
    if (video) {
      try {
        video.currentTime = targetTime;
        if (video.paused) {
          void video.play();
        }
      } catch {}
    }
    setUserHasScrolled(false);
  };

  const handleCopyCue = (cueText: string, idx: number) => {
    try {
      void navigator.clipboard.writeText(deduplicateCueText(cueText));
      setCopiedCueIdx(idx);
      setTimeout(() => setCopiedCueIdx(null), 1500);
    } catch {}
  };

  const handleMineToSrs = async (cue: SubtitleSegment, idx: number) => {
    const text = deduplicateCueText(cue.text);
    const secKey = Math.round(cue.start * 2) / 2;
    const secText = secondaryMap.get(secKey) || "";

    // Extract first meaningful kanji / keyword from cue
    const tokens = tokenizeTextFast(text);
    const targetToken =
      tokens.find((t) => t.is_japanese && containsJapanese(t.surface) && t.surface.length > 0) || tokens[0];
    const targetWord = targetToken ? targetToken.surface : text.slice(0, 10);

    try {
      await chrome.runtime.sendMessage({
        type: "ADD_SRS_CARD",
        payload: {
          word: targetWord,
          sentence: text,
          sentence_meaning: secText,
          source_url: window.location.href,
          source_title: videoTitle || document.title,
        },
      });
      setMinedCueIndices((prev) => new Set([...prev, idx]));
    } catch (err) {
      console.warn("[Hakkutsu] Mine cue to SRS failed:", err);
    }
  };

  const handlePlayTts = async (cueText: string, idx: number) => {
    setPlayingTtsIdx(idx);
    try {
      const clean = deduplicateCueText(cueText).slice(0, 200);
      const res: any = await chrome.runtime.sendMessage({
        type: "FETCH_TTS_AUDIO",
        payload: { text: clean, lang: "ja" },
      });
      if (res?.payload?.dataUrl) {
        const audio = new Audio(res.payload.dataUrl);
        audio.onended = () => setPlayingTtsIdx(null);
        audio.onerror = () => setPlayingTtsIdx(null);
        await audio.play();
      } else {
        setPlayingTtsIdx(null);
      }
    } catch {
      setPlayingTtsIdx(null);
    }
  };

  // ── Token Hover & Click ────────────────────────────────────────────────────

  const handleTokenClick = (e: React.MouseEvent, token: TokenAnalysis) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    window.dispatchEvent(
      new CustomEvent("hakkutsu:analyze", {
        detail: {
          text: token.surface,
          x: rect.left + rect.width / 2,
          y: rect.top,
          placement: "drawer",
          mode: "dictionary",
          transient: true,
        },
      })
    );
  };

  const handleTokenMouseEnter = (e: React.MouseEvent, token: TokenAnalysis) => {
    if (!token?.surface || !token.surface.trim()) return;
    if (!token.is_japanese && /^[\s.,!?。！？、…:;\-–—/\\()[\]{}""''「」『』【】（）]+$/.test(token.surface)) {
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    window.dispatchEvent(
      new CustomEvent("hakkutsu:analyze", {
        detail: {
          text: token.surface,
          x: rect.left + rect.width / 2,
          y: rect.top,
          placement: "drawer",
          mode: "dictionary",
          transient: true,
        },
      })
    );
  };

  const handleTokenMouseLeave = (e: React.MouseEvent) => {
    const relatedTarget = e.relatedTarget as HTMLElement | null;
    const shadowHost = document.getElementById("hakkutsu-inline-dictionary-host");
    if (
      relatedTarget &&
      (relatedTarget.closest?.(".hk-popup") ||
        relatedTarget.id === "hakkutsu-inline-dictionary-host" ||
        relatedTarget === shadowHost ||
        shadowHost?.contains(relatedTarget))
    ) {
      return;
    }
    window.dispatchEvent(new CustomEvent("hakkutsu:analysis-dismiss"));
  };

  // ── Highlight Substring Helper ─────────────────────────────────────────────

  const renderHighlightedText = (text: string, query: string) => {
    if (!query.trim()) return text;
    const q = query.trim();
    const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
    return parts.map((part, i) =>
      part.toLowerCase() === q.toLowerCase() ? (
        <mark key={i} className="hk-script-mark">
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  if (!isOpen) return null;

  const visibleSegments = filterMode === "matched" && searchQuery.trim()
    ? segments.filter((_, idx) => matchedCueIndices.includes(idx))
    : segments;

  return (
    <div
      className={`hk-script-drawer ${isWide ? "hk-script-drawer--wide" : ""}`}
      style={{
        width: isWide ? "520px" : "380px",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="hk-script-drawer__header">
        <div className="hk-script-drawer__title-row">
          <div className="hk-script-drawer__title-group">
            <span className="hk-script-drawer__title">{t("drawer_title")}</span>
            <span className="hk-script-drawer__badge">
              {segments.length} {t("drawer_stats_lines")}
            </span>
          </div>

          <div className="hk-script-drawer__actions">
            {/* Stats toggle */}
            <button
              type="button"
              className={`hk-script-btn-icon ${showStats ? "hk-script-btn-icon--active" : ""}`}
              onClick={() => setShowStats(!showStats)}
              title="Script Vocabulary & JLPT Analytics"
            >
              <BarChart2 size={16} />
            </button>

            {/* Wide toggle */}
            <button
              type="button"
              className="hk-script-btn-icon"
              onClick={() => setIsWide(!isWide)}
              title={isWide ? "Compact Width" : "Wide Width"}
            >
              {isWide ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>

            {/* Close button */}
            <button
              type="button"
              className="hk-script-btn-icon hk-script-btn-icon--close"
              onClick={onClose}
              title="Close Script Drawer (Esc / T)"
            >
              <X size={17} />
            </button>
          </div>
        </div>

        {/* ── Search Bar ────────────────────────────────────────────────────── */}
        <div className="hk-script-drawer__search-row">
          <div className="hk-script-search-input-wrapper">
            <Search size={15} className="hk-script-search-icon" />
            <input
              ref={searchInputRef}
              type="text"
              className="hk-script-search-input"
              placeholder={t("drawer_search_placeholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (e.shiftKey) jumpToPrevMatch();
                  else jumpToNextMatch();
                } else if (e.key === "Escape") {
                  setSearchQuery("");
                }
              }}
            />
            {searchQuery && (
              <button
                type="button"
                className="hk-script-search-clear"
                onClick={() => setSearchQuery("")}
              >
                <X size={13} />
              </button>
            )}
          </div>

          {searchQuery && matchedCueIndices.length > 0 && (
            <div className="hk-script-search-nav">
              <span className="hk-script-search-count">
                {currentMatchIdx + 1}/{matchedCueIndices.length}
              </span>
              <button
                type="button"
                className="hk-script-search-nav-btn"
                onClick={jumpToPrevMatch}
                title="Previous Match (Shift+Enter)"
              >
                <ChevronUp size={14} />
              </button>
              <button
                type="button"
                className="hk-script-search-nav-btn"
                onClick={jumpToNextMatch}
                title="Next Match (Enter)"
              >
                <ChevronDown size={14} />
              </button>
            </div>
          )}
        </div>

        {/* ── Quick Filter & Sync Controls ──────────────────────────────────── */}
        <div className="hk-script-drawer__control-row">
          <div className="hk-script-filter-group">
            <button
              type="button"
              className={`hk-script-filter-chip ${filterMode === "all" ? "hk-script-filter-chip--active" : ""}`}
              onClick={() => setFilterMode("all")}
            >
              {t("drawer_filter_all")}
            </button>
            {searchQuery && (
              <button
                type="button"
                className={`hk-script-filter-chip ${filterMode === "matched" ? "hk-script-filter-chip--active" : ""}`}
                onClick={() => setFilterMode("matched")}
              >
                {t("drawer_filter_matched")} ({matchedCueIndices.length})
              </button>
            )}
          </div>

          <div className="hk-script-quick-toggles">
            <button
              type="button"
              className={`hk-script-toggle-btn ${settings.showFurigana !== false ? "hk-script-toggle-btn--active" : ""}`}
              onClick={() => updateSettings({ showFurigana: settings.showFurigana === false })}
              title="Toggle Furigana (F)"
            >
              <span style={{ fontSize: "11px", fontWeight: 700 }}>ルビ</span>
            </button>

            <button
              type="button"
              className={`hk-script-toggle-btn ${settings.subtitlesSecondaryEnabled !== false ? "hk-script-toggle-btn--active" : ""}`}
              onClick={() => updateSettings({ subtitlesSecondaryEnabled: settings.subtitlesSecondaryEnabled === false })}
              title="Toggle Translation (V)"
            >
              <span style={{ fontSize: "11px", fontWeight: 700 }}>訳</span>
            </button>

            <button
              type="button"
              className={`hk-script-toggle-btn ${isSyncEnabled ? "hk-script-toggle-btn--active" : ""}`}
              onClick={() => {
                const next = !isSyncEnabled;
                setIsSyncEnabled(next);
                if (next) scrollToActiveCue(true);
              }}
              title="Toggle Auto-Scroll Sync"
            >
              <ArrowDownCircle size={13} />
            </button>
          </div>
        </div>

        {/* ── Expandable Script Analytics Summary ───────────────────────────── */}
        {showStats && (
          <div className="hk-script-analytics-box">
            <div className="hk-script-analytics-stats">
              <div className="hk-script-stat-item">
                <span className="hk-script-stat-val">{scriptAnalytics.totalLines}</span>
                <span className="hk-script-stat-lbl">{t("drawer_stats_lines")}</span>
              </div>
              <div className="hk-script-stat-item">
                <span className="hk-script-stat-val">{scriptAnalytics.totalChars.toLocaleString()}</span>
                <span className="hk-script-stat-lbl">{t("drawer_stats_chars")}</span>
              </div>
              <div className="hk-script-stat-item">
                <span className="hk-script-stat-val" style={{ color: "#4ade80" }}>
                  {scriptAnalytics.knownPercentage}%
                </span>
                <span className="hk-script-stat-lbl">{t("drawer_stats_known")}</span>
              </div>
              <div className="hk-script-stat-item">
                <span className="hk-script-stat-val" style={{ color: "#c084fc" }}>
                  {scriptAnalytics.unlearnedPercentage}%
                </span>
                <span className="hk-script-stat-lbl">{t("drawer_stats_unlearned")}</span>
              </div>
            </div>

            {/* JLPT distribution bar */}
            <div className="hk-script-jlpt-bar">
              {Object.entries(scriptAnalytics.jlptCounts).map(([lvl, count]) => {
                if (count === 0 || lvl === "unranked") return null;
                return (
                  <span key={lvl} className={`hk-script-jlpt-pill hk-jlpt-pill--${lvl.toLowerCase()}`}>
                    {lvl}: {count}
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Subtitle Cues Scroll List ────────────────────────────────────────── */}
      <div
        className="hk-script-drawer__list"
        ref={listContainerRef}
        onScroll={handleScroll}
      >
        {visibleSegments.length === 0 ? (
          <div className="hk-script-drawer__empty">
            {searchQuery ? t("drawer_no_matches") : t("drawer_empty_no_cues")}
          </div>
        ) : (
          visibleSegments.map((cue, vIdx) => {
            const originalIdx = segments.indexOf(cue);
            const isActive = originalIdx === activeCueIndex;
            const isMined = minedCueIndices.has(originalIdx);
            const secKey = Math.round(cue.start * 2) / 2;
            const secText = secondaryMap.get(secKey);
            const isSearchMatch = matchedCueIndices.includes(originalIdx);
            const cleanText = deduplicateCueText(cue.text);
            const tokens = tokenizeTextFast(cleanText);

            return (
              <div
                key={originalIdx}
                id={`hk-script-cue-${originalIdx}`}
                ref={isActive ? activeCueRef : null}
                className={`hk-script-cue ${isActive ? "hk-script-cue--active" : ""} ${isSearchMatch && searchQuery ? "hk-script-cue--matched" : ""}`}
                onClick={() => handleSeek(cue)}
              >
                {/* Cue header (Timestamp & Quick Actions) */}
                <div className="hk-script-cue__meta">
                  <span className="hk-script-cue__time">
                    <Play size={11} className="hk-script-cue__play-icon" />
                    {formatTimestamp(cue.start + offset)}
                  </span>

                  <div className="hk-script-cue__actions" onClick={(e) => e.stopPropagation()}>
                    {/* TTS Audio */}
                    <button
                      type="button"
                      className={`hk-script-action-btn ${playingTtsIdx === originalIdx ? "hk-script-action-btn--active" : ""}`}
                      onClick={() => handlePlayTts(cleanText, originalIdx)}
                      title={t("drawer_btn_tts")}
                    >
                      <Volume2 size={13} />
                    </button>

                    {/* Mine to SRS */}
                    <button
                      type="button"
                      className={`hk-script-action-btn ${isMined ? "hk-script-action-btn--mined" : ""}`}
                      onClick={() => handleMineToSrs(cue, originalIdx)}
                      title={isMined ? t("drawer_btn_mined") : t("drawer_btn_mine_srs")}
                    >
                      {isMined ? <Check size={13} color="#4ade80" /> : <Star size={13} />}
                    </button>

                    {/* Copy text */}
                    <button
                      type="button"
                      className="hk-script-action-btn"
                      onClick={() => handleCopyCue(cleanText, originalIdx)}
                      title={t("drawer_btn_copy")}
                    >
                      {copiedCueIdx === originalIdx ? <Check size={13} color="#4ade80" /> : <Copy size={13} />}
                    </button>
                  </div>
                </div>

                {/* Primary Japanese Dialogue with Tokenization & Highlighting */}
                <div className="hk-script-cue__primary">
                  {tokens.map((token, tIdx) => {
                    const isKanjiWord = isKanji(token.surface) || /[\u4e00-\u9faf]/.test(token.surface);
                    const cleanReading = sanitizeReading(token.reading?.hiragana || "", token.surface);
                    const showRuby =
                      settings.showFurigana !== false &&
                      isKanjiWord &&
                      Boolean(cleanReading) &&
                      cleanReading !== token.surface;
                    const rubySegments = showRuby ? distributeFurigana(token.surface, cleanReading) : null;
                    const hasRuby = showRuby && rubySegments !== null && rubySegments.some((s) => s.ruby);

                    const isSaved =
                      savedWords.has(token.surface) ||
                      Boolean(token.dictionary_form && savedWords.has(token.dictionary_form));
                    const srsCard = isSaved
                      ? srsCardsMap.get(token.surface) ||
                        (token.dictionary_form ? srsCardsMap.get(token.dictionary_form) : undefined)
                      : undefined;

                    const tokenJlpt = token.is_japanese ? (token.jlpt_level || predictJlpt(token.surface)) : null;

                    let tokenClass = "hk-script-token";
                    if (isSaved) {
                      tokenClass += " hk-script-token--known";
                    } else if (tokenJlpt && settings.showJlptColors !== false) {
                      tokenClass += ` hk-script-token--jlpt-${tokenJlpt.toLowerCase()}`;
                    }

                    return (
                      <span
                        key={tIdx}
                        className={tokenClass}
                        onClick={(e) => handleTokenClick(e, token)}
                        onMouseEnter={(e) => handleTokenMouseEnter(e, token)}
                        onMouseLeave={handleTokenMouseLeave}
                        title={
                          isSaved && srsCard
                            ? `SRS: State ${srsCard.state ?? 0} · Interval: ${srsCard.interval ?? 0}d`
                            : tokenJlpt
                              ? `JLPT ${tokenJlpt}`
                              : undefined
                        }
                      >
                        {hasRuby && rubySegments ? (
                          rubySegments.map((seg, sIdx) =>
                            seg.ruby ? (
                              <ruby key={sIdx}>
                                {renderHighlightedText(seg.text, searchQuery)}
                                <rt className="hk-script-rt">{seg.ruby}</rt>
                              </ruby>
                            ) : (
                              <span key={sIdx}>{renderHighlightedText(seg.text, searchQuery)}</span>
                            )
                          )
                        ) : (
                          renderHighlightedText(token.surface, searchQuery)
                        )}
                        {isSaved && <span className="hk-script-known-dot" />}
                      </span>
                    );
                  })}
                </div>

                {/* Secondary Translation Bar */}
                {settings.subtitlesSecondaryEnabled !== false && secText && (
                  <div className="hk-script-cue__secondary">
                    {renderHighlightedText(secText, searchQuery)}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* ── Floating "Resume Auto-Scroll" Pill ──────────────────────────────── */}
      {userHasScrolled && isSyncEnabled && activeCueIndex >= 0 && (
        <button
          type="button"
          className="hk-script-resume-pill"
          onClick={() => scrollToActiveCue(true)}
        >
          <ArrowDownCircle size={14} />
          <span>{t("drawer_btn_resume_sync")}</span>
          <span className="hk-script-resume-pill__time">
            {formatTimestamp((segments[activeCueIndex]?.start || 0) + offset)}
          </span>
        </button>
      )}
    </div>
  );
};
