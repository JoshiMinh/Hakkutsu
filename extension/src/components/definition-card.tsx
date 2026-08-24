import { useState } from "react";
import type { TokenAnalysis, AnkiExportData } from "~lib/types";
import { POS_LABELS } from "~lib/utils/constants";
import { getHanViet } from "~lib/utils/hanviet-dict";
import { JlptBadge, PosBadge, FrequencyBadge } from "./Badges";
import { Volume2, BookmarkPlus, ExternalLink, Copy, Check, Sparkles, BookOpen } from "lucide-react";
import { useTranslation } from "~lib/languages/locales";
import { ttsService } from "~lib/services/tts-service";

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
  const { t, isVietnamese, showHanViet, lang } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [srsAdded, setSrsAdded] = useState(false);

  // Strictly only show Han-Viet when enabled and target language is Vietnamese
  const hanViet = showHanViet ? (token.vietnamese_sound || getHanViet(token.dictionary_form || token.surface)) : null;

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
    ttsService.playJapanese(token.dictionary_form || token.surface);
  };

  const handlePlayTranslationAudio = (meaningText: string) => {
    ttsService.playTargetLanguage(meaningText, lang);
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
              title={t("def_play_audio_jp")}
            >
              <Volume2 size={15} />
            </button>
            <button
              className="hk-btn-icon-subtle"
              onClick={handleCopy}
              title={t("def_copy_word")}
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
                {t("def_hanviet")}: {hanViet}
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
          <span className="hk-definition__surface-tag">{t("def_surface_root")}</span>
          <span className="hk-definition__surface-val">{token.surface}</span>
        </div>
      )}

      {/* Grammar / Conjugation Note */}
      {token.grammar_note_vi && isVietnamese && (
        <div className="hk-dict-note">
          <div className="hk-dict-note__title">
            <Sparkles size={12} style={{ color: "#f59e0b" }} />
            <span>{t("def_grammar_note")}</span>
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
              {t("def_dict_label")}
            </span>
            <span className="hk-dict-count-badge">
              {token.definitions.reduce((acc, d) => acc + d.glosses.length, 0)} {t("def_dict_count")}
            </span>
          </div>

          <ol className="hk-definition__glosses">
            {token.definitions.flatMap((def) =>
              def.glosses.map((gloss, gi) => (
                <li key={`${def.dictionary}-${gi}`} className="hk-definition__gloss">
                  <span className="hk-definition__gloss-num">{gi + 1}</span>
                  <span className="hk-definition__gloss-text">{gloss}</span>
                  <button
                    className="hk-btn-icon-subtle"
                    style={{ marginLeft: "6px", opacity: 0.7 }}
                    onClick={() => handlePlayTranslationAudio(gloss)}
                    title={t("def_play_audio_trans")}
                  >
                    <Volume2 size={13} />
                  </button>
                </li>
              ))
            )}
          </ol>
        </div>
      ) : (
        <div className="hk-definition__empty">
          <BookOpen size={18} style={{ opacity: 0.4 }} />
          <span>{t("def_dict_empty")}</span>
        </div>
      )}

      {/* Actions Footer */}
      <div className="hk-definition__actions">
        {onSrsAdd && (
          <button
            className={`hk-btn ${srsAdded ? "hk-btn--success" : "hk-btn--primary"}`}
            onClick={handleSrsClick}
            title={srsAdded ? t("def_btn_added_srs") : t("def_btn_add_srs")}
          >
            {srsAdded ? (
              <>
                <Check size={14} /> {t("def_btn_added_srs")}
              </>
            ) : (
              <>
                <BookmarkPlus size={14} /> {t("def_btn_add_srs")}
              </>
            )}
          </button>
        )}
        {onExport && (
          <button
            className="hk-btn hk-btn--secondary"
            onClick={handleExport}
            disabled={!ankiConnected}
            title={ankiConnected ? t("def_anki_connected") : t("def_anki_disconnected")}
          >
            <ExternalLink size={14} /> {t("def_btn_export_anki")}
          </button>
        )}
      </div>
    </div>
  );
}
