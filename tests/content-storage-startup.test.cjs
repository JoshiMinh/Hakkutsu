const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function loadServices(openDB) {
  const load = (file, imports = {}) => {
    const exports = {};
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(source, {
      exports, require: name => name === 'idb' ? { openDB } : imports[name] || {},
    });
    return exports;
  };
  const analytics = load('src/lib/services/analytics-service.ts');
  const srs = load('src/lib/services/local-srs.ts', { './analytics-service': analytics });
  return [
    () => analytics.analyticsService.getDailyActivity('2026-10-04'),
    () => srs.localSrs.getAllSrsCards(),
  ];
}

test('restricted image documents can import both storage services; denied operations reject and can retry', async () => {
  let attempts = 0;
  const operations = loadServices(() => {
    attempts++;
    throw new DOMException('IndexedDB denied in image document', 'SecurityError');
  });
  assert.equal(attempts, 0, 'Content-script startup must not access page IndexedDB');
  for (const operation of operations) {
    await assert.rejects(operation(), { name: 'SecurityError' });
    await assert.rejects(operation(), { name: 'SecurityError' });
  }
  assert.equal(attempts, 4);
});

test('storage operations share their lazy connection and recover after an asynchronous opening failure', async () => {
  const attempts = new Map();
  const operations = loadServices(name => {
    const count = (attempts.get(name) || 0) + 1;
    attempts.set(name, count);
    if (count === 1) return Promise.reject(new Error('Opening failed'));
    return Promise.resolve({
      get: async () => ({ date: '2026-10-04' }),
      transaction: () => ({ store: { index: () => ({ getAll: async () => [] }) } }),
    });
  });
  for (const operation of operations) {
    await assert.rejects(operation(), /Opening failed/);
    await Promise.all([operation(), operation(), operation()]);
  }
  assert.equal(attempts.get('hakkutsu-analytics'), 2);
  assert.equal(attempts.get('hakkutsu-srs'), 2);
});
