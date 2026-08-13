import type { ExtensionSettings } from "~lib/types";

export function SettingsView({
  settings,
  onUpdate,
}: {
  settings: ExtensionSettings;
  onUpdate: (patch: Partial<ExtensionSettings>) => void;
}) {
  return (
    <div className="hk-content hk-fade-in">
      <form className="hk-settings-form" onSubmit={(e) => e.preventDefault()}>
        
        <fieldset className="hk-settings-card">
          <legend className="hk-settings-card__title">Translation LLM</legend>
          <div className="hk-settings-row">
            <div className="hk-settings-row__info">
              <label htmlFor="llmProvider" className="hk-settings-row__label">LLM Provider</label>
              <div id="llmProvider-desc" className="hk-settings-row__desc">Service used for translations</div>
            </div>
            <div className="hk-settings-row__control">
              <select
                id="llmProvider"
                className="hk-settings-input hk-settings-input--text"
                value={settings.llmProvider}
                onChange={(e) => onUpdate({ llmProvider: e.target.value as any })}
              >
                <option value="gemini">Google Gemini</option>
                <option value="openai">OpenAI</option>
                <option value="custom">Custom Endpoint</option>
              </select>
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
                  value={settings.llmApiKey}
                  onChange={(e) => onUpdate({ llmApiKey: e.target.value })}
                />
              </div>
            </div>
        </fieldset>

        <fieldset className="hk-settings-card">
          <legend className="hk-settings-card__title">Study Preferences</legend>
          
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
                  checked={settings.localOcrEnabled}
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
                  checked={settings.autoDetect}
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
                  checked={settings.showFurigana}
                  onChange={(e) => onUpdate({ showFurigana: e.target.checked })}
                />
                <span className="hk-toggle__slider" />
              </label>
            </div>
          </div>
        </fieldset>

        <fieldset className="hk-settings-card">
          <legend className="hk-settings-card__title">Anki Integration</legend>
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
                value={settings.ankiDeck}
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
                value={settings.ankiModel}
                onChange={(e) => onUpdate({ ankiModel: e.target.value })}
              />
            </div>
          </div>
        </fieldset>

      </form>

      <div className="hk-settings-footer">
        <strong className="hk-settings-footer__title">Hakkutsu v0.1.0</strong>
        <p className="hk-settings-footer__desc">
          AI-powered Japanese immersion browser extension.<br />
          Built with Plasmo, React, TypeScript, FastAPI.
        </p>
      </div>
    </div>
  );
}
