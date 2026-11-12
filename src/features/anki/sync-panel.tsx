import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Download, RefreshCw, Square, X } from "lucide-react";
import { useTranslation } from "~/shared/locales";
import type { ExtensionSettings } from "~/features/settings/types";
import { applySync, previewSync, pendingExports, releasePendingExport, type SyncResult } from "./sync-service";
import type { SyncPlan, SyncRow } from "./sync-plan";
import { SyncRows } from "./sync-rows";
import { AnkiFeedback } from "./feedback";
import { wasStopped, type SyncProgress } from "./operations";
import { downloadRecoverySnapshot } from "~/features/vocabulary/data-backup";

export function AnkiSyncPanel({ settings, onChanged }: { settings: ExtensionSettings; onChanged: () => Promise<void> }) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null), closeButton = useRef<HTMLButtonElement>(null);
  const controller = useRef<AbortController>(), mounted = useRef(true);
  const titleId = useId();
  const [plan, setPlan] = useState<SyncPlan | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [stopping, setStopping] = useState(false);
  const [previewStopped, setPreviewStopped] = useState(false);
  const [error, setError] = useState<unknown>();
  const [progress, setProgress] = useState<SyncProgress>();
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [result, setResult] = useState<SyncResult | null>(null);
  const [page, setPage] = useState(0);
  const [pending, setPending] = useState<Array<{ key: string; tag: string }>>([]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  useEffect(() => {
    if (dialog.current?.open && !dialog.current.contains(document.activeElement)) {
      if (busy) dialog.current.focus(); else closeButton.current?.focus();
    }
  }, [busy]);
  const stop = () => { controller.current?.abort(); setStopping(true); };
  const onProgress = (value: SyncProgress) => {
    if (!mounted.current) return;
    setProgress(value);
    if (value.currentId && value.status) setStatuses(current => ({ ...current, [value.currentId!]: value.status! }));
  };
  const refresh = async () => {
    const operation = new AbortController(); controller.current = operation;
    setBusy("preview"); setStopping(false); setPreviewStopped(false); setError(undefined); setPlan(null); setResult(null); setProgress(undefined); setStatuses({});
    try {
      const next = await previewSync(settings, { signal: operation.signal, onProgress });
      const pending = await pendingExports(next.profile);
      if (mounted.current && !operation.signal.aborted) { setPlan(next); setPending(pending); setPage(0); }
    } catch (error) { if (mounted.current) { if (wasStopped(error)) setPreviewStopped(true); else setError(error); } }
    finally { if (mounted.current) { setBusy(null); setStopping(false); } }
  };
  const apply = async () => {
    if (!plan) return;
    const operation = new AbortController(); controller.current = operation;
    setBusy("apply"); setStopping(false); setError(undefined); setStatuses({});
    try {
      const result = await applySync(plan, undefined, { signal: operation.signal, onProgress });
      if (mounted.current) { setResult(result); setPlan(null); }
    } catch (error) {
      if (mounted.current) {
        if (wasStopped(error)) {
          setResult({ completed: 0, failures: [], stopped: true, notAttempted: plan.rows.filter(row => row.selected && row.kind !== "unchanged").length });
          setPlan(null);
        }
        else setError(error);
      }
    } finally {
      try { await onChanged(); }
      catch (error) { if (mounted.current) setError(error); }
      finally { if (mounted.current) { setBusy(null); setStopping(false); setProgress(undefined); } }
    }
  };
  const rows = plan?.rows.filter(row => row.kind !== "unchanged") || [];
  const visibleRows = rows.slice(page * 50, (page + 1) * 50);
  const selected = rows.filter(row => row.selected);
  const unresolved = selected.some(row => row.kind === "ambiguous" || row.conflicts.some(conflict => !row.choices[conflict.field]));
  const changeRow = (id: string, change: (row: SyncRow) => SyncRow) => setPlan(current => current && ({ ...current, rows: current.rows.map(row => row.id === id ? change(row) : row) }));
  const selectPage = (checked: boolean) => { const ids = new Set(visibleRows.map(row => row.id)); setPlan(current => current && ({ ...current, rows: current.rows.map(row => ids.has(row.id) ? { ...row, selected: checked } : row) })); };
  return <>
    <button ref={trigger} type="button" className="hk-btn hk-btn--secondary" disabled={settings.ankiEnabled === false}
      onClick={() => { dialog.current?.showModal(); void refresh(); }}><RefreshCw size={14} aria-hidden="true" />{t("anki_sync")}</button>
    {createPortal(<dialog ref={dialog} className="hk-anki-dialog" tabIndex={-1} aria-labelledby={titleId}
      onClose={() => trigger.current?.focus()} onCancel={event => { if (busy) { event.preventDefault(); stop(); } }}>
      <header className="hk-anki-dialog__header">
        <div><h2 id={titleId}><img src="/assets/logo/anki.png" alt="" />{t("anki_sync")}</h2><p>{plan && `${plan.profile} · `}{settings.ankiDeck} · {settings.ankiModel}</p></div>
        <button ref={closeButton} type="button" className="hk-btn hk-btn--ghost hk-btn--icon" aria-label={t("anki_close")} disabled={!!busy} onClick={() => dialog.current?.close()}><X size={18} /></button>
      </header>
      <div className="hk-anki-dialog__controls">
        <p className="hk-anki-muted">{t("anki_sync_help")}</p>
        <div className="hk-anki-toolbar">
          <button type="button" className="hk-btn hk-btn--secondary hk-btn--sm" disabled={!!busy} onClick={() => void refresh()}><RefreshCw size={13} />{t("anki_refresh")}</button>
          <button type="button" className="hk-btn hk-btn--secondary hk-btn--sm" disabled={!!busy} onClick={() => void downloadRecoverySnapshot().catch(setError)}><Download size={13} />{t("anki_recovery")}</button>
          {plan && <span className="hk-anki-count">{t("anki_selected")}: <b>{selected.length}</b> / {rows.length}</span>}
        </div>
        {busy && <div className="hk-anki-progress" role="status" aria-live="polite">
          <span>{t(stopping ? "anki_stopping" : progress?.phase === "refresh" ? "anki_refreshing_progress" : busy === "preview" ? "anki_loading_preview" : "anki_working")}</span>
          {progress && <><b>{progress.completed} / {progress.total}</b><progress max={Math.max(1, progress.total)} value={progress.completed} /></>}
        </div>}
      </div>
      <div className="hk-anki-dialog__body">
        {!!error && <AnkiFeedback error={error} />}
        {previewStopped && <AnkiFeedback message={t("anki_preview_stopped")} />}
        {result && <>
          <AnkiFeedback success={!result.failures.length} message={t(result.stopped ? "anki_stopped" : "anki_sync_finished")} />
          <dl className="hk-anki-totals">{([["anki_completed", result.completed], ["anki_failed", result.failures.length], ["anki_not_attempted", result.notAttempted]] as const).map(([key, count]) =>
            <div key={key}><dt>{t(key)}</dt><dd>{count}</dd></div>)}</dl>
          {result.failures.map(failure => <AnkiFeedback key={failure.id} error={failure.message} />)}
          {result.progressError && <AnkiFeedback error={result.progressError} message={t("anki_progress_incomplete")} />}
        </>}
        {plan && <>
          {pending.map(item => <div className="hk-anki-pending" key={item.key}><p>{t("anki_pending_export")}</p>
            <button type="button" className="hk-btn hk-btn--secondary hk-btn--sm" disabled={!!busy} onClick={() => {
              void releasePendingExport(plan.profile, item.key).then(() => setPending(values => values.filter(value => value.key !== item.key)), setError);
            }}>{t("anki_release_export")}</button></div>)}
          {!rows.length ? <AnkiFeedback success message={t("anki_up_to_date")} /> : <>
            <div className="hk-anki-selection"><label><input type="checkbox" disabled={!!busy} checked={visibleRows.length > 0 && visibleRows.every(row => row.selected)} onChange={event => selectPage(event.target.checked)} />{t("anki_select_page")}</label>
              <button type="button" className="hk-btn hk-btn--ghost hk-btn--sm" disabled={!!busy} onClick={() => setPlan({ ...plan, rows: plan.rows.map(row => ({ ...row, selected: row.kind !== "unchanged" && row.kind !== "hidden" })) })}>{t("anki_select_all")}</button>
              <button type="button" className="hk-btn hk-btn--ghost hk-btn--sm" disabled={!!busy} onClick={() => setPlan({ ...plan, rows: plan.rows.map(row => ({ ...row, selected: false })) })}>{t("anki_deselect")}</button></div>
            <SyncRows rows={visibleRows} plan={plan} busy={!!busy} statuses={statuses} changeRow={changeRow} />
          </>}
        </>}
      </div>
      <footer className="hk-anki-dialog__footer">
        {plan && rows.length > 50 && <nav className="hk-anki-pagination" aria-label={t("anki_pages")}>
          <button type="button" className="hk-btn hk-btn--ghost hk-btn--icon" disabled={page === 0} aria-label={t("anki_previous")} onClick={() => setPage(value => value - 1)}><ArrowLeft size={16} /></button>
          <span>{page + 1} / {Math.ceil(rows.length / 50)}</span>
          <button type="button" className="hk-btn hk-btn--ghost hk-btn--icon" disabled={(page + 1) * 50 >= rows.length} aria-label={t("anki_next")} onClick={() => setPage(value => value + 1)}><ArrowRight size={16} /></button>
        </nav>}
        {busy ? <button type="button" className="hk-btn hk-btn--secondary" disabled={stopping} onClick={stop}><Square size={13} />{t(stopping ? "anki_stopping_short" : "anki_stop")}</button>
          : plan ? <button type="button" className="hk-btn hk-btn--primary" disabled={!plan.rows.length || unresolved} onClick={() => void apply()}>{t("anki_apply")}</button>
          : <button type="button" className="hk-btn hk-btn--primary" onClick={() => void refresh()}>{t("anki_refresh")}</button>}
      </footer>
    </dialog>, document.body)}
  </>;
}
