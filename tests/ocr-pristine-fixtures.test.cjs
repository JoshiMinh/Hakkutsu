const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createOcrRuntime } = require('./helpers/ocr-runtime.cjs');
const { scanFixture, checkAcceptance, intersects } = require('./helpers/ocr-fixtures.cjs');

test('bundled models retain every pristine passage and separate speakers without artwork or overlaps', async () => {
  const runtime = createOcrRuntime();
  const manifestPath = path.join(__dirname, 'fixtures/reliable-regions.json');
  try {
    const full = await scanFixture(runtime, manifestPath);
    assert.deepEqual(checkAcceptance(full), []);
    assert.ok(full.regions.some(r => r.text === 'クラウンゲームセンター'));
    assert.ok(full.regions.some(r => r.text === '本を読みます楽しいです'));
    const scaled = await scanFixture(runtime, manifestPath, { scale: 2 });
    assert.deepEqual(checkAcceptance(scaled), [], 'original-image preparation at 2x');
    for (const zoom of [.75, 1, 1.25, 1.5, 2]) {
      const displayed = full.regions.map(region => ({ x0: 17 + region.bbox.x0 * zoom, y0: -80 + region.bbox.y0 * zoom,
        x1: 17 + region.bbox.x1 * zoom, y1: -80 + region.bbox.y1 * zoom }));
      for (let i = 0; i < displayed.length; i++) for (let j = i + 1; j < displayed.length; j++) assert.equal(intersects(displayed[i], displayed[j]), false);
    }
    for (const selection of full.manifest.selections) {
      const selected = await scanFixture(runtime, manifestPath, { selection });
      assert.deepEqual(checkAcceptance(selected, selection), [], selection.id);
    }
  } finally { await runtime.engine.terminate(); }
});
