const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const edge = process.env.HAKKUTSU_EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const bundle = path.resolve('.output/chrome-mv3/content-scripts/inline-dictionary.js');

test('production content script mounts OCR immediately in a native image document with denied IndexedDB', {
  skip: !fs.existsSync(edge) || !fs.existsSync(bundle), timeout: 60000,
}, async () => {
  const output = path.resolve('test-results/ocr/image-document');
  const extension = path.join(output, 'extension');
  fs.mkdirSync(extension, { recursive: true });
  fs.copyFileSync(bundle, path.join(extension, 'inline-dictionary.js'));
  fs.writeFileSync(path.join(extension, 'manifest.json'), JSON.stringify({
    manifest_version: 3, name: 'Hakkutsu image document regression', version: '1.0',
    permissions: ['storage'],
    content_scripts: [{ matches: ['http://127.0.0.1/*'], js: ['observe.js', 'inline-dictionary.js'] }],
  }));
  fs.writeFileSync(path.join(extension, 'observe.js'), `
    const errors=[];
    const originalError=console.error;
    console.error=(...args)=>{errors.push(args.map(String).join(' ')); originalError(...args);};
    // Loopback image documents permit IDB in some Chromium versions. Reproduce
    // the SecurityError observed on the user's remote standalone image page.
    Object.defineProperty(globalThis,'indexedDB',{get(){throw new DOMException('Image document storage denied','SecurityError');}});
    let denied=false;
    try { indexedDB.open('hakkutsu-image-regression'); } catch(e) { denied=e.name==='SecurityError'; }
    setInterval(()=>{
      const host=document.querySelector('hakkutsu-inline-dictionary-host');
      const buttons=[...(host?.shadowRoot?.querySelectorAll('button[data-hakkutsu-manga-ocr]')||[])];
      document.body.setAttribute('data-image-report',JSON.stringify({
        contentType:document.contentType,denied,host:!!host,
        controls:buttons.map(b=>({text:b.textContent,disabled:b.disabled,width:b.getBoundingClientRect().width})),errors
      }));
    },100);
  `);
  const image = fs.readFileSync('tests/fixtures/colored-dialogue.png');
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(image);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/panel.png/revision/latest?cb=regression`;
    const result = await new Promise((resolve, reject) => {
      const process = spawn(edge, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        `--user-data-dir=${path.join(output, 'profile')}`, `--load-extension=${extension}`,
        '--virtual-time-budget=6000', '--dump-dom', `--screenshot=${path.join(output, 'image-document.png')}`, url], { windowsHide: true });
      let stdout = '', stderr = '';
      process.stdout.on('data', data => stdout += data);
      process.stderr.on('data', data => stderr += data);
      const timeout = setTimeout(() => { process.kill(); reject(new Error('Image document test timed out')); }, 45000);
      process.on('error', error => { clearTimeout(timeout); reject(error); });
      process.on('close', code => { clearTimeout(timeout); resolve({ code, stdout, stderr }); });
    });
    assert.equal(result.code, 0, result.stderr);
    const match = result.stdout.match(/data-image-report="([^"]+)"/);
    assert.ok(match, `Test extension did not return a document report: ${result.stdout.slice(0, 800)} ${result.stderr.slice(-1000)}`);
    const report = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
    fs.writeFileSync(path.join(output, 'image-document.json'), JSON.stringify(report, null, 2));
    assert.equal(report.contentType, 'image/png');
    assert.equal(report.denied, true);
    assert.equal(report.host, true);
    assert.equal(report.controls.length, 2);
    assert.ok(report.controls.every(button => !button.disabled && button.width > 0));
    assert.deepEqual(report.errors, []);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
