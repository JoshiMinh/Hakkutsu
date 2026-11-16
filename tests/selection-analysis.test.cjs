const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loader } = require("./load-typescript.cjs");

function fixture({ offlineTranslation = false, failAnalysis = false } = {}) {
  const lookedUp = [];
  const dictionaryLanguages = [];
  const translatedLanguages = [];
  const dictionary = { getCommonWord: () => undefined, lookupWord: async (text, language) => {
    lookedUp.push(text);
    dictionaryLanguages.push(language);
    // Providers can return a related match for any query. It is never evidence
    // that a selected phrase is one dictionary word.
    return { meaning: "related dictionary meaning", source: "fixture" };
  } };
  const translation = { googleTranslateService: { translate: async (text, language) => {
    translatedLanguages.push(language);
    if (offlineTranslation) throw new Error("Translation unavailable");
    return `Translation: ${text}`;
  } } };
  const local = { searchDictionary: async () => [], getDB: async () => ({ objectStoreNames: { contains: () => false } }) };
  const load = loader({
    "./dictionary-lookup": dictionary, "~/features/dictionary/dictionary-lookup": dictionary,
    "./google-translate": translation, "~/features/dictionary/google-translate": translation,
    "./local-lookup": local, "~/features/dictionary/local-lookup": local,
    "~/features/settings/settings-storage": { getSettings: async () => ({ targetLanguage: "en" }) },
    "~/features/settings/settings-store": { useSettingsStore: { getState: () => ({ settings: { targetLanguage: "en" } }) } },
    ...(failAnalysis ? { "~/features/dictionary/api-client": { apiClient: { analyzePhrase: async () => { throw new Error("Analysis unavailable"); } } } } : {}),
  });
  return { load, lookedUp, dictionaryLanguages, translatedLanguages, handle: load("src/features/dictionary/messages.ts").handleDictionaryMessage };
}

test("selected short screenshot phrase reaches real sentence analysis without a whole-phrase dictionary shortcut", async () => {
  const { load, handle, lookedUp } = fixture();
  const originalChrome = global.chrome;
  const sent = [];
  global.chrome = { runtime: { sendMessage: message => { sent.push(message); return handle(message); } } };
  try {
    const { requestLookupAnalysis } = load("src/features/dictionary/lookup-analysis.ts");
    const text = "中村さんは断ったそう";
    assert.ok(text.length <= 16);
    const result = await requestLookupAnalysis("ANALYZE_PHRASE", text, true, "en");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].payload.analysis_mode, undefined);
    assert.equal(result.type, "ANALYZE_PHRASE_RESULT");
    assert.equal(result.payload.text, text);
    assert.equal(result.payload.translation, `Translation: ${text}`);
    assert.ok(result.payload.tokens.length > 1, "phrase was collapsed into one dictionary word");
    assert.equal(result.payload.tokens.map(token => token.surface).join(""), text);
    assert.equal(lookedUp.includes(text), false, "whole phrase was sent to word lookup");
  } finally { global.chrome = originalChrome; }
});

test("real sentence tokens retain all selected text and punctuation without looking up punctuation", async () => {
  const { handle, lookedUp } = fixture();
  const text = "その話を聞いて、\n中村さんは断ったそうです。";
  const { payload } = await handle({ type: "ANALYZE_PHRASE", payload: { text, include_definitions: true } });
  assert.equal(payload.tokens.map(token => token.surface).join(""), text);
  assert.ok(payload.tokens.length > 3);
  for (const surface of ["、", "\n", "。"]) {
    assert.equal(payload.tokens.find(token => token.surface === surface).is_japanese, false);
    assert.equal(lookedUp.includes(surface), false);
  }
});

test("unavailable sentence translation preserves real word breakdown", async () => {
  const { handle } = fixture({ offlineTranslation: true });
  const text = "中村さんは断ったそう";
  const result = await handle({ type: "ANALYZE_PHRASE", payload: { text } });
  assert.equal(result.payload.translation, "");
  assert.ok(result.payload.tokens.length > 1);
  assert.equal(result.payload.tokens.map(token => token.surface).join(""), text);
});

test("phrase failure falls back to real local sentence tokens instead of a related whole-phrase definition", async () => {
  const { handle, lookedUp } = fixture({ failAnalysis: true });
  const text = "中村さんは断ったそう";
  const result = await handle({ type: "ANALYZE_PHRASE", payload: { text } });
  assert.equal(result.payload.translation, "");
  assert.ok(result.payload.tokens.length > 1);
  assert.equal(result.payload.tokens.map(token => token.surface).join(""), text);
  assert.equal(lookedUp.includes(text), false);
});

test("ordinary word analysis retains the direct dictionary path", async () => {
  const { load, lookedUp } = fixture();
  const { llmService } = load("src/features/dictionary/llm-service.ts");
  const result = await llmService.analyzeText("学校", false, "en");
  assert.equal(result.tokens.length, 1);
  assert.deepEqual(lookedUp, ["学校"]);
  assert.equal(result.tokens[0].meaning, "related dictionary meaning");
});

test("selection language reaches real analysis and dictionary providers and isolates cached results in all locales", async () => {
  const { load, handle, dictionaryLanguages, translatedLanguages } = fixture();
  const originalChrome = global.chrome;
  global.chrome = { runtime: { sendMessage: handle } };
  try {
    const { requestLookupAnalysis } = load("src/features/dictionary/lookup-analysis.ts");
    for (const language of ["en", "vi", "ja", "zh", "ko", "es", "fr", "id"]) {
      dictionaryLanguages.length = 0;
      const result = await requestLookupAnalysis("ANALYZE_PHRASE", "中村さんは断ったそう", true, language);
      assert.ok(result.payload.tokens.length > 1);
      assert.equal(translatedLanguages.at(-1), language);
      assert.ok(dictionaryLanguages.length > 0);
      assert.ok(dictionaryLanguages.every(value => value === language));
    }
    assert.equal(translatedLanguages.length, 8);
    await requestLookupAnalysis("ANALYZE_PHRASE", "中村さんは断ったそう", true, "en");
    assert.equal(translatedLanguages.length, 8, "same-language replay missed its cache");
  } finally { global.chrome = originalChrome; }
});

test("dictionary-only and local fallback analysis respect explicit language instead of stored English", async () => {
  for (const failAnalysis of [false, true]) {
    const { handle, dictionaryLanguages } = fixture({ failAnalysis });
    await handle({ type: failAnalysis ? "ANALYZE_PHRASE" : "ANALYZE_TEXT", payload: {
      text: "中村さんは断ったそう", target_language: "fr", ...(failAnalysis ? {} : { analysis_mode: "dictionary" }),
    } });
    assert.ok(dictionaryLanguages.length > 0);
    assert.ok(dictionaryLanguages.every(language => language === "fr"));
  }
});
