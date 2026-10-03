const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createOcrRuntime } = require('./helpers/ocr-runtime.cjs');
const { intersects } = require('./helpers/ocr-fixtures.cjs');
const { geometry, regions, pipeline, bubbles } = createOcrRuntime();
const fragment = (text, x, y, width, height, orientation = 'vertical', confidence = 90, passId = 'crop') => ({
  text, orientation, confidence, bbox: { x0: x, y0: y, x1: x + width, y1: y + height },
  evidence: { source: passId === 'page' ? 'page' : 'crop', passId, rawBounds: { x0: x, y0: y, x1: x + width, y1: y + height }, words: [], glyphs: [] },
});
const region = fragments => ({ text: fragments.map(f => f.text).join(''), orientation: fragments[0].orientation, fragments,
  bbox: { x0: Math.min(...fragments.map(f => f.bbox.x0)), y0: Math.min(...fragments.map(f => f.bbox.y0)),
    x1: Math.max(...fragments.map(f => f.bbox.x1)), y1: Math.max(...fragments.map(f => f.bbox.y1)) } });
function canvas(width = 360, height = 260) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const ink = (x, y) => { const p = (y * width + x) * 4; data[p] = data[p + 1] = data[p + 2] = 0; };
  const glyph = (x, y, size = 16) => {
    for (let yy = y; yy < y + size; yy++) for (let xx = x; xx < x + size; xx++) {
      if (xx === x || xx === x + size - 1 || yy === y || yy === y + size - 1 || yy === y + Math.floor(size / 2)) ink(xx, yy);
    }
  };
  return { pixels: { width, height, data }, ink, glyph };
}
function noOverlap(result) {
  for (let i = 0; i < result.length; i++) for (let j = i + 1; j < result.length; j++) assert.equal(intersects(result[i].bbox, result[j].bbox), false);
}

test('page recovery fills a missing column inside an existing passage rectangle', () => {
  const c = canvas();
  for (const x of [60, 90, 120]) for (const y of [30, 52, 74]) c.glyph(x, y);
  const result = pipeline.assembleOcrRegions([fragment('日本語', 120, 30, 16, 60), fragment('学びます', 60, 30, 16, 60)],
    [fragment('毎日', 90, 30, 16, 60, 'vertical', 90, 'page')], { pixels: c.pixels, automatic: true });
  assert.equal(result.length, 1);
  assert.equal(result[0].text, '日本語毎日学びます');
  assert.equal(result[0].fragments.length, 3);
});

test('valid word bounds recover a partial extension, without guessing character positions', () => {
  const first = fragment('今日は', 80, 20, 20, 60);
  const recovered = fragment('今日は晴れ', 80, 20, 20, 110, 'vertical', 95, 'page');
  recovered.evidence.words = [
    { text: '今日は', confidence: 95, bbox: first.bbox },
    { text: '晴れ', confidence: 95, bbox: { x0: 80, y0: 90, x1: 100, y1: 130 } },
  ];
  const merged = geometry.mergeOcrFragments([first], [recovered]);
  assert.deepEqual(Array.from(merged, f => f.text), ['今日は', '晴れ']);
  assert.deepEqual({ ...merged[1].bbox }, recovered.evidence.words[1].bbox);
  const invalid = { ...recovered, evidence: { ...recovered.evidence, words: [], glyphs: [
    { text: '今日は', bbox: { x0: 0, y0: 0, x1: 0, y1: 20 } }, { text: '晴れ', bbox: recovered.bbox },
  ] } };
  assert.equal(geometry.splitOcrFragment(invalid).length, 1);
});

test('recovery resolves containment, partial alternatives, and mixed directions once', () => {
  const base = fragment('正しい台詞', 100, 30, 20, 110, 'vertical', 90);
  const events = [];
  const alternatives = [fragment('台詞', 100, 80, 20, 60, 'vertical', 99, 'page'),
    fragment('違う読み', 90, 30, 45, 100, 'horizontal', 99, 'page'),
    fragment('正しい台詞', 100, 30, 20, 110, 'vertical', 95, 'page')];
  const result = geometry.mergeOcrFragments([base], alternatives, event => events.push(event));
  assert.equal(result.length, 1);
  assert.equal(result[0].text, '正しい台詞');
  assert.equal(result[0].confidence, 95);
  assert.ok(events.some(event => event.reason === 'covered-or-broad-alternative'));
  assert.ok(events.some(event => event.reason === 'replaced-competing-reading'));
  assert.equal(geometry.mergeOcrFragments(result, alternatives).length, 1);
});

test('a losing overlapping reading keeps independently supported dialogue', () => {
  const winning = region([fragment('正しい台詞', 100, 30, 20, 110)]);
  const alternative = region([fragment('台詞', 100, 80, 20, 60, 'vertical', 70, 'page'),
    fragment('別の台詞', 220, 30, 20, 110, 'vertical', 80, 'page')]);
  const result = regions.resolveOcrRegionOverlaps([alternative, winning]);
  assert.deepEqual(Array.from(result, r => r.text).sort(), ['正しい台詞', '別の台詞'].sort());
  noOverlap(result);
});

test('noisy fragments cannot expand a readable passage across artwork', () => {
  const c = canvas();
  for (const y of [30, 52, 74]) c.glyph(120, y);
  for (let y = 0; y < 200; y++) for (let x = 145; x < 151; x++) c.ink(x, y);
  const events = [];
  const result = pipeline.assembleOcrRegions([fragment('日本語', 120, 30, 16, 60), fragment('こいい', 140, 30, 24, 90)], [],
    { pixels: c.pixels, automatic: true, diagnostics: event => events.push(event) });
  assert.equal(result.length, 1);
  assert.equal(result[0].text, '日本語');
  assert.equal(result[0].bbox.x1, 136);
  assert.ok(events.some(event => event.reason === 'unsupported-or-repetitive-ink'));
});

test('original ink rejects clipped hair, eyes, windows, frames, screentones and decorative marks', () => {
  const c = canvas();
  for (let y = 0; y < 180; y++) { c.ink(20 + Math.floor(y / 3), y); c.ink(21 + Math.floor(y / 3), y); }
  for (let y = 40; y < 58; y++) for (let x = 110; x < 140; x++) c.ink(x, y);
  for (let y = 100; y < 220; y++) c.ink(170, y);
  for (let x = 170; x < 280; x++) c.ink(x, 100);
  for (let y = 100; y < 220; y++) c.ink(280, y);
  for (let x = 170; x < 280; x++) c.ink(x, 220);
  for (let x = 185; x < 280; x += 15) for (let y = 100; y < 220; y++) c.ink(x, y);
  for (let y = 30; y < 80; y += 5) for (let x = 200; x < 270; x += 5) for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) c.ink(x + dx, y + dy);
  for (let x = 50; x < 145; x++) c.ink(x, 220);
  const guesses = [fragment('こいい', 40, 60, 28, 48), fragment('日本', 110, 40, 30, 18, 'horizontal'),
    fragment('日本語', 170, 120, 25, 80), fragment('日本語', 210, 96, 60, 12, 'horizontal'),
    fragment('ロロ', 200, 30, 70, 50, 'horizontal'), fragment('一一', 60, 210, 75, 20, 'horizontal')];
  assert.equal(pipeline.assembleOcrRegions(guesses, [], { pixels: c.pixels, automatic: true }).length, 0);
  assert.equal(pipeline.assembleOcrRegions([guesses[0]], [], { pixels: c.pixels, manual: true }).length, 0);
  assert.equal(pipeline.assembleOcrRegions([fragment('日本語', 0, 0, 360, 260, 'horizontal')], [], { pixels: c.pixels, manual: true }).length, 0);
});

test('genuine single-glyph dialogue, short signs and smaller text survive next to large text', () => {
  const c = canvas();
  c.glyph(20, 30, 8);
  c.glyph(80, 30, 10); c.glyph(94, 30, 10);
  for (const y of [30, 66, 102]) c.glyph(220, y, 28);
  const result = pipeline.assembleOcrRegions([fragment('あ', 20, 30, 8, 8, 'horizontal'),
    fragment('出口', 80, 30, 24, 10, 'horizontal'), fragment('日本語', 220, 30, 28, 100)], [], { pixels: c.pixels, automatic: true });
  assert.deepEqual(Array.from(result, r => r.text).sort(), ['あ', '出口', '日本語'].sort());
  noOverlap(result);
});

test('furigana contributes bounds without becoming a competing reading or a neighboring speaker', () => {
  const c = canvas();
  for (const y of [30, 52, 74]) c.glyph(60, y);
  for (const y of [30, 40, 50, 60, 70, 80]) c.glyph(79, y, 6);
  for (const y of [30, 52, 74]) c.glyph(180, y);
  const result = pipeline.assembleOcrRegions([fragment('日本語', 60, 30, 16, 60), fragment('にほんご', 79, 30, 6, 56),
    fragment('別の台詞', 180, 30, 16, 60)], [fragment('にほんご', 79, 30, 6, 56, 'vertical', 85, 'page')], { pixels: c.pixels, automatic: true });
  assert.equal(result.length, 2);
  const body = result.find(r => r.text === '日本語');
  assert.ok(body);
  assert.equal(body.bbox.x1, 85);
  assert.equal(body.fragments.length, 2);
  noOverlap(result);
});

test('crop mapping preserves raw bounds and transforms words/glyphs with the fragment', () => {
  const f = fragment('出口', 10, 10, 40, 20, 'horizontal');
  f.evidence.words = [{ text: '出口', bbox: f.bbox }];
  f.evidence.glyphs = [{ text: '出', bbox: { x0: 10, y0: 10, x1: 28, y1: 30 } }];
  const crop = { id: 'selection', bbox: { x0: 100, y0: 200, x1: 140, y1: 240 }, transform: { originX: 100, originY: 200, scale: 2, padding: 10 } };
  const mapped = geometry.mapCropFragments([f], crop)[0];
  assert.deepEqual({ ...mapped.evidence.rawBounds }, f.bbox);
  assert.deepEqual({ ...mapped.evidence.words[0].bbox }, { x0: 100, y0: 200, x1: 120, y1: 210 });
  assert.equal(mapped.evidence.glyphs[0].bbox.x1, 109);
  assert.equal(f.bbox.x0, 10);
});

test('real narrow digits, Latin suffixes and detached prolonged marks retain their supported ink', () => {
  const c = canvas();
  c.glyph(40, 30); c.glyph(40, 74);
  for (let y = 52; y < 68; y++) { c.ink(46, y); c.ink(47, y); }
  c.glyph(100, 30); c.glyph(132, 30); c.glyph(152, 30);
  for (let y = 28; y < 48; y++) for (let x = 120; x < 124; x++) if (x === 120 || x === 123 || y === 28 || y === 47) c.ink(x, y);
  const result = pipeline.assembleOcrRegions([fragment('ゲ', 40, 30, 16, 16), fragment('ー', 46, 52, 2, 16), fragment('ム', 40, 74, 16, 16),
    fragment('第', 100, 30, 16, 16, 'horizontal'), fragment('1', 120, 28, 4, 20, 'horizontal'),
    fragment('回', 132, 30, 16, 16, 'horizontal'), fragment('V', 152, 30, 16, 16, 'horizontal')], [], { pixels: c.pixels, automatic: true });
  assert.deepEqual(Array.from(result, r => r.text).sort(), ['ゲーム', '第1回V'].sort());
  assert.equal(result.find(r => r.text === 'ゲーム').fragments.length, 3);
  noOverlap(result);
});
