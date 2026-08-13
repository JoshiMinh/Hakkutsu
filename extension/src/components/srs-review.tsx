import { useEffect, useState, useCallback } from "react";
import { localSrs, type SrsCard, type SrsStats } from "~lib/services/local-srs";
import { PartyPopper, Volume2 } from "lucide-react";

export function SrsReview({ userId = "user_1" }: { userId?: string }) {
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
      // We don't fetch stats here to keep UI snappy, but we can increment optimistically if we wanted
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
    if ("speechSynthesis" in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "ja-JP";
      utterance.rate = 0.9;
      window.speechSynthesis.cancel(); // Stop current speech
      window.speechSynthesis.speak(utterance);
    }
  };

  useEffect(() => {
    if (showAnswer && cards.length > 0) {
      speakText(cards[0].word);
    }
  }, [showAnswer, cards]);

  // Keyboard accessibility
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
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
      <div className="hk-content hk-fade-in hk-srs-empty">
        <div className="hk-loading__spinner" aria-label="Loading reviews"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="hk-content hk-fade-in hk-srs-empty">
        <div className="hk-srs-error" role="alert">{error}</div>
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="hk-content hk-fade-in hk-srs-empty">
        <div className="hk-srs-empty__icon"><PartyPopper size={48} style={{ color: "var(--hk-accent-primary)" }} /></div>
        <h3 className="hk-srs-empty__title">All caught up!</h3>
        <p className="hk-srs-empty__desc">No reviews due right now.</p>
        <button className="hk-btn hk-btn--secondary hk-mt-md" onClick={loadDueCards}>
          Refresh Queue
        </button>
      </div>
    );
  }

  const card = cards[0];
  const queueState = card.repetition === 0 ? "new" : (card.interval < 21 ? "learning" : "graduated");

  return (
    <div className="hk-content hk-fade-in hk-srs-container">
      <div className="hk-srs-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <span className="hk-srs-stat">Due: <strong>{cards.length}</strong></span>
          <span className="hk-srs-stat" style={{ marginLeft: "12px" }}>State: <strong className={`hk-srs-state--${queueState}`}>{queueState}</strong></span>
        </div>
        {stats && (
          <div className="hk-srs-stat" style={{ background: "var(--hk-bg-tertiary)", padding: "4px 8px", borderRadius: "12px", fontSize: "12px" }}>
            Reviewed today: <strong style={{ color: "var(--hk-accent-primary)" }}>{stats.cardsReviewedToday}</strong>
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
              title="Listen again"
            >
              <Volume2 size={20} style={{ color: "var(--hk-text-secondary)" }} />
            </button>
          )}
        </div>
        
        {showAnswer && (
          <div className="hk-fade-in-up hk-srs-card__answer">
            {/* Badges Row */}
            {(card.jlpt || card.vietnamese_sound) && (
              <div className="hk-srs-card__badges">
                {card.jlpt && <span className="hk-srs-card__badge hk-srs-card__badge--jlpt">{card.jlpt}</span>}
                {card.vietnamese_sound && <span className="hk-srs-card__badge hk-srs-card__badge--vi">{card.vietnamese_sound}</span>}
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
            Show Answer <span className="hk-shortcut-hint">Space</span>
          </button>
        ) : (
          <div className="hk-srs-grades">
            <button className="hk-btn hk-srs-btn--grade hk-srs-grade--1" onClick={() => handleReview(1)}>
              <div className="hk-srs-grade__label">Again</div>
              <div className="hk-shortcut-hint" style={{ fontSize: "11px", marginTop: "4px" }}>Press 1</div>
            </button>
            <button className="hk-btn hk-srs-btn--grade hk-srs-grade--3" onClick={() => handleReview(3)}>
              <div className="hk-srs-grade__label">Hard</div>
              <div className="hk-shortcut-hint" style={{ fontSize: "11px", marginTop: "4px" }}>Press 2</div>
            </button>
            <button className="hk-btn hk-srs-btn--grade hk-srs-grade--4" onClick={() => handleReview(4)}>
              <div className="hk-srs-grade__label">Good</div>
              <div className="hk-shortcut-hint" style={{ fontSize: "11px", marginTop: "4px" }}>Press 3</div>
            </button>
            <button className="hk-btn hk-srs-btn--grade hk-srs-grade--5" onClick={() => handleReview(5)}>
              <div className="hk-srs-grade__label">Easy</div>
              <div className="hk-shortcut-hint" style={{ fontSize: "11px", marginTop: "4px" }}>Press 4</div>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
