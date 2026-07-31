import type { TokenAnalysis, AnkiExportData } from "~types";
import { POS_LABELS } from "~lib/constants";
import { JlptBadge, PosBadge } from "./Badges";

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

  return (
    <div className="hk-definition hk-fade-in">
      <div className="hk-definition__header">
        <span className="hk-definition__word">{token.dictionary_form}</span>
        <span className="hk-definition__reading">{token.reading.hiragana}</span>
        <div className="hk-definition__meta">
          <JlptBadge level={token.jlpt_level} />
          <PosBadge pos={token.pos} />
        </div>
      </div>

      {token.grammar_note_vi && (
        <div
          style={{
            marginTop: "10px",
            padding: "10px 12px",
            borderRadius: "var(--hk-radius-md)",
            border: "1px solid var(--hk-jlpt-n3)",
            background: "var(--hk-bg-tertiary)",
            color: "var(--hk-jlpt-n3)",
            fontSize: "13px",
            lineHeight: 1.55,
          }}
        >
          <div style={{ fontSize: "10px", fontWeight: 800, marginBottom: "4px" }}>
            BIẾN ĐỔI NGỮ PHÁP
          </div>
          <div style={{ color: "var(--hk-text-primary)" }}>{token.grammar_note_vi}</div>
          {token.components && token.components.length > 1 && (
            <div style={{ marginTop: "6px", color: "var(--hk-text-secondary)", fontSize: "12px" }}>
              {token.components
                .map((part) => `${part.surface} (${part.lemma})`)
                .join(" + ")}
            </div>
          )}
        </div>
      )}

      {token.definitions.length > 0 ? (
        <>
          <div
            style={{
              marginTop: "16px",
              color: "var(--hk-text-muted)",
              fontSize: "11px",
              fontWeight: 800,
              marginBottom: "8px"
            }}
          >
            {token.definitions[0]?.dictionary?.startsWith("Hakkutsu")
              ? "NGHĨA TIẾNG VIỆT"
              : "NGHĨA JMDICT · TIẾNG ANH"}
          </div>
          <ul className="hk-definition__glosses">
            {token.definitions.flatMap((def, di) =>
              def.glosses.map((gloss, gi) => (
                <li key={`${di}-${gi}`} className="hk-definition__gloss">
                  {gloss}
                </li>
              ))
            )}
          </ul>
        </>
      ) : (
        <p className="hk-definition__gloss" style={{ opacity: 0.5 }}>
          Chưa tìm thấy nghĩa của từ này.
        </p>
      )}

      {token.frequency_rank && (
        <div style={{ marginTop: 8, fontSize: 11, color: "var(--hk-text-muted)" }}>
          Xếp hạng tần suất: #{token.frequency_rank.toLocaleString()}
        </div>
      )}

      <div className="hk-definition__actions" style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
        {onExport && (
          <button
            className="hk-btn hk-btn--primary hk-btn--sm"
            onClick={handleExport}
            disabled={!ankiConnected}
            title={ankiConnected ? "Xuất sang Anki" : "Anki chưa kết nối"}
          >
            Xuất sang Anki
          </button>
        )}
        {onSrsAdd && (
          <button
            className="hk-btn hk-btn--secondary hk-btn--sm"
            onClick={onSrsAdd}
            title="Thêm vào hệ thống ôn tập Hakkutsu"
          >
            Thêm vào SRS
          </button>
        )}
      </div>
    </div>
  );
}
