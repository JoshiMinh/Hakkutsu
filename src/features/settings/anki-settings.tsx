import { JAPANESE_PRESET } from "~/features/anki/japanese-schema";
import { ANKI_MAPPING_LABELS, ankiFieldLabel } from "~/features/anki/field-labels";
import { RefreshCw } from "lucide-react";
import { t, type TranslationKey } from "~/shared/locales";
import type { SettingsSectionProps } from "./section-props";
import { CustomSelect, FeatureSwitch } from "./controls";
import { useAnkiSettings } from "./use-anki-settings";

export function AnkiSettings({ settings, onUpdate }: SettingsSectionProps) {
  const tr = (key: TranslationKey) => t(key, settings.targetLanguage);
  const { decks, models, fields, ankiConnected, loadingAnki, fetchAnkiData, handleModelChange, inferDefaultMapping } = useAnkiSettings(settings, onUpdate);
  const disabled = settings.ankiEnabled === false;
  const choices = Object.entries(ANKI_MAPPING_LABELS).map(([value, key]) => ({ value, label: tr(key) }));
  return <section className="hk-settings-card hk-anki-settings">
    <header className="hk-settings-card__header hk-anki-header">
      <div className="hk-anki-header__title">
        <div className="hk-settings-card__icon"><img src="/assets/logo/anki.png" alt="" width={18} height={18} /></div>
        <h3 className="hk-settings-card__title">{tr("settings_anki_section")}</h3>
        <button type="button" onClick={() => void fetchAnkiData()} disabled={loadingAnki || disabled} className="hk-btn hk-btn--secondary hk-btn--sm">
          <RefreshCw size={13} className={loadingAnki ? "hk-spin" : undefined} aria-hidden="true" />{tr(loadingAnki ? "anki_working" : "anki_refresh")}
        </button>
      </div>
      <FeatureSwitch label={tr("settings_anki_section")} checked={!disabled} onChange={enabled => onUpdate({ ankiEnabled: enabled })} />
    </header>
    <fieldset className="hk-settings-card__body hk-feature-body" disabled={disabled}>
      <div className="hk-settings-row">
        <div className="hk-settings-row__info"><label htmlFor="ankiModel" className="hk-settings-row__label">{tr("settings_anki_model")}</label>
          <div id="ankiModel-desc" className="hk-settings-row__desc">{tr("settings_anki_model_desc")}</div></div>
        <div className="hk-settings-row__control">{models.length ? <CustomSelect id="ankiModel" ariaLabel={tr("settings_anki_model")} describedBy="ankiModel-desc"
          value={settings.ankiModel} options={models.map(model => ({ value: model, label: model }))} onChange={value => void handleModelChange(value)} disabled={disabled} />
          : <input id="ankiModel" aria-describedby="ankiModel-desc" className="hk-settings-input hk-settings-input--text" value={settings.ankiModel}
            onChange={event => void handleModelChange(event.target.value)} />}</div>
      </div>
      <div className="hk-settings-row">
        <div className="hk-settings-row__info"><label htmlFor="ankiDeck" className="hk-settings-row__label">{tr("settings_anki_deck")}</label>
          <div id="ankiDeck-desc" className="hk-settings-row__desc">{tr("settings_anki_deck_desc")}</div></div>
        <div className="hk-settings-row__control">{decks.length ? <CustomSelect id="ankiDeck" ariaLabel={tr("settings_anki_deck")} describedBy="ankiDeck-desc"
          value={settings.ankiDeck} options={decks.map(deck => ({ value: deck, label: deck }))} onChange={value => onUpdate({ ankiDeck: value })} disabled={disabled} />
          : <input id="ankiDeck" aria-describedby="ankiDeck-desc" className="hk-settings-input hk-settings-input--text" value={settings.ankiDeck} onChange={event => onUpdate({ ankiDeck: event.target.value })} />}</div>
      </div>
      <div className="hk-settings-row">
        <div className="hk-settings-row__info"><label htmlFor="anki-preset" className="hk-settings-row__label">{tr("anki_preset")}</label>
          <div id="anki-preset-desc" className="hk-settings-row__desc">{tr("anki_preset_help")}</div></div>
        <div className="hk-settings-row__control"><CustomSelect id="anki-preset" ariaLabel={tr("anki_preset")} describedBy="anki-preset-desc" value={settings.ankiPreset || "custom"}
          options={[{ value: "custom", label: tr("anki_custom") }, { value: "japanese", label: tr("anki_japanese_preset") }]} disabled={disabled}
          onChange={value => onUpdate({ ankiPreset: value as "custom" | "japanese", ...(value === "japanese" ? { ankiFieldMap: { ...JAPANESE_PRESET } } : {}) })} /></div>
      </div>
      {fields.length > 0 && <>
        <div className="hk-anki-mapping-header"><div><h4>{tr("anki_mappings")}</h4><p>{tr("anki_mappings_help")}</p></div>
          <button type="button" className="hk-btn hk-btn--secondary hk-btn--sm" onClick={() => onUpdate({ ankiFieldMap: Object.fromEntries(fields.map(field => [field, inferDefaultMapping(field)])) })}>{tr("anki_auto_map")}</button></div>
        {fields.map((field, index) => <div key={field} className="hk-settings-row">
          <div className="hk-settings-row__info"><label htmlFor={`anki-field-${index}`} className="hk-settings-row__label">{ankiFieldLabel(field, tr)}</label><span className="hk-settings-row__desc">{field}</span></div>
          <div className="hk-settings-row__control"><CustomSelect id={`anki-field-${index}`} ariaLabel={ankiFieldLabel(field, tr)}
            value={settings.ankiFieldMap?.[field] ?? inferDefaultMapping(field)} options={choices} disabled={disabled}
            onChange={value => onUpdate({ ankiFieldMap: { ...settings.ankiFieldMap, [field]: value }, ankiPreset: "custom" })} /></div>
        </div>)}
      </>}
      <p className="hk-anki-connection" role="status"><span className={`hk-anki-dot ${ankiConnected ? "is-connected" : ""}`} />
        {tr(ankiConnected ? "settings_anki_status_running" : "settings_anki_status_disconnected")}</p>
    </fieldset>
  </section>;
}
