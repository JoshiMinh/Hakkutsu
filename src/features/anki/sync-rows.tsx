import type { SyncPlan, SyncRow } from "./sync-plan";
import { chooseLink } from "./sync-plan";
import { plainText } from "./japanese-schema";
import { FieldPreview } from "./field-preview";
import { ankiFieldLabel } from "./field-labels";
import { CustomSelect } from "~/features/settings/controls";
import { useTranslation } from "~/shared/locales";
import { useState } from "react";

export function SyncRows({ rows, plan, busy, statuses, changeRow }: {
  rows: SyncRow[]; plan: SyncPlan; busy: boolean; statuses: Record<string, string>;
  changeRow: (id: string, change: (row: SyncRow) => SyncRow) => void;
}) {
  const { t } = useTranslation();
  return <div className="hk-anki-rows">{rows.map(row => {
    const word = plainText(row.remote?.fields.Word.value || row.local?.word || "");
    const reading = plainText(row.remote?.fields["Word Reading"].value || row.local?.reading || "");
    const status = statuses[row.id];
    return <article key={row.id} className={`hk-anki-row ${status ? `is-${status}` : ""}`}>
      <div className="hk-anki-row__summary">
        <label className="hk-anki-row__word"><input type="checkbox" disabled={busy} checked={row.selected}
          onChange={event => changeRow(row.id, old => ({ ...old, selected: event.target.checked }))} />
          <span><strong lang="ja">{word}</strong><small lang="ja">{reading}</small></span></label>
        <span className="hk-anki-row__meaning" title={plainText(row.fields["Word Meaning"])}>{plainText(row.fields["Word Meaning"]) || "—"}</span>
        <span className={`hk-anki-status hk-anki-status--${row.kind}`}>{t(`anki_kind_${row.kind}`)}</span>
        {status && <span className="hk-anki-row__state">{t(status === "completed" ? "anki_completed" : status === "failed" ? "anki_failed" : "anki_working")}</span>}
      </div>
      {(row.kind === "ambiguous" || (row.candidates?.length && !row.local?.anki)) ? <div className="hk-anki-row__matching">
        <CustomSelect width="100%" ariaLabel={`${t("anki_link_choice")}: ${word}`} disabled={busy} placeholder={t("anki_choose")}
          value={row.local?.id || (row.kind === "ambiguous" ? "" : "new")}
          options={[{ value: "new", label: t("anki_import_separate") }, ...(row.candidates || []).map(card => ({ value: card.id,
            label: `${card.word} · ${card.reading || ""} · ${plainText(card.meaning || "").slice(0, 60)}` }))]}
          onChange={value => changeRow(row.id, old => chooseLink(old, old.candidates?.find(card => card.id === value)))} />
      </div> : null}
      {row.kind === "missing" && <p className="hk-anki-muted">{t("anki_missing_note")}</p>}
      {row.conflicts.map(conflict => <fieldset className="hk-anki-conflict" key={conflict.field} disabled={busy || !row.selected}>
        <legend>{ankiFieldLabel(conflict.field, t)} · {t("anki_conflict")}</legend>
        {(["local", "anki"] as const).map(side => <label key={side} className={row.choices[conflict.field] === side ? "is-selected" : ""}>
          <span><input type="radio" name={`${plan.profile}:${row.id}:${conflict.field}`} checked={row.choices[conflict.field] === side}
            onChange={() => changeRow(row.id, old => ({ ...old, choices: { ...old.choices, [conflict.field]: side } }))} />{side === "local" ? "Hakkutsu" : "Anki"}</span>
          <FieldPreview value={side === "local" ? conflict.local : conflict.anki}
            profile={side === "local" ? row.local?.anki?.profile || row.local?.media_profile || plan.profile : plan.profile} />
        </label>)}
      </fieldset>)}
      <SyncFieldDetails fields={row.fields} profile={plan.profile} />
    </article>;
  })}</div>;
}

function SyncFieldDetails({ fields, profile }: { fields: Record<string, string>; profile: string }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  return <details className="hk-anki-row__details" onToggle={event => setExpanded(event.currentTarget.open)}><summary>{t("anki_details")}</summary>
    {expanded && <dl className="hk-anki-field-grid">{Object.entries(fields).map(([field, value]) => <div key={field}>
      <dt>{ankiFieldLabel(field, t)}</dt><dd><FieldPreview value={value || "—"} profile={profile} /></dd>
    </div>)}</dl>}
  </details>;
}
