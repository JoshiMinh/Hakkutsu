const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, globals = {}, imports = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(source, { exports, console, ...globals, require: name => {
    assert.ok(name in imports, `Unexpected import: ${name}`);
    return imports[name];
  } });
  return exports;
}

function ocrHarness(recognize) {
  const parameters = [];
  const created = [];
  const { ocrEngine } = load('src/lib/services/ocr-engine.ts', {
    browser: { runtime: { getURL: path => `extension://${path}` } },
  }, {
    'tesseract.js': {
      PSM: { SINGLE_BLOCK_VERT_TEXT: '5', SPARSE_TEXT: '11' },
      createWorker: async language => {
        created.push(language);
        return {
          setParameters: async params => parameters.push({ language, ...params }),
          recognize: async image => ({ data: await recognize(language, image) }),
          terminate: async () => {},
        };
      },
    },
  });
  return { ocrEngine, parameters, created };
}
const word = (text, confidence, bbox) => ({ text, confidence, bbox });
const page = words => ({ text: 'raw page', confidence: 80, blocks: [{ paragraphs: [{ lines: [{
  text: 'a line that spans the page', bbox: { x0: 0, y0: 0, x1: 900, y1: 40 }, words,
}] }] }] });

test('manga OCR returns tight Japanese word bounds and rejects low-confidence artwork', async () => {
  const bounds = { x0: 220, y0: 50, x1: 245, y1: 175 };
  const app = ocrHarness(async () => page([
    word('日 本 語', 92, bounds),
    word('雑音', 22, { x0: 0, y0: 0, x1: 900, y1: 40 }),
    word('LOGO', 95, bounds),
    word('日本', 90, { x0: NaN, y0: 1, x1: 4, y1: 10 }),
  ]));
  const result = await app.ocrEngine.recognize('image', { orientation: 'vertical' });
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0].text, '日本語');
  assert.deepEqual(result.lines[0].bbox, bounds);
  assert.equal(app.parameters[0].textord_tabfind_force_vertical_text, '1');
});

test('auto OCR recognizes both directions regardless of page aspect ratio and removes overlapping guesses', async () => {
  const bounds = { x0: 220, y0: 50, x1: 245, y1: 175 };
  const app = ocrHarness(async language => page(language === 'jpn_vert' ? [
    word('日本語', 95, bounds),
  ] : [
    word('誤読', 55, bounds),
    word('発売予定', 91, { x0: 30, y0: 700, x1: 200, y1: 750 }),
  ]));
  const result = await app.ocrEngine.recognize('landscape', { boxWidth: 1200, boxHeight: 700 });
  assert.deepEqual(app.created.sort(), ['jpn', 'jpn_vert']);
  assert.deepEqual(Array.from(result.lines, line => line.text).sort(), ['日本語', '発売予定']);
  assert.equal(app.parameters.find(params => params.language === 'jpn').tessedit_pageseg_mode, '11');
});

test('explicit horizontal OCR avoids the second pass', async () => {
  const app = ocrHarness(async () => page([]));
  await app.ocrEngine.recognize('image', { orientation: 'horizontal' });
  assert.deepEqual(app.created, ['jpn']);
});

test('packaged Japanese models read vertical dialogue beside horizontal text in a manga layout', async () => {
  const tesseract = require('tesseract.js');
  const { ocrEngine } = load('src/lib/services/ocr-engine.ts', {
    browser: { runtime: { getURL: value => value } },
  }, {
    'tesseract.js': { ...tesseract, createWorker: (language, oem) => tesseract.createWorker(language, oem, {
      langPath: path.join(__dirname, '../public/ocr'), cacheMethod: 'none',
    }) },
  });
  try {
    const result = await ocrEngine.recognize(path.join(__dirname, 'fixtures/manga-layout.png'), { boxWidth: 800, boxHeight: 900 });
    assert.ok(result.text.includes('日本語を勉強します'));
    assert.ok(result.text.includes('今日は晴れです'));
    assert.ok(result.text.includes('発売'));
    assert.ok(result.lines.every(line => line.bbox.x1 - line.bbox.x0 < 200));
  } finally {
    await ocrEngine.terminate();
  }
});

test('concurrent OCR requests cannot interleave cached-worker parameters or stall after failure', async () => {
  let release;
  const calls = [];
  const app = ocrHarness(async (_language, image) => {
    calls.push(image);
    if (image === 'first') await new Promise(resolve => { release = resolve; });
    if (image === 'bad') throw new Error('bad image');
    return page([]);
  });
  const first = app.ocrEngine.recognize('first', { orientation: 'horizontal' });
  const second = app.ocrEngine.recognize('second', { orientation: 'horizontal' });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.deepEqual(calls, ['first']);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(calls, ['first', 'second']);
  await assert.rejects(app.ocrEngine.recognize('bad', { orientation: 'horizontal' }), /bad image/);
  await app.ocrEngine.recognize('after failure', { orientation: 'horizontal' });
  assert.equal(calls.at(-1), 'after failure');
});

class Event {
  constructor() { this.listeners = []; }
  addListener(listener) { this.listeners.push(listener); }
  emit(...args) { return this.listeners.map(listener => listener(...args)); }
}
function routerHarness(sendMessage = async () => ({ type: 'TRANSCRIPT_SNAPSHOT', payload: { videoTitle: 'Current' } })) {
  const requests = [];
  const chrome = {
    runtime: { onConnect: new Event(), onMessage: new Event() },
    tabs: { sendMessage: async (tabId, message, options) => {
      requests.push({ tabId, message, options });
      return sendMessage(tabId, message);
    } },
  };
  const close = load('src/lib/services/transcript-panel-router.ts', { chrome }).installTranscriptPanelRouter();
  const panel = () => {
    const messages = [];
    const port = { name: 'hakkutsu-transcript-panel', onMessage: new Event(), onDisconnect: new Event(), postMessage: message => messages.push(message) };
    chrome.runtime.onConnect.emit(port);
    return { port, messages, watch: tabId => Promise.all(port.onMessage.emit({ type: 'WATCH_TAB', tabId })) };
  };
  return { chrome, requests, panel, close };
}

test('transcript updates and seeks stay attached to their source tab', async () => {
  const app = routerHarness();
  const first = app.panel();
  const second = app.panel();
  await first.watch(11);
  await second.watch(22);
  app.chrome.runtime.onMessage.emit({ type: 'TRANSCRIPT_CUE', payload: { text: '日本語' } }, { tab: { id: 11 } }, () => {});
  assert.equal(first.messages.at(-1).type, 'TRANSCRIPT_CUE');
  assert.equal(second.messages.at(-1).type, 'TRANSCRIPT_SNAPSHOT');
  await Promise.all(first.port.onMessage.emit({ type: 'SEEK_TRANSCRIPT', payload: { time: 32.5 } }));
  assert.equal(app.requests.at(-1).tabId, 11);
  assert.equal(app.requests.at(-1).message.payload.time, 32.5);
  await Promise.all(first.port.onMessage.emit({ type: 'RETRY_TRANSCRIPT' }));
  assert.equal(app.requests.at(-1).tabId, 11);
  assert.equal(app.requests.at(-1).message.type, 'RETRY_TRANSCRIPT');
  app.close(11);
  assert.equal(first.messages.at(-1).type, 'CLOSE_TRANSCRIPT_PANEL');
  first.port.onDisconnect.emit();
  assert.equal(app.requests.findLast(request => request.message.type === 'TRANSCRIPT_VISIBILITY').message.payload.open, false);
  assert.equal(app.requests.at(-1).message.type, 'CANCEL_TRANSCRIPT_LOOKUP');
});

test('transcript lookup opens only in the source tab and publishes its visibility back to that panel', async () => {
  const app = routerHarness();
  const first = app.panel();
  const second = app.panel();
  await first.watch(11); await second.watch(22);
  await Promise.all(first.port.onMessage.emit({ type: 'LOOKUP_TRANSCRIPT', payload: { text: '建物', transient: false } }));
  assert.equal(app.requests.at(-1).tabId, 11);
  assert.equal(app.requests.at(-1).options.frameId, 0);
  assert.equal(app.requests.at(-1).message.type, 'LOOKUP_TRANSCRIPT');
  app.chrome.runtime.onMessage.emit({ type: 'TRANSCRIPT_LOOKUP_STATE', payload: { open: true } }, { tab: { id: 11 } }, () => {});
  assert.equal(first.messages.at(-1).type, 'TRANSCRIPT_LOOKUP_STATE');
  assert.equal(second.messages.at(-1).type, 'TRANSCRIPT_SNAPSHOT');
  const before = app.requests.length;
  await Promise.all(first.port.onMessage.emit({ type: 'LOOKUP_TRANSCRIPT', payload: { text: 'x'.repeat(1001) } }));
  assert.equal(app.requests.length, before);
});

test('switching tabs discards a delayed transcript response from the previous tab', async () => {
  let release;
  const app = routerHarness(async (tabId, message) => {
    if (message.type !== 'GET_TRANSCRIPT') return;
    if (tabId === 11) return new Promise(resolve => { release = resolve; });
    return { type: 'TRANSCRIPT_SNAPSHOT', payload: { videoTitle: 'New tab' } };
  });
  const panel = app.panel();
  const pending = panel.watch(11);
  await panel.watch(22);
  release({ type: 'TRANSCRIPT_SNAPSHOT', payload: { videoTitle: 'Old tab' } });
  await pending;
  assert.equal(panel.messages.length, 1);
  assert.equal(panel.messages[0].payload.videoTitle, 'New tab');
});

test('a page without a video clears the sidebar and disconnected panels receive no delayed updates', async () => {
  const app = routerHarness(async (_tabId, message) => {
    if (message.type === 'GET_TRANSCRIPT') throw new Error('No receiver');
  });
  const panel = app.panel();
  await panel.watch(11);
  assert.equal(panel.messages[0].type, 'TRANSCRIPT_UNAVAILABLE');
  panel.port.onDisconnect.emit();
  app.chrome.runtime.onMessage.emit({ type: 'TRANSCRIPT_CUE' }, { tab: { id: 11 } }, () => {});
  assert.equal(panel.messages.length, 1);
});
