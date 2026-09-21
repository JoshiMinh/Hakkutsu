import { useEffect, useState, useCallback, useRef } from "react";
import { localSrs } from "~lib/services/local-srs";
import type { SrsCard, SrsStats } from "~lib/services/local-srs";
import type { SmartDeckFilter, SmartDeckFilterOptions } from "~lib/utils/types";
import { PartyPopper, Volume2, RotateCcw, Filter, AlertTriangle, Flame, Layers, Sparkles, Check, CheckCircle2, Headphones, Activity } from "lucide-react";
import { useTranslation } from "~lib/locales";
import { ttsService } from "~lib/services/tts-service";
import { distributeFurigana } from "~lib/utils/japanese";
import { useSettingsStore } from "~lib/utils/settings";

function RenderFurigana({ text, reading, className }: { text: string; reading?: string; className?: string }) {
  if (!text) return null;
  const segments = distributeFurigana(text, reading);
  if (!segments || segments.length === 0) return <span className={className}>{text}</span>;
  return (
    <span className={className}>
      {segments.map((seg, idx) =>
        seg.ruby ? (
          <ruby key={idx} className="hk-ruby" style={{ margin: "0 1px" }}>
            {seg.text}
            <rt>{seg.ruby}</rt>
          </ruby>
        ) : (
          <span key={idx}>{seg.text}</span>
        )
      )}
    </span>
  );
}

export function SrsReview({ userId = "user_1" }: { userId?: string }) {
  const { t, isVietnamese, showHanViet } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const [cards, setCards] = useState<SrsCard[]>([]);
  const [stats, setStats] = useState<SrsStats | null>(null);
  const [filterOptions, setFilterOptions] = useState<SmartDeckFilterOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  
  // Audio-First Review Mode State
  const [audioFirstMode, setAudioFirstMode] = useState<boolean>(() => !!settings.audioFirstReviewMode);

  // Sync default setting change
  useEffect(() => {
    if (settings.audioFirstReviewMode !== undefined) {
      setAudioFirstMode(settings.audioFirstReviewMode);
    }
  }, [settings.audioFirstReviewMode]);

  // Smart Deck Filter State
  const [activeFilterType, setActiveFilterType] = useState<"all" | "jlpt" | "domain" | "leech">("all");
  const [selectedJlpt, setSelectedJlpt] = useState<string>("ALL");
  const [selectedDomain, setSelectedDomain] = useState<string>("ALL");
  const [dueOnly, setDueOnly] = useState<boolean>(true);

  const loadDeck = useCallback(async (customDueOnly?: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const isDue = customDueOnly !== undefined ? customDueOnly : dueOnly;
      const filters: SmartDeckFilter = {
        dueOnly: isDue,
      };

      if (activeFilterType === "leech") {
        filters.leechesOnly = true;
      } else if (activeFilterType === "jlpt" && selectedJlpt !== "ALL") {
        filters.jlptLevels = [selectedJlpt];
      } else if (activeFilterType === "domain" && selectedDomain !== "ALL") {
        filters.domains = [selectedDomain];
      }

      const [filteredCards, currentStats, availableFilters] = await Promise.all([
        localSrs.getFilteredCards(filters),
        localSrs.getSrsStats(),
        localSrs.getAvailableSmartDeckFilters(),
      ]);

      setCards(filteredCards);
      setStats(currentStats);
      setFilterOptions(availableFilters);
    } catch (err: any) {
      setError(err.message || "Failed to load review deck");
    } finally {
      setLoading(false);
    }
  }, [activeFilterType, selectedJlpt, selectedDomain, dueOnly]);

  useEffect(() => {
    loadDeck();
  }, [loadDeck]);

  const handleReview = useCallback(async (quality: number) => {
    if (cards.length === 0) return;
    const currentCard = cards[0];
    
    // Re-queue card to end of session if quality is 1 (Again)
    setCards(prev => {
      const remaining = prev.slice(1);
      if (quality === 1) {
        return [...remaining, currentCard];
      }
      return remaining;
    });
    setShowAnswer(false);
    
    try {
      await localSrs.submitSrsReview(currentCard.id, quality);
      if (stats) {
        setStats({
           ...stats, 
           cardsReviewedToday: stats.cardsReviewedToday + 1,
           due: Math.max(0, stats.due - 1)
        });
      }
    } catch (err) {
      console.error("Failed to submit review", err);
    }
  }, [cards, stats]);

  const speakText = useCallback((text: string) => {
    if (text) {
      ttsService.playJapanese(text);
    }
  }, []);

  const currentCard = cards[0];
  const isCurrentCardLeech = currentCard ? (currentCard.is_leech || (currentCard.lapse_count || 0) >= 4) : false;

  // Auto-play audio on card load in Audio-First mode or on reveal in normal mode
  useEffect(() => {
    if (currentCard?.word) {
      if (audioFirstMode && !showAnswer) {
        speakText(currentCard.word);
      } else if (!audioFirstMode && showAnswer) {
        speakText(currentCard.word);
      }
    }
  }, [currentCard?.id, showAnswer, audioFirstMode, speakText]);

  // Keyboard accessibility (Space/Enter to reveal, 1-4 to grade, R to replay audio)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
        return;
      }

      // Shortcut R to replay Japanese audio anytime
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        if (currentCard?.word) {
          speakText(currentCard.word);
        }
        return;
      }
      
      if (!showAnswer) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setShowAnswer(true);
        }
      } else {
        switch (e.key) {
          case "Enter":
          case " ":
          case "3":
            e.preventDefault();
            handleReview(4); // Good
            break;
          case "1":
            e.preventDefault();
            handleReview(1); // Again
            break;
          case "2":
            e.preventDefault();
            handleReview(3); // Hard
            break;
          case "4":
            e.preventDefault();
            handleReview(5); // Easy
            break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showAnswer, handleReview, currentCard, speakText]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px", width: "100%" }}>
      {/* ── Smart Deck Filter Selector Toolbar ─────────────────────────────── */}
      <div
        style={{
          background: "var(--hk-bg-secondary)",
          border: "1px solid var(--hk-border)",
          borderRadius: "10px",
          padding: "10px 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "10px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "5px", color: "var(--hk-text-muted)", fontSize: "12px", fontWeight: 600 }}>
            <Filter size={13} style={{ color: "var(--hk-accent-light, #c084fc)" }} />
            <span>{isVietnamese ? "Bộ Thẻ Thông Minh:" : "Smart Deck:"}</span>
          </div>

          {/* Quick Preset Buttons */}
          <button
            type="button"
            onClick={() => {
              setActiveFilterType("all");
              setSelectedJlpt("ALL");
              setSelectedDomain("ALL");
            }}
            style={{
              padding: "4px 10px",
              borderRadius: "6px",
              fontSize: "11.5px",
              fontWeight: 600,
              border: activeFilterType === "all" ? "1px solid var(--hk-accent-primary)" : "1px solid rgba(255,255,255,0.08)",
              background: activeFilterType === "all" ? "rgba(168, 85, 247, 0.2)" : "transparent",
              color: activeFilterType === "all" ? "#ffffff" : "var(--hk-text-secondary)",
              cursor: "pointer",
            }}
          >
            {isVietnamese ? "Tất cả" : "All Decks"}
          </button>

          {/* JLPT Select */}
          <select
            value={activeFilterType === "jlpt" ? selectedJlpt : "ALL"}
            onChange={(e) => {
              const val = e.target.value;
              if (val === "ALL") {
                setActiveFilterType("all");
                setSelectedJlpt("ALL");
              } else {
                setActiveFilterType("jlpt");
                setSelectedJlpt(val);
              }
            }}
            style={{
              padding: "4px 8px",
              borderRadius: "6px",
              fontSize: "11.5px",
              background: activeFilterType === "jlpt" ? "rgba(168, 85, 247, 0.2)" : "#18181c",
              border: activeFilterType === "jlpt" ? "1px solid var(--hk-accent-primary)" : "1px solid rgba(255,255,255,0.1)",
              color: "#ffffff",
              outline: "none",
              cursor: "pointer",
            }}
          >
            <option value="ALL">JLPT (N5 - N1)</option>
            {["N5", "N4", "N3", "N2", "N1"].map((lvl) => {
              const found = filterOptions?.jlptLevels.find((j) => j.level === lvl);
              return (
                <option key={lvl} value={lvl}>
                  {lvl} ({found ? `${found.dueCount} due / ${found.count}` : "0"})
                </option>
              );
            })}
          </select>

          {/* Domain Select (YouTube, Netflix, etc.) */}
          {filterOptions && filterOptions.domains.length > 0 && (
            <select
              value={activeFilterType === "domain" ? selectedDomain : "ALL"}
              onChange={(e) => {
                const val = e.target.value;
                if (val === "ALL") {
                  setActiveFilterType("all");
                  setSelectedDomain("ALL");
                } else {
                  setActiveFilterType("domain");
                  setSelectedDomain(val);
                }
              }}
              style={{
                padding: "4px 8px",
                borderRadius: "6px",
                fontSize: "11.5px",
                background: activeFilterType === "domain" ? "rgba(168, 85, 247, 0.2)" : "#18181c",
                border: activeFilterType === "domain" ? "1px solid var(--hk-accent-primary)" : "1px solid rgba(255,255,255,0.1)",
                color: "#ffffff",
                outline: "none",
                cursor: "pointer",
                maxWidth: "140px",
              }}
            >
              <option value="ALL">{isVietnamese ? "Nguồn Domain" : "Source Domain"}</option>
              {filterOptions.domains.map((d) => (
                <option key={d.domain} value={d.domain}>
                  {d.domain} ({d.dueCount} due)
                </option>
              ))}
            </select>
          )}

          {/* Leech Retraining Button */}
          {filterOptions && filterOptions.leechCount > 0 && (
            <button
              type="button"
              onClick={() => {
                setActiveFilterType("leech");
              }}
              style={{
                padding: "4px 10px",
                borderRadius: "6px",
                fontSize: "11.5px",
                fontWeight: 700,
                border: activeFilterType === "leech" ? "1px solid #ef4444" : "1px solid rgba(239, 68, 68, 0.3)",
                background: activeFilterType === "leech" ? "rgba(239, 68, 68, 0.25)" : "rgba(239, 68, 68, 0.1)",
                color: "#f87171",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <Flame size={12} />
              {isVietnamese ? "Luyện Thẻ Leech" : "Leech Retraining"} ({filterOptions.leechCount})
            </button>
          )}

          {/* Audio-First SRS Mode Toggle */}
          <button
            type="button"
            onClick={() => setAudioFirstMode((prev) => !prev)}
            style={{
              padding: "4px 10px",
              borderRadius: "6px",
              fontSize: "11px",
              fontWeight: 600,
              background: audioFirstMode ? "rgba(168, 85, 247, 0.2)" : "rgba(255, 255, 255, 0.05)",
              border: audioFirstMode ? "1px solid var(--hk-accent-primary)" : "1px solid rgba(255, 255, 255, 0.1)",
              color: audioFirstMode ? "#c084fc" : "var(--hk-text-secondary)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "5px",
              transition: "all 0.2s ease",
            }}
            title={t("settings_audio_first_desc")}
          >
            <Headphones size={13} style={{ color: audioFirstMode ? "#c084fc" : "inherit" }} />
            <span>{t("srs_audio_first_toggle")}: {audioFirstMode ? "ON" : "OFF"}</span>
          </button>
        </div>

        {/* Due Only vs Practice All toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <button
            type="button"
            onClick={() => setDueOnly(!dueOnly)}
            style={{
              padding: "4px 10px",
              borderRadius: "6px",
              fontSize: "11px",
              fontWeight: 600,
              background: dueOnly ? "rgba(168, 85, 247, 0.15)" : "rgba(59, 130, 246, 0.15)",
              border: dueOnly ? "1px solid rgba(168, 85, 247, 0.3)" : "1px solid rgba(59, 130, 246, 0.3)",
              color: dueOnly ? "#c084fc" : "#60a5fa",
              cursor: "pointer",
            }}
          >
            {dueOnly ? (isVietnamese ? "Chỉ thẻ đến hạn" : "Due Only") : (isVietnamese ? "Luyện tập tất cả" : "Practice All")}
          </button>
        </div>
      </div>

      {loading && (
        <div className="hk-srs-container hk-flex-center" style={{ minHeight: "350px", justifyContent: "center", alignItems: "center" }}>
          <div className="hk-loading-spinner" />
        </div>
      )}

      {error && !loading && (
        <div className="hk-srs-container hk-flex-center" style={{ minHeight: "350px", justifyContent: "center", alignItems: "center", color: "var(--hk-text-muted)" }}>
          <p>{error}</p>
          <button className="hk-btn hk-btn--secondary" onClick={() => loadDeck()} style={{ marginTop: "12px" }}>
            Retry
          </button>
        </div>
      )}

      {!loading && !error && cards.length === 0 && (
        <div className="hk-srs-empty">
          <div className="hk-srs-empty__icon">
            <PartyPopper size={44} style={{ color: "var(--hk-accent-primary, #a855f7)" }} />
          </div>
          <h3 className="hk-srs-empty__title">{t("srs_no_cards_title")}</h3>
          <p className="hk-srs-empty__desc" style={{ marginBottom: "16px" }}>
            {activeFilterType === "leech"
              ? (isVietnamese ? "Không có thẻ leech nào cần ôn tập!" : "No leech cards in this session!")
              : t("srs_no_cards_desc")}
          </p>
          <button 
            className="hk-btn hk-btn--secondary"
            onClick={() => {
              setDueOnly(false);
              loadDeck(false);
            }}
            style={{ gap: "8px" }}
          >
            <RotateCcw size={16} />
            {isVietnamese ? "Luyện tập tất cả các từ trong bộ này" : "Practice All Cards in Deck"}
          </button>
        </div>
      )}

      {!loading && !error && cards.length > 0 && currentCard && (
        <div className="hk-srs-container">
          {/* Top Session Progress Bar */}
          <div className="hk-srs-header">
            <div className="hk-srs-badge">
              <span className="hk-srs-badge__count">{cards.length}</span>{" "}
              {!dueOnly ? (isVietnamese ? "thẻ luyện tập" : "practice cards") : t("srs_card_count")}
            </div>
            {stats && (
              <div className="hk-srs-stats-micro">
                <span>{isVietnamese ? "Đã ôn hôm nay" : "Reviewed today"}: <b>{stats.cardsReviewedToday}</b></span>
              </div>
            )}
          </div>

          {/* Leech Alert Banner if card has failed >= 4 times */}
          {isCurrentCardLeech && (
            <div
              style={{
                background: "rgba(239, 68, 68, 0.12)",
                border: "1px solid rgba(239, 68, 68, 0.35)",
                borderRadius: "8px",
                padding: "8px 12px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                color: "#f87171",
                fontSize: "12px",
                fontWeight: 600,
              }}
              className="hk-fade-in"
            >
              <AlertTriangle size={15} style={{ flexShrink: 0 }} />
              <span>
                {isVietnamese
                  ? `Thẻ Leech (Đã sai ${currentCard.lapse_count || 4} lần) — Hãy chú ý kỹ âm đọc, bộ thủ và ví dụ ngữ cảnh.`
                  : `Leech Card (Failed ${currentCard.lapse_count || 4} times) — Pay extra attention to kanji components and reading.`}
              </span>
            </div>
          )}

          <div className="hk-srs-card">
            {/* Front Card Rendering: Masked Audio-First vs Text View */}
            {!showAnswer && audioFirstMode ? (
              <div className="hk-audio-first-mask hk-fade-in">
                <div className="hk-audio-first-wave">
                  <span className="hk-wave-bar bar-1"></span>
                  <span className="hk-wave-bar bar-2"></span>
                  <span className="hk-wave-bar bar-3"></span>
                  <span className="hk-wave-bar bar-4"></span>
                  <span className="hk-wave-bar bar-5"></span>
                </div>
                <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--hk-accent-light, #c084fc)", display: "flex", alignItems: "center", gap: "6px" }}>
                  <Headphones size={16} />
                  <span>{t("srs_audio_first_prompt")}</span>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    speakText(currentCard.word);
                  }}
                  className="hk-btn hk-btn--secondary"
                  style={{ fontSize: "12px", padding: "5px 14px", borderRadius: "999px", gap: "6px", cursor: "pointer", marginTop: "4px" }}
                >
                  <Volume2 size={14} />
                  <span>{t("srs_audio_first_replay")}</span>
                </button>
              </div>
            ) : (
              <div className="hk-srs-card__word" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "12px", flexWrap: "wrap" }}>
                {showAnswer ? (
                  <RenderFurigana text={currentCard.word_furigana || currentCard.word} reading={currentCard.reading} />
                ) : (
                  <span>{currentCard.word}</span>
                )}
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    speakText(currentCard.word);
                  }}
                  className="hk-btn hk-btn--ghost hk-btn--icon"
                  style={{ padding: "6px", borderRadius: "50%", cursor: "pointer" }}
                  title={t("def_play_audio_jp")}
                >
                  <Volume2 size={22} style={{ color: "var(--hk-text-secondary)" }} />
                </button>
              </div>
            )}
            
            {showAnswer && (
              <div className="hk-fade-in-up hk-srs-card__answer">
                {/* Badges Row */}
                {(currentCard.jlpt || (showHanViet && currentCard.vietnamese_sound) || currentCard.source_domain || currentCard.retrievability !== undefined || currentCard.stability !== undefined) && (
                  <div className="hk-srs-card__badges">
                    {currentCard.jlpt && <span className="hk-srs-card__badge hk-srs-card__badge--jlpt">{currentCard.jlpt}</span>}
                    {showHanViet && currentCard.vietnamese_sound && (
                      <span className="hk-srs-card__badge hk-srs-card__badge--vi">{currentCard.vietnamese_sound}</span>
                    )}
                    {currentCard.source_domain && (
                      <span className="hk-srs-card__badge" style={{ background: "rgba(255,255,255,0.06)", color: "var(--hk-text-muted)" }}>
                        {currentCard.source_domain}
                      </span>
                    )}
                    {currentCard.stability !== undefined && (
                      <span className="hk-srs-card__badge hk-srs-badge--fsrs" title="FSRS Memory Stability">
                        S: {currentCard.stability}d
                      </span>
                    )}
                    {currentCard.retrievability !== undefined && (
                      <span className="hk-srs-card__badge hk-srs-badge--fsrs" title="FSRS Probability of Recall">
                        R: {Math.round(currentCard.retrievability * 100)}%
                      </span>
                    )}
                  </div>
                )}

                {/* Primary Reading fallback if furigana not present */}
                {currentCard.reading && currentCard.reading !== currentCard.word && !currentCard.word_furigana?.includes("[") && (
                  <div className="hk-srs-card__reading">
                    {currentCard.reading}
                  </div>
                )}

                {/* Meaning */}
                {currentCard.meaning && (
                  <div className="hk-srs-card__meaning">
                    {currentCard.meaning}
                  </div>
                )}

                {/* Illustration Visual */}
                {currentCard.image_url && (
                  <div style={{ marginTop: "10px", textAlign: "center" }}>
                    <img
                      src={currentCard.image_url}
                      alt={currentCard.word}
                      style={{ maxHeight: "130px", maxWidth: "100%", objectFit: "contain", borderRadius: "8px", background: "#18181b", padding: "4px", border: "1px solid rgba(255, 255, 255, 0.1)" }}
                    />
                  </div>
                )}

                {/* Sentence Context */}
                {(currentCard.sentence || currentCard.sentence_furigana) && (
                  <>
                    <hr className="hk-srs-context-divider" />
                    <div className="hk-srs-card__sentence-group">
                      <div className="hk-srs-card__sentence">
                        <RenderFurigana text={currentCard.sentence_furigana || currentCard.sentence || ""} />
                      </div>
                      {currentCard.sentence_meaning && (
                        <div className="hk-srs-card__sentence-meaning">
                          {currentCard.sentence_meaning}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="hk-srs-actions">
            {!showAnswer ? (
              <button 
                className="hk-btn hk-btn--primary hk-srs-btn--reveal" 
                onClick={() => setShowAnswer(true)}
              >
                {t("srs_btn_show_answer")} <span className="hk-shortcut-hint">Space</span>
              </button>
            ) : (
              <div className="hk-srs-grades">
                <button className="hk-btn hk-srs-btn--grade hk-srs-grade--1" onClick={() => handleReview(1)}>
                  <div className="hk-srs-grade__label">{t("srs_btn_again")}</div>
                  <div className="hk-shortcut-hint" style={{ fontSize: "11px", marginTop: "4px" }}>Press 1</div>
                </button>
                <button className="hk-btn hk-srs-btn--grade hk-srs-grade--3" onClick={() => handleReview(3)}>
                  <div className="hk-srs-grade__label">{t("srs_btn_hard")}</div>
                  <div className="hk-shortcut-hint" style={{ fontSize: "11px", marginTop: "4px" }}>Press 2</div>
                </button>
                <button className="hk-btn hk-srs-btn--grade hk-srs-grade--4" onClick={() => handleReview(4)}>
                  <div className="hk-srs-grade__label">{t("srs_btn_good")}</div>
                  <div className="hk-shortcut-hint" style={{ fontSize: "11px", marginTop: "4px" }}>Space / 3</div>
                </button>
                <button className="hk-btn hk-srs-btn--grade hk-srs-grade--5" onClick={() => handleReview(5)}>
                  <div className="hk-srs-grade__label">{t("srs_btn_easy")}</div>
                  <div className="hk-shortcut-hint" style={{ fontSize: "11px", marginTop: "4px" }}>Press 4</div>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default SrsReview;
