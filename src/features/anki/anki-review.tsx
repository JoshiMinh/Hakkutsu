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
  const [error, setError] = useState("");
  const [reconciliation, setReconciliation] = useState("");
  const [audioReady, setAudioReady] = useState(false);
  const submitting = useRef(false);
  const fingerprint = useRef("");
  const session = useRef(0);
  const section = useRef<HTMLElement>(null);
  const current = cards[0];
  const refresh = useCallback(async () => {
    const request = ++session.current;
    setBusy(true); setError(""); setReconciliation("");
    try { const cards = await loadAnkiReview(settings); if (request === session.current) { setCards(cards); setRevealed(false); } }
    catch (error) { if (request === session.current) { setCards([]); setError(String(error)); } }
    finally { if (request === session.current) setBusy(false); }
  }, [settings.ankiDeck, settings.ankiModel, settings.ankiPreset]);
  useEffect(() => { void refresh(); return () => { session.current++; }; }, [refresh]);
  useEffect(() => {
    let active = true;
    setContent(null); setAudioReady(false); setRevealed(false); setReconciliation("");
    if (current) {
      (async () => {
        if (await ankiClient.getProfile() !== current.profile) throw new Error("Anki profile changed. Refresh the session.");
        const [note] = await ankiClient.notesInfo([current.note]);
        if (!note) throw new Error("Anki note is missing.");
        const content = cardContent(noteFields(note));
        if (active) fingerprint.current = JSON.stringify(note.fields);
        if (active) setContent(content);
        const filenames = mediaNames(`${content.word_audio || ""}${content.sentence_audio || ""}`);
        if (current.template === "Word Audio") {
          if (!filenames.length) throw new Error(t("anki_missing_media"));
          await Promise.all(filenames.map(filename => loadMedia(current.profile, filename)));
        }
        if (active) setAudioReady(true);
      })().catch(error => { if (active) setError(String(error)); });
    }
    return () => { active = false; };
  }, [current?.cardId, current?.refreshedAt]);
  const advance = useCallback(() => { setCards(values => values.slice(1)); setError(""); setRevealed(false); }, []);
  const grade = useCallback(async (ease: number) => {
    if (!current || !revealed || !content || !audioReady || error || submitting.current) return;
    const request = session.current;
    submitting.current = true; setBusy(true); setError("");
    try { await submitAnkiReview(current, ease, fingerprint.current); if (request === session.current) advance(); }
    catch (error) { if (request === session.current) setError(String(error)); }
    finally { submitting.current = false; if (request === session.current) setBusy(false); }
  }, [current, revealed, content, audioReady, error, advance]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing || busy || !current || !audioReady || error ||
        (event.target instanceof Element && event.target.closest("input,textarea,select,button,a,audio,[contenteditable='true']"))) return;
      if (event.key.toLowerCase() === "r") {
        event.preventDefault(); void section.current?.querySelector("audio")?.play().catch(() => {}); return;
      }
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault(); if (revealed) void grade(3); else setRevealed(true);
      } else if (revealed && /^[1-4]$/.test(event.key)) { event.preventDefault(); void grade(Number(event.key)); }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [busy, current, audioReady, error, revealed, grade]);
  const reconcile = async () => {
    if (!current) return;
    setBusy(true);
    try {
      const status = await reconcileReview(current.profile, current.cardId);
      if (status === "confirmed") { advance(); return; }
      setReconciliation(status);
    } catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  };
  return <section ref={section} className="hk-anki-review" aria-busy={busy}>
    <div className="hk-anki-toolbar"><h2>{t("anki_review")}</h2><button type="button" className="hk-btn hk-btn--secondary" disabled={busy} onClick={() => void refresh()}>{t("anki_refresh")}</button></div>
    <p>{t("anki_review_help")}</p>
    <p>{t("anki_review_cards")}: {cards.length}</p>
    {busy && <p role="status">{t("anki_working")}</p>}
    {error && <div role="alert"><p>{error}</p><button type="button" className="hk-btn hk-btn--secondary" disabled={busy || !current} onClick={() => void reconcile()}>{t("anki_check_review")}</button></div>}
    {reconciliation && <div role="status"><p>{t(reconciliation === "none" ? "anki_review_not_found" : "anki_review_ambiguous")}</p>
      {reconciliation === "none" && current && <button type="button" className="hk-btn hk-btn--secondary" disabled={busy} onClick={() => {
        setBusy(true);
        void releaseReviewAttempt(current.profile, current.cardId).then(() => { setError(""); setReconciliation(""); }, error => setError(String(error))).finally(() => setBusy(false));
      }}>{t("anki_release_review")}</button>}</div>}
    {!busy && !error && !current && <p>{t("anki_review_empty")}</p>}
    {current && content && <>
      <p>{current.template} · {current.cardId}</p>
      <div className="hk-anki-study-card">
        {current.template === "Word Audio" && !revealed ? <>
          <FieldPreview value={`${content.word_audio || ""}${content.sentence_audio || ""}`} profile={current.profile} autoPlay />
        </> : <><div className="hk-anki-word" role="heading" aria-level={3}>{revealed ? <FieldPreview value={content.word_furigana || content.word || ""} /> : content.word}</div>
          <FieldPreview value={revealed ? content.sentence_furigana || content.sentence || "" : content.sentence || ""} />
        </>}
        {revealed && <>
          {[content.meaning, content.vietnamese_sound, content.sentence_meaning, content.notes].map((value, index) => value && <FieldPreview key={index} value={value} />)}
          <FieldPreview value={`${content.word_audio || ""}${content.sentence_audio || ""}${content.picture || ""}`} profile={current.profile} />
        </>}
      </div>
      <div className="hk-anki-toolbar">
        {!revealed ? <button type="button" className="hk-btn hk-btn--primary" disabled={busy || !audioReady} onClick={() => setRevealed(true)}>{t("srs_btn_show_answer")}</button>
          : (["anki_again", "anki_hard", "anki_good", "anki_easy"] as const).map((key, index) => <button key={key} type="button" className="hk-btn hk-btn--secondary" disabled={busy || !audioReady || !!error} onClick={() => void grade(index + 1)}>{t(key)}</button>)}
        <button type="button" className="hk-btn hk-btn--secondary" disabled={busy} onClick={advance}>{t("anki_skip")}</button>
      </div>
    </>}
  </section>;
}
