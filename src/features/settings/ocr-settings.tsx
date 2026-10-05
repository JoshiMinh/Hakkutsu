import { Crop } from "lucide-react";
import { t } from "~/shared/locales";
import type { SettingsSectionProps } from "./section-props";
import {
  CustomSelect,
  FeatureSwitch,
  type CustomSelectOption,
} from "./controls";

export function OcrSettings({ settings, onUpdate }: SettingsSectionProps) {
  const currentLang = settings.targetLanguage || "vi";
  const ocrOrientationOptions: CustomSelectOption[] = [
    {
      value: "auto",
      label: t("ocr_orientation_auto", currentLang) || "Auto Detect",
    },
    {
      value: "vertical",
      label: t("ocr_orientation_vertical", currentLang) || "Vertical (縦書き)",
    },
    {
      value: "horizontal",
      label:
        t("ocr_orientation_horizontal", currentLang) || "Horizontal (横書き)",
    },
  ];
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
          <Crop size={18} />
        </div>
        <h3 className="hk-settings-card__title">
          {t("settings_ocr_section", currentLang)}
        </h3>
        <FeatureSwitch
          label={t("settings_ocr_section", currentLang)}
          checked={settings.mangaOcrEnabled !== false}
          onChange={(enabled) => onUpdate({ mangaOcrEnabled: enabled })}
        />
      </header>

      <fieldset
        className="hk-settings-card__body hk-feature-body"
        disabled={settings.mangaOcrEnabled === false}
      >
        <div className="hk-settings-row">
          <div className="hk-settings-row__info">
            <label className="hk-settings-row__label">
              Text Orientation Mode
            </label>
            <div className="hk-settings-row__desc">
              Default orientation for Japanese text recognition (Auto detects
              tall vs wide images)
            </div>
          </div>
          <div className="hk-settings-row__control">
            <CustomSelect
              value={settings.ocrDefaultOrientation || "auto"}
              onChange={(val) =>
                onUpdate({ ocrDefaultOrientation: val as any })
              }
              options={ocrOrientationOptions}
              width="260px"
            />
          </div>
        </div>

        <div className="hk-settings-row">
          <div className="hk-settings-row__info">
            <label
              htmlFor="ocrPreprocessEnabled"
              className="hk-settings-row__label"
            >
              {t("ocr_preprocess", currentLang)}
            </label>
            <div
              id="ocrPreprocessEnabled-desc"
              className="hk-settings-row__desc"
            >
              {t("ocr_preprocess_desc", currentLang)}
            </div>
          </div>
          <div className="hk-settings-row__control">
            <label className="hk-toggle" htmlFor="ocrPreprocessEnabled">
              <input
                id="ocrPreprocessEnabled"
                aria-describedby="ocrPreprocessEnabled-desc"
                type="checkbox"
                checked={settings.ocrPreprocessEnabled !== false}
                onChange={(e) =>
                  onUpdate({ ocrPreprocessEnabled: e.target.checked })
                }
              />
              <span className="hk-toggle__slider" />
            </label>
          </div>
        </div>
      </fieldset>
    </section>
  );
}
