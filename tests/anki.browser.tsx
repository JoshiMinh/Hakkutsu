import "../src/styles/global.css";
import { createRoot } from "react-dom/client";
import { createElement } from "react";

const results: string[] = [];
const assert = (condition: unknown, label: string) => { if (!condition) throw new Error(label); results.push(`PASS ${label}`); };
const waitFor = async (check: () => boolean) => {
  for (let index = 0; index < 200; index++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 25)); }
  throw new Error("Timed out waiting for the UI");
};
const clone = <T,>(value: T): T => structuredClone(value);
const listener = { addListener() {}, removeListener() {} };
let stored: Record<string, unknown> = {};
const settings = { ankiEnabled: true, ankiPreset: "japanese" as const, ankiDeck: "Japanese::Vocabulary", ankiModel: "Japanese", targetLanguage: "en" as const };
Object.defineProperty(globalThis, "chrome", { configurable: true, value: {
  storage: { sync: { async get() { return { hakkutsu_settings: JSON.stringify({ state: { settings }, version: 0 }) }; }, async set() {} },
    local: { async get(key: string) { return { [key]: stored[key] }; }, async set(values: Record<string, unknown>) { Object.assign(stored, values); } }, onChanged: listener },
  runtime: { getManifest: () => ({ version: "test" }), getURL: (value: string) => value, onMessage: listener, sendMessage: async () => ({}) },
} });

const schema = await import("../src/features/anki/japanese-schema");
const { DEFAULT_SETTINGS } = await import("../src/features/settings/types");
const config = { ...DEFAULT_SETTINGS, ...settings };
let profile = "Disposable test profile";
let writes = 0;
let pausedReads = false, releaseRead: (() => void) | undefined, disconnected = false;
const fields = Object.fromEntries(schema.japaneseFieldNames.map((name, order) => [name, { value: "", order }]));
for (const [name, value] of Object.entries({ Word: "私", "Word Reading": "わたし", "Word Furigana": "<ruby>私<rt>わたし</rt></ruby>",
  "Word Meaning": "I", Sentence: "<b>私</b>はアンです。", "Sentence Furigana": "<b><ruby>私<rt>わたし</rt></ruby></b>はアンです。",
  "Sentence Meaning": "I am Ann.", "Word Audio": "[sound:word.wav]", "Sentence Audio": "[sound:sentence.wav]", Notes: "Original notes", JLPT: "5",
  Picture: '<img src="picture.png">' })) fields[name].value = value;
const notes = new Map([[100, { noteId: 100, modelName: "Japanese", fields, tags: ["jlpt::n5"], cards: [1000, 1001] }]]);
const cards = new Map([0, 1].map(ord => [1000 + ord, { cardId: 1000 + ord, note: 100, deckName: settings.ankiDeck, modelName: "Japanese", ord,
  queue: 2, type: 2, interval: 10, due: 0, reps: 5, lapses: 1, factor: 2500, mod: 1 }]));
const histories = new Map<number, Array<{ id: number; ease: number }>>([[1000, []], [1001, []]]);
const wav = "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
const media = new Map([["word.wav", wav], ["sentence.wav", wav], ["picture.png", png]]);
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  if (!String(input).includes("localhost:8765")) return realFetch(input, init);
  const { action, params: p = {} } = JSON.parse(String(init?.body));
  if (disconnected) throw new TypeError("Failed to fetch");
  if (/\bis:filtered\b/.test(p.query || "")) return new Response(JSON.stringify({ result: null, error: "Invalid search: is:filtered" }));
  if (pausedReads && action === "notesInfo") await new Promise<void>((resolve, reject) => {
    const abort = () => { releaseRead = undefined; reject(new DOMException("Aborted", "AbortError")); };
    releaseRead = () => { init?.signal?.removeEventListener("abort", abort); releaseRead = undefined; resolve(); };
    init?.signal?.addEventListener("abort", abort, { once: true });
  });
  let result: unknown;
  switch (action) {
    case "version": result = 6; break;
    case "getActiveProfile": result = profile; break;
    case "deckNamesAndIds": result = { [settings.ankiDeck]: 12 }; break;
    case "deckNames": result = [settings.ankiDeck]; break;
    case "modelNames": result = ["Japanese"]; break;
    case "modelFieldNames": result = schema.japaneseFieldNames; break;
    case "modelTemplates": result = { Word: {}, "Word Audio": {} }; break;
    case "findNotes": {
      const nid = p.query.match(/nid:(\d+)/), tag = p.query.match(/^tag:(.*)/);
      result = [...notes.values()].filter(note => (!nid || note.noteId === +nid[1]) && (!tag || note.tags.includes(tag[1]))).map(note => note.noteId); break;
    }
    case "notesInfo": result = p.notes.map((id: number) => notes.get(id) || {}); break;
    case "findCards": {
      const cid = p.query.match(/cid:(\d+)/), nid = p.query.match(/nid:(\d+)/);
      result = [...cards.values()].filter(card => card.queue >= 0 && (!cid || card.cardId === +cid[1]) && (!nid || card.note === +nid[1]) &&
        (!p.query.includes("is:new") || card.type === 0) && (!p.query.includes("is:due") || card.due <= 0)).map(card => card.cardId); break;
    }
    case "cardsInfo": result = p.cards.map((id: number) => cards.get(id)); break;
    case "updateNoteFields": {
      writes++; const note = notes.get(p.note.id)!;
      for (const [field, value] of Object.entries(p.note.fields)) note.fields[field].value = String(value);
      result = null; break;
    }
    case "addNote": {
      writes++;
      const id = 200 + notes.size;
      notes.set(id, { noteId: id, modelName: "Japanese", fields: Object.fromEntries(schema.japaneseFieldNames.map((field, order) =>
        [field, { value: p.note.fields[field] || "", order }])), tags: p.note.tags, cards: [] });
      result = id; break;
    }
    case "addTags": for (const id of p.notes) notes.get(id)!.tags.push(...p.tags.split(" ")); result = null; break;
    case "getReviewsOfCards": result = Object.fromEntries(p.cards.map((id: number) => [String(id), histories.get(id)])); break;
    case "answerCards": {
      writes++; result = p.answers.map(({ cardId, ease }: { cardId: number; ease: number }) => {
        histories.get(cardId)!.push({ id: Date.now(), ease }); const card = cards.get(cardId)!; card.reps++; card.due = 10; return true;
      }); break;
    }
    case "retrieveMediaFile": result = media.get(p.filename) || false; break;
    case "storeMediaFile": media.set(p.filename, p.data); result = p.filename; break;
    default: throw new Error(`Unexpected Anki operation: ${action}`);
  }
  return new Response(JSON.stringify({ result: clone(result), error: null }), { headers: { "content-type": "application/json" } });
};

const run = async () => {
  const { localSrs } = await import("../src/features/srs/local-srs");
  const { ankiStorage, withAnkiLock } = await import("../src/features/anki/sync-storage");
  const sync = await import("../src/features/anki/sync-service");
  const review = await import("../src/features/anki/review-service");
  const { loadMedia, uploadLocalMedia } = await import("../src/features/anki/media");
  const { sanitizeAnkiHtml } = await import("../src/features/anki/field-preview");
  const { createVocabularyBackup, restoreVocabularyBackup } = await import("../src/features/vocabulary/data-backup");
  const { WordList } = await import("../src/features/vocabulary/word-list");
  const { vocabularyAudio } = await import("../src/features/anki/audio-player");
  const { AnkiReview } = await import("../src/features/anki/anki-review");
  const { AnkiSettings } = await import("../src/features/settings/anki-settings");
  let plan = await sync.previewSync(config);
  assert((await localSrs.getAllSrsCards()).length === 0 && writes === 0, "preview is read-only");
  assert((await sync.applySync(plan)).completed === 1, "import uses real IndexedDB");
  let [local] = await localSrs.getAllSrsCards();
  assert(local.anki?.verified && local.jlpt === "N5" && local.word_audio === "[sound:word.wav]", "all fields and identity survive import");
  assert((await ankiStorage.cards()).length === 2, "two independent card schedules are cached");
  await localSrs.updateSrsCard(local.id, { meaning: "me" });
  plan = await sync.previewSync(config); await sync.applySync(plan);
  assert(writes === 1 && notes.get(100)!.fields["Word Meaning"].value === "me", "local edits update the original Anki note");
  assert(notes.get(100)!.fields.Sentence.value.includes("<b>"), "unmodified sentence HTML is preserved");
  [local] = await localSrs.getAllSrsCards();
  await localSrs.updateSrsCard(local.id, { meaning: "myself" }); notes.get(100)!.fields["Word Meaning"].value = "mine";
  plan = await sync.previewSync(config);
  assert(plan.rows[0].conflicts.some(conflict => conflict.field === "Word Meaning"), "simultaneous changes produce a field conflict");
  plan.rows[0].choices["Word Meaning"] = "anki"; await sync.applySync(plan);
  assert((await localSrs.getAllSrsCards())[0].meaning === "mine", "choosing Anki resolves the conflict");
  const audio = await loadMedia(profile, "word.wav");
  assert(audio.startsWith("data:audio/wav;base64,"), "Anki audio is loaded locally");
  const image = await uploadLocalMedia(new File([new Uint8Array([1, 2, 3])], "new.png", { type: "image/png" }));
  assert(image.includes("hakkutsu_") && image.includes(".png"), "uploaded media uses collision-safe filenames");
  const unsafe = sanitizeAnkiHtml('<b onclick="alert(1)">safe</b><script>alert(1)</script><img src="https://example.com/tracker"><ruby>私<rt>わたし</rt></ruby>');
  assert(!/script|onclick|https:/.test(unsafe) && unsafe.includes("<ruby>"), "previews preserve ruby and strip executable content and remote URLs");
  const session = await review.loadAnkiReview(config);
  assert(session.length === 2 && session[1].template === "Word Audio", "review resolves both native template ordinals");
  await review.submitAnkiReview(session[0], 3);
  assert(histories.get(1000)!.length === 1 && histories.get(1001)!.length === 0, "only the chosen sibling is answered");
  assert((await localSrs.getFilteredCards({ dueOnly: false })).length === 0, "linked notes cannot enter local review");
  let blocked = false;
  let release: (() => void) | undefined;
  const lock = withAnkiLock(() => new Promise<void>(resolve => { release = resolve; }));
  await waitFor(() => !!release);
  try { await withAnkiLock(async () => {}); } catch { blocked = true; }
  release!(); await lock; assert(blocked, "concurrent writers cannot acquire the shared lock");
  const backup = await createVocabularyBackup();
  assert(backup.formatVersion === 2 && backup.anki!.media.length >= 2, "version 2 backup includes links and cached media");
  await restoreVocabularyBackup(new File([JSON.stringify(backup)], "backup.json"));
  [local] = await localSrs.getAllSrsCards();
  assert(local.anki?.verified === false, "restored links require verification before reviewing");
  await sync.applySync(await sync.previewSync(config));
  await localSrs.deleteSrsCard(local.id);
  assert((await sync.previewSync(config)).rows[0].kind === "hidden" && notes.size === 1, "local deletion is remembered and never deletes Anki notes");
  const old = { kind: "hakkutsu-vocabulary-backup", formatVersion: 1, cards: [{ id: "old", word: "猫", reading: "ねこ", due_date: 0,
    interval: 0, repetition: 0, efactor: 2.5, created_at: 1, updated_at: 1 }], legacyVocabulary: [] };
  old.cards[0] = { ...old.cards[0], ...{ meaning: "cat" } };
  await restoreVocabularyBackup(new File([JSON.stringify(old)], "old.json"));
  assert((await localSrs.getAllSrsCards()).some(card => card.id === "old"), "version 1 backups still restore");
  await ankiStorage.setState(`hidden:${profile}:100`, false);
  await sync.applySync(await sync.previewSync(config));
  const saved = (await localSrs.getAllSrsCards()).find(card => card.anki?.noteId === 100)!;
  const originalSentence = "私はアンです。", originalFurigana = "<ruby>私<rt>わたし</rt></ruby>はアンです。";
  notes.get(100)!.fields.Sentence.value = originalSentence;
  notes.get(100)!.fields["Sentence Furigana"].value = originalFurigana;
  await localSrs.updateSrsCard(saved.id, { meaning: "Changed in Hakkutsu", sentence: originalSentence, sentence_furigana: originalFurigana,
    anki: { ...saved.anki!, baseline: { ...saved.anki!.baseline, Sentence: originalSentence, "Sentence Furigana": originalFurigana },
      localBaseline: { ...saved.anki!.localBaseline, Sentence: originalSentence, "Sentence Furigana": originalFurigana } } });
  notes.get(100)!.fields["Word Meaning"].value = "Changed in Anki";
  const staleRepair = (await localSrs.getAllSrsCards()).find(card => card.id === saved.id)!;
  await localSrs.updateSrsCard(saved.id, { sentence: "編集した文。", sentence_furigana: "編集した文。" });
  assert((await localSrs.repairSentenceFields(staleRepair)).sentence === "編集した文。", "local repair cannot overwrite a newer sentence edit");
  await localSrs.updateSrsCard(saved.id, { sentence: originalSentence, sentence_furigana: originalFurigana });
  for (let id = 101; id <= 155; id++) notes.set(id, { ...clone(notes.get(100)!), noteId: id, cards: [],
    fields: { ...clone(fields), Word: { value: `単語${id}`, order: 0 } } });

  const root = createRoot(document.querySelector("#ui")!);
  root.render(createElement("div", null,
    createElement(WordList, { onStartReview() {} }),
    createElement("div", { className: "hk-settings-form" }, createElement(AnkiSettings, { settings: config, onUpdate() {} })),
    createElement("div", { className: "hk-content" }, createElement(AnkiReview, { settings: config }))));
  await waitFor(() => document.querySelector("#anki-preset") !== null && document.querySelector(".hk-vocab-table .hk-anki-audio") !== null && document.querySelector(".hk-anki-study-card") !== null);
  assert(document.querySelector("#anki-preset") !== null, "Japanese preset renders in settings");
  const preset = document.querySelector<HTMLButtonElement>("#anki-preset")!;
  preset.focus(); preset.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  await waitFor(() => preset.getAttribute("aria-expanded") === "true");
  preset.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
  preset.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await waitFor(() => preset.getAttribute("aria-expanded") === "false");
  assert(document.activeElement === preset, "styled selector supports keyboard navigation and returns focus on Escape");
  assert(document.querySelector(".hk-vocab-table b") !== null, "table preserves saved sentence bold formatting");
  const repaired = (await localSrs.getAllSrsCards()).find(card => card.id === saved.id)!;
  assert(repaired.sentence === "<b>私</b>はアンです。" && repaired.anki!.baseline.Sentence === originalSentence,
    "existing local sentence repair preserves the original Anki baseline");
  const wordRow = Array.from(document.querySelectorAll<HTMLTableRowElement>(".hk-vocab-table tbody tr")).find(row => row.textContent!.includes("私"))!;
  wordRow.querySelector<HTMLButtonElement>('button[title="Edit"]')!.click();
  await waitFor(() => !!document.querySelector(".hk-modal-overlay"));
  Array.from(document.querySelectorAll<HTMLButtonElement>(".hk-modal button")).find(button => button.textContent === "Unlink and restore local review progress")!.click();
  await waitFor(() => !Array.from(document.querySelectorAll<HTMLButtonElement>(".hk-modal button")).some(button => button.textContent === "Unlink and restore local review progress"));
  document.querySelector<HTMLButtonElement>('button[form="edit-word-form"]')!.click();
  await waitFor(() => !document.querySelector(".hk-modal-overlay"));
  const unlinked = (await localSrs.getAllSrsCards()).find(card => card.id === saved.id)!;
  assert(!unlinked.anki && unlinked.media_profile === profile, "unlinking retains the recording profile for correct cached playback");
  await localSrs.putAnkiCard(repaired);
  const speakers = Array.from(document.querySelectorAll<HTMLButtonElement>(".hk-vocab-table .hk-anki-audio")).filter(button => !button.disabled);
  assert(speakers.length === 2, "word and sentence have separate compact audio buttons");
  // Playback events are controlled here; media retrieval and cache use the real implementation.
  HTMLMediaElement.prototype.play = async function () {};
  speakers[0].click(); await waitFor(() => speakers[0].getAttribute("aria-pressed") === "true");
  speakers[1].click(); await waitFor(() => speakers[1].getAttribute("aria-pressed") === "true");
  assert(speakers[0].getAttribute("aria-pressed") === "false", "starting a sentence stops word playback");
  speakers[1].click(); await waitFor(() => vocabularyAudio.getSnapshot().status === "idle");
  assert(vocabularyAudio.getSnapshot().status === "idle", "clicking active audio stops it");
  speakers[0].click(); await waitFor(() => vocabularyAudio.getSnapshot().status === "playing");
  const search = document.querySelector<HTMLInputElement>('.hk-content input[type="text"]')!;
  const setInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setInput.call(search, "no matching row"); search.dispatchEvent(new Event("input", { bubbles: true }));
  await waitFor(() => !document.querySelector(".hk-vocab-table"));
  assert(vocabularyAudio.getSnapshot().status === "idle", "filtering away displayed rows cleans up playback");
  setInput.call(search, ""); search.dispatchEvent(new Event("input", { bubbles: true }));
  await waitFor(() => !!document.querySelector(".hk-vocab-table"));
  assert(!document.querySelector(".hk-anki-study-card")!.textContent!.includes("私"), "audio question hides Japanese text");
  const reveal = Array.from(document.querySelectorAll<HTMLButtonElement>(".hk-anki-review button")).find(button => button.textContent?.toLowerCase().includes("show answer"))!;
  await waitFor(() => !reveal.disabled);
  reveal.click();
  await waitFor(() => Array.from(document.querySelectorAll<HTMLButtonElement>(".hk-anki-review button")).some(button => button.querySelector("span")?.textContent === "Good"));
  const good = Array.from(document.querySelectorAll<HTMLButtonElement>(".hk-anki-review button")).find(button => button.querySelector("span")?.textContent === "Good")!;
  good.click(); good.click();
  await waitFor(() => histories.get(1001)!.length === 1);
  assert(histories.get(1001)!.length === 1, "UI reveals then submits one audio review despite double clicking");
  const buttons = () => Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
  buttons().find(button => button.textContent === "Sync with Anki")!.click();
  await waitFor(() => document.querySelector("dialog[open]") !== null && document.body.textContent!.includes("Disposable test profile"));
  assert(document.activeElement?.closest("dialog") !== null, "sync dialog receives keyboard focus");
  assert(document.querySelector("dialog")!.scrollWidth <= document.querySelector("dialog")!.clientWidth + 1, "dialog fits the viewport");
  await waitFor(() => document.querySelectorAll(".hk-anki-row").length === 50);
  assert(!document.querySelector(".hk-vocab-actions dialog"), "portal isolates sync controls from vocabulary toolbar CSS");
  assert(!document.querySelector(".hk-anki-row__details .hk-anki-field-grid"), "collapsed note details do not preload hidden media");
  const noteDetails = document.querySelector<HTMLDetailsElement>(".hk-anki-row__details")!;
  noteDetails.open = true;
  await waitFor(() => !!noteDetails.querySelector(".hk-anki-audio"));
  const previewAudio = noteDetails.querySelector<HTMLButtonElement>(".hk-anki-audio")!;
  profile = "Other profile";
  previewAudio.click(); await waitFor(() => vocabularyAudio.getSnapshot().status === "playing");
  assert(!await ankiStorage.media("Other profile:word.wav"), "sync preview recordings remain scoped to the preview profile after a profile switch");
  noteDetails.open = false;
  await waitFor(() => vocabularyAudio.getSnapshot().status === "idle");
  profile = "Disposable test profile";
  assert(document.querySelectorAll(".hk-anki-row").length === 50 && document.querySelector(".hk-anki-count")!.textContent!.includes("56"), "preview paginates 50 rows with total selection count");
  const next = document.querySelector<HTMLButtonElement>('button[aria-label="Next page"]')!;
  next.click(); await waitFor(() => document.querySelectorAll(".hk-anki-row").length === 6);
  assert(document.querySelectorAll(".hk-anki-row").length === 6, "next page contains only remaining rows");
  document.querySelector<HTMLButtonElement>('button[aria-label="Previous page"]')!.click();
  await waitFor(() => document.querySelectorAll(".hk-anki-row").length === 50);
  const close = document.querySelector<HTMLButtonElement>('dialog button[aria-label="Close"]')!;
  close.click();
  assert(!document.querySelector("dialog[open]"), "dialog closes through its keyboard-accessible button");
  await waitFor(() => document.activeElement?.textContent === "Sync with Anki");
  assert(document.activeElement?.textContent === "Sync with Anki", "closing dialog returns focus to toolbar trigger");
  pausedReads = true;
  buttons().find(button => button.textContent === "Sync with Anki")!.click();
  await waitFor(() => !!releaseRead);
  buttons().find(button => button.textContent === "Stop")!.click();
  await waitFor(() => document.body.textContent!.includes("Preview stopped"));
  assert(!releaseRead, "Stop aborts an in-flight preview read immediately");
  pausedReads = false;
  document.querySelector<HTMLButtonElement>(".hk-anki-dialog__footer button")!.click();
  await waitFor(() => document.querySelectorAll(".hk-anki-row").length === 50);
  document.querySelector<HTMLInputElement>('.hk-anki-conflict input[value="anki"]')?.click();
  // The first row has a conflict; choose its Anki radio by the row's choice order.
  const choices = document.querySelectorAll<HTMLInputElement>(".hk-anki-conflict input");
  for (let index = 1; index < choices.length; index += 2) choices[index].click();
  await waitFor(() => !document.querySelector<HTMLButtonElement>(".hk-anki-dialog__footer > button")!.disabled);
  pausedReads = true;
  document.querySelector<HTMLButtonElement>(".hk-anki-dialog__footer > button")!.click();
  await waitFor(() => !!releaseRead);
  buttons().find(button => button.textContent === "Stop")!.click();
  pausedReads = false; releaseRead!();
  await waitFor(() => document.querySelector(".hk-anki-totals") !== null);
  assert(document.querySelector(".hk-anki-totals")!.textContent!.includes("55"), "Stop completes one note and reports remaining notes separately");
  await waitFor(() => document.querySelector<HTMLButtonElement>(".hk-anki-dialog__footer button")?.textContent === "Refresh");
  document.querySelector<HTMLButtonElement>(".hk-anki-dialog__footer button")!.click();
  await waitFor(() => document.querySelectorAll(".hk-anki-row").length === 50);
  close.click();
  disconnected = true;
  document.querySelector<HTMLButtonElement>(".hk-anki-review__header button")!.click();
  await waitFor(() => document.querySelector(".hk-anki-review .hk-anki-feedback details") !== null);
  assert(!document.querySelector(".hk-anki-review .hk-anki-pending"), "connection error offers no answer reconciliation without a pending answer");
  assert(!document.querySelector(".hk-anki-review .hk-anki-feedback details")!.hasAttribute("open"), "raw API diagnostics are collapsed by default");
  disconnected = false;
  document.querySelector<HTMLButtonElement>(".hk-anki-review__header button")!.click();
  await waitFor(() => !!document.querySelector(".hk-anki-review .hk-srs-empty"));
  // Leave a full preview ready for responsive screenshots.
  buttons().find(button => button.textContent === "Sync with Anki")!.click();
  await waitFor(() => document.querySelectorAll(".hk-anki-row").length === 50);
  close.click();
  Object.assign(window, { ankiFixture: { async reviewState(state: "question" | "answer" | "pending" | "error" | "empty") {
    vocabularyAudio.stop();
    disconnected = state === "error";
    cards.get(1000)!.due = state === "empty" ? 10 : 0;
    await ankiStorage.setState(`review:${profile}:1000`, state === "pending" ? { status: "pending" } : undefined);
    document.querySelector<HTMLButtonElement>(".hk-anki-review__header button")!.click();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (state === "error") await waitFor(() => !!document.querySelector(".hk-anki-review .is-error"));
    else if (state === "empty") await waitFor(() => !!document.querySelector(".hk-anki-review .hk-srs-empty"));
    else {
      await waitFor(() => !!document.querySelector(".hk-anki-study-card") && document.querySelector<HTMLButtonElement>(".hk-anki-review__header button")?.disabled === false);
      if (state === "pending") await waitFor(() => !!document.querySelector(".hk-anki-review .hk-anki-pending"));
      if (state === "answer") {
        const reveal = document.querySelector<HTMLButtonElement>(".hk-srs-btn--reveal")!;
        await waitFor(() => !reveal.disabled); reveal.click();
        await waitFor(() => !!document.querySelector(".hk-anki-review .hk-srs-grades"));
      }
    }
  } } });
};

run().then(() => {
  document.documentElement.dataset.result = "passed";
  document.title = "PASS Anki integration";
}, error => {
  results.push(`FAIL ${error.stack || error}`); document.documentElement.dataset.result = "failed"; document.title = "FAIL Anki integration";
}).finally(() => { document.querySelector("#results")!.textContent = results.join("\n"); });
