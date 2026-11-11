import { ankiClient } from "./anki-connect";
import { ankiStorage, withAnkiLock } from "./sync-storage";
import { localSrs } from "~/features/srs/local-srs";
import type { CachedAnkiCard, ReviewAttempt } from "./sync-types";
import { inBatches, refreshLinkedCards, scopeQuery } from "./sync-service";
import type { ExtensionSettings } from "~/features/settings/types";

export function cardRevision(card: { reps: number; lapses: number; queue: number; due: number; interval: number; mod: number }): string {
  return JSON.stringify([card.reps, card.lapses, card.queue, card.due, card.interval, card.mod]);
}
const attemptKey = (profile: string, id: number) => `review:${profile}:${id}`;

export async function loadAnkiReview(settings: ExtensionSettings): Promise<CachedAnkiCard[]> {
  if (settings.ankiPreset !== "japanese") throw new Error("Select the Japanese preset and sync vocabulary first.");
  const profile = await ankiClient.getProfile();
  const all = await localSrs.getAllSrsCards();
  const linked = all.filter(card => card.anki?.profile === profile && card.anki.verified && !card.anki.missing &&
    card.anki.deck === settings.ankiDeck && card.anki.model === settings.ankiModel);
  const query = `${scopeQuery(settings.ankiDeck, settings.ankiModel)} -is:suspended -is:buried -is:filtered`;
  const [due, fresh] = await Promise.all([ankiClient.findCards(`${query} is:due`), ankiClient.findCards(`${query} is:new`)]);
  const byNote = new Map(linked.map(card => [card.anki!.noteId, card]));
  const ids = [...new Set([...due, ...fresh])];
  const remote = await inBatches(ids, batch => ankiClient.cardsInfo(batch));
  const dueIds = new Set(due);
  const cards: CachedAnkiCard[] = remote.filter(card => byNote.has(card.note) && card.queue >= 0 && !card.odid &&
    (card.template === "Word" || card.template === "Word Audio")).map(card => ({ ...card, key: `${profile}:${card.cardId}`, profile,
      localId: byNote.get(card.note)!.id, dueNow: dueIds.has(card.cardId), refreshedAt: Date.now() }));
  cards.sort((a, b) => Number(b.dueNow) - Number(a.dueNow) || a.due - b.due || a.cardId - b.cardId);
  await ankiStorage.putCards(cards);
  return cards.slice(0, 50);
}

export async function reconcileReview(profile: string, cardId: number): Promise<"none" | "confirmed" | "ambiguous"> {
  if (await ankiClient.getProfile() !== profile) throw new Error("Anki profile changed.");
  const attempt = await ankiStorage.state<ReviewAttempt>(attemptKey(profile, cardId));
  if (!attempt) return "none";
  if (attempt.status === "confirmed") return "confirmed";
  const reviews = await ankiClient.reviews(cardId);
  const added = reviews.filter(review => !attempt.previousReviewIds.includes(review.id));
  // There is no idempotency token in answerCards. More than one matching event is ambiguous.
  if (added.length === 1 && added[0].ease === attempt.ease && added[0].id >= attempt.startedAt - 1000) {
    await ankiStorage.setState(attemptKey(profile, cardId), { ...attempt, status: "confirmed" });
    const [card] = await ankiClient.cardsInfo([cardId]);
    const local = (await localSrs.getAllSrsCards()).find(value => value.anki?.profile === profile && value.anki.noteId === card?.note);
    if (local && card) {
      const [note] = await ankiClient.notesInfo([card.note]);
      if (note) await refreshLinkedCards(profile, local, note);
    }
    return "confirmed";
  }
  return added.length ? "ambiguous" : "none";
}

export async function submitAnkiReview(card: CachedAnkiCard, ease: number, noteFingerprint?: string): Promise<void> {
  if (![1, 2, 3, 4].includes(ease)) throw new Error("Invalid review rating.");
  return withAnkiLock(async () => {
    if (await ankiClient.getProfile() !== card.profile) throw new Error("Anki profile changed. Refresh the session.");
    const pending = await ankiStorage.state<ReviewAttempt>(attemptKey(card.profile, card.cardId));
    if (pending?.status === "pending") {
      const state = await reconcileReview(card.profile, card.cardId);
      if (state === "confirmed") return;
      throw new Error("An earlier answer is unresolved. Check its status before submitting another review.");
    }
    const local = (await localSrs.getAllSrsCards()).find(value => value.id === card.localId);
    if (!local?.anki?.verified || local.anki.missing || local.anki.noteId !== card.note) throw new Error("This card is no longer linked. Sync vocabulary first.");
    const [current] = await ankiClient.cardsInfo([card.cardId]);
    const eligible = await ankiClient.findCards(`cid:${card.cardId} -is:suspended -is:buried -is:filtered`);
    const [displayedNote] = await ankiClient.notesInfo([card.note]);
    if (!current || current.note !== card.note || current.queue < 0 || current.odid || !eligible.includes(card.cardId) ||
      cardRevision(current) !== cardRevision(card) || (noteFingerprint && JSON.stringify(displayedNote?.fields) !== noteFingerprint)) {
      throw new Error("This card changed in Anki. Refresh the session.");
    }
    const reviews = await ankiClient.reviews(card.cardId);
    const attempt: ReviewAttempt = { profile: card.profile, cardId: card.cardId, ease, startedAt: Date.now(),
      previousReviewIds: reviews.map(review => review.id), status: "pending" };
    await ankiStorage.setState(attemptKey(card.profile, card.cardId), attempt);
    await ankiClient.answer(card.cardId, ease);
    await ankiStorage.setState(attemptKey(card.profile, card.cardId), { ...attempt, status: "confirmed" });
    const [note] = await ankiClient.notesInfo([card.note]);
    if (note) await refreshLinkedCards(card.profile, local, note);
  });
}

/** User-triggered release only after independently checking Anki; never sends an answer. */
export async function releaseReviewAttempt(profile: string, cardId: number): Promise<void> {
  return withAnkiLock(async () => {
    if (await reconcileReview(profile, cardId) !== "none") throw new Error("Review history changed. Refresh the session instead.");
    await ankiStorage.setState(attemptKey(profile, cardId), undefined);
  });
}
