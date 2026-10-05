import { useCallback, useEffect, useRef, useState } from "react";
import { Languages, RefreshCw, Trash2, Volume2 } from "lucide-react";
import { apiClient } from "~/features/dictionary/api-client";
import { ttsService } from "~/shared/browser/tts-service";
import { useTranslation } from "~/shared/locales";
import type { PhraseAnalyzeResponse } from "~/features/dictionary/types";

export function LoadingSpinner({ text = "Analyzing..." }: { text?: string }) {
  return (
    <div className="hk-loading">
      <RefreshCw
        size={22}
        className="hk-loading__spinner hk-spin"
        style={{ color: "var(--hk-accent-primary)" }}
      />
      <span>{text}</span>
    </div>
  );
}

export function TranslateQuickView() {
  const { t, lang, isVietnamese } = useTranslation();
  const [inputText, setInputText] = useState("");
  const [result, setResult] = useState<PhraseAnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const shortcut =
    typeof navigator !== "undefined" && /Mac/i.test(navigator.platform)
      ? "⌘+Enter"
      : "Ctrl+Enter";
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleTranslate = useCallback(
    async (text?: string) => {
      const textToAnalyze = (text ?? inputText).trim();
      if (!textToAnalyze) return;

      const requestId = ++requestIdRef.current;
      setLoading(true);
      setError(null);
      setResult(null);

      try {
        const response = await apiClient.analyzePhrase({
          text: textToAnalyze,
          include_definitions: true,
        });
        if (requestId === requestIdRef.current) setResult(response);
      } catch (e) {
        if (requestId === requestIdRef.current) {
          setError(e instanceof Error ? e.message : t("popup_error_generic"));
        }
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    },
    [inputText, t],
  );

  useEffect(() => {
    const listener = (message: { type: string; payload: { text: string } }) => {
      if (message.type === "TEXT_SELECTED" && message.payload?.text) {
        setInputText(message.payload.text);
        void handleTranslate(message.payload.text);
      }
    };
    chrome.runtime?.onMessage?.addListener(listener);
    return () => chrome.runtime?.onMessage?.removeListener(listener);
  }, [handleTranslate]);

  const handlePlayJapanese = () => {
    if (result?.text) {
      ttsService.playJapanese(result.text);
    } else if (inputText) {
      ttsService.playJapanese(inputText);
    }
  };

  const handlePlayTranslation = () => {
    if (result?.translation) {
      ttsService.playTargetLanguage(result.translation, lang);
    }
  };

  return (
    <div className="hk-content hk-fade-in hk-translate-view">
      <div className="hk-translate-editor">
        <label className="hk-sr-only" htmlFor="popup-text">
          {t("popup_input_label")}
        </label>
        <textarea
          id="popup-text"
          rows={4}
          className="hk-translate-editor__input"
          ref={inputRef}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={t("popup_input_placeholder")}
          aria-describedby="popup-translate-shortcut"
          spellCheck={false}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              (e.ctrlKey || e.metaKey) &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              if (!loading) void handleTranslate();
            }
          }}
        />

        <div className="hk-translate-editor__actions">
          <div className="hk-translate-editor__tools">
            <kbd
              id="popup-translate-shortcut"
              className="hk-translate-editor__shortcut"
            >
              {shortcut}
            </kbd>
            {inputText && (
              <button
                type="button"
                onClick={() => {
                  requestIdRef.current += 1;
                  setInputText("");
                  setResult(null);
                  setError(null);
                  setLoading(false);
                  inputRef.current?.focus();
                }}
                className="hk-translate-editor__clear"
                title={t("popup_clear_text")}
                aria-label={t("popup_clear_text")}
              >
                <Trash2 size={15} aria-hidden="true" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => void handleTranslate()}
            disabled={loading || !inputText.trim()}
            className="hk-btn hk-btn--primary hk-translate-editor__submit"
          >
            {loading ? (
              <RefreshCw size={15} className="hk-spin" aria-hidden="true" />
            ) : (
              <Languages size={15} aria-hidden="true" />
            )}
            {loading ? t("popup_analyzing") : t("popup_btn_translate")}
          </button>
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: "10px 12px",
            background: "rgba(232, 93, 117, 0.1)",
            borderLeft: "3px solid var(--hk-accent-crimson)",
            color: "var(--hk-text-primary)",
            fontSize: 13,
            borderRadius: "8px",
            marginBottom: "16px",
          }}
          role="alert"
        >
          <div>{error}</div>
        </div>
      )}

      {loading && (
        <div
          role="status"
          aria-live="polite"
          style={{
            textAlign: "center",
            padding: "28px 0",
            color: "var(--hk-text-muted)",
          }}
        >
          <RefreshCw
            size={22}
            className="hk-spin"
            style={{ color: "var(--hk-accent-primary)", marginBottom: "8px" }}
          />
          <div style={{ fontSize: "13px" }}>{t("popup_analyzing")}</div>
        </div>
      )}

      {/* Structured Result Display */}
      {result && !loading && (
        <div
          style={{
            background: "var(--hk-bg-secondary)",
            border: "1px solid var(--hk-border)",
            borderRadius: "10px",
            padding: "14px",
            boxShadow: "var(--hk-shadow-sm)",
          }}
        >
          {result.sentence_reading && (
            <div
              style={{
                fontSize: "12px",
                color: "var(--hk-accent-primary)",
                marginBottom: "10px",
                fontFamily: "var(--hk-font-jp)",
                background: "rgba(168, 85, 247, 0.08)",
                padding: "4px 8px",
                borderRadius: "4px",
                borderLeft: "3px solid var(--hk-accent-primary)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span>{result.sentence_reading}</span>
              <button
                onClick={handlePlayJapanese}
                className="hk-btn-icon-subtle"
                title={t("def_play_audio_jp")}
                style={{ padding: "2px" }}
              >
                <Volume2 size={13} />
              </button>
            </div>
          )}

          {result.translation && (
            <div
              style={{
                fontSize: "14px",
                color: "var(--hk-text-primary)",
                marginBottom: "14px",
                background: "rgba(20, 184, 166, 0.08)",
                borderLeft: "3px solid #14b8a6",
                padding: "8px 12px",
                borderRadius: "4px",
                lineHeight: "1.5",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "8px",
              }}
            >
              <span>"{result.translation}"</span>
              <button
                onClick={handlePlayTranslation}
                className="hk-btn-icon-subtle"
                title={t("def_play_audio_trans")}
                style={{ flexShrink: 0, padding: "2px" }}
              >
                <Volume2 size={13} />
              </button>
            </div>
          )}

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "6px",
              marginBottom: "16px",
            }}
          >
            {result.tokens
              .filter((t) => t.is_japanese && (t.dictionary_form || t.surface))
              .map((token, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: "4px 9px",
                    background: "var(--hk-bg-tertiary)",
                    border: "1px solid var(--hk-border)",
                    borderRadius: "6px",
                    fontSize: "13px",
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  <span
                    style={{
                      color: "var(--hk-text-primary)",
                      fontWeight: 500,
                      marginRight: "6px",
                    }}
                  >
                    {token.surface}
                  </span>
                  <span
                    style={{ color: "var(--hk-text-muted)", fontSize: "11px" }}
                  >
                    {token.dictionary_form || token.surface}
                  </span>
                </div>
              ))}
          </div>

          {result.tokens.filter(
            (t) => t.definitions && t.definitions.length > 0,
          ).length > 0 && (
            <div
              style={{
                borderTop: "1px solid var(--hk-border)",
                paddingTop: "12px",
              }}
            >
              <div
                style={{
                  fontSize: "11px",
                  textTransform: "uppercase",
                  color: "var(--hk-text-muted)",
                  fontWeight: "bold",
                  marginBottom: "8px",
                  letterSpacing: "0.5px",
                }}
              >
                {t("def_dict_label")}
              </div>
              <div
                style={{ display: "flex", flexDirection: "column", gap: "8px" }}
              >
                {result.tokens
                  .filter((t) => t.definitions && t.definitions.length > 0)
                  .slice(0, 5)
                  .map((token, idx) => (
                    <div
                      key={idx}
                      style={{
                        fontSize: "13px",
                        display: "flex",
                        gap: "6px",
                        alignItems: "center",
                      }}
                    >
                      <strong
                        style={{
                          color: "var(--hk-text-primary)",
                          minWidth: "70px",
                        }}
                      >
                        {token.dictionary_form || token.surface}
                      </strong>
                      {isVietnamese && token.vietnamese_sound && (
                        <span
                          style={{
                            fontSize: "11px",
                            color: "#38bdf8",
                            marginRight: "4px",
                          }}
                        >
                          [{token.vietnamese_sound}]
                        </span>
                      )}
                      <span style={{ color: "var(--hk-text-muted)" }}>—</span>
                      <span
                        style={{ color: "var(--hk-text-secondary)", flex: 1 }}
                      >
                        {token.definitions?.[0]?.glosses
                          ?.slice(0, 2)
                          .join(", ")}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {!result && !loading && !error && (
        <div className="hk-popup-empty">
          <Languages size={28} aria-hidden="true" />
          {t("popup_empty_state")}
        </div>
      )}
    </div>
  );
}
