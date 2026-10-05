import { useState, useEffect } from "react";
import { localSrs } from "~/features/srs/local-srs";
import type { SrsCard } from "~/features/srs/local-srs";
import {
  Search,
  Download,
  Trash2,
  X,
  BookOpen,
  ArrowUpDown,
  Filter,
  Check,
  Brain,
  Upload,
} from "lucide-react";
import { useTranslation } from "~/shared/locales";
import { useSettingsStore } from "~/features/settings/settings-store";
import { EditCardModal } from "./edit-card-modal";
import { VocabularyTable } from "./vocabulary-table";
import { useVocabularyCards } from "./use-vocabulary-cards";
import { useVocabularyExports } from "./use-vocabulary-exports";

const ankiSvg = "/assets/logo/anki.png";

export function WordList({
  userId = "user_1",
  onStartReview,
}: {
  userId?: string;
  onStartReview?: () => void;
}) {
  const { t, isVietnamese, showHanViet, lang } = useTranslation();
  const { settings } = useSettingsStore();
  const { cards, setCards, loading, error, loadCards } = useVocabularyCards(
    userId,
    lang,
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [searchTerm, setSearchTerm] = useState("");
  const [displayLimit, setDisplayLimit] = useState(50);
  const [filterState, setFilterState] = useState("all");
  const [sortBy, setSortBy] = useState("created_desc");

  const [editingCard, setEditingCard] = useState<SrsCard | null>(null);

  useEffect(() => {
    setDisplayLimit(50);
  }, [searchTerm, filterState, sortBy]);

  const {
    ankiExporting,
    backupBusy,
    backupInputRef,
    handleExportCSV,
    handleBackup,
    handleRestore,
    handleExportAnki,
  } = useVocabularyExports({
    cards,
    selectedIds,
    settings,
    showHanViet,
    isVietnamese,
    t,
    loadCards,
  });

  const handleDelete = async (id: string) => {
    if (!confirm(t("vocab_confirm_delete"))) return;
    try {
      await localSrs.deleteSrsCard(id);
      setCards(cards.filter((c) => c.id !== id));
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
      setSelectedIds(new Set(targetCards.map((c) => c.id)));
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
    if (
      !confirm(
        isVietnamese
          ? `Bạn có chắc muốn xóa ${count} từ đã chọn?`
          : `Are you sure you want to delete ${count} selected words?`,
      )
    )
      return;

    try {
      for (const id of selectedIds) {
        await localSrs.deleteSrsCard(id);
      }
      setCards(cards.filter((c) => !selectedIds.has(c.id)));
      setSelectedIds(new Set());
    } catch (err) {
      console.error(err);
      alert("Failed to delete selected words.");
    }
  };

  const saveEdit = async (updated: SrsCard) => {
    try {
      const saved = await localSrs.updateSrsCard(updated.id, updated);
      setCards(cards.map((c) => (c.id === saved.id ? saved : c)));
      setEditingCard(null);
    } catch (err) {
      console.error(err);
      alert("Failed to save changes.");
    }
  };

  const handleResetLeech = async (id: string) => {
    try {
      const updated = await localSrs.resetLeechStatus(id);
      setCards(cards.map((c) => (c.id === id ? updated : c)));
    } catch (err) {
      console.error("Failed to reset leech status:", err);
    }
  };

  const filteredCards = cards.filter((c) => {
    const term = searchTerm.trim().toLowerCase();
    const matchesSearch =
      !term ||
      c.word.toLowerCase().includes(term) ||
      (c.reading && c.reading.toLowerCase().includes(term)) ||
      (c.meaning && c.meaning.toLowerCase().includes(term)) ||
      (showHanViet &&
        c.vietnamese_sound &&
        c.vietnamese_sound.toLowerCase().includes(term)) ||
      (c.tags &&
        c.tags.some((tag) =>
          tag.toLowerCase().includes(term.replace(/^#/, "")),
        ));

    if (!matchesSearch) return false;

    if (filterState === "new") return c.repetition === 0;
    if (filterState === "learning") return c.repetition > 0 && c.interval < 21;
    if (filterState === "graduated") return c.interval >= 21;
    if (filterState === "leech") return c.is_leech || (c.lapse_count || 0) >= 4;
    return true;
  });

  const sortedCards = [...filteredCards].sort((a, b) => {
    if (sortBy === "created_desc") return b.created_at - a.created_at;
    if (sortBy === "created_asc") return a.created_at - b.created_at;
    if (sortBy === "updated_desc") return b.updated_at - a.updated_at;
    if (sortBy === "freq_asc")
      return (a.frequency_rank || 999999) - (b.frequency_rank || 999999);
    if (sortBy === "due_asc") return a.due_date - b.due_date;
    if (sortBy === "due_desc") return b.due_date - a.due_date;
    if (sortBy === "word_asc") return a.word.localeCompare(b.word);
    return 0;
  });

  const displayedCards = sortedCards.slice(0, displayLimit);

  const dueCount = cards.filter((c) => c.due_date <= Date.now()).length;
  const newCount = cards.filter((c) => c.repetition === 0).length;
  const learningCount = cards.filter(
    (c) => c.repetition > 0 && c.interval < 21,
  ).length;
  const graduatedCount = cards.filter((c) => c.interval >= 21).length;
  const leechCount = cards.filter(
    (c) => c.is_leech || (c.lapse_count || 0) >= 4,
  ).length;
  const allDisplayedSelected =
    displayedCards.length > 0 &&
    displayedCards.every((c) => selectedIds.has(c.id));

  return (
    <div className="hk-content hk-fade-in" style={{ paddingBottom: "40px" }}>
      {/* ── Top Header Row ──────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "18px",
          flexWrap: "wrap",
          gap: "14px",
        }}
      >
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              marginBottom: "4px",
            }}
          >
            <BookOpen
              size={21}
              style={{ color: "var(--hk-accent-light, #c084fc)" }}
            />
            <h2
              style={{
                fontSize: "20px",
                fontWeight: 700,
                color: "var(--hk-text-primary)",
                margin: 0,
              }}
            >
              {t("vocab_title")}
            </h2>
          </div>
          <p
            style={{
              fontSize: "12.5px",
              color: "var(--hk-text-muted)",
              margin: 0,
            }}
          >
            {t("vocab_subtitle")} ({cards.length} {t("vocab_total_words")})
          </p>
        </div>

        {/* Global Action Buttons */}
        <div className="hk-vocab-actions">
          <input
            ref={backupInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleRestore}
            aria-label="Choose a Hakkutsu backup to restore"
            style={{ display: "none" }}
          />
          <button
            className="hk-btn hk-btn--secondary"
            onClick={() => backupInputRef.current?.click()}
            disabled={backupBusy}
            title="Restore a full vocabulary backup"
            aria-label="Restore a full vocabulary backup"
          >
            <Upload size={14} />
          </button>
          <button
            className="hk-btn hk-btn--secondary"
            onClick={handleBackup}
            disabled={backupBusy || cards.length === 0}
            title="Back up vocabulary and review progress"
            aria-label="Back up vocabulary and review progress"
          >
            <Download size={14} />
          </button>
          {onStartReview && cards.length > 0 && (
            <button
              className="hk-btn hk-btn--primary"
              onClick={onStartReview}
              style={{ fontSize: "12px", padding: "6px 14px", gap: "6px" }}
            >
              <Brain size={14} />
              {isVietnamese ? "Ôn tập" : "Review"}
              {dueCount > 0 && (
                <span
                  style={{
                    background: "#ef4444",
                    color: "#ffffff",
                    fontSize: "10px",
                    fontWeight: 700,
                    padding: "1px 6px",
                    borderRadius: "10px",
                    marginLeft: "2px",
                  }}
                >
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
                disabled={ankiExporting || settings.ankiEnabled === false}
                title={t("vocab_btn_export_anki")}
                style={{ fontSize: "12px", padding: "6px 12px", gap: "6px" }}
              >
                <img
                  src={ankiSvg}
                  alt="Anki"
                  style={{ width: 14, height: 14 }}
                />
                {ankiExporting ? "…" : "Anki"}
              </button>
              <button
                className="hk-btn hk-btn--secondary"
                onClick={() => handleExportCSV()}
                title={t("vocab_btn_export_csv")}
                style={{ fontSize: "12px", padding: "6px 12px", gap: "6px" }}
              >
                <Download size={14} />
                CSV
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Second Row: Search on Left + Filter & Sort on Right ─────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          marginBottom: "14px",
          flexWrap: "wrap",
        }}
      >
        {/* Left Side: Search Bar */}
        <div
          style={{
            position: "relative",
            flex: 1,
            maxWidth: "360px",
            minWidth: "200px",
          }}
        >
          <Search
            size={13}
            style={{
              position: "absolute",
              left: "10px",
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--hk-text-muted)",
              pointerEvents: "none",
            }}
          />
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
              outline: "none",
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
                alignItems: "center",
              }}
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* Right Side: Grouped Filter Select + Sort Select */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            flexWrap: "wrap",
          }}
        >
          {/* 1. Filter Select */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              background: "#18181b",
              border: "1px solid var(--hk-border)",
              borderRadius: "6px",
              padding: "0 8px 0 10px",
              height: "32px",
            }}
          >
            <Filter
              size={12}
              style={{ color: "var(--hk-accent-light, #c084fc)" }}
            />
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
                fontWeight: 500,
              }}
            >
              <option
                value="all"
                style={{ backgroundColor: "#18181b", color: "#f4f4f5" }}
              >
                {t("vocab_filter_all")} ({cards.length})
              </option>
              <option
                value="new"
                style={{ backgroundColor: "#18181b", color: "#f4f4f5" }}
              >
                {t("vocab_filter_new")} ({newCount})
              </option>
              <option
                value="learning"
                style={{ backgroundColor: "#18181b", color: "#f4f4f5" }}
              >
                {t("vocab_filter_learning")} ({learningCount})
              </option>
              <option
                value="graduated"
                style={{ backgroundColor: "#18181b", color: "#f4f4f5" }}
              >
                {t("vocab_filter_graduated")} ({graduatedCount})
              </option>
              <option
                value="leech"
                style={{ backgroundColor: "#18181b", color: "#ef4444" }}
              >
                🔥 {isVietnamese ? "Thẻ khó (Leech)" : "Leech Cards"} (
                {leechCount})
              </option>
            </select>
          </div>

          {/* 2. Sort Select */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              background: "#18181b",
              border: "1px solid var(--hk-border)",
              borderRadius: "6px",
              padding: "0 8px 0 10px",
              height: "32px",
            }}
          >
            <ArrowUpDown
              size={12}
              style={{ color: "var(--hk-accent-light, #c084fc)" }}
            />
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
                fontWeight: 500,
              }}
            >
              <option
                value="created_desc"
                style={{ backgroundColor: "#18181b", color: "#f4f4f5" }}
              >
                {t("vocab_sort_newest")}
              </option>
              <option
                value="created_asc"
                style={{ backgroundColor: "#18181b", color: "#f4f4f5" }}
              >
                {isVietnamese ? "Cũ nhất" : "Oldest First"}
              </option>
              <option
                value="updated_desc"
                style={{ backgroundColor: "#18181b", color: "#f4f4f5" }}
              >
                {isVietnamese ? "Mới cập nhật" : "Recently Updated"}
              </option>
              <option
                value="freq_asc"
                style={{ backgroundColor: "#18181b", color: "#f4f4f5" }}
              >
                {isVietnamese ? "Tần suất cao nhất" : "Highest Frequency"}
              </option>
              <option
                value="due_asc"
                style={{ backgroundColor: "#18181b", color: "#f4f4f5" }}
              >
                {t("vocab_sort_due_asc")}
              </option>
              <option
                value="due_desc"
                style={{ backgroundColor: "#18181b", color: "#f4f4f5" }}
              >
                {t("vocab_sort_due_desc")}
              </option>
              <option
                value="word_asc"
                style={{ backgroundColor: "#18181b", color: "#f4f4f5" }}
              >
                {t("vocab_sort_word_asc")}
              </option>
            </select>
          </div>
        </div>
      </div>

      {/* ── Bulk Actions Bar ────────────────────────────────────────────── */}
      {selectedIds.size > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "rgba(168, 85, 247, 0.12)",
            border: "1px solid rgba(168, 85, 247, 0.3)",
            borderRadius: "8px",
            padding: "8px 14px",
            marginBottom: "12px",
            fontSize: "12.5px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              color: "#e9d5ff",
              fontWeight: 600,
            }}
          >
            <Check size={15} style={{ color: "#c084fc" }} />
            <span>
              {selectedIds.size}{" "}
              {isVietnamese
                ? t("vocab_selected_count")
                : selectedIds.size === 1
                  ? "word selected"
                  : "words selected"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              className="hk-btn hk-btn--secondary"
              onClick={() => handleExportAnki()}
              disabled={ankiExporting || settings.ankiEnabled === false}
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
              style={{
                fontSize: "11.5px",
                padding: "4px 10px",
                color: "#f87171",
                gap: "5px",
              }}
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
          <div
            style={{
              textAlign: "center",
              padding: "48px 20px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: "44px",
                height: "44px",
                borderRadius: "50%",
                background: "rgba(255, 255, 255, 0.05)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: "12px",
                color: "var(--hk-text-muted)",
              }}
            >
              <BookOpen size={20} />
            </div>
            <h3
              style={{
                margin: "0 0 6px",
                fontSize: "14px",
                fontWeight: 500,
                color: "var(--hk-text-muted)",
              }}
            >
              {searchTerm ? t("vocab_empty_search") : t("vocab_empty")}
            </h3>
          </div>
        ) : (
          <div style={{ width: "100%", overflowX: "auto" }}>
            <VocabularyTable
              displayedCards={displayedCards}
              allDisplayedSelected={allDisplayedSelected}
              selectedIds={selectedIds}
              handleToggleSelectAll={handleToggleSelectAll}
              handleToggleSelect={handleToggleSelect}
              setEditingCard={setEditingCard}
              handleDelete={handleDelete}
              handleResetLeech={handleResetLeech}
              showHanViet={showHanViet}
            />
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

export default WordList;
