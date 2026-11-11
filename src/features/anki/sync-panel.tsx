import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "~/shared/locales";
import type { ExtensionSettings } from "~/features/settings/types";
import { applySync, previewSync, pendingExports, releasePendingExport, type SyncResult } from "./sync-service";
import { chooseLink, type SyncPlan, type SyncRow } from "./sync-plan";
import { plainText } from "./japanese-schema";
import { FieldPreview } from "./field-preview";
import { downloadRecoverySnapshot } from "~/features/vocabulary/data-backup";

export function AnkiSyncPanel({ settings, onChanged }: { settings: ExtensionSettings; onChanged: () => Promise<void> }) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [plan, setPlan] = useState<SyncPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<SyncResult | null>(null);
  const [limit, setLimit] = useState(50);
  const [pending, setPending] = useState<Array<{ key: string; tag: string }>>([]);
  useEffect(() => {
    if (dialog.current?.open && !dialog.current.contains(document.activeElement)) {
      if (busy) dialog.current.focus(); else closeButton.current?.focus();
    }
  }, [busy]);
  const refresh = async () => {
    setBusy(true); setError(""); setPlan(null); setResult(null);
    try { const next = await previewSync(settings); setPlan(next); setPending(await pendingExports(next.profile)); setLimit(50); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const open = () => { dialog.current?.showModal(); void refresh(); };
  const changeRow = (id: string, change: (row: SyncRow) => SyncRow) => setPlan(current => current && ({ ...current,
    rows: current.rows.map(row => row.id === id ? change(row) : row) }));
  const apply = async () => {
    if (!plan) return;
    setBusy(true); setError("");
    try {
      setResult(await applySync(plan, (done, total) => setProgress(`${done} / ${total}`)));
      setPlan(null);
      await onChanged();
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); setProgress(""); }
  };
  const rows = plan?.rows.filter(row => row.kind !== "unchanged") || [];
  const selected = rows.filter(row => row.selected);
  const unresolved = selected.some(row => row.kind === "ambiguous" || row.conflicts.some(conflict => !row.choices[conflict.field]));
  return <>
    <button type="button" className="hk-btn hk-btn--secondary" disabled={settings.ankiEnabled === false} onClick={open}>{t("anki_sync")}</button>
    <dialog ref={dialog} className="hk-anki-dialog" tabIndex={-1} aria-labelledby={titleId} onCancel={event => { if (busy) event.preventDefault(); }}>
      <div className="hk-anki-toolbar"><h2 id={titleId}>{t("anki_sync")}</h2>
        <button ref={closeButton} type="button" className="hk-btn hk-btn--secondary" disabled={busy} onClick={() => dialog.current?.close()}>{t("anki_close")}</button></div>
      <p>{settings.ankiDeck} · {settings.ankiModel}</p>
      <p>{t("anki_sync_help")}</p>
      <div className="hk-anki-toolbar">
        <button type="button" className="hk-btn hk-btn--secondary" disabled={busy} onClick={() => void refresh()}>{t("anki_refresh")}</button>
        <button type="button" className="hk-btn hk-btn--secondary" disabled={busy} onClick={() => {
          void downloadRecoverySnapshot().catch(error => setError(String(error)));
        }}>{t("anki_recovery")}</button>
      </div>
      {busy && <p role="status">{t("anki_working")} {progress}</p>}
      {error && <p role="alert">{error}</p>}
      {result && <div role="status"><p>{t("anki_completed")}: {result.completed} · {t("anki_failed")}: {result.failures.length}</p>
        <ul>{result.failures.map(failure => <li key={failure.id}>{failure.id}: {failure.message}</li>)}</ul></div>}
      {plan && <>
        {pending.map(item => <div className="hk-anki-change" key={item.key}>
          <p>{t("anki_pending_export")} · {item.tag}</p>
          <button type="button" className="hk-btn hk-btn--secondary" disabled={busy} onClick={() => {
            setBusy(true); setError("");
            void releasePendingExport(plan.profile, item.key).then(() => setPending(values => values.filter(value => value.key !== item.key)), error => setError(String(error))).finally(() => setBusy(false));
          }}>{t("anki_release_export")}</button>
        </div>)}
        <p>{plan.profile} · {t("anki_changes")}: {rows.length} · {t("anki_selected")}: {selected.length}</p>
        <div className="hk-anki-toolbar"><button type="button" className="hk-btn hk-btn--secondary" disabled={busy}
          onClick={() => setPlan({ ...plan, rows: plan.rows.map(row => ({ ...row, selected: false })) })}>{t("anki_deselect")}</button></div>
        <div className="hk-anki-changes" aria-busy={busy}>
          {rows.slice(0, limit).map(row => <article key={row.id} className="hk-anki-change">
            <label><input type="checkbox" disabled={busy} checked={row.selected} onChange={event => changeRow(row.id, old => ({ ...old, selected: event.target.checked }))} />
              {plainText(row.remote?.fields.Word.value || row.local?.word || "")} · {t(`anki_kind_${row.kind}`)}</label>
            {(row.kind === "ambiguous" || (row.candidates && row.candidates.length > 0 && !row.local?.anki)) && <label className="hk-anki-stack">{t("anki_link_choice")}
              <select disabled={busy} value={row.local?.id || (row.kind === "ambiguous" ? "" : "new")}
                onChange={event => changeRow(row.id, old => chooseLink(old, old.candidates?.find(card => card.id === event.target.value)))}>
                <option value="" disabled>{t("anki_choose")}</option><option value="new">{t("anki_import_separate")}</option>
                {row.candidates?.map(card => <option key={card.id} value={card.id}>{card.word} · {card.reading} · {plainText(card.meaning || "").slice(0, 80)}</option>)}
              </select></label>}
            {row.kind === "missing" && <p>{t("anki_missing_note")}</p>}
            {row.conflicts.map(conflict => <fieldset key={conflict.field} disabled={busy || !row.selected}>
              <legend>{conflict.field} · {t("anki_conflict")}</legend>
              <label><input type="radio" name={`${row.id}:${conflict.field}`} checked={row.choices[conflict.field] === "local"}
                onChange={() => changeRow(row.id, old => ({ ...old, choices: { ...old.choices, [conflict.field]: "local" } }))} />Hakkutsu</label>
              <FieldPreview value={conflict.local} />
              <label><input type="radio" name={`${row.id}:${conflict.field}`} checked={row.choices[conflict.field] === "anki"}
                onChange={() => changeRow(row.id, old => ({ ...old, choices: { ...old.choices, [conflict.field]: "anki" } }))} />Anki</label>
              <FieldPreview value={conflict.anki} />
            </fieldset>)}
            <details><summary>{t("anki_details")}</summary>
              {Object.entries(row.fields).map(([field, value]) => <div key={field}><b>{field}</b><FieldPreview value={value} /></div>)}
            </details>
          </article>)}
          {rows.length > limit && <button type="button" className="hk-btn hk-btn--secondary" onClick={() => setLimit(value => value + 50)}>{t("anki_more")}</button>}
        </div>
        <button type="button" className="hk-btn hk-btn--primary" disabled={busy || !plan.rows.length || unresolved} onClick={() => void apply()}>{t("anki_apply")}</button>
      </>}
    </dialog>
  </>;
}
