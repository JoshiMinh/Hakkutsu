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
  const { AnkiSyncPanel } = await import("../src/features/anki/sync-panel");
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
  await restoreVocabularyBackup(new File([JSON.stringify(old)], "old.json"));
  assert((await localSrs.getAllSrsCards()).some(card => card.id === "old"), "version 1 backups still restore");
  await ankiStorage.setState(`hidden:${profile}:100`, false);
  await sync.applySync(await sync.previewSync(config));
  const saved = (await localSrs.getAllSrsCards()).find(card => card.anki?.noteId === 100)!;
  await localSrs.updateSrsCard(saved.id, { meaning: "Changed in Hakkutsu" });
  notes.get(100)!.fields["Word Meaning"].value = "Changed in Anki";

  const root = createRoot(document.querySelector("#ui")!);
  root.render(createElement("div", { className: "hk-settings-form" },
    createElement(AnkiSettings, { settings: config, onUpdate() {} }),
    createElement(AnkiSyncPanel, { settings: config, onChanged: async () => {} }),
    createElement(AnkiReview, { settings: config })));
  await waitFor(() => document.querySelector("#anki-preset") !== null && document.querySelectorAll("audio").length > 0);
  assert(document.querySelector("#anki-preset") !== null, "Japanese preset renders in settings");
  assert(!document.querySelector(".hk-anki-study-card")!.textContent!.includes("私"), "audio question hides Japanese text");
  const reveal = Array.from(document.querySelectorAll<HTMLButtonElement>(".hk-anki-review button")).find(button => button.textContent?.toLowerCase().includes("show answer"))!;
  await waitFor(() => !reveal.disabled);
  reveal.click();
  await waitFor(() => Array.from(document.querySelectorAll<HTMLButtonElement>(".hk-anki-review button")).some(button => button.textContent === "Good"));
  const good = Array.from(document.querySelectorAll<HTMLButtonElement>(".hk-anki-review button")).find(button => button.textContent === "Good")!;
  good.click(); good.click();
  await waitFor(() => histories.get(1001)!.length === 1);
  assert(histories.get(1001)!.length === 1, "UI reveals then submits one audio review despite double clicking");
  const buttons = () => Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
  buttons().find(button => button.textContent === "Sync with Anki")!.click();
  await waitFor(() => document.querySelector("dialog[open]") !== null && document.body.textContent!.includes("Disposable test profile"));
  assert(document.activeElement?.closest("dialog") !== null, "sync dialog receives keyboard focus");
  assert(document.querySelector("dialog")!.scrollWidth <= document.querySelector("dialog")!.clientWidth + 1, "dialog fits the viewport");
  const close = Array.from(document.querySelectorAll<HTMLButtonElement>("dialog button")).find(button => button.textContent === "Close")!;
  close.click();
  assert(!document.querySelector("dialog[open]"), "dialog closes through its keyboard-accessible button");
};

run().then(() => {
  document.documentElement.dataset.result = "passed";
  document.title = "PASS Anki integration";
}, error => {
  results.push(`FAIL ${error.stack || error}`); document.documentElement.dataset.result = "failed"; document.title = "FAIL Anki integration";
}).finally(() => { document.querySelector("#results")!.textContent = results.join("\n"); });
