import { useState, useEffect } from "react";
import type { TokenAnalysis, AnkiExportData } from "~lib/types";
import { formatPosLabel } from "~lib/utils/constants";
import { getHanViet } from "~lib/utils/hanviet-dict";
import { hasKanji, distributeFurigana } from "~lib/utils/japanese";
import { predictJlpt } from "~lib/utils/jlpt-classifier";
import { JlptBadge, PosBadge, FrequencyBadge } from "./Badges";
import { Volume2, BookmarkPlus, Copy, Check, Sparkles, BookOpen, MessageSquareText, Loader2 } from "lucide-react";
import { useTranslation } from "~lib/languages/locales";
import { ttsService } from "~lib/services/tts-service";
import { fetchExampleSentences, fetchWordVariants } from "~lib/services/dictionary-lookup";
import type { ExampleSentence, WordVariant } from "~lib/services/dictionary-lookup";

function highlightJapaneseSentence(sentence: string, targetWords: string[]): React.ReactNode {
  if (!sentence) return "";
  const cleanWords = Array.from(
    new Set(
      targetWords
        .map((w) => w?.trim())
        .filter((w): w is string => Boolean(w && w.length > 0))
    )
  ).sort((a, b) => b.length - a.length);

  if (cleanWords.length === 0) return sentence;

  const pattern = cleanWords
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");

  if (!pattern) return sentence;

  const regex = new RegExp(`(${pattern})`, "gi");
  const parts = sentence.split(regex);

  return parts.map((part, i) => {
    const isMatch = cleanWords.some((w) => w.toLowerCase() === part.toLowerCase());
    if (isMatch) {
      return (
        <strong
          key={i}
          style={{
            color: "#c084fc",
            fontWeight: 700,
            textDecoration: "underline",
            textUnderlineOffset: "3px",
            textDecorationColor: "rgba(192, 132, 252, 0.4)",
          }}
        >
          {part}
        </strong>
      );
    }
    return part;
  });
}

export function DefinitionCard({
  token,
  onExport,
  ankiConnected,
  originalText,
  sentenceReading,
  onSrsAdd,
  hideBottomAction = false,
}: {
  token: TokenAnalysis;
  onExport?: (data: AnkiExportData) => void;
  ankiConnected: boolean;
  originalText: string;
  sentenceReading: string;
  onSrsAdd?: () => void;
  hideBottomAction?: boolean;
}) {
  const { t, isVietnamese, showHanViet, lang } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [srsAdded, setSrsAdded] = useState(false);
  const [examples, setExamples] = useState<ExampleSentence[]>([]);
  const [loadingExamples, setLoadingExamples] = useState(false);
  const [variants, setVariants] = useState<WordVariant[]>([]);
  const [loadingVariants, setLoadingVariants] = useState(false);

  const wordQuery = token.dictionary_form || token.surface;
  const wordHasKanji = hasKanji(token.dictionary_form) || hasKanji(token.surface);
  const readingStr = typeof token.reading === "string" ? token.reading : (token.reading?.hiragana || "");
  const rubySegments = distributeFurigana(token.dictionary_form || token.surface, readingStr);

  // Strictly only show Han-Viet when enabled and target language is Vietnamese and word has Kanji
  const hanViet = showHanViet && wordHasKanji
    ? (token.vietnamese_sound || getHanViet(token.dictionary_form || token.surface))
    : null;

  // Fetch real example sentences for this word
  useEffect(() => {
    let isMounted = true;
    if (!wordQuery || !token.is_japanese) {
      setExamples([]);
      return;
    }

    setLoadingExamples(true);
    fetchExampleSentences(wordQuery, lang, 2)
      .then((items) => {
        if (isMounted) {
          setExamples(items);
        }
      })
      .catch((e) => {
        console.warn("[Hakkutsu] Example sentence fetch failed:", e);
        if (isMounted) setExamples([]);
      })
      .finally(() => {
        if (isMounted) setLoadingExamples(false);
      });

    return () => {
      isMounted = false;
    };
  }, [wordQuery, lang, token.is_japanese]);

  // Fetch word variants / compound words
  useEffect(() => {
    let isMounted = true;
    if (!wordQuery || !token.is_japanese) {
      setVariants([]);
      return;
    }

    setLoadingVariants(true);
    fetchWordVariants(wordQuery, lang, 4)
      .then((items) => {
        if (isMounted) {
          setVariants(items);
        }
      })
      .catch((e) => {
        console.warn("[Hakkutsu] Variant fetch error:", e);
        if (isMounted) setVariants([]);
      })
      .finally(() => {
        if (isMounted) setLoadingVariants(false);
      });

    return () => {
      isMounted = false;
    };
  }, [wordQuery, lang, token.is_japanese]);

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

  const handleAddToLibrary = () => {
    if (onSrsAdd) {
      onSrsAdd();
      setSrsAdded(true);
      setTimeout(() => setSrsAdded(false), 2000);
    }
  };

  const totalGlossCount = token.definitions.reduce((acc, d) => acc + d.glosses.length, 0);
  const countLabel = isVietnamese
    ? `${totalGlossCount} ${t("def_dict_count")}`
    : `${totalGlossCount} ${totalGlossCount === 1 ? t("def_sense_single") : t("def_sense_plural")}`;

  return (
    <div className="hk-definition hk-fade-in">
      {/* Top Header */}
      <div className="hk-definition__header">
        <div className="hk-definition__word-group">
          <div className="hk-definition__word-row">
            <span className="hk-definition__word">
              {rubySegments.map((seg, idx) =>
                seg.ruby ? (
                  <ruby key={idx} className="hk-ruby">
                    {seg.text}
                    <rt>{seg.ruby}</rt>
                  </ruby>
                ) : (
                  <span key={idx}>{seg.text}</span>
                )
              )}
            </span>
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
          
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginTop: "4px" }}>
            {wordHasKanji && token.reading?.hiragana && (
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
          <JlptBadge level={token.jlpt_level || predictJlpt(token.dictionary_form || token.surface)} />
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
            <span className="hk-dict-label" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <BookOpen size={13} style={{ opacity: 0.7 }} />
              {t("def_dict_label")}
            </span>
            <span className="hk-dict-count-badge">
              {countLabel}
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

      {/* Example Sentences Section */}
      {(examples.length > 0 || loadingExamples) && (
        <div className="hk-definition__examples" style={{ marginTop: "12px", paddingTop: "10px", borderTop: "1px solid rgba(255, 255, 255, 0.08)" }}>
          <div className="hk-dict-label-row" style={{ marginBottom: "6px" }}>
            <span className="hk-dict-label" style={{ display: "flex", alignItems: "center", gap: "6px", color: "#a855f7" }}>
              <MessageSquareText size={13} />
              {t("def_examples_label")}
            </span>
            {loadingExamples && <Loader2 size={12} className="hk-spin" style={{ color: "#a855f7" }} />}
          </div>

          {examples.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {examples.map((ex, idx) => (
                <div
                  key={ex.id || idx}
                  style={{
                    background: "rgba(255, 255, 255, 0.03)",
                    border: "1px solid rgba(255, 255, 255, 0.06)",
                    borderRadius: "8px",
                    padding: "8px 10px",
                    fontSize: "12.5px",
                    lineHeight: "1.5",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "6px" }}>
                    <span style={{ color: "#f4f4f5", fontFamily: "var(--hk-font-jp)", fontWeight: 500 }}>
                      {highlightJapaneseSentence(ex.japanese, [token.dictionary_form, token.surface, wordQuery])}
                    </span>
                    <button
                      className="hk-btn-icon-subtle"
                      style={{ flexShrink: 0, width: "22px", height: "22px" }}
                      onClick={() => ttsService.playJapanese(ex.japanese)}
                      title={t("def_play_audio_jp")}
                    >
                      <Volume2 size={12} />
                    </button>
                  </div>
                  <div style={{ color: "#a1a1aa", fontSize: "11.5px", marginTop: "3px" }}>
                    {ex.translation}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Word Variants Section */}
      {(variants.length > 0 || loadingVariants) && (
        <div className="hk-definition__variants" style={{ marginTop: "12px", paddingTop: "10px", borderTop: "1px solid rgba(255, 255, 255, 0.08)" }}>
          <div className="hk-dict-label-row" style={{ marginBottom: "6px" }}>
            <span className="hk-dict-label" style={{ display: "flex", alignItems: "center", gap: "6px", color: "#38bdf8" }}>
              <Sparkles size={13} />
              {t("def_variants_label")}
            </span>
            {loadingVariants && <Loader2 size={12} className="hk-spin" style={{ color: "#38bdf8" }} />}
          </div>

          {variants.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
              {variants.map((v, idx) => (
                <div
                  key={v.word || idx}
                  style={{
                    background: "rgba(56, 189, 248, 0.06)",
                    border: "1px solid rgba(56, 189, 248, 0.18)",
                    borderRadius: "8px",
                    padding: "6px 9px",
                    fontSize: "12px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "2px",
                    overflow: "hidden",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "baseline", gap: "5px", flexWrap: "wrap" }}>
                    <span style={{ color: "#f4f4f5", fontWeight: 700, fontFamily: "var(--hk-font-jp)", fontSize: "13px" }}>
                      {v.word}
                    </span>
                    {v.reading && (
                      <span style={{ fontSize: "10px", color: "#94a3b8" }}>
                        {v.reading}
                      </span>
                    )}
                  </div>
                  {v.meaning && (
                    <div style={{ color: "#cbd5e1", fontSize: "11px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {v.meaning}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Actions Footer */}
      {!hideBottomAction && (
        <div className="hk-definition__actions" style={{ marginTop: "14px" }}>
          <button
            className={`hk-btn ${srsAdded ? "hk-btn--success" : "hk-btn--primary"}`}
            onClick={handleAddToLibrary}
            title={srsAdded ? t("def_btn_added_library") : t("def_btn_add_library")}
            style={{ width: "100%", justifyContent: "center", padding: "8px 16px" }}
          >
            {srsAdded ? (
              <>
                <Check size={14} /> {t("def_btn_added_library")}
              </>
            ) : (
              <>
                <BookmarkPlus size={14} /> {t("def_btn_add_library")}
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
