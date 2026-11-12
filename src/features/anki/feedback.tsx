import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { useTranslation, type TranslationKey } from "~/shared/locales";

export function errorDetails(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export function errorMessageKey(error: unknown): TranslationKey {
  const message = errorDetails(error);
  if (/connection failed|timed out|not connected|HTTP error|Failed to fetch/i.test(message)) return "anki_error_connection";
  if (/profile|deck changed/i.test(message)) return "anki_error_profile";
  if (/preset|note type|13 Japanese fields|Select an existing/i.test(message)) return "anki_error_setup";
  if (/changed|already imported|read-back|stale/i.test(message)) return "anki_error_changed";
  if (/media|audio|format|encoding/i.test(message)) return "anki_error_media";
  if (/pending|unresolved|not confirmed|unrecorded/i.test(message)) return "anki_error_pending";
  if (/another.*tab|busy|coordinate/i.test(message)) return "anki_error_busy";
  if (/recovery snapshot/i.test(message)) return "anki_error_recovery";
  if (/Invalid search/i.test(message)) return "anki_error_search";
  if (/disabled/i.test(message)) return "anki_error_disabled";
  return "anki_error_generic";
}

export function AnkiFeedback({ error, message, busy = false, success = false }: {
  error?: unknown; message?: string; busy?: boolean; success?: boolean;
}) {
  const { t } = useTranslation();
  const Icon = busy ? Loader2 : success ? CheckCircle2 : AlertCircle;
  return <div className={`hk-anki-feedback ${error ? "is-error" : success ? "is-success" : ""}`} role={error ? "alert" : "status"}>
    <Icon size={16} className={busy ? "hk-spin" : undefined} aria-hidden="true" />
    <div><p>{message || (error ? t(errorMessageKey(error)) : "")}</p>
      {!!error && <details><summary>{t("anki_technical_details")}</summary><pre>{errorDetails(error)}</pre></details>}
    </div>
  </div>;
}
