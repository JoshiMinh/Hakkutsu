import { useId, useState } from "react";
import type { SrsCard } from "~/features/srs/local-srs";
import { FieldPreview } from "./field-preview";
import { uploadLocalMedia } from "./media";
import { useTranslation } from "~/shared/locales";
import { ankiClient } from "./anki-connect";
import { AnkiFeedback } from "./feedback";
import { Upload } from "lucide-react";

export function AnkiCardFields({ card, onChange, onUnlink }: { card: SrsCard; onChange: (field: keyof SrsCard, value: string) => void; onUnlink: () => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const id = useId();
  return <section className="hk-anki-card-fields">
    <h3>{t("anki_details")}</h3>
    {(["word_audio", "sentence_audio", "notes", "picture"] as const).map(field => <div className="hk-anki-stack" key={field}>
      <label htmlFor={`${id}-${field}`}>{t(`anki_field_${field}`)}</label>
      <textarea id={`${id}-${field}`} value={card[field] || ""} onChange={event => onChange(field, event.target.value)} />
      <FieldPreview value={card[field] || ""} profile={card.anki?.profile || card.media_profile} />
      {field !== "notes" && <label className="hk-btn hk-btn--secondary hk-anki-upload">
        <Upload size={14} />{t(field === "picture" ? "anki_upload_picture" : "anki_upload_audio")}
        <input type="file" disabled={busy} aria-label={t(field === "picture" ? "anki_upload_picture" : "anki_upload_audio")}
        accept={field === "picture" ? "image/png,image/jpeg,image/webp,image/gif,image/avif" : "audio/mpeg,audio/ogg,audio/wav,audio/mp4,audio/webm"}
        onChange={event => {
          const file = event.target.files?.[0]; event.target.value = "";
          if (!file) return;
          setBusy(true); setError(undefined);
          void (async () => {
            const profile = card.anki?.profile || card.media_profile || await ankiClient.getProfile();
            const value = await uploadLocalMedia(file, profile);
            onChange("media_profile", profile); onChange(field, value);
          })().catch(setError).finally(() => setBusy(false));
        }} /></label>}
    </div>)}
    {card.anki && <details><summary>{t("anki_details")}</summary>
      {[card.word_furigana, card.meaning, card.sentence, card.sentence_furigana, card.sentence_meaning].map((value, index) =>
        value && <FieldPreview key={index} value={value} profile={card.anki?.profile} />)}
    </details>}
    {card.anki && <button type="button" className="hk-btn hk-btn--secondary" disabled={busy} onClick={onUnlink}>{t("anki_unlink")}</button>}
    {!!error && <AnkiFeedback error={error} />}
    {busy && <p role="status">{t("anki_working")}</p>}
  </section>;
}
