import { useState, useEffect } from "react";
import { apiClient } from "~services/api-client";

interface SrsCard {
  id: string;
  word: string;
  reading?: string;
  meaning?: string;
  sentence?: string;
  state: string;
  interval: number;
  next_review: string;
}

export function WordList({ userId = "user_1" }: { userId?: string }) {
  const [cards, setCards] = useState<SrsCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    loadCards();
  }, [userId]);

  const loadCards = async () => {
    try {
      setLoading(true);
      const data = await apiClient.getAllSrsCards(userId);
      setCards(data);
    } catch (err: any) {
      setError(err.message || "Failed to load vocabulary");
    } finally {
      setLoading(false);
    }
  };

  const filteredCards = cards.filter(c => 
    c.word.includes(searchTerm) || 
    (c.reading && c.reading.includes(searchTerm)) || 
    (c.meaning && c.meaning.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  if (loading) return <div style={{ padding: "40px", textAlign: "center" }}>⏳ Loading vocabulary...</div>;
  if (error) return <div style={{ padding: "40px", color: "var(--hk-accent-crimson)", textAlign: "center" }}>{error}</div>;

  return (
    <div style={{ backgroundColor: "var(--hk-bg-secondary)", borderRadius: "12px", border: "1px solid var(--hk-border)", overflow: "hidden" }}>
      <div style={{ padding: "16px", borderBottom: "1px solid var(--hk-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <input 
          type="text" 
          placeholder="Search words, readings, meanings..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="hk-input__textarea"
          style={{ width: "300px", minHeight: "auto", height: "40px" }}
        />
        <div style={{ fontSize: "14px", color: "var(--hk-text-muted)" }}>
          {filteredCards.length} {filteredCards.length === 1 ? 'word' : 'words'}
        </div>
      </div>
      
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
          <thead>
            <tr style={{ backgroundColor: "var(--hk-bg)", borderBottom: "1px solid var(--hk-border)", color: "var(--hk-text-muted)", fontSize: "12px", textTransform: "uppercase" }}>
              <th style={{ padding: "12px 16px", fontWeight: "600" }}>Word</th>
              <th style={{ padding: "12px 16px", fontWeight: "600" }}>Reading</th>
              <th style={{ padding: "12px 16px", fontWeight: "600" }}>Meaning</th>
              <th style={{ padding: "12px 16px", fontWeight: "600" }}>State</th>
              <th style={{ padding: "12px 16px", fontWeight: "600" }}>Next Review</th>
            </tr>
          </thead>
          <tbody>
            {filteredCards.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: "40px", textAlign: "center", color: "var(--hk-text-muted)" }}>
                  No vocabulary found.
                </td>
              </tr>
            ) : (
              filteredCards.map(card => (
                <tr key={card.id} style={{ borderBottom: "1px solid var(--hk-border)", transition: "background-color 0.2s" }} onMouseOver={(e) => e.currentTarget.style.backgroundColor = "var(--hk-bg)"} onMouseOut={(e) => e.currentTarget.style.backgroundColor = "transparent"}>
                  <td style={{ padding: "12px 16px", fontWeight: "bold", fontFamily: "var(--hk-font-jp)", fontSize: "18px" }}>{card.word}</td>
                  <td style={{ padding: "12px 16px", color: "var(--hk-text-secondary)" }}>{card.reading || "—"}</td>
                  <td style={{ padding: "12px 16px", color: "var(--hk-text-secondary)", maxWidth: "250px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={card.meaning}>{card.meaning || "—"}</td>
                  <td style={{ padding: "12px 16px" }}>
                    <StateBadge state={card.state} />
                  </td>
                  <td style={{ padding: "12px 16px", fontSize: "13px", color: "var(--hk-text-muted)" }}>
                    {new Date(card.next_review).toLocaleDateString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StateBadge({ state }: { state: string }) {
  let bg = "transparent";
  let color = "var(--hk-text-muted)";
  let border = "1px solid var(--hk-border)";
  
  if (state === "new") {
    bg = "rgba(239, 68, 68, 0.1)";
    color = "#ef4444";
    border = "1px solid rgba(239, 68, 68, 0.3)";
  } else if (state === "learning") {
    bg = "rgba(245, 158, 11, 0.1)";
    color = "#f59e0b";
    border = "1px solid rgba(245, 158, 11, 0.3)";
  } else if (state === "review") {
    bg = "rgba(59, 130, 246, 0.1)";
    color = "#3b82f6";
    border = "1px solid rgba(59, 130, 246, 0.3)";
  } else if (state === "graduated") {
    bg = "rgba(16, 185, 129, 0.1)";
    color = "#10b981";
    border = "1px solid rgba(16, 185, 129, 0.3)";
  }

  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: "12px",
      fontSize: "12px",
      fontWeight: "600",
      backgroundColor: bg,
      color: color,
      border: border,
      textTransform: "capitalize"
    }}>
      {state}
    </span>
  );
}
