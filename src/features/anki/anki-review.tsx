import { Brain, Headphones, RefreshCw, SkipForward } from "lucide-react";
import { AnkiFeedback } from "./feedback";
import { ankiStorage } from "./sync-storage";
import { vocabularyAudio } from "./audio-player";
import type { ReviewAttempt } from "./sync-types";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ExtensionSettings } from "~/features/settings/types";
import type { CachedAnkiCard } from "./sync-types";
import { loadAnkiReview, submitAnkiReview, reconcileReview, releaseReviewAttempt } from "./review-service";
import type { SrsCard } from "~/features/srs/local-srs";
import { ankiClient } from "./anki-connect";
import { cardContent } from "./japanese-schema";
import { noteFields } from "./sync-plan";
import { FieldPreview } from "./field-preview";
import { mediaNames, loadMedia } from "./media";
import { useTranslation } from "~/shared/locales";

export function AnkiReview({ settings }: { settings: ExtensionSettings }) {
  const { t } = useTranslation();
  const [cards, setCards] = useState<CachedAnkiCard[]>([]);
  const [content, setContent] = useState<Partial<SrsCard> | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [hasPending, setHasPending] = useState(false);
  const [reconciliation, setReconciliation] = useState("");
  const [audioReady, setAudioReady] = useState(false);
  const submitting = useRef(false);
  const fingerprint = useRef("");
  const session = useRef(0);
  const section = useRef<HTMLElement>(null);
  const current = cards[0];
  const refresh = useCallback(async () => {
    const request = ++session.current;
    setBusy(true); setError(undefined); setReconciliation("");
    try { const cards = await loadAnkiReview(settings); if (request === session.current) { setCards(cards); setRevealed(false); } }
    catch (error) { if (request === session.current) { setCards([]); setError(error); } }
    finally { if (request === session.current) setBusy(false); }
  }, [settings.ankiDeck, settings.ankiModel, settings.ankiPreset]);
  useEffect(() => { void refresh(); return () => { session.current++; }; }, [refresh]);
  useEffect(() => {
    let active = true;
    setContent(null); setAudioReady(false); setRevealed(false); setReconciliation(""); setHasPending(false);
    if (current) {
      (async () => {
        if (await ankiClient.getProfile() !== current.profile) throw new Error("Anki profile changed. Refresh the session.");
        const [note] = await ankiClient.notesInfo([current.note]);
        if (!note) throw new Error("Anki note is missing.");
        const pending = await ankiStorage.state<ReviewAttempt>(`review:${current.profile}:${current.cardId}`);
        if (active) setHasPending(pending?.status === "pending");
        const content = cardContent(noteFields(note));
        if (active) fingerprint.current = JSON.stringify(note.fields);
        if (active) setContent(content);
        const filenames = mediaNames(`${content.word_audio || ""}${content.sentence_audio || ""}`);
        if (current.template === "Word Audio") {
          if (!filenames.length) throw new Error("Missing audio recording");
          await Promise.all(filenames.map(filename => loadMedia(current.profile, filename)));
        }
        if (active) setAudioReady(true);
      })().catch(error => { if (active) setError(error); });
    }
    return () => { active = false; };
  }, [current?.cardId, current?.refreshedAt]);
  const advance = useCallback(() => { vocabularyAudio.stop(); setHasPending(false); setCards(values => values.slice(1)); setError(undefined); setRevealed(false); }, []);
  const grade = useCallback(async (ease: number) => {
    if (!current || !revealed || !content || !audioReady || error || hasPending || submitting.current) return;
    const request = session.current;
    submitting.current = true; setBusy(true); setError(undefined);
    try { await submitAnkiReview(current, ease, fingerprint.current); if (request === session.current) advance(); }
    catch (error) {
      if (request === session.current) {
        setError(error);
        const pending = await ankiStorage.state<ReviewAttempt>(`review:${current.profile}:${current.cardId}`);
        if (request === session.current) setHasPending(pending?.status === "pending");
      }
    }
    finally { submitting.current = false; if (request === session.current) setBusy(false); }
  }, [current, revealed, content, audioReady, error, hasPending, advance]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing || busy || !current || !audioReady || error || hasPending ||
        (event.target instanceof Element && event.target.closest("input,textarea,select,button,a,audio,[contenteditable='true']"))) return;
      if (event.key.toLowerCase() === "r") {
        event.preventDefault(); void vocabularyAudio.play(`review:${current.cardId}`, `${content?.word_audio || ""}${content?.sentence_audio || ""}`, current.profile); return;
      }
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault(); if (revealed) void grade(3); else setRevealed(true);
      } else if (revealed && /^[1-4]$/.test(event.key)) { event.preventDefault(); void grade(Number(event.key)); }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [busy, current, content, audioReady, error, hasPending, revealed, grade]);
  const reconcile = async () => {
    if (!current) return;
    setBusy(true);
    try {
      const status = await reconcileReview(current.profile, current.cardId);
      if (status === "confirmed") { advance(); return; }
      setReconciliation(status);
    } catch (error) { setError(error); }
    finally { setBusy(false); }
  };
  useEffect(() => () => vocabularyAudio.stop(), []);
  return <section ref={section} className="hk-anki-review" aria-busy={busy}>
    <header className="hk-anki-review__header"><div><h2><Brain size={20} />{t("anki_review")}</h2><p>{t("anki_review_help")}</p></div>
      <button type="button" className="hk-btn hk-btn--secondary hk-btn--sm" disabled={busy} onClick={() => void refresh()}><RefreshCw size={14} />{t("anki_refresh")}</button></header>
    {busy && <AnkiFeedback busy message={t("anki_working")} />}
    {!!error && <AnkiFeedback error={error} />}
    {hasPending && <div className="hk-anki-pending"><AnkiFeedback message={t("anki_error_pending")} />
      <button type="button" className="hk-btn hk-btn--secondary hk-btn--sm" disabled={busy} onClick={() => void reconcile()}>{t("anki_check_review")}</button></div>}
    {reconciliation && <div className="hk-anki-pending"><p>{t(reconciliation === "none" ? "anki_review_not_found" : "anki_review_ambiguous")}</p>
      {reconciliation === "none" && current && <button type="button" className="hk-btn hk-btn--secondary hk-btn--sm" disabled={busy} onClick={() => {
        setBusy(true);
        void releaseReviewAttempt(current.profile, current.cardId).then(() => { setError(undefined); setReconciliation(""); setHasPending(false); }, setError).finally(() => setBusy(false));
      }}>{t("anki_release_review")}</button>}</div>}
    {!busy && !error && !current && <div className="hk-srs-empty"><Brain size={36} aria-hidden="true" /><h3>{t("anki_review_empty")}</h3></div>}
    {current && content && <>
      <div className="hk-srs-header"><span className="hk-srs-badge">{current.template === "Word Audio" ? <Headphones size={14} /> : <Brain size={14} />}{t(current.template === "Word Audio" ? "anki_audio_card" : "anki_text_card")}</span>
        <span>{t("anki_review_cards")}: <b>{cards.length}</b></span></div>
      <div className="hk-anki-study-card">
        {current.template === "Word Audio" && !revealed ? <>
          <FieldPreview value={`${content.word_audio || ""}${content.sentence_audio || ""}`} profile={current.profile} playbackKey={`review:${current.cardId}`} autoPlay />
        </> : <><div className="hk-anki-word" role="heading" aria-level={3}>{revealed ? <FieldPreview value={content.word_furigana || content.word || ""} /> : content.word}</div>
          <FieldPreview value={revealed ? content.sentence_furigana || content.sentence || "" : content.sentence || ""} />
        </>}
        {revealed && <>
          {[content.meaning, content.vietnamese_sound, content.sentence_meaning, content.notes].map((value, index) => value && <FieldPreview key={index} value={value} />)}
          <FieldPreview value={`${content.word_audio || ""}${content.sentence_audio || ""}${content.picture || ""}`} profile={current.profile} playbackKey={`review:${current.cardId}`} />
        </>}
      </div>
      <div className="hk-srs-actions hk-anki-review__actions">
        {!revealed ? <button type="button" className="hk-btn hk-btn--primary hk-srs-btn--reveal" disabled={busy || !audioReady || hasPending} onClick={() => setRevealed(true)}>{t("srs_btn_show_answer")}</button>
          : <div className="hk-srs-grades">{(["anki_again", "anki_hard", "anki_good", "anki_easy"] as const).map((key, index) => <button key={key} type="button" className={`hk-btn hk-srs-btn--grade hk-srs-grade--${[1, 3, 4, 5][index]}`} disabled={busy || !audioReady || !!error || hasPending} onClick={() => void grade(index + 1)}><span>{t(key)}</span><small>{index + 1}</small></button>)}</div>}
        <button type="button" className="hk-btn hk-btn--ghost hk-btn--sm" disabled={busy} onClick={advance}><SkipForward size={14} />{t("anki_skip")}</button>
      </div>
    </>}
  </section>;
}
