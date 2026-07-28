import { useState, useEffect } from "react";
import { localSrs, type SrsCard } from "~services/local-srs";
import { Search, Calendar, ListFilter } from "lucide-react";

export function WordList({ userId = "user_1" }: { userId?: string }) {
  const [cards, setCards] = useState<SrsCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [displayLimit, setDisplayLimit] = useState(50);
  const [showFilters, setShowFilters] = useState(false);
  const [filterState, setFilterState] = useState("all");
  const [sortBy, setSortBy] = useState("due_asc");

  useEffect(() => {
    setDisplayLimit(50);
  }, [searchTerm, filterState, sortBy]);

  useEffect(() => {
    loadCards();
  }, [userId]);

  const loadCards = async () => {
    try {
      setLoading(true);
      const data = await localSrs.getAllSrsCards();
      setCards(data);
    } catch (err: any) {
      setError(err.message || "Failed to load vocabulary");
    } finally {
      setLoading(false);
    }
  };

  const filteredCards = cards.filter(c => {
    const matchesSearch = c.word.includes(searchTerm) || 
      (c.reading && c.reading.includes(searchTerm)) || 
      (c.meaning && c.meaning.toLowerCase().includes(searchTerm.toLowerCase()));
    
    if (!matchesSearch) return false;

    if (filterState !== "all") {
      const state = c.repetition === 0 ? "new" : (c.interval < 21 ? "learning" : "graduated");
      if (state !== filterState) return false;
    }

    return true;
  }).sort((a, b) => {
    if (sortBy === "due_asc") return a.due_date - b.due_date;
    if (sortBy === "due_desc") return b.due_date - a.due_date;
    if (sortBy === "created_desc") return b.created_at - a.created_at;
    if (sortBy === "word_asc") return a.word.localeCompare(b.word);
    return 0;
  });

  const displayedCards = filteredCards.slice(0, displayLimit);

  if (loading) return <div style={{ padding: "40px", textAlign: "center" }}>⏳ Loading vocabulary...</div>;
  if (error) return <div style={{ padding: "40px", color: "var(--hk-accent-crimson)", textAlign: "center" }}>{error}</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* Search Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "24px", marginBottom: "8px" }}>
        
        {/* Title and Chip */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <h2 style={{ margin: 0, color: "var(--hk-text-primary)", fontWeight: "bold", whiteSpace: "nowrap" }}>Your Vocabulary</h2>
          <div style={{ fontSize: "12px", fontWeight: "600", color: "var(--hk-text-secondary)", backgroundColor: "var(--hk-bg-secondary)", padding: "4px 10px", borderRadius: "16px", border: "1px solid var(--hk-border)" }}>
            {filteredCards.length}
          </div>
        </div>
        
        {/* Search & Filter */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1, maxWidth: "500px" }}>
          <div style={{ position: "relative", flex: 1 }}>
            <Search size={18} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--hk-text-muted)" }} />
            <input 
              type="text" 
              placeholder="Search words, readings, meanings..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="hk-input__textarea"
              style={{ width: "100%", paddingLeft: "40px", minHeight: "auto", height: "44px", borderRadius: "8px", border: "1px solid var(--hk-border)", backgroundColor: "var(--hk-bg-primary)" }}
            />
          </div>
          <div style={{ position: "relative" }}>
            <button 
              onClick={() => setShowFilters(!showFilters)}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "44px", height: "44px", borderRadius: "8px", border: "1px solid var(--hk-border)", backgroundColor: showFilters ? "var(--hk-bg)" : "var(--hk-bg-secondary)", color: showFilters ? "var(--hk-accent-primary)" : "var(--hk-text-primary)", cursor: "pointer", transition: "all 0.2s" }}
              onMouseOver={(e) => e.currentTarget.style.backgroundColor = "var(--hk-bg)"}
              onMouseOut={(e) => e.currentTarget.style.backgroundColor = showFilters ? "var(--hk-bg)" : "var(--hk-bg-secondary)"}
              title="Filter / Sort"
            >
              <ListFilter size={18} />
            </button>
            
            {showFilters && (
              <div style={{ position: "absolute", top: "100%", right: 0, marginTop: "8px", backgroundColor: "var(--hk-bg-primary)", border: "1px solid var(--hk-border)", borderRadius: "12px", padding: "16px", zIndex: 10, width: "240px", boxShadow: "0 10px 30px rgba(0,0,0,0.3)" }}>
                <h4 style={{ margin: "0 0 12px 0", color: "var(--hk-text-primary)" }}>Sort By</h4>
                <select 
                  value={sortBy} 
                  onChange={(e) => setSortBy(e.target.value)}
                  style={{ width: "100%", padding: "8px", borderRadius: "8px", border: "1px solid var(--hk-border)", backgroundColor: "var(--hk-bg-secondary)", color: "var(--hk-text-primary)", marginBottom: "16px" }}
                >
                  <option value="due_asc">Next Review (Soonest)</option>
                  <option value="due_desc">Next Review (Latest)</option>
                  <option value="created_desc">Recently Added</option>
                  <option value="word_asc">Word (A-Z)</option>
                </select>

                <h4 style={{ margin: "0 0 12px 0", color: "var(--hk-text-primary)" }}>Filter State</h4>
                <select 
                  value={filterState} 
                  onChange={(e) => setFilterState(e.target.value)}
                  style={{ width: "100%", padding: "8px", borderRadius: "8px", border: "1px solid var(--hk-border)", backgroundColor: "var(--hk-bg-secondary)", color: "var(--hk-text-primary)" }}
                >
                  <option value="all">All Words</option>
                  <option value="new">New</option>
                  <option value="learning">Learning</option>
                  <option value="graduated">Graduated</option>
                </select>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* List Container */}
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {filteredCards.length === 0 ? (
          <div style={{ padding: "60px", textAlign: "center", color: "var(--hk-text-muted)", backgroundColor: "var(--hk-bg-secondary)", borderRadius: "12px", border: "1px dashed var(--hk-border)" }}>
            No vocabulary found matching your search.
          </div>
        ) : (
          displayedCards.map(card => (
            <div 
              key={card.id} 
              style={{ 
                display: "flex", 
                alignItems: "center", 
                justifyContent: "space-between",
                padding: "20px 24px",
                backgroundColor: "var(--hk-bg-secondary)",
                borderRadius: "12px",
                border: "1px solid var(--hk-border)",
                transition: "all 0.2s ease",
                cursor: "pointer"
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.2)";
                e.currentTarget.style.borderColor = "var(--hk-accent-secondary)";
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "none";
                e.currentTarget.style.borderColor = "var(--hk-border)";
              }}
            >
              {/* Left: Word & Reading */}
              <div style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: "150px" }}>
                <span style={{ fontSize: "22px", fontWeight: "bold", fontFamily: "var(--hk-font-jp)", color: "var(--hk-text-primary)" }}>
                  {card.word}
                </span>
                <span style={{ fontSize: "13px", color: "var(--hk-text-muted)", letterSpacing: "1px" }}>
                  {card.reading || "—"}
                </span>
              </div>
              
              {/* Middle: Meaning */}
              <div style={{ flex: 1, padding: "0 24px", color: "var(--hk-text-secondary)", fontSize: "15px", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                {card.meaning || "—"}
              </div>
              
              {/* Right: State & Date */}
              <div style={{ display: "flex", alignItems: "center", gap: "24px", minWidth: "200px", justifyContent: "flex-end" }}>
                <StateBadge state={card.repetition === 0 ? "new" : (card.interval < 21 ? "learning" : "graduated")} />
                
                <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--hk-text-muted)", fontSize: "13px" }}>
                  <Calendar size={14} />
                  <span>{new Date(card.due_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                </div>
              </div>
            </div>
          ))
        )}

        {displayLimit < filteredCards.length && (
          <button
            onClick={() => setDisplayLimit(prev => prev + 50)}
            style={{
              marginTop: "8px",
              padding: "12px",
              backgroundColor: "transparent",
              border: "1px solid var(--hk-border)",
              borderRadius: "8px",
              color: "var(--hk-text-secondary)",
              fontWeight: "600",
              cursor: "pointer",
              transition: "all 0.2s"
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.backgroundColor = "var(--hk-bg-secondary)";
              e.currentTarget.style.color = "var(--hk-text-primary)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
              e.currentTarget.style.color = "var(--hk-text-secondary)";
            }}
          >
            Load More ({filteredCards.length - displayLimit} remaining)
          </button>
        )}
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
    border = "1px solid rgba(239, 68, 68, 0.2)";
  } else if (state === "learning") {
    bg = "rgba(245, 158, 11, 0.1)";
    color = "#f59e0b";
    border = "1px solid rgba(245, 158, 11, 0.2)";
  } else if (state === "review") {
    bg = "rgba(59, 130, 246, 0.1)";
    color = "#3b82f6";
    border = "1px solid rgba(59, 130, 246, 0.2)";
  } else if (state === "graduated") {
    bg = "rgba(16, 185, 129, 0.1)";
    color = "#10b981";
    border = "1px solid rgba(16, 185, 129, 0.2)";
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
