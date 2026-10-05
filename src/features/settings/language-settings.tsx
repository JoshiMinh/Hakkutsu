import { Languages } from "lucide-react";
import { t } from "~/shared/locales";
import type { SettingsSectionProps } from "./section-props";
import { CustomLanguageDropdown } from "./controls";

export function LanguageSettings({ settings, onUpdate }: SettingsSectionProps) {
  const currentLang = settings.targetLanguage || "vi";
  return (
    <section className="hk-settings-card">
      <header className="hk-settings-card__header">
        <div className="hk-settings-card__icon">
          <Languages size={18} />
        </div>
        <h3 className="hk-settings-card__title">
          {t("settings_lang_section", currentLang)}
        </h3>
      </header>

      <div className="hk-settings-card__body">
        <div className="hk-settings-row">
          <div className="hk-settings-row__info">
            <label className="hk-settings-row__label">
              {t("settings_lang_label", currentLang)}
            </label>
            <div className="hk-settings-row__desc">
              {t("settings_lang_desc", currentLang)}
            </div>
          </div>
          <div className="hk-settings-row__control">
            <CustomLanguageDropdown
              value={currentLang}
              onChange={(code) => onUpdate({ targetLanguage: code })}
            />
          </div>
        </div>

        <div className="hk-settings-row">
          <div className="hk-settings-row__info">
            <label htmlFor="showHanViet" className="hk-settings-row__label">
              {t("settings_hanviet", currentLang)}
            </label>
            <div id="showHanViet-desc" className="hk-settings-row__desc">
              {t("settings_hanviet_desc", currentLang)}
            </div>
          </div>
          <div className="hk-settings-row__control">
            <label className="hk-toggle" htmlFor="showHanViet">
              <input
                id="showHanViet"
                aria-describedby="showHanViet-desc"
                type="checkbox"
                checked={settings.showHanViet !== false}
                onChange={(e) => onUpdate({ showHanViet: e.target.checked })}
              />
              <span className="hk-toggle__slider" />
            </label>
          </div>
        </div>
      </div>
    </section>
  );
}
