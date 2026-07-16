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

      {token.definitions.length > 0 ? (
        <ul className="hk-definition__glosses">
          {token.definitions.flatMap((def, di) =>
            def.glosses.map((gloss, gi) => (
              <li key={`${di}-${gi}`} className="hk-definition__gloss">
                {gloss}
              </li>
            ))
          )}
        </ul>
      ) : (
        <p className="hk-definition__gloss" style={{ opacity: 0.5 }}>
          No definitions available. Try downloading JMdict data for the backend.
        </p>
      )}

      {token.frequency_rank && (
        <div style={{ marginTop: 8, fontSize: 11, color: "var(--hk-text-muted)" }}>
          Frequency rank: #{token.frequency_rank.toLocaleString()}
        </div>
      )}

      <div className="hk-definition__actions" style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
        {onExport && (
          <button
            className="hk-btn hk-btn--primary hk-btn--sm"
            onClick={handleExport}
            disabled={!ankiConnected}
            title={ankiConnected ? "Export to Anki" : "Anki not connected"}
          >
            📇 Export to Anki
          </button>
        )}
        {onSrsAdd && (
          <button
            className="hk-btn hk-btn--secondary hk-btn--sm"
            onClick={onSrsAdd}
            title="Add to native Hakkutsu Spaced Repetition System"
          >
            🧠 Add to SRS
          </button>
        )}
      </div>
    </div>
  );
}
