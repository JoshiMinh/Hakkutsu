const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loader } = require("./load-typescript.cjs");
const pure = loader();
const schema = pure("src/features/anki/japanese-schema.ts");
const diff = pure("src/features/anki/sync-plan.ts");
const { AnkiConnectError } = pure("src/features/anki/anki-connect.ts");
const target = { profile: "Test", deck: "Japanese::Vocabulary", deckId: 12, model: "Japanese" };
const settings = { ankiEnabled: true, ankiPreset: "japanese", ankiDeck: target.deck, ankiModel: target.model };
const clone = value => structuredClone(value);

test("multi-batch imports keep all notes and long fields beyond preview page and read-batch limits", async () => {
  const f = fixture(), longNotes = "保存する長い注記。".repeat(6000) + "END";
  for (let id = 101; id <= 350; id++) f.notes.set(id, note(id, { Notes: id === 350 ? longNotes : "" }));
  const progress = [];
  const plan = await f.service.previewSync(settings, { onProgress: value => progress.push(value) });
  assert.equal(plan.rows.length, 251);
  assert.equal(progress.at(-1).completed, 251);
  const result = await f.service.applySync(plan);
  assert.deepEqual(result, { completed: 251, failures: [], stopped: false, notAttempted: 0 });
  assert.equal(f.locals().length, 251);
  const last = f.locals().find(card => card.anki.noteId === 350);
  assert.equal(last.notes, longNotes); assert.equal(last.anki.baseline.Notes, longNotes);
  assert.equal((await f.service.previewSync(settings)).rows.filter(row => row.kind !== "unchanged").length, 0);
  assert.equal(f.writes.length, 0);
});

test("an incomplete batch response is rejected before any import is saved", async () => {
  const f = fixture(), read = f.api.notesInfo;
  f.api.notesInfo = async ids => (await read(ids)).slice(1);
  await assert.rejects(f.service.previewSync(settings), /changed during the read/);
  assert.equal(f.locals().length, 0); assert.equal(f.writes.length, 0);
});

test("progress refresh failure does not count a successfully imported note as failed", async () => {
  const f = fixture();
  f.api.cardsInfo = async () => { throw new Error("AnkiConnect timed out"); };
  const result = await f.service.applySync(await f.service.previewSync(settings));
  assert.equal(result.completed, 1); assert.equal(result.failures.length, 0);
  assert.equal(result.notAttempted, 0); assert.match(result.progressError, /timed out/);
  assert.equal(f.locals().length, 1);
});

test("Anki searches reject unsupported syntax and exclude filtered, suspended and buried cards", async () => {
  const f = fixture([local()]);
  await assert.rejects(f.api.findCards("-is:filtered"), /Invalid search/);
  f.cards.set(1002, { ...remoteCard(1002), odid: 12 });
  f.cards.set(1003, { ...remoteCard(1003), queue: -1 });
  f.cards.set(1004, { ...remoteCard(1004), queue: -2 });
  const queries = [], find = f.api.findCards;
  f.api.findCards = async query => { queries.push(query); return find(query); };
  await f.service.applySync(await f.service.previewSync(settings));
  assert.deepEqual((await f.reviews.loadAnkiReview(settings)).map(card => card.cardId), [1000, 1001]);
  assert.ok(queries.length >= 3 && queries.every(query => query.includes("-deck:filtered") && query.includes("-is:suspended -is:buried")));
});

test("preview aborts before another batch and never changes saved cards", async () => {
  const f = fixture(), controller = new AbortController();
  for (let id = 101; id <= 310; id++) f.notes.set(id, note(id));
  let batches = 0;
  const read = f.api.notesInfo;
  f.api.notesInfo = async ids => { batches++; const values = await read(ids); controller.abort(); return values; };
  await assert.rejects(f.service.previewSync(settings, { signal: controller.signal }), { name: "AbortError" });
  assert.equal(batches, 1); assert.equal(f.locals().length, 0); assert.equal(f.writes.length, 0);
});

test("stop finishes the current note and journal, skips progress refresh, releases the lock and resumes without duplicates", async () => {
  const f = fixture(), controller = new AbortController();
  f.notes.set(101, note(101)); f.notes.set(102, note(102));
  let scheduleReads = 0;
  f.api.cardsInfo = async () => { scheduleReads++; return []; };
  const plan = await f.service.previewSync(settings);
  const result = await f.service.applySync(plan, undefined, { signal: controller.signal, onProgress(progress) {
    if (progress.status === "running") controller.abort();
  } });
  assert.deepEqual(result, { completed: 1, failures: [], stopped: true, notAttempted: 2 });
  assert.equal(scheduleReads, 0); assert.equal(f.locals().length, 1);
  assert.equal([...f.state.values()].filter(value => value?.status === "confirmed").length, 1);
  const resumed = await f.service.applySync(await f.service.previewSync(settings));
  assert.equal(resumed.completed, 2); assert.equal(f.locals().length, 3);
  assert.equal(new Set(f.locals().map(card => card.anki.noteId)).size, 3);
  assert.equal(f.writes.length, 0);
});

test("connection-wide failures stop once while individual note failures allow partial imports", async () => {
  for (const systemic of [false, true]) {
    const f = fixture(); f.notes.set(101, note(101)); f.notes.set(102, note(102));
    const plan = await f.service.previewSync(settings), read = f.api.notesInfo;
    f.api.notesInfo = async ids => {
      if (ids.length === 1 && ids[0] === 100) throw new Error(systemic ? "AnkiConnect connection failed" : "Anki content changed");
      return read(ids);
    };
    const result = await f.service.applySync(plan);
    assert.equal(result.failures.length, 1); assert.equal(result.completed, systemic ? 0 : 2);
    assert.equal(result.notAttempted, systemic ? 2 : 0);
    f.api.notesInfo = read;
    assert.equal((await f.service.applySync(await f.service.previewSync(settings))).failures.length, 0);
  }
});

test("a stop during an Anki field write finishes read-back and confirms the write journal", async () => {
  const changed = local(); changed.meaning = "new meaning";
  const f = fixture([changed]), controller = new AbortController();
  f.notes.set(101, note(101));
  const write = f.api.updateFields;
  f.api.updateFields = async (...args) => { await write(...args); controller.abort(); };
  const result = await f.service.applySync(await f.service.previewSync(settings), undefined, { signal: controller.signal });
  assert.deepEqual(result, { completed: 1, failures: [], stopped: true, notAttempted: 1 });
  assert.equal(f.locals()[0].anki.baseline["Word Meaning"], "new meaning");
  assert.equal([...f.state.values()].filter(value => value?.status === "pending").length, 0);
  assert.equal((await f.service.applySync(await f.service.previewSync(settings))).completed, 1);
  assert.equal(f.writes.filter(value => value.action === "update").length, 1);
});

test("stopping during progress refresh preserves completed content and releases the lock", async () => {
  const f = fixture(), controller = new AbortController();
  const result = await f.service.applySync(await f.service.previewSync(settings), undefined, { signal: controller.signal,
    onProgress(progress) { if (progress.phase === "refresh") controller.abort(); } });
  assert.deepEqual(result, { completed: 1, failures: [], stopped: true, notAttempted: 0 });
  assert.equal(f.locals().length, 1);
  assert.equal((await f.service.applySync(await f.service.previewSync(settings))).failures.length, 0);
});

test("imported highlighting remains a local difference against the original Anki baseline", async () => {
  const f = fixture(); f.notes.set(100, note(100, { Sentence: "私はアンです。", "Sentence Furigana": "<ruby>私<rt>わたし</rt></ruby>はアンです。" }));
  await f.service.applySync(await f.service.previewSync(settings));
  const saved = f.locals()[0];
  assert.equal(saved.sentence, "<b>私</b>はアンです。");
  assert.equal(saved.anki.baseline.Sentence, "私はアンです。"); assert.equal(f.writes.length, 0);
  assert.equal((await f.service.previewSync(settings)).rows[0].kind, "update");
});
function note(id = 100, overrides = {}) {
  const values = Object.fromEntries(schema.japaneseFieldNames.map(field => [field, ""]));
  Object.assign(values, { Word: "私", "Word Reading": "わたし", "Word Furigana": "<ruby>私<rt>わたし</rt></ruby>",
    "Word Meaning": "I", Sentence: "<b>私</b>はアンです。", "Sentence Furigana": "<b><ruby>私<rt>わたし</rt></ruby></b>はアンです。",
    "Sentence Meaning": "I am Ann.", "Word Audio": "[sound:word.mp3]", "Sentence Audio": "[sound:sentence.mp3]", JLPT: "5",
    Picture: '<img src="picture.webp">', ...overrides });
  return { noteId: id, modelName: "Japanese", tags: ["jlpt::n5"], cards: [id * 10, id * 10 + 1],
    fields: Object.fromEntries(Object.entries(values).map(([field, value], order) => [field, { value, order }])) };
}
function local(remote = note(), id = "local") {
  const fields = diff.noteFields(remote);
  const card = { id, ...schema.cardContent(fields), due_date: 0, interval: 0, repetition: 0, efactor: 2.5, created_at: 1, updated_at: 1, tags: remote.tags };
  card.anki = { ...target, noteId: remote.noteId, baseline: fields, localBaseline: schema.localValues(card), tags: remote.tags, verified: true };
  return card;
}
function remoteCard(id = 1000, ord = 0) {
  return { cardId: id, note: 100, deckName: target.deck, modelName: "Japanese", template: ord ? "Word Audio" : "Word", ord,
    type: 2, queue: 2, due: 0, interval: 10, reps: 5, lapses: 1, factor: 2500, mod: 1 };
}

function fixture(initial = []) {
  let locals = clone(initial);
  const notes = new Map([[100, note()]]), cards = new Map([[1000, remoteCard()], [1001, remoteCard(1001, 1)]]);
  const state = new Map(), history = new Map([[1000, []], [1001, []]]), writes = [], cache = [];
  let profile = "Test", answerError = false;
  const api = {
    getProfile: async () => profile, getDeckIds: async () => ({ [target.deck]: 12 }),
    getModelFields: async () => schema.japaneseFieldNames,
    findNotes: async query => {
      if (/\bis:filtered\b/.test(query)) throw new Error("Invalid search: is:filtered");
      if (query.startsWith("tag:")) return [...notes.values()].filter(n => n.tags.includes(query.slice(4))).map(n => n.noteId);
      const nid = query.match(/nid:(\d+)/); return [...notes.keys()].filter(id => !nid || id === +nid[1]);
    },
    findCards: async query => {
      if (/\bis:filtered\b/.test(query)) throw new Error("Invalid search: is:filtered");
      const cid = query.match(/cid:(\d+)/), nid = query.match(/nid:(\d+)/);
      return [...cards.values()].filter(c => c.queue >= 0 && (!query.includes("-deck:filtered") || !c.odid) && (!cid || c.cardId === +cid[1]) && (!nid || c.note === +nid[1]) &&
        (!query.includes("is:new") || c.type === 0)).map(c => c.cardId);
    },
    notesInfo: async ids => ids.flatMap(id => notes.has(id) ? [clone(notes.get(id))] : []),
    cardsInfo: async ids => ids.flatMap(id => cards.has(id) ? [clone(cards.get(id))] : []),
    updateFields: async (id, fields) => { writes.push({ action: "update", id, fields }); for (const [field, value] of Object.entries(fields)) notes.get(id).fields[field].value = value; },
    addTags: async (ids, tags) => { if (tags.length) { writes.push({ action: "tags", tags }); for (const id of ids) notes.get(id).tags.push(...tags); } },
    addNote: async value => {
      writes.push({ action: "add", value }); const id = 200 + writes.length;
      const created = note(id, value.fields); created.tags = value.tags; created.cards = []; notes.set(id, created); return id;
    },
    reviews: async id => clone(history.get(id) || []),
    answer: async (id, ease) => {
      writes.push({ action: "answer", id, ease }); history.get(id).push({ id: Date.now(), ease }); cards.get(id).reps++;
      if (answerError) throw new Error("Transport interrupted after accepting answer");
    },
  };
  const storage = {
    states: async () => [...state].map(([key, value]) => ({ key, value: clone(value) })),
    backup: async () => ({ cards: clone(cache), media: [], state: [...state].map(([key, value]) => ({ key, value: clone(value) })) }),
    state: async key => clone(state.get(key)), setState: async (key, value) => state.set(key, clone(value)),
    putCards: async values => { cache.push(...values); },
  };
  const srs = {
    getAllSrsCards: async () => clone(locals), getSrsCard: async id => clone(locals.find(c => c.id === id)),
    putAnkiCard: async card => { locals = [...locals.filter(c => c.id !== card.id), clone(card)]; },
    putAnkiCards: async values => { for (const card of values) await srs.putAnkiCard(card); },
    updateSrsCard: async (id, values) => { const card = locals.find(c => c.id === id); Object.assign(card, values); return clone(card); },
  };
  let locked = false;
  const withLock = async work => { if (locked) throw new Error("locked"); locked = true; try { return await work(); } finally { locked = false; } };
  const load = loader({ "./anki-connect": { ankiClient: api, AnkiConnectError }, "./sync-storage": { ankiStorage: storage, withAnkiLock: withLock },
    "~/features/srs/local-srs": { localSrs: srs } });
  return { load, api, notes, cards, state, history, writes, locals: () => clone(locals), profile: value => { profile = value; },
    failAnswer: () => { answerError = true; }, service: load("src/features/anki/sync-service.ts"), reviews: load("src/features/anki/review-service.ts") };
}

test("Japanese fields preserve all 13 values, ruby, bold, filenames and numeric JLPT", () => {
  const n = note(), card = local(n);
  assert.deepEqual(schema.fieldsForCard(card), diff.noteFields(n));
  assert.equal(card.jlpt, "N5");
  assert.equal(schema.fieldsForCard({ ...card, jlpt: "N3" }).JLPT, "3");
  assert.equal(schema.furiganaHtml("あなた", "あなた"), "あなた");
  const generated = schema.furiganaHtml("食べる", "たべる");
  assert.match(generated, /<ruby>食<rt>た<\/rt><\/ruby>べる/);
  assert.equal(schema.plainText(generated), "食べる");
  assert.equal(schema.richText("<b>私</b>はアンです。"), "<b>私</b>はアンです。");
  assert.equal(schema.plainText(schema.furiganaHtml("<b>私[わたし]</b>はアンです。")), "私はアンです。");
});

test("three-way merge combines independent edits and requires a choice for simultaneous edits or clearing", () => {
  const n = note(), card = local(n); card.meaning = "me";
  const remote = note(100, { Notes: "added in Anki" });
  const merged = diff.mergeFields(card, remote);
  assert.equal(merged.fields["Word Meaning"], "me"); assert.equal(merged.fields.Notes, "added in Anki"); assert.equal(merged.conflicts.length, 0);
  remote.fields["Word Meaning"].value = "myself";
  const row = { ...merged, ...diff.mergeFields(card, remote), choices: {} };
  assert.throws(() => diff.resolveRow(row), /Choose/);
  row.choices["Word Meaning"] = "local"; assert.equal(diff.resolveRow(row)["Word Meaning"], "me");
  card.meaning = ""; assert.equal(diff.mergeFields(card, n).fields["Word Meaning"], "");
});

test("duplicate headwords keep note identities; ambiguous initial matches are not automatically linked", () => {
  const one = note(100), two = note(101), unlinked = local(one); delete unlinked.anki;
  const plan = diff.buildSyncPlan(target, [unlinked], [one, two], new Set());
  assert.deepEqual(plan.rows.map(row => row.kind), ["ambiguous", "ambiguous"]);
  assert.ok(plan.rows.every(row => !row.selected));
  const linked = diff.buildSyncPlan(target, [local(one, "one"), local(two, "two")], [one, two], new Set());
  assert.equal(linked.rows.length, 2); assert.ok(linked.rows.every(row => row.kind === "unchanged"));
  assert.equal(diff.buildSyncPlan(target, [], [one], new Set([100])).rows[0].kind, "hidden");
});

test("import and unchanged resync do not write to Anki; independent card schedules are cached", async () => {
  const f = fixture();
  const plan = await f.service.previewSync(settings);
  assert.equal(plan.rows[0].kind, "import"); assert.equal(f.locals().length, 0);
  const result = await f.service.applySync(plan);
  assert.equal(result.completed, 1); assert.equal(result.failures.length, 0); assert.equal(f.locals().length, 1);
  assert.equal(f.writes.length, 0); assert.ok(f.state.has("recovery:before-sync"));
  const next = await f.service.previewSync(settings);
  assert.equal(next.rows[0].kind, "unchanged");
  await f.service.applySync(next); assert.equal(f.writes.length, 0);
  assert.deepEqual((await f.reviews.loadAnkiReview(settings)).map(card => card.template), ["Word", "Word Audio"]);
});

test("local edits update the existing note, preserve unrelated fields and tags, and read back", async () => {
  const card = local(); card.meaning = "me";
  const f = fixture([card]); f.notes.get(100).fields.Custom = { value: "keep", order: 13 };
  const result = await f.service.applySync(await f.service.previewSync(settings));
  assert.equal(result.failures.length, 0);
  assert.deepEqual(f.writes.map(write => write.action), ["update"]);
  assert.equal(f.notes.get(100).fields.Custom.value, "keep");
  assert.equal(f.notes.get(100).fields["Word Meaning"].value, "me");
  assert.equal(f.locals()[0].anki.noteId, 100);
});

test("stale previews and profile switches never overwrite changed data", async () => {
  const card = local(); card.meaning = "me";
  const f = fixture([card]), plan = await f.service.previewSync(settings);
  f.notes.get(100).fields["Word Meaning"].value = "changed elsewhere";
  const result = await f.service.applySync(plan);
  assert.equal(result.completed, 0); assert.equal(result.failures.length, 1); assert.equal(f.writes.length, 0);
  f.profile("Other"); await assert.rejects(f.service.applySync(plan), /profile/); assert.equal(f.writes.length, 0);
});

test("re-export links the new note and never creates another note on subsequent sync", async () => {
  const card = local(note(900, { Word: "猫", "Word Reading": "ねこ" }), "cat"); delete card.anki;
  const f = fixture([card]);
  const result = await f.service.applySync(await f.service.previewSync(settings));
  assert.equal(result.failures.length, 0); assert.equal(f.writes.filter(w => w.action === "add").length, 1);
  await f.service.applySync(await f.service.previewSync(settings));
  assert.equal(f.writes.filter(w => w.action === "add").length, 1);
});

test("review ratings are Anki ease values and update only one sibling", async () => {
  for (const ease of [1, 2, 3, 4]) {
    const f = fixture([local()]), [card] = await f.reviews.loadAnkiReview(settings);
    await f.reviews.submitAnkiReview(card, ease, JSON.stringify(f.notes.get(100).fields));
    assert.deepEqual(f.writes.filter(w => w.action === "answer").map(w => [w.id, w.ease]), [[1000, ease]]);
    assert.equal(f.cards.get(1001).reps, 5);
  }
});

test("interrupted accepted answers reconcile instead of being sent twice", async () => {
  const f = fixture([local()]), [card] = await f.reviews.loadAnkiReview(settings); f.failAnswer();
  await assert.rejects(f.reviews.submitAnkiReview(card, 3), /Transport/);
  await f.reviews.submitAnkiReview(card, 3);
  assert.equal(f.writes.filter(w => w.action === "answer").length, 1);
  assert.equal(await f.reviews.reconcileReview("Test", 1000), "confirmed");
});

test("ambiguous review history and changed cards block a second answer", async () => {
  const f = fixture([local()]), [card] = await f.reviews.loadAnkiReview(settings);
  f.cards.get(1000).reps++;
  await assert.rejects(f.reviews.submitAnkiReview(card, 3), /changed/); assert.equal(f.writes.length, 0);
  f.state.set("review:Test:1000", { status: "pending", startedAt: Date.now(), ease: 3, previousReviewIds: [] });
  f.history.set(1000, [{ id: Date.now(), ease: 3 }, { id: Date.now() + 1, ease: 3 }]);
  assert.equal(await f.reviews.reconcileReview("Test", 1000), "ambiguous");
  await assert.rejects(f.reviews.submitAnkiReview(card, 3), /unresolved/); assert.equal(f.writes.length, 0);
});

test("AnkiConnect resolves ordinal templates and rejects malformed API data", async () => {
  const requests = [];
  const load = loader({ "~/features/settings/settings-storage": { getSettings: async () => settings } });
  const { AnkiConnectClient } = load("src/features/anki/anki-connect.ts");
  const previousFetch = global.fetch;
  global.fetch = async (_url, options) => {
    const request = JSON.parse(options.body); requests.push(request);
    const result = request.action === "cardsInfo" ? [{ ...remoteCard(), template: undefined }] : request.action === "modelTemplates" ? { Word: {}, "Word Audio": {} } : null;
    return { ok: true, json: async () => ({ result, error: null }) };
  };
  try {
    const client = new AnkiConnectClient();
    assert.equal((await client.cardsInfo([1000]))[0].template, "Word");
    assert.equal(requests[1].action, "modelTemplates");
    await assert.rejects(client.findNotes(""), /Invalid/);
  } finally { global.fetch = previousFetch; }
});

test("all Anki UI translations have the same keys in eight languages", () => {
  const locales = pure("src/shared/locales/anki-locales.ts"), keys = Object.keys(locales.ankiEN).sort();
  for (const locale of Object.values(locales)) assert.deepEqual(Object.keys(locale).sort(), keys);
});


test("an export accepted before transport failure is linked on retry without a duplicate", async () => {
  const card = local(note(900, { Word: "猫", "Word Reading": "ねこ" }), "cat"); delete card.anki;
  const f = fixture([card]), add = f.api.addNote;
  f.api.addNote = async value => { await add(value); throw new Error("Lost response"); };
  const first = await f.service.applySync(await f.service.previewSync(settings));
  assert.equal(first.failures.length, 1);
  f.api.addNote = add;
  const second = await f.service.applySync(await f.service.previewSync(settings));
  assert.equal(second.failures.length, 0);
  assert.equal(f.writes.filter(write => write.action === "add").length, 1);
  assert.equal((await f.service.pendingExports("Test")).length, 0);
});

test("an unrecorded export remains pending until explicitly released after checking Anki", async () => {
  const card = local(note(900, { Word: "猫", "Word Reading": "ねこ" }), "cat"); delete card.anki;
  const f = fixture([card]), add = f.api.addNote;
  let attempts = 0;
  f.api.addNote = async () => { attempts++; throw new Error("Transport failed"); };
  await f.service.applySync(await f.service.previewSync(settings));
  await f.service.applySync(await f.service.previewSync(settings));
  assert.equal(attempts, 1);
  const [pending] = await f.service.pendingExports("Test");
  await f.service.releasePendingExport("Test", pending.key);
  f.api.addNote = add;
  const result = await f.service.applySync(await f.service.previewSync(settings));
  assert.equal(result.failures.length, 0);
  assert.equal(f.writes.filter(write => write.action === "add").length, 1);
});

test("missing notes are retained locally and invalid ratings never create attempts", async () => {
  const f = fixture([local()]); f.notes.clear();
  const plan = await f.service.previewSync(settings);
  assert.equal(plan.rows[0].kind, "missing");
  await f.service.applySync(plan);
  assert.equal(f.locals().length, 1); assert.equal(f.locals()[0].anki.missing, true); assert.equal(f.writes.length, 0);
  await assert.rejects(f.reviews.submitAnkiReview(remoteCard(), 6), /Invalid review rating/);
  assert.ok(!f.state.has("review:Test:1000"));
});

test("first linking archives local progress independently of subsequent sync snapshots", async () => {
  const card = local(); delete card.anki; card.interval = 30; card.repetition = 12;
  const f = fixture([card]);
  let plan = await f.service.previewSync(settings);
  assert.equal(plan.rows[0].kind, "link");
  await f.service.applySync(plan);
  assert.equal(f.locals()[0].anki.previousLocalProgress.interval, 30);
  await f.service.applySync(await f.service.previewSync(settings));
  assert.equal(f.locals()[0].anki.previousLocalProgress.repetition, 12);
});
