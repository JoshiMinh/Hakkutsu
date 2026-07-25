import type { ExtensionSettings } from "~types";

export function SettingsView({
  settings,
  onUpdate,
}: {
  settings: ExtensionSettings;
  onUpdate: (patch: Partial<ExtensionSettings>) => void;
}) {
  return (
    <div className="hk-content hk-fade-in">
      <div className="hk-settings__group">
        <label className="hk-settings__label">
          <div>
            <div className="hk-settings__label-text">Backend URL</div>
            <div className="hk-settings__label-desc">FastAPI server address</div>
          </div>
        </label>
        <input
          className="hk-settings__input"
          type="text"
          value={settings.backendUrl}
          onChange={(e) => onUpdate({ backendUrl: e.target.value })}
        />
      </div>

      <div className="hk-settings__group">
        <label className="hk-settings__label">
          <div>
            <div className="hk-settings__label-text">Auto-detect Japanese</div>
            <div className="hk-settings__label-desc">Scan pages for Japanese text</div>
          </div>
          <label className="hk-toggle">
            <input
              type="checkbox"
              checked={settings.autoDetect}
              onChange={(e) => onUpdate({ autoDetect: e.target.checked })}
            />
            <span className="hk-toggle__slider" />
          </label>
        </label>
      </div>

      <div className="hk-settings__group">
        <label className="hk-settings__label">
          <div>
            <div className="hk-settings__label-text">Show Furigana</div>
            <div className="hk-settings__label-desc">Display readings above tokens</div>
          </div>
          <label className="hk-toggle">
            <input
              type="checkbox"
              checked={settings.showFurigana}
              onChange={(e) => onUpdate({ showFurigana: e.target.checked })}
            />
            <span className="hk-toggle__slider" />
          </label>
        </label>
      </div>

      <div className="hk-settings__group">
        <label className="hk-settings__label">
          <div>
            <div className="hk-settings__label-text">Anki Deck Name</div>
            <div className="hk-settings__label-desc">Default deck for exports</div>
          </div>
        </label>
        <input
          className="hk-settings__input"
          type="text"
          value={settings.ankiDeck}
          onChange={(e) => onUpdate({ ankiDeck: e.target.value })}
        />
      </div>

      <div className="hk-settings__group">
        <label className="hk-settings__label">
          <div>
            <div className="hk-settings__label-text">Anki Note Type</div>
            <div className="hk-settings__label-desc">Card model for exports</div>
          </div>
        </label>
        <input
          className="hk-settings__input"
          type="text"
          value={settings.ankiModel}
          onChange={(e) => onUpdate({ ankiModel: e.target.value })}
        />
      </div>

      <div
        style={{
          marginTop: 24,
          padding: 12,
          background: "var(--hk-bg-secondary)",
          borderRadius: 8,
          border: "1px solid var(--hk-border)",
          fontSize: 11,
          color: "var(--hk-text-muted)",
          lineHeight: 1.6,
        }}
      >
        <strong style={{ color: "var(--hk-text-secondary)" }}>Hakkutsu v0.1.0</strong>
        <br />
        AI-powered Japanese immersion browser extension.
        <br />
        Built with Plasmo, React, TypeScript, FastAPI.
      </div>
    </div>
  );
}
