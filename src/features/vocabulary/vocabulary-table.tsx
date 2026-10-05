import type { SrsCard } from "~/features/srs/local-srs";
import { Trash2, Edit2 } from "lucide-react";
import { JlptBadge, FrequencyBadge } from "~/shared/ui/badges";
import { getHanViet } from "~/shared/japanese/hanviet-dict";
import { predictJlpt } from "~/shared/japanese/jlpt-classifier";
import { useTranslation } from "~/shared/locales";

interface VocabularyTableProps {
  displayedCards: SrsCard[];
  allDisplayedSelected: boolean;
  selectedIds: Set<string>;
  handleToggleSelectAll: (cards: SrsCard[]) => void;
  handleToggleSelect: (id: string) => void;
  setEditingCard: (card: SrsCard) => void;
  handleDelete: (id: string) => Promise<void>;
  handleResetLeech: (id: string) => Promise<void>;
  showHanViet: boolean;
}

export function VocabularyTable({
  displayedCards,
  allDisplayedSelected,
  selectedIds,
  handleToggleSelectAll,
  handleToggleSelect,
  setEditingCard,
  handleDelete,
  handleResetLeech,
  showHanViet,
}: VocabularyTableProps) {
  const { t } = useTranslation();
  return (
    <table
      className="hk-table hk-vocab-table"
      style={{ width: showHanViet ? "1566px" : "1446px" }}
    >
      <colgroup>
        <col style={{ width: 36 }} />
        <col style={{ width: 52 }} />
        <col style={{ width: 110 }} />
        <col style={{ width: 120 }} />
        <col style={{ width: 220 }} />
        {showHanViet ? <col style={{ width: 120 }} /> : null}
        <col style={{ width: 260 }} />
        <col style={{ width: 60 }} />
        <col style={{ width: 104 }} />
        <col style={{ width: 104 }} />
        <col style={{ width: 96 }} />
        <col style={{ width: 96 }} />
        <col style={{ width: 120 }} />
        <col style={{ width: 68 }} />
      </colgroup>
      <thead>
        <tr
          style={{
            background: "transparent",
            borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
          }}
        >
          {/* Select All Checkbox */}
          <th
            style={{ padding: "10px 8px", width: "36px", textAlign: "center" }}
          >
            <input
              type="checkbox"
              checked={allDisplayedSelected}
              onChange={() => handleToggleSelectAll(displayedCards)}
              style={{ cursor: "pointer", accentColor: "#a855f7" }}
            />
          </th>
          <th
            style={{
              padding: "10px 6px",
              textAlign: "center",
              fontSize: "12px",
              width: "48px",
            }}
          >
            Image
          </th>
          <th
            style={{
              padding: "10px 10px",
              textAlign: "left",
              fontSize: "12px",
              minWidth: "90px",
            }}
          >
            {t("vocab_th_word")}
          </th>
          <th
            style={{
              padding: "10px 10px",
              textAlign: "left",
              fontSize: "12px",
              minWidth: "90px",
            }}
          >
            {t("vocab_th_furigana")}
          </th>
          <th
            style={{
              padding: "10px 10px",
              textAlign: "left",
              fontSize: "12px",
            }}
          >
            {t("vocab_th_meaning")}
          </th>
          {showHanViet && (
            <th
              style={{
                padding: "10px 10px",
                textAlign: "left",
                fontSize: "12px",
                minWidth: "90px",
              }}
            >
              {t("vocab_th_hanviet")}
            </th>
          )}
          <th
            style={{
              padding: "10px 10px",
              textAlign: "left",
              fontSize: "12px",
            }}
          >
            {t("vocab_th_sentence")}
          </th>
          <th
            style={{
              padding: "10px 6px",
              textAlign: "center",
              fontSize: "12px",
              width: "52px",
            }}
          >
            {t("vocab_th_jlpt")}
          </th>
          <th
            style={{
              padding: "10px 8px",
              textAlign: "center",
              fontSize: "12px",
              width: "90px",
            }}
          >
            {t("vocab_th_frequency")}
          </th>
          <th
            style={{
              padding: "10px 8px",
              textAlign: "center",
              fontSize: "12px",
              width: "130px",
            }}
          >
            {t("vocab_th_proficiency_status")}
          </th>
          <th
            style={{
              padding: "10px 8px",
              textAlign: "center",
              fontSize: "12px",
              width: "95px",
            }}
          >
            {t("vocab_th_added_date")}
          </th>
          <th
            style={{
              padding: "10px 8px",
              textAlign: "center",
              fontSize: "12px",
              width: "95px",
            }}
          >
            {t("vocab_th_updated_date")}
          </th>
          <th
            style={{
              padding: "10px 8px",
              textAlign: "left",
              fontSize: "12px",
              minWidth: "110px",
            }}
          >
            {t("vocab_th_tags")}
          </th>
          <th
            style={{
              padding: "10px 6px",
              textAlign: "center",
              width: "64px",
              fontSize: "12px",
            }}
          >
            {t("vocab_th_actions")}
          </th>
        </tr>
      </thead>
      <tbody>
        {displayedCards.map((card) => {
          const isSelected = selectedIds.has(card.id);
          const isDue = card.due_date <= Date.now();
          return (
            <tr
              key={card.id}
              style={{
                borderBottom: "1px solid rgba(255, 255, 255, 0.04)",
                background: isSelected
                  ? "rgba(168, 85, 247, 0.08)"
                  : "transparent",
                transition: "background 0.15s ease",
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
                    style={{
                      width: "36px",
                      height: "36px",
                      objectFit: "contain",
                      borderRadius: "6px",
                      background: "#18181b",
                    }}
                  />
                ) : (
                  <span style={{ color: "#52525b", fontSize: "10px" }}>—</span>
                )}
              </td>

              {/* 1. Word */}
              <td
                className="hk-vocab-cell--clip"
                style={{ padding: "10px 12px" }}
              >
                <div
                  style={{
                    fontFamily: "var(--hk-font-jp)",
                    fontSize: "15px",
                    fontWeight: 700,
                    color: "#ffffff",
                    whiteSpace: "nowrap",
                  }}
                >
                  {card.word}
                </div>
              </td>

              {/* 2. Furigana */}
              <td
                className="hk-vocab-cell--clip"
                style={{ padding: "10px 12px" }}
              >
                <div
                  style={{
                    fontFamily: "var(--hk-font-jp)",
                    fontSize: "13px",
                    color: "#f472b6",
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                  }}
                >
                  {card.reading || "—"}
                </div>
              </td>

              {/* 3. Meaning */}
              <td
                className="hk-vocab-cell--clip"
                style={{ padding: "10px 12px" }}
                title={card.meaning}
              >
                <div
                  style={{
                    fontSize: "12.5px",
                    color: "var(--hk-text-primary)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {card.meaning || "—"}
                </div>
              </td>

              {/* 4. Han-Viet (if enabled) */}
              {showHanViet && (
                <td
                  className="hk-vocab-cell--clip"
                  style={{ padding: "10px 12px" }}
                >
                  <div
                    style={{
                      fontSize: "12px",
                      color: "#38bdf8",
                      fontWeight: 600,
                      letterSpacing: "0.3px",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {card.vietnamese_sound || getHanViet(card.word) || "—"}
                  </div>
                </td>
              )}

              {/* 5. Example Sentence */}
              <td
                className="hk-vocab-cell--clip"
                style={{ padding: "10px 12px" }}
                title={card.sentence}
              >
                <div
                  style={{
                    fontSize: "12.5px",
                    color: "var(--hk-text-muted)",
                    fontFamily: "var(--hk-font-jp)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {card.sentence || "—"}
                </div>
              </td>

              {/* 6. JLPT */}
              <td style={{ padding: "10px 8px", textAlign: "center" }}>
                {card.jlpt || predictJlpt(card.word) ? (
                  <JlptBadge level={card.jlpt || predictJlpt(card.word)} />
                ) : (
                  <span
                    style={{ color: "var(--hk-text-muted)", fontSize: "11px" }}
                  >
                    —
                  </span>
                )}
              </td>

              {/* 7. Frequency */}
              <td style={{ padding: "10px 8px", textAlign: "center" }}>
                {card.frequency_rank ? (
                  <FrequencyBadge rank={card.frequency_rank} />
                ) : (
                  <span
                    style={{ color: "var(--hk-text-muted)", fontSize: "11px" }}
                  >
                    —
                  </span>
                )}
              </td>

              {/* 8. Proficiency / SRS Status */}
              <td style={{ padding: "10px 8px", textAlign: "center" }}>
                {card.repetition === 0 ? (
                  <span
                    style={{
                      fontSize: "10px",
                      fontWeight: 600,
                      padding: "2px 7px",
                      borderRadius: "10px",
                      background: "rgba(59, 130, 246, 0.15)",
                      color: "#60a5fa",
                      border: "1px solid rgba(59, 130, 246, 0.3)",
                    }}
                  >
                    {t("vocab_filter_new")}
                  </span>
                ) : isDue ? (
                  <span
                    style={{
                      fontSize: "10px",
                      fontWeight: 700,
                      padding: "2px 7px",
                      borderRadius: "10px",
                      background: "rgba(245, 158, 11, 0.15)",
                      color: "#fbbf24",
                      border: "1px solid rgba(245, 158, 11, 0.3)",
                    }}
                  >
                    Due
                  </span>
                ) : card.interval >= 21 ? (
                  <span
                    style={{
                      fontSize: "10px",
                      fontWeight: 600,
                      padding: "2px 7px",
                      borderRadius: "10px",
                      background: "rgba(34, 197, 94, 0.15)",
                      color: "#4ade80",
                      border: "1px solid rgba(34, 197, 94, 0.3)",
                    }}
                  >
                    {t("vocab_filter_graduated")} ({card.interval}d)
                  </span>
                ) : (
                  <span
                    style={{
                      fontSize: "10px",
                      fontWeight: 600,
                      padding: "2px 7px",
                      borderRadius: "10px",
                      background: "rgba(168, 85, 247, 0.15)",
                      color: "#c084fc",
                      border: "1px solid rgba(168, 85, 247, 0.3)",
                    }}
                  >
                    {t("vocab_filter_learning")} ({card.interval}d)
                  </span>
                )}
              </td>

              {/* 9. Added Date */}
              <td style={{ padding: "10px 8px", textAlign: "center" }}>
                <span
                  style={{
                    fontSize: "11px",
                    color: "var(--hk-text-muted)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {new Date(card.created_at).toLocaleDateString()}
                </span>
              </td>

              {/* 10. Updated Date */}
              <td style={{ padding: "10px 8px", textAlign: "center" }}>
                <span
                  style={{
                    fontSize: "11px",
                    color: "var(--hk-text-muted)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {new Date(card.updated_at).toLocaleDateString()}
                </span>
              </td>

              {/* 11. Tags */}
              <td
                className="hk-vocab-cell--clip"
                style={{ padding: "10px 8px", textAlign: "left" }}
              >
                {card.tags && card.tags.length > 0 ? (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "nowrap",
                      gap: "4px",
                      overflow: "hidden",
                    }}
                    title={card.tags.map((tag) => `#${tag}`).join(" ")}
                  >
                    {card.tags.map((tag) => (
                      <span key={tag} className="hk-badge hk-badge--tag">
                        #{tag}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span
                    style={{ color: "var(--hk-text-muted)", fontSize: "11px" }}
                  >
                    —
                  </span>
                )}
              </td>

              {/* 12. Actions */}
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
  );
}
