const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createOcrRuntime } = require('./helpers/ocr-runtime.cjs');
const { scanFixture, checkAcceptance } = require('./helpers/ocr-fixtures.cjs');

test('small vertical dialogue on colored backgrounds retains both speakers and excludes artwork', async () => {
  const runtime = createOcrRuntime();
  const manifestPath = path.join(__dirname, 'fixtures/colored-dialogue.json');
  try {
    for (const scale of [1, 2]) {
      const full = await scanFixture(runtime, manifestPath, { scale });
      assert.deepEqual(checkAcceptance(full), [], `scale ${scale}`);
      for (const passage of full.manifest.passages) {
        assert.ok(full.regions.some(region => region.text === passage.text), passage.id);
      }
    }
    const full = await scanFixture(runtime, manifestPath, { preprocess: false });
    assert.deepEqual(checkAcceptance(full), [], 'contrast filter disabled');
    for (const selection of full.manifest.selections) {
      const selected = await scanFixture(runtime, manifestPath, { selection });
      assert.deepEqual(checkAcceptance(selected, selection), [], selection.id);
    }
  } finally { await runtime.engine.terminate(); }
});
