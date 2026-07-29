import { useState, useEffect } from "react";
import { localSrs, type SrsCard } from "~services/local-srs";
import { Search, ListFilter, Download, Trash2, Edit2, X } from "lucide-react";

export function WordList({ userId = "user_1" }: { userId?: string }) {
  const [cards, setCards] = useState<SrsCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [searchTerm, setSearchTerm] = useState("");
  const [displayLimit, setDisplayLimit] = useState(50);
  const [filterState, setFilterState] = useState("all");
  const [sortBy, setSortBy] = useState("due_asc");

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
      setCards(data);
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
    const term = searchTerm.toLowerCase();
    const matchesSearch = c.word.toLowerCase().includes(term) || 
      (c.reading && c.reading.toLowerCase().includes(term)) || 
      (c.meaning && c.meaning.toLowerCase().includes(term));
    
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

  if (loading) return <div className="hk-content hk-fade-in"><div className="hk-loading__spinner"></div></div>;
  if (error) return <div className="hk-content hk-fade-in"><div className="hk-srs-error">{error}</div></div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* Header & Actions */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "24px", marginBottom: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <h2 style={{ margin: 0, color: "var(--hk-text-primary)", fontWeight: "bold" }}>Vocabulary List</h2>
          <div className="hk-badge hk-badge--pos">
            {filteredCards.length}
          </div>
        </div>
        
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{ position: "relative", width: "240px" }}>
            <Search size={16} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--hk-text-muted)" }} />
            <input 
              type="text" 
              placeholder="Search..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="hk-settings-input"
              style={{ width: "100%", paddingLeft: "36px" }}
            />
          </div>
          
          <button className="hk-btn hk-btn--secondary" onClick={handleExportCSV} title="Export to CSV">
            <Download size={16} /> Export
          </button>
          
          <button className="hk-btn hk-btn--secondary" style={{ color: "var(--hk-accent-crimson)", borderColor: "rgba(232, 93, 117, 0.3)" }} onClick={handleDeleteAll} title="Delete All">
            <Trash2 size={16} /> Delete All
          </button>
        </div>
      </div>
      
      {/* Data Table */}
      <div className="hk-table-container">
        {filteredCards.length === 0 ? (
          <div className="hk-empty">
            <div className="hk-empty__text">No vocabulary found.</div>
          </div>
        ) : (
          <table className="hk-table">
            <thead>
              <tr>
                <th>Word</th>
                <th>Word Reading</th>
                <th>Word Furigana</th>
                <th>Word Meaning</th>
                <th>JLPT</th>
                <th>Vietnamese Sound</th>
                <th>Sentence</th>
                <th>Sentence Furigana</th>
                <th>Sentence Meaning</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayedCards.map(card => (
                <tr key={card.id}>
                  <td className="hk-table-cell--bold">{card.word}</td>
                  <td>{card.reading || "—"}</td>
                  <td>{card.word_furigana || "—"}</td>
                  <td>{card.meaning || "—"}</td>
                  <td>{card.jlpt || "—"}</td>
                  <td>{card.vietnamese_sound || "—"}</td>
                  <td className="hk-table-cell--truncate" title={card.sentence}>{card.sentence || "—"}</td>
                  <td className="hk-table-cell--truncate" title={card.sentence_furigana}>{card.sentence_furigana || "—"}</td>
                  <td className="hk-table-cell--truncate" title={card.sentence_meaning}>{card.sentence_meaning || "—"}</td>
                  <td>
                    <div style={{ display: "flex", gap: "4px" }}>
                      <button className="hk-btn hk-btn--ghost hk-btn--icon" onClick={() => setEditingCard(card)} title="Edit">
                        <Edit2 size={14} />
                      </button>
                      <button className="hk-btn hk-btn--ghost hk-btn--icon" style={{ color: "var(--hk-accent-crimson)" }} onClick={() => handleDelete(card.id)} title="Delete">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {displayLimit < filteredCards.length && (
        <button
          onClick={() => setDisplayLimit(prev => prev + 50)}
          className="hk-btn hk-btn--secondary"
          style={{ alignSelf: "center", width: "100%", maxWidth: "300px" }}
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
    <div className="hk-modal-overlay">
      <div className="hk-modal hk-fade-in">
        <div className="hk-modal__header">
          <h3 className="hk-modal__title">Edit Word</h3>
          <button className="hk-btn hk-btn--ghost hk-btn--icon" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="hk-modal__body">
          <form className="hk-form-grid" onSubmit={(e) => { e.preventDefault(); onSave(draft); }}>
            <FormGroup label="Word" value={draft.word} onChange={(v) => handleChange("word", v)} required />
            <FormGroup label="Word Reading" value={draft.reading} onChange={(v) => handleChange("reading", v)} />
            <FormGroup label="Word Furigana" value={draft.word_furigana} onChange={(v) => handleChange("word_furigana", v)} />
            <FormGroup label="Word Meaning" value={draft.meaning} onChange={(v) => handleChange("meaning", v)} />
            <FormGroup label="JLPT" value={draft.jlpt} onChange={(v) => handleChange("jlpt", v)} />
            <FormGroup label="Vietnamese Sound" value={draft.vietnamese_sound} onChange={(v) => handleChange("vietnamese_sound", v)} />
            <FormGroup label="Sentence" value={draft.sentence} onChange={(v) => handleChange("sentence", v)} fullWidth />
            <FormGroup label="Sentence Furigana" value={draft.sentence_furigana} onChange={(v) => handleChange("sentence_furigana", v)} fullWidth />
            <FormGroup label="Sentence Meaning" value={draft.sentence_meaning} onChange={(v) => handleChange("sentence_meaning", v)} fullWidth />
          </form>
        </div>
        <div className="hk-modal__footer">
          <button className="hk-btn hk-btn--secondary" onClick={onClose}>Cancel</button>
          <button className="hk-btn hk-btn--primary" onClick={() => onSave(draft)}>Save Changes</button>
        </div>
      </div>
    </div>
  );
}

function FormGroup({ label, value = "", onChange, required = false, fullWidth = false }: { label: string, value?: string, onChange: (v: string) => void, required?: boolean, fullWidth?: boolean }) {
  return (
    <div className="hk-form-group" style={{ gridColumn: fullWidth ? "1 / -1" : "auto" }}>
      <label className="hk-form-label">{label}</label>
      <input 
        className="hk-settings-input" 
        style={{ width: "100%" }}
        value={value} 
        onChange={(e) => onChange(e.target.value)} 
        required={required}
      />
    </div>
  );
}
