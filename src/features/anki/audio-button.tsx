import { useEffect, useId, useSyncExternalStore } from "react";
import { Loader2, Square, Volume2 } from "lucide-react";
import { useTranslation } from "~/shared/locales";
import { soundNames, vocabularyAudio } from "./audio-player";

export function AudioButton({ field, profile, label, playbackKey, autoPlay = false, showLabel = false }: {
  field: string; profile?: string; label?: string; playbackKey?: string; autoPlay?: boolean; showLabel?: boolean;
}) {
  const uid = useId(), key = playbackKey || uid;
  const { t } = useTranslation();
  const state = useSyncExternalStore(vocabularyAudio.subscribe, vocabularyAudio.getSnapshot, vocabularyAudio.getSnapshot);
  const available = soundNames(field).length > 0;
  const active = state.key === key && (state.status === "playing" || state.status === "loading");
  const error = state.key === key && state.status === "error";
  const caption = !available ? t("anki_audio_unavailable") : error ? t("anki_error_media") : active ? t("anki_audio_stop") : label || t("anki_play_audio");
  const status = state.key === key && state.status === "loading" ? t("anki_loading_media") : active ? t("anki_playing") : "";
  useEffect(() => {
    if (autoPlay && available) void vocabularyAudio.play(key, field, profile);
    return () => { if (vocabularyAudio.getSnapshot().key === key) vocabularyAudio.stop(); };
  }, [key, field, profile, autoPlay, available]);
  const Icon = active && state.status === "loading" ? Loader2 : active ? Square : Volume2;
  return <span className="hk-anki-audio-control">
    <button type="button" className={`hk-btn hk-btn--ghost ${showLabel ? "hk-btn--sm" : "hk-btn--icon"} hk-anki-audio ${active ? "is-playing" : ""}`}
      disabled={!available} aria-label={`${caption}${label && caption !== label ? ` · ${label}` : ""}`} title={caption} aria-pressed={active}
      onClick={() => { if (active) vocabularyAudio.stop(); else void vocabularyAudio.play(key, field, profile); }}>
      <Icon size={15} className={active && state.status === "loading" ? "hk-spin" : undefined} aria-hidden="true" />{showLabel && (label || t("anki_play_audio"))}
    </button>
    {error && <span className="hk-anki-sr-only" role="alert">{t("anki_error_media")}</span>}
    {status && <span className="hk-anki-sr-only" role="status">{status}</span>}
  </span>;
}
