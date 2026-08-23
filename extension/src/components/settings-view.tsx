import { Bot, Database, GraduationCap, Sparkles, Server } from "lucide-react";
import type { ExtensionSettings } from "~lib/types";

function GeminiIcon({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 0C12 6.62742 6.62742 12 0 12C6.62742 12 12 17.3726 12 24C12 17.3726 17.3726 12 24 12C17.3726 12 12 6.62742 12 0Z"
        fill="url(#gemini_grad)"
      />
      <defs>
        <linearGradient id="gemini_grad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop stopColor="#9168F4" />
          <stop offset="0.5" stopColor="#3186FF" />
          <stop offset="1" stopColor="#E94335" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function OpenAIIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 12.983 23a6.056 6.056 0 0 0 6.0377-4.1818 5.9847 5.9847 0 0 0 3.9977-2.9 6.0462 6.0462 0 0 0-.7365-7.0971ZM13.6 21.2a4.5 4.5 0 0 1-2.9-1.0416l.1543-.0876 4.836-2.792a.7633.7633 0 0 0 .3816-.6608v-6.8188l2.0466 1.1815v5.7193a4.5218 4.5218 0 0 1-4.5185 4.5001ZM4.269 17.5a4.495 4.495 0 0 1-.5376-3.0537l.1543.0926 4.836 2.792a.7633.7633 0 0 0 .7633 0l5.906-3.41v2.363l-4.9547 2.8604a4.5218 4.5218 0 0 1-6.1673-1.6443Zm-1.464-9.6a4.495 4.495 0 0 1 2.3624-2.012l.0048.1772v5.584l-2.0466-1.1815V4.7483A4.5218 4.5218 0 0 1 2.805 7.9ZM10.4 2.8a4.5 4.5 0 0 1 2.9 1.0416l-.1543.0876-4.836 2.792a.7633.7633 0 0 0-.3816.6608v6.8188L5.8815 13.02V7.3006A4.5218 4.5218 0 0 1 10.4 2.8Zm9.331 3.7a4.495 4.495 0 0 1 .5376 3.0537l-.1543-.0926-4.836-2.792a.7633.7633 0 0 0-.7633 0l-5.906 3.41v-2.363l4.9547-2.8604A4.5218 4.5218 0 0 1 19.731 6.5Zm1.464 9.6a4.495 4.495 0 0 1-2.3624 2.012l-.0048-.1772v-5.584l2.0466 1.1815v5.7193A4.5218 4.5218 0 0 1 21.195 16.1ZM12 13.7l-2.9-1.6744 2.9-1.6744 2.9 1.6744Z" />
    </svg>
  );
}

export function SettingsView({
  settings,
  onUpdate,
}: {
  settings: ExtensionSettings;
  onUpdate: (patch: Partial<ExtensionSettings>) => void;
}) {
  return (
    <div className="hk-content hk-fade-in">
      <div className="hk-settings-header">
        <h2 className="hk-settings-title">App Settings</h2>
        <p className="hk-settings-subtitle">Manage your Hakkutsu extension preferences</p>
      </div>
      
      <form className="hk-settings-form" onSubmit={(e) => e.preventDefault()}>
        
        <section className="hk-settings-card">
          <header className="hk-settings-card__header">
            <div className="hk-settings-card__icon">
              <Bot size={18} />
            </div>
            <h3 className="hk-settings-card__title">Translation LLM</h3>
          </header>
          
          <div className="hk-settings-card__body">
            <div style={{ padding: "16px 18px", borderBottom: "1px solid rgba(255, 255, 255, 0.04)" }}>
              <label className="hk-settings-row__label" style={{ marginBottom: "4px", display: "block" }}>
                LLM Provider
              </label>
              <div className="hk-settings-row__desc" style={{ marginBottom: "14px" }}>
                Select AI service used for translations and token analysis
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
                {/* Google Gemini */}
                <button
                  type="button"
                  onClick={() => onUpdate({ llmProvider: "gemini" })}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "14px 12px",
                    borderRadius: "10px",
                    border: settings.llmProvider === "gemini" ? "2px solid #a855f7" : "1px solid var(--hk-border)",
                    background: settings.llmProvider === "gemini" ? "rgba(168, 85, 247, 0.14)" : "var(--hk-bg-tertiary)",
                    color: "var(--hk-text-primary)",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                    boxShadow: settings.llmProvider === "gemini" ? "0 4px 16px rgba(168, 85, 247, 0.25)" : "none"
                  }}
                >
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "14px", fontWeight: 700 }}>Google Gemini</div>
                    <div style={{ fontSize: "11px", color: "var(--hk-text-muted)", marginTop: "3px" }}>Flash 2.0 / 1.5</div>
                  </div>
                </button>

                {/* OpenAI */}
                <button
                  type="button"
                  onClick={() => onUpdate({ llmProvider: "openai" })}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "14px 12px",
                    borderRadius: "10px",
                    border: settings.llmProvider === "openai" ? "2px solid #10a37f" : "1px solid var(--hk-border)",
                    background: settings.llmProvider === "openai" ? "rgba(16, 163, 127, 0.14)" : "var(--hk-bg-tertiary)",
                    color: "var(--hk-text-primary)",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                    boxShadow: settings.llmProvider === "openai" ? "0 4px 16px rgba(16, 163, 127, 0.25)" : "none"
                  }}
                >
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "14px", fontWeight: 700 }}>OpenAI</div>
                    <div style={{ fontSize: "11px", color: "var(--hk-text-muted)", marginTop: "3px" }}>GPT-4o / GPT-4o-mini</div>
                  </div>
                </button>

                {/* Custom */}
                <button
                  type="button"
                  onClick={() => onUpdate({ llmProvider: "custom" })}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "14px 12px",
                    borderRadius: "10px",
                    border: settings.llmProvider === "custom" ? "2px solid #3b82f6" : "1px solid var(--hk-border)",
                    background: settings.llmProvider === "custom" ? "rgba(59, 130, 246, 0.14)" : "var(--hk-bg-tertiary)",
                    color: "var(--hk-text-primary)",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                    boxShadow: settings.llmProvider === "custom" ? "0 4px 16px rgba(59, 130, 246, 0.25)" : "none"
                  }}
                >
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "14px", fontWeight: 700 }}>Custom API</div>
                    <div style={{ fontSize: "11px", color: "var(--hk-text-muted)", marginTop: "3px" }}>OpenRouter / Ollama</div>
                  </div>
                </button>
              </div>
            </div>

            {settings.llmProvider === "custom" && (
              <div className="hk-settings-row">
                <div className="hk-settings-row__info">
                  <label htmlFor="llmCustomUrl" className="hk-settings-row__label">Custom Endpoint URL</label>
                  <div id="llmCustomUrl-desc" className="hk-settings-row__desc">E.g., OpenRouter or OpenAI-compatible endpoint</div>
                </div>
                <div className="hk-settings-row__control">
                  <input
                    id="llmCustomUrl"
                    aria-describedby="llmCustomUrl-desc"
                    className="hk-settings-input hk-settings-input--text"
                    type="text"
                    placeholder="https://openrouter.ai/api/v1"
                    value={settings.llmCustomUrl || ""}
                    onChange={(e) => onUpdate({ llmCustomUrl: e.target.value })}
                  />
                </div>
              </div>
            )}

            <div className="hk-settings-row">
              <div className="hk-settings-row__info">
                <label htmlFor="llmApiKey" className="hk-settings-row__label">API Key</label>
                <div id="llmApiKey-desc" className="hk-settings-row__desc">Your provider API key (saved locally)</div>
              </div>
              <div className="hk-settings-row__control">
                <input
                  id="llmApiKey"
                  aria-describedby="llmApiKey-desc"
                  className="hk-settings-input hk-settings-input--text"
                  type="password"
                  placeholder="sk-..."
                  value={settings.llmApiKey || ""}
                  onChange={(e) => onUpdate({ llmApiKey: e.target.value })}
                />
              </div>
            </div>
          </div>
        </section>

        <section className="hk-settings-card">
          <header className="hk-settings-card__header">
            <div className="hk-settings-card__icon">
              <GraduationCap size={18} />
            </div>
            <h3 className="hk-settings-card__title">Study Preferences</h3>
          </header>
          
          <div className="hk-settings-card__body">
            <div className="hk-settings-row">
              <div className="hk-settings-row__info">
                <label htmlFor="localOcrEnabled" className="hk-settings-row__label">Enable Local OCR</label>
                <div id="localOcrEnabled-desc" className="hk-settings-row__desc">Run ML models locally (requires ~120MB download initially)</div>
              </div>
              <div className="hk-settings-row__control">
                <label className="hk-toggle" htmlFor="localOcrEnabled">
                  <input
                    id="localOcrEnabled"
                    aria-describedby="localOcrEnabled-desc"
                    type="checkbox"
                    checked={!!settings.localOcrEnabled}
                    onChange={(e) => onUpdate({ localOcrEnabled: e.target.checked })}
                  />
                  <span className="hk-toggle__slider" />
                </label>
              </div>
            </div>

            <div className="hk-settings-row">
              <div className="hk-settings-row__info">
                <label htmlFor="autoDetect" className="hk-settings-row__label">Auto-detect Japanese</label>
                <div id="autoDetect-desc" className="hk-settings-row__desc">Scan pages for Japanese text</div>
              </div>
              <div className="hk-settings-row__control">
                <label className="hk-toggle" htmlFor="autoDetect">
                  <input
                    id="autoDetect"
                    aria-describedby="autoDetect-desc"
                    type="checkbox"
                    checked={!!settings.autoDetect}
                    onChange={(e) => onUpdate({ autoDetect: e.target.checked })}
                  />
                  <span className="hk-toggle__slider" />
                </label>
              </div>
            </div>

            <div className="hk-settings-row">
              <div className="hk-settings-row__info">
                <label htmlFor="showFurigana" className="hk-settings-row__label">Show Furigana</label>
                <div id="showFurigana-desc" className="hk-settings-row__desc">Display readings above tokens</div>
              </div>
              <div className="hk-settings-row__control">
                <label className="hk-toggle" htmlFor="showFurigana">
                  <input
                    id="showFurigana"
                    aria-describedby="showFurigana-desc"
                    type="checkbox"
                    checked={!!settings.showFurigana}
                    onChange={(e) => onUpdate({ showFurigana: e.target.checked })}
                  />
                  <span className="hk-toggle__slider" />
                </label>
              </div>
            </div>
          </div>
        </section>

        <section className="hk-settings-card">
          <header className="hk-settings-card__header">
            <div className="hk-settings-card__icon">
              <Database size={18} />
            </div>
            <h3 className="hk-settings-card__title">Anki Integration Details</h3>
          </header>
          
          <div className="hk-settings-card__body">
            <div className="hk-settings-row">
              <div className="hk-settings-row__info">
                <label htmlFor="ankiDeck" className="hk-settings-row__label">Anki Deck Name</label>
                <div id="ankiDeck-desc" className="hk-settings-row__desc">Default deck for exports</div>
              </div>
              <div className="hk-settings-row__control">
                <input
                  id="ankiDeck"
                  aria-describedby="ankiDeck-desc"
                  className="hk-settings-input hk-settings-input--text"
                  type="text"
                  value={settings.ankiDeck || ""}
                  onChange={(e) => onUpdate({ ankiDeck: e.target.value })}
                />
              </div>
            </div>

            <div className="hk-settings-row">
              <div className="hk-settings-row__info">
                <label htmlFor="ankiModel" className="hk-settings-row__label">Anki Note Type</label>
                <div id="ankiModel-desc" className="hk-settings-row__desc">Card model for exports</div>
              </div>
              <div className="hk-settings-row__control">
                <input
                  id="ankiModel"
                  aria-describedby="ankiModel-desc"
                  className="hk-settings-input hk-settings-input--text"
                  type="text"
                  value={settings.ankiModel || ""}
                  onChange={(e) => onUpdate({ ankiModel: e.target.value })}
                />
              </div>
            </div>
          </div>
        </section>

      </form>

      <div className="hk-settings-footer">
        <strong className="hk-settings-footer__title">Hakkutsu v0.1.2</strong>
        <p className="hk-settings-footer__desc">
          AI-powered Japanese immersion browser extension.<br />
          Built with Plasmo, React, TypeScript.
        </p>
      </div>
    </div>
  );
}

