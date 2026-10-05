const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const clone = value => JSON.parse(JSON.stringify(value));

function runtime({ settings = {}, chrome: overrides = {}, imports = {}, globals = {} } = {}) {
  const calls = [], listeners = [], modules = new Map();
  const chrome = {
    runtime: {
      onMessage: { addListener: listener => listeners.push(listener) },
      getURL: file => `chrome-extension://test/${file}`,
      sendMessage: async message => { calls.push(['send', clone(message)]); return { type: 'MANGA_OCR_RESULT', payload: { text: '日本語' } }; },
    },
    tabs: { create: options => calls.push(['open', options]) },
    ...overrides,
  };
  const mocks = {
    '~/features/settings/settings-storage': { getSettings: async () => settings },
    '~/features/subtitles/shared/transcript-panel-router': { installTranscriptPanelRouter: () => tab => calls.push(['close', tab]) },
    '~/features/dictionary/api-client': { apiClient: { analyzePhrase: async payload => ({ text: payload.text, tokens: [] }) } },
    '~/features/dictionary/local-tokenizer': {}, '~/features/dictionary/local-lookup': {},
    '~/features/dictionary/dictionary-lookup': {}, '~/features/dictionary/google-translate': {},
    '~/shared/japanese/hanviet-dict': {}, '~/shared/japanese/jlpt-classifier': {},
    '~/features/dictionary/irasutoya-service': { fetchIrasutoyaImagesDirect: async (...args) => { calls.push(['illustration', ...args]); return ['picture']; } },
    '~/features/anki/anki-connect': { ankiClient: {
      exportVocabulary: async (...args) => { calls.push(['anki', ...args]); return 42; }, isConnected: async () => true,
    } },
    '~/features/srs/local-srs': { localSrs: {
      addSrsCard: async payload => { calls.push(['card', payload]); return { id: 'saved', ...payload }; },
      getCardByWord: async word => ({ id: word }), deleteSrsCardByWord: async () => true,
      resetLeechStatus: async id => ({ id, is_leech: false }),
      getAvailableSmartDeckFilters: async () => ({ tags: [] }), getAllSrsCards: async () => [{ id: 'saved' }],
    } },
    '~/features/analytics/analytics-service': { analyticsService: {
      recordCharactersRead: async count => calls.push(['characters', count]),
      recordVideoImmersion: async seconds => calls.push(['seconds', seconds]),
      getOverallAnalytics: async () => ({ totalCharactersRead: 12 }),
    } },
    ...imports,
  };
  function load(file) {
    file = path.resolve(file);
    if (modules.has(file)) return modules.get(file);
    const exports = {};
    modules.set(file, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, {
      exports, chrome, console: { warn() {} }, Error, URL, Blob, AbortController, setTimeout, clearTimeout,
      btoa: value => Buffer.from(value, 'binary').toString('base64'),
      defineBackground: fn => fn(), ...globals,
      require: name => {
        if (name in mocks) return mocks[name];
        if (name.startsWith('~/')) return load(`src/${name.slice(2)}.ts`);
        if (name.startsWith('./')) return load(path.join(path.dirname(file), `${name}.ts`));
        throw Error(`Unexpected background dependency: ${name}`);
      },
    }, { filename: file });
    return exports;
  }
  const background = load('src/app/background.ts');
  load('src/entrypoints/background.ts');
  return { ...background, chrome, calls, listeners, load, request: (message, sender = {}) => new Promise(resolve => {
    assert.equal(listeners[0](message, sender, resolve), true);
  }) };
}

test('sidebar opening retains the user gesture and background does not answer offscreen or transcript broadcasts', async () => {
  let opened = false, finish;
  const r = runtime({ chrome: { sidePanel: { open: ({ tabId }) => { assert.equal(tabId, 8); opened = true; return new Promise(resolve => finish = resolve); } } } });
  const replies = [];
  assert.equal(r.listeners[0]({ type: 'OPEN_TRANSCRIPT_PANEL' }, { tab: { id: 8 } }, result => replies.push(result)), true);
  assert.equal(opened, true);
  assert.equal(replies.length, 0);
  finish(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(clone(replies), [{ ok: true }]);
  for (const type of ['RUN_MANGA_OCR_OFFSCREEN', 'RUN_MANGA_OCR_BATCH_OFFSCREEN', 'TRANSCRIPT_SNAPSHOT', 'TRANSCRIPT_CUE', 'TRANSCRIPT_UNAVAILABLE', 'TRANSCRIPT_LOOKUP_STATE']) {
    assert.equal(r.listeners[0]({ type }, {}, () => assert.fail('Broadcast acquired a second responder')), false);
  }
  assert.equal(r.listeners[0]({ type: 'CLOSE_TRANSCRIPT_PANEL' }, { tab: { id: 8 } }, () => {}), false);
  assert.deepEqual(r.calls, [['close', 8]]);
});

test('generic overlay mounting preserves frame IDs for Chrome and Firefox fallbacks', async () => {
  for (const scripting of [true, false]) {
    const executions = [];
    const r = runtime({ chrome: scripting ? { scripting: { executeScript: async options => executions.push(clone(options)) } }
      : { tabs: { executeScript: async (...args) => executions.push(clone(args)) } } });
    const result = await r.request({ type: 'MOUNT_GENERIC_SUBTITLES' }, { tab: { id: 7 }, frameId: 3 });
    assert.deepEqual(clone(result), { type: 'IGNORED', payload: { mounted: true } });
    assert.deepEqual(executions, scripting ? [{ target: { tabId: 7, frameIds: [3] }, files: ['content-scripts/generic-subtitles.js'] }]
      : [[7, { file: '/content-scripts/generic-subtitles.js', frameId: 3 }]]);
    assert.equal((await r.request({ type: 'MOUNT_GENERIC_SUBTITLES' })).type, 'ERROR');
  }
});

test('dictionary, settings, Anki, SRS and analytics retain their wire contracts', async () => {
  const settings = { ankiDeck: 'deck', ankiModel: 'model', ankiFieldMap: { Front: 'word' } }, data = { word: '日本', sentence: '日本語' };
  const r = runtime({ settings });
  assert.deepEqual(clone(await r.request({ type: 'GET_SETTINGS' })), { type: 'GET_SETTINGS', payload: settings });
  assert.equal((await r.request({ type: 'ANALYZE_PHRASE', payload: { text: '日本語' } })).type, 'ANALYZE_PHRASE_RESULT');
  assert.deepEqual(clone(await r.request({ type: 'EXPORT_ANKI', payload: data })), { type: 'ANKI_RESULT', payload: { noteId: 42 } });
  assert.deepEqual(r.calls[0], ['anki', data, 'deck', 'model', settings.ankiFieldMap]);
  assert.equal((await r.request({ type: 'CHECK_ANKI' })).payload.connected, true);
  assert.equal((await r.request({ type: 'ADD_SRS_CARD', payload: data })).payload.id, 'saved');
  assert.equal((await r.request({ type: 'CHECK_CARD_EXISTS', payload: { word: '日本' } })).payload.card.id, '日本');
  assert.equal((await r.request({ type: 'REMOVE_SRS_CARD', payload: { word: '日本' } })).payload.success, true);
  assert.equal((await r.request({ type: 'RESET_LEECH_STATUS', payload: { cardId: 'saved' } })).payload.is_leech, false);
  assert.equal((await r.request({ type: 'GET_SMART_DECK_FILTERS' })).type, 'SMART_DECK_FILTERS_RESULT');
  assert.equal((await r.request({ type: 'GET_ALL_SRS_CARDS' })).payload.cards[0].id, 'saved');
  await r.request({ type: 'TRACK_CHARACTERS_READ' }); await r.request({ type: 'TRACK_VIDEO_IMMERSION', payload: { seconds: 9 } });
  assert.deepEqual(r.calls.slice(-2), [['characters', 0], ['seconds', 9]]);
  assert.equal((await r.request({ type: 'GET_IMMERSION_ANALYTICS' })).payload.totalCharactersRead, 12);
  assert.deepEqual(clone(await r.request({ type: 'UNKNOWN' })), { type: 'ERROR', payload: { error: 'Unknown message type: UNKNOWN' } });
  assert.equal((await r.request({ type: 'OPEN_APP' })).type, 'OPEN_APP_RESULT');
  assert.deepEqual(clone(r.calls.at(-1)), ['open', { url: 'chrome-extension://test/options.html' }]);
});

test('image routing retains dictionary query precedence, OCR binary URLs and error responses', async () => {
  const fetched = [];
  const r = runtime({ globals: { fetch: async url => { fetched.push(url); return { ok: true, blob: async () => new Blob(['abc'], { type: 'image/png' }) }; } } });
  assert.deepEqual(clone(await r.request({ type: 'FETCH_IMAGE', payload: { query: '猫', url: 'ignored', targetLang: 'en', meaning: 'cat' } })), { type: 'FETCH_IMAGE_RESULT', payload: { images: ['picture'] } });
  assert.equal(fetched.length, 0);
  assert.deepEqual(r.calls, [['illustration', '猫', 'en', 'cat']]);
  assert.equal((await r.request({ type: 'FETCH_IMAGE', payload: { url: 'image' } })).payload.dataUrl, 'data:image/png;base64,YWJj');
  assert.deepEqual(clone(await r.request({ type: 'FETCH_IMAGE' })), { type: 'FETCH_IMAGE_RESULT', payload: { images: [] } });
  const failed = runtime({ globals: { fetch: async () => { throw Error('offline'); } }, imports: {
    '~/features/dictionary/irasutoya-service': { fetchIrasutoyaImagesDirect: async () => { throw Error('offline'); } },
  } });
  assert.deepEqual(clone((await failed.request({ type: 'FETCH_IMAGE', payload: { query: '猫' } })).payload), { images: [] });
  assert.equal((await failed.request({ type: 'FETCH_IMAGE', payload: { url: 'image' } })).payload.error, 'Failed to fetch image: offline');
});

test('OCR retains settings guards, shared offscreen creation and the Firefox Worker fallback', async () => {
  const disabled = runtime({ settings: { mangaOcrEnabled: false } });
  for (const type of ['RUN_MANGA_OCR', 'RUN_MANGA_OCR_BATCH']) assert.equal((await disabled.request({ type })).payload.error, 'Manga OCR is disabled in settings.');
  let created = 0, release;
  const r = runtime();
  r.chrome.runtime.ContextType = { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' };
  r.chrome.runtime.getContexts = (options, done) => { assert.deepEqual(clone(options.documentUrls), ['chrome-extension://test/ocr.html']); done([]); };
  r.chrome.offscreen = { Reason: { WORKERS: 'WORKERS' }, createDocument: options => { created++; assert.equal(options.url, 'ocr.html'); return new Promise(resolve => release = resolve); } };
  const one = r.request({ type: 'RUN_MANGA_OCR', payload: { imageDataUrl: 'data:one' } });
  const two = r.request({ type: 'RUN_MANGA_OCR_BATCH', payload: { crops: [] } });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(created, 1); release(); await Promise.all([one, two]);
  assert.deepEqual(r.calls.map(call => call[1].type), ['RUN_MANGA_OCR_OFFSCREEN', 'RUN_MANGA_OCR_BATCH_OFFSCREEN']);
  assert.equal((await r.request({ type: 'RUN_MANGA_OCR' })).payload.error, 'Missing OCR image');
  const workerCalls = [];
  const firefox = runtime({ globals: { Worker: function Worker() {} }, imports: { '~/features/ocr/ocr-engine': { ocrEngine: {
    recognize: async (...args) => { workerCalls.push(args); return { text: '日本' }; }, recognizeBatch: async crops => crops,
  } } } });
  assert.equal((await firefox.request({ type: 'RUN_MANGA_OCR', payload: { imageDataUrl: 'crop', orientation: 'vertical' } })).payload.text, '日本');
  assert.deepEqual(clone(workerCalls), [['crop', { imageDataUrl: 'crop', orientation: 'vertical' }]]);
  assert.equal((await firefox.request({ type: 'RUN_MANGA_OCR_BATCH', payload: { crops: [] } })).type, 'MANGA_OCR_BATCH_RESULT');
});

test('screenshot, TTS and timedtext proxies preserve sender scope, binary formats and network errors', async () => {
  const captures = [], fetched = [];
  const r = runtime({ chrome: { tabs: { captureVisibleTab: (...args) => { captures.push(args.slice(0, -1)); args.at(-1)('screenshot'); } } }, globals: {
    fetch: async (url, options) => { fetched.push([url, options]); return { ok: true, arrayBuffer: async () => Uint8Array.from([65, 66]).buffer, text: async () => 'captions' }; },
  } });
  assert.equal((await r.request({ type: 'CAPTURE_SCREENSHOT' }, { tab: { windowId: 4 } })).payload.dataUrl, 'screenshot');
  await r.request({ type: 'CAPTURE_SCREENSHOT' });
  assert.deepEqual(clone(captures), [[4, { format: 'png' }], [{ format: 'png' }]]);
  assert.equal((await r.request({ type: 'FETCH_TTS_AUDIO', payload: { text: '  ' + 'あ'.repeat(205), lang: 'ja' } })).payload.dataUrl, 'data:audio/mpeg;base64,QUI=');
  assert.equal(new URL(fetched[0][0]).searchParams.get('q').length, 200);
  assert.equal((await r.request({ type: 'FETCH_TIMEDTEXT_URL', payload: { url: 'captions' } })).payload.text, 'captions');
  assert.equal(fetched[1][1].credentials, 'include');
  const failed = runtime({ globals: { fetch: async () => { throw Error('offline'); } } });
  assert.equal((await failed.request({ type: 'FETCH_TTS_AUDIO', payload: { text: '日本' } })).payload.error, 'Failed to fetch TTS audio: offline');
  assert.deepEqual(clone((await failed.request({ type: 'FETCH_TIMEDTEXT_URL', payload: { url: 'captions' } })).payload), { success: false, error: 'offline' });
});

test('the OCR page registers only recognition callbacks and preserves offscreen error formatting', async () => {
  const r = runtime({ imports: { '~/features/ocr/ocr-engine': { ocrEngine: {
    recognize: async () => { throw new TypeError('bad crop'); }, recognizeBatch: async () => [{ text: '日本' }],
  } } } });
  r.load('src/entrypoints/ocr/main.ts');
  const listener = r.listeners[1];
  assert.equal(listener({ type: 'OTHER' }, {}, () => assert.fail()), undefined);
  const result = await new Promise(resolve => assert.equal(listener({ type: 'RUN_MANGA_OCR_OFFSCREEN', payload: {} }, {}, resolve), true));
  assert.equal(result.payload.error, 'TypeError: bad crop');
  const batch = await new Promise(resolve => listener({ type: 'RUN_MANGA_OCR_BATCH_OFFSCREEN', payload: { crops: [] } }, {}, resolve));
  assert.equal(batch.payload[0].text, '日本');
});
