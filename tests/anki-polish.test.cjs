const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loader } = require("./load-typescript.cjs");
const load = loader({ "~/features/dictionary/local-lookup": { getDB: async () => { throw new Error("No dictionary"); } } });
const { highlightSentenceFields: highlight, sentenceText } = load("src/shared/japanese/sentence-highlight.ts");
const entry = (word, reading) => ({ kanjiElements: [word], readingElements: [reading] });

test("token lookup and word-length limits retain every token and all visible text", async () => {
  const { refineJapaneseTokens } = load("src/features/dictionary/japanese-token-refinement.ts");
  const tokens = Array.from({ length: 240 }, (_, index) => [{ surface_form: `未知${String.fromCharCode(0x3041 + index % 70)}${String.fromCharCode(0x3041 + Math.floor(index / 70))}語`, base_form: "", pos: "Word" },
    { surface_form: "。", base_form: "。", pos: "Symbol" }]).flat();
  tokens.push({ surface_form: "漢".repeat(40), base_form: "", pos: "Word" });
  let calls = 0;
  const refined = await refineJapaneseTokens(tokens, async () => { calls++; return []; }, true);
  assert.equal(calls, 128);
  assert.equal(refined.map(token => token.surface_form).join(""), tokens.map(token => token.surface_form).join(""));
  const sentence = tokens.map(token => token.surface_form).join("") + "食べました。";
  calls = 0;
  const result = await highlight({ word: "食べる", sentence }, async query => { calls++; return query === "食べる" ? [entry("食べる", "たべる")] : []; });
  assert.ok(calls <= 129);
  assert.equal(sentenceText(result.sentence), sentence);
  assert.ok(result.sentence.endsWith("食べました。"));
});

test("long sentence fields retain their full tail and ruby after highlighting", async () => {
  const sentence = "私はアンです。".repeat(1500) + "末尾🗾。";
  const furigana = "<ruby>私<rt>わたし</rt></ruby>はアンです。".repeat(1500) + "末尾🗾。";
  const result = await highlight({ word: "私", sentence, sentence_furigana: furigana });
  assert.equal(sentenceText(result.sentence), sentence);
  assert.equal(sentenceText(result.sentence_furigana), sentence);
  assert.equal(result.sentence.match(/<b>私<\/b>/g).length, 1500);
  assert.equal(result.sentence_furigana.match(/<b>私<\/b>/g).length, 1500);
  assert.ok(result.sentence_furigana.endsWith("末尾🗾。"));
  assert.deepEqual(await highlight({ word: "私", ...result }), result);
});

test("highlighting preserves visible text, markup and ruby while avoiding compounds and double bold", async () => {
  for (const [word, sentence, expected] of [
    ["私", "私は私です。", "<b>私</b>は<b>私</b>です。"],
    ["あなた", "あなたです。", "<b>あなた</b>です。"],
    ["人", "日本人は人です。", "日本人は<b>人</b>です。"],
    ["私", "<strong>私</strong>と<b>私</b>。", "<strong>私</strong>と<b>私</b>。"],
    ["私", "<i>私</i>&amp;私。", "<i><b>私</b></i>&amp;<b>私</b>。"],
  ]) {
    const result = await highlight({ word, sentence });
    assert.equal(result.sentence, expected); assert.equal(sentenceText(result.sentence), sentenceText(sentence));
    assert.deepEqual(await highlight({ word, ...result }), result);
  }
  const card = { word: "私", sentence: "私は私です。", sentence_furigana: "<ruby>私<rt>わたし</rt></ruby>は<ruby>私<rt>わたし</rt></ruby>です。" };
  const result = await highlight(card);
  assert.equal(result.sentence_furigana, "<ruby><b>私</b><rt>わたし</rt></ruby>は<ruby><b>私</b><rt>わたし</rt></ruby>です。");
  assert.equal(sentenceText(result.sentence), sentenceText(card.sentence));
  assert.equal(sentenceText(result.sentence_furigana), sentenceText(card.sentence_furigana));
  assert.deepEqual(await highlight({ ...card, sentence_furigana: "別の文です。" }), { sentence: card.sentence, sentence_furigana: "別の文です。" });
});

test("only dictionary-confirmed inflections are highlighted, including kana verbs", async () => {
  for (const [word, reading, surface] of [["食べる", "たべる", "食べました"], ["歩く", "あるく", "歩いた"], ["たべる", "たべる", "たべました"]]) {
    const lookup = async query => query === word ? [entry(word, reading)] : [];
    const result = await highlight({ word, sentence: `${surface}。` }, lookup);
    assert.equal(result.sentence, `<b>${surface}</b>。`);
    assert.equal((await highlight({ word, sentence: `${surface}。` }, async () => [])).sentence, `${surface}。`);
  }
});

const { VocabularyAudioPlayer } = loader({ "./media": { loadMedia() {} }, "./anki-connect": { ankiClient: {} } })("src/features/anki/audio-player.ts");
const tick = () => new Promise(resolve => setImmediate(resolve));
class Recording extends EventTarget {
  paused = false;
  play() { return this.started || Promise.resolve(); }
  pause() { this.paused = true; }
  end() { this.dispatchEvent(new Event("ended")); }
}
test("recordings play sequentially, switch exclusively and stop cleanly", async () => {
  const recordings = [], loads = [];
  const player = new VocabularyAudioPlayer(async (profile, filename) => { loads.push([profile, filename]); return filename; }, async () => "Active", () => { const audio = new Recording(); recordings.push(audio); return audio; });
  const first = player.play("word", "[sound:a.mp3][sound:b.mp3]", "Expected");
  await tick(); assert.equal(recordings.length, 1); assert.equal(player.getSnapshot().status, "playing");
  recordings[0].end(); await tick(); assert.equal(recordings.length, 2);
  const next = player.play("sentence", "[sound:c.mp3]"); await tick();
  assert.ok(recordings[1].paused); assert.equal(player.getSnapshot().key, "sentence");
  player.stop(); await Promise.all([first, next]);
  assert.ok(recordings[2].paused); assert.equal(player.getSnapshot().status, "idle");
  assert.deepEqual(loads, [["Expected", "a.mp3"], ["Expected", "b.mp3"], ["Active", "c.mp3"]]);
});

test("late loads and rejected playback cannot disturb a newer recording", async () => {
  let resolveLoad, rejectPlay;
  const recordings = [];
  const player = new VocabularyAudioPlayer(async (_, filename) => filename === "slow.mp3" ? new Promise(resolve => { resolveLoad = resolve; }) : filename,
    async () => "Test", () => { const audio = new Recording(); if (!recordings.length) audio.started = new Promise((_, reject) => { rejectPlay = reject; }); recordings.push(audio); return audio; });
  const old = player.play("old", "[sound:first.mp3]"); await tick();
  const next = player.play("next", "[sound:second.mp3]"); await tick();
  rejectPlay(new Error("Late rejection")); await tick();
  assert.equal(player.getSnapshot().key, "next");
  player.stop(); await Promise.all([old, next]);
  const slow = player.play("slow", "[sound:slow.mp3]"); await tick(); player.stop(); resolveLoad("late"); await slow;
  assert.equal(recordings.length, 2); assert.equal(player.getSnapshot().status, "idle");
  await player.play("empty", ""); assert.equal(player.getSnapshot().status, "idle");
});

test("missing recordings and disconnected Anki produce recoverable playback errors", async () => {
  const player = new VocabularyAudioPlayer(async () => { throw new Error("Missing media"); }, async () => "Test");
  await player.play("missing", "[sound:none.mp3]", "Test"); assert.equal(player.getSnapshot().status, "error");
  const disconnected = new VocabularyAudioPlayer(async () => "", async () => { throw new Error("AnkiConnect connection failed"); });
  await disconnected.play("offline", "[sound:a.mp3]"); assert.equal(disconnected.getSnapshot().status, "error");
  disconnected.stop(); assert.equal(disconnected.getSnapshot().status, "idle");
});

test("media uses a profile-specific offline cache and refuses uncached media from another active profile", async () => {
  const cache = new Map([["Expected:a.mp3", { mime: "audio/mpeg", data: "YQ==" }]]);
  let profileReads = 0, fileReads = 0;
  const { loadMedia } = loader({
    "./anki-connect": { ankiClient: { getProfile: async () => { profileReads++; return "Other"; }, retrieveMedia: async () => { fileReads++; return false; } } },
    "./sync-storage": { ankiStorage: { media: async key => cache.get(key), putMedia: async () => {} } },
  })("src/features/anki/media.ts");
  assert.equal(await loadMedia("Expected", "a.mp3"), "data:audio/mpeg;base64,YQ==");
  assert.equal(profileReads, 0);
  await assert.rejects(loadMedia("Expected", "uncached.mp3"), /profile changed/); assert.equal(fileReads, 0);
  await assert.rejects(loadMedia("Other", "missing.mp3"), /Missing Anki media/); assert.equal(fileReads, 1);
});
