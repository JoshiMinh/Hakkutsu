const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Execute the real TypeScript modules with browser/player dependencies supplied by each test.
function loadSource(file, globals = {}, imports = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
    fileName: file,
  }).outputText;
  vm.runInNewContext(source, {
    exports, URL, URLSearchParams, console, ArrayBuffer, AbortController, Error,
    require(name) {
      if (name === '~/shared/japanese/text-normalization') return loadSource('src/shared/japanese/text-normalization.ts');
      if (!(name in imports)) throw new Error(`Unexpected test import: ${name}`);
      return imports[name];
    },
    ...globals,
  }, { filename: file });
  return exports;
}

class Events {
  constructor() { this.listeners = new Map(); this.events = []; }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== listener));
  }
  dispatchEvent(event) {
    this.events.push(event);
    for (const listener of this.listeners.get(event.type) || []) listener(event);
  }
}
class CustomEvent {
  constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
}
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
function bridgeClock() {
  let now = 0;
  return {
    Date: class extends Date { static now() { return now; } },
    setTimeout(fn, ms) { if (ms === 200) queueMicrotask(() => { now += ms; fn(); }); return 1; },
    clearTimeout() {}, setInterval() {},
  };
}
const captionResponse = (videoId, client = 'ANDROID') => ({
  videoDetails: { videoId, title: videoId },
  captions: { playerCaptionsTracklistRenderer: { captionTracks: [{
    languageCode: 'ja', baseUrl: `https://www.youtube.com/api/timedtext?v=${videoId}&c=${client}&pot=signed`,
  }] } },
});

test('YouTube SPA navigation uses the current player response and preserves its client token', async () => {
  const document = new Events();
  document.title = 'current';
  document.querySelector = () => ({ getPlayerResponse: () => captionResponse('new') });
  const window = new Events();
  window.location = { pathname: '/watch', search: '?v=new', href: 'https://www.youtube.com/watch?v=new' };
  window.ytInitialPlayerResponse = captionResponse('old');
  const bridge = loadSource('src/features/subtitles/youtube/youtube-bridge.ts', {
    window, document, CustomEvent, ...bridgeClock(),
  });
  bridge.initYouTubePageBridge();
  document.dispatchEvent(new CustomEvent('hakkutsu:request-youtube-tracks'));
  await flush();
  const data = document.events.find(e => e.type === 'hakkutsu:youtube-synced-tracks').detail;
  assert.equal(data.videoId, 'new');
  const url = new URL(data.tracks[0].url);
  assert.equal(url.searchParams.get('v'), 'new');
  assert.equal(url.searchParams.get('c'), 'ANDROID');
  assert.equal(url.searchParams.get('pot'), 'signed');
});

test('YouTube rejects stale initial captions and fetches tracks for the new video', async () => {
  const document = new Events();
  document.querySelector = () => null;
  const window = new Events();
  window.location = { pathname: '/watch', search: '?v=new', href: 'https://www.youtube.com/watch?v=new', host: 'www.youtube.com' };
  window.ytInitialPlayerResponse = captionResponse('old');
  window.ytcfg = { get: key => key === 'INNERTUBE_API_KEY' ? 'key' : 'en' };
  let requested;
  const bridge = loadSource('src/features/subtitles/youtube/youtube-bridge.ts', {
    window, document, CustomEvent, ...bridgeClock(),
    fetch: async (_url, options) => {
      requested = JSON.parse(options.body).videoId;
      return { status: 200, json: async () => captionResponse('new') };
    },
  });
  bridge.initYouTubePageBridge();
  document.dispatchEvent(new CustomEvent('hakkutsu:request-youtube-tracks'));
  await flush();
  assert.equal(requested, 'new');
  assert.equal(document.events.at(-1).detail.title, 'new');
});

test('YouTube waits for the runtime token and prefers it to static captions', async () => {
  const document = new Events();
  let checks = 0;
  document.querySelector = () => ({
    getVideoData: () => ({ video_id: 'new', title: 'Live' }),
    getAudioTrack: () => ({ captionTracks: [{ languageCode: 'ja', baseUrl: `https://www.youtube.com/api/timedtext?v=new${++checks >= 3 ? '&pot=live' : ''}` }] }),
    getPlayerResponse: () => captionResponse('new'),
  });
  const window = new Events();
  window.location = new URL('https://www.youtube.com/watch?v=new');
  window.ytcfg = { get: () => 'WEB' };
  loadSource('src/features/subtitles/youtube/youtube-bridge.ts', { window, document, CustomEvent, ...bridgeClock() }).initYouTubePageBridge();
  document.dispatchEvent(new CustomEvent('hakkutsu:request-youtube-tracks'));
  document.dispatchEvent(new CustomEvent('hakkutsu:request-youtube-tracks'));
  await flush();
  const publications = document.events.filter(e => e.type === 'hakkutsu:youtube-synced-tracks');
  assert.equal(publications.length, 1);
  assert.equal(publications[0].detail.title, 'Live');
  const url = new URL(publications[0].detail.tracks[0].url);
  assert.equal(url.searchParams.get('pot'), 'live');
  assert.equal(url.searchParams.get('c'), 'WEB');
  assert.equal(url.searchParams.get('fmt'), 'srv3');
});

test('YouTube page fetch accepts only caption URLs for the current video', async () => {
  const document = new Events();
  document.querySelector = () => null;
  const window = new Events();
  window.location = new URL('https://www.youtube.com/watch?v=new');
  const requests = [];
  loadSource('src/features/subtitles/youtube/youtube-bridge.ts', {
    window, document, CustomEvent, ...bridgeClock(),
    fetch: async (url, options) => { requests.push({ url, options }); return { ok: true, text: async () => 'captions' }; },
  }).initYouTubePageBridge();
  for (const [requestId, url] of [
    ['valid', 'https://www.youtube.com/api/timedtext?v=new&pot=live'],
    ['wrong-video', 'https://www.youtube.com/api/timedtext?v=old'],
    ['wrong-host', 'https://example.com/api/timedtext?v=new'],
  ]) document.dispatchEvent(new CustomEvent('hakkutsu:request-youtube-caption-content', { detail: { requestId, url } }));
  await flush();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.credentials, 'include');
  const responses = document.events.filter(e => e.type === 'hakkutsu:youtube-caption-content');
  assert.equal(responses.find(e => e.detail.requestId === 'valid').detail.text, 'captions');
  assert.ok(responses.find(e => e.detail.requestId === 'wrong-video').detail.error);
  assert.ok(responses.find(e => e.detail.requestId === 'wrong-host').detail.error);
});

function componentHarness(platform) {
  let index = 0;
  const slots = [];
  let effects = [];
  const react = {
    useState(initial) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = initial;
      return [slots[slot], value => { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value; }];
    },
    useRef(initial) { const slot = index++; return slots[slot] ||= { current: initial }; },
    useCallback: fn => fn,
    useEffect(fn) { effects.push(fn); },
  };
  const requests = [];
  const document = new Events();
  document.title = 'Test video';
  const imports = {
    react,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'fragment' },
    '~/features/subtitles/youtube/toolbar-styles': { youtubeToolbarCss: '' },
    '~/features/subtitles/shared/subtitle-overlay': { SubtitleOverlay: 'overlay' },
    '~/features/subtitles/shared/select-subtitles-modal': { SelectSubtitlesModal: 'modal' },
    '~/features/settings/settings-store': { useSettingsStore: () => ({ settings: {}, updateSettings() {} }) },
    '~/shared/locales': { useTranslation: () => ({ t: value => value }) },
    '~/features/subtitles/shared/subtitle-parsers': {
      parseNetflixTtml: content => [{ text: content, start: 0, duration: 1 }],
      parseYouTubeJson3: content => [{ text: content, start: 0, duration: 1 }],
      parseYouTubeTimedTextXml: content => [{ text: content, start: 0, duration: 1 }],
    },
    '~/features/subtitles/shared/smart-cue': { buildSmartCues: cues => cues },
    '~/features/subtitles/youtube/youtube-caption-loader': { loadYouTubeCaptionTrack: track => new Promise((resolve, reject) => requests.push({ url: track.url, reject, resolve: text => resolve([{ text, start: 0, duration: 1 }]) })) },
    '~/features/subtitles/shared/video-runtime': {},
    '~/features/subtitles/shared/transcript-panel': { useTranscriptPanelToggle: () => react.useState(false) },
  };
  const { default: Component } = loadSource(`src/features/subtitles/${platform}/${platform}-subtitles.tsx`, {
    document, CustomEvent,
    window: { location: { href: 'https://example.com/watch/1', pathname: '/watch/1' } },
    fetch: url => new Promise(resolve => requests.push({ url, resolve: text => resolve({ ok: true, text: async () => text }) })),
  }, imports);
  return {
    requests, document,
    listenTracks() { effects.find(fn => fn.toString().includes('hakkutsu:youtube-synced-tracks'))(); },
    publishTracks(tracks, videoId = 'new') {
      document.dispatchEvent(new CustomEvent('hakkutsu:youtube-synced-tracks', { detail: { videoId, tracks } }));
    },
    render() {
      index = 0;
      effects = [];
      const children = Component().props.children;
      return Object.fromEntries(children.filter(c => typeof c.type === 'string').map(c => [c.type, c.props]));
    },
  };
}

test('YouTube retries a failed selection when its signed URL refreshes, without repeating the same failure', async () => {
  const app = componentHarness('youtube');
  app.render();
  app.listenTracks();
  const track = { id: 'ja', label: 'Japanese', language: 'ja', url: 'https://www.youtube.com/api/timedtext?v=new&pot=old' };
  app.publishTracks([track]);
  app.requests[0].reject(new Error('empty response'));
  await flush();
  assert.match(app.render().overlay.error, /empty response/);
  app.publishTracks([track]);
  assert.equal(app.requests.length, 1);
  app.publishTracks([{ ...track, url: track.url.replace('pot=old', 'pot=fresh') }]);
  assert.equal(app.requests.length, 2);
  app.requests[1].resolve('fresh captions');
  await flush();
  assert.equal(app.render().overlay.subtitleData.segments[0].text, 'fresh captions');
  assert.equal(app.render().overlay.error, null);
  app.publishTracks([track]);
  assert.equal(app.requests.length, 2);
});

test('YouTube explicit retry reloads an unchanged URL and ignores older requests', async () => {
  const app = componentHarness('youtube');
  app.render();
  app.listenTracks();
  const track = { id: 'ja', label: 'Japanese', language: 'ja', url: 'https://www.youtube.com/api/timedtext?v=new' };
  app.publishTracks([track]);
  app.render().overlay.onRetrySubtitles();
  app.publishTracks([track]);
  app.requests[0].resolve('old');
  await flush();
  assert.equal(app.render().overlay.subtitleData, null);
  app.requests[1].resolve('retried');
  await flush();
  assert.equal(app.render().overlay.subtitleData.segments[0].text, 'retried');
});

const jsonCaptions = JSON.stringify({ events: [{ tStartMs: 1200, dDurationMs: 2100, segs: [{ utf8: '字幕です。' }] }] });
function captionLoaderHarness({ direct = () => '', page = () => '', background = () => '' } = {}) {
  const document = new Events();
  const timers = new Map();
  let timerId = 0;
  const requests = [];
  document.addEventListener('hakkutsu:request-youtube-caption-content', e => {
    const { requestId, url } = e.detail;
    requests.push({ transport: 'page', url });
    document.dispatchEvent(new CustomEvent('hakkutsu:youtube-caption-content', { detail: { requestId: 'unrelated', text: jsonCaptions } }));
    document.dispatchEvent(new CustomEvent('hakkutsu:youtube-caption-content', { detail: { requestId, text: page(url) } }));
  });
  const parsers = loadSource('src/features/subtitles/shared/subtitle-parsers.ts');
  const smartCues = loadSource('src/features/subtitles/shared/smart-cue.ts');
  const loader = loadSource('src/features/subtitles/youtube/youtube-caption-loader.ts', {
    document, CustomEvent, window: { location: new URL('https://www.youtube.com/watch?v=new') },
    setTimeout: fn => { const id = ++timerId; timers.set(id, fn); return id; },
    clearTimeout: id => timers.delete(id),
    fetch: async url => { requests.push({ transport: 'direct', url }); return { ok: true, text: async () => direct(url) }; },
    chrome: { runtime: { sendMessage: async message => {
      requests.push({ transport: 'background', url: message.payload.url });
      return { payload: { success: true, text: background(message.payload.url) } };
    } } },
  }, { '~/features/subtitles/shared/subtitle-parsers': parsers, '~/features/subtitles/shared/smart-cue': smartCues });
  return { ...loader, requests, timers, document };
}

test('empty HTTP 200 captions fall back to the page context and clean up request listeners', async () => {
  const app = captionLoaderHarness({ page: () => jsonCaptions });
  const segments = await app.loadYouTubeCaptionTrack({ name: 'Japanese', url: 'https://www.youtube.com/api/timedtext?v=new&pot=signed&fmt=srv3' });
  assert.equal(segments[0].text, '字幕です。');
  assert.equal(segments[0].start, 1.2);
  assert.deepEqual(app.requests.map(r => r.transport), ['direct', 'page']);
  assert.equal(app.timers.size, 0);
  assert.equal(app.document.listeners.get('hakkutsu:youtube-caption-content').length, 0);
});

test('caption fallback tries json3 while preserving all signed query parameters', async () => {
  const app = captionLoaderHarness({ direct: url => new URL(url).searchParams.get('fmt') === 'json3' ? jsonCaptions : '' });
  const segments = await app.loadYouTubeCaptionTrack({ name: 'Japanese', url: 'https://www.youtube.com/api/timedtext?v=new&pot=signed&c=WEB&tlang=ja&fmt=srv3' });
  assert.equal(segments.length, 1);
  assert.deepEqual(app.requests.map(r => r.transport), ['direct', 'page', 'background', 'direct']);
  const finalUrl = new URL(app.requests.at(-1).url);
  assert.equal(finalUrl.searchParams.get('pot'), 'signed');
  assert.equal(finalUrl.searchParams.get('c'), 'WEB');
  assert.equal(finalUrl.searchParams.get('tlang'), 'ja');
  assert.equal(app.timers.size, 0);
});

test('caption fetch exhaustion reports a failure instead of a successful empty transcript', async () => {
  const app = captionLoaderHarness();
  await assert.rejects(app.loadYouTubeCaptionTrack({ name: 'Japanese', url: 'https://www.youtube.com/api/timedtext?v=new&fmt=srv3' }), /no readable captions/);
  assert.equal(app.requests.length, 6);
  assert.equal(app.timers.size, 0);
});

test('invisible caption formatting is discarded instead of producing empty subtitle bars', () => {
  const { cleanSubtitleText, parseYouTubeJson3 } = loadSource('src/features/subtitles/shared/subtitle-parsers.ts');
  assert.equal(cleanSubtitleText('<b>\u200b\u200f\ufeff</b>'), '');
  assert.equal(parseYouTubeJson3(JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: '\u200b' }] }] })).length, 0);
});

for (const platform of ['youtube', 'netflix']) {
  test(`${platform}: loading a local subtitle immediately activates it and survives an older fetch`, async () => {
    const app = componentHarness(platform);
    const pending = app.render().modal.onSelectTrack({ id: 'remote', url: 'https://example.com/sub', languageCode: 'ja' });
    const local = { language: 'ja', segments: [{ text: 'local', start: 0, duration: 1 }], source: 'file' };
    app.render().overlay.onLoadCustomSubtitles(local);
    assert.equal(app.render().overlay.subtitleData, local);
    app.requests[0].resolve('old remote');
    await pending;
    assert.equal(app.render().overlay.subtitleData, local);
    assert.equal(app.render().overlay.loading, false);
  });

  test(`${platform}: disabling secondary subtitles cancels an in-flight track selection`, async () => {
    const app = componentHarness(platform);
    const pending = app.render().modal.onSelectSecondaryTrack({ id: 'remote', url: 'https://example.com/sub', languageCode: 'en' });
    await app.render().modal.onSelectSecondaryTrack(null);
    app.requests[0].resolve('old translation');
    await pending;
    assert.equal(app.render().overlay.secondaryData, null);
    assert.equal(app.render().overlay.secondaryTrackId, '');
  });
}

test('Netflix requests lazy loading when a secondary track has no URL', async () => {
  const app = componentHarness('netflix');
  await app.render().modal.onSelectSecondaryTrack({ id: 'lazy', languageCode: 'en' });
  assert.equal(app.document.events.at(-1).type, 'hakkutsu:netflix-lazy-load-track');
  assert.equal(app.document.events.at(-1).detail.trackId, 'lazy');
});

test('Netflix republishes unchanged track lists when advancing to another episode', async () => {
  const document = new Events();
  document.title = 'Same title - Netflix';
  const player = { getTimedTextTrackList: () => [{ trackId: 'ja', bcp47: 'ja' }] };
  let poll;
  const window = {
    location: { pathname: '/watch/1' },
    netflix: { appContext: { state: { playerApp: { getAPI: () => ({ videoPlayer: {
      getAllPlayerSessionIds: () => ['session'], getVideoPlayerBySessionId: () => player,
    } }) } } } },
  };
  loadSource('src/features/subtitles/netflix/netflix-bridge.ts', {
    window, document, CustomEvent, setInterval: fn => { poll = fn; },
  }).runNetflixBridgeMain();
  poll();
  window.location.pathname = '/watch/2';
  poll();
  assert.deepEqual(document.events.map(e => e.detail.videoId), ['1', '2']);
});

test('Netflix serializes and deduplicates lazy loads, waiting for delayed CDN URLs', async () => {
  const document = new Events();
  document.title = 'Netflix';
  const original = { trackId: 'off', isNoneTrack: true };
  const ja = { trackId: 'ja', bcp47: 'ja' };
  const en = { trackId: 'en', bcp47: 'en' };
  let selected = original;
  let ticks = 0;
  const changes = [];
  const root = {};
  const player = {
    getTimedTextTrackList: () => [original, ja, en],
    getTimedTextTrack: () => selected,
    setTimedTextTrack: track => { selected = track; ticks = 0; changes.push(track.trackId); },
  };
  const window = {
    location: { pathname: '/watch/1' },
    netflix: { appContext: { state: { playerApp: {
      getAPI: () => ({ videoPlayer: {
        getAllPlayerSessionIds: () => ['session'], getVideoPlayerBySessionId: () => player,
      } }),
      getState: () => ({ videoPlayer: { cadmiumPlayerRepository: { playersById: { session: root } } } }),
    } } } },
  };
  loadSource('src/features/subtitles/netflix/netflix-bridge.ts', {
    window, document, CustomEvent, setInterval() {},
    setTimeout(resolve) {
      if (++ticks === 4) root[selected.trackId] = {
        trackId: selected.trackId, type: 'timedtext', url: `https://example.com/${selected.trackId}.ttml`,
      };
      queueMicrotask(resolve);
    },
  }).runNetflixBridgeMain();
  for (const trackId of ['ja', 'ja', 'en']) {
    document.dispatchEvent(new CustomEvent('hakkutsu:netflix-lazy-load-track', { detail: { trackId } }));
  }
  for (let i = 0; i < 10; i++) await flush();
  assert.deepEqual(changes, ['ja', 'off', 'en', 'off']);
  assert.equal(selected, original);
  const latest = document.events.filter(e => e.type === 'hakkutsu:netflix-synced-tracks').at(-1);
  assert.ok(latest.detail.tracks.every(track => track.url));
});

test('Netflix bridge handles seek event and supports dictionary URL mappings', async () => {
  const document = new Events();
  document.title = 'Netflix';
  let seekTime = null;
  const player = {
    getTimedTextTrackList: () => [{ trackId: 'ja-track', newTrackId: 'ja-new', bcp47: 'ja' }],
    seek: (ms) => { seekTime = ms; },
  };
  const root = {
    timedtext: {
      type: 'timedtext',
      trackId: 'ja-track',
      newTrackId: 'ja-new',
      bcp47: 'ja',
      downloadableUrls: {
        'cdn-fast': { url: 'https://cdn.netflix.com/subtitles/ja.ttml' },
      },
    },
  };
  const window = {
    location: { pathname: '/watch/12345' },
    netflix: { appContext: { state: { playerApp: {
      getAPI: () => ({ videoPlayer: {
        getAllPlayerSessionIds: () => ['sess-1'],
        getVideoPlayerBySessionId: () => player,
      } }),
      getState: () => ({ videoPlayer: { cadmiumPlayerRepository: { playersById: { 'sess-1': root } } } }),
    } } } },
  };
  loadSource('src/features/subtitles/netflix/netflix-bridge.ts', {
    window, document, CustomEvent, setInterval() {}, setTimeout() {},
  }).runNetflixBridgeMain();

  document.dispatchEvent(new CustomEvent('hakkutsu:request-netflix-tracks'));
  await flush();

  const syncEvent = document.events.find(e => e.type === 'hakkutsu:netflix-synced-tracks');
  assert.ok(syncEvent, 'Synced tracks event dispatched');
  assert.equal(syncEvent.detail.tracks[0].url, 'https://cdn.netflix.com/subtitles/ja.ttml');

  // Test seek dispatch
  document.dispatchEvent(new CustomEvent('hakkutsu:netflix-seek', { detail: { timeMs: 42500 } }));
  assert.equal(seekTime, 42500);
});

test('subtitle-parsers: cleanSubtitleText strips TTML ruby pronunciation guides and WebVTT parses commas', () => {
  const parsers = loadSource('src/features/subtitles/shared/subtitle-parsers.ts');

  // 1. TTML ruby annotation text stripping
  const ttmlRuby = '<span><span tts:ruby="base">日本語</span><span tts:ruby="text">にほんご</span></span>を勉強する';
  const cleanedTtml = parsers.cleanSubtitleText(ttmlRuby);
  assert.equal(cleanedTtml, '日本語を勉強する');

  // 2. HTML rt tag stripping
  const htmlRuby = '<ruby>漢字<rt>かんじ</rt></ruby>';
  const cleanedHtml = parsers.cleanSubtitleText(htmlRuby);
  assert.equal(cleanedHtml, '漢字');

  // 3. WebVTT parsing with comma delimiter and cue settings
  const vttSample = `WEBVTT\n\n00:01:23,456 --> 00:01:25,789 line:90% position:50%\nこんにちは世界！`;
  const vttCues = parsers.parseVtt(vttSample);
  assert.equal(vttCues.length, 1);
  assert.equal(vttCues[0].text, 'こんにちは世界！');
  assert.ok(Math.abs(vttCues[0].start - 83.456) < 0.01);
  assert.ok(Math.abs(vttCues[0].duration - 2.333) < 0.01);
});

test('video-runtime: subscribeToVideoTime binds timeupdate and ratechange listeners and unbinds them cleanly', () => {
  const runtime = loadSource('src/features/subtitles/shared/video-runtime.ts');
  const listeners = new Map();
  const video = {
    paused: true,
    ended: false,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      listeners.set(type, (listeners.get(type) || []).filter(f => f !== fn));
    },
  };

  let tickCount = 0;
  const unbind = runtime.subscribeToVideoTime(video, () => { tickCount++; });

  assert.ok(listeners.has('timeupdate'), 'Listens to timeupdate');
  assert.ok(listeners.has('ratechange'), 'Listens to ratechange');
  assert.ok(listeners.has('seeked'), 'Listens to seeked');

  // Trigger timeupdate (simulating seekbar scrub while paused)
  const initialTicks = tickCount;
  listeners.get('timeupdate')[0]();
  assert.equal(tickCount, initialTicks + 1);

  // Trigger ratechange
  listeners.get('ratechange')[0]();
  assert.equal(tickCount, initialTicks + 2);

  // Unbind
  unbind();
  assert.equal(listeners.get('timeupdate').length, 0);
  assert.equal(listeners.get('ratechange').length, 0);
  assert.equal(listeners.get('seeked').length, 0);
});
