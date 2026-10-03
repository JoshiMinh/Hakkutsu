const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const tesseract = require('tesseract.js');
const root = path.resolve(__dirname, '../..');

function createOcrRuntime() {
  const modules = new Map();
  function load(relative) {
    const file = path.resolve(root, relative);
    if (modules.has(file)) return modules.get(file);
    const exports = {};
    modules.set(file, exports);
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    vm.runInNewContext(source, { exports, console, browser: { runtime: { getURL: value => value } }, require: name => {
      if (name.startsWith('./')) return load(path.resolve(path.dirname(file), `${name}.ts`));
      if (name === 'tesseract.js') return { ...tesseract, createWorker: (language, oem) => tesseract.createWorker(language, oem, {
        langPath: path.join(root, 'public/ocr'), cacheMethod: 'none',
      }) };
      throw new Error(`Unexpected OCR import: ${name}`);
    } }, { filename: file });
    return exports;
  }
  return {
    engine: load('src/lib/services/ocr-engine.ts').ocrEngine,
    geometry: load('src/lib/services/ocr-geometry.ts'),
    bubbles: load('src/lib/services/ocr-bubbles.ts'),
    regions: load('src/lib/services/ocr-regions.ts'),
    pipeline: load('src/lib/services/ocr-pipeline.ts'),
    cropper: load('src/lib/services/image-cropper.ts'),
  };
}
module.exports = { createOcrRuntime, root };
