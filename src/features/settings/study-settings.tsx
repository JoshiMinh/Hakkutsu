import { GraduationCap } from "lucide-react";
import type { ExtensionSettings, SelectiveFuriganaMode } from "~/features/settings/types";
import { t } from "~/shared/locales";
import type { SettingsSectionProps } from "./section-props";
import { CompactToggle, type CustomSelectOption } from "./controls";

export function StudySettings({ settings, onUpdate }: SettingsSectionProps) {
  const currentLang = settings.targetLanguage || "vi";
  const furiganaModeOptions: CustomSelectOption[] = [
    {
      value: "unlearned",
      label: t("settings_furigana_mode_unlearned", currentLang),
    },
    { value: "n3_plus", label: t("settings_furigana_mode_n3", currentLang) },
    { value: "n2_plus", label: t("settings_furigana_mode_n2", currentLang) },
    { value: "n1_only", label: t("settings_furigana_mode_n1", currentLang) },
    { value: "all", label: t("settings_furigana_mode_all", currentLang) },
  ];
  const srsAlgoOptions: CustomSelectOption[] = [
    { value: "fsrs", label: t("settings_srs_algo_fsrs", currentLang) },
    { value: "sm2", label: t("settings_srs_algo_sm2", currentLang) },
  ];
  return (
    <section className="hk-settings-card hk-general-card">
      <header className="hk-settings-card__header">
        <div className="hk-settings-card__icon">
          <GraduationCap size={18} />
        </div>
        <h3 className="hk-settings-card__title">
          {t("settings_study_section", currentLang)}
        </h3>
      </header>
      <div className="hk-general-grid">
        <section
          className="hk-general-group"
          aria-labelledby="general-reading-title"
        >
          <h4 id="general-reading-title">
            {t("settings_reading_group", currentLang)}
          </h4>
          <CompactToggle
            id="autoDetect"
            label={t("settings_autodetect", currentLang)}
            description={t("settings_autodetect_desc", currentLang)}
            checked={!!settings.autoDetect}
            onChange={(enabled) => onUpdate({ autoDetect: enabled })}
          />
          <CompactToggle
            id="showFurigana"
            label={t("settings_furigana", currentLang)}
            description={t("settings_furigana_desc", currentLang)}
            checked={settings.showFurigana !== false}
            onChange={(enabled) => onUpdate({ showFurigana: enabled })}
          />
          <CompactToggle
            id="webpageDensityBadgeEnabled"
            label={t("settings_density_badge", currentLang)}
            description={t("settings_density_badge_desc", currentLang)}
            checked={settings.webpageDensityBadgeEnabled !== false}
            onChange={(enabled) =>
              onUpdate({ webpageDensityBadgeEnabled: enabled })
            }
          />
          <CompactToggle
            id="selectiveFuriganaEnabled"
            label={t("settings_selective_furigana", currentLang)}
            description={t("settings_selective_furigana_desc", currentLang)}
            checked={!!settings.selectiveFuriganaEnabled}
            onChange={(enabled) =>
              onUpdate({ selectiveFuriganaEnabled: enabled })
            }
          />
          {settings.selectiveFuriganaEnabled && (
            <div className="hk-general-field">
              <label
                className="hk-settings-row__label"
                htmlFor="selectiveFuriganaMode"
              >
                {t("settings_furigana_mode", currentLang)}
              </label>
              <select
                id="selectiveFuriganaMode"
                className="hk-general-select"
                title={t("settings_furigana_mode_desc", currentLang)}
                value={settings.selectiveFuriganaMode || "unlearned"}
                onChange={(event) =>
                  onUpdate({
                    selectiveFuriganaMode: event.target
                      .value as SelectiveFuriganaMode,
                  })
                }
              >
                {furiganaModeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </section>
        <section
          className="hk-general-group"
          aria-labelledby="general-review-title"
        >
          <h4 id="general-review-title">
            {t("settings_review_group", currentLang)}
          </h4>
          <CompactToggle
            id="srsEnabled"
            label={t("settings_srs", currentLang)}
            description={t("settings_srs_desc", currentLang)}
            checked={settings.srsEnabled !== false}
            onChange={(enabled) => onUpdate({ srsEnabled: enabled })}
          />
          <fieldset
            className="hk-general-review-options"
            disabled={settings.srsEnabled === false}
          >
            <CompactToggle
              id="audioFirstReviewMode"
              label={t("settings_audio_first", currentLang)}
              description={t("settings_audio_first_desc", currentLang)}
              checked={!!settings.audioFirstReviewMode}
              onChange={(enabled) =>
                onUpdate({ audioFirstReviewMode: enabled })
              }
            />
            <CompactToggle
              id="clozeReviewMode"
              label={t("settings_cloze_mode", currentLang)}
              description={t("settings_cloze_mode_desc", currentLang)}
              checked={!!settings.clozeReviewMode}
              onChange={(enabled) => onUpdate({ clozeReviewMode: enabled })}
            />
          </fieldset>
          <CompactToggle
            id="includeImages"
            label={t("settings_card_images", currentLang)}
            description="Automatically attach illustrations to cards and Anki exports"
            checked={settings.includeImages !== false}
            onChange={(enabled) => onUpdate({ includeImages: enabled })}
          />
        </section>
      </div>
      <details className="hk-general-advanced">
        <summary>{t("settings_advanced_review", currentLang)}</summary>
        <fieldset
          className="hk-general-advanced__fields"
          disabled={settings.srsEnabled === false}
        >
          <div className="hk-general-field">
            <label className="hk-settings-row__label" htmlFor="srsAlgorithm">
              {t("settings_srs_algorithm", currentLang)}
            </label>
            <select
              id="srsAlgorithm"
              className="hk-general-select"
              title={t("settings_srs_algorithm_desc", currentLang)}
              value={settings.srsAlgorithm || "fsrs"}
              onChange={(event) =>
                onUpdate({
                  srsAlgorithm: event.target
                    .value as ExtensionSettings["srsAlgorithm"],
                })
              }
            >
              {srsAlgoOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          {settings.srsAlgorithm !== "sm2" && (
            <div className="hk-general-field">
              <label
                className="hk-settings-row__label"
                htmlFor="fsrsRequestRetention"
              >
                {t("settings_fsrs_retention", currentLang)}{" "}
                <output htmlFor="fsrsRequestRetention">
                  {Math.round((settings.fsrsRequestRetention ?? 0.9) * 100)}%
                </output>
              </label>
              <input
                id="fsrsRequestRetention"
                type="range"
                min="80"
                max="97"
                step="1"
                title={t("settings_fsrs_retention_desc", currentLang)}
                value={Math.round((settings.fsrsRequestRetention ?? 0.9) * 100)}
                onChange={(event) =>
                  onUpdate({
                    fsrsRequestRetention: Number(event.target.value) / 100,
                  })
                }
              />
            </div>
          )}
          <div className="hk-general-field">
            <label
              className="hk-settings-row__label"
              htmlFor="srsLeechThreshold"
            >
              {t("settings_leech_threshold", currentLang)}{" "}
              <output htmlFor="srsLeechThreshold">
                {settings.srsLeechThreshold || 4}
              </output>
            </label>
            <input
              id="srsLeechThreshold"
              type="range"
              min="2"
              max="8"
              title={t("settings_leech_threshold_desc", currentLang)}
              value={settings.srsLeechThreshold || 4}
              onChange={(event) =>
                onUpdate({ srsLeechThreshold: Number(event.target.value) })
              }
            />
          </div>
        </fieldset>
      </details>
    </section>
  );
}
