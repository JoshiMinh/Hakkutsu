import { useState } from "react";
import type { TokenAnalysis, AnkiExportData } from "~lib/types";
import { POS_LABELS } from "~lib/utils/constants";
import { getHanViet } from "~lib/utils/hanviet-dict";
import { JlptBadge, PosBadge, FrequencyBadge } from "./badges";
import { Volume2, BookmarkPlus, ExternalLink, Copy, Check, Sparkles, BookOpen } from "lucide-react";

export function DefinitionCard({
  token,
  onExport,
  ankiConnected,
  originalText,
  sentenceReading,
  onSrsAdd,
}: {
  token: TokenAnalysis;
  onExport?: (data: AnkiExportData) => void;
  ankiConnected: boolean;
  originalText: string;
  sentenceReading: string;
  onSrsAdd?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [srsAdded, setSrsAdded] = useState(false);

  const hanViet = token.vietnamese_sound || getHanViet(token.dictionary_form || token.surface);

  const handleExport = () => {
    if (!onExport) return;
    const meanings = token.definitions
      .flatMap((d) => d.glosses)
      .join("; ");

    onExport({
      word: token.dictionary_form,
      reading: token.reading.hiragana,
      meaning: meanings || "—",
      sentence: originalText,
      sentenceReading: sentenceReading,
      jlptLevel: token.jlpt_level || "",
      pos: POS_LABELS[token.pos] || token.pos,
    });
  };

  const handlePlayAudio = () => {
    try {
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(token.dictionary_form || token.surface);
        utterance.lang = "ja-JP";
        utterance.rate = 0.9;
        window.speechSynthesis.speak(utterance);
      }
    } catch (e) {
      console.warn("TTS error:", e);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(token.dictionary_form || token.surface);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleSrsClick = () => {
    if (onSrsAdd) {
      onSrsAdd();
      setSrsAdded(true);
      setTimeout(() => setSrsAdded(false), 2000);
    }
  };

  const isVietnamese = token.definitions.some((d) =>
    d.dictionary?.toLowerCase().includes("hakkutsu") ||
    d.dictionary?.toLowerCase().includes("gemini") ||
    d.dictionary?.toLowerCase().includes("vi")
  );

  return (
    <div className="hk-definition hk-fade-in">
      {/* Top Header */}
      <div className="hk-definition__header">
        <div className="hk-definition__word-group">
          <div className="hk-definition__word-row">
            <span className="hk-definition__word">{token.dictionary_form}</span>
            <button
              className="hk-btn-icon-subtle"
              onClick={handlePlayAudio}
              title="Phát âm tiếng Nhật"
            >
              <Volume2 size={15} />
            </button>
            <button
              className="hk-btn-icon-subtle"
              onClick={handleCopy}
              title="Sao chép từ"
            >
              {copied ? <Check size={14} color="#4ade80" /> : <Copy size={14} />}
            </button>
          </div>
          
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginTop: "2px" }}>
            {token.reading?.hiragana && token.reading.hiragana !== token.dictionary_form && (
              <span className="hk-definition__reading">
                {token.reading.hiragana}
              </span>
            )}
            {hanViet && (
              <span style={{
                fontSize: "11px",
                fontWeight: 700,
                color: "#38bdf8",
                background: "rgba(56, 189, 248, 0.12)",
                border: "1px solid rgba(56, 189, 248, 0.25)",
                padding: "1px 6px",
                borderRadius: "4px",
                letterSpacing: "0.5px"
              }}>
                Hán-Việt: {hanViet}
              </span>
            )}
          </div>
        </div>

        <div className="hk-definition__meta">
          <JlptBadge level={token.jlpt_level} />
          <PosBadge pos={token.pos} />
          <FrequencyBadge rank={token.frequency_rank} />
        </div>
      </div>

      {/* Surface note if conjugated */}
      {token.surface && token.surface !== token.dictionary_form && (
        <div className="hk-definition__surface-note">
          <span className="hk-definition__surface-tag">Từ gốc của</span>
          <span className="hk-definition__surface-val">{token.surface}</span>
        </div>
      )}

      {/* Grammar / Conjugation Note */}
      {token.grammar_note_vi && (
        <div className="hk-dict-note">
          <div className="hk-dict-note__title">
            <Sparkles size={12} style={{ color: "#f59e0b" }} />
            <span>Biến đổi trong câu</span>
          </div>
          <div className="hk-dict-note__content">{token.grammar_note_vi}</div>
          {token.components && token.components.length > 1 && (
            <div className="hk-dict-note__sub">
              {token.components
                .map((part) => `${part.surface} (${part.lemma})`)
                .join(" + ")}
            </div>
          )}
        </div>
      )}

      {/* Definitions Section */}
      {token.definitions.length > 0 ? (
        <div className="hk-definition__body">
          <div className="hk-dict-label-row">
            <span className="hk-dict-label">
              {isVietnamese ? "🇻🇳 Nghĩa tiếng Việt" : "🇬🇧 Nghĩa JMdict (English)"}
            </span>
            <span className="hk-dict-count-badge">
              {token.definitions.reduce((acc, d) => acc + d.glosses.length, 0)} nghĩa
            </span>
          </div>

          <ol className="hk-definition__glosses">
            {token.definitions.flatMap((def) =>
              def.glosses.map((gloss, gi) => (
                <li key={`${def.dictionary}-${gi}`} className="hk-definition__gloss">
                  <span className="hk-definition__gloss-num">{gi + 1}</span>
                  <span className="hk-definition__gloss-text">{gloss}</span>
                </li>
              ))
            )}
          </ol>
        </div>
      ) : (
        <div className="hk-definition__empty">
          <BookOpen size={18} style={{ opacity: 0.4 }} />
          <span>Chưa có dữ liệu từ điển cho từ này.</span>
        </div>
      )}

      {/* Actions Footer */}
      <div className="hk-definition__actions">
        {onSrsAdd && (
          <button
            className={`hk-btn ${srsAdded ? "hk-btn--success" : "hk-btn--primary"}`}
            onClick={handleSrsClick}
            title="Lưu vào kho thẻ ôn tập SRS"
          >
            {srsAdded ? (
              <>
                <Check size={14} /> Đã thêm vào SRS
              </>
            ) : (
              <>
                <BookmarkPlus size={14} /> Thêm vào SRS
              </>
            )}
          </button>
        )}
        {onExport && (
          <button
            className="hk-btn hk-btn--secondary"
            onClick={handleExport}
            disabled={!ankiConnected}
            title={ankiConnected ? "Xuất thẻ sang Anki" : "AnkiConnect chưa kết nối"}
          >
            <ExternalLink size={14} /> Xuất Anki
          </button>
        )}
      </div>
    </div>
  );
}
