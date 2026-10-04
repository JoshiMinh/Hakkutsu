const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { createOcrRuntime, root } = require('./helpers/ocr-runtime.cjs');
const runtime = createOcrRuntime();
const { geometry } = runtime;
const intersects = (a, b) => Math.min(a.x1, b.x1) > Math.max(a.x0, b.x0) && Math.min(a.y1, b.y1) > Math.max(a.y0, b.y0);
const b = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });

test('final display guard rejects containment, partial conflicts and invalid bounds in priority order', () => {
  const first = { id: 'latest', bbox: b(10, 20, 30, 70) };
  const adjacent = { id: 'independent', bbox: b(30, 20, 40, 70) };
  const candidates = [first, { id: 'nested', bbox: b(12, 24, 20, 40) },
    { id: 'partial', bbox: b(0, 0, 11, 21) }, adjacent,
    { id: 'invalid', bbox: b(NaN, 0, 20, 30) }, { id: 'empty', bbox: b(20, 0, 20, 30) }];
  const result = geometry.resolveOcrDisplayOverlaps(candidates);
  assert.deepEqual(Array.from(result, item => item.id), ['latest', 'independent']);
  assert.deepEqual(Array.from(geometry.resolveOcrDisplayOverlaps(result), item => item.id), ['latest', 'independent']);
});

test('projection rounds inward at every zoom and clips to the image without expanding small boxes', () => {
  for (const zoom of [.75, 1, 1.25, 1.5, 2]) {
    const rect = { left: 10.25, top: 20.375, width: 200 * zoom, height: 300 * zoom };
    const source = [b(.1, .1, .12, .5), b(.12, .1, .2, .5), b(.3, .55, .8, .6)];
    const projected = source.map(box => geometry.ocrDisplayBounds(box, rect));
    projected.forEach((box, index) => {
      assert.ok(box.x0 >= rect.left + source[index].x0 * rect.width);
      assert.ok(box.x1 <= rect.left + source[index].x1 * rect.width);
      assert.ok(box.y0 >= rect.top + source[index].y0 * rect.height);
      assert.ok(box.y1 <= rect.top + source[index].y1 * rect.height);
    });
    for (let i = 0; i < projected.length; i++) for (let j = i + 1; j < projected.length; j++) assert.equal(intersects(projected[i], projected[j]), false);
    const clipped = geometry.ocrDisplayBounds(b(-.2, -.1, 1.1, 1.2), rect);
    assert.ok(clipped.x0 >= rect.left && clipped.x1 <= rect.left + rect.width);
  }
});

// Render the actual component and its CSS, with retained scan evidence. Model
// recognition and coverage have their own bundled-model fixture gate.
function renderScans(scans, { hoveredImage = null, error = null } = {}) {
  let state = 0;
  const react = { ...React, useState: initial => {
    const index = state++;
    return [index === 0 ? hoveredImage : index === 1 ? scans : index === 4 ? error : initial, () => {}];
  },
    useRef: initial => ({ current: initial }), useCallback: fn => fn, useEffect() {} };
  const imports = {
    react, '~lib/services/ocr-geometry': geometry, '~lib/services/ocr-regions': runtime.regions,
    '~lib/services/ocr-pipeline': runtime.pipeline, '~lib/services/ocr-bubbles': runtime.bubbles,
    '~lib/services/image-cropper': runtime.cropper,
    '~lib/utils/settings': { useSettingsStore: () => ({ settings: {} }) },
    '~lib/locales': { useTranslation: () => ({ t: key => key }) },
  };
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(root, 'src/components/manga-ocr-images.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, window: { innerWidth: 800, innerHeight: 700 }, require: name => imports[name] || require(name) });
  return renderToStaticMarkup(exports.MangaOcrImages());
}

test('empty OCR notices expose a selectable recovery action and dismissal; runtime failures are alerts', () => {
  const hoveredImage = { isConnected: true, getBoundingClientRect: () => ({
    left: 10, top: 10, right: 400, bottom: 500, width: 390, height: 490,
  }) };
  for (const error of ['ocr_no_text_hint', 'ocr_unreadable_text', 'ocr_rejected_text']) {
    const html = renderScans([], { hoveredImage, error });
    assert.ok(html.includes('role="status"'));
    assert.equal((html.match(/ocr_btn_select_box/g) || []).length, 3); // Toolbar label, aria-label, and notice action.
    assert.ok(html.includes('aria-label="dict_btn_close"'));
    assert.ok(html.includes('aria-pressed="false"'));
  }
  assert.ok(renderScans([], { hoveredImage, error: 'ocr_recognition_failed' }).includes('role="alert"'));
});
function scan(id, rect, boxes) {
  return { src: id, image: { isConnected: true, currentSrc: id, getBoundingClientRect: () => rect },
    highlights: boxes.map((box, index) => ({ id: `${id}:${index}`, text: '日本語', imageUrl: 'crop',
      x: box.x0, y: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0 })) };
}
const chrome = process.env.HAKKUTSU_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

test('Chrome rendered button bounds never overlap at all zooms, including thin boxes and focus styling', {
  skip: !fs.existsSync(chrome), timeout: 60000,
}, () => {
  const scenarios = [];
  for (const zoom of [.75, 1, 1.25, 1.5, 2]) {
    const rect = { left: 10.25, top: 20.375, width: 200 * zoom, height: 200 * zoom };
    // Width < 3px exposed the previous CSS border's minimum rendered width.
    scenarios.push({ expected: 3, html: renderScans([scan('thin', rect, [b(.1, .1, .114, .4), b(.114, .1, .13, .4), b(.3, .5, .8, .6)])]) });
    scenarios.push({ expected: 2, html: renderScans([
      scan('old', rect, [b(.1, .1, .2, .4), b(.6, .1, .8, .4)]),
      scan('new', rect, [b(.15, .15, .3, .4)]),
    ]) });
  }
  const output = path.join(root, 'test-results/ocr/display');
  fs.mkdirSync(output, { recursive: true });
  const file = path.join(output, 'chrome-bounds.html');
  const expected = scenarios.map(scene => scene.expected);
  fs.writeFileSync(file, `<!doctype html><meta charset="utf-8"><style>.scenario{display:none}</style>
    ${scenarios.map(scene => `<div class="scenario">${scene.html}</div>`).join('')}
    <pre id="result"></pre><script>
    const errors=[], expected=${JSON.stringify(expected)};
    const intersects=(a,b)=>Math.min(a.right,b.right)>Math.max(a.left,b.left)&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top);
    document.querySelectorAll('.scenario').forEach((scene,index)=>{
      scene.style.display='block';
      const buttons=[...scene.querySelectorAll('.hk-manga-region')];
      if(buttons.length!==expected[index]) errors.push('Missing dialogue in scenario '+index);
      for(const focused of [false,true]) {
        buttons.forEach(button=>{if(focused)button.focus();
          const r=button.getBoundingClientRect();
          if(r.width>parseFloat(button.style.width)||r.height>parseFloat(button.style.height))errors.push('Expanded button '+index);
        });
        const rectangles=buttons.map(button=>button.getBoundingClientRect());
        for(let i=0;i<rectangles.length;i++)for(let j=i+1;j<rectangles.length;j++)if(intersects(rectangles[i],rectangles[j]))errors.push('Overlap '+index);
      }
      scene.style.display='none';
    });
    document.getElementById('result').textContent=JSON.stringify({scenarios:expected.length,errors});
    </script>`);
  const result = spawnSync(chrome, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${path.join(output, 'profile')}`, '--dump-dom', pathToFileURL(file).href], { encoding: 'utf8', timeout: 45000, windowsHide: true });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
  const match = result.stdout.match(/<pre id="result">([^<]+)<\/pre>/);
  assert.ok(match, 'Chrome did not return a layout report');
  const report = JSON.parse(match[1].replace(/&quot;/g, '"'));
  fs.writeFileSync(path.join(output, 'chrome-bounds.json'), JSON.stringify(report, null, 2));
  assert.equal(report.scenarios, 10);
  assert.deepEqual(report.errors, []);
});
