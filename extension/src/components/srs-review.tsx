import { useEffect, useState, useCallback } from "react";
import { localSrs, type SrsCard, type SrsStats } from "~lib/services/local-srs";
import { PartyPopper, Volume2 } from "lucide-react";
import { useTranslation } from "~lib/languages/locales";
import { ttsService } from "~lib/services/tts-service";

export function SrsReview({ userId = "user_1" }: { userId?: string }) {
  const { t, isVietnamese, showHanViet } = useTranslation();
  const [cards, setCards] = useState<SrsCard[]>([]);
  const [stats, setStats] = useState<SrsStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);

  useEffect(() => {
    loadDueCards();
  }, [userId]);

  const loadDueCards = async () => {
    setLoading(true);
    setError(null);
    try {
      const dueCards = await localSrs.getDueCards();
      const currentStats = await localSrs.getSrsStats();
      setCards(dueCards);
      setStats(currentStats);
    } catch (err: any) {
      setError(err.message || "Failed to load due cards");
    } finally {
      setLoading(false);
    }
  };

  const handleReview = useCallback(async (quality: number) => {
    if (cards.length === 0) return;
    const currentCard = cards[0];
    
    // Optimistically remove from queue
    setCards(prev => prev.slice(1));
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

  const speakText = (text: string) => {
    ttsService.playJapanese(text);
  };

  useEffect(() => {
    if (showAnswer && cards.length > 0) {
      speakText(cards[0].word);
    }
  }, [showAnswer, cards]);

  // Keyboard accessibility
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      
      if (!showAnswer) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setShowAnswer(true);
        }
      } else {
        switch (e.key) {
          case "1":
            e.preventDefault();
            handleReview(1);
            break;
          case "2":
            e.preventDefault();
            handleReview(3);
            break;
          case "3":
            e.preventDefault();
            handleReview(4);
            break;
          case "4":
            e.preventDefault();
            handleReview(5);
            break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showAnswer, handleReview]);

  if (loading) {
    return (
      <div className="hk-srs-container hk-flex-center" style={{ minHeight: "350px" }}>
        <div className="hk-loading-spinner" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="hk-srs-container hk-flex-center" style={{ minHeight: "350px", color: "var(--hk-text-muted)" }}>
        <p>{error}</p>
        <button className="hk-btn hk-btn--secondary" onClick={loadDueCards} style={{ marginTop: "12px" }}>
          Retry
        </button>
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="hk-srs-empty">
        <div className="hk-srs-empty__icon">
          <PartyPopper size={40} />
        </div>
        <h3 className="hk-srs-empty__title">{t("srs_no_cards_title")}</h3>
        <p className="hk-srs-empty__desc">
          {t("srs_no_cards_desc")}
        </p>
      </div>
    );
  }

  const card = cards[0];

  return (
    <div className="hk-srs-container">
      {/* Top Session Progress Bar */}
      <div className="hk-srs-header">
        <div className="hk-srs-badge">
          <span className="hk-srs-badge__count">{cards.length}</span> {t("srs_card_count")}
        </div>
        {stats && (
          <div className="hk-srs-stats-micro">
            <span>{isVietnamese ? "Đã ôn hôm nay" : "Reviewed today"}: <b>{stats.cardsReviewedToday}</b></span>
          </div>
        )}
      </div>

      <div className="hk-srs-card">
        <div className="hk-srs-card__word" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
          {card.word}
          {showAnswer && (
            <button 
              onClick={() => speakText(card.word)}
              className="hk-btn hk-btn--ghost hk-btn--icon"
              style={{ padding: "4px", marginTop: "4px" }}
              title={t("def_play_audio_jp")}
            >
              <Volume2 size={20} style={{ color: "var(--hk-text-secondary)" }} />
            </button>
          )}
        </div>
        
        {showAnswer && (
          <div className="hk-fade-in-up hk-srs-card__answer">
            {/* Badges Row */}
            {(card.jlpt || (showHanViet && card.vietnamese_sound)) && (
              <div className="hk-srs-card__badges">
                {card.jlpt && <span className="hk-srs-card__badge hk-srs-card__badge--jlpt">{card.jlpt}</span>}
                {showHanViet && card.vietnamese_sound && (
                  <span className="hk-srs-card__badge hk-srs-card__badge--vi">{card.vietnamese_sound}</span>
                )}
              </div>
            )}

            {/* Primary Reading */}
            {(card.word_furigana || card.reading) && (
              <div className="hk-srs-card__reading">
                {card.word_furigana || card.reading}
              </div>
            )}

            {/* Meaning */}
            {card.meaning && (
              <div className="hk-srs-card__meaning">
                {card.meaning}
              </div>
            )}

            {/* Sentence Context */}
            {(card.sentence || card.sentence_furigana) && (
              <>
                <hr className="hk-srs-context-divider" />
                <div className="hk-srs-card__sentence-group">
                  <div className="hk-srs-card__sentence">
                    {card.sentence_furigana || card.sentence}
                  </div>
                  {card.sentence_meaning && (
                    <div className="hk-srs-card__sentence-meaning">
                      {card.sentence_meaning}
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
              <div className="hk-shortcut-hint" style={{ fontSize: "11px", marginTop: "4px" }}>Press 3</div>
            </button>
            <button className="hk-btn hk-srs-btn--grade hk-srs-grade--5" onClick={() => handleReview(5)}>
              <div className="hk-srs-grade__label">{t("srs_btn_easy")}</div>
              <div className="hk-shortcut-hint" style={{ fontSize: "11px", marginTop: "4px" }}>Press 4</div>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
