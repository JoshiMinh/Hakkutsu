const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const sourcePath = path.join(
  __dirname,
  "..",
  "src",
  "services",
  "smart-cue.ts"
);
const source = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const moduleBox = { exports: {} };
new Function("exports", "module", "require", compiled)(
  moduleBox.exports,
  moduleBox,
  require
);

const { buildSmartCues, findSmartCue, smartCueEnd } = moduleBox.exports;

const fragments = [
  { text: "今日は", start: 0, duration: 0.5 },
  { text: "暑いですね", start: 0.8, duration: 0.8 },
];
assert.equal(buildSmartCues(fragments, false).length, 2);
const merged = buildSmartCues(fragments, true);
assert.equal(merged.length, 1);
assert.equal(merged[0].text, "今日は暑いですね");

const sentenceBoundary = buildSmartCues(
  [
    { text: "終わりました。", start: 0, duration: 0.5 },
    { text: "次です", start: 0.8, duration: 0.5 },
  ],
  true
);
assert.equal(sentenceBoundary.length, 2);

const switchCues = [
  { text: "古い字幕", start: 0, duration: 3 },
  { text: "新しい字幕", start: 1, duration: 1 },
];
assert.ok(smartCueEnd(switchCues, 0) < 1);
assert.equal(findSmartCue(switchCues, 0.98), null);
assert.equal(findSmartCue(switchCues, 1)?.text, "新しい字幕");

const wordTimed = [
  {
    text: "話しています",
    start: 2,
    duration: 0,
    words: [{ text: "話しています", start: 2, duration: 1.2 }],
  },
];
assert.ok(smartCueEnd(wordTimed, 0) >= 3.2);

console.log("SmartCue tests passed");
