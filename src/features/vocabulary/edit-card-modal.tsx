import { useState } from "react";
import type { SrsCard } from "~/features/srs/local-srs";
import { X, Sparkles, Layers, Check, Image as ImageIcon } from "lucide-react";
import { useTranslation } from "~/shared/locales";

export function EditCardModal({
  card,
  onClose,
  onSave,
  showHanViet,
}: {
  card: SrsCard;
  onClose: () => void;
  onSave: (c: SrsCard) => void;
  showHanViet: boolean;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<SrsCard>({
    ...card,
    word_furigana:
      card.word_furigana ||
      (card.reading ? `${card.word}[${card.reading}]` : card.word),
  });
  const [tagsInput, setTagsInput] = useState<string>(
    (card.tags || []).join(", "),
  );

  const handleChange = (field: keyof SrsCard, val: any) => {
    setDraft((prev) => ({ ...prev, [field]: val }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTags = tagsInput
      .split(",")
      .map((t) => t.trim().replace(/^#/, ""))
      .filter(Boolean);

    onSave({
      ...draft,
      tags: cleanTags,
    });
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
          boxShadow: "0 20px 50px rgba(0, 0, 0, 0.7)",
        }}
      >
        {/* Header */}
        <div
          className="hk-modal__header"
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <h3
              style={{
                margin: 0,
                fontSize: "16px",
                fontWeight: 700,
                color: "#ffffff",
              }}
            >
              {t("vocab_modal_edit_title")}
            </h3>
            <span
              style={{
                fontSize: "11px",
                color: "var(--hk-text-muted)",
                fontFamily: "var(--hk-font-jp)",
              }}
            >
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
              display: "flex",
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div
          className="hk-modal__body"
          style={{ maxHeight: "72vh", overflowY: "auto", padding: "20px" }}
        >
          <form id="edit-word-form" onSubmit={handleSubmit}>
            {/* Section 1: Basic Word Details */}
            <div
              className="hk-modal-section-title"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "11px",
                fontWeight: 600,
                letterSpacing: "0.5px",
                textTransform: "uppercase",
                color: "var(--hk-text-muted)",
                marginBottom: "12px",
              }}
            >
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
                <label
                  className="hk-form-label"
                  style={{
                    fontSize: "11.5px",
                    color: "var(--hk-text-secondary)",
                    marginBottom: "4px",
                    display: "block",
                  }}
                >
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
                    outline: "none",
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
                label="Frequency Rank (#)"
                value={draft.frequency_rank ? String(draft.frequency_rank) : ""}
                onChange={(v) =>
                  handleChange(
                    "frequency_rank",
                    v ? parseInt(v, 10) || null : null,
                  )
                }
                placeholder="e.g. 1200"
              />

              <FormGroup
                label={t("vocab_label_meaning")}
                value={draft.meaning}
                onChange={(v) => handleChange("meaning", v)}
                placeholder="Meaning translation..."
              />

              <FormGroup
                label="Tags (comma-separated)"
                value={tagsInput}
                onChange={(v) => setTagsInput(v)}
                placeholder="e.g. N3, Anime, Netflix"
              />
            </div>

            {/* Section 2: Illustration Image */}
            <div
              className="hk-modal-section-title"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "11px",
                fontWeight: 600,
                letterSpacing: "0.5px",
                textTransform: "uppercase",
                color: "var(--hk-text-muted)",
                marginTop: "18px",
                marginBottom: "12px",
              }}
            >
              <ImageIcon size={13} />
              Illustration Image URL
            </div>

            <div
              style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}
            >
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
                <div
                  style={{
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
                    marginTop: "20px",
                  }}
                >
                  <img
                    src={draft.image_url}
                    alt="Preview"
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "contain",
                    }}
                  />
                </div>
              )}
            </div>

            {/* Section 3: Sentence Context */}
            <div
              className="hk-modal-section-title"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "11px",
                fontWeight: 600,
                letterSpacing: "0.5px",
                textTransform: "uppercase",
                color: "var(--hk-text-muted)",
                marginTop: "18px",
                marginBottom: "12px",
              }}
            >
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
        <div
          className="hk-modal__footer"
          style={{
            padding: "14px 20px",
            borderTop: "1px solid rgba(255, 255, 255, 0.08)",
            display: "flex",
            justifyContent: "flex-end",
            gap: "10px",
          }}
        >
          <button
            type="button"
            className="hk-btn hk-btn--secondary"
            onClick={onClose}
            style={{
              padding: "8px 16px",
              fontSize: "12.5px",
              borderRadius: "8px",
            }}
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
              boxShadow: "none",
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
  isJp = false,
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
    <div
      className="hk-form-group"
      style={{ gridColumn: fullWidth ? "1 / -1" : "auto" }}
    >
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
