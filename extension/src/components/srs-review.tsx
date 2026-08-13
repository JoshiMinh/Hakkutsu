import { useEffect, useState, useCallback } from "react";
import { localSrs, type SrsCard } from "~lib/services/local-srs";
import { PartyPopper } from "lucide-react";

export function SrsReview({ userId = "user_1" }: { userId?: string }) {
  const [cards, setCards] = useState<SrsCard[]>([]);
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
      setCards(dueCards);
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
    } catch (err) {
      console.error("Failed to submit review", err);
    }
  }, [cards]);

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
      <div className="hk-srs-header">
        <span className="hk-srs-stat">Reviews due: <strong>{cards.length}</strong></span>
        <span className="hk-srs-stat">State: <strong className={`hk-srs-state--${queueState}`}>{queueState}</strong></span>
      </div>

      <div className="hk-srs-card">
        <div className="hk-srs-card__word">
          {card.word}
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
              <span className="hk-srs-grade__label">Again</span>
              <span className="hk-shortcut-hint">1</span>
            </button>
            <button className="hk-btn hk-srs-btn--grade hk-srs-grade--3" onClick={() => handleReview(3)}>
              <span className="hk-srs-grade__label">Hard</span>
              <span className="hk-shortcut-hint">2</span>
            </button>
            <button className="hk-btn hk-srs-btn--grade hk-srs-grade--4" onClick={() => handleReview(4)}>
              <span className="hk-srs-grade__label">Good</span>
              <span className="hk-shortcut-hint">3</span>
            </button>
            <button className="hk-btn hk-srs-btn--grade hk-srs-grade--5" onClick={() => handleReview(5)}>
              <span className="hk-srs-grade__label">Easy</span>
              <span className="hk-shortcut-hint">4</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
