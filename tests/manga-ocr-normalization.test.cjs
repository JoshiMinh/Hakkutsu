const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function loadOcrEngine() {
  const source = ts.transpileModule(
    fs.readFileSync("src/lib/services/ocr-engine.ts", "utf8"),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
    }
  ).outputText;
  const context = {
    exports: {},
    browser: { runtime: { getURL: (p) => p } },
    require: (name) => {
      if (name === "tesseract.js") return { createWorker: async () => ({}), PSM: {} };
      return require(name);
    },
  };
  vm.runInNewContext(source, context);
  return context.exports.ocrEngine;
}

test("cleanOcrText normalizes Katakana prolonged sound mark 1/l/I to ー and strips intra-bubble line breaks", () => {
  const ocrEngine = loadOcrEngine();
  const input = "クラ\nウン\nゲー\n1\nムセン\nター";
  const cleaned = ocrEngine.cleanOcrText(input);
  assert.equal(cleaned, "クラウンゲームセンター");
});

test("cleanOcrText repairs vertical Katakana words like セ1ラーV and センタ1", () => {
  const ocrEngine = loadOcrEngine();
  assert.equal(ocrEngine.cleanOcrText("セ1ラーV"), "セーラーV");
  assert.equal(ocrEngine.cleanOcrText("センタ1"), "センター");
  assert.equal(ocrEngine.cleanOcrText("ゲー|ム"), "ゲーム");
});

test("cleanOcrText joins multi-line Japanese speech bubble dialogue into a cohesive sentence", () => {
  const ocrEngine = loadOcrEngine();
  const input = "はぁ〜〜\nこんなテスト\nもって\n帰りたく\nな〜〜い〜〜";
  const cleaned = ocrEngine.cleanOcrText(input);
  assert.equal(cleaned, "はぁ〜〜こんなテストもって帰りたくな〜〜い〜〜");
});

test("cleanOcrText normalizes prolonged vertical sound marks and punctuation", () => {
  const ocrEngine = loadOcrEngine();
  const input = "えーーっ\r\nたおれないぞ\r\nこの\r\nザコ・キャラは";
  const cleaned = ocrEngine.cleanOcrText(input);
  assert.equal(cleaned, "えーーったおれないぞこのザコ・キャラは");
});
