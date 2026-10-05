const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');

function load(file, imports = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, console, URL, Blob, AbortController, setTimeout, clearTimeout,
    ...globals, require: name => imports[name] || require(name) });
  return exports;
}
const japanese = load('src/shared/japanese/japanese.ts');
const fieldMappings = load('src/features/anki/anki-fields.ts');
const clone = value => JSON.parse(JSON.stringify(value));
const card = (word, id = word) => ({ id, word, reading: 'よみ', meaning: 'meaning',
  due_date: 3000, interval: 2, repetition: 2, efactor: 2.5, created_at: 1000, updated_at: 2000,
  tags: ['日本語'], state: 2, stability: 4, difficulty: 5, lapse_count: 1, is_leech: false });
const backupFile = (cards, legacyVocabulary = [], changes = {}, bom = '') => ({ text: async () => bom + JSON.stringify({
  kind: 'hakkutsu-vocabulary-backup', formatVersion: 1, exportedAt: '2026-10-05T00:00:00.000Z',
  cards, legacyVocabulary, ...changes,
}) });

function backupHarness(initial = [], history = [], options = {}) {
  const records = new Map(initial.map(item => [item.id, clone(item)]));
  let uuid = 0, puts = 0, transactions = 0, aborts = 0, historyWrites = 0;
  let storedHistory = clone(history);
  const db = { transaction() {
    transactions++;
    const snapshot = clone([...records]);
    const store = {
      getAll: async () => clone([...records.values()]),
      index: () => ({ getAll: async () => clone([...records.values()]) }),
      put: async item => {
        if (++puts === options.failPut) throw Error('IndexedDB write failed');
        records.set(item.id, clone(item));
      },
    };
    return { store, objectStore: () => store, done: Promise.resolve(), abort() {
      aborts++; records.clear(); for (const [key, item] of snapshot) records.set(key, item);
    } };
  } };
  const srs = load('src/features/srs/local-srs.ts', {
    idb: { openDB: async () => db }, '~/shared/japanese/hanviet-dict': {}, '~/features/dictionary/dictionary-lookup': {}, '~/features/dictionary/google-translate': {},
    '~/features/settings/settings-storage': {}, '~/features/analytics/analytics-service': {}, '~/features/srs/fsrs-engine': {},
  }, { crypto: { randomUUID: () => 'generated-' + (++uuid) } });
  const chrome = { runtime: { getManifest: () => ({ version: '2.4' }) }, storage: { local: {
    get: async () => { if (options.failRead) throw Error('Storage denied'); return { hakkutsu_vocabulary: clone(storedHistory) }; },
    set: async value => { historyWrites++; if (options.failHistoryWrite) throw Error('Quota exceeded'); storedHistory = clone(value.hakkutsu_vocabulary); },
  } } };
  const backup = load('src/features/vocabulary/data-backup.ts', { '~/features/srs/local-srs': srs }, { chrome,
    crypto: { randomUUID: () => 'legacy-' + (++uuid) } });
  return { ...backup, ...srs, records, options, history: () => storedHistory,
    activity: () => ({ puts, transactions, aborts, historyWrites }) };
}

test('JSON backup round-trip preserves all vocabulary metadata and review state, including a UTF-8 BOM', async () => {
  const original = { ...card('食べる'), word_furigana: '食べる[たべる]', sentence_furigana: '食べる[たべる]。',
    sentence: '食べる。', sentence_meaning: 'Eat.', vietnamese_sound: 'THỰC', source_url: 'https://example.com/video',
    image_url: 'data:image/png;base64,example', last_review: 1800, retrievability: 0.8 };
  const legacy = { id: 'old', word: '本', reading: 'ほん', meaning: 'book', addedAt: 500, exported: true };
  const source = backupHarness([original], [legacy]);
  const exported = await source.createVocabularyBackup();
  assert.equal(exported.extensionVersion, '2.4');
  const target = backupHarness();
  const result = await target.restoreVocabularyBackup({ text: async () => '\uFEFF' + JSON.stringify(exported) });
  assert.deepEqual(clone(result), { cards: 1, legacyVocabulary: 1 });
  assert.deepEqual(target.records.get(original.id), original);
  for (const [key, value] of Object.entries(legacy)) assert.deepEqual(target.history()[0][key], value);
});

test('restoring an older backup preserves newer reviews and fills missing metadata', async () => {
  const current = { ...card('本', 'current-id'), interval: 30, repetition: 12, due_date: 9000, updated_at: 8000, last_review: 7500 };
  const old = { ...card('本', 'old-id'), sentence: '本を読む。' };
  const app = backupHarness([current]);
  await app.restoreVocabularyBackup(backupFile([old]));
  const restored = app.records.get('current-id');
  assert.equal(app.records.size, 1);
  for (const field of ['interval', 'repetition', 'due_date', 'updated_at', 'last_review']) assert.equal(restored[field], current[field]);
  assert.equal(restored.sentence, old.sentence);
});

test('newer backups update existing words, partial cards keep saved schedules, and ID collisions never overwrite other words', async () => {
  const first = card('本', 'collision');
  const app = backupHarness([first]);
  await app.restoreVocabularyBackup(backupFile([
    { ...card('水', 'collision'), updated_at: 3000 },
    { ...card('本', 'other'), meaning: 'new meaning', updated_at: 9000, interval: 40 },
    { word: '本', sentence: 'Additional sentence' },
  ]));
  assert.equal(app.records.size, 2);
  assert.equal(app.records.get('collision').word, '本');
  assert.equal(app.records.get('collision').interval, 40);
  assert.equal(app.records.get('collision').meaning, 'new meaning');
  assert.equal(app.records.get('collision').sentence, 'Additional sentence');
  assert.equal([...app.records.values()].find(item => item.word === '水').id.startsWith('generated-'), true);
});

test('duplicate words and repeated restores are idempotent and report unique card counts', async () => {
  const app = backupHarness();
  const file = backupFile([card(' Book ', 'one'), { ...card('book', 'two'), meaning: 'updated', updated_at: 3000 }]);
  for (let run = 0; run < 2; run++) {
    assert.equal((await app.restoreVocabularyBackup(file)).cards, 1);
    assert.equal(app.records.size, 1);
    assert.equal(app.records.get('one').meaning, 'updated');
  }
});

test('invalid backup records are rejected before either storage is changed', async () => {
  const badCards = [null, { word: 5 }, { word: '' }, { word: '本', tags: [7] }, { word: '本', id: {} },
    { word: '本', due_date: null }, { word: '本', interval: -1 }, { word: '本', meaning: [] },
    { word: '本', state: 9 }, { word: '本', is_leech: 'false' }];
  for (const bad of badCards) {
    const app = backupHarness([card('既存')]);
    await assert.rejects(app.restoreVocabularyBackup(backupFile([card('Valid'), bad])), /Backup card/);
    assert.deepEqual(app.activity(), { puts: 0, transactions: 0, aborts: 0, historyWrites: 0 });
  }
  for (const bad of [null, { word: 5 }, { word: '本', id: {} }, { word: '本', reading: [] }, { word: '本', exported: 'true' }]) {
    const app = backupHarness();
    await assert.rejects(app.restoreVocabularyBackup(backupFile([card('Valid')], [bad])), /Backup vocabulary/);
    assert.equal(app.activity().transactions, 0);
  }
});

test('invalid JSON, unsupported versions and denied history reads do not partially restore cards', async () => {
  const app = backupHarness([], [], { failRead: true });
  await assert.rejects(app.restoreVocabularyBackup({ text: async () => '{bad' }), /not valid JSON/);
  await assert.rejects(app.restoreVocabularyBackup(backupFile([], [], { formatVersion: 99 })), /not a supported/);
  await assert.rejects(app.restoreVocabularyBackup(backupFile([card('本')])), /Storage denied/);
  assert.equal(app.activity().transactions, 0);
});

test('failed database writes abort the card transaction instead of leaving earlier imported records', async () => {
  const app = backupHarness([card('Existing')], [], { failPut: 2 });
  await assert.rejects(app.restoreVocabularyBackup(backupFile([card('First'), card('Second')])), /write failed/);
  assert.equal(app.activity().aborts, 1);
  assert.deepEqual([...app.records.keys()], ['Existing']);
  assert.equal(app.activity().historyWrites, 0);
});

test('history failures report partial completion clearly and a retry finishes without duplicating cards', async () => {
  const app = backupHarness([], [], { failHistoryWrite: true });
  const file = backupFile([card('本')], [{ word: '本', id: 'history' }]);
  await assert.rejects(app.restoreVocabularyBackup(file), /Cards were restored.*Retry this backup/);
  assert.equal(app.records.size, 1);
  app.options.failHistoryWrite = false;
  await app.restoreVocabularyBackup(file);
  assert.equal(app.records.size, 1);
  assert.equal(app.history().length, 1);
});

test('legacy history merges by word, preserves saved values, handles ID collisions and keeps export status', async () => {
  const app = backupHarness([], [{ id: 'shared', word: '本', meaning: 'saved', exported: true }]);
  const result = await app.restoreVocabularyBackup(backupFile([], [
    { id: 'backup-id', word: '本', meaning: 'old', reading: 'ほん', exported: false },
    { id: 'shared', word: '水' }, { id: 'duplicate', word: '水' },
  ]));
  assert.equal(result.legacyVocabulary, 2);
  assert.equal(app.history().length, 2);
  const book = app.history().find(item => item.word === '本');
  assert.equal(book.id, 'shared'); assert.equal(book.meaning, 'saved'); assert.equal(book.reading, 'ほん'); assert.equal(book.exported, true);
  assert.notEqual(app.history().find(item => item.word === '水').id, 'shared');
});

function ankiHarness(modelFields = ['Front', 'Back'], responder, globals = {}) {
  const requests = [];
  const settings = { ankiEnabled: true };
  const service = load('src/features/anki/anki-connect.ts', {
    '~/features/anki/constants': load('src/features/anki/constants.ts'), '~/features/settings/settings-storage': { getSettings: async () => settings },
    './anki-fields': fieldMappings, '~/shared/japanese/japanese': japanese,
  }, { fetch: async (_url, options) => {
    const request = JSON.parse(options.body); requests.push(request);
    const custom = responder?.(request, options);
    if (custom) return await custom;
    const result = request.action === 'modelFieldNames' ? modelFields : request.action === 'version' ? 6 :
      request.action === 'createDeck' ? 123 : request.action === 'addNote' ? 456 : [];
    return { ok: true, json: async () => ({ result, error: null }) };
  }, ...globals });
  return { client: service.ankiClient, requests, settings };
}
const exportData = { word: '食べる', reading: 'たべる', meaning: 'eat <food> & drink', sentence: '食べる。',
  wordFurigana: '食べる[たべる]', sentenceFurigana: '食べる[たべる]。', sentenceMeaning: 'Eat.',
  vietnameseSound: 'THỰC', sourceUrl: 'https://example.com/?a=1&b=2', jlptLevel: 'N5', pos: 'Verb' };

test('Anki Basic exports only actual fields and preserves literal text in HTML', async () => {
  const app = ankiHarness();
  assert.equal(await app.client.exportVocabulary(exportData, 'Deck', 'Basic'), 456);
  const note = app.requests.find(request => request.action === 'addNote').params.note;
  assert.deepEqual(Object.keys(note.fields), ['Front', 'Back']);
  assert.match(note.fields.Back, /eat &lt;food&gt; &amp; drink/);
  assert.match(note.fields.Back, /sentence-meaning.*Eat\./);
  assert.equal(app.requests[0].action, 'modelFieldNames');
});

test('custom Anki note types automatically receive readings, HTML furigana, meanings, Han Viet and source metadata', async () => {
  const fields = ['Word', 'Word Furigana', 'Sentence Furigana', 'Sentence Meaning', 'Vietnamese Sound', 'Source URL'];
  const app = ankiHarness(fields);
  await app.client.exportVocabulary(exportData, 'Deck', 'Japanese');
  const note = app.requests.find(request => request.action === 'addNote').params.note;
  assert.deepEqual(Object.keys(note.fields), fields);
  assert.equal(note.fields['Word Furigana'], '<ruby>食<rt>た</rt></ruby>べる');
  assert.equal(note.fields['Sentence Furigana'], '<ruby>食<rt>た</rt></ruby>べる。');
  assert.equal(note.fields['Sentence Meaning'], 'Eat.');
  assert.equal(note.fields['Vietnamese Sound'], 'THỰC');
  assert.match(note.fields['Source URL'], /a=1&amp;b=2/);
});

test('invalid, stale and empty Anki mappings fail before creating decks or notes', async () => {
  for (const mapping of [{ Removed: 'word' }, { Front: 'none', Back: 'meaning' }, { Front: 'typo' }]) {
    const app = ankiHarness();
    await assert.rejects(app.client.exportVocabulary(exportData, 'Deck', 'Basic', mapping), /mapping|first field|Mapped field/);
    assert.deepEqual(app.requests.map(request => request.action), ['modelFieldNames']);
  }
  const app = ankiHarness();
  await assert.rejects(app.client.exportVocabulary({ ...exportData, word: '' }), /Choose a vocabulary word/);
  assert.equal(app.requests.length, 0);
  await app.client.exportVocabulary(exportData, 'Deck', 'Basic', { front: 'word', BACK: 'meaning', Removed: 'none' });
  assert.equal(app.requests.find(request => request.action === 'addNote').params.note.fields.Front, '食べる');
});

test('Anki errors, invalid protocol responses, invalid IDs and disabled integration never report successful exports', async () => {
  for (const payload of [null, {}, { result: 6 }, { result: 6, error: {} }, { result: null, error: 'model missing' }]) {
    const app = ankiHarness([], () => ({ ok: true, json: async () => payload }));
    await assert.rejects(app.client.getVersion(), /Invalid|model missing/);
  }
  for (const result of [null, '123', 0, -1, {}]) {
    const app = ankiHarness(undefined, request => request.action === 'addNote' ? { ok: true, json: async () => ({ result, error: null }) } : null);
    await assert.rejects(app.client.exportVocabulary(exportData), /rejected|valid note ID/);
  }
  const disabled = ankiHarness(); disabled.settings.ankiEnabled = false;
  await assert.rejects(disabled.client.exportVocabulary(exportData), /disabled/);
  assert.equal(disabled.requests.length, 0);
  const deckFailure = ankiHarness(undefined, request => request.action === 'createDeck' ? { ok: true, json: async () => ({ result: null, error: 'Deck failed' }) } : null);
  await assert.rejects(deckFailure.client.exportVocabulary(exportData), /Deck failed/);
  assert.equal(deckFailure.requests.some(request => request.action === 'addNote'), false);
});

test('Anki requests time out and clear their timer so failed exports can recover', async () => {
  let expire, clears = 0, hang = true;
  const app = ankiHarness([], (_request, options) => hang && new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Error('Aborted')));
  }), { setTimeout: fn => { expire = fn; return 1; }, clearTimeout: () => { clears++; } });
  const result = app.client.getVersion();
  await new Promise(resolve => setImmediate(resolve));
  expire();
  await assert.rejects(result, /timed out/);
  assert.equal(clears, 1);
  hang = false;
  assert.equal(await app.client.getVersion(), 6);
  assert.equal(clears, 2);
});

function csvRecords(csv) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 1; i < csv.length; i++) {
    const char = csv[i];
    if (char === '"') { if (quoted && csv[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && char === ',') { row.push(cell); cell = ''; }
    else if (!quoted && char === '\r' && csv[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
    else cell += char;
  }
  row.push(cell); rows.push(row); return rows;
}

test('CSV exports retain Japanese, Vietnamese, quotes, commas and embedded newlines with aligned columns', () => {
  const { createVocabularyCsv } = load('src/features/vocabulary/vocabulary-csv.ts', { '~/shared/japanese/hanviet-dict': { getHanViet: () => 'THỰC' } });
  const original = { ...card('食べる'), meaning: 'eat, "food"\n飲む', sentence: '日本語\r\nTiếng Việt', created_at: NaN };
  for (const showHanViet of [false, true]) {
    const csv = createVocabularyCsv([original], showHanViet, 2000);
    assert.equal(csv.charCodeAt(0), 0xFEFF);
    const [headers, values] = csvRecords(csv);
    assert.equal(values.length, headers.length);
    const record = Object.fromEntries(headers.map((header, index) => [header, values[index]]));
    assert.equal(record.Word, original.word); assert.equal(record['Word Meaning'], original.meaning);
    assert.equal(record['Example Sentence'], original.sentence); assert.equal(record['Date Added'], '');
    if (showHanViet) assert.equal(record['Han Viet'], 'THỰC');
  }
});

function visit(element, result = []) {
  if (!React.isValidElement(element)) return result;
  result.push(element); React.Children.forEach(element.props.children, child => visit(child, result)); return result;
}

test('the vocabulary export button passes saved furigana, sentence meaning, Han Viet and source to Anki', async () => {
  const exports = [];
  const original = { ...card('本'), word_furigana: '本[ほん]', sentence_furigana: '本[ほん]を読む。',
    sentence_meaning: 'Read a book.', vietnamese_sound: 'BỔN', source_url: 'https://example.com/book' };
  const imports = {
    react: { ...React, useState: initial => [Array.isArray(initial) ? [original] : initial === true ? false : initial, () => {}],
      useEffect() {}, useRef: () => ({ current: null }) },
    '~/features/srs/local-srs': {}, '~/shared/japanese/hanviet-dict': { getHanViet: () => '' }, '~/shared/japanese/jlpt-classifier': { predictJlpt: () => null },
    '~/shared/ui/badges': { JlptBadge: () => null, FrequencyBadge: () => null }, '~/features/dictionary/dictionary-lookup': {}, '~/features/vocabulary/data-backup': {}, '~/features/vocabulary/vocabulary-csv': {},
    '~/shared/locales': { useTranslation: () => ({ t: key => key, lang: 'en' }) },
    '~/features/settings/settings-store': { useSettingsStore: () => ({ settings: {} }) },
    '~/features/anki/anki-connect': { ankiClient: { isConnected: async () => true, exportVocabulary: async data => exports.push(data) } },
  };
  const globals = { alert() {} };
  const hooks = {
    './use-vocabulary-cards': load('src/features/vocabulary/use-vocabulary-cards.ts', imports, globals),
    './use-vocabulary-exports': load('src/features/vocabulary/use-vocabulary-exports.ts', imports, globals),
    './edit-card-modal': { EditCardModal: () => null },
    './vocabulary-table': { VocabularyTable: () => null },
  };
  const { WordList } = load('src/features/vocabulary/word-list.tsx', { ...imports, ...hooks }, globals);
  const button = visit(WordList({})).find(node => node.type === 'button' && node.props.title === 'vocab_btn_export_anki');
  assert.ok(button);
  await button.props.onClick();
  assert.equal(exports.length, 1);
  const data = exports[0];
  assert.equal(data.wordFurigana, original.word_furigana); assert.equal(data.sentenceFurigana, original.sentence_furigana);
  assert.equal(data.sentenceMeaning, original.sentence_meaning); assert.equal(data.vietnameseSound, original.vietnamese_sound);
  assert.equal(data.sourceUrl, original.source_url); assert.equal(data.sentenceReading, undefined);
});

test('dictionary lookup initializes and repairs indexes, shares concurrent opens and can retry denied storage', async () => {
  for (const hasStore of [false, true]) {
    let opens = 0, creates = 0, upgradeOptions;
    const indexes = new Set(hasStore ? ['kanji'] : []);
    const store = { indexNames: { contains: name => indexes.has(name) }, createIndex(name) { indexes.add(name); } };
    const db = { objectStoreNames: { contains: () => hasStore }, createObjectStore() { creates++; return store; }, close() {} };
    const service = load('src/features/dictionary/local-lookup.ts', { idb: { openDB: async (_name, version, options) => {
      opens++; assert.equal(version, 2); upgradeOptions = options;
      if (opens === 1) throw Error('Storage denied');
      options.upgrade(db, 1, 2, { objectStore: () => store }); return db;
    } } });
    await assert.rejects(service.getDB(), /Storage denied/);
    const connections = await Promise.all([service.getDB(), service.getDB(), service.getDB()]);
    assert.equal(opens, 2); assert.equal(connections.every(connection => connection === db), true);
    assert.deepEqual([...indexes].sort(), ['kanji', 'reading']); assert.equal(creates, hasStore ? 0 : 1);
    upgradeOptions.terminated(); await service.getDB(); assert.equal(opens, 3);
  }
});

function dictionaryHarness(payload, options = {}) {
  const entries = new Map(); let transactions = 0, fetches = 0, aborts = 0, puts = 0;
  const db = { count: async () => entries.size, transaction() {
    transactions++;
    const snapshot = new Map(entries);
    return { done: Promise.resolve(), abort() { aborts++; entries.clear(); for (const [key, entry] of snapshot) entries.set(key, entry); },
      objectStore: () => ({ put: async entry => {
        if (++puts === options.failPut) throw Error('Dictionary write failed'); entries.set(entry.id, entry);
      } }) };
  } };
  const service = load('src/features/dictionary/dictionary-sync.ts', { './local-lookup': { getDB: async () => db } }, {
    console: { log() {}, error() {} }, fetch: async () => {
      fetches++;
      if (options.failFetch) throw Error('Network failed');
      return { ok: options.httpError ? false : true, json: async () => payload };
    },
  });
  return { ...service, entries, activity: () => ({ transactions, fetches, aborts }) };
}

test('dictionary downloads require a real source and reject malformed entries before writing', async () => {
  for (const payload of [{}, [], [null], [{ id: '1', kanjiElements: ['本'], readingElements: [5], senses: [] }],
    [{ id: {}, kanjiElements: [], readingElements: ['ほん'], senses: [] }]]) {
    const app = dictionaryHarness(payload);
    await assert.rejects(app.syncDictionary('https://example.com/dictionary.json'), /Dictionary/);
    assert.equal(app.activity().transactions, 0);
  }
  const app = dictionaryHarness([]);
  await assert.rejects(app.syncDictionary(), /source URL/);
  await assert.rejects(app.syncDictionary('file:///dictionary.json'), /HTTP or HTTPS/);
  assert.equal(app.activity().fetches, 0);
  const failed = dictionaryHarness([], { failFetch: true });
  await assert.rejects(failed.syncDictionary('https://example.com/dictionary.json'), /Network failed/);
  assert.equal(failed.activity().transactions, 0);
});

test('dictionary writes normalize IDs, deduplicate entries and abort failed imports', async () => {
  const entry = { id: 1, kanjiElements: ['本'], readingElements: ['ほん'], senses: [{ partOfSpeech: ['noun'], glosses: ['book'] }] };
  const app = dictionaryHarness([entry, { ...entry, id: '1' }]);
  assert.equal(await app.syncDictionary('https://example.com/dictionary.json'), 1);
  assert.equal(app.entries.get('1').readingElements[0], 'ほん');
  assert.equal(await app.syncDictionary(), 1); assert.equal(app.activity().fetches, 1);
  const failed = dictionaryHarness([entry, { ...entry, id: 2 }], { failPut: 2 });
  await assert.rejects(failed.syncDictionary('https://example.com/dictionary.json'), /write failed/);
  assert.equal(failed.entries.size, 0); assert.equal(failed.activity().aborts, 1);
});

test('empty initialized dictionaries skip expensive compound token queries', async () => {
  let queries = 0;
  const { tokenize } = load('src/features/dictionary/local-tokenizer.ts', {
    '~/shared/japanese/japanese': japanese,
    './japanese-token-refinement': { refineJapaneseTokens: async () => { throw Error('Should not refine an empty dictionary'); } },
    './local-lookup': { getDB: async () => ({ objectStoreNames: { contains: () => true }, count: async () => 0 }),
      searchDictionary: async () => { queries++; return []; } },
  }, { Intl });
  const text = '食べたら本を読む。';
  const tokens = await tokenize(text, { dictionaryAware: true });
  assert.equal(tokens.map(token => token.surface_form).join(''), text);
  assert.equal(queries, 0);
});

test('switching Anki models removes stale mappings and delayed results cannot restore an older selection', async () => {
  const changes = [], requests = [], refs = [];
  let stateIndex = 0, refIndex = 0;
  const { useAnkiSettings } = load('src/features/settings/use-anki-settings.ts', {
    react: { ...React, useState(initial) {
      const states = [['Deck'], ['Old', 'A', 'B'], ['Removed'], true, false];
      const index = stateIndex++; return [index < states.length ? states[index] : initial, () => {}];
    },
      useRef: initial => refs[refIndex++] ||= { current: initial }, useEffect() {}, useCallback: fn => fn },
    '~/shared/locales': { t: key => key, SUPPORTED_LANGUAGES: [] },
    '~/features/anki/anki-connect': { ankiClient: { getModelFields: model => new Promise(resolve => requests.push({ model, resolve })) } },
    '~/features/anki/anki-fields': fieldMappings,
  });
  const { handleModelChange } = useAnkiSettings({ targetLanguage: 'en', ankiModel: 'Old', ankiFieldMap: { Removed: 'word' } }, patch => changes.push(patch));
  const first = handleModelChange('A'), second = handleModelChange('B');
  requests[1].resolve(['Front', 'Back']); await second;
  requests[0].resolve(['Removed']); await first;
  assert.equal(changes.at(-1).ankiModel, 'B');
  assert.deepEqual(clone(changes.at(-1).ankiFieldMap), { Front: 'frontHtml', Back: 'backHtml' });
});
