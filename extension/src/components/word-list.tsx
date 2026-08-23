import { useState, useEffect } from "react";
import { localSrs, type SrsCard } from "~lib/services/local-srs";
import { 
  Search, 
  Download, 
  Trash2, 
  Edit2, 
  X, 
  BookOpen, 
  Filter, 
  ArrowUpDown,
  Sparkles,
  Layers,
  Check
} from "lucide-react";
import { JlptBadge } from "~components/badges";
import { getHanViet } from "~lib/utils/hanviet-dict";
import { lookupWordEnglish } from "~lib/services/dictionary-lookup";

export function WordList({ userId = "user_1" }: { userId?: string }) {
  const [cards, setCards] = useState<SrsCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [searchTerm, setSearchTerm] = useState("");
  const [displayLimit, setDisplayLimit] = useState(50);
  const [filterState, setFilterState] = useState("all");
  const [sortBy, setSortBy] = useState("created_desc");

  const [editingCard, setEditingCard] = useState<SrsCard | null>(null);

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
      
      const updatedData = [...data];
      await Promise.all(
        updatedData.map(async (c, idx) => {
          if (!c.meaning || c.meaning.trim() === "" || c.meaning === "—") {
            const info = await lookupWordEnglish(c.word);
            if (info.meaning) {
              const patched = {
                ...c,
                meaning: info.meaning,
                reading: c.reading || info.reading,
                jlpt: c.jlpt || info.jlpt
              };
              updatedData[idx] = patched;
              localSrs.updateSrsCard(c.id, {
                meaning: info.meaning,
                reading: c.reading || info.reading,
                jlpt: c.jlpt || info.jlpt
              }).catch(() => {});
            }
          }
        })
      );

      setCards(updatedData);
    } catch (err: any) {
      setError(err.message || "Failed to load vocabulary");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this word?")) return;
    try {
      await localSrs.deleteSrsCard(id);
      setCards(cards.filter(c => c.id !== id));
    } catch (err) {
      console.error(err);
      alert("Failed to delete word.");
    }
  };

  const handleDeleteAll = async () => {
    if (!confirm("Are you sure you want to delete ALL vocabulary? This cannot be undone.")) return;
    try {
      await localSrs.deleteAllSrsCards();
      setCards([]);
    } catch (err) {
      console.error(err);
      alert("Failed to delete all words.");
    }
  };

  const handleExportCSV = () => {
    const headers = [
      "Word", "Word Reading", "Word Furigana", "Word Meaning", 
      "JLPT", "Vietnamese Sound", "Sentence", "Sentence Furigana", "Sentence Meaning"
    ];

    const escapeCsv = (str?: string) => {
      if (!str) return '""';
      return `"${str.replace(/"/g, '""')}"`;
    };

    const csvContent = [
      headers.join(","),
      ...cards.map(c => [
        escapeCsv(c.word),
        escapeCsv(c.reading),
        escapeCsv(c.word_furigana),
        escapeCsv(c.meaning),
        escapeCsv(c.jlpt),
        escapeCsv(c.vietnamese_sound),
        escapeCsv(c.sentence),
        escapeCsv(c.sentence_furigana),
        escapeCsv(c.sentence_meaning)
      ].join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `hakkutsu-vocabulary-${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const saveEdit = async (updated: SrsCard) => {
    try {
      const saved = await localSrs.updateSrsCard(updated.id, updated);
      setCards(cards.map(c => c.id === saved.id ? saved : c));
      setEditingCard(null);
    } catch (err) {
      console.error(err);
      alert("Failed to save changes.");
    }
  };

  const filteredCards = cards.filter(c => {
    const term = searchTerm.trim().toLowerCase();
    const matchesSearch = !term || 
      c.word.toLowerCase().includes(term) || 
      (c.reading && c.reading.toLowerCase().includes(term)) || 
      (c.meaning && c.meaning.toLowerCase().includes(term)) ||
      (c.vietnamese_sound && c.vietnamese_sound.toLowerCase().includes(term));
    
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

  // Status counts
  const newCount = cards.filter(c => c.repetition === 0).length;
  const learningCount = cards.filter(c => c.repetition > 0 && c.interval < 21).length;
  const graduatedCount = cards.filter(c => c.interval >= 21).length;

  if (loading) {
    return (
      <div className="hk-content hk-fade-in" style={{ textAlign: "center", padding: "60px 0" }}>
        <div className="hk-loading__spinner" style={{ margin: "0 auto 12px" }}></div>
        <p style={{ color: "var(--hk-text-muted)", fontSize: "14px" }}>Loading vocabulary deck...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="hk-content hk-fade-in">
        <div className="hk-srs-error">{error}</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }} className="hk-fade-in">
      {/* Streamlined Header & Control Bar */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: "16px",
        marginBottom: "20px"
      }}>
        {/* Title & Count Badge */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <h2 style={{ margin: 0, color: "#ffffff", fontSize: "20px", fontWeight: 700, letterSpacing: "-0.01em" }}>
            Vocabulary List
          </h2>
          <span style={{
            background: "rgba(168, 85, 247, 0.15)",
            color: "#d8b4fe",
            border: "1px solid rgba(168, 85, 247, 0.3)",
            fontSize: "12px",
            fontWeight: 700,
            padding: "2px 8px",
            borderRadius: "9999px"
          }}>
            {cards.length}
          </span>
        </div>

        {/* Action Buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button 
            className="hk-btn hk-btn--secondary" 
            onClick={handleExportCSV} 
            disabled={cards.length === 0}
            style={{
              borderRadius: "6px",
              padding: "6px 12px",
              fontSize: "12px",
              background: "rgba(255, 255, 255, 0.04)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              display: "flex",
              alignItems: "center",
              gap: "6px"
            }}
          >
            <Download size={13} /> Export CSV
          </button>
          
          <button 
            className="hk-btn" 
            onClick={handleDeleteAll} 
            disabled={cards.length === 0}
            style={{
              borderRadius: "6px",
              padding: "6px 12px",
              fontSize: "12px",
              color: "#f87171",
              background: "rgba(239, 68, 68, 0.08)",
              border: "1px solid rgba(239, 68, 68, 0.2)",
              display: "flex",
              alignItems: "center",
              gap: "6px"
            }}
          >
            <Trash2 size={13} /> Delete All
          </button>
        </div>
      </div>

      {/* Clean Control Strip (Un-nested Search, Filters & Sort) */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: "12px",
        marginBottom: "20px"
      }}>
        {/* Minimal Search Bar */}
        <div style={{ position: "relative", flex: "1 1 260px", maxWidth: "380px" }}>
          <Search 
            size={15} 
            style={{ 
              position: "absolute", 
              left: "12px", 
              top: "50%", 
              transform: "translateY(-50%)", 
              color: searchTerm ? "#a855f7" : "var(--hk-text-muted)"
            }} 
          />
          <input 
            type="text" 
            placeholder="Search word, reading, meaning..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 32px 8px 36px",
              background: "#121215",
              border: searchTerm ? "1px solid #a855f7" : "1px solid rgba(255, 255, 255, 0.1)",
              borderRadius: "8px",
              color: "#ffffff",
              fontSize: "13px",
              outline: "none",
              transition: "all 0.15s ease"
            }}
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              style={{
                position: "absolute",
                right: "8px",
                top: "50%",
                transform: "translateY(-50%)",
                background: "transparent",
                border: "none",
                color: "var(--hk-text-muted)",
                cursor: "pointer",
                padding: "2px",
                display: "flex",
                alignItems: "center"
              }}
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Clean Filter Pills */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {[
            { id: "all", label: "All", count: cards.length },
            { id: "new", label: "New", count: newCount },
            { id: "learning", label: "Learning", count: learningCount },
            { id: "graduated", label: "Graduated", count: graduatedCount },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setFilterState(tab.id)}
              style={{
                padding: "6px 12px",
                borderRadius: "6px",
                border: "none",
                fontSize: "12px",
                fontWeight: filterState === tab.id ? 600 : 500,
                color: filterState === tab.id ? "#ffffff" : "var(--hk-text-muted)",
                background: filterState === tab.id ? "rgba(168, 85, 247, 0.2)" : "rgba(255, 255, 255, 0.03)",
                cursor: "pointer",
                transition: "all 0.15s ease"
              }}
            >
              {tab.label} <span style={{ opacity: 0.7, fontSize: "11px", marginLeft: "2px" }}>({tab.count})</span>
            </button>
          ))}
        </div>

        {/* Sort Selector */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <ArrowUpDown size={14} style={{ color: "var(--hk-text-muted)" }} />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            style={{
              background: "#121215",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              borderRadius: "6px",
              color: "var(--hk-text-primary)",
              padding: "6px 10px",
              fontSize: "12px",
              outline: "none",
              cursor: "pointer"
            }}
          >
            <option value="created_desc">Newest First</option>
            <option value="due_asc">Due Date (Soonest)</option>
            <option value="due_desc">Due Date (Furthest)</option>
            <option value="word_asc">Word (A-Z)</option>
          </select>
        </div>
      </div>
      
      {/* Data Table / Empty State */}
      <div style={{
        background: "var(--hk-bg-secondary)",
        border: "1px solid var(--hk-border)",
        borderRadius: "12px",
        overflow: "hidden",
        boxShadow: "var(--hk-shadow-sm)"
      }}>
        {filteredCards.length === 0 ? (
          <div style={{
            textAlign: "center",
            padding: "64px 20px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center"
          }}>
            <div style={{
              width: "60px",
              height: "60px",
              borderRadius: "50%",
              background: "rgba(168, 85, 247, 0.12)",
              border: "1px solid rgba(168, 85, 247, 0.25)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: "16px",
              color: "#a855f7"
            }}>
              <BookOpen size={28} />
            </div>
            <h3 style={{ margin: "0 0 8px", fontSize: "16px", fontWeight: 600, color: "#ffffff" }}>
              {searchTerm ? "No Matching Words Found" : "No Vocabulary Saved Yet"}
            </h3>
            <p style={{ margin: 0, fontSize: "13px", color: "var(--hk-text-muted)", maxWidth: "420px", lineHeight: "1.5" }}>
              {searchTerm 
                ? `No cards matched "${searchTerm}". Try clearing the search filter.` 
                : "Double-click or highlight Japanese text on any website to look up dictionary definitions and save them to your deck."}
            </p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="hk-table" style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#0e0e12", borderBottom: "1px solid var(--hk-border)" }}>
                  <th style={{ padding: "12px 16px", textAlign: "left" }}>Word</th>
                  <th style={{ padding: "12px 16px", textAlign: "left" }}>Reading</th>
                  <th style={{ padding: "12px 16px", textAlign: "left" }}>Meaning</th>
                  <th style={{ padding: "12px 16px", textAlign: "left" }}>JLPT</th>
                  <th style={{ padding: "12px 16px", textAlign: "left" }}>Vietnamese Sound</th>
                  <th style={{ padding: "12px 16px", textAlign: "left" }}>Example Sentence</th>
                  <th style={{ padding: "12px 16px", textAlign: "center", width: "80px" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayedCards.map(card => (
                  <tr 
                    key={card.id}
                    style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.04)", transition: "background 0.15s ease" }}
                  >
                    {/* Word */}
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{
                        fontFamily: "var(--hk-font-jp)",
                        fontSize: "17px",
                        fontWeight: 700,
                        color: "#ffffff"
                      }}>
                        {card.word}
                      </div>
                    </td>

                    {/* Reading */}
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{
                        fontFamily: "var(--hk-font-jp)",
                        fontSize: "13.5px",
                        color: "#f472b6",
                        fontWeight: 500
                      }}>
                        {card.reading || "—"}
                      </div>
                    </td>

                    {/* Meaning */}
                    <td style={{ padding: "12px 16px", fontSize: "13px", color: "var(--hk-text-primary)", maxWidth: "220px" }}>
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={card.meaning}>
                        {card.meaning || "—"}
                      </div>
                    </td>

                    {/* JLPT */}
                    <td style={{ padding: "12px 16px" }}>
                      {card.jlpt ? <JlptBadge level={card.jlpt} /> : <span style={{ color: "var(--hk-text-muted)", fontSize: "12px" }}>—</span>}
                    </td>

                    {/* Sino-Vietnamese sound */}
                    <td style={{ padding: "12px 16px", fontSize: "13px", color: "var(--hk-text-secondary)", fontWeight: 500 }}>
                      {card.vietnamese_sound || getHanViet(card.word) || "—"}
                    </td>

                    {/* Sentence */}
                    <td style={{ padding: "12px 16px", fontSize: "13px", color: "var(--hk-text-muted)", maxWidth: "260px" }}>
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={card.sentence}>
                        {card.sentence || "—"}
                      </div>
                    </td>

                    {/* Actions */}
                    <td style={{ padding: "12px 16px", textAlign: "center" }}>
                      <div style={{ display: "inline-flex", gap: "4px" }}>
                        <button 
                          className="hk-btn hk-btn--ghost hk-btn--icon" 
                          onClick={() => setEditingCard(card)} 
                          title="Edit card"
                          style={{ padding: "6px" }}
                        >
                          <Edit2 size={14} />
                        </button>
                        <button 
                          className="hk-btn hk-btn--ghost hk-btn--icon" 
                          style={{ color: "#f87171", padding: "6px" }} 
                          onClick={() => handleDelete(card.id)} 
                          title="Delete card"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {displayLimit < filteredCards.length && (
        <button
          onClick={() => setDisplayLimit(prev => prev + 50)}
          className="hk-btn hk-btn--secondary"
          style={{ alignSelf: "center", width: "100%", maxWidth: "300px", padding: "10px 0" }}
        >
          Load More ({filteredCards.length - displayLimit} remaining)
        </button>
      )}

      {/* Edit Modal */}
      {editingCard && (
        <EditCardModal 
          card={editingCard} 
          onClose={() => setEditingCard(null)} 
          onSave={saveEdit} 
        />
      )}
    </div>
  );
}

function EditCardModal({ card, onClose, onSave }: { card: SrsCard, onClose: () => void, onSave: (c: SrsCard) => void }) {
  const [draft, setDraft] = useState<SrsCard>(card);

  const handleChange = (field: keyof SrsCard, value: string) => {
    setDraft(prev => ({ ...prev, [field]: value }));
  };

  return (
    <div className="hk-modal-overlay" onClick={onClose}>
      <div className="hk-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="hk-modal__header">
          <div className="hk-modal__title-group">
            <h3 className="hk-modal__title">
              <Sparkles size={18} style={{ color: "#c084fc" }} />
              Edit Vocabulary Word
            </h3>
            <span className="hk-modal__subtitle">
              Modify Japanese word properties, readings, and example sentence context
            </span>
          </div>
          <button 
            className="hk-btn hk-btn--ghost hk-btn--icon" 
            onClick={onClose}
            title="Close dialog (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="hk-modal__body">
          <form id="edit-word-form" onSubmit={(e) => { e.preventDefault(); onSave(draft); }}>
            {/* Section 1: Vocabulary Details */}
            <div className="hk-modal-section-title">
              <BookOpen size={13} />
              Vocabulary Details
            </div>
            
            <div className="hk-form-grid" style={{ marginBottom: "20px" }}>
              <FormGroup 
                label="Word / Surface" 
                value={draft.word} 
                onChange={(v) => handleChange("word", v)} 
                required 
                placeholder="e.g. 逮捕"
                isJp
              />
              <FormGroup 
                label="Word Reading (Kana)" 
                value={draft.reading} 
                onChange={(v) => handleChange("reading", v)} 
                placeholder="e.g. たいほ"
                isJp
              />
              <FormGroup 
                label="Word Furigana" 
                value={draft.word_furigana} 
                onChange={(v) => handleChange("word_furigana", v)} 
                placeholder="e.g. 逮捕[たいほ]"
                isJp
              />
              <FormGroup 
                label="Vietnamese Sound (Hán-Việt)" 
                value={draft.vietnamese_sound} 
                onChange={(v) => handleChange("vietnamese_sound", v)} 
                placeholder="e.g. ĐÃI BỔ"
              />
              
              <div className="hk-form-group">
                <label className="hk-form-label">JLPT Level</label>
                <select
                  className="hk-form-input"
                  value={draft.jlpt || ""}
                  onChange={(e) => handleChange("jlpt", e.target.value)}
                  style={{ background: "#09090b" }}
                >
                  <option value="">None / Unranked</option>
                  <option value="N5">JLPT N5 (Beginner)</option>
                  <option value="N4">JLPT N4 (Basic)</option>
                  <option value="N3">JLPT N3 (Intermediate)</option>
                  <option value="N2">JLPT N2 (Upper Intermediate)</option>
                  <option value="N1">JLPT N1 (Advanced)</option>
                </select>
              </div>

              <FormGroup 
                label="Word Meaning (Translation)" 
                value={draft.meaning} 
                onChange={(v) => handleChange("meaning", v)} 
                placeholder="e.g. Bắt giữ, bắt bớ"
              />
            </div>

            {/* Section 2: Sentence Context */}
            <div className="hk-modal-section-title">
              <Layers size={13} />
              Sentence Context
            </div>
            
            <div className="hk-form-grid">
              <FormGroup 
                label="Example Sentence (Japanese)" 
                value={draft.sentence} 
                onChange={(v) => handleChange("sentence", v)} 
                fullWidth 
                placeholder="e.g. 37歳の女性が逮捕されました"
                isJp
              />
              <FormGroup 
                label="Sentence Furigana" 
                value={draft.sentence_furigana} 
                onChange={(v) => handleChange("sentence_furigana", v)} 
                fullWidth 
                placeholder="Sentence reading furigana..."
                isJp
              />
              <FormGroup 
                label="Sentence Meaning" 
                value={draft.sentence_meaning} 
                onChange={(v) => handleChange("sentence_meaning", v)} 
                fullWidth 
                placeholder="Vietnamese or English translation of example sentence..."
              />
            </div>
          </form>
        </div>

        {/* Footer */}
        <div className="hk-modal__footer">
          <button 
            type="button" 
            className="hk-btn hk-btn--secondary" 
            onClick={onClose}
            style={{ padding: "8px 16px", fontSize: "13px" }}
          >
            Cancel
          </button>
          <button 
            type="submit" 
            form="edit-word-form" 
            className="hk-btn hk-btn--primary"
            style={{ padding: "8px 20px", fontSize: "13px", gap: "6px" }}
          >
            <Check size={15} />
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

function FormGroup({ 
  label, 
  value = "", 
  onChange, 
  required = false, 
  fullWidth = false,
  placeholder = "",
  isJp = false
}: { 
  label: string; 
  value?: string; 
  onChange: (v: string) => void; 
  required?: boolean; 
  fullWidth?: boolean;
  placeholder?: string;
  isJp?: boolean;
}) {
  return (
    <div className="hk-form-group" style={{ gridColumn: fullWidth ? "1 / -1" : "auto" }}>
      <label className="hk-form-label">{label}</label>
      <input 
        className={`hk-form-input ${isJp ? "hk-form-input--jp" : ""}`}
        value={value} 
        onChange={(e) => onChange(e.target.value)} 
        required={required}
        placeholder={placeholder}
      />
    </div>
  );
}
