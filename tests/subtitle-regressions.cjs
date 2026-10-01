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
    exports, URL, URLSearchParams, console, ArrayBuffer,
    require(name) {
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
  dispatchEvent(event) {
    this.events.push(event);
    for (const listener of this.listeners.get(event.type) || []) listener(event);
  }
}
class CustomEvent {
  constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
}
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
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
  const bridge = loadSource('src/lib/services/youtube-bridge.ts', {
    window, document, CustomEvent, setTimeout() {}, setInterval() {},
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
  const bridge = loadSource('src/lib/services/youtube-bridge.ts', {
    window, document, CustomEvent, setTimeout() {}, setInterval() {},
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

function componentHarness(platform) {
  let index = 0;
  const slots = [];
  const react = {
    useState(initial) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = initial;
      return [slots[slot], value => { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value; }];
    },
    useRef(initial) { const slot = index++; return slots[slot] ||= { current: initial }; },
    useCallback: fn => fn,
    useEffect() {},
  };
  const requests = [];
  const document = new Events();
  document.title = 'Test video';
  const imports = {
    react,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'fragment' },
    '~lib/utils/youtube-subtitle-styles': { youtubeToolbarCss: '' },
    '~components/subtitle-overlay': { SubtitleOverlay: 'overlay' },
    '~components/select-subtitles-modal': { SelectSubtitlesModal: 'modal' },
    '~lib/utils/settings': { useSettingsStore: () => ({ settings: {}, updateSettings() {} }) },
    '~lib/locales': { useTranslation: () => ({ t: value => value }) },
    '~lib/services/subtitle-parsers': {
      parseNetflixTtml: content => [{ text: content, start: 0, duration: 1 }],
      parseYouTubeJson3: content => [{ text: content, start: 0, duration: 1 }],
      parseYouTubeTimedTextXml: content => [{ text: content, start: 0, duration: 1 }],
    },
    '~lib/services/smart-cue': { buildSmartCues: cues => cues },
    '~lib/services/video-runtime': {},
  };
  const { default: Component } = loadSource(`src/contents/${platform}-subtitles.tsx`, {
    document, CustomEvent,
    window: { location: { href: 'https://example.com/watch/1', pathname: '/watch/1' } },
    fetch: url => new Promise(resolve => requests.push({ url, resolve: text => resolve({ ok: true, text: async () => text }) })),
  }, imports);
  return {
    requests, document,
    render() {
      index = 0;
      const children = Component().props.children;
      return Object.fromEntries(children.filter(c => typeof c.type === 'string').map(c => [c.type, c.props]));
    },
  };
}

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
  loadSource('src/lib/services/netflix-bridge.ts', {
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
  loadSource('src/lib/services/netflix-bridge.ts', {
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
