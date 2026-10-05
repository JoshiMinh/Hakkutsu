const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const sharp = require('sharp');
const { createOcrRuntime } = require('./helpers/ocr-runtime.cjs');
const { scanFixture, intersects } = require('./helpers/ocr-fixtures.cjs');

test('reported manga typography retains both vertical passages, furigana and slanted punctuation', async () => {
  const runtime = createOcrRuntime();
  const manifest = path.join(__dirname, 'fixtures/vertical-furigana-dialogue.json');
  const expected = ['てめーの仕事だ！', '死んでも放すなよ！！'];
  try {
    for (const preprocess of [true, false]) {
      const full = await scanFixture(runtime, manifest, { preprocess });
      assert.deepEqual(Array.from(full.regions, r => r.text).sort(), [...expected].sort());
      assert.ok(full.regions.every(r => r.orientation === 'vertical'));
      assert.equal(intersects(full.regions[0].bbox, full.regions[1].bbox), false);
      assert.ok(full.regions.find(r => r.text === expected[1]).bbox.x1 >= 114, 'furigana remains inside the lookup image');
      for (const [index, selection] of full.manifest.selections.entries()) {
        const selected = await scanFixture(runtime, manifest, { selection, preprocess });
        assert.deepEqual(Array.from(selected.regions, r => r.text), [expected[index]]);
      }
    }
    const enlarged = await scanFixture(runtime, manifest, { scale: 2 });
    assert.deepEqual(Array.from(enlarged.regions, r => r.text).sort(), [...expected].sort());
    // Force the selected-image detection fallback, which must translate every
    // piece of evidence back to source coordinates along with the body boxes.
    const detect = runtime.bubbles.detectMangaDialogueRegions;
    let calls = 0;
    runtime.bubbles.detectMangaDialogueRegions = pixels => ++calls === 1 ? [] : detect(pixels);
    try {
      const fallback = await scanFixture(runtime, manifest, { selection: { id: 'fallback', bbox: [2,2,318,238] } });
      assert.deepEqual(Array.from(fallback.regions, r => r.text).sort(), [...expected].sort());
      const punctuation = fallback.detected.find(r => r.terminalPunctuation?.text === '！').terminalPunctuation;
      assert.deepEqual({ ...punctuation.bbox }, {x0:224,y0:136,x1:239,y1:162});
    } finally { runtime.bubbles.detectMangaDialogueRegions = detect; }
  } finally { await runtime.engine.terminate(); }
});

test('a slanted stroke without a detached dot is not repaired to an exclamation mark', async () => {
  const runtime = createOcrRuntime();
  const { data, info } = await sharp(path.join(__dirname, 'fixtures/vertical-furigana-dialogue.png'))
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = { data: new Uint8ClampedArray(data), width: info.width, height: info.height };
  const detected = runtime.bubbles.detectMangaDialogueRegions(pixels);
  assert.equal(detected.filter(r => r.terminalPunctuation).length, 2);
  // Remove only the detached dots; the slanted stems and all dialogue remain.
  for (const [x0, y0, x1, y1] of [[224,156,239,162], [39,185,63,191]]) {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * pixels.width + x) * 4;
      pixels.data[i] = pixels.data[i+1] = pixels.data[i+2] = 255;
    }
  }
  assert.ok(runtime.bubbles.detectMangaDialogueRegions(pixels).every(r => !r.terminalPunctuation));
});
