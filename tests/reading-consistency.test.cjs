const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loader } = require("./load-typescript.cjs");
const load = loader();
const japanese = load("src/shared/japanese/japanese.ts");
const { getHanViet } = load("src/shared/japanese/hanviet-dict.ts");
const { getCommonWord } = load("src/features/dictionary/dictionary-lookup.ts");
const entry = (word, ...readings) => ({ id: word, kanjiElements: [word], readingElements: readings,
  senses: [{ glosses: ["local definition"], partOfSpeech: ["Verb"] }] });

function analysisFixture(dictionary = new Map(), language = "vi") {
  const calls = { local: new Map(), remote: 0 };
  const { analyzeLocal } = loader({
    "~/features/settings/settings-storage": { getSettings: async () => ({ targetLanguage: language }) },
    "~/features/dictionary/local-lookup": { searchDictionary: async word => {
      calls.local.set(word, (calls.local.get(word) || 0) + 1);
      return dictionary.has(word) ? [dictionary.get(word)] : [];
    } },
    "~/features/dictionary/dictionary-lookup": { getCommonWord, lookupWord: async () => {
      calls.remote++; throw new Error("Offline");
    } },
    "~/features/dictionary/google-translate": { googleTranslateService: { translate: async () => { throw new Error("Offline"); } } },
  })("src/features/dictionary/background-analysis.ts");
  return { analyzeLocal, calls };
}

test("surface readings normalize kana variants and reject mismatched okurigana", () => {
  assert.equal(japanese.resolveSurfaceReading("食べる", "ノム、タベル"), "たべる");
  assert.equal(japanese.resolveSurfaceReading("学校", "ｶﾞｯｺｳ"), "がっこう");
  assert.equal(japanese.resolveSurfaceReading("食べる", "たべた"), "");
  assert.equal(japanese.resolveSurfaceReading("学校", "school"), "");
  assert.equal(japanese.resolveSurfaceReading("食へ\u3099る", "たべる"), "たべる");
});

test("supplementary kanji preserve UTF-16 boundaries in inflection and ruby", () => {
  assert.equal(japanese.hasKanji("𠮷"), true);
  assert.equal(japanese.countKanji("𠮷野家"), 3);
  assert.equal(japanese.deriveInflectedReading("𠮷けた", "𠮷ける", "よしける"), "よしけた");
  assert.deepEqual(japanese.distributeFurigana("𠮷野家", "よしのや"), [{ text: "𠮷野家", ruby: "よしのや" }]);
  assert.deepEqual(japanese.distributeFurigana("𠮷[よし][注]", ""), [{ text: "𠮷", ruby: "よし" }, { text: "[注]" }]);
  assert.deepEqual(japanese.distributeFurigana("[注]学校", ""), [{ text: "[注]学校" }]);
});

test("Hán Việt for 語 agrees in bundled lookups and sentence tokens", async () => {
  assert.equal(getHanViet("日本語"), "NHẬT BẢN NGỮ");
  assert.equal(getHanViet("言語"), "NGÔN NGỮ");
  assert.equal(getCommonWord("日本語", "vi").hanviet, "NHẬT BẢN NGỮ");
  const { analyzeLocal } = analysisFixture();
  const result = await analyzeLocal("日本語", false);
  assert.equal(result.tokens[0].vietnamese_sound, getCommonWord("日本語", "vi").hanviet);
});

test("subtitles preserve whitespace and keep inflected and dictionary readings separate", async () => {
  const { analyzeLocal, calls } = analysisFixture();
  const text = "  食べた。学校で日本語！\n";
  const result = await analyzeLocal(text, false);
  assert.equal(result.tokens.map(token => token.surface).join(""), text);
  assert.equal(result.sentence_reading, "  たべた。がっこうでにほんご！\n");
  const token = result.tokens.find(token => token.surface === "食べた");
  assert.equal(token.dictionary_form, "食べる");
  assert.equal(token.dictionary_reading, "たべる");
  assert.equal(token.reading.hiragana, "たべた");
  assert.equal(calls.remote, 0);
  assert.ok([...calls.local.values()].every(count => count === 1));
});

test("dictionary-confirmed polite, negative and godan conjugations retain their lemma", async () => {
  const dictionary = new Map([entry("書く", "かく"), entry("買う", "かう"), entry("聞き返す", "ききかえす")].map(value => [value.id, value]));
  const { analyzeLocal } = analysisFixture(dictionary);
  for (const [surface, lemma, reading] of [
    ["書きました", "書く", "かきました"], ["書かない", "書く", "かかない"],
    ["買った", "買う", "かった"], ["聞き返した", "聞き返す", "ききかえした"],
  ]) {
    const result = await analyzeLocal(surface, false);
    assert.equal(result.tokens.length, 1, surface);
    assert.equal(result.tokens[0].dictionary_form, lemma, surface);
    assert.equal(result.tokens[0].reading.hiragana, reading, surface);
  }
});

test("invalid dictionary reading alternatives and unknown names cannot become furigana", async () => {
  const { analyzeLocal, calls } = analysisFixture(new Map([["食べる", entry("食べる", "のむ", "タベル")]]));
  assert.equal((await analyzeLocal("食べる", false)).tokens[0].reading.hiragana, "たべる");
  const result = await analyzeLocal("髙橋鶴見", false);
  assert.ok(result.tokens.every(token => !token.reading.hiragana));
  assert.equal(calls.remote, 0);
});

test("来る conjugations change the kanji reading without changing 出来る", async () => {
  for (const [surface, reading] of [["来た", "きた"], ["来ました", "きました"], ["来ない", "こない"],
    ["来れば", "くれば"], ["来よう", "こよう"], ["来られる", "こられる"]]) {
    assert.equal(japanese.deriveInflectedReading(surface, "来る", "くる"), reading, surface);
  }
  assert.equal(japanese.deriveInflectedReading("出来た", "出来る", "できる"), "できた");
  const { analyzeLocal } = analysisFixture();
  assert.equal((await analyzeLocal("来ました", false)).tokens[0].reading.hiragana, "きました");
  assert.equal((await analyzeLocal("来ない", false)).tokens[0].reading.hiragana, "こない");
});

test("dictionary lookup uses the same lemma, readings and Hán Việt as subtitles", async () => {
  const { analyzeLocal, calls } = analysisFixture();
  const subtitles = await analyzeLocal("食べた", false);
  const lookup = await analyzeLocal("食べた", true);
  for (const property of ["dictionary_form", "dictionary_reading", "reading", "vietnamese_sound"]) {
    assert.deepEqual(lookup.tokens[0][property], subtitles.tokens[0][property]);
  }
  assert.deepEqual(lookup.tokens[0].definitions[0].glosses, ["ăn"]);
  assert.equal(calls.remote, 0);
});

test("lookup context preserves sentence readings without mutating the shared cached result", () => {
  const { applyLookupContext } = load("src/features/dictionary/lookup-analysis.ts");
  const response = { text: "今日", tokens: [{ surface: "今日", dictionary_form: "今日", reading: { hiragana: "きょう", romaji: "" } }] };
  const context = { surface: "今日", dictionary_form: "今日", reading: { hiragana: "こんにち", romaji: "" } };
  const result = applyLookupContext(response, context);
  assert.equal(result.tokens[0].reading.hiragana, "こんにち");
  assert.equal(result.tokens[0].dictionary_reading, "こんにち");
  assert.equal(response.tokens[0].reading.hiragana, "きょう");
  assert.equal(applyLookupContext(response, { ...context, surface: "明日" }), response);
});

test("hover requests share one dictionary-mode message; failed messages can retry", async () => {
  let calls = 0, release;
  global.chrome = { runtime: { sendMessage: message => {
    calls++;
    assert.equal(message.payload.analysis_mode, "dictionary");
    return new Promise(resolve => { release = () => resolve({ type: "ANALYZE_RESULT", payload: { text: "学校", tokens: [] } }); });
  } } };
  const { requestLookupAnalysis } = loader()("src/features/dictionary/lookup-analysis.ts");
  const first = requestLookupAnalysis("ANALYZE_TEXT", "学校", true, "vi");
  const second = requestLookupAnalysis("ANALYZE_TEXT", "学校", true, "vi");
  assert.equal(calls, 1); release(); await Promise.all([first, second]);
  await requestLookupAnalysis("ANALYZE_TEXT", "学校", true, "vi"); assert.equal(calls, 1);
  global.chrome.runtime.sendMessage = async () => { calls++; return { type: "ERROR" }; };
  await requestLookupAnalysis("ANALYZE_TEXT", "失敗", true, "vi");
  await requestLookupAnalysis("ANALYZE_TEXT", "失敗", true, "vi");
  assert.equal(calls, 3);
});

test("dictionary-mode messages bypass LLM analysis; explicit phrase requests retain it", async () => {
  let local = 0, llm = 0;
  const result = { text: "学校", tokens: [] };
  const { handleDictionaryMessage } = loader({
    "~/features/dictionary/api-client": { apiClient: { analyzePhrase: async () => { llm++; return result; } } },
    "./background-analysis": { analyzeLocal: async () => { local++; return result; } },
    "./background-translation": {}, "~/features/subtitles/shared/subtitle-analysis": {},
    "~/features/settings/settings-storage": {},
  })("src/features/dictionary/messages.ts");
  await handleDictionaryMessage({ type: "ANALYZE_JAVI", payload: { text: "学校", analysis_mode: "dictionary" } });
  assert.equal(local, 1); assert.equal(llm, 0);
  await handleDictionaryMessage({ type: "ANALYZE_PHRASE", payload: { text: "学校" } });
  assert.equal(llm, 1);
});

test("phrase results validate surface and dictionary readings independently", async () => {
  const { apiClient } = loader({
    "./llm-service": { llmService: { analyzeText: async () => ({ tokens: [
      { surface: "食べた", dictionary_form: "食べる", reading: "タベタ", dictionary_reading: "タベル" },
      { surface: "飲む", reading: "のんだ" },
    ] }) } },
    "~/features/settings/settings-store": { useSettingsStore: { getState: () => ({ settings: { targetLanguage: "vi" } }) } },
  })("src/features/dictionary/api-client.ts");
  const result = await apiClient.analyzePhrase({ text: "食べた飲む" });
  assert.equal(result.tokens[0].reading.hiragana, "たべた");
  assert.equal(result.tokens[0].dictionary_reading, "たべる");
  assert.equal(result.tokens[1].reading.hiragana, "");
});

test("overlapping online dictionary requests share one fetch and isolate languages", async () => {
  const originalFetch = global.fetch;
  let calls = 0, release;
  global.fetch = async () => {
    calls++;
    await new Promise(resolve => { release = resolve; });
    return { ok: true, json: async () => ({ data: [{ japanese: [{ word: "確認", reading: "かくにん" }],
      senses: [{ english_definitions: ["confirmation"] }] }] }) };
  };
  try {
    const { lookupWord } = loader()("src/features/dictionary/dictionary-lookup.ts");
    const first = lookupWord("確認", "en"), second = lookupWord(" 確認 ", "en");
    assert.equal(calls, 1); release();
    assert.equal((await first).reading, "かくにん"); await second;
    await lookupWord("確認", "en"); assert.equal(calls, 1);
    assert.equal((await lookupWord("学校", "vi")).meaning, "trường học");
    assert.equal((await lookupWord("学校", "en")).meaning, "school");
  } finally { global.fetch = originalFetch; }
});

test("concurrent local dictionary reads share a transaction and query both indexes together", async () => {
  let transactions = 0;
  const waiting = [];
  const value = entry("確認", "かくにん");
  const { searchDictionary } = loader({ idb: { openDB: async () => ({ transaction: () => {
    transactions++;
    return { done: Promise.resolve(), objectStore: () => ({ index: () => ({ getAll: () => new Promise(resolve => waiting.push(() => resolve([value]))) }) }) };
  } }) } })("src/features/dictionary/local-lookup.ts");
  const first = searchDictionary("確認"), second = searchDictionary("確認");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(transactions, 1); assert.equal(waiting.length, 2);
  waiting.splice(0).forEach(release => release());
  assert.deepEqual(await first, [value]); assert.deepEqual(await second, [value]);
  const fresh = searchDictionary("確認"); await new Promise(resolve => setImmediate(resolve));
  assert.equal(transactions, 2);
  waiting.splice(0).forEach(release => release()); await fresh;
});
