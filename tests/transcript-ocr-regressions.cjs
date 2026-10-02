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
      PSM: { AUTO: '3', SINGLE_BLOCK_VERT_TEXT: '5', SPARSE_TEXT: '11' },
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

const { groupOcrRegions } = load('src/lib/services/ocr-regions.ts', {}, { './ocr-bubbles': load('src/lib/services/ocr-bubbles.ts') });
const fragment = (text, x, y, w, h, orientation = 'vertical', paragraphId = 'dialogue') => ({
  text, confidence: 90, orientation, paragraphId, bbox: { x0: x, y0: y, x1: x + w, y1: y + h },
});

test('enclosed speech bubbles combine uneven, widely spaced columns without merging speakers', () => {
  const width = 350, height = 240;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const ink = (x, y) => { const p = (y * width + x) * 4; data[p] = data[p + 1] = data[p + 2] = 0; };
  // Closed bubble outlines; text columns can have very different heights.
  for (const [left, right] of [[10, 170], [185, 330]]) {
    for (let x = left; x <= right; x++) { ink(x, 10); ink(x, 220); }
    for (let y = 10; y <= 220; y++) { ink(left, y); ink(right, y); }
  }
  const regions = groupOcrRegions([
    fragment('日本語を', 125, 40, 18, 100),
    fragment('勉強します。', 55, 70, 25, 130),
    fragment('今日は', 285, 40, 18, 70),
    fragment('晴れです。', 210, 70, 25, 100),
    fragment('口', 175, 225, 8, 8), // Confident artwork hallucination.
    fragment('ロロ', 340, 225, 8, 8),
    fragment('口', 100, 30, 8, 8, 'horizontal'), // Wrong-direction guess inside the first bubble.
  ], { pixels: { data, width, height } });
  assert.equal(regions.length, 2);
  assert.deepEqual(Array.from(regions, r => r.text).sort(), ['日本語を勉強します。', '今日は晴れです。'].sort());
  assert.ok(regions.every(r => r.fragments.length === 2));
});

test('dialogue regions combine vertical columns right-to-left and keep neighboring speakers separate', () => {
  const regions = groupOcrRegions([
    fragment('晴れです。', 60, 20, 20, 100),
    fragment('今日は', 90, 20, 20, 60),
    fragment('こんにちは！', 180, 20, 20, 100),
  ]);
  assert.deepEqual(Array.from(regions, r => r.text), ['こんにちは！', '今日は晴れです。']);
  assert.equal(regions[1].fragments.length, 2);
  assert.deepEqual({ ...regions[1].bbox }, { x0: 60, y0: 20, x1: 110, y1: 120 });
});

test('horizontal words, punctuation and numbers form complete multiline dialogue', () => {
  const regions = groupOcrRegions([
    fragment('日本語', 10, 10, 60, 20, 'horizontal'),
    fragment('を学ぶ', 75, 10, 60, 20, 'horizontal'),
    fragment('！', 137, 10, 10, 20, 'horizontal'),
    fragment('第', 10, 42, 20, 20, 'horizontal'),
    fragment('2', 32, 42, 10, 20, 'horizontal'),
    fragment('回。', 44, 42, 40, 20, 'horizontal'),
  ]);
  assert.equal(regions.length, 1);
  assert.equal(regions[0].text, '日本語を学ぶ！第2回。');
});

test('visible bubble and panel dividers prevent merging even within one OCR paragraph', () => {
  const width = 160, height = 160;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < height; y++) for (const x of [45, 46]) {
    const i = (y * width + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 0;
  }
  const input = [fragment('左の台詞', 20, 20, 20, 100), fragment('右の台詞', 55, 20, 20, 100)];
  assert.equal(groupOcrRegions(input).length, 1);
  assert.equal(groupOcrRegions(input, { pixels: { data, width, height } }).length, 2);
  const curvedData = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 20; y <= 120; y++) {
    const x = 42 + Math.floor(10 * Math.sin((y - 20) / 100 * Math.PI));
    const i = (y * width + x) * 4;
    curvedData[i] = curvedData[i + 1] = curvedData[i + 2] = 0;
  }
  assert.equal(groupOcrRegions(input, { pixels: { data: curvedData, width, height } }).length, 2);
  const horizontalData = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let x = 0; x < width; x++) {
    const i = (45 * width + x) * 4;
    horizontalData[i] = horizontalData[i + 1] = horizontalData[i + 2] = 0;
  }
  assert.equal(groupOcrRegions([
    fragment('上の台詞', 20, 20, 100, 20, 'horizontal'),
    fragment('下の台詞', 20, 55, 100, 20, 'horizontal'),
  ], { pixels: { data: horizontalData, width, height } }).length, 2);
});

test('furigana belongs to the region bounds without duplicating its pronunciation in text', () => {
  const regions = groupOcrRegions([
    fragment('日本語', 20, 20, 20, 60),
    fragment('にほんご', 43, 20, 8, 60),
    fragment('見出し', 100, 130, 60, 20, 'horizontal'),
    fragment('ドン', 20, 130, 30, 80),
  ]);
  assert.equal(regions.length, 3);
  const dialogue = regions.find(r => r.text === '日本語');
  assert.equal(dialogue.bbox.x1, 51);
  assert.equal(dialogue.fragments.length, 2);
});

test('manga OCR preserves fragment bounds and membership and rejects low-confidence artwork', async () => {
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
  assert.ok(result.lines[0].lineId);
  assert.ok(result.lines[0].paragraphId);
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

test('OCR retains punctuation and digits attached to Japanese text', async () => {
  const app = ocrHarness(async () => page([
    word('第', 90, { x0: 10, y0: 20, x1: 30, y1: 40 }),
    word('2', 90, { x0: 32, y0: 20, x1: 42, y1: 40 }),
    word('回', 90, { x0: 44, y0: 20, x1: 64, y1: 40 }),
    word('！', 90, { x0: 66, y0: 20, x1: 76, y1: 40 }),
  ]));
  const result = await app.ocrEngine.recognize('image', { orientation: 'horizontal' });
  assert.equal(groupOcrRegions(result.lines)[0].text, '第2回！');
});

test('vertical OCR never trusts a column spanning a large empty gap', async () => {
  const app = ocrHarness(async () => ({ text: '', confidence: 90, blocks: [{ paragraphs: [{ lines: [{
    text: '台詞見出し', confidence: 90, bbox: { x0: 20, y0: 10, x1: 40, y1: 500 },
    words: [word('台詞', 90, { x0: 20, y0: 10, x1: 40, y1: 70 }),
      word('見出し', 90, { x0: 20, y0: 440, x1: 40, y1: 500 })],
  }] }] }] }));
  const result = await app.ocrEngine.recognize('image', { orientation: 'vertical' });
  assert.equal(groupOcrRegions(result.lines).length, 2);
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
    const result = await ocrEngine.recognize(path.join(__dirname, 'fixtures/manga-dialogue-regions.png'), { boxWidth: 800, boxHeight: 900 });
    assert.ok(result.text.includes('日本語を勉強します'));
    assert.ok(result.text.includes('今日は晴れです'));
    assert.ok(result.text.includes('発売'));
    const regions = groupOcrRegions(result.lines);
    assert.ok(regions.some(region => region.text.includes('日本語を勉強します')));
    assert.ok(regions.some(region => region.text.includes('今日は晴れです')));
    assert.ok(regions.some(region => region.text.includes('本を読みます') && region.text.includes('楽しいです')),
      JSON.stringify(regions.map(region => region.text)));
    const rightBubble = regions.find(region => region.text.includes('日本語を勉強します'));
    assert.ok(rightBubble.text.includes('今日は晴れです'), JSON.stringify(regions.map(region => region.text)));
    assert.ok(!rightBubble.text.includes('本を読みます'));
    assert.ok(regions.some(region => region.text === '漫画の発売予定'));
    assert.equal(regions.length, 3);
    assert.ok(regions.every(region => region.bbox.x1 > region.bbox.x0 && region.bbox.y1 > region.bbox.y0));
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
