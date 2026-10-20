const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loader } = require("./load-typescript.cjs");
const load = loader();
const { resolveFuriganaTexts } = load("src/features/analytics/furigana-readings.ts");
const { distributeFurigana } = load("src/shared/japanese/japanese.ts");
const { splitFuriganaText, shouldInjectForMode } = load("src/features/analytics/furigana-injector.ts");
const { learnedVocabulary } = load("src/features/analytics/page-text.ts");
const entry = (word, reading, jlpt = "N5") => ({id:word,kanjiElements:[word],readingElements:[reading],senses:[],jlpt});
const { getHanViet, resolveHanViet } = load("src/shared/japanese/hanviet-dict.ts");

test("Hán-Việt covers screenshot regressions and repairs partial saved values", () => {
  assert.equal(getHanViet("便利"), "TIỆN LỢI");
  assert.equal(getHanViet("連載"), "LIÊN TẢI");
  assert.equal(getHanViet("破棄"), "PHÁ KHÍ");
  assert.equal(resolveHanViet("破棄", "PHÁ"), "PHÁ KHÍ");
  assert.equal(resolveHanViet("はき", undefined, "破棄"), "PHÁ KHÍ");
  assert.equal(getHanViet("棄却"), "KHÍ KHƯỚC");
  assert.equal(resolveHanViet("便利", "LỢI"), "TIỆN LỢI");
  assert.equal(resolveHanViet("連載", "  "), "LIÊN TẢI");
  assert.equal(resolveHanViet("べんり", undefined, "便利"), "TIỆN LỢI");
  assert.equal(resolveHanViet("行", "hàng"), "HÀNG");
});

test("Hán-Việt supports shinjitai, compatibility characters, kana and iteration marks", () => {
  assert.equal(getHanViet("学校"), "HỌC HIỆU");
  assert.equal(getHanViet("學校"), "HỌC HIỆU");
  assert.equal(getHanViet("想像"), "TƯỞNG TƯỢNG");
  assert.equal(getHanViet("歌"), "CA");
  assert.equal(getHanViet("食べる"), "THỰC");
  assert.equal(getHanViet("時々"), "THỜI THỜI");
  assert.equal(getHanViet("神"), getHanViet("神"));
  assert.equal(getHanViet("こんにちは"), "");
  assert.equal(resolveHanViet("kana", "made up"), "");
});

test("Hán-Việt never displays an incomplete compound for an uncovered character", () => {
  assert.equal(getHanViet("便利\u{31350}"), "");
  assert.equal(resolveHanViet("便利\u{31350}", "LỢI"), "");
});

test("local readings preserve source including spaces, punctuation and inflections", async () => {
  const dictionary = new Map([["学校", entry("学校", "がっこう")], ["食べる", entry("食べる", "たべる")], ["今日", entry("今日", "きょう")]]);
  const text = "  学校で食べた。今日！\n";
  const [words] = await resolveFuriganaTexts([text], async word => dictionary.has(word) ? [dictionary.get(word)] : []);
  assert.equal(words.map(word => word.text).join(""), text);
  assert.equal(words.find(word => word.text === "食べた").reading, "たべた");
  assert.equal(words.find(word => word.text === "今日").reading, "きょう");
});

test("wrong reading alignment is rejected; unknown names are not guessed", async () => {
  const [words] = await resolveFuriganaTexts(["食べる。髙橋鶴見"], async word => word === "食べる" ? [entry(word, "のむ")] : []);
  assert.ok(words.every(word => !word.reading));
  assert.deepEqual(distributeFurigana("聞き返す", "ききかえす"), [{text:"聞",ruby:"き"},{text:"き"},{text:"返",ruby:"かえ"},{text:"す"}]);
});

test("successful and missing word lookups are deduplicated across paragraphs", async () => {
  const counts = new Map();
  await resolveFuriganaTexts(["学校。鶴見。", "学校。鶴見。"], async word => {
    counts.set(word, (counts.get(word) || 0) + 1); return word === "学校" ? [entry(word, "がっこう")] : [];
  });
  assert.ok([...counts.values()].every(count => count === 1));
});

test("selective levels and mastered vocabulary share consistent kanji knowledge", () => {
  const known = new Set(learnedVocabulary([{word:"学校",interval:21,repetition:0},{word:"日本",interval:1,repetition:0}]));
  assert.ok(known.has("学")); assert.ok(!known.has("日"));
  assert.equal(shouldInjectForMode("学校", "N5", "unlearned", known), false);
  assert.equal(shouldInjectForMode("日本", "N5", "unlearned", known), true);
  for (const mode of ["n3_plus", "n2_plus", "n1_only"]) {
    assert.equal(shouldInjectForMode("学校", "N5", mode, known), false);
    assert.equal(shouldInjectForMode("学校", "N1", mode, known), true);
  }
});

test("bounded chunks round-trip long text and never split a surrogate pair", () => {
  for (const text of ["a".repeat(1799) + "𠮷" + "学校".repeat(5000), "学校。\n".repeat(2000)]) {
    const chunks = splitFuriganaText(text);
    assert.equal(chunks.join(""), text);
    assert.ok(chunks.every(chunk => chunk.length <= 2000 && !/[\uD800-\uDBFF]$/u.test(chunk)));
  }
});

test("background handler validates batches and explicitly reports missing dictionaries", async () => {
  let installed = false, queries = 0;
  const handlerLoad = loader({
    "~/features/dictionary/local-lookup": {
      getDB: async () => ({count: async () => installed ? 1 : 0}),
      searchDictionary: async word => { queries++; return word === "学校" ? [entry(word, "がっこう")] : []; },
    },
    "~/features/srs/local-srs": {localSrs:{getAllSrsCards:async()=>[{word:"学校",interval:21,repetition:0}]}},
  });
  const { handleFuriganaMessage } = handlerLoad("src/features/analytics/furigana-messages.ts");
  for (const texts of [null, [42], ["a".repeat(2001)], Array(9).fill("学校")]) {
    await assert.rejects(handleFuriganaMessage({type:"GET_FURIGANA_READINGS",payload:{texts}}), /Invalid furigana batch/);
  }
  await assert.rejects(handleFuriganaMessage({type:"GET_FURIGANA_READINGS",payload:{texts:["学校"]}}), /Install a local dictionary/);
  assert.equal(queries, 0);
  installed = true;
  const response = await handleFuriganaMessage({type:"GET_FURIGANA_READINGS",payload:{texts:["学校"]}});
  assert.equal(response.type, "FURIGANA_READINGS_RESULT");
  assert.equal(response.payload.readings[0][0].reading, "がっこう");
  const knowledge = await handleFuriganaMessage({type:"GET_LEARNED_VOCABULARY"});
  assert.ok(knowledge.payload.words.includes("学"));
});

test("dictionary import validates every entry before writing, normalizes IDs and rolls back failures", async () => {
  let opened = 0, aborted = false, fail = false;
  const written = [];
  const importLoad = loader({"./local-lookup": {getDB:async()=> {
    opened++;
    return {
      transaction:()=>({store:{put:async value=> { if (fail) throw new Error("disk full"); written.push(value); }},done:Promise.resolve(),abort:()=>{aborted=true;}}),
      count:async()=>written.length,
    };
  }}});
  const { importDictionary } = importLoad("src/features/dictionary/dictionary-sync.ts");
  for (const data of [[], null, [{id:"x"}], [entry("学校", "がっこう"), {...entry("日本","にほん"),readingElements:[]} ]]) {
    await assert.rejects(importDictionary(data), /Dictionary/);
  }
  assert.equal(opened,0); assert.equal(written.length,0);
  assert.equal(await importDictionary([{...entry("学校","がっこう"),id:123}]),1);
  assert.equal(written[0].id,"123");
  fail = true;
  await assert.rejects(importDictionary([entry("日本","にほん")]),/disk full/);
  assert.equal(aborted,true);
});
