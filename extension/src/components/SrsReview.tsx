import { useEffect, useState } from "react";
import { localSrs, type SrsCard } from "~services/local-srs";

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

  const handleReview = async (quality: number) => {
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
  };

  if (loading) {
    return (
      <div className="hk-content hk-fade-in" style={{ textAlign: "center", padding: 20 }}>
        ⏳ Loading reviews...
      </div>
    );
  }

  if (error) {
    return (
      <div className="hk-content hk-fade-in" style={{ padding: 20, color: "var(--hk-accent-crimson)" }}>
        {error}
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="hk-content hk-fade-in" style={{ textAlign: "center", padding: 40 }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>🎉</div>
        <h3 style={{ color: "var(--hk-text)", margin: 0 }}>All caught up!</h3>
        <p style={{ color: "var(--hk-text-muted)" }}>No reviews due right now.</p>
        <button className="hk-btn hk-btn--secondary" onClick={loadDueCards} style={{ marginTop: 16 }}>
          Refresh
        </button>
      </div>
    );
  }

  const card = cards[0];

  return (
    <div className="hk-content hk-fade-in" style={{ padding: 16, display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, color: "var(--hk-text-muted)", fontSize: 12 }}>
        <span>Reviews due: {cards.length}</span>
        <span>State: {card.repetition === 0 ? "new" : (card.interval < 21 ? "learning" : "graduated")}</span>
      </div>

      <div style={{ 
        flex: 1, 
        display: "flex", 
        flexDirection: "column", 
        alignItems: "center", 
        justifyContent: "center",
        background: "var(--hk-bg-secondary)",
        borderRadius: 12,
        padding: 24,
        marginBottom: 16,
        border: "1px solid var(--hk-border)"
      }}>
        <div style={{ fontSize: 48, fontWeight: "bold", fontFamily: "var(--hk-font-jp)", marginBottom: showAnswer && card.reading ? 8 : 24 }}>
          {card.word}
        </div>
        
        {showAnswer && (
          <div className="hk-fade-in" style={{ textAlign: "center" }}>
            {card.reading && (
              <div style={{ fontSize: 18, color: "var(--hk-text-muted)", marginBottom: 16 }}>
                {card.reading}
              </div>
            )}
            {card.meaning && (
              <div style={{ fontSize: 16, color: "var(--hk-text)", marginBottom: 16, borderTop: "1px solid var(--hk-border)", paddingTop: 16 }}>
                {card.meaning}
              </div>
            )}
            {card.sentence && (
              <div style={{ fontSize: 13, color: "var(--hk-text-secondary)", fontStyle: "italic" }}>
                "{card.sentence}"
              </div>
            )}
          </div>
        )}
      </div>

      {!showAnswer ? (
        <button className="hk-btn hk-btn--primary" style={{ padding: 12 }} onClick={() => setShowAnswer(true)}>
          Show Answer
        </button>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
          <button className="hk-btn hk-btn--secondary" style={{ color: "#ef4444", padding: "8px 4px" }} onClick={() => handleReview(1)}>
            Again (1)
          </button>
          <button className="hk-btn hk-btn--secondary" style={{ color: "#f59e0b", padding: "8px 4px" }} onClick={() => handleReview(3)}>
            Hard (3)
          </button>
          <button className="hk-btn hk-btn--secondary" style={{ color: "#10b981", padding: "8px 4px" }} onClick={() => handleReview(4)}>
            Good (4)
          </button>
          <button className="hk-btn hk-btn--secondary" style={{ color: "#3b82f6", padding: "8px 4px" }} onClick={() => handleReview(5)}>
            Easy (5)
          </button>
        </div>
      )}
    </div>
  );
}
