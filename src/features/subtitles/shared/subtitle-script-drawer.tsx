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
import type { SubtitleSegment, SubtitleFetchResult } from "~/features/subtitles/shared/types";
import type { TokenAnalysis } from "~/features/dictionary/types";
import type { SrsCard } from "~/features/srs/local-srs";
import { useSettingsStore } from "~/features/settings/settings-store";
import { useTranslation } from "~/shared/locales";
import { deduplicateCueText } from "~/shared/japanese/text-normalization";
import { distributeFurigana, containsJapanese, sanitizeReading, isKanji, mergeOkuriganaTokens } from "~/shared/japanese/japanese";
import { useTranscriptWindow } from "~/features/subtitles/shared/use-transcript-window";
import { requestTranscriptReadings } from "~/features/subtitles/shared/transcript-readings";
import { predictJlpt } from "~/shared/japanese/jlpt-classifier";

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
const EMPTY_SEGMENTS: SubtitleSegment[] = [];
function tokenizeTextFast(text: string): TokenAnalysis[] {
  const clean = text.trim();
  if (!clean) return [];
  if (tokenCache.has(clean)) return tokenCache.get(clean)!;

  let tokens: TokenAnalysis[] = [];
  try {
    const segmenter = getJapaneseSegmenter();
    if (segmenter) {
      const segments = Array.from(segmenter.segment(clean)) as any[];
      const rawTokens: TokenAnalysis[] = segments.map((s) => {
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
      tokens = mergeOkuriganaTokens(rawTokens);
    }
  } catch {}

  if (tokens.length === 0) {
    const parts = clean.match(/[\u4e00-\u9faf]+|[\u3040-\u309f]+|[\u30a0-\u30ff]+|[a-zA-Z0-9]+|[^\s\w]/g) || [clean];
    const rawTokens: TokenAnalysis[] = parts.map((part) => {
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
    tokens = mergeOkuriganaTokens(rawTokens);
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
  sourceUrl?: string;
  nativePanel?: boolean;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onLookup?: (text: string, transient: boolean) => void;
  onDismissLookup?: (force: boolean) => void;
}

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


interface TranscriptCueProps {
  cue: SubtitleSegment;
  originalIdx: number;
  offset: number;
  isActive: boolean;
  isMined: boolean;
  secText?: string;
  isSearchMatch: boolean;
  isCurrentMatch: boolean;
  isPlaying: boolean;
  isCopied: boolean;
  searchQuery: string;
  settings: { showFurigana?: boolean; showJlptColors?: boolean; subtitlesSecondaryEnabled?: boolean };
  savedWords: Set<string>;
  srsCardsMap: Map<string, SrsCard>;
  handleSeek: (cue: SubtitleSegment) => void;
  handlePlayTts: (text: string, index: number) => void;
  handleMineToSrs: (cue: SubtitleSegment, index: number) => void;
  handleCopyCue: (text: string, index: number) => void;
  handleTokenClick: (event: React.MouseEvent, token: TokenAnalysis) => void;
  handleTokenMouseEnter: (event: React.MouseEvent, token: TokenAnalysis) => void;
  handleTokenMouseLeave: (event: React.MouseEvent) => void;
}
const TranscriptCue = React.memo(function TranscriptCue({
  cue, originalIdx, offset, isActive, isMined, secText, isSearchMatch, isCurrentMatch,
  isPlaying, isCopied, searchQuery, settings, savedWords, srsCardsMap,
  handleSeek, handlePlayTts, handleMineToSrs, handleCopyCue,
  handleTokenClick, handleTokenMouseEnter, handleTokenMouseLeave,
}: TranscriptCueProps) {
  const { t, lang } = useTranslation();
  const cleanText = deduplicateCueText(cue.text);
  const [analyzed, setAnalyzed] = useState<{ text: string; tokens: TokenAnalysis[] } | null>(null);
  useEffect(() => {
    let stopped = false;
    if (settings.showFurigana === false || !/[\u4e00-\u9faf]/.test(cleanText)) return;
    void requestTranscriptReadings(cleanText, lang).then((tokens) => {
      if (!stopped) setAnalyzed({ text: cleanText, tokens });
    }).catch(() => {});
    return () => { stopped = true; };
  }, [cleanText, lang, settings.showFurigana]);
  const tokens = analyzed?.text === cleanText ? analyzed.tokens : tokenizeTextFast(cleanText);
  return (
    <div
      data-transcript-row={originalIdx}
      id={`hk-script-cue-${originalIdx}`}
      className={`hk-script-cue ${isActive ? "hk-script-cue--active" : ""} ${isSearchMatch && searchQuery ? "hk-script-cue--matched" : ""} ${isCurrentMatch ? "hk-script-cue--current-match" : ""}`}
      aria-current={isActive ? "true" : undefined}
      onClick={() => {
        if (!window.getSelection()?.toString()) handleSeek(cue);
      }}
    >
      {/* Cue header (Timestamp & Quick Actions) */}
      <div className="hk-script-cue__meta">
        <button
          type="button"
          className="hk-script-cue__time"
          onClick={(event) => {
            event.stopPropagation();
            handleSeek(cue);
          }}
          aria-label={`${t("drawer_btn_play")} ${formatTimestamp(cue.start + offset)}`}
        >
          <Play size={11} className="hk-script-cue__play-icon" />
          {formatTimestamp(cue.start + offset)}
        </button>

        <div className="hk-script-cue__actions" onClick={(e) => e.stopPropagation()}>
          {/* TTS Audio */}
          <button
            type="button"
            className={`hk-script-action-btn ${isPlaying ? "hk-script-action-btn--active" : ""}`}
            onClick={() => handlePlayTts(cleanText, originalIdx)}
            title={t("drawer_btn_tts")}
            aria-label={t("drawer_btn_tts")}
            aria-pressed={isPlaying}
          >
            <Volume2 size={13} />
          </button>

          {/* Mine to SRS */}
          <button
            type="button"
            className={`hk-script-action-btn ${isMined ? "hk-script-action-btn--mined" : ""}`}
            onClick={() => handleMineToSrs(cue, originalIdx)}
            title={isMined ? t("drawer_btn_mined") : t("drawer_btn_mine_srs")}
            aria-label={isMined ? t("drawer_btn_mined") : t("drawer_btn_mine_srs")}
            disabled={isMined}
          >
            {isMined ? <Check size={13} color="#4ade80" /> : <Star size={13} />}
          </button>

          {/* Copy text */}
          <button
            type="button"
            className="hk-script-action-btn"
            onClick={() => void handleCopyCue(cleanText, originalIdx)}
            title={t("drawer_btn_copy")}
            aria-label={t("drawer_btn_copy")}
          >
            {isCopied ? <Check size={13} color="#4ade80" /> : <Copy size={13} />}
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
          } else if (token.is_japanese && token.pos !== "Punctuation") {
            tokenClass += " hk-script-token--new";
            if (tokenJlpt && settings.showJlptColors !== false) {
              tokenClass += ` hk-script-token--jlpt-${tokenJlpt.toLowerCase()}`;
            }
          } else {
            tokenClass += " hk-script-token--plain";
          }

          return (
            <span
              key={tIdx}
              className={tokenClass}
              role={token.is_japanese ? "button" : undefined}
              tabIndex={token.is_japanese ? 0 : undefined}
              onClick={token.is_japanese ? (e) => handleTokenClick(e, token) : undefined}
              onKeyDown={(e) => {
                if (token.is_japanese && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  handleTokenClick(e as unknown as React.MouseEvent, token);
                }
              }}
              onMouseEnter={token.is_japanese ? (e) => handleTokenMouseEnter(e, token) : undefined}
              onMouseLeave={token.is_japanese ? handleTokenMouseLeave : undefined}
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
});

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
  sourceUrl = window.location.href,
  nativePanel = false,
  loading = false,
  error = null,
  onRetry,
  onLookup,
  onDismissLookup,
}) => {
  const { settings, updateSettings } = useSettingsStore();
  const { t } = useTranslation();

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "matched">("all");
  const [currentMatchIdx, setCurrentMatchIdx] = useState(-1);

  // UI state
  const [isWide, setIsWide] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [isSyncEnabled, setIsSyncEnabled] = useState(true);
  const [userHasScrolled, setUserHasScrolled] = useState(false);
  const [lookupOpen, setLookupOpen] = useState(false);
  useEffect(() => {
    const opened = () => setLookupOpen(true);
    const closed = () => setLookupOpen(false);
    window.addEventListener("hakkutsu:analysis-opened", opened);
    window.addEventListener("hakkutsu:analysis-closed", closed);
    return () => { window.removeEventListener("hakkutsu:analysis-opened", opened); window.removeEventListener("hakkutsu:analysis-closed", closed); };
  }, []);
  const [copiedCueIdx, setCopiedCueIdx] = useState<number | null>(null);
  const [minedCueIndices, setMinedCueIndices] = useState<Set<number>>(new Set());
  const [playingTtsIdx, setPlayingTtsIdx] = useState<number | null>(null);

  const listContainerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const openTimerRef = useRef<number | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioRequestRef = useRef(0);

  const segments = subtitleData?.segments || EMPTY_SEGMENTS;
  const secondarySegments = secondaryData?.segments || EMPTY_SEGMENTS;

  useEffect(() => {
    setSearchQuery("");
    setFilterMode("all");
    setUserHasScrolled(false);
    setMinedCueIndices(new Set());
    ++audioRequestRef.current;
    activeAudioRef.current?.pause();
    activeAudioRef.current = null;
    setPlayingTtsIdx(null);
  }, [subtitleData]);

  // Map secondary segments by approximate start time for fast lookup
  const secondaryMap = useMemo(() => {
    const map = new Map<number, string>();
    if (secondarySegments.length === 0) return map;
    const sorted = [...secondarySegments].sort((a, b) => a.start - b.start);
    let secondaryIndex = 0;
    segments.forEach((cue, index) => {
      while (secondaryIndex + 1 < sorted.length &&
        Math.abs(sorted[secondaryIndex + 1].start - cue.start) < Math.abs(sorted[secondaryIndex].start - cue.start)) {
        secondaryIndex++;
      }
      const nearest = sorted[secondaryIndex];
      if (Math.abs(nearest.start - cue.start) <= Math.max(1.5, cue.duration)) {
        map.set(index, deduplicateCueText(nearest.text));
      }
    });
    return map;
  }, [secondarySegments, segments]);

  // Find active cue index
  const activeCueIndex = useMemo(() => {
    if (!currentSegment || segments.length === 0) return -1;
    const exact = segments.findIndex(
      (s) => Math.abs(s.start - currentSegment.start) < 0.1 && s.text === currentSegment.text
    );
    if (exact >= 0) return exact;
    return segments.findIndex((s) =>
      currentSegment.start >= s.start - 0.25 && currentSegment.start < s.start + s.duration + 0.25
    );
  }, [currentSegment, segments]);

  // ── Video Script Analytics Summary ─────────────────────────────────────────

  const scriptAnalytics = useMemo(() => {
    if (!showStats || segments.length === 0) {
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

    const totalUnique = uniqueWords.size;
    const knownPercentage = totalUnique ? Math.round((knownCount / totalUnique) * 100) : 0;
    const unlearnedPercentage = totalUnique ? Math.max(0, 100 - knownPercentage) : 0;

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
  }, [segments, savedWords, showStats]);

  // ── Full-Text Search Filtering & Matching ──────────────────────────────────

  const matchedCueIndices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const indices: number[] = [];

    segments.forEach((cue, idx) => {
      const cueText = (cue.text || "").toLowerCase();
      const secText = (secondaryMap.get(idx) || "").toLowerCase();

      if (cueText.includes(q) || secText.includes(q)) {
        indices.push(idx);
      }
    });

    return indices;
  }, [searchQuery, segments, secondaryMap]);

  const matchedCueSet = useMemo(() => new Set(matchedCueIndices), [matchedCueIndices]);
  const visibleSegments = useMemo(() => segments.map((cue, index) => ({ cue, index }))
    .filter(({ index }) => filterMode !== "matched" || !searchQuery.trim() || matchedCueSet.has(index)),
    [segments, filterMode, searchQuery, matchedCueSet]);
  const layoutRows = useMemo(() => {
    const width = Math.max(180, window.innerWidth - 48);
    return visibleSegments.map(({ cue, index }) => ({ index,
      estimate: 72 + Math.ceil(cue.text.length / Math.max(8, Math.floor(width / 18))) * 30
        + (settings.subtitlesSecondaryEnabled !== false && secondaryMap.get(index)
          ? Math.ceil(secondaryMap.get(index)!.length / Math.max(12, Math.floor(width / 7))) * 20 + 12 : 0),
    }));
  }, [visibleSegments, settings.subtitlesSecondaryEnabled, secondaryMap]);
  const virtual = useTranscriptWindow(listContainerRef, layoutRows, subtitleData, isOpen);
  const scrollCueIntoList = virtual.scrollToRow;

  useEffect(() => {
    setCurrentMatchIdx(matchedCueIndices.length > 0 ? 0 : -1);
    if (!searchQuery.trim() || matchedCueIndices.length === 0) return;
    const frame = requestAnimationFrame(() => scrollCueIntoList(matchedCueIndices[0], false));
    return () => cancelAnimationFrame(frame);
  }, [searchQuery, filterMode, matchedCueIndices, scrollCueIntoList]);

  const jumpToNextMatch = useCallback(() => {
    if (matchedCueIndices.length === 0) return;
    const next = (currentMatchIdx + 1) % matchedCueIndices.length;
    setCurrentMatchIdx(next);
    const cueIdx = matchedCueIndices[next];
    scrollCueIntoList(cueIdx);
    setUserHasScrolled(true);
  }, [currentMatchIdx, matchedCueIndices, scrollCueIntoList]);

  const jumpToPrevMatch = useCallback(() => {
    if (matchedCueIndices.length === 0) return;
    const prev = currentMatchIdx < 0
      ? matchedCueIndices.length - 1
      : (currentMatchIdx - 1 + matchedCueIndices.length) % matchedCueIndices.length;
    setCurrentMatchIdx(prev);
    const cueIdx = matchedCueIndices[prev];
    scrollCueIntoList(cueIdx);
    setUserHasScrolled(true);
  }, [currentMatchIdx, matchedCueIndices, scrollCueIntoList]);

  // ── Auto-Scroll Synchronization ────────────────────────────────────────────

  const scrollToActiveCue = useCallback(
    (smooth = true) => {
      if (activeCueIndex < 0) return;
      scrollCueIntoList(activeCueIndex, smooth);
      setUserHasScrolled(false);
    },
    [activeCueIndex, scrollCueIntoList]
  );

  useEffect(() => {
    if (!isOpen || !isSyncEnabled || userHasScrolled || lookupOpen || searchQuery.trim()) return;
    if (activeCueIndex >= 0) {
      scrollToActiveCue(true);
    }
  }, [activeCueIndex, isOpen, isSyncEnabled, userHasScrolled, lookupOpen, searchQuery, scrollToActiveCue]);

  // Focus search on open
  useEffect(() => {
    if (isOpen) {
      openTimerRef.current = window.setTimeout(() => {
        if (!document.querySelector(".hk-lookup")) searchInputRef.current?.focus({ preventScroll: true });
      }, 150);
    }
    return () => {
      if (openTimerRef.current !== null) window.clearTimeout(openTimerRef.current);
    };
  }, [isOpen]);

  useEffect(() => {
    return () => {
      ++audioRequestRef.current;
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
      activeAudioRef.current?.pause();
      activeAudioRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (lookupOpen && onDismissLookup) { event.preventDefault(); onDismissLookup(true); return; }
        if (document.querySelector(".hk-lookup")) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.composedPath().includes(searchInputRef.current!) && searchQuery) {
          setSearchQuery("");
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen, onClose, searchQuery, lookupOpen, onDismissLookup]);

  // ── Seeking & Actions ──────────────────────────────────────────────────────

  const handleSeek = useCallback((cue: SubtitleSegment) => {
    const targetTime = Math.max(0, cue.start + offset);
    if (onSeekToCue) {
      onSeekToCue(cue);
    } else if (onSeekTime) {
      onSeekTime(targetTime);
    } else {
      const video = videoRef?.current || document.querySelector<HTMLVideoElement>("video");
      try {
        if (video) video.currentTime = targetTime;
      } catch {}
    }
    const video = videoRef?.current;
    if (video?.paused) void video.play().catch(() => {});
    setUserHasScrolled(false);
  }, [offset, onSeekToCue, onSeekTime, videoRef]);

  const handleCopyCue = useCallback(async (cueText: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(deduplicateCueText(cueText));
      setCopiedCueIdx(idx);
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopiedCueIdx(null), 1500);
    } catch (err) {
      console.warn("[Hakkutsu] Copy transcript cue failed:", err);
    }
  }, []);

  const handleMineToSrs = useCallback(async (cue: SubtitleSegment, idx: number) => {
    const text = deduplicateCueText(cue.text);
    const secText = secondaryMap.get(idx) || "";

    // Extract first meaningful kanji / keyword from cue
    const tokens = tokenizeTextFast(text);
    const targetToken =
      tokens.find((t) => t.is_japanese && containsJapanese(t.surface) && t.surface.length > 0) || tokens[0];
    const targetWord = targetToken ? targetToken.surface : text.slice(0, 10);

    try {
      const response = await chrome.runtime.sendMessage({
        type: "ADD_SRS_CARD",
        payload: {
          word: targetWord,
          sentence: text,
          sentence_meaning: secText,
          source_url: sourceUrl,
          source_title: videoTitle || document.title,
        },
      });
      if (response?.type !== "SRS_RESULT") throw new Error(response?.payload?.error || "Could not save cue");
      setMinedCueIndices((prev) => new Set([...prev, idx]));
      window.dispatchEvent(new Event("hakkutsu:srs-updated"));
    } catch (err) {
      console.warn("[Hakkutsu] Mine cue to SRS failed:", err);
    }
  }, [secondaryMap, sourceUrl, videoTitle]);

  const handlePlayTts = useCallback(async (cueText: string, idx: number) => {
    const request = ++audioRequestRef.current;
    activeAudioRef.current?.pause();
    activeAudioRef.current = null;
    setPlayingTtsIdx(idx);
    try {
      const clean = deduplicateCueText(cueText).slice(0, 200);
      const res: any = await chrome.runtime.sendMessage({
        type: "FETCH_TTS_AUDIO",
        payload: { text: clean, lang: "ja" },
      });
      if (request !== audioRequestRef.current) return;
      if (res?.payload?.dataUrl) {
        const audio = new Audio(res.payload.dataUrl);
        activeAudioRef.current = audio;
        const finish = () => {
          if (request !== audioRequestRef.current) return;
          if (activeAudioRef.current === audio) activeAudioRef.current = null;
          setPlayingTtsIdx(null);
        };
        audio.onended = finish;
        audio.onerror = finish;
        await audio.play();
      } else {
        setPlayingTtsIdx(null);
      }
    } catch {
      if (request === audioRequestRef.current) setPlayingTtsIdx(null);
    }
  }, []);

  // ── Token Hover & Click ────────────────────────────────────────────────────

  const handleTokenClick = useCallback((e: React.MouseEvent, token: TokenAnalysis) => {
    e.stopPropagation();
    if (onLookup) { onLookup(token.surface, false); return; }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    window.dispatchEvent(
      new CustomEvent("hakkutsu:analyze", {
        detail: {
          text: token.surface,
          x: rect.left + rect.width / 2,
          y: rect.top,
          placement: "drawer",
          mode: "dictionary",
          transient: false,
          pauseVideo: false,
        },
      })
    );
  }, [onLookup]);

  const handleTokenMouseEnter = useCallback((e: React.MouseEvent, token: TokenAnalysis) => {
    if (!token?.surface?.trim() || !token.is_japanese) return;
    if (onLookup) { onLookup(token.surface, true); return; }
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
          pauseVideo: false,
        },
      })
    );
  }, [onLookup]);

  const handleTokenMouseLeave = useCallback((e: React.MouseEvent) => {
    if (onDismissLookup) { onDismissLookup(false); return; }
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
  }, [onDismissLookup]);

  if (!isOpen) return null;

  return (
    <aside
      className={`hk-script-drawer ${nativePanel ? "hk-script-drawer--native" : ""} ${isWide ? "hk-script-drawer--wide" : ""}`}
      style={{
        width: nativePanel ? "100%" : isWide ? "min(520px, 100vw)" : "min(380px, 100vw)",
      }}
      onClick={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="false"
      aria-label={t("drawer_title")}
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
              aria-label="Toggle transcript statistics"
              aria-pressed={showStats}
            >
              <BarChart2 size={16} />
            </button>

            {/* Wide toggle */}
            {!nativePanel && <button
              type="button"
              className="hk-script-btn-icon"
              onClick={() => setIsWide(!isWide)}
              title={isWide ? "Compact Width" : "Wide Width"}
              aria-label={isWide ? "Use compact transcript width" : "Use wide transcript width"}
              aria-pressed={isWide}
            >
              {isWide ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>}

            {/* Close button */}
            <button
              type="button"
              className="hk-script-btn-icon hk-script-btn-icon--close"
              onClick={onClose}
              title="Close Script Drawer (Esc / T)"
              aria-label="Close transcript"
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
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setUserHasScrolled(Boolean(e.target.value.trim()));
              }}
              aria-label={t("drawer_search_placeholder")}
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
                aria-label="Clear transcript search"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {searchQuery && matchedCueIndices.length > 0 && (
            <div className="hk-script-search-nav">
              <span className="hk-script-search-count">
                {Math.max(0, currentMatchIdx + 1)}/{matchedCueIndices.length}
              </span>
              <button
                type="button"
                className="hk-script-search-nav-btn"
                onClick={jumpToPrevMatch}
                title="Previous Match (Shift+Enter)"
                aria-label="Previous search match"
              >
                <ChevronUp size={14} />
              </button>
              <button
                type="button"
                className="hk-script-search-nav-btn"
                onClick={jumpToNextMatch}
                title="Next Match (Enter)"
                aria-label="Next search match"
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
              aria-pressed={filterMode === "all"}
            >
              {t("drawer_filter_all")}
            </button>
            {searchQuery && (
              <button
                type="button"
                className={`hk-script-filter-chip ${filterMode === "matched" ? "hk-script-filter-chip--active" : ""}`}
                onClick={() => setFilterMode("matched")}
                aria-pressed={filterMode === "matched"}
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
              aria-label={t("drawer_toggle_furigana")}
              aria-pressed={settings.showFurigana !== false}
            >
              <span style={{ fontSize: "11px", fontWeight: 700 }}>ルビ</span>
            </button>

            <button
              type="button"
              className={`hk-script-toggle-btn ${settings.subtitlesSecondaryEnabled !== false ? "hk-script-toggle-btn--active" : ""}`}
              onClick={() => updateSettings({ subtitlesSecondaryEnabled: settings.subtitlesSecondaryEnabled === false })}
              title="Toggle Translation (V)"
              aria-label={t("drawer_toggle_translation")}
              aria-pressed={settings.subtitlesSecondaryEnabled !== false}
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
              aria-label={t("drawer_toggle_sync")}
              aria-pressed={isSyncEnabled}
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
        onWheel={() => setUserHasScrolled(true)}
        onTouchStart={() => setUserHasScrolled(true)}
        onPointerDown={(event) => { if (event.target === event.currentTarget) setUserHasScrolled(true); }}
      >
        {visibleSegments.length === 0 ? (
          <div className="hk-script-drawer__empty" role={error ? "alert" : "status"}>
            <p>{searchQuery ? t("drawer_no_matches") : loading ? t("sub_overlay_loading") : error || t("drawer_empty_no_cues")}</p>
            {!searchQuery && !loading && onRetry && <button type="button" className="hk-script-filter-chip" onClick={onRetry}>{t("dash_retry")}</button>}
          </div>
        ) : (
          <>
            <div aria-hidden="true" style={{ height: virtual.before }} />
            {visibleSegments.slice(virtual.start, virtual.end).map(({ cue, index }) => <TranscriptCue
              key={index} cue={cue} originalIdx={index} offset={offset}
              isActive={index === activeCueIndex} isMined={minedCueIndices.has(index)}
              secText={secondaryMap.get(index)} isSearchMatch={matchedCueSet.has(index)}
              isCurrentMatch={Boolean(searchQuery) && matchedCueIndices[currentMatchIdx] === index}
              isPlaying={playingTtsIdx === index} isCopied={copiedCueIdx === index}
              searchQuery={searchQuery} settings={settings} savedWords={savedWords} srsCardsMap={srsCardsMap}
              handleSeek={handleSeek} handlePlayTts={handlePlayTts} handleMineToSrs={handleMineToSrs} handleCopyCue={handleCopyCue}
              handleTokenClick={handleTokenClick} handleTokenMouseEnter={handleTokenMouseEnter} handleTokenMouseLeave={handleTokenMouseLeave}
            />)}
            <div aria-hidden="true" style={{ height: virtual.after }} />
          </>
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
    </aside>
  );
};
