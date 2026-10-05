const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, imports = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, console, ...globals, require: name => imports[name] || require(name) });
  return exports;
}

test('generic player detection waits for a video, requests once, retries a failed mount and cleans up', async () => {
  let video = null, requests = 0, observeCount = 0, disconnectCount = 0, mutation, cleanup;
  const listeners = new Map();
  const document = {
    documentElement: {},
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: (name, listener) => {
      assert.equal(listeners.get(name), listener);
      listeners.delete(name);
    },
  };
  const { registerGenericPlayerDetection } = load('src/features/subtitles/generic/detect-player.ts', {
    '~/features/subtitles/shared/video-runtime': { findPrimaryVideo: () => video },
  }, {
    document,
    MutationObserver: class {
      constructor(callback) { mutation = callback; }
      observe() { observeCount++; }
      disconnect() { disconnectCount++; }
    },
    chrome: { runtime: { sendMessage: async message => {
      assert.equal(message.type, 'MOUNT_GENERIC_SUBTITLES');
      if (++requests === 1) throw Error('Temporarily unavailable');
    } } },
  });
  registerGenericPlayerDetection({ onInvalidated: callback => { cleanup = callback; } });
  mutation();
  assert.equal(requests, 0);
  video = {};
  listeners.get('loadedmetadata')();
  mutation();
  assert.equal(requests, 1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(observeCount, 2);
  mutation();
  mutation();
  assert.equal(requests, 2);
  cleanup();
  assert.equal(disconnectCount, 3);
  assert.equal(listeners.size, 0);
});

test('vocabulary loading fills missing display metadata without changing review state or blocking on writes', async () => {
  const cards = [
    { id: 'book', word: '本', reading: 'ほん', meaning: 'book', due_date: 1234, stability: 8, tags: ['saved'] },
    { id: 'water', word: '水', reading: '', meaning: '—', due_date: 5678, state: 2, image_url: 'data:image/png;base64,saved' },
  ];
  const state = [], writes = [], lookups = [];
  const { useVocabularyCards } = load('src/features/vocabulary/use-vocabulary-cards.ts', {
    react: { useState: initial => {
      const index = state.length;
      state.push(initial);
      return [initial, value => { state[index] = value; }];
    }, useEffect() {} },
    '~/features/srs/local-srs': { localSrs: {
      getAllSrsCards: async () => cards,
      updateSrsCard: (id, patch) => { writes.push({ id, patch }); return Promise.reject(Error('Write denied')); },
    } },
    '~/features/dictionary/dictionary-lookup': { lookupWord: async (word, lang) => {
      lookups.push({ word, lang });
      return { meaning: 'water', reading: 'みず', jlpt: 'N5', frequency_rank: 20 };
    } },
  });
  await useVocabularyCards('user_1', 'en').loadCards();
  assert.deepEqual(lookups, [{ word: '水', lang: 'en' }]);
  assert.equal(state[0][0].word_furigana, '本[ほん]');
  assert.equal(state[0][0].stability, 8);
  assert.equal(state[0][1].reading, 'みず');
  assert.equal(state[0][1].due_date, 5678);
  assert.equal(state[0][1].state, 2);
  assert.equal(state[0][1].image_url, cards[1].image_url);
  assert.equal(cards[1].reading, '', 'Loading must not mutate the saved card objects');
  assert.equal(writes.length, 2);
  assert.equal(state[1], false);
  assert.equal(state[2], null);
});

test('settings storage reads legacy and Zustand values and writes the same persisted envelope', async () => {
  const { DEFAULT_SETTINGS } = load('src/features/settings/types.ts');
  let stored, written;
  const storage = load('src/features/settings/settings-storage.ts', {
    '~/features/settings/types': { DEFAULT_SETTINGS },
  }, { chrome: { storage: { sync: {
    get: async key => ({ [key]: stored }),
    set: async value => { written = value; },
  } } } });
  for (const value of [
    { targetLanguage: 'en', srsEnabled: false },
    JSON.stringify({ targetLanguage: 'en', srsEnabled: false }),
    JSON.stringify({ state: { settings: { targetLanguage: 'en', srsEnabled: false } }, version: 0 }),
  ]) {
    stored = value;
    const settings = await storage.getSettings();
    assert.equal(settings.targetLanguage, 'en');
    assert.equal(settings.srsEnabled, false);
    assert.equal(settings.ankiDeck, DEFAULT_SETTINGS.ankiDeck);
  }
  await storage.saveSettings({ subtitlesOffset: 1.25 });
  assert.deepEqual(Object.keys(written), ['hakkutsu_settings']);
  const saved = JSON.parse(written.hakkutsu_settings);
  assert.equal(saved.version, 0);
  assert.equal(saved.state.settings.targetLanguage, 'en');
  assert.equal(saved.state.settings.srsEnabled, false);
  assert.equal(saved.state.settings.subtitlesOffset, 1.25);
  stored = '{invalid';
  assert.equal(await storage.getSettings(), DEFAULT_SETTINGS);
});
