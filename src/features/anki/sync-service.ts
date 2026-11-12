import { highlightSentenceFields } from "~/shared/japanese/sentence-highlight";
import { ANKI_ELIGIBLE, checkStopped, wasStopped, type SyncOptions } from "./operations";
import { ankiClient, AnkiConnectError } from "./anki-connect";
import { localSrs, type SrsCard } from "~/features/srs/local-srs";
import type { ExtensionSettings } from "~/features/settings/types";
import { ankiStorage, withAnkiLock } from "./sync-storage";
import { buildSyncPlan, noteFields, resolveRow, localUnchanged, type SyncPlan, type SyncRow } from "./sync-plan";
import { cardContent, japaneseFieldNames, localValues } from "./japanese-schema";
import type { CachedAnkiCard, RemoteNote } from "./sync-types";

export function ankiQuote(value: string): string { return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`; }
export const scopeQuery = (deck: string, model: string) => `deck:${ankiQuote(deck)} note:${ankiQuote(model)}`;

export async function inBatches<T, R>(values: T[], read: (batch: T[]) => Promise<R[]>, size = 100, signal?: AbortSignal): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < values.length; index += size) { checkStopped(signal); results.push(...await read(values.slice(index, index + size))); }
  checkStopped(signal);
  return results;
}

async function context(settings: ExtensionSettings, signal?: AbortSignal) {
  if (settings.ankiPreset !== "japanese") throw new Error("Select the Japanese preset in Anki settings before syncing.");
  const [profile, decks, fields] = await Promise.all([ankiClient.getProfile(signal), ankiClient.getDeckIds(signal), ankiClient.getModelFields(settings.ankiModel, signal)]);
  if (!decks[settings.ankiDeck]) throw new Error("Select an existing Anki deck in settings.");
  if (japaneseFieldNames.some(field => !fields.includes(field))) throw new Error("The selected note type does not have all 13 Japanese fields.");
  return { profile, deckId: decks[settings.ankiDeck], deck: settings.ankiDeck, model: settings.ankiModel };
}

export async function previewSync(settings: ExtensionSettings, options: SyncOptions = {}): Promise<SyncPlan> {
  const { signal, onProgress } = options;
  checkStopped(signal);
  const target = await context(settings, signal);
  const ids = await ankiClient.findNotes(scopeQuery(target.deck, target.model), signal);
  let completed = 0;
  onProgress?.({ phase: "preview", completed, total: ids.length });
  const notes = await inBatches(ids, async batch => {
    const notes = await ankiClient.notesInfo(batch, signal); completed += notes.length;
    onProgress?.({ phase: "preview", completed, total: ids.length }); return notes;
  }, 100, signal);
  if (notes.length !== ids.length) throw new Error("Anki changed during the read. Refresh the preview.");
  const [cards, state] = await Promise.all([localSrs.getAllSrsCards(), ankiStorage.states()]);
  const hiddenKeys = new Set(state.filter(item => item.value === true).map(item => item.key));
  const hidden = new Set(notes.filter(note => hiddenKeys.has(`hidden:${target.profile}:${note.noteId}`)).map(note => note.noteId));
  checkStopped(signal);
  return buildSyncPlan(target, cards, notes, hidden);
}

export async function refreshLinkedCards(profile: string, local: SrsCard, note: RemoteNote): Promise<void> {
  const [cards, dueIds] = await Promise.all([
    inBatches(note.cards, batch => ankiClient.cardsInfo(batch)),
    ankiClient.findCards(`nid:${note.noteId} is:due ${ANKI_ELIGIBLE}`),
  ]);
  const due = new Set(dueIds);
  await ankiStorage.putCards(cards.map(card => ({ ...card, profile, localId: local.id, key: `${profile}:${card.cardId}`,
    dueNow: due.has(card.cardId), refreshedAt: Date.now() } satisfies CachedAnkiCard)));
  const active = cards.filter(card => card.queue >= 0 && !card.odid);
  // Anki day numbers aren't Unix dates. Only project due-now and maturity; never feed them to local FSRS.
  await localSrs.updateSrsCard(local.id, {
    state: active.length && active.every(card => card.type === 2) ? 2 : active.some(card => card.type === 3) ? 3 : active.some(card => card.type === 1) ? 1 : 0,
    due_date: active.some(card => due.has(card.cardId)) ? Date.now() : Number.MAX_SAFE_INTEGER,
    interval: active.length ? Math.min(...active.map(card => Math.max(0, card.interval))) : 0,
    repetition: active.length ? Math.min(...active.map(card => card.reps)) : 0,
    lapse_count: active.length ? Math.max(...active.map(card => card.lapses)) : 0,
  });
}

interface WriteJournal { fields: Record<string, string>; noteId?: number; tag: string; status: "pending" | "confirmed" | "failed" }

export async function pendingExports(profile: string): Promise<Array<{ key: string; tag: string }>> {
  const state = await ankiStorage.states();
  return state.flatMap(item => {
    const value = item.value as WriteJournal | undefined;
    return item.key.startsWith(`write:${profile}:`) && value?.status === "pending" && value.tag
      ? [{ key: item.key, tag: value.tag }] : [];
  });
}

export async function releasePendingExport(profile: string, key: string): Promise<void> {
  return withAnkiLock(async () => {
    if (await ankiClient.getProfile() !== profile || !key.startsWith(`write:${profile}:`)) throw new Error("Anki profile changed.");
    const prior = await ankiStorage.state<WriteJournal>(key);
    if (!prior?.tag || prior.status !== "pending") return;
    if ((await ankiClient.findNotes(`tag:${prior.tag}`)).length) throw new Error("The export exists in Anki. Refresh and sync to finish linking it.");
    await ankiStorage.setState(key, { ...prior, status: "failed" });
  });
}

async function saveRow(plan: SyncPlan, row: SyncRow, locals: SrsCard[], pendingWrites: Array<{ key: string; value: WriteJournal }>): Promise<void> {
  if (!row.local && row.remote && locals.some(card => card.anki?.profile === plan.profile && card.anki.noteId === row.remote!.noteId)) {
    throw new Error("This note was already imported. Refresh the preview.");
  }
  if (row.local) {
    const current = await localSrs.getSrsCard(row.local.id);
    if (!current || !localUnchanged(current, row.local)) throw new Error("Local content changed. Refresh the preview.");
  }
  if (row.kind === "missing") {
    if ((await ankiClient.notesInfo([row.local!.anki!.noteId])).length) throw new Error("The note still exists outside this deck. Refresh settings or keep it unlinked.");
    await localSrs.updateSrsCard(row.local!.id, { anki: { ...row.local!.anki!, missing: true, verified: false } });
    return;
  }
  if (row.kind === "ambiguous") throw new Error("Choose a matching local entry before linking.");
  const fields = resolveRow(row);
  const journalKey = `write:${plan.profile}:${plan.deckId}:${row.id}`;
  const prior = await ankiStorage.state<WriteJournal>(journalKey);
  let remote: RemoteNote | undefined;
  if (row.remote) {
    const inDeck = await ankiClient.findNotes(`${scopeQuery(plan.deck, plan.model)} nid:${row.remote.noteId}`);
    if (!inDeck.includes(row.remote.noteId)) throw new Error("The note moved out of this deck. Refresh the preview.");
    [remote] = await ankiClient.notesInfo([row.remote.noteId]);
    if (!remote || remote.modelName !== plan.model || JSON.stringify(remote.fields) !== JSON.stringify(row.remote.fields) ||
      JSON.stringify(remote.tags) !== JSON.stringify(row.remote.tags)) {
      // A previous uncertain write may have landed: accept only the exact proposed values.
      if (!remote || !prior || !japaneseFieldNames.every(field => remote!.fields[field]?.value === fields[field])) {
        throw new Error("Anki content changed. Refresh the preview before writing.");
      }
    }
    if (row.local?.anki && !row.local.anki.verified &&
      (remote.fields.Word.value !== row.local.anki.baseline.Word || remote.fields["Word Reading"].value !== row.local.anki.baseline["Word Reading"])) {
      throw new Error("Restored link identity changed. Unlink it and match the note again.");
    }
    const changed = Object.fromEntries(japaneseFieldNames.filter(field => remote!.fields[field].value !== fields[field]).map(field => [field, fields[field]]));
    if (Object.keys(changed).length) {
      await ankiStorage.setState(journalKey, { fields, noteId: remote.noteId, tag: "", status: "pending" } satisfies WriteJournal);
      await ankiClient.updateFields(remote.noteId, changed);
    }
  } else {
    const tag = prior?.tag || `hakkutsu_sync_${crypto.randomUUID().replace(/-/g, "")}`;
    const found = await ankiClient.findNotes(`tag:${tag}`);
    if (found.length > 1) throw new Error("The pending export matches multiple notes. Resolve it in Anki before retrying.");
    let id = found[0];
    if (!id) {
      if (prior?.status === "pending") throw new Error("Previous export was not confirmed. Refresh Anki and reconcile the pending export before retrying.");
      await ankiStorage.setState(journalKey, { fields, tag, status: "pending" } satisfies WriteJournal);
      try {
        id = await ankiClient.addNote({ deckName: plan.deck, modelName: plan.model, fields,
          options: { allowDuplicate: false }, tags: [...new Set([...(row.local?.tags || []), "hakkutsu", tag])] });
      } catch (error) {
        if (error instanceof AnkiConnectError && error.definiteFailure) await ankiStorage.setState(journalKey, { fields, tag, status: "failed" } satisfies WriteJournal);
        throw error;
      }
    }
    [remote] = await ankiClient.notesInfo([id]);
  }
  if (!remote) throw new Error("Anki did not return the saved note.");
  if (remote.modelName !== plan.model || (row.kind === "export" && !japaneseFieldNames.every(field => remote!.fields[field]?.value === fields[field]))) {
    throw new Error("The previously exported note changed in Anki. Match its current word and reading before linking it again.");
  }
  // Add local tags without removing Anki's unrelated tags.
  const addedTags = (row.local?.tags || []).filter(tag => !remote!.tags.includes(tag));
  await ankiClient.addTags([remote.noteId], addedTags);
  const [verified] = await ankiClient.notesInfo([remote.noteId]);
  if (!verified || !japaneseFieldNames.every(field => verified.fields[field]?.value === fields[field])) throw new Error("Anki read-back did not match. Refresh the preview.");
  const now = Date.now();
  const content = cardContent(noteFields(verified));
  const local: SrsCard = { ...(row.local || { id: crypto.randomUUID(), due_date: now, interval: 0, repetition: 0,
    efactor: 2.5, created_at: now }), ...content, word: content.word!, updated_at: now, tags: verified.tags };
  const previousLocalProgress = row.local?.anki?.previousLocalProgress || (row.local && !row.local.anki ? Object.fromEntries(
    ["due_date", "interval", "repetition", "efactor", "lapse_count", "stability", "difficulty", "state", "last_review", "retrievability", "elapsed_days", "scheduled_days"]
      .flatMap(key => { const value = row.local![key as keyof SrsCard]; return typeof value === "number" ? [[key, value]] : []; })) : undefined);
  local.anki = { profile: plan.profile, deckId: plan.deckId, deck: plan.deck, model: plan.model, noteId: verified.noteId, previousLocalProgress,
    baseline: noteFields(verified), localBaseline: localValues(local), tags: verified.tags, verified: true };
  if (row.local) {
    const latest = await localSrs.getSrsCard(row.local.id);
    if (!latest || !localUnchanged(latest, row.local)) throw new Error("Local content changed during sync. Anki was saved; refresh to reconcile.");
  }
  Object.assign(local, await highlightSentenceFields(local));
  await localSrs.putAnkiCard(local);
  const existingIndex = locals.findIndex(card => card.id === local.id);
  if (existingIndex >= 0) locals[existingIndex] = local;
  else locals.push(local);
  await ankiStorage.setState(`hidden:${plan.profile}:${verified.noteId}`, false);
  await ankiStorage.setState(journalKey, { fields, noteId: verified.noteId, tag: prior?.tag || "", status: "confirmed" } satisfies WriteJournal);
  for (const item of pendingWrites) {
    const pending = item.value;
    if (item.key.startsWith(`write:${plan.profile}:`) && pending?.status === "pending" && pending.tag && verified.tags.includes(pending.tag)) {
      await ankiStorage.setState(item.key, { ...pending, noteId: verified.noteId, status: "confirmed" });
    }
  }
}

async function refreshPlanProgress(plan: SyncPlan, signal?: AbortSignal): Promise<void> {
  const locals = (await localSrs.getAllSrsCards()).filter(card => card.anki?.profile === plan.profile &&
    card.anki.deckId === plan.deckId && card.anki.verified && !card.anki.missing);
  const notes = await inBatches(locals.map(card => card.anki!.noteId), batch => ankiClient.notesInfo(batch, signal), 100, signal);
  const byNote = new Map(locals.map(card => [card.anki!.noteId, card]));
  const [remoteCards, dueIds] = await Promise.all([
    inBatches(notes.flatMap(note => note.cards), batch => ankiClient.cardsInfo(batch, signal), 100, signal),
    ankiClient.findCards(`${scopeQuery(plan.deck, plan.model)} is:due ${ANKI_ELIGIBLE}`, signal),
  ]);
  if (await ankiClient.getProfile() !== plan.profile) throw new Error("Anki profile changed while refreshing progress.");
  checkStopped(signal);
  const due = new Set(dueIds), now = Date.now();
  await ankiStorage.putCards(remoteCards.map(card => ({ ...card, profile: plan.profile, localId: byNote.get(card.note)!.id,
    key: `${plan.profile}:${card.cardId}`, dueNow: due.has(card.cardId), refreshedAt: now })));
  const grouped = new Map<number, typeof remoteCards>();
  for (const card of remoteCards) if (card.queue >= 0 && !card.odid) {
    const group = grouped.get(card.note) || []; group.push(card); grouped.set(card.note, group);
  }
  const updates: SrsCard[] = [];
  for (const local of locals) {
    const cards = grouped.get(local.anki!.noteId) || [];
    const summary = { due_date: cards.some(card => due.has(card.cardId)) ? now : Number.MAX_SAFE_INTEGER,
      state: cards.length && cards.every(card => card.type === 2) ? 2 : cards.some(card => card.type === 3) ? 3 : cards.some(card => card.type === 1) ? 1 : 0,
      interval: cards.length ? Math.min(...cards.map(card => Math.max(0, card.interval))) : 0,
      repetition: cards.length ? Math.min(...cards.map(card => card.reps)) : 0,
      lapse_count: cards.length ? Math.max(...cards.map(card => card.lapses)) : 0 };
    checkStopped(signal);
    const current = await localSrs.getSrsCard(local.id);
    if (current?.anki?.noteId === local.anki!.noteId) updates.push({ ...current, ...summary });
  }
  checkStopped(signal);
  await localSrs.putAnkiCards(updates);
}

export interface SyncResult {
  completed: number;
  failures: Array<{ id: string; message: string }>;
  stopped: boolean;
  notAttempted: number;
  progressError?: string;
}
export async function applySync(plan: SyncPlan, onProgress?: (completed: number, total: number) => void, options: SyncOptions = {}): Promise<SyncResult> {
  return withAnkiLock(async () => {
    checkStopped(options.signal);
    if (await ankiClient.getProfile() !== plan.profile || (await ankiClient.getDeckIds())[plan.deck] !== plan.deckId) throw new Error("Anki profile or deck changed. Refresh the preview.");
    const selected = plan.rows.filter(row => row.selected && row.kind !== "unchanged");
    const ids = selected.flatMap(row => row.local ? [row.local.id] : []);
    if (new Set(ids).size !== ids.length) throw new Error("One local entry cannot link to two Anki notes.");
    for (const row of selected) {
      if (row.kind === "ambiguous") throw new Error("Choose a local match or import a separate entry.");
      if (row.kind !== "missing") resolveRow(row);
    }
    const [cards, anki] = await Promise.all([localSrs.getAllSrsCards(), ankiStorage.backup()]);
    checkStopped(options.signal);
    await ankiStorage.setState("recovery:before-sync", { cards, remoteNotes: plan.rows.flatMap(row => row.remote ? [row.remote] : []),
      anki: { ...anki, state: anki.state.filter(state => !state.key.startsWith("recovery:")) }, savedAt: Date.now() });
    const result: SyncResult = { completed: 0, failures: [], stopped: false, notAttempted: selected.length };
    const pendingWrites = anki.state.filter(item => item.key.startsWith(`write:${plan.profile}:`) && (item.value as WriteJournal)?.status === "pending") as Array<{ key: string; value: WriteJournal }>;
    let interrupted = false;
    for (const row of selected) {
      if (options.signal?.aborted) { result.stopped = true; break; }
      options.onProgress?.({ phase: "apply", completed: result.completed + result.failures.length, total: selected.length, currentId: row.id, status: "running" });
      try {
        if (await ankiClient.getProfile() !== plan.profile) throw new Error("Anki profile changed. Stop and refresh the preview.");
        // Never abort an in-flight note write: finish its read-back, local save and journal first.
        await saveRow(plan, row, cards, pendingWrites);
        result.completed++;
        options.onProgress?.({ phase: "apply", completed: result.completed + result.failures.length, total: selected.length, currentId: row.id, status: "completed" });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.failures.push({ id: row.id, message });
        options.onProgress?.({ phase: "apply", completed: result.completed + result.failures.length, total: selected.length, currentId: row.id, status: "failed" });
        if (/profile changed|connection failed|timed out|HTTP error|Invalid .*response|Invalid search|disabled|collection is not (?:open|available)|unsupported (?:action|version)/i.test(message)) interrupted = true;
      }
      result.notAttempted--;
      onProgress?.(result.completed + result.failures.length, selected.length);
      if (interrupted) break;
    }
    result.stopped ||= options.signal?.aborted === true;
    if (!interrupted && !result.stopped) {
      options.onProgress?.({ phase: "refresh", completed: result.completed, total: selected.length });
      try { await refreshPlanProgress(plan, options.signal); }
      catch (error) {
        if (wasStopped(error)) result.stopped = true;
        else result.progressError = error instanceof Error ? error.message : String(error);
      }
    }
    return result;
  });
}
