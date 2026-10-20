const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loader } = require("./load-typescript.cjs");
const load = loader();
const { resolveDensityVocabulary, densityKnowledge } = load("src/features/analytics/density-vocabulary.ts");
const lexicon = require("../src/shared/japanese/data/density-jlpt.json");

test("bundled vocabulary covers all levels, retains ambiguities, and uses no substring grading", async () => {
  assert.ok(Object.keys(lexicon).length > 13000);
  for (const level of ["N1", "N2", "N3", "N4", "N5"]) assert.ok(Object.values(lexicon).includes(level));
  const words = await resolveDensityVocabulary(["学校。便利。連載。破棄。こんにちは。学校。", "𠮷謎語。12345。English"]);
  assert.equal(words.find(word => word.lemma === "学校").count, 2);
  assert.ok(words.some(word => word.lemma === "こんにちは"));
  assert.ok(!words.some(word => /English|12345/.test(word.lemma)));
  assert.ok(words.some(word => word.level === null));
  const ambiguous = Object.keys(lexicon).find(key => lexicon[key] === null && /^[\p{Script=Han}]+$/u.test(key));
  assert.equal((await resolveDensityVocabulary([ambiguous]))[0].level, null);
});

test("confirmed conjugations merge to dictionary forms without crossing punctuation", async () => {
  const words = await resolveDensityVocabulary(["食べた。食べました。読みました。聞き返す。", "学校。学校"]);
  assert.equal(words.find(word => word.lemma === "食べる").count, 2);
  assert.equal(words.find(word => word.lemma === "読む").count, 1);
  assert.equal(words.find(word => word.lemma === "学校").count, 2);
  const first = await resolveDensityVocabulary(["学校。"]);
  first[0].count = 999;
  assert.equal((await resolveDensityVocabulary(["学校。"]))[0].count, 1);
});

test("maturity excludes new/learning/relearning and never expands compound kanji", () => {
  const result = densityKnowledge([
    {word:"学校",state:2,interval:21,repetition:2},
    {word:"学生",state:3,interval:90,repetition:10},
    {word:"日本",state:1,interval:90,repetition:10},
    {word:"読む",state:0,interval:90,repetition:10},
    {word:"食べる",interval:21,repetition:1},
    {word:"便利",interval:90,repetition:0},
    {word:"かな",state:2,interval:20,repetition:10},
    {word:"ｶﾅ",state:2,interval:21,repetition:2},
  ]);
  assert.deepEqual(result.mature, ["学校", "食べる", "カナ"]);
  assert.deepEqual(result.learning, ["学生", "日本", "読む", "便利", "かな"]);
  assert.ok(!result.mature.includes("学"));
});

const analyzer = loader({"./density-content": {
  densityContent: async root => ({texts: root.texts, scope:"selection"}),
  checkDensityAbort: signal => signal?.throwIfAborted(),
}})("src/features/analytics/page-analyzer.ts");
global.window = {location:{href:"https://example.test/chapter"}};

test("density uses all letters/numbers and occurrence-weighted vocabulary, not kanji", async () => {
  global.chrome = {runtime:{sendMessage:async message => message.type === "GET_DENSITY_KNOWLEDGE"
    ? {type:"DENSITY_KNOWLEDGE_RESULT",payload:{mature:["学校"],learning:["便利"]}}
    : {type:"DENSITY_VOCABULARY_RESULT",payload:{words:await resolveDensityVocabulary(message.payload.texts)}} }};
  const result = await analyzer.analyzePageDensity({texts:["学校。学校。便利。abc123。𠮷。"]});
  assert.equal(result.totalTextChars, 13); assert.equal(result.totalJapaneseChars, 7);
  assert.equal(result.totalKanji, 7); assert.equal(result.uniqueKanji, 5);
  assert.equal(result.totalWords, 4); assert.equal(result.uniqueWords, 3);
  assert.equal(result.scriptDensity, 7 / 13 * 100);
  assert.deepEqual(result.familiarity, {status:"available",mature:2,learning:1,notSaved:1});
  assert.equal(result.dominantLevel, null);
  assert.equal(Object.values(result.percentages).reduce((a,b)=>a+b,0),100);
  const chapter = await analyzer.analyzePageDensity({texts:["学校。".repeat(20)]});
  assert.equal(chapter.coverage, 100); assert.equal(chapter.dominantLevel, "N5");
  const katakana = await analyzer.analyzePageDensity({texts:["パーティー。ｺｰﾋｰ！"]});
  assert.equal(katakana.scriptDensity,100); // Prolonged sound marks share the kana scripts.
  assert.equal(katakana.totalJapaneseChars,9);
});

test("rounding, empty text, low coverage, and endpoint failures are explicit", async () => {
  assert.deepEqual(analyzer.balancedPercentages({N5:1,N4:1,N3:1,N2:0,N1:0,unranked:0}), {N5:34,N4:33,N3:33,N2:0,N1:0,unranked:0});
  global.chrome = {runtime:{sendMessage:async () => {throw new Error("unavailable")}}};
  const empty = await analyzer.analyzePageDensity({texts:[]});
  assert.equal(empty.scriptDensity, 0); assert.equal(empty.totalWords, 0);
  assert.equal(empty.dominantLevel, null); assert.equal(empty.familiarity.status,"unavailable");
  const failure = await analyzer.analyzePageDensity({texts:["学校"]});
  assert.equal(failure.vocabularyStatus,"unavailable"); assert.equal(failure.totalJapaneseChars,2);
  assert.equal(failure.familiarity.notSaved,0);
  global.chrome.runtime.sendMessage = async message => message.type === "GET_DENSITY_KNOWLEDGE" ? {type:"ERROR"} : {type:"DENSITY_VOCABULARY_RESULT",payload:{words:[{lemma:"school",level:"N5",count:5},{lemma:"unknown",level:null,count:20}]}};
  const low = await analyzer.analyzePageDensity({texts:["学校"]});
  assert.equal(low.coverage,20); assert.equal(low.dominantLevel,null); assert.equal(low.familiarity.status,"unavailable");
});

test("density messages validate batch bounds and keep SRS failures separate", async () => {
  const {handleDensityMessage} = loader({"~/features/srs/local-srs":{localSrs:{getAllSrsCards:async()=>{throw new Error("SRS down")}}}})("src/features/analytics/density-messages.ts");
  for (const texts of [null,[42],["a".repeat(2001)],Array(9).fill("学校")]) await assert.rejects(handleDensityMessage({type:"GET_DENSITY_VOCABULARY",payload:{texts}}),/Invalid density batch/);
  await assert.rejects(handleDensityMessage({type:"GET_DENSITY_KNOWLEDGE"}),/SRS down/);
  assert.equal((await handleDensityMessage({type:"GET_DENSITY_VOCABULARY",payload:{texts:["学校"]}})).payload.words[0].level,"N5");
});
