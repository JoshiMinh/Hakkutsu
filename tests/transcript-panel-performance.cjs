const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(file, globals = {}, imports = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, console, Error, Map, Set, URL, ...globals, require: name => {
    if (name in imports) return imports[name];
    if (name === 'react') return { ...React, default: React };
    if (name === 'react/jsx-runtime' || name === 'lucide-react') return require(name);
    throw new Error(`Unexpected import ${name}`);
  } });
  return exports;
}
class Events {
  listeners = new Map();
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  dispatchEvent(event) { for (const fn of this.listeners.get(event.type) || []) fn(event); }
}
class CustomEvent { constructor(type, { detail } = {}) { this.type = type; this.detail = detail; } }
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function hookHarness() {
  const slots = [];
  let index = 0;
  let effects = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = { ...React, default: React, memo: fn => fn,
    useState(initial) { const i = index++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => slots[i] = typeof value === 'function' ? value(slots[i]) : value]; },
    useRef(initial) { const i = index++; return slots[i] ||= { current: initial }; },
    useMemo(fn, deps) { const i = index++; if (!same(slots[i]?.deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value; },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const i = index++; if (!same(slots[i]?.deps, deps)) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
  };
  return { react, render(fn) { index = 0; effects = []; const tree = fn(); for (const effect of effects) effect(); return tree; }, cleanup() { for (const slot of slots) slot?.cleanup?.(); } };
}
function find(node, predicate) {
  if (!React.isValidElement(node)) return null;
  if (predicate(node)) return node;
  for (const child of React.Children.toArray(node.props.children)) { const result = find(child, predicate); if (result) return result; }
  return null;
}

test('OCR dialog scopes text and images by region, rejects stale analysis, and restores focus', async () => {
  const hooks = hookHarness();
  const window = Object.assign(new Events(), { innerWidth: 800, innerHeight: 700, location: { href: 'https://manga.test' } });
  const document = Object.assign(new Events(), { querySelector: () => null, getElementById: () => null, activeElement: null });
  const requests = [];
  let restored = 0;
  const trigger = { isConnected: true, focus: () => restored++ };
  const { default: Dictionary } = load('src/contents/inline-dictionary.tsx', {
    window, document, CustomEvent, setTimeout, clearTimeout,
    browser: { runtime: { getURL: value => value } },
    chrome: { runtime: { onMessage: { addListener() {}, removeListener() {} } } },
  }, {
    react: hooks.react,
    '~lib/utils/japanese': { containsJapanese: () => true },
    '~components/definition-card': { DefinitionCard: 'definition' },
    '~components/token-display': { TokenDisplay: 'tokens' }, '~components/grammar-explanations': {},
    '~components/manga-ocr-images': { MangaOcrImages: 'ocr' },
    '~lib/utils/settings': { useSettingsStore: () => ({ settings: { ankiEnabled: false, targetLanguage: 'en' }, isHydrated: true }) },
    '~lib/locales': { useTranslation: () => ({ t: key => key, lang: 'en' }) },
    '~lib/services/lookup-analysis': { requestLookupAnalysis: (...args) => new Promise(resolve => requests.push({ args, resolve })) },
  });
  const render = () => hooks.render(() => Dictionary({}));
  const open = (id, text) => window.dispatchEvent(new CustomEvent('hakkutsu:analyze', { detail: {
    text, ocrRegionId: id, imageUrl: `${id}-crop`, returnFocus: trigger, mode: 'dictionary', transient: false, pauseVideo: false,
  } }));
  render();
  open('first', '日本語。');
  let tree = render();
  assert.ok(find(tree, node => node.props.role === 'dialog'));
  assert.equal(find(tree, node => node.props.lang === 'ja').props.children, '日本語。');
  assert.equal(requests[0].args[1], '日本語。');
  open('second', '日本語。'); // Same text in a different bubble must open anew.
  tree = render();
  assert.equal(requests.length, 2);
  requests[0].resolve({ type: 'ANALYZE_RESULT', payload: { text: '日本語。', tokens: [], translation: 'stale' } });
  await flush();
  assert.equal(find(render(), node => node.props.children === 'stale'), null);
  requests[1].resolve({ type: 'ERROR', payload: { error: 'Offline' } });
  await flush();
  tree = render();
  assert.equal(find(tree, node => node.props.lang === 'ja').props.children, '日本語。');
  assert.equal(find(tree, node => node.props.className === 'hk-error-box').props.children, 'Offline');
  document.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {}, stopPropagation() {} });
  assert.equal(find(render(), node => node.props.role === 'dialog'), null);
  assert.equal(restored, 1);
  open('third', '別の台詞'); render();
  document.dispatchEvent({ type: 'mousedown', composedPath: () => [] });
  assert.equal(find(render(), node => node.props.role === 'dialog'), null);
  assert.equal(restored, 2);
  hooks.cleanup();
});

test('manga overlays group text, open only on activation, crop attachments and follow image layout', async () => {
  const hooks = hookHarness();
  const events = [];
  const window = Object.assign(new Events(), { innerWidth: 800, innerHeight: 700, devicePixelRatio: 2 });
  window.addEventListener('hakkutsu:analyze', event => events.push(event.detail));
  let rect = { left: 100, top: 100, right: 300, bottom: 300, width: 200, height: 200 };
  class Image {
    naturalWidth = 200; naturalHeight = 200; currentSrc = 'manga.png'; isConnected = true;
    decode() { return Promise.resolve(); }
    getBoundingClientRect() { return rect; }
  }
  const image = new Image();
  const crops = [];
  const document = Object.assign(new Events(), { createElement: () => {
    const canvas = { width: 0, height: 0, toDataURL: () => `crop:${canvas.width}x${canvas.height}`,
      getContext: () => ({ fillRect() {}, drawImage: (...args) => { if (args.length === 9) crops.push(args.slice(1)); },
        getImageData: () => ({ width: canvas.width, height: canvas.height, data: new Uint8ClampedArray(canvas.width * canvas.height * 4).fill(255) }),
      }) };
    return canvas;
  } });
  const grouping = load('src/lib/services/ocr-regions.ts', {}, { './ocr-bubbles': load('src/lib/services/ocr-bubbles.ts') });
  let fallback = false;
  const { MangaOcrImages } = load('src/components/manga-ocr-images.tsx', {
    window, document, Image, HTMLImageElement: Image, HTMLElement: Image, CustomEvent,
    requestAnimationFrame: fn => fn(),
    chrome: { runtime: { sendMessage: async message => {
      if (message.type === 'FETCH_IMAGE') return { payload: { dataUrl: fallback ? null : 'original' } };
      if (message.type === 'CAPTURE_SCREENSHOT') return { payload: { dataUrl: 'screenshot' } };
      return { type: 'MANGA_OCR_RESULT', payload: { lines: [
        { text: '今日は', orientation: 'vertical', bbox: { x0: 60, y0: 20, x1: 80, y1: 100 } },
        { text: '晴れです。', orientation: 'vertical', bbox: { x0: 30, y0: 20, x1: 50, y1: 120 } },
      ] } };
    } } },
  }, {
    react: hooks.react,
    '~lib/services/ocr-regions': grouping,
    '~lib/services/image-cropper': { applyMangaPreprocess() {}, cropViewportBox: async () => 'visible-crop' },
    '~lib/utils/settings': { useSettingsStore: () => ({ settings: {} }) },
    '~lib/locales': { useTranslation: () => ({ t: key => key }) },
  });
  const render = () => hooks.render(MangaOcrImages);
  render();
  document.dispatchEvent({ type: 'mousemove', target: image });
  find(render(), node => node.props['aria-label'] === 'ocr_btn_trigger').props.onClick();
  await flush();
  let region = find(render(), node => node.props.className === 'hk-manga-region');
  assert.ok(region);
  assert.equal(region.props['aria-label'], '今日は晴れです。');
  assert.equal(region.props.onMouseEnter, undefined);
  assert.equal(region.props.onFocus, undefined);
  assert.equal(events.length, 0);
  region.props.onClick({ currentTarget: image });
  assert.equal(events[0].text, '今日は晴れです。');
  assert.equal(events[0].imageUrl, 'crop:58x108');
  assert.deepEqual(crops[0], [26, 16, 58, 108, 0, 0, 58, 108]);
  const initialLeft = region.props.style.left;
  rect = { left: 50, top: 0, right: 450, bottom: 400, width: 400, height: 400 };
  window.dispatchEvent({ type: 'resize' });
  region = find(render(), node => node.props.className === 'hk-manga-region');
  assert.equal(region.props.style.left, 50 + (initialLeft - 100) * 2);
  // Screenshot fallback recognizes only the visible portion of a clipped image.
  fallback = true;
  rect = { left: -100, top: -100, right: 300, bottom: 300, width: 400, height: 400 };
  find(render(), node => node.props['aria-label'] === 'ocr_btn_trigger').props.onClick();
  await flush();
  region = find(render(), node => node.props.className === 'hk-manga-region');
  assert.equal(region.props.style.left, 39);
  assert.equal(region.props.style.top, 24);
  assert.equal(events.length, 1);
  hooks.cleanup();
});

test('large transcripts mount only a bounded window of rows', () => {
  const layout = load('src/lib/services/transcript-layout.ts');
  const hooks = load('src/lib/services/use-transcript-window.ts', {}, { './transcript-layout': layout,
    react: { ...React, useLayoutEffect() {} },
  });
  const parsers = load('src/lib/services/subtitle-parsers.ts');
  const japanese = load('src/lib/utils/japanese.ts', {}, { './constants': load('src/lib/utils/constants.ts') });
  const settings = {};
  const imports = {
    '~lib/services/use-transcript-window': hooks,
    '~lib/services/transcript-readings': { requestTranscriptReadings: async () => [] },
    '~lib/services/subtitle-parsers': parsers,
    '~lib/utils/japanese': japanese,
    '~lib/utils/jlpt-classifier': { predictJlpt: () => null },
    '~lib/utils/settings': { useSettingsStore: () => ({ settings, updateSettings() {} }) },
    '~lib/locales': { useTranslation: () => ({ t: key => key, lang: 'en' }) },
  };
  const { SubtitleScriptDrawer } = load('src/components/subtitle-script-drawer.tsx', {
    window: { innerWidth: 360, location: { href: 'extension://sidepanel' } },
  }, imports);
  const segments = Array.from({ length: 2000 }, (_, i) => ({ start: i * 3, duration: 2, text: '日本語を勉強します。' }));
  const html = renderToStaticMarkup(React.createElement(SubtitleScriptDrawer, { isOpen: true, nativePanel: true, onClose() {}, subtitleData: { segments }, currentSegment: segments[0] }));
  const count = (html.match(/id="hk-script-cue-/g) || []).length;
  assert.ok(count > 0 && count < 20, `mounted ${count} of 2000 rows`);
  assert.match(html, /2000/);
});

test('virtual windows cover variable-height rows at the start, middle and end', () => {
  const { transcriptOffsets, transcriptWindow } = load('src/lib/services/transcript-layout.ts');
  const heights = Array.from({ length: 2000 }, (_, i) => i % 3 === 0 ? 200 : 80);
  const offsets = transcriptOffsets(heights);
  for (const top of [0, 40000, offsets.at(-1) - 600]) {
    const window = transcriptWindow(offsets, top, 600);
    assert.ok(window.end - window.start < 25);
    assert.ok(offsets[window.start] <= top);
    assert.ok(offsets[window.end] >= top + 600);
    assert.equal(window.before + heights.slice(window.start, window.end).reduce((a, b) => a + b, 0) + window.after, offsets.at(-1));
  }
});

test('transcript readings queue is bounded, shares repeated cues and avoids definition requests', async () => {
  const requests = [];
  const { requestTranscriptReadings } = load('src/lib/services/transcript-readings.ts', { chrome: { runtime: {
    sendMessage: message => new Promise(resolve => requests.push({ message, resolve })),
  } } });
  const first = requestTranscriptReadings('建物', 'en');
  const repeated = requestTranscriptReadings('建物', 'en');
  const second = requestTranscriptReadings('最後', 'en');
  const third = requestTranscriptReadings('日本語', 'en');
  assert.equal(first, repeated);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].message.payload.include_definitions, false);
  const respond = (request, reading) => request.resolve({ type: 'ANALYZE_RESULT', payload: { tokens: [{ surface: request.message.payload.text, reading: { hiragana: reading } }] } });
  respond(requests[0], 'たてもの');
  await first;
  await flush();
  assert.equal(requests.length, 3);
  respond(requests[1], 'さいご');
  respond(requests[2], 'にほんご');
  await Promise.all([second, third]);
  const cached = await requestTranscriptReadings('建物', 'en');
  assert.equal(cached[0].reading.hiragana, 'たてもの');
  assert.equal(requests.length, 3);
});

test('mounted transcript rows display ruby after readings arrive and honor the furigana toggle', async () => {
  const parent = hookHarness();
  const child = hookHarness();
  let currentHooks = parent;
  const react = { ...React, default: React, memo: fn => fn };
  for (const name of ['useState', 'useRef', 'useMemo', 'useCallback', 'useEffect']) react[name] = (...args) => currentHooks.react[name](...args);
  let resolve;
  const settings = { showFurigana: true };
  const { SubtitleScriptDrawer } = load('src/components/subtitle-script-drawer.tsx', {
    window: Object.assign(new Events(), { innerWidth: 360, location: { href: 'extension://sidepanel' }, setTimeout() {}, clearTimeout() {} }),
    document: { querySelector: () => null },
  }, {
    react,
    '~lib/services/use-transcript-window': { useTranscriptWindow: () => ({ start: 0, end: 1, before: 0, after: 0, scrollToRow() {} }) },
    '~lib/services/transcript-readings': { requestTranscriptReadings: () => new Promise(done => resolve = done) },
    '~lib/services/subtitle-parsers': load('src/lib/services/subtitle-parsers.ts'),
    '~lib/utils/japanese': load('src/lib/utils/japanese.ts', {}, { './constants': load('src/lib/utils/constants.ts') }),
    '~lib/utils/jlpt-classifier': { predictJlpt: () => null },
    '~lib/utils/settings': { useSettingsStore: () => ({ settings, updateSettings() {} }) },
    '~lib/locales': { useTranslation: () => ({ t: key => key, lang: 'en' }) },
  });
  const cue = { text: '建物', start: 0, duration: 2 };
  const tree = parent.render(() => SubtitleScriptDrawer({ isOpen: true, onClose() {}, subtitleData: { segments: [cue] }, currentSegment: cue }));
  const row = find(tree, node => node.props.cue === cue);
  currentHooks = child;
  const render = () => child.render(() => (typeof row.type === 'function' ? row.type : row.type.type)(row.props));
  assert.doesNotMatch(renderToStaticMarkup(render()), /<rt/);
  resolve([{ surface: '建物', dictionary_form: '建物', reading: { hiragana: 'たてもの' }, is_japanese: true, definitions: [] }]);
  await flush();
  assert.match(renderToStaticMarkup(render()), /<rt[^>]*>たてもの<\/rt>/);
  settings.showFurigana = false;
  assert.doesNotMatch(renderToStaticMarkup(render()), /<rt/);
  child.cleanup(); parent.cleanup();
});

test('repeated lookup requests share work and cache results separately by language', async () => {
  const requests = [];
  const { requestLookupAnalysis } = load('src/lib/services/lookup-analysis.ts', { chrome: { runtime: { sendMessage: message => new Promise(resolve => requests.push({ message, resolve })) } } });
  const first = requestLookupAnalysis('ANALYZE_JAVI', '最後', true, 'en');
  const second = requestLookupAnalysis('ANALYZE_JAVI', '最後', true, 'en');
  assert.equal(requests.length, 1);
  requests[0].resolve({ type: 'ANALYZE_RESULT', payload: { text: '最後', tokens: [] } });
  await Promise.all([first, second]);
  await requestLookupAnalysis('ANALYZE_JAVI', '最後', true, 'en');
  assert.equal(requests.length, 1);
  const otherLanguage = requestLookupAnalysis('ANALYZE_JAVI', '最後', true, 'vi');
  assert.equal(requests.length, 2);
  requests[1].resolve({ type: 'ERROR', payload: { error: 'temporary failure' } });
  await otherLanguage;
  const retry = requestLookupAnalysis('ANALYZE_JAVI', '最後', true, 'vi');
  assert.equal(requests.length, 3);
  requests[2].resolve({ type: 'ANALYZE_RESULT', payload: { text: '最後', tokens: [] } });
  await retry;
});

test('manual duplicate cues collapse while later repetitions remain separate', () => {
  const { buildSmartCues } = load('src/lib/services/smart-cue.ts');
  const cues = [{ start: 0, duration: 1, text: '最後です。' }, { start: 0, duration: 2, text: '最後です。' }, { start: 10, duration: 1, text: '最後です。' }];
  for (const auto of [false, true]) {
    const result = buildSmartCues(cues, auto);
    assert.equal(result.length, 2);
    assert.equal(result[0].duration, 2);
    assert.equal(result[1].start, 10);
  }
});

test('equal cloned snapshots preserve track identity, but source and content changes reset it', () => {
  const { mergeTranscriptSnapshot } = load('src/lib/services/transcript-state.ts');
  const previous = { sourceUrl: 'https://youtube.com/watch?v=1', subtitleData: { language: 'ja', trackName: 'Japanese', segments: [{ start: 0, duration: 2, text: '日本語' }] } };
  const clone = JSON.parse(JSON.stringify(previous));
  clone.loading = false;
  const merged = mergeTranscriptSnapshot(previous, clone);
  assert.equal(merged.subtitleData, previous.subtitleData);
  clone.subtitleData.segments[0].text = '更新';
  assert.equal(mergeTranscriptSnapshot(previous, clone).subtitleData, clone.subtitleData);
  const nextVideo = { ...previous, sourceUrl: 'https://youtube.com/watch?v=2' };
  assert.equal(mergeTranscriptSnapshot(previous, nextVideo), nextVideo);
});

test('lookup pauses auto-scroll, Escape leaves the sidebar open, and older TTS requests cannot play', async () => {
  const hooks = hookHarness();
  const window = new Events();
  Object.assign(window, { innerWidth: 360, location: { href: 'extension://sidepanel' }, setTimeout: () => 1, clearTimeout() {} });
  let lookupOpen = false;
  const document = { querySelector: () => lookupOpen ? {} : null };
  const scrolls = [];
  const scrollToRow = index => scrolls.push(index);
  const requests = [];
  const played = [];
  class Audio { constructor(url) { this.url = url; } play() { played.push(this.url); return Promise.resolve(); } pause() {} }
  const { SubtitleScriptDrawer } = load('src/components/subtitle-script-drawer.tsx', {
    window, document, CustomEvent, Audio,
    chrome: { runtime: { sendMessage: message => new Promise(resolve => requests.push({ message, resolve })) } },
  }, {
    react: hooks.react,
    '~lib/services/transcript-readings': { requestTranscriptReadings: async () => [] },
    '~lib/services/use-transcript-window': { useTranscriptWindow: () => ({ start: 0, end: 3, before: 0, after: 0, scrollToRow }) },
    '~lib/services/subtitle-parsers': load('src/lib/services/subtitle-parsers.ts'),
    '~lib/utils/japanese': {}, '~lib/utils/jlpt-classifier': {},
    '~lib/utils/settings': { useSettingsStore: () => ({ settings: {}, updateSettings() {} }) },
    '~lib/locales': { useTranslation: () => ({ t: key => key, lang: 'en' }) },
  });
  const segments = [0, 3, 6].map(start => ({ start, duration: 2, text: String(start) }));
  let closed = 0;
  const props = { isOpen: true, nativePanel: true, onClose: () => closed++, subtitleData: { segments }, currentSegment: segments[0] };
  const render = () => hooks.render(() => SubtitleScriptDrawer(props));
  let tree = render();
  assert.equal(scrolls.at(-1), 0);
  lookupOpen = true;
  window.dispatchEvent(new CustomEvent('hakkutsu:analysis-opened'));
  props.currentSegment = segments[1];
  tree = render();
  assert.equal(scrolls.at(-1), 0);
  window.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert.equal(closed, 0);
  const row = find(tree, node => node.props.cue === segments[0]);
  const first = row.props.handlePlayTts('first', 0);
  const second = row.props.handlePlayTts('second', 1);
  requests[1].resolve({ payload: { dataUrl: 'second-audio' } });
  await second;
  requests[0].resolve({ payload: { dataUrl: 'first-audio' } });
  await first;
  assert.deepEqual(played, ['second-audio']);
  lookupOpen = false;
  window.dispatchEvent(new CustomEvent('hakkutsu:analysis-closed'));
  render();
  assert.equal(scrolls.at(-1), 1);
  hooks.cleanup();
});

test('sidebar source does not resend entire tracks while closed or unchanged cues while open', () => {
  const hooks = hookHarness();
  const listeners = new Set();
  const messages = [];
  const chrome = { runtime: { onMessage: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) }, sendMessage: message => { messages.push(message); return Promise.resolve(); } } };
  const { useTranscriptSource } = load('src/lib/services/transcript-panel.ts', { chrome }, { react: hooks.react });
  let snapshot = { sourceUrl: 'https://youtube.com/watch?v=1', subtitleData: null, offset: 0, videoTitle: 'Video', currentSegment: null };
  const render = () => hooks.render(() => useTranscriptSource(snapshot, () => {}));
  render();
  snapshot = { ...snapshot, subtitleData: { segments: [{ text: '日本語', start: 1, duration: 3 }] } };
  render();
  assert.equal(messages.filter(m => m.type === 'TRANSCRIPT_SNAPSHOT').length, 1);
  for (const listener of listeners) listener({ type: 'GET_TRANSCRIPT' }, {}, () => {});
  for (let i = 0; i < 100; i++) { snapshot = { ...snapshot, currentSegment: { text: '日本語', start: 1, duration: 3 } }; render(); }
  assert.equal(messages.filter(m => m.type === 'TRANSCRIPT_CUE').length, 1);
  hooks.cleanup();
  assert.equal(listeners.size, 0);
});

test('sidebar hover debounce and dismissal cancel stale lookup results and timers', async () => {
  const hooks = hookHarness();
  const window = new Events();
  Object.assign(window, { innerWidth: 320, innerHeight: 700, location: { href: 'extension://sidepanel' } });
  const document = new Events();
  Object.assign(document, { querySelector: () => null, getElementById: () => null, activeElement: null });
  const timers = new Map();
  let id = 0;
  const setTimeout = (fn, delay) => { timers.set(++id, { fn, delay }); return id; };
  const clearTimeout = id => timers.delete(id);
  const tick = () => { const waiting = [...timers.values()]; timers.clear(); for (const timer of waiting) timer.fn(); };
  const requests = [];
  const { default: Dictionary } = load('src/contents/inline-dictionary.tsx', { window, document, CustomEvent, setTimeout, clearTimeout,
    browser: { runtime: { getURL: value => value } },
    chrome: { runtime: { onMessage: { addListener() {}, removeListener() {} } } },
  }, {
    react: hooks.react,
    '~lib/utils/japanese': { containsJapanese: () => true },
    '~components/definition-card': { DefinitionCard: 'definition' },
    '~components/token-display': {}, '~components/grammar-explanations': {}, '~components/manga-ocr-images': { MangaOcrImages: 'ocr' },
    '~lib/utils/settings': { useSettingsStore: () => ({ settings: { ankiEnabled: false, targetLanguage: 'en' }, isHydrated: true }) },
    '~lib/locales': { useTranslation: () => ({ t: key => key, lang: 'en' }) },
    '~lib/services/lookup-analysis': { requestLookupAnalysis: (...args) => new Promise(resolve => requests.push({ args, resolve })) },
  });
  const render = () => hooks.render(() => Dictionary({ nativePanel: true }));
  const analyze = text => window.dispatchEvent(new CustomEvent('hakkutsu:analyze', { detail: { text, mode: 'dictionary', transient: true, pauseVideo: false } }));
  let tree = render();
  assert.equal(find(tree, node => node.type === 'ocr'), null);
  analyze('最後');
  analyze('日本語');
  assert.equal(requests.length, 0);
  assert.equal(timers.size, 1);
  tick();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].args[1], '日本語');
  tree = render();
  const popup = find(tree, node => node.props.className?.includes('hk-lookup--panel'));
  assert.ok(popup);
  assert.equal(popup.props.style, undefined);
  const close = find(popup, node => node.type === 'button');
  close.props.onClick();
  requests[0].resolve({ type: 'ANALYZE_RESULT', payload: { text: '日本語', tokens: [] } });
  await flush();
  assert.equal(find(render(), node => node.props.className?.includes('hk-lookup--panel')), null);
  analyze('最後');
  hooks.cleanup();
  assert.equal(timers.size, 0);
  tick();
  assert.equal(requests.length, 1);
});

test('lookup requests from the transcript create a draggable popup on the source page', () => {
  const hooks = hookHarness();
  const listeners = new Set();
  const messages = [];
  const window = Object.assign(new Events(), { innerWidth: 640, innerHeight: 700, location: { href: 'https://youtube.com/watch?v=1' } });
  const document = Object.assign(new Events(), { querySelector: () => null, getElementById: () => null, activeElement: null });
  const { default: Dictionary } = load('src/contents/inline-dictionary.tsx', {
    window, document, CustomEvent, setTimeout: () => 1, clearTimeout() {},
    browser: { runtime: { getURL: value => value } },
    chrome: { runtime: { onMessage: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) },
      sendMessage: message => { messages.push(message); return Promise.resolve(); } } },
  }, {
    react: hooks.react,
    '~lib/utils/japanese': { containsJapanese: () => true },
    '~components/definition-card': { DefinitionCard: 'definition' },
    '~components/token-display': {}, '~components/grammar-explanations': {}, '~components/manga-ocr-images': { MangaOcrImages: 'ocr' },
    '~lib/utils/settings': { useSettingsStore: () => ({ settings: { ankiEnabled: false, mangaOcrEnabled: false, targetLanguage: 'en' }, isHydrated: true }) },
    '~lib/locales': { useTranslation: () => ({ t: key => key, lang: 'en' }) },
    '~lib/services/lookup-analysis': { requestLookupAnalysis: () => new Promise(() => {}) },
  });
  const render = () => hooks.render(() => Dictionary({}));
  render();
  for (const listener of listeners) listener({ type: 'LOOKUP_TRANSCRIPT', payload: { text: '建物', transient: false } }, {}, () => {});
  let popup = find(render(), node => node.props.className?.includes('hk-lookup'));
  assert.equal(popup.props.style.position, 'fixed');
  assert.ok(!popup.props.className.includes('hk-lookup--panel'));
  assert.equal(messages.at(-1).payload.open, true);
  popup.ref.current = { getBoundingClientRect: () => ({ left: 200, top: 146, width: 420, height: 260 }) };
  const header = find(popup, node => node.type === 'header');
  header.props.onPointerDown({ button: 0, pointerId: 1, clientX: 250, clientY: 200, target: { closest: () => null }, currentTarget: { setPointerCapture() {} }, preventDefault() {} });
  header.props.onPointerMove({ clientX: 150, clientY: 240 });
  popup = find(render(), node => node.props.className?.includes('hk-lookup'));
  assert.equal(popup.props.style.left, '100px');
  assert.equal(popup.props.style.top, '186px');
  for (const listener of listeners) listener({ type: 'CANCEL_TRANSCRIPT_LOOKUP', payload: { force: true } }, {}, () => {});
  assert.equal(find(render(), node => node.props.className?.includes('hk-lookup')), null);
  assert.equal(messages.at(-1).payload.open, false);
  hooks.cleanup();
  assert.equal(listeners.size, 0);
});
