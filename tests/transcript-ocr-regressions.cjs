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
      PSM: { AUTO: '3', SINGLE_BLOCK_VERT_TEXT: '5', SINGLE_BLOCK: '6', SPARSE_TEXT: '11' },
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
const { assembleOcrRegions } = load('src/lib/services/ocr-pipeline.ts', {}, {
  './ocr-regions': load('src/lib/services/ocr-regions.ts', {}, { './ocr-bubbles': load('src/lib/services/ocr-bubbles.ts') }),
  './ocr-geometry': load('src/lib/services/ocr-geometry.ts'),
});
// Confidence/shape-only tests supply trusted ink separately; their blank
// buffers are coordinate placeholders, not real OCR inputs.
const { groupOcrRegions: groupWithTrustedInk } = load('src/lib/services/ocr-regions.ts', {}, { './ocr-bubbles': {
  ...load('src/lib/services/ocr-bubbles.ts'),
  findTextInkEvidence: fragments => new Map(fragments.map(f => [f, { ratio: 1, ink: 0, components: 3, bbox: f.bbox }])),
} });
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
    const { data, info } = await require('sharp')(path.join(__dirname, 'fixtures/manga-dialogue-regions.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const regions = assembleOcrRegions([], result.lines, { automatic: true, pixels: { data: new Uint8ClampedArray(data), width: info.width, height: info.height } });
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


test('vertical crops use PSM 5 and retain local fragments and transform metadata', async () => {
  const bounds = { x0: 10, y0: 10, x1: 30, y1: 190 };
  const app = ocrHarness(async () => ({ text: 'クラウンゲームセンター', confidence: 90,
    blocks: [{ paragraphs: [{ lines: [{ text: 'クラウンゲームセンター', confidence: 90, bbox: bounds,
      words: [word('クラウンゲームセンター', 90, bounds)] }] }] }] }));
  const transform = { originX: 100, originY: 200, scale: 2, padding: 10 };
  const result = await app.ocrEngine.recognizeCrop({ id: 'sign', dataUrl: 'crop', width: 40, height: 200,
    orientation: 'vertical', transform, bbox: { x0: 100, y0: 200, x1: 110, y1: 290 } });
  assert.equal(app.parameters[0].tessedit_pageseg_mode, '5');
  assert.equal(result.lines[0].text, 'クラウンゲームセンター');
  assert.deepEqual(result.lines[0].bbox, bounds);
  assert.deepEqual(result.transform, transform);
  assert.equal(app.created.length, 1);
});

test('auto crops retry low-confidence Japanese, while explicit direction overrides hints', async () => {
  const app = ocrHarness(async language => ({ text: '日本語', confidence: language === 'jpn' ? 90 : 35,
    blocks: [{ paragraphs: [{ lines: [{ text: '日本語', confidence: language === 'jpn' ? 90 : 35,
      bbox: { x0: 10, y0: 10, x1: 70, y1: 30 }, words: [word('日本語', language === 'jpn' ? 90 : 35,
        { x0: 10, y0: 10, x1: 70, y1: 30 })] }] }] }] }));
  const crop = { id: 'wide-bubble', dataUrl: 'crop', width: 200, height: 100, orientation: 'auto',
    orientationHint: 'vertical', bbox: { x0: 0, y0: 0, x1: 200, y1: 100 } };
  const result = await app.ocrEngine.recognizeCrop(crop);
  assert.equal(result.orientation, 'horizontal');
  assert.deepEqual(app.created, ['jpn_vert', 'jpn']);
  const before = app.parameters.length;
  await app.ocrEngine.recognizeCrop({ ...crop, orientation: 'horizontal' });
  assert.equal(app.parameters.length, before + 1);
  assert.equal(app.parameters.at(-1).tessedit_pageseg_mode, '6');
});

test('ambiguous crop direction evaluates both models even when the first is confident', async () => {
  const app = ocrHarness(async () => ({ ...page([word('日本語', 90, { x0: 10, y0: 10, x1: 70, y1: 30 })]), text: '日本語', confidence: 90 }));
  await app.ocrEngine.recognizeCrop({ id: 'unknown', dataUrl: 'crop', width: 200, height: 100,
    orientation: 'auto', bbox: { x0: 0, y0: 0, x1: 200, y1: 100 } });
  assert.deepEqual(app.created, ['jpn', 'jpn_vert']);
});

test('crop direction alternatives survive until pixel validation even when the chosen text is different', async () => {
  const app = ocrHarness(async language => {
    const vertical = language === 'jpn_vert';
    const text = vertical ? '日本語' : '本日';
    const bbox = vertical ? { x0: 10, y0: 10, x1: 30, y1: 80 } : { x0: 10, y0: 10, x1: 60, y1: 30 };
    const confidence = vertical ? 55 : 90;
    return { text, confidence, blocks: [{ paragraphs: [{ lines: [{ text, confidence, bbox,
      words: [word(text, confidence, bbox)] }] }] }] };
  });
  const result = await app.ocrEngine.recognizeCrop({ id: 'mixed', dataUrl: 'crop', width: 80, height: 100,
    orientation: 'auto', orientationHint: 'vertical', bbox: { x0: 0, y0: 0, x1: 80, y1: 100 } });
  assert.equal(result.text, '本日');
  assert.deepEqual(Array.from(result.lines, line => line.text).sort(), ['日本語', '本日'].sort());
  assert.equal(new Set(result.lines.map(line => line.evidence.passId)).size, 2);
});

test('individual characters read by the horizontal model still assemble along a detected vertical column', async () => {
  const text = '何があった';
  const app = ocrHarness(async language => {
    if (language === 'jpn_vert') return { text: '', confidence: 0, blocks: [] };
    const lines = [...text].map((glyph, index) => {
      const bbox = { x0: 10 + index % 2, y0: 10 + index * 18, x1: 24, y1: 24 + index * 18 };
      return { text: glyph, confidence: 95, bbox, words: [word(glyph, 95, bbox)] };
    });
    return { text, confidence: 95, blocks: [{ paragraphs: [{ lines }] }] };
  });
  const crop = { id: 'small-column', dataUrl: 'crop', width: 40, height: 120, orientation: 'auto',
    orientationHint: 'vertical', textColumn: true, bbox: { x0: 0, y0: 0, x1: 40, y1: 120 } };
  const result = await app.ocrEngine.recognizeCrop(crop);
  assert.equal(result.orientation, 'vertical');
  assert.ok(result.lines.every(line => line.orientation === 'vertical'));
  assert.ok(result.lines.every(line => line.evidence.passId === 'small-column:horizontal'));
  assert.deepEqual(Array.from(groupOcrRegions(result.lines), region => region.text), [text]);
  const explicit = await app.ocrEngine.recognizeCrop({ ...crop, orientation: 'horizontal' });
  assert.equal(explicit.orientation, 'horizontal');
  assert.ok(explicit.lines.every(line => line.orientation === 'horizontal'));
});

test('adaptive crop retry honors explicit direction and resets thresholding on the cached worker', async () => {
  let call = 0;
  const app = ocrHarness(async () => {
    const confidence = call++ === 0 ? 35 : 90;
    const text = '日本語', bbox = { x0: 10, y0: 10, x1: 30, y1: 80 };
    return { text, confidence: 90, blocks: [{ paragraphs: [{ lines: [{ text, confidence, bbox,
      words: [word(text, confidence, bbox)] }] }] }] };
  });
  const crop = { id: 'colored', dataUrl: 'crop', width: 50, height: 100, orientation: 'vertical',
    adaptiveThreshold: true, bbox: { x0: 0, y0: 0, x1: 50, y1: 100 } };
  const result = await app.ocrEngine.recognizeCrop(crop);
  assert.equal(result.confidence, 90);
  assert.deepEqual(app.parameters.map(p => p.thresholding_method), ['0', '2']);
  assert.deepEqual(app.created, ['jpn_vert']);
  assert.ok(result.lines.some(line => line.evidence.passId.endsWith(':adaptive')));
  await app.ocrEngine.recognizeCrop({ ...crop, adaptiveThreshold: false });
  assert.equal(app.parameters.at(-1).thresholding_method, '0');
});

test('failed crop recognition remains distinguishable from a successful empty crop', async () => {
  const app = ocrHarness(async () => { throw new Error('worker unavailable'); });
  const results = await app.ocrEngine.recognizeBatch([{ id: 'failed', dataUrl: 'crop', width: 50, height: 100,
    orientation: 'vertical', bbox: { x0: 0, y0: 0, x1: 50, y1: 100 } }]);
  assert.equal(results.length, 1);
  assert.ok(results[0].error.includes('worker unavailable'));
  assert.equal(results[0].text, '');
  assert.equal(results[0].lines.length, 0);
});

test('automatic acceptance excludes low-confidence and artwork-shaped guesses; manual permits correction', () => {
  const pixels = { data: new Uint8ClampedArray(300 * 300 * 4).fill(255), width: 300, height: 300 };
  const input = [
    { ...fragment('日本語', 20, 20, 20, 80), confidence: 44 },
    fragment('ロロ', 130, 150, 10, 10),
    fragment('台詞', 200, 20, 20, 70),
    fragment('雑音ABCDEF', 260, 20, 20, 200),
  ];
  const auto = groupWithTrustedInk(input, { pixels, automatic: true });
  assert.deepEqual(Array.from(auto, region => region.text), ['台詞']);
  assert.ok(groupWithTrustedInk(input, { pixels, manual: true }).some(region => region.text === '日本語'));
});

test('vertical assembly repairs isolated sound marks and preserves numeric runs and V', () => {
  const { normalizeRegionText } = load('src/lib/services/ocr-regions.ts', {}, { './ocr-bubbles': load('src/lib/services/ocr-bubbles.ts') });
  assert.equal(normalizeRegionText('クラウンゲー1ムセンター', 'vertical'), 'クラウンゲームセンター');
  assert.equal(normalizeRegionText('セ1ラーV第12回レベル1', 'vertical'), 'セーラーV第12回レベル1');
  assert.equal(normalizeRegionText('セ1ラーV', 'horizontal'), 'セ1ラーV');
  const regions = groupOcrRegions([
    fragment('ゲ', 20, 10, 20, 20), fragment('1', 26, 32, 8, 18), fragment('ム', 20, 52, 20, 20),
  ], { manual: true });
  assert.equal(regions.length, 1);
  assert.equal(regions[0].text, 'ゲーム');
});

test('crop padding and scale map local fragments into source coordinates and clip padding', () => {
  const { mapCropFragments, canvasToImage, imageToCanvas } = load('src/lib/services/ocr-geometry.ts');
  const crop = { id: 'crop', bbox: { x0: 100, y0: 200, x1: 150, y1: 280 },
    transform: { originX: 100, originY: 200, scale: 2, padding: 10 } };
  const mapped = mapCropFragments([fragment('日本語', 6, 10, 104, 160)], crop);
  assert.deepEqual({ ...mapped[0].bbox }, crop.bbox);
  const mapping = { x: .25, y: .2, width: .75, height: .8, canvasWidth: 600, canvasHeight: 800 };
  const bounds = imageToCanvas({ x0: 0, y0: 0, x1: .5, y1: .5 }, mapping);
  assert.deepEqual({ ...bounds }, { x0: 0, y0: 0, x1: 200, y1: 300 });
  const normalized = canvasToImage(bounds, mapping);
  assert.equal(normalized.x, .25);
  assert.equal(normalized.y, .2);
  assert.equal(normalized.width, .25);
  assert.ok(Math.abs(normalized.height - .3) < 1e-12);
  assert.equal(imageToCanvas({ x0: 0, y0: 0, x1: .1, y1: .1 }, mapping), null);
});

test('bundled models recognize crop batches as ordered dialogue regions', async () => {
  const sharp = require('sharp');
  const tesseract = require('tesseract.js');
  const { ocrEngine } = load('src/lib/services/ocr-engine.ts', { browser: { runtime: { getURL: value => value } } }, {
    'tesseract.js': { ...tesseract, createWorker: (language, oem) => tesseract.createWorker(language, oem, {
      langPath: path.join(__dirname, '../public/ocr'), cacheMethod: 'none',
    }) },
  });
  try {
    const { data, info } = await sharp(path.join(__dirname, 'fixtures/manga-dialogue-regions.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const bubbles = load('src/lib/services/ocr-bubbles.ts');
    const detected = bubbles.detectMangaDialogueRegions({ data: new Uint8ClampedArray(data), width: info.width, height: info.height });
    const crops = [];
    for (const region of detected) {
      const b = region.bbox;
      const image = await sharp(path.join(__dirname, 'fixtures/manga-dialogue-regions.png'))
        .extract({ left: b.x0, top: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 })
        .extend({ top: 10, bottom: 10, left: 10, right: 10, background: 'white' }).png().toBuffer();
      crops.push({ id: region.id, dataUrl: image, width: b.x1 - b.x0 + 20, height: b.y1 - b.y0 + 20,
        orientation: 'auto', orientationHint: region.orientation, bbox: b,
        transform: { originX: b.x0, originY: b.y0, scale: 1, padding: 10 } });
    }
    const results = await ocrEngine.recognizeBatch(crops);
    const { mapCropFragments } = load('src/lib/services/ocr-geometry.ts');
    const regions = groupOcrRegions(results.flatMap(result => mapCropFragments(result.lines, crops.find(c => c.id === result.id))), {
      pixels: { data: new Uint8ClampedArray(data), width: info.width, height: info.height }, automatic: true,
    });
    assert.ok(regions.some(r => r.text.includes('日本語を勉強します') && r.text.includes('今日は晴れです')), JSON.stringify(regions.map(r => r.text)));
    assert.ok(regions.some(r => r.text.includes('本を読みます') && r.text.includes('楽しいです')), JSON.stringify(regions.map(r => r.text)));
  } finally { await ocrEngine.terminate(); }
});


test('recovery corrects a weaker crop without accepting broad overlapping guesses or duplicates', () => {
  const { mergeOcrFragments, mapCropFragments } = load('src/lib/services/ocr-geometry.ts');
  const primary = [{ ...fragment('狐本語', 100, 20, 20, 90), confidence: 70 }];
  const result = mergeOcrFragments(primary, [
    { ...fragment('日本語', 100, 20, 20, 90), confidence: 95 },
    fragment('別の台詞', 200, 20, 20, 100),
    { ...fragment('大きな誤読', 80, 0, 160, 150), confidence: 99 },
  ]);
  assert.deepEqual(Array.from(result, f => f.text), ['日本語', '別の台詞']);
  assert.equal(primary[0].text, '狐本語');
  const clipped = mapCropFragments([fragment('ター', 99, 10, 20, 50)], {
    id: 'padding', bbox: { x0: 0, y0: 0, x1: 100, y1: 100 },
    transform: { originX: 0, originY: 0, scale: 1, padding: 10 },
  });
  assert.equal(clipped.length, 0);
});

test('automatic validation rejects punctuation-only, tiny and densely hallucinated artwork', () => {
  const regions = groupOcrRegions([
    fragment('ーー一', 20, 20, 30, 15, 'horizontal'),
    fragment('ター', 100, 20, 1, 5),
    fragment('雑音誤読', 150, 20, 40, 45),
    fragment('正しい台詞', 230, 20, 20, 100),
  ], { automatic: true });
  assert.deepEqual(Array.from(regions, r => r.text), ['正しい台詞']);
});


test('recovery preserves overlapping Japanese word boxes from the same pass', () => {
  const { mergeOcrFragments } = load('src/lib/services/ocr-geometry.ts');
  const heading = [
    fragment('漫画', 160, 746, 276, 36, 'horizontal'),
    fragment('の', 260, 742, 35, 54, 'horizontal'),
    fragment('発売', 294, 746, 89, 36, 'horizontal'),
    fragment('予定', 382, 742, 58, 54, 'horizontal'),
  ];
  const merged = mergeOcrFragments([], heading);
  assert.equal(merged.length, 4);
  assert.equal(groupOcrRegions(merged, { automatic: true })[0].text, '漫画の発売予定');
});


test('region recovery does not insert nested alternatives or expand accepted dialogue into artwork', () => {
  const { mergeOcrRegionPasses, resolveOcrRegionOverlaps } = load('src/lib/services/ocr-regions.ts', {}, { './ocr-bubbles': load('src/lib/services/ocr-bubbles.ts') });
  const region = f => ({ text: f.text, orientation: f.orientation, fragments: [f], bbox: f.bbox });
  const primary = region(fragment('こんなテスト', 100, 30, 20, 120));
  const nested = region(fragment('テスト', 100, 70, 20, 60));
  const broad = region(fragment('誤読した大きな領域', 80, 10, 140, 200, 'horizontal'));
  const other = region(fragment('別の台詞', 250, 30, 20, 120));
  assert.deepEqual(Array.from(mergeOcrRegionPasses([primary], [nested, broad, other]), r => r.text), ['こんなテスト', '別の台詞']);
  const final = resolveOcrRegionOverlaps([broad, nested, primary, other]);
  assert.ok(final.some(r => r.text === 'こんなテスト'));
  for (let i = 0; i < final.length; i++) for (let j = i + 1; j < final.length; j++) {
    const a = final[i].bbox, b = final[j].bbox;
    assert.ok(Math.min(a.x1, b.x1) <= Math.max(a.x0, b.x0) || Math.min(a.y1, b.y1) <= Math.max(a.y0, b.y0));
  }
});

test('automatic OCR rejects ink connected to artwork beyond the candidate rectangle', () => {
  const width = 300, height = 220;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const ink = (x, y) => { const p = (y * width + x) * 4; data[p] = data[p + 1] = data[p + 2] = 0; };
  // A clipped piece of a long hair strand looks like vertical text locally.
  for (let y = 0; y < height; y++) for (let x = 40; x < 44; x++) ink(x, y);
  for (let y = 30; y < 110; y += 22) for (let yy = y; yy < y + 16; yy++) for (let x = 140; x < 152; x++) {
    if (x === 140 || x === 151 || yy === y || yy === y + 15) ink(x, yy);
  }
  const regions = groupOcrRegions([fragment('こいい', 36, 30, 20, 80), fragment('日本語', 138, 30, 20, 80)], {
    automatic: true, pixels: { data, width, height },
  });
  assert.deepEqual(Array.from(regions, r => r.text), ['日本語']);
});

test('a vertical column joins separated words without crossing a speaker boundary', () => {
  const regions = groupOcrRegions([fragment('ザコ', 30, 20, 20, 40), fragment('キャラは', 31, 90, 20, 80)]);
  assert.deepEqual(Array.from(regions, r => r.text), ['ザコキャラは']);
});


test('short borderless guesses need stronger confidence while remaining manually editable', () => {
  const pixels = { width: 300, height: 200, data: new Uint8ClampedArray(300 * 200 * 4).fill(255) };
  const input = [{ ...fragment('ウツしみ', 20, 30, 100, 20, 'horizontal'), confidence: 50 }, fragment('出口', 200, 30, 20, 60)];
  assert.deepEqual(Array.from(groupWithTrustedInk(input, { pixels, automatic: true }), r => r.text), ['出口']);
  assert.ok(groupWithTrustedInk(input, { pixels, manual: true }).some(r => r.text === 'ウツしみ'));
});

test('recognition retains raw provenance but rejects invalid rotated character bounds', async () => {
  const bbox = { x0: 10, y0: 10, x1: 30, y1: 80 };
  const app = ocrHarness(async () => ({ text: '日本語', confidence: 90, blocks: [{ paragraphs: [{ lines: [{
    text: '日本語', confidence: 90, bbox, words: [{ ...word('日本語', 90, bbox), symbols: [
      { text: '日', confidence: 90, bbox: { x0: 0, y0: 10, x1: 0, y1: 30 } },
      { text: '本', confidence: 90, bbox: { x0: 10, y0: 35, x1: 30, y1: 55 } },
    ] }],
  }] }] }] }));
  const diagnostics = [];
  const result = await app.ocrEngine.recognizeCrop({ id: 'sign', dataUrl: 'crop', width: 50, height: 100,
    orientation: 'vertical', bbox }, event => diagnostics.push(event));
  assert.equal(result.lines[0].evidence.source, 'crop');
  assert.equal(result.lines[0].evidence.cropId, 'sign');
  assert.equal(result.lines[0].evidence.passId, 'sign:vertical');
  assert.deepEqual({ ...result.lines[0].evidence.rawBounds }, bbox);
  assert.equal(result.lines[0].evidence.glyphs.length, 1);
  assert.ok(diagnostics.some(event => event.reason === 'invalid-symbol-bounds'));
  assert.ok(diagnostics.some(event => event.reason === 'chosen-crop-orientation'));
});

test('overlapping Tesseract lines cannot repeat a weak word on already recognized pixels', async () => {
  const app = ocrHarness(async () => ({ text: '本をを読みます', confidence: 90, blocks: [{ paragraphs: [{ lines: [
    { text: '本を', confidence: 51, bbox: { x0: 20, y0: 10, x1: 40, y1: 100 }, words: [
      word('本', 96, { x0: 20, y0: 10, x1: 40, y1: 30 }), word('を', 5, { x0: 25, y0: 75, x1: 40, y1: 90 }),
    ] },
    { text: 'を読みます', confidence: 96, bbox: { x0: 20, y0: 50, x1: 40, y1: 180 }, words: [
      word('を', 96, { x0: 20, y0: 50, x1: 40, y1: 100 }), word('読みます', 96, { x0: 20, y0: 105, x1: 40, y1: 180 }),
    ] },
  ] }] }] }));
  const diagnostics = [];
  const result = await app.ocrEngine.recognize('page', { orientation: 'vertical', diagnostics: event => diagnostics.push(event) });
  assert.equal(groupOcrRegions(result.lines)[0].text, '本を読みます');
  assert.ok(diagnostics.some(event => event.reason === 'nested-word-alternative'));
  assert.equal(result.lines[0].bbox.y1, 30);
});
