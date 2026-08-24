import { useState, useEffect } from "react";
import { localSrs, type SrsCard } from "~lib/services/local-srs";
import { 
  Search, 
  Download, 
  Trash2, 
  Edit2, 
  X, 
  BookOpen, 
  ArrowUpDown, 
  Sparkles, 
  Layers, 
  Check,
  Brain,
  ExternalLink
} from "lucide-react";
import { JlptBadge } from "~components/Badges";
import { getHanViet } from "~lib/utils/hanviet-dict";
import { lookupWord } from "~lib/services/dictionary-lookup";
import { useTranslation } from "~lib/languages/locales";
import { ankiClient } from "~lib/services/anki-connect";

export function WordList({ 
  userId = "user_1",
  onStartReview
}: { 
  userId?: string;
  onStartReview?: () => void;
}) {
  const { t, isVietnamese, showHanViet, lang } = useTranslation();
  const [cards, setCards] = useState<SrsCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ankiExporting, setAnkiExporting] = useState(false);
  
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
  }, [userId, lang]);

  const loadCards = async () => {
    try {
      setLoading(true);
      const data = await localSrs.getAllSrsCards();
      
      const updatedData = [...data];
      await Promise.all(
        updatedData.map(async (c, idx) => {
          let updated = false;
          const patch: Partial<SrsCard> = {};

          if (!c.meaning || c.meaning.trim() === "" || c.meaning === "—" || !c.reading) {
            const info = await lookupWord(c.word, lang);
            if (info.meaning) {
              patch.meaning = info.meaning;
              patch.reading = c.reading || info.reading;
              patch.jlpt = c.jlpt || info.jlpt;
              updated = true;
            }
          }

          if (!c.word_furigana && c.reading) {
            patch.word_furigana = `${c.word}[${c.reading}]`;
            updated = true;
          }

          if (updated) {
            updatedData[idx] = { ...c, ...patch };
            localSrs.updateSrsCard(c.id, patch).catch(() => {});
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
    if (!confirm(t("vocab_confirm_delete"))) return;
    try {
      await localSrs.deleteSrsCard(id);
      setCards(cards.filter(c => c.id !== id));
    } catch (err) {
      console.error(err);
      alert("Failed to delete word.");
    }
  };

  const handleDeleteAll = async () => {
    if (!confirm(t("vocab_confirm_delete_all"))) return;
    try {
      await localSrs.deleteAllSrsCards();
      setCards([]);
    } catch (err) {
      console.error(err);
      alert("Failed to delete all words.");
    }
  };

  const handleExportCSV = () => {
    const headers = showHanViet ? [
      "Word", "Word Reading", "Word Furigana", "Word Meaning", 
      "JLPT", "Vietnamese Sound", "Sentence", "Sentence Furigana", "Sentence Meaning"
    ] : [
      "Word", "Word Reading", "Word Furigana", "Word Meaning", 
      "JLPT", "Sentence", "Sentence Furigana", "Sentence Meaning"
    ];

    const escapeCsv = (str?: string) => {
      if (!str) return '""';
      return `"${str.replace(/"/g, '""')}"`;
    };

    const csvContent = [
      headers.join(","),
      ...cards.map(c => {
        const row = [
          escapeCsv(c.word),
          escapeCsv(c.reading),
          escapeCsv(c.word_furigana),
          escapeCsv(c.meaning),
          escapeCsv(c.jlpt),
        ];
        if (showHanViet) {
          row.push(escapeCsv(c.vietnamese_sound || getHanViet(c.word)));
        }
        row.push(
          escapeCsv(c.sentence),
          escapeCsv(c.sentence_furigana),
          escapeCsv(c.sentence_meaning)
        );
        return row.join(",");
      })
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

  const handleExportAnki = async () => {
    try {
      setAnkiExporting(true);
      const connected = await ankiClient.isConnected();
      if (!connected) {
        alert(t("vocab_anki_not_connected"));
        return;
      }

      let count = 0;
      for (const card of cards) {
        await ankiClient.exportVocabulary({
          word: card.word,
          reading: card.reading,
          meaning: card.meaning,
          sentence: card.sentence,
          sentenceReading: card.sentence_furigana,
          jlptLevel: card.jlpt || "",
          pos: "Word"
        });
        count++;
      }
      alert(isVietnamese ? `Đã xuất ${count} từ sang Anki thành công!` : `Exported ${count} cards to Anki successfully!`);
    } catch (e: any) {
      console.error("Anki export error:", e);
      alert(e.message || "Failed to export to Anki");
    } finally {
      setAnkiExporting(false);
    }
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
      (showHanViet && c.vietnamese_sound && c.vietnamese_sound.toLowerCase().includes(term));

    if (!matchesSearch) return false;

    if (filterState === "new") return c.repetition === 0;
    if (filterState === "learning") return c.repetition > 0 && c.interval < 21;
    if (filterState === "graduated") return c.interval >= 21;
    return true;
  });

  const sortedCards = [...filteredCards].sort((a, b) => {
    if (sortBy === "created_desc") return b.created_at - a.created_at;
    if (sortBy === "due_asc") return a.due_date - b.due_date;
    if (sortBy === "due_desc") return b.due_date - a.due_date;
    if (sortBy === "word_asc") return a.word.localeCompare(b.word);
    return 0;
  });

  const displayedCards = sortedCards.slice(0, displayLimit);

  const dueCount = cards.filter(c => c.due_date <= Date.now()).length;
  const newCount = cards.filter(c => c.repetition === 0).length;
  const learningCount = cards.filter(c => c.repetition > 0 && c.interval < 21).length;
  const graduatedCount = cards.filter(c => c.interval >= 21).length;

  return (
    <div className="hk-content hk-fade-in" style={{ paddingBottom: "40px" }}>
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        marginBottom: "20px",
        flexWrap: "wrap",
        gap: "14px"
      }}>
        <div>
          <h2 style={{
            fontSize: "20px",
            fontWeight: 700,
            color: "var(--hk-text-primary)",
            margin: "0 0 4px"
          }}>
            {t("vocab_title")}
          </h2>
          <p style={{
            fontSize: "12px",
            color: "var(--hk-text-muted)",
            margin: 0
          }}>
            {t("vocab_subtitle")} ({cards.length} {t("vocab_total_words")})
          </p>
        </div>

        {/* Global Actions */}
        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          {onStartReview && cards.length > 0 && (
            <button 
              className="hk-btn hk-btn--primary"
              onClick={onStartReview}
              style={{ fontSize: "12px", padding: "6px 14px", gap: "6px" }}
            >
              <Brain size={14} />
              {t("vocab_btn_learn_srs")}
              {dueCount > 0 && (
                <span style={{
                  background: "#ef4444",
                  color: "#ffffff",
                  fontSize: "10px",
                  fontWeight: 700,
                  padding: "1px 6px",
                  borderRadius: "10px",
                  marginLeft: "2px"
                }}>
                  {dueCount}
                </span>
              )}
            </button>
          )}

          {cards.length > 0 && (
            <>
              <button 
                className="hk-btn hk-btn--secondary"
                onClick={handleExportAnki}
                disabled={ankiExporting}
                title={t("vocab_btn_export_anki")}
                style={{ fontSize: "12px", padding: "6px 12px", gap: "6px" }}
              >
                <ExternalLink size={14} />
                {ankiExporting ? t("vocab_anki_exporting") : t("vocab_btn_export_anki")}
              </button>
              <button 
                className="hk-btn hk-btn--secondary"
                onClick={handleExportCSV}
                title={t("vocab_btn_export_csv")}
                style={{ fontSize: "12px", padding: "6px 12px", gap: "6px" }}
              >
                <Download size={14} />
                {t("vocab_btn_export_csv")}
              </button>
              <button 
                className="hk-btn hk-btn--ghost"
                onClick={handleDeleteAll}
                title={t("vocab_btn_delete_all")}
                style={{ fontSize: "12px", padding: "6px 10px", color: "#f87171" }}
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Sleek Compact Toolbar */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "10px",
        marginBottom: "14px",
        flexWrap: "wrap"
      }}>
        {/* Compact Search Input */}
        <div style={{ position: "relative", flex: "1 1 200px", maxWidth: "300px" }}>
          <Search size={13} style={{
            position: "absolute",
            left: "10px",
            top: "50%",
            transform: "translateY(-50%)",
            color: "var(--hk-text-muted)",
            pointerEvents: "none"
          }} />
          <input
            type="text"
            placeholder={t("vocab_search_placeholder")}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              width: "100%",
              background: "var(--hk-bg-secondary)",
              border: "1px solid var(--hk-border)",
              borderRadius: "6px",
              padding: "6px 28px 6px 30px",
              color: "var(--hk-text-primary)",
              fontSize: "12px",
              outline: "none"
            }}
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              style={{
                position: "absolute",
                right: "6px",
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
              <X size={12} />
            </button>
          )}
        </div>

        {/* Compact Filter Pills */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "3px",
          background: "rgba(255, 255, 255, 0.03)",
          padding: "3px",
          borderRadius: "8px",
          border: "1px solid var(--hk-border)"
        }}>
          {[
            { id: "all", label: t("vocab_filter_all"), count: cards.length },
            { id: "new", label: t("vocab_filter_new"), count: newCount },
            { id: "learning", label: t("vocab_filter_learning"), count: learningCount },
            { id: "graduated", label: t("vocab_filter_graduated"), count: graduatedCount },
          ].map(tab => {
            const isActive = filterState === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setFilterState(tab.id)}
                style={{
                  padding: "4px 9px",
                  borderRadius: "6px",
                  border: "none",
                  fontSize: "11.5px",
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? "#ffffff" : "var(--hk-text-muted)",
                  background: isActive ? "var(--hk-accent-primary)" : "transparent",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  boxShadow: isActive ? "0 2px 8px rgba(168, 85, 247, 0.3)" : "none"
                }}
              >
                {tab.label} <span style={{ opacity: 0.75, fontSize: "10.5px" }}>({tab.count})</span>
              </button>
            );
          })}
        </div>

        {/* Compact Sort Selector */}
        <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
          <ArrowUpDown size={13} style={{ color: "var(--hk-text-muted)" }} />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            style={{
              background: "var(--hk-bg-secondary)",
              border: "1px solid var(--hk-border)",
              borderRadius: "6px",
              color: "var(--hk-text-primary)",
              padding: "5px 8px",
              fontSize: "11.5px",
              outline: "none",
              cursor: "pointer"
            }}
          >
            <option value="created_desc">{t("vocab_sort_newest")}</option>
            <option value="due_asc">{t("vocab_sort_due_asc")}</option>
            <option value="due_desc">{t("vocab_sort_due_desc")}</option>
            <option value="word_asc">{t("vocab_sort_word_asc")}</option>
          </select>
        </div>
      </div>
      
      {/* Data Table / Empty State */}
      <div style={{
        background: "var(--hk-bg-secondary)",
        border: "1px solid var(--hk-border)",
        borderRadius: "10px",
        overflow: "hidden",
        boxShadow: "var(--hk-shadow-sm)"
      }}>
        {filteredCards.length === 0 ? (
          <div style={{
            textAlign: "center",
            padding: "48px 20px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center"
          }}>
            <div style={{
              width: "48px",
              height: "48px",
              borderRadius: "50%",
              background: "rgba(168, 85, 247, 0.12)",
              border: "1px solid rgba(168, 85, 247, 0.25)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: "12px",
              color: "#a855f7"
            }}>
              <BookOpen size={22} />
            </div>
            <h3 style={{ margin: "0 0 6px", fontSize: "15px", fontWeight: 600, color: "#ffffff" }}>
              {searchTerm ? t("vocab_empty_search") : t("vocab_empty")}
            </h3>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="hk-table" style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#0e0e12", borderBottom: "1px solid var(--hk-border)" }}>
                  <th style={{ padding: "10px 14px", textAlign: "left", fontSize: "12px" }}>{t("vocab_th_word")}</th>
                  <th style={{ padding: "10px 14px", textAlign: "left", fontSize: "12px" }}>{t("vocab_th_reading")}</th>
                  <th style={{ padding: "10px 14px", textAlign: "left", fontSize: "12px" }}>{t("vocab_th_meaning")}</th>
                  <th style={{ padding: "10px 14px", textAlign: "left", fontSize: "12px" }}>{t("vocab_th_jlpt")}</th>
                  {showHanViet && (
                    <th style={{ padding: "10px 14px", textAlign: "left", fontSize: "12px" }}>{t("vocab_th_hanviet")}</th>
                  )}
                  <th style={{ padding: "10px 14px", textAlign: "left", fontSize: "12px" }}>{t("vocab_th_sentence")}</th>
                  <th style={{ padding: "10px 14px", textAlign: "center", width: "70px", fontSize: "12px" }}>{t("vocab_th_actions")}</th>
                </tr>
              </thead>
              <tbody>
                {displayedCards.map(card => (
                  <tr 
                    key={card.id}
                    style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.04)", transition: "background 0.15s ease" }}
                  >
                    {/* Word */}
                    <td style={{ padding: "10px 14px" }}>
                      <div style={{
                        fontFamily: "var(--hk-font-jp)",
                        fontSize: "16px",
                        fontWeight: 700,
                        color: "#ffffff"
                      }}>
                        {card.word}
                      </div>
                    </td>

                    {/* Reading */}
                    <td style={{ padding: "10px 14px" }}>
                      <div style={{
                        fontFamily: "var(--hk-font-jp)",
                        fontSize: "13px",
                        color: "#f472b6",
                        fontWeight: 500
                      }}>
                        {card.reading || "—"}
                      </div>
                    </td>

                    {/* Meaning */}
                    <td style={{ padding: "10px 14px", fontSize: "12.5px", color: "var(--hk-text-primary)", maxWidth: "200px" }}>
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={card.meaning}>
                        {card.meaning || "—"}
                      </div>
                    </td>

                    {/* JLPT */}
                    <td style={{ padding: "10px 14px" }}>
                      {card.jlpt ? <JlptBadge level={card.jlpt} /> : <span style={{ color: "var(--hk-text-muted)", fontSize: "11px" }}>—</span>}
                    </td>

                    {/* Sino-Vietnamese sound (Only if showHanViet enabled) */}
                    {showHanViet && (
                      <td style={{ padding: "10px 14px", fontSize: "12.5px", color: "#38bdf8", fontWeight: 600 }}>
                        {card.vietnamese_sound || getHanViet(card.word) || "—"}
                      </td>
                    )}

                    {/* Sentence */}
                    <td style={{ padding: "10px 14px", fontSize: "12.5px", color: "var(--hk-text-muted)", maxWidth: "240px" }}>
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={card.sentence}>
                        {card.sentence || "—"}
                      </div>
                    </td>

                    {/* Actions */}
                    <td style={{ padding: "10px 14px", textAlign: "center" }}>
                      <div style={{ display: "inline-flex", gap: "4px" }}>
                        <button 
                          className="hk-btn hk-btn--ghost hk-btn--icon" 
                          onClick={() => setEditingCard(card)} 
                          title="Edit"
                          style={{ padding: "5px" }}
                        >
                          <Edit2 size={13} />
                        </button>
                        <button 
                          className="hk-btn hk-btn--ghost hk-btn--icon" 
                          style={{ color: "#f87171", padding: "5px" }} 
                          onClick={() => handleDelete(card.id)} 
                          title="Delete"
                        >
                          <Trash2 size={13} />
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

      {/* Edit Modal */}
      {editingCard && (
        <EditCardModal 
          card={editingCard} 
          onClose={() => setEditingCard(null)} 
          onSave={saveEdit} 
          showHanViet={showHanViet}
        />
      )}
    </div>
  );
}

function EditCardModal({ 
  card, 
  onClose, 
  onSave, 
  showHanViet 
}: { 
  card: SrsCard; 
  onClose: () => void; 
  onSave: (c: SrsCard) => void;
  showHanViet: boolean;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<SrsCard>({ 
    ...card,
    word_furigana: card.word_furigana || (card.reading ? `${card.word}[${card.reading}]` : card.word)
  });

  const handleChange = (field: keyof SrsCard, val: any) => {
    setDraft(prev => ({ ...prev, [field]: val }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(draft);
  };

  return (
    <div className="hk-modal-backdrop" onClick={onClose}>
      <div 
        className="hk-modal" 
        onClick={(e) => e.stopPropagation()} 
        style={{ maxWidth: "580px" }}
      >
        {/* Header */}
        <div className="hk-modal__header">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Edit2 size={16} style={{ color: "#a855f7" }} />
            <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 600 }}>{t("vocab_modal_edit_title")}</h3>
          </div>
          <button 
            className="hk-modal__close" 
            onClick={onClose} 
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="hk-modal__body" style={{ maxHeight: "70vh", overflowY: "auto", padding: "18px" }}>
          <form id="edit-word-form" onSubmit={handleSubmit}>
            {/* Section 1: Basic Word Info */}
            <div className="hk-modal-section-title">
              <Sparkles size={12} />
              {t("vocab_modal_sec_details")}
            </div>
            
            <div className="hk-form-grid">
              <FormGroup 
                label={t("vocab_label_word")}
                value={draft.word} 
                onChange={(v) => handleChange("word", v)} 
                required 
                placeholder="e.g. 週間"
                isJp
              />
              <FormGroup 
                label={t("vocab_label_reading")}
                value={draft.reading} 
                onChange={(v) => handleChange("reading", v)} 
                placeholder="e.g. しゅうかん"
                isJp
              />
              <FormGroup 
                label={t("vocab_label_word_furigana")}
                value={draft.word_furigana} 
                onChange={(v) => handleChange("word_furigana", v)} 
                placeholder="e.g. 週間[しゅうかん]"
                isJp
              />
              {showHanViet && (
                <FormGroup 
                  label={t("vocab_label_hanviet")}
                  value={draft.vietnamese_sound} 
                  onChange={(v) => handleChange("vietnamese_sound", v)} 
                  placeholder="e.g. CHU GIAN"
                />
              )}
              
              <div className="hk-form-group">
                <label className="hk-form-label">{t("vocab_label_jlpt")}</label>
                <select
                  className="hk-form-input"
                  value={draft.jlpt || ""}
                  onChange={(e) => handleChange("jlpt", e.target.value)}
                  style={{ background: "#09090b" }}
                >
                  <option value="">None / Unranked</option>
                  <option value="N5">JLPT N5</option>
                  <option value="N4">JLPT N4</option>
                  <option value="N3">JLPT N3</option>
                  <option value="N2">JLPT N2</option>
                  <option value="N1">JLPT N1</option>
                </select>
              </div>

              <FormGroup 
                label={t("vocab_label_meaning")}
                value={draft.meaning} 
                onChange={(v) => handleChange("meaning", v)} 
                placeholder="Meaning translation..."
              />
            </div>

            {/* Section 2: Sentence Context */}
            <div className="hk-modal-section-title" style={{ marginTop: "16px" }}>
              <Layers size={12} />
              {t("vocab_modal_sec_sentence")}
            </div>
            
            <div className="hk-form-grid">
              <FormGroup 
                label={t("vocab_label_sentence")}
                value={draft.sentence} 
                onChange={(v) => handleChange("sentence", v)} 
                fullWidth 
                placeholder="Japanese example sentence..."
                isJp
              />
              <FormGroup 
                label={t("vocab_label_sentence_furigana")}
                value={draft.sentence_furigana} 
                onChange={(v) => handleChange("sentence_furigana", v)} 
                fullWidth 
                placeholder="Sentence reading furigana..."
                isJp
              />
              <FormGroup 
                label={t("vocab_label_sentence_meaning")}
                value={draft.sentence_meaning} 
                onChange={(v) => handleChange("sentence_meaning", v)} 
                fullWidth 
                placeholder="Sentence meaning in target language..."
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
            style={{ padding: "7px 14px", fontSize: "12px" }}
          >
            {t("vocab_modal_cancel")}
          </button>
          <button 
            type="submit" 
            form="edit-word-form" 
            className="hk-btn hk-btn--primary"
            style={{ padding: "7px 16px", fontSize: "12px", gap: "6px" }}
          >
            <Check size={14} />
            {t("vocab_modal_save")}
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
