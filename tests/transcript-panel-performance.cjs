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
  vm.runInNewContext(source, { exports, console, Error, Map, Set, URL, Event, ...globals, require: name => {
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
// These component tests mock recognition and test layout/state, not image
// classification. Real ink and model acceptance live in fixture regressions.
function layoutGrouping() {
  const bubbles = load('src/lib/services/ocr-bubbles.ts');
  return load('src/lib/services/ocr-regions.ts', {}, { './ocr-bubbles': { ...bubbles,
    findTextInkEvidence: fragments => new Map(fragments.map(f => [f, { ratio: 1, ink: 30, components: 3, bbox: f.bbox }])),
  } });
}
function layoutPipeline(grouping) {
  return load('src/lib/services/ocr-pipeline.ts', {}, { './ocr-regions': grouping, './ocr-geometry': load('src/lib/services/ocr-geometry.ts') });
}
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
  assert.equal(find(tree, node => node.props.lang === 'ja').props.value, '日本語。');
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
  assert.equal(find(tree, node => node.props.lang === 'ja').props.value, '日本語。');
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
    set src(value) { queueMicrotask(() => this.onload?.()); }
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
  const grouping = layoutGrouping();
  let fallback = false;
  const { MangaOcrImages } = load('src/components/manga-ocr-images.tsx', {
    window, document, Image, HTMLImageElement: Image, HTMLElement: Image, CustomEvent,
    requestAnimationFrame: fn => fn(), queueMicrotask,
    chrome: { runtime: { sendMessage: async message => {
      if (message.type === 'FETCH_IMAGE') return { payload: { dataUrl: fallback ? null : 'original' } };
      if (message.type === 'CAPTURE_SCREENSHOT') return { payload: { dataUrl: 'screenshot' } };
      return { type: 'MANGA_OCR_RESULT', payload: { lines: [
        { text: '今日は', confidence: 90, orientation: 'vertical', bbox: { x0: 60, y0: 20, x1: 80, y1: 100 } },
        { text: '晴れです。', confidence: 90, orientation: 'vertical', bbox: { x0: 30, y0: 20, x1: 50, y1: 120 } },
      ] } };
    } } },
  }, {
    react: hooks.react,
    '~lib/services/ocr-regions': grouping,
    '~lib/services/ocr-pipeline': layoutPipeline(grouping),
    '~lib/services/ocr-bubbles': load('src/lib/services/ocr-bubbles.ts'),
    '~lib/services/ocr-geometry': load('src/lib/services/ocr-geometry.ts'),
    '~lib/services/image-cropper': load('src/lib/services/image-cropper.ts', { document, Image }, {}),
    '~lib/utils/settings': { useSettingsStore: () => ({ settings: { ocrPreprocessEnabled: false } }) },
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
  assert.ok(crops.some(c => JSON.stringify(c) === JSON.stringify([26, 16, 58, 108, 0, 0, 58, 108])));
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
  assert.equal(region.props.style.left, 45);
  assert.equal(region.props.style.top, 30);
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


test('OCR corrections reject stale analysis, reanalyze edited text and save its original crop', async () => {
  const hooks = hookHarness();
  const window = Object.assign(new Events(), { innerWidth: 800, innerHeight: 700, location: { href: 'https://manga.test' } });
  const document = Object.assign(new Events(), { querySelector: () => null, getElementById: () => null, activeElement: null, title: 'Manga' });
  const requests = [], messages = [], updates = [];
  window.addEventListener('hakkutsu:ocr-region-updated', event => updates.push(event.detail));
  const { default: Dictionary } = load('src/contents/inline-dictionary.tsx', {
    window, document, CustomEvent, setTimeout, clearTimeout,
    browser: { runtime: { getURL: value => value } },
    chrome: { runtime: { onMessage: { addListener() {}, removeListener() {} }, sendMessage: async message => {
      messages.push(message);
      return message.type === 'ADD_SRS_CARD' ? { type: 'SRS_RESULT' } : { type: 'CARD_EXISTS_RESULT', payload: { exists: false } };
    } } },
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
  const save = tree => find(tree, node => node.type === 'button' && node.props.title === 'def_btn_add_library');
  const resolve = (index, text) => requests[index].resolve({ type: 'ANALYZE_RESULT', payload: {
    text, sentence_reading: 'まもれる', translation: 'Can protect', tokens: [{ surface: '守れる', dictionary_form: '守る',
      is_japanese: true, definitions: [{ glosses: ['protect'] }], reading: { hiragana: 'まもれる' }, dictionary_reading: 'まもる' }],
  } });
  render();
  window.dispatchEvent(new CustomEvent('hakkutsu:analyze', { detail: { text: '誤読', ocrRegionId: 'bubble',
    imageUrl: 'original-unfiltered-crop', mode: 'dictionary', transient: false, pauseVideo: false } }));
  assert.equal(requests[0].args[0], 'ANALYZE_PHRASE');
  assert.equal(requests[0].args[2], true);
  assert.equal(requests[0].args[4], 'ocr');
  let tree = render();
  assert.equal(save(tree).props.disabled, true);
  const input = find(tree, node => node.type === 'textarea');
  assert.equal(input.props['aria-label'], 'ocr_edit_hint');
  input.props.onChange({ target: { value: '守れる。' } });
  tree = render();
  resolve(0, '誤読');
  await flush();
  tree = render();
  assert.equal(find(tree, node => node.type === 'tokens'), null);
  assert.equal(save(tree).props.disabled, true);
  find(tree, node => node.type === 'button' && node.props.children === 'ocr_reanalyze').props.onClick();
  assert.equal(requests[1].args[1], '守れる。');
  assert.equal(requests[1].args[0], 'ANALYZE_PHRASE');
  assert.equal(requests[1].args[4], 'ocr');
  assert.equal(updates[0].id, 'bubble');
  assert.equal(updates[0].text, '守れる。');
  resolve(1, '守れる。');
  await flush();
  tree = render();
  assert.equal(save(tree).props.disabled, false);
  await save(tree).props.onClick();
  const added = messages.find(message => message.type === 'ADD_SRS_CARD');
  assert.equal(added.payload.sentence, '守れる。');
  assert.equal(added.payload.word, '守る');
  assert.equal(added.payload.reading, 'まもる');
  assert.equal(added.payload.word_furigana, '守る[まもる]');
  assert.equal(added.payload.image_url, 'original-unfiltered-crop');
  find(tree, node => node.type === 'textarea').props.onChange({ target: { value: '' } });
  tree = render();
  assert.equal(save(tree).props.disabled, true);
  assert.equal(find(tree, node => node.type === 'button' && node.props.children === 'ocr_reanalyze').props.disabled, true);
  hooks.cleanup();
});

function mangaScanHarness({ recover = false, fallback = false, uncertain = false, ambiguous = false, zoom = 1, detectorRegions, cropLines, orientation = 'vertical', trackLayout = false } = {}) {
  const hooks = hookHarness(), requests = [], events = [], crops = [];
  const window = Object.assign(new Events(), { innerWidth: 800, innerHeight: 700, devicePixelRatio: 2 });
  window.addEventListener('hakkutsu:analyze', event => events.push(event.detail));
  let delayed, release;
  const frames = new Map();
  let frameId = 0;
  class Image {
    // Model coordinates use a 400px original rendered at 200 CSS pixels.
    // Screenshot fallback supplies only the visible 200px crop.
    naturalWidth = 400; naturalHeight = 400; currentSrc = 'manga.png'; isConnected = true;
    decode() { if (this.src === 'visible-crop') this.naturalWidth = this.naturalHeight = 200; return Promise.resolve(); }
    getBoundingClientRect() { return this.rect || (fallback
      ? { left: -100, top: -100, right: 300, bottom: 300, width: 400, height: 400 }
      : { left: 100, top: 100, right: 100 + 200 * zoom, bottom: 100 + 200 * zoom, width: 200 * zoom, height: 200 * zoom }); }
  }
  const image = new Image();
  const document = Object.assign(new Events(), { createElement: () => {
    const canvas = { width: 0, height: 0, toDataURL: () => `raw:${canvas.width}x${canvas.height}`,
      getContext: () => ({ fillRect() {}, drawImage: (...args) => crops.push(args.slice(1)),
        getImageData: () => ({ width: canvas.width, height: canvas.height,
          data: new Uint8ClampedArray(canvas.width * canvas.height * 4).fill(255) }),
      }) };
    return canvas;
  } });
  const geometry = load('src/lib/services/ocr-geometry.ts');
  const grouping = layoutGrouping();
  const detector = pixels => detectorRegions || [{ bbox: { x0: 40, y0: 40, x1: 80, y1: 160 }, orientation: 'horizontal', orientationAmbiguous: ambiguous, type: 'text-cluster' },
    ...(pixels.width >= 300 ? [{ bbox: { x0: 280, y0: 40, x1: 320, y1: 160 }, orientation: 'horizontal', orientationAmbiguous: ambiguous, type: 'text-cluster' }] : [])];
  const { MangaOcrImages } = load('src/components/manga-ocr-images.tsx', {
    window, document, Image, HTMLImageElement: Image, HTMLElement: Image, CustomEvent,
    requestAnimationFrame: fn => {
      if (trackLayout && fn.name === 'follow') { frames.set(++frameId, fn); return frameId; }
      fn(); return 0;
    },
    ...(trackLayout ? { cancelAnimationFrame: id => frames.delete(id) } : {}),
    chrome: { runtime: { sendMessage: async message => {
      requests.push(message);
      if (message.type === 'FETCH_IMAGE') return { payload: { dataUrl: fallback ? null : 'original' } };
      if (message.type === 'CAPTURE_SCREENSHOT') return { payload: { dataUrl: 'screenshot' } };
      if (message.type === 'RUN_MANGA_OCR_BATCH') {
        if (delayed) await new Promise(resolve => { release = resolve; });
        return { type: 'MANGA_OCR_BATCH_RESULT', payload: message.payload.crops.map((crop, index) => ({
          id: crop.id, bbox: crop.bbox, transform: crop.transform, text: index ? '別の台詞' : '日本語', confidence: uncertain ? 12 : 90, orientation: 'vertical',
          lines: (cropLines ? cropLines(crop, index) : uncertain ? [] : [{ text: index ? '別の台詞' : '日本語', confidence: 90, orientation: 'vertical',
            bbox: { x0: 10, y0: 10, x1: 30, y1: 110 } }]).map(line => ({ ...line, bbox: {
              // Recognition sees the scaled crop; fixture bounds above use
              // original crop pixels plus the fixed 10px border.
              x0: 10 + (line.bbox.x0 - 10) * crop.transform.scale,
              y0: 10 + (line.bbox.y0 - 10) * crop.transform.scale,
              x1: Math.min(crop.width - 10, 10 + (line.bbox.x1 - 10) * crop.transform.scale),
              y1: Math.min(crop.height - 10, 10 + (line.bbox.y1 - 10) * crop.transform.scale),
            } })),
        })) };
      }
      return { type: 'MANGA_OCR_RESULT', payload: { text: '', orientation: 'vertical', lines: recover ? [{
        text: '回復した台詞', confidence: 90, orientation: 'vertical', bbox: { x0: 160, y0: 40, x1: 180, y1: 140 },
      }] : [] } };
    } } },
  }, {
    react: hooks.react,
    '~lib/services/ocr-regions': grouping, '~lib/services/ocr-geometry': geometry,
    '~lib/services/ocr-pipeline': layoutPipeline(grouping),
    '~lib/services/ocr-bubbles': { detectMangaDialogueRegions: detector },
    '~lib/services/image-cropper': {
      ...load('src/lib/services/image-cropper.ts', { document }), cropViewportBox: async () => 'visible-crop',
    },
    '~lib/utils/settings': { useSettingsStore: () => ({ settings: { ocrPreprocessEnabled: false, ocrDefaultOrientation: orientation } }) },
    '~lib/locales': { useTranslation: () => ({ t: key => key }) },
  });
  const render = () => hooks.render(MangaOcrImages);
  const regions = () => {
    const found = [];
    const visit = node => { if (!React.isValidElement(node)) return;
      if (node.props.className === 'hk-manga-region') found.push(node);
      React.Children.toArray(node.props.children).forEach(visit);
    };
    visit(render()); return found;
  };
  render(); document.dispatchEvent({ type: 'mousemove', target: image }); render();
  const auto = async () => {
    find(render(), node => node.props['aria-label'] === 'ocr_btn_trigger').props.onClick();
    await flush();
  };
  const select = async (left, top, right, bottom) => {
    find(render(), node => node.props['aria-label'] === 'ocr_btn_select_box').props.onClick();
    find(render(), node => typeof node.props.onMouseDown === 'function').props.onMouseDown({ clientX: left, clientY: top, preventDefault() {} });
    find(render(), node => typeof node.props.onMouseMove === 'function').props.onMouseMove({ clientX: right, clientY: bottom });
    find(render(), node => typeof node.props.onMouseUp === 'function').props.onMouseUp();
    await flush();
  };
  return { render, regions, auto, select, requests, events, crops, image, window, cleanup: hooks.cleanup,
    createImage: rect => Object.assign(new Image(), { rect }),
    hover: target => { document.dispatchEvent({ type: 'mousemove', target }); render(); },
    frame: () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn()); },
    delay: () => { delayed = true; }, release: () => release() };
}

test('batch overlays respect explicit orientation and recover uncovered text after successful crops', async () => {
  const app = mangaScanHarness({ recover: true });
  await app.auto();
  assert.equal(app.regions().length, 3);
  const batch = app.requests.find(request => request.type === 'RUN_MANGA_OCR_BATCH');
  assert.ok(batch.payload.crops.every(crop => crop.orientation === 'vertical' && crop.orientationHint === 'horizontal'));
  assert.ok(batch.payload.crops.every(crop => crop.transform.padding === 10));
  assert.equal(app.requests.filter(request => request.type === 'RUN_MANGA_OCR').length, 1);
  assert.equal(app.events.length, 0);
  app.cleanup();
});

test('displayed regions stay disjoint across overlapping images and return when a lightbox moves', async () => {
  for (const zoom of [.75, 1, 1.25, 1.5, 2]) {
    const app = mangaScanHarness({ zoom, trackLayout: true });
    await app.auto();
    const first = app.regions();
    assert.equal(first.length, 2);
    const secondImage = app.createImage(app.image.getBoundingClientRect());
    app.hover(secondImage); await app.auto();
    assert.equal(app.regions().length, 2, 'overlapping image elements do not duplicate clickable regions');
    assertDisplayedDisjoint(app.regions());
    const priorRect = secondImage.rect;
    secondImage.rect = { ...priorRect, top: 350, bottom: 350 + priorRect.height };
    app.frame();
    assert.equal(app.regions().length, 4, 'retained regions return after layout separates the images');
    assertDisplayedDisjoint(app.regions());
    secondImage.rect = priorRect;
    app.frame();
    assert.equal(app.regions().length, 2);
    assertDisplayedDisjoint(app.regions());
    app.regions().forEach(node => {
      assert.equal(node.props.style.border, 0);
      assert.equal(node.props.style.outline, 0);
      assert.equal(node.props.style.margin, 0);
    });
    app.cleanup();
  }
});

test('single manual selection preserves outside highlights and updates corrected overlay text', async () => {
  const app = mangaScanHarness();
  await app.auto();
  assert.equal(app.regions().length, 2);
  await app.select(100, 100, 200, 200);
  assert.equal(app.regions().length, 2);
  assert.equal(app.events.length, 1);
  assert.equal(app.events[0].text, '日本語');
  app.window.dispatchEvent(new CustomEvent('hakkutsu:ocr-region-updated', { detail: { id: app.events[0].ocrRegionId, text: '修正した台詞' } }));
  assert.ok(app.regions().some(region => region.props['aria-label'] === '修正した台詞'));
  assert.ok(app.regions().some(region => region.props['aria-label'] === '別の台詞'));
  app.cleanup();
});

test('multi-region manual selection leaves separate selectable regions without opening lookup', async () => {
  const app = mangaScanHarness();
  await app.select(100, 100, 300, 300);
  assert.equal(app.regions().length, 2);
  assert.equal(app.events.length, 0);
  app.regions()[0].props.onClick({ currentTarget: app.image });
  assert.equal(app.events.length, 1);
  app.cleanup();
});

test('manual screenshot selection clamps to the visible portion and discards changed sources', async () => {
  const app = mangaScanHarness({ fallback: true });
  await app.select(-50, -50, 150, 150);
  const batch = app.requests.find(request => request.type === 'RUN_MANGA_OCR_BATCH');
  // The visible source covers 300/400 of the image. A selection starting
  // outside it is clamped to the screenshot origin, producing 100x100 pixels.
  assert.equal(batch.payload.crops[0].bbox.x0, 40);
  assert.ok(app.crops.some(crop => crop[0] === 0 && crop[1] === 0 && crop[2] === 100 && crop[3] === 100));
  assert.ok(app.events[0].x >= 0 && app.events[0].y >= 0);
  app.cleanup();
  const stale = mangaScanHarness();
  stale.delay();
  await stale.select(100, 100, 200, 200);
  stale.image.currentSrc = 'different-page.png';
  stale.release(); await flush();
  assert.equal(stale.regions().length, 0);
  assert.equal(stale.events.length, 0);
  stale.cleanup();
});


test('ambiguous detection leaves direction open and manual low-confidence text stays editable', async () => {
  const ambiguous = mangaScanHarness({ ambiguous: true });
  await ambiguous.auto();
  const batch = ambiguous.requests.find(request => request.type === 'RUN_MANGA_OCR_BATCH');
  assert.ok(batch.payload.crops.every(crop => crop.orientationHint === undefined));
  ambiguous.cleanup();
  const uncertain = mangaScanHarness({ uncertain: true });
  await uncertain.auto();
  assert.equal(uncertain.regions().length, 0);
  await uncertain.select(100, 100, 200, 200);
  assert.equal(uncertain.events.length, 1);
  assert.equal(uncertain.events[0].text, '日本語');
  uncertain.cleanup();
});

test('manual selections use the displayed image geometry at browser zoom', async () => {
  for (const zoom of [.75, 1.5]) {
    const app = mangaScanHarness({ zoom });
    await app.select(100, 100, 100 + 100 * zoom, 100 + 100 * zoom);
    const batch = app.requests.find(request => request.type === 'RUN_MANGA_OCR_BATCH');
    assert.equal(batch.payload.crops[0].bbox.x0, 40);
    assert.ok(app.crops.some(crop => crop[0] === 0 && crop[1] === 0 && crop[2] === 200 && crop[3] === 200));
    assert.equal(app.events.length, 1);
    assert.equal(app.events[0].x, 100 + 25 * zoom);
    app.cleanup();
  }
});

function assertDisplayedDisjoint(nodes) {
  const rectangles = nodes.map(node => ({ x0: node.props.style.left, y0: node.props.style.top,
    x1: node.props.style.left + node.props.style.width, y1: node.props.style.top + node.props.style.height }));
  for (let i = 0; i < rectangles.length; i++) for (let j = i + 1; j < rectangles.length; j++) {
    const a = rectangles[i], b = rectangles[j];
    assert.ok(Math.min(a.x1, b.x1) <= Math.max(a.x0, b.x0) || Math.min(a.y1, b.y1) <= Math.max(a.y0, b.y0));
  }
}

test('partial and repeated selections retain uncovered columns and independently selectable speakers at every zoom', async () => {
  for (const zoom of [.75, 1, 1.25, 1.5, 2]) {
    const app = mangaScanHarness({ zoom, detectorRegions: [
      { bbox: { x0: 40, y0: 40, x1: 120, y1: 160 }, orientation: 'vertical', type: 'bubble' },
      { bbox: { x0: 280, y0: 40, x1: 320, y1: 160 }, orientation: 'vertical', type: 'bubble' },
    ], cropLines: (_crop, index) => index ? [{ text: '別の台詞', confidence: 90, orientation: 'vertical', bbox: { x0: 10, y0: 10, x1: 30, y1: 110 } }] : [
      { text: '日本語', confidence: 90, orientation: 'vertical', bbox: { x0: 10, y0: 10, x1: 30, y1: 110 } },
      { text: '学びます', confidence: 90, orientation: 'vertical', bbox: { x0: 50, y0: 10, x1: 70, y1: 110 } },
    ] });
    await app.auto();
    const other = app.regions().find(r => r.props['aria-label'] === '別の台詞');
    other.props.onClick({ currentTarget: app.image });
    const outsideId = app.events.at(-1).ocrRegionId;
    app.window.dispatchEvent(new CustomEvent('hakkutsu:ocr-region-updated', { detail: { id: outsideId, text: '修正済みの台詞' } }));
    app.render();
    for (let repeat = 0; repeat < 3; repeat++) {
      await app.select(100 + 20 * zoom, 100 + 10 * zoom, 100 + 40 * zoom, 100 + 90 * zoom);
      const nodes = app.regions();
      assert.equal(nodes.length, 2);
      assert.ok(nodes.some(r => r.props['aria-label'] === '学びます日本語'));
      assert.ok(nodes.some(r => r.props['aria-label'] === '修正済みの台詞'));
      assertDisplayedDisjoint(nodes);
    }
    assert.ok(app.events.every(event => !('evidence' in event) && !('diagnostics' in event)));
    app.cleanup();
  }
});

test('adjacent mixed-direction displayed buttons never acquire attachment padding, including screenshot fallback', async () => {
  for (const fallback of [false, true]) for (const zoom of [.75, 1, 1.25, 1.5, 2]) {
    const app = mangaScanHarness({ fallback, zoom, orientation: 'auto', detectorRegions: [
      { bbox: { x0: 40, y0: 40, x1: 60, y1: 140 }, orientation: 'vertical', type: 'text-cluster' },
      { bbox: { x0: 62, y0: 40, x1: 122, y1: 60 }, orientation: 'horizontal', type: 'text-cluster' },
    ], cropLines: (_crop, index) => [{ text: index ? '見出し' : '日本語', confidence: 90,
      orientation: index ? 'horizontal' : 'vertical', bbox: { x0: 10, y0: 10, x1: index ? 70 : 30, y1: index ? 30 : 110 } }] });
    await app.auto();
    const nodes = app.regions();
    assert.equal(nodes.length, 2);
    assertDisplayedDisjoint(nodes);
    nodes.forEach(node => {
      assert.equal(node.props.style.padding, 0);
      assert.equal(node.props.style.minWidth, 0);
      node.props.onClick({ currentTarget: app.image });
    });
    assert.equal(new Set(app.events.map(event => event.ocrRegionId)).size, 2);
    app.cleanup();
  }
});
