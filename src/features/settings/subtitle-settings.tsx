import { Film } from "lucide-react";
import { t } from "~/shared/locales";
import type { SettingsSectionProps } from "./section-props";
import { FeatureSwitch } from "./controls";

export function SubtitleSettings({ settings, onUpdate }: SettingsSectionProps) {
  const currentLang = settings.targetLanguage || "vi";
  return (
    <section className="hk-settings-card">
      <header className="hk-settings-card__header">
        <div
          className="hk-settings-card__icon"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Film size={18} />
        </div>
        <h3 className="hk-settings-card__title">
          {t("settings_video_section", currentLang)}
        </h3>
        <FeatureSwitch
          label={t("settings_video_section", currentLang)}
          checked={settings.subtitlesEnabled !== false}
          onChange={(enabled) => onUpdate({ subtitlesEnabled: enabled })}
        />
      </header>

      <fieldset
        className="hk-settings-card__body hk-feature-body"
        disabled={settings.subtitlesEnabled === false}
      >
        <div className="hk-settings-row">
          <div className="hk-settings-row__info">
            <label
              htmlFor="subtitlesSecondary"
              className="hk-settings-row__label"
            >
              {t("sub_modal_track_secondary", currentLang) ||
                "Secondary Subtitles (Dual Translation)"}
            </label>
            <div id="subtitlesSecondary-desc" className="hk-settings-row__desc">
              Display secondary translated or native subtitle line beneath
              Japanese text
            </div>
          </div>
          <div className="hk-settings-row__control">
            <label className="hk-toggle" htmlFor="subtitlesSecondary">
              <input
                id="subtitlesSecondary"
                aria-describedby="subtitlesSecondary-desc"
                type="checkbox"
                disabled={settings.subtitlesEnabled === false}
                checked={settings.subtitlesSecondaryEnabled !== false}
                onChange={(e) =>
                  onUpdate({ subtitlesSecondaryEnabled: e.target.checked })
                }
              />
              <span className="hk-toggle__slider" />
            </label>
          </div>
        </div>

        <div className="hk-settings-row">
          <div className="hk-settings-row__info">
            <label
              htmlFor="subtitlesAutoPause"
              className="hk-settings-row__label"
            >
              {t("settings_sub_autopause", currentLang) ||
                "Auto-Pause Playback"}
            </label>
            <div id="subtitlesAutoPause-desc" className="hk-settings-row__desc">
              {t("settings_sub_autopause_desc", currentLang) ||
                "Automatically pause playback after each subtitle line for study"}
            </div>
          </div>
          <div className="hk-settings-row__control">
            <label className="hk-toggle" htmlFor="subtitlesAutoPause">
              <input
                id="subtitlesAutoPause"
                aria-describedby="subtitlesAutoPause-desc"
                type="checkbox"
                disabled={settings.subtitlesEnabled === false}
                checked={Boolean(settings.subtitlesAutoPause)}
                onChange={(e) =>
                  onUpdate({ subtitlesAutoPause: e.target.checked })
                }
              />
              <span className="hk-toggle__slider" />
            </label>
          </div>
        </div>

        <div className="hk-settings-row">
          <div className="hk-settings-row__info">
            <label htmlFor="showFuriganaSub" className="hk-settings-row__label">
              {t("settings_furigana", currentLang)}
            </label>
            <div id="showFuriganaSub-desc" className="hk-settings-row__desc">
              {t("settings_furigana_desc", currentLang)}
            </div>
          </div>
          <div className="hk-settings-row__control">
            <label className="hk-toggle" htmlFor="showFuriganaSub">
              <input
                id="showFuriganaSub"
                aria-describedby="showFuriganaSub-desc"
                type="checkbox"
                disabled={settings.subtitlesEnabled === false}
                checked={settings.showFurigana !== false}
                onChange={(e) => onUpdate({ showFurigana: e.target.checked })}
              />
              <span className="hk-toggle__slider" />
            </label>
          </div>
        </div>

        <div className="hk-settings-row">
          <div className="hk-settings-row__info">
            <label
              htmlFor="subtitlesFontSize"
              className="hk-settings-row__label"
            >
              {t("settings_sub_fontsize", currentLang) || "Subtitle Font Size"}{" "}
              ({settings.subtitlesFontSize || 26}px)
            </label>
            <div id="subtitlesFontSize-desc" className="hk-settings-row__desc">
              {t("settings_sub_fontsize_desc", currentLang) ||
                "Adjust subtitle text scale on video player overlays"}
            </div>
          </div>
          <div className="hk-settings-row__control" style={{ width: "160px" }}>
            <input
              id="subtitlesFontSize"
              aria-describedby="subtitlesFontSize-desc"
              type="range"
              min="18"
              max="38"
              disabled={settings.subtitlesEnabled === false}
              value={settings.subtitlesFontSize || 26}
              onChange={(e) =>
                onUpdate({ subtitlesFontSize: Number(e.target.value) })
              }
              style={{ width: "100%", accentColor: "var(--hk-accent-primary)" }}
            />
          </div>
        </div>
      </fieldset>
    </section>
  );
}
