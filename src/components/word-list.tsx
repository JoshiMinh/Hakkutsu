import { useState, useEffect } from "react";
import { localSrs } from "~lib/services/local-srs";
import type { SrsCard } from "~lib/services/local-srs";
import { 
  Search, 
  Download, 
  Trash2, 
  Edit2, 
  X, 
  BookOpen, 
  ArrowUpDown, 
  Filter,
  Sparkles, 
  Layers, 
  Check,
  Brain,
  ExternalLink,
  Image as ImageIcon
} from "lucide-react";
import { JlptBadge } from "~components/badges";
import { getHanViet } from "~lib/utils/hanviet-dict";
import { predictJlpt } from "~lib/utils/jlpt-classifier";
import { lookupWord } from "~lib/services/dictionary-lookup";
import { useTranslation } from "~lib/locales";
import { ankiClient } from "~lib/services/anki-connect";
import { useSettingsStore } from "~lib/utils/settings";
import ankiSvg from "data-base64:../../assets/logo/anki.png";

export function WordList({ 
  userId = "user_1",
  onStartReview
}: { 
  userId?: string;
  onStartReview?: () => void;
}) {
  const { t, isVietnamese, showHanViet, lang } = useTranslation();
  const { settings } = useSettingsStore();
  const [cards, setCards] = useState<SrsCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ankiExporting, setAnkiExporting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
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
      if (selectedIds.has(id)) {
        const next = new Set(selectedIds);
        next.delete(id);
        setSelectedIds(next);
      }
    } catch (err) {
      console.error(err);
      alert("Failed to delete word.");
    }
  };

  const handleToggleSelectAll = (targetCards: SrsCard[]) => {
    if (selectedIds.size === targetCards.length && targetCards.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(targetCards.map(c => c.id)));
    }
  };

  const handleToggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    if (!confirm(isVietnamese ? `Bạn có chắc muốn xóa ${count} từ đã chọn?` : `Are you sure you want to delete ${count} selected words?`)) return;

    try {
      for (const id of selectedIds) {
        await localSrs.deleteSrsCard(id);
      }
      setCards(cards.filter(c => !selectedIds.has(c.id)));
      setSelectedIds(new Set());
    } catch (err) {
      console.error(err);
      alert("Failed to delete selected words.");
    }
  };

  const handleExportCSV = (specificCards?: SrsCard[]) => {
    const targetCards = specificCards || (selectedIds.size > 0 ? cards.filter(c => selectedIds.has(c.id)) : cards);
    if (targetCards.length === 0) return;

    const headers = showHanViet ? [
      "Word", "Furigana", "Word Meaning", 
      "Han Viet", "Example Sentence", "JLPT"
    ] : [
      "Word", "Furigana", "Word Meaning", 
      "Example Sentence", "JLPT"
    ];

    const escapeCsv = (str?: string) => {
      if (!str) return '""';
      return `"${str.replace(/"/g, '""')}"`;
    };

    const csvContent = [
      headers.join(","),
      ...targetCards.map(c => {
        const row = [
          escapeCsv(c.word),
          escapeCsv(c.reading),
          escapeCsv(c.meaning),
        ];
        if (showHanViet) {
          row.push(escapeCsv(c.vietnamese_sound || getHanViet(c.word)));
        }
        row.push(
          escapeCsv(c.sentence),
          escapeCsv(c.jlpt)
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

  const handleExportAnki = async (specificCards?: SrsCard[]) => {
    const targetCards = specificCards || (selectedIds.size > 0 ? cards.filter(c => selectedIds.has(c.id)) : cards);
    if (targetCards.length === 0) return;

    try {
      setAnkiExporting(true);
      const connected = await ankiClient.isConnected();
      if (!connected) {
        alert(t("vocab_anki_not_connected") || "AnkiConnect is not connected. Please ensure Anki app is running with AnkiConnect enabled.");
        return;
      }

      let count = 0;
      const errors: string[] = [];

      for (const card of targetCards) {
        try {
          await ankiClient.exportVocabulary(
            {
              word: card.word,
              reading: card.reading,
              meaning: card.meaning,
              sentence: card.sentence,
              sentenceReading: card.sentence_furigana,
              jlptLevel: card.jlpt || "",
              pos: "Word",
              imageUrl: card.image_url
            },
            settings.ankiDeck,
            settings.ankiModel,
            settings.ankiFieldMap
          );
          count++;
        } catch (cardErr: any) {
          console.error(`Anki export error for "${card.word}":`, cardErr);
          errors.push(`"${card.word}": ${cardErr.message || cardErr}`);
        }
      }

      if (errors.length > 0) {
        if (count > 0) {
          alert(isVietnamese 
            ? `Đã xuất ${count}/${targetCards.length} từ sang Anki.\n\nMột số từ bị lỗi:\n${errors.slice(0, 5).join("\n")}${errors.length > 5 ? `\nvà ${errors.length - 5} lỗi khác...` : ""}`
            : `Exported ${count}/${targetCards.length} cards to Anki.\n\nFailed items:\n${errors.slice(0, 5).join("\n")}${errors.length > 5 ? `\nand ${errors.length - 5} more errors...` : ""}`
          );
        } else {
          alert(isVietnamese 
            ? `Xuất sang Anki thất bại:\n${errors.slice(0, 5).join("\n")}`
            : `Failed to export to Anki:\n${errors.slice(0, 5).join("\n")}`
          );
        }
      } else {
        alert(isVietnamese ? `Đã xuất ${count} từ sang Anki thành công!` : `Exported ${count} cards to Anki successfully!`);
      }
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
  const allDisplayedSelected = displayedCards.length > 0 && displayedCards.every(c => selectedIds.has(c.id));

  return (
    <div className="hk-content hk-fade-in" style={{ paddingBottom: "40px" }}>
      {/* ── Top Header Row ──────────────────────────────────────────────── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: "18px",
        flexWrap: "wrap",
        gap: "14px"
      }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
            <BookOpen size={21} style={{ color: "var(--hk-accent-light, #c084fc)" }} />
            <h2 style={{
              fontSize: "20px",
              fontWeight: 700,
              color: "var(--hk-text-primary)",
              margin: 0
            }}>
              {t("vocab_title")}
            </h2>
          </div>
          <p style={{
            fontSize: "12.5px",
            color: "var(--hk-text-muted)",
            margin: 0
          }}>
            {t("vocab_subtitle")} ({cards.length} {t("vocab_total_words")})
          </p>
        </div>

        {/* Global Action Buttons */}
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
                onClick={() => handleExportAnki()}
                disabled={ankiExporting}
                title={t("vocab_btn_export_anki")}
                style={{ fontSize: "12px", padding: "6px 12px", gap: "6px" }}
              >
                <img src={ankiSvg} alt="Anki" style={{ width: 14, height: 14 }} />
                {ankiExporting ? t("vocab_anki_exporting") : t("vocab_btn_export_anki")}
              </button>
              <button 
                className="hk-btn hk-btn--secondary"
                onClick={() => handleExportCSV()}
                title={t("vocab_btn_export_csv")}
                style={{ fontSize: "12px", padding: "6px 12px", gap: "6px" }}
              >
                <Download size={14} />
                {t("vocab_btn_export_csv")}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Second Row: Search on Left + Filter & Sort on Right ─────────── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
        marginBottom: "14px",
        flexWrap: "wrap"
      }}>
        {/* Left Side: Search Bar */}
        <div style={{ position: "relative", flex: 1, maxWidth: "360px", minWidth: "200px" }}>
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
              height: "32px",
              background: "var(--hk-bg-secondary)",
              border: "1px solid var(--hk-border)",
              borderRadius: "6px",
              padding: "0 26px 0 30px",
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

        {/* Right Side: Grouped Filter Select + Sort Select */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          {/* 1. Filter Select */}
          <div style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            background: "#18181b",
            border: "1px solid var(--hk-border)",
            borderRadius: "6px",
            padding: "0 8px 0 10px",
            height: "32px"
          }}>
            <Filter size={12} style={{ color: "var(--hk-accent-light, #c084fc)" }} />
            <select
              value={filterState}
              onChange={(e) => setFilterState(e.target.value)}
              style={{
                background: "#18181b",
                border: "none",
                color: "#ffffff",
                fontSize: "12px",
                outline: "none",
                cursor: "pointer",
                fontWeight: 500
              }}
            >
              <option value="all" style={{ backgroundColor: "#18181b", color: "#f4f4f5" }}>
                {t("vocab_filter_all")} ({cards.length})
              </option>
              <option value="new" style={{ backgroundColor: "#18181b", color: "#f4f4f5" }}>
                {t("vocab_filter_new")} ({newCount})
              </option>
              <option value="learning" style={{ backgroundColor: "#18181b", color: "#f4f4f5" }}>
                {t("vocab_filter_learning")} ({learningCount})
              </option>
              <option value="graduated" style={{ backgroundColor: "#18181b", color: "#f4f4f5" }}>
                {t("vocab_filter_graduated")} ({graduatedCount})
              </option>
            </select>
          </div>

          {/* 2. Sort Select */}
          <div style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            background: "#18181b",
            border: "1px solid var(--hk-border)",
            borderRadius: "6px",
            padding: "0 8px 0 10px",
            height: "32px"
          }}>
            <ArrowUpDown size={12} style={{ color: "var(--hk-accent-light, #c084fc)" }} />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              style={{
                background: "#18181b",
                border: "none",
                color: "#ffffff",
                fontSize: "12px",
                outline: "none",
                cursor: "pointer",
                fontWeight: 500
              }}
            >
              <option value="created_desc" style={{ backgroundColor: "#18181b", color: "#f4f4f5" }}>
                {t("vocab_sort_newest")}
              </option>
              <option value="due_asc" style={{ backgroundColor: "#18181b", color: "#f4f4f5" }}>
                {t("vocab_sort_due_asc")}
              </option>
              <option value="due_desc" style={{ backgroundColor: "#18181b", color: "#f4f4f5" }}>
                {t("vocab_sort_due_desc")}
              </option>
              <option value="word_asc" style={{ backgroundColor: "#18181b", color: "#f4f4f5" }}>
                {t("vocab_sort_word_asc")}
              </option>
            </select>
          </div>
        </div>
      </div>

      {/* ── Bulk Actions Bar ────────────────────────────────────────────── */}
      {selectedIds.size > 0 && (
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "rgba(168, 85, 247, 0.12)",
          border: "1px solid rgba(168, 85, 247, 0.3)",
          borderRadius: "8px",
          padding: "8px 14px",
          marginBottom: "12px",
          fontSize: "12.5px"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#e9d5ff", fontWeight: 600 }}>
            <Check size={15} style={{ color: "#c084fc" }} />
            <span>
              {selectedIds.size} {isVietnamese ? t("vocab_selected_count") : (selectedIds.size === 1 ? "word selected" : "words selected")}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              className="hk-btn hk-btn--secondary"
              onClick={() => handleExportAnki()}
              disabled={ankiExporting}
              style={{ fontSize: "11.5px", padding: "4px 10px", gap: "5px" }}
            >
              <img src={ankiSvg} alt="Anki" style={{ width: 13, height: 13 }} />
              {t("vocab_btn_export_selected_anki")}
            </button>
            <button
              className="hk-btn hk-btn--secondary"
              onClick={() => handleExportCSV()}
              style={{ fontSize: "11.5px", padding: "4px 10px", gap: "5px" }}
            >
              <Download size={12} />
              {t("vocab_btn_export_selected_csv")}
            </button>
            <button
              className="hk-btn hk-btn--ghost"
              onClick={handleBatchDelete}
              style={{ fontSize: "11.5px", padding: "4px 10px", color: "#f87171", gap: "5px" }}
            >
              <Trash2 size={12} />
              {t("vocab_btn_delete_selected")}
            </button>
            <button
              className="hk-btn hk-btn--ghost"
              onClick={() => setSelectedIds(new Set())}
              style={{ fontSize: "11.5px", padding: "4px 8px" }}
              title="Deselect All"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      )}
      
      {/* ── Data Table / Empty State ────────────────────────────────────── */}
      <div style={{ width: "100%" }}>
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
              width: "44px",
              height: "44px",
              borderRadius: "50%",
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: "12px",
              color: "var(--hk-text-muted)"
            }}>
              <BookOpen size={20} />
            </div>
            <h3 style={{ margin: "0 0 6px", fontSize: "14px", fontWeight: 500, color: "var(--hk-text-muted)" }}>
              {searchTerm ? t("vocab_empty_search") : t("vocab_empty")}
            </h3>
          </div>
        ) : (
          <div style={{ width: "100%", overflowX: "auto" }}>
            <table className="hk-table" style={{ width: "100%", minWidth: "940px", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "transparent", borderBottom: "1px solid rgba(255, 255, 255, 0.1)" }}>
                  {/* Select All Checkbox */}
                  <th style={{ padding: "10px 8px", width: "36px", textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={allDisplayedSelected}
                      onChange={() => handleToggleSelectAll(displayedCards)}
                      style={{ cursor: "pointer", accentColor: "#a855f7" }}
                    />
                  </th>
                  <th style={{ padding: "10px 6px", textAlign: "center", fontSize: "12px", width: "52px" }}>Image</th>
                  <th style={{ padding: "10px 10px", textAlign: "left", fontSize: "12px", minWidth: "100px" }}>{t("vocab_th_word")}</th>
                  <th style={{ padding: "10px 10px", textAlign: "left", fontSize: "12px", minWidth: "100px" }}>{t("vocab_th_furigana")}</th>
                  <th style={{ padding: "10px 10px", textAlign: "left", fontSize: "12px", minWidth: "160px" }}>{t("vocab_th_meaning")}</th>
                  {showHanViet && (
                    <th style={{ padding: "10px 10px", textAlign: "left", fontSize: "12px", minWidth: "100px" }}>{t("vocab_th_hanviet")}</th>
                  )}
                  <th style={{ padding: "10px 10px", textAlign: "left", fontSize: "12px", minWidth: "180px" }}>{t("vocab_th_sentence")}</th>
                  <th style={{ padding: "10px 6px", textAlign: "center", fontSize: "12px", width: "52px" }}>{t("vocab_th_jlpt")}</th>
                  <th style={{ padding: "10px 6px", textAlign: "center", fontSize: "12px", width: "80px" }}>Status</th>
                  <th style={{ padding: "10px 6px", textAlign: "center", width: "64px", fontSize: "12px" }}>{t("vocab_th_actions")}</th>
                </tr>
              </thead>
              <tbody>
                {displayedCards.map(card => {
                  const isSelected = selectedIds.has(card.id);
                  return (
                    <tr 
                      key={card.id}
                      style={{
                        borderBottom: "1px solid rgba(255, 255, 255, 0.04)",
                        background: isSelected ? "rgba(168, 85, 247, 0.08)" : "transparent",
                        transition: "background 0.15s ease"
                      }}
                    >
                      {/* Checkbox */}
                      <td style={{ padding: "10px 8px", textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelect(card.id)}
                          style={{ cursor: "pointer", accentColor: "#a855f7" }}
                        />
                      </td>

                      {/* Image Visual */}
                      <td style={{ padding: "6px", textAlign: "center" }}>
                        {card.image_url ? (
                          <img
                            src={card.image_url}
                            alt={card.word}
                            style={{ width: "36px", height: "36px", objectFit: "contain", borderRadius: "6px", background: "#18181b" }}
                          />
                        ) : (
                          <span style={{ color: "#52525b", fontSize: "10px" }}>—</span>
                        )}
                      </td>

                      {/* 1. Word */}
                      <td style={{ padding: "10px 12px" }}>
                        <div style={{
                          fontFamily: "var(--hk-font-jp)",
                          fontSize: "15px",
                          fontWeight: 700,
                          color: "#ffffff",
                          wordBreak: "break-word"
                        }}>
                          {card.word}
                        </div>
                      </td>

                      {/* 2. Furigana */}
                      <td style={{ padding: "10px 12px" }}>
                        <div style={{
                          fontFamily: "var(--hk-font-jp)",
                          fontSize: "13px",
                          color: "#f472b6",
                          fontWeight: 500,
                          wordBreak: "break-word"
                        }}>
                          {card.reading || "—"}
                        </div>
                      </td>

                      {/* 3. Meaning */}
                      <td style={{ padding: "10px 12px" }}>
                        <div 
                          style={{ 
                            fontSize: "12.5px", 
                            color: "var(--hk-text-primary)", 
                            lineHeight: "1.4",
                            wordBreak: "break-word",
                            display: "-webkit-box",
                            WebkitLineClamp: 3,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden"
                          }} 
                          title={card.meaning}
                        >
                          {card.meaning || "—"}
                        </div>
                      </td>

                      {/* 4. Han-Viet (if enabled) */}
                      {showHanViet && (
                        <td style={{ padding: "10px 12px" }}>
                          <div style={{ fontSize: "12px", color: "#38bdf8", fontWeight: 600, letterSpacing: "0.3px", wordBreak: "break-word" }}>
                            {card.vietnamese_sound || getHanViet(card.word) || "—"}
                          </div>
                        </td>
                      )}

                      {/* 5. Example Sentence */}
                      <td style={{ padding: "10px 12px" }}>
                        <div 
                          style={{ 
                            fontSize: "12.5px", 
                            color: "var(--hk-text-muted)", 
                            fontFamily: "var(--hk-font-jp)", 
                            lineHeight: "1.5",
                            wordBreak: "break-word",
                            display: "-webkit-box",
                            WebkitLineClamp: 3,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden"
                          }} 
                          title={card.sentence}
                        >
                          {card.sentence || "—"}
                        </div>
                      </td>

                      {/* 6. JLPT */}
                      <td style={{ padding: "10px 8px", textAlign: "center" }}>
                        {(card.jlpt || predictJlpt(card.word)) ? (
                          <JlptBadge level={card.jlpt || predictJlpt(card.word)} />
                        ) : (
                          <span style={{ color: "var(--hk-text-muted)", fontSize: "11px" }}>—</span>
                        )}
                      </td>

                      {/* 7. SRS Status */}
                      <td style={{ padding: "10px 8px", textAlign: "center" }}>
                        {card.repetition === 0 ? (
                          <span style={{ fontSize: "10px", fontWeight: 600, padding: "2px 7px", borderRadius: "10px", background: "rgba(59, 130, 246, 0.15)", color: "#60a5fa", border: "1px solid rgba(59, 130, 246, 0.3)" }}>
                            {t("vocab_filter_new")}
                          </span>
                        ) : card.due_date <= Date.now() ? (
                          <span style={{ fontSize: "10px", fontWeight: 700, padding: "2px 7px", borderRadius: "10px", background: "rgba(245, 158, 11, 0.15)", color: "#fbbf24", border: "1px solid rgba(245, 158, 11, 0.3)" }}>
                            Due
                          </span>
                        ) : (
                          <span style={{ fontSize: "10px", fontWeight: 600, padding: "2px 7px", borderRadius: "10px", background: "rgba(34, 197, 94, 0.15)", color: "#4ade80", border: "1px solid rgba(34, 197, 94, 0.3)" }}>
                            {t("vocab_filter_graduated")}
                          </span>
                        )}
                      </td>

                      {/* 8. Actions */}
                      <td style={{ padding: "10px 8px", textAlign: "center" }}>
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
                  );
                })}
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
    <div className="hk-modal-overlay" onClick={onClose}>
      <div 
        className="hk-modal" 
        onClick={(e) => e.stopPropagation()} 
        style={{
          maxWidth: "600px",
          width: "92%",
          background: "#141418",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          borderRadius: "12px",
          boxShadow: "0 20px 50px rgba(0, 0, 0, 0.7)"
        }}
      >
        {/* Header */}
        <div className="hk-modal__header" style={{
          padding: "16px 20px",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between"
        }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#ffffff" }}>
              {t("vocab_modal_edit_title")}
            </h3>
            <span style={{ fontSize: "11px", color: "var(--hk-text-muted)", fontFamily: "var(--hk-font-jp)" }}>
              {card.word} {card.reading ? `(${card.reading})` : ""}
            </span>
          </div>
          <button 
            className="hk-modal__close" 
            onClick={onClose} 
            title="Close"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--hk-text-muted)",
              cursor: "pointer",
              padding: "6px",
              borderRadius: "6px",
              display: "flex"
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="hk-modal__body" style={{ maxHeight: "72vh", overflowY: "auto", padding: "20px" }}>
          <form id="edit-word-form" onSubmit={handleSubmit}>
            {/* Section 1: Basic Word Details */}
            <div className="hk-modal-section-title" style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "11px",
              fontWeight: 600,
              letterSpacing: "0.5px",
              textTransform: "uppercase",
              color: "var(--hk-text-muted)",
              marginBottom: "12px"
            }}>
              <Sparkles size={13} />
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
                <label className="hk-form-label" style={{ fontSize: "11.5px", color: "var(--hk-text-secondary)", marginBottom: "4px", display: "block" }}>
                  {t("vocab_label_jlpt")}
                </label>
                <select
                  className="hk-form-input"
                  value={draft.jlpt || ""}
                  onChange={(e) => handleChange("jlpt", e.target.value)}
                  style={{
                    background: "#09090b",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    borderRadius: "8px",
                    color: "#ffffff",
                    padding: "8px 10px",
                    fontSize: "12.5px",
                    width: "100%",
                    outline: "none"
                  }}
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

            {/* Section 2: Illustration Image */}
            <div className="hk-modal-section-title" style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "11px",
              fontWeight: 600,
              letterSpacing: "0.5px",
              textTransform: "uppercase",
              color: "var(--hk-text-muted)",
              marginTop: "18px",
              marginBottom: "12px"
            }}>
              <ImageIcon size={13} />
              Illustration Image URL
            </div>
            
            <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
              <div style={{ flex: 1 }}>
                <FormGroup 
                  label="Image URL"
                  value={draft.image_url} 
                  onChange={(v) => handleChange("image_url", v)} 
                  fullWidth
                  placeholder="https://www.irasutoya.com/... image URL"
                />
              </div>
              {draft.image_url && (
                <div style={{
                  width: "60px",
                  height: "60px",
                  borderRadius: "8px",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                  background: "#09090d",
                  overflow: "hidden",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  marginTop: "20px"
                }}>
                  <img src={draft.image_url} alt="Preview" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                </div>
              )}
            </div>

            {/* Section 3: Sentence Context */}
            <div className="hk-modal-section-title" style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "11px",
              fontWeight: 600,
              letterSpacing: "0.5px",
              textTransform: "uppercase",
              color: "var(--hk-text-muted)",
              marginTop: "18px",
              marginBottom: "12px"
            }}>
              <Layers size={13} />
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
        <div className="hk-modal__footer" style={{
          padding: "14px 20px",
          borderTop: "1px solid rgba(255, 255, 255, 0.08)",
          display: "flex",
          justifyContent: "flex-end",
          gap: "10px"
        }}>
          <button 
            type="button" 
            className="hk-btn hk-btn--secondary" 
            onClick={onClose}
            style={{ padding: "8px 16px", fontSize: "12.5px", borderRadius: "8px" }}
          >
            {t("vocab_modal_cancel")}
          </button>
          <button 
            type="submit" 
            form="edit-word-form" 
            className="hk-btn hk-btn--primary"
            style={{
              padding: "8px 20px",
              fontSize: "12.5px",
              fontWeight: 600,
              gap: "6px",
              borderRadius: "8px",
              background: "#7c3aed",
              border: "none",
              boxShadow: "none"
            }}
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

export default WordList;
